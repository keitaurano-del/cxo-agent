import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type DragEvent as ReactDragEvent } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import { MinutesPane } from './Notebooks';

import { useUpload } from '../lib/UploadContext';
import type {
  DeliverableFile,
  DeliverableKind,
  DeliverablesResponse,
  DeliverableMeta,
  DeliverableColor,
  DeliverableMetaResponse,
  TrashEntry,
  TrashResponse,
} from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState } from '../components/ui';
import {
  DownloadIcon,
  UploadIcon,
  FolderIcon,
  FolderPlusIcon,
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
  CopyIcon,
  InfoIcon,
  StarIcon,
  TagIcon,
  LinkIcon,
  SearchIcon,
  MoreIcon,
} from '../components/icons';
import { relativeTime, absoluteTime } from '../lib/time';
import { highlightCode, isHighlightable } from '../lib/codeHighlight';

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

type SortKey = 'name' | 'mtime' | 'created' | 'size';
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
  created: '作成日',
  size: 'サイズ',
};

function loadSortPref(): SortPref {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as Partial<SortPref>;
    const key: SortKey =
      parsed.key === 'name' || parsed.key === 'mtime' || parsed.key === 'created' || parsed.key === 'size'
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
    } else if (pref.key === 'created') {
      cmp = Date.parse(a.created ?? a.mtime) - Date.parse(b.created ?? b.mtime);
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

// ─── 検索フィルタ（MC-237）──────────────────────────────────
// ファイル名インクリメンタル検索＋フィルタチップ（種類/更新日レンジ/タグ）＋スコープ切替。

type DateRange = 'all' | '7d' | '30d' | '90d';
type SearchScope = 'current' | 'all';

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: '期間すべて',
  '7d': '7日以内',
  '30d': '30日以内',
  '90d': '90日以内',
};

const DATE_RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** file の更新日が dateRange 内か（all は常に true）。 */
function matchesDateRange(file: DeliverableFile, range: DateRange): boolean {
  if (range === 'all') return true;
  const days = DATE_RANGE_DAYS[range];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return Date.parse(file.mtime) >= cutoff;
}

/** file が scope（現在フォルダ配下のみ / 全体）に含まれるか。 */
function matchesScope(file: DeliverableFile, scope: SearchScope, currentDir: string): boolean {
  if (scope === 'all' || currentDir === '') return true;
  return file.relpath === currentDir || file.relpath.startsWith(currentDir + '/');
}

// ─── 属性列テーブル + 列幅永続化 + ギャラリー（MC-239）──────────────────

type ColumnKey = 'mtime' | 'created' | 'size' | 'kind';

// 列幅（px）の既定と localStorage キー。name 列は flex（残り幅）なので固定列のみ管理する。
const COL_WIDTH_STORAGE_KEY = 'apollo.deliverables.colWidths';
const DEFAULT_COL_WIDTHS: Record<ColumnKey, number> = {
  mtime: 130,
  created: 130,
  size: 90,
  kind: 110,
};
const COL_MIN_WIDTH = 60;
const COL_MAX_WIDTH = 360;

const COLUMN_LABELS: Record<ColumnKey, string> = {
  mtime: '更新日',
  created: '作成日',
  size: 'サイズ',
  kind: '種類',
};

// ColumnKey は SortKey（name/mtime/created/size）と概ね一致するが、kind はソート不可（種類順は無意味）。
const COLUMN_SORT_KEY: Record<ColumnKey, SortKey | null> = {
  mtime: 'mtime',
  created: 'created',
  size: 'size',
  kind: null,
};

function loadColWidths(): Record<ColumnKey, number> {
  try {
    const raw = localStorage.getItem(COL_WIDTH_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COL_WIDTHS };
    const parsed = JSON.parse(raw) as Partial<Record<ColumnKey, number>>;
    const out = { ...DEFAULT_COL_WIDTHS };
    for (const k of Object.keys(DEFAULT_COL_WIDTHS) as ColumnKey[]) {
      const v = parsed[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = Math.min(COL_MAX_WIDTH, Math.max(COL_MIN_WIDTH, Math.round(v)));
      }
    }
    return out;
  } catch {
    return { ...DEFAULT_COL_WIDTHS };
  }
}

function saveColWidths(w: Record<ColumnKey, number>): void {
  try {
    localStorage.setItem(COL_WIDTH_STORAGE_KEY, JSON.stringify(w));
  } catch {
    /* 永続化不可は無視。 */
  }
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

// MC-235: コピー/複製。destDir が元の親と同じなら複製（サーバ側で「のコピー」サフィックス付与）。
async function copyDeliverable(
  relpath: string,
  destDir: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/deliverables/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relpath, destDir }),
    });
    if (res.ok) return { ok: true };
    let msg = `コピーに失敗しました（HTTP ${res.status}）。`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* JSON でなければ既定メッセージ。 */
    }
    return { ok: false, error: msg };
  } catch {
    return { ok: false, error: 'ネットワークエラーでコピーに失敗しました。' };
  }
}

/** relpath の親ディレクトリ（DELIVERABLES_DIR 相対、ルート直下は ''）。 */
function parentDirOf(relpath: string): string {
  const idx = relpath.lastIndexOf('/');
  return idx >= 0 ? relpath.slice(0, idx) : '';
}

// ─── メタデータ（スター/タグ/色ラベル）（MC-238）──────────────────
// サイドカー store（GET/PUT /api/deliverables/meta）の読み書きと、UI の色定義。

const EMPTY_META: DeliverableMeta = { starred: false, tags: [], color: null };

/** 色ラベルの表示用パレット（CSS 値）。UI chrome は CSS変数優先だが、ラベル色は固定色で識別性を保つ。 */
const COLOR_OPTIONS: Array<{ value: DeliverableColor; label: string; css: string }> = [
  { value: 'red', label: '赤', css: '#ef4444' },
  { value: 'orange', label: 'オレンジ', css: '#f97316' },
  { value: 'yellow', label: '黄', css: '#eab308' },
  { value: 'green', label: '緑', css: '#22c55e' },
  { value: 'blue', label: '青', css: '#3b82f6' },
  { value: 'purple', label: '紫', css: '#a855f7' },
  { value: 'gray', label: 'グレー', css: '#9ca3af' },
];

function colorCss(color: DeliverableColor | null): string | null {
  if (!color) return null;
  return COLOR_OPTIONS.find((c) => c.value === color)?.css ?? null;
}

