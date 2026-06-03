// ターミナル（MC-92 / MC-95 / MC-119）— 3つの独立ターミナルをタブで切り替えて操作する。
//
// MC-119: Apollo ターミナルを「3つの独立ターミナル（タブ切替）」にする。
//   - ターミナル1（/terminal,  ttyd 7681）= この箱の tmux main（林 CLI）※既存
//   - ターミナル2（/terminal/2, ttyd 7682）= 旧箱(139.180.202.62)へ ssh して claude
//   - ターミナル3（/terminal/3, ttyd 7683）= この箱の予備 claude（spare セッション）
//   各ベースパスは Apollo サーバ側 reverse proxy が対応 ttyd ポートへ振り分ける。
//   3つの iframe は常時 mount したまま CSS で表示/非表示を切り替える（タブ切替で再ロード
//   ＝セッション切れに見えないように、iframe を保持する）。
//
// 同一オリジンの iframe なので、認証 Cookie（mc_token）は自動付与され、未認証では
// サーバ側で弾かれる（HTTP・WS とも）。ttyd の Basic 認証は proxy が内部付与する。
//
// サーバ補助機能の対象（重要 / MC-119 制約）:
//   画像添付・出力モーダル・仮想キーバー・「ターミナルを開始」はサーバ側で
//   tmux main（= ターミナル1）に対して send-keys / capture-pane する実装。ターミナル2は
//   旧箱の別 tmux、ターミナル3は spare セッションで、ローカル tmux main 前提のこれらの補助は
//   効かない。そのため補助機能はターミナル1（serverAssisted）でのみ有効化し、ターミナル2/3 は
//   iframe（ttyd 直）操作のみとする（2/3 の補助機能対応は follow-up）。
//   「ターミナルを開始」は対象タブの systemd ユニットを冪等復旧する（terminal 番号をサーバへ渡す）。
//
// MC-95 / MC-102 画像添付（ターミナル1 のみ）:
//   選んだ／貼り付けた画像をフロントの配列に貯め、サムネでプレビュー → 「送る」で一括 POST。
//   サーバは data/terminal-uploads/ に保存し、絶対パス群を tmux main の入力欄へ send-keys で
//   リテラル注入する（自動 Enter なし）。林はそのパスを Read で画像として読める。

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageFileIcon, CloseIcon, TerminalIcon, PlusIcon, KeyboardIcon } from '../components/icons';
import { Spinner } from '../components/ui';

// ─── ターミナル定義 ───────────────────────────────────────────
// path は iframe src のベース（末尾スラッシュ付き＝相対アセットの解決基準）。
// serverAssisted=true のターミナルだけ画像添付 / 出力 / 仮想キーバーを有効化する。
interface TerminalTab {
  id: number;
  label: string;
  path: string; // iframe src（例: '/terminal/', '/terminal/2/'）
  serverAssisted: boolean; // tmux main 連動の補助機能が効くか（ターミナル1のみ）
}

const TERMINAL_TABS: TerminalTab[] = [
  { id: 1, label: 'ターミナル1', path: '/terminal/', serverAssisted: true },
  { id: 2, label: 'ターミナル2', path: '/terminal/2/', serverAssisted: false },
  { id: 3, label: 'ターミナル3', path: '/terminal/3/', serverAssisted: false },
];

const ACTIVE_TAB_STORAGE_KEY = 'apollo.terminal.activeTab';

