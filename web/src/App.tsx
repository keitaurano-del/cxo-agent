// Apollo — アプリシェル（左ナビ + ヘッダ + ルート）。
// トップナビは 4 項目に集約（MC-76）: ダッシュボード / タスクボード / 承認フロー / Vault。
// ダッシュボード（/）配下に俯瞰・今日・会話・エージェント・消費量の 5 タブを入れ子で持つ。
// 子ビューの URL（/today /feed /agents /usage /agents/:id）は温存し、deep link・SSE・
// 横断検索からの遷移に影響を出さない。
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
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
  NotebookIcon,
  TerminalIcon,
  SunIcon,
  MoonIcon,
  ChatIcon,
} from './components/icons';
import DashboardLayout from './components/DashboardLayout';
import { isDashboardPath } from './lib/nav';
import Agents from './views/Agents';
import Activity from './views/Activity';
import Feed from './views/Feed';
import Tasks from './views/Tasks';
import Narrative from './views/Narrative';
import News from './views/News';
import Vault from './views/Vault';
import Deliverables from './views/Deliverables';
import Notebooks from './views/Notebooks';
import PlanUsage from './views/PlanUsage';
import Approvals from './views/Approvals';
import Terminal from './views/Terminal';
import Chat from './views/Chat';
import BottomNav from './components/BottomNav';
import { SortableNav, DragHandle } from './components/SortableNav';
import type { DragHandleProps } from './components/SortableNav';
import { useNavOrder } from './lib/useNavOrder';
import AddTaskFab from './components/AddTaskFab';
import { UploadProvider } from './lib/UploadContext';
import { UploadToast } from './components/UploadToast';
import { UpdateToast, fireUpdateToast } from './components/UpdateToast';

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
  { to: '/deliverables', label: 'フォルダ', shortLabel: 'フォルダ', icon: <DocumentsIcon /> },
  { to: '/notebooks', label: 'ノートブック', shortLabel: 'ノート', icon: <NotebookIcon /> },
  { to: '/chat', label: 'チャット', shortLabel: 'チャット', icon: <ChatIcon /> },
  // ターミナル: iframe ホスト用 React ルートは /terminal-view。
  // サーバ proxy ルート /terminal（→ ttyd）と衝突させないため別パスにする。
  { to: '/terminal-view', label: 'ターミナル', shortLabel: '端末', icon: <TerminalIcon /> },
];

