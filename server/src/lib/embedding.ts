// Gemini gemini-embedding-001 API ラッパー
//
// GEMINI_API_KEY が未設定の場合は空配列を返し、呼び出し側が RAG なし従来動作へフォールバックする。
// API 仕様: https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent
// 出力次元: 768 次元の float 配列

import { GEMINI_API_KEY } from '../config.js';

const EMBED_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent';

/**
 * 単一テキストを Gemini text-embedding-004 でベクトル化する。
 * GEMINI_API_KEY が未設定なら空配列を返す。
 * API エラーは Error を throw する（呼び出し側でキャッチ）。
 */
export async function embedText(text: string): Promise<number[]> {
  if (!GEMINI_API_KEY) {
    return [];
  }

  const url = `${EMBED_ENDPOINT}?key=${GEMINI_API_KEY}`;
  const body = {
    model: 'models/gemini-embedding-001',
    content: {
      parts: [{ text }],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '(no body)');
    throw new Error(`Gemini embedText failed: ${res.status} ${res.statusText} — ${errText}`);
  }

  const json = (await res.json()) as { embedding?: { values?: number[] } };
  const values = json?.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error(`Gemini embedText: unexpected response shape — ${JSON.stringify(json)}`);
  }

  return values;
}

/**
 * 複数テキストをバッチで Gemini text-embedding-004 でベクトル化する。
 * batchSize 件ずつ Promise.all で並列発行し、バッチ間に 1s sleep を挟む（rate limit 対策）。
 * 1 件でも失敗した場合は Error を throw する。
 */
export async function embedTexts(texts: string[], batchSize = 20): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((t) => embedText(t)));
    results.push(...batchResults);

    // 最後のバッチの後は sleep しない
    if (i + batchSize < texts.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}
