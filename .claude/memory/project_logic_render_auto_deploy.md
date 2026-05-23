---
name: project-logic-render-auto-deploy
description: Logic の Render Production environment は required reviewers 削除済み、main push と workflow_dispatch どちらも approve なしで自動デプロイされる
metadata:
  type: project
  originSessionId: 2026-05-22
---

Logic の Render Production environment は **required reviewers なし** で自動デプロイされる設定（2026-05-22 設定変更）。

**Why:** 2026-05-22 Keita 明示「毎回 approve したくないよ。次回からは自動にして」。それまで Production environment に `required_reviewers` 保護ルールがあり、`gh workflow run deploy-production.yml -f confirm=yes` でも `workflow_dispatch` のたびに GitHub の environment 承認画面で Keita が手動 approve する必要があった。実害として：

- 5/19〜5/21 朝までに workflow_dispatch が 5 回 `waiting` で積み上がって放置された
- Keita 端末で「Web が更新されてない」と感じる原因（実際は build 待ちか approve 待ちで止まっていた）
- 緊急修正の反映に余計な手間がかかる

これを解消するため、`gh api -X PUT repos/keitaurano-del/logic/environments/Production --input -` で `protection_rules: []` / `deployment_branch_policy: null` に変更した。

**How to apply:**
- 今後 Logic の Render Production への deploy は **承認操作不要**。`gh workflow run deploy-production.yml --repo keitaurano-del/logic -f confirm=yes` で即実行される
- main への push でも Render の auto-deploy が動く（こちらは `render.yaml` の hook 経由、GitHub Action とは独立）
- 「Render に最新が反映されてない」と Keita が感じたら、まず確認すべきは：
  1. ブラウザキャッシュ無効化（DevTools → Network → Disable cache）でリロード
  2. `curl -s https://logic-u5wn.onrender.com/ | grep -oE "index-[a-zA-Z0-9_-]+\.js"` で現バンドル ID を見て、`curl -sI` の `last-modified` を確認
  3. `gh run list --workflow="deploy-production.yml" --limit 3` で直近の dispatch が `success` か確認
  4. Render Dashboard 側の build 状況確認（GitHub Action と Render auto-deploy が両方走るため、稀に競合する）
- protection rules を将来復活させたい場合（例：本番に勝手にデプロイされないよう厳密化したい）は `gh api -X PUT` で `reviewers: [{type: "User", id: 270368204}]` のように追加する。Keita のユーザー ID は 270368204

**注意点:**
- 同じ pattern で en-chakai プロジェクトの Render deploy にも environment protection が掛かってる可能性がある。en-chakai 側で同様の自動化を希望する場合は別途 Keita 確認の上で実施

関連 memory: [[reference-deploy-commands]]、[[project-logic-mobile-only]]
