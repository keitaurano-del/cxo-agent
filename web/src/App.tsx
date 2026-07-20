// Apollo — アプリシェル（左ナビ + ヘッダ + ルート）。
// トップナビは 4 項目に集約（MC-76）: ダッシュボード / タスクボード / 承認フロー / Vault。
// ダッシュボード（/）配下に俯瞰・今日・会話・エージェント・消費量の 5 タブを入れ子で持つ。
// 子ビューの URL（/today /feed /agents /usage /agents/:id）は温存し、deep link・SSE・
// 横断検索からの遷移に影響を出さない。
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { useLiveStream, useLiveResource } from './lib/useLiveData';
import { LiveContext } from './lib/liveContext';
import type { ApprovalsResponse } from './lib/types';
import {
  BoardIcon,
  GridIcon,
  ApolloMark,
  DocumentsIcon,
  TerminalIcon,
  BabyIcon,
  ChajiIcon,
  WorkIcon,
  CodeIcon,
  RestoreIcon,
  SettingsIcon,
  SearchIcon,
  ExpandIcon,
  ShrinkIcon,
} from './components/icons';
import { GlobalSearch } from './components/GlobalSearch';
import DashboardLayout from './components/DashboardLayout';
import { isDashboardPath } from './lib/nav';
// 着地ビュー（/ の最初に出る画面）は eager のまま first paint を遅らせない。
// 既定着地はカウントダウン（ダッシュボードの固定先頭タブ）。
import Countdown from './views/Countdown';
// AgentsLive はタスクボード（TasksTabs）内のタブへ移動（MC-317）。
// それ以外の二次的なビューは route 単位で遅延ロードし、初回エントリJSから切り離す（MC-194）。
const Agents = lazy(() => import('./views/Agents'));
const Activity = lazy(() => import('./views/Activity'));
const Feed = lazy(() => import('./views/Feed'));
const TasksTabs = lazy(() => import('./views/TasksTabs'));
const News = lazy(() => import('./views/News'));
const DocumentsTabs = lazy(() => import('./views/DocumentsTabs'));
const PlanUsage = lazy(() => import('./views/PlanUsage'));
const Childcare = lazy(() => import('./views/Childcare'));
const Chaji = lazy(() => import('./views/Chaji'));
const Work = lazy(() => import('./views/Work'));
const ClaudeChat = lazy(() => import('./views/ClaudeChat'));
const Schedule = lazy(() => import('./views/Schedule'));
const Development = lazy(() => import('./views/Development'));
const Terminal = lazy(() => import('./views/Terminal'));
// BuildProgress はタスクボード（TasksTabs）内のタブへ移動（MC-317）。
const Pdca = lazy(() => import('./views/Pdca'));
// 収益コックピット（ClipItNow の収益・トラフィック統合・2026-07-19）。
const Revenue = lazy(() => import('./views/Revenue'));
import BottomNav from './components/BottomNav';
import { SortableNav, DragHandle } from './components/SortableNav';
import type { DragHandleProps } from './components/SortableNav';
import { useNavOrder } from './lib/useNavOrder';
import AddTaskFab from './components/AddTaskFab';
import { UploadProvider } from './lib/UploadContext';
import { UploadToast } from './components/UploadToast';
import Settings from './components/Settings';
import { useFontSize } from './lib/useFontSize';
import { useSidebarWidth } from './lib/useSidebarWidth';

// 遅延ロード中の軽量フォールバック（チャンク取得待ちの一瞬だけ表示）。
function ViewFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center" role="status" aria-label="読み込み中">
      <span
        className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent"
        aria-hidden
      />
    </div>
  );
}

// ---- テーマ管理 ----
type ThemeMode = 'auto' | 'dark' | 'light';

/** 現在時刻が「日中（6:00〜20:59）」かどうか判定する。 */
function isDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h <= 20;
}

/** localStorage のキー */
const THEME_KEY = 'apollo.theme';

/** 保存済みテーマを読む。不正値は 'auto' に fallback。 */
function loadTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  if (v === 'auto' || v === 'dark' || v === 'light') return v;
  return 'auto';
}

/** html 要素に .dark クラスを付け外しする。 */
function applyDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

/** mode と現在時刻から実際のダーク on/off を計算する。 */
function resolveTheme(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return !isDaytime(); // auto: 夜間 = ダーク
}

/** 手動トグルのサイクル: auto → dark → light → auto */
function nextMode(current: ThemeMode): ThemeMode {
  if (current === 'auto') return 'dark';
  if (current === 'dark') return 'light';
  return 'auto';
}

