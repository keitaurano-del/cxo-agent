// deliverableMeta — 成果物（deliverables）のサイドカーメタデータ store（MC-238）。
//
// 実体はファイルなので、relpath をキーに { starred, tags[], color } を JSON 1 ファイル
// （DELIVERABLES_META_FILE = data/deliverables-meta.json）で保持する。
//
// 整合性が肝:
//  - rename(MC-227) / move(MC-228): キーを「正確に」移行する。フォルダの場合は配下の子キーも
//    まとめてプレフィックス置換で移行する（迷子・取り違えを出さない）。
//  - copy/複製(MC-235): メタも複製する（フォルダは配下も）。
//  - delete=ゴミ箱(MC-230): 退避バッチ ID 配下にメタを退避（_trash[trashId]）。
//    復元(restore)時に復元先パスへ再付与し、完全削除/パージ時に破棄する。
//
// 書き込みは read→mutate→atomic write（tmp→rename）で行う。relpath は呼び出し側で
// toDeliverableRelative 由来の安全な posix 相対パスを渡す前提（このファイルは FS 走査をしない）。

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DELIVERABLES_META_FILE } from '../config.js';

// ─── 型 ───────────────────────────────────────────────

/** 1 アイテム分のメタ。空（starred=false / tags=[] / color=null）はキーごと削除して store を肥大させない。 */
export interface DeliverableMeta {
  starred: boolean;
  tags: string[];
  color: string | null;
}

/** 退避中（ゴミ箱）メタ: trashId → { originalRel→meta } のスナップショット。 */
interface TrashMetaBatch {
  [originalRel: string]: DeliverableMeta;
}

interface MetaStore {
  /** relpath → meta（実在アイテム分）。 */
  items: Record<string, DeliverableMeta>;
  /** trashId → 退避メタ（復元用）。 */
  _trash: Record<string, TrashMetaBatch>;
}

// 色ラベルの許可値（UI と一致）。null は色なし。
export const ALLOWED_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;
export type DeliverableColor = (typeof ALLOWED_COLORS)[number];

// ─── 入出力 ───────────────────────────────────────────

function readStore(): MetaStore {
  try {
    if (!existsSync(DELIVERABLES_META_FILE)) return { items: {}, _trash: {} };
    const raw = JSON.parse(readFileSync(DELIVERABLES_META_FILE, 'utf-8')) as Partial<MetaStore>;
    return {
      items: isObject(raw.items) ? sanitizeItems(raw.items) : {},
      _trash: isObject(raw._trash) ? (raw._trash as Record<string, TrashMetaBatch>) : {},
    };
  } catch {
    return { items: {}, _trash: {} };
  }
}

