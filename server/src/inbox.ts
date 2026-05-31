// inbox — 非同期 タスク受信箱（Apollo サーバ側）。
//
// Keita がスマホから Apollo 経由でタスクを投入し、画像も添付できる。
// MC-77: 「タスク/指示」の区別は廃止し、投入は全て task として扱う。
// 投入時にその場で正本 TASK_TRACKER.md へ 1 タスク追記し（taskTrackerAppend）、
// 手動消化（autonomous-rin）を待たず即タスクボードに出す。inbox.jsonl は監査・
// 添付画像のため引き続き残す。自律林は taskId 済みエントリを二重登録しない。
//
// ストレージ契約（自律林側と一致。厳守）:
//  - 受信箱本体:   data/inbox.jsonl           （追記専用・1 行 1 エントリ JSON）
//  - 消費記録:     data/inbox-consumed.jsonl  （自律林が処理後に id を追記。サーバは読むだけ）
//  - 添付画像:     data/inbox-attachments/<id>/<安全なファイル名>
//
// エントリ構造（MC-77 以降）:
//  { id, ts, kind:"task", project:"logic"|"cxo"|"en-chakai"|null,
//    text, status:"pending", attachments:[ ... ],
//    taskId?:"MC-82", trackerSource?:"cxo/TASK_TRACKER" }   // 即タスク化できた場合のみ
//  後方互換: 旧エントリの kind:"instruction" は task として扱う。taskId が無い旧エントリは
//  従来どおり autonomous-rin が拾って TASK_TRACKER 登録する。

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
  INBOX_AGENTS,
} from './config.js';
import {
  sanitizeFilename,
  resetAttachmentsRoot,
  resolveCxoRelativeAttachment,
  contentTypeFor,
  InboxPathError,
} from './lib/inboxPath.js';
import {
  appendTask,
  nextTaskId,
  prefixForProject,
  TaskAppendError,
} from './lib/taskTrackerAppend.js';

// ─── 型 ────────────────────────────────────────────────

/** project は固定 3 種 + null（未指定）。 */
const ALLOWED_PROJECTS = ['logic', 'cxo', 'en-chakai'] as const;
type InboxProject = (typeof ALLOWED_PROJECTS)[number];

// MC-77: kind は内部的に 'task' 固定。旧 'instruction' は受理しても task に正規化する。
type InboxKind = 'task';

export interface InboxEntry {
  id: string;
  ts: string;
  kind: InboxKind;
  project: InboxProject | null;
  text: string;
  status: 'pending';
  attachments: string[];
  /** MC-77: 投入時に即タスク化できた場合の TASK_TRACKER 上の id（例 MC-82）。 */
  taskId?: string;
  /** MC-77: taskId を書いた台帳（例 cxo/TASK_TRACKER）。 */
  trackerSource?: string;
  /**
   * MC-86: 指令の担当として明示指定された subagent（例 'dev-logic'）。
   * 指定時のみ付与し、即タスク化した場合はその担当（owner）にも反映する。
   * autonomous-rin はこの値があれば該当 subagent に委譲する。
   */
  agent?: string;
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

// MC-77: 投入は全て task。kind は任意（送られても無視）し、常に 'task' に正規化する。
// 旧クライアントが kind=instruction を送っても受理する（後方互換・エラーにしない）。
function normalizeKind(): InboxKind {
  return 'task';
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

// MC-86: 担当エージェント指定（任意）。指定があればホワイトリスト（INBOX_AGENTS）の
// 既知 subagentType のみ受理する。未知の agent 名は 400 で拒否し、任意プロンプト実行の
// 踏み台にされないようにする。未指定（'' / 'null' / 省略）は自動割当 = null を返す。
function parseAgent(v: unknown): string | null | { error: string } {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return { error: 'agent must be a string' };
  const a = v.trim();
  if (a === '' || a === 'null') return null;
  if (!INBOX_AGENTS.has(a)) {
    return {
      error: `agent must be one of: ${[...INBOX_AGENTS].join(', ')} (or omitted for auto-assign)`,
    };
  }
  return a;
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

  // MC-77: kind は常に task に正規化（旧 instruction も task 扱い）。
  const kind = normalizeKind();
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

  // MC-86: 担当エージェント（任意・ホワイトリスト検証）。
  const agent = parseAgent(body.agent);
  if (agent !== null && typeof agent === 'object') {
    res.status(400).json({ error: agent.error });
    return;
  }
  const agentVal = agent as string | null;

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

  const projectVal = project as InboxProject | null;

  // MC-77: 投入と同時に正本 TASK_TRACKER へ 1 タスク追記し、即タスクボードに出す。
  // 採番は next-task-id.sh 相当（server 内 grep）、書き戻しは fail-closed の追記層。
  // 失敗しても inbox 投入自体は成功扱いにする（taskId を付けず残し、autonomous-rin の
  // 従来フローが後で拾える）。添付画像フローは inbox.jsonl 側に温存される。
  let taskId: string | undefined;
  let trackerSource: string | undefined;
  try {
    const newId = nextTaskId(prefixForProject(projectVal));
    // タイトルは text の 1 行目（長すぎる場合は丸める）。詳細に全文を残す。
    const firstLine = text.split(/\r?\n/)[0].trim() || text.trim();
    const title = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
    const result = appendTask({
      project: projectVal,
      task: {
        id: newId,
        title,
        status: 'TODO',
        // MC-86: 担当エージェント指定があれば台帳の担当（owner）に反映。未指定は従来どおり未定。
        owner: agentVal ?? '未定',
        priority: 'P2',
        detail: text.trim(),
        source: 'Apollo投入',
      },
    });
    taskId = result.task.id;
    trackerSource = result.trackerSource;
  } catch (e) {
    // 即タスク化に失敗（採番衝突・検証失敗等）。投入自体は通し、autonomous-rin の
    // 後方互換フローに委ねる。サーバログに残すのみ（ユーザー投入はブロックしない）。
    const msg = e instanceof TaskAppendError ? `${e.code}: ${e.message}` : String(e);
    console.error('[inbox] immediate task append failed:', msg);
  }

  const entry: InboxEntry = {
    id,
    ts: now.toISOString(),
    kind,
    project: projectVal,
    text,
    status: 'pending',
    attachments,
    ...(agentVal ? { agent: agentVal } : {}),
    ...(taskId ? { taskId, trackerSource } : {}),
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
