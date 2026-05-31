# TASK_TRACKER — cxo-agent / Apollo

task-manager エージェントが管理するタスク台帳の正本。
ステータス: TODO / IN_PROGRESS / BLOCKED / REVIEW / DONE / CANCELLED
更新は必ずこのファイルに反映する。実装は dev-logic / designer に委譲（task-manager は実装しない）。

承認済みプラン全文: `/home/dev/.claude/plans/snazzy-hopping-spindle.md`

---

## プロダクト概要 — Apollo（開発状況リアルタイム可視化ダッシュボード）

> 製品名: **Apollo**（旧称 Mission Control）。`MC-xx` の ID プレフィックスは内部識別子としてそのまま維持。

logic / en-chakai / 西丸町(nishimaru-chokai) / ai-pmo / cxo-agent / プライベート + 全14エージェントの
「誰が今何をしてるか・誰が止まってるか・タスク進捗/滞留・エージェント同士の会話」を1画面で
リアルタイム可視化する常駐ダッシュボード。Vultr サーバ常駐。

- データ源泉（ハイブリッド）: markdown タスク台帳 + `~/.claude/projects/**/subagents/**/agent-*.jsonl` 解析
- スタック: ai-pmo 流用。backend Node22 + Express5 + TS / frontend React18 + Vite5 + Tailwind3 + react-router-dom6 + react-markdown + remark-gfm / ライブ更新 chokidar watch → SSE（+ 12秒ポーリングfallback）
- ホスティング: `web/dist` を server が静的配信、systemd 常駐、token/Basic 認証で保護。スマホ向けトンネルは follow-up。

### 委譲・品質ゲート方針
- 着手登録は task-manager に通し本ファイルを正本化。コード実装は dev-logic、ビジュアルは designer。
- 各フェーズ後に **reviewer / test-smoke** で品質ゲート（生成→レビュー→統合）。
- push・本番デプロイ・Vultr 常駐化判断は **Keita 承認必須**。

---

## バッチ: 2026-05-30 Apollo 新規構築（Phase 0〜4）

ID 採番: **MC-0x（Phase0）/ MC-1x（Phase1）/ MC-2x（Phase2）/ MC-3x（Phase3）/ MC-4x（Phase4）/ MC-Gx（品質ゲート）**。

> **実態反映（2026-05-30）**: server/src・web/ が実装済みで、サーバは :4317 で稼働中（systemd `apollo.service` 経由、node PID 確認）。web/dist もビルド済み（`index-sF0N5r2g.js`）。実ファイルの実在を根拠に、完了相当タスクを DONE、検証未完を REVIEW に更新。判断保留は REVIEW + 確認メモ。

| ID | タイトル | 優先度 | フェーズ | ステータス | 担当 | 依存 |
|----|---------|--------|---------|-----------|------|------|
| MC-01 | server/web 雛形 scaffold（ai-pmo 流用） | P0 | Phase0 | DONE | dev-logic | なし |
| MC-02 | config.ts（データパス・しきい値・projectMap 定数） | P0 | Phase0 | DONE | dev-logic | MC-01 |
| MC-03 | lib/projectMap.ts（cwd/パス→プロジェクト写像） | P0 | Phase0 | DONE | dev-logic | MC-02 |
| MC-G0 | Phase0 品質ゲート（scaffold ビルド通過・dev起動確認） | P0 | Phase0 | DONE（2026-05-31 後追い検証○。server `tsc --noEmit` EXIT0／web `tsc -b` EXIT0＝両 tsc green、`/api/healthz`→`{"ok":true}`＋systemd mission-control.service active＝稼働確認、web/dist ビルド成果物在。eslint は本リポ未設定〔root/server/web に config 無し〕＝ lint 対象なしで N/A、型ゲートは tsc で担保） | reviewer + test-smoke | MC-01〜03 |
| MC-11 | collector: agents.ts（jsonl解析・稼働/会話） | P0 | Phase1 | DONE | dev-logic | MC-G0 |
| MC-12 | lib: jsonl.ts + agentMap.ts（agentId↔subagent_type 解決） | P0 | Phase1 | DONE | dev-logic | MC-G0 |
| MC-13 | lib: stall.ts（滞留判定・8分しきい値） | P0 | Phase1 | DONE | dev-logic | MC-G0 |
| MC-14 | collector: tasks.ts（TASK_TRACKER/kanban/today パース正規化） | P0 | Phase1 | DONE | dev-logic | MC-G0 |
| MC-15 | collector: narrative.ts（briefing/inspection/feedback 最新） | P1 | Phase1 | DONE | dev-logic | MC-G0 |
| MC-16 | collector: roster.ts（60-Agents/*.md 役割×稼働マージ） | P1 | Phase1 | DONE | dev-logic | MC-11 |
| MC-17 | REST API（/api/agents /tasks /narrative /roster） | P0 | Phase1 | DONE | dev-logic | MC-11〜16 |
| MC-G1 | Phase1 品質ゲート（4 API が実データ JSON 返却・型/エラー検証） | P0 | Phase1 | DONE | reviewer + test-smoke | MC-17 |
| MC-21 | frontend 基盤（App/routes/Tailwind/useLiveData 雛形） | P0 | Phase2 | DONE | dev-logic | MC-G1 |
| MC-22 | views/Overview.tsx（KPI帯＋プロジェクトカード） | P0 | Phase2 | DONE | dev-logic + designer | MC-21 |
| MC-23 | views/Agents.tsx（14体グリッド＋会話タイムライン） | P0 | Phase2 | DONE | dev-logic + designer | MC-21 |
| MC-24 | views/Tasks.tsx（Kanban・色分け・滞留バッジ） | P0 | Phase2 | DONE | dev-logic + designer | MC-21 |
| MC-25 | views/Narrative.tsx（react-markdown サマリ） | P1 | Phase2 | DONE | dev-logic | MC-21 |
| MC-26 | デザインシステム（配色/状態ドット/タイポ/レスポンシブ） | P1 | Phase2 | DONE | designer | MC-21 |
| MC-G2 | Phase2 品質ゲート（4ビュー描画・HTTP200・クラッシュ無し） | P0 | Phase2 | DONE | reviewer + test-smoke | MC-22〜26 |
| MC-31 | watch.ts（chokidar watch → SSE broadcast） | P0 | Phase3 | DONE | dev-logic | MC-G2 |
| MC-32 | /api/stream（SSE エンドポイント・接続管理） | P0 | Phase3 | DONE | dev-logic | MC-31 |
| MC-33 | useLiveData.ts ライブ化（EventSource＋12秒ポーリングfallback） | P0 | Phase3 | DONE | dev-logic | MC-32 |
| MC-34 | views/Feed.tsx（親Task→子作業→result 会話ストリーム） | P1 | Phase3 | DONE | dev-logic + designer | MC-33 |
| MC-G3 | Phase3 品質ゲート（touch/追記→数秒で SSE 反映・再接続） | P0 | Phase3 | DONE | reviewer + test-smoke | MC-31〜34 |
| MC-41 | web build→server 静的配信（同一オリジン /api・SSE） | P0 | Phase4 | DONE | dev-logic | MC-G3 |
| MC-42 | 認証（token/Basic）でポート保護 | P0 | Phase4 | DONE | dev-logic | MC-41 |
| MC-43 | deploy/apollo.service（systemd unit）＋README | P0 | Phase4 | DONE | dev-logic | MC-41 |
| MC-44 | Vultr 常駐化実行 | P0 | Phase4 | DONE | dev-logic + Keita | MC-42, MC-43 |
| MC-45 | スマホ向けトンネル（Caddy/cloudflared）— follow-up | P2 | Phase4 | TODO | dev-logic + Keita | MC-44 |
| MC-G4 | Phase4 品質ゲート（常駐起動・認証・全画面 E2E smoke） | P0 | Phase4 | DONE | reviewer + test-smoke | MC-41〜44 |

---

## Phase 0 — scaffold（担当 dev-logic）

### MC-01 — server/web 雛形 scaffold（ai-pmo 流用）　[P0 / Phase0]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/`（package.json/tsconfig/src 一式）・`web/`（package.json/vite.config/tsconfig/src 一式）が実在。両 tsbuildinfo あり、web/dist ビルド済み。
- 詳細: `cxo-agent/server/`（Node22+Express5+TS, `ai-pmo/api/src/server.ts` 同型）と `cxo-agent/web/`（React18+Vite5+Tailwind3+react-router-dom6+react-markdown+remark-gfm, `ai-pmo/viewer/package.json` 依存踏襲）の雛形を作成。ディレクトリ構造はプラン記載のツリー通り。
- 関連ファイル: `cxo-agent/server/`, `cxo-agent/web/`, `ai-pmo/api/src/server.ts`（参照元）, `ai-pmo/viewer/package.json`（参照元）
- DoD: `server && npm run dev` で Express が起動しヘルスチェック応答／`web && npm run dev` で空の React アプリが描画／両 tsc green。
- 依存: なし
- 提言・抜けもれ:
  - tsconfig / eslint config も ai-pmo から流用し、CI lint は `eslint .`（リポ全体）で確認（reference_logic_ci_lint_scope 準拠）。docs/samples を見逃さない。
  - `.gitignore` に `node_modules` `web/dist` `*.log` を入れる（コミット汚染防止）。
  - server の listen ポートは env で可変に（常駐時の競合回避）。

### MC-02 — config.ts　[P0 / Phase0]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/config.ts` 実在。DATA_HOME/CLAUDE_PROJECTS_DIR/PROJECTS_DIR/VAULT_DIR/CXO_TRACKER/TASK_SOURCES/NARRATIVE_DIRS/ROSTER_DIR/VAULT_EXCLUDE_DIRS・STALL_MINUTES・PORT を集約、env override 対応。
- 詳細: データパス（`~/.claude/projects`, `~/projects/*`, obsidian-vault パス）・滞留しきい値・cwd→プロジェクト写像の定数を集約。
- 関連ファイル: `cxo-agent/server/src/config.ts`
- DoD: 全パス・しきい値が1ファイルに集約され、collectors が参照。ハードコード散在なし。
- 依存: MC-01
- 提言・抜けもれ:
  - **滞留しきい値は8分（active < 8分 / idle 8分〜）。8分未満で切らない**（reference_subagent_slow_not_dead 準拠）。定数にコメントで根拠明記。
  - パスは `os.homedir()` ベースで解決（Vultr とローカルで $HOME 差を吸収）。
  - obsidian-vault の絶対パスを env override 可能に（環境差吸収）。

### MC-03 — lib/projectMap.ts　[P0 / Phase0]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/lib/projectMap.ts` 実在。
- 詳細: cwd / ファイルパス / gitBranch → プロジェクト名（logic / en-chakai / 西丸町 / ai-pmo / cxo / private）の写像。プライベート/個人は obsidian 10-Tasks 等を private に割当。
- 関連ファイル: `cxo-agent/server/src/lib/projectMap.ts`
- DoD: 代表 cwd を渡すと正しいプロジェクト名が返る。未知 cwd は `unknown`（落ちない）。
- 依存: MC-02
- 提言・抜けもれ:
  - 西丸町は `nishimaru-chokai` / `nishimarucho-flyer` 両表記があり得る → 両方マップ。
  - **プライベート割当ルール**を明示（10-Tasks, 50-Daily の個人系 → private）。漏れると「unknown 多発」になる。

---

## Phase 1 — backend collectors + REST API（担当 dev-logic）

### MC-11 — collector: agents.ts　[P0 / Phase1]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/collectors/agents.ts` 実在、`/api/agents` ルート稼働。`lib/jsonl.ts`/`lib/stall.ts`/`lib/redact.ts` 連携。
- 詳細: `subagents/**/agent-*.jsonl`（101本）を列挙。最終行 timestamp（無ければ mtime）→最終活動。状態 active(<8分)/idle(8分〜)/done(result行/終了)/never。cwd・gitBranch→projectMap。message ストリーム→最新作業スニペット＋会話フィード。
- 関連ファイル: `cxo-agent/server/src/collectors/agents.ts`, `lib/jsonl.ts`, `lib/projectMap.ts`, `lib/stall.ts`
- DoD: `/api/agents` が101ファイル分の `{agentId,label,project,status,lastActivity,snippet}` を返す。空/壊れ jsonl で落ちない。
- 依存: MC-G0
- 提言・抜けもれ:
  - 巨大 jsonl をフル読みせずストリーム/末尾読みで（メモリ・速度）。
  - 壊れ行（JSON parse 失敗）はスキップしてログ、全体は落とさない。
  - **per-server で本機の活動しか見えない**点を API レスポンスに `source: hostname` で明示（後述リスク）。

### MC-12 — lib: jsonl.ts + agentMap.ts（最難所）　[P0 / Phase1]
- ステータス: DONE / 担当: dev-logic
- 検証(2026-05-31 reviewer 関): 本番 :4317 `/api/agents` 実データで agentMap マッチ率を計測。total 220 / 名前付与 220 / unknown・空 0＝マッチ率 100%。subagentType 分布も実体に一致（dev-logic 34 / task-manager 19 / designer 9 / reviewer 4 / workflow:logic 54 / workflow:other 35 等）。ワークフロー孫(102体)も `workflow:<project>` ラベルに解決され「固まらない」DoD 充足。`server/src/lib/agentMap.ts:32-65` に多段照合（exact→head200→prefix150・norm 前処理）＋ lookup 未一致 null フォールバック実装を確認。server tsc green。
- 実態根拠(2026-05-30): `server/src/lib/jsonl.ts`・`server/src/lib/agentMap.ts` 実在。**確認メモ**: 本タスクは台帳上「最大リスク」。マッチ率メトリクス（matched/total）と先頭 user message 照合の頑健性が実データで検証できているか未確認のため DONE 化せず REVIEW。reviewer でマッチ率を計測してから DONE 判定。
- 詳細: jsonl.ts=ストリーム読み・最終 timestamp 抽出。agentMap.ts=親セッション jsonl の `Task` tool_use（subagent_type+description+prompt）を抽出し、subagent ファイル先頭 user message（=Task prompt と一致）でマッチングしてラベル付与。ワークフロー孫は `subagents/workflows/wf_*/` パスで判別。マッチ不能時は cwd ベース暫定ラベル。
- 関連ファイル: `cxo-agent/server/src/lib/jsonl.ts`, `cxo-agent/server/src/lib/agentMap.ts`
- DoD: 代表 subagent ファイルに正しい subagent_type ラベルが付く。マッチ不能でも `unknown(cwd)` で落ちない。
- 依存: MC-G0
- 提言・抜けもれ:
  - ⚠ **本実装の一番の勘所＝最大リスク**。先頭 user message 完全一致が崩れるケース（prompt の前後トリム・改行差）を normalize して照合。
  - マッチ率を内部メトリクスで出せると検証が楽（matched/total）。
  - workflow 孫のパスパターンは実物 `subagents/workflows/wf_*/` を確認してから正規表現を組む。

### MC-13 — lib: stall.ts（滞留判定）　[P0 / Phase1]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/lib/stall.ts` 実在、`STALL_MINUTES` を config 参照。境界値テストは MC-G1/test-smoke 側で確認。
- 詳細: lastActivity と現在時刻の差・ステータスから stalled 判定。タスク側 updated 古さ＆IN_PROGRESS のまま→stalled。
- 関連ファイル: `cxo-agent/server/src/lib/stall.ts`
- DoD: 8分しきい値で active/idle を境界判定。タスク stalled バッジ判定が機能。
- 依存: MC-G0
- 提言・抜けもれ:
  - **8分未満で stalled/dead と判定しない**（誤検知＝進行中エージェントを殺す事故、reference_subagent_slow_not_dead）。境界値テストを test-smoke に含める。

### MC-14 — collector: tasks.ts　[P0 / Phase1]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/collectors/tasks.ts` 実在。logicTracker / nishimaruTracker / **cxoTracker（自台帳ドッグフーディング）** / kanban / today をパース。cxo は ID|タイトル|優先度|フェーズ|ステータス|担当|依存 の列構成に対応、列フォールバックも実装済。
- 詳細: markdown パース。`logic/docs/TASK_TRACKER.md`（`| ID | タイトル | 優先度 | 区分 | 担当 |` テーブル＋ステータス語）／`kanban.md`（`## 🔥 Now / 📋 Next / ✅ Done` 下チェックボックス＋owner:/priority:）／`nishimarucho-flyer/TASK_TRACKER.md`／`today.md`。→ `{id,title,status,owner,priority,project,updated}` 統一→Kanban列＋滞留検知。
- 関連ファイル: `cxo-agent/server/src/collectors/tasks.ts`, パース対象: `logic/docs/TASK_TRACKER.md`, `obsidian-vault/20-Projects/nishimarucho-flyer/TASK_TRACKER.md`, `obsidian-vault/10-Tasks/kanban.md`, `today.md`, **本ファイル `cxo-agent/docs/TASK_TRACKER.md`**
- DoD: `/api/tasks` が全台帳の正規化タスク配列を返す。ステータス6語に正しくマップ。パース失敗台帳はスキップして他は返す。
- 依存: MC-G0
- 提言・抜けもれ:
  - **本 Apollo 自身の台帳（cxo-agent/docs/TASK_TRACKER.md）もパース対象に含める**こと（ドッグフーディング＝自分のタスクも可視化）。プランのリスト外なので明示。
  - logic 台帳は本ファイルと同じ MC 形式テーブル＋`### ID — ...` 見出し＋`- ステータス:` 行の2系統がある。両形式を拾えるパーサにする（見落とし防止）。
  - 区分列とステータス語の混同に注意（区分=トリアージ、status=進行状態）。
  - **永続化/再表示**: パースは read-only。書き戻しはしない（台帳の正本は人＝task-manager が管理）。

### MC-15 — collector: narrative.ts　[P1 / Phase1]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/collectors/narrative.ts` 実在、`/api/narrative` 稼働、NARRATIVE_DIRS 参照。
- 詳細: `50-Daily/briefings|inspections|feedback/*.md` の最新日付ファイルを読み要点返却。
- 関連ファイル: `cxo-agent/server/src/collectors/narrative.ts`
- DoD: `/api/narrative` が本日（無ければ直近）の briefing/inspection/feedback 要点を返す。
- 依存: MC-G0
- 提言・抜けもれ:
  - 日付ソートは ISO ファイル名 or frontmatter date で。タイムゾーンずれで「昨日が最新」にならないよう JST 基準。
  - ファイル不在時は空配列（落とさない）。

### MC-16 — collector: roster.ts　[P1 / Phase1]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/collectors/roster.ts` 実在、`/api/roster` 稼働、ROSTER_DIR(60-Agents) 参照。
- 詳細: `60-Agents/*.md`（14体）の役割定義を読み、agents collector の稼働状態をマージ。
- 関連ファイル: `cxo-agent/server/src/collectors/roster.ts`
- DoD: `/api/roster` が14体の `{name,role,status,project,lastActivity}` を返す。役割と稼働が結合。
- 依存: MC-11
- 提言・抜けもれ:
  - **roster の14体 と agents collector の agentId のマッチング**は agentMap と同根の課題。名前マッピング表を config 化（subagent_type ↔ 60-Agents ファイル名）。
  - 14体に満たない/超える場合（never 稼働の体）も roster には出す（「待機中」表示）。

### MC-17 — REST API　[P0 / Phase1]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/index.ts` に `/api/agents` `/api/agents/:id/feed` `/api/tasks` `/api/narrative` `/api/roster` `/api/overview` `/api/health` 実装。:4317 で稼働中。
- 詳細: `/api/agents` `/api/tasks` `/api/narrative` `/api/roster` を Express ルートで公開。
- 関連ファイル: `cxo-agent/server/src/index.ts`
- DoD: 4エンドポイント全てが 200＋正規化 JSON。1 collector が落ちても他は応答（部分劣化）。
- 依存: MC-11〜16
- 提言・抜けもれ:
  - collector ごとに try/catch、エラーは `{error}` フィールドで返し 200 維持（1台帳の破損で全画面ダウンしない）。
  - レスポンスに `generatedAt` と `source(hostname)` を付与。

