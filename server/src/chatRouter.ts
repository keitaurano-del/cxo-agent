// chatRouter — Slack 的チャット機能（MC-141/142）
//
// ストレージ: data/channels/<channel-id>/meta.json + messages.jsonl
// 初期チャンネル: general / releases / dev（自動作成）
// エージェント投稿エンドポイントは auth 外（AGENT_TOKEN で別認証）。
// MC-142: agent-react / roundtable エンドポイント追加（claude -p によるエージェント自律発言）

import { Router, type Request, type Response } from 'express';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHAT_CHANNELS_DIR, AGENT_TOKEN, ROSTER_DIR } from './config.js';
import type { Broadcast } from './watch.js';
import { collectAgentPersonas, getAgentPersona } from './lib/agentPersonas.js';
import { runClaude } from './lib/notebookClaude.js';

// ── 型定義 ──────────────────────────────────────────────────

export interface ChannelMeta {
  id: string;
  name: string;
  description: string;
  type: 'channel' | 'dm';
  members: string[];
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  ts: string;
  senderId: string;
  senderName: string;
  senderEmoji: string;
  text: string;
  attachments?: string[];
}

export interface ChannelSummary extends ChannelMeta {
  unreadCount: number;
  lastMessage: ChatMessage | null;
}

export interface ChatMember {
  id: string;
  name: string;
  emoji: string;
  persona?: string;
  role?: string;
}

// ── 初期チャンネル定義 ───────────────────────────────────────

const INITIAL_CHANNELS: Array<{ id: string; name: string; description: string }> = [
  { id: 'general', name: 'general', description: '全体の共有・連絡' },
  { id: 'releases', name: 'releases', description: 'リリース・デプロイ情報' },
  { id: 'dev', name: 'dev', description: '開発・技術的な議論' },
];

// ── ストレージヘルパー ───────────────────────────────────────

function channelDir(channelId: string): string {
  return join(CHAT_CHANNELS_DIR, channelId);
}

function metaPath(channelId: string): string {
  return join(channelDir(channelId), 'meta.json');
}

function messagesPath(channelId: string): string {
  return join(channelDir(channelId), 'messages.jsonl');
}

/** data/channels/ を作成し、初期チャンネルを ensure する。 */
function ensureStorage(): void {
  mkdirSync(CHAT_CHANNELS_DIR, { recursive: true });
  for (const ch of INITIAL_CHANNELS) {
    const dir = channelDir(ch.id);
    mkdirSync(dir, { recursive: true });
    const mp = metaPath(ch.id);
    if (!existsSync(mp)) {
      const meta: ChannelMeta = {
        id: ch.id,
        name: ch.name,
        description: ch.description,
        type: 'channel',
        members: [],
        createdAt: new Date().toISOString(),
      };
      writeFileSync(mp, JSON.stringify(meta, null, 2), 'utf-8');
    }
  }
}

/** チャンネル一覧（meta.json があるディレクトリ）を返す。 */
function listChannels(): ChannelMeta[] {
  if (!existsSync(CHAT_CHANNELS_DIR)) return [];
  const result: ChannelMeta[] = [];
  for (const entry of readdirSync(CHAT_CHANNELS_DIR)) {
    const mp = metaPath(entry);
    if (!existsSync(mp)) continue;
    try {
      const meta = JSON.parse(readFileSync(mp, 'utf-8')) as ChannelMeta;
      result.push(meta);
    } catch {
      // 壊れた meta.json は無視
    }
  }
  // チャンネル→DM、ID のアルファベット順
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'channel' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return result;
}

