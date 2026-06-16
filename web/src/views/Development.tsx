// Development — 開発ページ。AI に文章で画面を指示すると HTML モックアップを生成し、
// iframe でプレビュー・修正反復・コード編集・保存/一覧ができる。
//
// 2ペイン（左=操作、右=プレビュー）。モバイルは縦積み。
// プレビューは sandbox="allow-scripts"（allow-same-origin は付けない＝AI 生成 HTML を隔離）。
// API: POST /api/dev/mockup/generate, GET/POST /api/dev/mockups, GET/DELETE /api/dev/mockups/:id。
import { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Spinner, EmptyState } from '../components/ui';
import { SparkIcon, TrashIcon } from '../components/icons';

interface MockupSummary {
  id: string;
  title: string;
  prompt?: string;
  createdAt: string;
  updatedAt: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body?.error ?? body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

// 非同期ジョブのポーリング設定。生成は Cloudflare エッジ（約100s）を避けるため
// POST→202 { jobId } を受けて GET /job/:id を約2秒間隔でポーリングする。
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_WAIT_MS = 5 * 60_000; // 約5分でタイムアウト。

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /api/dev/mockup/generate に body を送ってジョブを起票し、完了までポーリングして HTML を返す。
 * - サーバの error 文言は throw（呼び出し側で setError）。
 * - 404（ジョブ消失）/ タイムアウトは専用メッセージで throw。
 */
async function runMockupJob(
  body: Record<string, unknown>,
  startFallback: string,
): Promise<string> {
  // 起票 POST。モバイル等の一過性 fetch 失敗（"Failed to fetch"）は数回まで再試行する。
  let startRes: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      startRes = await fetch('/api/dev/mockup/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      break;
    } catch {
      if (attempt === 2) throw new Error(startFallback);
      await sleep(1_500);
    }
  }
  if (!startRes) throw new Error(startFallback);
  if (!startRes.ok) throw new Error(await readError(startRes, startFallback));
  const startData = (await startRes.json()) as { jobId?: string };
  const jobId = startData.jobId;
  if (!jobId) throw new Error(startFallback);

  const deadline = Date.now() + POLL_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    // ポーリング中の fetch 例外（モバイルの電波揺らぎ等で "Failed to fetch"）・非JSON・!ok は
    // 致命扱いせず次の周回で再試行する。中断するのは 404（ジョブ消失）・error・タイムアウトのみ。
    let pollRes: Response;
    try {
      pollRes = await fetch(`/api/dev/mockup/job/${encodeURIComponent(jobId)}`);
    } catch {
      continue;
    }
    if (pollRes.status === 404) {
      throw new Error('もう一度お試しください');
    }
    if (!pollRes.ok) continue;
    let data: { status?: string; html?: string; error?: string };
    try {
      data = (await pollRes.json()) as { status?: string; html?: string; error?: string };
    } catch {
      continue;
    }
    if (data.status === 'done') return data.html ?? '';
    if (data.status === 'error') throw new Error(data.error || startFallback);
    // status === 'pending' は継続。
  }
  throw new Error('時間がかかっています。後ほどお試しください');
}

