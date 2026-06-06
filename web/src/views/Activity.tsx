// Activity — ティック（自律ループ）＋消費量（トークン）の統合ビュー。
// 上半分: Ticks のスコープ別レーン × ティックカード。
// 下半分: Usage の消費量サマリ＋プロジェクト/モデル別内訳。
// 旧 /ticks と /usage を 1 画面に集約し、ダッシュボードタブを 1 つ削減する。
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, Badge, EmptyState } from '../components/ui';
import { TileDetail, type TileSection } from '../components/TileDetail';
import { LoopIcon, ActivityIcon } from '../components/icons';
import { relativeTime, absoluteTime } from '../lib/time';
import { projectColor } from '../lib/meta';
import type { ProjectName } from '../lib/types';

// ─── 共通定数 ───────────────────────────────────────────────────────────────

const TICKS_REFRESH_MS = 30 * 1000;
const USAGE_REFRESH_MS = 5 * 60 * 1000;

// ─── Ticks 型定義 ────────────────────────────────────────────────────────────

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

// ─── Usage 型定義 ────────────────────────────────────────────────────────────

interface Breakdown {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;
  messages: number;
}

interface ProjectBreakdown extends Breakdown {
  project: string;
  projectLabel: string;
}

interface ModelBreakdown extends Breakdown {
  model: string;
}

interface UsageData {
  generatedAt: string;
  cached: boolean;
  fileCount: number;
  totals: Breakdown;
  byProject: ProjectBreakdown[];
  byModel: ModelBreakdown[];
  windows: {
    lastHour: Breakdown;
    today: Breakdown;
    all: Breakdown;
  };
}

type WindowKey = 'lastHour' | 'today' | 'all';

interface UsageDetailTarget {
  kindLabel: string;
  title: string;
  accent?: string;
  breakdown: Breakdown;
}

// ─── Ticks 表示メタ ──────────────────────────────────────────────────────────

const TICK_STATUS_META: Record<TickStatus, { label: string; color: string; bg: string }> = {
  running: { label: '実行中', color: 'var(--mc-active)', bg: 'var(--mc-active-bg)' },
  done:    { label: '完了',   color: 'var(--mc-done)',   bg: 'var(--mc-done-bg)'   },
  skipped: { label: 'スキップ', color: 'var(--mc-idle)', bg: 'var(--mc-idle-bg)'   },
};

const RESULT_META: Record<TickResultKind, { label: string; color: string; bg: string }> = {
  green:   { label: '成功',    color: 'var(--mc-done)',      bg: 'var(--mc-done-bg)'   },
  deploy:  { label: 'デプロイ', color: 'var(--mc-accent)',   bg: 'var(--mc-surface-3)' },
  red:     { label: '失敗',    color: 'var(--mc-stalled)',   bg: 'var(--mc-stalled-bg)' },
  idle:    { label: '前進なし', color: 'var(--mc-idle)',      bg: 'var(--mc-idle-bg)'   },
  unknown: { label: '不明',    color: 'var(--mc-text-muted)', bg: 'var(--mc-surface-3)' },
};

const WINDOW_TABS: { key: WindowKey; label: string }[] = [
  { key: 'lastHour', label: '直近1h' },
  { key: 'today',    label: '当日'   },
  { key: 'all',      label: '全期間' },
];

const PROJECT_ACCENTS: Record<string, string> = {
  logic:       'var(--mc-proj-logic)',
  'en-chakai': 'var(--mc-proj-en-chakai)',
  nishimaru:   'var(--mc-proj-nishimaru)',
  'ai-pmo':    'var(--mc-proj-ai-pmo)',
  cxo:         'var(--mc-proj-cxo)',
  private:     'var(--mc-proj-private)',
  other:       'var(--mc-proj-other)',
};

// ─── ユーティリティ関数 ──────────────────────────────────────────────────────

function scopeToProject(scope: string): ProjectName {
  const s = scope.toLowerCase();
  if (s.includes('logic') || s === 'rin') return 'logic';
  if (s.includes('en-chakai') || s.includes('chakai')) return 'en-chakai';
  if (s.includes('nishimaru')) return 'nishimaru';
  if (s.includes('cxo') || s.includes('apollo')) return 'cxo';
  return 'other';
}

