// chajiChatStore — 茶事チャット（表千家の茶道アドバイザー）の会話履歴 JSONL ストア。
//
// childcareChatStore.ts の作法をそのまま踏襲する。単一の会話スレッド（個人用ダッシュボード
// なので分岐不要）をサーバ側に永続化する。端末ローカルの localStorage と違い、別端末・リロードを
// またいで過去の質問が残る。茶事チャットは、ユーザー（生徒）が画像/動画を添付して送れる
// （childcareChatStore の ChatMedia を踏襲）。画像は AI が見てコメントでき、動画は受領・表示のみ。
//
// データストア（data/ 配下・.gitignore 済み）:
//   data/chaji-chat.jsonl  : 追記専用。1 行 = 1 レコード。
//     - メッセージ行: { type:'message', id, role:'user'|'assistant', content, ts, media?, status?, jobId? }
//     - 更新行:       { type:'update', id, content, media?, status, ts }  ← 既存 message を後から確定する
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

/**
 * メッセージに添付されたメディア参照（childcareChatStore の ChatMedia を踏襲）。
 *   - 送信側（生徒）の画像/動画アップロード（kind: 'image'|'video', source: 'upload'）
 *   - 返信側（茶事）のメディア返却:
 *       - YouTube 参考動画埋め込み（kind: 'youtube', source: 'web'）— oEmbed で実在検証済み
 *       - Gemini 生成図解（kind: 'image', source: 'generated'）— data/chaji-chat-media/ に保存
 *       - Web 実在画像の提示（kind: 'image', source: 'web'）— 検証後サーバへ取り込み自前配信
 * 実体（アップロード画像/動画・生成画像・取り込んだ Web 画像）は data/chaji-chat-media/ 配下に
 * 保存し、ここには参照（id/url/種別 等）だけを持つ。YouTube は埋め込みのため実体保存はせず
 * videoId/url を持つ。実在しないメディアは決してここに入れない（サーバ側で検証・生成に成功した
 * ものだけを確定する）。
 */
export interface ChatMedia {
  /** 一意 ID（保存名のプレフィックス・React key にも使う）。 */
  id: string;
  /** 種別。'youtube' は iframe 埋め込み、'image'/'video' は実体配信。動画は AI が内容解析しない前提。 */
  kind: 'image' | 'video' | 'youtube';
  /** 配信 URL（GET /api/chaji/chat/media/:id）。'youtube' は視聴ページ URL。 */
  url: string;
  /** MIME タイプ（'youtube' では空でよい）。 */
  mime: string;
  /** 元ファイル名（表示・ダウンロード用）。 */
  name?: string;
  /** バイトサイズ。 */
  size?: number;
  /**
   * 出所。
   *   - 'upload'    : 生徒がアップロードした添付。
   *   - 'generated': 茶事が Gemini で生成した図解。
   *   - 'web'      : Web 検索で見つけ、実在検証した YouTube 動画 / 信頼ソースの画像。
   */
  source?: 'upload' | 'generated' | 'web';
  /** 任意のキャプション（なぜこの動画/画像がおすすめか・図解の説明）。 */
  caption?: string;
  /** 'youtube' の動画 ID（youtube-nocookie の埋め込みに使う）。検証済みのものだけ入る。 */
  videoId?: string;
  /** 'youtube'/'web' の出典・帰属表示用 URL（視聴元ページ / 画像の出典ページ）。 */
  sourceUrl?: string;
  /** 出典タイトル（oEmbed の title / 出典ページタイトル）。帰属表示に使う。 */
  sourceTitle?: string;
}

/** メッセージの生成状態。assistant のみ pending/error を取りうる（user は常に done 相当）。 */
export type ChatStatus = 'pending' | 'done' | 'error';

/** 公開形のメッセージ（フロント・プロンプトに渡す形）。 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** 添付メディア（無ければ省略）。 */
  media?: ChatMedia[];
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
  /** 添付メディア（無ければ省略）。 */
  media?: ChatMedia[];
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
  media?: ChatMedia[];
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
  media?: ChatMedia[];
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
      if (Array.isArray(rec.media) && rec.media.length > 0) resolved.media = rec.media;
      if (rec.jobId) resolved.jobId = rec.jobId;
      if (!byId.has(rec.id)) order.push(rec.id);
      byId.set(rec.id, resolved);
    } else if (rec.type === 'update') {
      const target = byId.get(rec.id);
      if (!target) continue; // cleared 境界をまたいだ孤児 update は無視。
      target.status = rec.status;
      if (typeof rec.content === 'string') target.content = rec.content;
      if (Array.isArray(rec.media)) {
        if (rec.media.length > 0) target.media = rec.media;
        else delete target.media;
      }
    }
  }
  return order.map((id) => byId.get(id)).filter((m): m is ResolvedMessage => !!m);
}

// ─── 公開 API ────────────────────────────────────────────

/** 公開形（role/content/media/status/jobId）に整形する。media が空なら省略する。 */
function toPublic(r: ResolvedMessage): ChatMessage {
  const out: ChatMessage = { role: r.role, content: r.content };
  if (Array.isArray(r.media) && r.media.length > 0) out.media = r.media;
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
 * media を渡すと添付参照を一緒に永続化する（再オープンで画像/動画が残る）。
 * status/jobId を渡すと生成状態・ジョブ相関キーを併せて永続化する（assistant の pending 用）。
 */
export function appendMessage(
  role: ChatRole,
  content: string,
  media?: ChatMedia[],
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
  if (Array.isArray(media) && media.length > 0) rec.media = media;
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
export function startExchange(
  userText: string,
  userMedia?: ChatMedia[],
): { jobId: string; assistantId: string } {
  const jobId = newId();
  appendMessage('user', userText, userMedia);
  const assistantId = appendMessage('assistant', '', undefined, { status: 'pending', jobId });
  return { jobId, assistantId };
}

/**
 * pending の assistant エントリを最終状態（done/error）に確定する（update 行を追記）。
 * status='done' は最終本文＋検証済み media、status='error' はユーザー向けの丁寧メッセージを確定する。
 * クライアント接続の有無に関係なく必ず保存される（接続から切り離した永続化の肝）。
 */
export function finalizeAssistant(
  assistantId: string,
  status: 'done' | 'error',
  content: string,
  media?: ChatMedia[],
): void {
  const rec: UpdateRecord = {
    type: 'update',
    id: assistantId,
    content: String(content ?? '').trim().slice(0, MAX_CONTENT_CHARS),
    status,
    ts: new Date().toISOString(),
  };
  // media は明示的に配列を渡したときのみ反映（done は検証済み配列、error は [] で添付なしに倒す）。
  if (Array.isArray(media)) rec.media = media;
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
