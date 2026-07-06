// notebookClaude — ノートブックの分析エンジン（MC-126）。
//
// `claude -p "<prompt>"` を cwd=ノートブックの dir で起動する。これにより claude が
// ./sources/ と ./extracted/ の資料を相対 Read で読んで、根拠付きの回答・生成物作成を行う。
// dev ユーザの claude は keita.urano で OAuth 認証済み・settings.json で bypassPermissions。
//
// 同時実行は共有 Anthropic アカウントを食い潰さないよう簡易セマフォで 1〜2 に制限する。
// 上限を超えたリクエストは空きが出るまで待つ。タイムアウト・巨大 stdout 上限も設ける。

import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  NOTEBOOK_CLAUDE_BIN,
  NOTEBOOK_CLAUDE_TIMEOUT_MS,
  NOTEBOOK_CLAUDE_CONCURRENCY,
  NOTEBOOK_CLAUDE_MODEL,
  NOTEBOOK_CLAUDE_FALLBACK_MODEL,
} from '../config.js';

// ─── 簡易セマフォ（同時実行制限）─────────────────────────────

let inflight = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inflight < Math.max(1, NOTEBOOK_CLAUDE_CONCURRENCY)) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((res) => {
    waiters.push(() => {
      inflight += 1;
      res();
    });
  });
}

function release(): void {
  inflight -= 1;
  const next = waiters.shift();
  if (next) next();
}

/** 現在の同時実行状況（デバッグ・モニタ用）。 */
export function claudeInflightStatus(): { inflight: number; queued: number; limit: number } {
  return { inflight, queued: waiters.length, limit: Math.max(1, NOTEBOOK_CLAUDE_CONCURRENCY) };
}

/**
 * claude CLI 起動を共有セマフォのスロット内で実行する（MC: 開発ページ生成器と同時実行枠を共有）。
 * 共有 Anthropic アカウントを食い潰して利用上限エラーを誘発しないよう、ノートブック Q&A と
 * 開発ページのモックアップ生成を同じ枠（NOTEBOOK_CLAUDE_CONCURRENCY）で直列化する。
 * fn の解決/拒否に関わらず必ずスロットを返す。
 */
export async function withClaudeSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

// ─── claude -p 起動 ───────────────────────────────────────

const MAX_STDOUT_BYTES = 8 * 1024 * 1024; // 8MB 上限（巨大出力の暴走対策）。

export interface ClaudeRunResult {
  ok: boolean;
  /** claude の stdout（成功時の回答 / 報告）。失敗時も部分出力があれば入る。 */
  stdout: string;
  /** 失敗・タイムアウト時のエラーメッセージ。成功なら undefined。 */
  error?: string;
}

/**
 * claude に渡す共通 CLI 引数（モデル指定込み）。model を明示指定（フォールバック対応）。
 * allowedTools を渡すと `--allowedTools` で追加の組み込みツール（WebSearch/WebFetch 等）を許可する。
 * 既存の呼び出し（notebook 等）は allowedTools 無しで呼ぶため、従来の挙動は一切変わらない。
 */
function claudeArgs(
  prompt: string,
  notebookDir: string,
  model: string,
  allowedTools?: string[],
): string[] {
  // cwd=notebookDir で起動 + --add-dir でノートブックディレクトリを明示追加。
  // デフォルトでは cwd のみ許可されるが、--add-dir で確実に閉じ込める。
  const args = ['--model', model, '--add-dir', notebookDir];
  if (allowedTools && allowedTools.length > 0) {
    // カンマ区切りで許可ツールを足す（例: "WebSearch,WebFetch"）。
    // これは当チャット専用の opt-in。既定では渡らないので他の呼び出しに影響しない。
    args.push('--allowedTools', allowedTools.join(','));
  }
  args.push('-p', prompt);
  return args;
}

/**
 * 失敗が「利用上限（Sonnet limit / usage limit / rate limit 等）」によるものかを判定する（MC-202①）。
 * claude CLI は上限到達時に "You've hit your Sonnet limit · resets ..." のようなメッセージを
 * stdout/stderr/エラー文に出す。これを検出したら fallback（Opus）で再実行する。大文字小文字無視。
 */
