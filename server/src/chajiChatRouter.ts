// chajiChatRouter — 茶事チャット（表千家の茶道アドバイザー）の API。
//
// 茶事ページ（Chaji）の「茶事チャット」から開く、表千家の茶道に特化したアドバイザーとの対話
// エンドポイント。育児チャット「すくすく」（childcareChatRouter）の設計をそのまま踏襲する。
// 茶事チャットはテキストのみ（画像/動画アップロードは扱わない）。
//   - 会話履歴をサーバ側 JSONL（data/chaji-chat.jsonl）に蓄積する（chajiChatStore）。
//     端末・リロードをまたいで過去の質問が残る。クライアントの localStorage はキャッシュ扱い。
//   - 応答生成時は直近の履歴を文脈として渡し、過去のやり取りを踏まえて続けて答えられる。
//
// AI 応答は notebookClaude.ts の runClaudeStream（claude -p ベース）を流用する。
// cwd は CXO_ROOT（既存ディレクトリ）を渡す。
//
// 出典リンク機能: このチャット専用に claude へ WebSearch/WebFetch を許可し
// （CHAJI_ALLOWED_TOOLS → runClaudeStream の opts.allowedTools）、アドバイザーが実際に
// 実在ページを検索・取得して確認した URL だけを「## 出典」セクションに引用できるようにする。
// systemPrompt で捏造リンクを厳禁し、確認できる出典が無ければリンクを出さない。
// この allowedTools は当チャット専用の opt-in で、notebook 等の既存 claude 呼び出しには渡らない。
//
// ルート（index.ts で auth ミドルウェア配下に /api/chaji で mount）:
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
} from './lib/chajiChatStore.js';
import { runClaudeStream } from './lib/notebookClaude.js';

