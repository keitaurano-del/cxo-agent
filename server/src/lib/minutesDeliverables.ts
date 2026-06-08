// 議事録を Deliverables（成果物）ディレクトリへ直接保存するヘルパー。
//
// 保存先: DELIVERABLES_DIR/議事録/<YYYY-MM-DD>_<title>/
//  - 議事録本文を 議事録.md として書き出す。
//  - originalFile があれば同フォルダに元ファイルもコピー保存する。
// 返り値: 保存した relpath 群（DELIVERABLES_DIR 相対、posix 区切り）。

import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DELIVERABLES_DIR } from '../config.js';
import { resolveDeliverablePath, toDeliverableRelative } from './deliverablePath.js';

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
  /** 設定復元（履歴から開き直し）用メタ。スタイル/エクスポート形式を meta.json に保存する。 */
  styles?: string[];
  exportFormats?: string[];
}

/** 履歴復元用メタ（各議事録フォルダの .minutes-meta.json に保存）。 */
export interface MinutesMeta {
  title: string;
  styles: string[];
  exportFormats: string[];
  createdAt: string;
}

/** 設定復元用メタのファイル名（一覧で拾われないよう先頭ドット）。 */
const META_FILENAME = '.minutes-meta.json';

/** 入力テキストを保存する sources/ 配下のファイル名。 */
const INPUT_TEXT_FILENAME = '入力テキスト.txt';

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

  // 設定復元用メタ（履歴から開き直してスタイル/形式を復元するために使う）。
  // 一覧では拾わない隠しファイル（先頭ドット）として保存し、成果物ツリーには出さない。
  try {
    const meta: MinutesMeta = {
      title: opts.title || '議事録',
      styles: Array.isArray(opts.styles) ? opts.styles : [],
      exportFormats: Array.isArray(opts.exportFormats) ? opts.exportFormats : [],
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(folderAbs, META_FILENAME), JSON.stringify(meta, null, 2), 'utf-8');
  } catch {
    // メタ保存失敗は致命的でない（本文保存は成功済み）。
  }

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

// ─── 履歴（過去の議事録を作成画面に読み込み直す）───────────────────────────

/** 議事録フォルダのルート（DELIVERABLES_DIR/議事録）。 */
const MINUTES_ROOT_NAME = '議事録';

/** 履歴一覧の 1 件。 */
export interface MinutesHistoryItem {
  /** DELIVERABLES_DIR 相対のフォルダパス（posix、例 '議事録/2026-06-08_定例'）。 */
  folderRelpath: string;
  /** フォルダ名（'<YYYY-MM-DD>_<title>'）。 */
  folderName: string;
  /** meta.json から復元したタイトル（無ければフォルダ名のタイトル部）。 */
  title: string;
  /** フォルダ名から切り出した日付（'YYYY-MM-DD'、判別不能なら空）。 */
  date: string;
  /** フォルダの mtime（ISO、ソート用）。 */
  mtime: string;
}

/** フォルダ名 '<YYYY-MM-DD>_<title>' を date / title に分解する。 */
function parseFolderName(folderName: string): { date: string; title: string } {
  const m = /^(\d{4}-\d{2}-\d{2})_(.*)$/.exec(folderName);
  if (m) return { date: m[1], title: m[2] || folderName };
  return { date: '', title: folderName };
}

/** 議事録フォルダ配下の meta.json を読む（無ければ null）。 */
function readMeta(folderAbs: string): MinutesMeta | null {
  try {
    const raw = readFileSync(join(folderAbs, META_FILENAME), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MinutesMeta>;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      styles: Array.isArray(parsed.styles) ? parsed.styles.filter((s) => typeof s === 'string') : [],
      exportFormats: Array.isArray(parsed.exportFormats)
        ? parsed.exportFormats.filter((s) => typeof s === 'string')
        : [],
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
    };
  } catch {
    return null;
  }
}

