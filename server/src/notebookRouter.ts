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

import { mkdirSync, statSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import {
  NOTEBOOK_UPLOAD_MAX_BYTES,
  NOTEBOOK_ARTIFACT_MAX_TOTAL_BYTES,
  NOTEBOOK_RAG_TOP_K,
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
  artifactRelpaths,
  resolveNotebookFile,
  readChatHistory,
  totalArtifactBytes,
  listArtifactFolderTree,
  createArtifactFolder,
  updateArtifactContent,
  type ChatMessage,
} from './lib/notebookStore.js';
import { extractSourceText } from './lib/notebookExtract.js';
import { runClaude, runClaudeStream } from './lib/notebookClaude.js';
import { convertOfficeToPdf, isConvertibleToPdf } from './lib/officeToPdf.js';
import { buildIndex, searchChunks, deleteIndex, type Chunk } from './lib/notebookIndex.js';
import { transcribeAudio, extractFileText } from './lib/transcribe.js';
import {
  MINUTES_TYPES,
  MINUTES_FORMATS,
  getTypePreset,
  buildMinutesPrompt,
  type MinutesType,
  type MinutesFormat,
} from './lib/minutesPresets.js';
import { listPatterns, createPattern, deletePattern, type MinutesPattern } from './lib/minutesPatterns.js';
import { exportMinutes, type ExportFormat } from './lib/minutesExport.js';

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

// 音声文字起こし用 multer（memoryStorage: base64 変換後に Gemini API へ渡す）
const uploadAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }).single('audio');

// ファイルテキスト抽出用 multer（PDF / テキスト / 画像）
const uploadFileExtract = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single('file');

function runAudioUpload(req: Request, res: Response): Promise<Express.Multer.File | null> {
  return new Promise((resolve) => {
    uploadAudio(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: '音声ファイルが大きすぎます（上限 100MB）。' });
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          res.status(400).json({ error: msg });
        }
        resolve(null);
        return;
      }
      resolve((req as Request & { file?: Express.Multer.File }).file ?? null);
    });
  });
}

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

