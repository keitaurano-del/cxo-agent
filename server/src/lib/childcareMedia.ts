// childcareMedia — すくすく（育児チャット）のアシスタント側メディア返却の後処理層（フェーズ2）。
//
// claude -p はテキストしか返さないので、すくすくには所定のディレクティブ構文でメディア提案を
// 出させ、この層がそれを解析して「実在検証 / 生成 / 取り込み」を行い、成功したものだけを
// assistant メッセージの media[] に確定する。本文からはディレクティブ記法を除去し自然文だけ残す。
//
// 捏造防止が最重要:
//   - YouTube: oEmbed（GET https://www.youtube.com/oembed?...）が 200+JSON を返すものだけ採用。
//     404/失敗（捏造・限定公開・削除済み）は捨てる。埋め込みは youtube-nocookie。
//   - Web 画像: URL を GET して 200 かつ content-type image/* かつサイズ上限内、さらに信頼ホスト
//     許可リスト内のものだけ採用。検証できた画像はサーバへ取り込み自前配信（hotlink/privacy 回避）、
//     出典 URL はキャプション/リンクで帰属表示。検証 NG は捨てる。
//   - 生成画像: Gemini（geminiImage）で生成できたものだけ保存・添付。
//
// ディレクティブ構文（本文中に1行で書かせる）:
//   [[youtube: <watch URL>]] (任意の続きはキャプションとして | で区切る)
//       例: [[youtube: https://www.youtube.com/watch?v=XXXX | 寝かしつけの基本姿勢がわかります]]
//   [[gen-image: <図解の説明（日本語）>]]
//       例: [[gen-image: 離乳食の進め方（ゴックン期→モグモグ期→カミカミ期→パクパク期）の図]]
//   [[web-image: <画像URL> | <出典の説明や出典ページ>]]
//       例: [[web-image: https://www.mhlw.go.jp/.../growth.png | 厚労省 乳幼児身体発育曲線]]

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHILDCARE_ASSISTANT_MEDIA_MAX,
  CHILDCARE_CHAT_MEDIA_DIR,
  CHILDCARE_WEB_IMAGE_ALLOWED_HOSTS,
  CHILDCARE_WEB_IMAGE_MAX_BYTES,
} from '../config.js';
import type { ChatMedia } from './childcareChatStore.js';
import { generateChildcareDiagram } from './geminiImage.js';

// ─── ディレクティブ解析 ──────────────────────────────────────

type DirectiveKind = 'youtube' | 'gen-image' | 'web-image';
interface Directive {
  kind: DirectiveKind;
  /** 主引数（URL or 図解説明）。 */
  arg: string;
  /** パイプ以降のキャプション/出典説明（任意）。 */
  caption?: string;
  /** 本文から除去するための元マッチ文字列。 */
  raw: string;
}

// [[kind: ...]] を貪欲でなく拾う。改行を含まない 1 行想定。
const DIRECTIVE_RE = /\[\[\s*(youtube|gen-image|web-image)\s*:\s*([^\]]+?)\s*\]\]/gi;

/**
 * 本文からディレクティブを抽出し、本文側からは除去した「自然文」と検出ディレクティブ配列を返す。
 * 上限件数（CHILDCARE_ASSISTANT_MEDIA_MAX）を超えた分のディレクティブは解析対象から落とす
 * （本文除去はするので記法がユーザーに見えることはない）。
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
  // 連続した空行・行頭末尾の空白を軽く整える（記法削除で生じた隙間をならす）。
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
 * 200+JSON（title あり）なら検証成功。404/失敗（捏造・限定公開・削除済み・埋め込み不可）は null。
 */
