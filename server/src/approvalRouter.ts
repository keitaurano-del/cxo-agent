// approvalRouter — 承認フロー API（MC-79。auth ミドルウェア配下）。
//
//  GET  /api/approvals                       : 承認/確認が要る項目を集約（カテゴリ別件数つき）。
//  POST /api/approvals/:taskId/approve (JSON): { source, categories? } で承認 → status=TODO。
//  POST /api/approvals/:taskId/reject  (JSON): { source, categories?, comment? } で却下 → CANCELLED。
//
// 書き戻しは MC-71 の安全層（editTask）を approvalWrite 経由で再利用する（read-back 検証・
// 監査ログ・該当行のみ置換）。承認/却下は baseHash 楽観ロックを使わず、サーバが最新を読んで
// 書き戻すアトミック方式＋競合時リトライ（approvalWrite.editWithRetry）で確実に通す。
// baseHash を body に積んでも無視する（後方互換）。エラーマッピングは taskEditRouter と同一方針:
//   CONFLICT/AMBIGUOUS→409, VALIDATION_FAILED→422, NOT_FOUND→404, UNSUPPORTED_SOURCE/不正→400。
//
// エージェント承認リクエスト API（auth ミドルウェア配下。POST /api/approvals/request は外に登録）:
//  GET  /api/approvals/request/:id          : リクエスト詳細取得。
//  POST /api/approvals/request/:id/approve  : { comment? } で承認。
//  POST /api/approvals/request/:id/reject   : { comment? } で却下。

import { readFileSync } from 'node:fs';

import { Router, type Request, type Response } from 'express';

import { collectApprovals } from './collectors/approvals.js';
import { approveTask, rejectTask, TaskEditError } from './lib/approvalWrite.js';
import {
  getRequest,
  updateRequest,
  listDecidedRequests,
  type ApprovalRequest,
} from './lib/approvalRequestStore.js';
import { readAutoMode, setAutoMode } from './lib/autoModeStore.js';
import { APPROVAL_DECISIONS_FILE, type ApprovalKind } from './config.js';

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
): { source: string; id: string; categories: ApprovalKind[] } | null {
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
  // baseHash は受け取らない（承認はサーバが最新を読んで書き戻すため不要）。body に積まれていても無視。
  const categories = parseCategories(body.categories);
  return { source: source.trim(), id: id.trim(), categories };
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

// ── エージェント承認リクエスト（auth ミドルウェア配下のエンドポイント）──────────

/** GET /api/approvals/request/:id — リクエスト詳細取得。 */
function handleGetRequest(req: Request, res: Response): void {
  const id = req.params.id;
  if (typeof id !== 'string' || id.trim() === '') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const rec = getRequest(id.trim());
  if (!rec) {
    res.status(404).json({ error: `approval request not found: ${id}` });
    return;
  }
  res.json(rec);
}

/** POST /api/approvals/request/:id/approve — リクエストを承認。 */
function handleApproveRequest(req: Request, res: Response): void {
  const id = req.params.id;
  if (typeof id !== 'string' || id.trim() === '') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
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
  const updated = updateRequest(id.trim(), {
    status: 'approved',
    decidedAt: new Date().toISOString(),
    ...(comment !== undefined ? { comment } : {}),
  });
  if (!updated) {
    res.status(404).json({ error: `approval request not found: ${id}` });
    return;
  }
  res.json(updated);
}

/** POST /api/approvals/request/:id/reject — リクエストを却下。 */
function handleRejectRequest(req: Request, res: Response): void {
  const id = req.params.id;
  if (typeof id !== 'string' || id.trim() === '') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
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
  const updated = updateRequest(id.trim(), {
    status: 'rejected',
    decidedAt: new Date().toISOString(),
    ...(comment !== undefined ? { comment } : {}),
  });
  if (!updated) {
    res.status(404).json({ error: `approval request not found: ${id}` });
    return;
  }
  res.json(updated);
}

// ── 承認済・履歴（auth ミドルウェア配下）──────────────────────────────────
//
// 承認/却下した決定の履歴を返す（Keita 要望1・2）。これまでは承認すると一覧から消えるだけで
// 記録が残らなかった。2 系統の決定をマージして新しい順で返す:
//   1. エージェント承認リクエストの決定済み（status=approved/rejected）。autoApproved を含む。
//   2. タスク台帳由来の決定（approval-decisions.jsonl）。approve/reject の監査ログ。

/** 履歴に出す決定 1 件（エージェントリクエスト or タスク決定の正規化形）。 */
interface HistoryEntry {
  /** 'request'=エージェントリクエスト由来 / 'task'=タスク台帳由来。 */
  kind: 'request' | 'task';
  /** 決定対象の ID（req-... または タスク ID）。 */
  id: string;
  /** 並び/表示用の決定日時（ISO8601）。 */
  decidedAt: string;
  /** 'approve' | 'reject'。リクエスト側は status を approve/reject に正規化。 */
  decision: 'approve' | 'reject';
  /** 件名（リクエストのみ。タスクは持たない）。 */
  title?: string;
  /** 依頼元の表示名（リクエストのみ）。 */
  fromName?: string;
  /** カテゴリ（リクエストは単一→配列化、タスクは categories[]）。 */
  categories: ApprovalKind[];
  /** Keita のコメント（任意）。 */
  comment?: string;
  /** オートモードによる自動承認のとき true（リクエストのみ）。 */
  autoApproved?: boolean;
  /** タスク決定の source（タスクのみ）。 */
  source?: string;
}

const HISTORY_LIMIT = 50;
/** decisions.jsonl の末尾から読むバイト上限（巨大ファイル全読みを避ける概算）。 */
const DECISIONS_TAIL_BYTES = 256 * 1024;

/** approval-decisions.jsonl の末尾 N 件をパースして HistoryEntry に正規化する。 */
function readTaskDecisions(): HistoryEntry[] {
  let raw: string;
  try {
    raw = readFileSync(APPROVAL_DECISIONS_FILE, 'utf-8');
  } catch {
    return []; // 決定ログ未作成。
  }
  // 末尾だけ見れば直近 N 件には十分。途中で切れた先頭行は JSON.parse 失敗で無視される。
  if (raw.length > DECISIONS_TAIL_BYTES) raw = raw.slice(raw.length - DECISIONS_TAIL_BYTES);
  const out: HistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 壊れ行（末尾切り出しの先頭含む）は無視。
    }
    const ts = typeof rec.ts === 'string' ? rec.ts : undefined;
    const id = typeof rec.id === 'string' ? rec.id : undefined;
    const decision = rec.decision === 'approve' || rec.decision === 'reject' ? rec.decision : undefined;
    if (!ts || !id || !decision) continue;
    const categories = Array.isArray(rec.categories)
      ? (rec.categories.filter((c) => typeof c === 'string') as ApprovalKind[])
      : [];
    out.push({
      kind: 'task',
      id,
      decidedAt: ts,
      decision,
      categories,
      source: typeof rec.source === 'string' ? rec.source : undefined,
      comment: typeof rec.comment === 'string' ? rec.comment : undefined,
    });
  }
  return out;
}

