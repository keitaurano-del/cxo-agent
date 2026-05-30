---
name: project-vultr-second-server
description: Vultr 上の2台目クラウドサーバ「Claude Code Server 2」（高スペック機）の構成と接続情報。2026-05-29 に現行サーバの複製として構築。
metadata: 
  node_type: memory
  type: project
  originSessionId: c8590e68-01f3-4aae-8268-10e14f785795
---

2026-05-29、Keita 依頼で Vultr に2台目の高スペックサーバを新規構築し、現行「Claude Code Server」の複製として環境を揃えた。

**Why:** 現行サーバ（vhf-1c-2gb / 1vCPU・2GB）が並列エージェントやビルドで窮屈だったため、より高スペックの機体を追加（リサイズでなく新規。リサイズだと現行＝このセッションのホストが再起動で落ちるため新規を選択）。

**構成:**
- 現行（複製元）: Vultr instance id `2e0e792b-f91a-4656-afa0-ede86a5cbc5f`、ラベル "Claude Code Server"、`vhf-1c-2gb`、IP 139.180.202.62、東京(nrt)
- 新規: instance id `7076891d-07d7-4aed-9f48-2f2e14225ae3`、ラベル "Claude Code Server 2"、`vhf-4c-16gb`（4vCPU/16GB/384GB, $96/mo）、IP **167.179.64.231**、東京(nrt)、Ubuntu 24.04

**新箱に入れたもの（現行と同等）:** node22 / claude CLI / openclaw / gh / rg / jq、agent-config→~/.claude＋bootstrap、5リポ(logic/en-chakai/cxo-agent/ai-pmo/obsidian-vault) clone、Claude OAuth(.credentials.json)・.mcp.json・logic/.env コピー、gh は GH_TOKEN env 方式、openclaw 設定コピー、非rootユーザ `dev`(passwordless sudo)、npm install 済み(logic tsc green)。

**接続:**
- SSH 鍵 `~/.ssh/vultr_claude2`（現行サーバ上に秘密鍵。新箱の root と dev に公開鍵登録済み）。`ssh -i ~/.ssh/vultr_claude2 root@167.179.64.231`
- 新箱の GitHub 用鍵は別途生成し Keita の GitHub アカウントに登録済み（clone 用）
- Keita ローカルPCから入るには Keita の公開鍵を新箱に追加するか Vultr Web Console

**Vultr API:** トークンは `~/.vultr_key`（現行サーバ、chmod 600）。API は IP allowlist 制で 139.180.202.62 を /32 許可済み。2026-05-29 に一度チャットへ直貼りしたトークンは Rotate 推奨。

**注意:** Claude Code は root で `--dangerously-skip-permissions`（ヘッドレス）不可。対話利用は root でOK、ヘッドレス自動実行は `dev` ユーザで。

**cron 自動化を新箱 dev へ移行（2026-05-29、T-F 解決）:** 現行サーバの cron 3本（night-patrol 03:00 / feedback-watcher 06:00 / morning-briefing 07:00）は root の `claude -p` が skip-permissions ガードで弾かれ空振りしていた（=T-F の正体）。新箱の `dev` ユーザ crontab に移設し3本とも実走検証グリーン（obsidian-vault へ push 成功）。現行サーバの crontab 3行は `#MOVED-TO-NEWBOX#` でコメントアウト（二重 push 回避）。
- 適応スクリプトは `dev:~/cron-scripts/{night-patrol,feedback-watcher,morning-briefing}.sh`（パスを $HOME ベース化、ログは ~/logs、claude 呼び出しに `--dangerously-skip-permissions` 付与）。元の agent-config 版は /root ハードコード・skip-permissions 無しなので新箱では使わない。
- feedback-watcher / morning-briefing は Supabase MCP がヘッドレスで動かない問題を回避し、**service_role キー直 curl** に書き換え（reports/feedback テーブル、KPI は subscriptions count）。キーは `dev:~/.supabase_service_key`（chmod 600、ref yctlelmlwjwlcpcxvmgx）。2026-05-29 チャット直貼りのため Rotate 推奨。
- TZ=Asia/Tokyo、Playwright chromium 導入済み（night-patrol 用）、dev の git identity = Keita Urano / keita.urano@gmail.com。

**dev ログインで林が自動起動:** `dev:~/.bashrc` にインタラクティブ・ログイン時 `cd ~/projects && claude` を仕込み済み（`$- == *i*` ガードで cron/非対話は除外）。dev で入ると対話の林が自動で立つ。通常シェルが要る時は `touch ~/.no-rin`。Keita ローカル鍵(keita.urano@gmail.com)を root/dev 両方に登録済み＝`ssh dev@167.179.64.231` で鍵ログイン可。root/dev のコンソール用パスワードも設定済（チャット既出、要変更）。

**tmux:** インストール済み。`main` セッション常駐＋`@reboot tmux new-session -d -s main` で再起動後も自動復帰。SSH 切断に耐える長時間作業用。

**対話セッション定期清掃（2026-05-30 Keita 依頼）:** 古い対話 claude セッションが溜まると共有 Anthropic アカウントの取り合いで 529/激遅になる（実際 12h/5h 級のゾンビ3本で新箱が「動いてない」ように見えた）。対策に `dev:~/cron-scripts/session-cleanup.sh` を新設、dev crontab に `0 */2 * * *`（JST 2時間おき）で登録。保護ルール: (1)`--print` 付き=cron headless は触らない (2)tmux `main` pane 配下の常駐林は触らない (3)対話セッションのうち最新1本は無条件で残す（=1本だけなら何時間でも生存、複数溜まった時だけ古い方を reap）。THRESHOLD 既定 7200秒。ログ `~/logs/session-cleanup.log`。手動清掃は旧箱から `ssh -i ~/.ssh/vultr_claude2 root@167.179.64.231` で `kill <pid>`。

**.claude.json（dev）:** theme=dark、~/projects 配下を trust 済みに設定（初回プロンプトで簡易端末が無反応になる問題を解消）。

**2箱運用の役割分担（2026-05-29 Keita 決定）:** 共有 CLAUDE.md で両箱に林の人格が乗るため、同一バッチを並行実装すると origin で二重 push/二重実装の競合が起きる（2026-05-29 に実際に #4/#6/#7 で重複発生）。対策として **林＝新箱(Claude Code Server 2)を主たる実装オーナー**、**旧箱(現行サーバ)＝同能力だが優先順位は林の次の支援役**に一本化。旧箱の既定は実装せず「検証・本番 probe・origin 同期・台帳整理・調整・Keita の直接依頼」。旧箱が動く時は必ず origin を pull して林の作業と被らないか確認してから（二重 push を避ける）。「必要に応じて旧箱でも動く」＝ Keita 指名時 or 林が詰まった時の応援。Anthropic アカウントは両箱共有なので、同時に LLM を回すと 529(Overloaded) を誘発しやすい点も留意（容量はアカウント単位、箱スペックでは増えない）。
