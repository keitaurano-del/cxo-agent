// devMockupStore — AI 生成 HTML モックアップの JSONL ストア（開発ページ）。
//
// データストア（data/ 配下・.gitignore 済み・ランタイムデータ）:
//   data/dev-mockups.jsonl : モックアップ（追記専用・last-wins by id・論理削除は deleted フラグ）
//
// babyDiaryStore.ts の last-wins パターンに倣う:
//   JSONL を全走査して id ごとの最新レコードを採用する。
//   論理削除は deleted:true のレコードを追記し、読み出し時に除外する。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import { DEV_MOCKUPS_FILE, INBOX_DATA_DIR } from '../config.js';

// ─── アイデア生成の👍/👎フィードバック（MC-479）───────────────────────
// 生成されたアイデア本文に対する Keita の評価を貯め、次回以降の生成プロンプトに
// 「良い例＝寄せる／悪い例＝避ける」として差し込み、アイデアの質を継続的に上げる。
const IDEA_FEEDBACK_FILE = join(INBOX_DATA_DIR, 'idea-feedback.json');
export interface IdeaFeedback {
  good: string[];
  bad: string[];
}
export function loadIdeaFeedback(): IdeaFeedback {
  try {
    const j = JSON.parse(readFileSync(IDEA_FEEDBACK_FILE, 'utf8')) as Partial<IdeaFeedback>;
    return { good: Array.isArray(j.good) ? j.good : [], bad: Array.isArray(j.bad) ? j.bad : [] };
  } catch {
    return { good: [], bad: [] };
  }
}
export function addIdeaFeedback(idea: string, rating: 'good' | 'bad'): IdeaFeedback {
  const fb = loadIdeaFeedback();
  const s = String(idea || '').trim().slice(0, 220);
  if (!s) return fb;
  const keep = (arr: string[]) => arr.filter((x) => x !== s);
  fb.good = keep(fb.good);
  fb.bad = keep(fb.bad);
  const arr = rating === 'good' ? fb.good : fb.bad;
  arr.unshift(s); // 新しい評価ほど強く効かせる
  if (arr.length > 15) arr.length = 15;
  try {
    mkdirSync(dirname(IDEA_FEEDBACK_FILE), { recursive: true });
    writeFileSync(IDEA_FEEDBACK_FILE, JSON.stringify(fb, null, 2));
  } catch {
    /* 保存失敗は握りつぶす（評価は次善で機能）*/
  }
  return fb;
}

/** 1 モックアップが保持する修正履歴（バージョン）の最大件数（超えたら古いものから切り詰める）。 */
const MOCKUP_VERSIONS_MAX = 30;

// ─── 型 ─────────────────────────────────────────────────

/** 修正履歴の 1 版（バージョン）。生成・修正・レビュー・復元のたびに現行 html を 1 版として積む。 */
export interface MockupVersion {
  /** 版の一意 ID。 */
  id: string;
  /** その時点の完全な HTML5 ドキュメント本文。 */
  html: string;
  /** 版のラベル（一覧に出す短い説明。「初回生成」「修正: 配色を青に」等）。 */
  label: string;
  /** この版がどの操作で生まれたか。generate=新規生成 / revise=修正 / review=デザイン昇格 / restore=復元。 */
  kind: 'generate' | 'revise' | 'review' | 'restore';
  /** その版時点の設計書（あれば）。 */
  designDoc?: string;
  /** 作成日時（ISO8601）。 */
  createdAt: string;
}

