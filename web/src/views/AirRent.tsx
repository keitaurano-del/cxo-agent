// AirRent 専用ページ（MC-370, 2026-08-08 Keita「エアレント系のものは全部、別タブに転記して整理してまとめて。
// 常に最新情報がそこを見ればわかるように」）。仕事ページの「Blueairレンタル」タブから転記・独立させた。
// Blueair Classic Pro レンタル事業（サービス名 AirRent・目標月商10万円・極力自動化）の正本サマリ。
// 台帳個票 docs/tasks/MC-370.md と本ページを常に同期させること（数値・方針を更新したら両方直す）。
import { PageHeader } from '../components/PageHeader';

const SECTION = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800';
const H3 = 'mb-3 text-sm font-bold text-slate-800 dark:text-slate-100';
const TH = 'border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400';
const TD = 'border-b border-slate-100 px-3 py-2 text-slate-700 dark:border-slate-700 dark:text-slate-200';

// 本文のみ（ヘッダ・スクロール枠なし）。仕事ページの「AirRent」タブへ埋め込むためのエクスポート
// （2026-08-08 Keita「Airrentは仕事の別タブに入れて」）。/airrent 直リンクは後方互換で残す。
export function AirRentContent() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-8 text-[13.5px] leading-relaxed">

          {/* 最新状況 */}
          <div className={SECTION}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700 dark:bg-sky-900 dark:text-sky-200">MC-370</span>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">最新状況（2026-08-10 更新）</h2>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-200">
              <li><b>8/9 22:26 Keita決裁: GO承認</b>（dec-3ca292c1・Phase 0 約15万円・ドメイン=airrent.jp）。残る判断は②仕入方針（中古2台＋古物商 or 新品1台先行）と airrent.jp のレジストラ決済のみ。</li>
              <li><b>8/10 Son先行準備（決済不要分）完了:</b> 特商法表記・利用規約（レンタル約款13条）・アリススタイル出品・<b>Stripe設定手順書</b>の4ドラフトを作成 → vault/30-Projects/airrent/（tokushoho / rental-terms / alice-style-listing / stripe-setup-guide）。Stripeは<b>アカウント開設約15分のみKeita</b>・商品設定以降はSonが代行可の分担まで整理済み。特商法の事業者名等【要Keita】以外は記入済み。</li>
              <li><b>8/10 11:30 LP本番化完了:</b> モックv5を本番用静的サイト（7ページ: LP/商品/申込/マイページ/特商法/規約/完了）へ変換 → 新リポジトリ <code>~/projects/airrent</code>（commit 503e773）。Stripeリンク4箇所と特商法【要Keita】のみプレースホルダ＝<b>ドメイン取得+Stripe開設が済めば即日公開可</b>。</li>
              <li>需要分析・収支試算・プラン v3（2週トライアル/シーズン/スタンダード＋移行ルール）まで確定。</li>
              <li>モックアップは <b>LP／商品説明／決済／マイページの4画面</b>構成。<b>v5 でスタイリッシュに刷新</b>（8/8 Keita「Rent the Runway 参考に」）: セリフ体の大見出し × 白黒基調のエディトリアルデザイン、角なし黒ボタン、大文字レタースペーシングのラベル、人気プランは黒反転カード。解説文ゼロ・移行ルール文言（期間短縮不可）は維持。</li>
              <li>8/8 11:52 指示対応: <b>決済手段の比較（Stripe/Square/PAY.JP）・コスト全洗い出し・損益分岐点グラフ</b>を下部に追加。本人確認は廃止（11:49）。</li>
              <li>Keita 判断待ち（残2点）: 仕入れ方針の一言・airrent.jp のレジストラ決済（GO/NO-GO は承認済み）。</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="/blueair-rental-mockup.html" target="_blank" rel="noreferrer" className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500">モック: LP →</a>
              <a href="/blueair-rental-mockup.html#product" target="_blank" rel="noreferrer" className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500">商品説明 →</a>
              <a href="/blueair-rental-mockup.html#checkout" target="_blank" rel="noreferrer" className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500">決済画面 →</a>
              <a href="/blueair-rental-mockup.html#mypage" target="_blank" rel="noreferrer" className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500">マイページ →</a>
            </div>
          </div>

          {/* 料金プラン */}
          <div className={SECTION}>
            <h3 className={H3}>料金プラン v3（すべて送料・フィルター交換込み／個人のみ・法人なし）</h3>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={TH}>プラン</th><th className={TH}>料金(税込)</th><th className={TH}>期間</th><th className={TH}>狙い</th></tr></thead>
              <tbody>
                <tr><td className={TD}>2週トライアル</td><td className={TD}>13,980円/2週間</td><td className={TD}>2週間</td><td className={TD}>体感→月額転換の導線。転換時は全額充当（1週間プランは廃止・8/8 Keita）</td></tr>
                <tr><td className={TD}>シーズン</td><td className={TD}>9,980円/月</td><td className={TD}>3ヶ月〜</td><td className={TD}>花粉期の短期。夏の遊休月を織り込んだ単価</td></tr>
                <tr><td className={TD}><b>スタンダード</b></td><td className={TD}><b>7,980円/月</b></td><td className={TD}>6ヶ月〜</td><td className={TD}>主力。いつでも買取可（新品定価108,900円基準・既払レンタル料は全額充当）</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              月商10万円 = 12台稼働（シーズン5台 49,900円 ＋ スタンダード7台 55,860円 = 105,760円）＋トライアルは上乗せ
            </p>
          </div>

          {/* プラン移行ルール */}
          <div className={SECTION}>
            <h3 className={H3}>プラン移行ルール（8/8 Keita 仕様）</h3>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={TH}>移行</th><th className={TH}>可否</th></tr></thead>
              <tbody>
                <tr><td className={TD}>2週トライアル → シーズン</td><td className={TD}>○（トライアル料金を全額充当）</td></tr>
                <tr><td className={TD}>2週トライアル → スタンダード</td><td className={TD}>○（同上）</td></tr>
                <tr><td className={TD}>シーズン → スタンダード</td><td className={TD}>○</td></tr>
                <tr><td className={TD}>スタンダード → シーズン / トライアル</td><td className={TD}><b>×</b></td></tr>
                <tr><td className={TD}>シーズン → トライアル</td><td className={TD}><b>×</b></td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              原則: <b>期間が長くなる方向のみ変更可</b>。「期間を短くするような変更はできません」をプラン説明欄・FAQ・決済画面・マイページに明記済み（モック反映済）。
            </p>
          </div>

          {/* 収支試算 */}
          <div className={SECTION}>
            <h3 className={H3}>収支試算 — 送料・経費・リスク引当込み</h3>
            <p className="mb-2 text-slate-700 dark:text-slate-200">
              <b>前提経費</b>: 往復送料 6,500円/回転（CP7i=箱込み160サイズ・関東内 片道約2,500〜2,900円、遠方含む平均を保守設定）＋梱包材500円＋整備・除菌500円 = <b>回転あたり固定 7,500円</b>（本人確認は不要・8/8 Keita）。
              貸出中は フィルター月割2,000円＋動産保険300円 = <b>2,300円/月</b>。売上に対し 決済3.6%＋<b>リスク引当5%</b>（破損・盗難・回収不能・想定外送料）。
            </p>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={TH}>プラン</th><th className={TH}>売上/回転</th><th className={TH}>経費計</th><th className={TH}>利益/回転</th><th className={TH}>利益率</th></tr></thead>
              <tbody>
                <tr><td className={TD}>2週トライアル</td><td className={TD}>13,980円</td><td className={TD}>約9,700円</td><td className={TD}>約4,300円</td><td className={TD}>31%</td></tr>
                <tr><td className={TD}>シーズン3ヶ月</td><td className={TD}>29,940円</td><td className={TD}>約17,000円</td><td className={TD}>約13,000円</td><td className={TD}>43%</td></tr>
                <tr><td className={TD}>スタンダード6ヶ月</td><td className={TD}>47,880円</td><td className={TD}>約25,400円</td><td className={TD}>約22,500円</td><td className={TD}>47%（月あたり約3,750円）</td></tr>
              </tbody>
            </table>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
              <li><b>月商10万円達成時の月次利益 ≒ 約4.8万円</b>（シーズン5台＋スタンダード7台・リスク引当後）。</li>
              <li>年間ベース（繁忙期4ヶ月フル稼働＋他8ヶ月 月2万円前後）で<b>年間利益 約30-40万円</b>。投資50-70万円（中古中心）→ <b>回収 約1.5〜2年</b>（保守見積り）。</li>
              <li>利益レバー: ①買取成立（1件 約3.5万円）②近隣手渡しで送料圧縮 ③フィルター周期の実運用最適化。</li>
            </ul>
          </div>

          {/* 在庫リスクと事業継続性 */}
          <div className={SECTION}>
            <h3 className={H3}>在庫リスクと事業継続性（価格の根拠）</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
              <li><b>シーズン機の稼働前提 = 年2回転・約6ヶ月（稼働率50%）</b>。年 約3.2万円/台の限界利益 → 中古仕入れ4.3万円を約1.4年で回収。<b>夏に全く貸せなくても成立する単価</b>が 9,980円。</li>
              <li>買取条件は<b>新品定価108,900円基準・既払全額充当・いつでも可</b>（8/8 Keita）。買取成立時は約3.5万円黒字（中古仕入時）。13.6ヶ月超の利用で充当額が定価を超えるため、その時点で「実質0円買取」を案内する運用（規約明記）。</li>
              <li><b>資本の逐次投入</b>: 増台は繁忙期直前（12-1月）のみ・予約が入ってから仕入れる。夏前の増台はしない。</li>
              <li><b>下方リスク限定</b>: 中古美品仕入れなら売却出口が中古相場 約4万円にあり、撤退時毀損は台あたり数千円〜1万円。</li>
              <li><b>夏の遊休対策</b>: 6-8月はスタンダード限定オフシーズン割（例 5,980円）＋梅雨カビ・ハウスダスト訴求。埋まらない在庫は整備・SEO仕込みに充当。</li>
            </ul>
          </div>

          {/* 需要分析 */}
          <div className={SECTION}>
            <h3 className={H3}>需要分析 — 結論: 空白地帯</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
              <li><b>Classic Proクラス（56畳・10万円級）のレンタルは大手に無い</b>。RentioのBlueair枠は中〜小型のみ。kikito・DMMいろいろレンタルは撤退済みで競合減少中。</li>
              <li>「ブルーエア レンタル」の<b>指名検索で勝てる隙間</b>がある（比較記事多数＝検索需要は立証済み）。</li>
              <li>需要は<b>二峰性</b>: 2〜4月（花粉・黄砂）と11〜12月（乾燥・ウイルス）。8月が底。花粉症有病率42.5%。</li>
              <li>セグメント: ①重症花粉症（短期・高単価許容） ②出産家庭（〜1歳） ③ペット多頭飼い（長期化・買取転換しやすい）。</li>
              <li>相場: 高級機レンタルは<b>本体価格の5〜9%/月</b>（Rentio Protect 7410i = 8,600円/月が参照点）。</li>
            </ul>
          </div>

          {/* ロードマップ */}
          <div className={SECTION}>
            <h3 className={H3}>売上10万円までのロードマップ</h3>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={TH}>Phase</th><th className={TH}>時期</th><th className={TH}>内容</th><th className={TH}>投資</th></tr></thead>
              <tbody>
                <tr><td className={TD}>0 検証</td><td className={TD}>8月</td><td className={TD}>中古美品2台仕入れ＋LP公開（Stripe Payment Links）＋アリススタイル併載</td><td className={TD}>約15万円</td></tr>
                <tr><td className={TD}>1</td><td className={TD}>9-11月</td><td className={TD}>指名SEO＋広告完全一致のみ月5千円・ペット/出産セグメント向け記事 → 3-4台稼働</td><td className={TD}>広告費のみ</td></tr>
                <tr><td className={TD}>2</td><td className={TD}>12-1月</td><td className={TD}>花粉予約の入り具合を見て6-9台へ増台（予約超過分のみ仕入れ）</td><td className={TD}>追加20-30万円</td></tr>
                <tr><td className={TD}>3</td><td className={TD}>2-4月</td><td className={TD}><b>12台稼働で月商10万円達成</b>（シーズン5＋スタンダード7）</td><td className={TD}>—</td></tr>
              </tbody>
            </table>
          </div>

          {/* 自動化・法規 */}
          <div className={SECTION}>
            <h3 className={H3}>自動化スタックと法規</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
              <li>決済/契約: Stripe Payment Links（サブスク自動更新・解約セルフ）＋クリックラップ規約。本人確認は行わない（8/8 Keita・カード決済成立をもって貸出）。</li>
              <li>物流: 往路=宅急便（B2クラウド半自動）、復路=純正箱＋着払い伝票「集荷を呼ぶだけ」。動産保険を月額に内包・過失破損の客負担上限2万円。</li>
              <li>法規: 新品仕入れ→レンタルは許認可不要。<b>中古仕入れは古物商許可が必要</b>（約1.9万円）。メルカリでのレンタル出品は規約違反のため不可。LPに特商法表記必須。</li>
              <li>定常運用の人手 = 発送・返却検品のみ（1件30分想定）。</li>
            </ul>
          </div>

          {/* 決済手段の比較 */}
          <div className={SECTION}>
            <h3 className={H3}>決済手段の比較（8/8 調査・Keita「Stripe以外の選択肢は？」）</h3>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={TH}>サービス</th><th className={TH}>月額</th><th className={TH}>決済手数料</th><th className={TH}>サブスク対応</th><th className={TH}>評価</th></tr></thead>
              <tbody>
                <tr><td className={TD}><b>Stripe</b></td><td className={TD}>0円</td><td className={TD}>3.6%（海外カード+2%）</td><td className={TD}>◎ Payment Links＋Billingでノーコード級</td><td className={TD}><b>推奨</b>。自動化が最強（自動更新・解約セルフ・請求管理）</td></tr>
                <tr><td className={TD}>Square</td><td className={TD}>0円</td><td className={TD}>3.6%</td><td className={TD}>○ サブスク請求リンクあり</td><td className={TD}>対抗。翌営業日入金・振込無料は魅力。API柔軟性はStripe劣後</td></tr>
                <tr><td className={TD}>PAY.JP</td><td className={TD}>0円（スタンダード）</td><td className={TD}><b>3.3%</b>（一律・最安）</td><td className={TD}>△ 定期課金はv1 API（v2は2026年中予定）・実装量多め</td><td className={TD}>率は最安だが月商10万で差は月300円。自動化の手間が勝る</td></tr>
                <tr><td className={TD}>GMO等 月額固定型</td><td className={TD}>数千円〜</td><td className={TD}>〜3.0%前後</td><td className={TD}>○</td><td className={TD}>×。月商10万規模では固定費負け</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              結論: <b>Stripe 継続推奨</b>。手数料差（3.6% vs PAY.JP 3.3%）は月商10万円で月300円。プラン変更（アップグレードのみ）・自動更新・解約セルフをコード最小で組めるのはStripeのみ。将来月商50万超で PAY.JP ビジネス（月2万円・2.78%）へ移行検討ライン。
            </p>
          </div>

          {/* コスト全体像 */}
          <div className={SECTION}>
            <h3 className={H3}>コスト全体像（ドメイン・サーバー・メール・決済）</h3>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={TH}>項目</th><th className={TH}>初期</th><th className={TH}>月次</th><th className={TH}>備考</th></tr></thead>
              <tbody>
                <tr><td className={TD}>ドメイン airrent.jp</td><td className={TD}>約1,600円/年</td><td className={TD}>約134円</td><td className={TD}>お名前.com・維持調整費込み実額</td></tr>
                <tr><td className={TD}>サーバー（LP）</td><td className={TD}>0円</td><td className={TD}>0円</td><td className={TD}>静的LP＝Cloudflare Pages無料枠で十分</td></tr>
                <tr><td className={TD}>メール（info@airrent.jp）</td><td className={TD}>0円</td><td className={TD}>0円〜880円</td><td className={TD}>受信=Cloudflare Email Routing無料＋Gmail送信で0円。体裁重視なら Google Workspace Starter 800円/月(税抜)</td></tr>
                <tr><td className={TD}>決済（Stripe）</td><td className={TD}>0円</td><td className={TD}>売上の3.6%</td><td className={TD}>月商10万円時 3,600円</td></tr>
                <tr><td className={TD}>機材（Phase 0）</td><td className={TD}>約15万円</td><td className={TD}>—</td><td className={TD}>中古2台＋古物商1.9万 or 新品1台</td></tr>
                <tr><td className={TD}><b>運転固定費 計</b></td><td className={TD}>—</td><td className={TD}><b>約150〜1,100円</b></td><td className={TD}>決済・変動費除く。ほぼゼロ固定費で運営可能</td></tr>
              </tbody>
            </table>
          </div>

          {/* 損益分岐点 */}
          <div className={SECTION}>
            <h3 className={H3}>損益分岐点</h3>
            <p className="mb-1 text-slate-700 dark:text-slate-200">
              <b>① 稼働台数ベース（月次）</b> — スタンダード単価・機材償却込みの保守ケース。固定費が極小のため<b>稼働1台目から黒字</b>（分岐点 ≒ 0.6台）。
            </p>
            <svg viewBox="0 0 480 230" className="w-full" role="img" aria-label="稼働台数と月次売上・コストの損益分岐点グラフ">
              <line x1="40" y1="190" x2="460" y2="190" stroke="#94a3b8" strokeWidth="1" />
              <line x1="40" y1="20" x2="40" y2="190" stroke="#94a3b8" strokeWidth="1" />
              {[0, 3, 6, 9, 12].map((u) => (
                <g key={u}>
                  <text x={40 + u * 35} y="205" textAnchor="middle" fontSize="10" fill="#64748b">{u}台</text>
                  <line x1={40 + u * 35} y1="188" x2={40 + u * 35} y2="192" stroke="#94a3b8" />
                </g>
              ))}
              {[0, 5, 10].map((m) => (
                <text key={m} x="34" y={194 - m * 17} textAnchor="end" fontSize="10" fill="#64748b">{m}万</text>
              ))}
              {/* 売上 7,980円/台 */}
              <polyline fill="none" stroke="#0284c7" strokeWidth="2.5" points={Array.from({ length: 13 }, (_, u) => `${40 + u * 35},${190 - (u * 7980) / 100000 * 170}`).join(' ')} />
              {/* 総コスト 固定1,100＋変動4,240＋償却1,790/台 */}
              <polyline fill="none" stroke="#f59e0b" strokeWidth="2.5" points={Array.from({ length: 13 }, (_, u) => `${40 + u * 35},${190 - (1100 + u * 6030) / 100000 * 170}`).join(' ')} />
              <circle cx={40 + 0.6 * 35} cy={190 - (0.6 * 7980) / 100000 * 170} r="4" fill="#dc2626" />
              <text x={40 + 0.6 * 35 + 8} y={190 - (0.6 * 7980) / 100000 * 170 - 6} fontSize="10.5" fill="#dc2626" fontWeight="bold">損益分岐 ≒ 0.6台</text>
              <text x="430" y={190 - 95760 / 100000 * 170 - 6} textAnchor="end" fontSize="10.5" fill="#0284c7" fontWeight="bold">売上</text>
              <text x="430" y={190 - (1100 + 12 * 6030) / 100000 * 170 + 14} textAnchor="end" fontSize="10.5" fill="#f59e0b" fontWeight="bold">総コスト（償却込）</text>
            </svg>
            <p className="mb-1 mt-4 text-slate-700 dark:text-slate-200">
              <b>② 累計キャッシュフロー（投資回収）</b> — Phase計画どおり投資（8月15万・12月25万）した場合。<b>回収 ≒ 開始から約18ヶ月（2028年2月）</b>。
            </p>
            <svg viewBox="0 0 480 230" className="w-full" role="img" aria-label="累計キャッシュフローの推移と投資回収時期">
              <line x1="40" y1="72" x2="460" y2="72" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
              <text x="34" y="76" textAnchor="end" fontSize="10" fill="#64748b">0</text>
              <text x="34" y="44" textAnchor="end" fontSize="10" fill="#64748b">+10万</text>
              <text x="34" y="204" textAnchor="end" fontSize="10" fill="#64748b">−40万</text>
              {(() => {
                const cf = [-15, -14, -13, -12, -34.9, -32.8, -28, -23.2, -18.4, -16.3, -14.2, -12.1, -11.1, -10.1, -9.1, -8.1, -6, -3.9, 0.9, 5.7];
                const pts = cf.map((v, i) => `${40 + i * (420 / 19)},${40 + ((10 - v) / 50) * 160}`).join(' ');
                return (
                  <>
                    <polyline fill="none" stroke="#0284c7" strokeWidth="2.5" points={pts} />
                    <circle cx={40 + 18 * (420 / 19)} cy={40 + ((10 - 0.9) / 50) * 160} r="4" fill="#dc2626" />
                    <text x={40 + 18 * (420 / 19) - 8} y={40 + ((10 - 0.9) / 50) * 160 - 10} textAnchor="end" fontSize="10.5" fill="#dc2626" fontWeight="bold">黒字転換 2028年2月</text>
                  </>
                );
              })()}
              {[0, 4, 8, 12, 16, 19].map((i) => (
                <text key={i} x={40 + i * (420 / 19)} y="222" textAnchor="middle" fontSize="9.5" fill="#64748b">
                  {['26/8', '26/12', '27/4', '27/8', '27/12', '28/3'][[0, 4, 8, 12, 16, 19].indexOf(i)]}
                </text>
              ))}
            </svg>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              前提: ①はスタンダード単価7,980円・変動費4,240円/台月（送料月割1,250＋フィルター/保険2,300＋決済/引当686）＋機材償却1,790円/台月（中古4.3万・24ヶ月）＋運転固定費1,100円/月。②は稼働 3台(9-11月)→6台(12-1月)→12台(2-4月)→季節連動の保守シナリオ。
            </p>
          </div>

          {/* ドメイン */}
          <div className={SECTION}>
            <h3 className={H3}>ドメイン空き調査（8/8 RDAP実査）</h3>
            <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-200">
              <li>✅ 空き: <b>airrent.jp</b>（推奨・年約3千円）／air-rent.jp／airrent.tokyo／rentair.jp</li>
              <li>❌ 取得済: airrent.com（2005年〜第三者保有・追わない方針）／airrent.net</li>
              <li>取得はレジストラ決済＝Keita操作。GO判断と同時の取得を推奨（.jpは早い者勝ち）。</li>
            </ul>
          </div>

          {/* 判断待ち */}
          <div className={`${SECTION} border-amber-300 dark:border-amber-600`}>
            <h3 className={H3}>⏳ Keita 判断待ち</h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-slate-700 dark:text-slate-200">
              <li>GO/NO-GO と Phase 0 の投資承認（約15万円）</li>
              <li>仕入れ方針: 中古（要・古物商許可 約1.9万円）か新品1台先行（許可不要・即開始可）か</li>
              <li>airrent.jp の取得（レジストラ決済のみ Keita 操作）</li>
            </ol>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">GO なら Stripe 設定と本番LP化に着手します。詳細正本: docs/tasks/MC-370.md</p>
          </div>
    </div>
  );
}

// /airrent 直リンク用の単独ページ（後方互換）。正式な置き場所は 仕事 ＞ AirRent タブ。
export default function AirRent() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="AirRent"
        subtitle="Blueair Classic Pro レンタル事業（MC-370）— 目標月商10万円・極力自動化。最新状況はこのページに集約。"
        fetchedAt={undefined}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <AirRentContent />
      </div>
    </div>
  );
}
