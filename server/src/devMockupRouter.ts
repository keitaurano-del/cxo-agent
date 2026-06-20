// devMockupRouter — 開発ページの AI モックアップ REST API（auth ミドルウェア配下）。
//
//  POST   /api/dev/mockup/generate    : { prompt, baseHtml?, instruction? } → 202 { jobId }（非同期ジョブ）
//  GET    /api/dev/mockup/job/:jobId  : ポーリング用。
//      { status:'pending'|'generating'|'done'|'error', html?, partial?, plan?, thinking?, mockupId?, error?, saved?:[{id,title}] }
//      partial は生成途中の部分 HTML（ストリーム中）。クライアントはこれを逐次表示してコードをライブに見せる。
//      plan は HTML を書き始める前の「作り方」メモ（設計説明）。HTML が来るまで “考え中” の表示に使う。
//      thinking は拡張思考（AI の素の思考）。最初のフェーズで「何をどう考えているか」を見せる。
//      partial/plan/thinking は error（時間切れ等）でも返す＝失敗時も「どこまで考え・書けたか」を残す。
//      新規生成も修正も「1 つの動くインタラクティブな単一 HTML プロトタイプ」を生成し、完了時に自動保存する。
//      saved は後方互換のため単一画面でも [{id,title}] 1 件を入れる。
//  GET    /api/dev/mockups          : { mockups: [{id,title,prompt,createdAt,updatedAt}] }（html 除く軽量）
//  GET    /api/dev/mockups/:id       : { mockup: {…,html} }
//  POST   /api/dev/mockups           : { id?, title, html, prompt? } → upsert（保存結果を返す）
//  DELETE /api/dev/mockups/:id        : 論理削除 { ok:true }
//
// 生成は plannerEstimate.ts の流儀を踏襲して claude CLI を安全起動する:
//   execFile(NOTEBOOK_CLAUDE_BIN, ['--model', model, '-p', prompt], {timeout, maxBuffer, env})
//   NUL バイトはプロンプトから除去し、execFile 自体も try/catch で囲って落とさない。
// 保存先はすべて data/ 配下（.gitignore 済み）。

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';

import {
  NOTEBOOK_CLAUDE_BIN,
  NOTEBOOK_CLAUDE_MODEL,
  DEV_MOCKUP_FALLBACK_MODEL,
  DEV_WIREFRAMES_DIR,
} from './config.js';
import {
  deleteMockup,
  getMockup,
  listMockups,
  listReferenceMockups,
  setImplSpec,
  setRating,
  upsertMockup,
} from './lib/devMockupStore.js';
import {
  generateFigmaWireframes,
  type WireframeScreenSpec,
} from './lib/devFigmaWireframes.js';
import { withClaudeSlot } from './lib/notebookClaude.js';

// ─── claude CLI（HTML 生成）──────────────────────────────────

/** コード生成 1 回あたりのタイムアウト（ミリ秒）。非同期ジョブ化済みでエッジ上限から外れている。
 *  多段フローでは設計＋デザインシステム込みの 3 画面級アプリだと 240s では足りず時間切れ→未保存に
 *  なっていた（実測: ぴよログ級でコード段が 240s タイムアウト）。最終段＝最重要なので 420s に広げる。
 *  タイムアウト時はリトライしない（重すぎ＝再試行しても無駄に待たせるだけ）ので、これが実質
 *  「コード段で諦めるまでの最大待ち時間」になる。 */
const GENERATE_TIMEOUT_MS = 420_000;

/** 仕上げレビュー(P2)専用の短いタイムアウト。レビューは「速い時だけ磨く」ベストエフォートなので、
 *  長く待たない。超えたら元 HTML を保持してすぐ完了させる（重い割に無改善で待たせるのを防ぐ）。 */
const REVIEW_TIMEOUT_MS = 180_000;

/** HTML は大きくなり得るため maxBuffer を広めに取る（8MB）。 */
const GENERATE_MAX_BUFFER = 8 * 1024 * 1024;

/** 生成 HTML の出力ルール（厳守させる共通指示）。 */
const HTML_RULES = [
  '出力は「完全な単一 HTML5 ドキュメント」だけにしてください。必ず <!DOCTYPE html> から始め、',
  '<html>...</html> で完結させます。',
  '自己完結させること: CSS は <style>、JS は <script> でインラインに含める。',
  'Tailwind 等の CDN は使ってもよいが、極力自己完結を優先する。',
  'UI 文言は日本語で構いません。レスポンシブにすること。',
  'コードの要所（レイアウト/デザイン/各操作の動きのまとまり）の先頭に、プログラミング未経験者でも',
  '何をしているか分かる短い日本語コメントを入れること（例: <!-- ボタンを押したら数字を増やす --> や',
  '/* 画面の配色・余白の設定 */）。コメントは要点だけ・専門用語を避け、入れすぎないこと。',
  '重要: ---HTML--- 以降は、マークダウンや ``` のコードフェンス・説明文を一切入れず、HTML 本文のみを出力すること。',
].join('\n');

/**
 * 「先に作り方（設計）を平易な日本語で書いてから HTML を書く」ための共通指示。
 * 出力は必ず「作り方メモ → ---HTML--- だけの行 → HTML 本文」の順。
 * サーバは ---HTML--- で分割し、メモを “考え中” のライブ表示に、本文を保存用 HTML に使う。
 */
const PLAN_MARKER = '---HTML---';

/** インタラクティブな「動く試作品」を作らせるための共通指示。新規生成・修正の両方で結合する。 */
const INTERACTIVE_RULES = [
  '作るのは「1 つの完結した、実際に動くインタラクティブな試作品」です。すべてを単一 HTML に収め、',
  '別ファイル・別画面には分けないこと。',
  'ボタン・タブ・フォーム等の操作は実際に動かすこと。インライン <script> でクリックやイベントに反応させる。',
  '複数の画面/状態が必要な場合は、別ページに分けず、同一ページ内で JS により表示を切り替える',
  '（ビュー切替・モーダル・タブ等）。',
  'このサービスの「主要な動作」は必ずサンプルで実演すること: ユーザーが主要ボタンを押したら、その結果が',
  '実際に画面に現れるようにする。例: サムネ生成ならクリックでサンプルのサムネイルが生成・表示される /',
  '検索なら結果一覧が出る / 送信なら完了状態が出る。ダミーデータでよいが「動いた手応え」が見えること。',
  '画像やサムネ等は、外部ネットワークに依存しないプレースホルダ（CSS で描画した図形・SVG・data URI・',
  'グラデーション等）で見栄え良く表現すること。プレビューは sandbox=allow-scripts で同一オリジン無しのため、',
  '外部画像・外部 API・外部スクリプトへの依存は避ける。',
  '機能や装飾を盛り込みすぎないこと。要望の「主要な動作 1 つ」が動く、要点に絞ったコンパクトな単一画面にする。',
  '生成を速く確実に終わらせるため、HTML を不必要に大きくしない（過剰な画面数・大量のダミーデータは避ける）。',
].join('\n');

/**
 * デザインシステム指示（MC-252 P1）。obsidian-vault/20-Knowledge/design/mobile-ui-design-fundamentals
 * を蒸留した、見た目と画面構成の質を担保する具体基準（一次情報: WCAG2.2 / Material3 / Android a11y / NN/g）。
 * 生成・修正の両方に結合し、「良いトークン体系の枠内で組ませる」ことで平均品質を底上げする。
 */
