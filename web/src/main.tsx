// Apollo frontend — エントリポイント。BrowserRouter で 5 ビューを配線。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// 再デプロイで古いチャンクが消えた／ネット瞬断で動的 import が失敗したときに
// 画面が真っ黒にならないよう、最新 index.html を取りに一度だけ自動リロードする。
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  try {
    const KEY = 'apollo.preloadReloadAt';
    const last = Number(sessionStorage.getItem(KEY) || '0');
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    }
  } catch {
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
