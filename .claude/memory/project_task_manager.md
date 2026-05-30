---
name: project-task-manager
description: タスク管理専任 subagent「task-manager」を 2026-05-27 新設。ステータス管理・抜けもれ検知提言・担当アサイン提案・完了検証を担い、実装はせず委譲する調整役。正本は各プロジェクト docs/TASK_TRACKER.md。
metadata: 
  node_type: memory
  type: project
  originSessionId: db856c97-8f54-458c-a336-6dcb6aff69c6
---

2026-05-27、Keita 依頼で **task-manager** subagent を新設（`~/.claude/projects-meta/agents/task-manager.md`、agent-config に登録して全 sub-repo へ sync 済み）。

**役割:** タスクを構造化してステータス（TODO / IN_PROGRESS / BLOCKED / REVIEW / DONE / CANCELLED）を一元管理し、依頼に明示されない暗黙サブタスク（i18n・両OS・テスト・回帰・受け入れ条件・永続化など）を先回りで洗い出して提言する。担当エージェントへのアサイン提案、依存・優先度管理、完了検証（DoD 照合）、ブロッカーのエスカレーションも担う。

**Why:** 「タスクの抜けもれゼロを保証する調整役」が欲しいという Keita 依頼。過去に pm を削除した（[[project-agent-cleanup-20260511]]）が、今回は「実装はせず管理に専念」という明確な役割分担で再導入した。

**How to apply:**
- 自分ではコードを書かない（実装は dev-logic / designer / content-creator 等に委譲）。push / デプロイ判断はしない（Keita 専権）。
- single source of truth は各プロジェクトの `docs/TASK_TRACKER.md`。状態更新は必ずそのファイルに反映してから報告する（[[feedback-direct-content-not-path]] 準拠で会話本文にも内容を展開）。
- 報告は「結論 → 抜けもれ提言 → 次アクション」の順で簡潔に。
- 初運用（2026-05-27）: logic 7件修正バッチ（T1-T7）と西丸町チラシ（NF-1〜4）を並行管理。`logic/docs/TASK_TRACKER.md` と `obsidian-vault/20-Projects/nishimarucho-flyer/TASK_TRACKER.md` で運用実証済み。

関連: [[project-agent-cleanup-20260511]]、[[feedback-direct-content-not-path]]