function formatDuration(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}秒`;
  return `${m}分${s}秒`;
}

function compact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

function full(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

function breakdownStats(b: Breakdown): TileSection['stats'] {
  return [
    { key: 'total',         label: '合計',         value: compact(b.total),         sub: `${full(b.total)} tokens` },
    { key: 'output',        label: '出力',         value: compact(b.output),        color: 'var(--mc-accent)', sub: `${full(b.output)} tokens` },
    { key: 'input',         label: '入力',         value: compact(b.input),         sub: `${full(b.input)} tokens` },
    { key: 'cacheCreation', label: 'キャッシュ書込', value: compact(b.cacheCreation), sub: `${full(b.cacheCreation)} tokens` },
    { key: 'cacheRead',     label: 'キャッシュ読込', value: compact(b.cacheRead),     sub: `${full(b.cacheRead)} tokens` },
    { key: 'messages',      label: 'メッセージ',    value: compact(b.messages),      sub: `${full(b.messages)} 件` },
  ];
}

/** ティック詳細の TileDetail セクションを組み立てる。 */
function buildTickSections(tick: Tick): TileSection[] {
  const duration = formatDuration(tick.durationMs);
  const status = TICK_STATUS_META[tick.status];
  const result = tick.result ? RESULT_META[tick.result.kind] : null;

  const stats: TileSection['stats'] = [
    { key: 'scope',  label: 'スコープ', value: tick.scope },
    { key: 'status', label: '状態',     value: status.label, color: status.color },
  ];
  if (result) stats.push({ key: 'result', label: '結果', value: result.label, color: result.color });
  if (duration) stats.push({ key: 'duration', label: '所要', value: duration });
  stats.push({ key: 'startedAt', label: '開始', value: relativeTime(tick.startedAt), sub: absoluteTime(tick.startedAt) });
  if (tick.endedAt) stats.push({ key: 'endedAt', label: '終了', value: relativeTime(tick.endedAt), sub: absoluteTime(tick.endedAt) });

  const sections: TileSection[] = [{ heading: '概要', stats }];
  const task = tick.selectedTask;
  sections.push({
    heading: '選んだタスク',
    related:
      task && (task.id || task.title)
        ? [{ key: 'selected-task', tag: task.id ?? undefined, title: task.title ?? '（タイトルなし）' }]
        : [],
    emptyText: '選んだタスクの記録はありません。',
  });
  const resultText = tick.result?.text;
  const skipReason = tick.status === 'skipped' ? tick.skipReason : undefined;
  if (resultText || skipReason) {
    sections.push({ heading: tick.status === 'skipped' ? 'スキップ理由' : '結果の詳細', note: resultText || skipReason });
  }
  return sections;
}

// ─── Ticks サブコンポーネント ─────────────────────────────────────────────────

function TickStatusDot({ status }: { status: TickStatus }) {
  const m = TICK_STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-label={`状態: ${m.label}`}>
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${status === 'running' ? 'mc-pulse' : ''}`}
        style={{ background: m.color }}
        aria-hidden
      />
      <span className="text-[11px] font-medium" style={{ color: m.color }}>{m.label}</span>
    </span>
  );
}

function ResultBadge({ kind }: { kind: TickResultKind }) {
  const m = RESULT_META[kind];
  return (
    <span aria-label={`結果: ${m.label}`}>
      <Badge color={m.color} bg={m.bg}>{m.label}</Badge>
    </span>
  );
}