// ─── 仮想キーバー / 補助 API helper ───────────────────────────
// send-keys / output / start は tmux main（ターミナル1）に対して効く。
async function postSendKeys(keys: string): Promise<void> {
  try {
    await fetch('/api/terminal/send-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
  } catch {
    // 送信失敗はサイレント（ttyd 画面側で確認できる）
  }
}

const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB / 枚

// ステージング中の 1 枚。file は送信用、url はサムネ表示用（unmount/削除/送信成功で revoke）。
interface StagedImage {
  id: string;
  file: File;
  url: string;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; count: number; injected: boolean; paths: string[] }
  | { kind: 'error'; message: string };

/** バイト数を人が読める単位に整形する（サムネのキャプション用）。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ターミナルバックエンド（ttyd / tmux main）の稼働状態（MC-100 / MC-119）。
type BackendState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'down' }
  | { kind: 'starting' }
  | { kind: 'start-error'; message: string };

interface TerminalStatusResponse {
  tmuxSession?: boolean;
  ttydService?: boolean;
  ttydReachable?: boolean;
  ready?: boolean;
}

/** 出力表示モーダル: 最近の出力を通常テキストで表示→選択・コピー可（tmux main = ターミナル1）。 */
function OutputModal({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState<string>('読み込み中...');
  useEffect(() => {
    fetch('/api/terminal/output?lines=200')
      .then((r) => r.json())
      .then((b: { ok: boolean; content?: string }) => setContent(b.content ?? '（取得できませんでした）'))
      .catch(() => setContent('（エラー）'));
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-text">出力（選択してコピー）</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          style={{ touchAction: 'manipulation' }}
          className="flex h-11 min-w-11 items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-sm font-medium text-text hover:bg-surface-3"
        >
          <CloseIcon width={22} height={22} className="pointer-events-none" />
          閉じる
        </button>
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all p-4 text-xs leading-relaxed text-text select-text font-mono">
        {content}
      </pre>
      <div className="border-t border-border bg-surface px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          style={{ touchAction: 'manipulation' }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-surface-2 text-sm font-medium text-text hover:bg-surface-3"
        >
          <CloseIcon width={20} height={20} className="pointer-events-none" />
          閉じる
        </button>
      </div>
    </div>
  );
}


export default function Terminal() {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [showOutput, setShowOutput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── アクティブタブ（MC-119）─────────────────────────────────
  // 表示中のターミナル番号。localStorage に保持して再訪時に復元する。
  const [activeId, setActiveId] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      if (TERMINAL_TABS.some((t) => t.id === n)) return n;
    } catch {
      // localStorage 不可（プライベートモード等）でも既定は 1。
    }
    return 1;
  });
  const switchTab = useCallback((id: number) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, String(id));
    } catch {
      // 保持できなくても切替自体は機能させる。
    }
  }, []);
  const activeTab = TERMINAL_TABS.find((t) => t.id === activeId) ?? TERMINAL_TABS[0];
  // 補助機能（画像添付・出力・キーバー）はサーバ連動が効くターミナル（=1）のみ。
  const assisted = activeTab.serverAssisted;

  // ── モバイル仮想キーバー（スマホ専用）──────────────────────
  const [keyInput, setKeyInput] = useState('');

  // 仮想キーバーの表示トグル（MC-113）。既定は非表示で、キーボードアイコンのボタンで開閉する。
  const KEYBAR_STORAGE_KEY = 'apollo.terminal.keybarOpen';
  const [keybarOpen, setKeybarOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEYBAR_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleKeybar = useCallback(() => {
    setKeybarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEYBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // localStorage 不可でもトグル自体は機能させる。
      }
      return next;
    });
  }, []);

  // ── ↑↓ キーの送信ロジック（MC-113 修正）─────────────────────────
  const REPEAT_DELAY_MS = 450; // この時間以上押し続けたらオートリピート開始
  const REPEAT_INTERVAL_MS = 180; // オートリピートの送信間隔
  const arrowRepeatTimerRef = useRef<number | null>(null);
  const arrowRepeatIntervalRef = useRef<number | null>(null);
  const arrowPointerIdRef = useRef<number | null>(null);

  const stopArrowRepeat = useCallback(() => {
    if (arrowRepeatTimerRef.current !== null) {
      clearTimeout(arrowRepeatTimerRef.current);
      arrowRepeatTimerRef.current = null;
    }
    if (arrowRepeatIntervalRef.current !== null) {
      clearInterval(arrowRepeatIntervalRef.current);
      arrowRepeatIntervalRef.current = null;
    }
    arrowPointerIdRef.current = null;
  }, []);

  const handleArrowPointerDown = useCallback(
    (direction: 'up' | 'down', pointerId: number) => {
      stopArrowRepeat();
      arrowPointerIdRef.current = pointerId;
      const key = direction === 'up' ? 'Up' : 'Down';
      void postSendKeys(key);
      arrowRepeatTimerRef.current = window.setTimeout(() => {
        arrowRepeatIntervalRef.current = window.setInterval(() => {
          void postSendKeys(key);
        }, REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [stopArrowRepeat],
  );

  const handleArrowPointerUp = useCallback(
    (pointerId: number) => {
      if (arrowPointerIdRef.current !== null && arrowPointerIdRef.current !== pointerId) return;
      stopArrowRepeat();
    },
    [stopArrowRepeat],
  );

  useEffect(() => stopArrowRepeat, [stopArrowRepeat]);

  const sendKey = useCallback((key: string) => {
    void postSendKeys(key);
  }, []);

  const sendText = useCallback((text: string) => {
    if (text.length === 0) return;
    void postSendKeys(text);
  }, []);

  // ── 画像ステージング（MC-102、ターミナル1 のみ）──────────────
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const stagedRef = useRef<StagedImage[]>([]);
  stagedRef.current = staged;
  useEffect(() => {
    return () => {
      for (const s of stagedRef.current) URL.revokeObjectURL(s.url);
    };
  }, []);

  // ── バックエンド復旧（MC-100 / MC-119）────────────────────────
  // 各ターミナルごとに状態を持つ（id → BackendState）。
  const [backends, setBackends] = useState<Record<number, BackendState>>(() => {
    const init: Record<number, BackendState> = {};
    for (const t of TERMINAL_TABS) init[t.id] = { kind: 'checking' };
    return init;
  });
  // iframe を強制リロードするための key（ターミナルごと）。start 成功後に対象だけ貼り直す。
  const [iframeKeys, setIframeKeys] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const t of TERMINAL_TABS) init[t.id] = 0;
    return init;
  });
  // ポーリングが start 進行中の上書きを避けるため、最新 kind を ref で持つ。
  const backendsRef = useRef<Record<number, BackendState>>(backends);
  backendsRef.current = backends;

  const setBackend = useCallback((id: number, next: BackendState) => {
    setBackends((prev) => ({ ...prev, [id]: next }));
  }, []);

  // GET /api/terminal/status?terminal=<id> を叩いて ready/down を判定する。
  const refreshStatus = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        const res = await fetch(`/api/terminal/status?terminal=${id}`, { method: 'GET' });
        if (!res.ok) {
          setBackend(id, { kind: 'down' });
          return false;
        }
        const body = (await res.json()) as TerminalStatusResponse;
        const ready = Boolean(body.ready);
        setBackend(id, ready ? { kind: 'ready' } : { kind: 'down' });
        return ready;
      } catch {
        setBackend(id, { kind: 'down' });
        return false;
      }
    },
    [setBackend],
  );

  // POST /api/terminal/start {terminal:id} でバックエンドを復旧 → 成功なら対象 iframe をリロード。
  const startBackend = useCallback(
    async (id: number) => {
      setBackend(id, { kind: 'starting' });
      try {
        const res = await fetch('/api/terminal/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminal: id }),
        });
        if (!res.ok) {
          let message = `起動に失敗しました（HTTP ${res.status}）。`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) message = body.error;
          } catch {
            // JSON でない場合は既定メッセージ。
          }
          setBackend(id, { kind: 'start-error', message });
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
        const ready = await refreshStatus(id);
        if (ready) {
          setIframeKeys((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
        }
      } catch (e) {
        setBackend(id, {
          kind: 'start-error',
          message: e instanceof Error ? `起動に失敗しました。${e.message}` : '起動に失敗しました。',
        });
      }
    },
    [refreshStatus, setBackend],
  );

  // マウント時に全ターミナルの状態確認、以降は定期ポーリングで切断を検知する。
  useEffect(() => {
    for (const t of TERMINAL_TABS) void refreshStatus(t.id);
    const intId = window.setInterval(() => {
      for (const t of TERMINAL_TABS) {
        // starting 中はポーリングしない（start 側が状態を握る）。
        if (backendsRef.current[t.id]?.kind === 'starting') continue;
        void refreshStatus(t.id);
      }
    }, 15000);
    return () => window.clearInterval(intId);
  }, [refreshStatus]);

  // 選択/貼付した画像をステージング配列に追加する（即送信しない）。
  const addToStaging = useCallback((files: File[]) => {
    const images = files.filter((f) => ACCEPTED_MIME.includes(f.type));
    if (images.length === 0) {
      setState({ kind: 'error', message: '対応する画像（PNG / JPEG / WebP / GIF）が見つかりませんでした。' });
      return;
    }
    const tooLarge = images.find((f) => f.size > MAX_BYTES);
    if (tooLarge) {
      setState({ kind: 'error', message: '各画像は 10MB までです。' });
      return;
    }
    setStaged((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        setState({ kind: 'error', message: `画像は合計 ${MAX_IMAGES} 枚までです。先に何枚か削除してください。` });
        return prev;
      }
      const accepted = images.slice(0, room);
      if (accepted.length < images.length) {
        setState({
          kind: 'error',
          message: `画像は合計 ${MAX_IMAGES} 枚までです。${images.length - accepted.length} 枚は追加できませんでした。`,
        });
      } else {
        setState({ kind: 'idle' });
      }
      const next = accepted.map((f, i) => {
        const named =
          f.name && f.name.trim() !== ''
            ? f
            : new File([f], `pasted-${Date.now()}-${i}.${f.type.split('/')[1] || 'png'}`, {
                type: f.type,
              });
        return {
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          file: named,
          url: URL.createObjectURL(named),
        };
      });
      return [...prev, ...next];
    });
  }, []);

  const removeStaged = useCallback((id: string) => {
    setStaged((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  // ステージング中の全画像を /api/terminal/upload へ一括送信する（tmux main = ターミナル1 に注入）。
  const sendStaged = useCallback(async () => {
    const items = stagedRef.current;
    if (items.length === 0) return;
    setState({ kind: 'uploading' });
    try {
      const fd = new FormData();
      items.forEach((s) => fd.append('images', s.file, s.file.name));
      const res = await fetch('/api/terminal/upload', { method: 'POST', body: fd });
      if (res.status !== 201) {
        let reason = `送信に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          if (body?.error || body?.message) reason = body.error ?? body.message ?? reason;
        } catch {
          // JSON でない場合は既定メッセージのまま。
        }
        setState({ kind: 'error', message: reason });
        return;
      }
      const body = (await res.json()) as {
        count?: number;
        injected?: boolean;
        paths?: string[];
      };
      const sentCount = items.length;
      setState({
        kind: 'done',
        count: body.count ?? sentCount,
        injected: body.injected ?? false,
        paths: Array.isArray(body.paths) ? body.paths : [],
      });
      setStaged((prev) => {
        for (const s of prev) URL.revokeObjectURL(s.url);
        return [];
      });
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? `送信に失敗しました。${e.message}` : '送信に失敗しました。',
      });
    }
  }, []);

  const handleFiles = (fileList: FileList | null) => {
    if (fileList && fileList.length > 0) addToStaging(Array.from(fileList));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // クリップボード貼付（Ctrl+V / ⌘+V）。サーバ連動が効くターミナル1表示中のみ受ける。
  useEffect(() => {
    if (!assisted) return; // ターミナル2/3 表示中は親で paste を奪わない（iframe に委ねる）
    const onPaste = (e: ClipboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addToStaging(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addToStaging, assisted]);

  const activeBackend = backends[activeId] ?? { kind: 'checking' };

  return (
    <div className="flex h-full flex-col" style={{ overscrollBehavior: 'none' }}>
      {/* タブバー（MC-119）: 3つのターミナルを切り替える。小画面でも横スクロールで押せる。 */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1.5">
        {TERMINAL_TABS.map((t) => {
          const isActive = t.id === activeId;
          const st = backends[t.id]?.kind ?? 'checking';
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              aria-pressed={isActive}
              style={{ touchAction: 'manipulation' }}
              className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-active/50 bg-active-bg text-active'
                  : 'border-border bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
              }`}
            >
              <TerminalIcon width={13} height={13} className="pointer-events-none" />
              {t.label}
              {/* 稼働状態ドット: ready=active色 / それ以外=muted。 */}
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${st === 'ready' ? 'bg-active' : 'bg-text-faint'}`}
              />
            </button>
          );
        })}
      </div>

      {/* ツールバー: 画像添付・出力・新しいタブで開く。補助機能はターミナル1のみ有効。 */}
      <div className="mb-2 shrink-0 border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
            id="terminal-images"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!assisted || state.kind === 'uploading' || staged.length >= MAX_IMAGES}
            title={assisted ? undefined : '画像添付はターミナル1でのみ利用できます。'}
            className="flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImageFileIcon width={13} height={13} />
            画像を選択
          </button>
          {staged.length > 0 && (
            <span className="text-[11px] text-text-faint">{staged.length} / {MAX_IMAGES}</span>
          )}
          <button
            type="button"
            onClick={() => setShowOutput(true)}
            disabled={!assisted}
            title={assisted ? undefined : '出力の取得はターミナル1でのみ利用できます。'}
            className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            出力を見る
          </button>
          <a
            href={activeId === 1 ? '/terminal-standalone' : activeTab.path}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            新しいタブで開く
          </a>
        </div>

        {/* ステージング中のサムネ一覧（ターミナル1 のみ表示される）。 */}
        {assisted && staged.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {staged.map((s) => (
              <div
                key={s.id}
                className="relative w-20 rounded-md border border-border bg-surface-2"
              >
                <img
                  src={s.url}
                  alt={s.file.name}
                  className="h-16 w-full rounded-t-md object-cover"
                />
                <button
                  type="button"
                  aria-label={`${s.file.name} を削除`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeStaged(s.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={state.kind === 'uploading'}
                  style={{ touchAction: 'manipulation' }}
                  className="absolute -right-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text shadow-sm hover:bg-surface-3 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CloseIcon width={14} height={14} className="pointer-events-none" />
                </button>
                <div
                  className="truncate rounded-b-md px-1 py-0.5 text-[9px] text-text-faint"
                  title={`${s.file.name}（${formatBytes(s.file.size)}）`}
                >
                  {formatBytes(s.file.size)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 送信アクション。 */}
        {assisted && staged.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void sendStaged()}
              disabled={state.kind === 'uploading' || staged.length === 0}
              className="flex items-center gap-2 rounded-lg border border-active/40 bg-active-bg px-3 py-1.5 text-xs font-medium text-active hover:bg-active/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.kind === 'uploading' ? (
                <>
                  <Spinner />
                  送信中…
                </>
              ) : (
                <>
                  <PlusIcon width={14} height={14} />
                  送る（{staged.length} 枚）
                </>
              )}
            </button>
          </div>
        )}

        {/* 結果フィードバック。 */}
        {assisted && state.kind === 'done' && (
          <div
            role="status"
            className="mt-2 flex items-start gap-2 rounded-md border border-active/40 bg-active-bg px-3 py-2 text-[11px] text-active"
          >
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => setState({ kind: 'idle' })}
              className="mt-0.5 shrink-0 text-active/70 hover:text-active"
            >
              <CloseIcon width={12} height={12} />
            </button>
            <span>
              {state.injected
                ? `追加しました`
                : `追加しました（パス: ${state.paths.join('  ')}）`}
            </span>
          </div>
        )}
        {assisted && state.kind === 'error' && (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-md border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-[11px]"
            style={{ color: 'var(--mc-stalled)' }}
          >
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => setState({ kind: 'idle' })}
              className="mt-0.5 shrink-0 opacity-70 hover:opacity-100"
            >
              <CloseIcon width={12} height={12} />
            </button>
            <span>{state.message}</span>
          </div>
        )}
      </div>

      {/* 端末本体: 3つの iframe を常時 mount し、アクティブ以外は CSS で非表示にして保持する。 */}
      <div className="relative flex-1 overflow-hidden bg-bg" style={{ overscrollBehavior: 'none' }}>
        {TERMINAL_TABS.map((t) => {
          const isActive = t.id === activeId;
          const st = backends[t.id] ?? { kind: 'checking' };
          return (
            <div
              key={t.id}
              // 非アクティブは hidden で非表示。iframe 自体は mount したまま＝セッション保持。
              className={`absolute inset-0 ${isActive ? '' : 'hidden'}`}
            >
              {st.kind === 'ready' ? (
                <iframe
                  key={iframeKeys[t.id]}
                  src={t.path}
                  title={`Apollo ${t.label}`}
                  className="h-full w-full border-0"
                  allow="clipboard-read; clipboard-write"
                  style={{ overscrollBehavior: 'none' }}
                />
              ) : (
                // バックエンド（ttyd / tmux main）が切断・未起動・確認中の状態パネル。
                <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                  {st.kind === 'checking' ? (
                    <div className="flex items-center gap-2 text-sm text-text-muted">
                      <Spinner />
                      ターミナルの状態を確認しています…
                    </div>
                  ) : (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted">
                        <TerminalIcon width={22} height={22} />
                      </div>
                      <div className="max-w-sm space-y-1">
                        <p className="text-sm font-medium text-text">
                          {t.label} が切断されています
                        </p>
                        <p className="text-xs text-text-muted">
                          端末サーバ（ttyd）が停止しています。「ターミナルを開始」で復旧できます。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void startBackend(t.id)}
                        disabled={st.kind === 'starting'}
                        className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {st.kind === 'starting' ? (
                          <>
                            <Spinner />
                            起動しています…
                          </>
                        ) : (
                          <>
                            <TerminalIcon width={15} height={15} />
                            ターミナルを開始
                          </>
                        )}
                      </button>
                      {st.kind === 'start-error' && (
                        <p role="alert" className="max-w-sm text-xs" style={{ color: 'var(--mc-stalled)' }}>
                          {st.message}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* キーバー開閉トグル（モバイル専用 / md 以上では非表示）。
            アクティブターミナルが ready かつ補助機能対象（=1）のときだけ出す。 */}
        {assisted && activeBackend.kind === 'ready' && (
          <button
            type="button"
            onClick={toggleKeybar}
            aria-label={keybarOpen ? 'キーバーを閉じる' : 'キーバーを開く'}
            aria-pressed={keybarOpen}
            title={keybarOpen ? 'キーバーを閉じる' : 'キーバーを開く'}
            style={{ touchAction: 'manipulation' }}
            className={`absolute bottom-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border shadow-md md:hidden ${
              keybarOpen
                ? 'border-active/50 bg-active-bg text-active'
                : 'border-border bg-surface/90 text-text-muted backdrop-blur hover:text-text'
            }`}
          >
            <KeyboardIcon width={20} height={20} />
          </button>
        )}
      </div>

      {/* モバイル専用 仮想キーバー（md 以上では非表示）。
          補助機能対象（ターミナル1）が ready のときだけ出す。送信先は tmux main。 */}
      {assisted && keybarOpen && activeBackend.kind === 'ready' && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border bg-surface px-2 py-2 md:hidden">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                sendText(keyInput);
                setKeyInput('');
              }
            }}
            placeholder="テキスト入力..."
            className="h-11 min-w-0 flex-1 rounded border border-border bg-surface-2 px-2.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-active/40"
          />

          <button
            type="button"
            onPointerDown={(e) => handleArrowPointerDown('up', e.pointerId)}
            onPointerUp={(e) => handleArrowPointerUp(e.pointerId)}
            onPointerLeave={(e) => handleArrowPointerUp(e.pointerId)}
            onPointerCancel={(e) => handleArrowPointerUp(e.pointerId)}
            aria-label="上"
            style={{ touchAction: 'none' }}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 text-base text-text active:bg-surface-3"
          >
            ↑
          </button>
          <button
            type="button"
            onPointerDown={(e) => handleArrowPointerDown('down', e.pointerId)}
            onPointerUp={(e) => handleArrowPointerUp(e.pointerId)}
            onPointerLeave={(e) => handleArrowPointerUp(e.pointerId)}
            onPointerCancel={(e) => handleArrowPointerUp(e.pointerId)}
            aria-label="下"
            style={{ touchAction: 'none' }}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 text-base text-text active:bg-surface-3"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => sendKey('Enter')}
            aria-label="Enter"
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 font-mono text-base text-text active:bg-surface-3"
          >
            ↵
          </button>
          <button
            type="button"
            onClick={() => sendKey('Escape')}
            aria-label="Escape"
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 text-xs text-text active:bg-surface-3"
          >
            Esc
          </button>
          <button
            type="button"
            onClick={() => {
              sendText(keyInput);
              setKeyInput('');
            }}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 text-xs text-text active:bg-surface-3"
          >
            送信
          </button>
        </div>
      )}
      {showOutput && <OutputModal onClose={() => setShowOutput(false)} />}
    </div>
  );
}
