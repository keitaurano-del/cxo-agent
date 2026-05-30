---
name: feedback-vault-no-destructive-git
description: 共有 obsidian-vault では git reset --hard / clean -f 等の破壊的操作を禁止。未コミットの他者編集を消す事故が起きた。
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 59864f59-1822-4913-aa0f-8e83625a2bd7
---

obsidian-vault（`/home/dev/projects/obsidian-vault`）では **`git reset --hard` / `git checkout -- .` / `git clean -fd` 等の破壊的操作を絶対にしない**。subagent にも徹底させる。

**Why:** 2026-05-30、Apollo の Vault アップロード機能を検証中に dev-logic がテストコミットを巻き戻すため `git reset --hard` を打ち、作業前から working tree にあった未コミット（未ステージ）の `50-Daily/briefings/2026-05-26.md` 編集差分を巻き込んで消した。未ステージ変更は reflog/stash/fsck に残らず復旧不能。obsidian-vault は night-patrol / feedback-watcher / morning-briefing の cron や Obsidian アプリ自体、Apollo の Vault 書き込みなど**複数の書き手が常時触る共有リポ**なので、いつ他者の未コミット変更が乗っているか分からない。

**How to apply:**
- Vault で git を使うときは「自分が作ったファイルだけ」を `git add <path>` で個別ステージ→commit する。`git add -A` や `git add .` でまとめて拾わない（他者の変更を巻き込む）。
- テストコミットの巻き戻しが必要なら `git reset --soft HEAD~1`（インデックス/作業ツリーを保持）か `git revert`。`--hard` は使わない。
- pull/同期は `git pull --rebase --autostash`（作業ツリー汚れを一時退避）。Apollo の Vault 書き込み（[[project-apollo-dashboard]] vaultWrite.ts）は既にこの方式。
- 検証で実ファイルを作るなら、作ったファイルだけを名指しで `git rm`→commit して net-zero に戻す（reset --hard を使わない）。
- これは obsidian-vault に限らず、cron 等が常時書く共有リポ全般に適用する。

**関連:** [[feedback-knowledge-to-vault]]、[[project-apollo-dashboard]]
