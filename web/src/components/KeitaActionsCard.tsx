// KeitaActionsCard — 「⏱ Keita今日の2分」カード（MC-358 層2/層4）。
//
// 正本 docs/keita-actions.md（Keita操作キュー・チェックボックス消し込み式）を
// GET /api/keita-actions で購読し、タスクボード上部に常設表示する。
// - 「## 未完」配下の項目のみ。0件ならカード自体を出さない（安全側）。
// - 各項目はタイトル行タップで展開し、手順本文を ChatMarkdown（個票と同じ流儀）で描画。
//   URL リンク化も ChatMarkdown（remark-gfm の自動リンク）に任せる。
// - チェックは表示のみ（済は取り消し線）。UI からの書き込みは無し＝消し込みは Son がファイル側で実施。
// スタイルは既存の「今日の2分」（blockers 版）カードのデザイン言語に合わせ、派手にしない。

import { useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import ChatMarkdown from './ChatMarkdown';
import { ChevronRightIcon } from './icons';

type KeitaActionCheck = { label: string; done: boolean };
type KeitaActionItem = { section: string; body: string; checks: KeitaActionCheck[] };
type KeitaActionsResponse = { items: KeitaActionItem[]; updatedAt: string | null };

function CheckLine({ c }: { c: KeitaActionCheck }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${
        c.done ? 'text-text-faint line-through' : 'text-text-muted'
      }`}
    >
      <span aria-hidden>{c.done ? '☑' : '☐'}</span>
      {c.label}
    </span>
  );
}

function ActionRow({ item }: { item: KeitaActionItem }) {
  const [open, setOpen] = useState(false);
  const allDone = item.checks.length > 0 && item.checks.every((c) => c.done);
  return (
    <div className="rounded-md border border-border bg-surface-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left transition-colors hover:border-accent/60"
      >
        <span
          className={`mt-0.5 shrink-0 text-text-faint transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          <ChevronRightIcon width={13} height={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[12px] leading-snug ${
              allDone ? 'text-text-faint line-through' : 'text-text'
            }`}
          >
            {item.section}
          </span>
          {item.checks.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {item.checks.map((c) => (
                <CheckLine key={c.label} c={c} />
              ))}
            </span>
          )}
        </span>
      </button>
      {open && item.body && (
        <div className="select-text border-t border-border px-3 py-2 text-[12px] leading-relaxed">
          <ChatMarkdown body={item.body} />
        </div>
      )}
    </div>
  );
}

/** タスクボード上部の常設カード。items 0件（ファイル無し含む）は null＝非表示。 */
export function KeitaActionsCard({ tick }: { tick: number }) {
  const { data } = useLiveResource<KeitaActionsResponse>('/api/keita-actions', tick);
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="mx-4 mb-1 mt-2 rounded-lg border border-accent/40 bg-surface px-3 py-2 md:mx-6">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold text-text">
          ⏱ Keita今日の2分{' '}
          <span className="font-normal text-text-muted">— Keita操作キュー {items.length}件</span>
        </span>
        {data?.updatedAt && (
          <span className="shrink-0 text-[10px] tabular-nums text-text-faint">
            {new Date(data.updatedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}{' '}
            更新
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {items.map((item) => (
          <ActionRow key={item.section} item={item} />
        ))}
      </div>
    </div>
  );
}