const DESIGN_SYSTEM_RULES = [
  '【デザイン基準】見た目と画面構成の質を担保するため、次を必ず守ること。',
  '1. 冒頭の <style> で必ず CSS 変数としてデザイントークンを定義し、以降は色・余白・角丸・影・文字サイズを',
  '   原則この変数だけで指定する（場当たりな値を散らさない）。出発点（題材に合わせ配色は変えてよいが、',
  '   必ず役割ベース＋下のコントラスト基準を満たすこと）:',
  '   :root{',
  '     --surface:#ffffff; --surface-container:#f4f6f8; --surface-container-high:#eceff2;',
  '     --text:#1a1d1f; --text-muted:#5b6470; --outline:#d4d9de;',
  '     --primary:#2f6fed; --on-primary:#ffffff; --primary-weak:#e8f0fe;',
  '     --success:#1e8e5a; --warning:#b7791f; --error:#d23b3b; --on-error:#ffffff;',
  '     --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-6:24px; --space-8:32px; --space-12:48px;',
  '     --radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-pill:999px;',
  '     --shadow-1:0 1px 2px rgba(0,0,0,.08); --shadow-2:0 2px 6px rgba(0,0,0,.10); --shadow-3:0 6px 16px rgba(0,0,0,.12);',
  '     --text-caption:.75rem; --text-body:1rem; --text-title:1.25rem; --text-headline:1.5rem; --text-display:2rem;',
  '   }',
  '2. 文字: 本文は16px(1rem)以上（モバイルで縮小させない）。行間1.5。見出しは大きさと太さで階層を作る。',
  '3. 余白: 8pxグリッド（4/8/12/16/24/32/48）のみを使い、半端な値・不揃いを避ける。画面端の余白は16px基準。',
  '4. コントラスト: 本文は背景に対し4.5:1以上、境界線/アイコン/UI部品は3:1以上。白地に薄いグレー文字を置かない。',
  '5. 視覚的階層: 1画面で目立たせる主アクションは1つだけ。ボタンは primary/secondary/text の強弱をつける。',
  '6. 深さ: カードやシートは影だけに頼らず、面の色(--surface-container 系)で背景と差をつける。影は補助。',
  '7. タップ領域: 押せる要素は最小48px(縦横)・要素間8px以上。主要操作は画面下部の親指が届く位置に置く。',
  '8. 状態: 内容に応じて空/読み込み/エラーの状態も設計する。空はCTA付き、エラーは該当箇所の近くにインライン＋',
  '   平易な日本語で示す。状態は色だけでなくアイコンや文言も添える（色だけに頼らない）。',
  '9. モーション: 使うなら100〜300msで控えめに。自動でずっと動き続けるもの（自動カルーセル等）は付けない。',
].join('\n');

/** 完成前の自己点検リスト（B ルーブリックの軽量版。HTML を出す直前にモデル自身に点検させる）。 */
const DESIGN_SELF_CHECK = [
  '【完成前チェック】HTML を出力する前に次を自己点検し、外れていれば直してから出すこと:',
  '- 本文16px以上 / 余白は8pxグリッド / 低コントラストの文字・境界が無い',
  '- 主アクションが1つ明確 / カードは面の色で背景と差がついている / ボタンに強弱がある',
  '- 押せる要素が十分大きく間隔がある / 該当する画面では空・エラー状態も用意した',
].join('\n');

// ─── 4段フロー: 設計ステージ ──────────────────────────────
//
// 生成モードは「思考 → 設計書 → Figma ワイヤーフレーム → コーディング」の多段で進める。
// 設計ステージは要望から (1) 平易な日本語の設計書（作り方）と (2) 画面リスト（JSON）を出させる。
// 出力は「設計書 → ---SCREENS--- だけの行 → JSON」の順。サーバはこの境界で分割する。

const SCREENS_MARKER = '---SCREENS---';

/** 1 画面ぶきの仕様（設計ステージが洗い出す）。Figma・コードへ渡す。 */
interface ScreenSpec {
  name: string;
  description: string;
}

/** 設計ステージのプロンプト（設計書＋画面リスト JSON を出させる）。 */
function buildDesignPrompt(prompt: string): string {
  return [
    'あなたは、これから作る試作品の設計を行う UX デザイナー兼プランナーです。',
    'まだコードは書きません。次の要望に対して「何を作るか」の設計を行ってください。',
    '',
    '要望:',
    prompt,
    '',
    '頭の中で考えるときも、できるだけ日本語で考えてください。',
    'まず「設計書」を、プログラミング未経験の人にも分かる平易な日本語で 5〜10 行で書いてください。',
    '次の観点を簡潔に（箇条書き中心・専門用語は避ける）: 何のための画面/機能か / どんな画面が必要か（複数なら列挙）/',
    '各画面に置く主な部品（ボタン・入力欄・一覧など）/ 主要ボタンを押すと何が起きるか / 配色や雰囲気の方針。',
    '',
    `設計書を書き終えたら、次の行に ${SCREENS_MARKER} とだけ書いた行を 1 行入れ、その直後に`,
    'この試作品に必要な画面を、次の厳密な JSON 配列だけで出力してください（説明文・コードフェンス内外いずれでも可）:',
    '[',
    '  { "name": "画面名（短く）", "description": "その画面に何を置き何ができるか 1〜2 文" }',
    ']',
    '画面は本当に必要な数だけ（できるだけ少なく・最大 3 画面まで）。単一画面で十分なら 1 件でよい。',
    '画面が多いほど後段のワイヤーフレーム作成が遅くなるため、主要な画面に絞ること。',
  ].join('\n');
}

/**
 * 設計ステージ出力を「設計書（designDoc）」と「画面リスト（screens）」に分割する。
 * マーカー未到達時は designDoc は全文・screens は []（＝まだ設計中）。
 */
function splitDesignScreens(out: string): { designDoc: string; screens: ScreenSpec[] } {
  const text = out || '';
  const idx = text.indexOf(SCREENS_MARKER);
  if (idx === -1) return { designDoc: text.trim(), screens: [] };
  const designDoc = text.slice(0, idx).trim();
  const rest = text.slice(idx + SCREENS_MARKER.length);
  // rest から JSON 配列を取り出す。```json フェンス優先、無ければ最初の [ … 最後の ]。
  let jsonText = '';
  const fence = rest.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    jsonText = fence[1].trim();
  } else {
    const open = rest.indexOf('[');
    const close = rest.lastIndexOf(']');
    if (open !== -1 && close > open) jsonText = rest.slice(open, close + 1);
  }
  const screens: ScreenSpec[] = [];
  if (jsonText) {
    try {
      const arr = JSON.parse(jsonText) as unknown;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const o = (item ?? {}) as Record<string, unknown>;
          const name = typeof o.name === 'string' ? o.name.trim() : '';
          const description = typeof o.description === 'string' ? o.description.trim() : '';
          if (name) screens.push({ name, description });
        }
      }
    } catch {
      /* JSON 不正なら screens 空のまま（呼び出し側がフォールバックする）。 */
    }
  }
  return { designDoc, screens };
}

/**
 * Keita が 👍 した過去の試作品（手本）から「参考スタイル」ガイダンスを組み立てる（MC-252 P3）。
 * 全 HTML はプロンプトを肥大させるので入れず、各手本の :root デザイントークン＋設計書要約だけを
 * 抜き出して「この雰囲気・トークンに寄せて（内容はコピーしない）」と差し込む。手本が無ければ ''。
 */
