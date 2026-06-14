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
  MoveIcon,
  ClockIcon,
  CheckIcon,
  ChevronLeftIcon,
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

// ─── 移動（MC-228）────────────────────────────────────────
// POST /api/deliverables/move でファイル/フォルダを別フォルダへ移動する。
// D&D（フォルダにドロップ）と「移動先を選ぶ」メニューの両方から呼ぶ共通関数。

/** 移動 API を叩く。成功で { ok:true }、失敗で { ok:false, error } を返す。 */
async function moveDeliverable(
  relpath: string,
  destDir: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/deliverables/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relpath, destDir }),
    });
    if (res.ok) return { ok: true };
    let msg = `移動に失敗しました（HTTP ${res.status}）。`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* JSON でなければ既定メッセージ。 */
    }
    return { ok: false, error: msg };
  } catch {
    return { ok: false, error: 'ネットワークエラーで移動に失敗しました。' };
  }
}

/** relpath の親ディレクトリ（DELIVERABLES_DIR 相対、ルート直下は ''）。 */
function parentDirOf(relpath: string): string {
  const idx = relpath.lastIndexOf('/');
  return idx >= 0 ? relpath.slice(0, idx) : '';
}

// ─── 最近使った項目（MC-232）──────────────────────────────────
// 開いた / アップロードした項目を localStorage に記録し、上位を「最近使った」に出す。

const RECENT_STORAGE_KEY = 'apollo.deliverables.recent';
const RECENT_MAX = 12;

interface RecentItem {
  relpath: string;
  name: string;
  at: number; // epoch ms
}

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentItem =>
          !!x &&
          typeof (x as RecentItem).relpath === 'string' &&
          typeof (x as RecentItem).name === 'string' &&
          typeof (x as RecentItem).at === 'number',
      )
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function pushRecent(relpath: string, name: string): RecentItem[] {
  const now = Date.now();
  const prev = loadRecent().filter((r) => r.relpath !== relpath);
  const next = [{ relpath, name, at: now }, ...prev].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage 不可は永続化なしで続行。 */
  }
  return next;
}

// ─── リネーム（MC-227）────────────────────────────────────
// インライン名前編集。入力 → POST /api/deliverables/rename → 成功で onRenamed（refetch）。

interface RenameState {
  editing: boolean;
  value: string;
  saving: boolean;
  error: string | null;
}

// ─── 選択 / ドラッグ&ドロップ 共通インタラクション（MC-228 / MC-229）───────────
// FileCard / FileRow / FolderNodeView に共通で渡すハンドラ束。
// selection は relpath の集合、onSelectToggle はモディファイア付きクリックを処理する。
const DND_MIME = 'application/x-apollo-deliverable';

interface ItemInteractions {
  selectedPaths: Set<string>;
  // クリック選択（modifiers: shift=連続, meta/ctrl=個別トグル）。
  onSelectToggle: (relpath: string, modifiers: { shift: boolean; meta: boolean }) => void;
  // D&D: アイテムをフォルダ（destDir, '' はルート）へドロップした時に呼ぶ。
  onDropMove: (srcPath: string, destDir: string) => void;
  // ドラッグ中の relpath（ドロップ先の自己無効化判定に使う）。
  draggingPath: string | null;
  setDraggingPath: (p: string | null) => void;
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
  file, onDelete, onView, onRenamed, onMoveRequest, interactions,
}: {
  file: DeliverableFile;
  onDelete: (f: DeliverableFile) => void;
  onView: (f: DeliverableFile) => void;
  onRenamed: () => void;
  onMoveRequest: (f: DeliverableFile) => void;
  interactions: ItemInteractions;
}) {
  const isImage =
    file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isPdf = file.kind === 'pdf';
  const officePreviewable = isOfficePreviewable(file);
  const isText = TEXT_KINDS.has(file.kind) || file.ext.toLowerCase() === CSV_EXT;
  const viewable = isImage || isPdf || officePreviewable || isText;
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;
  const selected = interactions.selectedPaths.has(file.relpath);

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
    <div
      draggable={!rename.editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, file.relpath);
        e.dataTransfer.effectAllowed = 'move';
        interactions.setDraggingPath(file.relpath);
      }}
      onDragEnd={() => interactions.setDraggingPath(null)}
      onClick={(e) => {
        // モディファイアキー押下時のみ選択トグル（通常クリックはボタン操作を邪魔しない）。
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          interactions.onSelectToggle(file.relpath, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
        }
      }}
      className={`flex flex-col rounded-lg border bg-surface p-4 transition-colors ${
        selected ? 'border-accent ring-1 ring-accent' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => interactions.onSelectToggle(file.relpath, { shift: false, meta: true })}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 shrink-0 accent-accent"
            aria-label={`${file.name} を選択`}
          />
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
          <button
            type="button"
            onClick={() => onMoveRequest(file)}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} を移動`}
          >
            <MoveIcon width={16} height={16} />
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