// ─── パス取得＋コピー（MC-240）──────────────────────────────────
// クリップボードへコピーする（navigator.clipboard、不可環境は execCommand フォールバック）。
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* フォールバックへ。 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** メタ設定 API を叩く。成功で確定メタ、失敗で null。 */
async function setDeliverableMeta(
  relpath: string,
  meta: DeliverableMeta,
): Promise<DeliverableMeta | null> {
  try {
    const res = await fetch('/api/deliverables/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relpath, ...meta }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { meta?: DeliverableMeta };
    return body.meta ?? meta;
  } catch {
    return null;
  }
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
  // MC-235: コピー/複製ダイアログを開く。
  onCopyRequest: (f: DeliverableFile) => void;
  // MC-238: relpath → メタ（スター/タグ/色）。バッジ表示・スター即トグルに使う。
  metaByPath: Map<string, DeliverableMeta>;
  // MC-238: メタを設定する（楽観更新→API→失敗時 refetch は親が担う）。
  onSetMeta: (relpath: string, meta: DeliverableMeta) => void;
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


// 常時のドロップゾーン（ビジーの一因）の代わりに、コンテンツ領域全体を
// 外部ファイル/フォルダのドロップ先にする薄いラッパ。ドラッグ中だけ控えめな
// オーバーレイを出す（Drive 流）。ファイル・フォルダ階層どちらも受ける。
function UploadDropZone({ children }: { children: ReactNode }) {
  const { upload, uploading } = useUpload();
  const [dragOver, setDragOver] = useState(false);
  const depthRef = useRef(0);

  const isFileDrag = (e: ReactDragEvent) =>
    Array.from(e.dataTransfer.types || []).includes('Files');

  return (
    <div
      className="relative h-full"
      onDragEnter={(e) => {
        if (!isFileDrag(e) || uploading) return;
        depthRef.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e) || uploading) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return;
        depthRef.current -= 1;
        if (depthRef.current <= 0) { depthRef.current = 0; setDragOver(false); }
      }}
      onDrop={async (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        depthRef.current = 0;
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
          if (pairs.length > 0) upload(pairs);
        } else if (e.dataTransfer.files.length > 0) {
          upload(Array.from(e.dataTransfer.files).map((f) => ({ file: f, relpath: f.name })));
        }
      }}
    >
      {children}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/5">
          <div className="flex flex-col items-center gap-1.5 text-accent">
            <UploadIcon width={28} height={28} />
            <span className="text-sm font-semibold">ここにドロップしてアップロード</span>
            <span className="text-[11px] text-text-muted">ファイル・フォルダ階層に対応</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Drive 流の控えめなアップロード導線（ツールバーの「+ 新規」ボタン）。
// クリックでファイル/フォルダのアップロードメニューを出す。常時のドロップゾーンは廃止し、
// コンテンツ領域へのドラッグ＆ドロップで同じ upload を受ける。
function UploadButton() {
  const { upload, uploading } = useUpload();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleEntries = useCallback(
    (entries: Array<{ file: File; relpath: string }>) => {
      upload(entries);
      if (inputRef.current) inputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    },
    [upload],
  );

  return (
    <div ref={ref} className="relative">
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={uploading}
        title="新規"
        className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-accent p-2 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50 sm:px-3.5 sm:py-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PlusIcon width={14} height={14} />
        <span className="hidden sm:inline">{uploading ? 'アップロード中…' : '新規'}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            onClick={() => { setOpen(false); inputRef.current?.click(); }}
          >
            <span className="shrink-0 text-text-faint"><UploadIcon width={14} height={14} /></span>
            ファイルをアップロード
          </button>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            onClick={() => { setOpen(false); folderInputRef.current?.click(); }}
          >
            <span className="shrink-0 text-text-faint"><FolderIcon width={14} height={14} /></span>
            フォルダをアップロード
          </button>
        </div>
      )}
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
  // MC-236: テキスト系（既存の text/markdown/csv）に加え、コード拡張子（.ts/.py/.json 等）も
  // テキストとして取得して表示＋シンタックスハイライトする（収集側 kind は 'other' でも拡張子で判定）。
  const isText =
    TEXT_KINDS.has(file.kind) ||
    file.ext.toLowerCase() === '.csv' ||
    isHighlightable(file.ext);
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
    // MC-236: コード/構造化テキストは拡張子判定で軽量シンタックスハイライト。
    const highlightable = isHighlightable(file.ext);
    return (
      <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-3 font-mono text-xs text-text">
        {highlightable ? highlightCode(text, file.ext) : text}
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

// MC-236: ファイルがインラインプレビュー可能か（Quick Look / 矢印送りの対象判定）。
function isPreviewable(file: DeliverableFile): boolean {
  if (file.isDir) return false;
  const isImage = file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isPdf = file.kind === 'pdf';
  const isText =
    TEXT_KINDS.has(file.kind) || file.ext.toLowerCase() === CSV_EXT || isHighlightable(file.ext);
  return isImage || isPdf || isText || isOfficePreviewable(file);
}

// ─── メタバッジ / スタートグル / メタエディタ（MC-238）──────────────────

// MC-238: 色ドット＋スター＋タグを一覧（カード/行）にコンパクト表示するバッジ群。
function MetaBadges({ meta, compact }: { meta: DeliverableMeta | undefined; compact?: boolean }) {
  if (!meta || (!meta.starred && meta.tags.length === 0 && !meta.color)) return null;
  const css = colorCss(meta.color);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {css && (
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: css }}
          aria-label={`色ラベル: ${meta.color}`}
          title={`色ラベル: ${meta.color}`}
        />
      )}
      {meta.starred && (
        <span className="shrink-0" style={{ color: '#eab308' }} aria-label="お気に入り" title="お気に入り">
          <StarIcon width={12} height={12} fill="currentColor" stroke="currentColor" />
        </span>
      )}
      {meta.tags.slice(0, compact ? 1 : 3).map((t) => (
        <span
          key={t}
          className="inline-flex max-w-[7rem] shrink-0 items-center gap-0.5 truncate rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-muted"
          title={t}
        >
          <TagIcon width={9} height={9} />
          <span className="truncate">{t}</span>
        </span>
      ))}
      {meta.tags.length > (compact ? 1 : 3) && (
        <span className="shrink-0 text-[10px] text-text-faint">+{meta.tags.length - (compact ? 1 : 3)}</span>
      )}
    </span>
  );
}

// MC-238: スター即トグル（カード/行のアクション行に置く）。楽観更新は親 onSetMeta が担う。
function StarToggle({
  relpath, meta, onSetMeta, size = 16,
}: {
  relpath: string;
  meta: DeliverableMeta | undefined;
  onSetMeta: (relpath: string, meta: DeliverableMeta) => void;
  size?: number;
}) {
  const m = meta ?? EMPTY_META;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSetMeta(relpath, { ...m, starred: !m.starred }); }}
      className="shrink-0 rounded p-1 transition-colors hover:bg-surface-2"
      style={{ color: m.starred ? '#eab308' : undefined }}
      aria-label={m.starred ? 'お気に入りを解除' : 'お気に入りに追加'}
      aria-pressed={m.starred}
      title={m.starred ? 'お気に入りを解除' : 'お気に入りに追加'}
    >
      <StarIcon
        width={size}
        height={size}
        fill={m.starred ? 'currentColor' : 'none'}
        className={m.starred ? '' : 'text-text-faint hover:text-text'}
      />
    </button>
  );
}

// MC-238: メタ編集（右ペイン詳細用）。スター/色ラベル/タグ（自動補完つき入力）。
function MetaEditor({
  relpath, meta, allTags, onSetMeta,
}: {
  relpath: string;
  meta: DeliverableMeta | undefined;
  allTags: string[];
  onSetMeta: (relpath: string, meta: DeliverableMeta) => void;
}) {
  const m = meta ?? EMPTY_META;
  const [tagInput, setTagInput] = useState('');

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t || m.tags.includes(t)) { setTagInput(''); return; }
    onSetMeta(relpath, { ...m, tags: [...m.tags, t] });
    setTagInput('');
  };
  const removeTag = (t: string) => {
    onSetMeta(relpath, { ...m, tags: m.tags.filter((x) => x !== t) });
  };
  const toggleStar = () => onSetMeta(relpath, { ...m, starred: !m.starred });
  const setColor = (c: DeliverableColor | null) =>
    onSetMeta(relpath, { ...m, color: m.color === c ? null : c });

  // 自動補完候補: 既存タグのうち未付与＆入力に前方一致するもの。
  const suggestions = allTags
    .filter((t) => !m.tags.includes(t) && (tagInput === '' || t.toLowerCase().includes(tagInput.toLowerCase())))
    .slice(0, 6);

  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-surface-2 p-2.5">
      {/* スター + 色ラベル */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleStar}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs transition-colors hover:bg-surface-3"
          style={{ color: m.starred ? '#eab308' : undefined }}
          aria-pressed={m.starred}
        >
          <StarIcon width={13} height={13} fill={m.starred ? 'currentColor' : 'none'} />
          {m.starred ? 'お気に入り' : 'お気に入りに追加'}
        </button>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="色ラベル">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setColor(c.value)}
              className={`h-4 w-4 rounded-full transition-transform hover:scale-110 ${
                m.color === c.value ? 'ring-2 ring-offset-1 ring-offset-surface-2' : ''
              }`}
              style={{ backgroundColor: c.css, ['--tw-ring-color' as string]: c.css }}
              aria-label={`色ラベル: ${c.label}`}
              aria-pressed={m.color === c.value}
              title={c.label}
            />
          ))}
          {m.color && (
            <button
              type="button"
              onClick={() => setColor(null)}
              className="rounded p-0.5 text-text-faint hover:text-text"
              aria-label="色ラベルを外す"
              title="色ラベルを外す"
            >
              <CloseIcon width={12} height={12} />
            </button>
          )}
        </div>
      </div>
      {/* タグ */}
      <div>
        <div className="mb-1 flex flex-wrap gap-1">
          {m.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-text-muted"
            >
              <TagIcon width={10} height={10} />
              {t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="text-text-faint hover:text-text"
                aria-label={`タグ ${t} を削除`}
              >
                <CloseIcon width={10} height={10} />
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); }
          }}
          placeholder="タグを追加（Enter で確定）"
          list={`tag-suggest-${relpath}`}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        {suggestions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {suggestions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addTag(t)}
                className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
              >
                <PlusIcon width={9} height={9} />
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── パス表示＋コピー（MC-240）────────────────────────────────
// 相対パス（relpath、deliverables ルート起点）を表示し、ボタンでクリップボードへコピーする。
function PathRow({ relpath }: { relpath: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyToClipboard(relpath);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-faint">パス（相対）</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
          aria-label="パスをコピー"
        >
          {copied ? <CheckIcon width={11} height={11} /> : <CopyIcon width={11} height={11} />}
          {copied ? 'コピーしました' : 'パスをコピー'}
        </button>
      </div>
      <code className="block break-all font-mono text-[11px] text-text-muted">{relpath}</code>
    </div>
  );
}

// MC-240: 一覧の各行/カードから使う「パスをコピー」ボタン（アイコンのみ・トースト無し）。
function CopyPathButton({ relpath, size = 16 }: { relpath: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyToClipboard(relpath);
        if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }
      }}
      className="shrink-0 rounded p-1 text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
      aria-label="パスをコピー"
      title={copied ? 'コピーしました' : `パスをコピー: ${relpath}`}
      style={{ color: copied ? '#22c55e' : undefined }}
    >
      {copied ? <CheckIcon width={size} height={size} /> : <LinkIcon width={size} height={size} />}
    </button>
  );
}

