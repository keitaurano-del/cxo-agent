// Apollo — 設定・データパス・しきい値
//
// すべてのデータパスは DATA_HOME（default /home/dev）から導出する。
// 環境変数で差し替え可能にすることで、別サーバ・テスト環境でも動く。

import { join } from 'node:path';

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** ユーザーホーム。~/.claude と ~/projects の親。 */
export const DATA_HOME = env('DATA_HOME', '/home/dev');

/** Claude セッションログのルート。subagents 配下の agent ログと親セッション jsonl がここ。 */
export const CLAUDE_PROJECTS_DIR = env('CLAUDE_PROJECTS_DIR', join(DATA_HOME, '.claude', 'projects'));

/** プロジェクト群のルート（~/projects）。 */
export const PROJECTS_DIR = env('PROJECTS_DIR', join(DATA_HOME, 'projects'));

/** Obsidian vault ルート。タスク・ナラティブ・台帳のマスタ。 */
export const VAULT_DIR = env('VAULT_DIR', join(PROJECTS_DIR, 'obsidian-vault'));

/** cxo-agent 自身のタスク台帳（Apollo のドッグフーディング用）。 */
export const CXO_TRACKER = join(PROJECTS_DIR, 'cxo-agent', 'docs', 'TASK_TRACKER.md');

/** cxo-agent ルート。inbox（非同期 指示受信箱）のデータパスの基準。 */
export const CXO_ROOT = join(PROJECTS_DIR, 'cxo-agent');

/** 非同期 指示受信箱のデータディレクトリ（cxo-agent/data）。 */
export const INBOX_DATA_DIR = join(CXO_ROOT, 'data');

/**
 * 成果物（エクセル/パワポ/PDF/CSV/画像/md 等）の配置ルート。
 * 林が生成した成果物をここに置くと Apollo の成果物ビューで一覧・閲覧・DL できる。
 * すべての成果物パス入力は lib/deliverablePath.ts で realpath ベースに安全化する。
 */
export const DELIVERABLES_DIR = env('DELIVERABLES_DIR', join(INBOX_DATA_DIR, 'deliverables'));

/**
 * 成果物アップロード（MC-118）1 ファイルあたりの最大バイト数。
 * 既定 5GB（= 5 * 1024**3）。multer diskStorage でディスクへストリーム保存するため
 * メモリには載らず、box のディスク空き（~323GB）の範囲で大容量も捌ける。env で上書き可。
 * 注意: cloudflared 無料トンネル経由はトンネル側がボディ ~100MB で頭打ちになる既知制約があり、
 * >100MB は直アクセス/LAN か上位プラン経由でのみ通る（サーバ側ストリームはここで上限まで対応）。
 */
export const DELIVERABLE_UPLOAD_MAX_BYTES = envNum(
  'DELIVERABLE_UPLOAD_MAX_BYTES',
  5 * 1024 * 1024 * 1024,
);

/** 成果物アップロード（MC-118）1 リクエストあたりの最大ファイル数。フォルダ一括アップロードを想定して大きめに設定。 */
export const DELIVERABLE_UPLOAD_MAX_FILES = envNum('DELIVERABLE_UPLOAD_MAX_FILES', 999);

/**
 * 成果物ゴミ箱（.trash）の自動パージ閾値（MC-234）。
 * - 保持期間: deletedAt から DELIVERABLE_TRASH_RETENTION_DAYS 日を超えたバッチは自動削除。
 *   既定 30 日。0 以下なら期間ベースのパージは無効。
 * - 容量上限: ゴミ箱の総バイト数が DELIVERABLE_TRASH_MAX_BYTES を超えたら、
 *   保持期間内であっても古い削除順から削って上限以下に収める。既定 2GB。0 以下なら容量ベースは無効。
 * いずれも「保持期間内かつ容量内」のバッチは残す（誤って消さない）。
 */
export const DELIVERABLE_TRASH_RETENTION_DAYS = envNum('DELIVERABLE_TRASH_RETENTION_DAYS', 30);
export const DELIVERABLE_TRASH_MAX_BYTES = envNum(
  'DELIVERABLE_TRASH_MAX_BYTES',
  2 * 1024 * 1024 * 1024,
);

/**
 * 成果物メタデータ（スター/タグ/色ラベル）のサイドカー store（MC-238）。
 * 実体はファイルなので、relpath をキーに { starred, tags[], color } を JSON で保持する。
 * data/ 配下なので .gitignore 済み。rename/move/copy/delete 時にキーを追従させる。
 */
export const DELIVERABLES_META_FILE = env(
  'DELIVERABLES_META_FILE',
  join(INBOX_DATA_DIR, 'deliverables-meta.json'),
);

/**
 * 成果物プレビュー用の変換キャッシュ（Office→PDF）の置き場。
 * data/ 配下なので .gitignore 済み。ソースの sha1+mtime+size をキーに PDF を保存する。
 */
export const DELIVERABLES_CACHE_DIR = env(
  'DELIVERABLES_CACHE_DIR',
  join(INBOX_DATA_DIR, '.deliverables-cache'),
);

/**
 * ノートブック（NotebookLM 的な資料セット＋Q&A＋生成物）のルート（MC-126）。
 * 各ノートブックは <NOTEBOOKS_DIR>/<id>/ に sources/extracted/artifacts/meta.json/chat.jsonl を持つ。
 * data/ 配下なので .gitignore 済み。すべてのパス入力は lib/notebookPath.ts で realpath 安全化する。
 */
export const NOTEBOOKS_DIR = env('NOTEBOOKS_DIR', join(INBOX_DATA_DIR, 'notebooks'));

/** 開発ページの Figma ワイヤーフレーム画像の保存ルート（data/dev-wireframes/<jobId>/<n>.png）。
 *  data/ 配下なので .gitignore 済み。生成ごとに jobId サブディレクトリを作る。 */
export const DEV_WIREFRAMES_DIR = env('DEV_WIREFRAMES_DIR', join(INBOX_DATA_DIR, 'dev-wireframes'));

/** ノートブックのソースアップロード 1 ファイルあたり最大バイト数（既定 2GB）。 */
export const NOTEBOOK_UPLOAD_MAX_BYTES = envNum(
  'NOTEBOOK_UPLOAD_MAX_BYTES',
  2 * 1024 * 1024 * 1024,
);

/** ノートブックのソースアップロード 1 リクエストあたり最大ファイル数。 */
export const NOTEBOOK_UPLOAD_MAX_FILES = envNum('NOTEBOOK_UPLOAD_MAX_FILES', 20);

/** claude CLI バイナリのパス（資料根拠 Q&A・生成物作成エンジン）。 */
export const NOTEBOOK_CLAUDE_BIN = env('NOTEBOOK_CLAUDE_BIN', '/usr/bin/claude');

/** claude -p 1 回あたりのタイムアウト（ミリ秒、既定 600s）。SSH ラッパー経由での rsync+claude 実行時間を考慮して 10 分に設定。 */
export const NOTEBOOK_CLAUDE_TIMEOUT_MS = envNum('NOTEBOOK_CLAUDE_TIMEOUT_MS', 600_000);

/** claude -p の同時実行上限（共有 Anthropic アカウントを食い潰さないため）。 */
export const NOTEBOOK_CLAUDE_CONCURRENCY = envNum('NOTEBOOK_CLAUDE_CONCURRENCY', 2);

/** claude -p に渡すモデル名（明示指定で環境デフォルト依存を避ける）。 */
export const NOTEBOOK_CLAUDE_MODEL = env('NOTEBOOK_CLAUDE_MODEL', 'claude-sonnet-4-6');

/**
 * Sonnet 利用上限/失敗時の自動フォールバック先モデル（MC-202①）。
 * RAG 回答生成は通常 NOTEBOOK_CLAUDE_MODEL（Sonnet）で実行するが、Sonnet 利用上限に達して
 * claude CLI が失敗（"You've hit your Sonnet limit · resets ..." 等）したとき、このモデル（既定 Opus）で
 * 1 回だけ自動再実行して回答を返す。env NOTEBOOK_CLAUDE_FALLBACK_MODEL で差し替え可。
 */
export const NOTEBOOK_CLAUDE_FALLBACK_MODEL = env(
  'NOTEBOOK_CLAUDE_FALLBACK_MODEL',
  'claude-opus-4-8',
);

/**
 * 単語帳「深掘り」1 語解説に使うモデル（既定 Haiku）。
 * 用語集の語は PD/LGD/EAD・IFRS9・与信/引当などモデルが確実に知っている基礎概念で、Web 検索も
 * リポジトリ探索も不要な単発解説なので、速さを優先して Haiku を既定にする（Sonnet だと拡張思考で
 * 15〜20 秒待たされ体感が悪い）。品質を上げたいときは env で Sonnet 等に差し替え可。
 */
export const WORK_GLOSSARY_MODEL = env('WORK_GLOSSARY_MODEL', 'claude-haiku-4-5-20251001');

// ─── エージェント気持ち/思考（mood コレクタ MC-165 拡張）──────────────────
//
// AgentsLive の各カードに「一人称の今の気持ち＋考えてること」を 1 行＋感情絵文字で表示する。
// 全 active エージェントぶんを 1 回のバッチ claude 呼び出し（haiku）で生成し、活動（lastAction）の
// ハッシュでキャッシュ・最短スロットルで連打を防ぐ（トークン節約）。失敗時は status ベースの簡易ムードに
// フォールバックする（claude を呼ばない）。active が 0 なら呼ばない。

/** mood 生成に使うモデル（haiku で安く。env で差し替え可）。 */
export const AGENT_MOOD_MODEL = env('AGENT_MOOD_MODEL', 'claude-haiku-4-5-20251001');

