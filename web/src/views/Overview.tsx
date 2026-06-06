// Overview（司令塔）— 上部 KPI 帯 + プロジェクトカード + エージェントセクション + 横断検索。
// MC-67 でプロジェクトカードのタップ詳細を実装。MC-67 全タイル展開で KPI カードも
// タップ→詳細（プロジェクト別内訳＋関連タスク）に対応（TileDetail を再利用）。
// エージェント統合: 旧 /agents ビューの AgentCard グリッド＋ドロワー詳細を Overview 下部に追加。
import { useMemo, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type {
  Overview as OverviewData,
  OverviewProject,
  ProjectName,
  Task,
  TaskStatus,
  AgentStatus,
  AgentGroup,
  RosterEntry,
} from '../lib/types';
import { PROJECT_ORDER, priorityRank, projectColor, projectLabel, agentStatusMeta } from '../lib/meta';
import { relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, StalledBadge, Badge, TaskStatusBadge, StatusDot } from '../components/ui';
import { GlobalSearch } from '../components/GlobalSearch';
import { AlertBanner } from '../components/AlertBanner';
import { ProjectDetail } from '../components/ProjectDetail';
import { TaskDetail } from '../components/TaskDetail';
import { TileDetail, type TileSection } from '../components/TileDetail';
import { AgentFeed } from '../components/AgentFeed';
import { ChevronRightIcon, SearchIcon, CloseIcon, PlusIcon } from '../components/icons';

// KPI タイルの種別。クリック時にどの内訳・関連を出すかを決める。
type KpiKind =
  | 'agentsActive'
  | 'agentsIdle'
  | 'tasksInProgress'
  | 'tasksStalled'
  | 'tasksBlocked'
  | 'tasksReview';

interface KpiCardProps {
  label: string;
  value: number;
  color: string;
  sub?: string;
  onOpen: () => void;
}

function KpiCard({ label, value, color, sub, onOpen }: KpiCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative cursor-pointer rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 hover:shadow-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-surface-3 md:p-4"
      aria-label={`指標の詳細を開く: ${label}`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs font-medium text-text-muted">{label}</div>
        <span
          className="shrink-0 text-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden
        >
          <ChevronRightIcon width={14} height={14} />
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums md:text-3xl" style={{ color }}>
          {value}
        </span>
        {sub && <span className="text-xs text-text-faint">{sub}</span>}
      </div>
    </button>
  );
}

// KPI 種別ごとの表示メタ（ドロワーのラベル・アクセント色・対象タスクステータス）。
const KPI_META: Record<
  KpiKind,
  { label: string; color: string; taskStatus?: TaskStatus; stalledOnly?: boolean }
> = {
  agentsActive: { label: '稼働中エージェント', color: 'var(--mc-active)' },
  agentsIdle: { label: '待機エージェント', color: 'var(--mc-idle)' },
  tasksInProgress: { label: '進行中タスク', color: 'var(--mc-active)', taskStatus: 'IN_PROGRESS' },
  tasksStalled: { label: '滞留タスク', color: 'var(--mc-stalled)', stalledOnly: true },
  tasksBlocked: { label: 'ブロックタスク', color: 'var(--mc-blocked)', taskStatus: 'BLOCKED' },
  tasksReview: { label: 'レビュー待ちタスク', color: 'var(--mc-review)', taskStatus: 'REVIEW' },
};

/** KPI カードのドリルダウン詳細。プロジェクト別の内訳＋関連タスクを TileDetail で表示。 */
function KpiDetail({
  kind,
  projects,
  onClose,
  onOpenTask,
}: {
  kind: KpiKind | null;
  projects: OverviewProject[];
  onClose: () => void;
  onOpenTask: (t: Task) => void;
}) {
  // 関連タスク（タスク系 KPI のみ）。/api/tasks から該当ステータスで抽出。
  const tick = useLiveTick('tasks');
  const { data: tasksData } = useLiveResource<{ tasks: Task[] }>('/api/tasks', tick);

  const sections = useMemo<TileSection[]>(() => {
    if (!kind) return [];
    const meta = KPI_META[kind];

    // (a) プロジェクト別の内訳。OverviewProject から該当指標を引く。
    const perProject = (p: OverviewProject): number => {
      switch (kind) {
        case 'agentsActive':
          return p.agentsActive;
        case 'agentsIdle':
          return p.agentsIdle;
        case 'tasksInProgress':
          return p.tasksInProgress;
        case 'tasksStalled':
          return p.tasksStalled;
        default:
          return 0; // blocked / review は overview に project 別集計が無い → タスクから集計
      }
    };

    // blocked / review はタスク一覧から project 別に数える。
    const taskCountsByProject = new Map<ProjectName, number>();
    if ((kind === 'tasksBlocked' || kind === 'tasksReview') && tasksData) {
      for (const t of tasksData.tasks) {
        if (t.status === meta.taskStatus) {
          taskCountsByProject.set(t.project, (taskCountsByProject.get(t.project) ?? 0) + 1);
        }
      }
    }

    const stats = projects
      .map((p) => {
        const v =
          kind === 'tasksBlocked' || kind === 'tasksReview'
            ? (taskCountsByProject.get(p.project) ?? 0)
            : perProject(p);
        return { project: p.project, value: v };
      })
      .filter((x) => x.value > 0)
      .map((x) => ({
        key: `proj:${x.project}`,
        label: projectLabel(x.project),
        value: x.value,
        color: projectColor(x.project),
      }));

    const breakdownSection: TileSection = {
      heading: 'プロジェクト別内訳',
      stats,
      emptyText: '該当するプロジェクトはありません。',
    };

    // (b) 関連タスク（タスク系 KPI のみ）。
    const sectionList: TileSection[] = [breakdownSection];
    if ((meta.taskStatus || meta.stalledOnly) && tasksData) {
      const related = tasksData.tasks
        .filter((t) =>
          meta.stalledOnly ? t.stalled : t.status === meta.taskStatus,
        )
        .sort(
          (a, b) =>
            Number(b.stalled) - Number(a.stalled) ||
            priorityRank(a.priority) - priorityRank(b.priority) ||
            a.id.localeCompare(b.id),
        )
        .map((t) => ({
          key: `${t.source}:${t.id}`,
          tag: t.id,
          badges: (
            <>
              <TaskStatusBadge status={t.status} />
              <Badge>{projectLabel(t.project)}</Badge>
              {t.priority && <Badge>{t.priority}</Badge>}
              {t.stalled && <StalledBadge />}
            </>
          ),
          title: t.title,
          onClick: () => onOpenTask(t),
        }));
      sectionList.push({
        heading: '関連タスク',
        related,
        emptyText: '該当するタスクはありません。',
      });
    } else if (kind === 'agentsActive' || kind === 'agentsIdle') {
      sectionList.push({
        heading: '関連情報',
        note: 'エージェントの一覧と会話タイムラインは「エージェント」タブで確認できます。',
        related: [],
        emptyText: '',
      });
    }
    return sectionList;
  }, [kind, projects, tasksData, onOpenTask]);

  if (!kind) return null;
  const meta = KPI_META[kind];
  return (
    <TileDetail
      open={!!kind}
      onClose={onClose}
      kindLabel="指標"
      title={meta.label}
      accent={meta.color}
      sections={sections}
    />
  );
}

// ─── エージェントセクション用コンポーネント ─────────────────────────────────

const AGENT_STATUS_FILTERS: { value: AgentStatus | 'all'; label: string }[] = [
  { value: 'all',    label: 'すべて'  },
  { value: 'active', label: '稼働中' },
  { value: 'idle',   label: '待機'   },
  { value: 'done',   label: '完了'   },
  { value: 'never',  label: '未稼働' },
];

interface DisplayCard {
  key: string;
  agentId?: string;
  name: string;
  persona?: string;
  personality?: string;
  role?: string;
  status: AgentStatus;
  isPersona: boolean;
  instanceCount: number;
  activeCount: number;
  idleCount: number;
  doneCount: number;
  neverCount: number;
  projectLabel?: string;
  projects: string[];
  lastActivity?: string;
  lastAction?: string;
}

function buildAgentCards(groups: AgentGroup[], roster: RosterEntry[]): DisplayCard[] {
  const rosterByName = new Map(roster.map((r) => [r.name, r]));
  const cards: DisplayCard[] = [];
  const seenPersona = new Set<string>();

  for (const g of groups) {
    if (g.isPersona) seenPersona.add(g.subagentType);
    const r = rosterByName.get(g.subagentType);
    cards.push({
      key: `group:${g.subagentType}`,
      agentId: g.latestAgentId || undefined,
      name: g.subagentType,
      persona: r?.persona,
      personality: r?.personality,
      role: r?.role ?? g.description,
      status: g.status,
      isPersona: g.isPersona,
      instanceCount: g.instanceCount,
      activeCount: g.activeCount,
      idleCount: g.idleCount,
      doneCount: g.doneCount,
      neverCount: g.neverCount,
      projectLabel: g.projectLabel,
      projects: g.projects,
      lastActivity: g.lastActivity,
      lastAction: g.lastAction,
    });
  }

  for (const r of roster) {
    if (seenPersona.has(r.name)) continue;
    cards.push({
      key: `roster:${r.name}`,
      name: r.name,
      persona: r.persona,
      personality: r.personality,
      role: r.role,
      status: 'never',
      isPersona: true,
      instanceCount: 0,
      activeCount: 0,
      idleCount: 0,
      doneCount: 0,
      neverCount: 0,
      projectLabel: r.currentProject,
      projects: r.currentProject ? [r.currentProject] : [],
      lastActivity: r.lastActivity,
      lastAction: r.summary,
    });
  }
  return cards;
}

// エージェントカードのドロワー（会話タイムライン）。
function AgentDrawer({ agentId, name, onClose }: { agentId: string; name: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col md:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} の会話`}
    >
      <div className="flex-1 bg-bg/70" onClick={onClose} aria-hidden />
      <div className="flex h-[85vh] w-full max-w-xl flex-col rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl md:h-full md:rounded-none md:border-l md:border-t-0 md:pb-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-text">{name}</div>
            <div className="text-[11px] text-text-faint">会話タイムライン（最新の稼働）</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
            aria-label="閉じる"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <AgentFeed agentId={agentId} />
        </div>
      </div>
    </div>
  );
}

// SpawnModal（エージェント起動モーダル）。
type SpawnTab = 'free' | 'task';

interface SpawnResult {
  id: string;
  pid?: number;
  status: 'running' | 'done' | 'failed';
  message: string;
}

function AgentSpawnModal({ agentName, agentType, onClose }: { agentName: string; agentType: string; onClose: () => void }) {
  const [tab, setTab] = useState<SpawnTab>('free');
  const [freePrompt, setFreePrompt] = useState('');
  const [taskId, setTaskId] = useState('');
  const [taskExtra, setTaskExtra] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpawnResult | null>(null);
  const [error, setError] = useState('');
  const pollRef = useState<ReturnType<typeof setInterval> | null>(null)[0];

  async function handleSpawn() {
    setError('');
    setResult(null);
    setLoading(true);
    const body: Record<string, string> = { agentType };
    if (tab === 'free') {
      if (!freePrompt.trim()) { setError('指示内容を入力してください。'); setLoading(false); return; }
      body.prompt = freePrompt;
    } else {
      if (!taskId.trim()) { setError('タスクIDを入力してください（例: MC-85）。'); setLoading(false); return; }
      body.taskId = taskId.trim();
      if (taskExtra.trim()) body.prompt = taskExtra;
    }
    try {
      const resp = await fetch('/api/agents/spawn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json() as { ok: boolean; id?: string; pid?: number; error?: string };
      if (!data.ok || !data.id) { setError(data.error ?? '起動に失敗しました。'); setLoading(false); return; }
      setResult({ id: data.id, pid: data.pid, status: 'running', message: `起動しました（PID: ${data.pid ?? '不明'}）` });
      const interval = window.setInterval(async () => {
        try {
          const r = await fetch(`/api/agents/spawn/${data.id!}`);
          if (!r.ok) return;
          const d = await r.json() as { ok: boolean; status: 'running' | 'done' | 'failed' };
          if (!d.ok) return;
          setResult((prev) => prev ? { ...prev, status: d.status } : null);
          if (d.status !== 'running') window.clearInterval(interval);
        } catch { /* ignore */ }
      }, 3000);
      // pollRef を直接 mutate (closure 用途のみ)
      (pollRef as unknown as { current: number | null }).current = interval as unknown as number;
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setLoading(false);
    }
  }

  const instruction = tab === 'free' ? freePrompt : (taskId + (taskExtra ? '\n' + taskExtra : ''));
  const tooLong = instruction.length > 2000;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={`${agentName} を起動する`}>
      <div className="absolute inset-0 bg-bg/70" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-lg rounded-t-2xl border border-border bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-xl md:rounded-2xl md:pb-5" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-bold text-text">{agentName} を起動する</div>
            <div className="text-[11px] text-text-faint">{agentType}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-text" aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        {!result && (
          <div className="mb-4 flex rounded-lg bg-surface-2 p-0.5 gap-0.5">
            {(['free', 'task'] as SpawnTab[]).map((t) => (
              <button key={t} type="button" onClick={() => { setTab(t); setError(''); }} className={`flex-1 rounded-md py-1.5 text-xs transition-colors ${tab === t ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted hover:text-text'}`} aria-pressed={tab === t}>
                {t === 'free' ? '自由入力' : 'タスクID指定'}
              </button>
            ))}
          </div>
        )}
        {!result && (
          <>
            {tab === 'free' ? (
              <div className="mb-4">
                <label className="mb-1.5 block text-xs text-text-muted" htmlFor="ov-spawn-free-prompt">指示内容（最大 2000 字）</label>
                <textarea id="ov-spawn-free-prompt" value={freePrompt} onChange={(e) => setFreePrompt(e.target.value)} placeholder="指示内容を入力してください..." rows={5} maxLength={2100} className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none" />
                <div className={`mt-1 text-right text-[10px] ${tooLong ? 'text-stalled' : 'text-text-faint'}`}>{freePrompt.length} / 2000</div>
              </div>
            ) : (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs text-text-muted" htmlFor="ov-spawn-task-id">タスクID（例: MC-85, DF-F3）</label>
                  <input id="ov-spawn-task-id" type="text" value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="MC-85" className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-text-muted" htmlFor="ov-spawn-task-extra">追加指示（任意）</label>
                  <textarea id="ov-spawn-task-extra" value={taskExtra} onChange={(e) => setTaskExtra(e.target.value)} placeholder="追加の指示があれば入力..." rows={3} className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none" />
                </div>
              </div>
            )}
            {error && <p className="mb-3 rounded-lg bg-stalled/10 px-3 py-2 text-xs text-stalled">{error}</p>}
            <button type="button" onClick={handleSpawn} disabled={loading || tooLong} className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors" style={{ background: 'var(--mc-accent)', color: '#fff', opacity: loading || tooLong ? 0.6 : 1, cursor: loading || tooLong ? 'not-allowed' : 'pointer' }}>
              {loading ? '起動中...' : '起動する'}
            </button>
          </>
        )}
        {result && (
          <div className="space-y-3">
            <div className="rounded-lg px-4 py-3 text-sm" style={{ background: result.status === 'done' ? 'var(--mc-active-bg)' : result.status === 'failed' ? 'var(--mc-stalled-bg)' : 'var(--mc-surface-2)', color: result.status === 'done' ? 'var(--mc-active)' : result.status === 'failed' ? 'var(--mc-stalled)' : 'var(--mc-text-muted)' }}>
              {result.status === 'running' && '実行中...'}{result.status === 'done' && '完了しました。'}{result.status === 'failed' && '失敗しました。'}
            </div>
            <div className="text-[11px] text-text-faint space-y-0.5"><div>{result.message}</div><div>ID: {result.id}</div></div>
            <button type="button" onClick={onClose} className="w-full rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition-colors">閉じる</button>
          </div>
        )}
      </div>
    </div>
  );
}

