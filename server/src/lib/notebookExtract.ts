// notebookExtract — ノートブックのソース資料からテキストを抽出する（MC-126）。
//
// claude は PDF / 画像 / テキスト / md / csv を Read で直接読めるが、Office 形式
// （xlsx/xls/pptx/ppt/docx/doc/ods/odp/odt）は直接読めない。これらは追加時に
// テキストを抽出して <notebook>/extracted/<name>.txt に置き、claude のプロンプトで
// 「./sources/ と ./extracted/ を読め」と指示する。
//
// 抽出手段（拡張子別）:
//  - .docx → python-docx
//  - .xlsx → openpyxl（全シート・全セルを TSV 風に）
//  - .pptx → python-pptx（スライドごとのテキスト）
//  - .doc/.ppt/.xls/.odt/.odp/.ods/.rtf → soffice で .txt 化（または PDF 経由で pdftotext）
//
// シェルを介さない execFile を使い、タイムアウトを設ける。失敗は Error を throw（呼び出し側で
// 部分劣化として握りつぶし、その資料だけ extracted を作らずに続行する）。

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const SOFFICE_BIN =
  process.env.SOFFICE_BIN && process.env.SOFFICE_BIN.trim() !== ''
    ? process.env.SOFFICE_BIN
    : '/usr/bin/soffice';
const PDFTOTEXT_BIN = process.env.PDFTOTEXT_BIN || '/usr/bin/pdftotext';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const EXTRACT_TIMEOUT_MS = Number(process.env.NOTEBOOK_EXTRACT_TIMEOUT_MS) || 90_000;

/** claude が直接 Read できる拡張子（抽出不要）。 */
const DIRECT_READ_EXTS = new Set([
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.log',
  '.yaml',
  '.yml',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
]);

/** python ベースで抽出する Office 拡張子。 */
const PY_DOCX = new Set(['.docx']);
const PY_XLSX = new Set(['.xlsx']);
const PY_PPTX = new Set(['.pptx']);
/** soffice 経由（PDF→pdftotext）で抽出する旧 Office / OpenDocument。 */
const SOFFICE_EXTS = new Set([
  '.doc',
  '.ppt',
  '.xls',
  '.odt',
  '.odp',
  '.ods',
  '.rtf',
]);

/** この拡張子は抽出が必要か（= claude が直接読めない）。 */
export function needsExtraction(ext: string): boolean {
  const e = ext.toLowerCase();
  return !DIRECT_READ_EXTS.has(e) && (PY_DOCX.has(e) || PY_XLSX.has(e) || PY_PPTX.has(e) || SOFFICE_EXTS.has(e));
}

// ─── python 抽出スクリプト（標準出力にテキストを吐く）─────────────

const PY_DOCX_SCRIPT = `
import sys
from docx import Document
d = Document(sys.argv[1])
out = []
for p in d.paragraphs:
    if p.text.strip():
        out.append(p.text)
for t in d.tables:
    for row in t.rows:
        cells = [c.text.strip() for c in row.cells]
        if any(cells):
            out.append('\\t'.join(cells))
sys.stdout.write('\\n'.join(out))
`;

const PY_XLSX_SCRIPT = `
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
out = []
for ws in wb.worksheets:
    out.append('### Sheet: ' + str(ws.title))
    for row in ws.iter_rows(values_only=True):
        cells = ['' if v is None else str(v) for v in row]
        if any(c.strip() for c in cells):
            out.append('\\t'.join(cells))
sys.stdout.write('\\n'.join(out))
`;

const PY_PPTX_SCRIPT = `
import sys
from pptx import Presentation
prs = Presentation(sys.argv[1])
out = []
for i, slide in enumerate(prs.slides, 1):
    out.append('### Slide ' + str(i))
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                txt = ''.join(r.text for r in para.runs)
                if txt.strip():
                    out.append(txt)
        if shape.has_table:
            for row in shape.table.rows:
                cells = [c.text.strip() for c in row.cells]
                if any(cells):
                    out.append('\\t'.join(cells))
sys.stdout.write('\\n'.join(out))
`;

/** python ワンライナーで Office を抽出してテキストを返す。 */
async function extractWithPython(script: string, srcAbsPath: string): Promise<string> {
  const { stdout } = await execFileP(PYTHON_BIN, ['-c', script, srcAbsPath], {
    timeout: EXTRACT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/** soffice で PDF 化 → pdftotext でテキスト抽出（旧 Office / OpenDocument 用）。 */
async function extractWithSoffice(srcAbsPath: string): Promise<string> {
  const workDir = mkdtempSync(join(tmpdir(), 'apollo-nb-extract-'));
  const profileDir = join(workDir, 'profile');
  const outDir = join(workDir, 'out');
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  try {
    await execFileP(
      SOFFICE_BIN,
      [
        '--headless',
        '--norestore',
        '--nologo',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        srcAbsPath,
      ],
      { timeout: EXTRACT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    const base = basename(srcAbsPath, extname(srcAbsPath));
    let producedPdf = join(outDir, `${base}.pdf`);
    if (!existsSync(producedPdf)) {
      const pdfs = readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
      if (pdfs.length === 0) throw new Error('soffice produced no PDF');
      producedPdf = join(outDir, pdfs[0]);
    }
    const txtOut = join(outDir, 'out.txt');
    await execFileP(PDFTOTEXT_BIN, ['-layout', producedPdf, txtOut], {
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    return readFileSync(txtOut, 'utf8');
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}

/**
 * ソース資料からテキストを抽出して <notebookDir>/extracted/<srcName>.txt に書き出す。
 * 抽出不要（claude が直接読める）形式なら何もせず null を返す。
 *
 * @param notebookDir ノートブックの絶対 dir。
 * @param srcAbsPath ソースファイルの絶対パス（<dir>/sources/<name>）。
 * @param srcName ソースのファイル名（basename）。
 * @returns 書き出した extracted ファイルの basename（例 'plan.xlsx.txt'）、不要なら null。
 * @throws 抽出失敗時（呼び出し側で部分劣化として握りつぶす）。
 */
export async function extractSourceText(
  notebookDir: string,
  srcAbsPath: string,
  srcName: string,
): Promise<string | null> {
  const ext = extname(srcName).toLowerCase();
  if (!needsExtraction(ext)) return null;

  let text: string;
  if (PY_DOCX.has(ext)) {
    text = await extractWithPython(PY_DOCX_SCRIPT, srcAbsPath);
  } else if (PY_XLSX.has(ext)) {
    text = await extractWithPython(PY_XLSX_SCRIPT, srcAbsPath);
  } else if (PY_PPTX.has(ext)) {
    text = await extractWithPython(PY_PPTX_SCRIPT, srcAbsPath);
  } else {
    text = await extractWithSoffice(srcAbsPath);
  }

  const extractedDir = join(notebookDir, 'extracted');
  if (!existsSync(extractedDir)) mkdirSync(extractedDir, { recursive: true });
  const outName = `${srcName}.txt`;
  const header = `# 抽出元: ${srcName}\n# （元ファイルは ./sources/${srcName}。以下は自動抽出したテキスト）\n\n`;
  writeFileSync(join(extractedDir, outName), header + (text || ''), 'utf8');
  return outName;
}