function buildReferenceGuidance(): string {
  const refs = listReferenceMockups(2);
  if (refs.length === 0) return '';
  const blocks = refs.map((m, i) => {
    const root = (m.html || '').match(/:root\s*\{[\s\S]*?\}/);
    const tokens = root ? root[0] : '（トークン定義なし）';
    const doc = (m.designDoc || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    return [
      `手本${i + 1}「${m.title}」${doc ? `: ${doc}` : ''}`,
      '  使っていたデザイントークン:',
      tokens
        .split('\n')
        .map((l) => `  ${l.trim()}`)
        .join('\n'),
    ].join('\n');
  });
  return [
    '【参考にする手本（Keita が良いと評価したデザイン）】',
    '次の試作品の配色・トークン・余白・トーンの雰囲気を参考に、似た質感で作ってください。',
    'ただし内容・レイアウト・機能はあくまで今回の要望と設計書に従い、手本の中身はコピーしないこと。',
    ...blocks,
  ].join('\n');
}

/**
 * 設計書＋画面リスト（＋Figma で作ったワイヤーフレームの有無）を元に、動く単一 HTML を作らせる。
 * 設計は済んでいるので作り方メモ（PLAN_RULES）は付けず、HTML 本文だけを書かせる。
 * referenceGuidance には 👍 手本のスタイル参考（あれば）を渡す。
 */
function buildCodeFromDesignPrompt(
  prompt: string,
  designDoc: string,
  screens: ScreenSpec[],
  wireframed: boolean,
  referenceGuidance: string,
): string {
  const screenLines = screens.length
    ? screens.map((s, i) => `${i + 1}. ${s.name}: ${s.description}`).join('\n')
    : '（単一画面）';
  return [
    'あなたは、確定した設計を元に、動くインタラクティブな試作品を HTML で作るフロントエンドエンジニアです。',
    '次の設計書と画面リストに忠実に、実際に操作できる試作品を 1 つ作成してください。',
    '',
    '元の要望:',
    prompt,
    '',
    '設計書:',
    designDoc || '（特になし）',
    '',
    `必要な画面（${screens.length || 1} 画面）:`,
    screenLines,
    wireframed
      ? '\nこの設計を元に Figma で各画面のワイヤーフレームを作成済みです。レイアウト・情報設計は設計書と画面リストに沿わせてください。'
      : '',
    '',
    '複数画面がある場合も、別ファイル・別ページに分けず、同一 HTML 内で JS により表示を切り替えること',
    '（タブ・ビュー切替・モーダル等）。設計書の各画面をこの 1 つの試作品の中で行き来できるようにする。',
    '',
    INTERACTIVE_RULES,
    '',
    DESIGN_SYSTEM_RULES,
    ...(referenceGuidance ? ['', referenceGuidance] : []),
    '',
    DESIGN_SELF_CHECK,
    '',
    HTML_RULES,
  ].join('\n');
}

/**
 * 仕上げレビュー（MC-252 P2）のプロンプト。生成済み HTML をデザインルーブリックで自己点検し、
 * 機能・内容・文言は一切変えずに「見た目と画面構成」だけを基準に寄せて改善した HTML 全体を返させる。
 * 出力は HTML 本文のみ（説明・フェンス禁止）。
 */
function buildReviewPrompt(html: string): string {
  return [
    'あなたは、できあがった HTML 試作品の「デザイン仕上げ（design review）」を行うシニア UI デザイナーです。',
    '次の HTML を下のチェックリストで点検し、引っかかる点だけを直して、改善後の HTML 全体を返してください。',
    '',
    '厳守: 機能・JavaScript の挙動・文言・データ・画面構成（どんな部品があるか）は変えないこと。',
    '変えてよいのは見た目（配色・余白・サイズ・整列・階層・角丸・影・状態表現）だけ。新機能や別画面を足さない。',
    'すでに良い箇所はそのまま残す。ゼロから作り直さない（差分は最小限）。',
    '',
    'チェックリスト（外れていれば直す）:',
    '- 本文は16px(1rem)以上 / 行間1.5 / 見出しはサイズと太さで階層がある',
    '- 余白は8pxグリッド(4/8/12/16/24/32/48)で一貫・不揃いや過密が無い',
    '- 本文のコントラストが背景に対し4.5:1以上、境界線/アイコン/UI部品は3:1以上（薄いグレー文字を白地に置かない）',
    '- 1画面で目立つ主アクションは1つ / ボタンに primary/secondary/text の強弱がある',
    '- カードやシートは面の色で背景と差がつく（影だけに頼らない）',
    '- 押せる要素は最小48px・要素間8px以上 / 主要操作は親指の届く下部',
    '- 色だけで状態を示さない（必ずアイコンや文言を添える）/ 必要なら空・エラー状態がある',
    '- 過度なアニメーション(>500ms)や自動で動き続けるものが無い',
    '- 可能なら配色・余白は CSS 変数(:root のトークン)に整理して一貫させる',
    '',
    HTML_RULES,
    '',
    '点検対象の HTML:',
    html,
  ].join('\n');
}

/**
 * 高速モード（Figma なし）用の単一呼び出しプロンプト。設計ステージを分けず、要望から直接 HTML を作らせる。
 * 設計は頭の中で素早く済ませてすぐ書き始めるよう促し、2 回の AI 呼び出しを 1 回に圧縮して速くする。
 * 設計システム・手本・自己チェックは付与して品質は保つ。
 */
function buildFastGeneratePrompt(prompt: string, referenceGuidance: string): string {
  return [
    'あなたは、動くインタラクティブな試作品を HTML で作るデザイナー兼フロントエンドエンジニアです。',
    '次の要望に対して、実際に操作できる試作品を 1 つ作成してください。',
    '設計は頭の中で手短に済ませ、長く考え込まずにすぐ作り始めること（速さを優先）。',
    '',
    '要望:',
    prompt,
    '',
    INTERACTIVE_RULES,
    '',
    DESIGN_SYSTEM_RULES,
    ...(referenceGuidance ? ['', referenceGuidance] : []),
    '',
    DESIGN_SELF_CHECK,
    '',
    HTML_RULES,
  ].join('\n');
}

/** 反復修正のプロンプトを組み立てる（baseHtml 全体を修正指示で書き換え、HTML 全体を返す）。 */
function buildRevisePrompt(baseHtml: string, instruction: string): string {
  return [
    'あなたは、動くインタラクティブな試作品を HTML で修正するデザイナー兼フロントエンドエンジニアです。',
    '次の指示に従って、以下の HTML 全体を修正してください。修正後の HTML 全体を返します。',
    '修正後も「実際に操作できる動くインタラクティブな HTML」を保つこと（ボタン等は引き続き動かす）。',
    '指示に無い箇所のデザイン（配色・余白・トークン・レイアウト）は崩さず維持し、下のデザイン基準にも沿わせること。',
    '',
    '指示:',
    instruction,
    '',
    '頭の中で考えるときも、できるだけ日本語で考えてください。',
    `まず、これから行う修正の「作り方」を平易な日本語で 3〜6 行で説明してください（どこを・どう変えるか・狙い）。`,
    `説明を書き終えたら、次の行に ${PLAN_MARKER} とだけ書いた行を 1 行入れ、その直後の行から修正後の単一 HTML ドキュメント本文だけを出力してください。`,
    '',
    DESIGN_SYSTEM_RULES,
    '',
    HTML_RULES,
    '',
    '修正対象の HTML:',
    baseHtml,
  ].join('\n');
}

/**
 * 出力から ```html / ``` のコードフェンスを除去し、HTML 本文を取り出す。
 * フェンスが無ければそのまま trim して返す。
 */
function stripFences(out: string): string {
  let s = (out || '').trim();
  // 先頭の ```html / ``` を除去。
  const fenceStart = /^```(?:html|HTML)?\s*\n?/;
  if (fenceStart.test(s)) {
    s = s.replace(fenceStart, '');
    // 末尾の閉じフェンス。
    s = s.replace(/\n?```\s*$/, '');
  }
  return s.trim();
}

/**
 * 出力を「作り方メモ（plan）」と「HTML 本文（html）」に分割する。
 * モデルは PLAN_MARKER（---HTML---）を境にメモ→HTML の順で出力する。
 * - マーカーがまだ来ていない/無い場合: plan は全文、html は ''（＝まだ設計中）。
 *   ただし旧仕様（メモ無しでいきなり HTML）との後方互換のため、本文が HTML タグで
 *   始まっているとみなせる時は html 側に倒す。
 */
function splitPlanHtml(out: string): { plan: string; html: string } {
  const text = out || '';
  const idx = text.indexOf(PLAN_MARKER);
  if (idx !== -1) {
    return { plan: text.slice(0, idx).trim(), html: text.slice(idx + PLAN_MARKER.length) };
  }
  // マーカー未到達: 既に HTML らしき出力が始まっているなら html、まだなら plan とみなす。
  if (/<!DOCTYPE|<html/i.test(text)) return { plan: '', html: text };
  return { plan: text, html: '' };
}

/** claude CLI 1 回ぶんの生実行結果（throw せずここに集約する）。 */
interface RawRun {
  /** stdout 全文（成功・失敗とも。部分出力があれば失敗時も入る）。 */
  stdout: string;
  /** エラー時のメッセージ（成功なら undefined）。stderr の先頭を含める。 */
  error?: string;
  /** タイムアウト kill されたか。 */
  timedOut: boolean;
}

/**
 * claude CLI を指定モデルで 1 回起動し、出力をトークン単位で逐次ストリームする。throw せず RawRun で返す。
 *
 * プレーンな `-p` は結果を最後に一括で吐く（＝逐次表示できない）ため、
 * `--output-format stream-json --include-partial-messages --verbose` を使い、NDJSON の
 * `content_block_delta` からテキスト差分を取り出して積み上げる。onChunk には「これまでの本文全文」を
 * 都度渡す＝呼び出し側が書かれていくコードをライブ表示できる。
 *
 * 共有セマフォ（ノートブック Q&A と同じ枠）の中で実行し、同時実行による利用上限エラーを抑える。
 * 失敗/タイムアウト/NUL ガード後の例外もすべて RawRun.error に集約する（サーバを落とさない）。
 */
