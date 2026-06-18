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

// ─── 作業状態の永続化（localStorage）──────────────────────────────
//
// ページを離れる/リロードすると React 状態は消えるが、入力中・生成結果・生成中ジョブを
// localStorage に退避しておき、戻ってきたときに復元・ジョブを再開する。
// モバイルでは「生成中に他画面を見て戻る」が頻発するため、これが無いと毎回真っ白になり
// 「生成できてない/消えた」ように見える。サーバ側ジョブはインメモリで 15 分保持されるので、
// その間ならジョブ ID から完了を取り直せる。

/** 編集中ドラフトの保存キー。 */
const DRAFT_KEY = 'dev-mockup-draft-v1';
/** 生成中ジョブの保存キー。 */
const JOB_KEY = 'dev-mockup-job-v1';

/** 編集中ドラフト（入力・生成結果・選択中 id）。 */
interface DraftState {
  prompt: string;
  instruction: string;
  title: string;
  html: string;
  currentId: string | null;
}

/** 進行中ジョブ（「作成中」カード表示・離脱/リロード後の再開に使う）。 */
interface JobState {
  jobId: string;
  mode: 'generate' | 'revise';
  /** 起票時刻（ms）。経過秒の起点。POLL_MAX_WAIT_MS を超えた古いジョブは復元対象外。 */
  startedAt: number;
  /** 「作成中」カードに出す名前（生成=要望先頭 / 修正=指示先頭）。 */
  label: string;
  /** 完了時にエディタへ結果を反映するか。新規作成を押すと false になり、一覧表示だけ残る。 */
  attachToEditor: boolean;
  /** 修正対象の既存モックアップ id（あれば一覧の当該行は「作成中」カードに集約して隠す）。 */
  targetId?: string;
}

function loadDraft(): DraftState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DraftState) : null;
  } catch {
    return null;
  }
}
function saveDraft(d: DraftState): void {
  try {
    // 何も入力されていない真っ白状態はキー自体を消す（ゴミを残さない）。
    if (!d.prompt && !d.instruction && !d.title && !d.html && !d.currentId) {
      localStorage.removeItem(DRAFT_KEY);
    } else {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    }
  } catch {
    /* localStorage 不可（プライベートブラウズ等）でも機能自体は壊さない。 */
  }
}
/** 進行中ジョブ配列を読む。古い単一オブジェクト形式は無視（配列のみ受理）。期限切れは除外。 */
function loadJobs(): JobState[] {
  try {
    const raw = localStorage.getItem(JOB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as JobState[]).filter(
      (j) => j && typeof j.jobId === 'string' && now - j.startedAt <= POLL_MAX_WAIT_MS,
    );
  } catch {
    return [];
  }
}
function saveJobs(jobs: JobState[]): void {
  try {
    if (jobs.length === 0) localStorage.removeItem(JOB_KEY);
    else localStorage.setItem(JOB_KEY, JSON.stringify(jobs));
  } catch {
    /* noop */
  }
}

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
 * POST /api/dev/mockup/generate に body を送ってジョブを起票し、jobId を返す。
 * モバイル等の一過性 fetch 失敗（"Failed to fetch"）は数回まで再試行する。
 */
async function startMockupJob(
  body: Record<string, unknown>,
  startFallback: string,
): Promise<string> {
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
  return jobId;
}

/**
 * 既存 jobId の完了までポーリングする（起票とは分離＝離脱・リロード後の再開でも使える）。
 * - 完了: { status:'done', html, mockupId, saved }。
 * - サーバ error / 404（ジョブ消失）: throw（呼び出し側で setError）。
 * - タイムアウト: { status:'timeout' }（生成はバックグラウンドで継続し、完了後に自動保存される）。
 * @param sinceMs 経過起点（再開時は元の startedAt）。残り時間 = POLL_MAX_WAIT_MS - 経過。
 */
