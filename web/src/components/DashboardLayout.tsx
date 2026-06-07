// ダッシュボード（/）配下のタブを束ねるレイアウト（MC-76）。
// タブバー（Claude / 使用量 / ニュース / ブリーフィング）+ <Outlet/> で
// 各ビュー本体を差し込む。子ビューの URL は deep link・SSE・横断検索からの遷移に影響しない。
// PC は横並び tablist、モバイルは横スクロール（Tasks のステータスタブと同じパターン）。
import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { NoteIcon, ActivityIcon, GaugeIcon, NewsIcon, UsersIcon } from './icons';
import { SortableNav, DragHandle } from './SortableNav';
import { useNavOrder } from '../lib/useNavOrder';

interface DashTab {
  to: string;
  label: string;
  icon: ReactNode;
}

const DASH_TABS: DashTab[] = [
  { to: '/agents-live', label: 'エージェント', icon: <UsersIcon width={16} height={16} /> },
  { to: '/plan-usage', label: 'Claude', icon: <GaugeIcon width={16} height={16} /> },
  { to: '/activity', label: '使用量', icon: <ActivityIcon width={16} height={16} /> },
  { to: '/news', label: 'ニュース', icon: <NewsIcon width={16} height={16} /> },
  { to: '/today', label: 'ブリーフィング', icon: <NoteIcon width={16} height={16} /> },
];

export default function DashboardLayout() {
  // タブの並び順をサーバ保存して端末横断同期（MC-158）。
  const { items: tabs, reorder } = useNavOrder('dashboard', DASH_TABS);

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
          <SortableNav items={tabs} onReorder={reorder} direction="horizontal">
            {(tab, handle) => (
              // group: hover でハンドルを表示（デスクトップ）。モバイルは下の md:hidden で常時表示。
              <div className="group inline-flex shrink-0 items-center">
                <NavLink
                  to={tab.to}
                  end={tab.to === '/today'}
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
                {/* ハンドル: デスクトップは hover 表示、モバイルは常時表示。掴んだ時だけドラッグ。 */}
                <DragHandle
                  handleProps={handle.handleProps}
                  className="-ml-0.5 shrink-0 p-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                />
              </div>
            )}
          </SortableNav>
        </div>
      </nav>
      {/* 子ビュー本体。Tasks 等の flex-1 レイアウトを壊さないよう min-h-0 で内側スクロールを許可。 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
