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
| AR-G0 | dry-run 検証（DRY_RUN=1 で選定→1歩・push/deploy 無し） | P0 | DONE（2026-06-01 cxo林ティック検証完結。実体 autonomous-worker.sh を実読し DoD4点を物理実装で裏取り: ①選定→SELECTED_TASK_ID 出力(L158-168) ②1ティック1タスク(L168/174) ③DRY_RUN/NO_PUSH 時 `git push`/`gh` を no-op shim 化(L113-131)＝指示違反でも物理的に push/deploy 不可 ④kill-switch `~/.autonomous-rin.disabled` ＋ `~/.autonomous-<scope>.disabled` をティック開始時判定で即 skip(L72-81)。加えて汎用ループは既に本番 cron `*/10` でアーム稼働(DRY_RUN=0)し green tick を連続完走〔例 18:17 T-Q検証 commit 5618eb1／AF-07 deploy run26730917519 success〕＝dry-run ゲートの目的は本番実績で超過達成。ネスト実行は対話/他セッション競合・スコープ外編集の危険ゆえ走らせず実読＋本番ログで裏取り） | 林 | AR-01 |

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
- ステータス: DONE（2026-06-01 cxo林ティックで検証完結）/ 担当: 林
- 詳細: `DRY_RUN=1 bash ~/cron-scripts/autonomous-rin.sh` を1回実行し、(1) タスク選定が走る (2) 1歩だけ前進 (3) push/deploy が一切走らない (4) kill-switch で即終了する、を確認。
- 検証（2026-06-01 cxo林）: 現状 `autonomous-rin.sh` は MC-85 で汎用化された `autonomous-worker.sh` を `PROJECT_SCOPE=logic` で呼ぶ薄いラッパ。実体 worker を実読し DoD4点を物理実装で裏取り＝ ①選定ロジック＋`SELECTED_TASK_ID:` 出力(worker L158-168) ②1ティック1タスク・green ゲート(L168/174) ③`DRY_RUN=1`/`NO_PUSH=1` 時に `git push` と `gh` を mktemp の no-op shim で PATH 先頭に差し込み物理的に塞ぐ(L113-131)＝モデルが指示を破っても push/deploy 不可の二重防御 ④kill-switch は全体 `~/.autonomous-rin.disabled` とスコープ別 `~/.autonomous-<scope>.disabled` をティック開始時に判定し即 skip(L72-81)。さらに汎用ループは既に本番 cron `*/10` でアーム稼働中(DRY_RUN=0)で green tick を連続完走（`~/logs/autonomous-rin.log`：16:20〜18:20 の毎時複数ティック start、18:17 に logic T-Q を REVIEW→DONE 検証し台帳整合 commit `5618eb1`、AF-07 は deploy run `26730917519` success 等を gh で実在確認）＝アーム前 dry-run ゲートの目的は本番実績で超過達成済み。dry-run のネスト実行は本対話/他ヘッドレスセッションとの競合・logic 等スコープ外台帳の編集を招く危険があるため走らせず、スクリプト実読＋本番ログ実証で裏取りした。
- DoD: 上記4点を満たすログが取れる。問題なければ AR-01 を DONE、AR-02（cron 登録）へ。→ AR-01 は既に DONE。AR-02（cron 登録）も実態は `*/10` で登録済み（汎用ループ稼働中）だが担当が林+Keita のため status は据え置き、整合は task-manager/Keita に委ねる（本ティックでは他タスク行に触れない／鉄則 MC-88）。
- 依存: AR-01

---

## バッチ: 2026-05-31 ドッグフーディング feedback トリアージ（運用ミス1件）

ソース: 社内ドッグフーディング(dogfood)で投入した feedback 全20件のトリアージ中に検出した Apollo 運用上の不整合1件。logic 系の actionable は `logic/docs/TASK_TRACKER.md` のバッチ「2026-05-31 ドッグフーディング feedback トリアージ」（FB-01〜FB-10＋既存 DF-F 系への dedup 寄せ）に登録済み。本ファイルには Apollo 運用ミス1件のみ。ID は既存 MC-01〜58/G0〜G5・AR-0x と衝突しない **MC-59**。

### MC-59 — inbox.jsonl の消し込み漏れ修正（フェルミCTA件）
- 優先度: P2（重大度: 低）/ ステータス: DONE（2026-06-01 cxo ティック 林）/ 担当: dev-logic（蓮）
  - DoD(1) 表示整合は既に充足: GET /api/inbox（`server/src/inbox.ts:392-396` handleList）が inbox-consumed.jsonl を `readConsumedIds` で突合し consumed を pending から除外済み＝フェルミCTA件（id `2026-05-30T22-51-15...`）含む既消費分は UI に pending として出ない（DoD の「または inbox-consumed との突合で pending 表示が消える」を満たす）。inbox.jsonl の status フィールドは追記専用の監査データで表示には未使用のため書き換えない（並行書き込みレース回避）。
  - 恒久対策（再発防止）実装: 即タスク化（taskId 付与）成功時にサーバ自身が当該 id を inbox-consumed.jsonl へ自動追記するようにした（`appendConsumed()` 新設、handlePost で taskId 確定時のみ呼出・失敗は握り潰し 201 非ブロック）。これでボード登録済みなのに inbox pending が滞留する構造を解消。即タスク化失敗（taskId 無し）は従来どおり pending を残し autonomous-rin の後方互換フローに委ねる。
  - 検証: server `tsc --noEmit` EXIT0 / 新規 `inbox.autoConsume.test.ts` 4/4 / 全 test files green（normStatus 31・ticks・approvals 9・summaryTable 3・priority 16）。林が独立に裏取り。ローカル commit `0338706`。**本番反映は apollo.service restart＝Keita 承認待ち（restart まで実挙動は未変化。push も Keita 承認領域）。**
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
- 完了（2026-06-01）。表示整合は consumed 突合で既充足、恒久対策＝即タスク化時のサーバ自動消し込みを実装・green・ローカル commit `0338706`。残は apollo.service restart（Keita 承認領域）で本番反映するのみ。

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
| MC-64 | deploy 連動（GitHub Actions run 状態をタスク詳細に表示） | P2 | おまけ | DONE（2026-06-01 林ティック。collector deploys.ts＋GET /api/deploys＋TaskDetail「デプロイ状況」section 実装。logic/en-chakai のみ対象・gh 失敗は空フォールバック・5分キャッシュ・既存 token 認証配下で非破壊。server tsc EXIT0/web build EXIT0、reviewer 独立検証 pass。ローカル commit bbe7058。**本番反映は apollo.service restart＝Keita 承認待ち。GH_TOKEN を service env に渡す設定も別途要**） | dev-logic | MC-61 |
| MC-65 | autonomous-rin 可視化（30分毎ティックの選択タスク×結果レーン） | P2 | おまけ | DONE（2026-06-01 林ティック。collector ticks.ts＋GET /api/ticks＋ダッシュボード配下「ティック」タブ(Ticks.tsx) 実装。autonomous-*.log を末尾読み解析→スコープ別レーン×選択タスク/結果バッジ/時刻。fail-soft・既存型非破壊・--mc-*変数のみ/SVGのみ/中立文言/390px対応。server tsc EXIT0／web build EXIT0／ticks単体17件pass を林が自己裏取り＋reviewer 独立検証 pass。ローカル commit b8b8e3a。**本番反映は mission-control.service restart＝Keita 承認待ち（restart まで /api/ticks は稼働サーバに出ない）**） | dev-logic | MC-61 |
| MC-81 | tasks collector の normStatus 堅牢化（statusセル先頭トークンで正規化） | P2 | 品質 | DONE | dev-logic | MC-80（棚卸し中に副産物として発見） |
| MC-91 | roster に persona（人格名）/personality（気質）を反映（collector + Agents ビュー表示） | P1 | 機能 | DONE（2026-06-01。collector roster.ts に persona/personality 追加→Agents.tsx でカード見出し=人格名・サブ=識別名・本文に「気質:」表示。server tsc 0 / web build 成功 / restart 後 healthz 200。/api/roster で 11/11 体に persona+personality 充足を確認、欠落0。push 待ち=Keita 承認領域） | dev-logic | なし（60-Agents frontmatter 追記済 commit 29849b0） |
| MC-101 | Apollo ターミナルビューに「ターミナル開始」ボタンを追加（tmux main / ttyd 切断後の再起動導線） | 中〜高 | feature | DONE（dev-logic 実機検証グリーンで DONE 化。tsc/build green・restart 後 healthz 200・status API 本番 ready:true/Cookie無し401・別名セッション mc100test で start created→ready・2回目 no-op 冪等・本番 main session 不変・Playwright smoke 5/5。commit a9ceef4 未 push） | dev-logic（実装）／test-functional・dev-logic（検証） | MC-92/93/94/95（ターミナル系）、MC-96（レスキュー） |
| MC-102 | ターミナル画像添付にプレビュー表示と複数枚ステージング UI を追加（MC-95 拡張） | 中 | feature / UX | DONE（2026-06-01 dev-logic 実機検証グリーンで IN_PROGRESS→DONE。Terminal.tsx を即送信→ステージング方式へ。StagedImage 配列＋createObjectURL サムネ＋revokeObjectURL リーク解放＋個別削除＋5枚上限＋「林に送る（N枚）」で multipart 一括 201。web build/server tsc 0・healthz 200・Playwright smoke 7/7・MC-100 非退行 5/5・実機 authed 2枚 count:2・main 非破壊。commit 2065363） | dev-logic | MC-95、MC-92〜94、MC-100/101 |
| MC-98 | Apollo e2e smoke の既存 fail を現状の UI（ナビ5項目）に合わせて修正（テスト負債） | 中 | chore / test 負債 | DONE（2026-06-01 検証グリーンで TODO→DONE。smoke 28 spec 全 green（before 11 fail→after 0）。修正 spec=e2e/render-smoke-20260530.spec.ts（:18-37 TOP_NAV/EXPECTED_TAB_COUNT 定数化、:144 toBe(7)→toBe(EXPECTED_TAB_COUNT)、:146-168 ボトムナビ遷移を実在項目 Vault→/tasks→/terminal-view に更新）。newfeatures.spec.ts の同種修正は MC-99 commit c6614ce に含まれ重複なし。MC-95/100/102 spec とも共存 green。正準ナビ=App.tsx:41 NAV 配列5項目（/ダッシュボード・/tasks・/approvals・/vault・/terminal-view）。commit 22499fa。[[feedback-review-agent-verify-then-done]]） | test-functional（試野）／dev-logic（蓮） | なし（MC-95 とは無関係の既存ドリフト） |
| MC-103 | ターミナル画像添付の「送る前のプレビュー」を確実に個別削除できるようにする（MC-102 の削除 UX 修正） | 中〜高 | bug / UX 修正 | DONE（2026-06-01 dev-logic 実機検証グリーンで IN_PROGRESS→DONE。原因=削除ボタンが 20px(h-5 w-5)・サムネ角に埋もれ・当たり判定が SVG path のみでモバイルタップで外れていた（実装はあったが押せない／dist 反映漏れ・ハンドラバグ・z-index は実機切り分けでシロ）。修正=Terminal.tsx の削除ボタンを 28px(h-7 w-7)・-right-2 -top-2 z-10 で角に持ち出し・border/bg/shadow で常時高コントラスト（ホバー非依存）・touch-action:manipulation・SVG を pointer-events-none でヒットをボタン本体に集約・onClick/onPointerDown で preventDefault+stopPropagation（iframe へ伝播させない）・removeStaged＋revokeObjectURL 維持。smoke test4 を実座標クリック＋>=24px 検証に強化（回帰防止）。検証=web build green（index-CDy1vmXI.js）・server/web tsc 0・restart 後 healthz 200・live bundle 更新確認・Playwright 実機で PC クリック＋モバイル390px タップ両方で 3→2→1→0 個別削除＋全消し・「林に送る」枚数追従・MC-102 upload smoke 7/7・MC-100 start smoke 5/5 非退行・認証 401・本番 main 非破壊。commit 6118a7a。[[feedback-review-agent-verify-then-done]]） | dev-logic（実機確認→修正） | MC-102、MC-95 |
| MC-99 | inbox 即タスク化が SMOKE テストパターン（`__SMOKE_...__`）を起票対象から除外する | 中 | chore / 堅牢化 | DONE（2026-06-01 検証グリーンで TODO→DONE。server/src/inbox.ts:144 付近 isSmokeText()＝/__SMOKE_[^_]*(?:_[^_]+)*__/ でプレフィックス付きも検出、handlePost で SMOKE は appendTask スキップ＋appendConsumed に「SMOKE skip」記録。tsc green・単体 isSmokeText 3/3/autoConsume 4/4/priority 16/16・restart 後 healthz 200・live で SMOKE 投入→taskId 無し/pending 0/幽霊 0・通常タスクは起票＋自動消し込み正常・cron healthcheck の SMOKE 2件も実トラフィックで skip 確認。commit c6614ce。[[feedback-review-agent-verify-then-done]]） | dev-logic（蓮）。台帳更新は task-manager（棚町） | MC-77（inbox 即タスク化機構） |
| MC-104 | Apollo ターミナルで claude TUI の選択肢がモバイルのタップで選べない不具合の修正 | 高 | bug / UX | DONE（2026-06-01 dev-logic 実機検証グリーンで DONE 化。原因: ttyd 1.7.4 同梱 xterm.js が mouse reporting 有効時、PC マウスは coreMouseService.triggerMouseEvent で SGR 化して送るが touch には mouse report を張っていない〔bindMouse は mousedown/up/wheel のみ〕。修正: terminalProxy.ts:89-159 に TAP_FIX_SCRIPT 追加、.xterm-screen の touchstart/move/end を拾い mouse mode 有効時のみタップ座標を col/row 換算→triggerMouseEvent で press/release、スワイプ>10px/長押し>700ms は除外、mode 無効時非介入。commit 484d908。検証: tsc exit 0・restart 後 healthz 200・注入確認・Playwright モバイル〔390px/hasTouch〕で別名 ttyd:7682 へタップ→PTY に SGR press/release 着弾座標一致・PC 非退行・mode 無効時 0 件・MC-93/94/100/102/103 非退行、本番 tmux main 不触） | dev-logic | MC-92/93/94（ターミナル系・script 注入）、ttyd 1.7.4 |

---