/** mood 生成 claude のタイムアウト（ミリ秒、既定 60s）。バッチ 1 回ぶん。 */
export const AGENT_MOOD_TIMEOUT_MS = envNum('AGENT_MOOD_TIMEOUT_MS', 60_000);

/**
 * mood バッチ生成の最短スロットル（ミリ秒、既定 5 分）。
 * 直前の生成からこの時間が経つまでは、活動に変化があっても再生成しない（コスト厳守）。
 * 範囲は memory「mood はバッチ＋キャッシュ＋3〜5分スロットル」に準拠。
 */
export const AGENT_MOOD_THROTTLE_MS = envNum('AGENT_MOOD_THROTTLE_MS', 5 * 60 * 1000);

/** chat.jsonl に保持する最大メッセージ数（超えたら古いものから削除）。 */
export const NOTEBOOK_CHAT_MAX_MESSAGES = envNum('NOTEBOOK_CHAT_MAX_MESSAGES', 500);

/** artifacts/ の合計サイズ上限バイト（0 = 無制限、既定 10GB）。 */
export const NOTEBOOK_ARTIFACT_MAX_TOTAL_BYTES = envNum(
  'NOTEBOOK_ARTIFACT_MAX_TOTAL_BYTES',
  10 * 1024 * 1024 * 1024,
);

/** Gemini embedding API キー（text-embedding-004 用）。未設定なら RAG 索引なしの従来動作にフォールバック。 */
export const GEMINI_API_KEY = env('GEMINI_API_KEY', '');

/** RAG 検索で返す上位チャンク数（ハイブリッド統合後の最終採用件数）。デフォルト 5。 */
export const NOTEBOOK_RAG_TOP_K = envNum('NOTEBOOK_RAG_TOP_K', 5);

/**
 * RAG 検索の候補拡大件数（MC-223）。
 * ベクトル検索・キーワード検索それぞれで上位この件数まで候補を取り、RRF で統合してから
 * TOP_K に絞る。広めに取ることで、ベクトル単体では取りこぼす固有名詞・ID 一致も拾える。
 */
export const NOTEBOOK_RAG_CANDIDATES = envNum('NOTEBOOK_RAG_CANDIDATES', 30);

/**
 * ベクトルのコサイン類似度の下限閾値（MC-223）。
 * この値未満のチャンクは「関連なし」とみなして候補から除外する。閾値を超える候補が
 * 0 件なら ask 側で「該当なし」として扱い、幻覚を抑制する。0.5 は目安・要調整。
 */
export const NOTEBOOK_RAG_MIN_SCORE = envNum('NOTEBOOK_RAG_MIN_SCORE', 0.5);

/**
 * RRF（Reciprocal Rank Fusion）の平滑化定数 k（MC-223）。
 * 各ランキングでの順位 r（0 始まり）に対し 1/(k + r + 1) を加算して統合スコアとする。
 * 情報検索の慣例値 60 を既定とする。小さいほど上位順位の影響が強くなる。
 */
export const NOTEBOOK_RAG_RRF_K = envNum('NOTEBOOK_RAG_RRF_K', 60);

/** チャンク分割のターゲット文字数。 */
export const NOTEBOOK_RAG_CHUNK_SIZE = envNum('NOTEBOOK_RAG_CHUNK_SIZE', 800);

/** チャンク分割のオーバーラップ文字数。 */
export const NOTEBOOK_RAG_CHUNK_OVERLAP = envNum('NOTEBOOK_RAG_CHUNK_OVERLAP', 100);

/** 受信箱本体（追記専用 JSONL・1 行 1 エントリ）。 */
export const INBOX_FILE = join(INBOX_DATA_DIR, 'inbox.jsonl');

/** 消費記録（自律林が処理後に id を追記する。サーバは読むだけ）。 */
export const INBOX_CONSUMED_FILE = join(INBOX_DATA_DIR, 'inbox-consumed.jsonl');

/** 添付画像のルート（data/inbox-attachments/<id>/<file>）。 */
export const INBOX_ATTACHMENTS_DIR = join(INBOX_DATA_DIR, 'inbox-attachments');

/**
 * タスク↔workflow/agent の明示リンク台帳（MC-62。追記専用 JSONL・1 行 1 リンク）。
 * タスク ID（MC-xx 等）と、それを動かした runId / agentId をここに明示記録し、
 * ID 文字列マッチに頼らず誤紐付けを排除する正本とする。
 */
export const TASK_LINKS_FILE = join(INBOX_DATA_DIR, 'task-links.jsonl');

/**
 * タスク手動編集の監査ログ（MC-71。追記専用 JSONL・1 行 1 編集）。
 * Apollo の TaskDetail から正本 TASK_TRACKER.md へ書き戻した編集をここに記録する。
 * 1 行 = `{ ts, source, id, patch, prevHash, newHash }`。
 */
export const TASK_EDITS_FILE = join(INBOX_DATA_DIR, 'task-edits.jsonl');

/**
 * 承認/却下の監査ログ + デプロイ承認フラグ台帳（MC-79。追記専用 JSONL・1 行 1 決定）。
 * Apollo の承認フローで Keita が承認/却下した決定をここに記録する。
 * 1 行 = `{ ts, source, id, decision: 'approve'|'reject', categories, fromStatus, toStatus, deployApproved?, comment? }`。
 * デプロイ承認は status を TODO に進めつつ、ここに deployApproved:true を立てて
 * autonomous-rin / 林 が「デプロイ承認済み」として拾えるようにする（.md 本文は MC-71 層の
 * status 遷移のみで安全に動かし、自由記述の本文書き換えはしない）。
 */
export const APPROVAL_DECISIONS_FILE = join(INBOX_DATA_DIR, 'approval-decisions.jsonl');

/**
 * エージェント承認リクエスト台帳（追記専用 JSONL・last-wins で ID ごとに最新状態を決定）。
 * autonomous-rin 等のエージェントが「Keita に承認してほしい」内容を直接 POST するための台帳。
 * タスクタグ方式の承認フロー（TASK_TRACKER 由来）とは別の軽量な承認リクエスト仕組み。
 * 1 行 = ApprovalRequest 型（id, from, fromName, title, description, category, requestedAt, status, ...）。
 */
export const APPROVAL_REQUESTS_FILE = join(INBOX_DATA_DIR, 'approval-requests.jsonl');

/**
 * 承認オートモードの永続フラグ（MC-186。data/ 配下なので .gitignore 済み）。
 * ON のとき、エージェント承認リクエスト（POST /api/approvals/request）を自動承認する。
 * 安全ゲート: deploy カテゴリは自動承認せず pending のまま（push/deploy は人間検証必須方針）。
 * 形: { "enabled": boolean, "updatedAt": string|null }。
 */
export const APPROVAL_AUTOMODE_FILE = join(INBOX_DATA_DIR, 'approval-automode.json');

/**
 * ナビ並び順の永続化ファイル（MC-158。data/ 配下なので .gitignore 済み）。
 * 形: { "sidebar": ["/","/tasks",...], "dashboard": ["/plan-usage","/activity",...] }。
 * フロント（サイドメニュー / ダッシュサブタブ）がドラッグ確定で保存し、マウント時に
 * 読み出して default 項目集合とマージしてから順序を適用する（端末横断同期）。
 */
export const NAV_ORDER_FILE = join(INBOX_DATA_DIR, 'nav-order.json');

/**
 * Keita 決裁リクエスト台帳（MC-203。追記専用 JSONL・last-wins で ID ごとに最新状態を決定）。
 * エージェントが「Keita に判断してほしい」内容を選択肢付き（options[]）で直接 POST する台帳。
 * 既存の承認リクエスト（approval-requests.jsonl）とは別系統・別タブで扱う。
 * 1 行 = DecisionRequest 型（id, from, fromName, title, detail, options[], requestedAt, status, ...）。
 */
export const DECISION_REQUESTS_FILE = join(INBOX_DATA_DIR, 'decision-requests.jsonl');

/**
 * 決裁オートモードの永続フラグ（MC-203。承認オートモードとは別キー・別ファイル）。
 * 形: { enabled, mode, updatedAt }。mode='default'=既定 option を自動選択 / mode='off'=自動しない。
 * 安全側既定: enabled=false（手動決裁）。台帳由来 BLOCKED 等は対象外（MC-201 方針踏襲）。
 */
export const DECISION_AUTOMODE_FILE = join(INBOX_DATA_DIR, 'decision-automode.json');

/**
 * エージェント連絡ヘルパ notify-agent.sh の絶対パス（MC-200）。
 * 決裁結果を要求元エージェント（requesterAgent）のターミナルへ流すのに使う（MC-203）。
 * env NOTIFY_AGENT_SCRIPT で差し替え可。
 */
export const NOTIFY_AGENT_SCRIPT = env(
  'NOTIFY_AGENT_SCRIPT',
  join(DATA_HOME, 'cron-scripts', 'notify-agent.sh'),
);

/**
 * notify-agent.sh 実行時の PATH（systemd の env が痩せていても tmux/openclaw を解決させる）。
 * TERMINAL_TMUX_PATH と同方式。
 */
export const NOTIFY_AGENT_PATH = env(
  'NOTIFY_AGENT_PATH',
  '/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH ?? ''),
);

/** 添付画像の 1 枚あたり最大バイト数（10MB）。 */
export const INBOX_MAX_FILE_BYTES = envNum('INBOX_MAX_FILE_BYTES', 10 * 1024 * 1024);

/** 添付画像の最大枚数。 */
export const INBOX_MAX_FILES = envNum('INBOX_MAX_FILES', 5);

// ─── ターミナル画像アップロード（MC-95）──────────────────────────
//
// Apollo のターミナルビューから画像を添付し、tmux main（林 CLI）の入力欄へ
// その保存先絶対パスを send-keys でリテラル注入する。林はそのパスを Read で
// 画像として読める。inbox の画像添付と同じ流儀（multipart・MIME検証・サイズ/枚数上限）。

