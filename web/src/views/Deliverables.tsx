// Deliverables — 成果物（Excel/PowerPoint/PDF/CSV/画像/テキスト/md）の一覧・閲覧・DL ビュー。
//
// レイアウト: 左=ファイル一覧（サブフォルダで見出しグルーピング） / 右=プレビュー。
// プレビュー: PDF は iframe、画像は img、テキスト/csv/md はテキスト/Markdown 表示（?inline=1）。
// Excel/PowerPoint はブラウザ内プレビュー不可のため、ダウンロード導線を出す。

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type { DeliverablesResponse, DeliverableFile, DeliverableKind } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState, Spinner } from '../components/ui';
import ObsidianMarkdown from '../components/ObsidianMarkdown';
import {
  DownloadIcon,
  SheetIcon,
  SlidesIcon,
  PdfFileIcon,
  ImageFileIcon,
  TextFileIcon,
  FileIcon,
  DocumentsIcon,
} from '../components/icons';
import { relativeTime } from '../lib/time';

// 成果物ファイル配信 URL。inline=1 でプレビュー（Content-Disposition: inline）。
function fileUrl(relpath: string, inline = false): string {
  const base = `/api/deliverables/file?path=${encodeURIComponent(relpath)}`;
  return inline ? `${base}&inline=1` : base;
}

function KindIcon({ kind, size = 18 }: { kind: DeliverableKind; size?: number }) {
  const props = { width: size, height: size };
  switch (kind) {
    case 'spreadsheet':
      return <SheetIcon {...props} />;
    case 'presentation':
      return <SlidesIcon {...props} />;
    case 'pdf':
      return <PdfFileIcon {...props} />;
    case 'image':
      return <ImageFileIcon {...props} />;
    case 'markdown':
    case 'text':
      return <TextFileIcon {...props} />;
    case 'document':
      return <DocumentsIcon {...props} />;
    default:
      return <FileIcon {...props} />;
  }
}

const KIND_LABEL: Record<DeliverableKind, string> = {
  spreadsheet: 'スプレッドシート',
  presentation: 'プレゼンテーション',
  document: 'ドキュメント',
  pdf: 'PDF',
  image: '画像',
  markdown: 'Markdown',
  text: 'テキスト',
  other: 'ファイル',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** relpath の親フォルダ（無ければ ''=ルート）。グルーピング見出し用。 */
function folderOf(relpath: string): string {
  const idx = relpath.lastIndexOf('/');
  return idx === -1 ? '' : relpath.slice(0, idx);
}

// ─── プレビュー ────────────────────────────────────────

function TextPreview({ file, markdown }: { file: DeliverableFile; markdown: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setText(null);
    setError(null);
    fetch(fileUrl(file.relpath, true))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file.relpath]);

  if (loading && text === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-xs text-text-muted">
        <Spinner /> 読み込んでいます…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <EmptyState>プレビューを読み込めませんでした（{error}）。</EmptyState>
      </div>
    );
  }
  if (text === null) return null;

  if (markdown) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-4 md:px-6">
        <ObsidianMarkdown body={text} resolveLink={() => null} onNavigate={() => {}} />
      </div>
    );
  }
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-4 text-xs leading-relaxed text-text md:px-6">
      {text}
    </pre>
  );
}

