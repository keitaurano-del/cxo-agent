// roster collector
//
// 60-Agents/*.md の役割定義（frontmatter + 本文見出し）を読み、
// agents collector の稼働状態とマージできる形（agent名キー）で返す。

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROSTER_DIR, ROSTER_VISIBLE } from '../config.js';
import { collectAgents, type AgentSummary } from './agents.js';
import type { AgentStatus } from '../lib/stall.js';

export interface RosterEntry {
  name: string; // ファイル名ベース（= subagent_type に対応）
  persona?: string; // 人格名（frontmatter persona、例「蓮（れん）」）
  personality?: string; // 気質（frontmatter personality、1〜2文）
  role?: string;
  agentType?: string;
  phase?: string;
  summary: string; // 本文冒頭（役割説明）
  updated?: string;
  // 稼働マージ
  liveStatus?: AgentStatus;
  activeCount: number;
  idleCount: number;
  lastActivity?: string;
  currentProject?: string;
}

// 60-Agents/ に置かれている非エージェント md は除外
const NON_AGENT_FILES = new Set(['HISTORY.md', 'README.md']);

function parseFrontmatter(md: string): Record<string, string> {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const out: Record<string, string> = {};
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** frontmatter を除いた本文の最初の意味ある段落。 */
function firstParagraph(md: string): string {
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const lines = body.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t.replace(/\s+/g, ' ').slice(0, 300);
  }
  return '';
}

/**
 * roster 名 → agents の稼働を集計するためのマッチ。
 * subagentType（例 "dev-logic"）と roster ファイル名（"dev-logic"）を突き合わせる。
 */
function mergeLive(name: string, agents: AgentSummary[]): Partial<RosterEntry> {
  const mine = agents.filter(
    (a) => a.subagentType === name || a.subagentType.includes(name),
  );
  if (mine.length === 0) return { activeCount: 0, idleCount: 0 };
  const active = mine.filter((a) => a.status === 'active');
  const idle = mine.filter((a) => a.status === 'idle');
  // 最新活動のものを代表に
  const latest = mine.reduce((a, b) =>
    Date.parse(a.lastActivity) >= Date.parse(b.lastActivity) ? a : b,
  );
  return {
    activeCount: active.length,
    idleCount: idle.length,
    liveStatus: latest.status,
    lastActivity: latest.lastActivity,
    currentProject: latest.projectLabel,
  };
}

export function collectRoster(): RosterEntry[] {
  if (!existsSync(ROSTER_DIR)) return [];
  let files: string[];
  try {
    files = readdirSync(ROSTER_DIR);
  } catch {
    return [];
  }
  const agents = collectAgents();
  const out: RosterEntry[] = [];
  for (const f of files) {
    if (!f.endsWith('.md') || NON_AGENT_FILES.has(f)) continue;
    const abs = join(ROSTER_DIR, f);
    let md = '';
    let updated: string | undefined;
    try {
      md = readFileSync(abs, 'utf-8');
      updated = statSync(abs).mtime.toISOString();
    } catch {
      continue;
    }
    const name = f.replace(/\.md$/, '');
    // 表示対象 allowlist（MC-75）。人格保有＋主要エージェントのみ出し、
    // バックグラウンドの非主要 md が 60-Agents/ に増えても自動で隠す。
    if (!ROSTER_VISIBLE.has(name)) continue;
    const fm = parseFrontmatter(md);
    const live = mergeLive(name, agents);
    out.push({
      name,
      persona: fm.persona || undefined,
      personality: fm.personality || undefined,
      role: fm.role,
      agentType: fm.agent_type,
      phase: fm.phase,
      summary: firstParagraph(md),
      updated: fm.updated ? `${fm.updated}T00:00:00.000Z` : updated,
      activeCount: live.activeCount ?? 0,
      idleCount: live.idleCount ?? 0,
      liveStatus: live.liveStatus,
      lastActivity: live.lastActivity,
      currentProject: live.currentProject,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