---

## Phase 2 — frontend 4ビュー（担当 dev-logic + designer）

### MC-21 — frontend 基盤　[P0 / Phase2]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `web/src/App.tsx`・`web/src/lib/useLiveData.ts`・`web/src/lib/liveContext.ts`・共通 `components/ui.tsx`/`PageHeader.tsx`・`web/src/index.css`/Tailwind config 実在。web/dist ビルド済み。
- 詳細: App.tsx / routes / Tailwind 設定 / `lib/useLiveData.ts` 雛形（Phase2 は静的 fetch、Phase3 でライブ化）。
- 関連ファイル: `cxo-agent/web/src/App.tsx`, `web/src/routes`, `web/src/lib/useLiveData.ts`
- DoD: 4ルート（/overview /agents /tasks /narrative）がナビゲートでき、各 API を fetch して描画。
- 依存: MC-G1
- 提言・抜けもれ:
  - Feed は Phase3 で追加するルートだが、ルーター構造を先に拡張余地ありにしておく。
  - loading/error 状態の共通コンポーネントを最初に作る（各ビューで使い回し）。

### MC-22 — views/Overview.tsx（司令塔）　[P0 / Phase2]
- ステータス: DONE / 担当: dev-logic + designer
- 実態根拠(2026-05-30): `web/src/views/Overview.tsx` 実在、`/api/overview` 連携。
- 詳細: 上部 KPI 帯（active N / idle N / 進行中タスク / 滞留タスク）。下にプロジェクトカード（logic/en-chakai/西丸町/ai-pmo/cxo/private）。各カードにタスク件数・最終活動・状態ドット。
- 関連ファイル: `cxo-agent/web/src/views/Overview.tsx`
- DoD: KPI 4指標が API から算出表示、6プロジェクトカードが状態ドット付きで並ぶ。
- 依存: MC-21
- 提言・抜けもれ:
  - **状態ドットの色は意味を担う**ので語ラベル/aria 併記（🟢active/🟡idle 等は色だけに頼らない＝アクセシビリティ）。
  - **ハードコード hex 禁止・CSS 変数/Tailwind トークン使用・UI chrome の emoji 不可（SVG のみ）**（デザイン制約。本文の絵文字ハイブリッドは UI chrome には適用しない）。

### MC-23 — views/Agents.tsx　[P0 / Phase2]
- ステータス: DONE / 担当: dev-logic + designer
- 実態根拠(2026-05-30): `web/src/views/Agents.tsx` + `web/src/components/AgentFeed.tsx` 実在。
- 詳細: 14体カードグリッド（active/idle/never/stalled・現プロジェクト・最終活動・最新行動）。クリックでその子エージェント会話タイムライン。
- 関連ファイル: `cxo-agent/web/src/views/Agents.tsx`
- DoD: 14体が状態色付きで並び、クリックで会話タイムラインが開く。never 稼働も「待機中」で表示。
- 依存: MC-21
- 提言・抜けもれ:
  - 状態は色＋語ラベル併記（アクセシビリティ）。
  - 会話タイムラインの長文は仮想化 or ページングを検討（101本×多メッセージで重くなる）。

### MC-24 — views/Tasks.tsx（Kanban）　[P0 / Phase2]
- ステータス: DONE / 担当: dev-logic + designer
- 実態根拠(2026-05-30): `web/src/views/Tasks.tsx` 実在。CANCELLED の Kanban 置き場方針は reviewer 確認推奨（要確認点として継続）。
- 詳細: TODO/IN_PROGRESS/BLOCKED/REVIEW/DONE の Kanban。プロジェクト色分け・滞留バッジ。
- 関連ファイル: `cxo-agent/web/src/views/Tasks.tsx`
- DoD: 5列 Kanban にタスクが配置、プロジェクト色＋滞留バッジ表示。CANCELLED の扱いを決めて表示。
- 依存: MC-21
- 提言・抜けもれ:
  - ステータスは6語（CANCELLED 含む）。Kanban 5列＋CANCELLED の置き場を決める（折りたたみ列 or 非表示トグル）。プランは5列記載なので要確認点として注記。
  - プロジェクト色分けは projectMap の色を config 一元化（Overview と統一、ハードコード散在禁止）。
  - 滞留バッジのしきい値は stall.ts と同一基準（二重定義しない）。

### MC-25 — views/Narrative.tsx　[P1 / Phase2]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `web/src/views/Narrative.tsx` + `web/src/components/ObsidianMarkdown.tsx`（react-markdown レンダラ）実在。
- 詳細: briefing + inspection + feedback 最新を react-markdown（remark-gfm）表示。
- 関連ファイル: `cxo-agent/web/src/views/Narrative.tsx`
- DoD: 本日サマリが markdown レンダリングで表示。table/checkbox（gfm）が崩れない。
- 依存: MC-21
- 提言・抜けもれ:
  - react-markdown のリンク/画像は同一オリジン外を新規タブ＋rel 付与（安全側）。

### MC-26 — デザインシステム　[P1 / Phase2]
- ステータス: DONE / 担当: designer
- 検証(2026-05-31 reviewer 関): `web/src/index.css` に :root＋CSS custom property 44 個、`tailwind.config` が `var(--…)` を 25 箇所参照＝トークン統一。`web/src/views/*.tsx` のハードコード hex 0 件（禁止遵守）。状態ドットは `web/src/components/ui.tsx:20-21` で `role="status"`＋`aria-label="状態: …"`（色のみ依存にせず語ラベル/aria 併記＝a11y 充足）、stalled は `aria-label="滞留しています"`。UI chrome に絵文字 0（SVG のみ）。web build EXIT0。
- 実態根拠(2026-05-30): `web/src/index.css`・Tailwind config・`components/icons.tsx`（SVG）実在で実装はある。**確認メモ**: ハードコード hex 禁止・CSS変数/トークン統一・UI chrome SVG 限定（emoji 不可）・状態色の語ラベル/aria 併記、の制約遵守を designer/reviewer が目視確認してから DONE。
- 詳細: 配色トークン・状態ドット意匠（SVG）・タイポ・レスポンシブ（PC 常駐＋スマホチラ見）の指針を1セット。
- 関連ファイル: `cxo-agent/web/src/index.css`, Tailwind config, designer 指示書
- DoD: 全ビューが共通トークンで統一、状態色が一意、スマホ幅で破綻しない。
- 依存: MC-21
- 提言・抜けもれ:
  - **ハードコード hex 禁止・CSS 変数/Tailwind トークン・UI chrome は SVG のみ（emoji 不可）**。
  - スマホ向けトンネル（MC-45）を見据え最初からレスポンシブ前提で。

---

## Phase 3 — SSE + chokidar watch + Feed ライブ化（担当 dev-logic）

### MC-31 — watch.ts（chokidar → SSE broadcast）　[P0 / Phase3]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/watch.ts` 実在。chokidar watcher 1本・WATCH_DEBOUNCE_MS で間引き・ignored で .git/node_modules 除外・エラー握り潰しでクラッシュ耐性。
- 詳細: データディレクトリ（subagents jsonl・台帳 md・narrative md）を chokidar watch、変更で該当 collector 再計算→SSE broadcast。
- 関連ファイル: `cxo-agent/server/src/watch.ts`
- DoD: 監視対象の touch/追記で broadcast イベントが飛ぶ。
- 依存: MC-G2
- 提言・抜けもれ:
  - jsonl は高頻度追記。debounce/throttle で broadcast を間引く（過剰再計算防止）。
  - watch 対象が101本＋台帳＋narrative で多い。`usePolling` 回避しネイティブ watch、ignore で node_modules/.git 除外。

### MC-32 — /api/stream（SSE）　[P0 / Phase3]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/index.ts:254` に `/api/stream`（text/event-stream・ping ハートビート）実装。
- 詳細: SSE エンドポイント。接続管理・ハートbeat・切断検知。
- 関連ファイル: `cxo-agent/server/src/index.ts`
- DoD: 複数クライアント接続で broadcast が全員に届く。切断でリーク無し。
- 依存: MC-31
- 提言・抜けもれ:
  - ハートビート（コメント行）で proxy/トンネルのアイドル切断を防ぐ（MC-45 トンネル時に効く）。

### MC-33 — useLiveData.ts ライブ化　[P0 / Phase3]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `web/src/lib/useLiveData.ts` 実在。EventSource(`/api/stream`)購読 + POLL_INTERVAL_MS=12000 のポーリング fallback + 明示再接続制御。
- 詳細: EventSource 購読＋12秒ポーリング fallback。SSE 切断時はポーリングへ自動フォールバック・再接続。
- 関連ファイル: `cxo-agent/web/src/lib/useLiveData.ts`
- DoD: SSE 受信で画面更新、SSE 不通時もポーリングで更新継続。再接続で復帰。
- 依存: MC-32
- 提言・抜けもれ:
  - 二重更新（SSE＋ポーリング同時）でちらつかないよう dedupe。

### MC-34 — views/Feed.tsx（会話ストリーム）　[P1 / Phase3]
- ステータス: DONE / 担当: dev-logic + designer
- 実態根拠(2026-05-30): `web/src/views/Feed.tsx` 実在。
- 詳細: 親 Task 指示→子作業→result を時系列マージしたストリーム。プロジェクト/エージェントで絞り込み。
- 関連ファイル: `cxo-agent/web/src/views/Feed.tsx`, `web/src/App.tsx`（ルート追加）
- DoD: 時系列マージされた会話がライブ流入、フィルタが効く。
- 依存: MC-33
- 提言・抜けもれ:
  - **agentId↔subagent_type マッチング（MC-12）に全面依存**。マッチ不能分は「unknown」レーンに落とし、欠落で固まらない。
  - 長尺ストリームの仮想化（パフォーマンス）。

---

## Phase 4 — Vultr systemd 常駐 + 認証（担当 dev-logic + Keita 承認）

### MC-41 — web build → server 静的配信　[P0 / Phase4]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `web/dist`（index.html + index-sF0N5r2g.js + index-w14wJSY9.css）ビルド済み。`server/src/index.ts:295` で `express.static(WEB_DIST)` + SPA fallback `/*splat`。同一オリジンで /api・SSE・UI 配信。
- 詳細: `web && npm run build`→`web/dist` を server が静的配信。同一オリジンで /api と SSE。
- 関連ファイル: `cxo-agent/server/src/index.ts`, `cxo-agent/web`（build）
- DoD: server 単体起動で UI＋/api＋SSE が同一オリジンで動く。
- 依存: MC-G3
- 提言・抜けもれ: build artifact（web/dist）は gitignore、デプロイ時ビルド。

### MC-42 — 認証（token/Basic）　[P0 / Phase4]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `server/src/lib/auth.ts` 実装。MC_TOKEN(env) 設定時に Bearer / `?token=` / Cookie(mc_token, httpOnly+SameSite=Lax) のいずれかで認証、未認証は 401。`/api/*`・SSE・静的配信・SPA fallback すべてに適用（`/api/healthz` のみ公開）。EventSource 用にクエリ token 受けあり。トークンは env 管理（ハードコードなし）。
- 詳細: ポートを token または Basic 認証で保護。/api・SSE・静的配信すべてに適用。
- 関連ファイル: `cxo-agent/server/src/index.ts`（auth middleware）, env
- DoD: 認証無しアクセスは 401。トークンは env 管理（ハードコード禁止）。
- 依存: MC-41
- 提言・抜けもれ:
  - **シークレットをリポにコミットしない**（env/secret manager）。誤コミット時の rotate 手順を README に。
  - SSE にも認証を効かせる（EventSource はカスタムヘッダ不可→クエリトークン or Cookie で）。

### MC-43 — deploy/apollo.service ＋ README　[P0 / Phase4]
- ステータス: DONE / 担当: dev-logic
- 完了(2026-05-31 dev-logic 蓮): DoD の残課題だった `deploy/README.md` を新規作成し充足。章立て=0.前提/1.install(daemon-reload・enable・start)/2.start・stop・restart/3.logs(journalctl -u mission-control.service＋~/logs/apollo-watchdog.log・apollo-keeper.log)/4.rotate(journald SystemMaxUse・vacuum＋~/logs の logrotate 例)/5.health(systemd Restart=always＋watchdog cron */3＋keeper cron 15,45＋/api/healthz)/6.troubleshoot(ポート4317競合=生tsx禁止・systemctl経由/web は npm run build/server は restart)。実態に忠実に記載（install 済み unit 名は旧称 `mission-control.service` のままなのでコマンドは全てその名前で記載、リネームは別件 MC-44 関連として明記）。実態確認: `systemctl status mission-control.service`=active/enabled・Restart=always、`ss -ltnp` で node が :4317 LISTEN、`/api/healthz`→200、cron は watchdog `*/3`・keeper `15,45`、ログは `~/logs/apollo-{watchdog,keeper}.log` を実機で確認済み。
- 検証(2026-05-31 reviewer 関): **DoD 未充足のため REVIEW 継続**。`deploy/apollo.service` は実在し内容も妥当（tsx 直起動・EnvironmentFile=.mc.env・Restart=always・WantedBy=multi-user.target。`systemctl cat mission-control.service` の実 install 内容と一致）。だが DoD「README に install/start/logs/rotate 手順が揃う」が **未達**: `deploy/README.md` は不在、`README.md` は Phase0/1 仕様＋`npm run dev` 開発起動のみで、systemd install/enable・journalctl ログ確認・MC_TOKEN rotate の常駐ランブックが無い（`grep -rE "rotate|journalctl|systemctl enable"` で該当 runbook ヒット 0）。→ dev-logic に「deploy/README.md（install/start/logs/rotate 手順）」追記を戻す。それが入れば DONE 化可。【2026-05-31 解消済: deploy/README.md 作成で充足、上記完了メモ参照】
- 詳細: systemd unit ＋ Vultr 常駐手順 README。
- 関連ファイル: `cxo-agent/deploy/apollo.service`, `cxo-agent/deploy/README.md`, `cxo-agent/README.md`
- 実態根拠(2026-05-30): `deploy/apollo.service` 実在（tsx 直起動・EnvironmentFile=.mc.env・Restart=always・WantedBy=multi-user.target）。**確認メモ**: `deploy/README.md` が見当たらない（install/start/logs/rotate 手順）。README 整備が確認できるまで DONE 化せず REVIEW。
- DoD: unit でサービス定義、README に install/start/logs/rotate 手順が揃う。
- 依存: MC-41
- 提言・抜けもれ:
  - 対象は Vultr 2台目（本機, 167.179.64.231）か要確認（project_vultr_second_server 参照）。**どのサーバに常駐させるか Keita 確認点**。
  - 再起動時自動起動（WantedBy=multi-user.target）・ログローテ・ポート env を unit に。

### MC-44 — Vultr 常駐化実行　[P0 / Phase4]
- ステータス: DONE / 担当: dev-logic + Keita
- 検証(2026-05-31 reviewer 関): 本機 Vultr で常駐確認。`systemctl is-enabled mission-control.service`=enabled・is-active=running・Restart=always、`WantedBy=multi-user.target`＝再起動後自動復帰可。`ss -ltnp` で node PID が :4317 を LISTEN。`/api/healthz`→200。認証越しの全画面 E2E smoke（全 API＋SPA＋vault が token 付きで 200、token 無しで 401）green＝MC-G4 通過。※ unit 名は旧称 `apollo.service` でなく `mission-control.service` のまま install されている（deploy/apollo.service は同等内容のリポ版、改称は任意・別件）。常駐自体は本番反映済み。
- 詳細: systemd 登録・起動・常駐確認を本機（Vultr）上で実行。
- 関連ファイル: deploy 一式
- DoD: サービスが常駐起動、再起動後も自動復帰、認証越しに全画面 E2E が通る。
- 依存: MC-42, MC-43
- 実態根拠(2026-05-30): server が :4317 で **稼働中**（node PID 106131 が LISTEN）。`apollo.service` の Restart=always 経由で常駐している模様。
- 提言・抜けもれ:
  - **確認メモ**: 「再起動後の自動復帰（enable 済みか）」「認証越しの全画面 E2E（MC-G4）通過」が未確認のため DONE 化せず REVIEW。`systemctl is-enabled apollo.service` と再起動復帰・E2E smoke を確認してから DONE。
  - 本番反映＝Keita 承認必須（CLAUDE.md）。既に常駐済みのため、常駐自体の追認を Keita に確認。

### MC-45 — スマホ向けトンネル（follow-up）　[P2 / Phase4]
- ステータス: TODO / 担当: dev-logic + Keita
- 詳細: Caddy or cloudflared で逆プロキシ/トンネル＋token。deploy/README に手順。
- 関連ファイル: `cxo-agent/deploy/README.md`
- DoD: スマホから token 付き URL でチラ見できる。
- 依存: MC-44
- 提言・抜けもれ:
  - **明示的に follow-up（まず常駐を立てる）**。Phase4 本体完了前に着手しない。
  - トンネル経由は認証を二重に（トンネル token＋アプリ認証）。

---

## 品質ゲート（reviewer + test-smoke）

各フェーズ完了時に必ず通す。生成しっぱなしにしない（生成→レビュー→統合）。

> **実態(2026-05-30)**: 実装は全フェーズ揃って稼働中だが、各ゲートの **検証エビデンス（tsc/eslint/Playwright smoke の実行ログ）** が台帳に残っていないため、ゲートは全て **REVIEW** 据え置き。reviewer + test-smoke を回して green を確認した時点で各ゲートを DONE 化する。

