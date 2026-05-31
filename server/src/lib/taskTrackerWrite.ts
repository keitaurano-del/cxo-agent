// taskTrackerWrite — 正本 TASK_TRACKER.md へのタスク手動編集（MC-71 edit スライス）。
//
// Apollo の TaskDetail から title/status/owner/priority を編集し、正本 .md に
// 安全に書き戻す。overlay は使わない（.md が単一の正本）。書き戻しは fail-closed:
//   a. source→パス解決。logic/nishimaru/cxo の 3 source のみ対応。
//   b. sha256 楽観ロック（baseHash と現在ハッシュが不一致なら CONFLICT）。
//   c. id で対象タスクのブロックを特定し、存在する全表現を更新:
//        ① `### ...<id>...` セクションの `- ステータス:` `- 担当:` 行
//        ② `| フィールド | 値 |` カード（`| ID | <id> |` を含む表ブロック）
//        ③ summary table の `| <id> | ... |` 行の各列セル
//      どの表現でも一意に特定できない/曖昧なら AMBIGUOUS で中断。フルファイル
//      再生成は禁止＝該当行/セルのみ置換する。
//   d. 書き込み前に read-back 検証（parseTrackerString で old/new を比較）:
//        (i) 対象 id のタスクが patch の各フィールド = 意図値（表現単位でも裏取り）
//        (ii) 対象 id 以外の全タスクの {id,title,status,owner,priority} が不変
//      崩れたら VALIDATION_FAILED で中断（書き込まない）。
//   e. 検証通過時のみ atomic write（.tmp → renameSync）＋監査ログ 1 行追記。
//
// エラーは TaskEditError（識別子付き）に統一し、router で HTTP にマップする。

import { readFileSync, writeFileSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { TASK_SOURCES, TASK_EDITS_FILE } from '../config.js';
import {
  parseTrackerString,
  type Task,
  type TaskStatus,
} from '../collectors/tasks.js';
import type { ProjectName } from './projectMap.js';

// ─── 型 ───────────────────────────────────────────────

/** 編集を許可する 4 フィールドの部分集合。 */
export interface TaskPatch {
  title?: string;
  status?: TaskStatus;
  owner?: string;
  priority?: string;
}

/** 識別子付きエラー（router が HTTP ステータスへマップする）。 */
export type TaskEditCode =
  | 'UNSUPPORTED_SOURCE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'AMBIGUOUS'
  | 'VALIDATION_FAILED'
  // 読込〜書込の間に別プロセス（autonomous-rin 等）が同じ台帳を書き換えた（TOCTOU）。
  // patch 適用は成功していたが書込直前に下地が変わったので中断した状態。再読込してリトライ可能。
  | 'RACE_RETRY';

export class TaskEditError extends Error {
  constructor(
    public readonly code: TaskEditCode,
    message: string,
  ) {
    super(message);
    this.name = 'TaskEditError';
  }
}

/** TaskStatus の正準 6 語（UNKNOWN は編集値として許可しない）。 */
export const EDITABLE_STATUS: readonly TaskStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'DONE',
  'CANCELLED',
];

// ─── source → パス / プロジェクト解決 ─────────────────────

interface SourceInfo {
  path: string;
  project: ProjectName;
}

/**
 * source 文字列を物理パスとプロジェクト名に解決する。
 * 編集可能なのは logic/nishimaru/cxo の TASK_TRACKER のみ。
 * kanban/today/その他は UNSUPPORTED_SOURCE。
 */
function resolveSource(source: string): SourceInfo {
  switch (source) {
    case 'logic/TASK_TRACKER':
      return { path: TASK_SOURCES.logicTracker, project: 'logic' };
    case 'nishimaru/TASK_TRACKER':
      return { path: TASK_SOURCES.nishimaruTracker, project: 'nishimaru' };
    case 'cxo/TASK_TRACKER':
      return { path: TASK_SOURCES.cxoTracker, project: 'cxo' };
    default:
      throw new TaskEditError(
        'UNSUPPORTED_SOURCE',
        `この台帳の項目は Apollo から編集できません（source=${source}）。`,
      );
  }
}

// ─── ハッシュ ──────────────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GET /hash 用。現在の台帳内容の sha256 を返す（未対応 source はエラー）。 */
export function trackerHash(source: string): { hash: string } {
  const { path } = resolveSource(source);
  const md = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  return { hash: sha256(md) };
}

