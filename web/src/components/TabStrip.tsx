// ─── 共通タブストリップ / 件数バッジ（MC-313）─────────────────────────────
// タブ実装が 3 流儀（下線 / ピル塗り / セグメント）、件数バッジも 3 流儀に散っていたため共通化。
// ページ内タブは「下線（border-b-2 border-accent）」流儀に統一する
// （Work / Chaji / Childcare / DocumentsTabs / TasksTabs / Vault / Notebooks で最多数派）。
// フィルタチップ（Approvals / Tasks のステータス絞り込み）や
// セグメントトグル（Schedule の月週日・Development のモバイル切替）は別ウィジェットなので対象外。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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

// ─── 長押し並び替え（2026-08-21 Keita「長押しで順番変えられるようにして。他のメニューも同様」）───
// reorderKey を渡したストリップだけ有効（opt-in）。並び順は localStorage に永続化する。
// 横スクロール（同日追加）と共存させるため、通常スワイプはスクロール・長押し(450ms)でドラッグ開始。

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 8;

function orderStorageKey(reorderKey: string) {
  return `tabstrip-order:${reorderKey}`;
}

function loadSavedOrder(reorderKey: string | undefined): string[] | null {
  if (!reorderKey) return null;
  try {
    const raw = localStorage.getItem(orderStorageKey(reorderKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((k) => typeof k === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

/** 保存順を tabs に適用。保存に無い新タブは元の位置を保つ。 */
function applyOrder(tabs: TabDef[], saved: string[] | null): TabDef[] {
  if (!saved) return tabs;
  const byKey = new Map(tabs.map((t) => [t.key, t]));
  const result: TabDef[] = saved.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
  tabs.forEach((t, i) => {
    if (!saved.includes(t.key)) result.splice(Math.min(i, result.length), 0, t);
  });
  return result;
}

/**
 * 下線アクティブ流儀の共通タブストリップ。
 * - className: コンテナへの追加クラス（px-4 md:px-6 / md:hidden / overflow-x-auto など）。
 * - size: 'md'=text-sm（ページタブ既定）/ 'sm'=text-xs（モバイルペイン切替）。
 * - fill: 各タブを flex-1 で等幅に（モバイルのペイン切替流儀）。
 * - reorderKey: 指定すると長押しドラッグで並び替え可・並び順を localStorage に保存。
 */
export function TabStrip({
  tabs,
  active,
  onChange,
  ariaLabel,
  className = '',
  size = 'md',
  fill = false,
  reorderKey,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
  fill?: boolean;
  reorderKey?: string;
}) {
  const sizeClass = size === 'sm' ? 'px-2 py-2.5 text-xs' : 'px-3 py-2.5 text-sm';
  const [savedOrder, setSavedOrder] = useState<string[] | null>(() => loadSavedOrder(reorderKey));
  const ordered = useMemo(() => applyOrder(tabs, savedOrder), [tabs, savedOrder]);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const dragKeyRef = useRef<string | null>(null);
  // 長押し判定用（押下位置・タイマー）と「ドラッグ直後の click を無視する」フラグ
  const pressRef = useRef<{ key: string; x: number; y: number; timer: number } | null>(null);
  const suppressClickRef = useRef(false);

  const persist = (keys: string[]) => {
    setSavedOrder(keys);
    if (reorderKey) {
      try {
        localStorage.setItem(orderStorageKey(reorderKey), JSON.stringify(keys));
      } catch {
        /* private mode 等では保存だけ諦める */
      }
    }
  };

  const clearPress = () => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };

  // ドラッグ中はタッチスクロールを止める（passive:false でないと preventDefault が効かない）
  useEffect(() => {
    if (!dragKey) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, [dragKey]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, key: string) => {
    if (!reorderKey || e.button !== 0) return;
    clearPress();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    pressRef.current = {
      key,
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        pressRef.current = null;
        dragKeyRef.current = key;
        setDragKey(key);
        try {
          target.setPointerCapture(pointerId);
        } catch {
          /* すでに離れていた等 */
        }
        if ('vibrate' in navigator) navigator.vibrate?.(20);
      }, LONG_PRESS_MS),
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pressRef.current) {
      // 長押し前に動いたら通常スクロール／タップとみなしてドラッグ待ちを解除
      const dx = e.clientX - pressRef.current.x;
      const dy = e.clientY - pressRef.current.y;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearPress();
      return;
    }
    const key = dragKeyRef.current;
    if (!key || !listRef.current) return;
    // ポインタ位置に応じて表示順を即時入れ替え（ドロップ位置のプレビュー）。
    // ドラッグ中タブ自身を除いた各タブの中点と比較し、挿入位置を数える。
    const buttons = Array.from(listRef.current.querySelectorAll<HTMLButtonElement>('[data-tabkey]'));
    const rest = ordered.map((t) => t.key).filter((k) => k !== key);
    let insertAt = 0;
    for (const b of buttons) {
      if (b.dataset.tabkey === key) continue;
      const r = b.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2) insertAt++;
    }
    const next = [...rest.slice(0, insertAt), key, ...rest.slice(insertAt)];
    if (next.some((k, i) => k !== ordered[i]?.key)) {
      setSavedOrder(applyOrder(tabs, next).map((t) => t.key));
    }
  };

  const handlePointerEnd = () => {
    clearPress();
    if (dragKeyRef.current) {
      dragKeyRef.current = null;
      setDragKey(null);
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      persist(ordered.map((t) => t.key));
    }
  };

  return (
    // タブ数が画面幅を超えても横スクロールで届くようにする（2026-08-21 Keita「タブスクロールできない」。
    // Work の Laundry.jp タブ追加でスマホ幅から溢れた）。共通側で直し、TabStrip 利用の全ページに効かせる。
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={`no-scrollbar flex overflow-x-auto border-b border-border ${className}`}
    >
      {ordered.map((t) => {
        const isActive = t.key === active;
        const isDragging = t.key === dragKey;
        return (
          <button
            key={t.key}
            data-tabkey={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              if (suppressClickRef.current) return;
              onChange(t.key);
            }}
            onPointerDown={(e) => handlePointerDown(e, t.key)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onContextMenu={(e) => {
              // モバイルの長押しメニューがドラッグを邪魔しないように
              if (reorderKey) e.preventDefault();
            }}
            className={`-mb-px flex shrink-0 select-none items-center justify-center gap-1.5 border-b-2 transition-colors ${sizeClass} ${
              fill ? 'flex-1' : ''
            } ${
              isActive
                ? 'border-accent font-semibold text-text'
                : 'border-transparent text-text-muted hover:text-text'
            } ${isDragging ? 'scale-95 rounded-t bg-surface opacity-70 ring-1 ring-accent' : ''}`}
          >
            {t.label}
            {t.count !== undefined && <CountBadge count={t.count} tone={t.countTone} />}
          </button>
        );
      })}
    </div>
  );
}
