// 画面右下に常駐するアップロード進捗インジケーター。
// UploadContext の状態を購読し、アップロード中・完了・エラー時に表示する。
// ページ遷移してもアンマウントされないためフローティングで常時確認できる。
import { useUpload } from '../lib/UploadContext';
import { UploadIcon, CloseIcon } from './icons';

export function UploadToast() {
  const { uploading, progress, batchInfo, message, error, fileName, dismiss } = useUpload();

  if (!uploading && !message && !error) return null;

  return (
    <div
      className="fixed bottom-20 right-4 z-50 w-72 rounded-xl border border-border bg-surface shadow-lg md:bottom-6"
      role={error ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="flex items-start gap-3 p-3">
        <span className="mt-0.5 shrink-0 text-text-faint">
          <UploadIcon width={16} height={16} />
        </span>
        <div className="min-w-0 flex-1">
          {uploading && (
            <>
              <p className="truncate text-xs font-medium text-text">
                {fileName ? `${fileName} をアップロード中...` : 'アップロード中...'}
              </p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-text-faint">
                {progress}%{batchInfo ? `　${batchInfo}` : ''}
              </p>
            </>
          )}
          {!uploading && message && (
            <p className="text-xs text-text" style={{ color: 'var(--mc-active)' }}>
              {message}
            </p>
          )}
          {!uploading && error && (
            <p className="text-xs" style={{ color: 'var(--mc-stalled)' }}>
              {error}
            </p>
          )}
        </div>
        {!uploading && (message || error) && (
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded p-0.5 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label="閉じる"
          >
            <CloseIcon width={14} height={14} />
          </button>
        )}
      </div>
    </div>
  );
}
