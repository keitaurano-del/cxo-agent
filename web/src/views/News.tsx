// News — 毎朝のデイリーニュースブリーフィングを表示。
// Vault の 20-Knowledge/news/daily-YYYY-MM-DD.md を読み込む。
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '../components/PageHeader';
import { Spinner, EmptyState } from '../components/ui';

function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function News() {
  const today = formatDate(new Date());
  const [dates, setDates] = useState<string[]>([today]);
  const [selected, setSelected] = useState(today);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 過去7日分のファイル一覧を生成
  useEffect(() => {
    const arr: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push(formatDate(d));
    }
    setDates(arr);
  }, []);

  // 選択日のニュースを読み込む
  useEffect(() => {
    setLoading(true);
    setError(false);
    setContent(null);

    fetch(`/api/vault/note?path=20-Knowledge/news/daily-${selected}.md`)
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then((data: { body?: string; content?: string; text?: string }) => {
        const md = data.body ?? data.content ?? data.text ?? '';
        setContent(md);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [selected]);

  const body = content ? stripFrontmatter(content).trim() : '';

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="📰 ニュース" subtitle={`${selected} のブリーフィング`} />

      {/* 日付セレクター */}
      <div className="border-b border-border px-4 py-2 md:px-6">
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {dates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setSelected(d)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors ${
                d === selected
                  ? 'bg-surface-3 font-semibold text-text'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              {d === today ? `今日 (${d})` : d}
            </button>
          ))}
        </div>
      </div>

      {/* コンテンツ */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Spinner />
          </div>
        )}
        {!loading && error && (
          <EmptyState>
            {selected === today
              ? '今日のニュースはまだ生成されていません。毎朝 7:03 に自動生成されます。'
              : `${selected} のニュースブリーフィングが見つかりません。`}
          </EmptyState>
        )}
        {!loading && !error && body && (
          <article className="prose prose-invert prose-sm max-w-none prose-headings:font-semibold prose-h2:text-base prose-h3:text-sm prose-p:text-text-muted prose-li:text-text-muted prose-strong:text-text prose-table:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}
