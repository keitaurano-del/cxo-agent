// workChatRouter — 仕事チャット（ECL/PMO 学習・壁打ちアドバイザー）の API（MC-260）。
//
// 新サイドメニュー「仕事」(/work) から開く、メガバンクの ECL（予想信用損失）システム導入 PMO 案件
// 向けの学習・壁打ちチャット。茶事チャット（chajiChatRouter）のメディア対応版をそのまま踏襲する。
//   - 会話履歴をサーバ側 JSONL（data/work-chat.jsonl）に蓄積する（workChatStore）。
//     端末・リロードをまたいで過去の質問が残る。クライアントの localStorage はキャッシュ扱い。
//   - 応答生成時は直近の履歴を文脈として渡し、過去のやり取りを踏まえて続けて答えられる。
//   - 送信側のメディア（画像/動画）添付に対応する（childcare/chaji の添付側をミラー）。画像は
//     マルチモーダルでアドバイザーが Read して見られる（best-effort）。動画は受領・表示のみ。
//   - 返信側のメディア返却（YouTube 参考動画埋め込み・Gemini 生成図解・Web 実在画像）に対応する
//     （workMedia.ts の後処理＝oEmbed 実在検証 / 信頼ホスト画像取り込み / 図解生成）。捏造禁止。
//
// AI 応答は notebookClaude.ts の runClaudeStream（claude -p ベース）を流用する。
// cwd は CXO_ROOT（既存ディレクトリ）を渡し、画像 Read のためにメディア保存ディレクトリ
// （CXO_ROOT/data/work-chat-media/）配下のファイルを読ませる（CXO_ROOT 配下なので既定で許可）。
//
// 出典リンク機能: このチャット専用に claude へ WebSearch/WebFetch を許可し
// （WORK_ALLOWED_TOOLS → runClaudeStream の opts.allowedTools）、アドバイザーが実際に
// 実在ページを検索・取得して確認した URL だけを「## 出典」セクションに引用できるようにする。
// 添付画像を見るために Read も許可する。systemPrompt で捏造リンクを厳禁する。
// この allowedTools は当チャット専用の opt-in で、notebook 等の既存 claude 呼び出しには渡らない。
//
// ルート（index.ts で auth ミドルウェア配下に /api/work で mount）:
//   POST   /chat              { messages: [...], media?: [...] } → SSE ストリーム or JSON
//   GET    /chat/history      → { messages: [{ role, content, media? }] }（サーバ保存の会話履歴）
//   GET    /chat/job/:id      → 単一ジョブの現在状態
//   DELETE /chat/history      → { ok: true }（会話を論理クリア）
//   POST   /chat/upload       multipart files[] → { ok, media: [{ id, kind, url, mime, name, size }] }
//   GET    /chat/media/:id    → メディア実体をストリーム配信（Range 対応）
//   POST   /glossary/detail   { term, meaning?, category? } → SSE or JSON（単語帳 1 語の深掘り解説）

import { randomUUID } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import {
  CXO_ROOT,
  WORK_CHAT_IMAGE_MAX_BYTES,
  WORK_CHAT_MEDIA_DIR,
  WORK_CHAT_MEDIA_MAX_FILES,
  WORK_CHAT_VIDEO_MAX_BYTES,
  WORK_GLOSSARY_MODEL,
} from './config.js';
import { processAssistantText } from './lib/workMedia.js';
import {
  clearMessages,
  finalizeAssistant,
  getJob,
  listMessages,
  recentContext,
  startExchange,
  type ChatMedia,
} from './lib/workChatStore.js';
import { runClaudeStream, runClaudeStreamJson } from './lib/notebookClaude.js';

// ─── 単語帳「もっと詳しく見る」（用語の深掘り解説）─────────────────────────
// 単語帳（WorkGlossaryTab）の各カードから、その用語 1 語を ECL/PMO 案件の文脈で
// 深掘り解説する（意味・実務での具体的な使い方・関連論点・注意点）。壁打ちチャットと同じ
// claude + WebSearch/WebFetch 機構（runClaudeStream + WORK_ALLOWED_TOOLS）を流用するが、
// 会話履歴の永続やジョブ管理は不要な単発生成なので、SSE で本文を流して終える薄い経路にする。
// 生成結果は Markdown（ChatMarkdown で描画）。捏造禁止・出典方針は WORK_SYSTEM_PROMPT に準拠。
const MAX_GLOSSARY_FIELD_CHARS = 500;

// 単語帳深掘り専用の軽量システムプロンプト（壁打ち用の巨大 WORK_SYSTEM_PROMPT は使わない）。
// 目的は「用語 1 語をその場で速く・正確に解説する」こと。WebSearch/WebFetch・メディア埋め込み・
// 壁打ち導線・ワークブック解説などは不要なので載せない（＝ツール往復とプロンプト肥大による遅延を排除）。
// 用語集の語は PD/LGD/EAD・IFRS9 3ステージ・与信/引当などモデルが確実に知っている基礎概念なので、
// 自分の知識だけで即答してよい。ただし日本基準の ECL は公開草案段階なので断定を避け「要確認」と明示する。
const GLOSSARY_SYSTEM_PROMPT = [
  'あなたは、ECL（予想信用損失／Expected Credit Loss）・IFRS9・銀行会計・与信管理・銀行業務・データ基盤・PMO に精通した専門アドバイザーです。相談者（Keita さん）は、会計基準変更（ECL の算出方法の変更）に対応するシステム導入プロジェクトに PMO として参画します。',
  '',
  '【この依頼の性質】用語集の 1 語を、初学者でも実務で使いこなせるように、その場で手早く解説してください。あなたが既に持っている知識だけで完結させてよく、Web 検索やページ取得は行いません（このタスクにツールはありません）。出典リンクや参考メディアの埋め込みも不要です。',
  '',
  '【口調・体裁】常にですます調で、簡潔かつ論理的に。返答は Markdown として表示されます。見出し（「## 」）・箇条書き（「- 」）で構造化し、要点は太字（**…**）で強調してください（強調しすぎない）。CJK の太字の落とし穴として、全角括弧（）や鉤括弧「」の直後に閉じ `**` を置くと太字が無効化されるので、太字スパンの末尾を全角括弧・鉤括弧で終わらせないでください（読み仮名・英語名は太字の外に出す）。',
  '',
  '【正確さ】一般的な会計・銀行・IT・PMO の定義や実務は、あなたの知識で自信を持って解説してかまいません。ただし日本基準の予想信用損失（ECL）・償却原価は、企業会計基準委員会（ASBJ）が公表した公開草案（企業会計基準公開草案第89号・適用指針公開草案第88号）を中心に検討が進む段階で、最終基準・適用時期・経過措置は未確定です。日本基準の具体的な規定・スケジュール（例: 2030年4月 適用）に触れるときは断定せず「公開草案段階では…」「未確定」「要確認」と明示してください。うろ覚えの数値・日付を確定事項のように述べないこと。',
  '',
  '【出典】このタスクでは URL を検証できないため、出典リンクは付けないでください（記憶からの URL 捏造は厳禁）。事実確認が必要な点は本文で「要確認」と示すに留めます。',
  '',
  '必ず日本語・ですます調で答えてください。',
].join('\n');

