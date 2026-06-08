// notebookIndex ハイブリッド検索の単体テスト（MC-223）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/lib/notebookIndex.search.test.ts （server/ 配下で）
//
// 主眼: tokenize（日本語 bigram + 英数字/ID 語）・keywordScore（固有 ID 完全一致）・
// hybridRank（RRF 統合・ベクトル閾値・該当なし=0件）を純粋関数として検証する。
// Gemini API・ファイル I/O には依存しない。

import assert from 'node:assert/strict';
import { tokenize, keywordScore, hybridRank, type Chunk } from './notebookIndex.js';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// チャンク生成ヘルパ（vector は次元を揃えるだけ）。
function chunk(id: number, sourceFile: string, text: string, vector: number[]): Chunk {
  return { id, sourceFile, chunkIndex: id, text, vector };
}

// ─── 1) tokenize: 英数字/ID は語単位、日本語は bigram ──────────────
check('tokenize は英数字 ID を 1 トークンとして拾い、日本語は bigram に分解する', () => {
  const toks = tokenize('MC-202 の設計');
  assert.ok(toks.includes('mc-202'), 'ID トークン mc-202 を含むべき');
  // 「の設計」→ bigram: の設, 設計
  assert.ok(toks.includes('設計'), 'bigram 設計 を含むべき');
});

// ─── 2) keywordScore: ID 完全一致を拾う ────────────────────────
check('keywordScore は固有 ID を含むチャンクに正のスコアを付ける', () => {
  const q = tokenize('MC-202');
  const hit = keywordScore(q, 'タスク MC-202 はフォールバック実装です。');
  const miss = keywordScore(q, '無関係な文章です。');
  assert.ok(hit > 0, 'ID 一致は正スコア');
  assert.equal(miss, 0, '非一致は 0');
  assert.ok(hit > miss);
});

// ─── 3) hybridRank: 閾値を超えるベクトル候補のみ採用 ────────────
check('hybridRank はコサイン閾値未満のベクトル候補を除外する', () => {
  // queryVector=[1,0]。c1 は同方向（cos=1）、c2 は直交（cos=0 < 0.5）。
  const chunks = [
    chunk(0, 'a.txt', '全く無関係なテキスト', [1, 0]),
    chunk(1, 'b.txt', '別の無関係テキスト', [0, 1]),
  ];
  const res = hybridRank(chunks, [1, 0], [], { minScore: 0.5, topK: 5 });
  // キーワードはヒットしない（クエリトークン空）ので、閾値超えベクトル c1 のみ残る。
  assert.equal(res.length, 1);
  assert.equal(res[0].chunk.sourceFile, 'a.txt');
});

// ─── 4) hybridRank: 該当なし（閾値超えベクトル0＋キーワード0）→ 空 ──
check('hybridRank は閾値超え無し・キーワード無しなら空配列を返す（該当なし）', () => {
  const chunks = [
    chunk(0, 'a.txt', 'apple banana', [0, 1]),
    chunk(1, 'b.txt', 'cherry date', [0, 1]),
  ];
  // queryVector は全チャンクと直交（cos=0 < 0.5）、クエリトークンも本文に無い。
  const res = hybridRank(chunks, [1, 0], tokenize('zebra'), { minScore: 0.5, topK: 5 });
  assert.equal(res.length, 0, '該当なしは 0 件');
});

// ─── 5) hybridRank: キーワードのみ（ベクトル空）でも統合できる ─────
check('hybridRank は queryVector 空でもキーワードのみで候補を返す', () => {
  const chunks = [
    chunk(0, 'a.txt', 'MC-223 のハイブリッド検索を実装する', []),
    chunk(1, 'b.txt', '無関係な記述', []),
  ];
  const res = hybridRank(chunks, [], tokenize('MC-223'), { minScore: 0.5, topK: 5 });
  assert.equal(res.length, 1);
  assert.equal(res[0].chunk.sourceFile, 'a.txt');
});

// ─── 6) hybridRank: ベクトル＋キーワード両ヒットが RRF で上位 ──────
check('hybridRank はベクトルとキーワード両方でヒットしたチャンクを最上位にする', () => {
  const chunks = [
    // c0: ベクトル一致のみ
    chunk(0, 'vec.txt', '関係ないが方向が同じ', [1, 0]),
    // c1: ベクトル一致＋キーワード一致（両方）
    chunk(1, 'both.txt', 'MC-223 の方向も同じ', [1, 0]),
    // c2: キーワード一致のみ（ベクトル直交）
    chunk(2, 'kw.txt', 'MC-223 だが方向違い', [0, 1]),
  ];
  const res = hybridRank(chunks, [1, 0], tokenize('MC-223'), { minScore: 0.5, topK: 3 });
  assert.equal(res[0].chunk.sourceFile, 'both.txt', '両ヒットが 1 位');
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nall notebookIndex search tests passed.');
