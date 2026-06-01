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
//   - inbox-stalled  : Apollo 受信箱(inbox.jsonl)の未消化エントリ最古が INBOX_STALL_HOURS（時間単位）
//                       超。受信箱を消費する自律ループが止まっている可能性を 1 件に集約して警告する
//                       （MC-90 DoD(4)。agent/タスク/長期 BLOCKED とは別軸の inbox 消費停止検知）。
//
// 解消したアラートは次回集計で自然に消える（毎回フル再計算。永続/既読状態は持たない＝MVP）。
// このコレクタは throw しない（個別ソースの失敗は握り潰して空で続行）。index.ts 側でも safeJson で包む。

import { collectWorkflows } from './workflows.js';
import { collectTasks } from './tasks.js';
import { readInboxEntries, readConsumedIds } from '../inbox.js';
import { BLOCKED_STALL_DAYS, INBOX_STALL_HOURS } from '../config.js';
import type { ProjectName } from '../lib/projectMap.js';

/** アラートの深刻度。フロントの配色（error/stalled/blocked）にマップする。 */
export type AlertSeverity = 'error' | 'warning';

/** アラートのカテゴリ。 */
export type AlertCategory = 'error' | 'blocked-stalled' | 'deploy-failed' | 'inbox-stalled';

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
    'inbox-stalled': number;
  };
  /** 個別アラート（深刻度→新しい順）。 */
  alerts: AlertItem[];
  /** しきい値（フロント表示の説明に使える）。 */
  thresholds: {
    blockedStallDays: number;
    inboxStallHours: number;
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

/**
 * Apollo 受信箱(inbox.jsonl)の滞留を評価する純粋関数（MC-90 DoD(4)）。
 * テスト可能なように副作用なし（時刻もしきい値も引数で受ける）。
 *
 * ロジック:
 *  - 未消化 = consumedIds に id が無いエントリ。
 *  - SMOKE ノイズ除外: text に '__SMOKE' を含むものは無視（スモークテストマーカー）。
 *  - 未消化が 0 件なら [] （アラート無し）。
 *  - 未消化の中で ts が最古のものの経過時間 hours を求める（(nowMs - parsed) / 3600000）。
 *    ts が解析不能なら hours=Infinity（= 滞留扱い。既存 daysSince と同じ思想）。
 *  - 最古経過 <= stallHours なら [] （最近の投入だけなら正常）。
 *  - 最古経過 > stallHours なら警告を 1 件だけ（エントリ毎に出さず集約してノイズ回避）。
 *
 * @param entries     inbox エントリ（id / ts / text）。
 * @param consumedIds 消費済み id の集合。
 * @param nowMs       現在時刻（エポック ms）。
 * @param stallHours  滞留とみなすしきい値（時間）。
 */
export function evaluateInboxStall(
  entries: { id: string; ts: string; text?: string }[],
  consumedIds: Set<string>,
  nowMs: number,
  stallHours: number,
): AlertItem[] {
  // 未消化 ＆ SMOKE 除外。
  const pending = entries.filter(
    (e) => e && e.id && !consumedIds.has(e.id) && !(e.text ?? '').includes('__SMOKE'),
  );
  if (pending.length === 0) return [];

  // 最古エントリ（ts のエポックが最小）を求める。解析不能 ts は Infinity 経過＝最優先で滞留扱い。
  let oldest = pending[0];
  let oldestParsed = Date.parse(oldest.ts);
  for (const e of pending) {
    const t = Date.parse(e.ts);
    // NaN（不正 ts）は最古扱い。既存の有効値より NaN を優先する。
    if (Number.isNaN(t)) {
      oldest = e;
      oldestParsed = t;
      break;
    }
    if (!Number.isNaN(oldestParsed) && t < oldestParsed) {
      oldest = e;
      oldestParsed = t;
    }
  }

  const hours = Number.isNaN(oldestParsed) ? Infinity : (nowMs - oldestParsed) / 3600000;
  if (!(hours > stallHours)) return []; // 閾値内（最近の投入だけ）は正常。

  const hoursLabel = Number.isFinite(hours) ? `最古 ${Math.floor(hours)} 時間経過` : '最古 長期間';
  return [
    {
      id: 'inbox-stalled', // 安定シングルトンキー（毎ティック同一・トグル維持）。
      category: 'inbox-stalled',
      severity: 'warning',
      title: `Apollo 受信箱に未処理のエントリが ${pending.length} 件あります（${hoursLabel}）。`,
      detail: '受信箱を消費する自律ループが動作していない可能性があります。',
      project: 'cxo',
      // since は最古エントリの ts（取れれば）。taskId は付けない（deep link 不要）。
      since: oldest.ts && !Number.isNaN(Date.parse(oldest.ts)) ? oldest.ts : undefined,
    },
  ];
}

/** Apollo 受信箱の滞留アラート（throw しない。MC-90 DoD(4)）。 */
function inboxStalledAlerts(): AlertItem[] {
  try {
    const entries = readInboxEntries().map((e) => ({ id: e.id, ts: e.ts, text: e.text }));
    const consumed = readConsumedIds();
    return evaluateInboxStall(entries, consumed, Date.now(), INBOX_STALL_HOURS);
  } catch {
    return [];
  }
}

/** GET /api/alerts — 3 カテゴリのアラートを集計して返す。0 件でも 200 で空配列。 */
export function collectAlerts(): AlertsResponse {
  const errors = errorAlerts();
  const blocked = blockedStalledAlerts();
  const deploys = deployFailedAlerts();
  const inbox = inboxStalledAlerts();

  // 深刻度（error → warning）→ since 新しい順で並べる。
  const sevRank = (s: AlertSeverity): number => (s === 'error' ? 0 : 1);
  const alerts = [...errors, ...blocked, ...deploys, ...inbox].sort((a, b) => {
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
      'inbox-stalled': inbox.length,
    },
    alerts,
    thresholds: {
      blockedStallDays: BLOCKED_STALL_DAYS,
      inboxStallHours: INBOX_STALL_HOURS,
    },
  };
}
