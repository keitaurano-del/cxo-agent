#!/bin/bash
# autonomous-worker.sh — プロジェクト別の無人自律ティック（汎用ワーカー）。
#
# MC-85: プロジェクト別に複数の自律ループを独立 cron で並行稼働させるための汎用ワーカー。
# 1 ティックで、自分のスコープ（PROJECT_SCOPE）のプロジェクトの TASK_TRACKER だけを見て、
# 着手可能タスクを「ちょうど1つ」前進させる。スコープを分けることでファイル重複・二重 push を
# プロジェクト単位で構造的に回避する。
#
# 呼び出し方:
#   PROJECT_SCOPE=logic     bash autonomous-worker.sh
#   PROJECT_SCOPE=cxo       bash autonomous-worker.sh
#   PROJECT_SCOPE=en-chakai bash autonomous-worker.sh
#   bash autonomous-worker.sh logic            # 第1引数でも指定可
#
# 後方互換: autonomous-rin.sh は本ワーカーを PROJECT_SCOPE=logic で呼ぶ薄いラッパ。
#
# ガードレール（スコープ別 + 全体）:
#   - flock 排他: /tmp/autonomous-<scope>.lock。同スコープの前ティック走行中なら skip。
#                 別スコープは別ロックなので並行して走れる。
#   - kill-switch: ~/.autonomous-rin.disabled（全体・全スコープ停止）か
#                  ~/.autonomous-<scope>.disabled（当該スコープのみ停止）があれば即終了。
#   - green ゲート: テスト/型/lint が通らない限り push/deploy しない（プロンプト側で厳守）。
#   - 1ティック1タスク / deploy 最大1回（プロンプト側で厳守）。
#   - DRY_RUN=1: 選定と1歩だけ。git push / gh を物理 shim で no-op 化し push/deploy を確実に抑止。
#   - --print(headless) なので session-cleanup の reap 対象外。
#
# 緊急停止: kill-switch はティック開始時のみ判定する。走行中ティックを今すぐ止めたい場合は
#   touch ~/.autonomous-<scope>.disabled で次回以降を止めつつ、走行中の claude を kill する。

set -uo pipefail

TS() { date "+%Y-%m-%d %H:%M:%S %Z"; }

# --- スコープ決定（環境変数優先、なければ第1引数、デフォルト logic）---
PROJECT_SCOPE="${PROJECT_SCOPE:-${1:-logic}}"
DRY_RUN="${DRY_RUN:-0}"
# NO_PUSH=1: 実装・green・ローカル commit までは自走させるが、git push と本番 deploy は
#   物理 shim で確実に抑止する（Keita 承認領域として残す）モード。cxo(Apollo) スコープ用。
#   Apollo サーバは同ホストのローカルファイルを直読みするので、台帳/inbox/data のローカル
#   commit は GitHub に push せずとも Apollo に即反映される。push と deploy/restart だけ承認待ち。
NO_PUSH="${NO_PUSH:-0}"

# --- スコープ → プロジェクト設定の対応表 ---
case "$PROJECT_SCOPE" in
  logic)
    SCOPE_LABEL="logic"
    TRACKER="/home/dev/projects/logic/docs/TASK_TRACKER.md"
    PROJECT_DESC="Logic（論理思考トレーニングアプリ。React/Express/Supabase/Capacitor）"
    HANDLE_INBOX=0   # Apollo 受信箱は cxo スコープが処理する
    ;;
  cxo|cxo-agent|apollo)
    PROJECT_SCOPE="cxo"
    SCOPE_LABEL="cxo"
    TRACKER="/home/dev/projects/cxo-agent/docs/TASK_TRACKER.md"
    PROJECT_DESC="cxo-agent / Apollo（CXO 向けエージェント・稼働可視化ダッシュボード）"
    HANDLE_INBOX=1   # Apollo 受信箱の処理担当
    ;;
  en-chakai|enchakai|chakai)
    PROJECT_SCOPE="en-chakai"
    SCOPE_LABEL="en-chakai"
    TRACKER="/home/dev/projects/en-chakai/docs/TASK_TRACKER.md"
    PROJECT_DESC="円茶会 / En Chakai（茶道ビジネス向け二言語マーケ&予約サイト。Next.js）"
    HANDLE_INBOX=0
    ;;
  *)
    echo "[$(TS)] ERROR: unknown PROJECT_SCOPE='$PROJECT_SCOPE' (expected: logic|cxo|en-chakai)" >&2
    exit 2
    ;;