function isLimitFailure(result: ClaudeRunResult): boolean {
  const haystack = `${result.stdout || ''}\n${result.error || ''}`.toLowerCase();
  if (haystack.includes('hit your') && haystack.includes('limit')) return true;
  return (
    haystack.includes('usage limit') ||
    haystack.includes('rate limit') ||
    haystack.includes('rate_limit') ||
    haystack.includes('rate-limited') ||
    haystack.includes('reached your') ||
    haystack.includes('exceeded') && haystack.includes('limit')
  );
}

/**
 * これまでに送出した累積テキストが「上限メッセージだけ」かどうかを判定する（MC-202①）。
 * ストリーム時、上限に当たると CLI は短い上限メッセージのみを stdout に出すことがある。
 * 上限メッセージに該当する行を取り除いた残り（＝実本文候補）が空なら「上限メッセージのみ」とみなす。
 * こうすることで「実本文を流した後に上限に当たった」ケースでは残りが実本文として残り、
 * looksLikeLimitOnly=false → 二重送信を避けて fallback 再実行しない、を正しく担保できる。
 */
function looksLikeLimitOnly(text: string): boolean {
  const residual = text
    .split('\n')
    .filter((line) => {
      const l = line.trim();
      if (l.length === 0) return false; // 空行は無視
      // この行単体が上限メッセージと判定されるなら実本文ではないので除外する。
      return !isLimitFailure({ ok: false, stdout: l });
    })
    .join('')
    .trim();
  return residual.length === 0;
}

/** claude 起動オプション（当チャット専用の opt-in 機能。既定では未指定）。 */
export interface ClaudeRunOptions {
  /** 許可する組み込みツール（例: ['WebSearch', 'WebFetch']）。未指定なら従来どおり何も足さない。 */
  allowedTools?: string[];
}

/** execFile ベースの 1 回ぶんの実行（指定モデル）。失敗は throw せず result で返す。 */
function runClaudeOnce(
  notebookDir: string,
  prompt: string,
  model: string,
  opts?: ClaudeRunOptions,
): Promise<ClaudeRunResult> {
  return new Promise<ClaudeRunResult>((res) => {
    void acquire().then(() => {
      const child = execFile(
        NOTEBOOK_CLAUDE_BIN,
        claudeArgs(prompt, notebookDir, model, opts?.allowedTools),
        {
          cwd: notebookDir,
          timeout: NOTEBOOK_CLAUDE_TIMEOUT_MS,
          maxBuffer: MAX_STDOUT_BYTES,
          env: process.env,
        },
        (err, stdout, stderr) => {
          release();
          const out = (stdout || '').toString();
          if (err) {
            const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
            const msg = killed
              ? `claude がタイムアウトしました（${Math.round(NOTEBOOK_CLAUDE_TIMEOUT_MS / 1000)}s）`
              : `claude 実行に失敗しました: ${err.message}${stderr ? ` | ${String(stderr).slice(0, 500)}` : ''}`;
            res({ ok: false, stdout: out, error: msg });
            return;
          }
          res({ ok: true, stdout: out });
        },
      );
      try {
        child.stdin?.end();
      } catch {
        /* noop */
      }
    });
  });
}

/**
 * claude -p を cwd=notebookDir で起動し、stdout を返す。
 * 失敗・タイムアウトは throw せず { ok:false, error } で返す（呼び出し側で部分劣化 200）。
 * 通常は primary（Sonnet）で実行し、利用上限による失敗時のみ fallback（Opus）で 1 回だけ再実行する（MC-202①）。
 */
export async function runClaude(
  notebookDir: string,
  prompt: string,
  opts?: ClaudeRunOptions,
): Promise<ClaudeRunResult> {
  const primary = await runClaudeOnce(notebookDir, prompt, NOTEBOOK_CLAUDE_MODEL, opts);
  if (primary.ok || !isLimitFailure(primary)) return primary;
  console.warn(
    `[notebook-claude] sonnet limit hit → fallback to opus (${NOTEBOOK_CLAUDE_FALLBACK_MODEL})`,
  );
  return runClaudeOnce(notebookDir, prompt, NOTEBOOK_CLAUDE_FALLBACK_MODEL, opts);
}

/**
 * claude -p をストリーミングで起動し、stdout チャンクを onChunk に逐次渡す。
 * 完了後に ClaudeRunResult を返す（runClaude と同じ失敗方針）。
 */
