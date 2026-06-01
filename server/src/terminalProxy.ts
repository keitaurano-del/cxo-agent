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

// ─── モバイルのタップで TUI メニューを選択できるようにする（MC-105）────────────
// 根因（実機/コード確定）: claude などの TUI は mouse reporting（DEC 1000/1002 + SGR 1006）を
//   有効化し、ユーザーがメニュー項目をクリックすると端末がその座標を SGR mouse シーケンス
//   （ESC[<0;col;rowM 押下 → ESC[<0;col;rowm 解放）で PTY へ送り、TUI が該当項目を選択する。
//   xterm.js（ttyd 1.7.4 同梱 = xterm 4.x）は mouse mode 有効時、PC のマウスイベントは
//   coreMouseService.triggerMouseEvent() 経由で正しく SGR 化して送るが、モバイルの touch
//   イベントには mouse report を一切張っていない（xterm の bindMouse は mousedown/mouseup/
//   wheel のみ登録。touchstart/touchend は未処理）。ブラウザは tap を合成 click にするが、
//   合成 mousedown/up も発火タイミング・座標が不安定で、mouse mode 下のメニュー選択に
//   繋がらない＝「PC クリックは効くがモバイルのタップは無反応」になる。
// 修正（公開 API 中心・内部依存は最小＋ガード付き）: xterm の screen 要素に touchstart/
//   touchend を張り、mouse reporting が有効なときだけ、タップ座標を term.cols/term.rows と
//   要素の getBoundingClientRect() から col/row（0-indexed）へ換算し、xterm 公開内部の
//   coreMouseService.triggerMouseEvent({col,row,x,y,button:0,action:1}) で press、続けて
//   action:0 で release を撃つ。これで xterm が active protocol（SGR 等）に応じた正しい
//   mouse シーケンスを PTY へ送る＝PC クリックと同じ出力になり TUI が項目を選択する。
//   mouse reporting 無効時（通常 shell）は何もしない＝既存のフォーカス/スクロール/選択を温存。
//   スクロール（スワイプ）と単発タップは移動量しきい値（10px）と時間（700ms）で区別し、
//   スワイプは mouse press を撃たない。内部 API（term._core.coreMouseService）は try/catch で
//   ガードし、構造が変わっても通常タップを壊さない（false を返して無処理に倒す）。
const TAP_FIX_SCRIPT = `<script>(function(){
  function install(){
    var t=window.term;
    if(!t||typeof t.cols!=='number'){return false;}
    if(t.__apolloTapFix){return true;}
    var el=null;
    try{el=t.element&&t.element.querySelector?t.element.querySelector('.xterm-screen'):null;}catch(_e){}
    if(!el){el=t.element;}
    if(!el){return false;}
    t.__apolloTapFix=true;
    // mouse reporting が有効か（claude のメニュー等は有効化する）。内部 API はガード。
    function mouseActive(){
      try{
        var c=t._core&&t._core.coreMouseService;
        return !!(c&&c.areMouseEventsActive);
      }catch(_e){return false;}
    }
    // タップ座標を 0-indexed の col/row に換算（公開 getter + rect のみ使用）。
    function toCell(clientX,clientY){
      var r=el.getBoundingClientRect();
      var cols=t.cols,rows=t.rows;
      if(!cols||!rows||r.width<=0||r.height<=0){return null;}
      var cw=r.width/cols, ch=r.height/rows;
      var col=Math.floor((clientX-r.left)/cw);
      var row=Math.floor((clientY-r.top)/ch);
      if(col<0){col=0;} if(col>=cols){col=cols-1;}
      if(row<0){row=0;} if(row>=rows){row=rows-1;}
      return {col:col,row:row};
    }
    // press(action:1) → release(action:0) を左ボタン(button:0)で撃つ。triggerMouseEvent は
    // 内部で col/row を ++ するので 0-indexed を渡す。x/y は SGR_PIXELS 用だが SGR では未使用。
    function sendTap(cell){
      try{
        var c=t._core.coreMouseService;
        c.triggerMouseEvent({col:cell.col,row:cell.row,x:cell.col+1,y:cell.row+1,button:0,action:1,ctrl:false,alt:false,shift:false});
        c.triggerMouseEvent({col:cell.col,row:cell.row,x:cell.col+1,y:cell.row+1,button:0,action:0,ctrl:false,alt:false,shift:false});
        return true;
      }catch(_e){return false;}
    }
    var sx=0,sy=0,st=0,moved=false,tracking=false;
    el.addEventListener('touchstart',function(e){
      if(!mouseActive()){tracking=false;return;} // 通常 shell では一切介入しない
      if(e.touches.length!==1){tracking=false;return;} // マルチタッチ（ズーム等）は無視
      tracking=true;moved=false;
      var tt=e.touches[0];sx=tt.clientX;sy=tt.clientY;st=Date.now();
    },{passive:true});
    el.addEventListener('touchmove',function(e){
      if(!tracking){return;}
      var tt=e.touches[0];
      if(Math.abs(tt.clientX-sx)>10||Math.abs(tt.clientY-sy)>10){moved=true;}
    },{passive:true});
    el.addEventListener('touchend',function(e){
      if(!tracking){return;}
      tracking=false;
      if(moved||(Date.now()-st)>700){return;} // スワイプ/長押しはタップ扱いしない
      if(!mouseActive()){return;}
      var tt=(e.changedTouches&&e.changedTouches[0])||null;
      if(!tt){return;}
      var cell=toCell(tt.clientX,tt.clientY);
      if(!cell){return;}
      if(sendTap(cell)){
        // ブラウザの合成 mousedown/click による二重送出を防ぐ（mouse mode 時のみ）。
        e.preventDefault();
      }
    },{passive:false});
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
      body = body.replace('</body>', `${PASTE_FIX_SCRIPT}${TAP_FIX_SCRIPT}</body>`);
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
