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
// MC-95 / MC-102 / MC-123 ファイル添付（全ターミナル）:
//   選んだ／貼り付けたファイル（画像 / テキスト / ドキュメント / 動画 / 音声）をフロントの配列に
//   貯め、画像はサムネ・非画像は種別アイコン付きチップでプレビュー → 「送る」で一括 POST。
//   サーバは data/terminal-uploads/ に保存し、絶対パス群を対象セッションの入力欄へ send-keys で
//   リテラル注入する（自動 Enter なし）。remote(2) は scp で旧箱へコピーしてから旧箱パスを注入する。
//   林はそのパスを Read で読める（注入はパスを送るだけなのでファイル種別を問わず動く）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  ImageFileIcon,
  CloseIcon,
  TerminalIcon,
  PlusIcon,
  KeyboardIcon,
  DocumentsIcon,
  VideoFileIcon,
  AudioFileIcon,
} from '../components/icons';
import { Spinner } from '../components/ui';
import {
  LAYOUTS,
  LAYOUT_ORDER,
  computeLayout,
  resizeAt,
  equalize,
  matchesShape,
} from './terminalSplit';
import type { LayoutId, SplitNode } from './terminalSplit';

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
// MC-156（作り直し）: 分割レイアウトの保存キー。
//   layout   = 選んだレイアウト id（single/cols2/cols3/rows2/rows3/grid2x2）
//   trees    = レイアウトごとのサイズ比ツリー（ドラッグ結果を永続化）
//   assign   = スロット index → ターミナル id の割当
const LAYOUT_STORAGE_KEY = 'apollo.terminal.layout';
const TREES_STORAGE_KEY = 'apollo.terminal.trees';
const PANE_ASSIGN_STORAGE_KEY = 'apollo.terminal.paneAssign.v2';

// スロット数ぶんの既定割当を TERMINAL_TABS の id 順（1/3/4/5）で作る。
//   旧実装は [1,2,3,4] を既定にしていて存在しない id=2 を割り当て、
//   2分割を押しても 1 枚しか出ない不具合になっていた。ここで実 id に揃える。
function defaultPaneAssign(count: number): number[] {
  return Array.from({ length: count }, (_, i) => TERMINAL_TABS[i]?.id ?? TERMINAL_TABS[0].id);
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
// 個別許可 application MIME（ドキュメント系）。text/* video/* audio/* は prefix 判定で通す。
const ACCEPTED_DOC_MIME = new Set([
  'application/json',
  'application/javascript',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'application/x-yaml',
  'application/yaml',
]);
// 拡張子ホワイトリスト（MIME が空/unknown のローカルファイル救済用）。サーバと揃える。
const ACCEPTED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.txt', '.md', '.csv', '.ts', '.js', '.py', '.json', '.yaml', '.yml',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
]);
const MAX_FILES = 5;
const MAX_BYTES = 1024 * 1024 * 1024; // 1GB / ファイル（サーバ既定と揃える）

/** ファイル末尾の小文字拡張子を返す（無ければ ''）。 */
function fileExt(name: string): string {
  const dotIdx = name.lastIndexOf('.');
  return dotIdx >= 0 ? name.slice(dotIdx).toLowerCase() : '';
}

/** MIME またはファイル拡張子で受理可能なファイルか判定する（画像/テキスト/ドキュメント/動画/音声）。 */
function isAcceptedFile(f: File): boolean {
  if (ACCEPTED_IMAGE_MIME.includes(f.type)) return true;
  if (f.type.startsWith('text/') || f.type.startsWith('video/') || f.type.startsWith('audio/')) return true;
  if (ACCEPTED_DOC_MIME.has(f.type)) return true;
  // MIME が空または unknown のときは拡張子で判断する（ローカルファイルで多い）。
  return ACCEPTED_EXT.has(fileExt(f.name));
}

/** ステージング表示用の種別。画像はサムネ、それ以外は種別アイコン付きチップで出す。 */
type StagedKind = 'image' | 'video' | 'audio' | 'doc';

