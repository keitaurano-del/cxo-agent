// childcareGuideNotesStore — 育児ガイド「相談メモ」の永続キャッシュ＋差分処理。
//
// 育児チャット「すくすく」の Q&A（done 済みの user 質問＋assistant 回答）を、トピック別に
// 要点整理した「相談メモ」を作って永続化する。育児ガイドを開いたとき（GET /guide-notes）、
// 前回まとめ以降に増えた相談だけを AI に渡して既存メモへ統合する＝常に最新かつ軽量。
//
// データストア（data/childcare-guide-notes.json・.gitignore 済み・ランタイムデータ）:
//   {
//     version: 1,
//     topics: [ { topic, title, points: string[] }, ... ],   // トピック別の整理済みメモ
//     marker: { lastProcessedId, processedPairs },            // 差分カーソル（どこまで処理したか）
//     updatedAt: ISO8601,                                     // 最後に AI 統合した時刻
//     generating: boolean,                                    // 裏で AI 統合中か（多重起動防止＋UI ローディング）
//   }
//
// 差分処理（軽量化の肝）:
//   - カーソルは「最後に処理した assistant メッセージの id」。会話履歴（listResolvedEntries）を
//     走査し、lastProcessedId より後ろの done 済み Q&A ペアだけを新規分として抽出する。
//   - 新規ペアが無ければ AI を呼ばずキャッシュをそのまま返す（runClaude 非実行）。
//   - 新規ペアがあるときだけ、既存メモ（topics）＋新規 Q&A を AI に渡して統合し、カーソルを進める。
//   - 全履歴を毎回再要約しない（既存メモは AI の入力として渡し、増分だけマージさせる）。
//
// 安全: 医療診断の体裁にしない（systemPrompt で「一般的な目安」「気になる時は受診/#8000」を維持）。
// 文言は中立的な丁寧体。すくすくの口調キャラは出さず、整理された読みやすいメモにする。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { CHILDCARE_GUIDE_NOTES_FILE, CXO_ROOT } from '../config.js';
import { listResolvedEntries, type ChatEntry } from './childcareChatStore.js';
import { runClaude } from './notebookClaude.js';

// ─── 型 ─────────────────────────────────────────────────

/** トピック別に整理した 1 セクションの相談メモ。 */
export interface GuideNoteTopic {
  /** 内部キー（睡眠・授乳…のような安定スラグ）。マージの突合に使う。 */
  topic: string;
  /** 表示用の見出し（例: 「睡眠・寝かしつけ」）。 */
  title: string;
  /** 要点（箇条書き）。「何を相談し、要点は何か」を簡潔に。 */
  points: string[];
}

/** 差分カーソル。 */
interface GuideNotesMarker {
  /** 最後に処理した assistant メッセージの id（これより後ろが新規分）。空 = 未処理。 */
  lastProcessedId: string;
  /** これまでに処理した Q&A ペア数（参考・デバッグ用）。 */
  processedPairs: number;
}

/** 永続される相談メモの全体形。 */
export interface GuideNotes {
  version: number;
  topics: GuideNoteTopic[];
  marker: GuideNotesMarker;
  updatedAt: string | null;
  /** 裏で AI 統合中か（true の間は二重起動しない・UI はローディング表示）。 */
  generating: boolean;
}

/** GET /guide-notes が返す公開形（generating はメタとして含める）。 */
export interface GuideNotesResponse {
  topics: GuideNoteTopic[];
  updatedAt: string | null;
  /** 裏で差分更新が走っているか（true ならフロントはローディングを出しつつ後で再取得）。 */
  generating: boolean;
}

const STORE_VERSION = 1;

// 1 回の差分統合で AI に渡す新規 Q&A ペアの上限（プロンプト肥大の抑止）。
// これを超える分は次回の GET で順次消化される（カーソルが少しずつ進む）。
const MAX_NEW_PAIRS_PER_RUN = 20;

// ─── 既知トピック（AI 出力の topic キーを正規化する語彙）──────────────
// AI には自由記述でなくこの語彙からトピックを選ばせる。「その他」で受けこぼしを拾う。
const KNOWN_TOPICS: { topic: string; title: string }[] = [
  { topic: 'sleep', title: '睡眠・寝かしつけ' },
  { topic: 'feeding', title: '授乳・ミルク' },
  { topic: 'solids', title: '離乳食' },
  { topic: 'development', title: '発達の目安' },
  { topic: 'health', title: '健康・受診' },
  { topic: 'play', title: 'あそび・関わり' },
  { topic: 'rhythm', title: '生活リズム' },
  { topic: 'other', title: 'その他' },
];

