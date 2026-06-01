// TAP_FIX_BODY 回帰テスト（MC-105）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/terminalProxy.tapfix.test.ts （server/ 配下で）
//
// TAP_FIX_SCRIPT（MC-104）はブラウザに文字列で注入する素の JS。jsdom も未導入なので、
// xterm.js 相当の最小モック（window.term / .xterm-viewport / .xterm-screen / coreMouseService）を
// 手で組み、TAP_FIX_BODY を new Function で eval してインストールさせ、合成 touch イベントを
// 発火して挙動を検証する。
//
// 主眼（MC-105 の DoD）:
//   1) mouse mode のスワイプ（移動>10px）では wheel イベント（button:4＝SGR 64/65）が撃たれる
//      ＝TUI へホイールが届き履歴がスクロールする（回帰の本体を直す）。指を下へ＝wheel up、上へ＝down。
//   2) clean tap（移動なし・短時間）では sendTap 相当（triggerMouseEvent press→release、button:0）が
//      呼ばれ、その touchend だけ preventDefault される（合成 click 二重送出の抑止、MC-104 機能維持）。
//   3) mouseActive=false（通常 shell）では touchstart 以降一切介入しない（tap でも swipe でも
//      triggerMouseEvent を呼ばず preventDefault もしない）＝xterm ネイティブのタッチスクロールを温存。
//   4) リスナはスクロール要素 .xterm-viewport に張られ、監視要素に touch-action:pan-x pan-y が付く。

import assert from 'node:assert/strict';
import { TAP_FIX_BODY } from './terminalProxy.js';

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

// ── 最小 DOM 要素モック ──────────────────────────────────────────────
type Listener = (e: TouchLikeEvent) => void;
interface MockTouch {
  clientX: number;
  clientY: number;
}
interface TouchLikeEvent {
  type: string;
  touches: MockTouch[];
  changedTouches: MockTouch[];
  defaultPrevented: boolean;
  preventDefault: () => void;
}

class MockElement {
  className: string;
  style: { touchAction?: string } = {};
  listeners: Record<string, Listener[]> = {};
  rect: { left: number; top: number; width: number; height: number };
  constructor(className: string, rect: { left: number; top: number; width: number; height: number }) {
    this.className = className;
    this.rect = rect;
  }
  addEventListener(type: string, fn: Listener): void {
    (this.listeners[type] ??= []).push(fn);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect;
  }
  // 指定タイプのリスナを発火し、最終 event を返す（preventDefault 観測用）。
  fire(ev: Omit<TouchLikeEvent, 'preventDefault' | 'defaultPrevented'>): TouchLikeEvent {
    const e: TouchLikeEvent = {
      ...ev,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const fn of this.listeners[ev.type] ?? []) fn(e);
    return e;
  }
}

interface MockMouseService {
  areMouseEventsActive: boolean;
  events: Array<{ action: number; col: number; row: number; button: number }>;
}

// xterm.js 相当の最小 term モック + .xterm 要素ツリー。
function makeTerm(mouseActive: boolean): {
  term: Record<string, unknown>;
  viewport: MockElement;
  screen: MockElement;
  mouse: MockMouseService;
} {
  // viewport と screen は同じ矩形（viewport は screen を覆う）。80列×24行・各セル 10x18px。
  const rect = { left: 0, top: 0, width: 800, height: 432 };
  const viewport = new MockElement('xterm-viewport', rect);
  const screen = new MockElement('xterm-screen', rect);
  const mouse: MockMouseService = { areMouseEventsActive: mouseActive, events: [] };
  const element = {
    querySelector(sel: string): MockElement | null {
      if (sel === '.xterm-viewport') return viewport;
      if (sel === '.xterm-screen') return screen;
      return null;
    },
  };
  const term: Record<string, unknown> = {
    cols: 80,
    rows: 24,
    element,
    _core: {
      coreMouseService: {
        get areMouseEventsActive() {
          return mouse.areMouseEventsActive;
        },
        triggerMouseEvent(ev: { action: number; col: number; row: number; button: number }) {
          mouse.events.push({ action: ev.action, col: ev.col, row: ev.row, button: ev.button });
        },
      },
    },
  };
  return { term, viewport, screen, mouse };
}

