// Agents — 人格別に集約したエージェント一覧（MC-88）。
// /api/agents/grouped（人格＝subagentType 単位の集約）と /api/roster（台帳の役割定義）を
// マージし、231 件の稼働インスタンスを人格保有エージェント中心の数件に畳んで表示する。
// 各カードは稼働内訳（稼働/待機/完了/未稼働の件数）・最終活動・現在のタスクを出す。
// カードクリックで最新インスタンスの会話タイムライン（/api/agents/:id/feed）をドロワー表示。
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { AgentStatus, AgentGroup, RosterEntry } from '../lib/types';
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

// 人格別に集約した 1 体分の表示カード。
interface DisplayCard {
  key: string;
  agentId?: string; // feed を開ける最新インスタンスの agentId（その他/未稼働は無し）
  name: string; // エージェント識別名（subagentType ベース）
  persona?: string; // 人格名（roster frontmatter persona）
  personality?: string; // 気質（roster frontmatter personality）
  role?: string; // 役割（roster or グループの description）
  status: AgentStatus;
  isPersona: boolean;
  instanceCount: number;
  activeCount: number;
  idleCount: number;
  doneCount: number;
  neverCount: number;
  projectLabel?: string;
  projects: string[];
  lastActivity?: string;
  lastAction?: string;
}

function buildCards(groups: AgentGroup[], roster: RosterEntry[]): DisplayCard[] {
  const rosterByName = new Map(roster.map((r) => [r.name, r]));
  const cards: DisplayCard[] = [];
  const seenPersona = new Set<string>();

  // 1) 集約グループ（人格保有が先頭、その他が末尾。server が並べ済み）。
  for (const g of groups) {
    if (g.isPersona) seenPersona.add(g.subagentType);
    const r = rosterByName.get(g.subagentType);
    cards.push({
      key: `group:${g.subagentType}`,
      agentId: g.latestAgentId || undefined,
      name: g.subagentType,
      persona: r?.persona,
      personality: r?.personality,
      role: r?.role ?? g.description,
      status: g.status,
      isPersona: g.isPersona,
      instanceCount: g.instanceCount,
      activeCount: g.activeCount,
      idleCount: g.idleCount,
      doneCount: g.doneCount,
      neverCount: g.neverCount,
      projectLabel: g.projectLabel,
      projects: g.projects,
      lastActivity: g.lastActivity,
      lastAction: g.lastAction,
    });
  }

  // 2) 台帳にいるが稼働インスタンスが 1 件も無い人格（未稼働）を補完表示。
  for (const r of roster) {
    if (seenPersona.has(r.name)) continue;
    cards.push({
      key: `roster:${r.name}`,
      name: r.name,
      persona: r.persona,
      personality: r.personality,
      role: r.role,
      status: 'never',
      isPersona: true,
      instanceCount: 0,
      activeCount: 0,
      idleCount: 0,
      doneCount: 0,
      neverCount: 0,
      projectLabel: r.currentProject,
      projects: r.currentProject ? [r.currentProject] : [],
      lastActivity: r.lastActivity,
      lastAction: r.summary,
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
      aria-label={`${card.persona || card.name}（${meta.label}）${clickable ? ' — 会話を表示' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-text">{card.persona || card.name}</div>
          {card.persona && (
            <div className="truncate text-[10px] text-text-faint">{card.name}</div>
          )}
          {card.role && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">{card.role}</div>
          )}
        </div>
        <StatusDot status={card.status} />
      </div>

      {card.personality && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-text-muted">
          <span className="font-semibold text-text-faint">気質: </span>
          {card.personality}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.projects.slice(0, 3).map((p) => (
          <Badge key={p}>{p}</Badge>
        ))}
        {!card.isPersona && (
          <Badge color="var(--mc-idle)" bg="var(--mc-idle-bg)" title="人格を持たない稼働（孫・汎用）の集計">
            その他
          </Badge>
        )}
      </div>

      {/* 稼働サマリ: 集約した稼働件数の内訳 */}
      {card.instanceCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
          <span>
            稼働 <span className="font-semibold text-text">{card.instanceCount}</span> 件
          </span>
          {card.activeCount > 0 && <span>稼働中 {card.activeCount}</span>}
          {card.idleCount > 0 && <span>待機 {card.idleCount}</span>}
          {card.doneCount > 0 && <span>完了 {card.doneCount}</span>}
        </div>
      )}

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
            <div className="text-[11px] text-text-faint">会話タイムライン（最新の稼働）</div>
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
  const tick = useLiveTick('agents');
  const navigate = useNavigate();
  const { agentId: routeAgentId } = useParams();
  const [filter, setFilter] = useState<AgentStatus | 'all'>('all');

  const groupsRes = useLiveResource<{ groups: AgentGroup[] }>('/api/agents/grouped', tick);
  const rosterRes = useLiveResource<{ roster: RosterEntry[] }>('/api/roster', tick);

  const cards = useMemo(
    () => buildCards(groupsRes.data?.groups ?? [], rosterRes.data?.roster ?? []),
    [groupsRes.data, rosterRes.data],
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
        subtitle={`人格 ${cards.filter((c) => c.isPersona).length} 体 — 稼働中 ${counts.active} / 待機 ${counts.idle} / 完了 ${counts.done} / 未稼働 ${counts.never}`}
        fetchedAt={groupsRes.fetchedAt}
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
          loading={groupsRes.loading}
          error={groupsRes.error}
          hasData={!!groupsRes.data}
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
          name={openCard.persona || openCard.name}
          onClose={() => navigate('/agents')}
        />
      )}
    </div>
  );
}