esac

LOCK="/tmp/autonomous-${SCOPE_LABEL}.lock"
KILL_SWITCH_GLOBAL="$HOME/.autonomous-rin.disabled"
KILL_SWITCH_SCOPE="$HOME/.autonomous-${SCOPE_LABEL}.disabled"

# --- kill-switch（全体 → スコープ別の順で判定）---
if [ -f "$KILL_SWITCH_GLOBAL" ]; then
  echo "[$(TS)] [$SCOPE_LABEL] disabled (global kill-switch: $KILL_SWITCH_GLOBAL) — skip"
  exit 0
fi
if [ -f "$KILL_SWITCH_SCOPE" ]; then
  echo "[$(TS)] [$SCOPE_LABEL] disabled (scope kill-switch: $KILL_SWITCH_SCOPE) — skip"
  exit 0
fi

# --- TASK_TRACKER 存在確認 ---
if [ ! -f "$TRACKER" ]; then
  echo "[$(TS)] [$SCOPE_LABEL] TASK_TRACKER not found: $TRACKER — skip"
  exit 0
fi

# --- 事前チェック: 着手可能タスクがなければ LLM を呼ばず即終了（トークン節約）---
ACTIONABLE_COUNT=$(grep -cE "\| (TODO|IN_PROGRESS|REVIEW)\b" "$TRACKER" 2>/dev/null || echo 0)
if [ "$ACTIONABLE_COUNT" -eq 0 ]; then
  echo "[$(TS)] [$SCOPE_LABEL] no actionable tasks (0 TODO/IN_PROGRESS/REVIEW) — skip LLM"
  exit 0
fi

# --- 排他ロック（同スコープの前ティック走行中なら即抜ける。別スコープは別ロック）---
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(TS)] [$SCOPE_LABEL] previous tick still running ($LOCK) — skip"
  exit 0
fi

echo "[$(TS)] [$SCOPE_LABEL] autonomous-worker tick start (DRY_RUN=${DRY_RUN}, tracker=$TRACKER, actionable=$ACTIONABLE_COUNT)"

# --- TASK_TRACKER のアクティブ行サマリ生成（LLM に全文読ませない）---
# TODO/IN_PROGRESS/REVIEW 行のみ抽出して変数に入れ、プロンプトに直接渡す。
# 全文 Read を避けることで入力トークンを大幅削減する。
TRACKER_SUMMARY="$(grep -E "^\| [A-Z0-9_-]+ \|" "$TRACKER" | grep -E "\| (TODO|IN_PROGRESS|REVIEW)\b" | head -30 || true)"

DRY_NOTE=""
if [ "$DRY_RUN" = "1" ]; then
  DRY_NOTE="
【DRY RUN モード】今回は検証走行じゃ。タスク選定と「何を1歩進めるか」の判断・委譲までは行ってよいが、
push と deploy は絶対にするな。台帳の DONE 化や本番反映もするな。最後に「選んだタスク」と「やろうとした1歩」を要約して終われ。"
elif [ "$NO_PUSH" = "1" ]; then
  DRY_NOTE="
【NO_PUSH モード（push/deploy ゲート維持）】このスコープでは実装・テスト green・ローカル commit までは自走してよい。
ただし git push と本番 deploy（gh workflow / deploy-production）、本番サーバの restart は Keita の承認領域じゃから絶対にするな。
Apollo サーバは同ホストのローカルファイルを直読みするので、台帳(TASK_TRACKER)・inbox-consumed・data の更新はローカル commit するだけで Apollo に即反映される（GitHub に push せんでよい）。
よって: 実装→green→ローカル commit まで進めて締めよ。push / deploy / restart が要る段は『承認待ち』として台帳に残し、要約でその旨を報告せよ。サーバコードを変えた場合も restart はせず、反映には Keita 承認が要ると明記して終われ。"
fi

# --- 物理ガード: DRY_RUN または NO_PUSH のとき git push / gh を no-op shim で塞ぐ ---
# （モデルが指示を破っても push/deploy できないようにする二重防御。git の他サブコマンド= commit 等は通す）
if [ "$DRY_RUN" = "1" ] || [ "$NO_PUSH" = "1" ]; then
  GUARD_TAG="DRY_RUN"; [ "$NO_PUSH" = "1" ] && [ "$DRY_RUN" != "1" ] && GUARD_TAG="NO_PUSH"
  REAL_GIT="$(command -v git)"
  SHIM_DIR="$(mktemp -d /tmp/autonomous-${SCOPE_LABEL}-shim.XXXXXX)"
  cat > "$SHIM_DIR/git" <<GITSHIM
