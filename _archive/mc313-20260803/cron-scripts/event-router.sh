#!/bin/bash
# event-router.sh — イベント検知 → Apollo #dev にルーティングメッセージ投稿
# 5分おきに実行。以下のイベントを検知する:
#   - git: 新規コミット（logic / en-chakai）
#   - CI: ビルド失敗
#   - TASK_TRACKER: 新規 TODO 追加
#   - KPI: 異常値（課金・アラート）
set -uo pipefail

STATE="$HOME/.event-router-state.json"
AGENT_TOKEN=$(grep '^AGENT_TOKEN=' "$HOME/projects/cxo-agent/.mc.env" 2>/dev/null | cut -d= -f2-)
MC_TOKEN=$(grep '^MC_TOKEN=' "$HOME/projects/cxo-agent/.mc.env" 2>/dev/null | cut -d= -f2-)
APOLLO="http://localhost:4317/api/chat/agent-message"

post_dev() {
  local sender="$1" name="$2" emoji="$3" msg="$4"
  curl -s -X POST "$APOLLO" -H "Content-Type: application/json" \
    -d "{\"token\":\"$AGENT_TOKEN\",\"channelId\":\"dev\",\"senderId\":\"$sender\",\"senderName\":\"$name\",\"senderEmoji\":\"$emoji\",\"text\":$(printf '%s' "$msg" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}" \
    > /dev/null 2>&1
}

# プッシュ通知を送る（OpenClaw PushNotification tool 経由）
push_notify() {
  local msg="$1"
  openclaw agent --agent main \
    --model anthropic/claude-haiku-4-5-20251001 \
    --session-key "agent:main:push-$(date +%s)" \
    -m "以下のメッセージでPushNotificationを送ってください（status: proactive）: ${msg}" \
    > /dev/null 2>&1 &
}

# ── 状態ファイル読み込み ──────────────────────────────
if [ ! -f "$STATE" ]; then
  echo '{}' > "$STATE"
