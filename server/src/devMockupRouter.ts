// devMockupRouter — 開発ページの AI モックアップ REST API（auth ミドルウェア配下）。
//
//  POST   /api/dev/mockup/generate    : { prompt, baseHtml?, instruction? } → 202 { jobId }（非同期ジョブ）
//  GET    /api/dev/mockup/job/:jobId  : { status:'pending'|'done'|'error', html?, error? }（ポーリング用）
//  GET    /api/dev/mockups          : { mockups: [{id,title,prompt,createdAt,updatedAt}] }（html 除く軽量）
//  GET    /api/dev/mockups/:id       : { mockup: {…,html} }
//  POST   /api/dev/mockups           : { id?, title, html, prompt? } → upsert（保存結果を返す）
//  DELETE /api/dev/mockups/:id        : 論理削除 { ok:true }
//
// 生成は plannerEstimate.ts の流儀を踏襲して claude CLI を安全起動する:
//   execFile(NOTEBOOK_CLAUDE_BIN, ['--model', model, '-p', prompt], {timeout, maxBuffer, env})
//   NUL バイトはプロンプトから除去し、execFile 自体も try/catch で囲って落とさない。
// 保存先はすべて data/ 配下（.gitignore 済み）。

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

import {
  NOTEBOOK_CLAUDE_BIN,
  NOTEBOOK_CLAUDE_MODEL,
} from './config.js';
import {
  deleteMockup,
  getMockup,
  listMockups,
  upsertMockup,
} from './lib/devMockupStore.js';

// ─── claude CLI（HTML 生成）──────────────────────────────────

/** 生成 1 回あたりのタイムアウト（ミリ秒）。HTML 生成は分量があるため 120s。 */
const GENERATE_TIMEOUT_MS = 120_000;

/** HTML は大きくなり得るため maxBuffer を広めに取る（8MB）。 */
const GENERATE_MAX_BUFFER = 8 * 1024 * 1024;

/** 生成 HTML の出力ルール（厳守させる共通指示）。 */
const HTML_RULES = [
  '出力は「完全な単一 HTML5 ドキュメント」だけにしてください。必ず <!DOCTYPE html> から始め、',
  '<html>...</html> で完結させます。',
  '自己完結させること: CSS は <style>、JS は <script> でインラインに含める。',
  'Tailwind 等の CDN は使ってもよいが、極力自己完結を優先する。',
  'UI 文言は日本語で構いません。レスポンシブにすること。',
  '重要: マークダウン、``` のコードフェンス、前置き・説明文は一切出力しないこと。HTML 本文のみを出力する。',
].join('\n');

/** 新規生成のプロンプトを組み立てる。 */
function buildGeneratePrompt(prompt: string): string {
  return [
    'あなたは UI モックアップを HTML で作るデザイナー兼フロントエンドエンジニアです。',
    '次の要望を満たす画面の HTML モックアップを作成してください。',
    '',
    '要望:',
    prompt,
    '',
    HTML_RULES,
  ].join('\n');
}

/** 反復修正のプロンプトを組み立てる（baseHtml 全体を修正指示で書き換え、HTML 全体を返す）。 */
function buildRevisePrompt(baseHtml: string, instruction: string): string {
  return [
    'あなたは UI モックアップを HTML で修正するデザイナー兼フロントエンドエンジニアです。',
    '次の指示に従って、以下の HTML 全体を修正してください。修正後の HTML 全体を返します。',
    '',
    '指示:',
    instruction,
    '',
    HTML_RULES,
    '',
    '修正対象の HTML:',
    baseHtml,
  ].join('\n');
}

/**
 * 出力から ```html / ``` のコードフェンスを除去し、HTML 本文を取り出す。
 * フェンスが無ければそのまま trim して返す。
 */
function stripFences(out: string): string {
  let s = (out || '').trim();
  // 先頭の ```html / ``` を除去。
  const fenceStart = /^```(?:html|HTML)?\s*\n?/;
  if (fenceStart.test(s)) {
    s = s.replace(fenceStart, '');
    // 末尾の閉じフェンス。
    s = s.replace(/\n?```\s*$/, '');
  }
  return s.trim();
}

