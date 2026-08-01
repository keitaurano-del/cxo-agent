// terminalUpload — ターミナルファイル添付（MC-95 / 拡張）。
//
// Apollo のターミナルビューからファイルをアップロードし、tmux main（林 CLI 常駐）の
// 入力欄へ「保存先の絶対パス」を send-keys でリテラル注入する。林はそのパスを
// Read で読める。Keita が続けてメッセージを添えて Enter する想定なので、
// 自動 Enter は送らない（C-m を付けない）。
//
// 流儀は inbox.ts の画像添付に倣う:
//  - multipart（images フィールド）でメモリ受け → サニタイズ名で保存
//  - MIME（画像 / テキスト / ドキュメント / 動画 / 音声）と拡張子の二重検証
//  - サイズ上限は config の TERMINAL_UPLOAD_MAX_FILE_BYTES（既定 1GB）、最大 5 個
//    （注入はパスを送るだけなのでファイル種別を問わず動く＝関門は MIME 許可と上限のみ）
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
import {
  mkdirSync,
  unlinkSync,
  existsSync,
  rmSync,
  writeFileSync,
  statSync,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
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
// 画像（png/jpeg/webp/gif）＋テキスト系に加え、ドキュメント（PDF/Office/OpenDocument/RTF）と
// 動画（video/*）・音声（audio/*）も受け付ける。動画/音声は prefix 判定（text/* と同様）。
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
  'text/rtf',
  // application 系（コード/設定）
  'application/json',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
  // ドキュメント
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.oasis.opendocument.text', // .odt
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
  'application/vnd.oasis.opendocument.presentation', // .odp
  'application/rtf',
]);

// 拡張子ホワイトリスト（MIME の二重検証）。MIME が空/unknown のときの判定にも使う。
// 画像・テキスト・ドキュメント・動画・音声を網羅する。
const ALLOWED_EXT = new Set([
  // 画像
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  // テキスト/コード/設定
  '.txt', '.md', '.csv', '.ts', '.js', '.py', '.json', '.yaml', '.yml',
  // ドキュメント
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
  // 動画
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v',
  // 音声
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
]);

/** ファイル名から小文字拡張子を取り出す（無ければ ''）。 */
function lowerExt(name: string): string {
  return extname(name || '').toLowerCase();
}

/**
 * ファイルが許可されているか判定する。
 * - text/ / video/ / audio/ プレフィックスはすべて許容する（未知サブタイプ込み）。
 * - 個別 MIME は ALLOWED_MIME で判定。
 * - MIME が空/unknown（application/octet-stream 等）のときは拡張子ホワイトリストで判定する。
 *   これによりブラウザが MIME を付けない大物（mkv 等）も拡張子で通せる。
 */
function isAllowedMime(mime: string, originalName = ''): boolean {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  if (m.startsWith('text/') || m.startsWith('video/') || m.startsWith('audio/')) return true;
  if (ALLOWED_MIME.has(m)) return true;
  // MIME が空 or 汎用（octet-stream）なら拡張子で救済する。
  if (!m || m === 'application/octet-stream') {
    return ALLOWED_EXT.has(lowerExt(originalName));
  }
  return false;
}

// MIME → 正規拡張子。画像のみ。元ファイル名の拡張子が欠落/不一致のとき画像は補正する。
// 非画像（ドキュメント/動画/音声/テキスト）は元名の拡張子を尊重する（補正しない）。
const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
// 画像拡張子の許可リスト（jpeg/jpg 両方許容）。画像以外は拡張子補正対象外。
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

// 非画像の代表 MIME → 拡張子。拡張子が全く無いファイルにのみ補完用途で使う
// （元名に拡張子があればそちらを尊重する）。網羅しなくてよい＝無ければ無拡張のまま。
const NON_IMAGE_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/rtf': '.rtf',
  'application/json': '.json',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
};

/** 分散送信のグループサイズ上限。 */
const DISTRIBUTE_GROUP_SIZE = 5;

