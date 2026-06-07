// 議事録を Word / Excel / PDF / Text に変換してエクスポートするライブラリ
//
// 入力: Markdown テキスト（Claude が生成した議事録）
// 出力: Buffer（各形式のバイナリ）

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  AlignmentType,
  ShadingType,
} from 'docx';
import ExcelJS from 'exceljs';
import { marked } from 'marked';
import { chromium } from 'playwright-core';
import { existsSync } from 'fs';

const CHROMIUM_PATHS = [
  '/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChromium(): string | undefined {
  return CHROMIUM_PATHS.find((p) => existsSync(p));
}

export type ExportFormat = 'docx' | 'xlsx' | 'txt' | 'pdf';

// ── Markdown パーサ ──────────────────────────────────────────────────

interface ListItem {
  text: string;
  indent: number;
}

interface MdBlock {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'para' | 'table' | 'hr' | 'empty' | 'list' | 'blockquote' | 'pagebreak';
  text?: string;
  rows?: string[][];
  items?: ListItem[];
  ordered?: boolean;
}

function parseMarkdown(md: string): MdBlock[] {
  const lines = md.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('#### ')) {
      blocks.push({ type: 'h4', text: line.slice(5).trim() });
    } else if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4).trim() });
    } else if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
    } else if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2).trim() });
    } else if (line.startsWith('---') || line.startsWith('***') || line.startsWith('___')) {
      if (line.replace(/[-*_]/g, '').trim() === '') {
        blocks.push({ type: 'hr' });
      } else {
        blocks.push({ type: 'para', text: line });
      }
    } else if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^[-:]+$/.test(c))) {
          rows.push(cells);
        }
        i++;
      }
      if (rows.length > 0) blocks.push({ type: 'table', rows });
      continue;
    } else if (line.trim() === '<!-- pagebreak -->') {
      blocks.push({ type: 'pagebreak' });
    } else if (line.startsWith('> ')) {
      const text = line.slice(2).trim();
      blocks.push({ type: 'blockquote', text });
    } else if (isListItem(line)) {
      // 連続するリスト行をまとめて収集
      const items: ListItem[] = [];
      const ordered = isOrderedItem(line);
      while (i < lines.length && (isListItem(lines[i]) || isIndentedContinuation(lines[i], items))) {
        const l = lines[i];
        if (isListItem(l)) {
          const indent = getListIndent(l);
          const text = stripListPrefix(l);
          items.push({ text, indent });
        } else if (l.trim() !== '' && items.length > 0) {
          // インライン継続行: 直前のアイテムに追記
          items[items.length - 1].text += ' ' + l.trim();
        }
        i++;
      }
      if (items.length > 0) blocks.push({ type: 'list', items, ordered });
      continue;
    } else if (line.trim() === '') {
      blocks.push({ type: 'empty' });
    } else {
      blocks.push({ type: 'para', text: line });
    }
    i++;
  }

  return blocks;
}

function isListItem(line: string): boolean {
  return /^(\s*)([-*+]|\d+[.)]) /.test(line);
}

function isOrderedItem(line: string): boolean {
  return /^\s*\d+[.)] /.test(line);
}

function isIndentedContinuation(line: string, items: ListItem[]): boolean {
  if (items.length === 0) return false;
  return line.startsWith('   ') && line.trim() !== '' && !line.trim().startsWith('#');
}

function getListIndent(line: string): number {
  const m = line.match(/^(\s*)/);
  const spaces = m ? m[1].length : 0;
  return Math.floor(spaces / 2);
}

function stripListPrefix(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)]) /, '').trim();
}

// インラインの **bold** / `code` / *italic* / [link] を除去してプレーンテキスト化
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1');
}

