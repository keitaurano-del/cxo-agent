// ticks collector 単体テスト（MC-65）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/collectors/ticks.test.ts （server/ 配下で）
//
// 主眼: 実ログ形式のサンプル文字列を食わせ、start/done/skip の判定・選んだタスク抽出・
// 結果分類・空入力・壊れ行スキップを検証する。collector 本体は I/O（ファイル末尾読み）
// と純粋解析（parseTicksForTest）に分かれており、テストは純粋解析部分を直接叩く。

import assert from 'node:assert/strict';
import { parseTicksForTest } from './ticks.js';

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

// ─── 1) 開始＋完了（done）の基本ティック ──────────────────────────
check('start→done を 1 ティックとして done で確定し durationMs を算出する', () => {
  const log = [
    '[2026-06-01 10:03:49 JST] [cxo] autonomous-worker tick start (DRY_RUN=0, tracker=/x)',
    '完了じゃ。MC-83 を緑まで仕上げた。',
    '- スコープ: cxo（Apollo）／選定: MC-83（P1・タスクカード）',
    '- 結果: green。ローカル commit 2本。push/deploy は未実施。',
    '[2026-06-01 10:14:09 JST] [cxo] autonomous-worker tick done',
  ].join('\n');
  const ticks = parseTicksForTest(log, 'autonomous-cxo.log');
  assert.equal(ticks.length, 1);
  const t = ticks[0];
  assert.equal(t.status, 'done');
  assert.equal(t.scope, 'cxo');
  assert.equal(t.source, 'autonomous-cxo.log');
  assert.equal(t.endedAt !== null, true);
  // 10:03:49 → 10:14:09 = 620 秒 = 620000 ms
  assert.equal(t.durationMs, 620000);
});