function Preview({ file }: { file: DeliverableFile }) {
  const downloadButton = (
    <a
      href={fileUrl(file.relpath)}
      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:bg-accent-strong"
    >
      <DownloadIcon width={14} height={14} />
      ダウンロード
    </a>
  );

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-text-muted" aria-hidden>
          <KindIcon kind={file.kind} size={16} />
        </span>
        <span className="truncate text-sm font-medium text-text" title={file.relpath}>
          {file.name}
        </span>
      </div>
      {downloadButton}
    </div>
  );

  let body: ReactNode;
  if (file.kind === 'pdf') {
    body = (
      <iframe
        src={fileUrl(file.relpath, true)}
        title={file.name}
        className="h-full w-full border-0 bg-surface"
      />
    );
  } else if (file.kind === 'image') {
    body = (
      <div className="overflow-auto p-4 md:p-6">
        <img
          src={fileUrl(file.relpath, true)}
          alt={file.name}
          className="max-w-full rounded-lg border border-border"
        />
      </div>
    );
  } else if (file.kind === 'markdown') {
    body = (
      <div className="h-full overflow-y-auto">
        <TextPreview file={file} markdown />
      </div>
    );
  } else if (file.kind === 'text' || file.kind === 'spreadsheet') {
    // text と CSV（spreadsheet 内の .csv）はテキスト表示。xlsx 等はブラウザ内不可。
    if (file.ext === '.csv' || file.kind === 'text') {
      body = (
        <div className="h-full overflow-y-auto">
          <TextPreview file={file} markdown={false} />
        </div>
      );
    } else {
      body = <UnsupportedPreview file={file} />;
    }
  } else {
    body = <UnsupportedPreview file={file} />;
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

function UnsupportedPreview({ file }: { file: DeliverableFile }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm text-center text-text-muted">
        <span className="mb-3 inline-block text-text-faint" aria-hidden>
          <KindIcon kind={file.kind} size={36} />
        </span>
        <p className="mb-1 text-sm font-medium text-text">
          {KIND_LABEL[file.kind]}はブラウザ内で表示できません
        </p>
        <p className="mb-4 text-xs">
          ダウンロードして対応アプリで開いてください。
        </p>
        <a
          href={fileUrl(file.relpath)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:bg-accent-strong"
        >
          <DownloadIcon width={14} height={14} />
          ダウンロード
        </a>
      </div>
    </div>
  );
}

// ─── 一覧行 ────────────────────────────────────────────

function FileRow({
  file,
  selected,
  onSelect,
}: {
  file: DeliverableFile;
  selected: boolean;
  onSelect: (file: DeliverableFile) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 border-t border-border/60 px-3 py-2 ${
        selected ? 'bg-surface-3' : 'hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(file)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="shrink-0 text-text-muted" aria-hidden>
          <KindIcon kind={file.kind} size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-text" title={file.name}>
            {file.name}
          </span>
          <span className="block text-[11px] text-text-faint">
            {KIND_LABEL[file.kind]} · {formatBytes(file.sizeBytes)} · {relativeTime(file.mtime)}
          </span>
        </span>
      </button>
      <a
        href={fileUrl(file.relpath)}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 rounded p-1.5 text-text-faint hover:bg-surface-3 hover:text-text"
        aria-label={`${file.name} をダウンロード`}
        title="ダウンロード"
      >
        <DownloadIcon width={15} height={15} />
      </a>
    </div>
  );
}

export default function Deliverables() {
  const { data, error, loading, fetchedAt } = useLiveResource<DeliverablesResponse>(
    '/api/deliverables',
  );
  const [selected, setSelected] = useState<DeliverableFile | null>(null);
  // モバイルは一覧 / プレビューを切り替えて 1 ペインずつ全幅表示する。
  const [mobilePane, setMobilePane] = useState<'list' | 'preview'>('list');

  const files = useMemo(() => data?.files ?? [], [data?.files]);

  // フォルダ単位でグルーピング（新しい順は API 側で済み、グループ内も維持される）。
  const groups = useMemo(() => {
    const map = new Map<string, DeliverableFile[]>();
    for (const f of files) {
      const folder = folderOf(f.relpath);
      const arr = map.get(folder);
      if (arr) arr.push(f);
      else map.set(folder, [f]);
    }
    return Array.from(map.entries());
  }, [files]);

  const onSelect = useCallback((file: DeliverableFile) => {
    setSelected(file);
    setMobilePane('preview');
  }, []);

  const hasFiles = files.length > 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="成果物"
        subtitle="生成したファイルの一覧・閲覧・ダウンロード"
        fetchedAt={fetchedAt}
      />
      {/* モバイル: 一覧 / プレビュー の切替セグメント */}
      <div className="flex border-b border-border md:hidden" role="tablist" aria-label="表示ペイン切替">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'list'}
          onClick={() => setMobilePane('list')}
          className={`flex-1 py-2.5 text-xs ${
            mobilePane === 'list' ? 'border-b-2 border-accent font-semibold text-text' : 'text-text-muted'
          }`}
        >
          一覧
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'preview'}
          onClick={() => setMobilePane('preview')}
          className={`flex-1 py-2.5 text-xs ${
            mobilePane === 'preview' ? 'border-b-2 border-accent font-semibold text-text' : 'text-text-muted'
          }`}
        >
          プレビュー
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* 左: 一覧（モバイルは list ペイン選択時のみ全幅表示） */}
        <nav
          className={`shrink-0 overflow-y-auto border-r border-border bg-surface md:block md:w-80 ${
            mobilePane === 'list' ? 'block w-full' : 'hidden'
          }`}
          aria-label="成果物一覧"
        >
          <ResourceState loading={loading} error={error} hasData={!!data}>
            {data && !hasFiles && (
              <div className="p-6">
                <EmptyState>
                  まだ成果物がありません。生成したファイルがここに表示されます。
                </EmptyState>
              </div>
            )}
            {data &&
              hasFiles &&
              groups.map(([folder, items]) => (
                <section key={folder || '__root__'}>
                  {folder && (
                    <div className="sticky top-0 z-[1] flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                      <DocumentsIcon width={12} height={12} aria-hidden />
                      {folder}
                    </div>
                  )}
                  {items.map((f) => (
                    <FileRow
                      key={f.relpath}
                      file={f}
                      selected={selected?.relpath === f.relpath}
                      onSelect={onSelect}
                    />
                  ))}
                </section>
              ))}
          </ResourceState>
        </nav>

        {/* 右: プレビュー（モバイルは preview ペイン選択時のみ表示） */}
        <section
          className={`min-w-0 flex-1 flex-col md:flex ${
            mobilePane === 'preview' ? 'flex' : 'hidden'
          }`}
        >
          <div className="min-h-0 flex-1">
            {selected ? (
              <Preview key={selected.relpath} file={selected} />
            ) : (
              <div className="flex h-full items-center justify-center p-10">
                <div className="text-center text-text-faint">
                  <span className="mb-2 inline-block" aria-hidden>
                    <DocumentsIcon width={28} height={28} />
                  </span>
                  <p className="text-sm">左の一覧からファイルを選択してください。</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