/** 指定チャンネルのメッセージを新しい順で返す。before は ts（未満）でページング。 */
function readMessages(channelId: string, limit: number, before?: string): ChatMessage[] {
  const mp = messagesPath(channelId);
  if (!existsSync(mp)) return [];
  let raw: string;
  try {
    raw = readFileSync(mp, 'utf-8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  const msgs: ChatMessage[] = [];
  for (const line of lines) {
    try {
      msgs.push(JSON.parse(line) as ChatMessage);
    } catch {
      // 壊れ行スキップ
    }
  }
  // before フィルタ（ts が before より小さいもの）
  const filtered = before ? msgs.filter((m) => m.ts < before) : msgs;
  // 新しい順にして limit 件返す
  filtered.sort((a, b) => b.ts.localeCompare(a.ts));
  return filtered.slice(0, limit);
}

/** メッセージを追記する。 */
function appendMessage(channelId: string, msg: ChatMessage): void {
  const dir = channelDir(channelId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(messagesPath(channelId), JSON.stringify(msg) + '\n', 'utf-8');
}

/** チャンネルの最終メッセージを取得する。 */
function getLastMessage(channelId: string): ChatMessage | null {
  const mp = messagesPath(channelId);
  if (!existsSync(mp)) return null;
  try {
    const raw = readFileSync(mp, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1]) as ChatMessage;
  } catch {
    return null;
  }
}

/** メッセージを削除する（messages.jsonl を書き換え）。 */
function deleteMessage(channelId: string, msgId: string): boolean {
  const mp = messagesPath(channelId);
  if (!existsSync(mp)) return false;
  try {
    const raw = readFileSync(mp, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    let found = false;
    const newLines = lines.filter((line) => {
      try {
        const msg = JSON.parse(line) as ChatMessage;
        if (msg.id === msgId) {
          found = true;
          return false;
        }
        return true;
      } catch {
        return true;
      }
    });
    if (!found) return false;
    writeFileSync(mp, newLines.join('\n') + (newLines.length > 0 ? '\n' : ''), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ── roster から members 一覧を収集 ──────────────────────────

/** frontmatter のフィールドを取得する簡易パーサ。 */
function getFrontmatterField(md: string, field: string): string | undefined {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return undefined;
  for (const line of fm[1].split('\n')) {
    const m = line.match(new RegExp(`^${field}:\\s*(.*)$`));
    if (m) return m[1].trim();
  }
  return undefined;
}

/** 60-Agents/*.md から参加者一覧を収集する。Keita は固定で追加。 */
function collectMembers(): ChatMember[] {
  const members: ChatMember[] = [
    { id: 'keita', name: 'Keita', emoji: '', role: 'オーナー' },
  ];

  // emoji なしのフォールバック
  const DEFAULT_EMOJI = '';

  if (!existsSync(ROSTER_DIR)) return members;

  const NON_AGENT = new Set(['HISTORY.md', 'README.md']);
  for (const file of readdirSync(ROSTER_DIR)) {
    if (!file.endsWith('.md') || NON_AGENT.has(file)) continue;
    const id = file.replace(/\.md$/, '');
    const fp = join(ROSTER_DIR, file);
    let md = '';
    try {
      md = readFileSync(fp, 'utf-8');
    } catch {
      continue;
    }
    const persona = getFrontmatterField(md, 'persona') ?? id;
    const role = getFrontmatterField(md, 'role');
    // persona から name を抽出（「蓮（れん）」の場合は全体を name とする）
    const name = persona;
    members.push({ id, name, emoji: DEFAULT_EMOJI, persona, role });
  }

  return members;
}

/** :id パラメータを string に正規化する（Express 5 は string | string[] 型）。 */
function idParam(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

// ── ルーター生成（broadcast を受け取る閉包） ────────────────────

export function chatRouter(broadcast: Broadcast): Router {
  ensureStorage();

  const router = Router();

  // GET /api/chat/channels
  router.get('/channels', (_req: Request, res: Response) => {
    const channels = listChannels();
    const summaries: ChannelSummary[] = channels.map((ch) => ({
      ...ch,
      unreadCount: 0, // サーバ側では管理しない（フロントが localStorage で持つ）
      lastMessage: getLastMessage(ch.id),
    }));
    res.json({ channels: summaries });
  });

  // POST /api/chat/channels
  router.post('/channels', (req: Request, res: Response) => {
    const { name, description = '', type = 'channel', members = [] } = req.body as {
      name?: string;
      description?: string;
      type?: 'channel' | 'dm';
      members?: string[];
    };
    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    // ID はスラッグ化（DM は dm-id1-id2 形式は呼び出し側が作る）
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!id) {
      res.status(400).json({ error: 'invalid channel name' });
      return;
    }
    const dir = channelDir(id);
    if (existsSync(dir)) {
      res.status(409).json({ error: 'channel already exists', id });
      return;
    }
    mkdirSync(dir, { recursive: true });
    const meta: ChannelMeta = {
      id,
      name: name.trim(),
      description,
      type: type === 'dm' ? 'dm' : 'channel',
      members,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(metaPath(id), JSON.stringify(meta, null, 2), 'utf-8');
    res.status(201).json({ channel: meta });
  });

  // GET /api/chat/channels/:id/messages
  router.get('/channels/:id/messages', (req: Request, res: Response) => {
    const id = idParam(req, 'id');
    if (!existsSync(channelDir(id))) {
      res.status(404).json({ error: 'channel not found' });
      return;
    }
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const messages = readMessages(id, limit, before);
    res.json({ channelId: id, messages });
  });

  // POST /api/chat/channels/:id/messages
  router.post('/channels/:id/messages', (req: Request, res: Response) => {
    const id = idParam(req, 'id');
    if (!existsSync(channelDir(id))) {
      res.status(404).json({ error: 'channel not found' });
      return;
    }
    const { senderId, senderName, senderEmoji = '', text } = req.body as {
      senderId?: string;
      senderName?: string;
      senderEmoji?: string;
      text?: string;
    };
    if (!senderId || typeof senderId !== 'string' || senderId.trim() === '') {
      res.status(400).json({ error: 'senderId is required' });
      return;
    }
    if (!text || typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const msg: ChatMessage = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      senderId: senderId.trim(),
      senderName: senderName?.trim() ?? senderId.trim(),
      senderEmoji: senderEmoji.trim(),
      text: text.trim(),
    };
    appendMessage(id, msg);
    broadcast('chat', { channelId: id, message: msg });
    res.status(201).json({ message: msg });
  });

  // DELETE /api/chat/channels/:id/messages/:msgId
  router.delete('/channels/:id/messages/:msgId', (req: Request, res: Response) => {
    const id = idParam(req, 'id');
    const msgId = idParam(req, 'msgId');
    if (!existsSync(channelDir(id))) {
      res.status(404).json({ error: 'channel not found' });
      return;
    }
    const deleted = deleteMessage(id, msgId);
    if (!deleted) {
      res.status(404).json({ error: 'message not found' });
      return;
    }
    broadcast('chat', { channelId: id, deleted: msgId });
    res.json({ ok: true, deleted: msgId });
  });

  // GET /api/chat/members
  router.get('/members', (_req: Request, res: Response) => {
    res.json({ members: collectMembers() });
  });

  // GET /api/chat/agents — エージェント人格一覧（MC-142）
  router.get('/agents', (_req: Request, res: Response) => {
    const personas = collectAgentPersonas().map((p) => ({
      senderId: p.senderId,
      senderName: p.senderName,
      color: p.color,
      role: p.role,
    }));
    res.json({ agents: personas });
  });

  // ── エージェント自律発言 ─────────────────────────────────────

  /**
   * POST /api/chat/channels/:id/agent-react
   * { agentId, triggerMessageId?, context? }
   * → 指定エージェントが直近メッセージを読んで人格に合わせた返答を生成し、チャンネルに投稿。
   */
  router.post('/channels/:id/agent-react', async (req: Request, res: Response) => {
    const channelId = idParam(req, 'id');
    if (!existsSync(channelDir(channelId))) {
      res.status(404).json({ error: 'channel not found' });
      return;
    }

    const { agentId } = req.body as { agentId?: string; triggerMessageId?: string; context?: string };
    if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const persona = getAgentPersona(agentId.trim());
    if (!persona) {
      res.status(404).json({ error: `agent not found: ${agentId}` });
      return;
    }

    // 直近5件を取得して古い→新しい順に並べる
    const recent = readMessages(channelId, 5, undefined).reverse();
    const chatHistory = recent
      .map((m) => `${m.senderName}: ${m.text}`)
      .join('\n');

    const prompt = `${persona.systemPrompt}\n\n最近のチャット:\n${chatHistory || '（まだメッセージはありません）'}\n\n${persona.senderName} として一言コメントしてください。日本語・3文以内。`;

    const result = await runClaude('/home/dev/projects/cxo-agent', prompt);
    if (!result.ok || !result.stdout.trim()) {
      res.status(500).json({ error: result.error ?? 'claude returned empty output' });
      return;
    }

    const text = result.stdout.trim();
    const msg: ChatMessage = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      senderId: persona.senderId,
      senderName: persona.senderName,
      senderEmoji: '',
      text,
    };
    appendMessage(channelId, msg);
    broadcast('chat', { channelId, message: msg });
    res.status(201).json({ message: msg });
  });

  /**
   * POST /api/chat/channels/:id/roundtable
   * { topic, agentIds: string[] }
   * → 指定エージェント群が順番にトピックについて発言する（ラウンドテーブル）。
   */
  router.post('/channels/:id/roundtable', async (req: Request, res: Response) => {
    const channelId = idParam(req, 'id');
    if (!existsSync(channelDir(channelId))) {
      res.status(404).json({ error: 'channel not found' });
      return;
    }

    const { topic, agentIds } = req.body as { topic?: string; agentIds?: string[] };
    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
      res.status(400).json({ error: 'topic is required' });
      return;
    }
    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'agentIds must be a non-empty array' });
      return;
    }

    const personas = agentIds
      .map((id) => getAgentPersona(id.trim()))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);

    if (personas.length === 0) {
      res.status(400).json({ error: 'no valid agents found in agentIds' });
      return;
    }

    const postedMessages: ChatMessage[] = [];

    // トピックアナウンス（システムメッセージ）
    const announce: ChatMessage = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      senderId: 'system',
      senderName: 'システム',
      senderEmoji: '',
      text: `ラウンドテーブル開始: ${topic.trim()}`,
    };
    appendMessage(channelId, announce);
    broadcast('chat', { channelId, message: announce });
    postedMessages.push(announce);

    // 各エージェントが順番に発言（直列処理でセマフォを節約）
    for (const persona of personas) {
      const prompt = `${persona.systemPrompt}\n\nトピック: ${topic.trim()}\n\n${persona.senderName} として、このトピックについて意見を一言述べてください。日本語・3文以内。`;

      const result = await runClaude('/home/dev/projects/cxo-agent', prompt);
      const text = result.ok && result.stdout.trim()
        ? result.stdout.trim()
        : `（${persona.senderName} は応答できませんでした: ${result.error ?? 'empty'}）`;

      const msg: ChatMessage = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        senderId: persona.senderId,
        senderName: persona.senderName,
        senderEmoji: '',
        text,
      };
      appendMessage(channelId, msg);
      broadcast('chat', { channelId, message: msg });
      postedMessages.push(msg);
    }

    res.json({ ok: true, messages: postedMessages });
  });

  return router;
}