/** ターミナルアップロード画像の保存ディレクトリ（data/terminal-uploads）。絶対パスを林に渡す基準。 */
export const TERMINAL_UPLOADS_DIR = join(INBOX_DATA_DIR, 'terminal-uploads');

/**
 * ターミナルアップロード 1 ファイルあたりの最大バイト数（既定 1GB）。
 * ドキュメント/動画/音声の添付を考慮して引き上げた。multer は diskStorage 相当の
 * ストリーム保存（メモリ非常駐）なので大物でもメモリは載らない。env で上書き可。
 * 注意: cloudflared 無料トンネル経由は ~100MB で頭打ち。大物は直アクセス/LAN で送る。
 */
export const TERMINAL_UPLOAD_MAX_FILE_BYTES = envNum(
  'TERMINAL_UPLOAD_MAX_FILE_BYTES',
  1024 * 1024 * 1024,
);

/** ターミナルアップロードの最大枚数（5 枚。inbox と揃える）。 */
export const TERMINAL_UPLOAD_MAX_FILES = envNum('TERMINAL_UPLOAD_MAX_FILES', 5);

/** send-keys を送る tmux ターゲット（既定 'main' = 林 CLI 常駐セッション）。env で差し替え可。 */
export const TERMINAL_TMUX_TARGET = env('TERMINAL_TMUX_TARGET', 'main');

/**
 * tmux コマンドの PATH（systemd の env が痩せていても tmux を解決させる）。
 * VAULT_GIT_PATH / DEPLOY_GH_PATH と同方式。
 */
export const TERMINAL_TMUX_PATH = env(
  'TERMINAL_TMUX_PATH',
  '/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH ?? ''),
);

/** tmux send-keys のタイムアウト（ミリ秒）。詰まっても Apollo を固めない。 */
export const TERMINAL_TMUX_TIMEOUT_MS = envNum('TERMINAL_TMUX_TIMEOUT_MS', 5000);

// ─── ターミナルバックエンド復旧（MC-100）──────────────────────────
//
// PC のターミナルが切断された後（tmux main セッション消失 / ttyd 停止）に、
// Apollo の「ターミナルを開始」ボタンから tmux main（林 CLI）と ttyd を再起動して
// 復旧する。GET /api/terminal/status で稼働状態を見て、POST /api/terminal/start で
// 冪等に復旧する。本番 main が稼働中なら no-op。

/**
 * tmux main を作成するときに実行するコマンド（rin-terminal.sh と同じ形・林 CLI 起動を含む）。
 * `tmux new-session -d -s <TARGET> <CMD>` の <CMD> 部分に渡す。
 * 既存の rin-terminal.sh / @reboot crontab と揃えて「1つの林」を共有する。
 */
export const TERMINAL_TMUX_START_CMD = env(
  'TERMINAL_TMUX_START_CMD',
  'cd /home/dev/projects && exec /usr/bin/claude',
);

/**
 * ttyd を起動/再起動する systemd ユニット名。
 * status は `systemctl is-active <unit>`、start は `sudo -n systemctl start <unit>`。
 * dev は NOPASSWD で systemctl を叩ける。
 */
export const TERMINAL_TTYD_SERVICE = env('TERMINAL_TTYD_SERVICE', 'apollo-terminal.service');

/** ttyd が listen しているローカルポート（status の到達確認に使う）。proxy 側 TTYD_PORT と揃える。 */
export const TERMINAL_TTYD_PORT = envNum('TERMINAL_TTYD_PORT', 7681);

/** ttyd が bind しているホスト（status の到達確認に使う）。 */
export const TERMINAL_TTYD_HOST = env('TERMINAL_TTYD_HOST', '127.0.0.1');

/** systemctl / tmux 起動コマンドのタイムアウト（ミリ秒）。 */
export const TERMINAL_CONTROL_TIMEOUT_MS = envNum('TERMINAL_CONTROL_TIMEOUT_MS', 8000);

// ─── 3ターミナル定義（MC-119）──────────────────────────────────
//
// Apollo ターミナルを「3つの独立ターミナル（タブ切替）」にする。各ターミナルは
// 独立した ttyd（127.0.0.1 の別ポート）に対応し、proxy がベースパスで振り分ける:
//   id=1 /terminal      port 7681 apollo-terminal.service   = この箱の tmux main（林）※既存
//   id=2 /terminal/2    port 7682 apollo-terminal-2.service = 旧箱(139.180.202.62)へ ssh して claude
//   id=3 /terminal/3    port 7683 apollo-terminal-3.service = この箱の予備 claude（spare）
//
// 3つとも同じ ttyd Basic 認証 credential（.terminal.env の TTYD_USER/TTYD_PASS）を使う。
// env 上書き例: TERMINAL_2_PORT / TERMINAL_2_SERVICE / TERMINAL_2_LABEL。

/**
 * remote ターミナル（別マシン）への SSH/SCP 接続情報（MC-123）。
 * remote が定義されているターミナルは、tmux 操作（send-keys / capture-pane）を
 * ssh 経由で対象マシンの tmux に対して実行し、画像アップロードは scp で uploadDir へ
 * コピーしてから対象マシン上の絶対パスを注入する。1/3（local）は remote 無し。
 */
export interface TerminalRemote {
  /** SSH 接続先ホスト（IP or ホスト名）。 */
  sshHost: string;
  /** SSH ユーザ名。接続先は `<sshUser>@<sshHost>`。 */
  sshUser: string;
  /** SSH 秘密鍵パス（-i に渡す）。 */
  sshKey: string;
  /** 画像を scp する先のディレクトリ（末尾なし）。注入するのはこの配下の絶対パス。 */
  uploadDir: string;
}

export interface TerminalDef {
  /** ターミナル番号（1 始まり）。1 はベースパス /terminal、2 以降は /terminal/<id>。 */
  id: number;
  /** 振り分け先 ttyd のローカルポート。 */
  port: number;
  /** 復旧（restart / status）対象の systemd ユニット名。 */
  service: string;
  /** UI のタブに表示するラベル（中立的な丁寧体・絵文字なし）。 */
  label: string;
  /**
   * このターミナルが操作する tmux セッション名（MC-123）。
   * send-keys / capture-pane の対象。1='main'(この箱)、2='apollo2'(旧箱)、3='spare'(この箱)。
   */
  tmuxSession: string;
  /**
   * remote 接続情報（MC-123）。定義があれば ssh/scp 経由で対象マシンの tmux を相手にする。
   * undefined なら local（この箱）の tmux を直接 execFile で操作する。
   */
  remote?: TerminalRemote;
}

/** 3ターミナルの定義（env で個別上書き可、最低限はハードコード既定で動く）。 */
export const TERMINALS: TerminalDef[] = [
  {
    id: 1,
    port: envNum('TERMINAL_1_PORT', 7681),
    service: env('TERMINAL_1_SERVICE', 'apollo-terminal.service'),
    label: env('TERMINAL_1_LABEL', 'Main'),
    // この箱（local）の tmux main = 林 CLI 常駐セッション。
    tmuxSession: env('TERMINAL_1_TMUX', 'main'),
  },
  {
    id: 3,
    port: envNum('TERMINAL_3_PORT', 7683),
    service: env('TERMINAL_3_SERVICE', 'apollo-terminal-3.service'),
    label: env('TERMINAL_3_LABEL', 'Aux'),
    // この箱（local）の予備セッション spare。
    tmuxSession: env('TERMINAL_3_TMUX', 'spare'),
  },
  {
    id: 4,
    port: envNum('TERMINAL_4_PORT', 7684),
    service: env('TERMINAL_4_SERVICE', 'apollo-terminal-4.service'),
    label: env('TERMINAL_4_LABEL', 'Ops'),
    // この箱（local）の OpenClaw 秘書 Masayoshi（tmux セッション 'openclaw'、openclaw chat）。
    tmuxSession: env('TERMINAL_4_TMUX', 'openclaw'),
  },
  {
    id: 5,
    port: envNum('TERMINAL_5_PORT', 7685),
    service: env('TERMINAL_5_SERVICE', 'apollo-terminal-5.service'),
    label: env('TERMINAL_5_LABEL', 'Sub'),
    // この箱（local）の OpenClaw 秘書補佐 Son（tmux 'openclaw-son'、openclaw chat --session agent:son:main）。MC-181。
    tmuxSession: env('TERMINAL_5_TMUX', 'openclaw-son'),
  },
];

/** ターミナル定義から ttyd の origin（http://host:port）を作る。host 既定は TERMINAL_TTYD_HOST。 */
export function terminalTarget(t: TerminalDef, host: string = TERMINAL_TTYD_HOST): string {
  return `http://${host}:${t.port}`;
}

/** id からターミナル定義を引く（未定義 id は undefined）。 */
export function terminalById(id: number): TerminalDef | undefined {
  return TERMINALS.find((t) => t.id === id);
}

/** マークダウンのタスクソース（複数）。存在しないものは collector 側で無視。 */
export const TASK_SOURCES = {
  logicTracker: join(PROJECTS_DIR, 'logic', 'docs', 'TASK_TRACKER.md'),
  kanban: join(VAULT_DIR, '10-Tasks', 'kanban.md'),
  today: join(VAULT_DIR, '10-Tasks', 'today.md'),
  nishimaruTracker: join(VAULT_DIR, '20-Projects', 'nishimarucho-flyer', 'TASK_TRACKER.md'),
  cxoTracker: CXO_TRACKER,
} as const;

/** ナラティブ（日次サマリ）のディレクトリ。 */
export const NARRATIVE_DIRS = {
  briefing: join(VAULT_DIR, '50-Daily', 'briefings'),
  inspection: join(VAULT_DIR, '50-Daily', 'inspections'),
  feedback: join(VAULT_DIR, '50-Daily', 'feedback'),
} as const;

