// 設定ダイアログ（MC-178 フォントサイズ等）
import { FONT_PX_MAX, FONT_PX_MIN, FONT_PX_STEP, useFontSize } from '../lib/useFontSize';
import { SIDEBAR_WIDTH_OPTIONS, useSidebarWidth } from '../lib/useSidebarWidth';
import { CloseIcon } from './icons';

type ThemeMode = 'auto' | 'dark' | 'light';

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  // テーマ（ライト/ダーク/自動）。App から渡された時のみテーマ設定セクションを表示する。
  themeMode?: ThemeMode;
  isDark?: boolean;
  onThemeChange?: (mode: ThemeMode) => void;
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

export default function Settings({ open, onClose, themeMode, isDark, onThemeChange }: SettingsProps) {
  const { fontPx, changeFontPx } = useFontSize();
  // サイドメニュー幅（MC-322）。選択即時反映（CSS 変数経由）。
  const { sidebarWidthMode, changeSidebarWidth } = useSidebarWidth();

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

        <div className="space-y-6">
          {/* テーマ設定セクション（App から themeMode/onThemeChange が渡された時のみ表示） */}
          {themeMode && onThemeChange && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-text">テーマ</h3>
              <div className="grid grid-cols-3 gap-2">
                {THEME_OPTIONS.map((opt) => {
                  const active = themeMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onThemeChange(opt.value)}
                      aria-pressed={active}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'border-accent bg-accent font-semibold text-bg'
                          : 'border-border bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-text-faint">
                「自動」は時間帯で昼＝ライト／夜＝ダークに切り替わります（現在: {isDark ? 'ダーク' : 'ライト'}）。
              </p>
            </div>
          )}

          {/* サイドメニュー幅セクション（MC-322）。選択式・即時反映。 */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-text">サイドメニューの幅</h3>
            <div className="grid grid-cols-3 gap-2">
              {SIDEBAR_WIDTH_OPTIONS.map((opt) => {
                const active = sidebarWidthMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => changeSidebarWidth(opt.value)}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'border-accent bg-accent font-semibold text-bg'
                        : 'border-border bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-text-faint">
              左のサイドメニューの幅を切り替えます（選択した瞬間に反映）。
              <br />
              モバイル表示（メニューが上部に畳まれる画面）には影響しません。
            </p>
          </div>

          {/* フォントサイズ設定セクション */}
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
