// タスク領域のタブ・シェル。
// 「タスクボード」(Tasks)・「エージェント」(AgentsLive)・「実装進捗」(BuildProgress)・
// 「承認」(Approvals) を1つのサイドバー項目配下のタブにまとめる。
// 各ビュー本体には手を入れず、遅延ロードして切替表示する薄いラッパ。
// 各ビューは自前の PageHeader を持つため、ここではタブ・ストリップのみ提供する。
// 2026-07-19 Keita 指示: 承認フローをタスクボードに再表示（未処理件数バッジ付き）。
// 2026-07-20 Keita 指示（MC-317）: エージェント（旧ダッシュタブ）と実装進捗（旧独立ナビ）を
// タスクボードに集約。「今何をやっているか」をこのページ1枚で見られるようにする。
import { lazy, Suspense, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type { ApprovalsResponse } from '../lib/types';

const Tasks = lazy(() => import('./Tasks'));
const Approvals = lazy(() => import('./Approvals'));
const AgentsLive = lazy(() => import('./AgentsLive'));
const BuildProgress = lazy(() => import('./BuildProgress'));

type TaskTab = 'tasks' | 'agents' | 'progress' | 'approvals';

// タブ→URL の対応（履歴を汚さず replaceState で同期。旧リンク互換）。
const TAB_PATHS: Record<TaskTab, string> = {
  tasks: '/tasks',
  agents: '/agents-live',
  progress: '/progress',
  approvals: '/approvals',
};

function resolveInitial(initial?: TaskTab): TaskTab {
  if (initial) return initial;
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.startsWith('/approvals')) return 'approvals';
    if (path.startsWith('/agents-live')) return 'agents';
    if (path.startsWith('/progress')) return 'progress';
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'approvals' || q === 'agents' || q === 'progress') return q;
  }
  return 'tasks';
}

const TABS: [TaskTab, string][] = [
  ['tasks', 'タスクボード'],
  ['agents', 'エージェント'],
  ['progress', '実装進捗'],
  ['approvals', '承認'],
];

export default function TasksTabs({ initialTab }: { initialTab?: TaskTab } = {}) {
  const [tab, setTab] = useState<TaskTab>(() => resolveInitial(initialTab));

  // 承認タブの未処理件数バッジ（タスク承認 items + エージェント要求 requests）。
  const { data: approvals } = useLiveResource<ApprovalsResponse>('/api/approvals');
  const pendingCount = (approvals?.total ?? 0) + (approvals?.requests?.length ?? 0);

  function changeTab(next: TaskTab) {
    setTab(next);
    // 履歴を汚さず URL を同期（リロードでタブ維持・旧リンク互換）。
    try {
      window.history.replaceState(null, '', TAB_PATHS[next]);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="タスクボード領域"
        className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-bg px-4 md:px-6"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => changeTab(key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {label}
            {key === 'approvals' && pendingCount > 0 && (
              <span
                className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-blocked px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                aria-label={`未処理 ${pendingCount} 件`}
              >
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* 承認/エージェントは本体がルート <div>（自前スクロール無し）のため、ここでスクロール容器にする。
          タスク/実装進捗は本体が h-full 内部スクロールを持つので overflow は付けない（二重スクロール回避）。 */}
      <div className={`min-h-0 flex-1 ${tab === 'tasks' || tab === 'progress' ? '' : 'overflow-y-auto'}`}>
        <Suspense fallback={<div className="p-6 text-sm text-text-muted">読み込み中…</div>}>
          {tab === 'approvals' ? (
            <Approvals />
          ) : tab === 'agents' ? (
            <AgentsLive />
          ) : tab === 'progress' ? (
            <BuildProgress />
          ) : (
            <Tasks />
          )}
        </Suspense>
      </div>
    </div>
  );
}