// GET /:id/status — ノートブック RAG 診断・可視化ステータス
function handleStatus(req: Request, res: Response): void {
  const id = idParam(req);
  try {
    const dir = resolveNotebookDir(id, true);
    const indexPath = join(dir, 'index', 'meta.json');

    let indexExists = false;
    let chunkCount = 0;
    let lastBuilt: string | null = null;
    let errorMessage: string | undefined;

    // meta.json を読んで status を取得
    if (existsSync(indexPath)) {
      try {
        const metaRaw = readFileSync(indexPath, 'utf-8');
        const meta = JSON.parse(metaRaw) as { builtAt: string; chunkCount: number };
        indexExists = true;
        chunkCount = meta.chunkCount;
        lastBuilt = meta.builtAt;
      } catch (e) {
        errorMessage = `meta.json 読み込み失敗: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // RAG 最適化パラメータをログに出力（Phase 2 性能検証用）
    console.log(
      `[notebook-status] RAG config: topK=${NOTEBOOK_RAG_TOP_K} batchSize=50 embeddingVersion=004`,
      `notebookId=${id} indexExists=${indexExists} chunkCount=${chunkCount}`,
    );

    res.status(200).json({
      notebookId: id,
      indexExists,
      chunkCount,
      lastBuilt,
      ...(errorMessage ? { errorMessage } : {}),
    });
  } catch (e) {
    if (e instanceof SafePathError) {
      const code = /not found/i.test(e.message) ? 404 : 400;
      res.status(code).json({ error: e.message });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error('[notebook status]', message);
    res.status(500).json({ error: message });
  }
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

  buildIndex(dir).catch((e: unknown) => {
    console.error('[notebook] index build error:', e instanceof Error ? e.message : String(e));
  });
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
  const id = idParam(req);
  try {
    const removed = deleteSource(id, safeName);
    if (!removed) {
      res.status(404).json({ error: 'source not found' });
      return;
    }
    touchNotebook(id);
    const nbDir = resolveNotebookDir(id, true);
    deleteIndex(nbDir);
    buildIndex(nbDir).catch((e: unknown) => {
      console.error('[notebook] index build error:', e instanceof Error ? e.message : String(e));
    });
    res.json({ ok: true, removed: safeName });
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

/**
 * RAG 検索結果チャンクを根拠に含めた ask プロンプトを構築する。
 * 各チャンクには「--- 抜粋 N: ファイル名=X, チャンク=Y ---」形式のヘッダを付与する。
 */
function buildRagAskPrompt(question: string, chunks: Chunk[], history: ChatMessage[]): string {
  const lines = [
    'あなたはこのノートブックの資料アシスタントです。',
    '回答・成果物の文章は中立的な丁寧体（です・ます）で書いてください。キャラクター人格・方言・特定の口調（「〜じゃ」「〜のう」「ほっほっ」等）は一切使わず、エンドユーザー向けの自然な日本語にしてください。',
    '以下の【資料抜粋】のみを根拠に、次の質問に日本語で答えてください。',
    '回答中で資料を引用するときは必ず以下の形式のタグを使ってください:',
    '  {{cite:ファイル名:チャンクインデックス}}',
    '例:',
    '  {{cite:1.1.e_要求一覧_v4.0.xlsx.txt:2}}',
    '  {{cite:W200_プロジェクト管理マニュアル_v4.0.pdf.txt:0}}',
    'チャンクインデックスが不明な場合は省略してください: {{cite:ファイル名}}',
    '資料抜粋に書かれていないことは推測せず「資料に記載がありません」と述べてください。',
    '回答は簡潔で読みやすい日本語にしてください。',
    '',
    '【資料抜粋】',
  ];

  chunks.forEach((chunk, i) => {
    lines.push(`--- 抜粋 ${i + 1}: ファイル名=${chunk.sourceFile}, チャンク=${chunk.chunkIndex} ---`);
    lines.push(chunk.text);
    lines.push('');
  });

  lines.push('【資料抜粋ここまで】');

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

/** エンジン（claude -p）失敗の種別。 */
type EngineErrorKind = 'model_limit' | 'engine_error';

/**
 * claude 実行結果が「利用上限（Sonnet/usage/rate limit 等）」による失敗かを判定する（MC-202）。
 * 上限到達時、CLI は "You've hit your Sonnet limit · resets ..." 等のメッセージを stdout/エラー文に出す。
 * これを assistant 回答として保存・表示しないため、ここで検出して種別を返す。大文字小文字無視。
 * notebookClaude.ts の同等判定（非 export）と独立に、router 側で保存ガード用に持つ。
 */
function looksLikeLimit(text: string): boolean {
  const h = text.toLowerCase();
  if (h.includes('hit your') && h.includes('limit')) return true;
  return (
    h.includes('usage limit') ||
    h.includes('rate limit') ||
    h.includes('rate_limit') ||
    h.includes('rate-limited') ||
    (h.includes('exceeded') && h.includes('limit'))
  );
}

/**
 * エンジン実行結果を分類する。
 * - ok=false: 失敗。上限なら 'model_limit'、それ以外は 'engine_error'。
 * - ok=true だが stdout 本文が上限メッセージのみ（本来の回答でない）の場合も 'model_limit' とみなす。
 * - 正常時は null。
 */
function classifyEngineError(result: { ok: boolean; stdout?: string; error?: string }): EngineErrorKind | null {
  const haystack = `${result.stdout ?? ''}\n${result.error ?? ''}`;
  if (!result.ok) {
    return looksLikeLimit(haystack) ? 'model_limit' : 'engine_error';
  }
  // ok=true でも、stdout が短い上限メッセージだけの場合は回答ではないので上限扱い。
  const out = (result.stdout ?? '').trim();
  if (out.length > 0 && out.length < 400 && looksLikeLimit(out)) return 'model_limit';
  return null;
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

  // Phase 1 診断ログ
  const requestTs = new Date().toISOString();
  const requestTime = Date.now();
  console.log(`[notebook-ask] request start ts=${requestTs} notebookId=${id} questionLen=${question.length}`);

  // 直近 10 件の会話履歴をコンテキストに含める。
  const history = readChatHistory(id, 10);
  console.log(`[notebook-ask] history loaded historyLen=${history.length}`);

  // user メッセージを先に記録。
  appendChat(id, { ts: requestTs, role: 'user', text: question });

  // RAG チャンク検索
  const searchStart = Date.now();
  const ragChunks = await searchChunks(dir, question).catch(() => [] as Chunk[]);
  const searchElapsed = ((Date.now() - searchStart) / 1000).toFixed(2);
  const ragPath = ragChunks.length > 0 ? 'RAG' : 'traditional';
  const pathReason = ragChunks.length > 0 ? `RAG chunks found (${ragChunks.length})` : 'Fallback no chunks';
  console.log(
    `[notebook-ask] RAG search: path=${ragPath} topK=${NOTEBOOK_RAG_TOP_K} chunkCount=${ragChunks.length} vectorDim=${ragChunks[0]?.vector.length ?? 'N/A'} elapsed=${searchElapsed}s reason=${pathReason}`,
  );

  const prompt = ragChunks.length > 0
    ? buildRagAskPrompt(question, ragChunks, history)
    : buildAskPrompt(question, history);
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const claudeStart = Date.now();
    console.log(`[notebook-ask] Claude start ts=${new Date().toISOString()} method=stream`);
    const result = await runClaudeStream(dir, prompt, (chunk) => {
      sseWrite(res, { type: 'chunk', text: chunk });
    });
    const claudeElapsed = ((Date.now() - claudeStart) / 1000).toFixed(2);
    console.log(`[notebook-ask] Claude done ts=${new Date().toISOString()} elapsed=${claudeElapsed}s status=${result.ok ? 'ok' : 'error'}`);

    const answer = (result.stdout || '').trim();
    const errorKind = classifyEngineError(result);
    const totalElapsed = parseFloat(((Date.now() - requestTime) / 1000).toFixed(1));

    // エンジン失敗（上限/エラー）時は、生エラー文字列を assistant 回答として保存・返却しない（MC-202）。
    if (errorKind) {
      console.log(
        `[notebook-ask] request failed (stream) ts=${new Date().toISOString()} totalElapsed=${totalElapsed}s errorKind=${errorKind} error="${result.error}"`,
      );
      sseWrite(res, {
        type: 'done',
        answer: '',
        errorKind,
        metadata: {
          elapsed: totalElapsed,
          pathType: 'error',
          chunkCount: ragChunks.length,
          pathReason: result.error || pathReason,
        },
        ...(result.error ? { error: result.error } : {}),
      });
      res.end();
      return;
    }

    const answerTs = new Date().toISOString();
    appendChat(id, { ts: answerTs, role: 'assistant', text: answer });
    touchNotebook(id);
    console.log(
      `[notebook-ask] request complete ts=${answerTs} totalElapsed=${totalElapsed}s ok=${result.ok} answerLen=${answer.length}`,
    );
    sseWrite(res, {
      type: 'done',
      answer,
      metadata: {
        elapsed: totalElapsed,
        pathType: result.ok ? ragPath : 'error',
        chunkCount: ragChunks.length,
        pathReason,
      },
      ...(result.error ? { error: result.error } : {}),
    });
    res.end();
    return;
  }

  const claudeStart = Date.now();
  console.log(`[notebook-ask] Claude start ts=${new Date().toISOString()} method=json`);
  const result = await runClaude(dir, prompt);
  const claudeElapsed = ((Date.now() - claudeStart) / 1000).toFixed(2);
  console.log(`[notebook-ask] Claude done ts=${new Date().toISOString()} elapsed=${claudeElapsed}s status=${result.ok ? 'ok' : 'error'}`);

  const answer = (result.stdout || '').trim();
  const totalElapsed = parseFloat(((Date.now() - requestTime) / 1000).toFixed(1));
  const errorKind = classifyEngineError(result);

  // エンジン失敗（上限/エラー）時は、生エラー文字列を assistant 回答として保存・返却しない（MC-202）。
  if (errorKind) {
    console.log(
      `[notebook-ask] request failed ts=${new Date().toISOString()} totalElapsed=${totalElapsed}s errorKind=${errorKind} error="${result.error}"`,
    );
    res.status(200).json({
      answer: '',
      errorKind,
      error: result.error,
      metadata: {
        elapsed: totalElapsed,
        pathType: 'error',
        chunkCount: 0,
        pathReason: result.error || 'Claude error',
      },
    });
    return;
  }

  const answerTs = new Date().toISOString();
  appendChat(id, { ts: answerTs, role: 'assistant', text: answer });
  touchNotebook(id);
  console.log(
    `[notebook-ask] request complete ts=${answerTs} totalElapsed=${totalElapsed}s ok=${result.ok} answerLen=${answer.length}`,
  );
  res.status(200).json({
    answer,
    metadata: {
      elapsed: totalElapsed,
      pathType: ragPath,
      chunkCount: ragChunks.length,
      pathReason,
    },
    ...(result.error ? { error: result.error } : {}),
  });
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

/**
 * RAG 検索結果チャンクを根拠に含めた generate プロンプトを構築する。
 * KIND_INSTRUCTIONS を活かしながら「以下の資料抜粋を参考に」形式にする。
 */
function buildRagGeneratePrompt(kind: string, instruction: string, chunks: Chunk[]): string {
  const base = KIND_INSTRUCTIONS[kind];
  const task = base
    ? instruction
      ? `${base}\n追加の指示: ${instruction}`
      : base
    : instruction || '資料の内容を日本語でまとめた成果物を ./artifacts/ に作成してください。';

  const lines = [
    'あなたはこのノートブックの資料アシスタントです。',
    '回答・成果物の文章は中立的な丁寧体（です・ます）で書いてください。キャラクター人格・方言・特定の口調（「〜じゃ」「〜のう」「ほっほっ」等）は一切使わず、エンドユーザー向けの自然な日本語にしてください。',
    '以下の【資料抜粋】を参考に、次の成果物を作成してください。',
    'より詳細な情報が必要な場合は ./sources/ と ./extracted/ の資料を Read で追加確認してください。',
    task,
    '',
    '【資料抜粋】',
  ];

  chunks.forEach((chunk, i) => {
    lines.push(`--- 抜粋 ${i + 1}: ファイル名=${chunk.sourceFile}, チャンク=${chunk.chunkIndex} ---`);
    lines.push(chunk.text);
    lines.push('');
  });

  lines.push('【資料抜粋ここまで】');
  lines.push('');
  lines.push('注意:');
  lines.push('- 成果物ファイルは必ず ./artifacts/ ディレクトリの中に書き出してください。');
  lines.push('- 表計算・文書・スライド等のファイルは openpyxl / python-docx / python-pptx を使って生成してください（Bash でスクリプトを実行して構いません）。');
  lines.push('- 要約・FAQ・年表など文章主体のものは Markdown（.md）で作成してください。');
  lines.push('- 文章はアシスタントの口調を出さず、中立的な丁寧体（です・ます）で書いてください。');
  lines.push('- 資料に無い情報を創作しないでください。');
  lines.push('最後に、作成したファイル名を「作成: <ファイル名>」の形式で 1 行で報告してください。');

  return lines.join('\n');
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

  // Phase 1 診断ログ
  const requestTs = new Date().toISOString();
  const requestTime = Date.now();
  console.log(
    `[notebook-generate] request start ts=${requestTs} notebookId=${id} kind=${kind} instructionLen=${instruction.length}`,
  );

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
  console.log(`[notebook-generate] artifact count before=${before.size}`);

  // RAG チャンク検索
  const searchStart = Date.now();
  const ragChunks = await searchChunks(dir, instruction || kind).catch(() => [] as Chunk[]);
  const searchElapsed = ((Date.now() - searchStart) / 1000).toFixed(2);
  const ragPath = ragChunks.length > 0 ? 'RAG' : 'traditional';
  const pathReason = ragChunks.length > 0 ? `RAG chunks found (${ragChunks.length})` : 'Fallback no chunks';
  console.log(
    `[notebook-generate] RAG search: path=${ragPath} topK=${NOTEBOOK_RAG_TOP_K} chunkCount=${ragChunks.length} vectorDim=${ragChunks[0]?.vector.length ?? 'N/A'} elapsed=${searchElapsed}s reason=${pathReason}`,
  );

  const prompt = ragChunks.length > 0
    ? buildRagGeneratePrompt(kind, instruction, ragChunks)
    : buildGeneratePrompt(kind, instruction);
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 生成開始を即 0% で通知（クライアント側で確実に 0 から始まるようにする）。
    sseWrite(res, { type: 'progress', pct: 0 });
    let totalChars = 0;
    // Claude の生成物は長いと数千〜数万文字になるため EXPECTED_CHARS を大きくして
    // 進捗が早期に 99% に張り付かないようにする。
    const EXPECTED_CHARS = 8000;

    const claudeStart = Date.now();
    console.log(`[notebook-generate] Claude start ts=${new Date().toISOString()} method=stream kind=${kind}`);
    const result = await runClaudeStream(dir, prompt, (chunk) => {
      sseWrite(res, { type: 'chunk', text: chunk });
      totalChars += chunk.length;
      const pct = Math.min(99, Math.round((totalChars / EXPECTED_CHARS) * 100));
      sseWrite(res, { type: 'progress', pct });
    });
    const claudeElapsed = ((Date.now() - claudeStart) / 1000).toFixed(2);
    console.log(`[notebook-generate] Claude done ts=${new Date().toISOString()} elapsed=${claudeElapsed}s status=${result.ok ? 'ok' : 'error'} charsGenerated=${totalChars}`);

    sseWrite(res, { type: 'progress', pct: 100 });

    const detail = getNotebookDetail(id);
    const allArtifacts = detail?.artifacts ?? [];
    const created = allArtifacts.filter((a) => !before.has(a.name));
    touchNotebook(id);

    const totalElapsed = parseFloat(((Date.now() - requestTime) / 1000).toFixed(1));
    console.log(
      `[notebook-generate] request complete ts=${new Date().toISOString()} totalElapsed=${totalElapsed}s createdCount=${created.length} ok=${result.ok}`,
    );

    const genOk = result.ok && created.length > 0;
    const errorKind = genOk ? null : classifyEngineError(result);
    sseWrite(res, {
      type: 'done',
      ok: genOk,
      created,
      artifacts: allArtifacts,
      // エンジン失敗（上限/エラー）時は生エラー文字列を report に出さない（MC-202）。
      report: errorKind ? '' : (result.stdout || '').trim(),
      ...(errorKind ? { errorKind } : {}),
      metadata: {
        elapsed: totalElapsed,
        pathType: result.ok ? ragPath : 'error',
        chunkCount: ragChunks.length,
        pathReason,
      },
      ...(result.error ? { error: result.error } : {}),
    });
    res.end();
    return;
  }

  const claudeStart = Date.now();
  console.log(`[notebook-generate] Claude start ts=${new Date().toISOString()} method=json kind=${kind}`);
  const result = await runClaude(dir, prompt);
  const claudeElapsed = ((Date.now() - claudeStart) / 1000).toFixed(2);
  console.log(`[notebook-generate] Claude done ts=${new Date().toISOString()} elapsed=${claudeElapsed}s status=${result.ok ? 'ok' : 'error'}`);

  const detail = getNotebookDetail(id);
  const allArtifacts = detail?.artifacts ?? [];
  const created = allArtifacts.filter((a) => !before.has(a.name));

  touchNotebook(id);
  const totalElapsed = parseFloat(((Date.now() - requestTime) / 1000).toFixed(1));
  console.log(
    `[notebook-generate] request complete ts=${new Date().toISOString()} totalElapsed=${totalElapsed}s createdCount=${created.length} ok=${result.ok}`,
  );

  const genOk = result.ok && created.length > 0;
  const errorKind = genOk ? null : classifyEngineError(result);
  res.status(200).json({
    ok: genOk,
    created,
    artifacts: allArtifacts,
    // エンジン失敗（上限/エラー）時は生エラー文字列を report に出さない（MC-202）。
    report: errorKind ? '' : (result.stdout || '').trim(),
    ...(errorKind ? { errorKind } : {}),
    metadata: {
      elapsed: totalElapsed,
      pathType: ragPath,
      chunkCount: ragChunks.length,
      pathReason,
    },
    ...(result.error ? { error: result.error } : {}),
  });
}


// ─── 索引再構築 ──────────────────────────────────────────

// POST /:id/reindex — 索引を強制再構築する
async function handleReindex(req: Request, res: Response): Promise<void> {
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

  const result = await buildIndex(dir);
  res.status(200).json({
    ok: result.ok,
    chunkCount: result.chunkCount,
    fileCount: result.fileCount,
    ...(result.error ? { error: result.error } : {}),
  });
}

// ─── 議事録（Minutes）────────────────────────────────────────────

// GET /minutes/presets — ビルトインの種類・形式一覧
function handleGetPresets(_req: Request, res: Response): void {
  res.json({ types: MINUTES_TYPES, formats: MINUTES_FORMATS });
}

// GET /minutes/patterns — パターン一覧
function handleListPatterns(_req: Request, res: Response): void {
  try {
    res.json({ patterns: listPatterns() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// POST /minutes/patterns — パターン作成
function handleCreatePattern(req: Request, res: Response): void {
  const { name, type, format, templateId, templateBody, instructions } = req.body as {
    name?: string;
    type?: string;
    format?: string;
    templateId?: string;
    templateBody?: string;
    instructions?: string;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name は必須です。' });
    return;
  }
  if (!type || !['verbatim', 'summary', 'decisions', 'chronological'].includes(type)) {
    res.status(400).json({ error: 'type は verbatim/summary/decisions/chronological のいずれかです。' });
    return;
  }
  if (!format || !['markdown', 'sections', 'plain'].includes(format)) {
    res.status(400).json({ error: 'format は markdown/sections/plain のいずれかです。' });
    return;
  }
  try {
    const pattern = createPattern({
      name: name.trim(),
      type,
      format,
      ...(templateId ? { templateId } : {}),
      ...(templateBody ? { templateBody } : {}),
      ...(instructions ? { instructions } : {}),
    });
    res.status(201).json(pattern);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// DELETE /minutes/patterns/:patternId — パターン削除
function handleDeletePattern(req: Request, res: Response): void {
  const pid = req.params.patternId;
  const patternId = Array.isArray(pid) ? (pid[0] ?? '') : (pid ?? '');
  if (!patternId) {
    res.status(400).json({ error: 'patternId が必要です。' });
    return;
  }
  try {
    const removed = deletePattern(patternId);
    if (!removed) {
      res.status(404).json({ error: 'パターンが見つかりません。' });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// POST /:id/minutes/transcribe — 音声文字起こし
async function handleTranscribe(req: Request, res: Response): Promise<void> {
  const id = idParam(req);
  try {
    resolveNotebookDir(id, true);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    throw e;
  }
  const file = await runAudioUpload(req, res);
  if (!file) return;
  try {
    const text = await transcribeAudio(file.buffer, file.mimetype || 'audio/mpeg');
    res.json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[transcribe error]', msg);
    res.status(500).json({ error: msg });
  }
}

// POST /:id/minutes/extract-file — PDF / テキスト / 画像からテキスト抽出
async function handleExtractFile(req: Request, res: Response): Promise<void> {
  const id = idParam(req);
  try {
    resolveNotebookDir(id, true);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    throw e;
  }
  await new Promise<void>((resolve) => {
    uploadFileExtract(req, res, (err: unknown) => {
      if (err) {
        const msg =
          err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
            ? 'ファイルが大きすぎます（上限 50MB）。'
            : err instanceof Error
              ? err.message
              : String(err);
        res.status(413).json({ error: msg });
      }
      resolve();
    });
  });
  if (res.headersSent) return;
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: 'ファイルが見つかりません。' });
    return;
  }
  try {
    const text = await extractFileText(file.buffer, file.mimetype || 'application/octet-stream');
    res.json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[extract-file error]', msg);
    res.status(500).json({ error: msg });
  }
}

// POST /:id/minutes/export — 議事録を Word / Excel / PDF / Text でダウンロード
async function handleMinutesExport(req: Request, res: Response): Promise<void> {
  const id = idParam(req);
  const { content, format, filename } = req.body as {
    content?: string;
    format?: string;
    filename?: string;
  };

  if (!content || typeof content !== 'string') {
    res.status(400).json({ error: 'content が必要です。' });
    return;
  }
  const validFormats: ExportFormat[] = ['docx', 'xlsx', 'txt', 'pdf'];
  if (!format || !validFormats.includes(format as ExportFormat)) {
    res.status(400).json({ error: `format は ${validFormats.join(' / ')} のいずれかです。` });
    return;
  }

  try {
    const title = (filename ?? '議事録').replace(/\.[^.]+$/, '');
    const { buffer, mimeType, ext } = await exportMinutes(content, format as ExportFormat, title);
    const safeFilename = encodeURIComponent(`${title}.${ext}`);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[minutes-export error]', msg);
    res.status(500).json({ error: msg });
  }
  // resolveNotebookDir チェックは content が直接渡されるため省略
  void id;
}

// POST /:id/minutes/generate — 議事録生成（Claude 使用、既存の generate と同パターン）
async function handleMinutesGenerate(req: Request, res: Response): Promise<void> {
  const id = idParam(req);
  const {
    inputText,
    type,
    format,
    templateId,
    templateBody: reqTemplateBody,
    patternId,
    customInstructions,
  } = req.body as {
    inputText?: string;
    type?: string;
    format?: string;
    templateId?: string;
    templateBody?: string;
    patternId?: string;
    customInstructions?: string;
  };

  // patternId 指定時はパターンから設定を解決
  let resolvedType: string = type || 'summary';
  let resolvedFormat: string = format || 'markdown';
  let resolvedTemplateBody: string | undefined = reqTemplateBody;
  let resolvedInstructions: string | undefined = customInstructions;

  if (patternId) {
    const pat = listPatterns().find((p: MinutesPattern) => p.id === patternId);
    if (!pat) {
      res.status(404).json({ error: '指定されたパターンが見つかりません。' });
      return;
    }
    resolvedType = pat.type;
    resolvedFormat = pat.format;
    resolvedTemplateBody = resolvedTemplateBody || pat.templateBody;
    resolvedInstructions = resolvedInstructions || pat.instructions;
  }

  if (!inputText?.trim()) {
    res.status(400).json({ error: 'inputText は必須です。' });
    return;
  }
  if (!['verbatim', 'summary', 'decisions', 'chronological'].includes(resolvedType)) {
    res.status(400).json({ error: 'type が不正です。' });
    return;
  }
  if (!['markdown', 'sections', 'plain'].includes(resolvedFormat)) {
    res.status(400).json({ error: 'format が不正です。' });
    return;
  }

  // templateId からテンプレート本文を解決（templateBody の方が優先）
  if (!resolvedTemplateBody && templateId) {
    const tmpl = getTypePreset(resolvedType as MinutesType)?.templates.find(
      (t) => t.id === templateId,
    );
    if (tmpl) resolvedTemplateBody = tmpl.body;
  }

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

  // artifacts/ の合計サイズチェック
  const maxArtifacts = NOTEBOOK_ARTIFACT_MAX_TOTAL_BYTES;
  if (maxArtifacts > 0 && totalArtifactBytes(id) >= maxArtifacts) {
    const mb = Math.round(maxArtifacts / (1024 * 1024));
    res.status(413).json({
      error: 'artifacts の合計サイズが上限（' + mb + 'MB）に達しています。不要な生成物を削除してから再実行してください。',
    });
    return;
  }

  // artifacts/議事録/ サブフォルダを事前に作成
  try {
    mkdirSync(join(dir, 'artifacts', '議事録'), { recursive: true });
  } catch {
    /* すでに存在する場合は noop */
  }

  const prompt = buildMinutesPrompt({
    inputText: inputText.trim(),
    type: resolvedType as MinutesType,
    format: resolvedFormat as MinutesFormat,
    templateBody: resolvedTemplateBody,
    customInstructions: resolvedInstructions,
    outputFolder: './artifacts/議事録',
  });

  const before = artifactRelpaths(id);
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseWrite(res, { type: 'progress', pct: 0 });
    let totalChars = 0;
    const EXPECTED_CHARS = 6000;
    const result = await runClaudeStream(dir, prompt, (chunk) => {
      sseWrite(res, { type: 'chunk', text: chunk });
      totalChars += chunk.length;
      sseWrite(res, { type: 'progress', pct: Math.min(99, Math.round((totalChars / EXPECTED_CHARS) * 100)) });
    });
    sseWrite(res, { type: 'progress', pct: 100 });
    const detail = getNotebookDetail(id);
    const allArtifacts = detail?.artifacts ?? [];
    const created = allArtifacts.filter((a) => !before.has(a.relpath));
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
  const created = allArtifacts.filter((a) => !before.has(a.relpath));
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

// ─── フォルダ操作 ─────────────────────────────────────────

// フォルダ名バリデーション: パス区切り / \ . .. なし、50文字以内
const FOLDER_NAME_RE = /^[^/\\]+$/;
function validateFolderName(name: string): string | null {
  if (!name || !name.trim()) return 'フォルダ名が空です。';
  const trimmed = name.trim();
  if (trimmed === '.' || trimmed === '..') return 'フォルダ名が不正です。';
  if (!FOLDER_NAME_RE.test(trimmed)) return 'フォルダ名に "/" や "\\" を含めることはできません。';
  if (trimmed.length > 50) return 'フォルダ名は 50 文字以内にしてください。';
  return null;
}

// GET /:id/folders — フォルダツリー取得
function handleGetFolders(req: Request, res: Response): void {
  safe(res, () => {
    const id = idParam(req);
    const tree = listArtifactFolderTree(id);
    return tree;
  });
}

// POST /:id/folders — フォルダ作成
function handleCreateFolder(req: Request, res: Response): void {
  const id = idParam(req);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const err = validateFolderName(name);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  safe(res, () => {
    createArtifactFolder(id, name);
    return { ok: true, name };
  });
}

// PUT /:id/artifacts — 成果物コンテンツ更新
function handleUpdateArtifact(req: Request, res: Response): void {
  const id = idParam(req);
  const { relpath, content } = req.body as { relpath?: string; content?: string };
  if (!relpath || typeof relpath !== 'string') {
    res.status(400).json({ error: 'relpath が必要です。' });
    return;
  }
  if (content === undefined || content === null) {
    res.status(400).json({ error: 'content が必要です。' });
    return;
  }
  safe(res, () => {
    updateArtifactContent(id, relpath, content as string);
    touchNotebook(id);
    return { ok: true };
  });
}

// GET /:id/debug-log — ノートブック診断ログのダウンロード
function handleDebugLog(req: Request, res: Response): void {
  const id = idParam(req);
  try {
    const dir = resolveNotebookDir(id, false);
    const logFile = join(dir, 'logs', `notebooks-${id}.log`);

    if (!existsSync(logFile)) {
      res.status(404).json({ error: 'ログファイルが見つかりません。' });
      return;
    }

    const content = readFileSync(logFile, 'utf-8');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="notebooks-${id}.log"`);
    res.send(content);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
}

// ─── Router 組み立て ─────────────────────────────────────

export function notebookRouter(): Router {
  const router = Router();
  // 議事録グローバルルート（/:id より前に定義すること）
  router.get('/minutes/presets', handleGetPresets);
  router.get('/minutes/patterns', handleListPatterns);
  router.post('/minutes/patterns', handleCreatePattern);
  router.delete('/minutes/patterns/:patternId', handleDeletePattern);
  router.get('/', handleList);
  router.post('/', handleCreate);
  router.get('/:id', handleGet);
  router.get('/:id/status', handleStatus);
  router.patch('/:id', (req, res) => void handleRename(req, res));
  router.delete('/:id', handleDelete);
  router.get('/:id/file', (req, res) => void handleFile(req, res));
  router.get('/:id/folders', handleGetFolders);
  router.post('/:id/folders', handleCreateFolder);
  router.put('/:id/artifacts', handleUpdateArtifact);
  router.post('/:id/sources', (req, res) => void handleAddSources(req, res));
  router.delete('/:id/sources', handleDeleteSource);
  router.post('/:id/ask', (req, res) => void handleAsk(req, res));
  router.post('/:id/generate', (req, res) => void handleGenerate(req, res));
  router.post('/:id/reindex', (req, res) => void handleReindex(req, res));
  router.get('/:id/debug-log', handleDebugLog);
  router.post('/:id/minutes/transcribe', (req, res) => void handleTranscribe(req, res));
  router.post('/:id/minutes/extract-file', (req, res) => void handleExtractFile(req, res));
  router.post('/:id/minutes/export', (req, res) => void handleMinutesExport(req, res));
  router.post('/:id/minutes/generate', (req, res) => void handleMinutesGenerate(req, res));
  return router;
}
