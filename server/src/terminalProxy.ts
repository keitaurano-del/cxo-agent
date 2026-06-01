// Apollo Web ターミナル（MC-92）— /terminal を localhost の ttyd へ reverse proxy する。
//
// 全体像:
//   ブラウザ → Apollo(:4317) /terminal → (この proxy) → ttyd(127.0.0.1:7681) → tmux main（林 CLI）
//
// セキュリティ設計（多層）:
//   1) HTTP は index.ts で makeAuthMiddleware の「後ろ」にマウントする＝未認証は proxy に到達しない。
//   2) WS upgrade は Express ミドルウェアが走らないため、attachUpgrade() 内で isRequestAuthorized()
//      を必ず通す（ここが抜けると WS だけ無認証で素通りする＝最重要ゲート）。
//   3) ttyd 自体も Basic 認証（強いランダム credential）。この proxy が内部で Authorization を付与し、
//      Keita は Apollo 認証だけ通せば ttyd credential を意識しなくてよい。
//   4) ttyd は 127.0.0.1 バインドで、proxy 以外から直接到達できない。
//
// credential は repo 外の .terminal.env（chmod 600）から env 経由で読む。コードに直書きしない。

import httpProxy from 'http-proxy';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isRequestAuthorized } from './lib/auth.js';

const TTYD_HOST = process.env.TTYD_HOST ?? '127.0.0.1';
const TTYD_PORT = process.env.TTYD_PORT ?? '7681';
const TTYD_TARGET = `http://${TTYD_HOST}:${TTYD_PORT}`;
const TERMINAL_PREFIX = '/terminal';

/** ttyd の Basic 認証ヘッダ（user:pass を base64）。未設定なら null（付与しない）。 */
function ttydAuthHeader(): string | null {
  const user = process.env.TTYD_USER;
  const pass = process.env.TTYD_PASS;
  if (!user || !pass) return null;
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

// proxy は1つだけ生成して使い回す。ws:true で WebSocket も中継する。
const proxy = httpProxy.createProxyServer({
  target: TTYD_TARGET,
  ws: true,
  changeOrigin: true,
  // proxy 側で /terminal プレフィックスを剥がすのは proxyReq/手前で行う（下記参照）。
});

// proxy 失敗時に Apollo 全体を落とさない。ttyd 停止中（林セッション無し等）でも 502 を返すだけ。
proxy.on('error', (err, _req, resOrSocket) => {
  console.error('[terminal proxy error]', err?.message ?? err);
  // HTTP レスポンス or WS socket のどちらか
  const res = resOrSocket as Partial<Response> & { writableEnded?: boolean };
  if (res && typeof res.writeHead === 'function' && !res.writableEnded) {
    try {
      res.writeHead?.(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      (res as Response).end?.('terminal backend unavailable');
    } catch {
      /* noop */
    }
  } else if (resOrSocket && typeof (resOrSocket as Duplex).destroy === 'function') {
    (resOrSocket as Duplex).destroy();
  }
});

// ttyd へ転送する直前に Basic 認証ヘッダを内部付与する（HTTP・WS 両方）。
const authHeader = ttydAuthHeader();
proxy.on('proxyReq', (proxyReq) => {
  if (authHeader) proxyReq.setHeader('Authorization', authHeader);
});
proxy.on('proxyReqWs', (proxyReq) => {
  if (authHeader) proxyReq.setHeader('Authorization', authHeader);
});

// ttyd からのレスポンス（iframe で読み込まれる HTML / JS）に Permissions-Policy を付与する。
// index.ts のグローバル middleware でも付けているが、http-proxy が upstream（ttyd）の
// ヘッダで writeHead する際に Express が set 済みのヘッダを取りこぼす可能性を避け、
// proxy 経路でも確実に clipboard を self 許可する（MC-92 コピペ改善）。
proxy.on('proxyRes', (proxyRes) => {
  proxyRes.headers['permissions-policy'] = 'clipboard-read=(self), clipboard-write=(self)';
});

/**
 * /terminal の HTTP リクエストを ttyd へ中継する Express ハンドラ。
 * index.ts で makeAuthMiddleware の後ろにマウントするので、ここに来る時点で認証済み。
 * ttyd はルート相対パス（/token, /ws 等）で配信するため、/terminal プレフィックスを剥がす。
 */
export function terminalHttpHandler(req: Request, res: Response, next: NextFunction): void {
  // express の req.url は mount 後プレフィックスが剥がれる（app.use('/terminal', ...) 前提）。
  // ttyd はルート配信なので、剥がれた req.url をそのまま target に渡せばよい。
  void next; // next は使わないが Express ハンドラ signature 維持
  proxy.web(req, res, { target: TTYD_TARGET });
}

/**
 * http.Server の 'upgrade' イベントに登録する WS ハンドラを返す。
 * /terminal 配下の WS のみ処理し、それ以外（既存 SSE は HTTP なので upgrade に来ない）は素通り。
 * 認証は isRequestAuthorized() で必ず通す（Express ミドルウェアが走らない経路のため）。
 */
export function attachUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = req.url ?? '';
  if (!url.startsWith(TERMINAL_PREFIX)) return false; // /terminal 以外は扱わない

  // 最重要: WS upgrade でも token/Cookie/Bearer を検証。未認証は即切断。
  if (!isRequestAuthorized({ headers: req.headers, url })) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }

  // /terminal プレフィックスを剥がして ttyd のルート相対パスへ。
  req.url = url.slice(TERMINAL_PREFIX.length) || '/';
  proxy.ws(req, socket, head, { target: TTYD_TARGET });
  return true;
}
