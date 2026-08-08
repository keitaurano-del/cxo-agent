// 仕事ページ「Blueairレンタル」タブ（MC-370, 2026-08-08 Keita「アポロ＞仕事の独立タブにまとめておいて」）。
// Blueair Classic Pro レンタル事業（サービス名 AirRent・目標月商10万円・極力自動化）の
// 需要分析・モックアップ・売上プランの静的サマリ。正本は docs/tasks/MC-370.md。
// v2（8/8 Keitaフィードバック反映）: 法人プラン撤去・「特化/専門」表現撤去・AirRent命名・
// 在庫リスク（夏の遊休）を織り込んだ価格再設計と事業継続性の試算を追加。
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
          <h2 className="text-base font-bold text-slate-900 dark:text-white">AirRent — Blueair Classic Pro レンタル事業</h2>
        </div>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          目標: <b>月商10万円</b> ／ 方針: 極力自動化（Stripe自動決済・返却は集荷方式・人手は発送/検品のみ）。
          個人向けのみ（法人契約は当面なし・2026-08-08 Keita）。
        </p>
        <a
          href="/blueair-rental-mockup.html"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block rounded-full bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500"
        >
          LPモックアップを開く（v2）→
        </a>
      </div>

      {/* 需要分析 */}
      <div className={SECTION}>
        <h3 className={H3}>需要分析 — 結論: 空白地帯</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
          <li><b>Classic Proクラス（56畳・10万円級）のレンタルは大手に無い</b>。RentioのBlueair枠は中〜小型のみ。kikito・DMMいろいろレンタルは撤退済みで競合減少中。</li>
          <li>「ブルーエア レンタル」の<b>指名検索で勝てる隙間</b>がある（比較記事多数＝検索需要は立証済み）。</li>
          <li>需要は<b>二峰性</b>: 2〜4月（花粉・黄砂）と11〜12月（乾燥・ウイルス）。8月が底。花粉症有病率42.5%。</li>
          <li>セグメント: ①重症花粉症（短期・高単価許容） ②出産家庭（〜1歳） ③ペット多頭飼い（長期化・譲渡転換しやすい）。</li>
          <li>相場: 高級機レンタルは<b>本体価格の5〜9%/月</b>（Rentio Protect 7410i = 8,600円/月が参照点）。</li>
        </ul>
      </div>

      {/* 料金プラン v2 */}
      <div className={SECTION}>
        <h3 className={H3}>料金プラン v2（すべて送料・フィルター交換込み／個人のみ）</h3>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr><th className={TH}>プラン</th><th className={TH}>料金(税込)</th><th className={TH}>期間</th><th className={TH}>狙い</th></tr></thead>
          <tbody>
            <tr><td className={TD}>お試し</td><td className={TD}>1週間 9,980円<br />2週間 13,980円</td><td className={TD}>1週間〜（延長 +3,500円/週）</td><td className={TD}>体感→月額転換の導線。転換時はお試し料金を全額充当</td></tr>
            <tr><td className={TD}>シーズン</td><td className={TD}>9,980円/月</td><td className={TD}>3ヶ月〜</td><td className={TD}>花粉期の短期。夏の遊休月を織り込んだ単価</td></tr>
            <tr><td className={TD}><b>スタンダード</b></td><td className={TD}><b>7,980円/月</b></td><td className={TD}>6ヶ月〜</td><td className={TD}>主力。いつでも買取可（新品定価108,900円基準・既払レンタル料は全額充当）</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          月商10万円 = 12台稼働（シーズン5台 49,900円 ＋ スタンダード7台 55,860円 = 105,760円）＋お試しは上乗せ
        </p>
      </div>

      {/* 収支試算（8/8 Keita「送料・経費・リスクを加味して利益を計算して」） */}
      <div className={SECTION}>
        <h3 className={H3}>収支試算 — 送料・経費・リスク引当込み</h3>
        <p className="mb-2 text-slate-700 dark:text-slate-200">
          <b>前提経費</b>: 往復送料 6,500円/回転（CP7i=箱込み160サイズ・関東内 片道約2,500〜2,900円、遠方も含む平均で往路元払い＋復路着払いの往復を6,500円と保守的に設定）＋梱包材500円＋整備・除菌500円＋本人確認300円 = <b>回転あたり固定 7,800円</b>。
          貸出中は フィルター月割2,000円＋動産保険300円 = <b>2,300円/月</b>。売上に対し 決済3.6%＋<b>リスク引当5%</b>（破損・盗難・回収不能・想定外送料）。
        </p>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr><th className={TH}>プラン</th><th className={TH}>売上/回転</th><th className={TH}>経費計</th><th className={TH}>利益/回転</th><th className={TH}>利益率</th></tr></thead>
          <tbody>
            <tr><td className={TD}>お試し1週間</td><td className={TD}>9,980円</td><td className={TD}>約9,200円</td><td className={TD}>約800円</td><td className={TD}>8%（ほぼ導線扱い）</td></tr>
            <tr><td className={TD}>お試し2週間</td><td className={TD}>13,980円</td><td className={TD}>約10,000円</td><td className={TD}>約4,000円</td><td className={TD}>28%</td></tr>
            <tr><td className={TD}>シーズン3ヶ月</td><td className={TD}>29,940円</td><td className={TD}>約17,300円</td><td className={TD}>約12,700円</td><td className={TD}>42%</td></tr>
            <tr><td className={TD}>スタンダード6ヶ月</td><td className={TD}>47,880円</td><td className={TD}>約25,700円</td><td className={TD}>約22,200円</td><td className={TD}>46%（月あたり約3,700円）</td></tr>
          </tbody>
        </table>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
          <li><b>送料が固定で7,800円/回転かかるため、1週間プラン単体はほぼ利益ゼロ</b>。「効果体感→月額転換（お試し料金全額充当）」の獲得チャネルと割り切り、お試しの主推しは2週間にする。</li>
          <li><b>月商10万円達成時の月次利益 ≒ 約4.7万円</b>（シーズン5台 21,200円＋スタンダード7台 25,900円・リスク引当後）。</li>
          <li>年間ベース（繁忙期4ヶ月フル稼働＋他8ヶ月はスタンダード中心 月2万円前後）で<b>年間利益 約30-40万円</b>。投資50-70万円（中古中心）→ <b>回収 約1.5〜2年</b>（リスク引当込みの保守見積り）。</li>
          <li>利益を厚くするレバー: ①買取成立（1件 約3.5万円）②近隣手渡しオプションで送料圧縮 ③フィルター交換周期の実運用最適化（利用9ヶ月未満なら次客に継続使用）。</li>
        </ul>
      </div>

      {/* 在庫リスクと事業継続性（v2で追加） */}
      <div className={SECTION}>
        <h3 className={H3}>在庫リスクと事業継続性（v2 価格の根拠）</h3>
        <p className="mb-2 text-slate-700 dark:text-slate-200">
          v1 は法人通年契約を夏の底荷にする前提だったため、法人なしでは<b>シーズン単価が遊休リスクを賄えない</b>。v2 で以下のとおり織り込み直した。
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
          <li><b>シーズン機の稼働前提 = 年2回転・約6ヶ月（稼働率50%）</b>。1回転の限界利益 ≒ 29,940円 −（送料6,000＋整備1,000＋フィルター6,000＋決済1,100）≒ <b>約1.6万円</b>。年2回転で約3.2万円/台 → 中古仕入れ4.3万円を<b>約1.4年で回収</b>。夏に全く貸せなくても成立する単価が 9,980円。</li>
          <li><b>スタンダードは遊休が少なく回収が速い</b>。6ヶ月で限界利益 約2.7万円。買取条件は<b>新品定価108,900円基準・既払全額充当</b>（8/8 Keita「最初は新品の価格でいい」）: 買取成立時の受取総額108,900円 −（中古仕入4.3万＋フィルター2.1万＋送料・決済1万）≒ <b>約3.5万円の黒字で出口も確保</b>（12ヶ月で実売価格に全額充当するv1案は原価割れのため廃止）。</li>
          <li><b>資本の逐次投入</b>: 増台は繁忙期直前（12-1月）のみ・予約が入ってから仕入れる。夏前の増台はしない。</li>
          <li><b>下方リスクの限定</b>: 中古美品で仕入れれば売却出口が中古相場 約4万円にあり、撤退時の毀損は台あたり数千円〜1万円程度。</li>
          <li><b>夏の遊休対策（法人なし版）</b>: 6-8月はスタンダード限定のオフシーズン割（例 5,980円）で回転を拾う＋梅雨カビ・ハウスダスト訴求。埋まらない在庫は整備・撮影・SEO仕込み期間に充てる。</li>
        </ul>
      </div>

      {/* ロードマップ */}
      <div className={SECTION}>
        <h3 className={H3}>売上10万円までのロードマップ（個人のみ版）</h3>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr><th className={TH}>Phase</th><th className={TH}>時期</th><th className={TH}>内容</th><th className={TH}>投資</th></tr></thead>
          <tbody>
            <tr><td className={TD}>0 検証</td><td className={TD}>8月</td><td className={TD}>中古美品2台仕入れ＋LP公開（Stripe Payment Links）＋アリススタイル併載</td><td className={TD}>約15万円</td></tr>
            <tr><td className={TD}>1</td><td className={TD}>9-11月</td><td className={TD}>指名SEO＋広告完全一致のみ月5千円・ペット/出産セグメント向け記事 → 3-4台稼働</td><td className={TD}>広告費のみ</td></tr>
            <tr><td className={TD}>2</td><td className={TD}>12-1月</td><td className={TD}>花粉予約の入り具合を見て6-9台へ増台（予約超過分のみ仕入れ）</td><td className={TD}>追加20-30万円</td></tr>
            <tr><td className={TD}>3</td><td className={TD}>2-4月</td><td className={TD}><b>12台稼働で月商10万円達成</b>（シーズン5＋スタンダード7）</td><td className={TD}>—</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          繁忙期外の月商は 4-6万円想定（スタンダード中心）。年間では粗利 50-60万円規模／投資 50-70万円（中古中心）→ 回収 約1年。
        </p>
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
        <h3 className={H3}>⏳ Keita 判断待ち</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
          <li>GO/NO-GO と Phase 0 の投資承認（約15万円）</li>
          <li>仕入れ方針: 中古（要・古物商許可 約1.9万円）か新品1台先行（許可不要・即開始可）か</li>
          <li>ドメイン取得（airrent.jp 等・要空き確認）</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">GO なら Stripe 設定と本番LP化に着手します。詳細正本: docs/tasks/MC-370.md</p>
      </div>
    </div>
  );
}
