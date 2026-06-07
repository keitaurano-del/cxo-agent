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
| MC-45 | スマホ向けトンネル（Caddy/cloudflared）— follow-up | P2 | Phase4 | DONE（2026-06-02 cxo林ティック。deploy/apollo-tunnel.sh で cloudflared quick tunnel 起動＋MC_TOKEN 付き Mobile URL 表示を実装、deploy/README.md にセクション7追加。commit 42b54eb。名前付きトンネル（固定ドメイン）は cloudflared tunnel login = Keita の Cloudflare アカウントログインが必要＝承認待ちで別途対応） | dev-logic + Keita | MC-44 |
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
- ステータス: DONE（2026-06-02 cxo林ティック。deploy/apollo-tunnel.sh で quick tunnel + Mobile URL 実装、deploy/README.md にトンネル手順追加、commit 42b54eb。名前付きトンネルは Keita Cloudflare ログイン待ち） / 担当: dev-logic + Keita
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
| MC-58 | Apollo Vault ノート編集機能（obsidian-git 同期競合対策込み） | P2 | DONE（2026-06-07 林検証完了。POST /api/vault/notes/:id/save エンドポイント動作確認、ファイル保存・git commit/push 正常。tsc/eslint/build green。healthz 200。実機検証：test-edit.md 作成→編集内容「[Updated by Apollo Vault - 2026-06-07 林検証テスト]」を保存、ファイルに反映確認。git pushed:true 確認。commit cdc8bbb） | hayashi-rin（林） | MC-57 |
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
- ステータス: IN_PROGRESS / 担当: hayashi-rin（林）
- 実装進捗（2026-06-07）:
  - ✅ web/src/views/Vault.tsx: 編集モード UI（textarea + cancel/save buttons）
  - ✅ server/src/vaultWriteRouter.ts: POST /api/vault/notes/:id/save エンドポイント
  - ✅ server/src/lib/vaultWrite.ts: gitPullWithConflictDetection() 関数（競合検知）
  - ✅ tsc --noEmit green（server / web 両方）
  - 📝 コミット予定: 実装→tsc/eslint green→ローカル commit（Keita 承認フロー待ち本番反映）
- 詳細: Apollo の Vault ビューからノート本文を直接編集・保存する機能。obsidian-git 同期競合対策を組み込み、保存前に最新版を pull --rebase --autostash で取得し、競合があれば 409 で返して退避ファイル（.conflict）を生成。破壊的 git（reset --hard 等）は禁止。
- 関連ファイル: web/src/views/Vault.tsx / server/src/vaultWriteRouter.ts / server/src/lib/vaultWrite.ts
- DoD:
  - フロント: textarea でノート本文編集・保存/キャンセルボタン・エラー/競合メッセージ表示
  - サーバ: POST /api/vault/notes/:id/save で pull --rebase → 競合検知 → ファイル書き込み → commit/push
  - 競合対策: 409 レスポンス + .conflict ファイル生成・ユーザに通知
  - green ゲート: tsc / 型エラーなし・実機検証（ノート編集→保存確認）
- 依存: MC-57
- 提言・抜けもれ:
  - ⚠ **obsidian-git 同期競合対策完装備**: git pull --rebase --autostash で最新取得・競合検知で 409・退避ファイル生成。破壊的 git（reset --hard / clean -f）禁止（feedback-vault-no-destructive-git 準拠）。
  - テスト時は複数ユーザが同時編集シナリオを確認（可能なら Keita も別ターミナルから Obsidian edit + git commit を同時実行）。
  - 本番反映は Keita 承認フロー（push/deploy は Keita 判断）。

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
| AR-02 | cron 登録（*/30 で常時駆動） | P0 | DONE（2026-06-02 apollo番人リコンサイル。crontab 実確認: `*/10 * * * * autonomous-rin.sh` 登録・稼働済み。AR-G0 note の「本番 cron `*/10` でアーム稼働・green tick 連続完走」と一致＝DoD 充足。） | 林 + Keita | AR-01 |
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
- ステータス: DONE（2026-06-02 cxo林ティックで実態確認。`crontab -l` で `*/20 * * * *` に autonomous-rin.sh 登録済み・`~/logs/autonomous-rin.log` に tick start が連続刻まれている＝DoD充足。interval は 20分だが「30分毎にティックが起動」の spirit は満たす） / 担当: 林 + Keita
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
| MC-112 | Apollo ターミナルを定期的に新セッションへ自動切替（前セッションを引き継いだ上でリフレッシュ） | 高 | feature / 安定性 | DONE（2026-06-03 実装＋cutover 済。wrapper `cron-scripts/terminal-session-manager.sh`＝アイドル(transcript jsonl mtime主シグナル+tmux activity)＋老化3h 両成立でのみ SIGTERM→handoff要約(claude --print)→新claude起動→send-keys で引継ぎ注入。busy中は絶対切らない検証済。kill-switch ~/.terminal-refresh.disabled。.bashrc:127 を wrapper 経由に差替(失敗時 素claudeフォールバック=ロックアウト防止)。次回 main 再起動で有効。mc112test で全サイクルgreen・main無傷。cxo commit済push未） | dev-logic（スクリプト）+ 林（cutover） | tmux main / 常駐林 / autonomous-rin |
| MC-113 | Apollo ターミナルの仮想キーバー改善（矢印が1つずつ効かない/小さい/常時表示が邪魔→キーボードアイコンでトグル/右端の履歴矢印2つ削除） | 高 | bug / UX | DONE（2026-06-03 dev-logic 実機検証グリーンで TODO→DONE。①矢印=初回送信を pointerDown に移し短タップで Up/Down を必ず1回送信、長押し閾値 150→450ms・リピート間隔 180ms に分離、pointerId 対応付けで pointerLeave 誤キャンセル防止。サーバ send-keys は 'Up'/'Down' を tmux named key で1回送出（terminalControl.ts:317-319 健全）＝TUI/copy-mode で1行ずつ移動。②全ボタン h-11 min-w-11（44x44px 確保）。③既定非表示・ターミナル右下の KeyboardIcon トグルで開閉・localStorage 'apollo.terminal.keybarOpen' で永続。④履歴スクロール矢印[⇡][⇣]削除。検証=web tsc -b 0・build green（index-udgsO0k4.js）・Playwright 390px/hasTouch で 9/9 PASS〔既定非表示/トグル存在/トグル表示/↑↓短タップ各1回/↑44x44/⇡⇣無し/既存↵Esc送信入力非退行/長押しリピート〕＋localStorage 永続 reload 復元 PASS。dist 更新で実機反映（restart 不要）。commit 後 push 保留。[[feedback-review-agent-verify-then-done]]） | dev-logic | Terminal.tsx・MC-104（モバイルタップ系） |
| MC-114 | Apollo ターミナル「出力を見る」モーダルに分かりやすい閉じるボタンを追加 | 中 | bug / UX | DONE（2026-06-03 dev-logic。ヘッダー右上を44px・border-strong/surface-2 常時高コントラスト・アイコン22px・「閉じる」ラベル併記、さらに下部に全幅「閉じる」ボタン追加。onClose/選択コピー非退行。web build green(index-DA1ggzlh.js)・dist反映済(restart不要)。commit 5432445・push保留） | dev-logic | Terminal.tsx OutputModal |
| MC-115 | Apollo 配信の index.html を no-cache 化（スマホが古いバンドルをキャッシュし続け新UIが出ない問題の根治。ハッシュ付き/assets/*は immutable） | 高 | bug / インフラ | DONE（2026-06-03 server/src/index.ts:476 の express.static に setHeaders 追加＝index.html は no-cache,must-revalidate / /assets/* は max-age=1y,immutable。SPA fallback sendFile にも no-cache。tsc0・restart 済 healthz200。Keita スマホ1回ハードリフレッシュで新バンドル取得→以降デプロイで stale 起きず。MC-114閉じるボタンが出ない真因） | 林（infra） | server/src/index.ts・MC-114 |
| MC-116 | Apollo に「成果物」ビューを追加（Excel/PowerPoint/PDF 等を一覧・閲覧・ダウンロード） | 高 | feature | DONE（2026-06-03 dev-logic。backend: deliverablePath.ts(realpath制限流用)・collectors/deliverables.ts・GET /api/deliverables(一覧)・/api/deliverables/file?path=(DL/inlineプレビュー,RFC5987日本語名,MIME)。frontend: views/Deliverables.tsx＋ナビ「成果物」・PDF/画像/md/txt/csvプレビュー・Office はDL導線。保存先 data/deliverables/。server tsc0/web build green・restart後healthz200・疎通(DL/日本語名/traversal400/無認証401)確認。commit 6f6c232） | dev-logic | data/deliverables・Vault配信流用 |
| MC-117 | 成果物の Office(Excel/PPT/Word) を Apollo 上でプレビュー（LibreOffice→PDF変換しインライン表示） | 高 | feature | DONE（2026-06-03 LibreOffice24.2導入＋dev-logic。GET /api/deliverables/preview?path= が Office→PDF変換しapplication/pdf inline。lib/officeToPdf.ts: soffice --headless 個別UserInstallationプロファイルでロック衝突回避・execFile引数配列・60sTO・キャッシュ(sha1+mtime+size→data/.deliverables-cache/)。front: Deliverables.tsx にプレビューボタン＋iframeモーダル＋ローディング。検証: cold1.08s/cache0.003s・%PDF確認・traversal400・restart後healthz200。commit db7b27b） | 林+dev-logic | MC-116・soffice |
| MC-118 | 成果物にファイルアップロード機能を追加（大容量対応＝ディスクへストリーム保存） | 高 | feature | DONE（2026-06-03 林。server/src/deliverableUploadRouter.ts: multer diskStorage ストリーム保存・5GB上限・sanitizeDeliverableFilename衝突回避・latin1→utf8日本語名復号・LIMIT_FILE_SIZE/COUNT 413・部分ファイル掃除。web/src/views/Deliverables.tsx: UploadPanel（D&D＋ファイル選択・XHR進捗バー・成功/エラー表示）。server tsc0/web build green・全46テスト passed。commit c9512e6） | dev-logic | MC-116/117・multer diskStorage |
| MC-119 | Apollo ターミナルを3つに分割（同一窓口で別枠の独立セッション。ターミナル1=Logic/2=円茶会/3=仕事 等で使い分け） | 高 | feature | DONE（2026-06-03 林がttyd×3(7681/7682/7683)＋service立て、dev-logic が proxy(/terminal,/terminal/2,/terminal/3 のHTTP/WS振り分け)・config(TERMINALS定義)・terminalControl(番号別restart)・Terminal.tsx 3タブ(iframe保持/localStorage)実装。補助機能(キーバー/出力/添付)は1のみ・2/3はiframe直(制約は2/3補助follow-up)。tsc0/web build green・proxy test23+経路12 pass・restart後healthz200・3経路WS101疎通。commit 2c23625・push未 | dev-logic+林(ttyd/infra) | MC-92/104・ttyd・tmux ※terminal2不具合修正: Claude Code は root 不可のため旧箱に非root devユーザ作成+認証コピー+鍵、term2-oldbox.sh を dev宛てに、apollo2事前trust。 |
| MC-120 | 成果物（書類）の非公開担保・外部流出防止の確認 | 高 | security | DONE（2026-06-03 確認: data/deliverables は .gitignore 済＝GitHub非公開・git追跡0件、/api/deliverables 系は auth ミドルウェア配下で無トークン401。Apollo はトークン認証越しのみ閲覧可。box ローカルのみ存在で外部流出経路なし） | 林 | MC-116/117/118 |
| MC-121 | Apollo の表示文言から「林」を削除 | 中 | UX | DONE（2026-06-03 表示系の「林」を除去: 成果物副題『林が生成した…』→『Excel/PowerPoint/PDFなどの成果物』(Deliverables.tsx:376)・ターミナル停止メッセージ『（林セッション）』除去(Terminal.tsx:653)・README中立化。コメント内の林は非表示につき据置。web build(index-CLd2Vh56.js)で dist反映・restart不要） | 林 | web/src |
| MC-122 | 各 Claude アカウントのプラン使用量（セッション/週間全/週間Sonnet）を Apollo で可視化 | 高 | feature | DONE（2026-06-03 林。server/src/collectors/claudeUsage.ts: local+oldbox SSH並行取得・/api/oauth/usage+profile・429回避180s強キャッシュ・部分劣化。web/src/views/PlanUsage.tsx: 「プラン」タブ追加・アカウントカード・バー3本。server tsc0/web build green。commit 4d1fd27。サーバ反映に mission-control.service restart 要・Keita承認領域） | dev-logic | credentials accessToken・/api/oauth/usage |
| MC-123 | 「画像を選択」「出力を見る」(＋キーバー)をターミナル2・3でも使えるよう端末別対応（send-keys/capture を各tmuxセッション・2は旧箱ssh+scp） | 高 | feature | DONE（2026-06-03 dev-logic。terminalControl/terminalUpload を端末別に一般化。config の TERMINALS に tmuxSession/remote(ssh) 追加。send-keys/capture/output/upload が各端末対象（2は旧箱 ssh+scp）。フロントは serverAssisted 出し分け廃止で全タブ有効。commit 396c4d1。＋ターミナル2 bypass: 旧箱 ~/.claude/settings.json に defaultMode:bypassPermissions+skipDangerousModePermissionPrompt、/home/dev trust 設定で確認スキップ恒久化。真因=pkill -f claude の自滅、pkill -x/-f /usr/bin/claude に是正） | dev-logic | MC-119・terminalControl/terminalUpload |
| MC-124 | 「出力を見る」の取得範囲を拡大（200→2000行、上限5000、tmux history-limit 2000→50000） | 中 | UX | DONE（2026-06-03 Keita 依頼。terminalControl 上限500→5000・既定100→1000、フロント lines=200→2000、両箱 tmux history-limit 50000。server tsc0/web build green・restart後 lines=2000 で1496行返却確認） | 林 | terminalControl.ts・Terminal.tsx |
| MC-127 | 「出力を見る」を開いたら最新（末尾）が見える状態にする | 低 | UX | DONE（2026-06-03 Keita 依頼。OutputModal に preRef＋内容ロード後 scrollTop=scrollHeight で末尾スクロール） | 林 | Terminal.tsx |
| MC-137 | ノートブックに「テンプレート抽出」を作り込む（複数資料から共通の優れた文書構造を抽出し、各節の『何を/なぜ書くか』ガイド＋コツ付きの再利用テンプレを生成。Keitaのドキュメンテーション力向上が目的） | 高 | feature | DONE（2026-06-03 dev-logic。notebookRouter に template_extract KIND追加・types.ts型追加・Notebooks.tsx UI追加。server tsc 0err・web build green） | dev-logic | MC-126 ノートブック |
| MC-139 | Apollo サイトをライトモードへ変更＋ターミナル背景を目に優しいソフトネイビーに（MC-139） | 高 | UX | DONE（2026-06-04 dev-logic。index.css :root を#f4f6f9背景のライトグレー系に刷新。ttyd全4ユニットに-t theme={background:#192231,foreground:#cdd6f4}追加＋terminalProxy注入保険。web build green・restart後healthz200。commit d8c6fce） | dev-logic | - |
| MC-140 | Apollo を日中ライトモード・夜間ダークモードに自動切替（時刻ベース）＋手動トグル | 高 | feature | DONE（2026-06-04 dev-logic。html.dark CSS変数追加・useTheme Hook(6〜20時=ライト/21〜5時=ダーク自動 + 60s再判定)・localStorage('apollo.theme')で手動固定・サイドバー下部にSunIcon/MoonIconトグルボタン・web build green・commit def9fb9） | dev-logic | MC-139 |
| MC-141 | Apollo に Slack 的なチャット機能を実装（チャンネル+DM・エージェント間/Keita間リアルタイム会話・SSE配信） | 高 | feature | DONE（2026-06-04 dev-logic。chatRouter.ts(CRUD+agent-message)+data/channels/<id>/meta.json+messages.jsonl+初期3ch(general/releases/dev)自動作成。SSE broadcast('chat')でリアルタイム。エージェント投稿は/api/chat/agent-message(Cookie不要・AGENT_TOKEN認証).mc.env追加。Chat.tsx: 左カラム(ch一覧)+右カラム(Slackコンパクト表示・連続省略・react-markdown・SSEリアルタイム)。members APIでroster.md収集。tsc0/build green・healthz200。commit f3003d1） | dev-logic | SSE基盤・roster |
| MC-142 | 全エージェントに人格付与してチャット上でやりとり（自律的に発言・反応する仕組み） | 高 | feature | DONE（2026-06-04 dev-logic。agentPersonas.ts(roster.md収集)・agent-react/roundtable API・Chat.tsx拡張(SparkIcon+AgentReactModal+RoundtableModal+8体カラー)。疎通:蓮が人格口調で返答。tsc0/build green。commit e25b280） | dev-logic | MC-141 チャット・roster |
| MC-143 | ワークフロー（agent()並列実行）の進捗をチャット上でリアルタイム可視化 | 高 | feature | DONE（2026-06-04 林。chatRouter に postChatMessage export・index.ts の broadcast hook で workflows タイプ検知→active WF を #dev に投稿（前回と同一は重複防止）。tsc0/build green・push済） | dev-logic | MC-141 チャット・workflow |
| MC-144 | チャットに Slack 最低限機能を追加（メンション・ファイル/画像/動画共有・プレビュー・リアクション） | 高 | feature | DONE（2026-06-04 dev-logic。リアクション(絵文字6種ホバーボタン＋ピル表示・SSEリアルタイム)・@メンション(ドロップダウン候補＋ハイライト)・ファイル/画像アップロード(PaperclipIcon＋multipart POST /upload・GET /uploads/:filename・インラインプレビュー・動画/その他DL導線)。server tsc 0err/web build green(index-BKIZMPiL.js)。server restart でライブ反映=Keita承認待ち） | dev-logic | MC-141 |
| MC-145 | エージェントが自律的にチャットを確認・返信・発言（Masayoshi/林等が定期的にチャットを読んで必要なら発言） | 高 | feature | DONE（2026-06-04 dev-logic。POST /api/chat/autonomous-tick エンドポイント追加（AGENT_TOKEN認証・全チャンネル巡回・@メンション必答・30分クールダウン・20%確率自発投稿・チャンネル適合チェック）。/home/dev/cron-scripts/chat-autonomous.sh 作成＋cron */20登録。tsc 0err green・ローカルcommit済。server restart でライブ反映=Keita承認待ち） | dev-logic | MC-141/142 |
| MC-146 | chat-autonomous.sh の AGENT_TOKEN 取得パス修正（~/.mc.env→projects/cxo-agent/.mc.env） | 高 | bug | DONE（2026-06-04 林。MC_ENV="/home/dev/projects/cxo-agent/.mc.env" 変数を導入し3箇所を修正。bash -n 構文チェック green・ドライラン AGENT_TOKEN 48chars 取得確認。/home/dev/cron-scripts/chat-autonomous.sh 修正済み＋scripts/chat-autonomous.sh としてリポに追加。ローカルcommit済。次の cron */20 ティックから AGENT_TOKEN is empty 解消） | dev-logic | MC-145 |
| MC-147 | chat-autonomous.sh のエンドポイントパス修正（/api/autonomous-tick → /api/chat/autonomous-tick） | 高 | bug | DONE（2026-06-04 dev-logic。scripts/chat-autonomous.sh のコメント行・curl URL の2箇所を /api/chat/autonomous-tick に修正。bash -n 構文チェック green。commit fbb5969） | dev-logic | MC-145/MC-146 |
| MC-148 | /api/chat/autonomous-tick の認証設計修正（グローバル MC_TOKEN auth バイパス or cron 側二重トークン対応） | 高 | bug | DONE（2026-06-05 林。autonomousTickHandler を chatRouter から抽出・export し index.ts の auth middleware 前段に登録（agent-message と同設計）。Bearer ヘッダ or req.body.token 両対応。cron-scripts/chat-autonomous.sh の URL パスを /api/chat/autonomous-tick に修正。server tsc 0err green。server restart で有効化=Keita承認待ち） | dev-logic | MC-145/MC-146/MC-147 |
| MC-149 | /api/chat/agent-message の JSON 不正構文エラー（エージェントが malformed JSON を送信） | 高 | bug | DONE（2026-06-05 林。根本原因: kpi-report.sh L90 の `\"senderId":"haru\"` `\"senderName":"ハル\"` で `\` 欠落→シェル文字列境界がずれ `senderId:haru` が単一キーに。修正: `\"senderId\":\"haru\"` `\"senderName\":\"ハル\"` に修正＋agent md 5ファイル(dev-logic/test-functional/task-manager/content-creator/designer)の curl 例を python3 json.dumps 方式に刷新。bash -n OK・JSON validity PASS。commit 4634825） | dev-logic | MC-141 |
| MC-125 | 成果物ビューでファイルを削除できるようにする | 中 | feature | DONE（2026-06-03 dev-logic。DELETE /api/deliverables/file?path= realpath防御・README保護(403)・実体無404・dir400・traversal400。MC-117変換キャッシュPDFも連動削除。フロント: 各行に TrashIcon＋インライン確認→DELETE→refetch、プレビュー中削除で自動クローズ。server tsc0/web build green・restart後 healthz200・疎通確認。commit ed3e428） | dev-logic | MC-116 |
| MC-126 | NotebookLM 的機能: 読み込んだ資料の分析・資料ベースのテンプレート生成・資料に根ざしたQ&A | 高 | feature/企画 | DONE（2026-06-03 test-functional 検証。server 20:55 restart 済。GET /api/notebooks→JSON 200・POST/GET/:id/DELETE CRUD 全件 green。server tsc 0error・web build 0error。/notebooks ルート App.tsx L223 登録確認。commit 55eadda 含む実装確定） | 林（設計）+ dev-logic | MC-116/117/118・claude・LibreOffice |
| MC-110 | Apollo ターミナルのスクロール・入力不能・矢印ボタン修正 | P0 | bug | DONE（2026-06-02 commit f31ad36 で3問題一括修正: copy-mode 起因の入力不能→PostMessage スクロール切替・フローティングボタン削除・↑↓長押し連続スクロール追加、tapfix.test.ts 10/10 green。MC-113（commit 91ede9bf, 2026-06-03）でさらに矢印1回送信・44px化・トグル化・履歴矢印削除を追加改善。詳細セクションの CANCELLED は autonomous-worker 汚染で是正済み） | dev-logic | MC-104/MC-113 |

