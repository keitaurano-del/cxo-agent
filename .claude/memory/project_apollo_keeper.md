---
name: project-apollo-keeper
description: Apollo（:4317 ダッシュボード）専任の番人エージェント。林/autonomous-rin とは独立に Apollo インフラの監視・障害対応・24h稼働維持を引き受ける。cron で headless 自走。
metadata:
  type: project
  originSessionId: 2026-05-31
---

2026-05-31、Keita 依頼で **Apollo（apollo）= Apollo ダッシュボード専任の番人エージェント**を新設。林（プロダクト開発の autonomous-rin）とは独立した存在で、責務は Apollo 自体の管理・監視・障害対応・24時間稼働の維持・メンテナンスに限る。

**Why:** Keita 指示「りんとは別に、Apollo の管理・モニタリング・動かなくなった時の対応・24h稼働のためのモニタリングをやる Apollo というエージェントを作って」。さらに「subagent でなく独立したエージェントにして」。Apollo の restart/healthz 確認を林が手でやっていたのを専任に切り出した。

**2層構成（cron 常駐監視＋headless LLM）:**
- 下層 `~/cron-scripts/apollo-watchdog.sh`（cron `*/3`、既存）— /api/healthz を叩き、3連続失敗で `systemctl restart`。cooldown 120s・kill-switch `~/.apollo-watchdog.disabled`。プロセス死は systemd Restart=always、ハングはこれが拾う。
- 上層 `~/cron-scripts/apollo-keeper.sh`（cron `15,45`、新設）— headless `claude --print` で深い点検。healthz=200 かつ非09時なら LLM を起動せず即終了（token節約）、異常時 or 09時台の日次巡回時のみ LLM 起動。flock 排他・kill-switch `~/.apollo-keeper.disabled`。

**点検範囲:** 死活(healthz/systemd)、主要API疎通(/api/agents,tasks,workflows,narrative を MC_TOKEN で)、リソース(df/free/プロセス)、ログ異常(watchdog フラッピング/journalctl)、dist 陳腐化。

**権限境界（Keita 2026-05-31 決定: restart自動・コード修正は報告）:**
- 自動でやってよい: systemctl restart、web の dist 再ビルド(npm run build)、ゾンビ掃除、ログローテ。
- エスカレーション: server/web のコード・設定修正が要る障害は dev-logic に委譲＋ cxo-agent/docs/TASK_TRACKER.md に MC 起票（採番 `next-task-id.sh MC`）＋ Keita 報告。自分で本番コードを書いて壊さない。
- 破壊的操作（rm -rf / git reset --hard / DB変更）禁止。cxo-agent 台帳編集時は pull --rebase + 名指しadd（autonomous-rin とのレース回避）。
- 責務は Apollo インフラだけ。プロダクト機能開発はやらない（林/autonomous-rin の領分）。

**roster 表示:** Apollo の roster は obsidian-vault/60-Agents/*.md を読む。2026-05-31 に人格保有エージェントだけに整理（開発9体＋hayashi-rin＋apollo の11体）。古い6体（ceo/marketing/secretary/test-unit/sanity/smoke）の md を 60-Agents から削除して Apollo 表示から消した（コード変更不要、collector が都度読む）。apollo の roster エントリ = `60-Agents/apollo.md`。

**関連:** [[project-apollo-dashboard]]、[[project-autonomous-rin]]、[[project-agent-roster-20260531]]、[[feedback-never-stop-with-open-todos]]