/** エージェント台帳のディレクトリ（60-Agents/*.md）。 */
export const ROSTER_DIR = join(VAULT_DIR, '60-Agents');

/**
 * agent-*.jsonl の保持期間（ミリ秒）。これより古いファイルは collector が無視し、
 * 起動時クリーンアップで物理削除される。既定 7 日。env AGENT_LOG_TTL_DAYS で上書き可。
 */
export const AGENT_LOG_TTL_MS =
  envNum('AGENT_LOG_TTL_DAYS', 7) * 24 * 60 * 60 * 1000;

/**
 * collectAgents() の結果キャッシュ TTL（ミリ秒、既定 12 秒）。env AGENT_COLLECT_TTL_MS で上書き可。
 * collectAgents は ~/.claude/projects 配下の全 jsonl を同期 fs でフルスキャンするため、
 * SSE/tick で多数回呼ばれるとイベントループ（＝ターミナル proxy も捌く単一プロセス）を
 * その都度ブロックしてしまう。この TTL 内は再スキャンせずキャッシュを返し、実スキャンを
 * TTL ごとに 1 回へ減らす。collectAgentGroups / feed 等の依存関数も同キャッシュの恩恵を受ける。
 * リアルタイム性は十数秒粒度で十分（watch broadcast → frontend 再フェッチ間隔とも整合）。
 */
export const AGENT_COLLECT_TTL_MS = envNum('AGENT_COLLECT_TTL_MS', 12000);

/**
 * セッションログ走査で「内容を読む」対象の最大経過時間（ミリ秒、既定 3 日）。env AGENT_SCAN_MAX_AGE_MS で上書き可。
 * collectAgents の実コストの大半は、親セッション jsonl（数百MB規模）を Agent tool_use 索引のために
 * 同期 readFileSync + JSON.parse することにある（実測 752MB / 1545 件、mtime 無制限）。
 * 最終更新がこの閾値より古い親セッションは索引構築時に内容読み取りをスキップする。
 * 「稼働中・直近のエージェント」のラベル付けに必要な親はこの閾値内に収まるため live 表示は維持される
 * （active/idle は STALL_MINUTES=8分 / 直近で、3 日は十分な余裕）。閾値を超えて古い stale ログは
 * done/idle 表示のままラベルが unmatched: に寄るだけで、状態判定（active/idle/done/never）は壊さない。
 */
export const AGENT_SCAN_MAX_AGE_MS =
  envNum('AGENT_SCAN_MAX_AGE_DAYS', 3) * 24 * 60 * 60 * 1000;

/**
 * roster に表示するエージェント名の allowlist（MC-75）。
 * Keita 方針: Apollo の roster には「人格を持つエージェント」と「その他の主要エージェント」だけを出す。
 * cron 常駐のバックグラウンド系含め、ここに列挙したものだけ表示し、
 * 将来 60-Agents/ に非主要 md が増えても自動で隠れる（denylist だと追加し忘れて漏れるため allowlist 採用）。
 * 新規に主要エージェントを足したら、ここに名前（= md ファイル名 = subagent_type）を追記する。
 * env ROSTER_VISIBLE（カンマ区切り）で差し替え可能。空指定なら下記デフォルト。
 */
function parseRosterVisible(): Set<string> {
  const raw = process.env.ROSTER_VISIBLE;
  if (raw && raw.trim() !== '') {
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
    );
  }
  // 開発 5 体 ＋ 林（main assistant）＋ apollo（番人）＋ masayoshi（秘書兼CEO）の 8 体。
  // 削除済み: reviewer / logic-coach / night-patrol / feedback-watcher（2026-06-03 整理）
  return new Set<string>([
    'dev-logic',
    'task-manager',
    'designer',
    'content-creator',
    'test-functional',
    'hayashi-rin',
    'apollo',
    'masayoshi',
  ]);
}

export const ROSTER_VISIBLE = parseRosterVisible();

/**
 * 受信箱（Apollo 投入）から指令を委譲できる subagent のホワイトリスト（MC-86）。
 * Apollo で「このエージェントにこの指令」を投入する際、未知の agent 名で任意プロンプト
 * 実行を仕掛けられないよう、ここに列挙した既知の subagentType のみを受理する。
 * roster の表示対象（ROSTER_VISIBLE 11 体）のうち、林（hayashi-rin・main assistant）と
 * apollo（インフラ番人）は「指令の委譲先」ではないため除外し、実装/検証を担う 9 体に限定する。
 * 新規に委譲可能な subagent を足したら、ここに名前（= subagent_type）を追記する。
 * env INBOX_AGENTS（カンマ区切り）で差し替え可能。空指定なら下記デフォルト。
 */
function parseInboxAgents(): Set<string> {
  const raw = process.env.INBOX_AGENTS;
  if (raw && raw.trim() !== '') {
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
    );
  }
  return new Set<string>([
    'dev-logic',
    'task-manager',
    'designer',
    'content-creator',
    'reviewer',
    'logic-coach',
    'test-functional',
    'night-patrol',
    'feedback-watcher',
  ]);
}

/** 受信箱から指令を委譲できる subagent のホワイトリスト（MC-86）。 */
export const INBOX_AGENTS = parseInboxAgents();

/**
 * Vault ツリー / 検索で除外するディレクトリ名（セグメント完全一致）。
 * VCS・Obsidian メタ・依存・ゴミ箱を見せない。
 */
export const VAULT_EXCLUDE_DIRS = new Set<string>([
  '.git',
  '.obsidian',
  '.claude',
  '.trash',
  'node_modules',
]);

/** Vault ツリーに含めるファイル拡張子（md 中心 + 主要な画像/添付）。 */
export const VAULT_TREE_EXTS = new Set<string>([
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf',
  '.canvas',
]);

/** 全文検索の上限件数。 */
export const VAULT_SEARCH_LIMIT = envNum('VAULT_SEARCH_LIMIT', 40);

/** wikilink/タイトル索引のキャッシュ TTL（ミリ秒）。短期キャッシュで再スキャンを抑える。 */
export const VAULT_INDEX_TTL_MS = envNum('VAULT_INDEX_TTL_MS', 15000);

// ─── Vault 書き込み（Apollo からのノート作成 / ファイルアップロード）────────

/** ノート作成のデフォルト保存先フォルダ（VAULT_DIR 直下相対）。 */
export const VAULT_NOTE_DEFAULT_FOLDER = env('VAULT_NOTE_DEFAULT_FOLDER', '20-Knowledge');

/** アップロードファイルの保存先フォルダ（VAULT_DIR 直下相対）。 */
export const VAULT_ATTACHMENTS_FOLDER = env('VAULT_ATTACHMENTS_FOLDER', '99-Attachments');

/**
 * ノート作成で folder として許可する VAULT_DIR 直下のフォルダ（allowlist）。
 * 列挙外のフォルダ指定は拒否し、VAULT_DIR 配下への限定をさらに強める。
 */
export const VAULT_NOTE_ALLOWED_FOLDERS = new Set<string>([
  '00-Inbox',
  '20-Knowledge',
  '20-Projects',
  '40-Resources',
]);

/** アップロード 1 ファイルあたりの最大バイト数（25MB。PDF 等も許容）。 */
export const VAULT_UPLOAD_MAX_FILE_BYTES = envNum('VAULT_UPLOAD_MAX_FILE_BYTES', 25 * 1024 * 1024);

/** アップロードの最大ファイル数。 */
export const VAULT_UPLOAD_MAX_FILES = envNum('VAULT_UPLOAD_MAX_FILES', 10);

/** Vault git 操作で使う HOME（systemd の env に HOME が無いため明示する）。 */
export const VAULT_GIT_HOME = env('VAULT_GIT_HOME', DATA_HOME);

/** Vault git 操作で使う PATH（git / ssh を確実に解決させる）。 */
export const VAULT_GIT_PATH = env(
  'VAULT_GIT_PATH',
  '/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH ?? ''),
);

/** HTTP ポート。 */
export const PORT = envNum('PORT', 4317);

/**
 * 滞留しきい値（分）。最終活動からこの分数を超えたら idle。
 * memory「subagent は遅いだけで死んでない」に準拠し default 8 分。
 * 短く切ると進行中のエージェントを誤って idle/停止扱いしてしまうので注意。
 */
export const STALL_MINUTES = envNum('STALL_MINUTES', 8);

/** タスク滞留しきい値（日）。IN_PROGRESS のまま更新がこの日数を超えたら stalled。 */
export const TASK_STALL_DAYS = envNum('TASK_STALL_DAYS', 3);

/**
 * BLOCKED 長期滞留しきい値（日）。BLOCKED のまま更新がこの日数を超えたらアラート対象（MC-63）。
 * agent の 8 分（STALL_MINUTES）・IN_PROGRESS の 3 日（TASK_STALL_DAYS）とは別軸の「長期 BLOCKED」。
 * 短く切るとブロック直後の正常待ちを誤検知するため、日単位で余裕を持たせる（default 5 日）。
 */
export const BLOCKED_STALL_DAYS = envNum('BLOCKED_STALL_DAYS', 5);

/**
 * inbox に pending が残存して滞留とみなす時間（時間単位）。
 * agent の 8分(STALL_MINUTES)・タスク 3日(TASK_STALL_DAYS)・長期 BLOCKED 5日(BLOCKED_STALL_DAYS)
 * とは別軸の inbox 消費停止検知。Apollo 受信箱(inbox.jsonl)の未消化エントリ最古が
 * この時間を超えたら、受信箱を消費する自律ループが止まっている可能性を警告する（default 3 時間）。
 */
