// blockerDecisionSync — blockers.json の Keita 待ち（next_actor='keita'）を決裁フローへ自動同期する（MC-365）。
//
// 背景: 型A（Keita 判断待ち）タスクは台帳メモ止まりだと「ボタン1つで確定」できず放置されがち。
// これを恒久機能化し、blockers.json に Keita 待ちが載った時点で決裁フロー（Approvals UI の
// 決裁タブ・PC/スマホ共通）へ汎用ボタン付き決裁が自動投入されるようにする。
//
// 呼び出し: decisionRouter の GET /api/decisions（一覧読み出し時の lazy sweep。
// applyExpiredFallbacks と同じ流儀・cron 依存なし）。UI を開けば必ず最新が並ぶ。
//
// 重複防止: 決裁レコードの taskId（無ければ title 内の taskId 文字列）で照合し、
// その待ちの開始日（blocker.since 00:00 JST）以降に作られた決裁が既にあればスキップする。
// → pending 中は二重投入しない / 決裁済みなら（blockers.json が棚卸しで更新されるまで）再投入しない /
//   後日また新しい待ちが始まれば（since が進めば）新規決裁が立つ。
//
// 自動生成の選択肢は汎用3択（承認して進める・修正/指示あり・保留）。個別に選択肢を練りたい
// 決裁は従来どおりエージェントが POST /api/decisions/request で先に投入すればよく、
// その場合この同期は taskId 照合でスキップする（手動投入が常に優先）。

import { existsSync, readFileSync } from 'node:fs';

import { BLOCKERS_FILE } from '../config.js';
import {
  createDecision,
  listAllDecisions,
  type DecisionRequest,
} from './decisionRequestStore.js';

/** blockers.json の 1 エントリ（board-audit が生成。MC-353 P1）。 */
interface BlockerEntry {
  taskId: string;
  type: string;
  since: string; // "YYYY-MM-DD"
  next_action: string;
  next_actor: string;
  note?: string;
}

const MAX_TITLE_LEN = 200;
const MAX_DETAIL_LEN = 2000;

/** 自動生成決裁の汎用選択肢。options[0] が既定（オートモード/フォールバックの対象）。 */
const GENERIC_OPTIONS = [
  { id: 'approve', label: '承認して進める', description: '提案どおり進行。担当が即実行に移ります。' },
  { id: 'revise', label: '修正・指示あり', description: 'コメント欄に指示を書いてください。担当が反映します。' },
  { id: 'hold', label: '保留', description: '今は判断しない。次回の棚卸しまとめで再提示されます。' },
];

/** blockers.json を読む。無い/壊れている場合は空配列（同期は何もしない＝安全側）。 */
function readBlockers(): BlockerEntry[] {
  if (!existsSync(BLOCKERS_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(BLOCKERS_FILE, 'utf-8')) as {
      blockers?: unknown;
    };
    if (!Array.isArray(parsed.blockers)) return [];
    return parsed.blockers.filter(
      (b): b is BlockerEntry =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as BlockerEntry).taskId === 'string' &&
        typeof (b as BlockerEntry).next_actor === 'string' &&
        typeof (b as BlockerEntry).next_action === 'string' &&
        typeof (b as BlockerEntry).since === 'string',
    );
  } catch {
    return [];
  }
}

/** blocker.since（"YYYY-MM-DD"・JST の日付）→ その日 00:00 JST の ISO8601（UTC 表記）。 */
function sinceToIso(since: string): string {
  const ts = Date.parse(`${since}T00:00:00+09:00`);
  // 日付として読めない since は epoch 扱い＝「過去の決裁が 1 件でもあればスキップ」の安全側。
  if (Number.isNaN(ts)) return new Date(0).toISOString();
  return new Date(ts).toISOString();
}

/** この blocker の待ちに対応する決裁が既に存在するか（taskId 照合・since 以降のみ有効）。 */
function hasDecisionFor(taskId: string, sinceIso: string, all: DecisionRequest[]): boolean {
  return all.some(
    (d) =>
      (d.taskId === taskId || d.title.includes(taskId)) && d.requestedAt >= sinceIso,
  );
}

/** 改行を潰して max 文字に切り詰める（title 整形用）。 */
function clipFlat(text: string, max: number): string {
  const flat = text.replace(/\s*\n\s*/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** 改行は保ったまま max 文字に切り詰める（detail 整形用）。 */
function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * blockers.json の next_actor='keita' エントリを走査し、未投入のものを決裁フローへ自動投入する。
 * 作成したレコード一覧を返す（通知・broadcast は呼び出し元の責務）。
 */
export function syncBlockersToDecisions(): DecisionRequest[] {
  const keitaWaits = readBlockers().filter((b) => b.next_actor === 'keita');
  if (keitaWaits.length === 0) return [];

  const all = listAllDecisions();
  const created: DecisionRequest[] = [];
  for (const b of keitaWaits) {
    const sinceIso = sinceToIso(b.since);
    if (hasDecisionFor(b.taskId, sinceIso, all)) continue;
    const rec = createDecision({
      from: 'son',
      fromName: 'Son（ブロッカー自動連携）',
      title: clipFlat(`${b.taskId} ${b.next_action}`, MAX_TITLE_LEN),
      detail: clip(
        `${b.next_action}${b.note ? `\n\n経緯: ${b.note}` : ''}\n\n（blockers.json の Keita 待ちから自動投入。詳細は台帳 ${b.taskId} 参照）`,
        MAX_DETAIL_LEN,
      ),
      options: GENERIC_OPTIONS,
      requesterAgent: 'son',
      taskId: b.taskId,
    });
    created.push(rec);
  }
  return created;
}
