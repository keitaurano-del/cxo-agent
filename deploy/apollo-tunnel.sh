#!/usr/bin/env bash
set -euo pipefail

LOG=/tmp/apollo-tunnel.log
PID_FILE=/tmp/apollo-tunnel.pid

# --stop オプション処理
if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Stopping tunnel (pid $(cat "$PID_FILE"))..."
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "Stopped."
  else
    echo "No running tunnel found."
    rm -f "$PID_FILE" 2>/dev/null || true
  fi
  exit 0
fi

# 既存プロセス確認
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "WARNING: cloudflared tunnel already running (pid $(cat "$PID_FILE"))"
  echo "Use --stop to stop it first, or: kill \$(cat $PID_FILE)"
  exit 1
fi

# MC_TOKEN 取得（ハードコードしない。.mc.env から読む）
TOKEN=$(grep MC_TOKEN /home/dev/projects/cxo-agent/.mc.env 2>/dev/null \
  | cut -d= -f2 \
  | tr -d '"' \
  | tr -d "'" \
  | tr -d ' ') || true

# ログファイル初期化
: > "$LOG"

echo "Starting cloudflared quick tunnel for Apollo (:4317)..."

# バックグラウンド起動
/usr/local/bin/cloudflared tunnel --url http://localhost:4317 >"$LOG" 2>&1 &
echo $! > "$PID_FILE"

echo "cloudflared started (pid $(cat "$PID_FILE")), waiting for URL..."

# URL が取れるまで最大 20 秒待機（0.5秒 x 40回）
URL=""
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1 || true)
  if [ -n "$URL" ]; then
    break
  fi
  sleep 0.5
done

if [ -z "$URL" ]; then
  echo "ERROR: could not get tunnel URL within 20 seconds." >&2
  echo "Log output:" >&2
  cat "$LOG" >&2
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
  exit 1
fi

echo ""
echo "============================================"
echo "Tunnel URL : $URL"
if [ -n "$TOKEN" ]; then
  echo "Mobile URL : ${URL}/?token=${TOKEN}"
else
  echo "Mobile URL : (MC_TOKEN not found in .mc.env)"
fi
echo "============================================"
echo ""
echo "To stop: bash $(realpath "$0") --stop"
echo "     or: kill \$(cat $PID_FILE)"
echo "Log    : $LOG"