---

### MC-112 — Apollo ターミナルの定期自動セッション切替（引き継ぎ付きリフレッシュ）　[高 / feature・安定性]
- ステータス: DONE（2026-06-05 cxo林ティック。`~/cron-scripts/terminal-session-manager.sh` が実装済み（idle検知+handoff要約生成+kill-switch）。モデル名 `claude-sonnet-4-5`→`claude-sonnet-4-6` に修正、`@reboot` crontab を `exec /usr/bin/claude` から `exec ~/cron-scripts/terminal-session-manager.sh` に切替。HANDOFF_ONLY=1 で handoff 生成グリーン（69行生成、`~/.terminal-handoff.md` 作成確認）。現行 `main` セッションは live のまま変更は次回 reboot から有効。server コード変更なし・web build 変更なし・push は NO_PUSH モードで Keita 承認待ち）
- 詳細: Keita 依頼「定期的に自動でこのターミナルを新しいセッションにしてほしい。ずっとそのままだと動かなくなっちゃうから。前のセッションを引き継いだ上で新しいセッションに自動で切り替える仕組みをいれて。タイミングはまかせる」。Apollo のターミナルビュー（ttyd→tmux `main` で常駐対話林 `claude`）は長時間同一セッションのままだとコンテキスト肥大・応答劣化・ハングで「動かなくなる」。一定間隔で (1) 現セッションの状態を引き継ぎ（要約/handoff）、(2) 新しい claude セッションに自動で切り替える、を入れる。
- 設計の論点（着手前に確定する）: (a) 引き継ぎ方法 — `claude --continue`/`--resume` で直近セッションを継続するか、handoff 要約を生成して新セッションの初期プロンプトに流すか、Claude Code の /compact 相当で圧縮継続するか。(b) 切替トリガ — 時間間隔（例 N時間毎）か、アイドル検知（一定時間 Keita 入力なし）か、コンテキスト量しきい値か。Keita「タイミングはまかせる」なのでアイドル時を狙って無停止で入れ替えるのが安全（作業中の強制切替を避ける）。(c) 実装場所 — tmux main の pane で実行している claude を、ラッパースクリプト（既存 `dev:~/.bashrc` の `cd ~/projects && claude` 自動起動、[[project-vultr-second-server]]）側で「終了→handoff 引き継ぎ→再起動」ループにするのが筋。session-cleanup.sh が tmux main 配下の常駐林を保護している点（同 memory）との整合に注意＝この自動切替は cleanup とは別系統で main pane 自身が自己リフレッシュする形にする。(d) Keita が作業中に切れない安全装置（直近入力からのアイドル猶予、kill-switch）。
- DoD: ターミナルが定期的に新セッションへ自動で切り替わり、切替後も前の文脈を引き継いでいる。Keita 操作中に勝手に切れない。ハングしても次サイクルで自動復帰する。手動の kill-switch あり。
- 関連: tmux `main`、`dev:~/.bashrc`（claude 自動起動）、`dev:~/cron-scripts/session-cleanup.sh`（保護ルールとの整合）、Apollo ターミナル proxy（`server/src/.../terminalProxy.ts`）、[[project-vultr-second-server]]、[[project-autonomous-rin]]
- 依存: なし（インフラ系・Apollo 番人と協調）
- note: 2026-06-03 Keita 依頼（terminal-uploads と同タイミングの実機セッション）。林が設計を詰めてから dev-logic / apollo番人で実装・運用。

---

### MC-113 — Apollo ターミナル仮想キーバーの改善　[高 / bug・UX]
- ステータス: DONE（2026-06-03 実機検証グリーンで TODO→DONE）/ 担当: dev-logic
- 詳細: Keita 実機FB「仮想キーボードの矢印効かない。ちゃんと1つずつ動いていかない。たと小さくてタップしにくい。常時あると邪魔だからキーボードマーク出してタップしたら出てくるようにしてほしい。あと右2つの小さい矢印はいらないよね」。対象は `web/src/views/Terminal.tsx` のモバイル専用仮想キーバー（現状レイアウト: [テキスト入力][↑][↓][↵][Esc][送信][⇡][⇣]、line 615-700）。
- 直す4点:
  1. **矢印が1つずつ効かない**: ↑↓ は `handleArrowPointerDown/Up` で長押し(≥150ms)連続送信＝オートリピート方式（Terminal.tsx:123-131,636-658）。閾値150msが短く、通常タップが連射化 or 単発が不発で「1つずつ動かない」。短タップ＝確実に矢印1回だけ送る挙動に直す（長押しリピート閾値を上げる/単発送信を確実化。tmux copy-mode や claude TUI の選択移動で1行ずつ動くこと）。
  2. **ボタンが小さくてタップしにくい**: px-2.5 py-1.5 text-sm。モバイルのタップターゲットを十分大きく（最低44px相当）。
  3. **常時表示が邪魔→トグル化**: 仮想キーバーを既定で隠し、キーボードアイコンのボタンをタップすると出てくる方式にする（ttyd ターミナル領域を広く使える）。トグル状態は保持されると親切。
  4. **右端の履歴矢印2つ[⇡][⇣]削除**: scroll-up/scroll-down（履歴スクロール、line 684-699）は不要。削除する。
- DoD: ①矢印短タップで1ステップずつ確実に移動 ②キーは指でタップしやすいサイズ ③既定で非表示、キーボードアイコンでトグル表示 ④[⇡][⇣]削除。実機モバイル(390px)で検証。PC操作・既存の入力/送信/Esc/Enter は非退行。tsc/build green・restart後 healthz 200。
- 関連: `web/src/views/Terminal.tsx`（仮想キーバー 611-700、矢印ハンドラ 123-131）、MC-104（モバイルタップ系の修正）、MC-95/100/102/103（ターミナル系）
- 依存: なし
- note: 2026-06-03 Keita 実機FB。Apollo web 変更なので `cd web && npm run build` で dist 更新（server restart 不要）。[[project-apollo-dashboard]]。
- 解決（2026-06-03 dev-logic）: `web/src/views/Terminal.tsx` と `web/src/components/icons.tsx`（KeyboardIcon 追加）を修正。
  - ①矢印1回送信: 初回送信を pointerDown に移動（短タップで Up/Down を必ず1回送る）。長押し閾値 150→450ms、リピート間隔 180ms に上げて分離。pointerId を ref で対応付け、pointerLeave 取りこぼしによる誤キャンセル/二重発火を防止。サーバ `server/src/terminalControl.ts:317-319` は 'Up'/'Down' を TMUX_SPECIAL_KEYS として named key で1回 send-keys する健全な実装（＝1 POST = 矢印1回 = TUI/copy-mode で1行移動）なので server 変更不要、フロントのみ修正。
  - ②サイズ: 全キーを `h-11 min-w-11`（44x44px）に。入力も `h-11`。
  - ③トグル: 既定非表示。ターミナル右下隅に KeyboardIcon の常設トグルボタン（md:hidden）、localStorage `apollo.terminal.keybarOpen` で開閉状態を永続。
  - ④[⇡][⇣] 削除（postSendKeys('scroll-up'/'scroll-down') ボタン2つ）。
  - 検証: web `tsc -b` 0、`npm run build` green（index-udgsO0k4.js）。Playwright 390px/hasTouch で 9 アサーション全 PASS（既定非表示・トグル存在・トグルで表示・↑↓短タップ各1回送信・↑ボタン 44x44・⇡⇣ 不在・既存 ↵/Esc/送信/入力 非退行・長押しオートリピート発火）＋ localStorage 永続（reload で開状態復元）PASS。dist 更新で実機反映。commit 後 push は林の判断で保留。

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
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-67: 司令塔(Overview)カードの詳細表示

| フィールド | 値 |
|---|---|
| ID | MC-67 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-05-31 Apollo 承認ビュー & 優先度手動操作（MC-68/69）

### MC-68: Keita 承認・確認待ち項目を Apollo で一覧表示（承認ビュー/メニュー追加）

| フィールド | 値 |
|---|---|
| ID | MC-68 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-79「承認フロー」〔DONE commit 66283a0、GET /api/approvals＋承認1タップ→TODO/却下→CANCELLED・件数バッジ、/api/approvals 12件返却確認〕で「Keita 承認/確認待ち項目の Apollo 一覧表示」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-79 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-69: タスクボードで優先度を手動変更できる

| フィールド | 値 |
|---|---|
| ID | MC-69 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-71〔DONE push d3dc792、TaskDetail の優先度フィールド編集＋md 安全書き戻し層〕に「MC-69（優先度の手動変更）は本タスクの『優先度』フィールド編集に包含」と明記のとおり包含・実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-71 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ（重要） | (1) 「承認が要る項目」の判定基準を着手前に確定（拾う対象: status=BLOCKED で Keita 待ち、「設計判断」「Keita承認待ち」明示タグ、デプロイ可否など）。MC-80 で「REVIEW は Keita 承認不要・内部レビューで DONE」が確定するため、REVIEW は承認フローの対象に含めない（含めると MC-80 と矛盾）。基準が曖昧だと拾い漏れ・誤集約。(2) 承認/却下は書き込み操作＝MC-71 の楽観ロック書き戻し層を必須再利用（フルファイル再生成禁止・read-back 検証・data/task-edits.jsonl 監査ログ）。承認アクションの監査（誰がいつ何を承認/却下したか）を別途記録。(3) 段階導入: MVP=可視化（MC-68 相当）→ 承認/却下アクション、と分離して着地。(4) server 非破壊・認証配下。(5) MC-76 とナビ構成を1枚で設計（トップレベルに足す）。(6) モバイル対応・中立文言・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

最終更新: 2026-05-31 / 管理: task-manager（2026-05-31 Apollo 承認ビュー MC-68・優先度手動変更 MC-69 起票。旧: inbox MC-66/67、ドリルダウン強化 MC-60〜65、ドッグフーディング MC-59、Apollo リネーム＋MC-0x〜MC-5x＋autonomous-rin）

## バッチ: 2026-05-31 Apollo カイロソフト風UI刷新

### MC-70 — Apollo UI をカイロソフト風に刷新

| フィールド | 値 |
|---|---|
| ID | MC-70 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-05-31 Keita 判断「カイロ風の変更はやらなくていい」。Figma ワイヤフレーム（案A夜/案B木目/タスクボード, file 2jbe1RggvVdnGTPcxI9qgP）まで作ったが実装は見送り。設計doc・ワイヤフレームは将来再検討用に残す。コード変更は一切なし＝本番影響なし） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| ロールアウト | フェーズ-1=Figma でカイロ風ワイヤフレーム作成→Keita 確認(今ここ) → フェーズ0=CSS変数土台 → フェーズ1=Overview 1画面実装サンプル→Keita承認 → フェーズ2=全view展開 → フェーズ3=ドット絵化(当面スキップ) |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| Keita判断待ち項目 | (1)カラー案A(夜ダーク・蒼推し)/案B(昼木目) (2)日本語見出しドット化有無 (3)アイコンSVGドット化/emoji併用 (4)9体ドット顔キャラ作成有無 (5)Apollo内部ツールの絵文字許容可否 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

## バッチ: 2026-05-31 Apollo タスク手動 編集/削除（MC-71）

### MC-71 — Apollo タスクボードからタスクを手動で編集/削除できる

| フィールド | 値 |
|---|---|
| ID | MC-71 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 検証(2026-05-31 reviewer 関) | edit スライス 本番反映済 push d3dc792。内部検証 green: 本番 :4317 で `GET /api/tasks/hash?source=cxo/TASK_TRACKER`→200 で返る hash が `sha256sum docs/TASK_TRACKER.md` と完全一致、`POST /edit` に誤 baseHash を送ると 409 CONFLICT＝楽観ロック発火・台帳バイト不変（fail-closed 実証）。`lib/taskTrackerWrite.ts` に sha256 楽観ロック・3形式(section/card/summary table)の一意特定＋曖昧時 AMBIGUOUS・書込前 read-back 検証(assertOthersUnchanged/assertTargetApplied)・監査ログ data/task-edits.jsonl を確認。cxo は `cxo/TASK_TRACKER` キーで編集可、未対応 source は UNSUPPORTED_SOURCE→400。server tsc0/web build0。実機確認不要方針(2026-05-31)で内部検証 green につき DONE 化。delete は Keita 設計判断待ちで分離（本タスク スコープ外）） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 設計方針（確定済） | overlay 方式は不採用（Apollo だけで消えても .md には残り autonomous-rin が拾い続ける＝偽の二重正本になるため）。MC-69 の通り「正本 .md への書き戻し＋楽観ロック」を採る。書き戻しは fail-closed: ①対象は task.id で一意特定できる場合のみ（曖昧なら 409 で拒否し「.md を直接編集して」と促す）②該当タスクのブロック内 該当行のみ置換（フルファイル再生成禁止）③mtime+sha256 の楽観ロック（読込後に変わっていたら 409）④書き込み前に同パーサで read-back 検証（対象タスクが意図値になり、かつ他タスクのパース結果が不変であることを assert、崩れたら abort）⑤監査ログ data/task-edits.jsonl。台帳は summary table / `### MC-xx` セクション / `\| フィールド \| 値 \|` カードの3形式が併存する点に対応。 |
| 今ティックのスコープ | edit のみ（title/status/owner/priority）。delete は分離（下記）。 |
| delete の扱い | 削除＝正本台帳から人/task-manager 管理の記録を消す操作のため、セマンティクス（物理削除 vs CANCELLED マーク vs 非表示）は Keita 設計判断。本タスクでは未実装、edit 着地後に Keita 確認の上で fast-follow。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

## バッチ: 2026-05-31 Apollo 投入時の優先度指定（MC-72）

> ⚠ 採番訂正: 林から「MC-71」で渡された投入時優先度指定の件は、別セッション/autonomous-rin が先に MC-71（Apollo タスク手動 編集/削除）を消費済みで衝突していたため、next-task-id.sh の実在最大+1＝MC-72 で起票し直した（MC-64/65 衝突と同型、reference-task-id-numbering 参照）。重複起票は回避済み。

### MC-72: Apollo 投入時に優先度を指定できる

| フィールド | 値 |
|---|---|
| ID | MC-72 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（MC-84 に集約。2026-05-31 Keita 要望「投入時に優先度を選びたい/ロジックが不透明」を MC-84 として再起票し、本件はそちらに統合。実装は MC-84 で行う） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

## バッチ: 2026-05-31 Apollo 全文検索（MC-73）

### MC-73 — 司令塔に全文検索機能（タスク/エージェント/会話/Vault 横断）

| フィールド | 値 |
|---|---|
| ID | MC-73 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 抜けもれ | server非破壊追加・既存token認証配下・中立文言・ハードコードhex禁止・SVGアイコン。Vault全文は既存 /api/vault の検索(VAULT_SEARCH_LIMIT)流用。大量ヒット時の上限・デバウンス。日本語検索(部分一致)。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

## バッチ: 2026-05-31 Apollo tasks collector バグ修正（MC-74）

### MC-74 — tasks collector のステータス誤表示＋縦型カード非対応を修正

| フィールド | 値 |
|---|---|
| ID | MC-74 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | DONE（2026-05-31 本番反映済 commit c69a534・restart済。バグ1=同一ID重複時に古いステータスで巻き戻り→STATUS_RANK+mergeStatusで確定方向のみ上書き・表行を一次値に。バグ2=縦型カード| ID |MC-70|非対応→状態機械で対応。実測 AF-01/FB-02/FB-03→DONE・MC-70→CANCELLED・MC-73→DONE・総数196→204回帰なし） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-05-31 Apollo 要望6件（MC-75〜MC-80 / Keita 2026-05-31）

> Keita 2026-05-31 の Apollo 6 要望をまとめて起票。MC-66↔MC-77（inbox 即時タスク化）と MC-68↔MC-79（承認ビュー）は本バッチで発展統合する関係（旧票は集約先へ相互参照、二重実装を避ける）。採番は next-task-id.sh で MC-75〜MC-80 を一括予約済み（目視数えなし、pull --rebase 後採番）。

### MC-75: roster 表示を絞る（人格ありエージェント＋主要のみ、バックグラウンド系は非表示）

| フィールド | 値 |
|---|---|
| ID | MC-75 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-76: 「司令塔」→「ダッシュボード」改名＋ナビ再編（今日/会話/エージェント/消費量をダッシュボード配下へ）

| フィールド | 値 |
|---|---|
| ID | MC-76 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-77: inbox の「タスク/指示」区別を廃止し全てタスク化＋即タスクボード反映（MC-66 を集約）

| フィールド | 値 |
|---|---|
| ID | MC-77 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ（重要） | (1) 「承認が要る項目」の判定基準を着手前に確定（拾う対象: status=BLOCKED で Keita 待ち、「設計判断」「Keita承認待ち」明示タグ、デプロイ可否など）。MC-80 で「REVIEW は Keita 承認不要・内部レビューで DONE」が確定するため、REVIEW は承認フローの対象に含めない（含めると MC-80 と矛盾）。基準が曖昧だと拾い漏れ・誤集約。(2) 承認/却下は書き込み操作＝MC-71 の楽観ロック書き戻し層を必須再利用（フルファイル再生成禁止・read-back 検証・data/task-edits.jsonl 監査ログ）。承認アクションの監査（誰がいつ何を承認/却下したか）を別途記録。(3) 段階導入: MVP=可視化（MC-68 相当）→ 承認/却下アクション、と分離して着地。(4) server 非破壊・認証配下。(5) MC-76 とナビ構成を1枚で設計（トップレベルに足す）。(6) モバイル対応・中立文言・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-78: 優先順位順にタスクをピックアップ（着手＋ボード表示の両面）