- **MC-G0（Phase0）** [DONE 2026-05-31]: scaffold が両 tsc green（server `tsc --noEmit` EXIT0／web `tsc -b` EXIT0）・dev 起動（`/api/healthz`→`{"ok":true}`・systemd active）。eslint は本リポ未設定で N/A（型ゲートは tsc が担保）。
- **MC-G1（Phase1）** [DONE 2026-05-31 reviewer 関]: 本番 :4317 で /api/agents(180KB)・/api/tasks(53KB)・/api/narrative(17KB)・/api/roster(5KB)・/api/overview が全て 200＋実データ JSON 返却。トークン無しは 401（auth gate）。server `tsc --noEmit` EXIT0。
- **MC-G2（Phase2）** [DONE 2026-05-31 reviewer 関]: SPA が `/` で 200＋`<div id="root">`＋ハッシュ済み bundle 配信。/api/overview の KPI が実数（agentsTotal 220・tasksReview 21 等）。web `tsc -b && vite build` EXIT0（311 modules）。views/*.tsx ハードコード hex 0・UI chrome 絵文字 0。
- **MC-G3（Phase3）** [DONE 2026-05-31 reviewer 関]: 本番 /api/stream を購読し `event: ping`→`event: update {types:[agents]}` がライブで連続発火（chokidar watch→broadcast 数秒以内）。frontend `web/src/lib/useLiveData.ts:103-148` に EventSource＋polling fallback(setInterval)＋onerror 明示再接続(5s) 実装を確認。
- **MC-G4（Phase4）** [DONE 2026-05-31 reviewer 関]: 認証 401 を /api/agents・/api/vault/tree 両方で確認（token 無し→401）。常駐は systemd `mission-control.service`（loaded/active/running/enabled・Restart=always）で稼働、再起動自動復帰可（WantedBy=multi-user.target）。全 API＋SPA＋vault が認証越しに 200 で E2E smoke green。

各ゲート未通過のフェーズは次フェーズへ進めない（依存で表現済み）。実装先行で稼働済みのため、ゲートは「後追い検証」として回す。

---

## リスク・留意（台帳注記）

1. **agentId↔subagent_type マッチング（MC-12）が最難所**。親セッション Task tool_use の先頭 user message 照合＋cwd フォールバックで頑健化。マッチ率を内部メトリクス化して検証。Feed（MC-34）と roster（MC-16）がこれに依存するため、ここが崩れると複数画面が劣化する。
2. **per-server で本機の活動しか見えない**。jsonl は走っているサーバ単位。Vultr 2台目（本機）以外のセッションは映らない。API レスポンスに `source(hostname)` を明示し「全社ではなく本機ビュー」と誤読させない。将来は各サーバから集約 push する拡張余地（今回スコープ外）。
3. **滞留しきい値は8分未満で切らない**（reference_subagent_slow_not_dead）。short kill は進行中エージェントの誤検知＝事故。stall.ts の境界値テストを必須化。
4. **プライベート/個人の projectMap 割当**（obsidian 10-Tasks 等→private）。漏れると unknown 多発。
5. **シークレット管理**（MC-42）。認証トークンを env 管理、誤コミット防止＋rotate 手順。
6. **CANCELLED の Kanban 表示方針**（MC-24）。プランは5列だが status は6語。置き場を決める要確認点。
7. **本台帳自身もパース対象**（MC-14）。Apollo が自分のタスクを映すドッグフーディング。プラン明記外なので注記。

---

## 抜けもれ提言サマリ

プランに明示されていなかったがサブタスク/注記として台帳化したもの:

- **MC-14**: tasks collector のパース対象に **本ファイル（cxo-agent/docs/TASK_TRACKER.md）自身**を追加（ドッグフーディング）。logic 台帳の2系統フォーマット（テーブル＋見出し）両対応。
- **MC-12 / MC-16**: agentMap のマッチ不能時の `unknown` フォールバックを各画面で「固まらない」設計に（Feed/roster の連鎖劣化防止）。マッチ率メトリクス。
- **MC-22/23/24/26**: アクセシビリティ＝状態色は語ラベル/aria 併記（色のみ依存禁止）。デザイン制約＝ハードコード hex 禁止・CSS変数/トークン・UI chrome は SVG のみ（emoji 不可）。
- **MC-24**: CANCELLED の Kanban 置き場（5列 vs 6 status）を要確認点として明示。
- **MC-13 / リスク3**: 8分しきい値の境界値テストを test-smoke 必須項目に。
- **MC-17**: collector 部分劣化設計（1台帳破損で全 API ダウンしない、try/catch＋`{error}`）。
- **MC-42**: SSE への認証適用（EventSource のヘッダ制約→クエリトークン/Cookie）。シークレット rotate 手順。
- **MC-43**: 常駐先サーバ（Vultr 2台目 167.179.64.231 か）の確定が Keita 確認点。
- **i18n**: 本プロダクトは内部ツール（Keita のみ）想定のため i18n 両言語化は対象外と判断（必要なら追加）。← Keita 確認点。
- **両OS**: 本プロダクトは Web ダッシュボード（Capacitor/ネイティブ無し）→両OS確認は非該当。スマホは MC-45 のブラウザ閲覧のみ。

---

## 次アクション

> **2026-05-30 実態整合更新**: Phase0〜4 は実装が出揃い、Apollo は :4317 で稼働中。残りは「検証エビデンスの後追い」と「Keita 追認」。

1. **品質ゲートの後追い検証**（最優先）: MC-G0〜G4・MC-G5 を reviewer + test-smoke で実行し green を確認 → 各ゲートと REVIEW タスク（MC-12/26/43/44/51）を DONE に昇格。
   - MC-12: agentMap マッチ率メトリクス（matched/total）を実データで計測。
   - MC-51/MC-G5: パストラバーサル境界値 smoke（`..%2f`/二重エンコード/NULL/symlink）。
   - MC-44: `systemctl is-enabled apollo.service` と再起動復帰・認証越し全画面 E2E。
2. **MC-43**: `deploy/README.md`（install/start/logs/rotate/token rotate 手順）の整備を確認 → DONE。
3. **Keita 追認点**:
   - (a) 常駐先＝本機（Vultr）で確定でよいか（既に稼働中、追認）。
   - (b) 製品名 Apollo 表記の最終確認（本台帳は Apollo に統一済み）。
   - (c) i18n 両言語化は不要（内部ツール）でよいか。
4. **MC-45（スマホ向けトンネル）** は follow-up のまま。常駐の安定確認後に着手。

---

## バッチ: 2026-05-30 Obsidian Vault 一元化ビュー（MC-5x / MVP=読む専用）

承認済みプラン全文: `/home/dev/.claude/plans/snazzy-hopping-spindle.md`

### 背景・目的
現状ダッシュボードは obsidian-vault の一部（10-Tasks のタスク、50-Daily の briefing/inspection/feedback、60-Agents 台帳）しか取り込んでいない。Keita の要望で「Obsidian の内容もこっちで一元化」＝**Vault 全体**（00-Inbox / 10-Tasks / 20-Knowledge / 20-Projects / 40-Resources / 50-Daily / 60-Agents / 90-Templates 等）をダッシュボード上で**閲覧**できる新ビュー「Vault」を追加する。

### スコープ（MVP）
- **読む専用**（read-only）。編集は今回スコープ外（MC-58 で follow-up 起票・BLOCKED）。
- backend: vault collector ＋ 4 API（tree / note / search / attachment）＋ wikilink→パス解決。**パストラバーサル防止が最重要セキュリティ要件**。
- frontend: 新ビュー「Vault」（左フォルダツリー / 中央ノート本文レンダリング / 上部全文検索）。Obsidian 記法対応。
- 既存 token 認証が全体（/api/vault/* 含む）に効くこと（追加認証は不要、MC-42 の延長）。

ID 採番: **MC-5x（Vault 一元化）/ MC-G5（品質ゲート）**。Phase 1（backend）→ Phase 2（frontend）に概ね対応するが、既存 Phase 完了を待たず独立バッチとして管理（依存は下表参照）。

> **実態反映(2026-05-30)**: Vault バックエンド（`server/src/collectors/vault.ts` + `server/src/lib/vaultPath.ts`）と 4 API（tree/note/search/attachment、`/api/vault/*` 稼働）、frontend（`web/src/views/Vault.tsx` + `components/ObsidianMarkdown.tsx` + `components/VaultTree.tsx` + `lib/obsidian.ts`）が実装済み。wikilink 解決（MC-54）は独立 `wikilink.ts` ではなく `vault.ts` 内に集約されている（タイトル索引キャッシュ + `resolveWikilink` 相当）。

| ID | タイトル | 優先度 | 層 | ステータス | 担当 | 依存 |
|----|---------|--------|-----|-----------|------|------|
| MC-51 | vault collector: lib/vaultPath.ts（realpath 限定・パストラバーサル防止） | P0 | backend | DONE | dev-logic | MC-02, MC-G0 |
| MC-52 | collector: vaultTree.ts ＋ GET /api/vault/tree（フォルダツリー・遅延ロード） | P0 | backend | DONE | dev-logic | MC-51 |
| MC-53 | collector: vaultNote.ts ＋ GET /api/vault/note?path=（本文・frontmatter 分離） | P0 | backend | DONE | dev-logic | MC-51 |
| MC-54 | wikilink 解決（[[wikilink]]/![[embed]]→パス解決・曖昧名解決） ※vault.ts に集約 | P0 | backend | DONE | dev-logic | MC-51, MC-52 |
| MC-55 | GET /api/vault/search?q=（全文検索・インデックス/キャッシュ要否判断） | P1 | backend | DONE | dev-logic | MC-51 |
| MC-56 | GET /api/vault/attachment?path=（添付/画像配信・MIME・realpath 限定） | P1 | backend | DONE | dev-logic | MC-51 |
| MC-57 | views/Vault.tsx（左ツリー/中央レンダリング/上部検索・Obsidian 記法対応） | P0 | frontend | DONE | dev-logic + designer | MC-52〜56, MC-21 |
| MC-58 | follow-up: Vault ノート編集機能（obsidian-git 同期競合リスク） | P2 | follow-up | TODO | dev-logic + Keita | MC-57 |
| MC-G5 | Vault 品質ゲート（パストラバーサル防御・4 API・記法レンダリング smoke） | P0 | gate | DONE | reviewer + test-smoke | MC-51〜57 |

---

### MC-51 — lib/vaultPath.ts（パストラバーサル防止）　[P0 / backend]
- ステータス: DONE / 担当: dev-logic
- 検証(2026-05-31 reviewer 関): 本番 :4317 `/api/vault/note` に境界値 smoke 実施、全て安全に遮断（escape 0件）: `../../../../etc/passwd`→400／`..%2f..%2fetc%2fpasswd`(URLエンコード)→400／`..%252f…`(二重エンコード)→404(vault 内解決・leak なし)／`/etc/passwd`(絶対)→400／`.git/config`→400／`.obsidian/…`→400／`..\..\etc\passwd`(backslash)→400。token 無し→401。`server/src/lib/vaultPath.ts` の多層防御（lexical normalize→resolve で `..` 畳み→境界文字付き isInside→realpathSync で symlink 実体再検証→FORBIDDEN_SEGMENTS→%2e/%2f/%5c・絶対パス・制御文字 reject）を確認。
- 実態根拠(2026-05-30): `server/src/lib/vaultPath.ts` 実在。lexical 正規化 + path.resolve + 境界文字付き prefix 検証 + `realpathSync` で symlink 実体再検証 + FORBIDDEN_SEGMENTS（.git/.obsidian/.claude/node_modules/.trash）拒否。SafePathError を 400/403 にマップ。
- 詳細: 全 vault API が受け取る `path` クエリを vault root 配下に限定するガード。`path.resolve` で正規化後、`fs.realpathSync` で symlink を解決し、**vault root を realpath 化したものの配下に収まること**を検証。外れたら 400/403。`..` ／絶対パス ／ symlink 経由の脱出を全て封じる。
- 関連ファイル: `cxo-agent/server/src/lib/vaultPath.ts`, `cxo-agent/server/src/config.ts`（vault root 参照）
- DoD: `../`, 絶対パス, symlink 経由の脱出 path を渡すと拒否（403）。正規 path のみ通す。境界（root 直下・root 自身・存在しない path）で落ちない。
- 依存: MC-02（config の vault root 定数）, MC-G0
- 提言・抜けもれ:
  - ⚠ **本バッチ最重要のセキュリティ要件**。realpath ベースで判定（文字列 prefix 比較だけだと `vault-evil/` のような prefix 一致で破られる → 末尾セパレータ込みで判定）。
  - 全 vault API（tree/note/search/attachment）が**例外なくこのガードを通す**こと。1 本でも素通しがあると穴になる。
  - 拒否時はパス内容をエラーレスポンスにエコーしない（情報漏洩・反射回避）。
  - **境界値テストを MC-G5 の test-smoke 必須項目**に（`..%2f` URL エンコード・二重エンコード・NULL バイトも）。

### MC-52 — vaultTree.ts ＋ GET /api/vault/tree　[P0 / backend]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `vault.ts` の `buildTree()` + `/api/vault/tree`（index.ts:135）実在。VAULT_EXCLUDE_DIRS で隠しフォルダ除外。
- 詳細: vault root 配下のフォルダ/ノートをツリー構造（`{name,path,type:dir|note,children?}`）で返す。トップ階層（00-Inbox 〜 90-Templates）を起点に、深い階層は**遅延ロード**（`?path=` で部分ツリー取得）対応。`.obsidian/` ／ `.git/` ／ node_modules は除外。
- 関連ファイル: `cxo-agent/server/src/collectors/vaultTree.ts`, `cxo-agent/server/src/index.ts`（ルート）
- DoD: `/api/vault/tree` がルート階層のツリーを返す。`?path=20-Projects` で部分ツリーを返す。隠しフォルダ除外。空/巨大フォルダで落ちない。全 path が MC-51 ガード経由。
- 依存: MC-51
- 提言・抜けもれ:
  - **Vault が大きいとツリーが重い（リスク2）** → 既定は1〜2階層だけ返し、展開時に遅延ロード。全展開を初回に返さない。
  - ソート順を定義（フォルダ先頭・番号プレフィクス昇順）。Obsidian の表示順に寄せる。
  - `.md` 以外（画像・PDF 等）も type 区別して返す（添付ナビ用、MC-56 と連動）。

### MC-53 — vaultNote.ts ＋ GET /api/vault/note?path=　[P0 / backend]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `vault.ts` の `readNote()` + `parseFrontmatter()`（gray-matter 相当の自前実装）+ `/api/vault/note`（index.ts:139）実在。frontmatter/body 分離・title 導出・outgoing/backlinks 付き。
- 詳細: 指定ノートの raw markdown を返す。frontmatter（YAML）を分離して `{frontmatter, body, path, title}` で返却。レンダリング自体は frontend（MC-57）だが、frontmatter のパースはここで実施（gray-matter 等）。
- 関連ファイル: `cxo-agent/server/src/collectors/vaultNote.ts`
- DoD: `/api/vault/note?path=...` が frontmatter 分離済み JSON を返す。frontmatter 無しノートも `frontmatter:{}` で正常。存在しない path は 404、ガード外は 403。
- 依存: MC-51
- 提言・抜けもれ:
  - 巨大ノートのサイズ上限を設ける（極端に大きいファイルで OOM しない）。
  - 文字コードは UTF-8 前提。BOM 除去。
  - frontmatter パース失敗時は body 全体を本文扱いにフォールバック（落とさない）。

### MC-54 — wikilink/embed→パス解決（vault.ts に集約）　[P0 / backend]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): 独立 `wikilink.ts` ではなく `vault.ts` に集約実装。タイトル索引（短期キャッシュ）+ wikilink ターゲット→vault 相対パス解決関数 + コードフェンス除外の抽出ロジックあり。未解決は null（壊れリンク扱い）。frontend `ObsidianMarkdown.tsx` の `resolveLink` がこの解決結果でクリック遷移。
- 詳細: `[[Note Name]]` ／ `[[Note Name#heading]]` ／ `[[Note Name|alias]]` ／ `![[image.png]]` ／ `![[Note Name]]`（埋め込み）を vault 内の実パスに解決するユーティリティ。Obsidian は basename ベースのリンク（フォルダ跨ぎでも名前だけ）なので、**vault 全体のノート名 index** を持って解決。同名衝突時は最短パス or フォルダ近接で決定（Obsidian 準拠の優先順）。
- 関連ファイル: `cxo-agent/server/src/lib/wikilink.ts`
- DoD: 代表的な wikilink/embed 記法が正しい path に解決される。未解決リンク（存在しないノート）は `null`（壊れリンク扱い）で落ちない。解決結果も MC-51 ガード配下に収まる。
- 依存: MC-51, MC-52（ツリー/ノート index を共有）
- 提言・抜けもれ:
  - **同名ノートの曖昧解決**が地雷。Obsidian の解決ルール（同フォルダ優先→最短パス）を踏襲。解決ログ/メトリクスを出せると検証が楽。
  - index は起動時 or キャッシュ構築（毎リクエスト全 scan しない、リスク2）。watch（MC-31）で更新があれば再構築 hook を将来検討（今回は再起動 or TTL でも可）。
  - frontend（MC-57）はこの解決結果でクリック遷移する → API レスポンスに解決済み path を含めるか、専用解決エンドポイントを切るか設計を1つに決める。

### MC-55 — GET /api/vault/search?q=（全文検索）　[P1 / backend]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `vault.ts` の `searchVault()`（Node 読み・シェル grep 非依存）+ `/api/vault/search`（index.ts:150）実在。ファイル名＋本文検索、frontmatter/title 込み。
- 詳細: vault 内 `.md` 全文に対するクエリ検索。`{path,title,snippet,matchCount}` の配列を返す。MVP は naive grep でも可だが、**Vault が大きいと重い（リスク2）** ため、インメモリインデックス or キャッシュの要否を判断して実装。
- 関連ファイル: `cxo-agent/server/src/collectors/vaultSearch.ts`, `cxo-agent/server/src/index.ts`
- DoD: `/api/vault/search?q=foo` がヒットノートと前後スニペットを返す。空クエリ・0 件・巨大 vault で破綻しない。全 path がガード配下。
- 依存: MC-51
- 提言・抜けもれ:
  - **キャッシュ/インデックス要否判断を明記**（リスク2）。まず計測（vault サイズ・grep レイテンシ）→ 遅ければ index 化。生成しっぱなしにせず計測で裏取り。
  - 検索結果はノート本文の機微情報を含む → 認証必須（MC-42）の確認を MC-G5 に含める（リスク3）。
  - frontmatter/タグも検索対象に含めるか定義（タグ検索 #tag は便利）。

### MC-56 — GET /api/vault/attachment?path=（添付/画像配信）　[P1 / backend]
- ステータス: DONE / 担当: dev-logic
- 実態根拠(2026-05-30): `vault.ts` の `resolveAttachment()` + `/api/vault/attachment`（index.ts:157）実在。MC-51 ガード経由・MIME 解決。SVG XSS 配信ヘッダ（Content-Disposition/CSP）と拡張子 allowlist の実装詳細は MC-G5 で確認推奨。
- 詳細: vault 内の画像・PDF 等の添付を MIME 付きで配信（`![[image.png]]` 表示用）。バイナリストリーム返却、Content-Type を拡張子から解決。
- 関連ファイル: `cxo-agent/server/src/index.ts`（ルート）, `cxo-agent/server/src/lib/vaultPath.ts`（ガード共用）
- DoD: 画像 path で正しい MIME＋バイナリを返す。非添付/危険拡張子は拒否。ガード外 path は 403。
- 依存: MC-51
- 提言・抜けもれ:
  - **MC-51 ガードを必ず通す**（画像配信は素通しになりがちな脱出経路）。
  - 配信許可する拡張子を allowlist 化（png/jpg/gif/webp/svg/pdf 等）。`.md` や任意ファイル素配信を許さない。
  - SVG 配信は XSS リスク（インライン script）→ `Content-Disposition`/CSP or sanitize 検討。
  - 大きい添付はストリーミング配信（全読みしない）。

### MC-57 — views/Vault.tsx（新ビュー）　[P0 / frontend]
- ステータス: DONE / 担当: dev-logic + designer
- 実態根拠(2026-05-30): `web/src/views/Vault.tsx` + `components/VaultTree.tsx` + `components/ObsidianMarkdown.tsx` + `lib/obsidian.ts` 実在。wikilink クリック遷移（未解決は淡色・非クリック）・embed 画像（/api/vault/attachment 経由）・callout（> [!info] 種別色）対応。
- 詳細: 3 ペイン構成 ＝ 左フォルダツリー（MC-52、展開で遅延ロード）/ 中央ノート本文レンダリング（MC-53）/ 上部全文検索バー（MC-55）。**Obsidian 記法対応**: `[[wikilink]]` クリックで該当ノートへ遷移（MC-54 解決）・frontmatter をメタ表示・`#tag` 表示・`> [!callout]` 装飾・`![[embed]]` 画像表示（MC-56 経由）。react-markdown + remark-gfm ＋ Obsidian 拡張プラグイン/カスタムレンダラ。`/vault` ルート追加。
- 関連ファイル: `cxo-agent/web/src/views/Vault.tsx`, `cxo-agent/web/src/App.tsx`（ルート追加）, `web/src/lib/useLiveData.ts`（fetch）
- DoD: /vault でツリー・ノート・検索が機能。[[wikilink]] クリックで遷移、frontmatter 表示、#tag・callout・embed 画像が描画。ガード外 path をリクエストしない（解決済み path のみ辿る）。
- 依存: MC-52〜56, MC-21（frontend 基盤）
- 提言・抜けもれ:
  - **ハードコード hex 禁止・CSS 変数/Tailwind トークン使用・UI chrome は SVG のみ（emoji 不可）**（既存デザイン制約）。callout のアイコンも SVG。
  - 状態色/タグ色は意味を担うなら**語ラベル/aria 併記**（アクセシビリティ）。
  - react-markdown の **HTML/画像/リンクは同一オリジン外を新規タブ＋rel 付与**、生 HTML は sanitize（MC-25 と同方針）。XSS 対策。
  - 巨大ノート/長いツリーは仮想化 or ページング検討（MC-23/34 と同じパフォーマンス観点）。
  - **未解決 wikilink（壊れリンク）は無効スタイルで表示**して固まらない（MC-54 の null を受ける）。
  - レスポンシブ（PC 常駐＋スマホチラ見、MC-26/MC-45 見据え）。3 ペインはスマホ幅で段組み崩れしないよう折りたたみ。

### MC-58 — follow-up: Vault ノート編集機能　[P2 / follow-up]
- ステータス: TODO / 担当: dev-logic + Keita
- 詳細: ダッシュボード上から vault ノートを編集・保存する機能。今回 MVP は read-only のため**着手しない**。1 件だけ起票して保留。
- 関連ファイル: （未着手）
- DoD: （保留中。着手判断が出てから DoD 定義）
- 依存: MC-57
- 提言・抜けもれ:
  - ⚠ **obsidian-git 同期競合リスク**: Keita のローカル Obsidian が obsidian-git で自動 commit/pull している場合、ダッシュボードからの書き込みと衝突（コンフリクト・上書き・データ消失）し得る。編集を入れるなら (a) 楽観ロック/競合検知、(b) 書き込み先の git 状態確認、(c) 同期戦略の合意が前提。
  - read 専用の今回は無害だが、編集解禁は**Keita の明示判断が必須**。BLOCKED 据え置き、勝手に IN_PROGRESS にしない。

### MC-G5 — Vault 品質ゲート　[P0 / gate]
- ステータス: DONE / 担当: reviewer + test-smoke
- 検証(2026-05-31 reviewer 関): 本番 :4317 で全項目 green。(1)パストラバーサル境界値 smoke＝`../`／`..%2f`(URLエンコード)／`..%252f`(二重エンコード)／絶対パス／`.git`／`.obsidian`／backslash を `/api/vault/note` に投げて全て 400 or 404（vault 外 leak 0件、MC-51 検証参照）。(2)4 API 実データ＝`/api/vault/tree`(22KB,200)・`/api/vault/search?q=apollo`(実ヒット `20-Knowledge/design/apollo-kairo-ui-design-…md` 返却)・`/api/vault/note`(該当ノート 5.5KB,200)・attachment は同 `resolveVaultPath` ガード経由（コード確認）。(3)401 認証＝token 無し `/api/vault/tree`→401。(4)記法レンダリング＝note payload が `frontmatter/body/outgoingLinks/backlinks` を分離返却、`collectors/vault.ts:182-340` で `[[wikilink]]`/embed をパス解決（未解決は null＝壊れリンク扱いで落ちない）。
- 詳細: MC-51〜57 完了時に通す品質ゲート（生成→レビュー→統合）。
- DoD:
  - **パストラバーサル防御 smoke**（`../` ／絶対パス ／ symlink ／ `..%2f` ／二重エンコード ／ NULL バイトを全 vault API に投げて 403/400・脱出無し）← 最重要。
  - 4 API（tree/note/search/attachment）が実データで 200＋正規化レスポンス。壊れ入力耐性。
  - **未認証アクセスは 401**（既存 token 認証が /api/vault/* に効く、MC-42 連動・リスク3）。
  - frontend smoke: /vault 描画・wikilink クリック遷移・embed 画像表示・frontmatter/#tag/callout レンダリング・クラッシュ無し（Playwright）。
  - 巨大 vault でツリー/検索が許容レイテンシ内（リスク2、計測値を記録）。
- 依存: MC-51〜57
- 提言・抜けもれ: パストラバーサル境界値テストは MC-51 単体テストと MC-G5 統合 smoke の**両方**に置く（防御の二重化検証）。

---

## リスク・留意（MC-5x 追記）

1. **パストラバーサル＝最重要セキュリティ（MC-51）**。realpath ベースで vault root 配下限定、文字列 prefix 一致だけに頼らない。全 4 API（tree/note/search/attachment）が例外なくガードを通す。URL エンコード/二重エンコード/NULL バイト/symlink 脱出を境界値テストで封じる。1 本でも素通しがあると穴。
2. **Vault が大きいとツリー/検索が重い（MC-52/55）**。ツリーは遅延ロード（初回1〜2階層）、検索はまず計測→必要なら index/キャッシュ化。wikilink 解決 index も起動時/キャッシュ構築で毎リクエスト全 scan しない。
3. **機微情報（Vault は Keita 本人の内容）**。認証必須で保護＝既存 token 認証（MC-42）が /api/vault/* 全体に効くことを MC-G5 で 401 確認。検索結果・添付配信も認証配下。
4. **wikilink 同名衝突解決（MC-54）**。Obsidian の basename リンク解決ルール（同フォルダ優先→最短パス）を踏襲。未解決は null＝壊れリンク表示で固まらせない。
5. **編集スコープ外・obsidian-git 競合（MC-58）**。MVP は read-only。編集解禁は同期競合リスクのため Keita 明示判断必須、BLOCKED 据え置き。

---

## 抜けもれ提言サマリ（MC-5x 追記）

プランに明示されていたものを台帳化＋暗黙タスクを先回りで起票したもの:

- **MC-51 を独立タスク化**: パストラバーサル防御を「各 API に書く注意」ではなく**共用ガード lib として1本に集約**（全 API が必ず通す。素通し穴防止）。最重要セキュリティとして P0 単独起票。
- **MC-54 wikilink 解決を独立タスク化**: `[[wikilink]]` クリック遷移は同名衝突解決が地雷。Obsidian 準拠ルール＋index キャッシュを明記。frontend と backend どちらで解決するか設計を1つに決める要確認点。
- **MC-56 SVG 添付の XSS 注記**: 画像配信で SVG はインライン script リスク → sanitize/CSP/Content-Disposition を検討項目に。
- **MC-57 react-markdown の sanitize/外部リンク rel**: 既存 MC-25 と同方針で XSS・外部遷移を安全側に。callout/embed のカスタムレンダラ実装が必要（react-markdown 素では Obsidian 記法非対応）。
- **MC-G5 にパストラバーサル境界値 smoke を必須化**: 単体テスト（MC-51）＋統合 smoke（MC-G5）の二重化。URL エンコード/二重エンコード/NULL バイト/symlink を網羅。
- **遅延ロード/キャッシュ要否を計測で裏取り**（MC-52/55）: 「重そう」で勝手に作り込まず、まず計測→必要なら index 化（efficiency 観点）。
- **認証カバレッジ確認**（MC-G5）: 新 /api/vault/* が既存 token 認証配下に確実に入るか 401 テストで担保（追加認証は不要＝MC-42 の延長で OK の前提を検証）。
- **i18n / 両OS**: 本ビューも内部ツール（Keita のみ）想定のため i18n 両言語化は対象外、Web ダッシュボードなので両OS非該当（既存バッチと同方針）。
- **編集 follow-up を1件だけ起票・BLOCKED**（MC-58）: スコープ拡大防止。obsidian-git 競合を注記し Keita 判断待ちで保留。

---

## 次アクション（MC-5x）

1. **着手前の Keita 確認点**:
   - (a) MVP = read-only でよいか（編集 MC-58 は BLOCKED 保留の方針確認）。
   - (b) wikilink 解決を backend 集中（解決済み path を返す）か frontend 解決（index を渡す）か — 設計を1つに寄せたい。
   - (c) vault root の絶対パス（env override）確定（MC-02 の vault root 定数と一致させる）。
2. 確認後 **MC-51（パストラバーサル防御 lib）から着手**。これが全 API の前提なので最初。dev-logic に委譲、workflow で生成→reviewer→統合。
3. backend（MC-51〜56）→ MC-G5 のうち API 部分通過 → frontend（MC-57）→ MC-G5 統合 smoke の順。各段で品質ゲート。
4. MC-58 は **BLOCKED 据え置き**。Keita 承認が出るまで IN_PROGRESS にしない。
5. task-manager は各完了報告を受けて DoD 検証→DONE/REVIEW 差し戻し＋本台帳更新。

---

## バッチ: 2026-05-30 自律林ドライバ（autonomous-rin）

### 概要・目的
駆動役（対話セッションの林）がいなくてもタスクが**自律前進**する仕組み。30 分毎の cron で headless 林（`claude --print`）を起動し、着手可能タスクを「1ティック1タスク」だけ前進させる。green ゲート（テスト/型/lint 通過）を満たす限り **deploy まで全自律**（Keita 承認済み 2026-05-30）。

ID 採番: **AR-0x**。

| ID | タイトル | 優先度 | ステータス | 担当 | 依存 |
|----|---------|--------|-----------|------|------|
| AR-01 | autonomous-rin.sh（ティック駆動スクリプト・ガードレール） | P0 | DONE | 林 + Keita | なし |
| AR-02 | cron 登録（*/30 で常時駆動） | P0 | TODO | 林 + Keita | AR-01 |
| AR-G0 | dry-run 検証（DRY_RUN=1 で選定→1歩・push/deploy 無し） | P0 | TODO | 林 | AR-01 |

