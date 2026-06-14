// deliverablePath — 成果物（deliverables）相対パスの安全化（パストラバーサル防止）。
//
// lib/vaultPath.ts と同じ防御方針を DELIVERABLES_DIR に対して適用する:
//  1. 入力（相対パス）の先頭スラッシュ・バックスラッシュを正規化。
//  2. resolve(DELIVERABLES_DIR, rel) で絶対パス化（`..` は resolve が畳む）。
//  3. resolve 結果が DELIVERABLES_DIR 配下であることを境界文字付きで検証（prefix 詐称防止）。
//  4. realpathSync で symlink を解決し、実体も DELIVERABLES_DIR 配下であることを再検証
//     （symlink 経由の脱出を弾く）。実体が存在しない場合（404）は lexical 検証で許容。
//  5. .git / node_modules 等の内部メタは常に拒否。
//
// 検証に失敗したら SafePathError（vaultPath と共用）を throw する。呼び出し側で 400/403 にマップ。

import { realpathSync, existsSync } from 'node:fs';
import { resolve, sep, normalize, relative, isAbsolute, basename, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DELIVERABLES_DIR } from '../config.js';
import { SafePathError } from './vaultPath.js';

// 成果物ルート内で常に拒否するパスセグメント（メタ・依存・VCS）。
const FORBIDDEN_SEGMENTS = new Set(['.git', '.obsidian', '.claude', 'node_modules', '.trash']);

/** DELIVERABLES_DIR を realpath 化したベース（symlink 化されたルート自体に対応）。 */
let realRoot: string | null = null;
function deliverablesRoot(): string {
  if (realRoot) return realRoot;
  try {
    realRoot = realpathSync(DELIVERABLES_DIR);
  } catch {
    // ルートが存在しない / realpath 不能なら resolve 値で代用。
    realRoot = resolve(DELIVERABLES_DIR);
  }
  return realRoot;
}

/** target が base 配下か（境界文字付きで prefix 詐称を防ぐ）。base 自身も許容。 */
function isInside(base: string, target: string): boolean {
  if (target === base) return true;
  const rel = relative(base, target);
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel);
}

/**
 * 成果物相対パスを検証し、安全な絶対パスを返す。
 * @param rel クエリで渡される成果物相対パス（例 'logic/2026-06-03/report.xlsx'）。
 * @throws SafePathError 不正・ルート外・禁止セグメント・型不正。
 */
export function resolveDeliverablePath(rel: unknown): string {
  if (typeof rel !== 'string' || rel.trim() === '') {
    throw new SafePathError('path is required');
  }

  // 二重 %2f 等の生残りを弾く（URL デコード済みの値が渡る前提）。
  if (/%2e|%2f|%5c/i.test(rel)) {
    throw new SafePathError('encoded path separators are not allowed');
  }

  // 絶対パス（/etc/passwd, C:\... 等）は明示拒否。
  if (isAbsolute(rel)) {
    throw new SafePathError('absolute paths are not allowed');
  }

  // バックスラッシュをスラッシュに寄せ、先頭の余計なスラッシュを除く。
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');

  // NUL バイト等の制御文字を弾く。
  if (/[\x00-\x1f]/.test(cleaned)) {
    throw new SafePathError('invalid characters in path');
  }

  const root = deliverablesRoot();
  const abs = resolve(root, cleaned);

  // 禁止セグメントを含むなら拒否。
  const segs = normalize(cleaned).split('/');
  for (const s of segs) {
    if (FORBIDDEN_SEGMENTS.has(s)) {
      throw new SafePathError(`forbidden path segment: ${s}`);
    }
  }

  // lexical（symlink 解決前）にルート配下か検証。
  if (!isInside(root, abs)) {
    throw new SafePathError('path escapes the deliverables root');
  }

  // 実体があれば realpath で symlink 越しの脱出も弾く。無ければ lexical 検証で許容（404 は呼び出し側）。
  try {
    const real = realpathSync(abs);
    if (!isInside(root, real)) {
      throw new SafePathError('path resolves outside the deliverables root');
    }
    return real;
  } catch (e) {
    if (e instanceof SafePathError) throw e;
    // ENOENT 等: 実体が無い → lexical に安全と判定済みの abs を返す。
    return abs;
  }
}

/** 絶対パス → 成果物相対パス（posix 区切り）。表示・索引キー用。 */
export function toDeliverableRelative(abs: string): string {
  const root = deliverablesRoot();
  return relative(root, abs).split(sep).join('/');
}

// ─── アップロード（MC-118）用: ファイル名サニタイズ + 衝突回避 ──────────────

/**
 * アップロードファイル名を安全な basename に正規化する（MC-118）。
 *  - ディレクトリ成分（`/` `\`）を捨てて basename のみにする（traversal・`..` の無害化）。
 *  - 制御文字・NUL・FS で危険な記号（< > : " | ? *）を除去。
 *  - 先頭ドットを除去して隠しファイル化を防ぐ。
 *  - 日本語等のマルチバイトはそのまま保持する。
 *  - 空になったら fallback。過長は切り詰める（拡張子は保持）。
 */
