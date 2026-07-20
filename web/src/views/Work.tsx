// 仕事ページ（/work, MC-260）。メガバンクの ECL（予想信用損失）システム導入 PMO 案件向けの
// 学習・壁打ち＋ナレッジ蓄積ツール。茶事ページ（Chaji）のタブ＋チャット構成を踏襲しつつ、
// メディア添付は扱わない（テキストのみ）。タブ構成（2026-07-20 Keita・MC-319 で
// 概要／動画DL／状況解析を撤去。ナレッジ＋単語帳のみ。壁打ちは右下フローティングチャット）:
//   - ナレッジ: 体系ナレッジの蓄積（CRUD ＋ 生インプットの AI 体系化）。/api/work/knowledge。
//   - 単語帳 : ECL/PMO 用語集（workGlossary）。
//
// チャットは茶事チャットのジョブ方式（接続から切り離した非同期生成・pending→ポーリング解決）を踏襲。
// 接続が切れても回答は失われず、再オープン／タブ復帰でサーバの確定結果を取りに行く。
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import ChatMarkdown from '../components/ChatMarkdown';
import { UserChatBody } from '../components/mediaEmbed';
import {
  ChatIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  ExpandIcon,
  ImageFileIcon,
  NotebookIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  ShrinkIcon,
  SparkIcon,
  TagIcon,
  TextFileIcon,
  TrashIcon,
} from '../components/icons';
// ピボット／課題管理費／PwC転職 の各タブはサイドメニュー整理でUIから削除し、内容は Vault
// （40-Resources/work-ecl/*.md）へ格納した（2026-07-06 Keita）。ガイド原文の
// workPivotGuide / workCostPivotGuide / workPwcGuide とその図解コンポーネントはリポジトリに残置。
import {
  WORK_GLOSSARY,
  GLOSSARY_CATEGORIES,
  type GlossaryCategory,
  type GlossaryTerm,
} from './workGlossary';

// ナレッジのカテゴリ既定リスト（server: workKnowledgeStore.KNOWLEDGE_CATEGORIES と一致させる）。
const WORK_CATEGORIES = [
  'ECL/会計基準',
  'システム実装',
  '与信管理',
  '銀行業務',
  'データベース',
  'PMO',
  'その他',
] as const;
type WorkCategory = (typeof WORK_CATEGORIES)[number];

