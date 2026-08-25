// スクロールでソフトキーボードが出る問題の実ブラウザ検証（Playwright chromium・hasTouch/isMobile）
//
// 実行: cxo-agent ルートで node server/src/terminalProxy.scrollkbdfix.browser-verify.mjs
//   （server/ 配下の場合: node src/terminalProxy.scrollkbdfix.browser-verify.mjs）
//
// 本番 mission-control.service / ttyd / ポート 4317 には一切触らない。ephemeral な http サーバへ
// 最小の .xterm DOM（.xterm-helper-textarea を含む）を出し、terminalProxy.ts から抜き出した実
// SCROLL_KBD_FIX_BODY を <body> に注入して real browser engine 上で挙動を確認する。
//
// 検証項目:
//   - clean tap（移動なし・短時間）→ helper textarea が focus できる（＝キーボードが出せる＝入力退行なし）
//   - スワイプ（touchmove で >10px 移動）直後の合成 click は preventDefault + focus されない
//   - スワイプ直後に helper textarea へ来た合成 focus は即 blur される（キーボードが出ない）
//   - 長押し（TAP_MAX_MS 超）直後の合成 click も抑止される
//   - 抑止ウィンドウ（700ms）経過後は通常どおり focus できる（恒久ロックしない）
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'terminalProxy.ts'), 'utf8');
const m = src.match(/export const SCROLL_KBD_FIX_BODY = `([\s\S]*?)`;\nconst SCROLL_KBD_FIX_SCRIPT/);
if (!m) {
  console.error('SCROLL_KBD_FIX_BODY を抽出できなかった');
  process.exit(1);
}
const body = m[1];

const html = `<!doctype html><html><body style="margin:0">
<div id="xterm" class="xterm" style="position:relative;width:800px;height:432px">
  <div class="xterm-viewport" style="position:absolute;inset:0;overflow-y:scroll"></div>
  <div class="xterm-screen" style="position:absolute;inset:0"></div>
  <textarea class="xterm-helper-textarea" style="position:absolute;left:0;top:0;opacity:0"></textarea>
</div>
<script>
  // 実 TouchEvent を構築して listener に渡す（headless で CDP touch が届かないため）。
  window.__fire=function(el,type,x,y){
    var t=new Touch({identifier:1,target:el,clientX:x,clientY:y});
    var ev=new TouchEvent(type,{cancelable:true,bubbles:true,
      touches:type==='touchend'?[]:[t],changedTouches:[t]});
    el.dispatchEvent(ev);return ev.defaultPrevented;
  };
  // 合成 click を実際に dispatch し、xterm 相当の「click → helper textarea.focus()」を再現する。
  window.__ta=document.querySelector('.xterm-helper-textarea');
  window.__vp=document.querySelector('.xterm-viewport');
  // xterm の実挙動を模す: viewport への click で helper textarea を focus する。
  window.__vp.addEventListener('click',function(){ try{window.__ta.focus();}catch(_e){} });
  window.__clickFocus=function(){
    var ev=new MouseEvent('click',{cancelable:true,bubbles:true});
    var pd=!window.__vp.dispatchEvent(ev);
    return {pd:pd,focused:document.activeElement===window.__ta};
  };
  window.__blur=function(){ try{window.__ta.blur();}catch(_e){} };
  window.__sleep=function(ms){return new Promise(function(r){setTimeout(r,ms);});};
</script>
<script>${body}</script>
</body></html>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 700 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);

  // (1) clean tap（移動なし）→ 合成 click で focus できる（入力退行なし）
  const cleanTap = await page.evaluate(async () => {
    window.__blur();
    window.__fire(window.__vp, 'touchstart', 155, 99);
    window.__fire(window.__vp, 'touchend', 155, 99);
    return window.__clickFocus(); // 合成 click は clean tap 由来 → 抑止されず focus される
  });

  // (2) スワイプ（>10px 移動）→ 直後の合成 click は抑止され focus されない
  const swipe = await page.evaluate(async () => {
    window.__blur();
    window.__fire(window.__vp, 'touchstart', 155, 99);
    window.__fire(window.__vp, 'touchmove', 155, 220); // 121px 移動＝スワイプ
    window.__fire(window.__vp, 'touchend', 155, 220);
    return window.__clickFocus(); // ジェスチャ直後の合成 click → 抑止（pd=true, focused=false）
  });

  // (3) スワイプ直後に helper textarea へ直接来た合成 focus は即 blur される
  const swipeFocus = await page.evaluate(async () => {
    window.__blur();
    window.__fire(window.__vp, 'touchstart', 155, 99);
    window.__fire(window.__vp, 'touchmove', 155, 220);
    window.__fire(window.__vp, 'touchend', 155, 220);
    try { window.__ta.focus(); } catch (_e) {}
    // focusin ハンドラが同期的に blur するので、直後の activeElement は textarea でない。
    return { focused: document.activeElement === window.__ta };
  });

  // (4) 長押し（TAP_MAX_MS=700ms 超）→ 合成 click 抑止
  const longPress = await page.evaluate(async () => {
    window.__blur();
    window.__fire(window.__vp, 'touchstart', 155, 99);
    await window.__sleep(760); // 移動なしだが長押し
    window.__fire(window.__vp, 'touchend', 155, 99);
    return window.__clickFocus();
  });

  // (5) スワイプ後、抑止ウィンドウ（700ms）経過後は通常どおり focus できる（恒久ロックしない）
  const afterWindow = await page.evaluate(async () => {
    window.__blur();
    window.__fire(window.__vp, 'touchstart', 155, 99);
    window.__fire(window.__vp, 'touchmove', 155, 220);
    window.__fire(window.__vp, 'touchend', 155, 220);
    await window.__sleep(760); // 抑止ウィンドウ経過
    return window.__clickFocus();
  });

  let pass = 0;
  let fail = 0;
  const ok = (n, c) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.error('  FAIL ' + n)); };
  ok('clean tap の合成 click で helper textarea が focus できる（入力退行なし）', cleanTap.pd === false && cleanTap.focused === true);
  ok('スワイプ直後の合成 click は preventDefault され focus されない', swipe.pd === true && swipe.focused === false);
  ok('スワイプ直後に helper textarea へ来た合成 focus は即 blur される', swipeFocus.focused === false);
  ok('長押し（>700ms）直後の合成 click も抑止される', longPress.pd === true && longPress.focused === false);
  ok('抑止ウィンドウ経過後は通常どおり focus できる（恒久ロックしない）', afterWindow.pd === false && afterWindow.focused === true);

  await browser.close();
  server.close();
  console.log(`\nscrollkbdfix browser-verify: ${pass}/${pass + fail} passed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
