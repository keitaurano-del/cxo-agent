// タスク領域のタブ・シェル。
// 「タスクボード」(Tasks) と「承認フロー」(Approvals) を1つのサイドバー項目配下のタブにまとめる。
// Tasks.tsx / Approvals.tsx 本体には手を入れず、両者を遅延ロードして切替表示する薄いラッパ。
// 各ビューは自前の PageHeader を持つため、ここではタブ・ストリップのみ提供する。
import { lazy, Suspense, useState } from 'react';

const Tasks = lazy(() => import('./Tasks'));
const Approvals = lazy(() => import('./Approvals'));

type TaskTab = 'tasks' | 'approvals';

function resolveInitial(initial?: TaskTab): TaskTab {
  if (initial) return initial;
  if (typeof window !== 'undefined') {
    if (window.location.pathname.startsWith('/approvals')) return 'approvals';
    if (new URLSearchParams(window.location.search).get('tab') === 'approvals') return 'approvals';
  }
  return 'tasks';
}

const TABS: [TaskTab, string][] = [
  ['tasks', 'タスクボード'],
  ['approvals', '承認フロー'],
];

export default function TasksTabs({ initialTab }: { initialTab?: TaskTab } = {}) {
  const [tab, setTab] = useState<TaskTab>(() => resolveInitial(initialTab));

  function changeTab(next: TaskTab) {
    setTab(next);
    // 履歴を汚さず URL を同期（リロードでタブ維持・旧リンク互換）。
    try {
      window.history.replaceState(null, '', next === 'approvals' ? '/approvals' : '/tasks');
    } catch {
      /* noop */
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="タスクボード領域"
        className="flex shrink-0 items-center gap-1 border-b border-border bg-bg px-4 md:px-6"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => changeTab(key)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="p-6 text-sm text-text-muted">読み込み中…</div>}>
          {tab === 'tasks' ? <Tasks /> : <Approvals />}
        </Suspense>
      </div>
    </div>
  );
}
