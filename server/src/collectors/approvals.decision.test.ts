// isSuppressedByDecision 単体テスト（MC-89）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/collectors/approvals.decision.test.ts （server/ 配下で）
//
// 主眼: 承認済み項目が次ティックで承認待ちキューに再浮上する MC-89 の冪等化強化。
// 「id+source の最新決定が approve なら現在 status に関係なく抑止」を検証する。
// collector が同一 ID の別表現から status を BLOCKED に揺らして読んでも、approve 済みなら
// 抑止が外れない（再浮上ループを断つ＝本丸）。reject/決定なしは従来挙動にフォールバック。

import assert from 'node:assert/strict';
import { isSuppressedByDecision, type LatestDecision } from './approvals.js';

interface Case {
  name: string;
  latest: LatestDecision | undefined;
  currentStatus: string;
  expect: boolean;
}

const cases: Case[] = [
  // ── MC-89 本丸: approve なら status 不問で抑止 ──────────────────
  {
    name: 'approve 決定があれば currentStatus=BLOCKED でも抑止（再浮上防止の本丸）',
    latest: { decision: 'approve', toStatus: 'TODO' },
    currentStatus: 'BLOCKED',
    expect: true,
  },
  {
    name: 'approve 決定があれば currentStatus=TODO でも抑止',
    latest: { decision: 'approve', toStatus: 'TODO' },
    currentStatus: 'TODO',
    expect: true,
  },
  {
    name: 'approve 決定があれば currentStatus=IN_PROGRESS でも抑止（status 不問）',
    latest: { decision: 'approve', toStatus: 'TODO' },
    currentStatus: 'IN_PROGRESS',
    expect: true,
  },

  // ── reject は従来挙動フォールバック（toStatus 一致時のみ抑止）──────
  {
    name: 'reject 決定で toStatus と currentStatus が一致 → 抑止',
    latest: { decision: 'reject', toStatus: 'CANCELLED' },
    currentStatus: 'CANCELLED',
    expect: true,
  },
  {
    name: 'reject 決定で toStatus と currentStatus が不一致 → 抑止しない（再起票で再浮上可）',
    latest: { decision: 'reject', toStatus: 'CANCELLED' },
    currentStatus: 'BLOCKED',
    expect: false,
  },

  // ── 決定なし（undefined）→ 抑止しない ─────────────────────────
  {
    name: '決定なし（undefined）→ 抑止しない',
    latest: undefined,
    currentStatus: 'BLOCKED',
    expect: false,
  },
  {
    name: '決定なし（undefined）→ TODO でも抑止しない',
    latest: undefined,
    currentStatus: 'TODO',
    expect: false,
  },

  // ── 想定外 decision 値は approve 以外として扱う（toStatus 一致で判定）──
  {
    name: '未知 decision 値 + toStatus 一致 → 抑止（フォールバック）',
    latest: { decision: 'unknown', toStatus: 'TODO' },
    currentStatus: 'TODO',
    expect: true,
  },
  {
    name: '未知 decision 値 + toStatus 不一致 → 抑止しない',
    latest: { decision: 'unknown', toStatus: 'TODO' },
    currentStatus: 'BLOCKED',
    expect: false,
  },
];

let failures = 0;
for (const c of cases) {
  try {
    assert.equal(isSuppressedByDecision(c.latest, c.currentStatus), c.expect);
    console.log(`  ok   ${c.name}`);
  } catch {
    failures += 1;
    const got = isSuppressedByDecision(c.latest, c.currentStatus);
    console.error(`  FAIL ${c.name}: expected ${c.expect}, got ${got}`);
  }
}

console.log(`\nisSuppressedByDecision: ${cases.length - failures}/${cases.length} passed`);
if (failures > 0) {
  process.exit(1);
}
