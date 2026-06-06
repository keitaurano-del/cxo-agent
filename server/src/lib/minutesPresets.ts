// 議事録の種類・形式・テンプレート・プロンプト構築を定義するライブラリ

// ----------------------------------------------------------------
// 型定義
// ----------------------------------------------------------------

export type MinutesType = 'verbatim' | 'summary' | 'decisions' | 'chronological';

export type MinutesFormat = 'markdown' | 'sections' | 'plain';

export interface MinutesTemplate {
  id: string;
  label: string;
  body: string;
}

export interface MinutesTypePreset {
  type: MinutesType;
  label: string;
  description: string;
  templates: MinutesTemplate[];
}

// ----------------------------------------------------------------
// 定数
// ----------------------------------------------------------------

export const MINUTES_TYPES: MinutesTypePreset[] = [
  {
    type: 'verbatim',
    label: '逐語録',
    description: 'フィラー語を整えつつ内容を全部残す。話者ラベルがあれば保持',
    templates: [
      {
        id: 'verbatim-formal',
        label: 'フォーマル',
        body: '# 逐語録\n\n**日時：** YYYY年MM月DD日（曜日）HH:mm〜HH:mm\n**場所：** 〇〇会議室 / オンライン\n**出席者：** 〇〇部 〇〇、△△部 △△\n**欠席者：** なし\n**議事録担当：** 〇〇\n\n---\n\n## 発言記録\n\n**〇〇（HH:mm）：** 本日はお集まりいただきありがとうございます。それでは議題に入ります。\n\n**△△（HH:mm）：** はい、よろしくお願いいたします。\n\n**〇〇（HH:mm）：** 〔議題の内容について詳細な発言が続く〕\n\n**△△（HH:mm）：** 〔返答・補足・質問などの発言が続く〕\n\n---\n\n## 配布資料\n\n- 資料1：〇〇について（〇〇部 提出）\n\n---\n*以上*\n',
      },
      {
        id: 'verbatim-casual',
        label: 'カジュアル',
        body: '# 〇〇 MTG 逐語録 — YYYY/MM/DD\n\n参加者：〇〇、△△\n\n---\n\n〇〇: よろしくお願いします。今日は〇〇の件を話しましょう。\n\n△△: はい。まず現状ですが、〔発言内容〕\n\n〇〇: なるほど。それだと〔発言内容〕\n\n△△: そうですね。〔発言内容〕\n\n---\n\n次回：〇/〇\n',
      },
      {
        id: 'verbatim-memo',
        label: 'メモ',
        body: '# 逐語メモ YYYY/MM/DD\n\n参加: 〇〇、△△\n\n〇〇: 〔発言〕\n△△: 〔発言〕\n〇〇: 〔発言〕\n△△: 〔発言〕\n',
      },
    ],
  },
  {
    type: 'summary',
    label: '要約議事録',
    description: '要点を圧縮した議事録',
    templates: [
      {
        id: 'summary-formal',
        label: 'フォーマル',
        body: '# 議事録\n\n**日時：** YYYY年MM月DD日（曜日）HH:mm〜HH:mm\n**場所：** 〇〇会議室 / オンライン\n**出席者：** 〇〇部 〇〇、△△部 △△\n**欠席者：** なし\n**議事録担当：** 〇〇\n\n---\n\n## 1. 議題\n\n1. 〇〇について\n2. △△について\n3. その他\n\n## 2. 審議・検討事項\n\n### 2-1. 〇〇について\n\n**概要：** 〔議題の背景と目的を簡潔に記述〕\n\n**議論の要点：**\n- 〔発言者〕より〔要点1〕が提案された。\n- 〔発言者〕より〔要点2〕について懸念が示された。\n- 〔要点3〕については引き続き検討することとなった。\n\n**結論・決定事項：** 〔合意内容を明記〕\n\n### 2-2. △△について\n\n**概要：** 〔議題の背景と目的を簡潔に記述〕\n\n**議論の要点：**\n- 〔要点1〕\n- 〔要点2〕\n\n**結論・決定事項：** 〔合意内容を明記〕\n\n## 3. 決定事項まとめ\n\n| No. | 決定事項 | 担当 | 期限 |\n|-----|---------|------|------|\n| 1   | 〔内容〕 | 〇〇 | 〇月〇日 |\n| 2   | 〔内容〕 | △△ | 〇月〇日 |\n\n## 4. アクションアイテム\n\n| No. | 内容 | 担当者 | 期限 | 状況 |\n|-----|------|--------|------|------|\n| 1   | 〔内容〕 | 〇〇 | 〇月〇日 | 未着手 |\n| 2   | 〔内容〕 | △△ | 〇月〇日 | 未着手 |\n\n## 5. 次回予定\n\n**次回日程：** YYYY年MM月DD日（曜日）HH:mm〜\n**議題（案）：** 〔次回の主な議題〕\n\n---\n*以上*\n',
      },
      {
        id: 'summary-casual',
        label: 'カジュアル',
        body: '# 〇〇 MTG — YYYY/MM/DD\n\n参加者：〇〇、△△\n\n## 話したこと\n\n- 〔話題1〕：〔要点〕\n- 〔話題2〕：〔要点〕\n- 〔話題3〕：〔要点〕\n\n## 決めたこと\n\n- 〔決定事項1〕\n- 〔決定事項2〕\n\n## やること\n\n- [ ] 〇〇 → 担当：〇〇（〇/〇まで）\n- [ ] △△ → 担当：△△（〇/〇まで）\n\n## 次回\n\n日程：〇/〇\n議題（案）：〔次回テーマ〕\n',
      },
      {
        id: 'summary-memo',
        label: 'メモ',
        body: '# 〇〇 YYYY/MM/DD\n\n参加: 〇〇、△△\n要点: 〔会議の主旨を1〜2文で〕\n決定: 〔決定事項を箇条書き〕\n次やること: 〇〇（担当）、△△（担当）\n次回: 〇/〇\n',
      },
    ],
  },
  {
    type: 'decisions',
    label: '決定事項・アクション',
    description: '決定事項・ToDo（担当・期限）を抽出',
    templates: [
      {
        id: 'decisions-formal',
        label: 'フォーマル',
        body: '# 決定事項・アクションアイテム一覧\n\n**日時：** YYYY年MM月DD日（曜日）HH:mm〜HH:mm\n**場所：** 〇〇会議室 / オンライン\n**出席者：** 〇〇部 〇〇、△△部 △△\n**欠席者：** なし\n**議事録担当：** 〇〇\n\n---\n\n## 1. 決定事項\n\n| No. | 議題 | 決定内容 | 決定者 | 備考 |\n|-----|------|---------|--------|------|\n| 1   | 〇〇について | 〔決定内容を明確に〕 | 〇〇部長 | 〔補足事項〕 |\n| 2   | △△について | 〔決定内容を明確に〕 | 全員合意 | 〔補足事項〕 |\n\n## 2. 保留・継続検討事項\n\n| No. | 内容 | 理由 | 次回対応予定 |\n|-----|------|------|-----------|\n| 1   | 〔内容〕 | 〔保留理由〕 | 〇月〇日 MTG にて再議 |\n\n## 3. アクションアイテム\n\n| No. | 内容 | 担当者 | 期限 | 優先度 | ステータス |\n|-----|------|--------|------|--------|----------|\n| 1   | 〔タスク内容〕 | 〇〇 | YYYY/MM/DD | 高 | 未着手 |\n| 2   | 〔タスク内容〕 | △△ | YYYY/MM/DD | 中 | 未着手 |\n| 3   | 〔タスク内容〕 | 〇〇 | YYYY/MM/DD | 低 | 未着手 |\n\n## 4. 次回確認事項\n\n- 〔次回 MTG で確認すべき事項〕\n- 〔アクションアイテムの進捗確認〕\n\n---\n*作成者：〇〇　作成日：YYYY年MM月DD日*\n',
      },
      {
        id: 'decisions-casual',
        label: 'カジュアル',
        body: '# 〇〇 MTG 決定事項 — YYYY/MM/DD\n\n参加者：〇〇、△△\n\n## 決めたこと\n\n- 〔決定事項1〕（〇〇さん提案、全員合意）\n- 〔決定事項2〕（次回 〇/〇 までに再確認）\n\n## 保留\n\n- 〔保留事項〕→ 理由：〔理由〕\n\n## やること\n\n- [ ] 〔タスク1〕 → 〇〇（〇/〇まで）🔴 高\n- [ ] 〔タスク2〕 → △△（〇/〇まで）🟡 中\n- [ ] 〔タスク3〕 → 〇〇（〇/〇まで）🟢 低\n',
      },
      {
        id: 'decisions-memo',
        label: 'メモ',
        body: '# 決定メモ YYYY/MM/DD\n\n決定:\n- 〔内容〕\n\nToDo:\n- 〇〇 → 担当: 〇〇 期限: 〇/〇\n- △△ → 担当: △△ 期限: 〇/〇\n\n保留: 〔あれば〕\n',
      },
    ],
  },
  {
    type: 'chronological',
    label: '時系列議事録',
    description: '議題ごとに時系列で整理',
    templates: [
      {
        id: 'chronological-formal',
        label: 'フォーマル',
        body: '# 時系列議事録\n\n**日時：** YYYY年MM月DD日（曜日）HH:mm〜HH:mm\n**場所：** 〇〇会議室 / オンライン\n**出席者：** 〇〇部 〇〇、△△部 △△\n**欠席者：** なし\n**議事録担当：** 〇〇\n\n---\n\n## 開会（HH:mm）\n\n〇〇より開会の挨拶。出席者確認および本日の議題を説明。\n\n## 議題1：〔議題名〕（HH:mm〜HH:mm）\n\n### 説明\n\n〔説明者〕より〔内容の説明〕が行われた。\n\n### 議論\n\n| 発言者 | 発言内容 |\n|--------|--------|\n| 〇〇   | 〔発言要旨〕 |\n| △△   | 〔発言要旨〕 |\n| 〇〇   | 〔発言要旨〕 |\n\n### 結論\n\n〔合意内容・決定事項を明記〕\n\n## 議題2：〔議題名〕（HH:mm〜HH:mm）\n\n### 説明\n\n〔説明者〕より〔内容の説明〕が行われた。\n\n### 議論\n\n| 発言者 | 発言内容 |\n|--------|--------|\n| 〇〇   | 〔発言要旨〕 |\n| △△   | 〔発言要旨〕 |\n\n### 結論\n\n〔合意内容・決定事項を明記〕\n\n## その他・連絡事項（HH:mm）\n\n- 〔連絡事項1〕\n- 次回日程：YYYY年MM月DD日（曜日）HH:mm〜\n\n## 閉会（HH:mm）\n\n〇〇より閉会の挨拶。\n\n---\n\n## アクションアイテム\n\n| No. | 内容 | 担当者 | 期限 | ステータス |\n|-----|------|--------|------|----------|\n| 1   | 〔内容〕 | 〇〇 | 〇月〇日 | 未着手 |\n| 2   | 〔内容〕 | △△ | 〇月〇日 | 未着手 |\n\n---\n*以上*\n',
      },
      {
        id: 'chronological-casual',
        label: 'カジュアル',
        body: '# 〇〇 MTG 時系列メモ — YYYY/MM/DD\n\n参加者：〇〇、△△\n\n---\n\n**HH:mm** 開始・雑談\n\n**HH:mm** 〔議題1〕の話\n- 〔ポイント1〕\n- 〔ポイント2〕\n- → 結論：〔決定内容〕\n\n**HH:mm** 〔議題2〕の話\n- 〔ポイント1〕\n- 〔ポイント2〕\n- → 結論：〔決定内容〕\n\n**HH:mm** やること確認・クローズ\n\n---\n\n## やること\n\n- [ ] 〔タスク〕 → 〇〇（〇/〇まで）\n- [ ] 〔タスク〕 → △△（〇/〇まで）\n\n次回：〇/〇\n',
      },
      {
        id: 'chronological-memo',
        label: 'メモ',
        body: '# 時系列メモ YYYY/MM/DD\n\n参加: 〇〇、△△\n\nHH:mm 〔議題1〕→ 結論: 〔内容〕\nHH:mm 〔議題2〕→ 結論: 〔内容〕\nHH:mm クローズ\n\nToDo: 〇〇（担当）、△△（担当）\n',
      },
    ],
  },
];

