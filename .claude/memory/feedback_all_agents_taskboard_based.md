---
name: feedback-all-agents-taskboard-based
description: 全エージェント（dev-logic/designer/content-creator/reviewer/logic-coach/test-functional/task-manager/night-patrol/feedback-watcher/apollo番人/autonomous-rin/林）がタスクボード（TASK_TRACKER.md）ベースで仕事する。着手前に必ず起票、着手でIN_PROGRESS、完了でDONE/REVIEWに更新。
metadata:
  type: feedback
  originSessionId: 2026-05-31
---

開発チームの全エージェントは Apollo タスクボード（各プロジェクトの docs/TASK_TRACKER.md）ベースで仕事をする。ボードに乗っていない作業をしない。

**Why:** 2026-05-31 Keita 明示「全エージェントタスクボードベースで仕事をするように徹底させて」。同日の一連（「全タスクをボードに」「タスクの実行はすべてタスクボードベースで」）の総仕上げ。ボードを single source of truth にして、誰が何をやっているか・何が抜けているか・何が遅れているかを Apollo で一望できる状態を全員で保つ。

**How to apply（全エージェント共通の鉄則）:**
- **着手前に起票**: どのエージェントも、作業を始める前に対象タスクが TASK_TRACKER に在ることを確認する。無ければ task-manager に起票させる（[[feedback-route-all-to-task-manager]] / [[feedback-taskboard-based-execution]]）。思いつき・調査で出た修正・inbox 依頼・フィードバック由来、すべて先に起票。
- **着手時に IN_PROGRESS**: タスクに着手したらステータスを IN_PROGRESS に更新（誰が触っているか分かるように）。
- **完了時に DONE/REVIEW**: 実装完了→検証で DONE、検証残あれば REVIEW。検証根拠を note に file:line で残す（[[feedback-review-agent-verify-then-done]]）。
- **ボード外作業の禁止**: ボードに無いタスクを勝手に進めない。例外は「インフラ緊急対応（apollo番人の restart 等）」「Keita の即時口頭指示」だが、それも事後に必ず起票して履歴化する。
- **台帳更新は実ファイルに**: ステータス変更は必ず docs/TASK_TRACKER.md に反映してから報告。表行（summary table）のステータスを正とする（Apollo collector も表行を正に読む）。同一IDの詳細セクションと表行で食い違わせない。
- **採番は next-task-id.sh**（[[reference-task-id-numbering]]）、**起票は直列化**、編集は pull --rebase 後に該当行のみ。

**役割別の管理責任（2026-05-31 決定）:**
- task-manager（棚町）= 台帳の正本管理（登録・構造化・完了検証・抜け漏れ提言）
- apollo番人（apollo）= 抜け漏れ・遅延の監視（[[project-apollo-keeper]]、ティック毎に停滞検知→task-manager提言/Keitaエスカレ）
- 各実装/検証エージェント = 自分が触るタスクのステータスを正しく上げる責任
- 林 = オーケストレーション、ボードに無い依頼を必ず起票に通してから委譲

**関連:** [[feedback-taskboard-based-execution]]、[[feedback-route-all-to-task-manager]]、[[feedback-review-agent-verify-then-done]]、[[project-task-manager]]、[[project-apollo-keeper]]、[[reference-task-id-numbering]]、[[feedback-never-stop-with-open-todos]]
