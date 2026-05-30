---
name: feedback-default-workflows
description: 規模のある多段作業は毎回 Claude Code の /workflows（Workflowツール）で可視化して回すのが標準
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2f79ffcf-1087-4972-9d79-50ced3d3bb8f
---

規模のある多段作業（複数項目の実装バッチ、全画面の設計、監査、調査など）は、毎回 Claude Code の `/workflows`（Workflow ツール）で**ラベル付きの孫エージェントをツリー可視化しながら**回すのを標準とする（2026-05-30 明示指示「workflowsでみえるようにしてほしい。あとこれはこれから毎回やってほしい」）。

**Why:** 1個の巨大エージェントに詰めると進捗ウィジェットに「dev-logic」としか出ず、中で何を作っているか Keita から見えない。項目ごとにラベルを付けて workflow で並べると「今どれを作っているか」が一覧で分かる。可視性が Keita の重視点。

**How to apply:**
- 単発・会話的な軽作業以外は Workflow ツールで組む。各 agent() に項目名の label を付け、phase で束ねる。
- 実装は[[feedback-delegate-dev]]のとおり dev-logic 等に委譲（agentType 指定）。林は実装を巻き取らない。
- 並行化はファイル非重複のバケツに割って行う（git の同時コミットはレースするので、コミットはオーケストレーターが直列に。詳細はこの日のUI-1〜12バッチの進め方参照）。
- stall 対策に Monitor で生存監視を併設し、固まったら resumeFromRunId で resume する。
- 呼称は[[feedback-address-keita]]。
