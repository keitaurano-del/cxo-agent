---
name: project-logic-content-audit-20260525
description: 2026-05-25 に実施した Logic 全コンテンツ大規模監査キャンペーンの結果と成果物。カテゴリ再編は実装済(branch)、コンテンツ修正は Bucket 仕分けで進行中。
metadata:
  type: project
  originSessionId: 2026-05-25
---

2026-05-25、Keita 不在(約2h)の間に林が subagent を並列オーケストレーションして Logic アプリの全コンテンツ監査キャンペーンを実施した。

**Why:** カテゴリ監査(logic-coach)を起点に Keita が「レッスンのコース適合 / Visual 整合 / 受講順序 / レッスン単位の矛盾・スライド」まで全面見直しを指示。各エージェント提案→林 triage→実装→reviewer/test→push(ブランチ止め) のパイプラインで進めた。

**実施フェーズ（すべて完了）:**
- Phase1 カテゴリ/グループ再編(dev-logic): 7グループ構成へ。`restructure/categories` branch commit `3d07153`、QA green(tsc/eslint/vitest 122pass、Playwright の onboarding age step 1fail は既存バグで無関係と検証済)。カテゴリ改名は永続化に無影響(progress は lesson ID ベース)。
- Phase2 レッスン↔コース適合(logic-coach): 最大論点 client-01/02 の title↔中身入れ替わり。
- Phase3 Visual 整合(designer): ja 全239 explain 走査。lesson-304 アブダクションに演繹図(概念事故)、ThreePillars 等 default 流用多数。
- Phase4 受講順序(logic-coach): extra(3xx)をまとめ後置の順序逆転6コース。並べ替えのみで解消。
- Phase5 A-D レッスン精査(logic-coach×2/content-creator×2): focus の visualProps 実害バグ(default fallback)、fermi-224 計算誤り(ja のみ)、fermi-225 設問破綻、en パリティ多数。

**成果物:** `logic/docs/CONTENT_AUDIT_20260525.md` に全 findings + triage(Bucket1=客観実装/2=要Keita判断/3=デザイン/4=別トラック)。

**How to apply:**
- 続きを再開するときはこの doc の triage を見る。Bucket1 は dev-logic 実装中、Bucket2/3/4 は Keita 判断待ち。
- push ゲート方針: main は Keita 帰宅後にマージ。今回は branch+PR 止め(ceo 助言、本番自動デプロイ回避)。
- 監査ノウハウは logic-coach 定義の「監査プレイブック」に反映済([[project-designer-subagent]] の logic-coach 版成長)。
- 重要原則: バルクのコンテンツ生成(visualProps 一括追加・en 翻訳 backfill)はサンプル承認を取ってから展開([[feedback-logic-course-thumbnails]] と同じ運用)。

**関連:** [[feedback-logic-title-doing]]、[[feedback-app-copy-neutral]]、[[project-logic-render-auto-deploy]]、[[reference-deploy-commands]]
