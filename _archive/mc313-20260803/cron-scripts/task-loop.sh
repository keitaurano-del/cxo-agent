#!/bin/bash
# task-loop.sh — タスクボード自律処理ループ
# 30分おきに実行。ユイがTODOを確認し、各エージェントに割り当てる。
# レン・ケンはIN_PROGRESSの自分のタスクを拾って着手報告する。
set -uo pipefail

AGENT_TOKEN=$(grep '^AGENT_TOKEN=' "$HOME/projects/cxo-agent/.mc.env" 2>/dev/null | cut -d= -f2-)
APOLLO="http://localhost:4317/api/chat/agent-message"
DATE=$(date +%Y-%m-%d)
STATE="$HOME/.task-loop-state.json"

post_chat() {
  local ch="$1" sid="$2" name="$3" emoji="$4" msg="$5"
  curl -s -X POST "$APOLLO" -H "Content-Type: application/json" \
    -d "{\"token\":\"$AGENT_TOKEN\",\"channelId\":\"$ch\",\"senderId\":\"$sid\",\"senderName\":\"$name\",\"senderEmoji\":\"$emoji\",\"text\":$(printf '%s' "$msg" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}" \
    > /dev/null 2>&1
}

[ -f "$STATE" ] || echo '{}' > "$STATE"

echo "[$(date)] task-loop start"

# ── ユイ: TASK_TRACKER の TODO を確認してアサイン提案 ──
for repo in logic en-chakai cxo-agent; do
  TT="$HOME/projects/$repo/docs/TASK_TRACKER.md"
  [ -f "$TT" ] || continue

  # TODO行を抽出（最大3件）
  TODOS=$(grep '| TODO |' "$TT" 2>/dev/null | head -3 || echo "")
  [ -z "$TODOS" ] && continue

  # 最後にチェックしたタイムスタンプと比較（1時間以内は無視）
  LAST_CHECK=$(python3 -c "
import json,time
try: d=json.load(open('$STATE')); t=d.get('yui_${repo}',0); print(1 if time.time()-t < 3600 else 0)
except: print(0)
" 2>/dev/null || echo "0")
  [ "$LAST_CHECK" = "1" ] && continue

  TODO_COUNT=$(echo "$TODOS" | wc -l)
  TASK_LIST=$(echo "$TODOS" | python3 -c "
import sys
lines=sys.stdin.read().strip().split('\n')
out=[]
for l in lines[:3]:
  parts=[p.strip() for p in l.split('|')]
  if len(parts)>3: out.append(f'- {parts[2]}: {parts[3][:60]}')
print('\n'.join(out))
" 2>/dev/null || echo "$TODOS" | head -3)

  post_chat "dev" "yui" "ユイ" "📊" "\`$repo\` に未着手タスクが${TODO_COUNT}件あります。

${TASK_LIST}

担当者をアサインして着手を促します。@レン @ケン 確認をお願いします。"

  # 状態を更新
  python3 -c "
import json,time
try: d=json.load(open('$STATE'))
except: d={}
d['yui_${repo}']=time.time()
open('$STATE','w').write(json.dumps(d))
" 2>/dev/null

done

# ── レン: 自分にアサインされた IN_PROGRESS タスクを確認 ──
TT_LOGIC="$HOME/projects/logic/docs/TASK_TRACKER.md"
if [ -f "$TT_LOGIC" ]; then
  MY_TASKS=$(grep '| IN_PROGRESS |' "$TT_LOGIC" 2>/dev/null | grep -i 'dev-logic\|レン\|ren' | head -2 || echo "")
  if [ -n "$MY_TASKS" ]; then
    TASK_LIST=$(echo "$MY_TASKS" | python3 -c "
import sys
lines=sys.stdin.read().strip().split('\n')
out=[]
for l in lines[:2]:
  parts=[p.strip() for p in l.split('|')]
  if len(parts)>3: out.append(f'- {parts[3][:80]}')
print('\n'.join(out))
" 2>/dev/null || echo "$MY_TASKS")

    LAST_REN=$(python3 -c "
import json,time
try: d=json.load(open('$STATE')); t=d.get('ren_active',0); print(1 if time.time()-t < 7200 else 0)
except: print(0)
" 2>/dev/null || echo "0")

    if [ "$LAST_REN" = "0" ]; then
      post_chat "dev" "ren" "レン" "🔧" "IN_PROGRESSのタスクを確認しました。引き続き作業します。

${TASK_LIST}"

      python3 -c "
import json,time
try: d=json.load(open('$STATE'))
except: d={}
d['ren_active']=time.time()
open('$STATE','w').write(json.dumps(d))
" 2>/dev/null
    fi
  fi
fi

echo "[$(date)] task-loop done"
