// モバイル（< md）専用のボトムタブバー。サイドバーの代替。
// NAV 配列を流用し、アイコン + 短ラベルを項目数で等幅表示する（MC-76 で 4 項目に集約）。
// サブ項目（俯瞰/今日/会話/エージェント/消費量）はここに出さず、ダッシュボードのタブ帯に集約する。
import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { isDashboardPath } from '../lib/nav';

export interface BottomNavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}

export default function BottomNav({
  items,
  badges = {},
}: {
  items: BottomNavItem[];
  badges?: Partial<Record<string, number>>;
}) {
  const { pathname } = useLocation();
  // ダッシュボード配下のタブ（/today 等）にいる間も「ダッシュボード」をアクティブ表示にする。
  const dashActive = isDashboardPath(pathname);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="主要ナビゲーション"
    >
      {/* 項目数に応じて等幅に割り付ける（4 項目・390px で約 97px/列、shortLabel で詰める）。 */}
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const forceActive = item.to === '/' && dashActive;
          const badge = badges[item.to] ?? 0;
          return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] transition-colors ${
                  isActive || forceActive ? 'text-accent' : 'text-text-muted'
                }`
              }
            >
              <span className="relative" aria-hidden>
                {item.icon}
                {badge > 0 && (
                  <span
                    className="absolute -right-2 -top-1.5 inline-flex min-w-[1rem] items-center justify-center rounded-full px-1 py-0.5 text-[9px] font-bold leading-none tabular-nums"
                    style={{ color: 'var(--mc-bg)', background: 'var(--mc-blocked)' }}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="leading-none">
                {item.shortLabel}
                {badge > 0 && <span className="sr-only">（要承認 {badge} 件）</span>}
              </span>
            </NavLink>
          </li>
          );
        })}
      </ul>
    </nav>
  );
}
