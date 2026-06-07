// taskEditRouter — タスク手動編集 API（MC-71 edit スライス。auth ミドルウェア配下）。
//
//  GET  /api/tasks/hash?source=<source>  : 楽観ロック用に編集直前のハッシュを返す。
//  POST /api/tasks/edit  (JSON)          : { source, id, patch, baseHash? } で正本 .md を編集。
//
// バリデーション: source/id 必須、patch は許可 4 キー（title/status/owner/priority）のみ＆最低 1 つ、
//   status は正準 6 語以外 400、文字列長上限（title≤500 / owner≤200 / priority≤50）。
// エラーマッピング: UNSUPPORTED_SOURCE/不正→400, CONFLICT/AMBIGUOUS→409, VALIDATION_FAILED→422,
//   NOT_FOUND→404。inbox.ts / vaultWriteRouter.ts の Router 作法に倣う。

import { Router, type Request, type Response } from 'express';

import {
  editTask,
  trackerHash,
  TaskEditError,
  EDITABLE_STATUS,
  type TaskPatch,
  updateTaskStatusWithLock,
} from './lib/taskTrackerWrite.js';
import type { TaskStatus } from './collectors/tasks.js';

const ALLOWED_KEYS = ['title', 'status', 'owner', 'priority'] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

const MAX_LEN: Record<AllowedKey, number> = {
  title: 500,
  status: 50,
  owner: 200,
  priority: 50,
};

const STATUS_SET = new Set<string>(EDITABLE_STATUS as readonly string[]);

/** TaskEditError.code → HTTP ステータス。 */
function statusForCode(code: string): number {
  switch (code) {
    case 'CONFLICT':
    case 'AMBIGUOUS':
    case 'RACE_RETRY':
      return 409;
    case 'VALIDATION_FAILED':
      return 422;
    case 'NOT_FOUND':
      return 404;
    case 'UNSUPPORTED_SOURCE':
    default:
      return 400;
  }
}

/** body から patch を検証して取り出す。エラーは { error } で返す。 */
function parsePatch(raw: unknown): TaskPatch | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'patch must be an object' };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    return { error: 'patch must contain at least one field' };
  }
  const patch: TaskPatch = {};
  for (const [key, value] of entries) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      return { error: `patch contains unsupported key: ${key}` };
    }
    if (typeof value !== 'string') {
      return { error: `patch.${key} must be a string` };
    }
    const k = key as AllowedKey;
    if (value.length > MAX_LEN[k]) {
      return { error: `patch.${key} exceeds max length (${MAX_LEN[k]})` };
    }
    if (k === 'status') {
      if (!STATUS_SET.has(value)) {
        return { error: `status must be one of: ${[...STATUS_SET].join(', ')}` };
      }
      patch.status = value as TaskStatus;
    } else if (k === 'title') {
      if (value.trim() === '') return { error: 'title must be non-empty' };
      patch.title = value;
    } else {
      // owner / priority は空文字を許容（未割り当てに戻す等）。
      patch[k] = value;
    }
  }
  return patch;
}

function handleHash(req: Request, res: Response): void {
  const source = req.query.source;
  if (typeof source !== 'string' || source.trim() === '') {
    res.status(400).json({ error: 'source query is required' });
    return;
  }
  try {
    const { hash } = trackerHash(source.trim());
    res.json({ hash });
  } catch (e) {
    if (e instanceof TaskEditError) {
      res.status(statusForCode(e.code)).json({ error: e.message, code: e.code });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

function handleEdit(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const source = body.source;
  if (typeof source !== 'string' || source.trim() === '') {
    res.status(400).json({ error: 'source is required' });
    return;
  }
  const id = body.id;
  if (typeof id !== 'string' || id.trim() === '') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const patch = parsePatch(body.patch);
  if ('error' in patch) {
    res.status(400).json({ error: patch.error });
    return;
  }
  const baseHash =
    typeof body.baseHash === 'string' && body.baseHash.trim() !== ''
      ? body.baseHash.trim()
      : undefined;

  try {
    const { task, hash } = editTask({ source: source.trim(), id: id.trim(), patch, baseHash });
    res.json({ ok: true, task, hash });
  } catch (e) {
    if (e instanceof TaskEditError) {
      res.status(statusForCode(e.code)).json({ error: e.message, code: e.code });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

function handleStatusLock(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const source = body.source;
  if (typeof source !== 'string' || source.trim() === '') {
    res.status(400).json({ error: 'source is required' });
    return;
  }
  const id = body.id;
  if (typeof id !== 'string' || id.trim() === '') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const status = body.status;
  if (typeof status !== 'string' || !STATUS_SET.has(status)) {
    res.status(400).json({ error: `status must be one of: ${[...STATUS_SET].join(', ')}` });
    return;
  }
  const baseHash =
    typeof body.baseHash === 'string' && body.baseHash.trim() !== ''
      ? body.baseHash.trim()
      : undefined;

  try {
    const { task, hash, commitSha } = updateTaskStatusWithLock({
      source: source.trim(),
      id: id.trim(),
      newStatus: status as typeof EDITABLE_STATUS[number],
      baseHash,
    });
    res.json({ ok: true, task, hash, commitSha });
  } catch (e) {
    if (e instanceof TaskEditError) {
      res.status(statusForCode(e.code)).json({ error: e.message, code: e.code });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** /api/tasks 配下にマウントする編集ルータ（既存 GET /api/tasks 系の後に mount）。 */
export function taskEditRouter(): Router {
  const router = Router();
  router.get('/hash', handleHash);
  router.post('/edit', (req, res) => handleEdit(req, res));
  // MC-166: Keita 手動 status 変更→🔒 付与＋git commit
  router.post('/status-lock', (req, res) => handleStatusLock(req, res));
  return router;
}
