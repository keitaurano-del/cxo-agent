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
  TERMINAL_TTYD_HOST,
  TERMINAL_CONTROL_TIMEOUT_MS,
  TERMINALS,
  terminalById,
  type TerminalDef,
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

/** 指定した systemd ユニットが active か。 */
async function serviceActive(service: string): Promise<boolean> {
  const r = await run('systemctl', ['is-active', service]);
  // is-active は active なら exit 0 / stdout "active"。inactive/failed は非 0。
  return r.code === 0 && r.stdout.trim() === 'active';
}

/** 指定ポートへ TCP 接続できるか（プロセスが実際に listen しているか）。 */
function portReachable(port: number, host: string = TERMINAL_TTYD_HOST): Promise<boolean> {
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
        socket.connect(port, host);
      })
      .catch(() => resolve(false));
  });
}


interface TerminalStatus {
  id: number; // ターミナル番号
  tmuxSession: boolean; // tmux main が存在するか（ターミナル1のみ意味を持つ）
  ttydService: boolean; // ttyd の systemd ユニットが active か
  ttydReachable: boolean; // ttyd ポートへ実際に接続できるか
  ready: boolean; // ブラウザ端末がそのまま使えるか
  target: string;
  service: string;
}

/**
 * 指定ターミナルの状態を集める。
 * - ターミナル1（この箱の tmux main = 林）は tmux main の存在も ready 条件に含める
 *   （ttyd は tmux main にアタッチする構成で、main が無いと端末が空になるため）。
 * - ターミナル2/3 は ttyd 自体が ssh / spare claude を起動する構成で、別の tmux main に
 *   依存しない。ready = service active かつ port 到達可能。
 */
