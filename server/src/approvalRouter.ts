// approvalRouter — 承認フロー API（MC-79。auth ミドルウェア配下）。
//
//  GET  /api/approvals                       : 承認/確認が要る項目を集約（カテゴリ別件数つき）。
//  POST /api/approvals/:taskId/approve (JSON): { source, baseHash?, categories? } で承認 → status=TODO。
//  POST /api/approvals/:taskId/reject  (JSON): { source, baseHash?, categories?, comment? } で却下 → CANCELLED。
//
// 書き戻しは MC-71 の安全層（editTask）を approvalWrite 経由で再利用する（楽観ロック・read-back・
// 監査ログ・該当行のみ置換）。エラーマッピングは taskEditRouter と同一方針:
//   CONFLICT/AMBIGUOUS→409, VALIDATION_FAILED→422, NOT_FOUND→404, UNSUPPORTED_SOURCE/不正→400。

import { Router, type Request, type Response } from 'express';

import { collectApprovals } from './collectors/approvals.js';
import { approveTask, rejectTask, TaskEditError } from './lib/approvalWrite.js';
import type { ApprovalKind } from './config.js';

const VALID_CATEGORIES = new Set<ApprovalKind>([
  'blocked',
  'deploy',
  'design',
  'approval',
  'confirm',
]);

const MAX_COMMENT_LEN = 1000;

/** TaskEditError.code → HTTP ステータス。 */
function statusForCode(code: string): number {
  switch (code) {
    case 'CONFLICT':
    case 'AMBIGUOUS':
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

/** body から categories（任意）を検証して取り出す。不正値は弾く。 */
function parseCategories(raw: unknown): ApprovalKind[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return [];
  const out: ApprovalKind[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && VALID_CATEGORIES.has(v as ApprovalKind)) {
      out.push(v as ApprovalKind);
    }
  }
  return out;
}

function handleList(_req: Request, res: Response): void {
  try {
    res.json(collectApprovals());
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** approve / reject 共通の前処理（source / id 検証）。 */
function readCommon(
  req: Request,
  res: Response,
): { source: string; id: string; baseHash?: string; categories: ApprovalKind[] } | null {
  const id = req.params.taskId;
  if (typeof id !== 'string' || id.trim() === '') {
    res.status(400).json({ error: 'taskId is required' });
    return null;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const source = body.source;
  if (typeof source !== 'string' || source.trim() === '') {
    res.status(400).json({ error: 'source is required' });
    return null;
  }
  const baseHash =
    typeof body.baseHash === 'string' && body.baseHash.trim() !== ''
      ? body.baseHash.trim()
      : undefined;
  const categories = parseCategories(body.categories);
  return { source: source.trim(), id: id.trim(), baseHash, categories };
}

function handleApprove(req: Request, res: Response): void {
  const common = readCommon(req, res);
  if (!common) return;
  try {
    const result = approveTask(common);
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof TaskEditError) {
      res.status(statusForCode(e.code)).json({ error: e.message, code: e.code });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

function handleReject(req: Request, res: Response): void {
  const common = readCommon(req, res);
  if (!common) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  let comment: string | undefined;
  if (body.comment !== undefined) {
    if (typeof body.comment !== 'string') {
      res.status(400).json({ error: 'comment must be a string' });
      return;
    }
    if (body.comment.length > MAX_COMMENT_LEN) {
      res.status(400).json({ error: `comment exceeds max length (${MAX_COMMENT_LEN})` });
      return;
    }
    comment = body.comment;
  }
  try {
    const result = rejectTask({ ...common, comment });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof TaskEditError) {
      res.status(statusForCode(e.code)).json({ error: e.message, code: e.code });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** /api/approvals 配下にマウントする承認ルータ。 */
export function approvalRouter(): Router {
  const router = Router();
  router.get('/', handleList);
  router.post('/:taskId/approve', (req, res) => handleApprove(req, res));
  router.post('/:taskId/reject', (req, res) => handleReject(req, res));
  return router;
}
