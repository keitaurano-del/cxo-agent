---
name: designer subagent 新設
description: ビジュアルデザイン（コースサムネ・イラスト・SNS画像）を担当する designer subagent を 2026-05-10 に新設
type: project
originSessionId: 7d04e427-5324-4d34-9f8f-c78e879fb838
---
`/root/.claude/projects-meta/agents/designer.md` に designer subagent を新設した（2026-05-10）。

**Why:** Logic コースサムネイル23枚が方針外スタイル（ダーク背景シーン構成）でマージされた件をきっかけに、ビジュアルデザイン専門のエージェントが必要と判断。これまで Pixa を凜が直接叩く形だったが、スタイルガイド・サンプル承認フロー・配置までを一貫して担当する役割を分離。

**How to apply:**
- ビジュアル系の依頼（サムネ・イラスト・SNS用画像・LP ヒーロー等）は designer に振る
- スタイルガイドは designer.md 内に Logic / 千石茶会 別で定義済み
- 現セッションでは `subagent_type=designer` は使えない（Available agent types は起動時固定）。次セッション以降から有効
- 当面は general-purpose に designer.md の内容を渡して代行させることも可
- agent-config 同期リポ（keitaurano-del/agent-config）に commit して反映する必要あり
