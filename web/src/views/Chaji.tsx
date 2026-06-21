// 茶事ページ（/chaji）。表千家の茶道をこれから習う人向けの基礎知識ガイド＋質問チャット。
//
// 育児ページ（Childcare）の「育児チャット すくすく」を踏襲する。上部に「基礎知識ガイド」を
// 表示する領域、下部にチャット UI（茶事チャット）をタブで切り替える。チャットクライアントは
// 育児のものを踏襲し、API base を /api/chaji に向ける。茶事チャットは、ユーザー（生徒）が画像/
// 動画を添付して送れる（childcare のユーザー添付側をミラー）。画像はアドバイザーが見て表千家の
// 文脈でコメントでき、動画は受領・表示のみ。
//
// - 会話履歴はサーバ側 JSONL（data/chaji-chat.jsonl）を正本に蓄積し（GET /api/chaji/chat/history
//   で復元）、localStorage は端末ローカルのキャッシュ/フォールバックとして併用する。
// - アシスタント返答は Markdown として整形して表示（ChatMarkdown）。ユーザー発言は素のテキスト。
// - 添付メディアは送信前に POST /api/chaji/chat/upload で先にサーバへ保存し、サーバ配信 URL を
//   ステージングのサムネにそのまま使う（createObjectURL を使わずリークを避ける＝MC-102/103 の教訓）。
//   送信時に media 参照を本文に添える。吹き出しには添付画像（インライン）/動画（<video>）を表示。
// - 基礎知識ガイド本文は chajiData.CHAJI_GUIDE_MARKDOWN（プレースホルダ）を ChatMarkdown で描画。
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import ChatMarkdown from '../components/ChatMarkdown';
import { ChajiIcon, ChildcareChatIcon, CloseIcon, ImageFileIcon, SendIcon } from '../components/icons';
import { CHAJI_GUIDE_MARKDOWN } from './chajiData';

// ─── 基礎知識ガイド（プレースホルダ Markdown を描画）────────────────────
function ChajiGuide() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
        <div className="mb-3">
          <h2 className="text-base font-bold text-text">表千家 茶道の基礎知識</h2>
          <p className="mt-1 text-xs text-text-muted">
            これから表千家の茶道を習う方向けの基礎知識ガイドです。具体的な疑問は「茶事チャット」でご相談ください。
          </p>
        </div>
        <div className="mc-markdown">
          <ChatMarkdown body={CHAJI_GUIDE_MARKDOWN} />
        </div>
        <p className="mt-3 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
          作法は表千家（不審菴）に則っています。細部は社中（お稽古の先生）によって異なることがあります。最終的にはお稽古の先生に倣ってください。
        </p>
      </section>
    </div>
  );
}

// ─── 茶事チャット（表千家の茶道アドバイザー）─────────────────────────────
// 育児チャット「すくすく」のクライアントを踏襲（API base を /api/chaji に）。テキストのみ。
type ChajiRole = 'user' | 'assistant';
// 添付メディア参照（生徒の画像/動画アップロード）。childcare の SukuMedia のユーザー添付側を踏襲。
interface ChajiMedia {
  id: string;
  // 'image' はインライン表示・AI が見られる、'video' は <video> 表示（AI は内容解析しない）。
  kind: 'image' | 'video';
  // 配信 URL（GET /api/chaji/chat/media/:id）。ステージングのサムネにもそのまま使う。
  url: string;
  mime: string;
  name?: string;
  size?: number;
  // 出所。茶事チャットでは常に 'upload'（生徒がアップロードした添付）。
  source?: 'upload';
}
// 生成状態。'pending'=生成中（考え中…）/ 'done'=完了 / 'error'=失敗（丁寧メッセージ確定）。
type ChajiStatus = 'pending' | 'done' | 'error';
interface ChajiMessage {
  role: ChajiRole;
  content: string;
  // 添付メディア（無ければ省略）。
  media?: ChajiMedia[];
  // assistant のみ pending/error を取りうる（省略時は done 相当）。
  status?: ChajiStatus;
  // ジョブ相関キー（pending を job ステータスで解決するため）。
  jobId?: string;
}

const CHAJI_STORAGE_KEY = 'apollo.chajiChat.history.v1';
const CHAJI_WELCOME =
  '茶事（ちゃじ）です。表千家の茶道アドバイザーとして、これから茶道を習う方のご相談にお答えします。茶道の成り立ちや歴史、茶事・茶会の流れ、点前の基礎、客としての作法、道具やしつらえ、心得まで、分からないことを何でもお尋ねください。作法は表千家（不審菴）に則ってご案内します。';