/** 用語の深掘り解説の「依頼」プロンプトを組む（システムプロンプトは --system-prompt で別途渡す）。 */
function buildGlossaryDetailPrompt(term: string, meaning: string, category: string): string {
  return [
    '単語帳（用語集）の次の 1 語について、相談者（Keita さん）が実務で使いこなせるよう、深掘りして解説してください。',
    `- 用語: ${term}`,
    meaning ? `- 現在の簡易説明: ${meaning}` : '',
    category ? `- カテゴリ: ${category}` : '',
    '',
    '【解説の構成（Markdown の見出しで構造化する）】',
    '- 「## 意味」: この用語の意味を、簡易説明より一段深く正確に。',
    '- 「## 実務での具体的な使い方」: ECL システム導入 PMO 案件の現場で、どんな場面・作業でこの用語が出てくるか、具体例つきで。',
    '- 「## 関連論点」: 関連する用語・論点・混同しやすい概念との違い。',
    '- 「## 注意点」: 実務・会計基準・監査上、気をつけるべき点や落とし穴。',
    '',
    '簡潔に、要点を押さえて手早く答えてください（冗長にしない）。必ず日本語・ですます調で。',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

// POST /glossary/detail — 単語帳 1 語の深掘り解説。Accept: text/event-stream で SSE、無ければ JSON。
// 会話履歴には残さない単発生成（壁打ちチャットとは独立）。
async function handleGlossaryDetail(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const term =
    typeof body.term === 'string' ? body.term.trim().slice(0, MAX_GLOSSARY_FIELD_CHARS) : '';
  const meaning =
    typeof body.meaning === 'string' ? body.meaning.trim().slice(0, MAX_GLOSSARY_FIELD_CHARS) : '';
  const category =
    typeof body.category === 'string' ? body.category.trim().slice(0, MAX_GLOSSARY_FIELD_CHARS) : '';
  if (!term) {
    res.status(400).json({ error: 'term（用語）が必要です。' });
    return;
  }

  const prompt = buildGlossaryDetailPrompt(term, meaning, category);
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    // WebSearch 中の無音でトンネルに切断されないよう keep-alive ping を流す（POST /chat と同方針）。
    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* 切断済みなら close ハンドラで掃除 */
      }
    }, 15_000);
    let closed = false;
    res.on('close', () => {
      closed = true;
      clearInterval(keepAlive);
    });
    try {
      // 単語帳の 1 語解説は「速く・逐次・脱線なし」を最優先: トークンストリーム（stream-json）で
      // 逐次配信し、ツール無効・中立 cwd・軽量 system-prompt でリポジトリ探索/巨大プロンプトの遅延を排除。
      const result = await runClaudeStreamJson(
        prompt,
        (chunk) => {
          if (!closed) sseWrite(res, { type: 'chunk', text: chunk });
        },
        { model: WORK_GLOSSARY_MODEL, systemPrompt: GLOSSARY_SYSTEM_PROMPT },
      );
      const answer = (result.stdout || '').trim();
      const failed = !result.ok || (answer.length > 0 && answer.length < 400 && looksLikeLimit(answer));
      if (!closed) {
        if (failed && !answer) {
          const fallback = looksLikeLimit(`${result.stdout ?? ''}\n${result.error ?? ''}`)
            ? LIMIT_MESSAGE
            : ERROR_MESSAGE;
          sseWrite(res, { type: 'done', answer: fallback, status: 'error' });
        } else {
          sseWrite(res, { type: 'done', answer, status: 'done' });
        }
      }
    } catch (err) {
      console.error('[work-glossary] detail failed:', err);
      if (!closed) sseWrite(res, { type: 'done', answer: ERROR_MESSAGE, status: 'error' });
    } finally {
      clearInterval(keepAlive);
      if (!closed) res.end();
    }
    return;
  }

  // 非ストリーム（JSON）経路: 生成完了を待って本文を返す。glossary は軽量ストリーム経路で即答。
  try {
    const result = await runClaudeStreamJson(prompt, () => {}, {
      model: WORK_GLOSSARY_MODEL,
      systemPrompt: GLOSSARY_SYSTEM_PROMPT,
    });
    const answer = (result.stdout || '').trim();
    const failed = !result.ok || (answer.length > 0 && answer.length < 400 && looksLikeLimit(answer));
    if (failed && !answer) {
      const fallback = looksLikeLimit(`${result.stdout ?? ''}\n${result.error ?? ''}`)
        ? LIMIT_MESSAGE
        : ERROR_MESSAGE;
      res.status(200).json({ answer: fallback, status: 'error' });
      return;
    }
    res.status(200).json({ answer, status: 'done' });
  } catch (err) {
    console.error('[work-glossary] detail failed:', err);
    res.status(502).json({ error: ERROR_MESSAGE });
  }
}

