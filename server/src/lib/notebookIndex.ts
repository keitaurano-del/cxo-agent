// notebookIndex — ノートブック RAG 索引の構築・管理・検索（MC-RAG Phase 1）。
//
// 軽量な JSON 索引（chunks.json + meta.json）をノートブックの index/ ディレクトリに保持する。
// Gemini text-embedding-004 でチャンクをベクトル化し、コサイン類似度で検索する。
//
// GEMINI_API_KEY 未設定 or API 失敗 → 索引なし従来動作（後方互換フォールバック）。
// 参考: docs/NOTEBOOK_RAG_DESIGN.md

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { NOTEBOOK_RAG_CHUNK_SIZE, NOTEBOOK_RAG_CHUNK_OVERLAP, NOTEBOOK_RAG_TOP_K } from '../config.js';
import { embedText, embedTexts } from './embedding.js';

// ─── 型定義 ──────────────────────────────────────────────────

export interface Chunk {
  id: number;
  sourceFile: string;
  chunkIndex: number;
  text: string;
  vector: number[];
}

export interface IndexMeta {
  builtAt: string;
  chunkCount: number;
  version: number;
}

export interface IndexBuildResult {
  ok: boolean;
  chunkCount: number;
  fileCount: number;
  error?: string;
}

// ─── 索引パス ──────────────────────────────────────────────────

const INDEX_VERSION = 1;

function chunksPath(notebookDir: string): string {
  return join(notebookDir, 'index', 'chunks.json');
}

function metaPath(notebookDir: string): string {
  return join(notebookDir, 'index', 'meta.json');
}

// ─── チャンク分割 ──────────────────────────────────────────────

/**
 * テキストを段落境界を尊重しながら chunkSize 文字ずつに分割する。
 * 段落区切り（\n\n）を優先した自然な分割を行い、overlap 文字分を次チャンクの先頭に残す。
 * 20文字未満の短すぎるチャンクは除去する。
 */
export function splitChunks(
  text: string,
  chunkSize = NOTEBOOK_RAG_CHUNK_SIZE,
  overlap = NOTEBOOK_RAG_CHUNK_OVERLAP,
): string[] {
  // 段落に分割（\n\n 以上の空行で区切る）
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // current に追加してもチャンクサイズを超えない場合は追加
    if (current.length === 0) {
      current = trimmed;
    } else if (current.length + 1 + trimmed.length <= chunkSize) {
      current += '\n\n' + trimmed;
    } else {
      // current をチャンクとして確定
      if (current.length >= 20) {
        chunks.push(current);
      }
      // 段落自体がチャンクサイズを超える場合は文字数で強制分割
      const combined = trimmed;
      if (combined.length > chunkSize) {
        const subChunks = splitLongText(combined, chunkSize, overlap);
        chunks.push(...subChunks);
        // 最後のサブチャンクの末尾 overlap 文字をオーバーラップとして引き継ぐ
        const last = subChunks[subChunks.length - 1] ?? '';
        current = last.length > overlap ? last.slice(-overlap) : last;
      } else {
        // overlap: current の末尾 overlap 文字を次の current の先頭に引き継ぐ
        const overlapText = current.length > overlap ? current.slice(-overlap) : current;
        current = overlapText + '\n\n' + combined;
        // もし結合後もチャンクサイズを超えるなら確定して combined だけにする
        if (current.length > chunkSize) {
          if (combined.length >= 20) {
            chunks.push(combined);
          }
          current = combined.length > overlap ? combined.slice(-overlap) : combined;
        }
      }
    }
  }

  // 末尾の残りを確定
  if (current.trim().length >= 20) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * 単一の長いテキストを chunkSize 文字ずつ強制分割する（段落境界なし）。
 */
function splitLongText(text: string, chunkSize: number, overlap: number): string[] {
  const result: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const end = Math.min(pos + chunkSize, text.length);
    const chunk = text.slice(pos, end).trim();
    if (chunk.length >= 20) {
      result.push(chunk);
    }
    if (end >= text.length) break;
    pos = end - overlap;
    if (pos <= 0) pos = end; // 無限ループ防止
  }
  return result;
}

// ─── 索引構築 ──────────────────────────────────────────────────

