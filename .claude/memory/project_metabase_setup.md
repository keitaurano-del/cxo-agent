---
name: project-metabase-setup
description: Logic アプリの Metabase 分析ダッシュボード Phase 1 セットアップ進捗。Supabase 側は完了、Render 以降は Keita 手動操作待ち。
metadata:
  type: project
  originSessionId: 2026-05-23
---

Logic アプリの分析基盤として **Metabase Phase 1** を立ち上げ中。2026-05-23 にコード・SQL・migration・docs を main へ push 済（commit `cbca1fd`）。

**Why:** ceo 分析で「まず既存 Supabase データで MVP ダッシュボードを 1 週間で作るのがコスパ最大」と結論。PostHog 等のイベント計装は次フェーズ。

## ✅ 完了済（自動セットアップ済）

- Supabase Logic プロジェクト (`yctlelmlwjwlcpcxvmgx`, ap-southeast-2) に migration 021 適用
- `metabase_readonly` role 作成 (LOGIN, NOINHERIT, BYPASSRLS, public 全テーブル SELECT)
- `metabase_app` role 作成 (LOGIN, metabase schema 全権限)
- `public.metabase_users` view 作成 (auth.users から email_domain だけ抜き出し)
- `metabase` schema 作成

## ⏳ 未完了（Keita 手動操作待ち、別セッションで再開可）

### B. Render service 作成（15 分）
1. Render Dashboard > New > Blueprint
2. Repository: `keitaurano-del/logic`
3. Blueprint file: `infra/metabase/render.yaml`
4. 環境変数（パスワードは 1Password「Metabase Logic」参照）:
   - `MB_DB_USER` = `postgres.yctlelmlwjwlcpcxvmgx`（Pooler 形式）
   - `MB_DB_HOST` = `aws-0-ap-southeast-2.pooler.supabase.com`
   - `MB_DB_PORT` = `6543`
   - `MB_DB_DBNAME` = `postgres`
   - `MB_DB_PASS` = （1Password 参照）
   - `MB_SITE_URL` = service URL 確定後に設定

### C. Metabase 初回ログイン + データソース登録（10 分）
- Admin: `keita.urano@gmail.com`
- データソース「Logic Production」:
  - Host: `aws-0-ap-southeast-2.pooler.supabase.com`
  - Port: `6543`
  - User: `postgres.yctlelmlwjwlcpcxvmgx` or `metabase_readonly`（Pooler の形式は Supabase Dashboard > Settings > Database > Connection string で要確認）
  - Pass: 1Password 参照
  - SSL: required

### D. 5 Question + 1 Dashboard 登録（30 分）
- `+New > Question > Native Query` で `supabase/sql/dashboards/01_*.sql` 〜 `05_*.sql` をコピペ → Save
- `+New > Dashboard` で「Logic KPI Phase 1」作成、5 Question 配置（推奨: 上段=1,5 / 中段=2,3 / 下段=4）

## 関連ファイル

- `docs/ANALYTICS_DASHBOARD.md` — 全手順 + 指標の読み方 + トラブルシュート
- `supabase/migrations/021_metabase_readonly.sql` — migration 本体（適用済）
- `supabase/sql/dashboards/01〜05_*.sql` — 5 ボード SQL
- `infra/metabase/render.yaml` + `Dockerfile` — Render Blueprint

## パスワード管理

- `metabase_readonly` パスワード: 1Password「Metabase Logic Readonly」
- `metabase_app` パスワード: 1Password「Metabase Logic App」
- 漏洩時は `ALTER ROLE <role> WITH PASSWORD '...'` で即再発行可能（Supabase MCP `execute_sql` から実行）

## 関連 memory

- [[project-logic-mobile-only]] — 分析対象はモバイル中心
- [[reference-deploy-commands]] — Render 手動デプロイコマンド
- [[project-logic-render-auto-deploy]] — Render Production の自動デプロイ設定
