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
// selfHandleResponse:true: レスポンス本文を proxyRes で自前処理する（HTML への script 注入のため）。
//   HTML 以外（JS バンドル・font・WS）は proxyRes 内でそのまま pipe して透過する。
const proxy = httpProxy.createProxyServer({
  target: TTYD_TARGET,
  ws: true,
  changeOrigin: true,
  selfHandleResponse: true,
  // proxy 側で /terminal プレフィックスを剥がすのは proxyReq/手前で行う（下記参照）。
});

// ─── PC ブラウザの Ctrl+V 貼り付け対応（MC-92 / MC-94）──────────────────────
// 根因（MC-94 実機確定）: xterm.js は非 Mac で Ctrl+V keydown を端末キーストロークとして
//   扱い、SYN(0x16) を PTY に送る（＝Ctrl+V で制御文字だけ飛び、何も貼り付かない）。
//   MC-92 の旧修正は customKeyEventHandler で Ctrl+V を捕まえて e.preventDefault() し
//   navigator.clipboard.readText() → term.paste() に置き換えていたが、Apollo は
//   /terminal を iframe（web/src/views/Terminal.tsx）で埋め込んでおり、実 PC ブラウザの
//   iframe 内 readText() は clipboard-read 権限ゲートで NotAllowedError になる（Permissions
//   -Policy で委譲済みでもユーザー許可が無ければ Chrome がブロック）。readText が失敗しても
//   旧コードは .catch で握りつぶし、かつ keydown を preventDefault 済みのため、ネイティブ
//   paste も殺され「Ctrl+V で何も貼れない」状態になっていた（Playwright で
//   permissions:['clipboard-write'] = clipboard-read 未付与＝実ブラウザ相当で再現）。
// 修正（権限不要・ttyd 内部構造非依存）: customKeyEventHandler は Ctrl+V（Shift 無し）に
//   対し return false を返す（xterm に「このキーを端末入力として送るな」＝SYN 抑止）。
//   ただし e.preventDefault() は呼ばない。これでブラウザのネイティブ paste が helper
//   textarea（xterm-helper-textarea）に走り、xterm 組み込みの paste ハンドラが DOM 'paste'
//   イベントを拾って bracketed paste（ESC[200~ … ESC[201~）で PTY へ送る＝term.paste() と
//   同じ出力で claude(林) TUI も正しく受ける。clipboard.readText() / clipboard-read 権限は
//   一切使わない（ネイティブ paste の clipboardData は paste アクション自体に紐づくため権限
//   ゲートを通らない）。Ctrl+Shift+V（既存ネイティブ paste）・通常打鍵は素通りで非退行。
//   実機検証（Playwright chromium、clipboard-read 未付与＝実 PC ブラウザ相当）で
//   synthetic paste → onData が ESC[200~<text>ESC[201~ を送ることを確認済み（MC-94）。
const PASTE_FIX_SCRIPT = `<script>(function(){
  function install(){
    var t=window.term;
    if(!t||typeof t.attachCustomKeyEventHandler!=='function'){return false;}
    if(t.__apolloPasteFix){return true;}
    t.__apolloPasteFix=true;
    t.attachCustomKeyEventHandler(function(e){
      // Ctrl+V（Shift/Alt/Meta 無し）: xterm に端末入力（SYN）として送らせない（return false）。
      // preventDefault は呼ばない＝ブラウザのネイティブ paste を生かし、xterm 組み込みの
      // paste ハンドラ（helper textarea の 'paste' DOM イベント）が bracketed paste で送る。
      if(e.type==='keydown'&&e.ctrlKey&&!e.shiftKey&&!e.altKey&&!e.metaKey&&(e.key==='v'||e.key==='V')){
        return false;
      }
      return true;
    });
    return true;
  }
  if(!install()){
    var n=0,iv=setInterval(function(){if(install()||++n>100){clearInterval(iv);}},100);
  }
})();</script>`;

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
  // selfHandleResponse:true で HTML body を utf8 文字列化して script 注入するため、ttyd には
  // 常に非圧縮で返させる。ブラウザが Accept-Encoding: gzip を送ると ttyd が gzip で返し、
  // それを toString('utf8') すると gzip バイナリが壊れる（MC-93 の文字化けの根因）。
  proxyReq.removeHeader('accept-encoding');
  if (authHeader) proxyReq.setHeader('Authorization', authHeader);
});
proxy.on('proxyReqWs', (proxyReq) => {
  if (authHeader) proxyReq.setHeader('Authorization', authHeader);
});

// ttyd からのレスポンスを中継する。selfHandleResponse:true なので本文を自前で流す。
//   - HTML（ttyd の index ページ）: 全体をバッファして </body> 直前に貼り付け修正 script を注入。
//   - それ以外（JS バンドル・font・favicon 等）: ヘッダをそのまま写して透過 pipe（無改変）。
// Permissions-Policy は index.ts のグローバル middleware でも付くが、proxy 経路でも確実に
// clipboard を self 許可する（http-proxy の writeHead で取りこぼす可能性を避ける、MC-92）。
proxy.on('proxyRes', (proxyRes, _req, res) => {
  const headers = { ...proxyRes.headers };
  headers['permissions-policy'] = 'clipboard-read=(self), clipboard-write=(self)';

  const contentType = String(proxyRes.headers['content-type'] ?? '');
  const isHtml = contentType.includes('text/html');

  if (!isHtml) {
    // 非 HTML はそのまま透過（無改変）。ヘッダを写して pipe する。
    res.writeHead(proxyRes.statusCode ?? 200, headers);
    proxyRes.pipe(res);
    return;
  }

  // HTML はバッファして script 注入する。content-length が変わるので再計算する。
  const chunks: Buffer[] = [];
  proxyRes.on('data', (c: Buffer) => chunks.push(c));
  proxyRes.on('end', () => {
    let body = Buffer.concat(chunks).toString('utf8');
    if (body.includes('</body>') && !body.includes('__apolloPasteFix')) {
      body = body.replace('</body>', `${PASTE_FIX_SCRIPT}</body>`);
    }
    const buf = Buffer.from(body, 'utf8');
    headers['content-length'] = String(buf.byteLength);
    delete headers['content-encoding']; // proxyReq で accept-encoding を落とし非圧縮固定だが念のため
    res.writeHead(proxyRes.statusCode ?? 200, headers);
    res.end(buf);
  });
  proxyRes.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
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
