// ticks collector (MC-65)
//
// 自律ループ（autonomous-worker.sh、cron */10）がスコープ別に追記する
// /home/dev/logs/autonomous-*.log を末尾読み（直近 N バイト）で解析し、
// 直近ティック（選んだタスク × 結果レーン）を返す。
//
// 解析対象のログ形式（実サンプル）:
//   開始: `[2026-06-01 10:30:01 JST] [cxo] autonomous-worker tick start (DRY_RUN=0, tracker=...)`
//   終了: `[2026-06-01 10:14:09 JST] [cxo] autonomous-worker tick done`
//   スキップ: `[2026-06-01 10:50:01 JST] [logic] previous tick still running (...) — skip`
//             `[2026-05-31 10:30:01 JST] disabled (kill-switch present: ...) — skip`
//   ティックの間に自由文の要約があり、`- スコープ:` `- 選んだタスク:`(または `選定:`)
//   `- 結果:`(または `結果:`) の行が含まれることが多い（無いティックもある）。
//
// 実装方針（deploys.ts を踏襲）:
//   - fail-soft: ファイル不在・空・壊れ行・自由文は例外を投げず空配列/null で畳む。
//     Apollo 全体を絶対に落とさない。
//   - 末尾読み: 214KB 級ログをフル読みせず TICKS_TAIL_BYTES だけ tail する。
//   - キャッシュ: TICKS_TTL_MS（既定 30 秒）のメモリキャッシュ（usage/deploys と同方式）。
//   - redact: クライアントに返すテキストは redact.ts に通す。
//
// 選んだタスク / 結果は正規表現で緩く抽出（取れなければ null、固まらせない）。

import { readdirSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import {
  AUTONOMOUS_LOG_DIR,
  AUTONOMOUS_LOG_GLOB,
  TICKS_LIMIT,
  TICKS_TAIL_BYTES,
  TICKS_TTL_MS,
} from '../config.js';
import { redactText } from '../lib/redact.js';

/** ティックの状態。running=開始のみ／done=完了／skipped=スキップ行。 */
export type TickStatus = 'running' | 'done' | 'skipped';

/** ティックの結果分類。 */
export type TickResultKind = 'green' | 'red' | 'deploy' | 'idle' | 'unknown';

/** 1 ティックで選ばれたタスク（取れなければ null）。 */
export interface TickSelectedTask {
  /** タスク ID（MC-83 / T-U / AF-05 等）。取れなければ null。 */
  id: string | null;
  /** タスクの短いタイトル（取れた範囲。無ければ null）。 */
  title: string | null;
}

/** 1 ティックの結果（取れなければ null）。 */
export interface TickResult {
  kind: TickResultKind;
  /** 結果行の抜粋テキスト（redact 済み）。 */
  text: string;
}

/** 正規化済み 1 ティック。 */
export interface Tick {
  /** スコープ（cxo / logic 等）。開始マーカーの [scope] 由来、無ければ要約から推定、それも無ければ 'unknown'。 */
  scope: string;
  /** ログ由来のソースファイル名（autonomous-cxo.log 等）。 */
  source: string;
  /** 開始時刻（ISO 文字列）。skip 行は skip 時刻。 */
  startedAt: string;
  /** 完了時刻（ISO 文字列）。running / skipped は null。 */
  endedAt: string | null;
  status: TickStatus;
  /** 選んだタスク（取れなければ null）。 */
  selectedTask: TickSelectedTask | null;
  /** 結果（取れなければ null）。 */
  result: TickResult | null;
  /** 所要ミリ秒（done のみ。算出不能は null）。 */
  durationMs: number | null;
  /** スキップ理由（skipped のみ。redact 済み）。 */
  skipReason?: string;
}

/** GET /api/ticks のレスポンス形。 */
export interface TicksSummary {
  generatedAt: string;
  source: string;
  /** キャッシュから返したか。 */
  cached: boolean;
  /** スコープ一覧（レーン見出し用、出現順）。 */
  scopes: string[];
  ticks: Tick[];
}

// ─── glob → ファイル名（'autonomous-*.log' のような単純パターンのみ対応）──────

/** 単純 glob（'*' のみ）を正規表現に変換。他のメタ文字はエスケープ。 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** AUTONOMOUS_LOG_DIR 内で glob にマッチするログファイル名を列挙（不在/権限エラーは空配列）。 */
function listLogFiles(): string[] {
  try {
    const re = globToRegExp(AUTONOMOUS_LOG_GLOB);
    return readdirSync(AUTONOMOUS_LOG_DIR)
      .filter((name) => re.test(name))
      .sort();
  } catch {
    // ディレクトリ不在・権限なし等は「ログ無し」として空配列。
    return [];
  }
}

/** ファイル末尾 TICKS_TAIL_BYTES だけ読む（フル読みしない）。読めなければ ''。 */
function tailFile(absPath: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(absPath, 'r');
    const size = fstatSync(fd).size;
    if (size <= 0) return '';
    const readBytes = Math.min(size, TICKS_TAIL_BYTES);
    const start = size - readBytes;
    const buf = Buffer.allocUnsafe(readBytes);
    const got = readSync(fd, buf, 0, readBytes, start);
    return buf.toString('utf-8', 0, got);
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* noop */
      }
    }
  }
}