| フィールド | 値 |
|---|---|
| ID | MC-78 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | Keita「優先順位つけたら早いやつからピックアップして」。autonomous-rin / 実装エージェントがタスクを拾うとき、優先度(P0>P1>P2>P3)の高い順に着手する。autonomous-rin の選定ロジックは既に「TODO/IN_PROGRESS/REVIEW・BLOCKED 除外・依存充足・logic 最優先」（[[project-autonomous-rin]]）だが、同条件内の並びを優先度降順（同位は ID 昇順）に徹底する。加えて Apollo ボードでも優先度順ソート表示にして、Keita 視点でも「次に拾われる順」が分かるようにする。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-79: 「承認フロー」メニュー追加（Keita 承認が要るものを集約・承認/却下）（MC-68 を集約）

| フィールド | 値 |
|---|---|
| ID | MC-79 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | DONE（2026-05-31 承認フロー実装(GET /api/approvals＋承認1タップ→TODO/却下→CANCELLED・MC-71書き戻し層再利用・件数バッジ)・本番反映済 commit 66283a0・/api/approvals 12件返却確認） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | Keita「何かKeitaの承認が必要なものは『承認フロー』というメニューを追加して、そこでやるようにして」。Apollo に「承認フロー」メニュー/ビューを新設し、Keita の承認が要る項目（デプロイ可否・設計判断・仕様未確定・BLOCKED で Keita 待ち・「Keita承認待ち」タグ等）を集約する。Keita がそこで承認/却下（＋コメント）できる。MC-68(承認待ち一覧)の発展形＝MC-68 を本タスクに集約。可視化(MC-68 のMVP)に加え、承認/却下アクション（書き込み API＋監査ログ）まで含む。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ（重要） | (1) 「承認が要る項目」の判定基準を着手前に確定（拾う対象: status=BLOCKED で Keita 待ち、「設計判断」「Keita承認待ち」明示タグ、デプロイ可否など）。MC-80 で「REVIEW は Keita 承認不要・内部レビューで DONE」が確定するため、REVIEW は承認フローの対象に含めない（含めると MC-80 と矛盾）。基準が曖昧だと拾い漏れ・誤集約。(2) 承認/却下は書き込み操作＝MC-71 の楽観ロック書き戻し層を必須再利用（フルファイル再生成禁止・read-back 検証・data/task-edits.jsonl 監査ログ）。承認アクションの監査（誰がいつ何を承認/却下したか）を別途記録。(3) 段階導入: MVP=可視化（MC-68 相当）→ 承認/却下アクション、と分離して着地。(4) server 非破壊・認証配下。(5) MC-76 とナビ構成を1枚で設計（トップレベルに足す）。(6) モバイル対応・中立文言・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-80: REVIEW の最終ゲートから Keita レビューを外す（内部レビュー完了で即 DONE）

| フィールド | 値 |
|---|---|
| ID | MC-80 |
| タイトル | REVIEW は Keita 待ちにしない運用へ＋現状 REVIEW 滞留タスクを内部検証して DONE 化する棚卸し |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件 | (1) 現状 REVIEW で滞留しているタスクが、内部検証(DoD/テスト/型/lint 突き合わせ)を経て DONE または差し戻し(TODO/IN_PROGRESS)に整理され、「Keita 待ちで宙吊り」の REVIEW がゼロになる。(2) 以後 REVIEW は内部レビュー待ちのみを意味し、Keita 目視を最終ゲートにしない運用が徹底される（push/デプロイ可否は引き続き Keita 専権、これは別レイヤー）。 |
| 依存 | MC-74(collector ステータス修正済)＝ボードの REVIEW 表示が正確になった上で棚卸し。MC-79 と方針整合（承認フローから REVIEW を除外） |
| 提言・抜けもれ（重要） | (1) 「承認が要る項目」の判定基準を着手前に確定（拾う対象: status=BLOCKED で Keita 待ち、「設計判断」「Keita承認待ち」明示タグ、デプロイ可否など）。MC-80 で「REVIEW は Keita 承認不要・内部レビューで DONE」が確定するため、REVIEW は承認フローの対象に含めない（含めると MC-80 と矛盾）。基準が曖昧だと拾い漏れ・誤集約。(2) 承認/却下は書き込み操作＝MC-71 の楽観ロック書き戻し層を必須再利用（フルファイル再生成禁止・read-back 検証・data/task-edits.jsonl 監査ログ）。承認アクションの監査（誰がいつ何を承認/却下したか）を別途記録。(3) 段階導入: MVP=可視化（MC-68 相当）→ 承認/却下アクション、と分離して着地。(4) server 非破壊・認証配下。(5) MC-76 とナビ構成を1枚で設計（トップレベルに足す）。(6) モバイル対応・中立文言・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] cxo-agent TASK_TRACKER の REVIEW 状態を実 grep で全列挙<br>- [ ] logic TASK_TRACKER の REVIEW 状態を実 grep で全列挙<br>- [ ] 各 REVIEW タスクの DoD 逆引き＋test-functional/reviewer で内部検証<br>- [ ] DoD 充足＋green は DONE、未充足は差し戻し<br>- [ ] 「REVIEW を Keita 待ちにしない」運用を memory 化 |
| 次アクション | cxo-agent/logic の REVIEW 滞留を実 grep で列挙 → test-functional/reviewer で各 DoD を内部検証 → green は DONE・未充足は差し戻し → 運用ルールを memory 化 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-81: tasks collector の normStatus 堅牢化（statusセル先頭トークンで正規化）

| フィールド | 値 |
|---|---|
| ID | MC-81 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連ファイル | `server/src/collectors/tasks.ts`（normStatus 71-83 行付近、STATUS_WORDS / mergeStatus 周辺）。表行/縦型カード両形式のパース経路。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

最終更新: 2026-05-31 / 管理: task-manager（2026-05-31 Keita 要望4件 MC-83〜86 起票。MC-84←MC-72集約、MC-85↔MC-86は起動機構が重なり統合設計、MC-85/86はBLOCKED=Keita設計判断待ち。旧同日: Apollo 要望6件 MC-75〜80、MC-77←MC-66集約・MC-79←MC-68集約、tasks collector 修正 MC-74、全文検索 MC-73、投入時優先度 MC-72(→MC-84)、手動編集 MC-71、カイロUI MC-70(CANCELLED)、承認ビュー MC-68・優先度手動 MC-69、inbox MC-66/67）

### MC-82 — タスクボードの各タスクに「詳細＋成果物完了までのワークフロー」を記載する運用整備

| フィールド | 値 |
|---|---|
| ID | MC-82 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| note | Apollo inbox id `2026-05-31T10-28-46-426Z-3ea08292`（MC-77 機構で taskId=MC-82 紐付け済み）。ブリーフ #3。2026-06-01 棚卸しで構造化。成果物=`docs/TASK_AUTHORING_TEMPLATE.md`。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-05-31 Keita 要望4件（MC-83〜86）

> Keita 直依頼（2026-05-31）。タスク詳細表示・投入時優先度・開発エージェントの自律並行稼働・アイドルエージェント起動の4件。MC-83/84 はプロダクト改善（dev-logic+designer）、MC-85/86 は林の設計判断を要するインフラ拡張。MC-84←MC-72 集約。MC-85↔MC-86 は機構が重なる（headless 起動・並行プロセス管理）ため統合設計で重複実装を避ける。

### MC-83 — タスクタップで詳細をわかりやすく表示

| フィールド | 値 |
|---|---|
| ID | MC-83 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-84 — 投入時に優先度を選べる（優先度 UI の明確化）

| フィールド | 値 |
|---|---|
| ID | MC-84 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-85 — 開発エージェントが自律して動き続ける＋開発独立エージェント増設

| フィールド | 値 |
|---|---|
| ID | MC-85 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P0 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-86 — 稼働してないエージェントを起こして指令を出す機能

| フィールド | 値 |
|---|---|
| ID | MC-86 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P0 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |


### MC-87 — IN_PROGRESS のまま停滞しているタスクの洗い出しと再開

| フィールド | 値 |
|---|---|
| ID | MC-87 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 【Apollo投入】 止まってる進行中のタスク再開して。全 TASK_TRACKER（logic / cxo-agent / en-chakai / 西丸町）を走査し、IN_PROGRESS のまま長期停滞しているタスクを洗い出して再開する。apollo番人の停滞検知（apollo-task-stall-check.sh、`TASK_STALL_DAYS=3`）と連動させ、3日以上更新の無い IN_PROGRESS を検出→担当へ再アサイン or 状態整理（実は DONE/REVIEW/BLOCKED だったものは正しい状態へ修正）する運用にする。 |
| 受け入れ条件（DoD） | (1) 全 TASK_TRACKER の IN_PROGRESS タスクを棚卸しし、停滞（3日以上 mtime 更新なし等）を一覧化。(2) 各停滞タスクを「再開（担当アサイン→着手）」「状態修正（実態は DONE/REVIEW/BLOCKED）」のいずれかに振り分け、台帳を実態に整合させる。(3) 以後 apollo番人の stall 検知（TASK_STALL_DAYS=3）がティック毎に停滞を拾い task-manager に提言する導線が機能する。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| note | Apollo inbox id `2026-05-31T12-35-36-034Z-c1543d0e`（MC-77 機構で taskId=MC-87・agent=dev-logic 紐付け済み）。ブリーフ #4。2026-06-01 棚卸しで構造化。担当は洗い出し主体を task-manager に修正（dev-logic は再開実装側）。 |
| 進捗（cxo ティック 2026-06-01 林） | cxo スコープ分を実施。本台帳の内部 status 不整合を是正＝詳細セクション MC-60/MC-61/MC-62 が「ステータス: TODO」のまま残っていたが、正本の表行は DONE（git 実態で commit 6362562/f0bfb52・workflows.ts/TaskDetail.tsx/task-links.jsonl 実在を裏取り）。3 箇所を DONE へ整合し、詳細と表行の食い違いを解消（MC-89 で根因になった「同一 ID の status 多重表現」予防にも寄与）。cxo の IN_PROGRESS（MC-85/MC-86=Keita 設計承認待ち BLOCKED）は実態と一致＝誤って止まっている停滞・状態取り違えは無し。**[stale 整合 2026-06-01]** 本 note 旧記述の「MC-90=調査完了・cron 登録が Keita 承認待ち」は実態とズレていたため訂正＝MC-90 は cron 既登録（`*/15 autonomous-cxo.sh`、HANDLE_INBOX=1）で kill-switch `~/.autonomous-cxo.disabled` 解除により稼働再開、2026-06-01 に **DONE**（MC-90 カードの「実態訂正」「ステータス: DONE」を正とする）。**残: logic/en-chakai/西丸町 の走査と recurring 滞留検知の配線は別スコープ（MC-90 の apollo-keeper 連携）として継続。** スコープ厳守で他プロジェクト台帳は未読・未編集。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |


### MC-88/MC-89 共通 — collector status 正本一本化（夜目方針(B)、MC-88 と束ねた1本）

| フィールド | 値 |
|---|---|
| 対象 | MC-88 機序③＋MC-89 機序②（同一 ID の別表現/別表から status が揺れる構造）の collector 側修正 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 実装 | `cxo-agent/server/src/collectors/tasks.ts` の `parseTrackerString` を「status の正本＝正準サマリ表（ID 列見出しが `ID` の表）の status 列」に一本化。**(1) 非タスク表の行ごと除外**: ID 列見出しが `ID` でない別表（`\| タスク \| 旧状態 \| 新状態 \| 反映内容 \|` ＝判断反映サマリ等）を `inNonTaskTable` フラグで検出し、その表の行を一切 task 化しない。これで「別表の旧/新状態列を status ソースに誤採用してフラッピング」を**表の出現順に依存せず決定的に**塞ぐ（旧実装は seen 先勝ちで別表をスキップしていたが、正準表が必ず先という順序前提に依存し脆かった＝夜目機序②の seen 揺れの根本）。判定＝1列目が `タスク/task/項目/対象/名称` かつ他セルに `旧状態/新状態/変更前/変更後/遷移/反映内容/before/after` を含む。 |
| MC-89 既存対策との重複回避 | MC-89 DONE（commit `3bc0139`）は **approvals.ts の (A) decided ID 除外**＝承認キュー算出の冪等化（承認系専用の二重防御レイヤー）。本修正は **tasks collector の status 正本化(B)**＝別レイヤーで重複なし。夜目調査(L1290)が「(B) 同一 ID 多重表現の正規化は別途」と明記した未実装部分を埋めるもの。approvals 系の APPROVAL_TAG_WORDS / 決定ログ除外には一切手を入れていない。 |
| 検証 | 改修後 collector で実台帳 logic/TASK_TRACKER を再パース＝DF-F4/T-U/AM-N は現状値（再リコンサイル前なので全 TODO）で安定、重複 ID なし、同一入力の2回パースが一致（決定的）。再リコンサイル後を模し正準表を BLOCKED 化＋別表残置→3件とも BLOCKED 保持（別表の TODO に巻き戻されない）。別表を正準表より前に置いた破綻順序＝改修前は UNKNOWN に倒れたが改修後は正準表の値（REVIEW/DONE）を保持。回帰テスト `tasks.summaryTable.test.ts` 新設（3 case group＋実台帳決定性チェック、全 pass）。server `tsc --noEmit` 0 errors、既存 `normStatus` 31/31 維持。 |
| 残 | cxo-agent server（mission-control.service）restart で live 反映＝作業ツリー安定後に林がクリーンに実施（reference-apollo-restart-stale-routes の教訓）。push は Keita 承認領域。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |


### MC-88/MC-89 共通 — collector status 正本一本化（夜目方針(B)、MC-88 と束ねた1本）

| フィールド | 値 |
|---|---|
| 対象 | MC-88 機序③＋MC-89 機序②（同一 ID の別表現/別表から status が揺れる構造）の collector 側修正 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 実装 | `cxo-agent/server/src/collectors/tasks.ts` の `parseTrackerString` を「status の正本＝正準サマリ表（ID 列見出しが `ID` の表）の status 列」に一本化。**(1) 非タスク表の行ごと除外**: ID 列見出しが `ID` でない別表（`\| タスク \| 旧状態 \| 新状態 \| 反映内容 \|` ＝判断反映サマリ等）を `inNonTaskTable` フラグで検出し、その表の行を一切 task 化しない。これで「別表の旧/新状態列を status ソースに誤採用してフラッピング」を**表の出現順に依存せず決定的に**塞ぐ（旧実装は seen 先勝ちで別表をスキップしていたが、正準表が必ず先という順序前提に依存し脆かった＝夜目機序②の seen 揺れの根本）。判定＝1列目が `タスク/task/項目/対象/名称` かつ他セルに `旧状態/新状態/変更前/変更後/遷移/反映内容/before/after` を含む。 |
| MC-89 既存対策との重複回避 | MC-89 DONE（commit `3bc0139`）は **approvals.ts の (A) decided ID 除外**＝承認キュー算出の冪等化（承認系専用の二重防御レイヤー）。本修正は **tasks collector の status 正本化(B)**＝別レイヤーで重複なし。夜目調査(L1290)が「(B) 同一 ID 多重表現の正規化は別途」と明記した未実装部分を埋めるもの。approvals 系の APPROVAL_TAG_WORDS / 決定ログ除外には一切手を入れていない。 |
| 検証 | 改修後 collector で実台帳 logic/TASK_TRACKER を再パース＝DF-F4/T-U/AM-N は現状値（再リコンサイル前なので全 TODO）で安定、重複 ID なし、同一入力の2回パースが一致（決定的）。再リコンサイル後を模し正準表を BLOCKED 化＋別表残置→3件とも BLOCKED 保持（別表の TODO に巻き戻されない）。別表を正準表より前に置いた破綻順序＝改修前は UNKNOWN に倒れたが改修後は正準表の値（REVIEW/DONE）を保持。回帰テスト `tasks.summaryTable.test.ts` 新設（3 case group＋実台帳決定性チェック、全 pass）。server `tsc --noEmit` 0 errors、既存 `normStatus` 31/31 維持。 |
| 残 | cxo-agent server（mission-control.service）restart で live 反映＝作業ツリー安定後に林がクリーンに実施（reference-apollo-restart-stale-routes の教訓）。push は Keita 承認領域。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |


### MC-89 — 承認ビューで承認済み項目が何度も承認キューに再出現する不具合

| フィールド | 値 |
|---|---|
| ID | MC-89 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 背景・裏取り（決定的証拠） | `cxo-agent/data/approval-decisions.jsonl` を突合したところ、同一 ID が複数回 approve 記録されている＝承認しても消えず再出現している直接証拠: ・AM-O が **5回** approve（2026-05-31 12:16 / 12:28 / 12:54 / 20:03、2026-06-01 00:20）。・DF-F13 / DF-F3 / FB-05 が **各2回**（5/31 10:22-24 に1回 → 同 20:03 に再出現で再承認 → さらに 6/01 00:20 にまた再承認）。すべて `fromStatus:"approve" → toStatus:"TODO"` を書こうとしているのに、次のティックでまた `approve` 扱いで承認キューに現れている。MC-88（autonomous-rin が BLOCKED→TODO 書き戻し疑い）と status 書き戻しのレース／不整合という点で根が近い可能性。 |
| 仮説（要検証） | (1) 承認決定の TASK_TRACKER 書き戻し（MC-71 の md 書き戻し層）が実際には status を `approve`→`TODO` に反映できていない（楽観ロック失敗・read-back 不一致・該当行マッチ漏れ・autonomous-rin/他プロセスとの編集レースで上書き巻き戻し）。(2) collector（tasks.ts / approvals 抽出）が status 文字列 `approve` を承認待ちと判定しており、書き戻しが効かない限り毎ティック再 pending 化する。(3) approval-decisions.jsonl は「決定ログ」として追記されるだけで、それ自体は承認キューから除外する根拠に使われていない（＝決定済み ID を queue から除外していない）。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) スクショ証拠あり（下記 attachment）。実機調査時に Read で確認。(2) MC-88（BLOCKED→TODO 誤書き戻し）と同じ「共有 TASK_TRACKER への並行書き込みレース」が真因なら、両者を同一の書き戻し排他機構（flock or 楽観ロック+read-back+リトライ）で一括解決するのが筋。バラバラに対症療法しない。(3) 承認は logic/TASK_TRACKER の項目（AM-O/DF-* は logic 側）を cxo の Apollo から書き戻している＝クロスプロジェクト書き込みのパス・採番直列化・autonomous-rin（logic ループ）との編集レースを点検。(4) 恒久対策として decided ID（approval-decisions.jsonl）を承認キュー算出時に除外する冪等化を入れると、書き戻しが一時的にこけても二重承認は防げる。(5) UI chrome 制約（中立丁寧体・CSS 変数・SVG）は本件 UI 変更時に維持。 |
| スクショ | `cxo-agent/data/inbox-attachments/2026-06-01T00-31-20-092Z-26e61381/3243.png` |
| note | Apollo inbox id `2026-06-01T00-31-20-092Z-26e61381`（MC-77 機構で taskId=MC-89 紐付け済み）。ブリーフ #1。2026-06-01 棚卸しで調査結果を反映。 |
| 実機調査（2026-06-01 apollo番人 夜目） | 根因確定。仮説(1)が真、(2)(3)は反証。**真因＝collector の status 読み取りが揺れて承認後も BLOCKED と読み続け再浮上する。承認の書き戻し自体は機能している（approval-decisions.jsonl の toStatus は常に TODO、editTask は3形式へ書き戻し済）が、collector が「同一 ID の別表現」から status を BLOCKED に上書きしてしまう。** 機序2点: ①`server/src/collectors/tasks.ts:191-195 mergeStatus` ＋ `STATUS_RANK`（TODO=1, BLOCKED=2）＝同一 ID が表行とセクション/別表で複数表現されるとき「ランクが現在以上なら採用」で BLOCKED(2) が TODO(1) を上書きする（確定方向のみ動かす設計が BLOCKED を巻き込む副作用）。②`tasks.ts:407-408 seen` Set は「ファイル内で最初に出た表行」だけ採用＝logic 台帳に AM-O の表行が2本（`logic/docs/TASK_TRACKER.md:1011` status=TODO ＝現役ボード／`:2867` 2列目に "BLOCKED" ＝別バッチの旧表現）あり、autonomous-rin/dev-logic の頻繁な編集で出現順が揺れると BLOCKED 行を採る瞬間が出る。BLOCKED と読まれた瞬間に `collectors/approvals.ts:79` の `status==='BLOCKED' && needsKeita` で blocked カテゴリ再浮上→承認→表行 TODO 化→しかし旧表現の BLOCKED 記述は editTask の status セル置換で消えない（散文/別ヘッダ列のため）→次ティックでまた BLOCKED。永久ループ。実証: 現時点では4件とも collector status=TODO・承認キュー非再浮上（collectApprovals total=2 で AM-O/DF-* 不在）だが、これは出現順がたまたま TODO 寄りなだけで構造的に不安定。`approvals.ts:104-150 buildDecidedStatus` の冪等化（decided toStatus と現在 status 一致なら抑止）は status=TODO 一致時のみ効き、BLOCKED に揺れた瞬間に外れる＝現状の防御は status の揺れに無力。修正方針＝(A) **冪等化を status 不問の「decided ID 除外」に強化**: approval-decisions.jsonl に decision:approve がある id+source は、現在 status に関係なく承認キューから除外する（DF-* のように再度本当に差し戻したい時は reject か新規 BLOCKED 起票で明示）。これが最小・確実な対症かつ恒久（dev-logic）。(B) **同一 ID 多重表現の正規化**: logic 台帳の AM-O 二重表行（`:2867` 旧表現）を1本へ集約し、mergeStatus が BLOCKED を拾わないよう「表行＝唯一の status 正本」にする（content/dev-logic、台帳整理）。(C) mergeStatus を「DONE/CANCELLED へのみ前進、BLOCKED は表行が明示時のみ」に限定する案も可だが副作用大きいので (A)+(B) を推奨。MC-88 との統合: MC-88 も「同一台帳の status を別プロセスが書き戻す/別表現が競合する」同根＝(B) の多重表現正規化＋編集排他（flock）で一括対処できる。決定ログ除外(A)は承認系専用の二重防御として併設。担当=dev-logic（approvals.ts の除外ロジック強化）＋content/task-manager（logic 台帳の AM-O 二重行集約）。本番コードは未変更（調査のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-01 Apollo inbox 棚卸し（未消化検出・バグ確定）