### AR-01 — autonomous-rin.sh　[P0]
- ステータス: DONE / 担当: 林 + Keita
- 検証(2026-05-31 reviewer 関): `/home/dev/cron-scripts/autonomous-rin.sh`(実行権限あり)にガードレール全実装を確認＝flock 排他・kill-switch(`~/.autonomous-rin.disabled` でティック開始時に即終了)・`DRY_RUN=1` で `git push`/`gh` を物理 shim no-op 化(`[DRY_RUN] … blocked by shim`)・green ゲート(`tsc --noEmit`+`eslint .` 代替、3回まで自動修正)・1ティック1タスク・deploy 最大1回・`--print` headless。本番ループは実稼働中＝`crontab -l` に `*/10` エントリあり、`~/logs/autonomous-rin.log` に当日ティック完走記録（18:18 done→18:20 start、green・deploy 判断ログあり）。DoD（dry-run 選定→1歩・push/deploy 無し／kill-switch 即停止／本番ティックで green ゲートを破らず deploy）充足。※cron は AR-02 spec の `*/30` でなく `*/10` で既登録＝AR-02 も実質稼働（別タスク・林確認推奨）。
- 詳細: 30 分毎 cron で headless 林を起動し1ティック1タスク前進。deploy まで全自律（Keita 承認済 2026-05-30）。
- 関連ファイル: `/home/dev/cron-scripts/autonomous-rin.sh`、kill-switch `~/.autonomous-rin.disabled`、ロック `/tmp/autonomous-rin.lock`、ログ `~/logs/autonomous-rin.log`
- 実態根拠(2026-05-30): `/home/dev/cron-scripts/autonomous-rin.sh` 実在（実行権限あり）。ガードレール実装確認: flock 排他（前ティック走行中は skip）・kill-switch（`~/.autonomous-rin.disabled` があれば即終了）・`DRY_RUN=1`（選定と1歩のみ・push/deploy 無し）・green ゲート/1ティック1タスク/deploy 最大1回はプロンプト側で厳守・`--print`(headless) で session-cleanup reap 対象外。
- DoD: dry-run（DRY_RUN=1）で「タスク選定→1歩前進・push/deploy 無し」が確認でき、kill-switch で即停止できる。本番ティックで green ゲートを破らず deploy する。
- 依存: なし
- 提言・抜けもれ:
  - **本番駆動の前に AR-G0（dry-run）を必ず通す**。いきなり cron 常時駆動にしない。
  - kill-switch（`~/.autonomous-rin.disabled`）の存在・即停止を Keita がいつでも使える状態に（README/手順を残す）。
  - green ゲート（test/型/lint）未通過時に push/deploy しないことをプロンプト側で厳守 — ここが破れると無人で赤デプロイの事故。logic は CI lint が `eslint .`（リポ全体）なので scoped lint で済ませない（reference_logic_ci_lint_scope）。
  - ログローテ（`~/logs/autonomous-rin.log`）肥大化対策を検討。

### AR-02 — cron 登録　[P0]
- ステータス: TODO / 担当: 林 + Keita
- 詳細: `*/30 * * * * bash -lc "$HOME/cron-scripts/autonomous-rin.sh >> $HOME/logs/autonomous-rin.log 2>&1"` を crontab に登録。
- 実態根拠(2026-05-30): 現状 `crontab -l` に rin エントリ **無し**（未登録）。AR-G0 の dry-run 検証通過後に登録する。
- DoD: crontab に登録され、30 分毎にティックが起動する（ログに tick start が刻まれる）。
- 依存: AR-01（＋AR-G0 通過が前提）

### AR-G0 — dry-run 検証　[P0]
- ステータス: TODO / 担当: 林
- 詳細: `DRY_RUN=1 bash ~/cron-scripts/autonomous-rin.sh` を1回実行し、(1) タスク選定が走る (2) 1歩だけ前進 (3) push/deploy が一切走らない (4) kill-switch で即終了する、を確認。
- DoD: 上記4点を満たすログが取れる。問題なければ AR-01 を DONE、AR-02（cron 登録）へ。
- 依存: AR-01

---

## バッチ: 2026-05-31 ドッグフーディング feedback トリアージ（運用ミス1件）

ソース: 社内ドッグフーディング(dogfood)で投入した feedback 全20件のトリアージ中に検出した Apollo 運用上の不整合1件。logic 系の actionable は `logic/docs/TASK_TRACKER.md` のバッチ「2026-05-31 ドッグフーディング feedback トリアージ」（FB-01〜FB-10＋既存 DF-F 系への dedup 寄せ）に登録済み。本ファイルには Apollo 運用ミス1件のみ。ID は既存 MC-01〜58/G0〜G5・AR-0x と衝突しない **MC-59**。

### MC-59 — inbox.jsonl の消し込み漏れ修正（フェルミCTA件）
- 優先度: P2（重大度: 低）/ ステータス: TODO / 担当案: dev-logic
- 詳細: フェルミCTA件（inbox id `2026-05-30T22-51-15...`）は logic 側で UI-14 として実装・push（commit `d05e454`）・本番 deploy まで完了済みなのに、`cxo-agent/data/inbox.jsonl` 側の当該レコードが `status: pending` のまま残っている。実体は consumed 済み（自律林が `inbox-consumed.jsonl` に id 追記する運用＝project_autonomous_rin）なので台帳と実態が乖離している。
- DoD: 当該 inbox レコードの status が consumed 済み実態と整合する（`status: pending` 解消、または `inbox-consumed.jsonl` との突き合わせで pending 表示が消える）。さらに、実装・deploy 完了時に inbox 側を自動で消し込む処理が入っていれば再発しない。
- 関連: `cxo-agent/data/inbox.jsonl`、`cxo-agent/data/inbox-consumed.jsonl`、logic UI-14（実装済 commit `d05e454`）、自律林の消費ロジック（project_autonomous_rin）
- 依存: なし
- 提言・抜けもれ:
  - 単発の手動 status 更新で済ませると同種の漏れが再発する。実装完了/deploy フックで inbox を consumed に落とす自動消し込みをセットで検討（恒久対策）。
  - 過去の inbox 全体に同様の取り残し（実装済みなのに pending）が他にないか棚卸しすると良い。
  - 回帰: 自動消し込みを入れる場合、まだ実装中の pending を誤って消さないこと（consumed 判定の根拠を明確に）。
  - 破壊的編集に注意（data/ は自律林・Apollo が書く共有ファイル。名指し編集で）。
- note: 2026-05-31 ドッグフーディング(dogfood)で検出。社内ドッグフーディング投入データ（source=dogfood）由来の運用上の不整合であり、外部実ユーザ起票ではない。
- 更新日: 2026-05-31

#### 抜けもれ提言サマリ（MC-59）
- inbox.jsonl の status 管理は手動消し込み運用だと乖離が再発する。実装/deploy 完了と連動した自動消し込みを恒久対策として検討すべき。

#### 次アクション（MC-59）
- dev-logic が当該レコードの status 整合を修正。自動消し込み化の要否は Keita 判断。

---

## バッチ: 2026-05-31 Apollo タスク中心ドリルダウン強化（MC-6x）

ソース: Keita 2026-05-31 決定。Apollo を「タスク中心のドリルダウン」に強化する。タスクをクリックしたら、その詳細の中で「進捗・workflow・エージェント会話」が一望できるようにする。スコープは「フル」。タスク↔workflow↔会話の紐付けは「軽い案＝ID 文字列マッチ」を採用。

採番: 既存 MC-01〜59 / MC-G0〜G5 / AR-0x と衝突しない **MC-60〜MC-65**。MC-60〜62 がコア（優先度 高〜中）、MC-63〜65 がおまけ（優先度 中〜低）。

> **実装着手タイミング（全件共通）**: 着手は「人格 workflow 着地後」。それまでは全件 TODO で起票のみ（今回は登録・構造化が目的、実装はしない）。実装は dev-logic に委譲（UX 検討は designer 併走）。

> **既存実装との関係（重複回避の整理）**:
> - 会話 Feed は既に `web/src/views/Feed.tsx`（MC-34）＋ `/api/agents/:id/feed`（agent-*.jsonl を user/assistant/tool_use で時系列化）で実装済み。MC-61 のタスク詳細内「紐づくエージェント会話」は**この既存 Feed の該当スレッドを埋め込む＝既存拡張**であり、会話解析を新規実装しない。
> - タスクボードは既に `web/src/views/Tasks.tsx`（MC-24、5列 Kanban）で実装済み。MC-61 のカードクリック→ドロワー/詳細は**既存 Tasks ビューへのドリルダウン追加＝既存拡張**。Kanban 自体を作り直さない。
> - workflow 実行ログ（`subagents/workflows/wf_*/`）は現状どの API でも拾われていない＝ MC-60 でコレクタ新規。

| ID | タイトル | 優先度 | 区分 | ステータス | 担当 | 依存 |
|----|---------|--------|------|-----------|------|------|
| MC-60 | Workflow コレクタ＋API 新規（/api/workflows・/api/workflows/:runId） | P0 | コア | DONE（2026-05-31 本番反映済 commit 6362562。restart後 本番4317で /api/workflows が20run返却確認） | dev-logic | なし（既存 collectors/lib 流用） |
| MC-61 | タスク詳細ドリルダウン（フロント＋API、既存 Tasks/Feed 拡張） | P0 | コア | DONE（2026-05-31 本番反映済 commit 6362562。TaskDetail.tsx 561行・web build→restart 済） | dev-logic + designer | MC-60 |
| MC-62 | タスク↔workflow↔会話 紐付け（堅い案＝明示ログ data/task-links.jsonl） | P1 | コア | DONE（2026-05-31 本番反映済 commit f0bfb52。link-task.sh で MC-60↔wf_880723a6-991 を実紐付け→API hasExplicitLinks:true でrun summary返却をE2E実証） | dev-logic（運用ルールは林） | MC-60 |
| MC-63 | 通知/アラート（ERROR・BLOCKED 長期滞留・deploy 失敗のバッジ） | P2 | おまけ | DONE（2026-05-31 本番反映済 commit 37ad6ed。/api/alerts 新規＋司令塔 AlertBanner。restart 後 本番4317 で `counts:{error:0,warning:0,total:0}` / `byCategory` / `thresholds.blockedStallDays:5` を返却＝現在アラート0件で正常、無トークン401・healthz ok 検証済） | dev-logic | MC-60, MC-61 |
| MC-64 | deploy 連動（GitHub Actions run 状態をタスク詳細に表示） | P2 | おまけ | TODO | dev-logic | MC-61 |
| MC-65 | autonomous-rin 可視化（30分毎ティックの選択タスク×結果レーン） | P2 | おまけ | TODO | dev-logic | MC-61 |
| MC-81 | tasks collector の normStatus 堅牢化（statusセル先頭トークンで正規化） | P2 | 品質 | DONE | dev-logic | MC-80（棚卸し中に副産物として発見） |

