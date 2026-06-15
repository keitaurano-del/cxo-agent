// plannerStore — オートプランナー（MC-245 Phase2）の型契約＋ JSONL/JSON ストア。
//
// 「やること」を空き時間ブロックへ自動配置する機能のデータ層。方針は
// 「AI で “見積り”、決定的ロジックで “配置”」（docs/MC-245-auto-scheduler-design.md）。
// ここではフロントと共有する型契約（厳守）と、3 つの永続ストアを提供する:
//   - PlannerConfig : data/planner-config.json（単一 JSON・部分更新マージ last-wins）
//   - TaskMeta      : data/planner-task-meta.jsonl（last-wins by account:taskId）
//   - 見積りキャッシュ : data/planner-estimate-cache.jsonl（last-wins by key）
//
// JSONL の流儀は babyDiaryStore.ts / googleTokenStore.ts に倣う（全走査して key ごとに最新採用）。
// すべて data/ 配下（.gitignore 済み・ランタイムデータ）。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  PLANNER_CONFIG_FILE,
  PLANNER_TASK_META_FILE,
  PLANNER_ESTIMATE_CACHE_FILE,
} from './config.js';

// ─── フロントと共有する型契約（厳守）─────────────────────────────

/** 希望時間帯。 */
export type DaypartPref = 'morning' | 'afternoon' | 'evening';

/** 優先度（4 段。P1=最重要 … P4=後回し可）。旧 high/med/low は normPriority で後方互換マップ。 */
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

/** プランナー設定（稼働時間帯・ブラックアウト・上限・計画期間など）。 */
export interface PlannerConfig {
  /** 稼働開始 'HH:MM'（既定 '09:00'）。 */
  workdayStart: string;
  /** 稼働終了 'HH:MM'（既定 '21:00'）。 */
  workdayEnd: string;
  /** 毎日の禁止帯 'HH:MM'（既定 早朝・深夜）。 */
  blackout: { start: string; end: string }[];
  /** 1 日の作業上限（分・既定 480）。 */
  dailyMaxMinutes: number;
  /** ブロック間バッファ（分・既定 15）。 */
  bufferMinutes: number;
  /** 計画期間日数（既定 7）。 */
  horizonDays: number;
  /** 既定所要（分・既定 30）。 */
  defaultTaskMinutes: number;
  /** 対象 listTitle。null = 全部。 */
  targetLists: string[] | null;
}

/**
 * タスクの手動上書き（保存）＋ AI/heuristic 見積りの統合の最優先入力。
 * account + taskId を一意キーとする。
 */
export interface TaskMeta {
  account: string;
  taskId: string;
  estMinutes?: number;
  priority?: Priority;
  preferredDaypart?: DaypartPref | null;
  splittable?: boolean;
  locked?: boolean;
  fixedStartIso?: string | null;
}

/** /plan の入力タスク（クライアントが Google から取得済みの物を渡す）。 */
export interface PlanTaskInput {
  id: string;
  account: string;
  title: string;
  due?: string;
  status: string;
  listTitle: string;
  notes?: string;
}

/** /plan の入力イベント（既存予定＝busy。時間あり/終日）。 */
export interface PlanEventInput {
  id: string;
  account: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
}

/** /plan の入力（サーバは Google を再取得しない）。 */
export interface PlanRequest {
  /** 計画開始 ISO（通常 now 以降）。 */
  from: string;
  /** 計画終了 ISO（省略時 from + horizonDays）。 */
  to?: string;
  tasks: PlanTaskInput[];
  events: PlanEventInput[];
  /** 前回プラン（sticky 再プラン用）。有効なら位置を維持する（P4b）。 */
  previousBlocks?: PlanBlock[];
}

/** 配置された 1 ブロック。 */
export interface PlanBlock {
  taskId: string;
  account: string;
  title: string;
  start: string;
  end: string;
  estMinutes: number;
  reason: string;
}

/**
 * 未配置のカテゴリ（P4a）。
 *  - deadline-miss : due があり、その due までに置けなかった（締切に間に合わない＝要対応）。
 *  - no-due-overflow: due が無く、容量不足で置けなかった（期日なしの後回し）。
 *  - no-capacity  : それ以外（due が計画期間より先 等で期間内に置けない／一般の容量不足）。
 */
export type UnplacedCategory = 'deadline-miss' | 'no-capacity' | 'no-due-overflow';

/** 配置できなかった 1 件（理由つき・黙って落とさない）。 */
export interface UnplacedItem {
  taskId: string;
  account: string;
  title: string;
  reason: string;
  category: UnplacedCategory;
}

/** /plan の出力。 */
export interface PlanResponse {
  blocks: PlanBlock[];
  unplaced: UnplacedItem[];
  usedAi: boolean;
  generatedAt: string;
  /** previousBlocks と比べ位置が変わった/新規になったブロック数（未指定なら blocks.length）。 */
  movedCount: number;
  /** sticky で位置を維持したブロック数（未指定なら 0）。 */
  keptCount: number;
}

// ─── 既定値 ──────────────────────────────────────────────