// ─── フィールド ↔ ラベル ────────────────────────────────

// markdown 上のフィールド見出し（カード行 / セクション行で使う日本語ラベル）。
const FIELD_LABEL: Record<keyof TaskPatch, string> = {
  title: 'タイトル',
  status: 'ステータス',
  owner: '担当',
  priority: '優先度',
};

// ─── 行/セル単位の安全な置換ヘルパー ─────────────────────

/**
 * `| <key> | <value> |` 形式のカード行（2 セル表）の値セルだけを差し替える。
 * 行頭・末尾の空白とパイプ書式は保持し、値部分のみ newVal に置換する。
 * 該当行が一意でなければ呼び出し側で AMBIGUOUS 判定する。
 */
function replaceCardCell(line: string, newVal: string): string {
  // 例: "| ステータス | 旧値 |" → "| ステータス | 新値 |"
  // 先頭2セル（フィールド名・値）+ 末尾パイプ。値内パイプは台帳に出ない前提。
  const m = line.match(/^(\s*\|[^|]*\|)([^|]*)(\|.*)$/);
  if (!m) return line;
  // 値セルの前後スペースを 1 個ずつ確保して見た目を保つ。
  return `${m[1]} ${newVal} ${m[3].replace(/^\s*/, '')}`;
}

interface SummaryColMap {
  id: number;
  title?: number;
  priority?: number;
  status?: number;
  owner?: number;
  total: number;
}

/** summary table のヘッダ行（`| ID | タイトル | ... |`）から列 index を引く。 */
function parseSummaryHeader(line: string): SummaryColMap | null {
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 2 || cells[0] !== 'ID') return null;
  const col: SummaryColMap = { id: 0, total: cells.length };
  cells.forEach((h, i) => {
    if (i === 0) return;
    if (/^タイトル$|title/i.test(h)) col.title = i;
    else if (/優先度|priority/i.test(h)) col.priority = i;
    else if (/ステータス|status|区分/i.test(h)) col.status = i;
    else if (/担当|owner|assignee/i.test(h)) col.owner = i;
  });
  return col;
}

/**
 * summary table の 1 データ行のうち、指定 col index のセルだけを置換する。
 * 区切り（`|---|`）行とセル境界は壊さない。
 */
function replaceSummaryCell(line: string, colIdx: number, newVal: string): string {
  // 先頭/末尾パイプを保ったままセル配列を作る。split('|') は先頭・末尾に '' を生む。
  const parts = line.split('|');
  // parts[0]='' , parts[1..n]=各セル, parts[last]='' （行末が | の場合）
  // データセルは parts[1..] に対応（cells[i] = parts[i+1]）。
  const target = colIdx + 1;
  if (target >= parts.length) return line;
  // 元セルの前後スペース幅を踏襲（見た目維持）。
  const orig = parts[target];
  const lead = orig.match(/^\s*/)?.[0] ?? ' ';
  const trail = orig.match(/\s*$/)?.[0] ?? ' ';
  parts[target] = `${lead || ' '}${newVal}${trail || ' '}`;
  return parts.join('|');
}

// ─── 1 つの表現に対する patch 適用 ───────────────────────

interface ApplyResult {
  md: string;
  touched: boolean; // この表現が存在し、更新が発生したか
}

/**
 * `### ...<id>...` セクション内の `- <ラベル>: 値` 行を patch で書き換える。
 * セクションは「次の同/上位レベル見出しまで」を範囲とする。
 * セクションが無ければ touched=false。複数セクションヒットは AMBIGUOUS。
 */
