// keitaActions — docs/keita-actions.md（Keita操作キュー）のパーサ（MC-358 P4 層2/層4）。
//
// 正本は docs/keita-actions.md（チェックボックス消し込み式・Son が棚卸しで更新）。
// ここでは「## 未完」セクション配下の `### n. タイトル` ブロックだけを items に変換し、
// Apollo ボードの「⏱ Keita今日の2分」カードに表示できる形で返す。
//   { section: "1. GSC 再同意（…）【MC-351/347】", body: "手順本文(markdown)", checks: [{label, done}] }
// チェック行（`- [ ] …` / `- [x] …`）は body から除去して checks へ分離する（UI で別描画するため）。
// 書き込み（MC-358 続き・2026-08-02 Keita「キューになってるところも完了できるように」）:
//   setKeitaCheck(section, label, done)  … チェックボックス 1 つを切替
//   completeKeitaAction(section)         … ブロック全体を「## 完了ログ」へ移して未完から消す
// どちらも成功時に keita-actions.md だけを git commit する（🔒[Keita]・status-lock と同じ流儀）。
// パスは CXO_ROOT/docs/keita-actions.md 固定でトラバーサル無し。ファイル無しは items:[] で 200。

import { execSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CXO_ROOT } from '../config.js';

export interface KeitaActionCheck {
  label: string;
  done: boolean;
}

export interface KeitaActionItem {
  /** `### ` 見出しのテキスト（例: "1. GSC 再同意（2分・スマホ可）【MC-351/347】"）。 */
  section: string;
  /** 見出し配下の手順本文（markdown・チェック行は除去済み）。 */
  body: string;
  /** ブロック内のチェックボックス（`- [ ]` 未完 / `- [x]` 済）。 */
  checks: KeitaActionCheck[];
}

export interface KeitaActionsResponse {
  items: KeitaActionItem[];
  /** ファイルの mtime（ISO）。ファイル無しは null。 */
  updatedAt: string | null;
}

const CHECK_RE = /^\s*-\s*\[([ xX])\]\s*(.*)$/;

/** markdown 全文 → 「## 未完」配下の `### ` ブロック配列。純関数（ユニット検証用に分離）。 */
export function parseKeitaActions(md: string): KeitaActionItem[] {
  const lines = md.split(/\r?\n/);

  // 「## 未完」〜次の `## ` 見出し（完了ログ等）までを対象範囲にする。
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (start === -1) {
      if (/^##\s+未完/.test(line)) start = i + 1;
      continue;
    }
    if (/^##\s+/.test(line)) {
      end = i;
      break;
    }
  }
  if (start === -1) return [];

  const items: KeitaActionItem[] = [];
  let current: { section: string; bodyLines: string[]; checks: KeitaActionCheck[] } | null = null;

  const flush = () => {
    if (!current) return;
    // 末尾の区切り線・空行を落として body を整える。
    const bodyLines = [...current.bodyLines];
    while (bodyLines.length > 0) {
      const last = bodyLines[bodyLines.length - 1].trim();
      if (last === '' || last === '---') bodyLines.pop();
      else break;
    }
    items.push({
      section: current.section,
      body: bodyLines.join('\n').trim(),
      checks: current.checks,
    });
    current = null;
  };

  for (let i = start; i < end; i++) {
    const line = lines[i];
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      current = { section: heading[1].trim(), bodyLines: [], checks: [] };
      continue;
    }
    if (!current) continue; // 見出し前の前置きは無視（未完ブロックのみ拾う）。
    const check = CHECK_RE.exec(line);
    if (check) {
      current.checks.push({ label: check[2].trim(), done: check[1] !== ' ' });
      continue;
    }
    current.bodyLines.push(line);
  }
  flush();
  return items;
}

/** 正本ファイルを読んで API レスポンス形に。ファイル無し・読取失敗は items:[]（安全側）。 */
export function collectKeitaActions(): KeitaActionsResponse {
  const path = join(CXO_ROOT, 'docs', 'keita-actions.md');
  try {
    const md = readFileSync(path, 'utf-8');
    const mtime = statSync(path).mtime.toISOString();
    return { items: parseKeitaActions(md), updatedAt: mtime };
  } catch {
    return { items: [], updatedAt: null };
  }
}

