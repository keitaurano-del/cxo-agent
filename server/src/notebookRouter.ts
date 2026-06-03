// notebookRouter — NotebookLM 的「ノートブック」機能の API（MC-126）。
//
// ノートブック = 資料セット（sources/）＋資料に根ざしたチャット（ask）＋生成物（generate→artifacts/）。
// 分析エンジンは headless `claude -p` を cwd=ノートブック dir で起動し、./sources/ と ./extracted/ の
// 資料だけを根拠に回答・生成物作成させる（lib/notebookClaude.ts）。
//
// ルート（index.ts で auth ミドルウェア配下に /api/notebooks で mount）:
//   GET    /                  一覧
//   POST   /                  作成 { name }
//   GET    /:id               詳細
//   DELETE /:id               削除
//   POST   /:id/sources       ソース追加（multipart, field "files"）
//   DELETE /:id/sources?name= ソース削除
//   POST   /:id/ask           資料根拠 Q&A { question }
//   POST   /:id/generate      生成物作成 { kind, instruction? }

import { mkdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import { NOTEBOOK_UPLOAD_MAX_BYTES, NOTEBOOK_UPLOAD_MAX_FILES } from './config.js';
import { SafePathError } from './lib/vaultPath.js';
import {
  resolveNotebookDir,
  sanitizeNotebookFilename,
  resolveSourceTarget,
} from './lib/notebookPath.js';
import {
  createNotebook,
  listNotebooks,
  getNotebookDetail,
  deleteNotebook,
  appendChat,
  deleteSource,
  touchNotebook,
  artifactNames,
} from './lib/notebookStore.js';
import { extractSourceText } from './lib/notebookExtract.js';
import { runClaude } from './lib/notebookClaude.js';

/** :id パラメータを string に正規化する（express 5 は string | string[] 型）。 */
function idParam(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

// ─── multipart filename の latin1→utf8 復号（deliverableUploadRouter と同方針）─────────

function decodeOriginalName(name: string): string {
  const raw = name || 'file';
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    const before = (raw.match(/�/g) || []).length;
    const after = (decoded.match(/�/g) || []).length;
    return after > before ? raw : decoded;
  } catch {
    return raw;
  }
}

// ─── ソースアップロード用 multer（diskStorage、sources/ に保存）─────────────

interface SavedSourceRef {
  name: string;
  absPath: string;
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      // :id は params から取れる（multer は route 解決後に走る）。
      const dir = resolveNotebookDir(idParam(req), true);
      const sourcesDir = join(dir, 'sources');
      if (!existsSync(sourcesDir)) mkdirSync(sourcesDir, { recursive: true });
      cb(null, sourcesDir);
    } catch (e) {
      cb(e instanceof Error ? e : new Error(String(e)), '');
    }
  },
  filename: (req, file, cb) => {
    try {
      const safe = sanitizeNotebookFilename(decodeOriginalName(file.originalname));
      const { absPath, name } = resolveSourceTarget(idParam(req), safe);
      const r = req as Request & { _savedSources?: SavedSourceRef[] };
      if (!r._savedSources) r._savedSources = [];
      r._savedSources.push({ name, absPath });
      cb(null, name);
    } catch (e) {
      cb(e instanceof Error ? e : new Error(String(e)), '');
    }
  },
});

const uploadSources = multer({
  storage,
  limits: { fileSize: NOTEBOOK_UPLOAD_MAX_BYTES, files: NOTEBOOK_UPLOAD_MAX_FILES },
}).array('files', NOTEBOOK_UPLOAD_MAX_FILES);

function cleanupPartial(req: Request): void {
  const r = req as Request & { _savedSources?: SavedSourceRef[] };
  for (const s of r._savedSources ?? []) {
    try {
      if (existsSync(s.absPath)) unlinkSync(s.absPath);
    } catch {
      /* noop */
    }
  }
}

