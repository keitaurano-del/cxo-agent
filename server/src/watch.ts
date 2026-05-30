// watch — chokidar でデータディレクトリを監視し、変更を SSE クライアントへ broadcast する。
//
// 設計方針:
//  - watcher はサーバ起動時に **1 つだけ** 起動する（リクエスト毎に増やさない）。
//  - 変更検知時に collector のフルスキャン（全 jsonl 再読み）はしない。
//    軽い「変更があった」イベントだけを種別付きで流し、実データの再計算は
//    frontend が該当 API を再フェッチした時に collector 側で行わせる（次回フェッチで再計算）。
//    → watch 自体を軽く保ち、過剰な再計算を avoid する。
//  - 短時間の連続変更（jsonl の高頻度追記など）はデバウンスして 1 イベントにまとめる。
//  - 壊れた symlink・権限エラーでも watcher がクラッシュしないよう、エラーは握り潰してログのみ。

import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  CLAUDE_PROJECTS_DIR,
  NARRATIVE_DIRS,
  TASK_SOURCES,
  WATCH_DEBOUNCE_MS,
} from './config.js';

/** broadcast されるイベントの種別。frontend はこれを見て該当データだけ再フェッチできる。 */
export type ChangeType = 'agents' | 'tasks' | 'narrative';

/** broadcast 関数の型（index.ts の SSE hub を注入する）。 */
export type Broadcast = (event: string, data: unknown) => void;

/**
 * 監視対象パスをどの ChangeType に振り分けるか判定する。
 * パスは絶対パスで渡される前提。判定不能なら null（broadcast しない）。
 */
function classify(path: string): ChangeType | null {
  // agents: ~/.claude/projects 配下の jsonl（subagent / 親セッション両方）
  if (path.startsWith(CLAUDE_PROJECTS_DIR) && path.endsWith('.jsonl')) {
    return 'agents';
  }
  // narrative: 50-Daily/briefings|inspections|feedback 配下の md
  for (const dir of Object.values(NARRATIVE_DIRS)) {
    if (path.startsWith(dir)) return 'narrative';
  }
  // tasks: 監視対象の各台帳 md（完全一致）
  for (const src of Object.values(TASK_SOURCES)) {
    if (path === src) return 'tasks';
  }
  return null;
}

/**
 * chokidar に渡す監視ターゲット。
 * - jsonl は ~/.claude/projects 配下を再帰監視（個別ファイル列挙だと 101 本＋増減に追従できない）。
 * - 台帳 md は親ディレクトリを監視し、classify で対象ファイルだけ拾う
 *   （ファイル単体を watch するより rename/再作成に強い）。
 * - narrative は 3 ディレクトリを監視。
 * 存在しないパスは渡さない（chokidar の error を減らす）。
 */
function buildWatchTargets(): string[] {
  const targets = new Set<string>();

  if (existsSync(CLAUDE_PROJECTS_DIR)) targets.add(CLAUDE_PROJECTS_DIR);

  for (const dir of Object.values(NARRATIVE_DIRS)) {
    if (existsSync(dir)) targets.add(dir);
  }

  // 台帳は親ディレクトリ単位で監視（存在する分だけ）。
  for (const src of Object.values(TASK_SOURCES)) {
    const dir = dirname(src);
    if (existsSync(dir)) targets.add(dir);
  }

  return [...targets];
}

/**
 * chokidar の ignored 判定。
 * - node_modules / .git は無視。
 * - ~/.claude/projects 配下は jsonl のみ対象（その他ファイルは無視して負荷を下げる）。
 *   ※ディレクトリは false（無視しない）にして再帰を維持する。
 */
function makeIgnored() {
  return (path: string, stats?: { isDirectory(): boolean }): boolean => {
    if (path.includes('/node_modules/') || path.includes('/.git/')) return true;
    // stats が来るのはファイル/ディレクトリ確定時。ディレクトリは常に通す（再帰のため）。
    if (stats && stats.isDirectory()) return false;
    // ~/.claude/projects 配下は jsonl 以外を無視。
    if (path.startsWith(CLAUDE_PROJECTS_DIR) && !path.endsWith('.jsonl')) {
      // stats 不明（初回パス文字列のみ）の段階ではディレクトリの可能性があるので、
      // 拡張子なし（≒ディレクトリ）は通す。jsonl 以外の明確なファイルだけ弾く。
      if (/\.[a-zA-Z0-9]+$/.test(path)) return true;
    }
    return false;
  };
}

let watcher: FSWatcher | null = null;
const pending = new Set<ChangeType>();
let debounceTimer: NodeJS.Timeout | null = null;

/**
 * watcher を起動して broadcast に接続する。
 * @param broadcast index.ts の SSE broadcast（event 名 + data を全クライアントへ送る）
 * @returns watcher を閉じる関数（プロセス終了時に呼ぶ）
 */
export function startWatch(broadcast: Broadcast): () => Promise<void> {
  if (watcher) {
    // 二重起動防止（万一複数回呼ばれても 1 つだけ）。
    return stopWatch;
  }

  const targets = buildWatchTargets();
  if (targets.length === 0) {
    console.warn('[watch] 監視対象パスが 1 つも存在しません。watcher は起動しません。');
    return async () => {};
  }

  watcher = chokidarWatch(targets, {
    ignoreInitial: true, // 起動時の既存ファイル列挙イベントは無視（初回フルスキャン回避）
    followSymlinks: false, // 壊れた symlink でクラッシュしないよう辿らない
    persistent: true,
    ignorePermissionErrors: true,
    usePolling: false, // ネイティブ watch（負荷軽減）
    depth: 12, // 深すぎる再帰を抑制（projects/<slug>/subagents/workflows/wf_*/ 程度をカバー）
    ignored: makeIgnored(),
    awaitWriteFinish: {
      // 追記中ファイルの途中状態でイベントを撃たない。
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  const onFsEvent = (path: string) => {
    const type = classify(path);
    if (!type) return;
    pending.add(type);
    scheduleFlush(broadcast);
  };

  watcher
    .on('add', onFsEvent)
    .on('change', onFsEvent)
    .on('unlink', onFsEvent)
    .on('error', (err: unknown) => {
      // 壊れた symlink / 権限 / inotify 上限などはここに来る。落とさずログのみ。
      console.warn('[watch] watcher error (無視して継続):', (err as Error)?.message ?? err);
    });

  console.log(`[watch] 監視開始 (${targets.length} targets, debounce ${WATCH_DEBOUNCE_MS}ms)`);
  for (const t of targets) console.log(`        - ${t}`);

  return stopWatch;
}

/** デバウンスして pending をまとめて 1 イベントに flush。 */
function scheduleFlush(broadcast: Broadcast): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (pending.size === 0) return;
    const types = [...pending];
    pending.clear();
    const ts = Date.now();
    // frontend は data.types を見て該当データだけ再フェッチできる。
    // 種別を区別しない汎用再フェッチ実装でも、event:update が届けば動く。
    broadcast('update', { types, ts });
  }, WATCH_DEBOUNCE_MS);
}

/** watcher を閉じる（プロセス終了時）。 */
export async function stopWatch(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pending.clear();
  if (watcher) {
    const w = watcher;
    watcher = null;
    try {
      await w.close();
    } catch {
      // close 失敗は致命ではない。
    }
  }
}
