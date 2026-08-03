#!/bin/bash
# autonomous-cxo.sh — cxo(Apollo) スコープの自律ティック。
#
# logic 用の autonomous-rin.sh と対になる cxo 専用エントリポイント。
# Apollo 受信箱(inbox)の消費・cxo-agent タスクの自律駆動を担う。
# Keita 承認（2026-06-01「能動的に動ける設計に」＝cxo ループ有効化）で稼働。
#
# NO_PUSH=1: 実装・green・ローカル commit までは自走するが、git push と本番 deploy /
#   サーバ restart は物理 shim で抑止し Keita 承認領域として残す（Keita 指示
#   「cxo は push/deploy ゲート維持」2026-06-01）。Apollo は同ホストのローカル
#   ファイルを直読みするので、台帳/inbox の更新はローカル commit で即反映される。
#
# ガードレール（worker 側で実装）:
#   - flock /tmp/autonomous-cxo.lock
#   - kill-switch ~/.autonomous-rin.disabled（全体）/ ~/.autonomous-cxo.disabled（cxo のみ）
#   - HANDLE_INBOX=1（cxo スコープが Apollo 受信箱を処理）
#
# cron: */15 * * * * bash -lc "$HOME/cron-scripts/autonomous-cxo.sh >> $HOME/logs/autonomous-cxo.log 2>&1"
#   （logic の */10 と時刻をずらして共有 Anthropic アカウントの 529 を避ける）

set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec env PROJECT_SCOPE=cxo NO_PUSH=1 bash "$DIR/autonomous-worker.sh"
