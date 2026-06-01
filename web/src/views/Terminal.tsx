// ターミナル（MC-92 / MC-95）— Vultr 箱の tmux main（林 CLI 常駐）をブラウザから操作する。
//
// /terminal は Apollo サーバ側の reverse proxy ルート（→ localhost の ttyd）。
// 同一オリジンの iframe なので、認証 Cookie（mc_token）は自動付与され、未認証では
// サーバ側で弾かれる（HTTP・WS とも）。ttyd の Basic 認証は proxy が内部付与するため
// ここでは意識しない。フル操作（読み書き両方）に対応。
//
// モバイル: iframe は高さいっぱいに広げ、打鍵・閲覧できる。ttyd 自体がレスポンシブ。
//
// MC-95 画像添付:
//   iframe の上にツールバーをオーバーレイし、ファイル選択 / クリップボード貼付で画像を
//   POST /api/terminal/upload に送る。サーバが data/terminal-uploads/ に保存し、その
//   絶対パスを tmux main の入力欄へ send-keys でリテラル注入する（自動 Enter なし）。
//   林はそのパスを Read で画像として読める。Keita は注入されたパスを見て、続けて
//   メッセージを添えて Enter する。クリップボード読取は iframe 内ではなく Apollo SPA 側
//   （同一オリジン・secure context）で受けるため、HTTPS トンネル経由なら画像 Blob を取れる。

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ImageFileIcon, CloseIcon } from '../components/icons';

const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB / 枚

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; count: number; injected: boolean; paths: string[] }
  | { kind: 'error'; message: string };

export default function Terminal() {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 画像ファイル群を /api/terminal/upload へ送る。成功すると tmux main に
  // 保存パスが注入され、林の入力欄に絶対パス文字列が入る。
  const uploadFiles = useCallback(async (files: File[]) => {
    // クライアント側で MIME / サイズ / 枚数を先に弾いて無駄な往復を避ける。
    const images = files.filter((f) => ACCEPTED_MIME.includes(f.type));
    if (images.length === 0) {
      setState({ kind: 'error', message: '対応する画像（PNG / JPEG / WebP / GIF）が見つかりませんでした。' });
      return;
    }
    if (images.length > MAX_IMAGES) {
      setState({ kind: 'error', message: `画像は一度に最大 ${MAX_IMAGES} 枚までです。` });
      return;
    }
    const tooLarge = images.find((f) => f.size > MAX_BYTES);
    if (tooLarge) {
      setState({ kind: 'error', message: '各画像は 10MB までです。' });
      return;
    }

    setState({ kind: 'uploading' });
    try {
      const fd = new FormData();
      images.forEach((f) => {
        // スクショ等は名前が空のことがあるため拡張子付きの名前を補う。
        const named =
          f.name && f.name.trim() !== ''
            ? f
            : new File([f], `pasted-${Date.now()}.${(f.type.split('/')[1] || 'png')}`, {
                type: f.type,
              });
        fd.append('images', named, named.name);
      });
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
      setState({
        kind: 'done',
        count: body.count ?? images.length,
        injected: body.injected ?? false,
        paths: Array.isArray(body.paths) ? body.paths : [],
      });
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? `送信に失敗しました。${e.message}` : '送信に失敗しました。',
      });
    } finally {
      // 同じファイルを連続選択できるよう input をクリア。
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    void uploadFiles(Array.from(fileList));
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
        void uploadFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploadFiles]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="ターミナル"
        subtitle="tmux main（林セッション）をブラウザから操作します。読み書き両方に対応しています。"
        right={
          <a
            href="/terminal/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            新しいタブで開く
          </a>
        }
      />

      {/* 画像添付ツールバー（MC-95）。ファイル選択とクリップボード貼付で林に画像を渡す。 */}
      <div className="mb-2 rounded-lg border border-border bg-surface px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
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
            disabled={state.kind === 'uploading'}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImageFileIcon width={15} height={15} />
            画像を選択
          </button>
          <span className="text-[11px] text-text-faint">
            またはこの画面で Ctrl+V（Mac は ⌘+V）で画像を貼り付け
          </span>
          {state.kind === 'uploading' && (
            <span className="text-[11px] text-text-muted">送信中…</span>
          )}
        </div>

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
                ? `画像 ${state.count} 件を林の入力欄に追加しました（保存先パスを挿入済み）。下のターミナルに続けてメッセージを入力し、Enter で送信してください。`
                : `画像 ${state.count} 件を保存しましたが、入力欄への自動挿入に失敗しました。次のパスを手動で貼り付けてください: ${state.paths.join('  ')}`}
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

      <p className="px-1 pb-2 text-xs text-text-muted">
        コピー / 貼り付けは Ctrl+V（macOS は Cmd+V）で行えます。うまく貼り付けられない場合は、HTTPS
        で開くか、右上の「新しいタブで開く」をご利用ください。画像を貼り付け・選択すると、林の入力欄に画像の保存先パスが挿入されます（林はそのパスを画像として読み取れます）。
      </p>
      <div className="relative flex-1 overflow-hidden bg-bg">
        <iframe
          src="/terminal/"
          title="Apollo ターミナル"
          className="h-full w-full border-0"
          // ttyd は同一オリジン。スクリプト・WebSocket・クリップボードを許可する。
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