const CHAJI_SAFETY_NOTE =
  '作法は表千家（不審菴）に則った一般的な目安です。社中（お稽古の先生）によって細部が異なることがあります。最終的にはお稽古の先生に倣ってください。';

/** メッセージ配列を検証・正規化する（サーバ/localStorage どちらの入力にも使う）。 */
function normalizeMessages(parsed: unknown): ChajiMessage[] {
  if (!Array.isArray(parsed)) return [];
  const out: ChajiMessage[] = [];
  for (const m of parsed) {
    const role = (m as ChajiMessage)?.role;
    const content = (m as ChajiMessage)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const msg: ChajiMessage = { role, content };
    const status = (m as ChajiMessage)?.status;
    if (status === 'pending' || status === 'error' || status === 'done') msg.status = status;
    const jobId = (m as ChajiMessage)?.jobId;
    if (typeof jobId === 'string' && jobId) msg.jobId = jobId;
    const media = (m as ChajiMessage)?.media;
    if (Array.isArray(media)) {
      const list = media.filter((x): x is ChajiMedia => {
        if (!x || typeof (x as ChajiMedia).id !== 'string') return false;
        const k = (x as ChajiMedia).kind;
        if (k !== 'image' && k !== 'video') return false;
        return typeof (x as ChajiMedia).url === 'string';
      });
      if (list.length > 0) msg.media = list;
    }
    out.push(msg);
  }
  return out;
}

/** 末尾の pending な assistant バブルを確定メッセージで置き換える（無ければ末尾に追加）。 */
function replaceLastPending(list: ChajiMessage[], finalMsg: ChajiMessage): ChajiMessage[] {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.role === 'assistant' && m.status === 'pending') {
      const out = list.slice();
      out[i] = finalMsg;
      return out;
    }
  }
  return [...list, finalMsg];
}

