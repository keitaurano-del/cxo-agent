---
name: ""
metadata: 
  node_type: memory
  agent: logic-coach
  purpose: ロジカルシンキング監査用メモリ
  originSessionId: 2e1cef32-e414-4279-bebc-55a75d5d2cd2
---

# logic-coach 専用メモリ

Logic アプリのコンテンツとアプリ構築全体を論理的観点で監査するエージェント専用のメモリ領域。

## 蓄積する情報

- 過去監査の対象 + 結果サマリ (繰り返し違反を検出するため)
- Logic アプリ固有の用語定義 / 概念体系 (用語ブレ防止)
- MECE 判定のグレーゾーン事例 (前例ベースの判断材料)
- 粒度判定の経験則 (新カテゴリ追加時の参照)
- 過去事故メモ (lesson-71 相関≠因果サムネ、Visual 184 件不一致 など)

## 関連

- 共通メモリ: `~/.claude/projects/-root-projects/memory/`
- agent 定義: `~/.claude/projects-meta/agents/logic-coach.md`
- 監査レポート出力先: `obsidian-vault/30-Audits/logic-coach/`