// ─── 行パース ──────────────────────────────────────────────

// 行頭タイムスタンプ: `[2026-06-01 10:30:01 JST] ` を捕捉（JST 前提で +09:00 に変換）。
const TS_RE = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) JST\]/;
// 開始/終了マーカー（scope は任意）。
const START_RE = /autonomous-worker tick start/;
const DONE_RE = /autonomous-worker tick done/;
// スキップ系（previous tick still running / disabled ... — skip）。
const SKIP_RE = /—\s*skip\b|--\s*skip\b|\bskip\b\s*$/;
// 行内のスコープ `[cxo]` `[logic]` 等（タイムスタンプ直後）。
const SCOPE_BRACKET_RE = /^\[[^\]]+\]\s*\[([a-z][\w-]*)\]/;

/** `[YYYY-MM-DD HH:MM:SS JST]` を ISO（+09:00）に変換。失敗時 null。 */
function parseTs(line: string): string | null {
  const m = TS_RE.exec(line);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // JST 固定オフセットで ISO 化（new Date でローカル TZ に依存させない）。
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/** 行頭ブラケットからスコープを取る（`[ts] [cxo] ...`）。無ければ null。 */
function scopeFromLine(line: string): string | null {
  const m = SCOPE_BRACKET_RE.exec(line);
  return m ? m[1] : null;
}

/** ファイル名からスコープを推定（autonomous-cxo.log → cxo）。'rin' は logic スコープに寄せる。 */
function scopeFromSource(source: string): string {
  const m = /^autonomous-(.+)\.log$/.exec(source);
  if (!m) return 'unknown';
  const raw = m[1];
  // 'rin'（autonomous-rin.log）は logic スコープのログ。行内 [logic] が優先されるが
  // 行に scope が無いケースのフォールバックとして logic に寄せる。
  if (raw === 'rin') return 'logic';
  return raw;
}

// 抽出: 選んだタスク行（`選んだタスク:` または `選定:`）と、ID（MC-83 / T-U / AF-05 等）。
const SELECTED_LINE_RE = /(?:選んだタスク|選定)\s*[:：]\s*(.+)$/;
// スコープ行（`スコープ:` / `- スコープ:`）。
const SCOPE_LINE_RE = /スコープ\s*[:：]\s*(.+)$/;
// 結果行（`結果:` / `- 結果:`）。
const RESULT_LINE_RE = /結果\s*[:：]\s*(.+)$/;
// タスク ID パターン: 大文字 2 文字以上 + ハイフン + 英数（MC-83 / T-U / AF-05 / EC-12 等）。
const TASK_ID_RE = /\b([A-Z][A-Z]+-[A-Za-z0-9]+|T-[A-Za-z0-9]+)\b/;
// タイトル抽出: ID の直後に続く「…」or（…）or 全角引用の中身を緩く拾う。
const TITLE_QUOTE_RE = /[「『]([^」』]{2,80})[」』]/;
const TITLE_PAREN_RE = /[（(]([^）)]{2,80})[）)]/;

