// terminalControl — ターミナルバックエンドの状態取得・復旧（MC-100）。
//
// PC のターミナルが切断された後（tmux main セッション消失 / ttyd 停止）に、Apollo の
// ターミナルビューの「ターミナルを開始」ボタンから tmux main（林 CLI 常駐）と ttyd を
// 再起動して復旧できるようにする。MC-95 の terminalUpload.ts と同じ流儀で、index.ts の
// makeAuthMiddleware 配下に mount する（Cookie 必須）。
//
// エンドポイント:
//   GET  /api/terminal/status — tmux main の有無・ttyd プロセスの稼働を返す（読み取りのみ）。
//   POST /api/terminal/start  — 冪等にバックエンドを復旧する。
//     - tmux main が無ければ作成（TERMINAL_TMUX_START_CMD で林 CLI を起動）。
//     - ttyd（systemd ユニット）が停止していれば start する。
//     - 既に両方稼働中なら何もせず ok を返す（no-op）。
//
// セキュリティ:
//   - 子プロセス起動は execFile 系（argv 直渡し・シェル経由なし）でシェルインジェクションを回避。
//   - tmux のターゲット名・systemd ユニット名は config 由来の固定値で、ユーザ入力を混ぜない。
//
// 安全制約（重要）:
//   - 本番 tmux `main` は Keita が対話中の林セッション。status は has-session の読み取りのみ、
//     start は「無ければ作る」だけで、稼働中の main を kill/再作成しない（new-session -d は
//     既存セッションがあると "duplicate session" で失敗するので、has-session で事前判定して
//     稼働中なら触らない）。

import { execFile } from 'node:child_process';
import { Router, type Request, type Response } from 'express';

import {
  TERMINAL_TMUX_TARGET,
  TERMINAL_TMUX_PATH,
  TERMINAL_TMUX_START_CMD,
  TERMINAL_TTYD_SERVICE,
  TERMINAL_TTYD_PORT,
  TERMINAL_TTYD_HOST,
  TERMINAL_CONTROL_TIMEOUT_MS,
} from './config.js';

// ─── 子プロセス実行ヘルパ（execFile を Promise 化）────────────────

interface ExecResult {
  code: number; // 終了コード（シグナル kill 等は -1）
  stdout: string;
  stderr: string;
}

/**
 * execFile を Promise 化する。コマンドが非 0 で終了しても reject せず ExecResult を返す
 * （systemctl is-active が inactive で exit 3 を返す等、非 0 を正常系として扱うため）。
 * spawn 自体に失敗（コマンド不在等）したときだけ reject する。
 */
function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: TERMINAL_CONTROL_TIMEOUT_MS, encoding: 'utf-8', env },
      (err, stdout, stderr) => {
        if (err && typeof (err as NodeJS.ErrnoException).code === 'string') {
          // ENOENT 等の spawn 失敗。code が文字列ならシステムエラー。
          reject(err);
          return;
        }
        const code =
          err && typeof (err as { code?: number }).code === 'number'
            ? ((err as { code?: number }).code as number)
            : 0;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}

const tmuxEnv = (): NodeJS.ProcessEnv => ({ ...process.env, PATH: TERMINAL_TMUX_PATH });

// ─── 状態取得 ────────────────────────────────────────────────

/** tmux main セッションが存在するか（has-session の exit code で判定）。 */
async function tmuxSessionExists(): Promise<boolean> {
  const r = await run('tmux', ['has-session', '-t', TERMINAL_TMUX_TARGET], tmuxEnv());
  return r.code === 0;
}

/** ttyd の systemd ユニットが active か。 */
async function ttydServiceActive(): Promise<boolean> {
  const r = await run('systemctl', ['is-active', TERMINAL_TTYD_SERVICE]);
  // is-active は active なら exit 0 / stdout "active"。inactive/failed は非 0。
  return r.code === 0 && r.stdout.trim() === 'active';
}

/** ttyd のポートへ TCP 接続できるか（プロセスが実際に listen しているか）。 */
function ttydPortReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    // 動的 import を避け、トップで import すると node:net 依存が増えるだけなので require 同様に。
    import('node:net')
      .then(({ Socket }) => {
        const socket = new Socket();
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(2000);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(TERMINAL_TTYD_PORT, TERMINAL_TTYD_HOST);
      })
      .catch(() => resolve(false));
  });
}

interface TerminalStatus {
  tmuxSession: boolean; // tmux main が存在するか
  ttydService: boolean; // ttyd の systemd ユニットが active か
  ttydReachable: boolean; // ttyd ポートへ実際に接続できるか
  ready: boolean; // ブラウザ端末がそのまま使えるか（両方 OK）
  target: string;
  service: string;
}

async function collectStatus(): Promise<TerminalStatus> {
  const [tmuxSession, ttydService, ttydReachable] = await Promise.all([
    tmuxSessionExists(),
    ttydServiceActive(),
    ttydPortReachable(),
  ]);
  return {
    tmuxSession,
    ttydService,
    ttydReachable,
    // ready の条件: tmux main があり、ttyd が active かつポート到達可能。
    ready: tmuxSession && ttydService && ttydReachable,
    target: TERMINAL_TMUX_TARGET,
    service: TERMINAL_TTYD_SERVICE,
  };
}

// ─── 復旧アクション ──────────────────────────────────────────