/**
 * ノートブックの索引を構築する。
 * - extracted/*.txt を走査し、header コメント行（# 抽出元:）を除去してからチャンク分割する。
 * - sources 配下の .txt/.md/.csv/.tsv/.json/.yaml/.yml で、extracted に対応 txt がないものも対象。
 * - sources 配下の .pdf を pdftotext で extracted に変換（未変換のみ）して対象に加える。
 * - Gemini でバッチ embed して chunks.json / meta.json に保存する。
 */
export async function buildIndex(notebookDir: string): Promise<IndexBuildResult> {
  const extractedDir = join(notebookDir, 'extracted');
  const sourcesDir = join(notebookDir, 'sources');

  // index/ ディレクトリを確保
  const indexDir = join(notebookDir, 'index');
  if (!existsSync(indexDir)) {
    mkdirSync(indexDir, { recursive: true });
  }

  // テキストソースを収集
  type TextSource = { sourceFile: string; text: string };
  const textSources: TextSource[] = [];

  // extracted/*.txt を収集
  const extractedTxtBasenames = new Set<string>();
  if (existsSync(extractedDir)) {
    const files = readdirSync(extractedDir);
    for (const f of files) {
      if (extname(f).toLowerCase() !== '.txt') continue;
      const filePath = join(extractedDir, f);
      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      // header コメント行（# 抽出元:）を除去
      const text = raw
        .split('\n')
        .filter((line) => !line.startsWith('# 抽出元:'))
        .join('\n')
        .trim();
      if (text.length === 0) continue;
      // sourceFile は元のソースファイル名として扱う（拡張子は .txt のまま）
      textSources.push({ sourceFile: f, text });
      // 同名（拡張子なし部分）の sources ファイルをカバー済みとして記録
      const base = f.replace(/\.txt$/, '');
      extractedTxtBasenames.add(base);
    }
  }

  // sources 配下の直接読み取り可能ファイルで、extracted に対応 txt がないものを収集
  const DIRECT_READ_EXTS = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.yaml', '.yml']);
  if (existsSync(sourcesDir)) {
    const files = readdirSync(sourcesDir);
    for (const f of files) {
      const ext = extname(f).toLowerCase();
      if (!DIRECT_READ_EXTS.has(ext)) continue;
      // extracted に同名（拡張子除いた部分）の .txt があればスキップ
      const base = f.replace(/\.[^.]+$/, '');
      if (extractedTxtBasenames.has(base)) continue;
      const filePath = join(sourcesDir, f);
      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const text = raw.trim();
      if (text.length === 0) continue;
      textSources.push({ sourceFile: f, text });
    }
  }

  // sources 配下の PDF を pdftotext で extracted に変換（未変換のものだけ）
  const PDFTOTEXT_BIN = process.env.PDFTOTEXT_BIN || '/usr/bin/pdftotext';
  if (existsSync(sourcesDir)) {
    const files = readdirSync(sourcesDir);
    for (const f of files) {
      if (extname(f).toLowerCase() !== '.pdf') continue;
      // extractedTxtBasenames には "foo.pdf" が入る（extracted/foo.pdf.txt → base="foo.pdf"）
      if (extractedTxtBasenames.has(f)) continue;
      if (!existsSync(extractedDir)) mkdirSync(extractedDir, { recursive: true });
      const txtName = f + '.txt';
      const txtPath = join(extractedDir, txtName);
      if (existsSync(txtPath)) {
        // 変換済み txt を読み込んで追加
        try {
          const text = readFileSync(txtPath, 'utf-8').trim();
          if (text.length > 0) textSources.push({ sourceFile: txtName, text });
        } catch {
          // skip
        }
        continue;
      }
      // pdftotext で変換
      try {
        execFileSync(PDFTOTEXT_BIN, ['-layout', '-enc', 'UTF-8', join(sourcesDir, f), txtPath], {
          timeout: 120_000,
        });
        const text = readFileSync(txtPath, 'utf-8').trim();
        if (text.length > 0) textSources.push({ sourceFile: txtName, text });
      } catch (e) {
        console.warn(
          `[notebook] pdftotext failed for ${f}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  if (textSources.length === 0) {
    // ソースなし → 空索引を保存して OK を返す
    const emptyChunks: Chunk[] = [];
    const meta: IndexMeta = {
      builtAt: new Date().toISOString(),
      chunkCount: 0,
      version: INDEX_VERSION,
    };
    writeFileSync(chunksPath(notebookDir), JSON.stringify(emptyChunks));
    writeFileSync(metaPath(notebookDir), JSON.stringify(meta));
    return { ok: true, chunkCount: 0, fileCount: 0 };
  }

  // チャンク分割
  const allChunkTexts: string[] = [];
  const allChunkMeta: Array<{ sourceFile: string; chunkIndex: number }> = [];

  for (const { sourceFile, text } of textSources) {
    const chunks = splitChunks(text, NOTEBOOK_RAG_CHUNK_SIZE, NOTEBOOK_RAG_CHUNK_OVERLAP);
    for (let i = 0; i < chunks.length; i++) {
      allChunkTexts.push(chunks[i]);
      allChunkMeta.push({ sourceFile, chunkIndex: i });
    }
  }

  // Gemini embed（バッチ）
  // 並列度制限: embedTexts の batchSize で Gemini API 過負荷を回避
  // 将来、複数の embedTexts 呼び出しが必要になった場合は pLimit を使用
  let vectors: number[][];
  try {
    vectors = await embedTexts(allChunkTexts);
  } catch (err) {
    return {
      ok: false,
      chunkCount: 0,
      fileCount: textSources.length,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Chunk 配列を組み立てて保存
  const chunks: Chunk[] = allChunkTexts.map((text, i) => ({
    id: i,
    sourceFile: allChunkMeta[i].sourceFile,
    chunkIndex: allChunkMeta[i].chunkIndex,
    text,
    vector: vectors[i] ?? [],
  }));

  const meta: IndexMeta = {
    builtAt: new Date().toISOString(),
    chunkCount: chunks.length,
    version: INDEX_VERSION,
  };

  writeFileSync(chunksPath(notebookDir), JSON.stringify(chunks));
  writeFileSync(metaPath(notebookDir), JSON.stringify(meta));

  return { ok: true, chunkCount: chunks.length, fileCount: textSources.length };
}

// ─── 索引存在確認 ──────────────────────────────────────────────

/** chunks.json が存在するか確認する。 */
export function indexExists(notebookDir: string): boolean {
  return existsSync(chunksPath(notebookDir));
}

// ─── 検索 ──────────────────────────────────────────────────────

/**
 * コサイン類似度を計算する。denom が 0 なら 0 を返す。
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * クエリテキストをベクトル化し、索引から上位 topK チャンクを返す。
 * - 索引がない場合は [] を返す。
 * - embed 失敗（空ベクトル）の場合は先頭 topK 件を返す。
 */
export async function searchChunks(
  notebookDir: string,
  query: string,
  topK?: number,
): Promise<Chunk[]> {
  const k = topK ?? NOTEBOOK_RAG_TOP_K;

  if (!indexExists(notebookDir)) {
    return [];
  }

  let chunks: Chunk[];
  try {
    const raw = readFileSync(chunksPath(notebookDir), 'utf-8');
    chunks = JSON.parse(raw) as Chunk[];
  } catch {
    return [];
  }

  if (chunks.length === 0) {
    return [];
  }

  // クエリをベクトル化
  let queryVector: number[];
  try {
    queryVector = await embedText(query);
  } catch {
    // embed 失敗 → 先頭 topK 件をフォールバックで返す
    return chunks.slice(0, k);
  }

  // embed が空ベクトル（API キー未設定）→ 先頭 topK 件をフォールバックで返す
  if (queryVector.length === 0) {
    return chunks.slice(0, k);
  }

  // コサイン類似度でランク付け
  const scored = chunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryVector, chunk.vector),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map((s) => s.chunk);
}

// ─── 索引削除 ──────────────────────────────────────────────────

/**
 * chunks.json と meta.json を削除する。ソース削除時のクリーンアップ用。
 * 存在しない場合はスキップする。
 */
export function deleteIndex(notebookDir: string): void {
  const cp = chunksPath(notebookDir);
  const mp = metaPath(notebookDir);
  if (existsSync(cp)) {
    unlinkSync(cp);
  }
  if (existsSync(mp)) {
    unlinkSync(mp);
  }
}
