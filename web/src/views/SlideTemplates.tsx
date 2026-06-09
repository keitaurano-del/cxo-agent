// スライドテンプレート（様式）カタログ＋用途から探す（MC-224 Phase1）。
//
// GET /api/templates でカタログ（version/updatedAt/source/categories/templates）を取得し、
//  - 上部にカテゴリフィルタ（タブ）＋件数バッジ
//  - 「用途から探す」テキスト検索（name / useCases / whenToUse を部分一致、カテゴリと AND）
//  - 本体はカードグリッド（previewSvg を 16:9 で表示、name/カテゴリ/useCases）
//  - カードクリックで詳細パネル（モーダル）: previewSvg 大・whenToUse・messageLineExample・
//    layout・recommendedVisual・structure（番号付き）・tips（チェックリスト風）・構成コピー
// を提供する。previewSvg は当方管理の静的データなので dangerouslySetInnerHTML で描画する。

import { useEffect, useMemo, useState } from 'react';
import { useLiveResource } from '../lib/useLiveData';
import type { SlideTemplate, SlideTemplateCatalog } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { ResourceState, EmptyState } from '../components/ui';
import { SearchIcon, CloseIcon } from '../components/icons';

// 関連ガイド（注記として詳細フッターに出す。リンクでなくパスの注記）。
const GUIDE_PATH = 'docs/templates/consulting/08-スライド作成/コンサルスライド作成ガイド.md';

