// agents collector
//
// ~/.claude/projects/**/subagents/**/agent-*.jsonl を列挙・解析し、
// 各エージェントの稼働状態・最新作業スニペット・会話フィードを返す。

import { readdirSync, statSync, lstatSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { CLAUDE_PROJECTS_DIR } from '../config.js';
import { readJsonl, lastActivity, firstText, type JsonlLine } from '../lib/jsonl.js';
import { projectFromPath, projectLabel, type ProjectName } from '../lib/projectMap.js';
import { agentStatus, type AgentStatus } from '../lib/stall.js';
import { redactText } from '../lib/redact.js';
import {
  AgentTypeIndex,
  indexParentSession,
  type AgentSpec,
} from '../lib/agentMap.js';

export interface AgentSummary {
  agentId: string;
  subagentType: string;
  description?: string;
  matched: boolean; // Agent tool_use と照合できたか（false は cwd 暫定ラベル）
  project: ProjectName;
  projectLabel: string;
  status: AgentStatus;
  lastActivity: string;
  lastAction: string; // 最新の作業内容スニペット
  sessionId: string;
  isWorkflow: boolean;
  filePath: string;
  cwd?: string;
  gitBranch?: string;
  messageCount: number;
}

export interface FeedItem {
  ts: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  kind: 'text' | 'tool_use' | 'tool_result' | 'other';
  toolName?: string;
  text: string;
}

interface WalkResult {
  parents: string[];
  subagents: string[];
}

/** ~/.claude/projects を再帰walk。壊れた symlink は飛ばす。 */
function walkJsonl(dir: string, acc: WalkResult): WalkResult {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = lstatSync(p);
      if (st.isSymbolicLink()) {
        // symlink 先が壊れていることがある。statSync で安全確認。
        st = statSync(p);
      }
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkJsonl(p, acc);
    } else if (st.isFile() && e.endsWith('.jsonl')) {
      if (p.includes('/subagents/')) {
        // subagent バケットは agent-*.jsonl のみ対象。
        // journal.jsonl 等（subagents/workflows/wf_*/journal.jsonl）の非エージェント
        // jsonl を除外する。誤収集すると done カウントが水増しされる（121→108 に正常化）。
        if (e.startsWith('agent-')) acc.subagents.push(p);
      } else {
        // 親セッションは <sessionId>.jsonl 命名なので agent- 接頭辞は付かない。
        // agentMap の index 構築に必要なため、こちらは広く拾う。
        acc.parents.push(p);
      }
    }
  }
  return acc;
}

/** 結果に result 行が含まれるか（done 判定用）。 */
function hasResultLine(lines: JsonlLine[]): boolean {
  for (const l of lines) {
    if (l.type === 'result') return true;
  }
  return false;
}