export const MINUTES_FORMATS: { format: MinutesFormat; label: string }[] = [
  { format: 'markdown', label: 'Markdown（構造化）' },
  { format: 'sections', label: '固定セクション（日時/参加者/議題/議論/決定事項/ToDo）' },
  { format: 'plain', label: 'プレーンテキスト' },
];

// ----------------------------------------------------------------
// 関数
// ----------------------------------------------------------------

/**
 * 指定の MinutesType に対応するプリセットを返す。
 * 見つからない場合は undefined を返す。
 */
export function getTypePreset(type: MinutesType): MinutesTypePreset | undefined {
  return MINUTES_TYPES.find((p) => p.type === type);
}

/**
 * 議事録生成プロンプトを組み立てて返す。
 *
 * @param params.inputText          文字起こし等の会議テキスト
 * @param params.type               議事録の種類
 * @param params.format             出力形式
 * @param params.templateBody       テンプレート本文（省略可）
 * @param params.customInstructions 追加指示（省略可）
 * @param params.outputFolder       出力先ディレクトリ（省略時は './artifacts/議事録'）
 * @returns                         Claude に渡すプロンプト文字列
 */
export function buildMinutesPrompt(params: {
  inputText: string;
  type: MinutesType;
  format: MinutesFormat;
  templateBody?: string;
  customInstructions?: string;
  outputFolder?: string;
}): string {
  const { inputText, type, format, templateBody, customInstructions, outputFolder } = params;
  const targetFolder = outputFolder ?? './artifacts/議事録';

  const typePreset = getTypePreset(type);

  // 種類別の指示文
  const typeInstruction: Record<MinutesType, string> = {
    verbatim:
      'フィラー語（えー、あのー等）を整えつつ、内容は全て残してください。話者ラベルがあれば保持してください。',
    summary: '要点を圧縮し、重要な議論と結論を簡潔にまとめてください。',
    decisions:
      '決定事項とアクションアイテム（担当者・期限）を中心に抽出してください。決定した事項と誰が何をいつまでにやるかを明確にしてください。',
    chronological:
      '議題ごとに時系列で整理し、各議題の議論内容と結論を順番に記録してください。',
  };

  // 形式別の指示文
  const formatInstruction: Record<MinutesFormat, string> = {
    markdown: 'Markdown 形式（見出し・リスト・表を活用した構造化）で出力してください。',
    sections:
      '以下の固定セクションを必ず含めて出力してください: 日時, 参加者, 議題, 議論, 決定事項, ToDo（担当・期限付き）',
    plain: 'プレーンテキスト形式（Markdown 記法なし）で出力してください。',
  };

  const lines: string[] = [
    'あなたは議事録作成の専門家です。',
    '以下の会議テキストから議事録を作成してください。',
    '文章は中立的な丁寧体（です・ます）で書いてください。',
    '',
    `## 議事録の種類: ${typePreset?.label ?? type}`,
    typeInstruction[type],
    '',
    '## 出力形式',
    formatInstruction[format],
  ];

  if (templateBody) {
    lines.push('');
    lines.push('## テンプレート（骨格として活用してください）');
    lines.push(templateBody);
  }

  if (customInstructions) {
    lines.push('');
    lines.push('## 追加指示');
    lines.push(customInstructions);
  }

  lines.push('## 会議テキスト');
  lines.push(inputText);
  lines.push('');
  lines.push('---');
  lines.push('上記の会議テキストをもとに、指定の種類・形式で議事録を作成してください。');
  lines.push(
    `議事録は ${targetFolder} ディレクトリに保存し、ファイル名を「議事録_YYYYMMDD.md」形式にしてください（日付は会議日またはテキストから読み取れる日付、不明なら今日の日付）。`,
  );
  lines.push('最後に「作成: <ファイル名>」の形式で 1 行で報告してください。');

  return lines.join('\n');
}
