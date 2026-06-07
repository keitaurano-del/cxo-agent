# MC-187 UI/UX 設計提案：司令塔ダッシュボード カード詳細表示機能

## 背景・目的

Apollo ダッシュボードの複数ビュー（Tasks, Agents, Activity）では、カード一覧で情報が凝縮されており、ユーザーが「この項目の詳しい状況は？」と知りたいときに詳細へドリルダウンしたくなるニーズがある。

**目的：**
- プロジェクトカード / タスクカード / エージェントカードをクリック/タップしたら、詳細情報パネルが表示される
- モバイル・デスクトップの両体験に対応し、一覧との行き来が簡単
- 表示情報を整理して、サマリと詳細の情報粒度を分け、読みやすくする

---

## 1. 詳細表示の対象（カード要素の確認）

### 既存カード実装の確認

コード走査より、以下の3つのビューにカード実装あり:

| ビュー | ファイル | カード型 | 現在のクリック挙動 |
|--------|---------|--------|-----------------|
| **Tasks（Kanban）** | `web/src/views/Tasks.tsx` L23-84 | TaskCard | ✓ 既に TaskDetail ドロワー実装済（L141 selected state） |
| **Agents** | `web/src/views/Agents.tsx` L103-110 | AgentCard | ✓ 既に AgentFeed ドロワー実装済（feed 表示） |
| **Activity** | `web/src/views/Activity.tsx` | TickCard など | 未確認（リード続行予定） |

### 設計対象スコープ

- **プロジェクトカード**: Activity ビューの「プロジェクト別スコープ」サマリ等（未確認）
- **タスクカード**: 既に TaskDetail 実装済 → **拡張対象**
- **エージェントカード**: 既に AgentFeed 実装済 → **拡張対象**
- **ティックカード**: Activity の各ティック → **新規検討対象**

---

## 2. 表示する詳細情報（情報設計）

### 2-1. タスクカード詳細（Tasks.tsx）

#### 現在の実装
- TaskDetail コンポーネント (web/src/components/TaskDetail.tsx) が存在し、ドロワーで開く
- 表示項目: ID / title / status / detail（受け入れ条件・本文）/ owner / source

#### 拡張提案
以下の情報を **折りたたみセクション** で表示:

```
【基本情報】
  - ID / タイトル / ステータス
  - プロジェクト / 担当 / 優先度
  - 出典（inbox/feedback等）

【詳細本文】 （既存）
  - 受け入れ条件 (DoD)
  - サブタスク（チェックリスト化）
  - 実装メモ

【関連】
  - 依存タスク（リンク）
  - このタスクに関連するエージェント活動
  - 過去のコミット・PR 参照（追加検討）

【進捗】
  - 着手者 / 作成者
  - 作成日 / 更新日
  - 推定/実績 期間
```

### 2-2. エージェントカード詳細（Agents.tsx）

#### 現在の実装
- AgentFeed コンポーネントで会話タイムラインを表示（既に手厚い）

#### 拡張提案
AgentFeed の周囲に **統計パネル** を追加:

```
【概要】
  - 名前 / 人格 / 役割 / 気質

【稼働統計（現在の状態）】
  - 稼働中 / 待機 / 完了 / 未稼働 の件数
  - 直近の活動時刻
  - 現在実行中の主要タスク（あれば）
  - 平均応答時間 / 一日の total token 消費

【プロジェクト別内訳】
  - logic: 活動中 / 待機 / 完了 の内訳
  - cxo-agent: （同）
  - en-chakai: （同）

【最新ログ】 （既存 AgentFeed）
  - タイムライン / 会話 / ツール呼び出し
```

### 2-3. プロジェクトサマリカード（Activity 検討）

Activity のプロジェクト別スコープがあれば:

```
【プロジェクト概要】
  - 名前 / ラベル / 色

【タスク分布】
  - TODO / IN_PROGRESS / BLOCKED / REVIEW / DONE / CANCELLED の件数
  - 進捗率（DONE / 全タスク）
  - スタッド中のタスク

【エージェント稼働】
  - 過去 1 日の在籍エージェント
  - 今月のティック実行数

【最近のアクティビティ】
  - 直近 5 件のコミット / push / デプロイ
  - 最終デプロイ時刻

【リンク】
  - 本リポジトリ GitHub
  - 本プロジェクトのタスク一覧（Tasks で filter）
```

---

