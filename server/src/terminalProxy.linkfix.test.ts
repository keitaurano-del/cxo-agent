// LINK_FIX_BODY 回帰テスト（MC-333）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/terminalProxy.linkfix.test.ts （server/ 配下で）
//
// LINK_FIX_BODY はブラウザに文字列で注入する素の JS。テストでは window モックを渡して
// new Function で eval し、公開されるヘルパー
//   window.__linkFixExtract(text, idx)   … idx に重なる URL の抽出（末尾トリム込み）
//   window.__linkFixLineAt(buf, absRow, cols) … isWrapped を辿った折返し行の連結
// を直接検証する（window.term 無しでは install() は setInterval 待ちに入るだけで no-op）。

import assert from 'node:assert/strict';
import { LINK_FIX_BODY } from './terminalProxy.js';

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

// LINK_FIX_BODY を window モック付きで eval し、公開ヘルパーを取り出す。
type Extract = (text: string, idx: number) => string | null;
type LineAt = (buf: MockBuffer, absRow: number, cols: number) => { text: string; idx0: number };
const win: Record<string, unknown> = {};
const evalBody = new Function('window', 'setInterval', 'clearInterval', LINK_FIX_BODY);
evalBody(
  win,
  () => 0,
  () => undefined,
);
const extract = win.__linkFixExtract as Extract;
const lineAt = win.__linkFixLineAt as LineAt;

// ── buffer.active 相当の最小モック（getLine → { isWrapped, translateToString }）──
interface MockLine {
  isWrapped: boolean;
  text: string; // フル幅（cols 分）のセル内容
}
class MockBuffer {
  lines: MockLine[];
  constructor(lines: MockLine[]) {
    this.lines = lines;
  }
  getLine(y: number): { isWrapped: boolean; translateToString: (trimRight: boolean) => string } | undefined {
    const l = this.lines[y];
    if (!l) return undefined;
    return {
      isWrapped: l.isWrapped,
      translateToString: (trimRight: boolean) => (trimRight ? l.text.replace(/ +$/, '') : l.text),
    };
  }
}

// ── 1) URL 検出: タップ位置が URL 上なら返し、外なら null ─────────────────────
check('URL 検出: タップ位置が URL 内なら返す・URL 外なら null', () => {
  assert.equal(extract === undefined, false, '__linkFixExtract が公開されている');
  const text = 'see https://example.com/path?q=1 and more';
  // 'h'（idx=4）〜 '1'（idx=31）の範囲内はヒット
  assert.equal(extract(text, 4), 'https://example.com/path?q=1', 'URL 先頭でヒット');
  assert.equal(extract(text, 20), 'https://example.com/path?q=1', 'URL 中間でヒット');
  assert.equal(extract(text, 2), null, 'URL より手前は null');
  assert.equal(extract(text, 35), null, 'URL より後ろは null');
  assert.equal(extract('no url here', 3), null, 'URL 無しは null');
  assert.equal(extract('http://plain.example/', 5), 'http://plain.example/', 'http も可');
});

// ── 2) 全角・閉じ括弧トリム: 行末に混入した記号を落とす ─────────────────────
check('全角トリム: 末尾の全角句読点・閉じ括弧類を落とす', () => {
  assert.equal(
    extract('参照（https://example.com/a）。', 5),
    'https://example.com/a',
    '全角閉じ括弧＋句点をトリム',
  );
  assert.equal(extract('link: https://example.com/b).', 8), 'https://example.com/b', '半角閉じ括弧＋ピリオドをトリム');
  assert.equal(extract('「https://example.com/c」', 3), 'https://example.com/c', '鉤括弧閉じをトリム');
  // 全角スペースは URL の区切りになる（\S は U+3000 を含まない）
  assert.equal(extract('https://example.com/d　続き', 5), 'https://example.com/d', '全角スペースで終端');
});

// ── 3) 折返し連結: isWrapped を辿って前後の行を連結し、文字位置を保つ ─────────────
check('折返し連結: isWrapped 行を前後に辿って連結し idx0 が正しい', () => {
  const cols = 20;
  const buf = new MockBuffer([
    { isWrapped: false, text: 'prompt$ curl https://' }, // y=0（実際は cols 幅だがテストは文字列のまま）
    { isWrapped: true, text: 'example.com/very/lon' }, // y=1
    { isWrapped: true, text: 'g/path ok           ' }, // y=2（折返し終端、右トリムされる）
    { isWrapped: false, text: 'next line           ' }, // y=3
  ]);
  // 中間の折返し行（y=1）を基準に呼ぶ → y=0..2 が連結される
  const la = lineAt(buf, 1, cols);
  assert.ok(la.text.includes('https://example.com/very/long/path'), '折返しを跨いだ URL が連結される');
  assert.ok(!la.text.includes('next line'), 'isWrapped でない次行は連結しない');
  assert.equal(la.idx0, 'prompt$ curl https://'.length, 'idx0 は基準行の先頭オフセット');
  // 連結テキスト＋タップ列から URL が取れる（y=1 の 5 文字目 = URL 中間）
  assert.equal(extract(la.text, la.idx0 + 5), 'https://example.com/very/long/path', '連結後に URL 抽出できる');
});

check('折返し連結の上限: 前後それぞれ最大5行まで（巨大行の暴走防止）', () => {
  const cols = 10;
  const lines: MockLine[] = [];
  for (let i = 0; i < 15; i++) lines.push({ isWrapped: i > 0, text: `[row-${String(i).padStart(2, '0')}]!` });
  const buf = new MockBuffer(lines);
  const la = lineAt(buf, 7, cols);
  // 前後5行ずつ + 自分 = 最大11行分
  assert.ok(la.text.includes('[row-02]'), '5行前まで辿る');
  assert.ok(!la.text.includes('[row-01]'), '6行前は辿らない');
  assert.ok(la.text.includes('[row-12]'), '5行後まで辿る');
  assert.ok(!la.text.includes('[row-13]'), '6行後は辿らない');
});

const total = 4;
console.log(`\nterminalProxy LINK_FIX: ${total - failures}/${total} passed`);
if (failures > 0) {
  process.exit(1);
}
