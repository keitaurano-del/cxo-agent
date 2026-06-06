// terminalUpload — ターミナルファイル添付（MC-95 / 拡張）。
//
// Apollo のターミナルビューからファイルをアップロードし、tmux main（林 CLI 常駐）の
// 入力欄へ「保存先の絶対パス」を send-keys でリテラル注入する。林はそのパスを
// Read で読める。Keita が続けてメッセージを添えて Enter する想定なので、
// 自動 Enter は送らない（C-m を付けない）。
//
// 流儀は inbox.ts の画像添付に倣う:
//  - multipart（images フィールド）でメモリ受け → サニタイズ名で保存
//  - MIME（画像 + テキスト系）と拡張子の二重検証
//  - 1 ファイル 10MB・最大 5 個（config の TERMINAL_UPLOAD_* で上限）
//
// 大量ファイルの自動分散（拡張）:
//  - アップロードされたファイルが 5 個を超える場合、複数ターミナルにラウンドロビン分散する。
//  - ターミナル1 → ターミナル2（旧箱）→ ターミナル3 の順、各グループ最大 5 ファイル。
//  - レスポンスに distribution フィールドを含める。
//
// ストレージ: data/terminal-uploads/<timestamp>-<rand>-<safe-name>
//  inbox と違い <id>/ ディレクトリは切らずフラットに置く（履歴監査というより
//  「林に渡す一時ファイル」なので、衝突しないファイル名で 1 ファイル 1 パスにする）。
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

// ─── 許可する MIME と拡張子 ──────────────────────────────────
// 画像（png/jpeg/webp/gif）に加え、テキスト系ファイルも受け付ける。
const ALLOWED_MIME = new Set([
  // 画像
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // テキスト系（text/* ワイルドカードは fileFilter 内で prefix 判定）
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/x-typescript',
  'text/x-python',
  'text/javascript',
  'text/x-javascript',
  // application 系
  'application/json',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
]);

/**
 * MIME が許可されているか判定する。
 * text/* プレフィックスはすべて許容する（text/x-* 等の未知サブタイプ込み）。
 */
function isAllowedMime(mime: string): boolean {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m.startsWith('text/')) return true;
  return ALLOWED_MIME.has(m);
}

