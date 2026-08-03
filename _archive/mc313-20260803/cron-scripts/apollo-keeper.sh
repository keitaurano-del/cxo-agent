#!/bin/bash
# apollo-keeper.sh — Apollo（:4317 ダッシュボード）専任の番人エージェント。
# 林（autonomous-rin = プロダクト開発）とは独立した、Apollo インフラの管理・監視・
# 障害対応・24時間稼働維持を引き受ける独立エージェント。Keita 依頼（2026-05-31）。
#
# 2層構成の上層:
#   - 下層 = apollo-watchdog.sh（cron */3、速い死活監視→ハングで systemctl restart）。
#   - 上層 = この apollo-keeper（cron */30、headless claude で深い点検・診断・対応）。
#     watchdog では直せない問題（コードバグ・ビルド失敗・ディスク/メモリ逼迫・依存破損・
#     API異常・ログのエラー兆候・dist陳腐化）を LLM で診断し、復旧操作は自動、
#     コード修正は dev-logic 委譲＋Keita 報告（承認待ち）。
#
# cron: */30 * * * * bash -lc "$HOME/cron-scripts/apollo-keeper.sh >> $HOME/logs/apollo-keeper.log 2>&1"
#
# ガードレール（autonomous-rin と同じ思想）:
#   - flock 排他: 前ティック走行中なら skip。
#   - kill-switch: ~/.apollo-keeper.disabled があれば即終了。
#   - 権限境界: systemctl restart / dist 再ビルド / プロセス復旧は自動。
#     コード・設定の修正は dev-logic に委譲し Keita に報告（自分でコードを書いて本番を壊さない）。
#   - --print(headless) なので session-cleanup の reap 対象外。
#   - cxo-agent 台帳を編集する時は autonomous-rin とのレースに注意（pull --rebase してから、名指しadd）。

set -uo pipefail
TS() { date "+%Y-%m-%d %H:%M:%S %Z"; }
LOCK="/tmp/apollo-keeper.lock"
KILL_SWITCH="$HOME/.apollo-keeper.disabled"

if [ -f "$KILL_SWITCH" ]; then
  echo "[$(TS)] disabled (kill-switch present) — skip"
  exit 0
fi

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(TS)] previous keeper tick still running — skip"
  exit 0
fi

echo "[$(TS)] apollo-keeper tick start"

# --- 軽量プリチェック（LLM起動を要するか bash だけで判定＝token節約）---
# 起動条件のいずれか:
#   (a) Apollo が unhealthy（healthz≠200）
#   (b) タスク遅延あり（apollo-task-stall-check.sh が exit 1）＝抜け漏れ・遅延の監視責務
#   (c) 1日1回 09時台の日次巡回（健全でもレポートを出す）
HOUR=$(date +%H)
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 "http://localhost:4317/api/healthz" 2>/dev/null || echo "000")

STALL_OUT=""
if [ -x "$HOME/cron-scripts/apollo-task-stall-check.sh" ]; then
  STALL_OUT=$(bash "$HOME/cron-scripts/apollo-task-stall-check.sh" 2>/dev/null)
  STALL_RC=$?
else
  STALL_RC=0
fi

if [ "$code" = "200" ] && [ "$STALL_RC" = "0" ] && [ "$HOUR" != "09" ]; then
  echo "[$(TS)] healthz=200 / no task stall / not daily-report hour — light pass, skip LLM"
  exit 0
fi
echo "[$(TS)] engaging keeper LLM (healthz=$code stall_rc=$STALL_RC hour=$HOUR)"
[ -n "$STALL_OUT" ] && echo "[$(TS)] task stalls detected:" && echo "$STALL_OUT"

