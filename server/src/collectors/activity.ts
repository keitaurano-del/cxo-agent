// activity collector — 実装進捗タブ「いま何が動いているか全部見える」統合ビュー（MC-534, 2026-09-04 Keita 指示）。
//
// 1 エンドポイント（GET /api/activity）で、システム上でいま動いている/待っているものを 5 系統
// 横断で集める。すべて read-only 観測・fail-soft（個別系統が失敗しても他系統は返す）。
//
//   ① subagent … Task サブエージェント（~/.claude/projects/**/subagents/agent-*.jsonl）。collectAgents 再利用。
//   ② session  … 本体レーンの作業セッション（~/.claude/projects/*/*.jsonl の親セッション）。
//                 openclaw agent CLI 経由の Son ビルド等がここに出る。末尾 tail のみ読む。
//   ③ terminal … 端末で動いているもの（tmux 各セッションの現在アクティビティ）。exact-match =name: で叩く（MC-310 教訓）。
//   ④ job      … バックグラウンドジョブ（ps 観測: openclaw agent / claude ヘッドレス / ビルド）。
//   ⑤ queue    … 待機/キュー（crontab の次回実行予定・分かる範囲）。
//
// UI 側（BuildProgress）はこれを status（active/idle/done/waiting）で
// 実行中/待機/完了 の 3 グループに畳んで表示する。

import {
  readdirSync,
  statSync,
  existsSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DATA_HOME,
  CLAUDE_PROJECTS_DIR,
  STALL_MINUTES,
  TERMINAL_TMUX_PATH,
  TERMINAL_TMUX_TIMEOUT_MS,
  TERMINALS,
} from '../config.js';
import { redactText } from '../lib/redact.js';
import { collectAgents } from './agents.js';
import { collectTerminals } from './secretaries.js';

/** 統合アクティビティ 1 件。frontend の ActivityBoard が描画する。 */
export interface ActivityItem {
  /** 安定キー（重複排除・React key）。 */
  id: string;
  /** 系統。 */
  category: 'subagent' | 'session' | 'terminal' | 'job' | 'queue';
  /** 系統の日本語ラベル。 */
  categoryLabel: string;
  /** 誰が（人格/端末/プロジェクト名）。 */
  who: string;
  /** 絵文字（who の先頭に添える）。 */
  emoji: string;
  /** 何を（作業内容スニペット／コマンド／スケジュール対象）。 */
  what: string;
  /** 実行中=active / 待機=idle・waiting / 完了=done。 */
  status: 'active' | 'idle' | 'done' | 'waiting';
  /** 開始時刻 ISO（分かる場合）。空可。 */
  startedAt: string;
  /** 最終活動 ISO（分かる場合）。空可。 */
  lastActivity: string;
  /** 次回実行予定 ISO（⑤ queue のみ）。空可。 */
  scheduledFor: string;
  /** 補助情報 1 行（ブランチ・pid・tmux コマンド・cron 式など）。空可。 */
  detail: string;
  /** サブエージェントの会話フィードを開く用の agentId（① のみ）。空可。 */
  agentId: string;
}

const CATEGORY_LABEL: Record<ActivityItem['category'], string> = {
  subagent: 'サブエージェント',
  session: '作業セッション',
  terminal: 'ターミナル',
  job: 'バックグラウンド',
  queue: 'キュー',
};

const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', '-bash', '-sh', '-zsh', 'tmux']);

/** ファイル末尾の maxBytes だけ読む（巨大な親セッション jsonl のフル読みを避ける）。 */
function readTail(filePath: string, maxBytes = 48 * 1024): string {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const start = size - len;
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, start);
    return buf.toString('utf-8');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* noop */
      }
    }
  }
}

/** tail テキスト（jsonl 断片）から最新 assistant text と先頭行 timestamp を拾う。 */
function parseSessionTail(tail: string): { lastAction: string; startedAt: string } {
  const lines = tail.split('\n');
  let lastAction = '';
  let startedAt = '';
  // 先頭の欠けた行（tail 境界）は JSON.parse に失敗するので黙って飛ばす。
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!startedAt && typeof d.timestamp === 'string') startedAt = d.timestamp;
    const msg = (d.message ?? d) as Record<string, unknown>;
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          (block as Record<string, unknown>).type === 'text' &&
          typeof (block as Record<string, unknown>).text === 'string'
        ) {
          text = (block as Record<string, unknown>).text as string;
        }
      }
    }
    if (text.trim()) lastAction = text.trim().replace(/\s+/g, ' ').slice(0, 200);
  }
  return { lastAction: redactText(lastAction), startedAt };
}

