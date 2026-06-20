// geminiImage — Gemini 画像生成（図解）ラッパー（育児チャット「すくすく」フェーズ2 B）。
//
// すくすくが説明用の図解/イラストを生成して返すための薄いラッパー。Gemini の
// generativelanguage v1beta :generateContent に responseModalities=['IMAGE'] を要求し、
// inlineData（base64 画像）を1枚取り出して Buffer で返す。GEMINI_API_KEY 未設定なら null を
// 返し、呼び出し側が「生成なし」へフォールバックする（embedding.ts と同じ作法）。
//
// 安全方針: プロンプトは「育児に適切で安全な図解」に限定し、症状の生々しい医療画像・人物の
// 写実顔・テキスト過多は避けるよう英語プロンプト側で明示する。生成可否はあくまで best-effort。

import { CHILDCARE_GEMINI_IMAGE_MODEL, GEMINI_API_KEY } from '../config.js';

const GENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** 生成結果（成功時のみ）。mime は image/png 等、data は生バイト。 */
export interface GeneratedImage {
  data: Buffer;
  mime: string;
}

/** Gemini の :generateContent レスポンスのうち、参照する形だけを最小定義。 */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string };
        text?: string;
      }>;
    };
  }>;
  promptFeedback?: { blockReason?: string };
}

/**
 * 日本語の図解意図を、図解生成に適した英語プロンプトへ整える。
 * 育児に安全・適切な「説明用ダイアグラム／やさしいイラスト」に寄せ、写実的な医療画像や
 * 人物の写実顔、過剰なテキストを避けるよう明示する。日本語ラベルは文字化けしやすいので、
 * ラベルは付けず図そのものの分かりやすさで伝えるよう促す（必要十分な最小プロンプト）。
 */
function buildImagePrompt(intentJa: string): string {
  return [
    'Create a clear, friendly explanatory illustration / simple diagram for a parenting (infant childcare) guide.',
    `Topic (translate the intent and illustrate it): ${intentJa}`,
    'Style: soft, warm, reassuring flat illustration or simple instructional diagram with clean shapes and gentle colors, suitable for new parents.',
    'Keep it safe and non-graphic: do NOT depict realistic medical symptoms (rashes, wounds, blood), do NOT show realistic human faces, avoid anything distressing.',
    'Prefer clear visual steps/arrows over text. Avoid long paragraphs of text in the image; keep any text minimal.',
    'No watermarks, no logos.',
  ].join('\n');
}

/**
 * 図解を1枚生成する。GEMINI_API_KEY 未設定・失敗・画像が返らない場合は null。
 * 失敗は throw せず null 返し（呼び出し側で「生成できませんでした」へ自然にフォールバック）。
 */
export async function generateChildcareDiagram(intentJa: string): Promise<GeneratedImage | null> {
  if (!GEMINI_API_KEY) return null;
  const intent = (intentJa || '').trim().slice(0, 500);
  if (!intent) return null;

  const url = `${GENAI_BASE}/${encodeURIComponent(CHILDCARE_GEMINI_IMAGE_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildImagePrompt(intent) }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '(no body)');
      console.warn(`[gemini-image] ${res.status} — ${errText.slice(0, 300)}`);
      return null;
    }
    const json = (await res.json()) as GenerateContentResponse;
    if (json.promptFeedback?.blockReason) {
      console.warn(`[gemini-image] blocked: ${json.promptFeedback.blockReason}`);
      return null;
    }
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData;
      if (inline?.data) {
        const mime = inline.mimeType || 'image/png';
        if (!mime.startsWith('image/')) continue;
        const buf = Buffer.from(inline.data, 'base64');
        if (buf.length > 0) return { data: buf, mime };
      }
    }
    return null;
  } catch (err) {
    console.warn(`[gemini-image] request failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
