// ノートブック（NotebookLM 的な資料セット＋資料根拠 Q&A、MC-126 / MC-223 で Q&A 専用化）。
//
// 一覧画面: ノートブックの作成・選択・削除。
// 詳細画面: md+ は 2 ペイン（資料 / Q&A）、モバイルはタブ切替。
//   - 左 = 資料: アップロード（D&D＋選択、進捗バー）・一覧・プレビュー・削除。
//   - 右 = Q&A: 履歴（吹き出し）＋質問送信。回答の下に出典（使用ソース一覧）を表示する。
// 生成物作成（要約/FAQ/時系列/雛形/custom）は RAG と相性が悪いため MC-223 で撤去した。
//
// バックエンド API は全て auth 配下で Cookie mc_token が same-origin 自動付与される。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type {
  NotebookSummary,
  NotebookDetail,
  NotebookFileRef,
  NotebookSourceKind,
  MinutesType,
  MinutesFormat,
  MinutesPattern,
  MinutesPresetsResponse,
  MinutesTranscribeResponse,
  MinutesPatternsResponse,
  MinutesGenerateResponse,
  DeliverableFile,
  DeliverablesResponse,
  NotebookChatMessage,
  NotebookAskResponse,
  NotebookEngineErrorKind,
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
  SparkIcon,
  ChevronRightIcon,
  SheetIcon,
  SlidesIcon,
  PdfFileIcon,
  TextFileIcon,
  ImageFileIcon,
  FileIcon,
  FolderIcon,
  EditIcon,
  SendIcon,
  DocumentsIcon,
} from '../components/icons';
import { relativeTime } from '../lib/time';

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const OFFICE_KINDS = new Set<NotebookSourceKind>(['spreadsheet', 'presentation', 'document']);
const CSV_EXT = '.csv';

// エンジン失敗（上限/エラー）時のユーザー向けバナー文言（MC-202）。
function engineErrorMessage(kind: NotebookEngineErrorKind): string {
  return kind === 'model_limit'
    ? 'AI生成が一時的に利用上限に達しています。しばらく後に再試行してください。'
    : '生成に失敗しました。再試行してください。';
}

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

// ─── 議事録の生成ファイル用プレビューモーダル（PDF/Office=iframe / 画像=img / text・md=iframe）──
// notebook / deliverables どちらのファイルURLでも使えるよう src を直接受け取る。

function MinutesPreviewModal({
  file,
  src,
  onClose,
}: {
  file: GeneratedFile;
  src: string;
  onClose: () => void;
}) {
  const asImage = isMinutesImageFile(file.ext);
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
            <img src={src} alt={file.name} className="max-h-full max-w-full rounded" />
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-faint">
              プレビューを生成しています…
            </div>
            <iframe src={src} title={`${file.name} プレビュー`} className="relative h-full w-full" />
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

// ─── ファイルビューア（引用クリックで開くスライドオーバー）──────────────

interface FileViewerState {
  notebookId: string;
  filename: string; // ファイル名のみ（"sources/" なし）
  page?: string;    // ページ番号またはシート名
}

/** 認証が必要なファイルを Blob URL 経由で iframe に渡すビューア。 */
function NotebookFileViewer({
  notebookId,
  filename,
  page,
  onClose,
}: FileViewerState & { onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);

    const apiPath = `/api/notebooks/${notebookId}/file?path=${encodeURIComponent('sources/' + filename)}&inline=1`;
    fetch(apiPath)
      .then(async (res) => {
        if (!res.ok) {
          const msg = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(msg);
        }
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        const withPage = page ? `${objectUrl}#page=${encodeURIComponent(page)}` : objectUrl;
        setBlobUrl(withPage);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [notebookId, filename, page]);

  const displayName = page ? `${filename}  p.${page}` : filename;

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-bg shadow-2xl md:w-2/3 lg:w-1/2"
      role="dialog"
      aria-modal
      aria-label={`${displayName} ビューア`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="truncate text-sm font-medium text-text" title={displayName}>
          {displayName}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
          aria-label="ビューアを閉じる"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">
            <Spinner />
            <span className="ml-2">読み込み中…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-sm" style={{ color: 'var(--mc-stalled)' }}>
            ファイルの読み込みに失敗しました: {error}
          </div>
        )}
        {blobUrl && (
          <iframe
            src={blobUrl}
            title={displayName}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  );
}

// ─── 引用タグパーサ ───────────────────────────────────────

interface CitePart {
  type: 'text' | 'cite';
  text: string;
  filename?: string;
  page?: string;
}

function parseCites(text: string): CitePart[] {
  const parts: CitePart[] = [];
  const re = /\{\{cite:([^}:]+?)(?::([^}]*))?\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', text: text.slice(last, m.index) });
    }
    parts.push({
      type: 'cite',
      text: m[0],
      filename: m[1],
      page: m[2] || undefined,
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'text', text: text.slice(last) });
  }
  return parts;
}

// ─── チャットペイン ───────────────────────────────────────

