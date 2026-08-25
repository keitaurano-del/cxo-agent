// MC-IME 実ブラウザ検証（Playwright chromium・hasTouch/isMobile）
//
// 実行: node server/src/terminalProxy.imefix.browser-verify.mjs （cxo-agent ルートの node_modules を使う）
//   または server/ 配下で: node src/terminalProxy.imefix.browser-verify.mjs
//
// 本番 mission-control.service / ttyd / ポート 4317・7681-7686 には一切触らない。ephemeral な
// http サーバへ、ttyd 1.7.4 同梱 xterm.js 4.x の CompositionHelper を「実バンドルから抜き出した
// ロジックを忠実に再現した最小 term モック」とともに出し、terminalProxy.ts から正規表現で抜いた
// 実 IME_FIX_BODY を注入して real chromium 上で挙動を確認する。
//
// 検証設計:
//   - CompositionHelper は xterm 4.x の実コード（compositionstart/update/end/_finalizeComposition）を
//     そのまま JS で再現。textarea を確定後にクリアしない＝累積オフセットで送る本物の弱点を持つ。
//   - 全角（）の IME シーケンス（compositionend が古い end のまま確定→残留が積み上がる）を合成し、
//     「（）を打った後の後続文字が PTY に届かなくなる」desync を **fix 無し** で再現する（できたら PASS）。
//   - 同じシーケンスを **fix あり**（IME_FIX_BODY 注入）で流し、後続文字が正しく PTY に届くことを確認。
//   - 通常のかな漢字変換（あ→亜 等）の確定文字は fix あり/なしどちらでも正しく送られる＝非退行。
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'terminalProxy.ts'), 'utf8');
const m = src.match(/export const IME_FIX_BODY = `([\s\S]*?)`;\nconst IME_FIX_SCRIPT/);
if (!m) {
  console.error('IME_FIX_BODY を抽出できなかった');
  process.exit(1);
}
const imeBody = m[1];

// xterm.js 4.x の CompositionHelper を実バンドルから忠実に再現した最小端末。
// triggerDataEvent に来た文字列を window.__sent に貯める＝PTY へ届いた入力そのもの。
const termHarness = `
  window.__sent=[];
  function makeTerm(){
    var ta=document.querySelector('.xterm-helper-textarea');
    var core={triggerDataEvent:function(data,wasUserInput){ if(data){ window.__sent.push(data); } }};
    var C0={DEL:String.fromCharCode(127)};
    // ── xterm 4.x CompositionHelper 忠実再現（実バンドルより）──
    var ch={
      _textarea:ta,_coreService:core,
      _isComposing:false,_isSendingComposition:false,
      _compositionPosition:{start:0,end:0},_dataAlreadySent:'',
      _compositionView:{textContent:'',classList:{add:function(){},remove:function(){}}},
      compositionstart:function(){
        this._isComposing=true;
        this._compositionPosition.start=this._textarea.value.length;
        this._compositionView.textContent='';
        this._dataAlreadySent='';
      },
      compositionupdate:function(e){
        this._compositionView.textContent=e.data;
        var self=this;
        setTimeout(function(){ self._compositionPosition.end=self._textarea.value.length; },0);
      },
      compositionend:function(){ this._finalizeComposition(true); },
      // 実 xterm の keydown ハンドラ相当（keyCode 229 = IME 変換中／確定の合図）。
      // 非変換中の 229 は _handleAnyTextareaChanges を呼ぶ（実バンドルどおり）。
      keydown:function(e){
        if(this._isComposing||this._isSendingComposition){
          if(e.keyCode===229){ return false; }
          if(e.keyCode===16||e.keyCode===17||e.keyCode===18){ return false; }
          this._finalizeComposition(false);
        }
        if(e.keyCode!==229){ return true; }
        this._handleAnyTextareaChanges();
        return false;
      },
      // 実バンドル _handleAnyTextareaChanges の忠実再現。前回 value 'e' を新 value 't' から
      // naive replace で差分抽出し _dataAlreadySent に入れる。括弧内側 splice では 'e' が 't' 内で
      // 連続しなくなり replace が効かず i=t 全体になる＝_dataAlreadySent が肥大し、次の
      // _finalizeComposition の pos.start += _dataAlreadySent.length で substring が空を返す（入力消失）。
      _handleAnyTextareaChanges:function(){
        var e=this._textarea.value;
        var self=this;
        setTimeout(function(){
          if(!self._isComposing){
            var t=self._textarea.value, i=t.replace(e,'');
            self._dataAlreadySent=i;
            if(t.length>e.length){ self._coreService.triggerDataEvent(i,true); }
            else if(t.length<e.length){ self._coreService.triggerDataEvent(C0.DEL,true); }
            else if(t.length===e.length&&t!==e){ self._coreService.triggerDataEvent(t,true); }
          }
        },0);
      },
      _finalizeComposition:function(isComp){
        this._isComposing=false;
        if(isComp){
          var pos={start:this._compositionPosition.start,end:this._compositionPosition.end};
          this._isSendingComposition=true;
          var self=this;
          setTimeout(function(){
            if(self._isSendingComposition){
              self._isSendingComposition=false;
              pos.start+=self._dataAlreadySent.length;
              var t=self._isComposing
                ? self._textarea.value.substring(pos.start,pos.end)
                : self._textarea.value.substring(pos.start);
              if(t.length>0){ self._coreService.triggerDataEvent(t,true); }
            }
          },0);
        }
      }
    };
    // 実 xterm は textarea の compositionstart/update/end DOM イベントを CompositionHelper に配線する。
    ta.addEventListener('compositionstart',function(){ ch.compositionstart(); });
    ta.addEventListener('compositionupdate',function(e){ ch.compositionupdate(e); });
    ta.addEventListener('compositionend',function(){ ch.compositionend(); });
    var el=document.getElementById('xterm');
    return {
      textarea:ta, element:el, cols:80, rows:24,
      _core:{ _compositionHelper:ch },
      focus:function(){ try{ ta.focus(); }catch(_e){} }
    };
  }
`;

