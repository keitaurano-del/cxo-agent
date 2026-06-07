// Gemini gemini-embedding-001 API ラッパー
//
// GEMINI_API_KEY が未設定の場合は空配列を返し、呼び出し側が RAG なし従来動作へフォールバックする。
// API 仕様: https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent
// 出力次元: 768 次元の float 配列

import { GEMINI_API_KEY } from '../config.js';

const EMBED_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent';

/**
 * exponential backoff でリトライする（429 Too Many Requests 対策）。
 * 1s → 2s → 4s → 8s → 60s（最大 60s にクランプ）、最大5回試行。
 * API エラー（ステータス・レスポンス本体）をログに記録。
 */
async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts - 1;

      // エラー情報をログに記録
      const statusCode = (err as any)?.statusCode;
      const responseBody = (err as any)?.responseBody;
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (!isLastAttempt) {
        console.warn(
          `[embedding] attempt ${attempt + 1}/${maxAttempts} failed: status=${statusCode} error="${errorMsg}" body="${responseBody}"`,
        );
      }

      if (isLastAttempt) throw err;

      // ネットワークエラーは即再試行
      const isNetworkError = err instanceof TypeError;
      if (!isNetworkError) {
        // HTTP ステータス 429 のみリトライ
        if (statusCode !== 429) throw err;
      }

      // backoff: 1s 2^n（n=attempt）、最大 60s
      const delaySec = Math.min(Math.pow(2, attempt), 60);
      const delayMs = delaySec * 1000;
      console.warn(
        `[embedding] retrying after ${delaySec}s (${statusCode})...`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('retryWithBackoff: exhausted all attempts');
}

/**
 * 単一テキストを Gemini text-embedding-004 でベクトル化する。
 * GEMINI_API_KEY が未設定なら空配列を返す。
 * API エラー（429 含む）はリトライ、それ以外は Error を throw する（呼び出し側でキャッチ）。
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

  return retryWithBackoff(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '(no body)');
      let shortMsg = `Gemini API ${res.status}`;
      if (res.status === 429) {
        shortMsg = 'Gemini API 429 - Rate limited';
      } else if (res.status === 401 || res.status === 403) {
        shortMsg = 'Gemini API key invalid or unauthorized';
      } else if (res.status === 400) {
        shortMsg = 'Gemini API bad request';
      } else if (res.status >= 500) {
        shortMsg = 'Gemini API server error';
      }
      const err = new Error(`${shortMsg} — ${errText}`) as any;
      err.statusCode = res.status;
      err.responseBody = errText;
      throw err;
    }

    const json = (await res.json()) as { embedding?: { values?: number[] } };
    const values = json?.embedding?.values;
    if (!Array.isArray(values)) {
      throw new Error(`Gemini embedText: unexpected response shape — ${JSON.stringify(json)}`);
    }

    return values;
  });
}

/**
 * 複数テキストをバッチで Gemini text-embedding-004 でベクトル化する。
 * batchSize 件ずつ Promise.all で並列発行し、バッチ間に 1s sleep を挟む（rate limit 対策）。
 * 1 件でも失敗した場合は Error を throw する。
 * デフォルト batchSize は 50（Gemini max_batch_size に合わせ、rate limit 回避）。
 */
export async function embedTexts(texts: string[], batchSize = 50): Promise<number[][]> {
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
