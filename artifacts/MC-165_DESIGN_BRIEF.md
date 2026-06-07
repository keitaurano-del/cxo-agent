# Design Brief: MC-165 — 6人格ドット絵アバター作成

**Task ID:** MC-165  
**Assignee:** designer（アオイ）  
**Date:** 2026-06-07  
**Status:** IN_PROGRESS  

---

## 概要

Apollo dashboard で 6 つのエージェント人格を視覚的に擬人化するドット絵（pixel art）キャラクターを制作する。各人格のモチーフと職能を反映した立ち絵＋2 つのバリエーション（working/idle）を生成し、SSE リアルタイム UI で動的に表示する。

---

## 対象キャラクター 6 体 × 2 バリエーション = 12 アセット

### 1. レン（蓮）— 実装/工具
**職能:** dev-logic（開発・実装担当）  
**モチーフ:** ハンマー・ドライバー・スパナ  
**人格イメージ:** 真摯・職人気質・細部へのこだわり  
**スキル:** コード実装・デバッグ・最適化・品質  

#### visual concept（レン）
- **立ち姿の基本シルエット:** 中背・がっしり・安定感
- **顔:** シンプルな目（◯◯）+ 直線眉。真剣な表情が基本
- **体色:** 紺色 or 深緑（dev-logic イメージカラー）
- **特徴装備:** 肩や腕にハンマーモチーフのアクセサリー、腰ベルトにツール

**working（稼働中）:**
- 片手でハンマーを上げる or スパナを握る動き
- 眉が V 字（真剣な顔）
- 身体が少し前に傾斜
- 全体で「集中・製造中」を表現

**idle（待機中）:**
- ハンマーを置いて、軽く肩を下ろす
- 目が半目 or ぼんやりした表情
- 立ち姿は自然体で、足の重心が片足に
- 全体で「一休み・退屈気味」を表現

---

### 2. ソラ（衛星）— 衛星/宇宙
**職能:** dev-apollo（Apollo dashboard UI・実装・リアルタイム処理）  
**モチーフ:** 衛星・ロケット・星・スターバースト  
**人格イメージ:** 俊敏・大局的・将来志向  
**スキル:** UI/UX・リアルタイム通信・スケーリング  

#### visual concept（ソラ）
- **立ち姿の基本シルエット:** やや高身長・細身・軽やか
- **顔:** ぱっちりした目（◆◆）+ 上向き眉。前向きな表情が基本
- **体色:** 青紫 or 群青色（宇宙・sky イメージ）
- **特徴装備:** 頭に小さな衛星アンテナ or リング、背中に星型モチーフ、腕に光の粒子エフェクト

**working（稼働中）:**
- 両腕を広げる or 上に上げる（ロケット発射ポーズ）
- 目が輝く（✨ のような表現）
- 身体が垂直 or やや後ろに反らす
- 全体で「発進・高速処理・昇進」を表現

**idle（待機中）:**
- 腕を下ろして、ゆるく脱力
- 目が優しく閉じ気味
- 立ち姿は不安定（片足が浮く）で宇宙浮遊感
- 全体で「衛星軌道・ぼんやり・夢見がち」を表現

---

### 3. ケン（検証）— 検証/ラボ
**職能:** test-functional（テスト・検証・品質保証）  
**モチーフ:** 試験管・ビーカー・顕微鏡・実験器具  
**人格イメージ:** 論理的・慎重・品質第一  
**スキル:** QA・検証・実験精神・細かさ  

#### visual concept（ケン）
- **立ち姿の基本シルエット:** 中背・知的な雰囲気・やや体を前に傾ける
- **顔:** 知的な目（眼鏡をかけている or 細目）+ 真摯な眉
- **体色:** 薄緑 or 翡翠色（実験・科学イメージ）
- **特徴装備:** 眼鏡または実験用ゴーグル、片手に試験管 or ビーカー持ち

**working（稼働中）:**
- 試験管を高く上げる or 眼鏡を調整しながら前に身を乗り出す
- 眉が Λ 字（集中・驚き）
- 身体が前傾で、実験テーブルを覗き込む感
- 全体で「検査中・発見・デバッグ」を表現

**idle（待機中）:**
- 試験管を下に下ろす or 手に持たない
- 目が優しく、時々下を向く
- 立ち姿は直立で、足がしっかり地に着いている
- 全体で「思考中・考察・結論待ち」を表現

---

