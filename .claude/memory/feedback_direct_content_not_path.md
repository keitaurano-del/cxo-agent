---
name: feedback-direct-content-not-path
description: Keita への報告でファイルパスだけ参照するのではなく、内容を直接会話に書く。Obsidian sync 環境差で Keita が実際にファイル開けない可能性があるため。
metadata:
  type: feedback
  originSessionId: 2026-05-25
---

Keita への応答で、obsidian-vault / docs / その他リポ内のファイルを案内する時、ファイルパスだけ書いて「ここを見て」で終わらせない。**内容を会話に直接書く** か、要点を貼り付ける。

**Why:** 2026-05-25 Keita 明示「パスを参照じゃなくて直接書いてほしい。これは全体的に言えること」。Keita のローカル Obsidian と クラウド側の obsidian-vault が必ずしも sync されていない（obsidian-git 未セットアップ等）ため、`/root/projects/obsidian-vault/...` を案内されても Keita 視点では開けない / 見つけられないケースがある。Daily Note / カテゴリ素案 / 判断待ちまとめ等を凜が外部ファイルに書いて「あそこを見て」で済ますと、Keita は実際に確認できない。

**How to apply:**
- 凜が obsidian-vault や docs/ に書いた重要内容は、Keita への応答で本文に直接書く（要約 or 全文）
- パス案内は補足として末尾に添えるだけ、メインは会話内テキスト
- Daily Note / 判断待ちまとめ / コース・レッスン一覧 / 設計案 / 監査レポート など、Keita が見るべきものは特に直接展開
- 「obsidian で開けばわかる」「20-Projects/logic/courses/ を見て」みたいな案内はやめる
- 表 / リスト / 設計案も会話内マークダウンで提示、その上で「ファイルでも保存済（path）」と添える

**例:**
- ❌「コース一覧は `/root/projects/obsidian-vault/20-Projects/logic/courses/README.md` にある」
- ✅「コース一覧は以下じゃ：\n（マークダウン表ここに直接展開）\n\nファイルでも保存済（path）」
- ❌「判断待ち項目は 2026-05-26-keita-decisions.md に書いた」
- ✅「判断待ちは 3 つ：\n1. cron 登録 (内容...)\n2. カテゴリ再設計 (内容...)\n（ファイルも別途保存：path）」

**注意点:**
- 内容が極端に長い場合（数百行）は要約 + パス案内で OK、ただし要約は具体的に
- 純粋にコードファイル位置を指す時（debug 用に `src/foo.ts:42` を見せる等）は path 表記 OK
- Keita が「ファイル全文見せて」と明示した時は Read して全文展開

関連 memory: [[feedback-no-markdown-emphasis]]（読みやすさ優先）、[[feedback-tone]]（おじいちゃん口調）