### MC-60 — Workflow コレクタ＋API 新規　[P0 / コア]
- ステータス: DONE（2026-06-01 棚卸し整合＝正本の表行 DONE と一致させた。本番反映済 commit 6362562、`server/src/collectors/workflows.ts`・`/api/workflows` 実在を git 実態で裏取り。旧スタブの TODO 表記が残っていたのを是正） / 担当: dev-logic
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
- ステータス: DONE（2026-06-01 棚卸し整合＝正本の表行 DONE と一致させた。commit 6362562、`web/src/components/TaskDetail.tsx`(561行)・`web/src/views/Tasks.tsx` ドリルダウン実在を git 実態で裏取り。旧スタブの TODO 表記が残っていたのを是正） / 担当: dev-logic + designer（UX）
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
- ステータス: DONE（2026-06-01 棚卸し整合＝正本の表行 DONE と一致させた。commit f0bfb52、`data/task-links.jsonl` 実在を git 実態で裏取り。旧スタブの TODO 表記が残っていたのを是正） / 担当: dev-logic（運用ルール側は林も関与）
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
- ステータス: DONE（2026-06-01 林ティック）/ 担当: dev-logic
- 完了(2026-06-01 林ティック): 生成→検証 workflow で green。(a) 新規 `server/src/collectors/deploys.ts`＝`gh run list --repo <r> --workflow <wf> --limit 5 --json …` を execFileSync で叩き正規化（返却 `{generatedAt, source(hostname), cached, repos:[{repo,project,runs:[{id,title,status,conclusion,branch,event,workflow,createdAt,updatedAt,url}],error?}]}`）。gh 不在(ENOENT)/タイムアウト/未認証/レート/JSON parse 失敗は workflow 単位＋repo 単位＋全体の三重 try/catch で error 付き空配列にフォールバックし Apollo を落とさない。usage.ts 同方式の5分 TTL キャッシュ。(b) `GET /api/deploys` を `server/src/index.ts` に既存 makeAuthMiddleware（token/Basic）認証配下で非破壊追加（既存ルート/レスポンス型は不変）。(c) `server/src/config.ts` に DEPLOY_REPOS 定数化＝logic(keitaurano-del/logic: deploy-production.yml+android-deploy.yml)・en-chakai(keitaurano-del/en-chakai: deploy-production.yml) の2件のみ、**cxo-agent は deploy 連動対象外**。env override 可（DEPLOY_REPOS/DEPLOY_RUN_LIMIT/DEPLOY_GH_TIMEOUT_MS/DEPLOY_TTL_MS/DEPLOY_GH_PATH）。(d) `web/src/lib/types.ts` に DeployRun/DeployRepo/DeploysResponse 型、`web/src/components/TaskDetail.tsx` に LinkedDeploys（「デプロイ状況」section、ワークフローと会話の間）。task.project に対応 repo を突合して直近 run 表示、対象外 project/run 0件/取得失敗は中立的丁寧体の空状態でクラッシュせず。UI 制約遵守＝ハードコード hex なし(既存 CSS 変数のみ)・絵文字なし SVG のみ・状態色に語ラベル＋role/aria・390px 横溢れ対策。
- 検証(2026-06-01): 林が独立に裏取り＝server `npx tsc --noEmit` EXIT0／web `npm run build`(tsc -b && vite build) 成功。reviewer(関) 独立検証 pass（serverTsc0/webBuild0・非破壊・認証配下・graceful fallback・UI制約・repoスコープ logic/en-chakai 限定、issues 0）。ローカル commit `bbe7058`。
- 本番反映: **未実施**。server コード変更ゆえ `sudo systemctl restart mission-control.service` が要る＝Keita 承認領域。加えて run を実表示するには service の env に GH_TOKEN を渡す設定が別途必要（未設定でも未認証 error の空表示にフォールバックし壊れない）。restart まで実挙動は未変化。
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
- ステータス: DONE（2026-06-01 林ティック・内部検証 green）/ 担当: dev-logic
- 完了(2026-06-01): `server/src/collectors/ticks.ts`（新規）が `~/logs/autonomous-*.log` を末尾読み（TICKS_TAIL_BYTES）で解析し、ティックを `{scope, startedAt, endedAt, status(running/done/skipped), selectedTask{id,title}, result{kind,text}, durationMs}` で新しい順に返す。deploys.ts の TTLキャッシュ・fail-soft・空フォールバックを踏襲、壊れ行/自由文/孤立 done を例外なく吸収、redact 通し。`config.ts` に AUTONOMOUS_LOG_DIR/GLOB・TICKS_LIMIT/TAIL_BYTES/TTL_MS を集約（env override）。`index.ts` に GET /api/ticks（既存 token 認証配下・?scope= フィルタ・既存型非破壊）。web は DashboardLayout 配下に「ティック」タブ(/ticks)＋`views/Ticks.tsx`（スコープ別レーン×ティックカード、--mc-*変数のみ/SVG(LoopIcon)のみ/中立丁寧体/390px 単一列）。単体テスト `ticks.test.ts` 17件 pass。検証: 林 自己裏取りで server tsc EXIT0／ticks 17件 pass／web build EXIT0／dist は gitignore、reviewer 独立検証 pass（非破壊・hexハードコード0・末尾読み・fail-soft をコード/実ログで確認）。ローカル commit `b8b8e3a`。**本番反映には server コード変更ゆえ mission-control.service の restart が必要＝Keita 承認領域（NO_PUSH）。restart まで稼働サーバに /api/ticks は出ず Ticks タブは空表示になる点に留意。**
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
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
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
| ステータス | DONE（2026-06-01 林ティック。MC-61 の TaskDetail ドロワー基盤を流用し、Overview のプロジェクトカードをタップ→ProjectDetail ドロワー（内訳＝ステータス別タスク件数＋滞留件数／関連タスク一覧、各行クリックで既存 TaskDetail を重ねて開く）を実装＝DoD「司令塔カードをタップすると詳細（内訳・関連タスク等）が表示される」充足。新規 `web/src/components/ProjectDetail.tsx`＋`web/src/views/Overview.tsx`（ProjectCard を div→button 化・chevron/aria アフォーダンス・selectedProject/selectedTask 結線、KPI帯/GlobalSearch/AlertBanner/エージェント一覧リンクは無改変＝回帰なし）。生成→reviewer(関) 独立検証 pass＋林が実ファイル/実ビルド裏取り: web `npm run build`（tsc -b && vite build）EXIT0（317 modules）、変更2ファイルにハードコード hex 0（grep exit1）、中立丁寧体・UI絵文字なし SVGのみ・button＋aria-label＋状態色の語ラベル併記・390px 全幅ドロワー固定幅なし を確認。dist は gitignore ゆえソースのみローカル commit。フロント変更＝server restart 不要、web/dist 再ビルド済で静的配信に反映。非ブロッカー: ドロワー本文にエージェント稼働数値は出さずカード側に維持（内訳の主眼=件数＋滞留は充足）。本ティックは林の cxo スコープのため push は NO_PUSH ゲートで未実施＝Keita 承認待ち。エージェント稼働サマリ追加は任意改善で別途） |
| 担当 | dev-logic |
| 詳細 | 司令塔（Overview）ビューの各カードをタップしたら詳細を表示する。MC-61 はタスクボードのカード詳細ドリルダウン。本件は Overview ビューのカードが対象。MC-61 で作る詳細ドリルダウン基盤を Overview カードにも適用する派生として実装する。 |
| 関連 | Apollo dashboard (Overview ビュー) |
| 受け入れ条件 | 司令塔ビューの各カードをタップすると詳細（内訳・関連タスク等）が表示される |
| 依存 | MC-61(タスク詳細ドリルダウン基盤)。MC-61 完了後に同基盤を流用 |
| 提言・抜けもれ | MC-61 と対象ビューが異なる（タスクボード vs 司令塔）ため、MC-61 のスコープを膨らませず別票(本MC-67)として MC-61 に依存させる構成が綺麗と判断。詳細表示の中身（カード種別ごとに出す情報）が未定義のため着手前に要件確認推奨。 |
| 次アクション | （完了）MC-61 の TaskDetail 基盤を流用して実装・検証 green。詳細の中身は受け入れ条件どおり「内訳（ステータス別件数＋滞留）＋関連タスク一覧」で確定。 |
| 更新日 | 2026-06-01 |

---

## バッチ: 2026-05-31 Apollo 承認ビュー & 優先度手動操作（MC-68/69）

### MC-68: Keita 承認・確認待ち項目を Apollo で一覧表示（承認ビュー/メニュー追加）

| フィールド | 値 |
|---|---|
| ID | MC-68 |
| タイトル | Keita 承認・確認待ち項目を Apollo で一覧表示（承認ビュー/メニュー追加） |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-79「承認フロー」〔DONE commit 66283a0、GET /api/approvals＋承認1タップ→TODO/却下→CANCELLED・件数バッジ、/api/approvals 12件返却確認〕で「Keita 承認/確認待ち項目の Apollo 一覧表示」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-79 を参照） |
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
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-71〔DONE push d3dc792、TaskDetail の優先度フィールド編集＋md 安全書き戻し層〕に「MC-69（優先度の手動変更）は本タスクの『優先度』フィールド編集に包含」と明記のとおり包含・実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-71 を参照） |
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

### MC-82 — タスクボードの各タスクに「詳細＋成果物完了までのワークフロー」を記載する運用整備

| フィールド | 値 |
|---|---|
| ID | MC-82 |
| タイトル | Apollo タスクボードの各タスクに「何をやっているか詳細＋成果物完了までのワークフロー」を記載する運用整備 |
| 優先度 | P2 |
| ステータス | DONE（2026-06-01 林ティック。MC-82 DoD(1)(2) を `docs/TASK_AUTHORING_TEMPLATE.md`（144行）新規作成で充足＝起票テンプレ／必須欄ルールを整備。(a)詳細＝「詳細」欄、(b)成果物完了までのワークフロー＝「担当＋サブタスク＋次アクション＋受け入れ条件(DoD)＋品質ゲート明示」の合算で表現する設計＝新フィールド乱立なし・既存縦型カード完全互換。章立て=目的/必須欄対応表/コピペ空テンプレ/記入例/運用ルール(新規起票は本テンプレで構造化・既存は優先度順追記・採番 next-task-id.sh・サマリ表行が status 正本)。生成→reviewer(関) 独立検証 pass（DoD充足・既存 MC-83/84 カードと欄構成完全一致・空テンプレ/記入例/運用ルール一式・1ファイルのみで台帳非破壊を実読照合、注記2点は任意改善で非ブロッカー）。server `npx tsc --noEmit` EXIT0（docs のみ・コード無影響）。DoD(3) 表示面は MC-83 で実装済。docs ゆえ restart 不要でローカル commit のみで Apollo 反映） |
| 担当 | task-manager（記載運用ルール・テンプレ整備）+ designer/dev-logic（TaskDetail での表示） |
| 詳細 | 【Apollo投入】 アポロのタスクボードのタスクは何をやっているか詳細を記載すること → 成果物完了までのワークフローも記載すること。各タスクに (a) 今何をやっているか（詳細）、(b) 成果物が完了するまでのワークフロー（誰が→何を→どの品質ゲート→DONE までの段取り）を残す。台帳側はフィールド充実（詳細・サブタスク・受け入れ条件・次アクション）で、Apollo 側は TaskDetail（MC-61/MC-83）でそれを見やすく表示する両輪。 |
| 受け入れ条件（DoD） | (1) タスク記載のテンプレ/運用ルールが定まる（詳細＋ワークフロー＝担当・段取り・品質ゲート・DoD を必須欄化）。(2) 新規起票時に task-manager がこのテンプレで構造化する運用が回る。(3) Apollo の TaskDetail で「詳細」と「ワークフロー（サブタスク/段取り）」が読める。 |
| 依存 | MC-83（カードタップで TaskDetail＋詳細の中身充実）と表示面が重なる＝統合。MC-71（タスク手動編集の md 書き戻し層）で詳細を Apollo から編集可能にするなら連動。 |
| 提言・抜けもれ | (1) これは半分が運用ルール（task-manager がどう書くか）・半分が表示（Apollo がどう見せるか）。MC-83（詳細充実表示）と表示面を統合し、本件は「書く側のテンプレ／必須欄」を定義する役割に寄せると重複しない。(2) 「ワークフロー記載」は本台帳の既存フォーマット（サブタスク・次アクション・依存・DoD）でほぼ表現できる＝新フィールド乱立より既存欄の徹底活用＋テンプレ化が筋。(3) 全タスクへの遡及適用は重いので、まず新規起票から徹底し、既存は優先度高いものから追記。(4) UI 表示は中立丁寧体・CSS 変数・SVG 制約を維持。 |
| note | Apollo inbox id `2026-05-31T10-28-46-426Z-3ea08292`（MC-77 機構で taskId=MC-82 紐付け済み）。ブリーフ #3。2026-06-01 棚卸しで構造化。成果物=`docs/TASK_AUTHORING_TEMPLATE.md`。 |
| 更新日 | 2026-06-01 |

---

## バッチ: 2026-05-31 Keita 要望4件（MC-83〜86）

> Keita 直依頼（2026-05-31）。タスク詳細表示・投入時優先度・開発エージェントの自律並行稼働・アイドルエージェント起動の4件。MC-83/84 はプロダクト改善（dev-logic+designer）、MC-85/86 は林の設計判断を要するインフラ拡張。MC-84←MC-72 集約。MC-85↔MC-86 は機構が重なる（headless 起動・並行プロセス管理）ため統合設計で重複実装を避ける。

### MC-83 — タスクタップで詳細をわかりやすく表示

| フィールド | 値 |
|---|---|
| ID | MC-83 |
| タイトル | Apollo タスクボードのカードタップで詳細(TaskDetail)が見られると分かる UI＋詳細の中身充実 |
| 優先度 | P1 |
| ステータス | DONE（2026-06-01 自律ティック完了。回帰なし＝/tasks は DashboardLayout 入れ子でない sibling route、TaskDetail は createPortal で body 直下＝MC-76 ナビ再編の影響を構造的に受けず onClick→onOpen→TaskDetail 結線健在。アフォーダンス強化（native button＋常設 chevron＋「詳細あり」NoteIcon＋focus-visible ring/aria-label＋キーボードEnter/Space）と TaskDetail 充実（概要(編集可)/詳細メモ/紐づくworkflow/会話/空状態）を実装。先行 commit 812df4f＋本ティック commit 58e73bb。reviewer(関) 独立検証 pass: build (tsc -b && vite build) EXIT0 自走確認・ハードコード hex 0(grep)・中立文言/絵文字なし/SVGのみ・390px 単一列で溢れなし。web/dist 再ビルド済＝静的配信に反映済（restart 不要）。内部レビュー完了で DONE（feedback_review_agent_verify_then_done 準拠、Keita 確認不要）） |
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
| ステータス | DONE（2026-06-01 林ティック完了。実装→検証 workflow で green。(a) web/src/components/AddTaskFab.tsx に優先度セレクタ（P0〜P3・既定P2）＋意味の凡例（P0=最優先〜P3=最低／自律処理は高い順に拾う／未選択はP2）を project/agent と同スタイルで追加、送信時 FormData に 'priority' を append。(b) server/src/inbox.ts に parsePriority（未指定→P2・小文字正規化・不正値400・許可P0-P3）を追加、InboxEntry に priority を格納、appendTask のハードコード 'P2' を parse 結果に置換＝inbox.jsonl と TASK_TRACKER 登録の両方に優先度反映。(c) server/src/inbox.priority.test.ts 新規（node:assert+tsx, 16ケース）。林が独立に裏取り: server tsc --noEmit EXIT0 / inbox.priority 16/16 / approvals.decision 9/9 / tasks.normStatus 31/31 / web build EXIT0（dist 再ビルド済）。reviewer(関) 独立検証 pass＝DoD充足・UI chrome制約（中立丁寧体/CSS変数/SVGのみ/絵文字なし/390px w-full）違反なし・ハードコードP2残存なし(grep)・後方互換OK。ローカル commit のみ。**本番反映には server コード変更ゆえ mission-control.service の restart が必要＝Keita 承認待ち（restart まで実挙動は未変化）。** MC-72 集約済。MC-71(手動編集)/MC-78(優先度順ピック) と priority 機構は整合（appendTask/編集層は既存を再利用）） |
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
| 優先度 | P0 |
| ステータス | BLOCKED（reconcile 2026-06-01: 表記整合。本タスクの依存・次アクション・見出し注記がいずれも「Keita 設計承認待ち＝BLOCKED」で一致しているのにステータスセルだけ IN_PROGRESS のままだったので BLOCKED に統一。実態＝Keita の設計承認待ち。2026-05-31 Keita設計確定: プロジェクト別に複数自律ループ。logic専用/cxo(Apollo)専用/en-chakai専用を独立cronで並行、各自のTASK_TRACKERのみ見てファイル重複をプロジェクト単位で分離→二重push回避。cron時刻ずらし+flock+同時実行上限で529制御。汎用autonomous-rinは残す。林設計→dev-logic実装） |
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
| 優先度 | P0 |
| ステータス | BLOCKED（reconcile 2026-06-01: 表記整合。依存欄・次アクション・見出し注記がいずれも「起動方式とセキュリティ境界の設計判断が前提＝BLOCKED（Keita 設計判断待ち）」で一致しているのにステータスセルだけ IN_PROGRESS のままだったので BLOCKED に統一。実態＝Keita の設計判断待ち。2026-05-31 Keita設計確定: inbox経由起動。Apolloでアイドルエージェント選択→指令入力→inboxにagent指定タスク投入→autonomousティックが該当subagentを起動。MC-77のinbox即タスク化を拡張。サーバ直spawnせず既存機構活用で安全） |
| 担当 | 林（設計） + dev-logic |
| 詳細 | Keita「稼働していないエージェントを動かして指令を出す、という機能がほしい」。Apollo から、今アイドルなエージェント（roster/agents）を選んで指令（プロンプト/タスク）を出し起動する。Apollo UI に「エージェント選択→指令入力→headless 起動」の導線。技術的には headless claude（`--print --agent <type>`）をサーバから起動、もしくは inbox 経由で autonomous 系に渡す。任意プロンプト実行のセキュリティとプロセス管理に注意。 |
| 関連 | [[project-apollo-dashboard]]（roster/agents/inbox）, `/api/roster`・`/api/inbox`, [[project-autonomous-rin]], MC-85（自律エージェント群・起動機構が重なる）, headless `claude --print --agent` |
| 受け入れ条件（DoD） | (1) Apollo UI でアイドルなエージェントを一覧から選び、指令（プロンプト/タスク）を入力して送信できる。(2) 送信で対象エージェントが headless 起動し、指令を実行する（or inbox 経由で autonomous 系に渡り処理される）。(3) 任意プロンプト実行のセキュリティ境界（認証配下・実行範囲制限）が担保される。(4) 起動したプロセスの状態が Apollo で追える（起動中/完了/失敗）。(5) 390px モバイルで操作できる。 |
| 依存 | MC-85（自律エージェント群）と headless 起動・並行プロセス管理が重なるため統合設計で重複実装を避ける。起動方式（直接 headless 起動 vs inbox 経由）とセキュリティ境界の設計判断が前提＝BLOCKED。 |
| 提言・抜けもれ | (1) セキュリティが最大の論点＝サーバから任意プロンプトで claude を起動＝RCE 相当。必ず既存 token 認証配下、実行は許可エージェント type のホワイトリスト、プロンプト長/頻度制限、ログ監査。(2) プロセス管理: 起動したヘッドレスの PID 追跡・タイムアウト・kill 導線・同時起動上限（共有アカウントで 529 回避、[[project-vultr-second-server]]）。(3) 「アイドル判定」の定義＝roster の最終稼働 mtime か、cron ループ稼働状況か（MC-85 のループ状態と連動）。(4) 起動方式の選択肢を Keita に提示: (a) サーバが直接 `claude --print --agent` を spawn（即時・実装重・セキュリティ責任大）vs (b) inbox.jsonl に instruction 投入して autonomous 系が拾う（既存機構流用・即時性は cron 間隔依存・安全）。MC-85 が複数ループを作るなら (b) が自然。(5) UI chrome 制約（中立丁寧体・CSS 変数・SVG）。(6) MC-85 と設計セットで進めるのが効率的（先に MC-85 の起動基盤を決めてから本件 UI を載せる）。 |
| サブタスク | - [ ] 起動方式を Keita に確認（直接 spawn vs inbox 経由）＝BLOCKED 解除条件<br>- [ ] セキュリティ境界設計（認証・type ホワイトリスト・レート制限・監査ログ）<br>- [ ] アイドル判定ロジック定義（MC-85 のループ状態と連動）<br>- [ ] Apollo UI: エージェント選択→指令入力→起動 導線<br>- [ ] プロセス状態追跡（起動中/完了/失敗・kill 導線・同時起動上限）<br>- [ ] 390px モバイル確認<br>- [ ] restart → test-functional 実機検証 |
| 次アクション | MC-85 の起動基盤設計とセットで、林が起動方式・セキュリティ境界案を作成 → Keita 確認（BLOCKED 解除）→ dev-logic が実装 |
| 更新日 | 2026-05-31 |


### MC-87 — IN_PROGRESS のまま停滞しているタスクの洗い出しと再開