function applyToSection(md: string, id: string, patch: TaskPatch): ApplyResult {
  const lines = md.split('\n');
  // `### ... <id> ...` の見出し行 index を集める（# の数は問わず id を含む見出し）。
  const headIdxs: number[] = [];
  const idRe = new RegExp(`(^|[^\\w-])${escapeReg(id)}([^\\w-]|$)`);
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^#{2,6}\s/.test(l) && idRe.test(l)) headIdxs.push(i);
  }
  if (headIdxs.length === 0) return { md, touched: false };
  if (headIdxs.length > 1) {
    throw new TaskEditError(
      'AMBIGUOUS',
      `id ${id} のセクション見出しが複数あり一意に特定できません。`,
    );
  }
  const start = headIdxs[0];
  const headLevel = (lines[start].match(/^(#{2,6})/)?.[1] ?? '##').length;
  // セクション終端 = 次の同レベル以上の見出し（より少ない/等しい # 数）まで。
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{2,6})\s/);
    if (m && m[1].length <= headLevel) {
      end = i;
      break;
    }
  }
  let touched = false;
  for (const [field, value] of Object.entries(patch) as [keyof TaskPatch, string][]) {
    if (field === 'title') continue; // title はセクション見出し自体なので別扱い（後述）。
    const label = FIELD_LABEL[field];
    // `- ステータス: X` 単独行も `- 優先度: P1 / ステータス: X / 担当: Y` 複合行も拾えるよう、
    // 行頭固定ではなく「行内に `<label>:` を含む」で検出し、rewriteInlineField で当該区間のみ置換。
    // `担当案` のような別ラベルを誤検出しないよう、label の直前が単語境界（行頭/非ラベル文字）であることを要求。
    const lineRe = new RegExp(`(^|[\\s/|・])${escapeReg(label)}\\s*[:：]`);
    const hits: number[] = [];
    for (let i = start; i < end; i += 1) {
      if (lineRe.test(lines[i])) hits.push(i);
    }
    if (hits.length === 0) continue;
    for (const i of hits) {
      // 同一行に複数フィールドが「 / 」区切りで載るケース（`- ステータス: X / 担当: Y`）に対応。
      lines[i] = rewriteInlineField(lines[i], label, value);
      touched = true;
    }
  }
  // title はセクション見出し（`### <id> — 旧title ...`）の dash 以降を置換する。
  if (patch.title !== undefined) {
    const head = lines[start];
    // `### MC-70 — 旧タイトル [meta]` の "— " 以降を新タイトルに。dash が無ければ id の後ろに付ける。
    const dashM = head.match(/^(#{2,6}\s+[^\n]*?\s[—–-]\s)(.*)$/);
    if (dashM) {
      lines[start] = `${dashM[1]}${patch.title}`;
      touched = true;
    }
  }
  return { md: lines.join('\n'), touched };
}

/**
 * 1 行内の `<ラベ>: 値` 区間だけを置換する。
 * 同一行が `- ステータス: X / 担当: Y` の様な複合でも、対象ラベルの値だけを差し替える
 * （次の ` / ` または行末までを値とみなす）。
 */
function rewriteInlineField(line: string, label: string, value: string): string {
  // 直前の単語境界（行頭/空白/区切り）をキャプチャして保持し、`担当案` 等の誤マッチを防ぐ。
  const re = new RegExp(`(^|[\\s/|・])(${escapeReg(label)}\\s*[:：]\\s*)([^/]*?)(\\s*(?:/|$))`);
  return line.replace(re, (_m, lead: string, pre: string, _old: string, tail: string) => {
    // tail が ' / ' のときは値の後ろにスペースを 1 つ残して区切りを保つ。
    const sep = tail.includes('/') ? ' /' : '';
    return `${lead}${pre}${value}${sep}`;
  });
}

/**
 * `| フィールド | 値 |` カード（`| ID | <id> |` を含む 2 セル表ブロック）を patch で更新。
 * カードが無ければ touched=false。`| ID | <id> |` 行が複数なら AMBIGUOUS。
 */
function applyToCard(md: string, id: string, patch: TaskPatch): ApplyResult {
  const lines = md.split('\n');
  // `| ID | <id> |`（前後空白許容）を厳密一致で探す。
  const idRowRe = new RegExp(`^\\s*\\|\\s*ID\\s*\\|\\s*${escapeReg(id)}\\s*\\|\\s*$`);
  const idRows: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (idRowRe.test(lines[i])) idRows.push(i);
  }
  if (idRows.length === 0) return { md, touched: false };
  if (idRows.length > 1) {
    throw new TaskEditError(
      'AMBIGUOUS',
      `id ${id} のカード（| ID | ${id} |）が複数あり一意に特定できません。`,
    );
  }
  const idRow = idRows[0];
  // カードブロック範囲 = idRow を含む連続した `| ... |` 行群。
  let top = idRow;
  while (top - 1 >= 0 && /^\s*\|.*\|\s*$/.test(lines[top - 1])) top -= 1;
  let bottom = idRow;
  while (bottom + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[bottom + 1])) bottom += 1;

  let touched = false;
  for (const [field, value] of Object.entries(patch) as [keyof TaskPatch, string][]) {
    const label = FIELD_LABEL[field];
    const cellRe = new RegExp(`^\\s*\\|\\s*${escapeReg(label)}\\s*\\|`);
    const hits: number[] = [];
    for (let i = top; i <= bottom; i += 1) {
      if (cellRe.test(lines[i])) hits.push(i);
    }
    if (hits.length === 0) continue;
    if (hits.length > 1) {
      throw new TaskEditError(
        'AMBIGUOUS',
        `id ${id} のカード内で「${label}」行が複数あり一意に特定できません。`,
      );
    }
    lines[hits[0]] = replaceCardCell(lines[hits[0]], value);
    touched = true;
  }
  return { md: lines.join('\n'), touched };
}

