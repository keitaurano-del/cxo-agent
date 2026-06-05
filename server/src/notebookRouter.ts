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

import {
  NOTEBOOK_UPLOAD_MAX_BYTES,
  NOTEBOOK_ARTIFACT_MAX_TOTAL_BYTES,
} from './config.js';
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
  renameNotebook,
  artifactNames,
  resolveNotebookFile,
  readChatHistory,
  totalArtifactBytes,
  type ChatMessage,
} from './lib/notebookStore.js';
import { extractSourceText } from './lib/notebookExtract.js';
import { runClaude, runClaudeStream } from './lib/notebookClaude.js';
import { convertOfficeToPdf, isConvertibleToPdf } from './lib/officeToPdf.js';

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
      const overwrite = req.query?.replace === '1' || req.query?.replace === 'true';
      const safe = sanitizeNotebookFilename(decodeOriginalName(file.originalname));
      const { absPath, name } = resolveSourceTarget(idParam(req), safe, { overwrite });
      const r = req as Request & { _savedSources?: SavedSourceRef[] };
      if (!r._savedSources) r._savedSources = [];
      r._savedSources.push({ name, absPath });
      cb(null, name);
    } catch (e) {
      cb(e instanceof Error ? e : new Error(String(e)), '');
    }
  },
});

// limits を外してファイルサイズ・件数の上限を撤廃（フォルダアップロード対応のため）。
const uploadSources = multer({
  storage,
}).array('files');

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

// PATCH /:id — ノートブック名を変更
async function handleRename(req: Request, res: Response): Promise<void> {
  const id = idParam(req);
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name は必須です' });
    return;
  }
  try {
    const dir = resolveNotebookDir(id);
    if (!existsSync(dir)) {
      res.status(404).json({ error: 'ノートブックが見つかりません' });
      return;
    }
    renameNotebook(id, name.trim());
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(400).json({ error: String(e) });
      return;
    }
    console.error('[notebook PATCH]', e);
    res.status(500).json({ error: 'リネームに失敗しました' });
  }
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

/** ask プロンプトを構築する。history がある場合は会話履歴を埋め込む。 */
function buildAskPrompt(question: string, history: ChatMessage[]): string {
  const lines = [
    'あなたはこのノートブックの資料アシスタントです。',
    '回答・成果物の文章は中立的な丁寧体（です・ます）で書いてください。キャラクター人格・方言・特定の口調（「〜じゃ」「〜のう」「ほっほっ」等）は一切使わず、エンドユーザー向けの自然な日本語にしてください。',
    'カレントディレクトリの ./sources/ と ./extracted/ にある資料だけを根拠に、次の質問に日本語で答えてください。',
    'まず関連しそうな資料を Read で読んでから回答してください。',
    '回答中で資料を引用するときは必ず以下の形式のタグを使ってください:',
    '  {{cite:ファイル名:ページ番号またはシート名}}',
    '例:',
    '  {{cite:1.1.e_要求一覧_v4.0.xlsx:要求一覧}}',
    '  {{cite:W200_プロジェクト管理マニュアル_v4.0.pdf:5}}',
    'ページ番号が不明な場合はページ番号を省略してください: {{cite:ファイル名}}',
    '資料に書かれていないことは推測せず「資料に記載がありません」と述べてください。',
    '回答は簡潔で読みやすい日本語にしてください。',
  ];

  if (history.length > 0) {
    lines.push('', '--- 過去の会話履歴（参考にしてください） ---');
    for (const m of history) {
      lines.push(`${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.text}`);
    }
    lines.push('--- 以上が過去の会話履歴 ---');
  }

  lines.push('', `質問: ${question}`);
  return lines.join('\n');
}

