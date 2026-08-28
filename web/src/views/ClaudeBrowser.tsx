// 埋め込みブラウザ（MC-350 / 旧MC-314 復活）— claude.ai(Cowork) を noVNC ストリーミングで表示する。
//
// 仕組み: サーバの /claude-browser reverse proxy 越しに noVNC の vnc.html を同一オリジン iframe で
// 表示する（認証 Cookie が自動付与される）。VNC パスワードはバンドルに焼かず
// /api/claude-browser/config から認証済みで取得して URL パラメータで渡す。
// 配信元は Xvfb:99 上の Chromium kiosk（1280x800・実ブラウザ）なので、
// CAPTCHA やログイン、Claude Design(claude.ai/design) もこの画面内で直接操作できる。
//
// モバイル対応（2026-08-03〜04 Keita 要望）:
//   - ズーム: ＋/− ボタン・ピンチ（CSS transform で拡大）。
//   - スクロール: noVNC の 1 本指ドラッグは「クリック＝ドラッグ」扱いでページがスクロールしない。
//     そこで ✋ モードの 1 本指ドラッグを canvas への wheel 注入に変換して実スクロールさせる
//     （拡大中は表示のパン）。👆 モードでは 2 本指ドラッグで native スクロールも可。
//   - キーボード: noVNC のソフトキーボードボタンは左端の細いコントロールバー内で気付きにくい。
//     ⌨ ボタンで noVNC の #noVNC_keyboard_button を直接叩いて即キーボードを出す（同一オリジン）。
//   - 全画面: ダッシュボードのヘッダ/ナビごと覆う fixed 全画面 ＋ ブラウザ Fullscreen API 併用。

