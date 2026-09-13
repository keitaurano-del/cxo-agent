// デイトレボット — daytrade-bot（米国株デイトレ自動売買）の状況をネイティブ表示する
// ダッシュボードタブ（2026-09-14 Keita 依頼）。
// データは GET /api/daytrade/summary|trades（server/daytradeRouter.ts 経由で
// 127.0.0.1:8930 の独立ダッシュボードへプロキシ・上流停止時は 502）から取得。
//   - ステータスカード: 運用モード / 当日PnL / キルスイッチ / 基準資金
//   - バックテスト成績 + エクイティカーブ（インライン SVG・外部ライブラリなし）
//   - 銘柄別成績テーブル / トレード履歴（新しい順）
// 60 秒ポーリングで自動更新。上流停止時は「ダッシュボード停止中」を表示する。
// 詳細は独立ダッシュボード（http://167.179.64.231:8930/）への外部リンクも用意。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDashActions } from '../components/DashboardLayout';
import { LoopIcon } from '../components/icons';

/** ポーリング間隔（60 秒）。 */
const POLL_MS = 60_000;
/** 独立ダッシュボード（読み取り専用）の外部 URL。 */
const EXTERNAL_URL = 'http://167.179.64.231:8930/';
/** トレード履歴の表示上限（新しい順）。 */
const TRADES_LIMIT = 20;

// ─── サーバ応答型（daytrade-bot dashboard.py build_summary と一致）───

interface DaytradeSummary {
  generated_at: string;
  mode: { mode: 'disconnected' | 'paper' | 'live' | string; label: string };
  state: {
    available: boolean;
    day?: string;
    baseline?: number | null;
    halted?: boolean;
    entries_halted?: boolean;
    traded?: string[];
    positions?: Array<{ symbol: string; side: string; risk: number; unresolved: boolean }>;
    today_pnl?: number | null;
    today_equity?: number | null;
  };
  backtest: {
    trades: number;
    total_pnl?: number;
    win_rate_pct?: number;
    profit_factor?: number | null;
    max_drawdown_pct?: number;
    final_equity?: number;
  };
  by_symbol: Array<{ symbol: string; trades: number; total_pnl: number; win_rate_pct: number }>;
  equity_curve: Array<{ t: string; equity: number }>;
  daily_performance: Array<{ date: string; equity: string; pnl: string; note?: string }>;
}

/** トレード 1 件（上流 CSV 由来のため数値もすべて文字列で届く）。 */
interface DaytradeTrade {
  symbol: string;
  side: string;
  entry_time: string;
  exit_time: string;
  entry_price: string;
  exit_price: string;
  qty: string;
  exit_reason: string;
  pnl: string;
  r_multiple: string;
  equity_after: string;
}

// ─── 表示ヘルパー ────────────────────────────────────────────

function usd(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(digits)}`;
}

/** 符号付き PnL 表示（+$12.34 / -$5.00）。 */
function pnl(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${usd(v)}`;
}

/** PnL の色クラス（プラス=緑 / マイナス=赤 / ゼロ・不明=既定）。 */
function pnlClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return 'text-text';
  return v > 0 ? 'text-done' : 'text-blocked';
}

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "2026-06-17 10:50:00-04:00" → "6/17 10:50"（米国東部時刻のまま表示）。 */
function shortTime(t: string): string {
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return t;
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
}

