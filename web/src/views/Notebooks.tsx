// ノートブック（NotebookLM 的な資料セット＋資料根拠 Q&A＋生成物、MC-126）。
//
// 一覧画面: ノートブックの作成・選択・削除。
// 詳細画面: md+ は 3 ペイン（資料 / チャット / 生成物）、モバイルはタブ切替。
//   - 左 = 資料: アップロード（D&D＋選択、進捗バー）・一覧・プレビュー・削除。
//   - 中央 = チャット: 履歴（吹き出し）＋質問送信（claude が時間かかるのでローディング）。
//   - 右 = 生成物: 生成ボタン群（要約/FAQ/時系列/テンプレート/カスタム）＋生成物一覧。
//
// バックエンド API は全て auth 配下で Cookie mc_token が same-origin 自動付与される。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type {
  NotebookSummary,
  NotebookDetail,
  NotebookFileRef,
  NotebookSourceKind,
  NotebookChatMessage,
  NotebookAskResponse,
  NotebookGenerateKind,
  NotebookGenerateResponse,
} from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState, Spinner } from '../components/ui';
import {
  NotebookIcon,
  PlusIcon,
  TrashIcon,
  DownloadIcon,
  UploadIcon,
  EyeIcon,
  CloseIcon,
  SendIcon,
  SparkIcon,
  ChevronRightIcon,
  SheetIcon,
  SlidesIcon,
  PdfFileIcon,
  TextFileIcon,
  ImageFileIcon,
  FileIcon,
  FolderIcon,
} from '../components/icons';
import { relativeTime } from '../lib/time';

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const OFFICE_KINDS = new Set<NotebookSourceKind>(['spreadsheet', 'presentation', 'document']);
const CSV_EXT = '.csv';

function humanReadableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function KindIcon({ kind, ext }: { kind: NotebookSourceKind; ext: string }) {
  const props = { width: 18, height: 18 };
  if (kind === 'spreadsheet') return <SheetIcon {...props} />;
  if (kind === 'presentation') return <SlidesIcon {...props} />;
  if (kind === 'pdf') return <PdfFileIcon {...props} />;
  if (kind === 'image') return <ImageFileIcon {...props} />;
  if (kind === 'markdown' || kind === 'text') return <TextFileIcon {...props} />;
  if (kind === 'document') return <FileIcon {...props} />;
  if (IMG_EXTS.has(ext.toLowerCase())) return <ImageFileIcon {...props} />;
  return <FileIcon {...props} />;
}

function isImageFile(file: NotebookFileRef): boolean {
  return file.kind === 'image' || IMG_EXTS.has(file.ext.toLowerCase());
}
function isOfficeFile(file: NotebookFileRef): boolean {
  return OFFICE_KINDS.has(file.kind) && file.ext.toLowerCase() !== CSV_EXT;
}
/** inline プレビュー（iframe / img）で見られるか。 */
function isPreviewable(file: NotebookFileRef): boolean {
  return (
    file.kind === 'pdf' ||
    file.kind === 'markdown' ||
    file.kind === 'text' ||
    isImageFile(file) ||
    isOfficeFile(file)
  );
}

function fileUrl(id: string, file: NotebookFileRef, inline: boolean): string {
  const q = inline ? '&inline=1' : '';
  return `/api/notebooks/${id}/file?path=${encodeURIComponent(file.relpath)}${q}`;
}

// ─── プレビューモーダル（PDF=iframe / Office=PDF変換iframe / 画像=img / text・md=iframe）──

