// taskTrackerAppend — 正本 TASK_TRACKER.md への「新規タスク追記」（MC-77 inbox 即時タスク化）。
//
// MC-71 の editTask は「既存タスクの 4 フィールド編集」専用で、新規タスクの追記はできない。
// inbox（Apollo 投入）から上がったタスクを手動消化を待たず即タスクボードに出すには、
// 投入時に TASK_TRACKER.md へ 1 タスク分のブロックを安全に追記する必要がある。
//
// 本モジュールは MC-71 と同じ安全契約を踏襲する:
//   a. source→パス解決（cxo/logic/nishimaru の 3 source のみ）。
//   b. 既存内容は一切書き換えない＝末尾に 1 ブロック「追記」するだけ（フルファイル再生成禁止）。
//      collector が card 形式（`| フィールド | 値 |` ＋ `| ID | <id> |` …）を 1 タスクとして拾うため、
//      summary table のセル位置に依存せず追記でき、既存表の崩れリスクがない。
//   c. 採番衝突を避けるため id は呼び出し側が next-task-id.sh 相当で決めて渡す（重複チェックは行う）。
//   d. 書き込み前 read-back 検証（parseTrackerString で old/new を比較）:
//        (i)  既存タスクの {id,title,status,owner,priority} が全て不変
//        (ii) 追記した id のタスクが collector に 1 件出現し、意図値になっている
//      崩れたら APPEND_VALIDATION_FAILED で中断（書き込まない）。
//   e. 検証通過時のみ atomic write（.tmp → renameSync）＋監査ログ 1 行追記。
//
// エラーは TaskAppendError（識別子付き）に統一し、router 側で HTTP にマップできる。

import { readFileSync, writeFileSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { TASK_SOURCES, CXO_TRACKER, TASK_EDITS_FILE } from '../config.js';
import { parseTrackerString, type Task, type TaskStatus } from '../collectors/tasks.js';
import type { ProjectName } from './projectMap.js';

// ─── 型 ───────────────────────────────────────────────

export type TaskAppendCode =
  | 'UNSUPPORTED_SOURCE'
  | 'DUPLICATE_ID'
  | 'VALIDATION_FAILED';

export class TaskAppendError extends Error {
  constructor(
    public readonly code: TaskAppendCode,
    message: string,
  ) {
    super(message);
    this.name = 'TaskAppendError';
  }
}

/** 追記する新規タスクの入力。title 以外はデフォルトで補える。 */
export interface NewTaskInput {
  id: string;
  title: string;
  status?: TaskStatus;
  owner?: string;
  priority?: string;
  /** 詳細本文（任意・改行は安全化される）。 */
  detail?: string;
  /** 由来（例: 'Apollo投入'）。詳細に併記される。 */
  source?: string;
}

interface SourceInfo {
  path: string;
  project: ProjectName;
  /** Apollo 投入の project 値（logic/cxo/en-chakai/null）→ どの TASK_TRACKER に書くか。 */
  trackerSource: string;
}

// ─── source（投入 project）→ パス / プロジェクト解決 ─────────────

/**
 * Apollo 投入の project 値を TASK_TRACKER パスへ解決する。
 *  - 'logic'           → logic/docs/TASK_TRACKER.md
 *  - 'cxo' / null/''   → cxo-agent/docs/TASK_TRACKER.md（デフォルト）
 * en-chakai は TASK_SOURCES 未登録のため当面 cxo に寄せる（collector が拾える台帳のみに限定）。
 */
export function resolveAppendTarget(project: string | null | undefined): SourceInfo {
  switch (project) {
    case 'logic':
      return {
        path: TASK_SOURCES.logicTracker,
        project: 'logic',
        trackerSource: 'logic/TASK_TRACKER',
      };
    case 'cxo':
    case null:
    case undefined:
    case '':
      return { path: CXO_TRACKER, project: 'cxo', trackerSource: 'cxo/TASK_TRACKER' };
    default:
      // en-chakai 等、collector 未対応の台帳は cxo に寄せる（fail-safe＝必ずボードに出す）。
      return { path: CXO_TRACKER, project: 'cxo', trackerSource: 'cxo/TASK_TRACKER' };
  }
}

/** project 値 → next-task-id.sh のプレフィックス（logic は LG、cxo は MC）。 */
export function prefixForProject(project: string | null | undefined): string {
  return project === 'logic' ? 'LG' : 'MC';
}

/**
 * next-task-id.sh 相当: 全 TASK_TRACKER を横断して指定プレフィックスの実在最大連番+1 を返す。
 * server 内で完結させ（grep スクリプトに依存せず）注入・採番レースを避ける。
 * 例: nextTaskId('MC') → 'MC-82'
 */
export function nextTaskId(prefix: string): string {
  const trackers = [
    TASK_SOURCES.logicTracker,
    CXO_TRACKER,
    TASK_SOURCES.nishimaruTracker,
  ];
  // en-chakai 台帳が将来 TASK_SOURCES に入ったら自動で対象に含めたいが、現状は上記 3 つ。
  const re = new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)`, 'g');
  let max = 0;
  for (const path of trackers) {
    if (!existsSync(path)) continue;
    let md: string;
    try {
      md = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(md)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}-${max + 1}`;
}

// ─── ハッシュ / サニタイズ ──────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

/**
 * markdown 表セルに入れる値を安全化する。
 *  - パイプ（|）はセル境界を壊すので全角に置換
 *  - 改行はセル内 <br> 化（行を割らない＝表崩れ防止）
 */
function cellSafe(s: string): string {
  return s.replace(/\|/g, '｜').replace(/\r?\n/g, '<br>').trim();
}

