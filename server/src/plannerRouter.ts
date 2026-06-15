// plannerRouter — オートプランナー（MC-245 Phase2）の REST API（auth ミドルウェア配下）。
//
//  GET  /api/planner/config      : PlannerConfig（無ければ既定）。
//  PUT  /api/planner/config      : 部分更新（検証付き・現在値とマージして last-wins 保存）。
//  GET  /api/planner/task-meta   : TaskMeta[]（手動上書きの一覧）。
//  PUT  /api/planner/task-meta   : 1 件 upsert（account+taskId キー）。
//  POST /api/planner/plan        : PlanRequest → PlanResponse（見積り統合 → 決定的配置）。
//
// 方針: 「AI で “見積り”、決定的ロジックで “配置”」。/plan は plannerEstimate で
// 所要/優先度/時間帯を見積もり（手動 > AI(キャッシュ) > ヒューリスティック）、plannerEngine で
// 重複ゼロ・締切順守の決定的配置を行う。AI 失敗でも 200 でヒューリスティック結果を返す。
// 不正入力は 400。ストア流儀は babyDiaryRouter / navOrderRouter に倣う。

import { Router, type Request, type Response } from 'express';

import {
  getConfig,
  saveConfig,
  listTaskMeta,
  upsertTaskMeta,
  taskMetaMap,
  type DaypartPref,
  type PlanBlock,
  type PlannerConfig,
  type PlanEventInput,
  type PlanRequest,
  type PlanTaskInput,
  type TaskMeta,
} from './plannerStore.js';
import { normPriority } from './plannerEstimate.js';
import { estimateTasks } from './plannerEstimate.js';
import { planSchedule } from './plannerEngine.js';

// ─── バリデーション補助 ─────────────────────────────────────

const HHMM_RE = /^([01]?\d|2[0-4]):[0-5]\d$/; // 00:00〜24:00。

