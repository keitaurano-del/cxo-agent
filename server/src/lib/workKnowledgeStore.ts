// workKnowledgeStore — 仕事ナレッジ（ECL/PMO 案件で蓄積する体系ナレッジ）の永続ストア（MC-260）。
//
// 正本は追記専用 JSONL（data/work-knowledge.jsonl）。chat store の「追記＋畳み込み」流儀に倣い、
// イベント方式で永続化する:
//   - create 行: { type:'create', entry: KnowledgeEntry, ts }
//   - update 行: { type:'update', id, patch, ts }  ← 同 id の last-wins でパッチを上書き適用
//   - delete 行: { type:'delete', id, ts }          ← トムストーン。読み出し時に当該 id を畳んで除外
// 読み出し時に時系列で畳み込み、create された entry に update を順に適用し、delete された id は除外する。
//
// 型 KnowledgeEntry = { id, title, category, tags, body, source, createdAt, updatedAt }。
// id は randomUUID、createdAt/updatedAt は ISO 文字列（new Date().toISOString()）。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import { WORK_KNOWLEDGE_FILE } from '../config.js';

// ─── カテゴリ既定リスト（共有定数）──────────────────────────────────────
// チャット・ナレッジ・体系化プロンプトで共有する。リスト外のカテゴリは 'その他' に寄せる。
export const KNOWLEDGE_CATEGORIES = [
  'ECL/会計基準',
  'システム実装',
  '与信管理',
  '銀行業務',
  'データベース',
  'PMO',
  'その他',
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

/** category がリスト外なら 'その他' に正規化する。 */
export function normalizeCategory(category: unknown): KnowledgeCategory {
  if (typeof category === 'string' && (KNOWLEDGE_CATEGORIES as readonly string[]).includes(category)) {
    return category as KnowledgeCategory;
  }
  return 'その他';
}

// ─── 型 ─────────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: KnowledgeCategory;
  tags: string[];
  body: string;
  /** 出所。'manual'=手入力 / 'ai'=AI 体系化ドラフトから保存。 */
  source: 'manual' | 'ai';
  createdAt: string;
  updatedAt: string;
}

/** 新規作成の入力（id/日時/source はストアが補う）。 */
export interface CreateEntryInput {
  title: string;
  category?: string;
  tags?: string[];
  body: string;
  source?: 'manual' | 'ai';
}

/** 更新パッチ（指定したフィールドのみ上書き）。 */
export interface UpdateEntryPatch {
  title?: string;
  category?: string;
  tags?: string[];
  body?: string;
}

// ─── 入力ガード（過大入力抑止）──────────────────────────────────────
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 40000;
const MAX_TAG_CHARS = 40;
const MAX_TAGS = 12;

/** タグ入力を「トリム済み・空除外・重複除外・上限件数/長さ」の文字列配列に正規化する。 */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const s = t.trim().slice(0, MAX_TAG_CHARS);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// ─── 永続レコード（JSONL の 1 行）──────────────────────────────────────
interface CreateRecord {
  type: 'create';
  entry: KnowledgeEntry;
  ts: string;
}
interface UpdateRecord {
  type: 'update';
  id: string;
  patch: Partial<Pick<KnowledgeEntry, 'title' | 'category' | 'tags' | 'body'>>;
  updatedAt: string;
  ts: string;
}
interface DeleteRecord {
  type: 'delete';
  id: string;
  ts: string;
}
type KnowledgeRecord = CreateRecord | UpdateRecord | DeleteRecord;

// ─── 低レベル I/O ────────────────────────────────────────

/** JSONL を全走査してレコード配列を返す（追記順＝時系列）。壊れた行は無視。 */
function readAll(): KnowledgeRecord[] {
  if (!existsSync(WORK_KNOWLEDGE_FILE)) return [];
  let raw: string;
  try {
    raw = readFileSync(WORK_KNOWLEDGE_FILE, 'utf-8');
  } catch {
    return [];
  }
  const out: KnowledgeRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as KnowledgeRecord;
      if (rec && (rec.type === 'create' || rec.type === 'update' || rec.type === 'delete')) {
        out.push(rec);
      }
    } catch {
      // 壊れた行は無視。
    }
  }
  return out;
}