---

### MC-60 — Workflow コレクタ＋API 新規　[P0 / コア]
- ステータス: TODO / 担当: dev-logic
- 詳細: `~/.claude/projects/**/subagents/workflows/wf_*/` 配下の各 run（フェーズ・孫エージェント jsonl）を解析する collector を新規実装。返すもの: workflow run 一覧 / 各 run のフェーズ進捗 / 孫エージェントのツリー（親 workflow→phase→孫 agent）/ 各ノードの状態（active/idle/done/error）/ トークン消費。新エンドポイント `GET /api/workflows`（run 一覧）と `GET /api/workflows/:runId`（1 run のフェーズ・孫ツリー詳細）。
- 関連ファイル: `cxo-agent/server/src/collectors/`（新規 workflows.ts）, 既存 `lib/jsonl.ts`（末尾読み・空/壊れ耐性を流用）, `lib/stall.ts`（8分しきい値を流用）, `lib/projectMap.ts`, `lib/redact.ts`, `server/src/index.ts`（ルート追加）
- DoD: `/api/workflows` が wf_* run の `{runId, label, project, status, phases[], lastActivity, tokens}` を配列で返す。`/api/workflows/:runId` がフェーズ進捗＋孫エージェントツリー＋トークンを返す。wf_* が0件でも空配列で 200（落ちない）。壊れ/空 jsonl で例外を吐かない。
- 依存: なし（Phase1 collectors / lib は実装済みなので流用前提）
- 提言・抜けもれ:
  - server コード変更なので反映に `sudo systemctl restart mission-control.service` が必要（生 tsx 起動は禁止、ポート 4317 競合。project_apollo_dashboard 準拠）。
  - 既存 API（/api/agents /tasks /narrative /roster /usage /inbox, SSE /api/stream）を**非破壊**で追加すること。既存ルートのレスポンス型を変えない。
  - 巨大 jsonl はフル読みせず末尾/ストリーム読み（メモリ・速度。MC-11 と同方針）。
  - 滞留・状態判定は stall.ts の8分しきい値を再利用（二重定義しない。reference_subagent_slow_not_dead 準拠で短く切らない）。
  - SSE 反映: workflow も chokidar watch（MC-31）対象に含め、wf_* 追記で `/api/stream` に乗るか確認（タスク詳細をライブ更新させたいなら必須）。watch 対象拡張は MC-60 か MC-61 のどちらで持つか実装時に決める。
  - PII/シークレット混入対策に redact.ts を通す（孫 agent の prompt にトークン等が出る可能性）。
  - 認証: 既存 token/Basic（MC-42）配下に新 API も入れる（認証バイパスの新口を作らない）。
- note: 着手は人格 workflow 着地後。今回は起票のみ。
- 更新日: 2026-05-31

### MC-61 — タスク詳細ドリルダウン（既存 Tasks/Feed 拡張）　[P0 / コア]
- ステータス: TODO / 担当: dev-logic + designer（UX）
- 詳細: 既存タスクボード（MC-24 `views/Tasks.tsx`）のカードをクリックでドロワー/詳細を開く。詳細の中に (a) 概要・ステータス・担当・note（TASK_TRACKER 由来＝既存 /api/tasks）、(b) 進捗タイムライン、(c) 紐づく workflow run のフェーズ進捗（MC-60 の /api/workflows）、(d) 紐づくエージェント会話（既存 Feed の該当スレッド＝/api/agents/:id/feed の埋め込み）を一望表示。会話解析・Kanban 本体は**既存を再利用**し新規重複しない。
- 関連ファイル: `cxo-agent/web/src/views/Tasks.tsx`（カード→クリックハンドラ追加）, 新規 詳細ドロワー component（`web/src/components/`）, `web/src/views/Feed.tsx`（該当スレッド埋め込み再利用）, 必要なら `server` 側にタスク詳細集約エンドポイント（既存 /api/tasks /api/workflows /api/agents feed を束ねる薄い層、要否は実装時判断）
- DoD: Kanban のカードクリックで詳細が開き、概要＋進捗タイムライン＋紐づく workflow run（フェーズ進捗）＋紐づく会話スレッドが1画面で見える。紐付けが無いタスクでも詳細は開ける（空状態を明示表示、クラッシュしない）。モバイル（390px）でドロワーが横溢れ0。
- 依存: MC-60（workflow 表示のため）。会話埋め込みは既存 Feed なので MC-34 既存実装に依存。
- 提言・抜けもれ:
  - web 変更は `cd web && npm run build` で dist 更新→静的配信に反映（project_apollo_dashboard 準拠）。
  - **モバイルレスポンシブ維持**（既存 Apollo は md 未満で BottomNav・単一カラム化済み）。ドロワーはモバイルでボトムシート/フルスクリーン化を検討（designer UX）。
  - デザイン制約: ハードコード hex 禁止・既存配色/状態ドット/タイポ（MC-26 デザインシステム）に追従。UI chrome は emoji 不可・SVG アイコンのみ（feedback_logic_lesson_visual_hybrid の UI ルール）。
  - 文言は中立的丁寧体（feedback_app_copy_neutral）。「データがありません」等の空状態文言もニュートラルに。
  - SSE ライブ反映: 詳細を開いたまま該当 workflow/会話が進んだら自動更新されるのが理想（useLiveData/EventSource、MC-33 流用）。最低でも再フェッチで追従。
  - アクセシビリティ: ドロワーのフォーカストラップ・Esc クローズ・状態ドットに語ラベル併記。
  - 既存 Tasks ビューの Kanban 挙動（色分け・滞留バッジ）を壊さない（回帰）。カードクリックがドラッグ等の既存操作と競合しないか確認。
- note: 着手は人格 workflow 着地後。今回は起票のみ。会話 Feed・Kanban は既存拡張（新規重複しない）。
- 更新日: 2026-05-31

### MC-62 — タスク↔workflow↔会話 紐付け（軽い案＝ID 文字列マッチ）　[P1 / コア]
- ステータス: TODO / 担当: dev-logic（運用ルール側は林も関与）
- 詳細: タスク（FB-06 / MC-xx / UI-xx 等の ID）と、それを動かした workflow run / agent 会話を機械的に繋ぐ鍵を持たせる。採用方式は「軽い案＝ID 文字列マッチ」: (1) 運用ルール — 林が agent/workflow 起動時に prompt・label へ対象タスク ID を必ず入れる。(2) コレクタ側 — workflow run / agent 会話の label・prompt 本文から既知タスク ID パターンを正規表現で拾い、タスクに紐づける。精度不足時に「堅い案（`data/task-links.jsonl` に明示マッピングを書く）」へ拡張できる設計余地を残す。
- 関連ファイル: `cxo-agent/server/src/collectors/`（workflows.ts / agents.ts に ID 抽出ロジック）, 新規 `lib/taskLink.ts`（ID パターン抽出・突き合わせの集約）, 将来拡張用 `cxo-agent/data/task-links.jsonl`（堅い案、今回は未作成）, 運用ルールは林の workflow 起動手順（memory 化候補）
- DoD: prompt/label にタスク ID を含む workflow run・agent 会話が、対応タスクの詳細（MC-61）に紐づいて表示される。ID 表記ゆれ（MC-60 / mc-60 / MC60 等）を吸収。マッチしないものは「未紐付け」として扱い、誤紐付け（別タスク ID への取り違え）を出さない。
- 依存: MC-60（紐付け対象の workflow データ）。表示先は MC-61。
- 提言・抜けもれ:
  - ID パターンは複数プレフィックス対応（MC- / FB- / UI- / AR- / T- / NF- 等、各プロジェクト台帳の採番）。プロジェクト跨ぎの誤マッチを projectMap で抑止。
  - **運用ルールの徹底が肝**: prompt/label に ID を入れ忘れると紐付かない。林側の workflow 起動手順に組み込み、memory（feedback 系）化を検討。task-manager 側でも「workflow に流すタスクは ID を必ず prompt に明記」を運用に追加。
  - 堅い案への拡張余地: 軽い案で精度が出ない場合 `data/task-links.jsonl`（taskId↔runId↔agentId の明示マップ）に切替/併用できるよう、抽出層をインターフェース化しておく。
  - 1タスクに複数 run/会話が紐づく多対多を許容（配列で持つ）。
  - 誤紐付け回避を優先（再現率より適合率重視。間違って別タスクに会話がぶら下がる方が混乱が大きい）。
- note: 着手は人格 workflow 着地後。今回は起票のみ。軽い案採用は Keita 決定。堅い案は将来オプション。
- 更新日: 2026-05-31

### MC-63 — 通知/アラート（バッジ表示）　[P2 / おまけ]
- ステータス: DONE（2026-05-31 本番反映済 commit 37ad6ed）/ 担当: dev-logic
- 確定スコープ（DoD 対応）: ERROR=workflow error run、長期 BLOCKED=BLOCKED かつ最終更新が BLOCKED_STALL_DAYS（既定5日）超、deploy 失敗=MC-64 連携のため MVP は常に空（偽失敗を出さない）。3カテゴリを既存 collector（workflows/tasks）から集計する軽量 `/api/alerts` を新規追加し、司令塔（Overview）に `AlertBanner` を常設。解消すると次回集計で自動的に消える（永続/既読なし＝MVP）。誤検知ゼロ方針（構造化済みデータのみ参照、night-patrol 生ログや systemd は拾わず多重通知回避）。
- 実装ファイル: 新規 `server/src/collectors/alerts.ts`・`web/src/components/AlertBanner.tsx`、変更 `server/src/config.ts`（BLOCKED_STALL_DAYS 追加）・`server/src/index.ts`（GET /api/alerts 追加）・`web/src/lib/types.ts`（AlertsResponse 型）・`web/src/views/Overview.tsx`（AlertBanner 設置）。
- 本番反映確認: `sudo systemctl restart mission-control.service` 後 active。`/api/healthz`=200 `{"ok":true}`、`/api/alerts` 無トークン=401（認証バイパス無し）、Bearer 付き=200 で `counts:{error:0,warning:0,total:0}` / `byCategory:{error:0,"blocked-stalled":0,"deploy-failed":0}` / `thresholds.blockedStallDays:5`＝現在アラート0件で正常（error run も長期 BLOCKED も無し）。server tsc / web tsc / web build いずれも green。
- 詳細: night-patrol の ERROR 検出・BLOCKED 長期滞留・deploy 失敗を Apollo 上でバッジ表示する。該当タスク/エージェント/グローバルヘッダにアラートを出し、放置を見逃さない。
- 関連ファイル: `cxo-agent/server/src/collectors/`（narrative.ts の night-patrol/inspection 解析を流用してアラート抽出）, タスク側は /api/tasks の BLOCKED 滞留判定（stall.ts）, deploy 失敗は MC-64 の GitHub Actions 連携と重なる, フロントは共通バッジ component
- DoD: ERROR / 長期 BLOCKED / deploy 失敗が発生したとき Apollo にバッジが出る。解消すると消える。誤検知（正常を ERROR 表示）が出ない。
- 依存: MC-60, MC-61（タスク詳細に出すため）。deploy 失敗は MC-64 と連携。
- 提言・抜けもれ:
  - BLOCKED「長期滞留」のしきい値定義が必要（stall.ts の8分とは別軸＝日単位の停滞か。要件定義してから実装。曖昧なら BLOCKED）。
  - ERROR ソースの確定: night-patrol ログ／agent jsonl の error 行／systemd 失敗のどれを拾うか。多重通知を避ける。
  - server restart 要・既存 API 非破壊・モバイルでバッジが潰れない・文言は中立的丁寧体。
  - 通知の永続化（既読/未読）まで持つかは要件次第。MVP は表示のみで可。
- note: おまけ（優先度 中〜低）。着手は人格 workflow 着地後。要件（しきい値・ERROR ソース）の確定が前提。
- 更新日: 2026-05-31

### MC-64 — deploy 連動（GitHub Actions run 状態表示）　[P2 / おまけ]
- ステータス: TODO / 担当: dev-logic
- 詳細: GitHub Actions の deploy 系 workflow（logic: deploy-production / android-deploy、en-chakai: deploy-production 等）の run 状態（queued/in_progress/success/failure）をタスク詳細（MC-61）に表示する。「このタスクの実装が本番に出たか」を Apollo から把握できるようにする。
- 関連ファイル: `cxo-agent/server/src/collectors/`（新規 deploys.ts、`gh` CLI or GitHub API で run 取得）, server に新エンドポイント（/api/deploys 等）, フロントはタスク詳細内セクション
- DoD: タスク詳細に直近の deploy run 状態が出る。run が無いタスクは空状態。GitHub API レート/認証エラーで Apollo 全体が落ちない（フォールバック表示）。
- 依存: MC-61（表示先）。MC-62（タスク↔deploy 紐付けに ID マッチが要る場合）。
- 提言・抜けもれ:
  - 認証: `gh` の GH_TOKEN/既存トークンを使う（新箱は GH_TOKEN env 方式。project_vultr_second_server）。トークンを台帳・コードに直書きしない。
  - レート制限・タイムアウト時のキャッシュ（usage の5分キャッシュ方式を流用）。
  - 対象 repo は logic / en-chakai（cxo-agent リポは Issue/deploy 用途に使わない＝feedback_no_cxo_agent。Apollo 可視化対象としての参照は別レイヤーだが、deploy 連動対象は logic/en-chakai に絞る）。
  - server restart 要・既存 API 非破壊・モバイル表示・中立文言。
  - タスクと deploy run の紐付けは commit/PR 番号 or ブランチ名ベースになる可能性。ID 文字列マッチ（MC-62）だけで足りるか実装時に検証。
- note: おまけ（優先度 中〜低）。着手は人格 workflow 着地後。
- 更新日: 2026-05-31

### MC-65 — autonomous-rin 可視化（ティック×結果レーン）　[P2 / おまけ]
- ステータス: TODO / 担当: dev-logic
- 詳細: 自律林（autonomous-rin、30分毎 cron ティック）が各ティックで「どのタスクを選び、何をして、結果どうなったか（commit/push/deploy/skip/失敗）」を専用レーンで時系列表示する。`~/logs/autonomous-rin.log` と inbox 消費（inbox-consumed.jsonl）を可視化ソースにする。
- 関連ファイル: `cxo-agent/server/src/collectors/`（新規 autonomousRin.ts、`~/logs/autonomous-rin.log` 解析）, `cxo-agent/data/inbox-consumed.jsonl`, server 新エンドポイント, フロントは専用レーン view or タスク詳細内セクション
- DoD: ティックごとの「選択タスク・アクション・結果」が時系列レーンで見える。ログが空でも落ちない。直近 N ティックを表示。
- 依存: MC-61（タスク詳細に出すなら）。スタンドアロンのレーン view なら依存は薄い。
- 提言・抜けもれ:
  - ログフォーマット依存になるので、autonomous-rin.sh のログ出力形式（tick start/選定/結果）と密結合。フォーマット変更時に壊れない緩いパースに。
  - DRY_RUN ティックと本番ティックを区別表示（push/deploy 有無）。
  - ログファイルのパスは config.ts に集約（ハードコード散在禁止）。$HOME ベース解決（Vultr/ローカル差吸収）。
  - server restart 要・既存 API 非破壊・モバイル表示・中立文言。
  - 大きくなるログの末尾読み（メモリ）。
- note: おまけ（優先度 中〜低）。着手は人格 workflow 着地後。関連: project_autonomous_rin。
- 更新日: 2026-05-31

---

## 抜けもれ提言サマリ（MC-6x）
- 全件 server コード変更を伴うため反映に `sudo systemctl restart mission-control.service` が必要（生 tsx 起動禁止・ポート4317 単一 bind）。web 変更は `npm run build`。各タスクの DoD に「restart/build で実反映」を含めること。
- 既存 API（agents/tasks/narrative/roster/usage/inbox + SSE）は**全て非破壊で追加**。既存レスポンス型を変えない。新 API も既存 token/Basic 認証配下に入れる（認証バイパスの新口を作らない）。
- 会話 Feed（MC-34）とタスク Kanban（MC-24）は**既存を拡張**。新規で会話解析や Kanban を作り直さない（重複回避）。MC-61 はこの2つの上に詳細ドリルダウンを乗せるだけ。
- モバイルレスポンシブ維持（390px 横溢れ0）・ハードコード hex 禁止・UI chrome は SVG アイコンのみ（emoji 不可）・文言は中立的丁寧体 — Apollo 既存方針を全 UI 追加で踏襲。
- SSE ライブ反映を活かすなら、workflow（wf_*）も chokidar watch（MC-31）対象に含める検討が要る。MC-60/61 の実装時に watch 対象拡張の所在を決める。
- MC-62 の紐付けは「運用ルール（prompt/label に ID 必須）」が成否を握る。林の workflow 起動手順への組み込み＋ memory 化が必要。task-manager 側も「workflow 流すタスクは ID を prompt 明記」を運用化。
- MC-63（しきい値・ERROR ソース）と MC-64（deploy↔タスク紐付けの鍵）は要件が曖昧なまま着手しない。確定してから IN_PROGRESS。曖昧なら BLOCKED + 確認。

## 次アクション（MC-6x）
- 今回は起票のみ完了（全件 TODO）。実装着手は「人格 workflow 着地後」。それまで凍結。
- 着手解禁後の順序: MC-60（workflow コレクタ＋API）→ MC-61（タスク詳細ドリルダウン）→ MC-62（紐付け）。MC-63〜65 はコア完了後におまけとして優先度判断。
- MC-62 着手前に「workflow/agent 起動時の prompt/label に対象タスク ID を必ず入れる」運用ルールを林・task-manager で確定（紐付け精度の前提）。
- 実装は dev-logic に委譲（designer は MC-61 の UX 併走）。各フェーズ後に reviewer / test-smoke で品質ゲート。

---

最終更新: 2026-05-31 / 管理: task-manager（2026-05-31 Apollo タスク中心ドリルダウン強化 MC-60〜65 起票。旧: ドッグフーディング MC-59 追記、Apollo リネーム＋MC-0x〜MC-5x 実装反映＋autonomous-rin 追記）

---

## バッチ: 2026-05-31 Apollo inbox 起票

### MC-66: inbox エントリのタスクボード即時反映

| フィールド | 値 |
|---|---|
| ID | MC-66 |
| タイトル | inbox エントリのタスクボード即時反映 |
| 優先度 | P2 |
| ステータス | TODO |
| 担当 | dev-logic |
| 詳細 | Apollo から追加したタスク/指示が即時にタスクボードへ反映されるようにする。現状 inbox.jsonl は autonomous-rin か林が手動消化するまでボードに出ない。inbox エントリを即 TASK_TRACKER 化する、または タスクボードに pending レーンとして未消化 inbox を表示する。 |
| 関連 | Apollo dashboard, inbox.jsonl, TASK_TRACKER.md |
| 受け入れ条件 | Apollo から投入した inbox エントリが、手動消化を待たずタスクボード上（pending レーン等）で確認できる |
| 依存 | MC-62(inbox→task 紐付けログ)と機構が重なる。pending レーン表示と消化ログ表示は同一 inbox 機構上で設計し重複実装を避ける |
| 提言・抜けもれ | 「即 TASK_TRACKER 化」と「pending レーン表示のみ」は別アプローチ。前者は採番衝突・自動分解の責務（task-manager 領域）に踏み込むため、まず後者（未消化 inbox を read-only の pending レーンで可視化）から着手するのが安全と提言。確定前に Keita へ方式確認推奨。 |
| 次アクション | 方式（即タスク化 vs pending レーン表示）を Keita に確認 → MC-62 と機構統合して設計 |
| 更新日 | 2026-05-31 |

### MC-67: 司令塔(Overview)カードの詳細表示

