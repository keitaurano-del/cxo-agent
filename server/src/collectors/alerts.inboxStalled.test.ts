// evaluateInboxStall 単体テスト（MC-90 DoD(4)）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/collectors/alerts.inboxStalled.test.ts （server/ 配下で）
//
// 主眼: Apollo 受信箱(inbox.jsonl)に pending が一定期間残ったら監視が検知できる滞留アラート。
// 未消化エントリの最古経過が INBOX_STALL_HOURS を超えたら 1 件に集約して warning を出す。
// SMOKE ノイズ・全件消化・閾値内・不正 ts（長期間表現）・件数集計を決定的に検証する。

import assert from 'node:assert/strict';
import { evaluateInboxStall } from './alerts.js';

// 決定的に評価するため now / stallHours は明示渡し。
const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const STALL = 3; // 3 時間。

/** NOW から hours 時間前の ISO を返す。 */
function hoursAgo(hours: number): string {
  return new Date(NOW - hours * 3600000).toISOString();
}

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

// (1) 未消化 0 件 → []
check('未消化 0 件 → アラート無し', () => {
  const out = evaluateInboxStall([], new Set(), NOW, STALL);
  assert.deepEqual(out, []);
});

// (2) 未消化あり・最古が閾値内 → []
check('最古が閾値内（2 時間前）→ アラート無し', () => {
  const out = evaluateInboxStall(
    [{ id: 'a', ts: hoursAgo(2), text: 'task A' }],
    new Set(),
    NOW,
    STALL,
  );
  assert.deepEqual(out, []);
});

// (3) 最古が閾値超 → 1 件・title に件数/時間・severity warning
check('最古が閾値超（5 時間前）→ 1 件・件数/時間・warning', () => {
  const out = evaluateInboxStall(
    [{ id: 'a', ts: hoursAgo(5), text: 'task A' }],
    new Set(),
    NOW,
    STALL,
  );
  assert.equal(out.length, 1);
  const a = out[0];
  assert.equal(a.id, 'inbox-stalled');
  assert.equal(a.category, 'inbox-stalled');
  assert.equal(a.severity, 'warning');
  assert.equal(a.project, 'cxo');
  assert.equal(a.taskId, undefined);
  assert.ok(a.title.includes('1 件'), `title に件数: ${a.title}`);
  assert.ok(a.title.includes('5 時間'), `title に時間: ${a.title}`);
  assert.equal(a.since, hoursAgo(5));
});

// (4) 全件 consumed → []
check('全件 consumed → アラート無し', () => {
  const out = evaluateInboxStall(
    [
      { id: 'a', ts: hoursAgo(5), text: 'task A' },
      { id: 'b', ts: hoursAgo(8), text: 'task B' },
    ],
    new Set(['a', 'b']),
    NOW,
    STALL,
  );
  assert.deepEqual(out, []);
});

// (5) SMOKE のみ未消化 → []
check('SMOKE マーカーのみ未消化 → アラート無し', () => {
  const out = evaluateInboxStall(
    [{ id: 'a', ts: hoursAgo(10), text: 'health __SMOKE check' }],
    new Set(),
    NOW,
    STALL,
  );
  assert.deepEqual(out, []);
});

// (6) ts 不正（Infinity）→ 滞留 1 件で「長期間」表現
check('ts 不正 → 滞留 1 件・「長期間」表現・since 未設定', () => {
  const out = evaluateInboxStall(
    [{ id: 'a', ts: 'not-a-date', text: 'task A' }],
    new Set(),
    NOW,
    STALL,
  );
  assert.equal(out.length, 1);
  const a = out[0];
  assert.equal(a.severity, 'warning');
  assert.ok(a.title.includes('長期間'), `「長期間」表現: ${a.title}`);
  assert.ok(!/\d+ 時間/.test(a.title), `時間数を出さない: ${a.title}`);
  assert.equal(a.since, undefined); // 不正 ts は since を付けない。
});

// (7) 未消化複数で件数が正しい（一部 consumed / SMOKE 混在）
check('未消化複数 → 件数が正しい（consumed/SMOKE 除外後）', () => {
  const out = evaluateInboxStall(
    [
      { id: 'a', ts: hoursAgo(6), text: 'task A' }, // 未消化
      { id: 'b', ts: hoursAgo(7), text: 'task B' }, // 未消化
      { id: 'c', ts: hoursAgo(9), text: 'task C' }, // 未消化（最古）
      { id: 'd', ts: hoursAgo(10), text: 'done D' }, // consumed
      { id: 'e', ts: hoursAgo(11), text: '__SMOKE' }, // SMOKE
    ],
    new Set(['d']),
    NOW,
    STALL,
  );
  assert.equal(out.length, 1);
  const a = out[0];
  assert.ok(a.title.includes('3 件'), `未消化 3 件: ${a.title}`);
  // 最古は c（9 時間前）。SMOKE/consumed は最古計算から除外される。
  assert.ok(a.title.includes('9 時間'), `最古 9 時間: ${a.title}`);
  assert.equal(a.since, hoursAgo(9));
});

console.log(`\nevaluateInboxStall: ${7 - failures}/7 passed`);
if (failures > 0) {
  process.exit(1);
}
console.log('ok');
