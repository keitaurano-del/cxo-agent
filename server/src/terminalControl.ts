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
//   GET  /api/terminal/model?terminal=<id> — 指定ターミナルの現在モデルを返す。
//   POST /api/terminal/model — ターミナルのモデルを変更する。
//     body: { terminal: number, model: string }
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
import { readFileSync, writeFileSync } from 'node:fs';
import { Router, type Request, type Response } from 'express';

import { join } from 'node:path';

import {
  DATA_HOME,
  TERMINAL_TMUX_TARGET,
  TERMINAL_TMUX_PATH,
  TERMINAL_TMUX_START_CMD,
  TERMINAL_TTYD_HOST,
  TERMINAL_CONTROL_TIMEOUT_MS,
  TERMINALS,
  terminalById,
  type TerminalDef,
  type TerminalRemote,
} from './config.js';

// ─── settings.json パス ─────────────────────────────────────
/** local（この箱）の claude settings.json パス。 */
const LOCAL_SETTINGS_PATH = join(DATA_HOME, '.claude', 'settings.json');
/** 旧箱の claude settings.json パス（SSH で読み書き）。 */
const REMOTE_SETTINGS_PATH = '/home/dev/.claude/settings.json';
/** openclaw.json のパス（ターミナル4 のモデル設定）。 */
const OPENCLAW_JSON_PATH = join(DATA_HOME, '.openclaw', 'openclaw.json');
/** アカウントラベルの永続化ファイル（data/ 配下）。 */
const ACCOUNT_LABELS_PATH = join(DATA_HOME, 'projects', 'cxo-agent', 'data', 'terminal-account-labels.json');
/** エージェント情報の永続化ファイル（data/ 配下）。 */
const AGENT_INFO_PATH = join(DATA_HOME, 'projects', 'cxo-agent', 'data', 'terminal-agent-info.json');
/** 許可するモデル名のセット（これ以外への書き換えは拒否）。 */
const ALLOWED_MODELS = new Set<string>([
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001',
]);
/** 許可するアカウントラベルのセット。 */
const ALLOWED_ACCOUNTS = new Set<string>(['Claude1', 'Claude2']);
/** デフォルトのアカウントラベル（ターミナル id → label）。 */
const DEFAULT_ACCOUNT_LABELS: Record<number, string> = { 1: 'Claude1', 2: 'Claude2', 3: 'Claude1', 4: 'Claude1' };

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

// ─── tmux 操作の local / remote 抽象（MC-123）──────────────────
//
// 各ターミナルは config の tmuxSession（'main'/'apollo2'/'spare'）と remote 有無で
// 操作対象が決まる。local はこの箱の tmux を execFile で直接、remote(2) は ssh 経由で
// 旧箱の tmux を叩く。tmux 自体の argv（has-session/capture-pane/send-keys ...）を
// 共通の組み立てにし、local/remote の差は「どこで実行するか」だけにする。

/**
 * リモート実行のためのシングルクオートエスケープ。
 * ssh は remote 側で引数を連結して `sh -c` 相当に渡すため、tmux のコマンド文字列を
 * 1 つの安全な文字列に組む必要がある。各トークンを '...' で囲み、内部の ' は '\'' に置換する。
 * これでスペース・特殊文字・改行を含む literal でもシェル解釈されず安全に渡る。
 */
