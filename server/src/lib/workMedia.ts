// workMedia — 仕事チャット（ECL/PMO 学習・壁打ちアドバイザー）のアシスタント側メディア返却の後処理層。
//
// 共通モジュール chatMedia.ts に Work 固有のオプションを注入した薄いラッパー。育児/茶事と同じ機械で、
// 捏造防止・oEmbed 実在検証・Web 画像取り込み・Gemini 図解生成を行う。信頼ホストはビジネス
// （会計基準設定主体・規制当局・大手監査法人・学術/公的機関等）の主題に合わせている。

import {
  CHILDCARE_ASSISTANT_MEDIA_MAX,
  CHILDCARE_WEB_IMAGE_MAX_BYTES,
  WORK_CHAT_MEDIA_DIR,
  WORK_WEB_IMAGE_ALLOWED_HOSTS,
} from '../config.js';
import type { ChatMedia } from './workChatStore.js';
import { createMediaProcessor } from './chatMedia.js';

const processor = createMediaProcessor({
  mediaDir: WORK_CHAT_MEDIA_DIR,
  mediaUrlPrefix: '/api/work/chat/media',
  allowedImageHosts: WORK_WEB_IMAGE_ALLOWED_HOSTS,
  webImageMaxBytes: CHILDCARE_WEB_IMAGE_MAX_BYTES,
  assistantMediaMax: CHILDCARE_ASSISTANT_MEDIA_MAX,
  imageDomainHint:
    'a business / finance explainer (banking, accounting, IFRS9 / expected credit loss, data and PMO): clean schematic diagrams, flows and matrices in a neutral professional style',
  fileSuffix: 'work',
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
