// News — 毎朝のデイリーニュースブリーフィングを表示。
// Vault の 20-Knowledge/news/daily-YYYY-MM-DD.md を読み込む。
//
// 可読性方針（MC-191 → MC-355 で調整）:
//  - h2（大セクション）/ h3（各トピック）に余白と視覚的区切りを入れて塊を一目で分かるように。
//  - 各 h3 トピックは ReactMarkdown では入れ子化できないため、CSS（隣接セレクタ）で
//    カード風の上余白・区切り線を表現する。
//  - **🔍 …** **🔎 …** **🔬 …** **📊 …** の段落見出しと 🟢🟡🔴 シナリオ行は callout 風。
//    MC-355 でベタ塗りハイライト → 淡いカード（news.css で上書き）に緩和。内容は削らない。
//  - blockquote（> 本日のキーワード）はバナー風。表は罫線・横スクロール可。
//  - ```mermaid コードブロックは図解として SVG 描画（失敗時はコードのままフォールバック）。
//  - ハードコード hex 禁止（var(--mc-*) のみ）。font-size は global --font-scale を尊重（rem/em）。
//
// MC-355 追加:
//  - 末尾の「## 📚 出典リンク一覧」セクションを markdown から切り出してリンクカード風に描画
//    （旧号にはセクションが無い → 単に描画されないだけで壊れない）。
//  - 本文のテキスト選択 → 「🔍 深掘り」フローティングボタン → POST /api/news/deepdive
//    （Gemini + Google Search）で平易な解説＋関連リンクをポップアップ表示。
import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '../components/PageHeader';
import { Spinner, EmptyState } from '../components/ui';
import { ExpandIcon, CloseIcon, LinkIcon } from '../components/icons';
import Mermaid from '../components/Mermaid';
import './news.css';

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

// ─── 出典リンク一覧（## 📚 …）の切り出し（MC-355） ─────────────────────────

interface SourceLink {
  media: string; // 「媒体名: タイトル」の媒体名部分（無ければ空）
  title: string;
  url: string;
  note: string; // 「— 補足」部分
}
interface SourceGroup {
  label: string; // グループ見出し（### … や **…**）。先頭グループは空のことがある
  links: SourceLink[];
}

/** 「- [媒体名: タイトル](URL) — 補足」形式のリンク行をパースする。 */
function parseSourceLine(line: string): SourceLink | null {
  const m = line.match(/^\s*[-*]\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(?:[—–―-]\s*(.*))?$/);
  if (!m) return null;
  const label = m[1].trim();
  // 「媒体名: タイトル」を分離（全角/半角コロン両対応。無ければ全体をタイトル扱い）
  const sep = label.match(/^([^:：]{1,25})[:：]\s*(.+)$/);
  return {
    media: sep ? sep[1].trim() : '',
    title: sep ? sep[2].trim() : label,
    url: m[2],
    note: (m[3] ?? '').trim(),
  };
}

/**
 * 本文から「## 📚 出典リンク一覧」セクションを切り出し、残り本文とリンク群に分ける。
 * セクションが無い（旧号）またはリンクが 1 件もパースできない場合は body をそのまま返す。
 */
function splitSources(md: string): { main: string; groups: SourceGroup[] } {
  const headMatch = md.match(/^##\s*📚[^\n]*$/m);
  if (!headMatch || headMatch.index == null) return { main: md, groups: [] };
  const start = headMatch.index;
  const after = md.slice(start + headMatch[0].length);
  const nextH2 = after.search(/^##\s/m);
  const section = nextH2 >= 0 ? after.slice(0, nextH2) : after;
  const rest = md.slice(0, start) + (nextH2 >= 0 ? after.slice(nextH2) : '');

  const groups: SourceGroup[] = [];
  let cur: SourceGroup = { label: '', links: [] };
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line || line === '---') continue;
    const link = parseSourceLine(line);
    if (link) {
      cur.links.push(link);
      continue;
    }
    // リンク以外の行はグループ見出しとして扱う（### … / **…** / プレーン文）
    const label = line.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
    if (cur.links.length > 0 || cur.label) groups.push(cur);
    cur = { label, links: [] };
  }
  if (cur.links.length > 0 || cur.label) groups.push(cur);

  const total = groups.reduce((n, g) => n + g.links.length, 0);
  if (total === 0) return { main: md, groups: [] }; // パース不能 → 通常 markdown 描画に任せる
  return { main: rest.trimEnd(), groups: groups.filter((g) => g.links.length > 0) };
}