export function sanitizeDeliverableFilename(name: string, fallback = 'file'): string {
  // basename でディレクトリ成分を捨てる（`../../etc/passwd` → `passwd`）。
  let base = basename((name || '').replace(/\\/g, '/'));
  // 制御文字（NUL 含む）を除去。
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[\x00-\x1f\x7f]/g, '');
  // FS で危険・予約の記号を除去（区切りは basename で消えているが念のため）。
  base = base.replace(/[<>:"/\\|?*]/g, '');
  // 先頭/末尾の空白・ドットを除去（隠しファイル化・`.` `..` の無害化）。
  base = base.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
  if (base === '') base = fallback;

  // 拡張子を分けて、stem 側だけ過長を切り詰める（拡張子は保持）。
  const ext = extname(base);
  let stem = ext ? base.slice(0, -ext.length) : base;
  if (stem === '') stem = fallback;
  const MAX = 180;
  let fname = stem + ext;
  if (Buffer.byteLength(fname, 'utf8') > MAX) {
    // バイト長で切る（マルチバイトでも安全に）。拡張子分を残す。
    const extBytes = Buffer.byteLength(ext, 'utf8');
    const stemBuf = Buffer.from(stem, 'utf8').subarray(0, Math.max(1, MAX - extBytes));
    // マルチバイト境界で壊れないよう、デコード時に不正バイトを落とす。
    stem = stemBuf.toString('utf8').replace(/�+$/g, '') || fallback;
    fname = stem + ext;
  }
  return fname;
}

/**
 * originalname（フォルダアップロード時に相対パスが入る）を安全な { subDir, safeFilename } に分解。
 * フォルダ区切り（/）を許容し、各セグメントをサニタイズする。
 * @param decoded decodeOriginalName 済みの文字列
 */
export function extractUploadRelPath(decoded: string): { subDir: string; safeFilename: string } {
  const parts = decoded
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p.length > 0 && p !== '.' && p !== '..');

  if (parts.length === 0) return { subDir: '', safeFilename: 'file' };

  const rawFilename = parts.pop()!;
  const safeFilename = sanitizeDeliverableFilename(rawFilename);

  // 各ディレクトリセグメントをサニタイズ（制御文字・FS禁止文字・先頭末尾ドット除去）
  const safeDirParts = parts
    .map((seg) =>
      seg
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f]/g, '')
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/^[\s.]+/, '')
        .replace(/[\s.]+$/, ''),
    )
    .filter((p) => p.length > 0);

  return { subDir: safeDirParts.join('/'), safeFilename };
}

/**
 * `<DELIVERABLES_DIR>/<subRel>/<name>` が衝突しない安全な絶対パスを返す（MC-118）。
 * 既存ファイルがあれば `<stem>-<n><ext>`（n=2,3,…）を試し、それでも詰まったら
 * `<stem>-<短いランダム><ext>` にフォールバックする。既存ファイルは上書きしない。
 *
 * @param name サニタイズ済みファイル名（sanitizeDeliverableFilename を通したもの）。
 * @param subRel 保存先サブフォルダ（DELIVERABLES_DIR 相対、posix）。空ならルート直下。
 *               resolveDeliverablePath で DELIVERABLES_DIR 配下に限定検証する。
 * @returns { absPath, relpath } relpath は DELIVERABLES_DIR 相対（posix）。
 */
export function resolveUploadTarget(
  name: string,
  subRel = '',
): { absPath: string; relpath: string } {
  // 保存先ベース（サブフォルダ指定があれば検証して配下に限定）。
  // resolveDeliverablePath はスペース・ハイフン等の通常ファイル名文字を拒否する文字チェックを持つため
  // アップロード用サブフォルダには使えない。extractUploadRelPath で既にサニタイズ済みなので、
  // ルート配下であることだけ直接検証する。
  let baseAbs: string;
  if (subRel && subRel.trim() !== '') {
    const root = deliverablesRoot();
    const candidate = resolve(root, subRel);
    if (!isInside(root, candidate)) {
      throw new SafePathError('subRel escapes the deliverables root');
    }
    baseAbs = candidate;
  } else {
    baseAbs = deliverablesRoot();
  }

  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;

  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
    const abs = join(baseAbs, candidate);
    if (!existsSync(abs)) {
      return { absPath: abs, relpath: toDeliverableRelative(abs) };
    }
  }
  // 1000 連番でも埋まっていたらランダムサフィックスで確定。
  const rand = randomBytes(4).toString('hex');
  const abs = join(baseAbs, `${stem}-${rand}${ext}`);
  return { absPath: abs, relpath: toDeliverableRelative(abs) };
}

// ─── リネーム（MC-227）用: 表示名サニタイズ + 同一親内の改名先解決 ─────────────

/**
 * リネーム後の新しい表示名（ファイル名 or フォルダ名）を検証する（MC-227）。
 * mkdir 側（index.ts のフォルダ名チェック）と同じ厳密ポリシーで、
 * パス区切り・ドット始まり・FS禁止文字・トラバーサルセグメントを拒否する。
 * 返り値は trim 済みの安全な名前。不正なら SafePathError を throw。
 */