// ─── ペルソナ（ECL/PMO アドバイザー兼壁打ち相手）────────────────────────────
// アプリ内文言は中立的な丁寧体（です・ます）。返答は Markdown としてレンダリングされる。
// chaji の出典ルール・捏造禁止・信頼ソース優先・Markdown 体裁を踏襲し、専門領域を ECL/銀行/PMO に置き換える。
export const WORK_SYSTEM_PROMPT = [
  'あなたは、ECL（予想信用損失／Expected Credit Loss）・IFRS9・銀行会計・与信管理・銀行業務全般・データベース／データ基盤・PMO／プロジェクト管理に精通した、専門アドバイザー兼「壁打ち相手」です。相談者（Keita さん）は、2030年4月の会計基準変更（ECL の算出方法の変更）に対応するためのシステム導入プロジェクトに、PMO（プロジェクトマネジメントオフィス）として参画します。学習の支援と、実務上の論点整理・壁打ちの両方を行ってください。',
  '',
  '【専門領域（具体的に踏み込んで支援する）】',
  '(a) ECL の概要・会計基準: IFRS9 の減損モデル（3ステージ・12ヶ月 ECL／全期間 ECL の考え方）、PD（デフォルト確率）・LGD（デフォルト時損失率）・EAD（デフォルト時エクスポージャー）の意味と関係、ステージ判定（信用リスクの著しい増大／SICR）、フォワードルッキング情報の織り込み、日本における会計基準の動向（企業会計基準委員会＝ASBJ の検討状況など）。',
  '(b) ECL のシステム実装: モデル計算ロジックの実装、必要となるデータ要件（債権・格付・延滞・担保・マクロ指標など）、バッチ／アーキテクチャ設計、勘定系・リスク管理系・データウェアハウスとの連携、テスト（モデル検証・計算結果検証・回帰）、データ移行（既存引当との接続・並行稼働）。',
  '(c) 与信管理・銀行業務・データ・PMO 実務: 与信管理（格付・引当・自己査定）、銀行業務全般、データベース設計／SQL、PMO 実務（要件定義、WBS、ステークホルダー／ベンダー管理、課題・リスク管理、移行・テスト計画、スケジュール・進捗管理）。',
  '',
  '【学習支援だけでなく「壁打ち」を歓迎する】',
  '- 知識の解説に加えて、相談者の考えに対する論点整理、抜け漏れの指摘、段取り・リスクの提案、必要に応じた問い返し（前提や目的の確認）を積極的に行ってください。',
  '- 一方的に答えを出すだけでなく、PMO として現場で使える形（観点・チェックリスト・進め方）に落とし込むことを意識してください。',
  '',
  '【口調・体裁（Markdown で見やすく構造化する）】',
  '- 常にですます調で、簡潔かつ論理的に答えてください。返答は Markdown として整形して表示されます。',
  '- 内容量に応じて、見出し（「## 」「### 」）・箇条書き（「- 」）・番号リスト（「1. 」）で構造化し、特に伝えたい要点は太字（**…**）で強調してください（強調しすぎない）。軽い相談には数文の自然な文章で答えてかまいません。',
  '- 【重要・CJK の太字の落とし穴】ChatMarkdown では、全角の括弧（）や鉤括弧「」の直後に閉じの太字 `**` が来ると太字が無効化されます。太字スパンの末尾を全角括弧・鉤括弧で終わらせないでください。読み仮名・補足（例: ふりがな・英語名）は太字の外に出してください（例: **予想信用損失** ECL、ではなく **予想信用損失**（ECL）の「予想信用損失」だけを太字にする、のように末尾を全角括弧で閉じない）。',
  '',
  '【出典の提示（事実を述べる回答には Web 検索で確認した出典を付ける）】',
  '- あなたは WebSearch / WebFetch ツールを使えます。',
  '- 事実情報（会計基準・規制・IFRS9 の規定、PD/LGD/EAD などの定義、銀行実務、技術仕様など）を述べるときは、原則として WebSearch で信頼できる情報源を確認し、必要なら WebFetch でページ内容を取得してから答えてください。',
  '- その場合、回答の末尾に「## 出典」という見出しを付け、実際に WebSearch / WebFetch で参照したページを Markdown リンクの箇条書き（- [ページタイトル](https から始まる URL) の形式）で1〜3件示してください。サイト名だけのプレーンテキストにせず、必ずクリックで開けるリンクにしてください。',
  '- 純粋な相談整理・段取り提案・壁打ち（事実情報を含まない部分）には出典は不要です。',
  '【信頼できる情報源を優先する】',
  '- 出典には次の信頼できる情報源を優先してください: IFRS 財団（ifrs.org）、企業会計基準委員会（ASBJ・asb-j.jp）、金融庁、日本銀行、大手監査法人・大手コンサルティングファームの公表資料、学術論文・大学等の研究、ベンダー／製品の公式ドキュメント。',
  '- 個人ブログ、出典不明のまとめ・キュレーションサイト、物販が主目的の商業サイトは出典に使わないでください。信頼できるソースが見つからないときは、無理に低品質なサイトを出典にせず、出典なしで「要確認」と明示してください。',
  '【最重要・出典の捏造を絶対にしない】',
  '- 出典として URL を載せてよいのは、このチャット内で実際に WebSearch または WebFetch を使って取得し、内容を確認できたページの URL だけです。',
  '- 記憶・うろ覚え・推測で URL を書いてはいけません。「たぶんこういう URL のはず」で URL を組み立てることは厳禁です。実在しない URL やデッドリンクを出してはいけません。',
  '- 検索しても確認できる適切な出典が得られない場合は、リンクを捏造せず「## 出典」見出しを付けないでください。その場合は本文に「要確認」と明示してください。リンクを捏造するくらいなら、出典なしにするのが正しい対応です。',
  '',
  '【日本基準の予想信用損失・償却原価は ASBJ の最新公開草案を一次情報として踏まえる】',
  '- 日本における予想信用損失（ECL）および償却原価（実効金利法）に関する会計基準は、企業会計基準委員会（ASBJ）が 2025年10月29日に公表した公開草案を中心に検討が進んでいます。中心となる文書は次の 2 つです。',
  '  (i) 企業会計基準公開草案第89号「金融商品に関する会計基準（案）」 … 企業会計基準第10号の改正案。予想信用損失モデルの導入、貸付金・満期保有目的の債券等の償却原価への実効金利法の適用などを提案。',
  '  (ii) 企業会計基準適用指針公開草案第88号「金融資産の予想信用損失に係る会計上の取扱い」 … 予想信用損失の見積りに関する具体的な会計上の取扱いを定める適用指針案。',
  '- コメント期限は 2026年2月6日で、その後 ASBJ は寄せられたコメントへの対応を審議しています。適用時期は、最終基準の公表から 3 年程度経過後の 4 月 1 日以後開始する連結会計年度・事業年度の期首からの適用が提案されています（相談者が想定する 2030年4月 はこの提案に整合的ですが、最終確定ではありません）。',
  '- 日本基準の予想信用損失・償却原価に関する質問に答えるときは、原則として上記の公開草案（およびその後の最新の審議状況・最終基準化の有無）を WebSearch / WebFetch で確認し、その内容に基づいて答えてください。記憶だけで古い内容を述べないこと。一次情報は ASBJ サイト（asb-j.jp）を優先し、実務解釈は大手監査法人（EY・PwC・KPMG・Deloitte 等）の解説で補ってください。',
  '- ただしこれらは現時点で「公開草案」段階であり、最終基準の内容・適用範囲・経過措置・確定スケジュールは変わりうる点に注意してください。確定事項のように断定せず、「公開草案（第89号等）時点では…」と前置きし、未確定の事項は「未確定」「要確認」と明示してください。憶測で確定事項のように述べてはいけません。',
  '',
  '【画像・動画の取り扱い】',
  '- 相談者が画像（資料・図・スクリーンショット・Excel の画面など）を添付した場合、その画像を Read して内容を確認し、ECL/会計/IT/PMO の観点から具体的にコメント・壁打ちしてかまいません。読み取れない箇所は推測で断定せず「読み取れません」と正直に伝えてください。',
  '- 動画が添付された場合、内容の詳細な解析はできません。気になる点は文章で教えていただくようお願いしてください。',
  '',
  '【参考メディアの提示（図解・参考動画・資料画像を埋め込みで添えられます）】',
  '- あなたは回答に、学習・壁打ちに役立つメディア（図解・参考動画・信頼ソースの資料画像）を最大2点まで埋め込んで添えられます。本当に役立つときだけ、原則1〜2点に留めてください（軽い相談・純粋な壁打ちには不要です）。「このチャットには動画を再生・検索する機能がない」といった案内はしないでください（埋め込み機能はあります）。',
  '- メディアを添えたいときは、本文中に次の専用記法を1行で書いてください。サーバがこの記法を受け取り、実在を検証・生成してから実際のメディアに変換します（記法自体は利用者には表示されません）。',
  '- 図解の生成: 「[[gen-image: 図解にしたい内容の説明（日本語）]]」。ECL の3ステージ、PD×LGD×EAD の関係、引当ロールフォワードの要因分解、データフロー/アーキテクチャ、WBS/スケジュールの考え方など、説明を分かりやすくする概念図・スキーマ図をその場で生成します（実データの図ではなく説明用の概念図）。',
  '- 参考動画（YouTube）: 「[[youtube: 動画のwatch URL | なぜこの動画がおすすめかの一言]]」。IFRS9/ECL・会計基準・PMO 実務などの理解に役立つ実在の YouTube 動画の URL（https://www.youtube.com/watch?v=... 形式）を、WebSearch で実在と内容を確認してから書いてください。記憶・推測で URL を組み立ててはいけません。サーバが oEmbed で実在を再検証し、存在しない・限定公開・削除済みの動画は自動で除外します。',
  '- 信頼できる画像・図表: 「[[web-image: 画像のURL | 出典（機関名・ページ名）]]」。IFRS 財団・ASBJ・規制当局・大手監査法人・学術機関など信頼できるソースの実在する画像 URL を、WebSearch/WebFetch で確認できたときだけ書いてください。物販サイト・出典不明サイトの画像は使わないでください。サーバが URL の到達性・画像であること・信頼ホストであることを再検証し、ダメなら自動で除外します。',
  '- 重要: メディアは「あれば添える」程度です。検証で実在が確認できないものは自動的に落ちます。落ちることを前提に、本文はメディアが無くても回答が完結するように書いてください。',
  '- メディア記法は出典の捏造禁止・「公開草案段階は未確定」「要確認」を明示する方針を一切変えません。',
  '',
  '【対象の線引き】',
  '- 本案件（ECL システム導入 PMO）、銀行業務、会計、IT・データ、PMO／プロジェクト管理に関わる相談には、幅広く具体的に答えてください。',
  '- これらと完全に無関係な雑談（占いなど）にだけは深入りせず、穏やかに「本案件・銀行・会計・IT・PMO に関するご相談に専念しています」と伝え、本題へ柔らかく案内してください。',
  '',
  '【「仕事」ツールに用意された ECL 学習用 Excel ワークブックについて】',
  '- 「仕事」ツールのドキュメント（フォルダ「大手町」）に、予想信用損失（ECL）を手を動かして学べる Excel ワークブック「予想信用損失(ECL)シミュレーション_学習用.xlsx」が用意されています。相談者がこのワークブックや特定のシートについて質問したら、その構成・使い方・各シートの計算内容を具体的に説明し、学習をガイドしてください。',
  '- 操作の共通ルール: 各セルは数式が生きており、黄色＝入力セル（変えると自動で再計算）、緑＝計算結果です。',
  '- シート構成（全11シート）は次のとおりです:',
  '  - 使い方・解説: ECLの基本式・PD/LGD/EAD・3ステージの概要と各シートの説明。',
  '  - 出典・ファクトチェック: 記載内容を IFRS財団／ASBJ／大手監査法人の一次情報に照合した検証表と出典リンク。',
  '  - ①基本ECL: ECL＝PD×LGD×EAD を1件で計算。PDを変えるとECLが比例的に動く感応度表つき。',
  '  - ②全期間ECL: 多期間の当期限界PD・期首生存率・割引（実効金利）で全期間ECLを算出し、ステージ（1=12ヶ月ECL／2・3=全期間ECL）で計上額を切替。',
  '  - ③シナリオ加重: 好況・基本・不況の3シナリオを、PD調整係数と確率ウェイトで確率加重（フォワードルッキング）。',
  '  - ④ポートフォリオ例: 複数債権をステージ別に集計。ステージで採用PD（12ヶ月PD↔全期間PD）が自動で切替。',
  '  - ⑤SICR・ステージ判定: 当初比のPD倍率・延滞日数・格下げノッチ・ウォッチ入り・信用減損から、ステージ(1/2/3)と適用ECLを判定。',
  '  - ⑥簡便法プロビジョン: 営業債権を延滞区分×貸倒実績率（プロビジョンマトリクス）で算定する簡便法。',
  '  - ⑦LGD担保・保証: 担保処分価値（評価額×掛目）と保証回収からLGDを算定し、無担保LGDとECL削減効果を比較。',
  '  - ⑧引当ロールフォワード: 期首→期末のECL増減を、新規実行・ステージ移動・パラメータ更新・フォワードルッキング・回収/返済・償却の要因に分解。',
  '  - 用語集: 金融・銀行の知識ゼロ前提で、銀行の基本（融資・与信・担保・デフォルト・引当金等）からECL用語までやさしく解説（30語・5カテゴリ）。',
  '- このワークブックは学習・理解のための簡略モデルであり、実際の会計上の引当計算・開示には使用できない（最終基準・適用指針・監査法人の見解で裏取りが必要）点も、関連する質問のときは添えてください。',
  '',
  '【その他】',
  '- 必ず日本語で回答してください。',
  '- 提供された会話履歴の文脈を踏まえて、自然に続けて答えてください。',
].join('\n');

