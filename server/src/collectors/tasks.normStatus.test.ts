// normStatus 単体テスト（MC-81）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/collectors/tasks.normStatus.test.ts （server/ 配下で）
//
// 主眼: status セル本文の注記（全角/半角カッコ・コロン・改行）に他ステータス語が混ざっても、
// 「先頭ステータストークン」で正規化されること（DONE（…CANCELLED…）→ DONE）。

import assert from 'node:assert/strict';
import { normStatus } from './tasks.js';

interface Case {
  name: string;
  input: string | null | undefined;
  expect: string;
}

const cases: Case[] = [
  // ── MC-81 本丸: 注記に他ステータス語が混ざる ──────────────────
  {
    name: 'MC-79 実データ: DONE（…承認1タップ→TODO/却下→CANCELLED…）→ DONE',
    input:
      'DONE（2026-05-31 承認フロー実装(GET /api/approvals＋承認1タップ→TODO/却下→CANCELLED・MC-71書き戻し層再利用・件数バッジ)・本番反映済 commit 66283a0・/api/approvals 12件返却確認）',
    expect: 'DONE',
  },
  {
    name: 'DONE（…REVIEW…CANCELLED…）→ DONE',
    input: 'DONE（…REVIEW…CANCELLED…）',
    expect: 'DONE',
  },
  {
    name: '却下→CANCELLED を含む DONE → DONE（先頭優先）',
    input: 'DONE（検証 OK・却下→CANCELLED の分岐も実装）',
    expect: 'DONE',
  },
  {
    name: 'MC-74 実データ: DONE（…縦型カード| ID |MC-70|非対応…）→ DONE',
    input:
      'DONE（2026-05-31 本番反映済 commit c69a534・restart済。バグ1=…→STATUS_RANK+mergeStatusで確定方向のみ上書き。バグ2=縦型カード| ID |MC-70|非対応→状態機械で対応。実測 AF-01/FB-02/FB-03→DONE・MC-70→CANCELLED・MC-73→DONE）',
    expect: 'DONE',
  },
  {
    name: 'REVIEW（実装○）→ REVIEW',
    input: 'REVIEW（実装は完了、内部レビュー待ち）',
    expect: 'REVIEW',
  },
  {
    name: 'BLOCKED（Keita 承認待ち、DONE 不可）→ BLOCKED',
    input: 'BLOCKED（Keita 承認待ち、まだ DONE にできない）',
    expect: 'BLOCKED',
  },

  // ── 各ステータス素の値 ────────────────────────────────
  { name: 'DONE', input: 'DONE', expect: 'DONE' },
  { name: 'TODO', input: 'TODO', expect: 'TODO' },
  { name: 'REVIEW', input: 'REVIEW', expect: 'REVIEW' },
  { name: 'BLOCKED', input: 'BLOCKED', expect: 'BLOCKED' },
  { name: 'CANCELLED', input: 'CANCELLED', expect: 'CANCELLED' },

  // ── IN_PROGRESS の表記ゆれ ───────────────────────────
  { name: 'IN_PROGRESS（アンダースコア）', input: 'IN_PROGRESS', expect: 'IN_PROGRESS' },
  { name: 'IN PROGRESS（スペース）', input: 'IN PROGRESS', expect: 'IN_PROGRESS' },
  { name: 'in progress（小文字）', input: 'in progress', expect: 'IN_PROGRESS' },
  {
    name: 'IN_PROGRESS（注記つき）→ IN_PROGRESS',
    input: 'IN_PROGRESS（着手中、DONE はまだ）',
    expect: 'IN_PROGRESS',
  },

  // ── コロン/スペース区切りで止まる ─────────────────────
  { name: 'DONE: commit abc → DONE', input: 'DONE: commit abc123', expect: 'DONE' },
  { name: 'DONE （半角スペース＋全角カッコ）', input: 'DONE （済）', expect: 'DONE' },

  // ── 日本語ステータス fallback ────────────────────────
  // 日本語キーワード fallback は旧実装と同一（「完了」「済」「進行」「ブロック」「レビュー」のみ）。
  // 「却下」「未着手」は旧実装でも語彙に無く UNKNOWN（MC-81 で語彙を増やさない＝非破壊）。
  { name: '完了 → DONE', input: '完了', expect: 'DONE' },
  { name: '完了（commit …）→ DONE', input: '完了（commit abc123）', expect: 'DONE' },
  { name: '進行中 → IN_PROGRESS', input: '進行中', expect: 'IN_PROGRESS' },
  { name: 'ブロック中 → BLOCKED', input: 'ブロック中', expect: 'BLOCKED' },
  { name: 'レビュー待ち → REVIEW', input: 'レビュー待ち', expect: 'REVIEW' },
  { name: '却下（旧仕様通り語彙外）→ UNKNOWN', input: '却下', expect: 'UNKNOWN' },

  // ── 語中の日本語部分一致を誤爆しない（記号始まり長文セル、MC-81 回帰防止）──
  {
    name: 'T-AC: →集約…BLOCKED（…結線済…）→ BLOCKED（"結線済"の済でDONE化しない）',
    input:
      '→ **AM-O に集約**。現況=BLOCKED（PricingScreen 結線済＝コード DONE／Play Console SKU Active 登録 Keita 待ち）',
    expect: 'BLOCKED',
  },
  {
    name: 'T-AF: →集約…BLOCKED（…プレビュー…）→ BLOCKED（"プレビュー"のレビューでREVIEW化しない）',
    input: '→ **AM-R に集約**。現況=BLOCKED（census＋統合プレビュー DONE／DB 書き換え承認 Keita 待ち）',
    expect: 'BLOCKED',
  },

  {
    name: 'UI-28 実データ: DONE（…URL preview…）→ DONE（"preview"のREVIEW語中誤爆を先頭で回避）',
    input:
      'DONE（2026-05-31 内部検証。AppV3.tsx URL preview \'fontsize\' 結線、main反映済 8066d9a。tsc0/vitest440pass）',
    expect: 'DONE',
  },

  // ── 空・未知 ─────────────────────────────────────────
  { name: 'null → UNKNOWN', input: null, expect: 'UNKNOWN' },
  { name: 'undefined → UNKNOWN', input: undefined, expect: 'UNKNOWN' },
  { name: '空文字 → UNKNOWN', input: '', expect: 'UNKNOWN' },
  { name: 'ハイフンのみ → UNKNOWN', input: '-', expect: 'UNKNOWN' },
  { name: '未知語 → UNKNOWN', input: 'なんか変な値', expect: 'UNKNOWN' },
];

let failures = 0;
for (const c of cases) {
  try {
    assert.equal(normStatus(c.input), c.expect);
    console.log(`  ok   ${c.name}`);
  } catch (e) {
    failures += 1;
    const got = normStatus(c.input);
    console.error(`  FAIL ${c.name}: expected ${c.expect}, got ${got}`);
  }
}

console.log(`\nnormStatus: ${cases.length - failures}/${cases.length} passed`);
if (failures > 0) {
  process.exit(1);
}
