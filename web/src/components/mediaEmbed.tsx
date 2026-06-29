// mediaEmbed — チャット共通のメディア埋め込み。
// URL を判定して YouTube/Vimeo は埋め込みプレーヤー、画像/動画ファイルはインライン表示する。
// 任意 iframe は通さず（YouTube/Vimeo の固定パターンのみ iframe 化）安全側に倒す。
// 画像/動画は <img>/<video> なのでスクリプト実行はない。

import type { ReactNode } from 'react';

export type Media =
  | { type: 'youtube'; src: string }
  | { type: 'vimeo'; src: string }
  | { type: 'image'; src: string }
  | { type: 'video'; src: string };

const YT = /(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d{6,})/;
const IMG_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i;
const VID_EXT = /\.(?:mp4|webm|ogg|ogv|mov|m4v)(?:[?#].*)?$/i;

/** URL からメディア種別を判定。非メディアは null。 */
export function parseMedia(url: string | undefined | null): Media | null {
  if (!url) return null;
  const yt = url.match(YT);
  if (yt) return { type: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt[1]}` };
  const vi = url.match(VIMEO);
  if (vi) return { type: 'vimeo', src: `https://player.vimeo.com/video/${vi[1]}` };
  if (IMG_EXT.test(url)) return { type: 'image', src: url };
  if (VID_EXT.test(url)) return { type: 'video', src: url };
  return null;
}

/** 1 つのメディア URL を埋め込み表示する。markdown の <p> 内でも壊れないよう外側は <span>。 */
export function MediaEmbed({ url, media }: { url?: string; media?: Media }): ReactNode {
  const m = media ?? parseMedia(url);
  if (!m) return null;

  if (m.type === 'youtube' || m.type === 'vimeo') {
    return (
      <span className="my-2 block overflow-hidden rounded-lg border border-border" style={{ position: 'relative', display: 'block', width: '100%', paddingBottom: '56.25%', height: 0 }}>
        <iframe
          src={m.src}
          title={m.type === 'youtube' ? 'YouTube' : 'Vimeo'}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </span>
    );
  }
  if (m.type === 'image') {
    return (
      <span className="my-2 block">
        <a href={m.src} target="_blank" rel="noopener noreferrer">
          <img src={m.src} alt="画像" loading="lazy" className="max-h-72 max-w-full rounded-md border border-black/10 object-contain" />
        </a>
      </span>
    );
  }
  return (
    <span className="my-2 block">
      <video src={m.src} controls preload="metadata" className="max-h-72 max-w-full rounded-md border border-black/10" />
    </span>
  );
}

const URL_RE = /https?:\/\/[^\s<>"'）)」】]+/g;

/** テキストからメディア URL を重複排除して抽出。 */
export function extractMediaUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of text.match(URL_RE) ?? []) {
    if (parseMedia(u) && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

/**
 * ユーザー発言用。素のテキスト（pre-wrap）はそのまま見せ、文中のメディア URL を下に埋め込む。
 * アシスタントは ChatMarkdown が担当（こちらは markdown 整形しない＝ユーザー入力は素テキストの方針を維持）。
 */
export function UserChatBody({ text }: { text: string }): ReactNode {
  const urls = extractMediaUrls(text);
  return (
    <span className="block">
      <span className="block whitespace-pre-wrap break-words">{text}</span>
      {urls.map((u) => (
        <MediaEmbed key={u} url={u} />
      ))}
    </span>
  );
}
