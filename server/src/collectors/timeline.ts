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
 * 表行をパース（テーブル形式）及びセクション内の key: value 形式をパースして TimelineEvent を生成する。
 *
 * 【修正内容】
 * - テーブル行を正しくパース：ヘッダ行でカラム番号を特定→対象行からステータス・担当を正確に抽出
 * - セクション形式（`### ID — タイトル` 下の `- ステータス: value`）にも対応
 * - ステータス・担当が重複して格納される問題を解決
 * - timestamp（更新日）を各イベント単位で正しく管理
 */
function parseTaskTrackerEvents(content: string, taskId: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // 【テーブル形式のパース】
  // 表行の探索：`| ID | タイトル | ... | ステータス | ... |` 形式
  const tableHeaderMatch = content.match(
    /\|\s*ID\s*\|.*?\n\|-+\|(?:[^\n|-]+-\|)*\n/m
  );
  if (tableHeaderMatch) {
    // ヘッダ行を取得
    const headerLine = tableHeaderMatch[0].split('\n')[0];
    // `|` で分割してカラムを特定
    const headers = headerLine
      .split('|')
      .slice(1, -1)
      .map((h) => h.trim());

    // ステータス・担当のカラムインデックスを取得
    const statusColIndex = headers.findIndex((h) =>
      /^ステータス/.test(h)
    );
    const ownerColIndex = headers.findIndex((h) => /^担当/.test(h));
    const priorityColIndex = headers.findIndex((h) => /^優先度/.test(h));

    // taskId を含む表行を探す
    const tableStart = content.indexOf(tableHeaderMatch[0]) + tableHeaderMatch[0].length;
    const nextSection = content.indexOf('\n---', tableStart);
    const tableSection = nextSection > 0 ? content.substring(tableStart, nextSection) : content.substring(tableStart);

    const tableLines = tableSection.split('\n').filter((line) => line.startsWith('|'));
    for (const line of tableLines) {
      const cols = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());

      // 最初のカラム（ID）を確認
      if (cols[0]?.toUpperCase() === taskId.toUpperCase()) {
        // ステータスカラムを抽出
        if (statusColIndex >= 0 && cols[statusColIndex]) {
          const statusValue = cols[statusColIndex];
          // 括弧内は DONE/REVIEW状態の詳細（例：`DONE（test-functional 実効性検証○`）
          const status = statusValue.split(/[（(]/)[0].trim();
          if (status) {
            events.push({
              timestamp: new Date().toISOString(),
              type: 'status',
              message: status, // 「ステータス: 」プレフィックスは不要（本体が値そのもの）
              author: '台帳表行',
            });
          }
        }

        // 担当カラムを抽出
        if (ownerColIndex >= 0 && cols[ownerColIndex]) {
          const ownerValue = cols[ownerColIndex];
          // 複数エージェント記載の場合も確認（`dev-logic + test-functional` など）
          if (ownerValue && ownerValue !== ',' && ownerValue.trim().length > 0) {
            events.push({
              timestamp: new Date().toISOString(),
              type: 'owner',
              message: ownerValue.trim(),
              author: '台帳表行',
            });
          }
        }

        // 優先度も取得（ボーナス）
        if (priorityColIndex >= 0 && cols[priorityColIndex]) {
          const priority = cols[priorityColIndex].trim();
          if (priority && priority !== 'P0' && priority !== 'P1') {
            // P0/P1以外なら補足情報として note に
            events.push({
              timestamp: new Date().toISOString(),
              type: 'note',
              message: `優先度: ${priority}`,
              author: '台帳表行',
            });
          }
        }
      }
    }
  }

  // 【セクション形式のパース】
  // セクション見出し `### <ID> —` のパターン
  const sectionRegex = new RegExp(
    `### ${taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} [—\\-]`,
    'i'
  );
  const sectionStart = content.search(sectionRegex);
  if (sectionStart >= 0) {
    // セクション終了（次の ### または末尾）を見つける
    const afterSection = content.substring(sectionStart + 20);
    const nextSection = afterSection.search(/^### /m);
    const sectionEnd =
      nextSection >= 0 ? sectionStart + 20 + nextSection : content.length;
    const section = content.substring(sectionStart, sectionEnd);

    // セクション内の `- キー: 値` 形式をパース
    const lines = section.split('\n');
    let currentDate: string | null = null;

    for (const line of lines) {
      // `- ステータス: <value>` の形式
      const statusMatch = line.match(/^\s*-\s*ステータス\s*:\s*(.+)$/i);
      if (statusMatch) {
        const statusValue = statusMatch[1].trim();
        const status = statusValue.split(/[（(]/)[0].trim();
        if (status) {
          const event: TimelineEvent = {
            timestamp: currentDate || new Date().toISOString(),
            type: 'status',
            message: status,
            author: '台帳セクション',
          };
          // 表行で既に取得していないかチェック（重複排除）
          if (!events.some((e) => e.type === 'status' && e.message === status)) {
            events.push(event);
          }
        }
      }

      // `- 担当: <value>` の形式
      const ownerMatch = line.match(/^\s*-\s*担当\s*:\s*(.+)$/i);
      if (ownerMatch) {
        const ownerValue = ownerMatch[1].trim();
        if (ownerValue && ownerValue !== ',' && ownerValue.length > 0) {
          const event: TimelineEvent = {
            timestamp: currentDate || new Date().toISOString(),
            type: 'owner',
            message: ownerValue,
            author: '台帳セクション',
          };
          // 表行で既に取得していないかチェック（重複排除）
          if (!events.some((e) => e.type === 'owner' && e.message === ownerValue)) {
            events.push(event);
          }
        }
      }

      // `- 更新日: <date>` の形式
      const updatedMatch = line.match(
        /^\s*-\s*更新日\s*:\s*([0-9]{4})-([0-9]{2})-([0-9]{2})/i
      );
      if (updatedMatch) {
        currentDate = `${updatedMatch[1]}-${updatedMatch[2]}-${updatedMatch[3]}T00:00:00Z`;
        // 最後のイベントに currentDate を適用
        if (events.length > 0) {
          events[events.length - 1].timestamp = currentDate;
        }
      }

      // `- note: <text>` または `- 注記: <text>` など
      const noteMatch = line.match(
        /^\s*-\s*(?:note|注記)\s*:\s*(.+)$/i
      );
      if (noteMatch) {
        const noteValue = noteMatch[1].trim();
        if (noteValue.length > 0) {
          events.push({
            timestamp: currentDate || new Date().toISOString(),
            type: 'note',
            message: noteValue,
            author: '台帳セクション',
          });
        }
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
