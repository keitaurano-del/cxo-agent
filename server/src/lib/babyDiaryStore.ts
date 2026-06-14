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