export function validateRenameName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new SafePathError('new name is required');
  }
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new SafePathError('new name is required');
  }
  // パス区切り・FS禁止記号・制御文字を拒否（basename のみを許す）。
  // eslint-disable-next-line no-control-regex
  if (/[/\\<>:"|?*\x00-\x1f]/.test(trimmed)) {
    throw new SafePathError('invalid characters in name');
  }
  // ドット始まり（隠しファイル化）・`.`/`..`（トラバーサル）を拒否。
  if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
    throw new SafePathError('name cannot start with a dot');
  }
  return trimmed;
}

/**
 * 既存の成果物（ファイル/フォルダ）を「同じ親ディレクトリ内」で新名に改名するための
 * 改名先絶対パスを解決する（MC-227）。実際の rename は呼び出し側が行う。
 *  - srcAbs は resolveDeliverablePath で検証済みの実在パス（DELIVERABLES_DIR 配下）。
 *  - 新名は validateRenameName 済みの安全な basename。
 *  - 親ディレクトリは変えない（移動は MC-228 の別 API）。
 *  - 改名先が DELIVERABLES_DIR 配下に留まることを再検証する。
 * @returns { destAbs, destRel } destRel は DELIVERABLES_DIR 相対（posix）。
 * @throws SafePathError 改名先がルート外になる場合。
 */
export function resolveRenameTarget(
  srcAbs: string,
  safeName: string,
): { destAbs: string; destRel: string } {
  const parent = resolve(srcAbs, '..');
  const destAbs = join(parent, safeName);
  const root = deliverablesRoot();
  if (!isInside(root, destAbs)) {
    throw new SafePathError('rename target escapes the deliverables root');
  }
  return { destAbs, destRel: toDeliverableRelative(destAbs) };
}

// ─── ゴミ箱（MC-230）: 物理削除をやめ .trash/ へ退避し、復元/完全削除を可能にする ────
//
// 退避先は `<DELIVERABLES_DIR>/.trash/<timestamp>-<rand>/<元の相対パス>`。
// .trash は collectors/deliverables.ts の EXCLUDED_DIRS と本ファイル FORBIDDEN_SEGMENTS で
// 一覧・検索・通常パス解決から除外済み。ゴミ箱専用のパス解決はここに閉じる（通常 API からは
// .trash 配下を触れない＝復元/完全削除はこの専用ヘルパ経由のみ）。

/** ゴミ箱ディレクトリ名（DELIVERABLES_DIR 直下）。 */
export const TRASH_DIRNAME = '.trash';

/** ゴミ箱ルートの絶対パス（realpath 化された DELIVERABLES_DIR 配下）。 */
export function trashRoot(): string {
  return join(deliverablesRoot(), TRASH_DIRNAME);
}

/**
 * ゴミ箱内の相対パス（trashRoot 相対、posix）を検証し安全な絶対パスを返す（MC-230）。
 * resolveDeliverablePath と同じ防御（絶対パス拒否・`..` 脱出拒否・制御文字拒否・
 * symlink 越え再検証）を trashRoot に対して適用する。.trash 自身は許容セグメント。
 * @throws SafePathError 不正・trashRoot 外・型不正。
 */
export function resolveTrashPath(rel: unknown): string {
  if (typeof rel !== 'string' || rel.trim() === '') {
    throw new SafePathError('trash path is required');
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
  const root = trashRoot();
  const abs = resolve(root, cleaned);
  if (!isInside(root, abs)) {
    throw new SafePathError('path escapes the trash root');
  }
  try {
    const real = realpathSync(abs);
    if (!isInside(root, real)) {
      throw new SafePathError('path resolves outside the trash root');
    }
    return real;
  } catch (e) {
    if (e instanceof SafePathError) throw e;
    return abs;
  }
}

/** 絶対パス → ゴミ箱ルート相対パス（posix 区切り）。 */
export function toTrashRelative(abs: string): string {
  return relative(trashRoot(), abs).split(sep).join('/');
}

/**
 * 削除対象（DELIVERABLES_DIR 配下の検証済み絶対パス）を退避するゴミ箱内の保存先を作る（MC-230）。
 * 1 削除 = 1 退避フォルダ `<trashRoot>/<ts>-<rand>/` を作り、その中に「元の DELIVERABLES_DIR 相対
 * パス」をそのまま再現した位置へ move する。これにより復元時に元の場所へ戻せる。
 * @param srcRel 削除対象の DELIVERABLES_DIR 相対パス（posix、表示用にも使う元パス）。
 * @returns { batchId, destAbs, originalRel } batchId は退避フォルダ名（復元 API のキー）。
 */
export function makeTrashTarget(srcRel: string): {
  batchId: string;
  destAbs: string;
  originalRel: string;
} {
  const batchId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  // srcRel は toDeliverableRelative 由来で安全（posix・ルート相対）だが、念のため正規化。
  const cleaned = srcRel.replace(/\\/g, '/').replace(/^\/+/, '');
  const destAbs = join(trashRoot(), batchId, cleaned);
  return { batchId, destAbs, originalRel: cleaned };
}