/** localStorage から会話履歴を復元する（壊れていれば空配列）。 */
function loadChajiHistory(): ChajiMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CHAJI_STORAGE_KEY);
    if (!raw) return [];
    return normalizeMessages(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * 茶事チャットの状態とロジックを 1 箇所に集約するフック。
 * 育児チャット useSukuChat を踏襲（テキストのみ・API base は /api/chaji）。
 */
function useChajiChat() {
  const [messages, setMessages] = useState<ChajiMessage[]>(() => loadChajiHistory());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 送信前に添付したメディア（アップロード済みで参照を保持）。
  const [pending, setPending] = useState<ChajiMedia[]>([]);
  // ストリーミング中のアシスタント部分応答（確定前のテキスト）。
  const [streaming, setStreaming] = useState<string | null>(null);
  // 進行中ジョブがあるか（pending を解決するためのポーリング駆動に使う）。
  const [hasPending, setHasPending] = useState(false);
  // ストリーミング購読が生きているか（生きている間はポーリング resync を抑止して二重描画を避ける）。
  const streamingRef = useRef(false);

  // 履歴を localStorage に永続化する（端末キャッシュ。正本はサーバ）。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CHAJI_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* 容量超過等は無視（チャットは継続できる） */
    }
  }, [messages]);

  // messages に pending の assistant があるかを監視し、ポーリングのオン/オフを切り替える。
  useEffect(() => {
    setHasPending(messages.some((m) => m.role === 'assistant' && m.status === 'pending'));
  }, [messages]);

  /** サーバ保存の会話履歴を取り込んで表示を置き換える（正本）。失敗時はキャッシュのまま。 */
  const restore = useCallback(async () => {
    try {
      const res = await fetch('/api/chaji/chat/history', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: unknown };
      // ストリーミング購読が生きている間はサーバ resync で上書きしない（逐次表示を優先）。
      if (streamingRef.current) return;
      setMessages(normalizeMessages(data.messages));
    } catch {
      /* 取得失敗時は localStorage キャッシュのまま継続 */
    }
  }, []);

  // pending が残っている間、サーバ履歴をポーリングして done/error に解決する。
  // 接続が切れて「通信に失敗しました」を出す代わりに、ここでサーバの結果を取りに行く。
  useEffect(() => {
    if (!hasPending) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || streamingRef.current) return;
      await restore();
    };
    const timer = setInterval(() => void tick(), 4000);
    // タブ復帰・アプリ再オープン時にも即座に取り直す（visibilitychange）。
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasPending, restore]);

  /** ファイル選択 → サーバへアップロードして pending に追加する。 */
  const upload = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of list) form.append('files', f);
      const res = await fetch('/api/chaji/chat/upload', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { media?: ChajiMedia[]; error?: string };
      if (!res.ok) {
        setError(data.error || 'アップロードに失敗しました。');
        return;
      }
      const added = Array.isArray(data.media) ? data.media : [];
      setPending((prev) => [...prev, ...added]);
    } catch {
      setError('アップロードに失敗しました。通信状況をご確認ください。');
    } finally {
      setUploading(false);
    }
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((prev) => prev.filter((m) => m.id !== id));
  }, []);

  /**
   * 送信。テキストか添付メディアのどちらかがあれば送れる。
   * AI 生成はサーバ側でバックグラウンド実行され、結果はサーバに永続化される。SSE が繋がっている間は
   * 逐次表示するが、完了の正本はサーバ。接続が切れても「通信に失敗しました」で確定せず、pending の
   * ままにして history ポーリング／タブ復帰で結果を取りに行く（画面を離れて戻っても回答が出る）。
   */
  const send = useCallback(async () => {
    const text = input.trim();
    const media = pending;
    if ((!text && media.length === 0) || sending) return;

    const userMsg: ChajiMessage = { role: 'user', content: text || '（画像/動画を添付しました）' };
    if (media.length > 0) userMsg.media = media;
    // user 発言＋「考えています…」の pending バブルを楽観表示する（正本はサーバ）。
    const pendingAssistant: ChajiMessage = { role: 'assistant', content: '', status: 'pending' };
    const next: ChajiMessage[] = [...messages, userMsg];
    setMessages([...next, pendingAssistant]);
    setInput('');
    setPending([]);
    setError(null);
    setSending(true);
    setStreaming('');
    streamingRef.current = true;

    let acc = '';
    let resolved = false; // done を受け取って表示を確定できたか。
    try {
      const res = await fetch('/api/chaji/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          // サーバは末尾 user テキストに答える。content は空でない値を渡す。
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          media,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalAnswer: string | null = null;
      let finalStatus: ChajiStatus = 'done';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt: { type?: string; text?: string; answer?: string; status?: ChajiStatus } = {};
          try {
            evt = JSON.parse(line.slice(6)) as typeof evt;
          } catch {
            continue;
          }
          if (evt.type === 'chunk' && typeof evt.text === 'string') {
            acc += evt.text;
            setStreaming(acc);
          } else if (evt.type === 'done') {
            // done の answer は整形本文。
            finalAnswer = typeof evt.answer === 'string' && evt.answer ? evt.answer : acc;
            if (evt.status === 'error') finalStatus = 'error';
            resolved = true;
          }
        }
      }
      const answer = (finalAnswer ?? acc).trim();
      if (resolved && answer) {
        // 完了を受け取れた → pending バブルを確定本文で置き換える。
        const assistantMsg: ChajiMessage = { role: 'assistant', content: answer, status: finalStatus };
        setMessages((prev) => replaceLastPending(prev, assistantMsg));
      } else {
        // done を受け取れずストリームが切れた（接続断・途中終了）。失敗扱いにせず pending を残し、
        // ポーリング／タブ復帰でサーバの確定結果を取りに行く。
        streamingRef.current = false;
        void restore();
      }
    } catch {
      // 通信が確立できなかった／途中で切れた。エラー確定せず pending のまま、サーバ結果を待つ。
      streamingRef.current = false;
      void restore();
    } finally {
      setStreaming(null);
      setSending(false);
      streamingRef.current = false;
    }
  }, [input, pending, sending, messages, restore]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setStreaming(null);
    setPending([]);
    // サーバ側の蓄積も論理クリアする（失敗しても表示はクリア済みのまま）。
    void fetch('/api/chaji/chat/history', { method: 'DELETE' }).catch(() => {
      /* 通信失敗時はローカルのみクリア */
    });
  }, []);

  return {
    messages,
    input,
    setInput,
    sending,
    uploading,
    error,
    pending,
    streaming,
    restore,
    upload,
    removePending,
    send,
    clearHistory,
  };
}

type ChajiChat = ReturnType<typeof useChajiChat>;

