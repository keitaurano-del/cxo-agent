import { useCallback, useRef, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type { DeliverableFile, DeliverableKind, DeliverablesResponse } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState } from '../components/ui';
import {
  DownloadIcon,
  UploadIcon,
  SheetIcon,
  SlidesIcon,
  PdfFileIcon,
  TextFileIcon,
  ImageFileIcon,
  FileIcon,
  EyeIcon,
  CloseIcon,
} from '../components/icons';
import { relativeTime } from '../lib/time';

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

type FilterKind = 'all' | DeliverableKind;

const KIND_LABELS: Record<FilterKind, string> = {
  all: 'すべて',
  spreadsheet: 'スプレッドシート',
  presentation: 'プレゼン',
  pdf: 'PDF',
  document: 'ドキュメント',
  image: '画像',
  markdown: 'Markdown',
  text: 'テキスト',
  other: 'その他',
};

const FILTER_ORDER: FilterKind[] = [
  'all',
  'spreadsheet',
  'presentation',
  'pdf',
  'document',
  'image',
  'markdown',
  'text',
  'other',
];

function humanReadableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── アップロード（MC-118）────────────────────────────────
// XMLHttpRequest を使うのは upload.onprogress で進捗（%）を取るため
// （fetch は送信進捗を取れない）。認証は Cookie mc_token が same-origin で自動付与される。

interface UploadPanelProps {
  /** アップロード完了後に一覧を再取得するコールバック。 */
  onUploaded: () => void;
}

