// Overview（司令塔）— 上部 KPI 帯 + プロジェクトカード + 横断検索（MC-73）。
// MC-67 でプロジェクトカードのタップ詳細を実装。MC-67 全タイル展開で KPI カードも
// タップ→詳細（プロジェクト別内訳＋関連タスク）に対応（TileDetail を再利用）。
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type {
  Overview as OverviewData,
  OverviewProject,
  ProjectName,
  Task,
  TaskStatus,
} from '../lib/types';
import { PROJECT_ORDER, priorityRank, projectColor, projectLabel } from '../lib/meta';
import { relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, StalledBadge, Badge, TaskStatusBadge } from '../components/ui';
import { GlobalSearch } from '../components/GlobalSearch';
import { AlertBanner } from '../components/AlertBanner';
import { ProjectDetail } from '../components/ProjectDetail';
import { TaskDetail } from '../components/TaskDetail';
import { TileDetail, type TileSection } from '../components/TileDetail';
import { ChevronRightIcon, SearchIcon } from '../components/icons';

// KPI タイルの種別。クリック時にどの内訳・関連を出すかを決める。
type KpiKind =
  | 'agentsActive'
  | 'agentsIdle'
  | 'tasksInProgress'
  | 'tasksStalled'
  | 'tasksBlocked'
  | 'tasksReview';

interface KpiCardProps {
  label: string;
  value: number;
  color: string;
  sub?: string;
  onOpen: () => void;
}

function KpiCard({ label, value, color, sub, onOpen }: KpiCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative cursor-pointer rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 hover:shadow-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-surface-3 md:p-4"
      aria-label={`指標の詳細を開く: ${label}`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs font-medium text-text-muted">{label}</div>
        <span
          className="shrink-0 text-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden
        >
          <ChevronRightIcon width={14} height={14} />
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums md:text-3xl" style={{ color }}>
          {value}
        </span>
        {sub && <span className="text-xs text-text-faint">{sub}</span>}
      </div>
    </button>
  );
}

// KPI 種別ごとの表示メタ（ドロワーのラベル・アクセント色・対象タスクステータス）。
const KPI_META: Record<
  KpiKind,
  { label: string; color: string; taskStatus?: TaskStatus; stalledOnly?: boolean }
> = {
  agentsActive: { label: '稼働中エージェント', color: 'var(--mc-active)' },
  agentsIdle: { label: '待機エージェント', color: 'var(--mc-idle)' },
  tasksInProgress: { label: '進行中タスク', color: 'var(--mc-active)', taskStatus: 'IN_PROGRESS' },
  tasksStalled: { label: '滞留タスク', color: 'var(--mc-stalled)', stalledOnly: true },
  tasksBlocked: { label: 'ブロックタスク', color: 'var(--mc-blocked)', taskStatus: 'BLOCKED' },
  tasksReview: { label: 'レビュー待ちタスク', color: 'var(--mc-review)', taskStatus: 'REVIEW' },
};

/** KPI カードのドリルダウン詳細。プロジェクト別の内訳＋関連タスクを TileDetail で表示。 */
function KpiDetail({
  kind,
  projects,
  onClose,
  onOpenTask,
}: {
  kind: KpiKind | null;
  projects: OverviewProject[];
  onClose: () => void;
  onOpenTask: (t: Task) => void;
}) {
  // 関連タスク（タスク系 KPI のみ）。/api/tasks から該当ステータスで抽出。
  const tick = useLiveTick('tasks');
  const { data: tasksData } = useLiveResource<{ tasks: Task[] }>('/api/tasks', tick);

  const sections = useMemo<TileSection[]>(() => {
    if (!kind) return [];
    const meta = KPI_META[kind];

    // (a) プロジェクト別の内訳。OverviewProject から該当指標を引く。
    const perProject = (p: OverviewProject): number => {
      switch (kind) {
        case 'agentsActive':
          return p.agentsActive;
        case 'agentsIdle':
          return p.agentsIdle;
        case 'tasksInProgress':
          return p.tasksInProgress;
        case 'tasksStalled':
          return p.tasksStalled;
        default:
          return 0; // blocked / review は overview に project 別集計が無い → タスクから集計
      }
    };

    // blocked / review はタスク一覧から project 別に数える。
    const taskCountsByProject = new Map<ProjectName, number>();
    if ((kind === 'tasksBlocked' || kind === 'tasksReview') && tasksData) {
      for (const t of tasksData.tasks) {
        if (t.status === meta.taskStatus) {
          taskCountsByProject.set(t.project, (taskCountsByProject.get(t.project) ?? 0) + 1);
        }
      }
    }

    const stats = projects
      .map((p) => {
        const v =
          kind === 'tasksBlocked' || kind === 'tasksReview'
            ? (taskCountsByProject.get(p.project) ?? 0)
            : perProject(p);
        return { project: p.project, value: v };
      })
      .filter((x) => x.value > 0)
      .map((x) => ({
        key: `proj:${x.project}`,
        label: projectLabel(x.project),
        value: x.value,
        color: projectColor(x.project),
      }));

    const breakdownSection: TileSection = {
      heading: 'プロジェクト別内訳',
      stats,
      emptyText: '該当するプロジェクトはありません。',
    };

    // (b) 関連タスク（タスク系 KPI のみ）。
    const sectionList: TileSection[] = [breakdownSection];
    if ((meta.taskStatus || meta.stalledOnly) && tasksData) {
      const related = tasksData.tasks
        .filter((t) =>
          meta.stalledOnly ? t.stalled : t.status === meta.taskStatus,
        )
        .sort(
          (a, b) =>
            Number(b.stalled) - Number(a.stalled) ||
            priorityRank(a.priority) - priorityRank(b.priority) ||
            a.id.localeCompare(b.id),
        )
        .map((t) => ({
          key: `${t.source}:${t.id}`,
          tag: t.id,
          badges: (
            <>
              <TaskStatusBadge status={t.status} />
              <Badge>{projectLabel(t.project)}</Badge>
              {t.priority && <Badge>{t.priority}</Badge>}
              {t.stalled && <StalledBadge />}
            </>
          ),
          title: t.title,
          onClick: () => onOpenTask(t),
        }));
      sectionList.push({
        heading: '関連タスク',
        related,
        emptyText: '該当するタスクはありません。',
      });
    } else if (kind === 'agentsActive' || kind === 'agentsIdle') {
      sectionList.push({
        heading: '関連情報',
        note: 'エージェントの一覧と会話タイムラインは「エージェント」タブで確認できます。',
        related: [],
        emptyText: '',
      });
    }
    return sectionList;
  }, [kind, projects, tasksData, onOpenTask]);

  if (!kind) return null;
  const meta = KPI_META[kind];
  return (
    <TileDetail
      open={!!kind}
      onClose={onClose}
      kindLabel="指標"
      title={meta.label}
      accent={meta.color}
      sections={sections}
    />
  );
}

