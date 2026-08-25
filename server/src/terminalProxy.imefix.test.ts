// IME_FIX_BODY 単体テスト（MC-IME: モバイル日本語 IME で全角括弧（）等を打つと以降入力が壊れる）
//
// vitest 等は未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/terminalProxy.imefix.test.ts （server/ 配下で）
//
// IME_FIX_BODY はブラウザに文字列で注入する素の JS（.xterm-helper-textarea の compositionend を
// フックし、確定後に textarea 残留をクリア＋xterm の _compositionPosition を 0 リセットして
// 累積オフセット desync を根絶する）。jsdom も未導入なので、必要最小の DOM/term モックを手で組み、
// IME_FIX_BODY を new Function で eval してインストールさせ、compositionend を発火して挙動を検証する。
//
// 主眼:
//   1) compositionend 後（setTimeout 1段遅延）に helper textarea の残留がクリアされる。
//   2) 同時に window.term._core._compositionHelper._compositionPosition が {start:0,end:0} に戻る。
//   3) 走行中の composition（_isComposing=true）中は触らない＝確定中データを奪わない（非退行）。
//   4) 二重インストールしない（__apolloImeFix ガード）。
//   5) term.textarea が無くても .xterm-helper-textarea を DOM から拾える。

import assert from 'node:assert/strict';
import { IME_FIX_BODY } from './terminalProxy.js';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── 最小 DOM/term モック ─────────────────────────────────────────────────────
interface Listener {
  (): void;
}
interface FakeTextarea {
  tagName: string;
  value: string;
  _listeners: Record<string, Listener[]>;
  _attrs: Record<string, string>;
  _focused: number;
  addEventListener(type: string, fn: Listener): void;
  dispatch(type: string): void;
  focus(): void;
  getAttribute(k: string): string | null;
  setAttribute(k: string, v: string): void;
}

function makeTextarea(): FakeTextarea {
  return {
    tagName: 'TEXTAREA',
    value: '',
    _listeners: {},
    _attrs: {},
    _focused: 0,
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    },
    dispatch(type) {
      (this._listeners[type] || []).forEach((fn) => fn());
    },
    focus() {
      this._focused += 1;
    },
    getAttribute(k) {
      return k in this._attrs ? this._attrs[k] : null;
    },
    setAttribute(k, v) {
      this._attrs[k] = v;
    },
  };
}

interface CompHelper {
  _isComposing: boolean;
  _compositionPosition: { start: number; end: number };
  _dataAlreadySent: string;
}

/**
 * IME_FIX_BODY を eval してインストールする。setTimeout は queue に貯めて flush() で手動実行する
 * （fix は compositionend の1段後ろ setTimeout(0) でクリアするため、決定的に検証する）。
 */
function setup(opts: {
  textareaOnTerm: boolean; // term.textarea を持たせるか（false なら DOM 経由で拾う）
  isComposing?: boolean;
}): {
  ta: FakeTextarea;
  helper: CompHelper;
  flush: () => void;
  install: () => void;
} {
  const ta = makeTextarea();
  const helper: CompHelper = {
    _isComposing: opts.isComposing ?? false,
    _compositionPosition: { start: 5, end: 9 },
    _dataAlreadySent: 'xxx',
  };
  const term: Record<string, unknown> = {
    _core: { _compositionHelper: helper },
    element: {
      querySelector(sel: string) {
        return sel === '.xterm-helper-textarea' ? ta : null;
      },
    },
  };
  if (opts.textareaOnTerm) term.textarea = ta;

  const timers: Array<() => void> = [];
  const doc = {
    querySelector(sel: string) {
      return sel === '.xterm-helper-textarea' ? ta : null;
    },
  };
  const win = { term, document: doc } as Record<string, unknown>;
  const install = () => {
    const fn = new Function('window', 'document', 'setInterval', 'clearInterval', 'setTimeout', IME_FIX_BODY);
    fn(
      win,
      doc,
      () => 0,
      () => undefined,
      (cb: () => void) => {
        timers.push(cb);
        return 0;
      },
    );
  };
  const flush = () => {
    while (timers.length) {
      const cb = timers.shift()!;
      cb();
    }
  };
  return { ta, helper, flush, install };
}

// ── 1) compositionend 後に textarea 残留がクリアされ、オフセットが 0 に戻る ───────────
check('compositionend 後: helper textarea の残留をクリアし _compositionPosition を {0,0} に戻す', () => {
  const { ta, helper, flush, install } = setup({ textareaOnTerm: true });
  install();
  ta.value = '（あい）'; // desync 累積残留を模す
  ta.dispatch('compositionend');
  flush(); // fix の setTimeout(0) を実行
  assert.equal(ta.value, '', 'textarea 残留がクリアされる');
  assert.deepEqual(helper._compositionPosition, { start: 0, end: 0 }, 'オフセットが 0 リセット');
  assert.equal(helper._dataAlreadySent, '', '_dataAlreadySent もリセット');
  assert.ok(ta._focused > 0, 'クリア後にフォーカスを維持する');
});

// ── 2) 走行中 composition 中は触らない（確定中データを奪わない）─────────────────────
check('次の変換が走行中（_isComposing=true）なら textarea を触らない（非退行）', () => {
  const { ta, helper, flush, install } = setup({ textareaOnTerm: true });
  install();
  ta.value = 'あ';
  ta.dispatch('compositionend');
  helper._isComposing = true; // fix の setTimeout が走る時点で次の変換が既に開始
  flush();
  assert.equal(ta.value, 'あ', '走行中は残留クリアしない（データを奪わない）');
  assert.deepEqual(helper._compositionPosition, { start: 5, end: 9 }, 'オフセットも触らない');
});

// ── 3) 空 textarea では no-op（余計な書き込みをしない）──────────────────────────────
check('textarea が空なら value 代入を行わない（no-op ガード）', () => {
  const { ta, flush, install } = setup({ textareaOnTerm: true });
  install();
  ta.value = '';
  ta.dispatch('compositionend');
  flush();
  assert.equal(ta.value, '', '空のまま');
});

// ── 4) term.textarea が無くても DOM から helper textarea を拾える ───────────────────
check('term.textarea 不在でも .xterm-helper-textarea を DOM から拾ってフックする', () => {
  const { ta, flush, install } = setup({ textareaOnTerm: false });
  install();
  ta.value = '（）';
  ta.dispatch('compositionend');
  flush();
  assert.equal(ta.value, '', 'DOM 経由で拾った textarea もクリアされる');
});

// ── 5) 二重インストール防止 ────────────────────────────────────────────────────────
check('二重インストールしない（__apolloImeFix / data 属性ガード）', () => {
  const { ta, flush, install } = setup({ textareaOnTerm: true });
  install();
  install(); // 2 回目
  assert.equal((ta._listeners['compositionend'] || []).length, 1, 'リスナは1つだけ');
  ta.value = '（）';
  ta.dispatch('compositionend');
  flush();
  assert.equal(ta.value, '', '1度だけクリアされる（多重実行しない）');
  assert.equal(ta.getAttribute('data-apollo-ime-fix'), '1', 'data 属性で注入済みを記録');
});

const total = 5;
console.log(`\nterminalProxy IME_FIX: ${total - failures}/${total} passed`);
if (failures > 0) {
  process.exit(1);
}
