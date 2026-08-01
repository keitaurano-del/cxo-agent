// 成長日記ページ（/baby-diary, MC-233 Phase1）。
// ぴよログ取り込み（設定モーダル内）＋成長グラフ（自作SVG）＋ぴよログのタイムラインを、
// サーバ API（同一オリジン・Cookie 認証）に対して描画する。
// グラフは外部ライブラリを足さず React/SVG で自作する（依存を増やさない）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ResourceState } from '../components/ui';
import {
  UploadIcon,
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
  ageMonthsDecimal,
  ageWeeksDecimal,
} from './childcareData';
import {
  MALE_WEIGHT_PERCENTILES,
  WEIGHT_CHART_MIN_MONTH,
  WEIGHT_CHART_MAX_MONTH,
  WEIGHT_CHART_MAX_WEEK,
  WEIGHT_CHART_DEFAULT_MAX_WEEK,
  weightPercentileAtWeek,
  WEIGHT_STANDARD_SOURCE_LABEL,
  WEIGHT_STANDARD_SOURCE_URL,
} from './growthStandards';

// ─── API 型（サーバ契約に対応）──────────────────────────────
interface DiaryEntry {
  date: string; // YYYY-MM-DD
  memo?: string;
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

// ─── ぴよログ取り込み API 型（サーバ契約に対応）────────────────
interface PiyologEvent {
  time: string; // "HH:MM"
  kind: string; // formula/breast/pee/poop/sleep/wake/bath/weight/height/temp/foot/other
  text: string;
}

interface PiyologSummary {
  breastMilk?: string;
  formula?: string;
  sleep?: string;
  pee?: string;
  poop?: string;
}

interface PiyologDay {
  date: string; // YYYY-MM-DD
  ageLabel?: string;
  events: PiyologEvent[];
  summary?: PiyologSummary;
  weights: { time: string; kg: number }[];
  heights: { time: string; cm: number }[];
  createdAt?: string;
  updatedAt?: string;
}

interface DiaryResponse {
  generatedAt: string;
  entries: DiaryEntry[];
  media: MediaMeta[];
  piyolog?: PiyologDay[];
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

  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const [data, setData] = useState<DiaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 設定モーダル（Google連携・Drive取り込みをまとめて格納）の開閉。
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Google 連携状態 ──
  const [gstatus, setGstatus] = useState<GoogleStatus | null>(null);
  // 設定モーダルの Google連携パネルで「重ねて表示」相当の選択に使う集合（既定＝接続済み全アカウント）。
  const [visibleAccounts, setVisibleAccounts] = useState<Set<string>>(new Set());

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

  // ぴよログ（新しい日が上）。タイムライン表示用。
  const piyologDays = useMemo(() => {
    const days = [...(data?.piyolog ?? [])];
    days.sort((a, b) => b.date.localeCompare(a.date));
    return days;
  }, [data]);

  // 体重グラフへ渡すエントリ: 手動エントリ＋ぴよログ各日の体重をマージ（1日1点）。
  // 手動の weightKg がある日はそのまま。無い日にぴよログの最後（最新時刻）の体重を注入する。
  // 手動 memo 等があるエントリには weightKg だけ足し、手動エントリが無ければ合成エントリを作る。
  const chartEntries = useMemo(() => {
    const byDate = new Map<string, DiaryEntry>();
    for (const e of data?.entries ?? []) byDate.set(e.date, { ...e });
    for (const day of data?.piyolog ?? []) {
      if (day.weights.length === 0) continue;
      const lastWeight = day.weights.reduce((acc, w) => (w.time >= acc.time ? w : acc));
      const existing = byDate.get(day.date);
      if (existing) {
        // 手動 weightKg が無ければぴよログの体重を補う（あれば手動を優先）。
        if (typeof existing.weightKg !== 'number') existing.weightKg = lastWeight.kg;
      } else {
        byDate.set(day.date, { date: day.date, weightKg: lastWeight.kg });
      }
    }
    return Array.from(byDate.values());
  }, [data]);

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

        {/* ぴよログのエクスポートテキストを貼り付けて取り込む。 */}
        <PiyologImportPanel onImported={fetchData} pushToast={pushToast} />
      </DiarySettingsModal>