#!/bin/bash
if [ "\$1" = "push" ]; then echo "[${GUARD_TAG}] git push blocked by shim"; exit 0; fi
exec "$REAL_GIT" "\$@"
GITSHIM
  cat > "$SHIM_DIR/gh" <<GHSHIM
#!/bin/bash
echo "[${GUARD_TAG}] gh blocked by shim: \$*"; exit 0
GHSHIM
  chmod +x "$SHIM_DIR/git" "$SHIM_DIR/gh"
  export PATH="$SHIM_DIR:$PATH"
  trap 'rm -rf "$SHIM_DIR"' EXIT
  echo "[$(TS)] [$SCOPE_LABEL] ${GUARD_TAG} shim active: git push / gh are no-op (PATH=$SHIM_DIR:...)"
fi

# --- Apollo 受信箱の手順（cxo スコープだけ注入。他スコープは空）---
INBOX_STEP=""
if [ "$HANDLE_INBOX" = "1" ]; then
  INBOX_STEP='0. Apollo 受信箱を確認: /home/dev/projects/cxo-agent/data/inbox.jsonl が存在すれば各行(JSON)を読む。/home/dev/projects/cxo-agent/data/inbox-consumed.jsonl に id があるものは消費済みなので除外。
   【MC-77 重要】投入は全て「タスク」じゃ（kind=task に統一済み。旧 kind=instruction も task として扱う＝指示の特別扱いは廃止）。さらに Apollo サーバ側が投入時に即 TASK_TRACKER へ登録するようになった。エントリに "taskId"（例 MC-82）があれば、それは既にタスクボードに載っている＝二重登録するな。新規タスクとして TASK_TRACKER に書き直さず、その taskId のタスクを通常のボードタスクとして扱う（手順1以降の選定対象に含まれる）。
   - "taskId" が無い古いエントリ（サーバ即登録より前の投入）だけは従来どおり: 投入内容のプロジェクトに対応する TASK_TRACKER に新規タスクとして登録してから対象にする（採番は `bash /home/dev/cron-scripts/next-task-id.sh <PREFIX>`、重複登録するな）。投入が他プロジェクト向けなら、登録だけして今ティックでは着手しない（着手はそのプロジェクトのスコープのワーカーに任せる）。
   - エントリに attachments（画像パスの配列、例 data/inbox-attachments/<id>/xxx.png）があれば、それは Keita がスマホから添付した画像じゃ（バグのスクショ等）。/home/dev/projects/cxo-agent/ からの相対パスを絶対パス化し、Read で中身を確認する。委譲する subagent にもその絶対パスを渡して画像を見せること。
   - 処理に着手したら（成否に関わらず一巡したら）、その inbox id を inbox-consumed.jsonl に1行 `{"id":"...","consumedAt":"<ISO>","note":"..."}` で追記して消費済みにする。二度拾わないこと。
   - pending が複数あっても 1ティック1タスクは維持。今ティックは1件だけ処理し、残りは次ティックに回す。
   - 受信箱が空 or 全て consumed/着手済みなら、通常のタスク選定（手順1以降）に進む。
   - 【スコープ厳守】このワーカーは cxo スコープじゃ。受信箱の処理（consumed 追記・台帳登録）はしてよいが、着手・実装・push の対象は cxo-agent の TASK_TRACKER のタスクに限る。他プロジェクト向け投入は登録だけして着手しない。
'
fi

