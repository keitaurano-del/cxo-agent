// Agents — 人格別に集約したエージェント一覧（MC-88）。
// /api/agents/grouped（人格＝subagentType 単位の集約）と /api/roster（台帳の役割定義）を
// マージし、231 件の稼働インスタンスを人格保有エージェント中心の数件に畳んで表示する。
// 各カードは稼働内訳（稼働/待機/完了/未稼働の件数）・最終活動・現在のタスクを出す。
// カードクリックで最新インスタンスの会話タイムライン（/api/agents/:id/feed）をドロワー表示。
// MC-86: 各カードに「起動」ボタンを追加し、headless claude を spawn できるモーダルを提供。
import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { AgentStatus, AgentGroup, RosterEntry } from '../lib/types';
import { agentStatusMeta } from '../lib/meta';
import { relativeTime } from '../lib/time';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, StatusDot, Badge } from '../components/ui';
import { AgentFeed } from '../components/AgentFeed';
import { CloseIcon, PlusIcon } from '../components/icons';
import { getAgentAvatar } from '../lib/agentAvatars';

const STATUS_FILTERS: { value: AgentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'active', label: '稼働中' },
  { value: 'idle', label: '待機' },
  { value: 'done', label: '完了' },
  { value: 'never', label: '未稼働' },
];

