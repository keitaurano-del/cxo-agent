---
name: project-apollo-dashboard
description: Apollo（旧 Mission Control）= cxo-agent 配下の開発状況リアルタイム可視化ダッシュボード。port 4317、トークン認証、web/dist 静的配信。Vultr 常駐。
metadata: 
  node_type: memory
  type: project
  originSessionId: 59864f59-1822-4913-aa0f-8e83625a2bd7
---

Apollo は cxo-agent リポ（/home/dev/projects/cxo-agent）配下に構築した「全プロジェクト×全エージェントの稼働・タスク進捗・会話をリアルタイム可視化する常駐ダッシュボード」。2026-05-30 に Mission Control から Apollo にブランド表示リネーム（ディレクトリ・リポ・npm パッケージ名は cxo-agent / apollo-web / apollo-server）。

**構成:**
- backend: Node22 + Express5 + TS（server/src: config.ts/index.ts/collectors/lib/watch.ts）。collectors が `~/.claude/projects/**/subagents/**/agent-*.jsonl` と各 TASK_TRACKER を解析
- frontend: React18 + Vite + Tailwind（web/、ビルド済み web/dist を server が静的配信）
- port **4317**、トークン認証（`.mc.env` の `MC_TOKEN`、env キー名は MC_ のまま温存＝動作キー）
- 稼働: systemd `deploy/apollo.service`（旧 mission-control.service）、Restart=always
- API: `/api/agents` `/api/tasks` `/api/narrative` `/api/roster`、SSE `/api/stream`、認証なしヘルスは `/api/healthz`
- ナビ: 司令塔 / エージェント / 会話 / **タスクボード** / 今日 / Vault（「タスク」→「タスクボード」に 2026-05-30 変更）

**タスク台帳:** cxo-agent/docs/TASK_TRACKER.md（MC-xx 採番、ID プレフィックスは内部識別子として温存）。

**反映方法（重要）:** サーバは `tsx src/index.ts`（watch 無し）起動なので、**server コード変更は `sudo systemctl restart mission-control.service` で再起動せんと反映されない**（自動リロードしない）。web は `cd web && npm run build` で dist 更新→静的配信に即反映。ポート 4317 は1プロセスのみ bind 可。生 tsx を別途起動すると systemd 版と競合して片方が bind 失敗するので、起動・再起動は必ず systemctl 経由で行う（生 tsx 起動は禁止）。

**自己修復:** systemd `mission-control.service`（旧名のまま install・enabled・MainPID 稼働、`Restart=always`/`RestartSec=3`）でクラッシュ自動復活。加えてハング検知に `~/cron-scripts/apollo-watchdog.sh`（cron `*/3`、/api/healthz 3連続failで `systemctl restart`、cooldown＋kill-switch `~/.apollo-watchdog.disabled`）。

**モバイル対応:** 2026-05-30 レスポンシブ化。md未満は左サイドバー→下部 BottomNav、各 view 単一カラム/横スクロール、Vault は単一ペイン切替。390px で横溢れ0を検証済み。

**追加機能（2026-05-30）:** Token消費量 `/api/usage`（全期間/プロジェクト/モデル/期間別、5分キャッシュ）＋ Usage ビュー。非同期受信箱（FAB＋ボトムシートでスマホから task/instruction を画像付き投入、Ctrl+V 貼付対応）：POST/GET `/api/inbox`（multipart、images フィールド0〜5枚）、保存先 `data/inbox.jsonl`＋`data/inbox-attachments/`、自律林が消費（[[project-autonomous-rin]]）。

**スマホ固定 URL:** cloudflared 名前付きトンネルで apollo.<ドメイン> を発行する方針（2026-05-30、cloudflared インストール済 /usr/local/bin/cloudflared）。当面は quick tunnel(*.trycloudflare.com)＋`?token=`で暫定アクセス。認証は query token→Cookie 発行の1クリック方式でスマホブラウザ対応済み。

**注意:** これは「cxo-agent リポを GitHub Issue 起票に使わない」方針（[[feedback-no-cxo-agent]]）とは別レイヤー。Apollo はあくまでローカル/Vultr 常駐の可視化ツールで、Issue 管理用途ではない。

**関連:** [[project-autonomous-rin]]、[[project-task-manager]]、[[project-vultr-second-server]]