/** 最新の意味のある作業スニペットを抽出（末尾の assistant text を優先）。 */
function latestActionSnippet(lines: JsonlLine[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.type === 'assistant') {
      const t = firstText(l.message?.content);
      if (t && t.trim()) return t.trim().replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  // フォールバック: 先頭 user text（= タスク指示）
  for (const l of lines) {
    if (l.type === 'user') {
      const t = firstText(l.message?.content);
      if (t && t.trim()) return t.trim().replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  return '';
}

/** subagent ファイルの先頭 user メッセージテキスト。 */
function firstUserText(lines: JsonlLine[]): string | null {
  for (const l of lines) {
    if (l.type === 'user' && l.message) {
      const t = firstText(l.message.content);
      if (t) return t;
    }
  }
  return null;
}

let cachedIndex: AgentTypeIndex | null = null;
let cachedIndexAt = 0;
const INDEX_TTL_MS = 15000;

/** 親セッション全部から Agent tool_use index を構築（短期キャッシュ）。 */
function buildIndex(parents: string[]): AgentTypeIndex {
  const now = Date.now();
  if (cachedIndex && now - cachedIndexAt < INDEX_TTL_MS) return cachedIndex;
  const idx = new AgentTypeIndex();
  for (const f of parents) indexParentSession(f, idx);
  cachedIndex = idx;
  cachedIndexAt = now;
  return idx;
}

/** subagent ファイル 1 本を解析して AgentSummary に。 */
function analyzeSubagent(filePath: string, index: AgentTypeIndex): AgentSummary {
  const lines = readJsonl(filePath);
  const head = lines[0];
  const cwd = head?.cwd;
  const gitBranch = head?.gitBranch;
  const sessionId = head?.sessionId ?? '';
  const agentId =
    head?.agentId ?? basename(filePath).replace(/^agent-/, '').replace(/\.jsonl$/, '');
  const isWorkflow = filePath.includes('/subagents/workflows/');

  const ut = firstUserText(lines);
  const spec: AgentSpec | null = index.lookup(ut);

  // cwd ベースの暫定ラベル（matched できなかった時）
  const project = projectFromPath(cwd ?? filePath);
  let subagentType: string;
  let matched: boolean;
  let description: string | undefined;
  if (spec) {
    subagentType = spec.subagentType;
    description = spec.description;
    matched = true;
  } else {
    subagentType = isWorkflow ? `workflow:${project}` : `unmatched:${project}`;
    matched = false;
  }

  const hadAnyActivity = lines.length > 0;
  const last = lastActivity(filePath, lines);
  const status = agentStatus({
    lastActivity: last,
    hasResult: hasResultLine(lines),
    hadAnyActivity,
  });

  return {
    agentId,
    subagentType,
    description,
    matched,
    project,
    projectLabel: projectLabel(project),
    status,
    lastActivity: last,
    lastAction: redactText(latestActionSnippet(lines)),
    sessionId,
    isWorkflow,
    filePath,
    cwd,
    gitBranch,
    messageCount: lines.length,
  };
}

// collectAgents は全 jsonl をフルスキャンするため、SSE による再フェッチ頻度が
// 上がると負荷が出る。15 秒の短期キャッシュで連続呼び出しを吸収する
// （リアルタイム性は 15 秒粒度で十分。watch broadcast → frontend 再フェッチ間隔とも整合）。
let cachedAgents: AgentSummary[] | null = null;
let cachedAgentsAt = 0;
const AGENTS_TTL_MS = 15000;

function computeAgents(): AgentSummary[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];
  const walk = walkJsonl(CLAUDE_PROJECTS_DIR, { parents: [], subagents: [] });
  const index = buildIndex(walk.parents);
  const out = walk.subagents.map((f) => analyzeSubagent(f, index));
  out.sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
  return out;
}

/** 全 subagent の稼働サマリ一覧（15 秒キャッシュ）。最終活動の新しい順。 */
export function collectAgents(): AgentSummary[] {
  const now = Date.now();
  if (cachedAgents && now - cachedAgentsAt < AGENTS_TTL_MS) return cachedAgents;
  cachedAgents = computeAgents();
  cachedAgentsAt = now;
  return cachedAgents;
}

/** 特定 agentId の会話タイムライン（user/assistant/tool を時系列）。 */
export function collectAgentFeed(agentId: string): FeedItem[] | null {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return null;
  const walk = walkJsonl(CLAUDE_PROJECTS_DIR, { parents: [], subagents: [] });
  const file = walk.subagents.find((f) => {
    if (basename(f).includes(agentId)) return true;
    const lines = readJsonl(f);
    return lines[0]?.agentId === agentId;
  });
  if (!file) return null;

  const lines = readJsonl(file);
  const feed: FeedItem[] = [];
  for (const l of lines) {
    const ts = l.timestamp ?? '';
    const content = l.message?.content;
    if (l.type === 'assistant' && Array.isArray(content)) {
      for (const block of content as any[]) {
        if (block.type === 'text' && block.text?.trim()) {
          feed.push({ ts, role: 'assistant', kind: 'text', text: redactText(block.text.trim()) });
        } else if (block.type === 'tool_use') {
          feed.push({
            ts,
            role: 'assistant',
            kind: 'tool_use',
            toolName: block.name,
            text: redactText(summarizeToolInput(block.name, block.input)),
          });
        }
      }
    } else if (l.type === 'user') {
      if (typeof content === 'string') {
        feed.push({ ts, role: 'user', kind: 'text', text: redactText(content.trim()) });
      } else if (Array.isArray(content)) {
        for (const block of content as any[]) {
          if (block.type === 'text' && block.text?.trim()) {
            feed.push({ ts, role: 'user', kind: 'text', text: redactText(block.text.trim()) });
          } else if (block.type === 'tool_result') {
            feed.push({
              ts,
              role: 'tool',
              kind: 'tool_result',
              text: redactText(summarizeToolResult(block.content)),
            });
          }
        }
      }
    } else if (l.type === 'system') {
      const t = firstText(content);
      if (t) feed.push({ ts, role: 'system', kind: 'other', text: redactText(t.slice(0, 300)) });
    }
  }
  return feed;
}

function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return name;
  const i = input as Record<string, unknown>;
  const pick =
    (typeof i.command === 'string' && i.command) ||
    (typeof i.description === 'string' && i.description) ||
    (typeof i.file_path === 'string' && i.file_path) ||
    (typeof i.pattern === 'string' && i.pattern) ||
    (typeof i.prompt === 'string' && (i.prompt as string).slice(0, 160)) ||
    '';
  return pick ? `${name}: ${String(pick).slice(0, 200)}` : name;
}

function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').slice(0, 200);
  if (Array.isArray(content)) {
    const t = content.find((c: any) => c?.type === 'text');
    if (t && typeof (t as any).text === 'string') {
      return (t as any).text.replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  return '[tool result]';
}