async function pollMockupJob(
  jobId: string,
  startFallback: string,
  sinceMs: number = Date.now(),
  onPartial?: (partial: string) => void,
): Promise<JobResult> {
  const deadline = sinceMs + POLL_MAX_WAIT_MS;
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
      partial?: string;
      error?: string;
      mockupId?: string;
      saved?: SavedScreen[];
    };
    try {
      data = (await pollRes.json()) as typeof data;
    } catch {
      continue;
    }
    // 生成途中の部分コードを逐次コールバック（ライブ表示用）。
    if (data.status === 'generating' && typeof data.partial === 'string' && onPartial) {
      onPartial(data.partial);
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

// 生成中のライブ表示で「いま何をしているか」を、プログラミング未経験者にも分かる平易な日本語で示す。
// 流れてきた HTML のどのセクションを書いているか（最後に登場したタグ）で大まかな段階を判定する。
const STREAM_PHASES: { key: string; label: string }[] = [
  { key: '<html', label: '📄 ページの土台（基本設定）を準備しています' },
  { key: '<style', label: '🎨 見た目（色・配置・文字の大きさ）をデザインしています' },
  { key: '<body', label: '🧱 画面に出す部品（文字・ボタン・入力欄など）を組み立てています' },
  { key: '<script', label: '⚙️ ボタンを押したときなどの「動き」をプログラムしています' },
];

/** 流れてきたコードから現在の作業段階を平易な日本語で返す。 */
function describeStreamPhase(code: string): string {
  const lower = code.toLowerCase();
  let best = '✍️ コードを書き始めています';
  let bestIdx = -1;
  for (const p of STREAM_PHASES) {
    const idx = lower.lastIndexOf(p.key);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = p.label;
    }
  }
  return best;
}

