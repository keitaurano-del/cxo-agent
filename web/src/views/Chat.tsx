// Chat — Slack 的チャット機能（MC-141）
//
// 左カラム: チャンネル一覧（#チャンネル + DM）
// 右カラム: メッセージ一覧（Slack 風・Markdown レンダリング）＋ 入力欄
// SSE /api/stream の chat イベントでリアルタイム追加。
// 自分は senderId='keita'、senderName='Keita'、senderEmoji=''（絵文字なし）。

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveTick } from '../lib/liveContext';
import { HashIcon, PlusIcon, SendIcon, TrashIcon } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/ui';

// ── 型定義 ─────────────────────────────────────────────────────

interface ChannelMeta {
  id: string;
  name: string;
  description: string;
  type: 'channel' | 'dm';
  members: string[];
  createdAt: string;
}

interface ChatMessage {
  id: string;
  ts: string;
  senderId: string;
  senderName: string;
  senderEmoji: string;
  text: string;
}

interface ChannelSummary extends ChannelMeta {
  unreadCount: number;
  lastMessage: ChatMessage | null;
}

interface ChatMember {
  id: string;
  name: string;
  emoji: string;
  persona?: string;
  role?: string;
}

// ── 定数 ───────────────────────────────────────────────────────

const SELF_ID = 'keita';
const SELF_NAME = 'Keita';
const SELF_EMOJI = '';

// エージェントカラーパレット（senderId 別の背景色）
const AGENT_COLORS: Record<string, string> = {
  'hayashi-rin': 'var(--mc-accent)',
  'masayoshi': 'var(--mc-active)',
  'dev-logic': 'var(--mc-review)',
  'task-manager': 'var(--mc-idle)',
  'designer': '#9c6dcf',
  'content-creator': '#c97040',
  'test-functional': '#2a9d8f',
  'apollo': 'var(--mc-text-muted)',
};

function agentBg(senderId: string): string {
  return AGENT_COLORS[senderId] ?? 'var(--mc-text-faint)';
}

