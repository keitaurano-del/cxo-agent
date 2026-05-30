---
name: feedback-audit-triage-correctness-first
description: 監査で検出した correctness 系（内容と図/データの食い違い等）の指摘は、サンプル承認を待たず即修正(Bucket1)に寄せる。サンプル承認ルールはコンテンツ"生成"の話で、"誤り修正"には適用しない。
metadata:
  type: feedback
  originSessionId: 2026-05-25
---

監査（logic-coach / designer 等）で検出した指摘を triage するとき、**correctness バグ（内容と表示が食い違っている＝明確な誤り）はデフォルトで即修正（Bucket1）に入れる**。サンプル承認待ち（Bucket2/3）に回さない。

**Why:** 2026-05-25 のコンテンツ監査で、designer の Phase3 が「ADHD レッスンの LeveragePoints 図が default のまま（ADHDの4資源と無関係）」「ThreePillars/LogicTree の default 流用」「lesson-304 アブダクションに演繹図（概念逆転）」を正しく検出していた。にもかかわらず林が「バルクのコンテンツ展開はサンプル承認を取ってから」（[[feedback-logic-course-thumbnails]] の慎重ルール）を当てはめ、これらを Bucket2/3 に回して本番に残してしまった。Keita が実機で気づいて指摘。検出は効いていたので、欠陥は triage 判断の方にあった。

**How to apply:**
- 「サンプル1枚で承認 → 全体展開」のルールは **新規コンテンツ"生成"**（サムネ大量生成、visualProps の文言を新規に大量作文 等、見た目の好みが分かれるもの）に適用する。
- **既に間違っているものを正す"correctness 修正"**（内容と図の食い違い、計算ミス、概念逆転、誤訳、誤配置）は、サンプル承認を待たず即修正に回す。間違った表示を本番に残す方がユーザー体験上の害が大きい。
- 監査レポートで重大度「高〜中」かつ correctness 系（"内容とズレ" "誤り" "矛盾" "逆転"）と判定されたものは、デフォルト Bucket1（即実装→QA→PR）。Bucket2/3 に回すのは「構造再編・主観・新規デザイン・大量新規作文」など本質的に Keita 判断が要るものに限る。
- 迷ったら「これは"誤りを正す"のか"新しく作る"のか」で振り分ける。前者は即、後者はサンプル承認。

**関連:** [[project-logic-content-audit-20260525]]、[[feedback-logic-course-thumbnails]]（サンプル承認ルールの元）
