// ターミナル（MC-92 / MC-95 / MC-119）— 3つの独立ターミナルをタブで切り替えて操作する。
//
// MC-119: Apollo ターミナルを「3つの独立ターミナル（タブ切替）」にする。
//   - ターミナル1（/terminal,  ttyd 7681）= この箱の tmux main（林 CLI）※既存
//   - ターミナル2（/terminal/2, ttyd 7682）= 旧箱(139.180.202.62)へ ssh して claude
//   - ターミナル3（/terminal/3, ttyd 7683）= この箱の予備 claude（spare セッション）
//   各ベースパスは Apollo サーバ側 reverse proxy が対応 ttyd ポートへ振り分ける。
//   3つの iframe は常時 mount したまま CSS で表示/非表示を切り替える（タブ切替で再ロード
//   ＝セッション切れに見えないように、iframe を保持する）。
//
// 同一オリジンの iframe なので、認証 Cookie（mc_token）は自動付与され、未認証では
// サーバ側で弾かれる（HTTP・WS とも）。ttyd の Basic 認証は proxy が内部付与する。
//
// サーバ補助機能の対象（MC-123 端末別に一般化）:
//   画像添付・出力モーダル・仮想キーバー・「ターミナルを開始」はサーバ側で対象 tmux セッション
//   （1=main この箱 / 2=apollo2 旧箱を ssh 越し / 3=spare この箱）に対して send-keys /
//   capture-pane する。各操作はアクティブタブの terminal 番号をサーバへ渡し、全ターミナルで効く。
//   「ターミナルを開始」は対象タブの systemd ユニットを冪等復旧する（terminal 番号をサーバへ渡す）。
//
// MC-95 / MC-102 / MC-123 画像添付（全ターミナル）:
//   選んだ／貼り付けた画像をフロントの配列に貯め、サムネでプレビュー → 「送る」で一括 POST。
//   サーバは data/terminal-uploads/ に保存し、絶対パス群を対象セッションの入力欄へ send-keys で
//   リテラル注入する（自動 Enter なし）。remote(2) は scp で旧箱へコピーしてから旧箱パスを注入する。
//   林はそのパスを Read で画像として読める。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ImageFileIcon, CloseIcon, TerminalIcon, PlusIcon, KeyboardIcon } from '../components/icons';
import { Spinner } from '../components/ui';

// ─── 利用可能モデル定義 ─────────────────────────────────────
// ModelId は将来のモデル切替 UI で使用予定

// ─── ターミナル定義 ───────────────────────────────────────────
// path は iframe src のベース（末尾スラッシュ付き＝相対アセットの解決基準）。
// MC-123: 補助機能（画像添付・出力・仮想キーバー）は全ターミナルで有効化する。
//   各操作はアクティブタブの terminal 番号をサーバに渡し、対象 tmux セッション
//   （1=main / 2=apollo2(旧箱 ssh 越し) / 3=spare）に対して実行される。
interface TerminalTab {
  id: number;
  label: string;
  path: string; // iframe src（例: '/terminal/', '/terminal/3/'）
}

// Default terminal labels from server config (can be overridden via API)
const DEFAULT_TERMINAL_LABELS: Record<number, string> = {
  1: 'Main',
  3: 'Aux',
  4: 'Ops',
  5: 'Sub',
};

const TERMINAL_TABS: TerminalTab[] = [
  { id: 1, label: DEFAULT_TERMINAL_LABELS[1], path: '/terminal/' },
  { id: 3, label: DEFAULT_TERMINAL_LABELS[3], path: '/terminal/3/' },
  { id: 4, label: DEFAULT_TERMINAL_LABELS[4], path: '/terminal/4/' },
  { id: 5, label: DEFAULT_TERMINAL_LABELS[5], path: '/terminal/5/' },
];

const ACTIVE_TAB_STORAGE_KEY = 'apollo.terminal.activeTab';
// MC-156: 分割表示の保存キー。分割数（1〜4）と各ペインの割当ターミナル番号配列。
const SPLIT_COUNT_STORAGE_KEY = 'apollo.terminal.splitCount';
const PANE_ASSIGN_STORAGE_KEY = 'apollo.terminal.paneAssign';

// 分割数ごとの初期ペイン割当（素直に T1..Tn）。
function defaultPaneAssign(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

// 分割数に対応する CSS grid テンプレート（コンテナ側）。
//   1 = 単一 / 2 = 横2分割 / 3 = 上2・下1 / 4 = 2x2。
function gridTemplate(count: number): CSSProperties {
  switch (count) {
    case 2:
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    case 3:
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    case 4:
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    default:
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
  }
}

// 各ペイン（0 始まり index）のグリッドセル位置。3 分割は 3 番目を下段全幅にする。
function panePlacement(count: number, paneIdx: number): CSSProperties {
  if (count === 3) {
    if (paneIdx === 0) return { gridColumn: '1', gridRow: '1' };
    if (paneIdx === 1) return { gridColumn: '2', gridRow: '1' };
    return { gridColumn: '1 / span 2', gridRow: '2' };
  }
  // 2 / 4 は通常フロー（auto-placement）でよいが、明示しておく。
  if (count === 4) {
    const col = (paneIdx % 2) + 1;
    const row = Math.floor(paneIdx / 2) + 1;
    return { gridColumn: String(col), gridRow: String(row) };
  }
  if (count === 2) {
    return { gridColumn: String(paneIdx + 1), gridRow: '1' };
  }
  return {};
}

// ─── 仮想キーバー / 補助 API helper ───────────────────────────
// send-keys / output / start は terminal 番号で対象 tmux セッションを切り替える（MC-123）。
async function postSendKeys(keys: string, terminal: number): Promise<void> {
  try {
    await fetch('/api/terminal/send-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys, terminal }),
    });
  } catch {
    // 送信失敗はサイレント（ttyd 画面側で確認できる）
  }
}

