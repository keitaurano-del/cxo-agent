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

1. **✅ `acknowledgePurchase` 実装済（2026-05-18 PR #203 / commit `ac40f4d`）** — `server/routes/billing.ts` line 85-99 で `androidpublisher.purchases.subscriptions.acknowledge` をサーバー側実行。`acknowledgementState === 0` のときのみ呼ぶ冪等化付き

5. **✅ `initBilling()` 起動時呼び出し実装済（2026-05-21）** — `src/billing/index.ts` に `isAndroidNative()` ガード追加 + `src/AppV3.tsx` の最上位 useEffect 内で `void initBilling()` を呼出。Web/iOS では no-op、Android native のみ BillingClient.initialize() が走る

3. **✅ `onBillingServiceDisconnected` 再接続実装済（2026-05-21）** — `InAppBillingPlugin.kt` に `Handler(Looper.getMainLooper())` ベースの exponential backoff (1s → 2s → 4s → 8s → 16s、最大 60s クランプ) リトライを実装。最大 5 回まで試行、`onBillingSetupFinished` 成功時に `reconnectAttempts = 0` リセット、`handleOnDestroy` で pending callback とクライアントをクリーンアップ。CI (GitHub Actions android-deploy.yml) で Kotlin compile / AAB ビルド検証

2. **🟡 RTDN サーバー endpoint 実装済（2026-05-21）／ Play Console + GCP 設定残** — `server/routes/billing.ts` に `POST /api/billing/rtdn` を追加（commit `9aef074`）。Pub/Sub Push 形式の body を base64 デコード → notificationType (1〜13) に応じて Supabase `subscriptions.status` を更新（active/canceled/on_hold/in_grace_period/revoked/expired 等）。エラー時も常に 200 ack（Pub/Sub 再配信ループ回避）。`019_rtdn_columns.sql` で `notification_type_last`/`notification_received_at` カラム + `idx_subscriptions_gp_token` 部分インデックス追加。
   - **残課題**: (a) JWT 署名検証は未実装（Pub/Sub Push の `Authorization: Bearer` ヘッダを `google-auth-library` で検証する必要あり）、(b) Keita 側で GCP Pub/Sub topic 作成 + `google-play-developer-notifications@system.gserviceaccount.com` に publish 権限付与 + Play Console > Monetization setup > RTDN に topic 指定 + Push subscription 作成 (endpoint: `https://logic-u5wn.onrender.com/api/billing/rtdn`)、(c) Supabase 本番に `019_rtdn_columns.sql` migration 適用

**残ギャップ:**

4. **⚪ Play Console SKU 登録確認** — `logic_paid_monthly` / `logic_paid_yearly` が Play Console の "Subscriptions" で Active として登録され、Production 向け価格が設定されているか Keita 確認が必要。

**How to apply:**
- #1 acknowledge / #3 再接続 / #5 initBilling は完了済、リスク解消済
- #2 RTDN はサーバー側完了、Play Console + GCP 設定 + Supabase migration 適用は Keita 作業（手順は #2 セクション参照）
- #2 完了後、JWT 検証追加で完全クローズ
- **#4 SKU 確認**は Keita が Play Console で確認するだけ
- ASO・マーケ施策で課金 CTA を強調する前に #4 は必須確認

**関連:** [[project-logic-android-deploy]]、[[project-logic-mobile-only]]、[[feedback-logic-marketing]]