// TAP_FIX_BODY を window.term 付きのスコープで eval してインストールする。
function install(term: Record<string, unknown>): void {
  const win = { term } as Record<string, unknown>;
  // setInterval は install() 即成功時には呼ばれない（戻り値 true）。保険で no-op を渡す。
  const fn = new Function('window', 'setInterval', 'clearInterval', TAP_FIX_BODY);
  fn(
    win,
    () => 0,
    () => undefined,
  );
}

function touchStart(el: MockElement, x: number, y: number): void {
  el.fire({ type: 'touchstart', touches: [{ clientX: x, clientY: y }], changedTouches: [] });
}
function touchMove(el: MockElement, x: number, y: number): void {
  el.fire({ type: 'touchmove', touches: [{ clientX: x, clientY: y }], changedTouches: [] });
}
function touchEnd(el: MockElement, x: number, y: number): TouchLikeEvent {
  return el.fire({ type: 'touchend', touches: [], changedTouches: [{ clientX: x, clientY: y }] });
}

// ── 1) リスナはスクロール要素 viewport に張られ、touch-action が付く ──────────────
check('リスナは .xterm-viewport に張られ touch-action:pan-x pan-y が付く（スクロール温存）', () => {
  const { term, viewport, screen } = makeTerm(true);
  install(term);
  assert.ok((viewport.listeners['touchstart']?.length ?? 0) >= 1, 'viewport に touchstart が張られる');
  assert.ok((viewport.listeners['touchend']?.length ?? 0) >= 1, 'viewport に touchend が張られる');
  assert.equal(screen.listeners['touchstart']?.length ?? 0, 0, 'screen には張らない（viewport 優先）');
  assert.equal(viewport.style.touchAction, 'pan-x pan-y', 'ネイティブ pan を温存する touch-action');
});

// ── 2) mouseActive=true の clean tap: sendTap が呼ばれ preventDefault される ─────────
check('mouse mode の clean tap: triggerMouseEvent press→release が呼ばれ touchend が preventDefault される', () => {
  const { term, viewport, mouse } = makeTerm(true);
  install(term);
  // セル(列=15,行=5) 付近を素早くタップ。cw=10,ch=18 なので clientX=155,clientY=99 → col=15,row=5。
  touchStart(viewport, 155, 99);
  const e = touchEnd(viewport, 155, 99);
  assert.equal(mouse.events.length, 2, 'press と release の 2 イベント');
  assert.deepEqual(
    mouse.events.map((m) => m.action),
    [1, 0],
    'action は press(1)→release(0)',
  );
  assert.equal(mouse.events[0].col, 15, 'col 換算');
  assert.equal(mouse.events[0].row, 5, 'row 換算');
  assert.equal(e.defaultPrevented, true, 'clean tap の touchend は preventDefault される');
});

// ── 3) mouseActive=true のスワイプ: wheel イベント（button:4）を撃つ＝TUI へホイールが届く ──
check('mouse mode の下方向スワイプ（>10px 移動）: wheel up（button:4 action:0）を撃ち TUI をスクロールさせる', () => {
  const { term, viewport, mouse } = makeTerm(true);
  install(term);
  // セル高 ch=18px。指を下へ 72px（=4 行分）動かす＝過去を見る＝wheel up を 4 発。
  touchStart(viewport, 155, 99);
  touchMove(viewport, 155, 171); // 下へ 72px 移動
  touchEnd(viewport, 155, 171);
  assert.ok(mouse.events.length >= 1, 'スワイプで wheel イベントが撃たれる');
  assert.ok(
    mouse.events.every((m) => m.button === 4),
    'wheel イベントの button は 4',
  );
  assert.ok(
    mouse.events.every((m) => m.action === 0),
    '下方向スワイプは wheel up（action:0）',
  );
  assert.equal(mouse.events.length, 4, '72px / 18px = 4 行分の wheel');
});

