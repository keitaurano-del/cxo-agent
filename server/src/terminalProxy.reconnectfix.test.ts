// RECONNECT_FIX_BODY 単体テスト（2026-09-05 Keita「reconnectのやつでないようにならないの？」）
//
// vitest 等は未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/terminalProxy.reconnectfix.test.ts （server/ 配下で）
//
// RECONNECT_FIX_BODY はブラウザに文字列で注入する素の JS。ttyd 1.7.4 が WS 正常クローズ
// （code=1000＝子プロセス tmux attach 終了）時に overlay へ出す "Press ⏎ to Reconnect" を検知し、
// helper textarea へ合成 Enter keydown を送って ttyd が登録した terminal.onKey を叩き自動再接続する。
// jsdom も未導入なので必要最小の DOM/term モックを手で組み、new Function で eval して検証する。
//
// 主眼:
//   1) "Press ⏎ to Reconnect" 表示中は Enter を送る（自動再接続）。
//   2) "Reconnecting…"（進行中）や overlay 無しでは送らない（進行中を壊さない・誤爆しない）。
//   3) 2.5s スロットル: 直近発火から間もない再 tick では二重送出しない。
//   4) 連続失敗キャップ: overlay が出続ける（tmux セッション自体が死んでいる等）と 6 回で自動 Enter を止める。

import assert from 'node:assert';
import { RECONNECT_FIX_BODY } from './terminalProxy.ts';

type Harness = {
  tick: () => void;
  fired: () => number;
  setOverlay: (t: string) => void;
  setNow: (ms: number) => void;
};

function makeHarness(): Harness {
  let firedCount = 0;
  let overlayText = '';
  let now = 1_000_000;

  const ta = {
    tagName: 'TEXTAREA',
    focus() {},
    dispatchEvent(ev: { type: string; key: string }) {
      if (ev.type === 'keydown' && ev.key === 'Enter') firedCount++;
      return true;
    },
  };
  const overlayDiv = {
    get textContent() {
      return overlayText;
    },
  };
  const rootEl = {
    querySelectorAll(sel: string) {
      return sel === 'div' ? [overlayDiv] : [];
    },
  };

  let cb: (() => void) | null = null;
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { term: { textarea: ta, element: rootEl } };
  g.document = { querySelector: () => ta };
  g.KeyboardEvent = class {
    type: string;
    key?: string;
    constructor(type: string, opt: Record<string, unknown>) {
      this.type = type;
      Object.assign(this, opt);
    }
  };
  g.setInterval = (fn: () => void) => {
    cb = fn;
    return 1;
  };
  const RealDate = Date;
  g.Date = class extends RealDate {
    static now() {
      return now;
    }
  };

  // eslint-disable-next-line no-new-func
  new Function(RECONNECT_FIX_BODY)();
  assert.ok(cb, 'setInterval tick should be registered');

  return {
    tick: () => cb!(),
    fired: () => firedCount,
    setOverlay: (t: string) => {
      overlayText = t;
    },
    setNow: (ms: number) => {
      now = ms;
    },
  };
}

let pass = 0;
let total = 0;
function test(name: string, fn: () => void) {
  total++;
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
  }
}

test('Press ⏎ to Reconnect 表示中は Enter を送る', () => {
  const h = makeHarness();
  h.setOverlay('Press ⏎ to Reconnect');
  h.tick();
  assert.strictEqual(h.fired(), 1);
});

test('Reconnecting… 進行中は送らない', () => {
  const h = makeHarness();
  h.setOverlay('Reconnecting...');
  h.tick();
  assert.strictEqual(h.fired(), 0);
});

test('overlay 無しでは送らない', () => {
  const h = makeHarness();
  h.setOverlay('');
  h.tick();
  assert.strictEqual(h.fired(), 0);
});

test('2.5s スロットル: 直後の再 tick は二重送出しない', () => {
  const h = makeHarness();
  h.setNow(1_000_000);
  h.setOverlay('Press ⏎ to Reconnect');
  h.tick();
  assert.strictEqual(h.fired(), 1, '1回目は送る');
  h.setNow(1_000_000 + 1000); // 1s 後（<2.5s）
  h.tick();
  assert.strictEqual(h.fired(), 1, 'スロットル内は送らない');
  h.setNow(1_000_000 + 3000); // 3s 後（>2.5s）
  h.tick();
  assert.strictEqual(h.fired(), 2, 'スロットル明けで再送');
});

test('連続失敗キャップ: overlay が出続けると 6 回で止まる', () => {
  const h = makeHarness();
  h.setOverlay('Press ⏎ to Reconnect');
  let t = 1_000_000;
  for (let i = 0; i < 12; i++) {
    h.setNow(t);
    h.tick();
    t += 3000; // 毎回スロットル明け
  }
  assert.strictEqual(h.fired(), 6, '6回で自動 Enter を停止（無限 attach ループ防止）');
});

console.log(`\nterminalProxy RECONNECT_FIX: ${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
