// notifyAgent — 決裁結果を要求元エージェントへターミナル直送するヘルパ（MC-203 / MC-200）。
//
// ~/cron-scripts/notify-agent.sh <agent> "<message>" を spawn して、決裁結果を要求元
// エージェント（requesterAgent）のターミナルへ流す。notify-agent.sh 側がエラー耐性
// （失敗時 ~/agent-inbox へ退避）を持つので、ここは spawn して fire-and-forget する。
//
// 配送は補助機能なので失敗してもサーバを落とさない（fail-soft・例外を投げない）。
// 同期 spawn だと notify-agent.sh が openclaw を nohup で起動して時間がかかる場合に
// レスポンスをブロックするため、detached/unref で非同期に投げる（terminalUpload とは別方針）。

import { spawn } from 'node:child_process';

import { NOTIFY_AGENT_SCRIPT, NOTIFY_AGENT_PATH } from '../config.js';

/** notify-agent.sh が受け付ける既知の宛先キー（不明値は配送しない）。 */
const KNOWN_AGENTS = new Set<string>(['masayoshi', 'rin', 'son']);

/**
 * 要求元エージェントの宛先キーへ正規化する。
 * notify-agent.sh は別名（林/レン 等）も受けるが、ここでは安全に既知キーへ寄せる。
 * 不明なら null（配送しない）。
 */
export function normalizeAgentTarget(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  // 代表的な別名を既知キーへマップ。
  if (v === 'masayoshi' || v === 'まさよし' || v === 'main') return 'masayoshi';
  if (v === 'rin' || v === '林' || v === '凜' || v === 'りん' || v === 'ren' || v === 'レン' || v === 'hayashi') {
    return 'rin';
  }
  if (v === 'son' || v === 'ソン') return 'son';
  return KNOWN_AGENTS.has(v) ? v : null;
}

/**
 * 指定エージェントへメッセージをターミナル直送する（非同期・fail-soft）。
 * - agent が不明値なら何もしない（false 相当だが戻り値は void）。
 * - spawn 失敗・notify-agent.sh の非ゼロ終了は握り潰してログのみ（呼び出し側はブロックしない）。
 */
export function notifyAgent(agent: string | undefined | null, message: string): void {
  const target = normalizeAgentTarget(agent);
  if (!target) {
    console.warn(`[notify] 宛先不明のため配送をスキップ: ${String(agent)}`);
    return;
  }
  // son は notify-agent.sh が自セッションループ防止で拒否するが、ここでは投げて side で弾かせる。
  try {
    const child = spawn(NOTIFY_AGENT_SCRIPT, [target, message], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PATH: NOTIFY_AGENT_PATH },
    });
    child.on('error', (err) => {
      console.warn(`[notify] spawn 失敗（無視）: ${err.message}`);
    });
    child.unref();
  } catch (err) {
    console.warn(`[notify] 配送に失敗（無視）: ${err instanceof Error ? err.message : String(err)}`);
  }
}
