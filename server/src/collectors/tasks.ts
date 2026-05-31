// tasks collector
//
// 複数の markdown 台帳をパースして正規化タスク配列に統合する。
//   - logic/docs/TASK_TRACKER.md : `| ID | タイトル | 優先度 | 区分 | 担当 |` テーブル + 本文ステータス語
//   - obsidian 10-Tasks/kanban.md : `## 🔥 Now / 📋 Next / ✅ Done` 配下のチェックボックス + owner:/priority:/status:
//   - obsidian 10-Tasks/today.md  : Top 3 のチェックボックス
//   - nishimarucho-flyer/TASK_TRACKER.md : 同様のテーブル/チェックボックス

import { readFileSync, existsSync, statSync } from 'node:fs';
import { TASK_SOURCES, TASK_STALL_DAYS } from '../config.js';
import { projectFromPath, type ProjectName } from '../lib/projectMap.js';

export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'REVIEW'
  | 'DONE'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  owner?: string;
  priority?: string;
  project: ProjectName;
  source: string; // どの台帳由来か
  updated?: string; // ISO 日付（取れれば）
  stalled: boolean;
}

const STATUS_WORDS: TaskStatus[] = [
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'CANCELLED',
  'DONE',
  'TODO',
];

function normStatus(raw?: string | null): TaskStatus {
  if (!raw) return 'UNKNOWN';
  const u = raw.toUpperCase().replace(/[\s-]/g, '_');
  for (const s of STATUS_WORDS) {
    if (u.includes(s)) return s;
  }
  if (u.includes('進行')) return 'IN_PROGRESS';
  if (u.includes('完了') || u.includes('済')) return 'DONE';
  if (u.includes('ブロック')) return 'BLOCKED';
  if (u.includes('レビュー')) return 'REVIEW';
  return 'UNKNOWN';
}

