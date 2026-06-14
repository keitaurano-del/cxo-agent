// 成長日記ページ（/baby-diary, MC-233 Phase1）。
// 月カレンダー（自作グリッド）＋その日の詳細（やること・日記フォーム・写真/動画）＋
// 成長グラフ（自作SVG）を、サーバ API（同一オリジン・Cookie 認証）に対して描画する。
// カレンダー・グラフは外部ライブラリを足さず React/SVG で自作する（依存を増やさない）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ResourceState } from '../components/ui';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  UploadIcon,
  TrashIcon,
  ImageFileIcon,
  VideoFileIcon,
  LinkIcon,
  PlusIcon,
  CloseIcon,
  SettingsIcon,
} from '../components/icons';
import {
  BIRTH_DATE,
  daysSinceBirth,
  weeksAndDays,
  formatJpDate,
  parseIsoDate,
  todayIso,
  ADMIN_PROCEDURES,
  CHECKUP_ITEMS,
} from './childcareData';

// ─── API 型（サーバ契約に対応）──────────────────────────────
interface DiaryEntry {
  date: string; // YYYY-MM-DD
  memo?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface MediaMeta {
  id: string;
  date: string; // YYYY-MM-DD
  filename: string;
  originalName: string;
  mime: string;
  kind: 'image' | 'video';
  size: number;
  createdAt: string;
}

interface DiaryResponse {
  generatedAt: string;
  entries: DiaryEntry[];
  media: MediaMeta[];
}

// ─── Google 連携 API 型（MC-233 Phase2/3 サーバ契約に対応）─────────
interface GoogleAccount {
  email: string;
  connectedAt?: string;
  scope?: string;
}

interface GoogleStatus {
  configured: boolean;
  accounts: GoogleAccount[];
}

// ─── Google Drive 自動取り込み API 型（サーバ契約に対応）─────────
interface DriveAccountStatus {
  account: string;
  configured: boolean; // 監視フォルダ設定済み
  folderName?: string;
  autoImport: boolean;
  lastImportAt?: string;
  driveScopeGranted: boolean;
}

interface DriveStatusResponse {
  accounts: DriveAccountStatus[];
}

interface DriveFolder {
  id: string;
  name: string;
}

// Google カレンダーの予定。start/end は Google 形式（{date} か {dateTime}）。
interface GoogleEventTime {
  date?: string; // YYYY-MM-DD（終日）
  dateTime?: string; // RFC3339
}

interface GoogleCalendarEvent {
  id: string;
  account: string;
  title: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  allDay: boolean;
  htmlLink?: string;
}

interface CalendarEventsResponse {
  events: GoogleCalendarEvent[];
  errors?: unknown[];
}

// Google ToDo（Google Tasks）。due は 'YYYY-MM-DD'（カレンダーセルへの割り当てに使う）。
// due は任意＝期日なしのタスクは due 無しで来る（カレンダーには置かず、別枠で表示する）。
interface GoogleTask {
  id: string;
  account: string; // email
  title: string;
  due?: string; // YYYY-MM-DD（期日なしは未設定）
  status: string; // 'needsAction' | 'completed' 等（未完了のみ来る想定）
  listTitle: string;
  notes?: string;
}

interface TasksError {
  account: string;
  error: string;
}

interface TasksResponse {
  tasks: GoogleTask[];
  errors?: TasksError[];
}

// ─── ToDo（締切）ソース: 行政手続き＋健診を {id,title,dueIso} に正規化 ──
interface DueTodo {
  id: string;
  title: string;
  dueIso: string;
  kind: 'admin' | 'checkup';
}

const DUE_TODOS: DueTodo[] = [
  ...ADMIN_PROCEDURES.map((p) => ({ id: p.id, title: p.title, dueIso: p.dueIso, kind: 'admin' as const })),
  ...CHECKUP_ITEMS.map((c) => ({ id: c.id, title: c.title, dueIso: c.dueIso, kind: 'checkup' as const })),
];

/** 指定 ISO 日付が締切の ToDo を返す。 */
function todosForDate(iso: string): DueTodo[] {
  return DUE_TODOS.filter((t) => t.dueIso === iso);
}

// ─── 日付ユーティリティ（JST 基準の YYYY-MM-DD を文字列演算で扱う）──
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/** その月の日数。month は 0-11。 */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** year-month-day を 'YYYY-MM-DD' へ（month は 0-11）。 */
function toIso(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/** その月 1 日の曜日（0=日）。 */
function firstWeekday(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

/** ある ISO 日付の生後日数（誕生日=1日目）。 */
function diaryDaysSince(iso: string): number {
  return daysSinceBirth(parseIsoDate(iso));
}

const BIRTH_MMDD = BIRTH_DATE.slice(5); // 'MM-DD'

// ─── アカウント識別色（接続順に循環する CSS 変数トークン）──────────
// 複数アカウントを重ねて表示しても見分けられるよう、接続済みアカウントの
// 並び順に応じて識別色を割り当てる（凡例代わりの色ドット／左ボーダーに使う）。
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

// ─── メディア URL ───────────────────────────────────────────
function mediaUrl(id: string): string {
  return `/api/baby-diary/media/${id}`;
}

/** サムネ URL（サーバ側で 480px webp を生成・キャッシュ）。一覧/グリッドの軽量表示用。 */
function thumbUrl(id: string): string {
  return `/api/baby-diary/media/${id}?thumb=1`;
}

// ─── Google 連携ユーティリティ ──────────────────────────────
/** Google イベント start の表示用ローカル YYYY-MM-DD（カレンダーセルへの割り当て用）。 */
function eventDateIso(t: GoogleEventTime): string {
  if (t.date) return t.date; // 終日
  if (t.dateTime) {
    const d = new Date(t.dateTime);
    // JST 表示（ブラウザロケール依存を避け、ローカル日付の YYYY-MM-DD を組む）。
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

/** 時刻なし終日 or 'HH:MM' の短い表示文字列。 */
function eventTimeLabel(ev: GoogleCalendarEvent): string {
  if (ev.allDay || ev.start.date) return '終日';
  if (ev.start.dateTime) {
    const d = new Date(ev.start.dateTime);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return '';
}

/** 表示中の月の [timeMin, timeMax)（ローカル境界の ISO 文字列）。 */
function monthRangeIso(year: number, month: number): { timeMin: string; timeMax: string } {
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

// ─── 軽量トースト（自己完結・3秒で自動消去）──────────────────
type ToastKind = 'success' | 'error';
interface ToastMsg {
  id: number;
  kind: ToastKind;
  text: string;
}

function useToasts() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const idRef = useRef(0);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastMsg[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-20 right-4 z-50 flex w-72 flex-col gap-2 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 shadow-lg"
        >
          <p
            className="min-w-0 flex-1 text-xs font-medium"
            style={{ color: t.kind === 'error' ? 'var(--mc-stalled)' : 'var(--mc-active)' }}
          >
            {t.text}
          </p>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="閉じる"
            className="shrink-0 rounded p-0.5 text-text-faint hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── ルート ─────────────────────────────────────────────────
// embedded=true のとき: 育児ページのタブシェル配下に流す前提で、
// 自前の PageHeader と最外の flex/overflow ラッパを描かず、中身（max-w コンテナ）だけを返す。
export default function BabyDiary({ embedded = false }: { embedded?: boolean } = {}) {
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => todayIso(now), [now]);

  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const [data, setData] = useState<DiaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 表示中の月（年・月 0-11）。既定は今日を含む月。
  const [view, setView] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y, month: m - 1 };
  });
  // 選択中の日（詳細パネル対象）。既定は今日。
  const [selected, setSelected] = useState<string>(today);

  // 設定モーダル（Google連携・Drive取り込みをまとめて格納）の開閉。
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Google 連携状態 ──
  const [gstatus, setGstatus] = useState<GoogleStatus | null>(null);
  // カレンダーに重ねて表示する対象アカウントの集合（既定＝接続済み全アカウント）。
  // 「閲覧は複数重ね」を担う。取り込み/書き出しの対象は別途 importTarget で1つ指定する。
  const [visibleAccounts, setVisibleAccounts] = useState<Set<string>>(new Set());
  // 取り込み(Picter)/ToDo書き出しの対象アカウント（visible の中の1つ。未指定なら先頭）。
  const [importTarget, setImportTarget] = useState<string | null>(null);

  const accounts = gstatus?.accounts ?? [];
  const hasAccounts = accounts.length > 0;

  // 接続済みアカウント → 識別色。並び順で循環。
  const accountColors = useMemo(
    () => buildAccountColors(accounts.map((a) => a.email)),
    [accounts],
  );

  // status 取得後、接続アカウントを visible に同期する。
  // 既存の選択は維持しつつ、新規接続が増えたら自動で visible に含める
  // （切断されたアカウントは visible から取り除く）。
  const knownAccountsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(accounts.map((a) => a.email));
    const known = knownAccountsRef.current;
    setVisibleAccounts((prev) => {
      const next = new Set<string>();
      for (const email of current) {
        // 既知アカウントは従来の表示状態を尊重。新規は自動で visible に含める。
        if (!known.has(email) || prev.has(email)) next.add(email);
      }
      return next;
    });
    knownAccountsRef.current = current;
  }, [accounts]);

  // visible の集合に含まれる接続済みアカウントのメール一覧（接続順）。
  const visibleEmails = useMemo(
    () => accounts.map((a) => a.email).filter((e) => visibleAccounts.has(e)),
    [accounts, visibleAccounts],
  );

  // 取り込み/書き出しの実効対象（指定が未設定/非visibleなら先頭の visible にフォールバック）。
  const activeImportAccount = useMemo(() => {
    if (importTarget && visibleEmails.includes(importTarget)) return importTarget;
    return visibleEmails[0] ?? null;
  }, [importTarget, visibleEmails]);

  const toggleVisibleAccount = useCallback((email: string) => {
    setVisibleAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }, []);

  const fetchGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/google/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GoogleStatus;
      setGstatus(json);
    } catch {
      // 取得失敗時は未設定扱い（Phase1 を壊さない）。
      setGstatus({ configured: false, accounts: [] });
    }
  }, []);

  useEffect(() => {
    void fetchGoogleStatus();
  }, [fetchGoogleStatus]);

  // OAuth 戻り（?google=connected|error）の検出 → トースト → クエリ除去 → status 再取得。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (g !== 'connected' && g !== 'error') return;
    if (g === 'connected') pushToast('success', 'Googleアカウントを接続しました');
    else pushToast('error', 'Google接続に失敗しました。もう一度お試しください。');
    params.delete('google');
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', url);
    void fetchGoogleStatus();
  }, [pushToast, fetchGoogleStatus]);

  // ── 表示中の月の Google 予定（接続済みアカウントがあるときのみ）──
  const [gEvents, setGEvents] = useState<GoogleCalendarEvent[]>([]);

  useEffect(() => {
    if (!hasAccounts) {
      setGEvents([]);
      return;
    }
    let cancelled = false;
    const { timeMin, timeMax } = monthRangeIso(view.year, view.month);
    (async () => {
      try {
        const res = await fetch(
          `/api/google/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        );
        if (!res.ok) {
          if (!cancelled) setGEvents([]);
          return;
        }
        const json = (await res.json()) as CalendarEventsResponse;
        if (!cancelled) setGEvents(json.events ?? []);
      } catch {
        if (!cancelled) setGEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasAccounts, view.year, view.month]);

  // date → Google 予定配列 の索引。チェック中(visible)のアカウントの予定のみを重ねる。
  const eventsByDate = useMemo(() => {
    const m = new Map<string, GoogleCalendarEvent[]>();
    for (const ev of gEvents) {
      if (!visibleAccounts.has(ev.account)) continue;
      const iso = eventDateIso(ev.start);
      if (!iso) continue;
      const arr = m.get(iso) ?? [];
      arr.push(ev);
      m.set(iso, arr);
    }
    return m;
  }, [gEvents, visibleAccounts]);

  // ── 表示中の月の Google タスク（接続済みアカウントがあるときのみ）──
  // events と同じ流儀で取得。errors（tasks-not-authorized 等）も保持し、未許可ヒントに使う。
  const [gTasks, setGTasks] = useState<GoogleTask[]>([]);
  const [taskErrors, setTaskErrors] = useState<TasksError[]>([]);

  useEffect(() => {
    if (!hasAccounts) {
      setGTasks([]);
      setTaskErrors([]);
      return;
    }
    let cancelled = false;
    const { timeMin, timeMax } = monthRangeIso(view.year, view.month);
    (async () => {
      try {
        const res = await fetch(
          `/api/google/tasks?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        );
        if (!res.ok) {
          if (!cancelled) {
            setGTasks([]);
            setTaskErrors([]);
          }
          return;
        }
        const json = (await res.json()) as TasksResponse;
        if (!cancelled) {
          setGTasks(json.tasks ?? []);
          setTaskErrors(json.errors ?? []);
        }
      } catch {
        if (!cancelled) {
          setGTasks([]);
          setTaskErrors([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasAccounts, view.year, view.month]);

  // due(YYYY-MM-DD) → Google タスク配列 の索引。チェック中(visible)のアカウントのみ。
  const tasksByDate = useMemo(() => {
    const m = new Map<string, GoogleTask[]>();
    for (const t of gTasks) {
      if (!visibleAccounts.has(t.account)) continue;
      if (!t.due) continue;
      const arr = m.get(t.due) ?? [];
      arr.push(t);
      m.set(t.due, arr);
    }
    return m;
  }, [gTasks, visibleAccounts]);

  // 期日なしの Google タスク（visible アカウントのみ・タイトル昇順）。日付に紐づかないので別枠で表示する。
  const noDueTasks = useMemo(
    () =>
      gTasks
        .filter((t) => visibleAccounts.has(t.account) && !t.due)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [gTasks, visibleAccounts],
  );

  // tasks の権限が一つも無いか（errors が全て tasks-not-authorized）。再接続ヒント用。
  // 接続アカウントが1件以上あり、全アカウントが tasks-not-authorized を返した場合のみ true。
  const tasksNeedReconnect = useMemo(() => {
    if (!hasAccounts) return false;
    const notAuthed = taskErrors.filter((e) => e.error === 'tasks-not-authorized');
    if (notAuthed.length === 0) return false;
    // 許可済みアカが1つでもあれば（タスクが来ている or 別エラー）ヒントは出さない。
    const authedAccounts = new Set(gTasks.map((t) => t.account));
    return accounts.every(
      (a) =>
        !authedAccounts.has(a.email) &&
        notAuthed.some((e) => e.account === a.email),
    );
  }, [hasAccounts, taskErrors, gTasks, accounts]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/baby-diary');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DiaryResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // date → エントリ / メディア配列 の索引。
  const entryByDate = useMemo(() => {
    const m = new Map<string, DiaryEntry>();
    for (const e of data?.entries ?? []) m.set(e.date, e);
    return m;
  }, [data]);

  const mediaByDate = useMemo(() => {
    const m = new Map<string, MediaMeta[]>();
    for (const md of data?.media ?? []) {
      const arr = m.get(md.date) ?? [];
      arr.push(md);
      m.set(md.date, arr);
    }
    return m;
  }, [data]);

  const goPrevMonth = () =>
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 }));
  const goNextMonth = () =>
    setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 }));
  const goToday = () => {
    const [y, m] = today.split('-').map(Number);
    setView({ year: y, month: m - 1 });
    setSelected(today);
  };

  // 中身（max-w コンテナ）。embedded/通常 どちらでも共通で使う。
  const inner = (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <DiaryHeader now={now} onOpenSettings={() => setSettingsOpen(true)} />

      {/* Google Drive の自動取り込みは設定モーダルの開閉に依存せず常時動かす
          （接続アカウントがあるときだけマウントし、UI は描かない）。 */}
      {hasAccounts && <DriveAutoImport onImported={fetchData} />}

      {/* 設定モーダル: Google連携・Drive取り込みをまとめて格納。 */}
      <DiarySettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <GoogleConnectPanel
          status={gstatus}
          visibleAccounts={visibleAccounts}
          accountColors={accountColors}
          onToggleAccount={toggleVisibleAccount}
          onRefresh={fetchGoogleStatus}
          pushToast={pushToast}
        />

        {hasAccounts && (
          <GoogleDriveImportPanel
            accountColors={accountColors}
            onImported={fetchData}
            pushToast={pushToast}
          />
        )}
      </DiarySettingsModal>

      <ResourceState loading={loading} error={error} hasData={!!data}>
        {/* PC: 2カラム（カレンダー｜詳細）、モバイル: 1列（カレンダー → 詳細）。 */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CalendarSection
            view={view}
            today={today}
            selected={selected}
            entryByDate={entryByDate}
            mediaByDate={mediaByDate}
            eventsByDate={eventsByDate}
            tasksByDate={tasksByDate}
            accountColors={accountColors}
            onPrev={goPrevMonth}
            onNext={goNextMonth}
            onToday={goToday}
            onSelect={setSelected}
          />
          <DayDetailSection
            date={selected}
            entry={entryByDate.get(selected)}
            media={mediaByDate.get(selected) ?? []}
            googleEvents={eventsByDate.get(selected) ?? []}
            googleTasks={tasksByDate.get(selected) ?? []}
            noDueTasks={noDueTasks}
            tasksNeedReconnect={tasksNeedReconnect}
            accountColors={accountColors}
            visibleEmails={visibleEmails}
            importTarget={activeImportAccount}
            onSelectImportTarget={setImportTarget}
            accountsConnected={hasAccounts}
            onChanged={fetchData}
            pushToast={pushToast}
          />
        </div>
      </ResourceState>
    </div>
  );

  // 育児タブ配下（embedded）: 親シェルが PageHeader と overflow 領域を持つので中身だけ返す。
  // ToastStack は fixed なので並置してよい。
  if (embedded) {
    return (
      <>
        {inner}
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="成長日記"
        subtitle="毎日の記録・写真／動画・成長グラフをまとめます。手続きや健診の目安は育児タブをどうぞ。"
        fetchedAt={data?.generatedAt}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">{inner}</div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ─── ヘッダ（生後 N 日 ＋ 右上の設定ギア）─────────────────────
function DiaryHeader({ now, onOpenSettings }: { now: Date; onOpenSettings: () => void }) {
  const days = daysSinceBirth(now);
  const { weeks, days: remDays } = weeksAndDays(now);
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-2.5 md:px-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-base font-bold text-text md:text-lg">
            生後 <span className="text-accent">{days}</span> 日
          </p>
          <span className="text-[11px] text-text-faint">
            {weeks > 0 ? `${weeks}週${remDays}日` : `${remDays}日`}・{formatJpDate(BIRTH_DATE)} 誕生
          </span>
        </div>
        {/* 右上の設定ギア。Google連携・Drive取り込みをモーダルにまとめる入口。 */}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="成長日記の設定"
          title="成長日記の設定"
          className="-mr-1 shrink-0 rounded-md border border-border p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <SettingsIcon width={18} height={18} />
        </button>
      </div>
    </div>
  );
}

// ─── 設定モーダル（Google連携・Drive取り込みの格納先）──────────
// VaultAddSheet と同じ作法: fixed inset-0・半透明オーバーレイ・中央カード・
// 縦長は overflow-y-auto。オーバーレイクリック / Esc で閉じる。閉じている間は
// children を描画しない（連携パネルの fetch は開いたときだけ走る）。
function DiarySettingsModal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // open 中は Esc で閉じ、背景スクロールを止める。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-end justify-center md:items-center"
      style={{ zIndex: 55 }}
      role="dialog"
      aria-modal="true"
      aria-label="成長日記の設定"
    >
      <button type="button" aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl md:max-h-[85dvh] md:w-[34rem] md:rounded-2xl md:pb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-text">成長日記の設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Google Drive 自動取り込みランナー（UI なし・常時マウント）──
// 設定モーダルの開閉に依存せず、ページ表示時に1回だけ
// autoImport=true かつ configured かつ granted のアカウントを取り込む。
// 旧 GoogleDriveImportPanel 内にあった自動取り込みをここへ分離し、
// モーダルを開かなくても自動取り込みが効くようにする。
function DriveAutoImport({ onImported }: { onImported: () => Promise<void> | void }) {
  const autoRanRef = useRef(false);
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    let cancelled = false;
    (async () => {
      let status: DriveStatusResponse;
      try {
        const res = await fetch('/api/google/drive/status');
        if (!res.ok) return;
        status = (await res.json()) as DriveStatusResponse;
      } catch {
        return; // 自動取り込みは静かに失敗（手動取り込みで補える）。
      }
      if (cancelled) return;
      const targets = status.accounts.filter(
        (a) => a.autoImport && a.configured && a.driveScopeGranted,
      );
      if (targets.length === 0) return;
      let imported = false;
      for (const t of targets) {
        if (inFlightRef.current.has(t.account)) continue;
        inFlightRef.current.add(t.account);
        try {
          const res = await fetch('/api/google/drive/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account: t.account }),
          });
          if (res.ok) {
            const j = (await res.json()) as { imported: number };
            if ((j.imported ?? 0) > 0) imported = true;
          }
        } catch {
          /* 静かに失敗 */
        } finally {
          inFlightRef.current.delete(t.account);
        }
      }
      if (imported && !cancelled) await onImported();
    })();
    return () => {
      cancelled = true;
    };
  }, [onImported]);

  return null;
}

