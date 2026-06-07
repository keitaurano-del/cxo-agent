// decisionRouter — Keita 決裁フロー API（MC-203。auth ミドルウェア配下）。
//
//  GET  /api/decisions                  : pending な決裁リクエスト一覧。
//  GET  /api/decisions/history          : decided（決定済み）一覧（新しい順・直近 50 件）。
//  GET  /api/decisions/automode         : 決裁オートモードの現在状態。
//  POST /api/decisions/automode         : { enabled, mode } で切り替え。
//  POST /api/decisions/:id/decide       : { optionId, comment? } で 1 つ選んで決裁。
//                                          → 結果を要求元エージェントへ notify 配送する。
//
// POST /api/decisions/request（エージェント投入・認証外）は decisionRequestHandler.ts で
// auth ミドルウェアの外に登録する（approvalRequestHandler と同じパターン）。
//
// 既存の承認フロー（approvalRouter）とは別系統・別タブ・別オートモードとして並走する（MC-203）。

import { Router, type Request, type Response } from 'express';

import {
  getDecision,
  updateDecision,
  listPendingDecisions,
  listDecidedDecisions,
} from './lib/decisionRequestStore.js';
import {
  readDecisionAutoMode,
  setDecisionAutoMode,
} from './lib/decisionAutoModeStore.js';
import { notifyAgent } from './lib/notifyAgent.js';

/** 変更を realtime（SSE）へ流す broadcast 関数の型（index.ts の SSE hub を注入する）。 */
type Broadcast = (event: string, data: unknown) => void;

const MAX_COMMENT_LEN = 1000;
const HISTORY_LIMIT = 50;

/** GET /api/decisions — pending な決裁リクエスト一覧を返す。 */
function handleList(_req: Request, res: Response): void {
  try {
    const decisions = listPendingDecisions();
    res.json({
      generatedAt: new Date().toISOString(),
      total: decisions.length,
      decisions,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** GET /api/decisions/history — decided（決定済み）を新しい順・直近 50 件返す。 */
function handleHistory(_req: Request, res: Response): void {
  try {
    const decided = listDecidedDecisions();
    res.json({
      generatedAt: new Date().toISOString(),
      total: decided.length,
      entries: decided.slice(0, HISTORY_LIMIT),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** GET /api/decisions/automode — 決裁オートモードの現在状態を返す。 */
function handleGetAutoMode(_req: Request, res: Response): void {
  res.json(readDecisionAutoMode());
}

/** POST /api/decisions/automode — body { enabled:boolean, mode?:'default'|'off' } で切り替え。 */
function handleSetAutoMode(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  let mode: 'default' | 'off' = 'default';
  if (body.mode !== undefined) {
    if (body.mode !== 'default' && body.mode !== 'off') {
      res.status(400).json({ error: "mode must be 'default' or 'off'" });
      return;
    }
    mode = body.mode;
  }
  res.json(setDecisionAutoMode(body.enabled, mode));
}

/** POST /api/decisions/:id/decide — body { optionId, comment? } で 1 つ選んで決裁。 */
function handleDecide(req: Request, res: Response, broadcast?: Broadcast): void {
  const id = req.params.id;
  if (typeof id !== 'string' || id.trim() === '') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const optionId = typeof body.optionId === 'string' ? body.optionId.trim() : '';
  if (!optionId) {
    res.status(400).json({ error: 'optionId is required' });
    return;
  }
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

  const existing = getDecision(id.trim());
  if (!existing) {
    res.status(404).json({ error: `decision request not found: ${id}` });
    return;
  }
  if (existing.status === 'decided') {
    res.status(409).json({ error: 'この決裁はすでに決定済みです。' });
    return;
  }
  const chosen = existing.options.find((o) => o.id === optionId);
  if (!chosen) {
    res.status(400).json({ error: `optionId not found in this decision: ${optionId}` });
    return;
  }

  const updated = updateDecision(id.trim(), {
    status: 'decided',
    decidedOptionId: chosen.id,
    decidedOptionLabel: chosen.label,
    decidedAt: new Date().toISOString(),
    ...(comment !== undefined ? { comment } : {}),
  });
  if (!updated) {
    res.status(404).json({ error: `decision request not found: ${id}` });
    return;
  }

  // 結果を要求元エージェントのターミナルへ流す（MC-203 機能③ / notify-agent.sh 連携）。
  const msg = comment
    ? `${updated.title} 決裁: ${chosen.label}（${comment}）`
    : `${updated.title} 決裁: ${chosen.label}`;
  notifyAgent(updated.requesterAgent, msg);

  // 決定結果を realtime（SSE）へ流して、開いている UI を即時更新させる（MC-203 機能③）。
  broadcast?.('update', { types: ['decisions'], ts: Date.now() });

  res.json(updated);
}

/**
 * /api/decisions 配下にマウントする決裁ルータ。
 * @param broadcast index.ts の SSE broadcast（決裁確定を realtime へ流す。任意）。
 */
export function decisionRouter(broadcast?: Broadcast): Router {
  const router = Router();
  router.get('/', handleList);
  // history / automode は ':id' ルートより前に登録（taskId/idに食われないよう）。
  router.get('/history', (req, res) => handleHistory(req, res));
  router.get('/automode', (req, res) => handleGetAutoMode(req, res));
  router.post('/automode', (req, res) => handleSetAutoMode(req, res));
  router.post('/:id/decide', (req, res) => handleDecide(req, res, broadcast));
  return router;
}
