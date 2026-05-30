# 西丸町会 ヒアリングシート Figma マスター

A4縦1枚（595×842 @72dpi、印刷用）の会員情報ヒアリングシート。

## ファイル
https://www.figma.com/design/jr6KWdX5iKsajFnkNmp9bU

同一ファイル内に4案を横並びで配置（各フレーム上部にパターン名ラベル）:
- ベース（公的・中立かっちり） node 1:2 / x=0 ※前任 designer 作。住所欄を「〇丁目〇番〇号」始まりに修正済、掲載OK/NG を 11px に縮小済
- パターンA「ポップ」 node 20:2 / x=700 — Mochiy Pop One タイトル + Rounded Mplus 1c 本文、コーラル#FF6F46 + ティール#149E96、ソフトtintパネル、ドット見出し、ラベルチップ
- パターンB「親しみやすい・あたたかい」 node 22:2 / x=1400 — Yomogi手書き見出し + Klee One本文、クリーム#FBF6EE地、テラコッタ二重罫の回覧板枠、ピーチのラベルチップ
- パターンC「モダン・すっきり」 node 25:2 / x=2100 — Zen Kaku Gothic New通し、白地、極細ヘアライン罫、英字アイブロウ+01/02ナンバリング、スレートインディゴ#41518D一色アクセント、下線のみの記入欄

## 構成（全案共通・項目は1つも削らない）
ヘッダー(タイトル+右上「西丸町 総務部」) / 挨拶文 / 個人情報の取り扱い囲み / 記入テーブル(世帯代表者氏名・住所・電話・メール・名簿掲載OK/NG) / 世帯全員5名分の氏名年齢記入欄(※災害時安否確認名簿の注記) / QR枠2つ(Googleフォーム・Instagram、破線プレースホルダ) / お礼フッター。プレースホルダ(〇〇町会 等)は維持。

## 制約
高齢者向け高コントラスト・大きめ文字、モノクロ印刷で判読可（濃色ベタ白抜き多用NG）、記入欄に手書き余白。

## 技術知見（重要）
- use_figma は console.log / return 値を返さない。検証は get_screenshot か get_metadata で行う。
- auto-layout の resize 後 sizingMode 当て直し問題を回避するため、各パターンは **plain frame + 絶対座標** で組んだ（layoutMode なし）。高さが決定論的でテキスト潰れゼロ。これが量産・微調整とも一番安全。
- 縦が 842 を超えると rect の height が負になり `Number must be >= 0` で落ちる。下半分（世帯欄・QR・フッター）は最後に座標を詰めて収める。ベースの実証済み y-anchor（table 282–490, 世帯 ~506, members ~524–660, QR ~672–800, footer ~812）を流用すると一発で収まる。
- フォント実在スタイル: Rounded Mplus 1c は "Bold" 無し→ExtraBold。Mochiy Pop One/Yomogi/Klee One は Regular中心(Klee は SemiBold あり)。Zen Kaku Gothic New は Light/Regular/Medium/Bold。
- /figma-use スキルは Skill レジストリに未登録のことがある（MCP リソース配信）。その場合は use_figma の既知 gotcha を踏まえて慎重に進める。

(2026-05-27 作成)
