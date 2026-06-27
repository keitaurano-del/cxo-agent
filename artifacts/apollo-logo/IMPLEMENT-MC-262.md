# MC-262 — Apollo ロゴ（A×ロケット）左上マーク差し替え

Keita 承認デザイン（C3 = ロケット型の「A」/ 窓・フィン・炎）。Son がベクター化済み。
**ファビコン側（#2）は Son が実装・本番反映済み**（`web/index.html` に link 追加、`web/public` + `web/dist` に `favicon.svg` / `favicon-16.png` / `favicon-32.png` / `apple-touch-icon.png`、apollomansion.com で 200 配信確認済み）。

このタスクは **左上マーク（#1）だけ**。ソラの作業ツリーに同梱して方式B（`vite build` 単体）でデプロイしてほしい。
※ `App.tsx` / `icons.tsx` はソラが編集中のため、Son は触らず委譲。

## 1) `web/src/components/icons.tsx` に追加（既存 IconProps を流用）

```tsx
// Apollo ブランドマーク（A×ロケット）。塗りで currentColor 継承＝配色は親が制御。MC-262。
export function ApolloMark(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.7C12.9 5.2 17.8 11.2 20.4 16.8C20.95 18 20.2 18.8 19.1 18.8L15.2 18.8C13.9 18.8 13.2 16.7 12 16.7C10.8 16.7 10.1 18.8 8.8 18.8L4.9 18.8C3.8 18.8 3.05 18 3.6 16.8C6.2 11.2 11.1 5.2 12 2.7ZM9.4 10.1a2.6 2.6 0 1 1 5.2 0 2.6 2.6 0 1 1-5.2 0Z"
      />
      <rect x="10" y="19.6" width="1" height="1.8" rx="0.5" />
      <rect x="11.5" y="19.6" width="1" height="2.7" rx="0.5" />
      <rect x="13" y="19.6" width="1" height="1.8" rx="0.5" />
    </svg>
  );
}
```

## 2) `web/src/App.tsx`

- import に `ApolloMark` を追加（`GridIcon` は別箇所〔ナビ "ダッシュボード"〕で使用中なので残す）。
- サイドバー左上のブランドマーク（現状 `<GridIcon width={22} height={22} />`、"Apollo" テキストの左）だけを差し替え:

```tsx
<ApolloMark width={22} height={22} />
```

（注: `GridIcon` はナビ項目 `{ to: '/', label: 'ダッシュボード', icon: <GridIcon /> }` でも使われている。そちらは変更しない。左上ブランドの1箇所のみ差し替え。）

## 3) デプロイ & 検証

- 方式B（`cd web && npx vite build`、tsc 非経由）で `web/dist` 更新。
- ライト/ダーク両テーマで左上に A×ロケットが accent 色で出ること、22px で鼻・窓・炎が判別できることを実機（Playwright か OpenClaw ブラウザ）で確認。

## アセット
- `artifacts/apollo-logo/mark.svg` … currentColor 版（上記 path と同一）
- `artifacts/apollo-logo/favicon.svg` … #3b7dd8 塗り版（ファビコンは反映済み・参考）