function PreviewModal({
  id,
  file,
  onClose,
}: {
  id: string;
  file: NotebookFileRef;
  onClose: () => void;
}) {
  const src = fileUrl(id, file, true);
  const asImage = isImageFile(file);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg/90 p-2 backdrop-blur md:p-6"
      role="dialog"
      aria-modal
      aria-label={`${file.name} プレビュー`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-text" title={file.name}>
          {file.name}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
          aria-label="プレビューを閉じる"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>
      <div className="relative flex-1 overflow-auto rounded-lg border border-border bg-surface">
        {asImage ? (
          <div className="flex h-full items-center justify-center p-2">
            <img
              src={src}
              alt={file.name}
              className="max-h-full max-w-full rounded"
            />
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-faint">
              プレビューを生成しています…
            </div>
            <iframe
              src={src}
              title={`${file.name} プレビュー`}
              className="relative h-full w-full"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── アップロード（D&D ＋ 選択、進捗バー）──────────────────────────

function UploadPanel({ id, onUploaded }: { id: string; onUploaded: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const upload = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0 || uploading) return;
      setError(null);
      setMessage(null);
      setUploading(true);
      setProgress(0);

      const fd = new FormData();
      files.forEach((f) => {
        // webkitdirectory で選択したファイルは webkitRelativePath にパスが入る。
        // basename のみを使うことでサーバ側の sanitize と一致する（フラット保存）。
        const name = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        fd.append('files', f, name);
      });

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/notebooks/${id}/sources`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 201) {
          let count = files.length;
          try {
            const body = JSON.parse(xhr.responseText) as { added?: unknown[] };
            count = body.added?.length ?? files.length;
          } catch {
            /* parse 失敗時は送信件数。 */
          }
          setMessage(`${count} 件の資料を追加しました。`);
          onUploaded();
        } else {
          let msg = `アップロードに失敗しました（HTTP ${xhr.status}）。`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* 既定メッセージ。 */
          }
          setError(msg);
        }
      };
      xhr.onerror = () => {
        setUploading(false);
        setError('ネットワークエラーでアップロードに失敗しました。');
      };
      xhr.send(fd);
      if (inputRef.current) inputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    },
    [id, uploading, onUploaded],
  );

  return (
    <div className="mb-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading && e.dataTransfer.files.length > 0) upload(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-3 text-center transition-colors ${
          dragOver ? 'border-accent bg-surface-2' : 'border-border bg-surface'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) upload(e.target.files);
          }}
        />
        {/* webkitdirectory は非標準のため spread で型チェックを回避する */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) upload(e.target.files);
          }}
          {...({ webkitdirectory: '' } as React.HTMLAttributes<HTMLInputElement>)}
        />
        <span className="text-text-faint">
          <UploadIcon width={20} height={20} />
        </span>
        <p className="text-xs text-text-muted">資料をドラッグ＆ドロップ、または</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg transition-opacity disabled:opacity-50"
          >
            <UploadIcon width={13} height={13} />
            資料を選択
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 border border-border px-3 py-1 text-xs font-semibold text-text transition-opacity disabled:opacity-50"
          >
            <FolderIcon width={13} height={13} />
            フォルダを選択
          </button>
        </div>
      </div>

      {uploading && (
        <div className="mt-2" role="status" aria-live="polite">
          <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
            <span>アップロード中…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {error}
        </div>
      )}
      {message && !error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--mc-active)' }}>
          {message}
        </p>
      )}
    </div>
  );
}

// ─── 資料ペイン ───────────────────────────────────────────

function SourceRow({
  id,
  file,
  onPreview,
  onDeleted,
}: {
  id: string;
  file: NotebookFileRef;
  onPreview: (file: NotebookFileRef) => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(() => {
    setDeleting(true);
    setError(null);
    fetch(`/api/notebooks/${id}/sources?name=${encodeURIComponent(file.name)}`, {
      method: 'DELETE',
    })
      .then(async (res) => {
        if (res.ok) {
          onDeleted();
          return;
        }
        let msg = `削除に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* 既定メッセージ。 */
        }
        setError(msg);
        setDeleting(false);
        setConfirming(false);
      })
      .catch(() => {
        setError('ネットワークエラーで削除に失敗しました。');
        setDeleting(false);
        setConfirming(false);
      });
  }, [id, file.name, onDeleted]);

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-text-faint">
            <KindIcon kind={file.kind} ext={file.ext} />
          </span>
          <span className="truncate text-sm text-text" title={file.name}>
            {file.name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isPreviewable(file) && (
            <button
              type="button"
              onClick={() => onPreview(file)}
              className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
              aria-label={`${file.name} をプレビュー`}
            >
              <EyeIcon width={15} height={15} />
            </button>
          )}
          <a
            href={fileUrl(id, file, false)}
            download={file.name}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} をダウンロード`}
          >
            <DownloadIcon width={15} height={15} />
          </a>
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} を削除`}
          >
            <TrashIcon width={15} height={15} />
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-text-faint">
        <span>{humanReadableSize(file.sizeBytes)}</span>
        {file.extracted === false && <span title="テキスト抽出なし">抽出なし</span>}
      </div>

      {confirming && (
        <div className="mt-2 rounded-lg border border-border bg-surface-2 p-2.5" role="alertdialog" aria-label="削除の確認">
          <p className="text-xs text-text">
            <span className="font-medium" title={file.name}>
              {file.name}
            </span>{' '}
            を削除しますか？
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded-full px-3 py-1 text-xs text-text-muted hover:bg-surface-3 hover:text-text disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
              style={{ backgroundColor: 'var(--mc-stalled)' }}
            >
              <TrashIcon width={12} height={12} />
              {deleting ? '削除中…' : '削除する'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-2.5 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

function SourcesPane({
  id,
  sources,
  onChanged,
  onPreview,
}: {
  id: string;
  sources: NotebookFileRef[];
  onChanged: () => void;
  onPreview: (file: NotebookFileRef) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        資料 <span className="ml-1 text-text-muted">{sources.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <UploadPanel id={id} onUploaded={onChanged} />
        {sources.length === 0 ? (
          <EmptyState>資料をアップロードすると、ここに表示されます</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {sources.map((f) => (
              <SourceRow key={f.relpath} id={id} file={f} onPreview={onPreview} onDeleted={onChanged} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── チャットペイン ───────────────────────────────────────

function ChatBubble({ msg }: { msg: NotebookChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
          isUser ? 'rounded-br-sm bg-accent text-bg' : 'rounded-bl-sm bg-surface-2 text-text'
        }`}
      >
        {msg.text}
      </div>
    </div>
  );
}

function ChatPane({
  id,
  chat,
  hasSources,
  onAnswered,
}: {
  id: string;
  chat: NotebookChatMessage[];
  hasSources: boolean;
  onAnswered: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 楽観追加した自分の質問（送信中に即表示）。
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, asking, pendingQuestion]);

  const submit = useCallback(() => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    setPendingQuestion(q);
    setQuestion('');
    fetch(`/api/notebooks/${id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as NotebookAskResponse;
        if (!res.ok) {
          setError(body.error || `回答の取得に失敗しました（HTTP ${res.status}）。`);
        } else if (body.error && !body.answer) {
          setError(body.error);
        } else if (body.error) {
          // 部分劣化（タイムアウト等で部分回答あり）。
          setError('回答が途中で打ち切られた可能性があります。');
        }
        // chat は ask 後にサーバへ user/assistant 両方記録済み。再取得して反映。
        onAnswered();
      })
      .catch(() => {
        setError('ネットワークエラーで回答を取得できませんでした。');
      })
      .finally(() => {
        setAsking(false);
        setPendingQuestion(null);
      });
  }, [id, question, asking, onAnswered]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        チャット
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {chat.length === 0 && !pendingQuestion ? (
          <EmptyState>
            {hasSources
              ? '資料について質問できます。回答は資料を根拠に生成されます。'
              : 'まず資料をアップロードすると、その内容について質問できます。'}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-2.5">
            {chat.map((m, i) => (
              <ChatBubble key={`${m.ts}-${i}`} msg={m} />
            ))}
            {/* 送信中の楽観追加（chat に未反映の自分の質問）。 */}
            {pendingQuestion && (
              <ChatBubble msg={{ ts: '', role: 'user', text: pendingQuestion }} />
            )}
            {asking && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-text-muted">
                  <Spinner />
                  資料を読んでいます…
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {error && (
        <div role="alert" className="mx-3 mb-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
          {error}
        </div>
      )}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={asking}
            rows={2}
            placeholder="資料について質問する…"
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={submit}
            disabled={asking || question.trim() === ''}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-bg transition-opacity disabled:opacity-40"
            aria-label="質問を送信"
          >
            {asking ? <Spinner /> : <SendIcon width={18} height={18} />}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-text-faint">回答には時間がかかる場合があります（⌘/Ctrl + Enter で送信）。</p>
      </div>
    </div>
  );
}

// ─── 生成物ペイン ─────────────────────────────────────────

const GENERATE_BUTTONS: { kind: NotebookGenerateKind; label: string }[] = [
  { kind: 'summary', label: '要約' },
  { kind: 'faq', label: 'FAQ' },
  { kind: 'timeline', label: '時系列' },
  { kind: 'template', label: 'テンプレート' },
  { kind: 'template_extract', label: 'テンプレート抽出' },
  { kind: 'custom', label: 'カスタム' },
];

// テンプレートで指定できる出力形式。
const TEMPLATE_FORMATS = ['指定なし', 'xlsx', 'docx', 'pptx', 'md'];

function ArtifactRow({
  id,
  file,
  onPreview,
}: {
  id: string;
  file: NotebookFileRef;
  onPreview: (file: NotebookFileRef) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-text-faint">
          <KindIcon kind={file.kind} ext={file.ext} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm text-text" title={file.name}>
            {file.name}
          </div>
          <div className="text-[11px] text-text-faint">{humanReadableSize(file.sizeBytes)}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {isPreviewable(file) && (
          <button
            type="button"
            onClick={() => onPreview(file)}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${file.name} をプレビュー`}
          >
            <EyeIcon width={15} height={15} />
          </button>
        )}
        <a
          href={fileUrl(id, file, false)}
          download={file.name}
          className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
          aria-label={`${file.name} をダウンロード`}
        >
          <DownloadIcon width={15} height={15} />
        </a>
      </div>
    </div>
  );
}

function ArtifactsPane({
  id,
  artifacts,
  hasSources,
  onGenerated,
  onPreview,
}: {
  id: string;
  artifacts: NotebookFileRef[];
  hasSources: boolean;
  onGenerated: () => void;
  onPreview: (file: NotebookFileRef) => void;
}) {
  const [activeKind, setActiveKind] = useState<NotebookGenerateKind | null>(null);
  const [instruction, setInstruction] = useState('');
  const [templateFormat, setTemplateFormat] = useState(TEMPLATE_FORMATS[0]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const needsInstruction = activeKind === 'custom';
  const showInstruction = activeKind === 'custom' || activeKind === 'template' || activeKind === 'template_extract';

  const run = useCallback(() => {
    if (!activeKind || generating) return;
    if (needsInstruction && instruction.trim() === '') {
      setError('カスタムは指示を入力してください。');
      return;
    }
    setGenerating(true);
    setError(null);
    setReport(null);

    // テンプレート系は出力形式の指定を instruction に織り込む。
    let instr = instruction.trim();
    if ((activeKind === 'template' || activeKind === 'template_extract') && templateFormat !== TEMPLATE_FORMATS[0]) {
      const fmt = `出力形式は ${templateFormat} で作成してください。`;
      instr = instr ? `${fmt} ${instr}` : fmt;
    }

    fetch(`/api/notebooks/${id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: activeKind, instruction: instr || undefined }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as NotebookGenerateResponse;
        if (!res.ok) {
          setError(body.error || `生成に失敗しました（HTTP ${res.status}）。`);
        } else if (!body.ok) {
          setError(body.error || '生成物を作成できませんでした。資料が十分か確認してください。');
        } else {
          const created = body.created?.length ?? 0;
          setReport(created > 0 ? `${created} 件の生成物を作成しました。` : (body.report || '生成が完了しました。'));
          setInstruction('');
        }
        onGenerated();
      })
      .catch(() => {
        setError('ネットワークエラーで生成できませんでした。');
      })
      .finally(() => setGenerating(false));
  }, [id, activeKind, instruction, templateFormat, needsInstruction, generating, onGenerated]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        生成物 <span className="ml-1 text-text-muted">{artifacts.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-3 rounded-lg border border-border bg-surface p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {GENERATE_BUTTONS.map((b) => (
              <button
                key={b.kind}
                type="button"
                onClick={() => {
                  setActiveKind((prev) => (prev === b.kind ? null : b.kind));
                  setError(null);
                  setReport(null);
                }}
                disabled={generating}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
                  activeKind === b.kind
                    ? 'bg-accent font-semibold text-bg'
                    : 'bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
                }`}
              >
                <SparkIcon width={12} height={12} />
                {b.label}
              </button>
            ))}
          </div>

          {(activeKind === 'template' || activeKind === 'template_extract') && (
            <div className="mb-2">
              {activeKind === 'template_extract' && (
                <p className="mb-2 text-[11px] text-text-faint">
                  資料の構造・書き方を分析し、各セクションに「目的」「書くべき内容」「書き方のコツ」を添えた学習ガイド付きテンプレートを生成します。
                </p>
              )}
              <label className="mb-1 block text-[11px] text-text-faint">出力形式</label>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_FORMATS.map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setTemplateFormat(fmt)}
                    disabled={generating}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                      templateFormat === fmt
                        ? 'bg-surface-3 font-semibold text-text'
                        : 'bg-surface-2 text-text-muted hover:text-text'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showInstruction && (
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={generating}
              rows={2}
              placeholder={
                activeKind === 'custom'
                  ? '作成してほしい内容を指示してください（必須）…'
                  : activeKind === 'template_extract'
                  ? '用途（例: 会議議事録、企画書、週次レポート）や要望があれば入力（任意）…'
                  : '雛形の追加要望があれば入力（任意）…'
              }
              className="mb-2 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
            />
          )}

          {activeKind && (
            <button
              type="button"
              onClick={run}
              disabled={generating || !hasSources}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity disabled:opacity-40"
            >
              {generating ? (
                <>
                  <Spinner />
                  生成しています…
                </>
              ) : (
                <>
                  <SparkIcon width={15} height={15} />
                  生成する
                </>
              )}
            </button>
          )}
          {!hasSources && activeKind && (
            <p className="mt-1.5 text-[11px] text-text-faint">資料を追加すると生成できます。</p>
          )}
          {generating && (
            <p className="mt-1.5 text-[11px] text-text-faint">資料を読み込んでいます。完了まで時間がかかる場合があります。</p>
          )}
          {error && (
            <div role="alert" className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
              {error}
            </div>
          )}
          {report && !error && (
            <p className="mt-2 text-xs" style={{ color: 'var(--mc-active)' }}>
              {report}
            </p>
          )}
        </div>

        {artifacts.length === 0 ? (
          <EmptyState>生成ボタンから要約や FAQ などを作成できます</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {artifacts.map((f) => (
              <ArtifactRow key={f.relpath} id={id} file={f} onPreview={onPreview} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 詳細画面（3 ペイン / モバイルはタブ）────────────────────────

type DetailTab = 'sources' | 'chat' | 'artifacts';

function NotebookDetailView({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const { data, error, loading, refetch } = useLiveResource<NotebookDetail>(`/api/notebooks/${id}`);
  const [tab, setTab] = useState<DetailTab>('sources');
  const [preview, setPreview] = useState<NotebookFileRef | null>(null);

  const detail = data && data.meta ? data : null;
  const sources = detail?.sources ?? [];
  const artifacts = detail?.artifacts ?? [];
  const chat = detail?.chat ?? [];
  const hasSources = sources.length > 0;

  const sourcesPane = (
    <SourcesPane id={id} sources={sources} onChanged={refetch} onPreview={setPreview} />
  );
  const chatPane = (
    <ChatPane id={id} chat={chat} hasSources={hasSources} onAnswered={refetch} />
  );
  const artifactsPane = (
    <ArtifactsPane
      id={id}
      artifacts={artifacts}
      hasSources={hasSources}
      onGenerated={refetch}
      onPreview={setPreview}
    />
  );

  const TABS: { key: DetailTab; label: string; count?: number }[] = [
    { key: 'sources', label: '資料', count: sources.length },
    { key: 'chat', label: 'チャット' },
    { key: 'artifacts', label: '生成物', count: artifacts.length },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={detail?.meta.name ?? 'ノートブック'}
        subtitle={detail ? `資料 ${sources.length}・生成物 ${artifacts.length}` : undefined}
        right={
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
          >
            一覧へ戻る
          </button>
        }
      />

      {/* モバイル: タブ切替 */}
      <div className="flex shrink-0 border-b border-border md:hidden" role="tablist" aria-label="ペイン切替">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 text-[10px] opacity-70">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        <ResourceState loading={loading} error={error} hasData={!!detail}>
          {detail && (
            <>
              {/* デスクトップ: 3 ペイン */}
              <div className="hidden h-full md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
                <div className="min-h-0 border-r border-border">{sourcesPane}</div>
                <div className="min-h-0 border-r border-border">{chatPane}</div>
                <div className="min-h-0">{artifactsPane}</div>
              </div>
              {/* モバイル: 選択タブのみ */}
              <div className="h-full md:hidden">
                {tab === 'sources' && sourcesPane}
                {tab === 'chat' && chatPane}
                {tab === 'artifacts' && artifactsPane}
              </div>
            </>
          )}
        </ResourceState>
      </div>

      {preview && <PreviewModal id={id} file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ─── 一覧画面 ─────────────────────────────────────────────

function CreateNotebook({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(() => {
    if (creating) return;
    setCreating(true);
    setError(null);
    fetch('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (res.ok && body.id) {
          setName('');
          onCreated(body.id);
        } else {
          setError(body.error || `作成に失敗しました（HTTP ${res.status}）。`);
        }
      })
      .catch(() => setError('ネットワークエラーで作成できませんでした。'))
      .finally(() => setCreating(false));
  }, [name, creating, onCreated]);

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              create();
            }
          }}
          disabled={creating}
          placeholder="新しいノートブックの名前（任意）…"
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity disabled:opacity-50"
        >
          {creating ? <Spinner /> : <PlusIcon width={15} height={15} />}
          ノートブックを作成
        </button>
      </div>
      {error && (
        <div role="alert" className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

function NotebookCard({
  nb,
  onOpen,
  onDeleted,
}: {
  nb: NotebookSummary;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(() => {
    setDeleting(true);
    setError(null);
    fetch(`/api/notebooks/${nb.id}`, { method: 'DELETE' })
      .then(async (res) => {
        if (res.ok) {
          onDeleted();
          return;
        }
        let msg = `削除に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* 既定メッセージ。 */
        }
        setError(msg);
        setDeleting(false);
        setConfirming(false);
      })
      .catch(() => {
        setError('ネットワークエラーで削除に失敗しました。');
        setDeleting(false);
        setConfirming(false);
      });
  }, [nb.id, onDeleted]);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-label={`${nb.name} を開く`}
        >
          <span className="shrink-0 text-accent">
            <NotebookIcon width={20} height={20} />
          </span>
          <span className="truncate text-sm font-semibold text-text" title={nb.name}>
            {nb.name}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${nb.name} を削除`}
          >
            <TrashIcon width={16} height={16} />
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label={`${nb.name} を開く`}
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </div>
      <button type="button" onClick={onOpen} className="mt-2 flex items-center gap-3 text-left text-xs text-text-faint">
        <span>資料 {nb.sourceCount}</span>
        <span>生成物 {nb.artifactCount}</span>
        <span>{relativeTime(nb.updatedAt)}</span>
      </button>

      {confirming && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3" role="alertdialog" aria-label="削除の確認">
          <p className="text-xs text-text">
            <span className="font-medium" title={nb.name}>
              {nb.name}
            </span>{' '}
            を削除しますか？資料と生成物もすべて削除されます。
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded-full px-3 py-1 text-xs text-text-muted hover:bg-surface-3 hover:text-text disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
              style={{ backgroundColor: 'var(--mc-stalled)' }}
            >
              <TrashIcon width={13} height={13} />
              {deleting ? '削除中…' : '削除する'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-1.5 text-xs" style={{ color: 'var(--mc-stalled)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

interface NotebooksListResponse {
  generatedAt?: string;
  notebooks?: NotebookSummary[];
  error?: string;
}

export default function Notebooks() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, error, loading, fetchedAt, refetch } =
    useLiveResource<NotebooksListResponse>('/api/notebooks');

  const notebooks = data?.notebooks ?? [];

  if (selectedId) {
    return (
      <NotebookDetailView
        id={selectedId}
        onBack={() => {
          setSelectedId(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="ノートブック"
        subtitle="資料をアップロードし、その内容を根拠に質問・要約・生成ができます"
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <CreateNotebook
          onCreated={(id) => {
            refetch();
            setSelectedId(id);
          }}
        />
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <>
              {notebooks.length === 0 ? (
                <EmptyState>まだノートブックがありません。上の入力欄から作成できます。</EmptyState>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {notebooks.map((nb) => (
                    <NotebookCard
                      key={nb.id}
                      nb={nb}
                      onOpen={() => setSelectedId(nb.id)}
                      onDeleted={refetch}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </ResourceState>
      </div>
    </div>
  );
}