function runClaudeRaw(
  prompt: string,
  model: string,
  onChunk?: (accumulated: string, thinking: string) => void,
  timeoutMs: number = GENERATE_TIMEOUT_MS,
): Promise<RawRun> {
  // 引数に NUL バイトがあると spawn が throw し得る。想定外の制御文字でサーバを落とさないよう、
  // (1) プロンプトから NUL を除去し、(2) spawn 自体も try/catch で囲う。
  const safePrompt = prompt.replace(/\x00/g, '');
  return withClaudeSlot(
    () =>
      new Promise<RawRun>((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(
            NOTEBOOK_CLAUDE_BIN,
            [
              '--model',
              model,
              '--output-format',
              'stream-json',
              '--include-partial-messages',
              '--verbose',
              '-p',
              safePrompt,
            ],
            { env: process.env },
          );
        } catch (e) {
          resolve({ stdout: '', timedOut: false, error: `claude 起動失敗: ${(e as Error).message}` });
          return;
        }

        let body = ''; // content_block_delta を積み上げた本文（= 生成中の作り方+HTML）。
        let thinking = ''; // thinking_delta を積み上げた「AI の思考」（拡張思考。ライブ表示用）。
        let resultText = ''; // result イベントの最終本文（delta が無い場合のフォールバック）。
        let lineBuf = ''; // 行跨ぎ JSON のための未処理バッファ。
        let stderr = '';
        let limitError = ''; // 利用上限を示すイベントを拾ったら入れる（isLimitFailure 用）。
        let resultError = ''; // result イベントが is_error のときの詳細。
        let timedOut = false;
        let settled = false;
        const done = (r: RawRun): void => {
          if (settled) return;
          settled = true;
          resolve(r);
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs);

        try {
          child.stdin?.end();
        } catch {
          /* noop */
        }

        // NDJSON を 1 行ずつ解釈し、本文差分を積み上げる。
        const handleLine = (line: string): void => {
          const s = line.trim();
          if (!s) return;
          let o: Record<string, unknown>;
          try {
            o = JSON.parse(s) as Record<string, unknown>;
          } catch {
            return; // 壊れた/部分行は無視。
          }
          const type = o.type as string | undefined;
          if (type === 'stream_event') {
            const ev = (o.event ?? {}) as Record<string, unknown>;
            if (ev.type === 'content_block_delta') {
              const delta = (ev.delta ?? {}) as Record<string, unknown>;
              const text = typeof delta.text === 'string' ? delta.text : '';
              // 拡張思考の差分。本文を書き始める前の「AI が何をどう考えているか」をそのまま見せる。
              const think = typeof delta.thinking === 'string' ? delta.thinking : '';
              if (text && body.length + text.length <= GENERATE_MAX_BUFFER) {
                body += text;
                if (onChunk) onChunk(body, thinking);
              }
              if (think && thinking.length + think.length <= GENERATE_MAX_BUFFER) {
                thinking += think;
                if (onChunk) onChunk(body, thinking);
              }
            }
          } else if (type === 'result') {
            if (typeof o.result === 'string') resultText = o.result;
            if (o.is_error === true) {
              resultError = `claude エラー: ${String(o.subtype ?? 'error')} ${String(o.result ?? '')}`.trim();
            }
          } else if (type === 'rate_limit_event') {
            const info = (o.rate_limit_info ?? {}) as Record<string, unknown>;
            // status が allowed 以外（rejected/blocked 等）なら利用上限とみなす。
            if (typeof info.status === 'string' && info.status !== 'allowed') {
              limitError = `rate limit: ${info.status}`;
            }
          }
        };

        child.stdout?.on('data', (chunk: Buffer) => {
          lineBuf += chunk.toString();
          let nl: number;
          while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const line = lineBuf.slice(0, nl);
            lineBuf = lineBuf.slice(nl + 1);
            handleLine(line);
          }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          if (lineBuf.trim()) handleLine(lineBuf); // 残りの最終行。
          const out = body || resultText;
          if (timedOut) {
            done({
              stdout: out,
              timedOut: true,
              error: `claude タイムアウト（${Math.round(timeoutMs / 1000)}s）`,
            });
            return;
          }
          // 利用上限・result エラーは error に載せる（isLimitFailure が error 文字列を見て fallback 判定）。
          if (limitError) {
            done({ stdout: out, timedOut: false, error: limitError });
            return;
          }
          if (code !== 0) {
            const detail = stderr ? ` | ${stderr.slice(0, 500)}` : '';
            done({ stdout: out, timedOut: false, error: `claude 実行失敗（終了コード ${code}）${detail}` });
            return;
          }
          if (resultError) {
            done({ stdout: out, timedOut: false, error: resultError });
            return;
          }
          done({ stdout: out, timedOut: false });
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          done({ stdout: body || resultText, timedOut: false, error: `claude 実行失敗: ${err.message}` });
        });
      }),
  );
}

/**
 * 失敗が「利用上限（Sonnet limit / usage limit / rate limit 等）」由来かを判定する。
 * notebookClaude.isLimitFailure と同じ語彙。検出したら fallback（Opus）へ切替える。大文字小文字無視。
 */
function isLimitFailure(r: RawRun): boolean {
  const h = `${r.stdout || ''}\n${r.error || ''}`.toLowerCase();
  if (h.includes('hit your') && h.includes('limit')) return true;
  return (
    h.includes('usage limit') ||
    h.includes('rate limit') ||
    h.includes('rate_limit') ||
    h.includes('rate-limited') ||
    h.includes('reached your') ||
    (h.includes('exceeded') && h.includes('limit'))
  );
}

// ─── 非同期ジョブストア ──────────────────────────────────
//
// Cloudflare エッジ（cloudflared トンネル）には約 100s の上限があり、claude CLI が
// 競合等で遅いと 524 になる。生成をバックグラウンドジョブ化し、POST は即 202 で jobId を返し、
// フロントは GET /job/:id をポーリングする。これでエッジ上限に縛られなくなる。
// ジョブはインメモリ（プロセス再起動で消える）。

type JobStatus = 'pending' | 'generating' | 'done' | 'error';
/** 多段フローの現在ステージ（設計→ワイヤーフレーム→コード→仕上げレビュー）。修正(revise)では未使用。 */
type JobStage = 'design' | 'wireframe' | 'code' | 'review';
interface Job {
  status: JobStatus;
  /** 現在のステージ（4段フロー。クライアントが「いま何をしているか」を出し分けるのに使う）。 */
  stage?: JobStage;
  /** 生成された HTML。 */
  html?: string;
  /** 生成途中の部分 HTML（ストリーム中の最新 stdout。ライブ表示用）。 */
  partial?: string;
  /** 生成途中の「作り方」メモ（HTML を書き始める前の設計説明。ライブ表示用）。 */
  plan?: string;
  /** 生成途中の「AI の思考」（拡張思考。作り方より前段の、何をどう考えているか。ライブ表示用）。 */
  thinking?: string;
  /** 設計書（作り方）。設計ステージが確定したもの。完成後も保持して「何を作ったか」を示す。 */
  designDoc?: string;
  /** 設計ステージが洗い出した画面リスト。 */
  screens?: ScreenSpec[];
  /** Figma ワイヤーフレーム結果（fileUrl ＋ 各画面の保存画像）。dir は画像配信のキー（=jobId）。 */
  wireframe?: { fileUrl?: string; dir: string; screens: { name: string; image?: string }[] };
  /** ワイヤーフレーム生成中の進捗メッセージ（ツール実行ベース。ライブ表示用）。 */
  wireframeProgress?: string;
  /** 実装仕様書（Markdown）。spec 生成ジョブが書き込む（MC-253）。生成中はライブに伸びる。 */
  spec?: string;
  error?: string;
  /** 保存先 id（クライアントが currentId に反映できる）。 */
  mockupId?: string;
  /** 自動保存できた結果（単一画面でも [{id,title}] 1 件を入れて後方互換を保つ）。 */
  saved?: { id: string; title: string }[];
  createdAt: number;
}

/** jobId → Job。インメモリのみ。 */
const jobs = new Map<string, Job>();

/** 完了/失敗ジョブの保持期間（15 分）。クライアントは完了後すぐ取りに来るのでこれで十分。 */
const JOB_TTL_MS = 15 * 60_000;

/**
 * 実行中（pending/generating）ジョブの絶対上限（万一スタックした時の安全弁）。
 * 多段フロー1本の最大実行時間（設計＋Figma 最大10分＋コード最大8分）に順番待ちを足しても
 * 収まる長さにする。これ未満は TTL で消さない＝「順番待ち/長い Figma 工程の最中に消えて
 * 404 になる」事故を防ぐ。 */
