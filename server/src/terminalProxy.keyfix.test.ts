// KEY_FIX_BODY 回帰テスト（MC-108: PageUp/PageDown スクロール + MC-94 Ctrl+V 非退行）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/terminalProxy.keyfix.test.ts （server/ 配下で）
//
// KEY_FIX_BODY はブラウザに文字列で注入する素の JS（attachCustomKeyEventHandler に統合された
// Ctrl+V 抑止 + PageUp/PageDown スクロール）。jsdom も未導入なので、xterm.js 相当の最小モック
// （window.term / attachCustomKeyEventHandler / coreMouseService / scrollPages）を手で組み、
// KEY_FIX_BODY を new Function で eval してインストールさせ、合成 keydown を渡して挙動を検証する。
//
// 主眼（MC-108 の DoD）:
//   1) mouse mode（TUI）: PageUp → wheel up（button:4 action:0）を1ページ分撃ち return false。
//      PageDown → wheel down（action:1）。Shift 有無に関わらず同じ。生キーを TUI に送らない。
//   2) 通常 shell（mouseActive=false）: 素の PageUp → scrollPages(-1)、PageDown → scrollPages(1)、
//      いずれも return false（生キー抑止）。Shift+PageUp/Down は return true で xterm ネイティブに任せる。
//   3) MC-94 非退行: Ctrl+V（Shift 無し）は return false（SYN 抑止）、Ctrl+Shift+V は素通り。
//   4) 通常打鍵（'a' 等）は素通り。二重インストールしない。

import assert from 'node:assert/strict';
import { KEY_FIX_BODY } from './terminalProxy.js';

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

interface KeyEventLike {
  type: string;
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

interface WheelEvent {
  action: number;
  button: number;
}

function makeTerm(mouseActive: boolean): {
  term: Record<string, unknown>;
  wheels: WheelEvent[];
  scrolls: number[];
  getHandler: () => ((e: KeyEventLike) => boolean) | null;
} {
  const wheels: WheelEvent[] = [];
  const scrolls: number[] = [];
  let handler: ((e: KeyEventLike) => boolean) | null = null;
  const term: Record<string, unknown> = {
    cols: 80,
    rows: 24,
    attachCustomKeyEventHandler(fn: (e: KeyEventLike) => boolean) {
      handler = fn;
    },
    scrollPages(n: number) {
      scrolls.push(n);
    },
    _core: {
      coreMouseService: {
        get areMouseEventsActive() {
          return mouseActive;
        },
        triggerMouseEvent(ev: { action: number; button: number }) {
          wheels.push({ action: ev.action, button: ev.button });
        },
      },
    },
  };
  return { term, wheels, scrolls, getHandler: () => handler };
}

function install(term: Record<string, unknown>): void {
  const win = { term } as Record<string, unknown>;
  const fn = new Function('window', 'setInterval', 'clearInterval', KEY_FIX_BODY);
  fn(
    win,
    () => 0,
    () => undefined,
  );
}

function keydown(opts: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    type: 'keydown',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...opts,
  };
}

// ── 1) mouse mode（TUI）: PageUp/PageDown → wheel ────────────────────────────
check('mouse mode の PageUp: wheel up（button:4 action:0）を1ページ分撃ち return false（生キー抑止）', () => {
  const { term, wheels, scrolls, getHandler } = makeTerm(true);
  install(term);
  const h = getHandler();
  assert.ok(h, 'handler installed');
  const e = keydown({ key: 'PageUp' });
  const ret = h!(e);
  assert.equal(ret, false, 'PageUp は return false で生キーを送らない');
  assert.equal(scrolls.length, 0, 'mouse mode では scrollPages を使わない');
  assert.equal(wheels.length, 23, 'rows(24)-1 = 23 行分の wheel');
  assert.ok(wheels.every((w) => w.button === 4 && w.action === 0), 'すべて wheel up（button:4 action:0）');
  assert.equal(e.defaultPrevented, true, 'preventDefault される');
});

check('mouse mode の PageDown: wheel down（button:4 action:1）を撃ち return false', () => {
  const { term, wheels, getHandler } = makeTerm(true);
  install(term);
  const e = keydown({ key: 'PageDown' });
  const ret = getHandler()!(e);
  assert.equal(ret, false, 'PageDown は return false');
  assert.equal(wheels.length, 23, '23 行分の wheel');
  assert.ok(wheels.every((w) => w.button === 4 && w.action === 1), 'すべて wheel down（action:1）');
});

check('mouse mode の Shift+PageUp も wheel up に変換する（native scrollback が無いため）', () => {
  const { term, wheels, getHandler } = makeTerm(true);
  install(term);
  const e = keydown({ key: 'PageUp', shiftKey: true });
  const ret = getHandler()!(e);
  assert.equal(ret, false, 'Shift+PageUp も return false');
  assert.ok(wheels.length === 23 && wheels.every((w) => w.button === 4 && w.action === 0), 'wheel up を撃つ');
});