const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const ACCEPTED_TEXT_EXT = new Set(['.txt', '.md', '.ts', '.js', '.py', '.json', '.yaml', '.yml', '.csv']);
const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB / ファイル

/** MIME またはファイル拡張子でテキスト系ファイルか判定する。 */
function isAcceptedFile(f: File): boolean {
  if (ACCEPTED_IMAGE_MIME.includes(f.type)) return true;
  if (f.type.startsWith('text/')) return true;
  if (f.type === 'application/json' || f.type === 'application/javascript') return true;
  // MIME が空または unknown のときは拡張子で判断する（ローカルファイルで多い）。
  const dotIdx = f.name.lastIndexOf('.');
  if (dotIdx >= 0) {
    const ext = f.name.slice(dotIdx).toLowerCase();
    if (ACCEPTED_TEXT_EXT.has(ext)) return true;
  }
  return false;
}

// ステージング中の 1 ファイル。file は送信用、url は画像サムネ表示用（非画像は url=''）。
interface StagedImage {
  id: string;
  file: File;
  url: string; // 画像のみ ObjectURL。テキスト系は ''。
  isImage: boolean;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; count: number; injected: boolean; paths: string[]; distribution?: Array<{ terminal: number; count: number; paths: string[] }> }
  | { kind: 'error'; message: string };

/** バイト数を人が読める単位に整形する（サムネのキャプション用）。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ターミナルバックエンド（ttyd / tmux main）の稼働状態（MC-100 / MC-119）。
type BackendState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'down' }
  | { kind: 'starting' }
  | { kind: 'start-error'; message: string };

interface TerminalStatusResponse {
  tmuxSession?: boolean;
  ttydService?: boolean;
  ttydReachable?: boolean;
  ready?: boolean;
}

interface TerminalStatusAllItem {
  id: number;
  label: string;
  account: string | null;
  model: string | null;
  status: TerminalStatusResponse;
  agentName: string | null;
  agentEmoji: string | null;
}

/** 出力表示モーダル: 現在タブのターミナルの最近の出力を通常テキストで表示→選択・コピー可（MC-123）。 */
function OutputModal({ terminal, onClose }: { terminal: number; onClose: () => void }) {
  const [content, setContent] = useState<string>('読み込み中...');
  const preRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    fetch(`/api/terminal/output?lines=2000&terminal=${terminal}`)
      .then((r) => r.json())
      .then((b: { ok: boolean; content?: string }) => setContent(b.content ?? '（取得できませんでした）'))
      .catch(() => setContent('（エラー）'));
  }, [terminal]);
  // 開いたら最新（末尾）が見えるよう、内容ロード後に一番下へスクロールする。
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [content]);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: '#ffffff', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: '#d0d8e4', background: '#f4f6f9' }}
      >
        <span className="text-sm font-semibold" style={{ color: '#1e2a3a' }}>出力（選択してコピー）</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          style={{ touchAction: 'manipulation', color: '#1e2a3a', background: '#edf0f5', border: '1px solid #b0bcce' }}
          className="flex h-11 min-w-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium"
        >
          <CloseIcon width={22} height={22} className="pointer-events-none" />
          閉じる
        </button>
      </div>
      {/* 白背景＋濃いダーク文字で常に読みやすく（ライト/ダークモード問わず固定） */}
      <pre
        ref={preRef}
        className="flex-1 overflow-auto whitespace-pre-wrap break-all p-4 text-xs leading-relaxed select-text font-mono"
        style={{ background: '#ffffff', color: '#1e2a3a' }}
      >
        {content}
      </pre>
      <div className="border-t px-4 py-3" style={{ borderColor: '#d0d8e4', background: '#f4f6f9' }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          style={{ touchAction: 'manipulation', color: '#1e2a3a', background: '#edf0f5', border: '1px solid #b0bcce' }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md text-sm font-medium"
        >
          <CloseIcon width={20} height={20} className="pointer-events-none" />
          閉じる
        </button>
      </div>
    </div>
  );
}