const JOB_ACTIVE_MAX_MS = 40 * 60_000;

/**
 * サーバ側リトライ: 最大試行回数と試行間バックオフ。エッジ上限から外れたので安全に複数回試せる。
 * 3 回にして「一過性失敗の再試行」と「利用上限時の Opus フォールバック」の両方に枠を確保する。
 */
const GENERATE_MAX_ATTEMPTS = 3;
const GENERATE_RETRY_BACKOFF_MS = 5_000;

/** 生成失敗の分類。原因に応じてユーザ向けメッセージを変える。 */
type GenFailReason = 'limit' | 'timeout' | 'empty' | 'error';

/** 生成の結果。html が取れれば html、ダメなら reason（＋デバッグ用 detail）。 */
interface GenResult {
  html: string | null;
  reason?: GenFailReason;
  detail?: string;
}

/** 分類ごとのユーザ向け失敗メッセージ（原因が分かるように出し分ける）。 */
const GENERATE_FAILURE_MESSAGES: Record<GenFailReason, string> = {
  limit:
    '生成エンジンが利用上限に達しました（フォールバックでも生成できませんでした）。時間をおいて再度お試しください。',
  timeout:
    '時間内（約4分）に作り終わりませんでした。AI がここまで考えた内容と書いたコードは下に残しています。要望をもう少し絞る（画面1つ・機能1つ）と完成しやすくなります。',
  empty:
    'AI が完成した HTML を返しませんでした（途中で迷った可能性があります）。下に残した思考・作り方を見つつ、要望を少し具体的にして再度お試しください。',
  error:
    '生成に失敗しました。生成エンジンが混み合っているか一時的に失敗した可能性があります。少し待ってもう一度お試しください。',
};

/** 互換用エイリアス（汎用失敗時のデフォルト文言）。 */
const GENERATE_FAILURE_MESSAGE = GENERATE_FAILURE_MESSAGES.error;

/**
 * 古いジョブを破棄する（アクセス時に呼ぶ・サーバを汚さない）。
 * 実行中（pending/generating）は TTL では消さない＝順番待ちや長い Figma 工程の最中に
 * 消えてポーリングが 404（「もう一度お試しください」）になる事故を防ぐ。
 * 終了済み（done/error）は TTL（15分）で掃除。実行中も絶対上限を超えたら安全に破棄する。
 */
function sweepExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const age = now - job.createdAt;
    const active = job.status === 'pending' || job.status === 'generating';
    if (active ? age > JOB_ACTIVE_MAX_MS : age > JOB_TTL_MS) jobs.delete(id);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * claude CLI で HTML を 1 本生成し、フェンス除去 + 最低限の妥当性チェックまで行う。
 * 堅牢化（エラー画面に落とさない）のための多層防御:
 *  - 一過性失敗（空応答・claude 競合・タイムアウト）を吸収するため最大 GENERATE_MAX_ATTEMPTS 回リトライ。
 *  - 利用上限（Sonnet limit / rate limit 等）を検出したら、以降の試行を fallback（Opus）へ切替える。
 *  - 失敗時は原因を分類（limit/timeout/empty/error）して返し、ユーザに出し分けできるようにする。
 * 成功した HTML を { html } で返す。全試行失敗なら { html:null, reason, detail }。
 */
async function generateHtmlWithRetry(
  cliPrompt: string,
  onChunk?: (accumulated: string, thinking: string) => void,
): Promise<GenResult> {
  let model = NOTEBOOK_CLAUDE_MODEL; // primary（Sonnet）。利用上限検出で fallback（Opus）へ。
  let switchedToFallback = false;
  let lastReason: GenFailReason = 'error';
  let lastDetail: string | undefined;

  for (let attempt = 1; attempt <= GENERATE_MAX_ATTEMPTS; attempt += 1) {
    const raw = await runClaudeRaw(cliPrompt, model, onChunk);

    if (!raw.error) {
      // 「作り方メモ → ---HTML--- → HTML 本文」のうち HTML 本文だけを取り出す。
      const html = stripFences(splitPlanHtml(raw.stdout).html);
      // HTML らしさの最低限チェック: 空・タグを含まないものは無効（リトライ対象）。
      if (html && html.includes('<')) return { html };
      // 応答はあるが HTML ではない（空・フェンスのみ等）。
      lastReason = 'empty';
      lastDetail = undefined;
    } else if (isLimitFailure(raw)) {
      lastReason = 'limit';
      lastDetail = raw.error;
      // 利用上限。まだ primary なら次回以降は fallback（Opus）へ切替える。
      if (!switchedToFallback) {
        switchedToFallback = true;
        model = DEV_MOCKUP_FALLBACK_MODEL;
        console.warn(
          `[dev-mockup] sonnet limit hit → fallback to ${DEV_MOCKUP_FALLBACK_MODEL}`,
        );
      }
    } else if (raw.timedOut) {
      // タイムアウト＝出力が重すぎる/詰まっている。再試行してもまた 240s 待たせるだけなので即諦める。
      lastReason = 'timeout';
      lastDetail = raw.error;
      if (lastDetail) console.warn(`[dev-mockup] generate attempt ${attempt} timed out → 中断`);
      break;
    } else {
      lastReason = 'error';
      lastDetail = raw.error;
    }

    if (lastDetail) console.warn(`[dev-mockup] generate attempt ${attempt} failed: ${lastDetail}`);
    // 最終試行でなければバックオフして再試行。
    if (attempt < GENERATE_MAX_ATTEMPTS) await sleep(GENERATE_RETRY_BACKOFF_MS);
  }
  return { html: null, reason: lastReason, detail: lastDetail };
}

// ─── dev 生成の直列化 ────────────────────────────────────────
//
// 共有 Claude アカウントで重い HTML 生成を同時に走らせると互いに遅くなり 240s 上限に達しやすい
// （実測: 単発 ~10〜90s が、2 本同時だと両方 240s タイムアウト）。dev 生成は 1 本ずつ直列化する。
// 後続は前段の完了を待ってから走る＝各々が速く確実に終わり、全体スループットも結局上がる。
// 注: 直列化は dev 生成同士のみ。ノートブック Q&A とは withClaudeSlot（共有セマフォ）側で調停する。

let devGenChain: Promise<unknown> = Promise.resolve();

/** fn を dev 生成チェーンの末尾に繋いで直列実行する。結果/例外は呼び出し側へ素通し。 */
function serializeDevGen<T>(fn: () => Promise<T>): Promise<T> {
  const run = devGenChain.then(fn, fn);
  // チェーン自体は「次が待てる」ためだけのもの。成否を握り潰して後続を止めない。
  devGenChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * バックグラウンドで claude CLI を呼んで HTML を生成し、結果をジョブに格納する（単一画面）。
 * 新規生成（prompt）・修正（baseHtml + instruction）の両方で使う。
 * await しない前提。例外でサーバを落とさない。
 */
async function runGenerateJob(
  jobId: string,
  cliPrompt: string,
  save: { title: string; id?: string; prompt?: string },
): Promise<void> {
  // 生成途中の stdout をジョブへ反映＝クライアントがポーリングでライブにコードを見られる。
  const onChunk = (accumulated: string, thinking: string): void => {
    const job = jobs.get(jobId);
    if (!job || job.status === 'done' || job.status === 'error') return;
    job.status = 'generating';
    // 「作り方メモ」と「HTML 本文」に分割して別々に持つ。クライアントは HTML が来るまで
    // メモを “作り方を考えています” のライブ表示に使い、HTML が始まったらコードに切り替える。
    const { plan, html } = splitPlanHtml(accumulated);
    job.plan = plan || undefined;
    job.partial = html;
    // 拡張思考（あれば）。作り方より前の「素の思考」を最初のフェーズで見せる。
    job.thinking = thinking || undefined;
  };
  // 同時実行の食い合いを避けるため、生成は 1 本ずつ直列化する。
  // 直列キューに並んでいる間は status='pending'（=順番待ち）、自分の番が来て実際に
  // claude を起動する瞬間に status='generating' へ。クライアントは両者を区別して
  // 「順番待ち中」か「生成中（考え中→コード書き中）」かを正しく表示できる。
  const result = await serializeDevGen(() => {
    const job = jobs.get(jobId);
    if (job && job.status === 'pending') job.status = 'generating';
    return generateHtmlWithRetry(cliPrompt, onChunk);
  });
  if (result.html) {
    const html = result.html;
    // 生成成功。クライアントが離脱・通信失敗しても結果が残るよう、ストアへ自動保存する。
    // 保存に失敗してもジョブ自体は成功として html を返す（保存はベストエフォート）。
    let mockupId: string | undefined;
    try {
      const saved = upsertMockup({
        id: save.id,
        title: save.title,
        html,
        prompt: save.prompt,
      });
      mockupId = saved.id;
    } catch {
      // ignore — html は返す。
    }
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'done';
      job.html = html;
      job.mockupId = mockupId;
      // 後方互換: 保存できたら saved を 1 件で埋める。
      if (mockupId) job.saved = [{ id: mockupId, title: save.title }];
    }
    return;
  }

  // 全試行失敗。原因を分類してユーザ向け文言を出し分ける。
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'error';
    job.error = GENERATE_FAILURE_MESSAGES[result.reason ?? 'error'];
  }
}