// MIME → 正規拡張子。画像のみ。元ファイル名の拡張子が欠落/不一致のとき画像は補正する。
const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
// 画像拡張子の許可リスト（jpeg/jpg 両方許容）。画像以外は拡張子補正対象外。
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** 分散送信のグループサイズ上限。 */
const DISTRIBUTE_GROUP_SIZE = 5;

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
    if (!isAllowedMime(file.mimetype)) {
      cb(new Error('unsupported file type: only images (png/jpeg/webp/gif) and text files (txt/md/ts/js/py/json/yaml/csv) are allowed'));
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
  const m = mimetype.toLowerCase().split(';')[0].trim();
  const isImage = m.startsWith('image/');
  const safe = sanitizeFilename(originalName || (isImage ? 'image' : 'file'));
  const ext = extname(safe).toLowerCase();
  if (isImage) {
    // 画像: 拡張子が許可リスト外なら MIME 由来に補正する。
    const wantExt = MIME_TO_EXT[m] ?? '.png';
    if (!IMAGE_EXT.has(ext)) {
      const stem = ext ? safe.slice(0, safe.length - ext.length) : safe;
      return `${iso}-${rand}-${stem}${wantExt}`;
    }
  } else {
    // テキスト系: 拡張子が許可リスト外でも補正しない（元名を尊重）。
    // ただし拡張子が全く無い場合は .txt を補う。
    if (!ext) {
      return `${iso}-${rand}-${safe}.txt`;
    }
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
 * 対象ターミナルの tmux 入力欄へ、パス文字列をリテラル送出する。
 * sendEnter=true のとき: リテラル注入後に別コマンドで Enter キーも送る（C-m 相当）。
 * - local(1/3): execFile('tmux', send-keys -t <session> -l <literal>) → 必要なら Enter。
 * - remote(2): ssh 経由で旧箱の tmux apollo2 へ send-keys（2回 ssh の許容範囲）。
 * 複数パスはスペース区切りで 1 文字列にまとめ、末尾にスペースを足して続けて入力できるようにする。
 * 失敗時は throw して呼び出し側で injected:false に畳む。
 */
function sendPathsToTmux(t: TerminalDef, paths: string[], sendEnter = false): void {
  const literal = ' ' + paths.join(' ') + ' ';
  const tmuxArgs = ['send-keys', '-t', t.tmuxSession, '-l', literal];
  const execOpts = {
    encoding: 'utf-8' as const,
    timeout: TERMINAL_TMUX_TIMEOUT_MS,
    env: injectEnv(),
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  if (!t.remote) {
    execFileSync('tmux', tmuxArgs, execOpts);
    if (sendEnter) {
      execFileSync('tmux', ['send-keys', '-t', t.tmuxSession, 'Enter'], execOpts);
    }
    return;
  }
  const r = t.remote;
  const sshOpts = ['-i', r.sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  const sshTarget = `${r.sshUser}@${r.sshHost}`;
  const remoteCmd = ['tmux', ...tmuxArgs.map(shquote)].join(' ');
  execFileSync('ssh', [...sshOpts, sshTarget, remoteCmd], execOpts);
  if (sendEnter) {
    const enterCmd = `tmux send-keys -t ${shquote(t.tmuxSession)} Enter`;
    execFileSync('ssh', [...sshOpts, sshTarget, enterCmd], execOpts);
  }
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

/** POST /api/terminal/upload — multipart のファイルを受け、保存→tmux 注入。5 個超えは自動分散。 */
async function handleUpload(req: Request, res: Response): Promise<void> {
  mkdirSync(TERMINAL_UPLOADS_DIR, { recursive: true });

  const ok = await runUpload(req, res);
  if (!ok) return;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'at least one file is required' });
    return;
  }

  // 対象ターミナルを解決（multipart の terminal フィールド or クエリ、未指定は 1）。
  const requestedTerminal = resolveTerminal(
    (req.body as { terminal?: unknown } | undefined)?.terminal ?? req.query.terminal,
  );

  // sendEnter=1 のとき: パス注入後に Enter キーも送る（Enter キーを preventDefault した場合に使う）。
  const body = req.body as { sendEnter?: unknown } | undefined;
  const shouldSendEnter = String(body?.sendEnter ?? '0') !== '0';

  const now = new Date();
  const savedPaths: string[] = [];
  const used = new Set<string>();
  for (const f of files) {
    // MIME を二重チェック（fileFilter を通っているはずだが念のため）。
    if (!isAllowedMime(f.mimetype)) {
      res.status(400).json({ error: `unsupported file type: ${f.mimetype}` });
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

  // ─── 分散ロジック ─────────────────────────────────────────
  // ファイル数が DISTRIBUTE_GROUP_SIZE（5）以下は従来通り指定ターミナルへ一括注入。
  // 超える場合はターミナル1→2→3 の順にラウンドロビンで各グループ最大 5 ファイルずつ分散する。
  // 分散時は指定ターミナル（requestedTerminal）を使わず、常にターミナル1起点でラウンドロビンする。

  // 分散先のターミナル順序: 旧箱（2）を先頭にして新箱（1/3）へオーバーフロー。
  // ターミナル2は別アカウント（keita.urano2）なのでコンテキストが独立しており、
  // 大量アップロードを優先的に受け持たせることで新箱の枯渇を防ぐ。
  const DISTRIBUTE_TERMINAL_IDS = [2, 1, 3];

  /** ファイルグループをターミナルへ注入する。失敗しても例外をスローせず結果を返す。 */
  async function injectGroup(
    t: TerminalDef,
    localPaths: string[],
    sendEnter = false,
  ): Promise<{ terminal: number; count: number; paths: string[]; injected: boolean; error?: string }> {
    let injectPaths = localPaths;
    try {
      if (t.remote) {
        injectPaths = scpToRemote(t.remote, localPaths);
      }
      sendPathsToTmux(t, injectPaths, sendEnter);
      return { terminal: t.id, count: localPaths.length, paths: injectPaths, injected: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[terminal-upload] inject to terminal ${t.id} failed:`, error);
      return { terminal: t.id, count: localPaths.length, paths: injectPaths, injected: false, error };
    }
  }

  if (savedPaths.length <= DISTRIBUTE_GROUP_SIZE) {
    // 5 個以下: 従来通り指定ターミナルへ一括注入。
    const t = requestedTerminal;
    const result = await injectGroup(t, savedPaths, shouldSendEnter);
    res.status(201).json({
      count: savedPaths.length,
      paths: result.paths,
      injected: result.injected,
      ...(result.error ? { injectError: result.error } : {}),
      target: t.tmuxSession,
    });
    return;
  }

  // 5 個超え: ラウンドロビン分散。
  // ファイルを DISTRIBUTE_GROUP_SIZE ずつのチャンクに分割し、ターミナル1→2→3 と順に割り当てる。
  const chunks: string[][] = [];
  for (let i = 0; i < savedPaths.length; i += DISTRIBUTE_GROUP_SIZE) {
    chunks.push(savedPaths.slice(i, i + DISTRIBUTE_GROUP_SIZE));
  }

  const distribution: Array<{ terminal: number; count: number; paths: string[]; injected: boolean; error?: string }> = [];
  for (let i = 0; i < chunks.length; i++) {
    const tid = DISTRIBUTE_TERMINAL_IDS[i % DISTRIBUTE_TERMINAL_IDS.length];
    const t = terminalById(tid) ?? requestedTerminal;
    const result = await injectGroup(t, chunks[i]);
    distribution.push(result);
  }

  const allInjected = distribution.every((d) => d.injected);
  const allPaths = distribution.flatMap((d) => d.paths);

  res.status(201).json({
    count: savedPaths.length,
    paths: allPaths,
    injected: allInjected,
    distribution: distribution.map((d) => ({
      terminal: d.terminal,
      count: d.count,
      paths: d.paths,
      ...(d.error ? { error: d.error } : {}),
    })),
  });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/terminal 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function terminalUploadRouter(): Router {
  const router = Router();
  router.post('/upload', (req, res) => void handleUpload(req, res));
  return router;
}
