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
const POLL_MAX_WAIT_MS = 9 * 60_000; // 約9分。サーバの最大生成時間(240s×2)を見届けられる長さ。

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 自動保存できた結果（id+title）。 */
interface SavedScreen {
  id: string;
  title: string;
}

type JobResult =
  | { status: 'done'; html: string; mockupId?: string; saved: SavedScreen[] }
  | { status: 'timeout' };

/**
 * POST /api/dev/mockup/generate に body を送ってジョブを起票し、完了までポーリングする。
 * - 完了: { status:'done', html, mockupId, saved }。生成・修正とも「1 つの動くインタラクティブな
 *     単一 HTML」を生成して自動保存する。html/mockupId は生成結果、saved は自動保存できた結果（1 件）。
 * - サーバ error / 404（ジョブ消失）: throw（呼び出し側で setError）。
 * - タイムアウト: { status:'timeout' }（生成はバックグラウンドで継続し、完了後に自動保存される）。
 */
async function runMockupJob(
  body: Record<string, unknown>,
  startFallback: string,
): Promise<JobResult> {
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
    let data: {
      status?: string;
      html?: string;
      error?: string;
      mockupId?: string;
      saved?: SavedScreen[];
    };
    try {
      data = (await pollRes.json()) as typeof data;
    } catch {
      continue;
    }
    if (data.status === 'done') {
      const saved = Array.isArray(data.saved) ? data.saved : [];
      return {
        status: 'done',
        html: data.html ?? '',
        mockupId: data.mockupId,
        saved,
      };
    }
    if (data.status === 'error') throw new Error(data.error || startFallback);
    // pending / generating は継続（経過秒表示は呼び出し側の elapsed が担う）。
  }
  // 上限時間到達。生成はサーバで継続中＝完了後に自動保存される。
  return { status: 'timeout' };
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

  // スマホ幅(md未満)での表示ペイン切替。デスクトップ(md+)では無視され両ペイン横並び。
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');

  // 生成/修正中の経過秒数（進捗表示用）。generating が true の間だけ 1 秒間隔で加算する。
  const [elapsed, setElapsed] = useState(0);

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

  // 生成/修正中だけ経過秒数を 1 秒間隔で更新。停止時は 0 にリセットし interval を破棄。
  useEffect(() => {
    if (!generating) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [generating]);

  // 通知は数秒で自動的に消す。
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  // 新規生成。
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const r = await runMockupJob({ prompt: prompt.trim() }, '生成に失敗しました');
      if (r.status === 'timeout') {
        setNotice(
          '生成に時間がかかっています。完了すると下の「保存済みモックアップ」に自動保存されます。このページを離れても大丈夫です。',
        );
        loadList();
        [15000, 30000, 60000, 90000].forEach((ms) => window.setTimeout(loadList, ms));
      } else {
        setHtml(r.html);
        setPreviewHtml(r.html);
        setCurrentId(r.mockupId ?? r.saved[0]?.id ?? null);
        if (r.saved[0]?.title) setTitle(r.saved[0].title);
        else if (!title.trim()) setTitle(prompt.trim().slice(0, 40));
        setNotice('動く試作品を生成しました（下の一覧にも自動保存済み）。');
        setMobileTab('preview');
        loadList();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成に失敗しました');
    } finally {
      setGenerating(false);
    }
  }, [prompt, generating, title, loadList]);

  // 反復修正。
  const handleRevise = useCallback(async () => {
    if (!html.trim() || !instruction.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const r = await runMockupJob(
        {
          baseHtml: html,
          instruction: instruction.trim(),
          ...(currentId ? { id: currentId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
        },
        '修正に失敗しました',
      );
      if (r.status === 'timeout') {
        setNotice(
          '修正に時間がかかっています。完了すると下の「保存済みモックアップ」に自動保存されます。このページを離れても大丈夫です。',
        );
        loadList();
        [15000, 30000, 60000, 90000].forEach((ms) => window.setTimeout(loadList, ms));
      } else {
        setHtml(r.html);
        setPreviewHtml(r.html);
        setInstruction('');
        if (r.mockupId) setCurrentId(r.mockupId);
        setNotice('モックアップを修正しました（下の一覧にも自動保存済み）。');
        setMobileTab('preview');
        loadList();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '修正に失敗しました');
    } finally {
      setGenerating(false);
    }
  }, [html, instruction, generating, currentId, title, loadList]);

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
      setMobileTab('preview');
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

  // 新規作成: 入力・コード・プレビュー・選択中 id をすべてクリアして白紙に戻す。
  // 生成物は一覧に自動保存済みのため、ここで消えても「保存済みモックアップ」から再度開ける。
  const handleNew = useCallback(() => {
    setPrompt('');
    setInstruction('');
    setTitle('');
    setHtml('');
    setPreviewHtml('');
    setCurrentId(null);
    setError(null);
    setNotice('新規作成にしました。');
    setMobileTab('edit');
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="開発" subtitle="作りたい画面や機能を説明すると、AI がボタンが実際に動く試作品を 1 つ生成します。" />

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

      {/* スマホ幅のみ: 操作 / プレビュー のタブ切替。デスクトップ(md+)は両ペイン横並びのため非表示。 */}
      <div className="px-4 pt-3 md:hidden">
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1" role="tablist">
          {([
            ['edit', '操作'],
            ['preview', 'プレビュー'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mobileTab === key}
              onClick={() => setMobileTab(key)}
              className="flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
              style={
                mobileTab === key
                  ? { background: 'var(--mc-accent)', color: 'var(--mc-bg)' }
                  : { color: 'var(--mc-text-muted)' }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 2ペイン: 左=操作 / 右=プレビュー。スマホはタブで片方のみ表示、md+ は横並び。 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* 左ペイン: 操作。スマホは flex-1 で画面いっぱい＋内部スクロール、md+ は固定幅。 */}
        <div
          className={`${
            mobileTab === 'edit' ? 'flex' : 'hidden'
          } w-full min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-b border-border p-4 md:flex md:w-[26rem] md:flex-none md:border-b-0 md:border-r`}
        >
          {/* 生成 */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-text-muted" htmlFor="dev-prompt">
                作りたい画面や機能の説明（ボタンが実際に動く試作品を 1 つ作ります）
              </label>
              <button
                type="button"
                onClick={handleNew}
                className="shrink-0 rounded px-2 py-0.5 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                ＋ 新規作成
              </button>
            </div>
            <textarea
              id="dev-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例: サムネイル作成ツール。タイトルを入力して『サムネ生成』を押すと、サンプルのサムネが実際に表示される"
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

            {/* 生成/修正中の進捗。経過秒＋推定90秒ベースの簡易バー。 */}
            {generating && (
              <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full transition-[width] duration-1000 ease-linear"
                    style={{
                      width: `${Math.min(95, Math.round((elapsed / 90) * 100))}%`,
                      background: 'var(--mc-accent)',
                    }}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-text-muted">
                  生成中… {elapsed}秒（混雑時は1〜2分ほどかかることがあります。完了すると下の保存済み一覧にも自動保存されます）
                </p>
              </div>
            )}
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

        {/* 右ペイン: プレビュー。スマホはタブ選択時のみ表示、md+ は常時横並び。 */}
        <div
          className={`${
            mobileTab === 'preview' ? 'flex' : 'hidden'
          } min-h-0 min-w-0 flex-1 flex-col bg-surface-2 md:flex`}
        >
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
