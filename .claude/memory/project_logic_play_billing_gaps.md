---
name: logic-play-billing-gaps
description: Logic Play Billing 実装の既知ギャップ。1.0.0 Production リリース時点（2026-05-18）でリスク受容して出したため、近い将来必ず修正が必要。
metadata: 
  node_type: memory
  type: project
  originSessionId: d367efc7-d5bb-4031-9d2e-ca4c92b84a57
---

Logic Android アプリの Google Play Billing 実装は 2026-05-18 時点で **正常系のサブスク購入フローは完成済み**だが、Play ポリシー的に必須な要件が幾つか欠けている。1.0.0 Production リリースは Keita のリスク受容判断で出したが、有料購読者が出始める前に必ずパッチを当てる前提。

**Why:** ポリシー要件を満たさない購入処理は (a) 自動返金、(b) Play Console 警告、(c) アプリの停止／削除リスクに繋がる。1.0.0 は機能リリース優先で出したが「課金を売る前」に直す必要がある。

**実装済みのもの:**
- `android/app/src/main/java/com/logicalthinking/app/billing/InAppBillingPlugin.kt`：BillingClient 7.0.0、initialize/getProducts/purchaseProduct/restorePurchases/queryPurchaseHistory
- `src/billing/index.ts`：Capacitor wrapper
- `server/routes/billing.ts` `POST /api/billing/verify`：Google Play Developer API で `purchases.subscriptions.get` 実検証 + Supabase `subscriptions` upsert
- `src/subscription.ts startCheckout()`：`purchaseProduct → verifyPurchase` チェーン
- Stripe ルートは完全撤去済み（2026-05-04）

**ギャップ（要修正、優先度高い順）:**

1. **🔴 `acknowledgePurchase` 未実装** — Play Billing 必須。購入から 3 日以内に acknowledge しないと自動返金される。修正案：
   - サーバー `verifyPurchase` 内で `androidpublisher.purchases.subscriptions.acknowledge({ packageName, subscriptionId, token })` を呼ぶ
   - もしくは native plugin に `acknowledgePurchase` メソッドを追加し、フロントの `startCheckout` から verify 後に呼ぶ
   - サーバー実行が望ましい（クライアント実装漏れの影響を受けない）

2. **🟠 RTDN (Real Time Developer Notifications) 未対応** — 解約・更新・払い戻し・grace period 入りが反映されない。Play Console で Pub/Sub topic を設定 → Cloud Run / Express endpoint で受信 → Supabase の `subscriptions.status` を更新する仕組みが必要。

3. **🟠 `onBillingServiceDisconnected` 再接続なし** — `InAppBillingPlugin.kt:50` 付近で warn log のみ。`startConnection` retry を実装すべき。

4. **⚪ Play Console SKU 登録確認** — `logic_paid_monthly` / `logic_paid_yearly` が Play Console の "Subscriptions" で Active として登録され、Production 向け価格が設定されているか Keita 確認が必要。

5. **⚪ `initBilling()` の起動時呼び出し確認** — App エントリーポイント（AppV3.tsx もしくは Capacitor ready）で呼ばれているか未確認。

**How to apply:**
- Production リリース後、課金フロー UI（プラン選択画面）への動線を **ユーザーに広く宣伝しない**まま、まず #1 acknowledgePurchase を最優先で実装する
- Play Console でテストアカウント購入 → 3 日間放置して返金されないか確認するのが受入テスト
- ASO・マーケ施策で課金 CTA を強調する前に #1 と #4 は必須完了
- 修正完了後はこのメモリを更新 or 削除する

**関連:** [[project-logic-android-deploy]]、[[project-logic-mobile-only]]、[[feedback-logic-marketing]]