// インラインの **bold** を TextRun 配列に変換（docx 用）
function inlineToRuns(text: string, baseSize = 20, color?: string): TextRun[] {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  return parts.map((p) => {
    const base = { size: baseSize, ...(color ? { color } : {}) };
    if (p.startsWith('**') && p.endsWith('**')) {
      return new TextRun({ text: p.slice(2, -2), bold: true, ...base });
    }
    if (p.startsWith('*') && p.endsWith('*')) {
      return new TextRun({ text: p.slice(1, -1), italics: true, ...base });
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return new TextRun({ text: p.slice(1, -1), font: 'Courier New', size: baseSize - 2, ...(color ? { color } : {}) });
    }
    return new TextRun({ text: p, ...base });
  });
}

// ── Word (.docx) ──────────────────────────────────────────────────

// ── docx スタイル定数（プレビューUIと同一配色） ─────────────────────
const D = {
  // テキスト色
  textMain:   '1E2A3A',  // #1e2a3a  本文
  textMuted:  '4A5A72',  // #4a5a72  小見出し・補助
  textFaint:  '7A8FA8',  // #7a8fa8  引用
  textHeader: '333333',  // #333333  テーブルヘッダーテキスト
  // 罫線
  border:     'D0D8E4',  // #d0d8e4  テーブル罫線・区切り線
  borderHr:   'D0D8E4',
  // 背景
  headerBg:   'EDF0F5',  // #edf0f5  テーブルヘッダー背景（mc-markdown th）
  quoteBg:    'F4F6F9',  // #f4f6f9  引用ブロック左ボーダー
  // フォントサイズ（half-points: pt * 2）
  H1: 28,   // 14pt
  H2: 24,   // 12pt
  H3: 22,   // 11pt
  H4: 20,   // 10pt
  BODY: 20, // 10pt
  TABLE: 20, // 10pt
  FONT: 'Meiryo',
};

const tblBorder = (color: string = D.border) => ({
  style: BorderStyle.SINGLE, size: 4, color,
});

// 標準スタイルの TODO 表（No./タスク/内容/担当者/期限）を判定する
function isStandardTodoHeader(headers: string[]): boolean {
  if (headers.length !== 5) return false;
  const norm = headers.map((h) => h.trim().replace(/\.$/, ''));
  return (
    /^No$/i.test(norm[0]) &&
    norm[1] === 'タスク' &&
    norm[2] === '内容' &&
    (norm[3] === '担当者' || norm[3] === '担当') &&
    norm[4] === '期限'
  );
}

