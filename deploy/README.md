# Apollo 運用ランブック (deploy/)

Apollo ダッシュボード（cxo-agent、ポート 4317）の本番運用手順をまとめます。
install / start / logs / rotate / health / troubleshoot をこの 1 ファイルで完結させます。

このディレクトリの `apollo.service` が systemd unit の正本です。

---

## 0. 前提（現状の実態）

- ホスト: Vultr「Claude Code Server 2」（167.179.64.231、ユーザー `dev`、passwordless sudo）
- プロセス: `tsx src/index.ts` を node が main プロセスとして起動（graceful shutdown のため）
- 待受: `http://localhost:4317`（1 プロセスのみ bind 可能）
- 認証: トークン認証（`.mc.env` の `MC_TOKEN`）。ヘルスチェック `/api/healthz` は認証不要
- web: `web/dist` を server が静的配信（ビルド済み成果物を配信）

重要: 現在 systemd に install されている unit 名は **`mission-control.service`**（旧名のまま）です。
このリポの unit ファイル名は `apollo.service` ですが、install 済みの実体は旧名のため、
本ランブックのコマンドは install 済みの実体に合わせて **`mission-control.service`** で記載します。
unit 名のリネーム（`apollo.service` への統一）は別タスクで扱います。

---

## 1. install（systemd unit の設置）

初回設置、または unit ファイルを更新した場合の手順です。

```bash
# 1. unit ファイルを /etc/systemd/system/ に設置
#    （install 済み実体の unit 名は mission-control.service のため、その名前で設置する）
sudo cp /home/dev/projects/cxo-agent/deploy/apollo.service /etc/systemd/system/mission-control.service

# 2. systemd に unit の変更を読み込ませる
sudo systemctl daemon-reload

# 3. 自動起動を有効化（マシン再起動後も立ち上がるように）
sudo systemctl enable mission-control.service

# 4. 起動
sudo systemctl start mission-control.service

# 5. 起動確認
systemctl status mission-control.service --no-pager
curl -s -o /dev/null -w "healthz=%{http_code}\n" http://localhost:4317/api/healthz   # 200 を期待
```

unit ファイルの要点（`apollo.service`）:

- `WorkingDirectory=/home/dev/projects/cxo-agent/server`
- `ExecStart=/home/dev/projects/cxo-agent/server/node_modules/.bin/tsx src/index.ts`
- `EnvironmentFile=/home/dev/projects/cxo-agent/.mc.env`（`MC_TOKEN` などを読み込む）
- `User=dev` / `Group=dev`
- `Restart=always` / `RestartSec=3` / `StartLimitIntervalSec=0`（プロセス死で自動復活）

注意: 現在 install されている実体は Description が旧名（`Mission Control dashboard ...`）です。
このリポの `apollo.service` は Description を `Apollo dashboard ...` に更新済みなので、
上記手順で再設置すると Description だけが Apollo 表記に変わります（動作には影響しません）。

---

## 2. start / stop / restart

```bash
# 起動
sudo systemctl start mission-control.service

# 停止
sudo systemctl stop mission-control.service

# 再起動（server コード変更の反映はこれが必須。後述「troubleshoot」参照）
sudo systemctl restart mission-control.service

# 稼働状態の確認
systemctl status mission-control.service --no-pager
systemctl is-active mission-control.service     # active を期待
systemctl is-enabled mission-control.service    # enabled を期待
```

---

## 3. logs（ログの見方）

### server 本体のログ（systemd journal）

server プロセスの stdout/stderr は journald に記録されます。

```bash
# 直近 50 行
journalctl -u mission-control.service --no-pager -n 50

# リアルタイム追従（tail -f 相当）
journalctl -u mission-control.service -f

# 当日分だけ
journalctl -u mission-control.service --no-pager --since today
```

### 自己修復スクリプトのログ（~/logs/）

cron で動く 2 層の自己修復スクリプトのログはファイルに出ます。

