// Apollo — アプリシェル（左ナビ + ヘッダ + ルート）。
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useLiveStream } from './lib/useLiveData';
import { LiveContext } from './lib/liveContext';
import {
  BoardIcon,
  GridIcon,
  NoteIcon,
  StreamIcon,
  UsersIcon,
  DotIcon,
  VaultIcon,
  UsageIcon,
} from './components/icons';
import Overview from './views/Overview';
import Agents from './views/Agents';
import Feed from './views/Feed';
import Tasks from './views/Tasks';
import Narrative from './views/Narrative';
import Vault from './views/Vault';
import Usage from './views/Usage';
import BottomNav from './components/BottomNav';
import AddTaskFab from './components/AddTaskFab';

interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}

const NAV: NavItem[] = [
  { to: '/', label: '司令塔', shortLabel: '司令塔', icon: <GridIcon /> },
  { to: '/agents', label: 'エージェント', shortLabel: '体', icon: <UsersIcon /> },
  { to: '/feed', label: '会話', shortLabel: '会話', icon: <StreamIcon /> },
  { to: '/tasks', label: 'タスクボード', shortLabel: 'ボード', icon: <BoardIcon /> },
  { to: '/today', label: '今日', shortLabel: '今日', icon: <NoteIcon /> },
  { to: '/usage', label: '消費量', shortLabel: '消費', icon: <UsageIcon /> },
  { to: '/vault', label: 'Vault', shortLabel: 'Vault', icon: <VaultIcon /> },
];

function Sidebar({ connected }: { connected: boolean }) {
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
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-surface-3 font-semibold text-text'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text'
              }`
            }
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
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
  return (
    <LiveContext.Provider value={{ ticks }}>
      <div className="flex h-screen overflow-hidden bg-bg text-text">
        <Sidebar connected={connected} />
        <main className="flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/:agentId" element={<Agents />} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/today" element={<Narrative />} />
            <Route path="/usage" element={<Usage />} />
            <Route path="/vault" element={<Vault />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav items={NAV} />
        <AddTaskFab />
      </div>
    </LiveContext.Provider>
  );
}
