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
import { TERMINALS, terminalTarget } from './config.js';

const TTYD_HOST = process.env.TTYD_HOST ?? '127.0.0.1';
// 後方互換: 旧 TTYD_PORT env（既定 7681）= ターミナル1のフォールバック。
const TTYD_PORT = process.env.TTYD_PORT ?? String(TERMINALS[0]?.port ?? 7681);
const TTYD_TARGET = `http://${TTYD_HOST}:${TTYD_PORT}`;
const TERMINAL_PREFIX = '/terminal';

// ─── 3ターミナル振り分け（MC-119）──────────────────────────────────
// ベースパス → ttyd ポートの対応:
//   /terminal      → TERMINALS[id=1].port（7681、後方互換）
//   /terminal/2    → TERMINALS[id=2].port（7682）
//   /terminal/3    → TERMINALS[id=3].port（7683）
// ttyd は root(/) 配信なので、各ベースパスを ttyd の '/' に rewrite して中継する。
// iframe src は末尾スラッシュ付き（例 /terminal/2/）にして、相対パスの ttyd アセット
// （xterm.js / token / ws）が /terminal/2/... に解決されるようにする（ここで /2 を剥がす）。
//
// パス解決ルール（HTTP は mount 後に /terminal が剥がれた req.url、WS は完全 URL を渡す）:
//   - 先頭が「/<id>」（id は 2 以上）で、その後が末尾 or '/' なら そのターミナル（/<id> を剥がす）
//   - それ以外は ターミナル1（ttyd 1 のルート相対アセットは剥がさず素通し）
// ttyd のアセットはすべて相対パスなので、/2 /3 以外の絶対パスを ttyd が要求することはない。

interface ResolvedTerminal {
  /** 振り分け先 ttyd の origin（http://host:port）。 */
  target: string;
  /** ttyd へ渡す rewrite 後のパス（ベースプレフィックスを剥がしたもの）。 */
  ttydPath: string;
}

/**
 * /terminal を mount で剥がした後の相対パス（HTTP）または完全 URL（WS は別関数）から、
 * どのターミナルの ttyd へ振り分けるか・rewrite 後パスを解決する。
 * @param relPath 例: '/' '/token' '/ws'（=1）, '/2' '/2/token' '/2/ws'（=2）, '/3/...'（=3）
 */