| ファイル | 内容 |
|----------|------|
| `~/logs/apollo-watchdog.log` | watchdog（cron `*/3`）の死活監視・restart 記録。健全時は沈黙（ノイズ削減）、unhealthy / restart 時のみ記録 |
| `~/logs/apollo-keeper.log` | keeper（cron `15,45`）の深い点検記録。light pass（健全・非日次）時はスキップ行、異常 / 日次巡回時に LLM 点検結果 |

```bash
tail -50 ~/logs/apollo-watchdog.log
tail -50 ~/logs/apollo-keeper.log
```

---

## 4. rotate（ログローテーション方針）

### journald（server 本体ログ）

`/etc/systemd/journald.conf` は `Storage=auto` のデフォルト設定で、journald が自動的に
ディスク使用量の上限（既定でファイルシステム空き容量に対する割合）を管理し、古いログから破棄します。
明示的にサイズを抑えたい場合は `SystemMaxUse` を設定します。

```bash
# 現在の journal ディスク使用量
journalctl --disk-usage

# 上限を明示（例: 500M に制限）したい場合
#   /etc/systemd/journald.conf の [Journal] に SystemMaxUse=500M を追記し
sudo systemctl restart systemd-journald

# 手動で古い分を即時整理（例: 7 日より古い分を削除 / 200M を超える分を削除）
sudo journalctl --vacuum-time=7d
sudo journalctl --vacuum-size=200M
```

### ~/logs/（watchdog / keeper のファイルログ）

`apollo-watchdog.log` / `apollo-keeper.log` は cron からの追記型です。watchdog は健全時に沈黙、
keeper は light pass 時 1 行と、いずれも書き込み頻度が低いため肥大化は緩やかですが、
無制限に伸びるのを防ぐため定期ローテーションを推奨します（現状 logrotate 設定は未導入）。

logrotate を導入する場合の例（`/etc/logrotate.d/apollo`）:

```
/home/dev/logs/apollo-*.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    copytruncate
}
```

`copytruncate` を使うのは、cron スクリプトがファイルを開きっぱなしにせず追記する運用に対し、
ローテート時の取りこぼしを避けるためです。

---

## 5. health（死活監視と自動復旧）

Apollo の死活は 3 段で守られています。

1. systemd `Restart=always`（プロセス死を即復活、`RestartSec=3`）
2. watchdog（cron `*/3`）— プロセスは生きているが応答しない「ハング」を検知して `systemctl restart`
3. keeper（cron `15,45`）— より深い点検（API 疎通・リソース・ログ異常・dist 陳腐化）

### ヘルスチェック

```bash
# 認証不要のヘルスエンドポイント。200 が返れば健全
curl -s -o /dev/null -w "healthz=%{http_code}\n" http://localhost:4317/api/healthz
```

### watchdog（cron `*/3`）

`~/cron-scripts/apollo-watchdog.sh`。`/api/healthz` を最大 3 回（各 5s timeout、2s 間隔）叩き、
1 回でも 200 なら健全、3 回連続で非 200 なら `systemctl restart` で復旧します。

- フラッピング防止: 直近の restart から COOLDOWN（既定 120s）以内は再起動しない
- kill-switch: `~/.apollo-watchdog.disabled` があれば何もしない（`touch` で一時停止）
- 対象 unit は環境変数 `APOLLO_UNIT` で上書き可。既定は `mission-control.service`

### keeper（cron `15,45`）

`~/cron-scripts/apollo-keeper.sh`。healthz=200 かつ非・日次巡回時は LLM を起動せず light pass で即終了
（トークン節約）。異常時 or 日次巡回時のみ深い点検を実行します。

- flock 排他: 前ティックが走行中なら skip
- kill-switch: `~/.apollo-keeper.disabled`
- 権限境界: `systemctl restart` / `web` の dist 再ビルド / ゾンビ掃除は自動。
  server / web のコード・設定修正が要る障害は実装担当に委譲＋台帳起票＋Keita 報告（自動でコードは書かない）

