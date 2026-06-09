// templatesRouter — スライドテンプレート（様式）カタログ API（MC-224 Phase1 + Phase2）。
//
// data/slide-templates.json を読み出して提供する read-only API（Phase1）に加え、
// Phase2 の AI 連携 3 機能を提供する。
//
// ルート:
//   GET  /                  カタログ全体 { version, updatedAt, source, categories, templates }
//   GET  /:id               単一テンプレ（無ければ 404）
//   POST /recommend         AI 推薦 { recommendations:[{id,name,reason}] }
//   POST /:id/pptx          空 pptx 生成（save:true で Deliverables 保存 / 既定でバイナリ返却）
//   POST /:id/draft         記入支援（placeholder ごとの下書き + markdown）

import { Router, type Request, type Response } from 'express';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listCatalog, getTemplate, type SlideTemplate } from './lib/slideTemplates.js';
import { runClaude } from './lib/notebookClaude.js';
import { generatePptxFromTemplate } from './lib/pptxGenerate.js';
import { DELIVERABLES_DIR } from './config.js';
import { toDeliverableRelative } from './lib/deliverablePath.js';

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

// ─── stdout からの頑健な JSON 抽出 ─────────────────────────────
// claude はコードフェンスや前後文を付けることがあるので、最初の開きから最後の閉じまでを切り出す。

