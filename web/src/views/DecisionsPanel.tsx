// 決裁フロー（MC-203）— 承認フロー（/approvals）内の専用タブ。
//
// エージェントが投入した「Keita 決裁依頼」（選択肢付き）を一覧表示し、Keita が選択肢から
// 1 つ選んで決裁する。決裁すると結果が要求元エージェントのターミナルへ流れる（server 側で notify）。
// 既存の承認フロー（exec承認 / confirm / blocked）とは別タブ・別オートモード・別 state。
//
// デザイン制約: ハードコード hex 禁止（var(--mc-*) のみ）、UI chrome は SVG アイコンのみ、
//   中立的な丁寧体、モバイル 390px で横溢れ 0。

import { useEffect, useMemo, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type {
  DecisionAutoModeResponse,
  DecisionHistoryResponse,
  DecisionRequest,
  DecisionsResponse,
} from '../lib/types';
import { absoluteTime, relativeTime } from '../lib/time';
import { ResourceState, EmptyState, Badge, Spinner } from '../components/ui';
import { ApprovalIcon, ChevronRightIcon } from '../components/icons';

/** 決裁を確定する POST。 */
async function postDecide(id: string, optionId: string, comment?: string): Promise<void> {
  const res = await fetch(`/api/decisions/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId, ...(comment ? { comment } : {}) }),
  });
  if (!res.ok) {
    let msg = `決裁に失敗しました（HTTP ${res.status}）。`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* JSON でないレスポンスはそのまま既定文言。 */
    }
    throw new Error(msg);
  }
}

/** 決裁 1 件のカード（選択肢ボタン群 + 任意コメント）。 */
function DecisionCard({
  dec,
  onResolved,
}: {
  dec: DecisionRequest;
  onResolved: (id: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [busyOption, setBusyOption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePick = async (optionId: string) => {
    if (busyOption) return;
    setBusyOption(optionId);
    setError(null);
    try {
      await postDecide(dec.id, optionId, comment.trim() || undefined);
      onResolved(dec.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '決裁に失敗しました。');
      setBusyOption(null);
    }
  };

  return (
    <li
      className="rounded-lg border border-border bg-surface p-3"
      style={{ borderLeft: '3px solid var(--mc-accent)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-muted">{dec.fromName}</span>
        <Badge color="var(--mc-accent)" bg="var(--mc-surface-3)">
          決裁
        </Badge>
      </div>
      <p className="mt-1 break-words text-[13px] leading-snug text-text">{dec.title}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-text-muted">
        {dec.detail}
      </p>
      <div className="mt-2 text-[10px] text-text-faint">
        {dec.requestedAt && (
          <span title={absoluteTime(dec.requestedAt)}>リクエスト {relativeTime(dec.requestedAt)}</span>
        )}
      </div>

      {/* 任意コメント（選択前に入力できる）。 */}
      <div className="mt-2">
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor={`dec-comment-${dec.id}`}>
          コメント（任意）
        </label>
        <textarea
          id={`dec-comment-${dec.id}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={2}
          className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          placeholder="補足を入力できます（任意・結果と一緒に要求元へ通知されます）"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-border px-2.5 py-1.5 text-[11px]"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {error}
        </p>
      )}

      {/* 選択肢ボタン群。390px で横溢れしないよう縦積み。 */}
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-[11px] text-text-muted">選択肢から 1 つ選んで決裁してください。</p>
        {dec.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => void handlePick(opt.id)}
            disabled={busyOption !== null}
            className="flex w-full items-start gap-2 rounded-lg border border-border px-3 py-2 text-left text-[12px] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="mt-0.5 shrink-0">
              {busyOption === opt.id ? <Spinner /> : <ApprovalIcon width={14} height={14} />}
            </span>
            <span className="min-w-0">
              <span className="block break-words font-semibold text-text">{opt.label}</span>
              {opt.description && (
                <span className="mt-0.5 block break-words text-[11px] text-text-muted">
                  {opt.description}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </li>
  );
}

/** 決裁オートモードのトグル（承認オートモードとは別 state・別エンドポイント）。 */
function DecisionAutoModeToggle() {
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'default' | 'off'>('default');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/decisions/automode');
        if (!res.ok) throw new Error();
        const body = (await res.json()) as DecisionAutoModeResponse;
        if (alive) {
          setEnabled(body.enabled === true);
          setMode(body.mode === 'off' ? 'off' : 'default');
          setLoaded(true);
        }
      } catch {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async (nextEnabled: boolean, nextMode: 'default' | 'off') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/decisions/automode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled, mode: nextMode }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as DecisionAutoModeResponse;
      setEnabled(body.enabled === true);
      setMode(body.mode === 'off' ? 'off' : 'default');
    } catch {
      setError('決裁オートモードの切り替えに失敗しました。時間をおいて再度お試しください。');
      // 失敗時は GET 済みの値に戻す（楽観更新済み state をロールバック）。
      setEnabled((v) => v);
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = () => {
    if (busy) return;
    const next = !enabled;
    setEnabled(next); // 楽観更新。
    void save(next, mode);
  };

  const handleModeChange = (next: 'default' | 'off') => {
    if (busy || next === mode) return;
    setMode(next); // 楽観更新。
    void save(enabled, next);
  };

  return (
    <div className="border-b border-border px-4 py-3 md:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="決裁オートモード"
          onClick={handleToggle}
          disabled={busy || !loaded}
          className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
          style={{ background: enabled ? 'var(--mc-active)' : 'var(--mc-surface-3)' }}
        >
          <span
            className="inline-block h-4 w-4 rounded-full transition-transform"
            style={{
              background: 'var(--mc-bg)',
              transform: enabled ? 'translateX(18px)' : 'translateX(2px)',
            }}
            aria-hidden
          />
        </button>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <ApprovalIcon width={14} height={14} />
          決裁オートモード
        </span>
        <span className="text-[11px]" style={{ color: enabled ? 'var(--mc-active)' : 'var(--mc-idle)' }}>
          {enabled ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* 自動時の挙動（安全側）。default=既定選択肢を自動選択 / off=自動しない。 */}
      {enabled && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-text-muted">自動時の挙動:</span>
          <button
            type="button"
            onClick={() => handleModeChange('default')}
            disabled={busy}
            className={`rounded-md px-2.5 py-1 text-[11px] ${
              mode === 'default'
                ? 'bg-surface-3 font-semibold text-text'
                : 'text-text-muted hover:bg-surface-2'
            }`}
          >
            既定の選択肢を自動選択
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('off')}
            disabled={busy}
            className={`rounded-md px-2.5 py-1 text-[11px] ${
              mode === 'off'
                ? 'bg-surface-3 font-semibold text-text'
                : 'text-text-muted hover:bg-surface-2'
            }`}
          >
            自動しない（保留）
          </button>
        </div>
      )}
      {enabled && (
        <p className="mt-1 break-words text-[11px] leading-relaxed text-text-muted">
          {mode === 'default'
            ? '新規の決裁依頼は先頭（既定）の選択肢で自動決裁し、結果を要求元へ通知します。'
            : '決裁依頼は自動決裁せず、保留のままにします（手動で決裁してください）。'}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px]"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** 決裁履歴 1 行（読み取り専用）。 */
function DecisionHistoryRow({ entry }: { entry: DecisionRequest }) {
  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color="var(--mc-active)" bg="var(--mc-active-bg)">
          決定
        </Badge>
        {entry.autoDecided && (
          <Badge color="var(--mc-accent)" bg="var(--mc-surface-3)" title="オートモードによる自動決裁">
            オート
          </Badge>
        )}
        {entry.decidedAt && (
          <span className="ml-auto text-[10px] text-text-faint" title={absoluteTime(entry.decidedAt)}>
            {relativeTime(entry.decidedAt)}
          </span>
        )}
      </div>
      <p className="mt-1 break-words text-[12px] leading-snug text-text">{entry.title}</p>
      <p className="mt-1 break-words text-[11px] text-text-muted">
        決定: {entry.decidedOptionLabel ?? entry.decidedOptionId ?? '—'}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-faint">
        {entry.fromName && <span>{entry.fromName}</span>}
        {entry.comment && <span className="break-words text-text-muted">「{entry.comment}」</span>}
      </div>
    </li>
  );
}

