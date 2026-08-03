#!/bin/bash
# auto-compact-watch.sh — tmux セッションのコンテキスト100%を検知して自動コンパクション。
#
# 対象:
#   ローカル: main（ターミナル1/林）、spare（ターミナル3）
#   リモート: apollo2（ターミナル2/旧箱 dev@139.180.202.62）
# 条件: "100% context used" が表示されており、かつコンパクション未実行・プロンプト待ち状態
# 動作: /compact を send-keys で送信 → Claude Code が自動でコンパクション後に再開

LOG=/home/dev/logs/auto-compact.log
SSH_KEY=/home/dev/.ssh/id_ed25519
OLDBOX_USER=dev
OLDBOX_HOST=139.180.202.62

mkdir -p "$(dirname "$LOG")"

# ── ローカルセッション（main / spare）────────────────────────────
for session in main spare; do
  if ! tmux has-session -t "$session" 2>/dev/null; then
    continue
  fi

  pane=$(tmux capture-pane -t "$session" -p 2>/dev/null)

  if echo "$pane" | grep -q "Compacting"; then
    continue
  fi

  if echo "$pane" | grep -q "100% context used" && echo "$pane" | grep -q "^❯"; then
    tmux send-keys -t "$session" "/compact" Enter
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] auto-compact triggered: session=$session (local)" >> "$LOG"
  fi
done

# ── リモートセッション（apollo2 / 旧箱）──────────────────────────
pane=$(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=5 \
  "$OLDBOX_USER@$OLDBOX_HOST" \
  "tmux capture-pane -t apollo2 -p 2>/dev/null" 2>/dev/null)

if [ -n "$pane" ]; then
  # twiddling thumbs = OpenClaw が処理中（コンパクション中も含む）
  if echo "$pane" | grep -q "Compacting\|twiddling thumbs"; then
    : # already processing
  else
    # Claude Code 形式: "100% context used" + プロンプト待ち
    # OpenClaw 形式: "tokens Xk/Yk (Z%)" で Z >= 80 かつ idle
    NEEDS_COMPACT=false
    if echo "$pane" | grep -q "100% context used" && echo "$pane" | grep -q "^❯"; then
      NEEDS_COMPACT=true
    elif echo "$pane" | grep -q "| idle"; then
      # OpenClaw の tokens 行から使用率を抽出して 80% 以上なら compact
      USAGE=$(echo "$pane" | grep -oP 'tokens \d+k/\d+k \(\K\d+(?=%)' | tail -1)
      if [ -n "$USAGE" ] && [ "$USAGE" -ge 80 ]; then
        NEEDS_COMPACT=true
      fi
    fi
    if [ "$NEEDS_COMPACT" = "true" ]; then
      ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=5 \
        "$OLDBOX_USER@$OLDBOX_HOST" \
        "tmux send-keys -t apollo2 '/compact' Enter" 2>/dev/null
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] auto-compact triggered: session=apollo2 (remote, usage=${USAGE:-?}%)" >> "$LOG"
    fi
  fi
fi
