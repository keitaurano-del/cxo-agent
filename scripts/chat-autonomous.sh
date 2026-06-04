#!/bin/bash
# chat-autonomous.sh — チャット AI の autonomous-tick を定期実行するクーロンスクリプト。
#
# 20分ごとに Apollo の /api/chat/autonomous-tick エンドポイントを叩き、
# チャット AI の自律処理を駆動する。
#
# cron: */20 * * * * TZ=Asia/Tokyo /home/dev/cron-scripts/chat-autonomous.sh
#
# ガードレール:
#   - flock /tmp/chat-autonomous.lock（走行中の前ティックがあればスキップ）
#   - AGENT_TOKEN 未取得なら ERROR ログして終了
#   - healthz エンドポイントで死活確認（失敗したらスキップ）

set -euo pipefail

LOCK="/tmp/chat-autonomous.lock"
LOG="${HOME}/logs/chat-autonomous.log"
APOLLO_URL="http://localhost:4317"

TS() { date "+%Y-%m-%d %H:%M:%S %Z"; }

# ログディレクトリ作成
mkdir -p "$(dirname "$LOG")"

# 排他ロック（走行中の前ティックがあれば即スキップ）
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(TS)] previous tick still running ($LOCK) — skip" >> "$LOG"
  exit 0
fi

# .mc.env から AGENT_TOKEN を取得
MC_ENV="/home/dev/projects/cxo-agent/.mc.env"
AGENT_TOKEN=""
if [ -f "$MC_ENV" ]; then
  AGENT_TOKEN="$(grep '^AGENT_TOKEN=' "$MC_ENV" | cut -d'=' -f2- | tr -d '"' | tr -d "'" | xargs)"
fi

if [ -z "$AGENT_TOKEN" ]; then
  echo "[$(TS)] ERROR: AGENT_TOKEN is empty (check $MC_ENV)" >> "$LOG"
  exit 1
fi

# 死活確認
if ! curl -sf -m 10 "${APOLLO_URL}/api/healthz" > /dev/null 2>&1; then
  echo "[$(TS)] healthz failed (${APOLLO_URL}/api/healthz) — skip" >> "$LOG"
  exit 0
fi

echo "[$(TS)] autonomous-tick start" >> "$LOG"

# autonomous-tick を叩く
RESULT="$(curl -s -m 300 -X POST "${APOLLO_URL}/api/chat/autonomous-tick" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  2>&1)"
CURL_EXIT=$?

if [ "$CURL_EXIT" -ne 0 ]; then
  echo "[$(TS)] autonomous-tick curl error (exit=${CURL_EXIT}): ${RESULT}" >> "$LOG"
else
  echo "[$(TS)] autonomous-tick done: ${RESULT}" >> "$LOG"
fi

exit 0
