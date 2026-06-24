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
import { listEntries } from './lib/babyDiaryStore.js';
import { listPiyologDays, type PiyologDay } from './lib/babyPiyologStore.js';
import {
  clearMessages,
  finalizeAssistant,
  getJob,
  listMessages,
  recentContext,
  startExchange,
  type ChatMedia,
} from './lib/childcareChatStore.js';
import { getGuideNotes } from './lib/childcareGuideNotesStore.js';
import { processAssistantText } from './lib/childcareMedia.js';
import { runClaudeStream } from './lib/notebookClaude.js';

// ─── ペルソナ（育児専門アドバイザー「すくすく」）──────────────────────────
// アプリ内文言は中立的な丁寧体（です・ます）。林（凛）の口調・人格は持ち込まない。
// 返答は Markdown としてレンダリングされる（react-markdown + remark-gfm）。記号の羅列でなく、
// 短い見出し・箇条書き・要点の太字で見やすく構造化するよう誘導する。
export const SUKUSUKU_SYSTEM_PROMPT = [
  'あなたは育児の専門アドバイザー「すくすく」です。乳幼児の育児だけでなく、育児にまつわる制度・手続き・お金・施設・買い物・グッズ・家庭運営まで、子育てに関わることなら幅広く相談に乗ります。保護者に寄り添いながら、具体的で実用的なアドバイスを提供します。',
  '',
  '【専門領域（育児にまつわることに幅広く踏み込んで具体的に答える）】',
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
  '次のような、育児にまつわる制度・手続き・お金のテーマにも、一般的な仕組みと流れを分かりやすく説明してください（金額・条件・締切は変わりやすいので、後述の「確認のお願い」を必ず添えます）。',
  '- 休業・給付: 育児休業・育児休業給付金、出生時育児休業（産後パパ育休）、産前産後休業、出産育児一時金、出産手当金など、対象・おおよその給付水準・申請の流れ・時期の一般的な考え方。',
  '- 手当・助成: 児童手当、乳幼児・子ども医療費助成、（自治体により）出産・子育て応援給付など、対象や申請のタイミングの一般的な案内。',
  '- 保育・教育施設: 保育園・認定こども園・幼稚園の申込（いわゆる保活）・入園の流れ、申込時期の一般的な目安、選び方の観点。',
  '- 母子保健・予防接種の公費: 母子健康手帳の交付、定期予防接種・健診の公費の一般的な仕組み。',
  '- 扶養・社会保険など: 子の健康保険の加入、扶養の手続きなど、どこに相談すればよいかを含めた一般的な流れ。',
  '- これらは「いつ・どこで・どんな書類で・どんな順番で」を一般論として整理して示し、保護者が次の一歩を踏み出せるようにします。',
  '',
  '次のような、買うべきもの・育児グッズの相談にも、中立的・実用的に答えてください。',
  '- 出産準備リスト、月齢別に必要になるものの一般的な目安、ベビー用品（ベビーカー・チャイルドシート・抱っこひも・ベビーベッド・哺乳びん・衣類など）の選び方の観点。',
  '- まず「本当に必要かどうかの考え方」と「選ぶ基準（安全性・サイズ・季節・住環境・生活スタイルとの相性）」を示します。家庭ごとに必要なものは違う前提で、押し付けません。',
  '- 特定の商品やブランドの押し売りはしません。製品カテゴリや一般的な選択肢を挙げるのは構いませんが、購入を急かしません。',
  '- 安全に関わる事実（安全基準・対象月齢の目安・リコール情報など）に触れるときは、後述の出典ルールに従って公的な情報源を付けてください。',
  '',
  'さらに、子育てにまつわる相談全般（保護者のメンタル、家事との両立、きょうだいの関わり、職場復帰、地域の子育て支援・相談窓口など）も対象です。寄り添いながら、できる範囲で実用的に案内してください。',
  '',
  '【対象の線引き（育児・子育てとその周辺は対応する／本当に無関係なものだけ案内）】',
  '- 育児・子育てと、その周辺（手続き・お金・施設・グッズ・家庭運営・保護者の暮らし）に関わる相談には、幅広く具体的に答えます。',
  '- 子育てと本当に無関係な相談（プログラミング・一般的なIT質問・ビジネス全般・時事・占い・子育てと無関係な雑談など）にだけは深入りしません。その場合は突き放さず、「子育てに関するご相談に専念しています」と穏やかに伝え、子育てのテーマへ柔らかく案内してください。',
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
  '【制度・手続き・お金の相談での確認のお願い（断定で締めない）】',
  '- 育児休業給付金・出産育児一時金・児童手当・医療費助成・保活・社会保険などの制度は、金額・条件・締切・対象が法改正や年度で変わり、さらにお勤め先の健康保険組合やお住まいの自治体（市区町村）によって扱いが異なります。',
  '- ですから、一般的な仕組みと流れは分かりやすく説明しつつ、断定で締めないでください。回答には必ず「最新の正確な内容は、お勤め先の人事・ハローワーク、お住まいの自治体（市区町村）の窓口、年金事務所、加入している健康保険組合など、ご自身に当てはまる窓口でご確認ください」という趣旨の案内を添えてください。',
  '- 「あなたの場合は必ず◯円もらえます」「締切は必ず◯日です」のような個別断定はしません。「一般的にはこういう仕組み・流れです」という枠を保ち、最終確認は公式窓口へ、と促してください。',
  '- 制度・お金・安全に関わる事実を述べるときは、後述の出典ルールに従って公的な情報源（厚生労働省・こども家庭庁・日本年金機構・協会けんぽ・自治体など）の踏める出典を付けてください（捏造は厳禁）。',
  '',
  '【買い物・育児グッズの相談での姿勢】',
  '- まず「家庭ごとに必要なものは違う」前提で、必要かどうかの考え方と、選ぶ基準（安全性・対象月齢・サイズ・季節・住環境・生活スタイルとの相性）を中立に示します。特定商品やブランドの押し売り・購入の急かしはしません。',
  '- 安全に関わる事実（安全基準・対象月齢の目安・リコール情報など）を述べるときは、後述の出典ルールに従って公的な情報源を付けます。商品レビューサイト・通販サイト・メーカー販促ページは出典に使いません。製品名や購入先に言及する場合も、URL は実際に検索で確認したものだけにし、捏造はしません。',
  '',
  '【画像・動画の取り扱い（安全配慮）】',
  '- 保護者が画像（写真）を添付した場合、その画像を見て、育児に役立つ一般的な気づき（例: 寝かせ方の姿勢、離乳食の形状や進め方、遊びや関わりの様子など）を穏やかに伝えてかまいません。',
  '- ただし、発疹・湿疹・できもの・けが・便の色など、症状や健康状態を写した画像であっても、写真から病名を診断したり重症度を断定したりは絶対にしません。「見た目だけでは判断できません」と前置きし、小児科の受診・#8000 への相談を案内してください（画像があっても診断はせず受診案内）。',
  '- 動画が添付された場合、内容の詳細な解析はできません。気になる点があれば、その様子を文章で教えていただくようやさしくお願いしてください。',
  '',
  '【出典の提示（事実を述べる回答には必ず Web 検索で確認した出典を付ける）】',
  '- あなたは WebSearch / WebFetch ツールを使えます。',
  '- 育児・子育ての事実・知識を一つでも含む回答（発達の目安、睡眠時間や量・時期、授乳・ミルク、離乳食の進め方、生活リズム、健診・予防接種の時期やスケジュール、安全、月齢別の目安、健康に関する一般知識、さらに制度・手続き・お金（育休給付・各種手当・助成・保活・社会保険など）、育児グッズの安全に関わる事実（安全基準・対象月齢・リコールなど）を含む回答）では、原則として必ず WebSearch で公的・信頼できる情報源を検索し、必要なら WebFetch でページ内容を取得して確認してから答えてください。「できるだけ」ではありません。事実を述べるなら検索して出典を付ける、が原則です。',
  '- その場合、回答の末尾に必ず「## 出典」という見出しを付け、実際に WebSearch / WebFetch で参照したページを Markdown リンクの箇条書き（- [ページタイトル](https から始まる URL) の形式）で1〜3件示してください。サイト名だけのプレーンテキストにせず、必ずクリックで開ける Markdown リンクにしてください。',
  '- 出典を付けなくてよいのは、事実情報を一切含まない純粋な感情的傾聴・共感・雑談・短い相槌（例:「疲れた、聞いてほしい」「眠れなくてつらい」への寄り添い）だけです。事実を一つでも述べたら出典を付けてください。',
  '【信頼できる情報源を優先する（商業・ブログは除外）】',
  '- 出典には次の公的・専門的な情報源を最優先で使ってください。',
  '  - 育児・健康・母子保健: こども家庭庁（cfa.go.jp）、厚生労働省（mhlw.go.jp）、国立成育医療研究センター（ncchd.go.jp）、日本小児科学会（jpeds.or.jp）、お住まいの市区町村・保健所など自治体（go.jp / lg.jp）の公式育児・母子保健ページ。',
  '  - 制度・手続き・お金（育休給付・各種手当・助成・保活・社会保険など）: 厚生労働省（mhlw.go.jp）、こども家庭庁（cfa.go.jp）、ハローワーク・雇用保険（mhlw.go.jp / hellowork.mhlw.go.jp）、日本年金機構（nenkin.go.jp）、全国健康保険協会 協会けんぽ（kyoukaikenpo.or.jp）、各自治体（go.jp / lg.jp）の公式ページ。',
  '  - 製品安全・育児グッズの安全（安全基準・対象月齢・リコールなど）: 消費者庁（caa.go.jp）、製品評価技術基盤機構 NITE（nite.go.jp）、製品安全協会（SG基準）、国民生活センター（kokusen.go.jp）など。',
  '  - 検索結果にこれらが含まれていれば、それを優先して出典に採用してください。',
  '- 次のサイトは出典に使わないでください（検索で上位に出ても採用しない）: 個人ブログ、商品・サービスの販売が主目的の商業サイト（育児用品メーカー・通販・口コミ・比較アフィリエイトサイト等）、出典不明のまとめ・キュレーションサイト、医学的根拠の不確かなサイト。情報の内容が同じでも、出典として載せるのは上記の公的・専門ソースを選んでください。',
  '- 公的・専門ソースが検索で見つからないときは、無理に商業・ブログを出典にするくらいなら、出典なしにして「これは一般的な目安です。詳しくは小児科や自治体・保健センターの窓口、制度のことはお勤め先・ハローワーク・自治体の窓口でご確認ください。」と添えてください。',
  '【最重要・出典の捏造を絶対にしない】',
  '- 出典として URL を載せてよいのは、このチャット内で実際に WebSearch または WebFetch を使って取得し、内容を確認できたページの URL だけです。',
  '- 記憶・うろ覚え・推測で URL を書いてはいけません。「たぶんこういう URL のはず」「公式サイトにあるはず」で URL を組み立てることは厳禁です。実在しない URL やデッドリンクを出すことは、育児という医療隣接の領域では重大な害になります。',
  '- 検索しても確認できる適切な出典がどうしても得られない場合は、リンクを捏造せず「## 出典」見出しを付けないでください。その場合は「これは一般的な目安です。詳しくは小児科や自治体・保健センターの窓口、制度のことはお勤め先・ハローワーク・自治体の窓口でご確認ください。」と添えてください。リンクを捏造するくらいなら、出典なしで案内に留めるのが正しい対応です。',
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
  '【この家庭の赤ちゃんの記録（ぴよログ）を踏まえる】',
  '- あなたには、この家庭の赤ちゃんのぴよログ（育児記録）の要約が、システム側から「赤ちゃんの記録（ぴよログ要約）」というブロックで渡されます（会話の前段に置かれます）。',
  '- 質問に関連するときは、その記録を踏まえて、この子に合わせた具体的なアドバイスをしてください。例: 月齢に対する授乳・睡眠・おむつの一般的な目安とこの子の実際の記録を比べる、体重・身長の推移にふれる、いまの生活リズムに合った提案をする、など。',
  '- 一般的な目安（事実）を述べるときは出典ルールに従って公的ソースのリンクを付け、この子の記録に基づく個別の話と両立させてください。例:「この子の昨日の睡眠合計は◯時間で、この月齢の一般的な目安は△△時間です〔出典リンク〕。記録を見るとおおむね目安の範囲です」のように、実際の数値（記録由来）と一般目安（出典付き）を分けて示します。',
  '- 記録の数値はあくまで参考です。記録から医療診断や異常の断定は絶対にしないでください。気になる増減（体重が増えない・授乳量が大きく減った等）や症状がうかがえるときは、一般的な目安を添えつつ「記録だけでは判断できません」と前置きし、小児科・保健師・#8000 への相談を案内してください（前述の安全ガードレールを厳守）。',
  '- 記録が無い、または日数が少ない場合は「まだ記録が少ない」前提で、無理に推測や断定をしないでください。一般的な目安を案内しつつ、必要なら記録を続けることをやさしく促してください。',
  '- 記録と無関係な一般的な相談（離乳食の開始時期、制度・手続き、グッズの選び方など）には、これまでどおり一般的な知識として答えてください。記録に無理に結びつけないでください。',
  '',
  '【その他】',
  '- 必ず日本語で回答してください。',
  '- 提供された会話履歴の文脈を踏まえて、自然に続けて答えてください。',
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

// ─── ぴよログ要約コンテキスト（この家庭の赤ちゃんの記録を踏まえた個別回答用）──────
//
// listPiyologDays() / listEntries() の生データはイベントが日あたり 40〜50 行と重い。
// トークン肥大を避けるため、直近 N 日の「日次サマリ中心」に要約したコンテキストブロックを
// systemPrompt の直後に注入する。含める情報:
//   - 月齢/日齢（最新日の ageLabel）
//   - 直近の日次サマリ（授乳=母乳分/ミルク回数・量、睡眠合計、おむつ回数）
//   - 体重・身長の推移（最古・最新・件数）
//   - 最新日だけイベントを少し詳しめ（生活リズムの参考、件数は絞る）
//   - 成長日記（memo/milestone）の直近補完
// データが無い/少ない場合は「記録が少ない」前提を明示し、推測を促さない。

/** 要約に含める直近日数（日次サマリ）。新生児はイベントが多いので 14 日に抑える。 */
const PIYOLOG_CONTEXT_DAYS = 14;
/** 最新日に詳しめに載せるイベントの最大件数（生活リズムの参考）。 */
const PIYOLOG_LATEST_EVENT_LIMIT = 16;

/** "母乳合計 左 75分 / 右 75分" 等の生サマリ行から接頭辞ラベルを落として値だけ返す。 */
function summaryValue(line: string | undefined): string {
  if (!line) return '';
  // "○合計" 接頭辞を除いた残りを値として使う（無ければ行そのまま）。
  return line.replace(/^\S*合計\s*/, '').trim() || line.trim();
}

/** 値文字列に「0でない実績」が含まれるか（"0回 0ml"・"0分"・"0時間0分" 等を実績なしと判定する）。 */
function hasNonZero(value: string): boolean {
  if (!value) return false;
  // 数字を全て取り出し、どれか 1 つでも 0 でなければ実績ありとみなす。
  const nums = value.match(/\d+(?:\.\d+)?/g);
  if (!nums) return false;
  return nums.some((n) => Number(n) > 0);
}

/**
 * 1 日分のサマリを 1 行に圧縮する（授乳・睡眠・おむつ）。
 * 授乳・睡眠・おむつがすべて実質ゼロでイベントも無い日は「記録なし（未記録の可能性）」に倒す。
 * （入院中などでぴよログ未記録の日が "母乳0分/睡眠0時間" として残り、睡眠0時間等を異常と誤読
 *  させないため。計測のみ残っている日は体重/身長だけ載せる。）
 */
function summarizeDayLine(day: PiyologDay): string {
  const s = day.summary ?? {};
  const parts: string[] = [];
  const breast = summaryValue(s.breastMilk);
  const formula = summaryValue(s.formula);
  const sleep = summaryValue(s.sleep);
  const pee = summaryValue(s.pee);
  const poop = summaryValue(s.poop);
  const careActivity =
    hasNonZero(breast) || hasNonZero(formula) || hasNonZero(sleep) || hasNonZero(pee) || hasNonZero(poop);
  const nonMeasureEvents = day.events.filter((e) => e.kind !== 'weight' && e.kind !== 'height');

  const label = day.ageLabel ? `${day.date}（${day.ageLabel}）` : day.date;
  const w = day.weights?.[day.weights.length - 1];
  const h = day.heights?.[day.heights.length - 1];

  // 授乳・睡眠・おむつの実績もケアイベントも無い日 → 未記録扱い（計測値だけ添える）。
  if (!careActivity && nonMeasureEvents.length === 0) {
    const measure: string[] = [];
    if (w) measure.push(`体重 ${w.kg}kg`);
    if (h) measure.push(`身長 ${h.cm}cm`);
    const tail = measure.length > 0 ? `（記録なし／${measure.join(' / ')}）` : '記録なし（未記録の可能性）';
    return `- ${label}: ${tail}`;
  }

  if (hasNonZero(breast)) parts.push(`母乳 ${breast}`);
  if (hasNonZero(formula)) parts.push(`ミルク ${formula}`);
  if (hasNonZero(sleep)) parts.push(`睡眠 ${sleep}`);
  if (hasNonZero(pee)) parts.push(`おしっこ ${pee}`);
  if (hasNonZero(poop)) parts.push(`うんち ${poop}`);
  if (w) parts.push(`体重 ${w.kg}kg`);
  if (h) parts.push(`身長 ${h.cm}cm`);
  return `- ${label}: ${parts.length > 0 ? parts.join(' / ') : '記録あり（詳細なし）'}`;
}

/** 体重・身長の推移行（最古→最新と件数）を作る。データが無ければ空文字。 */
function trendLine(
  days: PiyologDay[],
  kind: 'weights' | 'heights',
  unit: 'kg' | 'cm',
  label: string,
): string {
  const points: { date: string; v: number }[] = [];
  for (const d of days) {
    for (const m of d[kind]) {
      points.push({ date: d.date, v: kind === 'weights' ? (m as { kg: number }).kg : (m as { cm: number }).cm });
    }
  }
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length === 1) {
    return `- ${label}: ${last.v}${unit}（${last.date}・記録1件）`;
  }
  const diff = Math.round((last.v - first.v) * 100) / 100;
  const sign = diff > 0 ? `+${diff}` : `${diff}`;
  return `- ${label}: ${first.v}${unit}（${first.date}）→ ${last.v}${unit}（${last.date}）／変化 ${sign}${unit}・記録${points.length}件`;
}

