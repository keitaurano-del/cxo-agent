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
import type {
  ApprovalHistoryResponse,
  ApprovalItem,
  ApprovalKind,
  ApprovalRequest,
  ApprovalsResponse,
  AutoModeResponse,
  DecisionsResponse,
  HistoryEntry,
  Task,
} from '../lib/types';
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
import { ApprovalIcon, ChevronRightIcon, CloseIcon } from '../components/icons';
import DecisionsPanel from './DecisionsPanel';

// 「確認・指示待ち」枠に入れるカテゴリ（要望3）。それ以外は「承認待ち（要対応）」枠。
const CONFIRM_KINDS = new Set<ApprovalKind>(['confirm', 'blocked']);

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

/**
 * エージェント承認リクエストの 1 件カード。
 * variant='confirm' のときは「確認・指示待ち」枠向けにラベルを「確認した」「却下/保留」に変える（要望3）。
 */
function RequestCard({
  req,
  onResolved,
  variant = 'approve',
}: {
  req: ApprovalRequest;
  onResolved: (id: string) => void;
  variant?: 'approve' | 'confirm';
}) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);
  const catMeta = CATEGORY_META[req.category as ApprovalKind] ?? CATEGORY_META['confirm'];
  const approveLabel = variant === 'confirm' ? '確認した' : '承認する';
  const rejectLabel = variant === 'confirm' ? '却下/保留' : '却下する';

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
                {rejectLabel}
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
                {approveLabel}
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

/**
 * 1 件の承認カード。
 * variant='confirm' のとき「確認・指示待ち」枠向けにラベルを「確認した」「却下/保留」に変える（要望3）。
 */
function ApprovalCard({
  item,
  onOpen,
  onResolved,
  variant = 'approve',
}: {
  item: ApprovalItem;
  onOpen: (t: Task) => void;
  onResolved: (id: string, source: string) => void;
  variant?: 'approve' | 'confirm';
}) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);
  const statusMeta = taskStatusMeta(item.status);
  const approveLabel = variant === 'confirm' ? '確認した' : '承認する';
  const rejectLabel = variant === 'confirm' ? '却下/保留' : '却下する';

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
                {rejectLabel}
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
                {approveLabel}
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

// ── 承認済・履歴（要望1・2）──────────────────────────────────────────────
//
// /api/approvals/history を購読し、決定済み（承認/却下）を新しい順で読み取り専用一覧表示する。
// autoApproved のとき「オート」バッジを出して自動承認と判別できるようにする（要望2）。

/** 履歴 1 行（読み取り専用）。 */
function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const approved = entry.decision === 'approve';
  const decColor = approved ? 'var(--mc-active)' : 'var(--mc-stalled)';
  const decBg = approved ? 'var(--mc-active-bg)' : 'var(--mc-stalled-bg)';
  const decLabel = approved ? '承認' : '却下';
  const title = entry.title ?? entry.id;
  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={decColor} bg={decBg}>{decLabel}</Badge>
        {entry.autoApproved && (
          <Badge color="var(--mc-accent)" bg="var(--mc-surface-3)" title="オートモードによる自動承認">
            オート
          </Badge>
        )}
        {entry.categories.map((c) => (
          <CategoryBadge key={c} kind={c} />
        ))}
        {entry.decidedAt && (
          <span
            className="ml-auto text-[10px] text-text-faint"
            title={absoluteTime(entry.decidedAt)}
          >
            {relativeTime(entry.decidedAt)}
          </span>
        )}
      </div>
      <p className="mt-1 break-words text-[12px] leading-snug text-text">{title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-faint">
        {entry.fromName && <span>{entry.fromName}</span>}
        {entry.kind === 'task' && <span className="font-mono">{entry.id}</span>}
        {entry.comment && <span className="break-words text-text-muted">「{entry.comment}」</span>}
      </div>
    </li>
  );
}