function ChatBubble({
  msg,
  onCite,
}: {
  msg: NotebookChatMessage;
  onCite?: (filename: string, page?: string) => void;
}) {
  const isUser = msg.role === 'user';
  const parts = isUser ? null : parseCites(msg.text);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${
          isUser ? 'rounded-br-sm bg-accent text-bg' : 'rounded-bl-sm bg-surface-2 text-text'
        }`}
      >
        {isUser || !parts ? (
          <span className="whitespace-pre-wrap">{msg.text}</span>
        ) : (
          <span className="whitespace-pre-wrap">
            {parts.map((p, i) => {
              if (p.type === 'text') return <span key={i}>{p.text}</span>;
              const label = p.page ? `${p.filename} p.${p.page}` : p.filename!;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onCite?.(p.filename!, p.page)}
                  className="mx-0.5 inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                  title={`${label} を開く`}
                >
                  {label}
                </button>
              );
            })}
          </span>
        )}
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
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState(false);
  // 直近の回答が根拠に使ったソースファイル名一覧（出典表示用、MC-223）。
  const [lastSources, setLastSources] = useState<string[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewer, setViewer] = useState<FileViewerState | null>(null);
  // このマウント中に asking が true になったことを記録。
  // 正常 ask フロー後に refetch 完了前のわずかな間で pendingAnswer が立つのを防ぐ。
  const hasBeenAskingRef = useRef(false);

  const handleCite = useCallback((filename: string, page?: string) => {
    setViewer({ notebookId: id, filename, page });
  }, [id]);

  useEffect(() => {
    if (asking) {
      hasBeenAskingRef.current = true;
      setPendingAnswer(false);
      return;
    }
    const last = chat.at(-1);
    // hasBeenAskingRef が true の場合は正常 ask フロー後なので pendingAnswer を立てない。
    // false の場合（画面遷移復帰など）のみ resume 用の pendingAnswer をセット。
    if (last && last.role === 'user' && !hasBeenAskingRef.current) {
      setPendingAnswer(true);
    } else {
      setPendingAnswer(false);
    }
  }, [chat, asking]);

  useEffect(() => {
    if (!pendingAnswer) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    pollingRef.current = setInterval(() => {
      fetch(`/api/notebooks/${id}`)
        .then((res) => res.json().catch(() => null))
        .then((data: { chat?: NotebookChatMessage[] } | null) => {
          if (!data) return;
          const msgs = data.chat ?? [];
          const last = msgs.at(-1);
          if (last && last.role === 'assistant') {
            onAnswered();
            setPendingAnswer(false);
          }
        })
        .catch(() => {});
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [pendingAnswer, id, onAnswered]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, asking, pendingQuestion, pendingAnswer]);

  const submit = useCallback(() => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    setPendingQuestion(q);
    setLastSources([]);
    setQuestion('');
    fetch(`/api/notebooks/${id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as NotebookAskResponse;
        setPendingQuestion(null); // refetch 前に消して2重表示を防ぐ
        if (!res.ok) {
          setError(body.error || `回答の取得に失敗しました（HTTP ${res.status}）。`);
        } else if (body.errorKind) {
          // エンジン失敗（上限/エラー）: 生エラー文字列ではなくバナー文言を表示。
          setError(engineErrorMessage(body.errorKind));
        } else if (body.error && !body.answer) {
          setError(body.error);
        } else if (body.error) {
          setError('回答が途中で打ち切られた可能性があります。');
        }
        // 出典（使用ソース）を保持して回答の下に表示する（MC-223）。
        if (res.ok && !body.errorKind && body.metadata?.sources) {
          setLastSources(body.metadata.sources);
        }
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
        Q&amp;A
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
              <ChatBubble key={`${m.ts}-${i}`} msg={m} onCite={handleCite} />
            ))}
            {/* 直近回答の出典（使用ソース一覧）。回答が最新の assistant メッセージのときのみ表示。 */}
            {!asking && !pendingAnswer && !pendingQuestion &&
              lastSources.length > 0 &&
              chat.at(-1)?.role === 'assistant' && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-[11px] text-text-faint">
                    <span className="font-medium text-text-muted">出典: </span>
                    {lastSources.join(', ')}
                  </div>
                </div>
              )}
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
            {!asking && pendingAnswer && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-text-muted">
                  <Spinner />
                  回答を生成中…
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
      {viewer && (
        <NotebookFileViewer
          notebookId={viewer.notebookId}
          filename={viewer.filename}
          page={viewer.page}
          onClose={() => setViewer(null)}
        />
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
  onCollapse,
}: {
  id: string;
  sources: NotebookFileRef[];
  onChanged: () => void;
  onPreview: (file: NotebookFileRef) => void;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        <span>
          資料 <span className="ml-1 text-text-muted">{sources.length}</span>
        </span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="資料を閉じる"
            aria-expanded={true}
            className="rounded p-0.5 text-text-faint hover:bg-surface-2 hover:text-text"
          >
            <ChevronRightIcon width={16} height={16} style={{ transform: 'rotate(180deg)' }} />
          </button>
        )}
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


// ─── 議事録スタイル定義 ─────────────────────────────────────

type ExportFmt = 'docx' | 'xlsx' | 'pdf' | 'txt';

// 生成APIが返した出力ファイル 1 件（議事録md + エクスポートした docx/pdf/xlsx/txt）。
type GeneratedFile = {
  name: string;
  relpath: string;
  sizeBytes: number;
  ext: string; // '.docx' 等（先頭ドット付き）
};

function extOfName(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

// 履歴一覧の 1 件（GET /api/minutes/history）。
type MinutesHistoryItem = {
  folderRelpath: string;
  folderName: string;
  title: string;
  date: string;
  mtime: string;
};

// 履歴 1 件の復元情報（GET /api/minutes/history/:folder）。
type MinutesHistoryDetail = {
  folderRelpath: string;
  title: string;
  inputText: string;
  styles: string[];
  exportFormats: string[];
  attachments: Array<{ name: string; relpath: string; sizeBytes: number; ext: string }>;
};

// 履歴から復元したサーバ上の既存添付（再生成で再利用 or 除外を選べる）。
type RestoredAttachment = {
  name: string;
  relpath: string;
  sizeBytes: number;
  ext: string;
  keep: boolean; // false なら再生成時に除外（excludeSources に入れる）
};

// 議事録の成果物ファイルが inline プレビュー（iframe / img）で見られるか。
// docx/xlsx/pptx はサーバ側で PDF 変換して inline=1 で返るためプレビュー可。
const MINUTES_PREVIEWABLE_EXTS = new Set([
  '.pdf', '.md', '.txt', '.csv',
  '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
]);
function isMinutesFilePreviewable(ext: string): boolean {
  return MINUTES_PREVIEWABLE_EXTS.has(ext.toLowerCase());
}
function isMinutesImageFile(ext: string): boolean {
  return IMG_EXTS.has(ext.toLowerCase());
}

const MINUTES_STYLES = [
  {
    id: 'standard',
    label: '標準',
    emoji: '⭐',
    desc: '会議名・日時・参加者(部署/役職)・TODO表(タスク/内容)・議題一覧(決定事項併記)・各議題の要点・保留・次回までを網羅した標準書式',
    type: 'decisions' as MinutesType,
    format: 'sections' as MinutesFormat,
    sample: `# 第1回 プロジェクト定例

**開催日時：** 2025年4月10日（木）14:00〜15:00
**場所：** 本社 3F 第一会議室

## 出席者・欠席者

**出席者：**
- 開発部 部長　田中
- 営業部 課長　山田

**欠席者：**
- 総務部 担当　鈴木

## TODO・アクション項目

| No. | タスク | 内容 | 担当者 | 期限 |
|-----|--------|------|--------|------|
| 1 | 仕様書更新 | 最新要件を反映し改訂・共有します | 山田 | 05/20 |
| 2 | ベンダー確認 | 納期と費用をベンダーに確認します | 田中 | 05/15 |

## 議題一覧

1. 開発進捗について — 決定事項：来週までに回復策を提示することとなりました。
2. リリース計画について — 決定事項：リリース日は5月末で確定としました。
3. その他 — 決定事項：なし

<!-- pagebreak -->

## 各議題の要点

### 議題1：開発進捗について
**要点：** 進捗は予定比80%で、一部に遅延リスクがあります。

### 議題2：リリース計画について
**要点：** 5月末のリリース日について議論しました。

## 保留事項

- 予算超過の懸念は、次回以降に持ち越しとなりました。

## 次回会議予定

**日時：** 2025年4月17日（木）14:00〜
**議題（案）：** 回復策の進捗確認`,
    extraInstructions: `必ず以下の Markdown 形式そのままで議事録を出力してください。見出し・表の構造を変えず、絵文字を付けないこと。各項目は丁寧体（です・ます調）で記述してください。

# {会議名}

**開催日時：** YYYY年MM月DD日（曜日）HH:mm〜HH:mm
**場所：** （会議室名 / オンライン。不明なら「（記載なし）」）

## 出席者・欠席者

**出席者：**
- （部署） （役職）　（氏名）
- （部署） （役職）　（氏名）

**欠席者：**
- （部署） （役職）　（氏名。いなければ「なし」）

## TODO・アクション項目

| No. | タスク | 内容 | 担当者 | 期限 |
|-----|--------|------|--------|------|
| 1 | （タスク名。短い名詞句） | （作業内容を1文程度で簡潔に） | （担当者） | （MM/DD。不明なら「未定」） |
| 2 | （タスク名。短い名詞句） | （作業内容を1文程度で簡潔に） | （担当者） | （MM/DD。不明なら「未定」） |

## 議題一覧

1. （議題1） — 決定事項：（その議題の決定内容。なければ「なし」）
2. （議題2） — 決定事項：（その議題の決定内容。なければ「なし」）
3. その他 — 決定事項：（決定内容。なければ「なし」）

<!-- pagebreak -->

## 各議題の要点

### 議題1：（タイトル）
**要点：** （議論の要点）

### 議題2：（タイトル）
**要点：** （議論の要点）

## 保留事項

- （保留事項と理由。なければ「特になし」）

## 次回会議予定

**日時：** （YYYY年MM月DD日（曜日）HH:mm〜。不明なら「未定」）
**議題（案）：** （次回の主な議題。不明なら「未定」）

注意:
- 上記8セクション（会議名／開催日時・場所／出席者・欠席者／TODO・アクション項目／議題一覧／各議題の要点／保留事項／次回会議予定）の順序と見出しを変えないこと。
- 出席者・欠席者は可能な限り部署・役職も記載すること。
- TODO は「No. / タスク / 内容 / 担当者 / 期限」の5列表とし、ヘッダー行・区切り行（|---|）を省略しないこと。「タスク」はタスク内容を端的に表す短い名詞句、「内容」は作業内容の要点を1文程度で簡潔・コンパクトに記述すること（冗長に書かない）。
- 議題一覧は番号付きリスト（1. 2. 3.）とし、各議題の末尾に「 — 決定事項：…」の形でその議題の決定事項を併記すること（決定が無い場合は「決定事項：なし」）。
- 「各議題の要点」セクションには決定事項を書かず、各議題の要点本文のみを記載すること（決定事項は議題一覧へ併記済み）。
- 「## 各議題の要点」の直前に必ず「<!-- pagebreak -->」を実際に出力すること（このコメントは改ページとして処理されます。省略しないこと）。
- 見出しに絵文字を付けないこと。`,
  },
  {
    id: 'form',
    label: 'フォーム形式',
    emoji: '📋',
    desc: '会議名・日時・場所・出席者などをテーブル枠で整理した正式書式',
    type: 'decisions' as MinutesType,
    format: 'sections' as MinutesFormat,
    sample: `## 会議議事録

| 項目 | 内容 |
|------|------|
| 会議名 | 第1回 プロジェクト定例 |
| 開催日時 | 2025年4月10日 14:00〜15:00 |
| 開催場所 | 本社 3F 第一会議室 |
| 出席者 | 田中、山田、鈴木 |

### 議題
1. 進捗確認
2. 次期リリース計画

### 議事内容
…（各議題の討議内容）

### 合意事項・決定事項
- リリース日を5月末に決定
- 担当割り振りは山田が調整

### 次回会議
| 日時 | 場所 |
|------|------|
| 5月15日 14:00 | 本社 3F |`,
    extraInstructions: `必ず以下の Markdown 形式そのままで議事録を出力してください。見出しや表の構造を変更したり、絵文字を追加してはいけません。

## 会議議事録

| 項目 | 内容 |
|------|------|
| 会議名 | （テキストから読み取る） |
| 開催日時 | （テキストから読み取る） |
| 開催場所 | （テキストから読み取る） |
| 司会 | （テキストから読み取る、不明なら「（記載なし）」） |
| 書記 | （テキストから読み取る、不明なら「（記載なし）」） |
| 出席者 | （テキストから読み取る） |
| 欠席者 | （テキストから読み取る、いなければ「なし」） |

### 議題
1. （議題1）
2. （議題2）

### 議事内容
（各議題の討議内容を「【議題1】…」「【議題2】…」のように記載）

### 合意事項・決定事項
- （決定した事項を箇条書きで列挙）

### 次回会議

| 日時 | 場所 |
|------|------|
| （日時、不明なら「未定」） | （場所、不明なら「未定」） |

注意: 見出しに絵文字（📋 等）を付けないこと。表のヘッダー行・区切り行（|---|）を省略しないこと。`,
  },
  {
    id: 'label',
    label: 'ラベル形式',
    emoji: '🏷',
    desc: '【標題】【日時】などのラベルブロックで区切る視認性重視の書式',
    type: 'decisions' as MinutesType,
    format: 'markdown' as MinutesFormat,
    sample: `**【標題】** ○○開発部 役員級会議

**【日時】** 2025年7月1日（火）13:00〜14:30

**【場所】** 本社 3階 第一会議室

**【出席者】** 田中専務、山田部長、鈴木リーダー（※）

**【議題】**
1. ○○開発の進捗確認
2. 新規開発提案

**【議決事項】**
- 議題1：遅延回復策を提案通り承認
- 議題2：次回会議までに部内調査

**【議事】**
…（各議題の審議内容）

**【所見】**
…（特記コメント）`,
    extraInstructions: `必ず以下のラベルブロック形式そのままで議事録を出力してください。各ラベルは「**【ラベル】**」の太字で始め、絵文字は付けないこと。

**【標題】** （会議名と目的を1行で）

**【日時】** （開催日時）

**【場所】** （開催場所）

**【出席者】** （氏名（役職）をカンマ区切りで。※は欠席を表す）

**【議題】**
1. （議題1）
2. （議題2）

**【議決事項】**
- 議題1：（決定内容）
- 議題2：（決定内容）

**【議事】**
（各議題の審議内容・発言要旨を段落形式で）

**【所見】**
（特記事項・コメント。特になければ「特になし」）

注意: 上記のラベル（標題/日時/場所/出席者/議題/議決事項/議事/所見）以外の見出しや絵文字を追加しないこと。`,
  },
  {
    id: 'report',
    label: 'レポート形式',
    emoji: '📄',
    desc: '前回報告・議題ごとセクション・次回予定を含む報告書スタイル',
    type: 'summary' as MinutesType,
    format: 'sections' as MinutesFormat,
    sample: `# 第1回 衛生委員会 議事録

- 開催日：2025年4月10日
- 時間：14:00〜15:00
- 開催場所：本社 3階会議室
- 出席者：石野、山本、福田

---

## 1. 前回議事録の確認
特になし

## 2. 報告事項
### 健康診断結果
- 受診者：○件
- 通常扱い：○件

## 3. 議事
### 議題1：時間外労働について
…（討議内容・結論）

## 4. その他
次回議題の提案を事前に提出すること

---

**次回会議予定**
- 日時：5月14日 14:00〜
- 場所：本社 3階会議室`,
    extraInstructions: `必ず以下のレポート形式そのままで議事録を出力してください。見出しの番号構造（## 1.〜## 4.）を維持し、絵文字は付けないこと。

# 第○回 [会議名] 議事録

- 開催日：（日付）
- 時間：（開始〜終了）
- 開催場所：（場所）
- 出席者：（氏名リスト）

---

## 1. 前回議事録の確認
（前回からの積み残し・報告事項。特になければ「特になし」）

## 2. 報告事項
（各報告項目を「### 小見出し」で整理）

## 3. 議事
### 議題1：（タイトル）
（内容・討議・結論を文章体で記述）

### 議題2：（タイトル）
（内容・討議・結論を文章体で記述）

## 4. その他
（その他の共有事項。なければ「特になし」）

---

**次回会議予定**
- 日時：（日時、不明なら「未定」）
- 場所：（場所、不明なら「未定」）

注意: 各項目は文章体（です・ます調）で記述すること。見出しに絵文字を付けないこと。`,
  },
  {
    id: 'action',
    label: 'アクション重視',
    emoji: '✅',
    desc: 'ネクストアクションと担当者が一目でわかる実務形式',
    type: 'decisions' as MinutesType,
    format: 'markdown' as MinutesFormat,
    sample: `## アクションリスト

| No | アクション | 担当者 | 期限 | ステータス |
|----|-----------|--------|------|-----------|
| 1 | 仕様書更新 | 山田 | 5/20 | 未着手 |
| 2 | ベンダー確認 | 鈴木 | 5/15 | 進行中 |

## 決定事項
- リリース日：5月末に確定
- 予算：300万円の枠で進める

## 議論の要点
…（主な議論の概要）`,
    extraInstructions: `必ず以下の形式そのままで議事録を出力してください。先頭にアクションリストの表を置き、絵文字は付けないこと。

## アクションリスト

| No | アクション | 担当者 | 期限 | ステータス |
|----|-----------|--------|------|-----------|
| 1 | （やること） | （担当者） | （期限） | 未着手 |
| 2 | （やること） | （担当者） | （期限） | 進行中 |

## 決定事項
- （決定した事項を箇条書きで列挙）

## 議論の要点
（主な議論の概要を簡潔に文章で記述）

注意: アクション表は「No / アクション / 担当者 / 期限 / ステータス」の5列を必ず維持し、ヘッダー行と区切り行（|---|）を省略しないこと。担当者・期限が不明な場合は「未定」と記載すること。`,
  },
  {
    id: 'summary',
    label: '要点サマリー',
    emoji: '💡',
    desc: '要点を箇条書きで簡潔にまとめたコンパクト形式',
    type: 'summary' as MinutesType,
    format: 'markdown' as MinutesFormat,
    sample: `## 会議サマリー（2025/04/10）

### 結論・決定事項
- 新機能のリリースを5月末に決定
- 担当は山田が主導、鈴木がサポート

### 主な議論ポイント
- 現状の進捗は予定比80%、遅延リスクあり
- 予算超過の懸念は次回以降に持ち越し

### ネクストアクション
- 山田：仕様書更新（5/20まで）
- 鈴木：ベンダー調整（5/15まで）`,
    extraInstructions: `必ず以下の形式そのままで、コンパクトな要約議事録を出力してください。絵文字は付けないこと。

## 会議サマリー（（日付））

### 結論・決定事項
- （決定した事項を箇条書きで、最大5項目）

### 主な議論ポイント
- （主な論点を箇条書きで、最大5項目）

### ネクストアクション
- （担当者）：（やること）（期限）

注意: 全体を3〜5分で読み切れる分量にし、各セクションは箇条書き中心にすること。長い文章や余計な見出しを追加しないこと。見出しに絵文字を付けないこと。`,
  },
  {
    id: 'casual',
    label: 'カジュアルメモ',
    emoji: '💬',
    desc: '話し言葉を活かした社内向けライトな記録',
    type: 'summary' as MinutesType,
    format: 'plain' as MinutesFormat,
    sample: `📅 4/10 プロジェクト定例メモ

参加：田中・山田・鈴木

今日の主な話
- 進捗は80%くらい、少し遅れ気味。来週リカバリ策を山田さんが持ってくる
- 5月末リリースは変えない方針で合意
- 予算の件は次回に持ち越し

やること
- 山田：仕様書更新 → 5/20
- 鈴木：ベンダー確認 → 5/15

次回：5/14（水）14:00〜 同じ部屋で`,
    extraInstructions: `必ず以下の形式そのままで、カジュアルな箇条書きメモを出力してください。社内Slackに貼るようなライトなトーンで、堅い敬語は不要です。

📅 （日付） （会議名）メモ

参加：（参加者を「・」区切りで）

今日の主な話
- （話したことを箇条書きで）
- （話したことを箇条書きで）

やること
- （担当者）：（やること） → （期限）

次回：（日時・場所）

注意: 上記の見出し（今日の主な話／やること／次回）の構成を維持すること。冒頭の📅以外に絵文字を多用しないこと。Markdownの表や##見出しは使わず、プレーンな箇条書きで書くこと。`,
  },
  {
    id: 'exec2page',
    label: '実務2ページ',
    emoji: '📊',
    desc: '1ページ目にアクション・決定・共有、2ページ目に議題別発言まとめ',
    type: 'decisions' as MinutesType,
    format: 'sections' as MinutesFormat,
    sample: `## アクションアイテム（TODO）

| No | タスク | 担当 | 期限 | ステータス | 関連議題 |
|----|--------|------|------|-----------|---------|
| 1 | 仕様書更新 | 山田 | 5/20 | 未着手 | 議題1 |
| 2 | ベンダー確認 | 鈴木 | 5/15 | 未着手 | 議題2 |

## 決定事項

- リリース日を5月末に決定（議題1）
- 予算は300万円の枠で進める（議題2）

## 共有事項

- 次回は全員参加必須（オンライン可）
- 資料は前日17:00までに共有

---

*（2ページ目）*

## 議題別 主要発言

### 議題1：開発進捗について
アクション：#1 ／ 決定：リリース日5月末

（各発言者の主な発言・議論の要旨）

### 議題2：リリース計画
アクション：#2 ／ 決定：予算300万円

（各発言者の主な発言・議論の要旨）`,
    extraInstructions: `必ず以下の2ページ構成で議事録を出力してください。「<!-- pagebreak -->」は実際に出力してください（ページ区切りとして処理されます）。

## アクションアイテム（TODO）

| No | タスク | 担当 | 期限 | ステータス | 関連議題 |
|----|--------|------|------|-----------|---------|
| 1 | （やること） | （担当者） | （期限） | 未着手 | 議題X |

## 決定事項

- （決定事項）（議題X）

## 共有事項

- （共有・連絡事項を箇条書きで）

<!-- pagebreak -->

## 議題別 主要発言

### 議題1：（議題タイトル）
アクション：#N（なければ省略） ／ 決定：（決定内容、なければ省略）

（発言者名と主な発言内容・議論の流れを段落形式で。意見の相違・結論に至った経緯も含める）

### 議題2：（議題タイトル）
アクション：#N ／ 決定：（内容）

（同上）

注意:
- 1ページ目（アクション・決定・共有）は情報を凝縮してA4 1枚に収まる分量にすること
- 「<!-- pagebreak -->」は必ずそのまま出力すること（省略・変更不可）
- 見出しに絵文字を付けないこと
- アクション表の「関連議題」列で各アクションをどの議題に由来するか明示すること
- 決定事項の末尾に（議題X）で出典議題を付記すること
- 2ページ目の各議題見出し直下に「アクション：#N ／ 決定：〜」の参照行を入れること`,
  },
] as const;

// 各スタイルの sample（Markdown / プレーンテキスト）をそのまま簡易レンダリングする。
// プレビュー＝生成物のサンプル、という単一の真実の源にするため JSX ハードコードは廃止。
function renderSampleInline(text: string, keyBase: string): Array<JSX.Element | string> {
  // **bold** のみ簡易対応
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== '');
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <strong key={`${keyBase}-b${i}`} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return p;
  });
}