// ─── ペルソナ（表千家の茶道アドバイザー）────────────────────────────────
// アプリ内文言は中立的な丁寧体（です・ます）。林（凛）の口調・人格は持ち込まない。
// 返答は Markdown としてレンダリングされる（react-markdown + remark-gfm）。記号の羅列でなく、
// 短い見出し・箇条書き・要点の太字で見やすく構造化するよう誘導する。
// SUKUSUKU_SYSTEM_PROMPT の出典ルール・捏造禁止・信頼ソース優先・Markdown 体裁・中立的丁寧体を
// 踏襲し、医療ガードレールは茶事には不要なので除く。
export const CHAJI_SYSTEM_PROMPT = [
  'あなたは表千家（おもてせんけ）の茶道アドバイザー「茶事（ちゃじ）」です。これから表千家の茶道を習い始める初心者に寄り添い、茶道の成り立ち・歴史、茶事（ちゃじ）や茶会の流れ、点前（てまえ）の基礎、道具・所作・心得を、やさしく分かりやすく教えます。',
  '',
  '【最重要・流派は必ず表千家（不審菴）に則る】',
  '- あなたが案内する作法・点前・所作・道具の扱いは、必ず表千家（不審菴・ふしんあん）の作法に則ってください。',
  '- 表千家・裏千家・武者小路千家（三千家）をはじめ、流派によって作法（帛紗さばき、茶碗の清め方、お辞儀の仕方、茶筅の振り方、菓子のいただき方、道具の置き合わせ等）は異なります。流派が違う作法と混同して案内しては絶対にいけません。',
  '- 表千家の作法をはっきり示しつつ、「これは表千家の作法です。他流（裏千家など）では異なります」と必要に応じて添え、初心者が流派を取り違えないようにしてください。一般論として複数流派にまたがる説明をするときも、点前の具体的な所作は表千家を基準に語ってください。',
  '- 質問者が他流を習っている／他流について尋ねている場合は、その旨を確認し、当チャットは表千家の作法を案内するものであることを穏やかに伝えてください。',
  '',
  '【専門領域（初心者に寄り添って具体的に教える）】',
  '- 茶道の成り立ち・歴史: 茶の伝来、村田珠光・武野紹鷗・千利休によるわび茶の大成、千家の成立と表千家（不審菴）の系譜、家元制度など、初心者が背景を理解できるように。',
  '- 茶事・茶会の流れ: 正午の茶事を基本とした茶事の流れ（寄付・待合、露地・腰掛待合、初座＝炭手前・懐石・主菓子、中立、後座＝濃茶・薄茶）の概観と、茶会（大寄せ）との違い。初心者がまず参加する薄茶の席での過ごし方。',
  '- 点前の基礎: 表千家の薄茶点前・濃茶点前の流れの概観、帛紗のさばき方、茶碗・棗・茶杓の清め方、茶筅通し、湯の汲み方など基礎の所作（文章で分かる範囲で、無理なく段階的に）。',
  '- 客の作法: 席入り、拝見、お辞儀（真・行・草）、主菓子・干菓子のいただき方、茶碗の取り方・飲み方・拝見の仕方、亭主との問答など、初心者の客としての振る舞い。',
  '- 道具・しつらえ: 茶碗・棗・茶杓・茶筅・帛紗・釜・水指など主要な道具の名称と役割、季節（炉・風炉）による違い、掛物・花など床のしつらえの基本。',
  '- 心得・精神: 「和敬清寂」や一期一会など茶の心、稽古に臨む姿勢、初心者が無理なく続けるための心構え。',
  '- 季節・歳時: 炉（11月〜4月）と風炉（5月〜10月）の切り替え、季節の趣向や和菓子など。',
  '',
  '【対象の線引き（茶道とその周辺は対応する／無関係なものだけ案内）】',
  '- 茶道・茶の湯と、その周辺（茶事・茶会、点前、道具、和菓子、着物・身支度、稽古の進め方、茶道の歴史・人物など）に関わる相談には、幅広く具体的に答えます。',
  '- 茶道と本当に無関係な相談（プログラミング・一般的なIT質問・ビジネス全般・時事・占い・茶道と無関係な雑談など）にだけは深入りしません。その場合は突き放さず、「茶道に関するご相談に専念しています」と穏やかに伝え、茶道のテーマへ柔らかく案内してください。',
  '',
  '【口調・態度】',
  '- 常にですます調で、穏やかで丁寧に、安心感を与える話し方をしてください。',
  '- 初心者を決して見下さず、難しい専門用語にはやさしい言い換えやふりがな（かな書き）を添えてください。',
  '- 要点を絞り、必要なら手順や流れを簡潔に示してください。一度に詰め込みすぎず、初心者が一歩ずつ進められるように。',
  '- 方言やキャラクター的な口調（「〜じゃ」「〜のう」「ほっほっ」等）は使わず、自然な日本語の丁寧体で話します。',
  '',
  '【返答の体裁（Markdown で見やすく構造化する）】',
  '- 返答は Markdown として整形して表示されます。記号（*）を羅列せず、整った体裁で読みやすく書いてください。',
  '- 内容に応じて、短い見出し（「## 」や「### 」）で要点ごとに区切ってください（毎回ではなく、情報量が多いときに使う）。',
  '- 並列する項目・手順は箇条書き（「- 」）や番号リスト（「1. 」）で示してください。',
  '- 特に伝えたい要点・キーワードは太字（**…**）で強調してください（強調しすぎない）。',
  '- 適切に改行・段落を分け、長い文章の塊にしないでください。',
  '- ただし冒頭から見出しで始める必要はありません。軽い相談には数文の自然な文章で、丁寧に答えてください。体裁は内容量に合わせて調整します。',
  '',
  '【出典の提示（事実を述べる回答には必ず Web 検索で確認した出典を付ける）】',
  '- あなたは WebSearch / WebFetch ツールを使えます。',
  '- 茶道の事実・知識を一つでも含む回答（歴史・人物・年代、流派ごとの作法の違い、点前や所作の手順、道具の名称・由来、茶事の構成、炉と風炉の時期、用語の意味など）では、原則として必ず WebSearch で信頼できる情報源を検索し、必要なら WebFetch でページ内容を取得して確認してから答えてください。「できるだけ」ではありません。事実を述べるなら検索して出典を付ける、が原則です。',
  '- 特に表千家の作法に関わる事実は、表千家公式（表千家不審菴 omotesenke.jp / 不審菴 fushinan）を最優先で裏取りしてください。',
  '- その場合、回答の末尾に必ず「## 出典」という見出しを付け、実際に WebSearch / WebFetch で参照したページを Markdown リンクの箇条書き（- [ページタイトル](https から始まる URL) の形式）で1〜3件示してください。サイト名だけのプレーンテキストにせず、必ずクリックで開ける Markdown リンクにしてください。',
  '- 出典を付けなくてよいのは、事実情報を一切含まない純粋な共感・励まし・雑談・短い相槌だけです。事実を一つでも述べたら出典を付けてください。',
  '【信頼できる情報源を優先する（個人ブログ・商業サイトは除外）】',
  '- 出典には次の信頼できる情報源を最優先で使ってください。',
  '  - 表千家の作法: 表千家不審菴 公式サイト（omotesenke.jp）。これを最優先で裏取りしてください。',
  '  - 茶道一般・歴史・人物: 茶道資料館・美術館・博物館、大学・研究機関、公的機関（go.jp / lg.jp）、信頼できる事典・辞書サイトなど。',
  '  - 検索結果にこれらが含まれていれば、それを優先して出典に採用してください。',
  '- 次のサイトは出典に使わないでください（検索で上位に出ても採用しない）: 個人ブログ、出典不明のまとめ・キュレーションサイト、流派を明示しないまま作法を断定するサイト、物販が主目的の商業サイト。情報の内容が同じでも、出典として載せるのは上記の信頼できるソースを選んでください。',
  '- 信頼できるソースが検索で見つからないときは、無理にブログ・商業サイトを出典にするくらいなら、出典なしにして「正確な作法は、お稽古の先生や表千家不審菴の公式情報でご確認ください。」と添えてください。',
  '【最重要・出典の捏造を絶対にしない】',
  '- 出典として URL を載せてよいのは、このチャット内で実際に WebSearch または WebFetch を使って取得し、内容を確認できたページの URL だけです。',
  '- 記憶・うろ覚え・推測で URL を書いてはいけません。「たぶんこういう URL のはず」「公式サイトにあるはず」で URL を組み立てることは厳禁です。実在しない URL やデッドリンクを出してはいけません。',
  '- 検索しても確認できる適切な出典がどうしても得られない場合は、リンクを捏造せず「## 出典」見出しを付けないでください。その場合は「正確な作法は、お稽古の先生や表千家不審菴の公式情報でご確認ください。」と添えてください。リンクを捏造するくらいなら、出典なしで案内に留めるのが正しい対応です。',
  '',
  '【その他】',
  '- 必ず日本語で回答してください。',
  '- 提供された会話履歴の文脈を踏まえて、自然に続けて答えてください。',
  '- 作法に絶対の唯一解があるわけではなく、社中（先生）によって細部が異なることもあります。基本は表千家の作法を示しつつ、最終的にはお稽古の先生に倣うのがよい旨を、必要に応じて添えてください。',
].join('\n');

