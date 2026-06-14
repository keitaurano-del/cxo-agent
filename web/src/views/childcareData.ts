// 育児ページ（/childcare）の静的 curated データ（MC-226 Phase1）。
// 誕生日・性別はここで一元管理し、ビューは算出して描画する（ハードコード禁止）。
// 医療・制度情報は「目安／要確認」を徹底。出典は公式機関名を併記。
// AI/RAG 連携は後続フェーズ。ここでは構造化した静的データのみ。

// 第一子（男児）の誕生日（ISO, JST 基準）。
export const BIRTH_DATE = '2026-06-10';
export const BABY_SEX = 'male' as const;
export const BABY_SEX_LABEL = '男の子';

// 居住地コンテキスト（区独自サービス／自治体給付の文脈表示に使う）。
export const RESIDENCE = '文京区';

// ───────────────────────────────────────────────────────────
// 日付ユーティリティ（JST 基準。クライアントの現在日と BIRTH_DATE から算出）。
// ───────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 文字列(YYYY-MM-DD)を JST 0:00 起点の「日番号」へ正規化する。 */
function toJstDayNumber(date: Date): number {
  return Math.floor((date.getTime() + JST_OFFSET_MS) / MS_PER_DAY);
}

/** 'YYYY-MM-DD' を JST の日付として Date 化する。 */
export function parseIsoDate(iso: string): Date {
  // 'YYYY-MM-DDT00:00:00+09:00' として解釈し、JST 基準を固定する。
  return new Date(`${iso}T00:00:00+09:00`);
}

/** BIRTH_DATE を 1 日目とした「生後日数」（当日＝1日目換算）。 */
export function daysSinceBirth(now: Date = new Date()): number {
  const birth = toJstDayNumber(parseIsoDate(BIRTH_DATE));
  const today = toJstDayNumber(now);
  return today - birth + 1;
}

/** 生後日数から「N週D日」を返す（0–1か月などの帯判定に使う経過日数ベース）。 */
export function weeksAndDays(now: Date = new Date()): { weeks: number; days: number } {
  // 経過日数（誕生日＝0日経過）。
  const elapsed = Math.max(0, daysSinceBirth(now) - 1);
  return { weeks: Math.floor(elapsed / 7), days: elapsed % 7 };
}

