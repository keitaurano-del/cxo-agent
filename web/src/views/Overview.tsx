// Overview（司令塔）— 上部 KPI 帯 + プロジェクトカード。
import { Link } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { Overview as OverviewData, OverviewProject } from '../lib/types';
import { PROJECT_ORDER, projectColor, projectLabel } from '../lib/meta';
import { relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, StalledBadge } from '../components/ui';

interface KpiCardProps {
  label: string;
  value: number;
  color: string;
  sub?: string;
}

function KpiCard({ label, value, color, sub }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 md:p-4">
      <div className="text-xs font-medium text-text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums md:text-3xl" style={{ color }}>
          {value}
        </span>
        {sub && <span className="text-xs text-text-faint">{sub}</span>}
      </div>
    </div>
  );
}

function ProjectCard({ p }: { p: OverviewProject }) {
  const accent = projectColor(p.project);
  const empty = p.agentsTotal === 0 && p.tasksTotal === 0;
  return (
    <div
      className="rounded-xl border border-border bg-surface p-4"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: accent }}
            aria-hidden
          />
          <h3 className="text-sm font-bold text-text">{projectLabel(p.project)}</h3>
        </div>
        {p.tasksStalled > 0 && <StalledBadge />}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] text-text-faint">稼働エージェント</div>
          <div className="text-lg font-semibold tabular-nums text-text">
            {p.agentsActive}
            <span className="text-xs font-normal text-text-faint"> / {p.agentsTotal}</span>
          </div>
          {p.agentsIdle > 0 && (
            <div className="text-[10px] text-text-faint">待機 {p.agentsIdle}</div>
          )}
        </div>
        <div>
          <div className="text-[11px] text-text-faint">タスク</div>
          <div className="text-lg font-semibold tabular-nums text-text">
            {p.tasksTotal}
          </div>
          {p.tasksInProgress > 0 && (
            <div className="text-[10px]" style={{ color: 'var(--mc-active)' }}>
              進行中 {p.tasksInProgress}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <span className="text-[11px] text-text-faint">
          最終活動: {relativeTime(p.lastActivity)}
        </span>
        {empty && <span className="text-[10px] text-text-faint">活動記録なし</span>}
      </div>
    </div>
  );
}

export default function Overview() {
  // overview は agents + tasks 由来。どちらの変更でも再フェッチ。
  const tick = useLiveTick('agents', 'tasks');
  const { data, error, loading, fetchedAt } = useLiveResource<OverviewData>(
    '/api/overview',
    tick,
  );

  const kpi = data?.kpi;
  // 表示順を PROJECT_ORDER に揃える。
  const projects = data
    ? [...data.projects].sort(
        (a, b) => PROJECT_ORDER.indexOf(a.project) - PROJECT_ORDER.indexOf(b.project),
      )
    : [];

  return (
    <div>
      <PageHeader
        title="司令塔"
        subtitle="エージェント稼働とタスク進捗の俯瞰"
        fetchedAt={fetchedAt}
        right={
          <Link
            to="/agents"
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
          >
            エージェント一覧
          </Link>
        }
      />
      <div className="p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {kpi && (
            <section className="mb-8">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KpiCard
                  label="稼働中"
                  value={kpi.agentsActive}
                  color="var(--mc-active)"
                  sub={`/ ${kpi.agentsTotal}`}
                />
                <KpiCard label="待機" value={kpi.agentsIdle} color="var(--mc-idle)" />
                <KpiCard
                  label="進行中タスク"
                  value={kpi.tasksInProgress}
                  color="var(--mc-active)"
                />
                <KpiCard
                  label="滞留タスク"
                  value={kpi.tasksStalled}
                  color="var(--mc-stalled)"
                />
                <KpiCard
                  label="ブロック"
                  value={kpi.tasksBlocked}
                  color="var(--mc-blocked)"
                />
                <KpiCard label="レビュー待ち" value={kpi.tasksReview} color="var(--mc-review)" />
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text-muted">プロジェクト</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.map((p) => (
                <ProjectCard key={p.project} p={p} />
              ))}
            </div>
          </section>
        </ResourceState>
      </div>
    </div>
  );
}
