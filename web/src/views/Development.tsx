// Development — 開発ページ。AI に文章で画面を指示すると HTML モックアップを生成し、
// iframe でプレビュー・修正反復・コード編集・保存/一覧ができる。
//
// 2ペイン（左=操作、右=プレビュー）。モバイルは縦積み。
// プレビューは sandbox="allow-scripts"（allow-same-origin は付けない＝AI 生成 HTML を隔離）。
// API: POST /api/dev/mockup/generate, GET/POST /api/dev/mockups, GET/DELETE /api/dev/mockups/:id。
import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Spinner, EmptyState } from '../components/ui';
import { SparkIcon, TrashIcon } from '../components/icons';

interface WireframeScreen {
  name: string;
  image?: string;
}
/** 完成 or 生成中のワイヤーフレーム（Figma ファイル URL ＋ 各画面の画像）。dir は画像配信のキー。 */
interface Wireframe {
  fileUrl?: string;
  dir: string;
  screens: WireframeScreen[];
}
/** このプロトタイプの「作り方」: 設計書・画面リスト・Figma ワイヤーフレーム。 */
interface DesignInfo {
  designDoc?: string;
  figmaFileUrl?: string;
  wireframeDir?: string;
  wireframeScreens?: WireframeScreen[];
  screens?: { name: string; description?: string }[];
}

/** 修正履歴の 1 版（サマリ。html は含めず、必要時に別 API で取得する）。 */
interface MockupVersionSummary {
  id: string;
  label: string;
  kind: 'generate' | 'revise' | 'review' | 'restore';
  createdAt: string;
}