async function verifyYouTube(rawUrl: string): Promise<ChatMedia | null> {
  const videoId = parseYouTubeId(rawUrl);
  if (!videoId) return null;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`;
  try {
    const res = await fetch(oembed, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null; // 404 = 存在しない/限定公開/削除済み → 捏造排除
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null;
    const json = (await res.json()) as OEmbedResult;
    const title = (json.title ?? '').trim();
    if (!title) return null; // title 無し = 信頼できない
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

/** ホストが信頼許可リスト（go.jp / lg.jp / 各公的機関）に末尾一致するか。 */
function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return CHILDCARE_WEB_IMAGE_ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith('.' + allowed),
  );
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

/** 取り込んだ実体を <id>-suku.<ext> で保存し、配信 URL 付き ChatMedia を返す。 */
function saveMediaBuffer(buf: Buffer, ext: string, mime: string, extra: Partial<ChatMedia>): ChatMedia {
  mkdirSync(CHILDCARE_CHAT_MEDIA_DIR, { recursive: true });
  const id = randomUUID();
  const filename = `${id}-suku.${ext}`;
  writeFileSync(join(CHILDCARE_CHAT_MEDIA_DIR, filename), buf);
  return {
    id,
    kind: 'image',
    url: `/api/childcare/chat/media/${encodeURIComponent(id)}`,
    mime,
    size: buf.length,
    ...extra,
  };
}

/**
 * Web 実在画像を検証して取り込む。信頼ホスト + GET 200 + content-type image/* + サイズ上限内の
 * もののみ採用し、サーバへ保存して自前配信する（hotlink/privacy 回避）。出典 URL は帰属表示に残す。
 * 検証 NG（ホスト外・非画像・取得失敗・サイズ超過）は null。
 */
async function verifyAndIngestWebImage(rawUrl: string, caption?: string): Promise<ChatMedia | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null; // 平文は使わない
  if (!isAllowedImageHost(parsed.hostname)) return null; // 信頼ソース限定

  try {
    const res = await fetch(parsed.toString(), {
      headers: { Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    // リダイレクト追跡後の最終ホストも許可リスト内か再確認（オープンリダイレクト悪用防止）。
    try {
      const finalHost = new URL(res.url || parsed.toString()).hostname;
      if (!isAllowedImageHost(finalHost)) return null;
    } catch {
      return null;
    }
    const ct = res.headers.get('content-type') ?? '';
    const ext = imageExt(ct);
    if (!ext) return null; // 画像でない
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length === 0 || buf.length > CHILDCARE_WEB_IMAGE_MAX_BYTES) return null;
    return saveMediaBuffer(buf, ext, ct.split(';')[0].trim(), {
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
async function generateAndSaveImage(intentJa: string, caption?: string): Promise<ChatMedia | null> {
  const gen = await generateChildcareDiagram(intentJa);
  if (!gen) return null;
  const ext = imageExt(gen.mime) ?? 'png';
  return saveMediaBuffer(gen.data, ext, gen.mime, {
    source: 'generated',
    caption: caption ?? intentJa,
  });
}

// ─── オーケストレーション ────────────────────────────────────

/**
 * 本文から検出したディレクティブを A/B/C で検証・生成・取り込みし、成功したものだけを
 * media[] に確定する。上限 CHILDCARE_ASSISTANT_MEDIA_MAX 点まで。失敗は黙って落とす。
 * 各ディレクティブは独立なので並列実行し、順序は元の出現順を保つ。
 */
export async function resolveAssistantMedia(directives: Directive[]): Promise<ChatMedia[]> {
  const targets = directives.slice(0, Math.max(0, CHILDCARE_ASSISTANT_MEDIA_MAX));
  const settled = await Promise.all(
    targets.map(async (d): Promise<ChatMedia | null> => {
      try {
        if (d.kind === 'youtube') {
          const media = await verifyYouTube(d.arg);
          if (media && d.caption) media.caption = d.caption;
          return media;
        }
        if (d.kind === 'web-image') {
          return await verifyAndIngestWebImage(d.arg, d.caption);
        }
        if (d.kind === 'gen-image') {
          return await generateAndSaveImage(d.arg, d.caption);
        }
        return null;
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((m): m is ChatMedia => m !== null);
}

/**
 * 本文 → { cleaned 本文, media[] }。本文からディレクティブ記法を除去し、検証/生成に成功した
 * メディアだけを確定して返す。本文に記法が無ければ media は空。
 */
export async function processAssistantText(
  text: string,
): Promise<{ cleaned: string; media: ChatMedia[] }> {
  const { cleaned, directives } = extractDirectives(text);
  if (directives.length === 0) return { cleaned, media: [] };
  const media = await resolveAssistantMedia(directives);
  return { cleaned, media };
}
