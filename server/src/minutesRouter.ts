// minutesRouter — 議事録を Deliverables（成果物）へ直接保存する API（notebook 非依存）。
//
// notebookRouter.ts の議事録ハンドラ（transcribe / extract-file / generate / export）を
// ほぼ流用するが、notebook id を不要にし、生成結果を saveMinutesToDeliverables() で
// DELIVERABLES_DIR/議事録/<日付>_<タイトル>/ に保存する。
//
// ルート（index.ts で /api/minutes に mount、auth 配下）:
//   POST /transcribe    音声文字起こし（multipart "audio"）
//   POST /extract-file  PDF/テキスト/画像からテキスト抽出（multipart "file"）
//   POST /generate      議事録生成（Claude）→ Deliverables 保存
//   POST /export        議事録を Word/Excel/PDF/Text でダウンロード

import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import { transcribeAudio, extractFileText } from './lib/transcribe.js';
import {
  getTypePreset,
  buildMinutesPrompt,
  type MinutesType,
  type MinutesFormat,
} from './lib/minutesPresets.js';
import { listPatterns, type MinutesPattern } from './lib/minutesPatterns.js';
import { exportMinutes, type ExportFormat } from './lib/minutesExport.js';
import { runClaude, runClaudeStream } from './lib/notebookClaude.js';
import { saveMinutesToDeliverables } from './lib/minutesDeliverables.js';
import { DELIVERABLES_DIR } from './config.js';

// 音声文字起こし用 multer（memoryStorage）
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
}).single('audio');

// ファイルテキスト抽出用 multer（PDF / テキスト / 画像）
const uploadFileExtract = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
}).single('file');

// 生成時の元ファイル添付用 multer（複数可、議事録フォルダの sources/ に保存する）
const uploadSourceFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
}).array('sourceFiles', 10);

function runSourceUpload(req: Request, res: Response): Promise<Express.Multer.File[]> {
  return new Promise((resolve) => {
    uploadSourceFiles(req, res, (err: unknown) => {
      if (err) {
        // アップロード失敗時もファイルなしで処理続行（元ファイル保存は best-effort）。
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[minutes source upload error]', msg);
        resolve([]);
        return;
      }
      const files = (req as Request & { files?: Express.Multer.File[] }).files;
      resolve(Array.isArray(files) ? files : []);
    });
  });
}

function extOf(name: string): string {
  const m = /\.[^.]+$/.exec(name || '');
  return m ? m[0] : '';
}

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

/** SSE イベントを 1 行書き出す。 */
function sseWrite(res: Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── POST /transcribe ───────────────────────────────────────
async function handleTranscribe(req: Request, res: Response): Promise<void> {
  const file = await runAudioUpload(req, res);
  if (!file) return;
  try {
    const text = await transcribeAudio(file.buffer, file.mimetype || 'audio/mpeg');
    res.json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[minutes transcribe error]', msg);
    res.status(500).json({ error: msg });
  }
}

// ─── POST /extract-file ─────────────────────────────────────
async function handleExtractFile(req: Request, res: Response): Promise<void> {
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
    console.error('[minutes extract-file error]', msg);
    res.status(500).json({ error: msg });
  }
}

// ─── POST /export ───────────────────────────────────────────
async function handleMinutesExport(req: Request, res: Response): Promise<void> {
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
}

// ─── POST /generate ─────────────────────────────────────────
// notebook を使わず、一時 dir で claude を起動して ./議事録.md を生成させ、
// 読み戻して saveMinutesToDeliverables() で Deliverables に保存する。