export async function runClaudeStream(
  notebookDir: string,
  prompt: string,
  onChunk: (text: string) => void,
  opts?: ClaudeRunOptions,
): Promise<ClaudeRunResult> {
  // 1 回目（primary=Sonnet）は本文を呼び出し側へ素通しでストリームしようとする。ただし
  // 利用上限で失敗したときは fallback（Opus）で再ストリームしたいので、二重送信を避けるため
  // 「実本文（＝上限メッセージ以外の中身）を 1 文字でも onChunk に送出したか（emittedBody）」を見て
  // retry 可否を決める。上限失敗時は CLI が出すのは上限メッセージだけのはずで、それは
  // isLimitFailure で検出する一方、実本文（emittedBody）は付かないため再実行できる。途中まで
  // 実本文を流した後で上限に当たった稀なケースでは emittedBody=true となり、二重送信を避けて再実行しない。
  let streamedText = '';
  let emittedBody = false;
  const guardedOnChunk = (text: string) => {
    streamedText += text;
    // これまでに送出した累積テキストが「上限メッセージのみ」でないなら実本文ありとみなす。
    if (!emittedBody && streamedText.trim().length > 0 && !looksLikeLimitOnly(streamedText)) {
      emittedBody = true;
    }
    onChunk(text);
  };

  const primary = await runClaudeStreamOnce(
    notebookDir,
    prompt,
    NOTEBOOK_CLAUDE_MODEL,
    guardedOnChunk,
    opts,
  );
  if (primary.ok || !isLimitFailure(primary)) return primary;
  if (emittedBody) {
    // 既に実本文をストリーム済み（途中で上限に当たった等）。二重送信を避けるため retry しない。
    return primary;
  }
  console.warn(
    `[notebook-claude] sonnet limit hit → fallback to opus (${NOTEBOOK_CLAUDE_FALLBACK_MODEL})`,
  );
  return runClaudeStreamOnce(notebookDir, prompt, NOTEBOOK_CLAUDE_FALLBACK_MODEL, onChunk, opts);
}

// ─── 軽量トークンストリーム（単語帳の 1 語解説など、ツール不要の単発生成向け）───────────
//
// 通常の runClaudeStream は `claude -p`（テキスト出力）を使うが、パイプ出力（非 TTY）だと
// claude は本文を逐次吐かず「生成完了後に一括」で出す＝体感で数十秒の無言になる。さらに cwd を
// リポジトリにすると CLAUDE.md 読み込み・Bash/Edit 等の全ツール有効で、モデルが用語解説のつもりが
// リポジトリを grep し始めて余計に遅くなる事故もあった。
//
// この関数は単発の知識回答に特化し、次で「速く・逐次・脱線なし」を担保する:
//   --output-format stream-json --include-partial-messages … 本文をトークン単位で逐次配信
//   --tools ""                                              … 全ツール無効（リポジトリ探索・脱線を封じる）
//   cwd = 中立の一時ディレクトリ                             … CLAUDE.md を読ませない
//   --system-prompt                                         … Claude Code 既定の巨大プロンプトを置換
// thinking_delta は本文ではないので落とし、text_delta のみ onText に渡す。

export interface ClaudeStreamJsonOptions {
  /** 使用モデル（未指定なら NOTEBOOK_CLAUDE_MODEL）。 */
  model?: string;
  /** Claude Code 既定のシステムプロンプトを丸ごと置き換える（--system-prompt）。 */
  systemPrompt?: string;
  /** 作業ディレクトリ（未指定なら中立の一時ディレクトリ＝CLAUDE.md を読ませない）。 */
  cwd?: string;
  /** --tools に渡す値。既定 '' ＝全ツール無効。'default' で全ツール。 */
  tools?: string;
}

/**
 * claude をトークンストリーム（stream-json + partial messages）で起動し、本文の text_delta を
 * onText に逐次渡す。thinking は本文でないので渡さない。完了後に ClaudeRunResult を返す
 * （stdout に本文全体・失敗は throw せず error で返す）。単語帳の 1 語解説など単発生成向け。
 */
