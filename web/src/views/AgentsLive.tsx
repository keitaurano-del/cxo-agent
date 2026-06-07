// AgentsLive — エージェント擬人化ライブ画面（MC-165 再々実装）。
//
// ダッシュボード（/）のトップタブとして表示する。各エージェントを V2 ドット絵アバター
// （getAgentAvatar）＋吹き出しで並べ、「現在のタスク（ID＋タイトル）」と「直近の一言
// （最新の活動/発言）」をリアルタイム（SSE 由来 useLiveTick → useLiveResource 再フェッチ）
// で表示する。
//
// データ:
//   - /api/agents（AgentSummary[]）: status / currentTaskId / lastAction / lastActivity を持つ。
//     subagentType（= 人格キー）で集約し、人格ごとに代表インスタンス 1 件を選ぶ。
//   - /api/tasks（Task[]）: currentTaskId からタスクタイトルを解決する。
//   - /api/roster（RosterEntry[]）: persona 表示名・役割を補う。
//
// アバター未生成の人格（masayoshi / task-manager / test-functional 等）は絵文字＋状態ドット
// にフォールバックし、既存挙動を壊さない。

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { AgentStatus, AgentSummary, RosterEntry, Task } from '../lib/types';
import { agentStatusMeta } from '../lib/meta';
import { relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import { ResourceState } from '../components/ui';
import { getAgentAvatar } from '../lib/agentAvatars';

// アバター未生成の人格に割り当てる絵文字フォールバック（既存挙動非破壊）。
const FALLBACK_EMOJI: Record<string, string> = {
  masayoshi: '📋',
  'task-manager': '🗂️',
  'test-functional': '🧪',
};

// status を「稼働中らしさ」で順位付け（代表インスタンス選定用）。
const STATUS_RANK: Record<AgentStatus, number> = {
  active: 3,
  idle: 2,
  done: 1,
  never: 0,
};

interface LiveAgent {
  key: string; // subagentType
  name: string; // 表示名（persona があれば persona、無ければ subagentType）
  subagentType: string;
  role?: string;
  status: AgentStatus;
  agentId?: string; // 会話ドリルダウン用（active/idle/done の代表インスタンス）
  currentTaskId?: string;
  lastAction?: string;
  lastActivity?: string;
}

// /api/agents を subagentType ごとに集約し、人格ごとの代表インスタンスを 1 件選ぶ。
// 代表は status 順位（active > idle > done）→ lastActivity の新しさ で決める。
function buildLiveAgents(agents: AgentSummary[], roster: RosterEntry[]): LiveAgent[] {
  const rosterByName = new Map(roster.map((r) => [r.name, r]));
  const best = new Map<string, AgentSummary>();

  for (const a of agents) {
    const prev = best.get(a.subagentType);
    if (!prev) {
      best.set(a.subagentType, a);
      continue;
    }
    const rankA = STATUS_RANK[a.status] ?? 0;
    const rankPrev = STATUS_RANK[prev.status] ?? 0;
    if (rankA > rankPrev) {
      best.set(a.subagentType, a);
    } else if (rankA === rankPrev) {
      // 同順位なら活動が新しい方を採用。
      if (new Date(a.lastActivity).getTime() > new Date(prev.lastActivity).getTime()) {
        best.set(a.subagentType, a);
      }
    }
  }

  const live: LiveAgent[] = [];
  for (const [key, a] of best) {
    const r = rosterByName.get(key);
    live.push({
      key,
      name: r?.persona || a.subagentType,
      subagentType: a.subagentType,
      role: r?.role,
      status: a.status,
      agentId: a.agentId,
      currentTaskId: a.currentTaskId,
      lastAction: a.lastAction,
      lastActivity: a.lastActivity,
    });
  }

  // アバター保有の人格を先頭・稼働中を優先して並べる（ライブ感のため）。
  live.sort((x, y) => {
    const ax = getAgentAvatar(x.subagentType) ? 1 : 0;
    const ay = getAgentAvatar(y.subagentType) ? 1 : 0;
    if (ax !== ay) return ay - ax;
    const sx = STATUS_RANK[x.status] ?? 0;
    const sy = STATUS_RANK[y.status] ?? 0;
    if (sx !== sy) return sy - sx;
    return x.name.localeCompare(y.name, 'ja');
  });

  return live;
}

// 吹き出し（現在のタスク＋直近の一言）。
function SpeechBubble({
  taskId,
  taskTitle,
  lastAction,
}: {
  taskId?: string;
  taskTitle?: string;
  lastAction?: string;
}) {
  const hasTask = !!taskId;
  const hasAction = !!(lastAction && lastAction.trim());

  return (
    <div className="relative mt-2 w-full">
      {/* 吹き出しの三角（アバター側を向く） */}
      <span
        className="absolute -top-1.5 left-6 h-3 w-3 rotate-45 border-l border-t border-border"
        style={{ background: 'var(--mc-surface-2)' }}
        aria-hidden
      />
      <div className="relative rounded-xl border border-border bg-surface-2 px-3 py-2">
        {/* 現在のタスク */}
        {hasTask ? (
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">
              {taskId}
            </span>
            {taskTitle && (
              <span className="line-clamp-2 text-[11px] leading-snug text-text">{taskTitle}</span>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-text-faint">現在のタスクなし</div>
        )}

        {/* 直近の一言（最新の活動スニペット） */}
        {hasAction && (
          <p className="mt-1.5 line-clamp-3 text-[12px] leading-snug text-text-muted">
            「{lastAction}」
          </p>
        )}
      </div>
    </div>
  );
}

// アバター（V2 GIF）。未生成は絵文字＋状態色枠でフォールバック。
function AvatarBlock({ agent }: { agent: LiveAgent }) {
  const avatar = getAgentAvatar(agent.subagentType);
  const working = agent.status === 'active';
  const meta = agentStatusMeta(agent.status);

  if (avatar) {
    const src = working ? avatar.working : avatar.idle;
    return (
      <img
        src={src}
        alt={`${agent.name}（${meta.label}）`}
        title={`${agent.name}（${meta.label}）`}
        width={72}
        height={72}
        loading="lazy"
        decoding="async"
        className="shrink-0 rounded-2xl border border-border bg-surface-2 object-cover"
        style={{ imageRendering: 'pixelated', width: 72, height: 72 }}
      />
    );
  }

  // フォールバック: 絵文字＋状態色の枠（既存挙動非破壊）。
  const emoji = FALLBACK_EMOJI[agent.subagentType] ?? '🤖';
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-2xl border bg-surface-2 text-3xl"
      style={{ width: 72, height: 72, borderColor: meta.color }}
      title={`${agent.name}（${meta.label}）`}
      aria-label={`${agent.name}（${meta.label}）`}
    >
      <span aria-hidden>{emoji}</span>
    </div>
  );
}

function LiveCard({
  agent,
  taskTitle,
  onOpen,
}: {
  agent: LiveAgent;
  taskTitle?: string;
  onOpen: () => void;
}) {
  const meta = agentStatusMeta(agent.status);
  const clickable = !!agent.agentId;
  const isWorking = agent.status === 'active';

  return (
    <div
      className="flex flex-col rounded-2xl border border-border bg-surface p-4"
      style={{ borderTop: `3px solid ${meta.color}` }}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!clickable}
        className={`flex items-start gap-3 text-left ${
          clickable ? 'cursor-pointer' : 'cursor-default'
        }`}
        aria-label={`${agent.name}（${meta.label}）${clickable ? ' — 会話を表示' : ''}`}
      >
        <AvatarBlock agent={agent} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-text">{agent.name}</div>
          <div className="truncate text-[10px] text-text-faint">{agent.subagentType}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${isWorking ? 'mc-pulse' : ''}`}
              style={{ background: meta.color }}
              aria-hidden
            />
            <span className="text-[11px]" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {agent.lastActivity && (
              <span className="text-[11px] text-text-faint">
                · {relativeTime(agent.lastActivity)}
              </span>
            )}
          </div>
          {agent.role && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">{agent.role}</div>
          )}
        </div>
      </button>

      {/* 吹き出し（現在のタスク＋直近の一言） */}
      <SpeechBubble
        taskId={agent.currentTaskId}
        taskTitle={taskTitle}
        lastAction={agent.lastAction}
      />
    </div>
  );
}

export default function AgentsLive() {
  // SSE 由来の再フェッチトリガー。agents / tasks の両種別を購読しリアルタイム更新する。
  const tick = useLiveTick('agents', 'tasks');
  const navigate = useNavigate();

  const agentsRes = useLiveResource<{ agents: AgentSummary[] }>('/api/agents', tick);
  const tasksRes = useLiveResource<{ tasks: Task[] }>('/api/tasks', tick);
  const rosterRes = useLiveResource<{ roster: RosterEntry[] }>('/api/roster', tick);

  const live = useMemo(
    () => buildLiveAgents(agentsRes.data?.agents ?? [], rosterRes.data?.roster ?? []),
    [agentsRes.data, rosterRes.data],
  );

  // currentTaskId → タイトル解決のための索引。
  const taskTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasksRes.data?.tasks ?? []) m.set(t.id, t.title);
    return m;
  }, [tasksRes.data]);

  const activeCount = live.filter((a) => a.status === 'active').length;

  return (
    <div>
      <PageHeader
        title="エージェント（擬人化ライブ）"
        subtitle={`${live.length} 体 — 稼働中 ${activeCount}。各エージェントの現在のタスクと直近の活動をリアルタイム表示します。`}
        fetchedAt={agentsRes.fetchedAt}
      />
      <div className="p-4 md:p-6">
        <ResourceState
          loading={agentsRes.loading}
          error={agentsRes.error}
          hasData={!!agentsRes.data}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {live.map((agent) => (
              <LiveCard
                key={agent.key}
                agent={agent}
                taskTitle={agent.currentTaskId ? taskTitles.get(agent.currentTaskId) : undefined}
                onOpen={() => agent.agentId && navigate(`/agents/${agent.agentId}`)}
              />
            ))}
          </div>
          {live.length === 0 && (
            <p className="mt-6 text-sm text-text-faint">表示できるエージェントがありません。</p>
          )}
        </ResourceState>
      </div>
    </div>
  );
}
