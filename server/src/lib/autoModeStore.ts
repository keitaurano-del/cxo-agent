// autoModeStore — 承認オートモードの永続フラグ（MC-186）。
//
// データストア: data/approval-automode.json（{ enabled, updatedAt }）。
// ON のとき approvalRequestHandler がエージェント承認リクエストを自動承認する。
// 安全ゲート: deploy カテゴリは自動承認しない（push/deploy は人間検証必須方針）。
// 読み書きは navOrderRouter / approvalRequestStore と同じ流儀（JSON 2スペース・fail-soft）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { APPROVAL_AUTOMODE_FILE } from '../config.js';

/** オートモードの状態。 */
export interface AutoModeState {
  /** オートモードが有効か。 */
  enabled: boolean;
  /** 最終更新日時（ISO8601）。未設定時 null。 */
  updatedAt: string | null;
}

/**
 * ディスクから読む。ファイル無し・壊れ JSON・型不正でも {enabled:false, updatedAt:null} に
 * フォールバックする（fail-soft）。
 */
export function readAutoMode(): AutoModeState {
  try {
    const raw = readFileSync(APPROVAL_AUTOMODE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      enabled: parsed.enabled === true,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return { enabled: false, updatedAt: null };
  }
}

/** ディスクへ書く（data/ が無ければ作る）。更新後の状態を返す。 */
export function setAutoMode(enabled: boolean): AutoModeState {
  const state: AutoModeState = { enabled, updatedAt: new Date().toISOString() };
  const dir = dirname(APPROVAL_AUTOMODE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(APPROVAL_AUTOMODE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return state;
}
