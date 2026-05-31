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

/** 添付画像の 1 枚あたり最大バイト数（10MB）。 */
export const INBOX_MAX_FILE_BYTES = envNum('INBOX_MAX_FILE_BYTES', 10 * 1024 * 1024);

/** 添付画像の最大枚数。 */
export const INBOX_MAX_FILES = envNum('INBOX_MAX_FILES', 5);

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
