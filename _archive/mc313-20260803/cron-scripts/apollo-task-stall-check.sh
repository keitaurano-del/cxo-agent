#!/bin/bash
# apollo-task-stall-check.sh — タスク遅延の軽量プリチェック（bash のみ、LLM 不使用）。
# apollo-keeper がティック毎に呼び、「LLM を起動して対応すべきタスク遅延があるか」を
# exit code で返す。トークン節約のため、遅延が無ければ apollo-keeper は LLM を起動しない。
#
# 検知対象:
#   - IN_PROGRESS のまま「更新日」が TASK_STALL_DAYS(既定3) 日以上前のタスク
#   - REVIEW のまま STALE_DAYS 日以上放置されたタスク
# 出力: 遅延タスクがあれば各行を stdout に出し exit 1。無ければ exit 0。
#
# 注: TASK_TRACKER の形式ゆれ（表形式 | と箇条書き -）両対応はせず、
#     「更新日: YYYY-MM-DD」「| 更新日 | YYYY-MM-DD |」の日付行と直近の MC-/FB-/UI-/EC- 行の
#     近接ヒューリスティックで拾う軽量版。確証ある厳密判定は LLM(apollo-keeper)側でやる。

set -uo pipefail
STALE_DAYS="${TASK_STALL_DAYS:-3}"
NOW=$(date +%s)
TRACKERS=(
  "/home/dev/projects/logic/docs/TASK_TRACKER.md"
  "/home/dev/projects/cxo-agent/docs/TASK_TRACKER.md"
  "/home/dev/projects/en-chakai/docs/TASK_TRACKER.md"
  "/home/dev/projects/obsidian-vault/20-Projects/nishimarucho-flyer/TASK_TRACKER.md"
)

found=0
seen=""
# 表形式のタスク行のみを対象にする（行頭が `|`、ID列を持ち、IN_PROGRESS を含む）。
# 説明文/進捗ノートの地の文に IN_PROGRESS という単語が出てもそれは拾わない（誤検知防止）。
# 確証ある停滞判定は apollo-keeper の LLM 側でやる前提の、粗いトリガーに徹する。
for f in "${TRACKERS[@]}"; do
  [ -f "$f" ] || continue
  proj=$(basename "$(dirname "$(dirname "$f")")")
  while IFS= read -r line; do
    # 行頭(空白後)が `|` の表行だけ。先頭セルに ID パターンがあること。
    case "$(echo "$line" | sed 's/^[[:space:]]*//')" in
      '|'*) : ;;
      *) continue ;;
    esac
    id=$(echo "$line" | grep -oE '(MC|FB|UI|EC|AF|NF|DF-F|T)-[0-9]+' | head -1)
    [ -z "$id" ] && continue
    d=$(echo "$line" | grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' | head -1)
    [ -z "$d" ] && continue
    ts=$(date -d "$d" +%s 2>/dev/null) || continue
    age=$(( (NOW - ts) / 86400 ))
    [ "$age" -ge "$STALE_DAYS" ] || continue
    key="$proj/$id"
    case " $seen " in *" $key "*) continue;; esac
    seen="$seen $key"
    echo "[STALL] $key IN_PROGRESS ${age}日経過 (更新 $d)"
    found=1
  done < <(grep -E 'IN_PROGRESS' "$f" 2>/dev/null)
done

exit $found