/**
 * 成長日記（babyDiaryStore）から直近の memo/milestone を補完行として拾う。
 * 同じ赤ちゃんの記録。余裕があれば月齢/成長の補強に使う（任意）。
 */
function diaryHighlightLines(): string[] {
  let entries: ReturnType<typeof listEntries>;
  try {
    entries = listEntries();
  } catch {
    return [];
  }
  const recent = entries.slice(-PIYOLOG_CONTEXT_DAYS);
  const out: string[] = [];
  for (const e of recent) {
    const bits: string[] = [];
    if (e.milestone) bits.push(`記念: ${e.milestone}`);
    if (e.memo) bits.push(e.memo.replace(/\s+/g, ' ').slice(0, 60));
    if (typeof e.weightKg === 'number') bits.push(`体重 ${e.weightKg}kg`);
    if (typeof e.heightCm === 'number') bits.push(`身長 ${e.heightCm}cm`);
    if (bits.length > 0) out.push(`- ${e.date}: ${bits.join(' / ')}`);
  }
  return out;
}

/**
 * ぴよログ＋成長日記から「赤ちゃんの記録（ぴよログ要約）」コンテキストブロックを組む。
 * トークン肥大を避けて要約（直近 PIYOLOG_CONTEXT_DAYS 日の日次サマリ中心）。記録が無い/少ない
 * 場合はその旨を明示し、すくすくが無理に推測しないよう前提を添える。例外時は空文字（回答は止めない）。
 */
