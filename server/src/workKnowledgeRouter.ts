// workKnowledgeRouter — 仕事ナレッジ（ECL/PMO 案件の体系ナレッジ蓄積）の API（MC-260）。
//
// 新サイドメニュー「仕事」(/work) のナレッジ機能。手入力での CRUD と、現場で得た生のインプットを
// runClaude で体系的なナレッジ 1 件のドラフトに整理する「体系化」エンドポイントを提供する。
// 永続は workKnowledgeStore（追記イベント JSONL・畳み込み）。
//
// ルート（index.ts で auth ミドルウェア配下に /api/work で mount。/chat* と衝突しない）:
//   GET    /knowledge            → { entries: KnowledgeEntry[] }（updatedAt 降順）
//   POST   /knowledge            { title, category, tags, body, source? } → { ok, entry }
//   PUT    /knowledge/:id        { title?, category?, tags?, body? } → { ok, entry }（無ければ 404）
//   DELETE /knowledge/:id        → { ok }
//   POST   /knowledge/structure  { input } → { ok, draft }（未保存ドラフトを返すだけ。保存は別途 POST）

import { Router, type Request, type Response } from 'express';

import { CXO_ROOT } from './config.js';
import {
  KNOWLEDGE_CATEGORIES,
  createEntry,
  deleteEntry,
  listEntries,
  normalizeCategory,
  normalizeTags,
  updateEntry,
} from './lib/workKnowledgeStore.js';
import { runClaude } from './lib/notebookClaude.js';

// 体系化の生インプット長の上限（過大プロンプト抑止）。
const MAX_STRUCTURE_INPUT_CHARS = 20000;

// GET /knowledge — ナレッジ一覧（updatedAt 降順）。
function handleList(_req: Request, res: Response): void {
  try {
    res.status(200).json({ entries: listEntries() });
  } catch {
    res.status(200).json({ entries: [] });
  }
}

// POST /knowledge — ナレッジ新規作成。title/body 必須。
function handleCreate(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title) {
    res.status(400).json({ error: 'title（タイトル）は必須です。' });
    return;
  }
  if (!text) {
    res.status(400).json({ error: 'body（本文）は必須です。' });
    return;
  }
  try {
    const entry = createEntry({
      title,
      category: typeof body.category === 'string' ? body.category : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      body: text,
      source: body.source === 'ai' ? 'ai' : 'manual',
    });
    res.status(201).json({ ok: true, entry });
  } catch {
    res.status(500).json({ error: 'ナレッジの保存に失敗しました。' });
  }
}

// PUT /knowledge/:id — ナレッジ更新（指定フィールドのみ）。無ければ 404。
function handleUpdate(req: Request, res: Response): void {
  const id = String(req.params.id ?? '');
  if (!id) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: { title?: string; category?: string; tags?: string[]; body?: string } = {};
  if (typeof body.title === 'string') {
    if (!body.title.trim()) {
      res.status(400).json({ error: 'title は空にできません。' });
      return;
    }
    patch.title = body.title;
  }
  if (typeof body.category === 'string') patch.category = body.category;
  if (Array.isArray(body.tags)) patch.tags = body.tags as string[];
  if (typeof body.body === 'string') {
    if (!body.body.trim()) {
      res.status(400).json({ error: 'body は空にできません。' });
      return;
    }
    patch.body = body.body;
  }
  try {
    const entry = updateEntry(id, patch);
    if (!entry) {
      res.status(404).json({ error: 'ナレッジが見つかりません。' });
      return;
    }
    res.status(200).json({ ok: true, entry });
  } catch {
    res.status(500).json({ error: 'ナレッジの更新に失敗しました。' });
  }
}

// DELETE /knowledge/:id — ナレッジ削除（冪等）。
function handleDelete(req: Request, res: Response): void {
  const id = String(req.params.id ?? '');
  if (!id) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  try {
    deleteEntry(id);
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: 'ナレッジの削除に失敗しました。' });
  }
}

