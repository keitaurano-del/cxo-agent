// approvalRequestHandler — POST /api/approvals/request（認証外エンドポイント）。
//
// エージェント（autonomous-rin 等）が AGENT_TOKEN で直接承認リクエストを投げるための軽量エンドポイント。
// auth ミドルウェアの外に登録し、Cookie なしで curl から呼べるようにする（agent-message と同じパターン）。
// GET /api/approvals/request/:id と POST /api/approvals/request/:id/approve|reject は
// auth ミドルウェア配下（approvalRouter.ts に登録済み）。

import { type Request, type Response } from 'express';
import { AGENT_TOKEN } from './config.js';
import { createRequest, updateRequest, type ApprovalRequest } from './lib/approvalRequestStore.js';
import { readAutoMode } from './lib/autoModeStore.js';

const VALID_CATEGORIES = new Set<ApprovalRequest['category']>([
  'deploy',
  'design',
  'approval',
  'confirm',
]);

const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN = 2000;

/**
 * POST /api/approvals/request
 * body: { token?, from, fromName, title, description, category }
 * 認証: AGENT_TOKEN（req.body.token または Authorization: Bearer）
 * AGENT_TOKEN 未設定なら 503。
 */
export function approvalRequestHandler(req: Request, res: Response): void {
  // AGENT_TOKEN 認証（agent-message と同じパターン）。
  const bodyToken = (req.body as Record<string, unknown>)?.token as string | undefined;
  const bearerToken = (() => {
    const h = req.headers.authorization;
    if (!h) return undefined;
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : undefined;
  })();
  const token = bodyToken ?? bearerToken;

  // AGENT_TOKEN 未設定は機能無効（503）。
  if (!AGENT_TOKEN) {
    res.status(503).json({ error: 'approval requests not configured (AGENT_TOKEN not set)' });
    return;
  }

  if (!token || token !== AGENT_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = req.body as Record<string, unknown>;

  // from
  if (typeof body.from !== 'string' || body.from.trim() === '') {
    res.status(400).json({ error: 'from is required' });
    return;
  }
  // fromName
  if (typeof body.fromName !== 'string' || body.fromName.trim() === '') {
    res.status(400).json({ error: 'fromName is required' });
    return;
  }
  // title
  if (typeof body.title !== 'string' || body.title.trim() === '') {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (body.title.length > MAX_TITLE_LEN) {
    res.status(400).json({ error: `title exceeds max length (${MAX_TITLE_LEN})` });
    return;
  }
  // description
  if (typeof body.description !== 'string' || body.description.trim() === '') {
    res.status(400).json({ error: 'description is required' });
    return;
  }
  if (body.description.length > MAX_DESC_LEN) {
    res.status(400).json({ error: `description exceeds max length (${MAX_DESC_LEN})` });
    return;
  }
  // category
  if (typeof body.category !== 'string' || !VALID_CATEGORIES.has(body.category as ApprovalRequest['category'])) {
    res.status(400).json({
      error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}`,
    });
    return;
  }

  try {
    const rec = createRequest({
      from: (body.from as string).trim(),
      fromName: (body.fromName as string).trim(),
      title: (body.title as string).trim(),
      description: (body.description as string).trim(),
      category: body.category as ApprovalRequest['category'],
    });

    // オートモード（MC-186）: ON のとき自動承認する。
    // オートモード ON のときは全カテゴリ（deploy / confirm 含む）を自動承認する（2026-06-07 Keita 判断「全部自動でいい」）。
    // confirm（確認/指示待ち）カテゴリのエージェント発リクエストもここで自動承認される（Keita 要望4）。
    // ただしタスク台帳由来の BLOCKED タスクはオートモードで status 変更しない（安全のため。要望4 の
    // 対象はエージェント発の確認/指示リクエストに限る）。これは collectApprovals 側で BLOCKED を
    // 自動承認しないことで担保される（このハンドラはエージェント発リクエストのみを扱う）。
    // 自動承認のとき autoApproved:true を立て、履歴 UI で「オート」と判別できるようにする（要望2）。
    // 注: エージェント自身の push は autonomous-loop の NO_PUSH で別レイヤー抑止が継続。
    let status = rec.status;
    if (readAutoMode().enabled) {
      const updated = updateRequest(rec.id, {
        status: 'approved',
        decidedAt: new Date().toISOString(),
        comment: 'オートモードにより自動承認',
        autoApproved: true,
      });
      status = updated?.status ?? status;
      console.log(`[automode] auto-approved request ${rec.id} (category=${rec.category})`);
    }

    res.status(201).json({ id: rec.id, status, requestedAt: rec.requestedAt });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
