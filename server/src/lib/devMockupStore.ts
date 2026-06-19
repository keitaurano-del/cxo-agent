// devMockupStore — AI 生成 HTML モックアップの JSONL ストア（開発ページ）。
//
// データストア（data/ 配下・.gitignore 済み・ランタイムデータ）:
//   data/dev-mockups.jsonl : モックアップ（追記専用・last-wins by id・論理削除は deleted フラグ）
//
// babyDiaryStore.ts の last-wins パターンに倣う:
//   JSONL を全走査して id ごとの最新レコードを採用する。
//   論理削除は deleted:true のレコードを追記し、読み出し時に除外する。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import { DEV_MOCKUPS_FILE } from '../config.js';

// ─── 型 ─────────────────────────────────────────────────

/** モックアップ 1 件。 */
export interface Mockup {
  /** 一意 ID。 */
  id: string;
  /** タイトル（一覧表示用）。 */
  title: string;
  /** 完全な HTML5 ドキュメント本文。 */
  html: string;
  /** 生成に使ったプロンプト（任意）。 */
  prompt?: string;
  /** 設計書（作り方）。4段フローの設計ステージが生成（任意）。Backlog で「何を作ったか」を示す。 */
  designDoc?: string;
  /** Figma ワイヤーフレームファイルの URL（任意）。 */
  figmaFileUrl?: string;
  /** ワイヤーフレーム画像の保存ディレクトリ名（= 生成時の jobId）。画像配信のキー（任意）。 */
  wireframeDir?: string;
  /** 各画面のワイヤーフレーム（名前＋保存済み画像ファイル名）（任意）。 */
  wireframeScreens?: { name: string; image?: string }[];
  /** 作成日時（ISO8601）。 */
  createdAt: string;
  /** 更新日時（ISO8601）。 */
  updatedAt: string;
  /** 論理削除フラグ（true なら一覧/取得から除外）。永続用の内部フラグ。 */
  deleted?: boolean;
}

/** 一覧用の軽量サマリ（html を含めない）。 */
export type MockupSummary = Omit<Mockup, 'html' | 'deleted'>;

// ─── 汎用 JSONL ヘルパ（last-wins）─────────────────────────

/** JSONL を全走査して id ごとの最新レコードを返す（last-wins）。 */
function readAll(file: string): Map<string, Mockup> {
  const map = new Map<string, Mockup>();
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
      const rec = JSON.parse(line) as Mockup;
      if (rec && typeof rec.id === 'string' && rec.id) map.set(rec.id, rec);
    } catch {
      // 壊れた行は無視。
    }
  }
  return map;
}

/** JSONL に 1 行追記する。ディレクトリが無ければ作成。 */
function appendRecord(file: string, rec: Mockup): void {
  const dir = dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
}

/** 公開形（内部 deleted フラグを落とす）。 */
function strip(rec: Mockup): Mockup {
  const { deleted: _deleted, ...pub } = rec;
  return pub;
}

// ─── 公開 API ───────────────────────────────────────────

/** 生きているモックアップを updatedAt 降順（新しい順）でサマリ（html 除く）で返す。 */
export function listMockups(): MockupSummary[] {
  const map = readAll(DEV_MOCKUPS_FILE);
  const out: MockupSummary[] = [];
  for (const rec of map.values()) {
    if (rec.deleted) continue;
    const { html: _html, deleted: _deleted, ...summary } = rec;
    out.push(summary);
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** 指定 id のモックアップ（生きているもの・html 含む）を返す。削除済み/不在は undefined。 */
export function getMockup(id: string): Mockup | undefined {
  const rec = readAll(DEV_MOCKUPS_FILE).get(id);
  if (!rec || rec.deleted) return undefined;
  return strip(rec);
}

/**
 * モックアップを upsert する。
 * id があれば既存（削除済み含む）の createdAt を引き継ぎ、無ければ新規 id + createdAt を立てる。
 * updatedAt は常に now。保存後の公開形（html 含む）を返す。
 */
export function upsertMockup(input: {
  id?: string;
  title: string;
  html: string;
  prompt?: string;
  designDoc?: string;
  figmaFileUrl?: string;
  wireframeDir?: string;
  wireframeScreens?: { name: string; image?: string }[];
}): Mockup {
  const now = new Date().toISOString();
  const map = readAll(DEV_MOCKUPS_FILE);
  const existing = input.id ? map.get(input.id) : undefined;
  const id = input.id && existing ? input.id : input.id ?? randomUUID();
  const createdAt = existing?.createdAt ?? now;
  const rec: Mockup = {
    id,
    title: input.title,
    html: input.html,
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    // 設計・ワイヤーフレーム系は与えられた時だけ載せる。修正(revise)時は引き継ぎたいので
    // 入力が無ければ既存値を温存する（上書きで消さない）。
    ...(input.designDoc !== undefined
      ? { designDoc: input.designDoc }
      : existing?.designDoc !== undefined
        ? { designDoc: existing.designDoc }
        : {}),
    ...(input.figmaFileUrl !== undefined
      ? { figmaFileUrl: input.figmaFileUrl }
      : existing?.figmaFileUrl !== undefined
        ? { figmaFileUrl: existing.figmaFileUrl }
        : {}),
    ...(input.wireframeDir !== undefined
      ? { wireframeDir: input.wireframeDir }
      : existing?.wireframeDir !== undefined
        ? { wireframeDir: existing.wireframeDir }
        : {}),
    ...(input.wireframeScreens !== undefined
      ? { wireframeScreens: input.wireframeScreens }
      : existing?.wireframeScreens !== undefined
        ? { wireframeScreens: existing.wireframeScreens }
        : {}),
    createdAt,
    updatedAt: now,
    // upsert は常に「生きている」状態にする（過去に削除済みでも復活）。
    deleted: false,
  };
  appendRecord(DEV_MOCKUPS_FILE, rec);
  return strip(rec);
}

/** 指定 id のモックアップを論理削除する（deleted:true を追記）。存在しなくても冪等に成功扱い。 */
export function deleteMockup(id: string): void {
  const existing = readAll(DEV_MOCKUPS_FILE).get(id);
  const now = new Date().toISOString();
  const base: Mockup = existing
    ? { ...existing }
    : { id, title: '', html: '', createdAt: now, updatedAt: now };
  base.id = id;
  base.deleted = true;
  base.updatedAt = now;
  appendRecord(DEV_MOCKUPS_FILE, base);
}
