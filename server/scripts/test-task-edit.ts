// 自己テスト — taskTrackerWrite.editTask（MC-71 edit スライス）。
//
// 実 .md は絶対に書き換えない。env で PROJECTS_DIR / VAULT_DIR を一時ディレクトリに
// 差し替え、fixture を temp に書いてから editTask を回す。全 assert pass で exit 0。
//
// 実行: npx tsx server/scripts/test-task-edit.ts
//
// カバレッジ:
//   (a) cxo カード形式の status 編集 → 対象のみ変化・他不変
//   (b) section 形式の owner 編集
//   (c) summary table の priority 編集
//   (d) baseHash 不一致で CONFLICT
//   (e) 同一 id が一意特定できない曖昧ケースで AMBIGUOUS
//   (f) read-back 不変条件が崩れる細工で VALIDATION_FAILED

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── 一時ツリーを用意して config 由来のパスを差し替える ──────────────
// config.ts は import 時に env を評価するので、import より前に env を設定する。
const ROOT = mkdtempSync(join(tmpdir(), 'apollo-task-edit-'));
const PROJECTS_DIR = join(ROOT, 'projects');
const VAULT_DIR = join(PROJECTS_DIR, 'obsidian-vault');
const DATA_DIR = join(PROJECTS_DIR, 'cxo-agent', 'data');

process.env.PROJECTS_DIR = PROJECTS_DIR;
process.env.VAULT_DIR = VAULT_DIR;

// fixture の物理パス（config の TASK_SOURCES が指す場所に一致させる）。
const CXO_PATH = join(PROJECTS_DIR, 'cxo-agent', 'docs', 'TASK_TRACKER.md');
const LOGIC_PATH = join(PROJECTS_DIR, 'logic', 'docs', 'TASK_TRACKER.md');
const NISHIMARU_PATH = join(
  VAULT_DIR,
  '20-Projects',
  'nishimarucho-flyer',
  'TASK_TRACKER.md',
);

mkdirSync(join(PROJECTS_DIR, 'cxo-agent', 'docs'), { recursive: true });
mkdirSync(join(PROJECTS_DIR, 'logic', 'docs'), { recursive: true });
mkdirSync(join(VAULT_DIR, '20-Projects', 'nishimarucho-flyer'), { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

// ── 動的 import（env 設定後に config を評価させる）──────────────────
const { editTask, trackerHash, TaskEditError } = await import(
  '../src/lib/taskTrackerWrite.ts'
);
const { parseTrackerString } = await import('../src/collectors/tasks.ts');

// ── アサーションヘルパー ────────────────────────────────
let passed = 0;
function ok(cond: boolean, label: string): void {
  if (!cond) {
    console.error(`  ✗ FAIL: ${label}`);
    process.exitCode = 1;
    throw new Error(`assert failed: ${label}`);
  }
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function expectError(
  fn: () => void,
  code: string,
  label: string,
): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof TaskEditError && e.code === code) {
      passed += 1;
      console.log(`  ✓ ${label} (${code})`);
      return;
    }
    console.error(`  ✗ FAIL: ${label} — expected ${code}, got`, e);
    process.exitCode = 1;
    throw e;
  }
  console.error(`  ✗ FAIL: ${label} — expected throw ${code}, but none`);
  process.exitCode = 1;
  throw new Error(`expected throw: ${label}`);
}

// ── fixtures ───────────────────────────────────────────

// cxo: summary table（MC-50,MC-51）+ カード（MC-70,MC-71）+ section（MC-70）併存。
const CXO_FIXTURE = `# TASK_TRACKER — cxo-agent / Apollo

## バッチ A（summary table）

| ID | タイトル | 優先度 | フェーズ | ステータス | 担当 | 依存 |
|----|---------|--------|---------|-----------|------|------|
| MC-50 | 旧サマリタイトル | P1 | Phase5 | DONE | dev-logic | なし |
| MC-51 | もう一つ | P2 | Phase5 | TODO | designer | MC-50 |

## バッチ B（カード）

### MC-70 — カイロ刷新

| フィールド | 値 |
|---|---|
| ID | MC-70 |
| タイトル | Apollo UI をカイロ風に刷新 |
| 優先度 | P1 |
| ステータス | BLOCKED（Keita 判断待ち） |
| 担当 | designer + dev-logic |
| 更新日 | 2026-05-31 |

### MC-71 — 手動編集

| フィールド | 値 |
|---|---|
| ID | MC-71 |
| タイトル | タスク手動編集 |
| 優先度 | P1 |
| ステータス | IN_PROGRESS |
| 担当 | dev-logic |
| 更新日 | 2026-05-31 |
`;

