// plannerEstimate — タスクの「所要時間/優先度/最適時間帯」の見積り（MC-245 Phase2）。
//
// 方針: 「AI で “見積り”、決定的ロジックで “配置”」。ここは見積りだけを担当する。
// 統合の優先順位（高い順）:
//   1) 手動上書き（TaskMeta）   … plannerStore の taskMetaMap（呼び出し側が渡す）
//   2) AI 見積り（キャッシュ）   … claude haiku をバッチ 1 回。内容不変ならキャッシュ再利用で呼ばない
//   3) ヒューリスティック        … defaultTaskMinutes ＋ listTitle/タイトル/締切のキーワード調整
//
// AI 呼び出しは collectors/moods.ts の流儀をそのまま踏襲する:
//   execFile(NOTEBOOK_CLAUDE_BIN, ['--model', <haiku>, '-p', <prompt>], {timeout, maxBuffer, env})
//   → stdout から JSON 配列を抽出してパース・失敗/タイムアウト/パース不可は null フォールバック。
// 失敗・タイムアウト・パース不可・対象タスク 0 件のときは claude を呼ばず/即フォールバックする。

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

import {
  NOTEBOOK_CLAUDE_BIN,
  PLANNER_ESTIMATE_MODEL,
  PLANNER_ESTIMATE_TIMEOUT_MS,
  PLANNER_ESTIMATE_MAX_TASKS,
} from './config.js';
import {
  appendEstimateCache,
  estimateCacheMap,
  metaKey,
  type DaypartPref,
  type EstimateCacheRecord,
  type PlanTaskInput,
  type Priority,
  type TaskMeta,
} from './plannerStore.js';

/** 1 タスクの統合見積り結果。 */
export interface TaskEstimate {
  estMinutes: number;
  priority: Priority;
  preferredDaypart: DaypartPref | null;
  /** 由来（デバッグ/根拠表示用）。 */
  source: 'manual' | 'ai' | 'heuristic';
}

/** 見積りの統合結果。taskMetaKey(account:taskId) → 見積り。 */
export interface EstimateResult {
  byKey: Map<string, TaskEstimate>;
  /** AI が 1 件でも実際に使われたか（キャッシュ命中含む）。 */
  usedAi: boolean;
}

// ─── 見積りの境界値 ─────────────────────────────────────────

const MIN_EST = 5;
const MAX_EST = 240;

/** estMinutes を 5〜240 の現実的範囲に丸める（NaN/非有限は既定へ）。 */
function clampMinutes(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_EST, Math.max(MIN_EST, Math.round(n)));
}

/** priority 文字列を正規化（不正は 'med'）。 */
function normPriority(v: unknown): Priority {
  return v === 'high' || v === 'med' || v === 'low' ? v : 'med';
}

/** daypart 文字列を正規化（不正/未指定は null）。 */
function normDaypart(v: unknown): DaypartPref | null {
  return v === 'morning' || v === 'afternoon' || v === 'evening' ? v : null;
}

// ─── 内容ハッシュ（キャッシュキー）────────────────────────────

/** account:taskId + 内容（title+notes）のハッシュ。内容不変なら同 key になる。 */
function cacheKeyFor(t: PlanTaskInput): string {
  const content = `${t.title} ${t.notes ?? ''}`;
  const h = createHash('sha1').update(content).digest('hex').slice(0, 16);
  return `${t.account}::${t.id}::${h}`;
}

// ─── ヒューリスティック見積り（必ず動く）──────────────────────

const HIGH_WORDS = ['今日', '高', '至急', '緊急', 'asap', 'urgent'];
const LOW_WORDS = ['低', 'いつか', 'someday', 'later'];

/** 締切が 48h 以内か（due は JST の YYYY-MM-DD・時刻なし。その日の 23:59 JST を期限とみなす）。 */
function dueWithin48h(due: string | undefined, fromMs: number): boolean {
  if (!due) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return false;
  // JST の当日 23:59:59 を UTC に換算（JST = UTC+9）。
  const endUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59) - 9 * 3600 * 1000;
  return endUtc - fromMs <= 48 * 3600 * 1000;
}

/** 優先度を 1 段引き上げる。 */
function bumpPriority(p: Priority): Priority {
  return p === 'low' ? 'med' : 'high';
}

/**
 * ヒューリスティック見積り（claude を呼ばない・必ず返す）。
 *  - estMinutes: defaultTaskMinutes をベースに、タイトル/notes のキーワードで軽く調整。
 *  - priority: listTitle/タイトルに「今日」「高」→ high、「低」→ low、それ以外 med。due 48h 以内なら 1 段上げ。
 *  - preferredDaypart: null。
 */
