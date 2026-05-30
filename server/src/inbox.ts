// inbox — 非同期 指示受信箱（Apollo サーバ側）。
//
// Keita がスマホから Apollo 経由でタスク/指示を投入し、画像も添付できる。
// 投入分は別プロセスの自律林が次ティックで拾う（このサーバは書き込み + 一覧 + 配信のみ）。
//
// ストレージ契約（自律林側と一致。厳守）:
//  - 受信箱本体:   data/inbox.jsonl           （追記専用・1 行 1 エントリ JSON）
//  - 消費記録:     data/inbox-consumed.jsonl  （自律林が処理後に id を追記。サーバは読むだけ）
//  - 添付画像:     data/inbox-attachments/<id>/<安全なファイル名>
//
// エントリ構造:
//  { id, ts, kind:"task"|"instruction", project:"logic"|"cxo"|"en-chakai"|null,
//    text, status:"pending", attachments:[ "data/inbox-attachments/<id>/a.png", ... ] }

import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import {
  INBOX_DATA_DIR,
  INBOX_FILE,
  INBOX_CONSUMED_FILE,
  INBOX_ATTACHMENTS_DIR,
  INBOX_MAX_FILE_BYTES,
  INBOX_MAX_FILES,
} from './config.js';
import {
  sanitizeFilename,
  resetAttachmentsRoot,
  resolveCxoRelativeAttachment,
  contentTypeFor,
  InboxPathError,
} from './lib/inboxPath.js';

// ─── 型 ────────────────────────────────────────────────

/** project は固定 3 種 + null（未指定）。 */
const ALLOWED_PROJECTS = ['logic', 'cxo', 'en-chakai'] as const;
type InboxProject = (typeof ALLOWED_PROJECTS)[number];

const ALLOWED_KINDS = ['task', 'instruction'] as const;
type InboxKind = (typeof ALLOWED_KINDS)[number];

export interface InboxEntry {
  id: string;
  ts: string;
  kind: InboxKind;
  project: InboxProject | null;
  text: string;
  status: 'pending';
  attachments: string[];
}

// ─── ディレクトリ準備 ────────────────────────────────────

/** data/ と inbox-attachments/ を作る（存在すれば何もしない）。 */
function ensureDataDirs(): void {
  mkdirSync(INBOX_DATA_DIR, { recursive: true });
  mkdirSync(INBOX_ATTACHMENTS_DIR, { recursive: true });
  // 初回 mkdir で実体ができたら realpath ベースを取り直す。
  resetAttachmentsRoot();
}

// ─── ID 採番 ────────────────────────────────────────────

/**
 * 時刻 + 乱数の一意 ID。ISO の記号をファイル名安全に潰す。
 * 例: 2026-05-30T12-34-56-789Z-a1b2c3d4
 */
function genId(now: Date): string {
  const iso = now.toISOString().replace(/[:.]/g, '-');
  const rand = randomBytes(4).toString('hex');
  return `${iso}-${rand}`;
}

// ─── バリデーション ─────────────────────────────────────

function parseKind(v: unknown): InboxKind | { error: string } {
  if (typeof v !== 'string' || v.trim() === '') {
    return { error: 'kind is required (task|instruction)' };
  }
  const k = v.trim();
  if (!(ALLOWED_KINDS as readonly string[]).includes(k)) {
    return { error: `kind must be one of: ${ALLOWED_KINDS.join(', ')}` };
  }
  return k as InboxKind;
}

function parseProject(v: unknown): InboxProject | null | { error: string } {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return { error: 'project must be a string' };
  const p = v.trim();
  if (p === '' || p === 'null') return null;
  if (!(ALLOWED_PROJECTS as readonly string[]).includes(p)) {
    return { error: `project must be one of: ${ALLOWED_PROJECTS.join(', ')} (or omitted)` };
  }
  return p as InboxProject;
}

function parseText(v: unknown): string | { error: string } {
  if (typeof v !== 'string' || v.trim() === '') {
    return { error: 'text is required and must be non-empty' };
  }
  return v;
}

// ─── multer（メモリ保存）──────────────────────────────────
//
// id 採番より前にファイルが届くため、いったんメモリに溜めてから
// id 確定後に <id>/ ディレクトリへ書き出す。
// content-type は image/* のみ許可。1 枚最大 10MB・最大 5 枚。

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: INBOX_MAX_FILE_BYTES,
    files: INBOX_MAX_FILES,
  },
  fileFilter(_req, file, cb) {
    if (!/^image\//i.test(file.mimetype)) {
      cb(new Error('only image/* attachments are allowed'));
      return;
    }
    cb(null, true);
  },
});