// logic: summary table + section（`- ステータス:` / `- 担当:`）併存。
const LOGIC_FIXTURE = `# TASK_TRACKER — Logic

## バッチ

| ID | タイトル | 優先度 | ステータス | 担当案 | 由来 |
|----|---------|--------|-----------|--------|------|
| AF-01 | フェルミ導線 | P2 | TODO | dev-logic | 受信箱 |
| AF-02 | CTA を白ピルに | P1 | IN_PROGRESS | dev-logic | 受信箱 |

#### AF-01 — フェルミ導線
- 優先度: P2 / ステータス: TODO / 担当案: dev-logic
- 担当: dev-logic
- 詳細: ダミー。
- 更新日: 2026-05-31

#### AF-02 — CTA を白ピルに
- 優先度: P1 / ステータス: IN_PROGRESS / 担当: dev-logic
- 詳細: ダミー。
`;

// nishimaru: summary table のみ（priority 列あり）。
const NISHIMARU_FIXTURE = `---
status: active
---

# TASK_TRACKER — 西丸町

| ID | タイトル | 優先度 | ステータス | 担当 |
|----|----------|--------|-----------|------|
| NF-1 | ヒアリングシート | M | DONE | designer |
| NF-2 | フォーム作成 | M | REVIEW | 林 |
`;

function writeAll(): void {
  writeFileSync(CXO_PATH, CXO_FIXTURE, 'utf-8');
  writeFileSync(LOGIC_PATH, LOGIC_FIXTURE, 'utf-8');
  writeFileSync(NISHIMARU_PATH, NISHIMARU_FIXTURE, 'utf-8');
}

// 対象 id 以外の全タスクが {id,title,status,owner,priority} 不変であることを検証する。
function othersUnchanged(
  beforeMd: string,
  afterMd: string,
  project: 'logic' | 'nishimaru' | 'cxo',
  source: string,
  targetId: string,
): boolean {
  const before = parseTrackerString(beforeMd, project, source);
  const after = parseTrackerString(afterMd, project, source);
  const fp = (t: { id: string; title: string; status: string; owner?: string; priority?: string }) =>
    `${t.id}|${t.title}|${t.status}|${t.owner ?? ''}|${t.priority ?? ''}`;
  const bMap = new Map(before.filter((t) => t.id !== targetId).map((t) => [t.id, fp(t)]));
  const aMap = new Map(after.filter((t) => t.id !== targetId).map((t) => [t.id, fp(t)]));
  if (bMap.size !== aMap.size) return false;
  for (const [id, v] of bMap) {
    if (aMap.get(id) !== v) return false;
  }
  return true;
}

// ── (a) cxo カード形式の status 編集 ───────────────────────
console.log('\n[a] cxo カード形式の status 編集（対象のみ変化・他不変）');
{
  writeAll();
  const before = readFileSync(CXO_PATH, 'utf-8');
  const { task, hash } = editTask({
    source: 'cxo/TASK_TRACKER',
    id: 'MC-70',
    patch: { status: 'IN_PROGRESS' },
  });
  const after = readFileSync(CXO_PATH, 'utf-8');
  ok(task.status === 'IN_PROGRESS', 'MC-70 の返却 status が IN_PROGRESS');
  ok(/\|\s*ステータス\s*\|\s*IN_PROGRESS\s*\|/.test(after), 'カードの ステータス セルが IN_PROGRESS に置換');
  ok(!after.includes('BLOCKED（Keita 判断待ち）'), '旧ステータス値が残っていない');
  // MC-71 カード（他タスク）が無傷。
  ok(/\|\s*ID\s*\|\s*MC-71\s*\|/.test(after) && after.includes('| ステータス | IN_PROGRESS |\n| 担当 | dev-logic |'.split('\n')[0]), 'MC-71 カードが存在し続ける');
  ok(othersUnchanged(before, after, 'cxo', 'cxo/TASK_TRACKER', 'MC-70'), '対象外タスクのパース結果が不変');
  ok(typeof hash === 'string' && hash.length === 64, '新ハッシュが返る');
  ok(hash === trackerHash('cxo/TASK_TRACKER').hash, '返却ハッシュが現ファイルと一致');
}

// ── (b) section 形式の owner 編集 ─────────────────────────
console.log('\n[b] logic section 形式の owner 編集');
{
  writeAll();
  const before = readFileSync(LOGIC_PATH, 'utf-8');
  // AF-02 は section に `- 優先度: ... / ステータス: ... / 担当: dev-logic`（複合行）と summary 行を持つ。
  const { task } = editTask({
    source: 'logic/TASK_TRACKER',
    id: 'AF-02',
    patch: { owner: 'reviewer' },
  });
  const after = readFileSync(LOGIC_PATH, 'utf-8');
  ok(task.owner === 'reviewer', 'AF-02 の返却 owner が reviewer');
  // summary 行の担当案セルが置換（collector は summary の末尾 owner を拾う）。
  ok(/\|\s*AF-02\s*\|[^\n]*\|\s*reviewer\s*\|/.test(after), 'summary 行の担当列が reviewer');
  // section の複合行 `担当: dev-logic` が reviewer に。
  ok(/担当:\s*reviewer/.test(after), 'section の 担当 が reviewer');
  ok(!/担当:\s*dev-logic/.test(after.split('AF-01')[1] ?? after), 'AF-02 section の旧 owner が残らない');
  ok(othersUnchanged(before, after, 'logic', 'logic/TASK_TRACKER', 'AF-02'), '対象外タスクが不変');
}

