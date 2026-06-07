// vaultWriteRouter — Apollo から Vault へ書き込む API（auth ミドルウェア配下）。
//
//  POST /api/vault/note           (JSON)       : ノート(.md)作成 → 20-Knowledge 等
//  POST /api/vault/upload         (multipart)  : ファイル保存 → 99-Attachments
//  POST /api/vault/notes/:id/save (JSON)       : 既存ノート編集・保存（obsidian-git 同期競合対策込み）
//
// いずれも書き込み後に VAULT_DIR で自動 git add/commit/pull --rebase/push する。
// push 失敗時もファイル作成は成功（201）。レスポンスに pushed:true/false と path を含める。
// 編集保存時は競合検知で 409 を返し、退避ファイルを作成する。

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import {
  VAULT_NOTE_DEFAULT_FOLDER,
  VAULT_ATTACHMENTS_FOLDER,
  VAULT_UPLOAD_MAX_FILE_BYTES,
  VAULT_UPLOAD_MAX_FILES,
} from './config.js';
import { SafePathError } from './lib/vaultPath.js';
import { resolveVaultPath } from './lib/vaultPath.js';
import {
  resolveVaultFolder,
  slugifyTitle,
  sanitizeUploadFilename,
  resolveNonConflictingPath,
  commitAndPush,
  vaultIsGitRepo,
  gitPullWithConflictDetection,
} from './lib/vaultWrite.js';

// ─── multer（メモリ保存。id 採番後に書き出す inbox と同様）──────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: VAULT_UPLOAD_MAX_FILE_BYTES,
    files: VAULT_UPLOAD_MAX_FILES,
  },
});
const uploadFiles = upload.array('files', VAULT_UPLOAD_MAX_FILES);