/** 生成された議事録 md からタイトル（最初の見出し）を抽出する。 */
function deriveTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/^#{1,3}\s+(.+)$/m);
  const t = m?.[1]?.trim();
  if (t) return t.replace(/[#*`]/g, '').slice(0, 60);
  return fallback;
}

async function handleMinutesGenerate(req: Request, res: Response): Promise<void> {
  // multipart/form-data の場合は元ファイル群を受け取る（body フィールドは文字列で来る）。
  const isMultipart = (req.headers['content-type'] ?? '').includes('multipart/form-data');
  let sourceFiles: Express.Multer.File[] = [];
  if (isMultipart) {
    sourceFiles = await runSourceUpload(req, res);
    if (res.headersSent) return;
  }

  const {
    inputText,
    type,
    format,
    templateId,
    templateBody: reqTemplateBody,
    patternId,
    customInstructions,
    feedback,
    previousContent,
    exportFormats: exportFormatsRaw,
  } = req.body as {
    inputText?: string;
    type?: string;
    format?: string;
    templateId?: string;
    templateBody?: string;
    patternId?: string;
    customInstructions?: string;
    feedback?: string;
    previousContent?: string;
    exportFormats?: string | string[];
  };
  // multipart では配列でなく繰り返しフィールドか JSON 文字列で来る場合がある
  const exportFormats: ExportFormat[] = (
    Array.isArray(exportFormatsRaw)
      ? exportFormatsRaw
      : typeof exportFormatsRaw === 'string'
        ? exportFormatsRaw.startsWith('[') ? (JSON.parse(exportFormatsRaw) as string[]) : [exportFormatsRaw]
        : []
  ).filter((f): f is ExportFormat => ['docx', 'xlsx', 'txt', 'pdf'].includes(f));

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

  if (!resolvedTemplateBody && templateId) {
    const tmpl = getTypePreset(resolvedType as MinutesType)?.templates.find(
      (t) => t.id === templateId,
    );
    if (tmpl) resolvedTemplateBody = tmpl.body;
  }

  // 一時 dir を cwd にして claude を起動し ./議事録*.md を生成させる。
  const workDir = mkdtempSync(join(tmpdir(), 'apollo-minutes-'));
  // Claude 起動前の時刻。ファイル検索でこれ以降に作成されたファイルのみを対象にする。
  const startedAt = Date.now();

  // 出力ファイルの想定パス（Claude が正しくこのパスに書いた場合に使う）
  const outFilePath = join(workDir, '議事録.md');
  const prompt = buildMinutesPrompt({
    inputText: inputText.trim(),
    type: resolvedType as MinutesType,
    format: resolvedFormat as MinutesFormat,
    templateBody: resolvedTemplateBody,
    customInstructions: resolvedInstructions,
    feedback: typeof feedback === 'string' ? feedback : undefined,
    previousContent: typeof previousContent === 'string' ? previousContent : undefined,
    // './artifacts' を指定: wrapper script が artifacts/ を rsync で新箱に転送する。
    // 絶対パスを渡すと、リモート実行時にそのパスが存在せず書き込みに失敗する。
    outputFolder: './artifacts',
  });

  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  const finish = async (result: { ok: boolean; error?: string; report: string }): Promise<void> => {
    let markdown = '';
    let foundMdPath: string | undefined;

    /**
     * ディレクトリを再帰的に探索（最大 depth=3）して「議事録」を含む .md を返す。
     * sinceMs を指定した場合はそれ以降に変更されたファイルのみ対象にする。
     */
    function findMinutesMdRecursive(dir: string, sinceMs?: number, depth = 0): string | undefined {
      if (depth > 3) return undefined;
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const sub = findMinutesMdRecursive(join(dir, entry.name), sinceMs, depth + 1);
            if (sub) return sub;
          } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name.includes('議事録')) {
            const full = join(dir, entry.name);
            if (sinceMs !== undefined) {
              try { if (statSync(full).mtimeMs < sinceMs) continue; } catch { continue; }
            }
            return full;
          }
        }
      } catch { /* noop */ }
      return undefined;
    }

    // 検索順 1: 指定したoutFilePath（Claude が正しく書いた場合）
    if (existsSync(outFilePath)) {
      foundMdPath = outFilePath;
    }
    // 検索順 2: workDir 再帰（Claude が artifacts/ 等サブフォルダに書いた場合）
    if (!foundMdPath && existsSync(workDir)) {
      foundMdPath = findMinutesMdRecursive(workDir);
    }
    // 検索順 3: PROJECTS_DIR トップレベルのみ（Claude が ~/projects/ に書いた場合、startedAt 以降のみ）
    if (!foundMdPath) {
      const projectsDir = join('/home/dev', 'projects');
      if (existsSync(projectsDir)) {
        // トップレベルのみ（再帰なし）でチェック。大量ファイルを走査しないよう sinceMs でフィルタ。
        try {
          for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.md') && entry.name.includes('議事録')) {
              const full = join(projectsDir, entry.name);
              try {
                if (statSync(full).mtimeMs >= startedAt) { foundMdPath = full; break; }
              } catch { /* noop */ }
            }
          }
        } catch { /* noop */ }
      }
    }

    if (foundMdPath) {
      try {
        markdown = readFileSync(foundMdPath, 'utf-8');
        // workDir 以外から読んだ場合はファイルを削除してクリーンアップする
        if (!foundMdPath.startsWith(workDir)) {
          try { rmSync(foundMdPath); } catch { /* noop */ }
        }
      } catch {
        markdown = '';
      }
    }
    let saved: ReturnType<typeof saveMinutesToDeliverables> | null = null;
    let saveError: string | undefined;
    if (markdown.trim()) {
      try {
        const title = deriveTitle(markdown, '議事録');
        const mappedSources = sourceFiles.map((f) => ({
          name: f.originalname || `source${extOf(f.originalname)}`,
          buffer: f.buffer,
          ext: extOf(f.originalname),
        }));
        saved = saveMinutesToDeliverables({
          title,
          markdownContent: markdown,
          ...(mappedSources.length > 0 ? { sourceFiles: mappedSources } : {}),
        });

        // 選択されたエクスポート形式もフォルダに保存する
        if (saved && exportFormats.length > 0) {
          const folderAbs = join(DELIVERABLES_DIR, saved.folderRelpath);
          for (const fmt of exportFormats) {
            try {
              const { buffer, ext } = await exportMinutes(markdown, fmt, title);
              writeFileSync(join(folderAbs, `議事録.${ext}`), buffer);
            } catch {
              // エクスポート失敗は警告のみ（MD保存は成功済み）
            }
          }
        }
      } catch (e) {
        saveError = e instanceof Error ? e.message : String(e);
      }
    }
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }

    // ファイルが見つかり保存できていれば ok=true（claude の exit code は参考程度）
    const ok = !!saved;
    const created = saved
      ? [
          {
            name: '議事録.md',
            relpath: saved.minutesRelpath,
            sizeBytes: Buffer.byteLength(markdown, 'utf-8'),
            mtime: new Date().toISOString(),
            ext: '.md',
            kind: 'markdown' as const,
          },
        ]
      : [];

    const payload = {
      ok,
      created,
      artifacts: created,
      report: result.report,
      ...(saved ? { deliverableRelpath: saved.minutesRelpath } : {}),
      ...(result.error || saveError
        ? { error: result.error || saveError || '議事録を保存できませんでした。' }
        : {}),
    };

    if (wantsStream) {
      sseWrite(res, { type: 'progress', pct: 100 });
      sseWrite(res, { type: 'done', ...payload });
      res.end();
    } else {
      res.status(200).json(payload);
    }
  };

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseWrite(res, { type: 'progress', pct: 0 });

    // 進捗の現在値。chunk ベースと時間ベースのうち大きい方を採用し、後退させない。
    let reportedPct = 0;
    const pushProgress = (pct: number): void => {
      const next = Math.min(99, Math.max(0, Math.round(pct)));
      if (next > reportedPct) {
        reportedPct = next;
        sseWrite(res, { type: 'progress', pct: reportedPct });
      }
    };

    // SSH ラッパー経由だと stdout が逐次来ず最後にまとめて flush される。
    // その間バーが固まらないよう、時間ベースの疑似進捗（sqrt カーブ、最大95%）を定期送出する。
    const startedStream = Date.now();
    const EXPECTED_MS = 120_000; // 想定 2 分
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedStream;
      pushProgress(Math.sqrt(elapsed / EXPECTED_MS) * 95);
    }, 1000);

    let totalChars = 0;
    const EXPECTED_CHARS = 6000;
    let result: Awaited<ReturnType<typeof runClaudeStream>>;
    try {
      result = await runClaudeStream(workDir, prompt, (chunk) => {
        sseWrite(res, { type: 'chunk', text: chunk });
        totalChars += chunk.length;
        pushProgress((totalChars / EXPECTED_CHARS) * 100);
      });
    } finally {
      clearInterval(timer);
    }
    await finish({ ok: result.ok, error: result.error, report: (result.stdout || '').trim() });
    return;
  }

  const result = await runClaude(workDir, prompt);
  await finish({ ok: result.ok, error: result.error, report: (result.stdout || '').trim() });
}

// ─── Router 組み立て ─────────────────────────────────────
export function minutesRouter(): Router {
  const router = Router();
  router.post('/transcribe', (req, res) => void handleTranscribe(req, res));
  router.post('/extract-file', (req, res) => void handleExtractFile(req, res));
  router.post('/export', (req, res) => void handleMinutesExport(req, res));
  router.post('/generate', (req, res) => void handleMinutesGenerate(req, res));
  return router;
}