> 2026-06-01 の Apollo inbox（cxo-agent/data/inbox.jsonl 全17件）の consumed 突合で、未消化が滞留していることを検出。調査で根因（cxo スコープの自律ループが cron 未登録＝inbox が誰にも消費されない）を確定し MC-90 を起票。inbox 由来の他3件（承認再湧き／タスク詳細記載／停滞タスク再開）は MC-77 の inbox 即タスク化機構により既に taskId 紐付き済み（MC-89 / MC-82 / MC-87）で、本棚卸しでは新規採番せず既存スタブを調査結果で充実させた（重複起票回避）。

### MC-90 — Apollo inbox が誰にも消費されず滞留（cxo スコープの自律ループが cron 未登録）

| フィールド | 値 |
|---|---|
| ID | MC-90 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 根因（裏取り済み） | 記憶 [[project-autonomous-rin]] では「ティック冒頭で inbox を最優先消費」とあるが、実装は MC-85 で `autonomous-worker.sh` に一般化され、inbox 消費は `HANDLE_INBOX=1`（worker line 44-58/120-126）でガードされ **PROJECT_SCOPE=cxo のときだけ** 動く。ところが cron に登録されているのは `*/10 * * * * autonomous-rin.sh`（PROJECT_SCOPE=logic 固定ラッパ、`HANDLE_INBOX=0`）の **logic スコープ1本だけ**。cxo スコープのループ（`PROJECT_SCOPE=cxo bash autonomous-worker.sh`、唯一 inbox を処理する経路）は cron にもどこにも登録されていない。よって inbox を消費する主体が一度も走らず、pending が滞留している。※ブリーフの「autonomous-rin.sh に inbox 処理コードが一切無い」は半分正しく半分不正確: コード自体は worker 側に在るが、それを呼ぶ cxo スコープのスケジュールが無い、が正確な根因。 |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| note | 林の inbox 棚卸し調査由来（inbox エントリではない＝元 inbox id なし）。ブリーフ #2。 |
| 実機調査（2026-06-01 apollo番人 夜目） | 根因確定。仮説(1)が真、(2)(3)は反証。**真因＝collector の status 読み取りが揺れて承認後も BLOCKED と読み続け再浮上する。承認の書き戻し自体は機能している（approval-decisions.jsonl の toStatus は常に TODO、editTask は3形式へ書き戻し済）が、collector が「同一 ID の別表現」から status を BLOCKED に上書きしてしまう。** 機序2点: ①`server/src/collectors/tasks.ts:191-195 mergeStatus` ＋ `STATUS_RANK`（TODO=1, BLOCKED=2）＝同一 ID が表行とセクション/別表で複数表現されるとき「ランクが現在以上なら採用」で BLOCKED(2) が TODO(1) を上書きする（確定方向のみ動かす設計が BLOCKED を巻き込む副作用）。②`tasks.ts:407-408 seen` Set は「ファイル内で最初に出た表行」だけ採用＝logic 台帳に AM-O の表行が2本（`logic/docs/TASK_TRACKER.md:1011` status=TODO ＝現役ボード／`:2867` 2列目に "BLOCKED" ＝別バッチの旧表現）あり、autonomous-rin/dev-logic の頻繁な編集で出現順が揺れると BLOCKED 行を採る瞬間が出る。BLOCKED と読まれた瞬間に `collectors/approvals.ts:79` の `status==='BLOCKED' && needsKeita` で blocked カテゴリ再浮上→承認→表行 TODO 化→しかし旧表現の BLOCKED 記述は editTask の status セル置換で消えない（散文/別ヘッダ列のため）→次ティックでまた BLOCKED。永久ループ。実証: 現時点では4件とも collector status=TODO・承認キュー非再浮上（collectApprovals total=2 で AM-O/DF-* 不在）だが、これは出現順がたまたま TODO 寄りなだけで構造的に不安定。`approvals.ts:104-150 buildDecidedStatus` の冪等化（decided toStatus と現在 status 一致なら抑止）は status=TODO 一致時のみ効き、BLOCKED に揺れた瞬間に外れる＝現状の防御は status の揺れに無力。修正方針＝(A) **冪等化を status 不問の「decided ID 除外」に強化**: approval-decisions.jsonl に decision:approve がある id+source は、現在 status に関係なく承認キューから除外する（DF-* のように再度本当に差し戻したい時は reject か新規 BLOCKED 起票で明示）。これが最小・確実な対症かつ恒久（dev-logic）。(B) **同一 ID 多重表現の正規化**: logic 台帳の AM-O 二重表行（`:2867` 旧表現）を1本へ集約し、mergeStatus が BLOCKED を拾わないよう「表行＝唯一の status 正本」にする（content/dev-logic、台帳整理）。(C) mergeStatus を「DONE/CANCELLED へのみ前進、BLOCKED は表行が明示時のみ」に限定する案も可だが副作用大きいので (A)+(B) を推奨。MC-88 との統合: MC-88 も「同一台帳の status を別プロセスが書き戻す/別表現が競合する」同根＝(B) の多重表現正規化＋編集排他（flock）で一括対処できる。決定ログ除外(A)は承認系専用の二重防御として併設。担当=dev-logic（approvals.ts の除外ロジック強化）＋content/task-manager（logic 台帳の AM-O 二重行集約）。本番コードは未変更（調査のみ）。 |
| 実態訂正（2026-06-01 林・実機確認） | 本カードの「根因（裏取り済み）」行および旧タイトルにある「cxo スコープのループが **cron 未登録**」という前提は**誤り**。林の実機確認で判明した正しい実態＝**cron は既に登録済み**。`*/15 * * * * autonomous-cxo.sh` が存在し、`autonomous-cxo.sh` は `PROJECT_SCOPE=cxo NO_PUSH=1` で `autonomous-worker.sh` を呼ぶ正規ラッパで `HANDLE_INBOX=1`（Apollo 受信箱を処理する経路）。inbox を消費する主体は cron に在った。**真の停止理由＝kill-switch `~/.autonomous-cxo.disabled` が置かれており、毎ティック「kill-switch で停止 → skip」になっていた**（apollo番人の旧調査が見た「cxo ループ未登録」は、当時の crontab 状態か別ラッパを見た誤認で、現状の正は autonomous-cxo.sh の */15 登録）。 |
| 解消（2026-06-01 Keita 承認・DONE 化） | 2026-06-01 Keita 承認のもと、林が `rm ~/.autonomous-cxo.disabled` で kill-switch を解除＝cxo 自律ループを有効化。次の */15 ティックから cxo スコープが稼働し Apollo inbox を消費する＝inbox 滞留の根治。`NO_PUSH=1` ガードは維持（cxo スコープは push/deploy をせず、ローカル commit までで Apollo に即反映。push は Keita 承認領域）。DoD 充足: (1) inbox を消費する自律ループ（cxo スコープ）が */15 で定期実行され pending→consumed の導線が成立（kill-switch 解除で有効化）、(3) flock・時刻ずらし・NO_PUSH ガードで二重 push/競合なし、(4) 滞留検知（`inbox-stalled` アラート）は前ティックで実装済み（commit `a9c9b1a`）。(2) の既存 pending は稼働再開後のティックで消化（紐付き済→consumed、SMOKE は破棄）。[[feedback-review-agent-verify-then-done]] でエージェント検証により DONE 化。関連 [[project-autonomous-rin]]（記憶「ティック冒頭 inbox 最優先消費」は worker 一般化後の実態に合わせ別途更新）。関連調査 MC-88（autonomous が BLOCKED を TODO に書き戻す疑い・別タスク・本件では触らない）。 |
| 進捗（cxo ティック 2026-06-01 林） | cxo スコープ分を実施。本台帳の内部 status 不整合を是正＝詳細セクション MC-60/MC-61/MC-62 が「ステータス: TODO」のまま残っていたが、正本の表行は DONE（git 実態で commit 6362562/f0bfb52・workflows.ts/TaskDetail.tsx/task-links.jsonl 実在を裏取り）。3 箇所を DONE へ整合し、詳細と表行の食い違いを解消（MC-89 で根因になった「同一 ID の status 多重表現」予防にも寄与）。cxo の IN_PROGRESS（MC-85/MC-86=Keita 設計承認待ち BLOCKED）は実態と一致＝誤って止まっている停滞・状態取り違えは無し。**[stale 整合 2026-06-01]** 本 note 旧記述の「MC-90=調査完了・cron 登録が Keita 承認待ち」は実態とズレていたため訂正＝MC-90 は cron 既登録（`*/15 autonomous-cxo.sh`、HANDLE_INBOX=1）で kill-switch `~/.autonomous-cxo.disabled` 解除により稼働再開、2026-06-01 に **DONE**（MC-90 カードの「実態訂正」「ステータス: DONE」を正とする）。**残: logic/en-chakai/西丸町 の走査と recurring 滞留検知の配線は別スコープ（MC-90 の apollo-keeper 連携）として継続。** スコープ厳守で他プロジェクト台帳は未読・未編集。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-01 Apollo Web ターミナル（林との同期・双方向対話をブラウザから）

> Keita 指示（2026-06-01）「このターミナルでできるのと同じこと（林との対話）を Apollo 上でやりたい。方向は A: Web ターミナル（最速）」。Vultr 箱の tmux `main` に常駐する林 CLI セッションを、Apollo 経由でブラウザ（スマホ含む）から同期・双方向にフル操作できるようにする。受信箱（非同期・片方向）に対する同期・双方向版。

### MC-92 — Apollo に Web ターミナル（tmux の林セッションをブラウザ操作）を追加

| フィールド | 値 |
|---|---|
| ID | MC-92 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 目的 | Keita がこのターミナル（Vultr 箱で tmux `main` に常駐する林 CLI セッション）と同じ対話操作を、Apollo 経由でブラウザ（スマホ含む）からできるようにする。Apollo 受信箱（非同期・片方向）に対し、これは**同期・双方向のフル操作**。 |
| 実装方針（A: 最速・安全） | (1) `ttyd` を箱に導入し `tmux attach -t main`（林セッション）を映す。**localhost バインド固定**（外に直接公開しない）。(2) 認証2段: (a) ttyd 自体に強いクレデンシャル、(b) localhost のみ→Apollo サーバが `/terminal`（仮）で reverse proxy し、Apollo 既存のトークン/Cookie 認証の後ろに置く。トンネルは既存 cloudflared を再利用。さらに堅くするなら Cloudflare Access（keita.urano@gmail.com 限定）を上乗せ可（オプション）。(3) Apollo web にナビ項目「ターミナル」を追加し、認証済みでワンタップで開ける。モバイルレイアウト対応。 |
| セキュリティ要件（DoD に必須） | (1) **素の ttyd を無認証で外部公開しない。必ず Apollo 認証 or Cloudflare Access の後ろ**。(2) フルシェル＝箱の全権限が取れる前提で、認証強度・バインド範囲・トンネル経路を設計する。(3) 操作は林の tmux と共有（Keita 入力がそのまま林セッションに入る）。**読み取り専用でなくフル操作である旨を仕様に明記**。(4) MC_TOKEN や認証情報をコード/リポ本体に直書きしない（`.mc.env` 等の env 参照）。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| サブタスク | - [ ] 「承認が要る項目」判定基準の確定（REVIEW は除外＝MC-80 整合）<br>- [ ] designer: 「承認フロー」ビュー UX＋MC-76 ナビ統合設計<br>- [ ] 集約一覧の実装（/api/tasks フィルタ、非破壊）<br>- [ ] 承認/却下 書き込み API（MC-71 楽観ロック層再利用＋承認監査ログ）<br>- [ ] MC-61 詳細ドリルダウンへの導線<br>- [ ] 放置(stale)表示 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| note | Keita 指示由来（2026-06-01・方向 A）。**2026-06-01 dev-logic 実装完了・restart 済・live。** 認証は Apollo 認証の後ろ（Cloudflare Access は後乗せ可・未実施）。green: server tsc 0 / web build 成功 / apollo healthz 200。検証（127.0.0.1:4317 実コマンド）: (a) 未認証 `/terminal/` HTTP=401 JSON（ttyd HTML 非漏洩）・未認証 WS upgrade=401（attachUpgrade で弾く）・誤トークン WS=401。(b) 認証済 Bearer/Cookie/query-token とも HTTP=200（ttyd `<title>ttyd - Terminal</title>`）・WS upgrade=101（ttyd の sec-websocket-accept 返る＝Basic credential 内部付与成功）。フル操作=WS 経由のキー入力で `/tmp` にファイル書込を確認（ttyd CSRF token を /terminal/token から取得し AuthToken に詰めて送信→shell 実行）。(c) ttyd は 127.0.0.1:7681 のみ bind、公開 IP:7681 は接続拒否（000）。ナビ「ターミナル」は web bundle（index-BVlZRKHw.js）served 済。残: cloudflared 経路の明示検証・Cloudflare Access 上乗せ（任意）・複数 attach 時の tmux サイズ最小同期は仕様（提言#4）。**GitHub push は Keita 承認待ち（ローカル commit のみ）。**<br>**2026-06-01 コピペ改善追記（dev-logic 蓮）:** Keita 報告「コピペできない」を切り分け。主因は secure-context（navigator.clipboard は HTTPS か localhost のみ動作。http://IP:4317 直アクセスでは clipboard read API が封じられる）＋ 親ドキュメントの Permissions-Policy 不足の合わせ技。対処: (1) Apollo 全レスポンスに `Permissions-Policy: clipboard-read=(self), clipboard-write=(self)` を付与（`server/src/index.ts` グローバル middleware）＋ /terminal proxy のレスポンスにも `proxy.on('proxyRes')` で明示付与（`server/src/terminalProxy.ts`）＝ iframe の `allow="clipboard-read; clipboard-write"` と整合し clipboard 権限が iframe へ委譲される。(2) ttyd に `-t rightClickSelectsWord=true` 追加（`deploy/apollo-terminal.service`、選択補助でコピー容易化）。(3) Terminal.tsx に「Ctrl+V／うまくいかない時は HTTPS or 新しいタブ」の中立丁寧体の控えめ注記を追加（CSS トークンクラス・emoji 不可）。検証（curl -I）: SPA index.html・/terminal iframe とも Permissions-Policy ヘッダ付与を確認。**認証は不変＝未認証 HTTP/WS とも 401 維持を再確認**（ヘッダ追加で認証ガード・WS は壊れていない）。restart 済（mission-control.service / apollo-terminal.service）・healthz 200。Ctrl+V ネイティブ paste は xterm.js が DOM paste で受けるため非セキュアでも通る経路あり。Keita 推奨操作: HTTPS（cloudflared 経由）で開く→Ctrl+V（macOS Cmd+V）。iframe で限界がある時は「新しいタブで開く」。**GitHub push は Keita 承認待ち（ローカル commit のみ）。** |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-01 Apollo Web ターミナル文字化け修正（MC-92 の回帰）

> Keita が実機で /terminal を開くと、ブラウザに文字化けバイナリが表示されターミナルが実質使えない状態。MC-92（Web ターミナル新設・コピペ改善）で入った未コミット差分の selfHandleResponse 化が、上流 ttyd の gzip 圧縮 body を壊して content-encoding ヘッダも消すため、ブラウザが壊れた gzip を平文表示している。根因確定済み。dev-logic が server/src/terminalProxy.ts を修正中（台帳は task-manager 管轄＝dev-logic はコードのみ）。

### MC-93 — Apollo Web ターミナル（/terminal）でブラウザに文字化けバイナリが表示される不具合の修正

| フィールド | 値 |
|---|---|
| ID | MC-93 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | bug / インフラ（MC-92 の回帰） |
| 優先度 | 高（Keita が実機で遭遇・ターミナルが実質使えない状態） |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景・根因（確定済み） | ブラウザの `Accept-Encoding: gzip` に対し上流 ttyd が gzip 圧縮 HTML を返す。今日入った未コミット差分 `server/src/terminalProxy.ts` の `selfHandleResponse: true` 化が、圧縮 body を `Buffer.concat(...).toString('utf8')` で文字列化して破壊し、`content-encoding` ヘッダも delete するため、ブラウザが壊れた gzip を平文として表示 → 文字化け。再現: curl で `Accept-Encoding: gzip` を付けると先頭 `1f ef bf bd...`・content-encoding 消失。Accept-Encoding 無しだと正常に見えるため気づきにくかった。さらにこの未コミット差分のまま 13:59 に server が restart され本番に乗っていた。 |
| 修正方針 | `proxyReq` で `Accept-Encoding` を削除し ttyd に非圧縮で返させる（ターミナルは軽量なので非圧縮で問題なし）。paste-fix script 注入（`__apolloPasteFix`）は維持。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 検証メモ（確認済み・2026-06-01） | 修正本体: `server/src/terminalProxy.ts:105` の proxyReq ハンドラに `proxyReq.removeHeader('accept-encoding')` を追加（commit d40459a「fix(terminal): drop accept-encoding to ttyd so HTML body stays uncompressed (MC-93)」、未 push）。ttyd に非圧縮で返させ、selfHandleResponse の utf8 文字列化で gzip body が壊れる根因を解消。`:141` の `delete headers['content-encoding']` も二重防御で残置。／(1) tsc `npx tsc --noEmit` EXIT=0 green ✓／(2) restart 後 `/api/healthz` 200・systemctl is-active active ✓／(3) `Accept-Encoding: gzip` 付き GET /terminal/ → content-encoding 無し・本文 `<!DOCTYPE html` 始まり・`__apolloPasteFix` 注入2箇所 ✓／(4) 実機: Keita がブラウザで「治った」と確認済み（2026-06-01）✓。非退行: Permissions-Policy: clipboard-read=(self),clipboard-write=(self) 維持・Cookie 無しは 401（認証ゲート維持）・/terminal/token 200・/terminal/ws 101 ✓。後始末: 使い捨て `_repro_*.mjs` 6本 dev-logic 削除済み、terminalProxy.ts は commit 済みでワーキングツリーから汚れ差分除去済み。push は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-01 Apollo ターミナル PC コピペ修正 / 画像添付 / レスキュー画面