function runUpload(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    uploadSources(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          cleanupPartial(req);
          if (err.code === 'LIMIT_FILE_SIZE') {
            const mb = Math.round(NOTEBOOK_UPLOAD_MAX_BYTES / (1024 * 1024));
            res.status(413).json({ error: `ファイルサイズが上限（約 ${mb}MB）を超えています。`, code: err.code });
            resolve(false);
            return;
          }
          res.status(400).json({ error: err.message, code: err.code });
          resolve(false);
          return;
        }
        cleanupPartial(req);
        const message =
          err instanceof SafePathError ? err.message : err instanceof Error ? err.message : String(err);
        // ノートブック不在等は 404 寄りだが、multer 内なので 400 で返す。
        res.status(400).json({ error: message });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

// ─── ハンドラ ─────────────────────────────────────────

/** SafePathError を 400/404 にマップしつつ同期処理を実行する。 */
function safe(res: Response, fn: () => unknown): void {
  try {
    const body = fn();
    if (res.headersSent || body === undefined) return;
    res.json(body);
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof SafePathError) {
      const code = /not found/i.test(e.message) ? 404 : 400;
      res.status(code).json({ error: e.message });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error('[notebook error]', message);
    res.status(500).json({ error: message });
  }
}

// GET / — 一覧
function handleList(_req: Request, res: Response): void {
  safe(res, () => ({ generatedAt: new Date().toISOString(), notebooks: listNotebooks() }));
}

// POST / — 作成
function handleCreate(req: Request, res: Response): void {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  safe(res, () => {
    const meta = createNotebook(name);
    res.status(201).json(meta);
    return undefined;
  });
}

// GET /:id — 詳細
function handleGet(req: Request, res: Response): void {
  safe(res, () => {
    const detail = getNotebookDetail(idParam(req));
    if (!detail) {
      res.status(404).json({ error: 'notebook not found' });
      return undefined;
    }
    return detail;
  });
}

// DELETE /:id — 削除
function handleDelete(req: Request, res: Response): void {
  safe(res, () => {
    deleteNotebook(idParam(req));
    return { ok: true };
  });
}

// POST /:id/sources — ソース追加（multipart）→ 抽出
async function handleAddSources(req: Request, res: Response): Promise<void> {
  // 事前にノートブック存在確認（multer に入る前に 404 を返せるように）。
  try {
    resolveNotebookDir(idParam(req), true);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    throw e;
  }

  const ok = await runUpload(req, res);
  if (!ok) return;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'ファイルがありません（フィールド名は "files" を使用してください）。' });
    return;
  }

  const dir = resolveNotebookDir(idParam(req), true);
  const added: Array<{ name: string; relpath: string; sizeBytes: number; extracted: boolean; extractError?: string }> = [];

  for (const f of files) {
    let sizeBytes = f.size;
    try {
      sizeBytes = statSync(f.path).size;
    } catch {
      /* use multer size */
    }
    let extracted = false;
    let extractError: string | undefined;
    try {
      const outName = await extractSourceText(dir, f.path, f.filename);
      extracted = outName !== null;
    } catch (e) {
      // 抽出失敗は部分劣化（その資料だけ抽出無しで続行。元ファイルは残す）。
      extractError = e instanceof Error ? e.message : String(e);
    }
    added.push({
      name: f.filename,
      relpath: `sources/${f.filename}`,
      sizeBytes,
      extracted,
      ...(extractError ? { extractError } : {}),
    });
  }

  touchNotebook(idParam(req));
  res.status(201).json({ ok: true, added });
}

// DELETE /:id/sources?name=<file> — ソース削除
function handleDeleteSource(req: Request, res: Response): void {
  const name = typeof req.query.name === 'string' ? req.query.name : '';
  if (!name) {
    res.status(400).json({ error: 'クエリ name が必要です。' });
    return;
  }
  // basename 化して traversal を無害化（sanitize と同等のガード）。
  const safeName = sanitizeNotebookFilename(name);
  safe(res, () => {
    const removed = deleteSource(idParam(req), safeName);
    if (!removed) {
      res.status(404).json({ error: 'source not found' });
      return undefined;
    }
    touchNotebook(idParam(req));
    return { ok: true, removed: safeName };
  });
}

// ─── 資料根拠 Q&A ─────────────────────────────────────

function buildAskPrompt(question: string): string {
  return [
    'あなたはこのノートブックの資料アシスタントです。',
    'カレントディレクトリの ./sources/ と ./extracted/ にある資料だけを根拠に、次の質問に日本語で答えてください。',
    'まず関連しそうな資料を Read で読んでから回答してください。',
    '可能なら根拠にした資料名（ファイル名）を回答中に挙げてください。',
    '資料に書かれていないことは推測せず「資料に記載がありません」と述べてください。',
    '回答は簡潔で読みやすい日本語にしてください。',
    '',
    `質問: ${question}`,
  ].join('\n');
}

