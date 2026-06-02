#!/bin/bash
# terminal-session-manager.sh — MC-112
# tmux pane 内で対話 claude をループ起動し、「アイドル かつ セッション老化」を満たしたら
# 前セッションの transcript を headless claude で handoff 要約 → 新しい claude に無停止で入れ替える。
#
# 設計（Keita 選択）: トリガー = アイドル検知 / 引き継ぎ = handoff 要約 → 新セッション。
#
# 安全:
#   - このスクリプトは「自分が起動した claude」だけを kill する（PID 追跡）。
#     他人の tmux main / 他 pane には一切触れない。
#   - kill-switch ~/.terminal-refresh.disabled があればリフレッシュせず素の claude を回すだけ。
#   - アイドルでない（=Keita が直近 IDLE_MIN 分以内に操作した）なら絶対に切らない。
#
# 使い方（bashrc cutover 後）:
#   tmux new-session -A -s main "exec /home/dev/cron-scripts/terminal-session-manager.sh"
#
# 検証用の環境変数:
#   IDLE_MIN, MAX_AGE_HOURS, POLL_SEC, CLAUDE_BIN, WORKDIR, PROJECTS_DIR, HANDOFF_ONLY=1

set -u

# ---- 設定（既定値。env で上書き可）----
IDLE_MIN="${IDLE_MIN:-30}"                 # 直近この分数 Keita 操作なし = アイドル
MAX_AGE_HOURS="${MAX_AGE_HOURS:-3}"        # セッション起動からこの時間超で老化
POLL_SEC="${POLL_SEC:-60}"                 # 監視ポーリング間隔（秒）
CLAUDE_BIN="${CLAUDE_BIN:-/usr/bin/claude}"
WORKDIR="${WORKDIR:-/home/dev/projects}"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/.claude/projects}"
LOG="${LOG:-$HOME/logs/terminal-session-manager.log}"
HANDOFF_FILE="${HANDOFF_FILE:-$HOME/.terminal-handoff.md}"
KILLSWITCH="${KILLSWITCH:-$HOME/.terminal-refresh.disabled}"
SUMMARY_MODEL="${SUMMARY_MODEL:-claude-sonnet-4-5}"

mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*" >>"$LOG"; }

# ---- アイドル秒数を返す ----
# 最重要シグナルは「対話 transcript jsonl の mtime」。
#   claude は user プロンプト・assistant 応答のたびに active session の .jsonl を追記するため、
#   作業中は mtime が常に新しく、本当に放置されると古くなる。tmux の client_activity /
#   session_activity は tmux 3.4 では入力/出力で必ずしも更新されず信頼できないことを検証で確認したため、
#   tmux 由来は補助シグナルとして「より新しい方」を採る（=どちらかが新しければアイドルとみなさない）。
#   → BOTH が古いときだけアイドル＝安全側に倒す。
idle_seconds() {
  local now best sess f m a
  now="$(date +%s)"
  best=0   # 採用する「最終アクティブ epoch」。大きいほど最近。

  # (1) 対話 transcript の mtime（主シグナル）
  f="$(latest_transcript)"
  if [ -n "$f" ] && [ -e "$f" ]; then
    m="$(stat -c %Y "$f" 2>/dev/null)"
    [ -n "$m" ] && [ "$m" -gt "$best" ] 2>/dev/null && best="$m"
  fi

  # (2) tmux client_activity / session_activity（補助シグナル）
  sess="$(tmux display-message -p '#{session_name}' 2>/dev/null)"
  if [ -n "$sess" ]; then
    while read -r a; do
      [ -z "$a" ] && continue
      [ "$a" -gt "$best" ] 2>/dev/null && best="$a"
    done < <(tmux list-clients -t "$sess" -F '#{client_activity}' 2>/dev/null)
    a="$(tmux display-message -p -t "$sess" '#{session_activity}' 2>/dev/null)"
    [ -n "$a" ] && [ "$a" -gt "$best" ] 2>/dev/null && best="$a"
  fi

  # どのシグナルも取れなければ best=0 → idle が巨大になりアイドル判定されるが、
  # 老化(age)条件とセットなので、起動直後は age が小さく refresh しない。安全。
  echo $(( now - best ))
}

