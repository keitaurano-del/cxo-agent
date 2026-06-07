// decisionRequestStore — Keita 決裁リクエスト（選択肢付き）の JSONL ストア（MC-203）。
//
// データストア: data/decision-requests.jsonl（追記専用・last-wins で ID ごとに最新状態を決定）。
// エージェントが「Keita に判断してほしい」内容を複数の選択肢（options[]）付きで POST し、
// Keita が Apollo の Approvals UI の「決裁」専用タブから 1 つ選んで決定する。
// 既存の承認リクエスト（approvalRequestStore）とは別系統・別タブ・別オートモードで動く。
//
// approvalRequestStore.ts と同じ流儀（appendFileSync + last-wins 全走査）に揃える。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { DECISION_REQUESTS_FILE } from '../config.js';

/** 決裁の選択肢 1 件。 */
export interface DecisionOption {
  /** 選択肢の一意 ID（同一リクエスト内で重複なし）。 */
  id: string;
  /** ボタンに出すラベル（短く）。 */
  label: string;
  /** 補足説明（任意）。 */
  description?: string;
}

/** Keita 決裁リクエストの 1 件。 */
export interface DecisionRequest {
  /** "dec-<uuid>" 形式の一意 ID。 */
  id: string;
  /** 種別固定 'decision'（型判別用）。 */
  type: 'decision';
  /** エージェント ID（notify 配送先キーにも使う。例: "rin" / "masayoshi"）。 */
  from: string;
  /** 表示名（例: "林"）。 */
  fromName: string;
  /** 決裁してほしい内容の件名（短く）。 */
  title: string;
  /** 詳細説明。 */
  detail: string;
  /** 提示する選択肢（1 つ以上）。 */
  options: DecisionOption[];
  /** 結果を流す要求元エージェント名（notify-agent.sh の宛先キー。例: "rin" / "masayoshi"）。 */
  requesterAgent: string;
  /** 作成日時（ISO8601）。 */
  requestedAt: string;
  /** 現在のステータス。 */
  status: 'pending' | 'decided';
  /** 決定された選択肢の ID（decided 後に設定）。 */
  decidedOptionId?: string;
  /** 決定された選択肢のラベル（履歴・通知表示用。decided 後に設定）。 */
  decidedOptionLabel?: string;
  /** 決定日時（ISO8601）。 */
  decidedAt?: string;
  /** Keita のコメント（任意）。 */
  comment?: string;
  /** オートモードによる自動決裁のとき true（手動決裁では付かない）。 */
  autoDecided?: boolean;
}

/** JSONL ファイルを全走査して id ごとの最新レコードを返す（last-wins）。 */
function readAll(): Map<string, DecisionRequest> {
  const map = new Map<string, DecisionRequest>();
  if (!existsSync(DECISION_REQUESTS_FILE)) return map;
  let raw: string;
  try {
    raw = readFileSync(DECISION_REQUESTS_FILE, 'utf-8');
  } catch {
    return map;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as DecisionRequest;
      if (rec.id) map.set(rec.id, rec);
    } catch {
      // 壊れた行は無視。
    }
  }
  return map;
}

/** JSONL ファイルに 1 行追記する。ディレクトリが無ければ作成。 */
function appendRecord(rec: DecisionRequest): void {
  const dir = dirname(DECISION_REQUESTS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(DECISION_REQUESTS_FILE, JSON.stringify(rec) + '\n', 'utf-8');
}

/**
 * 決裁リクエストを新規作成する。
 * 新しい pending レコードを生成して JSONL に追記し、作成済みレコードを返す。
 */
export function createDecision(data: {
  from: string;
  fromName: string;
  title: string;
  detail: string;
  options: DecisionOption[];
  requesterAgent: string;
}): DecisionRequest {
  const rec: DecisionRequest = {
    id: `dec-${randomUUID()}`,
    type: 'decision',
    from: data.from,
    fromName: data.fromName,
    title: data.title,
    detail: data.detail,
    options: data.options,
    requesterAgent: data.requesterAgent,
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };
  appendRecord(rec);
  return rec;
}

/** 指定 ID の最新レコードを返す（last-wins で全走査）。存在しなければ undefined。 */
export function getDecision(id: string): DecisionRequest | undefined {
  return readAll().get(id);
}

/**
 * 指定 ID のレコードを patch して新レコードを追記する（last-wins）。
 * 既存レコードが存在しない場合は undefined を返す。
 */
export function updateDecision(
  id: string,
  patch: Partial<DecisionRequest>,
): DecisionRequest | undefined {
  const existing = getDecision(id);
  if (!existing) return undefined;
  const updated: DecisionRequest = { ...existing, ...patch, id };
  appendRecord(updated);
  return updated;
}

/** status=pending の決裁リクエストを全件返す（requestedAt 昇順）。 */
export function listPendingDecisions(): DecisionRequest[] {
  const pending: DecisionRequest[] = [];
  for (const rec of readAll().values()) {
    if (rec.status === 'pending') pending.push(rec);
  }
  pending.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return pending;
}

/** status=decided の決裁リクエストを返す（decidedAt 降順＝新しいものから。履歴用）。 */
export function listDecidedDecisions(): DecisionRequest[] {
  const decided: DecisionRequest[] = [];
  for (const rec of readAll().values()) {
    if (rec.status === 'decided') decided.push(rec);
  }
  decided.sort((a, b) =>
    (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt),
  );
  return decided;
}
