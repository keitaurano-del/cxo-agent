// News — 毎朝のデイリーニュースブリーフィングを表示。
// Vault の 20-Knowledge/news/daily-YYYY-MM-DD.md を読み込む。
//
// 可読性方針（MC-191）:
//  - h2（大セクション）/ h3（各トピック）に余白と視覚的区切りを入れて塊を一目で分かるように。
//  - 各 h3 トピックは ReactMarkdown では入れ子化できないため、CSS（隣接セレクタ）で
//    カード風の上余白・区切り線を表現する。
//  - **🔍 …** **🔎 …** **🔬 …** **📊 …** の段落見出しと 🟢🟡🔴 シナリオ行を callout 風に装飾。
//  - blockquote（> 本日のキーワード）はバナー風。表は罫線・横スクロール可。
//  - ```mermaid コードブロックは図解として SVG 描画（失敗時はコードのままフォールバック）。
//  - ハードコード hex 禁止（var(--mc-*) のみ）。font-size は global --font-scale を尊重（rem/em）。
import { useState, useEffect, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '../components/PageHeader';
import { Spinner, EmptyState } from '../components/ui';
import Mermaid from '../components/Mermaid';

function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** React children を素のテキストへ落とす（段落の見出し判定用）。 */
function childrenToText(children: ReactNode): string {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join('');
  if (typeof children === 'object' && 'props' in children) {
    const props = (children as { props?: { children?: ReactNode } }).props;
    return childrenToText(props?.children);
  }
  return '';
}

// なぜなぜ／シナリオ見出しの絵文字 → callout 種別色トークン。
const ANALYSIS_PREFIXES: { test: RegExp; color: string; bg: string }[] = [
  { test: /^🔍/, color: 'var(--mc-callout-info)', bg: 'var(--mc-callout-info-bg)' },
  { test: /^🔎/, color: 'var(--mc-callout-tip)', bg: 'var(--mc-callout-tip-bg)' },
  { test: /^🔬/, color: 'var(--mc-callout-note)', bg: 'var(--mc-callout-note-bg)' },
  { test: /^📊/, color: 'var(--mc-callout-warning)', bg: 'var(--mc-callout-warning-bg)' },
];

// シナリオ行（🟢 楽観 / 🟡 中立 / 🔴 悲観）→ 状態色トークン。
const SCENARIO_PREFIXES: { test: RegExp; color: string; bg: string }[] = [
  { test: /^🟢/, color: 'var(--mc-active)', bg: 'var(--mc-active-bg)' },
  { test: /^🟡/, color: 'var(--mc-idle)', bg: 'var(--mc-idle-bg)' },
  { test: /^🔴/, color: 'var(--mc-stalled)', bg: 'var(--mc-stalled-bg)' },
];

const newsComponents: Components = {
  // ```mermaid → 図解。それ以外のコードは既定。
  code(props) {
    const { className, children } = props as {
      className?: string;
      children?: ReactNode;
    };
    const match = /language-mermaid/.test(className ?? '');
    if (match) {
      return <Mermaid code={childrenToText(children)} />;
    }
    return <code className={className}>{children}</code>;
  },
  // 段落: **🔍 …** などの分析見出しで始まる段落を callout 風に。
  p({ children }) {
    const text = childrenToText(children).trim();
    const analysis = ANALYSIS_PREFIXES.find((a) => a.test.test(text));
    if (analysis) {
      return (
        <p
          className="mc-news-callout"
          style={
            { '--c': analysis.color, '--cb': analysis.bg } as React.CSSProperties
          }
        >
          {children}
        </p>
      );
    }
    return <p>{children}</p>;
  },
  // リスト項目: 🟢🟡🔴 で始まるシナリオ行を色付きチップ風に。
  li({ children }) {
    const text = childrenToText(children).trim();
    const scenario = SCENARIO_PREFIXES.find((s) => s.test.test(text));
    if (scenario) {
      return (
        <li
          className="mc-news-scenario"
          style={
            { '--c': scenario.color, '--cb': scenario.bg } as React.CSSProperties
          }
        >
          {children}
        </li>
      );
    }
    return <li>{children}</li>;
  },
};

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
          <article className="mc-news mx-auto max-w-3xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={newsComponents}>
              {body}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}