export default function Development() {
  // 操作状態
  const [prompt, setPrompt] = useState('');
  const [instruction, setInstruction] = useState('');
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');

  // 非同期/通知状態
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 現在編集中のモックアップ id（保存済みを読み込んだ/保存した場合に入る）。
  const [currentId, setCurrentId] = useState<string | null>(null);

  // 一覧
  const [mockups, setMockups] = useState<MockupSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // プレビューに反映する html（編集デバウンス用）。
  const [previewHtml, setPreviewHtml] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // html 変更 → 250ms デバウンスでプレビューへ反映。
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setPreviewHtml(html), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [html]);

  const loadList = useCallback(() => {
    setListLoading(true);
    fetch('/api/dev/mockups')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('list failed'))))
      .then((data: { mockups?: MockupSummary[] }) => {
        setMockups(data.mockups ?? []);
        setListLoading(false);
      })
      .catch(() => {
        setMockups([]);
        setListLoading(false);
      });
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // 通知は数秒で自動的に消す。
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(id);
  }, [notice]);

  // 新規生成。
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const out = await runMockupJob({ prompt: prompt.trim() }, '生成に失敗しました');
      setHtml(out);
      setPreviewHtml(out);
      setCurrentId(null); // 新規生成は未保存扱い。
      if (!title.trim()) setTitle(prompt.trim().slice(0, 40));
      setNotice('モックアップを生成しました。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成に失敗しました');
    } finally {
      setGenerating(false);
    }
  }, [prompt, generating, title]);

  // 反復修正。
  const handleRevise = useCallback(async () => {
    if (!html.trim() || !instruction.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const out = await runMockupJob(
        { baseHtml: html, instruction: instruction.trim() },
        '修正に失敗しました',
      );
      setHtml(out);
      setPreviewHtml(out);
      setInstruction('');
      setNotice('モックアップを修正しました。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '修正に失敗しました');
    } finally {
      setGenerating(false);
    }
  }, [html, instruction, generating]);

  // 保存（upsert）。
  const handleSave = useCallback(async () => {
    if (!title.trim() || !html.trim() || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/dev/mockups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(currentId ? { id: currentId } : {}),
          title: title.trim(),
          html,
          ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(await readError(res, '保存に失敗しました'));
      const data = (await res.json()) as { mockup?: { id?: string } };
      if (data.mockup?.id) setCurrentId(data.mockup.id);
      setNotice('保存しました。');
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }, [title, html, prompt, currentId, saving, loadList]);

  // 一覧から読込。
  const handleLoad = useCallback(async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/dev/mockups/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(await readError(res, '読み込みに失敗しました'));
      const data = (await res.json()) as {
        mockup?: { id: string; title: string; html: string; prompt?: string };
      };
      const m = data.mockup;
      if (!m) throw new Error('読み込みに失敗しました');
      setCurrentId(m.id);
      setTitle(m.title);
      setHtml(m.html);
      setPreviewHtml(m.html);
      setPrompt(m.prompt ?? '');
      setInstruction('');
      setNotice(`「${m.title}」を読み込みました。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, []);

  // 削除。
  const handleDelete = useCallback(
    async (id: string, mockupTitle: string) => {
      if (!window.confirm(`「${mockupTitle}」を削除します。よろしいですか？`)) return;
      try {
        const res = await fetch(`/api/dev/mockups/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await readError(res, '削除に失敗しました'));
        if (currentId === id) setCurrentId(null);
        setNotice('削除しました。');
        loadList();
      } catch (e) {
        setError(e instanceof Error ? e.message : '削除に失敗しました');
      }
    },
    [currentId, loadList],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="開発" subtitle="作りたい画面を説明すると、AI が HTML モックアップを生成します。" />

      {/* 通知/エラー帯 */}
      {(error || notice) && (
        <div className="px-4 pt-3 md:px-6">
          {error && (
            <div
              className="rounded-md border border-stalled/40 px-3 py-2 text-xs"
              style={{ color: 'var(--mc-stalled)', background: 'var(--mc-stalled-bg)' }}
              role="alert"
            >
              {error}
            </div>
          )}
          {notice && !error && (
            <div
              className="rounded-md border border-idle/30 px-3 py-2 text-xs"
              style={{ color: 'var(--mc-active)', background: 'var(--mc-active-bg)' }}
              role="status"
            >
              {notice}
            </div>
          )}
        </div>
      )}

      {/* 2ペイン: 左=操作 / 右=プレビュー。モバイルは縦積み。 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* 左ペイン: 操作 */}
        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-border p-4 md:w-[26rem] md:border-b-0 md:border-r">
          {/* 生成 */}
          <section className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-text-muted" htmlFor="dev-prompt">
              作りたい画面の説明
            </label>
            <textarea
              id="dev-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例: EC サイトの商品詳細ページ。画像・価格・カートボタン付き"
              rows={4}
              className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--mc-accent)', color: 'var(--mc-bg)' }}
            >
              {generating ? <Spinner /> : <SparkIcon width={16} height={16} />}
              {generating ? '生成中…' : '生成'}
            </button>
          </section>

          {/* 反復修正（html がある時のみ） */}
          {html.trim() && (
            <section className="flex flex-col gap-2 border-t border-border pt-4">
              <label className="text-xs font-semibold text-text-muted" htmlFor="dev-instruction">
                修正指示
              </label>
              <textarea
                id="dev-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例: 配色を青基調にして、カートボタンを大きく目立たせてください"
                rows={3}
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={handleRevise}
                disabled={generating || !instruction.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? <Spinner /> : null}
                修正
              </button>
            </section>
          )}

          {/* コードエディタ */}
          {html.trim() && (
            <section className="flex flex-col gap-2 border-t border-border pt-4">
              <label className="text-xs font-semibold text-text-muted" htmlFor="dev-code">
                HTML コード（編集するとプレビューに反映されます）
              </label>
              <textarea
                id="dev-code"
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                rows={10}
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-text focus:border-accent focus:outline-none"
              />
            </section>
          )}

          {/* 保存 */}
          {html.trim() && (
            <section className="flex flex-col gap-2 border-t border-border pt-4">
              <label className="text-xs font-semibold text-text-muted" htmlFor="dev-title">
                タイトル
              </label>
              <div className="flex gap-2">
                <input
                  id="dev-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="モックアップのタイトル"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !title.trim() || !html.trim()}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Spinner /> : null}
                  {currentId ? '上書き保存' : '保存'}
                </button>
              </div>
            </section>
          )}

          {/* 保存済み一覧 */}
          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <div className="text-xs font-semibold text-text-muted">保存済みモックアップ</div>
            {listLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-text-muted">
                <Spinner />
                <span>読み込み中…</span>
              </div>
            ) : mockups.length === 0 ? (
              <p className="py-2 text-xs text-text-faint">まだ保存されたモックアップはありません。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {mockups.map((m) => (
                  <li
                    key={m.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                      currentId === m.id ? 'border-accent bg-surface-2' : 'border-border hover:bg-surface-2'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void handleLoad(m.id)}
                      className="min-w-0 flex-1 text-left"
                      title={m.title}
                    >
                      <div className="truncate text-sm text-text">{m.title}</div>
                      <div className="text-[10px] text-text-faint">
                        {new Date(m.updatedAt).toLocaleString('ja-JP')}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(m.id, m.title)}
                      aria-label={`「${m.title}」を削除`}
                      className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-stalled-bg hover:text-stalled"
                    >
                      <TrashIcon width={15} height={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* 右ペイン: プレビュー */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-xs font-semibold text-text-muted">プレビュー</span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {previewHtml.trim() ? (
              <iframe
                title="モックアッププレビュー"
                srcDoc={previewHtml}
                // AI 生成 HTML を隔離: スクリプトは許可するが same-origin は付けない。
                sandbox="allow-scripts"
                className="h-full w-full rounded-lg border border-border bg-white"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <EmptyState>
                  左の入力欄に作りたい画面を説明して「生成」を押すと、ここにプレビューが表示されます。
                </EmptyState>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
