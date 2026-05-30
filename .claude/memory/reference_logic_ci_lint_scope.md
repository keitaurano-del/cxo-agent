---
name: reference-logic-ci-lint-scope
description: Logic の CI(build-and-lint) は `eslint .` でリポ全体を lint する。ローカルの scoped eslint だと docs/samples-src を見逃し、push 後に CI が赤になる罠。
metadata:
  type: reference
  originSessionId: 2026-05-26
---

Logic リポの CI（`.github/workflows/ci.yml` の build-and-lint ジョブ）は `npm run lint` = **`eslint .`（リポ全体）** を叩く。lint error が1件でもあるとジョブが失敗する（warning は失敗させない）。

**Why（2026-05-26 に2回ハマった）:** logic/CLAUDE.md が案内するローカル lint コマンドは `eslint src/AppV3.tsx src/screens/ src/components/ src/hooks/ src/icons/` のように src 配下に限定されている。これだと `docs/samples-src/`（ドキュメント用サンプルの別パッケージ "logic-lesson-samples"）を lint せず、そこの error を見逃す。ローカルで「lint 0 error」でも、CI は `eslint .` で docs/samples-src まで見るので push 後に赤になる。実際 monthHue 未使用変数 → setState-in-effect と連続で踏んだ。

**How to apply:**
- デプロイ/PR 前のチェックは、scoped lint だけでなく **`node node_modules/.bin/eslint .`（CI と同じ全体 lint）で 0 error を確認**する。
- ローカルに残置 git worktree（`.claude/worktrees/...`）があると `eslint .` がその古いコピーまで lint して紛らわしい false error を出す。真の数は `eslint . --ignore-pattern '.claude/**'` で確認するか、`git worktree list` で残骸を把握する。CI はクリーンチェックアウトなので worktree は影響しない。
- error が出るのが docs/samples-src（本番アプリと無関係なサンプル）の場合の選択肢: (a) その場で直す、(b) eslint.config.js の `globalIgnores` に `docs/samples-src` を足して lint 対象から外す（別パッケージなので除外は妥当だが CI スコープ変更なので Keita 確認推奨）。2026-05-26 時点では (a) で個別対応した。
- `eslint -f unix` フォーマッタはこの環境で使えない（出力空）。`-f compact` かデフォルト形式を使う。

**関連 memory:** [[feedback-logic-lesson-visual-hybrid]]、[[reference-deploy-commands]]