// ─── 入力バー（テキスト＋メディア添付）──────────────────────────────────
function ChajiComposer({ chat }: { chat: ChajiChat }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canSend = (chat.input.trim().length > 0 || chat.pending.length > 0) && !chat.sending;
  return (
    <div className="border-t border-border px-3 py-3">
      {/* 添付プレビュー（送信前のステージング）。サムネはサーバ配信 URL を使う（object URL を作らない）。 */}
      {chat.pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {chat.pending.map((m) => (
            <div
              key={m.id}
              className="relative overflow-hidden rounded-md border border-border bg-surface-2"
            >
              {m.kind === 'image' ? (
                <img src={m.url} alt={m.name ?? '添付画像'} className="h-16 w-16 object-cover" />
              ) : (
                <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 px-1 text-center">
                  <span aria-hidden className="text-base">🎬</span>
                  <span className="line-clamp-1 text-[9px] text-text-muted">動画</span>
                </div>
              )}
              {/* 削除ボタン。当たり判定を大きく・常時高コントラストにする（MC-102/103 の教訓）。 */}
              <button
                type="button"
                onClick={() => chat.removePending(m.id)}
                aria-label="添付を削除"
                className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white shadow-sm hover:bg-black/85"
              >
                <CloseIcon width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {chat.error && <p className="mb-1.5 px-1 text-[11px] text-blocked">{chat.error}</p>}
      <div className="flex items-end gap-2">
        {/* メディア添付ボタン */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/heic,video/mp4,video/quicktime,video/webm"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void chat.upload(files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={chat.uploading || chat.sending}
          aria-label="画像・動画を添付"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {chat.uploading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
          ) : (
            <ImageFileIcon width={18} height={18} />
          )}
        </button>
        <textarea
          value={chat.input}
          onChange={(e) => chat.setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter で送信（Shift+Enter で改行）。
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void chat.send();
            }
          }}
          rows={1}
          placeholder="茶道の疑問を入力…"
          aria-label="メッセージを入力"
          className="max-h-28 min-h-[40px] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void chat.send()}
          disabled={!canSend}
          aria-label="送信"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendIcon width={18} height={18} />
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-text-faint">{CHAJI_SAFETY_NOTE}</p>
    </div>
  );
}

// ─── メッセージ一覧 ──────────────────────────────────────────────────
function ChajiMessageList({
  chat,
  scrollRef,
}: {
  chat: ChajiChat;
  scrollRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {/* ウェルカム（常に先頭に表示） */}
      <ChajiBubble role="assistant">
        <ChatMarkdown body={CHAJI_WELCOME} />
      </ChajiBubble>
      {chat.messages.map((m, i) => {
        // ストリーミング中は末尾 pending を二重表示しない（streaming バブルが受け持つ）。
        const isLast = i === chat.messages.length - 1;
        if (m.role === 'assistant' && m.status === 'pending' && isLast && chat.streaming !== null) {
          return null;
        }
        return (
          <ChajiBubble key={i} role={m.role} media={m.media}>
            {m.role === 'assistant' ? (
              m.status === 'pending' ? (
                <ChajiThinking />
              ) : (
                <ChatMarkdown body={m.content} />
              )
            ) : (
              <span className="whitespace-pre-wrap break-words">{m.content}</span>
            )}
          </ChajiBubble>
        );
      })}
      {chat.streaming !== null && (
        <ChajiBubble role="assistant">
          {chat.streaming.length > 0 ? <ChatMarkdown body={chat.streaming} /> : <ChajiThinking />}
        </ChajiBubble>
      )}
    </div>
  );
}

// ─── 「考えています…」インジケータ（pending / ストリーム待ち共通）─────────
function ChajiThinking() {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted">
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:0.15s]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:0.3s]" />
      </span>
      <span className="text-xs">茶事が考えています…</span>
    </span>
  );
}

