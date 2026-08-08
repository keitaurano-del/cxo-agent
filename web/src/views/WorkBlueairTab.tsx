// 仕事ページ「Blueairレンタル」タブ（MC-370, 2026-08-08 Keita「アポロ＞仕事の独立タブにまとめておいて」）。
// Blueair Classic Pro 特化レンタル事業（目標月商10万円・極力自動化）の需要分析・
// モックアップ・売上プランの静的サマリ。正本は docs/tasks/MC-370.md。
// 数値・方針を更新したら個票と本タブの両方を揃えること。

const SECTION = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800';
const H3 = 'mb-3 text-sm font-bold text-slate-800 dark:text-slate-100';
const TH = 'border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400';
const TD = 'border-b border-slate-100 px-3 py-2 text-slate-700 dark:border-slate-700 dark:text-slate-200';

export function WorkBlueairTab() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-8 text-[13.5px] leading-relaxed">
      {/* ヘッダー */}
      <div className={SECTION}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700 dark:bg-sky-900 dark:text-sky-200">MC-370</span>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Blueair Classic Pro 特化レンタル事業</h2>
        </div>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          目標: <b>月商10万円</b> ／ 方針: 極力自動化（Stripe自動決済・返却は集荷方式・人手は発送/検品のみ）。
          2026-08-08 起票、需要分析〜プラン v1 まで作成済み。
        </p>
        <a
          href="/blueair-rental-mockup.html"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block rounded-full bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500"
        >
          LPモックアップを開く（仮称 AERENT）→
        </a>
      </div>

      {/* 需要分析 */}
      <div className={SECTION}>
        <h3 className={H3}>需要分析 — 結論: 空白地帯</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
          <li><b>Classic Proクラス（56畳・10万円級）のレンタルは大手に無い</b>。RentioのBlueair枠は中〜小型のみ。kikito・DMMいろいろレンタルは撤退済みで競合減少中。</li>
          <li>「ブルーエア レンタル」の<b>指名検索で勝てる隙間</b>がある（比較記事多数＝検索需要は立証済み）。</li>
          <li>需要は<b>二峰性</b>: 2〜4月（花粉・黄砂）と11〜12月（乾燥・ウイルス）。8月が底。花粉症有病率42.5%。</li>
          <li>セグメント: ①重症花粉症（3-6千円/月・短期） ②出産家庭 ③ペット多頭飼い（購入転換しやすい） ④<b>法人小口</b>（クリニック/保育園/店舗・通年契約で夏の底荷に）。</li>
          <li>相場: 高級機レンタルは<b>本体価格の5〜9%/月</b>（Rentio Protect 7410i = 8,600円/月が参照点）。</li>
        </ul>
      </div>

      {/* 料金プラン */}
      <div className={SECTION}>
        <h3 className={H3}>料金プラン v1（すべて送料・フィルター交換込み）</h3>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr><th className={TH}>プラン</th><th className={TH}>月額(税込)</th><th className={TH}>最低期間</th><th className={TH}>狙い</th></tr></thead>
          <tbody>
            <tr><td className={TD}>シーズン</td><td className={TD}>8,980円</td><td className={TD}>3ヶ月</td><td className={TD}>花粉期の短期・高回転</td></tr>
            <tr><td className={TD}><b>スタンダード</b></td><td className={TD}><b>7,980円</b></td><td className={TD}>6ヶ月</td><td className={TD}>主力。12ヶ月継続で買取充当</td></tr>
            <tr><td className={TD}>法人・通年</td><td className={TD}>9,800円</td><td className={TD}>12ヶ月</td><td className={TD}>請求書払い・2台目10%OFF・夏の底荷</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">月商10万円 = 稼働13台（7,980円 × 13 = 103,740円）</p>
      </div>

      {/* ロードマップ */}
      <div className={SECTION}>
        <h3 className={H3}>売上10万円までのロードマップ</h3>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr><th className={TH}>Phase</th><th className={TH}>時期</th><th className={TH}>内容</th><th className={TH}>投資</th></tr></thead>
          <tbody>
            <tr><td className={TD}>0 検証</td><td className={TD}>8月</td><td className={TD}>中古美品2台＋LP公開（Stripe Payment Links）＋アリススタイル併載</td><td className={TD}>約15万円</td></tr>
            <tr><td className={TD}>1</td><td className={TD}>9-11月</td><td className={TD}>指名SEO＋広告完全一致のみ月5千円・法人3件直接提案 → 3-4台稼働</td><td className={TD}>広告費のみ</td></tr>
            <tr><td className={TD}>2</td><td className={TD}>12-1月</td><td className={TD}>6-8台へ増台・花粉予約開始</td><td className={TD}>追加20-30万円</td></tr>
            <tr><td className={TD}>3</td><td className={TD}>2-4月</td><td className={TD}><b>13台稼働で月商10万円達成</b>（法人4-5台を底荷に）</td><td className={TD}>—</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">粗利見込み 月6-7万円 ／ 投資回収 10-14ヶ月（13台体制・投資60-90万円/中古中心）</p>
      </div>

      {/* コスト・自動化 */}
      <div className={SECTION}>
        <h3 className={H3}>コスト構造と自動化スタック</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
          <li>本体: 定価108,900円／実売最安 約7万円／中古相場 約4.3万円。フィルター月割 約2千円。往復送料 5-7千円 → <b>最低3ヶ月縛り必須</b>。</li>
          <li>決済/契約: Stripe Payment Links（サブスク自動更新・解約セルフ）＋クリックラップ規約＋Stripe Identity 本人確認（300円/件）。</li>
          <li>物流: 往路=宅急便（B2クラウド半自動）、復路=純正箱＋着払い伝票「集荷を呼ぶだけ」。動産保険を月額に内包・過失破損の客負担上限2万円。</li>
          <li>法規: 新品仕入れ→レンタルは許認可不要。<b>中古仕入れは古物商許可が必要</b>（約1.9万円）。メルカリでのレンタル出品は規約違反のため不可。</li>
        </ul>
      </div>

      {/* 判断待ち */}
      <div className={`${SECTION} border-amber-300 dark:border-amber-600`}>
        <h3 className={H3}>⏳ Keita 判断待ち（3点）</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
          <li>GO/NO-GO と Phase 0 の投資承認（約15万円）</li>
          <li>仕入れ方針: 中古（要・古物商許可）か新品1台先行（許可不要・即開始可）か</li>
          <li>屋号・ドメイン（AERENT は仮称）</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">GO なら Stripe 設定と本番LP化に着手します。詳細正本: docs/tasks/MC-370.md</p>
      </div>
    </div>
  );
}
