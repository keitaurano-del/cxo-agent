---
name: feedback-quality-efficiency-accuracy
description: workflow設計は「効率・正確さ・クオリティ」を最適化基準にする（生成だけで終わらせず検証/レビュー段を必ず組む）
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2f79ffcf-1087-4972-9d79-50ced3d3bb8f
---

作業の組み立ては「いかに効率的に・正確に・良いクオリティで作れるか」を常に最適化基準にする（2026-05-30 明示指示）。[[feedback-default-workflows]]の workflow 化と一体で運用する。

**Why:** Keita は速さだけでなく、正確さと仕上がりの質を重視。生成しっぱなし(verify無し)だと、それっぽいが間違ったものが残る。

**How to apply（具体パターン）:**
- 効率: ファイル非重複バケツで並行化。冗長な全文読み込みを避ける(該当箇所だけ sed/grep)。stall は resumeFromRunId で resume、毎回最初からやり直さない。巨大ファイル(TASK_TRACKER 47KB等)を全エージェントに読ませない。
- 正確さ: エージェントは必ず実ソースに当てて回答(憶測禁止)。structured output(schema)で受け取り検証。重要主張は独立エージェントで adversarial verify(refute 前提で複数票)。
- クオリティ: workflow は「生成 → 検証/レビュー → 統合」を基本形にする。生成段の後に必ず独立した品質ゲートを置く:
  - コード: reviewer エージェントで独立レビュー＋ test 系(test-functional/test-sanity)で動作検証＋ tsc/eslint/vitest。
  - コンテンツ/設計: logic-coach で MECE/粒度/矛盾を監査、designer 統合で横断一貫性レビュー。
- 規模に応じてスケール: 軽作業は薄く、監査/刷新など重い依頼は finder 多め＋多票 verify＋synthesis を厚く。
