// サイドメニュー幅の設定管理（MC-322）。
// 2026-07-20 Keita 指示:「サイドメニューの幅を選択して可変式にできるように」。
// useFontSize（MC-178）と同じパターン: localStorage に保存し、CSS 変数
// --sidebar-width を documentElement へ直接適用する（複数フック間の同期は DOM 経由で解決）。
// サイドバーはデスクトップ（md〜）のみ表示のため、モバイル表示には影響しない。

import { useState, useCallback } from 'react';

export type SidebarWidthMode = 'narrow' | 'standard' | 'wide';

const SIDEBAR_WIDTH_KEY = 'apollo_sidebar_width';

/** 選択肢（px）。standard=224px は従来の固定幅 w-56 と同じ。 */
export const SIDEBAR_WIDTH_PX: Record<SidebarWidthMode, number> = {
  narrow: 176,
  standard: 224,
  wide: 296,
};

export const SIDEBAR_WIDTH_OPTIONS: { value: SidebarWidthMode; label: string }[] = [
  { value: 'narrow', label: '狭い' },
  { value: 'standard', label: '標準' },
  { value: 'wide', label: '広い' },
];

const DEFAULT_MODE: SidebarWidthMode = 'standard';

function isMode(v: string | null): v is SidebarWidthMode {
  return v === 'narrow' || v === 'standard' || v === 'wide';
}

/** 保存済みの幅モードを読む（不正値・未設定は standard）。 */
export function loadSidebarWidthMode(): SidebarWidthMode {
  const v = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  return isMode(v) ? v : DEFAULT_MODE;
}

/** CSS 変数 --sidebar-width を適用する（aside が参照）。 */
export function applySidebarWidth(mode: SidebarWidthMode) {
  document.documentElement.style.setProperty(
    '--sidebar-width',
    `${SIDEBAR_WIDTH_PX[mode]}px`,
  );
}

/** サイドメニュー幅設定を管理する Hook。 */
export function useSidebarWidth() {
  const [sidebarWidthMode, setMode] = useState<SidebarWidthMode>(() => {
    const loaded = loadSidebarWidthMode();
    applySidebarWidth(loaded);
    return loaded;
  });

  const changeSidebarWidth = useCallback((mode: SidebarWidthMode) => {
    applySidebarWidth(mode);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, mode);
    setMode(mode);
  }, []);

  return { sidebarWidthMode, changeSidebarWidth };
}
