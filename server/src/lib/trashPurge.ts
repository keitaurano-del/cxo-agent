// trashPurge — 成果物ゴミ箱（.trash）の自動パージ（MC-234）。
//
// MC-230 でゴミ箱・復元・手動「空にする」は実装済み。本モジュールは積み残しの「自動パージ」を担う:
//  - 保持期間（DELIVERABLE_TRASH_RETENTION_DAYS 日）を超えたバッチを物理削除。
//  - ゴミ箱の総容量が上限（DELIVERABLE_TRASH_MAX_BYTES バイト）を超えたら、
//    保持期間内であっても古い削除順から削って上限以下に収める。
//  - 「保持期間内かつ容量内」のバッチは残す（誤って消さない）。
//
// 走査は重くなりうるので、最低実行間隔（PURGE_MIN_INTERVAL_MS）でスロットルする。
// 呼び出し側（/api/deliverables GET）は purgeTrashIfDue() を呼ぶだけでよい（throttle 内蔵）。

import { readdirSync, statSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  DELIVERABLE_TRASH_RETENTION_DAYS,
  DELIVERABLE_TRASH_MAX_BYTES,
} from '../config.js';
import { trashRoot } from './deliverablePath.js';

interface TrashBatch {
  batchId: string;
  absDir: string;
  deletedAt: number; // epoch ms（不明は 0）
  sizeBytes: number; // バッチフォルダ全体のバイト数
}

/** ディレクトリ配下の総バイト数を再帰集計する（symlink は辿らない）。 */
function dirSizeBytes(absDir: string): number {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const ent of entries) {
    const abs = join(absDir, ent.name);
    if (ent.isSymbolicLink()) continue; // symlink は容量集計しない（脱出/二重計上回避）
    if (ent.isDirectory()) {
      total += dirSizeBytes(abs);
    } else if (ent.isFile()) {
      try {
        total += statSync(abs).size;
      } catch {
        /* 集計不能なファイルは 0 扱い */
      }
    }
  }
  return total;
}

/** ゴミ箱の各バッチ（直下フォルダ）のメタ（deletedAt・サイズ）を読む。 */
function listTrashBatches(root: string): TrashBatch[] {
  let dirs: import('node:fs').Dirent[];
  try {
    dirs = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: TrashBatch[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const absDir = join(root, d.name);
    let deletedAt = 0;
    try {
      const raw = JSON.parse(readFileSync(join(absDir, '.trashinfo.json'), 'utf-8')) as {
        deletedAt?: unknown;
      };
      if (typeof raw.deletedAt === 'string') {
        const t = Date.parse(raw.deletedAt);
        if (!Number.isNaN(t)) deletedAt = t;
      }
    } catch {
      // .trashinfo.json が無い/壊れている場合は batchId 先頭の timestamp を使う
      // （makeTrashTarget は `${Date.now()}-${rand}` 形式）。
      const m = /^(\d+)-/.exec(d.name);
      if (m) {
        const t = Number(m[1]);
        if (Number.isFinite(t)) deletedAt = t;
      }
    }
    out.push({ batchId: d.name, absDir, deletedAt, sizeBytes: dirSizeBytes(absDir) });
  }
  return out;
}

/** バッチを物理削除する（best-effort）。成功で true。 */
function removeBatch(batch: TrashBatch): boolean {
  try {
    rmSync(batch.absDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export interface PurgeResult {
  scanned: number;
  purgedByAge: string[];
  purgedByCapacity: string[];
}

/**
 * 閾値超過のゴミ箱バッチを自動パージする（throttle なし＝即実行）。検証/テスト用に公開。
 * @param now パージ判定の基準時刻（epoch ms）。省略時は Date.now()。
 */
export function purgeTrash(now: number = Date.now()): PurgeResult {
  const root = trashRoot();
  const result: PurgeResult = { scanned: 0, purgedByAge: [], purgedByCapacity: [] };

  let batches = listTrashBatches(root);
  result.scanned = batches.length;
  if (batches.length === 0) return result;

  // 1) 保持期間超過のバッチを削除（有効時のみ）。
  if (DELIVERABLE_TRASH_RETENTION_DAYS > 0) {
    const maxAgeMs = DELIVERABLE_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const survivors: TrashBatch[] = [];
    for (const b of batches) {
      // deletedAt 不明（0）は保持（誤削除を避け、容量側に委ねる）。
      const age = b.deletedAt > 0 ? now - b.deletedAt : -1;
      if (age > maxAgeMs) {
        if (removeBatch(b)) result.purgedByAge.push(b.batchId);
        else survivors.push(b);
      } else {
        survivors.push(b);
      }
    }
    batches = survivors;
  }

  // 2) 容量上限超過なら、古い削除順（deletedAt 昇順）から削って上限以下に収める（有効時のみ）。
  if (DELIVERABLE_TRASH_MAX_BYTES > 0) {
    let total = batches.reduce((s, b) => s + b.sizeBytes, 0);
    if (total > DELIVERABLE_TRASH_MAX_BYTES) {
      // 古い順（deletedAt 昇順、不明は最古扱い）。
      const oldestFirst = [...batches].sort((a, b) => {
        const da = a.deletedAt > 0 ? a.deletedAt : 0;
        const db = b.deletedAt > 0 ? b.deletedAt : 0;
        return da - db;
      });
      for (const b of oldestFirst) {
        if (total <= DELIVERABLE_TRASH_MAX_BYTES) break;
        if (removeBatch(b)) {
          result.purgedByCapacity.push(b.batchId);
          total -= b.sizeBytes;
        }
      }
    }
  }

  return result;
}

// ─── throttle 付き呼び出し ─────────────────────────────────

/** 自動パージの最低実行間隔（env で上書き可、既定 6 時間）。連続走査でゴミ箱を毎回スキャンしないため。 */
const PURGE_MIN_INTERVAL_MS = (() => {
  const v = Number(process.env.DELIVERABLE_TRASH_PURGE_INTERVAL_MS);
  return Number.isFinite(v) && v > 0 ? v : 6 * 60 * 60 * 1000;
})();

let lastPurgeAt = 0;

/**
 * 前回から PURGE_MIN_INTERVAL_MS 経過していれば自動パージを実行する（コレクタ/一覧取得時に呼ぶ）。
 * 実行しなかった場合は null を返す。例外は握りつぶす（一覧取得を自動パージで壊さない）。
 */
export function purgeTrashIfDue(now: number = Date.now()): PurgeResult | null {
  if (now - lastPurgeAt < PURGE_MIN_INTERVAL_MS) return null;
  lastPurgeAt = now;
  try {
    return purgeTrash(now);
  } catch {
    return null;
  }
}
