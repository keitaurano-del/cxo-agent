// notebookClaude — ノートブックの分析エンジン（MC-126）。
//
// `claude -p "<prompt>"` を cwd=ノートブックの dir で起動する。これにより claude が
// ./sources/ と ./extracted/ の資料を相対 Read で読んで、根拠付きの回答・生成物作成を行う。
// dev ユーザの claude は keita.urano で OAuth 認証済み・settings.json で bypassPermissions。
//
// 同時実行は共有 Anthropic アカウントを食い潰さないよう簡易セマフォで 1〜2 に制限する。
// 上限を超えたリクエストは空きが出るまで待つ。タイムアウト・巨大 stdout 上限も設ける。

import { execFile, spawn } from 'node:child_process';
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

/** claude に渡す共通 CLI 引数（モデル指定込み）。model を明示指定（フォールバック対応）。 */
function claudeArgs(prompt: string, notebookDir: string, model: string): string[] {
  // cwd=notebookDir で起動 + --add-dir でノートブックディレクトリを明示追加。
  // デフォルトでは cwd のみ許可されるが、--add-dir で確実に閉じ込める。
  return ['--model', model, '--add-dir', notebookDir, '-p', prompt];
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

/** execFile ベースの 1 回ぶんの実行（指定モデル）。失敗は throw せず result で返す。 */
function runClaudeOnce(
  notebookDir: string,
  prompt: string,
  model: string,
): Promise<ClaudeRunResult> {
  return new Promise<ClaudeRunResult>((res) => {
    void acquire().then(() => {
      const child = execFile(
        NOTEBOOK_CLAUDE_BIN,
        claudeArgs(prompt, notebookDir, model),
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
export async function runClaude(notebookDir: string, prompt: string): Promise<ClaudeRunResult> {
  const primary = await runClaudeOnce(notebookDir, prompt, NOTEBOOK_CLAUDE_MODEL);
  if (primary.ok || !isLimitFailure(primary)) return primary;
  console.warn(
    `[notebook-claude] sonnet limit hit → fallback to opus (${NOTEBOOK_CLAUDE_FALLBACK_MODEL})`,
  );
  return runClaudeOnce(notebookDir, prompt, NOTEBOOK_CLAUDE_FALLBACK_MODEL);
}

/**
 * claude -p をストリーミングで起動し、stdout チャンクを onChunk に逐次渡す。
 * 完了後に ClaudeRunResult を返す（runClaude と同じ失敗方針）。
 */
export async function runClaudeStream(
  notebookDir: string,
  prompt: string,
  onChunk: (text: string) => void,
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
  );
  if (primary.ok || !isLimitFailure(primary)) return primary;
  if (emittedBody) {
    // 既に実本文をストリーム済み（途中で上限に当たった等）。二重送信を避けるため retry しない。
    return primary;
  }
  console.warn(
    `[notebook-claude] sonnet limit hit → fallback to opus (${NOTEBOOK_CLAUDE_FALLBACK_MODEL})`,
  );
  return runClaudeStreamOnce(notebookDir, prompt, NOTEBOOK_CLAUDE_FALLBACK_MODEL, onChunk);
}

/** spawn ベースの 1 回ぶんのストリーム実行（指定モデル）。失敗は throw せず result で返す。 */
function runClaudeStreamOnce(
  notebookDir: string,
  prompt: string,
  model: string,
  onChunk: (text: string) => void,
): Promise<ClaudeRunResult> {
  return new Promise<ClaudeRunResult>((res) => {
    void acquire().then(() => {
      const child = spawn(NOTEBOOK_CLAUDE_BIN, claudeArgs(prompt, notebookDir, model), {
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
