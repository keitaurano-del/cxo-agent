// workflows collector (MC-60)
//
// /workflows ツールが作る各 run を解析する。
// レイアウト（実測）:
//   ~/.claude/projects/<encoded-cwd>/subagents/workflows/wf_<id>/
//     agent-<agentId>.jsonl       … 孫エージェントの会話本体（message.usage でトークン）
//     agent-<agentId>.meta.json   … {"agentType":"reviewer"} など。そのノードの subagent 種別
//     journal.jsonl               … workflow イベントログ（started / result 行）
//
// journal.jsonl の行形:
//   {"type":"started","key":"v2:<hash>","agentId":"<agentId>"}
//   {"type":"result","key":"v2:<hash>","agentId":"<agentId>","result":{...自由形式...}}
//
// journal には phase 区切りもラベルも無いため:
//   - 1 run を 1 フェーズ（"phase":"run"）として束ね、孫 agent をその配下ノードに並べる。
//   - ノードのラベルは meta.json の agentType（無ければ agentId 短縮）。
//   - プロジェクトは run dir の親パス（encoded cwd）から projectFromPath で判定。
//   - 各ノードの状態は stall.ts(8分) を再利用（既存 agentStatus と同基準）。
//
// 既存 lib を流用し二重定義しない:
//   jsonl.ts: readJsonl / lastActivity, projectMap.ts: projectFromPath / projectLabel,
//   stall.ts: agentStatus / minutesSince, config.ts: CLAUDE_PROJECTS_DIR / STALL_MINUTES.

import { readdirSync, statSync, lstatSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { CLAUDE_PROJECTS_DIR, STALL_MINUTES } from '../config.js';
import { readJsonl, lastActivity, type JsonlLine } from '../lib/jsonl.js';
import { projectFromPath, projectLabel, type ProjectName } from '../lib/projectMap.js';
import { agentStatus, minutesSince, type AgentStatus } from '../lib/stall.js';

/** 孫エージェント（ノード）1 体のサマリ。 */
export interface WorkflowNode {
  agentId: string;
  /** meta.json の agentType（取れなければ agentId の短縮）。 */
  label: string;
  agentType: string | null;
  status: AgentStatus; // active / idle / done / never
  lastActivity: string; // ISO
  stalledMinutes: number; // 最終活動からの経過分（active なら 0 近傍）
  tokensIn: number; // input + cache_creation + cache_read
  tokensOut: number;
  messageCount: number;
}

/** フェーズ。journal に区切りが無いため現状 1 run = 1 phase。 */
export interface WorkflowPhase {
  id: string;
  name: string;
  status: AgentStatus;
  nodes: WorkflowNode[];
}

/** GET /api/workflows の 1 要素（run サマリ）。 */
export interface WorkflowSummary {
  runId: string;
  label: string;
  project: ProjectName;
  projectLabel: string;
  status: AgentStatus;
  createdAt: string; // ISO（最古ノード活動。不明なら epoch0）
  lastActivity: string; // ISO（最新ノード活動。不明なら epoch0）
  stalledMinutes: number;
  phaseCount: number;
  phasesDone: number;
  nodeCount: number;
  nodesDone: number;
  tokensIn: number;
  tokensOut: number;
}

/** GET /api/workflows/:runId の詳細（フェーズ + 孫ツリー）。 */
export interface WorkflowDetail extends WorkflowSummary {
  phases: WorkflowPhase[];
}

interface RunDir {
  dir: string;
  runId: string;
  project: ProjectName;
}

/** journal の result 行から status 文字列を拾う（あれば）。 */
function resultStatus(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const s = (result as Record<string, unknown>).status;
    if (typeof s === 'string') return s;
    const v = (result as Record<string, unknown>).verdict;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** ~/.claude/projects 配下の wf_* run ディレクトリを全列挙（壊れた symlink は飛ばす）。 */
function discoverRuns(): RunDir[] {
  const runs: RunDir[] = [];
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return runs;

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return runs;
  }

  for (const projDir of projectDirs) {
    // 各 project エンコードdir 配下の **/subagents/workflows を浅く探索する。
    // 実レイアウトは <encoded-cwd>/<sessionId>/subagents/workflows と
    // <encoded-cwd>/subagents/workflows の両方がありうるので両対応。
    const projPath = join(CLAUDE_PROJECTS_DIR, projDir);
    collectWfRoots(projPath, projDir, runs, 0);
  }
  return runs;
}

/** projPath を最大 depth まで降りて subagents/workflows/wf_* を集める。 */
function collectWfRoots(
  dir: string,
  encodedProject: string,
  out: RunDir[],
  depth: number,
): void {
  if (depth > 3) return;

  const wfRoot = join(dir, 'subagents', 'workflows');
  if (existsSync(wfRoot)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(wfRoot);
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.startsWith('wf_')) continue;
      const runDir = join(wfRoot, e);
      let st;
      try {
        st = statSync(runDir);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        out.push({
          dir: runDir,
          runId: e,
          project: projectFromPath(encodedProject),
        });
      }
    }
  }

  // session id 配下にも workflows がぶら下がるので 1 段下も見る。
  let children: string[] = [];
  try {
    children = readdirSync(dir);
  } catch {
    return;
  }
  for (const c of children) {
    if (c === 'subagents' || c === 'workflows') continue;
    const cp = join(dir, c);
    let st;
    try {
      st = lstatSync(cp);
      if (st.isSymbolicLink()) st = statSync(cp);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectWfRoots(cp, encodedProject, out, depth + 1);
  }
}

