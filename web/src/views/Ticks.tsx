// 自律ループのティック可視化ビュー（MC-65）— GET /api/ticks（サーバ側 30 秒キャッシュ）。
// スコープ別レーン × 各ティックの「選んだタスク + 結果バッジ + 時刻」を表示する。
// マウント時 fetch + 30 秒間隔で再取得（Usage ビューと同じパターン）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, Badge, EmptyState } from '../components/ui';
import { LoopIcon } from '../components/icons';
import { relativeTime, absoluteTime } from '../lib/time';
import { projectColor } from '../lib/meta';
import type { ProjectName } from '../lib/types';

const REFRESH_INTERVAL_MS = 30 * 1000; // サーバ側キャッシュと同じ 30 秒

type TickStatus = 'running' | 'done' | 'skipped';
type TickResultKind = 'green' | 'red' | 'deploy' | 'idle' | 'unknown';

interface Tick {
  scope: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  status: TickStatus;
  selectedTask: { id: string | null; title: string | null } | null;
  result: { kind: TickResultKind; text: string } | null;
  durationMs: number | null;
  skipReason?: string;
}

interface TicksData {
  generatedAt: string;
  source: string;
  cached: boolean;
  scopes: string[];
  ticks: Tick[];
}

// ── 表示メタ（状態色は語ラベル + aria を必ず併記。ハードコード hex 不使用）──

const STATUS_META: Record<TickStatus, { label: string; color: string; bg: string }> = {
  running: { label: '実行中', color: 'var(--mc-active)', bg: 'var(--mc-active-bg)' },
  done: { label: '完了', color: 'var(--mc-done)', bg: 'var(--mc-done-bg)' },
  skipped: { label: 'スキップ', color: 'var(--mc-idle)', bg: 'var(--mc-idle-bg)' },
};

const RESULT_META: Record<TickResultKind, { label: string; color: string; bg: string }> = {
  green: { label: '成功', color: 'var(--mc-done)', bg: 'var(--mc-done-bg)' },
  deploy: { label: 'デプロイ', color: 'var(--mc-accent)', bg: 'var(--mc-surface-3)' },
  red: { label: '失敗', color: 'var(--mc-stalled)', bg: 'var(--mc-stalled-bg)' },
  idle: { label: '前進なし', color: 'var(--mc-idle)', bg: 'var(--mc-idle-bg)' },
  unknown: { label: '不明', color: 'var(--mc-text-muted)', bg: 'var(--mc-surface-3)' },
};

// scope（ログ由来の文字列）→ プロジェクト色のための ProjectName 写像。
// cxo / logic / en-chakai / nishimaru は既知トークンへ。未知は other 扱い。
function scopeToProject(scope: string): ProjectName {
  const s = scope.toLowerCase();
  if (s.includes('logic') || s === 'rin') return 'logic';
  if (s.includes('en-chakai') || s.includes('chakai')) return 'en-chakai';
  if (s.includes('nishimaru')) return 'nishimaru';
  if (s.includes('cxo') || s.includes('apollo')) return 'cxo';
  return 'other';
}

/** 所要時間を「m分s秒」で表示（null は空）。 */
function formatDuration(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}秒`;
  return `${m}分${s}秒`;
}

/** 状態ドット（色のみ依存にしない・aria-label に状態語）。 */
function StatusDot({ status }: { status: TickStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="status"
      aria-label={`状態: ${m.label}`}
    >
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
          status === 'running' ? 'mc-pulse' : ''
        }`}
        style={{ background: m.color }}
        aria-hidden
      />
      <span className="text-[11px] font-medium" style={{ color: m.color }}>
        {m.label}
      </span>
    </span>
  );
}

/** 結果バッジ（語ラベル + aria）。 */
function ResultBadge({ kind }: { kind: TickResultKind }) {
  const m = RESULT_META[kind];
  return (
    <span aria-label={`結果: ${m.label}`}>
      <Badge color={m.color} bg={m.bg}>
        {m.label}
      </Badge>
    </span>
  );
}

