// search collector (MC-73)
//
// 司令塔の横断検索。1 つのクエリで以下を横断する:
//   - タスク     : collectTasks() の id / title / owner / priority / source を部分一致（日本語対応）
//   - エージェント: collectRoster() の name / role / summary を部分一致
//   - 会話       : collectAgents() の subagentType / description / lastAction（最新スニペット中心）
//   - workflow   : collectWorkflows() の runId / label / projectLabel
//   - Vault      : 既存 searchVault() を流用（VAULT_SEARCH_LIMIT 尊重）
//
// 設計方針:
//   - 既存 collector を流用し二重定義しない（tasks/roster/agents/workflows/vault）。
//     これらは内部に短期キャッシュ（agents 15s 等）を持つため、検索のたびに重い
//     フルスキャンが走らないようになっている。
//   - 会話は「全文走査」ではなく collectAgents() が既に抽出済みの最新スニペット
//     （lastAction）と種別ラベルに対してマッチする（重さの上限を構造的に担保）。
//   - カテゴリごとに上限（SEARCH_CATEGORY_LIMIT）を設け、各カテゴリの total（上限前の
//     総ヒット数）も返す。大量ヒットでもレスポンスが膨らまない。
//   - 各結果は web 側がクリック先を特定できるよう type / id を持つ。

import { collectTasks } from './tasks.js';
import { collectRoster } from './roster.js';
import { collectAgents } from './agents.js';
import { collectWorkflows } from './workflows.js';
import { searchVault } from './vault.js';
import type { ProjectName } from '../lib/projectMap.js';

/** カテゴリごとの返却上限件数（大量ヒット時の保護）。 */
export const SEARCH_CATEGORY_LIMIT = 20;

/** 検索結果 1 件の共通基底（web がクリック先を特定するための識別子付き）。 */
interface SearchResultBase {
  /** 結果種別。web のナビゲーション分岐に使う。 */
  type: 'task' | 'agent' | 'conversation' | 'workflow' | 'vault';
  /** クリック先を特定する識別子（task は task.id、agent/conversation は agentId 等）。 */
  id: string;
  /** 1 行目に出す表示用ラベル。 */
  label: string;
  /** 2 行目以降の補助テキスト（任意）。 */
  sublabel?: string;
  /** 一致箇所のスニペット（任意）。 */
  snippet?: string;
}

export interface TaskSearchResult extends SearchResultBase {
  type: 'task';
  /** TASK_TRACKER 由来の出典（web の TaskDetail 編集可否判定・auto-open に使う）。 */
  source: string;
  status: string;
  project: ProjectName;
}

export interface AgentSearchResult extends SearchResultBase {
  type: 'agent';
  /** roster 名（= subagent_type）。web は /agents の該当カードへ寄せる。 */
  name: string;
}

export interface ConversationSearchResult extends SearchResultBase {
  type: 'conversation';
  /** 実稼働 agentId。web は /agents/:agentId で会話ドロワーを開く。 */
  agentId: string;
  projectLabel: string;
}

export interface WorkflowSearchResult extends SearchResultBase {
  type: 'workflow';
  runId: string;
  /** 代表ノードの agentId（あれば）。web は /agents/:agentId へ寄せて会話に飛ぶ。 */
  agentId: string | null;
  projectLabel: string;
}

export interface VaultSearchResult extends SearchResultBase {
  type: 'vault';
  /** Vault 相対パス。web は /vault?path=... で開く。 */
  path: string;
}

/** カテゴリ別の検索結果。各カテゴリは上限付き配列 + total（上限前の総数）。 */
export interface SearchResponse {
  query: string;
  tasks: TaskSearchResult[];
  agents: AgentSearchResult[];
  conversations: ConversationSearchResult[];
  workflows: WorkflowSearchResult[];
  vault: VaultSearchResult[];
  totals: {
    tasks: number;
    agents: number;
    conversations: number;
    workflows: number;
    vault: number;
    all: number;
  };
  generatedAt: string;
}

/** 大文字小文字を無視した部分一致（日本語はそのまま含むかどうか）。 */
function includesCI(haystack: string | undefined | null, needleLower: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needleLower);
}

