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
} from '../components/icons';
import {
  BIRTH_DATE,
  daysSinceBirth,
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
  milestone?: string;
  heightCm?: number;
  weightKg?: number;
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
      <DiaryHeader now={now} />

      <GoogleConnectPanel
        status={gstatus}
        visibleAccounts={visibleAccounts}
        accountColors={accountColors}
        onToggleAccount={toggleVisibleAccount}
        onRefresh={fetchGoogleStatus}
        pushToast={pushToast}
      />

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
            accountColors={accountColors}
            visibleEmails={visibleEmails}
            importTarget={activeImportAccount}
            onSelectImportTarget={setImportTarget}
            accountsConnected={hasAccounts}
            onChanged={fetchData}
            pushToast={pushToast}
          />
        </div>

        <GrowthChartSection entries={data?.entries ?? []} />
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

// ─── ヘッダ（生後 N 日）──────────────────────────────────────
function DiaryHeader({ now }: { now: Date }) {
  const days = daysSinceBirth(now);
  return (
    <div className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <p className="text-xs text-text-muted">{formatJpDate(BIRTH_DATE)} 誕生</p>
      <p className="mt-1 text-2xl font-bold text-text md:text-3xl">
        生後 <span className="text-accent">{days}</span> 日
      </p>
      <p className="mt-1 text-xs text-text-muted">
        日付をタップすると、その日の記録・写真・やることを編集できます。
      </p>
    </div>
  );
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

// ─── 月カレンダー（自作グリッド）─────────────────────────────
function CalendarSection({
  view,
  today,
  selected,
  entryByDate,
  mediaByDate,
  eventsByDate,
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
                    src={mediaUrl(firstImage.id)}
                    alt=""
                    loading="lazy"
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
          <span aria-hidden>🎂</span> 誕生日
        </span>
      </div>
    </section>
  );
}

// ─── その日の詳細パネル ──────────────────────────────────────
function DayDetailSection({
  date,
  entry,
  media,
  googleEvents,
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

// ─── 日記フォーム（memo / milestone / 身長 / 体重）──────────
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
  const [milestone, setMilestone] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // 選択日 / 既存エントリが変わったら prefill しなおす。
  useEffect(() => {
    setMemo(entry?.memo ?? '');
    setMilestone(entry?.milestone ?? '');
    setHeight(entry?.heightCm != null ? String(entry.heightCm) : '');
    setWeight(entry?.weightKg != null ? String(entry.weightKg) : '');
    setSaveError(null);
    setSavedFlash(false);
  }, [date, entry]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = { date, memo, milestone };
      if (height.trim() !== '') body.heightCm = Number(height);
      if (weight.trim() !== '') body.weightKg = Number(weight);
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

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-muted">できたこと（マイルストーン）</span>
        <input
          type="text"
          value={milestone}
          onChange={(e) => setMilestone(e.target.value)}
          placeholder="例: 初めて笑った"
          className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">身長 (cm)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder="例: 50.5"
            className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">体重 (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="例: 3.25"
            className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
        </label>
      </div>

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
      await onChanged();
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
                <img
                  src={mediaUrl(m.id)}
                  alt={m.originalName}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <video src={mediaUrl(m.id)} controls className="aspect-square w-full object-cover" />
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

// ─── 成長グラフ（自作SVG・身長／体重の折れ線）──────────────
function GrowthChartSection({ entries }: { entries: DiaryEntry[] }) {
  // heightCm / weightKg のいずれかを持つエントリを date 昇順で。
  const points = useMemo(() => {
    return entries
      .filter((e) => e.heightCm != null || e.weightKg != null)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [entries]);

  const heightPts = points.filter((p) => p.heightCm != null);
  const weightPts = points.filter((p) => p.weightKg != null);

  // 2点未満（身長・体重とも）ならプレースホルダ。
  if (heightPts.length < 2 && weightPts.length < 2) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
        <h2 className="mb-1 text-base font-bold text-text">📈 成長グラフ</h2>
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-faint">
          身長・体重の記録が増えるとグラフが表示されます（各2点以上で折れ線になります）。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <h2 className="mb-3 text-base font-bold text-text">📈 成長グラフ</h2>
      <LineChart points={points} heightPts={heightPts} weightPts={weightPts} />
    </section>
  );
}

const HEIGHT_COLOR = 'var(--mc-accent)';
const WEIGHT_COLOR = 'var(--mc-review)';

function LineChart({
  points,
  heightPts,
  weightPts,
}: {
  points: DiaryEntry[];
  heightPts: DiaryEntry[];
  weightPts: DiaryEntry[];
}) {
  // viewBox 座標系（レスポンシブは width=100% で伸縮）。
  const W = 600;
  const H = 260;
  const padL = 40;
  const padR = 40;
  const padT = 16;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // X 軸: 生後日数（最小〜最大）。
  const xs = points.map((p) => diaryDaysSince(p.date));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = Math.max(1, xMax - xMin);
  const xOf = (iso: string) => padL + ((diaryDaysSince(iso) - xMin) / xSpan) * plotW;

  // 各系列の Y スケール（独立軸）。少し余白を足す。
  function scale(vals: number[]) {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.1 || Math.max(0.5, max * 0.05);
    const lo = min - pad;
    const hi = max + pad;
    const span = Math.max(0.001, hi - lo);
    return { lo, hi, span };
  }

  const hVals = heightPts.map((p) => p.heightCm!);
  const wVals = weightPts.map((p) => p.weightKg!);
  const hScale = hVals.length ? scale(hVals) : null;
  const wScale = wVals.length ? scale(wVals) : null;

  const yOfHeight = (v: number) =>
    hScale ? padT + plotH - ((v - hScale.lo) / hScale.span) * plotH : 0;
  const yOfWeight = (v: number) =>
    wScale ? padT + plotH - ((v - wScale.lo) / wScale.span) * plotH : 0;

  const linePath = (pts: DiaryEntry[], pick: (e: DiaryEntry) => number, yFn: (v: number) => number) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.date).toFixed(1)} ${yFn(pick(p)).toFixed(1)}`).join(' ');

  // 横グリッド（4分割）と左右の目盛りラベル。
  const gridRows = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="身長・体重の成長グラフ">
        {/* 横グリッド */}
        {gridRows.map((r) => {
          const y = padT + plotH * r;
          return (
            <line
              key={r}
              x1={padL}
              y1={y}
              x2={W - padR}
              y2={y}
              stroke="var(--mc-border)"
              strokeWidth={1}
            />
          );
        })}

        {/* 左目盛り（身長） */}
        {hScale &&
          gridRows.map((r) => {
            const v = hScale.hi - hScale.span * r;
            const y = padT + plotH * r;
            return (
              <text key={`hl${r}`} x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill={HEIGHT_COLOR}>
                {v.toFixed(0)}
              </text>
            );
          })}

        {/* 右目盛り（体重） */}
        {wScale &&
          gridRows.map((r) => {
            const v = wScale.hi - wScale.span * r;
            const y = padT + plotH * r;
            return (
              <text key={`wl${r}`} x={W - padR + 4} y={y + 3} textAnchor="start" fontSize="9" fill={WEIGHT_COLOR}>
                {v.toFixed(1)}
              </text>
            );
          })}

        {/* X 軸ラベル（最小・最大の生後日数） */}
        <text x={padL} y={H - padB + 16} textAnchor="start" fontSize="9" fill="var(--mc-text-faint)">
          生後{xMin}日
        </text>
        <text x={W - padR} y={H - padB + 16} textAnchor="end" fontSize="9" fill="var(--mc-text-faint)">
          生後{xMax}日
        </text>

        {/* 身長の折れ線 */}
        {heightPts.length >= 2 && (
          <path d={linePath(heightPts, (e) => e.heightCm!, yOfHeight)} fill="none" stroke={HEIGHT_COLOR} strokeWidth={2} />
        )}
        {heightPts.map((p) => (
          <circle key={`hp${p.date}`} cx={xOf(p.date)} cy={yOfHeight(p.heightCm!)} r={2.5} fill={HEIGHT_COLOR} />
        ))}

        {/* 体重の折れ線 */}
        {weightPts.length >= 2 && (
          <path d={linePath(weightPts, (e) => e.weightKg!, yOfWeight)} fill="none" stroke={WEIGHT_COLOR} strokeWidth={2} />
        )}
        {weightPts.map((p) => (
          <circle key={`wp${p.date}`} cx={xOf(p.date)} cy={yOfWeight(p.weightKg!)} r={2.5} fill={WEIGHT_COLOR} />
        ))}
      </svg>

      {/* 凡例 */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5 text-text-muted">
          <span className="inline-block h-2.5 w-4 rounded-full" style={{ background: HEIGHT_COLOR }} aria-hidden />
          身長 (cm)・左軸
        </span>
        <span className="inline-flex items-center gap-1.5 text-text-muted">
          <span className="inline-block h-2.5 w-4 rounded-full" style={{ background: WEIGHT_COLOR }} aria-hidden />
          体重 (kg)・右軸
        </span>
      </div>
    </div>
  );
}
