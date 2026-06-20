// chajiChatStore — 茶事チャット（表千家の茶道アドバイザー）の会話履歴 JSONL ストア。
//
// childcareChatStore.ts の作法をそのまま踏襲する。単一の会話スレッド（個人用ダッシュボード
// なので分岐不要）をサーバ側に永続化する。端末ローカルの localStorage と違い、別端末・リロードを
// またいで過去の質問が残る。茶事チャットはテキストのみ（画像アップロードは扱わない）なので
// メディア参照は持たない。
//
// データストア（data/ 配下・.gitignore 済み）:
//   data/chaji-chat.jsonl  : 追記専用。1 行 = 1 レコード。
//     - メッセージ行: { type:'message', id, role:'user'|'assistant', content, ts, status?, jobId? }
//     - 更新行:       { type:'update', id, content, status, ts }  ← 既存 message を後から確定する
//     - クリア行:     { type:'cleared', ts }  ← これより前のメッセージを論理的に無効化する
//
// ─── ジョブ方式（接続から切り離した非同期生成）──────────────────────────
// AI 生成（Web検索を伴うと 1〜2 分かかる）はクライアント接続のライフサイクルから切り離す。
// 接続が切れても回答が失われない・失敗扱いにならないようにするため、assistant メッセージは
// 「pending（生成中）」として先に永続化し、バックグラウンド生成の完了時に「update 行」を追記して
// done/error と最終本文に確定する（追記専用の不変条件は維持）。
//   - status: 'pending' = 生成中（フロントは「考え中…」を出し、history/job をポーリングして解決）
//   - status: 'done'    = 完了（content が確定）
//   - status: 'error'   = 失敗（content にユーザー向けの丁寧メッセージを確定。無言で消えない）
// 読み出し時は message を起点に、同 id の update 行（最後の 1 件）を畳み込んで現在状態を作る。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { CHAJI_CHAT_FILE } from '../config.js';

// ─── 型 ─────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant';

/** メッセージの生成状態。assistant のみ pending/error を取りうる（user は常に done 相当）。 */
export type ChatStatus = 'pending' | 'done' | 'error';

/** 公開形のメッセージ（フロント・プロンプトに渡す形）。 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * 生成状態。'pending'=生成中 / 'done'=完了 / 'error'=失敗（丁寧メッセージ確定）。
   * 既存データ（status 無し）は 'done' とみなす（後方互換）。
   */
  status?: ChatStatus;
  /** ジョブ ID（assistant の pending を後で update で確定するための相関キー）。 */
  jobId?: string;
}

/** 永続レコード（JSONL の 1 行）。 */
interface MessageRecord {
  type: 'message';
  /** 一意 ID（重複排除・キー用・update の相関キー）。 */
  id: string;
  role: ChatRole;
  content: string;
  /** 生成状態（省略時は 'done' 相当）。 */
  status?: ChatStatus;
  /** ジョブ ID（assistant のバックグラウンド生成と紐づく）。 */
  jobId?: string;
  /** 作成日時（ISO8601）。 */
  ts: string;
}

/** 既存 message を後から確定する更新レコード（pending → done/error）。 */
interface UpdateRecord {
  type: 'update';
  /** 対象 message の id。 */
  id: string;
  content?: string;
  status: ChatStatus;
  ts: string;
}

interface ClearedRecord {
  type: 'cleared';
  ts: string;
}

type ChatRecord = MessageRecord | UpdateRecord | ClearedRecord;

// 1 メッセージ長の上限（過大レコード抑止）。
// user 入力は router 側で 4000 字に制限済み。assistant 応答は「## 出典」セクション（実在ページへの
// Markdown リンク）を末尾に持つことがあり 4000 字を超えうるため、保存側の上限は余裕を持たせて
// 出典リンクが途中で切れて壊れないようにする。
const MAX_CONTENT_CHARS = 8000;

// ─── 低レベル I/O ────────────────────────────────────────

/** JSONL を全走査してレコード配列を返す（追記順＝時系列）。壊れた行は無視。 */
function readAll(): ChatRecord[] {
  if (!existsSync(CHAJI_CHAT_FILE)) return [];
  let raw: string;
  try {
    raw = readFileSync(CHAJI_CHAT_FILE, 'utf-8');
  } catch {
    return [];
  }
  const out: ChatRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as ChatRecord;
      if (rec && (rec.type === 'message' || rec.type === 'update' || rec.type === 'cleared')) {
        out.push(rec);
      }
    } catch {
      // 壊れた行は無視。
    }
  }
  return out;
}