function ProjectCard({ p, onOpen }: { p: OverviewProject; onOpen: (project: ProjectName) => void }) {
  const accent = projectColor(p.project);
  const empty = p.agentsTotal === 0 && p.tasksTotal === 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(p.project)}
      className="group relative w-full cursor-pointer rounded-xl border border-border bg-surface p-4 pr-8 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 hover:shadow-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-surface-3"
      style={{ borderLeft: `3px solid ${accent}` }}
      aria-label={`プロジェクト詳細を開く: ${projectLabel(p.project)}`}
    >
      <div className="flex items-center justify-between gap-2 pr-1">
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

      {/* 右端の chevron。タップ可能であることを示す恒常的な手がかり。 */}
      <span
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden
      >
        <ChevronRightIcon width={16} height={16} />
      </span>
    </button>
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
  // 横断検索モーダル（MC-73）の開閉。
  const [searchOpen, setSearchOpen] = useState(false);
  // プロジェクトカードのドリルダウン詳細（MC-67）。null は閉じている状態。
  const [selectedProject, setSelectedProject] = useState<ProjectName | null>(null);
  // KPI カードのドリルダウン詳細（MC-67 全タイル展開）。null は閉じている状態。
  const [selectedKpi, setSelectedKpi] = useState<KpiKind | null>(null);
  // 関連タスクから開くタスク詳細（MC-61）。ProjectDetail / KpiDetail の上に重ねて開く。
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
              aria-label="横断検索を開く"
            >
              <SearchIcon width={14} height={14} />
              検索
            </button>
            <Link
              to="/agents"
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
            >
              エージェント一覧
            </Link>
          </div>
        }
      />
      <div className="p-4 md:p-6">
        {/* アラートバッジ（MC-63）。0 件なら自身で非表示。KPI 帯の手前に常設。 */}
        <AlertBanner />
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {kpi && (
            <section className="mb-8">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KpiCard
                  label="稼働中"
                  value={kpi.agentsActive}
                  color="var(--mc-active)"
                  sub={`/ ${kpi.agentsTotal}`}
                  onOpen={() => setSelectedKpi('agentsActive')}
                />
                <KpiCard
                  label="待機"
                  value={kpi.agentsIdle}
                  color="var(--mc-idle)"
                  onOpen={() => setSelectedKpi('agentsIdle')}
                />
                <KpiCard
                  label="進行中タスク"
                  value={kpi.tasksInProgress}
                  color="var(--mc-active)"
                  onOpen={() => setSelectedKpi('tasksInProgress')}
                />
                <KpiCard
                  label="滞留タスク"
                  value={kpi.tasksStalled}
                  color="var(--mc-stalled)"
                  onOpen={() => setSelectedKpi('tasksStalled')}
                />
                <KpiCard
                  label="ブロック"
                  value={kpi.tasksBlocked}
                  color="var(--mc-blocked)"
                  onOpen={() => setSelectedKpi('tasksBlocked')}
                />
                <KpiCard
                  label="レビュー待ち"
                  value={kpi.tasksReview}
                  color="var(--mc-review)"
                  onOpen={() => setSelectedKpi('tasksReview')}
                />
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text-muted">プロジェクト</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.map((p) => (
                <ProjectCard key={p.project} p={p} onOpen={setSelectedProject} />
              ))}
            </div>
          </section>
        </ResourceState>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      {/* プロジェクト詳細（MC-67）。関連タスククリックで TaskDetail を上に重ねて開く。 */}
      <ProjectDetail
        project={selectedProject}
        onClose={() => setSelectedProject(null)}
        onOpenTask={setSelectedTask}
      />
      {/* KPI カードのドリルダウン詳細（MC-67 全タイル展開）。 */}
      <KpiDetail
        kind={selectedKpi}
        projects={projects}
        onClose={() => setSelectedKpi(null)}
        onOpenTask={setSelectedTask}
      />
      <TaskDetail task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
  );
}
