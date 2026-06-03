---
name: feedback-apollo-keeper-board-reconcile
description: apollo番人の常設任務として「Apollo のタスクボード（全 TASK_TRACKER）を常に最新の実態に保つ＝能動的リコンサイル」を追加。遅延検知だけでなく、台帳が現実とズレていたら番人自身が証拠ベースで status を直す。
metadata:
  type: feedback
  originSessionId: 2026-06-01
---

apollo番人（apollo-keeper）の常設任務に「Apollo タスクボードを常に最新に保つ＝能動的リコンサイル」を追加した（2026-06-01 Keita 指示「アポロのタスクボードも番人に常に最新になるようにやらせてね」）。

**Why:** それまで apollo番人の台帳責務は「抜け漏れ・遅延を検知して task-manager に提言する」受動監視止まりだった（[[project-apollo-keeper]]）。Keita はボードが常に実態を映している状態を望んでおり、検知して投げるだけでなく番人自身が台帳のズレを直すところまで踏み込ませたい。実際この日、autonomous-rin が logic 専用スコープでしか回らず cxo-agent の IN_PROGRESS（MC-84/85）が誰にも駆動されず放置され、ボードが実態とズレていた。

**How to apply（apollo-keeper.sh のミッション(3)に実装済み）:**
- エンゲージするティックでは必ずボードのリコンサイルを実施する。全 TASK_TRACKER（logic/cxo-agent/en-chakai/西丸町）を走査し、表行の status（＝single source of truth）が実態と合っているか突合する。
- 証拠ベースで補正（推測で動かさない）:
  - 実装・push・deploy・検証済みなのに IN_PROGRESS/REVIEW のまま → 証拠（commit sha / deploy run / test 結果 / file:line）を確認できたら DONE 化し note に根拠（REVIEW→DONE は実機検証で可、Keita 確認不要＝[[feedback-review-agent-verify-then-done]]）。
  - 着手済みなのに TODO → IN_PROGRESS に補正。完了条件未達なのに DONE → 差し戻し。
  - 表行と詳細セクションの status 食い違い → 表行に揃える。
  - inbox/フィードバック由来で宙に浮いた未起票依頼 → task-manager に起票を促す。
- 役割境界: status の事実補正・整合は番人がやってよい。新規起票・分解・優先度設計・受け入れ条件定義は task-manager の正本責務（番人は「ズレを直す・抜けを指摘する」、task-manager は「台帳を構造として設計する」）。
- 安全則: 必ず `git pull --rebase --autostash` 後に自分が触る行だけ名指し編集→名指し add→commit→push。`git add -A` や reset --hard 禁止（autonomous-rin/dev-logic とのレース・未コミット差分巻き込み回避、[[feedback-vault-no-destructive-git]] と同思想）。1ティックで触るのは確証のある最小限の行。
- リコンサイル結果は inspections レポートに「reconciled: <ID> <旧status>→<新status>（根拠）」で記録。

**実装場所:** `/home/dev/cron-scripts/apollo-keeper.sh` の PROMPT 内ミッション(3)＋「ボード最新化（リコンサイル）の手順」セクション。cron は既存の */30（実体は 15,45 の apollo-keeper）。LLM エンゲージ条件（healthz異常 / task stall / 09時日次）は据え置きなので、毎ティックではなく「異常時＋停滞検知時＋日次」にリコンサイルが走る。常時性をさらに上げたい場合は engage 条件の見直しが必要（Keita 確認事項）。

**関連:** [[project-apollo-keeper]]、[[feedback-taskboard-based-execution]]、[[feedback-all-agents-taskboard-based]]、[[feedback-review-agent-verify-then-done]]、[[project-task-manager]]、[[project-autonomous-rin]]