/**
 * 仕事チャットで claude に許可する組み込みツール。
 * WebSearch / WebFetch を許可して、アドバイザーが実際に実在ページを検索・取得して出典を確認できるようにする。
 * Read を許可して、相談者が添付した画像ファイルを開いて見られるようにする（マルチモーダル）。
 * これは当チャット専用の opt-in。notebook 等の既存 claude 呼び出しには渡さないので挙動は変わらない。
 */
const WORK_ALLOWED_TOOLS = ['WebSearch', 'WebFetch', 'Read'];

// 応答生成時に文脈として渡すサーバ保存履歴の上限件数（トークン肥大の抑止）。
const SERVER_CONTEXT_LIMIT = 30;

// ─── 入力メッセージの正規化 ──────────────────────────────────────
type Role = 'user' | 'assistant';
interface ChatMessageInput {
  role: Role;
  content: string;
}

// 会話履歴・1 メッセージ長の上限（暴走・過大プロンプト抑止）。
const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 4000;

// ─── 許可 MIME（画像 / 動画）────────────────────────────────
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic']);
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/** MIME から種別を判定。許可外は null。 */
function kindOf(mime: string): 'image' | 'video' | null {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  if (IMAGE_MIME.has(m)) return 'image';
  if (VIDEO_MIME.has(m)) return 'video';
  return null;
}