| フィールド | 値 |
|---|---|
| ID | MC-87 |
| タイトル | IN_PROGRESS のまま停滞しているタスクの洗い出しと再開 |
| 優先度 | P1 |
| ステータス | TODO |
| 担当 | task-manager（停滞タスクの洗い出し・棚卸し）→ 各実装エージェント（再開） |
| 詳細 | 【Apollo投入】 止まってる進行中のタスク再開して。全 TASK_TRACKER（logic / cxo-agent / en-chakai / 西丸町）を走査し、IN_PROGRESS のまま長期停滞しているタスクを洗い出して再開する。apollo番人の停滞検知（apollo-task-stall-check.sh、`TASK_STALL_DAYS=3`）と連動させ、3日以上更新の無い IN_PROGRESS を検出→担当へ再アサイン or 状態整理（実は DONE/REVIEW/BLOCKED だったものは正しい状態へ修正）する運用にする。 |
| 受け入れ条件（DoD） | (1) 全 TASK_TRACKER の IN_PROGRESS タスクを棚卸しし、停滞（3日以上 mtime 更新なし等）を一覧化。(2) 各停滞タスクを「再開（担当アサイン→着手）」「状態修正（実態は DONE/REVIEW/BLOCKED）」のいずれかに振り分け、台帳を実態に整合させる。(3) 以後 apollo番人の stall 検知（TASK_STALL_DAYS=3）がティック毎に停滞を拾い task-manager に提言する導線が機能する。 |
| 依存 | apollo番人の停滞検知（[[project-apollo-keeper]] / apollo-task-stall-check.sh）。MC-88（autonomous-rin が status を勝手に書き戻す件）が未解決だと「再開」と「自動巻き戻し」が衝突しうるため、MC-88 と合わせて見る。 |
| 提言・抜けもれ | (1) 「再開」の前に、その IN_PROGRESS が本当に止まっているのか（[[reference-subagent-slow-not-dead]]＝8分未満で死亡判定しない）を見極める。停滞判定は mtime ベースで日単位（TASK_STALL_DAYS=3）。(2) IN_PROGRESS の中には実態 DONE/REVIEW なのに更新漏れのものが混ざる＝まず棚卸しで状態を実態に合わせてから「真に止まっているもの」を再開する（やみくもに全部再着手しない）。(3) これは task-manager の定常運用（棚卸し）そのもの＝単発タスクでなく recurring な点検として apollo番人と共同責任で回す（[[feedback-taskboard-based-execution]]）。(4) 再開時の採番・編集は pull --rebase 後・名指し add（autonomous-rin とのレース回避）。 |
| note | Apollo inbox id `2026-05-31T12-35-36-034Z-c1543d0e`（MC-77 機構で taskId=MC-87・agent=dev-logic 紐付け済み）。ブリーフ #4。2026-06-01 棚卸しで構造化。担当は洗い出し主体を task-manager に修正（dev-logic は再開実装側）。 |
| 進捗（cxo ティック 2026-06-01 林） | cxo スコープ分を実施。本台帳の内部 status 不整合を是正＝詳細セクション MC-60/MC-61/MC-62 が「ステータス: TODO」のまま残っていたが、正本の表行は DONE（git 実態で commit 6362562/f0bfb52・workflows.ts/TaskDetail.tsx/task-links.jsonl 実在を裏取り）。3 箇所を DONE へ整合し、詳細と表行の食い違いを解消（MC-89 で根因になった「同一 ID の status 多重表現」予防にも寄与）。cxo の IN_PROGRESS（MC-85/MC-86=Keita 設計承認待ち BLOCKED、MC-90=調査完了・cron 登録が Keita 承認待ち）は実態と一致＝誤って止まっている停滞・状態取り違えは無し。**残: logic/en-chakai/西丸町 の走査と recurring 滞留検知の配線は別スコープ（MC-90 の apollo-keeper 連携）として継続。** スコープ厳守で他プロジェクト台帳は未読・未編集。 |
| 更新日 | 2026-06-01 |


### MC-88 — autonomous-rin が BLOCKED タスクを TODO に書き戻す疑い（選定ロジックの BLOCKED 誤認）

| フィールド | 値 |
|---|---|
| ID | MC-88 |
| タイトル | autonomous-rin が BLOCKED タスクを TODO に書き戻す疑い（選定ロジックの BLOCKED 誤認） |
| 優先度 | P1 |
| ステータス | DONE（2026-06-01 cxo 自律ティック（林）で検証確定。実装は commit `e154e00`＝(A)(B) worker プロンプト＋物理ガード（`~/cron-scripts/autonomous-worker.sh`：他タスクの BLOCKED 行を ID 非依存で HEAD から復元する決定的 python ガード L215-293／`SELECTED_TASK_ID` キャプチャ L212／鉄則 L163・L168）＝リポ外ローカルスクリプトで即時有効（本ティック自身がこの強化版プロンプト下で走行＝live 反映を実証）。(C/D) collector status 正本一本化は `server/src/collectors/tasks.ts` の `inNonTaskTable`（非タスク表を行ごと除外）で実装。**当ティックで実ファイル＋git 裏取りし独立に再検証 green**: `git log` に e154e00 在・ガード実コード実在・`tsc --noEmit` EXIT0・`tasks.summaryTable` 3/3・`approvals.decision` 9/9・`tasks.normStatus` 回帰 31/31。DoD（原因特定＝a58c147 の reconcile 上書き／修正＝ガード＋正本一本化／再現確認＝ガード単体検証①〜④＋本ティック green）充足。[[feedback-review-agent-verify-then-done]] によりエージェント検証で DONE 化（Keita 実機確認不要）。**collector のライブ反映には cxo-agent server（mission-control.service）restart が必要＝Keita 承認待ち（restart まで Apollo live は未変化）。push も Keita 承認領域（NO_PUSH）。** MC-89／MC-88-MC-89 共通行と同根・同 commit で対処済み。） |
| 担当 | dev-logic（autonomous-rin.sh / プロンプトの選定ロジック点検） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 影響 | 台帳が静かに汚れ、Keita ゲート（承認待ち・設計判断・BLOCKED）のタスクが誤って着手対象に見える事故につながる。ボードの信頼性に直結。 |
| 詳細 | autonomous-rin.sh とそのプロンプトの (a) 台帳編集指示、(b) 着手可能タスクの選定判定ロジックを点検し、BLOCKED/Keita 承認待ち/設計判断タグを持つタスクのステータスを書き換える経路を特定する。プロンプト側で「該当タグのステータスは保持し、書き換えない」を明示する／選定判定で BLOCKED を正しく除外できているか確認する。 |
| DoD | autonomous-rin が BLOCKED／Keita 承認待ち／設計判断タグのタスクのステータスを書き換えないことを確認。原因（プロンプトの台帳編集指示 or 選定判定）を特定し修正。修正後、BLOCKED タスクが TODO に書き戻されないことを再現確認（ログ or 試走で検証）。 |
| 関連 | `/home/dev/cron-scripts/autonomous-rin.sh`、project-autonomous-rin（選定基準＝「設計判断」「Keita承認待ち」タグは触らない）、AM-O（観測対象・logic TASK_TRACKER）、HEAD `8925c39`（BLOCKED 復元コミット） |
| 根因確定（2026-06-01 夜目 read-only 調査） | **犯人 commit＝`a58c147`（logic、Author/Committer=Keita Urano、メッセージは「docs(AF-06): バンドルサイズ計測…」）。これが DF-F4・T-U・AM-N の3行を BLOCKED→TODO に倒した張本人。** 証拠: `git log -L 424,424:docs/TASK_TRACKER.md` で DF-F4 サマリ表行の遷移を直引きし、直前 `9b9cc33`（task-manager のリコンサイル＝BLOCKED 付与）の出力を `a58c147` が `-BLOCKED…/+TODO` で上書きしているのを確認。同 commit の diff に AM-N 行・T-U 行も同じ BLOCKED→TODO が含まれる（`git show a58c147 -- docs/TASK_TRACKER.md` で3行同時）。**a58c147 の親は 9b9cc33（`git merge-base --is-ancestor` で確認）＝stale base 由来ではなく、正しい BLOCKED 状態の上に古い TODO 文字列を能動的に書き戻している。** 機構＝autonomous-rin の logic ティック。`~/logs/autonomous-rin.log:1788-1797` の `[2026-06-01 11:20:01〜11:30:01]` ティックが「選んだタスク=AF-06」「push 成功（9b9cc33→a58c147）」と明記。AF-06 のために台帳の AF-06 行だけ BLOCKED に直すつもりが、サマリ表全体を旧 in-memory コピー（9b9cc33 を読み込む前の像）から再生成して上書きし、9b9cc33 が直した DF-F4/T-U/AM-N の BLOCKED を巻き戻した（＝reconcile 衝突の上書き）。9b9cc33（11:17:00）はティックログに無く、ティック間ギャップで打たれた task-manager/対話セッションの手動 commit。**worker プロンプトの欠陥行（`~/cron-scripts/autonomous-worker.sh`）**: ①L162「台帳と git 実態にズレがあれば先に台帳を正す」＝reconcile を許可しているが status 保全の制約が無い。②L166「『設計判断』『Keita承認待ち』タグが付いていない（これらは触らない）」は“選定対象から外す”ルールであって“BLOCKED 行のテキストを書き換えない”ガードになっていない。AF-06 着手の副作用でサマリ表を書き換える経路を塞いでいない。③着手中タスク以外の行を編集しない、という制約自体が無い（1ティック1タスクは選定の話で、ファイル編集範囲を縛っていない）。さらに同根のフラッピング＝MC-89 と共通: logic 台帳に DF-F4/T-U/AM-N とは別の「判断反映サマリ表」（`logic/docs/TASK_TRACKER.md:2937`〜、列＝タスク/旧状態/新状態/反映内容）に T-U 行（`:2942` 2列目 DONE・3列目 BLOCKED…）と AM-N 行（`:2940` 2列目 BLOCKED・3列目 TODO（unblock））が重複存在し、cxo collector `tasks.ts` の seen 重複採用＋mergeStatus でこちらの TODO/旧状態列を拾うと Apollo live でも TODO に揺れる。**修正方針（dev-logic 行き、MC-89 と束ねる）**: (A) worker プロンプトに「着手中タスク以外の行の status セルを書き換えない」「BLOCKED/Keita承認待ち/設計判断の行はテキストごと保持＝reconcile でも status を勝手に変えない（status を動かすのは task-manager の明示作業のみ）」を鉄則として追記（L162 と L166 の強化）。(B) reconcile は status を“確定方向のみ・かつ自分の着手タスクに限定”し、他 ID の行は触らない。(C) collector の重複行対策＝同一 ID は「サマリ表（status 列）を唯一の正本」とし、判断反映サマリ等の別表/別列を status ソースにしない（MC-89 の (A) decided ID 除外＋(B) 多重表現正規化と同一施策で一括）。(D) 共有 TASK_TRACKER への並行書き込みに flock or 楽観ロック+read-back を入れ、9b9cc33↔a58c147 のような reconcile 上書きレースを構造的に防ぐ。MC-89 と (B)(C)(D) は完全に同根＝1本の PR で束ねられる。本調査は read-only、台帳 status・worker・本番コードは未変更。 |
| コード実装済（2026-06-01 dev-logic 蓮、restart/push 待ち） | 夜目の根因確定どおり修正実装＝ローカル commit まで。**(A) worker プロンプト強化**（`~/cron-scripts/autonomous-worker.sh`、リポ外ローカル運用スクリプト・`.bak.20260601-121443` 退避済）: 手順2に「台帳編集は自分の着手タスク1行のみ。他タスク・特に BLOCKED/Keita承認待ち/設計判断の行の status は書き換えない。サマリ表を記憶から丸ごと再生成して上書き禁止（a58c147 の事故そのもの）」を鉄則として明記。選定基準に「`SELECTED_TASK_ID: <ID>` を1行出力」を追加。鉄則欄に「他タスクの BLOCKED 行 status 書き換え厳禁（reconcile でも）」を追記。**(B) commit 直前の物理ガード**（LLM 遵守に依存しない決定的 bash＋python3 チェック）: claude 実行後、tick 終了前に TASK_TRACKER の `git diff` を取り、「HEAD で `\| <ID> \| … \| BLOCKED … \|` だったテーブル行が作業ツリーで BLOCKED でなくなっていたら、その行を HEAD の内容に復元」する。ID 非依存で BLOCKED 行を一律保全＝着手タスク自身を BLOCKED にすることは稀なので巻き戻し阻止を最優先（指示の単純案を採用）。復元したら追い commit で live を正す。DRY_RUN では復元のみ・commit せず（既存 push shim と整合）。**検証**: ①ダミー diff（DF-F4 BLOCKED→TODO の巻き戻し＋AF-06 着手 TODO→DONE 正当前進＋T-U の担当列のみ正当変更）で、DF-F4 だけ BLOCKED 復元・AF-06 DONE 保持・T-U の他列編集保持を確認。②3行同時巻き戻し（DF-F4/T-U/AM-N）→全復元、無変更 DONE 行は保持、同一ファイルは GUARD_RESTORED 出さず。③実 git リポで `TRACKER_REPO/REL` 解決→`git diff --quiet` 検出→`HEAD:` 取得→復元の一連が通ることを確認。④`bash -n` 構文 OK。**(C/D) collector 修正は MC-89 側に集約**（同根1本）。**残＝Apollo restart と push 承認**: worker はローカルスクリプトなので即時有効だが、logic ループ再開は林がクリーンに行う（kill-switch `~/.autonomous-logic.disabled` 停止中）。collector は cxo-agent server restart 後に live 反映（restart は作業ツリー安定後に林が実施）。push は Keita 承認領域。 |
| 更新日 | 2026-06-01 |


### MC-88/MC-89 共通 — collector status 正本一本化（夜目方針(B)、MC-88 と束ねた1本）

| フィールド | 値 |
|---|---|
| 対象 | MC-88 機序③＋MC-89 機序②（同一 ID の別表現/別表から status が揺れる構造）の collector 側修正 |
| ステータス | コード実装済（2026-06-01 dev-logic 蓮）・restart 待ち（cxo-agent server restart で live 反映） |
| 実装 | `cxo-agent/server/src/collectors/tasks.ts` の `parseTrackerString` を「status の正本＝正準サマリ表（ID 列見出しが `ID` の表）の status 列」に一本化。**(1) 非タスク表の行ごと除外**: ID 列見出しが `ID` でない別表（`\| タスク \| 旧状態 \| 新状態 \| 反映内容 \|` ＝判断反映サマリ等）を `inNonTaskTable` フラグで検出し、その表の行を一切 task 化しない。これで「別表の旧/新状態列を status ソースに誤採用してフラッピング」を**表の出現順に依存せず決定的に**塞ぐ（旧実装は seen 先勝ちで別表をスキップしていたが、正準表が必ず先という順序前提に依存し脆かった＝夜目機序②の seen 揺れの根本）。判定＝1列目が `タスク/task/項目/対象/名称` かつ他セルに `旧状態/新状態/変更前/変更後/遷移/反映内容/before/after` を含む。 |
| MC-89 既存対策との重複回避 | MC-89 DONE（commit `3bc0139`）は **approvals.ts の (A) decided ID 除外**＝承認キュー算出の冪等化（承認系専用の二重防御レイヤー）。本修正は **tasks collector の status 正本化(B)**＝別レイヤーで重複なし。夜目調査(L1290)が「(B) 同一 ID 多重表現の正規化は別途」と明記した未実装部分を埋めるもの。approvals 系の APPROVAL_TAG_WORDS / 決定ログ除外には一切手を入れていない。 |
| 検証 | 改修後 collector で実台帳 logic/TASK_TRACKER を再パース＝DF-F4/T-U/AM-N は現状値（再リコンサイル前なので全 TODO）で安定、重複 ID なし、同一入力の2回パースが一致（決定的）。再リコンサイル後を模し正準表を BLOCKED 化＋別表残置→3件とも BLOCKED 保持（別表の TODO に巻き戻されない）。別表を正準表より前に置いた破綻順序＝改修前は UNKNOWN に倒れたが改修後は正準表の値（REVIEW/DONE）を保持。回帰テスト `tasks.summaryTable.test.ts` 新設（3 case group＋実台帳決定性チェック、全 pass）。server `tsc --noEmit` 0 errors、既存 `normStatus` 31/31 維持。 |
| 残 | cxo-agent server（mission-control.service）restart で live 反映＝作業ツリー安定後に林がクリーンに実施（reference-apollo-restart-stale-routes の教訓）。push は Keita 承認領域。 |
| 更新日 | 2026-06-01 |


### MC-89 — 承認ビューで承認済み項目が何度も承認キューに再出現する不具合

