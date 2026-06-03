---
name: feedback-agents-proactive-by-design
description: 全エージェント（林・autonomous-rin・apollo番人・task-manager・dev-logic・reviewer・test-functional・logic-coach・content-creator・designer・night-patrol・feedback-watcher）は受動的でなく能動的に動ける設計にする。検知・報告で止めず、自分の権限内で次の一手まで自走する。
metadata:
  type: feedback
  originSessionId: 2026-06-01
---

全エージェントを「受動的」から「能動的」に設計し直す。2026-06-01 Keita 指示「全部のエージェントにいえることだけど、受動的じゃなくて、能動的に動けるようになってほしい。そういう設計にしてほしい」。

**Why:** これまでの設計は受動寄りだった。監視系は「検知→報告／提言」で止まり実際の是正をしない（apollo番人が遅延を検知しても直さず投げるだけ等）、自律ループは logic スコープだけで cxo/en-chakai を駆動せず放置（MC-90 で inbox が死に箱化したのが典型）、実装系は呼ばれるまで待つ。Keita は各エージェントが自分の領分で起点を作り、完了まで自走する状態を望んでいる。「設計にして」＝個別の指示でなく、エージェント定義レベルの恒久的な行動原則として埋め込む。

**How to apply（全エージェント共通の能動性原則）:**
- 検知したら是正まで自分の権限内でやる。「見つけた→報告」で止めない。権限外（コード修正・push・deploy・本番DDL・Keita 判断）に当たる部分だけエスカレーションし、それ以外は自走で前進させる。
- 監視系（apollo番人・night-patrol・feedback-watcher）= 異常/声/遅延を検知したら、自分でできる是正（restart・台帳リコンサイル・起票促し）を実行し、コード修正等だけ委譲（[[feedback-apollo-keeper-board-reconcile]] がこの具体化）。
- 自律ループ（autonomous-rin）= 1プロジェクトに偏らず、着手可能タスクがある全プロジェクトを駆動する。スコープ欠落で宙に浮くタスクを作らない（cxo/en-chakai ループの常時稼働＝MC-84/85/90 の本質）。
- 実装系（dev-logic・designer・content-creator）= 渡されたタスクを受け身にこなすだけでなく、着手中に気づいた隣接の不備・抜けを task-manager に起票し、green/検証まで自分で閉じる。
- 検証系（reviewer・test-functional・logic-coach）= REVIEW を Keita 待ちで放置せず、自分で実機/実効性検証して DONE 化 or 差し戻し（[[feedback-review-agent-verify-then-done]]）。
- task-manager = 受け身の台帳係でなく、抜け漏れ・停滞を先回りで洗い出し、担当アサインと次アクションを能動提案する。
- 林 = 区切りで止まらず着手可能 TODO を自分から取りに行く（[[feedback-never-stop-with-open-todos]] と一体）。
- 共通のブレーキは維持: push・deploy・破壊的操作・本番DDL・設計判断は Keita 承認（[[feedback-default-workflows]]）。「能動的」は「承認を飛ばす」ではない。green ゲート・品質ゲート（[[feedback-quality-efficiency-accuracy]]）も維持。能動性は「承認領域の手前まで自分で進め切る」こと。

**実装（恒久化の置き場所）:** agent-config の各 agent 定義（projects-meta/agents/*.md）の共通ベースに「能動性の原則」を明記し、sync で全 sub-repo へ配布する。apollo-keeper.sh など cron 駆動エージェントは prompt 内にも反映（[[feedback-apollo-keeper-board-reconcile]] で着手済み）。autonomous-rin のスコープ拡張（全プロジェクト駆動）も能動化の一環。

**関連:** [[feedback-apollo-keeper-board-reconcile]]、[[feedback-never-stop-with-open-todos]]、[[feedback-review-agent-verify-then-done]]、[[feedback-taskboard-based-execution]]、[[project-autonomous-rin]]、[[project-apollo-keeper]]、[[project-agent-roster-20260531]]、[[feedback-quality-efficiency-accuracy]]
