---
name: reference-hermes-local
description: Keita がローカル WSL で使う Hermes Agent (Nous Research) の設定場所と壊れた時の復旧手順
metadata:
  type: reference
  originSessionId: 2026-05-23
---

Keita のローカル WSL に **Hermes Agent (Nous Research 製)** が入っとる。Claude Code とは別の AI エージェントツールで、TUI で動く。

**Why:** 2026-05-23 に「`Error code: 400 - model: String should have at least 1 character`」エラーで Hermes が起動できない事故が発生。config.yaml の `providers: {}` が空 + `model.model: claude-opus-4-7` の "anthropic/" provider prefix が抜けてた。バックアップから戻して復旧。

## 設定パス
- `~/.hermes/` が実体（`~/.config/hermes/` は使われてない）
- `~/.hermes/config.yaml` — メイン設定
- `~/.hermes/config.yaml.bak.<タイムスタンプ>` — Hermes が自動で取るバックアップ
- `~/.hermes/.env` — API キー類
- `~/.hermes/auth.json` — OAuth / 認証情報

## 起動エラー時の復旧パターン

### 症状: `model: String should have at least 1 character` で 400 エラー
原因: `model.model` の値に provider prefix（例: `anthropic/`）が無い、または `providers:` セクションが空。

### 復旧手順
```bash
# 1. 壊れた現状を退避
cp ~/.hermes/config.yaml ~/.hermes/config.yaml.broken

# 2. 一番新しいバックアップを戻す
ls -la ~/.hermes/config.yaml.bak.*  # 最新のを確認
cp ~/.hermes/config.yaml.bak.<最新タイムスタンプ> ~/.hermes/config.yaml

# 3. 再起動
hermes
```

## model 名の指定形式（重要）

正: `default: "anthropic/claude-opus-4.6"`（provider prefix 必須）
誤: `model: "claude-opus-4-7"`（prefix なしだと provider 解決できず空 string になる）

主要 provider prefix:
- `anthropic/` — 直 Anthropic API（`ANTHROPIC_API_KEY` 必要）
- `nous/` — Nous Portal OAuth（`hermes login`）
- `openrouter/` — OpenRouter
- `openai-codex/` — OpenAI Codex
- `gemini/` — Google AI Studio
- `ollama-cloud/` — Ollama Cloud
- 他 多数あり（config.yaml.bak の冒頭コメント参照）

## Hermes 内のシェルコマンドの罠

Hermes TUI 内で `ls` 等のシェルコマンドを打つと、AI への query 扱いになって毎回 API リクエストが飛ぶ。設定壊れ時は **Ctrl+C で抜けてから** 通常シェルで作業すること。

## 関連 memory
- [[project-openclaw-oauth]] — openclaw（別ツール）の OAuth 認証
- [[reference-gemini-api]] — Gemini API キー（Hermes でも gemini/ provider として使える）
