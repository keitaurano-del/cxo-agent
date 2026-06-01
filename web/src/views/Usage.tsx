// Token 消費量ビュー — GET /api/usage（サーバ側 5 分キャッシュ）。
// マウント時 fetch + 5 分間隔で再取得。当日 / 全期間のトークン数を大見出し、
// 期間トグル（直近1h / 当日 / 全期間）、内訳を byProject / byModel カードで表示。
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, Badge } from '../components/ui';
import { TileDetail, type TileSection } from '../components/TileDetail';
import { relativeTime } from '../lib/time';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // サーバ側キャッシュと同じ 5 分

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

const WINDOW_TABS: { key: WindowKey; label: string }[] = [
  { key: 'lastHour', label: '直近1h' },
  { key: 'today', label: '当日' },
  { key: 'all', label: '全期間' },
];

/** トークン数を K / M / B でコンパクト整形。 */
function compact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

/** 正確な桁区切り（ツールチップ用）。 */
function full(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

function BigStat({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group cursor-pointer rounded-xl border border-border bg-surface px-5 py-4 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 hover:shadow-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      aria-label={`${label}の消費量内訳を開く`}
    >
      <div className="text-xs text-text-muted">{label}</div>
      <div
        className="mt-1 text-3xl font-bold tabular-nums text-text"
        title={`${full(value)} tokens`}
      >
        {compact(value)}
      </div>
      <div className="mt-0.5 text-[11px] text-text-faint">tokens</div>
    </button>
  );
}

/** 内訳カード 1 件。total と output を強調表示する。クリックで詳細内訳を開く。 */
function BreakdownRow({
  name,
  accent,
  b,
  onOpen,
}: {
  name: string;
  accent?: string;
  b: Breakdown;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full cursor-pointer rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      aria-label={`${name}の消費量内訳を開く`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {accent && (
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: accent }}
              aria-hidden
            />
          )}
          <span className="truncate text-[13px] font-medium text-text" title={name}>
            {name}
          </span>
        </div>
        <span
          className="shrink-0 text-base font-bold tabular-nums text-text"
          title={`合計 ${full(b.total)} tokens`}
        >
          {compact(b.total)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge
          color="var(--mc-accent)"
          bg="var(--mc-surface-3)"
          title={`出力 ${full(b.output)} tokens`}
        >
          出力 {compact(b.output)}
        </Badge>
        <Badge title={`入力 ${full(b.input)} tokens`}>入力 {compact(b.input)}</Badge>
        <Badge title={`キャッシュ書込 ${full(b.cacheCreation)} tokens`}>
          C作成 {compact(b.cacheCreation)}
        </Badge>
        <Badge title={`キャッシュ読込 ${full(b.cacheRead)} tokens`}>
          C読込 {compact(b.cacheRead)}
        </Badge>
        <Badge title={`${full(b.messages)} 件`}>{compact(b.messages)} msg</Badge>
      </div>
    </button>
  );
}

// 消費量タイルの内訳ドロワーで使う Breakdown の stat 行を組み立てる。
function breakdownStats(b: Breakdown) {
  return [
    { key: 'total', label: '合計', value: compact(b.total), sub: `${full(b.total)} tokens` },
    {
      key: 'output',
      label: '出力',
      value: compact(b.output),
      color: 'var(--mc-accent)',
      sub: `${full(b.output)} tokens`,
    },
    { key: 'input', label: '入力', value: compact(b.input), sub: `${full(b.input)} tokens` },
    {
      key: 'cacheCreation',
      label: 'キャッシュ書込',
      value: compact(b.cacheCreation),
      sub: `${full(b.cacheCreation)} tokens`,
    },
    {
      key: 'cacheRead',
      label: 'キャッシュ読込',
      value: compact(b.cacheRead),
      sub: `${full(b.cacheRead)} tokens`,
    },
    { key: 'messages', label: 'メッセージ', value: compact(b.messages), sub: `${full(b.messages)} 件` },
  ];
}

// 選択中の消費量タイル（ドロワー表示対象）。
interface UsageDetailTarget {
  kindLabel: string;
  title: string;
  accent?: string;
  breakdown: Breakdown;
}

// プロジェクト色トークン（meta.ts の PROJECT_COLORS と整合。未知は other）。
const PROJECT_ACCENTS: Record<string, string> = {
  logic: 'var(--mc-proj-logic)',
  'en-chakai': 'var(--mc-proj-en-chakai)',
  nishimaru: 'var(--mc-proj-nishimaru)',
  'ai-pmo': 'var(--mc-proj-ai-pmo)',
  cxo: 'var(--mc-proj-cxo)',
  private: 'var(--mc-proj-private)',
  other: 'var(--mc-proj-other)',
};

export default function Usage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>('today');
  // 消費量タイルのドリルダウン詳細（MC-67 全タイル展開）。null は閉じている状態。
  const [detail, setDetail] = useState<UsageDetailTarget | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/usage', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for /api/usage`);
      const json = (await res.json()) as UsageData;
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

  // マウント時 fetch + 5 分間隔で再取得（cleanup で interval 解除 + 進行中 abort）。
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  const win = data?.windows[windowKey] ?? null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="消費量"
        subtitle={
          data
            ? `対象ファイル ${full(data.fileCount)} 件${data.cached ? '（キャッシュ）' : ''}`
            : 'トークン消費量'
        }
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <div className="flex flex-col gap-5">
              {/* 大見出し: 当日 と 全期間 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <BigStat
                  label="当日"
                  value={data.windows.today.total}
                  onOpen={() =>
                    setDetail({
                      kindLabel: '消費量',
                      title: '当日',
                      breakdown: data.windows.today,
                    })
                  }
                />
                <BigStat
                  label="全期間"
                  value={data.totals.total}
                  onOpen={() =>
                    setDetail({
                      kindLabel: '消費量',
                      title: '全期間',
                      breakdown: data.totals,
                    })
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
                        active
                          ? 'bg-surface-3 font-semibold text-text'
                          : 'text-text-muted hover:bg-surface-2'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* 選択期間のサマリ + 内訳の注記 */}
              {win && (
                <div className="rounded-xl border border-border bg-surface px-5 py-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <div className="text-xs text-text-muted">
                        {WINDOW_TABS.find((t) => t.key === windowKey)?.label}の合計
                      </div>
                      <div
                        className="mt-0.5 text-2xl font-bold tabular-nums text-text"
                        title={`${full(win.total)} tokens`}
                      >
                        {compact(win.total)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        color="var(--mc-accent)"
                        bg="var(--mc-surface-3)"
                        title={`出力 ${full(win.output)} tokens`}
                      >
                        出力 {compact(win.output)}
                      </Badge>
                      <Badge title={`入力 ${full(win.input)} tokens`}>
                        入力 {compact(win.input)}
                      </Badge>
                      <Badge title={`${full(win.messages)} 件`}>
                        {compact(win.messages)} msg
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-text-faint">
                    出力トークンはコスト感の主因です。
                  </p>
                </div>
              )}

              {/* 内訳: プロジェクト別 / モデル別 */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <section>
                  <h2 className="mb-2 text-sm font-bold text-text">プロジェクト別</h2>
                  <div className="flex flex-col gap-2">
                    {data.byProject.length === 0 && (
                      <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-text-faint">
                        データがありません
                      </p>
                    )}
                    {data.byProject.map((p) => {
                      const accent = PROJECT_ACCENTS[p.project] ?? 'var(--mc-proj-other)';
                      const name = p.projectLabel || p.project;
                      return (
                        <BreakdownRow
                          key={p.project}
                          name={name}
                          accent={accent}
                          b={p}
                          onOpen={() =>
                            setDetail({
                              kindLabel: 'プロジェクト別消費量',
                              title: name,
                              accent,
                              breakdown: p,
                            })
                          }
                        />
                      );
                    })}
                  </div>
                </section>
                <section>
                  <h2 className="mb-2 text-sm font-bold text-text">モデル別</h2>
                  <div className="flex flex-col gap-2">
                    {data.byModel.length === 0 && (
                      <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-text-faint">
                        データがありません
                      </p>
                    )}
                    {data.byModel.map((m) => (
                      <BreakdownRow
                        key={m.model}
                        name={m.model}
                        b={m}
                        onOpen={() =>
                          setDetail({
                            kindLabel: 'モデル別消費量',
                            title: m.model,
                            breakdown: m,
                          })
                        }
                      />
                    ))}
                  </div>
                </section>
              </div>

              {/* generatedAt / cached の小さい注記 */}
              <div className="text-[11px] text-text-faint">
                集計時刻: {relativeTime(data.generatedAt)}
                {data.cached ? '・キャッシュ済み' : '・最新集計'}
              </div>
            </div>
          )}
        </ResourceState>
      </div>
      {/* 消費量タイルのドリルダウン詳細（MC-67 全タイル展開）。 */}
      <TileDetail
        open={!!detail}
        onClose={() => setDetail(null)}
        kindLabel={detail?.kindLabel ?? '消費量'}
        title={detail?.title ?? ''}
        accent={detail?.accent}
        sections={
          detail
            ? ([
                {
                  heading: 'トークン内訳',
                  stats: breakdownStats(detail.breakdown),
                  note: '出力トークンはコスト感の主因です。',
                } as TileSection,
              ] satisfies TileSection[])
            : []
        }
      />
    </div>
  );
}