function isHHMM(v: unknown): v is string {
  return typeof v === 'string' && HHMM_RE.test(v.trim());
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** P1-P4（4 段）または旧 high/med/low を受理（保存時は normPriority で P1-P4 に正規化）。 */
function isPriorityInput(v: unknown): boolean {
  return (
    v === 'P1' || v === 'P2' || v === 'P3' || v === 'P4' ||
    v === 'high' || v === 'med' || v === 'low'
  );
}

function isDaypart(v: unknown): v is DaypartPref {
  return v === 'morning' || v === 'afternoon' || v === 'evening';
}

// ─── config の検証つき部分更新 ─────────────────────────────────

/**
 * PlannerConfig の部分更新パッチを検証して取り出す。
 * 不正な型・範囲は 400 を投げる（res に書いて null を返す）。指定の無いキーは patch に含めない。
 */
function validateConfigPatch(body: Record<string, unknown>, res: Response): Partial<PlannerConfig> | null {
  const patch: Partial<PlannerConfig> = {};

  if (body.workdayStart !== undefined) {
    if (!isHHMM(body.workdayStart)) {
      res.status(400).json({ error: 'workdayStart must be HH:MM' });
      return null;
    }
    patch.workdayStart = body.workdayStart.trim();
  }
  if (body.workdayEnd !== undefined) {
    if (!isHHMM(body.workdayEnd)) {
      res.status(400).json({ error: 'workdayEnd must be HH:MM' });
      return null;
    }
    patch.workdayEnd = body.workdayEnd.trim();
  }
  if (body.blackout !== undefined) {
    if (!Array.isArray(body.blackout)) {
      res.status(400).json({ error: 'blackout must be an array of { start, end }' });
      return null;
    }
    const out: { start: string; end: string }[] = [];
    for (const b of body.blackout) {
      if (!b || typeof b !== 'object') {
        res.status(400).json({ error: 'each blackout must be { start: HH:MM, end: HH:MM }' });
        return null;
      }
      const rec = b as Record<string, unknown>;
      if (!isHHMM(rec.start) || !isHHMM(rec.end)) {
        res.status(400).json({ error: 'each blackout start/end must be HH:MM' });
        return null;
      }
      out.push({ start: rec.start.trim(), end: rec.end.trim() });
    }
    patch.blackout = out;
  }
  for (const key of ['dailyMaxMinutes', 'bufferMinutes', 'horizonDays', 'defaultTaskMinutes'] as const) {
    if (body[key] !== undefined) {
      if (!isFiniteNumber(body[key]) || (body[key] as number) < 0) {
        res.status(400).json({ error: `${key} must be a non-negative number` });
        return null;
      }
      patch[key] = body[key] as number;
    }
  }
  if (body.targetLists !== undefined) {
    if (body.targetLists === null) {
      patch.targetLists = null;
    } else if (Array.isArray(body.targetLists) && body.targetLists.every((s) => typeof s === 'string')) {
      patch.targetLists = body.targetLists as string[];
    } else {
      res.status(400).json({ error: 'targetLists must be string[] or null' });
      return null;
    }
  }
  return patch;
}

// ─── task-meta の検証 ─────────────────────────────────────────

/** PUT /task-meta の body を検証して TaskMeta に正規化する。不正は 400 を書いて null。 */
function validateTaskMeta(body: Record<string, unknown>, res: Response): TaskMeta | null {
  if (typeof body.account !== 'string' || body.account.trim() === '') {
    res.status(400).json({ error: 'account is required' });
    return null;
  }
  if (typeof body.taskId !== 'string' || body.taskId.trim() === '') {
    res.status(400).json({ error: 'taskId is required' });
    return null;
  }
  const meta: TaskMeta = { account: body.account.trim(), taskId: body.taskId.trim() };

  if (body.estMinutes !== undefined) {
    if (!isFiniteNumber(body.estMinutes) || body.estMinutes <= 0) {
      res.status(400).json({ error: 'estMinutes must be a positive number' });
      return null;
    }
    meta.estMinutes = body.estMinutes;
  }
  if (body.priority !== undefined) {
    if (!isPriorityInput(body.priority)) {
      res.status(400).json({ error: "priority must be 'P1' | 'P2' | 'P3' | 'P4' (or legacy high/med/low)" });
      return null;
    }
    // 保存は 4 段に正規化（旧 high/med/low も P1-P4 に変換して統一）。
    meta.priority = normPriority(body.priority);
  }
  if (body.preferredDaypart !== undefined) {
    if (body.preferredDaypart !== null && !isDaypart(body.preferredDaypart)) {
      res.status(400).json({ error: "preferredDaypart must be 'morning' | 'afternoon' | 'evening' | null" });
      return null;
    }
    meta.preferredDaypart = body.preferredDaypart as DaypartPref | null;
  }
  if (body.splittable !== undefined) {
    if (typeof body.splittable !== 'boolean') {
      res.status(400).json({ error: 'splittable must be boolean' });
      return null;
    }
    meta.splittable = body.splittable;
  }
  if (body.locked !== undefined) {
    if (typeof body.locked !== 'boolean') {
      res.status(400).json({ error: 'locked must be boolean' });
      return null;
    }
    meta.locked = body.locked;
  }
  if (body.fixedStartIso !== undefined) {
    if (body.fixedStartIso !== null) {
      if (typeof body.fixedStartIso !== 'string' || !Number.isFinite(Date.parse(body.fixedStartIso))) {
        res.status(400).json({ error: 'fixedStartIso must be an ISO datetime string or null' });
        return null;
      }
      meta.fixedStartIso = body.fixedStartIso;
    } else {
      meta.fixedStartIso = null;
    }
  }
  return meta;
}

// ─── /plan 入力の検証 ─────────────────────────────────────────

/** /plan の tasks 1 件を検証して PlanTaskInput に正規化。不正は null。 */
function normTask(raw: unknown): PlanTaskInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.account !== 'string' || typeof r.title !== 'string') return null;
  if (typeof r.status !== 'string' || typeof r.listTitle !== 'string') return null;
  return {
    id: r.id,
    account: r.account,
    title: r.title,
    status: r.status,
    listTitle: r.listTitle,
    ...(typeof r.due === 'string' ? { due: r.due } : {}),
    ...(typeof r.notes === 'string' ? { notes: r.notes } : {}),
  };
}

/** /plan の previousBlocks 1 件を検証して PlanBlock に正規化。不正は null（静かに落とす）。 */
function normPrevBlock(raw: unknown): PlanBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.taskId !== 'string' || typeof r.account !== 'string') return null;
  if (typeof r.start !== 'string' || !Number.isFinite(Date.parse(r.start))) return null;
  if (typeof r.end !== 'string' || !Number.isFinite(Date.parse(r.end))) return null;
  return {
    taskId: r.taskId,
    account: r.account,
    title: typeof r.title === 'string' ? r.title : '',
    start: r.start,
    end: r.end,
    estMinutes: isFiniteNumber(r.estMinutes) ? r.estMinutes : 0,
    reason: typeof r.reason === 'string' ? r.reason : '',
  };
}