function writeStore(store: MetaStore): void {
  try {
    mkdirSync(dirname(DELIVERABLES_META_FILE), { recursive: true });
    const tmp = `${DELIVERABLES_META_FILE}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(store, null, 0), 'utf-8');
    renameSync(tmp, DELIVERABLES_META_FILE);
  } catch {
    /* 書き込み失敗はメタ更新を諦める（本体操作は別途成功している）。 */
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 不正な形を弾いて正規化する（外部編集・破損耐性）。 */
function sanitizeItems(raw: Record<string, unknown>): Record<string, DeliverableMeta> {
  const out: Record<string, DeliverableMeta> = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = normalizeMeta(v);
    if (m && !isEmptyMeta(m)) out[k] = m;
  }
  return out;
}

/** 任意値を DeliverableMeta に正規化（不正は無視）。 */
export function normalizeMeta(v: unknown): DeliverableMeta | null {
  if (!isObject(v)) return null;
  const starred = v.starred === true;
  const tags = Array.isArray(v.tags)
    ? Array.from(
        new Set(
          v.tags
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim())
            .filter((t) => t.length > 0 && t.length <= 40),
        ),
      ).slice(0, 30)
    : [];
  const color =
    typeof v.color === 'string' && (ALLOWED_COLORS as readonly string[]).includes(v.color)
      ? v.color
      : null;
  return { starred, tags, color };
}

function isEmptyMeta(m: DeliverableMeta): boolean {
  return !m.starred && m.tags.length === 0 && m.color === null;
}

// ─── 公開 API ─────────────────────────────────────────

/** 全メタ（実在アイテム分のみ）を { relpath: meta } で返す。 */
export function getAllMeta(): Record<string, DeliverableMeta> {
  return readStore().items;
}

/** 1 アイテムのメタを設定する（空なら削除）。返り値は確定したメタ。 */
export function setMeta(relpath: string, input: unknown): DeliverableMeta {
  const store = readStore();
  const meta = normalizeMeta(input) ?? { starred: false, tags: [], color: null };
  if (isEmptyMeta(meta)) {
    delete store.items[relpath];
  } else {
    store.items[relpath] = meta;
  }
  writeStore(store);
  return meta;
}

// ─── キー追従（rename / move / copy / delete）──────────────────
//
// フォルダ操作では「そのキー自身」と「配下の子キー（'<old>/...'）」の両方を扱う。

/** old（ファイル or フォルダ）配下のキーを new へ移行する（rename / move 共通）。 */
export function moveMeta(oldRel: string, newRel: string): void {
  if (oldRel === newRel) return;
  const store = readStore();
  const prefix = oldRel + '/';
  const migrated: Record<string, DeliverableMeta> = {};
  for (const [k, v] of Object.entries(store.items)) {
    if (k === oldRel) {
      migrated[newRel] = v;
    } else if (k.startsWith(prefix)) {
      migrated[newRel + '/' + k.slice(prefix.length)] = v;
    } else {
      migrated[k] = v;
    }
  }
  store.items = migrated;
  writeStore(store);
}

/** src（ファイル or フォルダ）配下のメタを dest へ複製する（copy / 複製）。 */
export function copyMeta(srcRel: string, destRel: string): void {
  if (srcRel === destRel) return;
  const store = readStore();
  const prefix = srcRel + '/';
  // 既存 items のスナップショットを取ってから書き込む（イテレート中の追加を避ける）。
  const additions: Record<string, DeliverableMeta> = {};
  for (const [k, v] of Object.entries(store.items)) {
    if (k === srcRel) {
      additions[destRel] = { ...v, tags: [...v.tags] };
    } else if (k.startsWith(prefix)) {
      additions[destRel + '/' + k.slice(prefix.length)] = { ...v, tags: [...v.tags] };
    }
  }
  let changed = false;
  for (const [k, v] of Object.entries(additions)) {
    if (!isEmptyMeta(v)) {
      store.items[k] = v;
      changed = true;
    }
  }
  if (changed) writeStore(store);
}

/**
 * delete=ゴミ箱(MC-230): rel（ファイル or フォルダ）配下のメタを items から外し、
 * trashId 配下に退避する（復元時に再付与するため）。
 */
export function trashMeta(rel: string, trashId: string): void {
  const store = readStore();
  const prefix = rel + '/';
  const batch: TrashMetaBatch = {};
  const kept: Record<string, DeliverableMeta> = {};
  for (const [k, v] of Object.entries(store.items)) {
    if (k === rel) {
      batch[rel] = v;
    } else if (k.startsWith(prefix)) {
      batch[k] = v;
    } else {
      kept[k] = v;
    }
  }
  if (Object.keys(batch).length === 0) return; // 退避すべきメタが無ければ何もしない。
  store.items = kept;
  store._trash[trashId] = batch;
  writeStore(store);
}

/**
 * restore（ゴミ箱からの復元）: trashId に退避したメタを復元先パスへ再付与する。
 * 復元先が衝突回避でリネームされている場合に備え、originalRel→destRel のプレフィックス差し替えで戻す。
 * @param originalRel 退避時の元相対パス（trashMeta の rel と一致）。
 * @param destRel 実際に復元された相対パス（衝突回避サフィックス付きの可能性）。
 */
export function restoreMeta(trashId: string, originalRel: string, destRel: string): void {
  const store = readStore();
  const batch = store._trash[trashId];
  if (!batch) return;
  const prefix = originalRel + '/';
  for (const [k, v] of Object.entries(batch)) {
    let target: string;
    if (k === originalRel) target = destRel;
    else if (k.startsWith(prefix)) target = destRel + '/' + k.slice(prefix.length);
    else target = k; // 想定外（退避バッチに無関係キー）はそのまま。
    if (!isEmptyMeta(v)) store.items[target] = v;
  }
  delete store._trash[trashId];
  writeStore(store);
}

/** 完全削除/パージ時に退避メタを破棄する（trashId 指定 or 全 _trash）。 */
export function purgeTrashMeta(trashId?: string): void {
  const store = readStore();
  if (trashId) {
    if (!(trashId in store._trash)) return;
    delete store._trash[trashId];
  } else {
    if (Object.keys(store._trash).length === 0) return;
    store._trash = {};
  }
  writeStore(store);
}
