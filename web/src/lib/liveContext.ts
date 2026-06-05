// SSE 由来の再フェッチトリガー（種別ごとの tick）を全ビューで共有するコンテキスト。
import { createContext, useContext } from 'react';
import type { LiveResourceType, LiveTicks } from './useLiveData';

export interface LiveContextValue {
  ticks: LiveTicks;
}

const ZERO_TICKS: LiveTicks = { agents: 0, tasks: 0, narrative: 0, vault: 0, deliverables: 0 };

export const LiveContext = createContext<LiveContextValue>({ ticks: ZERO_TICKS });

/**
 * 指定したリソース種別の合算 tick を返す。
 * SSE で該当種別の update が来た時だけ値が増え、useLiveResource の再フェッチを誘発する。
 *
 * @param types 依存するリソース種別（1つ以上）。例: Overview は ['agents','tasks']。
 *              省略時は全種別を合算（どの変更でも再フェッチ）。
 */
export function useLiveTick(...types: LiveResourceType[]): number {
  const { ticks } = useContext(LiveContext);
  const targets: LiveResourceType[] =
    types.length > 0 ? types : ['agents', 'tasks', 'narrative'];
  let sum = 0;
  for (const t of targets) sum += ticks[t];
  return sum;
}
