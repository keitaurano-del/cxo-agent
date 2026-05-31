---
name: project-agent-roster-20260531
description: 2026-05-31 に subagent を開発9体へ厳選し、全9体に技術的気質ベースの人格を付与した。エージェント同士の設計議論は Apollo の会話(Feed)ビューに tool_use 経由で出る。
metadata:
  type: project
  originSessionId: 2026-05-31
---

2026-05-31、Keita 指示で subagent を「開発フェーズ最適化」のため厳選＋人格付与した。

**Why:** 開発フェーズで使わないエージェントを整理し、残す開発チームに技術的気質ベースの人格を持たせて、エージェント同士が設計を相談・健全に衝突して品質を上げるプロセスを作る、という Keita の方針（2026-05-31）。会話を Apollo で可視化したい、も同日の要望。

**削除した6体（過去219セッションで呼び出し0）:** ceo / secretary / marketing / test-unit / test-smoke / test-sanity。完全削除（休眠でなく）。必要になれば git 履歴から復活可。agent-config commit 4c62646。

**残した開発9体（＝現行ロスター）:**
- dev-logic（蓮／れん）— 実装の主力。手を動かして現物で詰める実装主義
- task-manager（棚町 結／たなまち ゆい）— 調整役。実装せず登録・分解・完了条件の逆引き検証
- designer（紺野 蒼／こんの あお）— ビジュアル。引き算・縮小耐性で実証
- content-creator（編 詠子／あみ えいこ）— 教材ライター。題材ファースト・原典裏取り
- reviewer（関 守／せき まもる）— 品質ゲート。事実(file:line/再現)で止める
- logic-coach（論堂 透／ろんどう とおる）— 論理監査。MECE・粒度・矛盾を常時走査
- test-functional（試野 緑／しの みどり）— 機能テスト。負のパス先潰し・最小再現E2E
- night-patrol（夜目／よめ）— 深夜巡回。性悪説でエビデンス込み一次報告
- feedback-watcher（耳塚 聡／みみづか さとし）— ユーザ声。件数/再現性/影響で重み付け

**人格の置き場所:** 各 agent 定義（projects-meta/agents/<key>.md）末尾の「## 人格・気質」セクション（共通ベース＋個体）。sync で全 sub-repo に配布。CLAUDE.md と [[feedback-assistant-name]] の subagent 一覧記述も9体に更新済み。

**人格の運用ルール（重要）:**
- 人格・口調が出てよいのは Keita との会話・コミットメッセージ・社内メモ・エージェント間の相談だけ。アプリ UI 文言・i18n・ラベル・エラー文は中立的な丁寧体を厳守（[[feedback-app-copy-neutral]]）。人格を作品に持ち込まない。
- 各 subagent は林（おじいちゃん口調）とは別人格・別口調。林の口調を真似ない。
- 9体は frictionWith（健全に衝突する相手）/ consultsWith（相談する相手）を設計済み。dev-logic(攻め)×reviewer/test-functional(止める)、content-creator×logic-coach(論理) 等。

**エージェント同士の会話を Apollo で見る仕組み（調査済み・新規実装不要）:**
- Apollo の会話(Feed)ビュー＝ `/api/agents/:id/feed` が `~/.claude/projects/**/subagents/**/agent-*.jsonl` を user/assistant/tool_use で時系列表示。
- 林が workflow/agent でエージェントBを起動すると tool_use として jsonl に乗り、Feed に出る。設計議論を複数ラウンド回せば会話として可視化される。
- さらに「タスク↔workflow↔会話」を繋ぐドリルダウン強化を Apollo に起票済み（cxo-agent MC-60〜65、紐付けは堅い案＝data/task-links.jsonl 明示ログ採用）。実装は別途 dev-logic。

**関連:** [[project-agent-cleanup-20260511]]（前回の5体整理・今回の前史）、[[project-apollo-dashboard]]、[[feedback-app-copy-neutral]]、[[feedback-assistant-name]]、[[feedback-default-workflows]]
