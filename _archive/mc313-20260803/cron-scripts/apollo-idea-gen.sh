#!/usr/bin/env bash
# apollo-idea-gen.sh — アポロ開発アイデア生成（オンライン × オフラインのミックス）
# 2026-08-01 Keita「アポロ開発のアイデア生成を、オンラインとオフラインのミックスで」→「まかせる」。
#
# 2段構成:
#  1) オフライン内省（web不使用・箱の中だけ）:
#     ボード履歴・memory/feedback・直近 daily notes・稼働ログ を材料に、
#     アポロ開発で繰り返す「痛み・停滞・ギャップ・機会」を抽出する。
#  2) オンライン合成（web_search 使用）:
#     抽出した痛みごとに外部の解決策・先行事例・新技術を調べ、
#     実装可能なアポロ開発アイデアを根拠リンク付きでランク付け生成する。
#  → Vault の 20-Knowledge/apollo-ideas/ に日次レポート＋アイデアキューを書き出す。
#     ボードへの起票は Keita/Masayoshi の triage に委ねる（自動起票はしない）。
#
# 可逆・安全:
#  - kill-switch: ~/.apollo-idea-gen.disabled があれば何もしない。
#  - 外部送信なし（Vault へ書くだけ）。revert はこの .sh と cron 行と OUT_DIR を消すだけ。
#  - 破壊的 git は行わない。既存資産は無改変。
set -uo pipefail
export TZ=Asia/Tokyo

HOME_DIR="${HOME:-/home/dev}"
if [ -f "$HOME_DIR/.apollo-idea-gen.disabled" ]; then
  echo "[$(date)] apollo-idea-gen: disabled (kill-switch present)"; exit 0
fi

DATE=$(date +%F)
BOARD="$HOME_DIR/projects/cxo-agent/docs/TASK_TRACKER.md"
MEM_DIR="$HOME_DIR/.claude/projects/-home-dev-projects/memory"
DAILY_DIR="$HOME_DIR/projects/memory"
LOG_DIR="$HOME_DIR/logs"
OUT_DIR="$HOME_DIR/projects/obsidian-vault/20-Knowledge/apollo-ideas"
QUEUE="$OUT_DIR/idea-queue.md"
REPORT="$OUT_DIR/apollo-ideas-${DATE}.md"
mkdir -p "$OUT_DIR" "$LOG_DIR"

