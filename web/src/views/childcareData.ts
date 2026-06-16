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

/**
 * BIRTH_DATE からの「小数月齢」を返す（成長グラフの横軸位置に使う）。
 * 1か月をその月の実日数で割って加算するため、満月齢に小数で連続的に対応する。
 * 例: 誕生日当日 = 0、誕生日からちょうど1か月後 = 1.0、その中間 = 0.5 付近。
 */
export function ageMonthsDecimal(iso: string): number {
  const birth = parseIsoDate(BIRTH_DATE);
  const target = parseIsoDate(iso);
  if (target.getTime() <= birth.getTime()) return 0;
  // 満月齢（応当日で繰り上がる整数月）を求める。
  let whole =
    (target.getFullYear() - birth.getFullYear()) * 12 +
    (target.getMonth() - birth.getMonth());
  if (target.getDate() < birth.getDate()) whole -= 1;
  if (whole < 0) whole = 0;
  // 直近の応当日（満 whole か月の日）から target までを、その月の長さで割って小数部に。
  const anchor = parseIsoDate(BIRTH_DATE);
  anchor.setMonth(anchor.getMonth() + whole);
  const nextAnchor = parseIsoDate(BIRTH_DATE);
  nextAnchor.setMonth(nextAnchor.getMonth() + whole + 1);
  const spanDays = (nextAnchor.getTime() - anchor.getTime()) / MS_PER_DAY;
  const intoDays = (target.getTime() - anchor.getTime()) / MS_PER_DAY;
  const frac = spanDays > 0 ? Math.min(1, Math.max(0, intoDays / spanDays)) : 0;
  return whole + frac;
}

/**
 * BIRTH_DATE からの「小数週齢」を返す（成長グラフの週表示の横軸位置に使う）。
 * 週齢 = 出生からの経過日数 / 7（出生当日 = 0週）。ハードコードせず日付差から算出する。
 * 例: 誕生日当日 = 0、誕生日から7日後 = 1.0、3.5日後 = 0.5。
 */