### 4. ユイ（台帳）— 台帳/クリップボード
**職能:** task-manager（タスク管理・進捗追跡・優先順位付け）  
**モチーフ:** クリップボード・チェックリスト・ノート・ペンチェック  
**人格イメージ:** 組織的・信頼できる・几帳面  
**スキル:** タスク管理・優先順位付け・ドキュメンテーション  

#### visual concept（ユイ）
- **立ち姿の基本シルエット:** やや低身長・丸み・安定感
- **顔:** やさしい目（○○）+ 柔和な眉。親しみやすい表情が基本
- **体色:** 朱色 or オレンジ（チェック・承認イメージ）
- **特徴装備:** 片手にクリップボード or ノート、もう一方の手にペン、ポケット内にチェックマーク

**working（稼働中）:**
- クリップボードを胸に抱えて、ペンでチェックをしている動き
- 眉が上向き（確認・承認の喜び）
- 身体が少し右か左に傾く（忙しそう）
- 全体で「確認・チェック・進捗記録」を表現

**idle（待機中）:**
- クリップボードを下に置く or ペンを握ったまま待機
- 目が優しく、時々上を見る（全体を見守っている）
- 立ち姿は自然体で、肩の力が抜けている
- 全体で「整理完了・待機・ほっこり」を表現

---

### 5. アオイ（デザイン）— デザイン/パレット
**職能:** designer（ビジュアルデザイン・UI・ブランディング）  
**モチーフ:** パレット・ペン・色見本・ブラシ  
**人格イメージ:** 創意的・こだわり・感覚的・引き算思考  
**スキル:** ビジュアル設計・配置・色彩・視線誘導  

#### visual concept（アオイ）
- **立ち姿の基本シルエット:** やや背高・細身・優雅
- **顔:** 創意的な目（◆◇ で非対称 or 風変わり）+ 自由な眉
- **体色:** 紫 or インディゴ（デザイン・創意イメージ）
- **特徴装備:** 片手にカラーパレット、もう一方の手にペンまたはブラシ、衣服に色が付いているディテール

**working（稼働中）:**
- パレットを掲げ、ペンを空中に持ち上げている（描いている / 色を選んでいる）
- 眉が上向き（創意・ひらめき）
- 身体が動的で、回転 or 斜めポーズ
- 全体で「デザイン制作・創意・選択」を表現

**idle（待機中）:**
- パレットを下に下ろし、ペンを握ったまま考える
- 目が遠くを見ている or 半目で考え込んでいる
- 立ち姿は片足に重心を置いて、少し傾く
- 全体で「思考・消費・引き算」を表現

---

### 6. ナオ（執筆）— 執筆/ペン
**職能:** content-creator（コンテンツ制作・文章・SNS発信）  
**モチーフ:** ペン・本・スクロール・羽根ペン  
**人格イメージ:** 表現力・情熱・コミュニケーション  
**スキル:** 文章制作・コンテンツ企画・ストーリー・発信  

#### visual concept（ナオ）
- **立ち姿の基本シルエット:** 中背・柔らかい・表現的
- **顔:** 表情豊かな目（◎◎）+ 感情的な眉。親近感のある表情が基本
- **体色:** 赤 or 深紅（ペン・情熱イメージ）
- **特徴装備:** 片手に羽根ペンまたは万年筆、もう一方の手に本またはスクロール、髪や帽子にインク跡のディテール

**working（稼働中）:**
- ペンを高く掲げて、書いている or ジェスチャーしている動き
- 眉が上向き（熱意・表現）
- 身体が前に傾いて、動的でダイナミック
- 全体で「執筆中・発信・ストーリーテリング」を表現

**idle（待機中）:**
- ペンを握ったまま、腕を下ろして休息
- 目が遠くを見ている or 考え込んでいる表情
- 立ち姿は自然体で、時々本をめくるポーズ
- 全体で「創作思考・執筆完了・感想」を表現

---

## スタイルガイド

### ピクセルアート（pixel art）の統一基準

**サイズ:** 64×64 px（ディスプレイ表示時: 48×48 px、スムーススケーリングで 2 倍アップサンプル）

**グリッド:** 1 px 単位で整数倍のグリッドスナップ。アンチエイリアスなし（クリーンなドット感）

**色数:** 最大 16 色（パレット制限で統一感・親近感）

**輪郭:** 1-2 px の暗い色（黒 or 濃紫）で縁取り。エッジは保持力重視

**アクセサリー（ハンマー・パレット等）:**
- 単純化した シルエット形状
- 最小 4-6 px 幅で視認可能
- 本体色との対比色で、見落とさない工夫