/** 指標カード 1 枚（Revenue の StatCard と同流儀）。 */
function StatCard({
  label,
  main,
  sub,
  mainClass,
}: {
  label: string;
  main: string;
  sub?: string;
  mainClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <span className="text-[11px] font-semibold text-text-muted">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${mainClass ?? 'text-text'}`}>{main}</span>
      {sub && <span className="text-[11px] text-text-faint">{sub}</span>}
    </div>
  );
}

/** キルスイッチ状態の表示（独立ダッシュボードの判定と同一ロジック）。 */
function killSwitch(state: DaytradeSummary['state']): { text: string; cls: string } {
  if (!state.available) return { text: '—', cls: 'text-text' };
  if (state.halted) return { text: '発動（停止中）', cls: 'text-blocked' };
  if (state.entries_halted) return { text: 'エントリー停止', cls: 'text-review' };
  return { text: '正常', cls: 'text-done' };
}

/** 運用モードの色（live=注意 / paper=正常 / disconnected=ミュート）。 */
function modeClass(mode: string): string {
  if (mode === 'live') return 'text-review';
  if (mode === 'paper') return 'text-done';
  return 'text-text-muted';
}

/**
 * エクイティカーブ（インライン SVG・依存追加なし）。
 * バックテスト各トレード後の資金推移を面＋折れ線で描く。
 */
function EquityCurve({ curve }: { curve: DaytradeSummary['equity_curve'] }) {
  const W = 720;
  const H = 120;
  const PAD = 10;
  const points = curve.filter((p) => Number.isFinite(p.equity));
  const n = points.length;
  if (n === 0) {
    return <p className="py-4 text-center text-[12px] text-text-faint">エクイティデータがありません。</p>;
  }
  const values = points.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1));
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label="エクイティカーブ">
      <polygon points={area} fill="var(--mc-accent)" opacity={0.12} />
      <polyline points={line} fill="none" stroke="var(--mc-accent)" strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={`${p.t}-${i}`} cx={x(i)} cy={y(p.equity)} r={2.5} fill="var(--mc-accent)">
          <title>{`${shortTime(p.t)}: ${usd(p.equity)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function Daytrade() {
  const [summary, setSummary] = useState<DaytradeSummary | null>(null);
  const [trades, setTrades] = useState<DaytradeTrade[]>([]);
  const [loading, setLoading] = useState(true);
  // 上流（:8930）停止中フラグ。データ取得済みでも停止に転じたらバナー表示する。
  const [down, setDown] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, tRes] = await Promise.all([
        fetch('/api/daytrade/summary', { headers: { Accept: 'application/json' } }),
        fetch('/api/daytrade/trades', { headers: { Accept: 'application/json' } }),
      ]);
      if (!sRes.ok) throw new Error(`HTTP ${sRes.status}`);
      setSummary((await sRes.json()) as DaytradeSummary);
      if (tRes.ok) {
        const list = (await tRes.json()) as unknown;
        setTrades(Array.isArray(list) ? (list as DaytradeTrade[]) : []);
      }
      setDown(false);
    } catch {
      setDown(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初回ロード＋60 秒ポーリング。
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // 再読込ボタンはダッシュタブ行の右端へ差し込む（Revenue と同流儀）。
  useDashActions(
    useMemo(
      () => (
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
        >
          <LoopIcon width={13} height={13} />
          再読込
        </button>
      ),
      [loading, load],
    ),
  );

  const state = summary?.state;
  const bt = summary?.backtest;
  const kill = summary ? killSwitch(summary.state) : null;
  const recentTrades = useMemo(() => trades.slice(-TRADES_LIMIT).reverse(), [trades]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-5">
        {/* 見出し行: 外部リンク + 取得時刻 */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-semibold text-text-muted">デイトレボット（米国株自動売買）</h2>
          <a
            href={EXTERNAL_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-accent hover:underline"
          >
            独立ダッシュボード ↗
          </a>
          {summary && (
            <span className="ml-auto text-[10px] text-text-faint">
              取得 {shortTime(summary.generated_at)}
            </span>
          )}
        </div>

        {down && (
          <p className="rounded-md border border-blocked/30 bg-blocked/5 px-3 py-2 text-[12px] text-blocked">
            デイトレダッシュボード（:8930）が停止中のため、データを取得できません。
            {summary ? '以下は最後に取得できた内容です。' : ''}
          </p>
        )}

        {loading && !summary && !down ? (
          <p className="py-8 text-center text-sm text-text-muted">読み込み中…</p>
        ) : summary ? (
          <>
            {/* ステータスカード */}
            <section className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard
                  label="運用モード"
                  main={summary.mode.label}
                  mainClass={`text-base ${modeClass(summary.mode.mode)}`}
                  sub={state?.available ? `取引日 ${state.day ?? '—'}` : 'ボット未稼働'}
                />
                <StatCard
                  label="当日PnL"
                  main={pnl(state?.today_pnl)}
                  mainClass={pnlClass(state?.today_pnl)}
                  sub={state?.today_equity != null ? `資金 ${usd(state.today_equity)}` : 'データなし'}
                />
                {kill && <StatCard label="キルスイッチ" main={kill.text} mainClass={`text-base ${kill.cls}`} />}
                <StatCard
                  label="基準資金"
                  main={usd(state?.baseline ?? null)}
                  sub={state?.available ? undefined : '稼働開始後に表示されます'}
                />
              </div>
              {state?.positions && state.positions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-semibold text-text-muted">ポジション:</span>
                  {state.positions.map((p) => (
                    <span
                      key={p.symbol}
                      className="rounded-full border border-border bg-surface-2/60 px-2 py-0.5 font-semibold text-text-muted"
                    >
                      {p.symbol} {p.side} / リスク {usd(p.risk)}
                      {p.unresolved ? '（未解決）' : ''}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* バックテスト成績 */}
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold text-text-muted">バックテスト成績</h2>
              {bt && bt.trades > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <StatCard label="トレード数" main={String(bt.trades)} />
                    <StatCard label="累計PnL" main={pnl(bt.total_pnl)} mainClass={pnlClass(bt.total_pnl)} />
                    <StatCard label="勝率" main={bt.win_rate_pct != null ? `${bt.win_rate_pct}%` : '—'} />
                    <StatCard
                      label="プロフィットファクター"
                      main={bt.profit_factor != null ? String(bt.profit_factor) : '—'}
                    />
                    <StatCard
                      label="最大ドローダウン"
                      main={bt.max_drawdown_pct != null ? `${bt.max_drawdown_pct}%` : '—'}
                      mainClass={pnlClass(bt.max_drawdown_pct)}
                    />
                    <StatCard label="最終資金" main={usd(bt.final_equity)} />
                  </div>
                  <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                    <span className="mb-1 block text-[11px] font-semibold text-text-muted">エクイティカーブ</span>
                    <EquityCurve curve={summary.equity_curve} />
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-text-faint">バックテスト結果がまだありません。</p>
              )}
            </section>

            {/* 銘柄別成績 */}
            {summary.by_symbol.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-xs font-semibold text-text-muted">銘柄別成績</h2>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[420px] text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] text-text-muted">
                        <th className="px-3 py-2 font-semibold">銘柄</th>
                        <th className="px-3 py-2 text-right font-semibold">トレード数</th>
                        <th className="px-3 py-2 text-right font-semibold">累計PnL</th>
                        <th className="px-3 py-2 text-right font-semibold">勝率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.by_symbol.map((s) => (
                        <tr key={s.symbol} className="border-b border-border/60 last:border-b-0">
                          <td className="px-3 py-1.5 font-semibold text-text">{s.symbol}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{s.trades}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums ${pnlClass(s.total_pnl)}`}>
                            {pnl(s.total_pnl)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{s.win_rate_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* トレード履歴（新しい順） */}
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold text-text-muted">
                トレード履歴{trades.length > TRADES_LIMIT ? `（直近 ${TRADES_LIMIT} 件 / 全 ${trades.length} 件）` : ''}
              </h2>
              {recentTrades.length === 0 ? (
                <p className="text-[12px] text-text-faint">トレード履歴がまだありません。</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[640px] text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] text-text-muted">
                        <th className="px-3 py-2 font-semibold">銘柄</th>
                        <th className="px-3 py-2 font-semibold">売買</th>
                        <th className="px-3 py-2 font-semibold">エントリー</th>
                        <th className="px-3 py-2 font-semibold">クローズ</th>
                        <th className="px-3 py-2 text-right font-semibold">数量</th>
                        <th className="px-3 py-2 font-semibold">理由</th>
                        <th className="px-3 py-2 text-right font-semibold">PnL</th>
                        <th className="px-3 py-2 text-right font-semibold">R</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTrades.map((t, i) => {
                        const p = num(t.pnl);
                        return (
                          <tr key={`${t.symbol}-${t.exit_time}-${i}`} className="border-b border-border/60 last:border-b-0">
                            <td className="px-3 py-1.5 font-semibold text-text">{t.symbol}</td>
                            <td className="px-3 py-1.5 text-text-muted">{t.side === 'long' ? '買い' : '売り'}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-text-muted">
                              {shortTime(t.entry_time)} <span className="text-text-faint">@{num(t.entry_price)?.toFixed(2) ?? t.entry_price}</span>
                            </td>
                            <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-text-muted">
                              {shortTime(t.exit_time)} <span className="text-text-faint">@{num(t.exit_price)?.toFixed(2) ?? t.exit_price}</span>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{t.qty}</td>
                            <td className="px-3 py-1.5 text-text-muted">{t.exit_reason}</td>
                            <td className={`px-3 py-1.5 text-right tabular-nums ${pnlClass(p)}`}>{pnl(p)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{t.r_multiple}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : !down ? (
          <p className="py-8 text-center text-sm text-text-muted">データがありません。</p>
        ) : null}
      </div>
    </div>
  );
}
