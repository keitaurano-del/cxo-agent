// parsePriority 単体テスト（MC-84）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/inbox.priority.test.ts （server/ 配下で）
//
// 主眼: Apollo 受信箱投入時の優先度（P0/P1/P2/P3）パーサ。
// (a) 各 P0-P3 が通る (b) 未指定→デフォルト 'P2' (c) 小文字正規化 (d) 不正値が error を返す。

import assert from 'node:assert/strict';
import { parsePriority } from './inbox.js';

interface Case {
  name: string;
  input: unknown;
  expect: 'P0' | 'P1' | 'P2' | 'P3' | { error: true };
}

const cases: Case[] = [
  // ── (a) 各 P0-P3 が通る ───────────────────────────────────────
  { name: 'P0 が通る', input: 'P0', expect: 'P0' },
  { name: 'P1 が通る', input: 'P1', expect: 'P1' },
  { name: 'P2 が通る', input: 'P2', expect: 'P2' },
  { name: 'P3 が通る', input: 'P3', expect: 'P3' },

  // ── (b) 未指定 → デフォルト P2 ────────────────────────────────
  { name: 'undefined → P2', input: undefined, expect: 'P2' },
  { name: 'null → P2', input: null, expect: 'P2' },
  { name: '空文字 → P2', input: '', expect: 'P2' },
  { name: "'null' 文字列 → P2", input: 'null', expect: 'P2' },

  // ── (c) 小文字・大文字混在の正規化 ───────────────────────────
  { name: "'p1' → P1（小文字正規化）", input: 'p1', expect: 'P1' },
  { name: "'p0' → P0（小文字正規化）", input: 'p0', expect: 'P0' },
  { name: "'  p3  ' → P3（trim + 正規化）", input: '  p3  ', expect: 'P3' },

  // ── (d) 不正値は error を返す ────────────────────────────────
  { name: "'P9' は error", input: 'P9', expect: { error: true } },
  { name: "'high' は error", input: 'high', expect: { error: true } },
  { name: '数値 2 は error', input: 2, expect: { error: true } },
  { name: "'P' は error", input: 'P', expect: { error: true } },
  { name: 'オブジェクトは error', input: {}, expect: { error: true } },
];

let failures = 0;
for (const c of cases) {
  try {
    const got = parsePriority(c.input);
    if (typeof c.expect === 'object' && 'error' in c.expect) {
      assert.equal(typeof got === 'object' && 'error' in got, true);
    } else {
      assert.equal(got, c.expect);
    }
    console.log(`  ok   ${c.name}`);
  } catch {
    failures += 1;
    const got = parsePriority(c.input);
    console.error(`  FAIL ${c.name}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
  }
}

console.log(`\nparsePriority: ${cases.length - failures}/${cases.length} passed`);
if (failures > 0) {
  process.exit(1);
}
