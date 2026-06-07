// AgentsLive — エージェント擬人化ライブ画面（MC-165 再々実装＋秘書/気持ち拡張）。
//
// ダッシュボード（/）のトップタブとして表示する。各エージェントを V2 ドット絵アバター
// （getAgentAvatar）＋吹き出しで並べ、「現在のタスク（ID＋タイトル）」と「直近の一言
// （最新の活動/発言）」をリアルタイム（SSE 由来 useLiveTick → useLiveResource 再フェッチ）
// で表示する。
//
// MC-165 拡張:
//   - 秘書レイヤー: 林（main assistant・/api/agents に出ない）＋ Masayoshi / Son（OpenClaw 秘書）を
//     常時ピン留めの「秘書」カードとして先頭に表示する（/api/roster ＋ /api/secretaries）。
//   - 気持ち/思考: 各カードに一人称の「今の気持ち＋考えてること」を感情絵文字付きで表示する
//     （/api/agent-moods。バッチ生成＋キャッシュ＋スロットル。失敗時は status ベースのフォールバック）。
//
// データ:
//   - /api/agents（AgentSummary[]）: status / currentTaskId / lastAction / lastActivity を持つ。
//   - /api/tasks（Task[]）: currentTaskId からタスクタイトルを解決する。
//   - /api/roster（RosterEntry[]）: persona 表示名・役割を補う＋林の稼働状態の取得元。
//   - /api/secretaries（SecretarySummary[]）: Masayoshi / Son のライブ状態。
//   - /api/agent-moods（AgentMood[]）: key→ 感情絵文字・気持ち・思考。
//
// アバター未生成の人格（task-manager / test-functional / 秘書 v2 GIF 等）は絵文字＋状態ドットに
// フォールバックし、既存挙動を壊さない（<img> onError でも絵文字へ落とす）。

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type {
  AgentMood,
  AgentStatus,
  AgentSummary,
  RosterEntry,
  SecretarySummary,
  Task,
} from '../lib/types';
import { agentStatusMeta } from '../lib/meta';
import { relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import { ResourceState } from '../components/ui';
import { getAgentAvatar } from '../lib/agentAvatars';

// アバター未生成の人格に割り当てる絵文字フォールバック（既存挙動非破壊）。
const FALLBACK_EMOJI: Record<string, string> = {
  'task-manager': '🗂️',
  'test-functional': '🧪',
  masayoshi: '📋',
  son: '🤝',
  'hayashi-rin': '🧓',
};

// status を「稼働中らしさ」で順位付け（代表インスタンス選定用）。
const STATUS_RANK: Record<AgentStatus, number> = {
  active: 3,
  idle: 2,
  done: 1,
  never: 0,
};

interface LiveAgent {
  key: string; // subagentType（mood 突合キー）
  name: string; // 表示名（persona があれば persona、無ければ subagentType）
  subagentType: string;
  role?: string;
  status: AgentStatus;
  agentId?: string; // 会話ドリルダウン用（active/idle/done の代表インスタンス）
  currentTaskId?: string;
  lastAction?: string;
  lastActivity?: string;
  /** 秘書レイヤー（林/Masayoshi/Son）= true。先頭にピン留めし「秘書」ラベルを付ける。 */
  secretary?: boolean;
  /** アバター未生成時の絵文字（秘書など）。 */
  emoji?: string;
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

/**
 * 秘書レイヤー（先頭ピン留め）を組み立てる。
 *   - 林（hayashi-rin）: /api/agents には出ない（main assistant）。/api/roster の稼働状態を使う。
 *   - Masayoshi / Son: /api/secretaries（OpenClaw 由来）を使う。
 * mood 突合キーは agents 側と揃える: 林='hayashi-rin'、秘書='secretary:<key>'。
 */
function buildSecretaries(
  roster: RosterEntry[],
  secretaries: SecretarySummary[],
): LiveAgent[] {
  const out: LiveAgent[] = [];

  // 林（main assistant）。roster の hayashi-rin から稼働状態を引く。
  const rin = roster.find((r) => r.name === 'hayashi-rin');
  if (rin) {
    out.push({
      key: 'hayashi-rin',
      name: rin.persona || '林',
      subagentType: 'hayashi-rin',
      role: rin.role || 'メインアシスタント / オーケストレーター',
      status: rin.liveStatus ?? (rin.activeCount > 0 ? 'active' : 'idle'),
      lastActivity: rin.lastActivity,
      lastAction: rin.summary,
      secretary: true,
      emoji: FALLBACK_EMOJI['hayashi-rin'],
    });
  }

  // Masayoshi / Son（OpenClaw 秘書）。
  for (const s of secretaries) {
    out.push({
      key: `secretary:${s.key}`,
      name: s.name,
      subagentType: s.key, // avatar 突合（masayoshi / son）
      role: s.role,
      status: s.status,
      lastActivity: s.lastActivity || undefined,
      lastAction: s.lastAction || undefined,
      secretary: true,
      emoji: s.emoji,
    });
  }

  return out;
}

// 一人称の気持ち・思考（mood）。感情絵文字＋気持ち＋考えてること 1 行を表示する。
function MoodLine({ mood }: { mood?: AgentMood }) {
  if (!mood || (!mood.mood && !mood.thought)) return null;
  return (
    <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5">
      <span className="shrink-0 text-base leading-none" aria-hidden>
        {mood.emoji}
      </span>
      <p className="min-w-0 text-[11px] leading-snug text-text-muted">
        {mood.mood && (
          <span className="font-semibold text-text">{mood.mood}</span>
        )}
        {mood.mood && mood.thought && <span className="text-text-faint"> — </span>}
        {mood.thought && <span>「{mood.thought}」</span>}
      </p>
    </div>
  );
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

// アバター（V2 GIF）。未生成 or 読み込み失敗は絵文字＋状態色枠でフォールバック。
function AvatarBlock({ agent }: { agent: LiveAgent }) {
  const avatar = getAgentAvatar(agent.subagentType);
  const working = agent.status === 'active';
  const meta = agentStatusMeta(agent.status);
  // 秘書 v2 GIF は別担当が生成中＝不在のことがある。<img> onError で絵文字へ落とす。
  const [imgFailed, setImgFailed] = useState(false);

  const emoji = agent.emoji ?? FALLBACK_EMOJI[agent.subagentType] ?? '🤖';

  if (avatar && !imgFailed) {
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
        onError={() => setImgFailed(true)}
        className="shrink-0 rounded-2xl border border-border bg-surface-2 object-cover"
        style={{ imageRendering: 'pixelated', width: 72, height: 72 }}
      />
    );
  }

  // フォールバック: 絵文字＋状態色の枠（既存挙動非破壊）。
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
  mood,
  onOpen,
}: {
  agent: LiveAgent;
  taskTitle?: string;
  mood?: AgentMood;
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
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-text">{agent.name}</span>
            {agent.secretary && (
              <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
                秘書
              </span>
            )}
          </div>
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

      {/* 一人称の気持ち・思考（mood） */}
      <MoodLine mood={mood} />

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
  const secretariesRes = useLiveResource<{ secretaries: SecretarySummary[] }>(
    '/api/secretaries',
    tick,
  );
  const moodsRes = useLiveResource<{ moods: AgentMood[] }>('/api/agent-moods', tick);

  // 秘書レイヤー（先頭ピン留め）。林＋Masayoshi/Son。
  const secretaries = useMemo(
    () => buildSecretaries(rosterRes.data?.roster ?? [], secretariesRes.data?.secretaries ?? []),
    [rosterRes.data, secretariesRes.data],
  );

  // subagent エージェント（人格別代表）。
  const subagents = useMemo(
    () => buildLiveAgents(agentsRes.data?.agents ?? [], rosterRes.data?.roster ?? []),
    [agentsRes.data, rosterRes.data],
  );

  // 表示順: 秘書レイヤー → subagent。
  const live = useMemo(() => [...secretaries, ...subagents], [secretaries, subagents]);

  // currentTaskId → タイトル解決のための索引。
  const taskTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasksRes.data?.tasks ?? []) m.set(t.id, t.title);
    return m;
  }, [tasksRes.data]);

  // mood の key → AgentMood 索引（カードの key で引く）。
  const moodByKey = useMemo(() => {
    const m = new Map<string, AgentMood>();
    for (const mood of moodsRes.data?.moods ?? []) m.set(mood.key, mood);
    return m;
  }, [moodsRes.data]);

  const activeCount = live.filter((a) => a.status === 'active').length;

  return (
    <div>
      <PageHeader
        title="エージェント（擬人化ライブ）"
        subtitle={`${live.length} 体 — 稼働中 ${activeCount}。秘書（林・Masayoshi・Son）と各エージェントの現在のタスク・直近の活動・今の気持ちをリアルタイム表示します。`}
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
                mood={moodByKey.get(agent.key)}
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
