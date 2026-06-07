// secretaries collector — 秘書レイヤー（Masayoshi / Son）のライブ状態（MC-165 拡張）。
//
// Masayoshi(📋) と Son(🤝) は OpenClaw 秘書で、~/.claude/projects 配下の subagent ログには
// 出ない（= /api/agents に現れない）。これらは AgentsLive に「常時ピン留めの秘書カード」として
// 表示するため、ここで OpenClaw のセッションログと tmux セッションから直近活動を read-only で集める。
//
// 取得元:
//   - 直近の一言（lastAction）: ~/.openclaw/agents/{main,son}/sessions/*.jsonl の
//     最新 assistant メッセージ text。trajectory.jsonl 等は除外し、mtime 最新の本体 jsonl を読む。
//   - 稼働/待機（status）: tmux セッション（masayoshi='openclaw', son='openclaw-son'）の存在＝待機、
//     セッションログの mtime が STALL_MINUTES 以内＝稼働中。
//
// すべて fail-soft: ファイル不在・パース失敗・tmux 不在でも例外を投げず、status='idle'＋
// 空 lastAction に畳む（呼び出し側で 200 部分劣化）。

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA_HOME, STALL_MINUTES, TERMINAL_TMUX_PATH } from '../config.js';
import type { AgentStatus } from '../lib/stall.js';
import { redactText } from '../lib/redact.js';

/** 秘書カード 1 件分のライブ状態。frontend の SecretaryCard が描画する。 */
export interface SecretarySummary {
  /** 安定キー（avatar / mood の突合に使う）。'masayoshi' | 'son'。 */
  key: string;
  /** 表示名。 */
  name: string;
  /** 絵文字（avatar 未生成時のフォールバック表示）。 */
  emoji: string;
  /** 役割（1 行）。 */
  role: string;
  /** subagent ではないことを示す（UI で「秘書」ラベル用）。 */
  layer: 'secretary';
  /** 稼働/待機。tmux セッション存在＋ログ mtime で判定。 */
  status: AgentStatus;
  /** 直近の一言（最新 assistant メッセージの要約）。空なら未取得。 */
  lastAction: string;
  /** 直近活動の ISO 時刻（セッションログの mtime）。空なら未取得。 */
  lastActivity: string;
}

/** OpenClaw 1 秘書の取得定義。 */
interface SecretaryDef {
  key: string;
  name: string;
  emoji: string;
  role: string;
  /** ~/.openclaw/agents/<agentDir>/sessions/ を読む。 */
  agentDir: string;
  /** 稼働判定に使う tmux セッション名。 */
  tmuxSession: string;
}

const SECRETARIES: SecretaryDef[] = [
  {
    key: 'masayoshi',
    name: 'Masayoshi',
    emoji: '📋',
    role: 'AI 秘書（ボード正本・起票/アサイン/検証調整）',
    agentDir: 'main',
    tmuxSession: 'openclaw',
  },
  {
    key: 'son',
    name: 'Son',
    emoji: '🤝',
    role: 'AI 秘書補佐（Masayoshi と同権限・起票代行）',
    agentDir: 'son',
    tmuxSession: 'openclaw-son',
  },
];

/** OpenClaw セッションログのルート。 */
function openclawSessionsDir(agentDir: string): string {
  return join(DATA_HOME, '.openclaw', 'agents', agentDir, 'sessions');
}

/**
 * sessions/ 内で mtime 最新の「本体」jsonl を返す。
 * trajectory 系（*.trajectory.jsonl）・削除済み（*.deleted.*）は除外する。
 */
function newestSessionFile(dir: string): { path: string; mtimeMs: number } | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  let best: { path: string; mtimeMs: number } | null = null;
  for (const e of entries) {
    if (!e.endsWith('.jsonl')) continue;
    if (e.includes('.trajectory.') || e.includes('.deleted.')) continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size === 0) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
  }
  return best;
}

/** jsonl 末尾の行から最新 assistant メッセージの text を抽出（巨大行に備え末尾だけ読む）。 */
function latestAssistantText(filePath: string): string {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
  const lines = raw.split('\n');
  // 末尾から走査し、最初に見つかった assistant の text を返す。
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let d: unknown;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d || typeof d !== 'object') continue;
    const msg = (d as Record<string, unknown>).message ?? d;
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;
    if (m.role !== 'assistant') continue;
    const content = m.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          (block as Record<string, unknown>).type === 'text' &&
          typeof (block as Record<string, unknown>).text === 'string'
        ) {
          const t = ((block as Record<string, unknown>).text as string).trim();
          if (t) {
            text = t;
            break;
          }
        }
      }
    }
    if (text.trim()) {
      // 1 行スニペットに正規化（200 字上限）。redact で機微情報を除く。
      return redactText(text.trim().replace(/\s+/g, ' ').slice(0, 200));
    }
  }
  return '';
}

/** tmux セッションが存在するか（fail-soft、存在しなければ false）。 */
function tmuxSessionExists(session: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', session], {
      timeout: 3000,
      stdio: 'ignore',
      env: { ...process.env, PATH: TERMINAL_TMUX_PATH },
    });
    return true;
  } catch {
    return false;
  }
}

/** 秘書 1 件のライブ状態を集める（個別 fail-soft）。 */
function collectOne(def: SecretaryDef): SecretarySummary {
  const dir = openclawSessionsDir(def.agentDir);
  const newest = existsSync(dir) ? newestSessionFile(dir) : null;
  const lastAction = newest ? latestAssistantText(newest.path) : '';
  const lastActivity = newest ? new Date(newest.mtimeMs).toISOString() : '';

  // status: tmux セッションが無ければ never（停止扱い）。
  //         セッションがあり、ログ mtime が STALL_MINUTES 以内なら active、それ以外は idle。
  let status: AgentStatus = 'idle';
  if (!tmuxSessionExists(def.tmuxSession)) {
    status = 'never';
  } else if (newest) {
    const minsSince = (Date.now() - newest.mtimeMs) / 60000;
    status = minsSince < STALL_MINUTES ? 'active' : 'idle';
  }

  return {
    key: def.key,
    name: def.name,
    emoji: def.emoji,
    role: def.role,
    layer: 'secretary',
    status,
    lastAction,
    lastActivity,
  };
}

// セッションログのフル読みは軽いが、SSE 由来の再フェッチ連打を吸収するため短期キャッシュする。
let cached: SecretarySummary[] | null = null;
let cachedAt = 0;
const SECRETARIES_TTL_MS = 15000;

/** Masayoshi / Son の秘書カード用ライブ状態一覧（15 秒キャッシュ・fail-soft）。 */
export function collectSecretaries(): SecretarySummary[] {
  const now = Date.now();
  if (cached && now - cachedAt < SECRETARIES_TTL_MS) return cached;
  cached = SECRETARIES.map((d) => {
    try {
      return collectOne(d);
    } catch {
      // 個別失敗は idle ＋空に畳む（カードは常時ピン留めなので消さない）。
      return {
        key: d.key,
        name: d.name,
        emoji: d.emoji,
        role: d.role,
        layer: 'secretary' as const,
        status: 'idle' as AgentStatus,
        lastAction: '',
        lastActivity: '',
      };
    }
  });
  cachedAt = now;
  return cached;
}
