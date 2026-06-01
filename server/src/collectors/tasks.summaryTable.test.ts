// parseTrackerString の「status 正本一本化」回帰テスト（MC-88 / MC-89）
//
// vitest 等は未導入のため node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/collectors/tasks.summaryTable.test.ts （server/ 配下で）
//
// 主眼: 同一タスク ID が「正準サマリ表（| ID | … | ステータス | 担当 |）」と
// 「判断反映サマリ等の別表（| タスク | 旧状態 | 新状態 | 反映内容 |）」の両方に出るとき、
// status の正本は常に正準サマリ表の status 列であり、別表の旧/新状態列に揺さぶられない
// （= MC-89 のフラッピングを起こさない）。表の出現順にも依存しないこと。

import assert from 'node:assert/strict';
import { parseTrackerString } from './tasks.js';

interface Case {
  name: string;
  md: string;
  expect: { id: string; status: string }[];
  expectTaskCount?: number;
}

const decisionTable = [
  '## 判断反映サマリ（別表・status 列ではなく旧/新状態列を持つ）',
  '| タスク | 旧状態 | 新状態 | 反映内容 |',
  '|--------|--------|--------|----------|',
  '| ZZ-1 | DONE | BLOCKED（再オープン） | 何か |',
  '| ZZ-2 | BLOCKED | TODO（unblock） | 何か |',
];

const canonTable = [
  '## 正準サマリ',
  '| ID | タイトル | 優先度 | ステータス | 担当案 |',
  '|----|----------|--------|------------|--------|',
  '| ZZ-1 | タスク1 | P1 | REVIEW | dev-logic |',
  '| ZZ-2 | タスク2 | P1 | DONE | dev-logic |',
];

const cases: Case[] = [
  {
    // 正準表が先（実台帳 logic の現状の並び）。別表の旧/新状態は status に混入しない。
    name: '正準表→別表の順: status は正準表（REVIEW/DONE）',
    md: [...canonTable, '', ...decisionTable].join('\n'),
    expect: [
      { id: 'ZZ-1', status: 'REVIEW' },
      { id: 'ZZ-2', status: 'DONE' },
    ],
    expectTaskCount: 2,
  },
  {
    // 別表が先に来る破綻順序。改修前は別表行が seen 先勝ちで採用され UNKNOWN に倒れていた。
    // 改修後は別表を非タスク表として行ごとスキップし、正準表の値だけが残る（順序非依存）。
    name: '別表→正準表の順: それでも status は正準表（REVIEW/DONE）',
    md: [...decisionTable, '', ...canonTable].join('\n'),
    expect: [
      { id: 'ZZ-1', status: 'REVIEW' },
      { id: 'ZZ-2', status: 'DONE' },
    ],
    expectTaskCount: 2,
  },
  {
    // 正準表で BLOCKED 化されたタスクが、別表の「新状態=TODO」に巻き戻されない
    // （commit 9b9cc33 の正しい BLOCKED を Apollo live で守る、の回帰テスト）。
    name: '正準表 BLOCKED は別表の新状態 TODO に巻き戻されない',
    md: [
      '## 正準サマリ',
      '| ID | タイトル | 優先度 | ステータス | 担当案 |',
      '|----|----------|--------|------------|--------|',
      '| AM-N | 法務 | P1 | BLOCKED | dev-logic |',
      '',
      '## 判断反映サマリ',
      '| タスク | 旧状態 | 新状態 | 反映内容 |',
      '|--------|--------|--------|----------|',
      '| AM-N | BLOCKED | TODO（unblock） | 法的確定値が揃った |',
    ].join('\n'),
    expect: [{ id: 'AM-N', status: 'BLOCKED' }],
    expectTaskCount: 1,
  },
];

let failures = 0;
for (const c of cases) {
  const tasks = parseTrackerString(c.md, 'logic', 'test');
  let ok = true;
  for (const e of c.expect) {
    const t = tasks.find((x) => x.id === e.id);
    const got = t ? t.status : '(not found)';
    if (got !== e.status) {
      ok = false;
      console.error(`  FAIL ${c.name}: ${e.id} expected ${e.status}, got ${got}`);
    }
  }
  if (c.expectTaskCount !== undefined && tasks.length !== c.expectTaskCount) {
    ok = false;
    console.error(
      `  FAIL ${c.name}: task count expected ${c.expectTaskCount}, got ${tasks.length}`,
    );
  }
  if (ok) console.log(`  ok   ${c.name}`);
  else failures += 1;
}

// 実台帳での安定性（フラッピングしないこと）の最低限の確認。
// 実台帳がこのマシンに在れば、二回パースして結果が一致することだけ assert する
// （status 値そのものは台帳状態に依存するので固定値 assert はしない）。
try {
  const { readFileSync } = await import('node:fs');
  const real = readFileSync(
    '/home/dev/projects/logic/docs/TASK_TRACKER.md',
    'utf-8',
  );
  const a = parseTrackerString(real, 'logic', 'logic/TASK_TRACKER');
  const b = parseTrackerString(real, 'logic', 'logic/TASK_TRACKER');
  const pick = (ts: ReturnType<typeof parseTrackerString>) =>
    ts.map((t) => `${t.id}=${t.status}`).join(',');
  assert.equal(pick(a), pick(b), '同一入力の2回パースが一致（決定的）');
  // 重複 ID が無いこと（別表の重複行が混入していない）。
  const ids = a.map((t) => t.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.equal(dup.length, 0, `重複 ID なし（混入: ${dup.join(',')}）`);
  console.log('  ok   実台帳 logic/TASK_TRACKER: 決定的パース＋重複IDなし');
} catch (e) {
  console.log(`  skip 実台帳チェック（${(e as Error).message}）`);
}

console.log(`\nsummaryTable: ${cases.length - failures}/${cases.length} case groups passed`);
if (failures > 0) process.exit(1);