function TickCard({ tick, onOpen }: { tick: Tick; onOpen: () => void }) {
  const duration = formatDuration(tick.durationMs);
  const task = tick.selectedTask;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full cursor-pointer rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      aria-label={`ティックの詳細を開く: ${task?.id || task?.title || tick.startedAt}`}
    >
      <div className="flex items-center justify-between gap-2">
        <TickStatusDot status={tick.status} />
        <time className="shrink-0 text-[11px] tabular-nums text-text-faint" dateTime={tick.startedAt} title={absoluteTime(tick.startedAt)}>
          {relativeTime(tick.startedAt)}
        </time>
      </div>
      <div className="mt-2">
        {task && (task.id || task.title) ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {task.id && (
              <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-text">{task.id}</span>
            )}
            {task.title && (
              <span className="min-w-0 break-words text-[13px] text-text" title={task.title}>{task.title}</span>
            )}
          </div>
        ) : (
          <span className="text-[12px] text-text-faint">選んだタスクの記録はありません</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {tick.result && <ResultBadge kind={tick.result.kind} />}
        {duration && <span className="text-[11px] tabular-nums text-text-faint">所要 {duration}</span>}
      </div>
      {tick.result?.text && (
        <p className="mt-1.5 break-words text-[12px] leading-relaxed text-text-muted">{tick.result.text}</p>
      )}
      {tick.status === 'skipped' && tick.skipReason && (
        <p className="mt-1.5 break-words text-[12px] leading-relaxed text-text-muted">{tick.skipReason}</p>
      )}
    </button>
  );
}

function ScopeLane({ scope, ticks, onOpenTick }: { scope: string; ticks: Tick[]; onOpenTick: (t: Tick) => void }) {
  const accent = projectColor(scopeToProject(scope));
  return (
    <section className="flex min-w-0 flex-col gap-2 md:w-80 md:shrink-0">
      <div className="flex items-center gap-2 border-b border-border pb-1.5">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: accent }} aria-hidden />
        <h3 className="text-sm font-bold text-text">{scope}</h3>
        <span className="text-[11px] tabular-nums text-text-faint">{ticks.length} 件</span>
      </div>
      <div className="flex flex-col gap-2">
        {ticks.length === 0 ? (
          <EmptyState>このスコープのティックはありません</EmptyState>
        ) : (
          ticks.map((t) => (
            <TickCard key={`${t.source}-${t.startedAt}`} tick={t} onOpen={() => onOpenTick(t)} />
          ))
        )}
      </div>
    </section>
  );
}

// ─── Usage サブコンポーネント ─────────────────────────────────────────────────

function BigStat({ label, value, onOpen }: { label: string; value: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group cursor-pointer rounded-xl border border-border bg-surface px-5 py-4 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 hover:shadow-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      aria-label={`${label}の消費量内訳を開く`}
    >
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-text" title={`${full(value)} tokens`}>{compact(value)}</div>
      <div className="mt-0.5 text-[11px] text-text-faint">tokens</div>
    </button>
  );
}

function BreakdownRow({ name, accent, b, onOpen }: { name: string; accent?: string; b: Breakdown; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full cursor-pointer rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      aria-label={`${name}の消費量内訳を開く`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {accent && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: accent }} aria-hidden />}
          <span className="truncate text-[13px] font-medium text-text" title={name}>{name}</span>
        </div>
        <span className="shrink-0 text-base font-bold tabular-nums text-text" title={`合計 ${full(b.total)} tokens`}>{compact(b.total)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge color="var(--mc-accent)" bg="var(--mc-surface-3)" title={`出力 ${full(b.output)} tokens`}>出力 {compact(b.output)}</Badge>
        <Badge title={`入力 ${full(b.input)} tokens`}>入力 {compact(b.input)}</Badge>
        <Badge title={`キャッシュ書込 ${full(b.cacheCreation)} tokens`}>C作成 {compact(b.cacheCreation)}</Badge>
        <Badge title={`キャッシュ読込 ${full(b.cacheRead)} tokens`}>C読込 {compact(b.cacheRead)}</Badge>
        <Badge title={`${full(b.messages)} 件`}>{compact(b.messages)} msg</Badge>
      </div>
    </button>
  );
}

// ─── メインビュー ─────────────────────────────────────────────────────────────

