// Claude ページ（/claude）。話題を限定しない汎用 Claude アシスタントチャット。
//
// 茶事ページ（Chaji）のチャット部分を踏襲した単機能チャット画面（基礎知識ガイド等のタブは持たない）。
// API base は /api/claude。チャットクライアントは茶事のものをミラーし、ユーザーが画像/動画を添付して
// 送れる（画像は Claude が Read して見られる・マルチモーダル、動画は受領・表示のみ）。
//
// - 会話履歴はサーバ側 JSONL（data/claude-chat.jsonl）を正本に蓄積し（GET /api/claude/chat/history
//   で復元）、localStorage は端末ローカルのキャッシュ/フォールバックとして併用する。
// - アシスタント返答は Markdown として整形して表示（ChatMarkdown）。ユーザー発言は素のテキスト。
// - 添付メディアは送信前に POST /api/claude/chat/upload で先にサーバへ保存し、サーバ配信 URL を
//   ステージングのサムネにそのまま使う（createObjectURL を使わずリークを避ける）。
// - 単一の継続会話。複数スレッド管理は持たず、「履歴を消去（新規チャット）」だけを用意する。
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import ChatMarkdown from '../components/ChatMarkdown';
import { UserChatBody } from '../components/mediaEmbed';
import { CloseIcon, ImageFileIcon, SendIcon, SparkIcon } from '../components/icons';

// ─── 汎用 Claude チャット ────────────────────────────────────────────────
// 茶事チャットのクライアントを踏襲（API base を /api/claude に・ペルソナは汎用）。
type ClaudeRole = 'user' | 'assistant';
// 添付メディア参照。送信側（ユーザーの画像/動画）と返信側（Claude の YouTube 埋め込み・生成図解・
// 信頼ソース画像）の両方を扱う。
interface ClaudeMedia {
  id: string;
  // 'image'/'video' は実体配信、'youtube' は埋め込み（返信側の参考動画）。
  kind: 'image' | 'video' | 'youtube';
  // 配信 URL（GET /api/claude/chat/media/:id）。'youtube' は視聴ページ URL。
  url: string;
  mime: string;
  name?: string;
  size?: number;
  // 出所: 'upload'=ユーザー添付 / 'generated'=生成図解 / 'web'=検証済み YouTube・信頼ソース画像。
  source?: 'upload' | 'generated' | 'web';
  // キャプション（なぜおすすめか・図解の説明）。
  caption?: string;
  // YouTube 埋め込み用の videoId（kind==='youtube' のとき）。
  videoId?: string;
  // 出典・帰属表示用 URL（YouTube 視聴元 / 画像の出典ページ）。
  sourceUrl?: string;
  // 出典タイトル（帰属表示に使う）。
  sourceTitle?: string;
}
// 生成状態。'pending'=生成中（考え中…）/ 'done'=完了 / 'error'=失敗（丁寧メッセージ確定）。
type ClaudeStatus = 'pending' | 'done' | 'error';
interface ClaudeMessage {
  role: ClaudeRole;
  content: string;
  // 添付メディア（無ければ省略）。
  media?: ClaudeMedia[];
  // assistant のみ pending/error を取りうる（省略時は done 相当）。
  status?: ClaudeStatus;
  // ジョブ相関キー（pending を job ステータスで解決するため）。
  jobId?: string;
}

const CLAUDE_STORAGE_KEY = 'apollo.claudeChat.history.v1';
const CLAUDE_WELCOME =
  'こんにちは。Claude です。話題は問いません。調べもの・文章作成・要約・翻訳・アイデア出し・プログラミング・学習の相談から雑談まで、何でもお気軽にお尋ねください。事実情報は Web 検索で確認して、参照したページを出典としてお示しします。';