/** 承認済・履歴セクション（折りたたみ）。独立購読で /api/approvals/history を読む。 */
function HistorySection({ tick }: { tick: number }) {
  const [open, setOpen] = useState(false);
  const { data } = useLiveResource<ApprovalHistoryResponse>('/api/approvals/history', tick);
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
          承認済・履歴
        </span>
        <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
          {entries.length}
        </span>
      </button>
      {open && (
        <div className="mt-3">
          {entries.length === 0 ? (
            <EmptyState>まだ決定の履歴はありません。</EmptyState>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <HistoryRow key={`${e.kind}:${e.id}:${e.decidedAt}`} entry={e} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
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
          エージェントの承認リクエストを全カテゴリ自動承認中（デプロイ可否を含む）。
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
  // 決裁（MC-203）は別系統。件数バッジ用に pending 数だけ購読する（中身は DecisionsPanel が表示）。
  const { data: decisionsData } = useLiveResource<DecisionsResponse>('/api/decisions', tick);
  const decisionCount = decisionsData?.decisions.length ?? 0;
  // 上位タブ: 承認フロー / 決裁（専用タブ＝MC-203 機能②）。
  const [mode, setMode] = useState<'approval' | 'decision'>('approval');
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

  // セクション1「承認待ち（要対応）」: confirm/blocked 以外のカテゴリを持つ項目（deploy/design/approval）。
  const approvalItems = useMemo(
    () => filtered.filter((it) => it.categories.some((c) => !CONFIRM_KINDS.has(c))),
    [filtered],
  );
  // セクション2「確認・指示待ち」: confirm または blocked カテゴリの項目（別枠・要望3）。
  const confirmItems = useMemo(
    () => filtered.filter((it) => it.categories.some((c) => CONFIRM_KINDS.has(c))),
    [filtered],
  );

  // リクエストも activeCat で絞り込む（リクエストの category は単一）。
  const filteredRequests = useMemo(
    () =>
      activeCat === 'all'
        ? liveRequests
        : liveRequests.filter((r) => (r.category as ApprovalKind) === activeCat),
    [liveRequests, activeCat],
  );
  // セクション1 のリクエスト（confirm 以外）。
  const approvalRequests = useMemo(
    () => filteredRequests.filter((r) => !CONFIRM_KINDS.has(r.category as ApprovalKind)),
    [filteredRequests],
  );
  // セクション2 のリクエスト（confirm。リクエストに blocked は無い）。
  const confirmRequests = useMemo(
    () => filteredRequests.filter((r) => CONFIRM_KINDS.has(r.category as ApprovalKind)),
    [filteredRequests],
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

      {/* 上位タブ: 承認フロー / 決裁（専用タブ＝MC-203 機能②。決裁は別系統・別オートモード）。 */}
      <div className="border-b border-border px-4 py-2 md:px-6">
        <div className="flex items-center gap-1" role="tablist" aria-label="承認 / 決裁の切り替え">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'approval'}
            onClick={() => setMode('approval')}
            className={tabClass(mode === 'approval')}
          >
            <ApprovalIcon width={13} height={13} />
            承認
            <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
              {liveItems.length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'decision'}
            onClick={() => setMode('decision')}
            className={tabClass(mode === 'decision')}
          >
            <ApprovalIcon width={13} height={13} />
            決裁
            <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
              {decisionCount}
            </span>
          </button>
        </div>
      </div>

      {mode === 'decision' ? (
        <DecisionsPanel />
      ) : (
        <ApprovalFlowBody
          data={data}
          error={error}
          loading={loading}
          activeCat={activeCat}
          setActiveCat={setActiveCat}
          presentCats={presentCats}
          counts={counts}
          liveItems={liveItems}
          liveRequests={liveRequests}
          approvalItems={approvalItems}
          confirmItems={confirmItems}
          approvalRequests={approvalRequests}
          confirmRequests={confirmRequests}
          setSelected={setSelected}
          handleResolved={handleResolved}
          handleRequestResolved={handleRequestResolved}
          tick={tick}
          tabClass={tabClass}
        />
      )}

      <TaskDetail task={selected} onClose={() => setSelected(null)} onChanged={refetch} />
    </div>
  );
}

/** 承認フロー本体（カテゴリタブ＋オートモード＋セクション＋履歴）。決裁タブ追加に伴い分離。 */
function ApprovalFlowBody({
  data,
  error,
  loading,
  activeCat,
  setActiveCat,
  presentCats,
  counts,
  liveItems,
  liveRequests,
  approvalItems,
  confirmItems,
  approvalRequests,
  confirmRequests,
  setSelected,
  handleResolved,
  handleRequestResolved,
  tick,
  tabClass,
}: {
  data: ApprovalsResponse | null;
  error: string | null;
  loading: boolean;
  activeCat: ApprovalKind | 'all';
  setActiveCat: (c: ApprovalKind | 'all') => void;
  presentCats: ApprovalKind[];
  counts: Record<ApprovalKind, number>;
  liveItems: ApprovalItem[];
  liveRequests: ApprovalRequest[];
  approvalItems: ApprovalItem[];
  confirmItems: ApprovalItem[];
  approvalRequests: ApprovalRequest[];
  confirmRequests: ApprovalRequest[];
  setSelected: (t: Task) => void;
  handleResolved: (id: string, source: string) => void;
  handleRequestResolved: (id: string) => void;
  tick: number;
  tabClass: (selected: boolean) => string;
}) {
  return (
    <>
      {/* オートモードのトグル（MC-190。ON で全カテゴリ自動承認＝deploy 含む。2026-06-07 Keita 判断）。 */}
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
            {(() => {
              const approvalCount = approvalItems.length + approvalRequests.length;
              const confirmCount = confirmItems.length + confirmRequests.length;
              const nothing = approvalCount === 0 && confirmCount === 0;
              return (
                <>
                  {/* セクション1: 承認待ち（要対応）＝ deploy/design/approval のリクエスト＋タスク */}
                  {approvalCount > 0 && (
                    <section className="mb-8">
                      <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        <ApprovalIcon width={13} height={13} />
                        承認待ち（要対応）
                        <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
                          {approvalCount}
                        </span>
                      </p>
                      <ul className="space-y-2">
                        {approvalRequests.map((req) => (
                          <RequestCard key={req.id} req={req} onResolved={handleRequestResolved} />
                        ))}
                        {approvalItems.map((item) => (
                          <ApprovalCard
                            key={`${item.source}:${item.id}`}
                            item={item}
                            onOpen={setSelected}
                            onResolved={handleResolved}
                          />
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* セクション2: 確認・指示待ち（別枠。背景色で承認待ちと視覚的に区別＝要望3） */}
                  {confirmCount > 0 && (
                    <section
                      className="mb-8 rounded-xl border border-border p-3"
                      style={{ background: 'var(--mc-idle-bg)' }}
                    >
                      <p
                        className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--mc-idle)' }}
                      >
                        <ApprovalIcon width={13} height={13} />
                        確認・指示待ち
                        <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
                          {confirmCount}
                        </span>
                      </p>
                      <p className="mb-2 break-words text-[11px] leading-relaxed text-text-muted">
                        Keita の確認・指示をお待ちしています。確認できたら「確認した」で解消できます。
                      </p>
                      <ul className="space-y-2">
                        {confirmRequests.map((req) => (
                          <RequestCard
                            key={req.id}
                            req={req}
                            onResolved={handleRequestResolved}
                            variant="confirm"
                          />
                        ))}
                        {confirmItems.map((item) => (
                          <ApprovalCard
                            key={`${item.source}:${item.id}`}
                            item={item}
                            onOpen={setSelected}
                            onResolved={handleResolved}
                            variant="confirm"
                          />
                        ))}
                      </ul>
                    </section>
                  )}

                  {nothing && (
                    <EmptyState>
                      {liveItems.length === 0 && liveRequests.length === 0
                        ? '承認が必要な項目はありません。'
                        : 'このカテゴリに該当する項目はありません。'}
                    </EmptyState>
                  )}
                </>
              );
            })()}

            {/* セクション3: 承認済・履歴（読み取り専用・折りたたみ＝要望1・2） */}
            <HistorySection tick={tick} />
          </>
        </ResourceState>
      </div>
    </>
  );
}