export function heuristicEstimate(
  t: PlanTaskInput,
  defaultTaskMinutes: number,
  fromMs: number,
): TaskEstimate {
  const hay = `${t.listTitle} ${t.title} ${t.notes ?? ''}`.toLowerCase();

  let priority: Priority = 'med';
  if (HIGH_WORDS.some((w) => hay.includes(w.toLowerCase()))) priority = 'high';
  else if (LOW_WORDS.some((w) => hay.includes(w.toLowerCase()))) priority = 'low';
  if (dueWithin48h(t.due, fromMs)) priority = bumpPriority(priority);

  // 所要時間の軽い調整（任意）。「資料/設計/実装」等は長め、「連絡/メール/確認」等は短め。
  let est = defaultTaskMinutes;
  if (/(資料|設計|実装|レビュー|執筆|report|design|implement)/i.test(hay)) est = Math.round(defaultTaskMinutes * 2);
  else if (/(連絡|返信|メール|確認|電話|reply|email|call|ping)/i.test(hay)) est = Math.max(MIN_EST, Math.round(defaultTaskMinutes / 2));

  return {
    estMinutes: clampMinutes(est, defaultTaskMinutes),
    priority,
    preferredDaypart: null,
    source: 'heuristic',
  };
}

// ─── AI 見積り（claude haiku をバッチ 1 回）──────────────────────

/** バッチ見積りのプロンプトを組み立てる（日本語・厳密 JSON 配列出力）。 */
function buildPrompt(tasks: PlanTaskInput[]): string {
  const items = tasks.map((t, idx) => {
    const parts = [`${idx + 1}. id="${cacheKeyFor(t)}" タイトル="${t.title}"`];
    if (t.listTitle) parts.push(`リスト="${t.listTitle}"`);
    if (t.due) parts.push(`締切=${t.due}`);
    if (t.notes) parts.push(`メモ="${t.notes.slice(0, 200)}"`);
    return parts.join(' / ');
  });
  return [
    'あなたはタスクの段取りを見積もる役です。以下の各タスクについて、現実的な所要時間・優先度・適した時間帯を推定してください。',
    '配置（いつやるか）は別の決定的ロジックが行うので、ここでは見積りだけを返します。',
    '',
    '各タスクの推定値の制約:',
    '- estMinutes: 実際に手を動かす所要時間（分）。5〜240 の現実的な整数。短い連絡/確認は小さく、資料/設計/実装は大きく。',
    '- priority: "high"（締切が近い・重要）/ "med"（通常）/ "low"（後回し可）のいずれか。',
    '- daypart: 適した時間帯。"morning"（午前・集中作業）/ "afternoon"（午後）/ "evening"（夜）/ 特に無ければ null。',
    '- 情報が乏しい場合は無理に決めず、estMinutes=30・priority="med"・daypart=null 寄りの無難な値にする。',
    '',
    'タスク一覧:',
    ...items,
    '',
    '出力は次の JSON 配列のみ（前後に説明や ``` を付けない）。id は入力の id をそのまま返す:',
    '[{"id":"...","estMinutes":30,"priority":"med","daypart":null}]',
  ].join('\n');
}

/** claude stdout から JSON 配列を抽出してパースする（前後ノイズ・``` 耐性）。 */
function parseEstimates(stdout: string): Map<string, { estMinutes: number; priority: Priority; daypart: DaypartPref | null }> | null {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;

  const byKey = new Map<string, { estMinutes: number; priority: Priority; daypart: DaypartPref | null }>();
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    if (!id) continue;
    byKey.set(id, {
      estMinutes: clampMinutes(r.estMinutes, 30),
      priority: normPriority(r.priority),
      daypart: normDaypart(r.daypart),
    });
  }
  return byKey;
}

/** claude をバッチ起動して見積りを生成する（1 回呼び出し）。失敗/タイムアウトは null。 */
function runBatch(
  tasks: PlanTaskInput[],
): Promise<Map<string, { estMinutes: number; priority: Priority; daypart: DaypartPref | null }> | null> {
  return new Promise((resolve) => {
    // execFile は引数に NUL バイトがあると同期 throw する。タスク内容（title/notes 等）に
    // 想定外の制御文字が混じってもサーバを落とさないよう、(1) プロンプトから NUL を除去し、
    // (2) execFile 自体も try/catch で囲い、失敗時は null（→ヒューリスティックへフォールバック）。
    const prompt = buildPrompt(tasks).replace(/\x00/g, '');
    try {
      execFile(
        NOTEBOOK_CLAUDE_BIN,
        ['--model', PLANNER_ESTIMATE_MODEL, '-p', prompt],
        { timeout: PLANNER_ESTIMATE_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: process.env },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          resolve(parseEstimates((stdout || '').toString()));
        },
      );
    } catch {
      resolve(null);
    }
  });
}

// ─── 統合（手動 > AI(キャッシュ) > ヒューリスティック）──────────────

