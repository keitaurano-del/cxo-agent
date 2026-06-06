// Chat — Slack 的チャット機能（MC-141/142/144）
//
// 左カラム: チャンネル一覧（#チャンネル + DM）
// 右カラム: メッセージ一覧（Slack 風・Markdown レンダリング）＋ 入力欄
// SSE /api/stream の chat イベントでリアルタイム追加。
// 自分は senderId='keita'、senderName='Keita'、senderEmoji=''（絵文字なし）。
// MC-142: ラウンドテーブル・エージェント単発反応ボタンを追加。
// MC-144: ファイル添付・メンション・リアクション追加。

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveTick } from '../lib/liveContext';
import { HashIcon, PlusIcon, SendIcon, TrashIcon, SparkIcon, ExpandIcon, ShrinkIcon, PaperclipIcon } from '../components/icons';
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

interface Attachment {
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

type Reactions = Record<string, string[]>;

interface ChatMessage {
  id: string;
  ts: string;
  senderId: string;
  senderName: string;
  senderEmoji: string;
  text: string;
  attachments?: Attachment[];
  reactions?: Reactions;
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

interface AgentInfo {
  senderId: string;
  senderName: string;
  color: string;
  role: string;
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

async function postMessage(channelId: string, text: string, attachments?: Attachment[]): Promise<ChatMessage> {
  const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderId: SELF_ID, senderName: SELF_NAME, senderEmoji: SELF_EMOJI, text,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { message: ChatMessage };
  return data.message;
}

async function uploadFiles(channelId: string, files: File[]): Promise<Attachment[]> {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  const res = await fetch(`/api/chat/channels/${channelId}/upload`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { files: Attachment[] };
  return data.files;
}

async function postReaction(channelId: string, msgId: string, emoji: string): Promise<ChatMessage> {
  const res = await fetch(`/api/chat/channels/${channelId}/messages/${msgId}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji, senderId: SELF_ID }),
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

async function fetchAgents(): Promise<AgentInfo[]> {
  const res = await fetch('/api/chat/agents');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { agents: AgentInfo[] };
  return data.agents;
}

async function postAgentReact(channelId: string, agentId: string): Promise<ChatMessage> {
  const res = await fetch(`/api/chat/channels/${channelId}/agent-react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { message: ChatMessage };
  return data.message;
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

// ── 絵文字リアクション固定セット ─────────────────────────────────
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥'] as const;

/** 添付ファイル表示コンポーネント。 */
function AttachmentView({ att }: { att: Attachment }) {
  const [lightbox, setLightbox] = useState(false);
  const isImage = att.mimeType.startsWith('image/');
  const isVideo = att.mimeType.startsWith('video/');
  const isPdf = att.mimeType === 'application/pdf';

  if (isImage) {
    return (
      <>
        <div
          style={{ marginTop: 6, cursor: 'pointer' }}
          onClick={() => setLightbox(true)}
          title={att.name}
        >
          <img
            src={att.url}
            alt={att.name}
            style={{
              maxWidth: 320,
              maxHeight: 240,
              borderRadius: 6,
              display: 'block',
              border: '1px solid var(--mc-border)',
            }}
          />
        </div>
        {lightbox && (
          <div
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
            }}
            onClick={() => setLightbox(false)}
          >
            <img src={att.url} alt={att.name} style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
          </div>
        )}
      </>
    );
  }
  if (isVideo) {
    return (
      <div style={{ marginTop: 6 }}>
        <video
          src={att.url}
          controls
          style={{ maxWidth: 360, maxHeight: 240, borderRadius: 6, display: 'block', border: '1px solid var(--mc-border)' }}
        />
      </div>
    );
  }
  if (isPdf) {
    return (
      <div style={{ marginTop: 6 }}>
        <a href={att.url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--mc-accent)', textDecoration: 'underline' }}>
          PDF を開く: {att.name}
        </a>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      <a href={att.url} download={att.name}
        style={{ fontSize: 13, color: 'var(--mc-accent)', textDecoration: 'underline' }}>
        ダウンロード: {att.name}
      </a>
    </div>
  );
}

/** メッセージ1件。連続送信者はアバター・名前省略。 */
function MessageItem({
  msg,
  prevMsg,
  onDelete,
  onAgentReact,
  onReact,
  avatarSize = 32,
  roleByMemberId = {},
}: {
  msg: ChatMessage;
  prevMsg: ChatMessage | null;
  onDelete?: () => void;
  onAgentReact?: () => void;
  onReact?: (emoji: string) => void;
  avatarSize?: number;
  roleByMemberId?: Record<string, string>;
}) {
  const [hovered, setHovered] = useState(false);
  const [showReactPicker, setShowReactPicker] = useState(false);
  const isSelf = msg.senderId === SELF_ID;
  const isAgent = !isSelf;
  const isGrouped =
    prevMsg !== null &&
    prevMsg.senderId === msg.senderId &&
    new Date(msg.ts).getTime() - new Date(prevMsg.ts).getTime() < 5 * 60 * 1000; // 5分以内

  const time = new Date(msg.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  // @mention を強調表示
  const highlightMentions = (text: string): string => {
    return text.replace(/@([a-zA-Z0-9_\-]+)/g, (m) =>
      `<span style="background:var(--mc-accent);color:#fff;border-radius:3px;padding:0 3px;font-size:13px">${m}</span>`
    );
  };

  const renderedText = highlightMentions(renderMarkdown(msg.text));

  // リアクション集計
  const reactions = msg.reactions ?? {};
  const reactionEntries = Object.entries(reactions).filter(([, senders]) => senders.length > 0);

  // グループ時の左 padding はアバター幅 + gap に合わせる
  const groupedPaddingLeft = avatarSize + 8 + 12;

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: isGrouped
          ? `2px 12px 4px ${groupedPaddingLeft}px`
          : `${avatarSize >= 36 ? 10 : 8}px 12px 4px 12px`,
        background: hovered ? 'var(--mc-surface-2)' : 'transparent',
        borderRadius: 4,
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowReactPicker(false); }}
    >
      {!isGrouped && (
        <Avatar senderId={msg.senderId} senderName={msg.senderName} senderEmoji={msg.senderEmoji} size={avatarSize} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!isGrouped && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: isAgent ? agentBg(msg.senderId) : 'var(--mc-text)',
              }}
            >
              {msg.senderName}
              {isAgent && roleByMemberId[msg.senderId] && (
                <span style={{ fontWeight: 400, color: 'var(--mc-text-faint)', fontSize: 11, marginLeft: 4 }}>
                  （{roleByMemberId[msg.senderId]}）
                </span>
              )}
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
          dangerouslySetInnerHTML={{ __html: renderedText }}
        />
        {/* 添付ファイル */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {msg.attachments.map((att, i) => (
              <AttachmentView key={i} att={att} />
            ))}
          </div>
        )}
        {/* リアクション表示 */}
        {reactionEntries.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {reactionEntries.map(([emoji, senders]) => {
              const isMine = senders.includes(SELF_ID);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact?.(emoji)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    padding: '1px 6px', borderRadius: 12,
                    border: `1px solid ${isMine ? 'var(--mc-accent)' : 'var(--mc-border)'}`,
                    background: isMine ? 'rgba(var(--mc-accent-rgb, 90,110,200),0.12)' : 'var(--mc-surface-2)',
                    cursor: 'pointer', fontSize: 13, color: 'var(--mc-text)',
                  }}
                  title={senders.join(', ')}
                >
                  <span>{emoji}</span>
                  <span style={{ fontSize: 11, color: 'var(--mc-text-muted)' }}>{senders.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* ホバーアクションバー */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            gap: 4,
            zIndex: 10,
          }}
        >
          {/* リアクション絵文字ピッカー */}
          {onReact && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowReactPicker((v) => !v)}
                style={{
                  background: 'var(--mc-surface-3)',
                  border: '1px solid var(--mc-border)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  color: 'var(--mc-text-muted)',
                  fontSize: 14,
                  lineHeight: 1,
                }}
                title="リアクション"
                aria-label="リアクション"
              >
                +
              </button>
              {showReactPicker && (
                <div
                  style={{
                    position: 'absolute', right: 0, bottom: '110%',
                    background: 'var(--mc-surface)',
                    border: '1px solid var(--mc-border)',
                    borderRadius: 8,
                    padding: '6px 8px',
                    display: 'flex', gap: 4,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    whiteSpace: 'nowrap',
                    zIndex: 20,
                  }}
                >
                  {REACTION_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => { onReact(em); setShowReactPicker(false); }}
                      style={{
                        background: 'transparent', border: 'none',
                        cursor: 'pointer', fontSize: 20, padding: '2px 3px',
                        borderRadius: 4,
                      }}
                      title={em}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {onAgentReact && (
            <button
              type="button"
              onClick={onAgentReact}
              style={{
                background: 'var(--mc-surface-3)',
                border: '1px solid var(--mc-border)',
                borderRadius: 4,
                padding: '2px 6px',
                cursor: 'pointer',
                color: 'var(--mc-text-muted)',
                display: 'flex',
                alignItems: 'center',
              }}
              title="エージェントに反応させる"
              aria-label="エージェントに反応させる"
            >
              <SparkIcon width={13} height={13} />
            </button>
          )}
          {isSelf && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              style={{
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
      )}
    </div>
  );
}

/** チャンネルリストアイテム。 */
function ChannelItem({
  ch,
  active,
  unread,
  roleLabel,
  onClick,
}: {
  ch: ChannelSummary;
  active: boolean;
  unread: number;
  roleLabel?: string;
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
        padding: '10px 8px',
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
        {roleLabel && (
          <span style={{ fontWeight: 400, color: 'var(--mc-text-faint)', fontSize: 12, marginLeft: 4 }}>
            （{roleLabel}）
          </span>
        )}
      </span>
      {unread > 0 && (
        <span
          style={{
            background: 'var(--mc-blocked)',
            color: '#fff',
            borderRadius: 10,
            fontSize: 11,
            padding: '2px 6px',
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

// ── エージェント選択モーダル（agent-react）────────────────────────

function AgentReactModal({
  agents,
  onClose,
  onSelect,
}: {
  agents: AgentInfo[];
  onClose: () => void;
  onSelect: (agentId: string) => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);

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
          width: 320,
          maxWidth: '90vw',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>エージェントに反応させる</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {agents.map((a) => (
            <button
              key={a.senderId}
              type="button"
              disabled={loading !== null}
              onClick={() => {
                setLoading(a.senderId);
                onSelect(a.senderId);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                border: '1px solid var(--mc-border)',
                borderRadius: 6,
                background: loading === a.senderId ? 'var(--mc-surface-2)' : 'transparent',
                cursor: loading !== null ? 'default' : 'pointer',
                color: 'var(--mc-text)',
                textAlign: 'left',
                opacity: loading !== null && loading !== a.senderId ? 0.5 : 1,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: a.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {a.senderName.charAt(0)}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{a.senderName}</div>
                <div style={{ fontSize: 11, color: 'var(--mc-text-muted)' }}>{a.role}</div>
              </div>
              {loading === a.senderId && (
                <div style={{ marginLeft: 'auto' }}>
                  <Spinner />
                </div>
              )}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
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
  const [members, setMembers] = useState<ChatMember[]>([]);

  // エージェント人格一覧（MC-142）
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  // 全画面表示
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ラウンドテーブルは削除済み（Keita 指示）

  // agent-react モーダル
  const [showAgentReact, setShowAgentReact] = useState(false);

  // モバイル判定（768px 未満）
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // モバイル: パネル切替
  const [mobilePanel, setMobilePanel] = useState<'list' | 'messages'>('list');

  // MC-144: ファイル添付ステート
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // MC-144: メンション候補ステート
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

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
    fetchMembers().then((ms) => setMembers(ms)).catch(() => {});
    fetchAgents().then(setAgents).catch(() => {});
  }, [loadChannels]);

  // チャンネル変更時
  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
    // 既読マーク（チャンネル選択時）
    const now = new Date().toISOString();
    saveLastRead(selectedId, now);
    setLastRead((prev) => ({ ...prev, [selectedId]: now }));
    // App.tsx のサイドバーバッジをリセット（アクティブチャンネル通知）
    localStorage.setItem('chat.activeChannel', selectedId);
    localStorage.setItem('chat.unreadBadge', '0');
    window.dispatchEvent(new Event('chat-badge-update'));
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
              setMessages((prev) => {
                // リアクション更新の場合は既存メッセージを置き換え
                const idx = prev.findIndex((m) => m.id === data.message!.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = data.message!;
                  return next;
                }
                return [...prev, data.message!];
              });
            } else if (data.deleted) {
              setMessages((prev) => prev.filter((m) => m.id !== data.deleted));
            }
          }
          // チャンネルリストの lastMessage を更新（新規メッセージのみ）
          if (data.message) {
            setChannels((prev) =>
              prev.map((ch) => {
                if (ch.id !== data.channelId) return ch;
                // reactions 更新は lastMessage に反映しない（チャンネルリストに不要）
                const isNew = !ch.lastMessage || data.message!.ts >= (ch.lastMessage?.ts ?? '');
                return isNew ? { ...ch, lastMessage: data.message! } : ch;
              }),
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
    const hasFiles = pendingFiles.length > 0 || uploadedAttachments.length > 0;
    if (!selectedId || (!inputText.trim() && !hasFiles) || sending) return;
    // ファイルのみの場合は自動テキストを補完
    const text = inputText.trim() || 'ファイルを添付しました';

    // ファイルのアップロードが未完了の場合は先にアップロード
    let attachments: Attachment[] = [...uploadedAttachments];
    if (pendingFiles.length > 0) {
      setUploading(true);
      try {
        const uploaded = await uploadFiles(selectedId, pendingFiles);
        attachments = [...attachments, ...uploaded];
        setPendingFiles([]);
        setUploadedAttachments([]);
      } catch {
        setUploading(false);
        return; // アップロード失敗時は送信しない
      }
      setUploading(false);
    } else {
      setUploadedAttachments([]);
    }

    setInputText('');
    setMentionQuery(null);
    setSending(true);
    try {
      const msg = await postMessage(selectedId, text, attachments.length > 0 ? attachments : undefined);
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

  // ファイル選択
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // リアクション
  const handleReact = async (channelId: string, msgId: string, emoji: string) => {
    try {
      const updated = await postReaction(channelId, msgId, emoji);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? updated : m)));
    } catch {
      // SSE で回復
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // メンション候補が表示中は Enter でキャンセル
    if (mentionQuery !== null && e.key === 'Escape') {
      setMentionQuery(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // メンション候補の検出（入力変化時）
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    // カーソル直前の @ を検出
    const pos = e.target.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const match = before.match(/@([a-zA-Z0-9_\-]*)$/);
    if (match) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(null);
    }
  };

  // メンション候補クリック時: テキストに挿入
  const handleMentionSelect = (memberId: string) => {
    const pos = textareaRef.current?.selectionStart ?? inputText.length;
    const before = inputText.slice(0, pos);
    const after = inputText.slice(pos);
    const atIdx = before.lastIndexOf('@');
    const newText = before.slice(0, atIdx) + `@${memberId} ` + after;
    setInputText(newText);
    setMentionQuery(null);
    // フォーカス復帰
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // フィルタ済みメンション候補
  const mentionCandidates = mentionQuery !== null
    ? members.filter((m) =>
        m.id.toLowerCase().includes(mentionQuery.toLowerCase()) ||
        m.name.toLowerCase().includes(mentionQuery.toLowerCase())
      ).slice(0, 8)
    : [];

  // 削除
  const handleDelete = async (channelId: string, msgId: string) => {
    try {
      await deleteMessage(channelId, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch {
      // ignore
    }
  };

  // agent-react: 指定エージェントがチャンネルのメッセージに反応
  const handleAgentReact = async (channelId: string, agentId: string) => {
    setShowAgentReact(false);
    try {
      const msg = await postAgentReact(channelId, agentId);
      setMessages((prev) => [...prev, msg]);
    } catch {
      // ignore（SSE で拾える）
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
    <div style={{
      display: 'flex', flexDirection: 'column',
      ...(isFullscreen
        ? { position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--mc-bg)' }
        : { height: '100%' }),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 8 }}>
        <div style={{ flex: 1 }}>
          <PageHeader
            title="チャット"
            subtitle={selectedChannel ? `#${selectedChannel.name}` : undefined}
          />
        </div>
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          title={isFullscreen ? '全画面を終了' : '全画面表示'}
          style={{
            padding: 6, borderRadius: 6, border: '1px solid var(--mc-border)',
            background: 'var(--mc-surface-2)', color: 'var(--mc-text-muted)',
            cursor: 'pointer', display: 'flex', alignItems: 'center',
          }}
        >
          {isFullscreen ? <ShrinkIcon width={16} height={16} /> : <ExpandIcon width={16} height={16} />}
        </button>
      </div>

      {/* モバイル タブ切替 */}
      {isMobile && (
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--mc-border)',
            background: 'var(--mc-surface)',
            flexShrink: 0,
          }}
        >
          {(['list', 'messages'] as const).map((panel) => (
            <button
              key={panel}
              type="button"
              onClick={() => setMobilePanel(panel)}
              style={{
                flex: 1,
                height: 44,
                border: 'none',
                borderBottom: mobilePanel === panel ? '2px solid var(--mc-accent)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 14,
                color: mobilePanel === panel ? 'var(--mc-accent)' : 'var(--mc-text-muted)',
                fontWeight: mobilePanel === panel ? 600 : 400,
              }}
            >
              {panel === 'list' ? 'チャンネル一覧' : 'メッセージ'}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左カラム: チャンネルリスト（モバイルは list パネル時のみ表示） */}
        <div
          style={{
            width: isMobile ? '100%' : 220,
            flexShrink: 0,
            borderRight: isMobile ? 'none' : '1px solid var(--mc-border)',
            background: 'var(--mc-surface)',
            display: isMobile && mobilePanel !== 'list' ? 'none' : 'flex',
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
                      .map((ch) => {
                        const otherId = ch.members.find((m) => m !== SELF_ID);
                        const roleLabel = otherId
                          ? members.find((m) => m.id === otherId)?.role
                          : undefined;
                        return (
                          <ChannelItem
                            key={ch.id}
                            ch={ch}
                            active={ch.id === selectedId}
                            unread={ch.id !== selectedId ? unreadCount(ch) : 0}
                            roleLabel={roleLabel}
                            onClick={() => {
                              setSelectedId(ch.id);
                              setMobilePanel('messages');
                            }}
                          />
                        );
                      })}
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

        {/* 右カラム: メッセージエリア（モバイルは messages パネル時のみ表示） */}
        <div style={{
          flex: 1,
          display: isMobile && mobilePanel !== 'messages' ? 'none' : 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
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
                      avatarSize={isMobile ? 36 : 32}
                      roleByMemberId={Object.fromEntries(members.filter(m => m.role).map(m => [m.id, m.role!]))}
                      onDelete={
                        msg.senderId === SELF_ID
                          ? () => { void handleDelete(selectedChannel.id, msg.id); }
                          : undefined
                      }
                      onAgentReact={
                        agents.length > 0
                          ? () => setShowAgentReact(true)
                          : undefined
                      }
                      onReact={(emoji) => { void handleReact(selectedChannel.id, msg.id, emoji); }}
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
                  position: 'relative',
                }}
              >
                {/* メンション候補ポップアップ */}
                {mentionQuery !== null && mentionCandidates.length > 0 && (
                  <div
                    style={{
                      position: 'absolute', bottom: '100%', left: 12,
                      background: 'var(--mc-surface)',
                      border: '1px solid var(--mc-border)',
                      borderRadius: 6,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                      zIndex: 100,
                      minWidth: 200,
                      maxHeight: 220,
                      overflowY: 'auto',
                    }}
                  >
                    {mentionCandidates.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); handleMentionSelect(m.id); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 12px', width: '100%', textAlign: 'left',
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: 'var(--mc-text)', fontSize: 13,
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--mc-surface-2)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <div style={{
                          width: 24, height: 24, borderRadius: '50%',
                          background: 'var(--mc-text-muted)', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0,
                        }}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{m.id}</div>
                          {m.role && <div style={{ fontSize: 11, color: 'var(--mc-text-muted)' }}>{m.role}</div>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* ファイルプレビュー */}
                {(pendingFiles.length > 0 || uploadedAttachments.length > 0) && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 6,
                    marginBottom: 6, padding: '4px 0',
                  }}>
                    {pendingFiles.map((f, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: 'var(--mc-surface-2)',
                        border: '1px solid var(--mc-border)',
                        borderRadius: 4, padding: '2px 8px', fontSize: 12,
                        color: 'var(--mc-text-muted)',
                      }}>
                        {f.type.startsWith('image/')
                          ? <img src={URL.createObjectURL(f)} alt={f.name}
                              style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 3 }} />
                          : <PaperclipIcon width={12} height={12} />
                        }
                        <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <button type="button" onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--mc-text-faint)', fontSize: 14, lineHeight: 1, padding: 0 }}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

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
                  {/* クリップ（ファイル添付）ボタン */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || sending}
                    aria-label="ファイルを添付"
                    title="ファイルを添付"
                    style={{
                      background: 'transparent', border: 'none',
                      cursor: uploading || sending ? 'default' : 'pointer',
                      color: 'var(--mc-text-muted)',
                      display: 'flex', alignItems: 'center',
                      padding: isMobile ? '6px 8px' : '2px 4px',
                      minWidth: isMobile ? 44 : undefined,
                      minHeight: isMobile ? 44 : undefined,
                      justifyContent: 'center',
                      opacity: uploading || sending ? 0.5 : 1,
                    }}
                  >
                    <PaperclipIcon width={isMobile ? 20 : 16} height={isMobile ? 20 : 16} />
                  </button>
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={inputText}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={`#${selectedChannel.name} にメッセージを送る（@ でメンション）`}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      resize: 'none',
                      fontSize: 14,
                      color: 'var(--mc-text)',
                      lineHeight: 1.5,
                      minHeight: isMobile ? 44 : 36,
                      maxHeight: 120,
                      overflowY: 'auto',
                      paddingTop: isMobile ? 12 : 0,
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => { void handleSend(); }}
                    disabled={(!inputText.trim() && pendingFiles.length === 0) || sending || uploading}
                    aria-label="送信"
                    style={{
                      background: (inputText.trim() || pendingFiles.length > 0) ? 'var(--mc-accent)' : 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      padding: isMobile ? '8px 12px' : '4px 8px',
                      minWidth: isMobile ? 44 : undefined,
                      minHeight: isMobile ? 44 : undefined,
                      cursor: (inputText.trim() || pendingFiles.length > 0) ? 'pointer' : 'default',
                      color: (inputText.trim() || pendingFiles.length > 0) ? '#fff' : 'var(--mc-text-faint)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.15s',
                    }}
                  >
                    {uploading ? <Spinner /> : <SendIcon width={isMobile ? 22 : 18} height={isMobile ? 22 : 18} />}
                  </button>
                </div>
                {!isMobile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ fontSize: 11, color: 'var(--mc-text-faint)', flex: 1 }}>
                      Enter で送信 / Shift+Enter で改行 / @ でメンション
                    </div>
                    {/* ラウンドテーブルボタン削除済み（Keita 指示） */}
                  </div>
                )}
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

      {/* agent-react モーダル（MC-142） */}
      {showAgentReact && selectedId && (
        <AgentReactModal
          agents={agents}
          onClose={() => setShowAgentReact(false)}
          onSelect={(agentId) => {
            void handleAgentReact(selectedId, agentId);
          }}
        />
      )}

      {/* ラウンドテーブルモーダル削除済み（Keita 指示） */}
    </div>
  );
}
