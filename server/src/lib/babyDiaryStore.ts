// babyDiaryStore — 成長日記（MC-233 Phase1）の JSONL ストア。
//
// データストア（すべて data/ 配下・.gitignore 済み）:
//   data/baby-diary-entries.jsonl  : 日記エントリ（追記専用・last-wins by date・論理削除は deleted フラグ）
//   data/baby-diary-media.jsonl    : メディアメタ（追記専用・論理削除は deleted フラグ）
//
// approvalRequestStore.ts の last-wins パターンに倣う:
//   JSONL を全走査して id（entry は date、media は id）ごとの最新レコードを採用する。
//   論理削除は deleted:true のレコードを追記し、読み出し時に除外する。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  BABY_DIARY_ENTRIES_FILE,
  BABY_DIARY_MEDIA_FILE,
} from '../config.js';

// ─── 型 ─────────────────────────────────────────────────

/** 日記エントリの 1 件（id = date、1 日 1 エントリ）。 */
export interface DiaryEntry {
  /** 日付（YYYY-MM-DD）。一意キー。 */
  date: string;
  /** 自由記述メモ（任意）。 */
  memo?: string;
  /** マイルストーン（任意）。 */
  milestone?: string;
  /** 身長 cm（任意）。 */
  heightCm?: number;
  /** 体重 kg（任意）。 */
  weightKg?: number;
  /** 作成日時（ISO8601）。 */
  createdAt: string;
  /** 更新日時（ISO8601）。 */
  updatedAt: string;
  /** 論理削除フラグ（true なら GET から除外）。永続用の内部フラグ。 */
  deleted?: boolean;
}

/** メディアメタの 1 件。 */
export interface MediaMeta {
  /** 一意 ID。 */
  id: string;
  /** 紐づく日付（YYYY-MM-DD）。 */
  date: string;
  /** disk 上の保存名（BABY_DIARY_MEDIA_DIR 配下のフラットなファイル名）。 */
  filename: string;
  /** アップロード時の元ファイル名。 */
  originalName: string;
  /** MIME タイプ。 */
  mime: string;
  /** 種別。 */
  kind: 'image' | 'video';
  /** バイトサイズ。 */
  size: number;
  /** ファイル内容の sha256（16進）。重複検出に使う（任意・既存データは未設定の場合あり）。 */
  hash?: string;
  /** 作成日時（ISO8601）。 */
  createdAt: string;
  /** 論理削除フラグ（true なら GET から除外）。永続用の内部フラグ。 */
  deleted?: boolean;
}

// ─── 汎用 JSONL ヘルパ（last-wins）─────────────────────────

/** JSONL を全走査して key ごとの最新レコードを返す（last-wins）。 */
function readAll<T>(file: string, keyOf: (rec: T) => string | undefined): Map<string, T> {
  const map = new Map<string, T>();
  if (!existsSync(file)) return map;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return map;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as T;
      const key = keyOf(rec);
      if (key) map.set(key, rec);
    } catch {
      // 壊れた行は無視。
    }
  }
  return map;
}

/** JSONL に 1 行追記する。ディレクトリが無ければ作成。 */
function appendRecord(file: string, rec: unknown): void {
  const dir = dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
}

// ─── 日記エントリ ─────────────────────────────────────────

/**
 * 日記エントリを date キーで upsert する。
 * 既存（削除済み含む）があれば createdAt を引き継ぎ、無ければ新規 createdAt を立てる。
 * 渡した memo/milestone/heightCm/weightKg をそのまま反映（undefined は省略＝未設定）。
 * updatedAt は常に now。保存後のエントリ（deleted フラグは除いた公開形）を返す。
 */
export function upsertEntry(input: {
  date: string;
  memo?: string;
  milestone?: string;
  heightCm?: number;
  weightKg?: number;
}): DiaryEntry {
  const now = new Date().toISOString();
  const existing = readAll<DiaryEntry>(BABY_DIARY_ENTRIES_FILE, (r) => r.date).get(input.date);
  const createdAt = existing?.createdAt ?? now;
  const rec: DiaryEntry = {
    date: input.date,
    ...(input.memo !== undefined ? { memo: input.memo } : {}),
    ...(input.milestone !== undefined ? { milestone: input.milestone } : {}),
    ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
    ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
    createdAt,
    updatedAt: now,
    // upsert は常に「生きている」状態にする（過去に削除済みでも再作成で復活）。
    deleted: false,
  };
  appendRecord(BABY_DIARY_ENTRIES_FILE, rec);
  return stripEntry(rec);
}

/** 指定 date のエントリを論理削除する（deleted:true を追記）。存在しなくても冪等に成功扱い。 */
export function deleteEntry(date: string): void {
  const existing = readAll<DiaryEntry>(BABY_DIARY_ENTRIES_FILE, (r) => r.date).get(date);
  const now = new Date().toISOString();
  // existing をベースに deleted を立てる。existing が無ければ最小レコード。
  const base: DiaryEntry = existing
    ? { ...existing }
    : { date, createdAt: now, updatedAt: now };
  base.date = date;
  base.deleted = true;
  base.updatedAt = now;
  appendRecord(BABY_DIARY_ENTRIES_FILE, base);
}

