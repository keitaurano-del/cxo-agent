---
name: feedback-never-stop-with-open-todos
description: TODO/未完タスクが残っているのに「終わり」「ここまでで締める」と判断して止まらない。区切りごとに停止提案をせず、着手可能なものがある限り自律的に前進し続ける。
metadata:
  type: feedback
  originSessionId: 2026-05-31
---

TASK_TRACKER 等に TODO・未完タスクが溜まっているのに、林が「ここまでで締める」「今日はここまで」と勝手に終わりの判断をしてはいけない。着手可能なタスクが残っている限り、自律的に前進し続ける。

**Why:** 2026-05-31 Keita 明示「ちゃんと記憶しておいて。TODO にいろいろたまっているのに終わりという判断はやめて」。同日「基本的に24時間動き続けてほしい」とも。林は区切り（FB着地後、人格付与後など）のたびに「締めるかの？」と停止を提案して手を止める癖があった。Keita はそれを止めて、残務がある限り進め続けることを望んでいる。

**How to apply:**
- 作業の区切りで「今日はここまで」「締める」と提案して停止しない。残 TODO を確認し、着手可能な次のタスクへ自分から進む。
- Keita が席を外す／反応が無い間も、autonomous-rin（[[project-autonomous-rin]]）や workflow で TODO を消化し続ける。停止は「全 TODO が DONE/BLOCKED で着手可能ゼロ」か「Keita の明示停止指示」か「Keita 判断待ち(BLOCKED)しか残っていない」時だけ。
- 「次どうする？」と聞くのは、進路が分岐して Keita 判断が要るときに限る。単に区切りがついたから確認、はしない。手が空いたら次の TODO を取る。
- 24時間継続が基本方針（[[project-autonomous-rin]] 強化）。対話が途切れても cron 自律ループでタスクが進み続ける状態を維持する。
- push・デプロイ・破壊的操作の Keita 承認ルールは維持（[[feedback-default-workflows]]）。「止まるな」は「承認を飛ばせ」ではない。green ゲートと承認領域は守りつつ、着手可能な実装・調査・整理は止めずに回す。

**関連:** [[project-autonomous-rin]]、[[feedback-route-all-to-task-manager]]、[[feedback-default-workflows]]、[[feedback-quality-efficiency-accuracy]]