check('mouse mode の上方向スワイプ: wheel down（button:4 action:1）を撃つ', () => {
  const { term, viewport, mouse } = makeTerm(true);
  install(term);
  touchStart(viewport, 155, 200);
  touchMove(viewport, 155, 128); // 上へ 72px 移動
  touchEnd(viewport, 155, 128);
  assert.ok(mouse.events.length >= 1, 'スワイプで wheel イベントが撃たれる');
  assert.ok(
    mouse.events.every((m) => m.button === 4 && m.action === 1),
    '上方向スワイプは wheel down（button:4 action:1）',
  );
});

check('mouse mode のスワイプ touchend は tap（press/release）を撃たない', () => {
  const { term, viewport, mouse } = makeTerm(true);
  install(term);
  touchStart(viewport, 155, 99);
  touchMove(viewport, 155, 171);
  touchEnd(viewport, 155, 171);
  // wheel(button:4) はあっても、press/release(button:0) は無いこと。
  assert.ok(
    mouse.events.every((m) => m.button === 4),
    'スワイプ後の touchend で button:0 の tap を撃たない',
  );
});

// ── 3b) 長押し（>700ms）はタップ扱いしない ───────────────────────────────
check('mouse mode の長押し（>700ms）: タップ扱いせず preventDefault しない', () => {
  const { term, viewport, mouse } = makeTerm(true);
  install(term);
  // Date.now を一時的に進めて長押しを再現する。
  const realNow = Date.now;
  let base = realNow();
  Date.now = () => base;
  try {
    touchStart(viewport, 155, 99);
    base += 800; // 800ms 経過
    const e = touchEnd(viewport, 155, 99);
    assert.equal(mouse.events.length, 0, '長押しでは mouse event を撃たない');
    assert.equal(e.defaultPrevented, false, '長押しの touchend は preventDefault しない');
  } finally {
    Date.now = realNow;
  }
});

// ── 4) mouseActive=false（通常 shell）: tap でも swipe でも一切介入しない ──────────────
check('通常 shell（mouseActive=false）: clean tap でも triggerMouseEvent を呼ばず preventDefault もしない', () => {
  const { term, viewport, mouse } = makeTerm(false);
  install(term);
  touchStart(viewport, 155, 99);
  const e = touchEnd(viewport, 155, 99);
  assert.equal(mouse.events.length, 0, '通常 shell では mouse event を撃たない（非介入）');
  assert.equal(e.defaultPrevented, false, '通常 shell では preventDefault しない＝スクロール/選択を温存');
});

check('通常 shell（mouseActive=false）: スワイプでも wheel を撃たず preventDefault もしない（ネイティブスクロール温存）', () => {
  const { term, viewport, mouse } = makeTerm(false);
  install(term);
  touchStart(viewport, 155, 99);
  const em = viewport.fire({ type: 'touchmove', touches: [{ clientX: 155, clientY: 171 }], changedTouches: [] });
  const ee = touchEnd(viewport, 155, 171);
  assert.equal(mouse.events.length, 0, '通常 shell ではスワイプで wheel を撃たない（非介入）');
  assert.equal(em.defaultPrevented, false, '通常 shell の touchmove は preventDefault しない＝ネイティブ pan が流れる');
  assert.equal(ee.defaultPrevented, false, '通常 shell の touchend も preventDefault しない');
});

// ── 5) 二重インストール防止 ────────────────────────────────────────────
check('二重インストールしない（__apolloTapFix ガード）', () => {
  const { term, viewport } = makeTerm(true);
  install(term);
  const before = viewport.listeners['touchend']?.length ?? 0;
  install(term); // 2 回目
  const after = viewport.listeners['touchend']?.length ?? 0;
  assert.equal(after, before, '2 回目はリスナを重複登録しない');
});

const total = 9;
console.log(`\nterminalProxy TAP_FIX: ${total - failures}/${total} passed`);
if (failures > 0) {
  process.exit(1);
}
