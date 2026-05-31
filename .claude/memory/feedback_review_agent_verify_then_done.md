---
name: feedback-review-agent-verify-then-done
description: REVIEW ステータスの最終ゲートは Keita 実機確認を待たず、エージェント（test-functional 等）が実機/実効性検証して必要なら修正し DONE 化してよい。Keita の確認は不要。
metadata:
  type: feedback
  originSessionId: 2026-05-31
---

タスクが REVIEW（実装・テスト・デプロイ済みだが最終確認待ち）の状態のとき、**エージェントが実機/実効性を検証し、必要なら修正して DONE 化してよい。Keita の確認は不要**。

**Why:** 2026-05-31 Keita 明示「エージェントで実機確認して必要であれば修正してDONEして。Keitaの確認は不要だよ」。それまで REVIEW の最終ゲートを「Keita 実機目視確認待ち」にしていたため、実装・デプロイ済みのタスクが REVIEW のまま大量に滞留していた（logic 7件・Apollo 14件）。Keita のボトルネックを外し、検証もエージェントに委ねて自走させる狙い。

**How to apply:**
- REVIEW タスクは test-functional（試野 緑）等の検証エージェントに実機/実効性検証を投げる。検証 OK なら DONE 化、不具合があれば dev-logic 等に修正させてから DONE 化（[[feedback-never-stop-with-open-todos]] と整合＝止めずに前進）。
- 検証の根拠（テスト結果・実機挙動・file:line）を DONE の note に残す。「Keita 実機確認待ち」を DONE の条件にしない。
- ただし push・本番デプロイ・破壊的操作の Keita 承認ルールは維持（[[feedback-default-workflows]]）。「Keita 確認不要」は REVIEW→DONE の判定に限る話で、本番反映そのものの承認を飛ばす意味ではない（既にデプロイ済みのものを DONE 化するのが大半なのでデプロイ承認は別途）。
- 設計判断・仕様未確定で BLOCKED のものは別。これは Keita 判断が要るので勝手に進めない。REVIEW（実装完了・検証だけ残）と BLOCKED（判断待ち）を取り違えない。
- autonomous-rin / apollo-keeper もこのルールで REVIEW を消化してよい（24h 自走で REVIEW を溜めない）。

**関連:** [[feedback-never-stop-with-open-todos]]、[[feedback-taskboard-based-execution]]、[[project-task-manager]]、[[feedback-default-workflows]]