| フィールド | 値 |
|---|---|
| ID | MC-89 |
| タイトル | Apollo 承認ビューで承認済み項目が何度も承認キューに再出現する不具合 |
| 優先度 | P1 |
| ステータス | DONE（2026-06-01 林ティック。方針A実装＝approvals collector の冪等化を「最新決定が approve の id+source は status 不問で承認キューから除外」へ強化し永久ループを根治。buildDecidedStatus→buildLatestDecisions(decision保持)＋純粋関数 isSuppressedByDecision に切出し、collectApprovals の抑止判定を置換。単体テスト approvals.decision.test.ts 追加。server tsc EXIT0 / approvals 9/9 / normStatus 回帰 31/31 green。reviewer 独立検証 pass（非破壊・誤抑止/誤再浮上なし）。ローカル commit `3bc0139`。**本番反映には mission-control.service の restart が必要＝Keita 承認待ち（restart まで実挙動は未変化）。** (B) logic台帳 AM-O 二重行集約は他プロジェクト台帳ゆえ本ティックのスコープ外で別途〔夜目調査参照〕） |
| 担当 | apollo番人（実機調査）→ dev-logic（collector / 承認書き戻しの修正） |
| 詳細 | 【Apollo投入】 承認しても何度も出てくる。承認ビュー（GET /api/approvals、MC-79/MC-68）で一度承認した項目が、また承認待ちキューに湧いてくる。承認1タップで決定は `toStatus:"TODO"` を書こうとしているが、実 TASK_TRACKER 側の status が `approve` のまま残り、collector が再び pending（承認待ち）として拾い直している疑い。 |
| 背景・裏取り（決定的証拠） | `cxo-agent/data/approval-decisions.jsonl` を突合したところ、同一 ID が複数回 approve 記録されている＝承認しても消えず再出現している直接証拠: ・AM-O が **5回** approve（2026-05-31 12:16 / 12:28 / 12:54 / 20:03、2026-06-01 00:20）。・DF-F13 / DF-F3 / FB-05 が **各2回**（5/31 10:22-24 に1回 → 同 20:03 に再出現で再承認 → さらに 6/01 00:20 にまた再承認）。すべて `fromStatus:"approve" → toStatus:"TODO"` を書こうとしているのに、次のティックでまた `approve` 扱いで承認キューに現れている。MC-88（autonomous-rin が BLOCKED→TODO 書き戻し疑い）と status 書き戻しのレース／不整合という点で根が近い可能性。 |
| 仮説（要検証） | (1) 承認決定の TASK_TRACKER 書き戻し（MC-71 の md 書き戻し層）が実際には status を `approve`→`TODO` に反映できていない（楽観ロック失敗・read-back 不一致・該当行マッチ漏れ・autonomous-rin/他プロセスとの編集レースで上書き巻き戻し）。(2) collector（tasks.ts / approvals 抽出）が status 文字列 `approve` を承認待ちと判定しており、書き戻しが効かない限り毎ティック再 pending 化する。(3) approval-decisions.jsonl は「決定ログ」として追記されるだけで、それ自体は承認キューから除外する根拠に使われていない（＝決定済み ID を queue から除外していない）。 |
| 受け入れ条件（DoD） | (1) 一度承認した項目が承認キューに再出現しないことを再現確認（approval-decisions.jsonl に同一 ID の重複 approve が新規発生しない）。(2) 根因を特定（書き戻し失敗 or collector の再判定 or 決定ログの未活用）。(3) 承認決定が TASK_TRACKER の status に確実に反映され（`approve`→`TODO`）、かつ書き戻しが他プロセスのレースで巻き戻らない。必要なら decided ID を承認キューから除外する二重防御を入れる。(4) 既に多重承認された AM-O/DF-F13/DF-F3/FB-05 の現状 status を正しい値に整える。 |
| 依存 | MC-79（承認フロー実装・DONE）, MC-71（md 安全書き戻し層・DONE）, MC-88（status 書き戻しレースと同根の可能性、合わせて調査）。 |
| 提言・抜けもれ | (1) スクショ証拠あり（下記 attachment）。実機調査時に Read で確認。(2) MC-88（BLOCKED→TODO 誤書き戻し）と同じ「共有 TASK_TRACKER への並行書き込みレース」が真因なら、両者を同一の書き戻し排他機構（flock or 楽観ロック+read-back+リトライ）で一括解決するのが筋。バラバラに対症療法しない。(3) 承認は logic/TASK_TRACKER の項目（AM-O/DF-* は logic 側）を cxo の Apollo から書き戻している＝クロスプロジェクト書き込みのパス・採番直列化・autonomous-rin（logic ループ）との編集レースを点検。(4) 恒久対策として decided ID（approval-decisions.jsonl）を承認キュー算出時に除外する冪等化を入れると、書き戻しが一時的にこけても二重承認は防げる。(5) UI chrome 制約（中立丁寧体・CSS 変数・SVG）は本件 UI 変更時に維持。 |
| スクショ | `cxo-agent/data/inbox-attachments/2026-06-01T00-31-20-092Z-26e61381/3243.png` |
| note | Apollo inbox id `2026-06-01T00-31-20-092Z-26e61381`（MC-77 機構で taskId=MC-89 紐付け済み）。ブリーフ #1。2026-06-01 棚卸しで調査結果を反映。 |
| 実機調査（2026-06-01 apollo番人 夜目） | 根因確定。仮説(1)が真、(2)(3)は反証。**真因＝collector の status 読み取りが揺れて承認後も BLOCKED と読み続け再浮上する。承認の書き戻し自体は機能している（approval-decisions.jsonl の toStatus は常に TODO、editTask は3形式へ書き戻し済）が、collector が「同一 ID の別表現」から status を BLOCKED に上書きしてしまう。** 機序2点: ①`server/src/collectors/tasks.ts:191-195 mergeStatus` ＋ `STATUS_RANK`（TODO=1, BLOCKED=2）＝同一 ID が表行とセクション/別表で複数表現されるとき「ランクが現在以上なら採用」で BLOCKED(2) が TODO(1) を上書きする（確定方向のみ動かす設計が BLOCKED を巻き込む副作用）。②`tasks.ts:407-408 seen` Set は「ファイル内で最初に出た表行」だけ採用＝logic 台帳に AM-O の表行が2本（`logic/docs/TASK_TRACKER.md:1011` status=TODO ＝現役ボード／`:2867` 2列目に "BLOCKED" ＝別バッチの旧表現）あり、autonomous-rin/dev-logic の頻繁な編集で出現順が揺れると BLOCKED 行を採る瞬間が出る。BLOCKED と読まれた瞬間に `collectors/approvals.ts:79` の `status==='BLOCKED' && needsKeita` で blocked カテゴリ再浮上→承認→表行 TODO 化→しかし旧表現の BLOCKED 記述は editTask の status セル置換で消えない（散文/別ヘッダ列のため）→次ティックでまた BLOCKED。永久ループ。実証: 現時点では4件とも collector status=TODO・承認キュー非再浮上（collectApprovals total=2 で AM-O/DF-* 不在）だが、これは出現順がたまたま TODO 寄りなだけで構造的に不安定。`approvals.ts:104-150 buildDecidedStatus` の冪等化（decided toStatus と現在 status 一致なら抑止）は status=TODO 一致時のみ効き、BLOCKED に揺れた瞬間に外れる＝現状の防御は status の揺れに無力。修正方針＝(A) **冪等化を status 不問の「decided ID 除外」に強化**: approval-decisions.jsonl に decision:approve がある id+source は、現在 status に関係なく承認キューから除外する（DF-* のように再度本当に差し戻したい時は reject か新規 BLOCKED 起票で明示）。これが最小・確実な対症かつ恒久（dev-logic）。(B) **同一 ID 多重表現の正規化**: logic 台帳の AM-O 二重表行（`:2867` 旧表現）を1本へ集約し、mergeStatus が BLOCKED を拾わないよう「表行＝唯一の status 正本」にする（content/dev-logic、台帳整理）。(C) mergeStatus を「DONE/CANCELLED へのみ前進、BLOCKED は表行が明示時のみ」に限定する案も可だが副作用大きいので (A)+(B) を推奨。MC-88 との統合: MC-88 も「同一台帳の status を別プロセスが書き戻す/別表現が競合する」同根＝(B) の多重表現正規化＋編集排他（flock）で一括対処できる。決定ログ除外(A)は承認系専用の二重防御として併設。担当=dev-logic（approvals.ts の除外ロジック強化）＋content/task-manager（logic 台帳の AM-O 二重行集約）。本番コードは未変更（調査のみ）。 |
| 更新日 | 2026-06-01 |

---

## バッチ: 2026-06-01 Apollo inbox 棚卸し（未消化検出・バグ確定）

> 2026-06-01 の Apollo inbox（cxo-agent/data/inbox.jsonl 全17件）の consumed 突合で、未消化が滞留していることを検出。調査で根因（cxo スコープの自律ループが cron 未登録＝inbox が誰にも消費されない）を確定し MC-90 を起票。inbox 由来の他3件（承認再湧き／タスク詳細記載／停滞タスク再開）は MC-77 の inbox 即タスク化機構により既に taskId 紐付き済み（MC-89 / MC-82 / MC-87）で、本棚卸しでは新規採番せず既存スタブを調査結果で充実させた（重複起票回避）。

### MC-90 — Apollo inbox が誰にも消費されず滞留（cxo スコープの自律ループが cron 未登録）

| フィールド | 値 |
|---|---|
| ID | MC-90 |
| タイトル | Apollo inbox（inbox.jsonl）が誰にも消費されず滞留する不具合（cxo 自律ループが kill-switch で停止していた／実態訂正は note 参照） |
| 優先度 | P1 |
| ステータス | DONE |
| 担当 | apollo番人（実機調査・根因確定）→ dev-logic（cron 登録 or HANDLE_INBOX 結線の修正） |
| 背景 | 2026-06-01 の inbox 棚卸しで `cxo-agent/data/inbox.jsonl` 全17件が `status:"pending"`、`inbox-consumed.jsonl` の最終更新が 2026-05-31 19:52 で止まっていることを検出。誰も inbox を消費していない。 |
| 根因（裏取り済み） | 記憶 [[project-autonomous-rin]] では「ティック冒頭で inbox を最優先消費」とあるが、実装は MC-85 で `autonomous-worker.sh` に一般化され、inbox 消費は `HANDLE_INBOX=1`（worker line 44-58/120-126）でガードされ **PROJECT_SCOPE=cxo のときだけ** 動く。ところが cron に登録されているのは `*/10 * * * * autonomous-rin.sh`（PROJECT_SCOPE=logic 固定ラッパ、`HANDLE_INBOX=0`）の **logic スコープ1本だけ**。cxo スコープのループ（`PROJECT_SCOPE=cxo bash autonomous-worker.sh`、唯一 inbox を処理する経路）は cron にもどこにも登録されていない。よって inbox を消費する主体が一度も走らず、pending が滞留している。※ブリーフの「autonomous-rin.sh に inbox 処理コードが一切無い」は半分正しく半分不正確: コード自体は worker 側に在るが、それを呼ぶ cxo スコープのスケジュールが無い、が正確な根因。 |
| 詳細 | (1) cxo スコープの autonomous ループ（`PROJECT_SCOPE=cxo bash autonomous-worker.sh`）を flock・kill-switch・時刻ずらし付きで cron 登録し、inbox を定期消費させる（MC-85 のプロジェクト別並行ループ設計に沿う）。(2) または logic ラッパでも inbox を処理させたい場合は HANDLE_INBOX の結線方針を Keita/林と確認（ただし inbox 消費を logic ティックに混ぜると責務が混ざるため、cxo 専用ループを足す案が素直）。(3) 既存滞留17件は手動 or 初回ティックで消化（taskId 紐付き済みのものは inbox-consumed に落とすだけ、未紐付けは起票）。 |
| 受け入れ条件（DoD） | (1) inbox を消費する自律ループ（cxo スコープ）が定期実行され、`status:"pending"` の inbox エントリが処理→`inbox-consumed.jsonl` 追記される導線が成立する。(2) 既存17件の pending が解消（消費済み or 起票済み）。(3) 同時実行ガード（flock）と既存 logic ループとの時刻ずらし・採番直列化が効き、二重 push/競合が起きない。(4) 再発防止: inbox に pending が一定期間（例 N 時間）残ったら apollo番人/監視が検知できる（滞留アラート）。 |
| 依存 | MC-85（プロジェクト別並行 autonomous ループの設計／cxo 専用ループ追加はこの設計に含まれる）。MC-85 が cxo ループを cron 化するなら本件はその一部として解消し得るので、統合して二重実装を避ける。 |
| 提言・抜けもれ | (1) MC-85 と機構が完全に重なる（cxo スコープのループを cron 化＝MC-85 の「cxo(Apollo)専用を独立 cron で並行」そのもの）。本件は MC-85 の cxo ループ未登録という具体的バグの顕在化なので、MC-85 のサブ issue として進めるのが効率的。(2) cron 追加時は flock（`/tmp/autonomous-cxo.lock` 等）・kill-switch・logic ループと時刻ずらし・採番直列化（next-task-id.sh、[[reference-task-id-numbering]]）必須。共有 Anthropic アカウントの同時 LLM 起動で 529 を誘発しないよう同時実行上限も（[[project-vultr-second-server]]）。(3) inbox 消費が走り出すと未起票エントリを自動タスク化するため、採番衝突・DoD 空タスク量産に注意（MC-77 提言と同根）。(4) 記憶 [[project-autonomous-rin]] の「ティック冒頭 inbox 最優先消費」は現実装とズレているので、修正後に memory を実態へ更新する。(5) 再発検知（pending 滞留アラート）を apollo-keeper の点検範囲（[[project-apollo-keeper]]）に足すと恒久対策になる。 |
| サブタスク | - [ ] apollo番人: cron・worker・inbox の実機調査で根因（cxo ループ未登録）を最終確認<br>- [ ] cxo スコープ autonomous ループの cron 登録（flock・kill-switch・時刻ずらし）— MC-85 と統合<br>- [ ] 既存17件 pending の消化（紐付き済→consumed、未起票→起票）<br>- [ ] pending 滞留検知を apollo-keeper の点検に追加<br>- [ ] memory [[project-autonomous-rin]] を現実装に合わせて更新 |
| 関連 | `/home/dev/cron-scripts/autonomous-rin.sh`（logic ラッパ）, `/home/dev/cron-scripts/autonomous-worker.sh`（HANDLE_INBOX gate: line 44-58/120-126）, `cxo-agent/data/inbox.jsonl`（17件 pending）, `cxo-agent/data/inbox-consumed.jsonl`（最終 2026-05-31 19:52）, dev crontab（logic ループ1本のみ）, [[project-autonomous-rin]], [[project-apollo-keeper]], MC-85（cxo 並行ループ） |
| note | 林の inbox 棚卸し調査由来（inbox エントリではない＝元 inbox id なし）。ブリーフ #2。 |
| 実機調査（2026-06-01 apollo番人 夜目） | 根因を実機で最終確認＝task-manager の診断どおり。(1) `crontab -l`（dev）の autonomous 系は `*/10 * * * * autonomous-rin.sh` の **1本のみ**。`autonomous-rin.sh:21` は `exec env PROJECT_SCOPE=logic bash autonomous-worker.sh` ＝logic 固定ラッパ。(2) `autonomous-worker.sh:39-58` のスコープ分岐で logic は `HANDLE_INBOX=0`（line 44、コメント「Apollo 受信箱は cxo スコープが処理する」）、cxo のみ `HANDLE_INBOX=1`（line 51）。inbox 消費手順（INBOX_STEP）は `worker:121` の `if [ "$HANDLE_INBOX" = "1" ]` ガード内でのみプロンプト注入される。(3) `PROJECT_SCOPE=cxo bash autonomous-worker.sh` を起動する cron は**どこにも未登録**＝inbox を消費する経路が一度も走らない。実データ突合（grep -o で堅く抽出）: inbox.jsonl 17件中 **未消化4件**（task-manager は3件としたが実測4件: `b42bcf27`=__SMOKE__ノイズ／`3ea08292`=タスク詳細記載=MC-82／`c1543d0e`=停滞再開=MC-87／`26e61381`=承認再湧き=MC-89）。inbox-consumed.jsonl の論理最終消費=5/31 13:45、ファイル mtime=5/31 19:52 で停止。一方 inbox.jsonl mtime=6/01 09:31 で新規投入は継続＝消費側だけ止まっている確証。**修正方針＝cxo ループの cron 登録が筋**（logic ティックに inbox 処理を混ぜると責務が混ざる＋logic 優先方針と衝突するため非推奨）: `*/15 * * * * PROJECT_SCOPE=cxo bash autonomous-worker.sh`（logic の `*/10` と時刻ずらし）。worker 側に flock `/tmp/autonomous-cxo.lock`・kill-switch `~/.autonomous-cxo.disabled`・DRY_RUN は既装備（`worker:66/68/103`）なのでスクリプト改修不要、cron 1行追加のみで成立。共有 Anthropic アカウントの同時 LLM 起動で 529 回避のため logic と分単位でずらす（[[project-vultr-second-server]]）。再発防止＝apollo-keeper 点検に「inbox.jsonl に pending が N 時間（例3h）残存 or consumed mtime が inbox mtime より一定以上古い」を検知条件として追加（DoD(4) 既記、`apollo-keeper.sh` の点検範囲拡張＝dev-logic 軽改修）。既存4件のうち3件は taskId 紐付け済みなので consumed 追記のみ、SMOKE 1件は破棄でよい。担当=dev-logic（cron 行追加＝Keita 承認領域なので案提示まで／apollo-keeper 滞留検知追加）。crontab 編集・cron 登録は Keita 承認後に実施（本調査では未実施）。 |
| 実態訂正（2026-06-01 林・実機確認） | 本カードの「根因（裏取り済み）」行および旧タイトルにある「cxo スコープのループが **cron 未登録**」という前提は**誤り**。林の実機確認で判明した正しい実態＝**cron は既に登録済み**。`*/15 * * * * autonomous-cxo.sh` が存在し、`autonomous-cxo.sh` は `PROJECT_SCOPE=cxo NO_PUSH=1` で `autonomous-worker.sh` を呼ぶ正規ラッパで `HANDLE_INBOX=1`（Apollo 受信箱を処理する経路）。inbox を消費する主体は cron に在った。**真の停止理由＝kill-switch `~/.autonomous-cxo.disabled` が置かれており、毎ティック「kill-switch で停止 → skip」になっていた**（apollo番人の旧調査が見た「cxo ループ未登録」は、当時の crontab 状態か別ラッパを見た誤認で、現状の正は autonomous-cxo.sh の */15 登録）。 |
| 解消（2026-06-01 Keita 承認・DONE 化） | 2026-06-01 Keita 承認のもと、林が `rm ~/.autonomous-cxo.disabled` で kill-switch を解除＝cxo 自律ループを有効化。次の */15 ティックから cxo スコープが稼働し Apollo inbox を消費する＝inbox 滞留の根治。`NO_PUSH=1` ガードは維持（cxo スコープは push/deploy をせず、ローカル commit までで Apollo に即反映。push は Keita 承認領域）。DoD 充足: (1) inbox を消費する自律ループ（cxo スコープ）が */15 で定期実行され pending→consumed の導線が成立（kill-switch 解除で有効化）、(3) flock・時刻ずらし・NO_PUSH ガードで二重 push/競合なし、(4) 滞留検知（`inbox-stalled` アラート）は前ティックで実装済み（commit `a9c9b1a`）。(2) の既存 pending は稼働再開後のティックで消化（紐付き済→consumed、SMOKE は破棄）。[[feedback-review-agent-verify-then-done]] でエージェント検証により DONE 化。関連 [[project-autonomous-rin]]（記憶「ティック冒頭 inbox 最優先消費」は worker 一般化後の実態に合わせ別途更新）。関連調査 MC-88（autonomous が BLOCKED を TODO に書き戻す疑い・別タスク・本件では触らない）。 |
| 進捗（cxo ティック 2026-06-01 林） | DoD(4)「pending 滞留検知（滞留アラート）」を in-repo で実装＝ローカル commit `a9c9b1a`。Apollo の既存 alerts collector に新カテゴリ `inbox-stalled` を追加し、受信箱を消費する自律ループが止まると未消化 pending の滞留を監視（/api/alerts → 司令塔 AlertBanner）で検知できるようにした。`server/src/collectors/alerts.ts` に純粋関数 `evaluateInboxStall`（未消化抽出→`__SMOKE` 除外→最古経過 > `INBOX_STALL_HOURS`(config default 3h) で1件に集約 warning、ts 不正は「長期間」表現、throw 握り潰し）＋ collector ラッパを新設し `collectAlerts` に結線。`config.ts` に `INBOX_STALL_HOURS`、`inbox.ts` の `readInboxEntries` を export 化（非破壊）、`web/src/lib/types.ts` の `AlertsResponse`（byCategory/thresholds）を server とミラー（AlertBanner は汎用反復ゆえ UI 非破壊）。単体テスト `alerts.inboxStalled.test.ts` 7/7 pass を林が自己裏取り＋reviewer（関）独立検証 pass（境界・throw 無し・型ミラー・中立文言/CSS 変数/SVG 制約遵守、issues 0）。server `tsc --noEmit` EXIT0／web build EXIT0。**残＝cxo 自律ループの cron 登録は Keita 承認領域（未実施）。本コミットは検知のみで、cron 登録までが本タスクの DoD(1)(3)。collector は cxo-agent server restart で live 反映＝Keita 承認待ち。** スコープ厳守で他プロジェクト台帳・本番コード restart/push は未実施。 |
| 更新日 | 2026-06-01 |

