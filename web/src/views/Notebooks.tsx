// ノートブック（NotebookLM 的な資料セット＋資料根拠 Q&A＋生成物、MC-126）。
//
// 一覧画面: ノートブックの作成・選択・削除。
// 詳細画面: md+ は 3 ペイン（資料 / チャット / 生成物）、モバイルはタブ切替。
//   - 左 = 資料: アップロード（D&D＋選択、進捗バー）・一覧・プレビュー・削除。
//   - 中央 = チャット: 履歴（吹き出し）＋質問送信（claude が時間かかるのでローディング）。
//   - 右 = 生成物: 生成ボタン群（要約/FAQ/時系列/テンプレート/カスタム）＋生成物一覧。
//
// バックエンド API は全て auth 配下で Cookie mc_token が same-origin 自動付与される。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type {
  NotebookSummary,
  NotebookDetail,
  NotebookFileRef,
  NotebookSourceKind,
  NotebookChatMessage,
  NotebookAskResponse,
  NotebookGenerateKind,
  NotebookGenerateResponse,
  MinutesType,
  MinutesFormat,
  MinutesTypePreset,
  MinutesTemplate,
  MinutesPattern,
  MinutesPresetsResponse,
  MinutesTranscribeResponse,
  MinutesPatternsResponse,
  MinutesGenerateResponse,
} from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState, Spinner } from '../components/ui';
import {
  NotebookIcon,
  PlusIcon,
  TrashIcon,
  DownloadIcon,
  UploadIcon,
  EyeIcon,
  CloseIcon,
  SendIcon,
  SparkIcon,
  ChevronRightIcon,
  SheetIcon,
  SlidesIcon,
  PdfFileIcon,
  TextFileIcon,
  ImageFileIcon,
  FileIcon,
  FolderIcon,
  EditIcon,
} from '../components/icons';
import { relativeTime } from '../lib/time';

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const OFFICE_KINDS = new Set<NotebookSourceKind>(['spreadsheet', 'presentation', 'document']);
const CSV_EXT = '.csv';

function humanReadableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function KindIcon({ kind, ext }: { kind: NotebookSourceKind; ext: string }) {
  const props = { width: 18, height: 18 };
  if (kind === 'spreadsheet') return <SheetIcon {...props} />;
  if (kind === 'presentation') return <SlidesIcon {...props} />;
  if (kind === 'pdf') return <PdfFileIcon {...props} />;
  if (kind === 'image') return <ImageFileIcon {...props} />;
  if (kind === 'markdown' || kind === 'text') return <TextFileIcon {...props} />;
  if (kind === 'document') return <FileIcon {...props} />;
  if (IMG_EXTS.has(ext.toLowerCase())) return <ImageFileIcon {...props} />;
  return <FileIcon {...props} />;
}

function isImageFile(file: NotebookFileRef): boolean {
  return file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
}
function isOfficeFile(file: NotebookFileRef): boolean {
  return OFFICE_KINDS.has(file.kind) && file.ext.toLowerCase() !== CSV_EXT;
}
/** inline プレビュー（iframe / img）で見られるか。 */
function isPreviewable(file: NotebookFileRef): boolean {
  return (
    file.kind === 'pdf' ||
    file.kind === 'markdown' ||
    file.kind === 'text' ||
    isImageFile(file) ||
    isOfficeFile(file)
  );
}

function fileUrl(id: string, file: NotebookFileRef, inline: boolean): string {
  const q = inline ? '&inline=1' : '';
  return `/api/notebooks/${id}/file?path=${encodeURIComponent(file.relpath)}${q}`;
}

// ─── プレビューモーダル（PDF=iframe / Office=PDF変換iframe / 画像=img / text・md=iframe）──

