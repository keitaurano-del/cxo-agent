// Apollo — アプリシェル（左ナビ + ヘッダ + ルート）。
// トップナビは 4 項目に集約（MC-76）: ダッシュボード / タスクボード / 承認フロー / Vault。
// ダッシュボード（/）配下に俯瞰・今日・会話・エージェント・消費量の 5 タブを入れ子で持つ。
// 子ビューの URL（/today /feed /agents /usage /agents/:id）は温存し、deep link・SSE・
// 横断検索からの遷移に影響を出さない。
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { useLiveStream, useLiveResource } from './lib/useLiveData';
import { LiveContext } from './lib/liveContext';
import type { ApprovalsResponse } from './lib/types';
import {
  BoardIcon,
  GridIcon,
  ApprovalIcon,
  DotIcon,
  VaultIcon,
  DocumentsIcon,
  SlidesIcon,
  SparkIcon,
  TerminalIcon,
  SunIcon,
  MoonIcon,
  SettingsIcon,
} from './components/icons';
import DashboardLayout from './components/DashboardLayout';
import { isDashboardPath } from './lib/nav';
// 着地ビュー（/ の最初に出る画面）は eager のまま first paint を遅らせない。
import AgentsLive from './views/AgentsLive';
// それ以外の二次的なビューは route 単位で遅延ロードし、初回エントリJSから切り離す（MC-194）。
const Agents = lazy(() => import('./views/Agents'));
const Activity = lazy(() => import('./views/Activity'));
const Feed = lazy(() => import('./views/Feed'));
const Tasks = lazy(() => import('./views/Tasks'));
const News = lazy(() => import('./views/News'));
const Vault = lazy(() => import('./views/Vault'));
const Deliverables = lazy(() => import('./views/Deliverables'));
const SlideTemplates = lazy(() => import('./views/SlideTemplates'));
const Notebooks = lazy(() => import('./views/Notebooks'));
const PlanUsage = lazy(() => import('./views/PlanUsage'));
const Approvals = lazy(() => import('./views/Approvals'));
const Terminal = lazy(() => import('./views/Terminal'));
import BottomNav from './components/BottomNav';
import { SortableNav, DragHandle } from './components/SortableNav';
import type { DragHandleProps } from './components/SortableNav';
import { useNavOrder } from './lib/useNavOrder';
import AddTaskFab from './components/AddTaskFab';
import { UploadProvider } from './lib/UploadContext';
import { UploadToast } from './components/UploadToast';
import Settings from './components/Settings';
import { useFontSize } from './lib/useFontSize';

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
function useTheme(): { mode: ThemeMode; isDark: boolean; toggle: () => void } {
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

  return { mode, isDark, toggle };
}

// ---- ナビ ----
interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}

const NAV: NavItem[] = [
  { to: '/', label: 'ダッシュボード', shortLabel: 'ダッシュ', icon: <GridIcon /> },
  { to: '/tasks', label: 'タスクボード', shortLabel: 'ボード', icon: <BoardIcon /> },
  { to: '/approvals', label: '承認フロー', shortLabel: '承認', icon: <ApprovalIcon /> },
  { to: '/vault', label: 'Vault', shortLabel: 'Vault', icon: <VaultIcon /> },
  { to: '/deliverables', label: 'ドキュメント', shortLabel: 'ドキュ', icon: <DocumentsIcon /> },
  { to: '/slide-templates', label: 'スライド型', shortLabel: '型', icon: <SlidesIcon /> },
  { to: '/notebooks', label: 'RAG', shortLabel: 'RAG', icon: <SparkIcon /> },
  // ターミナル: iframe ホスト用 React ルートは /terminal-view。
  // サーバ proxy ルート /terminal（→ ttyd）と衝突させないため別パスにする。
  { to: '/terminal-view', label: 'ターミナル', shortLabel: '端末', icon: <TerminalIcon /> },
];

/** ナビ項目の件数バッジ（0 なら非表示）。承認フロー（/approvals）で使う。 */
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