// ── 書き込み（ボードからの消し込み）──────────────────────────

export class KeitaActionsWriteError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'IO_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'KeitaActionsWriteError';
  }
}

const FILE_PATH = () => join(CXO_ROOT, 'docs', 'keita-actions.md');

/** 「## 未完」配下で `### <section>` ブロックの行範囲 [start, end) を返す（見出し行含む）。 */
function findSectionRange(lines: string[], section: string): { start: number; end: number } {
  let inPending = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+未完/.test(line)) {
      inPending = true;
      continue;
    }
    if (inPending && /^##\s+/.test(line)) {
      // 未完セクションを抜けた。ブロックが開いていればここで閉じる。
      if (start !== -1) return { start, end: i };
      break;
    }
    if (!inPending) continue;
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      if (start !== -1) return { start, end: i }; // 次の ### で閉じる
      if (heading[1].trim() === section) start = i;
    }
  }
  if (start !== -1) return { start, end: lines.length };
  throw new KeitaActionsWriteError('NOT_FOUND', `未完に該当項目がありません: ${section}`);
}

/** 変更を書き込み、keita-actions.md 単体を git commit（🔒[Keita]）。commit 失敗はファイル反映済みなので握って続行。 */
function writeAndCommit(lines: string[], commitMsg: string): void {
  const path = FILE_PATH();
  try {
    writeFileSync(path, lines.join('\n'), 'utf-8');
  } catch (e) {
    throw new KeitaActionsWriteError(
      'IO_FAILED',
      `書き込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    execSync(`git add ${path}`, { cwd: CXO_ROOT });
    execSync(`git commit -m "${commitMsg}"`, { cwd: CXO_ROOT, encoding: 'utf-8' });
  } catch {
    // 共有ツリーで index 競合等の可能性。正本ファイルは更新済みなので API は成功扱い
    // （Son の夜次棚卸しコミットで回収される）。
  }
}

/** チェックボックス 1 つを切替。section=見出しテキスト・label=チェック行のラベル完全一致。 */
export function setKeitaCheck(section: string, label: string, done: boolean): KeitaActionsResponse {
  const md = readFileSync(FILE_PATH(), 'utf-8');
  const lines = md.split(/\r?\n/);
  const { start, end } = findSectionRange(lines, section);
  let hit = false;
  for (let i = start; i < end; i++) {
    const m = CHECK_RE.exec(lines[i]);
    if (m && m[2].trim() === label) {
      lines[i] = lines[i].replace(/\[([ xX])\]/, done ? '[x]' : '[ ]');
      hit = true;
      break;
    }
  }
  if (!hit) throw new KeitaActionsWriteError('NOT_FOUND', `チェック項目がありません: ${label}`);
  writeAndCommit(lines, `[MC-358] Keita がボードから操作キューをチェック 🔒`);
  return collectKeitaActions();
}

/** ブロック全体を未完から削除し、「## 完了ログ」先頭へ 1 行で追記する。 */
export function completeKeitaAction(section: string): KeitaActionsResponse {
  const md = readFileSync(FILE_PATH(), 'utf-8');
  const lines = md.split(/\r?\n/);
  const { start, end } = findSectionRange(lines, section);
  lines.splice(start, end - start);

  // 完了ログ見出しの直後（空行を挟んで）に追記。見出しが無ければ末尾に新設。
  const today = new Date().toISOString().slice(0, 10);
  const logLine = `- ${today} ${section} → ボードから完了 🔒[Keita]`;
  const logIdx = lines.findIndex((l) => /^##\s+完了ログ/.test(l));
  if (logIdx === -1) {
    lines.push('', '## 完了ログ', '', logLine);
  } else {
    let insert = logIdx + 1;
    while (insert < lines.length && lines[insert].trim() === '') insert++;
    lines.splice(insert, 0, logLine);
  }
  writeAndCommit(lines, `[MC-358] Keita がボードから操作キュー消し込み 🔒`);
  return collectKeitaActions();
}
