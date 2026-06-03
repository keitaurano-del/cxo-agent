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

// ─── claude -p 起動 ───────────────────────────────────────

const MAX_STDOUT_BYTES = 8 * 1024 * 1024; // 8MB 上限（巨大出力の暴走対策）。

export interface ClaudeRunResult {
  ok: boolean;
  /** claude の stdout（成功時の回答 / 報告）。失敗時も部分出力があれば入る。 */
  stdout: string;
  /** 失敗・タイムアウト時のエラーメッセージ。成功なら undefined。 */
  error?: string;
}

/** claude に渡す共通 CLI 引数（モデル指定込み）。 */
function claudeArgs(prompt: string): string[] {
  return ['--model', NOTEBOOK_CLAUDE_MODEL, '-p', prompt];
}

/**
 * claude -p を cwd=notebookDir で起動し、stdout を返す。
 * 失敗・タイムアウトは throw せず { ok:false, error } で返す（呼び出し側で部分劣化 200）。
 */
export function runClaude(notebookDir: string, prompt: string): Promise<ClaudeRunResult> {
  return new Promise<ClaudeRunResult>((res) => {
    void acquire().then(() => {
      const child = execFile(
        NOTEBOOK_CLAUDE_BIN,
        claudeArgs(prompt),
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
 * claude -p をストリーミングで起動し、stdout チャンクを onChunk に逐次渡す。
 * 完了後に ClaudeRunResult を返す（runClaude と同じ失敗方針）。
 */
export function runClaudeStream(
  notebookDir: string,
  prompt: string,
  onChunk: (text: string) => void,
): Promise<ClaudeRunResult> {
  return new Promise<ClaudeRunResult>((res) => {
    void acquire().then(() => {
      const child = spawn(NOTEBOOK_CLAUDE_BIN, claudeArgs(prompt), {
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
