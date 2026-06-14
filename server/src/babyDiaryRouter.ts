// babyDiaryRouter — 成長日記（MC-233 Phase1）の REST API（auth ミドルウェア配下）。
//
//  GET    /api/baby-diary               : { generatedAt, entries[], media[] }（date 昇順）
//  POST   /api/baby-diary/entry         : JSON { date, memo?, milestone?, heightCm?, weightKg? } で upsert
//  DELETE /api/baby-diary/entry/:date   : 該当 date のエントリを論理削除
//  POST   /api/baby-diary/media         : multipart files[]（最大10）+ body.date でメディア追加
//  GET    /api/baby-diary/media/:id     : メディア実体をストリーム配信（mime をメタから）
//  DELETE /api/baby-diary/media/:id     : 実体ファイル削除 ＋ メタ論理削除
//
// 流儀は terminalUpload.ts（multer diskStorage・MIME 検証・sanitizeFilename）と
// approvalRequestStore.ts（JSONL last-wins）に倣う。保存先はすべて data/ 配下（.gitignore 済み）。
// パストラバーサルは「id でメタ検索 → 保存名で BABY_DIARY_MEDIA_DIR 内に解決 → realpath 確認」で防ぐ。

import { randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import {
  BABY_DIARY_MEDIA_DIR,
  BABY_DIARY_MEDIA_MAX_BYTES,
  BABY_DIARY_MEDIA_MAX_FILES,
} from './config.js';
import { sanitizeFilename } from './lib/inboxPath.js';
import {
  appendMedia,
  deleteEntry,
  deleteMedia,
  getMedia,
  listEntries,
  listMedia,
  upsertEntry,
  type MediaMeta,
} from './lib/babyDiaryStore.js';

// ─── バリデーション ─────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD 形式か。 */
function isValidDate(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v);
}

// ─── 許可 MIME（画像 / 動画）────────────────────────────────
// 画像: png/jpeg/webp/gif/heic、動画: mp4/quicktime/webm。
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic']);
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/** MIME から種別を判定。許可外は null。 */
function kindOf(mime: string): 'image' | 'video' | null {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  if (IMAGE_MIME.has(m)) return 'image';
  if (VIDEO_MIME.has(m)) return 'video';
  return null;
}

// ─── multer（diskStorage・ストリーム保存）────────────────────
// 動画含め最大 1GB をメモリに載せないため diskStorage を使う（terminalUpload と同方針）。
// 保存名は <id>-<safe-name> 形式。id はファイルごとに発番し、メタの id と保存名を 1:1 対応させる。
// fileFilter で MIME を弾き、サイズ/枚数は limits で弾く。
// 各ファイルの発番 id を後段（メタ append）でも使うため、filename コールバックで採番して
// (req as any)._babyDiaryIds に記録する。multer は同一リクエスト内で files を順次処理するため、
// originalname と push 順で対応が取れる。

interface UploadIdEntry {
  id: string;
  filename: string;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      mkdirSync(BABY_DIARY_MEDIA_DIR, { recursive: true });
      cb(null, BABY_DIARY_MEDIA_DIR);
    },
    filename(req, file, cb) {
      const id = randomUUID();
      const safe = sanitizeFilename(file.originalname || 'media');
      const filename = `${id}-${safe}`;
      const bag = ((req as Request & { _babyDiaryIds?: UploadIdEntry[] })._babyDiaryIds ??= []);
      bag.push({ id, filename });
      cb(null, filename);
    },
  }),
  limits: {
    fileSize: BABY_DIARY_MEDIA_MAX_BYTES,
    files: BABY_DIARY_MEDIA_MAX_FILES,
  },
  fileFilter(_req, file, cb) {
    if (!kindOf(file.mimetype)) {
      cb(new Error('unsupported media type: images (png/jpeg/webp/gif/heic) and videos (mp4/quicktime/webm) are allowed'));
      return;
    }
    cb(null, true);
  },
});

const uploadFiles = upload.array('files', BABY_DIARY_MEDIA_MAX_FILES);

/** multer を Promise 化。サイズ/枚数超過・MIME reject は 400 を送って false を返す。 */
function runUpload(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve_) => {
    uploadFiles(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
        resolve_(false);
        return;
      }
      resolve_(true);
    });
  });
}