**フェイス（目・眉・口）:**
- 目: 2-4 px の白ドット＋黒瞳で表情を最大化
- 眉: 1-2 px 太さで感情を表現（上向き=ポジティブ、V字=真剣、優しい弧=リラックス）
- 口: ミニマル（なしでも OK、あれば 1-2 px 幅の line か小さなカーブ）

**モーション表現:**
- working/idle 2 状態は「ポーズ＋顔」の組み合わせで表現
- アニメは不要（静止画 2 枚）
- ただし表示時に CSS animation で微かに揺らぐ or パルス効果は UI 側で追加可

### カラーパレット案

**背景:** 透明 PNG（α チャンネル）or 白/淡色背景 SVG

**キャラクター固有色:**

| キャラ | 体色 | 補色 | 眼鏡/アクセ | 装備品色 |
|------|------|------|-----------|--------|
| レン | 紺色 `#2C3E7F` | 朱色 `#E74C3C` | 銀 `#D0D0D0` | ハンマー橙 `#FF8C00` |
| ソラ | 群青 `#4169E1` | 黄 `#FFD700` | 水色 `#87CEEB` | 星シルバー `#C0C0C0` |
| ケン | 翡翠 `#50C878` | 紫 `#8B4789` | 濃緑 `#2F4F2F` | 試験管青緑 `#17A697` |
| ユイ | 朱色 `#E85D35` | 深青 `#1C3A70` | 金 `#FFB347` | ペン黒 `#1A1A1A` |
| アオイ | 紫 `#6A2D82` | 黄緑 `#9ACD32` | 白 `#FFFFFF` | パレット虹（RGB） |
| ナオ | 深紅 `#8B0000` | 黄緑 `#7FBF7F` | 琥珀 `#FFBF00` | ペン金 `#FFD700` |

**共通色:**
- 黒（輪郭）: `#1A1A1A`
- 白（ハイライト・眼球）: `#FFFFFF`
- グレー（影）: `#808080` / `#A9A9A9`

---

## ファイル出力形式・命名規則

### ファイル名パターン
```
avatar-<character>-<state>.svg
avatar-<character>-<state>.png
```

### 例
```
avatar-ren-working.svg
avatar-ren-idle.svg
avatar-sora-working.svg
avatar-sora-idle.svg
avatar-ken-working.svg
avatar-ken-idle.svg
avatar-yui-working.svg
avatar-yui-idle.svg
avatar-aoi-working.svg
avatar-aoi-idle.svg
avatar-nao-working.svg
avatar-nao-idle.svg
```

### 出力フォーマット
- **SVG:** ベクター形式推奨（Figma で native export 可能）。ピクセルアート的な外観保持のため、整数倍アップサンプルした 64×64 px をベースに SVG 化
- **PNG:** ラスタ形式（代替案）。64×64 px、透明背景（PNG-24 with alpha）、圧縮率 9

### ディレクトリ構成
```
cxo-agent/
├── artifacts/
│   ├── avatars/
│   │   ├── avatar-ren-working.svg
│   │   ├── avatar-ren-idle.svg
│   │   ├── avatar-sora-working.svg
│   │   ├── avatar-sora-idle.svg
│   │   ├── ... (全 12 ファイル)
│   │   └── README.md （アセット説明・使用方法）
│   └── MC-165_DESIGN_BRIEF.md （本ドキュメント）
```

---

## Figma での制作計画

### Phase 1: サンプル制作 & 承認（レン 2 枚）

**実行内容:**
1. **Figma ファイル新規作成** or 既存ファイルに新 page 追加
   - ファイル名: `Apollo Dashboard — Avatars` (Keita の keita.urano@gmail.com アカウント)
   - Page 名: `Sample — Ren (Lens)`
   
2. **レン（蓮）の working/idle 両バリエーション制作**
   - 64×64 px Artboard × 2 フレーム
   - 前述の visual concept 準拠
   - グリッド表示・スナップ有効で pixel-perfect を保証
   
3. **スクリーンショット撮影 & Keita 承認**
   - Figma screenshot を Apollo チャット `general` に投稿
   - 承認コメント: スタイル・モチーフ・顔の表情・色合い・動きの表現
   - 修正指示 or 「OK、展開して」判定

### Phase 2: 残り 5 体展開（ソラ～ナオ）

**実行内容:**
1. **5 体 × 2 バリエーション = 10 枚 制作**
   - Figma 内 Page を キャラ別に分離（`Sora`, `Ken`, `Yui`, `Aoi`, `Nao`）
   - 同じ visual concept・color palette を厳守
   
2. **配置チェック**
   - 64×64 px グリッド内に完全にフィット
   - 48×48 px で表示したときの視認性（縮小テスト）
   - SVG/PNG export 前の最終確認