// ─── 4段フロー: 設計→ワイヤーフレーム→コード ──────────────────
//
// 新規生成は単発ではなく「設計 → Figma ワイヤーフレーム → コーディング」の多段で進める。
// 各ステージの途中経過（思考・設計書・ワイヤーフレーム進捗・書きかけコード）はジョブに反映し、
// クライアントがポーリングでライブ表示する。Figma 失敗時はスキップして設計→コードへ続行する
//（堅牢性優先＝Figma が不調でも HTML は出る）。修正(revise)は従来どおり単段（runGenerateJob）。

/**
 * 設計ステージ: 要望から設計書＋画面リストを生成する。途中経過（設計書・思考）をジョブに流す。
 * 利用上限なら一度だけ fallback（Opus）へ切替えて再試行。完全失敗時は { designDoc:'', screens:[] }。
 */
async function runDesignStage(
  jobId: string,
  userPrompt: string,
): Promise<{ designDoc: string; screens: ScreenSpec[] }> {
  const onChunk = (accumulated: string, thinking: string): void => {
    const job = jobs.get(jobId);
    if (!job || job.status === 'done' || job.status === 'error') return;
    // SCREENS マーカー前までが設計書。マーカー未到達なら全文を設計書として表示する。
    const idx = accumulated.indexOf(SCREENS_MARKER);
    const doc = (idx === -1 ? accumulated : accumulated.slice(0, idx)).trim();
    job.plan = doc || undefined;
    if (thinking) job.thinking = thinking;
  };

  let model = NOTEBOOK_CLAUDE_MODEL;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const raw = await runClaudeRaw(buildDesignPrompt(userPrompt), model, onChunk);
    if (!raw.error) return splitDesignScreens(raw.stdout);
    if (isLimitFailure(raw) && attempt === 1) {
      model = DEV_MOCKUP_FALLBACK_MODEL;
      console.warn(`[dev-mockup] design stage sonnet limit → fallback to ${DEV_MOCKUP_FALLBACK_MODEL}`);
      continue;
    }
    console.warn(`[dev-mockup] design stage failed: ${raw.error}`);
    break;
  }
  return { designDoc: '', screens: [] };
}

/**
 * 仕上げレビュー（MC-252 P2）。生成済み HTML をデザインルーブリックで自己点検し、見た目だけ改善した
 * HTML を返す。失敗・劣化（空/タグ無し/極端に短い）時は null を返し、呼び出し側は元 HTML を保持する。
 * 改善後の HTML をストリームで job.partial に流す（ライブ表示）。
 */
async function runReviewStage(jobId: string, html: string): Promise<string | null> {
  const onChunk = (accumulated: string): void => {
    const job = jobs.get(jobId);
    if (!job || job.status === 'done' || job.status === 'error') return;
    job.partial = splitPlanHtml(accumulated).html;
  };

  let model = NOTEBOOK_CLAUDE_MODEL;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const raw = await runClaudeRaw(buildReviewPrompt(html), model, onChunk, REVIEW_TIMEOUT_MS);
    if (!raw.error) {
      const improved = stripFences(splitPlanHtml(raw.stdout).html);
      // 劣化ガード: HTML として妥当か＋元の 60% 以上の分量か（丸ごと短く壊していないか）。
      if (improved && improved.includes('<') && improved.length >= html.length * 0.6) {
        return improved;
      }
      console.warn('[dev-mockup] review stage output rejected (too short / invalid) → keep original');
      return null;
    }
    if (isLimitFailure(raw) && attempt === 1) {
      model = DEV_MOCKUP_FALLBACK_MODEL;
      console.warn(`[dev-mockup] review stage sonnet limit → fallback to ${DEV_MOCKUP_FALLBACK_MODEL}`);
      continue;
    }
    console.warn(`[dev-mockup] review stage failed: ${raw.error} → keep original`);
    break;
  }
  return null;
}

// ─── 実装仕様書の生成（MC-253・モック→本番化の橋渡し）──────────────

/** 実装仕様書生成 1 回あたりのタイムアウト（仕様書はコードより軽いので 4 分で十分）。 */
const SPEC_TIMEOUT_MS = 240_000;

/**
 * モック（要望＋設計書＋HTML）から「実装仕様書」を書かせるプロンプト。
 * フロントだけの試作を、バックエンド込みの本番アプリにするための設計を Markdown で出させる。
 * 既存スタック（React+Vite+Tailwind / Supabase or Node+Express / Render+GitHub Actions）を前提に推奨する。
 */
function buildImplSpecPrompt(appTitle: string, prompt: string, designDoc: string, html: string): string {
  return [
    'あなたは、動く HTML 試作品（モックアップ）を本番のアプリに仕立てるテックリードです。',
    '次のモックを「フロントエンド＋バックエンド込みで本番リリースする」ための実装仕様書を Markdown で書いてください。',
    'プログラミングに詳しくない発注者でも全体像が分かり、かつエンジニア/AIがそのまま実装に着手できる具体度にすること。',
    '',
    `アプリ名: ${appTitle}`,
    '元の要望:',
    prompt || '（なし）',
    '',
    '設計書（あれば）:',
    designDoc || '（なし）',
    '',
    '次の構成で、過不足なく具体的に書くこと（各見出しは ## で）:',
    '1. 概要 — 何のアプリで、誰のどんな課題を解決するか（2〜3行）',
    '2. 画面と主な機能 — モックにある画面・操作を箇条書きで',
    '3. データモデル — 必要なエンティティと項目（名前・型・必須/任意・関係）を表で。永続化が要るデータを明確に',
    '4. バックエンドの要否と構成 — 保存/認証/共有・同期/外部API/課金/通知 の要否を判断し、推奨構成を選ぶ:',
    '   - 推奨A: Supabase 中心（Postgres＋認証〔マジックリンク〕＋ストレージ＋行レベル権限、重い処理だけ Edge Functions）。多くのアプリはこれで足りる。',
    '   - 推奨B: 自前 Node+Express＋DB（複雑なサーバ処理・バッチ・LLM 呼び出しが要る時）。',
    '   どちらが適切かを理由つきで選ぶ。',
    '5. API / テーブル設計 — 主要なエンドポイント（または Supabase テーブル＋RLS 方針）の一覧。リクエスト/レスポンスの要点',
    '6. 認証・権限 — ログイン方式とデータの見える範囲',
    '7. 実装ステップ — フロント / バックエンド / リリース の順で、着手できる粒度のチェックリスト',
    '8. 推奨スタックとリリース — フロント=React+Vite+Tailwind、バック=上の選択、ホスティング=Render/Vercel＋Supabase、CI/CD=GitHub Actions（main push で自動デプロイ）。モバイル中心なら PWA 化も触れる',
    '9. 留意点 / 未確定事項 — 課金・法規・スケール・要確認の論点',
    '',
    'コードは書かない（仕様書のみ）。冗長にせず、判断と具体値を重視すること。日本語で書くこと。',
    '',
    '対象モックの HTML（構造把握用・必要な範囲で参照）:',
    html.slice(0, 16000),
  ].join('\n');
}

/**
 * 実装仕様書を生成してジョブと store に保存する（MC-253）。生成中の本文を job.spec にストリームする。
 * 既存の非同期ジョブ機構（jobs / handleJob / TTL）を再利用。await しない前提・throw しない。
 */
