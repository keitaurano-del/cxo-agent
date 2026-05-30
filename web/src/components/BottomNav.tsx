// モバイル（< md）専用のボトムタブバー。サイドバーの代替。
// NAV 配列を流用し、アイコン + 短ラベルを項目数で等幅表示する（現状 7 項目）。
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export interface BottomNavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}

export default function BottomNav({ items }: { items: BottomNavItem[] }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="主要ナビゲーション"
    >
      {/* 項目数に応じて等幅に割り付ける（7 項目でも 390px で潰れないよう min-h と最小余白で詰める）。 */}
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] transition-colors ${
                  isActive ? 'text-accent' : 'text-text-muted'
                }`
              }
            >
              <span aria-hidden>{item.icon}</span>
              <span className="leading-none">{item.shortLabel}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
