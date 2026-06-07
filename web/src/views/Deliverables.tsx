import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import { MinutesPane } from './Notebooks';

import { useUpload } from '../lib/UploadContext';
import type { DeliverableFile, DeliverableKind, DeliverablesResponse } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState } from '../components/ui';
import {
  DownloadIcon,
  UploadIcon,
  FolderIcon,
  FolderOpenIcon,
  SheetIcon,
  SlidesIcon,
  PdfFileIcon,
  TextFileIcon,
  ImageFileIcon,
  FileIcon,
  EyeIcon,
  CloseIcon,
  TrashIcon,
  ChevronRightIcon,
  GridIcon,
  NoteIcon,
  PlusIcon,
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
  folder: 'フォルダ',
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

// ─── フォルダアップロード用ヘルパー ──────────────────────────

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntry[] = [];
    const batch = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) { resolve(all); return; }
        all.push(...entries);
        batch();
      });
    };
    batch();
  });
}

async function collectFolderEntries(
  entry: FileSystemEntry,
  prefix = '',
): Promise<Array<{ file: File; relpath: string }>> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file((f) => {
        resolve([{ file: f, relpath: prefix + entry.name }]);
      });
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    const nested = await Promise.all(
      children.map((c) => collectFolderEntries(c, prefix + entry.name + '/')),
    );
    return nested.flat();
  }
  return [];
}

// ─── アップロード（MC-118）────────────────────────────────
// アップロード状態は UploadContext（アプリルート）でグローバル管理する。
// ページ遷移でコンポーネントがアンマウントされても XHR が継続し、
// 完了は UploadToast フローティングインジケーターで表示する。

function UploadPanel() {
  const { upload, uploading } = useUpload();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const handleEntries = useCallback(
    (entries: Array<{ file: File; relpath: string }>) => {
      upload(entries);
      if (inputRef.current) inputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    },
    [upload],
  );

  return (
    <div className="mb-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          if (uploading) return;

          const items = Array.from(e.dataTransfer.items);
          const hasDir = items.some((item) => item.webkitGetAsEntry()?.isDirectory);

          if (hasDir) {
            const fsEntries = items
              .map((item) => item.webkitGetAsEntry())
              .filter((entry): entry is FileSystemEntry => entry !== null);
            const results = await Promise.all(fsEntries.map((entry) => collectFolderEntries(entry)));
            const pairs = results.flat();
            if (pairs.length > 0) handleEntries(pairs);
          } else {
            if (e.dataTransfer.files.length > 0) {
              handleEntries(Array.from(e.dataTransfer.files).map((f) => ({ file: f, relpath: f.name })));
            }
          }
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
            if (e.target.files && e.target.files.length > 0) {
              handleEntries(Array.from(e.target.files).map((f) => ({ file: f, relpath: f.webkitRelativePath || f.name })));
            }
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleEntries(Array.from(e.target.files).map((f) => ({ file: f, relpath: f.webkitRelativePath || f.name })));
            }
          }}
        />
        <span className="text-text-faint">
          <UploadIcon width={22} height={22} />
        </span>
        <p className="text-sm text-text-muted">
          ファイル・フォルダをここにドラッグ＆ドロップ、または
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
          >
            <UploadIcon width={14} height={14} />
            ファイルを選択
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-muted transition-opacity hover:bg-surface-3 hover:text-text disabled:opacity-50"
          >
            <FolderIcon width={14} height={14} />
            フォルダを選択
          </button>
        </div>
        <p className="text-[11px] text-text-faint">大容量ファイル・フォルダ階層にも対応しています。</p>
      </div>
    </div>
  );
}

