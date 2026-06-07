// 設定ダイアログ（MC-178 フォントサイズ等）
import { type FontSizeScale, useFontSize } from '../lib/useFontSize';
import { CloseIcon } from './icons';

interface SettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function Settings({ open, onClose }: SettingsProps) {
  const { fontSize, changeFontSize } = useFontSize();

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
            <h3 className="mb-3 text-sm font-semibold text-text">フォントサイズ</h3>
            <div className="space-y-2">
              {(['small', 'medium', 'large'] as const).map((size) => {
                const labels: Record<FontSizeScale, string> = {
                  small: '小 (90%)',
                  medium: '中 (100%)',
                  large: '大 (110%)',
                };
                return (
                  <label key={size} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="font-size"
                      value={size}
                      checked={fontSize === size}
                      onChange={(e) => changeFontSize(e.target.value as FontSizeScale)}
                      className="h-4 w-4 cursor-pointer accent-accent"
                    />
                    <span className="text-sm text-text-muted">{labels[size]}</span>
                  </label>
                );
              })}
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
