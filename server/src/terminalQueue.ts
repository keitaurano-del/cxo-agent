// terminalQueue — ターミナル メッセージキュー（MC-173）
//
// Apollo のターミナルビュー で、backend の agent（実行中のワークフロー/エージェント等）
// が busy 状態（processing）の間、ユーザが入力したメッセージを local queue に積み、
// agent が idle になったら自動で flush する仕組み。
//
// エンドポイント:
//   GET  /api/terminal/queue — 現在のキューの内容 + agent busy 状態を返す
//   POST /api/terminal/queue — メッセージをキューに追加
//   DELETE /api/terminal/queue/:id — キューから特定メッセージを削除
//   POST /api/terminal/queue/flush — キューを手動で flush（agent が idle の場合）
//
// キュー管理:
//   - メッセージは {id, text, timestamp, idempotencyKey} の形で保持
//   - idempotencyKey により重複送信を防ぐ
//   - agent status を定期ポーリング/SSE で監視し、idle なら自動 flush
//
// セキュリティ:
//   - 認証は index.ts 側の makeAuthMiddleware 配下に mount（Cookie 必須）
//   - キューはメモリ内（プロセス再起動で喪失）、永続化なし

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { collectAgents } from './collectors/agents.js';
import { terminalById, DATA_HOME, TERMINAL_TMUX_PATH } from './config.js';

// ─── キューデータ構造 ────────────────────────────────
interface QueuedMessage {
  id: string; // UUID
  text: string; // ユーザ入力メッセージ
  timestamp: number; // Date.now() で記録
  idempotencyKey: string; // 重複送信検知用
  terminal: number; // ターミナル番号（1, 3, 4）
  sentCount: number; // 送信試行回数（0=未送信）
}

interface QueueState {
  messages: Map<string, QueuedMessage>; // id → message
  lastFlushTime: number; // 最後に flush を試みた時刻
}

// キュー永続化ファイルパス
const QUEUE_PERSIST_PATH = `${DATA_HOME}/projects/cxo-agent/data/queue-state.json`;

// グローバルキュー状態（プロセス単位）
let queueState: QueueState = {
  messages: new Map(),
  lastFlushTime: 0,
};

/**
 * キューの状態をファイルに永続化する（メモリ内の Map を JSON に変換）。
 */