export default function Terminal() {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [showOutput, setShowOutput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── アクティブタブ（MC-119）─────────────────────────────────
  // 表示中のターミナル番号。localStorage に保持して再訪時に復元する。
  const [activeId, setActiveId] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      if (TERMINAL_TABS.some((t) => t.id === n)) return n;
    } catch {
      // localStorage 不可（プライベートモード等）でも既定は 1。
    }
    return 1;
  });
  const switchTab = useCallback((id: number) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, String(id));
    } catch {
      // 保持できなくても切替自体は機能させる。
    }
  }, []);
  const activeTab = TERMINAL_TABS.find((t) => t.id === activeId) ?? TERMINAL_TABS[0];

  // ── デスクトップ幅判定（MC-156）─────────────────────────────
  // Tailwind の md ブレークポイント（768px）以上を「デスクトップ」とみなす。
  // スマホ（md 未満）では分割を無効化し従来のタブ表示にフォールバックする。
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', onChange);
    setIsDesktop(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // ── 分割表示（MC-156）─────────────────────────────────────────
  // splitCount: 同時表示するペイン数（1〜4）。localStorage に保持。
  const [splitCount, setSplitCount] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SPLIT_COUNT_STORAGE_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      if (n >= 1 && n <= 4) return n;
    } catch {
      // localStorage 不可なら既定 1（単一表示）。
    }
    return 1;
  });
  // paneAssign[i] = ペイン i に映すターミナル番号（1〜4）。
  const [paneAssign, setPaneAssign] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(PANE_ASSIGN_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr) && arr.every((x) => TERMINAL_TABS.some((t) => t.id === x))) {
          return arr as number[];
        }
      }
    } catch {
      // 壊れていれば既定割当にフォールバック。
    }
    return defaultPaneAssign(4);
  });
  // フォーカス中のペイン（0 始まり）。補助機能の対象ターミナルを決める。
  const [focusedPane, setFocusedPane] = useState(0);

  // 有効な分割数（デスクトップのみ分割。スマホは常に 1）。
  const effectiveSplit = isDesktop ? splitCount : 1;
  // 表示中ペインに割り当てられたターミナル番号（長さ effectiveSplit）。
  const visiblePaneAssign = Array.from(
    { length: effectiveSplit },
    (_, i) => paneAssign[i] ?? defaultPaneAssign(4)[i] ?? 1,
  );

  // 分割数を変更する。割当が足りなければ既定で埋める。
  const changeSplitCount = useCallback((count: number) => {
    const clamped = Math.max(1, Math.min(4, count));
    setSplitCount(clamped);
    try {
      localStorage.setItem(SPLIT_COUNT_STORAGE_KEY, String(clamped));
    } catch {
      // 保持できなくても切替自体は機能させる。
    }
    setPaneAssign((prev) => {
      const next = [...prev];
      const def = defaultPaneAssign(4);
      for (let i = 0; i < clamped; i++) {
        if (!TERMINAL_TABS.some((t) => t.id === next[i])) next[i] = def[i];
      }
      try {
        localStorage.setItem(PANE_ASSIGN_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 保持失敗は無視。
      }
      return next;
    });
    setFocusedPane((p) => Math.min(p, clamped - 1));
  }, []);

  // 指定ペインの割当ターミナルを変更する。
  const changePaneAssign = useCallback((paneIdx: number, terminalId: number) => {
    setPaneAssign((prev) => {
      const next = [...prev];
      next[paneIdx] = terminalId;
      try {
        localStorage.setItem(PANE_ASSIGN_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 保持失敗は無視。
      }
      return next;
    });
  }, []);
  // MC-123: 補助機能（画像添付・出力・キーバー）は全ターミナルで有効。各操作は activeId を対象にする。
  // MC-156: 分割表示中はフォーカス中ペインの割当ターミナルを activeId に同期する。
  //   送信系ロジックは従来どおり activeIdRef を参照するので、ここで同期すれば壊れない。
  useEffect(() => {
    if (effectiveSplit > 1) {
      const target = visiblePaneAssign[focusedPane] ?? visiblePaneAssign[0] ?? 1;
      setActiveId((prev) => (prev === target ? prev : target));
    }
    // visiblePaneAssign は派生値（毎レンダ新規）なので依存はプリミティブで指定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSplit, focusedPane, paneAssign]);

  // 最新の activeId をコールバック内で参照するための ref（オートリピート等のクロージャ向け）。
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // ── iframe ref マップ（各ターミナルの iframe DOM 要素を保持）────────
  // Enter キー連動 sendStaged のため contentWindow にアクセスできるよう ref を管理する。
  const iframeRefsMap = useRef<Map<number, HTMLIFrameElement>>(new Map());

  // ── モバイル仮想キーバー（スマホ専用）──────────────────────
  const [keyInput, setKeyInput] = useState('');

  // 仮想キーバーの表示トグル（MC-113）。既定は非表示で、キーボードアイコンのボタンで開閉する。
  const KEYBAR_STORAGE_KEY = 'apollo.terminal.keybarOpen';
  const [keybarOpen, setKeybarOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEYBAR_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleKeybar = useCallback(() => {
    setKeybarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEYBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // localStorage 不可でもトグル自体は機能させる。
      }
      return next;
    });
  }, []);

  // ── ↑↓ キーの送信ロジック（MC-113 修正）─────────────────────────
  const REPEAT_DELAY_MS = 450; // この時間以上押し続けたらオートリピート開始
  const REPEAT_INTERVAL_MS = 180; // オートリピートの送信間隔
  const arrowRepeatTimerRef = useRef<number | null>(null);
  const arrowRepeatIntervalRef = useRef<number | null>(null);
  const arrowPointerIdRef = useRef<number | null>(null);

  const stopArrowRepeat = useCallback(() => {
    if (arrowRepeatTimerRef.current !== null) {
      clearTimeout(arrowRepeatTimerRef.current);
      arrowRepeatTimerRef.current = null;
    }
    if (arrowRepeatIntervalRef.current !== null) {
      clearInterval(arrowRepeatIntervalRef.current);
      arrowRepeatIntervalRef.current = null;
    }
    arrowPointerIdRef.current = null;
  }, []);

  const handleArrowPointerDown = useCallback(
    (direction: 'up' | 'down', pointerId: number) => {
      stopArrowRepeat();
      arrowPointerIdRef.current = pointerId;
      const key = direction === 'up' ? 'Up' : 'Down';
      void postSendKeys(key, activeIdRef.current);
      arrowRepeatTimerRef.current = window.setTimeout(() => {
        arrowRepeatIntervalRef.current = window.setInterval(() => {
          void postSendKeys(key, activeIdRef.current);
        }, REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [stopArrowRepeat],
  );

  const handleArrowPointerUp = useCallback(
    (pointerId: number) => {
      if (arrowPointerIdRef.current !== null && arrowPointerIdRef.current !== pointerId) return;
      stopArrowRepeat();
    },
    [stopArrowRepeat],
  );

  useEffect(() => stopArrowRepeat, [stopArrowRepeat]);

  const sendKey = useCallback((key: string) => {
    void postSendKeys(key, activeIdRef.current);
  }, []);

  const sendText = useCallback((text: string) => {
    if (text.length === 0) return;
    void postSendKeys(text, activeIdRef.current);
  }, []);

  // ── 画像ステージング（MC-102、ターミナル1 のみ）──────────────
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const stagedRef = useRef<StagedImage[]>([]);
  stagedRef.current = staged;
  useEffect(() => {
    return () => {
      for (const s of stagedRef.current) URL.revokeObjectURL(s.url);
    };
  }, []);

  // ── ターミナルラベル状態（API から返却される動的ラベル）────
  const [terminalLabels, setTerminalLabels] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const t of TERMINAL_TABS) init[t.id] = t.label;
    return init;
  });

  const [, setAgentInfoMap] = useState<Record<number, { name: string; emoji: string } | null>>({});

  const setTerminalLabel = useCallback((id: number, label: string) => {
    setTerminalLabels((prev) => ({ ...prev, [id]: label }));
  }, []);


  // アカウント切替は削除（MC-180）。ドロップダウン UI と自動切替ロジックを廃止。
  // サーバ側エンドポイント /api/terminal/account は残っているので、
  // 将来 UI を復活させたい場合はここに関数を戻す。

  // ── 使用量ベース自動切替（削除済 MC-180）────────────────────────
  // 自動切替は不要に。429時のフェイルオーバーも廃止。手動 switchAccount のみ対応。


  // ── バックエンド復旧（MC-100 / MC-119）────────────────────────
  // 各ターミナルごとに状態を持つ（id → BackendState）。
  const [backends, setBackends] = useState<Record<number, BackendState>>(() => {
    const init: Record<number, BackendState> = {};
    for (const t of TERMINAL_TABS) init[t.id] = { kind: 'checking' };
    return init;
  });
  // iframe を強制リロードするための key（ターミナルごと）。start 成功後に対象だけ貼り直す。
  const [iframeKeys, setIframeKeys] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const t of TERMINAL_TABS) init[t.id] = 0;
    return init;
  });
  // ポーリングが start 進行中の上書きを避けるため、最新 kind を ref で持つ。
  const backendsRef = useRef<Record<number, BackendState>>(backends);
  backendsRef.current = backends;

  const setBackend = useCallback((id: number, next: BackendState) => {
    setBackends((prev) => ({ ...prev, [id]: next }));
  }, []);

  // GET /api/terminal/status?terminal=<id> を叩いて ready/down を判定する。
  const refreshStatus = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        const res = await fetch(`/api/terminal/status?terminal=${id}`, { method: 'GET' });
        if (!res.ok) {
          setBackend(id, { kind: 'down' });
          return false;
        }
        const body = (await res.json()) as TerminalStatusResponse;
        const ready = Boolean(body.ready);
        setBackend(id, ready ? { kind: 'ready' } : { kind: 'down' });
        return ready;
      } catch {
        setBackend(id, { kind: 'down' });
        return false;
      }
    },
    [setBackend],
  );

  // POST /api/terminal/start {terminal:id} でバックエンドを復旧 → 成功なら対象 iframe をリロード。
  const startBackend = useCallback(
    async (id: number) => {
      setBackend(id, { kind: 'starting' });
      try {
        const res = await fetch('/api/terminal/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminal: id }),
        });
        if (!res.ok) {
          let message = `起動に失敗しました（HTTP ${res.status}）。`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) message = body.error;
          } catch {
            // JSON でない場合は既定メッセージ。
          }
          setBackend(id, { kind: 'start-error', message });
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
        const ready = await refreshStatus(id);
        if (ready) {
          setIframeKeys((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
        }
      } catch (e) {
        setBackend(id, {
          kind: 'start-error',
          message: e instanceof Error ? `起動に失敗しました。${e.message}` : '起動に失敗しました。',
        });
      }
    },
    [refreshStatus, setBackend],
  );

  // マウント時に全ターミナルの状態確認 + モデル初期取得、以降は定期ポーリングで切断を検知する。
  useEffect(() => {
    // 初回: status-all でバックエンド状態とモデルを一括取得する。
    const initAll = async () => {
      try {
        const res = await fetch('/api/terminal/status-all');
        if (res.ok) {
          const body = (await res.json()) as { terminals?: TerminalStatusAllItem[] };
          if (Array.isArray(body.terminals)) {
            const newAgentMap: Record<number, { name: string; emoji: string } | null> = {};
            for (const item of body.terminals) {
              const ready = Boolean(item.status?.ready);
              setBackend(item.id, ready ? { kind: 'ready' } : { kind: 'down' });
              if (item.label) setTerminalLabel(item.id, item.label);
              newAgentMap[item.id] = item.agentName ? { name: item.agentName, emoji: item.agentEmoji ?? '' } : null;
            }
            setAgentInfoMap(newAgentMap);
            return; // status-all 成功なら個別 refreshStatus は不要。
          }
        }
      } catch {
        // 失敗時は個別 refreshStatus にフォールバック。
      }
      for (const t of TERMINAL_TABS) void refreshStatus(t.id);
    };
    void initAll();

    const intId = window.setInterval(() => {
      for (const t of TERMINAL_TABS) {
        // starting 中はポーリングしない（start 側が状態を握る）。
        if (backendsRef.current[t.id]?.kind === 'starting') continue;
        void refreshStatus(t.id);
      }
    }, 15000);
    return () => window.clearInterval(intId);
  }, [refreshStatus, setBackend]);

  // 選択/貼付したファイルをステージング配列に追加する（即送信しない）。
  const addToStaging = useCallback((files: File[]) => {
    const accepted = files.filter((f) => isAcceptedFile(f));
    if (accepted.length === 0) {
      setState({ kind: 'error', message: '対応するファイル（画像 PNG/JPEG/WebP/GIF またはテキスト系）が見つかりませんでした。' });
      return;
    }
    const tooLarge = accepted.find((f) => f.size > MAX_BYTES);
    if (tooLarge) {
      setState({ kind: 'error', message: '各ファイルは 10MB までです。' });
      return;
    }
    setStaged((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        setState({ kind: 'error', message: `ファイルは合計 ${MAX_IMAGES} 個までです。先に何個か削除してください。` });
        return prev;
      }
      const toAdd = accepted.slice(0, room);
      if (toAdd.length < accepted.length) {
        setState({
          kind: 'error',
          message: `ファイルは合計 ${MAX_IMAGES} 個までです。${accepted.length - toAdd.length} 個は追加できませんでした。`,
        });
      } else {
        setState({ kind: 'idle' });
      }
      const next = toAdd.map((f, i) => {
        const isImage = ACCEPTED_IMAGE_MIME.includes(f.type);
        const named =
          f.name && f.name.trim() !== ''
            ? f
            : new File([f], `pasted-${Date.now()}-${i}.${f.type.split('/')[1] || 'bin'}`, {
                type: f.type,
              });
        return {
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          file: named,
          url: isImage ? URL.createObjectURL(named) : '',
          isImage,
        };
      });
      return [...prev, ...next];
    });
  }, []);

  const removeStaged = useCallback((id: string) => {
    setStaged((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  // ステージング中の全画像を /api/terminal/upload へ一括送信する（tmux main = ターミナル1 に注入）。
  // sendEnterAfter=true のとき: Enter をブロックした後に呼ぶ。サーバーがパス注入直後に Enter を送る。
  const sendStaged = useCallback(async (sendEnterAfter = false) => {
    const items = stagedRef.current;
    if (items.length === 0) return;
    setState({ kind: 'uploading' });
    try {
      const fd = new FormData();
      items.forEach((s) => fd.append('images', s.file, s.file.name));
      // 注入先は現在タブのターミナル（MC-123）。multipart のフィールドで番号を渡す。
      fd.append('terminal', String(activeIdRef.current));
      if (sendEnterAfter) fd.append('sendEnter', '1');
      const res = await fetch('/api/terminal/upload', { method: 'POST', body: fd });
      if (res.status !== 201) {
        let reason = `送信に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          if (body?.error || body?.message) reason = body.error ?? body.message ?? reason;
        } catch {
          // JSON でない場合は既定メッセージのまま。
        }
        setState({ kind: 'error', message: reason });
        return;
      }
      const body = (await res.json()) as {
        count?: number;
        injected?: boolean;
        paths?: string[];
        distribution?: Array<{ terminal: number; count: number; paths: string[] }>;
      };
      const sentCount = items.length;
      setState({
        kind: 'done',
        count: body.count ?? sentCount,
        injected: body.injected ?? false,
        paths: Array.isArray(body.paths) ? body.paths : [],
        distribution: Array.isArray(body.distribution) ? body.distribution : undefined,
      });
      setStaged((prev) => {
        for (const s of prev) {
          if (s.url) URL.revokeObjectURL(s.url);
        }
        return [];
      });
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? `送信に失敗しました。${e.message}` : '送信に失敗しました。',
      });
    }
  }, []);

  const handleFiles = (fileList: FileList | null) => {
    if (fileList && fileList.length > 0) addToStaging(Array.from(fileList));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // クリップボード貼付（Ctrl+V / ⌘+V）。全ターミナルで受ける（MC-123）。注入先は activeId。
  // iframe にフォーカスがある間は paste が親 window に来ないため、その場合は iframe（ttyd）に委ねる。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addToStaging(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addToStaging]);

  // iframe 内 Enter キーで sendStaged を自動呼び出し（staged がある間だけリスナーを登録）。
  // 同一オリジン iframe なので contentWindow に直接アクセスできる（MC-119 冒頭コメント参照）。
  useEffect(() => {
    if (staged.length === 0) return; // staged がない時はリスナー不要

    const iframe = iframeRefsMap.current.get(activeId);
    if (!iframe) return;

    const attachListener = (win: Window) => {
      const onKeydown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        // 二重呼び出しガード: uploading 中、または staged が空なら何もしない
        if (stagedRef.current.length === 0) return;
        if (state.kind === 'uploading') return;
        // xterm.js が keydown を処理する前に捕まえ、Enter を PTY へ送らせない。
        // preventDefault だけでは xterm.js の keydown ハンドラは止まらないため stopPropagation も必要。
        event.preventDefault();
        event.stopPropagation();
        void sendStaged(true);
      };
      win.addEventListener('keydown', onKeydown, true); // capture: xterm.js が stopPropagation するため
      return onKeydown;
    };

    let win: Window | null = null;
    let handler: ((e: KeyboardEvent) => void) | null = null;

    if (iframe.contentWindow) {
      win = iframe.contentWindow;
      handler = attachListener(win);
    } else {
      // iframe がまだロードされていない場合は load イベント後に登録する
      const onLoad = () => {
        if (iframe.contentWindow) {
          win = iframe.contentWindow;
          handler = attachListener(win);
        }
      };
      iframe.addEventListener('load', onLoad, { once: true });
      return () => {
        iframe.removeEventListener('load', onLoad);
      };
    }

    return () => {
      if (win && handler) win.removeEventListener('keydown', handler, true);
    };
  }, [staged.length, activeId, sendStaged, state.kind]);

  const activeBackend = backends[activeId] ?? { kind: 'checking' };

  // ページロード時の自動切替は廃止（MC-180）。手動 switchAccount のみ対応。

  return (
    <div className="flex h-full flex-col" style={{ overscrollBehavior: 'none' }}>
      {/* タブバー（MC-119）: 3つのターミナルを切り替える。小画面でも横スクロールで押せる。 */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1.5">
        {TERMINAL_TABS.map((t) => {
          const isActive = t.id === activeId;
          const st = backends[t.id]?.kind ?? 'checking';
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              aria-pressed={isActive}
              style={{ touchAction: 'manipulation' }}
              className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-active/50 bg-active-bg text-active'
                  : 'border-border bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text'
              }`}
            >
              <TerminalIcon width={13} height={13} className="pointer-events-none" />
              <span>{terminalLabels[t.id] ?? t.label}</span>
              {/* 稼働状態ドット */}
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${st === 'ready' ? 'bg-active' : 'bg-text-faint'}`}
              />
            </button>
          );
        })}

        {/* レイアウト切替（MC-156）: 同時表示する分割数 1/2/3/4 を選ぶ。md 以上でのみ表示。
            スマホ（md 未満）では従来どおりタブ単一表示なので非表示。 */}
        <div
          role="group"
          aria-label="分割表示の切替"
          className="ml-auto hidden shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5 md:flex"
          title="ターミナルを同時表示する数（1〜4）"
        >
          {[1, 2, 3, 4].map((n) => {
            const sel = splitCount === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => changeSplitCount(n)}
                aria-pressed={sel}
                title={`${n}分割`}
                style={{ touchAction: 'manipulation' }}
                className={`flex h-6 w-6 items-center justify-center rounded text-xs font-semibold transition-colors ${
                  sel ? 'bg-active-bg text-active' : 'text-text-muted hover:bg-surface-3 hover:text-text'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>

      </div>

      {/* ツールバー: 画像添付・出力・新しいタブで開く。補助機能はターミナル1のみ有効。 */}
      <div className="mb-2 shrink-0 border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,text/*,.ts,.js,.py,.json,.yaml,.yml,.csv,.md,.txt"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
            id="terminal-images"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={state.kind === 'uploading' || staged.length >= MAX_IMAGES}
            className="flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImageFileIcon width={13} height={13} />
            ファイルを選択
          </button>
          {staged.length > 0 && (
            <span className="text-[11px] text-text-faint">{staged.length} / {MAX_IMAGES}</span>
          )}
          <button
            type="button"
            onClick={() => setShowOutput(true)}
            className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            出力を見る
          </button>
          <a
            href={activeId === 1 ? '/terminal-standalone' : activeTab.path}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            新しいタブで開く
          </a>
        </div>

        {/* ステージング中のサムネ一覧。画像はサムネ表示、テキスト系はファイル名表示。 */}
        {staged.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {staged.map((s) => (
              <div
                key={s.id}
                className="relative w-20 rounded-md border border-border bg-surface-2"
              >
                {s.isImage ? (
                  <img
                    src={s.url}
                    alt={s.file.name}
                    className="h-16 w-full rounded-t-md object-cover"
                  />
                ) : (
                  <div
                    className="flex h-16 w-full items-center justify-center rounded-t-md bg-surface-3 px-1"
                    title={s.file.name}
                  >
                    <span className="truncate text-center text-[9px] text-text-muted leading-tight">
                      {s.file.name}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`${s.file.name} を削除`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeStaged(s.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={state.kind === 'uploading'}
                  style={{ touchAction: 'manipulation' }}
                  className="absolute -right-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text shadow-sm hover:bg-surface-3 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CloseIcon width={14} height={14} className="pointer-events-none" />
                </button>
                <div
                  className="truncate rounded-b-md px-1 py-0.5 text-[9px] text-text-faint"
                  title={`${s.file.name}（${formatBytes(s.file.size)}）`}
                >
                  {formatBytes(s.file.size)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 送信アクション。 */}
        {staged.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void sendStaged()}
              disabled={state.kind === 'uploading' || staged.length === 0}
              className="flex items-center gap-2 rounded-lg border border-active/40 bg-active-bg px-3 py-1.5 text-xs font-medium text-active hover:bg-active/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.kind === 'uploading' ? (
                <>
                  <Spinner />
                  送信中…
                </>
              ) : (
                <>
                  <PlusIcon width={14} height={14} />
                  送る（{staged.length} 個）
                </>
              )}
            </button>
          </div>
        )}

        {/* 結果フィードバック。 */}
        {state.kind === 'done' && (
          <div
            role="status"
            className="mt-2 flex items-start gap-2 rounded-md border border-active/40 bg-active-bg px-3 py-2 text-[11px] text-active"
          >
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => setState({ kind: 'idle' })}
              className="mt-0.5 shrink-0 text-active/70 hover:text-active"
            >
              <CloseIcon width={12} height={12} />
            </button>
            <span>
              {state.distribution
                ? `${state.count} 個を分散送信しました（${state.distribution.map((d) => `ターミナル${d.terminal}: ${d.count}個`).join('、')}）`
                : state.injected
                ? `追加しました`
                : `追加しました（パス: ${state.paths.join('  ')}）`}
            </span>
          </div>
        )}
        {state.kind === 'error' && (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-md border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-[11px]"
            style={{ color: 'var(--mc-stalled)' }}
          >
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => setState({ kind: 'idle' })}
              className="mt-0.5 shrink-0 opacity-70 hover:opacity-100"
            >
              <CloseIcon width={12} height={12} />
            </button>
            <span>{state.message}</span>
          </div>
        )}
      </div>

      {/* 端末本体（MC-156）: 4つの iframe を常時 mount し、CSS grid で N ペインを同時表示する。
          - 単一表示（effectiveSplit=1）はアクティブの 1 枚だけを表示（従来挙動）。
          - 分割表示は各ペインの割当ターミナルだけをそのセルに配置し、それ以外は hidden で保持。
          iframe を unmount / src 差し替えしないことでセッションを保持する（要件 4）。
          MC-156: 各ペインの iframe タップを検知するため、透過 pointerdown overlay を置き focusedPane を同期。 */}
      <div
        className="relative flex-1 overflow-hidden bg-bg"
        style={{
          overscrollBehavior: 'none',
          display: 'grid',
          gap: effectiveSplit > 1 ? '4px' : '0',
          ...gridTemplate(effectiveSplit),
        }}
      >
        {TERMINAL_TABS.map((t) => {
          const st = backends[t.id] ?? { kind: 'checking' };
          // このターミナルを表示するペイン（最初に割り当てられたもの）。なければ非表示で mount 保持。
          const paneIdx =
            effectiveSplit > 1
              ? visiblePaneAssign.findIndex((id) => id === t.id)
              : activeId === t.id
              ? 0
              : -1;
          const isVisible = paneIdx >= 0;
          const placement = isVisible ? panePlacement(effectiveSplit, paneIdx) : null;
          const isFocusedPane = effectiveSplit > 1 && paneIdx === focusedPane;
          return (
            <div
              key={t.id}
              onMouseDown={() => {
                if (effectiveSplit > 1 && paneIdx >= 0) setFocusedPane(paneIdx);
              }}
              onPointerDown={() => {
                // MC-156: タップ時に focusedPane を同期（iframe タップ検知）
                if (effectiveSplit > 1 && paneIdx >= 0) setFocusedPane(paneIdx);
              }}
              // 表示中はグリッドセルへ配置、非表示は hidden（iframe は mount 維持＝セッション保持）。
              className={`relative ${isVisible ? '' : 'hidden'}`}
              style={
                isVisible && effectiveSplit > 1
                  ? {
                      ...placement,
                      outline: isFocusedPane ? '2px solid var(--mc-active, #3b82f6)' : 'none',
                      outlineOffset: '-2px',
                    }
                  : isVisible
                  ? { position: 'absolute', inset: 0 }
                  : undefined
              }
            >
              {/* 分割時の小さなペインセレクタ（このペインに映すターミナルを選ぶ）。 */}
              {isVisible && effectiveSplit > 1 && (
                <div className="absolute left-1 top-1 z-10 flex items-center gap-1">
                  <select
                    value={t.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setFocusedPane(paneIdx);
                      changePaneAssign(paneIdx, parseInt(e.target.value, 10));
                    }}
                    aria-label={`ペイン${paneIdx + 1} のターミナル`}
                    className="h-6 rounded border border-border bg-surface/90 px-1 text-[10px] font-medium text-text backdrop-blur outline-none"
                  >
                    {TERMINAL_TABS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {terminalLabels[opt.id] ?? opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {st.kind === 'ready' ? (
                <>
                  <iframe
                    key={iframeKeys[t.id]}
                    ref={(el) => {
                      if (el) {
                        iframeRefsMap.current.set(t.id, el);
                      } else {
                        iframeRefsMap.current.delete(t.id);
                      }
                    }}
                    src={t.path}
                    title={`Apollo ${terminalLabels[t.id] ?? t.label}`}
                    className="h-full w-full border-0"
                    allow="clipboard-read; clipboard-write"
                    style={{ overscrollBehavior: 'none' }}
                  />
                  {/* MC-156: iframe タップ検知用の透過オーバーレイ。
                      分割表示の時だけ表示し、pointerdown で focusedPane を同期。
                      フォーカス中のペインには表示しない（!isFocusedPane）ので直接操作が届く。
                      フォーカス外ペインは z-10 でiframeの手前に置き、タップを捕捉してフォーカスを移す。
                      wheel イベントは preventDefault しない（親 container へ伝搬させてスクロール効かせる）。 */}
                  {isVisible && effectiveSplit > 1 && !isFocusedPane && (
                    <div
                      className="absolute inset-0 z-10 pointer-events-auto"
                      style={{
                        // ポインターイベントだけを捕捉し、視覚的には透過
                        background: 'transparent',
                      }}
                      onPointerDown={() => {
                        if (paneIdx >= 0) {
                          setFocusedPane(paneIdx);
                          // pointerdown を捉えてフォーカスを移す。iframeへの伝搬はブラウザが行う。
                        }
                      }}
                      onWheel={() => {
                        // wheel イベントは overlay で preventDefault しない。
                        // 親の grid container へ伝搬させてスクロール操作を有効にする
                      }}
                      aria-hidden="true"
                    />
                  )}
                </>
              ) : (
                // バックエンド（ttyd / tmux main）が切断・未起動・確認中の状態パネル。
                <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                  {st.kind === 'checking' ? (
                    <div className="flex items-center gap-2 text-sm text-text-muted">
                      <Spinner />
                      ターミナルの状態を確認しています…
                    </div>
                  ) : (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted">
                        <TerminalIcon width={22} height={22} />
                      </div>
                      <div className="max-w-sm space-y-1">
                        <p className="text-sm font-medium text-text">
                          {terminalLabels[t.id] ?? t.label} が切断されています
                        </p>
                        <p className="text-xs text-text-muted">
                          端末サーバ（ttyd）が停止しています。「ターミナルを開始」で復旧できます。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void startBackend(t.id)}
                        disabled={st.kind === 'starting'}
                        className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {st.kind === 'starting' ? (
                          <>
                            <Spinner />
                            起動しています…
                          </>
                        ) : (
                          <>
                            <TerminalIcon width={15} height={15} />
                            ターミナルを開始
                          </>
                        )}
                      </button>
                      {st.kind === 'start-error' && (
                        <p role="alert" className="max-w-sm text-xs" style={{ color: 'var(--mc-stalled)' }}>
                          {st.message}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* キーバー開閉トグル（モバイル専用 / md 以上では非表示）。
            アクティブターミナルが ready かつ補助機能対象（=1）のときだけ出す。 */}
        {activeBackend.kind === 'ready' && (
          <button
            type="button"
            onClick={toggleKeybar}
            aria-label={keybarOpen ? 'キーバーを閉じる' : 'キーバーを開く'}
            aria-pressed={keybarOpen}
            title={keybarOpen ? 'キーバーを閉じる' : 'キーバーを開く'}
            style={{ touchAction: 'manipulation' }}
            className={`absolute bottom-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border shadow-md md:hidden ${
              keybarOpen
                ? 'border-active/50 bg-active-bg text-active'
                : 'border-border bg-surface/90 text-text-muted backdrop-blur hover:text-text'
            }`}
          >
            <KeyboardIcon width={20} height={20} />
          </button>
        )}
      </div>

      {/* モバイル専用 仮想キーバー（md 以上では非表示）。
          補助機能対象（ターミナル1）が ready のときだけ出す。送信先は tmux main。 */}
      {keybarOpen && activeBackend.kind === 'ready' && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border bg-surface px-2 py-2 md:hidden">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                sendText(keyInput);
                setKeyInput('');
              }
            }}
            placeholder="テキスト入力..."
            className="h-11 min-w-0 flex-1 rounded border border-border bg-surface-2 px-2.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-active/40"
          />

          <button
            type="button"
            onPointerDown={(e) => handleArrowPointerDown('up', e.pointerId)}
            onPointerUp={(e) => handleArrowPointerUp(e.pointerId)}
            onPointerLeave={(e) => handleArrowPointerUp(e.pointerId)}
            onPointerCancel={(e) => handleArrowPointerUp(e.pointerId)}
            aria-label="上"
            style={{ touchAction: 'none' }}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 text-base text-text active:bg-surface-3"
          >
            ↑
          </button>
          <button
            type="button"
            onPointerDown={(e) => handleArrowPointerDown('down', e.pointerId)}
            onPointerUp={(e) => handleArrowPointerUp(e.pointerId)}
            onPointerLeave={(e) => handleArrowPointerUp(e.pointerId)}
            onPointerCancel={(e) => handleArrowPointerUp(e.pointerId)}
            aria-label="下"
            style={{ touchAction: 'none' }}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 text-base text-text active:bg-surface-3"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => sendKey('Enter')}
            aria-label="Enter"
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 font-mono text-base text-text active:bg-surface-3"
          >
            ↵
          </button>
          <button
            type="button"
            onClick={() => sendKey('Escape')}
            aria-label="Escape"
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 text-xs text-text active:bg-surface-3"
          >
            Esc
          </button>
          <button
            type="button"
            onClick={() => {
              sendText(keyInput);
              setKeyInput('');
            }}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-2 px-2 text-xs text-text active:bg-surface-3"
          >
            送信
          </button>
        </div>
      )}
      {showOutput && <OutputModal terminal={activeId} onClose={() => setShowOutput(false)} />}
    </div>
  );
}
