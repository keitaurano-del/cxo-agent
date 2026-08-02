// KeitaActionsCard — 「⏱ Keita今日の2分」カード（MC-358 層2/層4）。
//
// 正本 docs/keita-actions.md（Keita操作キュー・チェックボックス消し込み式）を
// GET /api/keita-actions で購読し、タスクボード上部に常設表示する。
// - 「## 未完」配下の項目のみ。0件ならカード自体を出さない（安全側）。
// - 各項目はタイトル行タップで展開し、手順本文を ChatMarkdown（個票と同じ流儀）で描画。
//   URL リンク化も ChatMarkdown（remark-gfm の自動リンク）に任せる。
// - 消し込み（MC-358 続き・2026-08-02 Keita「キューになってるところも完了できるように」）:
//   チェックはタップで切替（POST /api/keita-actions/check）、
//   「✓ 済にする」は 2 段階確認で項目ごと完了ログへ移動（POST /api/keita-actions/complete）。
//   どちらもサーバ側で keita-actions.md を更新して git commit（🔒[Keita]）する。
// スタイルは既存の「今日の2分」（blockers 版）カードのデザイン言語に合わせ、派手にしない。

import { useEffect, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import ChatMarkdown from './ChatMarkdown';
import { ChevronRightIcon } from './icons';

type KeitaActionCheck = { label: string; done: boolean };
type KeitaActionItem = { section: string; body: string; checks: KeitaActionCheck[] };
type KeitaActionsResponse = { items: KeitaActionItem[]; updatedAt: string | null };

async function postJson(url: string, body: unknown): Promise<KeitaActionsResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* JSON でなければ HTTP ステータスのまま */
    }
    throw new Error(msg);
  }
  return (await res.json()) as KeitaActionsResponse;
}

function CheckLine({
  item,
  c,
  onUpdated,
  onError,
}: {
  item: KeitaActionItem;
  c: KeitaActionCheck;
  onUpdated: (r: KeitaActionsResponse) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson('/api/keita-actions/check', {
        section: item.section,
        label: c.label,
        done: !c.done,
      });
      onUpdated(r);
    } catch (e) {
      onError(e instanceof Error ? e.message : '更新に失敗しました。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void toggle();
      }}
      disabled={busy}
      aria-label={`${c.label} を${c.done ? '未完に戻す' : '済にする'}`}
      className={`inline-flex items-center gap-1 rounded px-1 text-[11px] transition-colors hover:bg-surface disabled:opacity-50 ${
        c.done ? 'text-text-faint line-through' : 'text-text-muted'
      }`}
    >
      <span aria-hidden>{busy ? '…' : c.done ? '☑' : '☐'}</span>
      {c.label}
    </button>
  );
}

function ActionRow({
  item,
  onUpdated,
}: {
  item: KeitaActionItem;
  onUpdated: (r: KeitaActionsResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allDone = item.checks.length > 0 && item.checks.every((c) => c.done);

  // 誤タップ防止: 確認状態は 5 秒で自動解除（タスク詳細の完了ボタンと同じ流儀）。
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const complete = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson('/api/keita-actions/complete', { section: item.section });
      onUpdated(r); // 項目ごと消えて完了ログへ
    } catch (e) {
      setError(e instanceof Error ? e.message : '完了にできませんでした。');
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-surface-2">
      <div className="flex w-full items-start gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${item.section} の手順を${open ? '閉じる' : '開く'}`}
          className="mt-0.5 shrink-0 text-text-faint"
        >
          <span
            className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          >
            <ChevronRightIcon width={13} height={13} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`block w-full text-left text-[12px] leading-snug ${
              allDone ? 'text-text-faint line-through' : 'text-text'
            }`}
          >
            {item.section}
          </button>
          {item.checks.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {item.checks.map((c) => (
                <CheckLine
                  key={c.label}
                  item={item}
                  c={c}
                  onUpdated={onUpdated}
                  onError={setError}
                />
              ))}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => (armed ? void complete() : setArmed(true))}
          disabled={busy}
          aria-label={armed ? 'タップで完了を確定する' : `${item.section} を済にする`}
          className={
            armed
              ? 'shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-bg disabled:opacity-50'
              : 'shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface hover:text-text disabled:opacity-50'
          }
          style={armed ? { background: 'var(--mc-done)' } : undefined}
        >
          {busy ? '保存中…' : armed ? 'もう一度で確定' : '✓ 済にする'}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="border-t border-border px-3 py-1.5 text-[11px]"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {error}
        </p>
      )}
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
  // 消し込み API のレスポンス（最新 items）でローカル上書き。次の tick/refetch まで即時反映する。
  const [override, setOverride] = useState<KeitaActionsResponse | null>(null);
  useEffect(() => {
    setOverride(null); // ライブ更新が届いたら上書きは破棄して正本に従う
  }, [data]);
  const view = override ?? data;
  const items = view?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="mx-4 mb-1 mt-2 rounded-lg border border-accent/40 bg-surface px-3 py-2 md:mx-6">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold text-text">
          ⏱ Keita今日の2分{' '}
          <span className="font-normal text-text-muted">— Keita操作キュー {items.length}件</span>
        </span>
        {view?.updatedAt && (
          <span className="shrink-0 text-[10px] tabular-nums text-text-faint">
            {new Date(view.updatedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}{' '}
            更新
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {items.map((item) => (
          <ActionRow key={item.section} item={item} onUpdated={setOverride} />
        ))}
      </div>
    </div>
  );
}
