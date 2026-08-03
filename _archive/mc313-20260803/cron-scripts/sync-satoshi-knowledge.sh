#!/bin/bash
# sync-satoshi-knowledge.sh — 新箱→旧箱へ memory + vault を定期同期

OLDBOX="dev@139.180.202.62"
SSH_KEY="/home/dev/.ssh/id_ed25519"

# memory detail files
rsync -a --exclude='agents' \
  /home/dev/.claude/projects/-home-dev-projects/memory/ \
  "${OLDBOX}:/home/dev/.openclaw/workspace-satoshi/memory/" \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  >> /home/dev/logs/sync-satoshi.log 2>&1

# MEMORY.md index
rsync -a \
  /home/dev/.claude/projects/-home-dev-projects/memory/MEMORY.md \
  "${OLDBOX}:/home/dev/.openclaw/workspace-satoshi/MEMORY.md" \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  >> /home/dev/logs/sync-satoshi.log 2>&1

# obsidian-vault (excluding .git)
rsync -a --delete --exclude='.git' \
  /home/dev/projects/obsidian-vault/ \
  "${OLDBOX}:/home/dev/projects/obsidian-vault/" \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  >> /home/dev/logs/sync-satoshi.log 2>&1

echo "$(date '+%Y-%m-%d %H:%M') sync done" >> /home/dev/logs/sync-satoshi.log