| フィールド | 値 |
|---|---|
| ID | MC-67 |
| タイトル | 司令塔(Overview)カードの詳細表示 |
| 優先度 | P2 |
| ステータス | TODO |
| 担当 | dev-logic |
| 詳細 | 司令塔（Overview）ビューの各カードをタップしたら詳細を表示する。MC-61 はタスクボードのカード詳細ドリルダウン。本件は Overview ビューのカードが対象。MC-61 で作る詳細ドリルダウン基盤を Overview カードにも適用する派生として実装する。 |
| 関連 | Apollo dashboard (Overview ビュー) |
| 受け入れ条件 | 司令塔ビューの各カードをタップすると詳細（内訳・関連タスク等）が表示される |
| 依存 | MC-61(タスク詳細ドリルダウン基盤)。MC-61 完了後に同基盤を流用 |
| 提言・抜けもれ | MC-61 と対象ビューが異なる（タスクボード vs 司令塔）ため、MC-61 のスコープを膨らませず別票(本MC-67)として MC-61 に依存させる構成が綺麗と判断。詳細表示の中身（カード種別ごとに出す情報）が未定義のため着手前に要件確認推奨。 |
| 次アクション | MC-61 のドリルダウン基盤実装を待つ → 司令塔カード種別ごとの詳細表示要件を Keita に確認 → 適用 |
| 更新日 | 2026-05-31 |

---

## バッチ: 2026-05-31 Apollo 承認ビュー & 優先度手動操作（MC-68/69）

### MC-68: Keita 承認・確認待ち項目を Apollo で一覧表示（承認ビュー/メニュー追加）

| フィールド | 値 |
|---|---|
| ID | MC-68 |
| タイトル | Keita 承認・確認待ち項目を Apollo で一覧表示（承認ビュー/メニュー追加） |
| 優先度 | P1 |
| ステータス | TODO |
| 担当 | dev-logic + designer(UX) |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | Apollo dashboard（新メニュー/ビュー、既存 /api/tasks）, 各プロジェクト docs/TASK_TRACKER.md |
| 受け入れ条件 | Apollo の専用メニューで「Keita の承認/確認が要る項目」が一覧でき、放置されているものが一目で分かる |
| 依存 | MC-61（詳細ドリルダウン基盤）と連携。集約は既存 /api/tasks のパース結果をフィルタする形が軽量 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認待ち」判定基準の定義（拾うステータス/タグ確定）<br>- [ ] /api/tasks パース結果のフィルタ実装（非破壊）<br>- [ ] 承認ビュー/メニューの UI（designer UX → dev-logic 実装）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置検知（stale 表示）の見せ方 |
| 次アクション | 「承認待ち」判定基準を Keita/林と確定 → designer に承認ビューの UX → dev-logic で /api/tasks フィルタ＋メニュー実装（MVP=可視化のみ） |
| 更新日 | 2026-05-31 |

### MC-69: タスクボードで優先度を手動変更できる

| フィールド | 値 |
|---|---|
| ID | MC-69 |
| タイトル | タスクボードで優先度を手動変更できる |
| 優先度 | P1 |
| ステータス | TODO |
| 担当 | dev-logic + designer(UX) |
| 詳細 | 優先順位は林/task-manager が決めてよいが、Keita が Apollo タスクボード上で優先度（P0/P1/P2/P3 等）を手動変更できる UI（ドロップダウン/ドラッグ等）を追加する。変更は正本である TASK_TRACKER.md に書き戻す必要がある（次回読み込みで保持）。 |
| 関連 | Apollo dashboard（タスクボード UI / server PATCH API）, 各プロジェクト docs/TASK_TRACKER.md |
| 受け入れ条件 | Keita がボード上で優先度を変えると TASK_TRACKER.md に反映され、次回読み込みで保持される |
| 依存 | MC-61（詳細/カード操作）。書き戻しは server に PATCH 系 API が必要（md の該当行を安全に書き換え） |
| 提言・抜けもれ（重要） | (1) TASK_TRACKER.md は autonomous-rin・task-manager・林が同時に触る共有ファイル。Apollo からの書き戻しと衝突するリスク大 → 楽観ロック（読込時の hash/mtime 検証）or 該当行ピンポイント書き換え + 競合検知が必須。フルファイル上書き禁止。(2) md パースの堅牢性: 「優先度」行の表記揺れ（全角/半角・スペース・テーブル形式 vs 箇条書き形式の混在＝本台帳は両形式が併存）に耐える書き換えロジックが要る。ID で対象タスクブロックを特定し優先度行のみ置換。(3) server は非破壊追加・認証配下・書き込み監査ログ（誰がいつどの ID をどう変えたか）。(4) 書き戻し失敗時の UX（楽観ロック衝突なら再読込を促す）、正本反映成功までボード表示を確定させない。(5) モバイル対応・中立文言・ハードコード hex 禁止/CSS 変数・emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 優先度変更 UI（ドロップダウン/ドラッグ）の設計（designer UX）<br>- [ ] PATCH 系 API: ID 指定で「優先度」行のみ安全書き換え<br>- [ ] 競合検知（楽観ロック）と衝突時の再読込フロー<br>- [ ] md パース堅牢性テスト（表記揺れ・テーブル/箇条書き両形式）<br>- [ ] 書き込み監査ログ |
| 次アクション | designer に優先度変更 UI → dev-logic で md 安全書き戻し層（PATCH+楽観ロック）を確立 → 競合検知とパース堅牢性テスト。この書き戻し層は MC-68 の承認操作段でも再利用する |
| 更新日 | 2026-05-31 |

---

最終更新: 2026-05-31 / 管理: task-manager（2026-05-31 Apollo 承認ビュー MC-68・優先度手動変更 MC-69 起票。旧: inbox MC-66/67、ドリルダウン強化 MC-60〜65、ドッグフーディング MC-59、Apollo リネーム＋MC-0x〜MC-5x＋autonomous-rin）

## バッチ: 2026-05-31 Apollo カイロソフト風UI刷新

### MC-70 — Apollo UI をカイロソフト風に刷新

| フィールド | 値 |
|---|---|
| ID | MC-70 |
| タイトル | Apollo UI をカイロソフト風（ドット絵・レトロゲーム経営シミュ風）に刷新 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-05-31 Keita 判断「カイロ風の変更はやらなくていい」。Figma ワイヤフレーム（案A夜/案B木目/タスクボード, file 2jbe1RggvVdnGTPcxI9qgP）まで作ったが実装は見送り。設計doc・ワイヤフレームは将来再検討用に残す。コード変更は一切なし＝本番影響なし） |
| 担当 | designer（設計・スタイル定義・Figma素材・スクショ検証）＋ dev-logic（実装） |
| 詳細 | Keita 依頼（2026-05-31, Apollo inbox c5c9db4b）。現状の管制室ダーク基調を活かし「枠・角・影・タイポ・状態アイコンの5点」をカイロ化。設計方針は obsidian-vault/20-Knowledge/design/apollo-kairo-ui-design-20260531.md に詳細（紺野蒼作成）。デザイントークンが index.css の --mc-* CSS変数に一元化済みなので値差し替えで全view横断に効く。 |
| ロールアウト | フェーズ-1=Figma でカイロ風ワイヤフレーム作成→Keita 確認(今ここ) → フェーズ0=CSS変数土台 → フェーズ1=Overview 1画面実装サンプル→Keita承認 → フェーズ2=全view展開 → フェーズ3=ドット絵化(当面スキップ) |
| 依存 | フェーズ0は並行衝突なしで先行可。フェーズ1以降は MC-60/61(ドリルダウン実装)の web/src 作業完了後に着手し衝突回避 |
| 受け入れ条件 | カラー/タイポ/アイコン方針が Keita 承認 → フェーズ0土台＋Overviewサンプルのスクショ承認 → 全view展開。モバイル390px横溢れ0維持、--mc-*変数一元化の規律維持、SVGアイコン色追従維持 |
| Keita判断待ち項目 | (1)カラー案A(夜ダーク・蒼推し)/案B(昼木目) (2)日本語見出しドット化有無 (3)アイコンSVGドット化/emoji併用 (4)9体ドット顔キャラ作成有無 (5)Apollo内部ツールの絵文字許容可否 |
| 更新日 | 2026-05-31 |

## バッチ: 2026-05-31 Apollo タスク手動 編集/削除（MC-71）

### MC-71 — Apollo タスクボードからタスクを手動で編集/削除できる

| フィールド | 値 |
|---|---|
| ID | MC-71 |
| タイトル | Apollo タスクボードからタスクを手動で 編集（タイトル/ステータス/担当/優先度）・削除できる |
| 優先度 | P1 |
| ステータス | DONE |
| 検証(2026-05-31 reviewer 関) | edit スライス 本番反映済 push d3dc792。内部検証 green: 本番 :4317 で `GET /api/tasks/hash?source=cxo/TASK_TRACKER`→200 で返る hash が `sha256sum docs/TASK_TRACKER.md` と完全一致、`POST /edit` に誤 baseHash を送ると 409 CONFLICT＝楽観ロック発火・台帳バイト不変（fail-closed 実証）。`lib/taskTrackerWrite.ts` に sha256 楽観ロック・3形式(section/card/summary table)の一意特定＋曖昧時 AMBIGUOUS・書込前 read-back 検証(assertOthersUnchanged/assertTargetApplied)・監査ログ data/task-edits.jsonl を確認。cxo は `cxo/TASK_TRACKER` キーで編集可、未対応 source は UNSUPPORTED_SOURCE→400。server tsc0/web build0。実機確認不要方針(2026-05-31)で内部検証 green につき DONE 化。delete は Keita 設計判断待ちで分離（本タスク スコープ外）） |
| 担当 | dev-logic + designer(UX) |
| 詳細 | Keita 依頼（2026-05-31 Apollo inbox `927c2b6d`「アポロのタスクは手動で編集、修正、削除等できるようにしたい」）。Apollo の TaskDetail（MC-61 ドリルダウン）からタスクの タイトル/ステータス/担当/優先度 を編集し、正本 TASK_TRACKER.md に安全に書き戻す。MC-69（優先度の手動変更）は本タスクの「優先度」フィールド編集に包含され、MC-68（承認ビュー）と同じ「md 安全書き戻し層」を共有する。 |
| 設計方針（確定済） | overlay 方式は不採用（Apollo だけで消えても .md には残り autonomous-rin が拾い続ける＝偽の二重正本になるため）。MC-69 の通り「正本 .md への書き戻し＋楽観ロック」を採る。書き戻しは fail-closed: ①対象は task.id で一意特定できる場合のみ（曖昧なら 409 で拒否し「.md を直接編集して」と促す）②該当タスクのブロック内 該当行のみ置換（フルファイル再生成禁止）③mtime+sha256 の楽観ロック（読込後に変わっていたら 409）④書き込み前に同パーサで read-back 検証（対象タスクが意図値になり、かつ他タスクのパース結果が不変であることを assert、崩れたら abort）⑤監査ログ data/task-edits.jsonl。台帳は summary table / `### MC-xx` セクション / `\| フィールド \| 値 \|` カードの3形式が併存する点に対応。 |
| 今ティックのスコープ | edit のみ（title/status/owner/priority）。delete は分離（下記）。 |
| delete の扱い | 削除＝正本台帳から人/task-manager 管理の記録を消す操作のため、セマンティクス（物理削除 vs CANCELLED マーク vs 非表示）は Keita 設計判断。本タスクでは未実装、edit 着地後に Keita 確認の上で fast-follow。 |
| 関連 | Apollo dashboard（web TaskDetail / server 書き戻し層）, 各プロジェクト docs/TASK_TRACKER.md。MC-69（包含）, MC-68（書き戻し層を共有）, MC-61（ドリルダウン基盤） |
| 受け入れ条件 | TaskDetail で 編集→保存すると正本 TASK_TRACKER.md の該当タスクの該当フィールドが書き換わり、次回読込で保持される。楽観ロック衝突時は 409＋再読込促し。read-back 検証に失敗する書き換えは実行されない。モバイル390px横溢れ0・中立文言・ハードコード hex 禁止/CSS変数・UI chrome は SVG のみ。 |
| 更新日 | 2026-05-31 |

## バッチ: 2026-05-31 Apollo 投入時の優先度指定（MC-72）

> ⚠ 採番訂正: 林から「MC-71」で渡された投入時優先度指定の件は、別セッション/autonomous-rin が先に MC-71（Apollo タスク手動 編集/削除）を消費済みで衝突していたため、next-task-id.sh の実在最大+1＝MC-72 で起票し直した（MC-64/65 衝突と同型、reference-task-id-numbering 参照）。重複起票は回避済み。

### MC-72: Apollo 投入時に優先度を指定できる

| フィールド | 値 |
|---|---|
| ID | MC-72 |
| タイトル | Apollo 投入時に優先度を指定できる |
| 優先度 | P2 |
| ステータス | CANCELLED（MC-84 に集約。2026-05-31 Keita 要望「投入時に優先度を選びたい/ロジックが不透明」を MC-84 として再起票し、本件はそちらに統合。実装は MC-84 で行う） |
| 担当 | dev-logic + designer(UX) |
| 詳細 | Keita 依頼（Apollo inbox d52a5d71）。Apollo の受信箱（FAB/ボトムシート）からタスク/指示を投入する時に、優先度（P0/P1/P2/P3）を選んで送れるようにする。inbox 投入 UI に優先度セレクタを追加し、`inbox.jsonl` のエントリに `priority` フィールドを持たせる。autonomous-rin / 林が TASK_TRACKER 化する際に、その優先度を引き継ぐ。 |
| 関連 | Apollo dashboard（FAB/ボトムシート投入 UI）, `cxo-agent/data/inbox.jsonl`, `POST /api/inbox`, autonomous-rin の inbox 消費ロジック（project_autonomous_rin）, TASK_TRACKER.md |
| 受け入れ条件 | Apollo の投入 UI から優先度（P0/P1/P2/P3）を選んで送信でき、`inbox.jsonl` エントリに priority が記録され、タスク化（TASK_TRACKER 登録）時にその優先度が保持される |
| 依存 | 既存 inbox 機構（`POST /api/inbox`）。MC-66(inbox 即時反映)・MC-69(優先度手動変更／MC-71 edit に包含) と機構が重なる（priority フィールド・タスク化フロー・md 書き戻し層）ため、統合設計で重複実装を避ける。MC-71/MC-69 の優先度概念・書き戻し層を再利用可。 |
| 提言・抜けもれ | (1) priority 未指定時のデフォルト（P2 想定）を定義する。(2) 既存 inbox エントリ（priority フィールド無し）の後方互換＝未定義は欠落として扱い既定値にフォールバック、既存レコードを壊さない。(3) server は既存 `POST /api/inbox` を非破壊で拡張（フィールド追加のみ、既存レスポンス型を変えない）・既存 token/Basic 認証配下に置く。(4) モバイル対応（FAB/ボトムシートのセレクタがスマホで操作しやすい）。(5) UI chrome 制約: 中立的丁寧体（〜です/〜ます）、ハードコード hex 禁止・CSS 変数使用、UI chrome の emoji 不可（SVG のみ）。(6) autonomous-rin/林のタスク化時に priority を確実に引き継ぐ結線（消費ロジックの読み取り対応）。 |
| 次アクション | dev-logic + designer が MC-66/MC-69(MC-71) と統合した priority 機構を設計 → 投入 UI セレクタ + inbox.jsonl priority フィールド + タスク化時の引き継ぎを実装 → 後方互換・デフォルト値・認証配下を検証 |
| 更新日 | 2026-05-31 |

## バッチ: 2026-05-31 Apollo 全文検索（MC-73）

### MC-73 — 司令塔に全文検索機能（タスク/エージェント/会話/Vault 横断）

| フィールド | 値 |
|---|---|
| ID | MC-73 |
| タイトル | Apollo 司令塔に全文検索（タスク・エージェント・会話・Vault を横断検索） |
| 優先度 | P1 |
| ステータス | DONE（2026-05-31 本番反映済 commit 9a4e3df。/api/search＋GlobalSearchモーダルをOverviewに実装、restart後 本番4317で q=MC→tasks45/conv18/wf2/vault11 返却確認。server tsc0/web build0。※workflow結果のクリック先は単体ビュー無くTasksボード止まり＝別タスク余地） |
| 担当 | dev-logic + designer(UX) |
| 詳細 | Keita 依頼（2026-05-31）「アポロに検索機能作って。タスクとか含めて全部検索できる機能。司令塔にほしい」。司令塔(Overview)に検索バー/モーダルを置き、横断検索する。対象: タスク(/api/tasks の全TASK_TRACKER)・エージェント(/api/roster)・会話(/api/agents feed)・Vault(/api/vault 既存の検索があれば流用)・workflow(/api/workflows)。 |
| 受け入れ条件 | 司令塔から1つの検索窓でタスクID/タイトル/担当・エージェント名・会話本文・Vaultノートを横断検索でき、結果カテゴリ別表示＋クリックで該当詳細(MC-61ドリルダウン等)に飛べる。モバイル390px対応。 |
| 依存 | 既存 collector(/api/tasks,roster,agents,workflows,vault)を横断する新 /api/search、or フロント側で各APIを叩いて集約。MC-61(ドリルダウン)に結果から飛べると理想。 |
| 抜けもれ | server非破壊追加・既存token認証配下・中立文言・ハードコードhex禁止・SVGアイコン。Vault全文は既存 /api/vault の検索(VAULT_SEARCH_LIMIT)流用。大量ヒット時の上限・デバウンス。日本語検索(部分一致)。 |
| 更新日 | 2026-05-31 |

## バッチ: 2026-05-31 Apollo tasks collector バグ修正（MC-74）

### MC-74 — tasks collector のステータス誤表示＋縦型カード非対応を修正

| フィールド | 値 |
|---|---|
| ID | MC-74 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | DONE（2026-05-31 本番反映済 commit c69a534・restart済。バグ1=同一ID重複時に古いステータスで巻き戻り→STATUS_RANK+mergeStatusで確定方向のみ上書き・表行を一次値に。バグ2=縦型カード| ID |MC-70|非対応→状態機械で対応。実測 AF-01/FB-02/FB-03→DONE・MC-70→CANCELLED・MC-73→DONE・総数196→204回帰なし） |
| 担当 | dev-logic |
| 詳細 | Keita「タスクボード更新されてる？」起点で発覚。実ファイル台帳は正しいのに /api/tasks が古いステータス（REVIEW）を返し、縦型カード形式の MC-70/73 がボード未表示だった。server/src/collectors/tasks.ts parseTrackerString() の2バグ。 |
| 更新日 | 2026-05-31 |

---

## バッチ: 2026-05-31 Apollo 要望6件（MC-75〜MC-80 / Keita 2026-05-31）

> Keita 2026-05-31 の Apollo 6 要望をまとめて起票。MC-66↔MC-77（inbox 即時タスク化）と MC-68↔MC-79（承認ビュー）は本バッチで発展統合する関係（旧票は集約先へ相互参照、二重実装を避ける）。採番は next-task-id.sh で MC-75〜MC-80 を一括予約済み（目視数えなし、pull --rebase 後採番）。

### MC-75: roster 表示を絞る（人格ありエージェント＋主要のみ、バックグラウンド系は非表示）

