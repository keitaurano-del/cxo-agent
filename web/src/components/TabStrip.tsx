// ─── 共通タブストリップ / 件数バッジ（MC-313）─────────────────────────────
// タブ実装が 3 流儀（下線 / ピル塗り / セグメント）、件数バッジも 3 流儀に散っていたため共通化。
// ページ内タブは「下線（border-b-2 border-accent）」流儀に統一する
// （Work / Chaji / Childcare / DocumentsTabs / TasksTabs / Vault / Notebooks で最多数派）。
// フィルタチップ（Approvals / Tasks のステータス絞り込み）や
// セグメントトグル（Schedule の月週日・Development のモバイル切替）は別ウィジェットなので対象外。

import type { ReactNode } from 'react';

export type CountTone = 'default' | 'accent' | 'danger';

export type TabDef = {
  key: string;
  label: ReactNode;
  /** 件数バッジ。undefined なら非表示。tone は countTone で指定（既定 default）。 */
  count?: number;
  countTone?: CountTone;
};

/**
 * 件数バッジ。
 * - default: 角丸の淡色ピル（Approvals / Tasks 流儀）。0 でも表示（現状の挙動を踏襲）。
 * - danger: 赤の丸ピル（TasksTabs 承認 / NavBadge 流儀）。0 は非表示。
 * - accent: アクセント色の丸ピル。0 は非表示。
 */
export function CountBadge({ count, tone = 'default' }: { count: number; tone?: CountTone }) {
  if (tone !== 'default' && count <= 0) return null;
  if (tone === 'danger' || tone === 'accent') {
    return (
      <span
        className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
          tone === 'danger' ? 'bg-blocked text-white' : 'bg-accent text-bg'
        }`}
      >
        {count > 99 ? '99+' : count}
      </span>
    );
  }
  return (
    <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">{count}</span>
  );
}

/**
 * 下線アクティブ流儀の共通タブストリップ。
 * - className: コンテナへの追加クラス（px-4 md:px-6 / md:hidden / overflow-x-auto など）。
 * - size: 'md'=text-sm（ページタブ既定）/ 'sm'=text-xs（モバイルペイン切替）。
 * - fill: 各タブを flex-1 で等幅に（モバイルのペイン切替流儀）。
 */
export function TabStrip({
  tabs,
  active,
  onChange,
  ariaLabel,
  className = '',
  size = 'md',
  fill = false,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
  fill?: boolean;
}) {
  const sizeClass = size === 'sm' ? 'px-2 py-2.5 text-xs' : 'px-3 py-2.5 text-sm';
  return (
    <div role="tablist" aria-label={ariaLabel} className={`flex border-b border-border ${className}`}>
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`-mb-px flex shrink-0 items-center justify-center gap-1.5 border-b-2 transition-colors ${sizeClass} ${
              fill ? 'flex-1' : ''
            } ${
              isActive
                ? 'border-accent font-semibold text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.count !== undefined && <CountBadge count={t.count} tone={t.countTone} />}
          </button>
        );
      })}
    </div>
  );
}