/** /plan の events 1 件を検証して PlanEventInput に正規化。不正は null。 */
function normEvent(raw: unknown): PlanEventInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.account !== 'string' || typeof r.title !== 'string') return null;
  return {
    id: r.id,
    account: r.account,
    title: r.title,
    start: typeof r.start === 'string' ? r.start : null,
    end: typeof r.end === 'string' ? r.end : null,
    allDay: r.allDay === true,
  };
}

// ─── ハンドラ ───────────────────────────────────────────────

function handleGetConfig(_req: Request, res: Response): void {
  res.json(getConfig());
}

function handlePutConfig(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch = validateConfigPatch(body, res);
  if (patch === null) return; // 400 は validate 内で送信済み。
  res.json(saveConfig(patch));
}

function handleGetTaskMeta(_req: Request, res: Response): void {
  res.json(listTaskMeta());
}

function handlePutTaskMeta(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const meta = validateTaskMeta(body, res);
  if (meta === null) return;
  res.json(upsertTaskMeta(meta));
}

/**
 * POST /api/planner/plan — 見積り統合 → 決定的配置で PlanResponse を返す。
 * tasks/events を targetLists でフィルタし、estimateTasks（AI/heuristic）→ planSchedule の順。
 * AI 失敗でも 200 でヒューリスティック結果を返す（estimateTasks 内で吸収）。
 */
async function handlePlan(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (typeof body.from !== 'string' || !Number.isFinite(Date.parse(body.from))) {
    res.status(400).json({ error: 'from is required and must be an ISO datetime' });
    return;
  }
  if (body.to !== undefined && (typeof body.to !== 'string' || !Number.isFinite(Date.parse(body.to)))) {
    res.status(400).json({ error: 'to must be an ISO datetime' });
    return;
  }
  if (!Array.isArray(body.tasks)) {
    res.status(400).json({ error: 'tasks must be an array' });
    return;
  }
  if (body.events !== undefined && !Array.isArray(body.events)) {
    res.status(400).json({ error: 'events must be an array' });
    return;
  }
  if (body.previousBlocks !== undefined && !Array.isArray(body.previousBlocks)) {
    res.status(400).json({ error: 'previousBlocks must be an array' });
    return;
  }

  // 入力を正規化（不正項目は静かに落とす＝堅牢性優先）。
  const tasks: PlanTaskInput[] = [];
  for (const t of body.tasks) {
    const norm = normTask(t);
    if (norm) tasks.push(norm);
  }
  const events: PlanEventInput[] = [];
  for (const e of (body.events as unknown[] | undefined) ?? []) {
    const norm = normEvent(e);
    if (norm) events.push(norm);
  }

  // previousBlocks（sticky 用）。指定があれば正規化（不正項目は静かに落とす）。
  // 指定そのものが無い場合は undefined のまま（従来挙動: moved=blocks.length, kept=0）。
  let previousBlocks: PlanBlock[] | undefined;
  if (Array.isArray(body.previousBlocks)) {
    previousBlocks = [];
    for (const pb of body.previousBlocks) {
      const norm = normPrevBlock(pb);
      if (norm) previousBlocks.push(norm);
    }
  }

  const config = getConfig();

  // targetLists（null=全部）でタスクを絞る。
  const filteredTasks =
    config.targetLists === null
      ? tasks
      : tasks.filter((t) => config.targetLists!.includes(t.listTitle));

  const fromMs = Date.parse(body.from);
  const metaMap = taskMetaMap();

  // 見積り（手動 > AI(キャッシュ) > ヒューリスティック）。AI 失敗は内部で吸収される。
  const { byKey, usedAi } = await estimateTasks(filteredTasks, metaMap, config.defaultTaskMinutes, fromMs);

  // 決定的配置。
  const planReq: PlanRequest = {
    from: body.from,
    ...(typeof body.to === 'string' ? { to: body.to } : {}),
    tasks: filteredTasks,
    events,
    ...(previousBlocks !== undefined ? { previousBlocks } : {}),
  };
  const result = planSchedule(planReq, config, byKey, metaMap, usedAi);
  res.json(result);
}

// ─── Router 組み立て ─────────────────────────────────────────

/** /api/planner 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function plannerRouter(): Router {
  const router = Router();
  router.get('/config', handleGetConfig);
  router.put('/config', handlePutConfig);
  router.get('/task-meta', handleGetTaskMeta);
  router.put('/task-meta', handlePutTaskMeta);
  router.post('/plan', (req, res) => {
    // handlePlan の reject を握りつぶさない（未処理 rejection でプロセスが落ちるのを防ぐ）。
    handlePlan(req, res).catch((err) => {
      console.error('[planner] plan failed', err);
      if (!res.headersSent) res.status(500).json({ error: 'plan failed' });
    });
  });
  return router;
}
