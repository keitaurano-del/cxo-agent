// geminiText — Gemini テキスト生成の薄いラッパー（開発ページのアートディレクション注入用）。
//
// geminiImage.ts と同じ generativelanguage v1beta :generateContent を叩くが、responseModalities は
// 指定せず（＝テキスト）、candidates[0].content.parts[].text を連結して 1 本の文字列で返す。
// 開発ページのモックアップ生成で「このアプリのビジュアルデザイン方針（配色/タイポ/レイアウト/ムード）」を
// Gemini に短く書かせ、それを Claude のコード生成プロンプトへ差し込むのに使う（多モデル活用）。
//
// 堅牢方針: GEMINI_API_KEY 未設定・失敗・タイムアウト・空応答はすべて null を返す（throw しない）。
// 呼び出し側は null を「方針注入なし」として無視し、Claude だけで従来どおり生成できる
//（Gemini の可否で本体の生成が壊れないこと＝グレースフルフォールバック）。

import { GEMINI_API_KEY } from '../config.js';

const GENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** テキスト生成に使う Gemini モデル（軽量・速い flash 系）。env GEMINI_TEXT_MODEL で差し替え可。 */
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL?.trim() || 'gemini-2.5-flash';

/** テキスト生成 1 回あたりのタイムアウト（ミリ秒）。方針は短文なので 30s で十分。 */
const GEMINI_TEXT_TIMEOUT_MS = 30_000;

/** Gemini の :generateContent レスポンスのうち、参照する形だけを最小定義。 */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

/**
 * Gemini でテキストを 1 本生成する。GEMINI_API_KEY 未設定・失敗・空応答は null。
 * 失敗は throw せず null 返し（呼び出し側で「生成なし」へ自然にフォールバック）。
 */
export async function generateGeminiText(prompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  const text = (prompt || '').trim();
  if (!text) return null;

  const url = `${GENAI_BASE}/${encodeURIComponent(GEMINI_TEXT_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 800 },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TEXT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '(no body)');
      console.warn(`[gemini-text] ${res.status} — ${errText.slice(0, 300)}`);
      return null;
    }
    const json = (await res.json()) as GenerateContentResponse;
    if (json.promptFeedback?.blockReason) {
      console.warn(`[gemini-text] blocked: ${json.promptFeedback.blockReason}`);
      return null;
    }
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const out = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    return out || null;
  } catch (err) {
    console.warn(`[gemini-text] request failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
