// Feed（会話）— 全エージェントの直近の動きを時系列ストリームに統合。
// Phase 2 段階では agents 一覧の lastAction を時系列マージし、プロジェクト/状態/
// エージェントでフィルタする。各エントリはクリックで個別会話（feed）を展開できる。
import { useMemo, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { AgentStatus, AgentSummary, ProjectName } from '../lib/types';
import { PROJECT_ORDER, agentStatusMeta, projectColor, projectLabel } from '../lib/meta';
import { absoluteTime, relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, Badge } from '../components/ui';
import { AgentFeed } from '../components/AgentFeed';

const STATUS_FILTERS: { value: AgentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'active', label: '稼働中' },
  { value: 'idle', label: '待機' },
  { value: 'done', label: '完了' },
];

function FeedRow({ a }: { a: AgentSummary }) {
  const [open, setOpen] = useState(false);
  const meta = agentStatusMeta(a.status);
  return (
    <li className="rounded-lg border border-border bg-surface">
      <div className="border-l-2" style={{ borderColor: projectColor(a.project) }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2"
          aria-expanded={open}
        >
          <span
            className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: meta.color }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-text">{a.subagentType}</span>
              <Badge>{a.projectLabel}</Badge>
              <span className="text-[11px]" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <span className="text-[11px] text-text-faint" title={absoluteTime(a.lastActivity)}>
                {relativeTime(a.lastActivity)}
              </span>
            </div>
            {a.lastAction && (
              <p className="mt-1 line-clamp-2 select-text text-[13px] leading-snug text-text-muted">
                {a.lastAction}
              </p>
            )}
            <span className="mt-1 inline-block text-[11px] text-accent">
              {open ? '会話を閉じる' : '会話を展開'}
            </span>
          </div>
        </button>
        {open && (
          <div className="border-t border-border px-4 py-3">
            <AgentFeed agentId={a.agentId} />
          </div>
        )}
      </div>
    </li>
  );
}

export default function Feed() {
  const tick = useLiveTick('agents');
  const { data, error, loading, fetchedAt } = useLiveResource<{ agents: AgentSummary[] }>(
    '/api/agents',
    tick,
  );

  const [project, setProject] = useState<ProjectName | 'all'>('all');
  const [status, setStatus] = useState<AgentStatus | 'all'>('all');

  const agents = data?.agents ?? [];

  // 表示対象のプロジェクト（実際に存在するもののみ、PROJECT_ORDER 順）。
  const presentProjects = useMemo(() => {
    const set = new Set(agents.map((a) => a.project));
    return PROJECT_ORDER.filter((p) => set.has(p));
  }, [agents]);

  const filtered = useMemo(
    () =>
      agents.filter(
        (a) =>
          (project === 'all' || a.project === project) &&
          (status === 'all' || a.status === status),
      ),
    [agents, project, status],
  );

  return (
    <div>
      <PageHeader
        title="会話"
        subtitle="全エージェントの直近の動きを時系列で表示します"
        fetchedAt={fetchedAt}
      />
      <div className="p-4 md:p-6">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
          <div
            className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1 md:flex-wrap"
            role="group"
            aria-label="プロジェクトで絞り込み"
          >
            <button
              type="button"
              onClick={() => setProject('all')}
              className={`shrink-0 rounded-md px-2.5 py-2 text-xs md:py-1 ${
                project === 'all' ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted hover:bg-surface-2'
              }`}
              aria-pressed={project === 'all'}
            >
              全プロジェクト
            </button>
            {presentProjects.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProject(p)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-xs md:py-1 ${
                  project === p ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted hover:bg-surface-2'
                }`}
                aria-pressed={project === p}
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: projectColor(p) }}
                  aria-hidden
                />
                {projectLabel(p)}
              </button>
            ))}
          </div>
          <div
            className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1"
            role="group"
            aria-label="状態で絞り込み"
          >
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                className={`shrink-0 rounded-md px-2.5 py-2 text-xs md:py-1 ${
                  status === f.value ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted hover:bg-surface-2'
                }`}
                aria-pressed={status === f.value}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <ResourceState loading={loading} error={error} hasData={!!data}>
          <ol className="space-y-2">
            {filtered.map((a) => (
              <FeedRow key={a.agentId} a={a} />
            ))}
          </ol>
          {filtered.length === 0 && (
            <p className="mt-6 text-sm text-text-faint">該当する会話がありません。</p>
          )}
        </ResourceState>
      </div>
    </div>
  );
}