/**
 * tmux main を detached で作成する（林 CLI を起動）。
 * rin-terminal.sh / @reboot と同じく `new-session -d -s <target> <cmd>`。
 * cmd はシェルで解釈させる必要がある（cd ... && exec ...）ため、tmux に1引数として渡す
 * （tmux が default-shell 経由で起動する＝argv 直渡しでシェル経由のインジェクションは起きない。
 * cmd は config 固定値でユーザ入力を含まない）。
 */
async function createTmuxSession(): Promise<void> {
  const r = await run(
    'tmux',
    ['new-session', '-d', '-s', TERMINAL_TMUX_TARGET, TERMINAL_TMUX_START_CMD],
    tmuxEnv(),
  );
  if (r.code !== 0) {
    throw new Error(`tmux new-session failed (code ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  }
}

/** ttyd の systemd ユニットを start する（dev は NOPASSWD で systemctl を叩ける）。 */
async function startTtydService(): Promise<void> {
  const r = await run('sudo', ['-n', 'systemctl', 'start', TERMINAL_TTYD_SERVICE]);
  if (r.code !== 0) {
    throw new Error(
      `systemctl start ${TERMINAL_TTYD_SERVICE} failed (code ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`,
    );
  }
}

interface StartResult {
  ok: boolean;
  actions: string[]; // 実際に行った操作（"created-tmux-session" / "started-ttyd" / なし=既稼働）
  status: TerminalStatus;
}

/**
 * 冪等にバックエンドを復旧する。稼働中の要素には触らない。
 * - tmux main が無ければ作成。
 * - ttyd が inactive なら start。
 * 既に両方稼働中なら actions 空（no-op）で ok を返す。
 */
async function performStart(): Promise<StartResult> {
  const actions: string[] = [];

  // tmux: 無いときだけ作る。稼働中の本番 main は絶対に触らない。
  if (!(await tmuxSessionExists())) {
    await createTmuxSession();
    actions.push('created-tmux-session');
  }

  // ttyd: systemd ユニットが active でないときだけ start。
  // 既に active なら触らない（restart しない＝Keita のブラウザ端末を切らない）。
  if (!(await ttydServiceActive())) {
    await startTtydService();
    actions.push('started-ttyd');
  }

  // 起動直後はポートが listen に上がるまで少し待ってから最終状態を取る。
  if (actions.length > 0) {
    await new Promise((r) => setTimeout(r, 600));
  }
  const status = await collectStatus();
  return { ok: status.tmuxSession && status.ttydService, actions, status };
}

// ─── ハンドラ ────────────────────────────────────────────────

async function handleStatus(_req: Request, res: Response): Promise<void> {
  try {
    const status = await collectStatus();
    res.json(status);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[terminal-control] status failed:', message);
    res.status(500).json({ error: message });
  }
}

async function handleStart(_req: Request, res: Response): Promise<void> {
  try {
    const result = await performStart();
    res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[terminal-control] start failed:', message);
    res.status(500).json({ error: message });
  }
}

// ─── ターミナル出力取得（MC-92 コピー改善）────────────────────
//
// GET /api/terminal/output?lines=N
//   tmux capture-pane で main セッションの最近 N 行を取得する。
//   モバイル / WebView では iframe 内のテキスト選択が難しいため、
//   フロントの「出力をコピー」ボタンがこのエンドポイントを叩いて
//   navigator.clipboard.writeText() に渡す。
//   lines のデフォルトは 100、最大 500 に制限する。
//   tmux セッションが無ければ ok:false + error を返す（常に 200）。

async function collectOutput(lines: number): Promise<{ ok: true; content: string; lines: number } | { ok: false; error: string }> {
  const exists = await tmuxSessionExists();
  if (!exists) {
    return { ok: false, error: `tmux セッション '${TERMINAL_TMUX_TARGET}' が見つかりません。` };
  }
  // -p: stdout 出力、-t: ターゲット、-S -N: 末尾から N 行（負の行数で末尾基点）。
  const r = await run('tmux', ['capture-pane', '-p', '-t', TERMINAL_TMUX_TARGET, '-S', String(-lines)], tmuxEnv());
  if (r.code !== 0) {
    return { ok: false, error: `tmux capture-pane に失敗しました（code ${r.code}）: ${r.stderr.trim() || r.stdout.trim()}` };
  }
  return { ok: true, content: r.stdout, lines };
}

async function handleOutput(req: Request, res: Response): Promise<void> {
  const raw = typeof req.query.lines === 'string' ? parseInt(req.query.lines, 10) : NaN;
  const lines = isNaN(raw) || raw <= 0 ? 100 : Math.min(raw, 500);
  try {
    const result = await collectOutput(lines);
    res.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[terminal-control] output failed:', message);
    // 常に 200 で返す（他エンドポイントと同様）。
    res.json({ ok: false, error: message });
  }
}

// ─── Router 組み立て ─────────────────────────────────────────

/** /api/terminal 配下の status / start / output ルータ。index.ts で auth ミドルウェア配下に mount する。 */
export function terminalControlRouter(): Router {
  const router = Router();
  router.get('/status', (req, res) => void handleStatus(req, res));
  router.post('/start', (req, res) => void handleStart(req, res));
  router.get('/output', (req, res) => void handleOutput(req, res));
  return router;
}
