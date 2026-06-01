// Apollo — アプリシェル（左ナビ + ヘッダ + ルート）。
// トップナビは 4 項目に集約（MC-76）: ダッシュボード / タスクボード / 承認フロー / Vault。
// ダッシュボード（/）配下に俯瞰・今日・会話・エージェント・消費量の 5 タブを入れ子で持つ。
// 子ビューの URL（/today /feed /agents /usage /agents/:id）は温存し、deep link・SSE・
// 横断検索からの遷移に影響を出さない。
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useLiveStream, useLiveResource } from './lib/useLiveData';
import { LiveContext } from './lib/liveContext';
import type { ApprovalsResponse } from './lib/types';
import {
  BoardIcon,
  GridIcon,
  ApprovalIcon,
  DotIcon,
  VaultIcon,
  TerminalIcon,
} from './components/icons';
import DashboardLayout from './components/DashboardLayout';
import { isDashboardPath } from './lib/nav';
import Overview from './views/Overview';
import Agents from './views/Agents';
import Feed from './views/Feed';
import Tasks from './views/Tasks';
import Narrative from './views/Narrative';
import Vault from './views/Vault';
import Usage from './views/Usage';
import Ticks from './views/Ticks';
import Approvals from './views/Approvals';
import Terminal from './views/Terminal';
import BottomNav from './components/BottomNav';
import AddTaskFab from './components/AddTaskFab';

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
}: {
  connected: boolean;
  badges: Partial<Record<string, number>>;
}) {
  const { pathname } = useLocation();
  const dashActive = isDashboardPath(pathname);
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-2 px-5 py-4">
        <span className="text-accent" aria-hidden>
          <GridIcon width={22} height={22} />
        </span>
        <div>
          <div className="text-sm font-bold leading-tight text-text">Apollo</div>
          <div className="text-[10px] text-text-faint">開発状況リアルタイム可視化</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV.map((item) => {
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
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t border-border px-5 py-3">
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
        <div className="mt-1 text-[10px] text-text-faint">本機（このサーバ）の活動のみ表示</div>
      </div>
    </aside>
  );
}

export default function App() {
  const { ticks, connected } = useLiveStream();
  // 承認フローの総件数（ナビバッジ用）。tasks 由来なので tasks tick で再フェッチ。
  const { data: approvals } = useLiveResource<ApprovalsResponse>('/api/approvals', ticks.tasks);
  const approvalCount = approvals?.total ?? 0;
  const badges: Partial<Record<string, number>> = { '/approvals': approvalCount };
  return (
    <LiveContext.Provider value={{ ticks }}>
      <div className="flex h-screen overflow-hidden bg-bg text-text">
        <Sidebar connected={connected} badges={badges} />
        <main className="flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <Routes>
            {/* ダッシュボード（/）配下に 5 タブを入れ子。各子ビューの URL は従来どおり。 */}
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Overview />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/agents/:agentId" element={<Agents />} />
              <Route path="/feed" element={<Feed />} />
              <Route path="/today" element={<Narrative />} />
              <Route path="/ticks" element={<Ticks />} />
              <Route path="/usage" element={<Usage />} />
            </Route>
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/vault" element={<Vault />} />
            <Route path="/terminal-view" element={<Terminal />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav items={NAV} badges={badges} />
        <AddTaskFab />
      </div>
    </LiveContext.Provider>
  );
}