/** メッセージ配列を検証・正規化する（サーバ/localStorage どちらの入力にも使う）。 */
function normalizeMessages(parsed: unknown): ClaudeMessage[] {
  if (!Array.isArray(parsed)) return [];
  const out: ClaudeMessage[] = [];
  for (const m of parsed) {
    const role = (m as ClaudeMessage)?.role;
    const content = (m as ClaudeMessage)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const msg: ClaudeMessage = { role, content };
    const status = (m as ClaudeMessage)?.status;
    if (status === 'pending' || status === 'error' || status === 'done') msg.status = status;
    const jobId = (m as ClaudeMessage)?.jobId;
    if (typeof jobId === 'string' && jobId) msg.jobId = jobId;
    const media = (m as ClaudeMessage)?.media;
    if (Array.isArray(media)) {
      const list = media.filter((x): x is ClaudeMedia => {
        if (!x || typeof (x as ClaudeMedia).id !== 'string') return false;
        const k = (x as ClaudeMedia).kind;
        if (k === 'image' || k === 'video') {
          return typeof (x as ClaudeMedia).url === 'string';
        }
        // YouTube は埋め込みのため videoId が要る（url は視聴ページ）。
        if (k === 'youtube') {
          return typeof (x as ClaudeMedia).videoId === 'string' && !!(x as ClaudeMedia).videoId;
        }
        return false;
      });
      if (list.length > 0) msg.media = list;
    }
    out.push(msg);
  }
  return out;
}

