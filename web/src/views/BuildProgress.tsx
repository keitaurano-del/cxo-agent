// BuildProgress — Apollo サイドメニュー先頭「実装進捗」タブ。
//
// 2026-07-18 Keita 指示で全面改修（v2）:
//   「実装進捗はリアルタイムで“何をしているか”が知りたい。元の（Fable 5 の）画面イメージが良い」。
//   旧 v1 はタスクボードの焼き直しでダッシュボードと重複していたため撤去。
//   本 v2 は、バックエンドに委託・移乗した実装エージェントの“いま動いている生の作業”を、
//   Fable 5 進捗ページと同じ体裁（フェーズ見出し＋作業フィード＋操作カウント）でライブ表示する。
//
// データ源（すべて実データ・SSE 自動更新）:
//   - GET /api/agents?status=active         … 稼働中エージェント（＝移乗先）。先頭に featured を選ぶ。
//   - GET /api/agents                        … 全ステータス（稼働中/待機/完了/未稼働）。7日窓内の履歴閲覧用。
//   - GET /api/agents/:agentId/feed         … その1体の作業フィード（発言・ツール操作の時系列）。
//   useLiveTick('agents') で agents 更新を購読 → 変化時に自動再フェッチ（12 秒ポーリングでも追従）。
//
// 「移乗するときはここから進捗を見られるように」= どの作業を裏エージェントに渡しても、
// そのセッションが自動的にこの一覧に現れ、選んで生の進捗を追える。
//
// 2026-07-19: 「すべて（過去含む）」トグルを追加。終わった作業（idle/done）も 7日窓内なら遡って
//   フィードを見られるようにした（既定は従来どおり「稼働中」ライブ表示・見た目非破壊）。
//
// 旧 iframe 版（静的 /fable-progress.html）に戻すには git 履歴（2026-07-18 以前）を参照。
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, Badge, StatusDot } from '../components/ui';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import { projectLabel } from '../lib/meta';
import { relativeTime, absoluteTime } from '../lib/time';
import type { AgentSummary, FeedItem } from '../lib/types';

/** 表示モード。'active'=稼働中のみ（ライブ・既定）／'all'=7日窓内の全エージェント（過去含む）。 */
type ViewMode = 'active' | 'all';

/** ツール名・種別からフィード行のアイコンを決める（Fable 進捗の体裁を踏襲）。 */
function feedIcon(item: FeedItem): string {
  if (item.kind === 'text') return '💬';
  if (item.kind === 'tool_result') return '↳';
  if (item.kind === 'other') return 'ℹ️';
  switch (item.toolName) {
    case 'Bash': return '💻';
    case 'Edit': return '✏️';
    case 'Write': return '📝';
    case 'NotebookEdit': return '📝';
    case 'Read': return '📖';
    case 'Grep':
    case 'Glob': return '🔎';
    case 'Task':
    case 'Agent': return '🤝';
    case 'WebFetch':
    case 'WebSearch': return '🌐';
    case 'TodoWrite': return '✅';
    default: return '🔧';
  }
}