/**
 * タスク配列の見積りを統合して返す。
 *
 * - 手動上書き（metaMap）がある項目はそれを最優先で採用（AI/claude を呼ばない）。
 * - 残りのうち、キャッシュ命中（内容不変）は AI 結果として再利用。
 * - キャッシュ未命中のものだけを 1 回の claude バッチ（haiku）で見積り、結果をキャッシュに追記。
 *   バッチが失敗/タイムアウト/パース不可/0 件なら、その項目はヒューリスティックにフォールバック。
 * - 手動上書きで一部フィールドだけ指定されている場合、欠けたフィールドは AI/ヒューリスティックで補完する。
 *
 * usedAi は「AI 由来（新規生成またはキャッシュ命中）が 1 件でも使われたか」。
 */
export async function estimateTasks(
  tasks: PlanTaskInput[],
  metaMap: Map<string, TaskMeta>,
  defaultTaskMinutes: number,
  fromMs: number,
): Promise<EstimateResult> {
  const byKey = new Map<string, TaskEstimate>();
  if (tasks.length === 0) return { byKey, usedAi: false };

  const cache = estimateCacheMap();
  let usedAi = false;

  // ① 基底見積り（手動 > キャッシュ AI > ヒューリスティック）を先に確定し、
  //    キャッシュも手動上書きも無い項目だけを AI バッチ対象として集める。
  const needAi: PlanTaskInput[] = [];
  const cacheKeyByTask = new Map<string, string>(); // taskMetaKey → cacheKey

  for (const t of tasks) {
    const mkey = metaKey(t.account, t.id);
    const meta = metaMap.get(mkey);

    // 手動上書きが「全フィールド」揃っているなら AI 不要で確定。
    if (meta && meta.estMinutes !== undefined && meta.priority !== undefined && meta.preferredDaypart !== undefined) {
      byKey.set(mkey, {
        estMinutes: clampMinutes(meta.estMinutes, defaultTaskMinutes),
        priority: normPriority(meta.priority),
        preferredDaypart: meta.preferredDaypart ?? null,
        source: 'manual',
      });
      continue;
    }

    const ck = cacheKeyFor(t);
    cacheKeyByTask.set(mkey, ck);
    const cached = cache.get(ck);
    let base: TaskEstimate;
    if (cached) {
      base = {
        estMinutes: cached.estMinutes,
        priority: cached.priority,
        preferredDaypart: cached.preferredDaypart,
        source: 'ai',
      };
      usedAi = true;
    } else {
      base = heuristicEstimate(t, defaultTaskMinutes, fromMs);
      needAi.push(t);
    }
    byKey.set(mkey, applyMetaOverride(base, meta));
  }

  // ② キャッシュ未命中ぶんを 1 回の claude バッチで見積り（上限超過は heuristic のまま）。
  const batch = needAi.slice(0, PLANNER_ESTIMATE_MAX_TASKS);
  if (batch.length > 0) {
    const result = await runBatch(batch);
    if (result && result.size > 0) {
      const now = new Date().toISOString();
      for (const t of batch) {
        const mkey = metaKey(t.account, t.id);
        const ck = cacheKeyByTask.get(mkey)!;
        const ai = result.get(ck);
        if (!ai) continue; // この項目はヒューリスティックのまま残す。
        const rec: EstimateCacheRecord = {
          key: ck,
          estMinutes: ai.estMinutes,
          priority: ai.priority,
          preferredDaypart: ai.daypart,
          cachedAt: now,
        };
        appendEstimateCache(rec);
        usedAi = true;
        const aiBase: TaskEstimate = {
          estMinutes: ai.estMinutes,
          priority: ai.priority,
          preferredDaypart: ai.daypart,
          source: 'ai',
        };
        byKey.set(mkey, applyMetaOverride(aiBase, metaMap.get(mkey)));
      }
    }
    // バッチ失敗/0 件 → 何もしない（基底のヒューリスティックがそのまま採用される）。
  }

  return { byKey, usedAi };
}

/** 基底見積りに手動上書き（指定フィールドのみ）を被せる。指定の無いフィールドは基底を維持。 */
function applyMetaOverride(base: TaskEstimate, meta: TaskMeta | undefined): TaskEstimate {
  if (!meta) return base;
  const hasManual =
    meta.estMinutes !== undefined || meta.priority !== undefined || meta.preferredDaypart !== undefined;
  return {
    estMinutes: meta.estMinutes !== undefined ? clampMinutes(meta.estMinutes, base.estMinutes) : base.estMinutes,
    priority: meta.priority !== undefined ? normPriority(meta.priority) : base.priority,
    preferredDaypart:
      meta.preferredDaypart !== undefined ? meta.preferredDaypart ?? null : base.preferredDaypart,
    source: hasManual ? 'manual' : base.source,
  };
}
