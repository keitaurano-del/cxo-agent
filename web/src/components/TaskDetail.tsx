// TaskDetail（MC-61）— タスクカードのドリルダウン詳細。
// ドロワー（md 以上は右スライド、モバイルは下からのボトムシート/フルスクリーン）で
//   (a) 概要・ステータス・担当・出典（既存 /api/tasks の Task データ）
//   (b) 紐づく workflow run のフェーズ進捗（MC-60 /api/workflows・/api/workflows/:runId）
//   (c) 紐づくエージェント会話（既存 Feed の該当スレッド = /api/agents/:id/feed を AgentFeed で再利用）
// を一望表示する。
//
// 紐付けロジック（MC-62 で精緻化済み）:
//   data/task-links.jsonl の明示ログ（/api/tasks/:taskId/links）を最優先で使う。
//   明示リンクがあれば、その runId / agentId のものだけを表示（誤マッチを構造的に排除）。
//   明示リンクが 1 件も無いタスクは、従来の素朴フォールバック
//   （タスク ID を runId/label に部分一致 → 無ければ全 run 候補）を維持する。
//
// デザイン制約: ハードコード hex 禁止（既存トークン/CSS 変数のみ）、UI chrome は SVG アイコンのみ、
//   文言は中立的な丁寧体、モバイル 390px で横溢れ 0。

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  AgentStatus,
  DeployRepo,
  DeployRun,
  DeploysResponse,
  ProjectName,
  Task,
  TaskStatus,
} from '../lib/types';
import {
  agentStatusMeta,
  projectColor,
  projectLabel,
  taskStatusMeta,
  TASK_COLUMNS,
} from '../lib/meta';
import { absoluteTime, relativeTime } from '../lib/time';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import { Badge, Spinner, StalledBadge, TaskStatusBadge } from './ui';
import { AgentFeed } from './AgentFeed';
import { CloseIcon, EditIcon } from './icons';

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

// ── 明示リンク API（server /api/tasks/:taskId/links と一致させる）──
interface TaskLink {
  taskId: string;
  runId?: string;
  agentId?: string;
  label?: string;
  ts?: string;
}

interface TaskLinkRun {
  runId: string;
  summary: WorkflowSummary | null;
}

