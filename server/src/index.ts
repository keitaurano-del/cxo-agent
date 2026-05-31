// Apollo — backend エントリポイント
//
// REST + SSE(枠) + 将来 web/dist 静的配信。
// 起動: npm run dev → http://localhost:PORT

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORT, CLAUDE_PROJECTS_DIR, VAULT_DIR, STALL_MINUTES } from './config.js';
import { collectAgents, collectAgentFeed } from './collectors/agents.js';
import { collectTasks } from './collectors/tasks.js';
import { collectNarrative } from './collectors/narrative.js';
import { collectRoster } from './collectors/roster.js';
import { collectUsage } from './collectors/usage.js';
import { collectWorkflows, collectWorkflowDetail } from './collectors/workflows.js';
import { linksForTask } from './collectors/taskLinks.js';
import { search } from './collectors/search.js';
import {
  buildTree,
  readNote,
  searchVault,
  resolveAttachment,
} from './collectors/vault.js';
import { SafePathError } from './lib/vaultPath.js';
import { ALL_PROJECTS, type ProjectName } from './lib/projectMap.js';
import { makeAuthMiddleware, authEnabled } from './lib/auth.js';
import { inboxRouter } from './inbox.js';
import { vaultWriteRouter } from './vaultWriteRouter.js';
import { taskEditRouter } from './taskEditRouter.js';
import { startWatch } from './watch.js';

const HEALTHZ_PATH = '/api/healthz';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '..');
const WEB_DIST = join(SERVER_ROOT, '..', 'web', 'dist');

const app = express();

// CORS: 同一オリジン配信前提（web/dist を同じ server が配る）＋ MC_TOKEN 認証下なので
// クロスオリジンを許可する必要がない。全許可（origin:true）をやめ、CORS ヘッダを付けない
// = same-origin のみ許容（ブラウザがクロスオリジン fetch をブロックする）。
// 開発時に別ポートの Vite dev server から叩く場合は dev proxy（vite.config の proxy）を使う。
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));

// ─── ヘルスチェック（認証不要・最優先で登録）────────────────
// systemd / 外形監視用の軽量版。詳細版 /api/health は認証下に残す。
app.get(HEALTHZ_PATH, (_req, res) => {
  res.json({ ok: true });
});

// ─── token 認証（healthz より後、他ルートより前に適用）──────────
// MC_TOKEN 設定時は /api/* ・SSE ・静的配信 ・SPA fallback すべてを保護する。
app.use(makeAuthMiddleware(HEALTHZ_PATH));

// ─── REST ─────────────────────────────────────────────

/**
 * collector を try/catch で包み、1 つが throw しても 200 で {error} を返す（部分劣化）。
 * build() が undefined を返すか、すでに res が送信済みの場合は追加送信しない
 * （ハンドラ内で 404 等を自前送信したケースに対応）。
 */
function safeJson(res: Response, build: () => unknown): void {
  try {
    const body = build();
    if (res.headersSent || body === undefined) return;
    res.json(body);
  } catch (e) {
    if (res.headersSent) return;
    const message = e instanceof Error ? e.message : String(e);
    console.error('[collector error]', message);
    res.status(200).json({ error: message, generatedAt: new Date().toISOString() });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    claudeProjectsDir: CLAUDE_PROJECTS_DIR,
    vaultDir: VAULT_DIR,
    stallMinutes: STALL_MINUTES,
  });
});

app.get('/api/agents', (_req, res) => {
  safeJson(res, () => ({ agents: collectAgents() }));
});

app.get('/api/agents/:agentId/feed', (req, res) => {
  safeJson(res, () => {
    const feed = collectAgentFeed(req.params.agentId);
    if (!feed) {
      res.status(404).json({ error: 'agent not found' });
      return undefined;
    }
    return { agentId: req.params.agentId, feed };
  });
});

app.get('/api/tasks', (_req, res) => {
  safeJson(res, () => ({ tasks: collectTasks() }));
});

// ─── タスク↔workflow/agent 明示リンク（MC-62）────────────────────
// data/task-links.jsonl（明示ログ・正本）を読み、指定タスクに紐づく
// workflow run（/api/workflows のサマリと突合）と agent 会話を返す。
// 明示リンクが 0 件なら runs/agentIds とも空配列（フロントが従来フォールバックする）。
// 認証ミドルウェア配下。ファイル無し・壊れ行は collector 側で吸収して空で返す。
app.get('/api/tasks/:taskId/links', (req, res) => {
  safeJson(res, () => {
    const set = linksForTask(req.params.taskId);
    // 突合: 明示リンクの runId に対応する WorkflowSummary を /api/workflows から引く。
    // 明示リンクにあるが run が存在しない（消えた/別環境）場合は runId だけ返す。
    const summaries = collectWorkflows();
    const byRunId = new Map(summaries.map((s) => [s.runId, s]));
    const runs = set.runIds.map((runId) => ({
      runId,
      // 突合できた run はサマリ付き、できなければ null（UI 側で runId のみ表示）。
      summary: byRunId.get(runId) ?? null,
    }));
    return {
      taskId: set.taskId,
      hasExplicitLinks: set.links.length > 0,
      runs,
      agentIds: set.agentIds,
      links: set.links,
      generatedAt: new Date().toISOString(),
    };
  });
});

