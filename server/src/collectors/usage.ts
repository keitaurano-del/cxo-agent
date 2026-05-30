// usage collector
//
// ~/.claude/projects 配下の全 jsonl を走査し、assistant 行の message.usage を
// トークン種別（input / output / cache_creation / cache_read）ごとに合算する。
// グルーピングは「全体 / プロジェクト別 / モデル別」、時間窓は「直近1時間 / 当日(JST) / 全期間」。
//
// 全走査は重いので 5 分（USAGE_TTL_MS）のメモリキャッシュで連続要求を吸収する。
// 当日窓に無関係なファイルは mtime で early-skip し、全期間カウントのみ加算して
// 大量ファイルでも詰まらないようにする。

import { readdirSync, statSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_PROJECTS_DIR, USAGE_TTL_MS } from '../config.js';
import { readJsonl, type JsonlLine } from '../lib/jsonl.js';
import { projectFromPath, projectLabel, type ProjectName } from '../lib/projectMap.js';

/** トークン種別ごとの内訳。total = 4 種の合計（総消費）。 */
export interface TokenBreakdown {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  /** input + output + cacheCreation + cacheRead。総消費トークン。 */
  total: number;
  /** 集計に寄与した assistant メッセージ数。 */
  messages: number;
}

/** プロジェクト別の集計（全期間ベース）。 */
export interface ProjectUsage extends TokenBreakdown {
  project: ProjectName;
  projectLabel: string;
}

/** モデル別の集計（全期間ベース）。 */
export interface ModelUsage extends TokenBreakdown {
  model: string;
}

/** 時間窓ごとの集計。 */
export interface WindowUsage {
  lastHour: TokenBreakdown;
  today: TokenBreakdown;
  all: TokenBreakdown;
}

export interface UsageSummary {
  generatedAt: string;
  /** キャッシュから返したか（true なら再走査せず前回結果）。 */
  cached: boolean;
  /** 走査した jsonl ファイル数。 */
  fileCount: number;
  /** 全期間の総合計。フロントの大見出し用。 */
  totals: TokenBreakdown;
  byProject: ProjectUsage[];
  byModel: ModelUsage[];
  windows: WindowUsage;
}

function emptyBreakdown(): TokenBreakdown {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0, messages: 0 };
}

/** raw usage オブジェクトから 4 種トークンを accumulate に加算。 */
function addUsage(acc: TokenBreakdown, usage: Record<string, unknown>): void {
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheCreation = num(usage.cache_creation_input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  acc.input += input;
  acc.output += output;
  acc.cacheCreation += cacheCreation;
  acc.cacheRead += cacheRead;
  acc.total += input + output + cacheCreation + cacheRead;
  acc.messages += 1;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

interface WalkResult {
  files: string[];
}

/** ~/.claude/projects を再帰walk して全 *.jsonl を集める（壊れた symlink は飛ばす）。 */
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
      if (st.isSymbolicLink()) st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkJsonl(p, acc);
    } else if (st.isFile() && e.endsWith('.jsonl')) {
      // (a) トップレベル *.jsonl（メインセッション）と
      // (b) **/subagents/**/agent-*.jsonl（サブエージェント）の両方を対象にする。
      if (p.includes('/subagents/')) {
        if (e.startsWith('agent-')) acc.files.push(p);
      } else {
        acc.files.push(p);
      }
    }
  }
  return acc;
}

/** JST(UTC+9) の当日 0:00 を UTC エポック ms で返す。 */
function jstTodayStartMs(now: number): number {
  const JST_OFFSET = 9 * 60 * 60 * 1000;
  const jst = now + JST_OFFSET;
  const jstDayStart = Math.floor(jst / 86400000) * 86400000;
  return jstDayStart - JST_OFFSET;
}

/** assistant 行から message.usage を取り出す（無ければ null）。 */
function lineUsage(line: JsonlLine): Record<string, unknown> | null {
  if (line.type !== 'assistant') return null;
  const msg = line.message as { usage?: unknown } | undefined;
  const usage = msg?.usage;
  if (usage && typeof usage === 'object') return usage as Record<string, unknown>;
  return null;
}

/** assistant 行から model 文字列を取り出す（無ければ 'unknown'）。 */
function lineModel(line: JsonlLine): string {
  const msg = line.message as { model?: unknown } | undefined;
  return typeof msg?.model === 'string' && msg.model ? msg.model : 'unknown';
}

