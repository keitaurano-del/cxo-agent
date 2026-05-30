// 滞留・稼働状態の判定ロジック。
//
// しきい値は config.STALL_MINUTES（default 8 分）。
// memory「subagent は遅いだけで死んでない」に準拠 — 短く切らない。

import { STALL_MINUTES } from '../config.js';

export type AgentStatus = 'active' | 'idle' | 'done' | 'never';

/** 最終活動からの経過分。 */
export function minutesSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / 60000;
}

/**
 * エージェント状態を判定する。
 * - done: セッションが result 行などで終了している
 * - never: 一度も活動していない（活動時刻なし）
 * - active: 最終活動が STALL_MINUTES 未満
 * - idle: それ以上経過
 */
export function agentStatus(opts: {
  lastActivity: string | null;
  hasResult: boolean;
  hadAnyActivity: boolean;
  now?: number;
}): AgentStatus {
  const now = opts.now ?? Date.now();
  if (!opts.hadAnyActivity) return 'never';
  if (opts.hasResult) return 'done';
  const mins = minutesSince(opts.lastActivity, now);
  if (mins < STALL_MINUTES) return 'active';
  return 'idle';
}