/** プランナー設定の既定値。設定ファイルが無い/欠けたキーはこれで埋める。 */
export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  workdayStart: '09:00',
  workdayEnd: '21:00',
  blackout: [
    { start: '00:00', end: '07:00' },
    { start: '22:00', end: '24:00' },
  ],
  dailyMaxMinutes: 480,
  bufferMinutes: 15,
  // 既定の計画期間は 14 日（タスクが多く空き時間が限られる運用で、7日だと未配置が大量に出るため広げた）。
  horizonDays: 14,
  defaultTaskMinutes: 30,
  targetLists: null,
};

// ─── 汎用 JSONL ヘルパ（last-wins）─────────────────────────

/** JSONL を全走査して key ごとの最新レコードを返す（last-wins）。壊れた行は無視。 */
function readAllJsonl<T>(file: string, keyOf: (rec: T) => string | undefined): Map<string, T> {
  const map = new Map<string, T>();
  if (!existsSync(file)) return map;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return map;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as T;
      const key = keyOf(rec);
      if (key) map.set(key, rec);
    } catch {
      // 壊れた行は無視。
    }
  }
  return map;
}

/** JSONL に 1 行追記する。ディレクトリが無ければ作成。 */
function appendJsonl(file: string, rec: unknown): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
}

// ─── プランナー設定（単一 JSON・部分更新マージ）─────────────────

/** 設定を読む（無ければ既定。欠けたキーは既定で補完）。 */
export function getConfig(): PlannerConfig {
  if (!existsSync(PLANNER_CONFIG_FILE)) return { ...DEFAULT_PLANNER_CONFIG };
  try {
    const raw = readFileSync(PLANNER_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PlannerConfig>;
    return mergeConfig(DEFAULT_PLANNER_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_PLANNER_CONFIG };
  }
}

/** base に patch を浅くマージ（undefined のキーは base を維持）。 */
function mergeConfig(base: PlannerConfig, patch: Partial<PlannerConfig>): PlannerConfig {
  return {
    workdayStart: patch.workdayStart ?? base.workdayStart,
    workdayEnd: patch.workdayEnd ?? base.workdayEnd,
    blackout: patch.blackout ?? base.blackout,
    dailyMaxMinutes: patch.dailyMaxMinutes ?? base.dailyMaxMinutes,
    bufferMinutes: patch.bufferMinutes ?? base.bufferMinutes,
    horizonDays: patch.horizonDays ?? base.horizonDays,
    defaultTaskMinutes: patch.defaultTaskMinutes ?? base.defaultTaskMinutes,
    // targetLists は null を明示値として尊重するため、undefined のときだけ base を使う。
    targetLists: patch.targetLists === undefined ? base.targetLists : patch.targetLists,
  };
}

/** 設定を部分更新して保存する（現在値とマージ・last-wins）。保存後の全体を返す。 */
export function saveConfig(patch: Partial<PlannerConfig>): PlannerConfig {
  const merged = mergeConfig(getConfig(), patch);
  const dir = dirname(PLANNER_CONFIG_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PLANNER_CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

// ─── タスク手動上書きメタ（JSONL・last-wins by account:taskId）──────

/** account + taskId の合成キー。 */
export function metaKey(account: string, taskId: string): string {
  return account + '\u0000' + taskId;
}

/** 手動上書きメタの一覧（last-wins）。 */
export function listTaskMeta(): TaskMeta[] {
  const map = readAllJsonl<TaskMeta & { removed?: boolean }>(
    PLANNER_TASK_META_FILE,
    (r) => (r.account && r.taskId ? metaKey(r.account, r.taskId) : undefined),
  );
  const out: TaskMeta[] = [];
  for (const rec of map.values()) {
    if ((rec as { removed?: boolean }).removed) continue;
    const { removed: _removed, ...pub } = rec as TaskMeta & { removed?: boolean };
    out.push(pub);
  }
  out.sort((a, b) => metaKey(a.account, a.taskId).localeCompare(metaKey(b.account, b.taskId)));
  return out;
}

/** account+taskId をキーに手動上書きメタを引く Map（配置/見積りの統合で使う）。 */
export function taskMetaMap(): Map<string, TaskMeta> {
  const map = new Map<string, TaskMeta>();
  for (const m of listTaskMeta()) map.set(metaKey(m.account, m.taskId), m);
  return map;
}

/** 手動上書きメタを 1 件 upsert（追記・last-wins）。保存したレコードを返す。 */
export function upsertTaskMeta(meta: TaskMeta): TaskMeta {
  appendJsonl(PLANNER_TASK_META_FILE, meta);
  return meta;
}

// ─── AI 見積りキャッシュ（JSONL・last-wins by key）─────────────────

/** キャッシュ 1 件（key は account:taskId + 内容ハッシュ）。 */
export interface EstimateCacheRecord {
  /** account:taskId + 内容（title+notes）ハッシュ。内容不変なら同 key で再ヒットする。 */
  key: string;
  estMinutes: number;
  priority: Priority;
  preferredDaypart: DaypartPref | null;
  cachedAt: string;
}

/** 見積りキャッシュ全件を key→record で返す（last-wins）。 */
export function estimateCacheMap(): Map<string, EstimateCacheRecord> {
  return readAllJsonl<EstimateCacheRecord>(PLANNER_ESTIMATE_CACHE_FILE, (r) => r.key);
}

/** 見積りキャッシュを 1 件追記する（last-wins）。 */
export function appendEstimateCache(rec: EstimateCacheRecord): void {
  appendJsonl(PLANNER_ESTIMATE_CACHE_FILE, rec);
}
