# cxo-agent

CXO 向けエージェントリポジトリ。現在の主プロダクトは **Apollo**。

---

## Apollo — 開発状況リアルタイム可視化ダッシュボード

Keita が logic / en-chakai / 西丸町(nishimaru) / ai-pmo / cxo / プライベートを
14 体の subagent + 林でオーケストレーションしながら並行で回している状況を、
1 画面に統合して可視化する常駐ダッシュボード。

「今どのエージェントが何をしていて、誰が止まっているか」「どのタスクが進み・何が滞っているか」
「エージェント同士の会話」を散らばった情報源から集約する。

### データ源泉（ハイブリッド）

| 種別 | ソース | collector |
|------|--------|-----------|
| エージェント稼働・会話 | `~/.claude/projects` 配下の subagent / 親セッション jsonl | `collectors/agents.ts` |
| タスク | `logic/docs/TASK_TRACKER.md`, `obsidian-vault/10-Tasks/kanban.md` ほか markdown 台帳 | `collectors/tasks.ts` |
| ナラティブ | `obsidian-vault/50-Daily/{briefings,inspections,feedback}` 最新 | `collectors/narrative.ts` |
| エージェント台帳 | `obsidian-vault/60-Agents/*.md` | `collectors/roster.ts` |

### スタック

- **server** (`server/`): Node 22 + Express 5 + TypeScript。Vultr の FS を直読み。REST + SSE。
  ai-pmo の api/ と同型。
- **web** (`web/`): React 18 + Vite 5 + Tailwind 3（**Phase 2 で実装。今は雛形のみ**）。

---

## ディレクトリ

```
cxo-agent/
  server/                       # backend (実装済 — Phase 0 + 1)
    src/
      index.ts                  # Express 起動・REST・SSE 枠・web/dist 静的配信
      config.ts                 # データパス・しきい値（環境変数で上書き可）
      collectors/
        agents.ts               # subagent jsonl → 稼働一覧・会話フィード
        tasks.ts                # markdown 台帳 → 正規化タスク
        narrative.ts            # 日次サマリ最新
        roster.ts               # エージェント台帳 + 稼働マージ
      lib/
        jsonl.ts                # jsonl 読み・最終 timestamp 抽出
        agentMap.ts             # agentId → subagent_type 解決
        projectMap.ts           # cwd / パス → プロジェクト名
        stall.ts                # 稼働状態・滞留判定（8 分しきい値）
  web/                          # frontend 雛形（Phase 2 で実装）
  docs/                         # task-manager 管理
  README.md
```

---

## server: 起動と検証

```bash
cd server
npm install
npm run dev          # tsx watch（開発）  /  npm run start（単発）
# → http://localhost:4317
```

### 動作確認

```bash
curl localhost:4317/api/health      # {ok:true,...}
curl localhost:4317/api/agents      # subagent jsonl の稼働一覧
curl localhost:4317/api/tasks       # 正規化タスク配列
curl localhost:4317/api/narrative   # 本日 briefing / inspection / feedback
curl localhost:4317/api/roster      # エージェント台帳 + 稼働マージ
curl localhost:4317/api/overview    # KPI 集計 + プロジェクト別サマリ
curl -N localhost:4317/api/stream   # SSE（初期 ping + keep-alive。watch 接続は Phase 3）
```

### 型チェック

```bash
cd server && npm run typecheck   # tsc --noEmit
```

---

## REST API

| メソッド | パス | 内容 |
|----------|------|------|
| GET | `/api/health` | ヘルスチェック + 解決済みパス |
| GET | `/api/agents` | 各 subagent jsonl の稼働一覧 `[{agentId, subagentType, project, status, lastActivity, lastAction, sessionId, isWorkflow, ...}]` |
| GET | `/api/agents/:agentId/feed` | そのエージェントの会話タイムライン（user / assistant / tool を時系列） |
| GET | `/api/tasks` | 全ソース統合・正規化タスク `[{id, title, status, owner, priority, project, source, updated, stalled}]` |
| GET | `/api/narrative` | `{briefing, inspection, feedback}` 各最新 |
| GET | `/api/roster` | エージェント台帳 + 稼働マージ |
| GET | `/api/overview` | KPI（active / idle 数、進行中 / 滞留タスク数）+ プロジェクト別サマリ |
| GET | `/api/stream` | SSE。**現状は初期 ping + keep-alive のみ**（chokidar watch は Phase 3） |

---

## 設定（環境変数）

`server/src/config.ts` ですべて `DATA_HOME`（default `/home/dev`）から導出。環境変数で差し替え可能。

| 変数 | default | 用途 |
|------|---------|------|
| `DATA_HOME` | `/home/dev` | ユーザーホーム（`.claude` / `projects` の親） |
| `CLAUDE_PROJECTS_DIR` | `$DATA_HOME/.claude/projects` | セッションログのルート |
| `PROJECTS_DIR` | `$DATA_HOME/projects` | プロジェクト群ルート |
| `VAULT_DIR` | `$PROJECTS_DIR/obsidian-vault` | Obsidian vault |
| `PORT` | `4317` | HTTP ポート |
| `STALL_MINUTES` | `8` | 稼働判定しきい値（分）。**短く切らない**（進行中の誤検知防止） |
| `TASK_STALL_DAYS` | `3` | IN_PROGRESS タスクの滞留判定（日） |

---

## 稼働状態の判定

最終活動時刻は subagent jsonl 最終行の `timestamp`、無ければファイル mtime をフォールバック。

- **active**: 最終活動 < `STALL_MINUTES`（default 8 分）
- **idle**: それ以上経過
- **done**: `result` 行ありなどセッション終了
- **never**: 一度も活動なし

8 分しきい値は「subagent は遅いだけで死んでない」方針に準拠。短く切ると進行中を誤検知する。

---

## agentId → subagent_type 解決（最難所）

1. 親セッション jsonl の assistant 行から `Agent`（旧称 `Task`）tool_use を走査し、
   `{subagent_type, description, prompt}` を集める。
2. 各 subagent ファイルの先頭 user メッセージ = その Agent の prompt と一致するので照合してラベル付与。
3. ワークフロー孫（`subagents/workflows/wf_*/`）はプロンプトが Workflow script 内定義のため
   照合できないことが多く、その場合は cwd ベースの暫定ラベルにフォールバック（可視化は継続）。

解析はすべて Node の fs 読み込みで行う（シェル grep に依存しない）。

---

## 今後のフェーズ（未実装）

- **Phase 2**: frontend 4 ビュー（Overview / Agents / Tasks / Narrative）を静的データで描画
- **Phase 3**: SSE + chokidar watch + Feed（会話）ライブ化
- **Phase 4**: Vultr systemd 常駐 + 認証（+ スマホ向けトンネルは follow-up）