/** stdout から JSON 配列を頑健に抽出する。失敗時 null。 */
function extractJsonArray(stdout: string): unknown[] | null {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** stdout から JSON オブジェクトを頑健に抽出する。失敗時 null。 */
function extractJsonObject(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ─── POST /recommend ────────────────────────────────────────
// body { query }。カタログ要約を渡して上位 3 件を JSON 配列で返させる。
async function handleRecommend(req: Request, res: Response): Promise<void> {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  const templates = listCatalog().templates;
  const catalogLines = templates
    .map(
      (t) =>
        `- id: ${t.id} / 名前: ${t.name} / カテゴリ: ${t.category} / 用途: ${t.useCases.join('、')} / 使いどころ: ${t.whenToUse}`,
    )
    .join('\n');

  const prompt = [
    'あなたはコンサルのスライド作成アシスタントです。',
    '以下は「スライドの型（テンプレート）」のカタログです。',
    '',
    catalogLines,
    '',
    `ユーザーが作りたい資料: 「${query}」`,
    '',
    'この資料に最も適した型を上位3件選び、JSON配列だけで返してください。',
    '各要素は {"id":"<カタログのid>","reason":"<日本語で1文の推薦理由>"} の形にしてください。',
    '余計な説明・コードフェンス・前置きは一切付けず、JSON配列のみを出力してください。',
  ].join('\n');

  let workDir: string | null = null;
  try {
    workDir = mkdtempSync(join(tmpdir(), 'apollo-tpl-recommend-'));
    const result = await runClaude(workDir, prompt);
    const arr = extractJsonArray(result.stdout || '');
    if (!arr) {
      res.json({
        recommendations: [],
        error: result.error || 'AI 応答から推薦を取得できませんでした。',
      });
      return;
    }
    const byId = new Map(templates.map((t) => [t.id, t]));
    const recommendations = arr
      .map((it) => {
        const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
        const id = typeof o.id === 'string' ? o.id : '';
        const reason = typeof o.reason === 'string' ? o.reason : '';
        const tpl = byId.get(id);
        if (!tpl) return null; // 存在しない id は除外
        return { id: tpl.id, name: tpl.name, reason };
      })
      .filter((x): x is { id: string; name: string; reason: string } => x !== null)
      .slice(0, 3);
    res.json({ recommendations });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[templates recommend error]', msg);
    res.json({ recommendations: [], error: msg });
  } finally {
    if (workDir) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    }
  }
}

// ─── POST /:id/pptx ─────────────────────────────────────────
// body { title?, save? }。save 真なら Deliverables へ保存、既定でバイナリ返却。
function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function handlePptx(req: Request, res: Response): Promise<void> {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = id ? getTemplate(id) : undefined;
    if (!template) {
      res.status(404).json({ error: 'テンプレートが見つかりません。' });
      return;
    }
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
    const save = req.body?.save === true;

    const buffer = await generatePptxFromTemplate(template, { title });

    if (save) {
      // Deliverables 配下 テンプレート/<YYYY-MM-DD>_<id>/<id>.pptx へ保存。
      const folderAbs = join(DELIVERABLES_DIR, 'テンプレート', `${todayYmd()}_${template.id}`);
      mkdirSync(folderAbs, { recursive: true });
      const fileAbs = join(folderAbs, `${template.id}.pptx`);
      writeFileSync(fileAbs, buffer);
      res.json({ ok: true, relpath: toDeliverableRelative(fileAbs) });
      return;
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${template.id}.pptx"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[templates pptx error]', msg);
    res.status(500).json({ error: msg });
  }
}

// ─── POST /:id/draft ────────────────────────────────────────
// body { context }。placeholder ごとの日本語下書きを JSON オブジェクトで返させる。

/** placeholders + draft から markdown 全文を整形する。 */
function buildDraftMarkdown(template: SlideTemplate, draft: Record<string, string>): string {
  const phs = Array.isArray(template.placeholders) ? template.placeholders : [];
  const lines: string[] = [`# ${template.name}`, ''];
  for (const ph of phs) {
    lines.push(`## ${ph.label}`);
    const body = draft[ph.id];
    if (body && body.trim()) {
      if (ph.type === 'bullet') {
        for (const line of body.split('\n')) {
          const t = line.trim();
          if (t) lines.push(`- ${t.replace(/^[-・]\s*/, '')}`);
        }
      } else {
        lines.push(body.trim());
      }
    } else {
      lines.push(`_（${ph.hint || '記入してください'}）_`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

async function handleDraft(req: Request, res: Response): Promise<void> {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const template = id ? getTemplate(id) : undefined;
  if (!template) {
    res.status(404).json({ error: 'テンプレートが見つかりません。' });
    return;
  }
  const context = typeof req.body?.context === 'string' ? req.body.context.trim() : '';
  if (!context) {
    res.status(400).json({ error: 'context is required' });
    return;
  }

  const phs = Array.isArray(template.placeholders) ? template.placeholders : [];
  const phLines = phs
    .map((p) => `- ${p.id} (${p.type}) ${p.label}${p.hint ? ` — ${p.hint}` : ''}`)
    .join('\n');
  const structure = Array.isArray(template.structure) ? template.structure.join(' / ') : '';

  const prompt = [
    `あなたはコンサルのスライド作成アシスタントです。型「${template.name}」のスライドを作成します。`,
    `この型の構成: ${structure}`,
    '',
    'この型の記入欄（placeholder）一覧:',
    phLines,
    '',
    '会議要旨・背景:',
    context,
    '',
    '各 placeholder に入る日本語の下書きを作成し、JSONオブジェクトだけで返してください。',
    'キーは placeholder の id、値は下書き文（日本語）です。',
    'type が bullet の欄は、各箇条書きを改行（\\n）で区切ってください。',
    '余計な説明・コードフェンス・前置きは一切付けず、JSONオブジェクトのみを出力してください。',
  ].join('\n');

  let workDir: string | null = null;
  try {
    workDir = mkdtempSync(join(tmpdir(), 'apollo-tpl-draft-'));
    const result = await runClaude(workDir, prompt);
    const obj = extractJsonObject(result.stdout || '');
    if (!obj) {
      res.json({ draft: {}, error: result.error || 'AI 応答から下書きを取得できませんでした。' });
      return;
    }
    // placeholder の id に限定し、文字列のみ採用する。
    const draft: Record<string, string> = {};
    for (const ph of phs) {
      const v = obj[ph.id];
      if (typeof v === 'string') draft[ph.id] = v;
      else if (Array.isArray(v)) draft[ph.id] = v.filter((x) => typeof x === 'string').join('\n');
    }
    const markdown = buildDraftMarkdown(template, draft);
    res.json({ draft, markdown });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[templates draft error]', msg);
    res.json({ draft: {}, error: msg });
  } finally {
    if (workDir) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    }
  }
}

// ─── Router 組み立て ─────────────────────────────────────
export function templatesRouter(): Router {
  const router = Router();
  router.get('/', (req, res) => handleList(req, res));
  router.post('/recommend', (req, res) => void handleRecommend(req, res));
  router.get('/:id', (req, res) => handleDetail(req, res));
  router.post('/:id/pptx', (req, res) => void handlePptx(req, res));
  router.post('/:id/draft', (req, res) => void handleDraft(req, res));
  return router;
}