/** 決裁履歴セクション（折りたたみ）。 */
function DecisionHistorySection({ tick }: { tick: number }) {
  const [open, setOpen] = useState(false);
  const { data } = useLiveResource<DecisionHistoryResponse>('/api/decisions/history', tick);
  const entries = data?.entries ?? [];
  return (
    <div className="mt-8 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span
          className="inline-flex transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          aria-hidden
        >
          <ChevronRightIcon width={14} height={14} />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          決裁済・履歴
        </span>
        <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
          {entries.length}
        </span>
      </button>
      {open && (
        <div className="mt-3">
          {entries.length === 0 ? (
            <EmptyState>まだ決裁の履歴はありません。</EmptyState>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <DecisionHistoryRow key={`${e.id}:${e.decidedAt}`} entry={e} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** 決裁タブの本体。承認フロー（Approvals）から専用タブとして呼ばれる。 */
export default function DecisionsPanel() {
  // 決裁の realtime 更新は SSE の 'decisions' broadcast（既知種別外→tasks tick にフォールバック）で拾う。
  const tick = useLiveTick('tasks');
  const { data, error, loading, refetch } = useLiveResource<DecisionsResponse>(
    '/api/decisions',
    tick,
  );
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const liveDecisions = useMemo(
    () => (data?.decisions ?? []).filter((d) => !resolved.has(d.id)),
    [data, resolved],
  );

  const handleResolved = (id: string) => {
    setResolved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => refetch(), 600);
  };

  return (
    <div>
      <DecisionAutoModeToggle />
      <div className="p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          <>
            {liveDecisions.length === 0 ? (
              <EmptyState>決裁が必要な項目はありません。</EmptyState>
            ) : (
              <ul className="space-y-2">
                {liveDecisions.map((dec) => (
                  <DecisionCard key={dec.id} dec={dec} onResolved={handleResolved} />
                ))}
              </ul>
            )}
            <DecisionHistorySection tick={tick} />
          </>
        </ResourceState>
      </div>
    </div>
  );
}