// ── エージェント投稿エンドポイント（auth 外）──────────────────

/**
 * POST /api/chat/agent-message
 * { token, channelId, senderId, senderName, senderEmoji, text }
 * AGENT_TOKEN 認証（Cookie なしで呼べる）。
 */
export function agentMessageHandler(broadcast: Broadcast) {
  return (req: Request, res: Response) => {
    const { token, channelId, senderId, senderName, senderEmoji = '', text } = req.body as {
      token?: string;
      channelId?: string;
      senderId?: string;
      senderName?: string;
      senderEmoji?: string;
      text?: string;
    };

    // AGENT_TOKEN 未設定は機能無効
    if (!AGENT_TOKEN) {
      res.status(503).json({ error: 'agent messaging not configured (AGENT_TOKEN not set)' });
      return;
    }

    if (!token || token !== AGENT_TOKEN) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    if (!channelId || typeof channelId !== 'string') {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }
    if (!senderId || typeof senderId !== 'string' || senderId.trim() === '') {
      res.status(400).json({ error: 'senderId is required' });
      return;
    }
    if (!text || typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    // チャンネルが存在しなければ作成（agent 投稿は自動 ensure）
    const dir = channelDir(channelId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      const meta: ChannelMeta = {
        id: channelId,
        name: channelId,
        description: '',
        type: 'channel',
        members: [],
        createdAt: new Date().toISOString(),
      };
      writeFileSync(metaPath(channelId), JSON.stringify(meta, null, 2), 'utf-8');
    }

    const msg: ChatMessage = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      senderId: senderId.trim(),
      senderName: senderName?.trim() ?? senderId.trim(),
      senderEmoji: senderEmoji.trim(),
      text: text.trim(),
    };
    appendMessage(channelId, msg);
    broadcast('chat', { channelId, message: msg });
    res.status(201).json({ message: msg });
  };
}
