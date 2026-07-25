// naoshiteRouter — 「ナオシテ」（修理のメルカリ）プロトタイプの実AI診断 API（auth ミドルウェア配下）。
//
//  POST /api/naoshite/diagnose : { imageBase64, mimeType } → { diagnosis } | { error }
//      diagnosis = { item, issue, fix, price, save, lines: string[] }
//      写真1枚を Gemini flash（vision）へ渡し、修理マーケットプレイス視点の故障診断を
//      JSON で返させる。プロトタイプ用途なので堅牢方針は geminiText.ts と同じ:
//      キー未設定・失敗・タイムアウト・パース不能はすべて 200 { error } で返し、
//      クライアント側はサンプル診断へグレースフルにフォールバックする（throw しない）。
//
// 注意: グローバル express.json は limit 1mb。クライアント（web/public/naoshite.html）は
// canvas で長辺 900px / JPEG 品質 0.75 に縮小してから base64 を送る前提。

import { Router } from 'express';
import { GEMINI_API_KEY } from './config.js';

const GENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const NAOSHITE_GEMINI_MODEL = process.env.NAOSHITE_GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
const NAOSHITE_TIMEOUT_MS = 45_000;

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
}

export interface NaoshiteDiagnosis {
  item: string;
  issue: string;
  fix: string;
  price: string;
  save: string;
  lines: string[];
}

const DIAGNOSE_PROMPT = `あなたは修理マーケットプレイス「ナオシテ」のAI診断エンジンです。
ユーザーが撮った「壊れたモノ」の写真を見て、修理職人へ見積もり依頼を出すための診断を作ってください。

次のJSONだけを出力してください（コードフェンス・前置き・補足は一切禁止）:
{
  "item": "品目（例: 革靴（ビジネスシューズ））",
  "issue": "故障・損傷内容を写真から具体的に（例: かかとゴムの摩耗（残り約1mm））",
  "fix": "推奨修理メニュー（例: ヒールトップリフト交換（両足））",
  "price": "日本の修理相場レンジ（例: ¥3,000〜4,500）",
  "save": "新品買い替え比の節約目安（例: 買い替え比 約85%お得）",
  "lines": ["解析ログ風の短文を4行。例: 物体検出 … 革靴 / 紳士用 (98.2%)", "損傷解析 … …", "素材推定 … …", "過去の類似修理 N件 から相場を算出"]
}

ルール:
- 写真に壊れたモノが写っていない/判別不能なら item に写っているものを書き、issue は「明確な損傷は検出できませんでした（角度を変えて損傷部分を接写してください）」とし、fix/price/save は点検前提の控えめな内容にする。
- 相場は日本国内の一般的な修理料金感で。誇張しない。
- すべて日本語。lines の各行は40字以内。`;

/** 応答テキストから JSON を取り出してパースする（コードフェンス混入にも耐える）。 */
function parseDiagnosis(text: string): NaoshiteDiagnosis | null {
  const raw = text.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<NaoshiteDiagnosis>;
    if (!obj.item || !obj.issue || !obj.fix || !obj.price) return null;
    return {
      item: String(obj.item),
      issue: String(obj.issue),
      fix: String(obj.fix),
      price: String(obj.price),
      save: String(obj.save ?? ''),
      lines: Array.isArray(obj.lines) ? obj.lines.slice(0, 5).map(String) : [],
    };
  } catch {
    return null;
  }
}

export function naoshiteRouter(): Router {
  const router = Router();

  router.post('/diagnose', async (req, res) => {
    const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : '';
    const mimeType = typeof req.body?.mimeType === 'string' && req.body.mimeType.startsWith('image/')
      ? req.body.mimeType
      : 'image/jpeg';
    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 required' });
      return;
    }
    if (!GEMINI_API_KEY) {
      res.status(200).json({ error: 'GEMINI_API_KEY not configured' });
      return;
    }

    const url = `${GENAI_BASE}/${encodeURIComponent(NAOSHITE_GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: DIAGNOSE_PROMPT },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        },
      ],
      // gemini-2.5-flash は thinking が maxOutputTokens を消費して本文が途切れるため、
      // thinkingBudget:0 で無効化し、上限も余裕を持たせる。
      generationConfig: { temperature: 0.4, maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } },
    };

    try {
      const apiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(NAOSHITE_TIMEOUT_MS),
      });
      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => '(no body)');
        console.warn(`[naoshite] gemini ${apiRes.status} — ${errText.slice(0, 300)}`);
        res.status(200).json({ error: `gemini ${apiRes.status}` });
        return;
      }
      const json = (await apiRes.json()) as GenerateContentResponse;
      if (json.promptFeedback?.blockReason) {
        res.status(200).json({ error: `blocked: ${json.promptFeedback.blockReason}` });
        return;
      }
      const text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('');
      const diagnosis = parseDiagnosis(text);
      if (!diagnosis) {
        console.warn(`[naoshite] parse failed — ${text.slice(0, 200)}`);
        res.status(200).json({ error: 'parse failed' });
        return;
      }
      res.json({ diagnosis });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[naoshite] diagnose failed — ${message}`);
      res.status(200).json({ error: message });
    }
  });

  return router;
}