// ─── 壁打ちチャット（ECL/PMO アドバイザー）─────────────────────────────
// 茶事チャットのメディア対応版を踏襲。API base は /api/work。送信側（相談者の画像/動画）と
// 返信側（アドバイザーの YouTube 埋め込み・生成図解・信頼ソース画像）の両方を扱う。
type WorkRole = 'user' | 'assistant';
type WorkStatus = 'pending' | 'done' | 'error';
// 添付メディア参照（chaji の ChajiMedia を踏襲）。
interface WorkMedia {
  id: string;
  // 'image'/'video' は実体配信、'youtube' は埋め込み（返信側の参考動画）。
  kind: 'image' | 'video' | 'youtube';
  // 配信 URL（GET /api/work/chat/media/:id）。'youtube' は視聴ページ URL。
  url: string;
  mime: string;
  name?: string;
  size?: number;
  // 出所: 'upload'=相談者添付 / 'generated'=生成図解 / 'web'=検証済み YouTube・信頼ソース画像。
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
interface WorkMessage {
  role: WorkRole;
  content: string;
  // 添付メディア（無ければ省略）。
  media?: WorkMedia[];
  status?: WorkStatus;
  jobId?: string;
}

const WORK_STORAGE_KEY = 'apollo.workChat.history.v1';
// 壁打ちアドバイザーの名前（2026-07-06 Keita「名前を付けて」）。表示名のみで、変更はこの1箇所で可。
const WORK_ADVISOR_NAME = 'クレア';
// フローティングチャットの開閉状態を端末に保持するキー（「いつも右下に置いてある」ため既定は開）。
const WORK_CHAT_OPEN_KEY = 'apollo.workChat.open.v1';
const WORK_WELCOME =
  `ECL/PMO 壁打ちアドバイザーの「${WORK_ADVISOR_NAME}」です。ECL（予想信用損失）・IFRS9・銀行会計・与信管理・データ基盤・PMO に精通しています。2030 年 4 月の会計基準変更に対応する ECL システム導入プロジェクトについて、概要の学習から、システム実装の論点、与信管理・銀行業務・DB、PMO の進め方まで、何でもご相談ください。考えの整理・抜け漏れの指摘・段取りの提案もします。事実情報には Web で確認した出典を添えます。`;
const WORK_CHAT_NOTE =
  '事実情報には Web 検索で確認した出典を添えます。日本の 2030 年 4 月 ECL 移行など未確定の事項は「要確認」として扱い、断定しません。';

/** メッセージ配列を検証・正規化する（サーバ/localStorage どちらの入力にも使う）。 */
function normalizeMessages(parsed: unknown): WorkMessage[] {
  if (!Array.isArray(parsed)) return [];
  const out: WorkMessage[] = [];
  for (const m of parsed) {
    const role = (m as WorkMessage)?.role;
    const content = (m as WorkMessage)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const msg: WorkMessage = { role, content };
    const status = (m as WorkMessage)?.status;
    if (status === 'pending' || status === 'error' || status === 'done') msg.status = status;
    const jobId = (m as WorkMessage)?.jobId;
    if (typeof jobId === 'string' && jobId) msg.jobId = jobId;
    const media = (m as WorkMessage)?.media;
    if (Array.isArray(media)) {
      const list = media.filter((x): x is WorkMedia => {
        if (!x || typeof (x as WorkMedia).id !== 'string') return false;
        const k = (x as WorkMedia).kind;
        if (k === 'image' || k === 'video') {
          return typeof (x as WorkMedia).url === 'string';
        }
        // YouTube は埋め込みのため videoId が要る（url は視聴ページ）。
        if (k === 'youtube') {
          return typeof (x as WorkMedia).videoId === 'string' && !!(x as WorkMedia).videoId;
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
function replaceLastPending(list: WorkMessage[], finalMsg: WorkMessage): WorkMessage[] {
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
function loadWorkHistory(): WorkMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(WORK_STORAGE_KEY);
    if (!raw) return [];
    return normalizeMessages(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * 壁打ちチャットの状態とロジックを 1 箇所に集約するフック。
 * 茶事 useChajiChat を踏襲（送受信メディア対応・API base は /api/work）。
 */
function useWorkChat() {
  const [messages, setMessages] = useState<WorkMessage[]>(() => loadWorkHistory());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 送信前に添付したメディア（アップロード済みで参照を保持）。
  const [pending, setPending] = useState<WorkMedia[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [hasPending, setHasPending] = useState(false);
  // ストリーミング購読が生きているか（生きている間はポーリング resync を抑止して二重描画を避ける）。
  const streamingRef = useRef(false);

  // 履歴を localStorage に永続化する（端末キャッシュ。正本はサーバ）。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(WORK_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* 容量超過等は無視（チャットは継続できる） */
    }
  }, [messages]);

  useEffect(() => {
    setHasPending(messages.some((m) => m.role === 'assistant' && m.status === 'pending'));
  }, [messages]);

  /** サーバ保存の会話履歴を取り込んで表示を置き換える（正本）。失敗時はキャッシュのまま。 */
  const restore = useCallback(async () => {
    try {
      const res = await fetch('/api/work/chat/history', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: unknown };
      if (streamingRef.current) return;
      setMessages(normalizeMessages(data.messages));
    } catch {
      /* 取得失敗時は localStorage キャッシュのまま継続 */
    }
  }, []);

  // pending が残っている間、サーバ履歴をポーリングして done/error に解決する。
  useEffect(() => {
    if (!hasPending) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || streamingRef.current) return;
      await restore();
    };
    const timer = setInterval(() => void tick(), 4000);
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
      const res = await fetch('/api/work/chat/upload', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { media?: WorkMedia[]; error?: string };
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
   * 送信。テキストか添付メディアのどちらかがあれば送れる。AI 生成はサーバ側でバックグラウンド実行
   * され、結果はサーバに永続化される。SSE が繋がっている間は逐次表示するが、完了の正本はサーバ。
   * 接続が切れても失敗確定せず pending のままにして history ポーリング／タブ復帰で結果を取りに行く。
   */
  // overrideText を渡すと入力欄の値ではなくその文言で送信する（単語帳からの深掘り種まきに使う）。
  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    const media = overrideText != null ? [] : pending;
    if ((!text && media.length === 0) || sending) return;

    const userMsg: WorkMessage = { role: 'user', content: text || '（画像/動画を添付しました）' };
    if (media.length > 0) userMsg.media = media;
    const pendingAssistant: WorkMessage = { role: 'assistant', content: '', status: 'pending' };
    const next: WorkMessage[] = [...messages, userMsg];
    setMessages([...next, pendingAssistant]);
    setInput('');
    setPending([]);
    setError(null);
    setSending(true);
    setStreaming('');
    streamingRef.current = true;

    let acc = '';
    let resolved = false;
    // SSE ウォッチドッグ（茶事と同じ）。トンネル越しで done/close が来ない場合に abort してポーリングへ。
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
      idleTimer = setTimeout(() => ac.abort(), ms);
    };
    try {
      const res = await fetch('/api/work/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
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
      let finalMedia: WorkMedia[] = [];
      let finalStatus: WorkStatus = 'done';
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
            status?: WorkStatus;
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
        const assistantMsg: WorkMessage = { role: 'assistant', content: answer, status: finalStatus };
        if (finalMedia.length > 0) assistantMsg.media = finalMedia;
        setMessages((prev) => replaceLastPending(prev, assistantMsg));
      } else {
        // done を受け取れずストリームが切れた → 失敗扱いにせず pending を残し、サーバ結果を待つ。
        streamingRef.current = false;
        void restore();
      }
    } catch {
      // 通信が確立できなかった／途中で切れた／ウォッチドッグが abort した → エラー確定せず
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
    void fetch('/api/work/chat/history', { method: 'DELETE' }).catch(() => {
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

type WorkChat = ReturnType<typeof useWorkChat>;

// ─── 「考えています…」インジケータ ─────────────────────────────────────
function WorkThinking() {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted">
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:0.15s]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:0.3s]" />
      </span>
      <span className="text-xs">アドバイザーが考えています…</span>
    </span>
  );
}

// ─── 吹き出し ────────────────────────────────────────────────────────
function WorkBubble({
  role,
  media,
  children,
}: {
  role: WorkRole;
  media?: WorkMedia[];
  children: ReactNode;
}) {
  const isUser = role === 'user';
  // メディア（添付画像/動画・返信側の YouTube 埋め込み/図解/画像）があるバブルは広めにする。
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
        {/* 添付メディア（相談者の画像/動画）と返信側メディア（YouTube/生成図解/信頼ソース画像）。 */}
        {hasMedia && (
          <div className="mb-1.5 flex flex-col gap-2">
            {media!.map((m) => (
              <WorkMediaItem key={m.id} media={m} />
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ─── 壁打ちチャットの 1 メディア（画像/動画/YouTube 埋め込み）──────────────────
// XSS/安全: iframe は youtube-nocookie ドメイン固定。画像 src は検証済み自前配信 URL か添付 URL のみ。
function WorkMediaItem({ media: m }: { media: WorkMedia }) {
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
  // 動画（相談者添付）。内容解析はしないが、表示・再生はできる。
  return (
    <video
      src={m.url}
      controls
      preload="metadata"
      className="max-h-60 max-w-full rounded-md border border-black/10"
    />
  );
}

// ─── メッセージ一覧 ──────────────────────────────────────────────────
function WorkMessageList({
  chat,
  scrollRef,
}: {
  chat: WorkChat;
  scrollRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <WorkBubble role="assistant">
        <ChatMarkdown body={WORK_WELCOME} />
      </WorkBubble>
      {chat.messages.map((m, i) => {
        const isLast = i === chat.messages.length - 1;
        if (m.role === 'assistant' && m.status === 'pending' && isLast && chat.streaming !== null) {
          return null;
        }
        return (
          <WorkBubble key={i} role={m.role} media={m.media}>
            {m.role === 'assistant' ? (
              m.status === 'pending' ? (
                <WorkThinking />
              ) : (
                <ChatMarkdown body={m.content} />
              )
            ) : (
              <UserChatBody text={m.content} />
            )}
          </WorkBubble>
        );
      })}
      {chat.streaming !== null && (
        <WorkBubble role="assistant">
          {chat.streaming.length > 0 ? <ChatMarkdown body={chat.streaming} /> : <WorkThinking />}
        </WorkBubble>
      )}
    </div>
  );
}

// ─── 入力バー（テキスト＋メディア添付）────────────────────────────────────
function WorkComposer({ chat }: { chat: WorkChat }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canSend = (chat.input.trim().length > 0 || chat.pending.length > 0) && !chat.sending;
  return (
    <div className="border-t border-border px-3 py-3">
      {/* 添付プレビュー（送信前のステージング）。サムネはサーバ配信 URL を使う。 */}
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
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void chat.send();
            }
          }}
          rows={1}
          placeholder="ECL・実装・与信・PMO の論点を入力…"
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
      <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-text-faint">{WORK_CHAT_NOTE}</p>
    </div>
  );
}

// ─── 壁打ちタブ ──────────────────────────────────────────────────────
// ─── フローティング壁打ちチャット（仕事画面の右下に常設）──────────────────
// 2026-07-06 Keita「壁打ちチャットに名前を付けて、仕事画面の右下にいつも置いてある状態に」。
// 従来はタブの1つだったが、どのタブにいても相談できるよう画面右下のドック型ウィジェットにした。
// チャット本体（useWorkChat）は Work コンポーネントで1インスタンスだけ生成して渡す（状態の二重化回避）。
function FloatingWorkChat({
  chat,
  open,
  onToggle,
}: {
  chat: WorkChat;
  open: boolean;
  onToggle: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 全画面表示フラグ。折りたたみ時は常に通常サイズへ戻す（[fullscreen]は open 中のみ意味を持つ）。
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streaming, open, fullscreen]);

  const pending = chat.messages.some((m) => m.role === 'assistant' && m.status === 'pending');

  // 最小化時は全画面フラグもリセットして通常の折りたたみに戻す。
  const handleClose = () => {
    setFullscreen(false);
    onToggle();
  };

  // 折りたたみ時: 右下に開くためのランチャー（ピル）。応答生成中はドットを出す。
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label={`${WORK_ADVISOR_NAME}に相談する`}
        className="pointer-events-auto absolute bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-bg shadow-lg transition-transform hover:scale-105"
      >
        <ChatIcon width={18} height={18} />
        <span>{WORK_ADVISOR_NAME}に相談</span>
        {pending && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-bg" aria-label="応答生成中" />
        )}
      </button>
    );
  }

  return (
    <div
      className={
        fullscreen
          ? 'pointer-events-auto absolute inset-2 z-30 flex flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl md:inset-4'
          : 'pointer-events-auto absolute bottom-4 right-4 z-30 flex h-[min(34rem,calc(100%-2rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl'
      }
    >
      {/* ヘッダ（名前＋全画面／最小化／履歴消去） */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"
          >
            <ChatIcon width={18} height={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-text">{WORK_ADVISOR_NAME}</p>
            <p className="truncate text-[10px] text-text-muted">ECL/PMO 壁打ちアドバイザー</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {chat.messages.length > 0 && (
            <button
              type="button"
              onClick={chat.clearHistory}
              className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text"
            >
              履歴を消去
            </button>
          )}
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            aria-label={fullscreen ? '全画面を解除' : '全画面表示'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          >
            {fullscreen ? (
              <ShrinkIcon width={16} height={16} />
            ) : (
              <ExpandIcon width={16} height={16} />
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="チャットを最小化"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={
            fullscreen
              ? 'mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden'
              : 'flex min-h-0 flex-1 flex-col overflow-hidden'
          }
        >
          <WorkMessageList chat={chat} scrollRef={(el) => (scrollRef.current = el)} />
          <WorkComposer chat={chat} />
        </div>
      </div>
    </div>
  );
}

// ─── ナレッジ ────────────────────────────────────────────────────────
interface KnowledgeEntry {
  id: string;
  title: string;
  category: WorkCategory;
  tags: string[];
  body: string;
  source: 'manual' | 'ai';
  createdAt: string;
  updatedAt: string;
}

/** エディタのフォーム状態。新規・編集・AI ドラフトの共通入力。 */
interface KnowledgeForm {
  title: string;
  category: WorkCategory;
  tagsText: string; // カンマ/空白区切りの生入力。保存時に配列へ。
  body: string;
}

const EMPTY_FORM: KnowledgeForm = { title: '', category: 'ECL/会計基準', tagsText: '', body: '' };

/** "a, b c" 形式のタグ入力を配列へ（トリム・空除外・重複除外）。 */
function parseTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,、\s]+/)) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** ISO 文字列を YYYY/MM/DD HH:mm（ローカル）に整形。失敗時は空文字。 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ナレッジ一覧の取得・CRUD・AI 体系化をまとめるフック。 */
function useWorkKnowledge() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/work/knowledge', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries?: KnowledgeEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setError(null);
    } catch {
      setError('ナレッジの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 作成（editingId なし）。成功で true。 */
  const create = useCallback(
    async (form: KnowledgeForm, source: 'manual' | 'ai'): Promise<boolean> => {
      const res = await fetch('/api/work/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          category: form.category,
          tags: parseTags(form.tagsText),
          body: form.body,
          source,
        }),
      });
      if (!res.ok) return false;
      await reload();
      return true;
    },
    [reload],
  );

  /** 更新。成功で true。 */
  const update = useCallback(
    async (id: string, form: KnowledgeForm): Promise<boolean> => {
      const res = await fetch(`/api/work/knowledge/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          category: form.category,
          tags: parseTags(form.tagsText),
          body: form.body,
        }),
      });
      if (!res.ok) return false;
      await reload();
      return true;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`/api/work/knowledge/${id}`, { method: 'DELETE' }).catch(() => {});
      await reload();
    },
    [reload],
  );

  /** 生インプットを AI 体系化してドラフト（未保存）を返す。失敗時は null。 */
  const structure = useCallback(async (rawInput: string): Promise<KnowledgeForm | null> => {
    const res = await fetch('/api/work/knowledge/structure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: rawInput }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
      draft?: { title?: string; category?: string; tags?: string[]; body?: string };
    };
    const d = data.draft;
    if (!d || typeof d.title !== 'string' || typeof d.body !== 'string') return null;
    const category = (WORK_CATEGORIES as readonly string[]).includes(d.category ?? '')
      ? (d.category as WorkCategory)
      : 'その他';
    return {
      title: d.title,
      category,
      tagsText: Array.isArray(d.tags) ? d.tags.join(', ') : '',
      body: d.body,
    };
  }, []);

  return { entries, loading, error, reload, create, update, remove, structure };
}

// ─── カテゴリバッジ ───────────────────────────────────────────────────
function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
      {category}
    </span>
  );
}

// ─── ナレッジエディタ（新規・編集・AI ドラフト確認の共通フォーム）──────────
function KnowledgeEditor({
  initial,
  editingId,
  source,
  saving,
  onSave,
  onCancel,
}: {
  initial: KnowledgeForm;
  editingId: string | null;
  source: 'manual' | 'ai';
  saving: boolean;
  onSave: (form: KnowledgeForm) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<KnowledgeForm>(initial);
  // initial が変わったら（別エントリの編集・AI ドラフト流し込み）フォームを差し替える。
  useEffect(() => setForm(initial), [initial]);

  const canSave = form.title.trim().length > 0 && form.body.trim().length > 0 && !saving;
  const update = (patch: Partial<KnowledgeForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-text">
          {editingId ? 'ナレッジを編集' : source === 'ai' ? 'AI 体系化ドラフトを確認' : '新しいナレッジ'}
        </h3>
        {source === 'ai' && !editingId && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
            <SparkIcon width={11} height={11} /> AI ドラフト
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted">タイトル</span>
          <input
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="例: SICR（信用リスクの著しい増大）の判定方針"
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">カテゴリ</span>
            <select
              value={form.category}
              onChange={(e) => update({ category: e.target.value as WorkCategory })}
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
            >
              {WORK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">タグ（カンマ／空白区切り）</span>
            <input
              value={form.tagsText}
              onChange={(e) => update({ tagsText: e.target.value })}
              placeholder="IFRS9, PD, ステージ判定"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted">本文（Markdown）</span>
          <textarea
            value={form.body}
            onChange={(e) => update({ body: e.target.value })}
            rows={10}
            placeholder="## 要点&#10;- …&#10;&#10;## 詳細&#10;…"
            className="resize-y rounded-md border border-border bg-bg px-3 py-2 font-mono text-[13px] leading-relaxed text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onSave(form)}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-bg/60 border-t-transparent" />
            ) : (
              <CheckIcon width={14} height={14} />
            )}
            {editingId ? '更新' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AI 体系化パネル（生インプット → ドラフト）──────────────────────────
function StructurePanel({
  busy,
  onStructure,
  onCancel,
}: {
  busy: boolean;
  onStructure: (input: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const canRun = text.trim().length > 0 && !busy;
  return (
    <div className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
          <SparkIcon width={15} height={15} />
        </span>
        <h3 className="text-sm font-bold text-text">インプットを AI で体系化</h3>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-text-muted">
        会議メモ・口頭説明の書き起こし・断片メモなど、現場で得た「生のインプット」を貼り付けてください。
        体系的なナレッジ 1 件のドラフトに整理します（保存前に内容を確認・編集できます）。入力に無い事実は補いません。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="例: 今日のベンダー打合せ。ステージ判定は延滞30日でステージ2に倒す方針。LGDは担保カテゴリ別テーブルを新設…（箇条書き・走り書きでOK）"
        className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => onStructure(text)}
          disabled={!canRun}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-bg/60 border-t-transparent" />
              体系化中…
            </>
          ) : (
            <>
              <SparkIcon width={14} height={14} /> 体系化する
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── ナレッジ 1 件のカード ───────────────────────────────────────────
function KnowledgeCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: KnowledgeEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <CategoryBadge category={entry.category} />
            {entry.source === 'ai' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] text-text-muted">
                <SparkIcon width={9} height={9} /> AI
              </span>
            )}
          </div>
          <h3 className="break-words text-sm font-bold text-text">{entry.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="編集"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <EditIcon width={14} height={14} />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDel((v) => !v)}
            aria-label="削除"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-blocked"
          >
            <TrashIcon width={14} height={14} />
          </button>
        </div>
      </div>

      {entry.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-0.5 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted"
            >
              <TagIcon width={9} height={9} /> {t}
            </span>
          ))}
        </div>
      )}

      {confirmDel && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-blocked/30 bg-blocked/5 px-3 py-2">
          <span className="text-[11px] text-text">このナレッジを削除しますか？</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              className="rounded px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-2"
            >
              やめる
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-blocked px-2 py-0.5 text-[11px] font-medium text-white hover:opacity-90"
            >
              削除
            </button>
          </div>
        </div>
      )}

      <div className={`mc-markdown mt-2 text-sm ${open ? '' : 'line-clamp-3'}`}>
        <ChatMarkdown body={entry.body} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded px-1.5 py-0.5 text-[11px] text-accent hover:underline"
        >
          {open ? '折りたたむ' : '全文を表示'}
        </button>
        <span className="text-[10px] text-text-faint">更新 {formatDate(entry.updatedAt)}</span>
      </div>
    </div>
  );
}

// ─── ナレッジタブ ────────────────────────────────────────────────────
type EditorState =
  | { mode: 'closed' }
  | { mode: 'create'; initial: KnowledgeForm; source: 'manual' | 'ai' }
  | { mode: 'edit'; id: string; initial: KnowledgeForm }
  | { mode: 'structure' };

function WorkKnowledgeTab() {
  const kb = useWorkKnowledge();
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [saving, setSaving] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<WorkCategory | 'all'>('all');

  // 検索（タイトル・本文・タグの部分一致）＋カテゴリ絞り込み。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return kb.entries.filter((e) => {
      if (catFilter !== 'all' && e.category !== catFilter) return false;
      if (!q) return true;
      const hay = `${e.title}\n${e.body}\n${e.tags.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [kb.entries, query, catFilter]);

  // 実在するカテゴリだけフィルタチップに出す（件数付き）。
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of kb.entries) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [kb.entries]);

  const closeEditor = () => {
    setEditor({ mode: 'closed' });
    setStructureError(null);
  };

  const handleSave = async (form: KnowledgeForm) => {
    setSaving(true);
    try {
      let ok = false;
      if (editor.mode === 'edit') ok = await kb.update(editor.id, form);
      else if (editor.mode === 'create') ok = await kb.create(form, editor.source);
      if (ok) closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const handleStructure = async (input: string) => {
    setStructuring(true);
    setStructureError(null);
    try {
      const draft = await kb.structure(input);
      if (draft) setEditor({ mode: 'create', initial: draft, source: 'ai' });
      else setStructureError('体系化に失敗しました。少し時間をおいてもう一度お試しください。');
    } finally {
      setStructuring(false);
    }
  };

  const openEdit = (e: KnowledgeEntry) =>
    setEditor({
      mode: 'edit',
      id: e.id,
      initial: { title: e.title, category: e.category, tagsText: e.tags.join(', '), body: e.body },
    });

  const editorOpen = editor.mode !== 'closed';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* アクションバー */}
      {!editorOpen && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-text">ナレッジ</h2>
              <p className="mt-0.5 text-[11px] text-text-muted">
                学んだこと・現場のインプットを体系的に残します（{kb.entries.length} 件）
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setEditor({ mode: 'structure' })}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
              >
                <SparkIcon width={14} height={14} /> AI で体系化
              </button>
              <button
                type="button"
                onClick={() => setEditor({ mode: 'create', initial: EMPTY_FORM, source: 'manual' })}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90"
              >
                <PlusIcon width={14} height={14} /> 新規
              </button>
            </div>
          </div>

          {/* 検索 */}
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint">
              <SearchIcon width={15} height={15} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="タイトル・本文・タグを検索…"
              className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            />
          </div>

          {/* カテゴリフィルタ */}
          {kb.entries.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <FilterChip active={catFilter === 'all'} onClick={() => setCatFilter('all')} label={`すべて (${kb.entries.length})`} />
              {WORK_CATEGORIES.filter((c) => catCounts.has(c)).map((c) => (
                <FilterChip
                  key={c}
                  active={catFilter === c}
                  onClick={() => setCatFilter(c)}
                  label={`${c} (${catCounts.get(c)})`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* エディタ／体系化パネル */}
      {editor.mode === 'structure' && (
        <div className="flex flex-col gap-2">
          {structureError && (
            <p className="rounded-md border border-blocked/30 bg-blocked/5 px-3 py-2 text-[11px] text-blocked">
              {structureError}
            </p>
          )}
          <StructurePanel busy={structuring} onStructure={handleStructure} onCancel={closeEditor} />
        </div>
      )}
      {(editor.mode === 'create' || editor.mode === 'edit') && (
        <KnowledgeEditor
          initial={editor.initial}
          editingId={editor.mode === 'edit' ? editor.id : null}
          source={editor.mode === 'create' ? editor.source : 'manual'}
          saving={saving}
          onSave={handleSave}
          onCancel={closeEditor}
        />
      )}

      {/* 一覧 */}
      {!editorOpen && (
        <>
          {kb.loading ? (
            <p className="py-8 text-center text-sm text-text-muted">読み込み中…</p>
          ) : kb.error ? (
            <p className="py-8 text-center text-sm text-blocked">{kb.error}</p>
          ) : kb.entries.length === 0 ? (
            <EmptyKnowledge
              onCreate={() => setEditor({ mode: 'create', initial: EMPTY_FORM, source: 'manual' })}
              onStructure={() => setEditor({ mode: 'structure' })}
            />
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">該当するナレッジがありません。</p>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map((e) => (
                <KnowledgeCard
                  key={e.id}
                  entry={e}
                  onEdit={() => openEdit(e)}
                  onDelete={() => void kb.remove(e.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? 'border-accent bg-accent/15 font-medium text-accent'
          : 'border-border text-text-muted hover:bg-surface-2 hover:text-text'
      }`}
    >
      {label}
    </button>
  );
}

// ─── ナレッジ空状態 ───────────────────────────────────────────────────
function EmptyKnowledge({ onCreate, onStructure }: { onCreate: () => void; onStructure: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface/50 px-4 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <NotebookIcon width={24} height={24} />
      </span>
      <div>
        <p className="text-sm font-bold text-text">ナレッジはまだありません</p>
        <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
          学んだこと・現場で得たインプットを記録しましょう。生のメモは「AI で体系化」でドラフトに整理できます。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onStructure}
          className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
        >
          <SparkIcon width={14} height={14} /> AI で体系化
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90"
        >
          <PlusIcon width={14} height={14} /> 手入力で追加
        </button>
      </div>
    </div>
  );
}

// ─── 単語帳 ──────────────────────────────────────────────────────────
// 銀行・会計（ECL）・データ/システム・PMO・本案件の用語を、意味と「使う場面」つきで一覧する。
// 静的データ（workGlossary）を検索・カテゴリ絞り込みして表示する読み取り専用タブ。
// 単語帳「もっと詳しく見る」1 語ぶんの取得状態。
interface GlossaryDetailState {
  loading: boolean;
  text: string;
  error: boolean;
}

// ─── 単語帳 1 語のカード（意味・使う場面＋AI 深掘り／壁打ち導線）──────────
// 「もっと詳しく見る」でその用語の深掘り解説（/api/work/glossary/detail・SSE）をカード内に展開し、
// 「この単語を深掘りする」で壁打ちタブへ種まきメッセージを渡してハンドオフする。
function GlossaryCard({ term, onSeedChat }: { term: GlossaryTerm; onSeedChat: (seed: string) => void }) {
  const [open, setOpen] = useState(false);
  // 取得結果は term をキーにカード内に保持し、再タップでは再取得しない（キャッシュ）。
  const [detail, setDetail] = useState<GlossaryDetailState | null>(null);

  // その用語の深掘り解説を SSE で取得する。共有サーバは数分おきに再起動されることがあり（デプロイ・
  // 番人 restart 等）、モバイルはトンネル経由なので、生成の途中（~15 秒）で接続が切れて「done を受け取れ
  // ないまま止まる」ことがある。そこで done を受け取れずに終わった場合は自動でもう一度取り直す
  // （最大 MAX_ATTEMPTS 回）。生成自体は速い（Haiku・数十秒未満）ので、やり直しは軽い。
  const fetchDetail = useCallback(async () => {
    const MAX_ATTEMPTS = 3;
    setDetail({ loading: true, text: '', error: false });
    let acc = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      acc = '';
      let gotDone = false;
      let finalAnswer: string | null = null;
      let status = 'done';
      try {
        const res = await fetch('/api/work/glossary/detail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ term: term.term, meaning: term.meaning, category: term.category }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let evt: { type?: string; text?: string; answer?: string; status?: string } = {};
            try {
              evt = JSON.parse(line.slice(6)) as typeof evt;
            } catch {
              continue;
            }
            if (evt.type === 'chunk' && typeof evt.text === 'string') {
              acc += evt.text;
              setDetail({ loading: true, text: acc, error: false });
            } else if (evt.type === 'done') {
              gotDone = true;
              finalAnswer = typeof evt.answer === 'string' && evt.answer ? evt.answer : acc;
              if (evt.status === 'error') status = 'error';
            }
          }
        }
        if (gotDone) {
          const answer = (finalAnswer ?? acc).trim();
          if (!answer) throw new Error('empty');
          setDetail({ loading: false, text: answer, error: status === 'error' });
          return; // 正常完了
        }
        // done を受け取れずにストリームが終わった＝途中で切れた。下でリトライ判定へ。
      } catch {
        // ネットワーク/HTTP エラー。下でリトライ判定へ。
      }
      if (attempt < MAX_ATTEMPTS) {
        // 途中まで出た本文は見せたまま、少し待って取り直す（サーバ再起動の復帰待ち）。
        setDetail({ loading: true, text: acc, error: false });
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      // 最終試行も未完了。途中本文があればそれを見せつつエラー表示（再試行ボタンを出す）。
      setDetail({ loading: false, text: acc.trim(), error: true });
    }
  }, [term.term, term.meaning, term.category]);

  const onMoreDetail = () => {
    setOpen(true);
    // 未取得（または前回エラーで本文が無い）ときだけ取りに行く。成功結果はキャッシュ。
    if (!detail || (detail.error && !detail.text)) void fetchDetail();
  };

  const onDeepDive = () => {
    onSeedChat(
      `「${term.term}」について深掘りしたいです。意味・実務での使い方・関連する論点を教えてください。`,
    );
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-bold text-text">{term.term}</h3>
        {term.reading && <span className="text-[11px] text-text-faint">{term.reading}</span>}
        <span className="ml-auto">
          <CategoryBadge category={term.category} />
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text">{term.meaning}</p>
      <div className="mt-2 flex gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2">
        <span className="shrink-0 text-[11px] font-bold text-accent">使う場面</span>
        <span className="text-[12px] leading-relaxed text-text-muted">{term.usage}</span>
      </div>

      {/* AI アクション（深掘り解説をカード内展開 / 壁打ちタブへハンドオフ）。 */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onMoreDetail}
          className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20"
        >
          <SparkIcon width={13} height={13} /> もっと詳しく見る
        </button>
        <button
          type="button"
          onClick={onDeepDive}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <ChatIcon width={13} height={13} /> この単語を深掘りする
        </button>
      </div>

      {/* 深掘り解説（インライン展開）。 */}
      {open && (
        <div className="mt-2.5 rounded-md border border-border bg-bg px-3 py-2.5">
          {detail?.loading && !detail.text ? (
            <WorkThinking />
          ) : detail?.error && !detail.text ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[12px] text-blocked">
                解説の取得に失敗しました。もう一度お試しください。
              </p>
              <button
                type="button"
                onClick={() => void fetchDetail()}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text"
              >
                再試行
              </button>
            </div>
          ) : (
            <>
              <div className="mc-markdown">
                <ChatMarkdown body={detail?.text ?? ''} />
              </div>
              {detail?.loading && (
                <div className="mt-1.5">
                  <WorkThinking />
                </div>
              )}
              {detail?.error && detail.text && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p className="text-[11px] text-blocked">
                    ※ 途中で中断された可能性があります（自動での再取得も失敗しました）。
                  </p>
                  <button
                    type="button"
                    onClick={() => void fetchDetail()}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text"
                  >
                    再試行
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WorkGlossaryTab({ onSeedChat }: { onSeedChat: (seed: string) => void }) {
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<GlossaryCategory | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ord = (c: GlossaryCategory) => GLOSSARY_CATEGORIES.indexOf(c);
    return WORK_GLOSSARY.filter((t) => {
      if (catFilter !== 'all' && t.category !== catFilter) return false;
      if (!q) return true;
      return `${t.term} ${t.reading ?? ''} ${t.meaning} ${t.usage}`.toLowerCase().includes(q);
      // 「すべて」表示でもカテゴリ順にまとまるよう安定ソートする（同カテゴリ内は定義順）。
    }).sort((a, b) => ord(a.category) - ord(b.category));
  }, [query, catFilter]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of WORK_GLOSSARY) m.set(t.category, (m.get(t.category) ?? 0) + 1);
    return m;
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-text">単語帳</h2>
        <p className="mt-0.5 text-[11px] text-text-muted">
          銀行・会計（ECL）・データ／システム・PMO・本案件の用語を、意味と「使う場面」つきで一覧（
          {WORK_GLOSSARY.length} 語）
        </p>
      </div>

      {/* 検索 */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint">
          <SearchIcon width={15} height={15} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="単語・意味・使う場面で検索…"
          className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
      </div>

      {/* カテゴリフィルタ */}
      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          active={catFilter === 'all'}
          onClick={() => setCatFilter('all')}
          label={`すべて (${WORK_GLOSSARY.length})`}
        />
        {GLOSSARY_CATEGORIES.filter((c) => catCounts.has(c)).map((c) => (
          <FilterChip
            key={c}
            active={catFilter === c}
            onClick={() => setCatFilter(c)}
            label={`${c} (${catCounts.get(c)})`}
          />
        ))}
      </div>

      {/* 一覧 */}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">該当する用語がありません。</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((t) => (
            <GlossaryCard key={t.term} term={t} onSeedChat={onSeedChat} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── タブ統括 ────────────────────────────────────────────────────────
type WorkTab = 'chat' | 'knowledge' | 'glossary';

function resolveInitialTab(): WorkTab {
  if (typeof window !== 'undefined') {
    const t = new URLSearchParams(window.location.search).get('tab');
    // 概要/動画DL/状況解析タブは削除（2026-07-20 Keita・MC-319）。旧 URL はナレッジへ寄せる。
    if (t === 'chat' || t === 'knowledge' || t === 'glossary') return t;
  }
  return 'knowledge';
}

function WorkTabBar({ tab, onChange }: { tab: WorkTab; onChange: (t: WorkTab) => void }) {
  // 概要（意味が薄い）・動画DL・状況解析は削除（2026-07-20 Keita・MC-319）。単語帳とナレッジは残す。
  const tabs: { id: WorkTab; label: string; icon: ReactNode }[] = [
    { id: 'knowledge', label: 'ナレッジ', icon: <NotebookIcon width={16} height={16} /> },
    { id: 'glossary', label: '単語帳', icon: <TextFileIcon width={16} height={16} /> },
  ];
  return (
    <div className="flex border-b border-border px-4 md:px-6" role="tablist" aria-label="仕事ページのタブ">
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

export default function Work() {
  const [tab, setTab] = useState<WorkTab>(() => resolveInitialTab());

  // 壁打ちチャット本体は1インスタンスだけ生成し、右下のフローティングウィジェットに渡す。
  const chat = useWorkChat();
  // フローティングチャットの開閉。既定は開（「いつも右下に置いてある」）。端末に保持。
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(WORK_CHAT_OPEN_KEY) !== 'false';
  });
  const toggleChat = () => {
    setChatOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(WORK_CHAT_OPEN_KEY, String(next));
      } catch {
        /* localStorage 不可環境では無視 */
      }
      return next;
    });
  };

  // マウント時にサーバ保存の履歴を取り込む（従来 WorkChatTab が担っていた処理）。
  useEffect(() => {
    void chat.restore();
    // restore は安定参照（useCallback）。初回のみ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeTab = (next: WorkTab) => {
    setTab(next);
    if (typeof window !== 'undefined') {
      const url = next === 'knowledge' ? '/work' : `/work?tab=${next}`;
      window.history.replaceState(null, '', url);
    }
  };

  // 単語帳「この単語を深掘りする」→ 右下チャットを開いてそのまま送信する。
  const seedChat = (seed: string) => {
    if (!chatOpen) toggleChat();
    void chat.send(seed);
  };

  return (
    <div className="relative flex h-full flex-col">
      <PageHeader
        title="仕事"
        subtitle="ECL（予想信用損失）システム導入 PMO 案件のための、学習・壁打ちチャットとナレッジ蓄積ツールです。"
        fetchedAt={undefined}
      />
      <WorkTabBar tab={tab} onChange={changeTab} />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {/* 概要/動画DL/状況解析は削除（MC-319）。既定＝ナレッジ。 */}
        {tab === 'glossary' ? <WorkGlossaryTab onSeedChat={seedChat} /> : <WorkKnowledgeTab />}
      </div>
      {/* 右下に常設の壁打ちチャット（どのタブでも相談できる） */}
      <FloatingWorkChat chat={chat} open={chatOpen} onToggle={toggleChat} />
    </div>
  );
}
