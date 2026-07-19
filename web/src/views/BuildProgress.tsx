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
import { ResourceState, EmptyState, Badge, StatusDot } from '../components/ui';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import { agentStatusMeta, projectLabel } from '../lib/meta';
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

/** 稼働中エージェントを「移乗先」候補として並べ替える（新しい活動が上）。 */
function byRecent(a: AgentSummary, b: AgentSummary): number {
  return Date.parse(b.lastActivity || '') - Date.parse(a.lastActivity || '');
}

export default function BuildProgress(): JSX.Element {
  // 表示モード。既定は「稼働中」（従来どおりのライブ表示）。
  const [mode, setMode] = useState<ViewMode>('active');

  const tick = useLiveTick('agents');
  // 'active' は稼働中のみ（軽量）／'all' は status 絞り込み無しで全ステータスを取得。
  const agentsRes = useLiveResource<{ agents: AgentSummary[] }>(
    mode === 'active' ? '/api/agents?status=active' : '/api/agents',
    tick,
  );

  const agents = useMemo(
    () => [...(agentsRes.data?.agents ?? [])].sort(byRecent),
    [agentsRes.data],
  );

  // 選択中エージェント。既定は最も直近に動いたエージェント（稼働中モードは最新 active、
  // すべてモードは active 優先・無ければ最新の過去。byRecent 済みなので先頭を採ればよい）。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const defaultAgent = useMemo(
    () => agents.find((a) => a.status === 'active') ?? agents[0] ?? null,
    [agents],
  );
  const selected = useMemo(
    () => agents.find((a) => a.agentId === selectedId) ?? defaultAgent,
    [agents, selectedId, defaultAgent],
  );
  // 選択が一覧から消えた（完了・モード切替で対象外化）ら既定選択へ寄せ、空表示を防ぐ。
  useEffect(() => {
    if (selectedId && !agents.some((a) => a.agentId === selectedId)) setSelectedId(null);
  }, [agents, selectedId]);

  const feedRes = useLiveResource<{ feed: FeedItem[] }>(
    // 未選択時は 404 を避けるため有効な軽量エンドポイントへ（feed は空になるだけ）。
    selected ? `/api/agents/${encodeURIComponent(selected.agentId)}/feed` : '/api/agents?status=active',
    tick,
  );

  // モード切替トグル（PageHeader 右に置く。稼働中モードでは「リアルタイム」バッジも併置）。
  const MODE_TABS: { value: ViewMode; label: string }[] = [
    { value: 'active', label: '稼働中' },
    { value: 'all', label: 'すべて（過去含む）' },
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

  const loading = agentsRes.loading || feedRes.loading;
  const error = agentsRes.error ?? feedRes.error;
  const hasData = agentsRes.data != null;
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
        <ResourceState loading={loading} error={error} hasData={hasData}>
          {agents.length === 0 ? (
            mode === 'all' ? (
              <EmptyState>
                表示できる履歴がありません。
                <br />
                （履歴は直近 7 日分のみ保持されます。）
              </EmptyState>
            ) : (
              <EmptyState>
                いまバックエンドで動いている実装作業はありません。
                <br />
                作業をエージェントに移乗すると、ここに生の進捗が流れます。
              </EmptyState>
            )
          ) : (
            <>
              {/* 移乗先セレクタ。稼働中モードは複数同時稼働のときだけ。
                  すべてモードは過去も含めて選べるよう常に出す（1件でも状態・時刻の文脈を出す）。 */}
              {(agents.length > 1 || mode === 'all') && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {agents.map((a) => {
                    const on = a.agentId === (selected?.agentId ?? '');
                    const isActive = a.status === 'active';
                    return (
                      <button
                        key={a.agentId}
                        type="button"
                        onClick={() => setSelectedId(a.agentId)}
                        className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                        style={{
                          borderColor: on ? 'var(--mc-active)' : 'var(--mc-border)',
                          background: on ? 'var(--mc-active-bg)' : 'var(--mc-surface)',
                          // 非稼働（過去）は全体をやや減光して稼働中と区別する。
                          color: isActive ? 'var(--mc-text)' : 'var(--mc-text-muted)',
                        }}
                      >
                        {isActive ? (
                          // 稼働中は従来の緑パルスドット。
                          <span className="inline-block h-2 w-2 rounded-full mc-pulse" style={{ background: 'var(--mc-active)' }} aria-hidden />
                        ) : (
                          // 過去（idle/done/never）はパルス無しの StatusDot（状態色のみ・語ラベルは下に併記）。
                          <StatusDot status={a.status} withLabel={false} />
                        )}
                        <span className="font-medium">{a.subagentType}</span>
                        {a.description && (
                          <span className="max-w-[10rem] truncate text-text-faint">{a.description}</span>
                        )}
                        {/* すべてモードでは状態ラベルと最終活動の相対時刻を添える。 */}
                        {mode === 'all' && (
                          <span className="whitespace-nowrap text-text-faint">
                            {agentStatusMeta(a.status).label}・{relativeTime(a.lastActivity)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {selected && (
                <>
                  {/* フェーズ見出しカード（＝いま何をしているか）。 */}
                  <div className="mb-3 rounded-xl border border-border bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-text">🛰 {selected.subagentType}</span>
                      <Badge>{selected.projectLabel || projectLabel(selected.project)}</Badge>
                      <StatusDot status={selected.status} />
                      {selected.currentTaskId && <Badge title="担当タスク">{selected.currentTaskId}</Badge>}
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

                  <div className="mt-4 text-center text-[11px] text-text-faint">
                    Apollo / live progress — バックエンドエージェントの生の作業を表示しています
                  </div>
                </>
              )}
            </>
          )}
        </ResourceState>
      </div>
    </div>
  );
}
