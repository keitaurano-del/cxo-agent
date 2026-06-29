// chatMedia — チャット共通の「アシスタント側メディア返却」後処理層（ドメイン非依存）。
//
// 育児チャット「すくすく」で実装したメディア後処理（childcareMedia.ts）を、茶事・Work など
// 他のチャットからも流用できるよう汎用化したモジュール。claude -p はテキストしか返さないので、
// 各チャットには所定のディレクティブ構文でメディア提案を出させ、この層がそれを解析して
// 「実在検証 / 生成 / 取り込み」を行い、成功したものだけを assistant メッセージの media[] に
// 確定する。本文からはディレクティブ記法を除去し自然文だけ残す。
//
// 捏造防止が最重要（childcare と同じ思想・全チャット共通）:
//   - YouTube: oEmbed（GET https://www.youtube.com/oembed?...）が 200+JSON を返すものだけ採用。
//     404/失敗（捏造・限定公開・削除済み）は捨てる。埋め込みは youtube-nocookie。
//   - Web 画像: URL を GET して 200 かつ content-type image/* かつサイズ上限内、さらに信頼ホスト
//     許可リスト内のものだけ採用。検証できた画像はサーバへ取り込み自前配信（hotlink/privacy 回避）、
//     出典 URL はキャプション/リンクで帰属表示。検証 NG は捨てる。
//   - 生成画像: Gemini（geminiImage）で生成できたものだけ保存・添付。
//
// ドメイン差（信頼ホストの許可リスト・保存ディレクトリ・配信 URL prefix・件数上限・画像生成の
// 文脈）は createMediaProcessor のオプションで注入する。検証/捏造防止のロジック自体は共通。
//
// ディレクティブ構文（本文中に1行で書かせる）:
//   [[youtube: <watch URL>]] (任意の続きはキャプションとして | で区切る)
//   [[gen-image: <図解の説明（日本語）>]]
//   [[web-image: <画像URL> | <出典の説明や出典ページ>]]

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateChatDiagram } from './geminiImage.js';

// ─── 共通のメディア参照型 ────────────────────────────────────
// 各チャットの ChatMedia（childcareChatStore / chajiChatStore / workChatStore）は構造が同じ。
// この層は構造的に互換な「最小の ChatMedia」を作って返す（呼び出し側の型へそのまま代入できる）。
export interface ResolvedChatMedia {
  id: string;
  kind: 'image' | 'video' | 'youtube';
  url: string;
  mime: string;
  name?: string;
  size?: number;
  source?: 'upload' | 'generated' | 'web';
  caption?: string;
  videoId?: string;
  sourceUrl?: string;
  sourceTitle?: string;
}

/** チャットごとの差分（ドメイン依存）を注入するオプション。 */
export interface MediaProcessorOptions {
  /** 検証/生成に成功したメディアを保存するディレクトリ（チャットごとに分ける）。 */
  mediaDir: string;
  /** 配信 URL の prefix（例: '/api/chaji/chat/media'）。保存 id を末尾に付ける。 */
  mediaUrlPrefix: string;
  /** Web 実在画像として取り込みを許可する信頼ホスト（末尾一致）。空なら web-image は常に不採用。 */
  allowedImageHosts: string[];
  /** Web 実在画像 1 枚あたりの最大バイト数。 */
  webImageMaxBytes: number;
  /** 1 返答あたりに添えるメディアの上限件数。 */
  assistantMediaMax: number;
  /**
   * Gemini 画像生成のドメイン文脈（英語の主題ヒント）。
   * 例: '茶道（表千家の作法・道具・所作）' / 'ビジネス（PMO・会計・データ）の図解'。
   * 生成プロンプトの「what domain this diagram is for」に使う。
   */
  imageDomainHint: string;
  /** 保存ファイル名のサフィックス（衝突回避・由来識別用、例: 'chaji'）。 */
  fileSuffix: string;
}

// ─── ディレクティブ解析 ──────────────────────────────────────

type DirectiveKind = 'youtube' | 'gen-image' | 'web-image';
interface Directive {
  kind: DirectiveKind;
  arg: string;
  caption?: string;
  raw: string;
}

const DIRECTIVE_RE = /\[\[\s*(youtube|gen-image|web-image)\s*:\s*([^\]]+?)\s*\]\]/gi;

/**
 * 本文からディレクティブを抽出し、本文側からは除去した「自然文」と検出ディレクティブ配列を返す。
 */
export function extractDirectives(text: string): { cleaned: string; directives: Directive[] } {
  const directives: Directive[] = [];
  const cleaned = text.replace(DIRECTIVE_RE, (raw, kind: string, payload: string) => {
    const [argPart, ...capParts] = String(payload).split('|');
    const arg = argPart.trim();
    const caption = capParts.join('|').trim() || undefined;
    if (arg) {
      directives.push({ kind: kind.toLowerCase() as DirectiveKind, arg, caption, raw });
    }
    return ''; // 本文からは記法を消す
  });
  const tidy = cleaned
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleaned: tidy, directives };
}

// ─── YouTube oEmbed 実在検証 ─────────────────────────────────

/** watch URL / youtu.be / embed から videoId を抜く（11 文字の ID）。取れなければ null。 */
function parseYouTubeId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v') ?? '';
        return /^[\w-]{11}$/.test(id) ? id : null;
      }
      const m = /^\/(embed|shorts|v)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[2];
    }
    return null;
  } catch {
    return null;
  }
}

interface OEmbedResult {
  title?: string;
  thumbnail_url?: string;
  author_name?: string;
}

/**
 * YouTube oEmbed で実在検証する。canonical な watch URL を作って oEmbed を叩き、
 * 200+JSON（title あり）なら検証成功。404/失敗は null（捏造・限定公開・削除済み・埋め込み不可）。
 */
