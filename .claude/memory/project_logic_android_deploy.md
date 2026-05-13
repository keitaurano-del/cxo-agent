---
name: logic-android
description: "Logic Android アプリは main push で内部テスターへ自動 rollout される（status: completed）。Production track は初回公開済み。"
metadata: 
  node_type: memory
  type: project
  originSessionId: 26e077ed-506b-4d4b-8de3-9fcbabcccd82
---

Logic Android の内部テスト配信は **main 自動配信** で動いている（2026-05-13 セットアップ完了）。

**Why:** 元々 `.github/workflows/android-deploy.yml` は `status: completed` で組まれていたが、Play Console 上で Production track が未公開（draft app 状態）だったため「Only releases with status draft may be created on draft app.」エラーで連続失敗していた。Keita が Play Console で初回 Production リリースを公開して draft app 状態を解除、workflow を `status: completed` で再開。これで完全自動化された。

**現状の挙動:**
- `main` に push → `Android Deploy → Play Console (Internal Test, ...)` workflow 起動
- AAB ビルド → Play Console `internal` track に `status: completed` でアップロード
- 内部テスター（Keita 含む）の Play Store に数分〜1時間以内で更新通知
- 手動 promote 不要

**How to apply:**
- 「Logic を内部テストに配信して」と言われたら、`main` への push（または対象ブランチを main に merge）で完結する。Play Console を開く必要はない。
- versionCode は `GITHUB_RUN_NUMBER + 1000`、versionName は `1.5.<RUN_NUMBER>` で自動採番（手で触らない）
- workflow は `push: main` と `workflow_dispatch` の両方をサポート。手動再実行は `gh workflow run android-deploy.yml`
- **Alpha/Closed/Production track への配信は手動**: workflow が触るのは `internal` のみ。上位 track は Play Console UI で promote する設計（コメント参照）
- iOS 用 workflow は未整備。TestFlight 配信が必要になったら別途構築

**既知の workflow warning（要対応リスト）:**
- `track` パラメータが r0adkll/upload-google-play で deprecated。将来 `tracks` への移行必要
- Node.js 20 系の actions（checkout@v4, setup-node@v4, etc）が 2026-09 で動かなくなる。v5 系へバージョン更新必要

関連: [[reference_deploy_commands]]