/** 末尾の pending な assistant バブルを確定メッセージで置き換える（無ければ末尾に追加）。 */
function replaceLastPending(list: ClaudeMessage[], finalMsg: ClaudeMessage): ClaudeMessage[] {
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
function loadClaudeHistory(): ClaudeMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CLAUDE_STORAGE_KEY);
    if (!raw) return [];
    return normalizeMessages(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * Claude チャットの状態とロジックを 1 箇所に集約するフック。
 * 茶事チャット useChajiChat を踏襲（API base は /api/claude）。
 */
function useClaudeChat() {
  const [messages, setMessages] = useState<ClaudeMessage[]>(() => loadClaudeHistory());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 送信前に添付したメディア（アップロード済みで参照を保持）。
  const [pending, setPending] = useState<ClaudeMedia[]>([]);
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
      window.localStorage.setItem(CLAUDE_STORAGE_KEY, JSON.stringify(messages));
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
      const res = await fetch('/api/claude/chat/history', {
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
      const res = await fetch('/api/claude/chat/upload', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { media?: ClaudeMedia[]; error?: string };
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

    const userMsg: ClaudeMessage = { role: 'user', content: text || '（画像/動画を添付しました）' };
    if (media.length > 0) userMsg.media = media;
    // user 発言＋「考えています…」の pending バブルを楽観表示する（正本はサーバ）。
    const pendingAssistant: ClaudeMessage = { role: 'assistant', content: '', status: 'pending' };
    const next: ClaudeMessage[] = [...messages, userMsg];
    setMessages([...next, pendingAssistant]);
    setInput('');
    setPending([]);
    setError(null);
    setSending(true);
    setStreaming('');
    streamingRef.current = true;

    let acc = '';
    let resolved = false; // done を受け取って表示を確定できたか。
    // SSE ウォッチドッグ: トンネル越し（cloudflared 等）で SSE がバッファ/ハングして done も close も
    // 来ないと reader.read() が永久に待ちぼうけになり streamingRef が true のままになる → ポーリング
    // も抑止されて pending が永久に解決しない（「全然回答しない」の正体）。AbortController で SSE を
    // 強制中断し、「一定時間データが来ない」「全体が長すぎる」場合に abort してサーバ履歴ポーリング経路へ
    // 確実にフォールバックする。サーバは keep-alive ping を 15 秒ごとに流す。
    const ac = new AbortController();
    const FIRST_DATA_TIMEOUT_MS = 30_000;
    const IDLE_TIMEOUT_MS = 40_000;
    const OVERALL_TIMEOUT_MS = 240_000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let overallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (overallTimer) clearTimeout(overallTimer);
      idleTimer = null;
      overallTimer = null;
    };
    const bumpIdle = (ms: number) => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // 無音が続いた＝接続が死んでいる。SSE を中断してポーリングへ落とす。
        ac.abort();
      }, ms);
    };
    try {
      const res = await fetch('/api/claude/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          // サーバは末尾 user テキストに答える。content は空でない値を渡す。
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          media,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      bumpIdle(FIRST_DATA_TIMEOUT_MS);
      overallTimer = setTimeout(() => ac.abort(), OVERALL_TIMEOUT_MS);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalAnswer: string | null = null;
      let finalMedia: ClaudeMedia[] = [];
      let finalStatus: ClaudeStatus = 'done';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // 何か届いた（ping コメント行を含む）＝接続は生きている。無音タイマーを延ばす。
        bumpIdle(IDLE_TIMEOUT_MS);
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          // keep-alive コメント行（`: ping ...`）は無視（接続生存の確認だけに使う）。
          if (!line.startsWith('data: ')) continue;
          let evt: {
            type?: string;
            text?: string;
            answer?: string;
            media?: unknown;
            status?: ClaudeStatus;
          } = {};
          try {
            evt = JSON.parse(line.slice(6)) as typeof evt;
          } catch {
            continue;
          }
          if (evt.type === 'chunk' && typeof evt.text === 'string') {
            acc += evt.text;
            setStreaming(acc);
          } else if (evt.type === 'done') {
            // done の answer は記法を除去済みの整形本文。media は検証/生成済みのみ確定。
            finalAnswer = typeof evt.answer === 'string' && evt.answer ? evt.answer : acc;
            if (evt.status === 'error') finalStatus = 'error';
            if (Array.isArray(evt.media)) {
              const norm = normalizeMessages([{ role: 'assistant', content: '', media: evt.media }]);
              finalMedia = norm[0]?.media ?? [];
            }
            resolved = true;
          }
        }
      }
      const answer = (finalAnswer ?? acc).trim();
      if (resolved && answer) {
        // 完了を受け取れた → pending バブルを確定本文で置き換える。
        const assistantMsg: ClaudeMessage = { role: 'assistant', content: answer, status: finalStatus };
        if (finalMedia.length > 0) assistantMsg.media = finalMedia;
        setMessages((prev) => replaceLastPending(prev, assistantMsg));
      } else {
        // done を受け取れずストリームが切れた（接続断・途中終了）。失敗扱いにせず pending を残し、
        // ポーリング／タブ復帰でサーバの確定結果を取りに行く。
        streamingRef.current = false;
        void restore();
      }
    } catch {
      // 通信が確立できなかった／途中で切れた／ウォッチドッグが abort した。エラー確定せず
      // pending のまま、サーバ結果をポーリングで取りに行く（サーバはバックグラウンドで生成継続）。
      streamingRef.current = false;
      void restore();
    } finally {
      clearTimers();
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
    void fetch('/api/claude/chat/history', { method: 'DELETE' }).catch(() => {
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

type ClaudeChatState = ReturnType<typeof useClaudeChat>;

// ─── 入力バー（テキスト＋メディア添付）──────────────────────────────────
function ClaudeComposer({ chat }: { chat: ClaudeChatState }) {
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
              {/* 削除ボタン。当たり判定を大きく・常時高コントラストにする。 */}
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
          placeholder="メッセージを入力…"
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
    </div>
  );
}

// ─── メッセージ一覧 ──────────────────────────────────────────────────
function ClaudeMessageList({
  chat,
  scrollRef,
}: {
  chat: ClaudeChatState;
  scrollRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {/* ウェルカム（常に先頭に表示） */}
      <ClaudeBubble role="assistant">
        <ChatMarkdown body={CLAUDE_WELCOME} />
      </ClaudeBubble>
      {chat.messages.map((m, i) => {
        // ストリーミング中は末尾 pending を二重表示しない（streaming バブルが受け持つ）。
        const isLast = i === chat.messages.length - 1;
        if (m.role === 'assistant' && m.status === 'pending' && isLast && chat.streaming !== null) {
          return null;
        }
        return (
          <ClaudeBubble key={i} role={m.role} media={m.media}>
            {m.role === 'assistant' ? (
              m.status === 'pending' ? (
                <ClaudeThinking />
              ) : (
                <ChatMarkdown body={m.content} />
              )
            ) : (
              <UserChatBody text={m.content} />
            )}
          </ClaudeBubble>
        );
      })}
      {chat.streaming !== null && (
        <ClaudeBubble role="assistant">
          {chat.streaming.length > 0 ? <ChatMarkdown body={chat.streaming} /> : <ClaudeThinking />}
        </ClaudeBubble>
      )}
    </div>
  );
}

// ─── 「考えています…」インジケータ（pending / ストリーム待ち共通）─────────
function ClaudeThinking() {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted">
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:0.15s]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:0.3s]" />
      </span>
      <span className="text-xs">Claude が考えています…</span>
    </span>
  );
}