/** プロジェクトディレクトリ名（-home-dev-... 形式）を読みやすい相対名に戻す。 */
function decodeProjectDir(dirName: string): string {
  // ~/.claude/projects のディレクトリは cwd を `-` 区切りにエンコードしたもの。
  // 先頭 DATA_HOME 部分を落として末尾寄りの意味ある部分を短く見せる。
  const path = dirName.replace(/^-/, '/').replace(/-/g, '/');
  const home = DATA_HOME.replace(/\/$/, '');
  let rel = path.startsWith(home) ? path.slice(home.length).replace(/^\//, '') : path;
  if (!rel) rel = '~';
  // 過度に長いものは末尾 2 セグメントに縮める。
  const segs = rel.split('/').filter(Boolean);
  return segs.length > 2 ? segs.slice(-2).join('/') : rel;
}

// ── ① サブエージェント ─────────────────────────────────────────────
function subagentItems(): ActivityItem[] {
  const agents = collectAgents(); // 活動の新しい順。
  const now = Date.now();
  const IDLE_WINDOW_MS = 3 * 60 * 60 * 1000; // 直近 3h 以内に動いた idle だけ（「いま動いている」ボードのため）。
  const DONE_WINDOW_MS = 6 * 60 * 60 * 1000; // 完了は直近 6h。
  const items: ActivityItem[] = [];
  let idleCount = 0;
  let doneCount = 0;
  for (const a of agents) {
    if (a.status === 'never') continue; // 一度も動いていないものは出さない。
    const ts = Date.parse(a.lastActivity || '') || 0;
    if (a.status === 'idle') {
      // 古い idle（何日も前に終わった裏エージェント）でボードを埋めない。直近＋上限のみ。
      if (now - ts > IDLE_WINDOW_MS || idleCount >= 40) continue;
      idleCount++;
    }
    if (a.status === 'done') {
      if (now - ts > DONE_WINDOW_MS || doneCount >= 25) continue;
      doneCount++;
    }
    const detailBits = [a.projectLabel, a.gitBranch, a.currentTaskId].filter(Boolean);
    items.push({
      id: `subagent:${a.agentId}`,
      category: 'subagent',
      categoryLabel: CATEGORY_LABEL.subagent,
      who: a.subagentType,
      emoji: '🛰',
      what: a.lastAction || a.description || '',
      status: a.status,
      startedAt: '',
      lastActivity: a.lastActivity || '',
      scheduledFor: '',
      detail: detailBits.join(' · '),
      agentId: a.agentId,
    });
  }
  return items;
}

// ── ② 本体レーンの作業セッション（親セッション jsonl）──────────────────────
function sessionItems(): ActivityItem[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];
  const now = Date.now();
  const WINDOW_MS = 6 * 60 * 60 * 1000; // 直近 6 時間の親セッションのみ観測。
  type Cand = { path: string; dirName: string; mtimeMs: number };
  const cands: Cand[] = [];
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return [];
  }
  for (const dirName of projectDirs) {
    const dir = join(CLAUDE_PROJECTS_DIR, dirName);
    let files: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      if (f.includes('.trajectory.') || f.includes('.deleted.')) continue;
      const p = join(dir, f);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size === 0) continue;
      if (now - st.mtimeMs > WINDOW_MS) continue;
      cands.push({ path: p, dirName, mtimeMs: st.mtimeMs });
    }
  }
  cands.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const items: ActivityItem[] = [];
  for (const c of cands.slice(0, 15)) {
    const tail = readTail(c.path);
    const { lastAction, startedAt } = parseSessionTail(tail);
    const minsSince = (now - c.mtimeMs) / 60000;
    const status: ActivityItem['status'] = minsSince < STALL_MINUTES ? 'active' : 'idle';
    const proj = decodeProjectDir(c.dirName);
    items.push({
      id: `session:${c.dirName}:${c.path.slice(-12)}`,
      category: 'session',
      categoryLabel: CATEGORY_LABEL.session,
      who: proj,
      emoji: '📁',
      what: lastAction,
      status,
      startedAt,
      lastActivity: new Date(c.mtimeMs).toISOString(),
      scheduledFor: '',
      detail: `claude セッション`,
      agentId: '',
    });
  }
  return items;
}