---

## バッチ: 2026-06-01 Apollo Web ターミナル（林との同期・双方向対話をブラウザから）

> Keita 指示（2026-06-01）「このターミナルでできるのと同じこと（林との対話）を Apollo 上でやりたい。方向は A: Web ターミナル（最速）」。Vultr 箱の tmux `main` に常駐する林 CLI セッションを、Apollo 経由でブラウザ（スマホ含む）から同期・双方向にフル操作できるようにする。受信箱（非同期・片方向）に対する同期・双方向版。

### MC-92 — Apollo に Web ターミナル（tmux の林セッションをブラウザ操作）を追加

| フィールド | 値 |
|---|---|
| ID | MC-92 |
| タイトル | Apollo に Web ターミナル（tmux の林セッションをブラウザ操作）を追加 |
| 優先度 | P1 |
| ステータス | DONE |
| 担当 | dev-logic（Apollo proxy / nav / モバイルレイアウト実装）＋ apollo番人（ttyd / cloudflared / Cloudflare Access 等インフラ・セキュリティ設定。sudo を伴うインフラ作業は権限境界に従い案提示＋Keita 承認後実施） |
| 目的 | Keita がこのターミナル（Vultr 箱で tmux `main` に常駐する林 CLI セッション）と同じ対話操作を、Apollo 経由でブラウザ（スマホ含む）からできるようにする。Apollo 受信箱（非同期・片方向）に対し、これは**同期・双方向のフル操作**。 |
| 実装方針（A: 最速・安全） | (1) `ttyd` を箱に導入し `tmux attach -t main`（林セッション）を映す。**localhost バインド固定**（外に直接公開しない）。(2) 認証2段: (a) ttyd 自体に強いクレデンシャル、(b) localhost のみ→Apollo サーバが `/terminal`（仮）で reverse proxy し、Apollo 既存のトークン/Cookie 認証の後ろに置く。トンネルは既存 cloudflared を再利用。さらに堅くするなら Cloudflare Access（keita.urano@gmail.com 限定）を上乗せ可（オプション）。(3) Apollo web にナビ項目「ターミナル」を追加し、認証済みでワンタップで開ける。モバイルレイアウト対応。 |
| セキュリティ要件（DoD に必須） | (1) **素の ttyd を無認証で外部公開しない。必ず Apollo 認証 or Cloudflare Access の後ろ**。(2) フルシェル＝箱の全権限が取れる前提で、認証強度・バインド範囲・トンネル経路を設計する。(3) 操作は林の tmux と共有（Keita 入力がそのまま林セッションに入る）。**読み取り専用でなくフル操作である旨を仕様に明記**。(4) MC_TOKEN や認証情報をコード/リポ本体に直書きしない（`.mc.env` 等の env 参照）。 |
| 受け入れ条件（DoD） | (1) Apollo の「ターミナル」から、認証を通った上で tmux 林セッションを操作できる。(2) スマホブラウザでも実用的に打鍵・閲覧できる（モバイルレイアウト対応）。(3) **無認証アクセスが不可能なことを検証**（直 URL・トンネル経路ともに Apollo 認証 or Cloudflare Access を通らないと到達できない）。(4) ttyd は localhost バインドで、外部から ttyd ポートへ直接到達できないことを確認。(5) フル操作（読み書き両方）であることが動作確認できる。 |
| 依存 | **MC-88（台帳 status 書き戻しレース／collector フラッピング修正）・MC-89（承認再湧き修正）の後に着手**。cxo リポが dev-logic の MC-88/89 修正と autonomous-cxo ループで競合中のため、それらが片付き cxo リポが落ち着いてから着手する（リポ競合回避）。 |
| 提言・抜けもれ | (1) ttyd 導入は **sudo を伴うインフラ作業**＝apollo番人の権限境界で「案提示まで／Keita 承認後実施」（[[project-apollo-keeper]]）。(2) **Cloudflare Access の適用には Cloudflare 側のダッシュボード設定が必要**で、その場合 Keita の操作が一部要る（Application 作成・keita.urano@gmail.com の policy 設定）。オプション扱いだが、フルシェル公開のリスクを考えると強く推奨。(3) Apollo サーバは `tsx src/index.ts`（watch 無し）起動なので `/terminal` proxy 追加は `sudo systemctl restart apollo.service`（旧名 mission-control.service）で反映、web ナビ追加は `cd web && npm run build`（[[project-apollo-dashboard]]）。生 tsx 起動は禁止。(4) tmux 共有セッションを複数クライアントが attach すると画面サイズが最小クライアントに同期される（tmux 仕様）。スマホ＋PC 同時 attach 時の見え方を検証。専有したい場合は `tmux new-session -t main`（grouped session）で別ウィンドウサイズを持たせる選択肢も検討。(5) フルシェル＝箱の全権限が漏れると致命的（git push / deploy / 鍵アクセスが全部できてしまう）。認証強度は最優先。ttyd の `--credential` だけに頼らず Apollo 認証 or Cloudflare Access を必須の前段に置く（多層防御）。(6) 林セッションが session-cleanup や reboot で落ちている場合の挙動（attach 先が無い）も UX として考慮（再起動導線 or エラー表示）。(7) UI chrome 制約（中立丁寧体・CSS 変数・ハードコード hex 禁止・emoji 不可で SVG のみ）はナビ項目「ターミナル」追加時に維持（[[feedback-app-copy-neutral]]）。 |
| サブタスク | - [x] ttyd 導入（localhost バインド・強クレデンシャル）＝apt `ttyd 1.7.4`。distro 既定 `ttyd.service`（無認証 `-i lo -O login`）を `disable --now` で停止し、自前 `apollo-terminal.service`（`-i 127.0.0.1 -p 7681 -W --credential <強ランダム> tmux new-session -A -s main`）に置換。credential は repo 外 `.terminal.env`（chmod 600・.gitignore）<br>- [x] Apollo サーバに `/terminal` reverse proxy 追加（`server/src/terminalProxy.ts`、makeAuthMiddleware の後ろにマウント。HTTP=`app.use('/terminal', ...)`、WS=`server.on('upgrade')`。WS 経路も `isRequestAuthorized()` で同強度認証。ttyd Basic 認証は proxy が内部付与）<br>- [x] Apollo web にナビ「ターミナル」追加＋モバイル対応（`web/src/views/Terminal.tsx` iframe ホスト、React ルート `/terminal-view`、`TerminalIcon` SVG、`BottomNav` は項目数自動等幅で5項目対応）<br>- [ ] apollo番人: cloudflared 経路の確認（既存トンネル再利用）＝既存トンネルがそのまま `/terminal` を運ぶ（同一オリジン）。別途検証は任意<br>- [ ] （オプション・未実施）Cloudflare Access を keita.urano@gmail.com 限定で上乗せ（手順を note に記載。Cloudflare 側設定は Keita 操作）<br>- [x] 検証（無認証不可・localhost バインド・フル操作・WS 認証）＝下記 note 参照 |
| 関連 | Apollo server（`server/src/index.ts:64-71` proxy マウント・`:457-465` upgrade、`server/src/terminalProxy.ts`、`server/src/lib/auth.ts:150-208` isRequestAuthorized、`.mc.env` の MC_TOKEN）, Apollo web（`web/src/App.tsx`・`web/src/views/Terminal.tsx`・`web/src/components/icons.tsx` TerminalIcon）, `deploy/apollo-terminal.service`（ttyd unit）, `deploy/apollo.service`（.terminal.env 注入追記）, `.terminal.env`（credential・repo外）, ttyd 1.7.4, tmux `main`, [[project-apollo-dashboard]], [[project-apollo-keeper]], [[project-vultr-second-server]] |
| note | Keita 指示由来（2026-06-01・方向 A）。**2026-06-01 dev-logic 実装完了・restart 済・live。** 認証は Apollo 認証の後ろ（Cloudflare Access は後乗せ可・未実施）。green: server tsc 0 / web build 成功 / apollo healthz 200。検証（127.0.0.1:4317 実コマンド）: (a) 未認証 `/terminal/` HTTP=401 JSON（ttyd HTML 非漏洩）・未認証 WS upgrade=401（attachUpgrade で弾く）・誤トークン WS=401。(b) 認証済 Bearer/Cookie/query-token とも HTTP=200（ttyd `<title>ttyd - Terminal</title>`）・WS upgrade=101（ttyd の sec-websocket-accept 返る＝Basic credential 内部付与成功）。フル操作=WS 経由のキー入力で `/tmp` にファイル書込を確認（ttyd CSRF token を /terminal/token から取得し AuthToken に詰めて送信→shell 実行）。(c) ttyd は 127.0.0.1:7681 のみ bind、公開 IP:7681 は接続拒否（000）。ナビ「ターミナル」は web bundle（index-BVlZRKHw.js）served 済。残: cloudflared 経路の明示検証・Cloudflare Access 上乗せ（任意）・複数 attach 時の tmux サイズ最小同期は仕様（提言#4）。**GitHub push は Keita 承認待ち（ローカル commit のみ）。**<br>**2026-06-01 コピペ改善追記（dev-logic 蓮）:** Keita 報告「コピペできない」を切り分け。主因は secure-context（navigator.clipboard は HTTPS か localhost のみ動作。http://IP:4317 直アクセスでは clipboard read API が封じられる）＋ 親ドキュメントの Permissions-Policy 不足の合わせ技。対処: (1) Apollo 全レスポンスに `Permissions-Policy: clipboard-read=(self), clipboard-write=(self)` を付与（`server/src/index.ts` グローバル middleware）＋ /terminal proxy のレスポンスにも `proxy.on('proxyRes')` で明示付与（`server/src/terminalProxy.ts`）＝ iframe の `allow="clipboard-read; clipboard-write"` と整合し clipboard 権限が iframe へ委譲される。(2) ttyd に `-t rightClickSelectsWord=true` 追加（`deploy/apollo-terminal.service`、選択補助でコピー容易化）。(3) Terminal.tsx に「Ctrl+V／うまくいかない時は HTTPS or 新しいタブ」の中立丁寧体の控えめ注記を追加（CSS トークンクラス・emoji 不可）。検証（curl -I）: SPA index.html・/terminal iframe とも Permissions-Policy ヘッダ付与を確認。**認証は不変＝未認証 HTTP/WS とも 401 維持を再確認**（ヘッダ追加で認証ガード・WS は壊れていない）。restart 済（mission-control.service / apollo-terminal.service）・healthz 200。Ctrl+V ネイティブ paste は xterm.js が DOM paste で受けるため非セキュアでも通る経路あり。Keita 推奨操作: HTTPS（cloudflared 経由）で開く→Ctrl+V（macOS Cmd+V）。iframe で限界がある時は「新しいタブで開く」。**GitHub push は Keita 承認待ち（ローカル commit のみ）。** |
| 更新日 | 2026-06-01 |

---

## バッチ: 2026-06-01 Apollo Web ターミナル文字化け修正（MC-92 の回帰）

> Keita が実機で /terminal を開くと、ブラウザに文字化けバイナリが表示されターミナルが実質使えない状態。MC-92（Web ターミナル新設・コピペ改善）で入った未コミット差分の selfHandleResponse 化が、上流 ttyd の gzip 圧縮 body を壊して content-encoding ヘッダも消すため、ブラウザが壊れた gzip を平文表示している。根因確定済み。dev-logic が server/src/terminalProxy.ts を修正中（台帳は task-manager 管轄＝dev-logic はコードのみ）。

### MC-93 — Apollo Web ターミナル（/terminal）でブラウザに文字化けバイナリが表示される不具合の修正

| フィールド | 値 |
|---|---|
| ID | MC-93 |
| タイトル | Apollo Web ターミナル（/terminal）でブラウザに文字化けバイナリが表示される不具合の修正 |
| 種別 | bug / インフラ（MC-92 の回帰） |
| 優先度 | 高（Keita が実機で遭遇・ターミナルが実質使えない状態） |
| ステータス | DONE（DoD 4項目クリア・Keita 実機で「治った」確認済み 2026-06-01） |
| 担当 | dev-logic（実装）。検証は dev-logic の curl 検証＋必要なら test-functional（試野）の実機確認。台帳更新は task-manager（棚町）が管轄（dev-logic はコードのみ触る取り決め） |
| 背景・根因（確定済み） | ブラウザの `Accept-Encoding: gzip` に対し上流 ttyd が gzip 圧縮 HTML を返す。今日入った未コミット差分 `server/src/terminalProxy.ts` の `selfHandleResponse: true` 化が、圧縮 body を `Buffer.concat(...).toString('utf8')` で文字列化して破壊し、`content-encoding` ヘッダも delete するため、ブラウザが壊れた gzip を平文として表示 → 文字化け。再現: curl で `Accept-Encoding: gzip` を付けると先頭 `1f ef bf bd...`・content-encoding 消失。Accept-Encoding 無しだと正常に見えるため気づきにくかった。さらにこの未コミット差分のまま 13:59 に server が restart され本番に乗っていた。 |
| 修正方針 | `proxyReq` で `Accept-Encoding` を削除し ttyd に非圧縮で返させる（ターミナルは軽量なので非圧縮で問題なし）。paste-fix script 注入（`__apolloPasteFix`）は維持。 |
| 受け入れ条件（DoD） | (1) server `tsc --noEmit` green。(2) restart 後 `/api/healthz` 200。(3) `Accept-Encoding: gzip` 付き `GET /terminal/` で content-encoding 無し・本文が `<!DOCTYPE html` 始まり・`__apolloPasteFix` 注入あり。(4) ブラウザ実機でターミナル表示・打鍵・Ctrl+V 貼り付けが正常。 |
| 検証メモ（確認済み・2026-06-01） | 修正本体: `server/src/terminalProxy.ts:105` の proxyReq ハンドラに `proxyReq.removeHeader('accept-encoding')` を追加（commit d40459a「fix(terminal): drop accept-encoding to ttyd so HTML body stays uncompressed (MC-93)」、未 push）。ttyd に非圧縮で返させ、selfHandleResponse の utf8 文字列化で gzip body が壊れる根因を解消。`:141` の `delete headers['content-encoding']` も二重防御で残置。／(1) tsc `npx tsc --noEmit` EXIT=0 green ✓／(2) restart 後 `/api/healthz` 200・systemctl is-active active ✓／(3) `Accept-Encoding: gzip` 付き GET /terminal/ → content-encoding 無し・本文 `<!DOCTYPE html` 始まり・`__apolloPasteFix` 注入2箇所 ✓／(4) 実機: Keita がブラウザで「治った」と確認済み（2026-06-01）✓。非退行: Permissions-Policy: clipboard-read=(self),clipboard-write=(self) 維持・Cookie 無しは 401（認証ゲート維持）・/terminal/token 200・/terminal/ws 101 ✓。後始末: 使い捨て `_repro_*.mjs` 6本 dev-logic 削除済み、terminalProxy.ts は commit 済みでワーキングツリーから汚れ差分除去済み。push は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 関連 | MC-92（Web ターミナル新設・コピペ改善）。`server/src/terminalProxy.ts`（proxyReq で Accept-Encoding 削除・proxyRes で script 注入）, `deploy/apollo.service` restart, ttyd 1.7.4, [[project-apollo-dashboard]] |
| 提言・抜けもれ | (1) MC-92 の selfHandleResponse 化が回帰の根。今回の修正後、MC-92 の DoD（コピペ改善で付けた `Permissions-Policy` ヘッダ注入・clipboard 権限委譲）が壊れていないか同時に再確認（curl -I でヘッダ・未認証 HTTP/WS とも 401 維持）。(2) **未コミット差分のまま restart で本番に乗った**のが今回の事故の温床。push は Keita 承認が要るが、ローカル commit でワーキングツリーを汚れたまま放置しないこと（次の restart で意図せぬ差分が乗る再発防止）。(3) push / 本番反映の判断は Keita 専権（[[reference-deploy-commands]]）。今回はローカル編集＋restart までで、push はしない。 |
| 更新日 | 2026-06-01 |

---

## バッチ: 2026-06-01 Apollo ターミナル PC コピペ修正 / 画像添付 / レスキュー画面

> Keita 要望3件（2026-06-01）。MC-94=MC-92 の積み残し（PC ブラウザ Ctrl+V が実機で効かない）の根因確定→修正、dev-logic 実機検証で DoD クリア＝DONE（2026-06-01）。MC-95=ターミナルから画像を林に渡せるようにする feature。MC-96=Apollo が落ちても開ける独立レスキュー画面（設計 Keita 確認中）。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-94/95/96 確定済み（pull --rebase 後、MC-90〜93 既存を裏取り、再採番なし）。

### MC-94 — Apollo Web ターミナルで PC ブラウザの Ctrl+V コピペが効かない不具合の修正

