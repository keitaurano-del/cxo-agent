// Countdown — 9月末までの平日（営業日）カウントダウン。
// 開発モックアップ（bc42d7ea「カウントダウン」）を Apollo 本体ビューとして実装。
// ダッシュボードの先頭タブ＆既定着地（タップ時の初期表示）。
//
// 仕様: 当年9月30日まで（過ぎたら翌年）の残り平日を、本日を含めて数える。
//   祝日除外トグル（2026年の日本の祝日）、月別内訳、6/22 起点の進捗バー、本日の状態バッジ。
// 配色はハードコード hex を使わず Apollo のトークン（--mc-*, tailwind theme クラス）に従う。
import { useEffect, useMemo, useState } from 'react';

const HOLIDAYS_2026: Record<string, string> = {
  '2026-01-01': '元日', '2026-01-12': '成人の日', '2026-02-11': '建国記念の日',
  '2026-02-23': '天皇誕生日', '2026-03-20': '春分の日', '2026-04-29': '昭和の日',
  '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日', '2026-05-05': 'こどもの日',
  '2026-05-06': '振替休日', '2026-07-20': '海の日', '2026-08-11': '山の日',
  '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日',
  '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日',
};

// 日替わり名言（モチベーション）。日付シードで毎日1つ選ぶ。出典は広く知られる帰属。
interface Quote { text: string; author: string; who: string; meaning: string; apply: string }
const QUOTES: Quote[] = [
  { text: "小さいことを積み重ねるのが、とんでもないところへ行くただ一つの道だと思っています。", author: "イチロー", who: "日米で活躍し、数々の記録を打ち立てた伝説的なプロ野球選手。", meaning: "偉大な目標は、一足飛びには達成できません。日々の地道で平凡な練習や準備を、揺るがぬ信念で続けることこそが、非凡な結果を生む唯一の方法だと説いています。", apply: "大きな目標を細分化し、今日のタスクに集中します。毎日の小さな進捗を記録し、着実な成長を実感することで継続の力にします。" },
  { text: "壁というのは、できる人にしかやってこない。乗り越えられる可能性がある人にしか、やってこない。", author: "イチロー", who: "日米で活躍し、数々の記録を打ち立てた伝説的なプロ野球選手。", meaning: "困難や試練は、その人に成長の機会が与えられている証拠です。乗り越える力があると見込まれているからこそ壁が現れるのであり、逃げずに挑戦すべきだと励ましています。", apply: "困難な仕事に直面したとき、「これは成長のチャンスだ」と捉え直します。解決策を主体的に考え、前向きな姿勢で挑戦します。" },
  { text: "為せば成る、為さねば成らぬ何事も、成らぬは人の為さぬなりけり。", author: "上杉鷹山", who: "財政難に苦しむ米沢藩を改革した江戸時代の名君。", meaning: "「やればできる、やらなければできない。できないのは、人がやらないからだ」という意味です。物事が成就しない原因は能力や運ではなく、行動しないこと自体にあると指摘しています。", apply: "「できないかもしれない」と考える前に、まず行動を起こします。最初の一歩を踏み出すことで、成功への道を切り拓きます。" },
  { text: "やってみせ、言って聞かせて、させてみせ、褒めてやらねば人は動かじ。", author: "山本五十六", who: "第二次世界大戦時の日本の連合艦隊司令長官。", meaning: "人を指導し動かすには、まず自らが手本を示し、丁寧に説明し、相手に実践させ、そしてその結果を認めて褒めるという段階的なプロセスが不可欠であると説いています。", apply: "後輩や部下を指導する際、ただ指示するだけでなく、まず自分が手本を見せます。そして、実践を促し、良い点を具体的に褒めて成長を支援します。" },
  { text: "天才とは、1パーセントのひらめきと99パーセントの努力である。", author: "トーマス・エジソン", who: "蓄音機や白熱電球など、数多くの発明で知られる米国の発明家。", meaning: "非凡な成果は、天賦の才だけで生まれるものではありません。ひらめきを形にするための、膨大で粘り強い努力や試行錯誤こそが、発明の本質であると強調しています。", apply: "アイデアが浮かんだら、それを実現するための地道な作業を厭いません。粘り強く試行錯誤を重ね、アイデアを形にしていきます。" },
  { text: "私は失敗したことがない。ただ、1万通りのうまくいかない方法を見つけただけだ。", author: "トーマス・エジソン", who: "蓄音機や白熱電球など、数多くの発明で知られる米国の発明家。", meaning: "失敗とは終わりではなく、成功に至るまでの過程で得られる貴重なデータです。うまくいかない方法を一つずつ消していくことで、最終的に正解にたどり着けるという考え方です。", apply: "失敗を恐れず、挑戦の数を増やします。うまくいかなかった原因を分析し、次の行動に活かすことで、成功の確率を高めていきます。" },
  { text: "未来を予測する最善の方法は、それを発明することだ。", author: "アラン・ケイ", who: "パーソナルコンピュータの父と呼ばれる米国のコンピュータ科学者。", meaning: "未来は誰かが与えてくれるものではなく、受動的に待つものでもありません。自らが理想とする未来を思い描き、それを実現するために主体的に行動し、創造していくべきだと説いています。", apply: "会社の未来や自分のキャリアを他人任せにしません。自ら目標を設定し、それを実現するための計画を立て、主体的に行動します。" },
  { text: "想像力は知識より重要だ。知識には限界があるが、想像力は世界を包み込む。", author: "アルベルト・アインシュタイン", who: "相対性理論を提唱し、現代物理学の父と称される理論物理学者。", meaning: "知識は過去の事実の集積ですが、想像力は未知の可能性を探求し、新たな発見や創造を生み出す原動力です。既存の枠組みを超えるには、知識だけでなく想像力が必要不可欠です。", apply: "既存のやり方や知識にとらわれず、「もしこうだったら」と自由に発想します。新しいアイデアを生み出すために、意識的に想像力を働かせます。" },
  { text: "困難の中に、機会がある。", author: "アルベルト・アインシュタイン", who: "相対性理論を提唱し、現代物理学の父と称される理論物理学者。", meaning: "問題や困難な状況は、一見するとネガティブなものに思えます。しかし、それを乗り越えようとすることで、新たな発見や成長、そして大きなチャンスが生まれると教えています。", apply: "トラブルや難しい課題に直面したとき、それを成長の機会と捉えます。解決策を探る過程で、新しいスキルや視点を獲得しようと努めます。" },
  { text: "成功とは、情熱を失わずに失敗から失敗へと進んでいくことである。", author: "ウィンストン・チャーチル", who: "第二次世界大戦を勝利に導いた英国の元首相。", meaning: "成功への道は一直線ではなく、数多くの失敗の連続です。重要なのは、失敗してもくじけず、目標に対する情熱を燃やし続け、次の一歩を踏み出し続ける粘り強さです。", apply: "プロジェクトで失敗しても、目標達成への情熱は失いません。失敗から学び、次の挑戦へのエネルギーに変えて、粘り強く取り組みます。" },
  { text: "決して、決して、決して、あきらめるな。", author: "ウィンストン・チャーチル", who: "第二次世界大戦を勝利に導いた英国の元首相。", meaning: "この言葉は、ナチス・ドイツとの絶望的な戦いの最中に国民を鼓舞したものです。どんなに困難な状況でも、諦めない限り敗北ではないという、不屈の精神を象徴しています。", apply: "困難な目標に直面し、心が折れそうになったときにこの言葉を思い出します。諦めずにやり遂げる強い意志を持って、最後まで粘り抜きます。" },
  { text: "現状維持では、後退するばかりである。", author: "ウォルト・ディズニー", who: "ミッキーマウスの生みの親であり、世界的なエンターテイメント企業創設者。", meaning: "時代や環境は常に変化しています。その中で何もしなければ、相対的に取り残されてしまいます。常に革新と挑戦を続けなければ、成長も成功も維持できないという戒めです。", apply: "昨日の成功に安住せず、常に改善点を探します。自分のスキルや仕事のやり方を見直し、より良くするための新しい挑戦を続けます。" },
  { text: "夢を見ることができれば、それは実現できる。", author: "ウォルト・ディズニー", who: "ミッキーマウスの生みの親であり、世界的なエンターテイメント企業創設者。", meaning: "何かを成し遂げるための第一歩は、それを心に思い描くことです。明確な夢やビジョンを持つことが、実現に向けた行動を引き出す原動力になるという、強い信念を表しています。", apply: "自分のキャリアや目標について、具体的な夢を描きます。その夢を実現するための計画を立て、日々の行動の指針とします。" },
  { text: "ハングリーであれ。愚か者であれ。", author: "スティーブ・ジョブズ", who: "アップル社の共同設立者の一人で、革新的な製品を世に送り出した経営者。", meaning: "常に現状に満足せず、貪欲に知識や成功を求め続けなさい。そして、常識や他人の評価を気にせず、自分の信じる道を突き進む勇気を持ちなさい、というメッセージです。", apply: "既成概念にとらわれず、常に新しい知識やスキルを求め続けます。失敗を恐れず、大胆な発想で挑戦することを心がけます。" },
  { text: "今日が人生最後の日だとしたら、今やろうとしていることをやりたいと思うだろうか。", author: "スティーブ・ジョブズ", who: "アップル社の共同設立者の一人で、革新的な製品を世に送り出した経営者。", meaning: "この問いを毎朝自分に投げかけることで、人生で本当に大切なことを見極めようとしました。時間の有限性を意識し、惰性で生きるのではなく、情熱を注げることに集中すべきだと説いています。", apply: "毎朝、今日の仕事が本当に自分のやりたいことか自問します。もし答えが「ノー」なら、キャリアや働き方を見直すきっかけにします。" },
  { text: "完璧を目指すより、まず終わらせろ。", author: "シェリル・サンドバーグ", who: "Facebook（現Meta）のCOOを務める米国の実業家。", meaning: "完璧主義は、時として行動を妨げる足かせになります。100点を目指して時間をかけすぎるより、まずは80点でも完成させ、そこから改善していく方が生産的だという考え方です。", apply: "資料作成などで完璧を求めすぎず、まずは完成させることを優先します。その後、フィードバックをもらいながら改善を重ねていきます。" },
  { text: "変化しないことが、最大のリスクだ。", author: "マーク・ザッカーバーグ", who: "Facebook（現Meta）の創業者兼CEO。", meaning: "急速に変化する現代社会において、現状維持は衰退を意味します。新しいことに挑戦するリスクよりも、何もしないで時代に取り残されるリスクの方がはるかに大きいと警告しています。", apply: "慣れたやり方に固執せず、常に新しいツールや方法を試します。変化を恐れず、積極的に学び、自分自身をアップデートし続けます。" },
  { text: "迷ったときは、困難な道を選べ。", author: "稲盛和夫", who: "京セラや第二電電（現KDDI）を創業した日本の経営者。", meaning: "安易な道は短期的な楽をもたらしますが、成長にはつながりません。困難な道にあえて挑戦することで、人間として大きく成長でき、長期的にはより良い結果が得られると説いています。", apply: "仕事で選択に迷ったら、目先の楽さではなく、自己成長につながるかどうかを基準に判断します。あえて挑戦的な方を選びます。" },
  { text: "楽観的に構想し、悲観的に計画し、楽観的に実行する。", author: "稲盛和夫", who: "京セラや第二電電（現KDDI）を創業した日本の経営者。", meaning: "目標は明るく前向きに設定し、計画段階ではあらゆるリスクを想定して慎重に準備します。そして実行段階では、必ず成功すると信じて大胆に行動することが重要だと説いています。", apply: "新規プロジェクトでは、まず理想のゴールを掲げます。計画では最悪の事態も想定し、実行時は「絶対できる」と信じてチームを率います。" },
  { text: "思い立ったが吉日。", author: "ことわざ", who: "何かを始めようとする人の背中を押す、古くからの日本のことわざ。", meaning: "何かをしようと決心したら、縁起の良い日を待つのではなく、その日すぐに行動するのが良いという意味です。好機を逃さず、すぐに行動に移すことの大切さを教えています。", apply: "「いつかやろう」と思っていることがあれば、今日から始めます。小さな一歩でも、すぐに行動に移すことを習慣にします。" },
  { text: "継続は力なり。", author: "ことわざ", who: "地道な努力の重要性を説く、日本の有名なことわざ。", meaning: "小さなことでも、諦めずにこつこつと続ければ、やがて大きな力となり、成果につながるという意味です。才能よりも、継続する意志の力が成功には不可欠だと教えています。", apply: "資格の勉強やスキルアップなど、すぐに結果が出なくても毎日少しずつ続けます。日々の積み重ねが、将来の大きな力になると信じます。" },
  { text: "七転び八起き。", author: "ことわざ", who: "失敗しても屈しない精神を表す、日本のことわざ。", meaning: "何度失敗しても、そのたびにくじけずに立ち上がることの重要性を説いています。人生には浮き沈みがあることを前提とし、不屈の精神で挑戦し続ける姿勢を称えています。", apply: "仕事で失敗しても、落ち込みすぎずにすぐに気持ちを切り替えます。失敗の原因を分析し、次の挑戦に活かす粘り強さを持ちます。" },
  { text: "初心忘るべからず。", author: "世阿弥", who: "室町時代の能役者であり、能楽を大成させた人物。", meaning: "物事を始めた頃の、未熟で謙虚な気持ちや情熱を忘れてはならないという戒めです。慣れや慢心が生じたときこそ、基本に立ち返ることの重要性を説いています。", apply: "仕事に慣れてきたときこそ、入社当時の謙虚な気持ちを思い出します。基本を再確認し、慢心することなく業務に取り組みます。" },
  { text: "一日生きることは、一歩進むことでありたい。", author: "湯川秀樹", who: "日本人として初めてノーベル賞（物理学賞）を受賞した物理学者。", meaning: "ただ漫然と日々を過ごすのではなく、毎日何か一つでも新しいことを学び、少しでも成長したいという向上心を表しています。人生を、日々の前進の積み重ねと捉えています。", apply: "毎日、寝る前に今日学んだことや成長できたことを一つ振り返ります。小さな進歩でも意識することで、成長への意欲を維持します。" },
  { text: "努力する人は希望を語り、怠ける人は不満を語る。", author: "井上靖", who: "『あすなろ物語』『天平の甍』などで知られる日本の小説家。", meaning: "目標に向かって努力している人は、未来への希望や可能性について話します。一方、努力を怠っている人は、現状への不満や他者への批判ばかり口にする、という対比です。", apply: "不満を口にするのではなく、どうすれば状況を改善できるかを考え、希望を語ります。前向きな言葉で、自分と周りを鼓舞します。" },
  { text: "速く行きたいなら一人で行け。遠くへ行きたいならみんなで行け。", author: "アフリカのことわざ", who: "チームワークの重要性を伝える、アフリカに伝わることわざ。", meaning: "個人の力は短期的には速い結果を出せますが、限界があります。大きな目標や長期的な成功のためには、仲間と協力し、支え合うことが不可欠であると教えています。", apply: "個人の成果だけでなく、チーム全体の目標達成を意識します。積極的に情報共有や協力を行い、チームとして大きな成果を目指します。" },
  { text: "準備された心にのみ、幸運は訪れる。", author: "ルイ・パスツール", who: "近代細菌学の開祖として知られるフランスの細菌学者。", meaning: "幸運や偶然の発見は、ただ待っているだけでは訪れません。日頃から熱心に研究し、問題意識を持ち、常に準備している人の前にだけ、チャンスは姿を現すという意味です。", apply: "いつチャンスが来てもいいように、日頃からスキルアップや情報収集を怠りません。常に準備を整えておくことが、幸運を掴む鍵です。" },
  { text: "昨日のホームランで、今日の試合には勝てない。", author: "ベーブ・ルース", who: "「野球の神様」と称される米国の伝説的なプロ野球選手。", meaning: "過去の成功にいつまでも満足していては、今日の勝利は得られません。常に気持ちを新たに、目の前の課題に集中し、全力を尽くすことの重要性を説いています。", apply: "過去の実績に安住せず、常に新しい気持ちで今日の仕事に臨みます。毎日が新たな挑戦であると捉え、全力で取り組みます。" },
  { text: "明日死ぬかのように生きよ。永遠に生きるかのように学べ。", author: "マハトマ・ガンディー", who: "「非暴力・不服従」を掲げ、インド独立の父として知られる指導者。", meaning: "一日一日を、これが最後であるかのように大切に、情熱的に生きなさい。同時に、学びに関しては、永遠の時間があるかのように、焦らず探求し続けなさい、という教えです。", apply: "今日の仕事に全力で取り組み、悔いを残さないようにします。同時に、長期的な視点で学び続け、自己の成長を追求します。" },
  { text: "最も強い者が生き残るのではない。変化に最もうまく適応した者が生き残る。", author: "ダーウィン（通説）", who: "進化論を提唱したチャールズ・ダーウィンの言葉として広く知られる。", meaning: "生存競争において重要なのは、絶対的な強さではなく、環境の変化に柔軟に対応できる適応力です。ビジネスや人生においても、変化を恐れず適応することが成功の鍵です。", apply: "市場や技術の変化に常にアンテナを張り、柔軟に対応します。新しいスキルを習得し、変化をチャンスと捉えて行動します。" },
  { text: "人生で大切なのは、失敗をどう生かすかだ。", author: "手塚治虫", who: "『鉄腕アトム』など数々の名作を生んだ「マンガの神様」。", meaning: "誰でも失敗はするものであり、失敗しないこと自体が重要なのではありません。その失敗から何を学び、次の成功にどうつなげるかという、経験の活かし方こそが大切だと説いています。", apply: "失敗したときは、その原因を徹底的に分析し、学びを次に活かします。失敗を貴重な経験と捉え、成長の糧にします。" },
  { text: "転んでもいい。立ち上がりさえすれば、それは前進だ。", author: "ことわざ", who: "失敗を恐れず挑戦する勇気を与える、励ましのことわざ。", meaning: "挑戦すれば失敗はつきものです。重要なのは、失敗したという事実ではなく、そこから再び立ち上がり、歩み続けることです。その行為自体が、確かな前進であると教えています。", apply: "挑戦して失敗しても、それを終わりとは考えません。すぐに立ち上がり、次の行動に移すことで、着実に目標に近づいていきます。" },
  { text: "チャンスは、準備が機会と出会ったときに生まれる。", author: "セネカ", who: "古代ローマ帝国の政治家であり、ストア派の哲学者。", meaning: "チャンスは偶然に訪れるものではありません。日頃から知識やスキルを磨き、準備を整えている人の元に、ふさわしい機会が訪れたときに初めて生まれるものだという意味です。", apply: "いつでもチャンスを掴めるよう、日々の自己研鑽を怠りません。スキルや人脈を築き、機会が訪れたときに備えておきます。" },
  { text: "千里の道も一歩から。", author: "老子", who: "古代中国の思想家、老子の思想を伝える書物『老子』の一節。", meaning: "どんなに壮大で遠大な目標も、まずは最初の一歩を踏み出すことから始まります。大きな目標に臆することなく、地道な一歩を積み重ねることの重要性を説いています。", apply: "大きなプロジェクトを前にしても、まずは最初のタスクから着実に始めます。一歩一歩進めることが、目標達成への唯一の道だと信じます。" },
  { text: "上手くいかないときこそ、基本に立ち返れ。", author: "ことわざ", who: "物事が停滞したときの解決策を示す、教訓的なことわざ。", meaning: "複雑な問題に直面したり、スランプに陥ったりしたときは、応用や小手先の技術に頼るのではなく、物事の根本や基本原則に立ち返ることが、突破口を見つける鍵となります。", apply: "仕事で行き詰まったら、一度立ち止まって業務の基本手順や目的を再確認します。基礎を見直すことで、問題解決の糸口を見つけます。" },
  { text: "やらずに後悔するより、やって学ぶほうがいい。", author: "ことわざ", who: "行動することの価値を教える、前向きなことわざ。", meaning: "行動しなかったことへの後悔は、時間が経っても残り続けます。たとえ失敗したとしても、行動すればそこから学びや経験が得られます。挑戦すること自体に価値があるのです。", apply: "新しい仕事や役割に挑戦するか迷ったら、失敗を恐れず「やってみる」ことを選びます。行動から得られる経験を重視します。" },
  { text: "今日できることを明日に延ばすな。", author: "ベンジャミン・フランクリン", who: "アメリカ建国の父の一人で、政治家であり科学者でもある人物。", meaning: "先延ばしは、仕事が溜まるだけでなく、精神的な負担にもなります。やるべきことはすぐに取り掛かる習慣をつけることで、効率的に物事を進められるという、時間管理の基本です。", apply: "タスクが発生したら、すぐに着手するか、いつやるかを決めます。「後でやろう」という先延ばし癖をなくし、すぐに行動します。" },
  { text: "時は金なり。一分の積み重ねが一生を作る。", author: "ベンジャミン・フランクリン", who: "アメリカ建国の父の一人で、政治家であり科学者でもある人物。", meaning: "時間は金銭と同じように貴重で、無駄にしてはいけない資源です。日々のわずかな時間の使い方が、最終的には人生全体を形作るという、時間の大切さを説く教訓です。", apply: "通勤時間や休憩時間などの隙間時間を有効活用します。読書や学習など、自己投資に時間を使い、将来の自分を豊かにします。" },
  { text: "行動は、すべての成功への基礎である。", author: "パブロ・ピカソ", who: "20世紀を代表する芸術家で、キュビスムの創始者。", meaning: "どんなに素晴らしいアイデアや計画も、実際に行動に移さなければ何の意味もありません。成功を掴むためには、まず行動を起こすことが全ての始まりであり、最も重要だと説いています。", apply: "企画書や計画を立てるだけでなく、それを実行に移すことを最優先します。小さくてもいいので、まず行動を起こして前進します。" },
  { text: "できると思えばできる、できないと思えばできない。", author: "ヘンリー・フォード", who: "大量生産方式を確立した、米国の自動車会社フォードの創業者。", meaning: "物事を成し遂げられるかどうかは、その人の能力以上に、心の持ちようが大きく影響します。「できる」という強い信念が、困難を乗り越える力を生み出すという自己成就予言の力です。", apply: "難しい課題に挑戦するとき、「自分ならできる」と強く信じます。ポジティブな自己暗示で、自分の能力を最大限に引き出します。" },
  { text: "障害とは、目標から目を離したときに見えてくる、あの恐ろしいものだ。", author: "ヘンリー・フォード", who: "大量生産方式を確立した、米国の自動車会社フォードの創業者。", meaning: "目標に集中している間は、困難は乗り越えるべき課題として見えます。しかし、目標を見失うと、途端に困難が乗り越えられない障害物のように感じられてしまう、という戒めです。", apply: "困難に直面したときこそ、本来の目標を再確認します。目標に意識を集中させることで、障害を乗り越えるための道筋を見つけます。" },
  { text: "質を高めたければ、まず量をこなせ。量が質に転化する。", author: "ことわざ", who: "スキル習得の過程における、量と質の関係性を説くことわざ。", meaning: "最初から完璧な質を求めるのは困難です。まずは量をこなし、多くの試行錯誤を重ねることで経験値が蓄積され、結果として質の高いものが生み出せるようになる、という考え方です。", apply: "新しいスキルを学ぶとき、完璧を目指す前にまず練習量を確保します。多くの実践を通じて、徐々に質を高めていくことを目指します。" },
  { text: "昨日より少しだけ前へ。それを毎日続ければ遠くまで行ける。", author: "ことわざ", who: "日々の小さな進歩の重要性を教える、励ましのことわざ。", meaning: "大きな飛躍を目指すのではなく、毎日少しでも成長しようと意識することが大切です。その小さな積み重ねが、気づけば自分を想像もしていなかったような高みへと導いてくれます。", apply: "毎日、昨日よりも一つ多く、一つ良く、一つ速くを意識します。日々の小さな改善を積み重ね、長期的な成長を実現します。" },
  { text: "最大の栄光は、決して倒れないことではなく、倒れるたびに起き上がることにある。", author: "孔子", who: "儒教の創始者であり、古代中国の思想家・哲学者。", meaning: "人生において真に価値があるのは、一度も失敗しないことではありません。失敗や逆境に見舞われても、その都度くじけずに立ち上がる、その回復力と不屈の精神こそが尊いのです。", apply: "失敗を人格の否定と捉えず、再起する力こそが重要だと考えます。挫折を経験しても、そこから立ち直り、再び挑戦します。" },
  { text: "やってみなはれ。やらなわからしまへんで。", author: "鳥井信治郎", who: "サントリーの創業者で、日本のウイスキーづくりに挑んだ実業家。", meaning: "頭で考えているだけでは、物事の本当の姿はわかりません。とにかく挑戦してみなさい、という強いメッセージです。行動することで初めて見えてくるものがあるという、実践主義の精神です。", apply: "新しいアイデアや企画について議論するだけでなく、まず試作品を作ってみます。「やってみなはれ」の精神で、行動を重視します。" },
  { text: "一歩踏み出せば、道はひらける。", author: "ことわざ", who: "行動を起こす前の不安を和らげ、勇気を与えることわざ。", meaning: "先が見えずに不安なときでも、勇気を出して最初の一歩を踏み出せば、そこから次の道が見えてくるものです。行動こそが、停滞した状況を打破する鍵であると教えています。", apply: "どうすればいいか分からず立ち止まってしまったら、考えられる最小の一歩を踏み出します。行動することで、次の展開が見えてきます。" },
  { text: "不可能とは、可能性を試さない人の言い訳にすぎない。", author: "モハメド・アリ", who: "「蝶のように舞い、蜂のように刺す」と称された伝説的なプロボクサー。", meaning: "「不可能」という言葉は、挑戦する前から諦めている人が使う便利な言い訳です。自分の限界を自分で決めつけず、まずは全力で挑戦してみることの重要性を力強く説いています。", apply: "「無理だ」と決めつける前に、本当に全ての可能性を試したか自問します。安易に不可能という言葉を使わず、挑戦を続けます。" },
  { text: "今いる場所で、今あるもので、できることをやれ。", author: "セオドア・ルーズベルト", who: "「棍棒外交」で知られる、米国の第26代大統領。", meaning: "環境や条件が整うのを待つのではなく、現在の状況の中で、手持ちのリソースを最大限に活用して、今できる最善を尽くすべきだという、現実的で力強い行動哲学です。", apply: "「人や予算が足りない」と嘆く前に、今ある資源で何ができるかを考えます。制約の中で最大限の成果を出す工夫をします。" },
  { text: "苦しいときこそ、笑え。", author: "ことわざ", who: "逆境に立ち向かうための心の持ちようを教えることわざ。", meaning: "苦しい状況で下を向いていては、事態は好転しません。あえて笑顔を作ることで、気持ちが前向きになり、困難を乗り越える力が湧いてくるという、心理的な効果を説いています。", apply: "仕事で追い詰められたときこそ、意識して口角を上げ、笑顔を作ります。ポジティブな態度で、自分とチームの士気を高めます。" },
  { text: "人間の最大の弱点は、あきらめることである。", author: "トーマス・エジソン", who: "蓄音機や白熱電球など、数多くの発明で知られる米国の発明家。", meaning: "成功に最も確実な方法は、常にもう一回だけ試してみることです。多くの人が成功を目前にして諦めてしまいますが、その諦めの心こそが、人間が持つ最大の弱点だと指摘しています。", apply: "目標達成まであと一歩のところで諦めそうになったら、この言葉を思い出します。粘り強く「もう一回」挑戦する姿勢を貫きます。" },
  { text: "逆境は人を作る。順境は怪物を作る。", author: "ヴィクトル・ユーゴー", who: "『レ・ミゼラブル』などで知られるフランスの文豪。", meaning: "困難な状況は、人を謙虚にし、精神的に鍛え、成長させます。一方、何事も思い通りに進む恵まれた環境は、人を傲慢で自己中心的な「怪物」にしてしまう危険があるという戒めです。", apply: "困難な状況は自分を成長させる機会だと捉えます。逆に、物事が順調なときこそ、謙虚さと感謝の気持ちを忘れないようにします。" },
  { text: "やる気は、やり始めると後からついてくる。", author: "ことわざ", who: "行動と意欲の関係性を表す、心理学（作業興奮）に基づくことわざ。", meaning: "やる気が出るのを待っていても、なかなか始まりません。まずは気分が乗らなくても手をつけてみることで、脳が活性化し、次第に集中力や意欲が湧いてくるという仕組みです。", apply: "気の進まない仕事でも、まずは5分だけと決めて手をつけてみます。作業を始めることで、やる気を引き出し、仕事を進めます。" },
  { text: "小さな一歩でも、止まっているよりはるかに速い。", author: "ことわざ", who: "行動すること自体の価値をシンプルに伝えることわざ。", meaning: "どんなにわずかな前進でも、何もしないで停滞している状態よりは、はるかに価値があります。完璧な準備を待つより、まず一歩踏み出すことの重要性を教えています。", apply: "壮大な計画を立てるだけでなく、今日できる小さな一歩を確実に実行します。着実な前進が、最終的に大きな差を生むと信じます。" },
  { text: "今日の努力は、未来の自分への贈り物だ。", author: "ことわざ", who: "今努力することの未来への価値を、ポジティブに表現したことわざ。", meaning: "今の努力は、すぐに結果が出なくても、必ず将来の自分の力や財産となります。未来の自分が楽になったり、成長したりするための、最高のプレゼントを贈っていると考えましょう。", apply: "目の前の仕事や勉強が辛くても、これは未来の自分への投資だと考えます。将来の自分が感謝するような、質の高い努力をします。" },
  { text: "迷ったら、ワクワクする方を選べ。", author: "ことわざ", who: "直感や情熱を信じることの重要性を説く、現代的なことわざ。", meaning: "論理的な損得勘定だけでなく、自分の心が躍る、情熱を感じる選択をすることが、結果的に良い方向へ導くことがあります。自分の内なる声に耳を傾けることの大切さを教えています。", apply: "キャリアの選択などで迷ったとき、安定性や条件だけでなく、どちらの道が自分の心をワクワクさせるかを判断基準の一つにします。" },
];

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const isHoliday = (d: Date) => !!HOLIDAYS_2026[dayKey(d)];
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function isWorkday(d: Date, excludeHol: boolean): boolean {
  if (isWeekend(d)) return false;
  if (excludeHol && isHoliday(d)) return false;
  return true;
}
function countWork(from: Date, to: Date, excludeHol: boolean): number {
  let n = 0;
  const d = startOfDay(from);
  const end = startOfDay(to);
  while (d <= end) {
    if (isWorkday(d, excludeHol)) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function countCalendar(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);
}

interface MonthRow { m: number; v: number; isCurrent: boolean }
interface Model {
  targetLabel: string;
  unit: string;
  remInc: number;
  remEx: number;
  calDays: number;
  weeks: string;
  pct: number;
  elapsed: number;
  total: number;
  months: MonthRow[];
  todayLabel: string;
  todayKind: 'weekday' | 'weekend' | 'holiday';
  todayHolidayName?: string;
}

function compute(excludeHol: boolean): Model {
  const today = startOfDay(new Date());
  let ty = today.getFullYear();
  let target = new Date(ty, 8, 30); // 9月30日
  if (today > target) { ty++; target = new Date(ty, 8, 30); }

  const remInc = countWork(today, target, excludeHol);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const remEx = today <= target ? countWork(tomorrow, target, excludeHol) : 0;
  const calDays = Math.max(0, countCalendar(today, target));

  const periodStart = new Date(2026, 5, 22); // 6/22 起点
  const total = countWork(periodStart, target, excludeHol);
  const elapsed = Math.max(0, total - remInc);
  const pct = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0;

  const months: MonthRow[] = [];
  for (let m = today.getMonth(); m <= 8; m++) {
    const from = m === today.getMonth() ? today : new Date(ty, m, 1);
    const to = new Date(ty, m + 1, 0);
    const realTo = to > target ? target : to;
    months.push({ m: m + 1, v: countWork(from, realTo, excludeHol), isCurrent: m === today.getMonth() });
  }

  let todayKind: Model['todayKind'] = 'weekday';
  let todayHolidayName: string | undefined;
  if (isWeekend(today)) todayKind = 'weekend';
  else if (isHoliday(today)) { todayKind = 'holiday'; todayHolidayName = HOLIDAYS_2026[dayKey(today)]; }

  return {
    targetLabel: `${ty}年9月30日（${WD[target.getDay()]}）まで`,
    unit: excludeHol ? '営業日' : '平日',
    remInc, remEx, calDays,
    weeks: (remInc / 5).toFixed(1),
    pct, elapsed, total, months,
    todayLabel: `今日は ${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日（${WD[today.getDay()]}）`,
    todayKind, todayHolidayName,
  };
}

function SubCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-4 text-center">
      <div className="text-2xl font-bold tabular-nums text-text">{value}</div>
      <div className="mt-1 text-[11px] text-text-muted">{label}</div>
    </div>
  );
}

