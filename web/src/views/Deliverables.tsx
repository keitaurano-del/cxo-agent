import { useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type { DeliverableFile, DeliverableKind, DeliverablesResponse } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState } from '../components/ui';
import {
  DownloadIcon,
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
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const { data, error, loading, fetchedAt } = useLiveResource<DeliverablesResponse>(
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
        subtitle="林が生成した Excel/PowerPoint/PDF 等"
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
