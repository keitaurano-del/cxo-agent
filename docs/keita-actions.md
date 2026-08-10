# Keita操作キュー（今日の2分）

Keitaにしかできない操作の常設キュー。**完了したらチェックを付けるか、Sonに一言**（Sonが棚卸しで消し込み）。
Son運用ルール: 新しいKeita操作が発生したらこのファイルに追記し、夜のまとめ報告からリンクする。終わった項目は「完了ログ」へ移す。

---

## 未完（2026-08-10 時点）

1. 【MC-351/367】Keita端末で Cowork の Gmail ログイン1回（5分・PC推奨）
   - プロンプト= obsidian-vault/30-Projects/videodl/drafts/cowork-hn-email-prompt-20260808.md
   - 1回のログインで両取り: ①hn@宛メール送信（文面承認済 dec-1d8f635c、Son側はSMS認証壁で送信不可） ②EDINET登録の確認コード中継（MC-367）
2. 【MC-352】note/Blogger投稿の Cowork 実操作（8/4決裁=Cowork経由・6日経過）
   - Keitaが Cowork でnote/Bloggerにログイン→Sonの校了済ドラフト貼り付け投稿。段取り= videodl/drafts/cowork-post-prompts-20260805.md
3. 【MC-370】AirRent 残り2操作（GO決裁は8/9承認済 → 完了ログ参照）
   - ①仕入方針の一言だけ返答: 中古美品2台@4.3万＋古物商申請（約1.9万・警察署・Keita名義）か、新品1台@7万先行（許可不要・即開始）か。8/9のapproveは一括ボタンでここだけ未確定
   - ②airrent.jp のレジストラ決済（年約3千円・空き確認済8/8・.jpは早い者勝ちなので早め推奨・決済系のためSon実施不可）
   - 詳細= https://apollomansion.com/work?tab=airrent
   - ※LP本番サイト7頁は Son 実装完了（~/projects/airrent・即日公開可）。上記②のドメイン決済が公開の最後の壁
4. 【MC-347】GSC 手動インデックス申請 ×3（各1分・スマホ可）
   - 8/10 に3ハブ統合を本番反映済（301+IndexNow送信済）。Google は IndexNow 非対応のため GSC の「URL検査→インデックス登録をリクエスト」を3件: https://clipitnow.net/bilibili-download / https://clipitnow.net/bilibili-1080p-save / https://clipitnow.net/bilibili-register-japan

## 完了ログ

- 2026-08-09 22:26 【MC-370】AirRent決裁 dec-3ca292c1 → **承認して進める** 🔒[Keita]（GO確定・Phase0約15万円承認・ドメイン=airrent.jp。仕入二択とレジストラ決済は上記3へ振替。決裁記録=decision-requests.jsonl decidedAt=2026-08-09T13:26:22Z）
- 2026-08-09 22:26 【MC-347】インデックス回復計画 dec-cb7dbe1d → **案A承認** 🔒[Keita]（bilibili群15頁→3ハブ＋301統合・2週間観測後に横展開判断。Son実装へ。決裁記録=decision-requests.jsonl decidedAt=2026-08-09T13:26:20Z）

- 2026-08-07 【MC-351】hn@宛メール文面の承認 dec-1d8f635c → **approve-send** 🔒[Keita]（送信実行はSon側Gmail壁で上記1へ振替）
- 2026-08-07 【MC-361】Son巻き取り dec-3c38402e → **承認** 🔒[Keita]（現在は共有ファイルの他者WIP待ちで適用保留）
- 2026-08-07 【MC-367】EDINET APIキー取得 dec-4b1b2843 → **son-register 承認** 🔒[Keita]（登録実行はメール確認コード壁で上記1へ振替）

- 2026-08-04 22:29 決裁4件タップ完了 🔒[Keita]
  - 【MC-351】次の一手 → **(a) hn@へ依頼メール**（dec-56d95f6a）→ Son英文起案済・文面承認 dec-1d8f635c へ継続
  - 【MC-367】LBOモック方向性 → **承認して進める**（dec-68e7d6ae）
  - 【MC-313】UX/トークン改善 残り🟡6項目 → **一括でSonに任せる**（dec-da32b7d3）
  - 【MC-352】note/Blogger投稿 → **Cowork経由で投稿**（dec-446deb72）→ 上記2の実操作へ継続

- 2026-08-02 4. Tumblr 認証メールのリンクをタップ（1分・スマホ可）【MC-352】 → ボードから完了 🔒[Keita]
- 2026-08-02 3. resume docx×3 の削除可否（10秒）【MC-290】 → ボードから完了 🔒[Keita]
- 2026-08-02 1. GSC 再同意（2分・スマホ可）【MC-351/347】 → ボードから完了 🔒[Keita]
- 2026-08-02 2. Reddit / SaaSHub 登録（各2分・スマホ）【MC-331】 → ボードから完了 🔒[Keita]
- 2026-08-01 22:01 MC-339 ExoClick再決済 → **広告テスト中止**で決着（再決済不要）
- 2026-08-01 22:01 MC-331 Show HN投稿 → **承認**（Sonが火/水夜に投稿）
- 2026-08-01 22:01 GSC再同意 → 「今やる」選択（→上記1の実操作確認へ）
