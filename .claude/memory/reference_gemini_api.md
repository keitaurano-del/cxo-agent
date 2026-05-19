---
name: reference-gemini-api
description: Gemini API は keita.urano2@gmail.com で AI Studio 経由でセットアップ済み。画像生成モデルは Paid plan 必須。
metadata:
  type: reference
  originSessionId: 2026-05-19
---

Gemini API 経由の画像生成を Logic プロジェクトで使う設定情報。

**アカウント:** keita.urano2@gmail.com（Keita のメインの keita.urano@gmail.com とは別アカウント）

**API キー:** logic の `.env` の `GEMINI_API_KEY` に設定済み。1Password にも「Gemini API Key」アイテムで保存（Windows の 1Password アプリ）。

**Billing 状態:** Google Cloud Billing に prepaid 課金紐付け済み（2026-05-19）。`https://aistudio.google.com/app/apikey` で Paid Tier 確認可能。

**重要な落とし穴:**
- 画像生成モデル（imagen-*, gemini-*-image-*）は **全部 Paid plan 必須**。Free tier だと `limit: 0` で全リクエスト 429 になる
- AI Studio で API キー作っただけだとテキストモデルしか使えない。Billing 紐付け必要
- Billing 直後は数分間レート制限に当たりやすい（数十秒待つと安定する）

**利用可能なモデル（2026-05 時点）:**
- `gemini-2.5-flash-image` (Nano Banana) — テキスト得意、$0.039/枚、レッスンサムネで採用
- `gemini-3.1-flash-image-preview` — 最新 Flash、価格未公表
- `gemini-3-pro-image-preview` — 最高品質、推定 $0.15/枚
- `imagen-4.0-fast-generate-001` — $0.02/枚、イラスト用
- `imagen-4.0-generate-001` — $0.04/枚、Standard
- `imagen-4.0-ultra-generate-001` — $0.06/枚

**スクリプト:**
- `logic/scripts/generate-lesson-thumbnails-v2.ts` — レッスンサムネ一括生成
- `logic/scripts/generate-lesson-sample.ts` — 1枚テスト
- `logic/scripts/lessonPromptsV2.ts` — プロンプト定義

**関連 memory:** [[feedback-gemini-prompt-tricks]]、[[feedback-logic-course-thumbnails]]