async function runSpecJob(
  jobId: string,
  mockupId: string,
  appTitle: string,
  prompt: string,
  designDoc: string,
  html: string,
): Promise<void> {
  const onChunk = (accumulated: string): void => {
    const job = jobs.get(jobId);
    if (!job || job.status === 'done' || job.status === 'error') return;
    job.status = 'generating';
    job.spec = accumulated || undefined;
  };

  await serializeDevGen(async () => {
    const j = jobs.get(jobId);
    if (j && j.status === 'pending') j.status = 'generating';

    let model = NOTEBOOK_CLAUDE_MODEL;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const raw = await runClaudeRaw(
        buildImplSpecPrompt(appTitle, prompt, designDoc, html),
        model,
        onChunk,
        SPEC_TIMEOUT_MS,
      );
      if (!raw.error) {
        const spec = stripFences(raw.stdout).trim();
        if (spec) {
          try {
            setImplSpec(mockupId, spec);
          } catch {
            /* 保存はベストエフォート。 */
          }
          const job = jobs.get(jobId);
          if (job) {
            job.status = 'done';
            job.spec = spec;
          }
          return;
        }
      } else if (isLimitFailure(raw) && attempt === 1) {
        model = DEV_MOCKUP_FALLBACK_MODEL;
        console.warn(`[dev-spec] sonnet limit → fallback to ${DEV_MOCKUP_FALLBACK_MODEL}`);
        continue;
      }
      console.warn(`[dev-spec] spec attempt ${attempt} failed: ${raw.error ?? 'empty'}`);
      if (attempt < 2) await sleep(GENERATE_RETRY_BACKOFF_MS);
    }
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = '実装仕様書の生成に失敗しました。少し待ってもう一度お試しください。';
    }
  });
}

/**
 * 新規生成の多段ジョブ。設計→（Figma）→コードを直列で進め、完成 HTML を自動保存する。
 * await しない前提。例外でサーバを落とさない。
 */
async function runDesignFirstJob(
  jobId: string,
  userPrompt: string,
  save: { title: string; prompt?: string },
  useWireframe: boolean,
): Promise<void> {
  const setJob = (patch: Partial<Job>): void => {
    const job = jobs.get(jobId);
    if (!job || job.status === 'done' || job.status === 'error') return;
    Object.assign(job, patch);
  };

  // 多段全体を dev 生成チェーンで直列化＝他の dev 生成の claude 呼び出しと混線させない。
  await serializeDevGen(async () => {
    {
      const job = jobs.get(jobId);
      if (job && job.status === 'pending') job.status = 'generating';
    }

    // ── 高速モード（Figma なし）: 設計とコードを 1 回の AI 呼び出しに圧縮 ─────────
    // 設計ステージを分けず要望から直接 HTML を作る。2 呼び出し→1 呼び出しで実質半分の時間に。
    if (!useWireframe) {
      setJob({ stage: 'code', partial: undefined });
      const referenceGuidance = buildReferenceGuidance();
      const fastPrompt = buildFastGeneratePrompt(userPrompt, referenceGuidance);
      const onChunk = (accumulated: string, thinking: string): void => {
        const job = jobs.get(jobId);
        if (!job || job.status === 'done' || job.status === 'error') return;
        job.partial = splitPlanHtml(accumulated).html;
        if (thinking) job.thinking = thinking;
      };
      const fast = await generateHtmlWithRetry(fastPrompt, onChunk);
      if (fast.html) {
        let mockupId: string | undefined;
        try {
          mockupId = upsertMockup({ title: save.title, html: fast.html, prompt: save.prompt }).id;
        } catch {
          /* html は返す（保存はベストエフォート）。 */
        }
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'done';
          job.html = fast.html;
          job.mockupId = mockupId;
          if (mockupId) job.saved = [{ id: mockupId, title: save.title }];
        }
      } else {
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'error';
          job.error = GENERATE_FAILURE_MESSAGES[fast.reason ?? 'error'];
        }
      }
      return;
    }

    // ── ステージ1: 設計（思考＋設計書＋画面リスト）─────────────
    setJob({ stage: 'design' });
    const design = await runDesignStage(jobId, userPrompt);
    const designDoc = design.designDoc;
    // 画面が出せなければ単一画面として続行（設計が空でもコードは作る）。
    const screens: ScreenSpec[] =
      design.screens.length > 0 ? design.screens : [{ name: save.title, description: userPrompt }];
    setJob({ designDoc: designDoc || undefined, screens, plan: designDoc || undefined });

    // ── ステージ2: Figma ワイヤーフレーム（任意・失敗時はスキップ）──────
    // useWireframe=false（高速モード）なら Figma 工程ごと飛ばし、設計→コードへ直行する。
    let wireframed = false;
    if (useWireframe) {
      setJob({ stage: 'wireframe', partial: undefined, wireframeProgress: '🎨 Figma でワイヤーフレームを作る準備をしています' });
      const specs: WireframeScreenSpec[] = screens.map((s) => ({
        name: s.name,
        description: s.description,
      }));
      let wf: Awaited<ReturnType<typeof generateFigmaWireframes>>;
      try {
        wf = await generateFigmaWireframes(
          jobId,
          save.title,
          designDoc || userPrompt,
          specs,
          NOTEBOOK_CLAUDE_MODEL,
          (msg) => setJob({ wireframeProgress: msg }),
        );
      } catch (e) {
        wf = { ok: false, screens: [], error: (e as Error).message };
      }
      if (wf.ok && wf.screens.length > 0) {
        wireframed = true;
        setJob({
          wireframe: {
            fileUrl: wf.fileUrl,
            dir: jobId,
            screens: wf.screens.map((s) => ({ name: s.name, image: s.image })),
          },
          wireframeProgress: 'ワイヤーフレームができました。これを元にコードを作ります。',
        });
      } else {
        console.warn(`[dev-mockup] figma wireframe skipped: ${wf.error ?? 'no screens'}`);
        setJob({ wireframeProgress: 'ワイヤーフレームは省略し、設計を元に直接コードを作ります。' });
      }
    }

    // ── ステージ3: コーディング ───────────────────────────────
    setJob({ stage: 'code', partial: undefined });
    // 👍 手本があればスタイル参考としてプロンプトに差し込む（MC-252 P3 フライホイール）。
    const referenceGuidance = buildReferenceGuidance();
    const codePrompt = buildCodeFromDesignPrompt(
      userPrompt,
      designDoc,
      screens,
      wireframed,
      referenceGuidance,
    );
    const onCodeChunk = (accumulated: string, thinking: string): void => {
      const job = jobs.get(jobId);
      if (!job || job.status === 'done' || job.status === 'error') return;
      // 設計は済んでいるので本文はそのまま HTML。フェンス前提の splitPlanHtml で安全に取り出す。
      job.partial = splitPlanHtml(accumulated).html;
      if (thinking) job.thinking = thinking;
    };
    const result = await generateHtmlWithRetry(codePrompt, onCodeChunk);

    if (result.html) {
      let html = result.html;
      // ── ステージ4: 仕上げレビュー（丁寧モードのみ・MC-252 P2）─────────
      // ルーブリックで自己点検→見た目だけ微修正。高速モード(useWireframe=false)では省いて速さを保つ。
      // 失敗・劣化時は元 HTML を保持（runReviewStage が null を返す）。
      if (useWireframe) {
        setJob({ stage: 'review', partial: html, wireframeProgress: undefined });
        const improved = await runReviewStage(jobId, html);
        if (improved) html = improved;
      }
      const cur = jobs.get(jobId);
      let mockupId: string | undefined;
      try {
        const saved = upsertMockup({
          title: save.title,
          html,
          prompt: save.prompt,
          designDoc: designDoc || undefined,
          ...(cur?.wireframe?.fileUrl ? { figmaFileUrl: cur.wireframe.fileUrl } : {}),
          ...(wireframed ? { wireframeDir: jobId } : {}),
          ...(wireframed && cur?.wireframe ? { wireframeScreens: cur.wireframe.screens } : {}),
        });
        mockupId = saved.id;
      } catch {
        /* html は返す（保存はベストエフォート）。 */
      }
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'done';
        job.html = html;
        job.mockupId = mockupId;
        if (mockupId) job.saved = [{ id: mockupId, title: save.title }];
      }
      return;
    }

    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = GENERATE_FAILURE_MESSAGES[result.reason ?? 'error'];
    }
  });
}

// ─── ハンドラ ───────────────────────────────────────────

