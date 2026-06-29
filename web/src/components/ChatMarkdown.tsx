// ChatMarkdown — 育児チャット「すくすく」のアシスタント返答用 Markdown レンダラー。
//
// アシスタント返答は生のアスタリスク（*）等を含む Markdown で返るため、react-markdown +
// remark-gfm で整形して表示する（見出し・太字・箇条書き・番号リスト・改行）。
// XSS 対策: react-markdown は既定で生 HTML を解釈しない（rehype-raw 等の HTML 許可プラグインを
// 入れない＝raw HTML は素通りでテキスト化される）。リンクは新規タブ＋rel で開く。
// スタイルは Apollo のデザインシステム（.mc-markdown の CSS 変数配色・余白）を流用する。

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MediaEmbed, parseMedia } from './mediaEmbed';

const COMPONENTS: Components = {
  // リンクが YouTube/Vimeo/画像/動画なら埋め込み表示、それ以外は新規タブ＋rel で安全に開く。
  // （remark-gfm が裸の URL も自動リンク化するため、本文に貼られた YouTube 等もここで埋め込まれる。）
  a({ href, children, ...rest }) {
    const media = parseMedia(href);
    if (media) return <MediaEmbed media={media} />;
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
  // 画像（![](url)）はレスポンシブに整形し、クリックで原寸を別タブで開く。
  img({ src, alt }) {
    if (!src || typeof src !== 'string') return null;
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
        <img src={src} alt={alt ?? '画像'} loading="lazy" className="my-2 max-h-72 max-w-full rounded-md border border-black/10 object-contain" />
      </a>
    );
  },
};

export default function ChatMarkdown({ body }: { body: string }) {
  return (
    <div className="mc-markdown mc-chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
