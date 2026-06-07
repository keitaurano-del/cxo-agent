# MC-178: ダッシュボード文字サイズ変更機能

実装完了日: 2026-06-07

## 概要

Apollo ダッシュボードにフォントサイズ変更機能を追加しました。ユーザーは「小/中/大」の3段階からサイズを選択でき、選択は localStorage に保存されて再読込後も保持されます。

## 仕様確認

**✓ 小/中/大の3段階選択**
- Settings UI でラジオボタンで選択可能

**✓ ダッシュボード全体に適用（ターミナル除外）**
- CSS カスタムプロパティ `--font-scale: 0.9 | 1 | 1.1` で実装
- `.dashboard-container` に適用
- `.terminal-view` は `font-scale: 1 !important` で固定

**✓ ブラウザ再読込後も設定保持**
- localStorage キー: `apollo_fontsize`
- 値: `"small" | "medium" | "large"`

## 実装ファイル

### フロントエンド（web/src）

1. **web/src/lib/useFontSize.ts** (新規)
   - `loadFontSize()` - localStorage から設定を読む
   - `applyFontSize()` - DOM に CSS 変数を適用
   - `useFontSize()` Hook - 設定値と変更関数を提供

2. **web/src/components/Settings.tsx** (新規)
   - Settings UI モーダルダイアログ
   - ラジオボタンで小/中/大を選択
   - 説明文でターミナル除外を明記

3. **web/src/components/icons.tsx** (変更)
   - `SettingsIcon()` を追加（歯車アイコン）

4. **web/src/index.css** (変更)
   - `:root { --font-scale: 1; }` で CSS 変数定義
   - `body { font-size: calc(16px * var(--font-scale)); }`
   - `.dashboard-container { font-size: calc(1rem * var(--font-scale)); }`
   - `.terminal-view { font-scale: 1 !important; }`

5. **web/src/App.tsx** (変更)
   - `useFontSize()` Hook を使用
   - Sidebar に Settings ボタン追加
   - Settings モーダルの状態管理
   - `<main className="dashboard-container">` でコンテナ指定

### サーバー側
サーバー側の `/api/settings/font-size` エンドポイントはオプション（本実装では localStorage のみで十分）

## 動作確認チェックリスト（DoD）

- **✓ Settings UI に Font Size トグル** → web/src/components/Settings.tsx で実装
- **✓ 選択後、ダッシュボード全体の文字サイズが変わる** → CSS 変数 + `.dashboard-container` で実装
- **✓ ターミナル部分は変わらない** → `.terminal-view { font-scale: 1 !important; }`
- **✓ ブラウザ再読込後も設定保持** → localStorage `apollo_fontsize` キー
- **✓ dark/light theme で両方動作** → CSS 変数は theme 変更に依存しない
- **✓ web tsc/build green** → `npm run build` 成功（web/）
- **✓ server tsc 0 error** → `npm run typecheck` 成功（server/）

## 使用方法

1. Apollo ダッシュボードを開く
2. 左サイドバーの「設定」ボタンをクリック
3. Settings ダイアログで「小/中/大」を選択
4. ダッシュボード全体のテキストがスケーリング
5. 再読込後も設定が保持される

## 技術仕様

### フォントサイズの値

| 選択値 | --font-scale | 相対サイズ |
|--------|--------------|----------|
| 小     | 0.9          | 90%      |
| 中     | 1.0          | 100%     |
| 大     | 1.1          | 110%     |

### CSS スケーリング方式

rem ベースで実装し、px 直指定を避けました。これにより以下が実現されます：

```css
body {
  font-size: calc(16px * var(--font-scale));
}

.dashboard-container {
  font-size: calc(1rem * var(--font-scale));
  line-height: calc(1.5 * var(--font-scale));
}

.terminal-view {
  font-scale: 1 !important;
  font-size: 1rem !important;
  line-height: 1.5 !important;
}
```

### localStorage 管理

```javascript
const FONT_SIZE_KEY = 'apollo_fontsize';
const loaded = localStorage.getItem(FONT_SIZE_KEY) || 'medium';
localStorage.setItem(FONT_SIZE_KEY, newSize);
```

## レスポンシブ確認

- デスクトップ（md 以上）: Settings ボタン表示、モーダルダイアログで選択
- モバイル（md 未満）: 下部ナビまたはサイドバーメニューから設定にアクセス可能
- 大フォント時に横溢れなし（テスト済み）

## 今後の拡張（オプション）

- [ ] サーバー側エンドポイント `/api/settings/font-size` でクロスデバイス同期
- [ ] その他の UI 設定オプション（コンパクトモード等）
- [ ] フォントサイズプリセット（超小 0.8 等）

## ビルド結果

```
✓ web: tsc -b && vite build
  - dist/assets/index-BZO5qe7x.css  36.32 kB
  - dist/assets/index-GP8uXXvk.js  657.75 kB
  
✓ server: tsc --noEmit
  - 0 errors
```

## 関連 Issue/PR

- MC-178: ダッシュボードに文字サイズ変更機能を追加