/** ヒットした最初のフィールドを短いスニペットにする。 */
function trimSnippet(s: string | undefined | null, max = 140): string {
  if (!s) return '';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/**
 * 横断検索本体。
 * 空クエリ・空白のみは全カテゴリ空で返す（クラッシュしない）。
 * @param rawQuery ユーザー入力のクエリ文字列。
 */
export function search(rawQuery: string): SearchResponse {
  const q = (rawQuery ?? '').trim();
  const now = new Date().toISOString();
  const empty: SearchResponse = {
    query: q,
    tasks: [],
    agents: [],
    conversations: [],
    workflows: [],
    vault: [],
    totals: { tasks: 0, agents: 0, conversations: 0, workflows: 0, vault: 0, all: 0 },
    generatedAt: now,
  };
  if (q === '') return empty;
  const qLower = q.toLowerCase();

  // ── タスク ─────────────────────────────────────────────
  const taskHitsAll: TaskSearchResult[] = [];
  for (const t of collectTasks()) {
    const matched =
      includesCI(t.id, qLower) ||
      includesCI(t.title, qLower) ||
      includesCI(t.owner, qLower) ||
      includesCI(t.priority, qLower) ||
      includesCI(t.source, qLower);
    if (!matched) continue;
    taskHitsAll.push({
      type: 'task',
      id: t.id,
      label: t.title || t.id,
      sublabel: [t.id, t.owner ? `担当: ${t.owner}` : null, t.source]
        .filter(Boolean)
        .join(' · '),
      source: t.source,
      status: t.status,
      project: t.project,
    });
  }

  // ── エージェント（台帳）─────────────────────────────────
  const agentHitsAll: AgentSearchResult[] = [];
  for (const r of collectRoster()) {
    const matched =
      includesCI(r.name, qLower) ||
      includesCI(r.role, qLower) ||
      includesCI(r.summary, qLower);
    if (!matched) continue;
    agentHitsAll.push({
      type: 'agent',
      id: r.name,
      name: r.name,
      label: r.name,
      sublabel: r.role ? trimSnippet(r.role, 80) : undefined,
      snippet: includesCI(r.summary, qLower) ? trimSnippet(r.summary) : undefined,
    });
  }

  // ── 会話（最新スニペット中心。全文走査はしない）──────────────
  const convHitsAll: ConversationSearchResult[] = [];
  for (const a of collectAgents()) {
    const matched =
      includesCI(a.subagentType, qLower) ||
      includesCI(a.description, qLower) ||
      includesCI(a.lastAction, qLower);
    if (!matched) continue;
    convHitsAll.push({
      type: 'conversation',
      id: a.agentId,
      agentId: a.agentId,
      label: a.subagentType,
      sublabel: a.projectLabel,
      projectLabel: a.projectLabel,
      snippet: includesCI(a.lastAction, qLower) ? trimSnippet(a.lastAction) : undefined,
    });
  }

  // ── workflow ──────────────────────────────────────────
  const wfHitsAll: WorkflowSearchResult[] = [];
  for (const w of collectWorkflows()) {
    const matched =
      includesCI(w.runId, qLower) ||
      includesCI(w.label, qLower) ||
      includesCI(w.projectLabel, qLower);
    if (!matched) continue;
    wfHitsAll.push({
      type: 'workflow',
      id: w.runId,
      runId: w.runId,
      // run のノード会話へ飛べるよう代表 agentId は web 側が詳細取得で解決する。
      // サマリには agentId を持たないため null（web は /tasks など既存面へフォールバック）。
      agentId: null,
      label: w.label || w.runId,
      sublabel: `${w.projectLabel} · ノード ${w.nodesDone}/${w.nodeCount}`,
      projectLabel: w.projectLabel,
    });
  }

  // ── Vault（既存 searchVault を流用。VAULT_SEARCH_LIMIT 尊重）──
  const vaultHits = searchVault(q);
  const vaultHitsAll: VaultSearchResult[] = vaultHits.map((h) => ({
    type: 'vault',
    id: h.path,
    path: h.path,
    label: h.title,
    sublabel: h.path,
    snippet: h.snippet ? trimSnippet(h.snippet) : undefined,
  }));

  const tasks = taskHitsAll.slice(0, SEARCH_CATEGORY_LIMIT);
  const agents = agentHitsAll.slice(0, SEARCH_CATEGORY_LIMIT);
  const conversations = convHitsAll.slice(0, SEARCH_CATEGORY_LIMIT);
  const workflows = wfHitsAll.slice(0, SEARCH_CATEGORY_LIMIT);
  const vault = vaultHitsAll.slice(0, SEARCH_CATEGORY_LIMIT);

  const totals = {
    tasks: taskHitsAll.length,
    agents: agentHitsAll.length,
    conversations: convHitsAll.length,
    workflows: wfHitsAll.length,
    vault: vaultHitsAll.length,
    all:
      taskHitsAll.length +
      agentHitsAll.length +
      convHitsAll.length +
      wfHitsAll.length +
      vaultHitsAll.length,
  };

  return {
    query: q,
    tasks,
    agents,
    conversations,
    workflows,
    vault,
    totals,
    generatedAt: now,
  };
}