/** hh:mm:ss（JST 表示はサーバ ISO をそのままローカル表示）。 */
function clock(iso?: string): string {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── ラボ生成ジョブ（MC-378）──────────────────────────────────────────────
// 「③の進捗は実装状況から見れるようにして」（Keita 2026-08-19）。
// ラボ（開発タブ）のモックアップ生成はサーバ側の非同期ジョブで走るため、依頼した端末以外
// （例: サーバから再投入したジョブ）からは進捗が見えなかった。GET /api/dev/mockup/jobs で
// 全ジョブを横断表示し、どの端末からでもこのタブでライブに追えるようにする。
// ジョブはインメモリ・終了後 15 分で消えるため、一覧は自然に「いま」の内容だけになる。

interface LabJob {
  jobId: string;
  status: 'pending' | 'generating' | 'done' | 'error' | 'canceled';
  stage?: 'design' | 'wireframe' | 'code' | 'review';
  mode?: string;
  label?: string;
  createdAt: number;
  finishedAt?: number;
  partialChars: number;
  thinkingChars: number;
  tail?: string;
  error?: string;
  mockupId?: string;
}

const LAB_STATUS_LABEL: Record<LabJob['status'], string> = {
  pending: '順番待ち',
  generating: '生成中',
  done: '完了',
  error: '失敗',
  canceled: '中止',
};

const LAB_STAGE_LABEL: Record<NonNullable<LabJob['stage']>, string> = {
  design: '設計',
  wireframe: 'ワイヤーフレーム',
  code: 'コーディング',
  review: '仕上げ',
};

const LAB_MODE_LABEL: Record<string, string> = {
  generate: '新規生成',
  revise: '修正',
  spec: '実装仕様書',
  codeLesson: 'コード学習',
  idea: 'アイデア',
};

/** 経過時間の短縮表示（例: 4分32秒）。 */
function elapsedLabel(fromMs: number, toMs: number): string {
  const s = Math.max(0, Math.floor((toMs - fromMs) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

/** クリップボードへコピー（Deliverables と同パターン。非セキュア文脈は textarea フォールバック）。 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* フォールバックへ。 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * 完了した実装仕様書／コード学習ジョブの本文ビューア（2026-08-20 Keita「実装仕様書もできたものを見れるようにして」）。
 * ボタンで開閉し、開いたときに保存済み本文を取得する。取得元は保存先 store（mockups/:id の
 * implSpec / codeLesson）を優先し、無ければジョブ詳細（job/:jobId の spec / codeLesson）に落とす。
 * ジョブ一覧は終了後 15 分で消えるが、本文自体はモックに保存済みなので開発タブでも常時見られる。
 */
function LabJobDoc({ job }: { job: LabJob }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const docLabel = job.mode === 'spec' ? '仕様書' : '解説';
  const handleCopy = async () => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };
  const load = async () => {
    if (text || busy) { setOpen((v) => !v); return; }
    setBusy(true);
    setErr(null);
    try {
      let body: string | undefined;
      if (job.mockupId) {
        const res = await fetch(`/api/dev/mockups/${encodeURIComponent(job.mockupId)}`);
        if (res.ok) {
          const d = (await res.json()) as { mockup?: { implSpec?: string; codeLesson?: string } };
          body = job.mode === 'spec' ? d.mockup?.implSpec : d.mockup?.codeLesson;
        }
      }
      if (!body) {
        const res = await fetch(`/api/dev/mockup/job/${encodeURIComponent(job.jobId)}`);
        if (res.ok) {
          const d = (await res.json()) as { spec?: string; codeLesson?: string };
          body = job.mode === 'spec' ? d.spec : d.codeLesson;
        }
      }
      if (!body) throw new Error('本文が見つかりませんでした');
      setText(body);
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => void load()}
        className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
        disabled={busy}
      >
        {busy ? '読み込み中…' : open ? `${docLabel}を閉じる` : `${docLabel}を開く`}
      </button>
      {text && (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="ml-2 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-text transition-colors hover:bg-surface-2"
        >
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      )}
      {err && <span className="ml-2 text-[11px]" style={{ color: '#e5534b' }}>{err}</span>}
      {open && text && (
        <pre className="mt-1.5 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-[11px] leading-relaxed text-text">
          {text}
        </pre>
      )}
    </div>
  );
}

/** ラボ生成ジョブのライブ一覧。ジョブが 1 件も無ければ何も描画しない（従来表示に非破壊）。 */
function LabJobsSection({ tick }: { tick: number }): JSX.Element | null {
  const jobsRes = useLiveResource<{ jobs: LabJob[] }>('/api/dev/mockup/jobs', tick);
  const jobs = jobsRes.data?.jobs ?? [];
  if (jobs.length === 0) return null;
  const now = Date.now();
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-bold text-text">🧪 ラボ生成ジョブ</h2>
        {jobs.some((j) => j.status === 'generating' || j.status === 'pending') && (
          <span className="inline-block h-2 w-2 rounded-full mc-pulse" style={{ background: 'var(--mc-active)' }} aria-hidden />
        )}
        <span className="text-[11px] text-text-faint">開発タブ（ラボ）で走っている生成の生の進捗</span>
      </div>
      <div className="flex flex-col gap-2">
        {jobs.map((j) => {
          const live = j.status === 'generating' || j.status === 'pending';
          return (
            <div
              key={j.jobId}
              className="rounded-xl border bg-surface px-3 py-2 text-xs"
              style={{ borderColor: live ? 'var(--mc-active)' : 'var(--mc-border)' }}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className="font-semibold"
                  style={{ color: j.status === 'error' ? '#e5534b' : live ? 'var(--mc-active)' : 'var(--mc-text-muted)' }}
                >
                  {LAB_STATUS_LABEL[j.status]}
                </span>
                {j.mode && <Badge>{LAB_MODE_LABEL[j.mode] ?? j.mode}</Badge>}
                <span className="font-medium text-text">{j.label ?? j.jobId.slice(0, 8)}</span>
                {j.stage && live && <span className="text-text-faint">／{LAB_STAGE_LABEL[j.stage]}中</span>}
                <span className="ml-auto whitespace-nowrap tabular-nums text-text-faint">
                  {elapsedLabel(j.createdAt, j.finishedAt ?? now)}
                  {j.partialChars > 0
                    ? ` ・コード ${j.partialChars.toLocaleString()} 字`
                    : j.thinkingChars > 0
                      ? ` ・思考 ${j.thinkingChars.toLocaleString()} 字`
                      : ''}
                </span>
              </div>
              {j.error && <div className="mt-1" style={{ color: '#e5534b' }}>{j.error}</div>}
              {j.status === 'done' && (j.mode === 'spec' || j.mode === 'codeLesson') && <LabJobDoc job={j} />}
              {j.tail && (
                <pre className="mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-[10px] leading-snug text-text-muted">
                  {j.tail}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 統合アクティビティボード（MC-534, 2026-09-04 Keita 指示・全面改修）──────────────────
// 「いま何が動いているか全部見える」。5 系統（サブエージェント／作業セッション／ターミナル／
// バックグラウンドジョブ／キュー）を GET /api/activity で横断取得し、状態別（実行中／待機／完了）に
// グルーピングして 1 画面に出す。各行に「誰が・何を・開始時刻・最終活動」を添える。
// サブエージェント行はクリックで下段の生フィード（作業のようす）を開ける。
interface ActivityItem {
  id: string;
  category: 'subagent' | 'session' | 'terminal' | 'job' | 'queue';
  categoryLabel: string;
  who: string;
  emoji: string;
  what: string;
  status: 'active' | 'idle' | 'done' | 'waiting';
  startedAt: string;
  lastActivity: string;
  scheduledFor: string;
  detail: string;
  agentId: string;
}

/** 状態バケット（実行中／待機／完了）。active=実行中、idle+waiting=待機、done=完了。 */
type Bucket = 'running' | 'waiting' | 'done';
const BUCKET_META: Record<Bucket, { label: string; color: string }> = {
  running: { label: '実行中', color: 'var(--mc-active)' },
  waiting: { label: '待機', color: '#c98a1a' },
  done: { label: '完了', color: 'var(--mc-text-faint)' },
};
function bucketOf(s: ActivityItem['status']): Bucket {
  if (s === 'active') return 'running';
  if (s === 'done') return 'done';
  return 'waiting'; // idle / waiting
}

const STATUS_COLOR: Record<ActivityItem['status'], string> = {
  active: 'var(--mc-active)',
  idle: 'var(--mc-text-muted)',
  waiting: '#c98a1a',
  done: 'var(--mc-text-faint)',
};

/** 未来時刻の短い相対表示（キュー用。例: あと5分 / あと2時間）。 */
function untilLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) return 'まもなく';
  if (mins < 60) return `あと${mins}分`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `あと${h}時間`;
  return `あと${Math.floor(h / 24)}日`;
}

/** 並べ替え用の代表タイムスタンプ（最終活動→開始→予定の順で採る）。 */
function sortTs(it: ActivityItem): number {
  return Date.parse(it.lastActivity || it.startedAt || it.scheduledFor || '') || 0;
}

/** アクティビティ 1 行。サブエージェントはクリックで選択（生フィードを開く）。 */
function ActivityRow({
  it,
  selected,
  onSelect,
}: {
  it: ActivityItem;
  selected: boolean;
  onSelect: (agentId: string) => void;
}): JSX.Element {
  const clickable = it.category === 'subagent' && !!it.agentId;
  const color = STATUS_COLOR[it.status];
  const timeRight =
    it.category === 'queue' && it.scheduledFor
      ? untilLabel(it.scheduledFor)
      : it.lastActivity
        ? relativeTime(it.lastActivity)
        : it.startedAt
          ? relativeTime(it.startedAt)
          : '';
  const timeTitle =
    it.category === 'queue'
      ? `次回 ${absoluteTime(it.scheduledFor)}`
      : it.lastActivity
        ? `最終活動 ${absoluteTime(it.lastActivity)}`
        : it.startedAt
          ? `開始 ${absoluteTime(it.startedAt)}`
          : '';
  return (
    <div
      className={`flex items-start gap-2.5 border-b border-border px-3 py-2 last:border-b-0 ${
        clickable ? 'cursor-pointer hover:bg-surface-2' : ''
      }`}
      style={selected ? { background: 'var(--mc-active-bg)' } : undefined}
      onClick={clickable ? () => onSelect(it.agentId) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(it.agentId);
              }
            }
          : undefined
      }
    >
      <span
        className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${it.status === 'active' ? 'mc-pulse' : ''}`}
        style={{ background: color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span aria-hidden>{it.emoji}</span>
          <span className="font-semibold text-text">{it.who}</span>
          <Badge>{it.categoryLabel}</Badge>
          {timeRight && (
            <span className="ml-auto whitespace-nowrap text-[11px] text-text-faint" title={timeTitle}>
              {timeRight}
            </span>
          )}
        </div>
        {it.what && (
          <div className="mt-0.5 text-[12px] leading-snug text-text-muted">
            {it.what.length > 200 ? `${it.what.slice(0, 200)}…` : it.what}
          </div>
        )}
        {it.detail && <div className="mt-0.5 text-[10px] text-text-faint">{it.detail}</div>}
      </div>
    </div>
  );
}

/** 状態別グルーピングの統合ボード。mode='active' は実行中グループのみ、'all' は全グループ。 */
function ActivityBoard({
  tick,
  mode,
  selectedAgentId,
  onSelectAgent,
}: {
  tick: number;
  mode: ViewMode;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}): JSX.Element {
  const res = useLiveResource<{ items: ActivityItem[] }>('/api/activity', tick);
  const items = res.data?.items ?? [];

  const buckets = useMemo(() => {
    const g: Record<Bucket, ActivityItem[]> = { running: [], waiting: [], done: [] };
    for (const it of items) g[bucketOf(it.status)].push(it);
    // 実行中・完了は活動の新しい順。待機はキュー（予定の早い順）を後ろに、それ以外を活動順で前に。
    g.running.sort((a, b) => sortTs(b) - sortTs(a));
    g.done.sort((a, b) => sortTs(b) - sortTs(a));
    g.waiting.sort((a, b) => {
      const aq = a.category === 'queue';
      const bq = b.category === 'queue';
      if (aq !== bq) return aq ? 1 : -1;
      if (aq && bq) return Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor);
      return sortTs(b) - sortTs(a);
    });
    return g;
  }, [items]);

  const order: Bucket[] = mode === 'active' ? ['running'] : ['running', 'waiting', 'done'];
  const total = order.reduce((n, b) => n + buckets[b].length, 0);

  if (res.loading && items.length === 0) {
    return <div className="py-6 text-center text-xs text-text-faint">読み込み中…</div>;
  }
  if (total === 0) {
    return (
      <EmptyState>
        {mode === 'active'
          ? 'いま動いているものはありません。'
          : '表示できるアクティビティがありません。'}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {order.map((b) => {
        const list = buckets[b];
        if (list.length === 0) return null;
        const meta = BUCKET_META[b];
        return (
          <div key={b}>
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${b === 'running' ? 'mc-pulse' : ''}`}
                style={{ background: meta.color }}
                aria-hidden
              />
              <h2 className="text-sm font-bold text-text">{meta.label}</h2>
              <span className="text-[11px] text-text-faint">{list.length} 件</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {list.map((it) => (
                <ActivityRow
                  key={it.id}
                  it={it}
                  selected={!!selectedAgentId && it.agentId === selectedAgentId}
                  onSelect={onSelectAgent}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function BuildProgress(): JSX.Element {
  // 表示モード。既定は「稼働中」（実行中グループのみ）。'all' で待機/完了も表示。
  const [mode, setMode] = useState<ViewMode>('active');

  const tick = useLiveTick('agents');

  // サブエージェント行のドリルダウン用。ボードの行クリックで選択 → 下段に生フィードを開く。
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 選択中サブエージェントの詳細解決用（全ステータス・サーバ側 12 秒キャッシュ）。
  const agentsRes = useLiveResource<{ agents: AgentSummary[] }>('/api/agents', tick);
  const agents = useMemo(() => agentsRes.data?.agents ?? [], [agentsRes.data]);
  const selected = useMemo(
    () => agents.find((a) => a.agentId === selectedId) ?? null,
    [agents, selectedId],
  );
  // 選択したエージェントが一覧から消えた（完了・7 日窓外）ら閉じる。
  useEffect(() => {
    if (selectedId && agentsRes.data && !agents.some((a) => a.agentId === selectedId)) {
      setSelectedId(null);
    }
  }, [agents, selectedId, agentsRes.data]);

  const feedRes = useLiveResource<{ feed: FeedItem[] }>(
    // 未選択時は 404 を避けるため有効な軽量エンドポイントへ（feed は空になるだけ）。
    selected ? `/api/agents/${encodeURIComponent(selected.agentId)}/feed` : '/api/agents?status=active',
    tick,
  );

  // モード切替トグル（PageHeader 右に置く。稼働中モードでは「リアルタイム」バッジも併置）。
  const MODE_TABS: { value: ViewMode; label: string }[] = [
    { value: 'active', label: '稼働中' },
    { value: 'all', label: 'すべて' },
  ];
  const modeToggle = (
    <div className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: 'var(--mc-border)' }}>
      {MODE_TABS.map((t) => {
        const on = mode === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => setMode(t.value)}
            className="px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              background: on ? 'var(--mc-active-bg)' : 'var(--mc-surface)',
              color: on ? 'var(--mc-active)' : 'var(--mc-text-muted)',
            }}
            aria-pressed={on}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );

  // 新しい順に並べ、ノイズの多い tool_result は畳んで発言＋操作を主役にする。
  const feed = useMemo(() => {
    const items = feedRes.data?.feed ?? [];
    return [...items].reverse().filter((it) => it.kind !== 'tool_result' && it.text.trim().length > 0);
  }, [feedRes.data]);

  // 操作カウント（ツール使用回数）。
  const toolCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of feedRes.data?.feed ?? []) {
      if (it.kind === 'tool_use' && it.toolName) m.set(it.toolName, (m.get(it.toolName) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [feedRes.data]);

  const fetchedAt = feedRes.fetchedAt ?? agentsRes.fetchedAt;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="実装進捗"
        fetchedAt={fetchedAt}
        right={
          <div className="flex items-center gap-2">
            {modeToggle}
            {mode === 'active' && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--mc-active)' }}>
                <span className="inline-block h-2 w-2 rounded-full mc-pulse" style={{ background: 'var(--mc-active)' }} aria-hidden />
                リアルタイム
              </span>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {/* ラボ生成ジョブ（MC-378）。走っているものがある時だけ最上部に出す。 */}
        <LabJobsSection tick={tick} />

        {/* 統合アクティビティボード（①〜⑤を状態別に一望）。サブエージェント行はクリックで下段に生フィード。 */}
        <ActivityBoard
          tick={tick}
          mode={mode}
          selectedAgentId={selectedId}
          onSelectAgent={(id) => setSelectedId((prev) => (prev === id ? null : id))}
        />

        {/* サブエージェントのドリルダウン（＝作業のようす）。行を選ぶと開く。 */}
        {selected && (
          <div className="mt-6 border-t border-border pt-5">
            {/* フェーズ見出しカード（＝いま何をしているか）。 */}
            <div className="mb-3 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold text-text">🛰 {selected.subagentType}</span>
                <Badge>{selected.projectLabel || projectLabel(selected.project)}</Badge>
                <StatusDot status={selected.status} />
                {selected.currentTaskId && <Badge title="担当タスク">{selected.currentTaskId}</Badge>}
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="ml-auto rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:bg-surface-2"
                >
                  閉じる
                </button>
              </div>
              {selected.description && (
                <div className="mt-1.5 text-sm text-text-muted">{selected.description}</div>
              )}
              {selected.lastAction && (
                <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-text">
                  <span className="text-text-faint">いま：</span>
                  {selected.lastAction}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-faint">
                <span title={absoluteTime(selected.lastActivity)}>最終活動: {relativeTime(selected.lastActivity)}</span>
                {selected.gitBranch && <span>ブランチ: {selected.gitBranch}</span>}
                <span>総メッセージ: {selected.messageCount}</span>
              </div>
            </div>

            {/* 操作カウント。 */}
            {toolCounts.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {toolCounts.map(([name, n]) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-muted"
                  >
                    <span aria-hidden>{feedIcon({ ts: '', role: 'assistant', kind: 'tool_use', toolName: name, text: '' })}</span>
                    {name} <b className="tabular-nums text-text">{n}</b>
                  </span>
                ))}
              </div>
            )}

            {/* 作業のようす（上が最新・左が時刻）。 */}
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-bold text-text">作業のようす</h2>
              <span className="text-[11px] text-text-faint">上が最新</span>
            </div>
            {feed.length === 0 ? (
              <EmptyState>まだ作業ログがありません。</EmptyState>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                {feed.map((it, i) => (
                  <div
                    key={`${it.ts}:${i}`}
                    className="flex items-start gap-2.5 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-text-faint" style={{ minWidth: '58px' }}>
                      {clock(it.ts)}
                    </span>
                    <span className="shrink-0" aria-hidden>{feedIcon(it)}</span>
                    <span
                      className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-snug ${
                        it.kind === 'tool_use' ? 'font-mono text-text-muted' : 'text-text'
                      }`}
                    >
                      {it.text.length > 400 ? `${it.text.slice(0, 400)}…` : it.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
