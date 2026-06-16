// 乳児の体重 標準パーセンタイル帯（母子手帳ふう）のデータと算出ユーティリティ。
//
// 出典: 厚生労働省「平成22年（2010年）乳幼児身体発育調査」
//   表１「一般調査及び病院調査による体重の身体発育値（3,10,25,50,75,90,97
//   パーセンタイル値）年・月・日齢別、性別」より「男子・体重」を採録。
//   一次資料（e-Stat 公開 Excel）:
//     https://www.e-stat.go.jp/stat-search/file-download?statInfId=000012673573&fileKind=0
//   調査の概況（厚生労働省）:
//     https://www.mhlw.go.jp/stf/houdou/0000042861.html
//
// 採録方針（母子手帳の発育曲線にならう）:
//   月齢 N（満 N か月 = N か月を満了した時点）の値として、原表の区分を次のように割り当てる。
//     月齢 0  = 「出生時」
//     月齢 1  = 「0年1～2月未満」
//     月齢 2  = 「2～3」… 月齢 11 = 「11～12」
//     月齢 12 = 「1年0～1月未満」
//   （原表には「30日」の行もあるが、曲線は満月齢区分で読むのが母子手帳の慣例のため
//     ここでは満月齢区分を採用する。）
//
// 注意: 本ページは BABY_SEX='male' 前提のため、男子のみを収録する。
//   医療判断ではなく成長の目安です。

export interface WeightPercentilePoint {
  /** 月齢（満。0〜12）。横軸の位置に使う。 */
  month: number;
  /** 3 パーセンタイル体重（kg）＝帯の下限。 */
  p3: number;
  /** 50 パーセンタイル体重（kg）＝中央値（参考線）。 */
  p50: number;
  /** 97 パーセンタイル体重（kg）＝帯の上限。 */
  p97: number;
}

/**
 * 男子・体重の月齢別パーセンタイル値（厚生労働省 平成22年 乳幼児身体発育調査）。
 * p3 と p97 の間が「標準範囲（3〜97パーセンタイル）」の帯になる。
 */
export const MALE_WEIGHT_PERCENTILES: WeightPercentilePoint[] = [
  { month: 0, p3: 2.1, p50: 3.0, p97: 3.76 }, // 出生時
  { month: 1, p3: 3.53, p50: 4.79, p97: 5.96 }, // 0年1～2月未満
  { month: 2, p3: 4.41, p50: 5.84, p97: 7.18 }, // 2～3
  { month: 3, p3: 5.12, p50: 6.63, p97: 8.07 }, // 3～4
  { month: 4, p3: 5.67, p50: 7.22, p97: 8.72 }, // 4～5
  { month: 5, p3: 6.1, p50: 7.66, p97: 9.2 }, // 5～6
  { month: 6, p3: 6.44, p50: 8.0, p97: 9.57 }, // 6～7
  { month: 7, p3: 6.73, p50: 8.27, p97: 9.87 }, // 7～8
  { month: 8, p3: 6.96, p50: 8.5, p97: 10.14 }, // 8～9
  { month: 9, p3: 7.16, p50: 8.7, p97: 10.37 }, // 9～10
  { month: 10, p3: 7.34, p50: 8.88, p97: 10.59 }, // 10～11
  { month: 11, p3: 7.51, p50: 9.06, p97: 10.82 }, // 11～12
  { month: 12, p3: 7.68, p50: 9.24, p97: 11.04 }, // 1年0～1月未満
];

/** グラフの横軸レンジ（月齢）。 */
export const WEIGHT_CHART_MIN_MONTH = 0;
export const WEIGHT_CHART_MAX_MONTH = 12;

// ───────────────────────────────────────────────────────────
// 週齢↔月齢の換算と、週位置でのパーセンタイル線形補間。
// パーセンタイル定数は月齢0〜12（整数月）でしか無いため、週表示では
// 「週→月齢 = 週 / WEEKS_PER_MONTH」で月齢に直し、隣接する整数月の値を
// 線形補間して帯・中央値を滑らかに描く。
// ───────────────────────────────────────────────────────────

/** 1か月あたりの平均週数（グレゴリオ暦: 365.25 / 12 / 7 ≒ 4.348）。 */
export const WEEKS_PER_MONTH = 365.25 / 12 / 7;

/** 月齢0〜12 を週齢に直した、横軸の上限（≒52.18週）。週表示の軸クランプに使う。 */
export const WEIGHT_CHART_MAX_WEEK = WEIGHT_CHART_MAX_MONTH * WEEKS_PER_MONTH;

/** 週表示のデフォルト横軸上限（新生児期を見やすく。≒最初の3か月）。 */
export const WEIGHT_CHART_DEFAULT_MAX_WEEK = 13;

/**
 * 指定した「小数月齢」におけるパーセンタイル値（kg）を、隣接する整数月の
 * 値から線形補間して返す。範囲外は端の値でクランプする。
 */
export function weightPercentileAtMonth(
  month: number,
  key: 'p3' | 'p50' | 'p97',
): number {
  const pts = MALE_WEIGHT_PERCENTILES;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (month <= first.month) return first[key];
  if (month >= last.month) return last[key];
  // month を挟む2点を探して線形補間する（month は整数刻み 0..12）。
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (month >= a.month && month <= b.month) {
      const t = (month - a.month) / (b.month - a.month);
      return a[key] + (b[key] - a[key]) * t;
    }
  }
  return last[key];
}

/** 週齢→（補間用の）小数月齢。 */
export function monthFromWeek(week: number): number {
  return week / WEEKS_PER_MONTH;
}

/** 指定した週齢におけるパーセンタイル値（kg）。週→月齢換算後に線形補間する。 */
export function weightPercentileAtWeek(
  week: number,
  key: 'p3' | 'p50' | 'p97',
): number {
  return weightPercentileAtMonth(monthFromWeek(week), key);
}

/** 出典の短い注記（凡例・キャプションで使う）。 */
export const WEIGHT_STANDARD_SOURCE_LABEL =
  '標準範囲（3〜97パーセンタイル・厚生労働省 平成22年 男子）';
export const WEIGHT_STANDARD_SOURCE_URL =
  'https://www.mhlw.go.jp/stf/houdou/0000042861.html';
