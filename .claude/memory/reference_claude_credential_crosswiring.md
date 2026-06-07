---
name: reference_claude_credential_crosswiring
description: 新箱の Claude credential ファイルとアカウントの実対応（C1/C2 取り違えの原因）
metadata: 
  node_type: memory
  type: reference
  originSessionId: af63e6db-4c6d-4201-af88-2220ffbdf5cf
---

新箱（/home/dev）の Claude credential ファイルの実対応（**2026-06-07 再検証で交差は解消済み**）:

- `~/.claude/.credentials.json` = **keita.urano**（API email = keita.urano@gmail.com で確認）
- `~/.claude-urano2/.credentials.json` = **keita.urano2**（settings.json emailAddress = keita.urano2 で一致）

→ 現在は名前と中身が一致。過去にあった交差（一時期 `~/.claude` が keita.urano2 だった件）は `~/.claude` を keita.urano で再ログインして解消済み。
OpenClaw（Ops ターミナル / Masayoshi）は `auth.profiles` が `provider: claude-cli` なので `~/.claude` を読む。よって keita.urano で稼働（2026-06-07 セッション再起動でクリーンに反映済み・CLAUDE_CONFIG_DIR 等の上書きなし）。

Apollo 使用量カード（claudeUsage.ts）は「ファイル固定ラベル」だと取り違うため、MC-172 で **取得 email 基準でラベル/順序を決める**方式（EMAIL_IDENTITY）に修正済み＝ファイルが入れ替わっても表示は正しい。

判定の正本は email:
- keita.urano@gmail.com → Claude1 / keita.urano（rank 0）
- keita.urano2@gmail.com → Claude2 / keita.urano2（rank 1）

keita.urano2 側の 429 は [[project_logic_play_billing_gaps]] ではなく MC-161 のレート制限由来。
