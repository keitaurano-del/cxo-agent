// codeHighlight — 依存ライブラリ無しの軽量シンタックスハイライト（MC-236）。
//
// バンドル肥大を避けるため shiki/prism 等は使わず、拡張子で言語を大別して
// 文字列・コメント・数値・キーワードを正規表現でトークン化して <span> に色を付ける。
// Quick Look プレビュー用途なので完璧な構文解析は狙わない（読みやすさ向上が目的）。
// 配色は CSS 変数 --mc-* を使う（テーマ追従）。

import type { ReactNode } from 'react';

type Lang = 'code' | 'json' | 'markup' | 'plain';

const CODE_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.cc', '.hpp',
  '.cs', '.php', '.swift', '.sh', '.bash', '.zsh', '.sql', '.css', '.scss', '.less',
]);
const JSON_EXTS = new Set(['.json']);
const MARKUP_EXTS = new Set(['.html', '.htm', '.xml', '.svg', '.vue']);

/** 拡張子から大別した言語種別を返す。ハイライト非対象は 'plain'。 */
export function detectLang(ext: string): Lang {
  const e = ext.toLowerCase();
  if (CODE_EXTS.has(e)) return 'code';
  if (JSON_EXTS.has(e)) return 'json';
  if (MARKUP_EXTS.has(e)) return 'markup';
  return 'plain';
}

/** この拡張子をハイライト対象とするか（plain は対象外＝そのまま表示）。 */
export function isHighlightable(ext: string): boolean {
  return detectLang(ext) !== 'plain';
}

// 主要言語横断のキーワード集合（過剰検出しても色が付くだけで害はない）。
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'implements',
  'import', 'export', 'from', 'as', 'default', 'try', 'catch', 'finally', 'throw',
  'async', 'await', 'yield', 'typeof', 'instanceof', 'in', 'of', 'this', 'super',
  'true', 'false', 'null', 'undefined', 'void', 'delete', 'public', 'private',
  'protected', 'static', 'readonly', 'interface', 'type', 'enum', 'namespace',
  'def', 'lambda', 'pass', 'elif', 'and', 'or', 'not', 'None', 'True', 'False',
  'func', 'package', 'struct', 'fn', 'let', 'mut', 'pub', 'use', 'impl', 'self',
  'select', 'where', 'group', 'order', 'by', 'insert', 'update', 'delete', 'from',
]);

type Token = { text: string; cls: string | null };

// トークン色（Tailwind の任意色クラスでなく CSS 変数で配色＝テーマ追従）。
const COLORS = {
  comment: 'var(--mc-text-faint)',
  string: 'var(--mc-active)',
  number: 'var(--mc-accent)',
  keyword: 'var(--mc-callout-warning)',
  tag: 'var(--mc-accent)',
} as const;

// 共通トークナイザ（行コメント // と #、ブロックコメント /* */、文字列、数値、識別子）。
const TOKEN_RE =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.eExXa-fA-F]*\b)|([A-Za-z_$][A-Za-z0-9_$]*)/g;

function tokenizeCode(src: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), cls: null });
    if (m[1] !== undefined) out.push({ text: m[1], cls: COLORS.comment });
    else if (m[2] !== undefined) out.push({ text: m[2], cls: COLORS.string });
    else if (m[3] !== undefined) out.push({ text: m[3], cls: COLORS.number });
    else if (m[4] !== undefined)
      out.push({ text: m[4], cls: KEYWORDS.has(m[4]) ? COLORS.keyword : null });
    last = TOKEN_RE.lastIndex;
  }
  if (last < src.length) out.push({ text: src.slice(last), cls: null });
  return out;
}

// JSON は文字列キー/値・数値・true/false/null だけ色付け（キーワード集合を流用）。
const JSON_RE = /("(?:\\.|[^"\\])*")|(\b-?\d[\d.eE+-]*\b)|\b(true|false|null)\b/g;

function tokenizeJson(src: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  JSON_RE.lastIndex = 0;
  while ((m = JSON_RE.exec(src)) !== null) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), cls: null });
    if (m[1] !== undefined) out.push({ text: m[1], cls: COLORS.string });
    else if (m[2] !== undefined) out.push({ text: m[2], cls: COLORS.number });
    else if (m[3] !== undefined) out.push({ text: m[3], cls: COLORS.keyword });
    last = JSON_RE.lastIndex;
  }
  if (last < src.length) out.push({ text: src.slice(last), cls: null });
  return out;
}

// マークアップはタグ名と属性値（文字列）を色付け。
const MARKUP_RE = /(<\/?[A-Za-z][\w:-]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(<!--[\s\S]*?-->)/g;

function tokenizeMarkup(src: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MARKUP_RE.lastIndex = 0;
  while ((m = MARKUP_RE.exec(src)) !== null) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), cls: null });
    if (m[1] !== undefined) out.push({ text: m[1], cls: COLORS.tag });
    else if (m[2] !== undefined) out.push({ text: m[2], cls: COLORS.string });
    else if (m[3] !== undefined) out.push({ text: m[3], cls: COLORS.comment });
    last = MARKUP_RE.lastIndex;
  }
  if (last < src.length) out.push({ text: src.slice(last), cls: null });
  return out;
}

/**
 * コード/テキストをトークン化し、色付き React ノードの配列を返す。
 * plain（非対応拡張子）や巨大ファイルは素のテキスト 1 ノードで返す（性能保護）。
 */
export function highlightCode(src: string, ext: string): ReactNode[] {
  const lang = detectLang(ext);
  // 大きすぎるファイルはハイライトせず素返し（正規表現走査の負荷回避）。
  if (lang === 'plain' || src.length > 200_000) return [src];
  const tokens =
    lang === 'json' ? tokenizeJson(src) : lang === 'markup' ? tokenizeMarkup(src) : tokenizeCode(src);
  return tokens.map((t, i) =>
    t.cls ? (
      <span key={i} style={{ color: t.cls }}>
        {t.text}
      </span>
    ) : (
      t.text
    ),
  );
}
