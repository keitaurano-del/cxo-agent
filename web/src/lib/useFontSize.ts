// フォントサイズ設定管理（MC-178）
// localStorage に 'apollo_fontsize' キーで "small" | "medium" | "large" を保存
// ダッシュボード全体に --font-scale CSS 変数を適用してスケーリング

import { useState, useCallback } from 'react';

export type FontSizeScale = 'small' | 'medium' | 'large';

const FONT_SIZE_KEY = 'apollo_fontsize';

/** 保存済みフォントサイズを読む（デフォルト: medium） */
export function loadFontSize(): FontSizeScale {
  const v = localStorage.getItem(FONT_SIZE_KEY);
  if (v === 'small' || v === 'medium' || v === 'large') return v;
  return 'medium';
}

/** フォントサイズに対応するスケール係数を返す */
function getFontScaleValue(size: FontSizeScale): number {
  switch (size) {
    case 'small':
      return 0.9;
    case 'medium':
      return 1;
    case 'large':
      return 1.1;
    default:
      return 1;
  }
}

/** ダッシュボード・アプリ全体に --font-scale を適用する */
export function applyFontSize(size: FontSizeScale) {
  const scale = getFontScaleValue(size);
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

/** フォントサイズ設定を管理する Hook */
export function useFontSize() {
  const [fontSize, setFontSize] = useState<FontSizeScale>(() => {
    const loaded = loadFontSize();
    applyFontSize(loaded);
    return loaded;
  });

  // フォントサイズが変わったら DOM + localStorage を更新
  const changeFontSize = useCallback((newSize: FontSizeScale) => {
    applyFontSize(newSize);
    localStorage.setItem(FONT_SIZE_KEY, newSize);
    setFontSize(newSize);
  }, []);

  return { fontSize, changeFontSize };
}
