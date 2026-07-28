// 埋め込みブラウザ（MC-350 / 旧MC-314 復活）— claude.ai(Cowork) を noVNC ストリーミングで表示する。
//
// 仕組み: サーバの /claude-browser reverse proxy 越しに noVNC の vnc.html を同一オリジン iframe で
// 表示する（認証 Cookie が自動付与される）。VNC パスワードはバンドルに焼かず
// /api/claude-browser/config から認証済みで取得して URL パラメータで渡す。
// 配信元は Xvfb:99 上の Chromium kiosk（520x950 スマホ縦・実ブラウザ）なので、
// CAPTCHA やログインもこの画面内で直接操作できる。

import { useEffect, useState } from 'react';
import { Spinner } from '../components/ui';

export default function ClaudeBrowser() {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/claude-browser/config')
      .then((r) => {
        if (!r.ok) throw new Error(`config ${r.status}`);
        return r.json();
      })
      .then((cfg: { password?: string }) => {
        if (cancelled) return;
        const params = new URLSearchParams({
          autoconnect: 'true',
          reconnect: 'true',
          resize: 'scale',
          path: 'claude-browser/websockify',
          password: cfg.password ?? '',
        });
        setSrc(`/claude-browser/vnc.html?${params.toString()}`);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="p-6 text-sm text-red-400">
        埋め込みブラウザの設定を取得できませんでした（{error}）。裏方サービス
        （apollo-claude-*）が停止している可能性があります。
      </div>
    );
  }
  if (!src) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return (
    <iframe
      src={src}
      title="Claude Cowork（埋め込みブラウザ）"
      className="h-full w-full border-0"
      style={{ minHeight: 'calc(100vh - 4rem)' }}
      allow="clipboard-read; clipboard-write"
    />
  );
}