## 3. UI パターン提案：「ドロワー」vs「サイドパネル」vs「モーダル」

### 比較表

| パターン | 利点 | 欠点 | 推奨 |
|---------|-----|------|------|
| **ドロワー（右スライイン）** | 一覧と詳細を並べ可、戻りが簡単 | デスクトップ画面が狭くなる | ✓ デスクトップ |
| **モーダル（全画面オーバーレイ）** | 詳細に集中、スマホに向く | 一覧を見ながら詳細は見られない | ✓ モバイル |
| **タブ切り替え** | 単純、リスト一覧の体験を維持 | 詳細が見にくい | △ 軽情報用 |
| **下部パネル（bottom sheet）** | スマホ直感的 | Webとの体験が異なる | ○ モバイル 2 案 |

### 推奨：レスポンシブドロワー + モーダルハイブリッド

**デスクトップ（md以上）:**
- ドロワーで右スライイン（Tasks.tsx の既存 TaskDetail の手法を踏襲）
- 幅 `md:w-96` 程度で固定
- 一覧と並べて見比べ可能

**モバイル（md未満）:**
- モーダル化するか bottom sheet に変更
- 全幅フルスクリーン or bottom 80% 高
- スワイプダウンで閉じる対応

**実装方式:**
- `useSearchParams` で `?task=<id>&source=<source>` deep link 対応（Tasks.tsx L143 既例）
- `selectedCard` state で開閉管理（既例: Tasks.tsx L141）

---

## 4. モバイル対応の詳細

### 4-1. モバイル時のレイアウト

```
┌─────────────────────┐
│ Tasks（コラムが消える）   │  ← md未満で hidden
├─────────────────────┤
│ [TODO(3)] [IN_PRO(5)]│  ← Tab strip（横スクロール）
├─────────────────────┤
│  TODO列 100% 幅     │  ← 選択タブのみ縦積み
│ ┌─────────────────┐ │
│ │ TaskCard #1     │ │
│ │ TaskCard #2     │ │
│ └─────────────────┘ │
└─────────────────────┘
      ↓ タップ
┌─────────────────────┐
│ ×  task MC-100      │  ← モーダルヘッダ（閉じるボタン）
├─────────────────────┤
│ 詳細本文            │
│ （縦スクロール）      │
│                     │
│                     │
│ ┌─────────────────┐ │
│ │[Back] [Copy ID] │ │  ← フッタアクション
│ └─────────────────┘ │
└─────────────────────┘
```

### 4-2. Bottom Sheet パターン（代案）

Tasks.tsx では Tab ベースの横スクロール Kanban をモバイル対応済み（L139 activeColumn state）。詳細も同じパターンで「下から出す」bottom sheet 化が自然かもしれない。

```
┌─────────────────────┐
│ TaskCard（タップ）     │
├─────────────────────┤
│                     │
│ 一覧がうっすら見える    │
│    ↓                │
│ ┌─────────────────┐ │
│ │ 詳細パネル      │ │  ← Drag down で close
│ │ （80% 高）      │ │
│ │ 縦スクロール可   │ │
│ └─────────────────┘ │
└─────────────────────┘
```

---

## 5. 依存タスク・既存の実装との整合性

### 5-1. Tasks.tsx との整合（既に詳細実装済）

- **現状:** TaskDetail ドロワーが既に実装。カード onClick → setSelected() で開く
- **拡張内容:** TaskDetail の内容を上記「2-1」の項目で充実させる（コンポーネント自体の拡張）
- **依存:** server `/api/tasks` のレスポンスに detail フィールドがあること（確認済: L126）

### 5-2. Agents.tsx との整合（既に AgentFeed 実装済）

- **現状:** AgentFeed（タイムライン）がドロワーで表示済
- **拡張内容:** AgentFeed を囲んでいる AgentCard 周囲に「統計パネル」を横配置（レスポンシブ）
- **依存:** server `/api/agents/:id/feed` / `/api/agents` の groupData に instanceCount 等の統計が乗ること（既実装、Agents.tsx L131 確認）

### 5-3. Activity.tsx との整合

- **現状:** TickCard や TickDetail の実装状況を確認中
- **拡張:** ティック詳細や、プロジェクト別スコープの詳細表示を追加（スコープ確定後）
- **参考:** Tasks.tsx の TaskDetail パターン踏襲

---

## 6. UI フロー図（テキスト形式）

### 6-1. タスク詳細フロー

