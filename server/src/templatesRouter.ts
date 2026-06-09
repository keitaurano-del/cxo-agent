// templatesRouter — スライドテンプレート（様式）カタログ API（MC-224 Phase1）。
//
// data/slide-templates.json を読み出して提供する read-only な API。
// 認証ミドルウェア配下で /api/templates に mount する（index.ts）。
//
// ルート:
//   GET /      カタログ全体 { version, updatedAt, source, categories, templates }
//   GET /:id   単一テンプレ（無ければ 404）

import { Router, type Request, type Response } from 'express';
import { listCatalog, getTemplate } from './lib/slideTemplates.js';

// ─── GET / ──────────────────────────────────────────────────
function handleList(_req: Request, res: Response): void {
  try {
    const catalog = listCatalog();
    res.json(catalog);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[templates list error]', msg);
    res.status(500).json({ error: msg });
  }
}

// ─── GET /:id ───────────────────────────────────────────────
function handleDetail(req: Request, res: Response): void {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    const template = getTemplate(id);
    if (!template) {
      res.status(404).json({ error: 'テンプレートが見つかりません。' });
      return;
    }
    res.json(template);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[templates detail error]', msg);
    res.status(500).json({ error: msg });
  }
}

// ─── Router 組み立て ─────────────────────────────────────
export function templatesRouter(): Router {
  const router = Router();
  router.get('/', (req, res) => handleList(req, res));
  router.get('/:id', (req, res) => handleDetail(req, res));
  return router;
}
