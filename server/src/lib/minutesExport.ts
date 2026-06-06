// 議事録を Word / Excel / PDF / Text に変換してエクスポートするライブラリ
//
// 入力: Markdown テキスト（Claude が生成した議事録）
// 出力: Buffer（各形式のバイナリ）

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  AlignmentType,
  ShadingType,
} from 'docx';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';

const IPA_FONT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf';

export type ExportFormat = 'docx' | 'xlsx' | 'txt' | 'pdf';

// ── Markdown パーサ（軽量、docx/xlsx 用）─────────────────────────

interface MdBlock {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'para' | 'table' | 'hr' | 'empty';
  text?: string;       // h1-h4, para
  rows?: string[][];   // table rows (including header)
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
    } else if (line.startsWith('---')) {
      blocks.push({ type: 'hr' });
    } else if (line.startsWith('|')) {
      // テーブル: 連続する | 行を集める
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
        // セパレータ行（:---:など）は除外
        if (!cells.every((c) => /^[-:]+$/.test(c))) {
          rows.push(cells);
        }
        i++;
      }
      if (rows.length > 0) blocks.push({ type: 'table', rows });
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

// インラインの **bold** / `code` を除去してプレーンテキスト化
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1');
}

// ── Word (.docx) ──────────────────────────────────────────────────

function buildDocx(blocks: MdBlock[]): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'h1':
        children.push(
          new Paragraph({
            text: stripInline(block.text ?? ''),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 },
          }),
        );
        break;
      case 'h2':
        children.push(
          new Paragraph({
            text: stripInline(block.text ?? ''),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 80 },
          }),
        );
        break;
      case 'h3':
        children.push(
          new Paragraph({
            text: stripInline(block.text ?? ''),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 160, after: 60 },
          }),
        );
        break;
      case 'h4':
        children.push(
          new Paragraph({
            text: stripInline(block.text ?? ''),
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 120, after: 40 },
          }),
        );
        break;
      case 'para': {
        const raw = block.text ?? '';
        // **bold** をインライン TextRun で表現
        const parts = raw.split(/(\*\*.*?\*\*)/g);
        const runs = parts.map((p) => {
          if (p.startsWith('**') && p.endsWith('**')) {
            return new TextRun({ text: p.slice(2, -2), bold: true });
          }
          return new TextRun({ text: p });
        });
        children.push(new Paragraph({ children: runs, spacing: { after: 60 } }));
        break;
      }
      case 'hr':
        children.push(
          new Paragraph({
            text: '─'.repeat(40),
            spacing: { before: 80, after: 80 },
            style: 'Normal',
          }),
        );
        break;
      case 'table': {
        const rows = block.rows ?? [];
        const colCount = Math.max(...rows.map((r) => r.length));
        const colWidth = Math.floor(9000 / colCount);

        const tableRows = rows.map((row, ri) =>
          new TableRow({
            tableHeader: ri === 0,
            children: row.map((cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: stripInline(cell),
                        bold: ri === 0,
                        color: ri === 0 ? 'FFFFFF' : '000000',
                      }),
                    ],
                    alignment: AlignmentType.LEFT,
                  }),
                ],
                shading:
                  ri === 0
                    ? { type: ShadingType.SOLID, color: '1F4E79', fill: '1F4E79' }
                    : ri % 2 === 0
                      ? { type: ShadingType.SOLID, color: 'D6E4F0', fill: 'D6E4F0' }
                      : undefined,
                width: { size: colWidth, type: WidthType.DXA },
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
                  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
                  left: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
                  right: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
                },
              }),
            ),
          }),
        );

        children.push(
          new Table({
            rows: tableRows,
            width: { size: 9000, type: WidthType.DXA },
          }),
        );
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
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
          run: { font: 'MS Gothic', size: 22 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ── Excel (.xlsx) ─────────────────────────────────────────────────

async function buildXlsx(blocks: MdBlock[], title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mission Control';

  const ws = wb.addWorksheet('議事録', { views: [{ state: 'frozen', ySplit: 1 }] });

  // タイトル行
  ws.mergeCells('A1:F1');
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: 'MS Gothic', bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 28;

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
          h1: 'FF2E4057',
          h2: 'FF3A6186',
          h3: 'FF4A7EB5',
          h4: 'FFDAE8F5',
        };
        const fontColors: Record<string, string> = {
          h1: 'FFFFFFFF',
          h2: 'FFFFFFFF',
          h3: 'FFFFFFFF',
          h4: 'FF1F4E79',
        };
        cell.font = {
          name: 'MS Gothic',
          bold: true,
          size: sizes[block.type],
          color: { argb: fontColors[block.type] },
        };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColors[block.type] } };
        cell.alignment = { vertical: 'middle', indent: block.type === 'h1' ? 0 : 1 };
        ws.getRow(row).height = 20;
        row++;
        break;
      }
      case 'para': {
        ws.mergeCells(`A${row}:F${row}`);
        const cell = ws.getCell(`A${row}`);
        cell.value = stripInline(block.text ?? '');
        cell.font = { name: 'MS Gothic', size: 10 };
        cell.alignment = { wrapText: true, indent: 1 };
        row++;
        break;
      }
      case 'table': {
        const tableRows = block.rows ?? [];
        for (let ri = 0; ri < tableRows.length; ri++) {
          const cells = tableRows[ri];
          for (let ci = 0; ci < cells.length; ci++) {
            const col = String.fromCharCode(65 + ci);
            const cell = ws.getCell(`${col}${row}`);
            cell.value = stripInline(cells[ci]);
            cell.font = {
              name: 'MS Gothic',
              bold: ri === 0,
              size: 10,
              color: { argb: ri === 0 ? 'FFFFFFFF' : 'FF000000' },
            };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: {
                argb: ri === 0 ? 'FF1F4E79' : ri % 2 === 0 ? 'FFD6E4F0' : 'FFFFFFFF',
              },
            };
            cell.alignment = { wrapText: true, vertical: 'middle', indent: 1 };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFAAAAAA' } },
              bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
              left: { style: 'thin', color: { argb: 'FFAAAAAA' } },
              right: { style: 'thin', color: { argb: 'FFAAAAAA' } },
            };
          }
          ws.getRow(row).height = 18;
          row++;
        }
        row++; // テーブル後の空白行
        break;
      }
      case 'hr':
        row++; // 空白行で区切り
        break;
      case 'empty':
        row++;
        break;
    }
  }

  // 列幅設定
  ws.getColumn('A').width = 8;
  ws.getColumn('B').width = 32;
  ws.getColumn('C').width = 16;
  ws.getColumn('D').width = 14;
  ws.getColumn('E').width = 10;
  ws.getColumn('F').width = 14;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ── PDF ───────────────────────────────────────────────────────────

