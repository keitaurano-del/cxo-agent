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

**完了済みギャップ:**

1. **✅ `acknowledgePurchase` 実装済（2026-05-18 PR #203 / commit `ac40f4d`）** — `server/routes/billing.ts` line 85-99 で `androidpublisher.purchases.subscriptions.acknowledge` をサーバー側実行。`acknowledgementState === 0` のときのみ呼ぶ冪等化付き。ack 失敗は `console.error` でログのみ、verify 結果は返す設計

**残ギャップ（要修正、優先度高い順）:**

2. **🟠 RTDN (Real Time Developer Notifications) 未対応** — 解約・更新・払い戻し・grace period 入りが反映されない。Play Console で Pub/Sub topic を設定 → Cloud Run / Express endpoint で受信 → Supabase の `subscriptions.status` を更新する仕組みが必要。

3. **🟠 `onBillingServiceDisconnected` 再接続なし** — `InAppBillingPlugin.kt:50` 付近で warn log のみ。`startConnection` retry を実装すべき。Kotlin 側修正 = Android 再ビルド・再配信が必要。

4. **⚪ Play Console SKU 登録確認** — `logic_paid_monthly` / `logic_paid_yearly` が Play Console の "Subscriptions" で Active として登録され、Production 向け価格が設定されているか Keita 確認が必要。

5. **⚪ `initBilling()` の起動時呼び出し確認** — App エントリーポイント（AppV3.tsx もしくは Capacitor ready）で呼ばれているか未確認。

**How to apply:**
- #1 acknowledge は完了。これで「3 日放置で返金」リスクは解消されている
- 次の優先は **#2 RTDN**（解約・払い戻し追跡）— インフラ寄りで Pub/Sub 設定が必要、Keita 相談案件
- **#3 native 再接続**は Kotlin 修正＋再配信なのでまとめてやるのが効率的
- **#4 SKU 確認**は Keita が Play Console で確認するだけ
- **#5 initBilling 呼出確認**はコードレビュー 5 分で済む（凜が単独で完結可）
- ASO・マーケ施策で課金 CTA を強調する前に #4 は必須確認

**関連:** [[project-logic-android-deploy]]、[[project-logic-mobile-only]]、[[feedback-logic-marketing]]
