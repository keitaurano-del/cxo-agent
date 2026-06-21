// workChatRouter — 仕事チャット（ECL/PMO 学習・壁打ちアドバイザー）の API（MC-260）。
//
// 新サイドメニュー「仕事」(/work) から開く、メガバンクの ECL（予想信用損失）システム導入 PMO 案件
// 向けの学習・壁打ちチャット。茶事チャット（chajiChatRouter）のテキストチャット部分をそのまま踏襲し、
// メディア（画像/動画）添付は扱わない（テキストのみ）。
//   - 会話履歴をサーバ側 JSONL（data/work-chat.jsonl）に蓄積する（workChatStore）。
//     端末・リロードをまたいで過去の質問が残る。クライアントの localStorage はキャッシュ扱い。
//   - 応答生成時は直近の履歴を文脈として渡し、過去のやり取りを踏まえて続けて答えられる。
//
// AI 応答は notebookClaude.ts の runClaudeStream（claude -p ベース）を流用する。
// cwd は CXO_ROOT（既存ディレクトリ）を渡す。
//
// 出典リンク機能: このチャット専用に claude へ WebSearch/WebFetch を許可し
// （WORK_ALLOWED_TOOLS → runClaudeStream の opts.allowedTools）、アドバイザーが実際に
// 実在ページを検索・取得して確認した URL だけを「## 出典」セクションに引用できるようにする。
// systemPrompt で捏造リンクを厳禁し、確認できる出典が無ければリンクを出さない。
// この allowedTools は当チャット専用の opt-in で、notebook 等の既存 claude 呼び出しには渡らない。
//
// ルート（index.ts で auth ミドルウェア配下に /api/work で mount）:
//   POST   /chat              { messages: [...] } → SSE ストリーム or JSON
//   GET    /chat/history      → { messages: [{ role, content }] }（サーバ保存の会話履歴）
//   GET    /chat/job/:id      → 単一ジョブの現在状態
//   DELETE /chat/history      → { ok: true }（会話を論理クリア）

import { Router, type Request, type Response } from 'express';

import { CXO_ROOT } from './config.js';
import {
  clearMessages,
  finalizeAssistant,
  getJob,
  listMessages,
  recentContext,
  startExchange,
} from './lib/workChatStore.js';
import { runClaudeStream } from './lib/notebookClaude.js';

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
  '- 出典には次の信頼できる情報源を優先してください: IFRS 財団（ifrs.org）、企業会計基準委員会（ASBJ）、金融庁、日本銀行、大手監査法人・大手コンサルティングファームの公表資料、学術論文・大学等の研究、ベンダー／製品の公式ドキュメント。',
  '- 個人ブログ、出典不明のまとめ・キュレーションサイト、物販が主目的の商業サイトは出典に使わないでください。信頼できるソースが見つからないときは、無理に低品質なサイトを出典にせず、出典なしで「要確認」と明示してください。',
  '【最重要・出典の捏造を絶対にしない】',
  '- 出典として URL を載せてよいのは、このチャット内で実際に WebSearch または WebFetch を使って取得し、内容を確認できたページの URL だけです。',
  '- 記憶・うろ覚え・推測で URL を書いてはいけません。「たぶんこういう URL のはず」で URL を組み立てることは厳禁です。実在しない URL やデッドリンクを出してはいけません。',
  '- 検索しても確認できる適切な出典が得られない場合は、リンクを捏造せず「## 出典」見出しを付けないでください。その場合は本文に「要確認」と明示してください。リンクを捏造するくらいなら、出典なしにするのが正しい対応です。',
  '',
  '【日本の 2030年4月 ECL 移行についての注意（断定しない）】',
  '- 日本における 2030年4月の ECL 移行の具体（最終的な会計基準の内容・適用範囲・経過措置・確定スケジュール等）は、現時点で流動的・未確定な部分があります。',
  '- これらについては断定せず、現時点で確認できる情報と一般原則に基づいて答え、確定していない事項は「未確定」「要確認」と明示してください。憶測で確定事項のように述べてはいけません。',
  '',
  '【対象の線引き】',
  '- 本案件（ECL システム導入 PMO）、銀行業務、会計、IT・データ、PMO／プロジェクト管理に関わる相談には、幅広く具体的に答えてください。',
  '- これらと完全に無関係な雑談（占いなど）にだけは深入りせず、穏やかに「本案件・銀行・会計・IT・PMO に関するご相談に専念しています」と伝え、本題へ柔らかく案内してください。',
  '',
  '【その他】',
  '- 必ず日本語で回答してください。',
  '- 提供された会話履歴の文脈を踏まえて、自然に続けて答えてください。',
].join('\n');