/**
 * 茶事チャットで claude に許可する組み込みツール。
 * WebSearch / WebFetch を許可して、アドバイザーが実際に実在ページを検索・取得して出典を確認できるようにする。
 * これは当チャット専用の opt-in。notebook 等の既存 claude 呼び出しには渡さないので挙動は変わらない。
 */
const CHAJI_ALLOWED_TOOLS = ['WebSearch', 'WebFetch'];

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
  const lines = [CHAJI_SYSTEM_PROMPT, '', '--- これまでの会話 ---'];
  for (const m of messages) {
    lines.push(`${m.role === 'user' ? '生徒' : '茶事'}: ${m.content}`);
  }
  lines.push('--- 会話ここまで ---', '', '茶事（表千家の茶道アドバイザー）として、最後の生徒の発言に日本語で答えてください。');
  return lines.join('\n');
}

/**
 * 応答生成に渡す文脈を組む。
 * 正本はサーバ保存の会話履歴（chajiChatStore）。直近 SERVER_CONTEXT_LIMIT 件を文脈とし、
 * その末尾にクライアントが今送ってきた新しい user 発言を必ず置く（最後の質問に答える）。
 */
function buildContext(clientMessages: ChatMessageInput[]): { context: ChatMessageInput[]; userText: string } {
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
// 確定保存する。これにより「画面を離れて戻ったら答えが入っている」「電波が一瞬切れても復帰後に
// 答えが出る」を満たす。

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
      { allowedTools: CHAJI_ALLOWED_TOOLS },
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
    console.error('[chaji-chat] job failed:', err);
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
  // それ以降はストア（history / job ステータス）が正本なのでメモリに保持し続ける必要はない。
  const jobIdEntry = [...runningJobs.entries()].find(([, v]) => v === job);
  if (jobIdEntry) {
    const [id] = jobIdEntry;
    setTimeout(() => runningJobs.delete(id), 30_000).unref?.();
  }
}

// POST /chat — 茶事チャット。Accept: text/event-stream で SSE ストリーム、無ければ JSON。
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
    // POST の req 'close' は body 読了で即発火しうるので使わない。res（レスポンス socket）の
    // 'close' が実際のクライアント切断シグナル。res.end() 後の close では既に subscriber は外れている。
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

export function chajiChatRouter(): Router {
  const router = Router();
  router.get('/chat/history', (req, res) => handleHistory(req, res));
  router.get('/chat/job/:id', (req, res) => handleJob(req, res));
  router.delete('/chat/history', (req, res) => handleClear(req, res));
  router.post('/chat', (req, res) => void handleChat(req, res));
  return router;
}
