// ProjectDetail（MC-67）— 司令塔(Overview)のプロジェクトカードのドリルダウン詳細。
// TaskDetail（MC-61）のドロワー作法を踏襲する派生実装。
//   - createPortal で body 直下、fixed inset-0 z-50、右スライド(md:w-[34rem])/モバイル全幅
//   - 背面オーバーレイ button、Esc クローズ＋背面スクロールロック、上端に projectColor の border
//   - 本文 overflow-y-auto
// 内容:
//   (a) ヘッダ: projectLabel + 状態ドット（projectColor、aria 併記）
//   (b) 内訳: そのプロジェクトのタスクをステータス別に集計（TASK_COLUMNS 各列の件数 + 滞留件数）
//   (c) 関連タスク: その project のタスク一覧（Tasks.tsx と同じ並び）。各行クリックで onOpenTask(t)。
//
// デザイン制約: ハードコード hex 禁止（既存トークン/CSS 変数のみ）、UI chrome は SVG アイコンのみ、
//   文言は中立的な丁寧体、モバイル 390px で横溢れ 0。

import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectName, Task, TaskStatus } from '../lib/types';
import {
  priorityRank,
  projectColor,
  projectLabel,
  taskStatusMeta,
  TASK_COLUMNS,
} from '../lib/meta';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import { Badge, Spinner, StalledBadge, TaskStatusBadge } from './ui';
import { ChevronRightIcon, CloseIcon } from './icons';

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-faint">
      {children}
    </h3>
  );
}

/** プロジェクト詳細ドロワー。project が null の間は何も描画しない（hooks 条件分岐を避けるため本体を分離）。 */
export function ProjectDetail({
  project,
  onClose,
  onOpenTask,
}: {
  project: ProjectName | null;
  onClose: () => void;
  onOpenTask: (t: Task) => void;
}) {
  // Esc クローズ + 背面スクロールロック。
  useEffect(() => {
    if (!project) return;
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
  }, [project, onClose]);

  if (!project) return null;
  return <ProjectDetailBody project={project} onClose={onClose} onOpenTask={onOpenTask} />;
}

/** ドロワー本体（project が確定した状態で描画）。/api/tasks を取得し、その project のタスクに絞る。 */
function ProjectDetailBody({
  project,
  onClose,
  onOpenTask,
}: {
  project: ProjectName;
  onClose: () => void;
  onOpenTask: (t: Task) => void;
}) {
  const tick = useLiveTick('tasks');
  const { data, error, loading } = useLiveResource<{ tasks: Task[] }>('/api/tasks', tick);

  // この project のタスクのみ抽出。
  const tasks = useMemo(
    () => (data?.tasks ?? []).filter((t) => t.project === project),
    [data, project],
  );

  // 内訳: TASK_COLUMNS 各列の件数。UNKNOWN は TODO に寄せる（Tasks.tsx と同じ）。
  const counts = useMemo(() => {
    const map: Record<TaskStatus, number> = {
      TODO: 0,
      IN_PROGRESS: 0,
      BLOCKED: 0,
      REVIEW: 0,
      DONE: 0,
      CANCELLED: 0,
      UNKNOWN: 0,
    };
    for (const t of tasks) {
      const col: TaskStatus = t.status === 'UNKNOWN' ? 'TODO' : t.status;
      map[col] += 1;
    }
    return map;
  }, [tasks]);

  const stalledCount = useMemo(() => tasks.filter((t) => t.stalled).length, [tasks]);

  // 関連タスクの並び（Tasks.tsx と同じ）:
  //   1. stalled を先頭に寄せる
  //   2. priorityRank（高優先ほど上、不明は最後尾）
  //   3. 同優先度なら ID 昇順
  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          Number(b.stalled) - Number(a.stalled) ||
          priorityRank(a.priority) - priorityRank(b.priority) ||
          a.id.localeCompare(b.id),
      ),
    [tasks],
  );

  const accent = projectColor(project);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`プロジェクト詳細: ${projectLabel(project)}`}
    >
      {/* 背面オーバーレイ */}
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      {/* ドロワー本体: モバイルは全幅、md 以上は右スライドのパネル */}
      <div
        className="relative flex h-full w-full max-w-full flex-col border-l border-border bg-bg shadow-xl md:w-[34rem]"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        {/* ヘッダ */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <span
              className="inline-flex items-center gap-2 text-[11px] text-text-faint"
              role="status"
              aria-label={`プロジェクト: ${projectLabel(project)}`}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: accent }}
                aria-hidden
              />
              プロジェクト
            </span>
            <h2 className="mt-1 text-[15px] font-bold leading-snug text-text">
              {projectLabel(project)}
            </h2>
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
          {loading && !data ? (
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Spinner />
              タスクを取得しています…
            </div>
          ) : error && !data ? (
            <p
              className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px]"
              style={{ color: 'var(--mc-stalled)' }}
              role="alert"
            >
              タスクの取得に失敗しました（{error}）。
            </p>
          ) : (
            <>
              {/* (b) 内訳 */}
              <section className="mb-5">
                <SectionHeading>内訳</SectionHeading>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TASK_COLUMNS.map((status) => {
                    const meta = taskStatusMeta(status);
                    return (
                      <div
                        key={status}
                        className="rounded-lg border border-border bg-surface px-3 py-2.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ background: meta.color }}
                            aria-hidden
                          />
                          <span className="text-[11px] text-text-muted">{meta.label}</span>
                        </div>
                        <div className="mt-1 text-lg font-semibold tabular-nums text-text">
                          {counts[status]}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* 滞留件数。色のみ依存にしない（語ラベル併記）。 */}
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    {stalledCount > 0 ? (
                      <StalledBadge />
                    ) : (
                      <span className="text-[11px] text-text-muted">滞留</span>
                    )}
                  </span>
                  <span
                    className="text-lg font-semibold tabular-nums"
                    style={{ color: stalledCount > 0 ? 'var(--mc-stalled)' : 'var(--mc-text)' }}
                    aria-label={`滞留タスク ${stalledCount} 件`}
                  >
                    {stalledCount}
                  </span>
                </div>
              </section>

              {/* (c) 関連タスク */}
              <section>
                <SectionHeading>関連タスク</SectionHeading>
                {sortedTasks.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
                    このプロジェクトのタスクはありません。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {sortedTasks.map((t) => (
                      <li key={`${t.source}:${t.id}`}>
                        <button
                          type="button"
                          onClick={() => onOpenTask(t)}
                          className="group flex w-full items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                          aria-label={`タスク詳細を開く: ${t.title}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-mono text-[10px] text-text-faint">{t.id}</span>
                              <TaskStatusBadge status={t.status} />
                              {t.priority && <Badge>{t.priority}</Badge>}
                              {t.stalled && <StalledBadge />}
                            </div>
                            <p className="mt-1 break-words text-[13px] leading-snug text-text">
                              {t.title}
                            </p>
                          </div>
                          <span
                            className="mt-0.5 shrink-0 text-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent"
                            aria-hidden
                          >
                            <ChevronRightIcon width={16} height={16} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