/**
 * claude CLI を起動して HTML を生成する。
 * 失敗/タイムアウト/NUL ガード後の例外はすべて null（呼び出し側で 502）。
 */
function runGenerate(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    // execFile は引数に NUL バイトがあると同期 throw する。想定外の制御文字でサーバを落とさないよう、
    // (1) プロンプトから NUL を除去し、(2) execFile 自体も try/catch で囲う。
    const safePrompt = prompt.replace(/\x00/g, '');
    try {
      execFile(
        NOTEBOOK_CLAUDE_BIN,
        ['--model', NOTEBOOK_CLAUDE_MODEL, '-p', safePrompt],
        { timeout: GENERATE_TIMEOUT_MS, maxBuffer: GENERATE_MAX_BUFFER, env: process.env },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          resolve((stdout || '').toString());
        },
      );
    } catch {
      resolve(null);
    }
  });
}

// ─── 非同期ジョブストア ──────────────────────────────────
//
// Cloudflare エッジ（cloudflared トンネル）には約 100s の上限があり、claude CLI が
// 競合等で遅いと 524 になる。生成をバックグラウンドジョブ化し、POST は即 202 で jobId を返し、
// フロントは GET /job/:id をポーリングする。これでエッジ上限に縛られなくなる。
// ジョブはインメモリ（プロセス再起動で消える）。

type JobStatus = 'pending' | 'done' | 'error';
interface Job {
  status: JobStatus;
  html?: string;
  error?: string;
  /** 完了時に自動保存したモックアップの id（クライアントが currentId に反映できる）。 */
  mockupId?: string;
  createdAt: number;
}

/** jobId → Job。インメモリのみ。 */
const jobs = new Map<string, Job>();

/** ジョブの保持期間（15 分）。これより古いものは破棄する。 */
const JOB_TTL_MS = 15 * 60_000;

/** サーバ側リトライ: 最大試行回数と試行間バックオフ。エッジ上限から外れたので安全に複数回試せる。 */
const GENERATE_MAX_ATTEMPTS = 3;
const GENERATE_RETRY_BACKOFF_MS = 5_000;

/** ユーザ向けの最終失敗メッセージ（全試行失敗時）。 */
const GENERATE_FAILURE_MESSAGE =
  '生成に失敗しました。生成エンジンが混み合っているか一時的に失敗した可能性があります。少し待ってもう一度お試しください。';

/** TTL を過ぎたジョブを破棄する（アクセス時に呼ぶ・サーバを汚さない）。 */
function sweepExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * バックグラウンドで claude CLI を呼んで HTML を生成し、結果をジョブに格納する。
 * 一過性失敗（空応答・claude 競合・タイムアウト）を吸収するため最大 GENERATE_MAX_ATTEMPTS 回リトライ。
 * await しない前提（呼び出し側は即 202 を返す）。例外でサーバを落とさない。
 */
async function runGenerateJob(
  jobId: string,
  cliPrompt: string,
  save: { title: string; id?: string; prompt?: string },
): Promise<void> {
  for (let attempt = 1; attempt <= GENERATE_MAX_ATTEMPTS; attempt += 1) {
    const raw = await runGenerate(cliPrompt);
    if (raw !== null) {
      const html = stripFences(raw);
      // HTML らしさの最低限チェック: 空・タグを含まないものは無効（リトライ対象）。
      if (html && html.includes('<')) {
        // 生成成功。クライアントが離脱・通信失敗しても結果が残るよう、ストアへ自動保存する。
        // 保存に失敗してもジョブ自体は成功として html を返す（保存はベストエフォート）。
        let mockupId: string | undefined;
        try {
          const saved = upsertMockup({
            id: save.id,
            title: save.title,
            html,
            prompt: save.prompt,
          });
          mockupId = saved.id;
        } catch {
          // ignore — html は返す。
        }
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'done';
          job.html = html;
          job.mockupId = mockupId;
        }
        return;
      }
    }
    // 最終試行でなければバックオフして再試行。
    if (attempt < GENERATE_MAX_ATTEMPTS) await sleep(GENERATE_RETRY_BACKOFF_MS);
  }

  // 全試行失敗。
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'error';
    job.error = GENERATE_FAILURE_MESSAGE;
  }
}