      <ResourceState loading={loading} error={error} hasData={!!data}>
        {/* 体重グラフ（母子手帳ふう・標準体重帯つき）。データ0件でも帯と軸を表示する。
            手動エントリ＋ぴよログの体重をマージした点を描く。 */}
        <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
          <WeightGrowthChart entries={chartEntries} />
        </section>

        {/* ぴよログのタイムライン（取り込みがあるときだけ表示）。 */}
        <PiyologTimeline days={piyologDays} />
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
        subtitle="ぴよログの記録・成長グラフをまとめます。手続きや健診の目安は育児タブをどうぞ。"
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

// ─── 体重グラフ（自作SVG・母子手帳ふう標準体重帯つき）──────────
// 横軸＝月齢(0〜12)、縦軸＝体重(kg)。背景に 3〜97 パーセンタイルの帯（厚労省 平成22年 男子）を
// 薄く塗り、境界線を描く。記録した体重を点＋線でプロットする。外部依存なしの SVG で描画。
type WeightChartUnit = 'month' | 'week';

function WeightGrowthChart({ entries }: { entries: DiaryEntry[] }) {
  // 表示単位（横軸）の切替。デフォルトは月齢（既存挙動を維持）。
  const [unit, setUnit] = useState<WeightChartUnit>('month');

  // weightKg を持つエントリを「横軸位置（月齢 or 週齢の小数）→体重」の点に変換し昇順に並べる。
  // month/week 両方の位置を持たせ、単位切替時は同じ点を使い回す。
  const allPoints = useMemo(() => {
    return entries
      .filter((e) => typeof e.weightKg === 'number' && Number.isFinite(e.weightKg))
      .map((e) => ({
        date: e.date,
        month: ageMonthsDecimal(e.date),
        week: ageWeeksDecimal(e.date),
        kg: e.weightKg as number,
      }));
  }, [entries]);

  // 描画領域（viewBox 座標）。レスポンシブは外側の width:100% + preserveAspectRatio に任せる。
  const W = 520;
  const H = 320;
  const padL = 40; // 左（Y 軸ラベル＋目盛り）
  const padR = 14;
  const padT = 14;
  const padB = 38; // 下（X 軸ラベル）

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // 横軸（X）のレンジと、その位置でのパーセンタイル値・標準体の評価点を単位ごとに用意する。
  // - 月表示: 既存どおり 0〜12 か月、パーセンタイル定数の各点をそのまま使う。
  // - 週表示: 0〜（デフォルト13・データが超えたら ceil(最新週)+1、最大は約52週でクランプ）。
  //           帯/中央値は週位置を月齢に直して線形補間したサンプル点で描く。
  const xMin = unit === 'month' ? WEIGHT_CHART_MIN_MONTH : 0;

  const points = useMemo(() => {
    if (unit === 'month') {
      return allPoints
        .map((p) => ({ date: p.date, x: p.month, kg: p.kg, month: p.month, week: p.week }))
        .filter((p) => p.x >= WEIGHT_CHART_MIN_MONTH && p.x <= WEIGHT_CHART_MAX_MONTH)
        .sort((a, b) => a.x - b.x);
    }
    return allPoints
      .map((p) => ({ date: p.date, x: p.week, kg: p.kg, month: p.month, week: p.week }))
      .filter((p) => p.x >= 0 && p.x <= WEIGHT_CHART_MAX_WEEK)
      .sort((a, b) => a.x - b.x);
  }, [allPoints, unit]);

  // 週表示の横軸上限: デフォルト13週。データが超えたら ceil(最新週)+1、ただし約52週でクランプ。
  const xMax = useMemo(() => {
    if (unit === 'month') return WEIGHT_CHART_MAX_MONTH;
    const latest = points.length ? points[points.length - 1].x : 0;
    const wanted = Math.max(WEIGHT_CHART_DEFAULT_MAX_WEEK, Math.ceil(latest) + 1);
    return Math.min(WEIGHT_CHART_MAX_WEEK, wanted);
  }, [unit, points]);

  // 標準体（帯・中央値）を描くためのサンプル点。月表示は定数の各月、週表示は0..xMaxの各週。
  const standardSamples = useMemo(() => {
    if (unit === 'month') {
      return MALE_WEIGHT_PERCENTILES.map((d) => ({
        x: d.month,
        p3: d.p3,
        p50: d.p50,
        p97: d.p97,
      }));
    }
    const samples: { x: number; p3: number; p50: number; p97: number }[] = [];
    // 端まで滑らかに描くため、整数週＋上限を含める。
    const xs: number[] = [];
    for (let w = 0; w <= xMax; w += 1) xs.push(w);
    if (xs[xs.length - 1] !== xMax) xs.push(xMax);
    for (const w of xs) {
      samples.push({
        x: w,
        p3: weightPercentileAtWeek(w, 'p3'),
        p50: weightPercentileAtWeek(w, 'p50'),
        p97: weightPercentileAtWeek(w, 'p97'),
      });
    }
    return samples;
  }, [unit, xMax]);

  // Y レンジ: 帯（p3 最小 〜 p97 最大）を必ず収め、データ点があればそれも収める。
  // 帯は表示中の横軸レンジに対応するサンプルから求める（週表示は狭いレンジに自動調整される）。
  const bandMin = Math.min(...standardSamples.map((d) => d.p3));
  const bandMax = Math.max(...standardSamples.map((d) => d.p97));
  const dataMin = points.length ? Math.min(...points.map((p) => p.kg)) : bandMin;
  const dataMax = points.length ? Math.max(...points.map((p) => p.kg)) : bandMax;
  const rawMin = Math.min(bandMin, dataMin);
  const rawMax = Math.max(bandMax, dataMax);
  // 端を少し余裕を持たせ、整数 kg に丸める。
  const yMin = Math.max(0, Math.floor(rawMin - 0.5));
  const yMax = Math.ceil(rawMax + 0.5);

  const xOf = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
  const yOf = (kg: number) => padT + (1 - (kg - yMin) / (yMax - yMin)) * plotH;

  // 帯（p3 下限〜p97 上限）のポリゴン: 上端を左→右に p97、下端を右→左に p3。
  const bandPath = useMemo(() => {
    const top = standardSamples.map((d) => `${xOf(d.x)},${yOf(d.p97)}`);
    const bottom = standardSamples
      .slice()
      .reverse()
      .map((d) => `${xOf(d.x)},${yOf(d.p3)}`);
    return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
    // xOf/yOf は xMin/xMax/yMin/yMax に依存するので依存配列に含める。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standardSamples, xMin, xMax, yMin, yMax]);

  const lineFor = (key: 'p3' | 'p50' | 'p97') =>
    'M ' + standardSamples.map((d) => `${xOf(d.x)},${yOf(d[key])}`).join(' L ');

  // データの折れ線（2点以上で描く）。
  const dataLine =
    points.length >= 2
      ? 'M ' + points.map((p) => `${xOf(p.x)},${yOf(p.kg)}`).join(' L ')
      : '';

  // 軸目盛り。
  // - 月表示: 0〜12 か月（偶数）。
  // - 週表示: 0..xMax の週を、本数が多いと間引いて可読に（目安 ≤14本）。
  const xTicks: number[] = [];
  if (unit === 'month') {
    for (let m = xMin; m <= xMax; m += 2) xTicks.push(m);
  } else {
    const span = xMax - xMin;
    // 1,2,5,10,… の系列から、本数が約14本以下になる最小ステップを選ぶ。
    const candidates = [1, 2, 5, 10, 13, 26];
    const step = candidates.find((s) => span / s <= 14) ?? Math.ceil(span / 14);
    for (let w = xMin; w <= xMax + 1e-9; w += step) xTicks.push(Math.round(w));
    // 末端の上限も目盛りに含める（重複は除く）。
    const lastTick = xTicks[xTicks.length - 1];
    if (lastTick !== Math.round(xMax)) xTicks.push(Math.round(xMax));
  }
  const yTicks: number[] = [];
  for (let kg = yMin; kg <= yMax; kg += 1) yTicks.push(kg);

  const xAxisTitle = unit === 'month' ? '月齢(か月)' : '週齢(週)';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-text">体重グラフ</h3>
        {/* 表示単位の切替（月齢 / 週齢）。デフォルトは月齢。 */}
        <div
          className="inline-flex overflow-hidden rounded-md border border-border text-[11px]"
          role="group"
          aria-label="横軸の表示単位"
        >
          {(['month', 'week'] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              aria-pressed={unit === u}
              className={
                'px-2.5 py-1 transition-colors ' +
                (unit === u
                  ? 'bg-accent text-white'
                  : 'bg-bg text-text-muted hover:text-text')
              }
            >
              {u === 'month' ? '月で表示' : '週で表示'}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-md border border-border bg-bg p-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="体重の成長グラフ（標準範囲の帯つき）"
          className="block h-auto w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* グリッド線（Y） */}
          {yTicks.map((kg) => (
            <line
              key={`gy${kg}`}
              x1={padL}
              y1={yOf(kg)}
              x2={W - padR}
              y2={yOf(kg)}
              stroke="var(--mc-border)"
              strokeWidth={1}
              opacity={0.5}
            />
          ))}
          {/* グリッド線（X） */}
          {xTicks.map((m) => (
            <line
              key={`gx${m}`}
              x1={xOf(m)}
              y1={padT}
              x2={xOf(m)}
              y2={padT + plotH}
              stroke="var(--mc-border)"
              strokeWidth={1}
              opacity={0.35}
            />
          ))}

          {/* 標準体重帯（3〜97パーセンタイル）の塗り */}
          <path d={bandPath} fill="var(--mc-accent)" opacity={0.14} />
          {/* 帯の境界線（下限=3p / 上限=97p）と中央値(50p) */}
          <path d={lineFor('p97')} fill="none" stroke="var(--mc-accent)" strokeWidth={1.5} opacity={0.7} />
          <path d={lineFor('p3')} fill="none" stroke="var(--mc-accent)" strokeWidth={1.5} opacity={0.7} />
          <path
            d={lineFor('p50')}
            fill="none"
            stroke="var(--mc-accent)"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.55}
          />

          {/* 軸線 */}
          <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="var(--mc-text-muted)" strokeWidth={1} />
          <line
            x1={padL}
            y1={padT + plotH}
            x2={W - padR}
            y2={padT + plotH}
            stroke="var(--mc-text-muted)"
            strokeWidth={1}
          />

          {/* Y 軸目盛りラベル */}
          {yTicks.map((kg) => (
            <text
              key={`yl${kg}`}
              x={padL - 6}
              y={yOf(kg) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--mc-text-faint)"
            >
              {kg}
            </text>
          ))}
          {/* X 軸目盛りラベル */}
          {xTicks.map((m) => (
            <text
              key={`xl${m}`}
              x={xOf(m)}
              y={padT + plotH + 14}
              textAnchor="middle"
              fontSize={10}
              fill="var(--mc-text-faint)"
            >
              {m}
            </text>
          ))}

          {/* 軸タイトル */}
          <text x={padL} y={padT - 3} textAnchor="start" fontSize={10} fill="var(--mc-text-muted)">
            体重(kg)
          </text>
          <text
            x={padL + plotW / 2}
            y={padT + plotH + 32}
            textAnchor="middle"
            fontSize={10}
            fill="var(--mc-text-muted)"
          >
            {xAxisTitle}
          </text>

          {/* 記録した体重: 線（2点以上）＋点 */}
          {dataLine && (
            <path d={dataLine} fill="none" stroke="var(--mc-review)" strokeWidth={2} />
          )}
          {points.map((p) => (
            <circle
              key={p.date}
              cx={xOf(p.x)}
              cy={yOf(p.kg)}
              r={2}
              fill="var(--mc-review)"
              stroke="var(--mc-bg)"
              strokeWidth={0.75}
            >
              <title>
                {unit === 'month'
                  ? `${formatJpDate(p.date)}・${p.kg}kg（月齢 ${p.month.toFixed(1)}）`
                  : `${formatJpDate(p.date)}・${p.kg}kg（週齢 ${p.week.toFixed(1)}）`}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-faint">
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-3.5 rounded-sm"
            style={{ background: 'var(--mc-accent)', opacity: 0.25 }}
            aria-hidden
          />
          {WEIGHT_STANDARD_SOURCE_LABEL}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-px w-4"
            style={{ borderTop: '1px dashed var(--mc-accent)' }}
            aria-hidden
          />
          中央値（50パーセンタイル）
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: 'var(--mc-review)' }}
            aria-hidden
          />
          記録した体重
        </span>
      </div>
      <p className="text-[10px] text-text-faint">
        出典:{' '}
        <a
          href={WEIGHT_STANDARD_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          厚生労働省 平成22年 乳幼児身体発育調査（男子・体重）
        </a>
        。成長の目安です。
      </p>
    </div>
  );
}

// ─── ぴよログ取り込みパネル（設定モーダル内）────────────────────
// ぴよログのエクスポートテキストを貼り付けて取り込む。POST /api/baby-diary/piyolog/import。
function PiyologImportPanel({
  onImported,
  pushToast,
}: {
  onImported: () => Promise<void> | void;
  pushToast: (kind: ToastKind, text: string) => void;
}) {
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);

  const onImport = useCallback(async () => {
    const body = text.trim();
    if (!body) {
      pushToast('error', 'ぴよログのテキストを貼り付けてください');
      return;
    }
    setImporting(true);
    try {
      const res = await fetch('/api/baby-diary/piyolog/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { days: number; events: number; weights: number };
      pushToast('success', `${j.days}日・${j.events}件を取り込みました`);
      setText('');
      await onImported();
    } catch (err) {
      pushToast('error', `取り込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  }, [text, onImported, pushToast]);

  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-text-muted">
          <UploadIcon width={16} height={16} />
        </span>
        <h2 className="text-base font-bold text-text">ぴよログ取り込み</h2>
      </div>
      <p className="mb-3 text-xs text-text-muted">
        ぴよログのアプリで書き出したテキストを貼り付けて取り込みます。授乳・睡眠などの記録がタイムラインに表示され、体重は成長グラフに反映されます。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="ぴよログの「テキストで送る」などで書き出したテキストをここに貼り付けてください。"
        className="w-full resize-y rounded-md border border-border bg-bg p-2 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void onImport()}
          disabled={importing || text.trim() === ''}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {importing ? '取り込み中…' : '取り込む'}
        </button>
      </div>
    </section>
  );
}

// ─── ぴよログ タイムライン表示 ────────────────────────────────
// kind → アイコン（絵文字）。
const PIYOLOG_KIND_ICON: Record<string, string> = {
  formula: '🍼',
  breast: '🤱',
  pee: '💧',
  poop: '💩',
  sleep: '😴',
  wake: '☀️',
  bath: '🛁',
  weight: '⚖️',
  height: '📏',
  temp: '🌡️',
  foot: '👣',
  other: '・',
};

// 曜日（日本語）。
const JP_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** YYYY-MM-DD → "M/D(曜)"。 */
function formatPiyologDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return `${m}/${d}(${JP_WEEKDAYS[wd] ?? ''})`;
}

function PiyologTimeline({ days }: { days: PiyologDay[] }) {
  if (days.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <h2 className="mb-3 text-base font-bold text-text">ぴよログ</h2>
      <div className="flex flex-col gap-3">
        {days.map((day, idx) => (
          <PiyologDayCard key={day.date} day={day} defaultOpen={idx === 0} />
        ))}
      </div>
    </section>
  );
}

function PiyologDayCard({ day, defaultOpen }: { day: PiyologDay; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  // 合計チップ（生文字列）。
  const chips: { label: string; value: string }[] = [];
  const s = day.summary;
  if (s?.breastMilk) chips.push({ label: '母乳', value: s.breastMilk });
  if (s?.formula) chips.push({ label: 'ミルク', value: s.formula });
  if (s?.sleep) chips.push({ label: '睡眠', value: s.sleep });
  if (s?.pee) chips.push({ label: 'おしっこ', value: s.pee });
  if (s?.poop) chips.push({ label: 'うんち', value: s.poop });

  return (
    <div className="rounded-lg border border-border bg-bg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-col gap-1.5 rounded-lg px-3 py-2 text-left hover:bg-surface-2"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-text">{formatPiyologDate(day.date)}</span>
          {day.ageLabel && <span className="text-[11px] text-text-faint">{day.ageLabel}</span>}
          <span className="ml-auto text-[11px] text-text-faint">
            {day.events.length}件 {open ? '−' : '＋'}
          </span>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <span
                key={c.label}
                className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted"
                title={c.value}
              >
                {c.value}
              </span>
            ))}
          </div>
        )}
      </button>

      {open && (
        <ol className="flex flex-col gap-0.5 border-t border-border px-3 py-2">
          {day.events.map((ev, i) => (
            <li key={`${ev.time}-${i}`} className="flex items-baseline gap-2 text-xs">
              <span className="w-10 shrink-0 tabular-nums text-text-faint">{ev.time}</span>
              <span aria-hidden className="w-4 shrink-0 text-center">
                {PIYOLOG_KIND_ICON[ev.kind] ?? PIYOLOG_KIND_ICON.other}
              </span>
              <span className="min-w-0 flex-1 text-text">{ev.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
