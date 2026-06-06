// Gemini gemini-2.5-flash API を使った音声文字起こし・ファイルテキスト抽出ラッパー
//
// GEMINI_API_KEY が未設定の場合は Error を throw する。
// API 仕様: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent

import { GEMINI_API_KEY } from '../config.js';

const TRANSCRIBE_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Gemini が inline_data で受け付ける MIME タイプ一覧（PDF・画像）
const GEMINI_SUPPORTED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * 音声バッファを Gemini gemini-2.5-flash で文字起こしする。
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

/**
 * ファイルバッファからテキストを抽出する。
 * - text/plain / text/csv: バッファをそのまま UTF-8 文字列として返す。
 * - application/pdf / image/*: Gemini で OCR / テキスト抽出する。
 * - それ以外: Error を throw する。
 */
export async function extractFileText(fileBuffer: Buffer, mimeType: string): Promise<string> {
  const baseMime = mimeType.split(';')[0].trim().toLowerCase();

  // プレーンテキスト系はそのまま返す
  if (baseMime === 'text/plain' || baseMime === 'text/csv' || baseMime === 'text/markdown') {
    return fileBuffer.toString('utf-8');
  }

  if (!GEMINI_SUPPORTED_MIMES.has(baseMime)) {
    throw new Error(`非対応のファイル形式です（${baseMime}）。PDF・テキスト・画像に対応しています。`);
  }

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません');
  }

  const url = `${TRANSCRIBE_ENDPOINT}?key=${GEMINI_API_KEY}`;
  const promptText =
    baseMime === 'application/pdf'
      ? 'このPDFの全テキスト内容を抽出してください。見出しや段落構造を保ち、読みやすい形式で出力してください。'
      : 'この画像に含まれるテキストをすべて抽出してください。読みやすい形式で出力してください。';

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: baseMime, data: fileBuffer.toString('base64') } },
          { text: promptText },
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
    throw new Error(`Gemini extractFileText failed: ${res.status} ${res.statusText} — ${errText}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini extractFileText: 空のレスポンス');
  }

  return text;
}
