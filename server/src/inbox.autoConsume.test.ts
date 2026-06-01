// appendConsumed / readConsumedIds 単体テスト（MC-59 恒久対策）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/inbox.autoConsume.test.ts （server/ 配下で）
//
// 主眼: 即タスク化成功時にサーバが consumed へ自動追記するヘルパーの round-trip 検証。
// 実ファイル（data/inbox-consumed.jsonl）は触らず、一時ファイルのみで検証する。
// (a) appendConsumed → readConsumedIds で id が読み戻せる
// (b) 追記行が JSON.parse 可能で id/consumedAt/note フィールドを持つ
// (c) 2 回追記しても両 id が読める（追記専用＝既存を消さない）
// (d) 素の id だけの旧形式行も readConsumedIds が拾う（後方互換）

import assert from 'node:assert/strict';
import { readFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { appendConsumed, readConsumedIds } from './inbox.js';

// 一時ファイルのユニークパス（tmpdir + pid + 乱数 + 時刻）。
const tmpFile = join(
  tmpdir(),
  `inbox-consumed-test-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.jsonl`,
);

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

try {
  // ── (a) appendConsumed → readConsumedIds round-trip ─────────────
  check('appendConsumed した id が readConsumedIds で読み戻せる', () => {
    appendConsumed('inbox-id-A', '即タスク化により自動消し込み: MC-101 (cxo/TASK_TRACKER)', tmpFile);
    const ids = readConsumedIds(tmpFile);
    assert.equal(ids.has('inbox-id-A'), true);
  });

  // ── (b) 追記行が JSON で id/consumedAt/note を持つ ──────────────
  check('追記行が JSON.parse 可能で id/consumedAt/note を持つ', () => {
    const raw = readFileSync(tmpFile, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    assert.equal(last.id, 'inbox-id-A');
    assert.equal(typeof last.consumedAt, 'string');
    // ISO8601 としてパースできる。
    assert.equal(Number.isNaN(Date.parse(last.consumedAt as string)), false);
    assert.equal(typeof last.note, 'string');
    assert.ok((last.note as string).includes('MC-101'));
  });

  // ── (c) 2 回追記しても両 id が読める（追記専用） ───────────────
  check('2 回追記して両 id が読める（既存を消さない）', () => {
    appendConsumed('inbox-id-B', '即タスク化により自動消し込み: MC-102 (logic/TASK_TRACKER)', tmpFile);
    const ids = readConsumedIds(tmpFile);
    assert.equal(ids.has('inbox-id-A'), true);
    assert.equal(ids.has('inbox-id-B'), true);
  });

  // ── (d) 素の id だけの旧形式行も拾う（後方互換） ───────────────
  check('素の id 行（旧形式）も readConsumedIds が拾う', () => {
    appendFileSync(tmpFile, 'legacy-plain-id\n', 'utf-8');
    const ids = readConsumedIds(tmpFile);
    assert.equal(ids.has('legacy-plain-id'), true);
    // JSON 形式と混在しても両方読める。
    assert.equal(ids.has('inbox-id-A'), true);
    assert.equal(ids.has('inbox-id-B'), true);
  });
} finally {
  // テスト一時ファイルを掃除する。
  try {
    unlinkSync(tmpFile);
  } catch {
    // 既に無ければ無視。
  }
}

console.log(`\nappendConsumed/readConsumedIds: ${4 - failures}/4 passed`);
if (failures > 0) {
  process.exit(1);
}
