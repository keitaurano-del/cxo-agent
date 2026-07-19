// claudeMedia — 汎用 Claude チャットのアシスタント側メディア返却の後処理層。
//
// 共通モジュール chatMedia.ts に Claude チャット固有のオプションを注入した薄いラッパー。育児/茶事/仕事と
// 同じ機械で、捏造防止・oEmbed 実在検証・Web 画像取り込み・Gemini 図解生成を行う。汎用なので主題は
// 限定しないが、Web 画像の信頼ホストは公的・学術・主要メディア等に限定する。

import {
  CHILDCARE_ASSISTANT_MEDIA_MAX,
  CHILDCARE_WEB_IMAGE_MAX_BYTES,
  CLAUDE_CHAT_MEDIA_DIR,
  CLAUDE_WEB_IMAGE_ALLOWED_HOSTS,
} from '../config.js';
import type { ChatMedia } from './claudeChatStore.js';
import { createMediaProcessor } from './chatMedia.js';

const processor = createMediaProcessor({
  mediaDir: CLAUDE_CHAT_MEDIA_DIR,
  mediaUrlPrefix: '/api/claude/chat/media',
  allowedImageHosts: CLAUDE_WEB_IMAGE_ALLOWED_HOSTS,
  webImageMaxBytes: CHILDCARE_WEB_IMAGE_MAX_BYTES,
  assistantMediaMax: CHILDCARE_ASSISTANT_MEDIA_MAX,
  imageDomainHint:
    'a clear, general-purpose explanatory illustration or concept diagram in a clean, neutral style',
  fileSuffix: 'claude',
});

/**
 * 本文 → { cleaned 本文, media[] }。本文からディレクティブ記法を除去し、検証/生成に成功した
 * メディアだけを確定して返す。本文に記法が無ければ media は空。
 */
export async function processAssistantText(
  text: string,
): Promise<{ cleaned: string; media: ChatMedia[] }> {
  const { cleaned, media } = await processor.processAssistantText(text);
  return { cleaned, media: media as ChatMedia[] };
}