# openclaw agent（web_search 使える main エージェント）を叩いて可視テキストを取り出す。
# daily-news-briefing.sh と同じ抽出ロジック（新旧 JSON 形状の両対応）。
run_agent() {  # $1=prompt  $2=session-suffix  $3=timeout秒  → stdout に本文
  local prompt="$1" suffix="$2" to="${3:-1200}" tmp text
  tmp=$(mktemp /tmp/apollo-idea-XXXXXX.json)
  openclaw agent --agent main \
    --model anthropic/claude-sonnet-4-6 \
    --session-key "agent:main:apollo-idea-${DATE}-${suffix}" \
    --timeout "$to" \
    -m "$prompt" \
    --json 2>/dev/null > "$tmp" || true
  text=$(jq -r '
    (.result // .) as $r |
    if ($r.meta.finalAssistantVisibleText // "") | length > 60 then $r.meta.finalAssistantVisibleText
    elif ($r.meta.finalAssistantRawText // "") | length > 60 then $r.meta.finalAssistantRawText
    else [$r.payloads[]?.text // ""] | join("") end
  ' "$tmp" 2>/dev/null || echo "")
  rm -f "$tmp"
  printf '%s' "$text"
}

# ── (0) オフライン内部シグナル収集（shell のみ・回線不要） ─────────────
SIG=$(mktemp /tmp/apollo-sig-XXXXXX.md)
{
  echo "## ボード状況（cxo-agent TASK_TRACKER）"
  if [ -f "$BOARD" ]; then
    echo "- ステータス分布:"
    grep -E '^\| *MC-[0-9]+ *\|' "$BOARD" | awk -F'|' '{s=$6; gsub(/^ +| +$/,"",s); c[s]++} END{for(k in c) printf "  - %s=%d\n",k,c[k]}'
    echo "- BLOCKED / REVIEW（停滞・判断待ちの兆候、末尾40行）:"
    grep -E '^\| *MC-[0-9]+ *\|' "$BOARD" | awk -F'|' '{s=$6; gsub(/^ +| +$/,"",s)} s=="BLOCKED"||s=="REVIEW"{print}' | tail -40
  else echo "(board not found)"; fi
  echo
  echo "## Keita のフィードバック/嗜好（memory feedback_*）"
  grep -rhoE '—.*$' "$MEM_DIR"/feedback_*.md 2>/dev/null | sed 's/^— *//' | head -60
  echo
  echo "## 直近の daily notes（末尾抜粋）"
  ls -1t "$DAILY_DIR"/2026-*.md 2>/dev/null | head -5 | while read -r f; do
    echo "### $(basename "$f")"; tail -c 1400 "$f"; echo
  done
  echo
  echo "## 稼働ログの異常兆候（watchdog/keeper/night-patrol の末尾）"
  for L in apollo-watchdog apollo-keeper night-patrol; do
    if [ -f "$LOG_DIR/$L.log" ]; then
      echo "### $L"
      grep -iE 'error|fail|restart|down|stale|timeout|exception|429' "$LOG_DIR/$L.log" 2>/dev/null | tail -12
    fi
  done
} > "$SIG" 2>/dev/null
# トークン抑制のため上限で切る。
head -c 12000 "$SIG" > "$SIG.cap" 2>/dev/null && mv "$SIG.cap" "$SIG"
echo "[$(date)] offline signals collected ($(wc -c < "$SIG") bytes)"

# ── (1) オフライン内省: 内部シグナルから痛み・機会を抽出（web不使用） ──────
OFFLINE_PROMPT="あなたはアポロ（社内ミッションコントロール・ダッシュボード＝cxo-agent、React+Vite、Vultr常駐、token認証、モバイル＋cloudflaredトンネル運用）の開発計画担当です。
以下は「箱の内部シグナルだけ」（web不使用）です。ここから、アポロ開発で繰り返し現れる『痛み・停滞・ギャップ・機会』を最大8個、重複を排して抽出してください。
厳守: web検索はしない。提示シグナルに根ざし、憶測を足さない。各項目は1〜2行で簡潔に。
出力は箇条書きのみ。各行の形式: 「- 痛み/機会: … ／ 根拠: …」

=== 内部シグナル ここから ===
$(cat "$SIG")
=== 内部シグナル ここまで ==="

PAINS=$(run_agent "$OFFLINE_PROMPT" "offline" 900)
[ -z "$PAINS" ] && PAINS=$(run_agent "$OFFLINE_PROMPT" "offline-retry" 900)
rm -f "$SIG"
if [ -z "$PAINS" ]; then
  echo "[$(date)] apollo-idea-gen: offline mining returned empty — abort (no report written)"; exit 1
fi
echo "[$(date)] offline pains extracted (${#PAINS} chars)"

# ── (2) オンライン合成: 外部を調べて実装可能なアイデアに落とす（web_search 使用） ──
ONLINE_PROMPT="あなたはアポロ開発のアイデア出し担当です。下記『内部で見つかった痛み・機会』それぞれについて、web_search で外部の解決策・先行事例・新しい技術/ライブラリ/UXパターンを調べ、実装可能なアポロ開発アイデアに落としてください。
アポロの制約（重要）: cxo-agent（React+Vite フロント、systemd 常駐、Vultr、token認証、モバイル＋cloudflared 前提）。方針はトークン節約・小さく作る・可逆。誇大な提案でなく現実的に。
各アイデアの形式:
- ### 〈タイトル〉
- 狙い: どの内部痛みに効くか（1行）
- オンライン要素 / オフライン要素: 該当するものを簡潔に
- 参考: 実在する URL を1〜2本（確認できたもののみ。無ければ「なし」）
- 見積り: S / M / L と「最初の一歩」
効果 × 手軽さ で上から並べ、5〜8個。日本語。
出力は Markdown 本文のみ（frontmatter・前置き・全体を囲むコードフェンスは付けない）。

=== 内部で見つかった痛み・機会 ===
$PAINS"

IDEAS=$(run_agent "$ONLINE_PROMPT" "online" 1500)
[ -z "$IDEAS" ] && IDEAS=$(run_agent "$ONLINE_PROMPT" "online-retry" 1500)
if [ -z "$IDEAS" ]; then
  echo "[$(date)] apollo-idea-gen: online synthesis empty — write pains-only report"
  IDEAS="（オンライン合成が空応答でした。内部で抽出した痛み・機会のみ掲載します。）"
fi
echo "[$(date)] online ideas synthesized (${#IDEAS} chars)"

# ── (3) Vault へ書き出し（frontmatter はスクリプト側で付与） ─────────────
{
  echo "---"
  echo "title: アポロ開発アイデア（オンライン×オフライン）$DATE"
  echo "date: $DATE"
  echo "generator: apollo-idea-gen.sh"
  echo "tags: [apollo, ideas, dev]"
  echo "---"
  echo
  echo "# アポロ開発アイデア（オンライン × オフライン）— $DATE"
  echo
  echo "> オフライン内省（箱の内部シグナル）→ オンライン合成（web 調査）で生成。ボードへの起票は triage で。"
  echo
  echo "## 1. オフラインで見つかった痛み・機会（内部シグナル由来）"
  echo
  printf '%s\n' "$PAINS"
  echo
  echo "## 2. オンライン合成した開発アイデア（外部調査つき）"
  echo
  printf '%s\n' "$IDEAS"
} > "$REPORT"
echo "[$(date)] report written: $REPORT"

# アイデアキュー（triage 用の追記ログ）に見出しだけ積む。
{
  echo
  echo "## $DATE"
  printf '%s\n' "$IDEAS" | grep -E '^### ' | sed 's/^### /- [ ] /'
  echo "  ↳ 詳細: apollo-ideas-${DATE}.md"
} >> "$QUEUE"

# Vault を名指し add でコミット（破壊的 git 禁止・add は名指しのみ）。
if command -v git >/dev/null 2>&1; then
  ( cd "$HOME_DIR/projects/obsidian-vault" \
    && git add "20-Knowledge/apollo-ideas/apollo-ideas-${DATE}.md" "20-Knowledge/apollo-ideas/idea-queue.md" 2>/dev/null \
    && git commit -m "apollo-idea-gen: ideas $DATE" >/dev/null 2>&1 ) || true
fi

echo "[$(date)] apollo-idea-gen done"