export const INBOX_STALL_HOURS = envNum('INBOX_STALL_HOURS', 3);

/**
 * Token 消費量集計のキャッシュ TTL（ミリ秒）。default 5 分。
 * 全 jsonl のフルスキャンは重いのでリアルタイム不要のこの集計は 5 分粒度で十分。
 * 連続要求は最後の集計結果をそのまま返し、重い再走査を 5 分に 1 回へ抑える。
 */
export const USAGE_TTL_MS = envNum('USAGE_TTL_MS', 300000);

/**
 * watch のデバウンス間隔（ミリ秒）。
 * jsonl は高頻度追記されるため、短時間の連続変更を1イベントにまとめて broadcast する。
 */
export const WATCH_DEBOUNCE_MS = envNum('WATCH_DEBOUNCE_MS', 600);

// ─── deploy 連動（MC-64）──────────────────────────────────
//
// GitHub Actions の deploy 系 workflow の run 状態を gh CLI で取得し、
// タスク詳細に「このタスクの実装が本番に出たか」を表示する。
//
// 対象 repo は logic / en-chakai に限定する（cxo-agent は Issue/deploy 用途に使わない方針
// [[feedback-no-cxo-agent]] のため deploy 連動の対象に含めない）。
// repo は projectMap の ProjectName（logic / en-chakai）に対応づけ、TaskDetail 側で
// タスクの project と突合する。

/** 1 deploy 連動対象の repo + workflow 定義。 */
export interface DeployRepoConfig {
  /** GitHub の owner/repo（gh --repo に渡す）。 */
  repo: string;
  /** projectMap の ProjectName。TaskDetail の task.project と突合する。 */
  project: 'logic' | 'en-chakai';
  /** 対象 workflow ファイル名（gh run list --workflow に渡す）。複数可。 */
  workflows: string[];
}

/**
 * deploy 連動対象 repo リスト（MC-64）。
 * logic は本番 Render(deploy-production.yml) と Android 内部配信(android-deploy.yml)、
 * en-chakai は本番 Render(deploy-production.yml) を対象にする。
 * env DEPLOY_REPOS（JSON 配列）で差し替え可能。空/不正なら下記デフォルト。
 */
function parseDeployRepos(): DeployRepoConfig[] {
  const raw = process.env.DEPLOY_REPOS;
  if (raw && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const out: DeployRepoConfig[] = [];
        for (const item of parsed) {
          if (
            item &&
            typeof item.repo === 'string' &&
            (item.project === 'logic' || item.project === 'en-chakai') &&
            Array.isArray(item.workflows) &&
            item.workflows.every((w: unknown) => typeof w === 'string')
          ) {
            out.push({ repo: item.repo, project: item.project, workflows: item.workflows });
          }
        }
        if (out.length > 0) return out;
      }
    } catch {
      // 不正な JSON はデフォルトにフォールバック。
    }
  }
  return [
    {
      repo: 'keitaurano-del/logic',
      project: 'logic',
      workflows: ['deploy-production.yml', 'android-deploy.yml'],
    },
    {
      repo: 'keitaurano-del/en-chakai',
      project: 'en-chakai',
      workflows: ['deploy-production.yml'],
    },
  ];
}

/** deploy 連動対象 repo リスト（MC-64）。 */
export const DEPLOY_REPOS: DeployRepoConfig[] = parseDeployRepos();

/** gh run list で取得する 1 workflow あたりの直近 run 件数。 */
export const DEPLOY_RUN_LIMIT = envNum('DEPLOY_RUN_LIMIT', 5);

/** gh コマンドのタイムアウト（ミリ秒）。レート/ネットワーク詰まりで Apollo を固めない。 */
export const DEPLOY_GH_TIMEOUT_MS = envNum('DEPLOY_GH_TIMEOUT_MS', 12000);

/**
 * deploy run 取得のキャッシュ TTL（ミリ秒）。default 5 分（usage.ts と同方式）。
 * GitHub API レート対策。gh を毎リクエスト叩かず 5 分に 1 回へ抑える。
 */
export const DEPLOY_TTL_MS = envNum('DEPLOY_TTL_MS', 300000);

/**
 * gh の PATH（systemd の env に PATH が無い/痩せている場合に gh を確実に解決させる）。
 * VAULT_GIT_PATH と同方式。
 */
export const DEPLOY_GH_PATH = env(
  'DEPLOY_GH_PATH',
  '/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH ?? ''),
);

// ─── autonomous ループのティック可視化（MC-65）──────────────────────
//
// 自律ループ（autonomous-worker.sh、cron */10）がスコープ別に追記する
// /home/dev/logs/autonomous-*.log を末尾読みで解析し、直近ティック
// （選んだタスク × 結果レーン）を /api/ticks で可視化する。
//
// すべて os.homedir() ベース（DATA_HOME 由来）で env override 可。
// ハードコード散在を避け、ここに集約する。

/** 自律ループ・ログのディレクトリ（既定 ~/logs）。env AUTONOMOUS_LOG_DIR で差し替え可。 */
export const AUTONOMOUS_LOG_DIR = env('AUTONOMOUS_LOG_DIR', join(DATA_HOME, 'logs'));

/**
 * ClipItNow PDCA 永続ループの状態ファイル（2026-07-19）。
 * 林の cron スクリプトが $HOME/logs/clipitnow-pdca-state.json にサイクル状態を書き、
 * Apollo は GET /api/clipitnow/pdca で read-only 参照する（Apollo は書かない）。
 * env CLIPITNOW_PDCA_STATE_FILE で差し替え可。
 */
export const CLIPITNOW_PDCA_STATE_FILE = env(
  'CLIPITNOW_PDCA_STATE_FILE',
  join(DATA_HOME, 'logs', 'clipitnow-pdca-state.json'),
);

/**
 * autonomous-*.log を拾う glob パターン（AUTONOMOUS_LOG_DIR 内、相対）。
 * 既定 'autonomous-*.log'。将来スコープ別ログが増えても自動で拾う。
 * env AUTONOMOUS_LOG_GLOB で差し替え可。
 */
export const AUTONOMOUS_LOG_GLOB = env('AUTONOMOUS_LOG_GLOB', 'autonomous-*.log');

/**
 * /api/ticks が返す直近ティックの上限件数（新しい順）。既定 50。
 * env TICKS_LIMIT で差し替え可。
 */
export const TICKS_LIMIT = envNum('TICKS_LIMIT', 50);

/**
 * 各ログファイルの末尾から読むバイト数（既定 256KB）。
 * 214KB 級ログをフル読みせず tail で済ませ、I/O とメモリを抑える。
 * env TICKS_TAIL_BYTES で差し替え可。
 */
export const TICKS_TAIL_BYTES = envNum('TICKS_TAIL_BYTES', 256 * 1024);

/**
 * ティック解析のキャッシュ TTL（ミリ秒）。既定 30 秒。
 * ログは数十秒〜分粒度の追記なのでリアルタイム不要。連続要求は再走査を抑える。
 * env TICKS_TTL_MS で差し替え可。
 */
export const TICKS_TTL_MS = envNum('TICKS_TTL_MS', 30000);

// ─── 承認フロー（MC-79）──────────────────────────────────

/**
 * 承認フロー判定の語彙 whitelist（MC-79）。
 * タスクの「区分／フェーズ」列および本文（詳細セクション）にこれらの語が現れたら、
 * Keita の承認/確認が要る項目として承認フローに集約する。曖昧語を増やすと誤検知の元なので、
 * Keita 確定（2026-05-31）の語のみを厳密に列挙する（誤検知ゼロ方針）。
 *
 *  - design   : 設計判断・仕様未確定（BLOCKED 設計判断 → 承認で TODO 化）
 *  - approval : Keita承認待ち・承認待ち（汎用の承認待ち）
 *  - deploy   : デプロイ可否・デプロイ承認（承認で deploy フラグ/note を立てて autonomous-rin/林が実行）
 *  - confirm  : 要確認（Keita 確認が要る論点）
 *
 * すべて完全一致ではなく部分一致（includes）で拾う。日本語のため単語境界は使わない。
 */
export const APPROVAL_TAG_WORDS = {
  design: ['設計判断', '仕様未確定'],
  approval: ['Keita承認待ち', '承認待ち'],
  deploy: ['デプロイ可否', 'デプロイ承認'],
  confirm: ['要確認'],
} as const;

/** 承認区分（バッジ用カテゴリ）。design/approval/deploy/confirm + blocked(BLOCKED かつ Keita 待ち)。 */
export type ApprovalKind = 'blocked' | 'design' | 'deploy' | 'approval' | 'confirm';

// ─── Claude プラン使用量（MC-122 / MC-161）──────────────────────────
//
// 各 Claude アカウントの OAuth usage/profile を取得して % とリセット時刻を表示する。
// エンドポイント（api.anthropic.com/api/oauth/usage・/profile）は頻繁に叩くと 429 を返すため、
// モジュール内メモリで強くキャッシュする（既定 180 秒）。トークンは 2 アカウントとも
// この箱のローカルファイルから毎回読む（MC-161 で旧箱 SSH 経路を廃止）:
//   local（Claude1 / keita.urano） : ~/.claude/.credentials.json（claude が自動 refresh する）
//   urano2（Claude2 / keita.urano2）: /home/dev/.claude-urano2/.credentials.json
//     （旧箱 terminal2 廃止で常駐 claude が無いため、cron keeper が refresh_token grant で
//       定期的にトークンを更新して書き戻す＝refresh-urano2-token.sh）
// 取得失敗・429 でもアカウント単位の error にして 200 で部分劣化させる。

/**
 * Claude usage/profile 取得のキャッシュ TTL（ミリ秒）。既定 180 秒。
 * usage+profile で 1 アカウントあたり 2 コール、2 アカウントで最大 4 コール。
 * 429 回避のため毎リクエスト叩かず TTL 内は前回値を返す。env CLAUDE_USAGE_TTL_MS で差し替え可。
 */
