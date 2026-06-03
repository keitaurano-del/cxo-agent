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

/** 成果物アップロード（MC-118）1 リクエストあたりの最大ファイル数。 */
export const DELIVERABLE_UPLOAD_MAX_FILES = envNum('DELIVERABLE_UPLOAD_MAX_FILES', 20);

/**
 * 成果物プレビュー用の変換キャッシュ（Office→PDF）の置き場。
 * data/ 配下なので .gitignore 済み。ソースの sha1+mtime+size をキーに PDF を保存する。
 */
export const DELIVERABLES_CACHE_DIR = env(
  'DELIVERABLES_CACHE_DIR',
  join(INBOX_DATA_DIR, '.deliverables-cache'),
);

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

/** ターミナルアップロード 1 枚あたりの最大バイト数（10MB。inbox と揃える）。 */
export const TERMINAL_UPLOAD_MAX_FILE_BYTES = envNum(
  'TERMINAL_UPLOAD_MAX_FILE_BYTES',
  10 * 1024 * 1024,
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

export interface TerminalDef {
  /** ターミナル番号（1 始まり）。1 はベースパス /terminal、2 以降は /terminal/<id>。 */
  id: number;
  /** 振り分け先 ttyd のローカルポート。 */
  port: number;
  /** 復旧（restart / status）対象の systemd ユニット名。 */
  service: string;
  /** UI のタブに表示するラベル（中立的な丁寧体・絵文字なし）。 */
  label: string;
}

/** 3ターミナルの定義（env で個別上書き可、最低限はハードコード既定で動く）。 */
export const TERMINALS: TerminalDef[] = [
  {
    id: 1,
    port: envNum('TERMINAL_1_PORT', 7681),
    service: env('TERMINAL_1_SERVICE', 'apollo-terminal.service'),
    label: env('TERMINAL_1_LABEL', 'ターミナル1'),
  },
  {
    id: 2,
    port: envNum('TERMINAL_2_PORT', 7682),
    service: env('TERMINAL_2_SERVICE', 'apollo-terminal-2.service'),
    label: env('TERMINAL_2_LABEL', 'ターミナル2'),
  },
  {
    id: 3,
    port: envNum('TERMINAL_3_PORT', 7683),
    service: env('TERMINAL_3_SERVICE', 'apollo-terminal-3.service'),
    label: env('TERMINAL_3_LABEL', 'ターミナル3'),
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
  // 人格保有 9 体 ＋ 林（main assistant）＋ apollo（番人）の現 11 体。
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
    'hayashi-rin',
    'apollo',
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