/**
 * summary table（`| ID | タイトル | 優先度 | ... | ステータス | 担当 | ... |`）の
 * `| <id> | ... |` データ行の該当列セルを patch で更新する。
 * 行が無ければ touched=false。複数ヒットは AMBIGUOUS。
 */
function applyToSummary(md: string, id: string, patch: TaskPatch): ApplyResult {
  const lines = md.split('\n');
  // 直近のヘッダ行を辿りながら、id で始まるデータ行を探す。
  let curCol: SummaryColMap | null = null;
  const dataRows: { idx: number; col: SummaryColMap }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) {
      // 表が途切れたら列マップを破棄（次表で取り直す）。
      if (line.trim() !== '') curCol = null;
      continue;
    }
    const header = parseSummaryHeader(line);
    if (header) {
      curCol = header;
      continue;
    }
    if (!curCol) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (cells[0] !== id) continue;
    dataRows.push({ idx: i, col: curCol });
  }
  if (dataRows.length === 0) return { md, touched: false };
  if (dataRows.length > 1) {
    throw new TaskEditError(
      'AMBIGUOUS',
      `id ${id} の summary table 行が複数あり一意に特定できません。`,
    );
  }
  const { idx, col } = dataRows[0];
  let line = lines[idx];
  let touched = false;
  const colFor: Record<keyof TaskPatch, number | undefined> = {
    title: col.title,
    status: col.status,
    owner: col.owner,
    priority: col.priority,
  };
  for (const [field, value] of Object.entries(patch) as [keyof TaskPatch, string][]) {
    const ci = colFor[field];
    if (ci === undefined) continue; // この台帳の summary table にその列が無い。
    line = replaceSummaryCell(line, ci, value);
    touched = true;
  }
  lines[idx] = line;
  return { md: lines.join('\n'), touched };
}

// ─── read-back 検証 ────────────────────────────────────

const COMPARE_FIELDS: (keyof Task)[] = ['id', 'title', 'status', 'owner', 'priority'];

function taskFingerprint(t: Task): string {
  return COMPARE_FIELDS.map((f) => `${f}=${t[f] ?? ''}`).join('|');
}

/**
 * old/new のパース結果を比較し、対象 id 以外が完全に不変であることを検証する。
 * 不変条件が崩れていれば VALIDATION_FAILED。
 */
function assertOthersUnchanged(
  oldTasks: Task[],
  newTasks: Task[],
  id: string,
): void {
  const oldMap = new Map(oldTasks.filter((t) => t.id !== id).map((t) => [t.id, t]));
  const newMap = new Map(newTasks.filter((t) => t.id !== id).map((t) => [t.id, t]));
  if (oldMap.size !== newMap.size) {
    throw new TaskEditError(
      'VALIDATION_FAILED',
      '書き戻し検証に失敗しました（対象外タスクの件数が変化）。',
    );
  }
  for (const [otherId, oldT] of oldMap) {
    const newT = newMap.get(otherId);
    if (!newT || taskFingerprint(oldT) !== taskFingerprint(newT)) {
      throw new TaskEditError(
        'VALIDATION_FAILED',
        `書き戻し検証に失敗しました（対象外タスク ${otherId} が変化）。`,
      );
    }
  }
}

/**
 * 更新後 md から「対象 id の各表現が意図値になっているか」を直接裏取りする。
 * カード形式タスクは collector が Task として emit しないため、グローバルパースに
 * 依存せず、表現ごとに値を抽出して assert する（fail-closed の核）。
 */