/** 月齢（満。誕生日の応当日で繰り上がる）。 */
export function ageInMonths(now: Date = new Date()): number {
  const birth = parseIsoDate(BIRTH_DATE);
  let months =
    (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  return Math.max(0, months);
}

/** BIRTH_DATE から指定日数後の ISO 日付を返す（出生届の14日以内などの算出用）。 */
export function isoFromBirthOffset(days: number): string {
  const base = parseIsoDate(BIRTH_DATE);
  const d = new Date(base.getTime() + days * MS_PER_DAY);
  // JST 基準で日付部分のみを取り出す。
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/** BIRTH_DATE から指定月数後の ISO 日付（健診の目安日算出用）。 */
export function isoFromBirthMonthOffset(months: number): string {
  const base = parseIsoDate(BIRTH_DATE);
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + months);
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' を 'YYYY年M月D日' 表記へ。 */
export function formatJpDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((s) => Number(s));
  return `${y}年${m}月${d}日`;
}

/** 今日（クライアント現在日）を ISO(JST) で返す。 */
export function todayIso(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/** 期限日(iso)までの残り日数（負なら超過）。当日＝0。 */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return toJstDayNumber(parseIsoDate(iso)) - toJstDayNumber(now);
}

// ───────────────────────────────────────────────────────────
// セクション②: 成長タイムライン（発達の目安／月齢で出し分け）
// 「個人差が大きい目安。心配は健診・かかりつけ医へ」を明記する。
// ───────────────────────────────────────────────────────────

export interface GrowthStage {
  /** 帯のラベル。 */
  label: string;
  /** この帯に該当する月齢の下限（含む）。 */
  fromMonth: number;
  /** この帯に該当する月齢の上限（含まない）。最後の帯は null。 */
  toMonth: number | null;
  /** 発達の目安（箇条書き）。 */
  points: string[];
}

export const GROWTH_STAGES: GrowthStage[] = [
  {
    label: '0–1か月（新生児期）',
    fromMonth: 0,
    toMonth: 1,
    points: [
      '1日16–18時間ほど眠る（昼夜問わず）。',
      '授乳は2–3時間ごとが目安。',
      '原始反射（モロー反射・吸啜反射など）がみられる。',
      '視力は20–30cmにピントが合う程度。',
      '生理的体重減少のあと、体重が増えはじめる。',
    ],
  },
  {
    label: '1か月',
    fromMonth: 1,
    toMonth: 2,
    points: [
      '少しまとまって眠る兆しが出てくる。',
      '追視（動くものを目で追う）が出始める。',
      '1か月健診の時期。',
    ],
  },
  {
    label: '2か月',
    fromMonth: 2,
    toMonth: 3,
    points: [
      '社会的微笑（あやすと笑う）がみられる。',
      '予防接種スタート（同時接種）。',
      'うつ伏せで頭を少し上げる。',
    ],
  },
  {
    label: '3–4か月',
    fromMonth: 3,
    toMonth: 5,
    points: [
      '首がすわる。',
      '声を出して笑う。',
      '手を口へ持っていく。',
      '3–4か月健診の時期。',
    ],
  },
  {
    label: '5–6か月',
    fromMonth: 5,
    toMonth: 7,
    points: [
      '寝返りをする。',
      '離乳食開始の目安。',
    ],
  },
];

export const GROWTH_DISCLAIMER =
  '発達には個人差が大きく、ここに挙げたのはあくまで目安です。心配なことは健診やかかりつけ医にご相談ください。';

// ───────────────────────────────────────────────────────────
// セクション③: 父親（夫）としてやること（産後すぐ〜産褥期）
// 「医療判断ではなく一般的な役割分担。異常時は専門家へ」を明記。
// ───────────────────────────────────────────────────────────

export interface FatherTask {
  title: string;
  detail: string;
}

export const FATHER_TASKS: FatherTask[] = [
  {
    title: '産後の妻のケアを最優先',
    detail:
      '産褥期（およそ6–8週）は回復期。家事を巻き取り、しっかり休ませて睡眠を確保する。',
  },
  {
    title: '授乳サポート',
    detail: 'ミルクの調乳・哺乳、げっぷ、夜間当番の分担で負担をシェアする。',
  },
  {
    title: '沐浴・オムツ替え・着替え・寝かしつけ',
    detail: '沐浴は1日1回が目安。日々のケアを積極的に担う。',
  },
  {
    title: '家事全般',
    detail: '食事・洗濯・買い物・掃除を引き受ける。',
  },
  {
    title: '産後うつのサインに注意',
    detail:
      '落ち込み・涙・不眠・不安などが2週間以上続く場合は、産婦人科や自治体の相談窓口へ。',
  },
  {
    title: '役所手続きの代行',
    detail: '出生届など、父が動きやすい手続きを引き受ける。',
  },
];

export const FATHER_DISCLAIMER =
  '医療的な判断ではなく、一般的な役割分担の目安です。体調などに異常があるときは専門家にご相談ください。';

// ───────────────────────────────────────────────────────────
// 締切付き項目の共通型（セクション①の「いま来るもの」で横断的に使う）。
// ───────────────────────────────────────────────────────────

export type DueKind = 'admin' | 'checkup';

export interface DueItem {
  id: string;
  kind: DueKind;
  title: string;
  /** 締切/予定日（ISO, JST）。算出値の場合は isEstimate=true。 */
  dueIso: string;
  /** 期日が「○日以内」等の算出値かどうか（要役所/医療機関確認の注記用）。 */
  isEstimate: boolean;
  /** 期日の根拠・補足（例: 出生日を含めて14日以内）。 */
  dueNote: string;
}

// ───────────────────────────────────────────────────────────
// セクション④: 行政手続き（締切付き・先回り。日本の制度準拠）
// 各項目に「金額・期限・対象は制度改定や自治体で異なる」キャプション＋出典。
// ───────────────────────────────────────────────────────────

export interface AdminProcedure extends DueItem {
  kind: 'admin';
  /** 窓口。 */
  where: string;
  /** 持ち物・手続き内容など。 */
  body: string[];
  /** 出典（公式機関名）。 */
  source: string;
  /** 最優先フラグ（直近・最重要）。 */
  topPriority?: boolean;
}

export const ADMIN_CAPTION =
  '金額・期限・対象は制度改定やお住まいの自治体・保険者で異なります。必ずお住まいの市区町村／加入する保険者でご確認ください。';

export const ADMIN_PROCEDURES: AdminProcedure[] = [
  {
    id: 'birth-registration',
    kind: 'admin',
    title: '出生届',
    dueIso: isoFromBirthOffset(13), // 生まれた日を含めて14日以内（誕生日=1日目）。
    isEstimate: true,
    dueNote:
      '生まれた日を含めて14日以内。14日目が休日のときは翌開庁日まで。日付は算出値のため役所でご確認を。',
    where: '市区町村役場',
    body: [
      '出生証明書（出生届と一体・医師／助産師が記入）を添えて提出。',
      '母子健康手帳を持参。',
    ],
    source: '出典: 法務省／市区町村',
    topPriority: true,
  },
  {
    id: 'child-allowance',
    kind: 'admin',
    title: '児童手当（認定請求）',
    dueIso: isoFromBirthOffset(15), // 出生日の翌日から15日以内（15日特例）の目安。
    isEstimate: true,
    dueNote:
      '出生後できるだけ早く。「15日特例」＝出生日の翌日から15日以内に申請すれば出生月分から支給。目安日は算出値。',
    where: '市区町村（公務員は勤務先）',
    body: [
      '2024年10月から拡充（所得制限なし・高校生年代まで・第3子以降は増額）。',
    ],
    source: '出典: こども家庭庁／市区町村',
  },
  {
    id: 'health-insurance',
    kind: 'admin',
    title: '健康保険の加入（扶養）',
    dueIso: isoFromBirthOffset(13), // 出生後早めに（目安1–2週）。出生届と同時期に並べる。
    isEstimate: true,
    dueNote: '出生後早めに（目安1–2週）。乳幼児医療費助成の前提になる。',
    where: '勤務先（社会保険）またはお住まいの市区町村（国民健康保険）',
    body: ['加入後、乳幼児医療費助成の申請に進む。'],
    source: '出典: 各保険者',
  },
  {
    id: 'infant-medical-subsidy',
    kind: 'admin',
    title: '乳幼児医療費助成（子ども医療費）',
    dueIso: isoFromBirthOffset(20), // 健康保険加入後すみやかに、の目安。
    isEstimate: true,
    dueNote:
      '健康保険の加入後すみやかに。対象年齢・自己負担・方法は自治体差が大きい。目安日は算出値。',
    where: 'お住まいの自治体',
    body: ['健康保険証ができてから申請するのが一般的。'],
    source: '出典: 各自治体',
  },
  {
    id: 'birth-lump-sum',
    kind: 'admin',
    title: '出産育児一時金',
    dueIso: isoFromBirthOffset(13), // 多くは出産前後に分娩機関経由で手続き。早めに案内。
    isEstimate: true,
    dueNote:
      '1児につき50万円（産科医療補償制度対象の分娩機関。対象外は48.8万円／2023年4月〜）。多くは直接支払制度で分娩機関経由（事前手続き）。事後申請は出産日の翌日から2年以内。',
    where: '加入する保険者（協会けんぽ・健保組合・国保 等）／分娩機関',
    body: ['直接支払制度を使う場合は分娩機関での事前手続きを確認。'],
    source: '出典: 厚生労働省／各保険者',
  },
  {
    id: 'maternity-leave-benefits',
    kind: 'admin',
    title: '（該当者のみ）出産手当金・育児休業給付金',
    dueIso: isoFromBirthOffset(60), // 被用者向け。優先度は低めに後ろへ。
    isEstimate: true,
    dueNote: '被用者向け。対象や手続き時期は勤務先・保険者で確認を。',
    where: '勤務先／協会けんぽ・健保組合／ハローワーク',
    body: ['育児休業の取得予定に合わせて勤務先と調整。'],
    source: '出典: 各保険者／ハローワーク',
  },
];

// ───────────────────────────────────────────────────────────
// セクション⑤: 健診・予防接種（先回り）
// 「日程は自治体・医療機関で確認。同時接種が標準」を明記。
// ───────────────────────────────────────────────────────────

export interface CheckupItem extends DueItem {
  kind: 'checkup';
  body: string[];
  source: string;
}

export const CHECKUP_CAPTION =
  '日程は自治体・医療機関でご確認ください。予防接種は同時接種が標準です。目安日は誕生日からの算出値です。';

export const CHECKUP_ITEMS: CheckupItem[] = [
  {
    id: 'checkup-1m',
    kind: 'checkup',
    title: '1か月健診',
    dueIso: isoFromBirthMonthOffset(1), // 生後1か月頃。
    isEstimate: true,
    dueNote: '生後1か月頃。',
    body: ['出生した産科／小児科で受けることが多い。'],
    source: '出典: 各自治体／医療機関',
  },
  {
    id: 'vaccination-start',
    kind: 'checkup',
    title: '予防接種スタート',
    dueIso: isoFromBirthMonthOffset(2), // 生後2か月から。
    isEstimate: true,
    dueNote: '生後2か月から。自治体から予診票が届く。',
    body: [
      'ロタ／B型肝炎／ヒブ／小児用肺炎球菌（PCV）／五種混合（DPT-IPV-Hib、2024年4月開始）を同時接種で開始。',
    ],
    source: '出典: 各自治体／医療機関',
  },
  {
    id: 'checkup-3-4m',
    kind: 'checkup',
    title: '3–4か月健診',
    dueIso: isoFromBirthMonthOffset(3), // 生後3–4か月頃。
    isEstimate: true,
    dueNote: '生後3–4か月頃。',
    body: ['自治体の集団健診として行われることが多い。'],
    source: '出典: 各自治体／医療機関',
  },
];

export const CHECKUP_DISCLAIMER = CHECKUP_CAPTION;

// ───────────────────────────────────────────────────────────
// セクション①: 「いま来るもの」用に、締切付き項目を横断集約する。
// ───────────────────────────────────────────────────────────

/** 行政手続き＋健診を締切が近い順（昇順）に並べて返す。 */
export function upcomingDueItems(now: Date = new Date()): (AdminProcedure | CheckupItem)[] {
  const all: (AdminProcedure | CheckupItem)[] = [...ADMIN_PROCEDURES, ...CHECKUP_ITEMS];
  return all.slice().sort((a, b) => daysUntil(a.dueIso, now) - daysUntil(b.dueIso, now));
}

// ───────────────────────────────────────────────────────────
// 追加セクションA: 父親としてのマインドセット（心構えの目安）
// 「医療判断ではなく一般的な心構えの目安」を明記する。
// ───────────────────────────────────────────────────────────

export interface FatherMindset {
  title: string;
  detail: string;
}

export const FATHER_MINDSET: FatherMindset[] = [
  {
    title: '「手伝う」ではなく主体的に担う',
    detail:
      '育児・家事は夫婦の共同プロジェクト。「手伝う」という立場ではなく、当事者として自分から動く。',
  },
  {
    title: '産後の妻の心身を理解する',
    detail:
      '出産後はホルモン変化と睡眠不足で心身が大きく揺れる時期（いわゆる「ガルガル期」も）。否定や指示ではなく、まず労い・休息・傾聴を大切に。',
  },
  {
    title: '完璧を求めない',
    detail: '赤ちゃんも親も「慣れ」で育つ。うまくいかなくて当たり前、失敗してよい。',
  },
  {
    title: '「名もなき家事・育児」を見える化して分担',
    detail:
      '在庫管理・段取り・予定把握といった、表に出にくい“メンタルロード”も半分持つ意識を。',
  },
  {
    title: '父親自身のケアも大切',
    detail:
      '父親も孤立や産後うつになり得る。睡眠と息抜きを確保し、つらいときは早めに相談を。',
  },
  {
    title: '夫婦の対話を毎日少しでも',
    detail: '体調や気持ちを共有し、感謝を言葉にする時間を毎日少しでも持つ。',
  },
  {
    title: '他人やSNSと比べない',
    detail: '発達には個人差があります。比較ではなく、目の前の子に集中する。',
  },
  {
    title: '早く深く関わるほど自信と愛着が育つ',
    detail: '抱っこ・声かけ・スキンシップを積極的に。関わるほど親としての自信と愛着が育つ。',
  },
];

export const FATHER_MINDSET_DISCLAIMER =
  'これは一般的な心構えの目安です。家庭ごとの状況に合わせて、無理のない形で取り入れてください。';

// ───────────────────────────────────────────────────────────
// 追加セクションB: 文京区独自の手続き・サービス
// 「内容・料金・対象は変わるため各窓口・区公式で確認」を徹底する。
// ───────────────────────────────────────────────────────────

export interface BunkyoService {
  title: string;
  detail: string;
  /** 問い合わせ・窓口（任意）。 */
  contact?: string;
  /** 公式URL（任意。新規タブで開く）。 */
  url?: string;
  /** 出典（公式機関名）。 */
  source: string;
}

export const BUNKYO_CAPTION =
  '文京区在住向け。内容・料金・対象は変わるため、各窓口・区公式でご確認ください。';

export const BUNKYO_SERVICES: BunkyoService[] = [
  {
    title: '出生届（文京区）',
    detail:
      '生まれた日を含めて14日以内。父母の住所地（文京区）で出すと、児童手当・子ども医療証・住民票の手続きを同時にできます。平日15時頃までの提出で同日処理。必要なものは届書＋出生証明書（医師／助産師記入）。2025年5月26日から名前の振り仮名も戸籍に記載されます。',
    contact: '窓口: 戸籍住民課',
    url: 'https://www.city.bunkyo.lg.jp/b013/p000251.html',
    source: '出典: 文京区',
  },
  {
    title: 'こども医療費助成（文京区）',
    detail:
      '0歳〜高校生年代（18歳到達後最初の3月31日）まで、都内の医療機関は自己負担なし。出生時は健康保険証が未発行でも「先に申請のみ」が可能で、後日保険情報を提出します。電子／郵送／窓口で申請できます。',
    url: 'https://www.city.bunkyo.lg.jp/b022/p001459/index.html',
    source: '出典: 文京区',
  },
  {
    title: '産後ケア事業（宿泊型ショートステイ／デイサービス型サロン）',
    detail:
      '宿泊型は生後2〜4か月未満が主流（約3,520〜7,200円/泊）、デイ型は生後2〜6か月（3,000円/日）。非課税・生活保護世帯は免除。mila-eでアカウント作成→クーポン申請（利用3営業日前まで）→施設へ予約、の流れです。',
    url: 'https://www.city.bunkyo.lg.jp/b029/p001557.html',
    source: '出典: 文京区',
  },
  {
    title: 'おうち家事・育児サポート事業',
    detail:
      '妊婦〜満3歳未満の世帯が対象。家事（炊事／洗濯／掃除／買い物）＋育児（おむつ／沐浴／授乳／同行／兄姉の養育）を支援。1時間1,000円（非課税世帯は半額）。妊娠期〜1歳未満は96時間分（初回40枚）。LoGoフォームで電子申請、約1週間で利用券が届きます。※多胎児世帯は別制度。',
    url: 'https://www.city.bunkyo.lg.jp/b022/p001690.html',
    source: '出典: 文京区',
  },
  {
    title: 'ベビーシッター利用料助成制度（文京区）',
    detail: 'ベビーシッター利用費の助成が受けられます。対象・上限など詳細は区公式でご確認ください。',
    source: '出典: 文京区',
  },
  {
    title: '訪問・相談（無料）',
    detail:
      'こんにちは赤ちゃん訪問（新生児訪問）、ネウボラ相談、助産師出張相談、母乳相談、新生児沐浴指導など、無料で受けられる訪問・相談があります。',
    url: 'https://www.city.bunkyo.lg.jp/b003/p007512.html',
    source: '出典: 文京区',
  },
  {
    title: '一時預かり・交流',
    detail:
      '緊急一時保育／リフレッシュ一時保育／病児・病後児保育、赤ちゃんとママのホッとサロン、ファミリーサポートセンター（社協運営）など、一時的な預かりや交流の場があります。',
    source: '出典: 文京区',
  },
];

// ───────────────────────────────────────────────────────────
// 追加セクションC: 知っておくべきこと・お得・特典
// 役所・公的（PERKS_PUBLIC）と民間・お得（PERKS_PRIVATE）に分ける。
// 「金額・対象・期限は制度改定や自治体で変わる。最新は各公式で確認」。
// ───────────────────────────────────────────────────────────

export const PERKS_CAPTION =
  '金額・対象・期限は制度改定や自治体で変わります。最新は各公式でご確認ください。';

export interface PerkPublic {
  title: string;
  detail: string;
  /** 公式URL（任意。新規タブで開く）。 */
  url?: string;
  /** 出典（公式機関名）。 */
  source: string;
}

export const PERKS_PUBLIC: PerkPublic[] = [
  {
    title: '妊婦のための支援給付金（旧 出産・子育て応援給付金）',
    detail:
      '妊娠時5万円分＋出産時（子1人につき）5万円分＝計10万円分。出産後分は出生届後の訪問面談時に申請します。',
    source: '出典: こども家庭庁／文京区',
  },
  {
    title: '東京都 赤ちゃんファースト（出産・子育て応援事業）',
    detail:
      '子1人あたり10万円相当の育児用品・子育てサービス（おむつ／粉ミルク／ベビーカー／抱っこひも／家事・ベビーシッター等を専用サイトで選択）。出生日時点で都内在住・2025年4月1日以降の出生が対象。妊産婦・新生児訪問時に申請書を記入→簡易書留で受取。※上の国の給付金分を含む整理。コールセンター0120-001-047。',
    url: 'https://www.fukushi.metro.tokyo.lg.jp/kodomo/shussan/tokyo_shussankosodateouen',
    source: '出典: 東京都福祉局',
  },
  {
    title: '東京都 018サポート',
    detail:
      '0〜18歳に月5,000円（年6万円）。新生児も対象で、出生後に申請します。赤ちゃんファーストと同時申請可。コールセンター0120-056-018。',
    url: 'https://018support.metro.tokyo.lg.jp/',
    source: '出典: 東京都',
  },
  {
    title: '児童手当',
    detail:
      '0歳〜高校生年代。2024年10月に拡充（所得制限なし）。「15日特例」で出生月分から支給されます。',
    source: '出典: こども家庭庁／市区町村',
  },
  {
    title: '出産育児一時金',
    detail:
      '1児につき50万円（産科医療補償制度の対象機関。対象外は48.8万円）。',
    source: '出典: 厚生労働省／各保険者',
  },
  {
    title: '高額療養費・医療費控除',
    detail:
      '出産や通院の自己負担が高額なときの払い戻し（高額療養費）／確定申告での医療費控除が利用できます。',
    source: '出典: 各保険者／国税庁',
  },
  {
    title: '育児休業給付金・産後パパ育休',
    detail:
      '雇用保険から支給。父親も取得できます（出生時育児休業＝産後パパ育休）。手取りを下支えする給付の拡充もあります。',
    source: '出典: 厚生労働省／ハローワーク',
  },
  {
    title: '子育て応援とうきょうパスポート',
    detail: '協賛店で割引や、授乳／ミルク用お湯などの特典が受けられます。',
    source: '出典: 東京都',
  },
];

export interface PerkPrivate {
  title: string;
  detail: string;
  /** 公式URL（任意。新規タブで開く）。 */
  url?: string;
}

export const PERKS_PRIVATE: PerkPrivate[] = [
  {
    title: 'Amazonらくらくベビー（旧ベビーレジストリ）',
    detail:
      '出産準備お試しBox（おむつ／ミルク／おしりふき等のサンプル）、対象商品の割引（プライム会員は登録で割引枠アップ）。',
    url: 'https://www.amazon.co.jp/baby-reg/',
  },
  {
    title: '楽天ママ割',
    detail: 'サンプルボックス（抽選）やポイント特典が受けられます。',
    url: 'https://event.rakuten.co.jp/family/',
  },
  {
    title: 'メーカーのプレママ／育児サンプル・クーポン',
    detail: '粉ミルク・紙おむつ・ケア用品メーカー等が、サンプルやクーポンを提供しています。',
  },
  {
    title: 'ベビー用品のレンタル／お下がり／フリマ活用',
    detail:
      'ベビーカー・チャイルドシート等は短期間しか使わないことも多く、レンタルやお下がり・フリマの活用で割安にできます。',
  },
  {
    title: '育児記録・写真共有アプリ',
    detail: '家族と成長を共有できる、育児記録・写真共有アプリが便利です。',
  },
];
