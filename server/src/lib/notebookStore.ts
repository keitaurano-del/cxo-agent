// notebookStore — ノートブック（MC-126）のストレージ操作層。
//
// レイアウト: <NOTEBOOKS_DIR>/<id>/
//   meta.json   { id, name, createdAt, updatedAt }
//   sources/    アップした資料の実体
//   extracted/  Office 等から抽出したテキスト（claude が読む用）
//   chat.jsonl  1 行 = 1 メッセージ { ts, role, text }
//   artifacts/  生成物（claude が ./artifacts/ に書く）
//
// すべてのパスは lib/notebookPath.ts で安全化済みの絶対パスを前提に扱う。

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { join, extname, basename } from 'node:path';
import { NOTEBOOKS_DIR, NOTEBOOK_CHAT_MAX_MESSAGES } from '../config.js';
import {
  resolveNotebookDir,
  resolveNotebookSubPath,
  generateNotebookId,
  validateNotebookId,
} from './notebookPath.js';

// ─── 型 ───────────────────────────────────────────────

export interface NotebookMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type SourceKind =
  | 'pdf'
  | 'spreadsheet'
  | 'presentation'
  | 'document'
  | 'image'
  | 'markdown'
  | 'text'
  | 'other';

export interface NotebookFileRef {
  name: string;
  relpath: string; // ノートブック dir 相対（'sources/foo.pdf' / 'artifacts/要約.md'）
  sizeBytes: number;
  mtime: string;
  ext: string;
  kind: SourceKind;
  extracted?: boolean; // 抽出テキストが生成済みか（sources のみ）
}

export interface ChatMessage {
  ts: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface NotebookSummary {
  id: string;
  name: string;
  sourceCount: number;
  artifactCount: number;
  updatedAt: string;
}

export interface NotebookDetail {
  meta: NotebookMeta;
  sources: NotebookFileRef[];
  artifacts: NotebookFileRef[];
  chat: ChatMessage[];
}

// ─── 分類 ──────────────────────────────────────────────

const KIND_BY_EXT: Record<string, SourceKind> = {
  '.pdf': 'pdf',
  '.xlsx': 'spreadsheet',
  '.xls': 'spreadsheet',
  '.csv': 'spreadsheet',
  '.tsv': 'spreadsheet',
  '.ods': 'spreadsheet',
  '.pptx': 'presentation',
  '.ppt': 'presentation',
  '.odp': 'presentation',
  '.docx': 'document',
  '.doc': 'document',
  '.odt': 'document',
  '.rtf': 'document',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.json': 'text',
  '.log': 'text',
  '.yaml': 'text',
  '.yml': 'text',
};

export function kindForExt(ext: string): SourceKind {
  return KIND_BY_EXT[ext.toLowerCase()] ?? 'other';
}

// ─── 配信用 MIME（deliverables collector と同方針）─────────────
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
};

export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

export interface NotebookFileResolved {
  absPath: string;
  name: string;
  contentType: string;
  ext: string;
  kind: SourceKind;
}

/**
 * ノートブック内のファイル（sources/ または artifacts/ 配下）を配信用に解決する。
 * - relpath は notebookPath の realpath / traversal 防御を通す（resolveNotebookSubPath）。
 * - sources/ artifacts/ 配下に限定する（extracted/ や meta.json 等は配信させない）。
 * - 実体が無ければ null。
 */
export function resolveNotebookFile(id: string, relpath: string): NotebookFileResolved | null {
  const cleaned = (relpath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const top = cleaned.split('/')[0];
  if (top !== 'sources' && top !== 'artifacts') {
    return null; // sources/ artifacts/ 以外は配信不可。
  }
  const abs = resolveNotebookSubPath(id, cleaned); // traversal/範囲外→SafePathError
  if (!existsSync(abs)) return null;
  let st;
  try {
    st = statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const ext = extname(abs).toLowerCase();
  return {
    absPath: abs,
    name: basename(abs),
    contentType: contentTypeForExt(ext),
    ext,
    kind: kindForExt(ext),
  };
}

// ─── 内部ヘルパー ───────────────────────────────────────

function metaPath(dir: string): string {
  return join(dir, 'meta.json');
}
function chatPath(dir: string): string {
  return join(dir, 'chat.jsonl');
}

function readMeta(dir: string): NotebookMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(dir), 'utf8')) as NotebookMeta;
  } catch {
    return null;
  }
}

function writeMeta(dir: string, meta: NotebookMeta): void {
  writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2), 'utf8');
}

/** updatedAt を現在時刻に更新する。 */
export function touchNotebook(id: string): void {
  const dir = resolveNotebookDir(id, true);
  const meta = readMeta(dir);
  if (!meta) return;
  meta.updatedAt = new Date().toISOString();
  writeMeta(dir, meta);
}

/** ディレクトリ内のファイル一覧を NotebookFileRef[] にする。 */
function listDir(dir: string, sub: 'sources' | 'artifacts'): NotebookFileRef[] {
  const abs = join(dir, sub);
  if (!existsSync(abs)) return [];
  const extractedDir = join(dir, 'extracted');
  const out: NotebookFileRef[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (ent.name.startsWith('.')) continue;
    let st;
    try {
      st = statSync(join(abs, ent.name));
    } catch {
      continue;
    }
    const ext = extname(ent.name).toLowerCase();
    const ref: NotebookFileRef = {
      name: ent.name,
      relpath: `${sub}/${ent.name}`,
      sizeBytes: st.size,
      mtime: st.mtime.toISOString(),
      ext,
      kind: kindForExt(ext),
    };
    if (sub === 'sources') {
      ref.extracted = existsSync(join(extractedDir, `${ent.name}.txt`));
    }
    out.push(ref);
  }
  out.sort((a, b) => (a.name < b.name ? -1 : 1));
  return out;
}

