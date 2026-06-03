// deliverables collector — 成果物（Excel/PowerPoint/PDF/CSV/画像/テキスト/md 等）の
// 一覧・配信のデータ層。Apollo の成果物ビューが使う。
//
// 提供:
//  - listDeliverables() : DELIVERABLES_DIR 配下を再帰走査し、ファイル一覧を返す。
//  - resolveDeliverable(rel) : ダウンロード/プレビュー用に絶対パス + MIME + kind を返す。
//
// すべてのパス入力は lib/deliverablePath.ts（vaultPath と同じ realpath 防御）を通す。

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { DELIVERABLES_DIR } from '../config.js';
import { resolveDeliverablePath, toDeliverableRelative } from '../lib/deliverablePath.js';

// ─── 型 ───────────────────────────────────────────────

/** ファイルの大分類（フロントでアイコン/プレビュー方式を決めるのに使う）。 */
export type DeliverableKind =
  | 'spreadsheet' // xlsx, xls, csv
  | 'presentation' // pptx, ppt
  | 'document' // docx, doc
  | 'pdf'
  | 'image' // png, jpg, gif, webp, svg
  | 'markdown' // md
  | 'text' // txt, json, log 等
  | 'other';

export interface DeliverableFile {
  name: string; // ファイル名（basename）
  relpath: string; // DELIVERABLES_DIR 相対（posix 区切り）
  sizeBytes: number;
  mtime: string; // ISO
  ext: string; // 拡張子（'.xlsx' 等、小文字）
  kind: DeliverableKind;
}

// ─── 分類・MIME ────────────────────────────────────────

const KIND_BY_EXT: Record<string, DeliverableKind> = {
  '.xlsx': 'spreadsheet',
  '.xls': 'spreadsheet',
  '.csv': 'spreadsheet',
  '.pptx': 'presentation',
  '.ppt': 'presentation',
  '.docx': 'document',
  '.doc': 'document',
  '.pdf': 'pdf',
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
  '.tsv': 'text',
  '.yaml': 'text',
  '.yml': 'text',
};

const CONTENT_TYPES: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pdf': 'application/pdf',
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
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
};

export function kindForExt(ext: string): DeliverableKind {
  return KIND_BY_EXT[ext.toLowerCase()] ?? 'other';
}

export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

// 一覧から除外するファイル（README はビューの説明用なので隠す）。
const EXCLUDED_NAMES = new Set(['readme.md', '.gitkeep', '.ds_store']);
// 走査で潜らない/拾わないディレクトリ。
const EXCLUDED_DIRS = new Set(['.git', '.obsidian', '.claude', 'node_modules', '.trash']);

// ─── 一覧 ─────────────────────────────────────────────

/** DELIVERABLES_DIR 配下を再帰走査し、ファイル一覧を新しい順で返す。 */
export function listDeliverables(): DeliverableFile[] {
  const out: DeliverableFile[] = [];
  if (!existsSync(DELIVERABLES_DIR)) return out;

  function walk(absDir: string): void {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (EXCLUDED_DIRS.has(ent.name)) continue;
        walk(abs);
      } else if (ent.isFile()) {
        if (ent.name.startsWith('.')) continue; // 隠しファイルは出さない
        if (EXCLUDED_NAMES.has(ent.name.toLowerCase())) continue;
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        const ext = extname(ent.name).toLowerCase();
        out.push({
          name: ent.name,
          relpath: toDeliverableRelative(abs),
          sizeBytes: st.size,
          mtime: st.mtime.toISOString(),
          ext,
          kind: kindForExt(ext),
        });
      }
    }
  }

  walk(DELIVERABLES_DIR);
  // 新しい順（mtime 降順）。
  out.sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  return out;
}

// ─── 配信（ダウンロード / プレビュー）──────────────────────

export interface DeliverableResolved {
  absPath: string;
  name: string;
  contentType: string;
  ext: string;
  kind: DeliverableKind;
}

/**
 * 成果物を解決する（ダウンロード/プレビュー配信用）。
 * rel は成果物相対パス。安全化を通し、実体が無ければ null。
 */
export function resolveDeliverable(rel: string): DeliverableResolved | null {
  const abs = resolveDeliverablePath(rel); // パストラバーサル検証
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
