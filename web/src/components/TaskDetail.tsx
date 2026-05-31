// TaskDetail（MC-61）— タスクカードのドリルダウン詳細。
// ドロワー（md 以上は右スライド、モバイルは下からのボトムシート/フルスクリーン）で
//   (a) 概要・ステータス・担当・出典（既存 /api/tasks の Task データ）
//   (b) 紐づく workflow run のフェーズ進捗（MC-60 /api/workflows・/api/workflows/:runId）
//   (c) 紐づくエージェント会話（既存 Feed の該当スレッド = /api/agents/:id/feed を AgentFeed で再利用）
// を一望表示する。
//
// 紐付けロジックは暫定（MC-62 で精緻化予定）:
//   タスク ID を workflow run の runId/label に素朴に部分一致でフィルタ。
//   1 件も一致しなければ「全 run 一覧」を候補として表示する（空状態にしない）。
//   ※ 将来 MC-62（明示ログ紐付け）で誤マッチを排除・精緻化する。
//
// デザイン制約: ハードコード hex 禁止（既存トークン/CSS 変数のみ）、UI chrome は SVG アイコンのみ、
//   文言は中立的な丁寧体、モバイル 390px で横溢れ 0。

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentStatus, ProjectName, Task } from '../lib/types';
import { agentStatusMeta, projectColor, projectLabel, taskStatusMeta } from '../lib/meta';
import { absoluteTime, relativeTime } from '../lib/time';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import { Badge, Spinner, StalledBadge, TaskStatusBadge } from './ui';
import { AgentFeed } from './AgentFeed';
import { CloseIcon } from './icons';

// ── workflow API の型（server/src/collectors/workflows.ts の WorkflowSummary と一致させる）──
interface WorkflowNode {
  agentId: string;
  label: string;
  agentType: string | null;
  status: AgentStatus | 'error';
  lastActivity: string;
  stalledMinutes: number;
  tokensIn: number;
  tokensOut: number;
  messageCount: number;
}

interface WorkflowPhase {
  id: string;
  name: string;
  status: AgentStatus | 'error';
  nodes: WorkflowNode[];
}

interface WorkflowSummary {
  runId: string;
  label: string;
  project: ProjectName;
  projectLabel: string;
  status: AgentStatus | 'error';
  createdAt: string;
  lastActivity: string;
  stalledMinutes: number;
  phaseCount: number;
  phasesDone: number;
  nodeCount: number;
  nodesDone: number;
  tokensIn: number;
  tokensOut: number;
}

interface WorkflowDetail extends WorkflowSummary {
  phases: WorkflowPhase[];
}

// AgentStatus に 'error' を足したワークフロー固有の状態色（既存 CSS 変数のみ使用）。
function wfStatusMeta(status: AgentStatus | 'error'): { label: string; color: string } {
  if (status === 'error') return { label: 'エラー', color: 'var(--mc-stalled)' };
  const m = agentStatusMeta(status as AgentStatus);
  return { label: m.label, color: m.color };
}

function tokensLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** タスク ID 表記ゆれを正規化して比較する（MC-62 で精緻化予定の暫定実装）。 */
function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '');
}

/** runId/label にタスク ID を素朴に含むかどうか（暫定の紐付け）。 */
function runMatchesTask(run: WorkflowSummary, taskId: string): boolean {
  const id = normalizeId(taskId);
  if (!id) return false;
  return normalizeId(run.runId).includes(id) || normalizeId(run.label).includes(id);
}

function StatusDotInline({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-label={`状態: ${label}`}>
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span className="text-[11px]" style={{ color }}>
        {label}
      </span>
    </span>
  );
}