// ── 2) 通常 shell: scrollPages / Shift は native ────────────────────────────
check('通常 shell の素 PageUp: scrollPages(-1) を呼び return false（wheel は撃たない）', () => {
  const { term, wheels, scrolls, getHandler } = makeTerm(false);
  install(term);
  const e = keydown({ key: 'PageUp' });
  const ret = getHandler()!(e);
  assert.equal(ret, false, '素 PageUp は scrollback を動かして return false');
  assert.deepEqual(scrolls, [-1], 'scrollPages(-1) を1回');
  assert.equal(wheels.length, 0, '通常 shell では wheel を撃たない');
  assert.equal(e.defaultPrevented, true, 'preventDefault される');
});

check('通常 shell の素 PageDown: scrollPages(1) を呼び return false', () => {
  const { term, scrolls, getHandler } = makeTerm(false);
  install(term);
  const ret = getHandler()!(keydown({ key: 'PageDown' }));
  assert.equal(ret, false);
  assert.deepEqual(scrolls, [1], 'scrollPages(1) を1回');
});

check('通常 shell の Shift+PageUp: 素通り（return true）で xterm ネイティブ scrollback に任せる（二重送出しない）', () => {
  const { term, scrolls, wheels, getHandler } = makeTerm(false);
  install(term);
  const e = keydown({ key: 'PageUp', shiftKey: true });
  const ret = getHandler()!(e);
  assert.equal(ret, true, 'Shift+PageUp は native に任せる＝return true');
  assert.equal(scrolls.length, 0, 'scrollPages を呼ばない（二重送出しない）');
  assert.equal(wheels.length, 0, 'wheel も撃たない');
  assert.equal(e.defaultPrevented, false, 'preventDefault しない');
});

// ── 3) MC-94 Ctrl+V 非退行 ──────────────────────────────────────────────────
check('Ctrl+V（Shift 無し）: return false（SYN 抑止）・preventDefault しない（ネイティブ paste 温存）', () => {
  const { term, getHandler } = makeTerm(true);
  install(term);
  const e = keydown({ key: 'v', ctrlKey: true });
  const ret = getHandler()!(e);
  assert.equal(ret, false, 'Ctrl+V は SYN を送らせない');
  assert.equal(e.defaultPrevented, false, 'preventDefault は呼ばない（ネイティブ paste を生かす）');
});

check('Ctrl+Shift+V: 素通り（return true）＝既存ネイティブ paste を壊さない', () => {
  const { term, getHandler } = makeTerm(true);
  install(term);
  const ret = getHandler()!(keydown({ key: 'v', ctrlKey: true, shiftKey: true }));
  assert.equal(ret, true);
});

// ── 4) 通常打鍵は素通り / Alt+PageUp は触らない / 二重インストール防止 ───────────
check("通常打鍵 'a' は素通り（return true）", () => {
  const { term, wheels, scrolls, getHandler } = makeTerm(true);
  install(term);
  const ret = getHandler()!(keydown({ key: 'a' }));
  assert.equal(ret, true);
  assert.equal(wheels.length, 0);
  assert.equal(scrolls.length, 0);
});

check('Alt+PageUp（修飾付き）は触らず素通り（別用途を尊重）', () => {
  const { term, wheels, scrolls, getHandler } = makeTerm(true);
  install(term);
  const ret = getHandler()!(keydown({ key: 'PageUp', altKey: true }));
  assert.equal(ret, true, 'Alt 付きは素通り');
  assert.equal(wheels.length, 0);
  assert.equal(scrolls.length, 0);
});

check('keyup の PageUp は無視（keydown のみ処理）', () => {
  const { term, wheels, getHandler } = makeTerm(true);
  install(term);
  const e = keydown({ key: 'PageUp' });
  e.type = 'keyup';
  const ret = getHandler()!(e);
  assert.equal(ret, true, 'keyup は素通り');
  assert.equal(wheels.length, 0, 'keyup では wheel を撃たない');
});

check('二重インストールしない（__apolloPasteFix ガード）', () => {
  const { term, getHandler } = makeTerm(true);
  install(term);
  const first = getHandler();
  install(term); // 2 回目
  // 2 回目は __apolloPasteFix ガードで install せず handler を再 attach しない。
  assert.equal(getHandler(), first, '2 回目は handler を上書きしない');
});

const total = 13;
console.log(`\nterminalProxy KEY_FIX: ${total - failures}/${total} passed`);
if (failures > 0) {
  process.exit(1);
}
