// officeToPdf — Office 文書（xlsx/xls/pptx/ppt/docx/doc/ods/odp/odt）を
// LibreOffice headless で PDF に変換する。Apollo の成果物プレビューが使う。
//
// 設計:
//  - キャッシュ必須: 変換済み PDF を CACHE_DIR に「ソース絶対パスの sha1 + ソース mtime + size」
//    をキーにしたファイル名で保存する。同じソース（同じ mtime/size）の再プレビューは変換せず即返す。
//    ソースが更新されたら（mtime か size が変わる）キーが変わるので自動的に再変換される。
//  - 同時実行対策: soffice は単一ユーザープロファイルをロックするので、変換ごとに
//    一意な UserInstallation プロファイル（一時 dir）を `-env:UserInstallation=file://...` で渡す。
//    これで並行プレビューでロック衝突しない。
//  - シェルを介さない: execFile で引数配列を渡す（インジェクション防止）。
//  - タイムアウト: 既定 60s。失敗時は呼び出し側で扱えるよう Error を throw。
//  - 一時 dir（プロファイル・変換 outdir）は finally で必ず掃除する。

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
  statSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { DELIVERABLES_CACHE_DIR } from '../config.js';

/** LibreOffice で PDF 化する拡張子（小文字、ドット付き）。 */
const CONVERTIBLE_EXTS = new Set([
  '.xlsx',
  '.xls',
  '.ods',
  '.pptx',
  '.ppt',
  '.odp',
  '.docx',
  '.doc',
  '.odt',
  '.rtf',
]);

/** その拡張子が LibreOffice 変換対象か。 */
export function isConvertibleToPdf(ext: string): boolean {
  return CONVERTIBLE_EXTS.has(ext.toLowerCase());
}

const SOFFICE_BIN = process.env.SOFFICE_BIN && process.env.SOFFICE_BIN.trim() !== ''
  ? process.env.SOFFICE_BIN
  : '/usr/bin/soffice';

const CONVERT_TIMEOUT_MS = Number(process.env.OFFICE_CONVERT_TIMEOUT_MS) || 60_000;

/** キャッシュキー: ソース絶対パス + mtime(ms) + size から sha1。 */
function cacheKey(absPath: string): string {
  const st = statSync(absPath);
  const h = createHash('sha1');
  h.update(absPath);
  h.update('\0');
  h.update(String(Math.floor(st.mtimeMs)));
  h.update('\0');
  h.update(String(st.size));
  return h.digest('hex');
}

function ensureCacheDir(): void {
  if (!existsSync(DELIVERABLES_CACHE_DIR)) {
    mkdirSync(DELIVERABLES_CACHE_DIR, { recursive: true });
  }
}

/**
 * Office 文書を PDF に変換して、キャッシュ済み PDF の絶対パスを返す。
 * 同一ソース（mtime/size 不変）の 2 回目以降は変換せずキャッシュを返す。
 *
 * @param srcAbsPath 変換対象の絶対パス（呼び出し側で deliverablePath 検証済みであること）。
 * @returns 変換済み PDF の絶対パス（CACHE_DIR 配下）。
 * @throws 変換失敗・タイムアウト時。
 */
export async function convertOfficeToPdf(srcAbsPath: string): Promise<string> {
  ensureCacheDir();
  const key = cacheKey(srcAbsPath);
  const cachedPdf = join(DELIVERABLES_CACHE_DIR, `${key}.pdf`);
  if (existsSync(cachedPdf)) {
    return cachedPdf;
  }

  // soffice は --outdir に「入力ファイルの basename を .pdf にした名前」で書き出す。
  // 並行変換・プロファイルロック衝突を避けるため、変換ごとに専用一時 dir を作る。
  const workDir = mkdtempSync(join(tmpdir(), 'apollo-soffice-'));
  const profileDir = join(workDir, 'profile');
  const outDir = join(workDir, 'out');
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  try {
    await new Promise<void>((resolvePromise, reject) => {
      execFile(
        SOFFICE_BIN,
        [
          '--headless',
          '--norestore',
          '--nologo',
          `-env:UserInstallation=file://${profileDir}`,
          '--convert-to',
          'pdf',
          '--outdir',
          outDir,
          srcAbsPath,
        ],
        { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `LibreOffice conversion failed: ${err.message}${stderr ? ` | ${stderr}` : ''}`,
              ),
            );
            return;
          }
          resolvePromise();
        },
      );
    });

    // 期待する出力名（basename を .pdf 化）。soffice の挙動差に備え、無ければ outDir 内の .pdf を拾う。
    const base = basename(srcAbsPath, extname(srcAbsPath));
    let producedPdf = join(outDir, `${base}.pdf`);
    if (!existsSync(producedPdf)) {
      const pdfs = readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
      if (pdfs.length === 0) {
        throw new Error('LibreOffice produced no PDF output');
      }
      producedPdf = join(outDir, pdfs[0]);
    }

    // 原子的にキャッシュへ確定（同一 dir 内 rename ができない tmp→cache 跨ぎなので copy + rename）。
    const tmpInCache = join(DELIVERABLES_CACHE_DIR, `${key}.${process.pid}.tmp`);
    copyFileSync(producedPdf, tmpInCache);
    // rename は同一 FS（CACHE_DIR 内）なので原子的。
    const { renameSync } = await import('node:fs');
    renameSync(tmpInCache, cachedPdf);
    return cachedPdf;
  } finally {
    // プロファイル・出力一時 dir を必ず掃除。
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}

/**
 * ソース成果物に対応する変換キャッシュ（PDF）を削除する（MC-125）。
 *
 * キャッシュキーはソースの絶対パス + mtime + size から決まるため、
 * **ソースをまだ消す前に**（実体が存在する状態で）呼ぶこと。実体が無いと
 * キーを再計算できず該当キャッシュを特定できない。
 *
 * 対象が Office 変換系でない / 実体が無い / キャッシュが存在しない場合は
 * 何もせず false を返す（残骸が無いだけなので無視してよい）。
 *
 * @param srcAbsPath 変換対象の絶対パス（deliverablePath 検証済みであること）。
 * @returns キャッシュ PDF を実際に削除したら true、対象が無ければ false。
 */
export function deleteOfficePdfCache(srcAbsPath: string): boolean {
  const ext = extname(srcAbsPath).toLowerCase();
  if (!isConvertibleToPdf(ext)) return false;
  let key: string;
  try {
    key = cacheKey(srcAbsPath); // statSync が要るのでソース実体が必要。
  } catch {
    return false; // 実体が無い等でキー算出不能 → 残骸特定不可、無視。
  }
  const cachedPdf = join(DELIVERABLES_CACHE_DIR, `${key}.pdf`);
  if (!existsSync(cachedPdf)) return false;
  try {
    unlinkSync(cachedPdf);
    return true;
  } catch {
    return false; // 消せなくても本体削除は成功扱い（残骸防止はベストエフォート）。
  }
}
