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
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '../components/PageHeader';
import { Spinner, EmptyState } from '../components/ui';
import { ExpandIcon, CloseIcon, LinkIcon } from '../components/icons';
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
  // メニュー内検索（この日のブリーフィングに限定）。見出し区切りのセクション単位で絞り込む。
  const [query, setQuery] = useState('');
  // 没入（全画面）モード。ON で周辺 chrome を隠し、記事本文だけを viewport いっぱいに表示する。
  const [immersive, setImmersive] = useState(false);

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

  // 没入モード中は body にスクロールロックを掛け、Esc / Android バックで閉じられるようにする。
  // 解除時（およびアンマウント時）にロック class と history state を確実に戻す。
  useEffect(() => {
    if (!immersive) return;
    const { body } = document;
    body.classList.add('mc-news-immersive-lock');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImmersive(false);
    };
    // Android のバック（戻る）で閉じる: history に1段積み、popstate で没入解除する。
    const onPopState = () => setImmersive(false);
    window.history.pushState({ newsImmersive: true }, '');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);

    return () => {
      body.classList.remove('mc-news-immersive-lock');
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      // 自前で積んだ history state が残っていれば戻す（バック以外で閉じた場合）。
      if (window.history.state?.newsImmersive) window.history.back();
    };
  }, [immersive]);

  const body = content ? stripFrontmatter(content).trim() : '';

  // 検索クエリがあれば、見出し（# 行）区切りのセクションのうち一致するものだけ残す。
  const filteredBody = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !body) return body;
    const lines = body.split('\n');
    const sections: string[][] = [];
    let cur: string[] = [];
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line) && cur.length > 0) {
        sections.push(cur);
        cur = [];
      }
      cur.push(line);
    }
    if (cur.length > 0) sections.push(cur);
    const hits = sections.filter((s) => s.join('\n').toLowerCase().includes(q));
    return hits.map((s) => s.join('\n')).join('\n\n');
  }, [body, query]);

  const noMatch = query.trim() !== '' && body !== '' && filteredBody === '';
  const hasArticle = !loading && !error && body !== '' && !noMatch;

  // 読み込み中・記事なしになったら没入を自動解除（日付切替や検索でゼロ件になった場合）。
  useEffect(() => {
    if (immersive && !hasArticle) setImmersive(false);
  }, [immersive, hasArticle]);

  // 記事本文（通常表示と没入表示で共通）。
  const article = (
    <article className="mc-news mx-auto max-w-3xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={newsComponents}>
        {filteredBody}
      </ReactMarkdown>
    </article>
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="📰 ニュース"
        subtitle={`${selected} のブリーフィング`}
        right={
          <a
            href="https://gikai.team-mir.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <LinkIcon width={13} height={13} aria-hidden />
            みらい会議
          </a>
        }
      />

      {/* 日付セレクター */}
      <div className="border-b border-border px-4 py-2 md:px-6">
        <div className="flex items-center gap-2">
          <div className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
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
          {/* 全画面（没入）トグル: 記事があるときだけ表示。周辺 chrome を隠して本文に集中できる。 */}
          {hasArticle && (
            <button
              type="button"
              onClick={() => setImmersive(true)}
              aria-label="全画面で読む"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
            >
              <ExpandIcon width={14} height={14} aria-hidden />
              <span>全画面</span>
            </button>
          )}
        </div>
        {/* メニュー内検索（この日のブリーフィングをセクション単位で絞り込む） */}
        <label className="mt-2 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
          <span className="text-text-faint" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="このニュースを検索（見出し単位で絞り込み）"
            aria-label="ニュース内を検索"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-faint"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="検索をクリア"
              className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-3 hover:text-text"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </label>
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
        {!loading && !error && body && noMatch && (
          <EmptyState>「{query.trim()}」に一致するセクションはありませんでした。</EmptyState>
        )}
        {hasArticle && !immersive && article}
      </div>

      {/* 没入（全画面）オーバーレイ — 周辺 chrome を隠して本文だけを viewport いっぱいに表示 */}
      {hasArticle && immersive && (
        <div
          className="mc-news-immersive"
          role="dialog"
          aria-modal="true"
          aria-label={`${selected} のニュース（全画面表示）`}
        >
          <button
            type="button"
            onClick={() => setImmersive(false)}
            aria-label="全画面を閉じる"
            className="mc-news-immersive-close"
          >
            <CloseIcon width={16} height={16} aria-hidden />
            <span>閉じる</span>
          </button>
          <div className="mc-news-immersive-scroll">{article}</div>
        </div>
      )}
    </div>
  );
}