/** 添付メディア参照の入力を検証・正規化する（POST /chat の media フィールド）。 */
function parseMedia(body: unknown): ChatMedia[] {
  const raw = (body as { media?: unknown } | null)?.media;
  if (!Array.isArray(raw)) return [];
  const out: ChatMedia[] = [];
  for (const m of raw) {
    const id = (m as { id?: unknown })?.id;
    const kind = (m as { kind?: unknown })?.kind;
    const url = (m as { url?: unknown })?.url;
    const mime = (m as { mime?: unknown })?.mime;
    if (typeof id !== 'string' || !id) continue;
    if (kind !== 'image' && kind !== 'video') continue;
    if (typeof url !== 'string' || !url) continue;
    const item: ChatMedia = {
      id,
      kind,
      url,
      mime: typeof mime === 'string' ? mime : '',
      source: 'upload',
    };
    const name = (m as { name?: unknown })?.name;
    const size = (m as { size?: unknown })?.size;
    if (typeof name === 'string') item.name = name.slice(0, 200);
    if (typeof size === 'number' && Number.isFinite(size)) item.size = size;
    out.push(item);
    if (out.length >= WORK_CHAT_MEDIA_MAX_FILES) break;
  }
  return out;
}

// ─── メディア実体パスの安全解決（パストラバーサル防止）──────────
// chajiChatRouter の resolveMediaPath / isInside / realpath 方式を踏襲する。

let mediaRoot: string | null = null;
function chatMediaRoot(): string {
  if (mediaRoot) return mediaRoot;
  try {
    mediaRoot = realpathSync(WORK_CHAT_MEDIA_DIR);
  } catch {
    mediaRoot = resolve(WORK_CHAT_MEDIA_DIR);
  }
  return mediaRoot;
}

/** target が base 配下か（境界文字付きで prefix 詐称を防ぐ）。 */
function isInside(base: string, target: string): boolean {
  if (target === base) return true;
  const rel = relative(base, target);
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel);
}

/**
 * 保存名（<id>-<safe-name>）を WORK_CHAT_MEDIA_DIR 配下の安全な絶対パスに解決する。
 * 区切り/絶対パスを弾いてから resolve・realpath で配下を確認する。配下外・不在は null。
 */
function resolveMediaPath(filename: string): string | null {
  if (!filename || filename.includes('/') || filename.includes('\\') || isAbsolute(filename)) {
    return null;
  }
  const root = chatMediaRoot();
  const abs = resolve(root, filename);
  if (!isInside(root, abs)) return null;
  try {
    const real = realpathSync(abs);
    if (!isInside(root, real)) return null;
    return real;
  } catch {
    return null;
  }
}

/** ファイル名のパス区切り・制御文字を無害化する（chaji の sanitize に準拠）。 */
function sanitizeName(name: string): string {
  const base = (name || 'media')
    .replace(/[\\/]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/^\./, '_')
    .replace(/[ -]/g, '_')
    .slice(0, 120);
  return base || 'media';
}

// id → 保存名の対応を multer 処理後に引くため、filename コールバックで採番して req に記録する。
interface UploadIdEntry {
  id: string;
  filename: string;
  kind: 'image' | 'video';
}

// 画像と動画で上限が異なるため、上限は「大きい方（動画）」を multer の limits に設定し、
// 画像が画像上限を超えるケースは保存後チェックで弾く。
const MEDIA_MAX_BYTES = Math.max(WORK_CHAT_IMAGE_MAX_BYTES, WORK_CHAT_VIDEO_MAX_BYTES);

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      mkdirSync(WORK_CHAT_MEDIA_DIR, { recursive: true });
      cb(null, WORK_CHAT_MEDIA_DIR);
    },
    filename(req, file, cb) {
      const kind = kindOf(file.mimetype);
      const id = randomUUID();
      const safe = sanitizeName(file.originalname);
      const filename = `${id}-${safe}`;
      const bag = ((req as Request & { _chatMediaIds?: UploadIdEntry[] })._chatMediaIds ??= []);
      bag.push({ id, filename, kind: kind ?? 'image' });
      cb(null, filename);
    },
  }),
  limits: { fileSize: MEDIA_MAX_BYTES, files: WORK_CHAT_MEDIA_MAX_FILES },
  fileFilter(_req, file, cb) {
    if (!kindOf(file.mimetype)) {
      cb(new Error('対応していない形式です（画像: png/jpeg/webp/gif/heic、動画: mp4/mov/webm）。'));
      return;
    }
    cb(null, true);
  },
});

const uploadFiles = upload.array('files', WORK_CHAT_MEDIA_MAX_FILES);

/** id プレフィックスで保存ディレクトリ内の実ファイル絶対パスを探す（保存名が原名依存で揺れる対策）。 */
function findImagePathsById(images: ChatMedia[]): string[] {
  const root = chatMediaRoot();
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const img of images) {
    const match = entries.find((f) => f.startsWith(`${img.id}-`));
    if (match) {
      const abs = resolveMediaPath(match);
      if (abs) out.push(abs);
    }
  }
  return out;
}

/**
 * 画像添付があるときに、最後の user 発言に「画像を Read して見るよう」指示する補足を足す。
 * claude CLI は CXO_ROOT 配下のファイルを Read できる。メディアは CXO_ROOT/data/work-chat-media/
 * に保存されているので、その絶対パスを渡して読ませる。動画は内容解析できない旨を伝える。
 */