/** 議事録フォルダ群を新しい順で一覧する。 */
export function listMinutesHistory(): MinutesHistoryItem[] {
  const rootAbs = join(DELIVERABLES_DIR, MINUTES_ROOT_NAME);
  if (!existsSync(rootAbs)) return [];
  const out: MinutesHistoryItem[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(rootAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue;
    const folderAbs = join(rootAbs, ent.name);
    // 議事録.md が無いフォルダはスキップ（不完全な残骸を履歴に出さない）。
    if (!existsSync(join(folderAbs, '議事録.md'))) continue;
    let mtime = new Date();
    try {
      mtime = statSync(folderAbs).mtime;
    } catch {
      /* noop */
    }
    const meta = readMeta(folderAbs);
    const { date, title } = parseFolderName(ent.name);
    out.push({
      folderRelpath: `${MINUTES_ROOT_NAME}/${ent.name}`,
      folderName: ent.name,
      title: meta?.title || title,
      date,
      mtime: mtime.toISOString(),
    });
  }
  out.sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  return out;
}

/** 履歴 1 件の復元情報。 */
export interface MinutesHistoryDetail {
  folderRelpath: string;
  title: string;
  inputText: string;
  styles: string[];
  exportFormats: string[];
  /** sources/ の添付ファイル一覧（入力テキスト.txt は除く）。 */
  attachments: Array<{ name: string; relpath: string; sizeBytes: number; ext: string }>;
}

/**
 * 履歴フォルダ relpath（DELIVERABLES_DIR 相対）から復元情報を読む。
 * パスは resolveDeliverablePath で安全化し、議事録/ 配下に限定する。実体が無ければ null。
 */
export function readMinutesHistoryDetail(folderRelpath: string): MinutesHistoryDetail | null {
  // 議事録/ 直下のフォルダに限定する（安全側）。relpath で判定して realpath 差異を避ける。
  const normRel = toDeliverableRelative(resolveDeliverablePath(folderRelpath));
  const relSegs = normRel.split('/').filter(Boolean);
  if (relSegs.length !== 2 || relSegs[0] !== MINUTES_ROOT_NAME) return null;
  const folderAbs = resolveDeliverablePath(folderRelpath); // traversal 検証（範囲外は throw）
  if (!existsSync(folderAbs) || !statSync(folderAbs).isDirectory()) return null;

  const meta = readMeta(folderAbs);
  const { title: nameTitle } = parseFolderName(folderRelpath.split('/').pop() ?? '');

  // 入力テキストを sources/入力テキスト.txt から読む。
  let inputText = '';
  const sourcesAbs = join(folderAbs, 'sources');
  try {
    inputText = readFileSync(join(sourcesAbs, INPUT_TEXT_FILENAME), 'utf-8');
  } catch {
    inputText = '';
  }

  // 添付（sources/ 内、入力テキスト.txt 以外）を列挙する。
  const attachments: MinutesHistoryDetail['attachments'] = [];
  try {
    for (const ent of readdirSync(sourcesAbs, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (ent.name === INPUT_TEXT_FILENAME) continue;
      if (ent.name.startsWith('.')) continue;
      const fileAbs = join(sourcesAbs, ent.name);
      let sizeBytes = 0;
      try {
        sizeBytes = statSync(fileAbs).size;
      } catch {
        /* noop */
      }
      const dot = ent.name.lastIndexOf('.');
      attachments.push({
        name: ent.name,
        relpath: toDeliverableRelative(fileAbs),
        sizeBytes,
        ext: dot > 0 ? ent.name.slice(dot).toLowerCase() : '',
      });
    }
  } catch {
    /* sources/ が無い議事録もある（添付なし）。 */
  }

  return {
    folderRelpath,
    title: meta?.title || nameTitle,
    inputText,
    styles: meta?.styles ?? [],
    exportFormats: meta?.exportFormats ?? [],
    attachments,
  };
}

/**
 * 既存議事録フォルダの sources/ から再利用する添付を読み込む（再生成用）。
 * exclude に含まれるファイル名（basename）は除外する。入力テキスト.txt は常に除外。
 * 返り値は saveMinutesToDeliverables の sourceFiles と同形（OriginalFileInput）。
 */
export function loadReusableSources(
  folderRelpath: string,
  exclude: string[] = [],
): OriginalFileInput[] {
  const normRel = toDeliverableRelative(resolveDeliverablePath(folderRelpath));
  const relSegs = normRel.split('/').filter(Boolean);
  if (relSegs.length !== 2 || relSegs[0] !== MINUTES_ROOT_NAME) return [];
  const folderAbs = resolveDeliverablePath(folderRelpath); // traversal 検証
  const sourcesAbs = join(folderAbs, 'sources');
  if (!existsSync(sourcesAbs)) return [];
  const excludeSet = new Set(exclude);
  const out: OriginalFileInput[] = [];
  try {
    for (const ent of readdirSync(sourcesAbs, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (ent.name === INPUT_TEXT_FILENAME) continue;
      if (ent.name.startsWith('.')) continue;
      if (excludeSet.has(ent.name)) continue;
      try {
        const buffer = readFileSync(join(sourcesAbs, ent.name));
        const dot = ent.name.lastIndexOf('.');
        out.push({
          name: ent.name,
          buffer,
          ext: dot > 0 ? ent.name.slice(dot) : '',
        });
      } catch {
        /* 読めない添付はスキップ。 */
      }
    }
  } catch {
    /* noop */
  }
  return out;
}