// ─── 吹き出し ────────────────────────────────────────────────────────
function ClaudeBubble({
  role,
  media,
  children,
}: {
  role: ClaudeRole;
  media?: ClaudeMedia[];
  children: ReactNode;
}) {
  const isUser = role === 'user';
  // メディア（添付画像/動画・返信側の YouTube 埋め込み/図解/画像）があるバブルは窮屈にならないよう広めに。
  const hasMedia = !!media && media.length > 0;
  const widthClass = hasMedia ? 'max-w-[92%] sm:max-w-[28rem]' : 'max-w-[85%]';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`${widthClass} break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-sm bg-accent text-bg'
            : 'rounded-bl-sm border border-border bg-surface text-text'
        }`}
      >
        {/* 添付メディア（ユーザーの画像/動画・Claude の埋め込み）。 */}
        {hasMedia && (
          <div className="mb-1.5 flex flex-col gap-2">
            {media!.map((m) => (
              <ClaudeMediaItem key={m.id} media={m} />
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ─── 1 メディア（画像/動画/YouTube 埋め込み）──────────────────────────────
//   - youtube: youtube-nocookie の iframe 埋め込み（aspect-video）。キャプション・出典を添える。
//   - image  : インライン画像。生成図解/信頼ソース画像はキャプション・出典リンクを添える。
//   - video  : ユーザー添付の動画（<video>）。
// XSS/安全: iframe は youtube-nocookie ドメイン固定。画像 src は検証済み自前配信 URL か添付 URL のみ。
function ClaudeMediaItem({ media: m }: { media: ClaudeMedia }) {
  if (m.kind === 'youtube' && m.videoId) {
    return (
      <figure className="m-0">
        <div className="overflow-hidden rounded-md border border-black/10 bg-black/5">
          <iframe
            className="aspect-video w-full"
            src={`https://www.youtube-nocookie.com/embed/${m.videoId}`}
            title={m.sourceTitle ?? m.caption ?? '参考動画'}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        {(m.caption || m.sourceTitle) && (
          <figcaption className="mt-1 text-[11px] leading-snug text-text-muted">
            {m.caption && <span>{m.caption}</span>}
            {m.sourceUrl && (
              <>
                {m.caption && ' '}
                <a
                  href={m.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-text"
                >
                  {m.sourceTitle ?? 'YouTube で見る'}
                </a>
              </>
            )}
          </figcaption>
        )}
      </figure>
    );
  }

  if (m.kind === 'image') {
    return (
      <figure className="m-0">
        <a href={m.url} target="_blank" rel="noopener noreferrer">
          <img
            src={m.url}
            alt={m.caption ?? m.name ?? (m.source === 'generated' ? '図解' : '画像')}
            loading="lazy"
            className="max-h-72 max-w-full rounded-md border border-black/10 object-contain"
          />
        </a>
        {(m.caption || m.sourceUrl) && (
          <figcaption className="mt-1 text-[11px] leading-snug text-text-muted">
            {m.caption && <span>{m.caption}</span>}
            {m.source === 'web' && m.sourceUrl && (
              <>
                {m.caption && ' '}
                <a
                  href={m.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-text"
                >
                  出典
                </a>
              </>
            )}
          </figcaption>
        )}
      </figure>
    );
  }
  // 動画（ユーザー添付）。内容解析はしないが、表示・再生はできる。
  return (
    <video
      src={m.url}
      controls
      preload="metadata"
      className="max-h-60 max-w-full rounded-md border border-black/10"
    />
  );
}

// ─── Claude チャットページ ──────────────────────────────────────────────
export default function ClaudeChat() {
  const chat = useClaudeChat();
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
    <div className="flex h-full flex-col">
      <PageHeader
        title="Claude"
        subtitle="話題を限定しない汎用 AI アシスタントです。何でもお気軽にご相談ください。"
        fetchedAt={undefined}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto flex h-full max-w-3xl flex-col">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"
              >
                <SparkIcon width={20} height={20} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-text">Claude に相談</p>
                <p className="truncate text-[11px] text-text-muted">汎用 AI アシスタント・過去の相談も残ります</p>
              </div>
            </div>
            {chat.messages.length > 0 && (
              <button
                type="button"
                onClick={chat.clearHistory}
                className="shrink-0 rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text"
              >
                新規チャット
              </button>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg">
            <ClaudeMessageList chat={chat} scrollRef={(el) => (scrollRef.current = el)} />
            <ClaudeComposer chat={chat} />
          </div>
        </div>
      </div>
    </div>
  );
}