/** agent-*.jsonl のトークン合算（input 系 + output）。 */
function sumTokens(lines: JsonlLine[]): { tokensIn: number; tokensOut: number } {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const l of lines) {
    if (l.type !== 'assistant') continue;
    const usage = (l.message as { usage?: Record<string, unknown> } | undefined)?.usage;
    if (!usage || typeof usage !== 'object') continue;
    tokensIn +=
      num(usage.input_tokens) +
      num(usage.cache_creation_input_tokens) +
      num(usage.cache_read_input_tokens);
    tokensOut += num(usage.output_tokens);
  }
  return { tokensIn, tokensOut };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** meta.json から agentType を読む（無ければ null）。壊れていても例外を吐かない。 */
function readAgentType(metaPath: string): string | null {
  try {
    const raw = readFileSync(metaPath, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && typeof obj.agentType === 'string') {
      return obj.agentType;
    }
  } catch {
    // 壊れ/欠損は null
  }
  return null;
}

/** journal.jsonl を読み、agentId ごとの started/result 有無を集計する。 */
function parseJournal(runDir: string): {
  doneIds: Set<string>;
  startedIds: Set<string>;
  statusById: Map<string, string>;
} {
  const doneIds = new Set<string>();
  const startedIds = new Set<string>();
  const statusById = new Map<string, string>();

  const lines = readJsonl(join(runDir, 'journal.jsonl'));
  for (const l of lines) {
    const agentId = typeof l.agentId === 'string' ? l.agentId : undefined;
    if (!agentId) continue;
    if (l.type === 'started') {
      startedIds.add(agentId);
    } else if (l.type === 'result') {
      doneIds.add(agentId);
      const s = resultStatus((l as Record<string, unknown>).result);
      if (s) statusById.set(agentId, s);
    }
  }
  return { doneIds, startedIds, statusById };
}

