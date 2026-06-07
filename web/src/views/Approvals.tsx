// 承認フロー（/approvals）— MC-79 本実装。
//
// Keita の承認/確認が要る項目（BLOCKED 設計判断・デプロイ可否・設計判断/承認待ち/要確認タグ）を
// /api/approvals から取得して一覧表示する。REVIEW/DONE/CANCELLED は server 側で除外済み。
//   - カテゴリタブ（件数バッジつき）でフィルタ。
//   - 各カードに [詳細を開く]（既存 TaskDetail = MC-61 を再利用）/ [承認する]（ワンタップで即確定→
//     /api/approvals/:id/approve、楽観的にリストから消す）/ [却下する]（インライン textarea を展開して
//     コメント入力→/api/approvals/:id/reject）。
//
// 承認はワンタップで即確定（2 段確認なし。Keita 確定 2026-05-31）。却下はコメント入力があるので
// 1 タップでも事故りにくい。書き戻しは server 側で MC-71 の安全層（楽観ロック・read-back・監査）を再利用。
//
// デザイン制約: ハードコード hex 禁止（var(--mc-*) のみ）、UI chrome は SVG アイコンのみ、
//   中立的な丁寧体、モバイル 390px で横溢れ 0。

import { useEffect, useMemo, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { ApprovalItem, ApprovalKind, ApprovalRequest, ApprovalsResponse, AutoModeResponse, Task } from '../lib/types';
import { projectColor, projectLabel, taskStatusMeta } from '../lib/meta';
import { absoluteTime, relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import {
  ResourceState,
  EmptyState,
  Badge,
  StalledBadge,
  TaskStatusBadge,
  Spinner,
} from '../components/ui';
import { TaskDetail } from '../components/TaskDetail';
import { ApprovalIcon, CloseIcon } from '../components/icons';

// ── カテゴリのラベル/配色（CSS 変数のみ・語ラベル併記で色のみ依存にしない）──
const CATEGORY_META: Record<ApprovalKind, { label: string; color: string; bg: string }> = {
  blocked: { label: 'ブロック中', color: 'var(--mc-blocked)', bg: 'var(--mc-blocked-bg)' },
  deploy: { label: 'デプロイ可否', color: 'var(--mc-active)', bg: 'var(--mc-active-bg)' },
  design: { label: '設計判断', color: 'var(--mc-review)', bg: 'var(--mc-review-bg)' },
  approval: { label: '承認待ち', color: 'var(--mc-accent)', bg: 'var(--mc-surface-3)' },
  confirm: { label: '要確認', color: 'var(--mc-idle)', bg: 'var(--mc-idle-bg)' },
};

const CATEGORY_ORDER: ApprovalKind[] = ['blocked', 'deploy', 'design', 'approval', 'confirm'];

function CategoryBadge({ kind }: { kind: ApprovalKind }) {
  const m = CATEGORY_META[kind];
  return <Badge color={m.color} bg={m.bg}>{m.label}</Badge>;
}

interface DecisionApiResponse {
  ok?: boolean;
  task?: Task;
  hash?: string;
  error?: string;
  code?: string;
}

// ── エージェント承認リクエスト ────────────────────────────────────────────

async function postRequestDecision(
  id: string,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<void> {
  const res = await fetch(
    `/api/approvals/request/${encodeURIComponent(id)}/${decision}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(comment !== undefined ? { comment } : {}),
    },
  );
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string };
      throw new Error(body?.error ?? `${decision === 'approve' ? '承認' : '却下'}に失敗しました（HTTP ${res.status}）。`);
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error(`${decision === 'approve' ? '承認' : '却下'}に失敗しました（HTTP ${res.status}）。`);
    }
  }
}

/** エージェント承認リクエストの 1 件カード。 */
function RequestCard({
  req,
  onResolved,
}: {
  req: ApprovalRequest;
  onResolved: (id: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);
  const catMeta = CATEGORY_META[req.category as ApprovalKind] ?? CATEGORY_META['confirm'];

  const handleApprove = async () => {
    if (busy) return;
    setBusy('approve');
    setError(null);
    try {
      await postRequestDecision(req.id, 'approve');
      onResolved(req.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '承認に失敗しました。');
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (busy) return;
    setBusy('reject');
    setError(null);
    try {
      await postRequestDecision(req.id, 'reject', comment.trim() || undefined);
      onResolved(req.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '却下に失敗しました。');
      setBusy(null);
    }
  };

  return (
    <li
      className="rounded-lg border border-border bg-surface p-3"
      style={{ borderLeft: `3px solid ${catMeta.color}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-muted">{req.fromName}</span>
        <Badge color={catMeta.color} bg={catMeta.bg}>{catMeta.label}</Badge>
      </div>
      <p className="mt-1 break-words text-[13px] leading-snug text-text">{req.title}</p>
      <p className="mt-1 break-words text-[12px] leading-relaxed text-text-muted whitespace-pre-wrap">{req.description}</p>
      <div className="mt-2 text-[10px] text-text-faint">
        {req.requestedAt && (
          <span title={absoluteTime(req.requestedAt)}>リクエスト {relativeTime(req.requestedAt)}</span>
        )}
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

      {rejecting && (
        <div className="mt-2">
          <label className="mb-1 block text-[11px] text-text-muted" htmlFor={`req-reject-${req.id}`}>
            却下理由（任意）
          </label>
          <textarea
            id={`req-reject-${req.id}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={2}
            className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            placeholder="却下の理由を入力できます（任意）"
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="ml-auto flex items-center gap-2">
          {!rejecting ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setRejecting(true);
                  setError(null);
                }}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-2 disabled:opacity-50"
              >
                <CloseIcon width={13} height={13} />
                却下する
              </button>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                style={{ color: 'var(--mc-bg)', background: 'var(--mc-active)' }}
              >
                {busy === 'approve' ? (
                  <Spinner />
                ) : (
                  <ApprovalIcon width={14} height={14} />
                )}
                承認する
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setRejecting(false);
                  setComment('');
                }}
                disabled={busy !== null}
                className="rounded-lg px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-2 disabled:opacity-50"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                style={{ color: 'var(--mc-bg)', background: 'var(--mc-stalled)' }}
              >
                {busy === 'reject' ? <Spinner /> : <CloseIcon width={13} height={13} />}
                却下を確定
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as DecisionApiResponse;
    return body?.error ?? `${fallback}（HTTP ${res.status}）。`;
  } catch {
    return `${fallback}（HTTP ${res.status}）。`;
  }
}

/**
 * 承認/却下の共通 POST。
 * baseHash（楽観ロック）は送らない。承認はサーバ側が「最新を読んで→検証して→書き戻す」
 * アトミック方式で確定し、並行書き込み（autonomous-rin 等）と競合してもサーバ内で
 * リトライする。これにより whole-file ハッシュ不一致による「競合しました」連発を解消する。
 */
async function postDecision(
  item: ApprovalItem,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<void> {
  const res = await fetch(
    `/api/approvals/${encodeURIComponent(item.id)}/${decision}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: item.source,
        categories: item.categories,
        ...(decision === 'reject' ? { comment } : {}),
      }),
    },
  );
  if (res.status === 409) {
    // サーバ側で最大 3 回リトライしても並行書き込みが収まらなかった例外的ケース。
    throw new Error('台帳が連続して更新されています。少し時間をおいて再度お試しください。');
  }
  if (!res.ok) {
    throw new Error(await readApiError(res, decision === 'approve' ? '承認に失敗しました' : '却下に失敗しました'));
  }
}

/** 1 件の承認カード。 */
function ApprovalCard({
  item,
  onOpen,
  onResolved,
}: {
  item: ApprovalItem;
  onOpen: (t: Task) => void;
  onResolved: (id: string, source: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);
  const statusMeta = taskStatusMeta(item.status);

  const handleApprove = async () => {
    if (busy) return;
    setBusy('approve');
    setError(null);
    try {
      await postDecision(item, 'approve');
      onResolved(item.id, item.source); // 楽観的にリストから消す。
    } catch (e) {
      setError(e instanceof Error ? e.message : '承認に失敗しました。');
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (busy) return;
    setBusy('reject');
    setError(null);
    try {
      await postDecision(item, 'reject', comment.trim() || undefined);
      onResolved(item.id, item.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : '却下に失敗しました。');
      setBusy(null);
    }
  };

  return (
    <li
      className="rounded-lg border border-border bg-surface p-3"
      style={{ borderLeft: `3px solid ${projectColor(item.project)}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-text-faint">{item.id}</span>
        {item.categories.map((c) => (
          <CategoryBadge key={c} kind={c} />
        ))}
        {item.stalled && <StalledBadge />}
      </div>
      <p className="mt-1 break-words text-[13px] leading-snug text-text">{item.title}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-faint">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: projectColor(item.project) }}
            aria-hidden
          />
          {projectLabel(item.project)}
        </span>
        <TaskStatusBadge status={item.status} />
        {item.owner && <span title={`担当: ${item.owner}`}>{item.owner}</span>}
        {item.updated && (
          <span title={absoluteTime(item.updated)}>更新 {relativeTime(item.updated)}</span>
        )}
      </div>

      {/* 状態の語ラベル（色のみ依存にしない） */}
      <p className="mt-1 text-[10px]" style={{ color: statusMeta.color }}>
        現在の状態: {statusMeta.label}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-border px-2.5 py-1.5 text-[11px]"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {error}
        </p>
      )}

      {/* 却下のインライン textarea（展開時のみ） */}
      {rejecting && (
        <div className="mt-2">
          <label className="mb-1 block text-[11px] text-text-muted" htmlFor={`reject-${item.id}`}>
            却下理由（任意）
          </label>
          <textarea
            id={`reject-${item.id}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={2}
            className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            placeholder="却下の理由を入力できます（任意）"
          />
        </div>
      )}

      {/* アクション。390px で横溢れしないよう flex-wrap + ボタンは縮む。 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="rounded-lg px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-2 hover:text-text"
        >
          詳細を開く
        </button>
        <div className="ml-auto flex items-center gap-2">
          {!rejecting ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setRejecting(true);
                  setError(null);
                }}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-2 disabled:opacity-50"
              >
                <CloseIcon width={13} height={13} />
                却下する
              </button>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                style={{ color: 'var(--mc-bg)', background: 'var(--mc-active)' }}
              >
                {busy === 'approve' ? (
                  <Spinner />
                ) : (
                  <ApprovalIcon width={14} height={14} />
                )}
                承認する
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setRejecting(false);
                  setComment('');
                }}
                disabled={busy !== null}
                className="rounded-lg px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-2 disabled:opacity-50"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                style={{ color: 'var(--mc-bg)', background: 'var(--mc-stalled)' }}
              >
                {busy === 'reject' ? <Spinner /> : <CloseIcon width={13} height={13} />}
                却下を確定
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// ── 承認オートモード（MC-186）────────────────────────────────────────────
//
// ON のとき、エージェントからの承認リクエストをサーバ側で自動承認する。
// 安全ゲート: deploy（デプロイ可否）カテゴリは自動承認の対象外（pending のまま手動承認）。

/** オートモードのトグルスイッチ。初期状態を GET し、変更は楽観更新＋失敗ロールバック。 */
function AutoModeToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/approvals/automode');
        if (!res.ok) throw new Error();
        const body = (await res.json()) as AutoModeResponse;
        if (alive) {
          setEnabled(body.enabled === true);
          setLoaded(true);
        }
      } catch {
        if (alive) setLoaded(true); // 取得失敗時は OFF 表示のまま操作可能にする。
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleToggle = async () => {
    if (busy) return;
    const next = !enabled;
    setEnabled(next); // 楽観更新。
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/approvals/automode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as AutoModeResponse;
      setEnabled(body.enabled === true);
    } catch {
      setEnabled(!next); // ロールバック。
      setError('オートモードの切り替えに失敗しました。時間をおいて再度お試しください。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border px-4 py-3 md:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="オートモード"
          onClick={() => void handleToggle()}
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
          オートモード
        </span>
        <span className="text-[11px]" style={{ color: enabled ? 'var(--mc-active)' : 'var(--mc-idle)' }}>
          {enabled ? 'ON' : 'OFF'}
        </span>
      </div>
      {enabled && (
        <p className="mt-1 break-words text-[11px] leading-relaxed text-text-muted">
          エージェントの承認リクエストを自動承認中（デプロイ可否は除く）。
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

export default function Approvals() {
  const tick = useLiveTick('tasks');
  const { data, error, loading, fetchedAt, refetch } = useLiveResource<ApprovalsResponse>(
    '/api/approvals',
    tick,
  );
  const [activeCat, setActiveCat] = useState<ApprovalKind | 'all'>('all');
  const [selected, setSelected] = useState<Task | null>(null);
  // 楽観的に消した項目（承認/却下直後、refetch が届くまでリストから隠す）。
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  // 楽観的に消した承認リクエスト。
  const [resolvedRequests, setResolvedRequests] = useState<Set<string>>(new Set());

  const allItems = useMemo(() => data?.items ?? [], [data]);

  // 楽観削除を反映した表示用リスト。
  const liveItems = useMemo(
    () => allItems.filter((it) => !resolved.has(`${it.source}:${it.id}`)),
    [allItems, resolved],
  );

  // 楽観削除を反映した承認リクエスト一覧。
  const liveRequests = useMemo(
    () => (data?.requests ?? []).filter((r) => !resolvedRequests.has(r.id)),
    [data, resolvedRequests],
  );

  const handleRequestResolved = (id: string) => {
    setResolvedRequests((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => refetch(), 600);
  };

  // カテゴリ別件数（楽観削除反映後の実数で再計算＝タブのバッジを即時に更新）。
  const counts = useMemo(() => {
    const c: Record<ApprovalKind, number> = {
      blocked: 0,
      deploy: 0,
      design: 0,
      approval: 0,
      confirm: 0,
    };
    for (const it of liveItems) {
      for (const cat of it.categories) c[cat] += 1;
    }
    return c;
  }, [liveItems]);

  const presentCats = useMemo(
    () => CATEGORY_ORDER.filter((c) => counts[c] > 0),
    [counts],
  );

  const filtered = useMemo(
    () =>
      activeCat === 'all'
        ? liveItems
        : liveItems.filter((it) => it.categories.includes(activeCat)),
    [liveItems, activeCat],
  );

  const handleResolved = (id: string, source: string) => {
    setResolved((prev) => {
      const next = new Set(prev);
      next.add(`${source}:${id}`);
      return next;
    });
    // server 反映を取り込むため少し遅らせて refetch（楽観削除と整合）。
    window.setTimeout(() => refetch(), 600);
  };

  const tabClass = (selected: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs md:py-1.5 ${
      selected ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted hover:bg-surface-2'
    }`;

  return (
    <div>
      <PageHeader
        title="承認フロー"
        subtitle={`Keita の承認が必要な項目 ${liveItems.length} 件`}
        fetchedAt={fetchedAt}
      />

      {/* オートモードのトグル（MC-186。deploy は自動承認の対象外）。 */}
      <AutoModeToggle />

      {/* カテゴリタブ（件数バッジ付き）。横スクロールで 390px に収める。 */}
      <div className="border-b border-border px-4 py-2 md:px-6">
        <div
          className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1"
          role="tablist"
          aria-label="承認カテゴリで絞り込み"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeCat === 'all'}
            onClick={() => setActiveCat('all')}
            className={tabClass(activeCat === 'all')}
          >
            すべて
            <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
              {liveItems.length}
            </span>
          </button>
          {presentCats.map((cat) => {
            const m = CATEGORY_META[cat];
            const isSel = activeCat === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={isSel}
                onClick={() => setActiveCat(cat)}
                className={tabClass(isSel)}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: m.color }}
                  aria-hidden
                />
                {m.label}
                <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
                  {counts[cat]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          <>
            {/* エージェント承認リクエストセクション（pending が 1 件以上のときだけ表示） */}
            {liveRequests.length > 0 && (
              <div className="mb-6">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  エージェントからのリクエスト
                </p>
                <ul className="space-y-2">
                  {liveRequests.map((req) => (
                    <RequestCard
                      key={req.id}
                      req={req}
                      onResolved={handleRequestResolved}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* 既存のタスクタグ由来の承認フロー */}
            {filtered.length === 0 ? (
              <EmptyState>
                {liveItems.length === 0
                  ? (liveRequests.length === 0 ? '承認が必要な項目はありません。' : '')
                  : 'このカテゴリに該当する項目はありません。'}
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {filtered.map((item) => (
                  <ApprovalCard
                    key={`${item.source}:${item.id}`}
                    item={item}
                    onOpen={setSelected}
                    onResolved={handleResolved}
                  />
                ))}
              </ul>
            )}
          </>
        </ResourceState>
      </div>

      <TaskDetail task={selected} onClose={() => setSelected(null)} onChanged={refetch} />
    </div>
  );
}