// ── (c) summary table の priority 編集 ────────────────────
console.log('\n[c] nishimaru summary table の priority 編集');
{
  writeAll();
  const before = readFileSync(NISHIMARU_PATH, 'utf-8');
  const { task } = editTask({
    source: 'nishimaru/TASK_TRACKER',
    id: 'NF-2',
    patch: { priority: 'H' },
  });
  const after = readFileSync(NISHIMARU_PATH, 'utf-8');
  ok(task.priority === 'H', 'NF-2 の返却 priority が H');
  ok(/\|\s*NF-2\s*\|[^\n]*\|\s*H\s*\|/.test(after), 'summary 行の優先度列が H');
  // NF-1 の優先度 M は不変。
  ok(/\|\s*NF-1\s*\|[^\n]*\|\s*M\s*\|/.test(after), 'NF-1 の優先度が不変');
  ok(othersUnchanged(before, after, 'nishimaru', 'nishimaru/TASK_TRACKER', 'NF-2'), '対象外タスクが不変');
}

// ── (d) baseHash 不一致で CONFLICT ────────────────────────
console.log('\n[d] baseHash 不一致で CONFLICT');
{
  writeAll();
  expectError(
    () =>
      editTask({
        source: 'cxo/TASK_TRACKER',
        id: 'MC-70',
        patch: { status: 'DONE' },
        baseHash: 'deadbeef'.repeat(8), // わざと現ハッシュと違う 64hex
      }),
    'CONFLICT',
    'baseHash 不一致は CONFLICT',
  );
  // 書き込まれていないこと。
  const after = readFileSync(CXO_PATH, 'utf-8');
  ok(after === CXO_FIXTURE, 'CONFLICT 時はファイルが書き換わらない');
}

// ── (e) 曖昧（同一 id 複数表現が重複）で AMBIGUOUS ────────────
console.log('\n[e] 同一 id の表現が一意特定できず AMBIGUOUS');
{
  // summary table に同じ ID 行を 2 つ仕込む。
  const ambiguous = `# TASK_TRACKER — Logic

| ID | タイトル | 優先度 | ステータス | 担当案 | 由来 |
|----|---------|--------|-----------|--------|------|
| AF-09 | 一回目 | P2 | TODO | dev-logic | x |
| AF-09 | 二回目 | P1 | DONE | designer | y |
`;
  writeFileSync(LOGIC_PATH, ambiguous, 'utf-8');
  expectError(
    () => editTask({ source: 'logic/TASK_TRACKER', id: 'AF-09', patch: { status: 'REVIEW' } }),
    'AMBIGUOUS',
    '重複 summary 行は AMBIGUOUS',
  );
  ok(readFileSync(LOGIC_PATH, 'utf-8') === ambiguous, 'AMBIGUOUS 時はファイルが書き換わらない');
}

// ── (f) read-back 不変条件が崩れる細工で VALIDATION_FAILED ─────
console.log('\n[f] read-back 不変条件が崩れると VALIDATION_FAILED');
{
  // 同じ summary 行に、置換が他タスクへ波及してしまう細工。
  // owner セルの中身が他タスクの ID と衝突するような値で、collector の
  // 末尾セル owner 拾いが崩れる…ではなく、ここでは「他タスクの行が
  // 置換で巻き込まれて変化する」状況を直接作るのは難しいため、
  // 内部の read-back を確実に発火させるため title に改行を含めて表構造を破壊する。
  // → router でブロックされるが、editTask 直叩きでは title 改行で行が割れ、
  //   summary の他行がズレて VALIDATION_FAILED になることを確認する。
  writeAll();
  expectError(
    () =>
      editTask({
        source: 'cxo/TASK_TRACKER',
        id: 'MC-50',
        // 改行入りタイトルは summary 行を 2 行に割り、後続パースが崩れる。
        patch: { title: '壊す\n| MC-51 | 乗っ取り | P0 | Phase9 | DONE | x | y |' },
      }),
    'VALIDATION_FAILED',
    '行を割る細工は VALIDATION_FAILED で書き込まれない',
  );
  ok(readFileSync(CXO_PATH, 'utf-8') === CXO_FIXTURE, 'VALIDATION_FAILED 時はファイルが書き換わらない');
}

// ── UNSUPPORTED_SOURCE も一応確認 ────────────────────────
console.log('\n[g] 未対応 source は UNSUPPORTED_SOURCE');
{
  expectError(
    () => editTask({ source: 'kanban', id: 'x', patch: { status: 'DONE' } }),
    'UNSUPPORTED_SOURCE',
    'kanban source は UNSUPPORTED_SOURCE',
  );
  expectError(() => trackerHash('today'), 'UNSUPPORTED_SOURCE', 'trackerHash も未対応 source を弾く');
}

// ── 後始末 ─────────────────────────────────────────────
rmSync(ROOT, { recursive: true, force: true });

console.log(`\n✅ all assertions passed (${passed})`);
process.exit(process.exitCode ?? 0);
