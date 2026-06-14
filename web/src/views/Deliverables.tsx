import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import { MinutesPane } from './Notebooks';

import { useUpload } from '../lib/UploadContext';
import type {
  DeliverableFile,
  DeliverableKind,
  DeliverablesResponse,
  TrashEntry,
  TrashResponse,
} from '../lib/types';
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
  EditIcon,
  SortIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  RestoreIcon,
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

// ─── 並び替え（MC-231）──────────────────────────────────────
// 名前 / 更新日 / サイズ × 昇順 / 降順。選択中ソートは localStorage に永続化する。

type SortKey = 'name' | 'mtime' | 'size';
type SortDir = 'asc' | 'desc';

interface SortPref {
  key: SortKey;
  dir: SortDir;
}

const SORT_STORAGE_KEY = 'apollo.deliverables.sort';
const DEFAULT_SORT: SortPref = { key: 'mtime', dir: 'desc' };

const SORT_KEY_LABELS: Record<SortKey, string> = {
  name: '名前',
  mtime: '更新日',
  size: 'サイズ',
};

function loadSortPref(): SortPref {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as Partial<SortPref>;
    const key: SortKey =
      parsed.key === 'name' || parsed.key === 'mtime' || parsed.key === 'size'
        ? parsed.key
        : DEFAULT_SORT.key;
    const dir: SortDir = parsed.dir === 'asc' || parsed.dir === 'desc' ? parsed.dir : DEFAULT_SORT.dir;
    return { key, dir };
  } catch {
    return DEFAULT_SORT;
  }
}

function saveSortPref(pref: SortPref): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    /* localStorage 不可（プライベートモード等）は永続化なしで続行。 */
  }
}

/** ファイル配列を SortPref に従って新しい配列で返す（破壊しない）。 */
function sortFiles(files: DeliverableFile[], pref: SortPref): DeliverableFile[] {
  const sign = pref.dir === 'asc' ? 1 : -1;
  const out = [...files];
  out.sort((a, b) => {
    let cmp = 0;
    if (pref.key === 'name') {
      cmp = a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' });
    } else if (pref.key === 'size') {
      cmp = a.sizeBytes - b.sizeBytes;
    } else {
      cmp = Date.parse(a.mtime) - Date.parse(b.mtime);
    }
    if (cmp === 0) {
      // 同値は名前で安定させる（ソート結果のちらつき防止）。
      cmp = a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' });
    }
    return cmp * sign;
  });
  return out;
}

// ─── リネーム（MC-227）────────────────────────────────────
// インライン名前編集。入力 → POST /api/deliverables/rename → 成功で onRenamed（refetch）。

interface RenameState {
  editing: boolean;
  value: string;
  saving: boolean;
  error: string | null;
}

/** リネーム API を叩く。成功で { ok:true }、失敗で { ok:false, error } を返す。 */
async function renameDeliverable(
  relpath: string,
  newName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/deliverables/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relpath, newName }),
    });
    if (res.ok) return { ok: true };
    let msg = `名前の変更に失敗しました（HTTP ${res.status}）。`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* JSON でなければ既定メッセージ。 */
    }
    return { ok: false, error: msg };
  } catch {
    return { ok: false, error: 'ネットワークエラーで名前の変更に失敗しました。' };
  }
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

// ─── インライン名前編集入力（MC-227）────────────────────────────
// ファイル/フォルダ名のインライン編集 UI。Enter で確定、Escape で取消。
// 拡張子（ファイル）はそのまま編集可能（自由度を優先、衝突はサーバ側で拒否）。
function InlineRenameInput({
  initial,
  saving,
  error,
  onCommit,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  error: string | null;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 拡張子を除いた stem 部分を選択（よくあるファイラ挙動）。
    const dot = initial.lastIndexOf('.');
    if (dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial]);

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') onCommit(value);
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => { if (!saving) onCancel(); }}
        className="w-full rounded border border-accent bg-surface-2 px-1.5 py-0.5 text-sm text-text focus:outline-none"
        aria-label="新しい名前"
      />
      {error && (
        <span className="text-[10px]" style={{ color: 'var(--mc-stalled)' }}>{error}</span>
      )}
    </span>
  );
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