// ヘッダー名から最適な列幅（DXA単位）を計算する
function calcColWidths(headers: string[], totalDxa: number): number[] {
  // 標準スタイルの TODO 表は指定比率（No8% / タスク22% / 内容40% / 担当者15% / 期限15%）で割り付ける
  if (isStandardTodoHeader(headers)) {
    const pct = [8, 22, 40, 15, 15];
    const widths = pct.map((p) => Math.floor((p / 100) * totalDxa));
    const diff = totalDxa - widths.reduce((a, b) => a + b, 0);
    widths[widths.length - 1] += diff;
    return widths;
  }
  const WEIGHT: Record<string, number> = {
    'No': 1, '#': 1, '番号': 1, 'NO': 1,
    'タスク': 5, '内容': 5, 'アクション': 5, '説明': 4, '詳細': 4, '項目': 4, '議題': 4, '発言': 4,
    '担当': 2, '担当者': 2,
    '期限': 2,
    'ステータス': 2, '状態': 2,
    '関連議題': 2,
  };
  const weights = headers.map(h => WEIGHT[h.trim()] ?? 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(w => Math.floor((w / total) * totalDxa));
  // 丸め誤差を最後の列に吸収
  const diff = totalDxa - widths.reduce((a, b) => a + b, 0);
  if (widths.length > 0) widths[widths.length - 1] += diff;
  return widths;
}

function buildDocx(blocks: MdBlock[]): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  let nextPageBreak = false; // 次の非空ブロックにpageBreakBefore: trueを付ける

  for (const block of blocks) {
    // pagebreakは後続ブロックにフラグを立てるだけ
    if (block.type === 'pagebreak') {
      nextPageBreak = true;
      continue;
    }
    // 空行はページブレクフラグを消費しない
    if (block.type === 'empty' && nextPageBreak) {
      children.push(new Paragraph({ text: '', spacing: { after: 0 } }));
      continue;
    }
    const pageBreak = nextPageBreak;
    nextPageBreak = false;

    switch (block.type) {
      case 'h1':
        children.push(new Paragraph({
          children: inlineToRuns(block.text ?? '', D.H1, D.textMain),
          spacing: { before: 280, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: D.border } },
          pageBreakBefore: pageBreak || undefined,
        }));
        break;

      case 'h2':
        children.push(new Paragraph({
          children: inlineToRuns(block.text ?? '', D.H2, D.textMain),
          spacing: { before: 220, after: 80 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: D.border } },
          pageBreakBefore: pageBreak || undefined,
        }));
        break;

      case 'h3':
        children.push(new Paragraph({
          children: inlineToRuns(block.text ?? '', D.H3, D.textMuted),
          spacing: { before: 180, after: 60 },
          pageBreakBefore: pageBreak || undefined,
        }));
        break;

      case 'h4':
        children.push(new Paragraph({
          children: inlineToRuns(block.text ?? '', D.H4, D.textMuted),
          spacing: { before: 120, after: 40 },
          pageBreakBefore: pageBreak || undefined,
        }));
        break;

      case 'para': {
        const runs = inlineToRuns(block.text ?? '', D.BODY, D.textMain);
        children.push(new Paragraph({
          children: runs,
          spacing: { after: 60 },
          pageBreakBefore: pageBreak || undefined,
        }));
        break;
      }

      case 'blockquote': {
        children.push(new Paragraph({
          children: inlineToRuns(block.text ?? '', D.BODY, D.textMuted),
          indent: { left: 600 },
          spacing: { after: 60 },
          border: { left: { style: BorderStyle.THICK, size: 12, color: 'B0BCCE' } },
          pageBreakBefore: pageBreak || undefined,
        }));
        break;
      }

      case 'list': {
        for (let li = 0; li < (block.items ?? []).length; li++) {
          const item = (block.items ?? [])[li];
          // 中点（・）を左端起点にするため、最上位アイテムは左インデント0とする
          const leftIndent = item.indent * 320;
          children.push(new Paragraph({
            children: [
              new TextRun({ text: '・ ', font: D.FONT, size: D.BODY - 2, color: D.textMuted }),
              ...inlineToRuns(item.text, D.BODY, D.textMain),
            ],
            indent: { left: leftIndent },
            spacing: { after: 40 },
            pageBreakBefore: (li === 0 && pageBreak) || undefined,
          }));
        }
        break;
      }

      case 'hr':
        children.push(new Paragraph({
          text: '',
          spacing: { before: 100, after: 100 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: D.borderHr } },
          pageBreakBefore: pageBreak || undefined,
        }));
        break;

      case 'table': {
        const rows = block.rows ?? [];
        const colCount = Math.max(...rows.map((r) => r.length), 1);
        const headers = rows[0] ?? [];
        const colWidths = calcColWidths(headers, 9000);

        const tableRows = rows.map((row, ri) =>
          new TableRow({
            tableHeader: ri === 0,
            children: row.map((cell, ci) =>
              new TableCell({
                children: [new Paragraph({
                  children: inlineToRuns(
                    cell,
                    D.TABLE,
                    ri === 0 ? D.textHeader : D.textMain,
                  ),
                  alignment: AlignmentType.LEFT,
                  pageBreakBefore: (ri === 0 && pageBreak) || undefined,
                })],
                shading: ri === 0
                  ? { type: ShadingType.SOLID, color: D.headerBg, fill: D.headerBg }
                  : undefined,
                width: { size: colWidths[ci] ?? Math.floor(9000 / colCount), type: WidthType.DXA },
                borders: {
                  top:    tblBorder(),
                  bottom: tblBorder(),
                  left:   tblBorder(),
                  right:  tblBorder(),
                },
              }),
            ),
          }),
        );

        children.push(new Table({
          rows: tableRows,
          width: { size: 9000, type: WidthType.DXA },
        }));
        children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
        break;
      }

      case 'empty':
        children.push(new Paragraph({ text: '', spacing: { after: 40 } }));
        break;
    }
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: { font: D.FONT, size: D.BODY, color: D.textMain },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: D.FONT, size: D.H1, bold: true, color: D.textMain },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: D.FONT, size: D.H2, bold: true, color: D.textMain },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: D.FONT, size: D.H3, bold: true, color: D.textMuted },
        },
      ],
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// ── Excel (.xlsx) ─────────────────────────────────────────────────