export const CLAUDE_USAGE_TTL_MS = envNum('CLAUDE_USAGE_TTL_MS', 180000);

/** OAuth API のベース URL（差し替えはテスト用途）。 */
export const CLAUDE_OAUTH_API_BASE = env('CLAUDE_OAUTH_API_BASE', 'https://api.anthropic.com');

/** OAuth API 呼び出しの HTTP タイムアウト（ミリ秒）。既定 12 秒。 */
export const CLAUDE_OAUTH_TIMEOUT_MS = envNum('CLAUDE_OAUTH_TIMEOUT_MS', 12000);

/** local アカウントの credentials ファイルパス（毎回ここから accessToken を読む）。 */
export const CLAUDE_LOCAL_CREDENTIALS = env(
  'CLAUDE_LOCAL_CREDENTIALS',
  join(DATA_HOME, '.claude', '.credentials.json'),
);

/**
 * urano2（Claude2 / keita.urano2）の credentials ファイルパス（MC-161）。
 * 旧箱 terminal2 廃止に伴い、SSH 経路をやめてこの箱のローカルファイルを毎回読む。
 * このアカウントは常駐 claude が無くトークンが自動 refresh されないため、cron keeper
 * （refresh-urano2-token.sh）が refresh_token grant で定期更新して書き戻す。
 */
export const CLAUDE_URANO2_CREDENTIALS = env(
  'CLAUDE_URANO2_CREDENTIALS',
  join(DATA_HOME, '.claude-urano2', '.credentials.json'),
);

// ─── チャット（MC-141）──────────────────────────────────────
//
// Keita・林・Masayoshi・エージェントが channel / DM でリアルタイム会話するチャット。
// ストレージは data/channels/<channel-id>/{meta.json,messages.jsonl}。
// data/ は .gitignore 済みなので channels/ もバージョン管理対象外。

/** チャンネルデータのルートディレクトリ。 */
export const CHAT_CHANNELS_DIR = env('CHAT_CHANNELS_DIR', join(INBOX_DATA_DIR, 'channels'));

/** エージェント投稿エンドポイントの認証トークン（MC_TOKEN とは別）。 */
export const AGENT_TOKEN = env('AGENT_TOKEN', '');

// ─── 成長日記（MC-233 Phase1）──────────────────────────────────
//
// 子の成長記録を日付単位（1日1エントリ）で残し、写真/動画を添付するビュー。
// ストレージはすべて data/ 配下（.gitignore 済み・ランタイムデータ）:
//   data/baby-diary-entries.jsonl  : 日記エントリ（last-wins by date・論理削除は deleted フラグ）
//   data/baby-diary-media.jsonl    : メディアメタ（append・削除は deleted フラグ）
//   data/baby-diary-media/         : メディア実体（<id>-<safe-name> でフラット保存）

/** 成長日記のデータディレクトリ（jsonl の置き場）。 */
export const BABY_DIARY_DIR = env('BABY_DIARY_DIR', INBOX_DATA_DIR);

/** 日記エントリの JSONL（last-wins by date）。 */
export const BABY_DIARY_ENTRIES_FILE = join(BABY_DIARY_DIR, 'baby-diary-entries.jsonl');

/** メディアメタの JSONL（append・論理削除）。 */
export const BABY_DIARY_MEDIA_FILE = join(BABY_DIARY_DIR, 'baby-diary-media.jsonl');

/** ぴよログ取り込みの日次レコード JSONL（last-wins by date・論理削除は deleted フラグ）。 */
export const BABY_PIYOLOG_FILE = join(BABY_DIARY_DIR, 'baby-piyolog-days.jsonl');

// ─── 育児相談チャット「すくすく」の会話履歴 ────────────────────────
// 育児チャットの会話履歴をサーバ側に蓄積する（端末をまたいで過去の質問が残る）。
// 単一の会話スレッド（個人/世帯用ダッシュボードなので分岐不要）を追記専用で保存する。
// babyDiaryStore と同じく data/ 配下（.gitignore 済み・ランタイムデータ）。
//   data/childcare-chat.jsonl : 1 行 = 1 メッセージ（role/content/ts/id、論理クリアは cleared マーカ行）

/** 育児チャット会話履歴の JSONL（追記専用・全消去は cleared マーカ）。 */
export const CHILDCARE_CHAT_FILE = env(
  'CHILDCARE_CHAT_FILE',
  join(INBOX_DATA_DIR, 'childcare-chat.jsonl'),
);

/**
 * 育児ガイド「相談メモ」の永続キャッシュ（JSON 単一ファイル）。
 * 育児チャットの Q&A をトピック別に整理したメモ＋差分処理マーカ（最後に処理した
 * assistant メッセージ id / 処理件数）を保持する。育児ガイドを開いたとき、新規相談が
 * あれば差分だけ AI 統合してここを更新し、無ければ即返す（軽量化）。
 */
export const CHILDCARE_GUIDE_NOTES_FILE = env(
  'CHILDCARE_GUIDE_NOTES_FILE',
  join(INBOX_DATA_DIR, 'childcare-guide-notes.json'),
);

// ─── 育児チャットの送信メディア（画像・動画アップロード）────────────
// チャット入力欄から添付された画像/動画を <id>-<safe-name> でフラット保存する。
// babyDiaryRouter のメディア保存作法に倣う（multer diskStorage・MIME 検証・サイズ上限）。
// data/ 配下なので .gitignore 済み・ランタイムデータ。

/** 育児チャット添付メディアの保存ディレクトリ。 */
export const CHILDCARE_CHAT_MEDIA_DIR = env(
  'CHILDCARE_CHAT_MEDIA_DIR',
  join(INBOX_DATA_DIR, 'childcare-chat-media'),
);

/**
 * 育児チャット添付の画像 1 枚あたり最大バイト数（既定 10MB）。
 * 画像は AI が読む（マルチモーダル）想定なので過大ファイルを避ける。
 */
export const CHILDCARE_CHAT_IMAGE_MAX_BYTES = envNum(
  'CHILDCARE_CHAT_IMAGE_MAX_BYTES',
  10 * 1024 * 1024,
);

/**
 * 育児チャット添付の動画 1 本あたり最大バイト数（既定 50MB）。
 * 動画は AI が内容解析しない（受領・表示のみ）。妥当な上限で受ける。
 */
export const CHILDCARE_CHAT_VIDEO_MAX_BYTES = envNum(
  'CHILDCARE_CHAT_VIDEO_MAX_BYTES',
  50 * 1024 * 1024,
);

/** 育児チャット添付の 1 リクエストあたり最大ファイル数。 */
export const CHILDCARE_CHAT_MEDIA_MAX_FILES = envNum('CHILDCARE_CHAT_MEDIA_MAX_FILES', 5);

// ─── 育児チャットのアシスタント側メディア返却（フェーズ2）──────────────
// すくすくが返す参考動画（YouTube・oEmbed 検証）/ 生成図解（Gemini）/ Web 実在画像（検証＋取込）。
// 捏造防止のため、外部 URL は必ずサーバ側で実在検証してから添付し、検証 NG は黙って落とす。

/**
 * 1 応答あたりに添付できるアシスタント側メディアの最大点数（既定 2）。
 * 乱用防止のため少数に絞る（systemPrompt でも抑制するが、ハード上限としても効かせる）。
 */
export const CHILDCARE_ASSISTANT_MEDIA_MAX = envNum('CHILDCARE_ASSISTANT_MEDIA_MAX', 2);

// ─── 茶事チャット（表千家の茶道アドバイザー）の会話履歴 ────────────────
// 茶事ページ（Chaji）の「茶事チャット」から開く、表千家の茶道アドバイザーとの相談履歴。
// 育児チャット（childcareChatStore）の作法をそのまま踏襲し、別 JSONL ファイルに蓄積する
// （端末をまたいで過去の質問が残る）。単一の会話スレッドを追記専用で保存する。
// data/ 配下（.gitignore 済み・ランタイムデータ）。画像アップロードは茶事では扱わない。
//   data/chaji-chat.jsonl : 1 行 = 1 メッセージ（role/content/ts/id、論理クリアは cleared マーカ行）

/** 茶事チャット会話履歴の JSONL（追記専用・全消去は cleared マーカ）。 */
export const CHAJI_CHAT_FILE = env(
  'CHAJI_CHAT_FILE',
  join(INBOX_DATA_DIR, 'chaji-chat.jsonl'),
);

// ─── 仕事（ECL/PMO 学習・壁打ちチャット＋ナレッジ）MC-260 ──────────────────
// 新サイドメニュー「仕事」(/work) のバックエンドデータ正本。茶事チャットの追記専用 JSONL を踏襲し、
// テキストのみの学習・壁打ちチャット履歴（work-chat.jsonl）と、ナレッジ蓄積（work-knowledge.jsonl）を
// それぞれ別 JSONL ファイルに保存する。いずれも data/ 配下（.gitignore 済み・ランタイムデータ）。

/** 仕事チャット会話履歴の JSONL（追記専用・全消去は cleared マーカ。テキストのみ）。 */
export const WORK_CHAT_FILE = env(
  'WORK_CHAT_FILE',
  join(INBOX_DATA_DIR, 'work-chat.jsonl'),
);

/** 仕事ナレッジの JSONL（追記イベント方式・create/update は last-wins、delete はトムストーン）。 */
export const WORK_KNOWLEDGE_FILE = env(
  'WORK_KNOWLEDGE_FILE',
  join(INBOX_DATA_DIR, 'work-knowledge.jsonl'),
);