/** JSONL に 1 行追記する。ディレクトリが無ければ作成。 */
function appendRecord(rec: ChatRecord): void {
  const dir = dirname(CHAJI_CHAT_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(CHAJI_CHAT_FILE, JSON.stringify(rec) + '\n', 'utf-8');
}

/** 解決済み（update を畳み込んだ）メッセージの内部表現。 */
interface ResolvedMessage {
  id: string;
  role: ChatRole;
  content: string;
  status: ChatStatus;
  jobId?: string;
  ts: string;
}

/**
 * 直近の cleared マーカ以降の message を時系列で返す。
 * 同 id の update 行（pending → done/error の確定）を畳み込んで現在状態にする。
 * status 省略の旧データは 'done' 相当として扱う（後方互換）。
 */
function liveMessages(): ResolvedMessage[] {
  const all = readAll();
  // 最後の cleared マーカの位置を探し、それより後ろのみ採用する。
  let lastClearedIdx = -1;
  for (let i = 0; i < all.length; i += 1) {
    if (all[i]?.type === 'cleared') lastClearedIdx = i;
  }
  // まず message を順序通りに登録し、その後 update を畳み込む（update は message より後に来る前提）。
  const order: string[] = [];
  const byId = new Map<string, ResolvedMessage>();
  for (let i = lastClearedIdx + 1; i < all.length; i += 1) {
    const rec = all[i];
    if (!rec) continue;
    if (rec.type === 'message') {
      const resolved: ResolvedMessage = {
        id: rec.id,
        role: rec.role,
        content: rec.content,
        status: rec.status ?? 'done',
        ts: rec.ts,
      };
      if (rec.jobId) resolved.jobId = rec.jobId;
      if (!byId.has(rec.id)) order.push(rec.id);
      byId.set(rec.id, resolved);
    } else if (rec.type === 'update') {
      const target = byId.get(rec.id);
      if (!target) continue; // cleared 境界をまたいだ孤児 update は無視。
      target.status = rec.status;
      if (typeof rec.content === 'string') target.content = rec.content;
    }
  }
  return order.map((id) => byId.get(id)).filter((m): m is ResolvedMessage => !!m);
}

// ─── 公開 API ────────────────────────────────────────────

/** 公開形（role/content/status/jobId）に整形する。 */
function toPublic(r: ResolvedMessage): ChatMessage {
  const out: ChatMessage = { role: r.role, content: r.content };
  if (r.status && r.status !== 'done') out.status = r.status;
  if (r.jobId) out.jobId = r.jobId;
  return out;
}

/** 生きている会話履歴を時系列（古い順）で返す。空ならから配列。 */
export function listMessages(): ChatMessage[] {
  return liveMessages().map(toPublic);
}

/** ランダムな一意 ID を採番する（メッセージ id / jobId 共用）。 */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * メッセージを 1 件追記する。content は trim + 長さ上限。保存した id を返す。
 * status/jobId を渡すと生成状態・ジョブ相関キーを併せて永続化する（assistant の pending 用）。
 */
export function appendMessage(
  role: ChatRole,
  content: string,
  opts?: { status?: ChatStatus; jobId?: string },
): string {
  const text = String(content ?? '').trim().slice(0, MAX_CONTENT_CHARS);
  const rec: MessageRecord = {
    type: 'message',
    id: newId(),
    role,
    content: text,
    ts: new Date().toISOString(),
  };
  if (opts?.status) rec.status = opts.status;
  if (opts?.jobId) rec.jobId = opts.jobId;
  appendRecord(rec);
  return rec.id;
}

/**
 * user 発言を即永続化し、assistant 側に「pending（生成中）」エントリを作る。
 * バックグラウンド生成の完了時に finalizeAssistant(assistantId, ...) で done/error に確定する。
 * 接続が切れても user の質問と pending 状態は残るので、再オープンで「考え中…」を出して解決できる。
 * 返り値: { jobId, assistantId }（jobId は pending エントリと同値で相関キー）。
 */
export function startExchange(userText: string): { jobId: string; assistantId: string } {
  const jobId = newId();
  appendMessage('user', userText);
  const assistantId = appendMessage('assistant', '', { status: 'pending', jobId });
  return { jobId, assistantId };
}

/**
 * pending の assistant エントリを最終状態（done/error）に確定する（update 行を追記）。
 * status='done' は最終本文、status='error' はユーザー向けの丁寧メッセージを確定する。
 * クライアント接続の有無に関係なく必ず保存される（接続から切り離した永続化の肝）。
 */
export function finalizeAssistant(
  assistantId: string,
  status: 'done' | 'error',
  content: string,
): void {
  const rec: UpdateRecord = {
    type: 'update',
    id: assistantId,
    content: String(content ?? '').trim().slice(0, MAX_CONTENT_CHARS),
    status,
    ts: new Date().toISOString(),
  };
  appendRecord(rec);
}

/** 単一の assistant ジョブの現在状態を返す（job ステータス取得用）。無ければ null。 */
export function getJob(jobId: string): ChatMessage | null {
  const live = liveMessages();
  const found = live.find((m) => m.jobId === jobId);
  return found ? toPublic(found) : null;
}

/** 会話を論理クリアする（cleared マーカを追記）。履歴自体は監査上ファイルに残る。 */
export function clearMessages(): void {
  appendRecord({ type: 'cleared', ts: new Date().toISOString() });
}

/**
 * 文脈として渡す直近メッセージを返す（古い順・末尾 limit 件）。
 * トークン肥大を避けるため上限を設ける。末尾が user とは限らない点に注意。
 */
export function recentContext(limit: number): ChatMessage[] {
  const live = listMessages();
  return limit > 0 ? live.slice(-limit) : live;
}
