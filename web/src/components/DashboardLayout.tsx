// ダッシュボード（/）配下のタブを束ねるレイアウト（MC-76）。
// タブバー（Claude / 使用量 / ニュース / ブリーフィング）+ <Outlet/> で
// 各ビュー本体を差し込む。子ビューの URL は deep link・SSE・横断検索からの遷移に影響しない。
// PC は横並び tablist、モバイルは横スクロール（Tasks のステータスタブと同じパターン）。
// 既定表示は「カウントダウン」（/ クリック時の着地は App.tsx の dashboardLanding で固定）。
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ClockIcon, GaugeIcon, LoopIcon, NewsIcon, UsageIcon } from './icons';
import { SortableNav, DragHandle } from './SortableNav';
import { useNavOrder } from '../lib/useNavOrder';

// 子ビューがタブ行の右端へ操作ボタン（再読込など）を差し込むための slot。
// 専用のヘッダ帯（1行）を消費せず、既存のダッシュタブ行に同居させる（2026-07-20 Keita「読み込みで1行使うな」）。
type DashOutletContext = { setActions: (node: ReactNode) => void };

/** 子ビューから呼ぶ: node をダッシュタブ行の右端に表示。node は useMemo で安定させること（毎レンダ更新でループ回避）。 */
export function useDashActions(node: ReactNode): void {
  const ctx = useOutletContext<DashOutletContext | null>();
  useEffect(() => {
    if (!ctx) return;
    ctx.setActions(node);
    return () => ctx.setActions(null);
  }, [ctx, node]);
}

interface DashTab {
  to: string;
  label: string;
  icon: ReactNode;
}

// カウントダウンは常に「一番左」に固定（並べ替え対象外）。タップ時の既定着地でもある。
const PINNED_TAB: DashTab = {
  to: '/countdown',
  label: 'カウントダウン',
  icon: <ClockIcon width={16} height={16} />,
};

const DASH_TABS: DashTab[] = [
  // エージェントはタスクボードの「エージェント」タブへ統合（2026-07-20 Keita・MC-317）。/agents-live は後方互換。
  // 使用量（/activity）はあまり見ないため非表示（2026-07-20 Keita・MC-317）。ルートは後方互換で残置。
  { to: '/plan-usage', label: 'Claude', icon: <GaugeIcon width={16} height={16} /> },
  { to: '/news', label: 'ニュース', icon: <NewsIcon width={16} height={16} /> },
  // 収益コックピットは独立ナビからダッシュボードのタブへ統合（2026-07-20 Keita・MC-317）。
  { to: '/revenue', label: '収益', icon: <UsageIcon width={16} height={16} /> },
  { to: '/pdca', label: 'PDCA', icon: <LoopIcon width={16} height={16} /> },
];

export default function DashboardLayout() {
  // タブの並び順をサーバ保存して端末横断同期（MC-158）。
  const { items: tabs, reorder } = useNavOrder('dashboard', DASH_TABS);
  // 子ビューがタブ行右端へ差し込む操作ボタン（再読込など）。
  const [actions, setActions] = useState<ReactNode>(null);
  const setDashActions = useCallback((node: ReactNode) => setActions(node), []);

  return (
    <div className="flex h-full flex-col">
      <nav
        className="flex items-center gap-2 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur md:px-6"
        aria-label="ダッシュボードのタブ"
      >
        <div
          className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1"
          role="tablist"
        >
          {/* 固定タブ（カウントダウン）: 並べ替え不可・常に先頭 */}
          <NavLink
            to={PINNED_TAB.to}
            role="tab"
            className={({ isActive }) =>
              `inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs transition-colors md:py-1.5 ${
                isActive
                  ? 'bg-surface-3 font-semibold text-text'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text'
              }`
            }
          >
            <span aria-hidden>{PINNED_TAB.icon}</span>
            {PINNED_TAB.label}
          </NavLink>
          <SortableNav items={tabs} onReorder={reorder} direction="horizontal">
            {(tab, handle) => (
              // group: hover でハンドルを表示（デスクトップ）。モバイルは下の md:hidden で常時表示。
              <div className="group inline-flex shrink-0 items-center">
                <NavLink
                  to={tab.to}
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
        {actions && <div className="shrink-0">{actions}</div>}
      </nav>
      {/* 子ビュー本体。Tasks 等の flex-1 レイアウトを壊さないよう min-h-0 で内側スクロールを許可。 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet context={{ setActions: setDashActions } satisfies DashOutletContext} />
      </div>
    </div>
  );
}