// ── ③ 端末で動いているもの（tmux）──────────────────────────────────
function tmux(args: string[]): string {
  return execFileSync('tmux', args, {
    timeout: TERMINAL_TMUX_TIMEOUT_MS,
    env: { ...process.env, PATH: TERMINAL_TMUX_PATH },
    encoding: 'utf-8',
  }).toString();
}

/** OpenClaw 端末（openclaw/openclaw-son/openclaw-kimi）は tmux コマンドが常に openclaw-tui のため、
 *  セッションログ（collectTerminals）から実作業と active/idle を引く。key は tmux セッション名で突合。 */
function openclawEnrichment(): Map<string, { what: string; status: ActivityItem['status'] }> {
  const map = new Map<string, { what: string; status: ActivityItem['status'] }>();
  try {
    for (const t of collectTerminals()) {
      // collectTerminals の key は masayoshi/son/kimi。tmux は openclaw/openclaw-son/openclaw-kimi。
      const tmuxName = t.key === 'masayoshi' ? 'openclaw' : `openclaw-${t.key}`;
      const status: ActivityItem['status'] =
        t.status === 'active' ? 'active' : t.status === 'never' ? 'idle' : 'idle';
      map.set(tmuxName, { what: t.lastAction, status });
    }
  } catch {
    /* fail-soft */
  }
  return map;
}

function terminalItems(): ActivityItem[] {
  const items: ActivityItem[] = [];
  const enrich = openclawEnrichment();
  for (const t of TERMINALS) {
    const session = t.tmuxSession;
    let cmd = '';
    let activityEpoch = 0;
    try {
      // exact-match =name: で叩く（bare 名禁止・MC-310 教訓）。
      const out = tmux([
        'display-message',
        '-p',
        '-t',
        `=${session}:`,
        '-F',
        '#{pane_current_command}|#{window_activity}',
      ]).trim();
      const [c, act] = out.split('|');
      cmd = (c || '').trim();
      activityEpoch = Number(act) || 0;
    } catch {
      continue; // セッション不在 → 出さない。
    }
    let lastLine = '';
    try {
      const cap = tmux(['capture-pane', '-p', '-t', `=${session}:`]);
      const nonEmpty = cap.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
      lastLine = nonEmpty.length ? nonEmpty[nonEmpty.length - 1].slice(0, 200) : '';
    } catch {
      /* キャプチャ失敗は what 空で続行 */
    }
    const lastActivity = activityEpoch ? new Date(activityEpoch * 1000).toISOString() : '';
    const minsSince = activityEpoch ? (Date.now() - activityEpoch * 1000) / 60000 : Infinity;

    // 既定判定: シェルが前面 = 待機、それ以外のプロセスが前面 = 実行中（直近活動があれば）。
    let status: ActivityItem['status'] = SHELLS.has(cmd)
      ? 'idle'
      : minsSince < STALL_MINUTES
        ? 'active'
        : 'idle';
    let what = lastLine;

    // OpenClaw 端末はセッションログの実作業で上書き（tmux コマンドは常に openclaw-tui のため）。
    const e = enrich.get(session);
    if (e) {
      status = e.status;
      if (e.what) what = e.what;
    }

    items.push({
      id: `terminal:${session}`,
      category: 'terminal',
      categoryLabel: CATEGORY_LABEL.terminal,
      who: t.label,
      emoji: '🖥',
      what: redactText(what),
      status,
      startedAt: '',
      lastActivity,
      scheduledFor: '',
      detail: `tmux =${session}: · ${cmd || '?'}`,
      agentId: '',
    });
  }
  return items;
}