export function ageWeeksDecimal(iso: string): number {
  const birth = parseIsoDate(BIRTH_DATE);
  const target = parseIsoDate(iso);
  const elapsedMs = target.getTime() - birth.getTime();
  if (elapsedMs <= 0) return 0;
  return elapsedMs / MS_PER_DAY / 7;
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
// セクション（新）: 次の節目までの進捗（NextMilestoneSection）
// 誕生日からの生後日数を使い、次の主要マイルストーンまでの残日数と
// プログレス（%）を算出する。日付・節目はハードコードせず BIRTH_DATE 起点。
// ───────────────────────────────────────────────────────────

export interface Milestone {
  /** 表示名。 */
  label: string;
  /** 生後日数（目安）。daysSinceBirth と同じ「誕生日=1日目」換算。 */
  dayOffset: number;
}

/** 主要マイルストーンの目安（生後日数）。算出値の注記は UI 側で行う。 */
export const MILESTONES: Milestone[] = [
  { label: '1か月健診', dayOffset: 30 },
  { label: '予防接種スタート', dayOffset: 60 },
  { label: '3–4か月健診', dayOffset: 100 },
];

export interface NextMilestoneProgress {
  /** 直近の未到達マイルストーン（すべて到達済みなら null）。 */
  next: Milestone | null;
  /** 直前（基準）のマイルストーン day（無ければ 0＝誕生）。 */
  fromDay: number;
  /** 現在の生後日数。 */
  currentDay: number;
  /** 次の節目までの残日数（到達済みは 0）。 */
  daysLeft: number;
  /** fromDay→next.dayOffset 間の進捗（0–100）。next が null なら 100。 */
  percent: number;
}

/**
 * 次の主要マイルストーンまでの残日数・進捗を算出する。
 * 「まだ来ていない直近」のマイルストーンを次の目標とし、
 * その一つ前の節目（無ければ誕生）からの進捗を % で返す。
 */
export function nextMilestoneProgress(now: Date = new Date()): NextMilestoneProgress {
  const currentDay = daysSinceBirth(now);
  const sorted = MILESTONES.slice().sort((a, b) => a.dayOffset - b.dayOffset);
  const nextIdx = sorted.findIndex((m) => currentDay < m.dayOffset);
  if (nextIdx === -1) {
    // すべて到達済み。
    return {
      next: null,
      fromDay: sorted.length ? sorted[sorted.length - 1].dayOffset : 0,
      currentDay,
      daysLeft: 0,
      percent: 100,
    };
  }
  const next = sorted[nextIdx];
  const fromDay = nextIdx > 0 ? sorted[nextIdx - 1].dayOffset : 0;
  const span = Math.max(1, next.dayOffset - fromDay);
  const done = Math.min(span, Math.max(0, currentDay - fromDay));
  const percent = Math.round((done / span) * 100);
  const daysLeft = Math.max(0, next.dayOffset - currentDay);
  return { next, fromDay, currentDay, daysLeft, percent };
}

// ───────────────────────────────────────────────────────────
// セクション（新）: お世話の基本（CARE_BASICS）
// 一般的な目安。医療判断ではない旨を UI 側で注記する。
// ───────────────────────────────────────────────────────────

export interface CareBasic {
  emoji: string;
  title: string;
  detail: string;
  /** YouTube 11文字ID（あれば詳細モーダルで埋め込み再生）。 */
  videoId?: string;
  /** 動画（または解説ページ）のタイトル。 */
  videoTitle?: string;
  /** 発信元（チャンネル名・機関名）。 */
  source?: string;
  /** 発信元の種別（例: メーカー公式 / 病院 / 公的機関）。 */
  sourceType?: string;
  /** 外部リンク。videoId が無い項目は「解説ページを開く」に使う。 */
  watchUrl?: string;
  /** 内容確認上の注意（任意・表示は控えめ）。 */
  caveat?: string;
}

export const CARE_BASICS: CareBasic[] = [
  {
    emoji: '🍼',
    title: '授乳・調乳',
    detail:
      '母乳は欲しがるだけ。粉ミルクは一度70℃以上のお湯で溶かし、流水等で人肌（約40℃）まで冷ましてから。飲み残しは破棄。授乳後はげっぷを。',
    videoId: 'Cv599TddA1s',
    videoTitle: '育児用ミルクの作り方',
    source: '森永乳業 公式チャンネル',
    sourceType: 'メーカー公式',
    watchUrl: 'https://www.youtube.com/watch?v=Cv599TddA1s',
  },
  {
    emoji: '🛁',
    title: '沐浴',
    detail:
      '1日1回が目安。湯温38〜40℃、5分程度。へその緒が乾くまでは特に清潔に。',
    videoId: 'EL-dgK8PxlI',
    videoTitle: '沐浴の仕方（赤ちゃんの沐浴と保湿）',
    source: '一宮西病院 産科',
    sourceType: '病院',
    watchUrl: 'https://www.youtube.com/watch?v=EL-dgK8PxlI',
  },
  {
    emoji: '🧷',
    title: 'おむつ替え',
    detail: '排尿・排便のたびに。やさしく拭いてかぶれ予防。',
    videoId: 'hY0QmLqGzBE',
    videoTitle: 'おむつ替えの手順（テープタイプ：基礎編）',
    source: 'パンパース公式（P&G）',
    sourceType: 'メーカー公式',
    watchUrl: 'https://www.youtube.com/watch?v=hY0QmLqGzBE',
  },
  {
    emoji: '😴',
    title: '寝かせ方',
    detail:
      'あおむけ・硬めのマット・軽い掛け物。授乳→げっぷ→寝かしつけのリズム。',
    videoTitle: 'SIDS 発症リスクをおさえるためにできること',
    source: '政府広報オンライン（こども家庭庁）',
    sourceType: '公的機関',
    watchUrl: 'https://www.gov-online.go.jp/cfa/202502/video-293754.html',
  },
  {
    emoji: '🌡️',
    title: '体温・室温',
    detail: '暖めすぎ・厚着に注意。室温は大人が快適な程度に。',
    videoId: '3WCHrasc1-g',
    videoTitle: '赤ちゃんの正しい熱の測り方（院長監修）',
    source: '葛飾赤十字産院',
    sourceType: '病院',
    watchUrl: 'https://www.youtube.com/watch?v=3WCHrasc1-g',
  },
];

export const CARE_BASICS_CAPTION = '一般的な目安です。';

// ───────────────────────────────────────────────────────────
// セクション（新）: 新生児の1日のリズムの目安（DAILY_RHYTHM）
// 横バー/アイコン付きで視覚化する想定。
// ───────────────────────────────────────────────────────────

export interface DailyRhythmItem {
  icon: string;
  label: string;
  value: string;
}

export const DAILY_RHYTHM: DailyRhythmItem[] = [
  { icon: '🍼', label: '授乳', value: '2〜3時間ごと（1日8〜12回）' },
  { icon: '😴', label: '睡眠', value: '1日合計16〜18時間（昼夜問わずこま切れ）' },
  { icon: '🧷', label: 'おむつ', value: '1日10回前後' },
];

export const DAILY_RHYTHM_CAPTION = '昼夜の区別はまだ。少しずつ整います。';

// ───────────────────────────────────────────────────────────
// セクション（新）: 夜泣き・ぐずり対応（NIGHT_CRYING）
// ───────────────────────────────────────────────────────────

export interface NightCryingItem {
  title: string;
  detail: string;
}

export const NIGHT_CRYING: NightCryingItem[] = [
  {
    title: '黄昏泣き（コリック）',
    detail:
      '夕方〜夜に理由なく泣くことがある。生後数週〜3・4か月で落ち着くことが多い。',
  },
  {
    title: '順に試す',
    detail:
      'おむつ→授乳→抱っこ（縦抱き）→室温・服→おくるみ→環境音（ホワイトノイズ）→外気・散歩。',
  },
  {
    title: '親のケア',
    detail:
      'どうしても泣き止まず限界のときは、安全な場所に寝かせて少し離れ深呼吸を。絶対に揺さぶらない（揺さぶられっ子症候群）。',
  },
  {
    title: 'つらいときは相談を',
    detail: 'つらいときは #8000 や自治体の相談窓口へ。',
  },
];

// ───────────────────────────────────────────────────────────
// セクション（新）: 受診の目安・困ったとき（WHEN_TO_SEE_DOCTOR）＋緊急電話
// 「一般的な目安。最終判断は医療機関へ」を徹底する。
// ───────────────────────────────────────────────────────────

export interface WhenToSeeDoctorItem {
  title: string;
  detail: string;
}

export const WHEN_TO_SEE_DOCTOR: WhenToSeeDoctorItem[] = [
  {
    title: '生後3か月未満は要注意',
    detail:
      '37.5℃以上は機嫌がよくてもかかりつけに相談、38℃以上はすぐ受診。',
  },
  {
    title: 'すぐ受診・救急',
    detail:
      'ぐったり／授乳が極端に減る／繰り返す嘔吐／けいれん／呼吸が苦しそう／顔色が悪い／反応が鈍い。',
  },
  {
    title: '迷ったら電話相談',
    detail:
      '小児救急電話相談 #8000、救急相談センター #7119。',
  },
];

export interface EmergencyPhone {
  label: string;
  number: string;
  /** tel: リンク用（記号は除いた数字）。 */
  tel: string;
}

export const EMERGENCY_PHONES: EmergencyPhone[] = [
  { label: '小児救急電話相談', number: '#8000', tel: '#8000' },
  { label: '救急相談センター', number: '#7119', tel: '#7119' },
];

export const WHEN_TO_SEE_DOCTOR_SOURCE = '出典: 厚生労働省／自治体・#8000';
export const WHEN_TO_SEE_DOCTOR_CAPTION =
  '一般的な目安です。最終判断は医療機関へ。';

// ───────────────────────────────────────────────────────────
// セクション（新）: 乳幼児突然死症候群（SIDS）予防（SIDS_PREVENTION）
// 厚労省3か条。出典: 政府広報オンライン。
// ───────────────────────────────────────────────────────────

export interface SidsItem {
  title: string;
  detail: string;
}

export const SIDS_PREVENTION: SidsItem[] = [
  {
    title: '1歳まではあおむけ寝',
    detail:
      '硬めのマット・軽い掛け布団。暖めすぎ・厚着に注意。',
  },
  {
    title: '周囲でたばこを吸わない',
    detail: '妊娠中・赤ちゃんの周囲では喫煙しない。',
  },
  {
    title: 'できるだけ母乳で育てる',
    detail: '可能な範囲で母乳育児を。',
  },
];

export const SIDS_SOURCE = '出典: 政府広報オンライン（厚生労働省）';
export const SIDS_URL =
  'https://www.gov-online.go.jp/article/201710/entry-8129.html';

// ───────────────────────────────────────────────────────────
// セクション（新）: 予防接種スケジュール（VACCINE_SCHEDULE）
// 月齢→ワクチン配列。標準的なスケジュール。出典: 厚生労働省。
// 健診の締切（CHECKUP_ITEMS）とは役割が異なる（ワクチン一覧）。
// ───────────────────────────────────────────────────────────

export interface VaccineMonth {
  /** 表示ラベル（例: '2か月'）。 */
  label: string;
  /** ハイライト判定用の月齢下限（含む）。 */
  fromMonth: number;
  /** ハイライト判定用の月齢上限（含まない）。最後は null。 */
  toMonth: number | null;
  /** この月齢で受けるワクチン（チップ表示）。 */
  vaccines: string[];
}

export const VACCINE_SCHEDULE: VaccineMonth[] = [
  {
    label: '2か月',
    fromMonth: 2,
    toMonth: 3,
    vaccines: ['ロタ①', 'B型肝炎①', '小児用肺炎球菌①', '五種混合①'],
  },
  {
    label: '3か月',
    fromMonth: 3,
    toMonth: 4,
    vaccines: ['ロタ②', 'B型肝炎②', '小児用肺炎球菌②', '五種混合②'],
  },
  {
    label: '4か月',
    fromMonth: 4,
    toMonth: 5,
    vaccines: ['ロタ③（ロタテックのみ）', '小児用肺炎球菌③', '五種混合③'],
  },
  {
    label: '5〜8か月',
    fromMonth: 5,
    toMonth: 9,
    vaccines: ['BCG', 'B型肝炎③（7〜8か月）'],
  },
  {
    label: '1歳',
    fromMonth: 12,
    toMonth: null,
    vaccines: [
      'MR（麻しん風しん）①',
      '水痘①',
      'おたふくかぜ',
      '小児用肺炎球菌④',
      '五種混合④（追加）',
    ],
  },
];

export const VACCINE_SCHEDULE_CAPTION =
  'ロタは初回を生後14週6日までに開始。同時接種が標準。スケジュールは自治体・かかりつけ医で確認を。';
export const VACCINE_SCHEDULE_SOURCE = '出典: 厚生労働省';
export const VACCINE_SCHEDULE_URL =
  'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/kekkaku-kansenshou/yobou-sesshu/vaccine/months-2.html';

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
