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
import { collectAgents } from './collectors/agents.js';

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

// グローバルキュー状態（プロセス単位）
const queueState: QueueState = {
  messages: new Map(),
  lastFlushTime: 0,
};

// ─── helper 関数 ────────────────────────────────────

/**
 * 最新のエージェント状態を取得し、現在 busy か確認する。
 * active（8分以内）= busy, idle（8分以上）= idle
 */
function isAgentBusy(): boolean {
  try {
    const agents = collectAgents();
    // 林（hayashi-rin メイン林）のエージェントログを見て、最新活動が 8 分以内か確認
    // 簡略的には active status = busy, idle status = not busy
    const activeCount = agents.filter((a) => a.status === 'active').length;
    return activeCount > 0; // 1 体以上 active なら busy と判定
  } catch (e) {
    console.error('[queue] failed to collect agent status:', e instanceof Error ? e.message : String(e));
    return true; // エラー時は busy と判定して conservative に（キューに溜める）
  }
}

/**
 * キューの先頭メッセージを tmux send-keys で送信する（subprocess）。
 * 送信成功したら queue から削除して sentCount インクリメント。
 */
async function sendQueuedMessage(msg: QueuedMessage): Promise<boolean> {
  try {
    // 注: 本来は postSendKeys() と同じ logic で tmux に送信
    // ここでは簡略化して fetch で /api/terminal/send-keys を叩く
    const res = await fetch('http://localhost:4317/api/terminal/send-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: msg.text, terminal: msg.terminal }),
    });
    if (!res.ok) {
      console.warn(`[queue] send failed for msg ${msg.id}: HTTP ${res.status}`);
      return false;
    }
    msg.sentCount = (msg.sentCount ?? 0) + 1;
    return true;
  } catch (e) {
    console.error(`[queue] send error for msg ${msg.id}:`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * キューを flush する（agent が idle の場合のみ）。
 * 全メッセージを順に送信し、送信成功したものを queue から削除。
 */
async function flushQueue(): Promise<{ count: number; flushed: number }> {
  const count = queueState.messages.size;
  if (count === 0) return { count: 0, flushed: 0 };

  if (isAgentBusy()) {
    console.log('[queue] agent still busy, skipping flush');
    return { count, flushed: 0 };
  }

  console.log(`[queue] flushing ${count} messages`);
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
    const busy = isAgentBusy();
    const messages = Array.from(queueState.messages.values()).map((msg) => ({
      id: msg.id,
      text: msg.text,
      timestamp: msg.timestamp,
      terminal: msg.terminal,
      sentCount: msg.sentCount,
    }));

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

    // agent が idle だったら即座に flush を試みる
    void flushQueue().catch((e) => {
      console.error('[queue] flush error:', e instanceof Error ? e.message : String(e));
    });

    res.status(201).json({
      ok: true,
      id: msg.id,
      queued: true,
      agentBusy: isAgentBusy(),
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
    res.json({ ok: true, deleted: true });
  });

  /**
   * POST /api/terminal/queue/flush
   * キューを手動 flush（agent が idle の場合のみ）
   */
  router.post('/flush', async (_req: Request, res: Response) => {
    const { count, flushed } = await flushQueue();
    res.json({
      ok: true,
      queued: count,
      flushed,
      remaining: count - flushed,
      agentBusy: isAgentBusy(),
    });
  });

  /**
   * DELETE /api/terminal/queue
   * キュー全削除（クリア）
   */
  router.delete('/', (_req: Request, res: Response) => {
    const count = queueState.messages.size;
    queueState.messages.clear();
    res.json({ ok: true, cleared: count });
  });

  return router;
}

// ─── 定期ポーリング / 自動 flush ────────────────────
/**
 * サーバ起動時に定期的にキューをチェックし、agent が idle になったら自動 flush する
 * （Interval: 10秒）
 */
export function startQueueAutoFlush(): void {
  const FLUSH_CHECK_INTERVAL_MS = 10000; // 10 秒
  setInterval(() => {
    void flushQueue().catch((e) => {
      console.error('[queue auto-flush] error:', e instanceof Error ? e.message : String(e));
    });
  }, FLUSH_CHECK_INTERVAL_MS);
}
