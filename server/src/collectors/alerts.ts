// alerts collector (MC-63)
//
// Apollo 上に出す「通知/アラート」を既存 collector から集計する軽量レイヤー。
// 新規にログ解析を足さず、すでに解析済みのデータ（workflows / tasks）だけを再利用する
// （二重解析・多重通知を避ける。reference_subagent_slow_not_dead / 既存しきい値方針に準拠）。
//
// カテゴリ（DoD: ERROR / 長期 BLOCKED / deploy 失敗）:
//   - error          : workflow run の status === 'error'（collectWorkflows の構造化結果が唯一の
//                       確定エラーソース。agent jsonl の生 error 行や systemd 失敗は拾わない＝誤検知回避）。
//   - blocked-stalled: tasks の status === 'BLOCKED' かつ最終更新が BLOCKED_STALL_DAYS（日単位）超。
//                       agent の 8 分しきい値・タスクの 3 日 IN_PROGRESS 滞留とは別軸の「長期 BLOCKED」。
//   - deploy-failed  : MVP では未実装（GitHub Actions 連携は MC-64 が担当）。カテゴリは用意するが
//                       常に 0 件で返す（無いものを ERROR 表示しない＝誤検知ゼロ）。
//
// 解消したアラートは次回集計で自然に消える（毎回フル再計算。永続/既読状態は持たない＝MVP）。
// このコレクタは throw しない（個別ソースの失敗は握り潰して空で続行）。index.ts 側でも safeJson で包む。

import { collectWorkflows } from './workflows.js';
import { collectTasks } from './tasks.js';
import { BLOCKED_STALL_DAYS } from '../config.js';
import type { ProjectName } from '../lib/projectMap.js';

/** アラートの深刻度。フロントの配色（error/stalled/blocked）にマップする。 */
export type AlertSeverity = 'error' | 'warning';

/** アラートのカテゴリ。 */
export type AlertCategory = 'error' | 'blocked-stalled' | 'deploy-failed';

/** 1 件のアラート。 */
export interface AlertItem {
  id: string; // 安定キー（category + 対象 ID）。フロントの key とトグルに使う。
  category: AlertCategory;
  severity: AlertSeverity;
  title: string; // 中立的丁寧体の短い説明。
  detail?: string; // 補足（任意）。
  project?: ProjectName;
  /** 関連リンク先（タスク詳細へ deep link 等）。フロント任意利用。 */
  taskId?: string;
  source?: string; // タスク由来の場合の出典台帳。
  runId?: string; // workflow 由来の場合の run。
  since?: string; // 発生/最終活動時刻（ISO、取れれば）。
}

/** GET /api/alerts のレスポンス。 */
export interface AlertsResponse {
  generatedAt: string;
  /** 深刻度別件数（バッジ表示に使う）。 */
  counts: {
    error: number;
    warning: number;
    total: number;
  };
  /** カテゴリ別件数。 */
  byCategory: {
    error: number;
    'blocked-stalled': number;
    'deploy-failed': number;
  };
  /** 個別アラート（深刻度→新しい順）。 */
  alerts: AlertItem[];
  /** しきい値（フロント表示の説明に使える）。 */
  thresholds: {
    blockedStallDays: number;
  };
}

/** ISO 文字列の日数経過。取れない/不正は Infinity（= しきい値超扱いにはしない側で判断）。 */
function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

/** workflow の error run をアラート化（throw しない）。 */
function errorAlerts(): AlertItem[] {
  let runs: ReturnType<typeof collectWorkflows>;
  try {
    runs = collectWorkflows();
  } catch {
    return [];
  }
  const out: AlertItem[] = [];
  for (const r of runs) {
    if (r.status !== ('error' as typeof r.status)) continue;
    out.push({
      id: `error:${r.runId}`,
      category: 'error',
      severity: 'error',
      title: `ワークフロー「${r.label}」がエラーで終了しています。`,
      detail: r.projectLabel,
      project: r.project,
      runId: r.runId,
      since: r.lastActivity && r.lastActivity !== new Date(0).toISOString() ? r.lastActivity : undefined,
    });
  }
  return out;
}

/** 長期 BLOCKED タスクをアラート化（throw しない）。 */
function blockedStalledAlerts(): AlertItem[] {
  let tasks: ReturnType<typeof collectTasks>;
  try {
    tasks = collectTasks();
  } catch {
    return [];
  }
  const out: AlertItem[] = [];
  for (const t of tasks) {
    if (t.status !== 'BLOCKED') continue;
    const days = daysSince(t.updated);
    if (!(days > BLOCKED_STALL_DAYS)) continue; // updated 不明(Infinity)も長期扱い。
    const dayLabel = Number.isFinite(days) ? `${Math.floor(days)}日以上` : '長期間';
    out.push({
      id: `blocked-stalled:${t.source}:${t.id}`,
      category: 'blocked-stalled',
      severity: 'warning',
      title: `タスク ${t.id} が ${dayLabel} ブロック状態のままです。`,
      detail: t.title,
      project: t.project,
      taskId: t.id,
      source: t.source,
      since: t.updated,
    });
  }
  return out;
}

/**
 * deploy 失敗アラート（MVP では空）。
 * GitHub Actions の run 状態取得は MC-64 で実装予定。ここで偽の失敗を出さないため常に空配列。
 */
function deployFailedAlerts(): AlertItem[] {
  return [];
}

/** GET /api/alerts — 3 カテゴリのアラートを集計して返す。0 件でも 200 で空配列。 */
export function collectAlerts(): AlertsResponse {
  const errors = errorAlerts();
  const blocked = blockedStalledAlerts();
  const deploys = deployFailedAlerts();

  // 深刻度（error → warning）→ since 新しい順で並べる。
  const sevRank = (s: AlertSeverity): number => (s === 'error' ? 0 : 1);
  const alerts = [...errors, ...blocked, ...deploys].sort((a, b) => {
    const d = sevRank(a.severity) - sevRank(b.severity);
    if (d !== 0) return d;
    const ta = a.since ? Date.parse(a.since) : 0;
    const tb = b.since ? Date.parse(b.since) : 0;
    return tb - ta;
  });

  const errorCount = alerts.filter((a) => a.severity === 'error').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      error: errorCount,
      warning: warningCount,
      total: alerts.length,
    },
    byCategory: {
      error: errors.length,
      'blocked-stalled': blocked.length,
      'deploy-failed': deploys.length,
    },
    alerts,
    thresholds: {
      blockedStallDays: BLOCKED_STALL_DAYS,
    },
  };
}
