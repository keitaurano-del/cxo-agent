// tasks collector
//
// 複数の markdown 台帳をパースして正規化タスク配列に統合する。
//   - logic/docs/TASK_TRACKER.md : `| ID | タイトル | 優先度 | 区分 | 担当 |` テーブル + 本文ステータス語
//   - obsidian 10-Tasks/kanban.md : `## 🔥 Now / 📋 Next / ✅ Done` 配下のチェックボックス + owner:/priority:/status:
//   - obsidian 10-Tasks/today.md  : Top 3 のチェックボックス
//   - nishimarucho-flyer/TASK_TRACKER.md : 同様のテーブル/チェックボックス

import { readFileSync, existsSync, statSync } from 'node:fs';
import {
  TASK_SOURCES,
  TASK_STALL_DAYS,
  APPROVAL_TAG_WORDS,
  type ApprovalKind,
} from '../config.js';
import { projectFromPath, type ProjectName } from '../lib/projectMap.js';

export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'REVIEW'
  | 'DONE'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  owner?: string;
  priority?: string;
  project: ProjectName;
  source: string; // どの台帳由来か
  updated?: string; // ISO 日付（取れれば）
  stalled: boolean;
  /**
   * 担当に「Keita」を含む（owner に Keita が入っている）か（MC-79 承認フロー判定の素材）。
   * 既存 UI には影響しない追加フィールド（非破壊）。
   */
  needsKeita?: boolean;
  /**
   * 承認フロー（MC-79）の区分タグ。区分/フェーズ列・本文の whitelist 語マッチで付く。
   * 例: 'design'（設計判断/仕様未確定）, 'deploy'（デプロイ可否/承認）, 'approval'（承認待ち）, 'confirm'（要確認）。
   * 該当なしなら空配列。承認フローの集約・誤検知ゼロ判定にのみ使う追加フィールド（非破壊）。
   */
  approvalTags?: ApprovalKind[];
  /**
   * タスクの説明本文（MC-83）。台帳の「詳細」フィールド／受け入れ条件／サブタスク／次アクション、
   * もしくは `### <ID>` セクション本文を整形した read-only テキスト。
   * TaskDetail の「詳細メモ」表示にのみ使う追加フィールド（既存 UI 非影響）。取れなければ未設定。
   */
  detail?: string;
}

/**
 * 台帳由来の説明テキストを表示用に整形する（MC-83）。
 * - `<br>` / `<br/>` を改行に変換（縦型カードの詳細フィールドで使われる）
 * - markdown の太字記号（**）とインラインコードのバッククォートを除去
 * - 連続空白・行頭の余分なスペースを詰める。空なら undefined。
 */