function persistQueue(): void {
  try {
    const dir = dirname(QUEUE_PERSIST_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const serialized = {
      messages: Array.from(queueState.messages.values()),
      lastFlushTime: queueState.lastFlushTime,
    };
    writeFileSync(QUEUE_PERSIST_PATH, JSON.stringify(serialized, null, 2), 'utf-8');
    console.log(`[queue] persisted ${serialized.messages.length} messages to ${QUEUE_PERSIST_PATH}`);
  } catch (e) {
    console.error('[queue] failed to persist state:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * ファイルから キュー状態をロードし、メモリに復元する（起動時に実行）。
 */
function loadPersistedQueue(): void {
  try {
    if (!existsSync(QUEUE_PERSIST_PATH)) {
      console.log('[queue] no persisted state file, starting with empty queue');
      return;
    }
    const content = readFileSync(QUEUE_PERSIST_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { messages: QueuedMessage[]; lastFlushTime: number };
    queueState.messages.clear();
    for (const msg of parsed.messages) {
      queueState.messages.set(msg.id, msg);
    }
    queueState.lastFlushTime = parsed.lastFlushTime;
    console.log(`[queue] loaded ${parsed.messages.length} messages from persisted state`);
  } catch (e) {
    console.error('[queue] failed to load persisted state:', e instanceof Error ? e.message : String(e));
    // エラーでも起動は止めない（空キューで再開）
  }
}

// ─── helper 関数 ────────────────────────────────────

/**
 * 指定ターミナルのエージェント busy 状態を確認する。
 * そのターミナルに紐付く agent（session ログ）の最新活動時刻を見て、
 * 現在時刻から idle 閾値（IDLE_THRESHOLD_MS）以内なら busy と判定する。
 * PTY プロンプト（claude CLI オンターミナル）の活動ログで判定する。
 */
function isAgentBusy(_terminalId: number): boolean {
  const IDLE_THRESHOLD_MS = 60 * 1000; // 60秒をアイドル判定の閾値に短縮（8分は粗すぎた）
  try {
    const agents = collectAgents();
    const now = Date.now();
    // このターミナル ID に関連するエージェントのうち、
    // 最新活動時刻が IDLE_THRESHOLD_MS 以内なら busy
    for (const agent of agents) {
      // 利用可能な情報でターミナルをフィルタリング。
      // 将来は agentId や metadata に terminal field が追加されたら、より厳密に比較できる。
      // 現在はアクティブなエージェント（最近の agent.lastActivity）が存在するか確認。
      // より正確には PTY プロンプト検知や agent metadata でターミナル指定があれば使う。
      if (typeof agent.lastActivity === 'number' && now - agent.lastActivity < IDLE_THRESHOLD_MS) {
        // 直近 60 秒以内に活動があればまだ busy（少なくともそのターミナルで活動中と推定）
        return true;
      }
    }
    return false;
  } catch (e) {
    console.error('[queue] failed to collect agent status:', e instanceof Error ? e.message : String(e));
    return true; // エラー時は busy と判定して conservative に（キューに溜める）
  }
}

/**
 * キューのメッセージを tmux send-keys で送信する（直接実行・auth 不要）。
 * tmux に直接 send-keys を実行するため、HTTP 認証ミドルウェアを通さない。
 * 送信成功したら sentCount をインクリメント。
 */
async function sendQueuedMessage(msg: QueuedMessage): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const termDef = terminalById(msg.terminal);
      if (!termDef) {
        console.warn(`[queue] unknown terminal ${msg.terminal}`);
        resolve(false);
        return;
      }

      const target = termDef.tmuxSession;
      // 任意テキストは "-l" フラグ付きでリテラル送信（key として解釈されないよう）
      const args = ['send-keys', '-t', target, '-l', msg.text];

      execFile(
        'tmux',
        args,
        { timeout: 5000, encoding: 'utf-8', env: { ...process.env, PATH: TERMINAL_TMUX_PATH } },
        (err, stdout, stderr) => {
          if (err) {
            const code = (err as unknown as { code?: number }).code;
            if (typeof code === 'number' && code !== 0) {
              console.warn(
                `[queue] tmux send-keys failed for msg ${msg.id}:`,
                stderr?.trim() || stdout?.trim() || (err instanceof Error ? err.message : String(err))
              );
              resolve(false);
              return;
            } else if (typeof code !== 'number') {
              console.warn(
                `[queue] tmux send-keys failed for msg ${msg.id}:`,
                err instanceof Error ? err.message : String(err)
              );
              resolve(false);
              return;
            }
          }
          msg.sentCount = (msg.sentCount ?? 0) + 1;
          resolve(true);
        }
      );
    } catch (e) {
      console.error(`[queue] send exception for msg ${msg.id}:`, e instanceof Error ? e.message : String(e));
      resolve(false);
    }
  });
}

/**
 * キューを flush する（メッセージのターミナルのエージェント が idle の場合のみ）。
 * 全メッセージを順に送信し、送信成功したものを queue から削除。
 */
async function flushQueue(): Promise<{ count: number; flushed: number }> {
  const count = queueState.messages.size;
  if (count === 0) return { count: 0, flushed: 0 };

  // キューの先頭メッセージを取得（なければスキップ）
  const firstMsg = Array.from(queueState.messages.values())[0];
  if (!firstMsg || isAgentBusy(firstMsg.terminal)) {
    console.log('[queue] agent still busy, skipping flush');
    return { count, flushed: 0 };
  }

  console.log(`[queue] flushing ${count} messages from terminal ${firstMsg.terminal}`);
  let flushed = 0;
  const msgs = Array.from(queueState.messages.values());

  for (const msg of msgs) {
    const ok = await sendQueuedMessage(msg);
    if (ok) {
      queueState.messages.delete(msg.id);
      flushed++;
    } else {
      // 1 つ失敗したら残りは次のチャンスに委ねる
      break;
    }
  }

  queueState.lastFlushTime = Date.now();
  if (flushed > 0) {
    persistQueue(); // flush されたメッセージを永続化に反映
  }
  return { count, flushed };
}

// ─── Express ルーター ────────────────────────────────

export function terminalQueueRouter(): Router {
  const router = Router();

  /**
   * GET /api/terminal/queue
   * 現在のキュー内容 + agent 状態を返す
   */
  router.get('/', (_req: Request, res: Response) => {
    const messages = Array.from(queueState.messages.values()).map((msg) => ({
      id: msg.id,
      text: msg.text,
      timestamp: msg.timestamp,
      terminal: msg.terminal,
      sentCount: msg.sentCount,
    }));

    // 先頭メッセージ（あれば）のターミナル ID でそのターミナルの busy 状態を返す
    const busy = messages.length > 0 ? isAgentBusy(messages[0].terminal) : false;

    res.json({
      ok: true,
      agentBusy: busy,
      queueSize: messages.length,
      messages,
      lastFlushTime: queueState.lastFlushTime,
    });
  });

  /**
   * POST /api/terminal/queue
   * メッセージをキューに追加
   * body: { text: string, terminal: number, idempotencyKey?: string }
   */
  router.post('/', (_req: Request, res: Response) => {
    const body = _req.body as {
      text?: string;
      terminal?: number;
      idempotencyKey?: string;
    };
    const { text, terminal, idempotencyKey } = body;

    if (!text || typeof text !== 'string' || !terminal || typeof terminal !== 'number') {
      res.status(400).json({ ok: false, error: 'Missing or invalid text/terminal' });
      return;
    }

    // 重複チェック（idempotencyKey が既に存在したら skip）
    const key = (idempotencyKey as string) || `${Date.now()}-${Math.random()}`;
    const existing = Array.from(queueState.messages.values()).find((m) => m.idempotencyKey === key);
    if (existing) {
      res.json({
        ok: true,
        duplicate: true,
        id: existing.id,
        message: 'This message is already queued',
      });
      return;
    }

    const msg: QueuedMessage = {
      id: randomUUID(),
      text,
      timestamp: Date.now(),
      idempotencyKey: key,
      terminal: terminal as number,
      sentCount: 0,
    };

    queueState.messages.set(msg.id, msg);
    console.log(`[queue] added message ${msg.id} to queue for terminal ${msg.terminal}`);

    // 永続化ファイルに保存
    persistQueue();

    // agent が idle だったら即座に flush を試みる
    void flushQueue().catch((e) => {
      console.error('[queue] flush error:', e instanceof Error ? e.message : String(e));
    });

    res.status(201).json({
      ok: true,
      id: msg.id,
      queued: true,
      agentBusy: isAgentBusy(msg.terminal),
    });
  });

  /**
   * DELETE /api/terminal/queue/:id
   * キューから特定メッセージを削除
   */
  router.delete('/:id', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const msg = queueState.messages.get(id);

    if (!msg) {
      res.status(404).json({ ok: false, error: 'Message not found' });
      return;
    }

    queueState.messages.delete(id);
    console.log(`[queue] deleted message ${id}`);
    persistQueue(); // 削除後に永続化
    res.json({ ok: true, deleted: true });
  });

  /**
   * POST /api/terminal/queue/flush
   * キューを手動 flush（agent が idle の場合のみ）
   */
  router.post('/flush', async (_req: Request, res: Response) => {
    const { count, flushed } = await flushQueue();
    const msgs = Array.from(queueState.messages.values());
    const busyTerminal = msgs.length > 0 ? msgs[0].terminal : undefined;
    const agentBusy = busyTerminal !== undefined ? isAgentBusy(busyTerminal) : false;
    res.json({
      ok: true,
      queued: count,
      flushed,
      remaining: count - flushed,
      agentBusy,
    });
  });

  /**
   * DELETE /api/terminal/queue
   * キュー全削除（クリア）
   */
  router.delete('/', (_req: Request, res: Response) => {
    const count = queueState.messages.size;
    queueState.messages.clear();
    console.log(`[queue] cleared ${count} messages`);
    persistQueue(); // クリア後に永続化
    res.json({ ok: true, cleared: count });
  });

  return router;
}

// ─── 定期ポーリング / 自動 flush ────────────────────
/**
 * サーバ起動時に以下を行う:
 * 1. 永続化ファイルからキュー状態をロード
 * 2. 定期的にキューをチェックし、agent が idle になったら自動 flush する（Interval: 10秒）
 */
export function startQueueAutoFlush(): void {
  // 起動時にファイルからロード（systemd restart 後の復元）
  loadPersistedQueue();

  const FLUSH_CHECK_INTERVAL_MS = 10000; // 10 秒
  setInterval(() => {
    void flushQueue().catch((e) => {
      console.error('[queue auto-flush] error:', e instanceof Error ? e.message : String(e));
    });
  }, FLUSH_CHECK_INTERVAL_MS);
}