export default function Countdown() {
  // 祝日除外トグル。リロードしても維持するため localStorage に保存・復元する。
  const [excludeHol, setExcludeHol] = useState<boolean>(() => {
    try {
      return localStorage.getItem('apollo.countdown.excludeHol') === '1';
    } catch {
      return false;
    }
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem('apollo.countdown.excludeHol', excludeHol ? '1' : '0');
    } catch {
      /* localStorage 不可環境では無視（保持はしないが動作は継続） */
    }
  }, [excludeHol]);

  // 日付またぎ対策: 1時間ごと＋タブ復帰時に再計算。
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 3600 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') setTick((t) => t + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const m = useMemo(() => compute(excludeHol), [excludeHol, tick]);
  const maxMonth = Math.max(1, ...m.months.map((r) => r.v));

  // 日替わり名言: ローカル日付（0時起点の日数）をシードに毎日1つ選ぶ。tick で日付またぎに追従。
  const quote = useMemo(() => {
    const dayIdx = Math.floor(startOfDay(new Date()).getTime() / 86400000);
    return QUOTES[((dayIdx % QUOTES.length) + QUOTES.length) % QUOTES.length];
  }, [tick]);
  const [showDetail, setShowDetail] = useState(false);

  const badge =
    m.todayKind === 'weekend'
      ? { text: '週末', color: 'var(--mc-idle)' }
      : m.todayKind === 'holiday'
        ? { text: `祝日・${m.todayHolidayName}`, color: 'var(--mc-active)' }
        : { text: '平日', color: 'var(--mc-accent, var(--accent))' };

  return (
    <div className="flex justify-center px-4 py-6 md:py-8">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-6 shadow-sm md:p-8">
        <h1 className="text-xl font-bold text-text">9月末までの平日カウントダウン</h1>
        <p className="mt-0.5 text-sm text-text-muted">{m.targetLabel}</p>

        {/* ヒーロー数値 */}
        <div className="my-6 border-y border-border py-6 text-center">
          <div>
            <span className="text-[72px] font-extrabold leading-none tabular-nums text-accent md:text-[80px]">
              {m.remInc}
            </span>
            <span className="ml-2 text-xl font-semibold text-text-muted">{m.unit}</span>
          </div>
          <div className="mt-3 text-sm text-text-muted">本日を含む残りの{m.unit}</div>
        </div>

        {/* 今日の名言（日替わり・モチベーション）。タップで深掘りモーダル */}
        <button
          type="button"
          onClick={() => setShowDetail(true)}
          className="mb-6 block w-full rounded-xl border-l-4 border-accent bg-surface-2 px-4 py-4 text-left transition-colors hover:bg-surface-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">今日の一言</span>
            <span className="text-[10px] font-semibold text-accent">タップで深掘り ›</span>
          </div>
          <blockquote className="mt-1.5 text-[15px] font-medium leading-relaxed text-text">
            「{quote.text}」
          </blockquote>
          <div className="mt-1.5 text-right text-xs text-text-muted">— {quote.author}</div>
        </button>

        {/* サブ3カード */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          <SubCard value={m.remEx} label="本日を除く残り" />
          <SubCard value={m.calDays} label="残り暦日数" />
          <SubCard value={m.weeks} label="週換算" />
        </div>

        {/* 進捗バー */}
        <div className="mb-6">
          <div className="mb-2 flex justify-between text-[11px] text-text-muted">
            <span>6月22日から</span>
            <span>{m.pct}% 経過</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent transition-all duration-700"
              style={{ width: `${m.pct}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-text-muted">
            <span>経過 {m.elapsed}</span>
            <span>全体 {m.total}</span>
          </div>
        </div>

        <hr className="my-6 border-border" />

        {/* 月別内訳 */}
        <div className="mb-3 text-sm font-semibold text-text-muted">月別の残り{m.unit}</div>
        <div className="space-y-2">
          {m.months.map((r) => (
            <div key={r.m} className="flex items-center gap-3">
              <div className="w-8 shrink-0 text-[11px] tabular-nums text-text-muted">{r.m}月</div>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface-2">
                <div
                  className="h-full rounded-md"
                  style={{
                    width: `${Math.max(6, Math.round((r.v / maxMonth) * 100))}%`,
                    background: r.isCurrent ? 'var(--mc-accent, var(--accent))' : 'var(--mc-accent-weak, var(--surface-3))',
                    boxShadow: r.isCurrent ? 'inset 2px 0 0 var(--accent)' : undefined,
                    opacity: r.isCurrent ? 1 : 0.55,
                  }}
                />
              </div>
              <div className="w-12 shrink-0 text-right text-[11px] tabular-nums text-text">{r.v}</div>
            </div>
          ))}
        </div>

        {/* 祝日除外トグル。ON/OFF を文字でも明示し、どちらの状態か一目で分かるようにする。 */}
        <button
          type="button"
          onClick={() => setExcludeHol((v) => !v)}
          role="switch"
          aria-checked={excludeHol}
          className="mt-6 flex w-full items-center justify-between gap-4 rounded-xl bg-surface-2 p-4 text-left"
        >
          <span>
            <span className="block text-sm font-medium text-text">祝日を除いて数える</span>
            <span className="mt-0.5 block text-[11px] text-text-muted">
              {excludeHol
                ? '現在 オン：祝日を除いて「営業日」で計算中'
                : '現在 オフ：祝日も平日として計算中'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2.5">
            <span
              className={`w-9 text-right text-xs font-extrabold tabular-nums ${
                excludeHol ? 'text-accent' : 'text-text-faint'
              }`}
            >
              {excludeHol ? 'ON' : 'OFF'}
            </span>
            {/* タクタイルなスイッチ: トラックは両状態で塗り（OFF=グレー・ON=アクセント青）、
                白い大きめノブ＋影で明確にスライドさせて「スイッチ」だと分かるようにする。
                色は Apollo トークン（tailwind: bg-accent=var(--mc-accent) / bg-surface-3）で指定。 */}
            <span
              className={`relative inline-block h-7 w-[52px] rounded-full border transition-colors duration-200 ${
                excludeHol ? 'bg-accent border-accent' : 'bg-surface-3 border-border'
              }`}
              style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,.12)' }}
            >
              <span
                className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all duration-200"
                style={{ left: excludeHol ? '27px' : '3px', boxShadow: '0 1px 3px rgba(0,0,0,.35)' }}
              />
            </span>
          </span>
        </button>

        {/* 本日の状態 */}
        <div className="mt-4 text-center text-[11px] text-text-muted">
          {m.todayLabel}
          <span
            className="ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ color: badge.color, background: 'color-mix(in srgb, currentColor 14%, transparent)' }}
          >
            {badge.text}
          </span>
        </div>
        <div className="mt-3 text-center text-[11px] leading-relaxed text-text-muted">
          平日 = 月〜金。祝日を除く設定では2026年の日本の祝日を除外します。<br />
          目標日（9月30日）を含んで計算。6月22日を起点に進捗を表示しています。
        </div>
      </div>

      {/* 深掘りモーダル（名言タップで開く） */}
      {showDetail && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={() => setShowDetail(false)}
          role="presentation"
        >
          <div
            className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface p-6 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
                今日の一言・深掘り
              </span>
              <button
                type="button"
                onClick={() => setShowDetail(false)}
                aria-label="閉じる"
                className="-mt-1 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <blockquote className="mt-3 border-l-4 border-accent pl-3 text-lg font-bold leading-relaxed text-text">
              「{quote.text}」
            </blockquote>
            <div className="mt-2 text-right text-sm font-medium text-text-muted">— {quote.author}</div>
            <p className="mt-1 text-right text-xs text-text-faint">{quote.who}</p>

            <div className="mt-5 rounded-xl bg-surface-2 p-4">
              <div className="text-xs font-semibold text-accent">この言葉の意味</div>
              <p className="mt-1.5 text-sm leading-relaxed text-text">{quote.meaning}</p>
            </div>
            <div className="mt-3 rounded-xl bg-surface-2 p-4">
              <div className="text-xs font-semibold text-accent">今日への活かし方</div>
              <p className="mt-1.5 text-sm leading-relaxed text-text">{quote.apply}</p>
            </div>

            <button
              type="button"
              onClick={() => setShowDetail(false)}
              className="mt-5 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