/** ツリーから指定パス（'' はルート）のノードを返す。無ければ null。 */
function findNode(root: TreeNode, path: string): TreeNode | null {
  if (path === '') return root;
  let node: TreeNode = root;
  for (const part of path.split('/')) {
    const next = node.subdirs.get(part);
    if (!next) return null;
    node = next;
  }
  return node;
}

function FileRow({
  file, onDelete, indent, onView, onRenamed, onMoveRequest, interactions,
}: {
  file: DeliverableFile;
  onDelete: (f: DeliverableFile) => void;
  indent: number;
  onView: (f: DeliverableFile) => void;
  onRenamed: () => void;
  onMoveRequest: (f: DeliverableFile) => void;
  interactions: ItemInteractions;
}) {
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;
  const [rename, setRename] = useState<RenameState>({ editing: false, value: '', saving: false, error: null });
  const selected = interactions.selectedPaths.has(file.relpath);

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
      <div
        draggable={!rename.editing}
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_MIME, file.relpath);
          e.dataTransfer.effectAllowed = 'move';
          interactions.setDraggingPath(file.relpath);
        }}
        onDragEnd={() => interactions.setDraggingPath(null)}
        onClick={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            e.preventDefault();
            interactions.onSelectToggle(file.relpath, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
          }
        }}
        className={`flex items-center gap-2 rounded px-2 py-1.5 group ${
          selected ? 'bg-accent/10 ring-1 ring-inset ring-accent' : 'hover:bg-surface-2'
        }`}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => interactions.onSelectToggle(file.relpath, { shift: false, meta: true })}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0 accent-accent"
          aria-label={`${file.name} を選択`}
        />
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
        <button
          type="button"
          onClick={() => onMoveRequest(file)}
          className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
          aria-label={`${file.name} を移動`}
        >
          <MoveIcon width={14} height={14} />
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
  onMoveRequest, interactions, onOpenFolder,
}: {
  node: TreeNode;
  indent: number;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onDelete: (f: DeliverableFile) => void;
  onView: (f: DeliverableFile) => void;
  onRenamed: () => void;
  sort: SortPref;
  onMoveRequest: (f: DeliverableFile) => void;
  interactions: ItemInteractions;
  onOpenFolder: (path: string) => void;
}) {
  const isOpen = openFolders.has(node.path);
  const total = countFiles(node);
  const [rename, setRename] = useState<RenameState>({ editing: false, value: '', saving: false, error: null });
  const [dropActive, setDropActive] = useState(false);

  // このフォルダを表す合成 DeliverableFile（移動/選択ハンドラに渡すため）。
  const folderAsFile: DeliverableFile = {
    name: node.name,
    relpath: node.path,
    sizeBytes: 0,
    mtime: new Date().toISOString(),
    ext: '',
    kind: 'folder',
    isDir: true,
  };
  const selected = interactions.selectedPaths.has(node.path);

  // 子フォルダはフォルダ名で安定ソート、ファイルは選択中ソートを適用。
  const subdirs = Array.from(node.subdirs.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }),
  );
  const files = sortFiles(node.files, sort);

  // ドロップ受理可否: 自分自身/子孫をこのフォルダへは入れられない（循環）。
  const canAcceptDrop = (srcPath: string | null): boolean => {
    if (!srcPath) return false;
    if (srcPath === node.path) return false;
    if (node.path === srcPath || node.path.startsWith(srcPath + '/')) return false;
    // 既にこのフォルダ直下に在るものは移動不要。
    if (parentDirOf(srcPath) === node.path) return false;
    return true;
  };

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
        draggable={!rename.editing}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(DND_MIME, node.path);
          e.dataTransfer.effectAllowed = 'move';
          interactions.setDraggingPath(node.path);
        }}
        onDragEnd={() => interactions.setDraggingPath(null)}
        onDragOver={(e) => {
          if (canAcceptDrop(interactions.draggingPath)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!dropActive) setDropActive(true);
          }
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropActive(false);
          const src = e.dataTransfer.getData(DND_MIME) || interactions.draggingPath;
          if (src && canAcceptDrop(src)) interactions.onDropMove(src, node.path);
          interactions.setDraggingPath(null);
        }}
        style={{ paddingLeft: `${indent * 20}px` }}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 group ${
          dropActive
            ? 'bg-accent/20 ring-1 ring-inset ring-accent'
            : selected
              ? 'bg-accent/10 ring-1 ring-inset ring-accent'
              : 'hover:bg-surface-2'
        }`}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => interactions.onSelectToggle(node.path, { shift: false, meta: true })}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0 accent-accent"
          aria-label={`${node.name} を選択`}
        />
        <button
          type="button"
          onClick={() => toggleFolder(node.path)}
          className="shrink-0 rounded p-0.5 text-text-faint transition-transform duration-100 hover:bg-surface-3 hover:text-text"
          style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          aria-label={isOpen ? `${node.name} を閉じる` : `${node.name} を開く`}
          aria-expanded={isOpen}
        >
          <ChevronRightIcon width={14} height={14} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
              e.preventDefault();
              interactions.onSelectToggle(node.path, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
              return;
            }
            onOpenFolder(node.path);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
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
              onDoubleClick={(e) => { e.stopPropagation(); setRename({ editing: true, value: node.name, saving: false, error: null }); }}
              title={`${node.name}（クリックで開く / ダブルクリックで名前を変更）`}
            >{node.name}</span>
          )}
        </button>
        {!rename.editing && (
          <>
            <button
              type="button"
              onClick={() => setRename({ editing: true, value: node.name, saving: false, error: null })}
              className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
              aria-label={`${node.name} の名前を変更`}
            >
              <EditIcon width={14} height={14} />
            </button>
            <button
              type="button"
              onClick={() => onMoveRequest(folderAsFile)}
              className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
              aria-label={`${node.name} を移動`}
            >
              <MoveIcon width={14} height={14} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(folderAsFile)}
              className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text"
              aria-label={`${node.name} を削除`}
            >
              <TrashIcon width={14} height={14} />
            </button>
          </>
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
              onMoveRequest={onMoveRequest}
              interactions={interactions}
              onOpenFolder={onOpenFolder}
            />
          ))}
          {files.map((f) => (
            <FileRow key={f.relpath} file={f} onDelete={onDelete} indent={indent + 1} onView={onView} onRenamed={onRenamed} onMoveRequest={onMoveRequest} interactions={interactions} />
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

// ─── 移動先フォルダ選択ダイアログ（MC-228）────────────────────────────
// 「移動先を選ぶ」メニュー。フォルダツリーから移動先を選んで確定する。
// 深い階層でも確実に移動できる導線（D&D の代替）。

/** ツリーから全フォルダパス（DELIVERABLES_DIR 相対）を深さ付きで列挙する。 */
interface FolderChoice {
  path: string; // '' はルート
  name: string;
  depth: number;
}

function collectFolderChoices(root: TreeNode): FolderChoice[] {
  const out: FolderChoice[] = [{ path: '', name: 'ドキュメント（ルート）', depth: 0 }];
  function walk(node: TreeNode, depth: number) {
    const subs = Array.from(node.subdirs.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }),
    );
    for (const sub of subs) {
      out.push({ path: sub.path, name: sub.name, depth });
      walk(sub, depth + 1);
    }
  }
  walk(root, 1);
  return out;
}

/**
 * 移動対象（複数可）を受けて移動先フォルダを選ばせ、確定で move を実行する。
 * - 移動元自身・移動元の親・移動元フォルダの子孫は選べない（無効化）。
 */
function MoveDialog({
  items, tree, onDone, onCancel,
}: {
  items: DeliverableFile[];
  tree: TreeNode;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [destDir, setDestDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = collectFolderChoices(tree);

  // 各移動対象について、選べない移動先（現在の親・自分自身フォルダ・その子孫）を判定する。
  const isDisabled = (choicePath: string): boolean => {
    for (const it of items) {
      const curParent = parentDirOf(it.relpath);
      // すでにその親に在る → 移動の意味がない。
      if (choicePath === curParent) return true;
      // フォルダ自身 / その子孫へは入れられない（循環）。
      if (it.isDir) {
        if (choicePath === it.relpath) return true;
        if (choicePath.startsWith(it.relpath + '/')) return true;
      }
    }
    return false;
  };

  const handleConfirm = useCallback(async () => {
    if (destDir === null) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    for (const it of items) {
      const result = await moveDeliverable(it.relpath, destDir);
      if (!result.ok) failed.push(`${it.name}: ${result.error}`);
    }
    setBusy(false);
    if (failed.length > 0) {
      setError(failed.join(' / '));
      return;
    }
    onDone();
  }, [destDir, items, onDone]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4 backdrop-blur"
      onClick={onCancel}
      role="dialog"
      aria-modal
      aria-label="移動先を選ぶ"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold text-text">移動先を選ぶ</h2>
        <p className="mb-3 truncate text-xs text-text-faint">
          {items.length === 1 ? items[0].name : `${items.length} 件のアイテム`} の移動先フォルダ
        </p>
        <div className="mb-3 flex-1 overflow-y-auto rounded-lg border border-border bg-surface-2">
          {choices.map((c) => {
            const disabled = isDisabled(c.path);
            const selected = destDir === c.path;
            return (
              <button
                key={c.path || '__root__'}
                type="button"
                disabled={disabled}
                onClick={() => setDestDir(c.path)}
                style={{ paddingLeft: `${8 + c.depth * 16}px` }}
                className={`flex w-full items-center gap-1.5 py-1.5 pr-2 text-left text-xs transition-colors ${
                  selected
                    ? 'bg-accent text-bg font-semibold'
                    : disabled
                      ? 'cursor-not-allowed text-text-faint opacity-50'
                      : 'text-text-muted hover:bg-surface-3 hover:text-text'
                }`}
              >
                <span className="shrink-0">
                  <FolderIcon width={14} height={14} />
                </span>
                <span className="truncate">{c.name}</span>
              </button>
            );
          })}
        </div>
        {error && (
          <p className="mb-2 text-xs" style={{ color: 'var(--mc-stalled)' }}>{error}</p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full px-3 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || destDir === null}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
          >
            <MoveIcon width={13} height={13} />
            {busy ? '移動中…' : 'ここへ移動'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 一括操作ツールバー（MC-229）──────────────────────────────────
// 選択中のみ表示する文脈ツールバー。選択数バッジ＋一括削除/移動/ダウンロード。
function SelectionToolbar({
  count, onMove, onDelete, onDownload, onClear,
}: {
  count: number;
  onMove: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-accent/50 bg-surface-2 px-3 py-2">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-bg">
        <CheckIcon width={13} height={13} />
        {count} 件を選択中
      </span>
      <button
        type="button"
        onClick={onMove}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
      >
        <MoveIcon width={13} height={13} />
        移動
      </button>
      <button
        type="button"
        onClick={onDownload}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
      >
        <DownloadIcon width={13} height={13} />
        ダウンロード
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-bg transition-opacity hover:opacity-90"
        style={{ backgroundColor: 'var(--mc-stalled)' }}
      >
        <TrashIcon width={13} height={13} />
        削除
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-surface-3 hover:text-text"
      >
        <CloseIcon width={13} height={13} />
        選択解除
      </button>
    </div>
  );
}

// ─── パンくず（MC-232）────────────────────────────────────────
// 現在地フォルダの各階層をクリックでジャンプできるパンくず。戻る/進む付き。
function Breadcrumb({
  currentDir, onNavigate, canBack, canForward, onBack, onForward,
}: {
  currentDir: string;
  onNavigate: (dir: string) => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  const segments = currentDir === '' ? [] : currentDir.split('/');
  return (
    <div className="mb-3 flex items-center gap-1 overflow-x-auto">
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        className="shrink-0 rounded p-1 text-text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="戻る"
        title="戻る"
      >
        <ChevronLeftIcon width={16} height={16} />
      </button>
      <button
        type="button"
        onClick={onForward}
        disabled={!canForward}
        className="shrink-0 rounded p-1 text-text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="進む"
        title="進む"
      >
        <ChevronRightIcon width={16} height={16} />
      </button>
      <nav className="flex min-w-0 items-center gap-0.5 text-xs" aria-label="現在地">
        <button
          type="button"
          onClick={() => onNavigate('')}
          className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 transition-colors hover:bg-surface-2 ${
            currentDir === '' ? 'font-semibold text-text' : 'text-text-muted hover:text-text'
          }`}
        >
          <FolderIcon width={13} height={13} />
          ドキュメント
        </button>
        {segments.map((seg, i) => {
          const path = segments.slice(0, i + 1).join('/');
          const isLast = i === segments.length - 1;
          return (
            <span key={path} className="flex shrink-0 items-center gap-0.5">
              <span className="text-text-faint">
                <ChevronRightIcon width={12} height={12} />
              </span>
              <button
                type="button"
                onClick={() => onNavigate(path)}
                className={`truncate rounded px-1.5 py-1 transition-colors hover:bg-surface-2 ${
                  isLast ? 'font-semibold text-text' : 'text-text-muted hover:text-text'
                }`}
                title={seg}
              >
                {seg}
              </button>
            </span>
          );
        })}
      </nav>
    </div>
  );
}