// ─── Google 連携パネル ───────────────────────────────────────
function GoogleConnectPanel({
  status,
  visibleAccounts,
  accountColors,
  onToggleAccount,
  onRefresh,
  pushToast,
}: {
  status: GoogleStatus | null;
  visibleAccounts: Set<string>;
  accountColors: Map<string, string>;
  onToggleAccount: (email: string) => void;
  onRefresh: () => Promise<void> | void;
  pushToast: (kind: ToastKind, text: string) => void;
}) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // status 取得前は静かに何も出さない（Phase1 を邪魔しない）。
  if (!status) return null;

  const accounts = status.accounts ?? [];

  const startConnect = () => {
    // fetch ではなくブラウザ遷移で OAuth を開始する。
    window.location.href = '/api/google/oauth/start';
  };

  const disconnect = async (email: string) => {
    setDisconnecting(email);
    try {
      const res = await fetch(`/api/google/accounts/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pushToast('success', `${email} を切断しました`);
      await onRefresh();
    } catch (err) {
      pushToast('error', `切断に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-text-muted">
          <LinkIcon width={16} height={16} />
        </span>
        <h2 className="text-base font-bold text-text">Google連携</h2>
      </div>

      {!status.configured ? (
        // 未設定: グレー表示・ボタン無効。
        <div className="rounded-md border border-dashed border-border bg-bg px-3 py-3">
          <p className="text-xs text-text-faint">
            Google連携は設定準備中です（管理者がクレデンシャル設定後に有効化されます）。
          </p>
          <button
            type="button"
            disabled
            className="mt-2 inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-faint opacity-60"
          >
            <LinkIcon width={14} height={14} />
            Googleアカウントを接続
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">
            カレンダーの予定表示・ToDoの書き出し・Google
            Photosからの写真取り込みに使います。チェックしたアカウントの予定をすべて重ねて表示します。
          </p>

          {/* 接続済みアカウント一覧（チェックボックスで複数選択＝重ね表示） */}
          {accounts.length > 0 && (
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => {
                const isVisible = visibleAccounts.has(a.email);
                const color = accountColors.get(a.email) ?? 'var(--mc-accent)';
                return (
                  <li
                    key={a.email}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
                      isVisible ? 'border-border bg-surface-2/60' : 'border-border bg-bg'
                    }`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => onToggleAccount(a.email)}
                        className="h-4 w-4 shrink-0 accent-accent"
                        title="カレンダーに重ねて表示する"
                      />
                      {/* 識別色ドット（凡例代わり） */}
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: color }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-text">{a.email}</span>
                        <span className="block text-[10px] text-text-faint">
                          接続済み{a.connectedAt ? `・接続日: ${a.connectedAt.slice(0, 10)}` : ''}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => void disconnect(a.email)}
                      disabled={disconnecting === a.email}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-surface-2 hover:text-blocked disabled:opacity-50"
                    >
                      {disconnecting === a.email ? '切断中…' : '切断'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={startConnect}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text"
            >
              <PlusIcon width={14} height={14} />
              {accounts.length > 0 ? 'アカウントを追加' : 'Googleアカウントを接続'}
            </button>
            {accounts.length > 0 && (
              <span className="text-[11px] text-text-faint">
                追加時は Google の画面で別アカウントを選べます。
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Google Drive 自動取り込みパネル ────────────────────────
// 接続済みアカウントごとに「監視フォルダ選択／自動取り込みトグル／保存／今すぐ取り込み」を提供する。
// Drive スコープ未許可のアカウントは再接続（再同意で Drive 許可）へ誘導する。
function GoogleDriveImportPanel({
  accountColors,
  onImported,
  pushToast,
}: {
  accountColors: Map<string, string>;
  onImported: () => Promise<void> | void;
  pushToast: (kind: ToastKind, text: string) => void;
}) {
  const [driveStatus, setDriveStatus] = useState<DriveStatusResponse | null>(null);

  // マウント時に Drive status を取得（接続アカウントがある前提でレンダされる）。
  const fetchDriveStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/google/drive/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DriveStatusResponse;
      setDriveStatus(json);
    } catch {
      // 取得失敗時は静かに非表示（既存機能を壊さない）。
      setDriveStatus({ accounts: [] });
    }
  }, []);

  useEffect(() => {
    void fetchDriveStatus();
  }, [fetchDriveStatus]);

  // 自動取り込みは DriveAutoImport（常時マウント・UIなし）が担う。
  // ここではモーダル内の設定 UI（フォルダ選択・トグル・手動取り込み）だけを描く。

  if (!driveStatus || driveStatus.accounts.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-text-muted">
          <UploadIcon width={16} height={16} />
        </span>
        <h2 className="text-base font-bold text-text">Google Drive 自動取り込み</h2>
      </div>
      <p className="mb-3 text-xs text-text-muted">
        指定した Google Drive のフォルダに入れた写真・動画を、撮影日の記録として自動で取り込みます。
      </p>

      <ul className="flex flex-col gap-2">
        {driveStatus.accounts.map((da) => (
          <DriveAccountRow
            key={da.account}
            status={da}
            color={accountColors.get(da.account) ?? 'var(--mc-accent)'}
            onChanged={fetchDriveStatus}
            onImported={onImported}
            pushToast={pushToast}
          />
        ))}
      </ul>
    </section>
  );
}

// Drive 取り込み設定の1アカウント行。
function DriveAccountRow({
  status,
  color,
  onChanged,
  onImported,
  pushToast,
}: {
  status: DriveAccountStatus;
  color: string;
  onChanged: () => Promise<void> | void;
  onImported: () => Promise<void> | void;
  pushToast: (kind: ToastKind, text: string) => void;
}) {
  // driveScopeGranted がローカルで false に落ちる場合（import が 403 を返したとき）に
  // 再接続誘導へ切り替えるためのローカルフラグ。
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const granted = status.driveScopeGranted && !needsReconnect;

  const [folders, setFolders] = useState<DriveFolder[] | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string>('');
  const [folderName, setFolderName] = useState<string>(status.folderName ?? '');
  const [autoImport, setAutoImport] = useState<boolean>(status.autoImport);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  // granted のときフォルダ一覧を取得し、現在の folderName を選択状態にする。
  useEffect(() => {
    if (!granted) return;
    let cancelled = false;
    (async () => {
      setFoldersError(null);
      try {
        const res = await fetch(
          `/api/google/drive/folders?account=${encodeURIComponent(status.account)}`,
        );
        if (res.status === 403) {
          if (!cancelled) setNeedsReconnect(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { folders: DriveFolder[] };
        if (cancelled) return;
        const list = json.folders ?? [];
        setFolders(list);
        // 現在設定中のフォルダ名に一致する id を初期選択にする。
        const cur = list.find((f) => f.name === status.folderName);
        if (cur) {
          setFolderId(cur.id);
          setFolderName(cur.name);
        }
      } catch (err) {
        if (!cancelled) setFoldersError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [granted, status.account, status.folderName]);

  const reconnect = () => {
    // 再同意で Drive スコープを付与するため OAuth を開始（ブラウザ遷移）。
    window.location.href = '/api/google/oauth/start';
  };

  const onSelectFolder = (id: string) => {
    setFolderId(id);
    const f = folders?.find((x) => x.id === id);
    setFolderName(f?.name ?? '');
  };

  const save = async () => {
    if (!folderId) {
      pushToast('error', '監視するフォルダを選択してください');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/google/drive/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: status.account, folderId, folderName, autoImport }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pushToast('success', `${status.account} の取り込み設定を保存しました`);
      await onChanged();
    } catch (err) {
      pushToast('error', `設定の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const importNow = async () => {
    setImporting(true);
    try {
      const res = await fetch('/api/google/drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: status.account }),
      });
      if (res.status === 403) {
        setNeedsReconnect(true);
        pushToast('error', '写真の自動取り込みには Google の再接続（Driveへのアクセス許可）が必要です');
        return;
      }
      if (res.status === 400) {
        pushToast('error', '先に監視フォルダを選んで保存してください');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { imported: number; skipped: number };
      pushToast('success', `取り込み ${j.imported ?? 0}件（スキップ ${j.skipped ?? 0}件）`);
      await onImported();
      await onChanged();
    } catch (err) {
      pushToast('error', `取り込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-bg px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">{status.account}</span>
        {status.lastImportAt && (
          <span className="shrink-0 text-[10px] text-text-faint">
            最終取り込み: {status.lastImportAt.slice(0, 16).replace('T', ' ')}
          </span>
        )}
      </div>

      {!granted ? (
        // Drive スコープ未許可: 再接続へ誘導。
        <div className="rounded-md border border-dashed border-border bg-surface px-2.5 py-2">
          <p className="text-[11px] text-text-muted">
            写真の自動取り込みには Google の再接続（Driveへのアクセス許可）が必要です。
          </p>
          <button
            type="button"
            onClick={reconnect}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <LinkIcon width={14} height={14} />
            再接続して Drive を許可
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* 監視フォルダ選択 */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">監視フォルダ</span>
            {foldersError ? (
              <span className="text-[11px] text-blocked">
                フォルダ一覧の取得に失敗しました: {foldersError}
              </span>
            ) : folders === null ? (
              <span className="text-[11px] text-text-faint">フォルダを読み込み中…</span>
            ) : (
              <select
                value={folderId}
                onChange={(e) => onSelectFolder(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-accent focus:outline-none"
              >
                <option value="">フォルダを選択…</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          {/* 自動取り込みトグル */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={autoImport}
              onChange={(e) => setAutoImport(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-accent"
            />
            <span className="text-[11px] font-medium text-text-muted">
              新しい写真を自動で取り込む（ページを開いたときに確認します）
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => void importNow()}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              <UploadIcon width={14} height={14} />
              {importing ? '取り込み中…' : '今すぐ取り込み'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ─── 月カレンダー（自作グリッド）─────────────────────────────
function CalendarSection({
  view,
  today,
  selected,
  entryByDate,
  mediaByDate,
  eventsByDate,
  tasksByDate,
  accountColors,
  onPrev,
  onNext,
  onToday,
  onSelect,
}: {
  view: { year: number; month: number };
  today: string;
  selected: string;
  entryByDate: Map<string, DiaryEntry>;
  mediaByDate: Map<string, MediaMeta[]>;
  eventsByDate: Map<string, GoogleCalendarEvent[]>;
  tasksByDate: Map<string, GoogleTask[]>;
  accountColors: Map<string, string>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSelect: (iso: string) => void;
}) {
  const { year, month } = view;
  const lead = firstWeekday(year, month); // 先頭の空白セル数
  const total = daysInMonth(year, month);

  // 6 週ぶんのセル（先頭空白 + 日 + 末尾空白）。
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-text">
          {year}年{MONTH_NAMES[month]}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToday}
            className="mr-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-surface-2 hover:text-text"
          >
            今日
          </button>
          <button
            type="button"
            onClick={onPrev}
            aria-label="前の月"
            className="rounded-md border border-border p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <ChevronLeftIcon width={16} height={16} />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="次の月"
            className="rounded-md border border-border p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </div>

      {/* 曜日見出し（日〜土） */}
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
          if (day === null) return <div key={`b${idx}`} className="aspect-square" />;
          const iso = toIso(year, month, day);
          const isToday = iso === today;
          const isSelected = iso === selected;
          const isBirthday = iso.slice(5) === BIRTH_MMDD;
          const hasEntry = entryByDate.has(iso);
          const media = mediaByDate.get(iso) ?? [];
          const firstImage = media.find((m) => m.kind === 'image');
          const todos = todosForDate(iso);
          const gEvents = eventsByDate.get(iso) ?? [];
          const gTasks = tasksByDate.get(iso) ?? [];
          const weekday = (lead + day - 1) % 7;

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              aria-label={`${formatJpDate(iso)}${hasEntry ? '・記録あり' : ''}${todos.length ? '・やること' : ''}`}
              aria-pressed={isSelected}
              className={`relative flex aspect-square flex-col items-stretch overflow-hidden rounded-md border p-1 text-left transition-colors ${
                isSelected
                  ? 'border-accent bg-accent/10'
                  : isToday
                    ? 'border-accent/50 bg-surface-2'
                    : 'border-border bg-bg hover:bg-surface-2'
              }`}
            >
              <span className="flex items-center justify-between">
                <span
                  className={`text-[11px] font-semibold leading-none ${
                    isToday
                      ? 'text-accent'
                      : weekday === 0
                        ? 'text-blocked'
                        : weekday === 6
                          ? 'text-accent'
                          : 'text-text'
                  }`}
                >
                  {day}
                </span>
                {isBirthday && (
                  <span aria-hidden className="text-[9px] leading-none" title="誕生日">
                    🎂
                  </span>
                )}
              </span>

              {/* サムネ（あれば最初の画像） */}
              {firstImage && (
                <span className="relative mt-0.5 block flex-1 overflow-hidden rounded-sm">
                  <img
                    src={thumbUrl(firstImage.id)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  {media.length > 1 && (
                    <span className="absolute bottom-0 right-0 rounded-tl bg-bg/80 px-1 text-[9px] font-bold leading-tight text-text">
                      {media.length}
                    </span>
                  )}
                </span>
              )}

              {/* 下部バッジ群（締切・記録ドット）。画像が無いときに余白を取る。 */}
              <span className={`mt-auto flex flex-wrap items-center gap-0.5 ${firstImage ? 'pt-0.5' : ''}`}>
                {todos.length > 0 && (
                  <span
                    className="inline-flex items-center rounded-full bg-review-bg px-1 text-[8px] font-bold leading-tight text-review"
                    title={todos.map((t) => t.title).join('・')}
                  >
                    締切
                  </span>
                )}
                {hasEntry && (
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                    title="記録あり"
                  />
                )}
                {gEvents.length > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 px-1 text-[8px] font-bold leading-tight text-text-muted"
                    title={gEvents.map((e) => `${e.title}（${e.account}）`).join('・')}
                  >
                    {/* 取得元アカウントごとの識別色ドット（重なっても見分けられる） */}
                    {Array.from(new Set(gEvents.map((e) => e.account))).map((acc) => (
                      <span
                        key={acc}
                        aria-hidden
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: accountColors.get(acc) ?? 'var(--mc-idle)' }}
                      />
                    ))}
                    {gEvents.length}
                  </span>
                )}
                {gTasks.length > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-bg px-1 text-[8px] font-bold leading-tight text-text-muted"
                    title={gTasks.map((t) => `${t.title}（${t.account}）`).join('・')}
                  >
                    {/* タスクは予定（丸ドット）と区別する□印。取得元アカウントごとの識別色の四角。 */}
                    <span aria-hidden className="leading-none">□</span>
                    {Array.from(new Set(gTasks.map((t) => t.account))).map((acc) => (
                      <span
                        key={acc}
                        aria-hidden
                        className="inline-block h-1.5 w-1.5 rounded-[1px]"
                        style={{ background: accountColors.get(acc) ?? 'var(--mc-idle)' }}
                      />
                    ))}
                    {gTasks.length}
                  </span>
                )}
                {!firstImage && media.length > 0 && (
                  <span className="text-[8px] font-bold leading-tight text-text-muted">
                    🎞{media.length}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* 凡例 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-faint">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> 記録あり
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded-full bg-review-bg px-1 text-[8px] font-bold text-review">締切</span> やること
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted" aria-hidden /> Google予定（色＝アカウント）
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="leading-none">□</span> Googleタスク（色＝アカウント）
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>🎂</span> 誕生日
        </span>
      </div>
    </section>
  );
}

// タスクを Google Tasks のリスト（listTitle）ごとにまとめる。リストの出現順を保ち、
// 各リスト内は渡された並び（タイトル昇順）のまま。
function groupTasksByList(tasks: GoogleTask[]): { listTitle: string; tasks: GoogleTask[] }[] {
  const groups: { listTitle: string; tasks: GoogleTask[] }[] = [];
  const index = new Map<string, GoogleTask[]>();
  for (const t of tasks) {
    const key = t.listTitle || '(無題リスト)';
    let arr = index.get(key);
    if (!arr) {
      arr = [];
      index.set(key, arr);
      groups.push({ listTitle: key, tasks: arr });
    }
    arr.push(t);
  }
  return groups;
}

// ─── Google タスク 1 行（期日あり・期日なし共通）──────────────────
function TaskRow({
  task,
  accountColors,
}: {
  task: GoogleTask;
  accountColors: Map<string, string>;
}) {
  const color = accountColors.get(task.account) ?? 'var(--mc-idle)';
  const done = task.status === 'completed';
  return (
    <li
      className="flex items-start gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      {/* 完了/未完了を□/☑で示す（未完了のみ来る想定）。 */}
      <span
        aria-hidden
        className="mt-px shrink-0 text-sm font-bold leading-none"
        style={{ color }}
        title={done ? '完了' : '未完了'}
      >
        {done ? '☑' : '□'}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`text-xs font-medium text-text ${done ? 'line-through opacity-60' : ''}`}>
          {task.title || '(無題のタスク)'}
        </span>
        {task.notes && (
          <span className="block truncate text-[10px] text-text-muted">{task.notes}</span>
        )}
        <span className="flex items-center gap-1 truncate text-[10px] text-text-faint">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-[1px]"
            style={{ background: color }}
            aria-hidden
          />
          {task.listTitle ? `${task.listTitle}・` : ''}
          {task.account}
        </span>
      </span>
    </li>
  );
}

// ─── その日の詳細パネル ──────────────────────────────────────
function DayDetailSection({
  date,
  entry,
  media,
  googleEvents,
  googleTasks,
  noDueTasks,
  tasksNeedReconnect,
  accountColors,
  visibleEmails,
  importTarget,
  onSelectImportTarget,
  accountsConnected,
  onChanged,
  pushToast,
}: {
  date: string;
  entry: DiaryEntry | undefined;
  media: MediaMeta[];
  googleEvents: GoogleCalendarEvent[];
  googleTasks: GoogleTask[];
  noDueTasks: GoogleTask[];
  tasksNeedReconnect: boolean;
  accountColors: Map<string, string>;
  visibleEmails: string[];
  importTarget: string | null;
  onSelectImportTarget: (email: string) => void;
  accountsConnected: boolean;
  onChanged: () => Promise<void> | void;
  pushToast: (kind: ToastKind, text: string) => void;
}) {
  const todos = todosForDate(date);
  // 取り込み/書き出しの対象（visible が0なら null）。visible が1つなら自動的にそれ。
  const activeAccount = accountsConnected ? importTarget : null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-accent/40 bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-text">{formatJpDate(date)}</h2>
          <p className="mt-0.5 text-xs text-text-muted">生後 {diaryDaysSince(date)} 日</p>
        </div>
        {/* 取り込み/書き出しの対象アカウント。visible が2つ以上のときだけ選ばせる。 */}
        {visibleEmails.length > 1 && (
          <ImportTargetSelect
            visibleEmails={visibleEmails}
            value={activeAccount}
            accountColors={accountColors}
            onChange={onSelectImportTarget}
          />
        )}
      </div>

      {/* やること（締切 ToDo） */}
      <div>
        <h3 className="mb-1.5 text-sm font-bold text-text">やること（締切）</h3>
        {todos.length === 0 ? (
          <p className="text-xs text-text-faint">なし</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {todos.map((t) => (
              <TodoRow
                key={t.id}
                todo={t}
                date={date}
                activeAccount={accountsConnected ? activeAccount : null}
                pushToast={pushToast}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Googleカレンダーの予定（接続時のみ・予定があれば） */}
      {accountsConnected && googleEvents.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-bold text-text">Googleカレンダーの予定</h3>
          <ul className="flex flex-col gap-1.5">
            {googleEvents.map((ev) => {
              const color = accountColors.get(ev.account) ?? 'var(--mc-idle)';
              return (
                <li
                  key={`${ev.account}:${ev.id}`}
                  // 取得元アカウントの識別色を左ボーダーに（重なっても見分けられる）。
                  className="flex items-start gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5"
                  style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                >
                  <span
                    className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-bg"
                    style={{ background: color }}
                  >
                    {eventTimeLabel(ev)}
                  </span>
                  <span className="min-w-0 flex-1">
                    {ev.htmlLink ? (
                      <a
                        href={ev.htmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        {ev.title || '(無題の予定)'}
                      </a>
                    ) : (
                      <span className="text-xs font-medium text-text">{ev.title || '(無題の予定)'}</span>
                    )}
                    <span className="flex items-center gap-1 truncate text-[10px] text-text-faint">
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: color }}
                        aria-hidden
                      />
                      {ev.account}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Googleタスク（接続時のみ・タスクがあれば）。□チェック印＋タイトル＋listTitle＋アカウント色。 */}
      {accountsConnected && googleTasks.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-bold text-text">Googleタスク</h3>
          <ul className="flex flex-col gap-1.5">
            {googleTasks.map((task) => (
              <TaskRow key={`${task.account}:${task.id}`} task={task} accountColors={accountColors} />
            ))}
          </ul>
        </div>
      )}

      {/* 期日なしの Google タスク（接続時のみ・あれば）。日付に紐づかないので選択日に関わらず常に表示。
          Google Tasks のリスト（listTitle）ごとに見出しを付けて分ける。 */}
      {accountsConnected && noDueTasks.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-bold text-text">Googleタスク（期日なし）</h3>
          <div className="flex flex-col gap-3">
            {groupTasksByList(noDueTasks).map(({ listTitle, tasks }) => (
              <div key={listTitle}>
                <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                  {listTitle}
                  <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold text-text-faint">
                    {tasks.length}
                  </span>
                </h4>
                <ul className="flex flex-col gap-1.5">
                  {tasks.map((task) => (
                    <TaskRow
                      key={`${task.account}:${task.id}`}
                      task={task}
                      accountColors={accountColors}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* タスク権限が未許可（全アカウント tasks-not-authorized）のときの再接続ヒント。 */}
      {accountsConnected && tasksNeedReconnect && (
        <div className="rounded-md border border-dashed border-border bg-bg px-2.5 py-2">
          <p className="text-[11px] text-text-muted">
            Googleタスクを表示するには Google の再接続（タスクへのアクセス許可）が必要です。
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/api/google/oauth/start';
            }}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <LinkIcon width={14} height={14} />
            再接続してタスクを許可
          </button>
        </div>
      )}

      <DiaryForm date={date} entry={entry} onSaved={onChanged} />

      <MediaSection
        date={date}
        media={media}
        activeAccount={accountsConnected ? activeAccount : null}
        onChanged={onChanged}
        pushToast={pushToast}
      />
    </section>
  );
}

// ─── 取り込み/書き出しの対象アカウント選択（visible が複数のとき）──────
// 「閲覧は複数重ね・取り込み/書き出しは対象を1つ指定」を両立するための小さなドロップダウン。
function ImportTargetSelect({
  visibleEmails,
  value,
  accountColors,
  onChange,
}: {
  visibleEmails: string[];
  value: string | null;
  accountColors: Map<string, string>;
  onChange: (email: string) => void;
}) {
  const color = value ? accountColors.get(value) ?? 'var(--mc-accent)' : 'var(--mc-border)';
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span className="text-[10px] font-medium text-text-muted">取り込み/書き出し先</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        title="写真取り込み・ToDo書き出しの対象アカウント"
        className="max-w-[10rem] truncate bg-transparent text-[11px] font-medium text-text focus:outline-none"
      >
        {visibleEmails.map((email) => (
          <option key={email} value={email}>
            {email}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─── ToDo 行（Googleカレンダーへ書き出しボタン付き）─────────────
function TodoRow({
  todo,
  date,
  activeAccount,
  pushToast,
}: {
  todo: DueTodo;
  date: string;
  activeAccount: string | null;
  pushToast: (kind: ToastKind, text: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const addToCalendar = async () => {
    if (!activeAccount) return;
    setAdding(true);
    try {
      const res = await fetch('/api/google/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: activeAccount,
          summary: todo.title,
          date: todo.dueIso,
          description: todo.kind === 'admin' ? '行政手続き（成長日記）' : '健診（成長日記）',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAdded(true);
      pushToast('success', `「${todo.title}」をGoogleカレンダーに追加しました`);
    } catch (err) {
      pushToast('error', `カレンダー追加に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <li className="flex items-center gap-2 rounded-md border border-review/40 bg-bg px-2.5 py-1.5">
      <span className="inline-flex shrink-0 items-center rounded-full bg-review-bg px-1.5 py-0.5 text-[10px] font-bold leading-none text-review">
        {todo.kind === 'admin' ? '行政' : '健診'}
      </span>
      <span className="min-w-0 flex-1 text-xs font-medium text-text">{todo.title}</span>
      {/* 締切が選択日と一致するときのみ表示（todosForDate で保証済み）。アカウント未接続なら非表示。 */}
      {activeAccount && (
        <button
          type="button"
          onClick={() => void addToCalendar()}
          disabled={adding || added}
          title={`${date} の予定としてGoogleカレンダーに追加`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          {added ? '追加済み' : adding ? '追加中…' : 'Googleカレンダーへ追加'}
        </button>
      )}
    </li>
  );
}

// ─── 日記フォーム（memo のみ）──────────
function DiaryForm({
  date,
  entry,
  onSaved,
}: {
  date: string;
  entry: DiaryEntry | undefined;
  onSaved: () => Promise<void> | void;
}) {
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // 選択日 / 既存エントリが変わったら prefill しなおす。
  useEffect(() => {
    setMemo(entry?.memo ?? '');
    setSaveError(null);
    setSavedFlash(false);
  }, [date, entry]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = { date, memo };
      const res = await fetch('/api/baby-diary/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onSaved();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-text">日記</h3>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-muted">メモ</span>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
          placeholder="今日のようす・気づきなど"
          className="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
      </label>

      {saveError && <p className="text-xs text-blocked">保存に失敗しました: {saveError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {savedFlash && <span className="text-xs font-medium text-accent">保存しました</span>}
      </div>
    </form>
  );
}

// ─── 写真・動画 ─────────────────────────────────────────────
function MediaSection({
  date,
  media,
  activeAccount,
  onChanged,
  pushToast,
}: {
  date: string;
  media: MediaMeta[];
  activeAccount: string | null;
  onChanged: () => Promise<void> | void;
  pushToast: (kind: ToastKind, text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Google Photos Picker 状態 ──
  // 'idle' | 'waiting'（ユーザーが Picker で選択中・ポーリング） | 'importing'
  const [pickerState, setPickerState] = useState<'idle' | 'waiting' | 'importing'>('idle');
  const pickerStopRef = useRef<{ stopped: boolean }>({ stopped: false });

  const onPick = () => inputRef.current?.click();

  // 選択日が変わったら進行中の Picker を止める。
  useEffect(() => {
    return () => {
      pickerStopRef.current.stopped = true;
    };
  }, [date]);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  const stopPicker = () => {
    pickerStopRef.current.stopped = true;
    setPickerState('idle');
  };

  const startGooglePhotos = async () => {
    if (!activeAccount || pickerState !== 'idle') return;
    const stopState = { stopped: false };
    pickerStopRef.current = stopState;
    setPickerState('waiting');
    try {
      // 1) Picker セッション作成。
      const sres = await fetch('/api/google/photos/picker/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: activeAccount }),
      });
      if (!sres.ok) throw new Error(`HTTP ${sres.status}`);
      const { sessionId, pickerUri } = (await sres.json()) as {
        sessionId: string;
        pickerUri: string;
        account: string;
      };

      // 2) 新規タブで Picker を開く。
      window.open(pickerUri, '_blank', 'noopener,noreferrer');

      // 3) mediaItemsSet になるまで 3 秒間隔でポーリング（最大 ~2 分）。
      const maxAttempts = 40; // 40 * 3s = 120s
      let set = false;
      for (let i = 0; i < maxAttempts; i++) {
        if (stopState.stopped) return;
        await sleep(3000);
        if (stopState.stopped) return;
        const pres = await fetch(
          `/api/google/photos/picker/session/${encodeURIComponent(sessionId)}?account=${encodeURIComponent(activeAccount)}`,
        );
        if (!pres.ok) continue;
        const pj = (await pres.json()) as { mediaItemsSet?: boolean };
        if (pj.mediaItemsSet) {
          set = true;
          break;
        }
      }

      if (stopState.stopped) return;
      if (!set) {
        pushToast('error', 'Google Photosの選択がタイムアウトしました。もう一度お試しください。');
        setPickerState('idle');
        return;
      }

      // 4) 取り込み。
      setPickerState('importing');
      const ires = await fetch('/api/google/photos/picker/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: activeAccount, sessionId, date }),
      });
      if (!ires.ok) throw new Error(`HTTP ${ires.status}`);
      const { imported } = (await ires.json()) as { imported: unknown[] };
      await onChanged();
      pushToast('success', `Google Photosから ${imported?.length ?? 0} 件取り込みました`);
    } catch (err) {
      if (!pickerStopRef.current.stopped) {
        pushToast('error', `Google Photos取り込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setPickerState('idle');
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('date', date);
      for (const f of Array.from(files)) fd.append('files', f);
      const res = await fetch('/api/baby-diary/media', { method: 'POST', body: fd });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      // サーバは { media: [...], skipped } を返す。追加・重複スキップ件数をトーストで知らせる。
      let added: number | undefined;
      let skipped: number | undefined;
      try {
        const j = (await res.json()) as { media?: unknown[]; skipped?: number };
        if (Array.isArray(j.media)) added = j.media.length;
        if (typeof j.skipped === 'number') skipped = j.skipped;
      } catch {
        /* レスポンス本文が無い/JSONでない場合は件数表示を省く */
      }
      await onChanged();
      if (added != null && skipped != null && skipped > 0) {
        pushToast('success', `${added}件追加・${skipped}件は重複でスキップしました`);
      } else if (added != null) {
        pushToast('success', `${added}件追加しました`);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDelete = async (id: string) => {
    try {
      const res = await fetch(mediaUrl(id), { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChanged();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-text">写真・動画</h3>
        <div className="flex flex-wrap items-center gap-2">
          {activeAccount && (
            <button
              type="button"
              onClick={() => void startGooglePhotos()}
              disabled={pickerState !== 'idle'}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              <LinkIcon width={14} height={14} />
              {pickerState === 'importing'
                ? '取り込み中…'
                : pickerState === 'waiting'
                  ? '選択待ち…'
                  : 'Google Photosから追加'}
            </button>
          )}
          <button
            type="button"
            onClick={onPick}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            <UploadIcon width={14} height={14} />
            {uploading ? 'アップロード中…' : '追加'}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>

      {pickerState !== 'idle' && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-idle/40 bg-idle-bg px-2.5 py-1.5">
          <p className="text-xs text-idle">
            {pickerState === 'importing'
              ? '選択した写真を取り込んでいます…'
              : '新しいタブのGoogle Photosで写真を選んでください…（最大2分）'}
          </p>
          {pickerState === 'waiting' && (
            <button
              type="button"
              onClick={stopPicker}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-surface-2 hover:text-text"
            >
              停止
            </button>
          )}
        </div>
      )}

      {uploadError && <p className="text-xs text-blocked">{uploadError}</p>}

      {media.length === 0 ? (
        <p className="text-xs text-text-faint">まだありません。「追加」から写真・動画を登録できます。</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {media.map((m) => (
            <div
              key={m.id}
              className="group relative overflow-hidden rounded-md border border-border bg-bg"
            >
              {m.kind === 'image' ? (
                <a href={mediaUrl(m.id)} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={thumbUrl(m.id)}
                    alt={m.originalName}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full object-cover"
                  />
                </a>
              ) : (
                <video
                  src={mediaUrl(m.id)}
                  controls
                  preload="none"
                  playsInline
                  className="aspect-square w-full object-cover"
                />
              )}
              <span
                aria-hidden
                className="absolute left-1 top-1 rounded bg-bg/80 p-0.5 text-text-muted"
              >
                {m.kind === 'image' ? (
                  <ImageFileIcon width={12} height={12} />
                ) : (
                  <VideoFileIcon width={12} height={12} />
                )}
              </span>
              <button
                type="button"
                onClick={() => void onDelete(m.id)}
                aria-label={`${m.originalName} を削除`}
                className="absolute right-1 top-1 rounded bg-bg/80 p-1 text-text-muted opacity-0 transition-opacity hover:text-blocked group-hover:opacity-100 focus:opacity-100"
              >
                <TrashIcon width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