// ─── 茶事チャットのユーザー添付メディア（画像/動画）──────────────────────
// 育児チャット（CHILDCARE_CHAT_MEDIA_*）の作法をそのまま踏襲し、茶事専用の別ディレクトリ・
// 別上限で受ける（childcare とディレクトリを分けて干渉させない）。data/ 配下なので .gitignore
// 済み・ランタイムデータ。画像は AI（claude）が Read して表千家の文脈でコメントできる想定、
// 動画は受領・表示のみ（内容解析はしない）。

/** 茶事チャット添付メディアの保存ディレクトリ（childcare とは別ディレクトリ）。 */
export const CHAJI_CHAT_MEDIA_DIR = env(
  'CHAJI_CHAT_MEDIA_DIR',
  join(INBOX_DATA_DIR, 'chaji-chat-media'),
);

/**
 * 茶事チャット添付の画像 1 枚あたり最大バイト数（既定 10MB）。
 * 画像は AI が読む（マルチモーダル）想定なので過大ファイルを避ける。
 */
export const CHAJI_CHAT_IMAGE_MAX_BYTES = envNum(
  'CHAJI_CHAT_IMAGE_MAX_BYTES',
  10 * 1024 * 1024,
);

/**
 * 茶事チャット添付の動画 1 本あたり最大バイト数（既定 50MB）。
 * 動画は AI が内容解析しない（受領・表示のみ）。妥当な上限で受ける。
 */
export const CHAJI_CHAT_VIDEO_MAX_BYTES = envNum(
  'CHAJI_CHAT_VIDEO_MAX_BYTES',
  50 * 1024 * 1024,
);

/** 茶事チャット添付の 1 リクエストあたり最大ファイル数。 */
export const CHAJI_CHAT_MEDIA_MAX_FILES = envNum('CHAJI_CHAT_MEDIA_MAX_FILES', 5);

/**
 * Gemini 画像生成モデル（図解生成用、通称 Nano Banana 系）。
 * generativelanguage v1beta の :generateContent で responseModalities=IMAGE を要求する。
 */
export const CHILDCARE_GEMINI_IMAGE_MODEL = env(
  'CHILDCARE_GEMINI_IMAGE_MODEL',
  'gemini-2.5-flash-image',
);

/**
 * Web 実在画像を取り込む際の 1 枚あたり最大バイト数（既定 8MB）。
 * これを超える画像は安定性・通信負荷の観点から添付しない。
 */
export const CHILDCARE_WEB_IMAGE_MAX_BYTES = envNum(
  'CHILDCARE_WEB_IMAGE_MAX_BYTES',
  8 * 1024 * 1024,
);

/**
 * Web 実在画像として取り込みを許可するホストの許可リスト（信頼できる公的・専門ソース）。
 * こども家庭庁・厚労省・成育医療センター・小児科学会・自治体（go.jp / lg.jp）等に限定する。
 * カンマ区切りの env で上書き可。サブドメイン含めて末尾一致で判定する。
 */
export const CHILDCARE_WEB_IMAGE_ALLOWED_HOSTS = env(
  'CHILDCARE_WEB_IMAGE_ALLOWED_HOSTS',
  'cfa.go.jp,mhlw.go.jp,ncchd.go.jp,jpeds.or.jp,go.jp,lg.jp',
)
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => h.length > 0);

// ─── 茶事チャットのアシスタント返却メディア（YouTube/生成画像/Web画像）──────
// 育児（CHILDCARE_*）のアシスタント側メディア後処理を茶事へ横展開する（chatMedia.ts）。
// 信頼ホストは茶道の主題に合わせる: 表千家不審菴公式・公的機関・美術館/博物館・学術機関など。
// 捏造禁止・実在検証は childcare と共通（chatMedia.ts が oEmbed / GET 検証する）。
export const CHAJI_WEB_IMAGE_ALLOWED_HOSTS = env(
  'CHAJI_WEB_IMAGE_ALLOWED_HOSTS',
  'omotesenke.jp,fushinan.jp,go.jp,lg.jp,ac.jp,nii.ac.jp,bunka.go.jp,tnm.jp,kyohaku.go.jp,emuseum.nich.go.jp',
)
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => h.length > 0);

// ─── 仕事（Work）チャットのユーザー添付メディア（画像/動画）──────────────────
// 茶事チャット（CHAJI_CHAT_MEDIA_*）の作法をそのまま踏襲し、Work 専用の別ディレクトリ・別上限で受ける。
export const WORK_CHAT_MEDIA_DIR = env('WORK_CHAT_MEDIA_DIR', join(INBOX_DATA_DIR, 'work-chat-media'));
export const WORK_CHAT_IMAGE_MAX_BYTES = envNum('WORK_CHAT_IMAGE_MAX_BYTES', 10 * 1024 * 1024);
export const WORK_CHAT_VIDEO_MAX_BYTES = envNum('WORK_CHAT_VIDEO_MAX_BYTES', 50 * 1024 * 1024);
export const WORK_CHAT_MEDIA_MAX_FILES = envNum('WORK_CHAT_MEDIA_MAX_FILES', 5);

// ─── 仕事（Work）チャットのアシスタント返却メディア（Web画像の信頼ホスト）──────
// ビジネス（ECL/IFRS9/会計/PMO/データ）の主題に合わせた信頼ソース: 会計基準設定主体・規制当局・
// 大手監査法人・学術機関・公的機関など。捏造禁止・実在検証は共通。
export const WORK_WEB_IMAGE_ALLOWED_HOSTS = env(
  'WORK_WEB_IMAGE_ALLOWED_HOSTS',
  'ifrs.org,asb-j.jp,fsa.go.jp,boj.or.jp,go.jp,lg.jp,ac.jp,nii.ac.jp,jicpa.or.jp,bis.org',
)
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => h.length > 0);

// ─── 汎用 Claude チャット（/api/claude）──────────────────────────────────
// 仕事チャット（WORK_CHAT_*）の作法をそのまま踏襲した、話題を限定しない汎用 Claude アシスタント。
// 保存先・メディアディレクトリは Work とは別物にして干渉させない（いずれも data/ 配下・.gitignore 済み）。
// バイト上限・枚数は Work と同値でミラーする。

/** 汎用 Claude チャット会話履歴の JSONL（追記専用・全消去は cleared マーカ）。 */
export const CLAUDE_CHAT_FILE = env('CLAUDE_CHAT_FILE', join(INBOX_DATA_DIR, 'claude-chat.jsonl'));

/** 汎用 Claude チャット添付メディアの保存ディレクトリ（Work とは別ディレクトリ）。 */
export const CLAUDE_CHAT_MEDIA_DIR = env(
  'CLAUDE_CHAT_MEDIA_DIR',
  join(INBOX_DATA_DIR, 'claude-chat-media'),
);
export const CLAUDE_CHAT_IMAGE_MAX_BYTES = envNum('CLAUDE_CHAT_IMAGE_MAX_BYTES', 10 * 1024 * 1024);
export const CLAUDE_CHAT_VIDEO_MAX_BYTES = envNum('CLAUDE_CHAT_VIDEO_MAX_BYTES', 50 * 1024 * 1024);
export const CLAUDE_CHAT_MEDIA_MAX_FILES = envNum('CLAUDE_CHAT_MEDIA_MAX_FILES', 5);

// ─── 汎用 Claude チャットのアシスタント返却 Web 画像の信頼ホスト ──────────────
// 汎用なので主題は限定しないが、Web 画像の取り込みは捏造・低品質回避のため信頼できる公的・学術・
// 報道・主要メディアのホストに限定する。カンマ区切り env で上書き可。サブドメイン含む末尾一致。
export const CLAUDE_WEB_IMAGE_ALLOWED_HOSTS = env(
  'CLAUDE_WEB_IMAGE_ALLOWED_HOSTS',
  'go.jp,lg.jp,ac.jp,nii.ac.jp,wikipedia.org,wikimedia.org,nasa.gov,who.int,un.org,edu',
)
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => h.length > 0);

/** メディア実体の保存ディレクトリ（<id>-<safe-name> でフラット保存）。 */
export const BABY_DIARY_MEDIA_DIR = env('BABY_DIARY_MEDIA_DIR', join(BABY_DIARY_DIR, 'baby-diary-media'));

/**
 * サムネイル（webp）キャッシュの保存ディレクトリ。
 * 原寸画像（最大 12GB 規模）をカレンダー/グリッドにそのまま流すと重いため、
 * サーバ側で 480px webp を生成して `<id>.webp` でここにキャッシュし、以後はそのまま配信する。
 * data/ 配下なので .gitignore 済み・ランタイムデータ。env BABY_DIARY_THUMB_DIR で上書き可。
 */
export const BABY_DIARY_THUMB_DIR = env('BABY_DIARY_THUMB_DIR', join(BABY_DIARY_DIR, 'baby-diary-thumbs'));

/**
 * 成長日記メディア 1 ファイルあたりの最大バイト数（既定 1GB）。
 * 動画添付を考慮して大きめ。multer diskStorage でストリーム保存するためメモリには載らない。
 * env BABY_DIARY_MEDIA_MAX_BYTES で上書き可。
 */
export const BABY_DIARY_MEDIA_MAX_BYTES = envNum(
  'BABY_DIARY_MEDIA_MAX_BYTES',
  1024 * 1024 * 1024,
);

/** 成長日記メディアの 1 リクエストあたり最大ファイル数。 */
export const BABY_DIARY_MEDIA_MAX_FILES = envNum('BABY_DIARY_MEDIA_MAX_FILES', 10);