/** previewSvg を 16:9 の枠付きで描画する（当方管理の静的 SVG）。 */
function SvgPreview({ svg, large = false }: { svg: string; large?: boolean }) {
  return (
    <div
      className={`w-full overflow-hidden rounded-lg border border-border bg-white ${large ? '' : ''}`}
      style={{ aspectRatio: '16 / 9' }}
    >
      <div
        className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

/** useCases をタグ列で描画する。 */
function UseCaseTags({ useCases }: { useCases: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {useCases.map((uc) => (
        <span
          key={uc}
          className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-text-muted"
        >
          {uc}
        </span>
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  categoryLabel,
  onSelect,
}: {
  template: SlideTemplate;
  categoryLabel: string;
  onSelect: (t: SlideTemplate) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent/50"
    >
      <SvgPreview svg={template.previewSvg} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-text">{template.name}</span>
        <span className="w-fit rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-text-faint">
          {categoryLabel}
        </span>
        <UseCaseTags useCases={template.useCases} />
      </div>
    </button>
  );
}

// ─── 詳細パネル（モーダル）─────────────────────────────────

function TemplateDetail({
  template,
  categoryLabel,
  onClose,
}: {
  template: SlideTemplate;
  categoryLabel: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyStructure = () => {
    // structure を Markdown 箇条書きにしてクリップボードへ。
    const md = template.structure.map((s) => `- ${s}`).join('\n');
    void navigator.clipboard
      .writeText(md)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {
        /* クリップボード不可環境では無視 */
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg/70 p-3 backdrop-blur md:p-8"
      role="dialog"
      aria-modal
      aria-label={`${template.name} の詳細`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダ */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 md:p-5">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-text">{template.name}</h2>
            <span className="mt-1 inline-block rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-text-faint">
              {categoryLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label="閉じる"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {/* 本体 */}
        <div className="space-y-5 p-4 md:p-5">
          <SvgPreview svg={template.previewSvg} large />

          <UseCaseTags useCases={template.useCases} />

          <section>
            <h3 className="mb-1 text-xs font-semibold text-text-muted">使いどころ</h3>
            <p className="text-sm leading-relaxed text-text">{template.whenToUse}</p>
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold text-text-muted">メッセージライン例</h3>
            <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text">
              {template.messageLineExample}
            </p>
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section>
              <h3 className="mb-1 text-xs font-semibold text-text-muted">レイアウト</h3>
              <p className="text-sm leading-relaxed text-text">{template.layout}</p>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-text-muted">推奨ビジュアル</h3>
              <p className="text-sm leading-relaxed text-text">{template.recommendedVisual}</p>
            </section>
          </div>

          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-text-muted">構成</h3>
              <button
                type="button"
                onClick={copyStructure}
                className="rounded-full border border-border bg-surface-2 px-3 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
              >
                {copied ? 'コピーしました' : '構成をコピー'}
              </button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-text">
              {template.structure.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-text-muted">作成のコツ</h3>
            <ul className="space-y-1">
              {template.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-text">
                  <span className="mt-0.5 shrink-0 text-accent">✓</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* フッタ: 関連ガイドへの注記 */}
        <div className="border-t border-border p-4 text-[11px] text-text-faint md:p-5">
          より詳しい作り方は、リポジトリ内の関連ガイド{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5 text-text-muted">{GUIDE_PATH}</code>{' '}
          を参照してください。
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────

export default function SlideTemplates() {
  const { data, error, loading, fetchedAt } = useLiveResource<SlideTemplateCatalog>(
    '/api/templates',
  );
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SlideTemplate | null>(null);

  const templates = data?.templates ?? [];
  const categories = data?.categories ?? [];

  // カテゴリ key → ラベルの引き当て。
  const labelOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.key, c.label);
    return (key: string) => map.get(key) ?? key;
  }, [categories]);

  // カテゴリ別件数（バッジ用）。
  const countByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of templates) map.set(t.category, (map.get(t.category) ?? 0) + 1);
    return map;
  }, [templates]);

  // フィルタ: カテゴリ AND テキスト（name / useCases / whenToUse 部分一致・小文字化・trim）。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== 'all' && t.category !== category) return false;
      if (!q) return true;
      const haystack = [t.name, ...t.useCases, t.whenToUse].join('\n').toLowerCase();
      return haystack.includes(q);
    });
  }, [templates, category, query]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="スライド型"
        subtitle="様式カタログ — 用途から型を探す"
        fetchedAt={fetchedAt}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <>
              {/* カテゴリフィルタ（タブ）＋件数バッジ */}
              <div
                className="mb-3 flex flex-wrap gap-1.5"
                role="tablist"
                aria-label="カテゴリフィルタ"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={category === 'all'}
                  onClick={() => setCategory('all')}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    category === 'all'
                      ? 'bg-accent text-bg font-semibold'
                      : 'bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
                  }`}
                >
                  すべて
                  <span className="ml-1 text-[10px] opacity-70">{templates.length}</span>
                </button>
                {categories.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="tab"
                    aria-selected={category === c.key}
                    onClick={() => setCategory(c.key)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      category === c.key
                        ? 'bg-accent text-bg font-semibold'
                        : 'bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
                    }`}
                  >
                    {c.label}
                    <span className="ml-1 text-[10px] opacity-70">
                      {countByCategory.get(c.key) ?? 0}
                    </span>
                  </button>
                ))}
              </div>

              {/* 用途から探す（テキスト検索） */}
              <div className="mb-4 flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5">
                <span className="shrink-0 text-text-faint">
                  <SearchIcon width={15} height={15} />
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="用途から探す（例: 提案 / 推移 / 構成比 / As-Is）"
                  className="w-full bg-transparent text-sm text-text placeholder-text-faint focus:outline-none"
                  aria-label="用途から探す"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="shrink-0 rounded p-0.5 text-text-faint hover:bg-surface-3 hover:text-text"
                    aria-label="検索をクリア"
                  >
                    <CloseIcon width={14} height={14} />
                  </button>
                )}
              </div>

              {/* カードグリッド */}
              {filtered.length === 0 ? (
                <EmptyState>
                  条件に合うテンプレートがありません。検索語やカテゴリを変えてみてください。
                </EmptyState>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      categoryLabel={labelOf(t.category)}
                      onSelect={setSelected}
                    />
                  ))}
                </div>
              )}

              {/* 出典表示 */}
              {data.source && (
                <p className="mt-6 text-[11px] leading-relaxed text-text-faint">
                  出典: {data.source}
                </p>
              )}
            </>
          )}
        </ResourceState>
      </div>

      {selected && (
        <TemplateDetail
          template={selected}
          categoryLabel={labelOf(selected.category)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