// ─── タスク手動編集（MC-71 edit スライス）────────────────────────
// GET /api/tasks/hash?source=... → 楽観ロック用ハッシュ
// POST /api/tasks/edit { source, id, patch, baseHash? } → 正本 .md へ安全書き戻し
// 既存 /api/tasks・/api/tasks/:taskId/links の後に mount（auth ミドルウェア配下）。
// '/hash' '/edit' は :taskId パターンと衝突しない固定パス。
app.use('/api/tasks', taskEditRouter());

app.get('/api/narrative', (_req, res) => {
  safeJson(res, () => collectNarrative());
});

app.get('/api/roster', (_req, res) => {
  safeJson(res, () => ({ roster: collectRoster() }));
});

app.get('/api/overview', (_req, res) => {
  safeJson(res, () => buildOverview());
});

app.get('/api/usage', (_req, res) => {
  safeJson(res, () => collectUsage());
});

// ─── 横断検索（MC-73）──────────────────────────────────────
// GET /api/search?q=... で タスク / エージェント / 会話 / workflow / Vault を横断検索する。
// 認証ミドルウェア（makeAuthMiddleware）配下。既存 collector を流用し二重定義しない。
// 空クエリ・0 ヒットでもクラッシュせずカテゴリ別に空配列を返す。
// 大量ヒットは各カテゴリ上限（SEARCH_CATEGORY_LIMIT）+ totals で保護する。
app.get('/api/search', (req, res) => {
  safeJson(res, () => search(String(req.query.q ?? '')));
});

// ─── Workflows（MC-60）────────────────────────────────────
// /workflows ツールが作る wf_* run を解析して run 一覧 / 1 run 詳細を返す。
// 認証ミドルウェア（makeAuthMiddleware）配下。run 0 件でも空配列で 200。
app.get('/api/workflows', (_req, res) => {
  safeJson(res, () => ({ workflows: collectWorkflows() }));
});

app.get('/api/workflows/:runId', (req, res) => {
  safeJson(res, () => {
    const detail = collectWorkflowDetail(req.params.runId);
    if (!detail) {
      res.status(404).json({ error: 'workflow run not found' });
      return undefined;
    }
    return detail;
  });
});

// ─── Inbox（非同期 指示受信箱）──────────────────────────────
// Keita がスマホから投入したタスク/指示 + 画像添付を受け、自律林が次ティックで拾う。
// auth ミドルウェア配下。POST=multipart 投入 / GET=pending 一覧 / GET attachment=画像配信。
app.use('/api/inbox', inboxRouter());

// ─── Vault（Obsidian 一元化ビュー・read-only）────────────────────
// すべてのパス入力は collectors/vault → lib/vaultPath で安全化される。
// SafePathError（パストラバーサル等）は 400 で拒否する。

/** SafePathError を 400 にマップしつつ collector を実行する。 */
function safeVault(res: Response, build: () => unknown): void {
  try {
    const body = build();
    if (res.headersSent || body === undefined) return;
    res.json(body);
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof SafePathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error('[vault error]', message);
    res.status(200).json({ error: message, generatedAt: new Date().toISOString() });
  }
}

// 書き込み（ノート作成 / ファイルアップロード）。GET と method が異なるため共存可能。
// 書き込み後 VAULT_DIR で自動 git commit+push する（push 失敗時もファイルは保存・201）。
app.use('/api/vault', vaultWriteRouter());

app.get('/api/vault/tree', (_req, res) => {
  safeVault(res, () => ({ generatedAt: new Date().toISOString(), tree: buildTree() }));
});

app.get('/api/vault/note', (req, res) => {
  safeVault(res, () => {
    const note = readNote(String(req.query.path ?? ''));
    if (!note) {
      res.status(404).json({ error: 'note not found' });
      return undefined;
    }
    return note;
  });
});

app.get('/api/vault/search', (req, res) => {
  safeVault(res, () => ({
    query: String(req.query.q ?? ''),
    results: searchVault(String(req.query.q ?? '')),
  }));
});