```
Tasks ビュー (Kanban)
    ↓
TaskCard (MC-100 title)
    ↓ Click
    ├→ [デスクトップ] TaskDetail ドロワー（右スライイン）
    │   ├─ 基本情報折り畳み
    │   ├─ 詳細本文
    │   ├─ 関連タスクリンク
    │   └─ フッタ「戻る / IDコピー / GitHub リンク」
    │
    └→ [モバイル] TaskDetail モーダル（フルスクリーン）
        ├─ ヘッダ「× 閉じる」
        ├─ スクロール可能な詳細
        └─ フッタ「戻る / Copy」
```

### 6-2. エージェント詳細フロー

```
Agents ビュー
    ↓
AgentCard (dev-logic / persona: 蓮)
    ↓ Click（clickable = agentId あれば）
    ├→ [デスクトップ] AgentDetail パネル（右 or 下）
    │   ├─ 概要 + 統計パネル（横配置）
    │   ├─ プロジェクト別内訳（カラムグラフ等）
    │   └─ AgentFeed（タイムライン、既存）
    │
    └→ [モバイル] AgentDetail モーダル
        ├─ 概要
        ├─ 統計（垂直スタック）
        └─ AgentFeed（スクロール）
```

---

## 7. 設計上の注意点（ベストプラクティス）

### 7-1. パフォーマンス

- 詳細パネルの遅延ロード（ドロワー開く際に `/api/tasks/:id/detail` など個別 fetch）
- 大量ログ（AgentFeed など）は pagination / virtual scroll 検討
- モバイルでモーダルが重くなる場合は段階的ロード（概要先行、ログは下スクロール時ロード）

### 7-2. キーボード・アクセシビリティ

- `Esc` でモーダル/ドロワー閉じる（既実装パターン: Tasks.tsx L158）
- Tab キーナビゲーション（フォーカストラップ、モーダル内で loop）
- aria-label・aria-describedby を充実（既例：Tasks.tsx L36）

### 7-3. ダークモード対応

- CSS 変数 `--mc-*` を継続使用（Apollo 既定スタイル）
- Tailwind `dark:` modifier 不要（既存パターン踏襲）

### 7-4. 深いリンク（Deep Link）

- URL クエリで `?task=MC-100&source=logic` のように来たら自動で詳細を開く
- 現状 Tasks.tsx L149-150 で実装済 → **他ビュー（Agents など）でも同じパターン導入**

---

## 8. DoD（受け入れ条件）案

### デザイン面（Designer 担当）

- [ ] Figma に Tasks / Agents 別々のドロワー・モーダルデザイン（デスクトップ + モバイル）を作成
  - フレーム: `1440px`(デスクトップ) / `390px`(モバイル)
  - ドロワー幅: `384px`（md:w-96 相当）
  - 配色：Apollo の既存カラー（`--mc-*`）を使用
- [ ] 折りたたみセクション、統計グラフ（カラムグラフ or 円グラフ）のモックを複数案提案
- [ ] モバイル bottom sheet vs フルスクリーンモーダルの UX テスト（Keita 確認取得）
- [ ] アクセシビリティ: キーボードフォーカス、スクリーンリーダー確認

### 開発面（Dev-Logic 担当）

- [ ] TaskDetail コンポーネント拡張（既存ドロワーの内容充実）
  - 基本情報、詳細本文、関連リンク、フッタアクション
  - server `/api/tasks/:id/detail` エンドポイント実装（or 既存 `/api/tasks` 結果を流用）
- [ ] AgentCard クリック時の AgentDetail パネル実装（既 AgentFeed に統計パネル追加）
  - 稼働統計（インスタンスカウント、最終活動）
  - プロジェクト別内訳表示
- [ ] レスポンシブ対応（Tailwind md: breakpoint で ドロワー ↔ モーダル 切り替え）
- [ ] Deep link 対応（useSearchParams で `?task=id&source=source` を検出し自動開く）
- [ ] キーボード `Esc` で閉じる挙動
- [ ] パフォーマンス測定：詳細パネル開く際の fetch 時間

### QA / テスト面（Test-Functional 担当）

- [ ] デスクトップ (1440px): ドロワーが右 384px で固定、スクロール可
- [ ] モバイル (390px): モーダルフル幅、Drag down で close、フッタ sticky
- [ ] 100+ タスク/エージェントでの scroll & pagination 動作確認
- [ ] Deep link: `?task=MC-100&source=logic` から詳細が自動開く
- [ ] Esc キー / × ボタン / 外側クリックで close（パターン別）
- [ ] 異なるプロジェクトのカードを開く / 切り替える時のアニメーション確認

