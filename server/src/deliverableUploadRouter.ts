// deliverableUploadRouter — Apollo の成果物ビューへファイルをアップロードする API（MC-118）。
//
//  POST /api/deliverables/upload  (multipart, field "files", 複数可)
//    → DELIVERABLES_DIR にディスクストリーム保存し、保存した {name, relpath, sizeBytes}[] を返す。
//
// 大容量対応の要点:
//  - multer.diskStorage() を使い、ファイル全体をメモリに載せず disk へストリーム保存する
//    （terminalUpload / vaultWrite は memoryStorage で OOM リスクがあるため本機能では使わない）。
//  - limits.fileSize = DELIVERABLE_UPLOAD_MAX_BYTES（既定 5GB、env 上書き可）。超過は 413。
//  - filename は sanitizeDeliverableFilename でパス区切り・制御文字・`..` を無害化し、
//    resolveUploadTarget で既存ファイルと衝突しない名前（<name>-<n> / -<rand>）に確定する。
//    日本語ファイル名は保持する。
//
// 既知のトンネル制約（コード上は回避不能・別タスク）:
//  cloudflared 無料トンネル経由だとリクエストボディが ~100MB で頭打ちになる。直アクセス/LAN や
//  上位プランなら大容量も通る。本実装はサーバ側でストリーム＋寛大な limit まで対応するが、
//  トンネル越えの >100MB はトンネル側制約のため将来 chunked upload で対応する。

import { mkdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import {
  DELIVERABLES_DIR,
  DELIVERABLE_UPLOAD_MAX_BYTES,
  DELIVERABLE_UPLOAD_MAX_FILES,
} from './config.js';
import { SafePathError } from './lib/vaultPath.js';
import {
  resolveUploadTarget,
  extractUploadRelPath,
} from './lib/deliverablePath.js';

/**
 * multer/busboy は multipart の filename を latin1 として decode して originalname に入れる。
 * UTF-8（日本語等）のファイル名はそのままだと mojibake になるため、latin1→utf8 で復号する。
 * 既に ASCII のみなら latin1↔utf8 は同値なので無害。復号で不正バイトが出るなら元を使う。
 */
function decodeOriginalName(name: string): string {
  const raw = name || 'file';
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    // U+FFFD（置換文字）が増えるなら不正復号とみなし元の値を使う。
    const before = (raw.match(/�/g) || []).length;
    const after = (decoded.match(/�/g) || []).length;
    return after > before ? raw : decoded;
  } catch {
    return raw;
  }
}

// 保存先（DELIVERABLES_DIR）が無ければ作る（初回アップロード対応）。
function ensureRootDir(): void {
  if (!existsSync(DELIVERABLES_DIR)) {
    mkdirSync(DELIVERABLES_DIR, { recursive: true });
  }
}

// ─── multer diskStorage（メモリに載せずに disk へストリーム保存）─────────────
//
// destination: 既定は DELIVERABLES_DIR 直下。subfolder（任意）は req.body から取るが、
//   multipart では text フィールドの解析順がファイルより後になり得るため、MVP は
//   ルート直下固定とする（サブフォルダ対応が要れば resolveDeliverablePath で配下限定して拡張）。
// filename: サニタイズ + 衝突回避で確定。req に確定 relpath を貯めて後段で参照する。

