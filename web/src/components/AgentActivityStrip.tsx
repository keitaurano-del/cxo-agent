// AgentActivityStrip — 全エージェントの稼働状態を表示する画面上部のバー（MC-164）
//
// 左右スクロール可能なエージェント一覧。各エージェントをクリックして、
// その現在のタスクまでスクロール・ハイライトする（将来）。

import type { AgentSummary } from '../lib/types';

interface AgentActivityStripProps {
  agents: AgentSummary[];
}

function AgentCard({ agent }: { agent: AgentSummary }): JSX.Element {
  const statusColor: Record<string, string> = {
    active: '#10b981',
    idle: '#6b7280',
    done: '#8b5cf6',
    never: '#9ca3af',
  };

  const statusLabel: Record<string, string> = {
    active: '実行中',
    idle: 'アイドル',
    done: '完了',
    never: '未稼働',
  };

  return (
    <div className="shrink-0 rounded-lg border border-border bg-surface p-3 min-w-max hover:border-accent/60 hover:bg-surface-2 transition-colors">
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: statusColor[agent.status] ?? '#6b7280' }}
              aria-hidden
            />
            <span className="text-xs font-mono font-semibold text-text">{agent.subagentType}</span>
          </div>
          <span className="text-[10px] text-text-faint">{statusLabel[agent.status]}</span>
        </div>
      </div>

      {/* 現在のタスク */}
      {agent.currentTaskId && (
        <div className="mt-2 rounded bg-accent/20 px-1.5 py-1">
          <span className="text-[10px] font-mono text-accent">{agent.currentTaskId}</span>
        </div>
      )}

      {/* 最終活動時刻（簡潔版） */}
      <div className="mt-1.5 text-[10px] text-text-faint">
        {new Date(agent.lastActivity).toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    </div>
  );
}

export function AgentActivityStrip({ agents }: AgentActivityStripProps) {
  // 人格保有エージェント（status が active/idle/done のもの）をフィルタ
  // status === 'never' は表示対象外（未稼働は可視化の必要がない）
  const activeAgents = agents.filter((a) => a.status !== 'never').slice(0, 9);

  if (activeAgents.length === 0) {
    return (
      <div className="border-b border-border bg-surface-2 px-4 py-3">
        <p className="text-center text-xs text-text-faint">稼働中のエージェントはありません</p>
      </div>
    );
  }

  return (
    <div className="border-b border-border bg-surface/40">
      <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        <div className="flex gap-2 px-4 py-3 min-w-max">
          {activeAgents.map((agent) => (
            <AgentCard key={agent.agentId} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}