// ─── multer（ディスク保存・ストリーム）──────────────────────────
// diskStorage でディスクへ直接ストリーム保存する。動画/音声・最大1GB をメモリに載せない
// （memoryStorage だと 1GB×複数が RAM に載り、さらに writeFileSync(1GB) の同期書き込みが
// イベントループをブロックしてターミナル固まりを再発させる）。保存名は filename コールバックで
// buildFilename（タイムスタンプ+乱数+サニタイズ名）を使い衝突を避ける。
// fileFilter で MIME を弾き、サイズ/枚数は limits で弾く。
const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      mkdirSync(TERMINAL_UPLOADS_DIR, { recursive: true });
      cb(null, TERMINAL_UPLOADS_DIR);
    },
    filename(_req, file, cb) {
      cb(null, buildFilename(new Date(), file.originalname, file.mimetype));
    },
  }),
  limits: {
    fileSize: TERMINAL_UPLOAD_MAX_FILE_BYTES,
    files: TERMINAL_UPLOAD_MAX_FILES,
  },
  fileFilter(_req, file, cb) {
    if (!isAllowedMime(file.mimetype, file.originalname)) {
      cb(new Error('unsupported file type: images / text / documents (pdf, office, opendocument, rtf) / video / audio are allowed'));
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
    // 非画像（テキスト/ドキュメント/動画/音声）: 拡張子が許可外でも補正しない（元名を尊重）。
    // ただし拡張子が全く無い場合のみ補う。テキスト系は .txt、それ以外は MIME 由来があれば
    // それを使い、無ければ無拡張のまま残す（動画/音声の binary を .txt 化しない）。
    if (!ext) {
      if (m.startsWith('text/')) return `${iso}-${rand}-${safe}.txt`;
      const fromMime = NON_IMAGE_MIME_TO_EXT[m];
      if (fromMime) return `${iso}-${rand}-${safe}${fromMime}`;
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
  // 完全一致 pane ターゲット。bare 'openclaw' は tmux 前方一致で 'openclaw-son'(Son) に化けるため
  // ファイルパス注入が別端末へ飛ばないよう `=name:` で固定する（MC-310 と同根）。
  const paneT = `=${t.tmuxSession}:`;
  const tmuxArgs = ['send-keys', '-t', paneT, '-l', literal];
  const execOpts = {
    encoding: 'utf-8' as const,
    timeout: TERMINAL_TMUX_TIMEOUT_MS,
    env: injectEnv(),
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  if (!t.remote) {
    execFileSync('tmux', tmuxArgs, execOpts);
    if (sendEnter) {
      execFileSync('tmux', ['send-keys', '-t', paneT, 'Enter'], execOpts);
    }
    return;
  }
  const r = t.remote;
  const sshOpts = ['-i', r.sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  const sshTarget = `${r.sshUser}@${r.sshHost}`;
  const remoteCmd = ['tmux', ...tmuxArgs.map(shquote)].join(' ');
  execFileSync('ssh', [...sshOpts, sshTarget, remoteCmd], execOpts);
  if (sendEnter) {
    const enterCmd = `tmux send-keys -t ${shquote(paneT)} Enter`;
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

  // diskStorage が既に data/terminal-uploads/ へストリーム保存済み。multer が確定した
  // 絶対パス（f.path）をそのまま使う。MIME は fileFilter で gate 済みだが念のため二重チェックし、
  // NG なら保存済みファイルを片付けて 400（diskStorage は fileFilter 通過後に書くので通常ここは通る）。
  const savedPaths: string[] = [];
  for (const f of files) {
    const abs = f.path ?? join(TERMINAL_UPLOADS_DIR, f.filename);
    if (!isAllowedMime(f.mimetype, f.originalname)) {
      try { unlinkSync(abs); } catch { /* 片付け失敗は無視 */ }
      res.status(400).json({ error: `unsupported file type: ${f.mimetype}` });
      return;
    }
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

// ─── チャンクアップロード（大容量対応・cloudflared ~100MB/req 制限の回避）──────
// 1ファイルを 20MB 程度のチャンクに分割してクライアントから順次 POST し、サーバで結合する。
// 各リクエストが小さいのでトンネル上限・タイムアウトに当たらず、1GB 級でもアップロードできる。
// 結合後は単発 upload と同じく対象ターミナルへ絶対パスを send-keys 注入する。
// deliverableChunkRouter と同じ作法（temp に chunk-N 保存 → 最終チャンクで結合）。

/** チャンク一時保存の親（data/terminal-uploads/.chunks/<sessionId>/chunk-<N>）。 */
const CHUNK_TEMP_BASE = join(TERMINAL_UPLOADS_DIR, '.chunks');
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function chunkSessionDir(sessionId: string): string {
  return join(CHUNK_TEMP_BASE, sessionId);
}
function chunkPartPath(sessionId: string, index: number): string {
  return join(chunkSessionDir(sessionId), `chunk-${index}`);
}
function cleanupChunkSession(sessionId: string): void {
  try {
    const dir = chunkSessionDir(sessionId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.warn('[terminal-upload] chunk cleanup failed for session', sessionId, e);
  }
}

/** 全チャンクを順番に結合して最終ファイルへ書き出す。 */
async function assembleChunks(sessionId: string, totalChunks: number, finalAbsPath: string): Promise<void> {
  const ws = createWriteStream(finalAbsPath, { flags: 'w' });
  try {
    for (let i = 0; i < totalChunks; i++) {
      const cp = chunkPartPath(sessionId, i);
      if (!existsSync(cp)) throw new Error(`チャンク ${i} が見つかりません（session: ${sessionId}）`);
      await pipeline(createReadStream(cp), ws, { end: false });
    }
  } finally {
    ws.end();
    await new Promise<void>((resolve, reject) => {
      ws.on('finish', resolve);
      ws.on('error', reject);
    });
  }
}

/** 対象ターミナルへローカルパス群を注入する（remote は scp 経由）。例外は畳んで injected:false。 */
function injectToTerminal(
  t: TerminalDef,
  localPaths: string[],
  sendEnter: boolean,
): { paths: string[]; injected: boolean; error?: string } {
  let injectPaths = localPaths;
  try {
    if (t.remote) injectPaths = scpToRemote(t.remote, localPaths);
    sendPathsToTmux(t, injectPaths, sendEnter);
    return { paths: injectPaths, injected: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[terminal-upload] inject to terminal ${t.id} failed:`, error);
    return { paths: injectPaths, injected: false, error };
  }
}

// チャンクは memoryStorage（各 ≤ 25MB なのでメモリ可）。フィールド名は 'chunk'。
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
function runChunkMulter(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    chunkUpload.single('chunk')(req, res, (err: unknown) => {
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

/**
 * POST /api/terminal/upload-chunk — 1ファイルを分割アップロード。
 * フィールド: chunk(Blob) / sessionId / filename / mimetype / chunkIndex / totalChunks / terminal / sendEnter
 * 中間チャンクは 200、最終チャンクで結合 → MIME 検証 → tmux 注入 → 201。
 */
async function handleUploadChunk(req: Request, res: Response): Promise<void> {
  const ok = await runChunkMulter(req, res);
  if (!ok) return;

  // 診断ログ（一時）: req.body が空になる事象の切り分け用。
  console.error(
    '[terminal-upload-chunk] ct=%s hasBody=%s bodyKeys=%j hasFile=%s fileField=%s',
    req.headers['content-type'],
    !!req.body,
    req.body && typeof req.body === 'object' ? Object.keys(req.body as object) : null,
    !!req.file,
    req.file?.fieldname,
  );

  // req.body が未定義でもクラッシュさせない（空オブジェクトに畳む）。
  const body = (req.body ?? {}) as {
    sessionId?: string;
    filename?: string;
    mimetype?: string;
    chunkIndex?: string;
    totalChunks?: string;
    terminal?: string;
    sendEnter?: string;
  };
  const sessionId = body.sessionId ?? '';
  const filename = (body.filename ?? '').trim();
  const mime = (body.mimetype ?? '').trim();

  if (!SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: 'sessionId が不正です（英数字・_- のみ、64文字以内）。' });
    return;
  }
  if (!filename) {
    res.status(400).json({ error: 'filename が必要です。' });
    return;
  }
  const idx = parseInt(body.chunkIndex ?? '', 10);
  const total = parseInt(body.totalChunks ?? '', 10);
  if (!Number.isFinite(idx) || idx < 0 || idx > 999) {
    res.status(400).json({ error: 'chunkIndex が不正です（0〜999）。' });
    return;
  }
  if (!Number.isFinite(total) || total < 1 || total > 1000 || idx >= total) {
    res.status(400).json({ error: 'totalChunks が不正です。' });
    return;
  }
  // 最初のチャンクで MIME/拡張子を検証し、ダメなら早期に弾く（無駄なアップロードを防ぐ）。
  if (idx === 0 && !isAllowedMime(mime, filename)) {
    cleanupChunkSession(sessionId);
    res.status(400).json({ error: 'unsupported file type: images / text / documents / video / audio are allowed' });
    return;
  }
  const chunkData = req.file;
  if (!chunkData || !chunkData.buffer || chunkData.buffer.byteLength === 0) {
    res.status(400).json({ error: 'チャンクデータがありません（フィールド名は "chunk"）。' });
    return;
  }

  mkdirSync(chunkSessionDir(sessionId), { recursive: true });
  try {
    writeFileSync(chunkPartPath(sessionId, idx), chunkData.buffer);
  } catch (e) {
    cleanupChunkSession(sessionId);
    res.status(500).json({ error: `チャンク保存に失敗しました: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }

  // 中間チャンク。
  if (idx < total - 1) {
    res.status(200).json({ ok: true, received: idx });
    return;
  }

  // 最終チャンク: 結合 → 注入。
  if (!isAllowedMime(mime, filename)) {
    cleanupChunkSession(sessionId);
    res.status(400).json({ error: `unsupported file type: ${mime}` });
    return;
  }
  mkdirSync(TERMINAL_UPLOADS_DIR, { recursive: true });
  const finalAbs = join(TERMINAL_UPLOADS_DIR, buildFilename(new Date(), filename, mime));
  try {
    await assembleChunks(sessionId, total, finalAbs);
  } catch (e) {
    cleanupChunkSession(sessionId);
    res.status(500).json({ error: `チャンク結合に失敗しました: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  cleanupChunkSession(sessionId);

  let sizeBytes = 0;
  try { sizeBytes = statSync(finalAbs).size; } catch { /* stat 失敗は致命的でない */ }

  const t = resolveTerminal(body.terminal);
  const shouldSendEnter = String(body.sendEnter ?? '0') !== '0';
  const result = injectToTerminal(t, [finalAbs], shouldSendEnter);

  res.status(201).json({
    count: 1,
    paths: result.paths,
    injected: result.injected,
    ...(result.error ? { injectError: result.error } : {}),
    target: t.tmuxSession,
    sizeBytes,
  });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/terminal 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function terminalUploadRouter(): Router {
  const router = Router();
  router.post('/upload', (req, res) => void handleUpload(req, res));
  // 大容量ファイル向け分割アップロード（cloudflared ~100MB/req 回避）。
  router.post('/upload-chunk', (req, res) => void handleUploadChunk(req, res));
  return router;
}
