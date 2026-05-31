// approvals collector (MC-79)
//
// 「Keita の承認/確認が要る項目」を全 TASK_TRACKER から集約する独立 collector。
// 既存の tasks collector（collectTasks）が付与する needsKeita / approvalTags を読み、
// 承認フロー（/approvals）に出す対象だけをフィルタする。alerts の blocked-stalled とは
// 別軸の独立集計で、二重集計はしない（alerts=放置監視、approvals=承認導線）。
//
// 集約基準（Keita 確定 2026-05-31。誤検知ゼロ方針 = 曖昧なら出さない）:
//   A: status=BLOCKED かつ Keita 待ち（owner に Keita を含む or 設計判断/承認待ち系タグ）
//   B: デプロイ可否/デプロイ承認タグ（status 問わず）
//   C: 設計判断/仕様未確定タグ（status 問わず）
//   D: 承認待ち（Keita承認待ち/承認待ち）タグ
//   E: 要確認タグ
// 除外: REVIEW / DONE / CANCELLED は常に対象外（MC-80 で REVIEW は Keita 確認不要のため）。
//   また承認/却下は正本 .md への書き戻し（MC-71 層）を伴うため、編集不可 source
//   （kanban/today/private 等）は最初から対象にしない（操作できない項目を出さない）。
//
// 承認カテゴリ（バッジ用）: blocked / design / deploy / approval / confirm。
// 1 タスクが複数該当しうるので、UI のタブ件数は「カテゴリごとに 1 件カウント」する。
// 一覧の items は重複しない（タスク単位で 1 件、該当カテゴリを categories[] に列挙）。

import { readFileSync } from 'node:fs';

import { collectTasks, type Task } from './tasks.js';
import { APPROVAL_DECISIONS_FILE, type ApprovalKind } from '../config.js';

// 編集可能 source（MC-71 / taskTrackerWrite の resolveSource と同一集合）。
// この source の項目のみ承認/却下で正本へ書き戻せるため、承認フローの対象にする。
const EDITABLE_SOURCES = new Set<string>([
  'logic/TASK_TRACKER',
  'nishimaru/TASK_TRACKER',
  'cxo/TASK_TRACKER',
]);

/** 承認フローに出す 1 件（Task を拡張し、該当カテゴリを付与）。 */
export interface ApprovalItem extends Task {
  /** この項目が該当する承認カテゴリ（重複なし・1 件に複数付きうる）。 */
  categories: ApprovalKind[];
  /** 主カテゴリ（並び/代表表示用。優先度 blocked>deploy>design>approval>confirm）。 */
  primaryCategory: ApprovalKind;
}

/** GET /api/approvals のレスポンス。 */
export interface ApprovalsResponse {
  generatedAt: string;
  /** カテゴリ別件数（タブのバッジ用。1 タスクが複数カテゴリに重複カウントされうる）。 */
  byCategory: Record<ApprovalKind, number>;
  /** 承認待ち総件数（タスク単位のユニーク件数＝ナビバッジ用）。 */
  total: number;
  /** 個別項目（タスク単位・重複なし）。 */
  items: ApprovalItem[];
}

// 主カテゴリの優先順位（小さいほど優先）。BLOCKED 由来を最優先で目立たせる。
const CATEGORY_PRIORITY: Record<ApprovalKind, number> = {
  blocked: 0,
  deploy: 1,
  design: 2,
  approval: 3,
  confirm: 4,
};

const ALL_CATEGORIES: ApprovalKind[] = ['blocked', 'deploy', 'design', 'approval', 'confirm'];

/**
 * 1 タスクが承認フロー対象かを判定し、該当カテゴリを返す。
 * 対象外（REVIEW/DONE/CANCELLED、編集不可 source、該当タグ/状態なし）は空配列。
 */
