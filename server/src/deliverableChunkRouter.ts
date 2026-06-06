// deliverableChunkRouter — 大容量ファイル向けチャンクアップロード API（cloudflared ~100MB 制限対策）。
//
//  POST /api/deliverables/upload-chunk  (multipart)
//    フィールド:
//      chunk      : Blob スライス（各 ≤ 25MB）
//      sessionId  : string（フロントが生成する UUID 的な文字列 [a-zA-Z0-9_-]{1,64}）
//      relpath    : string（最終保存パス、例: "PM人材育成支援/302_CHG資料.zip"）
//      chunkIndex : string（0 始まり）
//      totalChunks: string（チャンク総数）
//
//    レスポンス:
//      中間チャンク (chunkIndex < totalChunks-1): 200 { ok: true, received: chunkIndex }
//      最終チャンク (chunkIndex === totalChunks-1): 201 { ok: true, assembled: true, name, relpath, sizeBytes }
//
//  設計:
//    - チャンク一時保存: data/deliverables-temp/<sessionId>/chunk-<N>
//    - アセンブル: 全チャンクを順番に結合 → resolveUploadTarget で最終パス確定 → temp を削除
//    - セキュリティ: sessionId は /^[a-zA-Z0-9_-]{1,64}$/ のみ許可、chunkIndex は 0〜999
//    - relpath は extractUploadRelPath でサニタイズ
//    - アセンブル失敗時は temp を掃除して 500