interface MockupSummary {
  id: string;
  title: string;
  prompt?: string;
  /** Figma ワイヤーフレームを伴う場合の URL（一覧で「何を作ったか」の目印に使う）。 */
  figmaFileUrl?: string;
  /** Keita の評価。👍=次の生成の手本に使われる。 */
  rating?: 'up' | 'down';
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
// 約30分。サーバのコード生成タイムアウト(20分)＋設計/順番待ちを見届けられる長さ。
// ここで打ち切っても生成はサーバで継続し完了後に自動保存されるが、最後まで画面で見届けられるよう広く取る。
const POLL_MAX_WAIT_MS = 30 * 60_000;

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
  /** 現在表示中プロトタイプの設計・ワイヤーフレーム（完成後/読込後に表示するため復元する）。 */
  design?: DesignInfo | null;
  /** 実装仕様書（Markdown。生成/読込したら復元する）。 */
  spec?: string | null;
  /** コード学習（Markdown。TS実装＋構造化解説。生成/読込したら復元する）。MC-256。 */
  codeLesson?: string | null;
  /**
   * この currentId のモックを最後にサーバと同期した時刻（サーバの updatedAt）。
   * マウント復元時に「サーバの方が新しい＝ドラフトが古い」を検知して読み直すのに使う。
   * 別タブ/別端末で修正が完了し、こちらの追跡ジョブが期限切れになったケースでプレビューが
   * 古いまま残るのを防ぐ（サーバが新しい時だけ読み直す＝未保存の手編集は壊さない）。
   */
  syncedAt?: string | null;
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
    if (!d.prompt && !d.instruction && !d.title && !d.html && !d.currentId && !d.design) {
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
  | { status: 'done'; html: string; mockupId?: string; saved: SavedScreen[]; design: DesignInfo }
  | { status: 'canceled' }
  | { status: 'timeout' };

/** ポーリングで運ぶ生成中のライブ状態（段階・設計・ワイヤーフレーム進捗を含む）。 */
interface JobLive {
  status: 'pending' | 'generating';
  stage?: string;
  partial: string;
  plan: string;
  thinking: string;
  wireframeProgress: string;
  wireframe?: Wireframe;
  screens?: { name: string; description?: string }[];
}

/** 失敗時に「そこまでの内容」を運ぶための情報（思考・作り方・書きかけコード）。 */
interface LiveSnapshot {
  thinking: string;
  plan: string;
  code: string;
}

/** Error にそこまでの内容を載せて投げるための拡張。catch 側が拾って画面に残す。 */
interface JobError extends Error {
  live?: LiveSnapshot;
  /** ジョブが見つからない(404)＝期限切れ/消失。赤エラーにせず静かに片付けるための印。 */
  notFound?: boolean;
}

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
  onProgress?: (live: JobLive) => void,
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
      // ジョブが見つからない＝期限切れ/サーバ再起動等で消失。完了していれば一覧に自動保存済み。
      const err = new Error('この生成は見つかりませんでした') as JobError;
      err.notFound = true;
      throw err;
    }
    if (!pollRes.ok) continue;
    let data: {
      status?: string;
      stage?: string;
      html?: string;
      partial?: string;
      plan?: string;
      thinking?: string;
      designDoc?: string;
      screens?: { name: string; description?: string }[];
      wireframe?: Wireframe;
      wireframeProgress?: string;
      error?: string;
      mockupId?: string;
      saved?: SavedScreen[];
    };
    try {
      data = (await pollRes.json()) as typeof data;
    } catch {
      continue;
    }
    // 進捗（順番待ち pending / 生成中 generating ＋段階・設計・ワイヤーフレーム）を逐次コールバック。
    if (onProgress && (data.status === 'pending' || data.status === 'generating')) {
      onProgress({
        status: data.status,
        stage: data.stage,
        partial: typeof data.partial === 'string' ? data.partial : '',
        plan: typeof data.plan === 'string' ? data.plan : '',
        thinking: typeof data.thinking === 'string' ? data.thinking : '',
        wireframeProgress:
          typeof data.wireframeProgress === 'string' ? data.wireframeProgress : '',
        wireframe: data.wireframe,
        screens: Array.isArray(data.screens) ? data.screens : undefined,
      });
    }
    if (data.status === 'canceled') {
      // ユーザが「実装をやめる」を押した。赤エラーにせず静かに片付ける。
      return { status: 'canceled' };
    }
    if (data.status === 'done') {
      const saved = Array.isArray(data.saved) ? data.saved : [];
      return {
        status: 'done',
        html: data.html ?? '',
        mockupId: data.mockupId,
        saved,
        design: {
          designDoc: data.designDoc,
          figmaFileUrl: data.wireframe?.fileUrl,
          wireframeDir: data.wireframe?.dir,
          wireframeScreens: data.wireframe?.screens,
          screens: data.screens,
        },
      };
    }
    if (data.status === 'error') {
      // 失敗時も「そこまでの思考・作り方・書きかけコード」を error に載せて投げ、画面を空にしない。
      const err = new Error(data.error || startFallback) as JobError;
      err.live = {
        thinking: typeof data.thinking === 'string' ? data.thinking : '',
        plan: typeof data.plan === 'string' ? data.plan : '',
        code: typeof data.partial === 'string' ? data.partial : '',
      };
      throw err;
    }
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

/** 修正履歴の版の種類ごとの表示（バッジ絵文字＋短いラベル）。 */
const VERSION_KIND_META: Record<MockupVersionSummary['kind'], { icon: string; text: string }> = {
  generate: { icon: '✨', text: '生成' },
  revise: { icon: '✏️', text: '修正' },
  review: { icon: '🎨', text: '仕上げ' },
  restore: { icon: '↩️', text: '復元' },
};

/** 完成/読込後に「このプロトタイプの作り方（設計書）」を表示する折りたたみパネル。設計書が無ければ出さない。 */
function DesignPanel({ design }: { design: DesignInfo }): ReactElement | null {
  if (!design.designDoc) return null;
  return (
    <details
      open
      className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text-muted"
    >
      <summary className="cursor-pointer font-semibold text-text">
        🎨 設計（このプロトタイプの作り方）
      </summary>
      <div className="mt-2 whitespace-pre-wrap leading-relaxed">{design.designDoc}</div>
    </details>
  );
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
  // 「💡 アイデアを生成」実行中フラグ。
  const [ideaBusy, setIdeaBusy] = useState(false);

  // 進行中ジョブ（「作成中」として一覧に表示・離脱/リロードでも保持）。起動時に復元する。
  const [activeJobs, setActiveJobs] = useState<JobState[]>(loadJobs);
  // 既にポーリング中の jobId（多重ポーリング防止）。
  const pollingRef = useRef<Set<string>>(new Set());
  // 「作成中」カードの経過秒数表示用に 1 秒ごとに進む現在時刻。
  const [nowTick, setNowTick] = useState(() => Date.now());
  // エディタに紐づくジョブの「生成中の部分コード」（ライブ表示用）。
  const [streamCode, setStreamCode] = useState('');
  // エディタに紐づくジョブの「作り方メモ」（HTML を書き始める前の設計説明。ライブ表示用）。
  const [streamPlan, setStreamPlan] = useState('');
  // エディタに紐づくジョブの「AI の思考」（拡張思考。作り方より前段の素の思考。ライブ表示用）。
  const [streamThinking, setStreamThinking] = useState('');
  // 直近の失敗内容（時間切れ等）。画面を空にせず「どこまで考え・書けたか＋理由」を残すために使う。
  const [failedRun, setFailedRun] = useState<{
    message: string;
    thinking: string;
    plan: string;
    code: string;
  } | null>(null);
  // エディタに紐づくジョブのサーバ状態（'' | 'pending'=順番待ち | 'generating'=生成中）。
  const [streamStatus, setStreamStatus] = useState<'' | 'pending' | 'generating'>('');
  // 生成フローの現在ステージ（design=設計 / code=コーディング / review=デザイン仕上げ）。
  const [stage, setStage] = useState<'' | 'design' | 'code' | 'review'>('');
  // 現在表示中プロトタイプの設計（完成後/読込後に「何を作ったか」を表示）。
  const [design, setDesign] = useState<DesignInfo | null>(bootDraft?.design ?? null);
  // 実装仕様書（モック→本番化の設計。MC-253）。生成/読込で入る。
  const [spec, setSpec] = useState<string | null>(bootDraft?.spec ?? null);
  // 実装仕様書の生成中フラグ。
  const [specBusy, setSpecBusy] = useState(false);
  // コード学習（TS実装＋①始まり②各部の役割③ルールの構造化解説。MC-256）。生成/読込で入る。
  const [codeLesson, setCodeLesson] = useState<string | null>(bootDraft?.codeLesson ?? null);
  // コード学習の生成中フラグ。
  const [lessonBusy, setLessonBusy] = useState(false);
  // 修正履歴（バージョン。新しい順。MC-260）。currentId の変化・生成/修正完了時に読み直す。
  const [versions, setVersions] = useState<MockupVersionSummary[]>([]);
  // 履歴パネルの開閉・復元中フラグ・プレビュー中の版 id（別ウィンドウで開く）。
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // エディタに紐づく進行中ジョブ（あればエディタ側の進捗バーと生成ボタン無効化に使う）。
  const editorJob = activeJobs.find((j) => j.attachToEditor) ?? null;
  const generating = editorJob !== null;

  // 現在編集中のモックアップ id（保存済みを読み込んだ/保存した場合に入る）。
  const [currentId, setCurrentId] = useState<string | null>(bootDraft?.currentId ?? null);
  // currentId のモックを最後にサーバと同期した時刻（サーバの updatedAt）。マウント時の整合に使う。
  const [syncedAt, setSyncedAt] = useState<string | null>(bootDraft?.syncedAt ?? null);
  // マウント時のサーバ整合を 1 回だけ走らせるためのフラグ。
  const reconciledRef = useRef(false);

  // スマホ幅(md未満)での表示ペイン切替。デスクトップ(md+)では無視され両ペイン横並び。
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
  // プレビューを画面いっぱいに出す全画面モード（スマホで試作品を大きく見るため）。
  const [fullscreen, setFullscreen] = useState(false);

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

  // 指定 id の修正履歴（バージョン）を読み込む。id 無しなら空にする（MC-260）。
  const loadVersions = useCallback((id: string | null) => {
    if (!id) {
      setVersions([]);
      return;
    }
    fetch(`/api/dev/mockups/${encodeURIComponent(id)}/versions`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('versions failed'))))
      .then((data: { versions?: MockupVersionSummary[] }) => setVersions(data.versions ?? []))
      .catch(() => setVersions([]));
  }, []);

  // 編集中モックアップが変わるたびに履歴を読み直す（読込/生成/修正完了で currentId が変わる）。
  useEffect(() => {
    loadVersions(currentId);
  }, [currentId, loadVersions]);

  // 入力・生成結果・選択中 id が変わるたびに localStorage へ退避する（離脱/リロード復元用）。
  useEffect(() => {
    saveDraft({ prompt, instruction, title, html, currentId, design, spec, codeLesson, syncedAt });
  }, [prompt, instruction, title, html, currentId, design, spec, codeLesson, syncedAt]);

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
        // エディタに紐づくジョブだけ、進捗（段階/順番待ち/生成中・設計・ワイヤーフレーム）をライブ表示する。
        job.attachToEditor
          ? (live) => {
              setStreamStatus(live.status);
              setStreamCode(live.partial);
              setStreamPlan(live.plan);
              setStreamThinking(live.thinking);
              setStage((live.stage as '' | 'design' | 'code' | 'review') ?? '');
            }
          : undefined,
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
              // 生成が終わったら要望欄はクリアする（以降は「修正」だけの UI に切り替わる）。
              if (job.mode === 'generate') setPrompt('');
              // 完成した設計・ワイヤーフレームを「何を作ったか」として保持（修正時は内容があれば更新）。
              if (job.mode === 'generate') {
                setDesign(
                  r.design.designDoc || r.design.wireframeScreens?.length || r.design.figmaFileUrl
                    ? r.design
                    : null,
                );
              }
              setStreamCode('');
              setStreamPlan('');
              setStreamThinking('');
              setStreamStatus('');
              setStage('');
              setFailedRun(null);
              setMobileTab('preview');
              // 修正履歴を読み直す（修正では currentId が変わらず effect が走らないため明示的に）。
              loadVersions(r.mockupId ?? r.saved[0]?.id ?? null);
              // 完了＝サーバに自動保存された時点。整合基準を今に更新する。
              setSyncedAt(new Date().toISOString());
            }
            setNotice(
              job.mode === 'revise'
                ? '修正が完了しました（一覧にも自動保存済み）。'
                : `「${job.label}」が完成しました（一覧にも自動保存済み）。`,
            );
          } else if (r.status === 'canceled') {
            // ユーザが中止した。エディタ紐付けなら生成表示を畳む（赤エラーにはしない）。
            if (job.attachToEditor) {
              setStreamCode('');
              setStreamPlan('');
              setStreamThinking('');
              setStreamStatus('');
              setStage('');
              setFailedRun(null);
            }
            setNotice(
              job.mode === 'revise' ? '修正を中止しました。' : '作成を中止しました。',
            );
          } else {
            setNotice(
              '生成に時間がかかっています。完了すると下の「保存済みモックアップ」に自動保存されます。',
            );
          }
          loadList();
        })
        .catch((e: unknown) => {
          // 404（期限切れ/サーバ再起動でジョブ消失）は失敗ではない＝完了していれば一覧に自動保存済み。
          // 古いジョブ（前回セッションからの復元等）が消えていた場合に赤エラーを出さず、静かに一覧更新する。
          if ((e as JobError).notFound) {
            setNotice('前回の作成中ジョブは見つかりませんでした。完了していれば下の一覧にあります。');
            loadList();
            return;
          }
          // 404（サーバ再起動等でジョブ消失）でも完了済みなら一覧に自動保存されている。
          // attachToEditor のジョブのみ赤エラーを出し、デタッチ済み（新規作成後）は静かに一覧更新。
          if (job.attachToEditor) {
            const msg = e instanceof Error ? e.message : fallback;
            // 失敗時も画面を空にせず「そこまでの思考・作り方・書きかけコード」を残す。
            const live = (e as JobError).live;
            setFailedRun({
              message: msg,
              thinking: live?.thinking ?? '',
              plan: live?.plan ?? '',
              code: live?.code ?? '',
            });
            setError(msg);
            setStreamCode('');
            setStreamPlan('');
            setStreamThinking('');
            setStreamStatus('');
            setStage('');
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
  }, [activeJobs, loadList, loadVersions]);

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
  }, [streamCode, streamPlan, streamThinking]);

  // 新規生成。起票だけして「進行中ジョブ」に積む（完了はバックグラウンドのポーリングが捌く）。
  // 「💡 アイデアを生成」: サーバ(/api/dev/idea)で Claude にアイデアを 1 つ出させ、入力欄へ流し込む。
  const handleGenerateIdea = useCallback(async () => {
    if (ideaBusy || generating) return;
    setError(null);
    setNotice(null);
    setIdeaBusy(true);
    try {
      const res = await fetch('/api/dev/idea', { method: 'POST' });
      if (!res.ok) {
        setError(await readError(res, 'アイデアの生成に失敗しました。'));
        return;
      }
      const data = (await res.json()) as { idea?: string };
      if (data.idea && data.idea.trim()) {
        setPrompt(data.idea.trim());
        setNotice('アイデアを入れました。必要なら直してから「生成」を押してください。');
      } else {
        setError('アイデアの生成に失敗しました。少し待ってもう一度お試しください。');
      }
    } catch {
      setError('アイデアの生成に失敗しました。通信状態をご確認ください。');
    } finally {
      setIdeaBusy(false);
    }
  }, [ideaBusy, generating]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setError(null);
    setNotice(null);
    const label = prompt.trim().slice(0, 40) || 'モックアップ';
    try {
      const jobId = await startMockupJob(
        { prompt: prompt.trim() },
        '生成に失敗しました',
      );
      // 既存ジョブのエディタ紐付けを外し、この新ジョブをエディタに紐づけて先頭に積む。
      setActiveJobs((prev) => [
        { jobId, mode: 'generate', startedAt: Date.now(), label, attachToEditor: true },
        ...prev.map((j) => ({ ...j, attachToEditor: false })),
      ]);
      if (!title.trim()) setTitle(label);
      setStreamCode('');
      setStreamPlan('');
      setStreamThinking('');
      setStage('design');
      setDesign(null);
      setSpec(null);
      setCodeLesson(null);
      setFailedRun(null);
      setStreamStatus('pending');
      setStage('design');
      setMobileTab('preview'); // 生成の進み具合がライブで見えるプレビュー側へ。
      setNotice('作成を開始しました。設計 → コード → デザイン仕上げ の順に進む様子をプレビュー側に表示します。');
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
      // 修正指示は「反映されたら」クリアする（＝完了時。失敗/中止で入力を失わないよう送信時には消さない）。
      // クリアは完了ハンドラ（poller done の revise 分岐）と読込（handleLoad）で行う。
      setStreamCode('');
      setStreamPlan('');
      setStreamThinking('');
      setStage('code');
      setFailedRun(null);
      setStreamStatus('pending');
      setMobileTab('preview');
      setNotice('修正を開始しました。コードが書かれていく様子をプレビュー側に表示します。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '修正に失敗しました');
    }
  }, [html, instruction, generating, currentId, title]);

  // 生成/修正を途中でやめる。エディタに紐づく進行中ジョブをサーバ側で中止（実行中の claude を kill）する。
  // ポーリングが 'canceled' を拾って生成表示を畳む。通信が届かなくてもサーバの TTL で最終的に片付く。
  const handleCancel = useCallback(async () => {
    const job = activeJobs.find((j) => j.attachToEditor);
    if (!job) return;
    setNotice('作成を中止しています…');
    try {
      await fetch(`/api/dev/mockup/job/${encodeURIComponent(job.jobId)}/cancel`, {
        method: 'POST',
      });
    } catch {
      /* 通信失敗でもポーリング側／サーバ TTL で片付くので無視。 */
    }
  }, [activeJobs]);

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
      // 保存＝サーバと同期した時点。整合基準を今に更新する。
      setSyncedAt(new Date().toISOString());
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
    setFailedRun(null);
    try {
      const res = await fetch(`/api/dev/mockups/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(await readError(res, '読み込みに失敗しました'));
      const data = (await res.json()) as {
        mockup?: {
          id: string;
          title: string;
          html: string;
          prompt?: string;
          designDoc?: string;
          figmaFileUrl?: string;
          wireframeDir?: string;
          wireframeScreens?: WireframeScreen[];
          implSpec?: string;
          codeLesson?: string;
          updatedAt?: string;
        };
      };
      const m = data.mockup;
      if (!m) throw new Error('読み込みに失敗しました');
      setCurrentId(m.id);
      // サーバから読んだ＝この時点でサーバと同期済み。以後の整合判定の基準にする。
      setSyncedAt(m.updatedAt ?? new Date().toISOString());
      setTitle(m.title);
      setHtml(m.html);
      setPreviewHtml(m.html);
      setPrompt(m.prompt ?? '');
      setInstruction('');
      setSpec(m.implSpec ?? null);
      setCodeLesson(m.codeLesson ?? null);
      // 設計・ワイヤーフレームがあれば「何を作ったか」として表示する。無ければクリア。
      setDesign(
        m.designDoc || m.figmaFileUrl || m.wireframeScreens?.length
          ? {
              designDoc: m.designDoc,
              figmaFileUrl: m.figmaFileUrl,
              wireframeDir: m.wireframeDir,
              wireframeScreens: m.wireframeScreens,
            }
          : null,
      );
      setMobileTab('preview');
      setNotice(`「${m.title}」を読み込みました。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, []);

  // マウント時の整合（1 回だけ）。ドラフト復元した currentId のモックについて、サーバの updatedAt が
  // 最後の同期時刻より新しければ、ドラフトのプレビューは古い＝サーバの最新を読み直す。
  // 別タブ/別端末で修正が完了し、こちらの追跡ジョブが期限切れになっていた場合でも最新が出るようにする。
  // 進行中の編集ジョブがある間はポーリングに任せる。サーバが新しい時だけ読むので未保存の手編集は壊さない。
  useEffect(() => {
    if (reconciledRef.current) return;
    if (listLoading) return; // 一覧が来るまで待つ（updatedAt 比較のため）。
    reconciledRef.current = true;
    const cid = bootDraft?.currentId;
    if (!cid) return;
    if (activeJobs.some((j) => j.attachToEditor)) return; // 生成/修正中はポーリングが反映する。
    const server = mockups.find((m) => m.id === cid);
    if (!server) return; // 一覧に無い（削除された等）は触らない。
    const draftSynced = bootDraft?.syncedAt ? Date.parse(bootDraft.syncedAt) : 0;
    const serverUpdated = Date.parse(server.updatedAt);
    if (Number.isFinite(serverUpdated) && serverUpdated > draftSynced) {
      void handleLoad(cid); // サーバの最新でプレビュー・コードを揃える。
    }
  }, [listLoading, mockups, activeJobs, bootDraft, handleLoad]);

  // 実装仕様書を作る（MC-253）。保存済みモックが対象。生成中の本文をライブ表示し、完了で確定・保存。
  const handleMakeSpec = useCallback(async () => {
    if (!currentId || specBusy || generating) return;
    setSpecBusy(true);
    setError(null);
    setNotice('実装仕様書を作成中です（1〜2分かかります）…');
    try {
      const startRes = await fetch(`/api/dev/mockups/${encodeURIComponent(currentId)}/impl-spec`, {
        method: 'POST',
      });
      if (!startRes.ok) throw new Error(await readError(startRes, '実装仕様書の作成に失敗しました'));
      const { jobId } = (await startRes.json()) as { jobId?: string };
      if (!jobId) throw new Error('実装仕様書の作成に失敗しました');
      const deadline = Date.now() + POLL_MAX_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        let r: Response;
        try {
          r = await fetch(`/api/dev/mockup/job/${encodeURIComponent(jobId)}`);
        } catch {
          continue;
        }
        if (!r.ok) continue;
        let d: { status?: string; spec?: string; error?: string };
        try {
          d = (await r.json()) as typeof d;
        } catch {
          continue;
        }
        if (typeof d.spec === 'string' && d.spec) setSpec(d.spec); // ライブ更新
        if (d.status === 'done') {
          setNotice('実装仕様書ができました。下に表示しています。');
          break;
        }
        if (d.status === 'error') throw new Error(d.error || '実装仕様書の作成に失敗しました');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '実装仕様書の作成に失敗しました');
    } finally {
      setSpecBusy(false);
    }
  }, [currentId, specBusy, generating]);

  // コードを読む（解説付き）を作る（MC-256）。保存済みモックが対象。TS実装＋構造化解説を
  // 生成し、生成中の本文をライブ表示して完了で確定・保存する。handleMakeSpec と同じ機構。
  const handleMakeCodeLesson = useCallback(async () => {
    if (!currentId || lessonBusy || generating) return;
    setLessonBusy(true);
    setError(null);
    setNotice('コードの解説を作成中です（1〜2分かかります）…');
    try {
      const startRes = await fetch(
        `/api/dev/mockups/${encodeURIComponent(currentId)}/code-lesson`,
        { method: 'POST' },
      );
      if (!startRes.ok) throw new Error(await readError(startRes, 'コード解説の作成に失敗しました'));
      const { jobId } = (await startRes.json()) as { jobId?: string };
      if (!jobId) throw new Error('コード解説の作成に失敗しました');
      const deadline = Date.now() + POLL_MAX_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        let r: Response;
        try {
          r = await fetch(`/api/dev/mockup/job/${encodeURIComponent(jobId)}`);
        } catch {
          continue;
        }
        if (!r.ok) continue;
        let d: { status?: string; codeLesson?: string; error?: string };
        try {
          d = (await r.json()) as typeof d;
        } catch {
          continue;
        }
        if (typeof d.codeLesson === 'string' && d.codeLesson) setCodeLesson(d.codeLesson); // ライブ更新
        if (d.status === 'done') {
          setNotice('コードの解説ができました。下に表示しています。');
          break;
        }
        if (d.status === 'error') throw new Error(d.error || 'コード解説の作成に失敗しました');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'コード解説の作成に失敗しました');
    } finally {
      setLessonBusy(false);
    }
  }, [currentId, lessonBusy, generating]);

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

  // 評価（👍/👎）。同じ評価をもう一度押すと解除。👍 は次の生成の「手本」に使われる。
  const handleRate = useCallback(
    async (id: string, current: 'up' | 'down' | undefined, next: 'up' | 'down') => {
      const rating = current === next ? null : next;
      try {
        const res = await fetch(`/api/dev/mockups/${encodeURIComponent(id)}/rating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating }),
        });
        if (!res.ok) throw new Error(await readError(res, '評価に失敗しました'));
        setNotice(
          rating === 'up'
            ? '👍 手本に登録しました。次の生成からこのデザインを参考にします。'
            : rating === 'down'
              ? '👎 を記録しました。'
              : '評価を解除しました。',
        );
        loadList();
      } catch (e) {
        setError(e instanceof Error ? e.message : '評価に失敗しました');
      }
    },
    [loadList],
  );

  // 修正履歴（バージョン）のプレビュー: 指定版の html を取得し、新しいタブで開いて見比べられるようにする。
  // 現在の編集内容を壊さず「この版はどんな見た目だったか」を確認できる（MC-260）。
  const handlePreviewVersion = useCallback(
    async (versionId: string) => {
      if (!currentId) return;
      try {
        const res = await fetch(
          `/api/dev/mockups/${encodeURIComponent(currentId)}/versions/${encodeURIComponent(versionId)}`,
        );
        if (!res.ok) throw new Error(await readError(res, 'この版の読み込みに失敗しました'));
        const data = (await res.json()) as { version?: { html?: string } };
        const versionHtml = data.version?.html;
        if (!versionHtml) throw new Error('この版の読み込みに失敗しました');
        // Blob URL を新しいタブで開く（sandbox なしのプレビュー窓＝見た目確認用）。
        const blob = new Blob([versionHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        // 少し待ってから URL を解放（開いた側が読み込む余裕を持たせる）。
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'この版の読み込みに失敗しました');
      }
    },
    [currentId],
  );

  // 修正履歴（バージョン）への復元: 指定版を現行 html に戻す。復元自体も 1 版として記録される（MC-260）。
  // 復元後はエディタ・プレビューにも反映し、履歴を読み直す。
  const handleRestoreVersion = useCallback(
    async (versionId: string, label: string) => {
      if (!currentId || restoringId) return;
      if (!window.confirm(`「${label}」の状態に戻します。よろしいですか？（現在の内容は履歴に残ります）`)) return;
      setRestoringId(versionId);
      setError(null);
      try {
        const res = await fetch(`/api/dev/mockups/${encodeURIComponent(currentId)}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId }),
        });
        if (!res.ok) throw new Error(await readError(res, '復元に失敗しました'));
        const data = (await res.json()) as { mockup?: { html?: string } };
        const restoredHtml = data.mockup?.html;
        if (typeof restoredHtml === 'string') {
          setHtml(restoredHtml);
          setPreviewHtml(restoredHtml);
        }
        setNotice(`「${label}」の状態に復元しました。`);
        loadVersions(currentId);
        loadList();
      } catch (e) {
        setError(e instanceof Error ? e.message : '復元に失敗しました');
      } finally {
        setRestoringId(null);
      }
    },
    [currentId, restoringId, loadVersions, loadList],
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
    setSyncedAt(null);
    setError(null);
    setStreamCode('');
    setStreamPlan('');
    setStreamThinking('');
    setStreamStatus('');
    setStage('');
    setDesign(null);
    setSpec(null);
    setCodeLesson(null);
    setVersions([]);
    setFailedRun(null);
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
          {/* 生成。まだ試作品が無いときだけ表示し、1 つ作ったら以降は「修正」だけの UI にする
              （Keita 指示 2026-07-03）。作り直したいときは修正セクションの「＋新規作成」で白紙に戻す。 */}
          <section className="flex flex-col gap-2">
            {!html.trim() && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-text-muted" htmlFor="dev-prompt">
                    作りたい画面や機能の説明（ボタンが実際に動く試作品を 1 つ作ります）
                  </label>
                  <div className="flex shrink-0 items-center gap-1">
                    {/* 何を作るか思いつかない時に、Claude にその場でアイデアを 1 つ出させて入力欄へ流し込む。 */}
                    <button
                      type="button"
                      onClick={handleGenerateIdea}
                      disabled={ideaBusy || generating}
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                      title="開発に使えるアイデアを 1 つ自動で出します"
                    >
                      {ideaBusy ? <Spinner /> : <span aria-hidden>💡</span>}
                      {ideaBusy ? '考え中…' : 'アイデアを生成'}
                    </button>
                  </div>
                </div>
                <textarea
                  id="dev-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="例: サムネイル作成ツール。タイトルを入力して『サムネ生成』を押すと、サンプルのサムネが実際に表示される"
                  rows={4}
                  className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                />
                {/* 生成は「設計 → コード → デザイン昇格（2パス仕上げ）」の高品質 1 フローで作る。
                    以前あった Figma ワイヤーフレーム工程は不要になったためトグルは撤去した
                    （HTML がそのまま成果物・サーバ側 DEV_ENABLE_FIGMA で可逆的に復活可）。 */}
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
              </>
            )}

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
                {/* 途中でやめる。実行中の AI 処理をサーバ側で止める。 */}
                <button
                  type="button"
                  onClick={handleCancel}
                  className="self-start rounded-lg border px-3 py-1 text-[11px] font-semibold transition-colors hover:bg-surface-2"
                  style={{ borderColor: 'var(--mc-stalled)', color: 'var(--mc-stalled)' }}
                >
                  ■ 実装をやめる
                </button>
              </div>
            )}
          </section>

          {/* 反復修正（html がある時のみ） */}
          {html.trim() && (
            <section className="flex flex-col gap-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-text-muted" htmlFor="dev-instruction">
                  修正指示
                </label>
                {/* 別のものを新しく作りたいときは白紙に戻す（要望欄＋生成ボタンが再び出る）。 */}
                <button
                  type="button"
                  onClick={handleNew}
                  className="rounded px-2 py-0.5 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  ＋ 新規作成
                </button>
              </div>
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

          {/* 修正履歴（バージョン。MC-260）— 保存済みモックで、履歴が 1 件以上ある時だけ出す。
              修正・再生成・復元のたびに版が積まれ、各版をプレビュー/復元できる。 */}
          {currentId && versions.length > 0 && (
            <section className="flex flex-col gap-2 border-t border-border pt-4">
              <details open className="flex flex-col gap-2">
                <summary className="cursor-pointer text-xs font-semibold text-text-muted">
                  修正履歴（{versions.length} 件）
                </summary>
                <p className="mt-1 text-[10px] text-text-faint">
                  修正・再生成のたびに履歴として残ります。各版は「👁 プレビュー」で見比べ、「↩︎ 復元」で現在の内容に戻せます（復元しても今の内容は履歴に残ります）。
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {versions.map((v, i) => {
                    const meta = VERSION_KIND_META[v.kind];
                    return (
                      <li
                        key={v.id}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <span className="shrink-0 text-sm" aria-hidden>
                          {meta.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs text-text" title={v.label}>
                              {v.label}
                            </span>
                            {i === 0 && (
                              <span
                                className="shrink-0 rounded px-1 text-[9px] font-semibold"
                                style={{ background: 'var(--mc-active-bg)', color: 'var(--mc-active)' }}
                              >
                                最新
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-text-faint">
                            {meta.text}・{new Date(v.createdAt).toLocaleString('ja-JP')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handlePreviewVersion(v.id)}
                          aria-label={`「${v.label}」をプレビュー`}
                          title="この版を新しいタブでプレビュー"
                          className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                        >
                          👁
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRestoreVersion(v.id, v.label)}
                          disabled={restoringId !== null}
                          aria-label={`「${v.label}」に復元`}
                          title="この版を現在の内容に復元する"
                          className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {restoringId === v.id ? <Spinner /> : '↩︎'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </section>
          )}

          {/* 実装仕様書（モック→本番化の橋渡し・MC-253） */}
          {html.trim() && (
            <section className="flex flex-col gap-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-text-muted">実装仕様書（本番化の設計）</label>
                <button
                  type="button"
                  onClick={handleMakeSpec}
                  disabled={specBusy || generating || !currentId}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  title={currentId ? '' : 'まず保存してください'}
                >
                  {specBusy ? <Spinner /> : null}
                  {specBusy ? '作成中…' : spec ? '作り直す' : '実装仕様書を作る'}
                </button>
              </div>
              <p className="text-[10px] text-text-faint">
                データモデル・バックエンドの要否・API/テーブル案・実装ステップ・推奨スタックまで、本番化のための設計をまとめます。
                {!currentId && ' まず保存してから作成できます。'}
              </p>
              {spec && (
                <pre className="max-h-80 w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed text-text">
                  {spec}
                  {specBusy && <span className="animate-pulse">▋</span>}
                </pre>
              )}
            </section>
          )}

          {/* コードを読む（学習）— TS実装＋①始まり②各部の役割③ルールの構造化解説（MC-256） */}
          {html.trim() && (
            <section className="flex flex-col gap-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-text-muted">コードを読む（学習）</label>
                <button
                  type="button"
                  onClick={handleMakeCodeLesson}
                  disabled={lessonBusy || generating || !currentId}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  title={currentId ? '' : 'まず保存してください'}
                >
                  {lessonBusy ? <Spinner /> : null}
                  {lessonBusy ? '作成中…' : codeLesson ? '作り直す' : 'コードを読む（解説付き）'}
                </button>
              </div>
              <p className="text-[10px] text-text-faint">
                この試作品の機能を題材に、TypeScript の実装コードと、それを読むための解説（①始まり ②各部の役割
                ③ルール）を作ります。コードのどの部分が何をしているかを対応づけて、未経験でも読めるように説明します。
                {!currentId && ' まず保存してから作成できます。'}
              </p>
              {codeLesson && (
                <pre className="max-h-96 w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-text">
                  {codeLesson}
                  {lessonBusy && <span className="animate-pulse">▋</span>}
                </pre>
              )}
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
                    {/* 👍/👎 評価。👍=次の生成の手本に使う。同じ評価を再押下で解除。 */}
                    <button
                      type="button"
                      onClick={() => void handleRate(m.id, m.rating, 'up')}
                      aria-label={`「${m.title}」を手本にする（👍）`}
                      title="👍 手本にする（次の生成で参考にします）"
                      className={`shrink-0 rounded p-1 text-sm transition-colors hover:bg-surface-2 ${
                        m.rating === 'up' ? '' : 'opacity-40 hover:opacity-100'
                      }`}
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRate(m.id, m.rating, 'down')}
                      aria-label={`「${m.title}」に👎`}
                      title="👎 いまいち"
                      className={`shrink-0 rounded p-1 text-sm transition-colors hover:bg-surface-2 ${
                        m.rating === 'down' ? '' : 'opacity-40 hover:opacity-100'
                      }`}
                    >
                      👎
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
              {generating
                ? stage === 'design'
                  ? '① 設計書を作成中…'
                  : stage === 'review'
                    ? '③ デザインを点検して仕上げ中…'
                    : '② コードを生成中…'
                : 'プレビュー'}
            </span>
            {generating ? (
              <div className="flex items-center gap-2">
                <span
                  className="flex items-center gap-1.5 text-[11px]"
                  style={{ color: 'var(--mc-active)' }}
                >
                  <Spinner /> {elapsed}秒
                </span>
                {/* 途中でやめる（プレビュー側にも常に出す＝生成中はこのペインを見ているため）。 */}
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded border px-2 py-0.5 text-[11px] font-semibold transition-colors hover:bg-surface-2"
                  style={{ borderColor: 'var(--mc-stalled)', color: 'var(--mc-stalled)' }}
                >
                  ■ やめる
                </button>
              </div>
            ) : (
              previewHtml.trim() && (
                <button
                  type="button"
                  onClick={() => setFullscreen(true)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  ⛶ 全画面
                </button>
              )
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
                  {/* 先に出た「思考」と「作り方」は折りたたんで上に残す（あとから読み返せる）。 */}
                  {streamThinking && (
                    <details className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text-muted">
                      <summary className="cursor-pointer font-semibold">🤔 AI の思考</summary>
                      <div className="mt-1 whitespace-pre-wrap leading-relaxed">{streamThinking}</div>
                    </details>
                  )}
                  {streamPlan && (
                    <details className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text-muted">
                      <summary className="cursor-pointer font-semibold">📐 設計書</summary>
                      <div className="mt-1 whitespace-pre-wrap leading-relaxed">{streamPlan}</div>
                    </details>
                  )}
                  <p className="text-[10px] text-text-faint">
                    ↓ 設計を元に AI が書いているコードです（各部分の説明コメント付き）。この後デザインを仕上げて、下に実際の画面が出ます。
                  </p>
                  <pre
                    ref={streamPreRef}
                    className="min-h-0 w-full flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-text"
                  >
                    {streamCode}
                    <span className="animate-pulse">▋</span>
                  </pre>
                </div>
              ) : streamPlan ? (
                // HTML はまだ。先に「作り方（設計）」が書かれていく様子をライブ表示する。
                <div className="flex h-full flex-col gap-2">
                  <div
                    className="flex items-center gap-2 rounded-lg border border-accent px-3 py-2 text-xs font-semibold"
                    style={{ background: 'var(--mc-active-bg)', color: 'var(--mc-active)' }}
                  >
                    <Spinner />
                    <span>📐 設計書を作成しています（何を作るか・必要な画面を整理）…</span>
                  </div>
                  {streamThinking && (
                    <details className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text-muted">
                      <summary className="cursor-pointer font-semibold">🤔 AI の思考</summary>
                      <div className="mt-1 whitespace-pre-wrap leading-relaxed">{streamThinking}</div>
                    </details>
                  )}
                  <p className="text-[10px] text-text-faint">
                    まず「何を作るか」と必要な画面を整理しています。この後それを元にコードを書き、最後にデザインを仕上げます。
                  </p>
                  <pre
                    ref={streamPreRef}
                    className="min-h-0 w-full flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text"
                  >
                    {streamPlan}
                    <span className="animate-pulse">▋</span>
                  </pre>
                  <p className="text-[11px] text-text-faint">経過 {elapsed} 秒</p>
                </div>
              ) : streamThinking ? (
                // HTML も作り方もまだ。AI の「素の思考」が流れていればそれをライブ表示する。
                <div className="flex h-full flex-col gap-2">
                  <div
                    className="flex items-center gap-2 rounded-lg border border-accent px-3 py-2 text-xs font-semibold"
                    style={{ background: 'var(--mc-active-bg)', color: 'var(--mc-active)' }}
                  >
                    <Spinner />
                    <span>🤔 AI が考えています…</span>
                  </div>
                  <p className="text-[10px] text-text-faint">
                    AI が「どう作るか」を考えている思考をそのまま表示しています（この後、作り方 → コードへと進みます）。
                  </p>
                  <pre
                    ref={streamPreRef}
                    className="min-h-0 w-full flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-muted"
                  >
                    {streamThinking}
                    <span className="animate-pulse">▋</span>
                  </pre>
                  <p className="text-[11px] text-text-faint">経過 {elapsed} 秒</p>
                </div>
              ) : (
                // まだ何も流れてきていない: 順番待ち（pending）か、起動直後（generating）かを区別して伝える。
                <div className="flex h-full items-center justify-center p-6">
                  <div className="flex max-w-xs flex-col items-center gap-3 text-center">
                    <Spinner />
                    {streamStatus === 'pending' ? (
                      <>
                        <p className="text-sm font-semibold text-text">🕒 順番待ち中です</p>
                        <p className="text-xs text-text-muted">
                          先に作成中のものを処理しています。空き次第これに取りかかり、まず考え始めます（このまま待てば自動で進みます）。
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-text">🤔 AI が考え始めています…</p>
                        <p className="text-xs text-text-muted">
                          最初の考えをまとめています。考えている内容・作り方・書いているコードが、この後ここに順に流れます。
                        </p>
                      </>
                    )}
                    <p className="text-[11px] text-text-faint">経過 {elapsed} 秒</p>
                  </div>
                </div>
              )
            ) : failedRun ? (
              // 失敗（時間切れ等）: 画面を空にせず「どこまで考え・書けたか＋止まった理由」を正直に残す。
              <div className="flex h-full flex-col gap-2 overflow-auto">
                <div
                  className="rounded-lg border px-3 py-2 text-xs"
                  style={{ color: 'var(--mc-stalled)', background: 'var(--mc-stalled-bg)' }}
                >
                  <p className="font-semibold">⚠️ 今回はうまく完成できませんでした</p>
                  <p className="mt-1 leading-relaxed">{failedRun.message}</p>
                </div>
                {failedRun.thinking && (
                  <details className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text-muted">
                    <summary className="cursor-pointer font-semibold">🤔 AI の思考（ここまで）</summary>
                    <div className="mt-1 whitespace-pre-wrap leading-relaxed">{failedRun.thinking}</div>
                  </details>
                )}
                {failedRun.plan && (
                  <details
                    open
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text-muted"
                  >
                    <summary className="cursor-pointer font-semibold">📝 AI が考えた「作り方」</summary>
                    <div className="mt-1 whitespace-pre-wrap leading-relaxed">{failedRun.plan}</div>
                  </details>
                )}
                {failedRun.code ? (
                  <>
                    <p className="text-[10px] text-text-faint">↓ ここまで書けていたコードです（未完成）。</p>
                    <pre className="min-h-0 w-full flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-text">
                      {failedRun.code}
                    </pre>
                  </>
                ) : (
                  <p className="text-[11px] text-text-faint">
                    コードを書き始める前に止まりました。要望をもう少し絞って、もう一度「生成」を試してください。
                  </p>
                )}
              </div>
            ) : previewHtml.trim() ? (
              // 完成: 上に「設計・ワイヤーフレーム（作り方）」があれば畳んで出し、下に動くプレビュー。
              <div className="flex h-full flex-col gap-2 overflow-hidden">
                {design && (
                  <div className="max-h-[45%] shrink-0 overflow-auto">
                    <DesignPanel design={design} />
                  </div>
                )}
                <iframe
                  title="モックアッププレビュー"
                  srcDoc={previewHtml}
                  // AI 生成 HTML を隔離: スクリプトは許可するが same-origin は付けない。
                  sandbox="allow-scripts"
                  className="min-h-0 w-full flex-1 rounded-lg border border-border bg-white"
                />
              </div>
            ) : design ? (
              // HTML は無いが設計・ワイヤーフレームだけある（稀）→ 作り方パネルだけ表示。
              <div className="h-full overflow-auto">
                <DesignPanel design={design} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <EmptyState>
                  左の入力欄に作りたい画面を説明して「生成」を押すと、設計 → コード → デザイン仕上げ の順で作られ、動くプレビューがここに表示されます。
                </EmptyState>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 全画面プレビュー: スマホで試作品を画面いっぱいに表示する。✕ で閉じる。セーフエリア対応。 */}
      {fullscreen && previewHtml.trim() && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-white"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
            <span className="truncate text-xs font-semibold text-text-muted">
              {title || 'プレビュー'}
            </span>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="shrink-0 rounded border border-border px-3 py-1 text-xs font-semibold text-text transition-colors hover:bg-surface-2"
            >
              ✕ 閉じる
            </button>
          </div>
          <iframe
            title="モックアッププレビュー（全画面）"
            srcDoc={previewHtml}
            sandbox="allow-scripts"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        </div>
      )}
    </div>
  );
}