async function buildXlsx(blocks: MdBlock[], title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apollo';

  const ws = wb.addWorksheet('議事録', { views: [{ state: 'frozen', ySplit: 1 }] });

  // タイトル行: プレビューH1配色に合わせ薄いグレー
  ws.mergeCells('A1:F1');
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: 'Meiryo', bold: true, size: 13, color: { argb: 'FF1E2A3A' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF0F5' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleCell.border = {
    bottom: { style: 'medium', color: { argb: 'FFD0D8E4' } },
  };
  ws.getRow(1).height = 26;

  // 共通罫線色
  const THIN_BORDER = { style: 'thin' as const, color: { argb: 'FFD0D8E4' } };
  const cellBorder = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };

  let row = 2;

  for (const block of blocks) {
    switch (block.type) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4': {
        ws.mergeCells(`A${row}:F${row}`);
        const cell = ws.getCell(`A${row}`);
        cell.value = stripInline(block.text ?? '');
        const sizes: Record<string, number> = { h1: 13, h2: 12, h3: 11, h4: 10 };
        const bgColors: Record<string, string> = {
          h1: 'FFEDF0F5',
          h2: 'FFF4F6F9',
          h3: 'FFFFFFFF',
          h4: 'FFFFFFFF',
        };
        const fontColors: Record<string, string> = {
          h1: 'FF1E2A3A',
          h2: 'FF1E2A3A',
          h3: 'FF4A5A72',
          h4: 'FF4A5A72',
        };
        cell.font = { name: 'Meiryo', bold: true, size: sizes[block.type], color: { argb: fontColors[block.type] } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColors[block.type] } };
        cell.alignment = { vertical: 'middle', indent: 1 };
        if (block.type === 'h1' || block.type === 'h2') {
          cell.border = { bottom: { style: 'thin', color: { argb: 'FFD0D8E4' } } };
        }
        ws.getRow(row).height = block.type === 'h1' ? 22 : 20;
        row++;
        break;
      }
      case 'para':
      case 'blockquote': {
        ws.mergeCells(`A${row}:F${row}`);
        const cell = ws.getCell(`A${row}`);
        cell.value = stripInline(block.text ?? '');
        cell.font = {
          name: 'Meiryo', size: 10,
          italic: block.type === 'blockquote',
          color: { argb: block.type === 'blockquote' ? 'FF4A5A72' : 'FF1E2A3A' },
        };
        cell.alignment = { wrapText: true, indent: block.type === 'blockquote' ? 2 : 1 };
        row++;
        break;
      }
      case 'list': {
        for (const item of block.items ?? []) {
          ws.mergeCells(`A${row}:F${row}`);
          const cell = ws.getCell(`A${row}`);
          cell.value = `${'　'.repeat(item.indent)}・ ${stripInline(item.text)}`;
          cell.font = { name: 'Meiryo', size: 10, color: { argb: 'FF1E2A3A' } };
          cell.alignment = { wrapText: true, indent: 1 };
          row++;
        }
        break;
      }
      case 'table': {
        const tableRows = block.rows ?? [];
        const colCount = Math.max(...tableRows.map((r) => r.length), 1);
        for (let ri = 0; ri < tableRows.length; ri++) {
          const cells = tableRows[ri];
          for (let ci = 0; ci < colCount; ci++) {
            const col = String.fromCharCode(65 + ci);
            const cell = ws.getCell(`${col}${row}`);
            cell.value = stripInline(cells[ci] ?? '');
            cell.font = {
              name: 'Meiryo',
              bold: ri === 0,
              size: 10,
              color: { argb: ri === 0 ? 'FF333333' : 'FF1E2A3A' },
            };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: ri === 0 ? 'FFEDF0F5' : 'FFFFFFFF' },
            };
            cell.alignment = { wrapText: true, vertical: 'top', indent: 1 };
            cell.border = cellBorder;
          }
          ws.getRow(row).height = 18;
          row++;
        }
        row++; // テーブル後に空行
        break;
      }
      case 'hr': {
        ws.mergeCells(`A${row}:F${row}`);
        ws.getCell(`A${row}`).border = { bottom: { style: 'thin', color: { argb: 'FFD0D8E4' } } };
        ws.getRow(row).height = 8;
        row++;
        break;
      }
      case 'empty':
        ws.getRow(row).height = 8;
        row++;
        break;
    }
  }

  // 列幅（標準スタイルの TODO 表 No./タスク/内容/担当者/期限 に最適化）
  ws.getColumn('A').width = 6;   // No（狭）
  ws.getColumn('B').width = 18;  // タスク（中）
  ws.getColumn('C').width = 44;  // 内容（広）
  ws.getColumn('D').width = 14;  // 担当者（狭）
  ws.getColumn('E').width = 12;  // 期限（狭）
  ws.getColumn('F').width = 12;  // 予備

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// marked が生成した HTML から、標準スタイルの TODO 表（No./タスク/内容/担当者/期限）を
// 検出し、列幅指定用の <colgroup> と固定レイアウト用クラスを注入する。
// 他スタイルの2列表などは <thead> のヘッダー構成が一致しないため影響を受けない。
function injectTodoColgroup(html: string): string {
  const COLGROUP =
    '<colgroup>' +
    '<col style="width:8%">' +
    '<col style="width:22%">' +
    '<col style="width:40%">' +
    '<col style="width:15%">' +
    '<col style="width:15%">' +
    '</colgroup>';

  return html.replace(/<table>([\s\S]*?)<\/table>/g, (full, inner) => {
    // ヘッダーセルを抽出（marked は <thead><tr><th>...</th>...）
    const theadMatch = /<thead>([\s\S]*?)<\/thead>/.exec(inner);
    if (!theadMatch) return full;
    const headers = Array.from(theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)).map((m) =>
      m[1].replace(/<[^>]+>/g, '').trim().replace(/\.$/, ''),
    );
    const isTodo =
      headers.length === 5 &&
      /^No$/i.test(headers[0]) &&
      headers[1] === 'タスク' &&
      headers[2] === '内容' &&
      (headers[3] === '担当者' || headers[3] === '担当') &&
      headers[4] === '期限';
    if (!isTodo) return full;
    return `<table class="todo-table">${COLGROUP}${inner}</table>`;
  });
}