function buildImageHint(media: ChatMedia[]): string {
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video');
  const parts: string[] = [];
  if (images.length > 0) {
    const resolved = findImagePathsById(images);
    if (resolved.length > 0) {
      parts.push(
        '',
        '【添付画像について】相談者が次の画像を添付しました。Read ツールでこれらの画像ファイルを開いて内容を確認し、ECL/会計/IT/PMO の観点から具体的にコメント・壁打ちしてください。読み取れない箇所は推測で断定せず、その旨を正直に伝えてください。',
        ...resolved.map((p) => `- 画像ファイル: ${p}`),
      );
    }
  }
  if (videos.length > 0) {
    parts.push(
      '',
      '【添付動画について】相談者が動画を添付しましたが、動画の内容解析はできません。気になる点は文章で教えていただくようお願いしてください。',
    );
  }
  return parts.join('\n');
}

/** リクエスト body の messages を検証・正規化する。不正なら null を返す。 */
function parseMessages(body: unknown): ChatMessageInput[] | null {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw)) return null;
  const out: ChatMessageInput[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string') continue;
    const text = content.trim().slice(0, MAX_CONTENT_CHARS);
    if (!text) continue;
    out.push({ role, content: text });
  }
  if (out.length === 0) return null;
  // 末尾は必ず user メッセージ（最後の発話に答える）。直近 MAX_MESSAGES 件に絞る。
  const trimmed = out.slice(-MAX_MESSAGES);
  if (trimmed[trimmed.length - 1]?.role !== 'user') return null;
  return trimmed;
}

/** systemPrompt + 会話履歴から claude -p に渡す 1 本のプロンプトを組む。 */
function buildPrompt(messages: ChatMessageInput[]): string {
  const lines = [WORK_SYSTEM_PROMPT, '', '--- これまでの会話 ---'];
  for (const m of messages) {
    lines.push(`${m.role === 'user' ? '相談者' : 'アドバイザー'}: ${m.content}`);
  }
  lines.push(
    '--- 会話ここまで ---',
    '',
    'ECL/PMO アドバイザー兼壁打ち相手として、最後の相談者の発言に日本語で答えてください。',
  );
  return lines.join('\n');
}

/**
 * 応答生成に渡す文脈を組む。
 * 正本はサーバ保存の会話履歴（workChatStore）。直近 SERVER_CONTEXT_LIMIT 件を文脈とし、
 * その末尾にクライアントが今送ってきた新しい user 発言を必ず置く（最後の質問に答える）。
 */
function buildContext(
  clientMessages: ChatMessageInput[],
  media: ChatMedia[],
): { context: ChatMessageInput[]; userText: string } {
  // クライアント payload は parseMessages で末尾 user 保証済み。
  const userText = clientMessages[clientMessages.length - 1]?.content ?? '';
  // サーバ保存の直近履歴。末尾が今回の user と重複している場合は落とす（多重保存防止）。
  const stored = recentContext(SERVER_CONTEXT_LIMIT) as ChatMessageInput[];
  while (
    stored.length > 0 &&
    stored[stored.length - 1]?.role === 'user' &&
    stored[stored.length - 1]?.content === userText
  ) {
    stored.pop();
  }
  // 画像/動画の補足は最後の user 発言に連結する（プロンプト末尾の指示として効く）。
  const hint = media.length > 0 ? buildImageHint(media) : '';
  const lastUser = hint ? `${userText}\n${hint}` : userText;
  return { context: [...stored, { role: 'user', content: lastUser }], userText };
}