function runUpload(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    uploadFiles(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

// ─── frontmatter ──────────────────────────────────────────

/** YAML 文字列値を安全に quote する（コロン・引用符・改行対策）。 */
function yamlString(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function buildNoteContent(title: string, body: string, created: string): string {
  const fm = ['---', `title: ${yamlString(title)}`, `created: ${created}`, '---', ''].join('\n');
  // 末尾に改行を1つ保証。
  const content = body.endsWith('\n') ? body : body + '\n';
  return fm + '\n' + content;
}

// ─── ハンドラ ───────────────────────────────────────────

/** POST /api/vault/note — JSON {title, body, folder?} を受けて .md を作成。 */
function handleNote(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title === '') {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const noteBody = typeof body.body === 'string' ? body.body : '';

  let folder: string;
  let absPath: string;
  let relPath: string;
  try {
    folder = resolveVaultFolder(body.folder, VAULT_NOTE_DEFAULT_FOLDER);
    const slug = slugifyTitle(title);
    ({ absPath, relPath } = resolveNonConflictingPath(folder, slug, '.md'));
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }

  const created = new Date().toISOString();
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, buildNoteContent(title, noteBody, created), 'utf-8');

  const git = vaultIsGitRepo()
    ? commitAndPush(relPath, `apollo: add ${relPath}`)
    : { pushed: false, reason: 'not a git repo' };
  if (!git.pushed && git.reason) {
    console.warn(`[vault/note] git not pushed: ${git.reason}`);
  }

  res.status(201).json({ ok: true, path: relPath, title, pushed: git.pushed });
}

/** POST /api/vault/upload — multipart files[] を 99-Attachments に保存。 */
async function handleUpload(req: Request, res: Response): Promise<void> {
  const ok = await runUpload(req, res);
  if (!ok) return;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'no files uploaded (field name must be "files")' });
    return;
  }

  const saved: { path: string; pushed: boolean }[] = [];
  const errors: string[] = [];

  for (const f of files) {
    try {
      const fname = sanitizeUploadFilename(f.originalname || 'file');
      const ext = extname(fname);
      const stem = ext ? fname.slice(0, -ext.length) : fname;
      const { absPath, relPath } = resolveNonConflictingPath(
        VAULT_ATTACHMENTS_FOLDER,
        stem || 'file',
        ext,
      );
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, f.buffer);

      const git = vaultIsGitRepo()
        ? commitAndPush(relPath, `apollo: add ${relPath}`)
        : { pushed: false, reason: 'not a git repo' };
      if (!git.pushed && git.reason) {
        console.warn(`[vault/upload] git not pushed: ${git.reason}`);
      }
      saved.push({ path: relPath, pushed: git.pushed });
    } catch (e) {
      if (e instanceof SafePathError) {
        errors.push(`${f.originalname}: ${e.message}`);
        continue;
      }
      errors.push(`${f.originalname}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (saved.length === 0) {
    res.status(400).json({ error: errors.join('; ') || 'upload failed' });
    return;
  }
  // 全件 push 成功なら pushed:true。
  const pushed = saved.every((s) => s.pushed);
  res.status(201).json({ ok: true, files: saved, pushed, errors: errors.length ? errors : undefined });
}

// ─── Router 組み立て ─────────────────────────────────────

/** POST /api/vault/notes/:id/save — 既存ノート本文を編集・保存（obsidian-git 同期競合対策）。 */
async function handleNoteSave(req: Request, res: Response): Promise<void> {
  const noteId = (req.params.id ?? '') as string;
  if (!noteId) {
    res.status(400).json({ error: 'noteId is required' });
    return;
  }

  // noteId は vault 相対パス（URL encoded）。decode して安全化。
  let relPath: string;
  let absPath: string;
  try {
    relPath = decodeURIComponent(noteId);
    // resolveVaultPath で VAULT_DIR 配下を保証（traversal/symlink 拒否）。
    absPath = resolveVaultPath(relPath);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }

  // ノートが存在するか確認。
  if (!existsSync(absPath)) {
    res.status(404).json({ error: 'note not found' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const newBody = typeof body.body === 'string' ? body.body : '';

  try {
    if (!vaultIsGitRepo()) {
      res.status(400).json({ error: 'vault is not a git repository' });
      return;
    }

    // (1) 競合対策: pull --rebase --autostash で最新版を取得。
    //     失敗＝コンフリクト中 → 409 で返す（abort は関数内でやる）。
    const pullResult = gitPullWithConflictDetection(relPath);
    if (pullResult.hasConflict) {
      // コンフリクト状態を検知。新本文を退避ファイルに保存。
      const conflictPath = `${absPath}.conflict`;
      writeFileSync(conflictPath, newBody, 'utf-8');
      console.warn(`[vault/notes/save] git conflict detected for ${relPath}. Content saved to ${conflictPath}`);
      res.status(409).json({
        error: 'git conflict detected',
        message: '競合を検知しました。競合ファイルが存在するため上書きは避けました。',
        conflictPath,
      });
      return;
    }

    // (2) 競合がなければファイルを書き込む。
    writeFileSync(absPath, newBody, 'utf-8');

    // (3) git add → commit → pull --rebase → push。
    const git = commitAndPush(relPath, `apollo: edit ${relPath}`);
    if (!git.pushed && git.reason) {
      console.warn(`[vault/notes/save] git not pushed: ${git.reason}`);
    }

    res.status(200).json({
      ok: true,
      path: relPath,
      pushed: git.pushed,
    });
  } catch (e) {
    console.error(`[vault/notes/save] error: ${e instanceof Error ? e.message : String(e)}`);
    res.status(500).json({
      error: e instanceof Error ? e.message : 'internal server error',
    });
  }
}

/** /api/vault 配下の書き込みルータ。index.ts で auth ミドルウェア配下に mount する。 */
export function vaultWriteRouter(): Router {
  const router = Router();
  // express.json はグローバルで適用済みなので note は body が入る。
  router.post('/note', (req, res) => handleNote(req, res));
  router.post('/upload', (req, res) => void handleUpload(req, res));
  router.post('/notes/:id/save', (req, res) => void handleNoteSave(req, res));
  return router;
}