function StylePreviewPanel({ styleId }: { styleId: string }) {
  const style = MINUTES_STYLES.find((s) => s.id === styleId);
  if (!style) return null;
  const lines = style.sample.split('\n');

  const td = 'border border-[#ccc] px-2 py-1 text-[11px] text-[#222] align-top';
  const thCell = 'border border-[#ccc] bg-[#f0f0f0] px-2 py-1 text-[11px] font-semibold text-[#333] align-top';

  const blocks: JSX.Element[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行
    if (trimmed === '') {
      i += 1;
      continue;
    }

    // 水平線
    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${key++}`} className="my-2 border-[#ddd]" />);
      i += 1;
      continue;
    }

    // 表（| で始まる連続行）
    if (trimmed.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      const rows = tableLines
        .filter((r) => !/^\|[\s|:-]+\|?$/.test(r)) // 区切り行（|---|）を除外
        .map((r) =>
          r
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim()),
        );
      // 1行目をヘッダー扱い
      const [head, ...body] = rows;
      blocks.push(
        <table key={`tbl-${key++}`} className="my-1 w-full border-collapse">
          {head && (
            <thead>
              <tr>
                {head.map((c, ci) => (
                  <th key={ci} className={thCell}>
                    {renderSampleInline(c, `th-${key}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                {row.map((c, ci) => (
                  <td key={ci} className={td}>
                    {renderSampleInline(c, `td-${key}-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // 見出し（#, ##, ###）
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls =
        level <= 1
          ? 'mt-1 mb-1 text-[13px] font-bold text-[#222]'
          : level === 2
            ? 'mt-2 mb-0.5 text-[12px] font-bold text-[#333]'
            : 'mt-1.5 mb-0.5 text-[11px] font-semibold text-[#444]';
      blocks.push(
        <p key={`h-${key++}`} className={cls}>
          {renderSampleInline(headingMatch[2], `h-${key}`)}
        </p>,
      );
      i += 1;
      continue;
    }

    // リスト（-, *, 1.）の連続
    if (/^([-*]|\d+\.)\s+/.test(trimmed)) {
      const items: string[] = [];
      const ordered = /^\d+\.\s+/.test(trimmed);
      while (i < lines.length && /^([-*]|\d+\.)\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^([-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const listCls = 'my-1 ml-4 text-[11px] text-[#444] ' + (ordered ? 'list-decimal' : 'list-disc');
      blocks.push(
        <ul key={`ul-${key++}`} className={listCls}>
          {items.map((it, ii) => (
            <li key={ii} className="mb-0.5">
              {renderSampleInline(it, `li-${key}-${ii}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // 通常段落
    blocks.push(
      <p key={`p-${key++}`} className="my-0.5 text-[11px] leading-relaxed text-[#444]">
        {renderSampleInline(trimmed, `p-${key}`)}
      </p>,
    );
    i += 1;
  }

  return (
    <div className="rounded bg-white p-3" style={{ color: '#222' }}>
      {blocks}
    </div>
  );
}

const EXPORT_OPTS = [
  { fmt: 'docx' as ExportFmt, label: 'Word', icon: '📄' },
  { fmt: 'xlsx' as ExportFmt, label: 'Excel', icon: '📊' },
  { fmt: 'pdf' as ExportFmt, label: 'PDF', icon: '📕' },
  { fmt: 'txt' as ExportFmt, label: 'テキスト', icon: '📝' },
] as const;

// ─── Apollo（Deliverables）ファイル選択モーダル ─────────────────────

// 選択可能な拡張子（テキスト系・音声・PDF・Word）。画像・フォルダは選択不可。
const DELIVERABLE_SELECTABLE_EXTS = new Set([
  '.txt', '.md', '.csv',
  '.mp3', '.wav', '.m4a', '.ogg',
  '.pdf',
  '.docx',
]);

function deliverableSelectable(df: DeliverableFile): boolean {
  if (df.isDir || df.kind === 'folder') return false;
  return DELIVERABLE_SELECTABLE_EXTS.has((df.ext || '').toLowerCase());
}

interface DeliverableTreeNode {
  name: string;
  path: string; // この階層までの posix パス（ディレクトリ用）
  dirs: Map<string, DeliverableTreeNode>;
  files: DeliverableFile[];
}

function buildDeliverableTree(files: DeliverableFile[]): DeliverableTreeNode {
  const root: DeliverableTreeNode = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.relpath.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    // 末尾以外はディレクトリ。
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let child = node.dirs.get(seg);
      if (!child) {
        child = { name: seg, path: node.path ? `${node.path}/${seg}` : seg, dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
      }
      node = child;
    }
    if (f.isDir || f.kind === 'folder') {
      // 空ディレクトリのエントリ: ディレクトリノードとして登録。
      const seg = parts[parts.length - 1];
      if (!node.dirs.has(seg)) {
        node.dirs.set(seg, { name: seg, path: f.relpath, dirs: new Map(), files: [] });
      }
    } else {
      node.files.push(f);
    }
  }
  return root;
}

function DeliverableTreeRows({
  node,
  depth,
  collapsed,
  toggle,
  onPick,
  disabled,
}: {
  node: DeliverableTreeNode;
  depth: number;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  onPick: (df: DeliverableFile) => void;
  disabled: boolean;
}) {
  const dirs = Array.from(node.dirs.values()).sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {dirs.map((dir) => {
        const isCollapsed = collapsed.has(dir.path);
        return (
          <div key={`d:${dir.path}`}>
            <button
              type="button"
              onClick={() => toggle(dir.path)}
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-text hover:bg-surface-2"
              style={{ paddingLeft: depth * 14 + 6 }}
            >
              <ChevronRightIcon
                width={12}
                height={12}
                className="shrink-0 text-text-faint"
                style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s' }}
              />
              <FolderIcon width={14} height={14} className="shrink-0 text-text-faint" />
              <span className="truncate font-medium">{dir.name}</span>
            </button>
            {!isCollapsed && (
              <DeliverableTreeRows
                node={dir}
                depth={depth + 1}
                collapsed={collapsed}
                toggle={toggle}
                onPick={onPick}
                disabled={disabled}
              />
            )}
          </div>
        );
      })}
      {files.map((f) => {
        const selectable = deliverableSelectable(f);
        return (
          <button
            key={`f:${f.relpath}`}
            type="button"
            disabled={!selectable || disabled}
            onClick={() => onPick(f)}
            title={selectable ? f.name : `${f.name}（選択できません）`}
            className={
              'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors ' +
              (selectable && !disabled
                ? 'text-text hover:bg-surface-2'
                : 'cursor-not-allowed text-text-faint opacity-50')
            }
            style={{ paddingLeft: depth * 14 + 6 + 16 }}
          >
            <span className="shrink-0 text-text-faint">
              <KindIcon kind={(f.kind === 'folder' ? 'other' : f.kind) as NotebookSourceKind} ext={f.ext} />
            </span>
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="shrink-0 text-[10px] text-text-faint">{humanReadableSize(f.sizeBytes)}</span>
          </button>
        );
      })}
    </>
  );
}

function DeliverablePickerModal({
  onClose,
  onPick,
  picking,
}: {
  onClose: () => void;
  onPick: (df: DeliverableFile) => void;
  picking: boolean;
}) {
  const [files, setFiles] = useState<DeliverableFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetch('/api/deliverables')
      .then((r) => r.json().catch(() => null))
      .then((data: DeliverablesResponse | null) => {
        if (!alive) return;
        if (data?.files) {
          setFiles(data.files);
          // 全フォルダを閉じた状態で開く
          const allDirs = new Set<string>();
          const collectDirs = (node: DeliverableTreeNode) => {
            for (const dir of node.dirs.values()) {
              allDirs.add(dir.path);
              collectDirs(dir);
            }
          };
          collectDirs(buildDeliverableTree(data.files));
          setCollapsed(allDirs);
        } else {
          setError(data?.error || '成果物の一覧を取得できませんでした。');
        }
      })
      .catch(() => { if (alive) setError('ネットワークエラーで成果物を取得できませんでした。'); });
    return () => { alive = false; };
  }, []);

  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  }, []);

  const tree = files ? buildDeliverableTree(files) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-3 backdrop-blur md:p-6"
      role="dialog"
      aria-modal
      aria-label="Apollo から資料を選択"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="text-sm font-semibold text-text">📁 Apollo から選択</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label="閉じる"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <p className="border-b border-border px-4 py-1.5 text-[11px] text-text-faint">
          テキスト（.txt/.md/.csv）・音声（.mp3/.wav/.m4a/.ogg）・PDF・Word（.docx）を選択できます。
        </p>
        <div className="relative flex-1 overflow-y-auto p-2">
          {picking && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/70">
              <span className="inline-flex items-center gap-2 text-xs text-text-muted"><Spinner />取り込み中…</span>
            </div>
          )}
          {error ? (
            <div role="alert" className="m-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs" style={{ color: 'var(--mc-stalled)' }}>
              {error}
            </div>
          ) : !tree ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-text-muted"><Spinner />読み込み中…</div>
          ) : tree.dirs.size === 0 && tree.files.length === 0 ? (
            <EmptyState>成果物がまだありません</EmptyState>
          ) : (
            <DeliverableTreeRows
              node={tree}
              depth={0}
              collapsed={collapsed}
              toggle={toggle}
              onPick={onPick}
              disabled={picking}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 議事録 履歴モーダル ─────────────────────────────────────
// 過去の議事録（議事録/ 直下のフォルダ）を新しい順で一覧し、選ぶと作成画面に読み込み直す。

function MinutesHistoryModal({
  items,
  loading,
  error,
  picking,
  onPick,
  onClose,
}: {
  items: MinutesHistoryItem[];
  loading: boolean;
  error: string | null;
  picking: boolean;
  onPick: (item: MinutesHistoryItem) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-3 backdrop-blur md:p-6"
      role="dialog"
      aria-modal
      aria-label="議事録の履歴"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="text-sm font-semibold text-text">🕘 議事録の履歴</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label="閉じる"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <p className="border-b border-border px-4 py-1.5 text-[11px] text-text-faint">
          選ぶと入力テキスト・スタイル・形式・添付を作成画面に復元します。
        </p>
        <div className="relative flex-1 overflow-y-auto p-2">
          {picking && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/70">
              <span className="inline-flex items-center gap-2 text-xs text-text-muted"><Spinner />読み込み中…</span>
            </div>
          )}
          {error ? (
            <div role="alert" className="m-2 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs" style={{ color: 'var(--mc-stalled)' }}>
              {error}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-text-muted"><Spinner />読み込み中…</div>
          ) : items.length === 0 ? (
            <EmptyState>過去の議事録がまだありません</EmptyState>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <li key={item.folderRelpath}>
                  <button
                    type="button"
                    onClick={() => onPick(item)}
                    disabled={picking}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-left transition-colors hover:border-accent/50 hover:bg-surface-2 disabled:opacity-50"
                  >
                    <FileIcon width={16} height={16} />
                    <span className="min-w-0 flex-1 truncate text-sm text-text" title={item.title}>
                      {item.title}
                    </span>
                    {item.date && (
                      <span className="shrink-0 text-[11px] text-text-faint">{item.date}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 議事録ペイン ─────────────────────────────────────────

export function MinutesPane({
  id,
  onGenerated,
  onBack,
  mode = 'notebook',
  notebookId,
  openHistoryOnMount = false,
}: {
  id: string;
  onGenerated: (relpath?: string) => void;
  onBack?: () => void;
  mode?: 'notebook' | 'deliverables';
  notebookId?: string;
  openHistoryOnMount?: boolean;
}) {
  // deliverables モードでは notebook id を使わず /api/minutes/* を叩く。
  // notebook モードでは従来どおり /api/notebooks/:id/minutes/* を叩く。
  const nbId = notebookId ?? id;
  const minutesBase = mode === 'deliverables' ? '/api/minutes' : `/api/notebooks/${nbId}/minutes`;
  const [presets, setPresets] = useState<MinutesPresetsResponse | null>(null);
  const [patterns, setPatterns] = useState<MinutesPattern[]>([]);
  const [, setLoadingPresets] = useState(true);
  const [inputMode, setInputMode] = useState<'text' | 'audio' | 'file'>('text');
  const [inputText, setInputText] = useState('');
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 添付を追加（テキスト抽出せず、そのまま sources/ に保存する元ファイル）用の input。
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  // Apollo（Deliverables）から選ぶモーダル
  const [showDeliverablePicker, setShowDeliverablePicker] = useState(false);
  const [loadingFromDeliverable, setLoadingFromDeliverable] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(() => new Set(['standard']));
  const [previewStyleId, setPreviewStyleId] = useState<string | null>(null);
  const [selectedExportFormats, setSelectedExportFormats] = useState<Set<ExportFmt>>(() => new Set<ExportFmt>(['docx']));
  // 生成後: 議事録mdの本文（ダウンロード・再生成のベースに使う。プレビュー描画には使わない）。
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  // 生成後: その回に出力したファイル群（議事録md + docx/pdf/xlsx/txt）。
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  // ファイルプレビュー対象（モーダル）。null で閉じる。
  const [previewFile, setPreviewFile] = useState<GeneratedFile | null>(null);
  const [selectedType, setSelectedType] = useState<MinutesType>('decisions');
  const [selectedFormat, setSelectedFormat] = useState<MinutesFormat>('sections');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedPatternId, setSelectedPatternId] = useState<string>('');
  const [patternName, setPatternName] = useState('');
  const [savingPattern, setSavingPattern] = useState(false);
  const [savePatternError, setSavePatternError] = useState<string | null>(null);
  const [showPatternSave, setShowPatternSave] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genPct, setGenPct] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [genReport, setGenReport] = useState<string | null>(null);
  // エクスポート（docx/pdf 等）が一部失敗した場合の警告。MD 保存は成功していても表示する。
  const [exportWarn, setExportWarn] = useState<string | null>(null);
  const [lastArtifact, setLastArtifact] = useState<{ relpath: string; name: string } | null>(null);
  // 入力に使った元ファイル（音声・テキスト・PDF など）。生成時に sources/ へ保存させる。
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  // ─── 履歴（過去議事録の読み込み直し / 再生成）─────────────────────
  // deliverables モードのみ対応（notebook モードには議事録/ 履歴 API が無い）。
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<MinutesHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistoryDetail, setLoadingHistoryDetail] = useState(false);
  // 履歴から復元したフォルダ relpath（再生成時に sources/ を流用する元）。null なら通常作成。
  const [reuseFolderRelpath, setReuseFolderRelpath] = useState<string | null>(null);
  // 復元された添付（サーバ上の既存 sources/）。keep=false にすると再生成で使わない（除外）。
  const [restoredAttachments, setRestoredAttachments] = useState<RestoredAttachment[]>([]);
  // 生成完了後はファイル一覧表示モードに遷移し、ダウンロード直行をやめる。
  const [previewMode, setPreviewMode] = useState(false);
  // フィードバック→再生成
  const [feedbackText, setFeedbackText] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  // ステップ進捗ラベル（アップロード→文字起こし→生成→完了）。
  const [genStage, setGenStage] = useState<string>('');
  // 生成後プレビューからの直接ダウンロード（事前指定フォーマット）。ダウンロード中の形式を保持する。
  const [downloadingFmt, setDownloadingFmt] = useState<ExportFmt | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/notebooks/minutes/presets')
      .then((r) => r.json().catch(() => null))
      .then((data: MinutesPresetsResponse | null) => {
        if (data) setPresets(data);
        setLoadingPresets(false);
      })
      .catch(() => setLoadingPresets(false));
    fetch('/api/notebooks/minutes/patterns')
      .then((r) => r.json().catch(() => null))
      .then((data: MinutesPatternsResponse | null) => {
        if (data?.patterns) setPatterns(data.patterns);
      })
      .catch(() => {});
  }, []);

  // 生成中、実際の progress イベントが来ない間も時間ベースで擬似的にバーを進める。
  // SSH ラッパー経由で claude stdout がバッファされ chunk が逐次来ないため、
  // sqrt カーブで最大95%まで自動増加させる。実 progress/done が来たらそちらが上書きする。
  useEffect(() => {
    if (!generating && !regenerating) return;
    const start = Date.now();
    const EXPECTED_MS = 120_000; // 想定 2 分
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(95, Math.round(Math.sqrt(elapsed / EXPECTED_MS) * 95));
      setGenPct((prev) => Math.max(prev, pct));
    }, 1000);
    return () => clearInterval(timer);
  }, [generating, regenerating]);

  const applyPattern = useCallback(
    (patId: string) => {
      setSelectedPatternId(patId);
      if (!patId) return;
      const pat = patterns.find((p) => p.id === patId);
      if (!pat) return;
      setSelectedType(pat.type as MinutesType);
      setSelectedFormat(pat.format as MinutesFormat);
      if (pat.instructions) setCustomInstructions(pat.instructions);
    },
    [patterns],
  );

  useEffect(() => {
    const preset = presets?.types.find((t) => t.type === selectedType);
    setSelectedTemplateId(preset?.templates[0]?.id ?? '');
  }, [selectedType, presets]);

  useEffect(() => {
    // 最初に選択されたスタイルの type/format を使う（複数選択時は最初の one を基準）
    const firstId = Array.from(selectedStyles)[0];
    const style = MINUTES_STYLES.find((s) => s.id === firstId);
    if (style) {
      setSelectedType(style.type);
      setSelectedFormat(style.format);
    }
  }, [selectedStyles]);

  const handleAudioFile = useCallback(
    (file: File) => {
      setTranscribing(true);
      setTranscribeError(null);
      const fd = new FormData();
      fd.append('audio', file);
      fetch(minutesBase + '/transcribe', { method: 'POST', body: fd })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as MinutesTranscribeResponse;
          if (res.ok && body.text) {
            setInputText(body.text);
            // 元ファイルを保持し、生成時に sources/ へ保存させる。
            setSourceFiles((prev) => [...prev, file]);
            setInputMode('text');
          } else {
            setTranscribeError(body.error || '文字起こしに失敗しました。');
          }
        })
        .catch(() => setTranscribeError('ネットワークエラーで文字起こしに失敗しました。'))
        .finally(() => setTranscribing(false));
    },
    [minutesBase],
  );

  const handleExtractFile = useCallback(
    (file: File) => {
      setExtracting(true);
      setExtractError(null);
      const fd = new FormData();
      fd.append('file', file);
      fetch(minutesBase + '/extract-file', { method: 'POST', body: fd })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
          if (res.ok && body.text) {
            setInputText(body.text);
            // 元ファイルを保持し、生成時に sources/ へ保存させる。
            setSourceFiles((prev) => [...prev, file]);
            setInputMode('text');
          } else {
            setExtractError(body.error || 'テキスト抽出に失敗しました。');
          }
        })
        .catch(() => setExtractError('ネットワークエラーでテキスト抽出に失敗しました。'))
        .finally(() => setExtracting(false));
    },
    [minutesBase],
  );

  // Apollo（Deliverables）のファイルを入力として取り込む。
  // 拡張子で分岐: テキスト系は内容を直接 inputText に、音声は文字起こし、PDF/Word/画像は抽出に回す。
  const handleDeliverablePick = useCallback(
    async (df: DeliverableFile) => {
      if (df.isDir) return;
      const ext = (df.ext || '').toLowerCase();
      setLoadingFromDeliverable(true);
      setTranscribeError(null);
      setExtractError(null);
      try {
        const url = `/api/deliverables/file?path=${encodeURIComponent(df.relpath)}&inline=1`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`ファイルの取得に失敗しました（HTTP ${res.status}）。`);
        const textLikeExts = ['.txt', '.md', '.csv'];
        const audioExts = ['.mp3', '.wav', '.m4a', '.ogg'];
        if (textLikeExts.includes(ext)) {
          const content = await res.text();
          setInputText(content);
          setInputMode('text');
          setShowDeliverablePicker(false);
        } else {
          const blob = await res.blob();
          const file = new File([blob], df.name, { type: blob.type || undefined });
          if (audioExts.includes(ext)) {
            handleAudioFile(file);
          } else {
            // PDF / Word（.docx）など → サーバ側でテキスト抽出。
            handleExtractFile(file);
          }
          setShowDeliverablePicker(false);
        }
      } catch (e) {
        setExtractError(e instanceof Error ? e.message : 'ファイルの取得に失敗しました。');
      } finally {
        setLoadingFromDeliverable(false);
      }
    },
    [handleAudioFile, handleExtractFile],
  );

  // 履歴一覧を取得してモーダルを開く（deliverables モードのみ）。
  const openHistory = useCallback(() => {
    if (mode !== 'deliverables') return;
    setShowHistory(true);
    setHistoryError(null);
    setHistoryLoading(true);
    fetch('/api/minutes/history')
      .then((r) => r.json().catch(() => null) as Promise<{ items?: MinutesHistoryItem[]; error?: string } | null>)
      .then((data) => {
        if (data?.items) setHistoryItems(data.items);
        else setHistoryError(data?.error || '履歴を取得できませんでした。');
      })
      .catch(() => setHistoryError('ネットワークエラーで履歴を取得できませんでした。'))
      .finally(() => setHistoryLoading(false));
  }, [mode]);

  // 入口（Deliverables）の「履歴」ボタンから開かれた場合、マウント後に一度だけ履歴モーダルを開く。
  const historyOnMountDone = useRef(false);
  useEffect(() => {
    if (historyOnMountDone.current) return;
    if (openHistoryOnMount && mode === 'deliverables') {
      historyOnMountDone.current = true;
      openHistory();
    }
  }, [openHistoryOnMount, mode, openHistory]);

  // 履歴 1 件を作成画面に読み込む（入力テキスト / スタイル / 形式 / 添付を復元）。
  const loadHistoryItem = useCallback(
    async (item: MinutesHistoryItem) => {
      setLoadingHistoryDetail(true);
      setHistoryError(null);
      try {
        const res = await fetch(`/api/minutes/history/${encodeURIComponent(item.folderName)}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `履歴の読み込みに失敗しました（HTTP ${res.status}）。`);
        }
        const detail = (await res.json()) as MinutesHistoryDetail;
        // 生成後プレビュー状態なら作成フォームへ戻してから復元する。
        setPreviewMode(false);
        setGeneratedContent(null);
        setGeneratedFiles([]);
        setLastArtifact(null);
        setGenError(null);
        setGenReport(null);
        setExportWarn(null);

        setInputText(detail.inputText);
        setInputMode('text');
        // スタイル復元（既知の id のみ。無ければ既定 standard）。
        const validStyles = detail.styles.filter((s) => MINUTES_STYLES.some((m) => m.id === s));
        setSelectedStyles(new Set(validStyles.length > 0 ? validStyles : ['standard']));
        // エクスポート形式復元（無ければ既定 docx）。
        const validFmts = detail.exportFormats.filter((f): f is ExportFmt =>
          EXPORT_OPTS.some((o) => o.fmt === f),
        );
        setSelectedExportFormats(new Set<ExportFmt>(validFmts.length > 0 ? validFmts : ['docx']));
        // 添付復元（サーバ上の既存 sources を再利用対象として保持）。
        setReuseFolderRelpath(detail.folderRelpath);
        setRestoredAttachments(
          detail.attachments.map((a) => ({ ...a, keep: true })),
        );
        // 新規アップロード分（File）はクリアして混同を避ける。
        setSourceFiles([]);
        setShowHistory(false);
      } catch (e) {
        setHistoryError(e instanceof Error ? e.message : '履歴の読み込みに失敗しました。');
      } finally {
        setLoadingHistoryDetail(false);
      }
    },
    [],
  );

  const runSingleGenerate = useCallback(
    async (
      styleId: string,
      opts?: { feedback?: string; previousContent?: string; attachSources?: boolean },
    ): Promise<{ relpath: string; name: string; files: GeneratedFile[] } | null> => {
      const style = MINUTES_STYLES.find((s) => s.id === styleId);
      const preset = presets?.types.find((t) => t.type === (style?.type ?? selectedType));
      const tmpl = preset?.templates.find((t) => t.id === selectedTemplateId);
      const mergedInstructions = [style?.extraInstructions, customInstructions.trim()]
        .filter(Boolean)
        .join('\n');

      // この回が当該生成の 1 スタイル目か（添付・履歴流用は 1 回目だけ反映して重複保存を避ける）。
      const isFirst = !!opts?.attachSources;
      // 履歴から復元した既存添付のうち keep=true のものを流用、keep=false は除外する。
      const reuseFrom = isFirst ? reuseFolderRelpath : null;
      const excludeNames = isFirst
        ? restoredAttachments.filter((a) => !a.keep).map((a) => a.name)
        : [];
      const stylesArr = [...selectedStyles];
      // 新規アップロード添付があるか、または履歴 sources を流用するなら multipart で送る。
      const useMultipart = isFirst && (sourceFiles.length > 0 || !!reuseFrom);
      let res: Response;
      if (useMultipart) {
        const fd = new FormData();
        fd.append('inputText', inputText.trim());
        fd.append('type', String(style?.type ?? selectedType));
        fd.append('format', String(style?.format ?? selectedFormat));
        if (selectedTemplateId) fd.append('templateId', selectedTemplateId);
        if (tmpl?.body) fd.append('templateBody', tmpl.body);
        if (mergedInstructions) fd.append('customInstructions', mergedInstructions);
        if (opts?.feedback) fd.append('feedback', opts.feedback);
        if (opts?.previousContent) fd.append('previousContent', opts.previousContent);
        for (const f of sourceFiles) fd.append('sourceFiles', f, f.name);
        for (const fmt of selectedExportFormats) fd.append('exportFormats', fmt);
        for (const s of stylesArr) fd.append('styles', s);
        // 履歴から復元した既存議事録フォルダの sources/ を流用する（元フォルダは破壊しない）。
        if (reuseFrom) fd.append('reuseSourcesFrom', reuseFrom);
        for (const n of excludeNames) fd.append('excludeSources', n);
        res = await fetch(minutesBase + '/generate', {
          method: 'POST',
          headers: { Accept: 'text/event-stream' },
          body: fd,
        });
      } else {
        res = await fetch(minutesBase + '/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            inputText: inputText.trim(),
            type: style?.type ?? selectedType,
            format: style?.format ?? selectedFormat,
            templateId: selectedTemplateId || undefined,
            templateBody: tmpl?.body || undefined,
            customInstructions: mergedInstructions || undefined,
            feedback: opts?.feedback || undefined,
            previousContent: opts?.previousContent || undefined,
            exportFormats: [...selectedExportFormats],
            styles: stylesArr,
          }),
        });
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as MinutesGenerateResponse;
        throw new Error(body.error || '生成に失敗しました（HTTP ' + String(res.status) + '）。');
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('no body');
      const decoder = new TextDecoder();
      let buf = '';
      let result: { relpath: string; name: string; files: GeneratedFile[] } | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt: {
            type?: string;
            pct?: number;
            ok?: boolean;
            created?: Array<{ name?: string; relpath?: string; sizeBytes?: number; ext?: string }>;
            report?: string;
            error?: string;
            exportErrors?: string[];
          } = {};
          try { evt = JSON.parse(line.slice(6)) as typeof evt; } catch { continue; }
          if (evt.type === 'progress' && typeof evt.pct === 'number') {
            setGenPct(evt.pct);
          } else if (evt.type === 'done') {
            setGenPct(100);
            if (!evt.ok) {
              throw new Error(evt.error || '議事録を作成できませんでした。');
            }
            // エクスポート（PDF/Word 等）が一部失敗していたらユーザーへ表示する。
            if (Array.isArray(evt.exportErrors) && evt.exportErrors.length > 0) {
              setExportWarn(
                '一部の形式の出力に失敗しました：\n' + evt.exportErrors.join('\n'),
              );
            }
            const created = Array.isArray(evt.created) ? evt.created : [];
            const files: GeneratedFile[] = created
              .filter((f): f is { name: string; relpath: string; sizeBytes?: number; ext?: string } =>
                !!f?.relpath && !!f?.name)
              .map((f) => ({
                name: f.name,
                relpath: f.relpath,
                sizeBytes: typeof f.sizeBytes === 'number' ? f.sizeBytes : 0,
                ext: f.ext || extOfName(f.name),
              }));
            const first = files[0];
            if (first) {
              result = { relpath: first.relpath, name: first.name, files };
            }
          }
        }
      }
      return result;
    },
    [minutesBase, inputText, selectedType, selectedFormat, selectedTemplateId, customInstructions, presets, sourceFiles, selectedStyles, selectedExportFormats, reuseFolderRelpath, restoredAttachments],
  );

  // 生成済みファイルの取得URL。
  // プレビュー(inline=true)時、deliverables では /api/deliverables/preview を使う（LibreOffice で
  // docx/xlsx 等を PDF 変換して inline 返す。pdf/画像/テキストはそのまま passthrough）。
  // /api/deliverables/file?inline=1 は変換せず生ファイルを inline 指定で返すだけなので docx 等はDLに化ける。
  // notebooks 側の file エンドポイントは変換対応済みなので従来どおり inline=1 を使う。
  // ダウンロード(inline=false)は常に生ファイルを返す file エンドポイントを使う。
  const minutesFileUrl = useCallback(
    (relpath: string, inline: boolean): string => {
      if (mode === 'deliverables') {
        return inline
          ? `/api/deliverables/preview?path=${encodeURIComponent(relpath)}`
          : `/api/deliverables/file?path=${encodeURIComponent(relpath)}`;
      }
      const q = inline ? '&inline=1' : '';
      return `/api/notebooks/${nbId}/file?path=${encodeURIComponent(relpath)}${q}`;
    },
    [mode, nbId],
  );

  const fetchArtifactContent = useCallback(
    async (relpath: string): Promise<string> => {
      const fileUrl =
        mode === 'deliverables'
          ? `/api/deliverables/file?path=${encodeURIComponent(relpath)}&inline=1`
          : `/api/notebooks/${nbId}/file?path=${encodeURIComponent(relpath)}&inline=1`;
      const fileRes = await fetch(fileUrl).catch(() => null);
      if (fileRes?.ok) return fileRes.text().catch(() => '');
      return '';
    },
    [mode, nbId],
  );

  const generate = useCallback(async () => {
    if (!inputText.trim() || generating) return;
    setGenerating(true);
    setGenError(null);
    setGenReport(null);
    setExportWarn(null);
    setGenPct(0);
    setGenStage('生成を準備しています…');
    setGeneratedContent(null);
    setGeneratedFiles([]);
    setPreviewMode(false);

    const stylesArr = Array.from(selectedStyles);
    let lastArt: { relpath: string; name: string; files: GeneratedFile[] } | null = null;
    const allFiles: GeneratedFile[] = [];

    try {
      for (let i = 0; i < stylesArr.length; i++) {
        const styleId = stylesArr[i];
        setGenStage(
          stylesArr.length > 1
            ? `議事録を生成しています…（${i + 1}/${stylesArr.length}）`
            : '議事録を生成しています…',
        );
        // 1スタイル目だけ元ファイルを添付して sources/ に保存させる（重複保存を避ける）。
        const art = await runSingleGenerate(styleId, { attachSources: i === 0 });
        if (art) {
          lastArt = art;
          setLastArtifact(art);
          allFiles.push(...art.files);
        }
        if (i < stylesArr.length - 1) setGenPct(0); // reset for next
      }

      setGenStage('完了しました');
      const n = stylesArr.length;
      setGenReport(n > 0 ? String(n) + ' 件の議事録を作成しました。' : '完了しました。');

      // 生成後: 出力ファイル一覧を表示。ダウンロード・再生成用に議事録md本文も取得しておく。
      if (lastArt) {
        setGeneratedFiles(allFiles);
        const content = await fetchArtifactContent(lastArt.relpath);
        setGeneratedContent(content);
        setPreviewMode(true);
      }

      onGenerated(lastArt?.relpath ?? undefined);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'ネットワークエラーで議事録を生成できませんでした。');
      setGenStage('');
    } finally {
      setGenerating(false);
    }
  }, [inputText, selectedStyles, generating, onGenerated, runSingleGenerate, fetchArtifactContent]);

  // フィードバックを反映して再生成する。
  const regenerateWithFeedback = useCallback(async () => {
    const fb = feedbackText.trim();
    if (!fb || regenerating || generating) return;
    setRegenerating(true);
    setGenError(null);
    setExportWarn(null);
    setGenPct(0);
    setGenStage('修正を反映して再生成しています…');

    const stylesArr = Array.from(selectedStyles);
    const styleId = stylesArr[0] ?? 'standard';
    const base = generatedContent || '';

    try {
      const art = await runSingleGenerate(styleId, { feedback: fb, previousContent: base });
      if (art) {
        setLastArtifact(art);
        setGeneratedFiles(art.files);
        const content = await fetchArtifactContent(art.relpath);
        setGeneratedContent(content);
      }
      setGenStage('完了しました');
      setGenReport('修正を反映して再生成しました。');
      setFeedbackText('');
      onGenerated(art?.relpath ?? undefined);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'ネットワークエラーで再生成できませんでした。');
    } finally {
      setRegenerating(false);
    }
  }, [feedbackText, regenerating, generating, selectedStyles, generatedContent, runSingleGenerate, fetchArtifactContent, onGenerated]);

  // プレビューを閉じて新規作成のため入力フォームへ戻す。
  const backToForm = useCallback(() => {
    setPreviewMode(false);
    setGenReport(null);
    setGenPct(0);
    setGenStage('');
    setGeneratedContent(null);
    setGeneratedFiles([]);
    setPreviewFile(null);
    setLastArtifact(null);
    setFeedbackText('');
    setInputText('');
    setSourceFiles([]);
    setReuseFolderRelpath(null);
    setRestoredAttachments([]);
  }, []);

  // 生成後プレビューから事前指定フォーマットを直接ダウンロードする。
  // ファイル名は YYYYMMDD_議事録（生成日基準・ゼロ埋め）。拡張子はサーバが付与する。
  const downloadFormat = useCallback((fmt: ExportFmt) => {
    if (downloadingFmt) return;
    const content = generatedContent;
    if (!content) return;
    setDownloadingFmt(fmt);
    setDownloadError(null);
    const now = new Date();
    const yyyymmdd =
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    const filename = `${yyyymmdd}_議事録`;
    fetch('/api/minutes/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, format: fmt, filename }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || 'ダウンロードに失敗しました。');
        }
        const blob = await res.blob();
        // Content-Disposition の filename*（UTF-8）からファイル名を復元。取れなければ自前で組み立てる。
        const cd = res.headers.get('Content-Disposition') || '';
        const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
        const dlName = m ? decodeURIComponent(m[1]) : `${filename}.${fmt}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = dlName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch((e: unknown) =>
        setDownloadError(e instanceof Error ? e.message : 'ネットワークエラーでダウンロードできませんでした。'),
      )
      .finally(() => setDownloadingFmt(null));
  }, [downloadingFmt, generatedContent]);

  const savePattern = useCallback(() => {
    if (!patternName.trim() || savingPattern) return;
    setSavingPattern(true);
    setSavePatternError(null);
    const preset = presets?.types.find((t) => t.type === selectedType);
    const tmpl = preset?.templates.find((t) => t.id === selectedTemplateId);
    fetch('/api/notebooks/minutes/patterns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: patternName.trim(),
        type: selectedType,
        format: selectedFormat,
        templateId: selectedTemplateId || undefined,
        templateBody: tmpl?.body || undefined,
        instructions: customInstructions.trim() || undefined,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const pat = (await res.json()) as MinutesPattern;
          setPatterns((prev) => [pat, ...prev]);
          setPatternName('');
          setShowPatternSave(false);
        } else {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setSavePatternError(body.error || '保存に失敗しました。');
        }
      })
      .catch(() => setSavePatternError('ネットワークエラーで保存に失敗しました。'))
      .finally(() => setSavingPattern(false));
  }, [patternName, selectedType, selectedFormat, selectedTemplateId, customInstructions, presets, savingPattern]);

  return (
    <div className="flex h-full flex-col">
      {showDeliverablePicker && (
        <DeliverablePickerModal
          onClose={() => setShowDeliverablePicker(false)}
          onPick={(df) => void handleDeliverablePick(df)}
          picking={loadingFromDeliverable}
        />
      )}
      {showHistory && (
        <MinutesHistoryModal
          items={historyItems}
          loading={historyLoading}
          error={historyError}
          picking={loadingHistoryDetail}
          onPick={(item) => void loadHistoryItem(item)}
          onClose={() => setShowHistory(false)}
        />
      )}
      {previewFile && (
        <MinutesPreviewModal
          file={previewFile}
          src={minutesFileUrl(previewFile.relpath, true)}
          onClose={() => setPreviewFile(null)}
        />
      )}
      <div className="border-b border-border px-3 py-2 flex items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
          >
            ← 戻る
          </button>
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">議事録</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">
          {!previewMode && (<>
          {patterns.length > 0 && (
            <div>
              <label className="mb-1 block text-[11px] text-text-faint">保存済みパターン</label>
              <select
                value={selectedPatternId}
                onChange={(e) => applyPattern(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text focus:border-accent focus:outline-none"
              >
                <option value="">パターンを選択…</option>
                {patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex gap-2">
              {(['text', 'audio', 'file'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setInputMode(mode)}
                  className={
                    'rounded-full px-3 py-1 text-xs transition-colors ' +
                    (inputMode === mode
                      ? 'bg-accent font-semibold text-bg'
                      : 'bg-surface-2 text-text-muted hover:text-text')
                  }
                >
                  {mode === 'text' ? 'テキスト' : mode === 'audio' ? '音声' : 'ファイル'}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowDeliverablePicker(true)}
                className="rounded-full bg-surface-2 px-3 py-1 text-xs text-text-muted transition-colors hover:text-text"
              >
                📁 Apollo
              </button>
            </div>

            {inputMode === 'audio' && (
              <div className="rounded-lg border border-dashed border-border bg-surface p-3 text-center">
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleAudioFile(f);
                    if (audioInputRef.current) audioInputRef.current.value = '';
                  }}
                />
                <p className="mb-2 text-xs text-text-muted">mp3 / m4a / wav / webm に対応</p>
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={transcribing}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
                >
                  {transcribing ? <><Spinner />文字起こし中…</> : '音声ファイルを選択'}
                </button>
                {transcribeError && (
                  <div role="alert" className="mt-2 text-xs" style={{ color: 'var(--mc-stalled)' }}>
                    {transcribeError}
                  </div>
                )}
                {inputText && (
                  <p className="mt-2 text-xs text-text-faint">
                    文字起こし完了。テキストタブで確認・編集できます。
                  </p>
                )}
              </div>
            )}

            {inputMode === 'file' && (
              <div className="rounded-lg border border-dashed border-border bg-surface p-3 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.csv,.md,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleExtractFile(f);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />
                <p className="mb-2 text-xs text-text-muted">PDF / テキスト / 画像（PNG・JPG）に対応</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extracting}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
                >
                  {extracting ? <><Spinner />テキスト抽出中…</> : 'ファイルを選択'}
                </button>
                {extractError && (
                  <div role="alert" className="mt-2 text-xs" style={{ color: 'var(--mc-stalled)' }}>
                    {extractError}
                  </div>
                )}
                {inputText && (
                  <p className="mt-2 text-xs text-text-faint">
                    抽出完了。テキストタブで確認・編集できます。
                  </p>
                )}
              </div>
            )}

            {inputMode === 'text' && (
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={generating}
                rows={6}
                placeholder="文字起こし済みテキストや議事メモを貼り付けてください…"
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
              />
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] text-text-faint">スタイル（複数選択可）</label>
            <div className="grid grid-cols-2 gap-1.5">
              {MINUTES_STYLES.map((s) => {
                const isSelected = selectedStyles.has(s.id);
                const isPreviewing = previewStyleId === s.id;
                return (
                  <div key={s.id} className="flex flex-col">
                    <div className={
                      'flex rounded-lg border transition-colors ' +
                      (isSelected ? 'border-accent bg-accent/10' : 'border-border bg-surface')
                    }>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStyles((prev) => {
                            const n = new Set(prev);
                            if (n.has(s.id)) { n.delete(s.id); } else { n.add(s.id); }
                            return n;
                          });
                          setSelectedPatternId('');
                        }}
                        disabled={generating}
                        className="flex flex-1 flex-col px-2.5 py-2 text-left disabled:opacity-50"
                      >
                        <span className="flex items-center gap-1 text-sm">
                          {isSelected && <span className="text-accent">✓</span>}
                          {s.emoji} <span className={isSelected ? 'font-semibold text-accent' : 'text-text'}>{s.label}</span>
                        </span>
                        <span className="mt-0.5 text-[10px] leading-tight text-text-faint">{s.desc}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewStyleId(isPreviewing ? null : s.id)}
                        title="プレビュー"
                        className={
                          'flex items-start rounded-r-lg border-l px-1.5 pt-2 text-[10px] transition-colors ' +
                          (isPreviewing
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border text-text-faint hover:bg-surface-2 hover:text-text-muted')
                        }
                      >
                        👁
                      </button>
                    </div>
                    {isPreviewing && (
                      <div className="mt-1 overflow-hidden rounded-lg border border-border">
                        <div className="border-b border-border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                          サンプル — {s.label}
                        </div>
                        <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
                          <StylePreviewPanel styleId={s.id} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-text-faint">追加指示（任意）</label>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              disabled={generating}
              rows={2}
              placeholder="例: 参加者名を敬称付きで記載してください…"
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] text-text-faint">エクスポート形式（複数選択可）</label>
            <div className="flex gap-1.5">
              {EXPORT_OPTS.map(({ fmt, label, icon }) => {
                const isSelFmt = selectedExportFormats.has(fmt);
                return (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setSelectedExportFormats((prev) => {
                      const n = new Set(prev);
                      if (n.has(fmt)) { n.delete(fmt); } else { n.add(fmt); }
                      return n;
                    })}
                    disabled={generating}
                    className={
                      'flex flex-1 flex-col items-center rounded-lg border py-2 text-xs transition-colors disabled:opacity-50 ' +
                      (isSelFmt
                        ? 'border-accent bg-accent/10 font-semibold text-accent'
                        : 'border-border bg-surface text-text-muted hover:border-accent/50 hover:text-text')
                    }
                  >
                    <span className="text-base">{icon}</span>
                    <span className="mt-0.5">{label}</span>
                    {isSelFmt && <span className="text-[9px] text-accent">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating || !inputText.trim() || selectedStyles.size === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity disabled:opacity-40"
            >
              {generating ? (
                <>
                  <Spinner />
                  議事録を生成中…
                </>
              ) : (
                <>
                  <SparkIcon width={15} height={15} />
                  議事録を生成{selectedStyles.size > 1 ? `（${selectedStyles.size}スタイル）` : ''}
                </>
              )}
            </button>
          </div>

          {/* 履歴から復元した既存添付（再生成で使う/外すを選べる。元フォルダは破壊しない）。 */}
          {restoredAttachments.length > 0 && (
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="mb-1 text-[11px] text-text-faint">
                復元された添付（チェックを外すと再生成で使いません）
              </p>
              <ul className="flex flex-col gap-1">
                {restoredAttachments.map((a, i) => (
                  <li key={a.relpath} className="flex items-center gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      checked={a.keep}
                      onChange={() =>
                        setRestoredAttachments((prev) =>
                          prev.map((x, idx) => (idx === i ? { ...x, keep: !x.keep } : x)),
                        )
                      }
                      className="shrink-0 accent-accent"
                    />
                    <span
                      className={'min-w-0 flex-1 truncate ' + (a.keep ? '' : 'line-through opacity-50')}
                      title={a.name}
                    >
                      📎 {a.name}
                    </span>
                    <a
                      href={`/api/deliverables/file?path=${encodeURIComponent(a.relpath)}&inline=1`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-text-faint hover:text-text"
                      title="プレビュー"
                    >
                      <EyeIcon width={14} height={14} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 添付を追加（テキスト抽出せず、そのまま元ファイルとして sources/ に保存する）。 */}
          {mode === 'deliverables' && (reuseFolderRelpath || restoredAttachments.length > 0 || sourceFiles.length > 0) && (
            <div>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) setSourceFiles((prev) => [...prev, ...files]);
                  if (attachInputRef.current) attachInputRef.current.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => attachInputRef.current?.click()}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-muted hover:border-accent/50 hover:text-text disabled:opacity-50"
              >
                ＋ 添付を追加
              </button>
            </div>
          )}
          {!inputText.trim() && (
            <p className="text-[11px] text-text-faint">
              テキストを入力または音声をアップロードすると生成できます。
            </p>
          )}

          {sourceFiles.length > 0 && (
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="mb-1 text-[11px] text-text-faint">元ファイル（議事録と一緒に保存されます）</p>
              <ul className="flex flex-col gap-1">
                {sourceFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-text-muted">
                    <span className="min-w-0 flex-1 truncate" title={f.name}>📎 {f.name}</span>
                    <button
                      type="button"
                      onClick={() => setSourceFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-text-faint hover:text-text"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          </>)}

          {(generating || regenerating) && (
            <div role="status" aria-live="polite">
              <div className="mb-1 flex justify-between text-[11px] text-text-muted">
                <span>{genStage || '生成しています…'}</span>
                <span>{genPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-1.5 rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: String(genPct) + '%' }}
                />
              </div>
            </div>
          )}
          {genError && (
            <div
              role="alert"
              className="rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
              style={{ color: 'var(--mc-stalled)' }}
            >
              {genError}
            </div>
          )}
          {exportWarn && (
            <div
              role="alert"
              className="whitespace-pre-line rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
              style={{ color: 'var(--mc-stalled)' }}
            >
              {exportWarn}
            </div>
          )}
          {previewMode && generatedContent !== null && lastArtifact && (
            <div className="flex flex-col gap-3">
              {/* 完了ヘッダー */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--mc-active)' }}>
                  ✓ {genReport || '完了しました'}
                </span>
                <button
                  type="button"
                  onClick={backToForm}
                  className="ml-auto rounded-full border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  新しく作成
                </button>
              </div>

              {/* 生成されたファイル一覧（各ファイルをプレビュー / ダウンロード） */}
              {generatedFiles.length > 0 && (
                <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
                  <div className="border-b border-border bg-surface-2/60 px-2 py-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                      生成されたファイル
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-2">
                    {generatedFiles.map((f) => {
                      const previewable = isMinutesFilePreviewable(f.ext);
                      return (
                        <div
                          key={f.relpath}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg p-2.5"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 text-text-faint">
                              <FileIcon width={18} height={18} />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm text-text" title={f.name}>
                                {f.name}
                              </div>
                              {f.sizeBytes > 0 && (
                                <div className="text-[11px] text-text-faint">
                                  {humanReadableSize(f.sizeBytes)}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            {previewable && (
                              <button
                                type="button"
                                onClick={() => setPreviewFile(f)}
                                className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
                                aria-label={`${f.name} をプレビュー`}
                              >
                                <EyeIcon width={15} height={15} />
                              </button>
                            )}
                            <a
                              href={minutesFileUrl(f.relpath, false)}
                              download={f.name}
                              className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
                              aria-label={`${f.name} をダウンロード`}
                            >
                              <DownloadIcon width={15} height={15} />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ダウンロード（事前指定フォーマット） */}
              {selectedExportFormats.size > 0 && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2">
                  <span className="text-[11px] font-semibold text-text-muted">ダウンロード</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {EXPORT_OPTS.filter(({ fmt }) => selectedExportFormats.has(fmt)).map(({ fmt, label, icon }) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => downloadFormat(fmt)}
                        disabled={downloadingFmt !== null}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-text hover:bg-surface-2 disabled:opacity-50"
                      >
                        {downloadingFmt === fmt ? <Spinner /> : <span>{icon}</span>}
                        {label}
                      </button>
                    ))}
                  </div>
                  {downloadError && (
                    <span className="text-[11px]" style={{ color: 'var(--mc-stalled)' }}>{downloadError}</span>
                  )}
                </div>
              )}

              {/* 保存済み情報 */}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                <span className="text-[11px] text-text-faint">保存先:</span>
                <span className="truncate text-[11px] text-text-muted font-mono">
                  {lastArtifact.relpath.replace(/\/[^/]+$/, '')}
                </span>
              </div>

              {/* フィードバック→再生成 */}
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                <p className="text-[11px] font-semibold text-text-muted">修正を依頼する</p>
                <p className="text-[10px] leading-tight text-text-faint">
                  例：「もっとコンパクトにして」「箇条書きを増やして」「決定事項を表にして」
                </p>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  disabled={regenerating}
                  rows={2}
                  placeholder="修正してほしい内容を入力…"
                  className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void regenerateWithFeedback()}
                  disabled={regenerating || !feedbackText.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
                >
                  {regenerating ? <><Spinner />再生成中…</> : <><SparkIcon width={13} height={13} />この内容で再生成</>}
                </button>
              </div>
            </div>
          )}

          {!previewMode && (
          <div className="border-t border-border pt-3">
            {!showPatternSave ? (
              <button
                type="button"
                onClick={() => setShowPatternSave(true)}
                className="text-xs text-text-faint hover:text-text"
              >
                + 現在の設定をパターンとして保存
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-text-faint">
                  現在の設定（種類・テンプレート・形式・追加指示）を保存します
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={patternName}
                    onChange={(e) => setPatternName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        savePattern();
                      }
                    }}
                    placeholder="パターン名…"
                    className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={savePattern}
                    disabled={savingPattern || !patternName.trim()}
                    className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
                  >
                    {savingPattern ? '保存中…' : '保存'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPatternSave(false);
                      setSavePatternError(null);
                    }}
                    className="rounded-full px-2 py-1 text-xs text-text-muted hover:text-text"
                  >
                    キャンセル
                  </button>
                </div>
                {savePatternError && (
                  <p className="text-[11px]" style={{ color: 'var(--mc-stalled)' }}>
                    {savePatternError}
                  </p>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── 詳細画面（3 ペイン / モバイルはタブ）────────────────────────

type DetailTab = 'sources' | 'chat';

function NotebookDetailView({
  id,
  onBack,
  initialTab,
}: {
  id: string;
  onBack: () => void;
  initialTab?: DetailTab;
}) {
  const { data, error, loading, refetch } = useLiveResource<NotebookDetail>(`/api/notebooks/${id}`);
  // モバイル既定タブは Q&A（資料は初期非表示）。呼び出し側が明示指定していれば尊重。
  const [tab, setTab] = useState<DetailTab>(initialTab ?? 'chat');
  // デスクトップ: 資料ペインは初期折りたたみ（Q&A を主役に）。永続化は不要。
  const [sourcesCollapsed, setSourcesCollapsed] = useState(true);
  const [preview, setPreview] = useState<NotebookFileRef | null>(null);

  // インライン名称編集
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const detail = data && data.meta ? data : null;
  const sources = detail?.sources ?? [];
  const hasSources = sources.length > 0;
  const chat = detail?.chat ?? [];

  const startEditing = useCallback(() => {
    setNameInput(detail?.meta.name ?? '');
    setRenameError(null);
    setEditingName(true);
  }, [detail]);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  const commitRename = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setRenameError('名前を入力してください。');
      return;
    }
    if (trimmed === detail?.meta.name) {
      setEditingName(false);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    fetch(`/api/notebooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
      .then(async (res) => {
        if (res.ok) {
          setEditingName(false);
          refetch();
        } else {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setRenameError(body.error || `リネームに失敗しました（HTTP ${res.status}）。`);
        }
      })
      .catch(() => setRenameError('ネットワークエラーでリネームに失敗しました。'))
      .finally(() => setRenaming(false));
  }, [id, nameInput, detail, refetch]);

  const cancelRename = useCallback(() => {
    setEditingName(false);
    setRenameError(null);
  }, []);

  const sourcesPane = (
    <SourcesPane id={id} sources={sources} onChanged={refetch} onPreview={setPreview} />
  );
  // デスクトップ展開時の資料ペイン（ヘッダに折りたたみトグルを表示）
  const sourcesPaneDesktop = (
    <SourcesPane
      id={id}
      sources={sources}
      onChanged={refetch}
      onPreview={setPreview}
      onCollapse={() => setSourcesCollapsed(true)}
    />
  );
  const chatPane = (
    <ChatPane id={id} chat={chat} hasSources={hasSources} onAnswered={refetch} />
  );

  const TABS: { key: DetailTab; label: string; count?: number }[] = [
    { key: 'sources', label: '資料', count: sources.length },
    { key: 'chat', label: 'Q&A' },
  ];

  // ヘッダのタイトル部分（インライン編集対応）
  const titleContent = editingName ? (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          ref={nameInputRef}
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            if (e.key === 'Escape') cancelRename();
          }}
          onBlur={commitRename}
          disabled={renaming}
          className="rounded border border-accent bg-bg px-2 py-0.5 text-lg font-bold text-text focus:outline-none disabled:opacity-60"
          style={{ minWidth: '12rem', maxWidth: '24rem' }}
        />
        {renaming && <Spinner />}
      </div>
      {renameError && (
        <span className="text-[11px]" style={{ color: 'var(--mc-stalled)' }}>{renameError}</span>
      )}
    </div>
  ) : (
    <div className="flex items-center gap-1.5">
      <span className="text-lg font-bold text-text">{detail?.meta.name ?? 'RAG'}</span>
      {detail && (
        <button
          type="button"
          onClick={startEditing}
          className="rounded p-0.5 text-text-faint opacity-0 hover:bg-surface-2 hover:text-text group-hover:opacity-100 focus:opacity-100"
          aria-label="名前を変更"
        >
          <EditIcon width={14} height={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur md:px-6 md:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="group">
            {titleContent}
            {detail && !editingName && (
              <p className="mt-0.5 text-xs text-text-muted">資料 {sources.length}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
            >
              一覧へ戻る
            </button>
          </div>
        </div>
      </header>

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
              {/* デスクトップ: 2ペイン（資料 / Q&A）。資料は折りたたみ可能（初期は折りたたみ） */}
              <div
                className={`hidden h-full md:grid ${
                  sourcesCollapsed
                    ? 'md:grid-cols-[auto_minmax(0,1fr)]'
                    : 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]'
                }`}
              >
                {sourcesCollapsed ? (
                  <button
                    type="button"
                    onClick={() => setSourcesCollapsed(false)}
                    aria-label="資料を開く"
                    aria-expanded={false}
                    className="flex min-h-0 w-11 flex-col items-center gap-2 border-r border-border py-3 text-text-muted hover:bg-surface-2 hover:text-text"
                  >
                    <ChevronRightIcon width={16} height={16} />
                    <DocumentsIcon width={16} height={16} />
                    <span
                      className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ writingMode: 'vertical-rl' }}
                    >
                      資料 {sources.length}
                    </span>
                  </button>
                ) : (
                  <div className="min-h-0 border-r border-border">{sourcesPaneDesktop}</div>
                )}
                <div className="min-h-0">{chatPane}</div>
              </div>
              {/* モバイル: display:none で切り替え（アンマウントしないため state を保持）*/}
              <div className="h-full md:hidden">
                <div className="h-full" style={{ display: tab === 'sources' ? undefined : 'none' }}>{sourcesPane}</div>
                <div className="h-full" style={{ display: tab === 'chat' ? undefined : 'none' }}>{chatPane}</div>
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
          placeholder="新しいRAGの名前（任意）…"
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity disabled:opacity-50"
        >
          {creating ? <Spinner /> : <PlusIcon width={15} height={15} />}
          RAGを作成
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
      <div className="mt-2">
        <button type="button" onClick={onOpen} className="flex items-center gap-3 text-left text-xs text-text-faint">
          <span>資料 {nb.sourceCount}</span>
          <span>生成物 {nb.artifactCount}</span>
          <span>{relativeTime(nb.updatedAt)}</span>
        </button>
      </div>

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
        title="RAG"
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
                <EmptyState>まだRAGがありません。上の入力欄から作成できます。</EmptyState>
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