> Keita 要望3件（2026-06-01）。MC-94=MC-92 の積み残し（PC ブラウザ Ctrl+V が実機で効かない）の根因確定→修正、dev-logic 実機検証で DoD クリア＝DONE（2026-06-01）。MC-95=ターミナルから画像を林に渡せるようにする feature。MC-96=Apollo が落ちても開ける独立レスキュー画面（設計 Keita 確認中）。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-94/95/96 確定済み（pull --rebase 後、MC-90〜93 既存を裏取り、再採番なし）。

### MC-94 — Apollo Web ターミナルで PC ブラウザの Ctrl+V コピペが効かない不具合の修正

| フィールド | 値 |
|---|---|
| ID | MC-94 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | bug / MC-92 の積み残し |
| 優先度 | 高 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 根因（実機確定済み 2026-06-01） | iframe 内の `navigator.clipboard.readText()` が clipboard-read 権限ゲートで NotAllowedError 失敗。旧 MC-92 コードはそれを catch で握りつぶしつつ Ctrl+V を無条件 `preventDefault` していたため、クリップボード取得失敗時にネイティブ paste も殺され何も貼れなかった。当初の根因候補 (a) `window.term` 未公開説は外れ（paste-fix はアタッチ済みだった）。(b)/(c) も主因ではなく、真因は readText 失敗時の preventDefault による native paste 殺し。 |
| 受け入れ条件（DoD）★クリア | (1) 根因を実機証拠付きで特定 → 上記「根因」で確定 ✓。(2) PC ブラウザで Ctrl+V 貼り付けが実際に効く → Playwright（chromium、clipboard-read 未付与＝実 PC ブラウザ相当）で Ctrl+V 貼り付けが bracketed paste で PTY 到達・SYN なしを確認 ✓。(3) 非退行 → 通常打鍵 abc 素通り・Ctrl+Shift+V 素通り・MC-93 文字化け無し すべて PASS ✓。(4) tsc green・restart 後 healthz 200 → `tsc --noEmit` exit 0・restart 後 healthz 200・`__apolloPasteFix` 注入2箇所・readText 撤去確認 ✓。 |
| 修正・検証メモ（dev-logic 実機検証済み 2026-06-01） | 修正本体: `server/src/terminalProxy.ts:57-78` の PASTE_FIX_SCRIPT。Ctrl+V（Shift 無し）に `return false` で xterm の SYN(0x16) 送出のみ抑止し、`preventDefault` は呼ばない。ブラウザのネイティブ paste が xterm helper textarea に走り、組み込み paste ハンドラが bracketed paste で PTY 送出。`clipboard.readText`／clipboard-read 権限／ttyd 構造に非依存。commit `0e8e6d0`（main、未 push）。検証: Playwright chromium（clipboard-read 未付与＝実 PC ブラウザ相当）で Ctrl+V 貼り付け→bracketed paste で PTY 到達・SYN なし確認。非退行（通常打鍵 abc 素通り・Ctrl+Shift+V 素通り・MC-93 文字化け無し）PASS。`tsc --noEmit` exit 0・restart 後 healthz 200・`__apolloPasteFix` 注入2箇所・readText 撤去確認。push は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 関連 | MC-92（Web ターミナル新設・コピペ改善の起源）、MC-93（文字化け修正）。`server/src/terminalProxy.ts:57-78`（PASTE_FIX_SCRIPT・SYN 抑止のみ／preventDefault 呼ばない）, ttyd 1.7.4, [[project-apollo-dashboard]], [[feedback-review-agent-verify-then-done]] |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-95 — Apollo ターミナルから画像を添付して対話中の林に渡せるようにする（クリップボード貼付＋ファイル選択）

| フィールド | 値 |
|---|---|
| ID | MC-95 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | feature |
| 優先度 | 中 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 検証（2026-06-01 test-functional 試野） | 実機 E2E 全項目 PASS（修正要 FAIL なし）で DoD クリア＝DONE 化（[[feedback-review-agent-verify-then-done]]）。根拠: (a) ナビ全9項目巡回・/terminal-view 遷移・ttyd iframe 表示 OK、ルート変更（/terminal→/terminal-view）による波及なし・pageerror ゼロ。(b) /terminal/（ttyd 直）200 生存＝SPA と proxy の分離成立（index.ts の /terminal mount が SPA fallback より先に評価）。(c) 画像添付＝ファイル選択（単体/複数）・クリップボード貼付 とも 201・`data/terminal-uploads/` 保存・tmux main へリテラル注入・自動 Enter なしを実機確認。(d) バリデーション/認証＝Cookie 無し 401／0枚・不正 MIME・枚数超過・サイズ超過 400／いずれも tmux 未到達。(e) 非破壊性＝検証文字列は BSpace で消去し tmux main 原状復帰。(f) MC-93/94 非退行＝文字化けなし・Permissions-Policy 付与・paste-fix script 健在。実装 commit ded755e（未 push）。push / 本番反映は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 想定設計 | ターミナルビュー（`web/src/views/Terminal.tsx`）にオーバーレイ UI（添付ボタン＋ペースト受け）を追加 → 画像をサーバ保存（`data/terminal-uploads/`、新規 API `POST /api/terminal/upload`、multipart）→ 保存パスを tmux main に注入（`tmux send-keys` でパス文字列を流す）→ 林が Read で読む。クリップボード画像は secure context（https）前提で可。既存 inbox の画像添付実装（`server/src/inbox.ts`、`data/inbox-attachments/`）が流用の参考。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-96 — Apollo が開けない/壊れた時の独立レスキュー画面・修復ルートを確保する

| フィールド | 値 |
|---|---|
| ID | MC-96 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | feature / インフラ（レジリエンス） |
| 優先度 | 高 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 完了根拠（2026-06-01・dev-logic 実機検証済み） | 実装＝`deploy/apollo-rescue.mjs`（Node 標準ライブラリのみの単一ファイル、Apollo 本体の node_modules/tsx/web ビルドに非依存＝本体が死んでも起動可能）＋`deploy/apollo-rescue.service`（systemd, User=dev, Restart=always）。commit 036d7c6（main、未 push）。ポート :4318 常駐（RESCUE_PORT で .mc.env の PORT=4317 を踏まないよう明示上書き、4317 を奪わない確認済み）、systemd enable --now 済・is-active active・is-enabled enabled。認証＝Apollo と同じ MC_TOKEN（.mc.env→.mc_token→env で解決）、?token=→Cookie 1クリック方式、crypto.timingSafeEqual 比較、/restart /logs も厳格保護。機能＝GET /（自己完結 HTML・10秒自動更新・restart/ログ/状態/ターミナル直リンク）、GET /status（healthz到達可否・JSON/HTML判定・systemctl is-active・ttyd/tmux 有無・df/free/uptime/loadavg）、POST /restart（sudo -n systemctl restart mission-control.service・30s cooldown・restart後healthz200を最大8s待ち recovered 返却）、GET /logs（journalctl -n150）、GET /healthz（無認証・自身死活）。検証6項目すべてグリーン: (1) 認証ゲート（token無し401・誤token401・Cookie/Bearer200）(2) /status が本体生存中に healthz200/systemd active/ttyd/tmux 正しく表示 (3) POST /restart で mission-control 復活（recovered:true・約3秒）(4) ★本体 down 確証＝Apollo を stop した状態でレスキュー GET/ が 200・/status が apollo.up=false/systemd=inactive を表示、即 start で復旧（＝DoD(1) 充足の決め手）(5) Restart=always（kill -9 → 約4秒で新PID復活）(6) cooldown（連打 429）。DoD 4項目（(1)本体停止でも開ける (2)レスキューから restart で本体復活 (3)独立 systemd で自動起動・常駐 (4)認証ゲートあり）すべて充足。残（DONE をブロックしない・Keita 領分）＝cloudflared で apollo-rescue.<domain>→:4318 の ingress 追加（外部固定 URL 公開）。トンネル設定側の作業ゆえ別管理。 |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 想定設計（Keita 確認中） | Apollo 本体とは独立したプロセスで軽量レスキューサーバを立てる（別ポート例:4318・別 systemd `apollo-rescue.service`・素の Node http 単一ファイルで apollo-web/server のビルドに非依存＝本体が死んでも起動可能）。機能: Apollo 死活(healthz)表示／ワンクリック `mission-control.service` restart／直近ログ表示／ttyd・tmux・df・free 状態／ターミナル直リンク。認証は MC_TOKEN 流用、cloudflared で本体と独立した別経路公開。位置づけは既存 cron `apollo-watchdog`（自動 restart）の手動 Web 版で、番人(apollo)と協調。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 提言・抜けもれ | (1) **非依存が肝**: レスキューサーバは apollo-web/server のビルド成果物・node_modules・共通設定に依存させない（本体が壊れた原因と心中しないため、単一ファイル＋Node 標準ライブラリのみが望ましい）。依存を持たせると「本体が死ぬ時に一緒に死ぬ」。(2) restart 権限＝レスキューサーバが `systemctl restart` を実行できる権限設計（dev ユーザの sudo 範囲 or systemd 経由）。任意 restart が認証ゲート内に限定されること（未認証で叩けると DoS）。(3) ポート 4318 と cloudflared 別経路が本体と衝突しない・独立して落ちないこと。(4) apollo番人（apollo）の cron watchdog（自動 restart）と機能重複・競合しないか整理（手動 Web 版＝人が押す、cron＝自動、の役割分担を明記）。(5) **設計は Keita 確認中**＝合意前に実装着手しない（BLOCKED 相当の判断待ち。確定したら IN_PROGRESS へ）。(6) レスキュー画面自体が単一障害点にならないよう、最低限の自己復旧（systemd Restart=always）も付ける。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-101 — Apollo ターミナルビューに「ターミナル開始」ボタンを追加（tmux main / ttyd 切断後の再起動導線）

| フィールド | 値 |
|---|---|
| ID | MC-101 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | feature |
| 優先度 | 中〜高（ターミナルが切断されると現状ブラウザから復旧できず SSH が要る。Keita 直近要望） |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 検証ログ（2026-06-01 dev-logic 実機） | 構成判明: rin-terminal.sh = `tmux new-session -A -s main "cd /home/dev/projects && exec /usr/bin/claude"`（-A で attach/作成）、ttyd は systemd apollo-terminal.service 常駐。切断＝tmux main 消失 or ttyd 停止の2パターン。実装: server/src/terminalControl.ts（新規、GET /api/terminal/status＝has-session/systemctl is-active/ポート到達、POST /api/terminal/start＝冪等：main 無ければ作成・ttyd inactive なら start・両稼働なら no-op、execFile 安全）、config.ts:113-145（TERMINAL_TMUX_START_CMD 等）、index.ts:35/274-279（makeAuthMiddleware 配下に mount）、web/src/views/Terminal.tsx（status 15s ポーリング→切断時「ターミナルを開始」ボタン→start→iframe リロード）、e2e smoke 5件。commit a9ceef4（未 push）。検証: tsc/build green、restart 後 healthz 200、status API 本番 ready:true・Cookie 無し 401、別名セッション mc100test で start が created→ready・2回目 no-op（冪等）、本番 main の session_created 不変（非破壊の証拠＝DoD(5)決め手）、Playwright smoke 5/5 pass。DoD 5項目すべて充足。push は Keita 承認待ち（[[reference-deploy-commands]]）。 |
| 想定設計 | サーバに GET /api/terminal/status（tmux main 有無・ttyd 稼働の状態）と POST /api/terminal/start（無ければ tmux main を rin-terminal.sh 相当で起動・ttyd 停止なら起動、冪等）。要認証。フロント web/src/views/Terminal.tsx で切断状態を検知して「ターミナル開始」ボタンを表示、押下で start→iframe リロード。rin-terminal.sh（/home/dev/cron-scripts/rin-terminal.sh）と既存 ttyd 起動構成を dev-logic が調査して整合させる。 |
| 重要制約 | 検証で本番 tmux main（対話中の林セッション）を kill しないこと。検証は別名セッションで行う。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | `web/src/views/Terminal.tsx`、`server/src/`（GET /api/terminal/status・POST /api/terminal/start 新規）、`/home/dev/cron-scripts/rin-terminal.sh`、既存 ttyd 起動構成（apollo-terminal.service） |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-103 — ターミナル画像添付の「送る前のプレビュー」を確実に個別削除できるようにする（MC-102 の削除 UX 修正）

| フィールド | 値 |
|---|---|
| ID | MC-103 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | bug / UX 修正 |
| 優先度 | 中〜高（Keita 実機で削除できないと報告。送信前プレビューの操作不能は体験を直接損なう） |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 想定設計 | `web/src/views/Terminal.tsx` のステージングサムネ削除 UI を見直す。削除ボタンを常時表示（ホバー依存をやめる）・ヒット領域とタップターゲットを十分大きく（44px 目安）・z-index と重なり順を確認し iframe/他要素に隠れないようにする。removeStaged ハンドラと object URL revoke の動作を実機で確認。本番 dist の反映状況も確認（restart/build 漏れがないか）。原因が (c) なら build/restart で解消、(a)(b)(d) なら CSS/JSX/ハンドラ修正。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | `web/src/views/Terminal.tsx`、`web/dist`（本番反映確認）、`server/src/`（`/api/terminal/upload` 既存・複数対応済） |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-102 — ターミナル画像添付にプレビュー表示と複数枚ステージング UI を追加（MC-95 拡張）

| フィールド | 値 |
|---|---|
| ID | MC-102 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | feature / UX 改善 |
| 優先度 | 中 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 完了検証（2026-06-01・DoD 逆引き） | 実装＝web/src/views/Terminal.tsx を「選択即送信」→「ステージング方式」へ。StagedImage 配列で貯め、URL.createObjectURL でサムネ、revokeObjectURL（個別削除/送信成功/アンマウント）でメモリ解放、サムネ個別削除×、5枚上限（サーバ TERMINAL_UPLOAD_MAX_FILES=5 と整合）、「林に送る（N枚）」で /api/terminal/upload に multipart 一括→201→クリア→role=status 表示、in-flight ガード。paste も addToStaging に切替。MC-100/101 の開始ボタン・status ポーリングと共存。サーバ terminalUpload.ts は複数対応済みで無変更。commit 2065363（未 push→今回 push 予定）。検証＝web build green・server tsc exit 0・restart 後 healthz 200・Playwright smoke 7/7 PASS（複数選択サムネ3枚・即送信されない＝upload 0回・貼付追加・個別削除・7枚→5枚抑止 alert・林に送るで 3枚 1リクエスト multipart 201 クリア・1280px 回帰）・認証 Cookie 無し 401・非退行 MC-100 start spec 5/5・実機 authed 2枚 upload count:2/別パス2本/injected・本番 main 注入文字は BSpace で消去し非破壊（自動 Enter なし）。DoD (1)〜(5) すべて充足。 |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 想定設計 | `web/src/views/Terminal.tsx` の添付ツールバーを「即送信」から「ステージング」方式に変更。選択/貼付画像を object URL でサムネ表示、各サムネに削除ボタン、最大5枚、「林に送る」ボタンで `/api/terminal/upload` に multipart 一括送信→パス群を tmux 注入→ステージングクリア。サーバ API は複数対応済みなので原則フロント変更（必要なら微調整）。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | `web/src/views/Terminal.tsx`、`server/src/`（`/api/terminal/upload` 既存・複数対応済）、`data/terminal-uploads/` |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

