#!/bin/bash
# clipitnow-pdca.sh — ClipItNow 集客PDCAの自動サイクル（日次 09:10 JST）
# Plan/Do/Check/Act を回し続ける自律ループの「安全に自動化できる部分」を担う:
#   Check : /api/stats を計測しスナップショット（pv / uu / downloads / referrer）
#   Do    : IndexNow へ全URL再送信（Bing/Yandex への新鮮なクロール通知・冪等）
#   Act   : Vault の PDCAジャーナルに日付き1行追記。前回比で顕著な変化があれば記録
#   Report: 週次(月曜) または マイルストン時に Apollo #general フィードへ要約投稿
# ※ LP量産・コード変更などリスクを伴う「Do」は自動化せず、supervised で実施する（衝突/品質担保）。
set -uo pipefail

SITE="https://clipitnow.net"
VIDEODL="$HOME/projects/video-dl"
JOURNAL="$HOME/projects/obsidian-vault/30-Projects/videodl/pdca-log.md"
STATE="$HOME/logs/clipitnow-pdca-state.json"
DATE=$(TZ=Asia/Tokyo date +%Y-%m-%d)
DOW=$(TZ=Asia/Tokyo date +%u)   # 1=Mon
MC_ENV="$HOME/projects/cxo-agent/.mc.env"

echo "[$(date)] clipitnow-pdca start"

# ── Check: stats 取得 ─────────────────────────────
STATS=$(curl -s --max-time 20 "$SITE/api/stats" 2>/dev/null || echo "")
read -r PV24 PV7 DL7 UU7 REF_SEARCH <<EOF
$(printf '%s' "$STATS" | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
    pv=d.get("pageviews",{}); vis=d.get("visitors",{}); dl=d.get("downloads",{})
    refs=d.get("referrers_24h",[]) or []
    # 検索エンジン由来 referrer の件数（google/bing/yahoo/yandex/duckduckgo を含む名前）
    se=sum(r.get("count",0) for r in refs if any(k in str(r.get("name","")).lower() for k in ("google","bing","yahoo","yandex","duckduckgo","検索")))
    print(pv.get("24h",0), pv.get("7d",0), dl.get("7d",0), vis.get("uu_7d",0), se)
except Exception:
    print(0,0,0,0,0)
' 2>/dev/null)
EOF
PV24=${PV24:-0}; PV7=${PV7:-0}; DL7=${DL7:-0}; UU7=${UU7:-0}; REF_SEARCH=${REF_SEARCH:-0}

# ── Do: IndexNow 再送信 ───────────────────────────
INDEXNOW="失敗"
if OUT=$(cd "$VIDEODL" && python3 tools/indexnow_submit.py 2>&1); then
  echo "$OUT" | grep -qE "成功|200|202" && INDEXNOW="OK"
fi
NLP=$(cd "$VIDEODL" && python3 -c 'from server import GUIDES; print(len(GUIDES))' 2>/dev/null || echo "?")

# ── Act: 前回比とジャーナル追記 ─────────────────────
PREV_UU=0; PREV_SEARCH=0; PREV_DL=0
if [ -f "$STATE" ]; then
  read -r PREV_UU PREV_SEARCH PREV_DL <<EOF
$(python3 -c '
import json
try:
    d=json.load(open("'"$STATE"'"))
    print(d.get("uu7",0), d.get("ref_search",0), d.get("dl7",0))
except Exception:
    print(0,0,0)
' 2>/dev/null)
EOF
fi
python3 -c "import json; json.dump({'date':'$DATE','pv24':$PV24,'pv7':$PV7,'dl7':$DL7,'uu7':$UU7,'ref_search':$REF_SEARCH}, open('$STATE','w'))" 2>/dev/null

mkdir -p "$(dirname "$JOURNAL")"
[ -f "$JOURNAL" ] || printf '# ClipItNow 集客PDCAログ\n\n自動記録（clipitnow-pdca.sh・日次）。手動考察は随時追記。\n\n| 日付 | PV(24h) | PV(7d) | UU(7d) | DL(7d) | 検索流入(24h) | LP数 | IndexNow |\n|---|---|---|---|---|---|---|---|\n' > "$JOURNAL"
printf '| %s | %s | %s | %s | %s | %s | %s | %s |\n' "$DATE" "$PV24" "$PV7" "$UU7" "$DL7" "$REF_SEARCH" "$NLP" "$INDEXNOW" >> "$JOURNAL"

# ── マイルストン判定 ───────────────────────────────
MILESTONE=""
if [ "$REF_SEARCH" -gt 0 ] && [ "$PREV_SEARCH" -eq 0 ]; then
  MILESTONE="🎯 検索エンジン経由の流入を初めて確認（$REF_SEARCH 件/24h）＝インデックス開始のサイン"
elif [ "$UU7" -ge 20 ] && [ "$PREV_UU" -lt 20 ]; then
  MILESTONE="📈 週間ユニーク訪問が20を突破（$UU7 人）"
elif [ "$DL7" -gt 0 ] && [ $((DL7 - PREV_DL)) -ge 10 ]; then
  MILESTONE="⬇️ 週間DLが増加（$PREV_DL→$DL7）"
fi

# ── Report: 週次(月) or マイルストン時に #general へ投稿 ──
if [ "$DOW" = "1" ] || [ -n "$MILESTONE" ]; then
  AGENT_TOKEN=$(grep '^AGENT_TOKEN=' "$MC_ENV" 2>/dev/null | cut -d= -f2-)
  if [ -n "${AGENT_TOKEN:-}" ]; then
    REPORT="📊 ClipItNow 集客PDCA（$DATE）
・PV: 24h=$PV24 / 7d=$PV7　UU(7d)=$UU7　DL(7d)=$DL7
・検索流入(24h)=$REF_SEARCH　LP数=$NLP　IndexNow=$INDEXNOW"
    [ -n "$MILESTONE" ] && REPORT="$REPORT
$MILESTONE"
    [ "$REF_SEARCH" = "0" ] && REPORT="$REPORT
※検索流入ゼロ継続中。最大レバーは Google Search Console のインデックス登録申請（要Keita操作・手順は videodl/gsc-index-guide.md）。"
    curl -s -X POST "http://localhost:4317/api/chat/agent-message" \
      -H "Content-Type: application/json" \
      -d "{\"token\":\"$AGENT_TOKEN\",\"channelId\":\"general\",\"senderId\":\"masayoshi\",\"senderName\":\"Masayoshi\",\"senderEmoji\":\"📋\",\"text\":$(printf '%s' "$REPORT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}" \
      >/dev/null 2>&1 && echo "[$(date)] report posted"
  fi
fi

echo "[$(date)] clipitnow-pdca done (pv24=$PV24 uu7=$UU7 dl7=$DL7 search=$REF_SEARCH indexnow=$INDEXNOW)"
