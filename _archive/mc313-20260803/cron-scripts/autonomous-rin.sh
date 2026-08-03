#!/bin/bash
# autonomous-rin.sh — logic スコープの自律ティック（後方互換ラッパ）。
#
# MC-85 で汎用ワーカー autonomous-worker.sh に一般化した。本スクリプトはその
# logic 専用エントリポイント。既存 cron（*/10 ... autonomous-rin.sh）をそのまま
# logic 専用ループとして維持するためのラッパ。実体・ガードレールは worker 側。
#
# logic 以外のスコープは autonomous-worker.sh を PROJECT_SCOPE で直接呼ぶ:
#   PROJECT_SCOPE=cxo       bash autonomous-worker.sh
#   PROJECT_SCOPE=en-chakai bash autonomous-worker.sh
#
# ガードレール（worker 側で実装）:
#   - flock /tmp/autonomous-logic.lock
#   - kill-switch ~/.autonomous-rin.disabled（全体）/ ~/.autonomous-logic.disabled（logic のみ）
#   - DRY_RUN=1 で git push / gh を物理 shim 化

set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec env PROJECT_SCOPE=logic bash "$DIR/autonomous-worker.sh"