/** 1 ティックのカード。 */
function TickCard({ tick }: { tick: Tick }) {
  const duration = formatDuration(tick.durationMs);
  const task = tick.selectedTask;
  return (
    <article className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <StatusDot status={tick.status} />
        <time
          className="shrink-0 text-[11px] tabular-nums text-text-faint"
          dateTime={tick.startedAt}
          title={absoluteTime(tick.startedAt)}
        >
          {relativeTime(tick.startedAt)}
        </time>
      </div>

      {/* 選んだタスク */}
      <div className="mt-2">
        {task && (task.id || task.title) ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {task.id && (
              <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-text">
                {task.id}
              </span>
            )}
            {task.title && (
              <span className="min-w-0 break-words text-[13px] text-text" title={task.title}>
                {task.title}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[12px] text-text-faint">選んだタスクの記録はありません</span>
        )}
      </div>

      {/* 結果 / スキップ理由 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {tick.result && <ResultBadge kind={tick.result.kind} />}
        {duration && (
          <span className="text-[11px] tabular-nums text-text-faint">所要 {duration}</span>
        )}
      </div>
      {tick.result?.text && (
        <p className="mt-1.5 break-words text-[12px] leading-relaxed text-text-muted">
          {tick.result.text}
        </p>
      )}
      {tick.status === 'skipped' && tick.skipReason && (
        <p className="mt-1.5 break-words text-[12px] leading-relaxed text-text-muted">
          {tick.skipReason}
        </p>
      )}
    </article>
  );
}

/** スコープ 1 レーン（見出し + ティックカードの縦並び）。 */
function ScopeLane({ scope, ticks }: { scope: string; ticks: Tick[] }) {
  const accent = projectColor(scopeToProject(scope));
  return (
    <section className="flex min-w-0 flex-col gap-2 md:w-80 md:shrink-0">
      <div className="flex items-center gap-2 border-b border-border pb-1.5">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ background: accent }}
          aria-hidden
        />
        <h2 className="text-sm font-bold text-text">{scope}</h2>
        <span className="text-[11px] tabular-nums text-text-faint">{ticks.length} 件</span>
      </div>
      <div className="flex flex-col gap-2">
        {ticks.length === 0 ? (
          <EmptyState>このスコープのティックはありません</EmptyState>
        ) : (
          ticks.map((t) => <TickCard key={`${t.source}-${t.startedAt}`} tick={t} />)
        )}
      </div>
    </section>
  );
}

export default function Ticks() {
  const [data, setData] = useState<TicksData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/ticks', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for /api/ticks`);
      const json = (await res.json()) as TicksData;
      if (ctrl.signal.aborted) return;
      setData(json);
      setError(null);
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  // スコープ別にティックを束ねる（scopes の出現順を尊重）。
  const scopes = data?.scopes ?? [];
  const byScope = new Map<string, Tick[]>();
  for (const s of scopes) byScope.set(s, []);
  for (const t of data?.ticks ?? []) {
    if (!byScope.has(t.scope)) byScope.set(t.scope, []);
    byScope.get(t.scope)!.push(t);
  }
  const laneScopes = Array.from(byScope.keys());

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="ティック"
        subtitle={
          data
            ? `自律ループの直近 ${data.ticks.length} 件${data.cached ? '（キャッシュ）' : ''}`
            : '自律ループのティック'
        }
        fetchedAt={fetchedAt}
        right={
          <span className="text-accent" aria-hidden>
            <LoopIcon width={18} height={18} />
          </span>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data &&
            (data.ticks.length === 0 ? (
              <EmptyState>
                自律ループのティックはまだ記録されていません。次の周回が記録されると表示されます。
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-4 md:overflow-x-auto">
                {laneScopes.map((scope) => (
                  <ScopeLane key={scope} scope={scope} ticks={byScope.get(scope) ?? []} />
                ))}
              </div>
            ))}
        </ResourceState>
      </div>
    </div>
  );
}
