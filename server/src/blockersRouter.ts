// blockersRouter — ブロッカーレジストリ配信 API（MC-353 層1/P2。auth ミドルウェア配下）。
//
//  GET /api/blockers : data/blockers.json（board-audit が日次生成）をそのまま返す。
//      未生成・破損時は空レジストリを返す（UI 側はバッジ非表示になるだけ＝安全）。
//
// 書き込み API は設けない（正本は board-audit が再生成する日次バッチ。UI は読み取り専用）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';

import { INBOX_DATA_DIR } from './config.js';

const BLOCKERS_FILE = join(INBOX_DATA_DIR, 'blockers.json');

export type Blocker = {
  taskId: string;
  /** A=Keita操作待ち / B=外部制約 / C=共有ツリー衝突 / D=未着手TODO / E=大玉継続 */
  type: 'A' | 'B' | 'C' | 'D' | 'E';
  since: string;
  days: number;
  next_action: string;
  next_actor: 'keita' | 'son' | 'external';
  note?: string;
};

type BlockersFile = { updatedAt: string | null; blockers: Blocker[] };

const EMPTY: BlockersFile = { updatedAt: null, blockers: [] };

/** blockers.json を読む。無い/壊れている場合は空を返す（クラッシュさせない）。 */
function loadBlockers(): BlockersFile {
  try {
    const raw = JSON.parse(readFileSync(BLOCKERS_FILE, 'utf8')) as Partial<BlockersFile>;
    if (!Array.isArray(raw.blockers)) return EMPTY;
    return { updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null, blockers: raw.blockers as Blocker[] };
  } catch {
    return EMPTY;
  }
}

export function blockersRouter(): Router {
  const router = Router();
  router.get('/', (_req: Request, res: Response) => {
    res.json(loadBlockers());
  });
  return router;
}