import { mkdirSync, existsSync, rmSync, createWriteStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import { DELIVERABLES_DIR, INBOX_DATA_DIR } from './config.js';
import { resolveUploadTarget, extractUploadRelPath } from './lib/deliverablePath.js';

/** チャンク一時保存の親ディレクトリ（data/deliverables-temp）。 */
const TEMP_BASE_DIR = join(INBOX_DATA_DIR, 'deliverables-temp');

/** multer: 各チャンクは最大 25MB（CHUNK_SIZE 20MB + マージン）をメモリに受け取る。 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

/** sessionId の安全検証パターン。*/
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** sessionId の一時ディレクトリパスを返す。検証済みの sessionId を渡すこと。 */
function sessionTempDir(sessionId: string): string {
  return join(TEMP_BASE_DIR, sessionId);
}

/** チャンクファイルパス。 */
function chunkPath(sessionId: string, index: number): string {
  return join(sessionTempDir(sessionId), `chunk-${index}`);
}

/** 一時ディレクトリを安全に削除する（エラーは警告のみ）。 */
function cleanupSession(sessionId: string): void {
  try {
    const dir = sessionTempDir(sessionId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn('[deliverables/chunk] cleanup failed for session', sessionId, e);
  }
}

/**
 * multer を通じてリクエストをパースして Promise 化する。
 * エラー時はレスポンス送信済みで false を返す。
 */
function runMulter(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    upload.single('chunk')(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof multer.MulterError
          ? `チャンクが大きすぎます（最大 25MB）: ${err.message}`
          : err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: msg });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

/** チャンクアセンブル: 全チャンクを順番に結合して最終ファイルに書き出す。 */
async function assembleChunks(
  sessionId: string,
  totalChunks: number,
  finalAbsPath: string,
): Promise<void> {
  // 保存先ディレクトリを保証。
  mkdirSync(dirname(finalAbsPath), { recursive: true });

  const ws = createWriteStream(finalAbsPath, { flags: 'w' });
  try {
    for (let i = 0; i < totalChunks; i++) {
      const cp = chunkPath(sessionId, i);
      if (!existsSync(cp)) {
        throw new Error(`チャンク ${i} が見つかりません（session: ${sessionId}）`);
      }
      const rs = createReadStream(cp);
      await pipeline(rs, ws, { end: false });
    }
  } finally {
    ws.end();
    await new Promise<void>((res, rej) => {
      ws.on('finish', res);
      ws.on('error', rej);
    });
  }
}

/** POST /api/deliverables/upload-chunk ハンドラ。 */
async function handleChunk(req: Request, res: Response): Promise<void> {
  const ok = await runMulter(req, res);
  if (!ok) return;

  // ── フィールドのバリデーション ───────────────────────────────
  const { sessionId, relpath, chunkIndex, totalChunks } = req.body as {
    sessionId?: string;
    relpath?: string;
    chunkIndex?: string;
    totalChunks?: string;
  };

  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: 'sessionId が不正です（英数字・_- のみ、64文字以内）。' });
    return;
  }
  if (!relpath || typeof relpath !== 'string' || relpath.trim() === '') {
    res.status(400).json({ error: 'relpath が必要です。' });
    return;
  }

  const idx = parseInt(chunkIndex ?? '', 10);
  const total = parseInt(totalChunks ?? '', 10);
  if (!Number.isFinite(idx) || idx < 0 || idx > 999) {
    res.status(400).json({ error: 'chunkIndex が不正です（0〜999）。' });
    return;
  }
  if (!Number.isFinite(total) || total < 1 || total > 1000) {
    res.status(400).json({ error: 'totalChunks が不正です（1〜1000）。' });
    return;
  }
  if (idx >= total) {
    res.status(400).json({ error: 'chunkIndex が totalChunks 以上です。' });
    return;
  }

  const chunkData = req.file;
  if (!chunkData || !chunkData.buffer || chunkData.buffer.byteLength === 0) {
    res.status(400).json({ error: 'チャンクデータがありません（フィールド名は "chunk"）。' });
    return;
  }

  // ── チャンクを一時保存 ─────────────────────────────────────────
  const tempDir = sessionTempDir(sessionId);
  mkdirSync(tempDir, { recursive: true });

  const cp = chunkPath(sessionId, idx);
  try {
    // Buffer を直接 writeFileSync するとメモリ効率が良い（25MB MAX なので許容範囲）。
    const { writeFileSync } = await import('node:fs');
    writeFileSync(cp, chunkData.buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: `チャンク保存に失敗しました: ${msg}` });
    return;
  }

  // ── 中間チャンク ──────────────────────────────────────────────
  if (idx < total - 1) {
    res.status(200).json({ ok: true, received: idx });
    return;
  }

  // ── 最終チャンク: アセンブル ──────────────────────────────────
  // relpath をサニタイズして最終保存パスを確定。
  let finalAbsPath: string;
  let finalRelpath: string;
  let safeFilename: string;
  try {
    // DELIVERABLES_DIR が存在しない場合は作成。
    if (!existsSync(DELIVERABLES_DIR)) {
      mkdirSync(DELIVERABLES_DIR, { recursive: true });
    }
    const { subDir, safeFilename: fn } = extractUploadRelPath(relpath);
    safeFilename = fn;
    const { absPath, relpath: rp } = resolveUploadTarget(fn, subDir);
    finalAbsPath = absPath;
    finalRelpath = rp;
  } catch (e) {
    cleanupSession(sessionId);
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: `ファイルパスが不正です: ${msg}` });
    return;
  }

  try {
    await assembleChunks(sessionId, total, finalAbsPath);
  } catch (e) {
    cleanupSession(sessionId);
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: `チャンクのアセンブルに失敗しました: ${msg}` });
    return;
  }

  // アセンブル完了 → temp を掃除。
  cleanupSession(sessionId);

  // ファイルサイズを確認。
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(finalAbsPath).size;
  } catch {
    // stat 失敗は致命的でない。
  }

  res.status(201).json({
    ok: true,
    assembled: true,
    name: safeFilename,
    relpath: finalRelpath,
    sizeBytes,
  });

  // アセンブル完了後はイベントを emit（watch に通知）。
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/deliverables/upload-chunk ルータ。index.ts で auth ミドルウェア配下に mount する。 */
export function deliverableChunkRouter(): Router {
  const router = Router();
  router.post('/upload-chunk', (req, res) => void handleChunk(req, res));
  return router;
}
