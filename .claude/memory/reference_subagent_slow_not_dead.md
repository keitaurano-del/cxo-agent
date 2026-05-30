---
name: reference-subagent-slow-not-dead
description: この環境のサブエージェント/workflowは数分沈黙してから再び動く「のろい」挙動。stall監視を短く切らない
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2f79ffcf-1087-4972-9d79-50ced3d3bb8f
---

この環境（Keita のホスト）のバックグラウンド/workflow サブエージェントは、ツール呼び出しの合間に数分（観測で 3〜7分）沈黙してから再び動く「のろい」挙動を示すことがある。完全な hang（10分以上無更新）とは別物。

**観測（2026-05-30）:** UI バッチで stall 監視を 150〜200 秒で切り、進行中のエージェントを5回も誤って kill した。実際には revert は完走し、別バケツのエージェントは 2 秒前に更新＝稼働中だった。短いしきい値が誤報の元。

**How to apply:**
- stall 監視のしきい値は短く切らない。目安 **8分(480秒)以上**無更新で初めて「死亡」と判断。
- 判定は「全 agent の最新 jsonl mtime」で見る。1体でも最近更新があれば生きている＝resume しない（稼働中を殺すことになる）。
- 本当に死んでいたら `resumeFromRunId` で resume すれば完了済み agent はキャッシュから即返り、止まった所だけ再実行できる。まず生死を正しく見極めてから resume。
- 関連: [[feedback-default-workflows]] / [[feedback-quality-efficiency-accuracy]]。