const TOPIC_ORDER = new Map(KNOWN_TOPICS.map((t, i) => [t.topic, i] as const));
const TOPIC_TITLE = new Map(KNOWN_TOPICS.map((t) => [t.topic, t.title] as const));

// ─── 低レベル I/O ────────────────────────────────────────

/** 空の初期状態。 */
function emptyNotes(): GuideNotes {
  return {
    version: STORE_VERSION,
    topics: [],
    marker: { lastProcessedId: '', processedPairs: 0 },
    updatedAt: null,
    generating: false,
  };
}

/** ファイルから相談メモを読む。壊れていれば空状態を返す（チャットを止めない）。 */
function readNotes(): GuideNotes {
  if (!existsSync(CHILDCARE_GUIDE_NOTES_FILE)) return emptyNotes();
  try {
    const raw = readFileSync(CHILDCARE_GUIDE_NOTES_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<GuideNotes>;
    const topics = Array.isArray(parsed.topics) ? parsed.topics.filter(isValidTopic) : [];
    const marker = parsed.marker ?? { lastProcessedId: '', processedPairs: 0 };
    return {
      version: STORE_VERSION,
      topics,
      marker: {
        lastProcessedId: typeof marker.lastProcessedId === 'string' ? marker.lastProcessedId : '',
        processedPairs:
          typeof marker.processedPairs === 'number' && Number.isFinite(marker.processedPairs)
            ? marker.processedPairs
            : 0,
      },
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      // generating はランタイム状態。プロセス再起動後は false から始める（孤児ロック残留を防ぐ）。
      generating: false,
    };
  } catch {
    return emptyNotes();
  }
}

/** 相談メモを原子的に書く（tmp → rename）。 */
function writeNotes(notes: GuideNotes): void {
  const dir = dirname(CHILDCARE_GUIDE_NOTES_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${CHILDCARE_GUIDE_NOTES_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(notes, null, 2), 'utf-8');
  renameSync(tmp, CHILDCARE_GUIDE_NOTES_FILE);
}

function isValidTopic(t: unknown): t is GuideNoteTopic {
  const o = t as GuideNoteTopic;
  return (
    !!o &&
    typeof o.topic === 'string' &&
    typeof o.title === 'string' &&
    Array.isArray(o.points) &&
    o.points.every((p) => typeof p === 'string')
  );
}

// ─── 差分抽出 ────────────────────────────────────────────

/** 1 件の Q&A ペア（user 質問 → assistant 回答）。 */
interface QaPair {
  /** assistant メッセージの id（カーソル更新に使う）。 */
  assistantId: string;
  question: string;
  answer: string;
}

/**
 * 会話履歴から、カーソル（lastProcessedId）より後ろの done 済み Q&A ペアを新規分として抽出する。
 * - user → assistant(done) が隣接して並ぶペアだけを拾う（pending/error の回答は含めない）。
 * - lastProcessedId 以前のペアは処理済みとしてスキップする。
 */
function extractNewPairs(entries: ChatEntry[], lastProcessedId: string): QaPair[] {
  // カーソルの位置（assistant id）を探す。見つからなければ全件を新規扱い（履歴クリア等で id が消えた場合）。
  let startIdx = 0;
  if (lastProcessedId) {
    const idx = entries.findIndex((e) => e.id === lastProcessedId);
    startIdx = idx >= 0 ? idx + 1 : 0;
  }
  const pairs: QaPair[] = [];
  for (let i = startIdx; i < entries.length; i += 1) {
    const u = entries[i];
    if (u.role !== 'user') continue;
    const a = entries[i + 1];
    if (!a || a.role !== 'assistant') continue;
    // done 済みの回答だけを対象にする（生成中・失敗は次回以降に回す）。
    if (a.status !== 'done') continue;
    const question = u.content.trim();
    const answer = a.content.trim();
    if (!question || !answer) {
      // 内容が空のペアは飛ばすが、カーソルだけは進める（無限に同じ空ペアで詰まらないように）。
      continue;
    }
    pairs.push({ assistantId: a.id, question, answer });
    i += 1; // 回答ぶんを消費。
  }
  return pairs;
}

// ─── AI 統合（差分マージ）────────────────────────────────

/** AI に渡す既存メモの簡易テキスト化（topic ごとに見出し＋箇条書き）。 */
function existingNotesText(topics: GuideNoteTopic[]): string {
  if (topics.length === 0) return '（まだ相談メモはありません）';
  return topics
    .map((t) => {
      const head = `## ${t.title}（topic: ${t.topic}）`;
      const body = t.points.map((p) => `- ${p}`).join('\n');
      return `${head}\n${body}`;
    })
    .join('\n\n');
}

/** 新規 Q&A の簡易テキスト化。 */
function newPairsText(pairs: QaPair[]): string {
  return pairs
    .map((p, i) => `■ 相談${i + 1}\n保護者の質問: ${p.question}\nすくすくの回答（要約元）: ${p.answer}`)
    .join('\n\n');
}

const TOPIC_LIST_FOR_PROMPT = KNOWN_TOPICS.map((t) => `${t.topic}（${t.title}）`).join(' / ');

/** AI 統合プロンプトを組む。出力は JSON（topics 配列）のみを厳格に求める。 */
function buildMergePrompt(existing: GuideNoteTopic[], pairs: QaPair[]): string {
  return [
    'あなたは育児相談の記録を整理するアシスタントです。乳幼児育児チャットでの保護者の相談（Q&A）を、トピック別に要点整理した「相談メモ」にまとめます。',
    '',
    '【あなたの仕事】',
    '既存の相談メモ（JSON 相当）に、新しく追加された相談（Q&A）を統合し、更新後の相談メモ全体を JSON で返してください。',
    '- 新しい相談を、内容に最も合うトピックに振り分けて要点を箇条書きで追記します。',
    '- 同じトピック・似た内容の相談は、既存の要点にマージ（集約）し、重複を増やさないでください。',
    '- 既存の要点は、新しい相談で更新・補強される場合を除き、原則そのまま保持してください（勝手に消さない）。',
    '- 各要点は「保護者が何を相談し、要点（アドバイスの核）は何か」を簡潔に1文〜2文で。長い説明は要約します。',
    '',
    '【トピックの語彙（topic はこのキーから選ぶ）】',
    TOPIC_LIST_FOR_PROMPT,
    '- どれにも当てはまらない相談は other（その他）に入れてください。',
    '',
    '【文体・安全（重要）】',
    '- 中立的な丁寧体（です・ます）で書きます。キャラクター的な口調・方言・絵文字は使いません。',
    '- 医療診断の体裁にしないでください。病名の断定や治療の指示はせず、「一般的な目安」「気になるときは小児科・#8000 に相談」という枠を保ちます。',
    '- 健康・受診に関わる相談は、要点に「気になるときは受診・#8000 へ」の一般的案内を添えてかまいません。',
    '',
    '【既存の相談メモ】',
    existingNotesText(existing),
    '',
    '【新しく追加された相談（これらを統合する）】',
    newPairsText(pairs),
    '',
    '【出力形式（厳守）】',
    '次の JSON だけを出力してください。前後に説明文・コードフェンス（```）・余分なテキストを付けないでください。',
    '{',
    '  "topics": [',
    '    { "topic": "<語彙キー>", "title": "<表示用の見出し>", "points": ["要点1", "要点2"] }',
    '  ]',
    '}',
    '- topics には、相談が存在するトピックのみ含めます（空のトピックは出さない）。',
    '- points は各トピック最大8件程度に集約し、それ以上は要点をまとめて減らします。',
  ].join('\n');
}

/** claude の出力テキストから JSON オブジェクトを頑健に取り出す（コードフェンス・前後ノイズ対応）。 */
function parseTopicsFromOutput(text: string): GuideNoteTopic[] | null {
  const raw = text.trim();
  // コードフェンス内を優先的に拾う。
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates: string[] = [];
  if (fence && fence[1]) candidates.push(fence[1].trim());
  // 最初の { から最後の } までを丸ごと（フェンス無し出力対応）。
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  candidates.push(raw);

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as { topics?: unknown };
      const topics = obj?.topics;
      if (!Array.isArray(topics)) continue;
      const out = topics.filter(isValidTopic);
      if (out.length > 0 || topics.length === 0) return normalizeTopics(out);
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

/** topic キーを既知語彙に寄せ、title を正規化し、既知順で並べ替える。空 points は落とす。 */
function normalizeTopics(topics: GuideNoteTopic[]): GuideNoteTopic[] {
  const out: GuideNoteTopic[] = [];
  for (const t of topics) {
    const key = TOPIC_ORDER.has(t.topic) ? t.topic : 'other';
    const points = t.points.map((p) => p.trim()).filter((p) => p.length > 0);
    if (points.length === 0) continue;
    out.push({ topic: key, title: TOPIC_TITLE.get(key) ?? (t.title || 'その他'), points });
  }
  // 同一 topic が複数に分かれた場合は points を結合して 1 件にまとめる。
  const byKey = new Map<string, GuideNoteTopic>();
  for (const t of out) {
    const cur = byKey.get(t.topic);
    if (cur) cur.points.push(...t.points);
    else byKey.set(t.topic, { ...t, points: [...t.points] });
  }
  return [...byKey.values()].sort(
    (a, b) => (TOPIC_ORDER.get(a.topic) ?? 99) - (TOPIC_ORDER.get(b.topic) ?? 99),
  );
}

// ─── 公開 API ────────────────────────────────────────────

/** 公開形に整形する。 */
function toResponse(notes: GuideNotes): GuideNotesResponse {
  return { topics: notes.topics, updatedAt: notes.updatedAt, generating: notes.generating };
}

// ─── 直列化ミューテックス（read-modify-write のレース防止）─────────────
// 同時 GET が「古い notes を読む → AI 統合 → 書き戻す」を並行に行うと、後勝ちで marker が
// 巻き戻る（lost update）。これを防ぐため、統合（merge）は単一の Promise チェーンに直列化し、
// クリティカルセクションの内側で必ず最新状態を read し直す。プロセス内メモリのチェーンなので
// クラッシュ時は再起動で自然に解除される（孤児ロックが残らない）。
let mergeChain: Promise<unknown> = Promise.resolve();
/** 進行中の merge があるか（待たせず即返したい GET 向けの非ブロッキング判定）。 */
let merging = false;

/** fn を mergeChain に直列接続して実行する（前の merge 完了後に走る）。 */
function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = mergeChain.then(fn, fn);
  // チェーンが reject で途切れないように、待ち用の枝は握りつぶす。
  mergeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * 現在の相談メモを返す。新しい相談（done 済み Q&A）があれば、返す前に差分統合してから返す。
 * - 新規ペアが無ければ AI を呼ばずキャッシュを即返す（軽量・非ブロッキング）。
 * - 新規ペアがあれば、merge を直列化キューに積み、その内側で最新状態を read し直してから
 *   既存メモ＋新規分を AI に渡して統合し、カーソルを進めて永続化する。
 *   AI 失敗時は既存メモをそのまま返す（カーソルは進めない＝次回再試行）。
 *
 * 同期実行（await）。育児ガイドのタブ表示時に呼ばれ、UI はローディングを出して待てる。
 */
export async function getGuideNotes(): Promise<GuideNotesResponse> {
  const notes = readNotes();
  const entries = listResolvedEntries();
  const newPairs = extractNewPairs(entries, notes.marker.lastProcessedId);

  if (newPairs.length === 0) {
    // 差分なし → AI 非実行でキャッシュ即返し（軽量化の肝）。
    return toResponse(notes);
  }

  // 既に merge が走っているなら、待たずに既存メモ＋generating=true を返す（UI はローディング→再取得）。
  if (merging) {
    return toResponse({ ...notes, generating: true });
  }

  // merge を直列化して実行する。内側で fresh read し直すので、待っている間に増えた分も拾える。
  return runSerialized(() => mergeOnce());
}

/**
 * クリティカルセクション本体（直列実行される）。最新状態を read し直してから 1 バッチ統合する。
 * marker は単調前進のみ（巻き戻さない）。
 */
async function mergeOnce(): Promise<GuideNotesResponse> {
  merging = true;
  try {
    // 直列化の内側で必ず最新を read し直す（待機中に他リクエストが進めた marker を尊重する）。
    const notes = readNotes();
    const entries = listResolvedEntries();
    const newPairs = extractNewPairs(entries, notes.marker.lastProcessedId);
    if (newPairs.length === 0) {
      // 直前の merge が全部処理済みにしていた → AI を呼ばず返す。
      return toResponse(notes);
    }

    const batch = newPairs.slice(0, MAX_NEW_PAIRS_PER_RUN);
    const prompt = buildMergePrompt(notes.topics, batch);
    const result = await runClaude(CXO_ROOT, prompt);
    if (!result.ok) {
      return toResponse(notes); // AI 失敗 → カーソル据え置き（次回再試行）。
    }
    const merged = parseTopicsFromOutput(result.stdout || '');
    if (!merged) {
      return toResponse(notes); // 解析失敗 → 同上。
    }
    const updated: GuideNotes = {
      version: STORE_VERSION,
      topics: merged,
      marker: {
        lastProcessedId: batch[batch.length - 1].assistantId,
        processedPairs: notes.marker.processedPairs + batch.length,
      },
      updatedAt: new Date().toISOString(),
      generating: false,
    };
    writeNotes(updated);
    return toResponse(updated);
  } catch {
    return toResponse(readNotes()); // 予期しない例外 → 最新キャッシュを返す。
  } finally {
    merging = false;
  }
}