function shquote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * tmux の argv（先頭の 'tmux' を除いた配列）を、対象ターミナルに応じて実行する。
 * - local: execFile('tmux', args)（argv 直渡し・シェル経由なし）。
 * - remote: execFile('ssh', [-i key, BatchMode, ConnectTimeout, user@host, '<tmux cmd 文字列>']）。
 *   remote コマンド文字列は `tmux` + 各 arg を shquote して連結（remote シェルでの再解釈を防ぐ）。
 */
function runTmux(t: TerminalDef, args: string[]): Promise<ExecResult> {
  if (!t.remote) {
    return run('tmux', args, tmuxEnv());
  }
  const r: TerminalRemote = t.remote;
  // remote 側で実行されるコマンド文字列。tmux と各引数を個別にクオートして連結する。
  const remoteCmd = ['tmux', ...args.map(shquote)].join(' ');
  return run(
    'ssh',
    [
      '-i',
      r.sshKey,
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      `${r.sshUser}@${r.sshHost}`,
      remoteCmd,
    ],
    tmuxEnv(),
  );
}

// ─── 状態取得 ────────────────────────────────────────────────

/** 指定ターミナルの tmux セッションが存在するか（has-session の exit code で判定）。 */
async function tmuxSessionExistsFor(t: TerminalDef): Promise<boolean> {
  const r = await runTmux(t, ['has-session', '-t', t.tmuxSession]);
  return r.code === 0;
}

/** ターミナル1（この箱の tmux main）が存在するか。後方互換用。 */
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
    // ready: ターミナル1 は tmux main 必須。2/3 は ttyd（service+port）だけで判定。
    ready: tmuxSession && ttydService && ttydReachable,
    target: isPrimary ? TERMINAL_TMUX_TARGET : t.tmuxSession,
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

/** 全ターミナルの定義 + 状態 + モデル + アカウントラベルを一括返却（タブ UI の初期描画用）。 */
async function handleStatusAll(_req: Request, res: Response): Promise<void> {
  try {
    const accountLabels = readAccountLabels();
    const agentInfo = readAgentInfo();
    const terminals = await Promise.all(
      TERMINALS.map(async (t) => ({
        id: t.id,
        label: t.label,
        account: accountLabels[t.id] ?? DEFAULT_ACCOUNT_LABELS[t.id] ?? 'Claude1',
        model: await getModelForTerminal(t),
        status: await collectStatusFor(t),
        agentName: agentInfo[t.id]?.name ?? null,
        agentEmoji: agentInfo[t.id]?.emoji ?? null,
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

// ─── ターミナル出力取得（MC-92 コピー改善 / MC-123 端末別）──────
//
// GET /api/terminal/output?lines=N&terminal=<id>
//   tmux capture-pane で対象ターミナルのセッション（main/apollo2/spare）の最近 N 行を取得する。
//   remote(2) は ssh 越しに旧箱の apollo2 を capture する。未指定 terminal は 1。
//   モバイル / WebView では iframe 内のテキスト選択が難しいため、
//   フロントの「出力をコピー」ボタンがこのエンドポイントを叩いて
//   navigator.clipboard.writeText() に渡す。
//   lines のデフォルトは 1000、最大 5000 に制限する。
//   tmux セッションが無ければ ok:false + error を返す（常に 200）。

async function collectOutput(t: TerminalDef, lines: number): Promise<{ ok: true; content: string; lines: number } | { ok: false; error: string }> {
  const exists = await tmuxSessionExistsFor(t);
  if (!exists) {
    // spare 等が未起動でもエラーにせず ok:false（空相当）で返す。UI 側で穏当に表示する。
    return { ok: false, error: `tmux セッション '${t.tmuxSession}' が見つかりません。` };
  }
  // -p: stdout 出力、-t: ターゲット、-S -N: 末尾から N 行（負の行数で末尾基点）。
  const r = await runTmux(t, ['capture-pane', '-p', '-t', t.tmuxSession, '-S', String(-lines)]);
  if (r.code !== 0) {
    return { ok: false, error: `tmux capture-pane に失敗しました（code ${r.code}）: ${r.stderr.trim() || r.stdout.trim()}` };
  }
  return { ok: true, content: r.stdout, lines };
}

async function handleOutput(req: Request, res: Response): Promise<void> {
  const raw = typeof req.query.lines === 'string' ? parseInt(req.query.lines, 10) : NaN;
  const lines = isNaN(raw) || raw <= 0 ? 1000 : Math.min(raw, 5000);
  const t = resolveTerminal(req.query.terminal);
  try {
    const result = await collectOutput(t, lines);
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
  const body = (req.body ?? {}) as { keys?: unknown; terminal?: unknown };
  const keys = body.keys;
  const t = resolveTerminal(body.terminal ?? req.query.terminal);
  const target = t.tmuxSession;

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
      await runTmux(t, ['copy-mode', '-t', target]);
      for (let i = 0; i < 3; i++) {
        await runTmux(t, ['send-keys', '-t', target, '-X', direction]);
      }
      await runTmux(t, ['send-keys', '-t', target, '-X', 'cancel']);
      res.json({ ok: true });
      return;
    }

    // exit-copy-mode: スクロール終了後に copy-mode を抜いて通常入力に戻す。
    // copy-mode でない場合は cancel が失敗するが、常に ok を返す（入力を塞がない）。
    if (keys === 'exit-copy-mode') {
      await runTmux(t, ['send-keys', '-t', target, '-X', 'cancel']);
      res.json({ ok: true });
      return;
    }

    // 特殊キーは tmux のキー名として渡す（"-l" リテラル修飾子なし）。
    // 任意テキストは "-l" フラグ付きでリテラル送信し、tmux がキー名として解釈しないようにする。
    const args = TMUX_SPECIAL_KEYS.has(keys)
      ? ['send-keys', '-t', target, keys]
      : ['send-keys', '-t', target, '-l', keys];

    const r = await runTmux(t, args);
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

// ─── モデル取得・変更（タブ内モデル表示 / 切り替え）──────────────
//
// GET /api/terminal/model?terminal=<id>
//   指定ターミナルの Claude モデル名を返す。
//   ターミナル1/3（local）: /home/dev/.claude/settings.json の model フィールドを読む。
//   ターミナル2（remote）: SSH 経由で旧箱の settings.json を読む。
//   ターミナル4（openclaw）: 固定値 claude-sonnet-4-6 を返す。
//   読み取り失敗時は { model: null } を返す（エラーにしない）。
//
// POST /api/terminal/model
//   body: { terminal: number, model: string }
//   settings.json の model フィールドを書き換える。
//   ターミナル4（openclaw）は変更不可（エラー返却）。
//   JSON パースエラー時は書き込まない（整合性保護）。

// ─── openclaw.json 読み書き（ターミナル4）────────────────────
//
// openclaw.json の agents.defaults.model.primary フィールドを読み書きする。
// ファイルが存在しない場合は null を返す（エラーにしない）。
// JSON パースエラーは書き込みをせず throw する（呼び出し元が 500 を返す）。

/**
 * openclaw.json の agents.defaults.model.primary を読んで返す。
 * "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"（"anthropic/" prefix を除去）。
 * ファイルが無い場合は null（読み取り失敗もすべて null）。
 */
function readOpenclawModel(): string | null {
  try {
    const raw = readFileSync(OPENCLAW_JSON_PATH, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const primary = (obj as { agents?: { defaults?: { model?: { primary?: unknown } } } })
      ?.agents?.defaults?.model?.primary;
    if (typeof primary !== 'string' || primary.trim() === '') return null;
    // "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
    const parts = primary.split('/');
    return parts.length >= 2 ? parts.slice(1).join('/') : primary;
  } catch {
    return null;
  }
}

/**
 * openclaw.json の agents.defaults.model.primary を書き換える。
 * フロントからは "claude-sonnet-4-6" 形式、JSON には "anthropic/claude-sonnet-4-6" で保存。
 * JSON パースエラー時は書き込まずに throw する（呼び出し元が 500 を返す）。
 */
function writeOpenclawModel(model: string): void {
  const raw = readFileSync(OPENCLAW_JSON_PATH, 'utf-8');
  // parse エラーは throw させる（整合性保護）
  const obj = JSON.parse(raw) as Record<string, unknown>;
  // ネストを安全に掘り下げてセットする
  type AgentDefaults = { model?: { primary?: string } };
  type AgentsSection = { defaults?: AgentDefaults };
  const agents = (obj.agents ?? {}) as AgentsSection;
  const defaults = (agents.defaults ?? {}) as AgentDefaults;
  const modelSection = (defaults.model ?? {}) as { primary?: string };
  modelSection.primary = `anthropic/${model}`;
  defaults.model = modelSection;
  agents.defaults = defaults;
  obj.agents = agents;
  writeFileSync(OPENCLAW_JSON_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

/** local の settings.json から model を読む。読み取り失敗は null。 */
function readLocalModel(): string | null {
  try {
    const raw = readFileSync(LOCAL_SETTINGS_PATH, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const model = obj.model;
    return typeof model === 'string' && model.trim() !== '' ? model : null;
  } catch {
    return null;
  }
}

/** local の settings.json の model フィールドを書き換える。パースエラーは書き込まない。 */
function writeLocalModel(model: string): void {
  const raw = readFileSync(LOCAL_SETTINGS_PATH, 'utf-8');
  const obj = JSON.parse(raw) as Record<string, unknown>;
  obj.model = model;
  writeFileSync(LOCAL_SETTINGS_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

/**
 * SSH で旧箱の settings.json の model フィールドを読む。
 * BatchMode=yes, ConnectTimeout=2 で失敗しても null を返す。
 */
async function readRemoteModel(remote: TerminalRemote): Promise<string | null> {
  try {
    const r = await run(
      'ssh',
      [
        '-i', remote.sshKey,
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=5',
        `${remote.sshUser}@${remote.sshHost}`,
        `cat ${REMOTE_SETTINGS_PATH}`,
      ],
      tmuxEnv(),
    );
    if (r.code !== 0 || !r.stdout.trim()) return null;
    const obj = JSON.parse(r.stdout) as Record<string, unknown>;
    const model = obj.model;
    return typeof model === 'string' && model.trim() !== '' ? model : null;
  } catch {
    return null;
  }
}

/**
 * SSH で旧箱の settings.json の model フィールドを書き換える。
 * python3 で JSON を安全に更新（パースエラー時は書き込まない）。
 */
async function writeRemoteModel(remote: TerminalRemote, model: string): Promise<void> {
  // python3 でファイル読み込み→model 書き換え→書き出し（シェルで直接 sed しない）。
  const safeModel = model.replace(/'/g, `'\\''`);
  const pyScript = [
    `import json,sys`,
    `f=open('${REMOTE_SETTINGS_PATH}','r')`,
    `obj=json.load(f)`,
    `f.close()`,
    `obj['model']='${safeModel}'`,
    `f=open('${REMOTE_SETTINGS_PATH}','w')`,
    `json.dump(obj,f,indent=2)`,
    `f.write('\\n')`,
    `f.close()`,
  ].join(';');
  const r = await run(
    'ssh',
    [
      '-i', remote.sshKey,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=2',
      `${remote.sshUser}@${remote.sshHost}`,
      `python3 -c "${pyScript}"`,
    ],
    tmuxEnv(),
  );
  if (r.code !== 0) {
    throw new Error(`remote model write failed (code ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  }
}

// ─── アカウントラベル読み書き ─────────────────────────────────

/** 全ターミナルのアカウントラベルを返す（ファイルなければデフォルト値）。 */
function readAccountLabels(): Record<number, string> {
  try {
    const raw = readFileSync(ACCOUNT_LABELS_PATH, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const result = { ...DEFAULT_ACCOUNT_LABELS };
    for (const t of TERMINALS) {
      const v = obj[String(t.id)];
      if (typeof v === 'string' && ALLOWED_ACCOUNTS.has(v)) result[t.id] = v;
    }
    return result;
  } catch {
    return { ...DEFAULT_ACCOUNT_LABELS };
  }
}

/** エージェント情報（name/emoji）を読む。ファイルなければ空オブジェクト。 */
function readAgentInfo(): Record<number, { name: string; emoji: string }> {
  try {
    const raw = readFileSync(AGENT_INFO_PATH, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<number, { name: string; emoji: string }> = {};
    for (const [k, v] of Object.entries(obj)) {
      const id = parseInt(k, 10);
      if (!isNaN(id) && v && typeof v === 'object') {
        const info = v as Record<string, unknown>;
        if (typeof info.name === 'string' && typeof info.emoji === 'string') {
          result[id] = { name: info.name, emoji: info.emoji };
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** 指定ターミナルのアカウントラベルを保存する。 */
function writeAccountLabel(terminalId: number, account: string): void {
  const labels = readAccountLabels();
  labels[terminalId] = account;
  const obj: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) obj[k] = v;
  writeFileSync(ACCOUNT_LABELS_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

/** 指定ターミナルのモデル名を取得する（失敗時は null）。 */
async function getModelForTerminal(t: TerminalDef): Promise<string | null> {
  if (t.id === 4) return readOpenclawModel();
  if (t.remote) return readRemoteModel(t.remote);
  return readLocalModel();
}

async function handleGetModel(req: Request, res: Response): Promise<void> {
  try {
    const t = resolveTerminal(req.query.terminal);
    const model = await getModelForTerminal(t);
    res.json({ model });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[terminal-control] get-model failed:', message);
    res.json({ model: null });
  }
}

async function handleSetModel(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { terminal?: unknown; model?: unknown };
    const t = resolveTerminal(body.terminal);
    const model = body.model;

    if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
      res.status(400).json({ ok: false, error: `モデル名が不正です。許可モデル: ${[...ALLOWED_MODELS].join(', ')}` });
      return;
    }

    if (t.id === 4) {
      // ターミナル4（openclaw/Masayoshi）: openclaw.json を更新する
      writeOpenclawModel(model);
    } else if (t.remote) {
      await writeRemoteModel(t.remote, model);
    } else {
      writeLocalModel(model);
    }
    res.json({ ok: true, model });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[terminal-control] set-model failed:', message);
    res.status(500).json({ ok: false, error: message });
  }
}

// ─── アカウント認証ディレクトリマッピング ─────────────────────
// CLAUDE_CONFIG_DIR 環境変数でアカウントを切り替える。
//
// ローカル箱 (terminal 1/3/4):
//   Claude1: keita.urano  (Max 20x) → ~/.claude
//   Claude2: keita.urano2 (Max 5x)  → ~/.claude-urano2
//
// 旧箱 (terminal 2, remote SSH):
//   Claude1: keita.urano  (Max 20x) → ~/.claude-urano1  (新箱からコピー済み)
//   Claude2: keita.urano2 (Max 5x)  → ~/.claude         (旧箱のデフォルト)
const ACCOUNT_CONFIG_DIR_LOCAL: Record<string, string> = {
  Claude1: join(DATA_HOME, '.claude'),
  Claude2: join(DATA_HOME, '.claude-urano2'),
};
const ACCOUNT_CONFIG_DIR_REMOTE: Record<string, string> = {
  Claude1: '/home/dev/.claude-urano1',
  Claude2: '/home/dev/.claude',
};

// ─── アカウントラベルハンドラ ─────────────────────────────────

function handleGetAccountLabels(_req: Request, res: Response): void {
  res.json(readAccountLabels());
}

async function handleSetAccountLabel(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { terminal?: unknown; account?: unknown };
    const t = resolveTerminal(body.terminal);
    const account = body.account;
    if (typeof account !== 'string' || !ALLOWED_ACCOUNTS.has(account)) {
      res.status(400).json({ ok: false, error: `account は Claude1 または Claude2 のみ有効です。` });
      return;
    }

    // 1. ラベル保存
    writeAccountLabel(t.id, account);

    // 2. 対象 tmux ペインに CLAUDE_CONFIG_DIR を注入して即座に有効化
    //    ターミナル4（OpenClaw/Masayoshi）は独自 auth のため CLAUDE_CONFIG_DIR 切替不可。
    //    ラベル保存のみ行い、env 注入はスキップ。
    const dirMap = t.remote ? ACCOUNT_CONFIG_DIR_REMOTE : ACCOUNT_CONFIG_DIR_LOCAL;
    // T2/T4 は OpenClaw 独自 auth のため CLAUDE_CONFIG_DIR 切替不可
    const configDir = (t.id !== 2 && t.id !== 4) ? dirMap[account] : null;
    if (configDir) {
      const target = t.tmuxSession;
      // C-c で現在のプロセスを停止
      await runTmux(t, ['send-keys', '-t', target, 'C-c']).catch(() => null);
      // CLAUDE_CONFIG_DIR を export（リテラル送信）
      await runTmux(t, ['send-keys', '-t', target, '-l', `export CLAUDE_CONFIG_DIR=${configDir}`]).catch(() => null);
      await runTmux(t, ['send-keys', '-t', target, 'Enter']).catch(() => null);
    }

    res.json({ ok: true, terminal: t.id, account });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: message });
  }
}

// ─── Router 組み立て ─────────────────────────────────────────

/** /api/terminal 配下の status / start / output / send-keys / model / account ルータ。index.ts で auth ミドルウェア配下に mount する。 */
export function terminalControlRouter(): Router {
  const router = Router();
  router.get('/status', (req, res) => void handleStatus(req, res));
  router.get('/status-all', (req, res) => void handleStatusAll(req, res));
  router.post('/start', (req, res) => void handleStart(req, res));
  router.get('/output', (req, res) => void handleOutput(req, res));
  router.post('/send-keys', (req, res) => void handleSendKeys(req, res));
  router.get('/model', (req, res) => void handleGetModel(req, res));
  router.post('/model', (req, res) => void handleSetModel(req, res));
  router.get('/account', (req, res) => void handleGetAccountLabels(req, res));
  router.post('/account', (req, res) => void handleSetAccountLabel(req, res));
  return router;
}