// ─── 吹き出し ────────────────────────────────────────────────────────
function ChajiBubble({
  role,
  media,
  children,
}: {
  role: ChajiRole;
  media?: ChajiMedia[];
  children: ReactNode;
}) {
  const isUser = role === 'user';
  // 添付画像/動画があるバブルは窮屈にならないよう少し広めにする。
  const hasMedia = !!media && media.length > 0;
  const widthClass = hasMedia ? 'max-w-[92%] sm:max-w-[24rem]' : 'max-w-[85%]';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`${widthClass} break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-sm bg-accent text-bg'
            : 'rounded-bl-sm border border-border bg-surface text-text'
        }`}
      >
        {/* 添付メディア（生徒の画像/動画）。 */}
        {hasMedia && (
          <div className="mb-1.5 flex flex-col gap-2">
            {media!.map((m) => (
              <ChajiMediaItem key={m.id} media={m} />
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ─── 茶事チャットの 1 メディア（生徒添付の画像/動画）──────────────────────
//   - image: インライン画像（クリックで原寸を別タブで開く）。
//   - video: 添付動画（<video controls>）。
// 画像 src は自前配信 URL（GET /api/chaji/chat/media/:id）のみ。
function ChajiMediaItem({ media: m }: { media: ChajiMedia }) {
  if (m.kind === 'image') {
    return (
      <figure className="m-0">
        <a href={m.url} target="_blank" rel="noopener noreferrer">
          <img
            src={m.url}
            alt={m.name ?? '画像'}
            loading="lazy"
            className="max-h-72 max-w-full rounded-md border border-black/10 object-contain"
          />
        </a>
      </figure>
    );
  }
  // 動画（生徒添付）。内容解析はしないが、表示・再生はできる。
  return (
    <video
      src={m.url}
      controls
      preload="metadata"
      className="max-h-60 max-w-full rounded-md border border-black/10"
    />
  );
}

// ─── 茶事チャットタブ ────────────────────────────────────────────────
function ChajiChatTab() {
  const chat = useChajiChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // マウント時にサーバ履歴を取り込む（リロード・別端末・再オープンで過去の質問が並ぶ）。
  useEffect(() => {
    void chat.restore();
    // restore は安定参照（useCallback）。初回のみ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新しいメッセージ・ストリーム更新で最下部へスクロール。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streaming]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"
          >
            <ChildcareChatIcon width={20} height={20} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-text">茶事に相談</p>
            <p className="truncate text-[11px] text-text-muted">表千家の茶道アドバイザー・過去の相談も残ります</p>
          </div>
        </div>
        {chat.messages.length > 0 && (
          <button
            type="button"
            onClick={chat.clearHistory}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text"
          >
            履歴を消去
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg">
        <ChajiMessageList chat={chat} scrollRef={(el) => (scrollRef.current = el)} />
        <ChajiComposer chat={chat} />
      </div>
    </div>
  );
}

// ─── 茶事チャット FAB（他タブからチャットタブへ飛ぶ導線）──────────────────
// 育児ページの ChildcareChatFab を踏襲。タップで「茶事チャット」タブへ遷移する（hidden で非表示）。
function ChajiChatFab({ onOpen, hidden }: { onOpen: () => void; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="茶事の相談チャットを開く"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-accent/30 bg-accent text-bg shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:bottom-6 md:right-6"
    >
      <ChildcareChatIcon width={26} height={26} />
    </button>
  );
}

type ChajiTab = 'guide' | 'chat';

/** 初期タブ判定: prop 優先。既定は 'guide'（基礎知識ガイド）。?tab=chat を尊重。 */
function resolveInitialTab(initialTab?: ChajiTab): ChajiTab {
  if (initialTab) return initialTab;
  if (typeof window !== 'undefined') {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'chat') return 'chat';
    if (t === 'guide') return 'guide';
  }
  return 'guide';
}

// ─── タブバー（基礎知識ガイド / 茶事チャット）。下線アクティブ流儀 ──────────
function ChajiTabBar({ tab, onChange }: { tab: ChajiTab; onChange: (t: ChajiTab) => void }) {
  const tabs: { id: ChajiTab; label: string; icon: ReactNode }[] = [
    { id: 'guide', label: '基礎知識ガイド', icon: <ChajiIcon width={16} height={16} /> },
    { id: 'chat', label: '茶事チャット', icon: <ChildcareChatIcon width={16} height={16} /> },
  ];
  return (
    <div className="flex border-b border-border px-4 md:px-6" role="tablist" aria-label="茶事ページのタブ">
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active
                ? 'border-accent font-semibold text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Chaji({ initialTab }: { initialTab?: ChajiTab } = {}) {
  const [tab, setTab] = useState<ChajiTab>(() => resolveInitialTab(initialTab));

  const changeTab = (next: ChajiTab) => {
    setTab(next);
    // URL をタブに同期（リロードでタブ維持・履歴は汚さない）。基礎知識ガイドが既定。
    if (typeof window !== 'undefined') {
      const url = next === 'chat' ? '/chaji?tab=chat' : '/chaji';
      window.history.replaceState(null, '', url);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="茶事"
        subtitle="表千家の茶道をこれから習う方向けの基礎知識ガイドと、表千家の作法に則ってお答えする質問チャットです。"
        fetchedAt={undefined}
      />
      <ChajiTabBar tab={tab} onChange={changeTab} />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {tab === 'chat' ? <ChajiChatTab /> : <ChajiGuide />}
      </div>
      {/* チャットタブ以外のときだけ FAB を出す（タップで茶事チャットタブへ遷移）。 */}
      <ChajiChatFab hidden={tab === 'chat'} onOpen={() => changeTab('chat')} />
    </div>
  );
}