// 削除（MC-125 → MC-230 ゴミ箱方式）。ゴミ箱ボタンで即退避し、ページ側で Undo トーストを出す。
// リネーム（MC-227）も同カードに内蔵。削除されたカードは refetch で一覧から消える。
function FileCard({
  file, onDelete, onView, onRenamed,
}: {
  file: DeliverableFile;
  onDelete: (f: DeliverableFile) => void;
  onView: (f: DeliverableFile) => void;
  onRenamed: () => void;
}) {
  const isImage =
    file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isPdf = file.kind === 'pdf';
  const officePreviewable = isOfficePreviewable(file);
  const isText = TEXT_KINDS.has(file.kind) || file.ext.toLowerCase() === CSV_EXT;
  const viewable = isImage || isPdf || officePreviewable || isText;
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;

  const [rename, setRename] = useState<RenameState>({ editing: false, value: '', saving: false, error: null });

  const commitRename = useCallback(async (value: string) => {
    const next = value.trim();
    if (!next || next === file.name) {
      setRename({ editing: false, value: '', saving: false, error: null });
      return;
    }
    setRename((r) => ({ ...r, saving: true, error: null }));
    const result = await renameDeliverable(file.relpath, next);
    if (result.ok) {
      setRename({ editing: false, value: '', saving: false, error: null });
      onRenamed();
    } else {
      setRename((r) => ({ ...r, saving: false, error: result.error }));
    }
  }, [file.relpath, file.name, onRenamed]);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-text-faint">
            <KindIcon kind={file.kind} ext={file.ext} />
          </span>
          {rename.editing ? (
            <InlineRenameInput
              initial={file.name}
              saving={rename.saving}
              error={rename.error}
              onCommit={commitRename}
              onCancel={() => setRename({ editing: false, value: '', saving: false, error: null })}
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => setRename({ editing: true, value: file.name, saving: false, error: null })}
              className="truncate text-left text-sm font-medium text-text"
              title={`${file.name}（ダブルクリックで名前を変更）`}
            >
              {file.name}
            </button>
          )}
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
          <button
            type="button"
            onClick={() => setRename({ editing: true, value: file.name, saving: false, error: null })}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} の名前を変更`}
          >
            <EditIcon width={16} height={16} />
          </button>
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
            onClick={() => onDelete(file)}
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

function FileRow({
  file, onDelete, indent, onView, onRenamed,
}: {
  file: DeliverableFile;
  onDelete: (f: DeliverableFile) => void;
  indent: number;
  onView: (f: DeliverableFile) => void;
  onRenamed: () => void;
}) {
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;
  const [rename, setRename] = useState<RenameState>({ editing: false, value: '', saving: false, error: null });

  const isImage = file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isText = TEXT_KINDS.has(file.kind) || file.ext.toLowerCase() === CSV_EXT;
  const viewable = isImage || file.kind === 'pdf' || isOfficePreviewable(file) || isText;

  const commitRename = useCallback(async (value: string) => {
    const next = value.trim();
    if (!next || next === file.name) {
      setRename({ editing: false, value: '', saving: false, error: null });
      return;
    }
    setRename((r) => ({ ...r, saving: true, error: null }));
    const result = await renameDeliverable(file.relpath, next);
    if (result.ok) {
      setRename({ editing: false, value: '', saving: false, error: null });
      onRenamed();
    } else {
      setRename((r) => ({ ...r, saving: false, error: result.error }));
    }
  }, [file.relpath, file.name, onRenamed]);

  return (
    <div style={{ paddingLeft: `${indent * 20}px` }}>
      <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2 group">
        <span className="shrink-0 text-text-faint">
          <KindIcon kind={file.kind} ext={file.ext} />
        </span>
        {rename.editing ? (
          <InlineRenameInput
            initial={file.name}
            saving={rename.saving}
            error={rename.error}
            onCommit={commitRename}
            onCancel={() => setRename({ editing: false, value: '', saving: false, error: null })}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setRename({ editing: true, value: file.name, saving: false, error: null })}
            className="flex-1 truncate text-left text-xs text-text"
            title={`${file.name}（ダブルクリックで名前を変更）`}
          >{file.name}</button>
        )}
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
        <button
          type="button"
          onClick={() => setRename({ editing: true, value: file.name, saving: false, error: null })}
          className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
          aria-label={`${file.name} の名前を変更`}
        >
          <EditIcon width={14} height={14} />
        </button>
        <a
          href={downloadHref}
          download={file.name}
          className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
          aria-label={`${file.name} をダウンロード`}
        >
          <DownloadIcon width={14} height={14} />
        </a>
        <button
          type="button"
          onClick={() => onDelete(file)}
          className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
          aria-label={`${file.name} を削除`}
        >
          <TrashIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

function FolderNodeView({
  node, indent, openFolders, toggleFolder, onDelete, onView, onRenamed, sort,
}: {
  node: TreeNode;
  indent: number;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onDelete: (f: DeliverableFile) => void;
  onView: (f: DeliverableFile) => void;
  onRenamed: () => void;
  sort: SortPref;
}) {
  const isOpen = openFolders.has(node.path);
  const total = countFiles(node);
  const [rename, setRename] = useState<RenameState>({ editing: false, value: '', saving: false, error: null });

  // 子フォルダはフォルダ名で安定ソート、ファイルは選択中ソートを適用。
  const subdirs = Array.from(node.subdirs.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }),
  );
  const files = sortFiles(node.files, sort);

  const commitRename = useCallback(async (value: string) => {
    const next = value.trim();
    if (!next || next === node.name) {
      setRename({ editing: false, value: '', saving: false, error: null });
      return;
    }
    setRename((r) => ({ ...r, saving: true, error: null }));
    const result = await renameDeliverable(node.path, next);
    if (result.ok) {
      setRename({ editing: false, value: '', saving: false, error: null });
      onRenamed();
    } else {
      setRename((r) => ({ ...r, saving: false, error: result.error }));
    }
  }, [node.path, node.name, onRenamed]);

  return (
    <div>
      <div
        style={{ paddingLeft: `${indent * 20}px` }}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 hover:bg-surface-2 group"
      >
        <button
          type="button"
          onClick={() => toggleFolder(node.path)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
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
          {rename.editing ? (
            <InlineRenameInput
              initial={node.name}
              saving={rename.saving}
              error={rename.error}
              onCommit={commitRename}
              onCancel={() => setRename({ editing: false, value: '', saving: false, error: null })}
            />
          ) : (
            <span
              className="flex-1 truncate text-sm font-medium text-text"
              onDoubleClick={() => setRename({ editing: true, value: node.name, saving: false, error: null })}
              title={`${node.name}（ダブルクリックで名前を変更）`}
            >{node.name}</span>
          )}
        </button>
        {!rename.editing && (
          <button
            type="button"
            onClick={() => setRename({ editing: true, value: node.name, saving: false, error: null })}
            className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
            aria-label={`${node.name} の名前を変更`}
          >
            <EditIcon width={14} height={14} />
          </button>
        )}
        <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-faint">
          {total}
        </span>
      </div>
      {isOpen && (
        <div>
          {subdirs.map((sub) => (
            <FolderNodeView
              key={sub.path}
              node={sub}
              indent={indent + 1}
              openFolders={openFolders}
              toggleFolder={toggleFolder}
              onDelete={onDelete}
              onView={onView}
              onRenamed={onRenamed}
              sort={sort}
            />
          ))}
          {files.map((f) => (
            <FileRow key={f.relpath} file={f} onDelete={onDelete} indent={indent + 1} onView={onView} onRenamed={onRenamed} />
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

// ─── Undo トースト（MC-230）──────────────────────────────────
// 削除直後に「削除しました [元に戻す]」を画面下部に出す。一定時間で自動的に消える。

interface PendingUndo {
  trashId: string;
  name: string;
}

function UndoToast({
  pending, onUndo, onDismiss,
}: {
  pending: PendingUndo;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 7000);
    return () => clearTimeout(t);
  }, [pending.trashId, onDismiss]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border bg-surface-2 px-4 py-2 text-xs text-text shadow-lg"
        role="status"
      >
        <span className="truncate">
          <span className="font-medium" title={pending.name}>{pending.name}</span> をゴミ箱に移動しました
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg"
        >
          <RestoreIcon width={13} height={13} />
          元に戻す
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-text-faint hover:text-text"
          aria-label="閉じる"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

// ─── ゴミ箱ビュー（MC-230）────────────────────────────────────
// 退避済みエントリを一覧し、復元 / 完全削除 / すべて空にする を行う。

function TrashView({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const { data, error, loading, fetchedAt, refetch } = useLiveResource<TrashResponse>(
    '/api/deliverables/trash',
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);

  const restore = useCallback(async (trashId: string) => {
    setBusyId(trashId);
    setActionError(null);
    try {
      const res = await fetch('/api/deliverables/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashId }),
      });
      if (res.ok) { refetch(); onChanged(); }
      else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(body.error ?? `復元に失敗しました（HTTP ${res.status}）。`);
      }
    } catch {
      setActionError('ネットワークエラーで復元に失敗しました。');
    } finally {
      setBusyId(null);
    }
  }, [refetch, onChanged]);

  const purge = useCallback(async (trashId: string) => {
    setBusyId(trashId);
    setActionError(null);
    try {
      const res = await fetch(`/api/deliverables/trash?trashId=${encodeURIComponent(trashId)}`, { method: 'DELETE' });
      if (res.ok) refetch();
      else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(body.error ?? `完全削除に失敗しました（HTTP ${res.status}）。`);
      }
    } catch {
      setActionError('ネットワークエラーで完全削除に失敗しました。');
    } finally {
      setBusyId(null);
    }
  }, [refetch]);

  const purgeAll = useCallback(async () => {
    setBusyId('__all__');
    setActionError(null);
    try {
      const res = await fetch('/api/deliverables/trash', { method: 'DELETE' });
      if (res.ok) { setConfirmPurgeAll(false); refetch(); }
      else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(body.error ?? `空にできませんでした（HTTP ${res.status}）。`);
      }
    } catch {
      setActionError('ネットワークエラーで空にできませんでした。');
    } finally {
      setBusyId(null);
    }
  }, [refetch]);

  const entries = data?.entries ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="ゴミ箱"
        subtitle="削除したドキュメントの復元・完全削除"
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
          >
            <ChevronRightIcon width={13} height={13} style={{ transform: 'rotate(180deg)' }} />
            ドキュメントに戻る
          </button>
          {entries.length > 0 && (
            <div className="ml-auto">
              {confirmPurgeAll ? (
                <span className="inline-flex items-center gap-2">
                  <span className="text-xs text-text-muted">すべて完全削除しますか？</span>
                  <button
                    type="button"
                    onClick={() => setConfirmPurgeAll(false)}
                    disabled={busyId === '__all__'}
                    className="rounded-full px-3 py-1 text-xs text-text-muted hover:bg-surface-3 disabled:opacity-50"
                  >キャンセル</button>
                  <button
                    type="button"
                    onClick={purgeAll}
                    disabled={busyId === '__all__'}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
                    style={{ backgroundColor: 'var(--mc-stalled)' }}
                  >
                    <TrashIcon width={13} height={13} />
                    {busyId === '__all__' ? '削除中…' : 'すべて削除'}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmPurgeAll(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-muted transition-colors hover:text-text"
                >
                  <TrashIcon width={13} height={13} />
                  ゴミ箱を空にする
                </button>
              )}
            </div>
          )}
        </div>

        {actionError && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
            style={{ color: 'var(--mc-stalled)' }}
          >
            {actionError}
          </div>
        )}

        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            entries.length === 0 ? (
              <EmptyState>ゴミ箱は空です</EmptyState>
            ) : (
              <div className="rounded-lg border border-border bg-surface">
                {entries.map((entry: TrashEntry) => (
                  <div
                    key={entry.trashId}
                    className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <span className="shrink-0 text-text-faint">
                      {entry.isDir ? <FolderIcon width={16} height={16} /> : <FileIcon width={16} height={16} />}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-text" title={entry.originalRel}>{entry.name}</span>
                      <span className="truncate text-[10px] text-text-faint" title={entry.originalRel}>
                        {entry.originalRel}
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] text-text-faint whitespace-nowrap">
                      {entry.deletedAt ? relativeTime(entry.deletedAt) : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => restore(entry.trashId)}
                      disabled={busyId === entry.trashId}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-50"
                    >
                      <RestoreIcon width={12} height={12} />
                      復元
                    </button>
                    <button
                      type="button"
                      onClick={() => purge(entry.trashId)}
                      disabled={busyId === entry.trashId}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-bg disabled:opacity-50"
                      style={{ backgroundColor: 'var(--mc-stalled)' }}
                    >
                      <TrashIcon width={12} height={12} />
                      完全削除
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </ResourceState>
      </div>
    </div>
  );
}

// ─── 並び替えコントロール（MC-231）────────────────────────────────
function SortControl({ sort, onChange }: { sort: SortPref; onChange: (s: SortPref) => void }) {
  const keys: SortKey[] = ['name', 'mtime', 'size'];
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-faint">
        <SortIcon width={14} height={14} />
      </span>
      <div className="flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange({ key: k, dir: sort.key === k ? sort.dir : (k === 'name' ? 'asc' : 'desc') })}
            className={`rounded-full px-2.5 py-1 transition-colors ${
              sort.key === k ? 'bg-accent text-bg font-semibold' : 'text-text-muted hover:text-text'
            }`}
            aria-pressed={sort.key === k}
          >
            {SORT_KEY_LABELS[k]}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
        className="inline-flex items-center rounded-full border border-border bg-surface-2 p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
        aria-label={sort.dir === 'asc' ? '昇順（クリックで降順）' : '降順（クリックで昇順）'}
        title={sort.dir === 'asc' ? '昇順' : '降順'}
      >
        {sort.dir === 'asc' ? <ArrowUpIcon width={14} height={14} /> : <ArrowDownIcon width={14} height={14} />}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────

export default function Deliverables() {
  const [showMinutesPane, setShowMinutesPane] = useState(false);
  // 入口の「履歴」ボタンから開いたときだけ、作成画面で履歴モーダルを自動表示する。
  const [openMinutesHistory, setOpenMinutesHistory] = useState(false);
  const { data, error, loading, fetchedAt, refetch } = useLiveResource<DeliverablesResponse>(
    '/api/deliverables',
  );
  const [filter, setFilter] = useState<FilterKind>('all');
  const [viewMode, setViewMode] = useState<'folder' | 'list'>('folder');
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [selectedViewFile, setSelectedViewFile] = useState<DeliverableFile | null>(null);
  // MC-231: 並び替え（localStorage 永続化）。
  const [sort, setSort] = useState<SortPref>(loadSortPref);
  // MC-230: ゴミ箱ビュー表示・削除直後の Undo トースト・操作エラー。
  const [showTrash, setShowTrash] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const changeSort = useCallback((s: SortPref) => {
    setSort(s);
    saveSortPref(s);
  }, []);

  const toggleFolder = useCallback((path: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // MC-230: 削除＝ゴミ箱へ退避。trashId を受けて Undo トーストを出す。
  const handleDelete = useCallback((file: DeliverableFile) => {
    setOpError(null);
    fetch(`/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`, { method: 'DELETE' })
      .then(async (res) => {
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { trashId?: string };
          if (body.trashId) setPendingUndo({ trashId: body.trashId, name: file.name });
          refetch();
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setOpError(body.error ?? `削除に失敗しました（HTTP ${res.status}）。`);
      })
      .catch(() => setOpError('ネットワークエラーで削除に失敗しました。'));
  }, [refetch]);

  // MC-230: Undo（直前の削除を即復元）。
  const handleUndo = useCallback(() => {
    const undo = pendingUndo;
    if (!undo) return;
    setPendingUndo(null);
    fetch('/api/deliverables/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashId: undo.trashId }),
    })
      .then(async (res) => {
        if (res.ok) { refetch(); return; }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setOpError(body.error ?? '元に戻せませんでした。');
      })
      .catch(() => setOpError('ネットワークエラーで元に戻せませんでした。'));
  }, [pendingUndo, refetch]);

  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener('deliverables:uploaded', handler);
    return () => window.removeEventListener('deliverables:uploaded', handler);
  }, [refetch]);

  if (showTrash) {
    return (
      <TrashView
        onChanged={refetch}
        onClose={() => setShowTrash(false)}
      />
    );
  }

  if (showMinutesPane) {
    return (
      <MinutesPane
        id="deliverables"
        mode="deliverables"
        openHistoryOnMount={openMinutesHistory}
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
        onBack={() => {
          setShowMinutesPane(false);
          setOpenMinutesHistory(false);
        }}
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

  const filtered = sortFiles(
    filter === 'all' ? realFiles : realFiles.filter((f) => f.kind === filter),
    sort,
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="ドキュメント"
        subtitle="Excel / PowerPoint / PDF などの成果物"
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setOpenMinutesHistory(false);
              setShowMinutesPane(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <NoteIcon width={14} height={14} />
            議事録を作成
          </button>
          <button
            type="button"
            onClick={() => {
              setOpenMinutesHistory(true);
              setShowMinutesPane(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/50 hover:text-text"
            title="過去の議事録を読み込む"
          >
            🕘 履歴
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
                {/* MC-231: 並び替えコントロール */}
                <SortControl sort={sort} onChange={changeSort} />

                {/* 右端: 新規フォルダ（MC-154）＋ ゴミ箱（MC-230） */}
                <div className="ml-auto flex items-center gap-2">
                  <NewFolderButton onCreated={refetch} />
                  <button
                    type="button"
                    onClick={() => setShowTrash(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
                  >
                    <TrashIcon width={13} height={13} />
                    ゴミ箱
                  </button>
                </div>
              </div>

              {opError && (
                <div
                  role="alert"
                  className="mb-3 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
                  style={{ color: 'var(--mc-stalled)' }}
                >
                  {opError}
                </div>
              )}

              {/* フォルダビュー */}
              {viewMode === 'folder' && (
                files.length === 0 ? (
                  <EmptyState>まだ成果物がありません</EmptyState>
                ) : (
                  <div className="rounded-lg border border-border bg-surface py-1">
                    {(() => {
                      const tree = buildTree(files);
                      const topDirs = Array.from(tree.subdirs.values()).sort((a, b) =>
                        a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }),
                      );
                      const topFiles = sortFiles(tree.files, sort);
                      return (
                        <>
                          {topDirs.map((sub) => (
                            <FolderNodeView
                              key={sub.path}
                              node={sub}
                              indent={0}
                              openFolders={openFolders}
                              toggleFolder={toggleFolder}
                              onDelete={handleDelete}
                              onView={setSelectedViewFile}
                              onRenamed={refetch}
                              sort={sort}
                            />
                          ))}
                          {topFiles.map((f) => (
                            <FileRow key={f.relpath} file={f} onDelete={handleDelete} indent={0} onView={setSelectedViewFile} onRenamed={refetch} />
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
                      <FileCard key={file.relpath} file={file} onDelete={handleDelete} onView={setSelectedViewFile} onRenamed={refetch} />
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
      {pendingUndo && (
        <UndoToast
          pending={pendingUndo}
          onUndo={handleUndo}
          onDismiss={() => setPendingUndo(null)}
        />
      )}
    </div>
  );
}
