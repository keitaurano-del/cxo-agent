// 各ビュー共通のページヘッダ。タイトル + 説明 + 右側に最終更新と任意アクション。
// 全メニュー共通でヘッダを最小化できるトグルを持つ（状態は localStorage に保存し全画面で共有）。
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { relativeTime } from '../lib/time';
import { ChevronRightIcon } from './icons';

const COLLAPSE_KEY = 'apollo.header.collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function PageHeader({
  title,
  subtitle,
  fetchedAt,
  right,
}: {
  title: string;
  subtitle?: string;
  fetchedAt?: string | null;
  right?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage 不可環境では永続化をスキップ
    }
  }, [collapsed]);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'ヘッダーを展開' : 'ヘッダーを最小化'}
            aria-expanded={!collapsed}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface hover:text-text"
          >
            <ChevronRightIcon
              className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}
            />
          </button>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-text">{title}</h1>
              {subtitle && (
                <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>
              )}
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="flex items-center gap-3">
            {right}
            {fetchedAt !== undefined && (
              <span className="text-[11px] text-text-faint">
                最終更新: {relativeTime(fetchedAt)}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