function KindIcon({ kind, ext }: { kind: DeliverableKind; ext: string }) {
  const props = { width: 20, height: 20 };
  if (kind === 'folder') return <FolderIcon {...props} />;
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

const OFFICE_KINDS = new Set<DeliverableKind>(['spreadsheet', 'presentation', 'document']);
// CSV はテキストとして直接見られるので Office 変換プレビューの対象外。
const CSV_EXT = '.csv';

function isOfficePreviewable(file: DeliverableFile): boolean {
  return OFFICE_KINDS.has(file.kind) && file.ext.toLowerCase() !== CSV_EXT;
}

// ─── ファイルビューワー（モーダル）───────────────────────────────
// PDF は iframe、画像は img、テキスト/markdown は fetch して pre 表示、
// Office 系はプレビュー（PDF 変換）＋ダウンロードリンクのみ。

const TEXT_KINDS = new Set<DeliverableKind>(['text', 'markdown']);

function FileViewerBody({ file }: { file: DeliverableFile }) {
  const inlineSrc = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}&inline=1`;
  const previewSrc = `/api/deliverables/preview?path=${encodeURIComponent(file.relpath)}`;
  const isImage = file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isPdf = file.kind === 'pdf';
  const isText = TEXT_KINDS.has(file.kind) || file.ext.toLowerCase() === '.csv';
  const officePreviewable = isOfficePreviewable(file);

  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    setText(null);
    setTextError(null);
    fetch(inlineSrc)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((t) => { if (!cancelled) setText(t); })
      .catch(() => { if (!cancelled) setTextError('テキストの読み込みに失敗しました。'); });
    return () => { cancelled = true; };
  }, [inlineSrc, isText]);

  if (isImage) {
    return (
      <div className="flex max-h-[80vh] items-center justify-center overflow-auto">
        <img src={inlineSrc} alt={file.name} className="max-h-[80vh] max-w-full object-contain" />
      </div>
    );
  }
  if (isPdf || officePreviewable) {
    return (
      <iframe
        src={isPdf ? inlineSrc : previewSrc}
        title={`${file.name} プレビュー`}
        className="h-[80vh] w-full rounded-lg border border-border bg-surface"
      />
    );
  }
  if (isText) {
    if (textError) {
      return <p className="text-xs" style={{ color: 'var(--mc-stalled)' }}>{textError}</p>;
    }
    if (text === null) {
      return <p className="text-xs text-text-faint">読み込み中…</p>;
    }
    return (
      <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-3 text-xs text-text">
        {text}
      </pre>
    );
  }
  // Office 以外で非対応のもの（ダウンロードのみ）。
  return (
    <div className="rounded-lg border border-border bg-surface p-6 text-center">
      <p className="text-sm text-text-muted">このファイル形式はプレビューに対応していません。</p>
    </div>
  );
}

function FileViewer({ file, onClose }: { file: DeliverableFile; onClose: () => void }) {
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={downloadHref}
            download={file.name}
            className="inline-flex items-center gap-1 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} をダウンロード`}
          >
            <DownloadIcon width={18} height={18} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label="プレビューを閉じる"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <FileViewerBody file={file} />
      </div>
    </div>
  );
}

