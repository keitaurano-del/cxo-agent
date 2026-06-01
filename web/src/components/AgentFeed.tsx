// 個別エージェントの会話タイムライン。/api/agents/:id/feed を取得して時系列表示。
// 長文は折り畳み。重さ対策として末尾（最新）から上位 N 件に制限する。
import { useEffect, useRef, useState } from 'react';
import type { FeedItem } from '../lib/types';
import { absoluteTime, relativeTime } from '../lib/time';
import { Spinner } from './ui';

const MAX_ITEMS = 120; // 仮想化なしでも破綻しない上限（最新側を残す）。
const FOLD_LEN = 280;

interface FeedResponse {
  agentId: string;
  feed: FeedItem[];
}

const ROLE_LABEL: Record<FeedItem['role'], string> = {
  user: '指示 / ユーザー',
  assistant: 'エージェント',
  tool: 'ツール結果',
  system: 'システム',
};

function roleColor(role: FeedItem['role']): string {
  switch (role) {
    case 'user':
      return 'var(--mc-accent)';
    case 'assistant':
      return 'var(--mc-active)';
    case 'tool':
      return 'var(--mc-idle)';
    default:
      return 'var(--mc-text-faint)';
  }
}

/** クリップボードコピーボタン。成功時 1.5 秒間「コピー完了」色でフィードバック。 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="メッセージをコピー"
      title={copied ? 'コピー完了' : 'コピー'}
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors
        md:opacity-0 md:group-hover:opacity-100
        ${copied ? 'text-[color:var(--mc-active)]' : 'text-text-faint hover:text-text'}`}
    >
      {copied ? '✓' : 'copy'}
    </button>
  );
}

function FeedEntry({ item }: { item: FeedItem }) {
  const [expanded, setExpanded] = useState(false);
  const long = item.text.length > FOLD_LEN;
  const shown = long && !expanded ? item.text.slice(0, FOLD_LEN) + '…' : item.text;
  // コピー対象は展開の有無に関係なく全文。
  const fullText = item.text;
  return (
    <li className="group border-l-2 pl-3" style={{ borderColor: roleColor(item.role) }}>
      <div className="mb-0.5 flex items-center gap-2 text-[11px]">
        <span className="font-semibold" style={{ color: roleColor(item.role) }}>
          {ROLE_LABEL[item.role]}
        </span>
        {item.kind === 'tool_use' && item.toolName && (
          <span className="rounded bg-surface-3 px-1.5 py-0.5 text-text-muted">
            {item.toolName}
          </span>
        )}
        <span className="text-text-faint" title={absoluteTime(item.ts)}>
          {relativeTime(item.ts)}
        </span>
        <CopyButton text={fullText} />
      </div>
      <div className="select-text whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text">
        {shown}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-accent hover:underline"
        >
          {expanded ? '折りたたむ' : 'すべて表示'}
        </button>
      )}
    </li>
  );
}

export function AgentFeed({ agentId }: { agentId: string }) {
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFeed(null);
    fetch(`/api/agents/${encodeURIComponent(agentId)}/feed`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as FeedResponse;
      })
      .then((d) => {
        if (!cancelled) setFeed(d.feed ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-text-muted">
        <Spinner />
        会話を取得しています…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--mc-stalled)' }} role="alert">
        会話の取得に失敗しました（{error}）。
      </div>
    );
  }
  if (!feed || feed.length === 0) {
    return <div className="p-4 text-sm text-text-faint">表示できる会話がありません。</div>;
  }

  const items = feed.slice(-MAX_ITEMS);
  const truncated = feed.length > MAX_ITEMS;

  return (
    <div>
      {truncated && (
        <div className="mb-3 text-[11px] text-text-faint">
          全 {feed.length} 件のうち、最新 {MAX_ITEMS} 件を表示しています。
        </div>
      )}
      <ol className="space-y-3">
        {items.map((item, i) => (
          <FeedEntry key={`${item.ts}-${i}`} item={item} />
        ))}
      </ol>
    </div>
  );
}
