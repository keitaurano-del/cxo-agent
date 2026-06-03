// ダッシュボード（/）配下の 5 タブを束ねるレイアウト（MC-76）。
// タブバー（俯瞰 / 今日 / 会話 / エージェント / 消費量）+ <Outlet/> で
// 各ビュー本体を差し込む。子ビューの URL（/today /feed /agents /usage /agents/:id）は
// そのまま温存され、deep link・SSE・横断検索からの遷移に影響しない。
// PC は横並び tablist、モバイルは横スクロール（Tasks のステータスタブと同じパターン）。
import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { GridIcon, NoteIcon, StreamIcon, UsersIcon, UsageIcon, LoopIcon, GaugeIcon } from './icons';

interface DashTab {
  to: string;
  label: string;
  icon: ReactNode;
}

// 俯瞰だけ index ルート（/）なので end で完全一致にする。
const DASH_TABS: DashTab[] = [
  { to: '/', label: '俯瞰', icon: <GridIcon width={16} height={16} /> },
  { to: '/today', label: '今日', icon: <NoteIcon width={16} height={16} /> },
  { to: '/feed', label: '会話', icon: <StreamIcon width={16} height={16} /> },
  { to: '/agents', label: 'エージェント', icon: <UsersIcon width={16} height={16} /> },
  { to: '/ticks', label: 'ティック', icon: <LoopIcon width={16} height={16} /> },
  { to: '/usage', label: '消費量', icon: <UsageIcon width={16} height={16} /> },
  { to: '/plan-usage', label: 'Claude', icon: <GaugeIcon width={16} height={16} /> },
];

export default function DashboardLayout() {
  return (
    <div className="flex h-full flex-col">
      <nav
        className="border-b border-border bg-bg/95 px-4 py-2 backdrop-blur md:px-6"
        aria-label="ダッシュボードのタブ"
      >
        <div
          className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1"
          role="tablist"
        >
          {DASH_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              role="tab"
              className={({ isActive }) =>
                `inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs transition-colors md:py-1.5 ${
                  isActive
                    ? 'bg-surface-3 font-semibold text-text'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text'
                }`
              }
            >
              <span aria-hidden>{tab.icon}</span>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
      {/* 子ビュー本体。Tasks 等の flex-1 レイアウトを壊さないよう min-h-0 で内側スクロールを許可。 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
