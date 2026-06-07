// timeline collector
//
// タスク詳細の活動履歴タイムラインを生成する。
// - TASK_TRACKER.md の note フィールド（「更新日」など）をパースして時系列イベントを抽出
// - git log で当該 MC-ID / task ID を grep して commit を時系列に集約
// - イベント種別: ステータス変更、担当変更、コミット言及、注記など

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { TASK_SOURCES } from '../config.js';

export interface TimelineEvent {
  timestamp: string; // ISO 8601
  type: 'status' | 'owner' | 'commit' | 'note' | 'other';
  message: string;
  author?: string;
  link?: string; // git commit SHA etc
}

export interface TimelineResponse {
  taskId: string;
  events: TimelineEvent[];
  generatedAt: string;
}

/**
 * TASK_TRACKER.md から task ID を含むセクションを探し出し、
 * 「更新日」「ステータス」「担当」などの行を解析して TimelineEvent を生成する。
 */
function parseTaskTrackerEvents(content: string, taskId: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // セクション見出し `### <ID> —` のパターン
  const sectionRegex = new RegExp(
    `### ${taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} [—\\-]`,
    'i'
  );
  const sectionStart = content.search(sectionRegex);
  if (sectionStart < 0) return events;

  // セクション終了（次の ### または末尾）を見つける
  const afterSection = content.substring(sectionStart + 20);
  const nextSection = afterSection.search(/^### /m);
  const sectionEnd =
    nextSection >= 0 ? sectionStart + 20 + nextSection : content.length;
  const section = content.substring(sectionStart, sectionEnd);

  // 縦型カード形式（`| 項目 | 値 |`）をパース
  const lines = section.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];

    // ステータス行: `| ステータス | <value> |`
    const statusMatch = line.match(/\|\s*ステータス\s*\|\s*([^\|]+)\s*\|/i);
    if (statusMatch) {
      const value = statusMatch[1].trim();
      // status 行は通常 `DONE` / `IN_PROGRESS（理由）` のような形式
      // 括弧内を削除して素のステータスを抽出
      const status = value.split(/[（(]/)[0].trim();
      if (status) {
        events.push({
          timestamp: new Date().toISOString(), // 更新日が無い時は現在時刻（後で修正可）
          type: 'status',
          message: `ステータス: ${status}`,
          author: '台帳',
        });
      }
    }

    // 担当行: `| 担当 | <value> |`
    const ownerMatch = line.match(/\|\s*担当\s*\|\s*([^\|]+)\s*\|/i);
    if (ownerMatch) {
      const owner = ownerMatch[1].trim();
      events.push({
        timestamp: new Date().toISOString(),
        type: 'owner',
        message: `担当: ${owner}`,
        author: '台帳',
      });
    }

    // 更新日行: `| 更新日 | <date> |` または `更新日 | <date>` など
    const updatedMatch = line.match(
      /更新日\s*[\|：]\s*([0-9]{4})-([0-9]{2})-([0-9]{2})/i
    );
    if (updatedMatch) {
      const isoDate = `${updatedMatch[1]}-${updatedMatch[2]}-${updatedMatch[3]}T00:00:00Z`;
      // 最後の events の timestamp を更新（最新の更新日を反映させる）
      if (events.length > 0) {
        events[events.length - 1].timestamp = isoDate;
      }
    }

    // 注記行（括弧内、複数行対応）
    if (line.includes('（') || line.includes('(')) {
      const noteMatch = line.match(/[（(]([^）)]+)[）)]/);
      if (noteMatch && noteMatch[1].length > 5) {
        events.push({
          timestamp: new Date().toISOString(),
          type: 'note',
          message: noteMatch[1],
          author: '台帳',
        });
      }
    }
  }

  return events;
}

/**
 * git log で taskId を含むコミットを検索し、TimelineEvent に変換。
 * `git log --all --grep=<taskId> --format=%h %ai %an %s` でデータを取得。
 */
function parseGitEvents(taskId: string, cwd: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // taskId を含むコミットを検索（grep は大文字小文字区別なし）
  try {
    const output = execSync(
      `git log --all --grep="${taskId}" --format='%h|%ai|%an|%s'`,
      { cwd, encoding: 'utf-8' }
    );
    const commits = output
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    for (const commit of commits) {
      const [sha, datetime, author, subject] = commit.split('|');
      if (!sha) continue;

      // datetime は `2026-06-07 10:30:45 +0900` 形式 → ISO 8601 に変換
      const isoDate = new Date(datetime).toISOString();

      events.push({
        timestamp: isoDate,
        type: 'commit',
        message: subject,
        author: author || 'unknown',
        link: sha,
      });
    }
  } catch {
    // git コマンドが失敗したら（リポでない等）スキップ
  }

  return events;
}

/**
 * タスク ID のタイムラインを生成する。
 * TASK_TRACKER.md とその他台帳から note/更新日をパース、
 * git log で同 ID mention を検索し、時系列にソート。
 *
 * @param taskId 例: 'MC-163'
 * @param cwd git リポジトリのルート（通常は projects ディレクトリ）
 */
export async function collectTimeline(
  taskId: string,
  cwd: string = process.cwd()
): Promise<TimelineResponse> {
  const allEvents: TimelineEvent[] = [];

  // 各 TASK_SOURCES を走査（設定で指定された台帳パス）
  for (const trackerPath of Object.values(TASK_SOURCES)) {

    if (!existsSync(trackerPath)) continue;

    try {
      const content = readFileSync(trackerPath, 'utf-8');
      const trackerEvents = parseTaskTrackerEvents(content, taskId);
      allEvents.push(...trackerEvents);
    } catch (e) {
      // ファイル読み込み失敗時はスキップ
      console.warn(`Failed to read ${trackerPath}:`, e);
    }
  }

  // git log から commit イベントを取得
  const gitEvents = parseGitEvents(taskId, cwd);
  allEvents.push(...gitEvents);

  // 時系列でソート（降順＝最新が先）
  allEvents.sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return {
    taskId,
    events: allEvents,
    generatedAt: new Date().toISOString(),
  };
}