/** JSONL に 1 行追記する。ディレクトリが無ければ作成。 */
function appendRecord(rec: KnowledgeRecord): void {
  const dir = dirname(WORK_KNOWLEDGE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(WORK_KNOWLEDGE_FILE, JSON.stringify(rec) + '\n', 'utf-8');
}

/**
 * 追記イベントを時系列で畳み込んで、現在生きているエントリの Map（id → entry）を作る。
 * create で登録 → update を last-wins で適用 → delete された id は除外。
 */
function foldEntries(): Map<string, KnowledgeEntry> {
  const byId = new Map<string, KnowledgeEntry>();
  for (const rec of readAll()) {
    if (rec.type === 'create') {
      byId.set(rec.entry.id, rec.entry);
    } else if (rec.type === 'update') {
      const cur = byId.get(rec.id);
      if (!cur) continue; // create 前 / delete 後の孤児 update は無視。
      const next: KnowledgeEntry = { ...cur };
      if (typeof rec.patch.title === 'string') next.title = rec.patch.title;
      if (typeof rec.patch.category === 'string') next.category = normalizeCategory(rec.patch.category);
      if (Array.isArray(rec.patch.tags)) next.tags = rec.patch.tags;
      if (typeof rec.patch.body === 'string') next.body = rec.patch.body;
      next.updatedAt = rec.updatedAt;
      byId.set(rec.id, next);
    } else if (rec.type === 'delete') {
      byId.delete(rec.id);
    }
  }
  return byId;
}

// ─── 公開 API ────────────────────────────────────────────

/** 生きているナレッジを updatedAt 降順で返す。 */
export function listEntries(): KnowledgeEntry[] {
  return [...foldEntries().values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * ナレッジを 1 件作成する。title/body は必須・トリム＋長さ上限。category はリスト外なら 'その他'。
 * tags は正規化。source 未指定は 'manual'。作成した entry を返す。null は呼び出し側でバリデーション。
 */
export function createEntry(input: CreateEntryInput): KnowledgeEntry {
  const now = new Date().toISOString();
  const entry: KnowledgeEntry = {
    id: randomUUID(),
    title: String(input.title ?? '').trim().slice(0, MAX_TITLE_CHARS),
    category: normalizeCategory(input.category),
    tags: normalizeTags(input.tags),
    body: String(input.body ?? '').trim().slice(0, MAX_BODY_CHARS),
    source: input.source === 'ai' ? 'ai' : 'manual',
    createdAt: now,
    updatedAt: now,
  };
  appendRecord({ type: 'create', entry, ts: now });
  return entry;
}

/**
 * ナレッジを更新する（指定フィールドのみ）。対象が無ければ null。
 * title/body はトリム＋長さ上限、category は正規化、tags は正規化して適用する。
 */
export function updateEntry(id: string, patch: UpdateEntryPatch): KnowledgeEntry | null {
  const cur = foldEntries().get(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  const applied: UpdateRecord['patch'] = {};
  if (typeof patch.title === 'string') applied.title = patch.title.trim().slice(0, MAX_TITLE_CHARS);
  if (typeof patch.category === 'string') applied.category = normalizeCategory(patch.category);
  if (Array.isArray(patch.tags)) applied.tags = normalizeTags(patch.tags);
  if (typeof patch.body === 'string') applied.body = patch.body.trim().slice(0, MAX_BODY_CHARS);
  appendRecord({ type: 'update', id, patch: applied, updatedAt: now, ts: now });
  // 畳み込み結果と同じ計算をローカルで再現して返す。
  const next: KnowledgeEntry = { ...cur };
  if (typeof applied.title === 'string') next.title = applied.title;
  if (typeof applied.category === 'string') next.category = applied.category as KnowledgeCategory;
  if (Array.isArray(applied.tags)) next.tags = applied.tags;
  if (typeof applied.body === 'string') next.body = applied.body;
  next.updatedAt = now;
  return next;
}

/** ナレッジを削除する（トムストーン行を追記）。存在有無に関わらず冪等に ok。 */
export function deleteEntry(id: string): void {
  appendRecord({ type: 'delete', id, ts: new Date().toISOString() });
}