| フィールド | 値 |
|---|---|
| ID | MC-94 |
| タイトル | Apollo Web ターミナルで PC ブラウザの Ctrl+V コピペが効かない不具合の修正 |
| 種別 | bug / MC-92 の積み残し |
| 優先度 | 高 |
| ステータス | DONE（dev-logic 蓮 が根因実機特定→修正→Playwright 実機検証で DoD 4項目クリア。2026-06-01。[[feedback-review-agent-verify-then-done]] によりエージェント実機検証で DONE 化、Keita PC 確認は別途依頼中・なお不可なら再オープン） |
| 担当 | dev-logic（実機調査→修正→restart→Playwright 実機検証まで）。台帳更新は task-manager（棚町）管轄（dev-logic はコードのみ触る取り決め） |
| 背景 | MC-92 で PC 用 Ctrl+V 貼り付け対応（`terminalProxy.ts` の `__apolloPasteFix` script を ttyd の HTML に注入、`navigator.clipboard.readText`→`term.paste`）を入れたが、実機の PC では貼り付けが効かない。Keita 報告（2026-06-01）。アクセスは HTTPS トンネル経由＝secure context はあるため「HTTP だから clipboard API が無い」線は除外済み。 |
| 根因（実機確定済み 2026-06-01） | iframe 内の `navigator.clipboard.readText()` が clipboard-read 権限ゲートで NotAllowedError 失敗。旧 MC-92 コードはそれを catch で握りつぶしつつ Ctrl+V を無条件 `preventDefault` していたため、クリップボード取得失敗時にネイティブ paste も殺され何も貼れなかった。当初の根因候補 (a) `window.term` 未公開説は外れ（paste-fix はアタッチ済みだった）。(b)/(c) も主因ではなく、真因は readText 失敗時の preventDefault による native paste 殺し。 |
| 受け入れ条件（DoD）★クリア | (1) 根因を実機証拠付きで特定 → 上記「根因」で確定 ✓。(2) PC ブラウザで Ctrl+V 貼り付けが実際に効く → Playwright（chromium、clipboard-read 未付与＝実 PC ブラウザ相当）で Ctrl+V 貼り付けが bracketed paste で PTY 到達・SYN なしを確認 ✓。(3) 非退行 → 通常打鍵 abc 素通り・Ctrl+Shift+V 素通り・MC-93 文字化け無し すべて PASS ✓。(4) tsc green・restart 後 healthz 200 → `tsc --noEmit` exit 0・restart 後 healthz 200・`__apolloPasteFix` 注入2箇所・readText 撤去確認 ✓。 |
| 修正・検証メモ（dev-logic 実機検証済み 2026-06-01） | 修正本体: `server/src/terminalProxy.ts:57-78` の PASTE_FIX_SCRIPT。Ctrl+V（Shift 無し）に `return false` で xterm の SYN(0x16) 送出のみ抑止し、`preventDefault` は呼ばない。ブラウザのネイティブ paste が xterm helper textarea に走り、組み込み paste ハンドラが bracketed paste で PTY 送出。`clipboard.readText`／clipboard-read 権限／ttyd 構造に非依存。commit `0e8e6d0`（main、未 push）。検証: Playwright chromium（clipboard-read 未付与＝実 PC ブラウザ相当）で Ctrl+V 貼り付け→bracketed paste で PTY 到達・SYN なし確認。非退行（通常打鍵 abc 素通り・Ctrl+Shift+V 素通り・MC-93 文字化け無し）PASS。`tsc --noEmit` exit 0・restart 後 healthz 200・`__apolloPasteFix` 注入2箇所・readText 撤去確認。push は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 関連 | MC-92（Web ターミナル新設・コピペ改善の起源）、MC-93（文字化け修正）。`server/src/terminalProxy.ts:57-78`（PASTE_FIX_SCRIPT・SYN 抑止のみ／preventDefault 呼ばない）, ttyd 1.7.4, [[project-apollo-dashboard]], [[feedback-review-agent-verify-then-done]] |
| 提言・抜けもれ | (1) 根因 (a) の場合、`window.term` 非公開なら ttyd の xterm インスタンスへの到達手段（ttyd の内部 API・グローバル探索・あるいは iframe 内で keydown を捕まえて自前で WS に送る）を要検討。preventDefault だけで貼れない実装は最悪手。(2) ブラウザ別マトリクス（Chrome / Edge / Firefox / Safari）で clipboard.readText 可否が割れる。最低 Chrome 系で確実に効くことを DoD の必達ラインにし、非対応ブラウザは Ctrl+Shift+V や右クリック貼付のフォールバックを案内。(3) iframe の clipboard 権限は親（Apollo 配信元）の Permissions-Policy と iframe の `allow="clipboard-read; clipboard-write"` の両方が要る。片方欠落で空振りするので両方確認。(4) Playwright で clipboard を扱うには context permissions（clipboard-read/write）付与が要る点に注意（実機ブラウザの権限ダイアログと挙動が違う）。実機確認も併せる。(5) push / 本番反映は Keita 専権（[[reference-deploy-commands]]）。ローカル編集＋restart まで、push はしない。 |
| 更新日 | 2026-06-01 |

---

### MC-95 — Apollo ターミナルから画像を添付して対話中の林に渡せるようにする（クリップボード貼付＋ファイル選択）

| フィールド | 値 |
|---|---|
| ID | MC-95 |
| タイトル | Apollo ターミナルから画像を添付して対話中の林に渡せるようにする（クリップボード貼付＋ファイル選択 両方） |
| 種別 | feature |
| 優先度 | 中 |
| ステータス | DONE |
| 担当 | dev-logic（設計詳細は着手時に詰める）。台帳更新は task-manager（棚町）管轄 |
| 検証（2026-06-01 test-functional 試野） | 実機 E2E 全項目 PASS（修正要 FAIL なし）で DoD クリア＝DONE 化（[[feedback-review-agent-verify-then-done]]）。根拠: (a) ナビ全9項目巡回・/terminal-view 遷移・ttyd iframe 表示 OK、ルート変更（/terminal→/terminal-view）による波及なし・pageerror ゼロ。(b) /terminal/（ttyd 直）200 生存＝SPA と proxy の分離成立（index.ts の /terminal mount が SPA fallback より先に評価）。(c) 画像添付＝ファイル選択（単体/複数）・クリップボード貼付 とも 201・`data/terminal-uploads/` 保存・tmux main へリテラル注入・自動 Enter なしを実機確認。(d) バリデーション/認証＝Cookie 無し 401／0枚・不正 MIME・枚数超過・サイズ超過 400／いずれも tmux 未到達。(e) 非破壊性＝検証文字列は BSpace で消去し tmux main 原状復帰。(f) MC-93/94 非退行＝文字化けなし・Permissions-Policy 付与・paste-fix script 健在。実装 commit ded755e（未 push）。push / 本番反映は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 背景 | Keita 要望（2026-06-01）。ターミナル（tmux main の claude=林）に画像を見せたい。クリップボードからの貼り付けとファイル選択の両方に対応したい。 |
| 想定設計 | ターミナルビュー（`web/src/views/Terminal.tsx`）にオーバーレイ UI（添付ボタン＋ペースト受け）を追加 → 画像をサーバ保存（`data/terminal-uploads/`、新規 API `POST /api/terminal/upload`、multipart）→ 保存パスを tmux main に注入（`tmux send-keys` でパス文字列を流す）→ 林が Read で読む。クリップボード画像は secure context（https）前提で可。既存 inbox の画像添付実装（`server/src/inbox.ts`、`data/inbox-attachments/`）が流用の参考。 |
| 受け入れ条件（DoD） | (1) ターミナル画面からファイル選択で画像アップロード→tmux main にパスが届き林が Read 可能。(2) クリップボードからの画像貼付も同様に動作。(3) 認証ゲート維持・サイズ/枚数制限・拡張子検証。(4) tsc green・restart 後 `/api/healthz` 200・実機検証。 |
| 関連 | MC-94（同じターミナルビューの clipboard 周り＝着手順序で干渉しうる）、`server/src/inbox.ts`（流用元）, `data/inbox-attachments/`, `web/src/views/Terminal.tsx`, [[project-apollo-dashboard]] |
| 提言・抜けもれ | (1) MC-94 と同じ `Terminal.tsx` / clipboard を触るため、着手順序を要調整（MC-94 のコピペ修正と同時並行だと iframe・clipboard 周りで競合しうる）。dev-logic 内で順序整理を。(2) `tmux send-keys` でパスを流す方式は、林が対話入力途中だと割り込む懸念あり。送出タイミング（プロンプト待機中に限る等）か、明示確認を挟む設計を検討。(3) アップロードのサイズ上限・許可拡張子（png/jpg/webp 等）・枚数上限を inbox 実装に揃える。マルウェア/巨大ファイル対策。(4) 保存先 `data/terminal-uploads/` の肥大化＝定期掃除 or 上限を検討（提言、別タスク化候補）。(5) 認証は既存 MC_TOKEN ゲートの内側に置く（未認証アップロード禁止）。(6) push / 本番反映は Keita 専権。 |
| 更新日 | 2026-06-01 |

---

### MC-96 — Apollo が開けない/壊れた時の独立レスキュー画面・修復ルートを確保する

| フィールド | 値 |
|---|---|
| ID | MC-96 |
| タイトル | Apollo が開けない/壊れた時の独立レスキュー画面・修復ルートを確保する |
| 種別 | feature / インフラ（レジリエンス） |
| 優先度 | 高 |
| ステータス | DONE（2026-06-01。設計確定→実装→dev-logic 実機検証6項目グリーンで TODO→直接 DONE。[[feedback-review-agent-verify-then-done]] によりエージェント実機検証で DONE 化。push は Keita 承認待ち＝未 push） |
| 担当 | dev-logic（実装）＋apollo番人（apollo）協調。台帳更新は task-manager（棚町）管轄 |
| 完了根拠（2026-06-01・dev-logic 実機検証済み） | 実装＝`deploy/apollo-rescue.mjs`（Node 標準ライブラリのみの単一ファイル、Apollo 本体の node_modules/tsx/web ビルドに非依存＝本体が死んでも起動可能）＋`deploy/apollo-rescue.service`（systemd, User=dev, Restart=always）。commit 036d7c6（main、未 push）。ポート :4318 常駐（RESCUE_PORT で .mc.env の PORT=4317 を踏まないよう明示上書き、4317 を奪わない確認済み）、systemd enable --now 済・is-active active・is-enabled enabled。認証＝Apollo と同じ MC_TOKEN（.mc.env→.mc_token→env で解決）、?token=→Cookie 1クリック方式、crypto.timingSafeEqual 比較、/restart /logs も厳格保護。機能＝GET /（自己完結 HTML・10秒自動更新・restart/ログ/状態/ターミナル直リンク）、GET /status（healthz到達可否・JSON/HTML判定・systemctl is-active・ttyd/tmux 有無・df/free/uptime/loadavg）、POST /restart（sudo -n systemctl restart mission-control.service・30s cooldown・restart後healthz200を最大8s待ち recovered 返却）、GET /logs（journalctl -n150）、GET /healthz（無認証・自身死活）。検証6項目すべてグリーン: (1) 認証ゲート（token無し401・誤token401・Cookie/Bearer200）(2) /status が本体生存中に healthz200/systemd active/ttyd/tmux 正しく表示 (3) POST /restart で mission-control 復活（recovered:true・約3秒）(4) ★本体 down 確証＝Apollo を stop した状態でレスキュー GET/ が 200・/status が apollo.up=false/systemd=inactive を表示、即 start で復旧（＝DoD(1) 充足の決め手）(5) Restart=always（kill -9 → 約4秒で新PID復活）(6) cooldown（連打 429）。DoD 4項目（(1)本体停止でも開ける (2)レスキューから restart で本体復活 (3)独立 systemd で自動起動・常駐 (4)認証ゲートあり）すべて充足。残（DONE をブロックしない・Keita 領分）＝cloudflared で apollo-rescue.<domain>→:4318 の ingress 追加（外部固定 URL 公開）。トンネル設定側の作業ゆえ別管理。 |
| 背景 | Keita 要望（2026-06-01）。今回の MC-93 のようにターミナル/Apollo が使えなくなった時に、ブラウザから復旧できる導線が欲しい。Apollo 本体(:4317)が落ちても開ける予備画面を準備しておきたい。 |
| 想定設計（Keita 確認中） | Apollo 本体とは独立したプロセスで軽量レスキューサーバを立てる（別ポート例:4318・別 systemd `apollo-rescue.service`・素の Node http 単一ファイルで apollo-web/server のビルドに非依存＝本体が死んでも起動可能）。機能: Apollo 死活(healthz)表示／ワンクリック `mission-control.service` restart／直近ログ表示／ttyd・tmux・df・free 状態／ターミナル直リンク。認証は MC_TOKEN 流用、cloudflared で本体と独立した別経路公開。位置づけは既存 cron `apollo-watchdog`（自動 restart）の手動 Web 版で、番人(apollo)と協調。 |
| 受け入れ条件（DoD） | (1) Apollo 本体を停止した状態でもレスキュー画面が開ける。(2) レスキュー画面から restart して本体が復活する。(3) 独立 systemd で自動起動・常駐。(4) 認証ゲートあり。 |
| 関連 | MC-93（今回の障害＝この要望の発端）、`~/cron-scripts/apollo-watchdog.sh`（自動 restart の既存版・手動 Web 版がこれ）、`deploy/apollo.service` / 新規 `deploy/apollo-rescue.service`, cloudflared, [[project-apollo-dashboard]]、[[project-apollo-keeper]] |
| 提言・抜けもれ | (1) **非依存が肝**: レスキューサーバは apollo-web/server のビルド成果物・node_modules・共通設定に依存させない（本体が壊れた原因と心中しないため、単一ファイル＋Node 標準ライブラリのみが望ましい）。依存を持たせると「本体が死ぬ時に一緒に死ぬ」。(2) restart 権限＝レスキューサーバが `systemctl restart` を実行できる権限設計（dev ユーザの sudo 範囲 or systemd 経由）。任意 restart が認証ゲート内に限定されること（未認証で叩けると DoS）。(3) ポート 4318 と cloudflared 別経路が本体と衝突しない・独立して落ちないこと。(4) apollo番人（apollo）の cron watchdog（自動 restart）と機能重複・競合しないか整理（手動 Web 版＝人が押す、cron＝自動、の役割分担を明記）。(5) **設計は Keita 確認中**＝合意前に実装着手しない（BLOCKED 相当の判断待ち。確定したら IN_PROGRESS へ）。(6) レスキュー画面自体が単一障害点にならないよう、最低限の自己復旧（systemd Restart=always）も付ける。 |
| 更新日 | 2026-06-01 |

---

### MC-101 — Apollo ターミナルビューに「ターミナル開始」ボタンを追加（tmux main / ttyd 切断後の再起動導線）

| フィールド | 値 |
|---|---|
| ID | MC-101 |
| タイトル | Apollo ターミナルビューに「ターミナル開始」ボタンを追加（tmux main / ttyd 切断後の再起動導線） |
| 種別 | feature |
| 優先度 | 中〜高（ターミナルが切断されると現状ブラウザから復旧できず SSH が要る。Keita 直近要望） |
| ステータス | DONE（2026-06-01 dev-logic 実機検証グリーンで DONE 化。検証根拠は下記「検証ログ」参照。[[feedback-review-agent-verify-then-done]]） |
| 担当 | dev-logic（蓮／実装）、検証は test-functional（試野）／dev-logic |
| 背景 | Keita 要望（2026-06-01）。PC のターミナルが切断された後（tmux main セッション消失、または ttyd プロセス停止）、Apollo のターミナル画面から「開始」ボタンで tmux main（林 CLI）と ttyd を再起動して復旧できるようにしたい。現状は切断されるとブラウザ側に復旧導線がなく SSH 介入が要る。MC-96 のレスキュー画面（Apollo 本体 :4317 が死んだ時用）とは別レイヤー＝Apollo は生きているが端末バックエンド（tmux/ttyd）が落ちた時の導線。 |
| 検証ログ（2026-06-01 dev-logic 実機） | 構成判明: rin-terminal.sh = `tmux new-session -A -s main "cd /home/dev/projects && exec /usr/bin/claude"`（-A で attach/作成）、ttyd は systemd apollo-terminal.service 常駐。切断＝tmux main 消失 or ttyd 停止の2パターン。実装: server/src/terminalControl.ts（新規、GET /api/terminal/status＝has-session/systemctl is-active/ポート到達、POST /api/terminal/start＝冪等：main 無ければ作成・ttyd inactive なら start・両稼働なら no-op、execFile 安全）、config.ts:113-145（TERMINAL_TMUX_START_CMD 等）、index.ts:35/274-279（makeAuthMiddleware 配下に mount）、web/src/views/Terminal.tsx（status 15s ポーリング→切断時「ターミナルを開始」ボタン→start→iframe リロード）、e2e smoke 5件。commit a9ceef4（未 push）。検証: tsc/build green、restart 後 healthz 200、status API 本番 ready:true・Cookie 無し 401、別名セッション mc100test で start が created→ready・2回目 no-op（冪等）、本番 main の session_created 不変（非破壊の証拠＝DoD(5)決め手）、Playwright smoke 5/5 pass。DoD 5項目すべて充足。push は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 想定設計 | サーバに GET /api/terminal/status（tmux main 有無・ttyd 稼働の状態）と POST /api/terminal/start（無ければ tmux main を rin-terminal.sh 相当で起動・ttyd 停止なら起動、冪等）。要認証。フロント web/src/views/Terminal.tsx で切断状態を検知して「ターミナル開始」ボタンを表示、押下で start→iframe リロード。rin-terminal.sh（/home/dev/cron-scripts/rin-terminal.sh）と既存 ttyd 起動構成を dev-logic が調査して整合させる。 |
| 重要制約 | 検証で本番 tmux main（対話中の林セッション）を kill しないこと。検証は別名セッションで行う。 |
| 受け入れ条件（DoD） | (1) tmux main を（別名セッションで）落とした状態からボタンで端末が復活／(2) 既に稼働中はボタン非表示 or 冪等で無害／(3) 認証ゲート維持／(4) tsc green・build・restart 後 healthz 200・実機検証／(5) 本番 main 非破壊。 |
| 関連ファイル | `web/src/views/Terminal.tsx`、`server/src/`（GET /api/terminal/status・POST /api/terminal/start 新規）、`/home/dev/cron-scripts/rin-terminal.sh`、既存 ttyd 起動構成（apollo-terminal.service） |
| 依存 | MC-92/93/94/95（ターミナル系の実装/proxy/paste/upload）、MC-96（レスキュー＝別レイヤーだが導線思想を参照） |
| 提言・抜けもれ | (1) **冪等性が肝**: POST /api/terminal/start は「既に tmux main 稼働・ttyd 稼働」のとき二重起動して既存セッション（対話中の林）を壊さないこと。存在チェック→無い時だけ起動、を厳格に。(2) **本番 main 非破壊の検証手順を明記**: 検証は別名セッション（例 `main_test`）で「落ちた状態→ボタン復活」を再現し、本物の `main` には触れない。DoD(5) の決め手。(3) **認証ゲート**: status/start とも MC_TOKEN 認証配下に置く（未認証で start を叩けると DoS／勝手起動になる）。MC-92/96 と同じ強度で。(4) **MC-96 レスキューとの役割整理**: レスキュー（:4318・本体が死んだ時）と本件（:4317 本体は生存・端末だけ落ちた時）の役割分担を UI/ドキュメントで明示し、機能重複させない。(5) **rin-terminal.sh の整合**: tmux main 起動の正準手順が rin-terminal.sh に集約されているか確認。API がシェルを直書きせず同スクリプト/同等手順を呼ぶ形にして二重メンテを避ける。(6) **ttyd と tmux の起動順序**: ttyd は tmux main にアタッチする構成なら、start で tmux→ttyd の順序・依存を保証（ttyd だけ起きて空セッションを掴む事故を防ぐ）。(7) **状態表示の正確さ**: status はプロセス grep だけでなく「アタッチ可能か」まで見られると親切（ゾンビ ttyd 検知）。(8) 検証根拠（別名セッションでの落とす→復活ログ・status JSON・認証401/200・冪等2回叩き）を DONE note に file/コマンドベースで残す（[[feedback-review-agent-verify-then-done]]）。(9) push / 本番反映（apollo.service restart 含む）は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 更新日 | 2026-06-01 |