function assertTargetApplied(newMd: string, id: string, patch: TaskPatch): void {
  for (const [field, value] of Object.entries(patch) as [keyof TaskPatch, string][]) {
    const label = FIELD_LABEL[field];
    const found = extractFieldValues(newMd, id, field, label);
    if (found.length === 0) continue; // この表現が存在しない（card/section/summary のいずれか欠如）。
    for (const got of found) {
      if (normalizeForCompare(got) !== normalizeForCompare(value)) {
        throw new TaskEditError(
          'VALIDATION_FAILED',
          `書き戻し検証に失敗しました（${id} の ${label} が意図値になっていません）。`,
        );
      }
    }
  }
}

function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 対象 id の field 値を全表現（card / summary / section）から抽出する。 */
function extractFieldValues(
  md: string,
  id: string,
  field: keyof TaskPatch,
  label: string,
): string[] {
  const lines = md.split('\n');
  const out: string[] = [];

  // (1) カード: idRow を含むブロック内の `| <label> | <値> |`
  const idRowRe = new RegExp(`^\\s*\\|\\s*ID\\s*\\|\\s*${escapeReg(id)}\\s*\\|\\s*$`);
  for (let i = 0; i < lines.length; i += 1) {
    if (!idRowRe.test(lines[i])) continue;
    let top = i;
    while (top - 1 >= 0 && /^\s*\|.*\|\s*$/.test(lines[top - 1])) top -= 1;
    let bottom = i;
    while (bottom + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[bottom + 1])) bottom += 1;
    const cellRe = new RegExp(`^\\s*\\|\\s*${escapeReg(label)}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`);
    for (let j = top; j <= bottom; j += 1) {
      const m = lines[j].match(cellRe);
      if (m) out.push(m[1]);
    }
  }

  // (2) summary table: 直近ヘッダの列 index から該当セル。
  {
    let curCol: SummaryColMap | null = null;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!/^\s*\|/.test(line)) {
        if (line.trim() !== '') curCol = null;
        continue;
      }
      const header = parseSummaryHeader(line);
      if (header) {
        curCol = header;
        continue;
      }
      if (!curCol) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 2 || cells[0] !== id) continue;
      const colMap: Record<keyof TaskPatch, number | undefined> = {
        title: curCol.title,
        status: curCol.status,
        owner: curCol.owner,
        priority: curCol.priority,
      };
      const ci = colMap[field];
      if (ci !== undefined && ci < cells.length) out.push(cells[ci]);
    }
  }

  // (3) section: `### ...<id>...` 内の `- <label>: 値` 行（title は見出しの dash 以降）。
  {
    const idRe = new RegExp(`(^|[^\\w-])${escapeReg(id)}([^\\w-]|$)`);
    for (let i = 0; i < lines.length; i += 1) {
      if (!(/^#{2,6}\s/.test(lines[i]) && idRe.test(lines[i]))) continue;
      const headLevel = (lines[i].match(/^(#{2,6})/)?.[1] ?? '##').length;
      let end = lines.length;
      for (let k = i + 1; k < lines.length; k += 1) {
        const hm = lines[k].match(/^(#{2,6})\s/);
        if (hm && hm[1].length <= headLevel) {
          end = k;
          break;
        }
      }
      if (field === 'title') {
        const dm = lines[i].match(/^#{2,6}\s+[^\n]*?\s[—–-]\s(.*)$/);
        if (dm) out.push(dm[1]);
      } else {
        const fieldRe = new RegExp(
          `(?:^|[\\s/|・])${escapeReg(label)}\\s*[:：]\\s*([^/]*?)(?:\\s*/|\\s*$)`,
        );
        for (let k = i; k < end; k += 1) {
          const m = lines[k].match(fieldRe);
          if (m) out.push(m[1]);
        }
      }
    }
  }
  return out;
}

// ─── 公開 API ───────────────────────────────────────────

export interface EditTaskArgs {
  source: string;
  id: string;
  patch: TaskPatch;
  baseHash?: string;
}

export interface EditTaskResult {
  task: Task;
  hash: string;
}

/**
 * 正本 TASK_TRACKER.md の 1 タスクを編集して書き戻す（fail-closed）。
 * 成功時は更新後の Task（collector と同じ正規化）と新ハッシュを返す。
 */
export function editTask({ source, id, patch, baseHash }: EditTaskArgs): EditTaskResult {
  const { path, project } = resolveSource(source);

  // a/b. 読込 + 楽観ロック。
  if (!existsSync(path)) {
    throw new TaskEditError('NOT_FOUND', `台帳ファイルが見つかりません（${source}）。`);
  }
  const oldMd = readFileSync(path, 'utf-8');
  const currentHash = sha256(oldMd);
  if (baseHash !== undefined && baseHash !== currentHash) {
    throw new TaskEditError(
      'CONFLICT',
      '他の更新と競合しました（楽観ロック不一致）。再読み込みしてください。',
    );
  }

  // c. 全表現に patch を適用（該当行/セルのみ置換、フルファイル再生成しない）。
  let newMd = oldMd;
  let anyTouched = false;
  const card = applyToCard(newMd, id, patch);
  newMd = card.md;
  anyTouched = anyTouched || card.touched;
  const summary = applyToSummary(newMd, id, patch);
  newMd = summary.md;
  anyTouched = anyTouched || summary.touched;
  const section = applyToSection(newMd, id, patch);
  newMd = section.md;
  anyTouched = anyTouched || section.touched;

  if (!anyTouched) {
    // どの表現にも id が見つからない＝対象不明。
    throw new TaskEditError(
      'NOT_FOUND',
      `id ${id} が台帳のどの表現にも見つかりません（${source}）。`,
    );
  }

  // d. read-back 検証（書き込み前）。
  const oldTasks = parseTrackerString(oldMd, project, source);
  const newTasks = parseTrackerString(newMd, project, source);
  assertOthersUnchanged(oldTasks, newTasks, id);
  assertTargetApplied(newMd, id, patch);

  // e. atomic write + 監査ログ。
  // TOCTOU ガード: 読込（a）から書込までの間に別プロセス（autonomous-rin / apollo-keeper /
  // task-manager 等が並行で同じ台帳に書く）がファイルを変えていないか、書込直前に再確認する。
  // 変わっていたら今回の patch は古い下地に対して適用したものなので、上書きすると他者の
  // 変更を握り潰す。RACE_RETRY を投げて呼び出し側（承認フロー）に「最新を読み直して再試行」
  // させる。これにより baseHash 楽観ロックに頼らずとも他者の変更を保護できる。
  const beforeWriteMd = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  if (sha256(beforeWriteMd) !== currentHash) {
    throw new TaskEditError(
      'RACE_RETRY',
      '書き込み直前に台帳が別プロセスにより更新されました（再読み込みして再試行します）。',
    );
  }
  const newHash = sha256(newMd);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, newMd, 'utf-8');
  renameSync(tmp, path);

  try {
    appendFileSync(
      TASK_EDITS_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        source,
        id,
        patch,
        prevHash: currentHash,
        newHash,
      }) + '\n',
      'utf-8',
    );
  } catch {
    // 監査ログ追記失敗は本処理を巻き戻さない（書き戻しは成立済み）。記録のみベストエフォート。
  }

  // 返却用 Task: 更新後パースに対象 id があればそれを、無ければ（カード等）合成して返す。
  const updated =
    newTasks.find((t) => t.id === id) ?? synthesizeTask(newMd, id, project, source);
  return { task: updated, hash: newHash };
}

/**
 * collector が emit しない表現（カードのみ等）の対象 Task を、表現抽出で合成する。
 * UI のローカル表示更新用。stalled は updated 不明のため false 固定。
 */
function synthesizeTask(
  md: string,
  id: string,
  project: ProjectName,
  source: string,
): Task {
  const pick = (field: keyof TaskPatch, label: string): string | undefined => {
    const vals = extractFieldValues(md, id, field, label);
    return vals.length > 0 ? vals[0] : undefined;
  };
  const rawStatus = pick('status', FIELD_LABEL.status);
  const status = normalizeStatusWord(rawStatus);
  return {
    id,
    title: pick('title', FIELD_LABEL.title) ?? id,
    status,
    owner: pick('owner', FIELD_LABEL.owner),
    priority: pick('priority', FIELD_LABEL.priority),
    project,
    source,
    stalled: false,
  };
}

/** 抽出した生ステータス文字列を正準 6 語に寄せる（先頭一致で拾う）。 */
function normalizeStatusWord(raw?: string): TaskStatus {
  if (!raw) return 'UNKNOWN';
  const u = raw.toUpperCase();
  for (const s of EDITABLE_STATUS) {
    if (u.includes(s)) return s;
  }
  return 'UNKNOWN';
}
