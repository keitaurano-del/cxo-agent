// 収益コックピット — ClipItNow の収益・トラフィックを 1 画面に統合表示する。
// データは GET /api/revenue/summary（サーバ側で上流集約・60 秒キャッシュ・部分データ許容）から取得。
//   - 広告収益: ExoClick + Adsterra の本日/7日実額（合算と内訳）＋日別スパークライン
//   - ClipItNow: PV / UU / DL / 検索流入（PDCA state 由来）
//   - PDCA: 現在のサイクル番号とフェーズ
// スパークラインはインライン SVG 自作（外部ライブラリなし）。
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { LoopIcon } from '../components/icons';

// ─── サーバ（revenueRouter.ts RevenueSummary）と一致する応答型 ───

interface AdNetworkStats {
  available: boolean;
  todayDate: string;
  todayRevenue: number;
  revenue7d: number;
  impressions7d: number;
  clicks7d: number;
  daily: Array<{ date: string; revenue: number }>;
}

interface RevenueSummary {
  generatedAt: string;
  revenue: {
    todayTotal: number;
    total7d: number;
    exoclick: AdNetworkStats;
    adsterra: AdNetworkStats;
    daily: Array<{ date: string; exoclick: number; adsterra: number; total: number }>;
  };
  clipitnow: {
    available: boolean;
    pageviews: { h24: number; d7: number };
    visitors: { uu24h: number; uu7d: number };
    downloads: { h24: number; d7: number };
    referrers24h: Array<{ name: string; count: number }>;
  };
  pdca: {
    available: boolean;
    cycle: number;
    phase: string;
    lastReportDate: string | null;
    searchReferrals7d: number;
  };
}

/** 収益額の表示（極小額のため小数 4 桁固定）。 */
function usd(v: number): string {
  return `$${v.toFixed(4)}`;
}

/** "YYYY-MM-DD" → "M/D"。 */
function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 指標カード 1 枚。 */
function StatCard({ label, main, sub, accent }: { label: string; main: string; sub?: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <span className="text-[11px] font-semibold text-text-muted">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${accent ? 'text-accent' : 'text-text'}`}>{main}</span>
      {sub && <span className="text-[11px] text-text-faint">{sub}</span>}
    </div>
  );
}

/**
 * 日別収益スパークライン（インライン SVG・依存追加なし）。
 * 面＋折れ線で合算収益を描き、各点の <title> で日付と内訳を表示する。
 */
function RevenueSparkline({ daily }: { daily: RevenueSummary['revenue']['daily'] }) {
  const W = 720;
  const H = 120;
  const PAD = 10;
  const n = daily.length;
  if (n === 0) {
    return <p className="py-4 text-center text-[12px] text-text-faint">日別データがありません。</p>;
  }
  const max = Math.max(0.0001, ...daily.map((d) => d.total));
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const line = daily.map((d, i) => `${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join(' ');
  const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label="日別広告収益の推移">
      <polygon points={area} fill="var(--mc-accent)" opacity={0.12} />
      <polyline points={line} fill="none" stroke="var(--mc-accent)" strokeWidth={2} />
      {daily.map((d, i) => (
        <circle key={d.date} cx={x(i)} cy={y(d.total)} r={3} fill="var(--mc-accent)">
          <title>{`${d.date}: 合計 ${usd(d.total)}（ExoClick ${usd(d.exoclick)} / Adsterra ${usd(d.adsterra)}）`}</title>
        </circle>
      ))}
      {daily.map((d, i) =>
        n <= 8 || i % Math.ceil(n / 6) === 0 || i === n - 1 ? (
          <text key={`l-${d.date}`} x={x(i)} y={H - 1} textAnchor="middle" fontSize={9} fill="var(--mc-text-faint)">
            {shortDate(d.date)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** 上流未取得セクションの注記。 */
function Unavailable({ label }: { label: string }) {
  return (
    <p className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-muted">
      {label}のデータを取得できませんでした。時間をおいて再読込してください。
    </p>
  );
}

export default function Revenue() {
  const [data, setData] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/revenue/summary', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as RevenueSummary);
      setFetchedAt(new Date().toISOString());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rev = data?.revenue;
  const clip = data?.clipitnow;
  const pdca = data?.pdca;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="収益"
        fetchedAt={fetchedAt}
        right={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
          >
            <LoopIcon width={13} height={13} />
            再読込
          </button>
        }
      />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-5">
        {loading && !data ? (
          <p className="py-8 text-center text-sm text-text-muted">読み込み中…</p>
        ) : error && !data ? (
          <p className="rounded-md border border-blocked/30 bg-blocked/5 px-3 py-2 text-[12px] text-blocked">
            収益データを取得できませんでした。再読込してください。
          </p>
        ) : data ? (
          <>
            {/* 広告収益（ExoClick + Adsterra） */}
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold text-text-muted">広告収益（ExoClick + Adsterra）</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label="本日の収益（合算）" main={usd(rev?.todayTotal ?? 0)} accent />
                <StatCard label="直近7日の収益（合算）" main={usd(rev?.total7d ?? 0)} accent />
                <StatCard
                  label="ExoClick"
                  main={rev?.exoclick.available ? usd(rev.exoclick.revenue7d) : '—'}
                  sub={
                    rev?.exoclick.available
                      ? `本日 ${usd(rev.exoclick.todayRevenue)} / imp ${rev.exoclick.impressions7d.toLocaleString()}`
                      : '未取得'
                  }
                />
                <StatCard
                  label="Adsterra"
                  main={rev?.adsterra.available ? usd(rev.adsterra.revenue7d) : '—'}
                  sub={
                    rev?.adsterra.available
                      ? `本日 ${usd(rev.adsterra.todayRevenue)} / imp ${rev.adsterra.impressions7d.toLocaleString()}`
                      : '未取得'
                  }
                />
              </div>
              <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                <span className="mb-1 block text-[11px] font-semibold text-text-muted">日別収益（合算）</span>
                <RevenueSparkline daily={rev?.daily ?? []} />
              </div>
            </section>

            {/* ClipItNow トラフィック */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold text-text-muted">ClipItNow（直近7日）</h2>
                <a
                  href="https://clipitnow.net/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-accent hover:underline"
                >
                  clipitnow.net ↗
                </a>
                {pdca?.available && (
                  <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                    PDCA サイクル {pdca.cycle}
                  </span>
                )}
              </div>
              {clip?.available ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatCard
                    label="訪問（PV）"
                    main={clip.pageviews.d7.toLocaleString()}
                    sub={`24h ${clip.pageviews.h24.toLocaleString()}`}
                  />
                  <StatCard
                    label="実ユーザー（UU）"
                    main={clip.visitors.uu7d.toLocaleString()}
                    sub={`24h ${clip.visitors.uu24h.toLocaleString()}`}
                  />
                  <StatCard
                    label="ダウンロード"
                    main={clip.downloads.d7.toLocaleString()}
                    sub={`24h ${clip.downloads.h24.toLocaleString()}`}
                  />
                  <StatCard
                    label="検索流入"
                    main={pdca?.available ? pdca.searchReferrals7d.toLocaleString() : '—'}
                    sub="直近7日（PDCA 計測）"
                  />
                </div>
              ) : (
                <Unavailable label="ClipItNow" />
              )}
            </section>

            <p className="text-[10px] leading-relaxed text-text-faint">
              収益は各広告ネットワークの API 実績値（USD）です。上流 API は約 5 分キャッシュ、本画面は 60
              秒キャッシュのため、反映に最大数分の遅延があります。一部ソースが取得できない場合も、取得できた分のみ表示します。
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
