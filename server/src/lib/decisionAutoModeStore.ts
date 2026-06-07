// decisionAutoModeStore — 決裁オートモードの永続フラグ（MC-203）。
//
// データストア: data/decision-automode.json（{ enabled, mode, updatedAt }）。
// 既存の承認オートモード（autoModeStore）とは別キー・別ファイル・別 state。
// ON のとき decisionRequestHandler が決裁リクエストを自動決裁する。
//   - mode='default': 既定 option（options[0]）を自動選択して decided にする。
//   - mode='off'    : 自動決裁しない（enabled でも pending のまま。明示的に「自動しない」を選ぶ用）。
// 安全側既定: enabled=false。台帳由来 BLOCKED 等の安全線引きは MC-201 方針を踏襲
// （このストアはエージェント発の決裁リクエストのみを対象とし、台帳タスクの status は変更しない）。
// 読み書きは autoModeStore と同じ流儀（JSON 2スペース・fail-soft）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { DECISION_AUTOMODE_FILE } from '../config.js';

/** 決裁オートモードの自動選択ポリシー。 */
export type DecisionAutoModeMode = 'default' | 'off';

/** 決裁オートモードの状態。 */
export interface DecisionAutoModeState {
  /** オートモードが有効か。 */
  enabled: boolean;
  /** 自動選択ポリシー（'default'=既定 option を選ぶ / 'off'=自動しない）。 */
  mode: DecisionAutoModeMode;
  /** 最終更新日時（ISO8601）。未設定時 null。 */
  updatedAt: string | null;
}

/**
 * ディスクから読む。ファイル無し・壊れ JSON・型不正でも安全側
 * { enabled:false, mode:'default', updatedAt:null } にフォールバックする（fail-soft）。
 */
export function readDecisionAutoMode(): DecisionAutoModeState {
  try {
    const raw = readFileSync(DECISION_AUTOMODE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      enabled: parsed.enabled === true,
      mode: parsed.mode === 'off' ? 'off' : 'default',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return { enabled: false, mode: 'default', updatedAt: null };
  }
}

/** ディスクへ書く（data/ が無ければ作る）。更新後の状態を返す。 */
export function setDecisionAutoMode(
  enabled: boolean,
  mode: DecisionAutoModeMode,
): DecisionAutoModeState {
  const state: DecisionAutoModeState = {
    enabled,
    mode,
    updatedAt: new Date().toISOString(),
  };
  const dir = dirname(DECISION_AUTOMODE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(DECISION_AUTOMODE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return state;
}