---

### MC-103 — ターミナル画像添付の「送る前のプレビュー」を確実に個別削除できるようにする（MC-102 の削除 UX 修正）

| フィールド | 値 |
|---|---|
| ID | MC-103 |
| タイトル | ターミナル画像添付の「送る前のプレビュー」を確実に個別削除できるようにする（MC-102 の削除 UX 修正） |
| 種別 | bug / UX 修正 |
| 優先度 | 中〜高（Keita 実機で削除できないと報告。送信前プレビューの操作不能は体験を直接損なう） |
| ステータス | DONE（2026-06-01 dev-logic 実機検証グリーンで IN_PROGRESS→DONE。[[feedback-review-agent-verify-then-done]]） |
| 担当 | dev-logic（蓮、実機確認→修正）。台帳更新は task-manager（棚町）管轄 |
| 背景 | Keita 要望（2026-06-01）。MC-102 で画像ステージングの各サムネに削除ボタン（×、removeStaged）を実装し Playwright 検証では「個別削除で1枚減」が PASS していたが、Keita が実機で「送る前の画像プレビューを削除できない」と報告。実装と実機体験が食い違っている。原因候補: (a) 削除ボタンが視認しづらい/ホバー依存でタップで出ない (b) クリック/タップのヒット領域が小さい・iframe や他要素に隠れて押せない (c) 本番 dist 反映漏れ (d) 削除ハンドラのバグ。実機で切り分けて修正する。 |
| 想定設計 | `web/src/views/Terminal.tsx` のステージングサムネ削除 UI を見直す。削除ボタンを常時表示（ホバー依存をやめる）・ヒット領域とタップターゲットを十分大きく（44px 目安）・z-index と重なり順を確認し iframe/他要素に隠れないようにする。removeStaged ハンドラと object URL revoke の動作を実機で確認。本番 dist の反映状況も確認（restart/build 漏れがないか）。原因が (c) なら build/restart で解消、(a)(b)(d) なら CSS/JSX/ハンドラ修正。 |
| 受け入れ条件（DoD） | (1) 本番（:4317 /terminal-view）実機で、ステージング中の各画像プレビューに常時見える削除ボタンがあり、PC クリック・スマホタップの両方で確実に1枚ずつ消せる。(2) 全消し/一部消しが効く。(3) MC-102 の他機能（複数選択・貼付・5枚上限・林に送る）非退行。(4) build/tsc green・restart 後 `/api/healthz` 200・実機検証・本番 main 非破壊。 |
| 関連ファイル | `web/src/views/Terminal.tsx`、`web/dist`（本番反映確認）、`server/src/`（`/api/terminal/upload` 既存・複数対応済） |
| 依存 | MC-102（削除 UI の実装元）、MC-95（サーバ側複数枚対応の前提） |
| 提言・抜けもれ | (1) **PC とスマホ両方で検証**: 削除ボタンの不具合は「ホバーでしか出ない（タップ端末で消えない）」「タップターゲットが小さすぎる」が典型。Playwright のクリックは座標直撃で PASS しても実機タップで再現しないことがあるため、実機相当（タッチ/ポインタ）で両方確認する。(2) **本番 dist 反映の確認を最初に**: MC-102 の commit 2065363 が web build→restart 済で本番に乗っているか先に確認（原因 (c) なら build/restart だけで解消し、無駄なコード修正を避けられる）。(3) **常時表示化**: 削除ボタンをホバー依存にしない（CSS の `:hover` 表示はタッチ端末で出ない）。常時可視＋十分なコントラストにする。(4) **z-index / pointer-events**: サムネ上のボタンが画像や overlay に pointer-events を奪われていないか確認。(5) **object URL revoke の整合**: 削除時に revokeObjectURL が走り、かつ配列から正しく除去されて再レンダリングされるか（state 更新の参照同一性に注意）。(6) UI 文言は中立的丁寧体・CSS 変数・SVG アイコンのみ（emoji 不可、[[feedback-app-copy-neutral]]）。(7) 検証根拠（実機 PC クリック＋スマホタップで個別/全消しが効く・非退行・main 非破壊）を DONE note に file:line で残す（[[feedback-review-agent-verify-then-done]]）。(8) push / 本番反映（apollo.service restart 含む）は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 更新日 | 2026-06-01（dev-logic 実機検証グリーンで IN_PROGRESS→DONE。原因=削除ボタンが 20px・角に埋もれ・当たり判定が SVG path のみでモバイルタップ外れ。修正=28px化・角に持ち出し・常時高コントラスト・touch-action:manipulation・SVG pointer-events-none・preventDefault/stopPropagation で iframe 伝播抑止・removeStaged＋revokeObjectURL 維持。検証=build/tsc green・healthz 200・Playwright PC+モバイル390px で個別/全消し・MC-102 7/7・MC-100 5/5 非退行・main 非破壊。commit 6118a7a） |

---

### MC-102 — ターミナル画像添付にプレビュー表示と複数枚ステージング UI を追加（MC-95 拡張）

| フィールド | 値 |
|---|---|
| ID | MC-102 |
| タイトル | ターミナル画像添付にプレビュー表示と複数枚ステージング UI を追加（MC-95 拡張） |
| 種別 | feature / UX 改善 |
| 優先度 | 中 |
| ステータス | DONE（2026-06-01 dev-logic 実機検証グリーンで IN_PROGRESS→DONE。[[feedback-review-agent-verify-then-done]]） |
| 担当 | dev-logic（蓮）。台帳更新は task-manager（棚町）管轄 |
| 完了検証（2026-06-01・DoD 逆引き） | 実装＝web/src/views/Terminal.tsx を「選択即送信」→「ステージング方式」へ。StagedImage 配列で貯め、URL.createObjectURL でサムネ、revokeObjectURL（個別削除/送信成功/アンマウント）でメモリ解放、サムネ個別削除×、5枚上限（サーバ TERMINAL_UPLOAD_MAX_FILES=5 と整合）、「林に送る（N枚）」で /api/terminal/upload に multipart 一括→201→クリア→role=status 表示、in-flight ガード。paste も addToStaging に切替。MC-100/101 の開始ボタン・status ポーリングと共存。サーバ terminalUpload.ts は複数対応済みで無変更。commit 2065363（未 push→今回 push 予定）。検証＝web build green・server tsc exit 0・restart 後 healthz 200・Playwright smoke 7/7 PASS（複数選択サムネ3枚・即送信されない＝upload 0回・貼付追加・個別削除・7枚→5枚抑止 alert・林に送るで 3枚 1リクエスト multipart 201 クリア・1280px 回帰）・認証 Cookie 無し 401・非退行 MC-100 start spec 5/5・実機 authed 2枚 upload count:2/別パス2本/injected・本番 main 注入文字は BSpace で消去し非破壊（自動 Enter なし）。DoD (1)〜(5) すべて充足。 |
| 背景 | Keita 要望（2026-06-01）。MC-95 はサーバ側は複数枚対応済み（最大5枚）だが、フロントが「選択/貼付の瞬間に即アップロード＆即 tmux 注入・プレビュー無し」。アップロード/スクショ貼付した画像のサムネプレビューを出し、複数枚を貯めて確認・削除してからまとめて送れるようにしたい。 |
| 想定設計 | `web/src/views/Terminal.tsx` の添付ツールバーを「即送信」から「ステージング」方式に変更。選択/貼付画像を object URL でサムネ表示、各サムネに削除ボタン、最大5枚、「林に送る」ボタンで `/api/terminal/upload` に multipart 一括送信→パス群を tmux 注入→ステージングクリア。サーバ API は複数対応済みなので原則フロント変更（必要なら微調整）。 |
| 受け入れ条件（DoD） | (1) ファイル複数選択でサムネ複数プレビュー。(2) クリップボード貼付でプレビューに追加。(3) 個別削除・5枚上限 UI。(4) 送信で複数パスが tmux main に注入され林が Read 可能。(5) tsc/build green・restart 後 `/api/healthz` 200・実機検証・本番 main 非破壊。 |
| 関連ファイル | `web/src/views/Terminal.tsx`、`server/src/`（`/api/terminal/upload` 既存・複数対応済）、`data/terminal-uploads/` |
| 依存 | MC-95（サーバ側複数枚対応の前提）、MC-92〜94（ターミナル系）、MC-100/101 |
| 提言・抜けもれ | (1) **object URL リーク対策**: プレビューに使った `URL.createObjectURL` は削除/送信/アンマウント時に `revokeObjectURL` する（メモリリーク防止）。(2) **5枚上限の整合**: フロントの上限とサーバ側の枚数バリデーション（MC-95 で 400 を返す閾値）を一致させる。超過時はフロントで弾きつつサーバ側 400 も維持。(3) **クリップボード貼付の二重経路**: MC-94 の Ctrl+V paste-fix（PTY 向け bracketed paste）と、本件の画像貼付（ステージングへ追加）が衝突しないよう、画像 clipboard item のときだけステージングへ・テキストは従来どおり PTY へ、と分岐を明確に。(4) **送信中の二重送信防止**: 送信ボタンに in-flight ガード（連打で多重 upload しない）。(5) **tmux 注入は MC-95 同様 自動 Enter なし・リテラル注入**（林の入力途中に割り込まない設計を踏襲）。(6) UI 文言は中立的丁寧体・CSS 変数・SVG アイコンのみ（emoji 不可、[[feedback-app-copy-neutral]]）。(7) 検証根拠（複数選択/貼付プレビュー・削除・上限・一括送信で複数パス到達・main 非破壊）を DONE note に残す（[[feedback-review-agent-verify-then-done]]）。(8) push / 本番反映（apollo.service restart 含む）は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 更新日 | 2026-06-01（DONE 化） |

---

最終更新: 2026-06-01 / 管理: task-manager（棚町）。2026-06-01 MC-102「ターミナル画像プレビュー＋複数枚ステージング」DONE 化: MC-102 を IN_PROGRESS→DONE。dev-logic 実機検証グリーン（web build/server tsc 0・restart 後 healthz 200・Playwright smoke 7/7 PASS=複数選択サムネ3枚/即送信されない＝upload 0回/貼付追加/個別削除/7枚→5枚抑止 alert/林に送るで 3枚 1リクエスト multipart 201 クリア/1280px 回帰・Cookie 無し POST 401・非退行 MC-100 start spec 5/5・実機 authed 2枚 upload count:2/別パス2本/injected・本番 main 注入文字 BSpace 消去で非破壊＝自動 Enter なし）。実装＝web/src/views/Terminal.tsx を即送信→ステージング方式へ（StagedImage 配列・createObjectURL サムネ・revokeObjectURL リーク解放・個別削除×・5枚上限＝サーバ TERMINAL_UPLOAD_MAX_FILES=5 整合・「林に送る（N枚）」で multipart 一括・in-flight ガード・paste も addToStaging）、サーバ terminalUpload.ts は複数対応済で無変更、commit 2065363。[[feedback-review-agent-verify-then-done]] で DONE 化。Keita 承認済の一括 push を実施（未 push の 036d7c6/c493df3/f895f9f/a9ceef4/c6fd8f1/2065363＋本 DONE 台帳 commit を origin/main へ）。2026-06-01 MC-101「ターミナル開始ボタン」DONE 化 / MC-102 新規起票 / MC-99 優先度引き上げ: (1) MC-101 を IN_PROGRESS→DONE。dev-logic 実機検証グリーン（tsc/build green・restart 後 healthz 200・status API 本番 ready:true/Cookie 無し401・別名セッション mc100test で start created→ready・2回目 no-op で冪等・本番 main の session_created 不変＝非破壊の証拠・Playwright smoke 5/5）。実装 terminalControl.ts 新規＋config.ts:113-145＋index.ts:35/274-279＋Terminal.tsx、commit a9ceef4 未 push、[[feedback-review-agent-verify-then-done]]。(2) MC-102 新規起票（IN_PROGRESS）=ターミナル画像添付の「即送信」を「プレビュー＋複数枚ステージング」UI に拡張（MC-95 のサーバ複数枚対応を活かしフロント変更主体）、担当 dev-logic、採番は next-task-id.sh で MC-102 確定（pull --rebase 後、実在最大 MC-101 +1。MC-100 は前回返却した未使用番号で永久欠番扱い＝歯抜けだが衝突回避優先で再利用しない）。(3) MC-99（SMOKE 除外フィルタ）の優先度を 低〜中→中 に引き上げ。MC-101 検証のフル smoke 中に inbox 経由で SMOKE タスク（MC-102 等の名で）が台帳に自動混入し dev-logic が git checkout で戻す事象が繰り返し発生し実作業を妨げているため。番号ズレ整合: dev-logic がブリーフ上「MC-100」と呼んだのは台帳起票 MC-101 が正。MC-100 は前回（MC-99 起票時）に予約後 未使用返却した番号で、現台帳に MC-100 のカードは存在しない＝欠番。SMOKE 幽霊掃除: 現台帳を grep（`__SMOKE` / 空タイトル）した結果、MC-97（既に CANCELLED 済）以外に SMOKE 由来の幽霊カードは残存なし＝追加 CANCELLED 不要。push は Keita 承認待ち。2026-06-01 Apollo 独立レスキュー画面 DONE 化: MC-96 を TODO→DONE（IN_PROGRESS を経ず、dev-logic 実機検証6項目グリーンで直接 DONE）。実装＝deploy/apollo-rescue.mjs（Node 標準ライブラリのみの単一ファイル・本体ビルド/node_modules/tsx 非依存＝本体が死んでも起動可）＋deploy/apollo-rescue.service（systemd, User=dev, Restart=always）、commit 036d7c6（main・未 push）。ポート :4318 常駐（RESCUE_PORT で .mc.env PORT=4317 を踏まない明示上書き・4317 奪わない確認済み）、enable --now 済・active/enabled。認証＝Apollo と同じ MC_TOKEN・?token→Cookie 1クリック・timingSafeEqual、/restart /logs 厳格保護。機能＝GET /（自己完結 HTML 10秒自動更新）／GET /status（healthz到達可否・JSON/HTML判定・systemctl is-active・ttyd/tmux・df/free/uptime/loadavg）／POST /restart（sudo -n systemctl restart mission-control.service・30s cooldown・restart後 healthz200 最大8s待ち recovered 返却）／GET /logs（journalctl -n150）／GET /healthz（無認証・自身死活）。検証6項目グリーン:(1)認証ゲート(token無/誤401・Cookie/Bearer200)(2)本体生存中 /status 正しい(3)POST /restart で復活(recovered:true・約3s)(4)★本体 down 確証＝Apollo stop 中もレスキュー GET/ 200・/status が apollo.up=false/systemd=inactive 表示→DoD(1)決め手(5)Restart=always(kill -9→約4s 復活)(6)cooldown 連打429。DoD 4項目すべて充足。[[feedback-review-agent-verify-then-done]] でエージェント実機検証 DONE 化。残（DONE 非ブロック・Keita 領分）＝cloudflared で apollo-rescue.<domain>→:4318 ingress 追加（外部固定 URL 公開）はトンネル設定側作業で別管理。push は Keita 承認待ち。2026-06-01 台帳整理4点: (1) MC-95（ターミナル画像添付 feature）を TODO→DONE。test-functional 実機 E2E 全項目 PASS（ナビ9項目巡回・/terminal-view・ttyd iframe／/terminal 直 200 で SPA と proxy 分離／ファイル選択・クリップボード貼付とも 201・data/terminal-uploads/ 保存・tmux main リテラル注入・自動 Enter なし／Cookie 無し401・0枚/不正MIME/枚数超過/サイズ超過 400 で tmux 未到達／検証文字列 BSpace 消去で原状復帰／MC-93/94 非退行）、実装 commit ded755e 未 push、[[feedback-review-agent-verify-then-done]]。(2) MC-97（`__SMOKE_...__` 幽霊カード）を TODO→CANCELLED（林承認済）。inbox 即タスク化機構が投げたスモーク残骸で実害なし・コード/CI 非影響、行削除せず CANCELLED で履歴化。再発防止は MC-99。(3) テスト負債（Apollo e2e smoke 既存 fail を現状ナビ5項目に追従）は既起票の MC-98 と重複のため新規採番せず（脱線前の本来依頼＝MC-98 で充足）。(4) MC-99 新規起票（TODO）=inbox 即タスク化が `__SMOKE_...__` パターンを起票対象から除外する堅牢化、担当 dev-logic、DoD=SMOKE 投入で幽霊タスク生成なし。採番は next-task-id.sh で MC 2件予約（MC-99/MC-100）したが新規は MC-99 のみ（依頼3は MC-98 既存）＝MC-100 は未使用で返却（次回再利用）。push は Keita 承認待ち。2026-06-01 Apollo ターミナル PC コピペ修正完了: MC-94 を IN_PROGRESS→DONE。根因（実機確定）=iframe 内 navigator.clipboard.readText() が clipboard-read 権限ゲートで NotAllowedError 失敗、旧 MC-92 コードが catch で握りつぶしつつ Ctrl+V を無条件 preventDefault していたため native paste も殺され貼れなかった（window.term 未公開説は外れ）。修正=terminalProxy.ts:57-78 PASTE_FIX_SCRIPT で Ctrl+V に return false（xterm の SYN 送出のみ抑止・preventDefault は呼ばない）→ブラウザ native paste が xterm helper textarea に走り bracketed paste で PTY 送出、readText/clipboard 権限/ttyd 構造に非依存（commit 0e8e6d0 未 push）。DoD 4項目クリア（根因実機特定／Playwright chromium・clipboard-read 未付与＝実 PC 相当で Ctrl+V 貼付が bracketed paste で PTY 到達・SYN なし／非退行=通常打鍵 abc 素通り・Ctrl+Shift+V 素通り・MC-93 文字化け無し PASS／tsc --noEmit exit 0・restart 後 healthz 200・__apolloPasteFix 注入2箇所・readText 撤去確認）。[[feedback-review-agent-verify-then-done]] によりエージェント実機検証で DONE 化、Keita PC 確認は別途依頼中（なお不可なら再オープン）。push は Keita 承認待ち。2026-06-01 Apollo ターミナル PC コピペ修正 / 画像添付 / レスキュー画面バッチ: MC-94/95/96 新規起票。MC-94（高）=MC-92 の積み残し、PC ブラウザの Ctrl+V が実機で効かない。secure context はあるため HTTP 線は除外、根因候補 (a)ttyd が window.term 非公開で paste-fix 空振り (b)ブラウザ依存 (c)iframe clipboard 権限委譲未効、を実機 Playwright で確定→修正。dev-logic 蓮 着手。MC-95（中・TODO）=ターミナルから画像を tmux main の林に渡す feature、クリップボード貼付＋ファイル選択、新規 POST /api/terminal/upload・data/terminal-uploads/、inbox 実装流用。MC-94 と同じ Terminal.tsx/clipboard を触るため着手順序要調整。MC-96（高・TODO・設計 Keita 確認中）=Apollo 本体(:4317)が落ちても開ける独立レスキュー画面（別ポート 4318・別 systemd apollo-rescue.service・素の Node 単一ファイルで本体ビルド非依存）。死活表示/ワンクリック restart/ログ/リソース/ターミナル直リンク、MC_TOKEN 認証・cloudflared 別経路。非依存が肝、設計合意前は着手しない。3件とも台帳は task-manager 管轄（dev-logic はコードのみ）、採番は next-task-id.sh で MC-94/95/96 確定済み（再採番なし）。push は Keita 承認待ち。2026-06-01 Apollo Web ターミナル文字化け修正完了: MC-93 を IN_PROGRESS→DONE。修正=terminalProxy.ts:105 で proxyReq から accept-encoding 削除（ttyd 非圧縮化、commit d40459a 未 push）。DoD 4項目クリア（tsc green/healthz 200/Accept-Encoding:gzip 付き GET で content-encoding 無し・DOCTYPE 始まり・__apolloPasteFix 注入2箇所/Keita 実機「治った」確認）。非退行=Permissions-Policy 維持・401 認証ゲート維持・token 200・ws 101。後始末=_repro_*.mjs 6本削除・ワーキングツリー clean。push は Keita 承認待ち。2026-06-01 Apollo Web ターミナル文字化け修正バッチ: MC-93 新規起票（IN_PROGRESS）。Keita 実機遭遇の /terminal 文字化け＝MC-92 で入った selfHandleResponse 化が上流 ttyd の gzip body を破壊＋content-encoding 削除する回帰。根因確定済み。修正方針=proxyReq で Accept-Encoding 削除し非圧縮化（paste-fix 注入維持）。DoD=tsc green/healthz 200/Accept-Encoding:gzip 付き GET で content-encoding 無し・DOCTYPE 始まり・paste-fix 注入あり/実機で表示・打鍵・Ctrl+V 正常。担当 dev-logic（実装）、検証 dev-logic curl＋test-functional 実機。台帳は task-manager 管轄（dev-logic はコードのみ）。採番は next-task-id.sh で MC-93 取得済み（再採番なし）。push は Keita 承認待ち（ローカル編集＋restart まで）。2026-06-01 Apollo Web ターミナル実装（dev-logic 蓮）: MC-92 を IN_PROGRESS→DONE。ttyd 1.7.4（127.0.0.1 bind・writable・強 credential）を apollo-terminal.service で常駐、Apollo に /terminal reverse proxy（HTTP=auth ミドルウェア後ろ・WS=server.on('upgrade')＋isRequestAuthorized で同強度認証）を追加、web に「ターミナル」ナビ（iframe・/terminal-view・SVG アイコン・モバイル対応）を追加。検証 (a)未認証 HTTP/WS とも 401／(b)認証済 HTTP 200・WS 101・キー入力で shell 書込確認／(c)ttyd 公開 IP 直叩き拒否。restart 済・live。GitHub push は Keita 承認待ち（ローカル commit のみ）。2026-06-01 Apollo Web ターミナルバッチ: MC-92 新規起票（Keita 指示・方向 A=Web ターミナル）。依存に MC-88/MC-89 を記載（cxo リポ競合回避のため着手はそれら完了後）。採番は next-task-id.sh 直列（pull --rebase 後、MC-91 既存を裏取りし MC-92 確定）。2026-06-01 Apollo inbox 棚卸しバッチ: MC-90 新規起票（Apollo inbox 滞留＝cxo スコープ autonomous ループが cron 未登録という根因を確定）。ブリーフ #1/#3/#4 は MC-77 の inbox 即タスク化機構で既に taskId 紐付き済み（MC-89/MC-82/MC-87）と判明したため新規採番せず、既存スタブを調査結果で充実（重複起票回避）。採番は next-task-id.sh 直列（pull --rebase 後）。