// ── ④ バックグラウンドジョブ（ps）───────────────────────────────────
function jobItems(): ActivityItem[] {
  let out = '';
  try {
    out = execFileSync('ps', ['-eo', 'pid=,etimes=,args='], {
      timeout: 5000,
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    }).toString();
  } catch {
    return [];
  }
  const now = Date.now();
  const items: ActivityItem[] = [];
  const seen = new Set<string>();
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = m[1];
    const etimes = Number(m[2]) || 0;
    const args = m[3];

    // Claude Code の Bash ツール呼び出しラッパー（ephemeral）は出さない。実体は別プロセスで拾う。
    if (/shell-snapshots\/snapshot-/.test(args)) continue;
    // 常駐サービスの esbuild dev サービスは「ビルド」ではない。
    if (/esbuild.*--service/.test(args)) continue;

    let who = '';
    let emoji = '⚙️';
    let what = '';
    let dedup = '';

    if (/openclaw agent\b/.test(args)) {
      // `openclaw agent` CLI 起動ラッパー（--agent / --session-key / -m メッセージ付き）。
      const agent = args.match(/--agent\s+(\S+)/)?.[1] ?? '?';
      const sk = args.match(/--session-key\s+"?([^"\s]+)/)?.[1] ?? pid;
      // -m の中身は shell の '"'"' エスケープで囲われるので、末尾の 2>&1 / </dev/null 手前までを取り引用符を除く。
      const msgRaw = args.match(/-m\s+(.+?)(?:\s+2>&1|\s+<\s|\s+&&|\s+\|\s|$)/)?.[1] ?? '';
      who = `OpenClaw エージェント: ${agent}`;
      emoji = '🤖';
      what = msgRaw.replace(/'"'"'|['"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      dedup = `oc:${sk}`;
    } else if (/\bclaude\b/.test(args) && /(--print|(^|\s)-p(\s|$))/.test(args)) {
      // ヘッドレス claude（-p / --print）。openclaw MCP 参照があれば openclaw agent の実体。
      const isOpenclaw = /mcp__openclaw|\/openclaw/.test(args);
      // -p の直後が別フラグ（--...）なら prompt は stdin 経由で args には無い。
      const prompt = args.match(/(?:^|\s)-p\s+(?!--)([\s\S]+)$/)?.[1] ?? '';
      who = isOpenclaw ? 'OpenClaw エージェント' : 'Claude ヘッドレス';
      emoji = '🤖';
      what = prompt.replace(/\s+/g, ' ').slice(0, 200) || (isOpenclaw ? 'エージェント実行中' : '');
      dedup = `cl:${pid}`;
    } else if (
      // 実ビルドコマンドのみ（サービスの /build/ パスは拾わない）。nohup ビルドも拾う。
      /(vite build|(?:npm|pnpm|yarn)\s+(?:run\s+)?build|tsc\s+-b|\bmake\s|(?:generate|build)[-_]?sitemap|sitemap\.(?:js|ts|py|sh))/.test(args) ||
      (/\bnohup\b/.test(args) && /(build|vite|tsc|sitemap|webpack|esbuild)/.test(args))
    ) {
      who = 'ビルド';
      emoji = '🔨';
      what = args.replace(/\s+/g, ' ').slice(0, 200);
      dedup = `build:${pid}`;
    } else {
      continue; // それ以外の常駐プロセスは出さない（ノイズ除去）。
    }

    if (seen.has(dedup)) continue;
    seen.add(dedup);
    items.push({
      id: `job:${dedup}`,
      category: 'job',
      categoryLabel: CATEGORY_LABEL.job,
      who,
      emoji,
      what: redactText(what),
      status: 'active',
      startedAt: etimes ? new Date(now - etimes * 1000).toISOString() : '',
      lastActivity: '',
      scheduledFor: '',
      detail: `pid ${pid}`,
      agentId: '',
    });
  }
  return items;
}

// ── ⑤ 待機/キュー（crontab の次回実行）──────────────────────────────
/** cron 1 フィールドを許可値集合に展開（* / n, a-b, a-b/n, a,b, 単値）。 */
function cronField(expr: string, min: number, max: number): Set<number> {
  const set = new Set<number>();
  for (const part of expr.split(',')) {
    let step = 1;
    let range = part;
    const slash = part.split('/');
    if (slash.length === 2) {
      range = slash[0];
      step = Number(slash[1]) || 1;
    }
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const dash = range.split('-');
      lo = Number(dash[0]);
      hi = dash.length === 2 ? Number(dash[1]) : lo;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) set.add(v);
    }
  }
  return set;
}

