# Notebook RAG 設計書

## 問題と動機

現在のノートブック機能は `claude -p` を cwd=ノートブックdir で起動し、
「./sources/ と ./extracted/ を全部 Read しろ」と指示している。

実例（ノートブック ID: 0faca0284f）:
- sources/: 222 ファイル
- extracted/ テキスト合計: 4.3 MB
- → claude が全ファイルを読むのに数分かかりタイムアウト（120s→600sに延長したが根本解決でない）
- → コストが高い（全文をコンテキストに載せる）
- → 引用の精度が低い（関係ない資料のノイズが混ざる）

## アーキテクチャ

### Embedding

- モデル: Gemini `text-embedding-004`
- API キー: `.mc.env` の `GEMINI_API_KEY`（logic/.env の GEMINI_API_KEY と同値）
- エンドポイント: `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`
- 出力次元: 768次元のfloat配列
- Claude 枠を使わない（Anthropic 枠の節約）

### ベクトルストア

軽量なローカル JSON 索引を採用（sqlite-vec は追加パッケージ不要・数千チャンクなら十分速い）。

保存先: `data/notebooks/<id>/index/`
```
index/
  chunks.json    チャンク配列（テキスト・メタ・ベクトル）
  meta.json      索引メタ（作成日時・チャンク数・バージョン）
```

#### chunks.json 構造

```json
[
  {
    "id": 0,
    "sourceFile": "1.1.e_要求一覧_v4.0.xlsx",
    "chunkIndex": 3,
    "text": "...(最大800字)...",
    "vector": [0.123, -0.456, ...]
  },
  ...
]
```

### チャンク分割

