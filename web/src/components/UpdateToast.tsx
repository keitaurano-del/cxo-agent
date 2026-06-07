// 更新通知トースト — SSE update/chat イベントを受け取り、右下に一時表示する。
// App.tsx から window カスタムイベント 'apollo-update-toast' を受信して表示。
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export interface UpdateToastItem {
  id: string;
  emoji: string;
  label: string;
  detail?: string;
  navTo?: string;
}

const DURATION_MS = 4500;

export function UpdateToast() {
  const [items, setItems] = useState<UpdateToastItem[]>([]);
  const navigate = useNavigate();
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const item = (e as CustomEvent<UpdateToastItem>).detail;
      setItems((prev) => {
        // 同じ navTo が既にある場合は label を更新するだけ（スタック爆発防止）
        const idx = prev.findIndex((p) => p.navTo && p.navTo === item.navTo);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], label: item.label, detail: item.detail, emoji: item.emoji };
          return next;
        }
        return [...prev.slice(-4), item]; // 最大5件
      });
      // 既存タイマーをリセット
      const old = timers.current.get(item.id);
      if (old) clearTimeout(old);
      const t = setTimeout(() => dismiss(item.id), DURATION_MS);
      timers.current.set(item.id, t);
    };
    window.addEventListener('apollo-update-toast', handler);
    return () => window.removeEventListener('apollo-update-toast', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // アンマウント時にタイマー全クリア
  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2 md:bottom-6 md:left-auto md:right-4 md:translate-x-0"
      aria-live="polite"
      aria-label="更新通知"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className="flex min-w-[220px] max-w-[320px] items-start gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <span className="mt-0.5 shrink-0 text-base leading-none">{item.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-text leading-snug">{item.label}</p>
            {item.detail && (
              <p className="mt-0.5 truncate text-[11px] text-text-faint">{item.detail}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {item.navTo && (
              <button
                type="button"
                onClick={() => { navigate(item.navTo!); dismiss(item.id); }}
                className="rounded px-1.5 py-0.5 text-[11px] text-text-faint hover:bg-surface-2 hover:text-text transition-colors"
                aria-label={`${item.label}を開く`}
              >
                開く
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="rounded p-0.5 text-text-faint hover:bg-surface-2 hover:text-text transition-colors"
              aria-label="閉じる"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** App.tsx や SSE リスナーから呼ぶヘルパー。 */
export function fireUpdateToast(item: UpdateToastItem) {
  window.dispatchEvent(new CustomEvent('apollo-update-toast', { detail: item }));
}
