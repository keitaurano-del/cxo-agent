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
        id: 'verbatim-default',
        label: '標準',
        body: '# 逐語録\n\n## 会議情報\n- 日時: \n- 場所: \n- 参加者: \n\n## 記録\n',
      },
    ],
  },
  {
    type: 'summary',
    label: '要約議事録',
    description: '要点を圧縮した議事録',
    templates: [
      {
        id: 'summary-default',
        label: '標準',
        body: '# 議事録（要約）\n\n## 会議情報\n- 日時: \n- 参加者: \n\n## 要点\n\n## 主な議論\n\n## 結論\n',
      },
    ],
  },
  {
    type: 'decisions',
    label: '決定事項・アクション',
    description: '決定事項・ToDo（担当・期限）を抽出',
    templates: [
      {
        id: 'decisions-default',
        label: '標準',
        body: '# 決定事項・アクションアイテム\n\n## 会議情報\n- 日時: \n- 参加者: \n\n## 決定事項\n\n| 項目 | 内容 | 備考 |\n|------|------|------|\n\n## アクションアイテム\n\n| No. | 内容 | 担当 | 期限 | ステータス |\n|-----|------|------|------|----------|\n',
      },
    ],
  },
  {
    type: 'chronological',
    label: '時系列議事録',
    description: '議題ごとに時系列で整理',
    templates: [
      {
        id: 'chronological-default',
        label: '標準',
        body: '# 時系列議事録\n\n## 会議情報\n- 日時: \n- 参加者: \n\n## 議題と経緯\n\n### [時刻] [議題名]\n\n#### 議論\n\n#### 結論\n',
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
 * @returns                         Claude に渡すプロンプト文字列
 */
export function buildMinutesPrompt(params: {
  inputText: string;
  type: MinutesType;
  format: MinutesFormat;
  templateBody?: string;
  customInstructions?: string;
}): string {
  const { inputText, type, format, templateBody, customInstructions } = params;

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
    '議事録は ./artifacts/ ディレクトリに保存し、ファイル名を「議事録_YYYYMMDD.md」形式にしてください（日付は会議日またはテキストから読み取れる日付、不明なら今日の日付）。',
  );
  lines.push('最後に「作成: <ファイル名>」の形式で 1 行で報告してください。');

  return lines.join('\n');
}