/** モックアップ 1 件。 */
export interface Mockup {
  /** 一意 ID。 */
  id: string;
  /** タイトル（一覧表示用）。 */
  title: string;
  /** 完全な HTML5 ドキュメント本文。 */
  html: string;
  /**
   * 修正履歴（バージョン。新しい順で末尾が最新。MC-260）。
   * 生成・修正・レビュー・復元のたびに現行 html を 1 版として push する。
   * 肥大防止に MOCKUP_VERSIONS_MAX 件で古いものから切り詰める。既存（versions 無し）でも壊れない任意項目。
   */
  versions?: MockupVersion[];
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
  /** Keita の評価（👍=up / 👎=down）。up は次の生成の「手本」に使う（MC-252 P3 フライホイール）。 */
  rating?: 'up' | 'down';
  /** 実装仕様書（Markdown）。モックから本番化するための設計（データモデル/バック要否/API等）。MC-253。 */
  implSpec?: string;
  /** コード学習（Markdown）。TS実装コード＋①始まり②各部の役割③ルールの構造化解説。発注者がコードを読めるようにする。MC-256。 */
  codeLesson?: string;
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
  /**
   * 修正履歴（バージョン）を積むか（MC-260）。生成完了・修正完了はここに指定して 1 版として記録する。
   * kind=版の種類、label=一覧に出す短い説明。手動の再保存（plain POST /mockups）では未指定＝積まない
   *（意図しない大量の版でノイズを作らない）。designDoc は指定が無ければ今回の input.designDoc を使う。
   */
  recordVersion?: { kind: MockupVersion['kind']; label: string; designDoc?: string };
}): Mockup {
  const now = new Date().toISOString();
  const map = readAll(DEV_MOCKUPS_FILE);
  const existing = input.id ? map.get(input.id) : undefined;
  const id = input.id && existing ? input.id : input.id ?? randomUUID();
  const createdAt = existing?.createdAt ?? now;
  // 修正履歴: 既存の版に、今回の html を 1 版として追記する（recordVersion 指定時のみ）。
  // 末尾が最新。MOCKUP_VERSIONS_MAX を超えたら古い先頭から切り詰める。
  const versions: MockupVersion[] = existing?.versions ? [...existing.versions] : [];
  if (input.recordVersion) {
    versions.push({
      id: randomUUID(),
      html: input.html,
      label: input.recordVersion.label,
      kind: input.recordVersion.kind,
      ...(input.recordVersion.designDoc !== undefined
        ? { designDoc: input.recordVersion.designDoc }
        : input.designDoc !== undefined
          ? { designDoc: input.designDoc }
          : {}),
      createdAt: now,
    });
    if (versions.length > MOCKUP_VERSIONS_MAX) versions.splice(0, versions.length - MOCKUP_VERSIONS_MAX);
  }
  const rec: Mockup = {
    id,
    title: input.title,
    html: input.html,
    ...(versions.length > 0 ? { versions } : {}),
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
    // 評価・実装仕様書は upsert では引き継ぐ（再保存・修正で消さない）。設定は専用関数で行う。
    ...(existing?.rating !== undefined ? { rating: existing.rating } : {}),
    ...(existing?.implSpec !== undefined ? { implSpec: existing.implSpec } : {}),
    ...(existing?.codeLesson !== undefined ? { codeLesson: existing.codeLesson } : {}),
    createdAt,
    updatedAt: now,
    // upsert は常に「生きている」状態にする（過去に削除済みでも復活）。
    deleted: false,
  };
  appendRecord(DEV_MOCKUPS_FILE, rec);
  return strip(rec);
}

/**
 * 評価（👍 up / 👎 down / 解除 null）を設定する。既存レコードを保ったまま rating だけ更新して追記する。
 * 存在しない id は何もしない。設定後の公開形を返す（無ければ undefined）。
 */
export function setRating(id: string, rating: 'up' | 'down' | null): Mockup | undefined {
  const existing = readAll(DEV_MOCKUPS_FILE).get(id);
  if (!existing || existing.deleted) return undefined;
  const rec: Mockup = { ...existing, updatedAt: new Date().toISOString() };
  if (rating === null) delete rec.rating;
  else rec.rating = rating;
  appendRecord(DEV_MOCKUPS_FILE, rec);
  return strip(rec);
}

