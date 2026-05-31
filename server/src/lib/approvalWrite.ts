// approvalWrite — 承認/却下の正本書き戻し（MC-79。MC-71 の安全書き戻し層を必須再利用）。
//
// 承認フロー（/approvals）で Keita が押した承認/却下を、正本 TASK_TRACKER.md に反映する。
// 書き戻し本体は MC-71 の editTask（楽観ロック sha256 + 3 形式の一意特定 + 書込前 read-back
// 検証 + 該当行/セルのみ置換・フルファイル再生成禁止 + 監査ログ）を そのまま 使う。
// ここはその上で「承認/却下のセマンティクス（status 遷移先の決定）」と「承認決定の監査記録
// （誰が何をいつ承認/却下したか・デプロイ承認フラグ）」を足す薄い層に徹する。
//
// status 遷移:
//   approve（通常 / 設計判断 / 承認待ち）: → TODO（autonomous-rin が次ティックで拾える状態）
//   approve（デプロイ承認）              : → TODO ＋ approval-decisions.jsonl に deployApproved:true
//   reject                               : → CANCELLED（コメント付き。監査に comment 保存）
//
// デプロイ承認フラグ・却下コメントは .md 本文へ自由記述で書き込まず、追記専用の
// approval-decisions.jsonl（config.APPROVAL_DECISIONS_FILE）に記録する。これにより MC-71 層の
// 「許可 4 フィールド（title/status/owner/priority）以外を .md に書かない」不変条件を壊さず、
// かつ autonomous-rin / 林 が JSONL を読んでデプロイ承認・却下理由を機械的に拾える。

import { appendFileSync } from 'node:fs';

import { APPROVAL_DECISIONS_FILE, type ApprovalKind } from '../config.js';
import { editTask, TaskEditError } from './taskTrackerWrite.js';
import type { Task } from '../collectors/tasks.js';

export type ApprovalDecision = 'approve' | 'reject';

export interface ApproveArgs {
  source: string;
  id: string;
  /** 楽観ロック用ハッシュ（任意。UI は GET /api/tasks/hash で取得して渡す）。 */
  baseHash?: string;
  /** この承認がどのカテゴリに対するものか（監査・デプロイ判定に使用）。 */
  categories?: ApprovalKind[];
}

export interface RejectArgs extends ApproveArgs {
  /** 却下理由コメント（任意・監査に保存）。 */
  comment?: string;
}

export interface ApprovalResult {
  task: Task;
  hash: string;
  decision: ApprovalDecision;
  toStatus: 'TODO' | 'CANCELLED';
  deployApproved: boolean;
}

/** 決定 1 件を監査 JSONL に追記（失敗しても本処理は巻き戻さない＝ベストエフォート）。 */
function recordDecision(rec: {
  decision: ApprovalDecision;
  source: string;
  id: string;
  categories: ApprovalKind[];
  fromStatus: string;
  toStatus: string;
  prevHash?: string;
  newHash: string;
  deployApproved?: boolean;
  comment?: string;
}): void {
  try {
    appendFileSync(
      APPROVAL_DECISIONS_FILE,
      JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n',
      'utf-8',
    );
  } catch {
    // 監査追記失敗は握り潰す（status 遷移は MC-71 層側で既に成立済み）。
  }
}

/**
 * 承認: status を TODO に進める。categories に 'deploy' が含まれればデプロイ承認フラグも立てる。
 * 既に TODO のタスクでも editTask は冪等に成功する（read-back で TODO を再確認するだけ）。
 */
export function approveTask({ source, id, baseHash, categories = [] }: ApproveArgs): ApprovalResult {
  const deployApproved = categories.includes('deploy');
  const { task, hash } = editTask({ source, id, patch: { status: 'TODO' }, baseHash });
  recordDecision({
    decision: 'approve',
    source,
    id,
    categories,
    fromStatus: 'approve',
    toStatus: 'TODO',
    prevHash: baseHash,
    newHash: hash,
    deployApproved,
  });
  return { task, hash, decision: 'approve', toStatus: 'TODO', deployApproved };
}

/**
 * 却下: status を CANCELLED にする。comment は監査 JSONL に保存（.md 本文には書かない）。
 */
export function rejectTask({ source, id, baseHash, categories = [], comment }: RejectArgs): ApprovalResult {
  const { task, hash } = editTask({ source, id, patch: { status: 'CANCELLED' }, baseHash });
  recordDecision({
    decision: 'reject',
    source,
    id,
    categories,
    fromStatus: 'reject',
    toStatus: 'CANCELLED',
    prevHash: baseHash,
    newHash: hash,
    comment: comment && comment.trim() !== '' ? comment.trim() : undefined,
  });
  return { task, hash, decision: 'reject', toStatus: 'CANCELLED', deployApproved: false };
}

/** TaskEditError を再 export（router の HTTP マッピングで使う）。 */
export { TaskEditError };
