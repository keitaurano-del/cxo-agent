// 各ビュー共通のページヘッダ。タイトル + 説明 + 右側に最終更新と任意アクション。
import type { ReactNode } from 'react';
import { relativeTime } from '../lib/time';

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
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur md:px-6 md:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-text">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {right}
          {fetchedAt !== undefined && (
            <span className="text-[11px] text-text-faint">
              最終更新: {relativeTime(fetchedAt)}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