# --- プロンプト本体（スコープ専用に書き換え。台帳はこのスコープのもの1つだけ）---
PROMPT=$(cat <<'PROMPT_EOF'
あなたは林（りん）。これは無人の自律ティックじゃ。今この瞬間、Keita は見ておらん。お前一人で判断してプロジェクトを前に進める。
__DRY_NOTE__

【このティックのスコープ】__SCOPE_LABEL__（__PROJECT_DESC__）。
お前が見る台帳はこの1つだけじゃ: __TRACKER__
他プロジェクトの TASK_TRACKER は今ティックでは一切見るな・触るな。ファイル重複と二重 push を避けるため、スコープのプロジェクトのリポしか触らない。

【このティックのミッション】
このスコープの着手可能なタスクを「ちょうど1つ」選び、実機で効く状態（テスト green）まで一歩進める。ただし push / 本番deploy / 本番restart は自分でやらない（Keita 指示の『Masayoshi 検証ゲート』2026-06-07）。実装→テスト green→ローカル commit まで進めたら、push/deploy が要る旨を承認フローに出して止まる。

【アクティブタスク一覧（TODO/IN_PROGRESS/REVIEW のみ・サマリ抽出済み）】
以下が今選べるタスクじゃ。詳細が必要なときだけ台帳（__TRACKER__）の該当行を Read せよ。台帳の全文は読むな（トークン節約）。
__TRACKER_SUMMARY__

【手順】
__INBOX_STEP__1. 上のサマリから着手可能タスクを選ぶ。詳細が必要な場合のみ __TRACKER__ の該当行を Read せよ（全文 Read 厳禁）。
2. 台帳と git 実態にズレがあれば先に台帳を正す（task-manager に委譲 or 直接）。
   【台帳編集の鉄則／MC-88】台帳を編集してよいのは「自分が今ティックで着手したタスク1行」だけじゃ。他タスクの行は触るな。とりわけ BLOCKED / Keita承認待ち / 設計判断 の行の status セルは絶対に書き換えるな。reconcile（台帳とgitのズレ補正）であっても、他タスクの status を勝手に変えてはならん。status を動かすのは task-manager の明示作業のときだけじゃ。サマリ表を「古い記憶から丸ごと再生成して上書き」するのは禁止（直前の他者リコンサイルを巻き戻す事故の原因。実例 commit a58c147 が 9b9cc33 の BLOCKED 付与を巻き戻した）。編集は必ず該当タスクの該当行のピンポイント差し替えに留めよ。
3. 着手可能タスクを1つだけ選ぶ。選定基準:
   - status が TODO / IN_PROGRESS / REVIEW（REVIEW は実効性検証で○/×を確定させる）
   - BLOCKED でない、依存タスクが満たされている
   - 「設計判断」「Keita承認待ち」タグが付いていない（これらは触らない。Keita 待ちのまま残す）
   - 選定したら、その時点で『SELECTED_TASK_ID: <ID>』という行を1行だけ出力せよ（例: `SELECTED_TASK_ID: MC-90`）。このティックで台帳の status を編集してよいのはこの ID の行だけじゃ。
   - 【スコープ内のみ】対象は __SCOPE_LABEL__ の台帳のタスクだけ。他プロジェクトには移らない。このスコープに着手可能タスクが1つも無ければ idle で終わる（他スコープは別ワーカーが回す）。
   - 【優先度順で拾う＝早いやつから】着手可能タスクが複数あるとき、優先度の高い順に1つ選ぶ。優先度は台帳の「優先度」列を必ず読み取る。順位は P0 > P1 > P2 > P3（P0 が最優先＝一番早く拾う）。表記ゆれ（高/中/低、H/M/L、high/medium/low）も 高>中>低 で同様に扱う。優先度の記載が無いものは最後。
   - 同優先度の中では ID 昇順（小さい番号から）で1つ選ぶ。
4. 実装は適切な subagent に委譲する（コード=dev-logic、ビジュアル=designer、コンテンツ=content-creator、検証=test-functional/test-smoke）。林は自分で実装を巻き取らない。
5. テスト/型/lint を回す（テストが無いプロジェクトは tsc --noEmit + eslint . が代替）。失敗したら最大3回まで自動修正を試みる。3回で直らなければそのタスクは諦め、台帳に状況を残して終了する（別タスクへは移らない）。
6. green になったら: ローカル commit まで。**push / 本番deploy / restart は自分でやらない**（Masayoshi が実機検証してから手動実行する）。deploy 系コマンド（`gh workflow run` 等）も実行しない。
7. 台帳のステータスを更新（→ DONE / REVIEW）して commit。
8. 最後にこのティックで「スコープ・選んだタスク・やったこと・結果（green/red/deploy有無）」を1〜3行で要約して出力する。

【鉄則】
- 1ティック1タスク。欲張らない。
- このスコープ（__SCOPE_LABEL__）の台帳・リポだけを触る。他プロジェクトには絶対に手を出さない。
- push / deploy / restart は自分でやらない（Masayoshi 検証ゲート）。green でも自走 push しない。
- 「検証完了」「DONE」を名乗るのは実機 smoke を通した後だけ。tsc/eslint green だけで検証完了・DONE化しない（REVIEW 止まり）。
- BLOCKED / Keita承認待ち は絶対に勝手に進めない。**他タスクの BLOCKED 行の status を書き換えるのも厳禁**（reconcile でも）。台帳編集は自分の着手タスク1行のみ（手順2の鉄則参照）。
- 着手可能なものが何も無ければ「idle: __SCOPE_LABEL__ に進めるタスク無し」と一行出力して即終了し、token を無駄にしない。

【Keita に確認が必要な場合】
push / deploy / 破壊的操作など Keita の承認が必要な場面では、チャットに流さず Apollo の承認フローに直接リクエストを投げること:

```bash
AGENT_TOKEN=$(grep '^AGENT_TOKEN=' /home/dev/projects/cxo-agent/.mc.env | cut -d= -f2-)
curl -s -X POST http://localhost:4317/api/approvals/request \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$AGENT_TOKEN\",\"from\":\"autonomous-rin\",\"fromName\":\"林\",\"title\":\"<件名（短く）>\",\"description\":\"<詳細説明>\",\"category\":\"<deploy|design|approval|confirm>\"}"
```

category の選択基準:
- deploy   : git push / 本番 deploy / サーバ restart を Masayoshi に検証→手動実行してもらう依頼。自分で承認・実行しない。`gh workflow run deploy-production.yml` は cxo-agent に存在しないので description に書かない（Apollo は restart ベース）。
- design   : 設計判断・仕様の確認
- approval : 一般的な承認待ち
- confirm  : 要確認・判断を仰ぎたい事項
PROMPT_EOF
)

