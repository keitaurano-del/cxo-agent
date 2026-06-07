// navOrderRouter — ナビ並び順の永続化 API（MC-158。auth ミドルウェア配下）。
//
//  GET  /api/nav-order           : 保存済みの並び順を返す。未保存なら各キー空配列。
//  POST /api/nav-order  (JSON)   : 並び順を保存する。
//      - 全体保存:  { sidebar: string[], dashboard: string[] }
//      - 単一保存:  { key: "sidebar"|"dashboard", order: string[] }
//
// 保存先は data/nav-order.json（INBOX_DATA_DIR 配下＝.gitignore 済み）。
// 形: { "sidebar": ["/","/tasks",...], "dashboard": ["/plan-usage","/activity",...] }。
// サーバは「保存値の正規化（文字列配列・重複除去）」だけ行い、default 項目集合との
// マージ（新項目末尾追加・削除項目ドロップ）はフロント側の責務とする
// （default の正準集合はフロントの NAV / DASH_TABS が持つため）。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Router, type Request, type Response } from 'express';

import { NAV_ORDER_FILE } from './config.js';

/** 並び順を持つキー（フロントの2箇所のナビに対応）。 */
const NAV_KEYS = ['sidebar', 'dashboard'] as const;
type NavKey = (typeof NAV_KEYS)[number];

type NavOrder = Record<NavKey, string[]>;

/** 1 キーあたりの項目数上限（暴走入力ガード）。 */
const MAX_ITEMS = 50;
/** 1 項目（パス文字列）の最大長。 */
const MAX_ITEM_LEN = 200;

function emptyOrder(): NavOrder {
  return { sidebar: [], dashboard: [] };
}

/**
 * 任意入力を「文字列配列（重複除去・件数/長さ上限・非文字列除外）」に正規化する。
 * 不正値は静かに落とす（保存は壊さない＝堅牢性優先）。
 */
function sanitizeOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s === '' || s.length > MAX_ITEM_LEN) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** ディスクから読む。ファイル無し・壊れ JSON でも空 order にフォールバック（fail-soft）。 */
function readNavOrder(): NavOrder {
  try {
    const raw = readFileSync(NAV_ORDER_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      sidebar: sanitizeOrder(parsed.sidebar),
      dashboard: sanitizeOrder(parsed.dashboard),
    };
  } catch {
    return emptyOrder();
  }
}

/** ディスクへ書く（data/ が無ければ作る）。 */
function writeNavOrder(order: NavOrder): void {
  mkdirSync(dirname(NAV_ORDER_FILE), { recursive: true });
  writeFileSync(NAV_ORDER_FILE, JSON.stringify(order, null, 2), 'utf-8');
}

export function navOrderRouter(): Router {
  const router = Router();

  // 現在の保存順を返す。
  router.get('/', (_req: Request, res: Response) => {
    res.json(readNavOrder());
  });

  // 並び順を保存する（全体 or 単一キー）。
  router.post('/', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 単一キー保存: { key, order }
    if (typeof body.key === 'string') {
      const key = body.key as string;
      if (!NAV_KEYS.includes(key as NavKey)) {
        res.status(400).json({ error: `unknown nav key: ${key}` });
        return;
      }
      const current = readNavOrder();
      current[key as NavKey] = sanitizeOrder(body.order);
      writeNavOrder(current);
      res.json(current);
      return;
    }

    // 全体保存: { sidebar?, dashboard? }（指定キーのみ更新、未指定は既存維持）
    if (Array.isArray(body.sidebar) || Array.isArray(body.dashboard)) {
      const current = readNavOrder();
      if (Array.isArray(body.sidebar)) current.sidebar = sanitizeOrder(body.sidebar);
      if (Array.isArray(body.dashboard)) current.dashboard = sanitizeOrder(body.dashboard);
      writeNavOrder(current);
      res.json(current);
      return;
    }

    res.status(400).json({ error: 'body must be { key, order } or { sidebar?, dashboard? }' });
  });

  return router;
}
