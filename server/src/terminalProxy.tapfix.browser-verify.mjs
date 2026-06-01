// MC-105 実ブラウザ検証（Playwright chromium・hasTouch）
//
// 実行: node src/terminalProxy.tapfix.browser-verify.mjs （server/ 配下で、cxo-agent ルートの node_modules を使う）
//   実際の cxo-agent ルートで: node server/src/terminalProxy.tapfix.browser-verify.mjs
//
// 本番 apollo.service / ttyd / ポート 4317 には一切触らない。ephemeral な http サーバへ最小の
// .xterm DOM ツリーを出し、terminalProxy.ts から抜き出した実 TAP_FIX_BODY を <body> に注入して
// real browser engine 上で挙動を確認する。jsdom 単体テスト（terminalProxy.tapfix.test.ts）の
// 実ブラウザ裏取り版。
//
// 合成 touch は CDP / touchscreen.tap だと headless で listener に届かないことがあるため、
// ページ内で実 TouchEvent を構築して dispatch する（ブラウザが実際に listener へ渡す型と同型）。
//
// 検証項目（MC-105 DoD）:
//   - 監視要素 .xterm-viewport に touch-action:pan-x pan-y が付く（通常 shell のネイティブ pan 温存）
//   - clean tap: coreMouseService.triggerMouseEvent が press(1)→release(0)・col/row 換算正・preventDefault
//   - mouse mode のスワイプ（>10px）: wheel イベント（button:4＝SGR 64/65）を撃つ＝TUI へホイールが届く
//   - mouseActive=false（通常 shell）: tap でも swipe でも一切介入しない（ネイティブスクロール温存）
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'terminalProxy.ts'), 'utf8');
const m = src.match(/export const TAP_FIX_BODY = `([\s\S]*?)`;\nconst TAP_FIX_SCRIPT/);
if (!m) {
  console.error('TAP_FIX_BODY を抽出できなかった');
  process.exit(1);
}
const tapBody = m[1];

const html = `<!doctype html><html><body style="margin:0">
<div id="xterm" class="xterm" style="position:relative;width:800px;height:432px">
  <div class="xterm-viewport" style="position:absolute;inset:0;overflow-y:scroll"></div>
  <div class="xterm-screen" style="position:absolute;inset:0"></div>
</div>
<script>
  window.__mouseEvents=[];window.__mouseActive=true;
  window.term={cols:80,rows:24,element:document.getElementById('xterm'),
    _core:{coreMouseService:{get areMouseEventsActive(){return window.__mouseActive;},
      triggerMouseEvent:function(ev){window.__mouseEvents.push({action:ev.action,col:ev.col,row:ev.row,button:ev.button});}}}};
  // 実 TouchEvent を構築して listener に渡す（80x24・各セル 10x18px）。
  window.__fire=function(el,type,x,y){
    var t=new Touch({identifier:1,target:el,clientX:x,clientY:y});
    var ev=new TouchEvent(type,{cancelable:true,bubbles:true,
      touches:type==='touchend'?[]:[t],changedTouches:[t]});
    el.dispatchEvent(ev);return ev.defaultPrevented;
  };
</script>
<script>${tapBody}</script>
<script>
  window.__results=function(){
    var vp=document.querySelector('.xterm-viewport');
    // (1) mouse mode の clean tap
    window.__mouseEvents=[];window.__mouseActive=true;
    window.__fire(vp,'touchstart',155,99);
    var pdTap=window.__fire(vp,'touchend',155,99);
    var tapEv=window.__mouseEvents.slice();
    // (2) mouse mode の下方向スワイプ（指を下へ＝過去へ＝wheel up）。ch=18px、101px=5行分。
    window.__mouseEvents=[];
    window.__fire(vp,'touchstart',155,99);
    var pdMove=window.__fire(vp,'touchmove',155,200);
    var pdSwipe=window.__fire(vp,'touchend',155,200);
    var swEv=window.__mouseEvents.slice();
    // (3) 通常 shell（mouseActive=false）: tap でも swipe でも非介入
    window.__mouseEvents=[];window.__mouseActive=false;
    window.__fire(vp,'touchstart',155,99);
    var pdOff=window.__fire(vp,'touchend',155,99);
    var offEv=window.__mouseEvents.slice();
    window.__mouseEvents=[];
    window.__fire(vp,'touchstart',155,99);
    var pdOffMove=window.__fire(vp,'touchmove',155,200);
    var pdOffSwipe=window.__fire(vp,'touchend',155,200);
    var offSwEv=window.__mouseEvents.slice();
    return {ta:vp.style.touchAction,tapEv:tapEv,pdTap:pdTap,
      swEv:swEv,pdMove:pdMove,pdSwipe:pdSwipe,
      offEv:offEv,pdOff:pdOff,offSwEv:offSwEv,pdOffMove:pdOffMove,pdOffSwipe:pdOffSwipe};
  };
</script></body></html>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 700 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const res = await page.evaluate(() => window.__results());

  let pass = 0;
  let fail = 0;
  const ok = (n, c) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.error('  FAIL ' + n)); };
  ok('viewport に touch-action:pan-x pan-y（通常 shell のネイティブスクロール温存）', res.ta === 'pan-x pan-y');
  ok('clean tap で press→release が撃たれる', res.tapEv.length === 2 && res.tapEv[0].action === 1 && res.tapEv[1].action === 0 && res.tapEv[0].button === 0);
  ok('clean tap の col/row 換算が正しい（col15/row5）', res.tapEv[0] && res.tapEv[0].col === 15 && res.tapEv[0].row === 5);
  ok('clean tap の touchend が preventDefault される', res.pdTap === true);
  ok('mouse mode の下方向スワイプで wheel up（button:4 action:0）が撃たれる', res.swEv.length >= 1 && res.swEv.every((m) => m.button === 4 && m.action === 0));
  ok('mouse mode のスワイプ touchmove は preventDefault される（ページ漏れ防止）', res.pdMove === true);
  ok('通常 shell（mouseActive=false）の clean tap で mouse event を撃たない', res.offEv.length === 0);
  ok('通常 shell の clean tap touchend は preventDefault しない', res.pdOff === false);
  ok('通常 shell のスワイプで mouse event を撃たない（ネイティブスクロール温存）', res.offSwEv.length === 0);
  ok('通常 shell のスワイプ touchmove/touchend は preventDefault しない', res.pdOffMove === false && res.pdOffSwipe === false);

  await browser.close();
  server.close();
  console.log(`\nbrowser-verify: ${pass}/${pass + fail} passed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
