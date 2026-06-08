// parseTrackerString の「空TODO誤発火を止める」回帰テスト（MC-211）
//
// vitest 等は未導入のため node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/collectors/tasks.ghostTodo.test.ts （server/ 配下で）
//
// 主眼（MC-211 DoD）:
//   (1) status は「カード表のステータス列／縦型カードの `| ステータス | … |` フィールド」だけが正本。
//       DONE 行や詳細セクション本文中の "TODO"/"DONE" 文字列（履歴記述「TODO→DONE」等、
//       受け入れ条件文、section-form の `- ステータス: TODO`）を status として拾わない。
//   (2) 空タイトル・空ステータスのゴースト行（「- TODO:（空）」相当）は task 化しない。
//   (4) 正規 TODO カード（実体あり・表にステータス列を持つ）は従来どおり検知される（非退行）。

import { parseTrackerString } from './tasks.js';

interface Case {
  name: string;
  md: string;
  // id -> 期待ステータス（存在すること込み）。null は「その id が task 化されない」ことを期待。
  expect: { id: string; status: string | null }[];
  expectTaskCount?: number;
}

const cases: Case[] = [
  {
    // (1) 表の DONE 行の note に "TODO" が混ざっていても、status は表の DONE のまま。
    name: 'DONE 行 note 内の "TODO" を status に拾わない（表の DONE が正本）',
    md: [
      '| ID | タイトル | 優先度 | ステータス | 担当 |',
      '|----|----------|--------|------------|------|',
      '| MC-1 | 正規タスク | P1 | DONE（履歴: TODO→IN_PROGRESS→DONE。受け入れ条件に TODO 表記あり） | dev |',
    ].join('\n'),
    expect: [{ id: 'MC-1', status: 'DONE' }],
    expectTaskCount: 1,
  },
  {
    // (1) 表は DONE。`### MC-2` セクション本文の古い `- ステータス: TODO` に巻き戻されない。
    name: 'section 本文の `- ステータス: TODO` は表の DONE を上書きしない',
    md: [
      '| ID | タイトル | 優先度 | ステータス | 担当 |',
      '|----|----------|--------|------------|------|',
      '| MC-2 | 正規タスク | P1 | DONE | dev |',
      '',
      '### MC-2 — 詳細',
      '- ステータス: TODO （旧記述・stale）',
      '- 担当: dev-logic',
    ].join('\n'),
    expect: [{ id: 'MC-2', status: 'DONE' }],
    expectTaskCount: 1,
  },
  {
    // (1) 表は DONE。section の `- ステータス: CANCELLED〔旧REVIEW〕` に倒れない（DF-F10 実例の型）。
    name: 'section 本文の `- ステータス: CANCELLED` 旧記述に倒れない（実例 DF-F10 型）',
    md: [
      '| ID | タイトル | 優先度 | ステータス | 担当 |',
      '|----|----------|--------|------------|------|',
      '| DF-X | タブ命名 | P1 | DONE（DF-FV○） | dev-logic |',
      '',
      '### DF-X — 下タブのラベル',
      '- 優先度: P1 / ステータス: CANCELLED〔一時保留・旧REVIEW〕 / 担当: dev-logic',
    ].join('\n'),
    expect: [{ id: 'DF-X', status: 'DONE' }],
    expectTaskCount: 1,
  },
  {
    // (2) ステータス列が空＝ゴースト行は task 化しない（「- TODO:（空）」相当）。
    name: 'ステータス空のゴースト行は task 化しない',
    md: [
      '| ID | タイトル | 優先度 | ステータス | 担当 |',
      '|----|----------|--------|------------|------|',
      '| MC-3 | 実体あり | P1 | TODO | dev |',
      '| MC-4 | 幽霊（status空） | P1 |  |  |',
    ].join('\n'),
    expect: [
      { id: 'MC-3', status: 'TODO' },
      { id: 'MC-4', status: null },
    ],
    expectTaskCount: 1,
  },
  {
    // (2) 縦型カードでステータスフィールドが空ならゴーストとして除外する。
    name: '縦型カード: ステータス空のゴーストカードは task 化しない',
    md: [
      '| フィールド | 値 |',
      '|---|---|',
      '| ID | MC-5 |',
      '| タイトル | 幽霊カード |',
      '| ステータス |  |',
      '| 担当 |  |',
    ].join('\n'),
    expect: [{ id: 'MC-5', status: null }],
    expectTaskCount: 0,
  },
  {
    // (4) 非退行: 実体ある正規 TODO カード（縦型・表にステータス列あり）は従来どおり検知。
    name: '非退行: 正規 TODO 縦型カードは検知される',
    md: [
      '| フィールド | 値 |',
      '|---|---|',
      '| ID | MC-6 |',
      '| タイトル | 正規TODOカード |',
      '| ステータス | TODO |',
      '| 担当 | dev-apollo |',
      '| 詳細 | 履歴に TODO→DONE という文字列があっても status は表の TODO |',
    ].join('\n'),
    expect: [{ id: 'MC-6', status: 'TODO' }],
    expectTaskCount: 1,
  },
];

let failures = 0;
for (const c of cases) {
  const tasks = parseTrackerString(c.md, 'cxo', 'test');
  let ok = true;
  for (const e of c.expect) {
    const t = tasks.find((x) => x.id === e.id);
    if (e.status === null) {
      if (t) {
        ok = false;
        console.error(`  FAIL ${c.name}: ${e.id} は task 化されない想定だが status=${t.status} で出た`);
      }
    } else {
      const got = t ? t.status : '(not found)';
      if (got !== e.status) {
        ok = false;
        console.error(`  FAIL ${c.name}: ${e.id} expected ${e.status}, got ${got}`);
      }
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

console.log(`\nghostTodo: ${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