/** ナビ項目の件数バッジ（0 なら非表示）。承認フロー（/approvals）で使う。 */
function NavBadge({ count, dot }: { count: number; dot?: boolean }) {
  if (count <= 0) return null;
  if (dot) {
    // チャット未読: 青い数字バッジ（ドットより目立つ）
    return (
      <span
        className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums"
        style={{ color: '#fff', background: '#3b82f6' }}
        aria-label={`未読 ${count} 件`}
      >
        {count > 99 ? '99+' : count}
      </span>
    );
  }
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
                <NavBadge count={badge} dot={item.to === '/chat'} />
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

  // チャット未読数: チャンネル別に管理し、/chat 表示中でも他チャンネルの未読を保持する。
  // localStorage に { channelId: lastSeenTs } を保存して未読を計算する。
  const [chatUnread, setChatUnread] = useState(() => {
    const saved = parseInt(localStorage.getItem('chat.unreadBadge') ?? '0', 10);
    return isNaN(saved) ? 0 : saved;
  });
  // Chat.tsx が選択中チャンネルを書き込む key: 'chat.activeChannel'
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // /chat 以外に移動したらバッジはそのまま（他画面からでも見えるように）
  // /chat に戻ったらリセットはしない — Chat.tsx 側でチャンネルを開いた時に per-channel でリセット
  useEffect(() => {
    const handler = () => {
      // Chat.tsx が 'chat.unreadBadge' を更新したら同期
      const saved = parseInt(localStorage.getItem('chat.unreadBadge') ?? '0', 10);
      setChatUnread(isNaN(saved) ? 0 : saved);
    };
    window.addEventListener('chat-badge-update', handler);
    return () => window.removeEventListener('chat-badge-update', handler);
  }, []);

  useEffect(() => {
    // SSE 接続は一度だけ（マウント時のみ）。
    const es = new EventSource('/api/stream');
    es.addEventListener('chat', (e) => {
      // event.data から channelId・送信者・テキストを取得
      let channelId = '';
      let senderName = '';
      let senderName_key = '';
      let text = '';
      try {
        const d = JSON.parse((e as MessageEvent).data) as { channelId?: string; message?: { senderName?: string; senderId?: string; text?: string } };
        channelId = d.channelId ?? '';
        senderName = d.message?.senderName ?? '';
        senderName_key = d.message?.senderId ?? '';
        text = d.message?.text ?? '';
      } catch { /* ignore */ }

      // 現在アクティブなチャンネルへのメッセージなら増やさない
      const activeChannel = localStorage.getItem('chat.activeChannel') ?? '';
      const isOnChatPage = pathnameRef.current === '/chat';
      if (isOnChatPage && channelId && channelId === activeChannel) return;

      // MC-159: バッジ加算条件を絞る。
      // Keita（senderId='keita'）以外はすべてエージェント/自動発信者とみなし加算しない。
      // 例外: メッセージに @keita/@Keita のメンションが含まれる場合は加算する（要注意通知）。
      const isKeitaMessage = senderName_key === 'keita';
      const isMentioningKeita = text.includes('@keita') || text.includes('@Keita');

      // バッジ加算: Keita 自身の発言（通常は自分のを数えないが一応）か @keita メンションのみ
      // 実質的には「エージェントが @keita と呼びかけた時だけ」通知する
      if (isKeitaMessage || isMentioningKeita) {
        setChatUnread((n) => {
          const next = n + 1;
          localStorage.setItem('chat.unreadBadge', String(next));
          return next;
        });
      }

      // チャットトースト（MC-159: @keita メンションのみ表示。自動チャッター間の会話は除外）
      if (isMentioningKeita || isKeitaMessage) {
        const channelLabel = channelId ? `#${channelId}` : 'チャット';
        const detail = senderName
          ? `${senderName}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`
          : text.slice(0, 60) || undefined;
        fireUpdateToast({ id: `chat-${channelId}`, emoji: '💬', label: channelLabel, detail, navTo: '/chat' });
      }
    });
    es.onerror = () => { /* 自動再接続 */ };
    return () => es.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ページ別バッジ: SSE update イベントの type → nav path にマッピング
  // ページを訪問したら badge.{path} を 0 にリセットする
  // tasks バッジは不要（MC-159）
  const NAV_BADGE_MAP: Record<string, string> = {
    vault: '/vault',
    deliverables: '/deliverables',
    agents: '/',
  };
  const UPDATE_TOAST_META: Record<string, { emoji: string; label: string }> = {
    vault:        { emoji: '📚', label: 'Vault が更新されました' },
    deliverables: { emoji: '📁', label: 'フォルダが更新されました' },
    agents:       { emoji: '🤖', label: 'エージェント更新' },
    narrative:    { emoji: '📰', label: 'ブリーフィングが更新されました' },
  };
  const loadBadge = (path: string) => parseInt(localStorage.getItem(`badge.${path}`) ?? '0', 10) || 0;
  const [navBadges, setNavBadges] = useState<Record<string, number>>(() => ({
    '/vault': loadBadge('/vault'),
    '/deliverables': loadBadge('/deliverables'),
    '/': loadBadge('/'),
  }));

  // ページ訪問時にそのバッジをリセット
  useEffect(() => {
    const path = pathname === '/' || pathname.startsWith('/feed') || pathname.startsWith('/agents') || pathname.startsWith('/today') ? '/' : pathname;
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
          const isActive = !navPath ? false : navPath === '/'
            ? cur === '/' || cur.startsWith('/feed') || cur.startsWith('/agents') || cur.startsWith('/today')
            : cur.startsWith(navPath);

          if (navPath && !isActive) {
            setNavBadges((prev) => {
              const next = (prev[navPath] ?? 0) + 1;
              localStorage.setItem(`badge.${navPath}`, String(next));
              return { ...prev, [navPath]: next };
            });
          }

          // トースト（ページ表示中でも表示 — 何が変わったか一瞬分かるように）
          const meta = UPDATE_TOAST_META[type];
          if (meta) {
            fireUpdateToast({ id: `update-${type}`, emoji: meta.emoji, label: meta.label, navTo: navPath });
          }
        }
      } catch { /* ignore */ }
    });
    es2.onerror = () => { /* 自動再接続 */ };
    return () => es2.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const badges: Partial<Record<string, number>> = {
    '/approvals': approvalCount,
    '/chat': chatUnread,
    ...navBadges,
  };

  const { mode: themeMode, isDark, toggle: toggleTheme } = useTheme();

  // ナビ並び順（サーバ保存・端末横断同期 MC-158）。サイドメニューと下部メニューは
  // 同じ NAV を描くので、並び順を1つ持てば desktop/mobile 両方に効く。
  const { items: navItems, reorder: reorderNav } = useNavOrder('sidebar', NAV);

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
        <Terminal />
      </div>
    );
  }

  return (
    <LiveContext.Provider value={{ ticks }}>
      <UploadProvider>
        <div className="flex h-dvh overflow-hidden bg-bg text-text">
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
          />
          <main className="flex-1 overflow-hidden">
            <Routes>
              {/* ダッシュボード（/）配下に各タブを入れ子。各子ビューの URL は従来どおり。 */}
              {/* エージェントタブは / に統合。ティック+消費量は /activity に統合。 */}
              <Route element={<DashboardLayout />}>
                <Route path="/" element={<Navigate to="/today" replace />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/today" element={<Narrative />} />
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
              <Route path="/notebooks" element={<Notebooks />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/terminal-view" element={<div className="flex h-full flex-col overflow-hidden"><Terminal /></div>} />
              <Route path="/terminal-standalone" element={<Terminal />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <BottomNav items={navItems} badges={badges} onReorder={reorderNav} />
          {pathname === '/tasks' && <AddTaskFab />}
          <UploadToast />
          <UpdateToast />
        </div>
      </UploadProvider>
    </LiveContext.Provider>
  );
}
