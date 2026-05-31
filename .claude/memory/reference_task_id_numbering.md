---
name: reference-task-id-numbering
description: TASK_TRACKER のタスクID採番は目視で数えず next-task-id.sh を使う。重複事故（MC-64/65衝突等）の再発防止。
metadata:
  type: reference
  originSessionId: 2026-05-31
---

TASK_TRACKER.md に新タスクIDを採番するときは、目視で最大値を数えず、必ず採番ヘルパーを使う。

```
bash /home/dev/cron-scripts/next-task-id.sh <PREFIX> [個数]
#   MC  → MC-68     FB 2 → FB-11 FB-12     UI → UI-28     AF → AF-03
```

**Why:** 2026-05-31、task-manager が古い台帳状態を見て MC-64/65 を採番し、林が直前に起票した MC-64(deploy連動)/MC-65(autonomous-rin可視化) と衝突した。原因は3つ重なる: (1) 台帳が60〜85KBと巨大で末尾を見落とす、(2) 並行起票のレース（先行起票を知らずに採番）、(3) ツール出力注入で Read 結果が汚染される。「目視で数えて+1」方式が構造的に弱い。

**How to apply:**
- スクリプト `/home/dev/cron-scripts/next-task-id.sh` は全 TASK_TRACKER（logic/cxo-agent/en-chakai/西丸町）を bash で直接 grep し、指定プレフィックスの実在最大連番+1 を返す。複数要るときは個数指定で一括予約。bash 実ファイル読みなので注入の影響を受けない。
- 起票は **直列化** する。複数の task-manager を同時に走らせない（オーケストレーターの林が1件ずつ投げる）。並行で投げると採番がレースする。
- 起票直前に `git pull --rebase` で最新を取り込んでから採番。
- このスクリプトは Vultr 新箱（実運用の主機）固有。autonomous-rin / headless 林 / 対話林すべてこのマシンで動くので実害なし。別マシンで採番が要るときはパスを読み替える。
- 新プレフィックスを足すとき（例 新プロジェクト）は next-task-id.sh の TRACKERS 配列に台帳パスを追加する。

**関連:** [[project-task-manager]]、[[feedback-route-all-to-task-manager]]、[[reference-tool-output-injection-incident]]