// multer のエラー（サイズ超過・枚数超過・fileFilter reject）を 400 にマップする
// ラッパー。express の error-first ミドルウェア形式で受ける。
const uploadImages = upload.array('images', INBOX_MAX_FILES);

function runUpload(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    uploadImages(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

// ─── 永続化 ─────────────────────────────────────────────

/** entry を inbox.jsonl に 1 行追記する。 */
function appendEntry(entry: InboxEntry): void {
  appendFileSync(INBOX_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * inbox.jsonl を読み、壊れた行を飛ばして InboxEntry 配列を返す。
 * 無ければ空配列。
 */
function readInboxEntries(): InboxEntry[] {
  let raw: string;
  try {
    raw = readFileSync(INBOX_FILE, 'utf-8');
  } catch {
    return [];
  }
  const out: InboxEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as InboxEntry);
    } catch {
      // 壊れた行は無視
    }
  }
  return out;
}

/** inbox-consumed.jsonl から消費済み id の集合を返す。 */
function readConsumedIds(): Set<string> {
  const ids = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(INBOX_CONSUMED_FILE, 'utf-8');
  } catch {
    return ids;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    // 「id だけ」or「{"id": "..."} の JSON」両形式を許容する。
    if (t.startsWith('{')) {
      try {
        const obj = JSON.parse(t) as { id?: unknown };
        if (typeof obj.id === 'string' && obj.id) ids.add(obj.id);
        continue;
      } catch {
        // 壊れた JSON 行は素の文字列として扱う。
      }
    }
    ids.add(t);
  }
  return ids;
}

// ─── ハンドラ ───────────────────────────────────────────

/** POST /api/inbox — multipart/form-data を受けてエントリを追記。 */
async function handlePost(req: Request, res: Response): Promise<void> {
  ensureDataDirs();

  // multipart をパース（失敗時は runUpload が 400 を送って false を返す）。
  const ok = await runUpload(req, res);
  if (!ok) return;

  const body = (req.body ?? {}) as Record<string, unknown>;

  const kind = parseKind(body.kind);
  if (typeof kind === 'object') {
    res.status(400).json({ error: kind.error });
    return;
  }
  const project = parseProject(body.project);
  if (project !== null && typeof project === 'object') {
    res.status(400).json({ error: project.error });
    return;
  }
  const text = parseText(body.text);
  if (typeof text === 'object') {
    res.status(400).json({ error: text.error });
    return;
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  const now = new Date();
  const id = genId(now);

  // 添付を <id>/ に書き出す。ファイル名はサニタイズし、衝突は連番で回避。
  const attachments: string[] = [];
  if (files.length > 0) {
    const dir = join(INBOX_ATTACHMENTS_DIR, id);
    mkdirSync(dir, { recursive: true });
    const used = new Set<string>();
    for (const f of files) {
      let fname = sanitizeFilename(f.originalname || 'image');
      // 同名衝突を避ける。
      if (used.has(fname)) {
        const dot = fname.lastIndexOf('.');
        const stem = dot > 0 ? fname.slice(0, dot) : fname;
        const ext = dot > 0 ? fname.slice(dot) : '';
        let n = 1;
        while (used.has(`${stem}-${n}${ext}`)) n += 1;
        fname = `${stem}-${n}${ext}`;
      }
      used.add(fname);
      writeFileSync(join(dir, fname), f.buffer);
      // cxo-agent ルートからの相対パスで格納する。
      attachments.push(`data/inbox-attachments/${id}/${fname}`);
    }
  }

  const entry: InboxEntry = {
    id,
    ts: now.toISOString(),
    kind,
    project: project as InboxProject | null,
    text,
    status: 'pending',
    attachments,
  };

  appendEntry(entry);
  res.status(201).json(entry);
}

/** GET /api/inbox — consumed を除いた pending 一覧を返す。 */
function handleList(_req: Request, res: Response): void {
  const consumed = readConsumedIds();
  const pending = readInboxEntries().filter((e) => e && e.id && !consumed.has(e.id));
  res.json({ pending });
}

/** GET /api/inbox/attachment?path=... — data/inbox-attachments 配下の画像を安全配信。 */
function handleAttachment(req: Request, res: Response): void {
  try {
    const abs = resolveCxoRelativeAttachment(req.query.path);
    res.type(contentTypeFor(abs));
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'attachment not found' });
      }
    });
  } catch (e) {
    if (e instanceof InboxPathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/inbox 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function inboxRouter(): Router {
  const router = Router();
  router.post('/', (req, res) => void handlePost(req, res));
  router.get('/', handleList);
  router.get('/attachment', handleAttachment);
  return router;
}
