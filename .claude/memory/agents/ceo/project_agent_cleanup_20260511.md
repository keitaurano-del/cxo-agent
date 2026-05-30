---
name: subagent 整理（pm / dev-chakai 削除）
description: 2026-05-11 に使用実績ゼロの pm と dev-chakai を agent-config から削除。subagent は 5体構成（ceo, secretary, dev-logic, marketing, designer）になった。
type: project
originSessionId: 822808e4-41f6-4917-97d8-ff521b307a20
---
2026-05-11 に subagent を 7体 → 5体に整理した。

**削除したエージェント:**
- `pm` — 全セッション累計0回呼び出し。タスク管理・GitHub Issue 整理は凜が直接できる
- `dev-chakai` — 全セッション累計0回呼び出し。千石茶会は静的サイト（Next.js + next-intl）で凜が直接書ける軽量プロジェクト

**残した 5体:**
- `ceo` (累計6回) — プロジェクト横断レポート・優先順位整理
- `secretary` (累計3回) — Gmail / Google Calendar 連携
- `dev-logic` (累計25回) — Logic アプリ専任、フル稼働
- `marketing` (累計2回) — ブランドトーン保ったSNS投稿
- `designer` (累計1回) — ビジュアル専門、2026-05-10新設

**Why:** 「使ってないエージェントを整理したい」と Keita から指示。実使用回数を `/root/.claude/projects/*/*.jsonl` から `subagent_type` 文字列で集計し、0回呼び出しの2体を削除候補に。

**How to apply:**
- 今後 subagent を呼ぶときは上記5体のみ。pm / dev-chakai はもう存在しない
- 千石茶会のコード作業は凜が直接やる。dev-logic に振ろうとしないこと
- タスク管理が複雑になっても、まず凜が直接やる。pm を復活させる前に「本当に独立エージェントが必要か」を再評価する
- 使用実績の確認方法: `grep -h "\"subagent_type\":\"<name>\"" /root/.claude/projects/*/*.jsonl | wc -l`
