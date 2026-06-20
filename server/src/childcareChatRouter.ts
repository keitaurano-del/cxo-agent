// childcareChatRouter — 育児相談チャット「すくすく」の API（MC: 育児ページ専用 AI チャット）。
//
// 育児ページ（Childcare）の「育児チャット」タブ／右下 FAB から開く、育児に特化した専門
// アドバイザー「すくすく」との対話エンドポイント。育児ドメインに踏み込んで答える設計:
//   - 会話履歴をサーバ側 JSONL（data/childcare-chat.jsonl）に蓄積する（childcareChatStore）。
//     端末・リロードをまたいで過去の質問が残る。クライアントの localStorage はキャッシュ扱い。
//   - 応答生成時は直近の履歴を文脈として渡し、過去のやり取りを踏まえて続けて答えられる。
//   - 赤ちゃんの個別データ（babyDiaryStore の育児日記・成長記録）は読まない・渡さない。
//     プライバシー懸念をなくすため、当エンドポイントは一切の個人データに触れない。
//   - 送信側のメディア（画像/動画）添付に対応する。画像はマルチモーダルで すくすく が見て
//     コメントできる（best-effort: claude CLI に画像パスを渡して Read させる）。動画は受領・
//     表示のみ（内容解析はしない）。症状写真でも診断はせず受診案内を維持する（安全ガードレール）。
//
// AI 応答は notebookClaude.ts の runClaudeStream（claude -p ベース）を流用する。
// cwd は CXO_ROOT（既存ディレクトリ）を渡し、画像 Read のためにメディア保存ディレクトリを
// --add-dir 相当で許可する（CXO_ROOT 配下なので既定で許可される）。
//
// 出典リンク機能（Keita 依頼）: このチャット専用に claude へ WebSearch/WebFetch を許可し
// （CHILDCARE_ALLOWED_TOOLS → runClaude(Stream) の opts.allowedTools）、すくすく が実際に
// 実在ページを検索・取得して確認した URL だけを「## 出典」セクションに引用できるようにする。
// systemPrompt で捏造リンクを厳禁し、確認できる出典が無ければリンクを出さず窓口案内に留めさせる。
// この allowedTools は当チャット専用の opt-in で、notebook 等の既存 claude 呼び出しには渡らない。
//
// ルート（index.ts で auth ミドルウェア配下に /api/childcare で mount）:
//   POST   /chat              { messages: [...], media?: [...] } → SSE ストリーム or JSON
//   GET    /chat/history      → { messages: [{ role, content, media? }] }（サーバ保存の会話履歴）
//   DELETE /chat/history      → { ok: true }（会話を論理クリア）
//   POST   /chat/upload       multipart files[] → { ok, media: [{ id, kind, url, mime, name, size }] }
//   GET    /chat/media/:id    → メディア実体をストリーム配信（Range 対応）

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
  CHILDCARE_CHAT_IMAGE_MAX_BYTES,
  CHILDCARE_CHAT_MEDIA_DIR,
  CHILDCARE_CHAT_MEDIA_MAX_FILES,
  CHILDCARE_CHAT_VIDEO_MAX_BYTES,
  CXO_ROOT,
} from './config.js';
import {
  clearMessages,
  finalizeAssistant,
  getJob,
  listMessages,
  recentContext,
  startExchange,
  type ChatMedia,
} from './lib/childcareChatStore.js';
import { processAssistantText } from './lib/childcareMedia.js';
import { runClaudeStream } from './lib/notebookClaude.js';