// localStorage で未読管理（最後に見た ts を記録）
const LAST_READ_KEY = 'chat.lastRead';
function loadLastRead(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_READ_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function saveLastRead(channelId: string, ts: string) {
  const map = loadLastRead();
  map[channelId] = ts;
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

// ── API ヘルパー ────────────────────────────────────────────────

async function fetchChannels(): Promise<ChannelSummary[]> {
  const res = await fetch('/api/chat/channels');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { channels: ChannelSummary[] };
  return data.channels;
}

async function fetchMessages(channelId: string, limit = 50): Promise<ChatMessage[]> {
  const res = await fetch(`/api/chat/channels/${channelId}/messages?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { messages: ChatMessage[] };
  // API は新しい順で返すので reverse して古い→新しい順に
  return [...data.messages].reverse();
}

async function postMessage(channelId: string, text: string): Promise<ChatMessage> {
  const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderId: SELF_ID, senderName: SELF_NAME, senderEmoji: SELF_EMOJI, text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { message: ChatMessage };
  return data.message;
}

async function deleteMessage(channelId: string, msgId: string): Promise<void> {
  const res = await fetch(`/api/chat/channels/${channelId}/messages/${msgId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function createChannel(name: string, description: string): Promise<ChannelMeta> {
  const res = await fetch('/api/chat/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { channel: ChannelMeta };
  return data.channel;
}

async function fetchMembers(): Promise<ChatMember[]> {
  const res = await fetch('/api/chat/members');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { members: ChatMember[] };
  return data.members;
}

// ── 軽量 Markdown レンダラー（react-markdown 未使用・安全な変換）──

function renderMarkdown(text: string): string {
  return text
    // コードブロック
    .replace(/```[\s\S]*?```/g, (m) => {
      const inner = m.slice(3, -3).replace(/^[a-z]+\n/, '');
      return `<pre style="background:var(--mc-surface-2);padding:0.5em;border-radius:4px;overflow-x:auto;font-size:12px;margin:4px 0"><code>${escHtml(inner)}</code></pre>`;
    })
    // インラインコード
    .replace(/`([^`]+)`/g, (_, c) => `<code style="background:var(--mc-surface-2);padding:1px 4px;border-radius:3px;font-size:12px">${escHtml(c)}</code>`)
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 改行
    .replace(/\n/g, '<br>');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── サブコンポーネント ───────────────────────────────────────────

/** 送信者アバター（絵文字 or イニシャル）。 */
function Avatar({ senderId, senderName, senderEmoji, size = 32 }: {
  senderId: string;
  senderName: string;
  senderEmoji?: string;
  size?: number;
}) {
  const isAgent = senderId !== SELF_ID;
  const bg = isAgent ? agentBg(senderId) : 'var(--mc-accent)';
  const label = senderEmoji || senderName.charAt(0).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: senderEmoji ? size * 0.55 : size * 0.45,
        color: '#fff',
        flexShrink: 0,
        userSelect: 'none',
        fontWeight: 700,
      }}
      aria-label={senderName}
    >
      {label}
    </div>
  );
}

/** メッセージ1件。連続送信者はアバター・名前省略。 */
function MessageItem({
  msg,
  prevMsg,
  onDelete,
}: {
  msg: ChatMessage;
  prevMsg: ChatMessage | null;
  onDelete?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isSelf = msg.senderId === SELF_ID;
  const isAgent = !isSelf;
  const isGrouped =
    prevMsg !== null &&
    prevMsg.senderId === msg.senderId &&
    new Date(msg.ts).getTime() - new Date(prevMsg.ts).getTime() < 5 * 60 * 1000; // 5分以内

  const time = new Date(msg.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: isGrouped ? '2px 12px 2px 52px' : '8px 12px 2px 12px',
        background: hovered ? 'var(--mc-surface-2)' : 'transparent',
        borderRadius: 4,
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isGrouped && (
        <Avatar senderId={msg.senderId} senderName={msg.senderName} senderEmoji={msg.senderEmoji} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!isGrouped && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: isAgent ? agentBg(msg.senderId) : 'var(--mc-text)',
              }}
            >
              {msg.senderName}
            </span>
            <span style={{ fontSize: 11, color: 'var(--mc-text-faint)' }}>{time}</span>
          </div>
        )}
        <div
          style={{
            fontSize: 14,
            color: 'var(--mc-text)',
            lineHeight: 1.5,
            background: isAgent ? 'var(--mc-surface-2)' : 'transparent',
            padding: isAgent ? '4px 8px' : 0,
            borderRadius: isAgent ? 6 : 0,
            borderLeft: isAgent ? `3px solid ${agentBg(msg.senderId)}` : 'none',
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
        />
      </div>
      {hovered && isSelf && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'var(--mc-surface-3)',
            border: '1px solid var(--mc-border)',
            borderRadius: 4,
            padding: '2px 6px',
            cursor: 'pointer',
            color: 'var(--mc-text-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="削除"
        >
          <TrashIcon width={13} height={13} />
        </button>
      )}
    </div>
  );
}

/** チャンネルリストアイテム。 */
function ChannelItem({
  ch,
  active,
  unread,
  onClick,
}: {
  ch: ChannelSummary;
  active: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 4,
        width: '100%',
        textAlign: 'left',
        background: active ? 'var(--mc-surface-3)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--mc-text)' : 'var(--mc-text-muted)',
        fontWeight: active || unread > 0 ? 600 : 400,
      }}
    >
      <HashIcon width={14} height={14} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
        {ch.name}
      </span>
      {unread > 0 && (
        <span
          style={{
            background: 'var(--mc-blocked)',
            color: '#fff',
            borderRadius: 10,
            fontSize: 10,
            padding: '1px 5px',
            fontWeight: 700,
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

/** 新規チャンネル作成モーダル。 */
function NewChannelModal({ onClose, onCreate }: { onClose: () => void; onCreate: (ch: ChannelMeta) => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const ch = await createChannel(name.trim(), desc.trim());
      onCreate(ch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--mc-surface)',
          border: '1px solid var(--mc-border)',
          borderRadius: 8,
          padding: 20,
          width: 340,
          maxWidth: '90vw',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>新規チャンネル作成</div>
        <input
          type="text"
          placeholder="チャンネル名 (英数・ハイフン)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 10px',
            border: '1px solid var(--mc-border)',
            borderRadius: 4,
            fontSize: 14,
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text)',
            marginBottom: 8,
          }}
          autoFocus
        />
        <input
          type="text"
          placeholder="説明（任意）"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 10px',
            border: '1px solid var(--mc-border)',
            borderRadius: 4,
            fontSize: 14,
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text)',
            marginBottom: 12,
          }}
        />
        {error && <div style={{ color: 'var(--mc-stalled)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              border: '1px solid var(--mc-border)',
              borderRadius: 4,
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--mc-text-muted)',
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={loading || !name.trim()}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: 4,
              background: 'var(--mc-accent)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              opacity: loading || !name.trim() ? 0.6 : 1,
            }}
          >
            {loading ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── メインビュー ────────────────────────────────────────────────

export default function Chat() {
  const liveTick = useLiveTick();

  // チャンネル一覧
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channelLoading, setChannelLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewChannel, setShowNewChannel] = useState(false);

  // メッセージ
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  // 未読管理
  const [lastRead, setLastRead] = useState<Record<string, string>>(loadLastRead);

  // メンバー
  const [_members, setMembers] = useState<ChatMember[]>([]);

  // モバイル: パネル切替
  const [mobilePanel, setMobilePanel] = useState<'list' | 'messages'>('list');

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // チャンネル一覧ロード
  const loadChannels = useCallback(async () => {
    try {
      const chs = await fetchChannels();
      setChannels(chs);
      if (!selectedId && chs.length > 0) setSelectedId(chs[0].id);
    } catch {
      // 無視（ポーリングで回復）
    } finally {
      setChannelLoading(false);
    }
  }, [selectedId]);

  // メッセージロード
  const loadMessages = useCallback(async (channelId: string) => {
    setMsgLoading(true);
    try {
      const msgs = await fetchMessages(channelId);
      setMessages(msgs);
    } catch {
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  }, []);

  // 初回ロード
  useEffect(() => {
    void loadChannels();
    fetchMembers().then(setMembers).catch(() => {});
  }, [loadChannels]);

  // チャンネル変更時
  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
    // 既読マーク（チャンネル選択時）
    const now = new Date().toISOString();
    saveLastRead(selectedId, now);
    setLastRead((prev) => ({ ...prev, [selectedId]: now }));
  }, [selectedId, loadMessages]);

  // SSE chat イベント受信でリアルタイム追加
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: number | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/stream');
      es.addEventListener('chat', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data as string) as {
            channelId: string;
            message?: ChatMessage;
            deleted?: string;
          };
          if (data.channelId === selectedId) {
            if (data.message) {
              setMessages((prev) => [...prev, data.message!]);
            } else if (data.deleted) {
              setMessages((prev) => prev.filter((m) => m.id !== data.deleted));
            }
          }
          // チャンネルリストの lastMessage を更新
          if (data.message) {
            setChannels((prev) =>
              prev.map((ch) =>
                ch.id === data.channelId ? { ...ch, lastMessage: data.message! } : ch,
              ),
            );
          }
        } catch {
          // ignore
        }
      });
      es.onerror = () => {
        es?.close();
        if (!closed) retryTimer = window.setTimeout(connect, 5000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      es?.close();
    };
  }, [selectedId]);

  // 新メッセージ時に最下部へスクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ポーリング（SSE 補完）
  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick]);

  const selectedChannel = channels.find((ch) => ch.id === selectedId) ?? null;

  // 送信
  const handleSend = async () => {
    if (!selectedId || !inputText.trim() || sending) return;
    const text = inputText.trim();
    setInputText('');
    setSending(true);
    try {
      const msg = await postMessage(selectedId, text);
      setMessages((prev) => [...prev, msg]);
      // 既読を最新に更新
      saveLastRead(selectedId, msg.ts);
      setLastRead((prev) => ({ ...prev, [selectedId]: msg.ts }));
    } catch {
      setInputText(text); // 失敗時に復元
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // 削除
  const handleDelete = async (channelId: string, msgId: string) => {
    try {
      await deleteMessage(channelId, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch {
      // ignore
    }
  };

  // チャンネル未読数
  const unreadCount = (ch: ChannelSummary): number => {
    if (!ch.lastMessage) return 0;
    const last = lastRead[ch.id];
    if (!last) return 1;
    return ch.lastMessage.ts > last ? 1 : 0;
  };

  // ── レンダリング ──────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        title="チャット"
        subtitle={selectedChannel ? `#${selectedChannel.name}` : undefined}
      />

      {/* モバイル タブ切替 */}
      <div
        style={{
          display: 'none',
          borderBottom: '1px solid var(--mc-border)',
          background: 'var(--mc-surface)',
        }}
        className="md:hidden-override"
      >
        {(['list', 'messages'] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            onClick={() => setMobilePanel(panel)}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderBottom: mobilePanel === panel ? '2px solid var(--mc-accent)' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              color: mobilePanel === panel ? 'var(--mc-accent)' : 'var(--mc-text-muted)',
              fontWeight: mobilePanel === panel ? 600 : 400,
            }}
          >
            {panel === 'list' ? 'チャンネル' : 'メッセージ'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左カラム: チャンネルリスト */}
        <div
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: '1px solid var(--mc-border)',
            background: 'var(--mc-surface)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {channelLoading ? (
            <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
              <Spinner />
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                {/* チャンネルセクション */}
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--mc-text-faint)',
                    textTransform: 'uppercase',
                    padding: '8px 8px 4px',
                    letterSpacing: '0.05em',
                  }}
                >
                  チャンネル
                </div>
                {channels
                  .filter((ch) => ch.type === 'channel')
                  .map((ch) => (
                    <ChannelItem
                      key={ch.id}
                      ch={ch}
                      active={ch.id === selectedId}
                      unread={ch.id !== selectedId ? unreadCount(ch) : 0}
                      onClick={() => {
                        setSelectedId(ch.id);
                        setMobilePanel('messages');
                      }}
                    />
                  ))}

                {/* DM セクション */}
                {channels.filter((ch) => ch.type === 'dm').length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--mc-text-faint)',
                        textTransform: 'uppercase',
                        padding: '12px 8px 4px',
                        letterSpacing: '0.05em',
                      }}
                    >
                      ダイレクトメッセージ
                    </div>
                    {channels
                      .filter((ch) => ch.type === 'dm')
                      .map((ch) => (
                        <ChannelItem
                          key={ch.id}
                          ch={ch}
                          active={ch.id === selectedId}
                          unread={ch.id !== selectedId ? unreadCount(ch) : 0}
                          onClick={() => {
                            setSelectedId(ch.id);
                            setMobilePanel('messages');
                          }}
                        />
                      ))}
                  </>
                )}
              </div>

              {/* 新規チャンネルボタン */}
              <div style={{ padding: 8, borderTop: '1px solid var(--mc-border)' }}>
                <button
                  type="button"
                  onClick={() => setShowNewChannel(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 8px',
                    width: '100%',
                    border: '1px dashed var(--mc-border)',
                    borderRadius: 4,
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--mc-text-muted)',
                    fontSize: 13,
                  }}
                >
                  <PlusIcon width={14} height={14} />
                  新規チャンネル
                </button>
              </div>
            </>
          )}
        </div>

        {/* 右カラム: メッセージエリア */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedChannel ? (
            <>
              {/* チャンネルヘッダー */}
              <div
                style={{
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--mc-border)',
                  background: 'var(--mc-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <HashIcon width={16} height={16} />
                <span style={{ fontWeight: 700, fontSize: 15 }}>{selectedChannel.name}</span>
                {selectedChannel.description && (
                  <span style={{ color: 'var(--mc-text-muted)', fontSize: 13 }}>
                    — {selectedChannel.description}
                  </span>
                )}
              </div>

              {/* メッセージ一覧 */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '8px 0',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {msgLoading ? (
                  <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
                    <Spinner />
                  </div>
                ) : messages.length === 0 ? (
                  <div
                    style={{
                      padding: 32,
                      textAlign: 'center',
                      color: 'var(--mc-text-faint)',
                      fontSize: 14,
                    }}
                  >
                    メッセージはまだありません。最初のメッセージを送ってみましょう。
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <MessageItem
                      key={msg.id}
                      msg={msg}
                      prevMsg={i > 0 ? messages[i - 1] : null}
                      onDelete={
                        msg.senderId === SELF_ID
                          ? () => { void handleDelete(selectedChannel.id, msg.id); }
                          : undefined
                      }
                    />
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {/* 入力欄 */}
              <div
                style={{
                  padding: '8px 12px',
                  borderTop: '1px solid var(--mc-border)',
                  background: 'var(--mc-surface)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-end',
                    border: '1px solid var(--mc-border)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    background: 'var(--mc-surface-2)',
                  }}
                >
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`#${selectedChannel.name} にメッセージを送る`}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      resize: 'none',
                      fontSize: 14,
                      color: 'var(--mc-text)',
                      lineHeight: 1.5,
                      maxHeight: 120,
                      overflowY: 'auto',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => { void handleSend(); }}
                    disabled={!inputText.trim() || sending}
                    aria-label="送信"
                    style={{
                      background: inputText.trim() ? 'var(--mc-accent)' : 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 8px',
                      cursor: inputText.trim() ? 'pointer' : 'default',
                      color: inputText.trim() ? '#fff' : 'var(--mc-text-faint)',
                      display: 'flex',
                      alignItems: 'center',
                      transition: 'background 0.15s',
                    }}
                  >
                    <SendIcon width={18} height={18} />
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--mc-text-faint)', marginTop: 4 }}>
                  Enter で送信 / Shift+Enter で改行
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mc-text-faint)',
                fontSize: 14,
              }}
            >
              チャンネルを選択してください
            </div>
          )}
        </div>
      </div>

      {/* 新規チャンネル作成モーダル */}
      {showNewChannel && (
        <NewChannelModal
          onClose={() => setShowNewChannel(false)}
          onCreate={(ch) => {
            setChannels((prev) => [
              ...prev,
              {
                ...ch,
                unreadCount: 0,
                lastMessage: null,
              } satisfies ChannelSummary,
            ]);
            setSelectedId(ch.id);
            setShowNewChannel(false);
          }}
        />
      )}
    </div>
  );
}