/** ファイルの表示種別を MIME / 拡張子から判定する。 */
function stagedKind(f: File): StagedKind {
  if (ACCEPTED_IMAGE_MIME.includes(f.type)) return 'image';
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('image/')) return 'image';
  const ext = fileExt(f.name);
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) return 'audio';
  return 'doc';
}

// ステージング中の 1 ファイル。file は送信用、url は画像サムネ表示用（非画像は url=''）。
interface StagedImage {
  id: string;
  file: File;
  url: string; // 画像のみ ObjectURL。非画像は ''。
  isImage: boolean;
  kind: StagedKind; // 表示用の種別（image=サムネ / video/audio/doc=チップ）。
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


/** レイアウトピッカー用の小さなアイコン。分割の形を線で表す（CSS変数色に追従）。 */
function LayoutGlyph({ id }: { id: LayoutId }) {
  const stroke = 'currentColor';
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' } as const;
  const frame = (
    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke={stroke} strokeWidth="1.3" />
  );
  switch (id) {
    case 'cols2':
      return (
        <svg {...common} aria-hidden>
          {frame}
          <line x1="8" y1="2" x2="8" y2="14" stroke={stroke} strokeWidth="1.3" />
        </svg>
      );
    case 'cols3':
      return (
        <svg {...common} aria-hidden>
          {frame}
          <line x1="6" y1="2" x2="6" y2="14" stroke={stroke} strokeWidth="1.3" />
          <line x1="10.5" y1="2" x2="10.5" y2="14" stroke={stroke} strokeWidth="1.3" />
        </svg>
      );
    case 'rows2':
      return (
        <svg {...common} aria-hidden>
          {frame}
          <line x1="2" y1="8" x2="14" y2="8" stroke={stroke} strokeWidth="1.3" />
        </svg>
      );
    case 'rows3':
      return (
        <svg {...common} aria-hidden>
          {frame}
          <line x1="2" y1="6" x2="14" y2="6" stroke={stroke} strokeWidth="1.3" />
          <line x1="2" y1="10.5" x2="14" y2="10.5" stroke={stroke} strokeWidth="1.3" />
        </svg>
      );
    case 'grid2x2':
      return (
        <svg {...common} aria-hidden>
          {frame}
          <line x1="8" y1="2" x2="8" y2="14" stroke={stroke} strokeWidth="1.3" />
          <line x1="2" y1="8" x2="14" y2="8" stroke={stroke} strokeWidth="1.3" />
        </svg>
      );
    default: // single
      return (
        <svg {...common} aria-hidden>
          {frame}
        </svg>
      );
  }
}

export default function Terminal() {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [showOutput, setShowOutput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 成功フィードバック（「追加しました」等）は一定時間後に自動で消す。
  // error は対処が必要なため自動消滅させず、手動の×ボタンのままにする。
  useEffect(() => {
    if (state.kind !== 'done') return;
    const timer = setTimeout(() => setState({ kind: 'idle' }), 4000);
    return () => clearTimeout(timer);
  }, [state.kind]);

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

  // ── 分割レイアウト（MC-156 作り直し）─────────────────────────────
  // layoutId: 選んだレイアウト（single/cols2/cols3/rows2/rows3/grid2x2）。
  const [layoutId, setLayoutId] = useState<LayoutId>(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY) as LayoutId | null;
      if (raw && raw in LAYOUTS) return raw;
    } catch {
      // localStorage 不可なら単一。
    }
    return 'single';
  });

  // trees: レイアウトごとのサイズ比ツリー（ドラッグ結果）。形状が定義と合わなければ既定に戻す。
  const [trees, setTrees] = useState<Partial<Record<LayoutId, SplitNode>>>(() => {
    try {
      const raw = localStorage.getItem(TREES_STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Partial<Record<LayoutId, SplitNode>>;
        const cleaned: Partial<Record<LayoutId, SplitNode>> = {};
        for (const id of LAYOUT_ORDER) {
          const stored = obj[id];
          if (stored && matchesShape(stored, LAYOUTS[id].build())) cleaned[id] = stored;
        }
        return cleaned;
      }
    } catch {
      // 壊れていれば既定ツリー（build）にフォールバック。
    }
    return {};
  });

  // paneAssign[slot] = スロット slot に映すターミナル id（TERMINAL_TABS の id）。
  const [paneAssign, setPaneAssign] = useState<number[]>(() => {
    const def = defaultPaneAssign(TERMINAL_TABS.length);
    try {
      const raw = localStorage.getItem(PANE_ASSIGN_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          // 各要素が実在 id ならそれを、そうでなければ既定で埋める。
          return def.map((d, i) => (TERMINAL_TABS.some((t) => t.id === arr[i]) ? (arr[i] as number) : d));
        }
      }
    } catch {
      // 壊れていれば既定割当。
    }
    return def;
  });

  // フォーカス中のスロット（0 始まり）。補助機能の対象ターミナルを決める。
  const [focusedPane, setFocusedPane] = useState(0);

  // 現在レイアウトのツリー（永続化が無ければ既定 build）。
  // デスクトップのみ分割。スマホ（md 未満）は常に単一にフォールバック。
  const effectiveLayoutId: LayoutId = isDesktop ? layoutId : 'single';
  const effectiveDef = LAYOUTS[effectiveLayoutId];
  const tree = trees[effectiveLayoutId] ?? effectiveDef.build();
  const paneCount = effectiveDef.paneCount;
  const isSplit = paneCount > 1;

  // 各スロットの矩形（%）とディバイダを算出。
  const { rects, dividers } = useMemo(() => computeLayout(tree), [tree]);

  // スロット slot に割り当てられたターミナル id（無ければ既定）。
  const slotTerminal = useCallback(
    (slot: number): number => {
      const id = paneAssign[slot];
      if (TERMINAL_TABS.some((t) => t.id === id)) return id;
      return defaultPaneAssign(TERMINAL_TABS.length)[slot] ?? TERMINAL_TABS[0].id;
    },
    [paneAssign],
  );

  // レイアウトを切り替える。
  const changeLayout = useCallback((id: LayoutId) => {
    setLayoutId(id);
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, id);
    } catch {
      // 保持できなくても切替自体は機能させる。
    }
    setFocusedPane((p) => Math.min(p, LAYOUTS[id].paneCount - 1));
  }, []);

  // ツリーを更新（ドラッグ/均等化）→ 該当レイアウトのぶんを永続化。
  const updateTree = useCallback(
    (id: LayoutId, next: SplitNode) => {
      setTrees((prev) => {
        const merged = { ...prev, [id]: next };
        try {
          localStorage.setItem(TREES_STORAGE_KEY, JSON.stringify(merged));
        } catch {
          // 保持失敗は無視。
        }
        return merged;
      });
    },
    [],
  );

  // 指定スロットの割当ターミナルを変更する。
  const changePaneAssign = useCallback((slot: number, terminalId: number) => {
    setPaneAssign((prev) => {
      const next = [...prev];
      next[slot] = terminalId;
      try {
        localStorage.setItem(PANE_ASSIGN_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 保持失敗は無視。
      }
      return next;
    });
  }, []);
  // MC-123: 補助機能（画像添付・出力・キーバー）は全ターミナルで有効。各操作は activeId を対象にする。
  // MC-156: 分割表示中はフォーカス中スロットの割当ターミナルを activeId に同期する。
  //   送信系ロジックは従来どおり activeIdRef を参照するので、ここで同期すれば壊れない。
  useEffect(() => {
    if (isSplit) {
      const target = slotTerminal(Math.min(focusedPane, paneCount - 1));
      setActiveId((prev) => (prev === target ? prev : target));
    }
  }, [isSplit, focusedPane, paneCount, slotTerminal]);

  // 最新の activeId をコールバック内で参照するための ref（オートリピート等のクロージャ向け）。
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // ── ディバイダのドラッグリサイズ（MC-156 作り直し）──────────────
  // 分割コンテナの実寸を基準に、ポインタ移動量を % に変換してツリーの sizes を更新する。
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  // ドラッグ中はフラグを立て、iframe にオーバーレイをかけてポインタを奪わせない。
  const [dragging, setDragging] = useState(false);

  const startDividerDrag = useCallback(
    (e: ReactPointerEvent, divider: { orientation: 'row' | 'col'; path: number[]; beforeIndex: number }) => {
      e.preventDefault();
      e.stopPropagation();
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const horizontal = divider.orientation === 'row';
      const span = horizontal ? rect.width : rect.height;
      if (span <= 0) return;
      const startPos = horizontal ? e.clientX : e.clientY;
      // ドラッグ開始時点のツリーを基準に、毎回 absolute delta を適用する。
      const baseTree = trees[effectiveLayoutId] ?? effectiveDef.build();
      setDragging(true);

      const onMove = (ev: PointerEvent) => {
        const pos = horizontal ? ev.clientX : ev.clientY;
        const deltaPct = ((pos - startPos) / span) * 100;
        const next = resizeAt(baseTree, divider.path, divider.beforeIndex, deltaPct);
        updateTree(effectiveLayoutId, next);
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [trees, effectiveLayoutId, effectiveDef, updateTree],
  );

  // ディバイダのダブルクリックでそのレイアウトを均等化する。
  const handleEqualize = useCallback(() => {
    updateTree(effectiveLayoutId, equalize(effectiveDef.build()));
  }, [effectiveLayoutId, effectiveDef, updateTree]);

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
      setState({ kind: 'error', message: '対応するファイル（画像 / テキスト / ドキュメント / 動画 / 音声）が見つかりませんでした。' });
      return;
    }
    const tooLarge = accepted.find((f) => f.size > MAX_BYTES);
    if (tooLarge) {
      setState({ kind: 'error', message: '各ファイルは 1GB までです。' });
      return;
    }
    setStaged((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) {
        setState({ kind: 'error', message: `ファイルは合計 ${MAX_FILES} 個までです。先に何個か削除してください。` });
        return prev;
      }
      const toAdd = accepted.slice(0, room);
      if (toAdd.length < accepted.length) {
        setState({
          kind: 'error',
          message: `ファイルは合計 ${MAX_FILES} 個までです。${accepted.length - toAdd.length} 個は追加できませんでした。`,
        });
      } else {
        setState({ kind: 'idle' });
      }
      const next = toAdd.map((f, i) => {
        const isImage = ACCEPTED_IMAGE_MIME.includes(f.type) || f.type.startsWith('image/');
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
          kind: stagedKind(named),
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

        {/* レイアウトピッカー（MC-156 作り直し）: 単一 / 横2列 / 横3列 / 縦2段 / 縦3段 / 2×2 を
            アイコン付きで選ぶ。md 以上でのみ表示。スマホ（md 未満）はタブ単一表示なので非表示。 */}
        <div
          role="group"
          aria-label="レイアウトの切替"
          className="ml-auto hidden shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5 md:flex"
          title="ターミナルの配置（ドラッグで境界を動かせます）"
        >
          {LAYOUT_ORDER.map((id) => {
            const def = LAYOUTS[id];
            const sel = layoutId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => changeLayout(id)}
                aria-pressed={sel}
                title={def.label}
                style={{ touchAction: 'manipulation' }}
                className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                  sel ? 'bg-active-bg text-active' : 'text-text-muted hover:bg-surface-3 hover:text-text'
                }`}
              >
                <LayoutGlyph id={id} />
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
            accept="image/*,video/*,audio/*,text/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.csv,.md,.txt,.json,.yaml,.yml,.ts,.js,.py"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
            id="terminal-images"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={state.kind === 'uploading' || staged.length >= MAX_FILES}
            className="flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImageFileIcon width={13} height={13} />
            ファイルを選択
          </button>
          {staged.length > 0 && (
            <span className="text-[11px] text-text-faint">{staged.length} / {MAX_FILES}</span>
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

        {/* ステージング中の一覧。画像はサムネ表示、非画像（ドキュメント/動画/音声）は
            種別アイコン＋ファイル名のチップ表示。 */}
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
                    className="flex h-16 w-full flex-col items-center justify-center gap-1 rounded-t-md bg-surface-3 px-1 text-text-muted"
                    title={s.file.name}
                  >
                    {s.kind === 'video' ? (
                      <VideoFileIcon width={22} height={22} className="pointer-events-none shrink-0" />
                    ) : s.kind === 'audio' ? (
                      <AudioFileIcon width={22} height={22} className="pointer-events-none shrink-0" />
                    ) : (
                      <DocumentsIcon width={22} height={22} className="pointer-events-none shrink-0" />
                    )}
                    <span className="w-full truncate text-center text-[9px] leading-tight">
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

      {/* 端末本体（MC-156 作り直し）: 4つの iframe を常時 mount したまま、分割ツリーが算出した
          各スロットの矩形（%）へ絶対配置する。レイアウト切替・ドラッグリサイズでも iframe を
          unmount / src 差し替えしないのでセッションを保持する（要件 4）。
          ディバイダ（境界線）をドラッグすると幅/高さの比が連続的に変わり localStorage に永続化。 */}
      <div
        ref={splitContainerRef}
        className="relative flex-1 overflow-hidden bg-bg"
        style={{ overscrollBehavior: 'none' }}
        data-layout={effectiveLayoutId}
      >
        {TERMINAL_TABS.map((t) => {
          const st = backends[t.id] ?? { kind: 'checking' };
          // このターミナルが映るスロット。分割時は割当に一致する最初のスロット、単一時は activeId。
          const slot = isSplit
            ? rects.findIndex((r) => slotTerminal(r.slot) === t.id)
            : activeId === t.id
            ? 0
            : -1;
          const isVisible = slot >= 0;
          // スロット slot の矩形（%）。単一時はコンテナ全面。
          const rect = isSplit && isVisible ? rects[slot] : null;
          const slotIndex = isSplit && isVisible ? rects[slot].slot : 0;
          const isFocusedPane = isSplit && isVisible && slotIndex === focusedPane;
          const positionStyle: CSSProperties = isVisible
            ? rect
              ? {
                  position: 'absolute',
                  left: `${rect.left}%`,
                  top: `${rect.top}%`,
                  width: `${rect.width}%`,
                  height: `${rect.height}%`,
                  outline: isFocusedPane ? '2px solid var(--mc-active, #16a85c)' : 'none',
                  outlineOffset: '-2px',
                }
              : { position: 'absolute', inset: 0 }
            : { display: 'none' };
          return (
            <div
              key={t.id}
              onMouseDown={() => {
                if (isSplit && isVisible) setFocusedPane(slotIndex);
              }}
              onPointerDown={() => {
                if (isSplit && isVisible) setFocusedPane(slotIndex);
              }}
              className="relative overflow-hidden"
              style={positionStyle}
            >
              {/* 分割時のペインヘッダ（このペインに映すターミナルを選ぶドロップダウン）。
                  端末本体は常に暗い iframe なので、ヘッダのピルはテーマに依存せず
                  「暗い半透明背景＋明色テキスト」で固定する。ライト/ダーク両テーマで、
                  暗いターミナル上に乗ってもラベル（Main 等）と ▼ が washed out にならない。
                  option 側は OS のメニュー配色（暗背景・明文字）を指定して開いた時も読めるようにする。 */}
              {isSplit && isVisible && (
                <div className="absolute left-1 top-1 z-20 flex items-center gap-1">
                  <select
                    value={t.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setFocusedPane(slotIndex);
                      changePaneAssign(slotIndex, parseInt(e.target.value, 10));
                    }}
                    aria-label={`ペイン${slotIndex + 1} のターミナル`}
                    className="h-6 rounded px-1 text-[10px] font-medium backdrop-blur outline-none"
                    style={{
                      background: 'rgba(12, 18, 30, 0.78)',
                      color: '#eef2f8',
                      border: '1px solid rgba(255, 255, 255, 0.22)',
                      colorScheme: 'dark',
                    }}
                  >
                    {TERMINAL_TABS.map((opt) => (
                      <option
                        key={opt.id}
                        value={opt.id}
                        style={{ background: '#131b2e', color: '#eef2f8' }}
                      >
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
                  {/* iframe ポインタ捕捉オーバーレイ:
                      - ドラッグ中（dragging）は全ペインに掛けて、境界ドラッグ中に iframe が
                        ポインタを奪わない（ttyd の選択等に化けない）ようにする。
                      - 非フォーカスのペインは常時掛けて、1タップでフォーカスを移す。フォーカス中
                        ペインには掛けないので直接操作（キー入力）が届く。 */}
                  {isSplit && isVisible && (!isFocusedPane || dragging) && (
                    <div
                      className="absolute inset-0 z-10"
                      style={{ background: 'transparent', cursor: dragging ? 'inherit' : 'pointer' }}
                      onPointerDown={() => {
                        if (!dragging) setFocusedPane(slotIndex);
                      }}
                      aria-hidden="true"
                    />
                  )}
                </>
              ) : (
                // バックエンド（ttyd / tmux）が切断・未起動・確認中の状態パネル。
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

        {/* ディバイダ（境界ハンドル）: 分割時のみ。掴みやすい太さの当たり判定を持ち、
            ドラッグで隣り合うペインの幅/高さ比を変える。ダブルクリックで均等化。 */}
        {isSplit &&
          dividers.map((d) => {
            const horizontal = d.orientation === 'row'; // 縦線（左右の幅を調整）
            const HIT = 10; // ハンドルの当たり判定（px）
            return (
              <div
                key={d.id}
                role="separator"
                aria-orientation={horizontal ? 'vertical' : 'horizontal'}
                aria-label="ペインの境界（ドラッグでサイズ変更）"
                onPointerDown={(e) => startDividerDrag(e, d)}
                onDoubleClick={handleEqualize}
                className="absolute z-30 group"
                style={{
                  left: `${d.left}%`,
                  top: `${d.top}%`,
                  width: horizontal ? `${HIT}px` : `${d.width}%`,
                  height: horizontal ? `${d.height}%` : `${HIT}px`,
                  transform: horizontal ? 'translateX(-50%)' : 'translateY(-50%)',
                  cursor: horizontal ? 'col-resize' : 'row-resize',
                  touchAction: 'none',
                }}
              >
                {/* 視覚的なライン（中央）。hover / ドラッグ中はアクセント色で強調。 */}
                <div
                  className="absolute transition-colors"
                  style={
                    horizontal
                      ? {
                          left: '50%',
                          top: 0,
                          height: '100%',
                          width: '2px',
                          transform: 'translateX(-50%)',
                          background: dragging ? 'var(--mc-active)' : 'var(--mc-border-strong)',
                        }
                      : {
                          top: '50%',
                          left: 0,
                          width: '100%',
                          height: '2px',
                          transform: 'translateY(-50%)',
                          background: dragging ? 'var(--mc-active)' : 'var(--mc-border-strong)',
                        }
                  }
                />
                {/* つまみ（中央の小さなグリップ）。 */}
                <div
                  className="absolute rounded-full border border-border bg-surface shadow-sm group-hover:border-active"
                  style={
                    horizontal
                      ? { left: '50%', top: '50%', width: '6px', height: '28px', transform: 'translate(-50%,-50%)' }
                      : { top: '50%', left: '50%', height: '6px', width: '28px', transform: 'translate(-50%,-50%)' }
                  }
                />
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