---

## 6. troubleshoot（トラブルシュート）

### ポート 4317 が競合する / bind に失敗する

ポート 4317 は 1 プロセスしか bind できません。systemd 版が動いている状態で
別途 `tsx src/index.ts` を生で起動すると、どちらかが bind 失敗します。

- **生 tsx 起動は禁止。** 起動・再起動は必ず systemctl 経由で行う
- 現在の bind プロセスを確認:

  ```bash
  ss -ltnp | grep 4317
  ```

- 生プロセスが居座っている場合は systemd 管理外なので個別に停止し、systemctl で正規に起動し直す

  ```bash
  sudo systemctl restart mission-control.service
  ```

### web（フロント）の変更が反映されない

web は `web/dist` の静的配信です。ソース変更は **ビルドしないと反映されません**（restart 不要）。

```bash
cd /home/dev/projects/cxo-agent/web && npm run build
```

ビルドすれば静的配信に即反映されます（server の再起動は不要）。

### server（バックエンド）の変更が反映されない

server は `tsx src/index.ts`（watch 無し）起動のため、**コード変更は自動リロードされません**。
restart して初めて反映されます。

```bash
sudo systemctl restart mission-control.service
# 反映確認
curl -s -o /dev/null -w "healthz=%{http_code}\n" http://localhost:4317/api/healthz
journalctl -u mission-control.service --no-pager -n 20
```

### 応答が無い / ハングしている

1. `systemctl status mission-control.service` で active か確認
2. `curl .../api/healthz` で 200 か確認
3. `journalctl -u mission-control.service -n 50` でクラッシュ兆候を確認
4. `tail -50 ~/logs/apollo-watchdog.log` で watchdog が restart を打っていないか（フラッピングしていないか）確認
5. 自動復旧を待っても直らない場合は `sudo systemctl restart mission-control.service`

restart / build をしたら、必ず healthz と主要 API の再疎通で復旧を確認します。
直らなければ Keita にエスカレーションします。

---

## 7. トンネル（スマホアクセス）

外出先のスマホや外部ネットワークから Apollo にアクセスしたい場合、cloudflared の quick tunnel を使います。

### quick tunnel の起動

```bash
bash /home/dev/projects/cxo-agent/deploy/apollo-tunnel.sh
```

起動すると以下のように URL が表示されます:

```
Tunnel URL : https://xxxx-xxxx.trycloudflare.com
Mobile URL : https://xxxx-xxxx.trycloudflare.com/?token=<MC_TOKEN>
```

- `Mobile URL` をスマホのブラウザで開けばそのまま認証済み状態でアクセスできます
- トークン値は `.mc.env` の `MC_TOKEN` から自動取得します（スクリプト内にハードコードしていません）

### mobile URL の形式

```
https://xxxx-xxxx.trycloudflare.com/?token=<MC_TOKEN>
```

このリンクをスマホに送ってタップすると、Cookie が発行されて以降の操作ではトークン入力不要です。

### 停止方法

```bash
# --stop オプションで停止
bash /home/dev/projects/cxo-agent/deploy/apollo-tunnel.sh --stop

# または PID ファイルを使って直接 kill
kill $(cat /tmp/apollo-tunnel.pid)
```

### 注意事項

- quick tunnel の URL（`*.trycloudflare.com`）は毎回起動するたびに変わります
- 安定した固定ドメイン（例: `apollo.keita.dev`）で使いたい場合は、Cloudflare アカウントでの認証と名前付きトンネルの設定が必要です。これには Keita の Cloudflare アカウントへのログインが必要です（現在は未ログイン状態のため quick tunnel のみ利用可能）
- cloudflared は `/usr/local/bin/cloudflared` にインストール済みです
- tunnel ログは `/tmp/apollo-tunnel.log` に出力されます
