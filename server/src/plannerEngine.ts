// plannerEngine — 決定的な配置エンジン（MC-245 Phase2）。
//
// 方針: 「AI で “見積り”、決定的ロジックで “配置”」。ここは配置だけを担当し、
// 重複ゼロ・過去配置なし・締切超過なしを保証する（AI は一切使わない）。
//
// タイムゾーンは JST 固定運用。内部の時刻はすべて「UNIX epoch ミリ秒（UTC 絶対時刻）」で扱い、
// 「JST のその日の何時何分か」を計算するときだけ +9h オフセットで日付/時刻を導出する。
//
// 手順:
//   1. 期間 = [from, to or from+horizonDays)。各日の稼働可能スロット =
//        [workdayStart, workdayEnd] − blackout − 時間ありイベント（前後に bufferMinutes）。
//      from 以前は捨てる（過去に置かない）。終日イベントは busy にしない（その日を全部潰さない）。
//   2. タスク整列: fixed/locked を固定 → 残りを (due 昇順〔無しは最後〕, priority, estMinutes 降順)。
//   3. 貪欲配置: 各タスクを earliestStart 以降・due まで（無ければ期間末）の最早スロットへ estMinutes ぶん。
//      1 日上限（dailyMaxMinutes）・スロット内・配置後分割。preferredDaypart は同日内で優先。
//   4. 入り切らない/締切に空き無し → unplaced（理由つき）。黙って落とさない。
//   5. 各ブロックに reason。

import {
  type DaypartPref,
  type PlanBlock,
  type PlanEventInput,
  type PlannerConfig,
  type PlanResponse,
  type PlanTaskInput,
  type Priority,
  type TaskMeta,
  metaKey,
} from './plannerStore.js';
import type { TaskEstimate } from './plannerEstimate.js';

const MS_PER_MIN = 60_000;
const JST_OFFSET_MS = 9 * 60 * MS_PER_MIN;

// ─── JST 時刻ユーティリティ（epoch ms ⇔ JST の日付/分）──────────────

/** epoch ms から「JST の 0:00（その日の始まり）」の epoch ms を返す。 */
function jstDayStart(ms: number): number {
  const jst = ms + JST_OFFSET_MS;
  const dayStartJst = Math.floor(jst / 86_400_000) * 86_400_000;
  return dayStartJst - JST_OFFSET_MS;
}

/** 'HH:MM' を「その日の 0:00 からの分数」に変換（'24:00' は 1440 を許容）。不正は null。 */
function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || mi < 0 || mi > 59 || h < 0 || h > 24) return null;
  const total = h * 60 + mi;
  return total >= 0 && total <= 1440 ? total : null;
}

/** epoch ms を ISO 文字列に。 */
function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

// ─── スロット（空き区間）──────────────────────────────────────

interface Slot {
  start: number; // epoch ms
  end: number; // epoch ms
  /** この日（JST 0:00）の epoch ms。日次上限の集計キー。 */
  dayStart: number;
}

interface Interval {
  start: number;
  end: number;
}

/** [a,b) と [c,d) が重なるか。 */
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** ソート済み busy 区間群を 1 つの稼働区間 [winStart,winEnd) から差し引いて空きスロットを返す。 */
function subtractBusy(winStart: number, winEnd: number, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cursor = winStart;
  // busy は start 昇順前提。稼働窓に関係するものだけ走査。
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= winEnd) break;
    const bs = Math.max(b.start, winStart);
    const be = Math.min(b.end, winEnd);
    if (bs > cursor) out.push({ start: cursor, end: bs });
    cursor = Math.max(cursor, be);
    if (cursor >= winEnd) break;
  }
  if (cursor < winEnd) out.push({ start: cursor, end: winEnd });
  return out;
}

/**
 * 計画期間の空きスロットを生成する。
 * - 各日 [workdayStart, workdayEnd] の稼働窓から blackout と時間ありイベント（前後 buffer）を差し引く。
 * - from 以前は捨てる。1 分未満のスロットは捨てる。
 */
