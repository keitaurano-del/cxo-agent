// 設定ダイアログ（MC-178 フォントサイズ等）
import { FONT_PX_MAX, FONT_PX_MIN, FONT_PX_STEP, useFontSize } from '../lib/useFontSize';
import { CloseIcon } from './icons';

interface SettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function Settings({ open, onClose }: SettingsProps) {
  const { fontPx, changeFontPx } = useFontSize();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      {/* モーダルダイアログ本体 */}
      <div
        className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        {/* ヘッダ */}
        <div className="mb-6 flex items-center justify-between">
          <h2 id="settings-title" className="text-lg font-bold text-text">
            設定
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
            aria-label="閉じる"
          >
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        {/* フォントサイズ設定セクション */}
        <div className="space-y-4">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">フォントサイズ</h3>
              <span className="text-sm tabular-nums text-text-muted">文字サイズ: {fontPx}px</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => changeFontPx(fontPx - FONT_PX_STEP)}
                disabled={fontPx <= FONT_PX_MIN}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="文字サイズを小さく"
              >
                −
              </button>
              <input
                type="range"
                min={FONT_PX_MIN}
                max={FONT_PX_MAX}
                step={FONT_PX_STEP}
                value={fontPx}
                onChange={(e) => changeFontPx(Number(e.target.value))}
                className="h-4 flex-1 cursor-pointer accent-accent"
                aria-label="文字サイズ (px)"
              />
              <button
                type="button"
                onClick={() => changeFontPx(fontPx + FONT_PX_STEP)}
                disabled={fontPx >= FONT_PX_MAX}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="文字サイズを大きく"
              >
                +
              </button>
              <input
                type="number"
                min={FONT_PX_MIN}
                max={FONT_PX_MAX}
                step={FONT_PX_STEP}
                value={fontPx}
                onChange={(e) => changeFontPx(Number(e.target.value))}
                className="w-16 shrink-0 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text tabular-nums"
                aria-label="文字サイズ (px) を入力"
              />
            </div>
            <p className="mt-3 text-xs text-text-faint">
              ダッシュボード全体の文字サイズを変更します。
              <br />
              ターミナルはこの設定の影響を受けません。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
