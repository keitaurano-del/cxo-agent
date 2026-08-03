#!/bin/bash
# autonomous-loop.sh — 自律ワーカーを「キューが空 or ブレーキ条件」まで連続稼働させるループ。
# 2026-06-07 Keita 承認 req-eb9554cc「実装高速化：自律ワーカー連続稼働化（5〜6倍）＋上限ガード」。
#
# 従来: cron */N が autonomous-worker.sh を1回呼ぶ＝1タスクで終了→次の cron まで約25分アイドル（稼働率13%）。
# 本ループ: 1起動で autonomous-worker.sh を繰り返し呼び、着手可能が無くなるまで連続処理する（稼働率↑）。
# ワーカー本体(autonomous-worker.sh)は無改変。各イテレーションでワーカーが台帳を再読し1タスク前進する。
#
# ブレーキ（全て env で上書き可）:
#   MAX_ITERS=12        1起動あたり最大処理タスク数（runaway 防止）
#   STOP_HOUR=23        この時刻(時)以降は新規イテレーションしない（深夜停止）
#   USAGE_STOP_PCT=92   週次使用量がこの% を超えたら停止（トークン暴走防止）
#   SLEEP_BETWEEN=5     イテレーション間スリープ秒
#   kill-switch: ~/.autonomous-rin.disabled（全体）/ ~/.autonomous-<scope>.disabled（当該）で即停止。
#
# 使い方: PROJECT_SCOPE=cxo bash autonomous-loop.sh  /  bash autonomous-loop.sh logic

set -uo pipefail
TS() { date "+%Y-%m-%d %H:%M:%S %Z"; }

SCOPE="${PROJECT_SCOPE:-${1:-logic}}"
case "$SCOPE" in
  cxo|cxo-agent|apollo) SCOPE=cxo ;;
  en-chakai|enchakai|chakai) SCOPE=en-chakai ;;
  *) SCOPE=logic ;;
esac

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$SCOPE" in
  cxo)       TRACKER="/home/dev/projects/cxo-agent/docs/TASK_TRACKER.md" ;;
  en-chakai) TRACKER="/home/dev/projects/en-chakai/docs/TASK_TRACKER.md" ;;
  *)         TRACKER="/home/dev/projects/logic/docs/TASK_TRACKER.md" ;;
esac

MAX_ITERS="${MAX_ITERS:-12}"
STOP_HOUR="${STOP_HOUR:-23}"
USAGE_STOP_PCT="${USAGE_STOP_PCT:-92}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-5}"

GLOBAL_KS="$HOME/.autonomous-rin.disabled"
SCOPE_KS="$HOME/.autonomous-${SCOPE}.disabled"

# 外側ロック: 1スコープにつきループは1本だけ（cron 再発火が重複起動しないように）。
# ワーカー内側ロック(/tmp/autonomous-<scope>.lock)とは別ファイル。
exec 8>"/tmp/autonomous-loop-${SCOPE}.lock"
if ! flock -n 8; then
  echo "[$(TS)] [loop:$SCOPE] another loop already running — skip"
  exit 0
fi

# 週次使用量が閾値超なら true(0)。取得不可・解析不可は false(1)=止めない（fail-open）。
usage_over() {
  local mc pct
  mc="$(grep '^MC_TOKEN=' /home/dev/projects/cxo-agent/.mc.env 2>/dev/null | cut -d= -f2- | tr -d '"'\''' | xargs)"
  [ -z "$mc" ] && return 1
  pct="$(curl -s -m 6 "http://localhost:4317/api/claude-usage" -H "Cookie: mc_token=$mc" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  vals=[a.get('weekAllPct') or 0 for a in d.get('accounts',[]) if isinstance(a,dict)]
  print(int(max(vals)) if vals else -1)
except Exception:
  print(-1)" 2>/dev/null)"
  [ -z "$pct" ] && return 1
  case "$pct" in (''|*[!0-9-]*) return 1 ;; esac
  [ "$pct" -lt 0 ] && return 1
  [ "$pct" -ge "$USAGE_STOP_PCT" ] && return 0
  return 1
}

echo "[$(TS)] [loop:$SCOPE] start (max=$MAX_ITERS, stopHour=$STOP_HOUR, usageStop=${USAGE_STOP_PCT}%)"
i=0
while [ "$i" -lt "$MAX_ITERS" ]; do
  if [ -f "$GLOBAL_KS" ] || [ -f "$SCOPE_KS" ]; then
    echo "[$(TS)] [loop:$SCOPE] kill-switch present — stop"; break
  fi
  hr="$(date +%H)"
  if [ "$hr" -ge "$STOP_HOUR" ] 2>/dev/null; then
    echo "[$(TS)] [loop:$SCOPE] past stop hour ($hr >= $STOP_HOUR) — stop"; break
  fi
  if usage_over; then
    echo "[$(TS)] [loop:$SCOPE] weekly usage >= ${USAGE_STOP_PCT}% — stop (token brake)"; break
  fi
  ac="$(grep -cE "\| (TODO|IN_PROGRESS|REVIEW)\b" "$TRACKER" 2>/dev/null || echo 0)"
  if [ "$ac" -eq 0 ]; then
    echo "[$(TS)] [loop:$SCOPE] queue drained (0 actionable) — stop"; break
  fi
  # 1タスク前進（ワーカーは内側 flock + MC-88/107 ガード持ち）。
  # push/deploy ゲート: 全スコープ NO_PUSH=1＝ワーカーは実装→green→ローカル commit まで。
  # git push / 本番 deploy / restart は「Masayoshi 検証OK」を必須ゲートにして手動実行する
  # （Keita 2026-06-07「1で」＝自律林の自己承認だけでは push しない）。
  env PROJECT_SCOPE="$SCOPE" NO_PUSH=1 bash "$DIR/autonomous-worker.sh" || echo "[$(TS)] [loop:$SCOPE] worker non-zero (continue)"
  i=$((i + 1))
  sleep "$SLEEP_BETWEEN"
done
echo "[$(TS)] [loop:$SCOPE] done after $i iteration(s)"
exit 0
