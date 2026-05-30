// 状態・プロジェクト・タスクステータスのメタデータ（語ラベル・配色変数）。
// 色は CSS 変数を参照し、語ラベルを必ず併記する（色のみ依存禁止）。

import type { AgentStatus, ProjectName, TaskStatus } from './types';

export interface StatusMeta {
  label: string; // 語ラベル（aria 併記用）
  color: string; // CSS 変数（ドット・テキスト色）
  bg: string; // CSS 変数（バッジ背景）
}

export const AGENT_STATUS_META: Record<AgentStatus, StatusMeta> = {
  active: { label: '稼働中', color: 'var(--mc-active)', bg: 'var(--mc-active-bg)' },
  idle: { label: '待機', color: 'var(--mc-idle)', bg: 'var(--mc-idle-bg)' },
  done: { label: '完了', color: 'var(--mc-done)', bg: 'var(--mc-done-bg)' },
  never: { label: '未稼働', color: 'var(--mc-never)', bg: 'var(--mc-never-bg)' },
};

export function agentStatusMeta(status: AgentStatus): StatusMeta {
  return AGENT_STATUS_META[status] ?? AGENT_STATUS_META.never;
}

// プロジェクト表示順（Overview / Tasks フィルタの並びの正準）。
export const PROJECT_ORDER: ProjectName[] = [
  'logic',
  'en-chakai',
  'nishimaru',
  'ai-pmo',
  'cxo',
  'private',
  'other',
];

const PROJECT_LABELS: Record<ProjectName, string> = {
  logic: 'logic',
  'en-chakai': 'en-chakai',
  nishimaru: '西丸町',
  'ai-pmo': 'ai-pmo',
  cxo: 'cxo',
  private: 'private',
  other: 'other',
};

const PROJECT_COLORS: Record<ProjectName, string> = {
  logic: 'var(--mc-proj-logic)',
  'en-chakai': 'var(--mc-proj-en-chakai)',
  nishimaru: 'var(--mc-proj-nishimaru)',
  'ai-pmo': 'var(--mc-proj-ai-pmo)',
  cxo: 'var(--mc-proj-cxo)',
  private: 'var(--mc-proj-private)',
  other: 'var(--mc-proj-other)',
};

export function projectLabel(p: ProjectName): string {
  return PROJECT_LABELS[p] ?? p;
}

export function projectColor(p?: ProjectName | null): string {
  if (!p) return 'var(--mc-proj-other)';
  return PROJECT_COLORS[p] ?? 'var(--mc-proj-other)';
}

// Kanban の列順。CANCELLED は末尾（折りたたみ扱いにする）。
export const TASK_COLUMNS: TaskStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'DONE',
  'CANCELLED',
];

interface TaskStatusMeta {
  label: string;
  color: string;
  bg: string;
}

export const TASK_STATUS_META: Record<TaskStatus, TaskStatusMeta> = {
  TODO: { label: 'TODO', color: 'var(--mc-text-muted)', bg: 'var(--mc-surface-3)' },
  IN_PROGRESS: { label: '進行中', color: 'var(--mc-active)', bg: 'var(--mc-active-bg)' },
  BLOCKED: { label: 'ブロック', color: 'var(--mc-blocked)', bg: 'var(--mc-blocked-bg)' },
  REVIEW: { label: 'レビュー', color: 'var(--mc-review)', bg: 'var(--mc-review-bg)' },
  DONE: { label: '完了', color: 'var(--mc-done)', bg: 'var(--mc-done-bg)' },
  CANCELLED: { label: '中止', color: 'var(--mc-text-faint)', bg: 'var(--mc-surface-2)' },
  UNKNOWN: { label: '未分類', color: 'var(--mc-text-faint)', bg: 'var(--mc-surface-2)' },
};

export function taskStatusMeta(s: TaskStatus): TaskStatusMeta {
  return TASK_STATUS_META[s] ?? TASK_STATUS_META.UNKNOWN;
}
