// ClipItNow PDCA — ダッシュボードのタブ。ClipItNow(https://clipitnow.net) の PDCA を可視化する。
// Check（現状の数値）は公開API（/api/stats・/api/exostats・CORS 許可済）からライブ取得。
// Plan/Do/Act は「現サイクルの内容」をここで管理する（PDCA を回すたびに更新する）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoopIcon } from '../components/icons';
import { useLiveResource } from '../lib/useLiveData';

const STATS_URL = 'https://clipitnow.net/api/stats';
const EXOSTATS_URL = 'https://clipitnow.net/api/exostats';

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

interface Triple {
  '24h': number;
  '7d': number;
  all: number;
}
interface NameCount {
  name: string;
  count: number;
}
interface Stats {
  pageviews: Triple;
  downloads: Triple;
  uu_7d: number;
  uu_24h: number;
  events_24h: NameCount[];
}
interface Exo {
  available: boolean;
  revenue_7d: number;
  impressions_7d: number;
  clicks_7d: number;
  video_views_7d: number;
  today_revenue: number;
}

function normTriple(v: unknown): Triple {
  const o = (v ?? {}) as Record<string, unknown>;
  return { '24h': numOr0(o['24h']), '7d': numOr0(o['7d']), all: numOr0(o.all) };
}
function normStats(raw: unknown): Stats {
  const o = (raw ?? {}) as Record<string, unknown>;
  const vis = (o.visitors ?? {}) as Record<string, unknown>;
  const ev = Array.isArray(o.events_24h) ? o.events_24h : [];
  return {
    pageviews: normTriple(o.pageviews),
    downloads: normTriple(o.downloads),
    uu_7d: numOr0(vis.uu_7d),
    uu_24h: numOr0(vis.uu_24h),
    events_24h: ev
      .map((x) => {
        const r = (x ?? {}) as Record<string, unknown>;
        return { name: typeof r.name === 'string' ? r.name : '', count: numOr0(r.count) };
      })
      .filter((x) => x.name),
  };
}
function normExo(raw: unknown): Exo {
  const o = (raw ?? {}) as Record<string, unknown>;
  const t = (o.today ?? {}) as Record<string, unknown>;
  return {
    available: !!o.available,
    revenue_7d: numOr0(o.revenue_7d),
    impressions_7d: numOr0(o.impressions_7d),
    clicks_7d: numOr0(o.clicks_7d),
    video_views_7d: numOr0(o.video_views_7d),
    today_revenue: numOr0(t.revenue),
  };
}

// ── 現サイクルの Plan / Do / Act（Check の数値は下でライブ表示。ここは方針・仮説・行動）──
const PLAN: string[] = [
  '目標：実ユーザーの流入とダウンロードを増やし、動画広告で収益を最大化する。',
  'KPI：実ユーザー(UU)/週・ダウンロード/週・ExoClick収益/週。',
  '仮説：律速はオーガニック（検索）流入。現状は PV の大半がボット/直接流入で実 UU がほぼ 0。',
];
const DO: string[] = [
  '収益：動画広告5面（トップ/結果/PC浮遊/変換待ち/保存後クローズ）を、安定フィルの VAST 動画で配置（バナーは低フィルのため動画化）。ExoClick 収益を API 連携。',
  '集客：多言語SEO（11言語）・DL別LP・sitemap/IndexNow 送信。',
  'UX：アドブロック解除依頼の常時化・保存後の白箱バグ修正。自己アクセスは計測除外。',
];
const CHECK_READ: string[] = [
  '実 UU・DL が低く、実エンゲージメントが不足。PV は大半がボット/直接流入（下の数値参照）。',
  '収益は動画フィルが安定して発生するが、新規 Adult サイトのため規模は小さい。',
  'ボトルネック＝検索（オーガニック）流入がまだ立ち上がっていない。',
];
const ACT: string[] = [
  'Google Search Console 登録・URL 検査でインデックス申請（手順は Son 用意・実行に Keita 承認/操作）。',
  '初速露出：X/Reddit 等への投稿で被リンク・流入を作る（文面は Son ドラフト→要 Keita 承認）。',
  'exostats で動画 CPM/フィルを監視し、広告面数・配置を最適化。',
  '需要スパイク期（スポーツ等）に合わせた SEO 記事を仕込む。',
];

