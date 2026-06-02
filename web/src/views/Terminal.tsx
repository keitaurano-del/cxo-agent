// ターミナル（MC-92 / MC-95）— Vultr 箱の tmux main（林 CLI 常駐）をブラウザから操作する。
//
// /terminal は Apollo サーバ側の reverse proxy ルート（→ localhost の ttyd）。
// 同一オリジンの iframe なので、認証 Cookie（mc_token）は自動付与され、未認証では
// サーバ側で弾かれる（HTTP・WS とも）。ttyd の Basic 認証は proxy が内部付与するため
// ここでは意識しない。フル操作（読み書き両方）に対応。
//
// モバイル: iframe は高さいっぱいに広げ、打鍵・閲覧できる。ttyd 自体がレスポンシブ。
//
// MC-95 画像添付 / MC-102 ステージング化:
//   iframe の上にツールバーをオーバーレイし、ファイル選択 / クリップボード貼付で画像を
//   集める。MC-95 の「選択即送信」から「ステージング方式」へ拡張（MC-102）:
//   選んだ／貼り付けた画像はまずフロントの配列に貯め、サムネ（URL.createObjectURL）で
//   プレビューする。複数枚をまとめて確認・個別削除できる。「林に送る」を押すと、
//   ステージング中の全画像を一括で POST /api/terminal/upload に multipart 送信する。
//   サーバは data/terminal-uploads/ に保存し、その絶対パス群を tmux main の入力欄へ
//   send-keys でリテラル注入する（自動 Enter なし）。林はそのパスを Read で画像として
//   読める。Keita は注入されたパスを見て、続けてメッセージを添えて Enter する。
//   クリップボード読取は iframe 内ではなく Apollo SPA 側（同一オリジン・secure context）
//   で受けるため、HTTPS トンネル経由なら画像 Blob を取れる。
//   objectURL は unmount／削除／送信成功時に revoke してメモリリークを防ぐ。

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageFileIcon, CloseIcon, TerminalIcon, PlusIcon } from '../components/icons';
import { Spinner } from '../components/ui';