// 全角（）の IME シーケンスを合成する。実機の日本語 IME（iOS 等）はオートペアで「（」を打つと
// 「（）」を挿入しキャレットを **ペアの内側** に戻す。この結果:
//   - textarea.value には「（）」が入るが、次に打つ文字はペアの **内側（中間）に splice** される
//     （末尾追記ではない）＝ ta.value = '（' + 次の文字 + '）' のように育つ。
//   - xterm は確定後に textarea をクリアしないので、次の compositionstart の
//     _compositionPosition.start = value.length は「（）」ぶんズレた位置を指す。
//   - substring(start,...) は挿入された実文字（内側）を取りこぼす＝後続入力が PTY に届かなくなる。
// さらに compositionupdate の end 更新は setTimeout(0) 予約なので、update 無しで即 compositionend が
// 来る括弧確定では end が前回値のまま取り残される（start>end→substring 空）。両者を合成して再現する。
const scenario = `
  window.__run=function(){
    var ta=document.querySelector('.xterm-helper-textarea');
    var ch=window.term._core._compositionHelper;
    // 括弧内側キャレット位置（splice 挿入点）。全角（）確定後はここに次文字が入る。
    var caret=0;
    function fire(type,data){
      var ev;
      try{ ev=new CompositionEvent(type,{data:data==null?'':data,bubbles:true,cancelable:true}); }
      catch(_e){ ev=new Event(type,{bubbles:true}); ev.data=data; }
      ta.dispatchEvent(ev);
    }
    function spliceAt(data){
      // キャレット位置に data を挿入する（実 IME のカーソル位置挿入）。
      ta.value=ta.value.slice(0,caret)+data+ta.value.slice(caret);
      caret+=data.length;
    }
    // 実機の入力ステップを1つずつ Promise チェーンで進める（setTimeout(0) の送信/クリアを間に挟む）。
    function tick(){ return new Promise(function(r){ setTimeout(r,0); }); }
    return (async function(){
      // 1) 全角（）をオートペア確定。キャレットはペア内側（index 1）に戻る。
      ch.keydown({keyCode:229});                 // IME: _handleAnyTextareaChanges 予約（prev value を記録）
      fire('compositionstart',null);
      ta.value=ta.value.slice(0,caret)+'（）'+ta.value.slice(caret);
      caret+=1;                                  // ← ペア内側にキャレット
      fire('compositionend','（）');
      await tick(); await tick();
      // 2) 続けて「あ」をかな漢字変換で確定。ペア内側に splice される（連続でなくなる）。
      ch.keydown({keyCode:229});                 // ← ここで prev='（）' を記録。以降 replace が効かず desync
      spliceAt('あ');
      fire('compositionstart','あ');
      fire('compositionupdate',{data:'あ'});
      fire('compositionend','あ');
      await tick(); await tick();
      // 3) さらに「い」を確定（後続入力が生きているかの決め手）。
      ch.keydown({keyCode:229});
      spliceAt('い');
      fire('compositionstart','い');
      fire('compositionupdate',{data:'い'});
      fire('compositionend','い');
      await tick(); await tick(); await tick();
      return { sent:window.__sent.slice(), residual:ta.value };
    })();
  };
`;