// ── PDF（playwright + marked でプレビューと同じ描画）──────────────

async function buildPdf(markdownContent: string): Promise<Buffer> {
  // <!-- pagebreak --> を CSS ページブレーク div に変換してから marked に渡す
  const preprocessed = markdownContent.replace(
    /<!--\s*pagebreak\s*-->/gi,
    '\n<div class="pagebreak"></div>\n',
  );
  let htmlBody = await marked(preprocessed, { gfm: true, breaks: false });
  htmlBody = injectTodoColgroup(htmlBody);

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body {
    /* PDF は Linux サーバ上の headless Chromium でレンダリングされる。Hiragino/Yu Gothic/Meiryo/Noto Sans JP は
       サーバ未インストールのため、generic sans-serif に落ちると中国語フォント(WenQuanYi)やビットマップ(Unifont)に
       フォールバックして字形・行間が崩れる。実在の日本語フォント(IPAexGothic→IPAPGothic→IPAGothic)を
       sans-serif の前に明示し、崩れを防ぐ（MC-195）。Noto/Hiragino 系は将来インストール時に優先される。 */
    font-family: "Meiryo", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Noto Sans CJK JP", "IPAexGothic", "IPAPGothic", "IPAGothic", sans-serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #1e2a3a;
    background: #ffffff;
    word-break: break-word;
  }
  h1, h2, h3, h4 { font-weight: 700; line-height: 1.3; margin: 1.2em 0 0.5em; }
  h1 { font-size: 1.5em; }
  h2 { font-size: 1.25em; border-bottom: 1px solid #d0d8e4; padding-bottom: 0.3em; }
  h3 { font-size: 1.1em; }
  h4 { font-size: 1em; }
  p { margin: 0.6em 0; }
  ul, ol { margin: 0.5em 0; padding-left: 1.2em; list-style-position: outside; }
  li { margin: 0.25em 0; }
  code {
    background: #edf0f5;
    padding: 0.1em 0.4em;
    border-radius: 4px;
    font-size: 0.88em;
    font-family: "Courier New", monospace;
  }
  pre {
    background: #f4f6f9;
    border: 1px solid #d0d8e4;
    padding: 0.9em;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.88em;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid #b0bcce;
    margin: 0.8em 0;
    padding: 0.2em 0 0.2em 1em;
    color: #4a5a72;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.8em 0;
    font-size: 0.92em;
  }
  th, td { border: 1px solid #d0d8e4; padding: 0.4em 0.7em; text-align: left; }
  /* 標準スタイルの TODO 表は colgroup の列幅を固定レイアウトで反映する（MC-207） */
  table.todo-table { table-layout: fixed; }
  table.todo-table td, table.todo-table th { word-break: break-word; overflow-wrap: anywhere; }
  th { background: #edf0f5; font-weight: 700; }
  tr:nth-child(even) td { background: #f8f9fc; }
  hr { border: none; border-top: 1px solid #d0d8e4; margin: 1.2em 0; }
  .pagebreak { page-break-before: always; height: 0; margin: 0; padding: 0; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  a { color: #3b7dd8; }
</style>
</head>
<body>${htmlBody}</body>
</html>`;

  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      'PDF生成用のChromiumが見つかりませんでした。' +
        `次のいずれかのパスにブラウザが必要です: ${CHROMIUM_PATHS.join(', ')}。` +
        'Playwrightのインストール（npx playwright install chromium）を確認してください。',
    );
  }

  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ── プレーンテキスト ───────────────────────────────────────────

function buildText(md: string): Buffer {
  const text = md
    .replace(/^#{1,4} /gm, '')
    .replace(/\*\*(.*?)\*\*/g, '【$1】')
    .replace(/^\|(.+)\|$/gm, (line) =>
      line.split('|').slice(1, -1).map((c) => c.trim()).join(' | '),
    )
    .replace(/^[-:]+\|[-:| ]+$/gm, '')
    .replace(/^([-*+]) /gm, '• ')
    .replace(/^\d+[.)] /gm, (_m, offset, str) => {
      const preceding = str.slice(0, offset).split('\n').reverse();
      let n = 1;
      for (const line of preceding) {
        if (/^\d+[.)] /.test(line)) n++;
        else break;
      }
      return `${n}. `;
    });
  return Buffer.from(text, 'utf-8');
}

// ── パブリックAPI ─────────────────────────────────────────────

export async function exportMinutes(
  markdownContent: string,
  format: ExportFormat,
  title: string,
): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  const blocks = parseMarkdown(markdownContent);

  switch (format) {
    case 'docx': {
      const buffer = await buildDocx(blocks);
      return { buffer, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    }
    case 'xlsx': {
      const buffer = await buildXlsx(blocks, title);
      return { buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
    }
    case 'pdf': {
      const buffer = await buildPdf(markdownContent);
      return { buffer, mimeType: 'application/pdf', ext: 'pdf' };
    }
    case 'txt': {
      const buffer = buildText(markdownContent);
      return { buffer, mimeType: 'text/plain; charset=utf-8', ext: 'txt' };
    }
    default:
      throw new Error(`Unknown export format: ${String(format)}`);
  }
}
