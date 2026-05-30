---
name: project-autonomous-rin
description: 駆動役(対話林)がいなくてもタスクが自律前進する仕組み。30分毎 cron で headless 林を起動し1ティック1タスク進める。deploy まで全自律（Keita 承認済 2026-05-30）。
metadata: 
  node_type: memory
  type: project
  originSessionId: 59864f59-1822-4913-aa0f-8e83625a2bd7
---

「エージェントが死んでる＝タスクが進まない」問題の構造的解決として作った自律駆動ループ。

**Why:** subagent は常駐デーモンではなく、親の対話セッション（林）が回している間だけ動く。session-cleanup が古いセッションを reap すると全 subagent が idle 化し、TASK_TRACKER に TODO/IN_PROGRESS が並んだまま誰も進めなくなる（2026-05-30 にこの状態が実際に発生）。駆動役がいなくても自律で進む仕組みが必要、と Keita が要望。

**仕組み:**
- スクリプト `/home/dev/cron-scripts/autonomous-rin.sh`、cron `*/30 * * * *`、ログ `~/logs/autonomous-rin.log`
- 30分毎に headless 林（`claude --print --dangerously-skip-permissions`、--agent 指定なし＝メイン林人格）を起動
- 1ティックで「着手可能タスクを1つだけ」前進させる。green なら commit→push→本番deploy まで完結
- 選定基準: TODO/IN_PROGRESS/REVIEW、BLOCKED でない、依存充足、「設計判断」「Keita承認待ち」タグは触らない。**logic を最優先**（logic に着手可能が無いときだけ cxo-agent/Apollo を見る。Keita 指示 2026-05-30 Logic優先）

**権限:** deploy まで全自律（Keita 承認 2026-05-30）。test green なら push・`gh workflow run deploy-production.yml -f confirm=yes` まで無人実行してよい。

**ガードレール:**
- flock 排他（前ティック走行中なら skip。ティックは数十分かかりうる）
- kill-switch `~/.autonomous-rin.disabled`（`touch` で即停止。ただし判定はティック開始時のみ＝走行中ティックは止まらない。緊急停止は claude プロセスを kill）
- green ゲート・1ティック1タスク・deploy最大1回（プロンプト側のソフト制約）
- `DRY_RUN=1`: git push / gh を物理 shim で no-op 化し push/deploy を確実に抑止（検証走行用）。初回検証は必ず DRY_RUN で
- `--print`(headless) なので session-cleanup の reap 対象外

**状態:** 2026-05-30 に本番アーム済み（crontab `*/30 * * * *` 稼働中）。DRY_RUN 試走で台帳乖離した DF-F2（125ファイル未コミット dirty）を検知し衝突回避・push/deploy せず完走、判断と安全機構を実証してからアーム。

**Apollo 受信箱連携:** ティック冒頭で `/home/dev/projects/cxo-agent/data/inbox.jsonl`（Apollo から投入）を最優先処理。pending を最古1件、kind=task は TASK_TRACKER 登録→着手、kind=instruction は指示遂行、attachments（画像パス）は Read で確認し subagent にも渡す。処理後 `inbox-consumed.jsonl` に id 追記で消費済み化。詳細は [[project-apollo-dashboard]]。

**関連:** [[reference-deploy-commands]]、[[project-apollo-dashboard]]、[[reference-subagent-slow-not-dead]]、[[project-task-manager]]
