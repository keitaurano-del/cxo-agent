// decisionRequestHandler — POST /api/decisions/request（認証外エンドポイント・MC-203）。
//
// エージェント（林 / Masayoshi 等）が AGENT_TOKEN で「Keita 決裁依頼」を選択肢付きで投入する。
// approvalRequestHandler と同じパターン（auth ミドルウェアの外・AGENT_TOKEN 認証・curl 可）。
// GET 一覧 / POST 決定（option 選択）は auth ミドルウェア配下（approvalRouter.ts に登録）。
//
// 決裁オートモード（decisionAutoModeStore）が ON かつ mode='default' のときは、ここで
// 既定 option（options[0]）を自動選択して decided にし、結果を要求元へ notify 配送する。

import { type Request, type Response } from 'express';

import { AGENT_TOKEN } from './config.js';
import {
  createDecision,
  updateDecision,
  type DecisionOption,
} from './lib/decisionRequestStore.js';
import { readDecisionAutoMode } from './lib/decisionAutoModeStore.js';
import { notifyAgent } from './lib/notifyAgent.js';

/** realtime（SSE）へ流す broadcast 関数の型（index.ts の SSE hub を注入する）。 */
type Broadcast = (event: string, data: unknown) => void;

const MAX_TITLE_LEN = 200;
const MAX_DETAIL_LEN = 2000;
const MAX_OPTIONS = 10;
const MAX_OPTION_LABEL_LEN = 120;
const MAX_OPTION_DESC_LEN = 500;

/** body.options を検証して DecisionOption[] にする。不正なら null。 */
function parseOptions(raw: unknown): DecisionOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPTIONS) return null;
  const out: DecisionOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!id || !label) return null;
    if (label.length > MAX_OPTION_LABEL_LEN) return null;
    if (seen.has(id)) return null; // 同一リクエスト内で id 重複は不可。
    seen.add(id);
    const opt: DecisionOption = { id, label };
    if (o.description !== undefined) {
      if (typeof o.description !== 'string') return null;
      if (o.description.length > MAX_OPTION_DESC_LEN) return null;
      const d = o.description.trim();
      if (d) opt.description = d;
    }
    out.push(opt);
  }
  return out;
}

/**
 * POST /api/decisions/request
 * body: { token?, from, fromName, title, detail, options:[{id,label,description?}], requesterAgent }
 * 認証: AGENT_TOKEN（req.body.token または Authorization: Bearer）。未設定なら 503。
 */
export function decisionRequestHandler(
  req: Request,
  res: Response,
  broadcast?: Broadcast,
): void {
  const bodyToken = (req.body as Record<string, unknown>)?.token as string | undefined;
  const bearerToken = (() => {
    const h = req.headers.authorization;
    if (!h) return undefined;
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : undefined;
  })();
  const token = bodyToken ?? bearerToken;

  if (!AGENT_TOKEN) {
    res.status(503).json({ error: 'decision requests not configured (AGENT_TOKEN not set)' });
    return;
  }
  if (!token || token !== AGENT_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = req.body as Record<string, unknown>;

  if (typeof body.from !== 'string' || body.from.trim() === '') {
    res.status(400).json({ error: 'from is required' });
    return;
  }
  if (typeof body.fromName !== 'string' || body.fromName.trim() === '') {
    res.status(400).json({ error: 'fromName is required' });
    return;
  }
  if (typeof body.title !== 'string' || body.title.trim() === '') {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (body.title.length > MAX_TITLE_LEN) {
    res.status(400).json({ error: `title exceeds max length (${MAX_TITLE_LEN})` });
    return;
  }
  if (typeof body.detail !== 'string' || body.detail.trim() === '') {
    res.status(400).json({ error: 'detail is required' });
    return;
  }
  if (body.detail.length > MAX_DETAIL_LEN) {
    res.status(400).json({ error: `detail exceeds max length (${MAX_DETAIL_LEN})` });
    return;
  }
  const options = parseOptions(body.options);
  if (!options) {
    res.status(400).json({
      error: `options must be a non-empty array (max ${MAX_OPTIONS}) of { id, label, description? }`,
    });
    return;
  }
  // requesterAgent は結果配送先。未指定なら from を流用する。
  const requesterAgent =
    typeof body.requesterAgent === 'string' && body.requesterAgent.trim() !== ''
      ? body.requesterAgent.trim()
      : (body.from as string).trim();

  try {
    const rec = createDecision({
      from: (body.from as string).trim(),
      fromName: (body.fromName as string).trim(),
      title: (body.title as string).trim(),
      detail: (body.detail as string).trim(),
      options,
      requesterAgent,
    });

    // 決裁オートモード（MC-203）: ON かつ mode='default' のとき既定 option を自動選択する。
    // mode='off' のときは enabled でも自動決裁しない（pending のまま手動決裁）。
    // 安全側設計: 自動決裁は要求元エージェント発の決裁リクエストのみが対象（台帳由来 BLOCKED 等は
    // このハンドラを通らないため影響しない。MC-201 の安全線引きを踏襲）。
    let status = rec.status;
    let decidedOptionId: string | undefined;
    const auto = readDecisionAutoMode();
    if (auto.enabled && auto.mode === 'default') {
      const chosen = rec.options[0];
      const updated = updateDecision(rec.id, {
        status: 'decided',
        decidedOptionId: chosen.id,
        decidedOptionLabel: chosen.label,
        decidedAt: new Date().toISOString(),
        comment: '決裁オートモードにより既定選択肢を自動決裁',
        autoDecided: true,
      });
      status = updated?.status ?? status;
      decidedOptionId = chosen.id;
      console.log(`[decision-automode] auto-decided ${rec.id} → option=${chosen.id} (${chosen.label})`);
      // 結果を要求元エージェントへ配送（オート決裁も通知する）。
      notifyAgent(requesterAgent, `${rec.title} 決裁(オート): ${chosen.label}`);
    }

    // 新規投入/オート決裁を realtime（SSE）へ流して、開いている UI を即時更新させる。
    broadcast?.('update', { types: ['decisions'], ts: Date.now() });

    res.status(201).json({ id: rec.id, status, requestedAt: rec.requestedAt, decidedOptionId });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
