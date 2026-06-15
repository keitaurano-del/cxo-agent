// スケジュールページ（/schedule, MC-245 P1 設計）。
// Google カレンダーの予定・ToDo を「月／週／日」の3ビューで読み取り表示する。
// オートプランナー（自動スケジューリング）は後続フェーズ MC-248 で別途。ここはビューの土台のみ。
// データ取得・型・アカウント識別色は BabyDiary の流儀を踏襲（BabyDiary 自体は編集しない）。
// 日付計算は自前（date-fns 等の新規依存は足さない）。JST 前提で 'YYYY-MM-DD' 文字列演算を使う。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ResourceState } from '../components/ui';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EyeIcon,
  LinkIcon,
  SettingsIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
} from '../components/icons';

// ─── API 型（サーバ契約に対応。BabyDiary の対応型と同一）──────────
interface GoogleAccount {
  email: string;
  connectedAt?: string;
  scope?: string;
}

interface GoogleStatus {
  configured: boolean;
  accounts: GoogleAccount[];
}

// Google カレンダーの予定。start/end はサーバ正規化済みの文字列。
// 終日=YYYY-MM-DD、時刻あり=RFC3339(例 2026-06-02T09:00:00+09:00)。allDay で判別する。
interface GoogleCalendarEvent {
  id: string;
  account: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  htmlLink?: string;
}

interface CalendarEventsResponse {
  events: GoogleCalendarEvent[];
  errors?: unknown[];
}

// Google ToDo（Google Tasks）。due は 'YYYY-MM-DD'（時刻を持たない＝終日扱い）。
interface GoogleTask {
  id: string;
  account: string; // email
  title: string;
  due?: string; // YYYY-MM-DD（期日なしは未設定）
  status: string; // 'needsAction' | 'completed' 等
  listTitle: string;
  notes?: string;
}

interface TasksResponse {
  tasks: GoogleTask[];
  errors?: unknown[];
}

// ─── オートプランナー API 型（/api/planner。サーバ契約と同一）──────
// 集中時間／習慣枠の 1 定義。daysOfWeek は 0=日..6=土（JST）。
interface FocusBlockDef {
  title: string;
  daysOfWeek: number[];
  start: string; // 'HH:MM'
  durationMin: number;
}

interface PlannerConfig {
  workdayStart: string; // 'HH:MM'
  workdayEnd: string; // 'HH:MM'
  blackout: { start: string; end: string }[];
  dailyMaxMinutes: number;
  bufferMinutes: number;
  horizonDays: number;
  defaultTaskMinutes: number;
  targetLists: string[] | null;
  focusBlocks: FocusBlockDef[];
}

// プランの 1 ブロック（提示のみ・Google 未反映）。start/end は ISO(RFC3339)。
// kind: 'task'（省略時も含む）＝タスクブロック / 'focus'＝集中時間（習慣枠）ブロック。
type PlanBlockKind = 'task' | 'focus';
interface PlanBlock {
  taskId: string;
  account: string;
  title: string;
  start: string;
  end: string;
  estMinutes: number;
  reason: string;
  kind?: PlanBlockKind;
}

/** focus ブロック判定（kind 省略時はタスク扱い）。 */
function isFocusBlock(b: PlanBlock): boolean {
  return b.kind === 'focus';
}

// 未配置のカテゴリ（サーバ契約。reason は従来どおり日本語文字列）。
//  deadline-miss   … 締切に間に合わない（要対応として強調）
//  no-capacity     … 容量不足で後回し（正常な溢れ）
//  no-due-overflow … 期日なしが溢れた（正常な溢れ）
type UnplacedCategory = 'deadline-miss' | 'no-capacity' | 'no-due-overflow';

// 配置できなかった 1 件（理由つき・黙って落とさない）。
interface UnplacedItem {
  taskId: string;
  account: string;
  title: string;
  reason: string;
  category: UnplacedCategory;
}

interface PlanResponse {
  blocks: PlanBlock[];
  unplaced: UnplacedItem[];
  usedAi: boolean;
  generatedAt: string;
  // 前回プラン比（previousBlocks を渡したときのみ意味を持つ）。
  movedCount: number; // 動いた/新規ブロック数
  keptCount: number; // 維持されたブロック数
}

// タスクメタ更新の body（PUT /api/planner/task-meta）。
interface TaskMetaPatch {
  account: string;
  taskId: string;
  locked?: boolean;
  fixedStartIso?: string;
  estMinutes?: number;
  priority?: 'P1' | 'P2' | 'P3' | 'P4';
  preferredDaypart?: string;
}

// プラン作成時に POST /plan へ渡す events の最小形（NormalizedEvent）。
interface PlanEventInput {
  id: string;
  account: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
}

// plan-apply の 1 ブロック入力（サーバ契約。reason は任意）。
interface PlanApplyBlock {
  taskId?: string;
  title: string;
  start: string;
  end: string;
  reason?: string;
}

// POST /calendar/plan-apply のレスポンス。
interface PlanApplyResponse {
  account: string;
  created: number;
  failed: number;
  errors?: string[];
}

// POST /calendar/plan-clear のレスポンス。
interface PlanClearResponse {
  account: string;
  removed: number;
}

// ─── ビュー種別 ─────────────────────────────────────────────
type ViewMode = 'month' | 'week' | 'day';