function Sidebar({
  connected,
  badges,
  open,
  onToggle,
  themeMode,
  isDark,
  onThemeToggle,
  navItems,
  onReorder,
  onSettingsClick,
}: {
  connected: boolean;
  badges: Partial<Record<string, number>>;
  open: boolean;
  onToggle: () => void;
  themeMode: ThemeMode;
  isDark: boolean;
  onThemeToggle: () => void;
  navItems: NavItem[];
  onReorder: (next: NavItem[]) => void;
  onSettingsClick: () => void;
}) {
  const { pathname } = useLocation();
  const dashActive = isDashboardPath(pathname);

  // 折りたたみ時: 細いストリップにトグルボタンだけ表示
  if (!open) {
    return (
      <aside className="hidden w-8 shrink-0 flex-col items-center border-r border-border bg-surface pt-3 md:flex">
        <button
          type="button"
          onClick={onToggle}
          aria-label="サイドバーを開く"
          className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
        >
          {/* › */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-accent" aria-hidden>
            <GridIcon width={22} height={22} />
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
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        <SortableNav items={navItems} onReorder={onReorder} direction="vertical">
          {(item: NavItem, handle: DragHandleProps) => {
            const forceActive = item.to === '/' && dashActive;
            const badge = badges[item.to] ?? 0;
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
      <div className="border-t border-border px-5 py-3 flex flex-col gap-2">
        {/* テーマトグル */}
        <button
          type="button"
          onClick={onThemeToggle}
          aria-label={`テーマ: ${themeMode === 'auto' ? '自動' : themeMode === 'dark' ? 'ダーク固定' : 'ライト固定'}`}
          className="flex items-center gap-2 text-[11px] text-text-muted hover:text-text rounded px-1 -ml-1 py-0.5 transition-colors"
        >
          <span aria-hidden>
            {isDark ? <MoonIcon width={13} height={13} /> : <SunIcon width={13} height={13} />}
          </span>
          <span>
            {themeMode === 'auto'
              ? `自動 (${isDark ? '夜間' : '日中'})`
              : themeMode === 'dark'
              ? 'ダーク固定'
              : 'ライト固定'}
          </span>
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
        {/* 接続状態 */}
        <div
          className="flex items-center gap-2 text-[11px]"
          role="status"
          aria-label={connected ? 'ライブ接続中' : 'ポーリング更新中'}
        >
          <span
            style={{ color: connected ? 'var(--mc-active)' : 'var(--mc-idle)' }}
            className={connected ? 'mc-pulse' : ''}
            aria-hidden
          >
            <DotIcon width={10} height={10} />
          </span>
          <span className="text-text-muted">
            {connected ? 'ライブ接続中' : 'ポーリング更新中'}
          </span>
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const { ticks, connected } = useLiveStream();
  const { data: approvals } = useLiveResource<ApprovalsResponse>('/api/approvals', ticks.tasks);
  const approvalCount = approvals?.total ?? 0;

  // フォントサイズ設定（MC-178）
  const { fontPx } = useFontSize();
  const [showSettings, setShowSettings] = useState(false);

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // ページ別バッジ: SSE update イベントの type → nav path にマッピング
  // ページを訪問したら badge.{path} を 0 にリセットする
  // tasks バッジは不要（MC-159）
  // エージェントの通知は出さない（Keita 指示）。agents 種別は SSE で流れ続けてよいが
  // ホーム '/' バッジには使わない。vault/deliverables のバッジ挙動は不変。
  const NAV_BADGE_MAP: Record<string, string> = {
    vault: '/vault',
    deliverables: '/deliverables',
  };
  const loadBadge = (path: string) => parseInt(localStorage.getItem(`badge.${path}`) ?? '0', 10) || 0;
  const [navBadges, setNavBadges] = useState<Record<string, number>>(() => ({
    '/vault': loadBadge('/vault'),
    '/deliverables': loadBadge('/deliverables'),
  }));

  // ページ訪問時にそのバッジをリセット
  useEffect(() => {
    const path = pathname;
    if (navBadges[path] > 0) {
      localStorage.setItem(`badge.${path}`, '0');
      setNavBadges((prev) => ({ ...prev, [path]: 0 }));
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE update イベントでバッジをインクリメント（表示中のページ以外）
  useEffect(() => {
    const es2 = new EventSource('/api/stream');
    es2.addEventListener('update', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { types?: string[] };
        for (const type of data.types ?? []) {
          const navPath = NAV_BADGE_MAP[type];
          // 現在そのページを見ていたら増やさない
          const cur = pathnameRef.current;
          const isActive = navPath ? cur.startsWith(navPath) : false;

          if (navPath && !isActive) {
            setNavBadges((prev) => {
              const next = (prev[navPath] ?? 0) + 1;
              localStorage.setItem(`badge.${navPath}`, String(next));
              return { ...prev, [navPath]: next };
            });
          }

        }
      } catch { /* ignore */ }
    });
    es2.onerror = () => { /* 自動再接続 */ };
    return () => es2.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const badges: Partial<Record<string, number>> = {
    '/approvals': approvalCount,
    ...navBadges,
  };

  const { mode: themeMode, isDark, toggle: toggleTheme } = useTheme();

  // ナビ並び順（サーバ保存・端末横断同期 MC-158）。サイドメニューと下部メニューは
  // 同じ NAV を描くので、並び順を1つ持てば desktop/mobile 両方に効く。
  const { items: navItems, reorder: reorderNav } = useNavOrder('sidebar', NAV);

  // ダッシュボード配下のタブ順序（MC-174）。初期表示の遷移先を決める。
  // NOTE: これは画面表示には使わず、初期リダイレクト判定だけに使う。
  const dashboardTabDefaults = [
    { to: '/agents-live' },
    { to: '/feed' },
    { to: '/news' },
    { to: '/activity' },
    { to: '/plan-usage' },
  ];
  const { items: dashboardTabs } = useNavOrder('dashboard', dashboardTabDefaults);

  // MC-165: / の着地先。エージェント擬人化ライブを最優先で着地先にする（要件: トップに大きく出す）。
  // 保存済みのタブ並び替えがあっても /agents-live を必ず先頭着地にし、過去の「見えない場所に作る」
  // 失敗を繰り返さない。/agents-live が無い異常時のみ保存順の先頭 → /plan-usage にフォールバック。
  const dashboardLanding = dashboardTabs.some((t) => t.to === '/agents-live')
    ? '/agents-live'
    : dashboardTabs.length > 0
      ? dashboardTabs[0].to
      : '/plan-usage';

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
            connected={connected}
            badges={badges}
            open={sidebarOpen}
            onToggle={toggleSidebar}
            themeMode={themeMode}
            isDark={isDark}
            onThemeToggle={toggleTheme}
            navItems={navItems}
            onReorder={reorderNav}
            onSettingsClick={() => setShowSettings(true)}
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
                {/* MC-165: エージェント擬人化ライブ（ダッシュボード先頭タブ／/ の着地先） */}
                <Route path="/agents-live" element={<AgentsLive />} />
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
              </Route>
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/vault" element={<Vault />} />
              <Route path="/deliverables" element={<Deliverables />} />
              <Route path="/slide-templates" element={<SlideTemplates />} />
              <Route path="/notebooks" element={<Notebooks />} />
              <Route path="/terminal-view" element={<div className="flex h-full flex-col overflow-hidden"><Terminal /></div>} />
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
                {/* テーマ切替（デスクトップ footer と同じハンドラ・アイコン） */}
                <button
                  type="button"
                  onClick={() => { toggleTheme(); close(); }}
                  aria-label={`テーマ切替: ${themeMode === 'auto' ? '自動' : themeMode === 'dark' ? 'ダーク固定' : 'ライト固定'}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <span className="shrink-0" aria-hidden>
                    {isDark ? <MoonIcon /> : <SunIcon />}
                  </span>
                  <span>
                    {themeMode === 'auto'
                      ? `自動 (${isDark ? '夜間' : '日中'})`
                      : themeMode === 'dark'
                      ? 'ダーク固定'
                      : 'ライト固定'}
                  </span>
                </button>
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
              </>
            )}
          />
          {pathname === '/tasks' && <AddTaskFab />}
          <UploadToast />
          <Settings open={showSettings} onClose={() => setShowSettings(false)} />
        </div>
      </UploadProvider>
    </LiveContext.Provider>
  );
}