function buildPdf(blocks: MdBlock[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info: { Title: '議事録', Author: 'Mission Control' },
    });

    let fontAvailable = false;
    try {
      readFileSync(IPA_FONT);
      doc.registerFont('ja', IPA_FONT);
      fontAvailable = true;
    } catch {
      // フォントなければ Helvetica にフォールバック
    }

    const jFont = fontAvailable ? 'ja' : 'Helvetica';
    const jFontBold = fontAvailable ? 'ja' : 'Helvetica-Bold';

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - 120; // margin両側

    for (const block of blocks) {
      switch (block.type) {
        case 'h1':
          doc.font(jFontBold).fontSize(18).fillColor('#1F4E79')
            .text(stripInline(block.text ?? ''), { underline: false });
          doc.moveDown(0.4);
          doc.moveTo(60, doc.y).lineTo(60 + pageW, doc.y).stroke('#1F4E79');
          doc.moveDown(0.4);
          break;
        case 'h2':
          doc.moveDown(0.3);
          doc.font(jFontBold).fontSize(14).fillColor('#2E4057')
            .text(stripInline(block.text ?? ''));
          doc.moveDown(0.2);
          break;
        case 'h3':
          doc.moveDown(0.2);
          doc.font(jFontBold).fontSize(12).fillColor('#3A6186')
            .text(stripInline(block.text ?? ''));
          doc.moveDown(0.15);
          break;
        case 'h4':
          doc.font(jFontBold).fontSize(11).fillColor('#4A7EB5')
            .text(stripInline(block.text ?? ''));
          doc.moveDown(0.1);
          break;
        case 'para':
          doc.font(jFont).fontSize(10).fillColor('#000000')
            .text(stripInline(block.text ?? ''), { lineGap: 2 });
          doc.moveDown(0.2);
          break;
        case 'hr':
          doc.moveDown(0.2);
          doc.moveTo(60, doc.y).lineTo(60 + pageW, doc.y).stroke('#CCCCCC');
          doc.moveDown(0.2);
          break;
        case 'table': {
          const rows = block.rows ?? [];
          if (rows.length === 0) break;
          const colCount = Math.max(...rows.map((r) => r.length));
          const colW = pageW / colCount;
          const rowH = 18;
          let x = 60;
          let y = doc.y;

          for (let ri = 0; ri < rows.length; ri++) {
            // 改ページチェック
            if (y + rowH > doc.page.height - 60) {
              doc.addPage();
              y = 60;
            }

            const bgColor = ri === 0 ? '#1F4E79' : ri % 2 === 0 ? '#D6E4F0' : '#FFFFFF';
            const textColor = ri === 0 ? '#FFFFFF' : '#000000';

            for (let ci = 0; ci < colCount; ci++) {
              const cellX = x + ci * colW;
              doc.rect(cellX, y, colW, rowH).fill(bgColor).stroke('#AAAAAA');
              doc.font(ri === 0 ? jFontBold : jFont)
                .fontSize(9)
                .fillColor(textColor)
                .text(stripInline(rows[ri][ci] ?? ''), cellX + 3, y + 4, {
                  width: colW - 6,
                  height: rowH - 4,
                  ellipsis: true,
                  lineBreak: false,
                });
            }
            y += rowH;
          }
          doc.y = y + 8;
          doc.moveDown(0.3);
          break;
        }
        case 'empty':
          doc.moveDown(0.3);
          break;
      }
    }

    doc.end();
  });
}

// ── プレーンテキスト ───────────────────────────────────────────

function buildText(md: string): Buffer {
  // Markdown 記法をほぼそのままプレーンテキスト化
  const text = md
    .replace(/^#{1,4} /gm, '')   // 見出し記号除去
    .replace(/\*\*(.*?)\*\*/g, '【$1】') // **bold** → 【bold】
    .replace(/^\|(.+)\|$/gm, (line) =>
      line.split('|').slice(1, -1).map((c) => c.trim()).join(' | '),
    ) // テーブル整形
    .replace(/^[-:]+\|[-:| ]+$/gm, ''); // セパレータ行除去
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
      const buffer = await buildPdf(blocks);
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