### MC-97 — __SMOKE_20260530_1780292879903__

| フィールド | 値 |
|---|---|
| ID | MC-97 |
| タイトル | __SMOKE_20260530_1780292879903__（スモークテスト残骸） |
| 優先度 | P2 |
| ステータス | CANCELLED |
| 担当 | 未定 |
| 詳細 | 【Apollo投入】 __SMOKE_20260530_1780292879903__ |
| 取り下げ理由（2026-06-01・林承認済） | inbox 即タスク化機構が投げたスモークテスト残骸（`__SMOKE_...__` パターン）。実タスクではないため取り下げ。実害なし・コード/CI 非影響。林が CANCELLED 化を承認した。再発防止は別タスク（MC-99）で対応。番号は歯抜けにせず CANCELLED で履歴を残す（行削除はしない）。 |
| 更新日 | 2026-06-01 |

---

### MC-98 — Apollo e2e smoke の既存 fail を現状の UI に合わせて修正（テスト負債）

| フィールド | 値 |
|---|---|
| ID | MC-98 |
| タイトル | Apollo e2e smoke の既存 fail を現状の UI に合わせて修正（テスト負債） |
| 種別 | chore / test 負債 |
| 優先度 | 中（本番機能には影響なし。ただし MC-95 等の新規 smoke が既存 fail に埋もれて新規回帰を見逃すリスクがあるので近いうちに解消） |
| ステータス | DONE（2026-06-01 検証グリーン。smoke 28 spec 全 green=before 11 fail→after 0。修正 spec=e2e/render-smoke-20260530.spec.ts:18-37/144/146-168、commit 22499fa。[[feedback-review-agent-verify-then-done]]） |
| 担当 | test-functional（試野）または dev-logic（蓮） |
| 詳細 | 2026-06-01 の MC-95 実装検証中に dev-logic が報告。e2e の 2026-05-30 smoke が 11 件 fail している。原因は MC-95 とは無関係の既存ドリフトで、テストが BottomNav「7項目」想定の古いままだが、現状のナビは 5項目になっているため。MC-95（/terminal-view・画像 upload）由来ではないことを dev-logic が切り分け済み。 |
| 対応方針 | 古い smoke テストを現状の Apollo ナビ構成（5項目）に合わせて更新。MC-95 で追加された /terminal-view・画像添付の smoke（`e2e/render-smoke-20260601-terminal-upload.spec.ts`、4/4 pass）と整合させ、ナビ項目数をハードコードしている箇所を現状構成に追従させる。 |
| DoD | (1) e2e smoke がグリーン（既存 11 fail 解消）／(2) ナビ項目数のハードコード依存を現状構成（5項目）に追従／(3) 新規 MC-95 smoke（render-smoke-20260601-terminal-upload.spec.ts 4/4）と共存・両方 pass。 |
| 関連ファイル | `e2e/`（2026-05-30 smoke の spec 群、BottomNav 7項目想定の箇所）、`e2e/render-smoke-20260601-terminal-upload.spec.ts`（MC-95 で追加・4/4 pass）、`web/` のナビ（BottomNav・5項目） |
| 依存 | なし（MC-95 とは無関係の既存ドリフト。MC-95 由来でないことは dev-logic 切り分け済み） |
| 提言・抜けもれ | (1) **回帰の盲点が肝**: 既存 11 fail が常時赤だと新規 smoke の回帰が埋もれて検知できない。修正後は smoke 全体がグリーンであることを CI/手動の基準にする（赤が常態化しないよう）。(2) ナビ項目数を spec にハードコードしている箇所は、項目追加のたびに壊れる脆い前提。可能なら「想定項目の存在を個別に assert」する形（数の決め打ちでなくラベル単位）にして将来のドリフト耐性を上げるのを検討。(3) MC-94/95 で /terminal・/terminal-view・画像添付が増えたので、smoke の対象ナビに terminal 系も含まれているか確認（新ナビ要素が smoke 未カバーだと別の盲点になる）。(4) 検証は実機で smoke 全 spec を走らせて pass を確認し、根拠（pass/fail 件数・実行ログ）を DONE note に残す（[[feedback-review-agent-verify-then-done]]）。 |
| 更新日 | 2026-06-01 |

---

### MC-99 — inbox 即タスク化が SMOKE テストパターン（__SMOKE_...__）を起票対象から除外する

| フィールド | 値 |
|---|---|
| ID | MC-99 |
| タイトル | inbox 即タスク化が SMOKE テストパターン（`__SMOKE_...__`）を起票対象から除外する |
| 種別 | chore / 堅牢化 |
| 優先度 | 中（2026-06-01 低〜中→中 に引き上げ。MC-101 検証のフル smoke 実行中に inbox 経由で SMOKE タスク（MC-102 等）が台帳に自動混入し dev-logic が git checkout で戻す事象が繰り返し発生。再発が実作業を妨げているため優先度を上げる） |
| ステータス | DONE（2026-06-01 検証グリーン。isSmokeText/handlePost で SMOKE は起票せず consumed に「SMOKE skip」記録、live 投入で幽霊 0。commit c6614ce。[[feedback-review-agent-verify-then-done]]） |
| 担当 | dev-logic（蓮）。台帳更新は task-manager（棚町）管轄 |
| 背景 | 2026-06-01。MC-97 のように inbox スモーク（`__SMOKE_20260530_1780292879903__` 等）が即タスク化機構を通って TASK_TRACKER に幽霊カードとして起票される。即タスク化機構（MC-77 由来、server 側 inbox 消費ロジック）が text を素通しで起票しているため。MC-101 検証中にも SMOKE が混入→dev-logic が git checkout で戻す事象が再発（繰り返し発生のため優先度を中へ引き上げ）。 |
| 対応方針 | inbox 消費ロジックで、text が `__SMOKE_..__` パターンに一致するものは TASK_TRACKER へ起票せず「スモーク扱い」で消費する（inbox-consumed.jsonl への記録は行い、台帳カード化はしない）フィルタを入れる。 |
| 受け入れ条件（DoD） | SMOKE 投入（`__SMOKE_...__` パターン）で TASK_TRACKER に幽霊タスクが作られないこと。通常の task/instruction 投入は従来どおり起票されること（誤フィルタしない）。 |
| 関連 | MC-97（本件の発端＝幽霊カード）、MC-77（inbox 即タスク化機構）、`server/src/inbox.ts` 周辺の消費ロジック、`data/inbox-consumed.jsonl`、[[project-apollo-dashboard]]、[[project-autonomous-rin]] |
| 提言・抜けもれ | (1) パターン判定は前後空白・`【Apollo投入】` 等のプレフィックス付きでも拾えるように（MC-97 の詳細は `【Apollo投入】 __SMOKE_...__` 形式だった）。完全一致でなく「`__SMOKE_` で始まり `__` で終わる token を含む」で判定するのが堅い。(2) フィルタしたものは黙って捨てず inbox-consumed.jsonl に「smoke skip」理由付きで記録（後から監査可能に）。(3) 既存の幽霊カード（MC-97）は本タスクとは別に手動 CANCELLED 済み。フィルタ投入後の再発ゼロを確認する。(4) push / 本番反映は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 更新日 | 2026-06-01 |

---

## バッチ: 2026-06-01 Apollo ターミナル モバイルタップで TUI 選択肢が選べない（MC-104）

> Keita 報告（2026-06-01）: Apollo ターミナル（ttyd→tmux main の claude=林 TUI）で、claude が選択肢メニュー（矢印キー選択や数字選択の UI）を出した時、PC のマウスクリックは効くがモバイルのタップが反応せず「どうしようもない」＝モバイルで実質操作不能。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-104 確定（pull --rebase 後）。

### MC-104 — Apollo ターミナルで claude TUI の選択肢がモバイルのタップで選べない不具合の修正

| フィールド | 値 |
|---|---|
| ID | MC-104 |
| タイトル | Apollo ターミナルで claude TUI の選択肢がモバイルのタップで選べない不具合の修正 |
| 種別 | bug / UX |
| 優先度 | 高（Keita「選択肢が出た時にタップが反応せずどうしようもない」＝モバイルで実質操作不能。ターミナルからの林との対話が選択肢提示で詰まる） |
| ステータス | DONE（2026-06-01 実機検証グリーンで DONE 化。[[feedback-review-agent-verify-then-done]] によりエージェント検証で確定、Keita 実機確認不要） |
| 担当 | dev-logic（蓮）。台帳更新は task-manager（棚町）管轄 |
| 背景 | Keita 報告（2026-06-01）。ターミナル（ttyd→tmux main の claude=林 TUI）で、claude が選択肢メニュー（矢印キー選択や数字選択の UI）を出した時、PC のマウスクリックは効くがモバイルのタップが反応しない。xterm.js がタッチイベントを TUI のマウスレポーティング（SGR mouse）に変換しきれていないのが原因と推定。 |
| 想定設計 | MC-92/94 で `server/src/terminalProxy.ts` に注入している script（`__apolloPasteFix` 等）と同じ仕組みで、xterm.js のタッチイベント（touchstart/touchend）を捕捉し、TUI が期待するマウスレポーティング（SGR mouse、`\x1b[<...M`/`m`）へ変換するハンドラを注入する。タップ座標→セル座標（cols/rows・charWidth/lineHeight）への換算が肝。PC マウス・キーボード経路は触らず非退行を保つ。 |
| 受け入れ条件（DoD） | (1) モバイル実機相当（Playwright touch / 390px）で、claude TUI の選択肢をタップして選択・確定できる。(2) PC マウスクリック・キーボード操作が非退行。(3) MC-93/94/100/102/103 のターミナル機能が非退行。(4) tsc/build green・restart 後 `/api/healthz` 200・実機検証・本番 main 非破壊。 |
| 関連ファイル | `server/src/terminalProxy.ts`（script 注入）、`web/src/views/Terminal.tsx`、ttyd 1.7.4、[[project-apollo-dashboard]] |
| 依存 | MC-92/93/94（ターミナル系・script 注入の前例） |
| 提言・抜けもれ | (1) **座標換算の正確さ**: タッチ座標→セル(col/row) は xterm の実 charWidth/lineHeight・スクロール offset を見て計算する（固定値ハードコードは端末で崩れる）。(2) **SGR mouse モードの有無で分岐**: TUI 側が mouse reporting を有効化していない時にレポートを送ると誤入力になる。DECSET 1000/1002/1006 等の有効状態を見て、有効な時だけタッチ→マウス変換する（無効時は従来挙動）。(3) **PC 非退行**: 既存のマウスクリック経路（xterm 標準）を殺さない。タッチ専用にイベントを足す。(4) **MC-93 の content-encoding/文字化け修正と MC-94 の paste-fix を壊さない**（同じ注入 script を触るため curl でヘッダ・注入箇所を再確認）。(5) 未コミット差分のまま restart で本番に乗せない（MC-93 の事故再発防止＝ローカル commit でワーキングツリーを汚さない）。(6) 検証根拠（実機モバイルタップで選択肢を選べる・PC 非退行・他ターミナル機能非退行）を DONE note に file:line で残す（[[feedback-review-agent-verify-then-done]]）。(7) push / 本番反映（apollo.service restart 含む）は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 検証根拠（DONE） | 原因確定: ttyd 1.7.4 同梱 xterm.js は mouse reporting 有効時、PC マウスは `coreMouseService.triggerMouseEvent` で SGR 化して送るが、touch イベントには mouse report を張っていない（`bindMouse` は mousedown/up/wheel のみ）。合成 click も不安定 → PC クリックは効くがモバイルタップ無反応。修正: `server/src/terminalProxy.ts:89-159` 付近に `TAP_FIX_SCRIPT` 追加、`PASTE_FIX_SCRIPT`（MC-94）と並べて HTML 注入（MC-93 で非圧縮化済みの selfHandleResponse 経路）。`.xterm-screen` の touchstart/move/end を拾い、mouse reporting 有効時（`term._core.coreMouseService.areMouseEventsActive`）のみタップ座標を col/row 換算→`coreMouseService.triggerMouseEvent` で press/release。内部 API は try/catch ガード、スワイプ(>10px)/長押し(>700ms)はタップ扱いせず、mouse mode 無効時は非介入。commit `484d908`。検証: `tsc --noEmit` exit 0、restart 後 `/api/healthz` 200、注入確認（`__apolloPasteFix`/`__apolloTapFix`/`triggerMouseEvent`）、Playwright モバイル（hasTouch/isMobile/390px）で別名 ttyd:7682 probe にタップ→PTY に SGR mouse press/release 着弾・座標一致、PC クリック非退行、mouse mode 無効時 0 件（非介入）、MC-93/94/100/102/103 非退行。本番 tmux main 不触で検証。[[feedback-review-agent-verify-then-done]] で DONE。 |
| 更新日 | 2026-06-01（起票→IN_PROGRESS→DONE） |