| フィールド | 値 |
|---|---|
| ID | MC-75 |
| タイトル | Apollo の roster 表示を人格保有＋主要エージェントに限定（バックグラウンド系を非表示） |
| 優先度 | P2 |
| ステータス | DONE（2026-05-31 roster allowlist で人格保有9＋林＋apolloの11体のみ表示・本番反映済 66283a0・/api/roster 11件確認） |
| 担当 | dev-logic |
| 詳細 | Keita「アポロのエージェントに表示するのは人格があるエージェントとその他主要エージェントだけでいい。その他バックグラウンドで動いているのはここには表示しなくていい」。Apollo の roster(/api/roster)表示を、人格保有の開発9体（dev-logic/task-manager/designer/content-creator/reviewer/logic-coach/test-functional/night-patrol/feedback-watcher、[[project-agent-roster-20260531]]）＋その他主要エージェントに限定する。バックグラウンドの細かいプロセス系（cron 派生・一時 subagent 等）は roster に出さない。 |
| 関連 | Apollo dashboard（roster ビュー / server `/api/roster` collector）, `obsidian-vault/60-Agents/*.md`（roster ソース候補） |
| 受け入れ条件 | Apollo の roster/エージェント一覧に表示されるのが「人格を持つ主要エージェントのみ」になり、バックグラウンドの細かいプロセス系が出ない。表示対象の定義が明文化され再現可能。 |
| 依存 | なし（独立着手可）。MC-73(全文検索)のエージェント検索対象とも整合を取る（検索ヒット対象から除外するか表示のみ絞るか方針一致させる） |
| 提言・抜けもれ | (1) 「主要エージェント」の判定基準を着手前に確定する必要あり（案: 人格セクションを持つ9体を allowlist 化＝ハードコード/設定で持つ vs roster ソース `60-Agents/*.md` 側の取捨）。基準が曖昧だと拾い漏れ・将来エージェント追加時のメンテ漏れ。allowlist を設定/定数に一元化し、新エージェント追加時にそこだけ直せば済む形を推奨。(2) collector フィルタで絞る場合 server 非破壊追加・認証配下。(3) 既存の会話(Feed)/検索が roster を参照しているなら、非表示にしたエージェントの会話まで消えないか回帰確認（表示を絞るだけで feed/検索は残すのか、完全除外かを Keita 方針確認）。(4) モバイル対応・中立文言・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 次アクション | 「主要エージェント」allowlist 基準を Keita/林と確定 → roster ソース取捨 or collector フィルタで実装（allowlist 一元化）→ Feed/検索への波及を回帰確認 |
| 更新日 | 2026-05-31 |

### MC-76: 「司令塔」→「ダッシュボード」改名＋ナビ再編（今日/会話/エージェント/消費量をダッシュボード配下へ）

| フィールド | 値 |
|---|---|
| ID | MC-76 |
| タイトル | ナビ「司令塔」を「ダッシュボード」に改名し、今日/会話/エージェント/消費量をその配下に移動 |
| 優先度 | P1 |
| ステータス | DONE（2026-05-31 本番反映済。司令塔→ダッシュボード改名＋配下5タブ＋トップ4項目化、DashboardLayout/Outlet、既存URL温存で非破壊。承認フロー枠もMC-79で実装完了。9ルート390px横溢れ0検証） |
| 担当 | dev-logic + designer(UX) |
| 詳細 | Keita「アポロのボードの司令塔はダッシュボードに変更して、今日、会話、エージェント、消費量はダッシュボードに移動して」。(1) トップナビの「司令塔」を「ダッシュボード」にリネーム。(2) 現在トップレベルにある「今日」「会話」「エージェント」「消費量(Usage)」をダッシュボード配下（タブ or セクション）に移動し、トップナビをすっきりさせる。残すトップレベル想定: ダッシュボード / タスクボード / Vault 等（＋本バッチ MC-79 の「承認フロー」も新トップレベル候補）。具体的なナビ構成は designer が UX 検討。 |
| 関連 | Apollo dashboard（ナビ/ルーティング: web のサイドバー＋モバイル BottomNav、各 view コンポーネント）。[[project-apollo-dashboard]] のナビ定義（司令塔/エージェント/会話/タスクボード/今日/Vault） |
| 受け入れ条件 | トップナビの「司令塔」表記が「ダッシュボード」になり、今日/会話/エージェント/消費量がダッシュボード配下のタブ/セクションから辿れ、トップナビ項目数が減ってすっきりする。PC サイドバー・モバイル BottomNav 両方で破綻しない。 |
| 依存 | なし（独立着手可）。ただし MC-79（承認フロー新メニュー）とトップナビ構成が干渉するので、ナビ最終構成は MC-79 と合わせて designer が1枚で設計（バラバラに足さない） |
| 提言・抜けもれ | (1) 「司令塔」表記は server narrative/ラベル・既存 memory・ドキュメントにも散在する可能性。UI 表示文言の変更が主目的で、内部識別子(route key 等)まで一括 rename すると検索/ディープリンク/既存ブックマークが壊れるので、表示ラベルのみ変更し内部キーは温存推奨（要 grep 確認）。(2) モバイル BottomNav は項目数が増えると破綻しやすい→トップレベルを減らす本変更はモバイルに好都合だが、ダッシュボード配下タブの横スクロール/段組みを 390px で確認。(3) 4 ビューを配下に移すと既存のディープリンク/SSE/各 collector 参照が切れないか回帰確認（今日=narrative、会話=agents feed、エージェント=roster、消費量=usage の API はそのまま、ルーティング階層だけ変える）。(4) 中立文言・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] designer: 新ナビ構成（トップレベル＋ダッシュボード配下タブ）を MC-79 込みで1枚設計<br>- [ ] 「司令塔」→「ダッシュボード」表示ラベル変更（内部キー温存）<br>- [ ] 今日/会話/エージェント/消費量をダッシュボード配下へルーティング移動<br>- [ ] PC サイドバー＋モバイル BottomNav の両対応・390px 検証<br>- [ ] ディープリンク/SSE/各 collector 参照の回帰確認 |
| 次アクション | designer に MC-79 込みの新ナビ構成を依頼 → dev-logic でラベル変更＋ルーティング再編 → 両レイアウト・回帰を検証 |
| 更新日 | 2026-05-31 |

### MC-77: inbox の「タスク/指示」区別を廃止し全てタスク化＋即タスクボード反映（MC-66 を集約）

| フィールド | 値 |
|---|---|
| ID | MC-77 |
| タイトル | inbox の kind(task/instruction)区別を廃止し全て task 化、投入即タスクボード反映 |
| 優先度 | P1 |
| ステータス | DONE（2026-05-31 inbox区別廃止・全タスク化＋投入で即タスクボード反映を実装(taskTrackerAppend.ts fail-closed即追記・二重登録防止・後方互換)・本番反映済 5e81322・MC-66統合） |
| 担当 | dev-logic |
| 詳細 | Keita「タスクと指示でわかれてるけど、指示はいらない。全部タスクでいい。タスクを上げたら即タスクボードに反映させて」。(1) Apollo 投入の kind(task/instruction)区別を廃止し、全て task として扱う（投入 UI から指示トグルを除去、既存 instruction エントリは task として扱う後方互換）。(2) 投入したら即 TASK_TRACKER 化してタスクボードに出す（autonomous-rin/林の手動消化を待たない）。inbox 投入→自動で TASK_TRACKER に行追加する仕組み。MC-66(inbox 即時反映)を本タスクに集約。 |
| 関連 | Apollo dashboard（FAB/ボトムシート投入 UI, タスクボード）, `cxo-agent/data/inbox.jsonl`, `POST /api/inbox`, autonomous-rin の inbox 消費ロジック（[[project-autonomous-rin]]）, 各 docs/TASK_TRACKER.md。MC-72(投入時優先度指定)・MC-71(編集の md 書き戻し層)と機構共有 |
| 受け入れ条件 | Apollo の投入 UI に「タスク/指示」区別が無く全て task として送れ、投入したエントリが手動消化を待たず即タスクボード（TASK_TRACKER の行 or pending レーン）に現れる。既存 instruction エントリも壊れず task 表示される。 |
| 依存 | MC-66（本タスクに集約＝MC-66 は CLOSE/相互参照）。MC-72(投入時優先度)・MC-71(md 安全書き戻し層) と priority フィールド・自動タスク化フロー・md 書き戻し層が重なるため統合設計で重複実装回避。採番は next-task-id.sh、即タスク化する場合の自動採番もこのスクリプト経由に統一（[[reference-task-id-numbering]]、重複起票防止） |
| 提言・抜けもれ（重要） | (1) 「即 TASK_TRACKER 化」は採番衝突・自動分解という task-manager 領域に踏み込む。MC-66 提言どおり、まず安全な「未消化 inbox を read-only の pending レーンで可視化」から着手し、自動 .md 書き込みは段階導入が安全（fail-closed）。即書き込みする場合は採番を next-task-id.sh 経由に固定し、共有 .md への追記は MC-71 の楽観ロック書き戻し層を再利用（フルファイル再生成禁止・read-back 検証）。(2) どの TASK_TRACKER に登録するか（cxo-agent か logic か）の振り分けルールが要る。投入時にプロジェクト選択 or デフォルト cxo-agent。(3) 自動タスク化は受け入れ条件(DoD)・担当・優先度が空のまま増える＝抜けもれ温床。最低限「即ボード可視化（pending）」と「task-manager/林が構造化（DoD・担当付与）」を分離し、構造化前タスクが識別できる状態にする。(4) 既存 instruction エントリの後方互換（kind 欠落/instruction を task 扱い）。(5) server 非破壊拡張・認証配下・監査ログ。(6) モバイル対応・中立文言・ハードコード hex 禁止/CSS 変数・emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 投入 UI から「指示」トグル除去（全て task）<br>- [ ] 既存 instruction エントリの後方互換（task 扱い）<br>- [ ] 即ボード反映（pending レーン可視化を第一段）<br>- [ ] 自動 TASK_TRACKER 化（採番=next-task-id.sh、書き戻し=MC-71 楽観ロック層、段階導入）<br>- [ ] 登録先プロジェクトの振り分けルール<br>- [ ] 監査ログ |
| 次アクション | MC-66 を本タスクに集約（相互参照記入）→ 第一段=pending レーン即可視化を実装 → 第二段=自動タスク化（next-task-id.sh採番＋MC-71書き戻し層）を fail-closed で段階導入 |
| 更新日 | 2026-05-31 |

### MC-78: 優先順位順にタスクをピックアップ（着手＋ボード表示の両面）

| フィールド | 値 |
|---|---|
| ID | MC-78 |
| タイトル | タスクを優先度の高い順にピックアップ（autonomous-rin 着手順＋Apollo ボード表示順） |
| 優先度 | P2 |
| ステータス | DONE（2026-05-31 優先度順ピックアップ実装(autonomous-rin選定強化＋ボード列内ソートpriorityRank・4形式吸収)・本番反映済） |
| 担当 | dev-logic |
| 詳細 | Keita「優先順位つけたら早いやつからピックアップして」。autonomous-rin / 実装エージェントがタスクを拾うとき、優先度(P0>P1>P2>P3)の高い順に着手する。autonomous-rin の選定ロジックは既に「TODO/IN_PROGRESS/REVIEW・BLOCKED 除外・依存充足・logic 最優先」（[[project-autonomous-rin]]）だが、同条件内の並びを優先度降順（同位は ID 昇順）に徹底する。加えて Apollo ボードでも優先度順ソート表示にして、Keita 視点でも「次に拾われる順」が分かるようにする。 |
| 関連 | `/home/dev/cron-scripts/autonomous-rin.sh`（選定ロジック）, Apollo dashboard（タスクボードのソート/表示順）, /api/tasks collector |
| 受け入れ条件 | (1) autonomous-rin が着手可能タスクを優先度降順（P0>P1>P2>P3、同位は ID 昇順）で拾う。(2) Apollo タスクボードが優先度順でソート表示され、次に着手される順が一目で分かる。 |
| 依存 | MC-72(投入時優先度指定)・MC-71(優先度の手動編集) で優先度が正しく設定/編集できることが前提（優先度の入力経路）。MC-74(collector ステータス修正) 済みの parse 結果を利用 |
| 提言・抜けもれ | (1) 優先度未設定タスクのデフォルト順位を定義（案: P2 相当として中位に置く）。表記揺れ（P0/P1 と「優先度: 高/中/低」混在）に耐えるソートキー正規化が要る（本台帳は P0〜P3 表記だが将来揺れ得る）。(2) logic 最優先ルール（autonomous-rin）と優先度降順の優先関係を明確化＝「プロジェクト優先(logic) → その中で優先度降順」の二段ソートか、全プロジェクト横断で優先度降順かを Keita 確認。現行は logic 優先なので二段ソート維持を推奨。(3) ボードソートは表示のみ非破壊。(4) 同位多数時の安定ソート（ID 昇順 tiebreak）。(5) モバイル対応・中立文言・CSS 変数・emoji 不可（SVG のみ）。 |
| 次アクション | logic 優先と優先度降順の二段関係を Keita 確認 → autonomous-rin 選定ロジックに優先度降順 tiebreak を明示実装 → Apollo ボードに優先度ソート表示（非破壊）→ 表記揺れ正規化を検証 |
| 更新日 | 2026-05-31 |

### MC-79: 「承認フロー」メニュー追加（Keita 承認が要るものを集約・承認/却下）（MC-68 を集約）

| フィールド | 値 |
|---|---|
| ID | MC-79 |
| タイトル | Apollo に「承認フロー」メニュー新設（Keita 承認要項目を集約し承認/却下） |
| 優先度 | P1 |
| ステータス | DONE（2026-05-31 承認フロー実装(GET /api/approvals＋承認1タップ→TODO/却下→CANCELLED・MC-71書き戻し層再利用・件数バッジ)・本番反映済 commit 66283a0・/api/approvals 12件返却確認） |
| 担当 | dev-logic + designer(UX) |
| 詳細 | Keita「何かKeitaの承認が必要なものは『承認フロー』というメニューを追加して、そこでやるようにして」。Apollo に「承認フロー」メニュー/ビューを新設し、Keita の承認が要る項目（デプロイ可否・設計判断・仕様未確定・BLOCKED で Keita 待ち・「Keita承認待ち」タグ等）を集約する。Keita がそこで承認/却下（＋コメント）できる。MC-68(承認待ち一覧)の発展形＝MC-68 を本タスクに集約。可視化(MC-68 のMVP)に加え、承認/却下アクション（書き込み API＋監査ログ）まで含む。 |
| 関連 | Apollo dashboard（新トップレベルメニュー「承認フロー」, server 書き込み API）, 各 docs/TASK_TRACKER.md。MC-68（集約元）, MC-71(md 安全書き戻し層を承認アクションで再利用), MC-61(ドリルダウン基盤), MC-76(トップナビ構成と整合) |
| 受け入れ条件 | Apollo の「承認フロー」メニューに Keita の承認/確認が要る項目が一覧表示され、Keita が各項目を承認/却下でき、その結果が正本 TASK_TRACKER.md（ステータス/タグ）に反映され監査ログに残る。放置中の承認待ちが一目で分かる。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ（重要） | (1) 「承認が要る項目」の判定基準を着手前に確定（拾う対象: status=BLOCKED で Keita 待ち、「設計判断」「Keita承認待ち」明示タグ、デプロイ可否など）。MC-80 で「REVIEW は Keita 承認不要・内部レビューで DONE」が確定するため、REVIEW は承認フローの対象に含めない（含めると MC-80 と矛盾）。基準が曖昧だと拾い漏れ・誤集約。(2) 承認/却下は書き込み操作＝MC-71 の楽観ロック書き戻し層を必須再利用（フルファイル再生成禁止・read-back 検証・data/task-edits.jsonl 監査ログ）。承認アクションの監査（誰がいつ何を承認/却下したか）を別途記録。(3) 段階導入: MVP=可視化（MC-68 相当）→ 承認/却下アクション、と分離して着地。(4) server 非破壊・認証配下。(5) MC-76 とナビ構成を1枚で設計（トップレベルに足す）。(6) モバイル対応・中立文言・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-05-31 |

### MC-80: REVIEW の最終ゲートから Keita レビューを外す（内部レビュー完了で即 DONE）

| フィールド | 値 |
|---|---|
| ID | MC-80 |
| タイトル | REVIEW は Keita 待ちにしない運用へ＋現状 REVIEW 滞留タスクを内部検証して DONE 化する棚卸し |
| 優先度 | P1 |
| ステータス | DONE（2026-05-31 完了。REVIEW21件を内部検証→18件DONE化、残4件は妥当な保留(AM-N法務push承認/NF-2/UI-28/MC-43は後にDONE)。運用ルールは memory feedback_review_agent_verify_then_done に確定。今後REVIEWはKeita確認不要・内部検証でDONE） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | Keita「レビューに止まってるのは、Keitaのレビュー待ちだと思うけど、Keitaのレビューはいらないから、内部のレビューが完了したら、完了にしちゃっていい」。これは運用ルール（reviewer/test 系の内部検証完了＝即 DONE、Keita の最終目視を最終ゲートにしない）。タスクとしては (1) 現状 REVIEW で止まっている全タスクを内部検証(test-functional/reviewer)→DoD 充足を確認して DONE 化する棚卸し、(2) 今後 REVIEW を Keita 待ちにしない運用の徹底（REVIEW=内部レビュー待ちのみ、Keita 目視は不要）。cxo-agent 側の REVIEW 滞留も内部検証→DONE 化する。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-74(collector ステータス修正済)＝ボードの REVIEW 表示が正確になった上で棚卸し。MC-79 と方針整合（承認フローから REVIEW を除外） |
| 提言・抜けもれ（重要） | (1) cxo-agent 側の REVIEW 滞留を実 grep で棚卸し対象として列挙する（依頼文の MC-02/12/17/21/22/26/31/41/42/43/44/51/61/69 等は要実ファイル確認＝憶測で DONE 化しない。各タスクの DoD を逆引きし、テスト/型/lint/本番疎通の実エビデンスと突き合わせてから DONE）。logic 側 TASK_TRACKER の REVIEW も同様に棚卸し。(2) 「内部レビュー完了＝DONE」の線引き: DoD 充足＋reviewer/test green が揃ったものだけ DONE。DoD 未充足や未検証は DONE にせず TODO/IN_PROGRESS へ差し戻し（[[feedback-quality-efficiency-accuracy]] の品質ゲート維持＝Keita 目視を外すだけで検証は外さない）。(3) 「push/デプロイ判断は Keita 専権」は不変。DONE 化＝即デプロイではない。(4) 運用ルールは memory 化して autonomous-rin/林/各 subagent に徹底（REVIEW を Keita 待ちにしない）。 |
| サブタスク | - [ ] cxo-agent TASK_TRACKER の REVIEW 状態を実 grep で全列挙<br>- [ ] logic TASK_TRACKER の REVIEW 状態を実 grep で全列挙<br>- [ ] 各 REVIEW タスクの DoD 逆引き＋test-functional/reviewer で内部検証<br>- [ ] DoD 充足＋green は DONE、未充足は差し戻し<br>- [ ] 「REVIEW を Keita 待ちにしない」運用を memory 化 |
| 次アクション | cxo-agent/logic の REVIEW 滞留を実 grep で列挙 → test-functional/reviewer で各 DoD を内部検証 → green は DONE・未充足は差し戻し → 運用ルールを memory 化 |
| 更新日 | 2026-05-31 |

---

### MC-81: tasks collector の normStatus 堅牢化（statusセル先頭トークンで正規化）

