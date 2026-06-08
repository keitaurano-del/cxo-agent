// jsonl 読み込みユーティリティ。
//
// Claude セッションログは「1行1 JSON」。壊れた行・空行は黙って飛ばす。
// 巨大な親セッション（数MB）も同期 readFileSync で扱うが、collector 側では
// 必要な行だけ拾うようにして無駄なパースを避ける。

import { readFileSync, statSync } from 'node:fs';
import { readFile as readFileAsync, stat as statAsync } from 'node:fs/promises';

export interface JsonlLine {
  type?: string;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  promptId?: string;
  agentId?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  userType?: string;
  entrypoint?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  // tool_result 行などで使われる
  [key: string]: unknown;
}

/** ファイル全体をパースして JsonlLine 配列を返す。壊れた行はスキップ。 */
export function readJsonl(filePath: string): JsonlLine[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const out: JsonlLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as JsonlLine);
    } catch {
      // 壊れた行は無視
    }
  }
  return out;
}

/**
 * readJsonl の非同期版（fs.promises.readFile）。
 * 重い親セッション群の背景スキャンで、ファイル間にイベントループへ制御を返すために使う。
 * パース結果は readJsonl と同一（壊れた行・空行はスキップ）。
 */
export async function readJsonlAsync(filePath: string): Promise<JsonlLine[]> {
  let raw: string;
  try {
    raw = await readFileAsync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const out: JsonlLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as JsonlLine);
    } catch {
      // 壊れた行は無視
    }
  }
  return out;
}

/**
 * 最終活動時刻を ISO 文字列で返す。
 * 末尾行から遡って最初に見つかった timestamp を採用。
 * どの行にも timestamp が無ければ mtime をフォールバック。
 */
export function lastActivity(filePath: string, lines?: JsonlLine[]): string {
  const ls = lines ?? readJsonl(filePath);
  for (let i = ls.length - 1; i >= 0; i--) {
    const ts = ls[i].timestamp;
    if (ts) return ts;
  }
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/**
 * lastActivity の非同期版。lines に timestamp が無いときの mtime フォールバックを
 * fs.promises.stat で行い、背景スキャンで同期 stat を避ける。
 */
export async function lastActivityAsync(filePath: string, lines: JsonlLine[]): Promise<string> {
  for (let i = lines.length - 1; i >= 0; i--) {
    const ts = lines[i].timestamp;
    if (ts) return ts;
  }
  try {
    return (await statAsync(filePath)).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/**
 * message.content から最初の text を取り出す（content が string ならそのまま）。
 * 無ければ null。
 */
export function firstText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as any).type === 'text') {
        const t = (block as any).text;
        if (typeof t === 'string') return t;
      }
    }
  }
  return null;
}