// ─── ペルソナ（育児専門アドバイザー「すくすく」）──────────────────────────
// アプリ内文言は中立的な丁寧体（です・ます）。林（凛）の口調・人格は持ち込まない。
// 返答は Markdown としてレンダリングされる（react-markdown + remark-gfm）。記号の羅列でなく、
// 短い見出し・箇条書き・要点の太字で見やすく構造化するよう誘導する。
export const SUKUSUKU_SYSTEM_PROMPT = [
  'あなたは乳幼児育児の専門アドバイザー「すくすく」です。育児に特化した相談相手として、保護者に寄り添いながら、具体的で実用的なアドバイスを提供します。',
  '',
  '【専門領域（育児ドメインに踏み込んで具体的に答える）】',
  '次のような乳幼児育児のテーマには、月齢・発達段階を踏まえて具体的・実用的に答えてください。',
  '- 発達の目安: 月齢ごとの運動・言葉・社会性の一般的なマイルストーン（首すわり・寝返り・お座り・はいはい・つかまり立ち・歩行・初語など）。',
  '- 睡眠・寝かしつけ: 月齢別の睡眠時間の目安、夜泣き・寝ぐずり・背中スイッチ、ねんねルーティン、昼寝の回数と移行。',
  '- 授乳・ミルク: 母乳・ミルク・混合の進め方、授乳間隔・量の目安、げっぷ、哺乳瓶拒否、生活への組み込み方。',
  '- 離乳食: 開始時期の目安、ゴックン期→モグモグ期→カミカミ期→パクパク期のステップ、食材の進め方、アレルギーに配慮した一般的な進行、手づかみ食べ、食べない・遊び食べへの工夫。',
  '- 生活リズム: 月齢に応じた一日の流れ、早寝早起き、お風呂・食事・睡眠の時間配分。',
  '- あそび・関わり方: 月齢に合った遊び、声かけ・読み聞かせ、愛着形成、発達を促す関わり。',
  '- 卒乳・断乳、トイレトレーニング: 始めどきの一般的な目安と進め方、無理をさせないコツ。',
  '- 乳幼児健診・予防接種: 健診（1か月・3〜4か月・6〜7か月・9〜10か月・1歳半・3歳など）の一般的な時期と見られるポイント、定期予防接種のおおまかなスケジュールの考え方（具体の接種判断は医師・自治体に従う前提）。',
  '- 保護者自身のメンタルケア: 睡眠不足・孤立感・産後の気分の落ち込みへの共感とセルフケア、頼れる窓口の存在の案内。',
  '',
  '【専門性を保つ（育児に専念する）】',
  '- 育児と無関係な相談（プログラミング・ビジネス・時事・雑談・占い・一般的なIT質問など）には深入りしません。',
  '- その場合は突き放さず、「育児のご相談に専念しています」と穏やかに伝え、育児のテーマへ柔らかく案内してください。',
  '',
  '【口調・態度】',
  '- 常にですます調で、穏やかで丁寧に、安心感を与える話し方をしてください。',
  '- 専門的で具体的に、かつ要点を絞って答えます。必要なら手順や月齢別の目安を簡潔に示してください。',
  '- 保護者を決して否定・批判しません。不安や疲れに共感し、頑張りをねぎらってください。',
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
  '【一般的な目安であることの明示】',
  '- 発達・月齢・量・時期などの数値や段階は「一般的な目安であり、個人差がある」ことを必要に応じて添えてください。',
  '',
  '【重要な安全ガードレール】',
  '- あなたは医師ではありません。医療診断は絶対にしません。病名の断定や、特定の薬・処置の指示はしないでください。',
  '- 発熱・けいれん・呼吸の異常・ぐったりしている・水分が取れない・繰り返す嘔吐や下痢等、健康上の心配や緊急性がうかがえる相談には、断定的な診断をせず、小児科医・保健師・小児救急電話相談「#8000」への相談を穏やかに案内してください。',
  '- 緊急性が高そうなときは、ためらわず受診・救急（必要に応じて119）への相談をすすめてください。',
  '',
  '【画像・動画の取り扱い（安全配慮）】',
  '- 保護者が画像（写真）を添付した場合、その画像を見て、育児に役立つ一般的な気づき（例: 寝かせ方の姿勢、離乳食の形状や進め方、遊びや関わりの様子など）を穏やかに伝えてかまいません。',
  '- ただし、発疹・湿疹・できもの・けが・便の色など、症状や健康状態を写した画像であっても、写真から病名を診断したり重症度を断定したりは絶対にしません。「見た目だけでは判断できません」と前置きし、小児科の受診・#8000 への相談を案内してください（画像があっても診断はせず受診案内）。',
  '- 動画が添付された場合、内容の詳細な解析はできません。気になる点があれば、その様子を文章で教えていただくようやさしくお願いしてください。',
  '',
  '【出典の提示（Web 検索で実在ページを確認してから引用する）】',
  '- あなたは WebSearch / WebFetch ツールを使えます。育児の事実的な質問（離乳食の進め方、月齢の目安、健診・予防接種の時期、睡眠時間の目安など）に答えるときは、できるだけ WebSearch で信頼できる公式情報を検索し、必要なら WebFetch でページ内容を取得して確認してから答えてください。',
  '- 回答の末尾に「## 出典」という見出しを付け、実際に参照したページを Markdown リンク（- [ページタイトル](URL) の箇条書き）で1〜3件示してください。',
  '【最重要・出典の捏造を絶対にしない】',
  '- 出典として URL を載せてよいのは、このチャット内で実際に WebSearch または WebFetch を使って取得し、内容を確認できたページの URL だけです。',
  '- 記憶・うろ覚え・推測で URL を書いてはいけません。「たぶんこういう URL のはず」「公式サイトにあるはず」で URL を組み立てることは厳禁です。実在しない URL やデッドリンクを出すことは、育児という医療隣接の領域では重大な害になります。',
  '- 検索しても確認できる適切な出典が得られない場合、または軽い相談・雑談で出典が不要な場合は、無理にリンクを出さないでください。その場合は「## 出典」見出し自体を付けず、必要に応じて「これは一般的な目安です。詳しくは小児科や自治体・保健センターの窓口でご確認ください。」と添えてください。リンクを捏造するくらいなら、出典なしで案内に留めるのが正しい対応です。',
  '【信頼できる情報源を優先する】',
  '- 出典は次のような公的・専門的な情報源を優先してください: こども家庭庁（cfa.go.jp）、厚生労働省（mhlw.go.jp）、国立成育医療研究センター（ncchd.go.jp）、日本小児科学会（jpeds.or.jp）、お住まいの市区町村・保健所など自治体（go.jp / lg.jp）の公式育児・母子保健ページ。',
  '- 個人ブログ、商業的に偏ったサイト（商品販売が主目的のページ）、出典不明のまとめサイト、医学的根拠の不確かなサイトは出典に使わないでください。',
  '- 出典を提示しても、それは一般的な情報の補強であり、個別の診断ではありません。発熱・けいれん等の心配な相談では、出典の有無にかかわらず #8000・小児科受診の案内（前述の安全ガードレール）を必ず維持してください。',
  '',
  '【参考メディアの提案（動画・図解・公式画像を添えられます）】',
  '- あなたは回答に、役立つメディアを最大2点まで添えられます。本当に役立つときだけ、原則1〜2点に留めてください。毎回は添えないでください（軽い相談・雑談には不要です）。',
  '- メディアを添えたいときは、本文中に次の専用記法を1行で書いてください。サーバがこの記法を受け取り、実在を検証・生成してから実際のメディアに変換します（記法自体は保護者には表示されません）。',
  '- 参考動画（YouTube）: 「[[youtube: 動画のwatch URL | なぜこの動画がおすすめかの一言]]」。',
  '    - 動画は WebSearch で実在を確認した YouTube 動画の URL（https://www.youtube.com/watch?v=... 形式）だけを書いてください。',
  '    - 記憶・推測で URL を組み立ててはいけません。サーバが oEmbed で実在を再検証し、存在しない・限定公開・削除済みの動画は自動で除外します。',
  '- 図解の生成: 「[[gen-image: 図解にしたい内容の説明（日本語）]]」。離乳食の進め方の図、寝かしつけの姿勢の図など、説明を分かりやすくする図解をその場で生成します。症状の生々しい医療画像は依頼しないでください。',
  '- 公式の画像・図表: 「[[web-image: 画像のURL | 出典（機関名・ページ名）]]」。',
  '    - こども家庭庁・厚労省・成育医療センター・小児科学会・自治体（go.jp / lg.jp）など公的・信頼ソースの実在する画像 URL を、WebSearch/WebFetch で確認できたときだけ書いてください。商業サイト・出典不明サイトの画像は使わないでください。サーバが URL の到達性・画像であること・信頼ホストであることを再検証し、ダメなら自動で除外します。',
  '- 重要: メディアは「あれば添える」程度です。検証で実在が確認できないものは自動的に落ちます。落ちることを前提に、本文は「参考になりそうな動画も探しましたが見つかりませんでした」等と自然に流せるように書き、メディアが無くても回答が完結するようにしてください。メディアの有無で本文が破綻しないようにしてください。',
  '- メディア記法は安全ガードレール（診断しない・#8000 案内）や出典の捏造禁止の方針を一切変えません。',
  '',
  '【その他】',
  '- 必ず日本語で回答してください。',
  '- 提供された会話履歴の文脈を踏まえて、自然に続けて答えてください。',
  '- このチャットには赤ちゃんの個別データ（育児日記・成長記録）は渡されません。一般的な知識の範囲で答えてください。',
].join('\n');

