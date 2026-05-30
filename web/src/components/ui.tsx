// 共有 UI コンポーネント。状態色は語ラベル + aria を必ず併記する。
import type { ReactNode } from 'react';
import type { AgentStatus, ProjectName, TaskStatus } from '../lib/types';
import { agentStatusMeta, projectColor, projectLabel, taskStatusMeta } from '../lib/meta';
import { AlertIcon } from './icons';

/** 状態ドット + 語ラベル。色のみ依存にしない（aria-label に状態語を入れる）。 */
export function StatusDot({
  status,
  withLabel = true,
}: {
  status: AgentStatus;
  withLabel?: boolean;
}) {
  const meta = agentStatusMeta(status);
  const pulse = status === 'active';
  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="status"
      aria-label={`状態: ${meta.label}`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${pulse ? 'mc-pulse' : ''}`}
        style={{ background: meta.color }}
        aria-hidden
      />
      {withLabel && (
        <span className="text-xs font-medium" style={{ color: meta.color }}>
          {meta.label}
        </span>
      )}
    </span>
  );
}

/** 汎用バッジ。 */
export function Badge({
  children,
  color,
  bg,
  title,
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none"
      style={{
        color: color ?? 'var(--mc-text-muted)',
        background: bg ?? 'var(--mc-surface-3)',
      }}
      title={title}
    >
      {children}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const m = taskStatusMeta(status);
  return (
    <Badge color={m.color} bg={m.bg}>
      {m.label}
    </Badge>
  );
}

/** プロジェクト色のチップ（左罫線色や凡例で使う）。 */
export function ProjectChip({ project }: { project: ProjectName }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ background: projectColor(project) }}
        aria-hidden
      />
      <span className="text-xs text-text-muted">{projectLabel(project)}</span>
    </span>
  );
}

export function StalledBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ color: 'var(--mc-stalled)', background: 'var(--mc-stalled-bg)' }}
      aria-label="滞留しています"
    >
      <AlertIcon width={11} height={11} />
      滞留
    </span>
  );
}

export function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
      aria-hidden
    />
  );
}

/** ローディング / エラーの共通枠。data があれば children を出しつつ error を上に小さく出す。 */
export function ResourceState({
  loading,
  error,
  hasData,
  children,
  label,
}: {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  children: ReactNode;
  label?: string;
}) {
  if (loading && !hasData) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-text-muted">
        <Spinner />
        <span>{label ?? 'データを取得しています…'}</span>
      </div>
    );
  }
  if (error && !hasData) {
    return (
      <div
        className="m-4 rounded-lg border border-stalled/40 bg-stalled-bg/60 p-4 text-sm"
        style={{ color: 'var(--mc-text)' }}
        role="alert"
      >
        <div className="mb-1 font-semibold" style={{ color: 'var(--mc-stalled)' }}>
          読み込みに失敗しました
        </div>
        <div className="text-text-muted">{error}</div>
        <div className="mt-1 text-xs text-text-faint">
          server が起動しているか確認してください（数秒後に自動で再試行します）。
        </div>
      </div>
    );
  }
  return (
    <>
      {error && hasData && (
        <div
          className="mb-3 rounded border border-idle/30 px-3 py-1.5 text-xs"
          style={{ color: 'var(--mc-idle)', background: 'var(--mc-idle-bg)' }}
          role="status"
        >
          最新の取得に失敗したため、直近のデータを表示しています。
        </div>
      )}
      {children}
    </>
  );
}

/** 空状態。 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-faint">
      {children}
    </div>
  );
}