export function runClaudeStreamJson(
  prompt: string,
  onText: (text: string) => void,
  opts?: ClaudeStreamJsonOptions,
): Promise<ClaudeRunResult> {
  const model = opts?.model ?? NOTEBOOK_CLAUDE_MODEL;
  const cwd = opts?.cwd ?? tmpdir();
  const tools = opts?.tools ?? '';
  return new Promise<ClaudeRunResult>((res) => {
    void acquire().then(() => {
      const args = [
        '--model',
        model,
        '--tools',
        tools,
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
      ];
      if (opts?.systemPrompt) args.push('--system-prompt', opts.systemPrompt);
      args.push('-p', prompt);

      // MAX_THINKING_TOKENS=0 で拡張思考を無効化する。単語帳の 1 語解説に思考は不要で、
      // 有効だと first token まで 10〜15 秒（Haiku）/ 15〜20 秒（Sonnet）待たされる。切ると ~2 秒で書き始める。
      const child = spawn(NOTEBOOK_CLAUDE_BIN, args, {
        cwd,
        env: { ...process.env, MAX_THINKING_TOKENS: '0' },
      });

      let answer = ''; // 本文（text_delta の連結）
      let stderr = '';
      let lineBuf = ''; // NDJSON 行の途中断片を保持
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, NOTEBOOK_CLAUDE_TIMEOUT_MS);

      try {
        child.stdin?.end();
      } catch {
        /* noop */
      }

      const handleEvent = (obj: unknown): void => {
        if (!obj || typeof obj !== 'object') return;
        const o = obj as Record<string, unknown>;
        if (o.type !== 'stream_event') return;
        const ev = o.event as Record<string, unknown> | undefined;
        if (!ev || ev.type !== 'content_block_delta') return;
        const delta = ev.delta as Record<string, unknown> | undefined;
        if (!delta || delta.type !== 'text_delta') return; // thinking_delta 等は本文でないので無視
        const text = typeof delta.text === 'string' ? delta.text : '';
        if (!text) return;
        if (answer.length + text.length > MAX_STDOUT_BYTES) return;
        answer += text;
        onText(text);
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        lineBuf += chunk.toString();
        let nl = lineBuf.indexOf('\n');
        while (nl >= 0) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (line) {
            try {
              handleEvent(JSON.parse(line));
            } catch {
              /* NDJSON でない/途中断片は無視 */
            }
          }
          nl = lineBuf.indexOf('\n');
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        release();
        if (timedOut) {
          res({
            ok: false,
            stdout: answer,
            error: `claude がタイムアウトしました（${Math.round(NOTEBOOK_CLAUDE_TIMEOUT_MS / 1000)}s）`,
          });
          return;
        }
        // 上限・エラーは本文が空のまま stderr/短文に出ることが多い。ok 判定は「終了コード0かつ本文あり」。
        if (code !== 0 && !answer) {
          const errDetail = stderr ? ` | ${stderr.slice(0, 500)}` : '';
          res({ ok: false, stdout: answer, error: `claude 実行に失敗しました（終了コード ${code}）${errDetail}` });
          return;
        }
        res({ ok: true, stdout: answer, error: stderr ? stderr.slice(0, 500) : undefined });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        release();
        res({ ok: false, stdout: answer, error: `claude 実行に失敗しました: ${err.message}` });
      });
    });
  });
}

/** spawn ベースの 1 回ぶんのストリーム実行（指定モデル）。失敗は throw せず result で返す。 */
function runClaudeStreamOnce(
  notebookDir: string,
  prompt: string,
  model: string,
  onChunk: (text: string) => void,
  opts?: ClaudeRunOptions,
): Promise<ClaudeRunResult> {
  return new Promise<ClaudeRunResult>((res) => {
    void acquire().then(() => {
      const child = spawn(NOTEBOOK_CLAUDE_BIN, claudeArgs(prompt, notebookDir, model, opts?.allowedTools), {
        cwd: notebookDir,
        env: process.env,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, NOTEBOOK_CLAUDE_TIMEOUT_MS);

      try {
        child.stdin?.end();
      } catch {
        /* noop */
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stdout.length + text.length <= MAX_STDOUT_BYTES) {
          stdout += text;
          onChunk(text);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        release();
        if (timedOut) {
          res({
            ok: false,
            stdout,
            error: `claude がタイムアウトしました（${Math.round(NOTEBOOK_CLAUDE_TIMEOUT_MS / 1000)}s）`,
          });
          return;
        }
        if (code !== 0) {
          const errDetail = stderr ? ` | ${stderr.slice(0, 500)}` : '';
          res({ ok: false, stdout, error: `claude 実行に失敗しました（終了コード ${code}）${errDetail}` });
          return;
        }
        res({ ok: true, stdout });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        release();
        res({ ok: false, stdout, error: `claude 実行に失敗しました: ${err.message}` });
      });
    });
  });
}
