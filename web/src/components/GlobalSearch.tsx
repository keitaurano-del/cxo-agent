// GlobalSearch（MC-73）— 司令塔の横断検索モーダル。
//
// 1 つの検索窓から タスク / エージェント / 会話 / workflow / Vault を横断検索する。
//   - 入力は 250ms デバウンスして /api/search?q=... を叩く。
//   - 結果はカテゴリ別に表示し、クリックで既存ビューの該当詳細へナビゲートする:
//       task         → /tasks?task=<id>&source=<source>（MC-61 TaskDetail を自動オープン）
//       agent        → /agents（該当カードの面へ）
//       conversation → /agents/<agentId>（会話ドロワーを開く）
//       workflow     → /tasks（workflow はタスク詳細内に紐づく面なのでボードへ寄せる）
//       vault        → /vault?path=<path>（該当ノートを自動オープン）
//   - 大量ヒットは server 側で各カテゴリ上限 + totals。空クエリ/0 ヒットでもクラッシュしない。
//
// デザイン制約: ハードコード hex 禁止（既存トークン/CSS 変数のみ）、UI chrome は SVG アイコンのみ、
//   文言は中立的な丁寧体、モバイル 390px で横溢れ 0。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type {
  SearchResponse,
  SearchTaskResult,
  SearchAgentResult,
  SearchConversationResult,
  SearchWorkflowResult,
  SearchVaultResult,
  TaskStatus,
} from '../lib/types';
import { projectColor, taskStatusMeta } from '../lib/meta';
import { Spinner } from './ui';
import {
  SearchIcon,
  CloseIcon,
  BoardIcon,
  UsersIcon,
  StreamIcon,
  GridIcon,
  VaultIcon,
} from './icons';

const DEBOUNCE_MS = 250;

type AnyResult =
  | SearchTaskResult
  | SearchAgentResult
  | SearchConversationResult
  | SearchWorkflowResult
  | SearchVaultResult;

interface CategoryMeta {
  key: keyof Pick<SearchResponse, 'tasks' | 'agents' | 'conversations' | 'workflows' | 'vault'>;
  label: string;
  icon: typeof SearchIcon;
}

const CATEGORIES: CategoryMeta[] = [
  { key: 'tasks', label: 'タスク', icon: BoardIcon },
  { key: 'agents', label: 'エージェント', icon: UsersIcon },
  { key: 'conversations', label: '会話', icon: StreamIcon },
  { key: 'workflows', label: 'ワークフロー', icon: GridIcon },
  { key: 'vault', label: 'Vault', icon: VaultIcon },
];

/** カテゴリ別 1 件の結果行（共通レイアウト）。クリックで onSelect。 */
function ResultRow({
  label,
  sublabel,
  snippet,
  accent,
  leading,
  onSelect,
}: {
  label: string;
  sublabel?: string;
  snippet?: string;
  accent?: string;
  leading?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-2.5 border-t border-border/60 px-3 py-2.5 text-left hover:bg-surface-3"
    >
      {accent !== undefined && (
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-sm"
          style={{ background: accent }}
          aria-hidden
        />
      )}
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-text">{label}</div>
        {sublabel && <div className="truncate text-[11px] text-text-faint">{sublabel}</div>}
        {snippet && (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-text-muted">
            {snippet}
          </div>
        )}
      </div>
    </button>
  );
}

/** カテゴリ見出し（アイコン + ラベル + 件数）。 */
function CategoryHeading({
  meta,
  shown,
  total,
}: {
  meta: CategoryMeta;
  shown: number;
  total: number;
}) {
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
      <span aria-hidden>
        <Icon width={13} height={13} />
      </span>
      {meta.label}
      <span className="text-text-muted">
        （{total > shown ? `${shown} / ${total}` : total}件）
      </span>
    </div>
  );
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 開いたら入力にフォーカス。閉じたら状態をリセット。
  useEffect(() => {
    if (open) {
      // レンダリング後にフォーカス。
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    setInput('');
    setDebounced('');
    setData(null);
    setError(null);
    setLoading(false);
    abortRef.current?.abort();
  }, [open]);

  // Esc で閉じる + 背面スクロールロック。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // 入力をデバウンス。
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(input.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [input]);

  // デバウンス済みクエリで検索。空なら結果をクリア。
  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    if (debounced === '') {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(debounced)}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as SearchResponse;
      })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced, open]);

  const go = useCallback(
    (to: string) => {
      onClose();
      navigate(to);
    },
    [navigate, onClose],
  );

  const onSelect = useCallback(
    (r: AnyResult) => {
      switch (r.type) {
        case 'task':
          go(
            `/tasks?task=${encodeURIComponent(r.id)}&source=${encodeURIComponent(r.source)}`,
          );
          break;
        case 'agent':
          go('/agents');
          break;
        case 'conversation':
          go(`/agents/${encodeURIComponent(r.agentId)}`);
          break;
        case 'workflow':
          // workflow はタスク詳細内に紐づく面。ボードへ寄せる（既存面へのフォールバック）。
          go('/tasks');
          break;
        case 'vault':
          go(`/vault?path=${encodeURIComponent(r.path)}`);
          break;
      }
    },
    [go],
  );

  const totalAll = data?.totals.all ?? 0;
  const hasQuery = debounced !== '';
  const showEmpty = hasQuery && !loading && !error && data !== null && totalAll === 0;

  const rows = useMemo(() => {
    if (!data) return null;
    return CATEGORIES.map((cat) => {
      const items = data[cat.key] as AnyResult[];
      if (items.length === 0) return null;
      const total = data.totals[cat.key];
      return (
        <section key={cat.key}>
          <CategoryHeading meta={cat} shown={items.length} total={total} />
          {items.map((r, i) => {
            if (r.type === 'task') {
              const sm = taskStatusMeta(r.status as TaskStatus);
              return (
                <ResultRow
                  key={`task-${r.id}-${i}`}
                  label={r.label}
                  sublabel={r.sublabel}
                  snippet={r.snippet}
                  accent={projectColor(r.project)}
                  leading={
                    <span
                      className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                      style={{ color: sm?.color }}
                    >
                      {sm?.label ?? r.status}
                    </span>
                  }
                  onSelect={() => onSelect(r)}
                />
              );
            }
            return (
              <ResultRow
                key={`${r.type}-${r.id}-${i}`}
                label={r.label}
                sublabel={r.sublabel}
                snippet={r.snippet}
                onSelect={() => onSelect(r)}
              />
            );
          })}
        </section>
      );
    });
  }, [data, onSelect]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex justify-center px-3 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label="横断検索"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      <div className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
        {/* 入力行 */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="text-text-faint" aria-hidden>
            <SearchIcon width={16} height={16} />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="タスク・エージェント・会話・Vault を検索"
            aria-label="横断検索の入力"
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="検索を閉じる"
            className="shrink-0 rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        {/* 結果領域 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!hasQuery && (
            <p className="px-4 py-6 text-center text-[12px] text-text-faint">
              キーワードを入力すると、タスク・エージェント・会話・ワークフロー・Vault
              を横断して検索します。
            </p>
          )}
          {hasQuery && loading && !data && (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-[12px] text-text-muted">
              <Spinner /> 検索しています…
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="px-4 py-6 text-center text-[12px]"
              style={{ color: 'var(--mc-stalled)' }}
            >
              検索に失敗しました（{error}）。
            </p>
          )}
          {showEmpty && (
            <p className="px-4 py-6 text-center text-[12px] text-text-faint">
              「{debounced}」に一致する項目はありませんでした。
            </p>
          )}
          {data && totalAll > 0 && <div>{rows}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
