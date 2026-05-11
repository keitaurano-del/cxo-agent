#!/usr/bin/env bash
# bootstrap-rin.sh — SessionStart hook が呼ぶ凜環境自動更新スクリプト
#
# 動作:
#   1. agent-config を ~/.cache/agent-config に clone or pull
#   2. sync-claude-config.sh を cwd（= 起動した repo）に対して実行
#
# 失敗してもセッションは続行させる（exit 0 で終わらせる）

set -u

AC_DIR="${AC_DIR:-${HOME}/.cache/agent-config}"
AC_REPO_HTTPS="https://github.com/keitaurano-del/agent-config.git"
AC_REPO_SSH="git@github.com:keitaurano-del/agent-config.git"

mkdir -p "$(dirname "${AC_DIR}")"

if [[ -d "${AC_DIR}/.git" ]]; then
  git -C "${AC_DIR}" fetch --quiet origin main 2>/dev/null \
    && git -C "${AC_DIR}" reset --hard origin/main --quiet 2>/dev/null \
    || echo "⚠️  agent-config fetch 失敗（オフライン？）— 既存 cache を使う" >&2
else
  if ! git clone --quiet "${AC_REPO_HTTPS}" "${AC_DIR}" 2>/dev/null; then
    if ! git clone --quiet "${AC_REPO_SSH}" "${AC_DIR}" 2>/dev/null; then
      echo "⚠️  agent-config clone 失敗（HTTPS / SSH 両方）— 凜環境同期スキップ" >&2
      exit 0
    fi
  fi
fi

SYNC_SCRIPT="${AC_DIR}/projects-meta/sync-claude-config.sh"
if [[ ! -x "${SYNC_SCRIPT}" ]]; then
  echo "⚠️  ${SYNC_SCRIPT} が無い or 実行不可 — スキップ" >&2
  exit 0
fi

# cwd を target に sync 実行
SOURCE_CLAUDE_MD="${AC_DIR}/projects-meta/CLAUDE.md" \
SOURCE_AGENTS_DIR="${AC_DIR}/projects-meta/agents" \
SOURCE_MEMORY_DIR="${AC_DIR}/projects/-root-projects/memory" \
SOURCE_BOOTSTRAP="${AC_DIR}/projects-meta/bootstrap-rin.sh" \
SOURCE_SETTINGS_TEMPLATE="${AC_DIR}/projects-meta/repo-settings.json.template" \
  bash "${SYNC_SCRIPT}" "${PWD}" >/dev/null 2>&1 \
  || echo "⚠️  sync-claude-config.sh 実行に失敗" >&2

exit 0
