// keitaActions — docs/keita-actions.md（Keita操作キュー）のパーサ（MC-358 P4 層2/層4）。
//
// 正本は docs/keita-actions.md（チェックボックス消し込み式・Son が棚卸しで更新）。
// ここでは「## 未完」セクション配下の `### n. タイトル` ブロックだけを items に変換し、
// Apollo ボードの「⏱ Keita今日の2分」カードに表示できる形で返す。
//   { section: "1. GSC 再同意（…）【MC-351/347】", body: "手順本文(markdown)", checks: [{label, done}] }
// チェック行（`- [ ] …` / `- [x] …`）は body から除去して checks へ分離する（UI で別描画するため）。
// 書き込み API は無し（消し込みは Son がファイル側で実施する運用）。
// パスは CXO_ROOT/docs/keita-actions.md 固定でトラバーサル無し。ファイル無しは items:[] で 200。

import { readFileSync, statSync } from 'node:fs';
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