function buildPiyologContext(): string {
  let allDays: PiyologDay[] = [];
  try {
    allDays = listPiyologDays();
  } catch {
    allDays = [];
  }
  const diaryLines = diaryHighlightLines();

  // ぴよログも成長日記も無い → 記録なしの前提だけ伝える。
  if (allDays.length === 0 && diaryLines.length === 0) {
    return [
      '--- 赤ちゃんの記録（ぴよログ要約）---',
      'この家庭の赤ちゃんの記録（ぴよログ・成長日記）はまだ登録されていません。記録が無い前提で、一般的な目安として答えてください（個別の推測や断定はしないでください）。',
      '--- 記録ここまで ---',
    ].join('\n');
  }

  const recent = allDays.slice(-PIYOLOG_CONTEXT_DAYS);
  const latest = allDays[allDays.length - 1];

  const lines: string[] = ['--- 赤ちゃんの記録（ぴよログ要約。この子に合わせて踏まえてください）---'];

  // 月齢/日齢。
  if (latest?.ageLabel) {
    lines.push(`【月齢・日齢】最新の記録日 ${latest.date} 時点で「${latest.ageLabel}」。`);
  }

  // 記録が少ないときの注意（日数が少ない＝推測しすぎない前提）。
  if (allDays.length > 0 && allDays.length < 3) {
    lines.push(
      `※ ぴよログの記録はまだ ${allDays.length} 日分と少ないです。傾向の断定は避け、一般的な目安を中心に答えてください。`,
    );
  }

  // 日次サマリ（直近）。
  if (recent.length > 0) {
    lines.push('', `【直近 ${recent.length} 日の日次サマリ（授乳・睡眠・おむつ・計測）】`);
    for (const d of recent) lines.push(summarizeDayLine(d));
  }

  // 体重・身長の推移。
  const wTrend = trendLine(allDays, 'weights', 'kg', '体重の推移');
  const hTrend = trendLine(allDays, 'heights', 'cm', '身長の推移');
  if (wTrend || hTrend) {
    lines.push('', '【体重・身長の推移】');
    if (wTrend) lines.push(wTrend);
    if (hTrend) lines.push(hTrend);
  }

  // 最新日だけイベントを少し詳しめ（生活リズムの参考）。件数を絞る。
  if (latest && latest.events.length > 0) {
    const evs = latest.events.slice(0, PIYOLOG_LATEST_EVENT_LIMIT);
    lines.push('', `【最新日 ${latest.date} の主な記録（時刻順・抜粋）】`);
    for (const e of evs) lines.push(`- ${e.time} ${e.text}`);
    if (latest.events.length > evs.length) {
      lines.push(`- （ほか ${latest.events.length - evs.length} 件）`);
    }
  }

  // 成長日記の補完（memo/milestone）。
  if (diaryLines.length > 0) {
    lines.push('', '【成長日記のメモ（直近・保護者の記録）】');
    lines.push(...diaryLines);
  }

  lines.push(
    '',
    '※ 上記はこの家庭の実際の記録です。関連する質問にはこの記録を踏まえて具体的に答えてください。ただし数値から医療診断・異常の断定はせず、気になる点は一般的な目安を添えつつ受診・#8000 を案内してください。',
    '--- 記録ここまで ---',
  );
  return lines.join('\n');
}

