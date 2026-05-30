---
name: reference-logic-supabase-project-id
description: Logic 本番 Supabase プロジェクトID（台帳に蔓延していた ref 付き表記は誤り）
metadata: 
  node_type: memory
  type: reference
  originSessionId: eb0e71bb-affa-4f30-9636-cf984c5e26f2
---

Logic 本番 Supabase プロジェクトID は `yctlelmlwjwlcpcxvmgx`。

TASK_TRACKER 等で `refyctlelmlwjwlcpcxvmgx` と書かれていた箇所があったが、`ref` プレフィックスは誤記。2026-05-30 の AM-R（管理者ジャーナルタグ統合の本番DB書き換え）実行時に dev-logic が実プロジェクトと突き合わせて判明・台帳訂正済み。Supabase MCP で execute_sql 等を叩くときは ref 無しの `yctlelmlwjwlcpcxvmgx` を使う。

関連: [[project_metabase_setup]]（同じ本番DB上のセットアップ）