/** SSE イベントを 1 行書き出す。 */
function sseWrite(res: Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function handleAsk(req: Request, res: Response): Promise<void> {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'question が必要です。' });
    return;
  }
  const id = idParam(req);
  let dir: string;
  try {
    dir = resolveNotebookDir(id, true);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    throw e;
  }

  // 直近 10 件の会話履歴をコンテキストに含める。
  const history = readChatHistory(id, 10);

  // user メッセージを先に記録。
  appendChat(id, { ts: new Date().toISOString(), role: 'user', text: question });

  const prompt = buildAskPrompt(question, history);
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const result = await runClaudeStream(dir, prompt, (chunk) => {
      sseWrite(res, { type: 'chunk', text: chunk });
    });

    const answer = (result.stdout || '').trim();
    appendChat(id, { ts: new Date().toISOString(), role: 'assistant', text: answer });
    touchNotebook(id);
    sseWrite(res, { type: 'done', answer, ...(result.error ? { error: result.error } : {}) });
    res.end();
    return;
  }

  const result = await runClaude(dir, prompt);
  const answer = (result.stdout || '').trim();

  if (!result.ok && !answer) {
    res.status(200).json({ answer: '', error: result.error });
    return;
  }

  appendChat(id, { ts: new Date().toISOString(), role: 'assistant', text: answer });
  touchNotebook(id);
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
  template_extract:
    'あなたはドキュメンテーション専門家です。' +
    'カレントディレクトリの ./sources/ と ./extracted/ にある資料を全て Read で読み込んでください。' +
    '複数の資料を横断的に分析し、各資料に共通して登場する「優れた文書構造」を抽出してください。' +
    '抽出した構造をもとに、再利用可能な汎用ドキュメントテンプレートを ./artifacts/テンプレート抽出.md に Markdown で作成してください。\n' +
    'テンプレートは以下の形式で各節を記述してください：\n' +
    '## [節タイトル]\n' +
    '**【何を書くか】** この節に書くべき内容の説明（2〜3文）\n' +
    '**【なぜ書くか】** この節が文書に必要な理由（1〜2文）\n' +
    '**【コツ】**\n- ヒント1\n- ヒント2\n- ヒント3\n' +
    '**記入例:**\n> （短い記入例）\n---\n' +
    'なお、資料が1件しかない場合はその資料の構造を手本に、複数件の場合は共通して現れる節を優先して抽出してください。' +
    '資料に無い情報を創作せず、資料の実際の書き方パターンを根拠にコツを導いてください。',
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
    '回答・成果物の文章は中立的な丁寧体（です・ます）で書いてください。キャラクター人格・方言・特定の口調（「〜じゃ」「〜のう」「ほっほっ」等）は一切使わず、エンドユーザー向けの自然な日本語にしてください。',
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
  const id = idParam(req);
  let dir: string;
  try {
    dir = resolveNotebookDir(id, true);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    throw e;
  }

  // artifacts/ の合計サイズが上限を超えていたら 413 で弾く。
  const maxArtifacts = NOTEBOOK_ARTIFACT_MAX_TOTAL_BYTES;
  if (maxArtifacts > 0) {
    const currentBytes = totalArtifactBytes(id);
    if (currentBytes >= maxArtifacts) {
      const mb = Math.round(maxArtifacts / (1024 * 1024));
      res
        .status(413)
        .json({ error: `artifacts の合計サイズが上限（${mb}MB）に達しています。不要な生成物を削除してから再実行してください。` });
      return;
    }
  }

  const before = artifactNames(id);
  const prompt = buildGeneratePrompt(kind, instruction);
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let totalChars = 0;
    const EXPECTED_CHARS = 2000;
    const result = await runClaudeStream(dir, prompt, (chunk) => {
      sseWrite(res, { type: 'chunk', text: chunk });
      totalChars += chunk.length;
      const pct = Math.min(99, Math.round((totalChars / EXPECTED_CHARS) * 100));
      sseWrite(res, { type: 'progress', pct });
    });
    sseWrite(res, { type: 'progress', pct: 100 });

    const detail = getNotebookDetail(id);
    const allArtifacts = detail?.artifacts ?? [];
    const created = allArtifacts.filter((a) => !before.has(a.name));
    touchNotebook(id);

    sseWrite(res, {
      type: 'done',
      ok: result.ok && created.length > 0,
      created,
      artifacts: allArtifacts,
      report: (result.stdout || '').trim(),
      ...(result.error ? { error: result.error } : {}),
    });
    res.end();
    return;
  }

  const result = await runClaude(dir, prompt);

  const detail = getNotebookDetail(id);
  const allArtifacts = detail?.artifacts ?? [];
  const created = allArtifacts.filter((a) => !before.has(a.name));

  touchNotebook(id);
  res.status(200).json({
    ok: result.ok && created.length > 0,
    created,
    artifacts: allArtifacts,
    report: (result.stdout || '').trim(),
    ...(result.error ? { error: result.error } : {}),
  });
}

