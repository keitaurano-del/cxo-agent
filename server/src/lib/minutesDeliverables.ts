// 議事録を Deliverables（成果物）ディレクトリへ直接保存するヘルパー。
//
// 保存先: DELIVERABLES_DIR/議事録/<YYYY-MM-DD>_<title>/
//  - 議事録本文を 議事録.md として書き出す。
//  - originalFile があれば同フォルダに元ファイルもコピー保存する。
// 返り値: 保存した relpath 群（DELIVERABLES_DIR 相対、posix 区切り）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DELIVERABLES_DIR } from '../config.js';
import { toDeliverableRelative } from './deliverablePath.js';

/** FS 禁止文字・パス区切りを安全化し、長さを 60 文字に制限する。 */
function sanitizeSegment(s: string): string {
  const cleaned = s
    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_') // eslint-disable-line no-control-regex
    .replace(/\.+$/, '') // 末尾ドット除去
    .trim();
  const safe = cleaned.length > 0 ? cleaned : '議事録';
  return safe.slice(0, 60);
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface OriginalFileInput {
  name: string;
  buffer: Buffer;
  ext: string;
}

export interface SaveMinutesOptions {
  title: string;
  markdownContent: string;
  originalFile?: OriginalFileInput;
  /** 入力に使った元ファイル群（音声・テキスト・PDF など）。sources/ サブフォルダに保存する。 */
  sourceFiles?: OriginalFileInput[];
}

export interface SaveMinutesResult {
  folderRelpath: string;
  minutesRelpath: string;
  originalRelpath?: string;
  sourceRelpaths?: string[];
  relpaths: string[];
}

/**
 * 議事録本文と（あれば）元ファイルを DELIVERABLES_DIR/議事録/<日付>_<タイトル>/ に保存する。
 */
export function saveMinutesToDeliverables(opts: SaveMinutesOptions): SaveMinutesResult {
  const title = sanitizeSegment(opts.title || '議事録');
  const folderName = `${todayYmd()}_${title}`;
  const folderAbs = join(DELIVERABLES_DIR, '議事録', folderName);
  mkdirSync(folderAbs, { recursive: true });

  const minutesAbs = join(folderAbs, '議事録.md');
  writeFileSync(minutesAbs, opts.markdownContent, 'utf-8');

  const relpaths: string[] = [];
  const minutesRelpath = toDeliverableRelative(minutesAbs);
  relpaths.push(minutesRelpath);

  let originalRelpath: string | undefined;
  if (opts.originalFile) {
    const origName = sanitizeSegment(opts.originalFile.name || `元ファイル${opts.originalFile.ext}`);
    const origAbs = join(folderAbs, origName);
    writeFileSync(origAbs, opts.originalFile.buffer);
    originalRelpath = toDeliverableRelative(origAbs);
    relpaths.push(originalRelpath);
  }

  // 入力ファイル群を sources/ サブフォルダに保存する。
  const sourceRelpaths: string[] = [];
  if (opts.sourceFiles && opts.sourceFiles.length > 0) {
    const sourcesAbs = join(folderAbs, 'sources');
    mkdirSync(sourcesAbs, { recursive: true });
    const usedNames = new Set<string>();
    for (const sf of opts.sourceFiles) {
      let baseName = sanitizeSegment(sf.name || `source${sf.ext || ''}`);
      // 同名ファイルが複数ある場合は連番でユニーク化する。
      let finalName = baseName;
      let n = 1;
      while (usedNames.has(finalName)) {
        const dot = baseName.lastIndexOf('.');
        if (dot > 0) {
          finalName = `${baseName.slice(0, dot)}_${n}${baseName.slice(dot)}`;
        } else {
          finalName = `${baseName}_${n}`;
        }
        n += 1;
      }
      usedNames.add(finalName);
      const srcAbs = join(sourcesAbs, finalName);
      writeFileSync(srcAbs, sf.buffer);
      const srcRel = toDeliverableRelative(srcAbs);
      sourceRelpaths.push(srcRel);
      relpaths.push(srcRel);
    }
  }

  return {
    folderRelpath: toDeliverableRelative(folderAbs),
    minutesRelpath,
    ...(originalRelpath ? { originalRelpath } : {}),
    ...(sourceRelpaths.length > 0 ? { sourceRelpaths } : {}),
    relpaths,
  };
}
