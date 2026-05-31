// アラートバッジ + 展開リスト（通知/アラート MC-63）。
//
// 役割:
//  - ERROR / 長期 BLOCKED / deploy 失敗 を集計した /api/alerts を購読し、件数バッジを出す。
//  - バッジクリックで個別アラートのリストを展開。BLOCKED 滞留は該当タスクへ deep link。
//  - 0 件のときは何も描画しない（解消すると自然に消える）。
//
// 制約: 色はデザインシステム変数のみ（ハードコード hex 禁止）。UI chrome は SVG アイコン（emoji 不可）。
// 文言は中立的丁寧体。モバイルで潰れないようボタン化＋折りたたみ。状態色は語ラベルを併記する。

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { AlertItem, AlertsResponse } from '../lib/types';
import { AlertIcon, ChevronRightIcon } from './icons';

/** 深刻度 → 配色変数。error は赤、warning はブロック色（橙）に揃える。 */
function severityColor(sev: AlertItem['severity']): { color: string; bg: string } {
  if (sev === 'error') return { color: 'var(--mc-error)', bg: 'var(--mc-error-bg)' };
  return { color: 'var(--mc-blocked)', bg: 'var(--mc-blocked-bg)' };
}

function AlertRow({ a, onOpen }: { a: AlertItem; onOpen: (a: AlertItem) => void }) {
  const c = severityColor(a.severity);
  const clickable = !!a.taskId; // BLOCKED 滞留などタスク詳細へ飛べるものだけクリック可能。
  const sevLabel = a.severity === 'error' ? 'エラー' : '警告';
  const inner = (
    <>
      <span
        className="mt-0.5 inline-flex shrink-0"
        style={{ color: c.color }}
        role="img"
        aria-label={sevLabel}
      >
        <AlertIcon width={14} height={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-snug text-text">{a.title}</span>
        {a.detail && (
          <span className="mt-0.5 block truncate text-[11px] text-text-faint">{a.detail}</span>
        )}
      </span>
      {clickable && (
        <span className="mt-0.5 shrink-0 text-text-faint" aria-hidden>
          <ChevronRightIcon width={14} height={14} />
        </span>
      )}
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={() => onOpen(a)}
        className="flex w-full items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2"
        style={{ borderLeft: `3px solid ${c.color}` }}
        aria-label={`${sevLabel}: ${a.title} を開く`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      className="flex w-full items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2"
      style={{ borderLeft: `3px solid ${c.color}` }}
      role="listitem"
    >
      {inner}
    </div>
  );
}

export function AlertBanner() {
  const tick = useLiveTick('tasks', 'agents');
  const { data } = useLiveResource<AlertsResponse>('/api/alerts', tick);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // 取得前 / エラー時 / 0 件は何も出さない（部分劣化）。
  if (!data || data.counts.total === 0) return null;

  const { error, warning, total } = data.counts;

  const handleOpen = (a: AlertItem) => {
    // BLOCKED 滞留は該当タスクへ。Tasks.tsx の deep link（?task=&source=）で TaskDetail が開く。
    if (a.taskId) {
      const params = new URLSearchParams({ task: a.taskId });
      if (a.source) params.set('source', a.source);
      navigate(`/tasks?${params.toString()}`);
      setOpen(false);
    }
  };

  return (
    <section className="mb-4" aria-label="アラート">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left"
        style={{
          borderColor: error > 0 ? 'var(--mc-error)' : 'var(--mc-blocked)',
          background: error > 0 ? 'var(--mc-error-bg)' : 'var(--mc-blocked-bg)',
        }}
        aria-expanded={open}
        aria-controls="alert-list"
      >
        <span
          className="inline-flex shrink-0"
          style={{ color: error > 0 ? 'var(--mc-error)' : 'var(--mc-blocked)' }}
          aria-hidden
        >
          <AlertIcon width={18} height={18} />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-text">
          対応が必要なアラートが {total} 件あります。
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {error > 0 && (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{ color: 'var(--mc-error)', background: 'var(--mc-surface-3)' }}
              aria-label={`エラー ${error} 件`}
            >
              エラー {error}
            </span>
          )}
          {warning > 0 && (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{ color: 'var(--mc-blocked)', background: 'var(--mc-surface-3)' }}
              aria-label={`警告 ${warning} 件`}
            >
              警告 {warning}
            </span>
          )}
          <span
            className="text-text-faint transition-transform"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
            aria-hidden
          >
            <ChevronRightIcon width={16} height={16} />
          </span>
        </span>
      </button>

      {open && (
        <div id="alert-list" className="mt-2 flex flex-col gap-2" role="list">
          {data.alerts.map((a) => (
            <AlertRow key={a.id} a={a} onOpen={handleOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