/** SSE イベントを 1 行書き出す。 */
function sseWrite(res: Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 利用上限（Sonnet/usage/rate limit 等）由来の失敗かを判定する（notebookRouter と同方針）。 */
function looksLikeLimit(text: string): boolean {
  const h = text.toLowerCase();
  if (h.includes('hit your') && h.includes('limit')) return true;
  return (
    h.includes('usage limit') ||
    h.includes('rate limit') ||
    h.includes('rate_limit') ||
    h.includes('rate-limited') ||
    (h.includes('exceeded') && h.includes('limit'))
  );
}

const LIMIT_MESSAGE =
  '申し訳ありません。ただいま混み合っており、お返事できませんでした。少し時間をおいてからもう一度お試しください。';
const ERROR_MESSAGE =
  '申し訳ありません。お返事の生成に失敗しました。少し時間をおいてからもう一度お試しください。';

// ─── バックグラウンドジョブ（接続から切り離した非同期生成）─────────────────
//
// AI 生成（claude 実行＋Web検索）はクライアント接続の有無に関係なく走り切る。SSE 接続中は
// チャンクを逐次配信するが、接続が切れても claude プロセスは kill せず、完了時に必ずストアへ
// 確定保存する。これにより「画面を離れて戻ったら答えが入っている」を満たす。

/** 進行中ジョブのライブストリーム購読者（SSE 接続が乗っているときだけ存在）。 */
interface JobSubscriber {
  onChunk: (text: string) => void;
  onDone: (answer: string, media: ChatMedia[], status: 'done' | 'error') => void;
}

/** jobId → 進行中ジョブの状態。SSE 後着・再接続でも途中経過と確定結果を拾えるようにする。 */
interface RunningJob {
  buffer: string; // これまでに送出したチャンクの累積（後着クライアントへの追いつき用）。
  subscribers: Set<JobSubscriber>;
  finished: boolean;
  finalAnswer: string;
  finalMedia: ChatMedia[];
  finalStatus: 'done' | 'error';
}

const runningJobs = new Map<string, RunningJob>();

/**
 * バックグラウンドで 1 ジョブを実行し、完了時に必ずストアへ確定保存する。
 * 接続の有無に依存しない（res を受け取らない）。途中経過は RunningJob 経由で購読者に配る。
 */
async function runJob(jobId: string, assistantId: string, prompt: string): Promise<void> {
  const job: RunningJob = {
    buffer: '',
    subscribers: new Set(),
    finished: false,
    finalAnswer: '',
    finalMedia: [],
    finalStatus: 'done',
  };
  runningJobs.set(jobId, job);

  const emitChunk = (text: string) => {
    job.buffer += text;
    for (const s of job.subscribers) {
      try {
        s.onChunk(text);
      } catch {
        /* 切断済み購読者は close ハンドラで除去される */
      }
    }
  };

  try {
    let streamed = '';
    const result = await runClaudeStream(
      CXO_ROOT,
      prompt,
      (chunk) => {
        streamed += chunk;
        emitChunk(chunk);
      },
      { allowedTools: WORK_ALLOWED_TOOLS },
    );

    const answer = (result.stdout || '').trim();
    const failed =
      !result.ok || (answer.length > 0 && answer.length < 400 && looksLikeLimit(answer));

    if (failed && (!streamed.trim() || looksLikeLimit(streamed))) {
      // 実本文が流れていない失敗 → ユーザー向け丁寧メッセージで error 確定（無言で消えない）。
      const haystack = `${result.stdout ?? ''}\n${result.error ?? ''}`;
      const fallback = looksLikeLimit(haystack) ? LIMIT_MESSAGE : ERROR_MESSAGE;
      finalizeAssistant(assistantId, 'error', fallback, []);
      finishJob(job, fallback, [], 'error');
      return;
    }

    // 成功、または途中まで実本文が流れた失敗 → 流れた本文を確定保存する（メディア後処理も適用）。
    const source = failed ? streamed.trim() : answer;
    const { cleaned, media: assistantMedia } = await finalizeAssistantText(source);
    finalizeAssistant(assistantId, 'done', cleaned, assistantMedia);
    finishJob(job, cleaned, assistantMedia, 'done');
  } catch (err) {
    // 予期しない例外でも無言で消さない。error として丁寧メッセージを確定する。
    console.error('[work-chat] job failed:', err);
    finalizeAssistant(assistantId, 'error', ERROR_MESSAGE, []);
    finishJob(job, ERROR_MESSAGE, [], 'error');
  }
}

/**
 * アシスタント本文のメディアディレクティブを後処理する薄いラッパー。
 * 例外時は本文をそのまま返してメディア無しに倒し、チャットを止めない。
 */
async function finalizeAssistantText(
  text: string,
): Promise<{ cleaned: string; media: ChatMedia[] }> {
  try {
    return await processAssistantText(text);
  } catch {
    return { cleaned: text, media: [] };
  }
}

/** ジョブ完了を購読者へ通知し、しばらく後にマップから掃除する（後着クライアントの猶予を残す）。 */
function finishJob(
  job: RunningJob,
  answer: string,
  media: ChatMedia[],
  status: 'done' | 'error',
): void {
  job.finished = true;
  job.finalAnswer = answer;
  job.finalMedia = media;
  job.finalStatus = status;
  for (const s of job.subscribers) {
    try {
      s.onDone(answer, media, status);
    } catch {
      /* noop */
    }
  }
  job.subscribers.clear();
  // 完了直後に再接続してきた SSE が結果を即拾えるよう、少し残してから破棄する。
  const jobIdEntry = [...runningJobs.entries()].find(([, v]) => v === job);
  if (jobIdEntry) {
    const [id] = jobIdEntry;
    setTimeout(() => runningJobs.delete(id), 30_000).unref?.();
  }
}

// POST /chat — 仕事チャット。Accept: text/event-stream で SSE ストリーム、無ければ JSON。
// いずれの経路でも、まず user 発言を即永続化し assistant 側に pending エントリを作って
// バックグラウンドで生成を走らせる（接続が切れても回答は失われない）。
async function handleChat(req: Request, res: Response): Promise<void> {
  const messages = parseMessages(req.body);
  if (!messages) {
    res.status(400).json({ error: 'messages（role/content の配列・末尾は user）が必要です。' });
    return;
  }

  const media = parseMedia(req.body);

  // 正本のサーバ履歴を文脈にし、末尾に今回の user 発言（＋画像補足）を置く。
  const { context, userText } = buildContext(messages, media);
  const prompt = buildPrompt(context);
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  // user を即永続化し、assistant の pending エントリを作る（ここで質問は失われなくなる）。
  const { jobId, assistantId } = startExchange(userText, media.length > 0 ? media : undefined);

  // 生成はバックグラウンドで走らせる（res の生死に依存しない）。await しない。
  void runJob(jobId, assistantId, prompt);
  const job = runningJobs.get(jobId);

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx/cloudflared 越しの buffering を無効化（イベントが即届く／途中で握り込まれない）。
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    // フロントが pending を相関できるよう jobId を最初に通知する。
    sseWrite(res, { type: 'job', jobId });

    if (!job) {
      // 競合等で job が即破棄された稀ケース。結果はストアにあるのでフロントが拾える。
      sseWrite(res, { type: 'done', jobId, answer: '', pending: true });
      res.end();
      return;
    }

    if (job.finished) {
      // 既に完了済み（極めて速い生成）。確定結果をそのまま返す。
      sseWrite(res, {
        type: 'done',
        jobId,
        answer: job.finalAnswer,
        media: job.finalMedia,
        status: job.finalStatus,
      });
      res.end();
      return;
    }

    // ── keep-alive ping（/api/stream に倣う）──────────────────────────────
    // 出典機能の WebSearch は事実質問で 80〜180 秒かかり、その間 SSE が無音になる。
    // cloudflared など proxy/トンネルはアイドル（~100s）で接続を握り込み/切断するため、
    // 15 秒ごとに SSE コメント行（`: ping`）を流してアイドル切断を防ぐ。
    const PING_INTERVAL_MS = 15_000;
    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* 既に切断済みなら close ハンドラで掃除される */
      }
    }, PING_INTERVAL_MS);

    // 途中経過に追いつかせてから購読する。
    if (job.buffer) sseWrite(res, { type: 'chunk', text: job.buffer });
    let closed = false;
    const finish = () => {
      clearInterval(keepAlive);
      if (!closed) {
        closed = true;
        res.end();
      }
    };
    const subscriber: JobSubscriber = {
      onChunk: (text) => {
        if (!closed) sseWrite(res, { type: 'chunk', text });
      },
      onDone: (answer, m, status) => {
        if (closed) return;
        sseWrite(res, { type: 'done', jobId, answer, media: m, status });
        finish();
      },
    };
    job.subscribers.add(subscriber);
    // クライアント切断時は ping を止め購読を外すだけ（claude プロセスは kill しない＝生成は継続）。
    res.on('close', () => {
      closed = true;
      clearInterval(keepAlive);
      job.subscribers.delete(subscriber);
    });
    return;
  }

  // 非ストリーム（JSON）経路: 生成完了を待ってから確定結果を返す（接続が切れてもストアには残る）。
  if (job) {
    await new Promise<void>((resolve) => {
      if (job.finished) {
        resolve();
        return;
      }
      job.subscribers.add({ onChunk: () => {}, onDone: () => resolve() });
    });
  }
  const finished = getJob(jobId);
  if (!finished || finished.status === 'pending') {
    // まだ生成中（待機が早すぎた等）。pending を返してフロントにポーリングさせる。
    res.status(200).json({ jobId, pending: true });
    return;
  }
  res.status(200).json({
    jobId,
    answer: finished.content,
    media: finished.media ?? [],
    status: finished.status ?? 'done',
    ...(finished.status === 'error' ? { errorKind: 'engine_error' } : {}),
  });
}