function resolveByRelPath(relPath: string): ResolvedTerminal {
  const url = relPath || '/';
  // クエリ/フラグメントを保持したまま、パス部分だけでマッチする。
  const qIndex = url.search(/[?#]/);
  const pathOnly = qIndex >= 0 ? url.slice(0, qIndex) : url;
  const suffix = qIndex >= 0 ? url.slice(qIndex) : '';

  for (const t of TERMINALS) {
    if (t.id === 1) continue; // id=1 はデフォルト（フォールバック）
    const base = `/${t.id}`;
    if (pathOnly === base || pathOnly.startsWith(base + '/')) {
      // /<id> を剥がす。/<id> 単体（末尾スラッシュ無し）は '/' に正規化する。
      const stripped = pathOnly.slice(base.length) || '/';
      return { target: terminalTarget(t, TTYD_HOST), ttydPath: stripped + suffix };
    }
  }
  // デフォルト = ターミナル1。ttyd 1 のルート相対アセットはそのまま渡す。
  const t1 = TERMINALS.find((t) => t.id === 1);
  return { target: t1 ? terminalTarget(t1, TTYD_HOST) : TTYD_TARGET, ttydPath: url };
}

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
// ─── PageUp/PageDown でのスクロール対応（MC-108）──────────────────────────────
// 根因（MC-105 で実証済み + 本件で確定）: claude などの TUI は alternate screen ＋ mouse
//   reporting（DEC 1000/1002 + SGR 1006）を有効化する。この状態では (a) xterm の scrollback
//   buffer 自体が無効、(b) ブラウザ/xterm のネイティブな PageUp/PageDown スクロールバックも
//   効かない。MC-105 でスワイプ／マウスホイールは wheel SGR（button:4＝SGR 64/65）に変換して
//   TUI に送る経路を作り、TUI 側が履歴をスクロールするのを実証した。だがキーボードの
//   PageUp/PageDown はその経路に乗っておらず、xterm にそのまま渡って TUI が無反応 or 別用途で
//   消費し、スクロールしなかった（＝Keita 報告の「PageUp/Down が効かない」）。
// 修正:
//   - mouse reporting 有効時（TUI）: PageUp → wheel up を1ページ分（term.rows-1 行、最低1行）
//     coreMouseService.triggerMouseEvent(button:4, action:0) で送出。PageDown → wheel down
//     (action:1)。MC-105 のスワイプ／ホイールと同一の SGR 経路で TUI がスクロールする。
//     Shift 修飾の有無に関わらず同じ扱い（mouse mode 下では native scrollback が無いため、
//     素の PageUp/Down も Shift+PageUp/Down も wheel 変換でスクロールに割り当てる）。return false
//     で xterm への生キー送出を抑止する（TUI が PageUp/Down を別用途で消費するのを防ぐ）。
//   - mouse reporting 無効時（通常 shell）: Shift+PageUp/Down は xterm がネイティブに scrollback へ
//     当てているので尊重し素通り（return true、二重送出しない）。素の PageUp/Down は xterm が
//     端末へ ESC[5~ / ESC[6~ を送るだけでスクロールバックを動かさないため、term.scrollPages(-1)/
//     scrollPages(1) の公開 API で scrollback を1ページ動かし、return false で生キー送出を抑止する。
//   既存ハンドラ（MC-94 Ctrl+V）と統合し1つの attachCustomKeyEventHandler に同居させる（xterm は
//   custom key handler を1つしか持てず、後勝ちで上書きされるため、別々に attach すると Ctrl+V が
//   壊れる）。内部 API（coreMouseService / scrollPages）は try/catch でガードし、構造変化時も
//   通常打鍵を壊さない（その場合は return true で素通り）。
//
// KEY_FIX_BODY はブラウザで eval する素の JS（テストから new Function で eval し window.term を
// モックして「mouse mode→wheel / 通常 shell→scrollPages / Shift は native 尊重 / Ctrl+V→SYN抑止」を
// 検証する）。本番注入は PASTE_FIX_SCRIPT（<script> でラップ）を使う。
export const KEY_FIX_BODY = `(function(){
  function install(){
    var t=window.term;
    if(!t||typeof t.attachCustomKeyEventHandler!=='function'){return false;}
    if(t.__apolloPasteFix){return true;}
    t.__apolloPasteFix=true;
    // mouse reporting が有効か（claude のメニュー等は有効化する）。内部 API はガード。
    function mouseActive(){
      try{
        var c=t._core&&t._core.coreMouseService;
        return !!(c&&c.areMouseEventsActive);
      }catch(_e){return false;}
    }
    // wheel イベントを n 回撃つ。button:4 が xterm の wheel エンコード（up=action:0→SGR 64、
    // down=action:1→SGR 65）＝PC マウスホイール／MC-105 スワイプと同一の出力。
    function sendWheel(up,n){
      try{
        var c=t._core.coreMouseService;
        var action=up?0:1;
        for(var i=0;i<n;i++){
          c.triggerMouseEvent({col:0,row:0,x:1,y:1,button:4,action:action,ctrl:false,alt:false,shift:false});
        }
        return true;
      }catch(_e){return false;}
    }
    // 1ページ分の行数（端末行数-1、最低1）。
    function pageLines(){
      var r=(typeof t.rows==='number'&&t.rows>1)?t.rows-1:1;
      return r;
    }
    t.attachCustomKeyEventHandler(function(e){
      if(e.type!=='keydown'){return true;}
      // Ctrl+V（Shift/Alt/Meta 無し）: xterm に端末入力（SYN）として送らせない（return false）。
      // preventDefault は呼ばない＝ブラウザのネイティブ paste を生かし、xterm 組み込みの
      // paste ハンドラ（helper textarea の 'paste' DOM イベント）が bracketed paste で送る。
      if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&!e.metaKey&&(e.key==='v'||e.key==='V')){
        return false;
      }
      // PageUp / PageDown（MC-108）: Alt/Ctrl/Meta 付きは別用途なので触らない。
      if((e.key==='PageUp'||e.key==='PageDown')&&!e.altKey&&!e.ctrlKey&&!e.metaKey){
        var up=(e.key==='PageUp');
        if(mouseActive()){
          // TUI（alternate screen + mouse reporting）: native scrollback が無いので wheel に変換。
          // Shift 有無に関わらず同じ（mouse mode では素も Shift もスクロールに割り当てる）。
          if(sendWheel(up,pageLines())){
            if(typeof e.preventDefault==='function'){e.preventDefault();}
            return false; // 生キー（ESC[5~/6~）を TUI に送らない
          }
          return true; // 内部 API が取れなければ素通り（非退行）
        }
        // 通常 shell: Shift+PageUp/Down は xterm ネイティブの scrollback に任せる（二重送出しない）。
        if(e.shiftKey){return true;}
        // 素の PageUp/Down は xterm が ESC[5~/6~ を送るだけで scrollback を動かさないので、
        // 公開 API でスクロールバックを1ページ動かし、生キー送出を抑止する。
        try{
          if(typeof t.scrollPages==='function'){
            t.scrollPages(up?-1:1);
            if(typeof e.preventDefault==='function'){e.preventDefault();}
            return false;
          }
        }catch(_e){/* fall through */}
        return true;
      }
      return true;
    });
    return true;
  }
  if(!install()){
    var n=0,iv=setInterval(function(){if(install()||++n>100){clearInterval(iv);}},100);
  }
})();`;
const PASTE_FIX_SCRIPT = `<script>${KEY_FIX_BODY}</script>`;

// ─── モバイルのタップで TUI メニューを選択できるようにする（MC-104）＋スクロール温存（MC-105）─
// 根因（MC-104・実機/コード確定）: claude などの TUI は mouse reporting（DEC 1000/1002 + SGR 1006）を
//   有効化し、ユーザーがメニュー項目をクリックすると端末がその座標を SGR mouse シーケンス
//   （ESC[<0;col;rowM 押下 → ESC[<0;col;rowm 解放）で PTY へ送り、TUI が該当項目を選択する。
//   xterm.js（ttyd 1.7.4 同梱 = xterm 4.x）は mouse mode 有効時、PC のマウスイベントは
//   coreMouseService.triggerMouseEvent() 経由で正しく SGR 化して送るが、モバイルの touch
//   イベントには mouse report を一切張っていない（xterm の bindMouse は mousedown/mouseup/
//   wheel のみ登録。touchstart/touchend は未処理）。ブラウザは tap を合成 click にするが、
//   合成 mousedown/up も発火タイミング・座標が不安定で、mouse mode 下のメニュー選択に
//   繋がらない＝「PC クリックは効くがモバイルのタップは無反応」になる。
//
// 回帰（MC-105・実機/コード確定）: MC-104 が touchstart/move/end を張ったことで、claude などの
//   TUI（mouse reporting 有効＝alternate screen + DEC 1000/1002）でモバイルのスワイプスクロールが
//   完全に死んだ。実機（Playwright モバイル + mouse-mode probe で onData を観測）で確定した根因:
//     - xterm 4.x のネイティブ touch スクロール（viewport.handleTouchStart/handleTouchMove）は
//       `if(!coreMouseService.areMouseEventsActive)` でガードされ、mouse mode 有効時は発火しない。
//       さらに alternate screen では scrollback buffer 自体が無効＝ネイティブにスクロールする対象が無い。
//     - MC-104 の TAP_FIX は touchend で「moved（スワイプ）はタップ扱いせず return＝何もしない」。
//     結果、mouse mode 中のスワイプは (a) xterm ネイティブが mouse-mode ガードで不発、(b) TAP_FIX も
//     何もしない、で宙ぶらりんになり、TUI へホイールイベントすら届かず＝スワイプが完全に無反応。
//   実機観測（mouse mode 有効・スワイプ）: PTY 送出は空配列＝何も飛んでいなかった。
//   ※ PC マウスホイールは xterm ネイティブの wheel ハンドラが mouse mode 時に SGR wheel（button:4＝
//     SGR 64=up / 65=down）に変換して PTY へ送るので生きていた＝「PC ホイールは効くがモバイルの
//     スワイプだけ無反応」という症状だった（PC ホイール経路はこの script は一切触らない＝非退行）。
//
// 修正（MC-105、スワイプスクロール復活・タップ選択維持・通常 shell 非介入）:
//   1) リスナを **.xterm-viewport（スクロール要素）に張る**。座標→col/row 換算は .xterm-screen の
//      rect を使う（viewport は screen を覆うので clientX/Y は一致）。viewport が取れない構造の
//      ときだけ .xterm-screen → t.element の順でフォールバック。
//   2) **mouse reporting 無効時（通常 shell / scrollback 閲覧）は touch に一切介入しない**＝xterm
//      ネイティブの touch スクロール（handleTouchMove）をそのまま生かす。touch-action: pan-x pan-y
//      を明示してブラウザのネイティブ pan も殺さない。実機でこの経路はスクロールバックが動くことを確認済み。
//   3) **mouse reporting 有効時（TUI）のみ介入**:
//      - タップ（移動量小・短時間）→ press(action:1)→release(action:0) を button:0 で撃つ＝PC
//        クリックと同一の SGR で TUI が項目を選択（MC-104 機能、維持）。
//      - スワイプ（移動量がしきい値超）→ 移動量を行数に換算し、その回数だけ wheel イベント
//        （button:4、指を下へ＝過去へ＝action:0=up / 指を上へ＝action:1=down）を triggerMouseEvent で
//        撃つ＝PC ホイールと同一の SGR（ESC[<64.. / ESC[<65..）が TUI へ届き、TUI が履歴をスクロールする。
//      mouse mode 中はネイティブ touch スクロールが不発（上記ガード）なので、スワイプ中の touchmove は
//      preventDefault してページスクロール等への漏れを防ぐ（ネイティブ介入を奪う心配はない）。
//   内部 API（term._core.coreMouseService）は try/catch でガードし、構造変化時も通常 touch を壊さない。
//
// TAP_FIX_BODY はブラウザで eval する素の JS（テストから直接 eval して window.term をモックし
// 「通常 shell は非介入/clean tap は press→release/スワイプは wheel を撃つ」を検証する）。
// 本番注入は TAP_FIX_SCRIPT（<script> でラップ）を使う。
export const TAP_FIX_BODY = `(function(){
  function install(){
    var t=window.term;
    if(!t||typeof t.cols!=='number'){return false;}
    if(t.__apolloTapFix){return true;}
    // スクロール要素は .xterm-viewport（overflow-y:scroll）。ここに張ってネイティブ pan を温存する。
    // 座標→cell 換算には .xterm-screen の rect を使う（viewport は screen を覆い座標は一致）。
    var view=null, screen=null;
    try{
      if(t.element&&t.element.querySelector){
        view=t.element.querySelector('.xterm-viewport');
        screen=t.element.querySelector('.xterm-screen');
      }
    }catch(_e){}
    var rectEl=screen||view||t.element;        // 座標換算の基準（screen 優先）
    var listenEl=view||screen||t.element;      // リスナを張る対象（スクロール要素 viewport 優先）
    if(!rectEl||!listenEl){return false;}
    t.__apolloTapFix=true;
    // ネイティブのスクロール（縦横 pan）を常に許可する。clean tap だけ JS 側で横取りする。
    try{listenEl.style.touchAction='pan-x pan-y';}catch(_e){}
    // mouse reporting が有効か（claude のメニュー等は有効化する）。内部 API はガード。
    function mouseActive(){
      try{
        var c=t._core&&t._core.coreMouseService;
        return !!(c&&c.areMouseEventsActive);
      }catch(_e){return false;}
    }
    // タップ座標を 0-indexed の col/row に換算（公開 getter + rect のみ使用）。
    function toCell(clientX,clientY){
      var r=rectEl.getBoundingClientRect();
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
    // wheel イベントを n 回撃つ。button:4 が xterm の wheel エンコード（up=action:0→SGR 64、
    // down=action:1→SGR 65）＝PC マウスホイールと同一の出力。mouse mode の TUI がこれを受けて
    // 履歴をスクロールする。n は暴走防止のため呼び出し側でクランプ済み。
    function sendWheel(cell,up,n){
      try{
        var c=t._core.coreMouseService;
        var action=up?0:1;
        for(var i=0;i<n;i++){
          c.triggerMouseEvent({col:cell.col,row:cell.row,x:cell.col+1,y:cell.row+1,button:4,action:action,ctrl:false,alt:false,shift:false});
        }
        return true;
      }catch(_e){return false;}
    }
    var MOVE_THRESHOLD=10; // px。これ未満はタップ、超えたらスワイプ。
    var TAP_MAX_MS=700;    // ms。これ超は長押し扱いでタップにしない。
    var sx=0,sy=0,lastY=0,st=0,moved=false,scrolled=false,tracking=false;
    listenEl.addEventListener('touchstart',function(e){
      if(!mouseActive()){tracking=false;return;} // 通常 shell では一切介入しない（ネイティブスクロール温存）
      if(e.touches.length!==1){tracking=false;return;} // マルチタッチ（ズーム等）は無視
      tracking=true;moved=false;scrolled=false;
      var tt=e.touches[0];sx=tt.clientX;sy=tt.clientY;lastY=tt.clientY;st=Date.now();
    },{passive:true});
    listenEl.addEventListener('touchmove',function(e){
      if(!tracking){return;}
      var tt=e.touches[0];
      if(!tt){return;}
      if(Math.abs(tt.clientX-sx)>MOVE_THRESHOLD||Math.abs(tt.clientY-sy)>MOVE_THRESHOLD){moved=true;}
      if(!moved){return;}
      // mouse mode 中のスワイプ＝TUI へ wheel を送って漸進スクロール。1 行分動くごとに wheel 1 発。
      // （mouse mode 中は xterm ネイティブの touch スクロールがガードで不発なので、ここで送らないと
      //   何もスクロールしない＝MC-105 の回帰の本体。）
      var cell=toCell(tt.clientX,tt.clientY);
      if(!cell){return;}
      var r=rectEl.getBoundingClientRect();
      var ch=(t.rows&&r.height>0)?r.height/t.rows:0;
      if(ch<=0){return;}
      var dy=tt.clientY-lastY;
      var steps=Math.floor(Math.abs(dy)/ch);
      if(steps>0){
        var up=dy>0; // 指を下へ（dy>0）＝過去（上）を見る＝wheel up。指を上へ＝wheel down。
        sendWheel(cell,up,steps>10?10:steps);
        lastY=lastY+(up?steps*ch:-steps*ch);
        scrolled=true;
      }
      // mouse mode 中はネイティブ介入が無いので、ページスクロール等への漏れを防ぐため抑止する。
      if(typeof e.preventDefault==='function'&&e.cancelable!==false){e.preventDefault();}
    },{passive:false});
    listenEl.addEventListener('touchend',function(e){
      if(!tracking){return;}
      tracking=false;
      if(!mouseActive()){return;}
      // スワイプ（スクロール済 or 移動量超）・長押しはタップ扱いしない。
      if(moved||scrolled||(Date.now()-st)>TAP_MAX_MS){
        // スクロールしたなら末尾の合成 click を抑止（mouse mode 時のみ）。
        if(scrolled&&typeof e.preventDefault==='function'){e.preventDefault();}
        return;
      }
      var tt=(e.changedTouches&&e.changedTouches[0])||null;
      if(!tt){return;}
      var cell=toCell(tt.clientX,tt.clientY);
      if(!cell){return;}
      if(sendTap(cell)){
        // ブラウザの合成 mousedown/click による二重送出を防ぐ（mouse mode の clean tap 時のみ）。
        if(typeof e.preventDefault==='function'){e.preventDefault();}
      }
    },{passive:false});
    // PostMessage-based scroll from Apollo parent (Terminal.tsx) — avoids copy-mode entirely.
    // The parent sends {type:'apollo-scroll', direction:'up'|'down', steps:N} via postMessage.
    window.addEventListener('message',function(evt){
      if(!evt.data||evt.data.type!=='apollo-scroll'){return;}
      var up=(evt.data.direction==='up');
      var steps=(typeof evt.data.steps==='number'&&evt.data.steps>0)?Math.min(evt.data.steps,20):3;
      var cell={col:0,row:0};
      if(mouseActive()){
        sendWheel(cell,up,steps);
      } else {
        try{if(typeof t.scrollLines==='function'){t.scrollLines(up?-steps:steps);}}catch(_e){}
      }
    });
    return true;
  }
  if(!install()){
    var n=0,iv=setInterval(function(){if(install()||++n>100){clearInterval(iv);}},100);
  }
})();`;
const TAP_FIX_SCRIPT = `<script>${TAP_FIX_BODY}</script>`;

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
 * /terminal の HTTP リクエストを ttyd へ中継する Express ハンドラ（3ターミナル対応 MC-119）。
 * index.ts で makeAuthMiddleware の後ろにマウントするので、ここに来る時点で認証済み。
 * ttyd はルート配信なので、/terminal プレフィックス（mount で剥離済み）と、ターミナル番号
 * のサブプレフィックス（/2 /3）を resolveByRelPath で剥がし、対応 ttyd ポートへ振り分ける。
 */
export function terminalHttpHandler(req: Request, res: Response, next: NextFunction): void {
  // express の req.url は mount 後プレフィックスが剥がれる（app.use('/terminal', ...) 前提）。
  void next; // next は使わないが Express ハンドラ signature 維持
  const { target, ttydPath } = resolveByRelPath(req.url ?? '/');
  // ターミナル番号サブプレフィックスを剥がした path を ttyd（root 配信）へ渡す。
  req.url = ttydPath;
  proxy.web(req, res, { target });
}

/**
 * http.Server の 'upgrade' イベントに登録する WS ハンドラを返す。
 * /terminal 配下の WS のみ処理し、それ以外（既存 SSE は HTTP なので upgrade に来ない）は素通り。
 * 認証は isRequestAuthorized() で必ず通す（Express ミドルウェアが走らない経路のため）。
 */
export function attachUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = req.url ?? '';
  // WS は upgrade 経路で mount が走らないため、完全 URL（/terminal... or /terminal/2...）が来る。
  if (url !== TERMINAL_PREFIX && !url.startsWith(TERMINAL_PREFIX + '/')) return false; // /terminal 以外は扱わない

  // 最重要: WS upgrade でも token/Cookie/Bearer を検証。未認証は即切断。
  if (!isRequestAuthorized({ headers: req.headers, url })) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }

  // /terminal プレフィックスを剥がした相対パスから、ターミナル番号（/2 /3）を判定して
  // 対応 ttyd ポートへ振り分ける。HTTP 経路と同じ resolveByRelPath を再利用する。
  const relPath = url.slice(TERMINAL_PREFIX.length) || '/';
  const { target, ttydPath } = resolveByRelPath(relPath);
  req.url = ttydPath;
  proxy.ws(req, socket, head, { target });
  return true;
}
