---
name: reference-deploy-commands
description: logic / en-chakai の本番デプロイトリガー方法。両方とも手動 workflow_dispatch。
metadata: 
  node_type: memory
  type: reference
  originSessionId: bd549927-9a7d-40e4-9987-84f4b3d4fde6
---

両プロジェクトとも main への push では自動デプロイされない。デプロイは GitHub Actions workflow を手動トリガーする。

## logic

```bash
gh workflow run deploy-production.yml --repo keitaurano-del/logic -f confirm=yes
```

- Workflow: `.github/workflows/deploy-production.yml`
- 仕組み: Render API (`RENDER_API_KEY` + `RENDER_PROD_SERVICE_ID` の repo secrets) で `/deploys` を叩く
- 本番 URL: https://logic-u5wn.onrender.com

## en-chakai

```bash
gh workflow run deploy-production.yml --repo keitaurano-del/en-chakai -f confirm=yes
```

- Workflow: `.github/workflows/deploy-production.yml`（2026-05-12 追加）
- 仕組み: Deploy Hook URL（`RENDER_DEPLOY_HOOK_URL` repo secret）に POST
- 本番 URL: https://www.en-chakai.com
- Render service 名は `sengoku-chakai` のまま（リネーム不可）

## 共通の注意

- `confirm=yes` を渡さないとガード job で即終了する仕様
- デプロイ前にローカルで型チェック + lint 通しておくこと（CLAUDE.md デプロイ前チェック）
- Deploy Hook URL / API key は repo secrets に登録済み。メモリやリポ本体には書かない。再発行が必要になったら Render Dashboard → Settings から取得 → `gh secret set` で更新