/** スコープ行のラベルから既知スコープ語を緩く拾う（cxo / logic）。無ければ null。 */
function normalizeScopeLabel(label: string): string | null {
  const l = label.toLowerCase();
  if (l.includes('logic')) return 'logic';
  if (l.includes('cxo') || l.includes('apollo')) return 'cxo';
  if (l.includes('en-chakai') || l.includes('chakai')) return 'en-chakai';
  if (l.includes('nishimaru') || l.includes('西丸')) return 'nishimaru';
  return null;
}

/** 選んだタスク行テキストから {id, title} を抽出（緩く・取れなければ null フィールド）。 */
function extractSelectedTask(text: string): TickSelectedTask | null {
  const idM = TASK_ID_RE.exec(text);
  const id = idM ? idM[1] : null;
  // タイトルは「…」or（…）の中身を優先。無ければ ID 以降の短いフレーズ。
  let title: string | null = null;
  const q = TITLE_QUOTE_RE.exec(text);
  if (q) title = q[1].trim();
  if (!title) {
    const p = TITLE_PAREN_RE.exec(text);
    if (p) title = p[1].trim();
  }
  if (!id && !title) return null;
  return { id, title: title ?? null };
}

/** 結果行テキストから kind を分類（緩く）。 */
function classifyResult(text: string): TickResultKind {
  const t = text.toLowerCase();
  // deploy 系（push/deploy 実施）を最優先で拾う。
  if (/deploy\s*有|本番\s*deploy|deploy\s*実行|deploy\s*起動|rollout|配信/.test(text) && !/deploy\s*なし|push\s*なし|未実施|未deploy/i.test(text)) {
    return 'deploy';
  }
  // 失敗・赤系。
  if (/\bred\b|失敗|エラー|前進ゼロ|マイナス|捏造|誤った/.test(t) || /前進ゼロ|実質マイナス/.test(text)) {
    return 'red';
  }
  // green（成功）。
  if (/\bgreen\b|緑/.test(t)) return 'green';
  // 着手可能タスク無し等の idle。
  if (/着手可能.*無|何も実装|スタンドダウン|idle|スキップ/.test(text)) return 'idle';
  return 'unknown';
}

// ─── ティック組み立て ──────────────────────────────────────

interface RawBlock {
  scope: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: TickStatus;
  bodyLines: string[];
  skipReason?: string;
}

/**
 * 1 ファイルのテキストをティックブロックに分割する。
 * start 行で新ブロック開始、done 行で確定、skip 行は単独ブロック。
 * 末尾読みで途中から始まる断片は安全にスキップする（壊れ行は無視）。
 */
