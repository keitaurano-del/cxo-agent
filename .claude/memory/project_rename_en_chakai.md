---
name: project-rename-en-chakai
description: sengoku-chakai → en-chakai のリポ／ローカルディレクトリ rename 完了。残作業は render.yaml と en-chakai.com ドメイン取得
metadata: 
  node_type: memory
  type: project
  originSessionId: 061c2e27-a5d0-43f9-a1d9-034cb1893332
---

GitHub リポ `keitaurano-del/sengoku-chakai` → `keitaurano-del/en-chakai` にリネーム完了（2026-05-11）。ローカルディレクトリも `/root/projects/sengoku-chakai` → `/root/projects/en-chakai` に変更済み。

**Why:** 2026-04-22 コミット `cb1caba` で千石茶会 → 円茶会 (En Chakai) のリブランドが完了済みだったが、リポ名・ローカルパス・agent-config 内の参照が古いままだった。サンプル調査でこれが判明し、Keita 承認のもと一括整理した。

**How to apply:**
- 今後 sengoku-chakai という名前は使わない。コード・ドキュメント・コミットメッセージともに `en-chakai` / 円茶会 を使用。
- ローカルパスは `/root/projects/en-chakai`。
- まだ残ってる作業: (1) `render.yaml` の `name: sengoku-chakai` → `en-chakai`（Render サービス名は不可変なので新サービス作成 → 切り替え）、(2) ドメイン `en-chakai.com` の取得確認・DNS 設定・301 リダイレクト。これは [[task-en-chakai-domain]] / [[task-render-rename]] として個別判断。
- 「千石」「Sengoku」が残っている12ファイルはほぼ全部が**地名としての文京区千石**（駅・所在地）なので保持して OK。
- GitHub は古い URL から自動リダイレクトが効くので外部リンクは一定期間は動く。
