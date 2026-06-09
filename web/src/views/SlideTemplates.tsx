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
  recommended,
  reason,
}: {
  template: SlideTemplate;
  categoryLabel: string;
  onSelect: (t: SlideTemplate) => void;
  recommended?: boolean;
  reason?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className={`flex flex-col gap-2 rounded-lg border bg-surface p-3 text-left transition-colors hover:border-accent/50 ${
        recommended ? 'border-accent ring-1 ring-accent/40' : 'border-border'
      }`}
    >
      {recommended && (
        <div className="flex flex-col gap-1">
          <span className="w-fit rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-bg">
            AIのおすすめ
          </span>
          {reason && <p className="text-[11px] leading-snug text-text-muted">{reason}</p>}
        </div>
      )}
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
  // pptx 出力・保存の状態。
  const [pptxBusy, setPptxBusy] = useState<'download' | 'save' | null>(null);
  const [pptxMsg, setPptxMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // AIで下書きの状態。
  const [context, setContext] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [draftCopied, setDraftCopied] = useState(false);

  const placeholders = template.placeholders ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 空 pptx をダウンロード（save 無し → Blob）。
  const downloadPptx = () => {
    if (pptxBusy) return;
    setPptxBusy('download');
    setPptxMsg(null);
    fetch(`/api/templates/${encodeURIComponent(template.id)}/pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || 'pptx の生成に失敗しました。');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${template.id}.pptx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch((e: unknown) =>
        setPptxMsg({ kind: 'error', text: e instanceof Error ? e.message : 'ダウンロードに失敗しました。' }),
      )
      .finally(() => setPptxBusy(null));
  };

  // Deliverables へ保存（save:true）。
  const savePptx = () => {
    if (pptxBusy) return;
    setPptxBusy('save');
    setPptxMsg(null);
    fetch(`/api/templates/${encodeURIComponent(template.id)}/pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ save: true }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { relpath?: string; error?: string };
        if (!res.ok || !body.relpath) {
          throw new Error(body.error || '保存に失敗しました。');
        }
        setPptxMsg({ kind: 'ok', text: `保存しました: ${body.relpath}` });
      })
      .catch((e: unknown) =>
        setPptxMsg({ kind: 'error', text: e instanceof Error ? e.message : '保存に失敗しました。' }),
      )
      .finally(() => setPptxBusy(null));
  };

  // AIで下書き（context → draft）。
  const runDraft = () => {
    if (draftBusy || !context.trim()) return;
    setDraftBusy(true);
    setDraftError(null);
    setDraft(null);
    setDraftMarkdown('');
    fetch(`/api/templates/${encodeURIComponent(template.id)}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: context.trim() }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          draft?: Record<string, string>;
          markdown?: string;
          error?: string;
        };
        if (body.error && (!body.draft || Object.keys(body.draft).length === 0)) {
          throw new Error(body.error);
        }
        setDraft(body.draft ?? {});
        setDraftMarkdown(body.markdown ?? '');
      })
      .catch((e: unknown) =>
        setDraftError(e instanceof Error ? e.message : '下書きの生成に失敗しました。'),
      )
      .finally(() => setDraftBusy(false));
  };

  const copyDraftMarkdown = () => {
    if (!draftMarkdown) return;
    void navigator.clipboard
      .writeText(draftMarkdown)
      .then(() => {
        setDraftCopied(true);
        setTimeout(() => setDraftCopied(false), 1800);
      })
      .catch(() => {
        /* クリップボード不可環境では無視 */
      });
  };

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

          {/* pptx 出力（空のたたき台） */}
          <section className="rounded-lg border border-border bg-surface-2 p-3">
            <h3 className="mb-2 text-xs font-semibold text-text-muted">pptx を作る（空のたたき台）</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadPptx}
                disabled={pptxBusy !== null}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-surface-3 disabled:opacity-50"
              >
                {pptxBusy === 'download' ? '生成中…' : '空のpptxをダウンロード'}
              </button>
              <button
                type="button"
                onClick={savePptx}
                disabled={pptxBusy !== null}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-surface-3 disabled:opacity-50"
              >
                {pptxBusy === 'save' ? '保存中…' : 'Deliverablesへ保存'}
              </button>
            </div>
            {pptxMsg && (
              <p
                className={`mt-2 break-all text-[11px] ${
                  pptxMsg.kind === 'ok' ? 'text-accent' : 'text-rose-400'
                }`}
              >
                {pptxMsg.text}
              </p>
            )}
          </section>

          {/* AIで下書き */}
          <section className="rounded-lg border border-border bg-surface-2 p-3">
            <h3 className="mb-2 text-xs font-semibold text-text-muted">AIで下書き</h3>
            <p className="mb-2 text-[11px] text-text-faint">
              会議の要旨や背景を入れると、各記入欄の下書きを AI が作成します。
            </p>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="会議要旨・背景など（例: 新製品Xへ5000万投資、12ヶ月で回収見込み）"
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={runDraft}
                disabled={draftBusy || !context.trim()}
                className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {draftBusy ? 'AIが下書き中…' : 'AIで下書き'}
              </button>
              {draftMarkdown && (
                <button
                  type="button"
                  onClick={copyDraftMarkdown}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
                >
                  {draftCopied ? 'コピーしました' : '全文コピー'}
                </button>
              )}
            </div>
            {draftError && <p className="mt-2 text-[11px] text-rose-400">{draftError}</p>}
            {draft && (
              <div className="mt-3 space-y-2">
                {placeholders.map((ph) => (
                  <div key={ph.id} className="rounded-lg border border-border bg-surface p-2.5">
                    <div className="mb-1 text-[11px] font-semibold text-accent">{ph.label}</div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">
                      {draft[ph.id]?.trim() ? draft[ph.id] : <span className="text-text-faint">（下書きなし）</span>}
                    </p>
                  </div>
                ))}
              </div>
            )}
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

  // AIに相談（推薦）の状態。
  const [consult, setConsult] = useState('');
  const [recBusy, setRecBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<
    { id: string; name: string; reason: string }[] | null
  >(null);

  const templates = data?.templates ?? [];
  const categories = data?.categories ?? [];

  // 推薦 id → 理由のマップ（カードのハイライト用）。
  const reasonById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of recommendations ?? []) map.set(r.id, r.reason);
    return map;
  }, [recommendations]);

  // AIに相談 → POST /recommend。
  const runRecommend = () => {
    if (recBusy || !consult.trim()) return;
    setRecBusy(true);
    setRecError(null);
    setRecommendations(null);
    fetch('/api/templates/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: consult.trim() }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          recommendations?: { id: string; name: string; reason: string }[];
          error?: string;
        };
        const recs = body.recommendations ?? [];
        if (recs.length === 0 && body.error) throw new Error(body.error);
        setRecommendations(recs);
        if (recs.length === 0) setRecError('該当する型が見つかりませんでした。');
      })
      .catch((e: unknown) =>
        setRecError(e instanceof Error ? e.message : '推薦の取得に失敗しました。'),
      )
      .finally(() => setRecBusy(false));
  };

  const clearRecommend = () => {
    setRecommendations(null);
    setRecError(null);
    setConsult('');
  };

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
  // 推薦がある場合は推薦された型を先頭に並べ替える（ハイライト＋優先表示）。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = templates.filter((t) => {
      if (category !== 'all' && t.category !== category) return false;
      if (!q) return true;
      const haystack = [t.name, ...t.useCases, t.whenToUse].join('\n').toLowerCase();
      return haystack.includes(q);
    });
    if (!recommendations || recommendations.length === 0) return base;
    const order = new Map(recommendations.map((r, i) => [r.id, i]));
    return [...base].sort((a, b) => {
      const ra = order.has(a.id) ? order.get(a.id)! : Infinity;
      const rb = order.has(b.id) ? order.get(b.id)! : Infinity;
      return ra - rb;
    });
  }, [templates, category, query, recommendations]);

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
              {/* AIに相談（作りたい資料を一言で → 推薦） */}
              <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold text-text-muted">AIに相談</h2>
                  {(recommendations || recError) && (
                    <button
                      type="button"
                      onClick={clearRecommend}
                      className="text-[11px] text-text-faint hover:text-text"
                    >
                      クリア
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={consult}
                    onChange={(e) => setConsult(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') runRecommend();
                    }}
                    placeholder="作りたい資料を一言で（例: 役員に投資判断を仰ぐ1枚）"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none"
                    aria-label="AIに相談"
                  />
                  <button
                    type="button"
                    onClick={runRecommend}
                    disabled={recBusy || !consult.trim()}
                    className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {recBusy ? '相談中…' : 'AIに相談'}
                  </button>
                </div>
                {recError && <p className="mt-2 text-[11px] text-rose-400">{recError}</p>}
                {recommendations && recommendations.length > 0 && (
                  <p className="mt-2 text-[11px] text-text-muted">
                    おすすめの型を下にハイライトしました（上位{recommendations.length}件）。
                  </p>
                )}
              </div>

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
                      recommended={reasonById.has(t.id)}
                      reason={reasonById.get(t.id)}
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