async function handleAsk(req: Request, res: Response): Promise<void> {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'question が必要です。' });
    return;
  }
  let dir: string;
  try {
    dir = resolveNotebookDir(idParam(req), true);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    throw e;
  }

  // user メッセージを先に記録。
  appendChat(idParam(req), { ts: new Date().toISOString(), role: 'user', text: question });

  const result = await runClaude(dir, buildAskPrompt(question));
  const answer = (result.stdout || '').trim();

  if (!result.ok && !answer) {
    // 完全失敗（部分出力もなし）→ 200 + error フィールド（部分劣化方針）。
    res.status(200).json({ answer: '', error: result.error });
    return;
  }

  // 回答（部分でも）を assistant として記録。
  appendChat(idParam(req), { ts: new Date().toISOString(), role: 'assistant', text: answer });
  touchNotebook(idParam(req));
  res.status(200).json({ answer, ...(result.error ? { error: result.error } : {}) });
}

// ─── 生成物作成 ───────────────────────────────────────

const KIND_INSTRUCTIONS: Record<string, string> = {
  summary: '資料全体の要点を日本語でまとめた要約を ./artifacts/要約.md に Markdown で作成してください。',
  faq: '資料から想定される質問と回答を日本語でまとめた FAQ を ./artifacts/FAQ.md に Markdown で作成してください。',
  timeline:
    '資料に登場する出来事・日付・マイルストーンを時系列に整理した年表を ./artifacts/時系列.md に Markdown で作成してください。',
  template:
    '資料の書式・項目構成を真似た再利用可能な雛形ファイルを ./artifacts/ に作成してください。' +
    '形式の指定（xlsx / docx / pptx 等）が instruction にあればそれに従い、ファイルは openpyxl / python-docx / python-pptx で生成してください。指定が無ければ Markdown で作成してください。',
};

function buildGeneratePrompt(kind: string, instruction: string): string {
  const base = KIND_INSTRUCTIONS[kind];
  const task = base
    ? instruction
      ? `${base}\n追加の指示: ${instruction}`
      : base
    : // custom / 未知 kind は instruction を主指示にする。
      instruction || '資料の内容を日本語でまとめた成果物を ./artifacts/ に作成してください。';
  return [
    'あなたはこのノートブックの資料アシスタントです。',
    'カレントディレクトリの ./sources/ と ./extracted/ にある資料を Read で読んだうえで、次の成果物を作成してください。',
    task,
    '',
    '注意:',
    '- 成果物ファイルは必ず ./artifacts/ ディレクトリの中に書き出してください。',
    '- 表計算・文書・スライド等のファイルは openpyxl / python-docx / python-pptx を使って生成してください（Bash でスクリプトを実行して構いません）。',
    '- 要約・FAQ・年表など文章主体のものは Markdown（.md）で作成してください。',
    '- 文章はアシスタントの口調を出さず、中立的な丁寧体（です・ます）で書いてください。',
    '- 資料に無い情報を創作しないでください。',
    '最後に、作成したファイル名を「作成: <ファイル名>」の形式で 1 行で報告してください。',
  ].join('\n');
}

async function handleGenerate(req: Request, res: Response): Promise<void> {
  const kind = typeof req.body?.kind === 'string' ? req.body.kind.trim() : 'custom';
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
  if (kind === 'custom' && !instruction) {
    res.status(400).json({ error: 'custom には instruction が必要です。' });
    return;
  }
  let dir: string;
  try {
    dir = resolveNotebookDir(idParam(req), true);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    throw e;
  }

  const before = artifactNames(idParam(req));
  const result = await runClaude(dir, buildGeneratePrompt(kind, instruction));

  // 生成後に artifacts/ を再走査し、新規物を差分で割り出す。
  const detail = getNotebookDetail(idParam(req));
  const allArtifacts = detail?.artifacts ?? [];
  const created = allArtifacts.filter((a) => !before.has(a.name));

  touchNotebook(idParam(req));
  res.status(200).json({
    ok: result.ok && created.length > 0,
    created,
    artifacts: allArtifacts,
    report: (result.stdout || '').trim(),
    ...(result.error ? { error: result.error } : {}),
  });
}

// ─── Router 組み立て ─────────────────────────────────────

export function notebookRouter(): Router {
  const router = Router();
  router.get('/', handleList);
  router.post('/', handleCreate);
  router.get('/:id', handleGet);
  router.delete('/:id', handleDelete);
  router.post('/:id/sources', (req, res) => void handleAddSources(req, res));
  router.delete('/:id/sources', handleDeleteSource);
  router.post('/:id/ask', (req, res) => void handleAsk(req, res));
  router.post('/:id/generate', (req, res) => void handleGenerate(req, res));
  return router;
}
