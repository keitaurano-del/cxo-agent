// Vault — Obsidian Vault 一元化ビュー（read-only）。
//
// レイアウト: 左=フォルダツリー＋検索 / 中央=ノート本文 / 右=メタ（frontmatter・リンク）。
// 検索・wikilink 遷移・画像埋め込み・callout・frontmatter 表示に対応。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type {
  VaultTreeResponse,
  VaultTreeNode,
  VaultNote,
  VaultSearchResponse,
} from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState, Spinner } from '../components/ui';
import VaultTree from '../components/VaultTree';
import ObsidianMarkdown from '../components/ObsidianMarkdown';
import VaultAddSheet from '../components/VaultAddSheet';
import { makeLinkResolver, extractTags, attachmentUrl } from '../lib/obsidian';
import { SearchIcon, LinkIcon, TagIcon, CloseIcon, ImageFileIcon, PlusIcon } from '../components/icons';
import { relativeTime } from '../lib/time';

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

function NoteMeta({ note }: { note: VaultNote }) {
  const fmEntries = Object.entries(note.frontmatter).filter(
    ([k]) => k.toLowerCase() !== 'title',
  );
  const tags = useMemo(() => extractTags(note.body), [note.body]);
  // frontmatter の tags も統合。
  const fmTags = normalizeTags(note.frontmatter.tags);
  const allTags = Array.from(new Set([...fmTags, ...tags]));

  if (fmEntries.length === 0 && allTags.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface-2 px-4 py-3">
      {fmEntries.length > 0 && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
          {fmEntries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium text-text-faint">{k}</dt>
              <dd className="text-text-muted">{formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {allTags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-text-faint" aria-hidden>
            <TagIcon width={13} height={13} />
          </span>
          {allTags.map((t) => (
            <span key={t} className="mc-tag">
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).replace(/^#/, ''));
  if (typeof v === 'string' && v.trim() !== '') {
    return v
      .split(/[, ]+/)
      .map((s) => s.replace(/^#/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function LinkPanel({
  note,
  onNavigate,
}: {
  note: VaultNote;
  onNavigate: (path: string) => void;
}) {
  const outgoing = note.outgoingLinks.filter((l) => l.path);
  const { backlinks } = note;
  if (outgoing.length === 0 && backlinks.length === 0) return null;
  return (
    <div className="space-y-4">
      {outgoing.length > 0 && (
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            <LinkIcon width={12} height={12} aria-hidden />
            リンク先（{outgoing.length}）
          </h3>
          <ul className="space-y-0.5">
            {outgoing.map((l, i) => (
              <li key={`${l.path}-${i}`}>
                <button
                  type="button"
                  className="block w-full truncate rounded px-2 py-1 text-left text-xs text-accent hover:bg-surface-2"
                  onClick={() => l.path && onNavigate(l.path)}
                  title={l.path ?? l.target}
                >
                  {l.display}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {backlinks.length > 0 && (
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            <LinkIcon width={12} height={12} aria-hidden />
            被リンク（{backlinks.length}）
          </h3>
          <ul className="space-y-0.5">
            {backlinks.map((b) => (
              <li key={b.path}>
                <button
                  type="button"
                  className="block w-full truncate rounded px-2 py-1 text-left text-xs text-text-muted hover:bg-surface-2 hover:text-text"
                  onClick={() => onNavigate(b.path)}
                  title={b.path}
                >
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function NotePanel({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  // 画像/添付ファイルはプレビュー、md はノートレンダリング。
  // hooks の条件呼び出しを避けるため、md と非 md を別コンポーネントに分ける。
  if (!isMarkdownPath(path)) {
    const ext = '.' + (path.split('.').pop() ?? '').toLowerCase();
    if (IMG_EXTS.has(ext)) {
      return (
        <div className="p-6">
          <div className="mb-2 text-xs text-text-faint">{path}</div>
          <img
            src={attachmentUrl(path)}
            alt={path}
            className="max-w-full rounded-lg border border-border"
          />
        </div>
      );
    }
    return (
      <div className="p-6">
        <EmptyState>
          このファイルはプレビューに対応していません（{path}）。
        </EmptyState>
      </div>
    );
  }
  return <NoteMarkdownPanel path={path} onNavigate={onNavigate} />;
}

function NoteMarkdownPanel({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const { data, error, loading } = useLiveResource<VaultNote>(
    `/api/vault/note?path=${encodeURIComponent(path)}`,
  );
  const resolveLink = useMemo(
    () => makeLinkResolver(data?.outgoingLinks ?? []),
    [data?.outgoingLinks],
  );

  return (
    <div className="flex h-full">
      <article className="min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 lg:px-10">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <div className="mx-auto max-w-3xl">
              <div className="mb-1 text-xs text-text-faint">{data.path}</div>
              <h1 className="mb-1 text-2xl font-bold text-text">{data.title}</h1>
              {data.mtime && (
                <div className="mb-4 text-xs text-text-faint">
                  更新: {relativeTime(data.mtime)}
                </div>
              )}
              <NoteMeta note={data} />
              <ObsidianMarkdown
                body={data.body}
                resolveLink={resolveLink}
                onNavigate={onNavigate}
              />
            </div>
          )}
        </ResourceState>
      </article>
      {data && (data.outgoingLinks.some((l) => l.path) || data.backlinks.length > 0) && (
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-border bg-surface px-3 py-5 xl:block">
          <LinkPanel note={data} onNavigate={onNavigate} />
        </aside>
      )}
    </div>
  );
}

function SearchResults({
  query,
  onOpen,
  onClose,
}: {
  query: string;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const { data, loading } = useLiveResource<VaultSearchResponse>(
    `/api/vault/search?q=${encodeURIComponent(query)}`,
  );
  return (
    <div className="border-b border-border bg-surface-2">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs text-text-muted">
          「{query}」の検索結果{data ? `（${data.results.length}件）` : ''}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-faint hover:bg-surface-3 hover:text-text"
          aria-label="検索を閉じる"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {loading && !data && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
            <Spinner /> 検索しています…
          </div>
        )}
        {data && data.results.length === 0 && (
          <div className="px-3 py-4 text-xs text-text-faint">一致するノートがありません。</div>
        )}
        {data &&
          data.results.map((r) => (
            <button
              key={r.path}
              type="button"
              onClick={() => onOpen(r.path)}
              className="block w-full border-t border-border/60 px-3 py-2 text-left hover:bg-surface-3"
            >
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
                {r.title}
              </div>
              <div className="truncate text-[11px] text-text-faint">{r.path}</div>
              {r.snippet && (
                <div className="mt-0.5 line-clamp-2 text-xs text-text-muted">{r.snippet}</div>
              )}
            </button>
          ))}
      </div>
    </div>
  );
}

export default function Vault() {
  const { data, error, loading, fetchedAt, refetch } = useLiveResource<VaultTreeResponse>(
    '/api/vault/tree',
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  // モバイルでは 3 ペインを並べられないので、ツリー / 本文を切り替えて 1 ペインずつ全幅表示する。
  const [mobilePane, setMobilePane] = useState<'tree' | 'note'>('tree');
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const onCreated = useCallback(
    (message: string) => {
      setToast(message);
      window.setTimeout(() => setToast(null), 3500);
      refetch();
    },
    [refetch],
  );

  const openPath = useCallback((path: string) => {
    setSelected(path);
    setActiveQuery('');
    setMobilePane('note');
  }, []);

  const onSelectNode = useCallback((node: VaultTreeNode) => {
    setSelected(node.path);
    if (node.type === 'file') setMobilePane('note');
  }, []);

  // 初期表示: 直近更新の briefing 等が無ければ未選択のまま（中央は案内）。
  useEffect(() => {
    if (selected || !data) return;
    // 何も選ばれていない場合は最初の md を自動で開く（任意の体験向上）。
    const firstMd = findFirstMd(data.tree);
    if (firstMd) setSelected(firstMd);
  }, [data, selected]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Vault"
        subtitle="Obsidian Vault 一元化ビュー（閲覧専用）"
        fetchedAt={fetchedAt}
        right={
          <div className="flex w-full items-center gap-2 md:w-auto">
            <form
              className="flex min-w-0 flex-1 items-center md:w-auto md:flex-none"
              onSubmit={(e) => {
                e.preventDefault();
                const q = searchInput.trim();
                setActiveQuery(q);
                setMobilePane('note');
              }}
            >
              <div className="flex w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 md:w-auto">
                <span className="text-text-faint" aria-hidden>
                  <SearchIcon width={14} height={14} />
                </span>
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Vault を検索（Enter）"
                  aria-label="Vault 全文検索"
                  className="w-full bg-transparent text-xs text-text outline-none placeholder:text-text-faint md:w-44"
                />
              </div>
            </form>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:bg-accent-strong"
            >
              <PlusIcon width={14} height={14} />
              追加
            </button>
          </div>
        }
      />
      {/* モバイル: ツリー / 本文 の切替セグメント */}
      <div className="flex border-b border-border md:hidden" role="tablist" aria-label="表示ペイン切替">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'tree'}
          onClick={() => setMobilePane('tree')}
          className={`flex-1 py-2.5 text-xs ${
            mobilePane === 'tree' ? 'border-b-2 border-accent font-semibold text-text' : 'text-text-muted'
          }`}
        >
          ツリー
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'note'}
          onClick={() => setMobilePane('note')}
          className={`flex-1 py-2.5 text-xs ${
            mobilePane === 'note' ? 'border-b-2 border-accent font-semibold text-text' : 'text-text-muted'
          }`}
        >
          本文
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* 左: ツリー（モバイルは tree ペイン選択時のみ全幅表示） */}
        <nav
          className={`shrink-0 overflow-y-auto border-r border-border bg-surface md:block md:w-64 ${
            mobilePane === 'tree' ? 'block w-full' : 'hidden'
          }`}
          aria-label="Vault ファイルツリー"
        >
          <ResourceState loading={loading} error={error} hasData={!!data}>
            {data && (
              <VaultTree root={data.tree} selectedPath={selected} onSelect={onSelectNode} />
            )}
          </ResourceState>
        </nav>

        {/* 中央: 検索結果 or ノート（モバイルは note ペイン選択時のみ表示） */}
        <section
          className={`min-w-0 flex-1 flex-col md:flex ${
            mobilePane === 'note' ? 'flex' : 'hidden'
          }`}
        >
          {activeQuery && (
            <SearchResults
              query={activeQuery}
              onOpen={openPath}
              onClose={() => setActiveQuery('')}
            />
          )}
          <div className="min-h-0 flex-1">
            {selected ? (
              <NotePanel key={selected} path={selected} onNavigate={openPath} />
            ) : (
              <div className="flex h-full items-center justify-center p-10">
                <div className="text-center text-text-faint">
                  <span className="mb-2 inline-block" aria-hidden>
                    <ImageFileIcon width={28} height={28} />
                  </span>
                  <p className="text-sm">左のツリーからノートを選択してください。</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] -translate-x-1/2 rounded-lg border border-active/40 bg-active-bg px-4 py-2 text-sm font-medium text-active shadow-lg md:bottom-6"
        >
          {toast}
        </div>
      )}

      <VaultAddSheet open={addOpen} onClose={() => setAddOpen(false)} onCreated={onCreated} />
    </div>
  );
}

function findFirstMd(node: VaultTreeNode): string | null {
  if (node.type === 'file') return node.ext === '.md' ? node.path : null;
  for (const c of node.children ?? []) {
    const found = findFirstMd(c);
    if (found) return found;
  }
  return null;
}
