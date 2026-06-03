// notebookPath — ノートブック（MC-126）のディレクトリ／ファイルパスの安全化。
//
// lib/deliverablePath.ts と同じ realpath ベースの防御を NOTEBOOKS_DIR に適用する:
//  1. ノートブック id は短いランダム英数字（[a-z0-9]{10}）に限定。クライアントから来た id は
//     厳格バリデートして traversal（`..`/`/`）を弾く。
//  2. ノートブック内のサブパス（sources/<name> 等）は resolve で `..` を畳み、境界文字付きで
//     NOTEBOOKS_DIR/<id> 配下に収まるか lexical 検証 → realpath で symlink 越え脱出も弾く。
//  3. ファイル名は basename のみに正規化（traversal・隠しファイル化を無害化）。
//
// 検証失敗時は SafePathError（vaultPath と共用）を throw する。呼び出し側で 400/404 にマップ。

import { realpathSync, existsSync } from 'node:fs';
import { resolve, sep, relative, isAbsolute, basename, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { NOTEBOOKS_DIR } from '../config.js';
import { SafePathError } from './vaultPath.js';

/** ノートブック内で常に拒否するパスセグメント。 */
const FORBIDDEN_SEGMENTS = new Set(['.git', '.obsidian', '.claude', 'node_modules', '.trash']);

/** ノートブック id の正規表現（短いランダム英数字）。 */
const ID_RE = /^[a-z0-9]{10}$/;

/** NOTEBOOKS_DIR を realpath 化したベース（symlink 化されたルート自体に対応）。 */
let realRoot: string | null = null;
function notebooksRoot(): string {
  if (realRoot) return realRoot;
  try {
    realRoot = realpathSync(NOTEBOOKS_DIR);
  } catch {
    realRoot = resolve(NOTEBOOKS_DIR);
  }
  return realRoot;
}

/** target が base 配下か（境界文字付きで prefix 詐称を防ぐ）。base 自身も許容。 */
function isInside(base: string, target: string): boolean {
  if (target === base) return true;
  const rel = relative(base, target);
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel);
}

/** 新しいノートブック id を生成する（[a-z0-9]{10}）。 */
export function generateNotebookId(): string {
  // base36 で 10 文字を確保（randomBytes から）。
  return randomBytes(8).toString('hex').slice(0, 10);
}

/** クライアント由来の id を厳格に検証する。不正なら SafePathError。 */
export function validateNotebookId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new SafePathError('invalid notebook id');
  }
  return id;
}

/**
 * ノートブック id を検証し、そのノートブックの絶対 dir を返す。
 * @param mustExist true なら dir が実在しないとき SafePathError（呼び出し側で 404 にマップ）。
 */
export function resolveNotebookDir(id: unknown, mustExist = false): string {
  const safeId = validateNotebookId(id);
  const root = notebooksRoot();
  const abs = resolve(root, safeId);
  // id は単一セグメントなので isInside は自明だが、念のため検証。
  if (!isInside(root, abs)) {
    throw new SafePathError('notebook path escapes the notebooks root');
  }
  if (mustExist && !existsSync(abs)) {
    throw new SafePathError('notebook not found');
  }
  return abs;
}

/**
 * ノートブック内のサブパス（例 'sources/foo.pdf'）を検証し、安全な絶対パスを返す。
 * @param id ノートブック id。
 * @param rel ノートブック dir 相対パス（posix）。
 */
export function resolveNotebookSubPath(id: unknown, rel: string): string {
  const dir = resolveNotebookDir(id);
  if (typeof rel !== 'string' || rel.trim() === '') {
    throw new SafePathError('path is required');
  }
  if (/%2e|%2f|%5c/i.test(rel)) {
    throw new SafePathError('encoded path separators are not allowed');
  }
  if (isAbsolute(rel)) {
    throw new SafePathError('absolute paths are not allowed');
  }
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(cleaned)) {
    throw new SafePathError('invalid characters in path');
  }
  for (const s of cleaned.split('/')) {
    if (FORBIDDEN_SEGMENTS.has(s)) {
      throw new SafePathError(`forbidden path segment: ${s}`);
    }
  }
  const abs = resolve(dir, cleaned);
  if (!isInside(dir, abs)) {
    throw new SafePathError('path escapes the notebook directory');
  }
  try {
    const real = realpathSync(abs);
    if (!isInside(dir, real)) {
      throw new SafePathError('path resolves outside the notebook directory');
    }
    return real;
  } catch (e) {
    if (e instanceof SafePathError) throw e;
    return abs; // 実体無し（ENOENT）は lexical 検証済みの abs を返す。
  }
}

/**
 * アップロードファイル名を安全な basename に正規化する（deliverablePath と同方針）。
 *  - basename でディレクトリ成分を捨てる（traversal 無害化）。
 *  - 制御文字・FS 危険記号を除去、先頭/末尾の空白・ドットを除去。
 *  - 日本語等のマルチバイトは保持。空なら fallback、過長は切り詰め。
 */
export function sanitizeNotebookFilename(name: string, fallback = 'file'): string {
  let base = basename((name || '').replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[\x00-\x1f]/g, '');
  base = base.replace(/[<>:"/\\|?*]/g, '');
  base = base.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
  if (base === '') base = fallback;
  const ext = extname(base);
  let stem = ext ? base.slice(0, -ext.length) : base;
  if (stem === '') stem = fallback;
  const MAX = 180;
  let fname = stem + ext;
  if (Buffer.byteLength(fname, 'utf8') > MAX) {
    const extBytes = Buffer.byteLength(ext, 'utf8');
    const stemBuf = Buffer.from(stem, 'utf8').subarray(0, Math.max(1, MAX - extBytes));
    stem = stemBuf.toString('utf8').replace(/�+$/g, '') || fallback;
    fname = stem + ext;
  }
  return fname;
}

/**
 * `<dir>/sources/<name>` の保存先を解決する。
 * @param options.overwrite true なら同名ファイルが既存でもそのパスを返す（上書き）。
 *                          false（既定）なら衝突回避サフィックスを付ける。
 * @returns { absPath, name } name は実際に確定したファイル名。
 */
export function resolveSourceTarget(
  id: unknown,
  name: string,
  options: { overwrite?: boolean } = {},
): { absPath: string; name: string } {
  const dir = resolveNotebookDir(id);
  const sourcesDir = join(dir, 'sources');

  if (options.overwrite) {
    const abs = join(sourcesDir, name);
    return { absPath: abs, name };
  }

  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
    const abs = join(sourcesDir, candidate);
    if (!existsSync(abs)) return { absPath: abs, name: candidate };
  }
  const rand = randomBytes(4).toString('hex');
  const candidate = `${stem}-${rand}${ext}`;
  return { absPath: join(sourcesDir, candidate), name: candidate };
}