/** systemPrompt + ぴよログ要約 + 会話履歴から claude -p に渡す 1 本のプロンプトを組む。 */
function buildPrompt(messages: ChatMessageInput[]): string {
  const piyologContext = buildPiyologContext();
  const lines = [SUKUSUKU_SYSTEM_PROMPT, '', piyologContext, '', '--- これまでの会話 ---'];
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

// GET /guide-notes — 育児ガイドの「相談メモ」を返す。
// 育児チャットの Q&A をトピック別に整理したメモを永続キャッシュから返す。前回まとめ以降に
// 新しい相談（done 済み Q&A）があれば、返す前に差分だけ AI 統合してから返す（無ければ即返し）。
// 医療診断の体裁にせず、中立的な丁寧体・一般的な目安として整理したメモを返す。
async function handleGuideNotes(_req: Request, res: Response): Promise<void> {
  try {
    const notes = await getGuideNotes();
    res.status(200).json(notes);
  } catch {
    // 想定外失敗でも 500 で JSON を返す（SPA フォールバック HTML を返さない）。
    res.status(500).json({ error: '相談メモの取得に失敗しました。', topics: [], updatedAt: null });
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
  router.get('/guide-notes', (req, res) => void handleGuideNotes(req, res));
  router.get('/chat/history', (req, res) => handleHistory(req, res));
  router.get('/chat/job/:id', (req, res) => handleJob(req, res));
  router.delete('/chat/history', (req, res) => handleClear(req, res));
  router.post('/chat/upload', (req, res) => void handleUpload(req, res));
  router.get('/chat/media/:id', (req, res) => handleStreamMedia(req, res));
  router.post('/chat', (req, res) => void handleChat(req, res));
  return router;
}