// ─── 最近使った項目（MC-232）──────────────────────────────────
function RecentStrip({
  recent, files, onOpen,
}: {
  recent: RecentItem[];
  files: DeliverableFile[];
  onOpen: (f: DeliverableFile) => void;
}) {
  // 実在するファイルだけを表示（削除/移動済みは除外）。
  const byPath = new Map(files.map((f) => [f.relpath, f] as const));
  const live = recent
    .map((r) => byPath.get(r.relpath))
    .filter((f): f is DeliverableFile => !!f && !f.isDir)
    .slice(0, 8);
  if (live.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-text-faint">
        <ClockIcon width={13} height={13} />
        最近使った項目
      </div>
      <div className="flex flex-wrap gap-1.5">
        {live.map((f) => (
          <button
            key={f.relpath}
            type="button"
            onClick={() => onOpen(f)}
            className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
            title={f.relpath}
          >
            <span className="shrink-0 text-text-faint">
              <KindIcon kind={f.kind} ext={f.ext} />
            </span>
            <span className="truncate">{f.name}</span>
          </button>
        ))}
      </div>
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
  // MC-229: 複数選択（relpath 集合）と最後にトグルしたアンカー（Shift 連続選択用）。
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  // MC-228: D&D 中のパス・「移動先を選ぶ」ダイアログ対象。
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [moveTargets, setMoveTargets] = useState<DeliverableFile[] | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  // MC-232: 現在地・ナビ履歴（戻る/進む）・最近使った項目。
  const [currentDir, setCurrentDir] = useState('');
  const [navHistory, setNavHistory] = useState<string[]>(['']);
  const [navIndex, setNavIndex] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>(loadRecent);

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

  // MC-232: 現在地ナビ。新しい遷移は履歴の現在位置以降を切り捨てて積む（ブラウザ履歴と同じ）。
  const navigateTo = useCallback((dir: string) => {
    setCurrentDir((prevDir) => {
      if (prevDir === dir) return prevDir;
      setNavHistory((hist) => hist.slice(0, navIndex + 1).concat(dir));
      setNavIndex((idx) => idx + 1);
      return dir;
    });
  }, [navIndex]);

  const goBack = useCallback(() => {
    if (navIndex <= 0) return;
    const next = navIndex - 1;
    setNavIndex(next);
    setCurrentDir(navHistory[next] ?? '');
  }, [navIndex, navHistory]);

  const goForward = useCallback(() => {
    if (navIndex >= navHistory.length - 1) return;
    const next = navIndex + 1;
    setNavIndex(next);
    setCurrentDir(navHistory[next] ?? '');
  }, [navIndex, navHistory]);

  // MC-232: 最近使った項目に追加（プレビュー/ダウンロード/アップロード時）。
  const recordRecent = useCallback((f: DeliverableFile) => {
    if (f.isDir) return;
    setRecent(pushRecent(f.relpath, f.name));
  }, []);

  // プレビューを開く＝最近使ったに記録。
  const openView = useCallback((f: DeliverableFile) => {
    recordRecent(f);
    setSelectedViewFile(f);
  }, [recordRecent]);

  // MC-229: 現在表示中のアイテム（フォルダ＋ファイル）の表示順 relpath 列。
  // Shift 連続選択の範囲計算に使う。レンダリングのたびに ref を更新する。
  const visiblePathsRef = useRef<string[]>([]);

  // MC-229: モディファイア付きクリックで選択をトグルする。
  //  - meta/ctrl: 個別トグル（アンカー更新）。
  //  - shift: アンカー〜対象の範囲を表示順で一括選択。
  //  - 修飾なし（チェックボックス onChange 経由で meta=true 渡し）も個別トグル。
  const onSelectToggle = useCallback((relpath: string, modifiers: { shift: boolean; meta: boolean }) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (modifiers.shift && selectionAnchor) {
        const order = visiblePathsRef.current;
        const a = order.indexOf(selectionAnchor);
        const b = order.indexOf(relpath);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i += 1) next.add(order[i]);
          return next;
        }
      }
      // 個別トグル。
      if (next.has(relpath)) next.delete(relpath);
      else next.add(relpath);
      return next;
    });
    if (!modifiers.shift) setSelectionAnchor(relpath);
  }, [selectionAnchor]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
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

  // MC-228: D&D / ドロップでの単発移動。
  const handleDropMove = useCallback((srcPath: string, destDir: string) => {
    setOpError(null);
    moveDeliverable(srcPath, destDir).then((result) => {
      if (result.ok) { clearSelection(); refetch(); }
      else setOpError(result.error);
    });
  }, [refetch, clearSelection]);

  // MC-229: 一括削除（ゴミ箱経由。1 件ずつ DELETE する＝MC-230 のゴミ箱に入る）。
  const handleBulkDelete = useCallback(async (items: DeliverableFile[]) => {
    setOpError(null);
    const failed: string[] = [];
    for (const it of items) {
      try {
        const res = await fetch(`/api/deliverables/file?path=${encodeURIComponent(it.relpath)}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          failed.push(`${it.name}: ${body.error ?? `HTTP ${res.status}`}`);
        }
      } catch {
        failed.push(`${it.name}: ネットワークエラー`);
      }
    }
    clearSelection();
    refetch();
    if (failed.length > 0) setOpError(`一部を削除できませんでした: ${failed.join(' / ')}`);
  }, [refetch, clearSelection]);

  // MC-229: 一括ダウンロード（連続 DL。各ファイルを順に取得し a[download] で保存）。
  //  フォルダは直接 DL 不可なのでスキップする。
  const handleBulkDownload = useCallback((items: DeliverableFile[]) => {
    const downloadable = items.filter((f) => !f.isDir);
    downloadable.forEach((f, i) => {
      // 連続 DL はブラウザがまとめてブロックしないよう少し間隔を空ける。
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/api/deliverables/file?path=${encodeURIComponent(f.relpath)}`;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        recordRecent(f);
      }, i * 250);
    });
  }, [recordRecent]);

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

  // MC-232: アップロード検知。アップロード後に新規出現したファイルを「最近使った」に積む。
  // イベントには relpath が乗らないため、既知パス集合との差分で新規を割り出す。
  const knownPathsRef = useRef<Set<string>>(new Set());
  const uploadedPendingRef = useRef(false);

  useEffect(() => {
    const handler = () => { uploadedPendingRef.current = true; refetch(); };
    window.addEventListener('deliverables:uploaded', handler);
    return () => window.removeEventListener('deliverables:uploaded', handler);
  }, [refetch]);

  // files が更新されたら、アップロード直後フラグが立っていれば新規ファイルを recent に記録。
  useEffect(() => {
    const current = data?.files ?? [];
    const currentReal = current.filter((f) => !f.isDir);
    if (uploadedPendingRef.current && knownPathsRef.current.size > 0) {
      const fresh = currentReal.filter((f) => !knownPathsRef.current.has(f.relpath));
      // 新しい順に最大数件だけ積む。
      fresh
        .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime))
        .slice(0, RECENT_MAX)
        .reverse()
        .forEach((f) => { setRecent(pushRecent(f.relpath, f.name)); });
    }
    uploadedPendingRef.current = false;
    knownPathsRef.current = new Set(currentReal.map((f) => f.relpath));
  }, [data]);

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

  // MC-228/232: ツリーと現在地スコープ。currentDir が実在しなくなったらルートへ戻す（移動/削除で消えた場合）。
  const tree = buildTree(files);
  let scopedNode = findNode(tree, currentDir);
  const effectiveDir = scopedNode ? currentDir : '';
  if (!scopedNode) scopedNode = tree;

  // MC-229: 選択集合を実体（DeliverableFile）に解決する。フォルダは合成エントリで補う。
  const allByPath = new Map<string, DeliverableFile>();
  for (const f of files) {
    if (!f.isDir) allByPath.set(f.relpath, f);
  }
  // フォルダ relpath → 合成 folder エントリ（選択フォルダの一括操作用）。
  const folderByPath = new Map<string, DeliverableFile>();
  (function walkFolders(node: TreeNode) {
    for (const sub of node.subdirs.values()) {
      folderByPath.set(sub.path, {
        name: sub.name, relpath: sub.path, sizeBytes: 0,
        mtime: new Date().toISOString(), ext: '', kind: 'folder', isDir: true,
      });
      walkFolders(sub);
    }
  })(tree);
  const selectedItems: DeliverableFile[] = [...selectedPaths]
    .map((p) => allByPath.get(p) ?? folderByPath.get(p))
    .filter((f): f is DeliverableFile => !!f);

  // MC-229: 表示順の relpath 列を構築（Shift 連続選択用）。ref へ反映。
  const orderedVisible: string[] = [];
  if (viewMode === 'list') {
    for (const f of filtered) orderedVisible.push(f.relpath);
  } else {
    // フォルダビュー: 開いているフォルダを深さ優先で（フォルダ→ファイルの表示順に）たどる。
    const walkOrder = (node: TreeNode) => {
      const subs = Array.from(node.subdirs.values()).sort((a, b) =>
        a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }),
      );
      for (const sub of subs) {
        orderedVisible.push(sub.path);
        if (openFolders.has(sub.path)) walkOrder(sub);
      }
      for (const f of sortFiles(node.files, sort)) orderedVisible.push(f.relpath);
    };
    walkOrder(scopedNode);
  }
  visiblePathsRef.current = orderedVisible;

  // MC-228/229: 子コンポーネントへ渡す共通インタラクション束。
  const interactions: ItemInteractions = {
    selectedPaths,
    onSelectToggle,
    onDropMove: handleDropMove,
    draggingPath,
    setDraggingPath,
  };

  const canBack = navIndex > 0;
  const canForward = navIndex < navHistory.length - 1;

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

              {/* MC-232: パンくず + 戻る/進む（フォルダビュー時のみ。リストは平坦なので非表示）。 */}
              {viewMode === 'folder' && (
                <Breadcrumb
                  currentDir={effectiveDir}
                  onNavigate={navigateTo}
                  canBack={canBack}
                  canForward={canForward}
                  onBack={goBack}
                  onForward={goForward}
                />
              )}

              {/* MC-232: 最近使った項目。 */}
              <RecentStrip recent={recent} files={realFiles} onOpen={openView} />

              {/* MC-229: 選択中のみ表示する文脈ツールバー。 */}
              {selectedItems.length > 0 && (
                <SelectionToolbar
                  count={selectedItems.length}
                  onMove={() => setMoveTargets(selectedItems)}
                  onDelete={() => handleBulkDelete(selectedItems)}
                  onDownload={() => handleBulkDownload(selectedItems)}
                  onClear={clearSelection}
                />
              )}

              {opError && (
                <div
                  role="alert"
                  className="mb-3 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
                  style={{ color: 'var(--mc-stalled)' }}
                >
                  {opError}
                </div>
              )}

              {/* フォルダビュー（現在地 currentDir のスコープを表示。ルートはドロップ先にもなる）。 */}
              {viewMode === 'folder' && (
                files.length === 0 ? (
                  <EmptyState>まだ成果物がありません</EmptyState>
                ) : (
                  <div
                    onDragOver={(e) => {
                      // ルート（現在地）直下へのドロップ受理: 既にここ直下に在るもの以外。
                      const src = draggingPath;
                      if (src && parentDirOf(src) !== effectiveDir && src !== effectiveDir) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (!rootDropActive) setRootDropActive(true);
                      }
                    }}
                    onDragLeave={(e) => {
                      // 子要素間の dragleave は無視（境界外のみ解除）。
                      if (e.currentTarget === e.target) setRootDropActive(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setRootDropActive(false);
                      const src = e.dataTransfer.getData(DND_MIME) || draggingPath;
                      if (src && parentDirOf(src) !== effectiveDir && src !== effectiveDir
                        && !(src !== effectiveDir && effectiveDir.startsWith(src + '/'))) {
                        handleDropMove(src, effectiveDir);
                      }
                      setDraggingPath(null);
                    }}
                    className={`rounded-lg border bg-surface py-1 transition-colors ${
                      rootDropActive ? 'border-accent ring-1 ring-inset ring-accent' : 'border-border'
                    }`}
                  >
                    {(() => {
                      const node = scopedNode!;
                      const topDirs = Array.from(node.subdirs.values()).sort((a, b) =>
                        a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }),
                      );
                      const topFiles = sortFiles(node.files, sort);
                      if (topDirs.length === 0 && topFiles.length === 0) {
                        return <EmptyState>このフォルダは空です</EmptyState>;
                      }
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
                              onView={openView}
                              onRenamed={refetch}
                              sort={sort}
                              onMoveRequest={(f) => setMoveTargets([f])}
                              interactions={interactions}
                              onOpenFolder={navigateTo}
                            />
                          ))}
                          {topFiles.map((f) => (
                            <FileRow key={f.relpath} file={f} onDelete={handleDelete} indent={0} onView={openView} onRenamed={refetch} onMoveRequest={(ff) => setMoveTargets([ff])} interactions={interactions} />
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
                      <FileCard key={file.relpath} file={file} onDelete={handleDelete} onView={openView} onRenamed={refetch} onMoveRequest={(f) => setMoveTargets([f])} interactions={interactions} />
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </ResourceState>
      </div>
      {moveTargets && (
        <MoveDialog
          items={moveTargets}
          tree={tree}
          onCancel={() => setMoveTargets(null)}
          onDone={() => { setMoveTargets(null); clearSelection(); refetch(); }}
        />
      )}
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