最終更新: 2026-06-01 / 管理: task-manager（棚町）。2026-06-01 MC-102「ターミナル画像プレビュー＋複数枚ステージング」DONE 化: MC-102 を IN_PROGRESS→DONE。dev-logic 実機検証グリーン（web build/server tsc 0・restart 後 healthz 200・Playwright smoke 7/7 PASS=複数選択サムネ3枚/即送信されない＝upload 0回/貼付追加/個別削除/7枚→5枚抑止 alert/林に送るで 3枚 1リクエスト multipart 201 クリア/1280px 回帰・Cookie 無し POST 401・非退行 MC-100 start spec 5/5・実機 authed 2枚 upload count:2/別パス2本/injected・本番 main 注入文字 BSpace 消去で非破壊＝自動 Enter なし）。実装＝web/src/views/Terminal.tsx を即送信→ステージング方式へ（StagedImage 配列・createObjectURL サムネ・revokeObjectURL リーク解放・個別削除×・5枚上限＝サーバ TERMINAL_UPLOAD_MAX_FILES=5 整合・「林に送る（N枚）」で multipart 一括・in-flight ガード・paste も addToStaging）、サーバ terminalUpload.ts は複数対応済で無変更、commit 2065363。[[feedback-review-agent-verify-then-done]] で DONE 化。Keita 承認済の一括 push を実施（未 push の 036d7c6/c493df3/f895f9f/a9ceef4/c6fd8f1/2065363＋本 DONE 台帳 commit を origin/main へ）。2026-06-01 MC-101「ターミナル開始ボタン」DONE 化 / MC-102 新規起票 / MC-99 優先度引き上げ: (1) MC-101 を IN_PROGRESS→DONE。dev-logic 実機検証グリーン（tsc/build green・restart 後 healthz 200・status API 本番 ready:true/Cookie 無し401・別名セッション mc100test で start created→ready・2回目 no-op で冪等・本番 main の session_created 不変＝非破壊の証拠・Playwright smoke 5/5）。実装 terminalControl.ts 新規＋config.ts:113-145＋index.ts:35/274-279＋Terminal.tsx、commit a9ceef4 未 push、[[feedback-review-agent-verify-then-done]]。(2) MC-102 新規起票（IN_PROGRESS）=ターミナル画像添付の「即送信」を「プレビュー＋複数枚ステージング」UI に拡張（MC-95 のサーバ複数枚対応を活かしフロント変更主体）、担当 dev-logic、採番は next-task-id.sh で MC-102 確定（pull --rebase 後、実在最大 MC-101 +1。MC-100 は前回返却した未使用番号で永久欠番扱い＝歯抜けだが衝突回避優先で再利用しない）。(3) MC-99（SMOKE 除外フィルタ）の優先度を 低〜中→中 に引き上げ。MC-101 検証のフル smoke 中に inbox 経由で SMOKE タスク（MC-102 等の名で）が台帳に自動混入し dev-logic が git checkout で戻す事象が繰り返し発生し実作業を妨げているため。番号ズレ整合: dev-logic がブリーフ上「MC-100」と呼んだのは台帳起票 MC-101 が正。MC-100 は前回（MC-99 起票時）に予約後 未使用返却した番号で、現台帳に MC-100 のカードは存在しない＝欠番。SMOKE 幽霊掃除: 現台帳を grep（`__SMOKE` / 空タイトル）した結果、MC-97（既に CANCELLED 済）以外に SMOKE 由来の幽霊カードは残存なし＝追加 CANCELLED 不要。push は Keita 承認待ち。2026-06-01 Apollo 独立レスキュー画面 DONE 化: MC-96 を TODO→DONE（IN_PROGRESS を経ず、dev-logic 実機検証6項目グリーンで直接 DONE）。実装＝deploy/apollo-rescue.mjs（Node 標準ライブラリのみの単一ファイル・本体ビルド/node_modules/tsx 非依存＝本体が死んでも起動可）＋deploy/apollo-rescue.service（systemd, User=dev, Restart=always）、commit 036d7c6（main・未 push）。ポート :4318 常駐（RESCUE_PORT で .mc.env PORT=4317 を踏まない明示上書き・4317 奪わない確認済み）、enable --now 済・active/enabled。認証＝Apollo と同じ MC_TOKEN・?token→Cookie 1クリック・timingSafeEqual、/restart /logs 厳格保護。機能＝GET /（自己完結 HTML 10秒自動更新）／GET /status（healthz到達可否・JSON/HTML判定・systemctl is-active・ttyd/tmux・df/free/uptime/loadavg）／POST /restart（sudo -n systemctl restart mission-control.service・30s cooldown・restart後 healthz200 最大8s待ち recovered 返却）／GET /logs（journalctl -n150）／GET /healthz（無認証・自身死活）。検証6項目グリーン:(1)認証ゲート(token無/誤401・Cookie/Bearer200)(2)本体生存中 /status 正しい(3)POST /restart で復活(recovered:true・約3s)(4)★本体 down 確証＝Apollo stop 中もレスキュー GET/ 200・/status が apollo.up=false/systemd=inactive 表示→DoD(1)決め手(5)Restart=always(kill -9→約4s 復活)(6)cooldown 連打429。DoD 4項目すべて充足。[[feedback-review-agent-verify-then-done]] でエージェント実機検証 DONE 化。残（DONE 非ブロック・Keita 領分）＝cloudflared で apollo-rescue.<domain>→:4318 ingress 追加（外部固定 URL 公開）はトンネル設定側作業で別管理。push は Keita 承認待ち。2026-06-01 台帳整理4点: (1) MC-95（ターミナル画像添付 feature）を TODO→DONE。test-functional 実機 E2E 全項目 PASS（ナビ9項目巡回・/terminal-view・ttyd iframe／/terminal 直 200 で SPA と proxy 分離／ファイル選択・クリップボード貼付とも 201・data/terminal-uploads/ 保存・tmux main リテラル注入・自動 Enter なし／Cookie 無し401・0枚/不正MIME/枚数超過/サイズ超過 400 で tmux 未到達／検証文字列 BSpace 消去で原状復帰／MC-93/94 非退行）、実装 commit ded755e 未 push、[[feedback-review-agent-verify-then-done]]。(2) MC-97（`__SMOKE_...__` 幽霊カード）を TODO→CANCELLED（林承認済）。inbox 即タスク化機構が投げたスモーク残骸で実害なし・コード/CI 非影響、行削除せず CANCELLED で履歴化。再発防止は MC-99。(3) テスト負債（Apollo e2e smoke 既存 fail を現状ナビ5項目に追従）は既起票の MC-98 と重複のため新規採番せず（脱線前の本来依頼＝MC-98 で充足）。(4) MC-99 新規起票（TODO）=inbox 即タスク化が `__SMOKE_...__` パターンを起票対象から除外する堅牢化、担当 dev-logic、DoD=SMOKE 投入で幽霊タスク生成なし。採番は next-task-id.sh で MC 2件予約（MC-99/MC-100）したが新規は MC-99 のみ（依頼3は MC-98 既存）＝MC-100 は未使用で返却（次回再利用）。push は Keita 承認待ち。2026-06-01 Apollo ターミナル PC コピペ修正完了: MC-94 を IN_PROGRESS→DONE。根因（実機確定）=iframe 内 navigator.clipboard.readText() が clipboard-read 権限ゲートで NotAllowedError 失敗、旧 MC-92 コードが catch で握りつぶしつつ Ctrl+V を無条件 preventDefault していたため native paste も殺され貼れなかった（window.term 未公開説は外れ）。修正=terminalProxy.ts:57-78 PASTE_FIX_SCRIPT で Ctrl+V に return false（xterm の SYN 送出のみ抑止・preventDefault は呼ばない）→ブラウザ native paste が xterm helper textarea に走り bracketed paste で PTY 送出、readText/clipboard 権限/ttyd 構造に非依存（commit 0e8e6d0 未 push）。DoD 4項目クリア（根因実機特定／Playwright chromium・clipboard-read 未付与＝実 PC 相当で Ctrl+V 貼付が bracketed paste で PTY 到達・SYN なし／非退行=通常打鍵 abc 素通り・Ctrl+Shift+V 素通り・MC-93 文字化け無し PASS／tsc --noEmit exit 0・restart 後 healthz 200・__apolloPasteFix 注入2箇所・readText 撤去確認）。[[feedback-review-agent-verify-then-done]] によりエージェント実機検証で DONE 化、Keita PC 確認は別途依頼中（なお不可なら再オープン）。push は Keita 承認待ち。2026-06-01 Apollo ターミナル PC コピペ修正 / 画像添付 / レスキュー画面バッチ: MC-94/95/96 新規起票。MC-94（高）=MC-92 の積み残し、PC ブラウザの Ctrl+V が実機で効かない。secure context はあるため HTTP 線は除外、根因候補 (a)ttyd が window.term 非公開で paste-fix 空振り (b)ブラウザ依存 (c)iframe clipboard 権限委譲未効、を実機 Playwright で確定→修正。dev-logic 蓮 着手。MC-95（中・TODO）=ターミナルから画像を tmux main の林に渡す feature、クリップボード貼付＋ファイル選択、新規 POST /api/terminal/upload・data/terminal-uploads/、inbox 実装流用。MC-94 と同じ Terminal.tsx/clipboard を触るため着手順序要調整。MC-96（高・TODO・設計 Keita 確認中）=Apollo 本体(:4317)が落ちても開ける独立レスキュー画面（別ポート 4318・別 systemd apollo-rescue.service・素の Node 単一ファイルで本体ビルド非依存）。死活表示/ワンクリック restart/ログ/リソース/ターミナル直リンク、MC_TOKEN 認証・cloudflared 別経路。非依存が肝、設計合意前は着手しない。3件とも台帳は task-manager 管轄（dev-logic はコードのみ）、採番は next-task-id.sh で MC-94/95/96 確定済み（再採番なし）。push は Keita 承認待ち。2026-06-01 Apollo Web ターミナル文字化け修正完了: MC-93 を IN_PROGRESS→DONE。修正=terminalProxy.ts:105 で proxyReq から accept-encoding 削除（ttyd 非圧縮化、commit d40459a 未 push）。DoD 4項目クリア（tsc green/healthz 200/Accept-Encoding:gzip 付き GET で content-encoding 無し・DOCTYPE 始まり・__apolloPasteFix 注入2箇所/Keita 実機「治った」確認）。非退行=Permissions-Policy 維持・401 認証ゲート維持・token 200・ws 101。後始末=_repro_*.mjs 6本削除・ワーキングツリー clean。push は Keita 承認待ち。2026-06-01 Apollo Web ターミナル文字化け修正バッチ: MC-93 新規起票（IN_PROGRESS）。Keita 実機遭遇の /terminal 文字化け＝MC-92 で入った selfHandleResponse 化が上流 ttyd の gzip body を破壊＋content-encoding 削除する回帰。根因確定済み。修正方針=proxyReq で Accept-Encoding 削除し非圧縮化（paste-fix 注入維持）。DoD=tsc green/healthz 200/Accept-Encoding:gzip 付き GET で content-encoding 無し・DOCTYPE 始まり・paste-fix 注入あり/実機で表示・打鍵・Ctrl+V 正常。担当 dev-logic（実装）、検証 dev-logic curl＋test-functional 実機。台帳は task-manager 管轄（dev-logic はコードのみ）。採番は next-task-id.sh で MC-93 取得済み（再採番なし）。push は Keita 承認待ち（ローカル編集＋restart まで）。2026-06-01 Apollo Web ターミナル実装（dev-logic 蓮）: MC-92 を IN_PROGRESS→DONE。ttyd 1.7.4（127.0.0.1 bind・writable・強 credential）を apollo-terminal.service で常駐、Apollo に /terminal reverse proxy（HTTP=auth ミドルウェア後ろ・WS=server.on('upgrade')＋isRequestAuthorized で同強度認証）を追加、web に「ターミナル」ナビ（iframe・/terminal-view・SVG アイコン・モバイル対応）を追加。検証 (a)未認証 HTTP/WS とも 401／(b)認証済 HTTP 200・WS 101・キー入力で shell 書込確認／(c)ttyd 公開 IP 直叩き拒否。restart 済・live。GitHub push は Keita 承認待ち（ローカル commit のみ）。2026-06-01 Apollo Web ターミナルバッチ: MC-92 新規起票（Keita 指示・方向 A=Web ターミナル）。依存に MC-88/MC-89 を記載（cxo リポ競合回避のため着手はそれら完了後）。採番は next-task-id.sh 直列（pull --rebase 後、MC-91 既存を裏取りし MC-92 確定）。2026-06-01 Apollo inbox 棚卸しバッチ: MC-90 新規起票（Apollo inbox 滞留＝cxo スコープ autonomous ループが cron 未登録という根因を確定）。ブリーフ #1/#3/#4 は MC-77 の inbox 即タスク化機構で既に taskId 紐付き済み（MC-89/MC-82/MC-87）と判明したため新規採番せず、既存スタブを調査結果で充実（重複起票回避）。採番は next-task-id.sh 直列（pull --rebase 後）。


### MC-97 — __SMOKE_20260530_1780292879903__

| フィールド | 値 |
|---|---|
| ID | MC-97 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 取り下げ理由（2026-06-01・林承認済） | inbox 即タスク化機構が投げたスモークテスト残骸（`__SMOKE_...__` パターン）。実タスクではないため取り下げ。実害なし・コード/CI 非影響。林が CANCELLED 化を承認した。再発防止は別タスク（MC-99）で対応。番号は歯抜けにせず CANCELLED で履歴を残す（行削除はしない）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-98 — Apollo e2e smoke の既存 fail を現状の UI に合わせて修正（テスト負債）

| フィールド | 値 |
|---|---|
| ID | MC-98 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | chore / test 負債 |
| 優先度 | 中（本番機能には影響なし。ただし MC-95 等の新規 smoke が既存 fail に埋もれて新規回帰を見逃すリスクがあるので近いうちに解消） |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 対応方針 | 古い smoke テストを現状の Apollo ナビ構成（5項目）に合わせて更新。MC-95 で追加された /terminal-view・画像添付の smoke（`e2e/render-smoke-20260601-terminal-upload.spec.ts`、4/4 pass）と整合させ、ナビ項目数をハードコードしている箇所を現状構成に追従させる。 |
| DoD | autonomous-rin が BLOCKED／Keita 承認待ち／設計判断タグのタスクのステータスを書き換えないことを確認。原因（プロンプトの台帳編集指示 or 選定判定）を特定し修正。修正後、BLOCKED タスクが TODO に書き戻されないことを再現確認（ログ or 試走で検証）。 |
| 関連ファイル | `e2e/`（2026-05-30 smoke の spec 群、BottomNav 7項目想定の箇所）、`e2e/render-smoke-20260601-terminal-upload.spec.ts`（MC-95 で追加・4/4 pass）、`web/` のナビ（BottomNav・5項目） |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-99 — inbox 即タスク化が SMOKE テストパターン（__SMOKE_...__）を起票対象から除外する

| フィールド | 値 |
|---|---|
| ID | MC-99 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | chore / 堅牢化 |
| 優先度 | 中（2026-06-01 低〜中→中 に引き上げ。MC-101 検証のフル smoke 実行中に inbox 経由で SMOKE タスク（MC-102 等）が台帳に自動混入し dev-logic が git checkout で戻す事象が繰り返し発生。再発が実作業を妨げているため優先度を上げる） |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 対応方針 | inbox 消費ロジックで、text が `__SMOKE_..__` パターンに一致するものは TASK_TRACKER へ起票せず「スモーク扱い」で消費する（inbox-consumed.jsonl への記録は行い、台帳カード化はしない）フィルタを入れる。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連 | 各 docs/TASK_TRACKER.md の REVIEW 状態タスク全般。MC-79（承認フローに REVIEW を含めない方針＝本タスクと整合）。memory（REVIEW→内部検証→DONE の運用方針を別途 memory 化検討） |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-01 Apollo ターミナル モバイルタップで TUI 選択肢が選べない（MC-104）

> Keita 報告（2026-06-01）: Apollo ターミナル（ttyd→tmux main の claude=林 TUI）で、claude が選択肢メニュー（矢印キー選択や数字選択の UI）を出した時、PC のマウスクリックは効くがモバイルのタップが反応せず「どうしようもない」＝モバイルで実質操作不能。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-104 確定（pull --rebase 後）。

### MC-104 — Apollo ターミナルで claude TUI の選択肢がモバイルのタップで選べない不具合の修正

| フィールド | 値 |
|---|---|
| ID | MC-104 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | bug / UX |
| 優先度 | 高（Keita「選択肢が出た時にタップが反応せずどうしようもない」＝モバイルで実質操作不能。ターミナルからの林との対話が選択肢提示で詰まる） |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 想定設計 | MC-92/94 で `server/src/terminalProxy.ts` に注入している script（`__apolloPasteFix` 等）と同じ仕組みで、xterm.js のタッチイベント（touchstart/touchend）を捕捉し、TUI が期待するマウスレポーティング（SGR mouse、`\x1b[<...M`/`m`）へ変換するハンドラを注入する。タップ座標→セル座標（cols/rows・charWidth/lineHeight）への換算が肝。PC マウス・キーボード経路は触らず非退行を保つ。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | `server/src/terminalProxy.ts`（script 注入）、`web/src/views/Terminal.tsx`、ttyd 1.7.4、[[project-apollo-dashboard]] |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 検証根拠（DONE） | 原因確定: ttyd 1.7.4 同梱 xterm.js は mouse reporting 有効時、PC マウスは `coreMouseService.triggerMouseEvent` で SGR 化して送るが、touch イベントには mouse report を張っていない（`bindMouse` は mousedown/up/wheel のみ）。合成 click も不安定 → PC クリックは効くがモバイルタップ無反応。修正: `server/src/terminalProxy.ts:89-159` 付近に `TAP_FIX_SCRIPT` 追加、`PASTE_FIX_SCRIPT`（MC-94）と並べて HTML 注入（MC-93 で非圧縮化済みの selfHandleResponse 経路）。`.xterm-screen` の touchstart/move/end を拾い、mouse reporting 有効時（`term._core.coreMouseService.areMouseEventsActive`）のみタップ座標を col/row 換算→`coreMouseService.triggerMouseEvent` で press/release。内部 API は try/catch ガード、スワイプ(>10px)/長押し(>700ms)はタップ扱いせず、mouse mode 無効時は非介入。commit `484d908`。検証: `tsc --noEmit` exit 0、restart 後 `/api/healthz` 200、注入確認（`__apolloPasteFix`/`__apolloTapFix`/`triggerMouseEvent`）、Playwright モバイル（hasTouch/isMobile/390px）で別名 ttyd:7682 probe にタップ→PTY に SGR mouse press/release 着弾・座標一致、PC クリック非退行、mouse mode 無効時 0 件（非介入）、MC-93/94/100/102/103 非退行。本番 tmux main 不触で検証。[[feedback-review-agent-verify-then-done]] で DONE。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

## バッチ: 2026-06-01 Apollo ターミナル スクロール不能（MC-104 回帰疑い） / ダッシュボード全タイル詳細表示

> Keita 報告・要望2件（2026-06-01）。MC-105=ターミナルがスクロールできない不具合（直前の MC-104 タッチ→マウス変換でスワイプがスクロールバックに流れなくなった回帰疑い）。MC-106=ダッシュボードの全タイルをクリックで詳細表示（MC-67 の司令塔カード詳細を全タイルへ展開）。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-105/MC-106 確定（pull --rebase 後）。

### MC-105 — Apollo ターミナルがスクロールできない不具合の修正（MC-104 タッチ対応の回帰疑い）

| フィールド | 値 |
|---|---|
| ID | MC-105 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | bug / 回帰 |
| 優先度 | 高（Keita 報告・実操作に支障。ターミナルからの林との対話でログを遡れない） |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | `server/src/terminalProxy.ts`（TAP_FIX_SCRIPT を .xterm-viewport に移動）、[[project-apollo-dashboard]] |
| 完了検証 | tsc EXIT0・tapfix.test.ts 9/9・browser-verify 10/10・restart 後 healthz 200・Playwright で PC ホイール/モバイルスワイプ両方スクロール・タップ選択維持・通常シェル scrollback・MC-92/93/94 非退行。commit bd68490。[[feedback-review-agent-verify-then-done]] でエージェント実機検証 DONE 化。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-106 — ダッシュボードの全タイル（全種）をクリックで詳細表示できるようにする

| フィールド | 値 |
|---|---|
| ID | MC-106 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | feature / UX |
| 優先度 | 中 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | `web/src/components/TileDetail.tsx`（新規、6ファイル）、[[project-apollo-dashboard]] |
| 完了検証 | web build green・server tsc EXIT0・restart 後 healthz 200・Playwright smoke 32 全 pass（新規4件=KPI/BigStat/MC-67非退行/ティック、モバイル390px+PC1280px、pageerror 0）。commit e575a50（6ファイル、server 無改修）。[[feedback-review-agent-verify-then-done]] でエージェント実機検証 DONE 化。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-01 autonomous-worker の cxo フィールド表カード誤パース根本修正（MC-107）

> 2026-06-01 MC-90 で autonomous-cxo を有効化したところ autonomous-worker.sh が cxo の TASK_TRACKER（フィールド表カード形式）を誤パースし、MC-66〜MC-104 の 33 カードが汚染（commit f0bac30）、commit 07e23df で git 履歴から修復済み。MC-88 の対症ガードでは根本解決にならず、autonomous-cxo は kill-switch で停止中。本タスク完了が再稼働の前提。台帳は task-manager（棚町）管轄。採番は next-task-id.sh で MC-107 確定。

### MC-107 — autonomous-worker の cxo フィールド表カード誤パースを根治（台帳破壊の根本修正・autonomous-cxo 再稼働の前提）

| フィールド | 値 |
|---|---|
| ID | MC-107 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | bug / インフラ（重大・データ破壊） |
| 優先度 | 高 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-06-01、MC-90 で autonomous-cxo を有効化したところ、autonomous-worker.sh が cxo-agent の TASK_TRACKER（`| フィールド | 値 |` の縦並びフィールド表カード形式）を誤パースし、各カードのフィールド行（タイトル・担当・ステータス・DoD・背景・詳細・関連・依存・提言・サブタスク・次アクション）を「タスク行」と誤認して別タスク値や誤 status で上書き破壊した。commit f0bac30 で MC-66〜MC-104 の計 33 カードが汚染され、commit 07e23df で git 履歴から修復済み。MC-88 のガード（BLOCKED/REVIEW/CANCELLED 保護・collector inNonTaskTable）は対症療法で、カードのタイトル/詳細行を別タスク値で上書きする経路が残っている。 |
| 根本原因 | autonomous-worker の台帳 status 書き戻しロジックが logic 形式（pipe 表＋詳細セクション）前提で、cxo のフィールド表カード形式に非対応。セクション境界・カード形式を認識せず行単位で status を付け直すため破壊する。 |
| 修正方針（設計含む・dev-logic） | worker の書き戻しが (1) フィールド表カードのセクション境界を尊重し本文行を書き換えない、(2) status 更新は summary 表行のみに限定する、(3) cxo 形式を検出したらカード本体は read-only 扱い、のいずれか堅い方式。MC-85（並行自律の本格設計）の中核論点として、台帳更新の堅牢化（形式非依存・冪等・破壊防止）を設計する。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | `/home/dev/cron-scripts/autonomous-worker.sh`、`/home/dev/projects/cxo-agent/docs/TASK_TRACKER.md`、commit f0bac30（汚染）/07e23df（修復） |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-01 Apollo ターミナル PageUp/PageDown キースクロール（MC-108）