fi
STATE_DATA=$(cat "$STATE")
get_state() { echo "$STATE_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',''))" 2>/dev/null || echo ""; }
set_state() {
  local key="$1" val="$2"
  STATE_DATA=$(echo "$STATE_DATA" | python3 -c "
import sys,json
d=json.load(sys.stdin)
d['$key']='$val'
print(json.dumps(d))
" 2>/dev/null || echo "$STATE_DATA")
}
save_state() { echo "$STATE_DATA" > "$STATE"; }

# ── 1. git 新規コミット検知 ───────────────────────────
for repo in logic en-chakai; do
  REPO_PATH="$HOME/projects/$repo"
  [ -d "$REPO_PATH/.git" ] || continue

  LATEST=$(git -C "$REPO_PATH" log --oneline -1 2>/dev/null | awk '{print $1}')
  LAST=$(get_state "git_${repo}")

  if [ -n "$LATEST" ] && [ "$LATEST" != "$LAST" ] && [ -n "$LAST" ]; then
    # 新しいコミットあり
    COMMITS=$(git -C "$REPO_PATH" log --oneline "${LAST}..HEAD" 2>/dev/null | head -5)
    MSG="📦 \`$repo\` に新しいコミットがあります。

$COMMITS

@レン コードを確認して問題があれば報告してください。"
    post_dev "router" "イベントルーター" "⚡" "$MSG"
    echo "[$(date)] git event: $repo $LAST -> $LATEST"
  fi
  [ -n "$LATEST" ] && set_state "git_${repo}" "$LATEST"
done

# ── 2. CI 失敗検知（GitHub public API）──────────────────
for repo in logic en-chakai; do
  CI_DATA=$(curl -s "https://api.github.com/repos/keitaurano-del/${repo}/actions/runs?per_page=1" 2>/dev/null || echo "")
  [ -z "$CI_DATA" ] && continue

  CI_STATUS=$(echo "$CI_DATA" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  r=d['workflow_runs'][0]
  print(r.get('conclusion') or r.get('status',''))
except: print('')
" 2>/dev/null || echo "")
  CI_SHA=$(echo "$CI_DATA" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  print(d['workflow_runs'][0]['head_sha'][:8])
except: print('')
" 2>/dev/null || echo "")

  LAST_CI=$(get_state "ci_${repo}")

  if [ "$CI_STATUS" = "failure" ] && [ "$CI_SHA" != "$LAST_CI" ]; then
    MSG="🔴 \`$repo\` のCIが失敗しました（commit: $CI_SHA）

@ケン 原因を調査して修正方針をここに報告してください。"
    post_dev "router" "イベントルーター" "⚡" "$MSG"
    push_notify "🔴 CI失敗: $repo ($CI_SHA) ケンが調査中"
    echo "[$(date)] CI failure: $repo $CI_SHA"
    set_state "ci_${repo}" "$CI_SHA"
  elif [ "$CI_STATUS" = "success" ]; then
    set_state "ci_${repo}" "$CI_SHA"
  fi
done

# ── 3. TASK_TRACKER 新規 TODO 検知 ──────────────────────
for repo in logic en-chakai cxo-agent; do
  TT="$HOME/projects/$repo/docs/TASK_TRACKER.md"
  [ -f "$TT" ] || continue

  TODO_COUNT=$(grep -c '^\| TODO \|' "$TT" 2>/dev/null || echo "0")
  LAST_COUNT=$(get_state "todo_${repo}")

  if [ -n "$LAST_COUNT" ] && [ "$TODO_COUNT" -gt "${LAST_COUNT:-0}" ]; then
    NEW=$((TODO_COUNT - LAST_COUNT))
    MSG="📋 \`$repo\` のTASK_TRACKERに新しいTODOが${NEW}件追加されました。

@ユイ タスクを確認してアサイン・優先度を整理してください。"
    post_dev "router" "イベントルーター" "⚡" "$MSG"
    echo "[$(date)] new TODO: $repo +$NEW"
  fi
  set_state "todo_${repo}" "$TODO_COUNT"
done

# ── 4. KPI 異常検知 ──────────────────────────────────
SUPABASE_URL="https://yctlelmlwjwlcpcxvmgx.supabase.co"
SVC=$(cat "$HOME/.supabase_service_key" 2>/dev/null || echo "")
if [ -n "$SVC" ]; then
  CR=$(curl -s -D - -o /dev/null \
    "${SUPABASE_URL}/rest/v1/subscriptions?status=eq.active&select=id" \
    -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H "Prefer: count=exact" 2>/dev/null \
    | grep -i "content-range" | tr -d '\r')
  SUBS="${CR##*/}"
  LAST_SUBS=$(get_state "subs_count")

  if [ -n "$LAST_SUBS" ] && [ -n "$SUBS" ] && [ "$SUBS" -lt "$((LAST_SUBS - 2))" ] 2>/dev/null; then
    MSG="⚠️ 課金ユーザー数が急減しています。

前回: ${LAST_SUBS}件 → 現在: ${SUBS}件

@ハル 詳細を調査して報告してください。"
    post_dev "router" "イベントルーター" "⚡" "$MSG"
    push_notify "⚠️ 課金急減: ${LAST_SUBS}→${SUBS}件 ハルが調査中"
    echo "[$(date)] KPI alert: subs $LAST_SUBS -> $SUBS"
  fi
  [ -n "$SUBS" ] && set_state "subs_count" "$SUBS"
fi

# ── 5. Apollo アクティブアラート検知 ────────────────────
if [ -n "$MC_TOKEN" ]; then
  ALERT_COUNT=$(curl -s "http://localhost:4317/api/alerts" \
    -H "Authorization: Bearer $MC_TOKEN" 2>/dev/null \
    | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  print(len([a for a in d.get('alerts',[]) if a.get('status')=='active']))
except: print(0)
" 2>/dev/null || echo "0")
  LAST_ALERTS=$(get_state "alert_count")

  if [ -n "$LAST_ALERTS" ] && [ "$ALERT_COUNT" -gt "${LAST_ALERTS:-0}" ] 2>/dev/null; then
    NEW_ALERTS=$((ALERT_COUNT - LAST_ALERTS))
    MSG="🚨 Apolloに新しいアラートが${NEW_ALERTS}件発生しました。

@ハル アラートの内容を確認して報告してください。"
    post_dev "router" "イベントルーター" "⚡" "$MSG"
    echo "[$(date)] new alerts: +$NEW_ALERTS"
  fi
  set_state "alert_count" "$ALERT_COUNT"
fi

save_state
echo "[$(date)] event-router done"
