// ターミナル（MC-92）— Vultr 箱の tmux main（林 CLI 常駐）をブラウザから操作する。
//
// /terminal は Apollo サーバ側の reverse proxy ルート（→ localhost の ttyd）。
// 同一オリジンの iframe なので、認証 Cookie（mc_token）は自動付与され、未認証では
// サーバ側で弾かれる（HTTP・WS とも）。ttyd の Basic 認証は proxy が内部付与するため
// ここでは意識しない。フル操作（読み書き両方）に対応。
//
// モバイル: iframe は高さいっぱいに広げ、打鍵・閲覧できる。ttyd 自体がレスポンシブ。

import { PageHeader } from '../components/PageHeader';

export default function Terminal() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="ターミナル"
        subtitle="tmux main（林セッション）をブラウザから操作します。読み書き両方に対応しています。"
        right={
          <a
            href="/terminal/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            新しいタブで開く
          </a>
        }
      />
      <div className="relative flex-1 overflow-hidden bg-bg">
        <iframe
          src="/terminal/"
          title="Apollo ターミナル"
          className="h-full w-full border-0"
          // ttyd は同一オリジン。スクリプト・WebSocket・クリップボードを許可する。
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