// GET /chat/history — サーバ保存の会話履歴を返す（フロントの復元用。pending/done/error を含む）。
function handleHistory(_req: Request, res: Response): void {
  try {
    res.status(200).json({ messages: listMessages() });
  } catch {
    res.status(200).json({ messages: [] });
  }
}

// GET /chat/job/:id — 単一ジョブの現在状態を返す（任意。history ポーリングで足りるが軽量取得用）。
function handleJob(req: Request, res: Response): void {
  const id = String(req.params.id ?? '');
  if (!id) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  try {
    const found = getJob(id);
    if (!found) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.status(200).json({
      jobId: id,
      status: found.status ?? 'done',
      answer: found.content,
      media: found.media ?? [],
    });
  } catch {
    res.status(500).json({ error: 'failed to read job' });
  }
}

// DELETE /chat/history — 会話を論理クリアする。
function handleClear(_req: Request, res: Response): void {
  try {
    clearMessages();
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: '履歴の消去に失敗しました。' });
  }
}

/** multer を Promise 化。サイズ/枚数超過・MIME reject は適切なステータスで返して false。 */
function runMediaUpload(req: Request, res: Response): Promise<boolean> {
  return new Promise((done) => {
    uploadFiles(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            const mb = Math.round(MEDIA_MAX_BYTES / (1024 * 1024));
            res.status(413).json({ error: `ファイルサイズが上限（${mb}MB）を超えています。`, code: err.code });
            done(false);
            return;
          }
          res.status(400).json({ error: err.message, code: err.code });
          done(false);
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        done(false);
        return;
      }
      done(true);
    });
  });
}

// POST /chat/upload — 画像/動画をアップロードしてメディア参照を返す（保存のみ。送信は POST /chat）。
async function handleUpload(req: Request, res: Response): Promise<void> {
  mkdirSync(WORK_CHAT_MEDIA_DIR, { recursive: true });
  const ok = await runMediaUpload(req, res);
  if (!ok) return;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const idBag = (req as Request & { _chatMediaIds?: UploadIdEntry[] })._chatMediaIds ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'ファイルがありません（フィールド名は "files" を使用してください）。' });
    return;
  }

  const out: ChatMedia[] = [];
  for (const f of files) {
    const kind = kindOf(f.mimetype);
    if (!kind) continue;
    // 画像は画像上限で個別に弾く（multer limits は動画基準の大きい上限のため）。
    const abs = f.path ?? join(WORK_CHAT_MEDIA_DIR, f.filename);
    let size = f.size;
    try { size = statSync(abs).size; } catch { /* use f.size */ }
    if (kind === 'image' && size > WORK_CHAT_IMAGE_MAX_BYTES) {
      try { unlinkSync(abs); } catch { /* 無視 */ }
      const mb = Math.round(WORK_CHAT_IMAGE_MAX_BYTES / (1024 * 1024));
      res.status(413).json({ error: `画像のサイズが上限（${mb}MB）を超えています。` });
      return;
    }
    const entry = idBag.find((e) => e.filename === f.filename);
    const id = entry?.id ?? randomUUID();
    out.push({
      id,
      kind,
      url: `/api/work/chat/media/${encodeURIComponent(id)}`,
      mime: f.mimetype,
      name: f.originalname,
      size,
      source: 'upload',
    });
  }

  if (out.length === 0) {
    res.status(400).json({ error: '保存できるメディアがありませんでした。' });
    return;
  }
  res.status(201).json({ ok: true, media: out });
}

/** id プレフィックスで保存ディレクトリ内の実ファイル名を探す。 */
function findFilenameById(id: string): string | null {
  const root = chatMediaRoot();
  try {
    const entries = readdirSync(root);
    return entries.find((f) => f.startsWith(`${id}-`)) ?? null;
  } catch {
    return null;
  }
}

/** 保存名（<id>-<original>）の拡張子から MIME を推定する（許可セット限定）。 */
function mimeOf(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}

// GET /chat/media/:id — メディア実体をストリーム配信（Range 対応＝動画シーク）。
function handleStreamMedia(req: Request, res: Response): void {
  const id = String(req.params.id ?? '');
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const filename = findFilenameById(id);
  if (!filename) {
    res.status(404).json({ error: 'media not found' });
    return;
  }
  const abs = resolveMediaPath(filename);
  if (!abs) {
    res.status(404).json({ error: 'media file not found' });
    return;
  }
  let total = 0;
  try {
    const st = statSync(abs);
    if (!st.isFile()) {
      res.status(404).json({ error: 'media file not found' });
      return;
    }
    total = st.size;
  } catch {
    res.status(404).json({ error: 'media file not found' });
    return;
  }
  const mime = mimeOf(filename);
  res.type(mime);
  res.set('Cache-Control', 'private, max-age=300');
  res.set('Accept-Ranges', 'bytes');

  const onErr = (stream: ReturnType<typeof createReadStream>) =>
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'failed to read media' });
      else res.destroy();
    });

  const range = req.headers.range;
  const m = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && total > 0) {
    let start = m[1] === '' ? 0 : Number(m[1]);
    let end = m[2] === '' ? total - 1 : Number(m[2]);
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      res.status(416).set('Content-Range', `bytes */${total}`).end();
      return;
    }
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${total}`);
    res.set('Content-Length', String(end - start + 1));
    const stream = createReadStream(abs, { start, end });
    onErr(stream);
    stream.pipe(res);
    return;
  }

  res.set('Content-Length', String(total));
  const stream = createReadStream(abs);
  onErr(stream);
  stream.pipe(res);
}

export function workChatRouter(): Router {
  const router = Router();
  router.get('/chat/history', (req, res) => handleHistory(req, res));
  router.get('/chat/job/:id', (req, res) => handleJob(req, res));
  router.delete('/chat/history', (req, res) => handleClear(req, res));
  router.post('/chat/upload', (req, res) => void handleUpload(req, res));
  router.get('/chat/media/:id', (req, res) => handleStreamMedia(req, res));
  router.post('/chat', (req, res) => void handleChat(req, res));
  router.post('/glossary/detail', (req, res) => void handleGlossaryDetail(req, res));
  return router;
}
