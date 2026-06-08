// 議事録テンプレート (.docx) を生成して deliverables/テンプレート/ に保存するスクリプト
// 実行: cd server && npx tsx src/scripts/generateMinutesTemplates.ts

import { exportMinutes } from '../lib/minutesExport.js';
import { MINUTES_TYPES } from '../lib/minutesPresets.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OUT_DIR = join(homedir(), 'projects/cxo-agent/data/deliverables/テンプレート');

mkdirSync(OUT_DIR, { recursive: true });

// ── テンプレート定義（各スタイルのプレースホルダー付き構造） ──────────────

const TEMPLATES = [
  {
    id: 'form',
    label: 'フォーム形式',
    format: 'docx' as const,
    content: `## 会議議事録

| 項目 | 内容 |
|------|------|
| 会議名 | （例：第1回 プロジェクト定例） |
| 開催日時 | （例：2025年6月1日 14:00〜15:00） |
| 開催場所 | （例：本社 3F 第一会議室） |
| 司会 | （氏名または「記載なし」） |
| 書記 | （氏名または「記載なし」） |
| 出席者 | （氏名・役職をカンマ区切り） |
| 欠席者 | （なし、または氏名） |

### 議題

1. （議題1）
2. （議題2）

### 議事内容

**【議題1】**

（討議内容）

**【議題2】**

（討議内容）

### 合意事項・決定事項

- （決定事項1）
- （決定事項2）

### アクションアイテム

| 担当 | 内容 | 期限 |
|------|------|------|
| （氏名） | （対応事項） | （期限） |

### 次回会議

| 日時 | 場所 |
|------|------|
| （未定） | （未定） |
`,
  },
  {
    id: 'label',
    label: 'ラベル形式',
    format: 'docx' as const,
    content: `**【標題】** （会議名と目的を1行で）

**【日時】** （開催日時）

**【場所】** （開催場所）

**【出席者】** （氏名（役職）をカンマ区切り）

**【議題】**
1. （議題1）
2. （議題2）

**【議決事項】**
- 議題1：（決定内容）
- 議題2：（決定内容）

**【議事】**
（各議題の審議内容・発言要旨を段落形式で）

**【所見】**
（特記事項・コメント。特になければ「特になし」）
`,
  },
  {
    id: 'report',
    label: 'レポート形式',
    format: 'docx' as const,
    content: `# 第○回 （会議名） 議事録

- 開催日：（日付）
- 時間：（開始〜終了）
- 開催場所：（場所）
- 出席者：（氏名リスト）

---

## 1. 前回議事録の確認

（前回からの積み残し・報告事項。特になければ「特になし」）

## 2. 報告事項

### （報告項目の小見出し）

（報告内容）

## 3. 議事

### 議題1：（タイトル）

（内容・討議・結論を文章体で記述）

### 議題2：（タイトル）

（内容・討議・結論を文章体で記述）

## 4. その他

（その他の共有事項。なければ「特になし」）

---

**次回会議予定**
- 日時：（未定）
- 場所：（未定）
`,
  },
  {
    id: 'action',
    label: 'アクション重視',
    format: 'docx' as const,
    content: `## アクションリスト

| No | アクション | 担当者 | 期限 | ステータス |
|----|-----------|--------|------|-----------|
| 1 | （やること） | （担当者） | （期限） | 未着手 |
| 2 | （やること） | （担当者） | （期限） | 未着手 |

## 決定事項

- （決定した事項1）
- （決定した事項2）

## 議論の要点

（主な議論の概要を簡潔に記述）
`,
  },
  {
    id: 'action_xlsx',
    label: 'アクション重視（Excel）',
    format: 'xlsx' as const,
    content: `## アクションリスト

| No | アクション | 担当者 | 期限 | ステータス |
|----|-----------|--------|------|-----------|
| 1 | （やること） | （担当者） | （期限） | 未着手 |
| 2 | （やること） | （担当者） | （期限） | 未着手 |

## 決定事項

- （決定した事項1）
- （決定した事項2）

## 議論の要点

（主な議論の概要を簡潔に記述）
`,
  },
  {
    id: 'summary',
    label: '要点サマリー',
    format: 'docx' as const,
    content: `## 会議サマリー（（日付））

### 結論・決定事項

- （決定した事項1）
- （決定した事項2）

### 主な議論ポイント

- （主な論点1）
- （主な論点2）

### ネクストアクション

- （担当者）：（やること）（期限）
`,
  },
  {
    id: 'casual',
    label: 'カジュアルメモ',
    format: 'docx' as const,
    content: `📅 （日付） （会議名）メモ

参加：（参加者を「・」区切りで）

今日の主な話
- （話したこと1）
- （話したこと2）

やること
- （担当者）：（やること） → （期限）

次回：（日時・場所）
`,
  },
  {
    id: 'exec2page',
    label: '実務2ページ',
    format: 'docx' as const,
    content: `## アクションアイテム（TODO）

| No | タスク | 担当 | 期限 | ステータス | 関連議題 |
|----|--------|------|------|-----------|---------|
| 1 | （やること） | （担当者） | （期限） | 未着手 | 議題1 |
| 2 | （やること） | （担当者） | （期限） | 未着手 | 議題2 |

## 決定事項

- （決定事項）（議題1）
- （決定事項）（議題2）

## 共有事項

- （共有・連絡事項）

<!-- pagebreak -->

## 議題別 主要発言

### 議題1：（議題タイトル）
アクション：#1 ／ 決定：（内容）

（発言者名と主な発言内容・議論の流れを段落形式で）

### 議題2：（議題タイトル）
アクション：#2 ／ 決定：（内容）

（発言者名と主な発言内容・議論の流れを段落形式で）
`,
  },
] as const;

