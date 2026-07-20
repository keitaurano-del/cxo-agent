// サイドメニュー幅の設定管理（MC-322 → MC-323）。
// 2026-07-20 Keita 指示: 設定モーダルの3択ではなく「サイドメニューの境目にカーソルを
// 持っていくと、そのままドラッグで幅を調整できる」方式へ変更。px 単位で保存する。
// useFontSize（MC-178）と同じパターン: localStorage に保存し、CSS 変数
// --sidebar-width を documentElement へ直接適用する（ドラッグ中も同じ経路で即時反映）。
// サイドバーはデスクトップ（md〜）のみ表示のため、モバイル表示には影響しない。

import { useState, useCallback } from 'react';

const SIDEBAR_WIDTH_KEY = 'apollo_sidebar_width';

/** 幅の許容範囲（px）。default=224px は従来の固定幅 w-56 と同じ。 */
export const SIDEBAR_PX_MIN = 160;
export const SIDEBAR_PX_MAX = 440;
export const SIDEBAR_PX_DEFAULT = 224;

/** px を許容範囲にクランプし整数化する。 */
export function clampSidebarPx(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_PX_DEFAULT;
  const rounded = Math.round(px);
  if (rounded < SIDEBAR_PX_MIN) return SIDEBAR_PX_MIN;
  if (rounded > SIDEBAR_PX_MAX) return SIDEBAR_PX_MAX;
  return rounded;
}

/**
 * 保存済みの幅（px）を読む（未設定は 224px）。
 * 後方互換: 旧3択プリセット 'narrow'/'standard'/'wide'（MC-322 初版）は px へ移行。
 */
export function loadSidebarPx(): number {
  const v = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (v === null) return SIDEBAR_PX_DEFAULT;
  if (v === 'narrow') return 176;
  if (v === 'standard') return SIDEBAR_PX_DEFAULT;
  if (v === 'wide') return 296;
  const n = Number(v);
  if (Number.isFinite(n)) return clampSidebarPx(n);
  return SIDEBAR_PX_DEFAULT;
}

/** CSS 変数 --sidebar-width を適用する（aside が参照）。ドラッグ中の live 反映にも使う。 */
export function applySidebarWidth(px: number) {
  document.documentElement.style.setProperty('--sidebar-width', `${clampSidebarPx(px)}px`);
}

/** サイドメニュー幅設定を管理する Hook。 */
export function useSidebarWidth() {
  const [sidebarPx, setSidebarPx] = useState<number>(() => {
    const loaded = loadSidebarPx();
    applySidebarWidth(loaded);
    return loaded;
  });

  // 確定値の保存（ドラッグ終了時・リセット時に呼ぶ）。
  const changeSidebarPx = useCallback((px: number) => {
    const clamped = clampSidebarPx(px);
    applySidebarWidth(clamped);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
    setSidebarPx(clamped);
  }, []);

  return { sidebarPx, changeSidebarPx };
}