### Phase 3: 書き出し & 配置

**実行内容:**
1. **Figma から SVG/PNG export**
   - 方法 A: Figma → SVG download → リポ配置
   - 方法 B: Figma → PNG export → ImageMagick で SVG化 (sharp なし、手動 optimization)
   
2. **ファイルをリポに配置**
   - `/cxo-agent/artifacts/avatars/avatar-*.svg`
   - README.md 追加（用途・使用方法・ライセンス）
   
3. **dev-apollo へ引き継ぎ**
   - avatars フォルダへのアセットパス確認
   - import 形式の取り決め（CommonJS / ES6 import どちらか）
   - React component として wrap するか素の SVG か

---

## 開発側（dev-apollo）との取り決め

### アセット管理

| 項目 | 詳細 |
|------|------|
| **保存先** | `/cxo-agent/artifacts/avatars/` |
| **ファイル形式** | `.svg` 推奨（`.png` 代替可） |
| **ファイルサイズ** | SVG: 2-5 KB/枚、PNG: 1-2 KB/枚 |
| **透明度** | 背景透明（PNG alpha / SVG transparent） |
| **スケーリング** | ブラウザ側で CSS `width/height: 48px` で表示 |
| **アニメ** | 静止画のみ。パルス/揺らぎは UI 側で CSS animation |

### Import 形式

**案 A: React component 化**
```tsx
// avatars/index.ts
export { AvatarRen } from './avatar-ren';
export { AvatarSora } from './avatar-sora';
// ...

// avatar-ren.tsx
import avatarRenWorking from './avatar-ren-working.svg?react';
import avatarRenIdle from './avatar-ren-idle.svg?react';

export const AvatarRen = ({ state = 'idle' }) => {
  return state === 'working' ? <avatarRenWorking /> : <avatarRenIdle />;
};
```

**案 B: 素の SVG import**
```tsx
import avatarRenWorking from './avatar-ren-working.svg';
import avatarRenIdle from './avatar-ren-idle.svg';

// HTML: <img src={avatarRenWorking} alt="Ren working" />
```

**推奨:** 案 A（React component）を dev-apollo が確定したら合わせる。

### API/データフロー

SSE リアルタイム UI で「現在稼働中のエージェント」を表示する場合：

```typescript
// Example: Apollo が送信するエージェント状態
{
  "type": "agent-active",
  "agent": "dev-apollo",
  "character": "sora",        // キャラクターキー
  "state": "working" | "idle" // ポーズ状態
}
```

UI 側は `character` + `state` から該当 SVG/component をマップして表示。

---

## 工数・スケジュール見積もり

### デザイン作業（アオイ）

| Phase | 作業内容 | 工数 | 想定期間 |
|-------|--------|------|--------|
| **1. サンプル（レン）** | visual concept + Figma 制作（レン working/idle） | 3-4h | 1 日（2026-06-08） |
| **確認・修正** | Keita 承認 + 修正（最大 2 往復） | 1-2h | 4h（同日〜翌日） |
| **2. 5 体展開** | ソラ～ナオ × 2 バリエーション（10 枚） | 8-10h | 2-2.5 日（2026-06-09〜10） |
| **3. 最終チェック** | 配置・視認性・export 前のレビュー | 1-2h | 0.5 日 |
| **4. Export & 配置** | Figma → SVG/PNG → リポ配置 + README | 1-2h | 0.5 日 |
| **合計** | | **14-18h** | **4-5 営業日** |

### 開発作業（dev-apollo）

| Phase | 作業内容 | 依存 | 想定期間 |
|-------|--------|------|--------|
| **1. アセット統合** | avatars フォルダ構成・import 確認 | Aoi Phase 4 | 0.5-1h（並行） |
| **2. React component 化** | Avatar component 実装 | Aoi Phase 2 完了 | 2-3h |
| **3. SSE リアルタイム表示** | agent state → character/state mapping + UI | 上記完了 | 3-4h |
| **4. テスト・動作確認** | ブラウザで複数キャラ表示・パフォーマンス | 上記完了 | 1-2h |
| **合計** | | | **6-10h** |

### 並行スケジュール（timeline）

