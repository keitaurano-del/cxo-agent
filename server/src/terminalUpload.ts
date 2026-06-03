// terminalUpload — ターミナル画像添付（MC-95）。
//
// Apollo のターミナルビューから画像をアップロードし、tmux main（林 CLI 常駐）の
// 入力欄へ「保存先の絶対パス」を send-keys でリテラル注入する。林はそのパスを
// Read で画像として読める。Keita が続けてメッセージを添えて Enter する想定なので、
// 自動 Enter は送らない（C-m を付けない）。
//
// 流儀は inbox.ts の画像添付に倣う:
//  - multipart（images フィールド）でメモリ受け → サニタイズ名で保存
//  - 画像 MIME（png/jpeg/webp/gif）と拡張子の二重検証
//  - 1 枚 10MB・最大 5 枚（config の TERMINAL_UPLOAD_* で上限）
//
// ストレージ: data/terminal-uploads/<timestamp>-<rand>-<safe-name>
//  inbox と違い <id>/ ディレクトリは切らずフラットに置く（履歴監査というより
//  「林に渡す一時画像」なので、衝突しないファイル名で 1 ファイル 1 パスにする）。
//
// セキュリティ:
//  - tmux send-keys には execFile（シェル経由でなく argv 直渡し）を使い、
//    `-l`（リテラルモード）でパス文字列を送る。シェル展開もキーバインド解釈も
//    起きないため、パスにどんな文字が混じってもインジェクションにならない。
//  - 認証は index.ts 側の makeAuthMiddleware 配下に mount することで担保（Cookie 必須）。

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import {
  TERMINAL_UPLOADS_DIR,
  TERMINAL_UPLOAD_MAX_FILE_BYTES,
  TERMINAL_UPLOAD_MAX_FILES,
  TERMINAL_TMUX_PATH,
  TERMINAL_TMUX_TIMEOUT_MS,
  TERMINALS,
  terminalById,
  type TerminalDef,
} from './config.js';
import { sanitizeFilename } from './lib/inboxPath.js';

// ─── 許可する画像 MIME と拡張子 ─────────────────────────────
// 林が Read で画像として読める形式に限定する（png/jpeg/webp/gif）。
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
// MIME → 正規拡張子。元ファイル名の拡張子が欠落/不一致のとき補正に使う。
const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
// 拡張子の許可リスト（jpeg/jpg 両方許容）。
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

// ─── multer（メモリ保存）──────────────────────────────────
// 保存名は id 確定後に組むため、いったんメモリに溜める。
// fileFilter で MIME を弾き、サイズ/枚数は limits で弾く。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TERMINAL_UPLOAD_MAX_FILE_BYTES,
    files: TERMINAL_UPLOAD_MAX_FILES,
  },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
      cb(new Error('only png/jpeg/webp/gif images are allowed'));
      return;
    }
    cb(null, true);
  },
});

const uploadImages = upload.array('images', TERMINAL_UPLOAD_MAX_FILES);