// ─── モバイル仮想キーバー用 API helper ───────────────────────
async function postSendKeys(keys: string): Promise<void> {
  try {
    await fetch('/api/terminal/send-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
  } catch {
    // 送信失敗はサイレント（ユーザーに見える形ではなく、ttyd 画面側で確認できる）
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

// ターミナルバックエンド（tmux main + ttyd）の稼働状態（MC-100）。
//   checking: 初回 status 取得中
//   ready:    両方稼働中＝iframe をそのまま表示
//   down:     切断/未起動＝「ターミナルを開始」ボタンを表示
//   starting: start API 実行中
//   start-error: start に失敗
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

// ─── ターミナル出力コピーボタン（MC-92 コピー改善）────────────
// /api/terminal/output?lines=100 を叩いてコンテンツを取得し、

export default function Terminal() {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── モバイル仮想キーバー（スマホ専用）──────────────────────
  const [keyInput, setKeyInput] = useState('');

  const sendKey = useCallback((key: string) => {
    void postSendKeys(key);
  }, []);

  const sendText = useCallback((text: string) => {
    if (text.length === 0) return;
    void postSendKeys(text);
  }, []);

  // ── 画像ステージング（MC-102）────────────────────────────
  // 選択/貼付した画像をここに貯め、サムネ表示する。送信は「林に送る」で一括。
  const [staged, setStaged] = useState<StagedImage[]>([]);
  // unmount 時に残存 objectURL を確実に revoke するため、最新 staged を ref で持つ。
  const stagedRef = useRef<StagedImage[]>([]);
  stagedRef.current = staged;
  useEffect(() => {
    return () => {
      for (const s of stagedRef.current) URL.revokeObjectURL(s.url);
    };
  }, []);

  // ── バックエンド復旧（MC-100）─────────────────────────────
  const [backend, setBackend] = useState<BackendState>({ kind: 'checking' });
  // iframe を強制リロードするための key。start 成功後にインクリメントして src を貼り直す。
  const [iframeKey, setIframeKey] = useState(0);
  // ポーリングが start 進行中のステータス上書きを避けるため、最新 kind を ref で持つ。
  const backendKindRef = useRef<BackendState['kind']>('checking');
  backendKindRef.current = backend.kind;

  // GET /api/terminal/status を叩いて ready/down を判定する。
  const refreshStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/terminal/status', { method: 'GET' });
      if (!res.ok) {
        // 認証切れ等。down 扱いにして「開始」ボタンを出す（再操作で復帰を促す）。
        setBackend({ kind: 'down' });
        return false;
      }
      const body = (await res.json()) as TerminalStatusResponse;
      const ready = Boolean(body.ready);
      setBackend(ready ? { kind: 'ready' } : { kind: 'down' });
      return ready;
    } catch {
      setBackend({ kind: 'down' });
      return false;
    }
  }, []);

  // POST /api/terminal/start でバックエンドを復旧 → 成功なら iframe をリロード。
  const startBackend = useCallback(async () => {
    setBackend({ kind: 'starting' });
    try {
      const res = await fetch('/api/terminal/start', { method: 'POST' });
      if (!res.ok) {
        let message = `起動に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // JSON でない場合は既定メッセージ。
        }
        setBackend({ kind: 'start-error', message });
        return;
      }
      // ttyd の listen が安定するまで少し待ってから状態を取り直す。
      await new Promise((r) => setTimeout(r, 800));
      const ready = await refreshStatus();
      if (ready) {
        // 切断中に張られていた iframe を貼り直して端末を再表示する。
        setIframeKey((k) => k + 1);
      }
    } catch (e) {
      setBackend({
        kind: 'start-error',
        message: e instanceof Error ? `起動に失敗しました。${e.message}` : '起動に失敗しました。',
      });
    }
  }, [refreshStatus]);

  // マウント時に状態確認、以降は定期ポーリングで切断を検知する。
  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => {
      // starting 中はポーリングしない（start 側が状態を握る）。
      if (backendKindRef.current === 'starting') return;
      void refreshStatus();
    }, 15000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  // 選択/貼付した画像をステージング配列に追加する（即送信しない）。
  // MIME / サイズをクライアント側で先に弾き、合計 5 枚上限を超える分は抑止する。
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
        // 追加できたら以前のエラー/結果表示は消す（ステージング中の状態に戻す）。
        setState({ kind: 'idle' });
      }
      const next = accepted.map((f, i) => {
        // スクショ等は名前が空のことがあるため拡張子付きの名前を補う。
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

  // ステージングから 1 枚削除し、その objectURL を revoke する。
  const removeStaged = useCallback((id: string) => {
    setStaged((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  // ステージング中の全画像を /api/terminal/upload へ一括送信する。
  // 成功すると tmux main に保存パス群が注入され、林の入力欄に絶対パス文字列が入る。
  const sendStaged = useCallback(async () => {
    const items = stagedRef.current;
    if (items.length === 0) return;
    setState({ kind: 'uploading' });
    try {
      const fd = new FormData();
      items.forEach((s) => fd.append('images', s.file, s.file.name));
      // Content-Type は指定しない（FormData が boundary 付きで自動設定）。
      // 認証 Cookie（mc_token）は同一オリジンなので自動付与される。
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
      // 送信成功 → ステージングをクリアし objectURL を revoke する。
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
    // 同じファイルを連続選択できるよう input をクリア。
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // クリップボード貼付（Ctrl+V / ⌘+V）。Apollo SPA 側（同一オリジン・secure context）で
  // paste を拾い、clipboardData.items から画像 Blob を取り出して送る。iframe 内の ttyd には
  // 流さず、この親ドキュメントで受ける。window レベルで購読し、どこにフォーカスがあっても拾う。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
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
  }, [addToStaging]);

  return (
    <div className="flex h-full flex-col">
      {/* ツールバー: 画像を選択 + 新しいタブで開く を一行に */}
      <div className="mb-2 border-b border-border bg-surface px-3 py-2">
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
            disabled={state.kind === 'uploading' || staged.length >= MAX_IMAGES}
            className="flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImageFileIcon width={13} height={13} />
            画像を選択
          </button>
          {staged.length > 0 && (
            <span className="text-[11px] text-text-faint">{staged.length} / {MAX_IMAGES}</span>
          )}
          <a
            href="/terminal-standalone"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            新しいタブで開く
          </a>
        </div>

        {/* ステージング中のサムネ一覧。横並び・モバイルでも折り返して崩れない。 */}
        {staged.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {staged.map((s) => (
              // 削除ボタンが角でクリップ/見切れないよう、コンテナ側は overflow-hidden にせず、
              // 画像だけ角丸クリップする（rounded は img 側に持たせる）。
              <div
                key={s.id}
                className="relative w-20 rounded-md border border-border bg-surface-2"
              >
                <img
                  src={s.url}
                  alt={s.file.name}
                  className="h-16 w-full rounded-t-md object-cover"
                />
                {/* 個別削除（×）。常時表示・タップしやすい 28px ヒット領域・高コントラストのバッジ。
                    モバイルのタップで確実に反応するよう touch-action: manipulation を付与し、
                    アイコン SVG は pointer-events-none にしてヒットを必ずボタン本体に集める。
                    クリック/タップが iframe など下層へ伝播しないよう stopPropagation。 */}
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

        {/* 送信アクション。ステージングが空のときは無効。 */}
        {staged.length > 0 && (
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
        {state.kind === 'done' && (
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
        {state.kind === 'error' && (
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

      <div className="relative flex-1 overflow-clip bg-bg">
        {backend.kind === 'ready' ? (
          <iframe
            key={iframeKey}
            src="/terminal/"
            title="Apollo ターミナル"
            className="h-full w-full border-0"
            // ttyd は同一オリジン。スクリプト・WebSocket・クリップボードを許可する。
            allow="clipboard-read; clipboard-write"
            style={{ touchAction: 'pan-y pinch-zoom' }}
          />
        ) : (
          // バックエンド（tmux main / ttyd）が切断・未起動・確認中のときの状態パネル（MC-100）。
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            {backend.kind === 'checking' ? (
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
                  <p className="text-sm font-medium text-text">ターミナルが切断されています</p>
                  <p className="text-xs text-text-muted">
                    tmux main（林セッション）または端末サーバ（ttyd）が停止しています。「ターミナルを開始」で復旧できます。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void startBackend()}
                  disabled={backend.kind === 'starting'}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {backend.kind === 'starting' ? (
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
                {backend.kind === 'start-error' && (
                  <p role="alert" className="max-w-sm text-xs" style={{ color: 'var(--mc-stalled)' }}>
                    {backend.message}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* モバイル専用 仮想キーバー（md 以上では非表示）。backend が ready のときのみ表示。 */}
      {backend.kind === 'ready' && (
        <div className="flex items-center gap-1.5 border-t border-border bg-surface px-2 py-2 md:hidden">
          {/* 矢印・特殊キー */}
          <button
            type="button"
            onClick={() => sendKey('Up')}
            className="rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text hover:bg-surface-3 active:bg-surface-3"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => sendKey('Down')}
            className="rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text hover:bg-surface-3 active:bg-surface-3"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => sendKey('Enter')}
            className="rounded border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-sm text-text hover:bg-surface-3 active:bg-surface-3"
          >
            ↵
          </button>
          <button
            type="button"
            onClick={() => sendKey('Escape')}
            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text hover:bg-surface-3 active:bg-surface-3"
          >
            Esc
          </button>

          {/* テキスト入力 + 送信 */}
          <input
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                sendText(keyInput);
                setKeyInput('');
              }
            }}
            placeholder="テキスト入力..."
            className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-active/40"
          />
          <button
            type="button"
            onClick={() => {
              sendText(keyInput);
              setKeyInput('');
            }}
            className="shrink-0 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text hover:bg-surface-3 active:bg-surface-3"
          >
            送信
          </button>
        </div>
      )}
    </div>
  );
}