function buildSlots(
  fromMs: number,
  toMs: number,
  config: PlannerConfig,
  events: PlanEventInput[],
): Slot[] {
  const startMin = hhmmToMinutes(config.workdayStart) ?? 9 * 60;
  const endMin = hhmmToMinutes(config.workdayEnd) ?? 21 * 60;
  const bufferMs = Math.max(0, config.bufferMinutes) * MS_PER_MIN;

  // 時間ありイベントを busy 区間に（前後 buffer を確保）。終日イベントは busy にしない。
  const busyAll: Interval[] = [];
  for (const ev of events) {
    if (ev.allDay) continue;
    if (!ev.start || !ev.end) continue;
    const s = Date.parse(ev.start);
    const e = Date.parse(ev.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    busyAll.push({ start: s - bufferMs, end: e + bufferMs });
  }
  busyAll.sort((a, b) => a.start - b.start);

  const slots: Slot[] = [];
  // 期間にかかる各 JST 日を走査する。
  let dayStart = jstDayStart(fromMs);
  const lastDayStart = jstDayStart(toMs);
  for (; dayStart <= lastDayStart; dayStart += 86_400_000) {
    let winStart = dayStart + startMin * MS_PER_MIN;
    let winEnd = dayStart + endMin * MS_PER_MIN;
    // 期間境界（from / to）でクリップ。
    winStart = Math.max(winStart, fromMs);
    winEnd = Math.min(winEnd, toMs);
    if (winEnd - winStart < MS_PER_MIN) continue;

    // この日の blackout 区間（HH:MM → epoch ms）。
    const dayBusy: Interval[] = [];
    for (const bo of config.blackout) {
      const bs = hhmmToMinutes(bo.start);
      const be = hhmmToMinutes(bo.end);
      if (bs === null || be === null || be <= bs) continue;
      dayBusy.push({ start: dayStart + bs * MS_PER_MIN, end: dayStart + be * MS_PER_MIN });
    }
    // この日にかかる時間ありイベント busy。
    for (const b of busyAll) {
      if (b.end <= winStart || b.start >= winEnd) continue;
      dayBusy.push({ start: b.start, end: b.end });
    }
    dayBusy.sort((a, b) => a.start - b.start);

    for (const free of subtractBusy(winStart, winEnd, dayBusy)) {
      if (free.end - free.start < MS_PER_MIN) continue;
      slots.push({ start: free.start, end: free.end, dayStart });
    }
  }
  // 最早優先のため start 昇順。
  slots.sort((a, b) => a.start - b.start);
  return slots;
}

// ─── タスク整列 ──────────────────────────────────────────────

const PRIORITY_RANK: Record<Priority, number> = { high: 0, med: 1, low: 2 };

interface ScheduledTask {
  task: PlanTaskInput;
  est: TaskEstimate;
  meta: TaskMeta | undefined;
  /** due の epoch ms（JST 当日 23:59:59 を期限とみなす）。無ければ undefined。 */
  dueMs: number | undefined;
}

/** due（JST YYYY-MM-DD・時刻なし）を「その日 23:59:59 JST」の epoch ms に。無効は undefined。 */
function dueToMs(due: string | undefined): number | undefined {
  if (!due) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return undefined;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59) - JST_OFFSET_MS;
}

// ─── daypart 判定（同日内の希望帯優先）──────────────────────────

/** epoch ms が JST の希望帯に入るか（morning <12, afternoon 12-18, evening >=18）。 */
function inDaypart(ms: number, daypart: DaypartPref): boolean {
  const jstMin = ((ms + JST_OFFSET_MS) % 86_400_000) / MS_PER_MIN;
  if (daypart === 'morning') return jstMin < 12 * 60;
  if (daypart === 'afternoon') return jstMin >= 12 * 60 && jstMin < 18 * 60;
  return jstMin >= 18 * 60; // evening
}

// ─── 配置本体 ────────────────────────────────────────────────

/** ブロックに付ける根拠を組み立てる。 */
function buildReason(st: ScheduledTask, startMs: number, fixed: boolean): string {
  if (fixed) return '固定時刻の予定';
  const reasons: string[] = [];
  if (st.dueMs !== undefined && st.dueMs - startMs <= 48 * 3600 * 1000) reasons.push('締切が近い');
  if (st.est.priority === 'high') reasons.push('優先度高');
  const dp = st.est.preferredDaypart;
  if (dp && inDaypart(startMs, dp)) {
    reasons.push(dp === 'morning' ? '午前の集中枠' : dp === 'afternoon' ? '午後の枠' : '夜の枠');
  }
  return reasons.length > 0 ? reasons.join('・') : '空き枠に配置';
}

