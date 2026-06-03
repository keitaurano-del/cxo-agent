// notebookClaude — ノートブックの分析エンジン（MC-126）。
//
// `claude -p "<prompt>"` を cwd=ノートブックの dir で起動する。これにより claude が
// ./sources/ と ./extracted/ の資料を相対 Read で読んで、根拠付きの回答・生成物作成を行う。
// dev ユーザの claude は keita.urano で OAuth 認証済み・settings.json で bypassPermissions。
//
// 同時実行は共有 Anthropic アカウントを食い潰さないよう簡易セマフォで 1〜2 に制限する。
// 上限を超えたリクエストは空きが出るまで待つ。タイムアウト・巨大 stdout 上限も設ける。

import { execFile } from 'node:child_process';
import {
  NOTEBOOK_CLAUDE_BIN,
  NOTEBOOK_CLAUDE_TIMEOUT_MS,
  NOTEBOOK_CLAUDE_CONCURRENCY,
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

/**
 * claude -p を cwd=notebookDir で起動し、stdout を返す。
 * 失敗・タイムアウトは throw せず { ok:false, error } で返す（呼び出し側で部分劣化 200）。
 *
 * @param notebookDir 起動 cwd（= ノートブックの dir）。
 * @param prompt claude に渡すプロンプト（-p の引数）。
 */
export function runClaude(notebookDir: string, prompt: string): Promise<ClaudeRunResult> {
  return new Promise<ClaudeRunResult>((res) => {
    void acquire().then(() => {
      const child = execFile(
        NOTEBOOK_CLAUDE_BIN,
        ['-p', prompt],
        {
          cwd: notebookDir,
          timeout: NOTEBOOK_CLAUDE_TIMEOUT_MS,
          maxBuffer: MAX_STDOUT_BYTES,
          // 認証情報・PATH 等は dev ユーザの env をそのまま渡す。
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
      // stdin は使わないので閉じる（claude が入力待ちでハングしないように）。
      try {
        child.stdin?.end();
      } catch {
        /* noop */
      }
    });
  });
}