interface SavedRef {
  name: string;
  relpath: string;
  absPath: string;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureRootDir();
      const decoded = decodeOriginalName(file.originalname);
      const { subDir } = extractUploadRelPath(decoded);
      (req as Request & { _currentSubDir?: string })._currentSubDir = subDir;
      let destDir = DELIVERABLES_DIR;
      if (subDir) {
        destDir = join(DELIVERABLES_DIR, subDir);
        mkdirSync(destDir, { recursive: true });
      }
      cb(null, destDir);
    } catch (e) {
      cb(e instanceof Error ? e : new Error(String(e)), DELIVERABLES_DIR);
    }
  },
  filename: (req, file, cb) => {
    try {
      const decoded = decodeOriginalName(file.originalname);
      const { safeFilename } = extractUploadRelPath(decoded);
      const subDir = (req as Request & { _currentSubDir?: string })._currentSubDir ?? '';
      const { absPath, relpath } = resolveUploadTarget(safeFilename, subDir);
      const r = req as Request & { _savedDeliverables?: SavedRef[] };
      if (!r._savedDeliverables) r._savedDeliverables = [];
      r._savedDeliverables.push({ name: safeFilename, relpath, absPath });
      cb(null, absPath.slice(dirname(absPath).length + 1));
    } catch (e) {
      cb(e instanceof Error ? e : new Error(String(e)), '');
    }
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: DELIVERABLE_UPLOAD_MAX_BYTES,
    files: DELIVERABLE_UPLOAD_MAX_FILES,
  },
});
const uploadFiles = upload.array('files', DELIVERABLE_UPLOAD_MAX_FILES);

/** 途中で失敗したとき、その時点までに disk に書かれた部分ファイルを掃除する。 */
function cleanupPartial(req: Request): void {
  const r = req as Request & { _savedDeliverables?: SavedRef[] };
  for (const s of r._savedDeliverables ?? []) {
    try {
      if (existsSync(s.absPath)) unlinkSync(s.absPath);
    } catch {
      // 掃除失敗は致命的でない（ログのみ）。
      console.warn('[deliverables/upload] cleanup failed:', s.absPath);
    }
  }
}

/** multer を Promise 化して実行する。エラーは status を解決してレスポンス済みにする。 */
function runUpload(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    uploadFiles(req, res, (err: unknown) => {
      if (err) {
        // サイズ超過は 413 で分かるエラーを返す。
        if (err instanceof multer.MulterError) {
          cleanupPartial(req);
          if (err.code === 'LIMIT_FILE_SIZE') {
            const mb = Math.round(DELIVERABLE_UPLOAD_MAX_BYTES / (1024 * 1024));
            res.status(413).json({
              error: `ファイルサイズが上限（約 ${mb}MB）を超えています。`,
              code: err.code,
            });
            resolve(false);
            return;
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            res.status(413).json({
              error: `一度にアップロードできるファイル数の上限（${DELIVERABLE_UPLOAD_MAX_FILES}）を超えています。`,
              code: err.code,
            });
            resolve(false);
            return;
          }
          res.status(400).json({ error: err.message, code: err.code });
          resolve(false);
          return;
        }
        cleanupPartial(req);
        const message = err instanceof SafePathError ? err.message : err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

/** POST /api/deliverables/upload — multipart files[] を DELIVERABLES_DIR に保存。 */
async function handleUpload(req: Request, res: Response): Promise<void> {
  const ok = await runUpload(req, res);
  if (!ok) return;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'ファイルがありません（フィールド名は "files" を使用してください）。' });
    return;
  }

  const r = req as Request & { _savedDeliverables?: SavedRef[] };
  const savedRefs = r._savedDeliverables ?? [];

  // multer の files（destination/filename）と、確定済み relpath を突き合わせて返す。
  const saved: { name: string; relpath: string; sizeBytes: number }[] = [];
  for (const f of files) {
    // f.path が実際の保存先。statSync で確定サイズを取る（stream 後の最終サイズ）。
    let sizeBytes = f.size;
    try {
      sizeBytes = statSync(f.path).size;
    } catch {
      // stat 失敗時は multer の size を使う。
    }
    const ref = savedRefs.find((s) => s.absPath === f.path);
    saved.push({
      name: ref?.name ?? f.filename,
      relpath: ref?.relpath ?? f.filename,
      sizeBytes,
    });
  }

  res.status(201).json({ ok: true, files: saved });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/deliverables/upload ルータ。index.ts で auth ミドルウェア配下に mount する。 */
export function deliverableUploadRouter(): Router {
  const router = Router();
  // multipart は express.json を通らないため、グローバル json の 1mb 制限は無関係。
  router.post('/upload', (req, res) => void handleUpload(req, res));
  return router;
}
