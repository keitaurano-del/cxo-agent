// chajiMedia — 茶事チャット（表千家の茶道アドバイザー）のアシスタント側メディア返却の後処理層。
//
// 共通モジュール chatMedia.ts に茶事固有のオプション（保存先・配信 URL prefix・信頼ホスト許可リスト・
// 件数上限・画像生成のドメイン文脈）を注入した薄いラッパー。育児（childcareMedia.ts）と同じ機械で、
// 捏造防止・oEmbed 実在検証・Web 画像取り込み・Gemini 図解生成を行う。信頼ホストは茶道の主題
// （表千家不審菴公式・公的機関・美術館/博物館・学術機関等）に合わせている。

import {
  CHAJI_CHAT_MEDIA_DIR,
  CHAJI_WEB_IMAGE_ALLOWED_HOSTS,
  CHILDCARE_ASSISTANT_MEDIA_MAX,
  CHILDCARE_WEB_IMAGE_MAX_BYTES,
} from '../config.js';
import type { ChatMedia } from './chajiChatStore.js';
import { createMediaProcessor } from './chatMedia.js';

const processor = createMediaProcessor({
  mediaDir: CHAJI_CHAT_MEDIA_DIR,
  mediaUrlPrefix: '/api/chaji/chat/media',
  allowedImageHosts: CHAJI_WEB_IMAGE_ALLOWED_HOSTS,
  webImageMaxBytes: CHILDCARE_WEB_IMAGE_MAX_BYTES,
  assistantMediaMax: CHILDCARE_ASSISTANT_MEDIA_MAX,
  imageDomainHint:
    'a Japanese tea ceremony (Omotesenke chado) guide: utensils, gestures (temae), arrangement and seasonal motifs, in a calm, refined, traditional style',
  fileSuffix: 'chaji',
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
