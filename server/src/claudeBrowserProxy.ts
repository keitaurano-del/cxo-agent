// Apollo 埋め込みブラウザ（MC-350 / 旧MC-314 復活）— /claude-browser を localhost の noVNC へ reverse proxy する。
//
// 全体像:
//   ブラウザ → Apollo(:4317) /claude-browser → (この proxy) → websockify/noVNC(127.0.0.1:6081)
//     → x11vnc(127.0.0.1:5901) → Xvfb:99 上の Chromium kiosk（claude.ai = Cowork）
//
// セキュリティ設計（terminalProxy と同型・多層）:
//   1) HTTP は index.ts で makeAuthMiddleware の「後ろ」にマウント＝未認証は proxy に到達しない。
//   2) WS upgrade は attachClaudeBrowserUpgrade() 内で isRequestAuthorized() を必ず通す。
//   3) VNC 自体もパスワード認証（vncpass）。パスワードはバンドルに焼かず /api/claude-browser/config
//      （認証済みのみ）で配布する。
//   4) websockify/x11vnc は 127.0.0.1 バインドで proxy 以外から直接到達できない。

import httpProxy from 'http-proxy';
import { readFileSync } from 'node:fs';
import type { Request, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isRequestAuthorized } from './lib/auth.js';

const NOVNC_TARGET = process.env.CLAUDE_BROWSER_TARGET ?? 'http://127.0.0.1:6081';
const PREFIX = '/claude-browser';
const VNC_PASS_FILE =
  process.env.CLAUDE_BROWSER_VNCPASS_FILE ?? '/home/dev/.openclaw/claude-browser/vncpass.txt';

const proxy = httpProxy.createProxyServer({
  target: NOVNC_TARGET,
  changeOrigin: false,
  ws: true,
  xfwd: false,
});

proxy.on('error', (err, _req, resOrSocket) => {
  console.error('[claude-browser proxy error]', err.message);
  const anyRes = resOrSocket as { writableEnded?: boolean; end?: (s?: string) => void } | undefined;
  try {
    anyRes?.end?.();
  } catch {
    /* noop */
  }
});

/**
 * HTTP ハンドラ。index.ts で app.use('/claude-browser', ...) にマウントする前提
 * （認証ミドルウェアの後ろ）。mount で PREFIX が剥がれた req.url をそのまま noVNC へ渡す。
 */
export function claudeBrowserHttpHandler(req: Request, res: Response): void {
  proxy.web(req, res, { target: NOVNC_TARGET });
}

/**
 * WS upgrade。server.on('upgrade') から呼ぶ。/claude-browser 配下なら処理して true。
 * 認証 NG は 401 で閉じる（ここが最重要ゲート — 抜けると VNC が無認証で露出する）。
 */
export function attachClaudeBrowserUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  const url = req.url ?? '';
  if (url !== PREFIX && !url.startsWith(PREFIX + '/')) return false;
  if (!isRequestAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }
  // /claude-browser/websockify → /websockify に rewrite して中継する。
  req.url = url.slice(PREFIX.length) || '/';
  proxy.ws(req, socket, head, { target: NOVNC_TARGET });
  return true;
}

/**
 * GET /api/claude-browser/config — VNC パスワードを認証済みクライアントへ配布する。
 * （認証ミドルウェアの後ろにマウントされる /api ルート）
 */
export function claudeBrowserConfigHandler(_req: Request, res: Response): void {
  try {
    const password = readFileSync(VNC_PASS_FILE, 'utf8').trim();
    res.json({ password });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[claude-browser config]', message);
    res.status(500).json({ error: 'vnc password unavailable' });
  }
}