# ---- 直近の対話 transcript jsonl を見つける ----
latest_transcript() {
  ls -t "$PROJECTS_DIR"/*/*.jsonl 2>/dev/null | head -1
}

# ---- handoff 要約を生成して HANDOFF_FILE に書く ----
# 戻り値: 0=生成成功 / 1=失敗（transcript なし・claude 失敗）
generate_handoff() {
  local jsonl plain prompt out
  jsonl="$(latest_transcript)"
  if [ -z "$jsonl" ] || [ ! -s "$jsonl" ]; then
    log "handoff: no transcript found, skip"
    return 1
  fi

  # transcript の user/assistant テキストだけを抽出（最後の方が重要なので末尾を厚めに）
  plain="$(tail -n 400 "$jsonl" | python3 -c '
import sys, json
lines=[]
for l in sys.stdin:
    l=l.strip()
    if not l: continue
    try: d=json.loads(l)
    except Exception: continue
    t=d.get("type")
    if t not in ("user","assistant"): continue
    m=d.get("message",{}) or {}
    c=m.get("content")
    txt=""
    if isinstance(c,str): txt=c
    elif isinstance(c,list):
        for b in c:
            if isinstance(b,dict) and b.get("type")=="text":
                txt+=b.get("text","")
    txt=txt.strip()
    if txt:
        lines.append(("Keita" if t=="user" else "林")+": "+txt)
# 直近 60 発話程度に絞る
lines=lines[-60:]
print("\n\n".join(lines))
' 2>/dev/null)"

  if [ -z "$plain" ]; then
    log "handoff: transcript had no text content, skip"
    return 1
  fi

  prompt="あなたは tmux 上で動く対話アシスタント「林」です。これからセッションが新しいプロセスに入れ替わります。
以下は直前セッションの会話ログ（古い→新しい順）です。これを読んで「次の自分（新セッションの林）への引き継ぎメモ」を日本語で 30〜60 行程度で書いてください。
含めること:
- 直前まで何をしていたか（作業の主題・進行中タスクの ID/名前）
- 未完了タスク・次の一手（具体的に）
- 覚えておくべき重要な文脈・決定事項・注意点
- Keita との約束や承認待ちの項目
余計な前置き・あいさつは不要。箇条書き中心で簡潔に。出力はそのまま ~/.terminal-handoff.md に保存されます。

=== 会話ログ ここから ===
${plain}
=== 会話ログ ここまで ==="

  out="$(printf '%s' "$prompt" | timeout 180 "$CLAUDE_BIN" --print --dangerously-skip-permissions --model "$SUMMARY_MODEL" 2>>"$LOG")"
  if [ -z "$out" ]; then
    log "handoff: claude --print returned empty, skip"
    return 1
  fi

  {
    echo "# 引き継ぎメモ（前セッションからの handoff）"
    echo "# 生成: $(date '+%Y-%m-%d %H:%M:%S %Z') / src: $(basename "$jsonl")"
    echo
    printf '%s\n' "$out"
  } >"$HANDOFF_FILE"
  log "handoff: written to $HANDOFF_FILE ($(wc -l <"$HANDOFF_FILE") lines) from $(basename "$jsonl")"
  return 0
}

# HANDOFF_ONLY=1 のときは handoff 生成だけして終了（単体検証用、claude を1回だけ実走）
if [ "${HANDOFF_ONLY:-0}" = "1" ]; then
  generate_handoff && echo "OK: $HANDOFF_FILE" || echo "FAIL: handoff not generated"
  exit $?
fi

log "=== terminal-session-manager start (idle=${IDLE_MIN}m age=${MAX_AGE_HOURS}h poll=${POLL_SEC}s) ==="

# ---- メインループ ----
while true; do
  SESSION_START="$(date +%s)"

  # claude をバックグラウンド起動し、この pane の前面に置く。
  # exec せず & で起動 → PID を掴んで監視できるようにする。
  "$CLAUDE_BIN" &
  CLAUDE_PID=$!
  log "started claude pid=$CLAUDE_PID start=$SESSION_START"

  REFRESH_REQUESTED=0

  # --- 監視: 別ループでポーリングし、条件成立で claude pid に穏当な終了を送る ---
  (
    age_limit=$(awk "BEGIN{printf \"%d\", ${MAX_AGE_HOURS}*3600}")
    idle_limit=$(( IDLE_MIN * 60 ))
    while kill -0 "$CLAUDE_PID" 2>/dev/null; do
      sleep "$POLL_SEC"
      kill -0 "$CLAUDE_PID" 2>/dev/null || break
      # kill-switch ON ならリフレッシュ判定をスキップ
      [ -f "$KILLSWITCH" ] && continue
      now="$(date +%s)"
      age=$(( now - SESSION_START ))
      [ "$age" -lt "$age_limit" ] && continue          # まだ若い → 切らない
      idle="$(idle_seconds)"
      if [ "$idle" -ge "$idle_limit" ]; then
        log "refresh trigger: age=${age}s>=${age_limit}s idle=${idle}s>=${idle_limit}s -> signal pid=$CLAUDE_PID"
        # 穏当に終了。claude は SIGTERM で素直に落ちる。
        kill -TERM "$CLAUDE_PID" 2>/dev/null
        sleep 5
        kill -0 "$CLAUDE_PID" 2>/dev/null && kill -TERM "$CLAUDE_PID" 2>/dev/null
        break
      else
        log "age ok (${age}s) but busy (idle=${idle}s<${idle_limit}s) -> keep"
      fi
    done
  ) &
  MON_PID=$!

  # claude（前面）の終了を待つ。Keita が手で /exit しても、監視が落としても、ここに来る。
  wait "$CLAUDE_PID" 2>/dev/null
  CLAUDE_RC=$?

  # 監視ループを片付ける
  kill "$MON_PID" 2>/dev/null
  wait "$MON_PID" 2>/dev/null

  OLD_SESSION="$(basename "$(latest_transcript)" 2>/dev/null)"
  log "claude exited rc=$CLAUDE_RC old_session=${OLD_SESSION:-unknown}"

  # kill-switch ON のとき = リフレッシュ運用を止めたい。素の claude をそのまま回し続ける。
  # （Keita が手動 exit した場合もループで再起動するが、handoff は作らない）
  if [ -f "$KILLSWITCH" ]; then
    log "killswitch present -> restart plain claude (no handoff)"
    continue
  fi

  # handoff 要約を生成（失敗しても新セッションは起動する）
  if generate_handoff; then
    HANDOFF_OK=1
  else
    HANDOFF_OK=0
  fi
  log "switch: old=${OLD_SESSION:-unknown} handoff_ok=${HANDOFF_OK}"

  # 次ループの新 claude 起動時に handoff を読ませる。
  # 起動直後に tmux send-keys で1回プロンプトを送り、確実に文脈を乗せる。
  if [ "$HANDOFF_OK" = "1" ] && [ -s "$HANDOFF_FILE" ]; then
    PANE="$(tmux display-message -p '#{pane_id}' 2>/dev/null)"
    (
      # claude TUI が入力を受けられるまで少し待つ
      sleep 8
      if [ -n "$PANE" ]; then
        tmux send-keys -t "$PANE" "引き継ぎメモ $HANDOFF_FILE を読んで、前回の続きから再開して。" 2>/dev/null
        sleep 1
        tmux send-keys -t "$PANE" Enter 2>/dev/null
        log "handoff prompt injected into pane $PANE"
      fi
    ) &
  fi
  # ループ先頭に戻り、新しい claude を起動する
done