// ─── 日付ユーティリティ（JST 基準の YYYY-MM-DD を文字列演算で扱う）──
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 今日（クライアント現在日）を ISO(JST) で返す。 */
function todayIso(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' を {y,m,d}（m は 1-12）へ分解。 */
function partsOf(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** year-month-day を 'YYYY-MM-DD' へ（month は 1-12）。 */
function toIso(year: number, month1: number, day: number): string {
  const m = String(month1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/** ISO 日付に日数を加算した ISO を返す（JST 固定の正午基準でずれを避ける）。 */
function addDaysIso(iso: string, days: number): string {
  const { y, m, d } = partsOf(iso);
  // 正午起点なら DST の無い JST で日跨ぎが安全。Date の月末繰上げを利用する。
  const dt = new Date(y, m - 1, d + days, 12, 0, 0, 0);
  return toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** ISO 日付の曜日（0=日〜6=土）。 */
function weekdayOf(iso: string): number {
  const { y, m, d } = partsOf(iso);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getDay();
}

/** その月の日数。month1 は 1-12。 */
function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** iso を含む週の日曜日（週始まり）の ISO を返す。 */
function startOfWeekIso(iso: string): string {
  return addDaysIso(iso, -weekdayOf(iso));
}

/** 'YYYY-MM-DD' を 'M月D日(曜)' 表記へ。 */
function formatMd(iso: string): string {
  const { m, d } = partsOf(iso);
  return `${m}月${d}日(${WEEKDAY_NAMES[weekdayOf(iso)]})`;
}

/** RFC3339 文字列から JST 分（0:00 からの経過分）を算出。時刻が無ければ null。 */
function minutesOfDay(value: string | null): number | null {
  if (!value || !value.includes('T')) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

// ─── Google イベントのパース（BabyDiary 流儀を踏襲）────────────
/** Google イベント start の表示用ローカル YYYY-MM-DD（日付セルへの割り当て用）。 */
function eventDateIso(start: string | null, allDay: boolean): string {
  if (!start) return '';
  if (allDay || !start.includes('T')) return start.slice(0, 10);
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return start.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 時刻なし終日 or 'HH:MM' の短い表示文字列。 */
function eventTimeLabel(ev: GoogleCalendarEvent): string {
  if (ev.allDay || !ev.start || !ev.start.includes('T')) return '終日';
  const d = new Date(ev.start);
  if (Number.isNaN(d.getTime())) return '終日';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 表示期間の [timeMin, timeMax)（ローカル境界の ISO 文字列）を算出。 */
function rangeIso(mode: ViewMode, anchor: string): { timeMin: string; timeMax: string } {
  if (mode === 'month') {
    const { y, m } = partsOf(anchor);
    const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const end = new Date(y, m, 1, 0, 0, 0, 0);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }
  if (mode === 'week') {
    const wStart = startOfWeekIso(anchor);
    const wEnd = addDaysIso(wStart, 7);
    const a = partsOf(wStart);
    const b = partsOf(wEnd);
    return {
      timeMin: new Date(a.y, a.m - 1, a.d, 0, 0, 0, 0).toISOString(),
      timeMax: new Date(b.y, b.m - 1, b.d, 0, 0, 0, 0).toISOString(),
    };
  }
  // day
  const next = addDaysIso(anchor, 1);
  const a = partsOf(anchor);
  const b = partsOf(next);
  return {
    timeMin: new Date(a.y, a.m - 1, a.d, 0, 0, 0, 0).toISOString(),
    timeMax: new Date(b.y, b.m - 1, b.d, 0, 0, 0, 0).toISOString(),
  };
}

// ─── アカウント識別色（接続順に循環。BabyDiary と同じ流儀）──────
const ACCOUNT_COLOR_VARS = [
  'var(--mc-accent)',
  'var(--mc-review)',
  'var(--mc-blocked)',
  'var(--mc-active)',
  'var(--mc-idle)',
  'var(--mc-stalled)',
] as const;

/** 接続済みアカウントのメール → 識別色 の対応（並び順で循環）。 */
function buildAccountColors(emails: string[]): Map<string, string> {
  const m = new Map<string, string>();
  emails.forEach((email, i) => {
    m.set(email, ACCOUNT_COLOR_VARS[i % ACCOUNT_COLOR_VARS.length]);
  });
  return m;
}

// ─── 時間グリッドの既定範囲（6:00〜23:00。範囲外に予定があれば広げる）──
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 23;
const HOUR_PX = 44; // 1時間の高さ(px)

// ─── ルート ─────────────────────────────────────────────────
export default function Schedule() {
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => todayIso(now), [now]);

  const [mode, setMode] = useState<ViewMode>('month');
  // anchor: 表示中の基準日（月ビューは月内のいずれか／週ビューは週内／日ビューは当日）。
  const [anchor, setAnchor] = useState<string>(today);

  // ── Google 連携状態 ──
  const [gstatus, setGstatus] = useState<GoogleStatus | null>(null);
  const accounts = gstatus?.accounts ?? [];
  const hasAccounts = accounts.length > 0;
  const configured = gstatus?.configured ?? false;

  const accountColors = useMemo(
    () => buildAccountColors(accounts.map((a) => a.email)),
    [accounts],
  );

  const fetchGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/google/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GoogleStatus;
      setGstatus(json);
    } catch {
      setGstatus({ configured: false, accounts: [] });
    }
  }, []);

  useEffect(() => {
    void fetchGoogleStatus();
  }, [fetchGoogleStatus]);

  // ── 表示中ビュー/期間の予定・タスク取得 ──
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // status 取得が済んだか（status 解決前に「未接続」を一瞬出さないため）。
  const statusReady = gstatus !== null;

  useEffect(() => {
    if (!statusReady) return;
    if (!hasAccounts) {
      setEvents([]);
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const { timeMin, timeMax } = rangeIso(mode, anchor);
    const qs = `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [evRes, tkRes] = await Promise.all([
          fetch(`/api/google/calendar/events?${qs}`),
          fetch(`/api/google/tasks?${qs}`),
        ]);
        if (cancelled) return;
        const evJson: CalendarEventsResponse = evRes.ok ? await evRes.json() : { events: [] };
        const tkJson: TasksResponse = tkRes.ok ? await tkRes.json() : { tasks: [] };
        if (cancelled) return;
        setEvents(evJson.events ?? []);
        setTasks(tkJson.tasks ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusReady, hasAccounts, mode, anchor]);

  // date(YYYY-MM-DD) → 予定配列。
  const eventsByDate = useMemo(() => {
    const m = new Map<string, GoogleCalendarEvent[]>();
    for (const ev of events) {
      const iso = eventDateIso(ev.start, ev.allDay);
      if (!iso) continue;
      const arr = m.get(iso) ?? [];
      arr.push(ev);
      m.set(iso, arr);
    }
    return m;
  }, [events]);

  // due(YYYY-MM-DD) → タスク配列（due 有りのみ。タスクは時刻なし＝終日扱い）。
  const tasksByDate = useMemo(() => {
    const m = new Map<string, GoogleTask[]>();
    for (const t of tasks) {
      if (!t.due) continue;
      const arr = m.get(t.due) ?? [];
      arr.push(t);
      m.set(t.due, arr);
    }
    return m;
  }, [tasks]);

  // ── オートプランナー（提示のみ。Google 書き戻しは P3 で別途）──
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(true);
  const [plannerConfig, setPlannerConfig] = useState<PlannerConfig | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // このセッションでロックした「account|taskId」集合（即時反映用）。
  // サーバ（task-meta）にも保存するが、UI 反映はこの集合を一次ソースとする。
  const [lockedKeys, setLockedKeys] = useState<Set<string>>(() => new Set());
  // ロック保存→再プランの直列処理中フラグ（連打防止）。
  const [lockBusy, setLockBusy] = useState(false);

  // ── プランの Google カレンダー反映/削除（MC-245 P3）──
  // 登録先アカウント（選択。既定＝先頭。複数接続時のみ select を出す）。
  const [applyAccount, setApplyAccount] = useState<string>('');
  // 接続アカウントが揃ったら、未選択 or もう存在しない選択を先頭に正す。
  useEffect(() => {
    if (accounts.length === 0) return;
    setApplyAccount((cur) =>
      cur && accounts.some((a) => a.email === cur) ? cur : accounts[0].email,
    );
  }, [accounts]);

  const [applyLoading, setApplyLoading] = useState(false); // 登録/削除の直列処理中
  const [applyError, setApplyError] = useState<string | null>(null);
  // 完了メッセージ（created/failed/removed のトースト相当。inline で控えめに表示）。
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [applyDetail, setApplyDetail] = useState<string[]>([]); // errors の控えめ表示

  // 表示中のプランブロック（非表示トグル時は空）。
  const planBlocks = useMemo(
    () => (showPlan && plan ? plan.blocks : []),
    [showPlan, plan],
  );
  const planByDate = useMemo(() => groupPlanByDay(planBlocks), [planBlocks]);

  // 「プランを作成」: config 取得 → [now, now+horizon] の events/tasks を取得 → POST /plan。
  // sticky 再プラン: 既にプランがあれば現在の blocks を previousBlocks として渡し、
  //   有効な前回配置の位置を維持する（再実行で配置がガラッと変わらない）。
  const createPlan = useCallback(async () => {
    setPlanLoading(true);
    setPlanError(null);
    // クロージャ時点の現プラン（sticky 用）。state 更新前に確定させる。
    const prevBlocks = plan?.blocks ?? null;
    try {
      // config（horizonDays を使う。取得済みなら再利用）。
      let cfg = plannerConfig;
      if (!cfg) {
        const cRes = await fetch('/api/planner/config');
        if (!cRes.ok) throw new Error(`設定の取得に失敗しました (HTTP ${cRes.status})`);
        cfg = (await cRes.json()) as PlannerConfig;
        setPlannerConfig(cfg);
      }
      const nowDate = new Date();
      const fromIso = nowDate.toISOString();
      const toIso2 = new Date(nowDate.getTime() + cfg.horizonDays * 24 * 60 * 60 * 1000).toISOString();

      // 期間 [from,to] の events/tasks を取得（既存の取得経路を期間指定で再利用）。
      const qs = `timeMin=${encodeURIComponent(fromIso)}&timeMax=${encodeURIComponent(toIso2)}`;
      const [evRes, tkRes] = await Promise.all([
        fetch(`/api/google/calendar/events?${qs}`),
        fetch(`/api/google/tasks?${qs}`),
      ]);
      const evJson: CalendarEventsResponse = evRes.ok ? await evRes.json() : { events: [] };
      const tkJson: TasksResponse = tkRes.ok ? await tkRes.json() : { tasks: [] };

      // events を NormalizedEvent 形へ写像（サーバ契約の最小形）。
      const planEvents: PlanEventInput[] = (evJson.events ?? []).map((ev) => ({
        id: ev.id,
        account: ev.account,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        allDay: ev.allDay,
      }));

      const body: {
        from: string;
        to: string;
        tasks: GoogleTask[];
        events: PlanEventInput[];
        previousBlocks?: PlanBlock[];
      } = {
        from: fromIso,
        to: toIso2,
        tasks: tkJson.tasks ?? [],
        events: planEvents,
      };
      // 前回プランがある時だけ sticky 用に previousBlocks を載せる（無ければ付けない）。
      if (prevBlocks && prevBlocks.length > 0) body.previousBlocks = prevBlocks;

      const res = await fetch('/api/planner/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`プラン作成に失敗しました (HTTP ${res.status})`);
      const json = (await res.json()) as PlanResponse;
      setPlan(json);
      setShowPlan(true);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanLoading(false);
    }
  }, [plannerConfig, plan]);

  // プランブロックのロック切替: task-meta を保存 → 成功後にそのまま sticky 再プラン。
  // 即時反映のため lockedKeys を先に更新し、サーバ保存失敗時はロールバックする。
  const toggleLock = useCallback(
    async (block: PlanBlock) => {
      if (lockBusy) return;
      const key = blockKey(block.account, block.taskId);
      const nextLocked = !lockedKeys.has(key);
      setLockBusy(true);
      // 楽観更新（UI 即時反映）。
      setLockedKeys((cur) => {
        const next = new Set(cur);
        if (nextLocked) next.add(key);
        else next.delete(key);
        return next;
      });
      try {
        const patch: TaskMetaPatch = {
          account: block.account,
          taskId: block.taskId,
          locked: nextLocked,
        };
        const res = await fetch('/api/planner/task-meta', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`ロックの保存に失敗しました (HTTP ${res.status})`);
        // 保存成功 → そのまま再プラン（previousBlocks 付きで反映）。
        await createPlan();
      } catch (e) {
        // 失敗時はロックの楽観更新を巻き戻す。
        setLockedKeys((cur) => {
          const next = new Set(cur);
          if (nextLocked) next.delete(key);
          else next.add(key);
          return next;
        });
        setPlanError(e instanceof Error ? e.message : String(e));
      } finally {
        setLockBusy(false);
      }
    },
    [lockBusy, lockedKeys, createPlan],
  );

  // 設定パネルを開く（未取得なら取得）。
  const openSettings = useCallback(async () => {
    setShowSettings(true);
    if (!plannerConfig) {
      try {
        const res = await fetch('/api/planner/config');
        if (res.ok) setPlannerConfig((await res.json()) as PlannerConfig);
      } catch {
        // 取得失敗時はパネル側で既定を促すだけ（致命的ではない）。
      }
    }
  }, [plannerConfig]);

  // 現在ビュー範囲の予定・タスクを再取得（apply/clear 後に📋反映を見せる）。
  const reloadCalendar = useCallback(async () => {
    if (!hasAccounts) return;
    const { timeMin, timeMax } = rangeIso(mode, anchor);
    const qs = `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
    try {
      const [evRes, tkRes] = await Promise.all([
        fetch(`/api/google/calendar/events?${qs}`),
        fetch(`/api/google/tasks?${qs}`),
      ]);
      const evJson: CalendarEventsResponse = evRes.ok ? await evRes.json() : { events: [] };
      const tkJson: TasksResponse = tkRes.ok ? await tkRes.json() : { tasks: [] };
      setEvents(evJson.events ?? []);
      setTasks(tkJson.tasks ?? []);
    } catch {
      // 再取得失敗は致命ではない（次のナビ/操作で復帰する）。
    }
  }, [hasAccounts, mode, anchor]);

  // 「このプランでカレンダーに登録」: 確認 → 同 account を plan-clear（範囲）→ plan-apply。
  // 登録先は選択アカウントの primary。重複防止のため再登録は置き換え（clear→apply）。
  const applyPlan = useCallback(async () => {
    if (!plan || plan.blocks.length === 0) return;
    const account = applyAccount || accounts[0]?.email;
    if (!account) return;
    const count = plan.blocks.length;
    const ok = window.confirm(
      `Google カレンダー（${account} の primary）に ${count} 件のプラン予定を登録します。よろしいですか？\n\n` +
        '※ 同じ時間帯の既存プラン予定（📋）はいったん削除してから登録します（置き換え・重複しません）。',
    );
    if (!ok) return;

    setApplyLoading(true);
    setApplyError(null);
    setApplyNotice(null);
    setApplyDetail([]);
    try {
      // plan-clear の範囲＝プラン最小start〜最大end。空なら now〜now+horizon。
      const starts = plan.blocks.map((b) => b.start).filter(Boolean);
      const ends = plan.blocks.map((b) => b.end).filter(Boolean);
      let timeMin: string | undefined;
      let timeMax: string | undefined;
      if (starts.length > 0 && ends.length > 0) {
        timeMin = starts.reduce((a, b) => (a < b ? a : b));
        timeMax = ends.reduce((a, b) => (a > b ? a : b));
      } else {
        const horizon = plannerConfig?.horizonDays ?? 14;
        const nowDate = new Date();
        timeMin = nowDate.toISOString();
        timeMax = new Date(nowDate.getTime() + horizon * 24 * 60 * 60 * 1000).toISOString();
      }

      // 1) 重複防止のため同 account の該当範囲を先にクリア。
      const clearRes = await fetch('/api/google/calendar/plan-clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, timeMin, timeMax }),
      });
      if (!clearRes.ok) {
        throw new Error(`既存プランのクリアに失敗しました (HTTP ${clearRes.status})`);
      }

      // 2) plan-apply（blocks を最小形へ写像）。
      const blocks: PlanApplyBlock[] = plan.blocks.map((b) => ({
        taskId: b.taskId,
        title: b.title,
        start: b.start,
        end: b.end,
        reason: b.reason,
      }));
      const res = await fetch('/api/google/calendar/plan-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, blocks }),
      });
      if (!res.ok) throw new Error(`カレンダー登録に失敗しました (HTTP ${res.status})`);
      const json = (await res.json()) as PlanApplyResponse;

      setApplyNotice(
        `${account} の primary に登録しました：成功 ${json.created} 件` +
          (json.failed > 0 ? ` / 失敗 ${json.failed} 件` : ''),
      );
      setApplyDetail(json.errors ?? []);

      // 3) 📋イベントが見えるよう現在ビューを再取得。
      await reloadCalendar();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyLoading(false);
    }
  }, [plan, applyAccount, accounts, plannerConfig, reloadCalendar]);

  // 「カレンダーから削除（プランをクリア）」: 確認 → plan-clear（広め範囲）→ 再取得。
  const clearPlan = useCallback(async () => {
    const account = applyAccount || accounts[0]?.email;
    if (!account) return;
    const ok = window.confirm(
      `Google カレンダー（${account} の primary）から、登録済みのプラン予定（📋）を削除します。よろしいですか？`,
    );
    if (!ok) return;

    setApplyLoading(true);
    setApplyError(null);
    setApplyNotice(null);
    setApplyDetail([]);
    try {
      // 広めの範囲（now-1日 〜 now+60日）で一括削除。
      const nowDate = new Date();
      const timeMin = new Date(nowDate.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(nowDate.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch('/api/google/calendar/plan-clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, timeMin, timeMax }),
      });
      if (!res.ok) throw new Error(`カレンダーからの削除に失敗しました (HTTP ${res.status})`);
      const json = (await res.json()) as PlanClearResponse;
      setApplyNotice(`${account} の primary から ${json.removed} 件のプラン予定を削除しました。`);
      await reloadCalendar();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyLoading(false);
    }
  }, [applyAccount, accounts, reloadCalendar]);

  // 設定保存（部分更新）。保存後の最新 config を state に反映。
  const saveSettings = useCallback(async (patch: Partial<PlannerConfig>) => {
    const res = await fetch('/api/planner/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`設定の保存に失敗しました (HTTP ${res.status})`);
    setPlannerConfig((await res.json()) as PlannerConfig);
  }, []);

  // ── 期間ナビゲーション ──
  const goPrev = () => {
    if (mode === 'month') {
      const { y, m } = partsOf(anchor);
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      // 月内の日番号は安全に 1 に丸める（月末日でも繰上げを起こさない）。
      setAnchor(toIso(py, pm, 1));
    } else {
      setAnchor(addDaysIso(anchor, mode === 'week' ? -7 : -1));
    }
  };
  const goNext = () => {
    if (mode === 'month') {
      const { y, m } = partsOf(anchor);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      setAnchor(toIso(ny, nm, 1));
    } else {
      setAnchor(addDaysIso(anchor, mode === 'week' ? 7 : 1));
    }
  };
  const goToday = () => setAnchor(today);

  // 日セルクリック → 日ビューでその日に遷移。
  const openDay = useCallback((iso: string) => {
    setAnchor(iso);
    setMode('day');
  }, []);

  // 現在期間ラベル。
  const periodLabel = useMemo(() => {
    if (mode === 'month') {
      const { y, m } = partsOf(anchor);
      return `${y}年${MONTH_NAMES[m - 1]}`;
    }
    if (mode === 'week') {
      const wStart = startOfWeekIso(anchor);
      const wEnd = addDaysIso(wStart, 6);
      return `${formatMd(wStart)} 〜 ${formatMd(wEnd)} の週`;
    }
    const { y } = partsOf(anchor);
    return `${y}年${formatMd(anchor)}`;
  }, [mode, anchor]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="スケジュール"
        subtitle="Googleカレンダーの予定とToDoを月／週／日で見渡せます（表示のみ）。"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          {/* ツールバー: ビュー切替 ＋ 期間ナビ */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center md:justify-between md:p-4">
            <ViewToggle mode={mode} onChange={setMode} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToday}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-text-muted hover:bg-surface-2 hover:text-text"
              >
                今日
              </button>
              <button
                type="button"
                onClick={goPrev}
                aria-label="前へ"
                className="rounded-md border border-border p-1 text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <ChevronLeftIcon width={16} height={16} />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="次へ"
                className="rounded-md border border-border p-1 text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <ChevronRightIcon width={16} height={16} />
              </button>
              <span className="ml-1 min-w-0 truncate text-sm font-bold text-text">{periodLabel}</span>
            </div>
          </div>

          {/* プランナー操作バー（接続済みのとき） */}
          {hasAccounts && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between md:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void createPlan()}
                  disabled={planLoading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-[12px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <SparkIcon width={14} height={14} />
                  {planLoading
                    ? 'プラン作成中…'
                    : plan
                      ? '再プラン（できるだけ維持）'
                      : 'プランを作成'}
                </button>
                {plan && (
                  <button
                    type="button"
                    onClick={() => setShowPlan((v) => !v)}
                    aria-pressed={showPlan}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                      showPlan
                        ? 'border-accent/60 bg-accent/5 text-accent'
                        : 'border-border text-text-muted hover:bg-surface-2 hover:text-text'
                    }`}
                  >
                    <EyeIcon width={14} height={14} />
                    {showPlan ? 'プランを表示中' : 'プランを表示'}
                  </button>
                )}
                {planLoading && (
                  <span className="text-[11px] text-text-muted">
                    AI見積りで数〜十数秒かかります…
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void openSettings()}
                aria-label="プランナー設定"
                className="inline-flex items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text sm:self-auto"
              >
                <SettingsIcon width={14} height={14} />
                設定
              </button>
            </div>
          )}

          {/* プラン → Google カレンダー 反映/削除（プランがある時のみ・接続済みのみ） */}
          {hasAccounts && plan && (
            <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-3 md:p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                {/* 登録先アカウント選択（複数接続時のみ） */}
                {accounts.length > 1 && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
                    登録先
                    <select
                      value={applyAccount}
                      onChange={(e) => setApplyAccount(e.target.value)}
                      disabled={applyLoading}
                      className="rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text disabled:opacity-60"
                    >
                      {accounts.map((a) => (
                        <option key={a.email} value={a.email}>
                          {a.email}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => void applyPlan()}
                  disabled={applyLoading || plan.blocks.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-[12px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UploadIcon width={14} height={14} />
                  {applyLoading ? '処理中…' : 'このプランでカレンダーに登録'}
                </button>

                <button
                  type="button"
                  onClick={() => void clearPlan()}
                  disabled={applyLoading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <TrashIcon width={14} height={14} />
                  カレンダーから削除（プランをクリア）
                </button>

                {applyLoading && (
                  <span className="text-[11px] text-text-muted">
                    Google カレンダーへ反映中（数秒かかります）…
                  </span>
                )}
              </div>

              {/* 注記 */}
              <p className="text-[11px] leading-relaxed text-text-faint">
                登録先アカウントの primary に「📋」付きで登録され、いつでも「クリア」で削除できます。
                登録は提示プランの置き換えです（再登録で重複しません）。
              </p>

              {/* 完了メッセージ（created/failed/removed） */}
              {applyNotice && (
                <div className="flex items-start gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] text-accent">
                  <CheckIcon width={13} height={13} className="mt-px shrink-0" />
                  <span>{applyNotice}</span>
                </div>
              )}
              {/* errors の控えめ表示 */}
              {applyDetail.length > 0 && (
                <ul className="flex flex-col gap-0.5 rounded-md border border-blocked/40 bg-blocked/10 px-2.5 py-1.5">
                  {applyDetail.map((msg, i) => (
                    <li key={i} className="text-[10px] leading-tight text-text-muted">
                      {msg}
                    </li>
                  ))}
                </ul>
              )}
              {/* 反映エラー */}
              {applyError && (
                <div className="rounded-md border border-blocked/50 bg-blocked/10 px-2.5 py-1.5 text-[11px] text-blocked">
                  {applyError}
                </div>
              )}
            </div>
          )}

          {/* プランのメタ情報・エラー・未配置 */}
          {planError && (
            <div className="rounded-lg border border-blocked/50 bg-blocked/10 px-3 py-2 text-xs text-blocked">
              {planError}
            </div>
          )}
          {plan && showPlan && (
            <PlanSummary
              plan={plan}
              lockedKeys={lockedKeys}
              lockBusy={lockBusy}
              onToggleLock={(b) => void toggleLock(b)}
            />
          )}

          {/* アカウント凡例（接続済みのとき） */}
          {hasAccounts && <AccountLegend accounts={accounts} accountColors={accountColors} />}

          {!statusReady ? (
            <ResourceState loading error={null} hasData={false}>
              <div />
            </ResourceState>
          ) : !hasAccounts ? (
            <NotConnected configured={configured} />
          ) : (
            <ResourceState loading={loading} error={error} hasData={events.length + tasks.length >= 0}>
              {mode === 'month' && (
                <MonthView
                  anchor={anchor}
                  today={today}
                  eventsByDate={eventsByDate}
                  tasksByDate={tasksByDate}
                  planByDate={planByDate}
                  accountColors={accountColors}
                  onSelectDay={openDay}
                />
              )}
              {mode === 'week' && (
                <WeekView
                  anchor={anchor}
                  today={today}
                  now={now}
                  events={events}
                  planBlocks={planBlocks}
                  tasksByDate={tasksByDate}
                  accountColors={accountColors}
                  onSelectDay={openDay}
                  lockedKeys={lockedKeys}
                  lockBusy={lockBusy}
                  onToggleLock={(b) => void toggleLock(b)}
                />
              )}
              {mode === 'day' && (
                <DayView
                  anchor={anchor}
                  today={today}
                  now={now}
                  events={events}
                  planBlocks={planBlocks}
                  tasksByDate={tasksByDate}
                  accountColors={accountColors}
                  lockedKeys={lockedKeys}
                  lockBusy={lockBusy}
                  onToggleLock={(b) => void toggleLock(b)}
                />
              )}
            </ResourceState>
          )}
        </div>
      </div>

      {/* プランナー設定モーダル（最小） */}
      {showSettings && (
        <PlannerSettingsModal
          config={plannerConfig}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}
    </div>
  );
}

// ─── プラン要約（メタ情報＋未配置＋ブロック一覧）───────────────
function PlanSummary({
  plan,
  lockedKeys,
  lockBusy,
  onToggleLock,
}: {
  plan: PlanResponse;
  lockedKeys: Set<string>;
  lockBusy: boolean;
  onToggleLock: (block: PlanBlock) => void;
}) {
  const generated = (() => {
    const d = new Date(plan.generatedAt);
    if (Number.isNaN(d.getTime())) return plan.generatedAt;
    return `${formatMd(eventDateIso(plan.generatedAt, false))} ${isoHmLabel(plan.generatedAt)}`;
  })();

  // 未配置をカテゴリ別に振り分ける。
  //  deadline-miss             → 要対応（最上部に強調・常時展開）
  //  no-capacity/no-due-overflow → 容量不足の正常な溢れ（控えめ・折りたたみ）
  const deadlineMiss = plan.unplaced.filter((u) => u.category === 'deadline-miss');
  const overflow = plan.unplaced.filter(
    (u) => u.category === 'no-capacity' || u.category === 'no-due-overflow',
  );

  // moved/kept 表示は前回プランがあった再プラン時のみ（初回＝両方 0 は出さない）。
  const showDelta = plan.movedCount + plan.keptCount > 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-muted">
        <span className="inline-flex items-center gap-1 font-semibold text-accent">
          <SparkIcon width={13} height={13} />
          プラン {plan.blocks.length}件
        </span>
        <span>{plan.usedAi ? 'AI見積りで作成' : 'ヒューリスティック見積りで作成'}</span>
        {showDelta && (
          <span className="font-medium text-text">
            {plan.keptCount}件を維持・{plan.movedCount}件を更新
          </span>
        )}
        <span>生成: {generated}</span>
        <span className="text-text-faint">（Googleには未反映＝提示のみ）</span>
      </div>

      {/* 締切に間に合わない（要対応・常時展開で強調） */}
      {deadlineMiss.length > 0 && (
        <div className="rounded-md border border-blocked/60 bg-blocked/15 p-2">
          <p className="mb-1 text-[11px] font-semibold text-blocked">
            ⚠️ 締切に間に合わない（{deadlineMiss.length}件）— 要対応
          </p>
          <ul className="flex flex-col gap-0.5">
            {deadlineMiss.map((u) => (
              <li key={`${u.account}-${u.taskId}`} className="text-[11px] leading-tight text-text-muted">
                <span className="font-medium text-text">{u.title}</span>
                <span className="text-text-faint"> — {u.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 容量不足で後回し（正常な溢れ・控えめ＋折りたたみ） */}
      {overflow.length > 0 && <OverflowSection items={overflow} />}

      {/* ブロック一覧（ロックのトグル付き） */}
      {plan.blocks.length > 0 && (
        <PlanBlockList
          blocks={plan.blocks}
          lockedKeys={lockedKeys}
          lockBusy={lockBusy}
          onToggleLock={onToggleLock}
        />
      )}
    </div>
  );
}

// 容量不足の溢れ（折りたたみ・既定は閉じる）。
function OverflowSection({ items }: { items: UnplacedItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-surface-2/50 p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-left text-[11px] font-semibold text-text-muted hover:text-text"
      >
        <ChevronRightIcon
          width={12}
          height={12}
          className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        容量不足で後回し（{items.length}件）
      </button>
      {open ? (
        <>
          <p className="mt-1 text-[10px] leading-tight text-text-faint">
            稼働時間に入りきらなかった通常の溢れです（締切超過ではありません）。
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {items.map((u) => (
              <li key={`${u.account}-${u.taskId}`} className="text-[11px] leading-tight text-text-muted">
                <span className="font-medium text-text">{u.title}</span>
                <span className="text-text-faint"> — {u.reason}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-0.5 text-[10px] leading-tight text-text-faint">
          稼働時間に入りきらなかった通常の溢れです（クリックで展開）。
        </p>
      )}
    </div>
  );
}

// プランブロック一覧（日時順）＋ロックのトグル（🔒）。
function PlanBlockList({
  blocks,
  lockedKeys,
  lockBusy,
  onToggleLock,
}: {
  blocks: PlanBlock[];
  lockedKeys: Set<string>;
  lockBusy: boolean;
  onToggleLock: (block: PlanBlock) => void;
}) {
  const sorted = useMemo(
    () => blocks.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
    [blocks],
  );
  return (
    <div className="rounded-md border border-accent/30 bg-bg/40 p-2">
      <p className="mb-1 text-[11px] font-semibold text-text-muted">
        ブロック一覧 — 🔒は「再プランで動かさない」（位置を固定）
      </p>
      <ul className="flex flex-col gap-0.5">
        {sorted.map((b) => {
          // focus（集中枠）はタスクではないためロックトグルを付けない。代わりに「集中」ラベル。
          if (isFocusBlock(b)) {
            return (
              <li
                key={`focus-${b.taskId}-${b.start}`}
                className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-[11px] leading-tight"
              >
                <span
                  className="shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: 'color-mix(in srgb, var(--mc-review) 15%, transparent)',
                    color: 'var(--mc-review)',
                  }}
                >
                  集中
                </span>
                <span className="shrink-0 tabular-nums text-text-faint">
                  {formatMd(planBlockDateIso(b))} {isoHmLabel(b.start)}〜{isoHmLabel(b.end)}
                </span>
                <span className="truncate font-medium text-text">{b.title}</span>
              </li>
            );
          }
          const locked = lockedKeys.has(blockKey(b.account, b.taskId));
          return (
            <li
              key={`${b.account}-${b.taskId}-${b.start}`}
              className={`flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-[11px] leading-tight ${
                locked ? 'bg-accent/10' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onToggleLock(b)}
                disabled={lockBusy}
                aria-pressed={locked}
                title={
                  locked
                    ? 'ロック中：再プランで動かしません（クリックで解除）'
                    : 'ロックすると再プランで動かしません（位置を固定）'
                }
                className={`shrink-0 rounded-sm px-1 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  locked
                    ? 'text-accent hover:bg-accent/20'
                    : 'opacity-50 hover:bg-surface-2 hover:opacity-100'
                }`}
              >
                {locked ? '🔒' : '🔓'}
              </button>
              <span className="shrink-0 tabular-nums text-text-faint">
                {formatMd(planBlockDateIso(b))} {isoHmLabel(b.start)}〜{isoHmLabel(b.end)}
              </span>
              <span className="truncate font-medium text-text">{b.title}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── プランナー設定モーダル（稼働時間帯など主要項目のみ）───────────
function PlannerSettingsModal({
  config,
  onClose,
  onSave,
}: {
  config: PlannerConfig | null;
  onClose: () => void;
  onSave: (patch: Partial<PlannerConfig>) => Promise<void>;
}) {
  const [workdayStart, setWorkdayStart] = useState('');
  const [workdayEnd, setWorkdayEnd] = useState('');
  const [dailyMaxMinutes, setDailyMaxMinutes] = useState('');
  const [bufferMinutes, setBufferMinutes] = useState('');
  const [horizonDays, setHorizonDays] = useState('');
  // 集中時間／習慣枠の編集用ローカル状態（フォーム入力は文字列で持ち、保存時に正規化）。
  const [focusBlocks, setFocusBlocks] = useState<FocusBlockDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // config 取得後にフォーム初期値を流し込む。
  useEffect(() => {
    if (!config) return;
    setWorkdayStart(config.workdayStart);
    setWorkdayEnd(config.workdayEnd);
    setDailyMaxMinutes(String(config.dailyMaxMinutes));
    setBufferMinutes(String(config.bufferMinutes));
    setHorizonDays(String(config.horizonDays));
    setFocusBlocks((config.focusBlocks ?? []).map(toFocusDraft));
  }, [config]);

  const addFocusBlock = () => {
    setFocusBlocks((cur) => [...cur, { title: '', daysOfWeek: [], start: '', durationMin: '' }]);
  };
  const removeFocusBlock = (idx: number) => {
    setFocusBlocks((cur) => cur.filter((_, i) => i !== idx));
  };
  const updateFocusBlock = (idx: number, patch: Partial<FocusBlockDraft>) => {
    setFocusBlocks((cur) => cur.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };
  const toggleFocusDay = (idx: number, day: number) => {
    setFocusBlocks((cur) =>
      cur.map((b, i) => {
        if (i !== idx) return b;
        const has = b.daysOfWeek.includes(day);
        const days = has ? b.daysOfWeek.filter((d) => d !== day) : [...b.daysOfWeek, day].sort((a, c) => a - c);
        return { ...b, daysOfWeek: days };
      }),
    );
  };

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      // 集中枠のクライアントバリデーション → 正規化。不正なら保存しない。
      const normalizedFocus: FocusBlockDef[] = [];
      for (let i = 0; i < focusBlocks.length; i++) {
        const draft = focusBlocks[i];
        const validated = validateFocusDraft(draft);
        if (typeof validated === 'string') {
          throw new Error(`集中枠${i + 1}「${draft.title || '(無題)'}」: ${validated}`);
        }
        normalizedFocus.push(validated);
      }
      const patch: Partial<PlannerConfig> = {
        workdayStart,
        workdayEnd,
        dailyMaxMinutes: Number(dailyMaxMinutes),
        bufferMinutes: Number(bufferMinutes),
        horizonDays: Number(horizonDays),
        focusBlocks: normalizedFocus,
      };
      await onSave(patch);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="プランナー設定"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">プランナー設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        {!config ? (
          <p className="py-6 text-center text-xs text-text-muted">設定を読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <SettingsField label="稼働開始">
                <input
                  type="time"
                  value={workdayStart}
                  onChange={(e) => setWorkdayStart(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-text"
                />
              </SettingsField>
              <SettingsField label="稼働終了">
                <input
                  type="time"
                  value={workdayEnd}
                  onChange={(e) => setWorkdayEnd(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-text"
                />
              </SettingsField>
            </div>
            <SettingsField label="1日の作業上限（分）">
              <input
                type="number"
                min={0}
                value={dailyMaxMinutes}
                onChange={(e) => setDailyMaxMinutes(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-text"
              />
            </SettingsField>
            <SettingsField label="ブロック間バッファ（分）">
              <input
                type="number"
                min={0}
                value={bufferMinutes}
                onChange={(e) => setBufferMinutes(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-text"
              />
            </SettingsField>
            <SettingsField label="計画期間（日）">
              <input
                type="number"
                min={1}
                value={horizonDays}
                onChange={(e) => setHorizonDays(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-text"
              />
            </SettingsField>

            {/* 集中時間／習慣枠エディタ（focusBlocks） */}
            <FocusBlocksEditor
              blocks={focusBlocks}
              onAdd={addFocusBlock}
              onRemove={removeFocusBlock}
              onUpdate={updateFocusBlock}
              onToggleDay={toggleFocusDay}
            />

            <p className="text-[11px] text-text-faint">
              targetLists・禁止帯（blackout）は既定のまま。保存後「プランを作成」で再計算してください。
            </p>

            {err && <p className="text-[11px] text-blocked">{err}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-text-muted hover:bg-surface-2 hover:text-text"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-[12px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

// ─── 集中時間／習慣枠エディタ ───────────────────────────────────
// フォーム入力中は数値も文字列で保持し（途中の空文字を許容）、保存時に正規化＋検証する。
interface FocusBlockDraft {
  title: string;
  daysOfWeek: number[];
  start: string; // 'HH:MM'
  durationMin: string;
}

/** 保存済み FocusBlockDef → 編集用ドラフト。 */
function toFocusDraft(def: FocusBlockDef): FocusBlockDraft {
  return {
    title: def.title,
    daysOfWeek: def.daysOfWeek.slice().sort((a, b) => a - b),
    start: def.start,
    durationMin: String(def.durationMin),
  };
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ドラフトを検証し、OK なら FocusBlockDef、NG ならエラー文字列を返す。 */
function validateFocusDraft(draft: FocusBlockDraft): FocusBlockDef | string {
  const title = draft.title.trim();
  if (!title) return '枠名を入力してください';
  if (draft.daysOfWeek.length === 0) return '曜日を1つ以上選んでください';
  if (!HHMM_RE.test(draft.start)) return '開始は HH:MM 形式で入力してください';
  const duration = Number(draft.durationMin);
  if (!Number.isFinite(duration) || duration <= 0) return '長さ（分）は正の数で入力してください';
  return {
    title,
    daysOfWeek: draft.daysOfWeek.slice().sort((a, b) => a - b),
    start: draft.start,
    durationMin: Math.round(duration),
  };
}

function FocusBlocksEditor({
  blocks,
  onAdd,
  onRemove,
  onUpdate,
  onToggleDay,
}: {
  blocks: FocusBlockDraft[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, patch: Partial<FocusBlockDraft>) => void;
  onToggleDay: (idx: number, day: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-text">集中時間／習慣枠</span>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md border border-accent bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20"
        >
          ＋ 枠を追加
        </button>
      </div>
      <p className="text-[10px] leading-tight text-text-faint">
        毎週の決まった集中時間・習慣枠です。プラン作成時に予定として確保されます。
      </p>

      {blocks.length === 0 ? (
        <p className="py-1 text-center text-[11px] text-text-faint">枠はありません</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {blocks.map((b, idx) => (
            <li key={idx} className="flex flex-col gap-1.5 rounded-md border border-border bg-bg p-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={b.title}
                  onChange={(e) => onUpdate(idx, { title: e.target.value })}
                  placeholder="枠名（例: 朝の集中）"
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text"
                />
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  aria-label="この枠を削除"
                  className="shrink-0 rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-blocked"
                >
                  <TrashIcon width={14} height={14} />
                </button>
              </div>

              {/* 曜日トグル（0=日..6=土） */}
              <div className="flex flex-wrap gap-1">
                {WEEKDAY_NAMES.map((w, day) => {
                  const on = b.daysOfWeek.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => onToggleDay(idx, day)}
                      aria-pressed={on}
                      className={`h-6 w-6 rounded-md border text-[11px] font-medium transition-colors ${
                        on
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border text-text-muted hover:bg-surface-2 hover:text-text'
                      }`}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium text-text-muted">開始</span>
                  <input
                    type="time"
                    value={b.start}
                    onChange={(e) => onUpdate(idx, { start: e.target.value })}
                    className="w-full rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium text-text-muted">長さ（分）</span>
                  <input
                    type="number"
                    min={1}
                    value={b.durationMin}
                    onChange={(e) => onUpdate(idx, { durationMin: e.target.value })}
                    className="w-full rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text"
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── ビュー切替トグル ───────────────────────────────────────
function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const tabs: { id: ViewMode; label: string }[] = [
    { id: 'month', label: '月' },
    { id: 'week', label: '週' },
    { id: 'day', label: '日' },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border bg-bg p-0.5" role="tablist" aria-label="表示切替">
      {tabs.map((t) => {
        const active = mode === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`min-w-[3rem] rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── アカウント凡例 ─────────────────────────────────────────
function AccountLegend({
  accounts,
  accountColors,
}: {
  accounts: GoogleAccount[];
  accountColors: Map<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-text-muted">
      {accounts.map((a) => (
        <span key={a.email} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: accountColors.get(a.email) ?? 'var(--mc-accent)' }}
            aria-hidden
          />
          <span className="truncate">{a.email}</span>
        </span>
      ))}
    </div>
  );
}

// ─── 未接続表示 ─────────────────────────────────────────────
function NotConnected({ configured }: { configured: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
      <p className="text-sm font-medium text-text">Googleを接続してください</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-text-muted">
        カレンダーの予定とToDoを表示するには、Googleアカウントの接続が必要です。
        {configured
          ? '育児ページの「成長日記」設定からアカウントを接続できます。'
          : 'Google連携は設定準備中です（管理者がクレデンシャル設定後に有効化されます）。'}
      </p>
      <span className="mt-4 inline-flex items-center gap-1.5 text-xs text-text-faint">
        <LinkIcon width={14} height={14} />
        接続後、この画面に予定が表示されます。
      </span>
    </div>
  );
}

// ─── 月ビュー ───────────────────────────────────────────────
function MonthView({
  anchor,
  today,
  eventsByDate,
  tasksByDate,
  planByDate,
  accountColors,
  onSelectDay,
}: {
  anchor: string;
  today: string;
  eventsByDate: Map<string, GoogleCalendarEvent[]>;
  tasksByDate: Map<string, GoogleTask[]>;
  planByDate: Map<string, PlanBlock[]>;
  accountColors: Map<string, string>;
  onSelectDay: (iso: string) => void;
}) {
  const { y, m } = partsOf(anchor);
  const lead = weekdayOf(toIso(y, m, 1)); // 先頭の空白セル数
  const total = daysInMonth(y, m);

  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <section className="rounded-lg border border-border bg-surface p-3 md:p-4">
      {/* 曜日見出し */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_NAMES.map((w, i) => (
          <div
            key={w}
            className={`pb-1 text-[11px] font-semibold ${
              i === 0 ? 'text-blocked' : i === 6 ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 日セル */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`b${idx}`} className="min-h-[5.5rem]" />;
          const iso = toIso(y, m, day);
          const isToday = iso === today;
          const wd = weekdayOf(iso);
          const dayEvents = (eventsByDate.get(iso) ?? []).slice();
          const dayTasks = tasksByDate.get(iso) ?? [];
          // 時刻あり → 時刻順、終日 → 末尾。
          dayEvents.sort((a, b) => {
            const ma = minutesOfDay(a.start);
            const mb = minutesOfDay(b.start);
            if (ma === null && mb === null) return 0;
            if (ma === null) return 1;
            if (mb === null) return -1;
            return ma - mb;
          });
          const shown = dayEvents.slice(0, 3);
          const more = dayEvents.length - shown.length;
          const dayPlan = planByDate.get(iso) ?? [];
          const dayFocusCount = dayPlan.filter(isFocusBlock).length;
          const dayTaskPlanCount = dayPlan.length - dayFocusCount;

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDay(iso)}
              aria-label={`${y}年${m}月${day}日`}
              className={`flex min-h-[5.5rem] flex-col items-stretch gap-0.5 overflow-hidden rounded-md border p-1 text-left transition-colors ${
                isToday ? 'border-accent/60 bg-accent/10' : 'border-border bg-bg hover:bg-surface-2'
              }`}
            >
              <span
                className={`text-[11px] font-semibold leading-none ${
                  isToday ? 'text-accent' : wd === 0 ? 'text-blocked' : wd === 6 ? 'text-accent' : 'text-text'
                }`}
              >
                {day}
              </span>

              {/* 予定チップ（時刻 or 終日 ＋ アカウント色） */}
              {shown.map((ev) => (
                <span
                  key={ev.id}
                  title={`${eventTimeLabel(ev)} ${ev.title}（${ev.account}）`}
                  className="flex items-center gap-1 overflow-hidden rounded-sm bg-surface-2 px-1 py-0.5 text-[9px] leading-tight text-text-muted"
                >
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: accountColors.get(ev.account) ?? 'var(--mc-idle)' }}
                  />
                  <span className="truncate">
                    {ev.allDay ? '' : `${eventTimeLabel(ev)} `}
                    {ev.title}
                  </span>
                </span>
              ))}
              {more > 0 && <span className="px-1 text-[9px] leading-tight text-text-faint">ほか{more}件</span>}

              {/* プラン件数チップ（提示のみ・アクセント点線） */}
              {dayTaskPlanCount > 0 && (
                <span
                  title={`プラン ${dayTaskPlanCount} 件（提示のみ・Google未反映）`}
                  className="flex items-center gap-1 overflow-hidden rounded-sm border border-dashed border-accent bg-accent/10 px-1 py-0.5 text-[9px] leading-tight text-accent"
                >
                  <span className="truncate font-semibold">プラン {dayTaskPlanCount}件</span>
                </span>
              )}

              {/* 集中枠チップ（習慣枠・violet 実線でプランと区別） */}
              {dayFocusCount > 0 && (
                <span
                  title={`集中時間（習慣枠） ${dayFocusCount} 件`}
                  className="flex items-center gap-1 overflow-hidden rounded-sm border border-solid px-1 py-0.5 text-[9px] leading-tight"
                  style={{
                    borderColor: 'var(--mc-review)',
                    background: 'color-mix(in srgb, var(--mc-review) 12%, transparent)',
                    color: 'var(--mc-review)',
                  }}
                >
                  <span className="truncate font-semibold">集中 {dayFocusCount}件</span>
                </span>
              )}

              {/* タスク（due）＝終日チップ。完了は取り消し線。 */}
              {dayTasks.map((t) => {
                const done = t.status === 'completed';
                return (
                  <span
                    key={t.id}
                    title={`ToDo: ${t.title}（${t.account}）`}
                    className="flex items-center gap-1 overflow-hidden rounded-sm border border-border bg-bg px-1 py-0.5 text-[9px] leading-tight text-text-muted"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-[1px]"
                      style={{ background: accountColors.get(t.account) ?? 'var(--mc-idle)' }}
                    />
                    <span className={`truncate ${done ? 'line-through opacity-60' : ''}`}>{t.title}</span>
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── 時間グリッドの共通計算 ─────────────────────────────────
/**
 * 表示日群の時刻あり予定（＋任意でプランブロック）から、表示すべき時間範囲を決める。
 * プランは空き時間に置かれるため、稼働時間帯がデフォルト外なら範囲を広げてクリップを防ぐ。
 */
function computeHourRange(
  events: GoogleCalendarEvent[],
  planBlocks: PlanBlock[] = [],
): { startHour: number; endHour: number } {
  let minH = DEFAULT_START_HOUR;
  let maxH = DEFAULT_END_HOUR;
  for (const ev of events) {
    if (ev.allDay) continue;
    const s = minutesOfDay(ev.start);
    const e = minutesOfDay(ev.end);
    if (s !== null) minH = Math.min(minH, Math.floor(s / 60));
    if (e !== null) maxH = Math.max(maxH, Math.ceil(e / 60));
  }
  for (const b of planBlocks) {
    const s = minutesOfDay(b.start);
    const e = minutesOfDay(b.end);
    if (s !== null) minH = Math.min(minH, Math.floor(s / 60));
    if (e !== null) maxH = Math.max(maxH, Math.ceil(e / 60));
  }
  return { startHour: Math.max(0, minH), endHour: Math.min(24, Math.max(maxH, minH + 1)) };
}

interface PositionedEvent {
  ev: GoogleCalendarEvent;
  topPx: number;
  heightPx: number;
  col: number; // 重なり時の横位置インデックス
  cols: number; // 同時に重なる総列数
}

/** 1日分の時刻あり予定を縦位置・高さ・簡易な重なり列に割り付ける。 */
function layoutTimedEvents(
  events: GoogleCalendarEvent[],
  startHour: number,
): PositionedEvent[] {
  const startMin = startHour * 60;
  // 時刻あり予定だけを開始順に。
  const timed = events
    .filter((ev) => !ev.allDay && minutesOfDay(ev.start) !== null)
    .map((ev) => {
      const s = minutesOfDay(ev.start) ?? 0;
      // 終了が無い/開始以下のときは 30 分の最小高さを与える。
      const eRaw = minutesOfDay(ev.end);
      const e = eRaw !== null && eRaw > s ? eRaw : s + 30;
      return { ev, s, e };
    })
    .sort((a, b) => a.s - b.s || a.e - b.e);

  // 簡易な重なりレイアウト: 時間が重なる連続グループ単位で列に振り分ける。
  const positioned: PositionedEvent[] = [];
  let i = 0;
  while (i < timed.length) {
    // グループ（連結した重なりの塊）を集める。
    const group = [timed[i]];
    let groupEnd = timed[i].e;
    let j = i + 1;
    while (j < timed.length && timed[j].s < groupEnd) {
      group.push(timed[j]);
      groupEnd = Math.max(groupEnd, timed[j].e);
      j++;
    }
    // グループ内で列を貪欲に割り当てる（各列の最終終了時刻を追う）。
    const colEnds: number[] = [];
    const colOf = new Map<number, number>();
    group.forEach((item, gi) => {
      let placed = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= item.s) {
          placed = c;
          break;
        }
      }
      if (placed === -1) {
        placed = colEnds.length;
        colEnds.push(item.e);
      } else {
        colEnds[placed] = item.e;
      }
      colOf.set(gi, placed);
    });
    const cols = colEnds.length;
    group.forEach((item, gi) => {
      positioned.push({
        ev: item.ev,
        topPx: ((item.s - startMin) / 60) * HOUR_PX,
        heightPx: Math.max(((item.e - item.s) / 60) * HOUR_PX, 14),
        col: colOf.get(gi) ?? 0,
        cols,
      });
    });
    i = j;
  }
  return positioned;
}

// ─── プランブロックの座標変換（既存の時刻→座標ロジックを踏襲）─────
/** ISO(RFC3339) の JST 'HH:MM' 表示。 */
function isoHmLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** プランブロックの所属日（ローカル YYYY-MM-DD）。 */
function planBlockDateIso(b: PlanBlock): string {
  return eventDateIso(b.start, false);
}

/** ロック集合のキー（account + taskId）。同一タスクのロック状態を一意に識別。 */
function blockKey(account: string, taskId: string): string {
  return `${account}|${taskId}`;
}

/** 日(YYYY-MM-DD) → プランブロック配列 の索引を作る。 */
function groupPlanByDay(blocks: PlanBlock[]): Map<string, PlanBlock[]> {
  const m = new Map<string, PlanBlock[]>();
  for (const b of blocks) {
    const iso = planBlockDateIso(b);
    if (!iso) continue;
    const arr = m.get(iso) ?? [];
    arr.push(b);
    m.set(iso, arr);
  }
  return m;
}

interface PositionedBlock {
  block: PlanBlock;
  topPx: number;
  heightPx: number;
}

/**
 * 1 日分のプランブロックを縦位置・高さへ割り付ける。
 * 座標変換は既存予定（layoutTimedEvents）と同一の式を用いる。
 * プランは実予定と重ねて専用レーンに描くため、横方向の重なり列計算は行わない。
 */
function layoutPlanBlocks(blocks: PlanBlock[], startHour: number): PositionedBlock[] {
  const startMin = startHour * 60;
  return blocks
    .map((block) => {
      const s = minutesOfDay(block.start) ?? 0;
      const eRaw = minutesOfDay(block.end);
      const e = eRaw !== null && eRaw > s ? eRaw : s + 30;
      return {
        block,
        topPx: ((s - startMin) / 60) * HOUR_PX,
        heightPx: Math.max(((e - s) / 60) * HOUR_PX, 14),
        s,
      };
    })
    .sort((a, b) => a.s - b.s)
    .map(({ block, topPx, heightPx }) => ({ block, topPx, heightPx }));
}

/** 現在時刻ラインの top(px)。表示範囲外なら null。 */
function nowLineTop(now: Date, startHour: number, endHour: number): number | null {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < startHour * 60 || mins > endHour * 60) return null;
  return ((mins - startHour * 60) / 60) * HOUR_PX;
}

// ─── 終日帯（週/日ビュー共通）──────────────────────────────
function AllDayBand({
  days,
  eventsByDayAllDay,
  tasksByDate,
  accountColors,
}: {
  days: string[];
  eventsByDayAllDay: Map<string, GoogleCalendarEvent[]>;
  tasksByDate: Map<string, GoogleTask[]>;
  accountColors: Map<string, string>;
}) {
  const hasAny = days.some(
    (d) => (eventsByDayAllDay.get(d)?.length ?? 0) + (tasksByDate.get(d)?.length ?? 0) > 0,
  );
  return (
    <div className="flex border-b border-border">
      <div className="w-12 shrink-0 border-r border-border py-1 pr-1 text-right text-[10px] text-text-faint">
        終日
      </div>
      <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const allDayEvents = eventsByDayAllDay.get(d) ?? [];
          const dayTasks = tasksByDate.get(d) ?? [];
          return (
            <div key={d} className="min-h-[1.75rem] border-l border-border/60 p-0.5">
              {allDayEvents.map((ev) => (
                <span
                  key={ev.id}
                  title={`${ev.title}（${ev.account}）`}
                  className="mb-0.5 flex items-center gap-1 overflow-hidden rounded-sm bg-surface-2 px-1 py-0.5 text-[9px] leading-tight text-text-muted"
                >
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: accountColors.get(ev.account) ?? 'var(--mc-idle)' }}
                  />
                  <span className="truncate">{ev.title}</span>
                </span>
              ))}
              {dayTasks.map((t) => {
                const done = t.status === 'completed';
                return (
                  <span
                    key={t.id}
                    title={`ToDo: ${t.title}（${t.account}）`}
                    className="mb-0.5 flex items-center gap-1 overflow-hidden rounded-sm border border-border bg-bg px-1 py-0.5 text-[9px] leading-tight text-text-muted"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-[1px]"
                      style={{ background: accountColors.get(t.account) ?? 'var(--mc-idle)' }}
                    />
                    <span className={`truncate ${done ? 'line-through opacity-60' : ''}`}>{t.title}</span>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      {!hasAny && (
        <span className="sr-only">終日の予定・ToDoはありません</span>
      )}
    </div>
  );
}

// ─── 時間軸の目盛り列 ───────────────────────────────────────
function HourAxis({ startHour, endHour }: { startHour: number; endHour: number }) {
  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);
  return (
    <div className="w-12 shrink-0 border-r border-border">
      {hours.map((h) => (
        <div
          key={h}
          className="relative text-right text-[10px] text-text-faint"
          style={{ height: h === endHour ? 0 : HOUR_PX }}
        >
          <span className="absolute right-1 -top-1.5">{String(h).padStart(2, '0')}:00</span>
        </div>
      ))}
    </div>
  );
}

// ─── 1日分の時間カラム（予定を絶対配置）─────────────────────
function DayColumn({
  dayEvents,
  dayPlanBlocks,
  startHour,
  endHour,
  accountColors,
  showNowLine,
  now,
  lockedKeys,
  lockBusy,
  onToggleLock,
}: {
  dayEvents: GoogleCalendarEvent[];
  dayPlanBlocks: PlanBlock[];
  startHour: number;
  endHour: number;
  accountColors: Map<string, string>;
  showNowLine: boolean;
  now: Date;
  lockedKeys: Set<string>;
  lockBusy: boolean;
  onToggleLock: (block: PlanBlock) => void;
}) {
  const positioned = useMemo(() => layoutTimedEvents(dayEvents, startHour), [dayEvents, startHour]);
  const positionedPlan = useMemo(
    () => layoutPlanBlocks(dayPlanBlocks, startHour),
    [dayPlanBlocks, startHour],
  );
  const totalPx = (endHour - startHour) * HOUR_PX;
  const nowTop = showNowLine ? nowLineTop(now, startHour, endHour) : null;

  return (
    <div className="relative border-l border-border/60" style={{ height: totalPx }}>
      {/* 時間の罫線 */}
      {Array.from({ length: endHour - startHour }).map((_, k) => (
        <div
          key={k}
          className="absolute inset-x-0 border-t border-border/40"
          style={{ top: k * HOUR_PX }}
        />
      ))}

      {/* 現在時刻ライン */}
      {nowTop !== null && (
        <div className="absolute inset-x-0 z-10" style={{ top: nowTop }} aria-hidden>
          <div className="h-px bg-accent" />
          <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-accent" />
        </div>
      )}

      {/* 予定ブロック */}
      {positioned.map((p) => {
        const widthPct = 100 / p.cols;
        const color = accountColors.get(p.ev.account) ?? 'var(--mc-idle)';
        return (
          <div
            key={p.ev.id}
            title={`${eventTimeLabel(p.ev)} ${p.ev.title}（${p.ev.account}）`}
            className="absolute overflow-hidden rounded-sm border-l-2 bg-surface-2 px-1 py-0.5 text-[9px] leading-tight text-text"
            style={{
              top: p.topPx,
              height: p.heightPx,
              left: `calc(${p.col * widthPct}% + 1px)`,
              width: `calc(${widthPct}% - 2px)`,
              borderLeftColor: color,
            }}
          >
            <span className="block truncate font-medium">{p.ev.title}</span>
            <span className="block truncate text-text-muted">{eventTimeLabel(p.ev)}</span>
          </div>
        );
      })}

      {/* プランブロック（提示のみ・右側レーンに重ねる）。
          focus（集中時間／習慣枠）はタスクと別スタイル（violet 実線・ロックなし）で描く。 */}
      {positionedPlan.map((p) => {
        const focus = isFocusBlock(p.block);
        const blockStyle = {
          top: p.topPx,
          height: p.heightPx,
          left: 'calc(50% + 1px)',
          width: 'calc(50% - 2px)',
        };
        if (focus) {
          return (
            <div
              key={`focus-${p.block.taskId}-${p.block.start}`}
              title={`集中: ${isoHmLabel(p.block.start)}〜${isoHmLabel(p.block.end)} ${p.block.title}（${p.block.estMinutes}分）\n${p.block.reason}`}
              className="absolute z-20 overflow-hidden rounded-sm border border-solid px-1 py-0.5 text-[9px] leading-tight backdrop-blur-[1px]"
              style={{
                ...blockStyle,
                borderColor: 'var(--mc-review)',
                background: 'color-mix(in srgb, var(--mc-review) 18%, transparent)',
                color: 'var(--mc-review)',
              }}
            >
              <span className="block truncate font-semibold">集中</span>
              <span className="block truncate font-medium text-text">{p.block.title}</span>
              <span className="block truncate text-text-muted">
                {isoHmLabel(p.block.start)}〜{isoHmLabel(p.block.end)}
              </span>
            </div>
          );
        }
        const locked = lockedKeys.has(blockKey(p.block.account, p.block.taskId));
        return (
          <div
            key={`plan-${p.block.account}-${p.block.taskId}-${p.block.start}`}
            title={
              `プラン: ${isoHmLabel(p.block.start)}〜${isoHmLabel(p.block.end)} ${p.block.title}（${p.block.estMinutes}分）\n理由: ${p.block.reason}` +
              (locked ? '\n🔒 ロック中（再プランで動かしません）' : '')
            }
            className={`absolute z-20 overflow-hidden rounded-sm border bg-accent/15 px-1 py-0.5 text-[9px] leading-tight text-text backdrop-blur-[1px] ${
              locked ? 'border-solid border-accent ring-1 ring-accent/60' : 'border-dashed border-accent'
            }`}
            style={blockStyle}
          >
            <span className="flex items-center justify-between gap-0.5">
              <span className="truncate font-semibold text-accent">プラン</span>
              <button
                type="button"
                onClick={() => onToggleLock(p.block)}
                disabled={lockBusy}
                aria-pressed={locked}
                title={
                  locked
                    ? 'ロック中：再プランで動かしません（クリックで解除）'
                    : 'ロックすると再プランで動かしません（位置を固定）'
                }
                className={`shrink-0 leading-none transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${
                  locked ? 'opacity-100' : 'opacity-50 hover:opacity-100'
                }`}
              >
                {locked ? '🔒' : '🔓'}
              </button>
            </span>
            <span className="block truncate font-medium">{p.block.title}</span>
            <span className="block truncate text-text-muted">
              {isoHmLabel(p.block.start)}〜{isoHmLabel(p.block.end)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── 週ビュー ───────────────────────────────────────────────
function WeekView({
  anchor,
  today,
  now,
  events,
  planBlocks,
  tasksByDate,
  accountColors,
  onSelectDay,
  lockedKeys,
  lockBusy,
  onToggleLock,
}: {
  anchor: string;
  today: string;
  now: Date;
  events: GoogleCalendarEvent[];
  planBlocks: PlanBlock[];
  tasksByDate: Map<string, GoogleTask[]>;
  accountColors: Map<string, string>;
  onSelectDay: (iso: string) => void;
  lockedKeys: Set<string>;
  lockBusy: boolean;
  onToggleLock: (block: PlanBlock) => void;
}) {
  const weekStart = startOfWeekIso(anchor);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)),
    [weekStart],
  );

  // 日 → 終日予定 / 時刻あり予定 の索引。
  const { allDayByDay, timedByDay } = useMemo(() => {
    const allDay = new Map<string, GoogleCalendarEvent[]>();
    const timed = new Map<string, GoogleCalendarEvent[]>();
    for (const ev of events) {
      const iso = eventDateIso(ev.start, ev.allDay);
      if (!iso) continue;
      const target = ev.allDay || !ev.start?.includes('T') ? allDay : timed;
      const arr = target.get(iso) ?? [];
      arr.push(ev);
      target.set(iso, arr);
    }
    return { allDayByDay: allDay, timedByDay: timed };
  }, [events]);

  // 日 → プランブロック の索引。
  const planByDay = useMemo(() => groupPlanByDay(planBlocks), [planBlocks]);

  const { startHour, endHour } = useMemo(
    () => computeHourRange(events, planBlocks),
    [events, planBlocks],
  );

  return (
    <section className="overflow-x-auto rounded-lg border border-border bg-surface">
      <div className="min-w-[44rem]">
        {/* 曜日ヘッダ */}
        <div className="flex border-b border-border">
          <div className="w-12 shrink-0 border-r border-border" />
          <div className="grid flex-1" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
            {days.map((d) => {
              const { d: dd } = partsOf(d);
              const wd = weekdayOf(d);
              const isToday = d === today;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onSelectDay(d)}
                  className={`border-l border-border/60 py-1.5 text-center transition-colors hover:bg-surface-2 ${
                    isToday ? 'bg-accent/10' : ''
                  }`}
                >
                  <span
                    className={`block text-[10px] font-semibold ${
                      wd === 0 ? 'text-blocked' : wd === 6 ? 'text-accent' : 'text-text-muted'
                    }`}
                  >
                    {WEEKDAY_NAMES[wd]}
                  </span>
                  <span className={`block text-sm font-bold ${isToday ? 'text-accent' : 'text-text'}`}>{dd}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 終日帯 */}
        <AllDayBand
          days={days}
          eventsByDayAllDay={allDayByDay}
          tasksByDate={tasksByDate}
          accountColors={accountColors}
        />

        {/* 時間グリッド */}
        <div className="flex">
          <HourAxis startHour={startHour} endHour={endHour} />
          <div className="grid flex-1" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
            {days.map((d) => (
              <DayColumn
                key={d}
                dayEvents={timedByDay.get(d) ?? []}
                dayPlanBlocks={planByDay.get(d) ?? []}
                startHour={startHour}
                endHour={endHour}
                accountColors={accountColors}
                showNowLine={d === today}
                now={now}
                lockedKeys={lockedKeys}
                lockBusy={lockBusy}
                onToggleLock={onToggleLock}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 日ビュー（週ビューの1日版）─────────────────────────────
function DayView({
  anchor,
  today,
  now,
  events,
  planBlocks,
  tasksByDate,
  accountColors,
  lockedKeys,
  lockBusy,
  onToggleLock,
}: {
  anchor: string;
  today: string;
  now: Date;
  events: GoogleCalendarEvent[];
  planBlocks: PlanBlock[];
  tasksByDate: Map<string, GoogleTask[]>;
  accountColors: Map<string, string>;
  lockedKeys: Set<string>;
  lockBusy: boolean;
  onToggleLock: (block: PlanBlock) => void;
}) {
  const days = useMemo(() => [anchor], [anchor]);

  const { allDayByDay, timed } = useMemo(() => {
    const allDay = new Map<string, GoogleCalendarEvent[]>();
    const timedArr: GoogleCalendarEvent[] = [];
    for (const ev of events) {
      const iso = eventDateIso(ev.start, ev.allDay);
      if (iso !== anchor) continue;
      if (ev.allDay || !ev.start?.includes('T')) {
        const arr = allDay.get(iso) ?? [];
        arr.push(ev);
        allDay.set(iso, arr);
      } else {
        timedArr.push(ev);
      }
    }
    return { allDayByDay: allDay, timed: timedArr };
  }, [events, anchor]);

  const dayPlanBlocks = useMemo(
    () => planBlocks.filter((b) => planBlockDateIso(b) === anchor),
    [planBlocks, anchor],
  );

  const { startHour, endHour } = useMemo(
    () => computeHourRange(events, planBlocks),
    [events, planBlocks],
  );

  return (
    <section className="overflow-x-auto rounded-lg border border-border bg-surface">
      <div className="min-w-[20rem]">
        {/* 終日帯（1列） */}
        <AllDayBand
          days={days}
          eventsByDayAllDay={allDayByDay}
          tasksByDate={tasksByDate}
          accountColors={accountColors}
        />

        {/* 時間グリッド（1列） */}
        <div className="flex">
          <HourAxis startHour={startHour} endHour={endHour} />
          <div className="grid flex-1" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <DayColumn
              dayEvents={timed}
              dayPlanBlocks={dayPlanBlocks}
              startHour={startHour}
              endHour={endHour}
              accountColors={accountColors}
              showNowLine={anchor === today}
              now={now}
              lockedKeys={lockedKeys}
              lockBusy={lockBusy}
              onToggleLock={onToggleLock}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
