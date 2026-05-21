---
name: Logic コースサムネイルは手書きフォント+図解スタイル（v4 PNG / Figma 製）
description: Logic アプリのコース一覧サムネイルは Figma 制作 → PNG 書き出し（手書きフォント＋図解）で統一。SVG への巻き戻し禁止。
type: feedback
originSessionId: 7d04e427-5324-4d34-9f8f-c78e879fb838
---
Logic アプリのコースサムネイルは **`public/images/v3/course-*.png`（v4、Figma 製、26 コース分）** をマスターとする。「手書きフォント + 図解」スタイル。

**Why:**
- 2026-05-05 PR #93 / #95 で23コース分が方針外（ダーク背景 + 写実シーン構成）でマージ → 全件作り直し
- 2026-05-13 PR #140 で v4 PNG（Figma 製、Caveat フォント + クリーム notebook + 23 種図解）を投入し、コースサムネを正式にこのスタイルに統一
- 同日 PR #156 が「`docs/HANDDRAWN_ROLLOUT_PLAN.md` の旧前提（既存 SVG = handdrawn の正解）」を信じて `courseData.ts` の `.png → .svg` 巻き戻しを実行 → 26 枚デグレ事故（PR #157 で revert）

**How to apply:**
- 現行マスターは **`course-*.png`（v4 PNG）**。`courseData.ts` / `lessonSlides.ts` / `RoadmapScreenV3.tsx` の参照は **必ず `.png`** にする
- legacy `course-*.svg`（インライン SVG + turbulence filter で擬似手書き）は参照しない。**「.png → .svg に戻す」変更は基本デグレと疑う**
- 新規コース追加・サムネ作り直しは **v4 Figma マスター（https://www.figma.com/design/2SJYbSyMbBlSOyd3DJzbUc）** から複製 → PNG 書き出しが標準パイプライン
- ダーク背景・写実的シーン・人物シルエット中心の構図は採用しない
- Pixa は使わない（[[feedback-no-pixa]]）
- **2026-05-19 に全 116 枚（27 コース + 89 レッスン）を Gemini Nano Banana で Caveat 風 v3 に統一**（commit `376f008`）。STYLE は「クリーム notebook + Caveat-style chunky Title Case marker title + flowing coral underline + 図解」。マスターは `public/images/v3/{course,lesson}-*.png`。再生成系スクリプト:
  - `scripts/generate-course-thumbnails-v2.ts` — コース 27枚（16:9）
  - `scripts/generate-lesson-thumbnails-v2.ts` — 既存レッスン 49枚（1:1）
  - `scripts/generate-career-thumbnails.ts` — キャリア 5+35枚
  - `scripts/{course,lesson,career}PromptsV2.ts` — 各 entry 定義
  - `lessonPromptsV2.ts` の `titleCase()` ヘルパーで all-caps エントリを自動 Title Case 化（略語 whitelist 例外あり）
  - 個別再生成: `npx tsx scripts/generate-lesson-thumbnails-v2.ts --only=lesson-XX`
  - 旧 imagePrompts.ts (3D iso ダーク背景版、未使用) は方針外、参照しないこと
- home/hero（4 枚）は未対応。Phase 3 で同じトーンに揃える検討余地あり
- 関連 docs: `docs/HANDDRAWN_ROLLOUT_PLAN.md` / `docs/HANDDRAWN_STYLE_GUIDE.md`
- サンプル1枚で承認を取ってから全体展開する（過去事故の再発防止）
- Gemini で再生成する時のスペル崩し対策は [[feedback-gemini-prompt-tricks]] 参照