/** 生きている日記エントリを date 昇順で返す（deleted を除外、内部 deleted フラグも落とす）。 */
export function listEntries(): DiaryEntry[] {
  const map = readAll<DiaryEntry>(BABY_DIARY_ENTRIES_FILE, (r) => r.date);
  const out: DiaryEntry[] = [];
  for (const rec of map.values()) {
    if (rec.deleted) continue;
    out.push(stripEntry(rec));
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** 公開形（内部 deleted フラグを落とす）。 */
function stripEntry(rec: DiaryEntry): DiaryEntry {
  const { deleted: _deleted, ...pub } = rec;
  return pub;
}

// ─── メディアメタ ─────────────────────────────────────────

/** メディアメタを 1 件追記する。保存後の公開形を返す。 */
export function appendMedia(meta: MediaMeta): MediaMeta {
  const rec: MediaMeta = { ...meta, deleted: false };
  appendRecord(BABY_DIARY_MEDIA_FILE, rec);
  return stripMedia(rec);
}

/** 指定 id のメディアメタ（生きているもの）を返す。削除済み/不在は undefined。 */
export function getMedia(id: string): MediaMeta | undefined {
  const rec = readAll<MediaMeta>(BABY_DIARY_MEDIA_FILE, (r) => r.id).get(id);
  if (!rec || rec.deleted) return undefined;
  return stripMedia(rec);
}

/** 指定 id のメディアを論理削除する（deleted:true を追記）。存在しなければ false。 */
export function deleteMedia(id: string): boolean {
  const rec = readAll<MediaMeta>(BABY_DIARY_MEDIA_FILE, (r) => r.id).get(id);
  if (!rec || rec.deleted) return false;
  appendRecord(BABY_DIARY_MEDIA_FILE, { ...rec, deleted: true });
  return true;
}

/** 生きているメディアメタを date 昇順で返す（同 date 内は createdAt 昇順）。 */
export function listMedia(): MediaMeta[] {
  const map = readAll<MediaMeta>(BABY_DIARY_MEDIA_FILE, (r) => r.id);
  const out: MediaMeta[] = [];
  for (const rec of map.values()) {
    if (rec.deleted) continue;
    out.push(stripMedia(rec));
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return out;
}

/** 公開形（内部 deleted フラグを落とす）。 */
function stripMedia(rec: MediaMeta): MediaMeta {
  const { deleted: _deleted, ...pub } = rec;
  return pub;
}

/**
 * 生きているメディアの中に同一 hash が既に存在するか。
 * （アップロード時の重複自動スキップ判定に使う。空 hash は常に false。）
 */
export function hashExists(hash: string): boolean {
  if (!hash) return false;
  const map = readAll<MediaMeta>(BABY_DIARY_MEDIA_FILE, (r) => r.id);
  for (const rec of map.values()) {
    if (rec.deleted) continue;
    if (rec.hash === hash) return true;
  }
  return false;
}

// ─── 撮影日決定ロジック ───────────────────────────────────
// ファイル名から撮影日時を推定して JST の YYYY-MM-DD を返す。
//
// 優先順:
//   1) PXL_YYYYMMDD_HHMMSS … Google Pixel。タイムスタンプは UTC なので +9h して JST 日付に。
//   2) (IMG_|VID_)?YYYYMMDD_HHMMSS … Samsung 等。端末ローカル(≒JST)なので YYYYMMDD をそのまま採用。
//   3) いずれも妥当な日時にマッチしなければ fallbackDate（呼び出し側の従来の選択日）。
//
// PXL_ を最優先で判定するのは UTC→JST 換算が必要なため（2 のパターンにも YYYYMMDD_HHMMSS は含まれる）。

/** YYYY-MM-DD の素朴な妥当性（年範囲・月 1-12・日 1-31）。 */
function isPlausibleYmd(y: number, mo: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  if (y < 1970 || y > 2100) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

/** 時分秒の素朴な妥当性（0-23 / 0-59 / 0-59）。 */
function isPlausibleHms(h: number, mi: number, s: number): boolean {
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;
}

/** 2桁ゼロ埋め。 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const PXL_RE = /PXL_(\d{8})_(\d{6})/;
const GENERIC_DT_RE = /(?:IMG_|VID_)?(\d{8})_(\d{6})/;

/**
 * ファイル名から撮影日（JST の YYYY-MM-DD）を決定する。
 * 推定できない場合は fallbackDate を返す。
 */
export function decideMediaDate(originalName: string, fallbackDate: string): string {
  const name = originalName || '';

  // 1) PXL_（UTC）→ +9h で JST 日付。
  const pxl = PXL_RE.exec(name);
  if (pxl) {
    const ymd = pxl[1];
    const hms = pxl[2];
    const y = Number(ymd.slice(0, 4));
    const mo = Number(ymd.slice(4, 6));
    const d = Number(ymd.slice(6, 8));
    const h = Number(hms.slice(0, 2));
    const mi = Number(hms.slice(2, 4));
    const s = Number(hms.slice(4, 6));
    if (isPlausibleYmd(y, mo, d) && isPlausibleHms(h, mi, s)) {
      // UTC として解釈し +9h。Date の UTC 演算で日付繰り上がりを正しく扱う。
      const utc = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
      const jst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
      return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
    }
  }

  // 2) 端末ローカル(≒JST) の YYYYMMDD_HHMMSS → YYYYMMDD をそのまま。
  const gen = GENERIC_DT_RE.exec(name);
  if (gen) {
    const ymd = gen[1];
    const hms = gen[2];
    const y = Number(ymd.slice(0, 4));
    const mo = Number(ymd.slice(4, 6));
    const d = Number(ymd.slice(6, 8));
    const h = Number(hms.slice(0, 2));
    const mi = Number(hms.slice(2, 4));
    const s = Number(hms.slice(4, 6));
    if (isPlausibleYmd(y, mo, d) && isPlausibleHms(h, mi, s)) {
      return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    }
  }

  // 3) フォールバック（従来の選択日）。
  return fallbackDate;
}