# プレースホルダ置換（heredoc はクォート済みで展開しないため）
PROMPT="${PROMPT//__DRY_NOTE__/$DRY_NOTE}"
PROMPT="${PROMPT//__INBOX_STEP__/$INBOX_STEP}"
PROMPT="${PROMPT//__SCOPE_LABEL__/$SCOPE_LABEL}"
PROMPT="${PROMPT//__PROJECT_DESC__/$PROJECT_DESC}"
PROMPT="${PROMPT//__TRACKER__/$TRACKER}"
PROMPT="${PROMPT//__TRACKER_SUMMARY__/$TRACKER_SUMMARY}"

# --- TRACKER のあるリポ root を解決（物理ガード用） ---
TRACKER_DIR="$(dirname "$TRACKER")"
TRACKER_REPO="$(git -C "$TRACKER_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
TRACKER_REL=""
if [ -n "$TRACKER_REPO" ]; then
  TRACKER_REL="${TRACKER#$TRACKER_REPO/}"
fi

# headless 林を起動（--agent 指定なし＝メイン林人格）。
# 出力はログにそのまま流しつつ、SELECTED_TASK_ID 行を後段の物理ガード用に拾えるようキャプチャする。
TICK_OUT="$(mktemp /tmp/autonomous-${SCOPE_LABEL}-out.XXXXXX)"
trap 'rm -f "$TICK_OUT"' EXIT
claude --print --dangerously-skip-permissions --model claude-haiku-4-5-20251001 <<PROMPT_INPUT 2>&1 | tee "$TICK_OUT" || echo "[$(TS)] [$SCOPE_LABEL] claude exited non-zero"
${PROMPT}
PROMPT_INPUT

# worker が選定したタスク ID（プロンプトで `SELECTED_TASK_ID: <ID>` を出力させている）。
# 物理ガードのログ用途。実際の BLOCKED 保全は ID 非依存で行う（LLM 出力の信頼に依存しない）。
SELECTED_TASK_ID="$(grep -oE 'SELECTED_TASK_ID:[[:space:]]*[A-Za-z0-9_-]+' "$TICK_OUT" 2>/dev/null | head -1 | sed -E 's/.*:[[:space:]]*//')"
[ -n "$SELECTED_TASK_ID" ] && echo "[$(TS)] [$SCOPE_LABEL] selected task = $SELECTED_TASK_ID"