// ─── メディア実体パスの安全解決（パストラバーサル防止）──────────
// 保存名（メタ由来）を BABY_DIARY_MEDIA_DIR 配下に resolve し、境界＋realpath で配下を確認する。
// inboxPath.ts の isInside / realpath 方式に倣う。

let mediaRoot: string | null = null;
function diaryMediaRoot(): string {
  if (mediaRoot) return mediaRoot;
  try {
    mediaRoot = realpathSync(BABY_DIARY_MEDIA_DIR);
  } catch {
    mediaRoot = resolve(BABY_DIARY_MEDIA_DIR);
  }
  return mediaRoot;
}

/** target が base 配下か（境界文字付きで prefix 詐称を防ぐ）。 */
function isInside(base: string, target: string): boolean {
  if (target === base) return true;
  const rel = relative(base, target);
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel);
}

/**
 * メタ由来の保存名を BABY_DIARY_MEDIA_DIR 配下の安全な絶対パスに解決する。
 * filename は basename 想定だが、念のため区切り/絶対パスを弾いてから resolve・realpath 確認する。
 * 配下外・不正は null（呼び出し側で 404）。
 */
function resolveMediaPath(filename: string): string | null {
  if (!filename || filename.includes('/') || filename.includes('\\') || isAbsolute(filename)) {
    return null;
  }
  const root = diaryMediaRoot();
  const abs = resolve(root, filename);
  if (!isInside(root, abs)) return null;
  try {
    const real = realpathSync(abs);
    if (!isInside(root, real)) return null;
    return real;
  } catch {
    // 実体が無い（メタはあるがファイル消失）。404 にしたいので null。
    return null;
  }
}

// ─── ハンドラ ───────────────────────────────────────────

/** GET /api/baby-diary — エントリ＋メディアの一覧。 */
function handleList(_req: Request, res: Response): void {
  res.json({
    generatedAt: new Date().toISOString(),
    entries: listEntries(),
    media: listMedia(),
  });
}

/** POST /api/baby-diary/entry — date キーで upsert。 */
function handleUpsertEntry(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!isValidDate(body.date)) {
    res.status(400).json({ error: 'date is required and must be YYYY-MM-DD' });
    return;
  }

  // memo / milestone は文字列（空文字許容）。非文字列は 400。
  for (const key of ['memo', 'milestone'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      res.status(400).json({ error: `${key} must be a string` });
      return;
    }
  }

  // height / weight は数値（有限）。非数値・NaN・Infinity は 400。
  const nums: { heightCm?: number; weightKg?: number } = {};
  for (const key of ['heightCm', 'weightKg'] as const) {
    const v = body[key];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (typeof v !== 'number' && typeof v !== 'string') {
      res.status(400).json({ error: `${key} must be a number` });
      return;
    }
    if (!Number.isFinite(n)) {
      res.status(400).json({ error: `${key} must be a finite number` });
      return;
    }
    nums[key] = n;
  }

  const saved = upsertEntry({
    date: body.date,
    memo: typeof body.memo === 'string' ? body.memo : undefined,
    milestone: typeof body.milestone === 'string' ? body.milestone : undefined,
    heightCm: nums.heightCm,
    weightKg: nums.weightKg,
  });
  res.json(saved);
}

