// モバイル専用ハンバーガーメニュー（右上固定）。
// BottomNav を廃止してボトムスペースを解放し、ターミナルの仮想キーバー等が見えるようにする。
import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { isDashboardPath } from '../lib/nav';
import { SortableNav, DragHandle } from './SortableNav';

export interface BottomNavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}

export default function BottomNav({
  items,
  badges = {},
  onReorder,
  footerActions,
}: {
  items: BottomNavItem[];
  badges?: Partial<Record<string, number>>;
  /** ドラッグ並べ替え確定で呼ぶ（MC-158）。未指定なら並べ替え不可。 */
  onReorder?: (next: BottomNavItem[]) => void;
  /**
   * ドロップダウン下部（nav 行の下）に出す追加アクション（設定・テーマ切替など）。
   * close を呼ぶとメニューを閉じる。未指定なら何も出さない（MC-221）。
   */
  footerActions?: (close: () => void) => ReactNode;
}) {
  const { pathname } = useLocation();
  const dashActive = isDashboardPath(pathname);
  const [open, setOpen] = useState(false);

  // ナビ遷移時にメニューを閉じる
  useEffect(() => { setOpen(false); }, [pathname]);

  const totalBadge = Object.values(badges).reduce((a: number, b) => a + (b ?? 0), 0);

  // 1 行（ナビ項目＋バッジ）。handle が渡れば末尾にドラッグハンドルを出す（モバイルは常時表示）。
  const renderItem = (item: BottomNavItem, handleProps?: Record<string, unknown>): ReactNode => {
    const forceActive = item.to === '/' && dashActive;
    const badge = badges[item.to] ?? 0;
    return (
      <div className="flex items-center">
        <NavLink
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              isActive || forceActive
                ? 'bg-surface-3 font-semibold text-text'
                : 'text-text-muted hover:bg-surface-2 hover:text-text'
            }`
          }
        >
          <span className="relative shrink-0" aria-hidden>
            {item.icon}
            {badge > 0 && item.to === '/chat' && (
              // チャット: 青い数字バッジ（アニメーション付き）
              <span
                className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none mc-pulse"
                style={{ color: '#fff', background: '#3b82f6', boxShadow: '0 0 0 2px var(--mc-surface)' }}
                aria-label={`未読 ${badge} 件`}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
            {badge > 0 && item.to !== '/chat' && (
              // その他: 数字バッジ
              <span
                className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none"
                style={{ color: 'var(--mc-bg)', background: 'var(--mc-blocked)' }}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          <span>{item.label}</span>
          {badge > 0 && <span className="sr-only">（未読 {badge} 件）</span>}
        </NavLink>
        {/* モバイルは常時ハンドル表示（hover が無いため）。掴んだ時だけドラッグ発火。 */}
        {handleProps && <DragHandle handleProps={handleProps} className="shrink-0 p-1.5" />}
      </div>
    );
  };

  // onReorder があれば SortableNav でドラッグ並べ替え可能に。無ければ素のリスト。
  const renderRows = (): ReactNode => {
    if (onReorder) {
      return (
        <SortableNav items={items} onReorder={onReorder} direction="vertical">
          {(item, handle) => renderItem(item, handle.handleProps)}
        </SortableNav>
      );
    }
    return items.map((item) => <div key={item.to}>{renderItem(item)}</div>);
  };

  return (
    <>
      {/* ハンバーガーボタン（右上固定・モバイルのみ） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
        aria-expanded={open}
        className="fixed right-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-text shadow-sm md:hidden"
      >
        {/* バッジ */}
        {totalBadge > 0 && !open && (
          <span
            className="absolute -right-1 -top-1 inline-flex min-w-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none"
            style={{ color: 'var(--mc-bg)', background: 'var(--mc-blocked)' }}
          >
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
        {open ? (
          /* × */
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        ) : (
          /* ☰ */
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        )}
      </button>

      {/* オーバーレイ背景 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* ドロップダウンメニュー（右上から展開） */}
      {open && (
        <nav
          className="fixed right-3 top-14 z-50 min-w-[160px] rounded-xl border border-border bg-surface shadow-lg md:hidden"
          aria-label="主要ナビゲーション"
        >
          <div className="flex flex-col gap-0.5 p-2">
            {renderRows()}
            {/* 設定・テーマ切替などの追加アクション（スマホからの設定到達導線・MC-221） */}
            {footerActions && (
              <div className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1">
                {footerActions(() => setOpen(false))}
              </div>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