/**
 * 配置エンジン本体。決定的に重複ゼロ・過去なし・締切順守で配置する。
 *
 * @param req       /plan 入力（from/to/tasks/events）。
 * @param config    プランナー設定。
 * @param estimates taskMetaKey(account:taskId) → 統合見積り。
 * @param metaMap   taskMetaKey → 手動上書きメタ（fixed/locked/splittable の参照に使う）。
 * @param usedAi    見積り段階で AI が使われたか（そのまま PlanResponse に通す）。
 */
export function planSchedule(
  req: { from: string; to?: string; tasks: PlanTaskInput[]; events: PlanEventInput[] },
  config: PlannerConfig,
  estimates: Map<string, TaskEstimate>,
  metaMap: Map<string, TaskMeta>,
  usedAi: boolean,
): PlanResponse {
  const fromMs = Date.parse(req.from);
  const now = Date.now();
  // from は「過去に置かない」基準。指定が過去でも now まで引き上げる。
  const effectiveFrom = Math.max(Number.isFinite(fromMs) ? fromMs : now, now);
  const horizonMs = config.horizonDays * 86_400_000;
  const toParsed = req.to ? Date.parse(req.to) : NaN;
  const toMs = Number.isFinite(toParsed) ? toParsed : effectiveFrom + horizonMs;

  const blocks: PlanBlock[] = [];
  const unplaced: PlanResponse['unplaced'] = [];

  if (toMs <= effectiveFrom) {
    // 期間が無い → 全件 unplaced。
    for (const t of req.tasks) {
      unplaced.push({ taskId: t.id, account: t.account, title: t.title, reason: '計画期間が空です' });
    }
    return { blocks, unplaced, usedAi, generatedAt: new Date().toISOString() };
  }

  // ① 空きスロット生成。
  const slots = buildSlots(effectiveFrom, toMs, config, req.events);

  // 日次の既使用分（dailyMaxMinutes 集計）。key=dayStart epoch ms。
  const usedPerDay = new Map<number, number>();

  // 固定予定（fixedStartIso）の busy を先に slots から差し引くため、固定タスクを先に処理する。
  // 整列対象タスク（status=completed は除外）。
  const scheduled: ScheduledTask[] = [];
  for (const t of req.tasks) {
    if ((t.status || '').toLowerCase() === 'completed') continue;
    const mkey = metaKey(t.account, t.id);
    const est = estimates.get(mkey) ?? {
      estMinutes: config.defaultTaskMinutes,
      priority: 'med' as Priority,
      preferredDaypart: null,
      source: 'heuristic' as const,
    };
    scheduled.push({ task: t, est, meta: metaMap.get(mkey), dueMs: dueToMs(t.due) });
  }

  // ② 固定タスク（fixedStartIso が有効）を先に確定配置する。
  const movable: ScheduledTask[] = [];
  for (const st of scheduled) {
    const fixedIso = st.meta?.fixedStartIso;
    if (st.meta?.locked && fixedIso) {
      const startMs = Date.parse(fixedIso);
      if (Number.isFinite(startMs) && startMs >= effectiveFrom) {
        const endMs = startMs + st.est.estMinutes * MS_PER_MIN;
        if (placeFixed(slots, usedPerDay, config, startMs, endMs)) {
          blocks.push(makeBlock(st, startMs, endMs, true));
          continue;
        }
        unplaced.push({
          taskId: st.task.id,
          account: st.task.account,
          title: st.task.title,
          reason: '固定時刻が他の予定/稼働外と重なり配置できません',
        });
        continue;
      }
      // 固定時刻が過去/不正 → 通常配置に回す。
    }
    movable.push(st);
  }

  // ③ 可変タスク整列: due 昇順（無しは最後）→ priority → estMinutes 降順。
  movable.sort((a, b) => {
    const ad = a.dueMs ?? Number.POSITIVE_INFINITY;
    const bd = b.dueMs ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    const ap = PRIORITY_RANK[a.est.priority];
    const bp = PRIORITY_RANK[b.est.priority];
    if (ap !== bp) return ap - bp;
    return b.est.estMinutes - a.est.estMinutes;
  });

  // ④ 貪欲配置。
  for (const st of movable) {
    const durMs = st.est.estMinutes * MS_PER_MIN;
    const deadline = st.dueMs ?? toMs;
    const earliest = effectiveFrom;

    const placed = greedyPlace(
      slots,
      usedPerDay,
      config,
      durMs,
      earliest,
      deadline,
      st.est.preferredDaypart,
    );
    if (placed) {
      blocks.push(makeBlock(st, placed.start, placed.end, false));
    } else {
      const reason =
        st.dueMs !== undefined
          ? '締切までに空きが足りません'
          : '期間内に空きがありません';
      unplaced.push({ taskId: st.task.id, account: st.task.account, title: st.task.title, reason });
    }
  }

  // ブロックは開始時刻順に整える（固定と可変が混ざるため）。
  blocks.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { blocks, unplaced, usedAi, generatedAt: new Date().toISOString() };

  // ─── 内部ヘルパ（クロージャで slots/usedPerDay を共有）─────────

  function makeBlock(st: ScheduledTask, startMs: number, endMs: number, fixed: boolean): PlanBlock {
    return {
      taskId: st.task.id,
      account: st.task.account,
      title: st.task.title,
      start: toIso(startMs),
      end: toIso(endMs),
      estMinutes: st.est.estMinutes,
      reason: buildReason(st, startMs, fixed),
    };
  }
}

