---
name: reference-apollo-restart-stale-routes
description: Apollo を git 操作（pull --rebase/merge）の途中で restart すると、過渡的なファイル状態を掴んで一部 /api ルートが未登録のまま起動する。未登録パスは SPA フォールバックで 200+HTML を返すため「全 API 200」に見えて隠れる。診断は endpoint の中身が JSON か HTML かで判定。
metadata:
  type: reference
  originSessionId: 2026-06-01
---

Apollo（mission-control.service、`tsx src/index.ts`）を **git 操作の途中で restart すると、中途半端なファイル状態をロードして一部 API ルートが未登録のまま起動する**ことがある。

**Why（2026-06-01 実例）:** 「ティックをクリックすると『読み込みに失敗しました』」を調査。`/api/ticks` を叩くと HTTP 200 だが中身が JSON でなく index.html（SPA フォールバック）だった＝走っているプロセスに `/api/ticks` ルートが登録されていなかった。原因は、サーバプロセスが pull --rebase の過渡的な working tree（`/api/ticks` ルートを含む index.ts がまだ書き戻される前）でロードされ、正しいファイル（collectors/ticks.ts）はプロセス起動の数分後に書かれていた＝プロセスが disk より古い。disk のコードは元々正しく、クリーン restart で解消した。

**落とし穴のポイント:**
- Express の SPA フォールバック（`app.get('/*splat', sendFile index.html)`）が、**未登録の `/api/*` パスにも 200 + HTML を返す**。だから `curl -o /dev/null -w "%{http_code}"` で「全部 200」に見えても、実は一部はルート未登録でフォールバックしている。ステータスコードだけ見ると隠れる。

**How to apply（診断と予防）:**
- 「Apollo の特定ビューだけ『読み込みに失敗しました』（components/ui.tsx の汎用エラー or 各 view のエラー文）」が出たら、まずそのビューが叩く `/api/<x>` の**中身**を確認する: `curl -s ".../api/<x>" -H "Authorization: Bearer $MC_TOKEN" | head -c 80`。`<!doctype html>` が返れば**そのルートは走行プロセスに未登録**＝stale/partial restart の疑い。JSON が返れば別問題（フロントのデータ整形等）。
- 対処は **クリーン restart**: `sudo systemctl restart mission-control.service` → `MainPID` が変わったことと healthz 200 を確認 → 当該 endpoint が JSON を返すか再確認。disk のコードが正しければこれで直る。
- 予防（番人の restart 手順）: **restart は working tree が落ち着いてから**やる。pull --rebase / merge / cxo 自律ループのティック実行中など、ファイルが書き換わっている最中に restart しない。restart 前に `git status` が安定し、`git log` の HEAD が期待どおりか確認する。
- 関連診断: ルート登録順は index.ts で `/api/*` 群 → 最後に `express.static` + SPA fallback の順なので、順序バグではなく「プロセスが古い」を先に疑う。MC_TOKEN は `grep MC_TOKEN /home/dev/projects/cxo-agent/.mc.env`。

**関連:** [[project-apollo-dashboard]]（server 変更は restart 必須・watch 無し）、[[project-apollo-keeper]]（番人が restart を担う）、[[feedback-apollo-keeper-board-reconcile]]