// ─── 体系化（runClaude で生インプット → 体系ナレッジ 1 件のドラフト）──────────────

/** 体系化プロンプトを組む。出力は厳密に 1 個の JSON オブジェクトのみを要求する。 */
function buildStructurePrompt(input: string): string {
  return [
    'あなたは、ECL（予想信用損失）システム導入の PMO 案件を支援するナレッジ整理アシスタントです。',
    '相談者が現場で得た「生のインプット」（断片的なメモ・口頭説明の書き起こしなど）を、後から実務で参照しやすい体系的なナレッジ 1 件に整理してください。',
    '',
    '【出力形式（厳守）】',
    '- 出力は、厳密に 1 個の JSON オブジェクトのみとしてください。前後に説明文・コードフェンス（```）・注釈を一切付けないでください。',
    '- JSON のキーは次の 4 つだけ:',
    '  - "title": 簡潔な見出し（日本語）。',
    `  - "category": 次のいずれか 1 つ: ${KNOWLEDGE_CATEGORIES.join(' / ')}。最も近いものを選ぶ。`,
    '  - "tags": 3〜6 個の短い日本語タグの配列。',
    '  - "body": 構造化された Markdown 本文。「## 要点」「## 詳細」「## 関連・論点」「## ToDo・確認事項」等の見出しで、PMO・実務で後から参照しやすい体系にまとめる。',
    '',
    '【内容のルール】',
    '- 入力に書かれていない事実を勝手に追加・断定しないでください。入力に無い具体値（数値・日付・固有名詞など）は補わないでください。',
    '- 不明点・確認が必要な点は、本文に「要確認」と明示してください。',
    '- 必ず日本語で書いてください。',
    '',
    '【生のインプット】',
    input,
  ].join('\n');
}

/** claude 出力から最初の JSON オブジェクトを頑健に抽出してパースする。失敗時は null。 */
function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  // まず素直に全体パースを試す。
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* フォールバックへ */
  }
  // コードフェンスを剥がして再試行。
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* 続行 */
    }
  }
  // 最初の '{' から括弧の対応を数えて最初の完結した JSON オブジェクトを切り出す。
  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// POST /knowledge/structure — 生インプットを体系化した未保存ドラフトを返す。
async function handleStructure(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = typeof body.input === 'string' ? body.input.trim().slice(0, MAX_STRUCTURE_INPUT_CHARS) : '';
  if (!raw) {
    res.status(400).json({ error: 'input（生のインプット）が必要です。' });
    return;
  }

  let result;
  try {
    result = await runClaude(CXO_ROOT, buildStructurePrompt(raw));
  } catch {
    res.status(502).json({ error: '体系化に失敗しました（生成エンジンエラー）。' });
    return;
  }
  if (!result.ok) {
    res.status(502).json({ error: '体系化に失敗しました。少し時間をおいてからお試しください。' });
    return;
  }

  const parsed = extractJsonObject(result.stdout || '');
  if (!parsed || typeof parsed !== 'object') {
    res.status(502).json({ error: '体系化結果の解析に失敗しました。もう一度お試しください。' });
    return;
  }
  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const draftBody = typeof obj.body === 'string' ? obj.body.trim() : '';
  if (!title || !draftBody) {
    res.status(502).json({ error: '体系化結果が不完全でした（タイトル・本文が取得できません）。' });
    return;
  }
  const draft = {
    title,
    category: normalizeCategory(obj.category),
    tags: normalizeTags(obj.tags),
    body: draftBody,
  };
  res.status(200).json({ ok: true, draft });
}

export function workKnowledgeRouter(): Router {
  const router = Router();
  router.get('/knowledge', (req, res) => handleList(req, res));
  router.post('/knowledge/structure', (req, res) => void handleStructure(req, res));
  router.post('/knowledge', (req, res) => handleCreate(req, res));
  router.put('/knowledge/:id', (req, res) => handleUpdate(req, res));
  router.delete('/knowledge/:id', (req, res) => handleDelete(req, res));
  return router;
}
