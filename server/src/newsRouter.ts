// newsRouter — ニュースページの「深掘り」API（MC-355・auth ミドルウェア配下）。
//
//  POST /api/news/deepdive : { text, context? } → { explanation, links } | { error }
//      ユーザーがニュース本文から選択したテキストを Gemini flash ＋ Google Search
//      グラウンディングへ渡し、「これはこういうことです」トーンの平易な日本語解説と
//      関連リンク（groundingMetadata 由来・最大6件）を返す。
//
// 堅牢方針は geminiText.ts / naoshiteRouter.ts と同じ:
//  - キー未設定・API失敗・タイムアウト・空応答は throw せず 502 { error }（日本語メッセージ）。
//  - 入力は空文字・2000字超を 400 で弾く。context は 1000 字で切り詰め。
//  - groundingMetadata が無い応答でも explanation だけ返す（links: []）。

import { Router } from 'express';
import { GEMINI_API_KEY } from './config.js';

const GENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const NEWS_DEEPDIVE_MODEL = process.env.NEWS_DEEPDIVE_MODEL?.trim() || 'gemini-2.5-flash';
const NEWS_DEEPDIVE_TIMEOUT_MS = 45_000;

/** ポップアップにそのまま表示できる日本語の失敗メッセージ。 */
const FRIENDLY_ERROR = '深掘りに失敗しました。時間をおいてもう一度お試しください。';

/** Gemini :generateContent 応答のうち参照する形だけの最小定義（grounding 込み）。 */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  promptFeedback?: { blockReason?: string };
}

export interface DeepdiveLink {
  title: string;
  url: string;
}

/** 入力検証の結果。ok=false のとき message をそのまま 400 応答に使う。 */
export type DeepdiveInput =
  | { ok: true; text: string; context: string }
  | { ok: false; message: string };

/** リクエスト body を検証・正規化する（空/2000字超は reject、context は1000字まで）。 */
export function validateDeepdiveInput(body: unknown): DeepdiveInput {
  const b = (body ?? {}) as { text?: unknown; context?: unknown };
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return { ok: false, message: 'text is required' };
  if (text.length > 2000) return { ok: false, message: 'text too long (max 2000 chars)' };
  const context = typeof b.context === 'string' ? b.context.trim().slice(0, 1000) : '';
  return { ok: true, text, context };
}

/** groundingMetadata から関連リンクを抽出する（uri で重複排除・最大6件）。無ければ []。 */
export function extractGroundingLinks(json: GenerateContentResponse): DeepdiveLink[] {
  const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const links: DeepdiveLink[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    links.push({ title: chunk.web?.title?.trim() || uri, url: uri });
    if (links.length >= 6) break;
  }
  return links;
}

/** 深掘りプロンプトを組み立てる（周辺見出しがあれば文脈として添える）。 */
export function buildDeepdivePrompt(text: string, context: string): string {
  const contextLine = context ? `\n【出てきた場所（周辺の見出し）】\n${context}\n` : '\n';
  return `あなたはニュースをやさしく解説するアシスタントです。
ユーザーは今日のニュース記事の中から、次のテキストを選択して「もっと知りたい」と思っています。
${contextLine}
【選択されたテキスト】
${text}

Webで検索して最新の情報を確かめたうえで、次のルールで解説してください:
- 「これはこういうことです」という調子の、平易でやわらかい日本語で。
- 専門用語はかみくだいて説明する。
- 背景と要点がわかるように、3〜6文でまとめる。
- 前置き・見出し・箇条書きは使わず、本文のみを出力する。`;
}

export function newsRouter(): Router {
  const router = Router();

  router.post('/deepdive', async (req, res) => {
    const input = validateDeepdiveInput(req.body);
    if (!input.ok) {
      res.status(400).json({ error: input.message });
      return;
    }
    if (!GEMINI_API_KEY) {
      console.warn('[news-deepdive] GEMINI_API_KEY not configured');
      res.status(502).json({ error: FRIENDLY_ERROR });
      return;
    }

    const url = `${GENAI_BASE}/${encodeURIComponent(NEWS_DEEPDIVE_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: buildDeepdivePrompt(input.text, input.context) }] }],
      // Google Search グラウンディング（関連リンクは groundingMetadata から拾う）。
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2000 },
    };

    try {
      const apiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(NEWS_DEEPDIVE_TIMEOUT_MS),
      });
      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => '(no body)');
        console.warn(`[news-deepdive] gemini ${apiRes.status} — ${errText.slice(0, 300)}`);
        res.status(502).json({ error: FRIENDLY_ERROR });
        return;
      }
      const json = (await apiRes.json()) as GenerateContentResponse;
      if (json.promptFeedback?.blockReason) {
        console.warn(`[news-deepdive] blocked: ${json.promptFeedback.blockReason}`);
        res.status(502).json({ error: FRIENDLY_ERROR });
        return;
      }
      const explanation = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('')
        .trim();
      if (!explanation) {
        console.warn('[news-deepdive] empty response');
        res.status(502).json({ error: FRIENDLY_ERROR });
        return;
      }
      res.json({ explanation, links: extractGroundingLinks(json) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[news-deepdive] request failed — ${message}`);
      res.status(502).json({ error: FRIENDLY_ERROR });
    }
  });

  return router;
}