/** 1 件の workflow run（フェーズ進捗 + 孫エージェント）を表示。クリックで詳細を展開。 */
function WorkflowRunRow({ run }: { run: WorkflowSummary }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = wfStatusMeta(run.status);

  useEffect(() => {
    if (!open || detail) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/workflows/${encodeURIComponent(run.runId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { workflow: WorkflowDetail } | WorkflowDetail;
      })
      .then((d) => {
        if (cancelled) return;
        // server は { workflow } で包む可能性／生で返す可能性の両対応。
        const wf = (d as { workflow?: WorkflowDetail }).workflow ?? (d as WorkflowDetail);
        setDetail(wf);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, detail, run.runId]);

  return (
    <li className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-surface-2"
        aria-expanded={open}
      >
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: meta.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-all font-mono text-[11px] text-text">{run.label}</span>
            <Badge title={`プロジェクト: ${run.projectLabel}`}>{run.projectLabel}</Badge>
            <span className="text-[11px]" style={{ color: meta.color }}>
              {meta.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-faint">
            <span>
              ノード {run.nodesDone}/{run.nodeCount}
            </span>
            <span title={absoluteTime(run.lastActivity)}>更新 {relativeTime(run.lastActivity)}</span>
            <span>
              トークン {tokensLabel(run.tokensIn)} / {tokensLabel(run.tokensOut)}
            </span>
          </div>
        </div>
        <span className="mt-0.5 shrink-0 text-[11px] text-accent">{open ? '閉じる' : '開く'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2.5">
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Spinner />
              フェーズを取得しています…
            </div>
          )}
          {error && (
            <p className="text-[12px]" style={{ color: 'var(--mc-stalled)' }} role="alert">
              詳細の取得に失敗しました（{error}）。
            </p>
          )}
          {detail && (
            <div className="space-y-3">
              {detail.phases.map((phase) => {
                const pmeta = wfStatusMeta(phase.status);
                return (
                  <div key={phase.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <StatusDotInline color={pmeta.color} label={`${phase.name}（${pmeta.label}）`} />
                      <span className="text-[10px] text-text-faint">
                        {phase.nodes.length} ノード
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {phase.nodes.map((node) => {
                        const nmeta = wfStatusMeta(node.status);
                        return (
                          <li
                            key={node.agentId}
                            className="flex items-start gap-2 rounded border border-border bg-surface-2 px-2.5 py-1.5"
                          >
                            <span
                              className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: nmeta.color }}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="text-[12px] font-medium text-text">
                                  {node.label}
                                </span>
                                <span className="text-[10px]" style={{ color: nmeta.color }}>
                                  {nmeta.label}
                                </span>
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[10px] text-text-faint">
                                <span title={absoluteTime(node.lastActivity)}>
                                  {relativeTime(node.lastActivity)}
                                </span>
                                <span>
                                  トークン {tokensLabel(node.tokensIn)} / {tokensLabel(node.tokensOut)}
                                </span>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                      {phase.nodes.length === 0 && (
                        <li className="px-1 py-1 text-[11px] text-text-faint">
                          このフェーズにノードはありません。
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** 紐づく workflow run の一覧セクション（暫定フィルタ + フォールバック）。 */
function LinkedWorkflows({ task }: { task: Task }) {
  const tick = useLiveTick();
  const { data, error, loading } = useLiveResource<{ workflows: WorkflowSummary[] }>(
    '/api/workflows',
    tick,
  );

  const all = useMemo(() => data?.workflows ?? [], [data]);
  const matched = useMemo(
    () => all.filter((w) => runMatchesTask(w, task.id)),
    [all, task.id],
  );
  // 暫定: ID 一致が無ければ全 run を候補として出す（MC-62 で精緻化）。
  const hasMatch = matched.length > 0;
  const shown = hasMatch ? matched : all;

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-muted">
        <Spinner />
        ワークフローを取得しています…
      </div>
    );
  }
  if (error && !data) {
    return (
      <p className="text-[12px]" style={{ color: 'var(--mc-stalled)' }} role="alert">
        ワークフローの取得に失敗しました（{error}）。
      </p>
    );
  }
  if (shown.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
        紐づくワークフローはありません。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!hasMatch && (
        <p className="text-[11px] text-text-faint">
          このタスクに紐づくワークフローは特定できませんでした。直近のワークフロー一覧を表示しています。
        </p>
      )}
      <ul className="space-y-2">
        {shown.map((run) => (
          <WorkflowRunRow key={run.runId} run={run} />
        ))}
      </ul>
    </div>
  );
}

/** 紐づくエージェント会話セクション。暫定で run の孫エージェントを候補に出す（MC-62 で精緻化）。 */
function LinkedConversation({ task }: { task: Task }) {
  const tick = useLiveTick();
  const { data } = useLiveResource<{ workflows: WorkflowSummary[] }>('/api/workflows', tick);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  const all = useMemo(() => data?.workflows ?? [], [data]);
  const matched = useMemo(() => all.filter((w) => runMatchesTask(w, task.id)), [all, task.id]);
  // 会話候補は「紐づく run（無ければ最新 run）」の孫エージェント。
  const targetRun = matched[0] ?? all[0];

  useEffect(() => {
    if (!targetRun) {
      setNodes(null);
      setAgentId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/workflows/${encodeURIComponent(targetRun.runId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { workflow?: WorkflowDetail } | WorkflowDetail;
      })
      .then((d) => {
        if (cancelled) return;
        const wf = (d as { workflow?: WorkflowDetail }).workflow ?? (d as WorkflowDetail);
        const ns = wf.phases.flatMap((p) => p.nodes);
        setNodes(ns);
        setAgentId(ns[0]?.agentId ?? null);
      })
      .catch(() => {
        if (!cancelled) setNodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetRun]);

  if (!targetRun) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
        紐づくエージェント会話はありません。
      </p>
    );
  }

  if (loading && !nodes) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-muted">
        <Spinner />
        会話の候補を取得しています…
      </div>
    );
  }

  if (!nodes || nodes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
        表示できるエージェント会話はありません。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {matched.length === 0 && (
        <p className="text-[11px] text-text-faint">
          このタスクに紐づく会話は特定できませんでした。直近のワークフローの会話を表示しています。
        </p>
      )}
      {nodes.length > 1 && (
        <div
          className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1"
          role="group"
          aria-label="会話するエージェントを選択"
        >
          {nodes.map((n) => {
            const selected = n.agentId === agentId;
            return (
              <button
                key={n.agentId}
                type="button"
                onClick={() => setAgentId(n.agentId)}
                className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] ${
                  selected
                    ? 'bg-surface-3 font-semibold text-text'
                    : 'text-text-muted hover:bg-surface-2'
                }`}
                aria-pressed={selected}
              >
                {n.label}
              </button>
            );
          })}
        </div>
      )}
      {agentId && (
        <div className="rounded-lg border border-border bg-surface px-3 py-3">
          <AgentFeed agentId={agentId} />
        </div>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-faint">
      {children}
    </h3>
  );
}

/** タスク詳細ドロワー本体。task が null の間は何も描画しない。 */
export function TaskDetail({ task, onClose }: { task: Task | null; onClose: () => void }) {
  // Esc クローズ + 背面スクロールロック。
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [task, onClose]);

  if (!task) return null;
  const statusMeta = taskStatusMeta(task.status);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`タスク詳細: ${task.title}`}
    >
      {/* 背面オーバーレイ */}
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      {/* ドロワー本体: モバイルは全幅・上から少し空けたフルハイト、md 以上は右スライドのパネル */}
      <div
        className="relative flex h-full w-full max-w-full flex-col border-l border-border bg-bg shadow-xl md:w-[34rem]"
        style={{ borderTop: `3px solid ${projectColor(task.project)}` }}
      >
        {/* ヘッダ */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-text-faint">{task.id}</span>
              {task.stalled && <StalledBadge />}
            </div>
            <h2 className="mt-1 text-[15px] font-bold leading-snug text-text">{task.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* (a) 概要 */}
          <section className="mb-5">
            <SectionHeading>概要</SectionHeading>
            <dl className="space-y-2 text-[13px]">
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-text-faint">ステータス</dt>
                <dd>
                  <TaskStatusBadge status={task.status} />
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-text-faint">プロジェクト</dt>
                <dd className="inline-flex items-center gap-1.5 text-text">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: projectColor(task.project) }}
                    aria-hidden
                  />
                  {projectLabel(task.project)}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-text-faint">担当</dt>
                <dd className="text-text">{task.owner || '未割り当て'}</dd>
              </div>
              {task.priority && (
                <div className="flex items-center gap-2">
                  <dt className="w-20 shrink-0 text-text-faint">優先度</dt>
                  <dd>
                    <Badge>{task.priority}</Badge>
                  </dd>
                </div>
              )}
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-text-faint">出典</dt>
                <dd className="break-all text-text-muted">{task.source}</dd>
              </div>
              {task.updated && (
                <div className="flex items-center gap-2">
                  <dt className="w-20 shrink-0 text-text-faint">更新</dt>
                  <dd className="text-text-muted" title={absoluteTime(task.updated)}>
                    {relativeTime(task.updated)}
                  </dd>
                </div>
              )}
            </dl>
            {/* ステータスの語ラベル（色のみ依存にしない） */}
            <p className="mt-2 text-[11px]" style={{ color: statusMeta.color }}>
              現在の状態: {statusMeta.label}
            </p>
          </section>

          {/* (b) 紐づくワークフロー */}
          <section className="mb-5">
            <SectionHeading>紐づくワークフロー</SectionHeading>
            <LinkedWorkflows task={task} />
          </section>

          {/* (c) 紐づくエージェント会話 */}
          <section>
            <SectionHeading>紐づくエージェント会話</SectionHeading>
            <LinkedConversation task={task} />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