async function collectStatusFor(t: TerminalDef): Promise<TerminalStatus> {
  const isPrimary = t.id === 1;
  const [tmuxSession, ttydService, ttydReachable] = await Promise.all([
    isPrimary ? tmuxSessionExists() : Promise.resolve(true),
    serviceActive(t.service),
    portReachable(t.port),
  ]);
  return {
    id: t.id,
    tmuxSession,
    ttydService,
    ttydReachable,
    ready: tmuxSession && ttydService && ttydReachable,
    target: isPrimary ? TERMINAL_TMUX_TARGET : t.service,
    service: t.service,
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

/** 指定 ttyd の systemd ユニットを start する（dev は NOPASSWD で systemctl を叩ける）。 */
async function startService(service: string): Promise<void> {
  const r = await run('sudo', ['-n', 'systemctl', 'start', service]);
  if (r.code !== 0) {
    throw new Error(
      `systemctl start ${service} failed (code ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`,
    );
  }
}

interface StartResult {
  ok: boolean;
  actions: string[]; // 実際に行った操作（"created-tmux-session" / "started-ttyd" / なし=既稼働）
  status: TerminalStatus;
}

/**
 * 指定ターミナルのバックエンドを冪等に復旧する。稼働中の要素には触らない。
 * - ターミナル1: tmux main が無ければ作成（林 CLI 起動）。
 * - 全ターミナル: ttyd（systemd ユニット）が inactive なら start。
 * 既に稼働中なら actions 空（no-op）で ok を返す。
 *
 * 「ターミナルを開始」を押したタブに対応する service を restart 相当（無ければ start）する。
 * active なものは触らない＝既に使えている端末を切らない。
 */
async function performStartFor(t: TerminalDef): Promise<StartResult> {
  const actions: string[] = [];

  // tmux main はターミナル1（この箱の林）のみ。無いときだけ作る。稼働中の本番 main は絶対に触らない。
  if (t.id === 1 && !(await tmuxSessionExists())) {
    await createTmuxSession();
    actions.push('created-tmux-session');
  }

  // ttyd: systemd ユニットが active でないときだけ start。
  // 既に active なら触らない（restart しない＝既存のブラウザ端末を切らない）。
  if (!(await serviceActive(t.service))) {
    await startService(t.service);
    actions.push(`started-${t.service}`);
  }

  // 起動直後はポートが listen に上がるまで少し待ってから最終状態を取る。
  if (actions.length > 0) {
    await new Promise((r) => setTimeout(r, 600));
  }
  const status = await collectStatusFor(t);
  return { ok: status.ttydService && (t.id !== 1 || status.tmuxSession), actions, status };
}

// ─── ハンドラ ────────────────────────────────────────────────

/**
 * リクエストからターミナル id を解決する（query / body の terminal、未指定なら 1）。
 * 不正値・未定義 id はターミナル1にフォールバックする（後方互換）。
 */
function resolveTerminal(raw: unknown): TerminalDef {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  const t = !isNaN(n) ? terminalById(n) : undefined;
  return t ?? terminalById(1) ?? TERMINALS[0];
}

async function handleStatus(req: Request, res: Response): Promise<void> {
  try {
    const t = resolveTerminal(req.query.terminal);
    const status = await collectStatusFor(t);
    res.json(status);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[terminal-control] status failed:', message);
    res.status(500).json({ error: message });
  }
}

/** 全ターミナルの定義 + 状態を一括返却（タブ UI の初期描画用）。 */
async function handleStatusAll(_req: Request, res: Response): Promise<void> {
  try {
    const terminals = await Promise.all(
      TERMINALS.map(async (t) => ({
        id: t.id,
        label: t.label,
        status: await collectStatusFor(t),
      })),
    );
    res.json({ terminals });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[terminal-control] status-all failed:', message);
    res.status(500).json({ error: message });
  }
}

async function handleStart(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { terminal?: unknown };
    const t = resolveTerminal(body.terminal ?? req.query.terminal);
    const result = await performStartFor(t);
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

// ─── send-keys（MC-スマホターミナル）────────────────────────
//
// POST /api/terminal/send-keys
// body: { keys: 'Up' | 'Down' | 'Left' | 'Right' | 'Enter' | 'Escape' | 'Tab' | 'Space' | <任意テキスト> }
//
// スマホの仮想キーバーからターミナルへキー/テキストを送る。
// tmux send-keys はすべて execFile（argv 直渡し）でシェルインジェクション不可。
// 特殊キーは tmux のキー名としてそのまま渡し、任意テキストは '' でラップして 1 引数にする。
// 400 文字以上は拒否する（悪意ある長文コマンド注入対策）。

const TMUX_SPECIAL_KEYS = new Set([
  'Up', 'Down', 'Left', 'Right',
  'Enter', 'Escape', 'Tab', 'Space',
  'BSpace', 'DC', // Backspace / Delete
]);

async function handleSendKeys(req: Request, res: Response): Promise<void> {
  const { keys } = req.body as { keys?: unknown };

  // バリデーション
  if (typeof keys !== 'string' || keys.length === 0 || keys.length > 400) {
    res.status(400).json({ ok: false, error: 'keys must be a non-empty string (max 400 chars)' });
    return;
  }

  try {
    // scroll-up / scroll-down: tmux copy-mode でスクロール（履歴表示用）
    if (keys === 'scroll-up' || keys === 'scroll-down') {
      const direction = keys === 'scroll-up' ? 'scroll-up' : 'scroll-down';
      // copy-mode に入ってスクロール、3行分スクロールしてから copy-mode を抜ける
      // （抜けないと通常入力が詰まるため必ず cancel で戻す）
      await run('tmux', ['copy-mode', '-t', TERMINAL_TMUX_TARGET], tmuxEnv());
      for (let i = 0; i < 3; i++) {
        await run('tmux', ['send-keys', '-t', TERMINAL_TMUX_TARGET, '-X', direction], tmuxEnv());
      }
      await run('tmux', ['send-keys', '-t', TERMINAL_TMUX_TARGET, '-X', 'cancel'], tmuxEnv());
      res.json({ ok: true });
      return;
    }

    // exit-copy-mode: スクロール終了後に copy-mode を抜いて通常入力に戻す。
    // copy-mode でない場合は cancel が失敗するが、常に ok を返す（入力を塞がない）。
    if (keys === 'exit-copy-mode') {
      await run('tmux', ['send-keys', '-t', TERMINAL_TMUX_TARGET, '-X', 'cancel'], tmuxEnv());
      res.json({ ok: true });
      return;
    }

    // 特殊キーは tmux のキー名として渡す（"-l" リテラル修飾子なし）。
    // 任意テキストは "-l" フラグ付きでリテラル送信し、tmux がキー名として解釈しないようにする。
    const args = TMUX_SPECIAL_KEYS.has(keys)
      ? ['send-keys', '-t', TERMINAL_TMUX_TARGET, keys]
      : ['send-keys', '-t', TERMINAL_TMUX_TARGET, '-l', keys];

    const r = await run('tmux', args, tmuxEnv());
    if (r.code !== 0) {
      const msg = `tmux send-keys failed (code ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`;
      console.error('[terminal-control] send-keys:', msg);
      res.status(500).json({ ok: false, error: msg });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[terminal-control] send-keys exception:', message);
    res.status(500).json({ ok: false, error: message });
  }
}

// ─── Router 組み立て ─────────────────────────────────────────

/** /api/terminal 配下の status / start / output / send-keys ルータ。index.ts で auth ミドルウェア配下に mount する。 */
export function terminalControlRouter(): Router {
  const router = Router();
  router.get('/status', (req, res) => void handleStatus(req, res));
  router.get('/status-all', (req, res) => void handleStatusAll(req, res));
  router.post('/start', (req, res) => void handleStart(req, res));
  router.get('/output', (req, res) => void handleOutput(req, res));
  router.post('/send-keys', (req, res) => void handleSendKeys(req, res));
  return router;
}