/** ThemeController: 初期化・1分ごとの自動切替・手動トグルを管理する Hook。 */
function useTheme(): { mode: ThemeMode; isDark: boolean; toggle: () => void; setMode: (m: ThemeMode) => void } {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const m = loadTheme();
    applyDark(resolveTheme(m));
    return m;
  });

  const isDark = resolveTheme(mode);

  // 1分ごとに auto モードの時刻を再評価する
  useEffect(() => {
    const id = setInterval(() => {
      setMode((m) => {
        if (m === 'auto') {
          applyDark(resolveTheme('auto'));
        }
        return m; // mode 値は変えない、DOM だけ更新
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // mode が変わったら即反映
  useEffect(() => {
    applyDark(resolveTheme(mode));
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => {
      const next = nextMode(m);
      localStorage.setItem(THEME_KEY, next);
      applyDark(resolveTheme(next));
      return next;
    });
  }, []);

  // 特定モードを直接セット（設定モーダルのテーマ選択用）。
  const setModeDirect = useCallback((next: ThemeMode) => {
    localStorage.setItem(THEME_KEY, next);
    applyDark(resolveTheme(next));
    setMode(next);
  }, []);

  return { mode, isDark, toggle, setMode: setModeDirect };
}

// ---- ナビ ----
interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
  external?: boolean; // true の場合は React ルートでなく実リンク（別タブ）で開く（例: /site/ の独立サイト）。
}

const NAV: NavItem[] = [
  // 実装進捗はタスクボードの「実装進捗」タブへ統合（2026-07-20 Keita・MC-317）。/progress は後方互換。
  { to: '/', label: 'ダッシュボード', shortLabel: 'ダッシュ', icon: <GridIcon /> },
  { to: '/tasks', label: 'タスクボード', shortLabel: 'ボード', icon: <BoardIcon /> },
  // 承認フローは独立ナビから外し、タスクボードページ内の「承認フロー」タブに統合した（/approvals は後方互換で残す）。
  // Vault は独立ナビから外し、ドキュメントページ内の「Vault」タブに統合した（/vault は後方互換で残す）。
  // RAG は独立ナビから外し、ドキュメントページ内の「RAG」タブに統合した（/notebooks は後方互換で残す）。
  { to: '/deliverables', label: 'ドキュメント', shortLabel: 'ドキュ', icon: <DocumentsIcon /> },
  // PDF.ai（公開PDFエディタ）は廃止し関連画面/ルートを撤去した（2026-07-19 Keita）。
  // 動画DL（ClipItNow）はサイドメニューから外し、仕事ページの「動画DL」タブに集約した（2026-07-16 Keita）。
  // ライブサイトは https://clipitnow.net/（旧 videodl.apollomansion.com は301転送）。
  // 収益コックピットはダッシュボードの「収益」タブへ統合（2026-07-20 Keita・MC-317）。/revenue は後方互換。
  { to: '/childcare', label: '育児', shortLabel: '育児', icon: <BabyIcon /> },
  { to: '/chaji', label: '茶事', shortLabel: '茶事', icon: <ChajiIcon /> },
  { to: '/work', label: '仕事', shortLabel: '仕事', icon: <WorkIcon /> },
  // Claude は未使用のためサイドメニューから削除（2026-06-30 Keita）。/claude ルートは後方互換で残置。
  // スケジュールは未使用のためサイドメニューから削除（2026-06-29 Keita）。/schedule ルートは後方互換で残置。
  { to: '/dev', label: '開発', shortLabel: '開発', icon: <CodeIcon /> },
  // 成長日記は独立ナビから外し、育児ページ内の「成長日記」タブに統合した（/baby-diary は後方互換で残す）。
  // ターミナル: iframe ホスト用 React ルートは /terminal-view。
  // サーバ proxy ルート /terminal（→ ttyd）と衝突させないため別パスにする。
  { to: '/terminal-view', label: 'ターミナル', shortLabel: '端末', icon: <TerminalIcon /> },
];

/** ナビ項目の件数バッジ（0 なら非表示）。要承認件数をタスクボード（/tasks）に出す。 */
function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums"
      style={{ color: 'var(--mc-bg)', background: 'var(--mc-blocked)' }}
      aria-label={`要承認 ${count} 件`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

// ─── 全画面トグル（MC-321）───────────────────────────────────────────
// ブラウザのタブ・URL バーごと隠す Fullscreen API のトグル。Esc（またはもう一度クリック）で
// 元に戻る。ブラウザ仕様上、全画面への移行はユーザー操作（クリック）起点でのみ許可される。
function useFullscreen(): [boolean, () => void] {
  const [active, setActive] = useState<boolean>(
    () => typeof document !== 'undefined' && !!document.fullscreenElement,
  );
  useEffect(() => {
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);
  return [active, toggle];
}

function FullscreenButton({ compact }: { compact?: boolean }) {
  const [active, toggle] = useFullscreen();
  const label = active ? '全画面を解除（Esc）' : '全画面表示';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className={
        compact
          ? 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text'
          : 'flex items-center gap-2 text-[11px] text-text-muted hover:text-text rounded px-1 -ml-1 py-0.5 transition-colors'
      }
    >
      <span aria-hidden>
        {active ? (
          <ShrinkIcon width={13} height={13} />
        ) : (
          <ExpandIcon width={13} height={13} />
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

function Sidebar({
  badges,
  open,
  onToggle,
  navItems,
  onReorder,
  onSettingsClick,
  onSearchClick,
}: {
  badges: Partial<Record<string, number>>;
  open: boolean;
  onToggle: () => void;
  navItems: NavItem[];
  onReorder: (next: NavItem[]) => void;
  onSettingsClick: () => void;
  onSearchClick: () => void;
}) {
  const { pathname } = useLocation();
  const dashActive = isDashboardPath(pathname);

  // 折りたたみ時: サイドバーをレイアウトから完全に外す（細い縦ラインも消す）。
  // 本文を全幅で使えるよう、開くための小さなトグルだけを左上に fixed で浮かせる（2026-06-27 Keita）。
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="サイドバーを開く"
        className="fixed left-1 top-2.5 z-40 hidden rounded-md border border-border bg-surface/90 p-1 text-text-muted shadow-sm backdrop-blur hover:bg-surface-2 hover:text-text md:block"
      >
        {/* › */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    );
  }

  return (
    <aside
      className="hidden shrink-0 flex-col border-r border-border bg-surface md:flex"
      // 幅は設定モーダルで選択可変（MC-322）。--sidebar-width は useSidebarWidth が適用する。
      style={{ width: 'var(--sidebar-width, 224px)' }}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-accent" aria-hidden>
            <ApolloMark width={22} height={22} />
          </span>
          <div>
            <div className="text-sm font-bold leading-tight text-text">Apollo</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="サイドバーを閉じる"
          className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
        >
          {/* ‹ */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      {/* 検索は下部フッター（左下）へ移動した（2026-06-27 Keita）。 */}
      {/* ナビ一覧は min-h-0 + overflow-y-auto でスクロール可能にし、低いウィンドウでも
          下のフッター（検索・設定・再読み込み）が画面外に押し出されないようにする。 */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        <SortableNav items={navItems} onReorder={onReorder} direction="vertical">
          {(item: NavItem, handle: DragHandleProps) => {
            const forceActive = item.to === '/' && dashActive;
            const badge = badges[item.to] ?? 0;
            if (item.external) {
              // 独立サイト（/site/ 等）は React ルート外なので実リンクで別タブに開く。
              return (
                <a
                  key={item.to}
                  href={item.to}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                  <DragHandle handleProps={handle.handleProps} className="ml-auto opacity-0 group-hover:opacity-100" />
                </a>
              );
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive || forceActive
                      ? 'bg-surface-3 font-semibold text-text'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  }`
                }
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
                <NavBadge count={badge} />
                <DragHandle handleProps={handle.handleProps} className="ml-auto opacity-0 group-hover:opacity-100" />
              </NavLink>
            );
          }}
        </SortableNav>
      </nav>
      <div className="shrink-0 border-t border-border px-5 py-3 flex flex-col gap-2">
        {/* 横断検索（MC-73）。表示整理のため左下フッターへ集約。Cmd/Ctrl+K でも開く。 */}
        <button
          type="button"
          onClick={onSearchClick}
          aria-label="横断検索を開く"
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-faint hover:bg-surface-3 hover:text-text transition-colors"
        >
          <span aria-hidden>
            <SearchIcon width={14} height={14} />
          </span>
          <span className="flex-1 text-left">検索</span>
          <kbd className="rounded border border-border px-1 text-[10px] text-text-muted">⌘K</kbd>
        </button>
        {/* 設定ボタン（MC-178） */}
        <button
          type="button"
          onClick={onSettingsClick}
          aria-label="設定を開く"
          className="flex items-center gap-2 text-[11px] text-text-muted hover:text-text rounded px-1 -ml-1 py-0.5 transition-colors"
        >
          <span aria-hidden>
            <SettingsIcon width={13} height={13} />
          </span>
          <span>設定</span>
        </button>
        {/* 全画面トグル（MC-321）。ブラウザのタブ・URLバーごと隠す。Esc で復帰。 */}
        <FullscreenButton />
        {/* 接続状態表示（ライブ接続中）は不要のため撤去（2026-06-27 Keita）。 */}
        {/* 再読み込み（リロード）ボタン。サイドメニュー最下部・ページ全体を再読み込みする。 */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          aria-label="ページを再読み込み"
          className="flex items-center gap-2 text-[11px] text-text-muted hover:text-text rounded px-1 -ml-1 py-0.5 transition-colors"
        >
          <span aria-hidden>
            <RestoreIcon width={13} height={13} />
          </span>
          <span>再読み込み</span>
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const { ticks } = useLiveStream();
  const { data: approvals } = useLiveResource<ApprovalsResponse>('/api/approvals', ticks.tasks);
  const approvalCount = approvals?.total ?? 0;

  // フォントサイズ設定（MC-178）
  const { fontPx } = useFontSize();
  // サイドメニュー幅設定（MC-322）。起動時に保存値を CSS 変数へ適用する。
  useSidebarWidth();
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Cmd/Ctrl+K で横断検索を開閉。入力欄にフォーカス中でも効く（検索はグローバル機能のため）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Vault / Deliverables の通知バッジは廃止（2026-06-25 Keita「消えない」）。
  // watch.ts が obsidian-vault / deliverables の変更を監視しており、ニュース生成・各エージェント・
  // 同期などで vault が変わるたびに update が流れてバッジが加算される。ドキュメントページに常駐
  // しない限り消えず、モバイルのメニュー合計バッジが残り続けていた。ノイズ通知のため取りやめる
  // （「エージェント通知は出さない」方針に揃える）。溜まった localStorage バッジも一度掃除する。
  useEffect(() => {
    try {
      localStorage.removeItem('badge./vault');
      localStorage.removeItem('badge./deliverables');
    } catch {
      /* localStorage 不可環境では無視 */
    }
  }, []);

  const badges: Partial<Record<string, number>> = {
    // 要承認件数のみ（タスクボードページのタブに統合）。Vault/Deliverables の通知は廃止。
    '/tasks': approvalCount,
  };

  const { mode: themeMode, isDark, setMode: setThemeMode } = useTheme();

  // ナビ並び順（サーバ保存・端末横断同期 MC-158）。サイドメニューと下部メニューは
  // 同じ NAV を描くので、並び順を1つ持てば desktop/mobile 両方に効く。
  const { items: navItems, reorder: reorderNav } = useNavOrder('sidebar', NAV);

  // ダッシュボード（/）をタップした時の既定着地は「カウントダウン」。
  // DashboardLayout で並べ替え不可の固定先頭タブにしているので、保存順に依らず常にここへ着地する。
  const dashboardLanding = '/countdown';

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem('apollo-sidebar-open') !== 'false';
  });
  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('apollo-sidebar-open', String(next));
      return next;
    });
  };

  // /terminal-standalone はサイドバー・ナビなしでターミナルのみ表示
  if (pathname === '/terminal-standalone') {
    return (
      <div className="h-dvh overflow-hidden bg-bg text-text" style={{ overscrollBehavior: 'none' }}>
        <Suspense fallback={<ViewFallback />}>
          <Terminal />
        </Suspense>
      </div>
    );
  }

  return (
    <LiveContext.Provider value={{ ticks }}>
      <UploadProvider>
        <div className="flex h-dvh overflow-hidden bg-bg text-text" style={{ '--font-scale': String(fontPx / 16) } as any}>
          <Sidebar
            badges={badges}
            open={sidebarOpen}
            onToggle={toggleSidebar}
            navItems={navItems}
            onReorder={reorderNav}
            onSettingsClick={() => setShowSettings(true)}
            onSearchClick={() => setShowSearch(true)}
          />
          <main className="dashboard-container flex-1 overflow-hidden">
            <Suspense fallback={<ViewFallback />}>
            <Routes>
              {/* ダッシュボード（/）配下に各タブを入れ子。各子ビューの URL は従来どおり。 */}
              {/* エージェントタブは / に統合。ティック+消費量は /activity に統合。 */}
              <Route element={<DashboardLayout />}>
                <Route
                  path="/"
                  element={<Navigate to={dashboardLanding} replace />}
                />
                {/* カウントダウン（ダッシュボードの固定先頭タブ／/ の既定着地先） */}
                <Route path="/countdown" element={<Countdown />} />
                {/* MC-317: エージェントはタスクボードの「エージェント」タブへ統合。後方互換でタブ着地。 */}
                <Route path="/feed" element={<Feed />} />
                <Route path="/news" element={<News />} />
                <Route path="/activity" element={<Activity />} />
                {/* 後方互換リダイレクト: 旧ティック/消費量 URL */}
                <Route path="/ticks" element={<Navigate to="/activity" replace />} />
                <Route path="/usage" element={<Navigate to="/activity" replace />} />
                {/* 旧 Agents ビュー: 参照は残すが / にリダイレクト */}
                <Route path="/agents" element={<Navigate to="/" replace />} />
                <Route path="/agents/:agentId" element={<Agents />} />
                <Route path="/plan-usage" element={<PlanUsage />} />
                {/* ClipItNow PDCA 可視化 */}
                <Route path="/pdca" element={<Pdca />} />
                {/* MC-317: 収益コックピットは独立ナビからダッシュボードのタブへ統合 */}
                <Route path="/revenue" element={<Revenue />} />
              </Route>
              {/* MC-317: 旧 /agents-live（ダッシュのエージェントタブ）はタスクボードのエージェントタブへ */}
              <Route path="/agents-live" element={<TasksTabs initialTab="agents" />} />
              <Route path="/tasks" element={<TasksTabs />} />
              {/* 承認フローは「タスクボード」ページの承認フロータブへ統合（旧 /approvals は後方互換でタブ着地）。 */}
              <Route path="/approvals" element={<TasksTabs initialTab="approvals" />} />
              {/* Vault は「ドキュメント」ページの Vault タブへ統合（旧 /vault は後方互換でタブ着地）。 */}
              <Route path="/vault" element={<DocumentsTabs initialTab="vault" />} />
              <Route path="/deliverables" element={<DocumentsTabs />} />
              {/* RAG は「ドキュメント」ページの RAG タブへ統合（旧 /notebooks は後方互換でタブ着地）。 */}
              <Route path="/notebooks" element={<DocumentsTabs initialTab="rag" />} />
              <Route path="/childcare" element={<Childcare />} />
              <Route path="/chaji" element={<Chaji />} />
              <Route path="/work" element={<Work />} />
              <Route path="/claude" element={<ClaudeChat />} />
              {/* 旧 /baby-diary は育児ページの「成長日記」タブに着地（古いリンク/ブックマーク互換）。 */}
              <Route path="/baby-diary" element={<Childcare initialTab="diary" />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/dev" element={<Development />} />
              {/* MC-317: 実装進捗はタスクボードの「実装進捗」タブへ統合（旧 /progress は後方互換でタブ着地）。 */}
              <Route path="/progress" element={<TasksTabs initialTab="progress" />} />
              <Route path="/terminal-view" element={<div className="flex h-full flex-col overflow-hidden"><Terminal /></div>} />
              <Route path="/terminal-view/:id" element={<div className="flex h-full flex-col overflow-hidden"><Terminal /></div>} />
              <Route path="/terminal-standalone" element={<Terminal />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </main>
          <BottomNav
            items={navItems}
            badges={badges}
            onReorder={reorderNav}
            footerActions={(close) => (
              <>
                {/* 横断検索（モバイル） */}
                <button
                  type="button"
                  onClick={() => { setShowSearch(true); close(); }}
                  aria-label="横断検索を開く"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <span className="shrink-0" aria-hidden>
                    <SearchIcon />
                  </span>
                  <span>検索</span>
                </button>
                {/* テーマ切替はモバイルメニューから外し、設定モーダルへ統合（2026-06-29 Keita）。 */}
                {/* 設定（デスクトップ footer と同じく設定モーダルを開く） */}
                <button
                  type="button"
                  onClick={() => { setShowSettings(true); close(); }}
                  aria-label="設定を開く"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <span className="shrink-0" aria-hidden>
                    <SettingsIcon />
                  </span>
                  <span>設定</span>
                </button>
                {/* 全画面トグル（MC-321）。Esc で復帰。 */}
                <FullscreenButton compact />
                {/* 再読み込み（リロード）。モバイルのメニューからページ全体を再読み込みする。 */}
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  aria-label="ページを再読み込み"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <span className="shrink-0" aria-hidden>
                    <RestoreIcon />
                  </span>
                  <span>再読み込み</span>
                </button>
              </>
            )}
          />
          {pathname === '/tasks' && <AddTaskFab />}
          <UploadToast />
          <Settings
            open={showSettings}
            onClose={() => setShowSettings(false)}
            themeMode={themeMode}
            isDark={isDark}
            onThemeChange={setThemeMode}
          />
          <GlobalSearch open={showSearch} onClose={() => setShowSearch(false)} />
        </div>
      </UploadProvider>
    </LiveContext.Provider>
  );
}