- ターゲット: extracted/*.txt および sources の .txt/.md/.csv/.tsv（直接読める形式）
- チャンクサイズ: 800字（日本語を想定、単語数でなく文字数）
- オーバーラップ: 100字
- 段落境界尊重: 改行2つ以上で自然な区切りを優先

画像・PDF（大きいもの）: extracted/*.txt があればそれを使う。
sources にある .pdf は pdftotext 済みのものを利用可能だが、初期実装では extracted の txt を優先し、
extracted がない sources ファイルは読み込み対象外とする（claude が直接読めるファイルは
プロンプトに名前だけ渡すフォールバックとして将来拡張可能）。

### 検索

1. 質問テキストを Gemini でベクトル化
2. chunks.json の全チャンクとのコサイン類似度を計算（JS、O(n) だが数千チャンクなら <50ms）
3. 上位 K=8 件のチャンクを取得
4. チャンクテキストをプロンプトに埋め込んで claude -p に渡す

コサイン類似度計算（疑似コード）:
```
similarity = dot(a, b) / (norm(a) * norm(b))
```

### 引用形式

claude に渡すプロンプトで各チャンクに出典タグを付与:
```
[出典 #1: ファイル名=1.1.e_要求一覧_v4.0.xlsx, チャンク=3]
...チャンクテキスト...
```

claude に回答時のフォーマット指示:
```
引用タグは {{cite:ファイル名:チャンクインデックス}} の形式で埋め込んでください。
```

フロント側の既存引用ジャンプ機能（{{cite:...}}）とそのまま接続する。

## 実装フェーズ

### Phase 1: インデックス構築（embedding.ts + notebookIndex.ts）

**embedding.ts**: Gemini API 呼び出しラッパー
- `embedText(text: string): Promise<number[]>` — 単一テキスト
- `embedTexts(texts: string[], batchSize = 20): Promise<number[][]>` — バッチ（rate limit 対策で sleep 付き）

**notebookIndex.ts**: 索引構築・管理・検索
- `buildIndex(notebookDir: string): Promise<IndexBuildResult>` — extracted を走査してチャンク分割→embed→保存
- `indexExists(notebookDir: string): boolean` — 索引が存在するか
- `searchChunks(notebookDir: string, query: string, topK?: number): Promise<Chunk[]>` — 検索
- `deleteIndex(notebookDir: string): void` — ソース削除時のクリーンアップ

**POST /:id/reindex エンドポイント**: 既存ノートブックの再インデックス

### Phase 2: 検索統合（notebookRouter.ts + notebookClaude.ts）

**handleAsk の変更**:
- 旧: `buildAskPrompt(question, history)` → `runClaude(dir, prompt)` (全ファイルRead)
- 新: `searchChunks(dir, question)` → `buildRagAskPrompt(question, chunks, history)` → `runClaude(dir, ragPrompt)`
- ragPrompt には「以下の抜粋のみを根拠に答えよ」と top-8 チャンクを埋め込む
- `cwd` は引き続き notebookDir（artifacts/ 書き出し等のため）だが、Read の全走査指示は削除

**handleGenerate の変更**:
- 生成物作成時も関連チャンクのみ使う
- KIND_INSTRUCTIONS の「全 Read」指示を「以下の抜粋を参考に」に差し替え

### Phase 3: 引用接続

- RAG で使ったチャンク（top-8）のメタ情報を `searchChunks` 結果から返す
- プロンプトの `[出典 #N: ファイル名=X, チャンク=Y]` と回答の `{{cite:X:Y}}` が対応
- フロント側は既存の引用ジャンプ実装をそのまま流用

## 後方互換

- `indexExists(dir)` が false の場合（reindex 前）はフォールバックとして従来動作（全Read指示）を維持
- ソースアップロード時（POST /:id/sources）に自動で reindex（新規ファイルは即 RAG 対象に）
- ソース削除時は索引も再構築

## 旧箱 SSH ラッパーの簡素化

RAG 化によりプロンプトに抜粋（800字×8 = 約6400字）を埋め込む形になるので、
旧箱に大量ファイルを rsync する必要がなくなる。

notebook-claude-ob.sh の変更:
- rsync（extracted/sources の同期）を削除
- プロンプトをそのまま旧箱の claude に渡すだけ

ただし artifacts/ の書き出し（handleGenerate）は引き続き旧箱ではなく新箱で実行する
（artifacts は新箱の notebookDir に書き出す必要がある）。ask は旧箱可、generate は新箱。

## パフォーマンス目標

| 指標 | 旧 | 新（RAG） |
|------|-----|---------|
| ask 応答時間 | 数分（タイムアウトも） | 20〜40s（embed 1s + 検索 <0.1s + claude 20s） |
| コンテキスト量 | 全文（〜4MB） | top-8 チャンク（〜6400字） |
| 引用精度 | 低（ノイズ混在） | 高（関連チャンクのみ） |
| インデックス構築 | なし | 初回のみ数分（222ファイル×平均Nチャンク） |

## ファイル構成

```
server/src/lib/
  embedding.ts          Gemini embedding API ラッパー（新規）
  notebookIndex.ts      チャンク分割・索引管理・検索（新規）
  notebookClaude.ts     既存（RAG プロンプト生成関数を追加）
  notebookExtract.ts    既存（変更なし）
  notebookStore.ts      既存（変更なし）
server/src/
  notebookRouter.ts     既存（handleAsk/handleGenerate/handleAddSources を RAG 化 + reindex エンドポイント追加）
  config.ts             GEMINI_API_KEY 追加

data/notebooks/<id>/
  index/
    chunks.json
    meta.json
```

## 設計メモ

### なぜ sqlite-vec でなく JSON か

- 追加パッケージ不要（`better-sqlite3` や native addon ビルドが不要）
- 222ファイル × 平均20チャンク = 約4400チャンク。4400×768次元×4byte ≈ 13MB
- コサイン類似度計算は Float32Array を使えば 13MB でも <50ms（JS は十分速い）
- 将来 sqlite-vec への移行は notebookIndex.ts 内部だけの変更で対応可能

### Gemini embedding のバッチ処理

text-embedding-004 は 1 リクエスト 1 テキスト（BatchEmbedContents も使えるが複雑）。
チャンク数が多い場合は 20 件ずつ並列発行 + 1s sleep で rate limit 対策。

### エラー処理

- Gemini API キーが未設定 or 失敗 → 従来動作にフォールバック（RAG 索引なし）
- 索引構築失敗 → sources はアップロード完了、索引なしで続行
- 検索結果 0 件 → プロンプトに「関連資料が見つかりませんでした。質問を変えてください」
