// Agents — roster(台帳) と agents(実稼働) をマージしたグリッド。
// クリックで個別ドロワーを開き /api/agents/:id/feed の会話タイムラインを表示。
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { AgentStatus, AgentSummary, RosterEntry } from '../lib/types';
import { agentStatusMeta } from '../lib/meta';
import { relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, StatusDot, Badge } from '../components/ui';
import { AgentFeed } from '../components/AgentFeed';
import { CloseIcon } from '../components/icons';

const STATUS_FILTERS: { value: AgentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'active', label: '稼働中' },
  { value: 'idle', label: '待機' },
  { value: 'done', label: '完了' },
  { value: 'never', label: '未稼働' },
];

// roster の台帳エントリを、実稼働がない場合でも「未稼働」カードとして表示するための型。
interface DisplayCard {
  key: string;
  agentId?: string; // feed を引けるのは実稼働 agentId を持つカードのみ
  name: string;
  role?: string;
  status: AgentStatus;
  projectLabel?: string;
  lastActivity?: string;
  lastAction?: string;
  matched: boolean;
  isWorkflow: boolean;
  fromRoster: boolean;
}

function buildCards(agents: AgentSummary[], roster: RosterEntry[]): DisplayCard[] {
  const cards: DisplayCard[] = [];
  const rosterNames = new Set(roster.map((r) => r.name));

  // 1) 実稼働 subagent（最新活動順、API が既にソート済み）。
  for (const a of agents) {
    cards.push({
      key: `agent:${a.agentId}`,
      agentId: a.agentId,
      name: a.subagentType,
      role: a.description,
      status: a.status,
      projectLabel: a.projectLabel,
      lastActivity: a.lastActivity,
      lastAction: a.lastAction,
      matched: a.matched,
      isWorkflow: a.isWorkflow,
      fromRoster: rosterNames.has(a.subagentType),
    });
  }

  // 2) 台帳にいるが今は稼働していない体（never）を補完表示。
  const liveTypes = new Set(agents.map((a) => a.subagentType));
  for (const r of roster) {
    if (liveTypes.has(r.name)) continue; // 既に実稼働カードで出ている
    cards.push({
      key: `roster:${r.name}`,
      name: r.name,
      role: r.role,
      status: (r.liveStatus as AgentStatus) ?? 'never',
      projectLabel: r.currentProject,
      lastActivity: r.lastActivity,
      lastAction: r.summary,
      matched: true,
      isWorkflow: false,
      fromRoster: true,
    });
  }
  return cards;
}

function AgentCard({ card, onOpen }: { card: DisplayCard; onOpen: () => void }) {
  const meta = agentStatusMeta(card.status);
  const clickable = !!card.agentId;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!clickable}
      className={`flex flex-col rounded-xl border border-border bg-surface p-4 text-left transition-colors ${
        clickable ? 'hover:border-border-strong hover:bg-surface-2' : 'cursor-default opacity-80'
      }`}
      style={{ borderLeft: `3px solid ${meta.color}` }}
      aria-label={`${card.name}（${meta.label}）${clickable ? ' — 会話を表示' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-text">{card.name}</div>
          {card.role && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">{card.role}</div>
          )}
        </div>
        <StatusDot status={card.status} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.projectLabel && <Badge>{card.projectLabel}</Badge>}
        {card.isWorkflow && <Badge>workflow</Badge>}
        {!card.matched && (
          <Badge color="var(--mc-idle)" bg="var(--mc-idle-bg)" title="台帳と照合できていません">
            未照合
          </Badge>
        )}
        {card.fromRoster && card.status === 'never' && <Badge>台帳のみ</Badge>}
      </div>

      {card.lastAction && (
        <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-text-muted">
          {card.lastAction}
        </p>
      )}

      <div className="mt-2 text-[11px] text-text-faint">
        最終活動: {relativeTime(card.lastActivity)}
      </div>
    </button>
  );
}

function Drawer({ agentId, name, onClose }: { agentId: string; name: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col md:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} の会話`}
    >
      <div className="flex-1 bg-bg/70" onClick={onClose} aria-hidden />
      <div className="flex h-[85vh] w-full max-w-xl flex-col rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl md:h-full md:rounded-none md:border-l md:border-t-0 md:pb-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-text">{name}</div>
            <div className="text-[11px] text-text-faint">会話タイムライン</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
            aria-label="閉じる"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <AgentFeed agentId={agentId} />
        </div>
      </div>
    </div>
  );
}

export default function Agents() {
  // agents グリッド + roster（稼働マージ）はいずれも agents 由来の変更で更新する。
  const tick = useLiveTick('agents');
  const navigate = useNavigate();
  const { agentId: routeAgentId } = useParams();
  const [filter, setFilter] = useState<AgentStatus | 'all'>('all');

  const agentsRes = useLiveResource<{ agents: AgentSummary[] }>('/api/agents', tick);
  const rosterRes = useLiveResource<{ roster: RosterEntry[] }>('/api/roster', tick);

  const cards = useMemo(
    () => buildCards(agentsRes.data?.agents ?? [], rosterRes.data?.roster ?? []),
    [agentsRes.data, rosterRes.data],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { active: 0, idle: 0, done: 0, never: 0 };
    for (const card of cards) c[card.status] = (c[card.status] ?? 0) + 1;
    return c;
  }, [cards]);

  const filtered = filter === 'all' ? cards : cards.filter((c) => c.status === filter);

  const openCard = routeAgentId
    ? cards.find((c) => c.agentId === routeAgentId)
    : undefined;

  return (
    <div>
      <PageHeader
        title="エージェント"
        subtitle={`稼働 ${counts.active} / 待機 ${counts.idle} / 完了 ${counts.done} / 未稼働 ${counts.never}`}
        fetchedAt={agentsRes.fetchedAt}
        right={
          <div
            className="no-scrollbar -mx-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto px-1"
            role="group"
            aria-label="状態で絞り込み"
          >
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`shrink-0 rounded-md px-2.5 py-2 text-xs md:py-1 ${
                  filter === f.value
                    ? 'bg-surface-3 font-semibold text-text'
                    : 'text-text-muted hover:bg-surface-2'
                }`}
                aria-pressed={filter === f.value}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="p-4 md:p-6">
        <ResourceState
          loading={agentsRes.loading}
          error={agentsRes.error}
          hasData={!!agentsRes.data}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((card) => (
              <AgentCard
                key={card.key}
                card={card}
                onOpen={() => card.agentId && navigate(`/agents/${card.agentId}`)}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="mt-6 text-sm text-text-faint">該当するエージェントがありません。</p>
          )}
        </ResourceState>
      </div>

      {openCard?.agentId && (
        <Drawer
          agentId={openCard.agentId}
          name={openCard.name}
          onClose={() => navigate('/agents')}
        />
      )}
    </div>
  );
}