// エージェントカード（1体分）。
function OverviewAgentCard({ card, onOpen, onSpawn }: { card: DisplayCard; onOpen: () => void; onSpawn: () => void }) {
  const meta = agentStatusMeta(card.status);
  const clickable = !!card.agentId;
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors" style={{ borderLeft: `3px solid ${meta.color}` }}>
      <button
        type="button"
        onClick={onOpen}
        disabled={!clickable}
        className={`flex items-start justify-between gap-2 text-left ${clickable ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
        aria-label={`${card.persona || card.name}（${meta.label}）${clickable ? ' — 会話を表示' : ''}`}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-text">{card.persona || card.name}</div>
          {card.persona && <div className="truncate text-[10px] text-text-faint">{card.name}</div>}
          {card.role && <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">{card.role}</div>}
        </div>
        <StatusDot status={card.status} />
      </button>
      {card.personality && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-text-muted">
          <span className="font-semibold text-text-faint">気質: </span>{card.personality}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.projects.slice(0, 3).map((p) => <Badge key={p}>{p}</Badge>)}
        {!card.isPersona && <Badge color="var(--mc-idle)" bg="var(--mc-idle-bg)" title="人格を持たない稼働（孫・汎用）の集計">その他</Badge>}
      </div>
      {card.instanceCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
          <span>稼働 <span className="font-semibold text-text">{card.instanceCount}</span> 件</span>
          {card.activeCount > 0 && <span>稼働中 {card.activeCount}</span>}
          {card.idleCount > 0 && <span>待機 {card.idleCount}</span>}
          {card.doneCount > 0 && <span>完了 {card.doneCount}</span>}
        </div>
      )}
      {card.lastAction && <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-text-muted">{card.lastAction}</p>}
      <div className="mt-2 text-[11px] text-text-faint">最終活動: {relativeTime(card.lastActivity)}</div>
      <div className="mt-3 border-t border-border pt-3">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSpawn(); }}
          className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
          aria-label={`${card.persona || card.name} を起動する`}
        >
          <PlusIcon width={14} height={14} />
          起動する
        </button>
      </div>
    </div>
  );
}

// ─── プロジェクトカード ───────────────────────────────────────────────────────

function ProjectCard({ p, onOpen }: { p: OverviewProject; onOpen: (project: ProjectName) => void }) {
  const accent = projectColor(p.project);
  const empty = p.agentsTotal === 0 && p.tasksTotal === 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(p.project)}
      className="group relative w-full cursor-pointer rounded-xl border border-border bg-surface p-4 pr-8 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 hover:shadow-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-surface-3"
      style={{ borderLeft: `3px solid ${accent}` }}
      aria-label={`プロジェクト詳細を開く: ${projectLabel(p.project)}`}
    >
      <div className="flex items-center justify-between gap-2 pr-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: accent }}
            aria-hidden
          />
          <h3 className="text-sm font-bold text-text">{projectLabel(p.project)}</h3>
        </div>
        {p.tasksStalled > 0 && <StalledBadge />}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] text-text-faint">稼働エージェント</div>
          <div className="text-lg font-semibold tabular-nums text-text">
            {p.agentsActive}
            <span className="text-xs font-normal text-text-faint"> / {p.agentsTotal}</span>
          </div>
          {p.agentsIdle > 0 && (
            <div className="text-[10px] text-text-faint">待機 {p.agentsIdle}</div>
          )}
        </div>
        <div>
          <div className="text-[11px] text-text-faint">タスク</div>
          <div className="text-lg font-semibold tabular-nums text-text">
            {p.tasksTotal}
          </div>
          {p.tasksInProgress > 0 && (
            <div className="text-[10px]" style={{ color: 'var(--mc-active)' }}>
              進行中 {p.tasksInProgress}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <span className="text-[11px] text-text-faint">
          最終活動: {relativeTime(p.lastActivity)}
        </span>
        {empty && <span className="text-[10px] text-text-faint">活動記録なし</span>}
      </div>

      {/* 右端の chevron。タップ可能であることを示す恒常的な手がかり。 */}
      <span
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden
      >
        <ChevronRightIcon width={16} height={16} />
      </span>
    </button>
  );
}

export default function Overview() {
  // overview は agents + tasks 由来。どちらの変更でも再フェッチ。
  const tick = useLiveTick('agents', 'tasks');
  const { data, error, loading, fetchedAt } = useLiveResource<OverviewData>('/api/overview', tick);

  // エージェントデータ（grouped + roster）
  const agentTick = useLiveTick('agents');
  const groupsRes = useLiveResource<{ groups: AgentGroup[] }>('/api/agents/grouped', agentTick);
  const rosterRes = useLiveResource<{ roster: RosterEntry[] }>('/api/roster', agentTick);

  const kpi = data?.kpi;
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectName | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<KpiKind | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // エージェントセクション state
  const [agentFilter, setAgentFilter] = useState<AgentStatus | 'all'>('all');
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [spawnTarget, setSpawnTarget] = useState<{ name: string; type: string } | null>(null);

  // 表示順を PROJECT_ORDER に揃える。
  const projects = data
    ? [...data.projects].sort(
        (a, b) => PROJECT_ORDER.indexOf(a.project) - PROJECT_ORDER.indexOf(b.project),
      )
    : [];

  // エージェントカード組立
  const agentCards = useMemo(
    () => buildAgentCards(groupsRes.data?.groups ?? [], rosterRes.data?.roster ?? []),
    [groupsRes.data, rosterRes.data],
  );
  const agentCounts = useMemo(() => {
    const c: Record<string, number> = { active: 0, idle: 0, done: 0, never: 0 };
    for (const card of agentCards) c[card.status] = (c[card.status] ?? 0) + 1;
    return c;
  }, [agentCards]);
  const filteredAgents = agentFilter === 'all' ? agentCards : agentCards.filter((c) => c.status === agentFilter);
  const openAgentCard = openAgentId ? agentCards.find((c) => c.agentId === openAgentId) : undefined;

  return (
    <div>
      <PageHeader
        title="司令塔"
        subtitle="エージェント稼働とタスク進捗の俯瞰"
        fetchedAt={fetchedAt}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
              aria-label="横断検索を開く"
            >
              <SearchIcon width={14} height={14} />
              検索
            </button>
          </div>
        }
      />
      <div className="p-4 md:p-6">
        {/* アラートバッジ（MC-63）。0 件なら自身で非表示。KPI 帯の手前に常設。 */}
        <AlertBanner />
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {kpi && (
            <section className="mb-8">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KpiCard
                  label="稼働中"
                  value={kpi.agentsActive}
                  color="var(--mc-active)"
                  sub={`/ ${kpi.agentsTotal}`}
                  onOpen={() => setSelectedKpi('agentsActive')}
                />
                <KpiCard
                  label="待機"
                  value={kpi.agentsIdle}
                  color="var(--mc-idle)"
                  onOpen={() => setSelectedKpi('agentsIdle')}
                />
                <KpiCard
                  label="進行中タスク"
                  value={kpi.tasksInProgress}
                  color="var(--mc-active)"
                  onOpen={() => setSelectedKpi('tasksInProgress')}
                />
                <KpiCard
                  label="滞留タスク"
                  value={kpi.tasksStalled}
                  color="var(--mc-stalled)"
                  onOpen={() => setSelectedKpi('tasksStalled')}
                />
                <KpiCard
                  label="ブロック"
                  value={kpi.tasksBlocked}
                  color="var(--mc-blocked)"
                  onOpen={() => setSelectedKpi('tasksBlocked')}
                />
                <KpiCard
                  label="レビュー待ち"
                  value={kpi.tasksReview}
                  color="var(--mc-review)"
                  onOpen={() => setSelectedKpi('tasksReview')}
                />
              </div>
            </section>
          )}

          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold text-text-muted">プロジェクト</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.map((p) => (
                <ProjectCard key={p.project} p={p} onOpen={setSelectedProject} />
              ))}
            </div>
          </section>
        </ResourceState>

        {/* ── エージェントセクション ─────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-muted">
              エージェント
              {agentCards.length > 0 && (
                <span className="ml-1.5 text-[11px] font-normal text-text-faint">
                  人格 {agentCards.filter((c) => c.isPersona).length} 体 — 稼働中 {agentCounts.active} / 待機 {agentCounts.idle} / 完了 {agentCounts.done} / 未稼働 {agentCounts.never}
                </span>
              )}
            </h2>
            <div
              className="no-scrollbar -mx-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto px-1"
              role="group"
              aria-label="状態で絞り込み"
            >
              {AGENT_STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setAgentFilter(f.value)}
                  className={`shrink-0 rounded-md px-2.5 py-2 text-xs md:py-1 ${
                    agentFilter === f.value
                      ? 'bg-surface-3 font-semibold text-text'
                      : 'text-text-muted hover:bg-surface-2'
                  }`}
                  aria-pressed={agentFilter === f.value}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <ResourceState loading={groupsRes.loading} error={groupsRes.error} hasData={!!groupsRes.data}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredAgents.map((card) => (
                <OverviewAgentCard
                  key={card.key}
                  card={card}
                  onOpen={() => card.agentId && setOpenAgentId(card.agentId)}
                  onSpawn={() => setSpawnTarget({ name: card.persona || card.name, type: card.name })}
                />
              ))}
            </div>
            {filteredAgents.length === 0 && (
              <p className="mt-6 text-sm text-text-faint">該当するエージェントがありません。</p>
            )}
          </ResourceState>
        </section>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ProjectDetail project={selectedProject} onClose={() => setSelectedProject(null)} onOpenTask={setSelectedTask} />
      <KpiDetail kind={selectedKpi} projects={projects} onClose={() => setSelectedKpi(null)} onOpenTask={setSelectedTask} />
      <TaskDetail task={selectedTask} onClose={() => setSelectedTask(null)} />

      {/* エージェント会話ドロワー */}
      {openAgentCard?.agentId && (
        <AgentDrawer
          agentId={openAgentCard.agentId}
          name={openAgentCard.persona || openAgentCard.name}
          onClose={() => setOpenAgentId(null)}
        />
      )}

      {/* エージェント起動モーダル */}
      {spawnTarget && (
        <AgentSpawnModal
          agentName={spawnTarget.name}
          agentType={spawnTarget.type}
          onClose={() => setSpawnTarget(null)}
        />
      )}
    </div>
  );
}