/** 決定済みエージェントリクエストを HistoryEntry に正規化する。 */
function requestToHistory(r: ApprovalRequest): HistoryEntry {
  return {
    kind: 'request',
    id: r.id,
    decidedAt: r.decidedAt ?? r.requestedAt,
    decision: r.status === 'rejected' ? 'reject' : 'approve',
    title: r.title,
    fromName: r.fromName,
    categories: [r.category as ApprovalKind],
    comment: r.comment,
    autoApproved: r.autoApproved === true,
  };
}

/** GET /api/approvals/history — 決定済みを 2 系統マージして新しい順・直近 50 件返す。 */
function handleHistory(_req: Request, res: Response): void {
  try {
    const fromRequests = listDecidedRequests().map(requestToHistory);
    const fromTasks = readTaskDecisions();
    const merged = [...fromRequests, ...fromTasks].sort((a, b) =>
      b.decidedAt.localeCompare(a.decidedAt),
    );
    res.json({
      generatedAt: new Date().toISOString(),
      total: merged.length,
      entries: merged.slice(0, HISTORY_LIMIT),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ── 承認オートモード（MC-186。auth ミドルウェア配下）─────────────────────

/** GET /api/approvals/automode — オートモードの現在状態を返す。 */
function handleGetAutoMode(_req: Request, res: Response): void {
  res.json(readAutoMode());
}

/** POST /api/approvals/automode — body { enabled:boolean } でオートモードを切り替える。 */
function handleSetAutoMode(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  res.json(setAutoMode(body.enabled));
}

/** /api/approvals 配下にマウントする承認ルータ。 */
export function approvalRouter(): Router {
  const router = Router();
  router.get('/', handleList);
  // 履歴・オートモード（':taskId' ルートより前に登録して 'history'/'automode' が taskId に食われないようにする）。
  router.get('/history', (req, res) => handleHistory(req, res));
  router.get('/automode', (req, res) => handleGetAutoMode(req, res));
  router.post('/automode', (req, res) => handleSetAutoMode(req, res));
  router.post('/:taskId/approve', (req, res) => handleApprove(req, res));
  router.post('/:taskId/reject', (req, res) => handleReject(req, res));
  // エージェント承認リクエスト（auth 配下）。
  // 注意: ':taskId/approve' より後に登録しないと '/request/:id/approve' が ':taskId'='request' で
  // 既存の taskId ルートにマッチしてしまう。'/request' プレフィックスなので衝突しない。
  router.get('/request/:id', (req, res) => handleGetRequest(req, res));
  router.post('/request/:id/approve', (req, res) => handleApproveRequest(req, res));
  router.post('/request/:id/reject', (req, res) => handleRejectRequest(req, res));
  return router;
}
