// フォントサイズ設定管理（MC-178）
// localStorage に 'apollo_fontsize' キーで基準フォントサイズ px（12〜24）を保存
// ダッシュボード全体に --font-scale CSS 変数（px/16）を適用してスケーリング

import { useState, useCallback } from 'react';

// 後方互換用: 旧来の 'small'|'medium'|'large' プリセット型
export type FontSizeScale = 'small' | 'medium' | 'large';

const FONT_SIZE_KEY = 'apollo_fontsize';

/** 基準フォントサイズの定数（px） */
export const FONT_PX_MIN = 12;
export const FONT_PX_MAX = 24;
export const FONT_PX_DEFAULT = 16;
export const FONT_PX_STEP = 1;

/** px を許容範囲 [12, 24] にクランプし整数化する */
export function clampFontPx(px: number): number {
  if (!Number.isFinite(px)) return FONT_PX_DEFAULT;
  const rounded = Math.round(px);
  if (rounded < FONT_PX_MIN) return FONT_PX_MIN;
  if (rounded > FONT_PX_MAX) return FONT_PX_MAX;
  return rounded;
}

/**
 * 保存済みフォントサイズ（px）を読む（デフォルト: 16px）。
 * 後方互換: 旧 'small'/'medium'/'large' は px に移行（14/16/18）。
 * 数値文字列はそのまま px としてクランプ。
 */
export function loadFontPx(): number {
  const v = localStorage.getItem(FONT_SIZE_KEY);
  if (v === null) return FONT_PX_DEFAULT;
  // 旧プリセット値からの移行
  if (v === 'small') return 14;
  if (v === 'medium') return 16;
  if (v === 'large') return 18;
  // 数値文字列
  const n = Number(v);
  if (Number.isFinite(n)) return clampFontPx(n);
  return FONT_PX_DEFAULT;
}

/** ダッシュボード・アプリ全体に --font-scale（px/16）を適用する */
export function applyFontSize(px: number) {
  const clamped = clampFontPx(px);
  document.documentElement.style.setProperty('--font-scale', String(clamped / 16));
}

/** フォントサイズ設定を管理する Hook */
export function useFontSize() {
  const [fontPx, setFontPx] = useState<number>(() => {
    const loaded = loadFontPx();
    applyFontSize(loaded);
    return loaded;
  });

  // フォントサイズが変わったら DOM + localStorage を更新
  const changeFontPx = useCallback((newPx: number) => {
    const clamped = clampFontPx(newPx);
    applyFontSize(clamped);
    localStorage.setItem(FONT_SIZE_KEY, String(clamped));
    setFontPx(clamped);
  }, []);

  return { fontPx, changeFontPx };
}
