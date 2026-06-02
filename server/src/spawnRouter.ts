// spawnRouter.ts — MC-86: Apollo からエージェントを headless spawn する
//
// POST /api/agents/spawn  → claude --print --agent <type> を spawn
// GET  /api/agents/spawn/:id → spawn したプロセスの状態（running/done/failed）＋末尾100行
//
// セキュリティ:
//   - MC_TOKEN 認証は index.ts の makeAuthMiddleware で保護済み（このルーターを mount する前）
//   - agentType はホワイトリスト検証
//   - プロンプト長は 2000 字まで
//   - 同時起動上限 2 プロセス（共有 Anthropic アカウントの 529 回避）
//   - タイムアウト 30 分で kill -9

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Router, type Request, type Response } from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPAWN_LOGS_DIR = resolve(__dirname, '..', '..', 'data', 'spawn-logs');

mkdirSync(SPAWN_LOGS_DIR, { recursive: true });

// ─── ホワイトリスト ─────────────────────────────────────────────
const ALLOWED_AGENTS = [
  'dev-logic',
  'task-manager',
  'designer',
  'content-creator',
  'reviewer',
  'logic-coach',
  'test-functional',
  'night-patrol',
  'feedback-watcher',
] as const;

type AllowedAgent = typeof ALLOWED_AGENTS[number];

// ─── 状態管理（メモリ上。再起動でリセット OK） ─────────────────
interface SpawnEntry {
  id: string;
  agentType: AllowedAgent;
  pid: number | undefined;
  status: 'running' | 'done' | 'failed';
  exitCode: number | null;
  logPath: string;
  startedAt: string;
  finishedAt?: string;
  prompt: string; // 冒頭 200 字だけ記録（デバッグ用）
}

const spawnedProcesses = new Map<string, SpawnEntry>();
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 30 * 60 * 1000; // 30 分

// ─── ルーター ─────────────────────────────────────────────────

export function spawnRouter(): Router {
  const router = Router();

  // POST /api/agents/spawn
  router.post('/', async (req: Request, res: Response) => {
    const { agentType, prompt, taskId } = req.body as {
      agentType?: string;
      prompt?: string;
      taskId?: string;
    };

    // --- バリデーション ---
    if (!agentType || !(ALLOWED_AGENTS as readonly string[]).includes(agentType)) {
      res.status(400).json({ ok: false, error: 'invalid agentType' });
      return;
    }

    const instruction = taskId
      ? `タスクID ${taskId} を確認してタスクを進めてほしい。/home/dev/projects/logic/docs/TASK_TRACKER.md から該当タスクを探し、着手可能なら前進させること。${prompt ? '\n\n追加指示: ' + prompt : ''}`
      : (prompt ?? '');

    if (!instruction.trim()) {
      res.status(400).json({ ok: false, error: 'prompt または taskId が必要です' });
      return;
    }
    if (instruction.length > 2000) {
      res.status(400).json({ ok: false, error: 'プロンプトが長すぎます（最大 2000 字）' });
      return;
    }

    // --- 同時起動上限チェック ---
    const runningCount = [...spawnedProcesses.values()].filter(
      (e) => e.status === 'running',
    ).length;
    if (runningCount >= MAX_CONCURRENT) {
      res.status(429).json({
        ok: false,
        error: `同時起動上限（${MAX_CONCURRENT}）に達しています。しばらく待ってから再試行してください。`,
      });
      return;
    }

    // --- spawn ---
    const id = `spawn-${Date.now()}`;
    const logPath = join(SPAWN_LOGS_DIR, `${id}.log`);
    const logStream = createWriteStream(logPath, { flags: 'a' });

    const headerLine = `[${new Date().toISOString()}] agent=${agentType} id=${id}\n`;
    logStream.write(headerLine);
    logStream.write(`instruction(first200)=${instruction.slice(0, 200)}\n---\n`);

    const child = spawn(
      'claude',
      ['--print', '--agent', agentType, '--dangerously-skip-permissions'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      },
    );

    const entry: SpawnEntry = {
      id,
      agentType: agentType as AllowedAgent,
      pid: child.pid,
      status: 'running',
      exitCode: null,
      logPath,
      startedAt: new Date().toISOString(),
      prompt: instruction.slice(0, 200),
    };
    spawnedProcesses.set(id, entry);

    // stdin にプロンプトを流して close
    if (child.stdin) {
      child.stdin.write(instruction);
      child.stdin.end();
    }

    // stdout/stderr をログファイルへ
    child.stdout?.on('data', (chunk: Buffer) => {
      logStream.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      logStream.write(chunk);
    });

    // タイムアウト 30 分
    const timer = setTimeout(() => {
      if (entry.status === 'running') {
        logStream.write(`\n[TIMEOUT] 30 分経過 — kill\n`);
        child.kill('SIGKILL');
      }
    }, TIMEOUT_MS);
    // timer が Node.js 終了を妨げないように
    if (timer.unref) timer.unref();

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      entry.status = code === 0 ? 'done' : 'failed';
      entry.exitCode = code;
      entry.finishedAt = new Date().toISOString();
      logStream.write(`\n[EXIT] code=${code} signal=${signal} at=${entry.finishedAt}\n`);
      logStream.end();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      entry.status = 'failed';
      entry.finishedAt = new Date().toISOString();
      logStream.write(`\n[ERROR] ${err.message}\n`);
      logStream.end();
    });

    res.json({
      ok: true,
      id,
      agentType,
      pid: child.pid,
      startedAt: entry.startedAt,
    });
  });

  // GET /api/agents/spawn/:id — 状態照会
  router.get('/:id', async (req: Request, res: Response) => {
    const spawnId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const entry = spawnedProcesses.get(spawnId);
    if (!entry) {
      res.status(404).json({ ok: false, error: 'spawn ID が見つかりません' });
      return;
    }

    // ログ末尾 100 行を読む（ベストエフォート）
    let tail = '';
    try {
      const raw = await readFile(entry.logPath, 'utf-8');
      const lines = raw.split('\n');
      tail = lines.slice(-100).join('\n');
    } catch {
      tail = '(ログ読み取り不可)';
    }

    res.json({
      ok: true,
      id: entry.id,
      agentType: entry.agentType,
      pid: entry.pid,
      status: entry.status,
      exitCode: entry.exitCode,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt ?? null,
      tail,
    });
  });

  // GET /api/agents/spawn — 全スポーンの一覧（簡易）
  router.get('/', (_req: Request, res: Response) => {
    const list = [...spawnedProcesses.values()].map((e) => ({
      id: e.id,
      agentType: e.agentType,
      pid: e.pid,
      status: e.status,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt ?? null,
    }));
    res.json({ ok: true, spawns: list });
  });

  return router;
}