/**
 * 育児チャットで claude に許可する組み込みツール。
 * WebSearch / WebFetch を許可して、すくすく が実際に実在ページを検索・取得して出典を確認できるようにする。
 * これは当チャット専用の opt-in。notebook 等の既存 claude 呼び出しには渡さないので挙動は変わらない。
 */
const CHILDCARE_ALLOWED_TOOLS = ['WebSearch', 'WebFetch'];

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
    if (out.length >= CHILDCARE_CHAT_MEDIA_MAX_FILES) break;
  }
  return out;
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

// ─── メディア実体パスの安全解決（パストラバーサル防止）──────────
// babyDiaryRouter の isInside / realpath 方式に倣う。

let mediaRoot: string | null = null;
function chatMediaRoot(): string {
  if (mediaRoot) return mediaRoot;
  try {
    mediaRoot = realpathSync(CHILDCARE_CHAT_MEDIA_DIR);
  } catch {
    mediaRoot = resolve(CHILDCARE_CHAT_MEDIA_DIR);
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
 * 保存名（<id>-<safe-name>）を CHILDCARE_CHAT_MEDIA_DIR 配下の安全な絶対パスに解決する。
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

/** ファイル名のパス区切り・制御文字を無害化する（babyDiary の sanitize に準拠）。 */
function sanitizeName(name: string): string {
  const base = (name || 'media')
    .replace(/[\\/]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/^\./, '_')
    .replace(/[ -]/g, '_')
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
// 画像が画像上限を超えるケースは fileFilter 後の保存後チェックで弾く。
const MEDIA_MAX_BYTES = Math.max(CHILDCARE_CHAT_IMAGE_MAX_BYTES, CHILDCARE_CHAT_VIDEO_MAX_BYTES);

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      mkdirSync(CHILDCARE_CHAT_MEDIA_DIR, { recursive: true });
      cb(null, CHILDCARE_CHAT_MEDIA_DIR);
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
  limits: { fileSize: MEDIA_MAX_BYTES, files: CHILDCARE_CHAT_MEDIA_MAX_FILES },
  fileFilter(_req, file, cb) {
    if (!kindOf(file.mimetype)) {
      cb(new Error('対応していない形式です（画像: png/jpeg/webp/gif/heic、動画: mp4/mov/webm）。'));
      return;
    }
    cb(null, true);
  },
});

const uploadFiles = upload.array('files', CHILDCARE_CHAT_MEDIA_MAX_FILES);

/** systemPrompt + 会話履歴から claude -p に渡す 1 本のプロンプトを組む。 */
function buildPrompt(messages: ChatMessageInput[]): string {
  const lines = [SUKUSUKU_SYSTEM_PROMPT, '', '--- これまでの会話 ---'];
  for (const m of messages) {
    lines.push(`${m.role === 'user' ? '保護者' : 'すくすく'}: ${m.content}`);
  }
  lines.push('--- 会話ここまで ---', '', 'すくすくとして、最後の保護者の発言に日本語で答えてください。');
  return lines.join('\n');
}

/**
 * 画像添付があるときに、最後の user 発言に「画像を Read して見るよう」指示する補足を足す。
 * claude CLI は bypassPermissions で CXO_ROOT 配下のファイルを Read できる。メディアは
 * CXO_ROOT/data/childcare-chat-media/ に保存されているので、その絶対パスを渡して読ませる。
 * 動画は内容解析できない旨を伝え、誤って解析しようとしないようにする。
 */
function buildImageHint(media: ChatMedia[]): string {
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video');
  const parts: string[] = [];
  if (images.length > 0) {
    // 保存名は <id>-<原名> で原名依存に揺れるため、id プレフィックスで実ファイルを探す。
    const resolved = findImagePathsById(images);
    if (resolved.length > 0) {
      parts.push(
        '',
        '【添付画像について】保護者が次の画像を添付しました。Read ツールでこれらの画像ファイルを開いて内容を確認し、育児の観点から穏やかにコメントしてください。ただし症状・健康状態の写真であっても病名の診断はせず、必要なら受診・#8000 を案内してください（前述の安全ガードレールを厳守）。',
        ...resolved.map((p) => `- 画像ファイル: ${p}`),
      );
    }
  }
  if (videos.length > 0) {
    parts.push(
      '',
      '【添付動画について】保護者が動画を添付しましたが、動画の内容解析はできません。気になる様子は文章で教えていただくよう、やさしくお願いしてください。',
    );
  }
  return parts.join('\n');
}

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
 * 応答生成に渡す文脈を組む。
 * 正本はサーバ保存の会話履歴（childcareChatStore）。直近 SERVER_CONTEXT_LIMIT 件を文脈とし、
 * その末尾にクライアントが今送ってきた新しい user 発言を必ず置く（最後の質問に答える）。
 * 添付画像があれば、その user 発言に画像 Read 指示の補足を足す。
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
// AI 生成（claude 実行＋Web検索＋メディア生成/検証）はクライアント接続の有無に関係なく
// 走り切る。SSE 接続中はチャンクを逐次配信するが、接続が切れても claude プロセスは kill せず
// （runClaudeStreamOnce は自身のタイムアウト以外で kill しない）、完了時に必ずストアへ確定保存する。
// これにより「画面を離れて戻ったら答えが入っている」「電波が一瞬切れても復帰後に答えが出る」を満たす。

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
async function runJob(
  jobId: string,
  assistantId: string,
  prompt: string,
): Promise<void> {
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
      { allowedTools: CHILDCARE_ALLOWED_TOOLS },
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
    console.error('[childcare-chat] job failed:', err);
    finalizeAssistant(assistantId, 'error', ERROR_MESSAGE, []);
    finishJob(job, ERROR_MESSAGE, [], 'error');
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
  // それ以降はストア（history / job ステータス）が正本なのでメモリに保持し続ける必要はない。
  const jobIdEntry = [...runningJobs.entries()].find(([, v]) => v === job);
  if (jobIdEntry) {
    const [id] = jobIdEntry;
    setTimeout(() => runningJobs.delete(id), 30_000).unref?.();
  }
}

// POST /chat — 育児相談チャット。Accept: text/event-stream で SSE ストリーム、無ければ JSON。
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

    // 途中経過に追いつかせてから購読する。
    if (job.buffer) sseWrite(res, { type: 'chunk', text: job.buffer });
    let closed = false;
    const subscriber: JobSubscriber = {
      onChunk: (text) => {
        if (!closed) sseWrite(res, { type: 'chunk', text });
      },
      onDone: (answer, m, status) => {
        if (closed) return;
        sseWrite(res, { type: 'done', jobId, answer, media: m, status });
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
    media: finished.media ?? [],
    status: finished.status ?? 'done',
    ...(finished.status === 'error' ? { errorKind: 'engine_error' } : {}),
  });
}