// ── 生成実行 ──────────────────────────────────────────────────────

async function main() {
  const fileNameMap: Record<string, string> = {
    form:        '議事録テンプレート_フォーム形式.docx',
    label:       '議事録テンプレート_ラベル形式.docx',
    report:      '議事録テンプレート_レポート形式.docx',
    action:      '議事録テンプレート_アクション重視.docx',
    action_xlsx: '議事録テンプレート_アクション重視.xlsx',
    summary:     '議事録テンプレート_要点サマリー.docx',
    casual:      '議事録テンプレート_カジュアルメモ.docx',
    exec2page:   '議事録テンプレート_実務2ページ.docx',
  };

  // 標準（実務）テンプレート — minutesPresets の summary-standard と同一体裁を docx 化して
  // ドキュメント（deliverables/テンプレート/）に置く。添付議事録に忠実な標準フォーマット。
  const standardBody = MINUTES_TYPES.find((t) => t.type === 'summary')?.templates.find(
    (t) => t.id === 'summary-standard',
  )?.body;
  if (standardBody) {
    const fileName = '議事録テンプレート_標準（実務）.docx';
    console.log(`生成中: ${fileName}`);
    try {
      const { buffer } = await exportMinutes(standardBody, 'docx', '標準（実務）議事録テンプレート');
      writeFileSync(join(OUT_DIR, fileName), buffer);
      console.log(`  ✓ ${join(OUT_DIR, fileName)}`);
    } catch (e) {
      console.error('  ✗ 失敗:', e);
    }
  }

  for (const tmpl of TEMPLATES) {
    const fileName = fileNameMap[tmpl.id];
    const outPath = join(OUT_DIR, fileName);
    console.log(`生成中: ${fileName}`);
    try {
      const { buffer } = await exportMinutes(tmpl.content, tmpl.format, tmpl.label);
      writeFileSync(outPath, buffer);
      console.log(`  ✓ ${outPath}`);
    } catch (e) {
      console.error(`  ✗ 失敗:`, e);
    }
  }

  console.log('\n完了。古い .md テンプレートは手動で削除してください:');
  console.log(`  ${OUT_DIR}/議事録_*.md`);
}

main().catch(console.error);
