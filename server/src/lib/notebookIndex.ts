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
import {
  NOTEBOOK_RAG_CHUNK_SIZE,
  NOTEBOOK_RAG_CHUNK_OVERLAP,
  NOTEBOOK_RAG_TOP_K,
  NOTEBOOK_RAG_CANDIDATES,
  NOTEBOOK_RAG_MIN_SCORE,
  NOTEBOOK_RAG_RRF_K,
} from '../config.js';
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

// ─── ハイブリッド検索（キーワード＋ベクトル）の純粋ロジック（MC-223）──────────

/**
 * テキストを簡易トークナイズする。
 * - 英数字（ラテン・数字・記号混じりの ID 含む）は語単位（小文字化）。"MC-202" 等の固有 ID を 1 トークンとして拾う。
 * - 日本語（CJK ひらがな・カタカナ・漢字）は空白で区切れないため文字 bigram（2-gram）に分解する。
 *   1 文字しかない連なりはその 1 文字を 1 トークンにする。
 * 外部ライブラリ非依存。検索のキーワードスコア用。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // 英数字＋ID 的記号（- _ . / 数字）を 1 語として拾う。
  const wordRe = /[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*/g;
  // CJK（ひらがな・カタカナ・CJK統合漢字・長音）の連続。
  const cjkRe = /[぀-ヿ㐀-鿿豈-﫿ー]+/g;

  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(text)) !== null) {
    tokens.push(m[0].toLowerCase());
  }
  while ((m = cjkRe.exec(text)) !== null) {
    const seg = m[0];
    if (seg.length === 1) {
      tokens.push(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.push(seg.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

/**
 * クエリトークンに対するチャンクのキーワードスコアを返す（TF ベースの簡易 BM25 風）。
 * チャンク本文中に現れたクエリトークンの出現数を、頻出語のサチュレーションを掛けて加算する。
 * 固有名詞・ID の完全一致（語トークン一致）も自然に拾える。クエリに無いトークンは無視。
 */
export function keywordScore(queryTokens: string[], chunkText: string): number {
  if (queryTokens.length === 0) return 0;
  const chunkTokens = tokenize(chunkText);
  if (chunkTokens.length === 0) return 0;

  // チャンク内のトークン頻度。
  const tf = new Map<string, number>();
  for (const t of chunkTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  // クエリのユニークトークンごとに、TF サチュレーション（tf/(tf+1.5)）を加算。
  const uniqueQuery = new Set(queryTokens);
  let score = 0;
  for (const qt of uniqueQuery) {
    const freq = tf.get(qt) ?? 0;
    if (freq > 0) score += freq / (freq + 1.5);
  }
  // 長さ正規化: 長いチャンクほど偶発一致しやすいので軽く割り引く。
  const lengthNorm = 1 / (1 + Math.log10(1 + chunkTokens.length / 50));
  return score * lengthNorm;
}

export interface ScoredChunk {
  chunk: Chunk;
  /** ベクトルのコサイン類似度（ベクトル無し検索時は NaN ではなく 0）。 */
  vectorScore: number;
  /** キーワードスコア。 */
  keywordScore: number;
  /** RRF 統合スコア。 */
  rrfScore: number;
}

export interface HybridSearchOptions {
  candidates?: number;
  topK?: number;
  minScore?: number;
  rrfK?: number;
}

/**
 * ベクトル順位とキーワード順位を RRF（Reciprocal Rank Fusion）で統合する純粋関数（テスト可能）。
 * - queryVector が空（embed 未使用）なら vectorScore は全て 0 として扱い、キーワードのみで統合する。
 * - ベクトル閾値 minScore: vectorScore がこの値以上のチャンクのみベクトル候補に含める
 *   （ベクトルが使えない＝queryVector 空のときは閾値ゲートをスキップしキーワードに委ねる）。
 * - 統合後 topK 件を返す。該当（閾値後ベクトル候補 or キーワード候補）が 0 件なら空配列。
 */
export function hybridRank(
  chunks: Chunk[],
  queryVector: number[],
  queryTokens: string[],
  opts: HybridSearchOptions = {},
): ScoredChunk[] {
  const candidates = opts.candidates ?? NOTEBOOK_RAG_CANDIDATES;
  const topK = opts.topK ?? NOTEBOOK_RAG_TOP_K;
  const minScore = opts.minScore ?? NOTEBOOK_RAG_MIN_SCORE;
  const rrfK = opts.rrfK ?? NOTEBOOK_RAG_RRF_K;
  const hasVector = queryVector.length > 0;

  // 全チャンクの両スコアを計算。
  const all = chunks.map((chunk) => ({
    chunk,
    vectorScore: hasVector ? cosineSimilarity(queryVector, chunk.vector) : 0,
    keywordScore: keywordScore(queryTokens, chunk.text),
  }));

  // ベクトルランキング: 閾値を超えるものだけ、降順で上位 candidates。
  const vectorRanked = hasVector
    ? all
        .filter((s) => s.vectorScore >= minScore)
        .sort((a, b) => b.vectorScore - a.vectorScore)
        .slice(0, candidates)
    : [];

  // キーワードランキング: スコア > 0 のものだけ、降順で上位 candidates。
  const keywordRanked = all
    .filter((s) => s.keywordScore > 0)
    .sort((a, b) => b.keywordScore - a.keywordScore)
    .slice(0, candidates);

  // RRF: 各ランキングでの順位から 1/(k + rank + 1) を加算。
  const rrf = new Map<Chunk, number>();
  const addRank = (ranked: typeof all): void => {
    ranked.forEach((s, rank) => {
      rrf.set(s.chunk, (rrf.get(s.chunk) ?? 0) + 1 / (rrfK + rank + 1));
    });
  };
  addRank(vectorRanked);
  addRank(keywordRanked);

  const merged: ScoredChunk[] = [];
  const byChunk = new Map(all.map((s) => [s.chunk, s]));
  for (const [chunk, rrfScore] of rrf) {
    const s = byChunk.get(chunk)!;
    merged.push({ chunk, vectorScore: s.vectorScore, keywordScore: s.keywordScore, rrfScore });
  }
  merged.sort((a, b) => b.rrfScore - a.rrfScore);
  return merged.slice(0, topK);
}

/**
 * クエリテキストでハイブリッド検索（ベクトル＋キーワード RRF＋閾値）を行い、上位チャンクを返す。
 * - 索引がない / 空 → [] を返す。
 * - embed 失敗・未設定（空ベクトル）→ キーワード検索のみで統合する（ベクトル閾値はスキップ）。
 * - 閾値後に候補が 0 件なら [] を返す（呼び出し側で「該当なし」として扱う）。
 */
export async function searchChunks(
  notebookDir: string,
  query: string,
  topK?: number,
): Promise<Chunk[]> {
  return (await searchChunksScored(notebookDir, query, topK)).map((s) => s.chunk);
}

/**
 * searchChunks のスコア付き版（ask 側で診断・閾値判定に使う）。
 */
export async function searchChunksScored(
  notebookDir: string,
  query: string,
  topK?: number,
): Promise<ScoredChunk[]> {
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

  // クエリをベクトル化（失敗・未設定なら空ベクトル＝キーワードのみ）。
  let queryVector: number[];
  try {
    queryVector = await embedText(query);
  } catch {
    queryVector = [];
  }

  const queryTokens = tokenize(query);
  return hybridRank(chunks, queryVector, queryTokens, { topK: topK ?? NOTEBOOK_RAG_TOP_K });
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