// ─── ファイル配信（資料／生成物のダウンロード・プレビュー）──────────────

/** ファイル名を RFC5987（filename*）でエンコードする（日本語ファイル名対応）。 */
function contentDisposition(name: string, inline: boolean): string {
  const disp = inline ? 'inline' : 'attachment';
  // eslint-disable-next-line no-control-regex
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${disp}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// GET /:id/file?path=<relpath>&inline=1
//  - inline 無し → attachment（ダウンロード）。
//  - inline=1 → ブラウザ内プレビュー用に inline 返し。
//    Office 系（xlsx/pptx/docx 等）は LibreOffice で PDF 変換して返す（deliverables/preview と同方式）。
//    pdf/画像/text/markdown はそのまま inline。
async function handleFile(req: Request, res: Response): Promise<void> {
  const id = idParam(req);
  const relpath = typeof req.query.path === 'string' ? req.query.path : '';
  if (!relpath) {
    res.status(400).json({ error: 'クエリ path が必要です。' });
    return;
  }
  const inline = req.query.inline === '1' || req.query.inline === 'true';

  let info: ReturnType<typeof resolveNotebookFile>;
  try {
    info = resolveNotebookFile(id, relpath);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    throw e;
  }
  if (!info) {
    res.status(404).json({ error: 'file not found' });
    return;
  }

  // inline プレビューで Office 系は PDF 変換して返す。
  if (inline && isConvertibleToPdf(info.ext)) {
    let pdfPath: string;
    try {
      pdfPath = await convertOfficeToPdf(info.absPath);
    } catch (convErr) {
      const message = convErr instanceof Error ? convErr.message : String(convErr);
      console.error('[notebook preview convert error]', info.name, message);
      res.status(502).json({ error: 'preview conversion failed', detail: message });
      return;
    }
    const pdfName = info.name.replace(/\.[^.]+$/, '') + '.pdf';
    res.type('application/pdf');
    res.set('Content-Disposition', contentDisposition(pdfName, true));
    res.set('Cache-Control', 'private, max-age=60');
    // 変換キャッシュ dir（.deliverables-cache）が dotfile セグメントを含むため allow を明示。
    res.sendFile(pdfPath, { dotfiles: 'allow' });
    return;
  }

  res.type(info.contentType);
  res.set('Content-Disposition', contentDisposition(info.name, inline));
  res.set('Cache-Control', 'private, max-age=60');
  res.sendFile(info.absPath);
}

// ─── Router 組み立て ─────────────────────────────────────

export function notebookRouter(): Router {
  const router = Router();
  router.get('/', handleList);
  router.post('/', handleCreate);
  router.get('/:id', handleGet);
  router.patch('/:id', (req, res) => void handleRename(req, res));
  router.delete('/:id', handleDelete);
  router.get('/:id/file', (req, res) => void handleFile(req, res));
  router.post('/:id/sources', (req, res) => void handleAddSources(req, res));
  router.delete('/:id/sources', handleDeleteSource);
  router.post('/:id/ask', (req, res) => void handleAsk(req, res));
  router.post('/:id/generate', (req, res) => void handleGenerate(req, res));
  return router;
}