// MC-236 / MC-241: 選択中ファイルのメタ情報パネル（右ペイン詳細・モーダル詳細で共用）。
// 更新日・作成日（MC-241）は区別して表示し、ツールチップで絶対日時を出す。
function FileMetaPanel({ file }: { file: DeliverableFile }) {
  // [ラベル, 表示値, ツールチップ（絶対日時。無ければ空）]
  const rows: Array<[string, string, string]> = [
    ['種類', KIND_LABELS[file.kind] ?? file.kind, ''],
    ['サイズ', humanReadableSize(file.sizeBytes), ''],
    ['更新日', relativeTime(file.mtime), absoluteTime(file.mtime)],
    ['作成日', relativeTime(file.created), absoluteTime(file.created)],
    ['拡張子', file.ext || '—', ''],
  ];
  return (
    <dl className="space-y-1.5 text-xs">
      {rows.map(([k, v, tip]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-12 shrink-0 text-text-faint">{k}</dt>
          <dd className="min-w-0 break-words text-text-muted" title={tip || undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// MC-236: Quick Look モーダル。矢印キー（←/→）で前後送り、Esc で閉じる。
//  files は送り対象（プレビュー可能ファイルの表示順）、onNavigate で対象を差し替える。
function FileViewer({
  file, files, onNavigate, onClose,
}: {
  file: DeliverableFile;
  files: DeliverableFile[];
  onNavigate: (f: DeliverableFile) => void;
  onClose: () => void;
}) {
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;
  const idx = files.findIndex((f) => f.relpath === file.relpath);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < files.length - 1;

  const goPrev = useCallback(() => {
    if (idx > 0) onNavigate(files[idx - 1]);
  }, [idx, files, onNavigate]);
  const goNext = useCallback(() => {
    if (idx >= 0 && idx < files.length - 1) onNavigate(files[idx + 1]);
  }, [idx, files, onNavigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg/90 p-2 backdrop-blur md:p-6"
      role="dialog"
      aria-modal
      aria-label={`${file.name} プレビュー`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            disabled={!hasPrev}
            className="shrink-0 rounded p-1 text-text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="前のファイル"
            title="前のファイル（←）"
          >
            <ChevronLeftIcon width={18} height={18} />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!hasNext}
            className="shrink-0 rounded p-1 text-text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="次のファイル"
            title="次のファイル（→）"
          >
            <ChevronRightIcon width={18} height={18} />
          </button>
          <span className="truncate text-sm font-medium text-text" title={file.name}>
            {file.name}
          </span>
          {idx >= 0 && files.length > 1 && (
            <span className="shrink-0 text-xs text-text-faint">
              {idx + 1} / {files.length}
            </span>
          )}
        </div>
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
        title="新規フォルダ"
        aria-label="新規フォルダ"
        className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface-2 p-1.5 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text sm:px-3 sm:py-1"
      >
        <FolderPlusIcon width={15} height={15} />
        <span className="hidden sm:inline">新規フォルダ</span>
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
// 並べ替え（Drive 流コンパクト）。現在のキーを示すボタン→クリックでキー選択の
// ポップオーバー。向き（昇順/降順）は別ボタンでトグル。モバイルでも横幅を取らない。
function SortControl({ sort, onChange }: { sort: SortPref; onChange: (s: SortPref) => void }) {
  const keys: SortKey[] = ['name', 'mtime', 'created', 'size'];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
        aria-haspopup="menu"
        aria-expanded={open}
        title="並べ替え"
      >
        <SortIcon width={13} height={13} />
        <span className="hidden sm:inline">{SORT_KEY_LABELS[sort.key]}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
        className="inline-flex items-center rounded-full border border-border bg-surface-2 p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
        aria-label={sort.dir === 'asc' ? '昇順（クリックで降順）' : '降順（クリックで昇順）'}
        title={sort.dir === 'asc' ? '昇順' : '降順'}
      >
        {sort.dir === 'asc' ? <ArrowUpIcon width={14} height={14} /> : <ArrowDownIcon width={14} height={14} />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          {keys.map((k) => (
            <button
              key={k}
              role="menuitemradio"
              aria-checked={sort.key === k}
              type="button"
              onClick={() => {
                onChange({ key: k, dir: sort.key === k ? sort.dir : (k === 'name' ? 'asc' : 'desc') });
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${
                sort.key === k ? 'font-semibold text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              {SORT_KEY_LABELS[k]}
              {sort.key === k && <CheckIcon width={13} height={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 検索フィルタバー（MC-237）──────────────────────────────────
// インクリメンタル検索ボックス＋スコープ切替＋フィルタチップ（種類/更新日/タグ）。
function SearchFilterBar({
  query, onQuery,
  scope, onScope,
  kind, onKind, kindOptions, kindCounts,
  dateRange, onDateRange,
  allTags, tagFilter, onToggleTag,
  onReset, hasActive, hideSearch,
}: {
  query: string;
  onQuery: (q: string) => void;
  scope: SearchScope;
  onScope: (s: SearchScope) => void;
  kind: FilterKind;
  onKind: (k: FilterKind) => void;
  kindOptions: FilterKind[];
  kindCounts: Record<string, number>;
  dateRange: DateRange;
  onDateRange: (r: DateRange) => void;
  allTags: string[];
  tagFilter: Set<string>;
  onToggleTag: (t: string) => void;
  onReset: () => void;
  hasActive: boolean;
  hideSearch?: boolean;
}) {
  const dateRanges: DateRange[] = ['all', '7d', '30d', '90d'];
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-2.5">
      {/* 検索ボックス + スコープ（hideSearch のときは検索本体を出さずスコープ/クリアのみ） */}
      <div className="flex flex-wrap items-center gap-2">
        {!hideSearch && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1">
            <span className="shrink-0 text-text-faint">
              <SearchIcon width={14} height={14} />
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="ファイル名で検索"
              className="min-w-0 flex-1 bg-transparent text-xs text-text placeholder:text-text-faint focus:outline-none"
              aria-label="ファイル名で検索"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQuery('')}
                className="shrink-0 rounded p-0.5 text-text-faint hover:text-text"
                aria-label="検索をクリア"
              >
                <CloseIcon width={12} height={12} />
              </button>
            )}
          </div>
        )}
        <div className="flex shrink-0 rounded-full border border-border bg-surface p-0.5 text-xs" role="group" aria-label="検索スコープ">
          <button
            type="button"
            onClick={() => onScope('current')}
            className={`rounded-full px-2.5 py-1 transition-colors ${
              scope === 'current' ? 'bg-accent text-bg font-semibold' : 'text-text-muted hover:text-text'
            }`}
            aria-pressed={scope === 'current'}
          >
            このフォルダ
          </button>
          <button
            type="button"
            onClick={() => onScope('all')}
            className={`rounded-full px-2.5 py-1 transition-colors ${
              scope === 'all' ? 'bg-accent text-bg font-semibold' : 'text-text-muted hover:text-text'
            }`}
            aria-pressed={scope === 'all'}
          >
            全体
          </button>
        </div>
        {hasActive && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-surface-3 hover:text-text"
          >
            <CloseIcon width={12} height={12} />
            条件をクリア
          </button>
        )}
      </div>
      {/* 種類チップ */}
      {kindOptions.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="種類フィルタ">
          {kindOptions.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKind(k)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                kind === k ? 'bg-accent text-bg font-semibold' : 'bg-surface text-text-muted hover:bg-surface-3 hover:text-text'
              }`}
              aria-pressed={kind === k}
            >
              {KIND_LABELS[k]}
              {k !== 'all' && <span className="ml-1 opacity-70">{kindCounts[k] ?? 0}</span>}
            </button>
          ))}
        </div>
      )}
      {/* 更新日レンジチップ */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="更新日フィルタ">
        {dateRanges.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onDateRange(r)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
              dateRange === r ? 'bg-accent text-bg font-semibold' : 'bg-surface text-text-muted hover:bg-surface-3 hover:text-text'
            }`}
            aria-pressed={dateRange === r}
          >
            <ClockIcon width={10} height={10} />
            {DATE_RANGE_LABELS[r]}
          </button>
        ))}
      </div>
      {/* タグチップ（MC-238 のタグ。タグが存在する時のみ表示）。 */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="タグフィルタ">
          {allTags.map((t) => {
            const on = tagFilter.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleTag(t)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                  on ? 'bg-accent text-bg font-semibold' : 'bg-surface text-text-muted hover:bg-surface-3 hover:text-text'
                }`}
                aria-pressed={on}
              >
                <TagIcon width={10} height={10} />
                {t}
              </button>
            );
          })}
        </div>
      )}
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

// ─── コピー / 複製ダイアログ（MC-235）──────────────────────────────
// コピー対象（複数可）を受けてコピー先フォルダを選ばせ、確定で copy を実行する。
// move と違い「現在の親フォルダ」も選べる（同一フォルダ複製＝「のコピー」サフィックスが付く）。
// フォルダを自分自身/子孫へコピーするのは無効化（無限再帰防止）。
function CopyDialog({
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

  // コピー不可な移動先（フォルダ自身・その子孫）だけを無効化する。
  // move と違い、現在の親へのコピー（複製）は許可するので親は無効化しない。
  const isDisabled = (choicePath: string): boolean => {
    for (const it of items) {
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
      const result = await copyDeliverable(it.relpath, destDir);
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
      aria-label="コピー先を選ぶ"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold text-text">コピー先を選ぶ</h2>
        <p className="mb-3 truncate text-xs text-text-faint">
          {items.length === 1 ? items[0].name : `${items.length} 件のアイテム`}{' '}
          のコピー先フォルダ（同じフォルダを選ぶと複製します）
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
            <CopyIcon width={13} height={13} />
            {busy ? 'コピー中…' : 'ここへコピー'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 一括操作ツールバー（MC-229）──────────────────────────────────
// 選択中のみ表示する文脈ツールバー。選択数バッジ＋一括削除/移動/ダウンロード。
function SelectionToolbar({
  count, onMove, onCopy, onDelete, onDownload, onClear,
}: {
  count: number;
  onMove: () => void;
  onCopy: () => void;
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
        onClick={onCopy}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
      >
        <CopyIcon width={13} height={13} />
        コピー
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


// ─── 属性列テーブル（MC-239）──────────────────────────────────
// 名前/更新日/作成日/サイズ/種類の列を持つテーブル。列ヘッダクリックでソート、
// 列幅は境界ドラッグで調整して localStorage に永続化する。
function AttributeTable({
  files, sort, onSort, colWidths, onColWidths,
  onDelete, onView, onRenamed, onMoveRequest, interactions,
}: {
  files: DeliverableFile[];
  sort: SortPref;
  onSort: (key: SortKey) => void;
  colWidths: Record<ColumnKey, number>;
  onColWidths: (w: Record<ColumnKey, number>) => void;
  onDelete: (f: DeliverableFile) => void;
  onView: (f: DeliverableFile) => void;
  onRenamed: () => void;
  onMoveRequest: (f: DeliverableFile) => void;
  interactions: ItemInteractions;
}) {
  const columns: ColumnKey[] = ['mtime', 'created', 'size', 'kind'];
  const dragRef = useRef<{ key: ColumnKey; startX: number; startW: number } | null>(null);

  const onDragStart = (key: ColumnKey, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startW: colWidths[key] };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = Math.min(COL_MAX_WIDTH, Math.max(COL_MIN_WIDTH, d.startW + (ev.clientX - d.startX)));
      onColWidths({ ...colWidths, [d.key]: Math.round(w) });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const sortIndicator = (key: ColumnKey) => {
    const sk = COLUMN_SORT_KEY[key];
    if (!sk || sort.key !== sk) return null;
    return sort.dir === 'asc'
      ? <ArrowUpIcon width={11} height={11} />
      : <ArrowDownIcon width={11} height={11} />;
  };

  const cellValue = (f: DeliverableFile, key: ColumnKey): { text: string; tip?: string } => {
    if (key === 'mtime') return { text: relativeTime(f.mtime), tip: absoluteTime(f.mtime) };
    if (key === 'created') return { text: relativeTime(f.created), tip: absoluteTime(f.created) };
    if (key === 'size') return { text: f.isDir ? '—' : humanReadableSize(f.sizeBytes) };
    return { text: KIND_LABELS[f.kind] ?? f.kind };
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      {/* ヘッダ */}
      <div className="flex items-center border-b border-border bg-surface-2 px-2 py-1.5 text-[11px] font-semibold text-text-muted">
        <button
          type="button"
          onClick={() => onSort('name')}
          className="flex min-w-0 flex-1 items-center gap-1 px-1 text-left hover:text-text"
        >
          名前
          {sort.key === 'name' && (sort.dir === 'asc'
            ? <ArrowUpIcon width={11} height={11} />
            : <ArrowDownIcon width={11} height={11} />)}
        </button>
        {columns.map((c) => {
          const sk = COLUMN_SORT_KEY[c];
          return (
            <div
              key={c}
              className="relative flex shrink-0 items-center"
              style={{ width: `${colWidths[c]}px` }}
            >
              <button
                type="button"
                onClick={() => sk && onSort(sk)}
                disabled={!sk}
                className={`flex w-full items-center gap-1 px-1 text-left ${sk ? 'hover:text-text' : 'cursor-default'}`}
              >
                {COLUMN_LABELS[c]}
                {sortIndicator(c)}
              </button>
              {/* 列幅ドラッグハンドル（右端境界）。 */}
              <span
                onPointerDown={(e) => onDragStart(c, e)}
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent/40"
                role="separator"
                aria-label={`${COLUMN_LABELS[c]} 列の幅を調整`}
              />
            </div>
          );
        })}
        {/* 操作列スペーサ。 */}
        <div className="w-8 shrink-0" />
      </div>
      {/* 行 */}
      {files.map((f) => {
        const selected = interactions.selectedPaths.has(f.relpath);
        return (
          <AttributeTableRow
            key={f.relpath}
            file={f}
            columns={columns}
            colWidths={colWidths}
            cellValue={cellValue}
            selected={selected}
            onDelete={onDelete}
            onView={onView}
            onRenamed={onRenamed}
            onMoveRequest={onMoveRequest}
            interactions={interactions}
          />
        );
      })}
    </div>
  );
}

function AttributeTableRow({
  file, columns, colWidths, cellValue, selected,
  onDelete, onView, onRenamed, onMoveRequest, interactions,
}: {
  file: DeliverableFile;
  columns: ColumnKey[];
  colWidths: Record<ColumnKey, number>;
  cellValue: (f: DeliverableFile, key: ColumnKey) => { text: string; tip?: string };
  selected: boolean;
  onDelete: (f: DeliverableFile) => void;
  onView: (f: DeliverableFile) => void;
  onRenamed: () => void;
  onMoveRequest: (f: DeliverableFile) => void;
  interactions: ItemInteractions;
}) {
  const isImage = file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const isText = TEXT_KINDS.has(file.kind) || file.ext.toLowerCase() === CSV_EXT || isHighlightable(file.ext);
  const viewable = isImage || file.kind === 'pdf' || isOfficePreviewable(file) || isText;
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;
  const [rename, setRename] = useState<RenameState>({ editing: false, value: '', saving: false, error: null });

  const commitRename = useCallback(async (value: string) => {
    const next = value.trim();
    if (!next || next === file.name) { setRename({ editing: false, value: '', saving: false, error: null }); return; }
    setRename((r) => ({ ...r, saving: true, error: null }));
    const result = await renameDeliverable(file.relpath, next);
    if (result.ok) { setRename({ editing: false, value: '', saving: false, error: null }); onRenamed(); }
    else setRename((r) => ({ ...r, saving: false, error: result.error }));
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
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          interactions.onSelectToggle(file.relpath, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
        }
      }}
      className={`group flex items-center border-b border-border/50 px-2 py-1.5 text-xs last:border-b-0 ${
        selected ? 'bg-accent/10' : 'hover:bg-surface-2'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => interactions.onSelectToggle(file.relpath, { shift: false, meta: true })}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0 accent-accent"
          aria-label={`${file.name} を選択`}
        />
        <span className="shrink-0 text-text-faint"><KindIcon kind={file.kind} ext={file.ext} /></span>
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
            className="min-w-0 flex-1 truncate text-left text-text"
            title={`${file.name}（ダブルクリックで名前を変更）`}
          >{file.name}</button>
        )}
        <MetaBadges meta={interactions.metaByPath.get(file.relpath)} compact />
      </div>
      {columns.map((c) => {
        const { text, tip } = cellValue(file, c);
        return (
          <div
            key={c}
            className="shrink-0 truncate px-1 text-text-muted"
            style={{ width: `${colWidths[c]}px` }}
            title={tip}
          >{text}</div>
        );
      })}
      <div className="flex w-8 shrink-0 items-center justify-end gap-0.5">
        <StarToggle relpath={file.relpath} meta={interactions.metaByPath.get(file.relpath)} onSetMeta={interactions.onSetMeta} size={14} />
        {viewable && (
          <button type="button" onClick={() => onView(file)} className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text" aria-label={`${file.name} をプレビュー`}>
            <EyeIcon width={14} height={14} />
          </button>
        )}
        <button type="button" onClick={() => onMoveRequest(file)} className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text" aria-label={`${file.name} を移動`}>
          <MoveIcon width={14} height={14} />
        </button>
        <button type="button" onClick={() => interactions.onCopyRequest(file)} className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text" aria-label={`${file.name} をコピー`}>
          <CopyIcon width={14} height={14} />
        </button>
        <span className="shrink-0 opacity-0 group-hover:opacity-100"><CopyPathButton relpath={file.relpath} size={14} /></span>
        <a href={downloadHref} download={file.name} className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text" aria-label={`${file.name} をダウンロード`}>
          <DownloadIcon width={14} height={14} />
        </a>
        <button type="button" onClick={() => onDelete(file)} className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text" aria-label={`${file.name} を削除`}>
          <TrashIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

// ─── ギャラリービュー（MC-239）──────────────────────────────────
// 画像が多いフォルダ向け。大サムネのグリッド＋下部フィルムストリップ送り。
// 画像以外も大アイコンで並べるが、メインは画像。
function GalleryView({
  files, onView, interactions,
}: {
  files: DeliverableFile[];
  onView: (f: DeliverableFile) => void;
  interactions: ItemInteractions;
}) {
  const images = files.filter((f) => f.kind === 'image' || IMG_EXTS.has(f.ext.toLowerCase()));
  const [active, setActive] = useState(0);
  const safeActive = Math.min(active, Math.max(0, images.length - 1));
  if (images.length === 0) {
    return <EmptyState>このフォルダに画像はありません</EmptyState>;
  }
  const current = images[safeActive];
  const thumbSrc = (f: DeliverableFile) => `/api/deliverables/file?path=${encodeURIComponent(f.relpath)}&inline=1`;
  return (
    <div className="space-y-3">
      {/* 大プレビュー */}
      <div className="rounded-lg border border-border bg-surface p-2">
        <button
          type="button"
          onClick={() => onView(current)}
          className="block w-full overflow-hidden rounded"
          aria-label={`${current.name} を拡大表示`}
        >
          <img src={thumbSrc(current)} alt={current.name} className="mx-auto max-h-[55vh] w-auto object-contain" loading="lazy" />
        </button>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-text-muted" title={current.relpath}>{current.name}</span>
          <span className="shrink-0 text-text-faint">{safeActive + 1} / {images.length}</span>
        </div>
      </div>
      {/* フィルムストリップ */}
      <div className="flex gap-2 overflow-x-auto rounded-lg border border-border bg-surface-2 p-2">
        {images.map((f, i) => (
          <button
            key={f.relpath}
            type="button"
            onClick={() => setActive(i)}
            className={`shrink-0 overflow-hidden rounded border transition-colors ${
              i === safeActive ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-accent/50'
            }`}
            aria-label={`${f.name} を選択`}
            aria-current={i === safeActive}
            title={f.name}
          >
            <img src={thumbSrc(f)} alt={f.name} className="h-16 w-16 object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      {/* 大サムネグリッド */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((f, i) => {
          const selected = interactions.selectedPaths.has(f.relpath);
          return (
            <button
              key={f.relpath}
              type="button"
              onClick={(e) => {
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  interactions.onSelectToggle(f.relpath, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
                  return;
                }
                setActive(i);
                onView(f);
              }}
              className={`overflow-hidden rounded-lg border bg-surface transition-colors ${
                selected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-accent/50'
              }`}
              title={f.name}
            >
              <img src={thumbSrc(f)} alt={f.name} className="h-32 w-full object-cover" loading="lazy" />
              <div className="flex items-center gap-1 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-left text-[11px] text-text-muted">{f.name}</span>
                <MetaBadges meta={interactions.metaByPath.get(f.relpath)} compact />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Drive 風レイアウト用コンポーネント（ドキュメント再設計）────────────
// 情報設計: パンくずで階層を潜り、フォルダ section とファイル section を
// 余白広めのカードグリッドで分離表示する。ファイル操作はカード上に常時出さず、
// ホバー/クリックで開くケバブ(︙)メニューに集約してビジーさを抑える。

// セクション見出し（「フォルダ」「ファイル」）。静かなトーンで件数を添える。
function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2 mt-1 flex items-center gap-2 px-0.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">{label}</span>
      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-faint">{count}</span>
    </div>
  );
}

// ケバブ（︙）メニュー。Drive 流に、ファイル/フォルダ操作をホバーで現れる
// ボタン→クリックで開くポップオーバーに収める。actions は表示順の配列。
interface KebabAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  href?: string;
  download?: string;
}
function KebabMenu({ actions, label }: { actions: KebabAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        className={`rounded-full p-1 text-text-faint transition-colors hover:bg-surface-3 hover:text-text ${
          open ? 'bg-surface-3 text-text opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
        aria-label={`${label} の操作`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreIcon width={16} height={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((a, i) => {
            const cls = `flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${
              a.danger ? 'text-stalled' : 'text-text-muted hover:text-text'
            }`;
            const inner = (
              <>
                <span className="shrink-0 text-text-faint">{a.icon}</span>
                {a.label}
              </>
            );
            if (a.href) {
              return (
                <a key={i} role="menuitem" href={a.href} download={a.download} className={cls} onClick={() => setOpen(false)}>
                  {inner}
                </a>
              );
            }
            return (
              <button key={i} role="menuitem" type="button" className={cls} onClick={() => { setOpen(false); a.onClick(); }}>
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// フォルダカード（Drive 流）。クリックで中に入る。常時ツリー展開はしない。
// ドロップ先・選択・リネーム・ケバブ操作を持つ。
function FolderCard({
  node, onOpenFolder, onDelete, onRenamed, onMoveRequest, interactions,
}: {
  node: TreeNode;
  onOpenFolder: (path: string) => void;
  onDelete: (f: DeliverableFile) => void;
  onRenamed: () => void;
  onMoveRequest: (f: DeliverableFile) => void;
  interactions: ItemInteractions;
}) {
  const total = countFiles(node);
  const [rename, setRename] = useState<RenameState>({ editing: false, value: '', saving: false, error: null });
  const [dropActive, setDropActive] = useState(false);
  const selected = interactions.selectedPaths.has(node.path);

  const folderAsFile: DeliverableFile = {
    name: node.name, relpath: node.path, sizeBytes: 0,
    mtime: new Date().toISOString(), created: new Date().toISOString(),
    ext: '', kind: 'folder', isDir: true,
  };

  const canAcceptDrop = (srcPath: string | null): boolean => {
    if (!srcPath) return false;
    if (srcPath === node.path) return false;
    if (node.path === srcPath || node.path.startsWith(srcPath + '/')) return false;
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

  const actions: KebabAction[] = [
    { label: '名前を変更', icon: <EditIcon width={14} height={14} />, onClick: () => setRename({ editing: true, value: node.name, saving: false, error: null }) },
    { label: '移動', icon: <MoveIcon width={14} height={14} />, onClick: () => onMoveRequest(folderAsFile) },
    { label: 'コピー', icon: <CopyIcon width={14} height={14} />, onClick: () => interactions.onCopyRequest(folderAsFile) },
    { label: '削除', icon: <TrashIcon width={14} height={14} />, onClick: () => onDelete(folderAsFile), danger: true },
  ];

  return (
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
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          interactions.onSelectToggle(node.path, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
          return;
        }
        if (!rename.editing) onOpenFolder(node.path);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !rename.editing) { e.preventDefault(); onOpenFolder(node.path); } }}
      title={`${node.name}（クリックで開く）`}
      className={`group flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
        dropActive
          ? 'border-accent bg-accent/10 ring-1 ring-inset ring-accent'
          : selected
            ? 'border-accent bg-accent/5 ring-1 ring-inset ring-accent'
            : 'border-border bg-surface hover:bg-surface-2'
      }`}
    >
      <span className="shrink-0 text-text-muted">
        <FolderIcon width={22} height={22} />
      </span>
      {rename.editing ? (
        <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
          <InlineRenameInput
            initial={node.name}
            saving={rename.saving}
            error={rename.error}
            onCommit={commitRename}
            onCancel={() => setRename({ editing: false, value: '', saving: false, error: null })}
          />
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{node.name}</span>
      )}
      {!rename.editing && (
        <>
          <MetaBadges meta={interactions.metaByPath.get(node.path)} compact />
          <span className="shrink-0 text-[11px] text-text-faint">{total}</span>
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <StarToggle relpath={node.path} meta={interactions.metaByPath.get(node.path)} onSetMeta={interactions.onSetMeta} size={15} />
          </span>
          <KebabMenu actions={actions} label={node.name} />
        </>
      )}
    </div>
  );
}

// ファイルカード（Drive 流グリッド）。上部に種別アイコン/画像サムネの面、
// 下に ファイル名＋種別アイコン。操作はケバブに収める。クリックでプレビュー。
function FileCard({
  file, onView, onDelete, onRenamed, onMoveRequest, interactions,
}: {
  file: DeliverableFile;
  onView: (f: DeliverableFile) => void;
  onDelete: (f: DeliverableFile) => void;
  onRenamed: () => void;
  onMoveRequest: (f: DeliverableFile) => void;
  interactions: ItemInteractions;
}) {
  const [rename, setRename] = useState<RenameState>({ editing: false, value: '', saving: false, error: null });
  const selected = interactions.selectedPaths.has(file.relpath);
  const isImage = file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
  const viewable = isPreviewable(file);
  const downloadHref = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}`;
  const thumbSrc = `/api/deliverables/file?path=${encodeURIComponent(file.relpath)}&inline=1`;

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

  const actions: KebabAction[] = [
    ...(viewable ? [{ label: 'プレビュー', icon: <EyeIcon width={14} height={14} />, onClick: () => onView(file) }] : []),
    { label: '名前を変更', icon: <EditIcon width={14} height={14} />, onClick: () => setRename({ editing: true, value: file.name, saving: false, error: null }) },
    { label: '移動', icon: <MoveIcon width={14} height={14} />, onClick: () => onMoveRequest(file) },
    { label: 'コピー', icon: <CopyIcon width={14} height={14} />, onClick: () => interactions.onCopyRequest(file) },
    { label: 'ダウンロード', icon: <DownloadIcon width={14} height={14} />, onClick: () => {}, href: downloadHref, download: file.name },
    { label: '削除', icon: <TrashIcon width={14} height={14} />, onClick: () => onDelete(file), danger: true },
  ];

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
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          interactions.onSelectToggle(file.relpath, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
          return;
        }
        if (!rename.editing && viewable) onView(file);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !rename.editing && viewable) { e.preventDefault(); onView(file); } }}
      title={file.name}
      className={`group flex flex-col overflow-hidden rounded-xl border transition-colors ${
        selected ? 'border-accent ring-1 ring-inset ring-accent' : 'border-border hover:border-border-strong'
      } ${viewable ? 'cursor-pointer' : ''} bg-surface`}
    >
      {/* 面: 画像はサムネ、それ以外は種別アイコンを中央に大きく */}
      <div className="relative flex h-28 items-center justify-center overflow-hidden border-b border-border bg-surface-2">
        {isImage ? (
          <img src={thumbSrc} alt={file.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="text-text-faint opacity-80">
            <KindIcon kind={file.kind} ext={file.ext} />
          </span>
        )}
      </div>
      {/* 下段: 名前＋種別アイコン＋ケバブ */}
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <span className="shrink-0 text-text-faint">
          <KindIcon kind={file.kind} ext={file.ext} />
        </span>
        {rename.editing ? (
          <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
            <InlineRenameInput
              initial={file.name}
              saving={rename.saving}
              error={rename.error}
              onCommit={commitRename}
              onCancel={() => setRename({ editing: false, value: '', saving: false, error: null })}
            />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-text">{file.name}</span>
        )}
        {!rename.editing && (
          <>
            <MetaBadges meta={interactions.metaByPath.get(file.relpath)} compact />
            <KebabMenu actions={actions} label={file.name} />
          </>
        )}
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
  // MC-238: メタ（スター/タグ/色）store。楽観更新用にローカル state で保持し、API 成功で確定・失敗で巻き戻す。
  const { data: metaData, refetch: refetchMeta } = useLiveResource<DeliverableMetaResponse>(
    '/api/deliverables/meta',
  );
  const [metaOverrides, setMetaOverrides] = useState<Map<string, DeliverableMeta>>(new Map());
  // MC-238: ファイルとメタを同時に再取得する（rename/move/copy/delete でメタのキー追従を反映させる）。
  const refetchAll = useCallback(() => {
    refetch();
    refetchMeta();
  }, [refetch, refetchMeta]);
  const [filter, setFilter] = useState<FilterKind>('all');
  // MC-237: 検索/フィルタチップ/スコープ。
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [viewMode, setViewMode] = useState<'folder' | 'list' | 'gallery'>('folder');
  // MC-239: 属性列テーブルの列幅（localStorage 永続化）。
  const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>(loadColWidths);
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
  // MC-235: 「コピー先を選ぶ」ダイアログ対象。
  const [copyTargets, setCopyTargets] = useState<DeliverableFile[] | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  // MC-232: 現在地・ナビ履歴（戻る/進む）・最近使った項目。
  const [currentDir, setCurrentDir] = useState('');
  const [navHistory, setNavHistory] = useState<string[]>(['']);
  const [navIndex, setNavIndex] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>(loadRecent);
  // フィルタ（種別/期間/タグ）はデフォルト折りたたみ。Drive 流にビジーさを抑える。
  const [showFilters, setShowFilters] = useState(false);
  // 最近使った項目もデフォルト折りたたみ（控えめな1行）。
  const [showRecent, setShowRecent] = useState(false);

  const changeSort = useCallback((s: SortPref) => {
    setSort(s);
    saveSortPref(s);
  }, []);

  // MC-239: 列ヘッダクリックでソート。同じキーなら昇降反転、別キーなら既定方向で開始。
  const sortByColumn = useCallback((key: SortKey) => {
    setSort((prev) => {
      const next: SortPref =
        prev.key === key
          ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: key === 'name' ? 'asc' : 'desc' };
      saveSortPref(next);
      return next;
    });
  }, []);

  // MC-239: 列幅変更（state 更新＋localStorage 永続化）。
  const changeColWidths = useCallback((w: Record<ColumnKey, number>) => {
    setColWidths(w);
    saveColWidths(w);
  }, []);

  // MC-238: メタ設定。即座にローカル override で反映（楽観更新）→ PUT → 成功で server から refetch、
  // 失敗なら override を破棄して server 値に戻す。
  const onSetMeta = useCallback((relpath: string, meta: DeliverableMeta) => {
    setMetaOverrides((prev) => {
      const next = new Map(prev);
      next.set(relpath, meta);
      return next;
    });
    setDeliverableMeta(relpath, meta).then((confirmed) => {
      if (confirmed) {
        // server 反映済み → store を再取得して override を掃除（confirmed と同期）。
        refetchMeta();
        setMetaOverrides((prev) => {
          const next = new Map(prev);
          next.delete(relpath);
          return next;
        });
      } else {
        // 失敗 → override 破棄（server 値に戻る）。
        setMetaOverrides((prev) => {
          const next = new Map(prev);
          next.delete(relpath);
          return next;
        });
      }
    });
  }, [refetchMeta]);

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
  // MC-236: Space キー Quick Look 用の最新状態（候補ファイルとモーダル占有状態）。
  const quickLookRef = useRef<{ candidate: DeliverableFile | null; busy: boolean }>({
    candidate: null,
    busy: false,
  });

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
          refetchAll();
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setOpError(body.error ?? `削除に失敗しました（HTTP ${res.status}）。`);
      })
      .catch(() => setOpError('ネットワークエラーで削除に失敗しました。'));
  }, [refetchAll]);

  // MC-228: D&D / ドロップでの単発移動。
  const handleDropMove = useCallback((srcPath: string, destDir: string) => {
    setOpError(null);
    moveDeliverable(srcPath, destDir).then((result) => {
      if (result.ok) { clearSelection(); refetchAll(); }
      else setOpError(result.error);
    });
  }, [refetchAll, clearSelection]);

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
    refetchAll();
    if (failed.length > 0) setOpError(`一部を削除できませんでした: ${failed.join(' / ')}`);
  }, [refetchAll, clearSelection]);

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
        if (res.ok) { refetchAll(); return; }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setOpError(body.error ?? '元に戻せませんでした。');
      })
      .catch(() => setOpError('ネットワークエラーで元に戻せませんでした。'));
  }, [pendingUndo, refetchAll]);

  // MC-232: アップロード検知。アップロード後に新規出現したファイルを「最近使った」に積む。
  // イベントには relpath が乗らないため、既知パス集合との差分で新規を割り出す。
  const knownPathsRef = useRef<Set<string>>(new Set());
  const uploadedPendingRef = useRef(false);

  useEffect(() => {
    const handler = () => { uploadedPendingRef.current = true; refetch(); };
    window.addEventListener('deliverables:uploaded', handler);
    return () => window.removeEventListener('deliverables:uploaded', handler);
  }, [refetch]);

  // MC-236: Space キーで選択中ファイルを Quick Look（macOS Finder の挙動に倣う）。
  // 入力欄/テキストエリア/編集中要素にフォーカスがある時、既にモーダル表示中の時は無視。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      const { candidate, busy } = quickLookRef.current;
      if (busy || !candidate) return;
      e.preventDefault();
      setSelectedViewFile(candidate);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        onChanged={refetchAll}
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

  // MC-238: server メタ + ローカル override をマージした実効メタ map（検索のタグ判定でも使う）。
  const metaByPath = new Map<string, DeliverableMeta>();
  if (metaData?.meta) {
    for (const [k, v] of Object.entries(metaData.meta)) metaByPath.set(k, v);
  }
  for (const [k, v] of metaOverrides) metaByPath.set(k, v);
  // MC-238: タグ自動補完/フィルタチップ用の全タグ集合（重複排除・五十音/英字ソート）。
  const allTags = Array.from(
    new Set([...metaByPath.values()].flatMap((m) => m.tags)),
  ).sort((a, b) => a.localeCompare(b, 'ja'));

  // MC-228/232: ツリーと現在地スコープ（フィルタ前に算出。スコープ判定に effectiveDir を使う）。
  const tree = buildTree(files);
  let scopedNode = findNode(tree, currentDir);
  const effectiveDir = scopedNode ? currentDir : '';
  if (!scopedNode) scopedNode = tree;

  // MC-237: ファイル名検索 + 種類 + 更新日レンジ + タグ + スコープ の複合フィルタ predicate。
  const q = searchQuery.trim().toLowerCase();
  const tagFilterActive = tagFilter.size > 0;
  const matchesAllFilters = (f: DeliverableFile): boolean => {
    if (filter !== 'all' && f.kind !== filter) return false;
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (!matchesDateRange(f, dateRange)) return false;
    if (!matchesScope(f, searchScope, effectiveDir)) return false;
    if (tagFilterActive) {
      const tags = metaByPath.get(f.relpath)?.tags ?? [];
      for (const t of tagFilter) if (!tags.includes(t)) return false;
    }
    return true;
  };
  // MC-237: 何らかの検索/フィルタが有効か（フォルダビューを検索結果フラット表示へ切替える判定）。
  const searchActive =
    q !== '' || dateRange !== 'all' || tagFilterActive || filter !== 'all' || searchScope === 'current';

  const filtered = sortFiles(realFiles.filter(matchesAllFilters), sort);

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
        mtime: new Date().toISOString(), created: new Date().toISOString(),
        ext: '', kind: 'folder', isDir: true,
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
  } else if (viewMode === 'gallery') {
    // ギャラリーは画像のみだが、送り対象としては filtered の画像順で十分。
    for (const f of filtered.filter((x) => x.kind === 'image' || IMG_EXTS.has(x.ext.toLowerCase()))) {
      orderedVisible.push(f.relpath);
    }
  } else if (viewMode === 'folder' && searchActive) {
    // 検索結果フラット表示時は filtered 順。
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

  // MC-236: Quick Look の前後送り対象＝表示順のプレビュー可能ファイル列（フォルダ・非対応は除外）。
  const previewableSiblings: DeliverableFile[] = orderedVisible
    .map((p) => allByPath.get(p))
    .filter((f): f is DeliverableFile => !!f && isPreviewable(f));

  // MC-236: Space キーで「現在の対象」を Quick Look。対象＝単一選択 or 最後にトグルしたアンカー。
  // 入力欄フォーカス中・モーダル表示中は無視。最新状態を ref 越しにハンドラへ渡す。
  let detailFile: DeliverableFile | null = null;
  if (selectedPaths.size === 1) {
    const only = allByPath.get([...selectedPaths][0]);
    if (only && isPreviewable(only)) detailFile = only;
  } else if (selectionAnchor) {
    const anchored = allByPath.get(selectionAnchor);
    if (anchored && isPreviewable(anchored)) detailFile = anchored;
  }
  quickLookRef.current = {
    candidate: detailFile,
    busy: !!(selectedViewFile || moveTargets || copyTargets),
  };

  // MC-238/240: 詳細ペインの対象＝単一選択（ファイル/フォルダ問わず）。プレビュー可否に関わらずメタ編集・パスを出す。
  let selectedSingle: DeliverableFile | null = null;
  if (selectedPaths.size === 1) {
    const p = [...selectedPaths][0];
    selectedSingle = allByPath.get(p) ?? folderByPath.get(p) ?? null;
  } else if (selectionAnchor) {
    selectedSingle = allByPath.get(selectionAnchor) ?? folderByPath.get(selectionAnchor) ?? null;
  }

  // MC-228/229/238: 子コンポーネントへ渡す共通インタラクション束。
  const interactions: ItemInteractions = {
    selectedPaths,
    onSelectToggle,
    onDropMove: handleDropMove,
    draggingPath,
    setDraggingPath,
    onCopyRequest: (f) => setCopyTargets([f]),
    metaByPath,
    onSetMeta,
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
      <UploadDropZone>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <div className="flex gap-4">
              <div className="min-w-0 flex-1">
              {/* ── Drive 流ツールバー（1行集約）: パンくず（左・伸長）＋ 操作群（右） ── */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {/* パンくず（フォルダグリッド時のみ。検索中・リスト/ギャラリーは平坦なので非表示） */}
                <div className="order-1 min-w-0 flex-1">
                  {viewMode === 'folder' && !searchActive ? (
                    <Breadcrumb
                      currentDir={effectiveDir}
                      onNavigate={navigateTo}
                      canBack={canBack}
                      canForward={canForward}
                      onBack={goBack}
                      onForward={goForward}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                      <FolderIcon width={14} height={14} />
                      {searchActive ? '検索結果' : 'ドキュメント'}
                    </div>
                  )}
                </div>

                {/* 検索（コンパクト） */}
                <div className="order-3 relative w-full sm:order-2 sm:w-52">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint">
                    <SearchIcon width={14} height={14} />
                  </span>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ファイル名で検索"
                    className="w-full rounded-full border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                    aria-label="ファイル名で検索"
                  />
                </div>

                {/* 操作群: 表示切替 / 並べ替え / フィルタ / 新規 / 新規フォルダ / ゴミ箱 */}
                <div className="order-2 flex flex-wrap items-center gap-1.5 sm:order-3">
                  {/* 表示切替（グリッド⇄リスト）。ギャラリーは画像時のみ補助表示。 */}
                  <div className="flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setViewMode('folder')}
                      title="グリッド表示"
                      aria-label="グリッド表示"
                      aria-pressed={viewMode === 'folder'}
                      className={`inline-flex items-center rounded-full px-2 py-1 transition-colors ${
                        viewMode === 'folder' ? 'bg-accent text-bg' : 'text-text-muted hover:text-text'
                      }`}
                    >
                      <GridIcon width={14} height={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      title="リスト表示"
                      aria-label="リスト表示"
                      aria-pressed={viewMode === 'list'}
                      className={`inline-flex items-center rounded-full px-2 py-1 transition-colors ${
                        viewMode === 'list' ? 'bg-accent text-bg' : 'text-text-muted hover:text-text'
                      }`}
                    >
                      <SortIcon width={14} height={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('gallery')}
                      title="ギャラリー表示（画像）"
                      aria-label="ギャラリー表示"
                      aria-pressed={viewMode === 'gallery'}
                      className={`inline-flex items-center rounded-full px-2 py-1 transition-colors ${
                        viewMode === 'gallery' ? 'bg-accent text-bg' : 'text-text-muted hover:text-text'
                      }`}
                    >
                      <ImageFileIcon width={14} height={14} />
                    </button>
                  </div>

                  {/* 並べ替え（コンパクト） */}
                  <SortControl sort={sort} onChange={changeSort} />

                  {/* フィルタ（種別/期間/タグ）トグル。Drive 流に普段は畳む。 */}
                  <button
                    type="button"
                    onClick={() => setShowFilters((v) => !v)}
                    title="フィルタ"
                    aria-label="フィルタ"
                    aria-pressed={showFilters || searchActive}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      showFilters || (searchActive && filter !== 'all')
                        ? 'border-accent bg-accent/10 text-text'
                        : 'border-border bg-surface-2 text-text-muted hover:text-text'
                    }`}
                  >
                    <TagIcon width={13} height={13} />
                    <span className="hidden sm:inline">フィルタ</span>
                  </button>

                  <UploadButton />
                  <NewFolderButton onCreated={refetch} />
                  <button
                    type="button"
                    onClick={() => setShowTrash(true)}
                    title="ゴミ箱"
                    aria-label="ゴミ箱"
                    className="inline-flex items-center rounded-full border border-border bg-surface-2 p-1.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>
              </div>

              {/* 議事録の作成/履歴は控えめな副導線として1行に。 */}
              <div className="mb-3 flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => { setOpenMinutesHistory(false); setShowMinutesPane(true); }}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1 text-text-muted transition-colors hover:border-accent/50 hover:text-text"
                >
                  <NoteIcon width={13} height={13} />
                  議事録を作成
                </button>
                <button
                  type="button"
                  onClick={() => { setOpenMinutesHistory(true); setShowMinutesPane(true); }}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1 text-text-muted transition-colors hover:border-accent/50 hover:text-text"
                  title="過去の議事録を読み込む"
                >
                  <ClockIcon width={13} height={13} />
                  履歴
                </button>
              </div>

              {/* フィルタ（折りたたみ）: 種別/期間/タグ/スコープ。検索本体はツールバーへ移動済み。 */}
              {(showFilters || (searchActive && filter !== 'all')) && (
                <div className="mb-4">
                  <SearchFilterBar
                    query={searchQuery}
                    onQuery={setSearchQuery}
                    scope={searchScope}
                    onScope={setSearchScope}
                    kind={filter}
                    onKind={setFilter}
                    kindOptions={visibleFilters}
                    kindCounts={Object.fromEntries(
                      visibleFilters.filter((k) => k !== 'all').map((k) => [k, realFiles.filter((f) => f.kind === k).length]),
                    )}
                    dateRange={dateRange}
                    onDateRange={setDateRange}
                    allTags={allTags}
                    tagFilter={tagFilter}
                    onToggleTag={(t) =>
                      setTagFilter((prev) => {
                        const next = new Set(prev);
                        if (next.has(t)) next.delete(t);
                        else next.add(t);
                        return next;
                      })
                    }
                    onReset={() => {
                      setSearchQuery('');
                      setFilter('all');
                      setDateRange('all');
                      setTagFilter(new Set());
                      setSearchScope('all');
                    }}
                    hasActive={searchActive}
                    hideSearch
                  />
                </div>
              )}

              {/* 最近使った項目（控えめな折りたたみ）。 */}
              {(() => {
                const byPath = new Map(realFiles.map((f) => [f.relpath, f] as const));
                const liveRecent = recent
                  .map((r) => byPath.get(r.relpath))
                  .filter((f): f is DeliverableFile => !!f && !f.isDir)
                  .slice(0, 8);
                if (liveRecent.length === 0) return null;
                return (
                  <div className="mb-4">
                    <button
                      type="button"
                      onClick={() => setShowRecent((v) => !v)}
                      className="inline-flex items-center gap-1.5 text-xs text-text-faint transition-colors hover:text-text-muted"
                      aria-expanded={showRecent}
                    >
                      <ClockIcon width={13} height={13} />
                      最近使った項目
                      <span className="text-text-faint">{showRecent ? '−' : `（${liveRecent.length}）`}</span>
                    </button>
                    {showRecent && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {liveRecent.map((f) => (
                          <button
                            key={f.relpath}
                            type="button"
                            onClick={() => openView(f)}
                            className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
                            title={f.relpath}
                          >
                            <span className="shrink-0 text-text-faint"><KindIcon kind={f.kind} ext={f.ext} /></span>
                            <span className="truncate">{f.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* MC-229: 選択中のみ表示する文脈ツールバー。 */}
              {selectedItems.length > 0 && (
                <SelectionToolbar
                  count={selectedItems.length}
                  onMove={() => setMoveTargets(selectedItems)}
                  onCopy={() => setCopyTargets(selectedItems)}
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

              {/* ── グリッド（Drive 流）: フォルダ section ＋ ファイル section を分離 ── */}
              {viewMode === 'folder' && (
                files.length === 0 ? (
                  <EmptyState>まだ成果物がありません</EmptyState>
                ) : (
                  <div
                    onDragOver={(e) => {
                      // 現在地（ルート）直下へのドロップ受理: 既にここ直下に在るもの以外。
                      const src = draggingPath;
                      if (src && parentDirOf(src) !== effectiveDir && src !== effectiveDir) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (!rootDropActive) setRootDropActive(true);
                      }
                    }}
                    onDragLeave={(e) => {
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
                    className={`rounded-xl transition-colors ${
                      rootDropActive ? 'ring-2 ring-inset ring-accent' : ''
                    }`}
                  >
                    {(() => {
                      // 検索/フィルタが有効なら、ツリーでなく該当ファイルのフラット結果をカードで表示。
                      if (searchActive) {
                        if (filtered.length === 0) {
                          return <EmptyState>条件に一致する項目がありません</EmptyState>;
                        }
                        return (
                          <>
                            <SectionHeading label="ファイル" count={filtered.length} />
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                              {filtered.map((f) => (
                                <FileCard key={f.relpath} file={f} onView={openView} onDelete={handleDelete} onRenamed={refetchAll} onMoveRequest={(ff) => setMoveTargets([ff])} interactions={interactions} />
                              ))}
                            </div>
                          </>
                        );
                      }
                      const node = scopedNode!;
                      const topDirs = Array.from(node.subdirs.values()).sort((a, b) =>
                        a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }),
                      );
                      const topFiles = sortFiles(node.files, sort);
                      if (topDirs.length === 0 && topFiles.length === 0) {
                        return <EmptyState>このフォルダは空です</EmptyState>;
                      }
                      return (
                        <div className="space-y-5">
                          {topDirs.length > 0 && (
                            <div>
                              <SectionHeading label="フォルダ" count={topDirs.length} />
                              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {topDirs.map((sub) => (
                                  <FolderCard
                                    key={sub.path}
                                    node={sub}
                                    onOpenFolder={navigateTo}
                                    onDelete={handleDelete}
                                    onRenamed={refetchAll}
                                    onMoveRequest={(f) => setMoveTargets([f])}
                                    interactions={interactions}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          {topFiles.length > 0 && (
                            <div>
                              <SectionHeading label="ファイル" count={topFiles.length} />
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                {topFiles.map((f) => (
                                  <FileCard key={f.relpath} file={f} onView={openView} onDelete={handleDelete} onRenamed={refetchAll} onMoveRequest={(ff) => setMoveTargets([ff])} interactions={interactions} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )
              )}

              {/* リストビュー（属性列テーブル＋列ヘッダソート＋列幅永続化）。 */}
              {viewMode === 'list' && (
                filtered.length === 0 ? (
                  <EmptyState>{searchActive ? '条件に一致する項目がありません' : 'まだ成果物がありません'}</EmptyState>
                ) : (
                  <AttributeTable
                    files={filtered}
                    sort={sort}
                    onSort={sortByColumn}
                    colWidths={colWidths}
                    onColWidths={changeColWidths}
                    onDelete={handleDelete}
                    onView={openView}
                    onRenamed={refetchAll}
                    onMoveRequest={(f) => setMoveTargets([f])}
                    interactions={interactions}
                  />
                )
              )}

              {/* ギャラリービュー（画像向け 大サムネ＋フィルムストリップ）。 */}
              {viewMode === 'gallery' && (
                <GalleryView files={filtered} onView={openView} interactions={interactions} />
              )}
              </div>

              {/* MC-236: 右ペイン詳細（選択中ファイルのメタ＋プレビュー）。
                  Drive 流に、項目を選択している時だけ表示する（空の詳細レールは出さない）。
                  広い画面（xl 以上）でのみ常時表示。狭い画面（〜390px 含む）では非表示にし、
                  Space / プレビューボタンの Quick Look モーダルにフォールバックする。 */}
              {selectedSingle && (
              <aside className="hidden w-72 shrink-0 xl:block">
                <div className="sticky top-0 rounded-lg border border-border bg-surface p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                    <InfoIcon width={14} height={14} />
                    詳細
                  </div>
                  {(
                    <div className="space-y-3">
                      <div className="truncate text-sm font-medium text-text" title={selectedSingle.name}>
                        {selectedSingle.name}
                      </div>
                      {/* プレビューはプレビュー可能ファイルのみ（detailFile）。フォルダ/非対応は省略。 */}
                      {detailFile && detailFile.relpath === selectedSingle.relpath && (
                        <div className="max-h-72 overflow-auto rounded-lg border border-border bg-surface-2">
                          <FileViewerBody file={detailFile} />
                        </div>
                      )}
                      <FileMetaPanel file={selectedSingle} />
                      {/* MC-240: パス表示＋コピー。 */}
                      <PathRow relpath={selectedSingle.relpath} />
                      {/* MC-238: メタ編集（スター/タグ/色）。 */}
                      <MetaEditor
                        relpath={selectedSingle.relpath}
                        meta={metaByPath.get(selectedSingle.relpath)}
                        allTags={allTags}
                        onSetMeta={onSetMeta}
                      />
                      {detailFile && detailFile.relpath === selectedSingle.relpath && (
                        <button
                          type="button"
                          onClick={() => openView(detailFile)}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
                        >
                          <EyeIcon width={13} height={13} />
                          大きく表示（Space）
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </aside>
              )}
            </div>
          )}
        </ResourceState>
      </div>
      </UploadDropZone>
      {moveTargets && (
        <MoveDialog
          items={moveTargets}
          tree={tree}
          onCancel={() => setMoveTargets(null)}
          onDone={() => { setMoveTargets(null); clearSelection(); refetchAll(); }}
        />
      )}
      {copyTargets && (
        <CopyDialog
          items={copyTargets}
          tree={tree}
          onCancel={() => setCopyTargets(null)}
          onDone={() => { setCopyTargets(null); clearSelection(); refetchAll(); }}
        />
      )}
      {selectedViewFile && (
        <FileViewer
          file={selectedViewFile}
          files={previewableSiblings}
          onNavigate={setSelectedViewFile}
          onClose={() => setSelectedViewFile(null)}
        />
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
