// Tasks（Kanban）— TODO/IN_PROGRESS/BLOCKED/REVIEW/DONE/CANCELLED の列。
// カードはプロジェクト色分け、stalled は赤バッジ。プロジェクトでフィルタ。
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { ProjectName, Task, TaskStatus } from '../lib/types';
import {
  PROJECT_ORDER,
  TASK_COLUMNS,
  projectColor,
  projectLabel,
  taskStatusMeta,
} from '../lib/meta';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, StalledBadge, Badge } from '../components/ui';
import { TaskDetail } from '../components/TaskDetail';

function TaskCard({ t, onOpen }: { t: Task; onOpen: (t: Task) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(t)}
      className="w-full rounded-lg border border-border bg-surface p-3 text-left hover:bg-surface-2"
      style={{ borderLeft: `3px solid ${projectColor(t.project)}` }}
      aria-label={`タスク詳細を開く: ${t.title}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] text-text-faint">{t.id}</span>
        {t.stalled && <StalledBadge />}
      </div>
      <p className="mt-1 text-[13px] leading-snug text-text">{t.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 text-[10px] text-text-muted"
          title={`プロジェクト: ${projectLabel(t.project)}`}
        >
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: projectColor(t.project) }}
            aria-hidden
          />
          {projectLabel(t.project)}
        </span>
        {t.priority && <Badge>{t.priority}</Badge>}
        {t.owner && (
          <span className="text-[10px] text-text-faint" title={`担当: ${t.owner}`}>
            {t.owner}
          </span>
        )}
      </div>
      <div className="mt-1 text-[10px] text-text-faint" title={`出典: ${t.source}`}>
        {t.source}
      </div>
    </button>
  );
}

function Column({
  status,
  tasks,
  onOpen,
}: {
  status: TaskStatus;
  tasks: Task[];
  onOpen: (t: Task) => void;
}) {
  const meta = taskStatusMeta(status);
  return (
    <div className="flex w-full shrink-0 flex-col rounded-xl border border-border bg-surface/40 md:w-72">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: meta.color }}
            aria-hidden
          />
          <span className="text-xs font-bold text-text">{meta.label}</span>
        </div>
        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] tabular-nums text-text-muted">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto p-2 md:max-h-[calc(100dvh-12rem)]">
        {tasks.map((t) => (
          <TaskCard key={`${t.source}:${t.id}`} t={t} onOpen={onOpen} />
        ))}
        {tasks.length === 0 && (
          <p className="px-2 py-4 text-center text-[11px] text-text-faint">なし</p>
        )}
      </div>
    </div>
  );
}

export default function Tasks() {
  const tick = useLiveTick('tasks');
  const { data, error, loading, fetchedAt, refetch } = useLiveResource<{ tasks: Task[] }>(
    '/api/tasks',
    tick,
  );
  const [project, setProject] = useState<ProjectName | 'all'>('all');
  // モバイルでは横スクロールカンバンの代わりに、選択した 1 列のみ全幅縦積みで表示する。
  const [activeColumn, setActiveColumn] = useState<TaskStatus>('IN_PROGRESS');
  // カードクリックで開くタスク詳細（MC-61）。null は閉じている状態。
  const [selected, setSelected] = useState<Task | null>(null);
  // 横断検索（MC-73）からの deep link: ?task=<id>&source=<source> で該当タスクを自動で開く。
  const [searchParams, setSearchParams] = useSearchParams();

  const tasks = data?.tasks ?? [];

  // deep link パラメータが付いていて、対象タスクが読み込めたら TaskDetail を自動で開く。
  // 一度開いたら URL から消費パラメータを除去し、再フェッチで再オープンしないようにする。
  const deepLinkId = searchParams.get('task');
  const deepLinkSource = searchParams.get('source');
  useEffect(() => {
    if (!deepLinkId || tasks.length === 0) return;
    const match =
      tasks.find(
        (t) => t.id === deepLinkId && (!deepLinkSource || t.source === deepLinkSource),
      ) ?? tasks.find((t) => t.id === deepLinkId);
    if (match) {
      setSelected(match);
      const next = new URLSearchParams(searchParams);
      next.delete('task');
      next.delete('source');
      setSearchParams(next, { replace: true });
    }
  }, [deepLinkId, deepLinkSource, tasks, searchParams, setSearchParams]);

  const presentProjects = useMemo(() => {
    const set = new Set(tasks.map((t) => t.project));
    return PROJECT_ORDER.filter((p) => set.has(p));
  }, [tasks]);

  const filtered = useMemo(
    () => (project === 'all' ? tasks : tasks.filter((t) => t.project === project)),
    [tasks, project],
  );

  // 列ごとに振り分け。UNKNOWN は TODO 列に寄せる（落とさない）。
  const byColumn = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      TODO: [],
      IN_PROGRESS: [],
      BLOCKED: [],
      REVIEW: [],
      DONE: [],
      CANCELLED: [],
      UNKNOWN: [],
    };
    for (const t of filtered) {
      const col: TaskStatus = t.status === 'UNKNOWN' ? 'TODO' : t.status;
      map[col].push(t);
    }
    // 各列内: stalled を先頭、その後 ID 順。
    for (const k of Object.keys(map) as TaskStatus[]) {
      map[k].sort((a, b) => Number(b.stalled) - Number(a.stalled) || a.id.localeCompare(b.id));
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="タスクボード"
        subtitle={`全 ${filtered.length} 件 / 滞留 ${filtered.filter((t) => t.stalled).length} 件`}
        fetchedAt={fetchedAt}
        right={
          <div
            className="no-scrollbar -mx-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto px-1"
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
              全て
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
        }
      />
      {/* モバイル: ステータスタブ（件数バッジ付き）で 1 列を選んで縦積み表示 */}
      <div className="border-b border-border px-4 py-2 md:hidden">
        <div
          className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1"
          role="tablist"
          aria-label="ステータスで表示列を選択"
        >
          {TASK_COLUMNS.map((status) => {
            const meta = taskStatusMeta(status);
            const count = byColumn[status].length;
            const selected = activeColumn === status;
            return (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveColumn(status)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs ${
                  selected ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: meta.color }}
                  aria-hidden
                />
                {meta.label}
                <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-text-muted">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-x-auto p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {/* モバイル: 選択列のみ全幅縦積み */}
          <div className="md:hidden">
            <Column status={activeColumn} tasks={byColumn[activeColumn]} onOpen={setSelected} />
          </div>
          {/* md 以上: 横並びカンバン */}
          <div className="hidden gap-3 md:flex">
            {TASK_COLUMNS.map((status) => (
              <Column key={status} status={status} tasks={byColumn[status]} onOpen={setSelected} />
            ))}
          </div>
        </ResourceState>
      </div>
      <TaskDetail task={selected} onClose={() => setSelected(null)} onChanged={refetch} />
    </div>
  );
}