// 削除（MC-125）。各ファイル行のゴミ箱ボタン → インライン確認 → DELETE 実行。
// 成功で onDeleted（一覧 refetch）を呼ぶ。削除されたカードは refetch で一覧から
// 消えてアンマウントされるため、プレビュー（モーダル）も自動的に閉じる。
function FileCard({ file, onDeleted, onView }: { file: DeliverableFile; onDeleted: () => void; onView: (f: DeliverableFile) => void }) {
  const isImage =
    file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isPdf = file.kind === 'pdf';
  const officePreviewable = isOfficePreviewable(file);
  const isText = TEXT_KINDS.has(file.kind) || file.ext.toLowerCase() === CSV_EXT;
  const viewable = isImage || isPdf || officePreviewable || isText;
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;

  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback(() => {
    setDeleting(true);
    setDeleteError(null);
    fetch(`/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`, {
      method: 'DELETE',
    })
      .then(async (res) => {
        if (res.ok) {
          // 一覧再取得で即反映（このカードはアンマウントされる）。
          onDeleted();
          return;
        }
        let msg = `削除に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* JSON でなければ既定メッセージ。 */
        }
        setDeleteError(msg);
        setDeleting(false);
        setConfirming(false);
      })
      .catch(() => {
        setDeleteError('ネットワークエラーで削除に失敗しました。');
        setDeleting(false);
        setConfirming(false);
      });
  }, [file.relpath, onDeleted]);

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
        <div className="flex shrink-0 items-center gap-0.5">
          {viewable && (
            <button
              type="button"
              onClick={() => onView(file)}
              className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
              aria-label={`${file.name} をプレビュー`}
            >
              <EyeIcon width={16} height={16} />
            </button>
          )}
          <a
            href={downloadHref}
            download={file.name}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} をダウンロード`}
          >
            <DownloadIcon width={16} height={16} />
          </a>
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setDeleteError(null);
            }}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} を削除`}
          >
            <TrashIcon width={16} height={16} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-text-faint">
        <span>{humanReadableSize(file.sizeBytes)}</span>
        <span>{relativeTime(file.mtime)}</span>
      </div>
      {isImage && (
        <button
          type="button"
          onClick={() => onView(file)}
          className="mt-2 block w-full overflow-hidden rounded border border-border"
          aria-label={`${file.name} をプレビュー`}
        >
          <img
            src={`/api/deliverables/file?path=${encodeURIComponent(file.relpath)}&inline=1`}
            alt={file.name}
            className="h-24 w-full object-cover"
            loading="lazy"
          />
        </button>
      )}

      {confirming && (
        <div
          className="mt-3 rounded-lg border border-border bg-surface-2 p-3"
          role="alertdialog"
          aria-label="削除の確認"
        >
          <p className="text-xs text-text">
            <span className="font-medium" title={file.name}>
              {file.name}
            </span>{' '}
            を削除しますか？この操作は取り消せません。
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

      {deleteError && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {deleteError}
        </div>
      )}
    </div>
  );
}

// ─── フォルダツリー ──────────────────────────────────────

type TreeNode = {
  name: string;
  path: string;
  subdirs: Map<string, TreeNode>;
  files: DeliverableFile[];
};

function buildTree(files: DeliverableFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', subdirs: new Map(), files: [] };
  for (const file of files) {
    // 空フォルダエントリ（isDir）は relpath がフォルダ自身を指すので、
    // パス全体を subdir として登録し files には積まない。
    const parts = file.relpath.split('/');
    if (!file.isDir) parts.pop(); // filename を除いてフォルダパスのみ処理
    let node = root;
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!node.subdirs.has(part)) {
        node.subdirs.set(part, { name: part, path: cur, subdirs: new Map(), files: [] });
      }
      node = node.subdirs.get(part)!;
    }
    if (!file.isDir) node.files.push(file);
  }
  return root;
}

function countFiles(node: TreeNode): number {
  let n = node.files.length;
  for (const sub of node.subdirs.values()) n += countFiles(sub);
  return n;
}

function FileRow({ file, onDeleted, indent, onView }: { file: DeliverableFile; onDeleted: () => void; indent: number; onView: (f: DeliverableFile) => void }) {
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isImage = file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isText = TEXT_KINDS.has(file.kind) || file.ext.toLowerCase() === CSV_EXT;
  const viewable = isImage || file.kind === 'pdf' || isOfficePreviewable(file) || isText;

  const handleDelete = useCallback(() => {
    setDeleting(true);
    fetch(`/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`, { method: 'DELETE' })
      .then((res) => { if (res.ok) onDeleted(); else setDeleting(false); setConfirming(false); })
      .catch(() => { setDeleting(false); setConfirming(false); });
  }, [file.relpath, onDeleted]);

  return (
    <div style={{ paddingLeft: `${indent * 20}px` }}>
      <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2 group">
        <span className="shrink-0 text-text-faint">
          <KindIcon kind={file.kind} ext={file.ext} />
        </span>
        <span className="flex-1 truncate text-xs text-text" title={file.name}>{file.name}</span>
        <span className="shrink-0 text-[10px] text-text-faint whitespace-nowrap">
          {humanReadableSize(file.sizeBytes)}
        </span>
        {viewable && (
          <button
            type="button"
            onClick={() => onView(file)}
            className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
            aria-label={`${file.name} をプレビュー`}
          >
            <EyeIcon width={14} height={14} />
          </button>
        )}
        <a
          href={downloadHref}
          download={file.name}
          className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
          aria-label={`${file.name} をダウンロード`}
        >
          <DownloadIcon width={14} height={14} />
        </a>
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-3"
            >キャンセル</button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-bg disabled:opacity-50"
              style={{ backgroundColor: 'var(--mc-stalled)' }}
            >{deleting ? '…' : '削除'}</button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
            aria-label={`${file.name} を削除`}
          >
            <TrashIcon width={14} height={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function FolderNodeView({
  node, indent, openFolders, toggleFolder, onDeleted, onView,
}: {
  node: TreeNode;
  indent: number;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onDeleted: () => void;
  onView: (f: DeliverableFile) => void;
}) {
  const isOpen = openFolders.has(node.path);
  const total = countFiles(node);
  return (
    <div>
      <button
        type="button"
        onClick={() => toggleFolder(node.path)}
        style={{ paddingLeft: `${indent * 20}px` }}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-surface-2"
      >
        <span
          className="shrink-0 text-text-faint transition-transform duration-100"
          style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <ChevronRightIcon width={14} height={14} />
        </span>
        <span className="shrink-0 text-text-faint">
          {isOpen
            ? <FolderOpenIcon width={16} height={16} />
            : <FolderIcon width={16} height={16} />}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-text">{node.name}</span>
        <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-faint">
          {total}
        </span>
      </button>
      {isOpen && (
        <div>
          {Array.from(node.subdirs.values()).map((sub) => (
            <FolderNodeView
              key={sub.path}
              node={sub}
              indent={indent + 1}
              openFolders={openFolders}
              toggleFolder={toggleFolder}
              onDeleted={onDeleted}
              onView={onView}
            />
          ))}
          {node.files.map((f) => (
            <FileRow key={f.relpath} file={f} onDeleted={onDeleted} indent={indent + 1} onView={onView} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────

// ─── 新規フォルダ作成（MC-154）────────────────────────────────

function NewFolderButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleOpen = () => {
    setOpen(true);
    setName('');
    setError(null);
    // 次フレームでフォーカス
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleCancel = () => {
    setOpen(false);
    setName('');
    setError(null);
  };

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('フォルダ名を入力してください。');
      return;
    }
    setCreating(true);
    setError(null);
    fetch('/api/deliverables/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
      .then(async (res) => {
        if (res.ok) {
          setOpen(false);
          setName('');
          onCreated();
        } else {
          let msg = `作成に失敗しました（HTTP ${res.status}）。`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) msg = body.error;
          } catch { /* ignore */ }
          setError(msg);
        }
      })
      .catch(() => setError('ネットワークエラーで作成に失敗しました。'))
      .finally(() => setCreating(false));
  }, [name, onCreated]);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
      >
        <PlusIcon width={13} height={13} />
        新規フォルダ
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-bg/60 p-4 backdrop-blur"
          onClick={handleCancel}
          role="dialog"
          aria-modal
          aria-label="新規フォルダを作成"
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-semibold text-text">新規フォルダを作成</h2>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') handleCancel(); }}
              placeholder="フォルダ名"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none"
            />
            {error && (
              <p className="mt-2 text-xs" style={{ color: 'var(--mc-stalled)' }}>{error}</p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={creating}
                className="rounded-full px-3 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
              >
                <FolderIcon width={13} height={13} />
                {creating ? '作成中…' : '作成する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────

export default function Deliverables() {
  const [showMinutesPane, setShowMinutesPane] = useState(false);
  const { data, error, loading, fetchedAt, refetch } = useLiveResource<DeliverablesResponse>(
    '/api/deliverables',
  );
  const [filter, setFilter] = useState<FilterKind>('all');
  const [viewMode, setViewMode] = useState<'folder' | 'list'>('folder');
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [selectedViewFile, setSelectedViewFile] = useState<DeliverableFile | null>(null);

  const toggleFolder = useCallback((path: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener('deliverables:uploaded', handler);
    return () => window.removeEventListener('deliverables:uploaded', handler);
  }, [refetch]);

  if (showMinutesPane) {
    return (
      <MinutesPane
        id="deliverables"
        mode="deliverables"
        onGenerated={(relpath?: string) => {
          refetch();
          if (relpath) {
            const parts = relpath.split('/');
            parts.pop(); // ファイル名を除去してフォルダパスのみ
            const toOpen = new Set<string>();
            let cur = '';
            for (const part of parts) {
              cur = cur ? `${cur}/${part}` : part;
              toOpen.add(cur);
            }
            setOpenFolders(prev => new Set([...prev, ...toOpen]));
          }
        }}
        onBack={() => setShowMinutesPane(false)}
      />
    );
  }

  const files = data?.files ?? [];
  // リスト/フィルタ用の実ファイル（空フォルダエントリはフォルダビューでのみ扱う）。
  const realFiles = files.filter((f) => !f.isDir);
  const activeKinds = new Set<DeliverableKind>(realFiles.map((f) => f.kind));
  const visibleFilters = FILTER_ORDER.filter(
    (k) => k === 'all' || activeKinds.has(k as DeliverableKind),
  );

  const filtered =
    filter === 'all' ? realFiles : realFiles.filter((f) => f.kind === filter);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="フォルダ"
        subtitle="Excel / PowerPoint / PDF などの成果物"
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowMinutesPane(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <NoteIcon width={14} height={14} />
            議事録を作成
          </button>
        </div>
        <UploadPanel />
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <>
              {/* ツールバー: ビュー切り替え + 種別フィルタ（リストビュー時） + 新規フォルダ */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {/* ビュー切り替えボタン */}
                <div className="flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('folder')}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 transition-colors ${
                      viewMode === 'folder'
                        ? 'bg-accent text-bg font-semibold'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    <FolderIcon width={13} height={13} />
                    フォルダ
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 transition-colors ${
                      viewMode === 'list'
                        ? 'bg-accent text-bg font-semibold'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    <GridIcon width={13} height={13} />
                    リスト
                  </button>
                </div>

                {/* 種別フィルタ（リストビュー時のみ） */}
                {viewMode === 'list' && visibleFilters.length > 1 && (
                  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="種別フィルタ">
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
                            {realFiles.filter((f) => f.kind === k).length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {/* MC-154: 新規フォルダボタン（ツールバー右端） */}
                <div className="ml-auto">
                  <NewFolderButton onCreated={refetch} />
                </div>
              </div>

              {/* フォルダビュー */}
              {viewMode === 'folder' && (
                files.length === 0 ? (
                  <EmptyState>まだ成果物がありません</EmptyState>
                ) : (
                  <div className="rounded-lg border border-border bg-surface py-1">
                    {(() => {
                      const tree = buildTree(files);
                      return (
                        <>
                          {Array.from(tree.subdirs.values()).map((sub) => (
                            <FolderNodeView
                              key={sub.path}
                              node={sub}
                              indent={0}
                              openFolders={openFolders}
                              toggleFolder={toggleFolder}
                              onDeleted={refetch}
                              onView={setSelectedViewFile}
                            />
                          ))}
                          {tree.files.map((f) => (
                            <FileRow key={f.relpath} file={f} onDeleted={refetch} indent={0} onView={setSelectedViewFile} />
                          ))}
                        </>
                      );
                    })()}
                  </div>
                )
              )}

              {/* リストビュー */}
              {viewMode === 'list' && (
                filtered.length === 0 ? (
                  <EmptyState>まだ成果物がありません</EmptyState>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((file) => (
                      <FileCard key={file.relpath} file={file} onDeleted={refetch} onView={setSelectedViewFile} />
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </ResourceState>
      </div>
      {selectedViewFile && (
        <FileViewer file={selectedViewFile} onClose={() => setSelectedViewFile(null)} />
      )}
    </div>
  );
}