/** 1 run を解析して詳細を組み立てる。壊れた run でも throw しない。 */
function analyzeRun(run: RunDir): WorkflowDetail {
  const journal = parseJournal(run.dir);

  let files: string[] = [];
  try {
    files = readdirSync(run.dir);
  } catch {
    files = [];
  }
  const agentFiles = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));

  const nodes: WorkflowNode[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let nodesDone = 0;
  let anyError = false;
  let minActivityMs = Infinity;
  let maxActivityMs = 0;

  for (const f of agentFiles) {
    const filePath = join(run.dir, f);
    const agentId = basename(f).replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const metaPath = join(run.dir, `agent-${agentId}.meta.json`);
    const agentType = readAgentType(metaPath);

    const lines = readJsonl(filePath);
    const last = lastActivity(filePath, lines);
    const t = sumTokens(lines);
    tokensIn += t.tokensIn;
    tokensOut += t.tokensOut;

    const lastMs = Date.parse(last);
    if (Number.isFinite(lastMs)) {
      if (lastMs < minActivityMs) minActivityMs = lastMs;
      if (lastMs > maxActivityMs) maxActivityMs = lastMs;
    }

    // journal の result 行があれば done。result の status が 'error' 等なら反映。
    const journalStatus = journal.statusById.get(agentId);
    const isError =
      journalStatus === 'error' || journalStatus === 'failed' || journalStatus === 'reject';
    const hasResult = journal.doneIds.has(agentId);

    let status = agentStatus({
      lastActivity: last,
      hasResult,
      hadAnyActivity: lines.length > 0,
    });
    if (isError) {
      anyError = true;
    } else if (status === 'done') {
      nodesDone++;
    }

    const mins = minutesSince(last);
    nodes.push({
      agentId,
      label: agentType ?? agentId.slice(0, 8),
      agentType,
      status,
      lastActivity: last,
      stalledMinutes: Number.isFinite(mins) ? Math.round(mins) : 0,
      tokensIn: t.tokensIn,
      tokensOut: t.tokensOut,
      messageCount: lines.length,
    });
  }

  // 活動時刻の新しい順にノードを並べる。
  nodes.sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));

  const createdAt =
    minActivityMs === Infinity ? new Date(0).toISOString() : new Date(minActivityMs).toISOString();
  const lastActivityIso =
    maxActivityMs === 0 ? new Date(0).toISOString() : new Date(maxActivityMs).toISOString();

  // run 状態:
  //   error: いずれかノードが error
  //   done : ノードが 1 つ以上あり全て done
  //   active/idle: 最新活動が 8 分しきい値以内かどうか
  const nodeCount = nodes.length;
  let runStatus: AgentStatus;
  if (anyError) {
    runStatus = 'error' as AgentStatus;
  } else if (nodeCount > 0 && nodesDone === nodeCount) {
    runStatus = 'done';
  } else if (nodeCount === 0) {
    runStatus = 'never';
  } else {
    runStatus = minutesSince(lastActivityIso) < STALL_MINUTES ? 'active' : 'idle';
  }

  const phase: WorkflowPhase = {
    id: 'run',
    name: 'run',
    status: runStatus,
    nodes,
  };

  const runStallMin = minutesSince(lastActivityIso);

  return {
    runId: run.runId,
    label: run.runId,
    project: run.project,
    projectLabel: projectLabel(run.project),
    status: runStatus,
    createdAt,
    lastActivity: lastActivityIso,
    stalledMinutes: Number.isFinite(runStallMin) ? Math.round(runStallMin) : 0,
    phaseCount: 1,
    phasesDone: runStatus === 'done' ? 1 : 0,
    nodeCount,
    nodesDone,
    tokensIn,
    tokensOut,
    phases: [phase],
  };
}

/** GET /api/workflows — 全 run のサマリ（最終活動の新しい順）。run 0 件なら空配列。 */
export function collectWorkflows(): WorkflowSummary[] {
  const runs = discoverRuns();
  const out: WorkflowSummary[] = [];
  for (const run of runs) {
    try {
      const detail = analyzeRun(run);
      // phases を落としてサマリだけ返す
      const { phases: _phases, ...summary } = detail;
      void _phases;
      out.push(summary);
    } catch {
      // 壊れた 1 run で全体を落とさない
    }
  }
  out.sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
  return out;
}

/** GET /api/workflows/:runId — 1 run のフェーズ + 孫ツリー詳細。未発見は null。 */
export function collectWorkflowDetail(runId: string): WorkflowDetail | null {
  const runs = discoverRuns();
  const match = runs.find((r) => r.runId === runId);
  if (!match) return null;
  try {
    return analyzeRun(match);
  } catch {
    return null;
  }
}