---

## 9. 開発分担（Designer / Dev-Logic）

### Designer（MC-187-UI）

1. Figma でコンポーネント設計（2 案: side drawer + bottom modal）
   - Color / Typography / Spacing / Border radius を Apollo 既存に準拠
   - モバイル・デスクトップ別デザイン
   - アクティブ・ホバー・disabled 状態を明示
   
2. 統計グラフ・折りたたみUI のアイコン・ラベル定義
   
3. Keita にデザイン確認取得 → Designer が「これで実装して」と明示

### Dev-Logic（MC-187-IMPL）

1. Designer の Figma から CSS 吸い出し → Tailwind class で再現
2. React コンポーネント実装（TaskDetail / AgentDetail 拡張）
3. Server 側の詳細データ取得 API 整備（足りなければ）
4. Deep link、keyboard nav、responsive 実装
5. Test-Functional に渡す（green までを自分で確認）

---

## 10. 参考：既存実装パターン

### Tasks.tsx から学ぶ（既に TaskDetail ドロワー実装済）

```tsx
// L141: selected state でドロワー制御
const [selected, setSelected] = useState<Task | null>(null);

// L149-150: Deep link 対応
const deepLinkId = searchParams.get('task');

// L23-84: TaskCard の button onClick
<button onClick={() => onOpen(t)}>  // L31

// L24: TaskDetail コンポーネント（ドロワー）
{selected && <TaskDetail task={selected} onClose={() => setSelected(null)} />}
```

このパターンを **AgentCard・Activity のカード群にも適用** → UI 統一

### Agents.tsx から学ぶ（既に AgentFeed ドロワー実装済）

```tsx
// L113-127: AgentCard のクリックハンドラ
<button
  onClick={onOpen}
  disabled={!clickable}
  className={`... ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
>

// L16: AgentFeed コンポーネント（既実装）
<AgentFeed agentId={selected?.agentId} />
```

AgentCard クリック時に統計パネル + AgentFeed を並べる展開

---

## 11. Next Steps（実行手順）

1. **Keita 確認** （本設計提案）
   - UI パターン（ドロワーか bottom sheet か）を確認
   - 表示情報の粒度（統計グラフを出すか等）を確認

2. **Designer（紺野）** に Figma 設計を投げる
   - 2 案（side + modal）でモックアップ作成
   - Keita が選択 → selected design で実装進行

3. **Dev-Logic** が実装開始
   - TaskDetail / AgentDetail 拡張
   - Responsive 実装
   - Deep link / Keyboard nav

4. **Test-Functional** が検証
   - 各ブラウザ・デバイスでの動作確認
   - パフォーマンス測定

5. **Keita 実機確認 → Merge → Deploy**

---

## 付録：情報アーキテクチャ図

```
Apollo Dashboard
├─ Tasks ビュー（Kanban）
│  ├─ TaskCard（既存）
│  │  └─ TaskDetail ドロワー ← [拡張対象]
│  │      ├─ 基本情報
│  │      ├─ 詳細本文（既存）
│  │      ├─ 関連リンク ← [新規]
│  │      └─ フッタアクション ← [新規]
│  └─ Filter: プロジェクト / ステータス
│
├─ Agents ビュー
│  ├─ AgentCard（既存）
│  │  └─ AgentDetail パネル ← [拡張対象]
│  │      ├─ 概要セクション
│  │      ├─ 稼働統計 ← [新規]
│  │      ├─ プロジェクト内訳 ← [新規]
│  │      └─ AgentFeed（既存）
│  └─ Filter: ステータス
│
└─ Activity ビュー
   ├─ TickCard
   │  └─ TickDetail ← [新規検討]
   └─ ProjectScope サマリ
      └─ ProjectDetail ← [新規検討]
```

---

## 結論

MC-187 は「カード → 詳細」の UX を整備し、Apollo ダッシュボードの情報ドリルダウンを標準化するタスク。既存の Tasks / Agents パターンを踏襲・拡張し、モバイル・デスクトップの両体験を高める。

Designer と Dev-Logic の役割を明確に分け、段階的に品質ゲート（Figma → Code → Test → Deploy）を通す設計を提案する。