```
Day 1 (2026-06-08)
  ├─ [Aoi] レン visual concept 詳細化 + Figma 制作開始
  └─ [Sora] アセット path/import 仕様確定

Day 2 (2026-06-09 午前)
  ├─ [Aoi] レン working/idle 完成 → Keita 承認
  └─ [Sora] React component 実装開始

Day 2-3 (2026-06-09〜10)
  ├─ [Aoi] 5 体 × 2 展開・export
  └─ [Sora] SSE UI integrate 進行

Day 3-4 (2026-06-10〜11)
  ├─ [Aoi] 最終チェック・リポ配置
  └─ [Sora] テスト・動作確認

Day 4-5 (2026-06-11〜12)
  ├─ [Aoi] README 作成・最終確認
  ├─ [Sora] PR 作成・Keita 承認待ち
  └─ [joint] merge 予定

制約:
  - Keita の承認が前提（Phase 1 → Phase 2 の gate）
  - Aoi Phase 2-3 と Sora の UI 実装は並行可能
  - Keita 承認までは dev-apollo は mock avatar で先行可
```

### リスク・アシューメント

**アシューメション:**
1. **Figma**：Keita の Google アカウント（keita.urano@gmail.com）が Figma にアクセス可能前提
2. **SVG export**：Figma native SVG で pixel-art 表現が保持される前提
3. **色合い**：ブラウザの色管理・OS の色設定で若干のズレは許容

**リスク:**
- Keita の初期承認遅延 → Phase 1 期間延長
- SVG export で品質低下 → PNG ラスタ代替（ファイルサイズ増）
- 複数キャラ並行表示時のパフォーマンス → CSS sprite sheet or Canvas render 検討

---

## 成果物チェックリスト（DoD）

### デザイン（アオイ）

- [ ] レン visual concept → Figma draft → Keita 承認 OK
- [ ] 全 6 体 × 2 バリエーション = 12 アセット完成
- [ ] 各ファイル 64×64 px、透明背景、命名規則準拠
- [ ] SVG/PNG export テスト（ブラウザ 48×48 px 表示で視認性確認）
- [ ] `/cxo-agent/artifacts/avatars/` に配置完了
- [ ] README.md 作成（用途・使用方法・ライセンス）

### 開発（dev-apollo）

- [ ] React Avatar component 実装 & 単体テスト
- [ ] SSE エージェント state → character/state mapping
- [ ] リアルタイム UI に avatar 表示確認
- [ ] 複数キャラ同時表示・パフォーマンス測定 OK
- [ ] PR 作成・コードレビュー・merge

### 最終承認（Keita）

- [ ] ビジュアル・モチーフ・表現の一貫性確認
- [ ] UI 上での動作・パフォーマンス OK
- [ ] アセット品質・ライセンス OK

---

## 参考資料・リンク

### Figma
- **File:** [TBD] 新規作成時に linke を共有
- **Keita email:** keita.urano@gmail.com

### Apollo UI / 設計書
- **MC-165:** 親タスク（LinkedIn TASK_TRACKER）
- **dev-apollo agent profile:** `.claude/agents/dev-apollo.md`
- **designer agent profile:** `.claude/agents/designer.md`

### 既存リソース
- **Logic style guide:** `.claude/agents/designer.md` § Logic section
- **色パレット参照:** 本ドキュメント § カラーパレット案

---

## コミュニケーション・承認フロー

### 承認フロー（3-step）

1. **Design Brief 提出** → Keita 確認
2. **Phase 1 sample（レン）承認** → Keita/dev-apollo 確認
3. **全アセット完成** → Keita final review → merge

### チャット投稿予定

| タイミング | チャンネル | 内容 |
|---------|---------|------|
| 着手時 | dev | MC-165 ① avatar design 着手宣言 |
| design brief | general | Design Brief 完成通知 → Keita 確認待ち |
| レン完成 | dev | レン sample 完成、Figma link + screenshot → Keita 承認待ち |
| 修正完了 | dev | 修正完了、展開開始 |
| 全完成 | dev | 12 アセット完成、配置完了、README 作成 |
| merge 前 | general | PR link → Keita final check 待ち |

---

## 最後に

このデザインブリーフは **Apollo dashboard の顔** として 6 人格を視覚化する重要なマイルストーン。

**デザイン理念:**
- **ドット絵** = 親しみやすさ・遊び心・クラシック感
- **2 state（working/idle）** = リアルタイム AI agent の稼働感を表現
- **モチーフ統一** = 各キャラクターの職能・個性を一目で理解

Keita 承認を得たら、dev-apollo と連携して SSE UI に組み込み、エージェントの仲間感・信頼感・頼りがい感をビジュアルで強化する。

---

**作成日:** 2026-06-07  
**作成者:** アオイ（designer persona）  
**最終更新:** 2026-06-07  
**ステータス:** 待機（Keita 確認待ち）