function categoriesFor(t: Task): ApprovalKind[] {
  // 編集不可 source は承認操作できないので最初から除外。
  if (!EDITABLE_SOURCES.has(t.source)) return [];
  // REVIEW / DONE / CANCELLED は常に除外（MC-80 と整合）。
  if (t.status === 'REVIEW' || t.status === 'DONE' || t.status === 'CANCELLED') return [];

  const tags = t.approvalTags ?? [];
  const set = new Set<ApprovalKind>();

  // A: BLOCKED かつ Keita 待ち。owner に Keita を含む、または設計判断/承認待ち系タグがある。
  if (t.status === 'BLOCKED' && (t.needsKeita || tags.includes('design') || tags.includes('approval'))) {
    set.add('blocked');
  }
  // B〜E: タグそのもの（status 問わず）。
  if (tags.includes('deploy')) set.add('deploy');
  if (tags.includes('design')) set.add('design');
  if (tags.includes('approval')) set.add('approval');
  if (tags.includes('confirm')) set.add('confirm');

  // 並びを CATEGORY_PRIORITY に揃える。
  return [...set].sort((a, b) => CATEGORY_PRIORITY[a] - CATEGORY_PRIORITY[b]);
}

/**
 * id+source ごとの「最新の決定の遷移先 status」を作る（最後の行が勝つ）。
 *
 * 承認フローは status だけでなく本文タグ（設計判断/承認待ち等）でも拾うため、承認で
 * BLOCKED→TODO に進めても本文タグが残っていると再浮上してしまう。これを防ぐため、承認/却下
 * の決定ログ（approval-decisions.jsonl）から id+source ごとに最後の決定の toStatus を引き、
 * 「現在の status がその toStatus と一致する」項目を抑止する（＝決定が今も反映されている）。
 *
 * whole-file ハッシュ一致での抑止だと、無関係な別タスクの編集で全件の抑止が外れて再浮上する。
 * status 一致での抑止なら、当該タスクが再度ブロック/差し戻し（status 変更）されたときだけ
 * 再浮上し、他タスクの編集には影響されない（per-task で堅牢）。
 */
function buildDecidedStatus(): Map<string, string> {
  const latest = new Map<string, string>();
  let raw: string;
  try {
    raw = readFileSync(APPROVAL_DECISIONS_FILE, 'utf-8');
  } catch {
    return latest; // ログ未作成（決定ゼロ）。
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as { source?: string; id?: string; toStatus?: string };
      if (!rec.source || !rec.id || !rec.toStatus) continue;
      latest.set(`${rec.source}:${rec.id}`, rec.toStatus); // 後勝ち（最新決定）。
    } catch {
      // 壊れ行は無視。
    }
  }
  return latest;
}

/** GET /api/approvals — 承認フロー対象を集約して返す。0 件でも 200。 */
export function collectApprovals(): ApprovalsResponse {
  let tasks: Task[];
  try {
    tasks = collectTasks();
  } catch {
    tasks = [];
  }

  // id+source ごとの最新決定の遷移先 status（現在 status が一致すれば抑止）。
  const decidedStatus = buildDecidedStatus();

  const items: ApprovalItem[] = [];
  const byCategory: Record<ApprovalKind, number> = {
    blocked: 0,
    deploy: 0,
    design: 0,
    approval: 0,
    confirm: 0,
  };

  for (const t of tasks) {
    // 決定が今も反映されている（最新決定の toStatus と現在 status が一致する）項目は出さない。
    // 設計判断/承認待ちタグが本文に残っていても、承認で TODO 化済みなら再浮上させない（再浮上防止）。
    // 当該タスクが再度 status 変更されれば（差し戻し等）一致が外れ、再び承認対象に戻る。
    if (decidedStatus.get(`${t.source}:${t.id}`) === t.status) continue;
    const categories = categoriesFor(t);
    if (categories.length === 0) continue;
    for (const c of categories) byCategory[c] += 1;
    items.push({
      ...t,
      categories,
      primaryCategory: categories[0],
    });
  }

  // 並び: 主カテゴリ優先 → stalled 先頭 → ID 昇順。
  items.sort(
    (a, b) =>
      CATEGORY_PRIORITY[a.primaryCategory] - CATEGORY_PRIORITY[b.primaryCategory] ||
      Number(b.stalled) - Number(a.stalled) ||
      a.id.localeCompare(b.id),
  );

  return {
    generatedAt: new Date().toISOString(),
    byCategory,
    total: items.length,
    items,
  };
}

export { ALL_CATEGORIES };