// ─── ハンドラ ───────────────────────────────────────────

/** POST /api/dev/mockup/generate — 非同期ジョブを起票し 202 { jobId } を即返す。 */
function handleGenerate(req: Request, res: Response): void {
  sweepExpiredJobs();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const baseHtml = typeof body.baseHtml === 'string' ? body.baseHtml : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction : '';

  // 修正モード: baseHtml + instruction が両方あれば反復修正、なければ prompt から新規生成。
  let cliPrompt: string;
  if (baseHtml.trim() && instruction.trim()) {
    cliPrompt = buildRevisePrompt(baseHtml, instruction);
  } else if (prompt.trim()) {
    cliPrompt = buildGeneratePrompt(prompt);
  } else {
    res.status(400).json({ error: 'prompt（新規生成）または baseHtml+instruction（修正）が必要です' });
    return;
  }

  // 自動保存用のタイトルと対象 id。新規生成はプロンプト先頭を、修正は既存 id を更新（タイトルは指定 or 指示から）。
  const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 40);
  const explicitTitle = typeof body.title === 'string' ? body.title.trim() : '';
  const explicitId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
  const autoTitle =
    explicitTitle ||
    (prompt.trim()
      ? oneLine(prompt)
      : instruction.trim()
        ? `修正: ${oneLine(instruction)}`
        : 'モックアップ');
  const storePrompt = prompt.trim() || instruction.trim() || undefined;

  const jobId = randomUUID();
  jobs.set(jobId, { status: 'pending', createdAt: Date.now() });
  // 生成はバックグラウンドで開始（await しない）。例外は runGenerateJob 内で吸収するが念のため握りつぶす。
  void runGenerateJob(jobId, cliPrompt, { title: autoTitle, id: explicitId, prompt: storePrompt }).catch(() => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = GENERATE_FAILURE_MESSAGE;
    }
  });

  // 即座に 202 を返す＝リクエストは短時間で完了し、エッジ上限に掛からない。
  res.status(202).json({ jobId });
}

/** GET /api/dev/mockup/job/:jobId — ジョブの状態を返す。未知/期限切れは 404。 */
function handleJob(req: Request, res: Response): void {
  sweepExpiredJobs();
  const jobId = String(req.params.jobId);
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.json({ status: job.status, html: job.html, error: job.error, mockupId: job.mockupId });
}

/** GET /api/dev/mockups — 軽量サマリ一覧（html 除く）。 */
function handleList(_req: Request, res: Response): void {
  res.json({ mockups: listMockups() });
}

/** GET /api/dev/mockups/:id — html を含む 1 件。 */
function handleGet(req: Request, res: Response): void {
  const id = String(req.params.id);
  const mockup = getMockup(id);
  if (!mockup) {
    res.status(404).json({ error: 'mockup not found' });
    return;
  }
  res.json({ mockup });
}

/** POST /api/dev/mockups — upsert（id 無ければ生成）。 */
function handleUpsert(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const html = typeof body.html === 'string' ? body.html : '';
  if (!html) {
    res.status(400).json({ error: 'html is required' });
    return;
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
  const prompt = typeof body.prompt === 'string' ? body.prompt : undefined;

  const saved = upsertMockup({ id, title, html, prompt });
  res.json({ mockup: saved });
}

/** DELETE /api/dev/mockups/:id — 論理削除。 */
function handleDelete(req: Request, res: Response): void {
  const id = String(req.params.id);
  deleteMockup(id);
  res.json({ ok: true, id });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/dev 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function devMockupRouter(): Router {
  const router = Router();
  router.post('/mockup/generate', handleGenerate);
  router.get('/mockup/job/:jobId', handleJob);
  router.get('/mockups', handleList);
  router.get('/mockups/:id', handleGet);
  router.post('/mockups', handleUpsert);
  router.delete('/mockups/:id', handleDelete);
  return router;
}
