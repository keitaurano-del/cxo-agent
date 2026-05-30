---
name: feedback-delegate-dev
description: 開発（コード実装）は開発担当(dev-logic等)に委譲する。林が自分で実装を巻き取らない
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2f79ffcf-1087-4972-9d79-50ced3d3bb8f
---

開発（コード実装）は必ず開発担当エージェント（dev-logic 等）に委譲する。林（メインセッション）が自分でコードを書いて巻き取らない（2026-05-30 明示指摘「開発は開発担当にやらせて。自分で巻き取らないで」）。

**Why:** Keita は役割分担を重視している。林はオーケストレーター兼 Keita との対話相手であり、実装ワーカーではない。subagent がフレーキーでも、林が実装を肩代わりするのは NG。

**How to apply:** コード実装は dev-logic（Logic）/ dev 系に投げる。林の仕事は委譲・進捗トラッキング・報告・Keita 判断の仰ぎ。subagent が stall するなら、別の投げ方（小さいスコープ・ラベル分割・再投入）で粘る、もしくは Keita に相談する。自分で Edit して実装を進めない。可視性の要望には[[feedback-address-keita]]同様、ラベル付きの孫エージェントを分けて立てて対応する。