async function verifyYouTube(rawUrl: string): Promise<ResolvedChatMedia | null> {
  const videoId = parseYouTubeId(rawUrl);
  if (!videoId) return null;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`;
  try {
    const res = await fetch(oembed, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null;
    const json = (await res.json()) as OEmbedResult;
    const title = (json.title ?? '').trim();
    if (!title) return null;
    return {
      id: randomUUID(),
      kind: 'youtube',
      url: watchUrl,
      mime: '',
      source: 'web',
      videoId,
      sourceUrl: watchUrl,
      sourceTitle: title,
    };
  } catch {
    return null;
  }
}

// ─── Web 実在画像の検証＋取り込み ────────────────────────────

/** ホストが信頼許可リストに末尾一致するか。 */
function isAllowedImageHost(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((a) => host === a || host.endsWith('.' + a));
}

/** content-type / URL 拡張子から保存用の安全な拡張子を決める（許可画像のみ）。 */
function imageExt(contentType: string): string | null {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  switch (ct) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    default:
      return null;
  }
}

/** 取り込んだ実体を <id>-<suffix>.<ext> で保存し、配信 URL 付き ResolvedChatMedia を返す。 */
function saveMediaBuffer(
  buf: Buffer,
  ext: string,
  mime: string,
  opts: MediaProcessorOptions,
  extra: Partial<ResolvedChatMedia>,
): ResolvedChatMedia {
  mkdirSync(opts.mediaDir, { recursive: true });
  const id = randomUUID();
  const filename = `${id}-${opts.fileSuffix}.${ext}`;
  writeFileSync(join(opts.mediaDir, filename), buf);
  return {
    id,
    kind: 'image',
    url: `${opts.mediaUrlPrefix}/${encodeURIComponent(id)}`,
    mime,
    size: buf.length,
    ...extra,
  };
}

/**
 * Web 実在画像を検証して取り込む。信頼ホスト + GET 200 + content-type image/* + サイズ上限内の
 * もののみ採用し、サーバへ保存して自前配信する。出典 URL は帰属表示に残す。検証 NG は null。
 */
async function verifyAndIngestWebImage(
  rawUrl: string,
  opts: MediaProcessorOptions,
  caption?: string,
): Promise<ResolvedChatMedia | null> {
  if (opts.allowedImageHosts.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!isAllowedImageHost(parsed.hostname, opts.allowedImageHosts)) return null;

  try {
    const res = await fetch(parsed.toString(), {
      headers: { Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    try {
      const finalHost = new URL(res.url || parsed.toString()).hostname;
      if (!isAllowedImageHost(finalHost, opts.allowedImageHosts)) return null;
    } catch {
      return null;
    }
    const ct = res.headers.get('content-type') ?? '';
    const ext = imageExt(ct);
    if (!ext) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length === 0 || buf.length > opts.webImageMaxBytes) return null;
    return saveMediaBuffer(buf, ext, ct.split(';')[0].trim(), opts, {
      source: 'web',
      caption,
      sourceUrl: parsed.toString(),
      sourceTitle: caption,
    });
  } catch {
    return null;
  }
}

// ─── 生成画像 ────────────────────────────────────────────────

/** Gemini で図解を生成して保存する。生成失敗・キー未設定は null。 */
async function generateAndSaveImage(
  intentJa: string,
  opts: MediaProcessorOptions,
  caption?: string,
): Promise<ResolvedChatMedia | null> {
  const gen = await generateChatDiagram(intentJa, opts.imageDomainHint);
  if (!gen) return null;
  const ext = imageExt(gen.mime) ?? 'png';
  return saveMediaBuffer(gen.data, ext, gen.mime, opts, {
    source: 'generated',
    caption: caption ?? intentJa,
  });
}

// ─── オーケストレーション ────────────────────────────────────

/**
 * 本文から検出したディレクティブを A/B/C で検証・生成・取り込みし、成功したものだけを
 * media[] に確定する。上限 opts.assistantMediaMax 点まで。失敗は黙って落とす（並列実行・順序保持）。
 */
async function resolveAssistantMedia(
  directives: Directive[],
  opts: MediaProcessorOptions,
): Promise<ResolvedChatMedia[]> {
  const targets = directives.slice(0, Math.max(0, opts.assistantMediaMax));
  const settled = await Promise.all(
    targets.map(async (d): Promise<ResolvedChatMedia | null> => {
      try {
        if (d.kind === 'youtube') {
          const media = await verifyYouTube(d.arg);
          if (media && d.caption) media.caption = d.caption;
          return media;
        }
        if (d.kind === 'web-image') {
          return await verifyAndIngestWebImage(d.arg, opts, d.caption);
        }
        if (d.kind === 'gen-image') {
          return await generateAndSaveImage(d.arg, opts, d.caption);
        }
        return null;
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((m): m is ResolvedChatMedia => m !== null);
}

/**
 * チャットごとのオプションを束ねた「メディア後処理器」を作る。
 * processAssistantText(text) は本文 → { cleaned 本文, media[] }。本文からディレクティブ記法を
 * 除去し、検証/生成に成功したメディアだけを確定して返す。本文に記法が無ければ media は空。
 */
export function createMediaProcessor(opts: MediaProcessorOptions): {
  processAssistantText: (text: string) => Promise<{ cleaned: string; media: ResolvedChatMedia[] }>;
} {
  return {
    async processAssistantText(text: string) {
      const { cleaned, directives } = extractDirectives(text);
      if (directives.length === 0) return { cleaned, media: [] };
      const media = await resolveAssistantMedia(directives, opts);
      return { cleaned, media };
    },
  };
}