/** 1 日の残容量（dailyMaxMinutes − 既使用）。 */
function dayRemainingMs(usedPerDay: Map<number, number>, config: PlannerConfig, dayStart: number, durMs: number): boolean {
  const used = usedPerDay.get(dayStart) ?? 0;
  return used + durMs / MS_PER_MIN <= config.dailyMaxMinutes;
}

/** スロット集合から [start,end) ぶんを切り出してスロットを分割し、日次使用量を加算する。 */
function consume(slots: Slot[], usedPerDay: Map<number, number>, slotIdx: number, start: number, end: number): void {
  const slot = slots[slotIdx];
  const dayStart = slot.dayStart;
  const replacements: Slot[] = [];
  if (start - slot.start >= MS_PER_MIN) replacements.push({ start: slot.start, end: start, dayStart });
  if (slot.end - end >= MS_PER_MIN) replacements.push({ start: end, end: slot.end, dayStart });
  slots.splice(slotIdx, 1, ...replacements);
  usedPerDay.set(dayStart, (usedPerDay.get(dayStart) ?? 0) + (end - start) / MS_PER_MIN);
}

/**
 * 可変タスクを最早スロットに配置する。
 * preferredDaypart があれば「希望帯に入るスロット」を優先し、無ければ希望外でも最早を採る。
 * 締切（deadline）まで・earliestStart 以降・日次上限内で、estMinutes ぶん連続して入る最早枠。
 */
function greedyPlace(
  slots: Slot[],
  usedPerDay: Map<number, number>,
  config: PlannerConfig,
  durMs: number,
  earliest: number,
  deadline: number,
  daypart: DaypartPref | null,
): { start: number; end: number } | null {
  const tryPass = (requireDaypart: boolean): { start: number; end: number } | null => {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const winStart = Math.max(slot.start, earliest);
      const start = winStart;
      const end = start + durMs;
      if (end > slot.end) continue; // このスロットに入り切らない。
      if (end > deadline) continue; // 締切超過。
      if (start < earliest) continue;
      if (!dayRemainingMs(usedPerDay, config, slot.dayStart, durMs)) continue; // 日次上限。
      if (requireDaypart && daypart && !inDaypart(start, daypart)) continue;
      consume(slots, usedPerDay, i, start, end);
      return { start, end };
    }
    return null;
  };

  if (daypart) {
    const pref = tryPass(true);
    if (pref) return pref;
  }
  return tryPass(false);
}

/**
 * 固定タスク（fixedStartIso）を [start,end) に確定配置できるか試す。
 * 既存スロットに完全に収まる（重複なし）かつ日次上限内なら consume して true。無理なら false。
 */
function placeFixed(
  slots: Slot[],
  usedPerDay: Map<number, number>,
  config: PlannerConfig,
  start: number,
  end: number,
): boolean {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (start >= slot.start && end <= slot.end) {
      if (!dayRemainingMs(usedPerDay, config, slot.dayStart, end - start)) return false;
      consume(slots, usedPerDay, i, start, end);
      return true;
    }
    // スロットに収まらないが部分的に重なる場合は配置不可（重複させない）。
    if (overlaps({ start, end }, { start: slot.start, end: slot.end })) {
      // 完全包含でない重なり → このスロットでは置けない。他スロットも完全包含し得ないので失敗。
      return false;
    }
  }
  return false;
}