function cleanDetailText(raw?: string): string | undefined {
  if (!raw) return undefined;
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

/**
 * 縦型カード（`| フィールド | 値 |`）の説明系フィールドを 1 本の詳細テキストに束ねる（MC-83）。
 * 「詳細」を主、続けて受け入れ条件・サブタスク・次アクションを見出し付きで連結する。
 */
function buildCardDetail(c: Record<string, string>): string | undefined {
  const parts: string[] = [];
  // label と、その値を探すキー候補（表記ゆれ吸収）。最初に見つかった非空値を採用。
  const push = (label: string, ...keys: string[]) => {
    for (const key of keys) {
      const v = cleanDetailText(c[key]);
      if (v) {
        parts.push(label ? `${label}\n${v}` : v);
        return;
      }
    }
  };
  push('', '詳細', 'description', '説明');
  push('受け入れ条件', '受け入れ条件（DoD）', '受け入れ条件', 'DoD');
  push('サブタスク', 'サブタスク');
  push('次アクション', '次アクション');
  const joined = parts.join('\n\n').trim();
  return joined || undefined;
}

/**
 * `### <ID>` セクション本文を表示用テキストにする（MC-83、横テーブル形式タスク向け）。
 * 見出し行を落とし、`- ステータス:` / `- 担当:` 等のメタ行はそのまま残して整形する。
 * セクションが取れない／実質空なら undefined。
 */
function buildSectionDetail(sectionText?: string): string | undefined {
  if (!sectionText) return undefined;
  const body = sectionText.replace(/^\s*###?[^\n]*\n/, '');
  return cleanDetailText(body);
}

/**
 * owner に「Keita」を含むか（表記ゆれ吸収: Keita / keita）。
 * 「dev-logic + Keita」「Keita 待ち」等の複合 owner でも拾う。
 */
function ownerHasKeita(owner?: string): boolean {
  if (!owner) return false;
  return /keita/i.test(owner);
}

/**
 * 区分/フェーズ列の値・本文テキストから承認区分タグ（whitelist 語マッチ）を抽出する。
 * 完全一致ではなく includes。誤検知ゼロのため Keita 確定語のみ（config の APPROVAL_TAG_WORDS）。
 */
function extractApprovalTags(texts: (string | undefined)[]): ApprovalKind[] {
  const hay = texts.filter((t): t is string => !!t).join('\n');
  if (!hay) return [];
  const tags: ApprovalKind[] = [];
  (Object.keys(APPROVAL_TAG_WORDS) as (keyof typeof APPROVAL_TAG_WORDS)[]).forEach((kind) => {
    const words = APPROVAL_TAG_WORDS[kind];
    if (words.some((w) => hay.includes(w))) tags.push(kind);
  });
  return tags;
}

const STATUS_WORDS: TaskStatus[] = [
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'CANCELLED',
  'DONE',
  'TODO',
];

/**
 * status セル文字列の「先頭ステータストークン」を取り出して正規化する。
 *
 * 旧実装は `raw.toUpperCase()` 全体を STATUS_WORDS 順に includes 走査していたため、
 * `DONE（…承認1タップ→TODO/却下→CANCELLED…）` のように注記（全角/半角カッコ・コロン・
 * 改行以降）に他ステータス語が混ざると、STATUS_WORDS で先に並ぶ語（CANCELLED/REVIEW 等）を
 * 誤って拾い、実態 DONE のタスクを CANCELLED と誤読していた（MC-81 / 実例 MC-79・MC-76）。
 *
 * 本関数はセル先頭から「最初の英単語の連なり（スペース/アンダースコア/ハイフン区切り）」を
 * 1 トークンとして切り出す。全角カッコ（）・半角カッコ ()・コロン（: ：）・スペース・改行・
 * その他の非英字に当たった時点でトークンは終わる。
 *   - 「DONE（…REVIEW…CANCELLED…）」→ 先頭トークン "DONE" → DONE
 *   - 「REVIEW（実装○）」→ "REVIEW" → REVIEW
 *   - 「IN_PROGRESS」/「IN PROGRESS」→ "IN_PROGRESS" → IN_PROGRESS
 * 先頭が日本語等で英字トークンが取れない場合は undefined を返し、呼び出し側で
 * 従来の日本語キーワード fallback に委ねる。
 */
function leadingStatusToken(raw: string): TaskStatus | undefined {
  // 先頭の空白を除いた後、英字（A-Za-z）で始まる連なりだけを1トークンとして取る。
  // 区切りはスペース/アンダースコア/ハイフン。全角カッコ・コロン等の非英字で停止する。
  const m = raw.replace(/^[\s　]+/, '').match(/^[A-Za-z]+(?:[ _-][A-Za-z]+)*/);
  if (!m) return undefined;
  const tok = m[0].toUpperCase().replace(/[\s-]/g, '_');
  // 正準ステータス語に完全一致したものだけ採用（部分一致はしない＝注記混入を弾く）。
  return (STATUS_WORDS as string[]).includes(tok) ? (tok as TaskStatus) : undefined;
}

/**
 * ステータスの「確定度」ランク。重複 ID が複数形式（summary table / `### ID` セクション /
 * `| フィールド | 値 |` カード）で出たとき、確定方向（DONE/CANCELLED）にしか上書きしないための順序。
 * 同一 ID で表行が DONE なのにセクション本文が古い REVIEW/TODO のままという食い違いがあるため、
 * 表行を一次値にしつつ、セクション値は「確定方向に進める」ときだけ採用する。
 */
const STATUS_RANK: Record<TaskStatus, number> = {
  UNKNOWN: 0,
  TODO: 1,
  IN_PROGRESS: 2,
  BLOCKED: 2,
  REVIEW: 3,
  DONE: 4,
  CANCELLED: 4,
};

/**
 * 現状ステータス cur に候補 cand をマージする。
 * - cur が UNKNOWN なら無条件で cand を採用（情報ゼロからの初期化）。
 * - それ以外は cand のランクが cur 以上のときだけ採用（確定方向にのみ動かす）。
 *   これで「表行 DONE をセクションの古い REVIEW で巻き戻す」事故を防ぐ。
 */
function mergeStatus(cur: TaskStatus, cand: TaskStatus): TaskStatus {
  if (cand === 'UNKNOWN') return cur;
  if (cur === 'UNKNOWN') return cand;
  return STATUS_RANK[cand] >= STATUS_RANK[cur] ? cand : cur;
}

/**
 * status セル文字列をステータス enum に正規化する。テスト・他 collector から再利用するため export。
 */
export function normStatus(raw?: string | null): TaskStatus {
  if (!raw) return 'UNKNOWN';

  // 1) セル先頭のステータストークンを最優先で見る（注記に混ざった他ステータス語を無視）。
  //    これが MC-81 の本丸: `DONE（…承認1タップ→TODO/却下→CANCELLED…）` から先頭 DONE を取る。
  //    先頭が正準ステータス語のときだけ確定する。先頭トークンが取れない/ステータス語でない
  //    （記号始まり・日本語始まりの長文セル等）場合は、以降の従来 fallback に委ねる。
  const lead = leadingStatusToken(raw);
  if (lead) return lead;

  // 2) 以降は旧実装と同一の挙動（英語 includes → 日本語キーワードの順序）を維持する。
  //    先頭トークンで確定できなかった異常表記のみここに来るため、旧来のステータス表示を
  //    回帰させないことを最優先する（MC-81 は「先頭トークン解決」を足すだけで、注記混入の
  //    無い従来セルの読み取り結果は一切変えない方針）。
  const u = raw.toUpperCase().replace(/[\s-]/g, '_');
  for (const s of STATUS_WORDS) {
    if (u.includes(s)) return s;
  }
  if (u.includes('進行')) return 'IN_PROGRESS';
  if (u.includes('完了') || u.includes('済')) return 'DONE';
  if (u.includes('ブロック')) return 'BLOCKED';
  if (u.includes('レビュー')) return 'REVIEW';
  return 'UNKNOWN';
}

function fileMtimeIso(path: string): string | undefined {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/** frontmatter から updated: を拾う。 */
function frontmatterUpdated(md: string): string | undefined {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return undefined;
  const m = fm[1].match(/updated:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return m ? `${m[1]}T00:00:00.000Z` : undefined;
}

function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

function markStalled(t: Omit<Task, 'stalled'>): Task {
  const stalled =
    t.status === 'IN_PROGRESS' && daysSince(t.updated) > TASK_STALL_DAYS;
  return { ...t, stalled };
}

// ─── logic / nishimaru TASK_TRACKER（テーブル形式）─────────────────

function parseTrackerTable(path: string, project: ProjectName, source: string): Task[] {
  if (!existsSync(path)) return [];
  const md = readFileSync(path, 'utf-8');
  const updated = frontmatterUpdated(md) ?? fileMtimeIso(path);
  return parseTrackerString(md, project, source, updated);
}

/**
 * TASK_TRACKER markdown 文字列をパースして Task 配列を返す（ファイル I/O 非依存）。
 * テスト・書き戻しの read-back 検証から「文字列を直接」渡せるよう切り出した内部 API。
 * 列構成 / セクション / `| フィールド | 値 |` カードの 3 形式併存に対応する。
 * @param updated frontmatter / mtime 由来の更新日時。collectTasks 経由では従来どおり付与する。
 */
export function parseTrackerString(
  md: string,
  project: ProjectName,
  source: string,
  updated?: string,
): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>();

  // テーブルは台帳ごとに列構成が違う:
  //   logic: | ID | タイトル | 優先度 | 区分 | 担当 |
  //   cxo:   | ID | タイトル | 優先度 | フェーズ | ステータス | 担当 | 依存 |
  // ヘッダ行から列名→index を引いて layout 非依存に拾う（無ければ位置フォールバック）。
  const lines = md.split('\n');
  let col: { priority?: number; owner?: number; status?: number } | null = null;
  // 直前に確定した表が「タスクの正準サマリ表」か「非タスク表（別表）」か。
  // ID 列見出しが `ID` の表だけをタスク表とみなす。`| タスク | 旧状態 | 新状態 | 反映内容 |`
  // のような「判断反映サマリ」等の別表（ID 見出しが `ID` でない／status 列を持たない）は
  // 非タスク表として行を一切 task 化しない。これで MC-88/MC-89 の「別表の旧/新状態列を
  // status ソースに誤採用してフラッピングする」経路を、表の出現順に依存せず決定的に塞ぐ。
  // （旧実装は seen 先勝ちで別表をスキップしていたが、正準表が必ず先という順序前提に
  //   依存しており脆かった。ここで表単位の種別判定に置き換える。）
  let inNonTaskTable = false;

  // 縦型カード（`| フィールド | 値 |` ヘッダ + `| key | value |` 行の連なり）の集約状態。
  // 1 カード = 1 タスク。次のカードヘッダ / `### ` 見出し / 非テーブル行で確定する。
  let card: Record<string, string> | null = null;
  const flushCard = () => {
    if (!card) return;
    const c = card;
    card = null;
    const id = c['ID'] || c['id'];
    if (!id) return;
    const title = c['タイトル'] || c['title'] || c['タスク'] || '';
    if (!title) return;
    const status = normStatus(c['ステータス'] || c['status']);
    const priority = c['優先度'] || c['priority'] || undefined;
    const owner = c['担当'] || c['owner'] || c['assignee'] || undefined;
    const key = `${source}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    // 承認フロー（MC-79）素材: カードの全フィールド値を本文相当として whitelist マッチ。
    const approvalTags = extractApprovalTags([
      c['区分'],
      c['フェーズ'],
      c['層'],
      c['ステータス'] || c['status'],
      c['詳細'],
      c['受け入れ条件'],
      c['提言・抜けもれ'],
      c['提言・抜けもれ（重要）'],
      c['関連'],
    ]);
    out.push(
      markStalled({
        id,
        title,
        status,
        owner,
        priority,
        project,
        source,
        updated,
        needsKeita: ownerHasKeita(owner),
        approvalTags,
        detail: buildCardDetail(c),
      }),
    );
  };

  for (const line of lines) {
    if (!line.startsWith('|')) {
      // テーブルが途切れたらカードを確定（`### ` 見出しや空行・本文行で区切る）。
      flushCard();
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) {
      flushCard();
      continue;
    }
    const id = cells[0];

    // 縦型カードヘッダ `| フィールド | 値 |`（または英語 field/value）を検出したら
    // カードモードを開始。直前のカードがあれば確定してから新カードを開く。
    if (/^(フィールド|項目|field|key)$/i.test(id) && /^(値|value)$/i.test(cells[1] ?? '')) {
      flushCard();
      card = {};
      continue;
    }
    // カードモード中: `| key | value |` を集約。区切り行（|---|---|）は無視。
    if (card) {
      if (/^[-:]+$/.test(id) || id.includes('---')) continue;
      card[id] = cells[1] ?? '';
      continue;
    }

    // ヘッダ行を検出して列マッピングを確定（最初の `| ID |` 行）。
    // ID 列見出しが `ID`（=タスクの正準サマリ表）のときだけタスク表として扱う。
    if (id === 'ID') {
      inNonTaskTable = false;
      col = {};
      cells.forEach((h, i) => {
        if (/優先度|priority/i.test(h)) col!.priority = i;
        else if (/担当|owner|assignee/i.test(h)) col!.owner = i;
        else if (/ステータス|status|区分/i.test(h)) col!.status = i;
      });
      continue;
    }
    // 区切り行は表種別を変えずスキップ（直前のヘッダ判定を保持）。
    if (/^[-:]+$/.test(id) || id.includes('---')) continue;
    // ID 見出しが `ID` でないテーブルヘッダ行を検出したら「非タスク表」とマークする。
    // 例: `| タスク | 旧状態 | 新状態 | 反映内容 |`（判断反映サマリ）。
    // 1列目が見出し語（タスク/task/項目/対象 等）で、かつ「旧状態/新状態/反映内容」のような
    // status 列でない遷移列を持つ表は、その表全体を task 化しない。
    const looksLikeOtherHeader =
      /^(タスク|task|項目|対象|名称)$/i.test(id) &&
      cells.some((h) => /旧状態|新状態|変更前|変更後|遷移|反映内容|before|after/i.test(h));
    if (looksLikeOtherHeader) {
      inNonTaskTable = true;
      col = null;
      continue;
    }
    // 非タスク表の中の行は一切 task 化しない（別表の旧/新状態列を status に拾わない）。
    if (inNonTaskTable) continue;
    // 非タスク行を除外
    if (!id) continue;
    if (!/^[A-Za-z]/.test(id) && !/^\d/.test(id)) continue;
    const title = cells[1];
    if (!title) continue;
    const priority = cells[col?.priority ?? 2] || undefined;
    // owner: ヘッダで担当列が分かればそれを、無ければ末尾セル（logic 互換）。
    let owner = cells[col?.owner ?? cells.length - 1] || undefined;

    // ステータスは「表行（summary table の status 列）を一次値」とし、
    // `### <ID>` セクション本文の `- ステータス:` は確定方向にのみ上書きする（mergeStatus）。
    // 同一 ID が表行＋詳細セクションの両方に出るとき、表行が DONE なのにセクションが
    // 古い REVIEW/TODO のまま残っているケースがあり、旧実装はセクションを一次ソースに
    // していたため確定済みタスクを巻き戻していた（このバグの修正点）。
    let status: TaskStatus = 'UNKNOWN';
    // 1) 表行のステータス列を一次値に。
    //    列が特定できない場合は cells[4]（cxo）→ cells[3]（logic 区分）の順でフォールバック。
    const statusIdx = col?.status;
    if (statusIdx !== undefined) status = normStatus(cells[statusIdx]);
    if (status === 'UNKNOWN') {
      status = normStatus(cells[4]) !== 'UNKNOWN' ? normStatus(cells[4]) : normStatus(cells[3]);
    }
    // 2) 詳細セクションの `- ステータス:` / 担当: を見る。ステータスは確定方向のみ反映。
    let sectionOwner: string | undefined;
    const secRe = new RegExp(
      `###?[^\\n]*${escapeReg(id)}[\\s\\S]*?(?=\\n###?\\s|$)`,
    );
    const sec = md.match(secRe);
    if (sec) {
      const sm = sec[0].match(/ステータス[:：*\s]*([A-Za-z_/ ]+)/);
      if (sm) status = mergeStatus(status, normStatus(sm[1]));
      const om = sec[0].match(/担当[:：]\s*([^\n/]+)/);
      if (om) sectionOwner = om[1].replace(/\*/g, '').trim() || undefined;
    }
    if (sectionOwner) owner = sectionOwner;

    const key = `${source}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // 承認フロー（MC-79）素材:
    //   - 区分/フェーズ列セル（cells のうち status/priority/owner 列以外の中間セル）
    //   - 詳細セクション本文（sec[0]）。ここに「設計判断」「デプロイ可否」等の whitelist 語が載る。
    // owner は表行 or セクションの 担当: を反映済み。
    const phaseCells = cells.filter(
      (_c, i) => i !== 0 && i !== 1 && i !== (col?.status ?? -1) && i !== (col?.owner ?? -1),
    );
    const approvalTags = extractApprovalTags([...phaseCells, sec?.[0]]);
    out.push(
      markStalled({
        id,
        title,
        status,
        owner,
        priority,
        project,
        source,
        updated,
        needsKeita: ownerHasKeita(owner),
        approvalTags,
        detail: buildSectionDetail(sec?.[0]),
      }),
    );
  }
  // ファイル末尾がカードで終わる場合の取りこぼし防止。
  flushCard();
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── kanban.md / today.md（チェックボックス形式）──────────────────

function parseCheckboxBoard(
  path: string,
  source: string,
  defaultProject: ProjectName,
): Task[] {
  if (!existsSync(path)) return [];
  const md = readFileSync(path, 'utf-8');
  const updated = frontmatterUpdated(md) ?? fileMtimeIso(path);
  const out: Task[] = [];
  const lines = md.split('\n');

  // セクション見出し → ステータス
  let sectionStatus: TaskStatus = 'UNKNOWN';
  let idx = 0;

  let current: (Omit<Task, 'stalled'> & { _hasStatus?: boolean }) | null = null;
  const flush = () => {
    if (current) {
      out.push(markStalled(current));
      current = null;
    }
  };

  for (const line of lines) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      flush();
      const title = h[1];
      if (/now|進行/i.test(title)) sectionStatus = 'IN_PROGRESS';
      else if (/next|近日|todo/i.test(title)) sectionStatus = 'TODO';
      else if (/done|完了|✅/i.test(title)) sectionStatus = 'DONE';
      else if (/block|ブロック/i.test(title)) sectionStatus = 'BLOCKED';
      else if (/review|レビュー/i.test(title)) sectionStatus = 'REVIEW';
      else sectionStatus = 'UNKNOWN';
      continue;
    }

    // チェックボックス: - [ ] **title** #tags  /  1. [ ] **title**
    const cb = line.match(/^\s*(?:[-*]|\d+\.)\s*\[( |x|X)\]\s*(.*)$/);
    if (cb) {
      flush();
      const checked = cb[1].toLowerCase() === 'x';
      let title = cb[2].replace(/\*\*/g, '').replace(/`#[^`]+`/g, '').replace(/#\S+/g, '').trim();
      title = title.replace(/\s+/g, ' ').trim();
      idx += 1;
      current = {
        id: `${source}-${idx}`,
        title: title || '(無題)',
        status: checked ? 'DONE' : sectionStatus === 'UNKNOWN' ? 'TODO' : sectionStatus,
        project: projectFromTags(line, defaultProject),
        source,
        updated,
      };
      continue;
    }

    // 子行: owner:/priority:/status:
    if (current) {
      const ow = line.match(/owner[:：]\s*(.+)/i);
      if (ow) current.owner = ow[1].trim();
      const pr = line.match(/priority[:：]\s*(.+)/i);
      if (pr) current.priority = pr[1].trim();
      const stt = line.match(/status[:：]\s*(.+)/i);
      if (stt) {
        const s = normStatus(stt[1]);
        if (s !== 'UNKNOWN') current.status = s;
      }
    }
  }
  flush();
  return out;
}

/** 行内の `#logic` 等のタグからプロジェクト推定。無ければ default。 */
function projectFromTags(line: string, fallback: ProjectName): ProjectName {
  const lower = line.toLowerCase();
  const p = projectFromPath(lower);
  if (p !== 'other') return p;
  return fallback;
}

// ─── 統合 ──────────────────────────────────────────────

export function collectTasks(): Task[] {
  const tasks: Task[] = [];
  tasks.push(...parseTrackerTable(TASK_SOURCES.logicTracker, 'logic', 'logic/TASK_TRACKER'));
  tasks.push(
    ...parseTrackerTable(TASK_SOURCES.nishimaruTracker, 'nishimaru', 'nishimaru/TASK_TRACKER'),
  );
  // cxo 自身の台帳もパース対象（ドッグフーディング: 自分の MC-xx を Kanban に出す）。
  tasks.push(...parseTrackerTable(TASK_SOURCES.cxoTracker, 'cxo', 'cxo/TASK_TRACKER'));
  tasks.push(...parseCheckboxBoard(TASK_SOURCES.kanban, 'kanban', 'private'));
  tasks.push(...parseCheckboxBoard(TASK_SOURCES.today, 'today', 'private'));
  return tasks;
}