interface Accumulator {
  totals: TokenBreakdown;
  byProject: Map<ProjectName, TokenBreakdown>;
  byModel: Map<string, TokenBreakdown>;
  lastHour: TokenBreakdown;
  today: TokenBreakdown;
}

function getProjectAcc(acc: Accumulator, project: ProjectName): TokenBreakdown {
  let b = acc.byProject.get(project);
  if (!b) {
    b = emptyBreakdown();
    acc.byProject.set(project, b);
  }
  return b;
}

function getModelAcc(acc: Accumulator, model: string): TokenBreakdown {
  let b = acc.byModel.get(model);
  if (!b) {
    b = emptyBreakdown();
    acc.byModel.set(model, b);
  }
  return b;
}

function computeUsage(): UsageSummary {
  const now = Date.now();
  const hourAgo = now - 3600000;
  const todayStart = jstTodayStartMs(now);

  const acc: Accumulator = {
    totals: emptyBreakdown(),
    byProject: new Map(),
    byModel: new Map(),
    lastHour: emptyBreakdown(),
    today: emptyBreakdown(),
  };

  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    return finalize(acc, 0, false);
  }

  const walk = walkJsonl(CLAUDE_PROJECTS_DIR, { files: [] });

  for (const file of walk.files) {
    // mtime で当日窓に無関係なファイルを判定。mtime < todayStart なら
    // 当日窓・直近1時間に寄与しないので、タイムスタンプ評価をスキップして軽量化する。
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      // stat 失敗時は安全側に倒して全行を窓判定する。
      mtimeMs = now;
    }
    const fileTouchesWindows = mtimeMs >= todayStart;

    const lines = readJsonl(file);
    if (lines.length === 0) continue;

    // プロジェクトはファイル先頭の cwd（無ければファイルパス）で判定し、ファイル単位で固定。
    const cwd = lines[0]?.cwd ?? file;
    const project = projectFromPath(cwd);

    for (const line of lines) {
      const usage = lineUsage(line);
      if (!usage) continue;
      const model = lineModel(line);

      // 全期間: グルーピング 3 種 + 全期間窓に常に加算。
      addUsage(acc.totals, usage);
      addUsage(getProjectAcc(acc, project), usage);
      addUsage(getModelAcc(acc, model), usage);

      // 時間窓: mtime で窓に触れ得るファイルのみ timestamp を評価する。
      if (fileTouchesWindows) {
        const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
        if (Number.isFinite(ts)) {
          if (ts >= todayStart) addUsage(acc.today, usage);
          if (ts >= hourAgo) addUsage(acc.lastHour, usage);
        }
        // timestamp が無ければ窓集計はスキップ（全期間カウントには既に加算済み）。
      }
    }
  }

  return finalize(acc, walk.files.length, false);
}

function finalize(acc: Accumulator, fileCount: number, cached: boolean): UsageSummary {
  const byProject: ProjectUsage[] = [...acc.byProject.entries()]
    .map(([project, b]) => ({ project, projectLabel: projectLabel(project), ...b }))
    .sort((a, b) => b.total - a.total);

  const byModel: ModelUsage[] = [...acc.byModel.entries()]
    .map(([model, b]) => ({ model, ...b }))
    .sort((a, b) => b.total - a.total);

  return {
    generatedAt: new Date().toISOString(),
    cached,
    fileCount,
    totals: acc.totals,
    byProject,
    byModel,
    windows: {
      lastHour: acc.lastHour,
      today: acc.today,
      all: acc.totals,
    },
  };
}

// 全 jsonl のフルスキャンは重い。リアルタイム性は不要なので USAGE_TTL_MS（既定 5 分）の
// メモリキャッシュで連続要求を吸収し、重い再走査を 5 分に 1 回へ抑える。
let cached: UsageSummary | null = null;
let cachedAt = 0;

/** Token 消費量サマリ（USAGE_TTL_MS キャッシュ）。 */
export function collectUsage(): UsageSummary {
  const now = Date.now();
  if (cached && now - cachedAt < USAGE_TTL_MS) {
    // 前回結果を cached:true でそのまま返す（generatedAt は算出時刻のまま保持）。
    return { ...cached, cached: true };
  }
  cached = computeUsage();
  cachedAt = now;
  return cached;
}
