---
name: feedback-taskboard-based-execution
description: 全タスクは Apollo タスクボード（各 TASK_TRACKER.md）に必ず登録し、実行はボードベースで行う。inbox 依頼・フィードバック由来・思いつき、すべて先に起票してから着手。抜け漏れ・遅延は task-manager（台帳正本）と apollo番人（監視）が共同責任で管理する。
metadata:
  type: feedback
  originSessionId: 2026-05-31
---

タスクの実行はすべて Apollo タスクボードベースで行う。依頼・修正・施策は、着手より先に必ず TASK_TRACKER（= Apollo タスクボードのソース）へ登録し、ボードから拾って実行する。思いつきや inbox 依頼で直接実装に飛ばない。

**Why:** 2026-05-31 Keita 明示。「タスクは全部アポロのタスクボードに追加して」「タスクの実行はすべてタスクボードベースで実施して」「アポロ番人とタスクマネージャーで責任をもって抜け漏れ、遅延なく管理して」「inboxにこれまで上がったタスクとか、フィードバックからのタスクとか全部上げて」。ボードを single source of truth にして、何が未着手・進行中・遅延かを一望できる状態を保つ狙い。

**How to apply:**
- 新しい actionable（Keita 依頼 / inbox / フィードバック / 調査で判明した修正 / 林の施策）が出たら、着手前に必ず task-manager に通して TASK_TRACKER へ起票（[[feedback-route-all-to-task-manager]] の徹底版）。起票せず直接実装しない。
- 起票先は対象プロジェクトの TASK_TRACKER.md（logic / cxo-agent / en-chakai / 西丸町）。これらが Apollo の TASK_SOURCES（cxo-agent server/src/config.ts）。en-chakai は 2026-05-31 に雛形を追加（EC-xx 採番）。**en-chakai を TASK_SOURCES に加える config 変更は dev-logic タスクとして必要**（雛形だけでは Apollo に出ない）。
- 採番は必ず `bash /home/dev/cron-scripts/next-task-id.sh <PREFIX>`（[[reference-task-id-numbering]]）。起票は直列化（並行で番号レースさせない）。
- 実行はボードのタスクを拾って行い、着手で IN_PROGRESS、完了で DONE/REVIEW にステータス更新。autonomous-rin も「ボードから1ティック1タスク」で動く（既にこの設計）。
- inbox から拾った依頼は、起票後に inbox-consumed.jsonl へ消費記録（二重処理防止）。

**責任分担（Keita 2026-05-31 決定）:**
- **task-manager（棚町 結）= 台帳の正本管理**: 全タスクの登録・構造化・分解・優先度付け・完了条件の逆引き検証・抜け漏れ提言。正本は各 docs/TASK_TRACKER.md。
- **apollo番人（apollo）= 抜け漏れ・遅延の監視**: apollo-keeper のティック毎（cron 15,45分）に全 TASK_TRACKER を走査し、IN_PROGRESS のまま3日以上停滞（TASK_STALL_DAYS=3）・REVIEW 長期放置・BLOCKED 放置・inbox/フィードバック由来で未起票のまま宙に浮いた依頼を検知。検知したら task-manager に対応を促し、停滞が続くものは Keita にエスカレーション。apollo 自身はプロダクト実装をしない（[[project-apollo-keeper]]）。軽量プリチェックは `apollo-task-stall-check.sh`（bash のみ、遅延あれば apollo-keeper の LLM を起動）。
- 二重チェック（task-manager の能動管理＋apollo の受動監視）で抜け漏れ・遅延を構造的に潰す。

**関連:** [[feedback-route-all-to-task-manager]]、[[project-task-manager]]、[[project-apollo-keeper]]、[[project-apollo-dashboard]]、[[reference-task-id-numbering]]、[[feedback-never-stop-with-open-todos]]
