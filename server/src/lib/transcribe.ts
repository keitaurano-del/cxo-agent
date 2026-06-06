// Gemini gemini-2.0-flash API を使った音声文字起こしラッパー
//
// GEMINI_API_KEY が未設定の場合は Error を throw する。
// API 仕様: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent

import { GEMINI_API_KEY } from '../config.js';

const TRANSCRIBE_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * 音声バッファを Gemini gemini-2.0-flash で文字起こしする。
 * GEMINI_API_KEY が未設定の場合は Error を throw する。
 * API エラーは Error を throw する（呼び出し側でキャッチ）。
 *
 * @param audioBuffer 音声データの Buffer
 * @param mimeType    音声の MIME タイプ（例: "audio/webm", "audio/mp4"）
 * @returns           文字起こし結果のテキスト
 */
export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません');
  }

  const url = `${TRANSCRIBE_ENDPOINT}?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: audioBuffer.toString('base64'),
            },
          },
          {
            text: 'この音声を日本語で文字起こしてください。話者が複数いる場合は話者A:、話者B:などのラベルを付けてください。フィラー語は適度に整えてください。',
          },
        ],
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '(no body)');
    throw new Error(
      `Gemini transcribeAudio failed: ${res.status} ${res.statusText} — ${errText}`,
    );
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini transcribeAudio: 空のレスポンス');
  }

  return text;
}