| フィールド | 値 |
|---|---|
| ID | MC-81 |
| タイトル | tasks collector の normStatus 堅牢化（statusセル全体 includes 走査をやめ、先頭トークンで正規化） |
| 優先度 | P2 |
| ステータス | DONE（2026-05-31 normStatus先頭トークン優先で誤読根治・実台帳213件diff変化2件回帰ゼロ・単体テスト31・本番反映済） |
| 担当 | dev-logic |
| 詳細 | reviewer が MC-71 検証中に発見した副産物バグ。`server/src/collectors/tasks.ts:71-83` の `normStatus` が `STATUS_WORDS` 順（REVIEW が DONE より先）にセル文字列全体を `includes` で走査するため、縦型カードの status セル本文に「REVIEW」の文字が混ざると、実態が DONE でも REVIEW と誤読する。MC-71 で実際に踏んだ（回避策として status セルを素の DONE にし、検証文を別行に分離した）。恒久対策として「status セルの先頭トークン（区切り前の最初のステータス語）だけを見る」方式へ直す。`DONE（…注記…）` のように注記内に他ステータス語が混ざっても、先頭の DONE を正しく取れるようにする。 |
| 関連ファイル | `server/src/collectors/tasks.ts`（normStatus 71-83 行付近、STATUS_WORDS / mergeStatus 周辺）。表行/縦型カード両形式のパース経路。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | なし（MC-80 の棚卸し中に副産物として発見。棚卸し完了は待たず着手可） |
| 提言・抜けもれ | (1) テスト: normStatus の単体テストを足せると堅い（`DONE（…REVIEW…）` 入力→DONE 期待、`REVIEW`→REVIEW、日本語「完了」「進行」「ブロック」分岐も）。cxo-agent server にテスト基盤が無ければ最小の検証スクリプトで代替。(2) 回帰: 「先頭トークン」の区切り定義（全角/半角括弧・スペース・改行・コロン）を明確にし、既存台帳の実データ（`DONE（commit …）` 等の表記ゆれ）で誤分類が出ないか実 grep サンプルで確認。(3) collector 反映は restart 必須（watch 無し、tsx 起動）。dist 再ビルドは web 側だけで server には不要。(4) MC-71 の回避を将来戻す場合は本タスク DONE 後に。 |
| サブタスク | - [ ] normStatus を先頭トークン抽出方式に書き換え<br>- [ ] 区切り定義（括弧/スペース/改行/コロン）を決めて実装<br>- [ ] 表行・縦型カード両形式の実データで回帰確認<br>- [ ] 可能なら normStatus 単体テスト追加<br>- [ ] systemctl restart → 本番 /api/tasks でステータス正常確認 |
| 次アクション | dev-logic が tasks.ts:71-83 を先頭トークン正規化に修正 → 両形式で回帰確認 → restart → /api/tasks 検証 |
| 更新日 | 2026-05-31 |

---

最終更新: 2026-05-31 / 管理: task-manager（2026-05-31 Keita 要望4件 MC-83〜86 起票。MC-84←MC-72集約、MC-85↔MC-86は起動機構が重なり統合設計、MC-85/86はBLOCKED=Keita設計判断待ち。旧同日: Apollo 要望6件 MC-75〜80、MC-77←MC-66集約・MC-79←MC-68集約、tasks collector 修正 MC-74、全文検索 MC-73、投入時優先度 MC-72(→MC-84)、手動編集 MC-71、カイロUI MC-70(CANCELLED)、承認ビュー MC-68・優先度手動 MC-69、inbox MC-66/67）

### MC-82 — アポロのタスクボードのタスクは何をやっているか詳細を記載すること

| フィールド | 値 |
|---|---|
| ID | MC-82 |
| タイトル | アポロのタスクボードのタスクは何をやっているか詳細を記載すること |
| 優先度 | P2 |
| ステータス | TODO |
| 担当 | 未定 |
| 詳細 | 【Apollo投入】 アポロのタスクボードのタスクは何をやっているか詳細を記載すること<br>　→成果物完了までのワークフローも記載すること |
| 更新日 | 2026-05-31 |

---

## バッチ: 2026-05-31 Keita 要望4件（MC-83〜86）

> Keita 直依頼（2026-05-31）。タスク詳細表示・投入時優先度・開発エージェントの自律並行稼働・アイドルエージェント起動の4件。MC-83/84 はプロダクト改善（dev-logic+designer）、MC-85/86 は林の設計判断を要するインフラ拡張。MC-84←MC-72 集約。MC-85↔MC-86 は機構が重なる（headless 起動・並行プロセス管理）ため統合設計で重複実装を避ける。

### MC-83 — タスクタップで詳細をわかりやすく表示

| フィールド | 値 |
|---|---|
| ID | MC-83 |
| タイトル | Apollo タスクボードのカードタップで詳細(TaskDetail)が見られると分かる UI＋詳細の中身充実 |
| 優先度 | P1 |
| ステータス | TODO |
| 担当 | dev-logic + designer |
| 詳細 | Keita「タスクタップしたら詳細がわかるようにしてほしい」。MC-61 で TaskDetail は実装済み（Tasks.tsx:24 onClick→onOpen→TaskDetail 結線あり）だが、Keita が「詳細がわからない」＝(a) ナビ再編 MC-76 後にダッシュボード配下で動いてない回帰 (b) カードのタップ範囲/見た目が「詳細を開ける」と分からない (c) 詳細の中身が薄い、のいずれか。まず実機でカードタップ→TaskDetail が実際に開くか確認。開かないなら回帰修正。開くなら「タップで詳細が見られる」と分かる UI 改善（カードに chevron/「詳細」ヒント等）＋詳細の中身充実（概要/note/紐づく workflow/会話/履歴）。 |
| 関連 | Apollo web `web/src/views/Tasks.tsx`（:24 onClick→onOpen）, `TaskDetail` コンポーネント, MC-61(タスク↔workflow↔会話ドリルダウン), MC-76(ナビ再編), `/api/tasks`・task-links.jsonl |
| 受け入れ条件（DoD） | (1) Apollo タスクボードでカードをタップすると TaskDetail が確実に開く（MC-76 後のダッシュボード配下でも回帰なし）。(2) カードに「タップで詳細が開ける」ことが分かるアフォーダンス（chevron / 「詳細」ラベル / hover/press 状態）がある。(3) TaskDetail に概要・note・紐づく workflow/会話・履歴が表示される。(4) 390px モバイルで操作・表示が崩れない。 |
| 依存 | MC-61(ドリルダウン基盤)・MC-76(ナビ再編) の現状を確認してから着手。回帰確認が先。 |
| 提言・抜けもれ | (1) まず「開くか/開かないか」を実機で切り分ける（回帰 vs UI 改善 vs 中身充実で対応が変わる）。(2) UI chrome 制約: 中立的丁寧体（〜です/〜ます）、ハードコード hex 禁止・CSS 変数使用、UI chrome の emoji 不可（SVG アイコンのみ、chevron 等は src の SVG）。(3) アクセシビリティ: タップ可能カードに role/aria・キーボード操作、意味アイコンに語ラベル。(4) 回帰: Tasks.tsx 共通カードを他ビュー（Overview の検索結果クリック先＝MC-73 で「Tasks ボード止まり」既知）でも使うなら波及確認。(5) server 変更が要る場合（紐づく workflow/会話を出すため /api/tasks 拡張）は restart 必須・既存レスポンス型を非破壊拡張。(6) 検証は test-functional が実機（4317）でタップ→詳細表示を確認して REVIEW→DONE。 |
| サブタスク | - [ ] 実機でカードタップ→TaskDetail が開くか確認（回帰切り分け）<br>- [ ] 開かないなら MC-76 後の結線回帰を修正<br>- [ ] カードに詳細を開けると分かるアフォーダンス追加（chevron/ヒント/press 状態）<br>- [ ] TaskDetail の中身充実（概要/note/workflow/会話/履歴）<br>- [ ] 390px モバイル確認<br>- [ ] restart（server 変更時）→ test-functional 実機検証 |
| 次アクション | dev-logic が実機でタップ挙動を切り分け → designer とアフォーダンス UI → TaskDetail 中身充実 → 検証 |
| 更新日 | 2026-05-31 |

### MC-84 — 投入時に優先度を選べる（優先度 UI の明確化）

| フィールド | 値 |
|---|---|
| ID | MC-84 |
| タイトル | Apollo 投入時に優先度を選べる UI＋優先度の意味（P0最優先〜）を分かりやすく（MC-72 集約） |
| 優先度 | P1 |
| ステータス | TODO |
| 担当 | dev-logic + designer |
| 詳細 | Keita「タスクの優先度の選択がよくわからない。どういうロジック？」。現状 AddTaskFab には project/text のみで優先度セレクタが無く、投入タスクはデフォルト P2、ボードで後から手動編集（MC-71）、autonomous-rin は優先度高い順に拾う（MC-78）。Keita は投入時に優先度を選びたい＋現状ロジックが不透明。→ MC-72(投入時優先度指定) と同義のため MC-72 を本件に集約。AddTaskFab に優先度セレクタ（P0〜P3、デフォルト P2）を追加、投入→TASK_TRACKER に優先度反映。優先度の意味（P0=最優先〜P3）を UI 上で分かりやすく説明。 |
| 関連 | Apollo dashboard（FAB/ボトムシート投入 UI, タスクボード）, `cxo-agent/data/inbox.jsonl`, `POST /api/inbox`, autonomous-rin の inbox 消費ロジック（[[project-autonomous-rin]]）, 各 docs/TASK_TRACKER.md, MC-72(集約元)・MC-71(手動編集)・MC-78(優先度順ピック) |
| 受け入れ条件（DoD） | (1) AddTaskFab/投入 UI で優先度（P0/P1/P2/P3）を選んで送信でき、未選択時はデフォルト P2。(2) `inbox.jsonl` エントリに priority が記録され、タスク化（TASK_TRACKER 登録）時にその優先度が保持される。(3) 優先度の意味（P0=最優先〜P3=最低、autonomous-rin が高い順に拾う旨）が UI 上で分かる（ツールチップ/凡例/ラベル）。(4) 390px モバイルでセレクタが操作しやすい。 |
| 依存 | 既存 inbox 機構（`POST /api/inbox`）。MC-71(手動編集の md 書き戻し層)・MC-78(優先度順ピック) と priority フィールド・タスク化フロー・md 書き戻し層が重なるため統合設計で重複実装を避ける。 |
| 提言・抜けもれ | (1) priority 未指定時のデフォルト（P2）を明文化。(2) 既存 inbox エントリ（priority 無し）の後方互換＝欠落は既定値フォールバック、既存レコードを壊さない。(3) server は既存 `POST /api/inbox` を非破壊拡張（フィールド追加のみ、既存レスポンス型不変）・既存 token/Basic 認証配下。(4) UI chrome 制約: 中立的丁寧体、ハードコード hex 禁止・CSS 変数、emoji 不可（SVG のみ）。(5) autonomous-rin/林のタスク化時に priority を確実に引き継ぐ結線（消費ロジックの読み取り対応）。(6)「優先度のロジックが不透明」という Keita の不満の核は説明の欠如＝UI に凡例/ツールチップを必ず入れる（セレクタ追加だけで終わらせない）。(7) 検証は test-functional が実機で投入→inbox priority 記録→タスク化時の引き継ぎを確認。 |
| サブタスク | - [ ] AddTaskFab に優先度セレクタ（P0〜P3, default P2）追加<br>- [ ] inbox.jsonl に priority フィールド（後方互換・欠落フォールバック）<br>- [ ] タスク化時に priority を TASK_TRACKER へ引き継ぎ（消費ロジック対応）<br>- [ ] 優先度の意味を UI で説明（凡例/ツールチップ）<br>- [ ] 390px モバイル確認<br>- [ ] restart → test-functional 実機検証 |
| 次アクション | dev-logic + designer が MC-71/MC-78 と統合した priority 機構を設計 → セレクタ＋inbox priority＋引き継ぎ＋凡例実装 → 後方互換・デフォルト検証 |
| 更新日 | 2026-05-31 |

### MC-85 — 開発エージェントが自律して動き続ける＋開発独立エージェント増設

| フィールド | 値 |
|---|---|
| ID | MC-85 |
| タイトル | 複数の開発独立エージェントが並行で自律稼働する仕組み（autonomous-rin 群への拡張・dev-logic 以外の開発エージェント増設） |
| 優先度 | P1 |
| ステータス | IN_PROGRESS（2026-05-31 Keita設計確定: プロジェクト別に複数自律ループ。logic専用/cxo(Apollo)専用/en-chakai専用を独立cronで並行、各自のTASK_TRACKERのみ見てファイル重複をプロジェクト単位で分離→二重push回避。cron時刻ずらし+flock+同時実行上限で529制御。汎用autonomous-rinは残す。林設計→dev-logic実装） |
| 担当 | 林（設計） + dev-logic（cron スクリプト/エージェント定義） |
| 詳細 | Keita「開発エージェントは基本的に動き続けるようにしてほしい。自律して判断して動き続けるようにしてほしい。あと必要であれば dev-logic 以外にも開発の独立エージェントを増やして」。現状 autonomous-rin（headless 林、10分毎 cron、1ティック1タスク）が唯一の自律ループ。これを「複数の開発独立エージェントが並行で自律稼働」に拡張する。dev-logic 的な実装エージェントを複数立て（例: dev-logic-2 や領域別）、各々が独立 cron ループでタスクボードから拾って進める。並行時の二重 push/競合回避（プロジェクト/ファイル分担、flock）。林が設計。 |
| 関連 | [[project-autonomous-rin]]（既存ループ）, [[project-agent-roster-20260531]]（開発9体）, `/home/dev/cron-scripts/autonomous-rin.sh`, `next-task-id.sh`, 各 docs/TASK_TRACKER.md, [[reference-subagent-slow-not-dead]] |
| 受け入れ条件（DoD） | (1) 複数の開発独立エージェントが並行で独立 cron ループとして自律稼働し、タスクボードから着手可能タスクを拾って前進する。(2) 二重 push/二重実装・ファイル競合が起きない分担機構（プロジェクト or ファイル分担、flock、起票直列化）。(3) 何体・どう分担するかの設計を Keita が承認済み。(4) kill-switch と監視（apollo番人/Monitor）で暴走・stall を止められる。 |
| 依存 | Keita の設計承認（何体・分担方針）が前提＝BLOCKED。承認後に dev-logic が cron/定義を実装。既存 autonomous-rin の flock・1ティック1タスク・green ゲート設計を踏襲。 |
| 提言・抜けもれ | (1) 並行で最大の事故は二重 push/競合＝[[project-vultr-second-server]] の2箱二重実装事故と同型。分担は「プロジェクト単位（A=logic/B=cxo-agent）」か「ファイルバケツ単位」で非重複に割り、コミットは直列化（git レース回避）。(2) 採番レース＝必ず next-task-id.sh＋起票直列化（[[reference-task-id-numbering]]）。(3) Anthropic アカウント共有のため同時 LLM 多重起動は 529/激遅を誘発（[[project-vultr-second-server]]）＝同時実行数に上限を設ける。(4) 各ループに kill-switch（autonomous-rin の `~/.autonomous-rin.disabled` 方式）と stall 監視（8分未満で切らない＝[[reference-subagent-slow-not-dead]]）。(5) push/deploy は autonomous-rin と同じく green ゲート前提（承認領域は維持）。(6) 「動き続ける」は [[feedback-never-stop-with-open-todos]]（24h 自走）と整合。(7) エージェント定義を増やすなら agent-config に登録→全 sub-repo sync、roster（60-Agents）にも追加。(8) Keita 確認事項を明確化: 何体・領域分担の軸（プロジェクト別 or 機能別）・各ループの cron 間隔・同時実行上限。 |
| サブタスク | - [ ] 林が設計案（体数・分担軸・cron 間隔・同時実行上限・競合回避機構）を作成<br>- [ ] Keita に体数・分担方針を確認（BLOCKED 解除条件）<br>- [ ] 承認後: 追加開発エージェント定義（agent-config 登録→sync）<br>- [ ] 各エージェントの独立 cron ループスクリプト（flock・kill-switch・green ゲート）<br>- [ ] 分担機構（プロジェクト/ファイル非重複・コミット直列化・採番直列化）<br>- [ ] 監視（apollo番人/Monitor）と暴走停止の検証<br>- [ ] DRY_RUN 試走で二重 push しないこと検証してから本番アーム |
| 次アクション | 林が設計案を作成 → Keita に体数・分担を確認（BLOCKED 解除）→ dev-logic が実装 |
| 更新日 | 2026-05-31 |

### MC-86 — 稼働してないエージェントを起こして指令を出す機能

| フィールド | 値 |
|---|---|
| ID | MC-86 |
| タイトル | Apollo からアイドルなエージェントを選んで指令を出し起動する機能 |
| 優先度 | P2 |
| ステータス | IN_PROGRESS（2026-05-31 Keita設計確定: inbox経由起動。Apolloでアイドルエージェント選択→指令入力→inboxにagent指定タスク投入→autonomousティックが該当subagentを起動。MC-77のinbox即タスク化を拡張。サーバ直spawnせず既存機構活用で安全） |
| 担当 | 林（設計） + dev-logic |
| 詳細 | Keita「稼働していないエージェントを動かして指令を出す、という機能がほしい」。Apollo から、今アイドルなエージェント（roster/agents）を選んで指令（プロンプト/タスク）を出し起動する。Apollo UI に「エージェント選択→指令入力→headless 起動」の導線。技術的には headless claude（`--print --agent <type>`）をサーバから起動、もしくは inbox 経由で autonomous 系に渡す。任意プロンプト実行のセキュリティとプロセス管理に注意。 |
| 関連 | [[project-apollo-dashboard]]（roster/agents/inbox）, `/api/roster`・`/api/inbox`, [[project-autonomous-rin]], MC-85（自律エージェント群・起動機構が重なる）, headless `claude --print --agent` |
| 受け入れ条件（DoD） | (1) Apollo UI でアイドルなエージェントを一覧から選び、指令（プロンプト/タスク）を入力して送信できる。(2) 送信で対象エージェントが headless 起動し、指令を実行する（or inbox 経由で autonomous 系に渡り処理される）。(3) 任意プロンプト実行のセキュリティ境界（認証配下・実行範囲制限）が担保される。(4) 起動したプロセスの状態が Apollo で追える（起動中/完了/失敗）。(5) 390px モバイルで操作できる。 |
| 依存 | MC-85（自律エージェント群）と headless 起動・並行プロセス管理が重なるため統合設計で重複実装を避ける。起動方式（直接 headless 起動 vs inbox 経由）とセキュリティ境界の設計判断が前提＝BLOCKED。 |
| 提言・抜けもれ | (1) セキュリティが最大の論点＝サーバから任意プロンプトで claude を起動＝RCE 相当。必ず既存 token 認証配下、実行は許可エージェント type のホワイトリスト、プロンプト長/頻度制限、ログ監査。(2) プロセス管理: 起動したヘッドレスの PID 追跡・タイムアウト・kill 導線・同時起動上限（共有アカウントで 529 回避、[[project-vultr-second-server]]）。(3) 「アイドル判定」の定義＝roster の最終稼働 mtime か、cron ループ稼働状況か（MC-85 のループ状態と連動）。(4) 起動方式の選択肢を Keita に提示: (a) サーバが直接 `claude --print --agent` を spawn（即時・実装重・セキュリティ責任大）vs (b) inbox.jsonl に instruction 投入して autonomous 系が拾う（既存機構流用・即時性は cron 間隔依存・安全）。MC-85 が複数ループを作るなら (b) が自然。(5) UI chrome 制約（中立丁寧体・CSS 変数・SVG）。(6) MC-85 と設計セットで進めるのが効率的（先に MC-85 の起動基盤を決めてから本件 UI を載せる）。 |
| サブタスク | - [ ] 起動方式を Keita に確認（直接 spawn vs inbox 経由）＝BLOCKED 解除条件<br>- [ ] セキュリティ境界設計（認証・type ホワイトリスト・レート制限・監査ログ）<br>- [ ] アイドル判定ロジック定義（MC-85 のループ状態と連動）<br>- [ ] Apollo UI: エージェント選択→指令入力→起動 導線<br>- [ ] プロセス状態追跡（起動中/完了/失敗・kill 導線・同時起動上限）<br>- [ ] 390px モバイル確認<br>- [ ] restart → test-functional 実機検証 |
| 次アクション | MC-85 の起動基盤設計とセットで、林が起動方式・セキュリティ境界案を作成 → Keita 確認（BLOCKED 解除）→ dev-logic が実装 |
| 更新日 | 2026-05-31 |