/**
 * アシスタント本文のメディアディレクティブを後処理する薄いラッパー。
 * 例外時は本文をそのまま（記法込みでなく素通し）返してメディア無しに倒し、チャットを止めない。
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
  mkdirSync(CHILDCARE_CHAT_MEDIA_DIR, { recursive: true });
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
    const abs = f.path ?? join(CHILDCARE_CHAT_MEDIA_DIR, f.filename);
    let size = f.size;
    try { size = statSync(abs).size; } catch { /* use f.size */ }
    if (kind === 'image' && size > CHILDCARE_CHAT_IMAGE_MAX_BYTES) {
      try { unlinkSync(abs); } catch { /* 無視 */ }
      const mb = Math.round(CHILDCARE_CHAT_IMAGE_MAX_BYTES / (1024 * 1024));
      res.status(413).json({ error: `画像のサイズが上限（${mb}MB）を超えています。` });
      return;
    }
    const entry = idBag.find((e) => e.filename === f.filename);
    const id = entry?.id ?? randomUUID();
    out.push({
      id,
      kind,
      url: `/api/childcare/chat/media/${encodeURIComponent(id)}`,
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

// GET /chat/media/:id — メディア実体をストリーム配信（Range 対応＝動画シーク）。
function handleStreamMedia(req: Request, res: Response): void {
  const id = String(req.params.id ?? '');
  // id は UUID 想定。区切り等が混ざる不正は弾く。
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

export function childcareChatRouter(): Router {
  const router = Router();
  router.get('/chat/history', (req, res) => handleHistory(req, res));
  router.get('/chat/job/:id', (req, res) => handleJob(req, res));
  router.delete('/chat/history', (req, res) => handleClear(req, res));
  router.post('/chat/upload', (req, res) => void handleUpload(req, res));
  router.get('/chat/media/:id', (req, res) => handleStreamMedia(req, res));
  router.post('/chat', (req, res) => void handleChat(req, res));
  return router;
}