// ─── Google 連携（成長日記 MC-233 Phase2/3）────────────────────
//
// 成長日記から Google Calendar（予定の読み書き）と Google Photos Picker（写真取り込み）を
// 使うためのサーバ側 OAuth + API 連携。マルチアカウント（keita.urano + keita.urano2 等を
// 順に接続）対応。クレデンシャル（CLIENT_ID/SECRET）が未設定でも既存機能は壊さず、
// Google 系エンドポイントは「未設定」を返す（status は200で configured:false、他は503）。
//
// トークンは data/google-tokens.jsonl（.gitignore 済み・last-wins by email）に保存し、
// access_token/refresh_token/secret はレスポンスに一切含めない（email/connectedAt/scope のみ公開）。

/** Google OAuth クライアント ID（未設定なら Google 連携は「未設定」扱い）。 */
export const GOOGLE_OAUTH_CLIENT_ID = env('GOOGLE_OAUTH_CLIENT_ID', '');

/** Google OAuth クライアントシークレット（未設定なら Google 連携は「未設定」扱い）。 */
export const GOOGLE_OAUTH_CLIENT_SECRET = env('GOOGLE_OAUTH_CLIENT_SECRET', '');

/** Google OAuth リダイレクト URI（Google Cloud Console の承認済みリダイレクトと一致させる固定値）。 */
export const GOOGLE_OAUTH_REDIRECT_URI = env(
  'GOOGLE_OAUTH_REDIRECT_URI',
  'https://apollomansion.com/api/google/oauth/callback',
);

/** Google 連携が設定済みか（client_id と secret が両方非空）。 */
export function googleConfigured(): boolean {
  return GOOGLE_OAUTH_CLIENT_ID.trim() !== '' && GOOGLE_OAUTH_CLIENT_SECRET.trim() !== '';
}

/**
 * 要求する OAuth スコープ（スペース区切り）。
 *  - openid email                                              : userinfo で email を取るため
 *  - calendar.readonly / calendar.events                       : 予定の読み込み・終日イベント作成
 *  - photospicker.mediaitems.readonly                          : Photos Picker で選択メディアを読む
 *  - drive.readonly                                            : Drive 指定フォルダの画像/動画を自動取り込み（MC-233 Drive 連携）
 *  - tasks.readonly                                            : Google Tasks（期日付きタスク）の読み込み（MC-233 Tasks 連携）
 *
 * 注意: 既存接続済みトークンは drive.readonly / tasks.readonly を含まない（再同意するまで Drive/Tasks 系 API は未許可）。
 * Drive/Tasks スコープが付与されているかは token の scope 文字列に該当スコープが含まれるかで判定する。
 */
export const GOOGLE_OAUTH_SCOPE =
  'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/photospicker.mediaitems.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/tasks.readonly https://www.googleapis.com/auth/webmasters.readonly';

/** Search Console 読取スコープ（token の scope にこれが含まれるかで GSC 連携可否を判定）。ClipItNow 集客の GSC 自動取得用（2026-07-19）。 */
export const GOOGLE_SEARCHCONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** Drive 読取スコープ（token の scope にこれが含まれるかで driveScopeGranted を判定）。 */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Tasks 読取スコープ（token の scope にこれが含まれるかで tasksScopeGranted を判定）。 */
export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';

/** Google トークン台帳（last-wins by email）。data/ 配下なので .gitignore 済み。 */
export const GOOGLE_TOKENS_FILE = join(BABY_DIARY_DIR, 'google-tokens.jsonl');

/**
 * Drive 監視フォルダ設定の台帳（last-wins by account）。data/ 配下なので .gitignore 済み。
 * 1 行 = { account, folderId, folderName, autoImport, lastImportAt? }。
 */
export const GOOGLE_DRIVE_CONFIG_FILE = join(BABY_DIARY_DIR, 'google-drive-config.jsonl');

/**
 * Drive 取り込み済みファイル ID の台帳（append・重複取り込み防止用の集合）。data/ 配下なので .gitignore 済み。
 * 1 行 = { account, driveFileId, mediaId, importedAt }。
 */
export const GOOGLE_DRIVE_IMPORTED_FILE = join(BABY_DIARY_DIR, 'google-drive-imported.jsonl');

/** Google API 呼び出しの HTTP タイムアウト（ミリ秒）。ネットワーク詰まりで Apollo を固めない。 */
export const GOOGLE_HTTP_TIMEOUT_MS = envNum('GOOGLE_HTTP_TIMEOUT_MS', 15000);

// ─── オートプランナー（MC-245 Phase2）──────────────────────────
//
// 「やること（Google Tasks）」を空き時間ブロックへ自動配置する。方針は
// 「AI で “見積り”、決定的ロジックで “配置”」（docs/MC-245-auto-scheduler-design.md）。
// LLM は所要時間/優先度/最適時間帯の見積りだけを担当し、配置はサーバ側の決定的アルゴリズムが
// 重複ゼロ・締切順守で行う。AI が使えない/失敗時はヒューリスティック見積りにフォールバックする。
// 永続データはすべて data/ 配下（.gitignore 済み・ランタイムデータ）:
//   data/planner-config.json          : プランナー設定（last-wins・部分更新マージ）
//   data/planner-task-meta.jsonl      : タスク手動上書きメタ（last-wins by account:taskId）
//   data/planner-estimate-cache.jsonl : AI 見積りキャッシュ（last-wins by hash key）

/** プランナー設定ファイル（単一 JSON・部分更新マージで last-wins 保存）。 */
export const PLANNER_CONFIG_FILE = join(INBOX_DATA_DIR, 'planner-config.json');

/** タスク手動上書きメタの JSONL（last-wins by account:taskId）。 */
export const PLANNER_TASK_META_FILE = join(INBOX_DATA_DIR, 'planner-task-meta.jsonl');

/** AI 見積りキャッシュの JSONL（last-wins by key＝account:taskId + 内容ハッシュ）。 */
export const PLANNER_ESTIMATE_CACHE_FILE = join(INBOX_DATA_DIR, 'planner-estimate-cache.jsonl');

// ─── 開発ページ AI モックアップ ──────────────────────────────────
//
// Keita が文章で「こんな画面が欲しい」と指示すると claude が単一 HTML ドキュメントを生成し、
// iframe でプレビュー・修正反復・保存できるビュー。生成は plannerEstimate.ts と同流儀で
// claude CLI を安全起動する（NULバイトガード・try/catch・タイムアウト）。
// 永続データは data/ 配下（.gitignore 済み・ランタイムデータ）:
//   data/dev-mockups.jsonl : モックアップ（last-wins by id・論理削除は deleted フラグ）

/** AI 生成 HTML モックアップの JSONL（last-wins by id）。 */
export const DEV_MOCKUPS_FILE = join(INBOX_DATA_DIR, 'dev-mockups.jsonl');

/**
 * 開発ページ生成器の主要（primary）モデル（MC-260 UI 品質強化）。
 * コード生成・修正・仕上げレビューをこのモデルで実行する。既定を Opus に引き上げ、
 * 生成物の作り込み・完成度を底上げする（従来は Sonnet 固定で見た目が安っぽかった）。
 * 利用上限に当たった場合は DEV_MOCKUP_FALLBACK_MODEL（既定 Sonnet）へ自動フォールバックする。
 * ※設計ステージ・アイデア生成・仕様書・コード学習は軽い/量産系なので従来どおり
 *   NOTEBOOK_CLAUDE_MODEL（Sonnet）のまま（Opus で回すとコスト/待ち時間に見合わない）。
 * env DEV_MOCKUP_MODEL で差し替え可。 */
export const DEV_MOCKUP_MODEL = env('DEV_MOCKUP_MODEL', 'claude-opus-4-8');

/**
 * 開発ページ生成器の利用上限フォールバックモデル（ノートブック RAG と同方針）。
 * 通常は DEV_MOCKUP_MODEL（既定 Opus）で生成するが、利用上限に当たって CLI が失敗
 * （"You've hit your ... limit · resets ..." 等）したとき、このモデル（既定 Sonnet）で再生成して
 * エラー画面に落とさない。Opus→Sonnet フォールバックで「重い/上限」時も止めない。
 * env DEV_MOCKUP_FALLBACK_MODEL で差し替え可。 */
export const DEV_MOCKUP_FALLBACK_MODEL = env(
  'DEV_MOCKUP_FALLBACK_MODEL',
  NOTEBOOK_CLAUDE_MODEL,
);

/**
 * Figma ワイヤーフレーム工程を有効にするか（MC-260・既定 false で工程スキップ）。
 * HTML がそのまま成果物のため、最終 UI を Figma で起こす必要は無い（Keita 方針 2026-07-03）。
 * false のとき runDesignFirstJob は wireframe ステージを常にスキップし「設計→コード→デザイン昇格」
 * の 1 フローで作る。true に戻せば従来の Figma 先行フローが復活する（可逆・ハード削除しない）。
 * env DEV_ENABLE_FIGMA=true で復活可。 */
export const DEV_ENABLE_FIGMA = env('DEV_ENABLE_FIGMA', 'false').toLowerCase() === 'true';

/** AI 見積りに使うモデル（haiku で安く。mood と同じ流儀。env で差し替え可）。 */
export const PLANNER_ESTIMATE_MODEL = env('PLANNER_ESTIMATE_MODEL', AGENT_MOOD_MODEL);

/** AI 見積り claude のタイムアウト（ミリ秒、既定 60s）。バッチ 1 回ぶん。 */
export const PLANNER_ESTIMATE_TIMEOUT_MS = envNum('PLANNER_ESTIMATE_TIMEOUT_MS', 60_000);

/**
 * 1 回の AI 見積りバッチで送るタスクの最大件数。
 * 多すぎるとプロンプトが膨らみ haiku の応答品質/速度が落ちるため上限を設ける。
 * 上限超過分はヒューリスティックにフォールバックする（落とさない）。
 */
export const PLANNER_ESTIMATE_MAX_TASKS = envNum('PLANNER_ESTIMATE_MAX_TASKS', 40);