// 人格別に集約した 1 体分の表示カード。
interface DisplayCard {
  key: string;
  agentId?: string; // feed を開ける最新インスタンスの agentId（その他/未稼働は無し）
  name: string; // エージェント識別名（subagentType ベース）
  persona?: string; // 人格名（roster frontmatter persona）
  personality?: string; // 気質（roster frontmatter personality）
  role?: string; // 役割（roster or グループの description）
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

function buildCards(groups: AgentGroup[], roster: RosterEntry[]): DisplayCard[] {
  const rosterByName = new Map(roster.map((r) => [r.name, r]));
  const cards: DisplayCard[] = [];
  const seenPersona = new Set<string>();

  // 1) 集約グループ（人格保有が先頭、その他が末尾。server が並べ済み）。
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

  // 2) 台帳にいるが稼働インスタンスが 1 件も無い人格（未稼働）を補完表示。
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

// MC-165: エージェントの V2 ドット絵アバター。稼働中は working（工具を動かす）、
// それ以外は idle（呼吸・まばたき）の GIF を表示する。アバター未生成の subagentType は
// null を返し、カードは従来どおり状態ドットのみで表示する（既存レイアウト非破壊）。
function AgentAvatarImg({ card }: { card: DisplayCard }) {
  const avatar = getAgentAvatar(card.name);
  if (!avatar) return null;
  const working = card.status === 'active';
  const src = working ? avatar.working : avatar.idle;
  return (
    <img
      src={src}
      alt={`${avatar.name}（${working ? '稼働中' : '待機'}）`}
      title={`${avatar.name}（${working ? '稼働中' : '待機'}）`}
      width={56}
      height={56}
      loading="lazy"
      decoding="async"
      className="h-14 w-14 shrink-0 rounded-xl border border-border bg-surface-2 object-cover"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function AgentCard({
  card,
  onOpen,
  onSpawn,
}: {
  card: DisplayCard;
  onOpen: () => void;
  onSpawn: () => void;
}) {
  const meta = agentStatusMeta(card.status);
  const clickable = !!card.agentId;
  return (
    <div
      className="flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors"
      style={{ borderLeft: `3px solid ${meta.color}` }}
    >
      {/* カードヘッダ（クリックで会話ドロワー） */}
      <button
        type="button"
        onClick={onOpen}
        disabled={!clickable}
        className={`flex items-start justify-between gap-2 text-left ${
          clickable ? 'cursor-pointer' : 'cursor-default opacity-80'
        }`}
        aria-label={`${card.persona || card.name}（${meta.label}）${clickable ? ' — 会話を表示' : ''}`}
      >
        {/* MC-165: V2 ドット絵アバター（未生成のエージェントは非表示） */}
        <AgentAvatarImg card={card} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-text">{card.persona || card.name}</div>
          {card.persona && (
            <div className="truncate text-[10px] text-text-faint">{card.name}</div>
          )}
          {card.role && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">{card.role}</div>
          )}
        </div>
        <StatusDot status={card.status} />
      </button>

      {card.personality && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-text-muted">
          <span className="font-semibold text-text-faint">気質: </span>
          {card.personality}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.projects.slice(0, 3).map((p) => (
          <Badge key={p}>{p}</Badge>
        ))}
        {!card.isPersona && (
          <Badge color="var(--mc-idle)" bg="var(--mc-idle-bg)" title="人格を持たない稼働（孫・汎用）の集計">
            その他
          </Badge>
        )}
      </div>

      {/* 稼働サマリ: 集約した稼働件数の内訳 */}
      {card.instanceCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
          <span>
            稼働 <span className="font-semibold text-text">{card.instanceCount}</span> 件
          </span>
          {card.activeCount > 0 && <span>稼働中 {card.activeCount}</span>}
          {card.idleCount > 0 && <span>待機 {card.idleCount}</span>}
          {card.doneCount > 0 && <span>完了 {card.doneCount}</span>}
        </div>
      )}

      {card.lastAction && (
        <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-text-muted">
          {card.lastAction}
        </p>
      )}

      <div className="mt-2 text-[11px] text-text-faint">
        最終活動: {relativeTime(card.lastActivity)}
      </div>

      {/* 起動ボタン（MC-86） */}
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

/** MC-187: AgentDetail 統計パネル。稼働インスタンス数・プロジェクト別内訳を表示。 */
function AgentStats({ card }: { card: DisplayCard }) {
  // 稼働パイ： 稼働中 / 待機 / 完了 / 未稼働（0件なら表示しない）
  const hasStats = card.instanceCount > 0;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-2 p-4">
      {/* 概要：エージェント名・役割 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-sm font-bold text-text">{card.persona || card.name}</div>
          {card.personality && (
            <span className="text-[10px] text-text-faint px-1.5 py-0.5 bg-surface rounded">
              {card.personality}
            </span>
          )}
        </div>
        {card.role && (
          <p className="text-[11px] text-text-muted">{card.role}</p>
        )}
      </div>

      {/* 稼働統計（MC-187） */}
      {hasStats && (
        <div className="border-t border-border pt-3">
          <p className="text-[11px] font-semibold text-text-faint mb-2">稼働統計</p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md bg-surface px-2 py-1.5">
              <div className="font-semibold" style={{ color: 'var(--mc-active)' }}>
                {card.activeCount}
              </div>
              <div className="text-text-faint">稼働中</div>
            </div>
            <div className="rounded-md bg-surface px-2 py-1.5">
              <div className="font-semibold" style={{ color: 'var(--mc-idle)' }}>
                {card.idleCount}
              </div>
              <div className="text-text-faint">待機</div>
            </div>
            <div className="rounded-md bg-surface px-2 py-1.5">
              <div className="font-semibold" style={{ color: 'var(--mc-done)' }}>
                {card.doneCount}
              </div>
              <div className="text-text-faint">完了</div>
            </div>
            <div className="rounded-md bg-surface px-2 py-1.5">
              <div className="font-semibold text-text-muted">{card.instanceCount}</div>
              <div className="text-text-faint">合計</div>
            </div>
          </div>
        </div>
      )}

      {/* プロジェクト別内訳 */}
      {card.projects.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-[11px] font-semibold text-text-faint mb-2">プロジェクト</p>
          <div className="flex flex-wrap gap-1.5">
            {card.projects.map((p) => (
              <Badge key={p}>{p}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* 最終活動 */}
      {card.lastActivity && (
        <div className="border-t border-border pt-3">
          <p className="text-[11px] text-text-faint">
            最終活動: {relativeTime(card.lastActivity)}
          </p>
        </div>
      )}
    </div>
  );
}

function Drawer({
  agentId,
  name,
  card,
  onClose,
}: {
  agentId: string;
  name: string;
  card: DisplayCard;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col md:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} の詳細`}
    >
      <div className="flex-1 bg-bg/70" onClick={onClose} aria-hidden />
      {/* MC-187: レスポンシブドロワー。md未満は下から、md以上は右スライド。 */}
      <div className="flex h-[85vh] w-full max-w-xl flex-col rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl md:h-full md:max-w-[384px] md:rounded-none md:border-l md:border-t-0 md:pb-0">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/95 backdrop-blur px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-text">{name}</div>
            <div className="text-[11px] text-text-faint">詳細情報</div>
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
        {/* コンテンツ：スクロール領域 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* MC-187: 統計パネル（概要・稼働統計・プロジェクト別） */}
          <AgentStats card={card} />

          {/* 会話タイムライン */}
          <section>
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-text-faint">
              会話タイムライン
            </h3>
            <AgentFeed agentId={agentId} />
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── SpawnModal（MC-86）──────────────────────────────────────────────
// エージェントを headless claude で起動するモーダル。
// タブ: 「自由入力」と「タスクID指定」。起動後に状態をポーリング（3秒間隔）。

type SpawnTab = 'free' | 'task';

interface SpawnResult {
  id: string;
  pid?: number;
  status: 'running' | 'done' | 'failed';
  message: string;
}

function SpawnModal({
  agentName,
  agentType,
  onClose,
}: {
  agentName: string;
  agentType: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SpawnTab>('free');
  const [freePrompt, setFreePrompt] = useState('');
  const [taskId, setTaskId] = useState('');
  const [taskExtra, setTaskExtra] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpawnResult | null>(null);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ポーリング停止クリーンアップ
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ポーリング: 3秒ごとに spawn/:id を叩く
  function startPolling(spawnId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/agents/spawn/${spawnId}`);
        if (!resp.ok) return;
        const data = await resp.json() as {
          ok: boolean;
          status: 'running' | 'done' | 'failed';
          pid?: number;
        };
        if (!data.ok) return;
        setResult((prev) => prev ? { ...prev, status: data.status } : null);
        if (data.status !== 'running') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ネットワークエラーは無視して継続
      }
    }, 3000);
  }

  async function handleSpawn() {
    setError('');
    setResult(null);
    setLoading(true);

    const body: Record<string, string> = { agentType };
    if (tab === 'free') {
      if (!freePrompt.trim()) {
        setError('指示内容を入力してください。');
        setLoading(false);
        return;
      }
      body.prompt = freePrompt;
    } else {
      if (!taskId.trim()) {
        setError('タスクIDを入力してください（例: MC-85）。');
        setLoading(false);
        return;
      }
      body.taskId = taskId.trim();
      if (taskExtra.trim()) body.prompt = taskExtra;
    }

    try {
      const resp = await fetch('/api/agents/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json() as {
        ok: boolean;
        id?: string;
        pid?: number;
        error?: string;
      };
      if (!data.ok || !data.id) {
        setError(data.error ?? '起動に失敗しました。');
        setLoading(false);
        return;
      }
      const r: SpawnResult = {
        id: data.id,
        pid: data.pid,
        status: 'running',
        message: `起動しました（PID: ${data.pid ?? '不明'}）`,
      };
      setResult(r);
      startPolling(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setLoading(false);
    }
  }

  const instruction = tab === 'free' ? freePrompt : (taskId + (taskExtra ? '\n' + taskExtra : ''));
  const tooLong = instruction.length > 2000;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${agentName} を起動する`}
    >
      {/* 背景オーバーレイ */}
      <div
        className="absolute inset-0 bg-bg/70"
        onClick={onClose}
        aria-hidden
      />
      {/* モーダル本体 */}
      <div
        className="relative w-full max-w-lg rounded-t-2xl border border-border bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-xl md:rounded-2xl md:pb-5"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* ヘッダ */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-bold text-text">{agentName} を起動する</div>
            <div className="text-[11px] text-text-faint">{agentType}</div>
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

        {/* タブ切替 */}
        {!result && (
          <div className="mb-4 flex rounded-lg bg-surface-2 p-0.5 gap-0.5">
            {(['free', 'task'] as SpawnTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setError(''); }}
                className={`flex-1 rounded-md py-1.5 text-xs transition-colors ${
                  tab === t
                    ? 'bg-surface-3 font-semibold text-text'
                    : 'text-text-muted hover:text-text'
                }`}
                aria-pressed={tab === t}
              >
                {t === 'free' ? '自由入力' : 'タスクID指定'}
              </button>
            ))}
          </div>
        )}

        {/* フォーム（起動前） */}
        {!result && (
          <>
            {tab === 'free' ? (
              <div className="mb-4">
                <label className="mb-1.5 block text-xs text-text-muted" htmlFor="spawn-free-prompt">
                  指示内容（最大 2000 字）
                </label>
                <textarea
                  id="spawn-free-prompt"
                  value={freePrompt}
                  onChange={(e) => setFreePrompt(e.target.value)}
                  placeholder="指示内容を入力してください..."
                  rows={5}
                  maxLength={2100}
                  className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none"
                />
                <div className={`mt-1 text-right text-[10px] ${tooLong ? 'text-stalled' : 'text-text-faint'}`}>
                  {freePrompt.length} / 2000
                </div>
              </div>
            ) : (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs text-text-muted" htmlFor="spawn-task-id">
                    タスクID（例: MC-85, DF-F3）
                  </label>
                  <input
                    id="spawn-task-id"
                    type="text"
                    value={taskId}
                    onChange={(e) => setTaskId(e.target.value)}
                    placeholder="MC-85"
                    className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-text-muted" htmlFor="spawn-task-extra">
                    追加指示（任意）
                  </label>
                  <textarea
                    id="spawn-task-extra"
                    value={taskExtra}
                    onChange={(e) => setTaskExtra(e.target.value)}
                    placeholder="追加の指示があれば入力..."
                    rows={3}
                    className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="mb-3 rounded-lg bg-stalled/10 px-3 py-2 text-xs text-stalled">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSpawn}
              disabled={loading || tooLong}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
              style={{
                background: 'var(--mc-accent)',
                color: '#fff',
                opacity: loading || tooLong ? 0.6 : 1,
                cursor: loading || tooLong ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '起動中...' : '起動する'}
            </button>
          </>
        )}

        {/* 起動後ステータス */}
        {result && (
          <div className="space-y-3">
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                background:
                  result.status === 'done'
                    ? 'var(--mc-active-bg)'
                    : result.status === 'failed'
                    ? 'var(--mc-stalled-bg)'
                    : 'var(--mc-surface-2)',
                color:
                  result.status === 'done'
                    ? 'var(--mc-active)'
                    : result.status === 'failed'
                    ? 'var(--mc-stalled)'
                    : 'var(--mc-text-muted)',
              }}
            >
              {result.status === 'running' && '実行中...'}
              {result.status === 'done' && '完了しました。'}
              {result.status === 'failed' && '失敗しました。'}
            </div>
            <div className="text-[11px] text-text-faint space-y-0.5">
              <div>{result.message}</div>
              <div>ID: {result.id}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
            >
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Agents() {
  const tick = useLiveTick('agents');
  const navigate = useNavigate();
  const { agentId: routeAgentId } = useParams();
  const [filter, setFilter] = useState<AgentStatus | 'all'>('all');
  const [spawnTarget, setSpawnTarget] = useState<{ name: string; type: string } | null>(null);

  const groupsRes = useLiveResource<{ groups: AgentGroup[] }>('/api/agents/grouped', tick);
  const rosterRes = useLiveResource<{ roster: RosterEntry[] }>('/api/roster', tick);

  const cards = useMemo(
    () => buildCards(groupsRes.data?.groups ?? [], rosterRes.data?.roster ?? []),
    [groupsRes.data, rosterRes.data],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { active: 0, idle: 0, done: 0, never: 0 };
    for (const card of cards) c[card.status] = (c[card.status] ?? 0) + 1;
    return c;
  }, [cards]);

  const filtered = filter === 'all' ? cards : cards.filter((c) => c.status === filter);

  const openCard = routeAgentId
    ? cards.find((c) => c.agentId === routeAgentId)
    : undefined;

  return (
    <div>
      <PageHeader
        title="エージェント"
        subtitle={`人格 ${cards.filter((c) => c.isPersona).length} 体 — 稼働中 ${counts.active} / 待機 ${counts.idle} / 完了 ${counts.done} / 未稼働 ${counts.never}`}
        fetchedAt={groupsRes.fetchedAt}
        right={
          <div
            className="no-scrollbar -mx-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto px-1"
            role="group"
            aria-label="状態で絞り込み"
          >
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`shrink-0 rounded-md px-2.5 py-2 text-xs md:py-1 ${
                  filter === f.value
                    ? 'bg-surface-3 font-semibold text-text'
                    : 'text-text-muted hover:bg-surface-2'
                }`}
                aria-pressed={filter === f.value}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="p-4 md:p-6">
        <ResourceState
          loading={groupsRes.loading}
          error={groupsRes.error}
          hasData={!!groupsRes.data}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((card) => (
              <AgentCard
                key={card.key}
                card={card}
                onOpen={() => card.agentId && navigate(`/agents/${card.agentId}`)}
                onSpawn={() => setSpawnTarget({ name: card.persona || card.name, type: card.name })}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="mt-6 text-sm text-text-faint">該当するエージェントがありません。</p>
          )}
        </ResourceState>
      </div>

      {openCard?.agentId && (
        <Drawer
          agentId={openCard.agentId}
          name={openCard.persona || openCard.name}
          card={openCard}
          onClose={() => navigate('/agents')}
        />
      )}

      {/* MC-86: エージェント起動モーダル */}
      {spawnTarget && (
        <SpawnModal
          agentName={spawnTarget.name}
          agentType={spawnTarget.type}
          onClose={() => setSpawnTarget(null)}
        />
      )}
    </div>
  );
}