/** DELETE /api/baby-diary/entry/:date — 論理削除。 */
function handleDeleteEntry(req: Request, res: Response): void {
  const date = String(req.params.date);
  if (!isValidDate(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  deleteEntry(date);
  res.json({ ok: true, date });
}

/** POST /api/baby-diary/media — multipart files[] + body.date でメディア追加。 */
async function handleUploadMedia(req: Request, res: Response): Promise<void> {
  mkdirSync(BABY_DIARY_MEDIA_DIR, { recursive: true });

  const ok = await runUpload(req, res);
  if (!ok) return;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const idBag = (req as Request & { _babyDiaryIds?: UploadIdEntry[] })._babyDiaryIds ?? [];

  // date バリデーション（multer 処理後に body が埋まる）。不正なら保存済みファイルを片付けて 400。
  const date = (req.body as { date?: unknown } | undefined)?.date;
  if (!isValidDate(date)) {
    for (const f of files) {
      const abs = f.path ?? join(BABY_DIARY_MEDIA_DIR, f.filename);
      try { unlinkSync(abs); } catch { /* 片付け失敗は無視 */ }
    }
    res.status(400).json({ error: 'date is required and must be YYYY-MM-DD' });
    return;
  }

  if (files.length === 0) {
    res.status(400).json({ error: 'at least one file is required (field name: files)' });
    return;
  }

  const now = new Date().toISOString();
  const saved: MediaMeta[] = [];
  for (const f of files) {
    const kind = kindOf(f.mimetype);
    // fileFilter で gate 済みだが念のため二重チェック。NG なら片付けて 400。
    if (!kind) {
      const abs = f.path ?? join(BABY_DIARY_MEDIA_DIR, f.filename);
      try { unlinkSync(abs); } catch { /* 無視 */ }
      res.status(400).json({ error: `unsupported media type: ${f.mimetype}` });
      return;
    }
    // filename から発番 id を引く（filename コールバックで採番済み）。
    const entry = idBag.find((e) => e.filename === f.filename);
    const id = entry?.id ?? randomUUID();
    const meta = appendMedia({
      id,
      date,
      filename: f.filename,
      originalName: f.originalname,
      mime: f.mimetype,
      kind,
      size: f.size,
      createdAt: now,
    });
    saved.push(meta);
  }

  res.status(201).json({ media: saved });
}

/** GET /api/baby-diary/media/:id — 実体ストリーム配信。 */
function handleStreamMedia(req: Request, res: Response): void {
  const meta = getMedia(String(req.params.id));
  if (!meta) {
    res.status(404).json({ error: 'media not found' });
    return;
  }
  const abs = resolveMediaPath(meta.filename);
  if (!abs) {
    res.status(404).json({ error: 'media file not found' });
    return;
  }
  let total = 0;
  try {
    const st = statSync(abs);
    if (!st.isFile()) {
      res.status(404).json({ error: 'media file not found' });
      return;
    }
    total = st.size;
  } catch {
    res.status(404).json({ error: 'media file not found' });
    return;
  }
  res.type(meta.mime);
  res.set('Cache-Control', 'private, max-age=300');
  // 動画の再生・シーク（特に iOS/Safari）には HTTP Range（206 部分配信）が必須。
  res.set('Accept-Ranges', 'bytes');

  const onErr = (stream: ReturnType<typeof createReadStream>) =>
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'failed to read media' });
      else res.destroy();
    });

  const range = req.headers.range;
  const m = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && total > 0) {
    let start = m[1] === '' ? 0 : Number(m[1]);
    let end = m[2] === '' ? total - 1 : Number(m[2]);
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      res.status(416).set('Content-Range', `bytes */${total}`).end();
      return;
    }
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${total}`);
    res.set('Content-Length', String(end - start + 1));
    const stream = createReadStream(abs, { start, end });
    onErr(stream);
    stream.pipe(res);
    return;
  }

  res.set('Content-Length', String(total));
  const stream = createReadStream(abs);
  onErr(stream);
  stream.pipe(res);
}

/** DELETE /api/baby-diary/media/:id — 実体削除 ＋ メタ論理削除。 */
function handleDeleteMedia(req: Request, res: Response): void {
  const id = String(req.params.id);
  const meta = getMedia(id);
  if (!meta) {
    res.status(404).json({ error: 'media not found' });
    return;
  }
  // 実体を削除（パストラバーサル安全解決）。不在でもメタ論理削除は進める。
  const abs = resolveMediaPath(meta.filename);
  if (abs) {
    try { unlinkSync(abs); } catch { /* 既に無い場合は無視 */ }
  }
  deleteMedia(id);
  res.json({ ok: true, id });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/baby-diary 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function babyDiaryRouter(): Router {
  const router = Router();
  router.get('/', handleList);
  router.post('/entry', handleUpsertEntry);
  router.delete('/entry/:date', handleDeleteEntry);
  router.post('/media', (req, res) => void handleUploadMedia(req, res));
  router.get('/media/:id', handleStreamMedia);
  router.delete('/media/:id', handleDeleteMedia);
  return router;
}