/**
 * 仕事チャットで claude に許可する組み込みツール。
 * WebSearch / WebFetch を許可して、アドバイザーが実際に実在ページを検索・取得して出典を確認できるようにする。
 * これは当チャット専用の opt-in。notebook 等の既存 claude 呼び出しには渡さないので挙動は変わらない。
 */
const WORK_ALLOWED_TOOLS = ['WebSearch', 'WebFetch'];

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
  return { context: [...stored, { role: 'user', content: userText }], userText };
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
  onDone: (answer: string, status: 'done' | 'error') => void;
}

/** jobId → 進行中ジョブの状態。SSE 後着・再接続でも途中経過と確定結果を拾えるようにする。 */
interface RunningJob {
  buffer: string; // これまでに送出したチャンクの累積（後着クライアントへの追いつき用）。
  subscribers: Set<JobSubscriber>;
  finished: boolean;
  finalAnswer: string;
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
      finalizeAssistant(assistantId, 'error', fallback);
      finishJob(job, fallback, 'error');
      return;
    }

    // 成功、または途中まで実本文が流れた失敗 → 流れた本文を確定保存する。
    const source = failed ? streamed.trim() : answer;
    finalizeAssistant(assistantId, 'done', source);
    finishJob(job, source, 'done');
  } catch (err) {
    // 予期しない例外でも無言で消さない。error として丁寧メッセージを確定する。
    console.error('[work-chat] job failed:', err);
    finalizeAssistant(assistantId, 'error', ERROR_MESSAGE);
    finishJob(job, ERROR_MESSAGE, 'error');
  }
}

/** ジョブ完了を購読者へ通知し、しばらく後にマップから掃除する（後着クライアントの猶予を残す）。 */
function finishJob(job: RunningJob, answer: string, status: 'done' | 'error'): void {
  job.finished = true;
  job.finalAnswer = answer;
  job.finalStatus = status;
  for (const s of job.subscribers) {
    try {
      s.onDone(answer, status);
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

  // 正本のサーバ履歴を文脈にし、末尾に今回の user 発言を置く。
  const { context, userText } = buildContext(messages);
  const prompt = buildPrompt(context);
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  // user を即永続化し、assistant の pending エントリを作る（ここで質問は失われなくなる）。
  const { jobId, assistantId } = startExchange(userText);

  // 生成はバックグラウンドで走らせる（res の生死に依存しない）。await しない。
  void runJob(jobId, assistantId, prompt);
  const job = runningJobs.get(jobId);

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
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
      sseWrite(res, { type: 'done', jobId, answer: job.finalAnswer, status: job.finalStatus });
      res.end();
      return;
    }

    // 途中経過に追いつかせてから購読する。
    if (job.buffer) sseWrite(res, { type: 'chunk', text: job.buffer });
    let closed = false;
    const subscriber: JobSubscriber = {
      onChunk: (text) => {
        if (!closed) sseWrite(res, { type: 'chunk', text });
      },
      onDone: (answer, status) => {
        if (closed) return;
        sseWrite(res, { type: 'done', jobId, answer, status });
        res.end();
      },
    };
    job.subscribers.add(subscriber);
    // クライアント切断時は購読を外すだけ（claude プロセスは kill しない＝生成は継続する）。
    res.on('close', () => {
      closed = true;
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

export function workChatRouter(): Router {
  const router = Router();
  router.get('/chat/history', (req, res) => handleHistory(req, res));
  router.get('/chat/job/:id', (req, res) => handleJob(req, res));
  router.delete('/chat/history', (req, res) => handleClear(req, res));
  router.post('/chat', (req, res) => void handleChat(req, res));
  return router;
}
