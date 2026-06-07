// TaskAgentStatus — タスクカード内の実行エージェント表示（MC-164）
//
// 現在このタスクで作業中のエージェントを小さなバッジで表示。
// 最終活動からの経過時間（「2分前」等）も付与。

import type { Task } from '../lib/types';

interface TaskAgentStatusProps {
  task: Task;
}

export function TaskAgentStatus({ task }: TaskAgentStatusProps) {
  if (!task.executor) {
    return null;
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-accent/10 px-2 py-1.5 text-[11px]">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: '#10b981' }}
        aria-hidden
        title="実行中のエージェント"
      />
      <span className="font-mono text-text-muted">{task.executor.name}</span>
    </div>
  );
}