function UploadPanel({ onUploaded }: UploadPanelProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const upload = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0 || uploading) return;

      setError(null);
      setMessage(null);
      setUploading(true);
      setProgress(0);

      const fd = new FormData();
      files.forEach((f) => fd.append('files', f, f.name));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/deliverables/upload');
      // Cookie mc_token は same-origin で自動送信される（withCredentials は same-origin では不要）。

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 201) {
          let count = files.length;
          try {
            const body = JSON.parse(xhr.responseText) as { files?: unknown[] };
            count = body.files?.length ?? files.length;
          } catch {
            /* レスポンス parse 失敗時は送信件数を使う。 */
          }
          setMessage(`${count} 件をアップロードしました。`);
          onUploaded();
        } else {
          let msg = `アップロードに失敗しました（HTTP ${xhr.status}）。`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* JSON でなければ既定メッセージ。 */
          }
          // 413 はサイズ/件数超過。サーバの error 文をそのまま表示する。
          setError(msg);
        }
      };

      xhr.onerror = () => {
        setUploading(false);
        setError('ネットワークエラーでアップロードに失敗しました。');
      };

      xhr.send(fd);
      if (inputRef.current) inputRef.current.value = '';
    },
    [uploading, onUploaded],
  );

  return (
    <div className="mb-4">
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
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors ${
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
        <span className="text-text-faint">
          <UploadIcon width={22} height={22} />
        </span>
        <p className="text-sm text-text-muted">
          ファイルをここにドラッグ＆ドロップ、または
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
        >
          <UploadIcon width={14} height={14} />
          ファイルを選択
        </button>
        <p className="text-[11px] text-text-faint">大容量ファイルにも対応しています。</p>
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

function KindIcon({ kind, ext }: { kind: DeliverableKind; ext: string }) {
  const props = { width: 20, height: 20 };
  if (kind === 'spreadsheet') return <SheetIcon {...props} />;
  if (kind === 'presentation') return <SlidesIcon {...props} />;
  if (kind === 'pdf') return <PdfFileIcon {...props} />;
  if (kind === 'image') return <ImageFileIcon {...props} />;
  if (kind === 'markdown' || kind === 'text') return <TextFileIcon {...props} />;
  if (kind === 'document') return <FileIcon {...props} />;
  const extLower = ext.toLowerCase();
  if (IMG_EXTS.has(extLower)) return <ImageFileIcon {...props} />;
  return <FileIcon {...props} />;
}

function ImagePreview({ file }: { file: DeliverableFile }) {
  const [open, setOpen] = useState(false);
  const src = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}&inline=1`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 block w-full overflow-hidden rounded border border-border"
        aria-label={`${file.name} をプレビュー`}
      >
        <img
          src={src}
          alt={file.name}
          className="h-24 w-full object-cover"
          loading="lazy"
        />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal
          aria-label={`${file.name} プレビュー`}
        >
          <img
            src={src}
            alt={file.name}
            className="max-h-full max-w-full rounded-lg border border-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

const OFFICE_KINDS = new Set<DeliverableKind>(['spreadsheet', 'presentation', 'document']);
// CSV はテキストとして直接見られるので Office 変換プレビューの対象外。
const CSV_EXT = '.csv';

function isOfficePreviewable(file: DeliverableFile): boolean {
  return OFFICE_KINDS.has(file.kind) && file.ext.toLowerCase() !== CSV_EXT;
}

function PdfPreview({ file, src }: { file: DeliverableFile; src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
        aria-label={`${file.name} をプレビュー`}
      >
        <EyeIcon width={14} height={14} />
        プレビュー
      </button>
      {open && (
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
              onClick={() => setOpen(false)}
              className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
              aria-label="プレビューを閉じる"
            >
              <CloseIcon width={18} height={18} />
            </button>
          </div>
          <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-surface">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-faint">
              プレビューを生成しています…
            </div>
            <iframe
              src={src}
              title={`${file.name} プレビュー`}
              className="relative h-full w-full"
            />
          </div>
        </div>
      )}
    </>
  );
}

function FileCard({ file }: { file: DeliverableFile }) {
  const isImage =
    file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isPdf = file.kind === 'pdf';
  const officePreviewable = isOfficePreviewable(file);
  const previewSrc = `/api/deliverables/preview?path=${encodeURIComponent(file.relpath)}`;
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-text-faint">
            <KindIcon kind={file.kind} ext={file.ext} />
          </span>
          <span
            className="truncate text-sm font-medium text-text"
            title={file.name}
          >
            {file.name}
          </span>
        </div>
        <a
          href={downloadHref}
          download={file.name}
          className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
          aria-label={`${file.name} をダウンロード`}
        >
          <DownloadIcon width={16} height={16} />
        </a>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-text-faint">
        <span>{humanReadableSize(file.sizeBytes)}</span>
        <span>{relativeTime(file.mtime)}</span>
      </div>
      {isImage && <ImagePreview file={file} />}
      {(isPdf || officePreviewable) && <PdfPreview file={file} src={previewSrc} />}
    </div>
  );
}

export default function Deliverables() {
  const { data, error, loading, fetchedAt, refetch } = useLiveResource<DeliverablesResponse>(
    '/api/deliverables',
  );
  const [filter, setFilter] = useState<FilterKind>('all');

  const files = data?.files ?? [];
  const activeKinds = new Set<DeliverableKind>(files.map((f) => f.kind));
  const visibleFilters = FILTER_ORDER.filter(
    (k) => k === 'all' || activeKinds.has(k as DeliverableKind),
  );

  const filtered =
    filter === 'all' ? files : files.filter((f) => f.kind === filter);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="成果物"
        subtitle="Excel / PowerPoint / PDF などの成果物"
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <UploadPanel onUploaded={refetch} />
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <>
              {visibleFilters.length > 1 && (
                <div
                  className="mb-4 flex flex-wrap gap-1.5"
                  role="tablist"
                  aria-label="種別フィルタ"
                >
                  {visibleFilters.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={filter === k}
                      onClick={() => setFilter(k)}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${
                        filter === k
                          ? 'bg-accent text-bg font-semibold'
                          : 'bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
                      }`}
                    >
                      {KIND_LABELS[k]}
                      {k !== 'all' && (
                        <span className="ml-1 text-[10px] opacity-70">
                          {files.filter((f) => f.kind === k).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {filtered.length === 0 ? (
                <EmptyState>まだ成果物がありません</EmptyState>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((file) => (
                    <FileCard key={file.relpath} file={file} />
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