/** 5 フィールド cron の次回実行時刻をローカル時間で求める（8 日先まで走査）。見つからなければ null。 */
function cronNext(fields: string[], from: Date): Date | null {
  const [mi, ho, dom, mon, dow] = fields;
  const mins = cronField(mi, 0, 59);
  const hours = cronField(ho, 0, 23);
  const doms = cronField(dom, 1, 31);
  const mons = cronField(mon, 1, 12);
  const dows = cronField(dow, 0, 6); // 0=Sun。7 は使われていないので 0-6 で扱う。
  const domRestricted = dom.trim() !== '*';
  const dowRestricted = dow.trim() !== '*';

  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // 次の分から。
  const limit = 8 * 24 * 60; // 8 日ぶんの分数。
  for (let i = 0; i < limit; i++) {
    if (
      mins.has(d.getMinutes()) &&
      hours.has(d.getHours()) &&
      mons.has(d.getMonth() + 1)
    ) {
      const domOk = doms.has(d.getDate());
      const dowOk = dows.has(d.getDay());
      // 標準 cron: dom と dow が両方制限されていれば OR、片方だけなら制限側を満たす。
      const dayOk =
        domRestricted && dowRestricted
          ? domOk || dowOk
          : domRestricted
            ? domOk
            : dowRestricted
              ? dowOk
              : true;
      if (dayOk) return new Date(d.getTime());
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/** cron コマンド文字列から短いラベルを作る（スクリプト名＋末尾引数）。 */
function cronLabel(cmd: string): string {
  const script = cmd.match(/([\w.-]+\.(?:sh|py|js))(?:\s+(\S+))?/);
  if (script) return script[2] ? `${script[1]} ${script[2]}` : script[1];
  const skill = cmd.match(/son-skill-cron\.sh\s+(\S+)/);
  if (skill) return `skill: ${skill[1]}`;
  return cmd.replace(/\s+/g, ' ').slice(0, 60);
}

function queueItems(): ActivityItem[] {
  let out = '';
  try {
    out = execFileSync('crontab', ['-l'], { timeout: 5000, encoding: 'utf-8' }).toString();
  } catch {
    return [];
  }
  const now = new Date();
  const items: ActivityItem[] = [];
  for (const raw of out.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^[A-Z_]+=/.test(line)) continue; // PATH=, SHELL=, TZ= 単独宣言行。
    // 行頭の TZ=... プレフィックスは剥がす。
    line = line.replace(/^TZ=\S+\s+/, '');
    if (line.startsWith('@')) continue; // @reboot 等は次回時刻を持たない。
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;
    const fields = parts.slice(0, 5);
    if (!/^[\d*,/-]+$/.test(fields[0])) continue; // 5 フィールドが cron 式でなければスキップ。
    const cmd = parts.slice(5).join(' ');
    const next = cronNext(fields, now);
    if (!next) continue;
    items.push({
      id: `queue:${fields.join('_')}:${cronLabel(cmd)}`,
      category: 'queue',
      categoryLabel: CATEGORY_LABEL.queue,
      who: 'cron',
      emoji: '⏰',
      what: cronLabel(cmd),
      status: 'waiting',
      startedAt: '',
      lastActivity: '',
      scheduledFor: next.toISOString(),
      detail: fields.join(' '),
      agentId: '',
    });
  }
  // 直近の実行予定順に、次の 12 件だけ。
  items.sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  return items.slice(0, 12);
}

// ── 統合 ────────────────────────────────────────────────────────────
// 各系統は fail-soft。tmux/ps/crontab は execFileSync のため短期キャッシュで連打を吸収する。
let cached: ActivityItem[] | null = null;
let cachedAt = 0;
const ACTIVITY_TTL_MS = 6000;

function safe(fn: () => ActivityItem[]): ActivityItem[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

/** 5 系統を横断した統合アクティビティ一覧（6 秒キャッシュ・全系統 fail-soft）。 */
export function collectActivity(): ActivityItem[] {
  const now = Date.now();
  if (cached && now - cachedAt < ACTIVITY_TTL_MS) return cached;
  const items = [
    ...safe(subagentItems),
    ...safe(sessionItems),
    ...safe(terminalItems),
    ...safe(jobItems),
    ...safe(queueItems),
  ];
  cached = items;
  cachedAt = now;
  return items;
}
