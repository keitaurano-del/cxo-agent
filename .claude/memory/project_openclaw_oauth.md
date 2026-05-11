---
name: openclaw Anthropic OAuth セットアップ済み
description: openclaw の Anthropic provider が Claude.ai プラン OAuth で認証されている状態。auth-profiles.json はエージェントレベルとグローバルレベルの2階層に分かれている点に注意。
type: project
originSessionId: dd295a05-e465-465b-9e20-25be9f193e21
---
openclaw の Anthropic provider 認証は **Claude.ai プラン (Max) OAuth** 一本化済み（2026-05-10 再確認・整理）。API キープロファイルは削除済みで、推論はすべて Max プランの定額枠で動く。

**Why:** Pro/Max プランの OAuth 経由で opus-4-7 / sonnet-4-6 等の上位モデルにアクセスし、API キー従量課金を発生させないため。

**現状の構成:**
- エージェントレベル `~/.openclaw/agents/main/agent/auth-profiles.json` に `anthropic:claude-cli` OAuth プロファイルあり（`type: "oauth"`、access/refresh/expires 持ち、自動リフレッシュ）
- グローバル `/root/.openclaw/auth-profiles.json` は `{}` に空化済み（旧 `anthropic:manual` API キーは 2026-05-10 削除、バックアップも 2026-05-10 削除済み）
- `/root/.bashrc` の `ANTHROPIC_API_KEY` export なし
- デフォルトモデル `anthropic/claude-sonnet-4-6`、aliases `opus`/`sonnet` 設定済み
- `openclaw models status` で `effective=profiles | anthropic:claude-cli=OAuth` / `Shell env: off` を確認

**How to apply:**
- 状態確認は `openclaw models status` が最速。`Auth store` 行と `effective=profiles` を確認すれば OAuth で動いてるか即判別できる
- **auth-profiles.json は2階層あるので注意**: グローバル `/root/.openclaw/auth-profiles.json` だけ見て「OAuth 消えた」と早合点しないこと。実際に効くのはエージェントレベル `~/.openclaw/agents/main/agent/auth-profiles.json`
- OAuth が壊れたときの復旧: `claude auth login --claudeai` で Claude CLI 自体の OAuth を取り直してから、`openclaw models auth login --provider anthropic` で "Anthropic Claude CLI"（choiceId: `anthropic-cli`）を選ぶ
- `claude-cli` は provider ID ではなく synthetic auth ref（CLI backend ID）。auth login コマンドの `--provider` には `anthropic` を渡すこと
- registry stale で `Unknown provider` 系エラーが出たら `openclaw plugins registry --refresh` を最初に試す
- 環境変数 `ANTHROPIC_API_KEY` を再追加すると effective が profiles から env に戻る可能性あり。基本入れない
- 旧 API キー（`sk-ant-api03-xMV80...` で始まっていたもの）はローカルから完全削除済み。Anthropic コンソール側で Revoke 済みかは未確認 — もし未対応なら https://console.anthropic.com/settings/keys で対応推奨
