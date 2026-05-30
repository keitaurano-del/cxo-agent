// Obsidian 記法対応の markdown レンダラー。
//
// react-markdown + remark-gfm に加え:
//  - wikilink（[[...]]）→ クリックでビュー内遷移（onNavigate）。未解決は淡色・非クリック。
//  - embed 画像（![[img.png]]）/ 通常画像 → /api/vault/attachment 経由。
//  - callout（> [!info] ...）→ 種別色付きブロック。
//  - コードブロック・テーブル・チェックボックスは remark-gfm。

import { useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  preprocessObsidian,
  parseWikilinkHref,
  resolveImageSrc,
  detectCallout,
  type LinkResolver,
} from '../lib/obsidian';
import { LinkIcon } from './icons';

interface Props {
  body: string;
  /** wikilink target → 解決済み vault 相対パス（null = 未解決）。 */
  resolveLink: LinkResolver;
  /** ノート内リンクのクリック遷移。 */
  onNavigate: (path: string) => void;
}

/** React children を素のテキストへ落とす（callout 1 行目判定用）。 */
function childrenToText(children: ReactNode): string {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join('');
  if (typeof children === 'object' && children !== null && 'props' in children) {
    const props = (children as { props?: { children?: ReactNode } }).props;
    return childrenToText(props?.children);
  }
  return '';
}

export default function ObsidianMarkdown({ body, resolveLink, onNavigate }: Props) {
  const processed = useMemo(() => preprocessObsidian(body), [body]);

  const components: Components = useMemo(
    () => ({
      a({ href, children, ...rest }) {
        const wikilinkTarget = parseWikilinkHref(href);
        if (wikilinkTarget !== null) {
          const resolved = resolveLink(wikilinkTarget);
          if (resolved) {
            return (
              <button
                type="button"
                className="mc-wikilink"
                onClick={() => onNavigate(resolved)}
                title={resolved}
              >
                {children}
              </button>
            );
          }
          // 未解決リンク（淡色・非クリック）。
          return (
            <span className="mc-wikilink-unresolved" title="未解決のリンク">
              {children}
            </span>
          );
        }
        // 外部/通常リンクは新規タブ + rel。
        const external = !!href && /^https?:\/\//.test(href);
        return (
          <a
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            {...rest}
          >
            {children}
          </a>
        );
      },
      img({ src, alt, ...rest }) {
        const realSrc = resolveImageSrc(typeof src === 'string' ? src : undefined);
        // 相対パス（./ や 99-Attachments/...）も attachment 経由に寄せる。
        const finalSrc =
          realSrc && !/^https?:\/\//.test(realSrc) && !realSrc.startsWith('/api/')
            ? `/api/vault/attachment?path=${encodeURIComponent(realSrc)}`
            : realSrc;
        return <img src={finalSrc} alt={alt ?? ''} loading="lazy" {...rest} />;
      },
      blockquote({ children }) {
        // 先頭の段落テキストで callout 判定。
        const text = childrenToText(children);
        const firstLine = text.split('\n')[0] ?? '';
        const callout = detectCallout(firstLine);
        if (callout) {
          // callout タイトル行を本文から取り除いて表示する。
          return (
            <div
              className="mc-callout"
              style={
                {
                  '--mc-callout-color': callout.color,
                  '--mc-callout-bg': callout.bg,
                } as React.CSSProperties
              }
              role="note"
            >
              <div className="mc-callout-title">
                <LinkIcon width={13} height={13} aria-hidden />
                {callout.title}
              </div>
              <div className="mc-callout-body">
                <CalloutBody>{children}</CalloutBody>
              </div>
            </div>
          );
        }
        return <blockquote>{children}</blockquote>;
      },
    }),
    [resolveLink, onNavigate],
  );

  return (
    <div className="mc-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}

/**
 * callout 本文から「[!type] title」を含む先頭行だけ除いて残りを表示する。
 * react-markdown は blockquote 配下を <p> 等で渡すため、最初の段落テキストの
 * callout マーカー部分を除去する。簡易のため先頭 [!...] トークンを潰す。
 */
function CalloutBody({ children }: { children: ReactNode }): ReactNode {
  // 先頭の段落から `[!type] title` 行を取り除く。
  if (Array.isArray(children)) {
    let removedFirst = false;
    return children.map((child, i) => {
      if (!removedFirst && isMarkerParagraph(child)) {
        removedFirst = true;
        const rest = stripMarkerLine(child);
        return rest ? <span key={i}>{rest}</span> : null;
      }
      return <span key={i}>{child}</span>;
    });
  }
  return children;
}

function isMarkerParagraph(child: ReactNode): boolean {
  const text = childrenToText(child);
  return /^\s*\[!([A-Za-z]+)\]/.test(text);
}

/** マーカー行（[!type] title）を除いた残りテキストを返す。複数行 callout の 2 行目以降を保持。 */
function stripMarkerLine(child: ReactNode): string {
  const text = childrenToText(child);
  const lines = text.split('\n');
  return lines.slice(1).join('\n').trim();
}
