// TaskTimeline（MC-163）— タスク詳細の活動履歴タイムラインセクション
// TASK_TRACKER の note 解析 + git log grep で集約した時系列イベント表示。
// 例: 「2026-06-07 IN_PROGRESS に変更」「林がコミット『Fix timeline display』」など。

import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import { absoluteTime, relativeTime } from '../lib/time';
import { Spinner } from './ui';

interface TimelineEvent {
  timestamp: string; // ISO 8601
  type: 'status' | 'owner' | 'commit' | 'note' | 'other';
  message: string;
  author?: string;
  link?: string; // git commit SHA etc
}

interface TimelineResponse {
  taskId: string;
  events: TimelineEvent[];
  generatedAt: string;
}

/**
 * イベント種別を日本語ラベル + アイコン候補に変換。
 * UI chrome は SVG アイコンのみ（絵文字NG）。
 */
function getEventTypeLabel(type: TimelineEvent['type']): {
  label: string;
  iconClass: string;
} {
  switch (type) {
    case 'status':
      return { label: 'ステータス', iconClass: 'text-accent' };
    case 'owner':
      return { label: '担当', iconClass: 'text-blue-500' };
    case 'commit':
      return { label: 'コミット', iconClass: 'text-green-500' };
    case 'note':
      return { label: '注記', iconClass: 'text-text-muted' };
    default:
      return { label: 'その他', iconClass: 'text-text-faint' };
  }
}

/**
 * タスク詳細のタイムラインセクション。
 * /api/tasks/:taskId/timeline から イベント配列を取得し、時系列で表示。
 */
export function TaskTimeline({ taskId }: { taskId: string }) {
  const tick = useLiveTick();
  const { data, loading, error } = useLiveResource<TimelineResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/timeline`,
    tick
  );

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-muted">
        <Spinner />
        タイムラインを取得しています…
      </div>
    );
  }

  if (error && !data) {
    return (
      <p className="text-[12px]" style={{ color: 'var(--mc-stalled)' }} role="alert">
        タイムラインの取得に失敗しました（{error}）。
      </p>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
        このタスクの活動履歴はありません。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {events.map((evt, idx) => {
          const { label: typeLabel, iconClass } = getEventTypeLabel(evt.type);
          return (
            <li
              key={idx}
              className="rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                {/* アイコン（色付きドット） */}
                <span
                  className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${iconClass}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[12px] font-medium text-text">
                      {evt.message}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--mc-text-faint)' }}>
                      {typeLabel}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-faint">
                    <span title={absoluteTime(evt.timestamp)}>
                      {relativeTime(evt.timestamp)}
                    </span>
                    {evt.author && <span>{evt.author}</span>}
                    {evt.link && (
                      <span className="font-mono">
                        {evt.link.substring(0, 7)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