function pageHtml(withFix) {
  return `<!doctype html><html><body style="margin:0">
<div id="xterm" class="xterm" style="position:relative;width:800px;height:432px">
  <div class="xterm-screen" style="position:absolute;inset:0"></div>
  <textarea class="xterm-helper-textarea" style="position:absolute;opacity:0"></textarea>
</div>
<script>${termHarness}</script>
<script>window.term=makeTerm();</script>
${withFix ? `<script>${imeBody}</script>` : ''}
<script>${scenario}</script>
</body></html>`;
}

async function runScenario(page, withFix, port) {
  await page.goto(`http://127.0.0.1:${port}/${withFix ? 'fix' : 'nofix'}`);
  return page.evaluate(() => window.__run());
}

async function main() {
  const server = http.createServer((req, res) => {
    const withFix = req.url && req.url.startsWith('/fix');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pageHtml(withFix));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch();
  // モバイル相当（iPhone に近い viewport + hasTouch）。IME 合成はイベント dispatch で行う。
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 700 } });
  const page = await context.newPage();

  const noFix = await runScenario(page, false, port);
  const fix = await runScenario(page, true, port);

  const joinedFix = fix.sent.join('');

  let pass = 0;
  let fail = 0;
  const ok = (n, c) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.error('  FAIL ' + n)); };

  // 期待する正しい送信列: 全角（）→ あ → い が1つずつクリーンに届く。
  const EXPECT = JSON.stringify(['（）', 'あ', 'い']);

  console.log('--- fix 無し（バグ再現）---');
  console.log('  sent=', JSON.stringify(noFix.sent), 'residual=', JSON.stringify(noFix.residual));
  // 再現の核心: fix 無しでは（）確定後、確定のたび textarea 累積全体が naive replace 失敗で
  //   再送され、後続入力が「あ」「い」ではなく「（あ）」「（あい）」という壊れた累積列で届く。
  ok('fix 無し: 送信列が壊れている（クリーンな [（）,あ,い] ではない = desync 再現）',
    JSON.stringify(noFix.sent) !== EXPECT);
  ok('fix 無し: 括弧の累積が後続に混入している（例「（あ）」等が送られる）',
    noFix.sent.slice(1).some((s) => s.indexOf('（') >= 0 || s.indexOf('）') >= 0));
  ok('fix 無し: textarea に残留が積み上がっている（クリアされない）', noFix.residual.length > 0);

  console.log('--- fix あり ---');
  console.log('  sent=', JSON.stringify(fix.sent), 'residual=', JSON.stringify(fix.residual));
  ok('fix あり: 送信列がクリーン（[（）,あ,い] と完全一致）', JSON.stringify(fix.sent) === EXPECT);
  ok('fix あり: 全角（）自体も届く（確定文字を奪っていない）', joinedFix.indexOf('（）') >= 0);
  ok('fix あり: 後続「あ」「い」が単体でクリーンに届く（括弧の混入なし）',
    fix.sent.slice(1).every((s) => s.indexOf('（') < 0 && s.indexOf('）') < 0));
  ok('fix あり: 確定のたび textarea 残留がクリアされる（恒久 desync を根絶）', fix.residual === '');

  await browser.close();
  server.close();
  console.log(`\nime browser-verify: ${pass}/${pass + fail} passed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
