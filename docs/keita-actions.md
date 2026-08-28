# Keita操作キュー（今日の2分）

Keitaにしかできない操作の常設キュー。**完了したらチェックを付けるか、Sonに一言**（Sonが棚卸しで消し込み）。
Son運用ルール: 新しいKeita操作が発生したらこのファイルに追記し、夜のまとめ報告からリンクする。終わった項目は「完了ログ」へ移す。

---

## 未完

- 2026-08-28 【認証分離】per-agent OAuth ログイン（各2分・ブラウザ必要）🔒[Keita]
  `mkdir -p ~/.claude-agents/son && CLAUDE_CONFIG_DIR=~/.claude-agents/son claude /login` — son/yui/haru/main の順で任意（kimi は moonshot なので対象外）。dir 未作成のエージェントは従来どおり共有 ~/.claude で動き続けるので部分導入OK。背景=8/26-27のOAuth並行refreshレース根絶の本筋（wrapper実装済 `~/cron-scripts/claude-cli-agent-wrapper.sh`）
- 2026-08-28 【認証分離】gateway reload のタイミング判断（10秒）🔒[Keita]
  openclaw.json の command 差替えは 8/28 20:41 実施済（バックアップ `openclaw.json.bak-before-agent-wrapper-20260828`）・keepalive の複数dir監視対応も済。ただし gateway reload 前なので配線は未発効＝現状は従来動作のまま安全。上記ログイン完了後、Son idle のタイミングで林が reload して配線完了（Son が一瞬止まるため実施タイミングだけ Keita 判断）

## 完了ログ

- 2026-08-15 10:11 【MC-347】GSC 手動インデックス申請 ×3 → **完了** 🔒[Keita]（Keita本人が申請実施。以後2週間はSonが観測→横展開判断。決裁の発話記録= d95110cb jsonl 2026-08-15T01:11:03Z）
- 2026-08-15 10:11 【MC-373】CW登録＋応募2件 → **キャンセル** 🔒[Keita]（「347以外キャンセル」。writing-factory一式は記録として残置・再開時は intake/APPLY-PACK.md から流用可。日次job_watch cron 20:45停止済・復元は /tmp/cron.bak.20260815）
- 2026-08-15 10:11 【MC-351】Cowork Gmail ログイン＋hn@宛メール送信 → **見送り** 🔒[Keita]（「347以外キャンセル」）
- 2026-08-15 10:11 【MC-352】note/Blogger投稿の Cowork 実操作 → **見送り** 🔒[Keita]（「347以外キャンセル」）

- 2026-08-12 【MC-370】AirRent 残り2操作（仕入方針・airrent.jp決済）→ **キューから除去**（MC-370 は 8/11 Keita が台帳で CANCELLED 🔒。LP実装7頁は ~/projects/airrent に保全、再開時に流用可）
- 2026-08-12 【MC-367】EDINET確認コード中継 → **キューから除去**（MC-367 は 8/11 Keita が台帳で CANCELLED 🔒）
- 2026-08-09 22:26 【MC-370】AirRent決裁 dec-3ca292c1 → **承認して進める** 🔒[Keita]（GO確定・Phase0約15万円承認・ドメイン=airrent.jp。仕入二択とレジストラ決済は上記3へ振替。決裁記録=decision-requests.jsonl decidedAt=2026-08-09T13:26:22Z→ その後 8/11 CANCELLED）
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
