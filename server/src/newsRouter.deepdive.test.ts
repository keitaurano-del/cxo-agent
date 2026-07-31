// newsRouter 深掘りAPI 単体テスト（MC-355）
//
// vitest 等は未導入のため node:test + tsx で実行する最小テスト。
//   実行: npx tsx --test src/newsRouter.deepdive.test.ts （server/ 配下で）
//
// 主眼:
//  (a) 入力検証 — 空/非文字列/2000字超の reject、trim、context の 1000 字切り詰め
//  (b) groundingMetadata パース — uri 重複排除・最大6件・title 欠落時は uri で代替・metadata 無し→[]
//  (c) プロンプト組み立て — 選択テキスト/文脈の埋め込み

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDeepdiveInput,
  extractGroundingLinks,
  buildDeepdivePrompt,
} from './newsRouter.js';

// ── (a) 入力検証 ────────────────────────────────────────────────

test('空 body / 空文字 / 非文字列 text は reject', () => {
  for (const body of [undefined, null, {}, { text: '' }, { text: '   ' }, { text: 42 }]) {
    const r = validateDeepdiveInput(body);
    assert.equal(r.ok, false, `body=${JSON.stringify(body)} は reject されるべき`);
  }
});

test('2000字超の text は reject、2000字ちょうどは通る', () => {
  const over = validateDeepdiveInput({ text: 'あ'.repeat(2001) });
  assert.equal(over.ok, false);
  const just = validateDeepdiveInput({ text: 'あ'.repeat(2000) });
  assert.equal(just.ok, true);
});

test('text は trim され、context は 1000 字に切り詰め', () => {
  const r = validateDeepdiveInput({ text: '  消費税減税  ', context: 'x'.repeat(1500) });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, '消費税減税');
    assert.equal(r.context.length, 1000);
  }
});

test('context 未指定・非文字列は空文字扱い', () => {
  const r = validateDeepdiveInput({ text: 'ニュース', context: 123 });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.context, '');
});

// ── (b) groundingMetadata パース ────────────────────────────────

test('groundingChunks から title/url を抽出・uri で重複排除', () => {
  const links = extractGroundingLinks({
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://a.example/1', title: '記事A' } },
            { web: { uri: 'https://a.example/1', title: '記事A（重複）' } },
            { web: { uri: 'https://b.example/2', title: '記事B' } },
            { web: { uri: '', title: '空URIは無視' } },
            {},
          ],
        },
      },
    ],
  });
  assert.deepEqual(links, [
    { title: '記事A', url: 'https://a.example/1' },
    { title: '記事B', url: 'https://b.example/2' },
  ]);
});

test('リンクは最大6件に制限', () => {
  const chunks = Array.from({ length: 10 }, (_, i) => ({
    web: { uri: `https://example.com/${i}`, title: `記事${i}` },
  }));
  const links = extractGroundingLinks({
    candidates: [{ groundingMetadata: { groundingChunks: chunks } }],
  });
  assert.equal(links.length, 6);
});

test('title 欠落時は uri をタイトルとして使う', () => {
  const links = extractGroundingLinks({
    candidates: [
      { groundingMetadata: { groundingChunks: [{ web: { uri: 'https://c.example/3' } }] } },
    ],
  });
  assert.deepEqual(links, [{ title: 'https://c.example/3', url: 'https://c.example/3' }]);
});

test('groundingMetadata が無い応答は []（explanation のみ返せる）', () => {
  assert.deepEqual(extractGroundingLinks({}), []);
  assert.deepEqual(extractGroundingLinks({ candidates: [{}] }), []);
  assert.deepEqual(extractGroundingLinks({ candidates: [{ groundingMetadata: {} }] }), []);
});

// ── (c) プロンプト組み立て ───────────────────────────────────────

test('プロンプトに選択テキストと文脈が入る', () => {
  const p = buildDeepdivePrompt('Rapidus 2nm', '## 今日の経済');
  assert.ok(p.includes('Rapidus 2nm'));
  assert.ok(p.includes('## 今日の経済'));
  assert.ok(p.includes('これはこういうことです'));
});

test('文脈なしでもプロンプトが成立する', () => {
  const p = buildDeepdivePrompt('消費税', '');
  assert.ok(p.includes('消費税'));
  assert.ok(!p.includes('周辺の見出し'));
});
