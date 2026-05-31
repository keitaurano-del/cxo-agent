// taskLinks collector (MC-62)
//
// タスク ID（MC-xx / FB-xx / UI-xx 等）と、それを動かした workflow run / agent 会話を
// 明示ログ data/task-links.jsonl で紐付ける（「堅い案＝明示ログ」方式）。
//
// ID 文字列マッチ（runId に MC-62 が含まれるか…）に頼らず、明示的に書かれた
// 組合せだけを正とすることで誤紐付けを構造的に排除する。
//
// task-links.jsonl の 1 行（= 1 リンク）形式:
//   {"taskId":"MC-62","runId":"wf_xxx","agentId":"...","label":"...","ts":"<ISO>"}
//   - taskId は必須。
//   - runId / agentId はどちらか一方（両方でも可）必須。両方欠ける行は無効として捨てる。
//   - label / ts は任意（UI 表示・並び替え補助）。
//
// 既存 lib を流用し二重定義しない:
//   jsonl.ts: readJsonl（壊れ行耐性・ファイル無しは空配列）, config.ts: TASK_LINKS_FILE。

import { readJsonl } from '../lib/jsonl.js';
import { TASK_LINKS_FILE } from '../config.js';

/** task-links.jsonl の 1 行（明示リンク）。 */
export interface TaskLink {
  taskId: string;
  runId?: string;
  agentId?: string;
  label?: string;
  ts?: string;
}

/** 1 タスクに紐づく runId / agentId の集合。 */
export interface TaskLinkSet {
  taskId: string;
  runIds: string[];
  agentIds: string[];
  links: TaskLink[];
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * task-links.jsonl を読み、有効なリンク行だけを TaskLink[] に正規化する。
 * - taskId 必須。runId / agentId のどちらか必須。両方欠ける行は捨てる。
 * - 壊れた行・ファイル無しは readJsonl 側で吸収（空配列）。
 */
export function readTaskLinks(): TaskLink[] {
  const lines = readJsonl(TASK_LINKS_FILE);
  const out: TaskLink[] = [];
  for (const l of lines) {
    const taskId = asStr(l.taskId);
    if (!taskId) continue;
    const runId = asStr(l.runId);
    const agentId = asStr(l.agentId);
    if (!runId && !agentId) continue; // どちらも無い行は無効
    out.push({
      taskId,
      runId,
      agentId,
      label: asStr(l.label),
      ts: asStr(l.ts),
    });
  }
  return out;
}

/** taskId 比較用の正規化（大小・空白・区切りゆれを吸収）。 */
function normTaskId(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * 指定タスクに「明示ログで」紐づく runId[] / agentId[] を返す。
 * 明示リンクが 1 件も無ければ runIds/agentIds は空（呼び出し側がフォールバック判断する）。
 */
export function linksForTask(taskId: string): TaskLinkSet {
  const want = normTaskId(taskId);
  const all = readTaskLinks();
  const runIds = new Set<string>();
  const agentIds = new Set<string>();
  const links: TaskLink[] = [];
  for (const link of all) {
    if (normTaskId(link.taskId) !== want) continue;
    links.push(link);
    if (link.runId) runIds.add(link.runId);
    if (link.agentId) agentIds.add(link.agentId);
  }
  return {
    taskId,
    runIds: [...runIds],
    agentIds: [...agentIds],
    links,
  };
}
