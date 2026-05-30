---
name: feedback-logic-auth-magiclink-only
description: Logic アプリの認証はマジックリンクのみ。OTPコード入力方式・Googleログインは使わない方針。
metadata:
  type: feedback
  originSessionId: 2026-05-16
---

Logic アプリのログイン方式は **メールマジックリンクのみ**。

**Why:** 2026-05-16 Keita 明示。
- OTP コード入力方式: Supabase の `mailer_otp_length` 設定との不整合でトラブルが多発した（8桁/6桁ミスマッチで `otp_expired` ループ、ユーザー混乱）
- Google ログイン: `google-services.json` / SHA-1 / Firebase / 追加プラグインなど設定コストが大きい割にメリット薄い

シンプルに「メールアドレス入力 → リンクが届く → タップしてログイン」だけに統一する。

**How to apply:**
- `signInWithOtp({ email, options: { emailRedirectTo: 'logic://auth' } })` でリンク送信
- メールテンプレは `{{ .ConfirmationURL }}` だけ。`{{ .Token }}` の 6桁/8桁コードは表示しない
- アプリ側に OTP コード入力 UI を実装しない。送信完了後は「メールを確認してください」状態のみ
- `verifyEmailOtp()` 関数も不要（Deep link 経由の `handleAuthRedirect` で `setSession` または `exchangeCodeForSession` する）
- Google ログインボタンも UI から削除。`loginWithGoogle()` 関数・`@codetrix-studio/capacitor-google-auth` 関連設定 (`GoogleAuth` plugin config, `serverClientId`) も削除
- 提案するときに OTP コード方式・Google ログインを **持ち出さない**。新しい認証方法を追加するときは必ず事前に Keita 確認

**関連:** [[project-logic-mobile-only]]（Web 版はリリースしないので、Web 用の OAuth リダイレクトも不要）