function PreviewModal({
  id,
  file,
  onClose,
}: {
  id: string;
  file: NotebookFileRef;
  onClose: () => void;
}) {
  const src = fileUrl(id, file, true);
  const asImage = isImageFile(file);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg/90 p-2 backdrop-blur md:p-6"
      role="dialog"
      aria-modal
      aria-label={`${file.name} プレビュー`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-text" title={file.name}>
          {file.name}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
          aria-label="プレビューを閉じる"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>
      <div className="relative flex-1 overflow-auto rounded-lg border border-border bg-surface">
        {asImage ? (
          <div className="flex h-full items-center justify-center p-2">
            <img
              src={src}
              alt={file.name}
              className="max-h-full max-w-full rounded"
            />
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-faint">
              プレビューを生成しています…
            </div>
            <iframe
              src={src}
              title={`${file.name} プレビュー`}
              className="relative h-full w-full"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── アップロード（D&D ＋ 選択、進捗バー）──────────────────────────

function UploadPanel({ id, onUploaded }: { id: string; onUploaded: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const upload = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0 || uploading) return;
      setError(null);
      setMessage(null);
      setUploading(true);
      setProgress(0);

      const fd = new FormData();
      files.forEach((f) => {
        // webkitdirectory で選択したファイルは webkitRelativePath にパスが入る。
        // basename のみを使うことでサーバ側の sanitize と一致する（フラット保存）。
        const name = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        fd.append('files', f, name);
      });

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/notebooks/${id}/sources`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 201) {
          let count = files.length;
          try {
            const body = JSON.parse(xhr.responseText) as { added?: unknown[] };
            count = body.added?.length ?? files.length;
          } catch {
            /* parse 失敗時は送信件数。 */
          }
          setMessage(`${count} 件の資料を追加しました。`);
          onUploaded();
        } else {
          let msg = `アップロードに失敗しました（HTTP ${xhr.status}）。`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* 既定メッセージ。 */
          }
          setError(msg);
        }
      };
      xhr.onerror = () => {
        setUploading(false);
        setError('ネットワークエラーでアップロードに失敗しました。');
      };
      xhr.send(fd);
      if (inputRef.current) inputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    },
    [id, uploading, onUploaded],
  );

  return (
    <div className="mb-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading && e.dataTransfer.files.length > 0) upload(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-3 text-center transition-colors ${
          dragOver ? 'border-accent bg-surface-2' : 'border-border bg-surface'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) upload(e.target.files);
          }}
        />
        {/* webkitdirectory は非標準のため spread で型チェックを回避する */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) upload(e.target.files);
          }}
          {...({ webkitdirectory: '' } as React.HTMLAttributes<HTMLInputElement>)}
        />
        <span className="text-text-faint">
          <UploadIcon width={20} height={20} />
        </span>
        <p className="text-xs text-text-muted">資料をドラッグ＆ドロップ、または</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
          >
            <UploadIcon width={13} height={13} />
            資料を選択
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 border border-border px-3 py-1 text-xs font-semibold text-text transition-opacity disabled:opacity-50"
          >
            <FolderIcon width={13} height={13} />
            フォルダを選択
          </button>
        </div>
      </div>

      {uploading && (
        <div className="mt-2" role="status" aria-live="polite">
          <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
            <span>アップロード中…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {error}
        </div>
      )}
      {message && !error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--mc-active)' }}>
          {message}
        </p>
      )}
    </div>
  );
}

// ─── 資料ペイン ───────────────────────────────────────────

function SourceRow({
  id,
  file,
  onPreview,
  onDeleted,
}: {
  id: string;
  file: NotebookFileRef;
  onPreview: (file: NotebookFileRef) => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(() => {
    setDeleting(true);
    setError(null);
    fetch(`/api/notebooks/${id}/sources?name=${encodeURIComponent(file.name)}`, {
      method: 'DELETE',
    })
      .then(async (res) => {
        if (res.ok) {
          onDeleted();
          return;
        }
        let msg = `削除に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* 既定メッセージ。 */
        }
        setError(msg);
        setDeleting(false);
        setConfirming(false);
      })
      .catch(() => {
        setError('ネットワークエラーで削除に失敗しました。');
        setDeleting(false);
        setConfirming(false);
      });
  }, [id, file.name, onDeleted]);

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-text-faint">
            <KindIcon kind={file.kind} ext={file.ext} />
          </span>
          <span className="truncate text-sm text-text" title={file.name}>
            {file.name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isPreviewable(file) && (
            <button
              type="button"
              onClick={() => onPreview(file)}
              className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
              aria-label={`${file.name} をプレビュー`}
            >
              <EyeIcon width={15} height={15} />
            </button>
          )}
          <a
            href={fileUrl(id, file, false)}
            download={file.name}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} をダウンロード`}
          >
            <DownloadIcon width={15} height={15} />
          </a>
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} を削除`}
          >
            <TrashIcon width={15} height={15} />
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-text-faint">
        <span>{humanReadableSize(file.sizeBytes)}</span>
        {file.extracted === false && <span title="テキスト抽出なし">抽出なし</span>}
      </div>

      {confirming && (
        <div className="mt-2 rounded-lg border border-border bg-surface-2 p-2.5" role="alertdialog" aria-label="削除の確認">
          <p className="text-xs text-text">
            <span className="font-medium" title={file.name}>
              {file.name}
            </span>{' '}
            を削除しますか？
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded-full px-3 py-1 text-xs text-text-muted hover:bg-surface-3 hover:text-text disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
              style={{ backgroundColor: 'var(--mc-stalled)' }}
            >
              <TrashIcon width={12} height={12} />
              {deleting ? '削除中…' : '削除する'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-2.5 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

function SourcesPane({
  id,
  sources,
  onChanged,
  onPreview,
}: {
  id: string;
  sources: NotebookFileRef[];
  onChanged: () => void;
  onPreview: (file: NotebookFileRef) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        資料 <span className="ml-1 text-text-muted">{sources.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <UploadPanel id={id} onUploaded={onChanged} />
        {sources.length === 0 ? (
          <EmptyState>資料をアップロードすると、ここに表示されます</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {sources.map((f) => (
              <SourceRow key={f.relpath} id={id} file={f} onPreview={onPreview} onDeleted={onChanged} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ファイルビューア（引用クリックで開くスライドオーバー）──────────────

interface FileViewerState {
  notebookId: string;
  filename: string; // ファイル名のみ（"sources/" なし）
  page?: string;    // ページ番号またはシート名
}

/** 認証が必要なファイルを Blob URL 経由で iframe に渡すビューア。 */
function NotebookFileViewer({
  notebookId,
  filename,
  page,
  onClose,
}: FileViewerState & { onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);

    const apiPath = `/api/notebooks/${notebookId}/file?path=${encodeURIComponent('sources/' + filename)}&inline=1`;
    fetch(apiPath)
      .then(async (res) => {
        if (!res.ok) {
          const msg = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(msg);
        }
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        // PDF の場合はページフラグメントを付与する。
        const withPage = page ? `${objectUrl}#page=${encodeURIComponent(page)}` : objectUrl;
        setBlobUrl(withPage);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [notebookId, filename, page]);

  const displayName = page ? `${filename}  p.${page}` : filename;

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-bg shadow-2xl md:w-2/3 lg:w-1/2"
      role="dialog"
      aria-modal
      aria-label={`${displayName} ビューア`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="truncate text-sm font-medium text-text" title={displayName}>
          {displayName}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
          aria-label="ビューアを閉じる"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">
            <Spinner />
            <span className="ml-2">読み込み中…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-sm" style={{ color: 'var(--mc-stalled)' }}>
            ファイルの読み込みに失敗しました: {error}
          </div>
        )}
        {blobUrl && (
          <iframe
            src={blobUrl}
            title={displayName}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  );
}

// ─── 引用タグパーサ ───────────────────────────────────────

interface CitePart {
  type: 'text' | 'cite';
  text: string;
  filename?: string;
  page?: string;
}

/** テキスト中の {{cite:filename:page}} を解析して parts に分解する。 */
function parseCites(text: string): CitePart[] {
  const parts: CitePart[] = [];
  // {{cite:filename}} または {{cite:filename:page}} にマッチ。
  const re = /\{\{cite:([^}:]+?)(?::([^}]*))?\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', text: text.slice(last, m.index) });
    }
    parts.push({
      type: 'cite',
      text: m[0],
      filename: m[1],
      page: m[2] || undefined,
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'text', text: text.slice(last) });
  }
  return parts;
}

// ─── チャットペイン ───────────────────────────────────────

function ChatBubble({
  msg,
  onCite,
}: {
  msg: NotebookChatMessage;
  onCite?: (filename: string, page?: string) => void;
}) {
  const isUser = msg.role === 'user';
  const parts = isUser ? null : parseCites(msg.text);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${
          isUser ? 'rounded-br-sm bg-accent text-bg' : 'rounded-bl-sm bg-surface-2 text-text'
        }`}
      >
        {isUser || !parts ? (
          <span className="whitespace-pre-wrap">{msg.text}</span>
        ) : (
          <span className="whitespace-pre-wrap">
            {parts.map((p, i) => {
              if (p.type === 'text') return <span key={i}>{p.text}</span>;
              const label = p.page ? `${p.filename} p.${p.page}` : p.filename!;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onCite?.(p.filename!, p.page)}
                  className="mx-0.5 inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                  title={`${label} を開く`}
                >
                  {label}
                </button>
              );
            })}
          </span>
        )}
      </div>
    </div>
  );
}

function ChatPane({
  id,
  chat,
  hasSources,
  onAnswered,
}: {
  id: string;
  chat: NotebookChatMessage[];
  hasSources: boolean;
  onAnswered: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 楽観追加した自分の質問（送信中に即表示）。
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  // 離脱後復帰時: 最後の user メッセージに応答がない状態を検出してポーリング。
  const [pendingAnswer, setPendingAnswer] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 引用ビューア状態。
  const [viewer, setViewer] = useState<FileViewerState | null>(null);

  const handleCite = useCallback((filename: string, page?: string) => {
    setViewer({ notebookId: id, filename, page });
  }, [id]);

  // chat が更新されたとき、最後が user で assistant 応答がまだなら pendingAnswer をセット。
  useEffect(() => {
    const last = chat.at(-1);
    if (last && last.role === 'user' && !asking) {
      setPendingAnswer(true);
    } else {
      setPendingAnswer(false);
    }
  }, [chat, asking]);

  // pendingAnswer の間、3秒ごとに詳細取得してチャットを更新。
  useEffect(() => {
    if (!pendingAnswer) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    pollingRef.current = setInterval(() => {
      fetch(`/api/notebooks/${id}`)
        .then((res) => res.json().catch(() => null))
        .then((data: { chat?: NotebookChatMessage[] } | null) => {
          if (!data) return;
          const msgs = data.chat ?? [];
          const last = msgs.at(-1);
          if (last && last.role === 'assistant') {
            // 新しい assistant 応答が来た → 親を更新してポーリング停止。
            onAnswered();
            setPendingAnswer(false);
          }
        })
        .catch(() => { /* ネットワーク一時エラーは無視してリトライ */ });
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [pendingAnswer, id, onAnswered]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, asking, pendingQuestion, pendingAnswer]);

  const submit = useCallback(() => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    setPendingQuestion(q);
    setQuestion('');
    fetch(`/api/notebooks/${id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as NotebookAskResponse;
        if (!res.ok) {
          setError(body.error || `回答の取得に失敗しました（HTTP ${res.status}）。`);
        } else if (body.error && !body.answer) {
          setError(body.error);
        } else if (body.error) {
          // 部分劣化（タイムアウト等で部分回答あり）。
          setError('回答が途中で打ち切られた可能性があります。');
        }
        // chat は ask 後にサーバへ user/assistant 両方記録済み。再取得して反映。
        onAnswered();
      })
      .catch(() => {
        setError('ネットワークエラーで回答を取得できませんでした。');
      })
      .finally(() => {
        setAsking(false);
        setPendingQuestion(null);
      });
  }, [id, question, asking, onAnswered]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        チャット
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {chat.length === 0 && !pendingQuestion ? (
          <EmptyState>
            {hasSources
              ? '資料について質問できます。回答は資料を根拠に生成されます。'
              : 'まず資料をアップロードすると、その内容について質問できます。'}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-2.5">
            {chat.map((m, i) => (
              <ChatBubble key={`${m.ts}-${i}`} msg={m} onCite={handleCite} />
            ))}
            {/* 送信中の楽観追加（chat に未反映の自分の質問）。 */}
            {pendingQuestion && (
              <ChatBubble msg={{ ts: '', role: 'user', text: pendingQuestion }} />
            )}
            {asking && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-text-muted">
                  <Spinner />
                  資料を読んでいます…
                </div>
              </div>
            )}
            {/* 離脱後復帰時: 未受信の assistant 応答を待機中 */}
            {!asking && pendingAnswer && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-text-muted">
                  <Spinner />
                  回答を生成中…
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {error && (
        <div role="alert" className="mx-3 mb-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
          {error}
        </div>
      )}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={asking}
            rows={2}
            placeholder="資料について質問する…"
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={submit}
            disabled={asking || question.trim() === ''}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-bg transition-opacity disabled:opacity-40"
            aria-label="質問を送信"
          >
            {asking ? <Spinner /> : <SendIcon width={18} height={18} />}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-text-faint">回答には時間がかかる場合があります（⌘/Ctrl + Enter で送信）。</p>
      </div>
      {viewer && (
        <NotebookFileViewer
          notebookId={viewer.notebookId}
          filename={viewer.filename}
          page={viewer.page}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

// ─── 生成物ペイン ─────────────────────────────────────────

const GENERATE_BUTTONS: { kind: NotebookGenerateKind; label: string }[] = [
  { kind: 'summary', label: '要約' },
  { kind: 'faq', label: 'FAQ' },
  { kind: 'timeline', label: '時系列' },
  { kind: 'template', label: 'テンプレート' },
  { kind: 'template_extract', label: 'テンプレート抽出' },
  { kind: 'custom', label: 'カスタム' },
];

// テンプレートで指定できる出力形式。
const TEMPLATE_FORMATS = ['指定なし', 'xlsx', 'docx', 'pptx', 'md'];

function ArtifactRow({
  id,
  file,
  onPreview,
}: {
  id: string;
  file: NotebookFileRef;
  onPreview: (file: NotebookFileRef) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-text-faint">
          <KindIcon kind={file.kind} ext={file.ext} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm text-text" title={file.name}>
            {file.name}
          </div>
          <div className="text-[11px] text-text-faint">{humanReadableSize(file.sizeBytes)}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {isPreviewable(file) && (
          <button
            type="button"
            onClick={() => onPreview(file)}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} をプレビュー`}
          >
            <EyeIcon width={15} height={15} />
          </button>
        )}
        <a
          href={fileUrl(id, file, false)}
          download={file.name}
          className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
          aria-label={`${file.name} をダウンロード`}
        >
          <DownloadIcon width={15} height={15} />
        </a>
      </div>
    </div>
  );
}

function ArtifactsPane({
  id,
  artifacts,
  hasSources,
  onGenerated,
  onPreview,
}: {
  id: string;
  artifacts: NotebookFileRef[];
  hasSources: boolean;
  onGenerated: () => void;
  onPreview: (file: NotebookFileRef) => void;
}) {
  const [activeKind, setActiveKind] = useState<NotebookGenerateKind | null>(null);
  const [instruction, setInstruction] = useState('');
  const [templateFormat, setTemplateFormat] = useState(TEMPLATE_FORMATS[0]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [genPct, setGenPct] = useState<number>(0);
  // 離脱後復帰時: 生成リクエスト送信後に HTTP 接続が切れても artifacts 増加をポーリングで検出。
  const [generatingKind, setGeneratingKind] = useState<NotebookGenerateKind | null>(null);
  const artifactPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ポーリング開始時点の artifacts 件数を記憶して増加を検出する。
  const artifactBaseCount = useRef<number>(0);

  // 生成中に実際の progress イベントが来ない間、時間ベースで擬似進捗を増やす。
  // SSH ラッパー経由の場合 chunk が逐次来ないため、sqrt カーブで最大95%まで自動増加。
  // 実際の progress イベントや done イベントが来た時点でそちらが上書きする。
  useEffect(() => {
    if (!generating) return;
    const start = Date.now();
    const EXPECTED_MS = 120_000; // 想定 2 分
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(95, Math.round(Math.sqrt(elapsed / EXPECTED_MS) * 95));
      setGenPct((prev) => Math.max(prev, pct));
    }, 1000);
    return () => clearInterval(timer);
  }, [generating]);

  // generatingKind がセットされたら 3 秒ごとに artifacts 件数を確認。
  useEffect(() => {
    if (!generatingKind) {
      if (artifactPollingRef.current) {
        clearInterval(artifactPollingRef.current);
        artifactPollingRef.current = null;
      }
      return;
    }
    artifactBaseCount.current = artifacts.length;
    artifactPollingRef.current = setInterval(() => {
      fetch(`/api/notebooks/${id}`)
        .then((res) => res.json().catch(() => null))
        .then((data: { artifacts?: NotebookFileRef[] } | null) => {
          if (!data) return;
          const count = data.artifacts?.length ?? 0;
          if (count > artifactBaseCount.current) {
            // 新しい生成物が増えた → 親を更新してポーリング停止。
            onGenerated();
            setGeneratingKind(null);
            setGenerating(false);
          }
        })
        .catch(() => { /* ネットワーク一時エラーは無視してリトライ */ });
    }, 3000);

    return () => {
      if (artifactPollingRef.current) {
        clearInterval(artifactPollingRef.current);
        artifactPollingRef.current = null;
      }
    };
  }, [generatingKind, id, artifacts.length, onGenerated]);

  const needsInstruction = activeKind === 'custom';
  const showInstruction = activeKind === 'custom' || activeKind === 'template' || activeKind === 'template_extract';

  const run = useCallback(() => {
    if (!activeKind || generating) return;
    if (needsInstruction && instruction.trim() === '') {
      setError('カスタムは指示を入力してください。');
      return;
    }
    setGenerating(true);
    setError(null);
    setReport(null);

    // テンプレート系は出力形式の指定を instruction に織り込む。
    let instr = instruction.trim();
    if ((activeKind === 'template' || activeKind === 'template_extract') && templateFormat !== TEMPLATE_FORMATS[0]) {
      const fmt = `出力形式は ${templateFormat} で作成してください。`;
      instr = instr ? `${fmt} ${instr}` : fmt;
    }

    const requestedKind = activeKind;
    setGenPct(0);

    // SSE ストリームで進捗を受け取る。
    const ctrl = new AbortController();
    fetch(`/api/notebooks/${id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ kind: activeKind, instruction: instr || undefined }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as NotebookGenerateResponse;
          setError(body.error || `生成に失敗しました（HTTP ${res.status}）。`);
          setGenerating(false);
          setGeneratingKind(null);
          return;
        }
        // SSE を行単位でパースして進捗・完了を処理。
        const reader = res.body?.getReader();
        if (!reader) throw new Error('no body');
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let evt: { type?: string; pct?: number; ok?: boolean; created?: unknown[]; report?: string; error?: string } = {};
            try { evt = JSON.parse(line.slice(6)) as typeof evt; } catch { continue; }
            if (evt.type === 'progress' && typeof evt.pct === 'number') {
              setGenPct(evt.pct);
            } else if (evt.type === 'done') {
              setGenPct(100);
              if (!evt.ok) {
                setError(evt.error || '生成物を作成できませんでした。資料が十分か確認してください。');
              } else {
                const created = evt.created?.length ?? 0;
                setReport(created > 0 ? `${created} 件の生成物を作成しました。` : (evt.report || '生成が完了しました。'));
                setInstruction('');
              }
              onGenerated();
              setGeneratingKind(null);
              setGenerating(false);
            }
          }
        }
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        // HTTP 切断（離脱後復帰のケース）: generating 状態を維持してポーリングに委ねる。
        setGeneratingKind(requestedKind);
      });
  }, [id, activeKind, instruction, templateFormat, needsInstruction, generating, onGenerated]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        生成物 <span className="ml-1 text-text-muted">{artifacts.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-3 rounded-lg border border-border bg-surface p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {GENERATE_BUTTONS.map((b) => (
              <button
                key={b.kind}
                type="button"
                onClick={() => {
                  setActiveKind((prev) => (prev === b.kind ? null : b.kind));
                  setError(null);
                  setReport(null);
                }}
                disabled={generating}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
                  activeKind === b.kind
                    ? 'bg-accent font-semibold text-bg'
                    : 'bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
                }`}
              >
                <SparkIcon width={12} height={12} />
                {b.label}
              </button>
            ))}
          </div>

          {(activeKind === 'template' || activeKind === 'template_extract') && (
            <div className="mb-2">
              {activeKind === 'template_extract' && (
                <p className="mb-2 text-[11px] text-text-faint">
                  資料の構造・書き方を分析し、各セクションに「目的」「書くべき内容」「書き方のコツ」を添えた学習ガイド付きテンプレートを生成します。
                </p>
              )}
              <label className="mb-1 block text-[11px] text-text-faint">出力形式</label>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_FORMATS.map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setTemplateFormat(fmt)}
                    disabled={generating}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                      templateFormat === fmt
                        ? 'bg-surface-3 font-semibold text-text'
                        : 'bg-surface-2 text-text-muted hover:text-text'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showInstruction && (
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={generating}
              rows={2}
              placeholder={
                activeKind === 'custom'
                  ? '作成してほしい内容を指示してください（必須）…'
                  : activeKind === 'template_extract'
                  ? '用途（例: 会議議事録、企画書、週次レポート）や要望があれば入力（任意）…'
                  : '雛形の追加要望があれば入力（任意）…'
              }
              className="mb-2 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
            />
          )}

          {activeKind && (
            <button
              type="button"
              onClick={run}
              disabled={generating || !!generatingKind || !hasSources}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity disabled:opacity-40"
            >
              {(generating || generatingKind) ? (
                <>
                  <Spinner />
                  生成しています…
                </>
              ) : (
                <>
                  <SparkIcon width={15} height={15} />
                  生成する
                </>
              )}
            </button>
          )}
          {!hasSources && activeKind && (
            <p className="mt-1.5 text-[11px] text-text-faint">資料を追加すると生成できます。</p>
          )}
          {(generating || generatingKind) && (
            <div className="mt-2" role="status" aria-live="polite">
              <div className="mb-1 flex items-center justify-between text-[11px] text-text-muted">
                <span>資料を読み込んでいます…</span>
                <span>{genPct}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-1 rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: `${genPct}%` }}
                />
              </div>
            </div>
          )}
          {error && (
            <div role="alert" className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
              {error}
            </div>
          )}
          {report && !error && (
            <p className="mt-2 text-xs" style={{ color: 'var(--mc-active)' }}>
              {report}
            </p>
          )}
        </div>

        {artifacts.length === 0 ? (
          <EmptyState>生成ボタンから要約や FAQ などを作成できます</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {artifacts.map((f) => (
              <ArtifactRow key={f.relpath} id={id} file={f} onPreview={onPreview} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 議事録ペイン ─────────────────────────────────────────

function MinutesPane({
  id,
  onGenerated,
}: {
  id: string;
  onGenerated: () => void;
}) {
  const [presets, setPresets] = useState<MinutesPresetsResponse | null>(null);
  const [patterns, setPatterns] = useState<MinutesPattern[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [inputMode, setInputMode] = useState<'text' | 'audio'>('text');
  const [inputText, setInputText] = useState('');
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<MinutesType>('decisions');
  const [selectedFormat, setSelectedFormat] = useState<MinutesFormat>('sections');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedPatternId, setSelectedPatternId] = useState<string>('');
  const [patternName, setPatternName] = useState('');
  const [savingPattern, setSavingPattern] = useState(false);
  const [savePatternError, setSavePatternError] = useState<string | null>(null);
  const [showPatternSave, setShowPatternSave] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genPct, setGenPct] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [genReport, setGenReport] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/notebooks/minutes/presets')
      .then((r) => r.json().catch(() => null))
      .then((data: MinutesPresetsResponse | null) => {
        if (data) setPresets(data);
        setLoadingPresets(false);
      })
      .catch(() => setLoadingPresets(false));
    fetch('/api/notebooks/minutes/patterns')
      .then((r) => r.json().catch(() => null))
      .then((data: MinutesPatternsResponse | null) => {
        if (data?.patterns) setPatterns(data.patterns);
      })
      .catch(() => {});
  }, []);

  const applyPattern = useCallback(
    (patId: string) => {
      setSelectedPatternId(patId);
      if (!patId) return;
      const pat = patterns.find((p) => p.id === patId);
      if (!pat) return;
      setSelectedType(pat.type as MinutesType);
      setSelectedFormat(pat.format as MinutesFormat);
      if (pat.instructions) setCustomInstructions(pat.instructions);
    },
    [patterns],
  );

  useEffect(() => {
    const preset = presets?.types.find((t) => t.type === selectedType);
    setSelectedTemplateId(preset?.templates[0]?.id ?? '');
  }, [selectedType, presets]);

  const handleAudioFile = useCallback(
    (file: File) => {
      setTranscribing(true);
      setTranscribeError(null);
      const fd = new FormData();
      fd.append('audio', file);
      fetch('/api/notebooks/' + id + '/minutes/transcribe', { method: 'POST', body: fd })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as MinutesTranscribeResponse;
          if (res.ok && body.text) {
            setInputText(body.text);
            setInputMode('text');
          } else {
            setTranscribeError(body.error || '文字起こしに失敗しました。');
          }
        })
        .catch(() => setTranscribeError('ネットワークエラーで文字起こしに失敗しました。'))
        .finally(() => setTranscribing(false));
    },
    [id],
  );

  const generate = useCallback(() => {
    if (!inputText.trim() || generating) return;
    setGenerating(true);
    setGenError(null);
    setGenReport(null);
    setGenPct(0);
    const preset = presets?.types.find((t) => t.type === selectedType);
    const tmpl = preset?.templates.find((t) => t.id === selectedTemplateId);
    fetch('/api/notebooks/' + id + '/minutes/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        inputText: inputText.trim(),
        type: selectedType,
        format: selectedFormat,
        templateId: selectedTemplateId || undefined,
        templateBody: tmpl?.body || undefined,
        customInstructions: customInstructions.trim() || undefined,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as MinutesGenerateResponse;
          setGenError(body.error || '生成に失敗しました（HTTP ' + String(res.status) + '）。');
          setGenerating(false);
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error('no body');
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
            let evt: {
              type?: string;
              pct?: number;
              ok?: boolean;
              created?: unknown[];
              report?: string;
              error?: string;
            } = {};
            try {
              evt = JSON.parse(line.slice(6)) as typeof evt;
            } catch {
              continue;
            }
            if (evt.type === 'progress' && typeof evt.pct === 'number') {
              setGenPct(evt.pct);
            } else if (evt.type === 'done') {
              setGenPct(100);
              if (!evt.ok) {
                setGenError(evt.error || '議事録を作成できませんでした。');
              } else {
                const n = evt.created?.length ?? 0;
                setGenReport(
                  n > 0
                    ? String(n) + ' 件の議事録を作成しました。'
                    : evt.report || '完了しました。',
                );
              }
              onGenerated();
              setGenerating(false);
            }
          }
        }
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setGenError('ネットワークエラーで議事録を生成できませんでした。');
        setGenerating(false);
      });
  }, [id, inputText, selectedType, selectedFormat, selectedTemplateId, customInstructions, presets, generating, onGenerated]);

  const savePattern = useCallback(() => {
    if (!patternName.trim() || savingPattern) return;
    setSavingPattern(true);
    setSavePatternError(null);
    const preset = presets?.types.find((t) => t.type === selectedType);
    const tmpl = preset?.templates.find((t) => t.id === selectedTemplateId);
    fetch('/api/notebooks/minutes/patterns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: patternName.trim(),
        type: selectedType,
        format: selectedFormat,
        templateId: selectedTemplateId || undefined,
        templateBody: tmpl?.body || undefined,
        instructions: customInstructions.trim() || undefined,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const pat = (await res.json()) as MinutesPattern;
          setPatterns((prev) => [pat, ...prev]);
          setPatternName('');
          setShowPatternSave(false);
        } else {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setSavePatternError(body.error || '保存に失敗しました。');
        }
      })
      .catch(() => setSavePatternError('ネットワークエラーで保存に失敗しました。'))
      .finally(() => setSavingPattern(false));
  }, [patternName, selectedType, selectedFormat, selectedTemplateId, customInstructions, presets, savingPattern]);

  const currentTemplates: MinutesTemplate[] =
    (presets?.types.find((t: MinutesTypePreset) => t.type === selectedType)?.templates) ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        議事録
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">
          {patterns.length > 0 && (
            <div>
              <label className="mb-1 block text-[11px] text-text-faint">保存済みパターン</label>
              <select
                value={selectedPatternId}
                onChange={(e) => applyPattern(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text focus:border-accent focus:outline-none"
              >
                <option value="">パターンを選択…</option>
                {patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => setInputMode('text')}
                className={
                  'rounded-full px-3 py-1 text-xs transition-colors ' +
                  (inputMode === 'text'
                    ? 'bg-accent font-semibold text-bg'
                    : 'bg-surface-2 text-text-muted hover:text-text')
                }
              >
                テキスト入力
              </button>
              <button
                type="button"
                onClick={() => setInputMode('audio')}
                className={
                  'rounded-full px-3 py-1 text-xs transition-colors ' +
                  (inputMode === 'audio'
                    ? 'bg-accent font-semibold text-bg'
                    : 'bg-surface-2 text-text-muted hover:text-text')
                }
              >
                音声入力
              </button>
            </div>

            {inputMode === 'audio' ? (
              <div className="rounded-lg border border-dashed border-border bg-surface p-3 text-center">
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleAudioFile(f);
                    if (audioInputRef.current) audioInputRef.current.value = '';
                  }}
                />
                <p className="mb-2 text-xs text-text-muted">mp3 / m4a / wav / webm に対応</p>
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={transcribing}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
                >
                  {transcribing ? (
                    <>
                      <Spinner />
                      文字起こし中…
                    </>
                  ) : (
                    '音声ファイルを選択'
                  )}
                </button>
                {transcribeError && (
                  <div
                    role="alert"
                    className="mt-2 text-xs"
                    style={{ color: 'var(--mc-stalled)' }}
                  >
                    {transcribeError}
                  </div>
                )}
                {inputText && (
                  <p className="mt-2 text-xs text-text-faint">
                    文字起こし完了。テキスト入力モードで確認・編集できます。
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={generating}
                rows={6}
                placeholder="文字起こし済みテキストや議事メモを貼り付けてください…"
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
              />
            )}
          </div>

          {!loadingPresets && presets && (
            <>
              <div>
                <label className="mb-1 block text-[11px] text-text-faint">種類</label>
                <div className="flex flex-wrap gap-1.5">
                  {presets.types.map((t) => (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => {
                        setSelectedType(t.type);
                        setSelectedPatternId('');
                      }}
                      disabled={generating}
                      title={t.description}
                      className={
                        'rounded-full px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50 ' +
                        (selectedType === t.type
                          ? 'bg-accent font-semibold text-bg'
                          : 'bg-surface-2 text-text-muted hover:text-text')
                      }
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {currentTemplates.length > 1 && (
                <div>
                  <label className="mb-1 block text-[11px] text-text-faint">テンプレート</label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    disabled={generating}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text focus:border-accent focus:outline-none disabled:opacity-60"
                  >
                    {currentTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-[11px] text-text-faint">出力形式</label>
                <div className="flex flex-wrap gap-1.5">
                  {presets.formats.map((f) => (
                    <button
                      key={f.format}
                      type="button"
                      onClick={() => {
                        setSelectedFormat(f.format);
                        setSelectedPatternId('');
                      }}
                      disabled={generating}
                      className={
                        'rounded-full px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50 ' +
                        (selectedFormat === f.format
                          ? 'bg-accent font-semibold text-bg'
                          : 'bg-surface-2 text-text-muted hover:text-text')
                      }
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-[11px] text-text-faint">追加指示（任意）</label>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              disabled={generating}
              rows={2}
              placeholder="例: 参加者名を敬称付きで記載してください…"
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
            />
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={generating || !inputText.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity disabled:opacity-40"
          >
            {generating ? (
              <>
                <Spinner />
                議事録を生成中…
              </>
            ) : (
              <>
                <SparkIcon width={15} height={15} />
                議事録を生成
              </>
            )}
          </button>
          {!inputText.trim() && (
            <p className="text-[11px] text-text-faint">
              テキストを入力または音声をアップロードすると生成できます。
            </p>
          )}

          {generating && (
            <div role="status" aria-live="polite">
              <div className="mb-1 flex justify-between text-[11px] text-text-muted">
                <span>生成しています…</span>
                <span>{genPct}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-1 rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: String(genPct) + '%' }}
                />
              </div>
            </div>
          )}
          {genError && (
            <div
              role="alert"
              className="rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
              style={{ color: 'var(--mc-stalled)' }}
            >
              {genError}
            </div>
          )}
          {genReport && !genError && (
            <p className="text-xs" style={{ color: 'var(--mc-active)' }}>
              {genReport}
            </p>
          )}

          <div className="border-t border-border pt-3">
            {!showPatternSave ? (
              <button
                type="button"
                onClick={() => setShowPatternSave(true)}
                className="text-xs text-text-faint hover:text-text"
              >
                + 現在の設定をパターンとして保存
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-text-faint">
                  現在の設定（種類・テンプレート・形式・追加指示）を保存します
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={patternName}
                    onChange={(e) => setPatternName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        savePattern();
                      }
                    }}
                    placeholder="パターン名…"
                    className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={savePattern}
                    disabled={savingPattern || !patternName.trim()}
                    className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
                  >
                    {savingPattern ? '保存中…' : '保存'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPatternSave(false);
                      setSavePatternError(null);
                    }}
                    className="rounded-full px-2 py-1 text-xs text-text-muted hover:text-text"
                  >
                    キャンセル
                  </button>
                </div>
                {savePatternError && (
                  <p className="text-[11px]" style={{ color: 'var(--mc-stalled)' }}>
                    {savePatternError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 詳細画面（3 ペイン / モバイルはタブ）────────────────────────

type DetailTab = 'sources' | 'chat' | 'artifacts' | 'minutes';

function NotebookDetailView({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const { data, error, loading, refetch } = useLiveResource<NotebookDetail>(`/api/notebooks/${id}`);
  const [tab, setTab] = useState<DetailTab>('sources');
  const [preview, setPreview] = useState<NotebookFileRef | null>(null);

  // インライン名称編集
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const detail = data && data.meta ? data : null;
  const sources = detail?.sources ?? [];
  const artifacts = detail?.artifacts ?? [];
  const chat = detail?.chat ?? [];
  const hasSources = sources.length > 0;

  const startEditing = useCallback(() => {
    setNameInput(detail?.meta.name ?? '');
    setRenameError(null);
    setEditingName(true);
  }, [detail]);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  const commitRename = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setRenameError('名前を入力してください。');
      return;
    }
    if (trimmed === detail?.meta.name) {
      setEditingName(false);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    fetch(`/api/notebooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
      .then(async (res) => {
        if (res.ok) {
          setEditingName(false);
          refetch();
        } else {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setRenameError(body.error || `リネームに失敗しました（HTTP ${res.status}）。`);
        }
      })
      .catch(() => setRenameError('ネットワークエラーでリネームに失敗しました。'))
      .finally(() => setRenaming(false));
  }, [id, nameInput, detail, refetch]);

  const cancelRename = useCallback(() => {
    setEditingName(false);
    setRenameError(null);
  }, []);

  const sourcesPane = (
    <SourcesPane id={id} sources={sources} onChanged={refetch} onPreview={setPreview} />
  );
  const chatPane = (
    <ChatPane id={id} chat={chat} hasSources={hasSources} onAnswered={refetch} />
  );
  const artifactsPane = (
    <ArtifactsPane
      id={id}
      artifacts={artifacts}
      hasSources={hasSources}
      onGenerated={refetch}
      onPreview={setPreview}
    />
  );

  const minutesPane = <MinutesPane id={id} onGenerated={refetch} />;

  const TABS: { key: DetailTab; label: string; count?: number }[] = [
    { key: 'sources', label: '資料', count: sources.length },
    { key: 'chat', label: 'チャット' },
    { key: 'artifacts', label: '生成物', count: artifacts.length },
    { key: 'minutes', label: '議事録' },
  ];

  // ヘッダのタイトル部分（インライン編集対応）
  const titleContent = editingName ? (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          ref={nameInputRef}
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            if (e.key === 'Escape') cancelRename();
          }}
          onBlur={commitRename}
          disabled={renaming}
          className="rounded border border-accent bg-bg px-2 py-0.5 text-lg font-bold text-text focus:outline-none disabled:opacity-60"
          style={{ minWidth: '12rem', maxWidth: '24rem' }}
        />
        {renaming && <Spinner />}
      </div>
      {renameError && (
        <span className="text-[11px]" style={{ color: 'var(--mc-stalled)' }}>{renameError}</span>
      )}
    </div>
  ) : (
    <div className="flex items-center gap-1.5">
      <span className="text-lg font-bold text-text">{detail?.meta.name ?? 'ノートブック'}</span>
      {detail && (
        <button
          type="button"
          onClick={startEditing}
          className="rounded p-0.5 text-text-faint opacity-0 hover:bg-surface-2 hover:text-text group-hover:opacity-100 focus:opacity-100"
          aria-label="名前を変更"
        >
          <EditIcon width={14} height={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur md:px-6 md:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="group">
            {titleContent}
            {detail && !editingName && (
              <p className="mt-0.5 text-xs text-text-muted">資料 {sources.length}・生成物 {artifacts.length}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
            >
              一覧へ戻る
            </button>
          </div>
        </div>
      </header>

      {/* モバイル: タブ切替 */}
      <div className="flex shrink-0 border-b border-border md:hidden" role="tablist" aria-label="ペイン切替">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 text-[10px] opacity-70">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        <ResourceState loading={loading} error={error} hasData={!!detail}>
          {detail && (
            <>
              {/* デスクトップ: 4 ペイン */}
              <div className="hidden h-full md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
                <div className="min-h-0 border-r border-border">{sourcesPane}</div>
                <div className="min-h-0 border-r border-border">{chatPane}</div>
                <div className="min-h-0 border-r border-border">{artifactsPane}</div>
                <div className="min-h-0">{minutesPane}</div>
              </div>
              {/* モバイル: display:none で切り替え（アンマウントしないため生成中 state を保持）*/}
              <div className="h-full md:hidden">
                <div className="h-full" style={{ display: tab === 'sources' ? undefined : 'none' }}>{sourcesPane}</div>
                <div className="h-full" style={{ display: tab === 'chat' ? undefined : 'none' }}>{chatPane}</div>
                <div className="h-full" style={{ display: tab === 'artifacts' ? undefined : 'none' }}>{artifactsPane}</div>
                <div className="h-full" style={{ display: tab === 'minutes' ? undefined : 'none' }}>{minutesPane}</div>
              </div>
            </>
          )}
        </ResourceState>
      </div>

      {preview && <PreviewModal id={id} file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ─── 一覧画面 ─────────────────────────────────────────────

function CreateNotebook({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(() => {
    if (creating) return;
    setCreating(true);
    setError(null);
    fetch('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (res.ok && body.id) {
          setName('');
          onCreated(body.id);
        } else {
          setError(body.error || `作成に失敗しました（HTTP ${res.status}）。`);
        }
      })
      .catch(() => setError('ネットワークエラーで作成できませんでした。'))
      .finally(() => setCreating(false));
  }, [name, creating, onCreated]);

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              create();
            }
          }}
          disabled={creating}
          placeholder="新しいノートブックの名前（任意）…"
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity disabled:opacity-50"
        >
          {creating ? <Spinner /> : <PlusIcon width={15} height={15} />}
          ノートブックを作成
        </button>
      </div>
      {error && (
        <div role="alert" className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

function NotebookCard({
  nb,
  onOpen,
  onDeleted,
}: {
  nb: NotebookSummary;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(() => {
    setDeleting(true);
    setError(null);
    fetch(`/api/notebooks/${nb.id}`, { method: 'DELETE' })
      .then(async (res) => {
        if (res.ok) {
          onDeleted();
          return;
        }
        let msg = `削除に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* 既定メッセージ。 */
        }
        setError(msg);
        setDeleting(false);
        setConfirming(false);
      })
      .catch(() => {
        setError('ネットワークエラーで削除に失敗しました。');
        setDeleting(false);
        setConfirming(false);
      });
  }, [nb.id, onDeleted]);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-label={`${nb.name} を開く`}
        >
          <span className="shrink-0 text-accent">
            <NotebookIcon width={20} height={20} />
          </span>
          <span className="truncate text-sm font-semibold text-text" title={nb.name}>
            {nb.name}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${nb.name} を削除`}
          >
            <TrashIcon width={16} height={16} />
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${nb.name} を開く`}
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </div>
      <button type="button" onClick={onOpen} className="mt-2 flex items-center gap-3 text-left text-xs text-text-faint">
        <span>資料 {nb.sourceCount}</span>
        <span>生成物 {nb.artifactCount}</span>
        <span>{relativeTime(nb.updatedAt)}</span>
      </button>

      {confirming && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3" role="alertdialog" aria-label="削除の確認">
          <p className="text-xs text-text">
            <span className="font-medium" title={nb.name}>
              {nb.name}
            </span>{' '}
            を削除しますか？資料と生成物もすべて削除されます。
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded-full px-3 py-1 text-xs text-text-muted hover:bg-surface-3 hover:text-text disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
              style={{ backgroundColor: 'var(--mc-stalled)' }}
            >
              <TrashIcon width={13} height={13} />
              {deleting ? '削除中…' : '削除する'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

interface NotebooksListResponse {
  generatedAt?: string;
  notebooks?: NotebookSummary[];
  error?: string;
}

export default function Notebooks() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, error, loading, fetchedAt, refetch } =
    useLiveResource<NotebooksListResponse>('/api/notebooks');

  const notebooks = data?.notebooks ?? [];

  if (selectedId) {
    return (
      <NotebookDetailView
        id={selectedId}
        onBack={() => {
          setSelectedId(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="ノートブック"
        subtitle="資料をアップロードし、その内容を根拠に質問・要約・生成ができます"
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <CreateNotebook
          onCreated={(id) => {
            refetch();
            setSelectedId(id);
          }}
        />
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <>
              {notebooks.length === 0 ? (
                <EmptyState>まだノートブックがありません。上の入力欄から作成できます。</EmptyState>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {notebooks.map((nb) => (
                    <NotebookCard
                      key={nb.id}
                      nb={nb}
                      onOpen={() => setSelectedId(nb.id)}
                      onDeleted={refetch}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </ResourceState>
      </div>
    </div>
  );
}
