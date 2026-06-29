// childcareMedia — すくすく（育児チャット）のアシスタント側メディア返却の後処理層（フェーズ2）。
//
// 共通モジュール chatMedia.ts（ドメイン非依存のディレクティブ後処理＝実在検証/生成/取り込み）に
// 育児チャット固有のオプション（保存先・配信 URL prefix・信頼ホスト許可リスト・件数上限・画像生成の
// ドメイン文脈）を注入した薄いラッパー。挙動は従来どおり（捏造防止・oEmbed 検証・Web 画像取り込み・
// Gemini 図解生成）。茶事/Work も同じ chatMedia.ts を別オプションで流用する。
//
// ディレクティブ構文・検証ロジックの詳細は chatMedia.ts のコメント参照。

import {
  CHILDCARE_ASSISTANT_MEDIA_MAX,
  CHILDCARE_CHAT_MEDIA_DIR,
  CHILDCARE_WEB_IMAGE_ALLOWED_HOSTS,
  CHILDCARE_WEB_IMAGE_MAX_BYTES,
} from '../config.js';
import type { ChatMedia } from './childcareChatStore.js';
import { createMediaProcessor } from './chatMedia.js';

const processor = createMediaProcessor({
  mediaDir: CHILDCARE_CHAT_MEDIA_DIR,
  mediaUrlPrefix: '/api/childcare/chat/media',
  allowedImageHosts: CHILDCARE_WEB_IMAGE_ALLOWED_HOSTS,
  webImageMaxBytes: CHILDCARE_WEB_IMAGE_MAX_BYTES,
  assistantMediaMax: CHILDCARE_ASSISTANT_MEDIA_MAX,
  imageDomainHint:
    'a parenting (infant childcare) guide, soft, warm, reassuring style suitable for new parents',
  fileSuffix: 'suku',
});

/**
 * 本文 → { cleaned 本文, media[] }。本文からディレクティブ記法を除去し、検証/生成に成功した
 * メディアだけを確定して返す。本文に記法が無ければ media は空。
 */
export async function processAssistantText(
  text: string,
): Promise<{ cleaned: string; media: ChatMedia[] }> {
  const { cleaned, media } = await processor.processAssistantText(text);
  // ResolvedChatMedia は ChatMedia と構造互換（kind/source/videoId 等）。型を合わせて返す。
  return { cleaned, media: media as ChatMedia[] };
}