# --- 物理ガード（MC-88）: 他タスクの「人間/設計判断系」status 行を勝手に降格させない決定的チェック ---
# LLM の遵守に依存せず、commit/push が走る前に作業ツリーの TASK_TRACKER を検査する。
# 「HEAD で `| <ID> | … | <PROTECTED> … |` だったテーブル行が、作業ツリーでその保護 status を
#  失っていたら（＝降格・TODO 化された）、その行を HEAD の内容に復元する」。これで reconcile の
#  丸ごと再生成上書き（実例 a58c147 が 9b9cc33 の BLOCKED/REVIEW を bare TODO に巻き戻した事故）を
#  構造的に防ぐ。
#
# 保護対象 status = BLOCKED / REVIEW / CANCELLED / DONE。
#   - BLOCKED: Keita の設計判断・承認待ち。勝手に進めてはいけない（MC-88 本丸）。
#   - REVIEW : 実装済みで検証ゲート上。bare TODO に巻き戻すと「未着手」に偽装され二度手間。
#   - CANCELLED: 取り下げ済み。復活させると幽霊タスクが盤面に再浮上する。
#   - DONE: 完了済み（Keita 手動完了含む）。降格させると完了タスクが盤面に蘇り混乱（2026-06-07 Keita 指摘）。
# selected（自分の着手タスク）は全 status で例外＝正当な前進/降格は許す。
#
# 例外: SELECTED_TASK_ID（このティックが着手したタスク）自身の行は保護しない。
#   worker が自分のタスクを正当に前進/降格させる（例 REVIEW→DONE、BLOCKED→IN_PROGRESS）のは許す。
#   他タスク（=自分が選んでいない ID）の保護 status 降格だけを差し戻す。
guard_blocked_rows() {
  [ -z "$TRACKER_REPO" ] && { echo "[$(TS)] [$SCOPE_LABEL] guard skip: TRACKER not in a git repo"; return 0; }
  # 作業ツリーに TASK_TRACKER の変更が無ければ何もしない。
  if git -C "$TRACKER_REPO" diff --quiet -- "$TRACKER_REL" 2>/dev/null; then
    return 0
  fi
  local HEAD_FILE WORK_FILE
  HEAD_FILE="$(mktemp /tmp/autonomous-${SCOPE_LABEL}-head.XXXXXX)"
  WORK_FILE="$TRACKER"
  if ! git -C "$TRACKER_REPO" show "HEAD:$TRACKER_REL" > "$HEAD_FILE" 2>/dev/null; then
    rm -f "$HEAD_FILE"; return 0
  fi
  # bash で決定的に行単位の復元を行う。テーブル行 `| <ID> | ... |` を ID キーで突き合わせ、
  # HEAD 側が保護 status（BLOCKED/REVIEW/CANCELLED）かつ作業ツリー側の同 ID 行がその status を
  # 失っていれば、HEAD 行で置き換える。SELECTED_TASK_ID 自身は対象外（自タスクの前進は許す）。
  TRACKER_HEAD="$HEAD_FILE" TRACKER_WORK="$WORK_FILE" \
  GUARD_SELECTED_ID="${SELECTED_TASK_ID:-}" python3 - "$HEAD_FILE" "$WORK_FILE" <<'PYGUARD'
import os, re, sys
head_path, work_path = sys.argv[1], sys.argv[2]
selected = (os.environ.get('GUARD_SELECTED_ID') or '').strip()
# 保護する status（人間/設計判断系＋完了。これらが bare TODO 等へ降格されたら HEAD から復元する）。
# DONE 追加（2026-06-07 Keita「完了にしたタスクが戻される」）: 連続稼働でリコンサイル頻度が上がり
# 他タスクの DONE が降格される事故が出たため保護対象に含める。自分の着手タスク(selected)は例外なので
# 正当な REVIEW→DONE は通る。DONE の正当な再オープンは人間が HEAD を変えるので影響なし。
PROTECTED = ('BLOCKED', 'REVIEW', 'CANCELLED', 'DONE')
def rows(path):
    out = {}
    with open(path, encoding='utf-8') as f:
        for ln in f:
            if ln.startswith('|'):
                cells = [c.strip() for c in ln.rstrip('\n').split('|')[1:-1]]
                if cells:
                    rid = cells[0]
                    # テーブルタスク行らしき ID（英字 or 数字始まり、見出し/区切り除外）
                    if rid and rid != 'ID' and not re.fullmatch(r'[-: ]+', rid) and (rid[0].isalnum()):
                        out.setdefault(rid, []).append(ln.rstrip('\n'))
    return out
head_rows = rows(head_path)
def protected_status(line):
    # 行が含む保護 status を返す（無ければ None）。複数該当時は PROTECTED 優先順。
    u = line.upper()
    for s in PROTECTED:
        if s in u:
            return s
    return None
restored = []
with open(work_path, encoding='utf-8') as f:
    lines = f.readlines()
# ID -> HEAD の (保護 status, 行)。同 ID が複数保護行を持つことは稀。最初の保護行を採用。
head_protected = {}
for rid, rl in head_rows.items():
    for l in rl:
        st = protected_status(l)
        if st:
            head_protected[rid] = (st, l)
            break
# ID -> HEAD のロック行（🔒 / [Keita]）。Keita 手動確定行は status に関わらず HEAD を死守する。
# 2026-06-07 MC-166（Keita「完了にしたタスクが戻される」根本対策）。selected でも例外にしない。
head_locked = {}
for rid, rl in head_rows.items():
    for l in rl:
        if '\U0001F512' in l or '[Keita]' in l:
            head_locked[rid] = l
            break
changed = False
for i, ln in enumerate(lines):
    if not ln.startswith('|'):
        continue
    cells = [c.strip() for c in ln.rstrip('\n').split('|')[1:-1]]
    if not cells:
        continue
    rid = cells[0]
    # ロック行は最優先で死守: HEAD と1文字でも違えば HEAD で丸ごと復元（status 問わず・selected も対象）。
    if rid in head_locked:
        if ln.rstrip('\n') != head_locked[rid]:
            lines[i] = head_locked[rid] + '\n'
            restored.append(rid + '(locked)')
            changed = True
        continue
    if rid not in head_protected:
        continue
    if rid == selected:
        # 着手タスク自身の行は保護しない（自タスクの正当な前進/降格を許す）。
        continue
    head_st, head_line = head_protected[rid]
    # この ID は HEAD で保護 status だったのに、作業ツリー行でその status を失っている → 降格とみなし復元。
    if head_st not in ln.upper():
        lines[i] = head_line + '\n'
        restored.append(rid + '(' + head_st + ')')
        changed = True
if changed:
    with open(work_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    sys.stderr.write('GUARD_RESTORED ' + ','.join(sorted(set(restored))) + '\n')
PYGUARD
  local rc=$?
  rm -f "$HEAD_FILE"
  return $rc
}
GUARD_LOG="$(guard_blocked_rows 2>&1)"
if echo "$GUARD_LOG" | grep -q 'GUARD_RESTORED'; then
  RESTORED_IDS="$(echo "$GUARD_LOG" | sed -nE 's/.*GUARD_RESTORED (.*)/\1/p')"
  echo "[$(TS)] [$SCOPE_LABEL] GUARD: 他タスクの保護 status 行（BLOCKED/REVIEW/CANCELLED）を HEAD から復元した（降格阻止）: $RESTORED_IDS"
  # 既に worker が TASK_TRACKER を commit 済みでも、復元差分を追い commit して live を正す。
  if [ "$DRY_RUN" != "1" ]; then
    git -C "$TRACKER_REPO" add "$TRACKER_REL" 2>/dev/null \
      && git -C "$TRACKER_REPO" commit -m "guard(MC-88): restore protected-status rows the tick demoted: $RESTORED_IDS" 2>&1 | head -3 || true
  else
    echo "[$(TS)] [$SCOPE_LABEL] DRY_RUN: 復元のみ（commit せず）"
  fi
fi

# --- 物理ガード（MC-107）: cxo スコープのフィールド表カード本文保護 ---
# サマリ表行保護（MC-88）とは別レイヤ。フィールド表カード形式（### MC-xxx ヘッダで始まる
# セクション本文）をセクション単位で保護する。LLM がカード本文行をサマリ表行と誤認識し
# タイトル・担当・詳細等を上書き破壊する事故（commit f0bac30、33カード汚染）を根治する。
#
# 保護ロジック:
#   - task_id=None セグメント（前文・サマリ表）: 作業ツリー版を保持（サマリ表の変更は許す）
#   - 選択タスク（GUARD_SELECTED_ID2 env 変数）のセクション: 作業ツリー版を保持（自タスク前進は許す）
#   - その他のタスクセクション: HEAD 版で復元（他タスクのフィールドカード本文を保護）
guard_fieldcard_body() {
  # cxo スコープのみ対象
  [ "$SCOPE_LABEL" != "cxo" ] && return 0
  [ -z "$TRACKER_REPO" ] && { echo "[$(TS)] [$SCOPE_LABEL] guard_fieldcard skip: TRACKER not in a git repo"; return 0; }
  # 作業ツリーに TASK_TRACKER の変更が無ければ何もしない。
  if git -C "$TRACKER_REPO" diff --quiet -- "$TRACKER_REL" 2>/dev/null; then
    return 0
  fi
  local HEAD_FILE
  HEAD_FILE="$(mktemp /tmp/autonomous-${SCOPE_LABEL}-fguard-head.XXXXXX)"
  if ! git -C "$TRACKER_REPO" show "HEAD:$TRACKER_REL" > "$HEAD_FILE" 2>/dev/null; then
    rm -f "$HEAD_FILE"; return 0
  fi
  GUARD_SELECTED_ID2="${SELECTED_TASK_ID:-}" python3 - "$HEAD_FILE" "$TRACKER" <<'PYFIELDGUARD'
import os, re, sys

head_path, work_path = sys.argv[1], sys.argv[2]
selected = (os.environ.get('GUARD_SELECTED_ID2') or '').strip()

def parse_sections(lines):
    """ファイルを ### ID — ... ヘッダでセクション分割する。
    (task_id or None, [lines]) のリストを返す。
    task_id=None は ### ヘッダ前の前文（サマリ表等）。
    """
    segments = []
    current_lines = []
    current_id = None

    for line in lines:
        m = re.match(r'^###\s+([A-Za-z]+-\d+)\b', line)
        if m:
            if current_lines:
                segments.append((current_id, current_lines))
            current_id = m.group(1)
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        segments.append((current_id, current_lines))

    return segments

def read_lines(path):
    with open(path, encoding='utf-8') as f:
        return f.readlines()

head_lines = read_lines(head_path)
work_lines = read_lines(work_path)

head_sections = parse_sections(head_lines)
work_sections = parse_sections(work_lines)

# HEAD のセクションを task_id -> lines の辞書に。None（前文）は特別扱い。
head_map = {}
for tid, tlines in head_sections:
    head_map[tid] = tlines

restored_ids = []
result_lines = []

for tid, tlines in work_sections:
    if tid is None:
        # 前文（サマリ表含む）: 作業ツリー版を保持（サマリ表の更新を許す）
        result_lines.extend(tlines)
    elif tid == selected:
        # 選択タスクのセクション: 作業ツリー版を保持（自タスクの前進を許す）
        result_lines.extend(tlines)
    elif tid in head_map:
        # その他のタスクセクション: HEAD 版と比較し、変更があれば HEAD で復元
        if tlines != head_map[tid]:
            result_lines.extend(head_map[tid])
            restored_ids.append(tid)
        else:
            result_lines.extend(tlines)
    else:
        # HEAD に存在しない新規セクション（このティックが追加したもの）: 保持
        result_lines.extend(tlines)

# HEAD に存在するが作業ツリーで削除されたセクション（自タスク以外）を復元
work_ids = {tid for tid, _ in work_sections if tid is not None}
for tid, tlines in head_sections:
    if tid is None:
        continue
    if tid not in work_ids and tid != selected:
        result_lines.extend(tlines)
        restored_ids.append(tid + '(deleted)')

if restored_ids:
    with open(work_path, 'w', encoding='utf-8') as f:
        f.writelines(result_lines)
    sys.stderr.write('FIELDCARD_RESTORED ' + ','.join(restored_ids) + '\n')
PYFIELDGUARD
  local rc=$?
  rm -f "$HEAD_FILE"
  return $rc
}

# cxo スコープのみ: フィールド表カード本文の保護ガード
if [ "$SCOPE_LABEL" = "cxo" ]; then
  FGUARD_LOG="$(guard_fieldcard_body 2>&1)"
  if echo "$FGUARD_LOG" | grep -q 'FIELDCARD_RESTORED'; then
    FRESTORED_IDS="$(echo "$FGUARD_LOG" | sed -nE 's/.*FIELDCARD_RESTORED (.*)/\1/p')"
    echo "[$(TS)] [$SCOPE_LABEL] GUARD(MC-107): フィールドカードセクションを HEAD から復元した（他タスク本文保護）: $FRESTORED_IDS"
    if [ "$DRY_RUN" != "1" ]; then
      git -C "$TRACKER_REPO" add "$TRACKER_REL" 2>/dev/null \
        && git -C "$TRACKER_REPO" commit -m "guard(MC-107): restore fieldcard sections the tick modified: $FRESTORED_IDS" 2>&1 | head -3 || true
    else
      echo "[$(TS)] [$SCOPE_LABEL] DRY_RUN: 復元のみ（commit せず）"
    fi
  fi
fi

echo "[$(TS)] [$SCOPE_LABEL] autonomous-worker tick done"
exit 0
