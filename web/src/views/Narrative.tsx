// Narrative（今日）— briefing / inspection / feedback を react-markdown で表示。
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLiveResource } from '../lib/useLiveData';
import { useLiveTick } from '../lib/liveContext';
import type { Narrative as NarrativeData, NarrativeDoc } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState } from '../components/ui';

type TabKey = 'briefing' | 'inspection' | 'feedback';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'briefing', label: 'ブリーフィング' },
  { key: 'inspection', label: '点検' },
  { key: 'feedback', label: 'フィードバック' },
];

// frontmatter を本文表示から除く（先頭 --- ... --- ブロック）。
function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function DocPanel({ doc }: { doc: NarrativeDoc }) {
  const body = stripFrontmatter(doc.body ?? '').trim();
  if (!doc.file || !body) {
    return <EmptyState>表示できるドキュメントがありません。</EmptyState>;
  }
  return (
    <article>
      {doc.date && (
        <div className="mb-3 text-xs text-text-faint">{doc.date}（{doc.file}）</div>
      )}
      <div className="mc-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // 外部リンクは新規タブ + rel 付与（安全側）。
            a: ({ href, children, ...rest }) => {
              const external = !!href && /^https?:\/\//.test(href);
              return (
                <a
                  href={href}
                  {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  {...rest}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {body}
        </ReactMarkdown>
      </div>
    </article>
  );
}

export default function Narrative() {
  const tick = useLiveTick('narrative');
  const { data, error, loading, fetchedAt } = useLiveResource<NarrativeData>(
    '/api/narrative',
    tick,
  );
  const [tab, setTab] = useState<TabKey>('briefing');

  const current = data ? data[tab] : null;

  return (
    <div>
      <PageHeader
        title="今日"
        subtitle="本日（無ければ直近）のブリーフィング・点検・フィードバック"
        fetchedAt={fetchedAt}
        right={
          <div
            className="no-scrollbar -mx-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto px-1"
            role="tablist"
            aria-label="ナラティブ種別"
          >
            {TABS.map((t) => {
              const doc = data?.[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 rounded-md px-3 py-2 text-xs md:py-1 ${
                    tab === t.key
                      ? 'bg-surface-3 font-semibold text-text'
                      : 'text-text-muted hover:bg-surface-2'
                  }`}
                >
                  {t.label}
                  {doc?.date && (
                    <span className="ml-1.5 hidden text-[10px] text-text-faint md:inline">
                      {doc.date}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        }
      />
      <div className="p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          <div className="mx-auto max-w-3xl rounded-xl border border-border bg-surface p-4 md:p-6">
            {current && <DocPanel doc={current} />}
          </div>
        </ResourceState>
      </div>
    </div>
  );
}