export default function Activity() {
  // --- Ticks state ---
  const [ticksData, setTicksData] = useState<TicksData | null>(null);
  const [ticksError, setTicksError] = useState<string | null>(null);
  const [ticksLoading, setTicksLoading] = useState(true);
  const [ticksFetchedAt, setTicksFetchedAt] = useState<string | null>(null);
  const [selectedTick, setSelectedTick] = useState<Tick | null>(null);
  const ticksAbortRef = useRef<AbortController | null>(null);

  // --- Usage state ---
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageFetchedAt, setUsageFetchedAt] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>('today');
  const [usageDetail, setUsageDetail] = useState<UsageDetailTarget | null>(null);
  const usageAbortRef = useRef<AbortController | null>(null);

  // --- Ticks fetch ---
  const loadTicks = useCallback(async () => {
    ticksAbortRef.current?.abort();
    const ctrl = new AbortController();
    ticksAbortRef.current = ctrl;
    try {
      const res = await fetch('/api/ticks', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for /api/ticks`);
      const json = (await res.json()) as TicksData;
      if (ctrl.signal.aborted) return;
      setTicksData(json);
      setTicksError(null);
      setTicksFetchedAt(new Date().toISOString());
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setTicksError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setTicksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTicks();
    const id = window.setInterval(() => void loadTicks(), TICKS_REFRESH_MS);
    return () => { window.clearInterval(id); ticksAbortRef.current?.abort(); };
  }, [loadTicks]);

  // --- Usage fetch ---
  const loadUsage = useCallback(async () => {
    usageAbortRef.current?.abort();
    const ctrl = new AbortController();
    usageAbortRef.current = ctrl;
    try {
      const res = await fetch('/api/usage', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for /api/usage`);
      const json = (await res.json()) as UsageData;
      if (ctrl.signal.aborted) return;
      setUsageData(json);
      setUsageError(null);
      setUsageFetchedAt(new Date().toISOString());
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setUsageError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
    const id = window.setInterval(() => void loadUsage(), USAGE_REFRESH_MS);
    return () => { window.clearInterval(id); usageAbortRef.current?.abort(); };
  }, [loadUsage]);

  // --- Ticks レーン組立 ---
  const tickScopes = ticksData?.scopes ?? [];
  const byScope = new Map<string, Tick[]>();
  for (const s of tickScopes) byScope.set(s, []);
  for (const t of ticksData?.ticks ?? []) {
    if (!byScope.has(t.scope)) byScope.set(t.scope, []);
    byScope.get(t.scope)!.push(t);
  }
  const laneScopes = Array.from(byScope.keys());

  // --- Usage window ---
  const win = usageData?.windows[windowKey] ?? null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="活動"
        subtitle="自律ループのティックとトークン消費量"
        fetchedAt={ticksFetchedAt ?? usageFetchedAt}
        right={
          <span className="text-accent" aria-hidden>
            <ActivityIcon width={18} height={18} />
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* ── ティックセクション ─────────────────────────────── */}
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-muted">
            <LoopIcon width={14} height={14} />
            ティック
            {ticksData && (
              <span className="text-[11px] font-normal tabular-nums text-text-faint">
                直近 {ticksData.ticks.length} 件{ticksData.cached ? '（キャッシュ）' : ''}
              </span>
            )}
          </h2>
          <ResourceState loading={ticksLoading} error={ticksError} hasData={!!ticksData}>
            {ticksData &&
              (ticksData.ticks.length === 0 ? (
                <EmptyState>
                  自律ループのティックはまだ記録されていません。次の周回が記録されると表示されます。
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-4 md:overflow-x-auto">
                  {laneScopes.map((scope) => (
                    <ScopeLane
                      key={scope}
                      scope={scope}
                      ticks={byScope.get(scope) ?? []}
                      onOpenTick={setSelectedTick}
                    />
                  ))}
                </div>
              ))}
          </ResourceState>
        </section>

        {/* ── 消費量セクション ───────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-text-muted">消費量</h2>
          <ResourceState loading={usageLoading} error={usageError} hasData={!!usageData}>
            {usageData && (
              <div className="flex flex-col gap-5">
                {/* 大見出し: 当日 と 全期間 */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <BigStat
                    label="当日"
                    value={usageData.windows.today.total}
                    onOpen={() =>
                      setUsageDetail({ kindLabel: '消費量', title: '当日', breakdown: usageData.windows.today })
                    }
                  />
                  <BigStat
                    label="全期間"
                    value={usageData.totals.total}
                    onOpen={() =>
                      setUsageDetail({ kindLabel: '消費量', title: '全期間', breakdown: usageData.totals })
                    }
                  />
                </div>

                {/* 期間トグル */}
                <div
                  className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1"
                  role="group"
                  aria-label="期間で絞り込み"
                >
                  {WINDOW_TABS.map((tab) => {
                    const active = windowKey === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setWindowKey(tab.key)}
                        aria-pressed={active}
                        className={`shrink-0 rounded-md px-3 py-2 text-xs md:py-1 ${
                          active ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted hover:bg-surface-2'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* 選択期間のサマリ */}
                {win && (
                  <div className="rounded-xl border border-border bg-surface px-5 py-4">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <div className="text-xs text-text-muted">
                          {WINDOW_TABS.find((t) => t.key === windowKey)?.label}の合計
                        </div>
                        <div className="mt-0.5 text-2xl font-bold tabular-nums text-text" title={`${full(win.total)} tokens`}>
                          {compact(win.total)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge color="var(--mc-accent)" bg="var(--mc-surface-3)" title={`出力 ${full(win.output)} tokens`}>
                          出力 {compact(win.output)}
                        </Badge>
                        <Badge title={`入力 ${full(win.input)} tokens`}>入力 {compact(win.input)}</Badge>
                        <Badge title={`${full(win.messages)} 件`}>{compact(win.messages)} msg</Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-text-faint">出力トークンはコスト感の主因です。</p>
                  </div>
                )}

                {/* 内訳: プロジェクト別 / モデル別 */}
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <section>
                    <h3 className="mb-2 text-sm font-bold text-text">プロジェクト別</h3>
                    <div className="flex flex-col gap-2">
                      {usageData.byProject.length === 0 && (
                        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-text-faint">
                          データがありません
                        </p>
                      )}
                      {usageData.byProject.map((p) => {
                        const accent = PROJECT_ACCENTS[p.project] ?? 'var(--mc-proj-other)';
                        const name = p.projectLabel || p.project;
                        return (
                          <BreakdownRow
                            key={p.project}
                            name={name}
                            accent={accent}
                            b={p}
                            onOpen={() =>
                              setUsageDetail({ kindLabel: 'プロジェクト別消費量', title: name, accent, breakdown: p })
                            }
                          />
                        );
                      })}
                    </div>
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-bold text-text">モデル別</h3>
                    <div className="flex flex-col gap-2">
                      {usageData.byModel.length === 0 && (
                        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-text-faint">
                          データがありません
                        </p>
                      )}
                      {usageData.byModel.map((m) => (
                        <BreakdownRow
                          key={m.model}
                          name={m.model}
                          b={m}
                          onOpen={() =>
                            setUsageDetail({ kindLabel: 'モデル別消費量', title: m.model, breakdown: m })
                          }
                        />
                      ))}
                    </div>
                  </section>
                </div>

                {/* 集計時刻 */}
                <div className="text-[11px] text-text-faint">
                  集計時刻: {relativeTime(usageData.generatedAt)}
                  {usageData.cached ? '・キャッシュ済み' : '・最新集計'}
                  {usageFetchedAt && ` / 取得: ${relativeTime(usageFetchedAt)}`}
                </div>
              </div>
            )}
          </ResourceState>
        </section>
      </div>

      {/* ── ドロワー類 ──────────────────────────────────────── */}

      {/* ティックの詳細 */}
      <TileDetail
        open={!!selectedTick}
        onClose={() => setSelectedTick(null)}
        kindLabel="ティック"
        title={
          selectedTick
            ? selectedTick.selectedTask?.id ||
              selectedTick.selectedTask?.title ||
              `${selectedTick.scope} のティック`
            : ''
        }
        accent={selectedTick ? TICK_STATUS_META[selectedTick.status].color : undefined}
        sections={selectedTick ? buildTickSections(selectedTick) : []}
      />

      {/* 消費量の詳細 */}
      <TileDetail
        open={!!usageDetail}
        onClose={() => setUsageDetail(null)}
        kindLabel={usageDetail?.kindLabel ?? '消費量'}
        title={usageDetail?.title ?? ''}
        accent={usageDetail?.accent}
        sections={
          usageDetail
            ? ([
                {
                  heading: 'トークン内訳',
                  stats: breakdownStats(usageDetail.breakdown),
                  note: '出力トークンはコスト感の主因です。',
                } as TileSection,
              ] satisfies TileSection[])
            : []
        }
      />
    </div>
  );
}
