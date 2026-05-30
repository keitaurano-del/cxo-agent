// VaultAddSheet — Vault へ「ノート作成 / ファイルアップロード」するボトムシート(モバイル) / モーダル(md+)。
//
//  ノート作成タブ: title + body → POST /api/vault/note（folder 既定 20-Knowledge）
//  ファイルタブ:   files[]     → POST /api/vault/upload（フィールド名 files、Ctrl+V 貼付対応）
//
// 成功(201)でトースト + フォームクリア + シート閉じ + Vault ツリー再取得。失敗は理由表示。
// 二重送信防止。文言は中立的な丁寧体。
import { useEffect, useRef, useState } from 'react';
import { CloseIcon, ImageFileIcon, NoteIcon, FileIcon } from './icons';

type Tab = 'note' | 'file';

const NOTE_FOLDERS = ['20-Knowledge', '00-Inbox', '20-Projects', '40-Resources'];

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024; // 25MB / 件

interface PickedFile {
  id: string;
  file: File;
  url: string | null; // 画像のみプレビュー用 object URL（cleanup 必須）
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

export default function VaultAddSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [folder, setFolder] = useState(NOTE_FOLDERS[0]);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // object URL cleanup（アンマウント時）。
  useEffect(() => {
    return () => {
      files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // open 中は背景スクロールを止める。
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    setError(null);
    const accepted: PickedFile[] = [];
    let rejected = false;
    for (const file of incoming) {
      if (files.length + accepted.length >= MAX_FILES) {
        rejected = true;
        break;
      }
      if (file.size > MAX_BYTES) {
        rejected = true;
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        url: isImage(file) ? URL.createObjectURL(file) : null,
      });
    }
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    if (rejected) {
      setError(`ファイルは最大 ${MAX_FILES} 件・各 25MB までです。一部は追加されませんでした。`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ファイルタブ表示中の Ctrl+V 画像貼付。
  useEffect(() => {
    if (!open || tab !== 'file') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            const ext = f.type.split('/')[1] || 'png';
            pasted.push(
              f.name && f.name.trim() !== ''
                ? f
                : new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type }),
            );
          }
        }
      }
      if (pasted.length > 0) {
        e.preventDefault();
        addFiles(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, files]);

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((f) => f.id !== id);
    });
  };

  const resetForm = () => {
    files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    setTitle('');
    setBody('');
    setFolder(NOTE_FOLDERS[0]);
    setFiles([]);
    setError(null);
  };

  const close = () => {
    setError(null);
    onClose();
  };

  const submitNote = async () => {
    if (!title.trim()) {
      setError('タイトルを入力してください。');
      return;
    }
    const res = await fetch('/api/vault/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), body, folder }),
    });
    if (res.status !== 201) {
      throw new Error(await readError(res, 'ノートの作成に失敗しました'));
    }
    const data = (await res.json()) as { pushed?: boolean };
    return data.pushed === false
      ? 'ノートを作成しました（同期は保留中です）。'
      : 'ノートを作成して同期しました。';
  };

  const submitFiles = async () => {
    if (files.length === 0) {
      setError('アップロードするファイルを選択してください。');
      return;
    }
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f.file, f.file.name));
    const res = await fetch('/api/vault/upload', { method: 'POST', body: fd });
    if (res.status !== 201) {
      throw new Error(await readError(res, 'アップロードに失敗しました'));
    }
    const data = (await res.json()) as { pushed?: boolean; files?: unknown[] };
    const count = data.files?.length ?? files.length;
    return data.pushed === false
      ? `${count} 件をアップロードしました（同期は保留中です）。`
      : `${count} 件をアップロードして同期しました。`;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const message = tab === 'note' ? await submitNote() : await submitFiles();
      if (!message) return; // バリデーションで早期 return したケース
      resetForm();
      onClose();
      onCreated(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const canSubmit = tab === 'note' ? title.trim().length > 0 : files.length > 0;

  return (
    <div
      className="fixed inset-0 flex items-end justify-center md:items-center"
      style={{ zIndex: 55 }}
      role="dialog"
      aria-modal="true"
      aria-label="Vault に追加"
    >
      <button type="button" aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={close} />
      <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl md:max-h-[85dvh] md:w-[30rem] md:rounded-2xl md:pb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-text">Vault に追加</h2>
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {/* タブ */}
        <div className="mb-3">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="group" aria-label="種別">
            <button
              type="button"
              onClick={() => setTab('note')}
              aria-pressed={tab === 'note'}
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs ${
                tab === 'note' ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted'
              }`}
            >
              <NoteIcon width={14} height={14} />
              ノート作成
            </button>
            <button
              type="button"
              onClick={() => setTab('file')}
              aria-pressed={tab === 'file'}
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs ${
                tab === 'file' ? 'bg-surface-3 font-semibold text-text' : 'text-text-muted'
              }`}
            >
              <FileIcon width={14} height={14} />
              ファイル
            </button>
          </div>
        </div>

        {tab === 'note' ? (
          <>
            <div className="mb-3">
              <label className="mb-1 block text-xs text-text-muted" htmlFor="vault-note-title">
                タイトル
              </label>
              <input
                id="vault-note-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ノートのタイトルを入力してください"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
              />
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs text-text-muted" htmlFor="vault-note-folder">
                保存先フォルダ
              </label>
              <select
                id="vault-note-folder"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              >
                {NOTE_FOLDERS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-xs text-text-muted" htmlFor="vault-note-body">
                本文（Markdown）
              </label>
              <textarea
                id="vault-note-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder="本文を入力してください"
                className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
              />
            </div>
          </>
        ) : (
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-text-muted">ファイル（最大 {MAX_FILES} 件）</span>
              <span className="text-[11px] text-text-faint">
                {files.length}/{MAX_FILES}
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
              id="vault-files"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={files.length >= MAX_FILES}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-2 px-3 py-3 text-xs text-text-muted hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImageFileIcon width={16} height={16} />
              ファイルを選択
            </button>
            <p className="mt-1.5 text-[11px] text-text-faint">
              Ctrl+V（Mac は ⌘+V）で画像を貼り付けられます。
            </p>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5"
                  >
                    {f.url ? (
                      <img src={f.url} alt={f.file.name} className="h-9 w-9 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface-3 text-text-faint">
                        <FileIcon width={16} height={16} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-text">{f.file.name}</div>
                      <div className="text-[11px] text-text-faint">{formatBytes(f.file.size)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(f.id)}
                      aria-label={`${f.file.name} を削除`}
                      className="rounded-md p-1 text-text-muted hover:bg-surface-3 hover:text-text"
                    >
                      <CloseIcon width={14} height={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
            style={{ color: 'var(--mc-stalled)' }}
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-4 py-2 text-sm text-text-muted hover:bg-surface-2"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-bg hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '送信中…' : tab === 'note' ? '作成する' : 'アップロード'}
          </button>
        </div>
      </div>
    </div>
  );

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    addFiles(Array.from(list));
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body?.error ?? body?.message ?? `${fallback}（HTTP ${res.status}）。`;
  } catch {
    return `${fallback}（HTTP ${res.status}）。`;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
