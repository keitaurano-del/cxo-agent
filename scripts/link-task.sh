#!/usr/bin/env bash
# link-task.sh — タスク↔workflow/agent の明示リンクを記録する（MC-62）。
#
# data/task-links.jsonl に 1 行（= 1 リンク）を冪等 append する。
# 林 / autonomous-rin が agent / workflow を起動したタイミングで呼び、
# 「このタスクをこの run / この agent が動かした」を明示ログに残すためのもの。
#
# 使い方:
#   scripts/link-task.sh <taskId> <runId|agentId> [label]
#
#   - <taskId>            : MC-62 / FB-12 / UI-3 などのタスク ID（必須）
#   - <runId|agentId>     : wf_ で始まれば runId、それ以外は agentId として扱う（必須）
#   - [label]             : 任意の表示ラベル（省略可）
#
# 例:
#   scripts/link-task.sh MC-62 wf_abc123 "明示ログ実装"
#   scripts/link-task.sh MC-62 7f3c0a91-...-agentid "dev-logic 蓮"
#
# 冪等性: 同じ (taskId, runId|agentId) の組合せが既にあれば追記しない（重複を作らない）。
#
# 注意: このスクリプトは追記専用。既存行の編集・削除はしない（明示ログを正本として壊さない）。

set -euo pipefail

usage() {
  echo "usage: $0 <taskId> <runId|agentId> [label]" >&2
  exit 2
}

TASK_ID="${1:-}"
REF="${2:-}"
LABEL="${3:-}"

[ -n "$TASK_ID" ] || usage
[ -n "$REF" ] || usage

# このスクリプトの場所からリポジトリルートを決め、data/task-links.jsonl を確定する。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$REPO_ROOT/data"
LINKS_FILE="$DATA_DIR/task-links.jsonl"

mkdir -p "$DATA_DIR"
[ -f "$LINKS_FILE" ] || : > "$LINKS_FILE"

# wf_ で始まれば runId、それ以外は agentId。
if [[ "$REF" == wf_* ]]; then
  KIND="runId"
else
  KIND="agentId"
fi

# JSON 文字列としての値エスケープ（", \, 制御文字）。node に任せて堅くする。
# 冪等チェックと行生成を node ワンライナーでまとめて行う。
TS="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

node - "$LINKS_FILE" "$TASK_ID" "$KIND" "$REF" "$LABEL" "$TS" <<'NODE'
const [file, taskId, kind, ref, label, ts] = process.argv.slice(2);
const fs = require('node:fs');

// 正規化（taskId / ref の比較は大小・区切りゆれを吸収して重複判定）。
const norm = (s) => String(s).toLowerCase().replace(/[\s_-]/g, '');

let existing = '';
try { existing = fs.readFileSync(file, 'utf-8'); } catch { existing = ''; }

// 既存行に同じ (taskId, kind=ref) の組合せがあるか冪等チェック。
for (const line of existing.split('\n')) {
  const t = line.trim();
  if (!t) continue;
  let obj;
  try { obj = JSON.parse(t); } catch { continue; } // 壊れ行は無視
  if (!obj || typeof obj !== 'object') continue;
  if (norm(obj.taskId) === norm(taskId) && norm(obj[kind]) === norm(ref)) {
    process.stdout.write(`already linked: ${taskId} <-> ${ref} (skip)\n`);
    process.exit(0);
  }
}

const rec = { taskId, [kind]: ref, ts };
if (label) rec.label = label;

// 末尾に改行を保証してから 1 行追記する。
const needsNl = existing.length > 0 && !existing.endsWith('\n');
fs.appendFileSync(file, (needsNl ? '\n' : '') + JSON.stringify(rec) + '\n');
process.stdout.write(`linked: ${taskId} <-> ${ref} (${kind})\n`);
NODE