/**
 * 「手本」に使う up 評価済みモックアップ（html 含む）を新しい順で最大 limit 件返す（MC-252 P3）。
 * 生成プロンプトに少数の good example として差し込み、モデルに良いデザインを真似させる。
 */
export function listReferenceMockups(limit = 2): Mockup[] {
  const map = readAll(DEV_MOCKUPS_FILE);
  const out: Mockup[] = [];
  for (const rec of map.values()) {
    if (rec.deleted || rec.rating !== 'up') continue;
    out.push(strip(rec));
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out.slice(0, limit);
}

/**
 * 実装仕様書（Markdown）を保存する（MC-253）。既存レコードを保ったまま implSpec だけ更新して追記する。
 * 存在しない id は undefined。設定後の公開形を返す。
 */
export function setImplSpec(id: string, implSpec: string): Mockup | undefined {
  const existing = readAll(DEV_MOCKUPS_FILE).get(id);
  if (!existing || existing.deleted) return undefined;
  const rec: Mockup = { ...existing, implSpec, updatedAt: new Date().toISOString() };
  appendRecord(DEV_MOCKUPS_FILE, rec);
  return strip(rec);
}

/**
 * コード学習（Markdown）を保存する（MC-256）。既存レコードを保ったまま codeLesson だけ更新して追記する。
 * 存在しない id は undefined。設定後の公開形を返す。
 */
export function setCodeLesson(id: string, codeLesson: string): Mockup | undefined {
  const existing = readAll(DEV_MOCKUPS_FILE).get(id);
  if (!existing || existing.deleted) return undefined;
  const rec: Mockup = { ...existing, codeLesson, updatedAt: new Date().toISOString() };
  appendRecord(DEV_MOCKUPS_FILE, rec);
  return strip(rec);
}

// ─── 修正履歴（バージョン）API（MC-260）───────────────────────

/** 版のサマリ（html を含めない・一覧表示用）。 */
export type MockupVersionSummary = Omit<MockupVersion, 'html'>;

/**
 * 指定 id の修正履歴（バージョン）を新しい順（末尾＝最新を先頭に）でサマリ（html 除く）で返す。
 * 存在しない/削除済み/versions 無しは空配列（後方互換：古いモックでも壊れない）。
 */
export function listVersions(id: string): MockupVersionSummary[] {
  const rec = readAll(DEV_MOCKUPS_FILE).get(id);
  if (!rec || rec.deleted || !rec.versions) return [];
  return rec.versions
    .map(({ html: _html, ...summary }) => summary)
    .reverse();
}

/** 指定 id・版 versionId の HTML（本文込み）を返す。無ければ undefined。 */
export function getVersion(id: string, versionId: string): MockupVersion | undefined {
  const rec = readAll(DEV_MOCKUPS_FILE).get(id);
  if (!rec || rec.deleted || !rec.versions) return undefined;
  return rec.versions.find((v) => v.id === versionId);
}

/**
 * 指定 id を版 versionId の HTML に復元する（restore）。復元自体も 1 版（kind='restore'）として記録する。
 * 存在しない id / 無い版は undefined。成功時は復元後の公開形（html 含む）を返す。
 */
export function restoreVersion(id: string, versionId: string): Mockup | undefined {
  const map = readAll(DEV_MOCKUPS_FILE);
  const existing = map.get(id);
  if (!existing || existing.deleted || !existing.versions) return undefined;
  const target = existing.versions.find((v) => v.id === versionId);
  if (!target) return undefined;
  // 復元先の HTML を現行 html にしつつ、その復元操作を新しい 1 版として積む（履歴を辿れるように）。
  return upsertMockup({
    id,
    title: existing.title,
    html: target.html,
    ...(target.designDoc !== undefined ? { designDoc: target.designDoc } : {}),
    recordVersion: { kind: 'restore', label: `復元: ${target.label}`, designDoc: target.designDoc },
  });
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