import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../components/ui';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCROLL_FACTOR = 2.5; // 指の移動px → wheel delta（noVNC の WHEEL_STEP=50/step）
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function ClaudeBrowser() {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panMode, setPanMode] = useState(false); // false=操作(タップ→VNC) / true=スクロール/移動
  const [fullscreen, setFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const gesture = useRef({
    scale: 1, tx: 0, ty: 0,
    lastX: 0, lastY: 0,
    startDist: 0, startScale: 1, midX: 0, midY: 0,
    mode: 'none' as 'none' | 'drag' | 'pinch',
  });

  useEffect(() => {
    gesture.current.scale = scale;
    gesture.current.tx = tx;
    gesture.current.ty = ty;
  }, [scale, tx, ty]);

  // ブラウザ側で全画面が解除された（Esc 等）ら state を同期
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

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

  // noVNC canvas へ wheel を注入して「ページを実スクロール」させる（同一オリジンなので可能）。
  function injectWheel(deltaX: number, deltaY: number) {
    try {
      const win = iframeRef.current?.contentWindow as (Window & typeof globalThis) | null | undefined;
      const canvas = iframeRef.current?.contentDocument?.querySelector('canvas');
      if (!win || !canvas) return;
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new win.WheelEvent('wheel', {
          deltaX, deltaY, deltaMode: 0,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          bubbles: true, cancelable: true,
        }),
      );
    } catch {
      /* cross-frame or 未接続 — 無視 */
    }
  }

  // noVNC のソフトキーボードを出す（左端コントロールバーの keyboard ボタンを直接叩く）。
  function showKeyboard() {
    try {
      const doc = iframeRef.current?.contentDocument;
      const btn = doc?.getElementById('noVNC_keyboard_button') as HTMLElement | null;
      if (btn) { btn.click(); return; }
      (doc?.getElementById('noVNC_keyboardinput') as HTMLTextAreaElement | null)?.focus();
    } catch {
      /* 無視 */
    }
  }

  async function toggleFullscreen() {
    const el = containerRef.current;
    const next = !fullscreen;
    setFullscreen(next); // fixed 全画面（Fullscreen API 非対応でもクロムは覆える）
    try {
      if (next) await el?.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      /* API 不可でも fixed 全画面で継続 */
    }
  }

  function clampPan(nx: number, ny: number, s: number) {
    const el = containerRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    return { x: clamp(nx, w * (1 - s), 0), y: clamp(ny, h * (1 - s), 0) };
  }

  function zoomAtCenter(nextScale: number) {
    const el = containerRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    const s = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const cx = (w / 2 - tx) / scale;
    const cy = (h / 2 - ty) / scale;
    const nt = clampPan(w / 2 - cx * s, h / 2 - cy * s, s);
    setScale(s); setTx(nt.x); setTy(nt.y);
  }

  function resetView() { setScale(1); setTx(0); setTy(0); }

  function dist(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function onTouchStart(e: React.TouchEvent) {
    if (!panMode) return;
    const g = gesture.current;
    if (e.touches.length === 1) {
      g.mode = 'drag';
      g.lastX = e.touches[0].clientX;
      g.lastY = e.touches[0].clientY;
    } else if (e.touches.length >= 2) {
      g.mode = 'pinch';
      g.startDist = dist(e.touches[0], e.touches[1]);
      g.startScale = g.scale;
      const rect = containerRef.current?.getBoundingClientRect();
      g.midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - (rect?.left ?? 0);
      g.midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - (rect?.top ?? 0);
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!panMode) return;
    const g = gesture.current;
    if (g.mode === 'drag' && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - g.lastX;
      const dy = e.touches[0].clientY - g.lastY;
      g.lastX = e.touches[0].clientX;
      g.lastY = e.touches[0].clientY;
      if (g.scale > 1) {
        const p = clampPan(g.tx + dx, g.ty + dy, g.scale);
        g.tx = p.x; g.ty = p.y;
        setTx(p.x); setTy(p.y);
      } else {
        injectWheel(-dx * SCROLL_FACTOR, -dy * SCROLL_FACTOR);
      }
    } else if (g.mode === 'pinch' && e.touches.length >= 2) {
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      const ratio = g.startDist > 0 ? d / g.startDist : 1;
      const ns = clamp(g.startScale * ratio, MIN_SCALE, MAX_SCALE);
      const cx = (g.midX - g.tx) / g.scale;
      const cy = (g.midY - g.ty) / g.scale;
      const p = clampPan(g.midX - cx * ns, g.midY - cy * ns, ns);
      g.scale = ns; g.tx = p.x; g.ty = p.y;
      setScale(ns); setTx(p.x); setTy(p.y);
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (!panMode) return;
    const g = gesture.current;
    if (e.touches.length === 0) g.mode = 'none';
    else if (e.touches.length === 1) {
      g.mode = 'drag';
      g.lastX = e.touches[0].clientX;
      g.lastY = e.touches[0].clientY;
    }
  }

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

  const btn =
    'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-lg text-white shadow-lg backdrop-blur active:scale-95 select-none';

  return (
    <div
      ref={containerRef}
      className={
        fullscreen
          ? 'fixed inset-0 z-[100] overflow-hidden bg-black'
          : 'relative h-full w-full overflow-hidden bg-black'
      }
      style={
        fullscreen
          ? { touchAction: panMode ? 'none' : 'auto' }
          : { minHeight: 'calc(100vh - 4rem)', touchAction: panMode ? 'none' : 'auto' }
      }
    >
      <iframe
        ref={iframeRef}
        src={src}
        title="Dekiru（埋め込みブラウザ）"
        className="absolute inset-0 h-full w-full border-0"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: '0 0',
          pointerEvents: panMode ? 'none' : 'auto',
        }}
        allow="clipboard-read; clipboard-write; fullscreen"
      />

      {panMode && (
        <div
          className="absolute inset-0"
          style={{ touchAction: 'none' }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        />
      )}

      {/* コントロール（常時表示・右下） */}
      <div className="pointer-events-none absolute bottom-4 right-3 flex flex-col items-end gap-2">
        <button type="button" className={btn} onClick={toggleFullscreen} title="全画面の切替">
          {fullscreen ? '✕' : '⛶'}
        </button>
        <button type="button" className={btn} onClick={showKeyboard} title="キーボードを表示">⌨</button>
        <button
          type="button"
          onClick={() => setPanMode((m) => !m)}
          className={`pointer-events-auto flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-white shadow-lg backdrop-blur active:scale-95 select-none ${
            panMode ? 'bg-amber-600/80' : 'bg-emerald-600/80'
          }`}
          title="操作モード（タップ→VNC）とスクロール/移動モードを切替"
        >
          {panMode ? '✋ スクロール' : '👆 操作'}
        </button>
        <button type="button" className={btn} onClick={() => zoomAtCenter(scale + 0.5)} title="ズームイン">＋</button>
        <button type="button" className={btn} onClick={() => zoomAtCenter(scale - 0.5)} title="ズームアウト">－</button>
        <button type="button" className={`${btn} text-sm`} onClick={resetView} title="ズームリセット">
          {Math.round(scale * 100)}%
        </button>
      </div>
    </div>
  );
}