/** multer を Promise 化。サイズ/枚数超過・MIME reject は 400 を送って false を返す。 */
function runUpload(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    uploadImages(req, res, (err: unknown) => {
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

// ─── 保存名 ─────────────────────────────────────────────

/**
 * 時刻 + 乱数 + サニタイズ済み元名で、衝突しないフラットなファイル名を組む。
 * 例: 2026-06-01T12-34-56-789Z-a1b2c3d4-screenshot.png
 * 拡張子は元名のものを優先しつつ、許可外/欠落なら MIME 由来の拡張子で補正する。
 */
function buildFilename(now: Date, originalName: string, mimetype: string): string {
  const iso = now.toISOString().replace(/[:.]/g, '-');
  const rand = randomBytes(4).toString('hex');
  const safe = sanitizeFilename(originalName || 'image');
  const ext = extname(safe).toLowerCase();
  const wantExt = MIME_TO_EXT[mimetype.toLowerCase()] ?? '.png';
  // 元名の拡張子が許可リストに無い（or 無い）場合は MIME 由来に差し替える。
  if (!ALLOWED_EXT.has(ext)) {
    const stem = ext ? safe.slice(0, safe.length - ext.length) : safe;
    return `${iso}-${rand}-${stem}${wantExt}`;
  }
  return `${iso}-${rand}-${safe}`;
}

// ─── tmux 注入（MC-123 端末別 / local・remote）─────────────────

const injectEnv = (): NodeJS.ProcessEnv => ({ ...process.env, PATH: TERMINAL_TMUX_PATH });

/**
 * リモート実行用のシングルクオートエスケープ（terminalControl.ts と同方式）。
 * ssh は remote 側で引数を連結してシェル解釈するため、tmux コマンド文字列を安全な1引数に組む。
 */
function shquote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 対象ターミナルの tmux 入力欄へ、パス文字列をリテラル送出する（自動 Enter なし）。
 * - local(1/3): execFile('tmux', send-keys -t <session> -l <literal>)。
 * - remote(2): ssh 経由で旧箱の tmux apollo2 へ send-keys。tmux コマンドを shquote で1引数に組む。
 * 複数パスはスペース区切りで 1 文字列にまとめ、末尾にスペースを足して続けて入力できるようにする。
 * 失敗時は throw して呼び出し側で injected:false に畳む。
 */
function sendPathsToTmux(t: TerminalDef, paths: string[]): void {
  const literal = paths.join(' ') + ' ';
  const tmuxArgs = ['send-keys', '-t', t.tmuxSession, '-l', literal];
  if (!t.remote) {
    execFileSync('tmux', tmuxArgs, {
      encoding: 'utf-8',
      timeout: TERMINAL_TMUX_TIMEOUT_MS,
      env: injectEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return;
  }
  const r = t.remote;
  const remoteCmd = ['tmux', ...tmuxArgs.map(shquote)].join(' ');
  execFileSync(
    'ssh',
    ['-i', r.sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${r.sshUser}@${r.sshHost}`, remoteCmd],
    {
      encoding: 'utf-8',
      timeout: TERMINAL_TMUX_TIMEOUT_MS,
      env: injectEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

/**
 * remote(2) の場合: ローカルに保存した画像群を scp で旧箱の uploadDir へコピーし、
 * 旧箱側の絶対パス（uploadDir/<basename>）の配列を返す。
 * uploadDir は scp 前に ssh で mkdir -p しておく（初回でも失敗しないように）。
 * local(1/3) の場合は呼ばれない（呼び出し側で remote のときだけ使う）。
 */
function scpToRemote(r: NonNullable<TerminalDef['remote']>, localPaths: string[]): string[] {
  const sshTarget = `${r.sshUser}@${r.sshHost}`;
  const sshOpts = ['-i', r.sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  // uploadDir を用意（既存でも -p で no-op）。
  execFileSync('ssh', [...sshOpts, sshTarget, `mkdir -p ${shquote(r.uploadDir)}`], {
    encoding: 'utf-8',
    timeout: TERMINAL_TMUX_TIMEOUT_MS,
    env: injectEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const remotePaths: string[] = [];
  for (const lp of localPaths) {
    const base = lp.slice(lp.lastIndexOf('/') + 1);
    // scp は execFile（argv 直渡し）。dest は user@host:dir/ 形式。
    execFileSync(
      'scp',
      [...sshOpts, lp, `${sshTarget}:${r.uploadDir}/`],
      {
        encoding: 'utf-8',
        timeout: TERMINAL_TMUX_TIMEOUT_MS,
        env: injectEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    remotePaths.push(`${r.uploadDir}/${base}`);
  }
  return remotePaths;
}

/**
 * リクエストからターミナル定義を解決する（query / body の terminal、未指定なら 1）。
 * 不正値・未定義 id はターミナル1へフォールバック（後方互換）。
 */
function resolveTerminal(raw: unknown): TerminalDef {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  const t = !isNaN(n) ? terminalById(n) : undefined;
  return t ?? terminalById(1) ?? TERMINALS[0];
}

// ─── ハンドラ ───────────────────────────────────────────

/** POST /api/terminal/upload — multipart の画像を受け、保存→tmux 注入。 */
async function handleUpload(req: Request, res: Response): Promise<void> {
  mkdirSync(TERMINAL_UPLOADS_DIR, { recursive: true });

  const ok = await runUpload(req, res);
  if (!ok) return;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'at least one image is required' });
    return;
  }

  // 対象ターミナルを解決（multipart の terminal フィールド or クエリ、未指定は 1）。
  const t = resolveTerminal(
    (req.body as { terminal?: unknown } | undefined)?.terminal ?? req.query.terminal,
  );

  const now = new Date();
  const savedPaths: string[] = [];
  const used = new Set<string>();
  for (const f of files) {
    // MIME を二重チェック（fileFilter を通っているはずだが念のため）。
    if (!ALLOWED_MIME.has(f.mimetype.toLowerCase())) {
      res.status(400).json({ error: `unsupported image type: ${f.mimetype}` });
      return;
    }
    let fname = buildFilename(now, f.originalname, f.mimetype);
    // タイムスタンプ+乱数で実質衝突しないが、同一バッチの取り違え保険に連番化。
    if (used.has(fname)) {
      const ext = extname(fname);
      const stem = fname.slice(0, fname.length - ext.length);
      let n = 1;
      while (used.has(`${stem}-${n}${ext}`)) n += 1;
      fname = `${stem}-${n}${ext}`;
    }
    used.add(fname);
    // 保存は常に NEW 箱（この箱）の data/terminal-uploads/。
    const abs = join(TERMINAL_UPLOADS_DIR, fname);
    writeFileSync(abs, f.buffer);
    savedPaths.push(abs);
  }

  // remote(2) は scp で旧箱へコピーし、注入するのは旧箱側の絶対パス。
  // local(1/3) はこの箱の絶対パスをそのまま注入する。
  let injectPaths = savedPaths;
  let injected = true;
  let injectError: string | undefined;
  try {
    if (t.remote) {
      injectPaths = scpToRemote(t.remote, savedPaths);
    }
    sendPathsToTmux(t, injectPaths);
  } catch (e) {
    injected = false;
    injectError = e instanceof Error ? e.message : String(e);
    console.error('[terminal-upload] inject failed:', injectError);
  }

  res.status(201).json({
    count: savedPaths.length,
    // paths は注入したパス（remote なら旧箱パス、local なら NEW 箱パス）。UI のフォールバック表示用。
    paths: injectPaths,
    injected,
    ...(injectError ? { injectError } : {}),
    target: t.tmuxSession,
  });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/terminal 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function terminalUploadRouter(): Router {
  const router = Router();
  router.post('/upload', (req, res) => void handleUpload(req, res));
  return router;
}
