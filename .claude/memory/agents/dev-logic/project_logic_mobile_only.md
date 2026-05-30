---
name: project-logic-mobile-only
description: Logic は本番モバイルアプリ専用。Web 版は Render 上で動いてはいるが本番リリース・マーケ対象外。Android/iOS の体験を最優先する。
metadata:
  type: project
  originSessionId: 2026-05-16
---

Logic はモバイルアプリ（Android、将来 iOS）専用プロダクトとして本番リリースする。Web ビルドは Render 上で動いており Capacitor 用に必要だが、**Web 単体ではマーケ・本番ユーザー獲得をしない**。

**Why:** 2026-05-16 Keita 明示。「Web は本番でリリースしないよ。アプリだけ」。SaaS ではなくアプリストアでの配布をビジネスモデルに据えている。

**How to apply:**
- 新機能や UX 改善の優先順位は **モバイル体験 > Web 体験**。Web 限定の機能追加は基本不要
- 認証や決済の deep link / native フローを優先。Web の OAuth リダイレクト系は最小限の維持で OK（QA・開発用に動けば十分）
- マーケ施策・LP・SEO 投資は Web に振らない。ストア最適化（ASO）・アプリ内動線が中心
- Redirect URL 登録などの dashboard 設定は Android（`logic://auth`）を必須・Web (`https://logic-u5wn.onrender.com/auth/callback`) は登録任意
- 「Web 版を公開しよう」「LP 整備しよう」など Web 起点の提案は、まずモバイル ASO や Play Store/App Store の改善で代替できないか検討する
- iOS 版は未着手。優先度は Keita 判断（[[project-logic-android-deploy]] 参照、iOS workflow は未整備）

関連: [[reference-deploy-commands]]（Render 本番 URL は backend / Capacitor 用に維持）、[[project-logic-android-deploy]]