// ─── 公開 API ──────────────────────────────────────────

function ensureRoot(): void {
  if (!existsSync(NOTEBOOKS_DIR)) mkdirSync(NOTEBOOKS_DIR, { recursive: true });
}

/** 新しいノートブックを作成し、dir 雛形を作る。 */
export function createNotebook(name: string): NotebookMeta {
  ensureRoot();
  // id 衝突を避けてユニークになるまで再生成。
  let id = generateNotebookId();
  while (existsSync(join(NOTEBOOKS_DIR, id))) id = generateNotebookId();
  const dir = join(NOTEBOOKS_DIR, id);
  mkdirSync(join(dir, 'sources'), { recursive: true });
  mkdirSync(join(dir, 'extracted'), { recursive: true });
  mkdirSync(join(dir, 'artifacts'), { recursive: true });
  const now = new Date().toISOString();
  const meta: NotebookMeta = {
    id,
    name: (name || '').trim() || '無題のノートブック',
    createdAt: now,
    updatedAt: now,
  };
  writeMeta(dir, meta);
  writeFileSync(chatPath(dir), '', 'utf8');
  return meta;
}

/**
 * ディレクトリ内のファイル数を返す（stat なし・一覧取得用の軽量版）。
 * listDir と違い statSync を呼ばないため、多数ノートブックの一覧取得が速い。
 */
function countDir(dir: string, sub: 'sources' | 'artifacts'): number {
  const abs = join(dir, sub);
  if (!existsSync(abs)) return 0;
  try {
    return readdirSync(abs, { withFileTypes: true }).filter(
      (e) => e.isFile() && !e.name.startsWith('.'),
    ).length;
  } catch {
    return 0;
  }
}

/** 全ノートブックのサマリ一覧（updatedAt 降順）。 */
export function listNotebooks(): NotebookSummary[] {
  ensureRoot();
  const out: NotebookSummary[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(NOTEBOOKS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    let id: string;
    try {
      id = validateNotebookId(ent.name);
    } catch {
      continue;
    }
    const dir = join(NOTEBOOKS_DIR, id);
    const meta = readMeta(dir);
    if (!meta) continue;
    out.push({
      id: meta.id,
      name: meta.name,
      sourceCount: countDir(dir, 'sources'),
      artifactCount: countDir(dir, 'artifacts'),
      updatedAt: meta.updatedAt,
    });
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

/** ノートブック詳細（meta・sources・artifacts・chat）。存在しなければ null。 */
export function getNotebookDetail(id: string): NotebookDetail | null {
  const dir = resolveNotebookDir(id);
  const meta = readMeta(dir);
  if (!meta) return null;
  return {
    meta,
    sources: listDir(dir, 'sources'),
    artifacts: listDir(dir, 'artifacts'),
    chat: readChat(dir),
  };
}

/** ノートブックを dir ごと削除する。存在しなくても true（冪等）。 */
export function deleteNotebook(id: string): boolean {
  const dir = resolveNotebookDir(id);
  if (!existsSync(dir)) return true;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** chat.jsonl を読む。壊れた行はスキップ。 */
function readChat(dir: string): ChatMessage[] {
  let raw: string;
  try {
    raw = readFileSync(chatPath(dir), 'utf8');
  } catch {
    return [];
  }
  const out: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ChatMessage);
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * chat.jsonl に 1 メッセージ追記する。
 * メッセージ数が NOTEBOOK_CHAT_MAX_MESSAGES の 2 倍を超えたら末尾 MAX 件に切り詰める。
 */
export function appendChat(id: string, msg: ChatMessage): void {
  const dir = resolveNotebookDir(id, true);
  const path = chatPath(dir);
  appendFileSync(path, JSON.stringify(msg) + '\n', 'utf8');

  const max = NOTEBOOK_CHAT_MAX_MESSAGES;
  if (max <= 0) return;
  const all = readChat(dir);
  if (all.length > max * 2) {
    const trimmed = all.slice(-max);
    writeFileSync(path, trimmed.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8');
  }
}

/**
 * 直近 N 件のチャット履歴を返す（ask のコンテキスト渡し用）。
 * getNotebookDetail とは別に軽量に取得できる。
 */
export function readChatHistory(id: string, n: number): ChatMessage[] {
  const dir = resolveNotebookDir(id);
  return readChat(dir).slice(-n);
}

/** sources/<name> と対応する extracted/<name>.txt を削除する。 */
export function deleteSource(id: string, name: string): boolean {
  const dir = resolveNotebookDir(id, true);
  const src = join(dir, 'sources', name);
  let removed = false;
  if (existsSync(src)) {
    unlinkSync(src);
    removed = true;
  }
  const extracted = join(dir, 'extracted', `${name}.txt`);
  if (existsSync(extracted)) {
    try {
      unlinkSync(extracted);
    } catch {
      /* noop */
    }
  }
  return removed;
}

/** artifacts/ の現在のファイル名集合（生成前後の差分検出に使う）。 */
export function artifactNames(id: string): Set<string> {
  const dir = resolveNotebookDir(id);
  return new Set(listDir(dir, 'artifacts').map((f) => f.name));
}

/** artifacts/ の合計バイト数（サイズ上限チェック用）。 */
export function totalArtifactBytes(id: string): number {
  const dir = resolveNotebookDir(id);
  const abs = join(dir, 'artifacts');
  if (!existsSync(abs)) return 0;
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .reduce((sum, e) => {
        try {
          return sum + statSync(join(abs, e.name)).size;
        } catch {
          return sum;
        }
      }, 0);
  } catch {
    return 0;
  }
}