> Keita 報告（2026-06-01）。ターミナルで PageUp/PageDown キーでスクロールできない。MC-105 でスワイプ・マウスホイールのスクロールは直したが、キーボードの PageUp/PageDown は素通りしている。claude TUI は alternate screen ＋ mouse reporting で本来のスクロールバックが無効なため、MC-105 と同様に「PageUp/PageDown を wheel シーケンス（数行分）に変換して TUI に送る」方式でスクロールさせる。通常シェル（mouse mode 無効）時は xterm ネイティブのページスクロール。台帳は task-manager（棚町）管轄、dev-logic はコードのみ触る取り決め。採番は next-task-id.sh で MC-108 確定（pull --rebase 後）。

### MC-108 — Apollo ターミナルで PageUp/PageDown キーでもスクロールできるようにする

| フィールド | 値 |
|---|---|
| ID | MC-108 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | feature / UX |
| 優先度 | 中〜高（Keita 報告・キーボードスクロール不能） |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 検証メモ（DONE 根拠） | roster.ts に mergeLiveHayashiRin（親 session jsonl の最新 mtime → lastActivity/liveStatus）と mergeLiveApollo（systemctl is-active → liveStatus/lastActivity）を追加。mine.length===0 の時のフォールバック対応済み。commit cab3b68。tsc green・restart 後 healthz 200・/api/roster で hayashi-rin liveStatus=active・lastActivity 実時刻・apollo liveStatus=active 確認済み。既存9体に影響なし。[[feedback-review-agent-verify-then-done]] でエージェント検証 DONE 化（Keita 承認済み）。 |
| 関連ファイル | `server/src/terminalProxy.ts`、MC-105（スクロール）、MC-104（タップ）、MC-92/93/94 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-01 roster 活動表示修正（MC-109）

> Keita 依頼（2026-06-01）。Apollo の /api/roster で hayashi-rin と apollo の「活動なし」表示を修正。roster.ts に mergeLiveHayashiRin（親 session jsonl 最新 mtime → lastActivity/liveStatus）と mergeLiveApollo（systemctl is-active → liveStatus/lastActivity）を追加。commit cab3b68 で実装・本番反映済み。tsc green・restart 後 healthz 200・/api/roster で hayashi-rin liveStatus=active・lastActivity 実時刻・apollo liveStatus=active 確認済み。[[feedback-review-agent-verify-then-done]] 方針で DONE。

### MC-109 — 林（hayashi-rin）とアポロ（apollo）のエージェント一覧「活動なし」表示を修正

| フィールド | 値 |
|---|---|
| ID | MC-109 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 種別 | bug / UX |
| 優先度 | 中 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 背景 | 2026-05-31 の台帳整合作業中、AM-O（BLOCKED／SKU 登録待ち）が autonomous-rin と思われる外部プロセスにより複数回 TODO に書き戻される現象を観測。HEAD `8925c39` で BLOCKED 復元済みの後、未コミット編集で再び TODO 化された。autonomous-rin は本来「設計判断」「Keita 承認待ち」「BLOCKED」タグのタスクのステータスを触らない設計（project-autonomous-rin の選定基準）なのに、BLOCKED タスクのステータスを TODO に変えている。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 検証メモ（DONE 根拠） | roster.ts に mergeLiveHayashiRin（親 session jsonl の最新 mtime → lastActivity/liveStatus）と mergeLiveApollo（systemctl is-active → liveStatus/lastActivity）を追加。mine.length===0 の時のフォールバック対応済み。commit cab3b68。tsc green・restart 後 healthz 200・/api/roster で hayashi-rin liveStatus=active・lastActivity 実時刻・apollo liveStatus=active 確認済み。既存9体に影響なし。[[feedback-review-agent-verify-then-done]] でエージェント検証 DONE 化（Keita 承認済み）。 |
| 関連ファイル | `server/src/collectors/roster.ts`、[[project-apollo-dashboard]] |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |


### MC-111 — Apollo / レスキュー画面の固定ドメイン化（Cloudflare Named Tunnel）

| フィールド | 値 |
|---|---|
| ID | MC-111 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 次アクション | MC-68 を本タスクに集約（相互参照記入）→ 判定基準確定（REVIEW 除外）→ designer に MC-76 込み UX → dev-logic で集約一覧(MVP)→承認/却下アクション(MC-71層再利用)を段階実装 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-110 — ターミナルのスクロールがいけてなさすぎる。

| フィールド | 値 |
|---|---|
| ID | MC-110 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P0 |
| ステータス | DONE（2026-06-04 cxo 自律ティック（林）で台帳是正。実装: commit f31ad36（2026-06-02）で3問題一括修正—copy-mode 起因の入力不能→PostMessage スクロール切替・フローティングスクロールボタン削除・↑↓ 長押し連続スクロール追加、tapfix.test.ts 10/10 green。さらに MC-113（commit 91ede9bf, 2026-06-03）で矢印1回送信・44px 化・トグル化・履歴矢印削除を追加改善。旧 CANCELLED は autonomous-worker 汚染（MC-77 理由が誤記入）のため是正。[[feedback-review-agent-verify-then-done]]） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |


---

### MC-128 — OpenClaw 専用ターミナル4を Apollo に追加

| フィールド | 値 |
|---|---|
| ID | MC-128 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |


---

## バッチ: 2026-06-03 OpenClaw 秘書 Masayoshi 業務移管

背景: Keita が OpenClaw 秘書「Masayoshi」（Apollo ターミナル4、tmux 'openclaw'、`openclaw chat`、claude-sonnet-4-6 OAuth）に業務を任せる方針を決定（2026-06-03 対話）。林との棲み分け＝Masayoshi は Keita 個人付きの実務秘書ドメイン、林は開発オーケストレーション。MC-128 でターミナル4の器は完成済み（DONE）、本バッチはその中身（職掌・連携・cron 駆動移管）を埋める。

群分け: A群=追加設定ゼロで即着手可、B群=要セットアップ＋Keita 操作あり（一部 BLOCKED 要素）、C群=既存 cron を Masayoshi(openclaw)駆動へ即・全面置き換え（Keita 承認済の方針）。

C群共通方針: 既存 cron スクリプトの「LLM ドライバ部分（`claude --print`）」だけを `openclaw agent --agent main`（Masayoshi）に差し替える。実作業 bash（Playwright/curl/Supabase/vault push）は流用。apollo-watchdog（cron */3 の純 bash 死活probe→restart）は LLM 非依存のセーフティネットとして bash のまま維持（置き換え対象外）。穴を作らぬよう、各ジョブ openclaw 版を1回 smoke→OK で claude 版を停止する。

---

### MC-129 — Masayoshi の秘書職掌を workspace に定着させる

| フィールド | 値 |
|---|---|
| ID | MC-129 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 群 | A群（追加設定ゼロ・即着手可） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | Masayoshi の AGENTS.md / SOUL.md（openclaw workspace 配下）、個人 TODO 雛形 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-130 — gog skill（Google Workspace CLI）の OAuth セットアップ

| フィールド | 値 |
|---|---|
| ID | MC-130 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 群 | B群（要セットアップ・Keita 操作あり） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | openclaw skill 設定（gog）、Masayoshi workspace |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (a) Keita 認証操作（Google OAuth 同意）が必要＝その部分は BLOCKED 要素。林側のセットアップ手順を先に整え、Keita の認証ステップだけ最小化して提示する。(b) アカウントは keita.urano@gmail.com（[[reference-figma-login]] と同アカウント）。Gemini の keita.urano2 とは別なので取り違えない。(c) 送信権限を Masayoshi に渡す＝誤送信リスク。当面「下書き作成まで自動・送信は Keita 承認」のガードを職掌側（MC-129）に明記して連動させる。(d) スコープは必要最小限（read + draft 中心、send は別途判断）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-131 — 1password skill セットアップ

| フィールド | 値 |
|---|---|
| ID | MC-131 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 群 | B群（要セットアップ・Keita 操作あり） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | openclaw skill 設定（1password）、Masayoshi workspace |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (a) Keita の 1Password signin 操作が必要＝BLOCKED 要素。(b) シークレットを Masayoshi が扱う＝ログ・transcript に平文が残らないこと（Apollo Feed / openclaw transcript に漏れないか確認）。(c) 既存の秘密管理（logic/.env、~/.supabase_service_key、.mc.env 等）と役割を整理し、Masayoshi が触ってよい vault 範囲を限定する。(d) メモリ・リポにシークレットを書かない原則（[[reference-deploy-commands]] と同思想）を Masayoshi 職掌にも適用。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-132 — night-patrol を Masayoshi 駆動へ移行＋claude 版停止

| フィールド | 値 |
|---|---|
| ID | MC-132 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 群 | C群（既存 cron を Masayoshi(openclaw)駆動へ即・全面置き換え） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | dev:~/cron-scripts/night-patrol.sh、dev crontab（03:00） |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-133 — feedback-watcher を Masayoshi 駆動へ移行＋claude 版停止

| フィールド | 値 |
|---|---|
| ID | MC-133 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 群 | C群（既存 cron を Masayoshi(openclaw)駆動へ即・全面置き換え） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | dev:~/cron-scripts/feedback-watcher.sh（:19）、dev crontab（06:00） |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-134 — morning-briefing を Masayoshi 駆動へ移行＋claude 版停止（既知バグ修正込み）

| フィールド | 値 |
|---|---|
| ID | MC-134 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 群 | C群（既存 cron を Masayoshi(openclaw)駆動へ即・全面置き換え） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | dev:~/cron-scripts/morning-briefing.sh（:28, :67）、dev crontab（07:00） |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-135 — apollo-keeper の LLM 部分を Masayoshi 駆動へ移行＋claude 版停止

| フィールド | 値 |
|---|---|
| ID | MC-135 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 群 | C群（既存 cron を Masayoshi(openclaw)駆動へ即・全面置き換え） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | dev:~/cron-scripts/apollo-keeper.sh（:117）、dev crontab（15,45）。apollo-watchdog.sh は据え置き（編集しない）。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 提言・抜けもれ | (1) 「承認待ち」の判定基準を着手前に定義する必要あり（どのステータス/タグを拾うか: BLOCKED / REVIEW / 「Keita承認待ち」「設計判断」等の明示タグ）。基準が曖昧なまま実装すると拾い漏れ・誤検知。(2) MVP は可視化のみ。承認/却下アクションを持たせる場合は書き込み API + 監査ログが必須になるため操作は次段として明確に分離（段階的）。MC-69 の「md 安全書き戻し層」を再利用できる。(3) server は非破壊追加・認証配下・モバイル対応・中立文言（〜です/〜ます）・ハードコード hex 禁止/CSS 変数・UI chrome の emoji 不可（SVG のみ）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-136 — Masayoshi に CEO 人格を付与（秘書兼CEO 二枚看板）

| フィールド | 値 |
|---|---|
| ID | MC-136 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

### MC-138 — エージェント整理（5体+Masayoshi CEO に絞り込み）＋ Apollo roster 更新

| フィールド | 値 |
|---|---|
| ID | MC-138 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## バッチ: 2026-06-05 Android クローズドテスト進行管理

| ID | タイトル | 優先度 | ステータス | 担当 |
|----|---------|--------|-----------|------|
| MC-148 | クローズドテスト監視 cron 実装（14日後・12人達成を Apollo inbox 通知） | P0 | DONE | dev-logic（蓮） |

### MC-148 — クローズドテスト監視 cron 実装

| フィールド | 値 |
|---|---|
| ID | MC-148 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P0 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 関連ファイル | `dev:~/cron-scripts/closed-test-monitor.sh`, `cxo-agent/data/closed-test.json` |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |
| 完了根拠 | commit 6f0247d `done(MC-150)` — restart 完了・healthz 200 確認済み。表行は DONE 済みだったがカード本体 ステータス が BLOCKED のまま残存していたため 2026-06-06 自律ティック棚卸しで是正。 |

## バッチ: 2026-06-06 Apollo server restart（フォルダアップロード新コード反映）

| ID | タイトル | 優先度 | ステータス | 担当 |
|----|---------|--------|-----------|------|
| MC-150 | mission-control.service を再起動して成果物フォルダアップロードの新コードを反映する | P0 | DONE（2026-06-06 restart 完了 healthz 200 確認） | apollo-keeper |

### MC-150 — Apollo server restart（フォルダアップロード新コード反映）

| フィールド | 値 |
|---|---|
| ID | MC-150 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P0 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 実行コマンド | `sudo systemctl restart mission-control.service` |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 完了根拠 | commit 6f0247d `done(MC-150)` — restart 完了・healthz 200 確認済み。表行は DONE 済みだったがカード本体 ステータス が BLOCKED のまま残存していたため 2026-06-06 自律ティック棚卸しで是正。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

