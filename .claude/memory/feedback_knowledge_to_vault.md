---
name: feedback-knowledge-to-vault
description: ナレッジ系の成果物は全部 obsidian-vault の 20-Knowledge/ に入れる（Apollo の Vault ビューで閲覧する）。
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 59864f59-1822-4913-aa0f-8e83625a2bd7
---

これから **ナレッジ系の成果物は全部 Apollo の Vault（= obsidian-vault）に入れる**。

**Why:** 2026-05-30 Keita 指示「これからナレッジ系は全部アポロのVaultに入れていってね」。知見を Apollo の Vault ビューで一元的に一覧・閲覧できるようにするため。

**How to apply:**
- 置き場所: `/home/dev/projects/obsidian-vault/20-Knowledge/`（既存フォルダ）。.md で書く。
- Apollo（[[project-apollo-dashboard]]）の Vault ビューは `VAULT_DIR=~/projects/obsidian-vault` を読むので、ここに置けば Apollo にそのまま出る。
- 書いたら obsidian-vault リポ（keitaurano-del/obsidian-vault）に commit→push して同期する（既存の night-patrol/briefing 等と同じ運用）。
- 対象「ナレッジ系」: 調査・リサーチレポート、分析・考察、技術ドキュメント、学び/知見のまとめ、deep-research の出力など。Keita に「調べて」「まとめて」と言われた成果物は基本ここ。
- 区別（ここに入れないもの）:
  - 林の人格・preference の記憶 → `.claude/memory/`（従来通り、別レイヤー）
  - タスク台帳 → 各プロジェクト `docs/TASK_TRACKER.md`（[[project-task-manager]]）
  - 日次の briefing/inspection/feedback → `50-Daily/`（既存運用）
  - プロダクトのコード/コード付随 docs → 各リポ内
- 迷ったら Vault の既存構成（00-Inbox/10-Tasks/20-Knowledge/20-Projects/40-Resources/50-Daily/60-Agents/90-Templates）に倣う。純粋なナレッジは 20-Knowledge。

**関連:** [[project-apollo-dashboard]]
