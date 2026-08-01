// ErrorBoundary — 描画時エラーで画面が真っ黒（#root 空）になるのを防ぐ最後の砦。
// 特に、再デプロイで古い JS チャンクが消えた後に lazy ルートを開くと dynamic import が
// reject → Suspense では拾えず全画面ブランクになる。これを検知して最新版へ自動リロードする。
import { Component, type ReactNode } from 'react';

// チャンク読込失敗系のエラーメッセージ（ブラウザ差を吸収）。
const CHUNK_RE =
  /(Loading chunk|Loading CSS chunk|dynamically imported module|imported module script failed|ChunkLoadError|Failed to fetch)/i;

// 10 秒以内の連続リロードは抑止（リロードループ防止）。
function reloadOnce(key: string): void {
  try {
    const last = Number(sessionStorage.getItem(key) || '0');
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    }
  } catch {
    window.location.reload();
  }
}

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    if (CHUNK_RE.test(error?.message ?? '')) {
      // 古いチャンク → 新しい index.html を取りに行くため一度だけ自動リロード。
      reloadOnce('apollo.chunkReloadAt');
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunk = CHUNK_RE.test(error.message ?? '');
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--mc-bg, #0b0f14)',
          color: 'var(--mc-text, #e8ecf2)',
          fontFamily: '-apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif',
        }}
      >
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            {isChunk ? '最新版を読み込み中…' : '表示中に問題が発生しました'}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.8, margin: '0 0 20px' }}>
            {isChunk
              ? 'アプリが更新されたため再読み込みします。自動で戻らない場合は下のボタンを押してください。'
              : '再読み込みすると直ることが多いです。'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0,
              borderRadius: 10,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              background: 'var(--mc-accent, #3b7dd8)',
              color: '#fff',
            }}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }
}