/** 出典リンク一覧をリンクカード風リストで描画する。 */
function SourcesSection({ groups }: { groups: SourceGroup[] }) {
  return (
    <section className="mc-news-sources" aria-label="出典リンク一覧">
      <h2 className="mc-news-sources-title">📚 出典リンク一覧</h2>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.label && <div className="mc-news-sources-group">{g.label}</div>}
          <ul className="mc-news-sources-list">
            {g.links.map((l, li) => (
              <li key={li} className="mc-news-source-item">
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.media && <span className="mc-news-source-media">{l.media}</span>}
                  {l.title}
                  {l.note && <span className="mc-news-source-note">{l.note}</span>}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ─── 深掘り（選択テキスト → Gemini 解説）（MC-355） ────────────────────────

/** 選択確定時に保持する情報。fab はこの座標（viewport 基準）に出す。 */
interface DiveSelection {
  text: string;
  context: string; // 直前の見出しテキスト（グラウンディング用）
  x: number;
  y: number;
}
interface DiveResult {
  explanation: string;
  links: { title: string; url: string }[];
}

/** 選択範囲の開始位置から、記事内で直前にある見出し（h1〜h4）のテキストを探す。 */
function findNearestHeading(range: Range, root: HTMLElement): string {
  const node = range.startContainer;
  let el: Element | null = node instanceof Element ? node : node.parentElement;
  while (el && el !== root) {
    let sib: Element | null = el.previousElementSibling;
    while (sib) {
      if (/^H[1-4]$/.test(sib.tagName)) return (sib.textContent ?? '').trim();
      sib = sib.previousElementSibling;
    }
    el = el.parentElement;
  }
  return '';
}

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

  // 深掘り: 選択情報（fab 表示）とポップアップの状態
  const articleRef = useRef<HTMLElement | null>(null);
  const [dive, setDive] = useState<DiveSelection | null>(null);
  const [diveOpen, setDiveOpen] = useState(false);
  const [diveQuote, setDiveQuote] = useState(''); // ポップアップに出す「選択したテキスト」
  const [diveLoading, setDiveLoading] = useState(false);
  const [diveResult, setDiveResult] = useState<DiveResult | null>(null);
  const [diveError, setDiveError] = useState<string | null>(null);
  // 没入モードの Esc ハンドラから「ポップアップが開いているか」を参照するための ref
  const diveOpenRef = useRef(false);
  diveOpenRef.current = diveOpen;

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
      // 深掘りポップアップが開いている間の Esc はそちらの close に譲る
      if (e.key === 'Escape' && !diveOpenRef.current) setImmersive(false);
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

  // ─── 深掘り: 選択監視（PC のドラッグ選択・モバイルの長押し選択の両対応） ──
  // selectionchange は連発するため rAF でまとめ、mouseup / touchend / スクロールでも
  // 位置を追従更新する。記事外の選択・空選択・ポップアップ表示中は fab を出さない。
  useEffect(() => {
    let raf = 0;
    const update = () => {
      if (diveOpenRef.current) return; // ポップアップ表示中は選択追従しない
      const root = articleRef.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setDive(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        setDive(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setDive(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setDive(null);
        return;
      }
      // fab は選択範囲の下・viewport 内にクランプ。下に収まらなければ上へ。
      const x = Math.min(Math.max(rect.left + rect.width / 2, 72), window.innerWidth - 72);
      const below = rect.bottom + 10;
      const y = below + 44 > window.innerHeight ? Math.max(rect.top - 44, 8) : below;
      setDive({
        text: text.slice(0, 500), // 長すぎる選択は先頭500字に切る
        context: findNearestHeading(range, root).slice(0, 200),
        x,
        y,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('mouseup', schedule);
    document.addEventListener('touchend', schedule);
    // 本文スクロールで fab がずれるため追従（capture でスクロールコンテナも拾う）
    document.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('mouseup', schedule);
      document.removeEventListener('touchend', schedule);
      document.removeEventListener('scroll', schedule, true);
    };
  }, []);

  // 深掘り実行: ポップアップを開いて API を呼ぶ。失敗時は日本語メッセージを表示。
  const startDeepdive = useCallback((sel: DiveSelection) => {
    setDiveOpen(true);
    setDiveQuote(sel.text);
    setDiveLoading(true);
    setDiveResult(null);
    setDiveError(null);
    setDive(null); // fab は隠す
    fetch('/api/news/deepdive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sel.text, context: sel.context }),
    })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as Partial<DiveResult> & {
          error?: string;
        };
        if (!r.ok || !json.explanation) {
          throw new Error(json.error || '深掘りに失敗しました。時間をおいてもう一度お試しください。');
        }
        setDiveResult({
          explanation: json.explanation,
          links: Array.isArray(json.links) ? json.links : [],
        });
      })
      .catch((e: unknown) => {
        setDiveError(e instanceof Error ? e.message : '深掘りに失敗しました。');
      })
      .finally(() => setDiveLoading(false));
  }, []);

  const closeDive = useCallback(() => {
    setDiveOpen(false);
    setDiveResult(null);
    setDiveError(null);
  }, []);

  // ポップアップ表示中は Esc で閉じる
  useEffect(() => {
    if (!diveOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDive();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [diveOpen, closeDive]);

  const body = content ? stripFrontmatter(content).trim() : '';

  // 出典リンク一覧（## 📚 …）を本文から切り出す（旧号は sources が空のまま）。
  const { main: mainBody, groups: sourceGroups } = useMemo(() => splitSources(body), [body]);

  // 検索クエリがあれば、見出し（# 行）区切りのセクションのうち一致するものだけ残す。
  const filteredBody = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !mainBody) return mainBody;
    const lines = mainBody.split('\n');
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
  }, [mainBody, query]);

  const noMatch = query.trim() !== '' && body !== '' && filteredBody === '';
  const hasArticle = !loading && !error && body !== '' && !noMatch;

  // 読み込み中・記事なしになったら没入を自動解除（日付切替や検索でゼロ件になった場合）。
  useEffect(() => {
    if (immersive && !hasArticle) setImmersive(false);
  }, [immersive, hasArticle]);

  // 記事本文（通常表示と没入表示で共通）。同時に 1 箇所しか描画されないため ref を共有できる。
  const article = (
    <article className="mc-news mx-auto max-w-3xl" ref={articleRef}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={newsComponents}>
        {filteredBody}
      </ReactMarkdown>
      {/* 出典リンク一覧 — 検索絞り込み中は本文と対応しないため非表示 */}
      {sourceGroups.length > 0 && query.trim() === '' && (
        <SourcesSection groups={sourceGroups} />
      )}
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

      {/* 深掘り: 選択テキスト近くのフローティングボタン */}
      {dive && !diveOpen && (
        <button
          type="button"
          className="mc-deepdive-fab"
          style={{ left: dive.x, top: dive.y }}
          // mousedown で選択が解除される（→ fab が消える）のを防ぐ
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => startDeepdive(dive)}
        >
          🔍 深掘り
        </button>
      )}

      {/* 深掘り: ポップアップ（PC=中央モーダル / 狭い画面=ボトムシート。news.css 参照） */}
      {diveOpen && (
        <div
          className="mc-deepdive-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="選択テキストの深掘り"
          onClick={closeDive}
        >
          <div className="mc-deepdive-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mc-deepdive-head">
              <span>🔍 深掘り</span>
              <button
                type="button"
                className="mc-deepdive-close"
                onClick={closeDive}
                aria-label="深掘りを閉じる"
              >
                <CloseIcon width={16} height={16} aria-hidden />
              </button>
            </div>
            <div className="mc-deepdive-body">
              {diveQuote && <p className="mc-deepdive-quote">{diveQuote}</p>}
              {diveLoading && (
                <div className="mc-deepdive-status">
                  <Spinner />
                  <span>調べています…（Webで裏取り中）</span>
                </div>
              )}
              {!diveLoading && diveError && (
                <div className="mc-deepdive-error">{diveError}</div>
              )}
              {!diveLoading && diveResult && (
                <>
                  <p className="mc-deepdive-text">{diveResult.explanation}</p>
                  {diveResult.links.length > 0 && (
                    <div className="mc-deepdive-links">
                      <p className="mc-deepdive-links-title">🔗 もっと知りたい場合はこちら</p>
                      <ul>
                        {diveResult.links.map((l, i) => (
                          <li key={i}>
                            <a href={l.url} target="_blank" rel="noopener noreferrer">
                              {l.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
