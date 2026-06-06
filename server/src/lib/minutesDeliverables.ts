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

export interface SaveMinutesOptions {
  title: string;
  markdownContent: string;
  originalFile?: { name: string; buffer: Buffer; ext: string };
}

export interface SaveMinutesResult {
  folderRelpath: string;
  minutesRelpath: string;
  originalRelpath?: string;
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

  return {
    folderRelpath: toDeliverableRelative(folderAbs),
    minutesRelpath,
    ...(originalRelpath ? { originalRelpath } : {}),
    relpaths,
  };
}