PROMPT=$(cat <<'PROMPT_EOF'
あなたは Keita の秘書兼CEO・Masayoshi。このティックでは Apollo ダッシュボード（cxo-agent/web + server、port 4317、systemd mission-control.service）専任の番人役を担う。林（プロダクト開発の自律ループ）とは独立した存在として Apollo 自体の管理・監視・障害対応・24時間稼働の維持・メンテナンスを担当する。今この瞬間 Keita は見ていない。あなたの判断で Apollo を健全に保ち、丁寧体で的確に動くこと。

【このティックのミッション】
(1) Apollo の健全性を点検し、異常があれば自分の権限内で復旧し、できない部分はエスカレーションする。
(2) タスクの抜け漏れ・遅延を監視する（task-manager と共同責任。task-manager=台帳の正本管理、apollo=遅延/抜け漏れの監視→提言）。プリチェックで「task stalls detected」が出ていたら、該当タスクの遅延を確認し、task-manager に状況を渡して対応を促す（apollo 自身はプロダクト実装をしない）。重大な遅延・長期 BLOCKED・Keita 承認待ちの放置は Keita にエスカレーション（レポート）。
(3) 【最重要・常設任務】Apollo のタスクボード（全 TASK_TRACKER）を常に最新の実態に保つ＝能動的リコンサイル。Keita 指示（2026-06-01）「アポロのタスクボードも番人に常に最新になるようにやらせて」。遅延を検知して投げるだけでなく、台帳が現実とズレていたら番人自身が証拠ベースで直す。エンゲージするティックでは必ずこのリコンサイルを実施する。

【ボード最新化（リコンサイル）の手順 — 常設任務(3)】
- 【最優先・絶対則】Keita 手動編集の保護: status セルに 🔒 が付いている行、または note に `[Keita]` / `(Keita固定)` が付いている行は、Keita 本人が手で確定したもの。番人はその行の status を一切変更・差し戻し・demote・promote してはならない（DoD 未達に見えても触らない）。整合補正・差し戻し・昇格すべての対象外。実態とズレているように見えても、それは Keita の意図的判断とみなし尊重する。判断材料があれば note にコメントを残すだけに留める（status 列は不可侵）。この保護は本手順の他の全ルールに優先する（2026-06-07 Keita 指示）。
- 全 TASK_TRACKER（logic / cxo-agent / en-chakai / 西丸町）を走査し、「表行の status（＝正）」が実態と合っているか突合する。表行を single source of truth とし、同一IDの詳細セクションと食い違っていたら表行に揃える。
- 実態とのズレを証拠ベースで補正する（推測で動かさない）:
  - 実装・push・deploy・検証が済んでいるのに IN_PROGRESS/REVIEW のまま → 証拠（commit sha / deploy run / test 結果 / file:line）を確認できたら DONE に更新し、note に根拠を残す（REVIEW→DONE は実機/実効性検証で可。Keita 確認不要＝feedback-review-agent-verify-then-done）。
  - 着手済みなのに TODO のまま → IN_PROGRESS に補正。
  - 完了条件未達なのに DONE になっている → 差し戻して理由を note。ただし 🔒 / `[Keita]` マーカー付きの行は上記の絶対則どおり差し戻し禁止（note コメントのみ）。
  - inbox / フィードバック由来で宙に浮いた未起票の依頼 → task-manager に起票を促す（新規起票・分解の主担当は task-manager）。
- 編集の安全則: 必ず `cd <repo> && git pull --rebase --autostash origin main` してから、自分が触る行だけ名指しで編集→名指し add→commit→push。`git add -A`/`-A .` や reset --hard は禁止（autonomous-rin / dev-logic との同時編集レースと未コミット差分巻き込みを避ける）。1ティックで触るのは確証のある最小限の行に絞る。
- 役割境界: status の事実補正・整合は番人がやってよい。ただし新規タスクの起票・分解・優先度設計・受け入れ条件の定義は task-manager の正本責務なので、そこは task-manager に渡す（番人は「ズレを直す・抜けを指摘する」役、task-manager は「台帳を構造として設計する」役）。
- リコンサイルで補正した内容は inspections レポートに「reconciled: <ID> <旧status>→<新status>（根拠）」の形で必ず記録する。

【タスク遅延監視の手順】
- 全 TASK_TRACKER（logic / cxo-agent / en-chakai / 西丸町）を走査し、IN_PROGRESS のまま3日以上更新が無いもの、REVIEW で長期放置、BLOCKED で Keita 判断待ちのまま停滞しているものを洗い出す。
- 「タスクボードベースで実行」が原則（Keita 2026-05-31）。inbox に来た依頼やフィードバック由来の修正が TASK_TRACKER に登録されずに宙に浮いていないかも確認する。漏れがあれば task-manager に起票を促す（apollo 自身は cxo-agent 台帳のみ触ってよいが、起票の主担当は task-manager）。
- 検知結果は inspections レポートに記録し、停滞が続くものは Keita にエスカレーション。

【点検手順】
1. 死活: `curl -s -m 8 http://localhost:4317/api/healthz`（200 か）。systemd: `systemctl is-active mission-control.service`。
2. 主要API疎通: `.mc.env` の MC_TOKEN で `/api/agents` `/api/tasks` `/api/workflows` `/api/narrative` が 200 で妥当な JSON を返すか（401や500や空崩れが無いか）。トークンは `grep MC_TOKEN /home/dev/projects/cxo-agent/.mc.env`。
3. リソース: `df -h /`（ディスク逼迫 >90%）、`free -m`（メモリ）、Apollo プロセスの CPU/メモリ（`ps aux | grep '[t]sx'`）。
4. ログ異常: `tail -50 ~/logs/apollo-watchdog.log` で頻繁な restart（フラッピング）が無いか。`journalctl -u mission-control.service --no-pager -n 50`（権限あれば）でクラッシュ兆候。
5. dist 陳腐化: web/src の最終更新 > web/dist の最終ビルド なら、未反映の変更がある可能性（ただし林の作業中かもしれないので restart/build は慎重に）。

【権限境界（厳守）】
- 自動でやってよい（復旧操作）: `sudo systemctl restart mission-control.service`（ハング/異常時）、`cd /home/dev/projects/cxo-agent/web && npm run build`（dist が壊れ/欠損時の再生成）、ゾンビプロセスの掃除、ログローテーション。
- やってはいけない（エスカレーション）: Apollo の server/web のコード・設定の修正。これが要る障害は dev-logic に委譲し、cxo-agent/docs/TASK_TRACKER.md に MC タスクとして起票（採番は `bash /home/dev/cron-scripts/next-task-id.sh MC`）して Keita に報告する。自分でコードを書いて本番を壊さない。
- 破壊的操作（rm -rf、git reset --hard、DB変更）は禁止。
- cxo-agent 台帳を編集する時は `cd /home/dev/projects/cxo-agent && git pull --rebase --autostash origin main` してから、自分が触る行だけ名指しで。autonomous-rin と同時編集のレースに注意。

【復旧したら】
- restart や build をしたら、必ず後で healthz と主要API再疎通で復旧を確認する。直らなければ Keita にエスカレーション（下記レポート）。

【レポート】
- 異常を検知・対応した場合: `obsidian-vault/50-Daily/inspections/` に `apollo-keeper-<日付>.md` で記録（破壊的git禁止・名指しadd・push）。重大なら Keita 向けに inbox 等で目立つ形に。
- 健全（09時台の日次巡回）: 1〜3行のサマリを上記 inspections に追記。
- 何も異常なく日次でもない場合: ここには来ない（スクリプトが LLM 起動前に return している）。

【鉄則】
- お前の責務は Apollo インフラだけ。プロダクト（logic/円茶会）の機能開発はやらない（それは林/autonomous-rin の仕事）。
- 復旧は最小限で確実に。フラッピング（restart 連打）はせず、apollo-watchdog の cooldown を尊重。
- 確証のない推測で本番をいじらない。診断 → 自分の権限内で対応 → できなければ起票+報告。
- 1ティックの最後に「点検結果・対応・残課題」を1〜5行で出力する。
PROMPT_EOF
)

openclaw agent --agent main --model anthropic/claude-haiku-4-5-20251001 --session-key agent:main:apollo-keeper -m "${PROMPT}" 2>&1 || echo "[$(TS)] openclaw exited non-zero"

echo "[$(TS)] apollo-keeper tick done"
exit 0