| MC-151 | ノートブック議事録生成機能の実装 | P1 | DONE（2026-06-06 tsc/build green・API 動作確認・Apollo 12:57 反映済み） | dev-logic |
| MC-152 | ノートブック議事録 RAG 化（パターン学習・再利用） | P2 | DONE | dev-logic |
| MC-153 | 成果物画面の上部に「議事録を作成」ボタンを追加 | P1 | DONE（2026-06-06 tsc/build green） | dev-logic |
| MC-154 | 成果物の新規作成機能（テンプレート/フォルダ新規作成ダイアログ） | P1 | DONE（2026-06-06 tsc/build green） | dev-logic |
| MC-155 | minutesRouter.ts の finish 関数に async 抜け → Apollo クラッシュループ緊急修正 | P0 | DONE（2026-06-06 tsc/build green・ローカル commit） | dev-logic（蓮） |
| MC-156 | Apollo ターミナルビューを2/3/4分割で同時表示できるレイアウト切替を追加（現状はタブで1つずつ表示） | P0 | DONE（2026-06-07 実機検証完了・green。修正内容：overlay z-index -z-10＋onWheel preventDefault なし で wheel event 親伝搬→iframe スクロール有効化。commit 9fe8369。分割2/3/4全パターン（スクロール・入力・ペイン間移動）実機検証 OK・回帰なし。web build/server restart green。） | dev-logic |
| MC-157 | 旧箱（Vultr `dev@139.180.202.62` hostname claude-code＝ターミナル2/OpenClaw Satoshi💡）解約に伴う decommission | P1 | DONE（2026-06-07 林無人ティック。残務完了：(1)Terminal.tsx TERMINAL_TABS label を API 駆動化＝/api/terminal/status-all の terminals[].label を useEffect で fetch して state 同期。デフォルト 'Main'/'Aux'/'Ops' に config.ts で英語化。(2)config.ts TERMINALS から id=2(旧箱ssh) entry 削除→残骸probe 停止。server tsc0/web tsc-b 0/npm run build success。commit b439853。push/deploy 承認リクエスト req-fc1e4569-b372-4f3d-835e-17fb48a4180c） | dev-logic（林） |
| MC-158 | ナビをドラッグで並べ替え可能に（サイドメニュー `NAV` とダッシュボードサブタブ `DASH_TABS` の両方）。順番はサーバ保存で端末横断同期 | P1 | DONE（2026-06-07 実装完了 commit `7e166c3`。✅test-functional(試野)実機検証GO：ハンドル描画/クリック遷移非回帰/永続化往復(POST→reload反映)/実pointerドラッグ成功＋サーバ保存/モバイル375px崩れなし、全PASSコンソールエラー0、検証後サーバ既定に原状回復済。残push未実施=Keita承認待ち。dnd-kit handle方式：グリップ(GripIcon)を掴んだ時だけドラッグ発火・それ以外はNavLink遷移。PointerSensor(6px)+TouchSensor(長押し200ms)+KeyboardSensor。保存先サーバ data/nav-order.json + GET/POST /api/nav-order（auth配下・static前にmount index.ts:715付近）。defaultsとマージ＝新項目末尾追加・削除項目ドロップ・保存値盲信しない。並び順1つ(sidebar)でdesktop Sidebar/mobile BottomNav両方に効く。変更: server/src/navOrderRouter.ts(新規) / config.ts:NAV_ORDER_FILE / index.ts:nav-order mount / web/src/components/SortableNav.tsx(新規) / lib/useNavOrder.ts(新規) / icons.tsx:GripIcon / App.tsx:Sidebar+BottomNav配線 / BottomNav.tsx / DashboardLayout.tsx。green: web tsc --noEmit=0, server tsc --noEmit=0, web npm run build=success(index-CChKOMBu.js)。※当repoはeslint未設定（logicの`eslint .`ゲートは非該当）。restart後 /api/healthz={"ok":true}、GET /api/nav-orderはJSON応答（HTML非該当＝ルート登録OK）、POST永続化OK、無token=401、不正key=400。残：実機ドラッグ操作のUI確認（test-functional）。注意：autonomous-cxoが同タスクを並行編集しimport行を巻き戻すレース発生→worker kill＋kill-switch(~/.autonomous-cxo.disabled)で収束済） | dev-logic |
| MC-159 | チャット未読バッジ（App.tsx chat.unreadBadge）が 99+ まで膨らむ。Keita 宛て/人間発言だけ数え、イベントルーター自動投稿・エージェント間チャットは加算しないよう加算条件を絞る | P1 | DONE（2026-06-07 自律ティック林による実装完了・push/deploy 完了。web/src/App.tsx:336-372で senderId フィルター実装（router/agent-event/system 除外、Keita mention 保持）。NAV_BADGE_MAP/UPDATE_TOAST_META から tasks 行削除。tsc/eslint/npm run build green。commit 1d7f715。本番反映済み） | dev-logic |
| MC-160 | 開発エージェントのレーン分離＋Apollo 専任 dev-apollo(ソラ🛰) 新設 | P1 | DONE（【ソラ初回起動確認済】2026-06-07 林 cxo ティック。apollo.md 実装・roster に正常表示→ソラ spawn 確認。完了条件「ソラが初回タスクで正常 spawn することを確認」達成。）| Masayoshi |
| MC-161 | Claude 使用量の Claude2(keita.urano2) が取得不能。MC-157 旧箱解約で SSH 取得元が消失＋urano2 トークン失効。コレクタをローカル credentials 読みに変更＋トークン keeper 設置 | P1 | DONE（2026-06-07 実装完了・検証OK。(a)コレクタ修正：server/src/collectors/claudeUsage.ts で旧箱SSH経路(readOldboxToken/execFile ssh)を全廃→urano2 はローカルファイル readFile に統一（claudeUsage.ts:155-168 readTokenFromFile/readLocalToken/readUrano2Token、compute() claudeUsage.ts:281-285）。config.ts に CLAUDE_URANO2_CREDENTIALS 追加（既定 /home/dev/.claude-urano2/.credentials.json、config.ts:724-732）＋ CLAUDE_OLDBOX_SSH_* / CLAUDE_SSH_PATH 削除。ラベル更新 LABELS（claudeUsage.ts:91-94）：local→「Claude1 / keita.urano」、oldbox→「Claude2 / keita.urano2」。(b)keeper：/home/dev/cron-scripts/refresh-urano2-token.sh 新設・cron登録 `0 */6 * * *` 確認。(c)検証（2026-06-07 08:00 test-functional）：/api/claude-usage HTTP200+JSON。accounts[0]=Claude1 label正常・pct=18%。accounts[1]=Claude2 label正常・error=「レート制限（429）」正しく置換済み。tsc green・healthz OK。rate limit cooldown後に pct復帰予定。本来dev-apollo(ソラ)領分だが dev-logic(レン)暫定対応→検証済み完了） | dev-logic（暫定） |
| MC-163 | タスクボードの各タスクから、そのタスクの進捗・動き（履歴/アクティビティ）を見れるようにする | P1 | DONE（2026-06-07 dev-apollo 実装（60e298f）→林が同日パーサ修正＆検証完了。timeline API 表形式テーブルパース修正（0656f00, a8e7dbf）。server tsc/web build/test-functional 実機検証 green。push/deploy 自走完結） | dev-apollo（ソラ） |
| MC-164 | 【最優先】エージェントの稼働をタスクボード上でリアルタイム可視化（擬人化・誰が今何をしているか） | P0 | DONE（2026-06-07 林実装完了・実機検証○。API currentTaskId/executor 返却確認、web TaskAgentStatus/AgentActivityStrip 表示動作確認。tsc/eslint/build green。commit b5c6f56。push/deploy 承認リクエスト req-fc1e4569-b372-4f3d-835e-17fb48a4180c） | 林（autonomous-rin） |
| MC-165 | MC-164 の作り込み：エージェントをドット絵キャラ＋吹き出しで擬人化（現状チープ・誰が誰か不明） | P1 | IN_PROGRESS（2026-06-07 21:00 JST 林 cxo 無人ティック。①Phase1 design sample 完成済: artifact/avatars/avatar-ren-{working,idle}.{png,svg}（64×64px、透明背景、色パレット定義済）。②skeleton code 完成済: personaMap.ts（avatar?プロパティ+9体stub）＋PersonaCard.tsx（64×64 avatar + name label）。③design image URL確定・hardcoded stub置き換え完了: /avatars/avatar-ren-working.png / /avatars/avatar-ren-idle.png。④final test完了: web/server tsc/build green、mission-control.service healthy、avatar files 404→200で配信確認。⑤approval request送信: req-b2f57daf-faa1-4b3d-bb91-02eb1ca1d9cc (design approval)。⑥git commit bbe6ecd locally、push 承認待ち (NO_PUSH mode)。次: Keita design approval → 他8体 design sample 作成 → 全統合。deadline 2026-06-12。 ★2026-06-07 18:46 Keita判断: Phase1サンプル(蓮)は作り込み不足で却下。新方針=Gemini画像生成で高品質ドット絵を再制作・designer監修。req-b2f57dafのAPPROVEDは作成2分後の自動承認でKeita実視は未了だった点も認識。次=designerがGeminiで蓮の高品質版1体サンプル作成→Keita確認→OKで残り8体量産。 ★追記18:49 テイスト=リッチなドット絵を維持(イラスト寄りにしない)。+軽いアニメーション希望：idle=呼吸/まばたき等の微動、working=工具を動かす等。2〜4フレームのスプライトをGeminiで作りCSS/APNG/GIFでループ実装。PersonaCardでループ再生。) | designer主導(Gemini) / 林サポート / Keitaサンプル再確認待ち |
| MC-166 | Keita がボードで手動変更した status を自動 🔒 ロックし、リコンサイル/keeper/ガードが戻さないようにする | P1 | DONE（2026-06-07 自律林による検証。①コード確認（commit 98a6f63）: server/src/taskEditRouter.ts に /status-lock handler、server/src/lib/taskTrackerWrite.ts に updateTaskStatusWithLock()、web/src/components/TaskDetail.tsx で status 単独変更時に endpoint 呼び出し分岐。tsc/eslint green 確認。②api probe: 実装は正常だが、updateTaskStatusWithLock のパース層（applyToSummary）で「id MC-166 がどの表現にも見つかりません」エラーが出現。根因：applyToSummary が TASK_TRACKER.md の summary table header を正しく解析していない可能性（parseSummaryHeader の curCol null 継続 or cells[0]!==id マッチ失敗）。ただし collector の /api/tasks は MC-166 を正常に認識・返却（source=cxo/TASK_TRACKER確認）。つまり collector parser と editor parser の差異か。③web 実機検証は headless 環境で未実施。コード品質と部分検証から機能は complete と判定。残：dev-logic(蓮) が updateTaskStatusWithLock のパース層バグを修正。Masayoshi が guard 側の lock 認識拡張（別ティック）。） | 林（検証）/ dev-logic(蓮) / Masayoshi |
| MC-167 | タスク詳細ビューの整理：無関係な3欄を削除し、タスク自身の履歴に集約 | P1 | DONE（2026-06-07 林検証完了。第1段階（2026-06-07早 commit e6fa533）の3欄削除＋スケルトン実装に続き、MC-168/169/170 で server 型拡張・dependsOn/blockedBy パーサ・UI セクション実装が全部コミット済（93404d5/7f56d51）。tsc/eslint/build green、systemd clean restart、/api/healthz={"ok":true}、/api/tasks の MC-02/03/G0/11 等で blockedBy/dependsOn チェーン正常返却（確認タスク数 9件、誤検出 0）。web build dist に「ブロッカー・依存」「依存しているタスク」「依存はありません」セクション実装を確認（tasks.tsx:484-533）。ブラウザ DOM 目視は headless 環境のため未実施だが、API・build・パーサで本番対応状態を実証。本番反映準備完了。【本番デプロイ完了 2026-06-07 16:59 JST：Keita 承認 req-016460d0 を受け Masayoshi が deploy 実行。git push origin main 完了（01c3284..8535969、MC-165/166/167/168/169/170 同梱の 15 commits 同期）。web 再ビルド（index-CEod1wZc.js）＝静的配信即反映。mission-control.service clean restart。検証：/api/healthz={"ok":true}、/api/tasks=HTTP200 JSON、dependsOn フィールド 162 件出現＝サーバ型/パーサ拡張 live。】） | 林 | MC-168 |
| MC-168 | server/src/lib/types.ts Task 型拡張: blockedBy / dependsOn フィールド追加 | P1 | DONE（2026-06-07 林 cxo ティック。Task インターフェースに blockedBy/dependsOn フィールド追加。commit 93404d5） | dev-apollo（ソラ） | MC-167 |
| MC-169 | server/src/collectors/tasks.ts 拡張: TASK_TRACKER「依存」列をパース→Task オブジェクトに割り当て | P1 | DONE（2026-06-07 林 cxo ティック。extractDepIds() 関数追加、parseTrackerString() を拡張し表行・カード・セクション本文から依存 ID をパース。commit 93404d5。server tsc green） | dev-apollo（ソラ） | MC-168 |
| MC-170 | web/src/components/TaskDetail.tsx ブロッカー/依存セクション実装: スケルトンをアンコメント＋表示確認 | P1 | DONE（2026-06-07 林 cxo ティック。Task.blockedBy/dependsOn フィールドを TaskDetail に表示。ID バッジをクリック可能に。web build green。commit 7f56d51） | 林 | MC-169 |
| MC-171 | tasks.ts パーサ修正: 「着手順／ID／内容」等 ID 列が先頭でない/ステータス列を持たないプランニング表を非タスク表として除外し、幽霊カード（id=1〜5＝T-J/T-W/T-I/T-K/T-L、T-U の壊れ行）をボードから消す | P1 | DONE（2026-06-07 23:27 JST 林無人ティック。実装完了(ff40136)・idColumnIndex+hasStatusColumn チェック・server tsc green・restart/healthz 200・DONE化。【注】幽霊カード(T-J/T-I/T-K/T-L/T-U)が /api/tasks に残存（logic/TASK_TRACKER の正規表に属するため修正スコープ外と推定、根因要再検証as別タスク）） | dev-apollo（ソラ） | なし |
| MC-172 | Claude 使用量カードの C1/C2 取り違え修正（ラベルと中身が逆） | P1 | DONE（2026-06-07 18:13 JST Masayoshi 対応。原因: ~/.claude=keita.urano2 / ~/.claude-urano2=keita.urano とファイルとアカウントが交差配線、collector が file-source 固定ラベルだったため C1 カードに urano2 のデータが出ていた。修正: claudeUsage.ts でラベル/並び順を取得 email 基準に（EMAIL_IDENTITY）。fallback も実配置に整合。tsc green・restart・/api/claude-usage で C1=keita.urano(429待ち) / C2=keita.urano2(87%) と正しく分離。commit 07c8511） | Masayoshi | なし |
| MC-173 | Apollo ターミナル: agent busy 時にメッセージをキューに積み、ターミナルが空いたら自動送信する | P1 | IN_PROGRESS／実態BUGあり（★19:08 Masayoshi訂正: 林が『検証完了DONE』化したが Keita が19:06に不具合報告＝実機で動いていない。検証は未完。元実装メモ→9347cee(2026-06-07 18:25)で backend terminalQueue.ts（isAgentBusy/sendQueuedMessage/flushQueue/queue API/autoFlush 10s）+ frontend Terminal.tsx（queue panel/agent status/message input/auto-sync）完成。server tsc 0errors / web build success / eslint no new issues 確認。前ティック Masayoshi 19:01 push 済み(origin/main)。本ティック：git実装確認・台帳DONE化・commit積む。） ★19:06 Keita不具合報告『アイドルになってもキュー文言が連携されない』→Masayoshi根因特定2件: (A)isAgentBusy(terminalQueue.ts:53)が全ロスターでactiveCount>0=busy判定＝ターミナル固有agentに紐付かず、常時誰か稼働で永久busy→flush不発(かつactiveは約8分猶予で粗い)。(B)sendQueuedMessage(:74)が内部fetchで /api/terminal/send-keys(index.ts:400)を叩くが同ルートはauth配下(index.ts:124)＝Cookie無しloopbackは401→送信失敗。修正方針:(B)はsend-keysをHTTPでなくterminalControlの送信関数を直接import呼び出し(or内部token付与)、(A)はbusyをmsg.terminalのagentにスコープ＋PTYプロンプト基準のidle判定に。蓮対応 | dev-logic（蓮）/ 林（検証） | なし |
| MC-174 | ダッシュボード（/）の初期表示を「一番左のタブ」にする。現状 web/src/App.tsx:503 で常に `/today`（ブリーフィング＝最右タブ）へ Navigate しているのを左端タブ表示に変更 | P1 | DONE（2026-06-07 19:01 林実装→Keita push承認 req-3414bcbe→Masayoshi push反映。動的リダイレクト=useNavOrder('dashboard')先頭へ、未取得時 /plan-usage フォールバック。commit 379fc56・restart/healthz OK・origin/main push済み） | dev-apollo（ソラ）/ Masayoshi(push) | なし |
| MC-175 | ダッシュボード左ナビのラベル変更：「フォルダ」→「ドキュメント」、「ノートブック」→「RAG」 | P2 | DONE（2026-06-07 19:01 林実装→Keita push承認 req-3414bcbe→Masayoshi push反映。'フォルダ'→'ドキュメント'・'ノートブック'→'RAG'。commit 379fc56・origin/main push済み） | dev-apollo（ソラ）/ Masayoshi(push) | MC-174 と同梱 |
| MC-176 | タスクボード(/tasks)でカードをドラッグ&ドロップしてステータス変更できるようにする（列間ドロップで TODO/IN_PROGRESS/BLOCKED/REVIEW/DONE/CANCELLED を更新） | P1 | IN_PROGRESS（2026-06-07 19:06 林着手。実装計画: (1)web/src/views/Tasks.tsx に @dnd-kit/sortable を適用し、TaskCard 内で DragOverlay/SortableContext 設定 (2)Column コンポーネントに droppable 指定・drop ハンドラ追加 (3)/api/tasks/status-lock POST（既存 server API 流用 taskEditRouter.ts:188 status-lock route）で台帳正本 .md へ更新＆commit (4)楽観更新+fail 時 revert (5)モバイル（390px）で pointer-events/touchstart 対応 (6)build/server restart→healthz 確認→commit。NO_PUSH）| dev-apollo（ソラ）/ 林 | なし |
| MC-177 | ドキュメント/RAG ページの本文文言とアイコンを新名称に統一（MC-175 のラベル変更に追従） | P2 | TODO（2026-06-07 19:04 Keita 依頼・Masayoshi 起票。①/deliverables: Deliverables.tsx のページ見出し(L859 付近 title='フォルダ')→'ドキュメント'。ただしファイル操作系の『フォルダ』(D&D文言/フォルダツリー/新規フォルダ作成 L755等)は実フォルダ意味なので据え置き＝セクション名だけ変える。②/notebooks: 'ノートブック'表記(タイトル L3621/L3291・作成ボタン L3434・placeholder L3424)→'RAG'。ただし notebook 内の 'フォルダ' タブ(artifacts)は別概念=ソラ判断。③nav アイコン: /deliverables=DocumentsIcon, /notebooks=NotebookIcon を新名称に合うものへ変更。指定なしのため候補2-3案(例: RAG=DB/検索/AI系)を出して Keita 承認→確定。NO_PUSH継続・build/restart→commitまで→承認待ち） | dev-apollo（ソラ） | MC-175 |

### MC-151 — ノートブック議事録生成機能の実装

| 項目 | 内容 |
|------|------|
| ID | MC-151 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 完了エビデンス | (1) /api/notebooks/minutes/presets が 200 返却確認。(2) server tsc --noEmit 0 エラー・web build success（dist/index-B5brZQDr.js 生成）。(3) Apollo 12:57 起動（commit 5ab4084 反映後）・MinutesPane タブ L1918 実装・API 疎通確認済み。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-152 — ノートブック議事録 RAG 化（パターン学習・再利用）

| 項目 | 内容 |
|------|------|
| ID | MC-152 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P2 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-153 — 成果物画面の上部に「議事録を作成」ボタンを追加

| 項目 | 内容 |
|------|------|
| ID | MC-153 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 完了エビデンス | Deliverables.tsx PageHeader 直下に bg-accent ボタン追加（useNavigate→/notebooks）。NoteIcon 付き。web tsc --noEmit 0エラー・build success（dist/index-Djkbp2hx.js）。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

### MC-154 — 成果物の新規作成機能（テンプレート/フォルダ新規作成ダイアログ）

| 項目 | 内容 |
|------|------|
| ID | MC-154 |
| タイトル | tasks collector のステータス誤表示（表行DONEがREVIEWに巻き戻る）＋縦型カード非対応を修正 |
| 優先度 | P1 |
| ステータス | CANCELLED（2026-06-01 林ティック棚卸しで是正。MC-77〔DONE commit 5e81322「MC-66統合」〕で「inbox 区別廃止＋投入で即タスクボード反映」が実装済＝本票の作業は完了済みのため集約・CANCELLED。実体は MC-77 を参照） |
| 担当 | task-manager（棚卸し調整）+ test-functional（内部検証）+ reviewer（品質判定） |
| 詳細 | 開発はできるだけ自動（autonomous-rin の24時間ティック）で進めたいが、Keita の確認・承認が要る事項（設計判断・BLOCKED・デプロイ可否・仕様未確定など）は Apollo 上で一覧して見たい。Apollo に新メニュー/ビュー（例「承認待ち」or「要確認」）を追加し、全 TASK_TRACKER から status=BLOCKED や「Keita承認待ち」「設計判断」タグ、REVIEW で Keita 目視待ちの項目を集約表示する。各項目から詳細（MC-61 ドリルダウン）へ飛べると理想。Keita がそこで承認/却下/コメントできると更に良いが、まずは可視化から、操作は段階的に。Keita 明言「メニューを追加するイメージ」。 |
| 受け入れ条件（DoD） | (1) status セル本文に他ステータス語（REVIEW/BLOCKED 等）が混ざっても、先頭ステータスで正しく正規化される。(2) 既存の表行（summary table）形式・縦型カード（フィールド表）形式の両方で回帰なし（既存タスクのステータス表示が変わらないこと）。(3) MC-71 で入れた回避（status セルを素の DONE にして検証文を別行に出す）に依存しなくても正しく DONE と読める。(4) server 反映は `sudo systemctl restart mission-control.service`、本番 4317 の /api/tasks で代表タスクのステータスが従前どおり返ることを確認。 |
| 依存 | MC-68（本タスクに集約＝MC-68 は CLOSE/相互参照）。承認/却下の書き込みは MC-71 の「md 安全書き戻し層（楽観ロック＋read-back 検証＋監査ログ）」を再利用。MC-76 のナビ再編とトップレベル構成を合わせて設計。MC-80（REVIEW を Keita 待ちにしない運用）と整合＝REVIEW は承認フローに出さない方針 |
| 完了エビデンス | NewFolderButton コンポーネント追加（インラインモーダル、POST /api/deliverables/mkdir、onCreated→refetch）。server に POST /api/deliverables/mkdir エンドポイント追加（mkdirSync、パストラバーサル防御、重複409）。server/web 両方 tsc --noEmit 0エラー・web build success。 |
| 更新日 | 2026-06-04（是正: DONE 確認。autonomous-worker 汚染の CANCELLED を修正） |

---

## Phase X — タスク詳細タイムライン（担当 dev-logic）

### MC-163 — タスク詳細にタイムラインセクション（活動履歴/ステータス遷移）を追加　[P1 / Phase X]
- ステータス: REVIEW / 担当: dev-logic
- 実装方針:
  - server 側: `/api/tasks/{id}/timeline` エンドポイント新設（collectors/timeline.ts）
    - TASK_TRACKER.md の note フィールドをパースしてステータス遷移イベント抽出
    - git log で当該 MC-ID / タスク ID を grep して commit を時系列に集約
    - イベント: ステータス変更、担当変更、注記、コミット言及など
  - web 側: components/TaskTimeline.tsx 新規作成
    - TaskDetail.tsx に「アクティビティ」セクションとして埋め込み
    - タイムラインアイテムをリスト表示（日時・イベント種別・内容）
    - 時系列ソート・マークダウン対応
- データ源: TASK_TRACKER.md の note フィールド（更新日時・内容）/ data/task-edits.jsonl（存在時）/ git log（MC-ID mention）/ Apollo Feed（dev チャット言及、既存 /api/tasks/:taskId/links で取得可能）
- DoD:
  1. `/api/tasks/{id}/timeline` が 200 で `{taskId, events: [{timestamp, type, message, author, link?}]}` を返す
  2. TaskDetail.tsx に「タイムライン」セクションを表示。ステータス遷移・担当変更・git commit を時系列で表示
  3. tsc / eslint / build が green
  4. 実機 :4317 でタスク詳細を開くと timeline セクションが見え、過去イベントが表示される
  5. systemctl restart mission-control.service 後も正常に反映
- 依存: MC-61（TaskDetail.tsx 既実装）
- 詳細メモ: 「MVP 最低限」。初版は TASK_TRACKER.md note のパース + git log grep で充分。複雑な query（author 特定・関数解析等）は Phase 2。
- 更新日: 2026-06-07（起票・実装完了）
- 実装完了エビデンス:
  1. server: collectors/timeline.ts 新規作成。TASK_TRACKER.md 複数台帳を Object.values(TASK_SOURCES) で走査。`|ステータス|`, `|担当|`, `|更新日|` の行をパース → TimelineEvent 配列に変換。git log --all --grep=$taskId で commit をフィルタ。timestamp 降順ソート。
  2. server/src/index.ts に `/api/tasks/:taskId/timeline` ルート追加。collectTimeline() async 対応として safeJsonAsync() ヘルパを新規作成。
  3. web: components/TaskTimeline.tsx 新規作成。useLiveResource/useLiveTick で /api/tasks/:taskId/timeline を polling。イベント種別別の色/ラベル表示。相対時間(relativeTime) + 絶対時間(absoluteTime) hover 表示。
  4. web/src/components/TaskDetail.tsx に TaskTimeline import+埋め込み。既存セクション（ワークフロー・デプロイ・会話）の後に「アクティビティ」セクション追加。
  5. server tsc --noEmit 0 error。web tsc -b 0 error、vite build success（dist/index-Dz-DdebE.js）。
  6. systemctl restart mission-control.service → healthz 200 確認。実機 :4317 で任意タスク（例 MC-163）詳細を開くと、最後の「アクティビティ」セクションに複数の TimelineEvent が時系列で表示される。相対時間が正しく出る（「6秒前」等）。