interface TaskLinksResponse {
  taskId: string;
  hasExplicitLinks: boolean;
  runs: TaskLinkRun[];
  agentIds: string[];
  links: TaskLink[];
  generatedAt: string;
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

/** タスク ID 表記ゆれを正規化して比較する（フォールバックの素朴一致でのみ使用）。 */
function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * runId/label にタスク ID を素朴に含むかどうか（フォールバック専用）。
 * 明示リンク（task-links.jsonl）が無いタスクのときだけ使う。
 */
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

/**
 * 紐づく workflow run の一覧セクション。
 * - 明示リンク（task-links.jsonl）がある場合: そのリンク先 run のみを表示（誤マッチ排除）。
 *   突合できなかった runId（run が消えた / 別環境）はその旨を添えて runId だけ示す。
 * - 明示リンクが無い場合: 従来の素朴フィルタ（無ければ全 run 候補）にフォールバック。
 */
function LinkedWorkflows({ task, links }: { task: Task; links: TaskLinksResponse | null }) {
  const tick = useLiveTick();
  const { data, error, loading } = useLiveResource<{ workflows: WorkflowSummary[] }>(
    '/api/workflows',
    tick,
  );

  const all = useMemo(() => data?.workflows ?? [], [data]);

  // 明示リンクの有無で表示集合を切り替える。
  const explicit = links?.hasExplicitLinks ?? false;
  const explicitRuns = useMemo(
    () => (links?.runs ?? []).filter((r) => r.summary !== null).map((r) => r.summary as WorkflowSummary),
    [links],
  );
  const unresolvedRunIds = useMemo(
    () => (links?.runs ?? []).filter((r) => r.summary === null).map((r) => r.runId),
    [links],
  );

  const fallbackMatched = useMemo(
    () => all.filter((w) => runMatchesTask(w, task.id)),
    [all, task.id],
  );
  const fallbackHasMatch = fallbackMatched.length > 0;
  const shown = explicit ? explicitRuns : fallbackHasMatch ? fallbackMatched : all;

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

  if (shown.length === 0 && unresolvedRunIds.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
        紐づくワークフローはありません。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!explicit && fallbackHasMatch === false && shown.length > 0 && (
        <p className="text-[11px] text-text-faint">
          このタスクに紐づくワークフローは特定できませんでした。直近のワークフロー一覧を表示しています。
        </p>
      )}
      <ul className="space-y-2">
        {shown.map((run) => (
          <WorkflowRunRow key={run.runId} run={run} />
        ))}
      </ul>
      {unresolvedRunIds.length > 0 && (
        <ul className="space-y-1.5">
          {unresolvedRunIds.map((runId) => (
            <li
              key={runId}
              className="rounded-lg border border-dashed border-border bg-surface px-3 py-2 text-[11px] text-text-faint"
            >
              <span className="break-all font-mono text-text-muted">{runId}</span>
              <span className="ml-2">（このワークフローは現在の環境では見つかりませんでした）</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 紐づくエージェント会話セクション。
 * - 明示リンクに agentId があれば、その会話を最優先候補にする（誤マッチ排除）。
 * - 明示リンクに runId があれば、その run の孫エージェントも候補に加える。
 * - 明示リンクが無い場合: 従来どおり「素朴一致 run（無ければ最新 run）」の孫を候補にする。
 */
function LinkedConversation({ task, links }: { task: Task; links: TaskLinksResponse | null }) {
  const tick = useLiveTick();
  const { data } = useLiveResource<{ workflows: WorkflowSummary[] }>('/api/workflows', tick);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  const all = useMemo(() => data?.workflows ?? [], [data]);
  const explicit = links?.hasExplicitLinks ?? false;
  const explicitAgentIds = useMemo(() => links?.agentIds ?? [], [links]);

  // 会話の元になる run を決める:
  //   明示リンクあり → リンク先 run の先頭（突合できたもの）。
  //   明示リンクなし → 素朴一致 run の先頭、無ければ最新 run。
  const fallbackMatched = useMemo(
    () => all.filter((w) => runMatchesTask(w, task.id)),
    [all, task.id],
  );
  const explicitFirstRun = useMemo(
    () => (links?.runs ?? []).find((r) => r.summary !== null)?.summary ?? null,
    [links],
  );
  const targetRun = explicit ? explicitFirstRun : (fallbackMatched[0] ?? all[0] ?? null);

  // run の孫エージェント nodes を取得（run がある場合）。
  useEffect(() => {
    if (!targetRun) {
      setNodes([]);
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
        setNodes(wf.phases.flatMap((p) => p.nodes));
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

  // 会話タブの候補 = 明示 agentId（run に無くても出す）+ run の孫エージェント。
  // 明示リンクがあり agentId も run も無いケースはここで空になる。
  const candidates = useMemo<{ agentId: string; label: string }[]>(() => {
    const map = new Map<string, string>();
    if (explicit) {
      for (const aid of explicitAgentIds) {
        map.set(aid, links?.links.find((l) => l.agentId === aid)?.label ?? aid.slice(0, 8));
      }
    }
    for (const n of nodes ?? []) {
      if (!map.has(n.agentId)) map.set(n.agentId, n.label);
    }
    return [...map.entries()].map(([aid, label]) => ({ agentId: aid, label }));
  }, [explicit, explicitAgentIds, links, nodes]);

  // 候補が決まったら選択中 agentId を初期化/補正する。
  useEffect(() => {
    if (candidates.length === 0) {
      setAgentId(null);
      return;
    }
    setAgentId((cur) => (cur && candidates.some((c) => c.agentId === cur) ? cur : candidates[0].agentId));
  }, [candidates]);

  if (loading && (nodes === null)) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-muted">
        <Spinner />
        会話の候補を取得しています…
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
        紐づくエージェント会話はありません。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!explicit && fallbackMatched.length === 0 && (
        <p className="text-[11px] text-text-faint">
          このタスクに紐づく会話は特定できませんでした。直近のワークフローの会話を表示しています。
        </p>
      )}
      {candidates.length > 1 && (
        <div
          className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1"
          role="group"
          aria-label="会話するエージェントを選択"
        >
          {candidates.map((c) => {
            const selected = c.agentId === agentId;
            return (
              <button
                key={c.agentId}
                type="button"
                onClick={() => setAgentId(c.agentId)}
                className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] ${
                  selected
                    ? 'bg-surface-3 font-semibold text-text'
                    : 'text-text-muted hover:bg-surface-2'
                }`}
                aria-pressed={selected}
              >
                {c.label}
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

// ── デプロイ状況（MC-64）─────────────────────────────────────
// /api/deploys（GitHub Actions deploy 系 workflow の直近 run）を取得し、
// このタスクの project に対応する repo の run 状態を表示する。
// 状態の色には必ず語ラベルを併記（a11y）。エラー・空はそれぞれ中立的な空状態を出し、
// TaskDetail 全体を壊さない。logic / en-chakai 以外の project は対象外として中立表示。

/** deploy run の状態（status + conclusion）を語ラベル + 既存 CSS 変数色に写像。 */
function deployRunMeta(run: DeployRun): { label: string; color: string } {
  if (run.status === 'completed') {
    switch (run.conclusion) {
      case 'success':
        return { label: '成功', color: 'var(--mc-done)' };
      case 'failure':
        return { label: '失敗', color: 'var(--mc-stalled)' };
      case 'cancelled':
        return { label: '中止', color: 'var(--mc-text-faint)' };
      case 'timed_out':
        return { label: 'タイムアウト', color: 'var(--mc-stalled)' };
      case 'skipped':
        return { label: 'スキップ', color: 'var(--mc-text-faint)' };
      default:
        return { label: run.conclusion ?? '完了', color: 'var(--mc-text-muted)' };
    }
  }
  if (run.status === 'in_progress') return { label: '実行中', color: 'var(--mc-active)' };
  if (run.status === 'queued') return { label: '待機中', color: 'var(--mc-idle)' };
  return { label: run.status || '不明', color: 'var(--mc-text-muted)' };
}

/** workflow ファイル名を読みやすい短縮ラベルにする。 */
function workflowLabel(workflow: string): string {
  if (workflow === 'deploy-production.yml') return '本番デプロイ';
  if (workflow === 'android-deploy.yml') return 'Android 配信';
  return workflow.replace(/\.ya?ml$/i, '');
}

/** 1 件の deploy run の表示行。 */
function DeployRunRow({ run }: { run: DeployRun }) {
  const meta = deployRunMeta(run);
  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: meta.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge title={`ワークフロー: ${run.workflow}`}>{workflowLabel(run.workflow)}</Badge>
            <span
              className="text-[11px]"
              style={{ color: meta.color }}
              role="status"
              aria-label={`デプロイ状態: ${meta.label}`}
            >
              {meta.label}
            </span>
          </div>
          {run.title && (
            <p className="mt-1 break-words text-[12px] text-text-muted">{run.title}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-faint">
            {run.branch && <span className="break-all font-mono">{run.branch}</span>}
            {run.event && <span>{run.event}</span>}
            {run.updatedAt && (
              <span title={absoluteTime(run.updatedAt)}>更新 {relativeTime(run.updatedAt)}</span>
            )}
          </div>
        </div>
        {run.url && (
          <a
            href={run.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 shrink-0 text-[11px] text-accent hover:underline"
          >
            開く
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * タスクの project に対応する repo の直近 deploy run を表示するセクション。
 * - project が deploy 連動対象（logic / en-chakai）でない → 中立の空状態。
 * - 対象だが run が無い → 中立の空状態。
 * - GitHub API エラー（repo.error） → エラー空状態（TaskDetail は壊さない）。
 */
function LinkedDeploys({ task }: { task: Task }) {
  const tick = useLiveTick();
  const { data, error, loading } = useLiveResource<DeploysResponse>('/api/deploys', tick);

  const repo = useMemo<DeployRepo | null>(() => {
    if (!data) return null;
    return data.repos.find((r) => r.project === task.project) ?? null;
  }, [data, task.project]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-muted">
        <Spinner />
        デプロイ状況を取得しています…
      </div>
    );
  }

  // /api/deploys 自体の取得失敗（ネットワーク等）。前回値が無いときのみエラー表示。
  if (error && !data) {
    return (
      <p
        className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px]"
        style={{ color: 'var(--mc-stalled)' }}
        role="alert"
      >
        デプロイ状況の取得に失敗しました（{error}）。
      </p>
    );
  }

  // このタスクの project が deploy 連動対象でない（cxo / private 等）。
  if (!repo) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
        このプロジェクトはデプロイ連動の対象ではありません。
      </p>
    );
  }

  // repo 単位の GitHub API エラー（gh 不在・未認証・レート・タイムアウト等）。
  if (repo.error) {
    return (
      <p
        className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px]"
        style={{ color: 'var(--mc-stalled)' }}
        role="alert"
      >
        デプロイ状況を取得できませんでした（{repo.error}）。
      </p>
    );
  }

  if (repo.runs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
        デプロイ実行はありません。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-faint">
        <span className="break-all font-mono">{repo.repo}</span> の直近のデプロイ実行です。
      </p>
      <ul className="space-y-2">
        {repo.runs.map((run) => (
          <DeployRunRow key={`${run.workflow}-${run.id}`} run={run} />
        ))}
      </ul>
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

// ── 編集（MC-71 edit スライス）─────────────────────────────
// source が logic/ ・ nishimaru/ ・ cxo/ で始まる台帳のみ Apollo から編集できる。
// kanban/today/private 等は .md 直接編集を促す（編集ボタンを出さない）。
const EDITABLE_SOURCE_PREFIXES = ['logic/', 'nishimaru/', 'cxo/'];

function isEditableSource(source: string): boolean {
  return EDITABLE_SOURCE_PREFIXES.some((p) => source.startsWith(p));
}

interface EditApiResponse {
  ok?: boolean;
  task?: Task;
  hash?: string;
  error?: string;
  code?: string;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as EditApiResponse;
    return body?.error ?? `${fallback}（HTTP ${res.status}）。`;
  } catch {
    return `${fallback}（HTTP ${res.status}）。`;
  }
}

/**
 * 「概要」セクションの編集フォーム。title/status/owner/priority を編集し、
 * GET /api/tasks/hash で baseHash を取得 → POST /api/tasks/edit で書き戻す。
 * 成功でローカル表示を更新し、親へ onChanged?() で一覧 refetch を促す。
 */
function OverviewEditForm({
  task,
  source,
  onSaved,
  onCancel,
}: {
  task: Task;
  source: string;
  onSaved: (updated: Task) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<TaskStatus>(
    task.status === 'UNKNOWN' ? 'TODO' : task.status,
  );
  const [owner, setOwner] = useState(task.owner ?? '');
  const [priority, setPriority] = useState(task.priority ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 変更があったフィールドだけを patch に含める。
  const buildPatch = (): Record<string, string> => {
    const patch: Record<string, string> = {};
    if (title.trim() !== task.title) patch.title = title.trim();
    if (status !== task.status) patch.status = status;
    if (owner !== (task.owner ?? '')) patch.owner = owner;
    if (priority !== (task.priority ?? '')) patch.priority = priority;
    return patch;
  };

  const handleSave = async () => {
    if (saving) return;
    if (title.trim() === '') {
      setError('タイトルを入力してください。');
      return;
    }
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 編集直前に baseHash を取得（楽観ロック）。
      const hashRes = await fetch(`/api/tasks/hash?source=${encodeURIComponent(source)}`);
      if (!hashRes.ok) {
        throw new Error(await readApiError(hashRes, 'ハッシュの取得に失敗しました'));
      }
      const { hash: baseHash } = (await hashRes.json()) as { hash: string };

      const res = await fetch('/api/tasks/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, id: task.id, patch, baseHash }),
      });
      if (res.status === 409) {
        setError('他の更新と競合しました。画面を再読み込みしてください。');
        return;
      }
      if (res.status === 422) {
        setError('この台帳では自動編集できませんでした。.md を直接編集してください。');
        return;
      }
      if (!res.ok) {
        setError(await readApiError(res, '保存に失敗しました'));
        return;
      }
      const data = (await res.json()) as EditApiResponse;
      if (data.task) onSaved(data.task);
      else onSaved({ ...task, ...patch } as Task);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none';

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor="task-edit-title">
          タイトル
        </label>
        <input
          id="task-edit-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={500}
          className={fieldClass}
          placeholder="タイトルを入力してください"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor="task-edit-status">
          ステータス
        </label>
        <select
          id="task-edit-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
          className={fieldClass}
        >
          {TASK_COLUMNS.map((s) => (
            <option key={s} value={s}>
              {taskStatusMeta(s).label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor="task-edit-owner">
          担当
        </label>
        <input
          id="task-edit-owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          maxLength={200}
          className={fieldClass}
          placeholder="担当者を入力してください"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor="task-edit-priority">
          優先度
        </label>
        <input
          id="task-edit-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          maxLength={50}
          className={fieldClass}
          placeholder="優先度を入力してください"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-border px-3 py-2 text-[12px]"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-3 py-2 text-[13px] text-text-muted hover:bg-surface-2 disabled:opacity-50"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-bg hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存する'}
        </button>
      </div>
    </div>
  );
}

/** タスク詳細ドロワー本体。task が null の間は何も描画しない。 */
export function TaskDetail({
  task,
  onClose,
  onChanged,
}: {
  task: Task | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
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
  return <TaskDetailBody task={task} onClose={onClose} onChanged={onChanged} />;
}

/**
 * ドロワー本体（task が確定した状態で描画）。
 * 明示リンク（/api/tasks/:taskId/links）をここで一度だけ取得し、
 * 紐づくワークフロー / 会話の両セクションへ渡す。
 */
function TaskDetailBody({
  task,
  onClose,
  onChanged,
}: {
  task: Task;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const tick = useLiveTick();
  const { data: links } = useLiveResource<TaskLinksResponse>(
    `/api/tasks/${encodeURIComponent(task.id)}/links`,
    tick,
  );
  // ローカル上書き表示（保存成功で即時反映。親 refetch が届くまでのギャップを埋める）。
  const [localTask, setLocalTask] = useState<Task>(task);
  const [editing, setEditing] = useState(false);
  // 親から別タスクが渡し直されたらローカル状態をリセット。
  useEffect(() => {
    setLocalTask(task);
    setEditing(false);
  }, [task]);
  const view = localTask;
  const editable = isEditableSource(view.source);
  const statusMeta = taskStatusMeta(view.status);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`タスク詳細: ${view.title}`}
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
              <span className="font-mono text-[11px] text-text-faint">{view.id}</span>
              {view.stalled && <StalledBadge />}
            </div>
            <h2 className="mt-1 text-[15px] font-bold leading-snug text-text">{view.title}</h2>
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
            <div className="mb-2 flex items-center justify-between gap-2">
              <SectionHeading>概要</SectionHeading>
              {editable && !editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="概要を編集する"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <EditIcon width={14} height={14} />
                  編集
                </button>
              )}
            </div>

            {editing ? (
              <OverviewEditForm
                task={view}
                source={view.source}
                onCancel={() => setEditing(false)}
                onSaved={(updated) => {
                  setLocalTask((prev) => ({ ...prev, ...updated }));
                  setEditing(false);
                  onChanged?.();
                }}
              />
            ) : (
              <>
                <dl className="space-y-2 text-[13px]">
                  <div className="flex items-center gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">ステータス</dt>
                    <dd>
                      <TaskStatusBadge status={view.status} />
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">プロジェクト</dt>
                    <dd className="inline-flex items-center gap-1.5 text-text">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ background: projectColor(view.project) }}
                        aria-hidden
                      />
                      {projectLabel(view.project)}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">担当</dt>
                    <dd className="text-text">{view.owner || '未割り当て'}</dd>
                  </div>
                  {view.priority && (
                    <div className="flex items-center gap-2">
                      <dt className="w-20 shrink-0 text-text-faint">優先度</dt>
                      <dd>
                        <Badge>{view.priority}</Badge>
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">出典</dt>
                    <dd className="break-all text-text-muted">{view.source}</dd>
                  </div>
                  {view.updated && (
                    <div className="flex items-center gap-2">
                      <dt className="w-20 shrink-0 text-text-faint">更新</dt>
                      <dd className="text-text-muted" title={absoluteTime(view.updated)}>
                        {relativeTime(view.updated)}
                      </dd>
                    </div>
                  )}
                </dl>
                {/* ステータスの語ラベル（色のみ依存にしない） */}
                <p className="mt-2 text-[11px]" style={{ color: statusMeta.color }}>
                  現在の状態: {statusMeta.label}
                </p>
                {!editable && (
                  <p className="mt-2 text-[11px] text-text-faint">
                    この台帳の項目は Apollo から編集できません（.md を直接編集してください）。
                  </p>
                )}
              </>
            )}
          </section>

          {/* (a-2) 詳細メモ（MC-83）— 台帳の「詳細」/受け入れ条件/サブタスク等。取れた時のみ表示。 */}
          {view.detail && (
            <section className="mb-5">
              <SectionHeading>詳細メモ</SectionHeading>
              <div className="rounded-lg border border-border bg-surface px-3 py-3">
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-muted">
                  {view.detail}
                </p>
              </div>
            </section>
          )}

          {/* (b) 紐づくワークフロー */}
          <section className="mb-5">
            <SectionHeading>紐づくワークフロー</SectionHeading>
            <LinkedWorkflows task={task} links={links} />
          </section>

          {/* (b-2) デプロイ状況（MC-64） */}
          <section className="mb-5">
            <SectionHeading>デプロイ状況</SectionHeading>
            <LinkedDeploys task={task} />
          </section>

          {/* (c) 紐づくエージェント会話 */}
          <section>
            <SectionHeading>紐づくエージェント会話</SectionHeading>
            <LinkedConversation task={task} links={links} />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