function parseBlocks(text: string, source: string): Tick[] {
  const lines = text.split(/\r?\n/);
  const blocks: RawBlock[] = [];
  let current: RawBlock | null = null;

  const flush = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    const ts = parseTs(line);
    const hasTs = ts !== null;

    if (hasTs && START_RE.test(line)) {
      // 新しいティック開始。直前の running ブロックは done を見ずに確定（途中ログ）。
      flush();
      current = {
        scope: scopeFromLine(line),
        startedAt: ts,
        endedAt: null,
        status: 'running',
        bodyLines: [],
      };
      continue;
    }

    if (hasTs && DONE_RE.test(line)) {
      if (current && current.status === 'running') {
        current.endedAt = ts;
        current.status = 'done';
        flush();
      }
      // 対応する start が無い done（末尾読みの断片）は無視。
      continue;
    }

    if (hasTs && SKIP_RE.test(line)) {
      // skip は独立イベント。進行中ブロックがあれば先に確定。
      flush();
      // skip 行本文（タイムスタンプ以降）を理由として保持。
      const reason = line.replace(TS_RE, '').replace(/^\s*(\[[^\]]+\])?\s*/, '').trim();
      blocks.push({
        scope: scopeFromLine(line),
        startedAt: ts,
        endedAt: null,
        status: 'skipped',
        bodyLines: [],
        skipReason: reason,
      });
      continue;
    }

    // それ以外（自由文の要約行）は進行中ブロックの本文に積む。
    if (current) current.bodyLines.push(line);
  }
  flush();

  // RawBlock → Tick へ正規化。
  const out: Tick[] = [];
  for (const b of blocks) {
    if (!b.startedAt) continue; // タイムスタンプの取れない断片は捨てる。

    // スコープ確定: 行頭 [scope] > 要約のスコープ行 > ファイル名推定。
    let scope = b.scope;
    let selectedTask: TickSelectedTask | null = null;
    let result: TickResult | null = null;

    for (const raw of b.bodyLines) {
      if (!scope) {
        const sm = SCOPE_LINE_RE.exec(raw);
        if (sm) {
          const norm = normalizeScopeLabel(sm[1]);
          if (norm) scope = norm;
        }
      }
      if (!selectedTask) {
        const selM = SELECTED_LINE_RE.exec(raw);
        if (selM) selectedTask = extractSelectedTask(selM[1]);
      }
      if (!result) {
        const resM = RESULT_LINE_RE.exec(raw);
        if (resM) {
          const text = resM[1].trim().slice(0, 400);
          result = { kind: classifyResult(text), text: redactText(text) };
        }
      }
    }

    if (!scope) scope = scopeFromSource(source);

    const durationMs =
      b.status === 'done' && b.endedAt
        ? Math.max(0, Date.parse(b.endedAt) - Date.parse(b.startedAt))
        : null;

    const tick: Tick = {
      scope,
      source,
      startedAt: b.startedAt,
      endedAt: b.endedAt,
      status: b.status,
      selectedTask,
      result,
      durationMs: Number.isFinite(durationMs as number) ? durationMs : null,
    };
    if (b.status === 'skipped' && b.skipReason) {
      tick.skipReason = redactText(b.skipReason).slice(0, 300);
    }
    out.push(tick);
  }
  return out;
}

/**
 * テスト用の純粋解析エントリ。1 ファイル分のテキストを解析し、新しい順
 * （startedAt 降順）に並べたティック配列を返す（I/O・キャッシュ・redact 集約なし）。
 * I/O を伴わないため単体テストから直接叩ける（ticks.test.ts）。
 */
export function parseTicksForTest(text: string, source: string): Tick[] {
  const ticks = parseBlocks(text, source);
  ticks.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return ticks;
}

function compute(scopeFilter?: string): TicksSummary {
  const all: Tick[] = [];
  for (const name of listLogFiles()) {
    try {
      const text = tailFile(join(AUTONOMOUS_LOG_DIR, name));
      if (!text) continue;
      all.push(...parseBlocks(text, name));
    } catch {
      // 1 ファイルの解析失敗で全体を落とさない。
    }
  }

  // 新しい順（startedAt 降順）。
  all.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  const filtered = scopeFilter ? all.filter((t) => t.scope === scopeFilter) : all;
  const limited = filtered.slice(0, TICKS_LIMIT);

  // レーン見出し用のスコープ一覧（出現順・重複排除）。
  const scopes: string[] = [];
  for (const t of limited) {
    if (!scopes.includes(t.scope)) scopes.push(t.scope);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: hostname(),
    cached: false,
    scopes,
    ticks: limited,
  };
}

// usage/deploys と同じ TTL 方式のメモリキャッシュ（scopeFilter 別）。
const cacheByScope = new Map<string, { value: TicksSummary; at: number }>();

/**
 * 直近ティックのサマリ（TICKS_TTL_MS キャッシュ・全例外を吸収して 200 で返せる形）。
 * scopeFilter を渡すとそのスコープのみに絞る（任意）。
 */
export function collectTicks(scopeFilter?: string): TicksSummary {
  const key = scopeFilter ?? '';
  const now = Date.now();
  const hit = cacheByScope.get(key);
  if (hit && now - hit.at < TICKS_TTL_MS) {
    return { ...hit.value, cached: true };
  }
  const value = compute(scopeFilter);
  cacheByScope.set(key, { value, at: now });
  return value;
}
