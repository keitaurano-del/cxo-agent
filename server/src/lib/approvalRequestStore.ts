// approvalRequestStore — エージェント承認リクエストの JSONL ストア。
//
// データストア: data/approval-requests.jsonl（追記専用・last-wins で ID ごとに最新状態を決定）。
// エージェント（autonomous-rin 等）が POST /api/approvals/request で直接リクエストを投げ、
// Keita が Apollo の Approvals UI から承認/却下できる軽量な承認仕組み。
// 既存のタスクタグ方式（TASK_TRACKER 由来）とは独立して動作する。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { APPROVAL_REQUESTS_FILE } from '../config.js';

/** エージェント承認リクエストの 1 件。 */
export interface ApprovalRequest {
  /** "req-<uuid>" 形式の一意 ID。 */
  id: string;
  /** エージェント ID（例: "autonomous-rin"）。 */
  from: string;
  /** 表示名（例: "林"）。 */
  fromName: string;
  /** 承認してほしい内容の件名（短く）。 */
  title: string;
  /** 詳細説明。 */
  description: string;
  /** 承認カテゴリ。 */
  category: 'deploy' | 'design' | 'approval' | 'confirm';
  /** 作成日時（ISO8601）。 */
  requestedAt: string;
  /** 現在のステータス。 */
  status: 'pending' | 'approved' | 'rejected';
  /** 決定日時（ISO8601）。承認/却下後に設定。 */
  decidedAt?: string;
  /** Keita のコメント（却下時等）。 */
  comment?: string;
}

/** JSONL ファイルを全走査して id ごとの最新レコードを返す（last-wins）。 */
function readAll(): Map<string, ApprovalRequest> {
  const map = new Map<string, ApprovalRequest>();
  if (!existsSync(APPROVAL_REQUESTS_FILE)) return map;
  let raw: string;
  try {
    raw = readFileSync(APPROVAL_REQUESTS_FILE, 'utf-8');
  } catch {
    return map;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as ApprovalRequest;
      if (rec.id) map.set(rec.id, rec);
    } catch {
      // 壊れた行は無視。
    }
  }
  return map;
}

/** JSONL ファイルに 1 行追記する。ディレクトリが無ければ作成。 */
function appendRecord(rec: ApprovalRequest): void {
  const dir = dirname(APPROVAL_REQUESTS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(APPROVAL_REQUESTS_FILE, JSON.stringify(rec) + '\n', 'utf-8');
}

/**
 * 承認リクエストを新規作成する。
 * 新しい pending レコードを生成して JSONL に追記し、作成済みレコードを返す。
 */
export function createRequest(data: {
  from: string;
  fromName: string;
  title: string;
  description: string;
  category: ApprovalRequest['category'];
}): ApprovalRequest {
  const rec: ApprovalRequest = {
    id: `req-${randomUUID()}`,
    from: data.from,
    fromName: data.fromName,
    title: data.title,
    description: data.description,
    category: data.category,
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };
  appendRecord(rec);
  return rec;
}

/**
 * 指定 ID の最新レコードを返す（last-wins で JSONL を全走査）。
 * 存在しなければ undefined。
 */
export function getRequest(id: string): ApprovalRequest | undefined {
  const map = readAll();
  return map.get(id);
}

/**
 * 指定 ID のレコードを patch して新レコードを追記する（last-wins）。
 * 既存レコードが存在しない場合は undefined を返す。
 */
export function updateRequest(
  id: string,
  patch: Partial<ApprovalRequest>,
): ApprovalRequest | undefined {
  const existing = getRequest(id);
  if (!existing) return undefined;
  const updated: ApprovalRequest = { ...existing, ...patch, id };
  appendRecord(updated);
  return updated;
}

/**
 * status=pending のリクエストを全件返す（last-wins を適用した最新状態ベース）。
 */
export function listPendingRequests(): ApprovalRequest[] {
  const map = readAll();
  const pending: ApprovalRequest[] = [];
  for (const rec of map.values()) {
    if (rec.status === 'pending') pending.push(rec);
  }
  // requestedAt 昇順（古いものから）。
  pending.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return pending;
}