// ─── 2) 選んだタスク抽出（選定: と 選んだタスク: の両表記）──────────
check('「選定: MC-83（…）」から id=MC-83・title を抽出する', () => {
  const log = [
    '[2026-06-01 10:03:49 JST] [cxo] autonomous-worker tick start',
    '- スコープ: cxo／選定: MC-83（タスクカードのタップ詳細）',
    '[2026-06-01 10:14:09 JST] [cxo] autonomous-worker tick done',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-cxo.log')[0];
  assert.equal(t.selectedTask?.id, 'MC-83');
  assert.equal(t.selectedTask?.title, 'タスクカードのタップ詳細');
});

check('「選んだタスク: MC-84「…」」から id と「」内タイトルを抽出する', () => {
  const log = [
    '[2026-06-01 10:30:01 JST] [cxo] autonomous-worker tick start',
    '- 選んだタスク: MC-84「Apollo 投入時に優先度を選べる UI」（P1）',
    '[2026-06-01 10:40:40 JST] [cxo] autonomous-worker tick done',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-cxo.log')[0];
  assert.equal(t.selectedTask?.id, 'MC-84');
  assert.equal(t.selectedTask?.title, 'Apollo 投入時に優先度を選べる UI');
});

check('T-U 形式のタスク ID も抽出する', () => {
  const log = [
    '[2026-06-01 09:10:01 JST] [logic] autonomous-worker tick start',
    '- 選んだタスク: T-U（P1・再オープン）の自律スコープ',
    '[2026-06-01 09:26:43 JST] [logic] autonomous-worker tick done',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-rin.log')[0];
  assert.equal(t.selectedTask?.id, 'T-U');
});

// ─── 3) 結果分類 ─────────────────────────────────────────────
check('結果行の「green」を kind=green に分類する', () => {
  const log = [
    '[2026-06-01 10:03:49 JST] [cxo] autonomous-worker tick start',
    '- 結果: green。ローカル commit 2本。push/deploy は未実施。',
    '[2026-06-01 10:14:09 JST] [cxo] autonomous-worker tick done',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-cxo.log')[0];
  assert.equal(t.result?.kind, 'green');
});

check('結果行の「deploy 有」を kind=deploy に分類する', () => {
  const log = [
    '[2026-06-01 09:10:01 JST] [logic] autonomous-worker tick start',
    '- 結果: green→ commit push → 本番 deploy 実行。**green / deploy 有**。',
    '[2026-06-01 09:26:43 JST] [logic] autonomous-worker tick done',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-rin.log')[0];
  assert.equal(t.result?.kind, 'deploy');
});

check('「deploy なし」を含む green は deploy に誤分類しない', () => {
  const log = [
    '[2026-06-01 10:15:01 JST] [cxo] autonomous-worker tick start',
    '結果: green（server tsc EXIT0）。deploy なし・push なし。',
    '[2026-06-01 10:24:46 JST] [cxo] autonomous-worker tick done',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-cxo.log')[0];
  assert.equal(t.result?.kind, 'green');
});

check('「前進ゼロ・実質マイナス」の結果行を kind=red に分類する', () => {
  const log = [
    '[2026-06-01 09:30:01 JST] [logic] autonomous-worker tick start',
    '結果: green 達成なし・実機の前進ゼロ・誤った push 1件・deploy なし。実質マイナスのティック。',
    '[2026-06-01 10:07:27 JST] [logic] autonomous-worker tick done',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-rin.log')[0];
  assert.equal(t.result?.kind, 'red');
});

// ─── 4) skip 行 ──────────────────────────────────────────────
check('「previous tick still running — skip」を status=skipped で拾う', () => {
  const log = '[2026-05-31 01:30:01 JST] previous tick still running — skip';
  const ticks = parseTicksForTest(log, 'autonomous-rin.log');
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].status, 'skipped');
  assert.equal(ticks[0].endedAt, null);
  assert.equal(ticks[0].durationMs, null);
  assert.equal(/previous tick still running/.test(ticks[0].skipReason ?? ''), true);
  // 行頭 [scope] が無い skip 行はファイル名から logic に寄せる。
  assert.equal(ticks[0].scope, 'logic');
});

check('「disabled (kill-switch present: …) — skip」も skipped で拾う', () => {
  const log =
    '[2026-05-31 10:30:01 JST] disabled (kill-switch present: /home/dev/.autonomous-rin.disabled) — skip';
  const t = parseTicksForTest(log, 'autonomous-rin.log')[0];
  assert.equal(t.status, 'skipped');
});

// ─── 5) 開始のみ（running）──────────────────────────────────────
check('done が来ていない最後の start は running で残す', () => {
  const log = [
    '[2026-06-01 11:00:01 JST] [cxo] autonomous-worker tick start (DRY_RUN=0, tracker=/x)',
    '作業中じゃ。',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-cxo.log')[0];
  assert.equal(t.status, 'running');
  assert.equal(t.endedAt, null);
  assert.equal(t.durationMs, null);
});

// ─── 6) 空入力 ───────────────────────────────────────────────
check('空文字列は空配列を返す', () => {
  assert.deepEqual(parseTicksForTest('', 'autonomous-cxo.log'), []);
});

check('空白・改行のみは空配列を返す', () => {
  assert.deepEqual(parseTicksForTest('\n\n   \n', 'autonomous-cxo.log'), []);
});

// ─── 7) 壊れ行 / 断片のスキップ ──────────────────────────────────
check('対応する start の無い done 断片は無視する（末尾読みの先頭欠け対策）', () => {
  const log = [
    '途中で切れた自由文（タイムスタンプ無し）',
    '[2026-06-01 10:14:09 JST] [cxo] autonomous-worker tick done',
    '[2026-06-01 10:15:01 JST] [cxo] autonomous-worker tick start',
    '結果: green',
    '[2026-06-01 10:24:46 JST] [cxo] autonomous-worker tick done',
  ].join('\n');
  const ticks = parseTicksForTest(log, 'autonomous-cxo.log');
  // 孤立 done は捨て、start→done の 1 ティックのみ。
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].status, 'done');
  assert.equal(ticks[0].result?.kind, 'green');
});

check('タイムスタンプの壊れた行が混ざっても例外を投げず解析を続ける', () => {
  const log = [
    '[2026-06-01 10:15:01 JST] [cxo] autonomous-worker tick start',
    '[BAD-TS] [cxo] なんか変な行',
    '結果: green',
    '[2026-06-01 10:24:46 JST] [cxo] autonomous-worker tick done',
  ].join('\n');
  const ticks = parseTicksForTest(log, 'autonomous-cxo.log');
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].result?.kind, 'green');
});

// ─── 8) 選択タスク/結果が無いティック → null（固まらせない）─────────
check('要約に選んだタスク行も結果行も無いティックは selectedTask/result が null', () => {
  const log = [
    '[2026-06-01 08:40:01 JST] [logic] autonomous-worker tick start',
    '着手可能で headless 完結できるタスクが1つも無いため、何も実装しません。',
    '[2026-06-01 08:41:10 JST] [logic] autonomous-worker tick done',
  ].join('\n');
  const t = parseTicksForTest(log, 'autonomous-rin.log')[0];
  assert.equal(t.selectedTask, null);
  assert.equal(t.result, null);
  assert.equal(t.status, 'done');
});

// ─── 9) 新しい順ソート＋複数スコープ ──────────────────────────────
check('複数ティックは startedAt 降順（新しい順）で返る', () => {
  const log = [
    '[2026-06-01 10:00:00 JST] [cxo] autonomous-worker tick start',
    '結果: green',
    '[2026-06-01 10:05:00 JST] [cxo] autonomous-worker tick done',
    '[2026-06-01 10:30:00 JST] [cxo] autonomous-worker tick start',
    '結果: green',
    '[2026-06-01 10:35:00 JST] [cxo] autonomous-worker tick done',
  ].join('\n');
  const ticks = parseTicksForTest(log, 'autonomous-cxo.log');
  assert.equal(ticks.length, 2);
  assert.equal(Date.parse(ticks[0].startedAt) >= Date.parse(ticks[1].startedAt), true);
});

console.log(`\nticks: ${failures === 0 ? 'all passed' : `${failures} FAILED`}`);
if (failures > 0) process.exit(1);
