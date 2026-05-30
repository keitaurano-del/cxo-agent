---
name: feedback-route-all-to-task-manager
description: 何かやることが発生したら（Keita の依頼・調査で判明した修正・自分が思いついた施策、すべて）着手前に一旦 task-manager に渡して TASK_TRACKER に登録・構造化させる。
metadata:
  type: feedback
  originSessionId: 2026-05-28
---

新しい actionable なやることが発生したら、**着手前にまず task-manager に渡す**。Keita から言われたこと、林の調査で判明した修正、林自身が思いついた施策、どれも例外なく一旦 task-manager に通して TASK_TRACKER（各プロジェクト docs/TASK_TRACKER.md）へ登録・構造化させる。

**Why:** 2026-05-28 Keita 明示「おれから言われたこととか含め、何かやることが発生したら全部 task-manager に一旦渡すようにして」。抜けもれゼロを task-manager に一元担保させる狙い。林が直接さばける小物でも、トラッカーに乗らないと管理から漏れる。

**How to apply:**
- やること（依頼・修正・施策）が出た瞬間、実装より先に task-manager へブリーフ（背景・調査根因・担当案・優先度）を渡す。
- 林が自分で実装/対応する case でも、まず task-manager に通して登録 → ステータス更新は task-manager に反映させる。
- task-manager は実装しない調整役（[[project-task-manager]]）。林は調査・オーケストレーション・実装委譲を担い、状態の正本は task-manager 管理の TASK_TRACKER.md。
- 報告は [[feedback-direct-content-not-path]] 準拠で、トラッカーの該当箇所を会話本文にも展開する。
- 緊急の一発対応でも事後で必ず task-manager に登録（履歴として残す）。

**関連:** [[project-task-manager]]、[[feedback-direct-content-not-path]]