app.get('/api/vault/attachment', (req, res) => {
  try {
    const info = resolveAttachment(String(req.query.path ?? ''));
    if (!info) {
      res.status(404).json({ error: 'attachment not found' });
      return;
    }
    res.type(info.contentType);
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(info.absPath);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── overview（KPI 集計）──────────────────────────────

function buildOverview() {
  const agents = collectAgents();
  const tasks = collectTasks();

  const active = agents.filter((a) => a.status === 'active').length;
  const idle = agents.filter((a) => a.status === 'idle').length;
  const done = agents.filter((a) => a.status === 'done').length;
  const never = agents.filter((a) => a.status === 'never').length;

  const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
  const stalled = tasks.filter((t) => t.stalled).length;
  const blocked = tasks.filter((t) => t.status === 'BLOCKED').length;
  const review = tasks.filter((t) => t.status === 'REVIEW').length;

  // プロジェクト別サマリ
  const byProject: Record<string, {
    project: ProjectName;
    agentsActive: number;
    agentsIdle: number;
    agentsTotal: number;
    tasksTotal: number;
    tasksInProgress: number;
    tasksStalled: number;
    lastActivity: string | null;
  }> = {};
  for (const p of ALL_PROJECTS) {
    byProject[p] = {
      project: p,
      agentsActive: 0,
      agentsIdle: 0,
      agentsTotal: 0,
      tasksTotal: 0,
      tasksInProgress: 0,
      tasksStalled: 0,
      lastActivity: null,
    };
  }
  for (const a of agents) {
    const b = byProject[a.project];
    b.agentsTotal += 1;
    if (a.status === 'active') b.agentsActive += 1;
    if (a.status === 'idle') b.agentsIdle += 1;
    if (!b.lastActivity || Date.parse(a.lastActivity) > Date.parse(b.lastActivity)) {
      b.lastActivity = a.lastActivity;
    }
  }
  for (const t of tasks) {
    const b = byProject[t.project];
    if (!b) continue;
    b.tasksTotal += 1;
    if (t.status === 'IN_PROGRESS') b.tasksInProgress += 1;
    if (t.stalled) b.tasksStalled += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    kpi: {
      agentsActive: active,
      agentsIdle: idle,
      agentsDone: done,
      agentsNever: never,
      agentsTotal: agents.length,
      tasksInProgress: inProgress,
      tasksStalled: stalled,
      tasksBlocked: blocked,
      tasksReview: review,
      tasksTotal: tasks.length,
    },
    projects: Object.values(byProject),
  };
}

// ─── SSE（chokidar watch → broadcast に接続）──────────────────────

const sseClients = new Set<Response>();

app.get('/api/stream', (req: Request, res: Response) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // nginx/proxy 越しの buffering を無効化（イベントが即座に届くように）
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // 初期 ping
  res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  sseClients.add(res);

  // keep-alive ping（25 秒ごと）。proxy/トンネルのアイドル切断を防ぐ。
  // watch イベント（event: update）とは別に常時流す。
  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
    res.end();
  });
});

/** watch から呼ぶ broadcast ヘルパー。全 SSE クライアントへ event/data を送る。 */
export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try {
      c.write(payload);
    } catch {
      // 既に切断された client は次の 'close' で除去される。書き込み失敗は無視。
    }
  }
}

// ─── 静的配信（web/dist があれば SPA を配信。次フェーズ）──────────

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('/*splat', (_req, res) => {
    res.sendFile(join(WEB_DIST, 'index.html'));
  });
}

// ─── エラーハンドラ ───────────────────────────────────

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: err?.message ?? 'internal error' });
});

const server = app.listen(PORT, () => {
  console.log(`🛰  Apollo API listening on http://localhost:${PORT}`);
  console.log(`   CLAUDE_PROJECTS_DIR: ${CLAUDE_PROJECTS_DIR}`);
  console.log(`   VAULT_DIR:           ${VAULT_DIR}`);
  console.log(`   STALL_MINUTES:       ${STALL_MINUTES}`);
  console.log(`   web/dist:            ${existsSync(WEB_DIST) ? WEB_DIST : '(not built yet)'}`);
  if (authEnabled()) {
    console.log('   auth:                ENABLED (MC_TOKEN set) — /api/* ・SSE ・静的配信を保護');
  } else {
    console.warn(
      '   ⚠ auth:              DISABLED (MC_TOKEN 未設定) — 全リクエストが無認証で通ります。' +
        '公開バインド前に必ず MC_TOKEN を設定してください。',
    );
  }
});

// ─── watch 起動（サーバ全体で 1 つだけ）と終了時クリーンアップ ─────────
const stopWatch = startWatch(broadcast);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal} 受信。watcher と server を閉じます…`);
  await stopWatch();
  for (const c of sseClients) {
    try {
      c.end();
    } catch {
      /* noop */
    }
  }
  sseClients.clear();
  server.close(() => process.exit(0));
  // close が詰まっても確実に抜ける保険。
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
