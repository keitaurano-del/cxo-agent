#!/bin/bash
# agent-worker.sh <agent_id> <agent_name> <emoji> <type> <task_text> <msg_id>
# 指定されたエージェントをタスクと共に起動し、結果をApolloチャットに投稿する
set -uo pipefail

AGENT_ID="${1:-}"
AGENT_NAME="${2:-}"
AGENT_EMOJI="${3:-}"
AGENT_TYPE="${4:-type=claude}"  # type=claude or type=openclaw
TASK_TEXT="${5:-}"
MSG_ID="${6:-}"

[ -z "$AGENT_ID" ] && exit 1

AGENT_TOKEN=$(grep '^AGENT_TOKEN=' "$HOME/projects/cxo-agent/.mc.env" 2>/dev/null | cut -d= -f2-)
APOLLO="http://localhost:4317/api/chat/agent-message"
DATE=$(date +%Y-%m-%d)

post_chat() {
  local ch="${1:-dev}" msg="$2"
  curl -s -X POST "$APOLLO" -H "Content-Type: application/json" \
    -d "{\"token\":\"$AGENT_TOKEN\",\"channelId\":\"$ch\",\"senderId\":\"$AGENT_ID\",\"senderName\":\"$AGENT_NAME\",\"senderEmoji\":\"$AGENT_EMOJI\",\"text\":$(printf '%s' "$msg" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}" \
    > /dev/null 2>&1
}

echo "[$(date)] agent-worker: $AGENT_ID starting for task: ${TASK_TEXT:0:80}"

# 着手通知
post_chat "dev" "了解です。作業を開始します。

タスク: ${TASK_TEXT:0:200}"

# ── エージェントタイプ別の実行 ──────────────────────────
if echo "$AGENT_TYPE" | grep -q "type=openclaw"; then
  # OpenClaw エージェント（ユイ・ハル）
  OPENCLAW_ID="$AGENT_ID"
  RESPONSE=$(openclaw agent --agent "$OPENCLAW_ID" \
    --model anthropic/claude-haiku-4-5-20251001 \
    --session-key "agent:${OPENCLAW_ID}:dispatch-${DATE}" \
    -m "$TASK_TEXT" \
    --json 2>/dev/null \
    | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get('meta',{}).get('finalAssistantVisibleText') or (d.get('payloads') or [{}])[-1].get('text',''))
except: print('')
" 2>/dev/null || echo "")

else
  # Claude Code エージェント（レン・ソラ・ケン・アオイ・ナオ）— subagent定義ファイルを参照
  AGENT_DEF=""
  case "$AGENT_ID" in
    ren)  AGENT_DEF="$HOME/.claude/projects-meta/agents/dev-logic.md" ;;
    sora) AGENT_DEF="$HOME/.claude/projects-meta/agents/dev-apollo.md" ;;
    ken)  AGENT_DEF="$HOME/.claude/projects-meta/agents/test-functional.md" ;;
    aoi)  AGENT_DEF="$HOME/.claude/projects-meta/agents/designer.md" ;;
    nao)  AGENT_DEF="$HOME/.claude/projects-meta/agents/content-creator.md" ;;
  esac

  SYSTEM_PROMPT=""
  if [ -f "$AGENT_DEF" ]; then
    SYSTEM_PROMPT=$(cat "$AGENT_DEF")
  fi

  FULL_PROMPT="${SYSTEM_PROMPT}

---

タスク（チャットからのメンション）:
${TASK_TEXT}

作業完了後、結果を簡潔にまとめて返してください。"

  RESPONSE=$(claude -p \
    --model claude-haiku-4-5-20251001 \
    --allowedTools "Read,Write,Edit,Bash,Glob,Grep,WebSearch" \
    --max-turns 15 \
    "$FULL_PROMPT" 2>/dev/null | tail -100 || echo "")
fi

# ── 結果をチャットに投稿 ──────────────────────────────
if [ -n "$RESPONSE" ]; then
  # 長すぎる場合は切り詰め
  SHORT_RESPONSE=$(echo "$RESPONSE" | head -50 | cut -c1-2000)
  post_chat "dev" "作業完了です。

${SHORT_RESPONSE}

$([ ${#RESPONSE} -gt 2000 ] && echo '（詳細はログを確認してください）' || echo '')"
else
  post_chat "dev" "作業を完了しましたが、出力が空でした。ログを確認してください。"
fi

echo "[$(date)] agent-worker: $AGENT_ID done"