function fileMtimeIso(path: string): string | undefined {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/** frontmatter から updated: を拾う。 */
function frontmatterUpdated(md: string): string | undefined {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return undefined;
  const m = fm[1].match(/updated:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return m ? `${m[1]}T00:00:00.000Z` : undefined;
}

function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

function markStalled(t: Omit<Task, 'stalled'>): Task {
  const stalled =
    t.status === 'IN_PROGRESS' && daysSince(t.updated) > TASK_STALL_DAYS;
  return { ...t, stalled };
}

// ─── logic / nishimaru TASK_TRACKER（テーブル形式）─────────────────

function parseTrackerTable(path: string, project: ProjectName, source: string): Task[] {
  if (!existsSync(path)) return [];
  const md = readFileSync(path, 'utf-8');
  const updated = frontmatterUpdated(md) ?? fileMtimeIso(path);
  return parseTrackerString(md, project, source, updated);
}

/**
 * TASK_TRACKER markdown 文字列をパースして Task 配列を返す（ファイル I/O 非依存）。
 * テスト・書き戻しの read-back 検証から「文字列を直接」渡せるよう切り出した内部 API。
 * 列構成 / セクション / `| フィールド | 値 |` カードの 3 形式併存に対応する。
 * @param updated frontmatter / mtime 由来の更新日時。collectTasks 経由では従来どおり付与する。
 */
export function parseTrackerString(
  md: string,
  project: ProjectName,
  source: string,
  updated?: string,
): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>();

  // テーブルは台帳ごとに列構成が違う:
  //   logic: | ID | タイトル | 優先度 | 区分 | 担当 |
  //   cxo:   | ID | タイトル | 優先度 | フェーズ | ステータス | 担当 | 依存 |
  // ヘッダ行から列名→index を引いて layout 非依存に拾う（無ければ位置フォールバック）。
  const lines = md.split('\n');
  let col: { priority?: number; owner?: number; status?: number } | null = null;

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    const id = cells[0];

    // ヘッダ行を検出して列マッピングを確定（最初の `| ID |` 行）。
    if (id === 'ID') {
      col = {};
      cells.forEach((h, i) => {
        if (/優先度|priority/i.test(h)) col!.priority = i;
        else if (/担当|owner|assignee/i.test(h)) col!.owner = i;
        else if (/ステータス|status|区分/i.test(h)) col!.status = i;
      });
      continue;
    }
    // 区切り行・非タスク行を除外
    if (!id || /^[-:]+$/.test(id) || id.includes('---')) continue;
    if (!/^[A-Za-z]/.test(id) && !/^\d/.test(id)) continue;
    const title = cells[1];
    if (!title) continue;
    const priority = cells[col?.priority ?? 2] || undefined;
    // owner: ヘッダで担当列が分かればそれを、無ければ末尾セル（logic 互換）。
    let owner = cells[col?.owner ?? cells.length - 1] || undefined;

    // 本文から該当 ID のステータス・担当を探す（### <ID> セクション内の「ステータス:」「担当:」）。
    // 台帳によってテーブルの列構成が違う（logic は ID|タイトル|優先度|区分|担当、
    // cxo は ID|タイトル|優先度|フェーズ|ステータス|担当|依存）ため、
    // セクション本文の `- ステータス: ... / 担当: ...` を一次ソースにする。
    let status: TaskStatus = 'UNKNOWN';
    let sectionOwner: string | undefined;
    const secRe = new RegExp(
      `###?[^\\n]*${escapeReg(id)}[\\s\\S]*?(?=\\n###?\\s|$)`,
    );
    const sec = md.match(secRe);
    if (sec) {
      const sm = sec[0].match(/ステータス[:：*\s]*([A-Za-z_/ ]+)/);
      if (sm) status = normStatus(sm[1]);
      const om = sec[0].match(/担当[:：]\s*([^\n/]+)/);
      if (om) sectionOwner = om[1].replace(/\*/g, '').trim() || undefined;
    }
    if (status === 'UNKNOWN') {
      // セクションが無い台帳向け（gate 行など）: ヘッダ由来のステータス列から拾う。
      // 列が特定できない場合は cells[4]（cxo）→ cells[3]（logic 区分）の順でフォールバック。
      const statusIdx = col?.status;
      if (statusIdx !== undefined) status = normStatus(cells[statusIdx]);
      if (status === 'UNKNOWN') {
        status = normStatus(cells[4]) !== 'UNKNOWN' ? normStatus(cells[4]) : normStatus(cells[3]);
      }
    }
    if (sectionOwner) owner = sectionOwner;

    const key = `${source}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      markStalled({ id, title, status, owner, priority, project, source, updated }),
    );
  }
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── kanban.md / today.md（チェックボックス形式）──────────────────

function parseCheckboxBoard(
  path: string,
  source: string,
  defaultProject: ProjectName,
): Task[] {
  if (!existsSync(path)) return [];
  const md = readFileSync(path, 'utf-8');
  const updated = frontmatterUpdated(md) ?? fileMtimeIso(path);
  const out: Task[] = [];
  const lines = md.split('\n');

  // セクション見出し → ステータス
  let sectionStatus: TaskStatus = 'UNKNOWN';
  let idx = 0;

  let current: (Omit<Task, 'stalled'> & { _hasStatus?: boolean }) | null = null;
  const flush = () => {
    if (current) {
      out.push(markStalled(current));
      current = null;
    }
  };

  for (const line of lines) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      flush();
      const title = h[1];
      if (/now|進行/i.test(title)) sectionStatus = 'IN_PROGRESS';
      else if (/next|近日|todo/i.test(title)) sectionStatus = 'TODO';
      else if (/done|完了|✅/i.test(title)) sectionStatus = 'DONE';
      else if (/block|ブロック/i.test(title)) sectionStatus = 'BLOCKED';
      else if (/review|レビュー/i.test(title)) sectionStatus = 'REVIEW';
      else sectionStatus = 'UNKNOWN';
      continue;
    }

    // チェックボックス: - [ ] **title** #tags  /  1. [ ] **title**
    const cb = line.match(/^\s*(?:[-*]|\d+\.)\s*\[( |x|X)\]\s*(.*)$/);
    if (cb) {
      flush();
      const checked = cb[1].toLowerCase() === 'x';
      let title = cb[2].replace(/\*\*/g, '').replace(/`#[^`]+`/g, '').replace(/#\S+/g, '').trim();
      title = title.replace(/\s+/g, ' ').trim();
      idx += 1;
      current = {
        id: `${source}-${idx}`,
        title: title || '(無題)',
        status: checked ? 'DONE' : sectionStatus === 'UNKNOWN' ? 'TODO' : sectionStatus,
        project: projectFromTags(line, defaultProject),
        source,
        updated,
      };
      continue;
    }

    // 子行: owner:/priority:/status:
    if (current) {
      const ow = line.match(/owner[:：]\s*(.+)/i);
      if (ow) current.owner = ow[1].trim();
      const pr = line.match(/priority[:：]\s*(.+)/i);
      if (pr) current.priority = pr[1].trim();
      const stt = line.match(/status[:：]\s*(.+)/i);
      if (stt) {
        const s = normStatus(stt[1]);
        if (s !== 'UNKNOWN') current.status = s;
      }
    }
  }
  flush();
  return out;
}

/** 行内の `#logic` 等のタグからプロジェクト推定。無ければ default。 */
function projectFromTags(line: string, fallback: ProjectName): ProjectName {
  const lower = line.toLowerCase();
  const p = projectFromPath(lower);
  if (p !== 'other') return p;
  return fallback;
}

// ─── 統合 ──────────────────────────────────────────────

export function collectTasks(): Task[] {
  const tasks: Task[] = [];
  tasks.push(...parseTrackerTable(TASK_SOURCES.logicTracker, 'logic', 'logic/TASK_TRACKER'));
  tasks.push(
    ...parseTrackerTable(TASK_SOURCES.nishimaruTracker, 'nishimaru', 'nishimaru/TASK_TRACKER'),
  );
  // cxo 自身の台帳もパース対象（ドッグフーディング: 自分の MC-xx を Kanban に出す）。
  tasks.push(...parseTrackerTable(TASK_SOURCES.cxoTracker, 'cxo', 'cxo/TASK_TRACKER'));
  tasks.push(...parseCheckboxBoard(TASK_SOURCES.kanban, 'kanban', 'private'));
  tasks.push(...parseCheckboxBoard(TASK_SOURCES.today, 'today', 'private'));
  return tasks;
}