/** 見出し行に入れる値の安全化（改行・パイプを潰す）。 */
function headingSafe(s: string): string {
  return s.replace(/[\r\n|]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── タスクブロック生成 ─────────────────────────────────

/**
 * card 形式（collector の flushCard が 1 タスクとして拾う）でタスク 1 件を組み立てる。
 * summary table のセル位置に依存しないため、どの台帳でも安全に末尾追記できる。
 */
function buildTaskBlock(t: Required<Pick<NewTaskInput, 'id' | 'title' | 'status' | 'priority'>> & NewTaskInput): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`### ${headingSafe(t.id)} — ${headingSafe(t.title)}`);
  lines.push('');
  lines.push('| フィールド | 値 |');
  lines.push('|---|---|');
  lines.push(`| ID | ${cellSafe(t.id)} |`);
  lines.push(`| タイトル | ${cellSafe(t.title)} |`);
  lines.push(`| 優先度 | ${cellSafe(t.priority)} |`);
  lines.push(`| ステータス | ${cellSafe(t.status)} |`);
  lines.push(`| 担当 | ${cellSafe(t.owner ?? '未定')} |`);
  const detailParts: string[] = [];
  if (t.source) detailParts.push(`【${t.source}】`);
  if (t.detail) detailParts.push(t.detail);
  const detail = detailParts.join(' ').trim();
  lines.push(`| 詳細 | ${cellSafe(detail || t.title)} |`);
  lines.push(`| 更新日 | ${new Date().toISOString().slice(0, 10)} |`);
  lines.push('');
  return lines.join('\n');
}

// ─── 公開 API ───────────────────────────────────────────

export interface AppendTaskArgs {
  /** Apollo 投入 project 値（logic/cxo/en-chakai/null）。書き込み先 TASK_TRACKER を決める。 */
  project: string | null | undefined;
  task: NewTaskInput;
}

export interface AppendTaskResult {
  task: Task;
  hash: string;
  trackerSource: string;
}

/**
 * 正本 TASK_TRACKER.md に新規タスクを 1 件「末尾追記」する（fail-closed）。
 * 既存内容は一切書き換えない。read-back 検証通過時のみ atomic write。
 */
export function appendTask({ project, task }: AppendTaskArgs): AppendTaskResult {
  const { path, project: projectName, trackerSource } = resolveAppendTarget(project);

  const status: TaskStatus = task.status ?? 'TODO';
  const priority = task.priority ?? 'P2';

  const oldMd = existsSync(path) ? readFileSync(path, 'utf-8') : '';

  // 重複 id チェック（既に台帳に同 id があれば追記しない）。
  const oldTasks = parseTrackerString(oldMd, projectName, trackerSource);
  if (oldTasks.some((t) => t.id === task.id)) {
    throw new TaskAppendError('DUPLICATE_ID', `id ${task.id} は既に台帳に存在します。`);
  }

  const block = buildTaskBlock({
    ...task,
    id: task.id,
    title: task.title,
    status,
    priority,
  });

  // 末尾追記（既存末尾に改行が無ければ 1 つ補う）。
  const sep = oldMd.length > 0 && !oldMd.endsWith('\n') ? '\n' : '';
  const newMd = `${oldMd}${sep}${block}\n`;

  // read-back 検証: 既存タスク不変 ＋ 追記タスクが意図値で 1 件出現。
  const newTasks = parseTrackerString(newMd, projectName, trackerSource);
  assertExistingUnchanged(oldTasks, newTasks, task.id);
  const appended = newTasks.find((t) => t.id === task.id);
  if (!appended) {
    throw new TaskAppendError(
      'VALIDATION_FAILED',
      `追記検証に失敗しました（${task.id} が collector に出現しません）。`,
    );
  }
  if (
    appended.title !== task.title ||
    appended.status !== status ||
    (priority && appended.priority !== priority)
  ) {
    throw new TaskAppendError(
      'VALIDATION_FAILED',
      `追記検証に失敗しました（${task.id} の値が意図と一致しません）。`,
    );
  }

  // atomic write + 監査ログ。
  const newHash = sha256(newMd);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, newMd, 'utf-8');
  renameSync(tmp, path);

  try {
    appendFileSync(
      TASK_EDITS_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        op: 'append',
        source: trackerSource,
        id: task.id,
        title: task.title,
        status,
        priority,
        owner: task.owner ?? null,
        prevHash: oldMd ? sha256(oldMd) : null,
        newHash,
      }) + '\n',
      'utf-8',
    );
  } catch {
    // 監査追記失敗は本処理を巻き戻さない（追記は成立済み）。
  }

  return { task: appended, hash: newHash, trackerSource };
}

// ─── read-back 検証ヘルパー ──────────────────────────────

const COMPARE_FIELDS: (keyof Task)[] = ['id', 'title', 'status', 'owner', 'priority'];

function fingerprint(t: Task): string {
  return COMPARE_FIELDS.map((f) => `${f}=${t[f] ?? ''}`).join('|');
}

/** 追記した id 以外の既存タスクが完全に不変であることを検証する。 */
function assertExistingUnchanged(oldTasks: Task[], newTasks: Task[], newId: string): void {
  const oldMap = new Map(oldTasks.map((t) => [t.id, t]));
  const newMap = new Map(newTasks.filter((t) => t.id !== newId).map((t) => [t.id, t]));
  if (oldMap.size !== newMap.size) {
    throw new TaskAppendError(
      'VALIDATION_FAILED',
      '追記検証に失敗しました（既存タスクの件数が変化しました）。',
    );
  }
  for (const [id, oldT] of oldMap) {
    const newT = newMap.get(id);
    if (!newT || fingerprint(oldT) !== fingerprint(newT)) {
      throw new TaskAppendError(
        'VALIDATION_FAILED',
        `追記検証に失敗しました（既存タスク ${id} が変化しました）。`,
      );
    }
  }
}
