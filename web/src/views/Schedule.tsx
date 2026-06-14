// スケジュールページ（/schedule, MC-245 P1 設計）。
// Google カレンダーの予定・ToDo を「月／週／日」の3ビューで読み取り表示する。
// オートプランナー（自動スケジューリング）は後続フェーズ MC-248 で別途。ここはビューの土台のみ。
// データ取得・型・アカウント識別色は BabyDiary の流儀を踏襲（BabyDiary 自体は編集しない）。
// 日付計算は自前（date-fns 等の新規依存は足さない）。JST 前提で 'YYYY-MM-DD' 文字列演算を使う。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ResourceState } from '../components/ui';
import { ChevronLeftIcon, ChevronRightIcon, LinkIcon } from '../components/icons';

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
                  tasksByDate={tasksByDate}
                  accountColors={accountColors}
                  onSelectDay={openDay}
                />
              )}
              {mode === 'day' && (
                <DayView
                  anchor={anchor}
                  today={today}
                  now={now}
                  events={events}
                  tasksByDate={tasksByDate}
                  accountColors={accountColors}
                />
              )}
            </ResourceState>
          )}
        </div>
      </div>
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
  accountColors,
  onSelectDay,
}: {
  anchor: string;
  today: string;
  eventsByDate: Map<string, GoogleCalendarEvent[]>;
  tasksByDate: Map<string, GoogleTask[]>;
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
/** 表示日群の時刻あり予定から、表示すべき時間範囲 [startHour, endHour] を決める。 */
function computeHourRange(events: GoogleCalendarEvent[]): { startHour: number; endHour: number } {
  let minH = DEFAULT_START_HOUR;
  let maxH = DEFAULT_END_HOUR;
  for (const ev of events) {
    if (ev.allDay) continue;
    const s = minutesOfDay(ev.start);
    const e = minutesOfDay(ev.end);
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
  startHour,
  endHour,
  accountColors,
  showNowLine,
  now,
}: {
  dayEvents: GoogleCalendarEvent[];
  startHour: number;
  endHour: number;
  accountColors: Map<string, string>;
  showNowLine: boolean;
  now: Date;
}) {
  const positioned = useMemo(() => layoutTimedEvents(dayEvents, startHour), [dayEvents, startHour]);
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
    </div>
  );
}

// ─── 週ビュー ───────────────────────────────────────────────
function WeekView({
  anchor,
  today,
  now,
  events,
  tasksByDate,
  accountColors,
  onSelectDay,
}: {
  anchor: string;
  today: string;
  now: Date;
  events: GoogleCalendarEvent[];
  tasksByDate: Map<string, GoogleTask[]>;
  accountColors: Map<string, string>;
  onSelectDay: (iso: string) => void;
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

  const { startHour, endHour } = useMemo(() => computeHourRange(events), [events]);

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
                startHour={startHour}
                endHour={endHour}
                accountColors={accountColors}
                showNowLine={d === today}
                now={now}
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
  tasksByDate,
  accountColors,
}: {
  anchor: string;
  today: string;
  now: Date;
  events: GoogleCalendarEvent[];
  tasksByDate: Map<string, GoogleTask[]>;
  accountColors: Map<string, string>;
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

  const { startHour, endHour } = useMemo(() => computeHourRange(events), [events]);

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
              startHour={startHour}
              endHour={endHour}
              accountColors={accountColors}
              showNowLine={anchor === today}
              now={now}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