/** POST /api/dev/mockup/generate — 非同期ジョブを起票し 202 { jobId } を即返す。 */
function handleGenerate(req: Request, res: Response): void {
  sweepExpiredJobs();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const baseHtml = typeof body.baseHtml === 'string' ? body.baseHtml : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction : '';
  // Figma ワイヤーフレーム工程の有無（高速モード）。既定 true＝Figma 先行フロー。
  // false なら設計→コードへ直行し 1〜2 分で出る。明示的に false の時だけ無効。
  const useWireframe = body.wireframe !== false;

  // モード判定: baseHtml + instruction が両方あれば反復修正、prompt のみなら新規生成。
  // どちらも「1 つの動くインタラクティブな単一 HTML」を生成する。
  const isRevise = Boolean(baseHtml.trim() && instruction.trim());
  const isGenerate = !isRevise && Boolean(prompt.trim());
  if (!isRevise && !isGenerate) {
    res.status(400).json({ error: 'prompt（新規生成）または baseHtml+instruction（修正）が必要です' });
    return;
  }

  const jobId = randomUUID();
  jobs.set(jobId, { status: 'pending', createdAt: Date.now() });

  const onFatal = (): void => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = GENERATE_FAILURE_MESSAGE;
    }
  };

  const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 40);
  const explicitTitle = typeof body.title === 'string' ? body.title.trim() : '';
  const explicitId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;

  if (isGenerate) {
    // 新規生成: 設計→Figmaワイヤーフレーム→コーディングの多段フローで進め、完成 HTML を自動保存。
    void runDesignFirstJob(
      jobId,
      prompt.trim(),
      {
        title: explicitTitle || oneLine(prompt) || 'モックアップ',
        prompt: prompt.trim(),
      },
      useWireframe,
    ).catch(onFatal);
  } else {
    // 修正: 単一画面。自動保存用のタイトルと対象 id を決める。
    const autoTitle = explicitTitle || (instruction.trim() ? `修正: ${oneLine(instruction)}` : 'モックアップ');
    const storePrompt = instruction.trim() || undefined;
    const cliPrompt = buildRevisePrompt(baseHtml, instruction);
    void runGenerateJob(jobId, cliPrompt, {
      title: autoTitle,
      id: explicitId,
      prompt: storePrompt,
    }).catch(onFatal);
  }

  // 即座に 202 を返す＝リクエストは短時間で完了し、エッジ上限に掛からない。
  res.status(202).json({ jobId });
}

/** GET /api/dev/mockup/job/:jobId — ジョブの状態を返す。未知/期限切れは 404。 */
function handleJob(req: Request, res: Response): void {
  sweepExpiredJobs();
  const jobId = String(req.params.jobId);
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  // 生成中はもちろん、失敗（error）時も「そこまでの思考・作り方・書いたコード」を返す。
  // これで時間切れ等でも画面を空にせず「どこまで考え・書けたか」を正直に見せられる。
  const liveVisible = job.status === 'generating' || job.status === 'error';
  res.json({
    status: job.status,
    // 4段フローの現在ステージ（design/wireframe/code）。クライアントの段階表示に使う。
    stage: job.stage,
    html: job.html,
    // 生成途中の部分コード（フェンスを除いて返す）。done になれば html を使うので不要。
    partial: liveVisible && job.partial ? stripFences(job.partial) : undefined,
    // 生成途中の「作り方」メモ（HTML を書き始める前に表示する設計説明）。
    plan: liveVisible && job.plan ? job.plan : undefined,
    // 生成途中の「AI の思考」（拡張思考。最初のフェーズで何をどう考えているかを見せる）。
    thinking: liveVisible && job.thinking ? job.thinking : undefined,
    // 設計書・画面リスト・ワイヤーフレームは done でも返す（完成画面で「何を作ったか」を示す）。
    designDoc: job.designDoc,
    screens: job.screens,
    wireframe: job.wireframe,
    // ワイヤーフレーム生成中の進捗（ライブ表示のみ）。
    wireframeProgress: liveVisible ? job.wireframeProgress : undefined,
    // 実装仕様書（spec 生成ジョブ）。生成中も done でも返す（ライブに伸びて完成で確定）。
    spec: job.spec,
    mockupId: job.mockupId,
    error: job.error,
    saved: job.saved,
  });
}

/**
 * GET /api/dev/wireframe/:dir/:file — 保存済みワイヤーフレーム PNG を配信する。
 * dir は生成時の jobId（uuid: 英数字＋ハイフン）、file は数字.png のみ許可し、
 * DEV_WIREFRAMES_DIR 配下から出ないようサニタイズする。auth ミドルウェア配下＝Cookie/Bearer 必須。
 */
function handleWireframeImage(req: Request, res: Response): void {
  const dir = String(req.params.dir).replace(/[^a-zA-Z0-9-]/g, '');
  const file = String(req.params.file).replace(/[^a-zA-Z0-9.-]/g, '');
  // file は「数字.png」のみ（devFigmaWireframes が <画面番号>.png で保存する）。
  if (!dir || !/^\d+\.png$/.test(file)) {
    res.status(400).json({ error: 'invalid wireframe path' });
    return;
  }
  const abs = join(DEV_WIREFRAMES_DIR, dir, file);
  if (!existsSync(abs)) {
    res.status(404).json({ error: 'wireframe not found' });
    return;
  }
  res.type('png');
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(abs);
}

/** GET /api/dev/mockups — 軽量サマリ一覧（html 除く）。 */
function handleList(_req: Request, res: Response): void {
  res.json({ mockups: listMockups() });
}

/** GET /api/dev/mockups/:id — html を含む 1 件。 */
function handleGet(req: Request, res: Response): void {
  const id = String(req.params.id);
  const mockup = getMockup(id);
  if (!mockup) {
    res.status(404).json({ error: 'mockup not found' });
    return;
  }
  res.json({ mockup });
}

/** POST /api/dev/mockups — upsert（id 無ければ生成）。 */
function handleUpsert(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const html = typeof body.html === 'string' ? body.html : '';
  if (!html) {
    res.status(400).json({ error: 'html is required' });
    return;
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
  const prompt = typeof body.prompt === 'string' ? body.prompt : undefined;

  const saved = upsertMockup({ id, title, html, prompt });
  res.json({ mockup: saved });
}

/** DELETE /api/dev/mockups/:id — 論理削除。 */
function handleDelete(req: Request, res: Response): void {
  const id = String(req.params.id);
  deleteMockup(id);
  res.json({ ok: true, id });
}

/**
 * POST /api/dev/mockups/:id/rating — { rating: 'up'|'down'|null } で評価を設定（MC-252 P3）。
 * up の試作品は次の生成で「手本」として参照される。null で評価解除。
 */
function handleRating(req: Request, res: Response): void {
  const id = String(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const r = body.rating;
  const rating: 'up' | 'down' | null = r === 'up' || r === 'down' ? r : null;
  const mockup = setRating(id, rating);
  if (!mockup) {
    res.status(404).json({ error: 'mockup not found' });
    return;
  }
  res.json({ mockup });
}

/**
 * POST /api/dev/mockups/:id/impl-spec — 実装仕様書の生成ジョブを起票し 202 { jobId } を返す（MC-253）。
 * 進捗・結果は GET /mockup/job/:jobId の spec フィールドで取得する。保存先 store にも実装仕様書を残す。
 */
function handleImplSpec(req: Request, res: Response): void {
  sweepExpiredJobs();
  const id = String(req.params.id);
  const mockup = getMockup(id);
  if (!mockup) {
    res.status(404).json({ error: 'mockup not found' });
    return;
  }
  const jobId = randomUUID();
  jobs.set(jobId, { status: 'pending', createdAt: Date.now() });
  void runSpecJob(
    jobId,
    id,
    mockup.title,
    mockup.prompt ?? '',
    mockup.designDoc ?? '',
    mockup.html ?? '',
  ).catch(() => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = '実装仕様書の生成に失敗しました。';
    }
  });
  res.status(202).json({ jobId });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/dev 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function devMockupRouter(): Router {
  const router = Router();
  router.post('/mockup/generate', handleGenerate);
  router.get('/mockup/job/:jobId', handleJob);
  router.get('/wireframe/:dir/:file', handleWireframeImage);
  router.get('/mockups', handleList);
  router.get('/mockups/:id', handleGet);
  router.post('/mockups', handleUpsert);
  router.post('/mockups/:id/rating', handleRating);
  router.post('/mockups/:id/impl-spec', handleImplSpec);
  router.delete('/mockups/:id', handleDelete);
  return router;
}