export default function Development() {
  // 起動時に localStorage からドラフトを 1 回だけ読む（離脱/リロードからの復元）。
  const [bootDraft] = useState(loadDraft);

  // 操作状態（ドラフトがあれば復元）。
  const [prompt, setPrompt] = useState(bootDraft?.prompt ?? '');
  const [instruction, setInstruction] = useState(bootDraft?.instruction ?? '');
  const [title, setTitle] = useState(bootDraft?.title ?? '');
  const [html, setHtml] = useState(bootDraft?.html ?? '');

  // 非同期/通知状態
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 進行中ジョブ（「作成中」として一覧に表示・離脱/リロードでも保持）。起動時に復元する。
  const [activeJobs, setActiveJobs] = useState<JobState[]>(loadJobs);
  // 既にポーリング中の jobId（多重ポーリング防止）。
  const pollingRef = useRef<Set<string>>(new Set());
  // 「作成中」カードの経過秒数表示用に 1 秒ごとに進む現在時刻。
  const [nowTick, setNowTick] = useState(() => Date.now());
  // エディタに紐づくジョブの「生成中の部分コード」（ライブ表示用）。
  const [streamCode, setStreamCode] = useState('');

  // エディタに紐づく進行中ジョブ（あればエディタ側の進捗バーと生成ボタン無効化に使う）。
  const editorJob = activeJobs.find((j) => j.attachToEditor) ?? null;
  const generating = editorJob !== null;

  // 現在編集中のモックアップ id（保存済みを読み込んだ/保存した場合に入る）。
  const [currentId, setCurrentId] = useState<string | null>(bootDraft?.currentId ?? null);

  // スマホ幅(md未満)での表示ペイン切替。デスクトップ(md+)では無視され両ペイン横並び。
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');

  // エディタ側の進捗バー用の経過秒数（エディタに紐づくジョブの起点から算出）。
  const elapsed = editorJob ? Math.max(0, Math.floor((nowTick - editorJob.startedAt) / 1000)) : 0;

  // 一覧
  const [mockups, setMockups] = useState<MockupSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // プレビューに反映する html（編集デバウンス用）。復元時は即プレビューも復元する。
  const [previewHtml, setPreviewHtml] = useState(bootDraft?.html ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ライブコード表示の自動スクロール用。
  const streamPreRef = useRef<HTMLPreElement | null>(null);

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

  // 入力・生成結果・選択中 id が変わるたびに localStorage へ退避する（離脱/リロード復元用）。
  useEffect(() => {
    saveDraft({ prompt, instruction, title, html, currentId });
  }, [prompt, instruction, title, html, currentId]);

  // 進行中ジョブ配列が変わるたびに localStorage へ退避する（離脱/リロードでも「作成中」を保持）。
  useEffect(() => {
    saveJobs(activeJobs);
  }, [activeJobs]);

  // 進行中ジョブがある間だけ 1 秒ごとに現在時刻を進め、「作成中」カードの経過秒を更新する。
  useEffect(() => {
    if (activeJobs.length === 0) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activeJobs.length]);

  // 進行中ジョブをバックグラウンドでポーリングする。未ポーリングのジョブだけ拾って完了まで追う。
  // ここで完了/失敗を捌くことで、生成は「エディタの async フロー」から切り離され、
  // 新規作成・画面遷移・リロードをまたいでも進行→完了→一覧反映まで生き続ける。
  useEffect(() => {
    for (const job of activeJobs) {
      if (pollingRef.current.has(job.jobId)) continue;
      pollingRef.current.add(job.jobId);
      const fallback = job.mode === 'revise' ? '修正に失敗しました' : '生成に失敗しました';
      pollMockupJob(
        job.jobId,
        fallback,
        job.startedAt,
        // エディタに紐づくジョブだけ、生成中の部分コードをライブ表示する。
        job.attachToEditor ? (p) => setStreamCode(p) : undefined,
      )
        .then((r) => {
          if (r.status === 'done') {
            // 完了時、そのジョブがエディタに紐づいているならエディタへ結果を反映する。
            if (job.attachToEditor) {
              setHtml(r.html);
              setPreviewHtml(r.html);
              setCurrentId(r.mockupId ?? r.saved[0]?.id ?? null);
              if (r.saved[0]?.title) setTitle(r.saved[0].title);
              if (job.mode === 'revise') setInstruction('');
              setStreamCode('');
              setMobileTab('preview');
            }
            setNotice(
              job.mode === 'revise'
                ? '修正が完了しました（一覧にも自動保存済み）。'
                : `「${job.label}」が完成しました（一覧にも自動保存済み）。`,
            );
          } else {
            setNotice(
              '生成に時間がかかっています。完了すると下の「保存済みモックアップ」に自動保存されます。',
            );
          }
          loadList();
        })
        .catch((e) => {
          // 404（サーバ再起動等でジョブ消失）でも完了済みなら一覧に自動保存されている。
          // attachToEditor のジョブのみ赤エラーを出し、デタッチ済み（新規作成後）は静かに一覧更新。
          if (job.attachToEditor) {
            setError(e instanceof Error ? e.message : fallback);
            setStreamCode('');
          } else {
            setNotice('完了した試作品は下の「保存済みモックアップ」をご確認ください。');
          }
          loadList();
        })
        .finally(() => {
          pollingRef.current.delete(job.jobId);
          setActiveJobs((prev) => prev.filter((j) => j.jobId !== job.jobId));
        });
    }
  }, [activeJobs, loadList]);

  // 通知は数秒で自動的に消す。
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  // ライブコードが伸びるたびに末尾へ自動スクロール（最新の行が見えるように）。
  useEffect(() => {
    const el = streamPreRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamCode]);

  // 新規生成。起票だけして「進行中ジョブ」に積む（完了はバックグラウンドのポーリングが捌く）。
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setError(null);
    setNotice(null);
    const label = prompt.trim().slice(0, 40) || 'モックアップ';
    try {
      const jobId = await startMockupJob({ prompt: prompt.trim() }, '生成に失敗しました');
      // 既存ジョブのエディタ紐付けを外し、この新ジョブをエディタに紐づけて先頭に積む。
      setActiveJobs((prev) => [
        { jobId, mode: 'generate', startedAt: Date.now(), label, attachToEditor: true },
        ...prev.map((j) => ({ ...j, attachToEditor: false })),
      ]);
      if (!title.trim()) setTitle(label);
      setStreamCode('');
      setMobileTab('preview'); // 生成中のコードがライブで見えるプレビュー側へ。
      setNotice('作成を開始しました。コードが書かれていく様子をプレビュー側に表示します。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成に失敗しました');
    }
  }, [prompt, generating, title]);

  // 反復修正。起票だけして「進行中ジョブ」に積む。
  const handleRevise = useCallback(async () => {
    if (!html.trim() || !instruction.trim() || generating) return;
    setError(null);
    setNotice(null);
    const label = `修正: ${instruction.trim().slice(0, 30)}`;
    try {
      const jobId = await startMockupJob(
        {
          baseHtml: html,
          instruction: instruction.trim(),
          ...(currentId ? { id: currentId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
        },
        '修正に失敗しました',
      );
      setActiveJobs((prev) => [
        {
          jobId,
          mode: 'revise',
          startedAt: Date.now(),
          label,
          attachToEditor: true,
          ...(currentId ? { targetId: currentId } : {}),
        },
        ...prev.map((j) => ({ ...j, attachToEditor: false })),
      ]);
      setStreamCode('');
      setMobileTab('preview');
      setNotice('修正を開始しました。コードが書かれていく様子をプレビュー側に表示します。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '修正に失敗しました');
    }
  }, [html, instruction, generating, currentId, title]);

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
    setStreamCode('');
    // 進行中ジョブは消さない。エディタ紐付けだけ外し、一覧に「作成中」で見え続けるようにする。
    setActiveJobs((prev) => prev.map((j) => ({ ...j, attachToEditor: false })));
    setNotice('新規作成にしました。作成中のものは下の一覧に「作成中」で表示され続けます。');
    setMobileTab('edit');
  }, []);

  // 修正中（targetId 付き）の既存モックアップは一覧から隠し、「作成中」カードに集約する（重複表示防止）。
  const revisingIds = new Set(
    activeJobs.map((j) => j.targetId).filter((id): id is string => Boolean(id)),
  );
  const visibleMockups = mockups.filter((m) => !revisingIds.has(m.id));

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

          {/* 保存済み一覧（先頭に「作成中」カードを出す） */}
          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <div className="text-xs font-semibold text-text-muted">保存済みモックアップ</div>

            {/* 作成中カード: 進行中ジョブを「作成中… N秒」で表示。新規作成・画面遷移後も出続ける。 */}
            {activeJobs.length > 0 && (
              <ul className="flex flex-col gap-1">
                {activeJobs.map((job) => {
                  const sec = Math.max(0, Math.floor((nowTick - job.startedAt) / 1000));
                  return (
                    <li
                      key={job.jobId}
                      className="flex items-center gap-2 rounded-lg border border-accent px-3 py-2"
                      style={{ background: 'var(--mc-active-bg)' }}
                    >
                      <Spinner />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-text">
                          {job.label || (job.mode === 'revise' ? '修正' : 'モックアップ')}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--mc-active)' }}>
                          作成中… {sec}秒（完了すると自動でここに保存されます）
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {listLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-text-muted">
                <Spinner />
                <span>読み込み中…</span>
              </div>
            ) : visibleMockups.length === 0 ? (
              activeJobs.length === 0 && (
                <p className="py-2 text-xs text-text-faint">まだ保存されたモックアップはありません。</p>
              )
            ) : (
              <ul className="flex flex-col gap-1">
                {visibleMockups.map((m) => (
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
            <span className="text-xs font-semibold text-text-muted">
              {generating ? 'コードを生成中…' : 'プレビュー'}
            </span>
            {generating && (
              <span
                className="flex items-center gap-1.5 text-[11px]"
                style={{ color: 'var(--mc-active)' }}
              >
                <Spinner /> {elapsed}秒
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {generating ? (
              // 生成中: claude が書いているコードをリアルタイムに流す（末尾自動スクロール）。
              streamCode ? (
                <div className="flex h-full flex-col gap-2">
                  {/* いま何をしているかを平易な日本語で（未経験者向け） */}
                  <div
                    className="flex items-center gap-2 rounded-lg border border-accent px-3 py-2 text-xs font-semibold"
                    style={{ background: 'var(--mc-active-bg)', color: 'var(--mc-active)' }}
                  >
                    <Spinner />
                    <span>{describeStreamPhase(streamCode)}</span>
                  </div>
                  <p className="text-[10px] text-text-faint">
                    ↓ AI が実際に書いているコードです（各部分の説明コメント付き）。完成すると下に実際の画面が出ます。
                  </p>
                  <pre
                    ref={streamPreRef}
                    className="min-h-0 w-full flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-text"
                  >
                    {streamCode}
                    <span className="animate-pulse">▋</span>
                  </pre>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Spinner />
                    <span>コードの生成を待っています…</span>
                  </div>
                </div>
              )
            ) : previewHtml.trim() ? (
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