function KpiCard({
  label,
  main,
  sub,
  warn,
}: {
  label: string;
  main: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <span className="text-[11px] font-semibold text-text-muted">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${warn ? 'text-blocked' : 'text-text'}`}>{main}</span>
      {sub && <span className="text-[11px] text-text-faint">{sub}</span>}
    </div>
  );
}

function PdcaCard({
  badge,
  title,
  hint,
  items,
  color,
}: {
  badge: string;
  title: string;
  hint: string;
  items: string[];
  color: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
          style={{ background: color }}
        >
          {badge}
        </span>
        <span className="text-sm font-bold text-text">{title}</span>
        <span className="ml-auto text-[10px] text-text-faint">{hint}</span>
      </div>
      <ul className="flex flex-col gap-1.5 px-3 py-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-text-muted">
            <span className="mt-[3px] shrink-0" style={{ color }} aria-hidden>
              ●
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const EVENT_LABELS: { key: string; label: string }[] = [
  { key: 'analyze', label: '解析' },
  { key: 'quality', label: '画質選択' },
  { key: 'download_start', label: 'DL開始' },
  { key: 'download_complete', label: 'DL完了' },
  { key: 'save_download', label: '保存' },
];

// ── PDCAエージェント「PD-CA」の稼働状態 ─────────────────────────────
// state は GET /api/clipitnow/pdca（林の cron が毎回書く $HOME/logs/clipitnow-pdca-state.json）から取得する。
type AgentState = 'idle' | 'working' | 'alert';
interface AgentStatus {
  state: AgentState;
  say: string; // 吹き出しの一言
  phase: string; // 今どのフェーズ（実行中/承認待ち/待機中）
  lastRun: string; // 前回レポート
  nextRun: string; // 次回予定
  pending: string[]; // Keitaへの要対応
  live: boolean; // 実データ接続済みか（false=state ファイル未生成）
}
// 吹き出しの定型文言（2026-07-19 永続ループ化に合わせて更新）。
const AGENT_SAY = '自走モードで回してます。毎晩20時にレポート、安全な施策は自動実行。大レバーだけ承認タブでお知らせします 🔧';

// cron が書く状態ファイルのスキーマ（read-only で受ける）。
interface PdcaState {
  cycle?: number;
  phase?: string; // 'running' | 'awaiting_approval' | 'unknown'
  lastReportDate?: string | null;
  pendingApprovalId?: string;
}
// phase を日本語表示に変換。
function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'running':
      return '実行中';
    case 'awaiting_approval':
      return '承認待ち';
    default:
      return '待機中';
  }
}
// phase → ロボットの見た目状態。
function phaseToState(phase: string | undefined): AgentState {
  if (phase === 'running') return 'working';
  if (phase === 'awaiting_approval') return 'alert';
  return 'idle';
}
// state ファイル未生成/取得前の既定表示。
const AGENT_DEFAULT: AgentStatus = {
  state: 'idle',
  say: AGENT_SAY,
  phase: '待機中',
  lastRun: '—',
  nextRun: '毎晩 20:00',
  pending: [],
  live: false,
};
const AGENT_IMG: Record<AgentState, string> = {
  idle: '/avatars/avatar-pdca-idle-v4.png',
  working: '/avatars/avatar-pdca-working-v4.png',
  alert: '/avatars/avatar-pdca-alert-v4.png',
};
const STATE_LABEL: Record<AgentState, { text: string; color: string; bg: string }> = {
  idle: { text: '待機中', color: '#0e7490', bg: 'rgba(20,184,166,0.14)' },
  working: { text: '実行中', color: '#c2410c', bg: 'rgba(249,115,22,0.16)' },
  alert: { text: '要対応', color: '#b91c1c', bg: 'rgba(239,68,68,0.14)' },
};

// アニメーション（浮遊・輪の発光・吹き出し）を一度だけ注入
const AGENT_CSS = `
@keyframes pdcaFloat { 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-8px) } }
@keyframes pdcaGlow { 0%,100%{ opacity:.35; transform:scale(.96) } 50%{ opacity:.7; transform:scale(1.06) } }
@keyframes pdcaSpin { from{ transform:rotate(0) } to{ transform:rotate(360deg) } }
@keyframes pdcaPop { 0%{ transform:scale(.8); opacity:0 } 60%{ transform:scale(1.05) } 100%{ transform:scale(1); opacity:1 } }
.pdca-float{ animation:pdcaFloat 3.2s ease-in-out infinite }
.pdca-halo{ animation:pdcaGlow 2.4s ease-in-out infinite }
.pdca-halo-fast{ animation:pdcaGlow 1.2s ease-in-out infinite, pdcaSpin 6s linear infinite }
.pdca-bubble{ animation:pdcaPop .4s ease-out both }
`;

function PdcaAgentHero({ status }: { status: AgentStatus }) {
  const s = STATE_LABEL[status.state];
  const working = status.state === 'working';
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border p-4 md:p-5"
      style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.10), rgba(59,125,216,0.08) 60%, rgba(124,58,237,0.06))' }}
    >
      <style>{AGENT_CSS}</style>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* ロボット */}
        <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
          <div
            className={`absolute h-28 w-28 rounded-full ${working ? 'pdca-halo-fast' : 'pdca-halo'}`}
            style={{ background: `radial-gradient(circle, ${s.color}55, transparent 70%)` }}
            aria-hidden
          />
          <img
            src={AGENT_IMG[status.state]}
            alt={`PD-CA (${s.text})`}
            className="pdca-float relative h-36 w-36 object-contain drop-shadow-lg"
            draggable={false}
          />
        </div>

        {/* 吹き出し＋状態 */}
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-extrabold tracking-tight text-text">PD-CA</span>
            <span className="text-[11px] text-text-muted">ClipItNow PDCA 担当ロボ</span>
            <span
              className="ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ color: s.color, background: s.bg }}
            >
              {s.text}
            </span>
          </div>

          {/* 吹き出し */}
          <div key={status.say} className="pdca-bubble relative w-fit max-w-full rounded-2xl rounded-tl-sm border border-border bg-surface px-3 py-2 text-[13px] text-text shadow-sm">
            {status.say}
          </div>

          {/* ステータス行 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="フェーズ" value={status.phase} />
            <MiniStat label="前回実行" value={status.lastRun} />
            <MiniStat label="次回予定" value={status.nextRun} />
            <MiniStat label="要対応" value={`${status.pending.length} 件`} warn={status.pending.length > 0} />
          </div>

          {/* 要対応リスト */}
          {status.pending.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-blocked/30 bg-blocked/5 p-2">
              {status.pending.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5 text-[12px] text-text">
                  <span className="text-blocked" aria-hidden>▲</span>
                  <span>{p}</span>
                  <a
                    href="/approvals"
                    className="ml-auto rounded-md border border-blocked/40 px-2 py-0.5 text-[11px] font-semibold text-blocked hover:bg-blocked/10"
                  >
                    承認タブを開く
                  </a>
                </li>
              ))}
            </ul>
          )}

          {!status.live && (
            <p className="text-[10px] text-text-faint">
              ※ まだ PDCA ループの状態ファイルが生成されていません。初回サイクル開始後、ここが実データに切り替わります。
            </p>
          )}
        </div>
      </div>

      {/* 状態の見え方（3体） */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 border-t border-border/60 pt-3 sm:justify-start">
        <span className="text-[10px] font-semibold text-text-faint">状態の見え方 →</span>
        {(['idle', 'working', 'alert'] as AgentState[]).map((st) => (
          <div key={st} className="flex items-center gap-1.5">
            <img src={AGENT_IMG[st]} alt={STATE_LABEL[st].text} className="h-9 w-9 object-contain" draggable={false} />
            <span className="text-[10px] text-text-muted">{STATE_LABEL[st].text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface/70 px-2.5 py-1.5">
      <span className="text-[10px] text-text-faint">{label}</span>
      <span className={`text-[12px] font-semibold ${warn ? 'text-blocked' : 'text-text'}`}>{value}</span>
    </div>
  );
}

export default function Pdca() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [exo, setExo] = useState<Exo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // PDCA ループの稼働状態（林の cron が書く state ファイル）を Apollo API から取得。
  const { data: pdca } = useLiveResource<PdcaState>('/api/clipitnow/pdca');

  const agentStatus: AgentStatus = useMemo(() => {
    // ファイル未生成（cycle=0/phase=unknown）や未取得時は既定表示。
    if (!pdca || !pdca.phase || pdca.phase === 'unknown' || (pdca.cycle ?? 0) === 0) {
      return AGENT_DEFAULT;
    }
    const awaiting = pdca.phase === 'awaiting_approval' && !!pdca.pendingApprovalId;
    return {
      state: phaseToState(pdca.phase),
      say: AGENT_SAY,
      phase: phaseLabel(pdca.phase),
      lastRun: pdca.lastReportDate ? pdca.lastReportDate : '—',
      nextRun: '毎晩 20:00',
      pending: awaiting ? ['承認待ちのレポートがあります → 承認タブで確認'] : [],
      live: true,
    };
  }, [pdca]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [s, e] = await Promise.allSettled([
        fetch(STATS_URL, { headers: { Accept: 'application/json' } }),
        fetch(EXOSTATS_URL, { headers: { Accept: 'application/json' } }),
      ]);
      if (s.status === 'fulfilled' && s.value.ok) setStats(normStats((await s.value.json()) as unknown));
      else throw new Error('stats failed');
      if (e.status === 'fulfilled' && e.value.ok) setExo(normExo((await e.value.json()) as unknown));
      else setExo(null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const funnel = useMemo(() => {
    const map = new Map((stats?.events_24h ?? []).map((e) => [e.name, e.count]));
    return EVENT_LABELS.map((e) => ({ label: e.label, count: map.get(e.key) ?? 0 }));
  }, [stats]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 md:p-5">
      {/* ヘッダ */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LoopIcon width={18} height={18} />
          <h1 className="text-base font-bold text-text">ClipItNow PDCA</h1>
          <a
            href="https://clipitnow.net/"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-accent hover:underline"
          >
            clipitnow.net ↗
          </a>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
        >
          <LoopIcon width={13} height={13} />
          再読込
        </button>
      </div>

      {/* PD-CA ロボットの稼働パネル */}
      <PdcaAgentHero status={agentStatus} />

      {/* Check：現状の数値（ライブ） */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-text-muted">現状の数値（Check・ライブ／直近7日）</h2>
        {loading && !stats ? (
          <p className="py-4 text-center text-sm text-text-muted">読み込み中…</p>
        ) : error && !stats ? (
          <p className="rounded-md border border-blocked/30 bg-blocked/5 px-3 py-2 text-[12px] text-blocked">
            指標を取得できませんでした。再読込してください。
          </p>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiCard label="訪問(PV)" main={stats.pageviews['7d'].toLocaleString()} sub={`24h ${stats.pageviews['24h'].toLocaleString()}`} />
              <KpiCard label="実ユーザー(UU)" main={stats.uu_7d.toLocaleString()} sub={`24h ${stats.uu_24h.toLocaleString()}`} warn={stats.uu_7d < 20} />
              <KpiCard label="ダウンロード" main={stats.downloads['7d'].toLocaleString()} sub={`24h ${stats.downloads['24h'].toLocaleString()}`} warn={stats.downloads['7d'] < 10} />
              <KpiCard
                label="ExoClick収益"
                main={exo?.available ? `$${exo.revenue_7d.toFixed(4)}` : '—'}
                sub={exo?.available ? `本日 $${exo.today_revenue.toFixed(4)} / 動画視聴 ${exo.video_views_7d.toLocaleString()}` : '未取得'}
              />
            </div>
            {/* ファネル（24h） */}
            <div className="rounded-lg border border-border bg-surface-2/40 p-3">
              <span className="mb-2 block text-[11px] font-semibold text-text-muted">ファネル（直近24h）</span>
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
                {funnel.map((f, i) => (
                  <span key={f.label} className="flex items-center gap-1">
                    <span className="rounded-md bg-surface px-2 py-1 text-[11px] text-text">
                      {f.label} <span className="font-bold tabular-nums text-accent">{f.count}</span>
                    </span>
                    {i < funnel.length - 1 && <span className="text-text-faint">›</span>}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </section>

      {/* PDCA サイクル */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PdcaCard badge="P" title="Plan（計画・仮説）" hint="目標/KPI" color="#3b7dd8" items={PLAN} />
        <PdcaCard badge="D" title="Do（実行したこと）" hint="施策" color="#16a34a" items={DO} />
        <PdcaCard badge="C" title="Check（評価・数値の読み）" hint="上の数値を解釈" color="#d97706" items={CHECK_READ} />
        <PdcaCard badge="A" title="Act（次の改善アクション）" hint="次サイクルへ" color="#7c3aed" items={ACT} />
      </section>

      <p className="text-[10px] leading-relaxed text-text-faint">
        Check の数値は clipitnow.net の公開API（第一者計測・自己アクセス除外）からライブ取得。Plan/Do/Act は現サイクルの内容で、PDCA を回すたびに更新します。
      </p>
    </div>
  );
}
