// Apollo — backend エントリポイント
//
// REST + SSE(枠) + 将来 web/dist 静的配信。
// 起動: npm run dev → http://localhost:PORT

import express, { type Request, type Response, type NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import {
  existsSync,
  statSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  renameSync,
  rmSync,
  cpSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { PORT, CLAUDE_PROJECTS_DIR, VAULT_DIR, STALL_MINUTES, AGENT_LOG_TTL_MS, DELIVERABLES_DIR, CLIPITNOW_PDCA_STATE_FILE } from './config.js';
import { collectAgents, collectAgentGroups, collectAgentFeed } from './collectors/agents.js';
import { collectSecretaries } from './collectors/secretaries.js';
import { collectMoods, type MoodInput } from './collectors/moods.js';
import { collectTasks } from './collectors/tasks.js';
import { collectTimeline } from './collectors/timeline.js';
import { collectNarrative } from './collectors/narrative.js';
import { collectRoster } from './collectors/roster.js';
import { collectUsage } from './collectors/usage.js';
import { collectClaudeUsage } from './collectors/claudeUsage.js';
import { collectWorkflows, collectWorkflowDetail } from './collectors/workflows.js';
import { collectDeploys } from './collectors/deploys.js';
import { collectTicks } from './collectors/ticks.js';
import { collectAlerts } from './collectors/alerts.js';
import { linksForTask } from './collectors/taskLinks.js';
import { search } from './collectors/search.js';
import {
  buildTree,
  readNote,
  searchVault,
  resolveAttachment,
} from './collectors/vault.js';
import { SafePathError } from './lib/vaultPath.js';
import { listDeliverables, resolveDeliverable } from './collectors/deliverables.js';
import {
  resolveDeliverablePath,
  toDeliverableRelative,
  validateRenameName,
  resolveRenameTarget,
  resolveDeliverableDir,
  resolveMoveTarget,
  resolveCopyTarget,
  trashRoot,
  resolveTrashPath,
  toTrashRelative,
  makeTrashTarget,
} from './lib/deliverablePath.js';
import { purgeTrashIfDue } from './lib/trashPurge.js';
import {
  getAllMeta,
  setMeta,
  moveMeta,
  copyMeta,
  trashMeta,
  restoreMeta,
  purgeTrashMeta,
} from './lib/deliverableMeta.js';
import {
  convertOfficeToPdf,
  isConvertibleToPdf,
  deleteOfficePdfCache,
} from './lib/officeToPdf.js';
import { makeAuthMiddleware, authEnabled } from './lib/auth.js';
import { inboxRouter } from './inbox.js';
import { terminalUploadRouter } from './terminalUpload.js';
import { terminalControlRouter } from './terminalControl.js';
import { vaultWriteRouter } from './vaultWriteRouter.js';
import { deliverableUploadRouter } from './deliverableUploadRouter.js';
import { deliverableChunkRouter } from './deliverableChunkRouter.js';
import { notebookRouter } from './notebookRouter.js';
import { minutesRouter } from './minutesRouter.js';
import { exportMinutes } from './lib/minutesExport.js';
import { taskEditRouter } from './taskEditRouter.js';
import { approvalRouter } from './approvalRouter.js';
import { approvalRequestHandler } from './approvalRequestHandler.js';
import { decisionRouter } from './decisionRouter.js';
import { decisionRequestHandler } from './decisionRequestHandler.js';
import { spawnRouter } from './spawnRouter.js';
import { terminalHttpHandler, attachUpgrade } from './terminalProxy.js';
import { startWatch } from './watch.js';
import { chatRouter, agentMessageHandler, autonomousTickHandler } from './chatRouter.js';
import { navOrderRouter } from './navOrderRouter.js';
import { babyDiaryRouter } from './babyDiaryRouter.js';
import { childcareChatRouter } from './childcareChatRouter.js';
import { chajiChatRouter } from './chajiChatRouter.js';
import { claudeChatRouter } from './claudeChatRouter.js';
import { workChatRouter } from './workChatRouter.js';
import { workKnowledgeRouter } from './workKnowledgeRouter.js';
import { googleRouter } from './googleRouter.js';
import { plannerRouter } from './plannerRouter.js';
import { devMockupRouter } from './devMockupRouter.js';
import { revenueRouter } from './revenueRouter.js';

const HEALTHZ_PATH = '/api/healthz';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '..');
const WEB_DIST = join(SERVER_ROOT, '..', 'web', 'dist');

const app = express();

// ─── gzip 圧縮（MC-206 横断軽量化）── 他ミドルウェア/ルートより前段に置く ──────────
// JSON API（/api/tasks?scope=closed の ~714KB 等）・静的配信を圧縮して転送量を削減する。
// 重大な除外を filter で担保する:
//   1) SSE（Content-Type: text/event-stream）— 圧縮するとバッファされてリアルタイム配信が
//      壊れ、バッジ/ボードのライブ更新が死ぬ。/api/stream の Content-Type で確実に弾く。
//   2) ターミナル proxy（/terminal・ttyd）— ttyd 側 gzip との二重化で文字化けする既往（MC-93）。
//      proxy の HTTP 応答が二重圧縮されないよう path で弾く（WebSocket は res を通らないため対象外）。
// 上記以外（JSON API・web/dist 静的配信）は既定どおり圧縮対象とする。
app.use(
  compression({
    filter: (req, res) => {
      // SSE は絶対に圧縮しない（リアルタイム配信が壊れる）。
      const contentType = String(res.getHeader('Content-Type') ?? '');
      if (contentType.includes('text/event-stream')) return false;
      // SSE エンドポイント・ターミナル proxy（ttyd 二重 gzip 防止 / MC-93）は path でも弾く。
      if (req.path === '/api/stream' || req.path.startsWith('/terminal')) return false;
      // それ以外は compression 既定の判定（圧縮可能な Content-Type のみ）に委ねる。
      return compression.filter(req, res);
    },
  }),
);

// CORS: 同一オリジン配信前提（web/dist を同じ server が配る）＋ MC_TOKEN 認証下なので
// クロスオリジンを許可する必要がない。全許可（origin:true）をやめ、CORS ヘッダを付けない
// = same-origin のみ許容（ブラウザがクロスオリジン fetch をブロックする）。
// 開発時に別ポートの Vite dev server から叩く場合は dev proxy（vite.config の proxy）を使う。
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));

// ─── Permissions-Policy（クリップボード委譲）── MC-92 コピペ改善 ────
// Apollo 本体（親 HTML）と /terminal proxy（iframe 内 ttyd）のレスポンスに
// clipboard-read / clipboard-write を self に許可するヘッダを付ける。iframe の
// allow="clipboard-read; clipboard-write"（Terminal.tsx）だけでは、ブラウザに
// よっては親ドキュメントの Permissions-Policy で許可されていないと iframe へ
// clipboard 権限が委譲されない。ここで親・iframe 両方の経路に付与して
// navigator.clipboard / Ctrl+V paste を通す。
//   注意: navigator.clipboard は secure context（HTTPS か localhost）でしか
//   動かないため、http://IP:4317 直アクセス時はこのヘッダがあっても read API は
//   封じられる（HTTPS 必須）。ただし Ctrl+V のネイティブ paste（DOM paste
//   イベント）は ttyd/xterm.js が受けるので非セキュアでも通る経路がある。
//   全ルートに付けても害はない（401 等にも乗るが副作用なし）。認証は別レイヤー。
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'clipboard-read=(self), clipboard-write=(self)');
  next();
});

// ─── ヘルスチェック（認証不要・最優先で登録）────────────────
// systemd / 外形監視用の軽量版。詳細版 /api/health は認証下に残す。
app.get(HEALTHZ_PATH, (_req, res) => {
  res.json({ ok: true });
});

// ─── エージェント投稿（認証外）──────────────────────────────────
// /api/chat/agent-message は AGENT_TOKEN で独立認証するため auth ミドルウェアの外に置く。
// エージェント（林・Masayoshi）が Cookie なしで curl / fetch で呼べるようにする。
// broadcast は SSE hub（このファイルで定義）を参照するため、ここで登録して closure で遅延解決。
app.post('/api/chat/agent-message', (req, res) => {
  agentMessageHandler(broadcast)(req, res);
});

// ── autonomous-tick（認証外）─────────────────────────────────────
// MC-148: /api/chat/autonomous-tick は AGENT_TOKEN で独立認証するため auth ミドルウェアの外に置く。
// cron スクリプトが Authorization: Bearer <AGENT_TOKEN> で Cookie なしで呼べるようにする。
// token は req.body.token または Bearer ヘッダのどちらからでも受理する。
app.post('/api/chat/autonomous-tick', (req, res) => {
  void autonomousTickHandler(broadcast)(req, res);
});

// ─── エージェント承認リクエスト（認証外）──────────────────────────────────
// POST /api/approvals/request は AGENT_TOKEN で独立認証するため auth ミドルウェアの外に置く。
// エージェントが Cookie なしで curl から呼べるようにする（agent-message と同じパターン）。
app.post('/api/approvals/request', (req, res) => {
  approvalRequestHandler(req, res);
});

// ─── エージェント決裁リクエスト（認証外・MC-203）──────────────────────────
// POST /api/decisions/request は AGENT_TOKEN で独立認証するため auth ミドルウェアの外に置く。
// エージェントが選択肢付きの「Keita 決裁依頼」を Cookie なしで curl から投入できる。
app.post('/api/decisions/request', (req, res) => {
  decisionRequestHandler(req, res, broadcast);
});

// ─── token 認証（healthz より後、他ルートより前に適用）──────────
// MC_TOKEN 設定時は /api/* ・SSE ・静的配信 ・SPA fallback すべてを保護する。
app.use(makeAuthMiddleware(HEALTHZ_PATH));

// ─── Web ターミナル（MC-92）── 認証ミドルウェアの「後ろ」に置く ─────
// localhost の ttyd（tmux main = 林 CLI 常駐）へ reverse proxy する。
// ここに来る時点で makeAuthMiddleware を通過済み＝HTTP は認証済みのみ到達。
// WS upgrade は別経路（server.on('upgrade') → attachUpgrade）で同強度の認証を行う。
// ttyd の Basic 認証 credential は proxy が内部付与（TTYD_USER/TTYD_PASS env）。
app.use('/terminal', terminalHttpHandler);

// ─── REST ─────────────────────────────────────────────

/**
 * collector を try/catch で包み、1 つが throw しても 200 で {error} を返す（部分劣化）。
 * build() が undefined を返すか、すでに res が送信済みの場合は追加送信しない
 * （ハンドラ内で 404 等を自前送信したケースに対応）。
 */
function safeJson(res: Response, build: () => unknown): void {
  try {
    const body = build();
    if (res.headersSent || body === undefined) return;
    res.json(body);
  } catch (e) {
    if (res.headersSent) return;
    const message = e instanceof Error ? e.message : String(e);
    console.error('[collector error]', message);
    res.status(200).json({ error: message, generatedAt: new Date().toISOString() });
  }
}

/**
 * async collector 向け版（Promise を待つ）。
 */
async function safeJsonAsync(res: Response, build: () => Promise<unknown>): Promise<void> {
  try {
    const body = await build();
    if (res.headersSent || body === undefined) return;
    res.json(body);
  } catch (e) {
    if (res.headersSent) return;
    const message = e instanceof Error ? e.message : String(e);
    console.error('[collector error]', message);
    res.status(200).json({ error: message, generatedAt: new Date().toISOString() });
  }
}

/**
 * mood 生成の入力集合を組み立てる（MC-165 拡張）。
 * AgentsLive の表示集合に揃える:
 *   - subagent: subagentType 別に「最も稼働中＝active」な代表 1 件を選び、active なものだけ対象にする。
 *   - 秘書: collectSecretaries の active なものを 'secretary:<key>' キーで加える。
 * コスト厳守のため active 以外は含めない（active 0 なら moods collector が claude を呼ばない）。
 */
function buildMoodInputs(): MoodInput[] {
  const inputs: MoodInput[] = [];

  // currentTaskId → 「MC-xxx タイトル」を解決するための索引（doing 具体化の根拠）。
  const taskTitleById = new Map<string, string>();
  for (const t of collectTasks()) taskTitleById.set(t.id, t.title);
  const taskLabel = (taskId?: string): string | undefined => {
    if (!taskId) return undefined;
    const title = taskTitleById.get(taskId);
    return title ? `${taskId} ${title}` : taskId;
  };

  // subagent: subagentType ごとに active な代表を 1 件選ぶ。
  const repByType = new Map<string, { lastAction: string; currentTaskId?: string }>();
  for (const a of collectAgents()) {
    if (a.status !== 'active') continue;
    if (!repByType.has(a.subagentType)) {
      repByType.set(a.subagentType, { lastAction: a.lastAction, currentTaskId: a.currentTaskId });
    }
  }
  for (const [subagentType, rep] of repByType) {
    inputs.push({
      key: subagentType,
      name: subagentType,
      status: 'active',
      lastAction: rep.lastAction,
      currentTask: taskLabel(rep.currentTaskId),
    });
  }

  // 秘書: active なものだけ（OpenClaw セッションが直近で動いている）。
  for (const s of collectSecretaries()) {
    if (s.status !== 'active') continue;
    inputs.push({
      key: `secretary:${s.key}`,
      name: s.name,
      status: 'active',
      lastAction: s.lastAction,
    });
  }

  return inputs;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    claudeProjectsDir: CLAUDE_PROJECTS_DIR,
    vaultDir: VAULT_DIR,
    stallMinutes: STALL_MINUTES,
  });
});

app.get('/api/agents', (req, res) => {
  // ?status=active で稼働中インスタンスのみ返す（AgentsLive 等の軽量化。245件→数件）。
  // 未指定は全件（後方互換。Feed 等が利用）。
  safeJson(res, () => {
    const agents = collectAgents();
    const filtered = req.query.status === 'active'
      ? agents.filter((a) => a.status === 'active')
      : agents;
    return { agents: filtered };
  });
});

// 人格別に集約したエージェント一覧（MC-88）。「エージェント」ビューはこちらを使い、
// 231 件の稼働インスタンスを人格（subagentType）単位の数件に畳んで表示する。
// /api/agents（生インスタンス）は roster/feed が引き続き使うため非破壊で温存。
app.get('/api/agents/grouped', (_req, res) => {
  safeJson(res, () => ({ groups: collectAgentGroups() }));
});

// ─── 秘書レイヤー（Masayoshi / Son、MC-165 拡張）──────────────────────
// OpenClaw 秘書（subagent ログに出ない）を AgentsLive に常時ピン留め表示するための
// ライブ状態。~/.openclaw のセッションログと tmux セッションから read-only で集める（fail-soft）。
app.get('/api/secretaries', (_req, res) => {
  safeJson(res, () => ({ secretaries: collectSecretaries() }));
});

// ─── エージェントの気持ち/思考（mood、MC-165 拡張）────────────────────
// 各 active エージェント/秘書の「今の気持ち＋考えてること」を一人称で返す。
// 全 active ぶんを 1 回のバッチ claude（haiku）で生成し、活動ハッシュでキャッシュ＋最短 5 分スロットル。
// active が 0 なら claude を呼ばず空配列。失敗時は status ベースのフォールバック（claude を呼ばない）。
// 入力は AgentsLive の表示集合（subagentType 別の代表 + 秘書）に揃える。
app.get('/api/agent-moods', (_req, res) => {
  void safeJsonAsync(res, async () => {
    const inputs = buildMoodInputs();
    const moods = await collectMoods(inputs);
    return { moods, generatedAt: new Date().toISOString() };
  });
});

// ─── エージェント spawn（MC-86）──────────────────────────────────
// POST /api/agents/spawn  → headless claude --agent <type> を spawn
// GET  /api/agents/spawn/:id → プロセス状態 + ログ末尾 100 行
// GET  /api/agents/spawn → 全スポーン一覧
// 認証ミドルウェア配下。agentType ホワイトリスト・同時2プロセス上限・30分タイムアウト。
// /api/agents/spawn は :agentId パターンと衝突しないよう :agentId の前に登録する。
app.use('/api/agents/spawn', spawnRouter());

app.get('/api/agents/:agentId/feed', (req, res) => {
  safeJson(res, () => {
    const feed = collectAgentFeed(req.params.agentId);
    if (!feed) {
      res.status(404).json({ error: 'agent not found' });
      return undefined;
    }
    return { agentId: req.params.agentId, feed };
  });
});

// ?scope で返却タスクを絞る（後方互換: 未指定 or all は全件）。
//   open   = 稼働中（TODO/IN_PROGRESS/BLOCKED/REVIEW）のみ。DONE/CANCELLED を除外。
//   closed = DONE/CANCELLED のみ。
// 実データでは DONE+CANCELLED が 99%（689KB の主因）。ライブ tick で毎回パースするのは
// 稼働中だけにし、完了/キャンセルはフロントが必要時のみ closed を遅延読込する設計（MC perf）。
const CLOSED_STATUSES = new Set(['DONE', 'CANCELLED']);

// MC-206: 一覧レスポンスから重い detail（本文 ~840字/件）を除外して軽量版を返す。
// detail は単一タスク取得（GET /api/tasks/:taskId/detail）か、後方互換の ?detail=1 でのみ返す。
function stripDetail(t: ReturnType<typeof collectTasks>[number]) {
  const { detail: _detail, ...light } = t;
  return light;
}

app.get('/api/tasks', (req, res) => {
  safeJson(res, () => {
    const scope = String(req.query.scope ?? 'all');
    // 後方互換: ?detail=1 のときだけ従来どおり detail 付きで返す（既定は detail 無し）。
    const withDetail = String(req.query.detail ?? '') === '1';
    const all = collectTasks();
    let tasks = all;
    if (scope === 'open') tasks = all.filter((t) => !CLOSED_STATUSES.has(t.status));
    else if (scope === 'closed') tasks = all.filter((t) => CLOSED_STATUSES.has(t.status));
    return { tasks: withDetail ? tasks : tasks.map(stripDetail) };
  });
});

// MC-206: 単一タスクのフル取得（detail 含む）。一覧は detail を返さないため、
// TaskDetail がカードを開いた時にここから本文を遅延取得する。
// パスは `/:taskId/detail` とし、taskEditRouter の固定パス（/hash・/edit）や
// `:taskId/links`・`:taskId/timeline` と衝突しないようにする。
app.get('/api/tasks/:taskId/detail', (req, res) => {
  safeJson(res, () => {
    const id = req.params.taskId;
    // source 指定があれば source+id で厳密一致、無ければ id 一致の先頭。
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const all = collectTasks();
    const task =
      (source ? all.find((t) => t.id === id && t.source === source) : undefined) ??
      all.find((t) => t.id === id);
    if (!task) {
      res.status(404).json({ error: 'task not found', id });
      return undefined;
    }
    return { task };
  });
});

// ─── タスク↔workflow/agent 明示リンク（MC-62）────────────────────
// data/task-links.jsonl（明示ログ・正本）を読み、指定タスクに紐づく
// workflow run（/api/workflows のサマリと突合）と agent 会話を返す。
// 明示リンクが 0 件なら runs/agentIds とも空配列（フロントが従来フォールバックする）。
// 認証ミドルウェア配下。ファイル無し・壊れ行は collector 側で吸収して空で返す。
app.get('/api/tasks/:taskId/links', (req, res) => {
  safeJson(res, () => {
    const set = linksForTask(req.params.taskId);
    // 突合: 明示リンクの runId に対応する WorkflowSummary を /api/workflows から引く。
    // 明示リンクにあるが run が存在しない（消えた/別環境）場合は runId だけ返す。
    const summaries = collectWorkflows();
    const byRunId = new Map(summaries.map((s) => [s.runId, s]));
    const runs = set.runIds.map((runId) => ({
      runId,
      // 突合できた run はサマリ付き、できなければ null（UI 側で runId のみ表示）。
      summary: byRunId.get(runId) ?? null,
    }));
    return {
      taskId: set.taskId,
      hasExplicitLinks: set.links.length > 0,
      runs,
      agentIds: set.agentIds,
      links: set.links,
      generatedAt: new Date().toISOString(),
    };
  });
});

// ─── タスク活動タイムライン（MC-163）────────────────────────────
// GET /api/tasks/:taskId/timeline → 当該タスクの活動履歴イベント配列
// TASK_TRACKER note をパース + git log grep で時系列イベントを集約。
app.get('/api/tasks/:taskId/timeline', (req, res) => {
  void safeJsonAsync(res, async () => {
    return await collectTimeline(req.params.taskId, CLAUDE_PROJECTS_DIR);
  });
});

// ─── タスク手動編集（MC-71 edit スライス）────────────────────────
// GET /api/tasks/hash?source=... → 楽観ロック用ハッシュ
// POST /api/tasks/edit { source, id, patch, baseHash? } → 正本 .md へ安全書き戻し
// 既存 /api/tasks・/api/tasks/:taskId/links の後に mount（auth ミドルウェア配下）。
// '/hash' '/edit' は :taskId パターンと衝突しない固定パス。
app.use('/api/tasks', taskEditRouter());

app.get('/api/narrative', (_req, res) => {
  safeJson(res, () => collectNarrative());
});

app.get('/api/roster', (_req, res) => {
  safeJson(res, () => ({ roster: collectRoster() }));
});

// ─── Alerts（通知/アラート バッジ MC-63）──────────────────────────
// ERROR（workflow error run）・長期 BLOCKED（BLOCKED_STALL_DAYS 超）・deploy 失敗（MC-64 連携・現状空）
// を既存 collector（workflows / tasks）から集計して返す。新規ログ解析を足さず二重通知を避ける。
// 認証ミドルウェア（makeAuthMiddleware）配下。0 件でも 200・解消すると次回集計で消える（永続なし）。
app.get('/api/alerts', (_req, res) => {
  safeJson(res, () => collectAlerts());
});

// ─── 承認フロー（MC-79）──────────────────────────────────────
// GET /api/approvals で Keita の承認/確認が要る項目を集約（BLOCKED 設計判断・デプロイ可否・
// 設計判断/承認待ち/要確認タグ）。REVIEW/DONE/CANCELLED は常に除外。
// POST /api/approvals/:taskId/approve・/reject は MC-71 の安全書き戻し層を再利用して
// 正本 .md へ status 遷移（approve→TODO / reject→CANCELLED）＋承認決定を監査 JSONL に記録。
// 認証ミドルウェア配下。alerts(blocked-stalled) とは別軸の独立集計（二重集計しない）。
app.use('/api/approvals', approvalRouter());

// GET /api/decisions で Keita 決裁（選択肢付き）を集約。POST /api/decisions/:id/decide で
// 1 つ選んで決裁し、結果を要求元エージェントへ notify 配送する（MC-203。承認とは別系統・別タブ）。
app.use('/api/decisions', decisionRouter(broadcast));

// ─── 収益コックピット（2026-07-19）──────────────────────────────
// GET /api/revenue/summary — ClipItNow(:4319 stats/exostats/adstats) +
// PDCA 状態を 1 レスポンスに集約。上流 1 ソース死んでも部分データで返す（fail-soft）。
// 60 秒メモリキャッシュ。認証ミドルウェア配下。
app.use('/api/revenue', revenueRouter());

app.get('/api/usage', (_req, res) => {
  safeJson(res, () => collectUsage());
});

// ─── Claude プラン使用量（MC-122）──────────────────────────────
// 各 Claude アカウント（local=この箱 / oldbox=旧箱 SSH）の OAuth usage/profile を取得し、
// 現在のセッション(5h)/週間(全モデル)/週間(Sonnet) の % とリセット時刻を返す。
// 認証ミドルウェア（makeAuthMiddleware）配下。OAuth usage は 429 制約があるため
// collector 側で CLAUDE_USAGE_TTL_MS（既定 180 秒）強キャッシュ。取得失敗・429・SSH 不通でも
// アカウント単位の error に畳んで 200 で部分劣化（collector が全例外を吸収）。
app.get('/api/claude-usage', (_req, res, next) => {
  collectClaudeUsage()
    .then((data) => {
      if (!res.headersSent) res.json(data);
    })
    .catch(next);
});

// ─── ターミナル使用量サマリ（Claude1/Claude2 集計）──────────────
// 各ターミナルのアカウントバッジ自動切替（使用量ベース）用に、Claude1（local）/
// Claude2（oldbox）の現在セッション(5h)使用率を { used, limit, remaining } 形へ整形して返す。
// 内部で collectClaudeUsage() を再利用（180s 強キャッシュ）するため 429 を増やさない。
// 取得失敗・error 要素はダミー { used: 0, limit: 100, remaining: 100 } に畳んで常に 200 で返す。
app.get('/api/terminal/usage-summary', (_req, res, next) => {
  collectClaudeUsage()
    .then((data) => {
      const toBucket = (key: 'local' | 'oldbox') => {
        const acc = data.accounts.find((a) => a.key === key);
        // error または pct 不明はダミー（残量 100 = フル扱い）にフォールバック。
        if (!acc || acc.error || acc.session.pct === null) {
          return { used: 0, limit: 100, remaining: 100 };
        }
        const used = Math.max(0, Math.min(100, Math.round(acc.session.pct)));
        return { used, limit: 100, remaining: 100 - used };
      };
      if (!res.headersSent) {
        res.json({
          claude1: toBucket('local'),
          claude2: toBucket('oldbox'),
        });
      }
    })
    .catch(() => {
      // 取得自体に失敗してもダミーで 200（UI を落とさない）。
      if (!res.headersSent) {
        res.json({
          claude1: { used: 0, limit: 100, remaining: 100 },
          claude2: { used: 0, limit: 100, remaining: 100 },
        });
      }
      void next;
    });
});

// ─── Deploys（deploy 連動 MC-64）──────────────────────────────
// GitHub Actions の deploy 系 workflow（logic: deploy-production / android-deploy、
// en-chakai: deploy-production）の直近 run 状態を gh CLI で取得し、TaskDetail に表示する。
// 認証ミドルウェア（makeAuthMiddleware）配下。gh 不在・未認証・レート・タイムアウト・
// parse 失敗でも repo 単位の空配列+error で 200 を返し（collector 側 fallback）、Apollo を落とさない。
// 5 分キャッシュ（usage と同方式）で GitHub API レート対策。対象 repo は config.DEPLOY_REPOS に集約。
app.get('/api/deploys', (_req, res) => {
  safeJson(res, () => collectDeploys());
});

// ─── Ticks（autonomous ループのティック可視化 MC-65）────────────────
// 自律ループが追記する ~/logs/autonomous-*.log を末尾読みで解析し、直近ティック
// （スコープ × 選んだタスク × 結果）を返す。認証ミドルウェア（makeAuthMiddleware）配下。
// ファイル不在・空・壊れ行・自由文でも例外を投げず空配列で 200（collector 側 fail-soft）。
// TICKS_TTL_MS（既定 30 秒）キャッシュ。?scope=cxo|logic 等で任意フィルタ。
app.get('/api/ticks', (req, res) => {
  safeJson(res, () => {
    const scope = typeof req.query.scope === 'string' && req.query.scope.trim() !== ''
      ? req.query.scope.trim()
      : undefined;
    return collectTicks(scope);
  });
});

// ─── ClipItNow PDCA 永続ループの状態（2026-07-19）──────────────────
// 林の cron スクリプトが $HOME/logs/clipitnow-pdca-state.json にサイクル状態を書く。
// Apollo は read-only で参照するだけ（書かない）。認証ミドルウェア配下。
// ファイルが無い/壊れている場合も 200 で安全なデフォルトを返す（500 にしない）。
app.get('/api/clipitnow/pdca', (_req, res) => {
  safeJson(res, () => {
    const fallback = { cycle: 0, phase: 'unknown', pendingApprovalId: '', lastReportDate: null };
    if (!existsSync(CLIPITNOW_PDCA_STATE_FILE)) return fallback;
    try {
      const raw = readFileSync(CLIPITNOW_PDCA_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      return fallback;
    } catch {
      return fallback;
    }
  });
});

// ─── ClipItNow PDCA レポート一覧・本文（MC-327 2026-07-20 Keita「レポートをPDCAタブから見たい」）───
// cron（report/do）と Son が Vault の reports/ に書く markdown を read-only で配信する。
// config.ts は共有WIP中のため定数はここに置く（env CLIPITNOW_PDCA_REPORTS_DIR で差し替え可）。
const CLIPITNOW_PDCA_REPORTS_DIR = process.env.CLIPITNOW_PDCA_REPORTS_DIR
  ?? join(process.env.DATA_HOME ?? '/home/dev', 'projects', 'obsidian-vault', '30-Projects', 'videodl', 'reports');
app.get('/api/clipitnow/pdca/reports', (_req, res) => {
  safeJson(res, () => {
    if (!existsSync(CLIPITNOW_PDCA_REPORTS_DIR)) return { reports: [] };
    const reports = readdirSync(CLIPITNOW_PDCA_REPORTS_DIR)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .map((f) => {
        const st = statSync(join(CLIPITNOW_PDCA_REPORTS_DIR, f));
        return {
          name: f,
          // pdca-do-*=Do実行結果 / それ以外（pdca-report-*）=夜のCheckレポート
          kind: f.startsWith('pdca-do') ? 'do' : 'report',
          mtime: st.mtime.toISOString(),
          size: st.size,
        };
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    return { reports };
  });
});
app.get('/api/clipitnow/pdca/reports/:name', (req, res) => {
  safeJson(res, () => {
    const name = String(req.params.name ?? '');
    // パストラバーサル拒否: basename一致・.mdのみ
    if (!name.endsWith('.md') || name !== basename(name) || name.startsWith('.')) {
      return { name, content: '', error: 'not found' };
    }
    const fp = join(CLIPITNOW_PDCA_REPORTS_DIR, name);
    if (!existsSync(fp)) return { name, content: '', error: 'not found' };
    return { name, content: readFileSync(fp, 'utf-8') };
  });
});

// ─── 横断検索（MC-73）──────────────────────────────────────
// GET /api/search?q=... で タスク / エージェント / 会話 / workflow / Vault を横断検索する。
// 認証ミドルウェア（makeAuthMiddleware）配下。既存 collector を流用し二重定義しない。
// 空クエリ・0 ヒットでもクラッシュせずカテゴリ別に空配列を返す。
// 大量ヒットは各カテゴリ上限（SEARCH_CATEGORY_LIMIT）+ totals で保護する。
app.get('/api/search', (req, res) => {
  safeJson(res, () => search(String(req.query.q ?? '')));
});

// ─── Workflows（MC-60）────────────────────────────────────
// /workflows ツールが作る wf_* run を解析して run 一覧 / 1 run 詳細を返す。
// 認証ミドルウェア（makeAuthMiddleware）配下。run 0 件でも空配列で 200。
app.get('/api/workflows', (_req, res) => {
  safeJson(res, () => ({ workflows: collectWorkflows() }));
});

app.get('/api/workflows/:runId', (req, res) => {
  safeJson(res, () => {
    const detail = collectWorkflowDetail(req.params.runId);
    if (!detail) {
      res.status(404).json({ error: 'workflow run not found' });
      return undefined;
    }
    return detail;
  });
});

// ─── Inbox（非同期 指示受信箱）──────────────────────────────
// Keita がスマホから投入したタスク/指示 + 画像添付を受け、自律林が次ティックで拾う。
// auth ミドルウェア配下。POST=multipart 投入 / GET=pending 一覧 / GET attachment=画像配信。
app.use('/api/inbox', inboxRouter());

// ─── ターミナル画像アップロード（MC-95）──────────────────────────
// Apollo のターミナルビューから画像を添付し、tmux main（林 CLI）の入力欄へ
// 保存先の絶対パスを send-keys でリテラル注入する（自動 Enter なし）。林はそのパスを
// Read で画像として読める。auth ミドルウェア配下＝Cookie 必須。POST /api/terminal/upload。
app.use('/api/terminal', terminalUploadRouter());

// ─── ターミナルバックエンド復旧（MC-100）──────────────────────────
// PC のターミナルが切断（tmux main 消失 / ttyd 停止）された後に、ブラウザの
// 「ターミナルを開始」ボタンから tmux main（林 CLI）と ttyd を冪等に復旧する。
// auth ミドルウェア配下＝Cookie 必須。GET /api/terminal/status・POST /api/terminal/start。
app.use('/api/terminal', terminalControlRouter());

// ─── Vault（Obsidian 一元化ビュー・read-only）────────────────────
// すべてのパス入力は collectors/vault → lib/vaultPath で安全化される。
// SafePathError（パストラバーサル等）は 400 で拒否する。

/** SafePathError を 400 にマップしつつ collector を実行する。 */
function safeVault(res: Response, build: () => unknown): void {
  try {
    const body = build();
    if (res.headersSent || body === undefined) return;
    res.json(body);
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof SafePathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error('[vault error]', message);
    res.status(200).json({ error: message, generatedAt: new Date().toISOString() });
  }
}

// 書き込み（ノート作成 / ファイルアップロード）。GET と method が異なるため共存可能。
// 書き込み後 VAULT_DIR で自動 git commit+push する（push 失敗時もファイルは保存・201）。
app.use('/api/vault', vaultWriteRouter());

app.get('/api/vault/tree', (_req, res) => {
  safeVault(res, () => ({ generatedAt: new Date().toISOString(), tree: buildTree() }));
});

app.get('/api/vault/note', (req, res) => {
  safeVault(res, () => {
    const note = readNote(String(req.query.path ?? ''));
    if (!note) {
      res.status(404).json({ error: 'note not found' });
      return undefined;
    }
    return note;
  });
});

app.get('/api/vault/search', (req, res) => {
  safeVault(res, () => ({
    query: String(req.query.q ?? ''),
    results: searchVault(String(req.query.q ?? '')),
  }));
});

app.get('/api/vault/attachment', (req, res) => {
  try {
    const info = resolveAttachment(String(req.query.path ?? ''));
    if (!info) {
      res.status(404).json({ error: 'attachment not found' });
      return;
    }
    res.type(info.contentType);
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(info.absPath);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── 成果物（Excel/PPT/PDF/CSV/画像/テキスト の閲覧・DL）─────────────
// すべてのパス入力は collectors/deliverables → lib/deliverablePath で安全化される。
// 認証ミドルウェア配下（Vault と同じ並び）。

// 成果物アップロード（MC-118）。multipart files[] を DELIVERABLES_DIR へ diskStorage で
// ストリーム保存する（大容量はメモリに載せない）。POST /api/deliverables/upload。
// GET 系（/api/deliverables・/file・/preview）とは method が異なるため共存する。
// :id パターンを持たないので登録順の衝突も無い。
app.use('/api/deliverables', deliverableUploadRouter());

// 成果物チャンクアップロード（cloudflared ~100MB 制限対策）。
// 50MB 超のファイルをフロントが 20MB ずつに分割して POST する。
// POST /api/deliverables/upload-chunk
app.use('/api/deliverables', deliverableChunkRouter());

app.get('/api/deliverables', (_req, res) => {
  try {
    // MC-234: 一覧取得のタイミングでゴミ箱の自動パージを試行する（throttle 内蔵・例外は握りつぶす）。
    purgeTrashIfDue();
    res.json({ generatedAt: new Date().toISOString(), files: listDeliverables() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[deliverables error]', message);
    res.status(200).json({ error: message, generatedAt: new Date().toISOString(), files: [] });
  }
});

// ─── 成果物メタ（スター/タグ/色ラベル）（MC-238）─────────────────────
// サイドカー store（data/deliverables-meta.json）を relpath キーで読み書きする。
// GET: 全メタを { meta: { relpath: {starred,tags,color} } } で返す。
// PUT: 1 アイテムのメタを設定する（body: { path, starred?, tags?, color? }）。
//      path は deliverablePath で範囲検証（data/deliverables 外不可）。
app.get('/api/deliverables/meta', (_req, res) => {
  try {
    res.json({ generatedAt: new Date().toISOString(), meta: getAllMeta() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[deliverables meta list error]', message);
    res.status(200).json({ error: message, generatedAt: new Date().toISOString(), meta: {} });
  }
});

app.put('/api/deliverables/meta', (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const relpath = String(body.path ?? '');
    if (!relpath) { res.status(400).json({ error: 'path required' }); return; }
    // 範囲検証（traversal/範囲外→SafePathError）。実在チェックはしない（フォルダにも付与可）。
    const abs = resolveDeliverablePath(relpath);
    const safeRel = toDeliverableRelative(abs);
    const meta = setMeta(safeRel, {
      starred: body.starred,
      tags: body.tags,
      color: body.color,
    });
    res.json({ ok: true, relpath: safeRel, meta });
  } catch (e) {
    if (e instanceof SafePathError) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ファイル名を RFC5987（filename*）でエンコードする（日本語ファイル名対応）。
function contentDisposition(name: string, inline: boolean): string {
  const disp = inline ? 'inline' : 'attachment';
  // ASCII フォールバック用に非 ASCII を _ に落とす。
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${disp}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// PUT /api/deliverables/file — 成果物ファイルをテキストで上書き保存する。
// 議事録.md を保存する場合は、同フォルダ内の .docx / .xlsx も自動再生成する。
app.put('/api/deliverables/file', async (req, res) => {
  try {
    const relpath = String((req.body as Record<string, unknown>)?.path ?? '');
    const content = String((req.body as Record<string, unknown>)?.content ?? '');
    if (!relpath) { res.status(400).json({ error: 'path required' }); return; }
    const abs = resolveDeliverablePath(relpath);
    const { writeFileSync, existsSync: fsExists, readdirSync: fsReaddir } = require('node:fs') as typeof import('node:fs');
    if (!fsExists(abs)) { res.status(404).json({ error: 'file not found' }); return; }
    writeFileSync(abs, content, 'utf-8');

    // 議事録.md を保存した場合、同フォルダの .docx / .xlsx を再生成する
    const fileName = basename(abs);
    if (fileName === '議事録.md' || fileName.endsWith('_議事録.md')) {
      const folder = dirname(abs);
      const title = fileName.replace(/\.md$/, '');
      try {
        const siblings = fsReaddir(folder);
        for (const sib of siblings) {
          const ext = sib.endsWith('.docx') ? 'docx' : sib.endsWith('.xlsx') ? 'xlsx' : null;
          if (!ext || !sib.startsWith('議事録')) continue;
          try {
            const { buffer } = await exportMinutes(content, ext as 'docx' | 'xlsx', title);
            writeFileSync(join(folder, sib), buffer);
          } catch (exportErr) {
            console.warn(`[put-deliverable] re-export ${sib} failed:`, exportErr instanceof Error ? exportErr.message : exportErr);
          }
        }
      } catch {
        // 再エクスポート失敗はサイレント（.md保存は成功済み）
      }
    }

    res.json({ ok: true, relpath: toDeliverableRelative(abs) });
  } catch (e) {
    if (e instanceof SafePathError) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/deliverables/file', (req, res) => {
  try {
    const info = resolveDeliverable(String(req.query.path ?? ''));
    if (!info) {
      res.status(404).json({ error: 'deliverable not found' });
      return;
    }
    const inline = req.query.inline === '1' || req.query.inline === 'true';
    res.type(info.contentType);
    res.set('Content-Disposition', contentDisposition(info.name, inline));
    res.set('Cache-Control', 'private, max-age=60');
    res.sendFile(info.absPath);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// 成果物プレビュー: ブラウザ内（iframe）でそのまま見られる形にして inline 返す。
//  - pdf/image/text/markdown 等「そのまま見られるもの」は file?inline=1 に委譲（ここでは元実体を inline 返し）。
//  - spreadsheet/presentation/document（Office 系）は LibreOffice で PDF 変換してから inline 返す。
//    変換は数秒かかるが、2 回目以降はキャッシュで即返す。
app.get('/api/deliverables/preview', async (req, res) => {
  try {
    const info = resolveDeliverable(String(req.query.path ?? ''));
    if (!info) {
      res.status(404).json({ error: 'deliverable not found' });
      return;
    }

    // Office 系は PDF 変換してプレビュー。
    if (isConvertibleToPdf(info.ext)) {
      let pdfPath: string;
      try {
        pdfPath = await convertOfficeToPdf(info.absPath);
      } catch (convErr) {
        const message = convErr instanceof Error ? convErr.message : String(convErr);
        console.error('[deliverables preview convert error]', info.name, message);
        res.status(502).json({ error: 'preview conversion failed', detail: message });
        return;
      }
      // プレビュー用のファイル名は元ファイル名ベースで .pdf に。
      const pdfName = info.name.replace(/\.[^.]+$/, '') + '.pdf';
      res.type('application/pdf');
      res.set('Content-Disposition', contentDisposition(pdfName, true));
      res.set('Cache-Control', 'private, max-age=60');
      // キャッシュ dir 名（.deliverables-cache）が dotfile セグメントを含むため allow を明示。
      res.sendFile(pdfPath, { dotfiles: 'allow' });
      return;
    }

    // それ以外（pdf/image/text/markdown 等）はそのまま inline 返し。
    res.type(info.contentType);
    res.set('Content-Disposition', contentDisposition(info.name, true));
    res.set('Cache-Control', 'private, max-age=60');
    res.sendFile(info.absPath);
  } catch (e) {
    if (e instanceof SafePathError) {
      res.status(400).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// 成果物の削除（MC-125 → MC-230 でゴミ箱方式に変更）。
//  ?path=<相対パス> のファイル/フォルダを DELIVERABLES_DIR/.trash/ へ退避する（物理削除しない）。
//  - パス解決は deliverablePath（realpath / traversal 防御）を流用。範囲外/不正は SafePathError→400。
//  - README.md は一覧の説明用なので保護（削除拒否＝403）。
//  - ファイル・フォルダ両方を退避できる（フォルダは中身ごと .trash へ move）。
//  - 実体が無ければ 404。
//  - 対応する変換キャッシュ（.deliverables-cache の PDF）があれば併せて消す（残骸防止、無ければ無視）。
//  - 応答 { ok, deleted, trashId }。trashId は Undo（即時復元）に使う退避バッチ ID。
app.delete('/api/deliverables/file', (req, res) => {
  try {
    const abs = resolveDeliverablePath(String(req.query.path ?? '')); // traversal/範囲外→SafePathError
    const relpath = toDeliverableRelative(abs);

    // README.md（ビューの説明用）は保護。basename を小文字比較で弾く。
    if (basename(abs).toLowerCase() === 'readme.md') {
      res.status(403).json({ error: 'this file is protected and cannot be deleted' });
      return;
    }

    if (!existsSync(abs)) {
      res.status(404).json({ error: 'deliverable not found' });
      return;
    }
    let st;
    try {
      st = statSync(abs);
    } catch {
      res.status(404).json({ error: 'deliverable not found' });
      return;
    }
    const isDir = st.isDirectory();
    const isFile = st.isFile();
    if (!isDir && !isFile) {
      // symlink 先非ファイル/非ディレクトリ等は対象外。
      res.status(400).json({ error: 'only files and folders can be deleted' });
      return;
    }

    // 変換キャッシュは「ソース実体がまだ在る間」にキーを算出して消す（move より前）。
    if (isFile) {
      try {
        deleteOfficePdfCache(abs);
      } catch {
        /* キャッシュ削除失敗は本体退避を妨げない（残骸防止はベストエフォート）。 */
      }
    }

    // ゴミ箱へ退避（物理削除しない）。退避先 <trash>/<batchId>/<元の相対パス>。
    const { batchId, destAbs, originalRel } = makeTrashTarget(relpath);
    mkdirSync(dirname(destAbs), { recursive: true });
    renameSync(abs, destAbs);
    // メタ情報（復元先・元名・削除時刻）を退避バッチ直下に記録する。
    try {
      writeFileSync(
        join(trashRoot(), batchId, '.trashinfo.json'),
        JSON.stringify({
          originalRel,
          name: basename(originalRel),
          isDir,
          deletedAt: new Date().toISOString(),
        }),
        'utf-8',
      );
    } catch {
      /* メタ記録失敗は退避自体を妨げない（復元時に originalRel をパスから推定可能）。 */
    }

    // MC-238: サイドカーメタ（スター/タグ/色）を trashId 配下へ退避（復元で再付与・パージで破棄）。
    try { trashMeta(relpath, batchId); } catch { /* メタ退避失敗は本体退避を妨げない。 */ }

    res.json({ ok: true, deleted: relpath, trashId: batchId });
  } catch (e) {
    if (e instanceof SafePathError) {
      // 範囲外・不正パス・禁止セグメント。空 path は 'path is required'。
      res.status(400).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── ゴミ箱（MC-230）一覧・復元・完全削除 ───────────────────────────
// 退避バッチ（<trash>/<batchId>/）を列挙し、各バッチの .trashinfo.json を読んで
// originalRel / name / deletedAt を返す。復元は元の場所へ戻し、完全削除は物理 rm する。

interface TrashEntryMeta {
  trashId: string;
  name: string;
  originalRel: string;
  isDir: boolean;
  deletedAt: string;
  sizeBytes: number;
}

/** 退避バッチ内の実体（.trashinfo.json を除いた最初のエントリ）の絶対パスを返す。 */
function trashBatchPayloadAbs(batchId: string, originalRel: string): string {
  return join(trashRoot(), batchId, originalRel);
}

/** 退避バッチ 1 件のメタを読む。壊れていれば null。 */
function readTrashBatch(batchId: string): TrashEntryMeta | null {
  const infoPath = join(trashRoot(), batchId, '.trashinfo.json');
  try {
    const raw = JSON.parse(readFileSync(infoPath, 'utf-8')) as {
      originalRel?: unknown;
      name?: unknown;
      isDir?: unknown;
      deletedAt?: unknown;
    };
    const originalRel = typeof raw.originalRel === 'string' ? raw.originalRel : '';
    if (!originalRel) return null;
    const payloadAbs = trashBatchPayloadAbs(batchId, originalRel);
    let sizeBytes = 0;
    try {
      const st = statSync(payloadAbs);
      sizeBytes = st.isFile() ? st.size : 0;
    } catch {
      /* 実体が消えていてもメタは返す（破損ケース）。 */
    }
    return {
      trashId: batchId,
      name: typeof raw.name === 'string' ? raw.name : basename(originalRel),
      originalRel,
      isDir: raw.isDir === true,
      deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : '',
      sizeBytes,
    };
  } catch {
    return null;
  }
}

// GET /api/deliverables/trash — ゴミ箱の一覧（新しい削除順）。
app.get('/api/deliverables/trash', (_req, res) => {
  try {
    const root = trashRoot();
    if (!existsSync(root)) {
      res.json({ generatedAt: new Date().toISOString(), entries: [] });
      return;
    }
    const batches = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => readTrashBatch(d.name))
      .filter((e): e is TrashEntryMeta => e !== null)
      .sort((a, b) => Date.parse(b.deletedAt || '0') - Date.parse(a.deletedAt || '0'));
    res.json({ generatedAt: new Date().toISOString(), entries: batches });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[deliverables trash list error]', message);
    res.status(200).json({ error: message, generatedAt: new Date().toISOString(), entries: [] });
  }
});

// POST /api/deliverables/trash/restore — 退避バッチを元の場所へ戻す（Undo / ゴミ箱からの復元）。
//  body: { trashId: string }。元の場所に同名が在れば衝突回避サフィックスを付けて戻す。
app.post('/api/deliverables/trash/restore', (req, res) => {
  try {
    const trashId = String((req.body as Record<string, unknown>)?.trashId ?? '');
    if (!trashId) { res.status(400).json({ error: 'trashId required' }); return; }
    const meta = readTrashBatch(trashId);
    if (!meta) { res.status(404).json({ error: 'trash entry not found' }); return; }

    // 退避実体（バッチ内パス）と復元先（DELIVERABLES_DIR 内パス）の双方を厳格検証。
    const srcAbs = resolveTrashPath(join(trashId, meta.originalRel));
    if (!existsSync(srcAbs)) { res.status(404).json({ error: 'trash payload missing' }); return; }

    // 復元先: 元の相対パス。同名が在れば衝突回避（-2, -3 …）。
    let destRel = meta.originalRel;
    let destAbs = resolveDeliverablePath(destRel);
    if (existsSync(destAbs)) {
      const ext = extname(meta.name);
      const stem = ext ? meta.name.slice(0, -ext.length) : meta.name;
      const parentRel = meta.originalRel.includes('/')
        ? meta.originalRel.slice(0, meta.originalRel.lastIndexOf('/'))
        : '';
      let resolved = false;
      for (let n = 2; n < 1000; n += 1) {
        const candidateName = meta.isDir ? `${meta.name}-${n}` : `${stem}-${n}${ext}`;
        const candidateRel = parentRel ? `${parentRel}/${candidateName}` : candidateName;
        const candidateAbs = resolveDeliverablePath(candidateRel);
        if (!existsSync(candidateAbs)) {
          destRel = candidateRel;
          destAbs = candidateAbs;
          resolved = true;
          break;
        }
      }
      if (!resolved) { res.status(409).json({ error: 'restore target is occupied' }); return; }
    }

    mkdirSync(dirname(destAbs), { recursive: true });
    renameSync(srcAbs, destAbs);
    // 退避バッチ（空になったフォルダ＋メタ）を物理削除する。
    try { rmSync(join(trashRoot(), trashId), { recursive: true, force: true }); } catch { /* best-effort */ }

    const restoredRel = toDeliverableRelative(destAbs);
    // MC-238: 退避していたメタを復元先パスへ再付与（衝突回避でリネームされていても追従）。
    try { restoreMeta(trashId, meta.originalRel, restoredRel); } catch { /* メタ復元失敗は本体復元を妨げない。 */ }

    res.json({ ok: true, restored: restoredRel });
  } catch (e) {
    if (e instanceof SafePathError) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /api/deliverables/trash?trashId=<id> — ゴミ箱から完全削除（物理）。
//  trashId 省略時は全削除（ゴミ箱を空にする）。
app.delete('/api/deliverables/trash', (req, res) => {
  try {
    const root = trashRoot();
    const trashId = String(req.query.trashId ?? '');
    if (trashId) {
      // バッチフォルダを trashRoot 配下に限定検証してから物理削除。
      const batchAbs = resolveTrashPath(trashId);
      // バッチ直下（trashId 単体）であることを確認（中の実体パスではなくフォルダを指す）。
      if (toTrashRelative(batchAbs).includes('/')) {
        res.status(400).json({ error: 'invalid trashId' });
        return;
      }
      if (!existsSync(batchAbs)) { res.status(404).json({ error: 'trash entry not found' }); return; }
      rmSync(batchAbs, { recursive: true, force: true });
      // MC-238: 退避メタも破棄。
      try { purgeTrashMeta(trashId); } catch { /* best-effort */ }
      res.json({ ok: true, purged: trashId });
      return;
    }
    // 全削除: trashRoot 配下の各バッチを物理削除（trashRoot 自体は残す）。
    if (existsSync(root)) {
      for (const d of readdirSync(root, { withFileTypes: true })) {
        if (d.isDirectory()) {
          try { rmSync(join(root, d.name), { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      }
    }
    // MC-238: 退避メタを全破棄。
    try { purgeTrashMeta(); } catch { /* best-effort */ }
    res.json({ ok: true, purged: 'all' });
  } catch (e) {
    if (e instanceof SafePathError) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── リネーム（MC-227）──────────────────────────────────────
// POST /api/deliverables/rename — ファイル/フォルダを同じ親内で改名する。
//  body: { path: string（DELIVERABLES_DIR 相対）, newName: string（basename のみ） }
//  - path 解決は deliverablePath（realpath / traversal 防御）。範囲外/不正は SafePathError→400。
//  - newName は validateRenameName で basename 限定・ドット始まり/FS禁止文字拒否。
//  - README.md は保護（改名拒否＝403）。
//  - 改名先に同名が既に在れば 409（衝突拒否）。実体が無ければ 404。
app.post('/api/deliverables/rename', (req, res) => {
  try {
    const relpath = String((req.body as Record<string, unknown>)?.path ?? '');
    const newNameRaw = (req.body as Record<string, unknown>)?.newName;
    if (!relpath) { res.status(400).json({ error: 'path required' }); return; }

    const srcAbs = resolveDeliverablePath(relpath); // traversal/範囲外→SafePathError
    if (!existsSync(srcAbs)) { res.status(404).json({ error: 'deliverable not found' }); return; }

    // README.md（ビューの説明用）は保護。
    if (basename(srcAbs).toLowerCase() === 'readme.md') {
      res.status(403).json({ error: 'this file is protected and cannot be renamed' });
      return;
    }

    const safeName = validateRenameName(newNameRaw); // 不正名→SafePathError(400)
    const { destAbs, destRel } = resolveRenameTarget(srcAbs, safeName);

    // 改名先が同一実体（大文字小文字のみ違い等）なら no-op として成功扱い。
    if (destAbs === srcAbs) {
      res.json({ ok: true, relpath: toDeliverableRelative(srcAbs) });
      return;
    }
    if (existsSync(destAbs)) {
      res.status(409).json({ error: '同名のファイルまたはフォルダが既に存在します。' });
      return;
    }

    // 変換キャッシュは旧パス基準で残るため、ファイル改名時は旧キャッシュを掃除しておく。
    try {
      const st = statSync(srcAbs);
      if (st.isFile()) deleteOfficePdfCache(srcAbs);
    } catch {
      /* キャッシュ掃除失敗は改名を妨げない。 */
    }

    const oldRel = toDeliverableRelative(srcAbs);
    renameSync(srcAbs, destAbs);
    // MC-238: メタのキーを追従移行（フォルダは配下キーも移行）。
    try { moveMeta(oldRel, destRel); } catch { /* メタ移行失敗は改名を妨げない。 */ }
    res.json({ ok: true, relpath: destRel });
  } catch (e) {
    if (e instanceof SafePathError) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── 移動（MC-228）──────────────────────────────────────
// POST /api/deliverables/move — ファイル/フォルダを別フォルダへ移動する。
//  body: { path: string（移動元、DELIVERABLES_DIR 相対）, destDir: string（移動先フォルダ、相対 or ''＝ルート直下） }
//  - path / destDir 解決は deliverablePath（realpath / traversal 防御）。範囲外/不正は SafePathError→400。
//  - README.md は保護（移動拒否＝403）。
//  - 親→子の循環移動（フォルダを自分自身/子孫の中へ）は resolveMoveTarget が SafePathError→400。
//  - 移動先に同名が既に在れば 409（衝突拒否）。移動元/移動先フォルダが無ければ 404。
app.post('/api/deliverables/move', (req, res) => {
  try {
    const relpath = String((req.body as Record<string, unknown>)?.path ?? '');
    const destDirRaw = (req.body as Record<string, unknown>)?.destDir;
    if (!relpath) { res.status(400).json({ error: 'path required' }); return; }

    const srcAbs = resolveDeliverablePath(relpath); // traversal/範囲外→SafePathError
    if (!existsSync(srcAbs)) { res.status(404).json({ error: 'deliverable not found' }); return; }

    // README.md（ビューの説明用）は保護。
    if (basename(srcAbs).toLowerCase() === 'readme.md') {
      res.status(403).json({ error: 'this file is protected and cannot be moved' });
      return;
    }

    // 移動先フォルダ（'' or '/' はルート直下）。実在するディレクトリであること。
    const destDirAbs = resolveDeliverableDir(destDirRaw);
    if (!existsSync(destDirAbs)) { res.status(404).json({ error: 'destination folder not found' }); return; }
    try {
      if (!statSync(destDirAbs).isDirectory()) {
        res.status(400).json({ error: 'destination is not a folder' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'destination folder not found' });
      return;
    }

    // 循環移動防止・ルート外検証は resolveMoveTarget が担う（SafePathError→400）。
    const { destAbs, destRel } = resolveMoveTarget(srcAbs, destDirAbs);

    // 移動先が移動元と同一（既にそのフォルダ直下に在る）なら no-op として成功扱い。
    if (destAbs === srcAbs) {
      res.json({ ok: true, relpath: toDeliverableRelative(srcAbs) });
      return;
    }
    if (existsSync(destAbs)) {
      res.status(409).json({ error: '移動先に同名のファイルまたはフォルダが既に存在します。' });
      return;
    }

    // 変換キャッシュは旧パス基準で残るため、ファイル移動時は旧キャッシュを掃除しておく。
    try {
      const st = statSync(srcAbs);
      if (st.isFile()) deleteOfficePdfCache(srcAbs);
    } catch {
      /* キャッシュ掃除失敗は移動を妨げない。 */
    }

    const oldRel = toDeliverableRelative(srcAbs);
    renameSync(srcAbs, destAbs);
    // MC-238: メタのキーを追従移行（フォルダは配下キーも移行）。
    try { moveMeta(oldRel, destRel); } catch { /* メタ移行失敗は移動を妨げない。 */ }
    res.json({ ok: true, relpath: destRel });
  } catch (e) {
    if (e instanceof SafePathError) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── コピー / 複製（MC-235）──────────────────────────────────
// POST /api/deliverables/copy — ファイル/フォルダを destDir 配下へコピーする（元は残す）。
//  body: { path: string（コピー元、DELIVERABLES_DIR 相対）, destDir: string（コピー先フォルダ、相対 or ''＝ルート直下） }
//  - path / destDir 解決は deliverablePath（realpath / traversal 防御）。範囲外/不正は SafePathError→400。
//  - フォルダは cpSync で再帰コピー。再帰中もコピー先がルート外へ出ない（resolveCopyTarget が destAbs を検証）。
//  - destDir 省略/'' はルート直下＝同一フォルダ複製にもなる。同名は「<name> のコピー[ n]」を自動付与。
//  - フォルダを自分自身/子孫へコピーするのは resolveCopyTarget が拒否（無限再帰防止）→400。
//  - README.md も複製は許可（削除/改名/移動のような破壊操作ではないため保護しない）。
app.post('/api/deliverables/copy', (req, res) => {
  try {
    const relpath = String((req.body as Record<string, unknown>)?.path ?? '');
    const destDirRaw = (req.body as Record<string, unknown>)?.destDir;
    if (!relpath) { res.status(400).json({ error: 'path required' }); return; }

    const srcAbs = resolveDeliverablePath(relpath); // traversal/範囲外→SafePathError
    if (!existsSync(srcAbs)) { res.status(404).json({ error: 'deliverable not found' }); return; }

    let st;
    try {
      st = statSync(srcAbs);
    } catch {
      res.status(404).json({ error: 'deliverable not found' });
      return;
    }
    const isDir = st.isDirectory();
    const isFile = st.isFile();
    if (!isDir && !isFile) {
      res.status(400).json({ error: 'only files and folders can be copied' });
      return;
    }

    // コピー先フォルダ（'' or '/' はルート直下）。実在するディレクトリであること。
    const destDirAbs = resolveDeliverableDir(destDirRaw);
    if (!existsSync(destDirAbs)) { res.status(404).json({ error: 'destination folder not found' }); return; }
    try {
      if (!statSync(destDirAbs).isDirectory()) {
        res.status(400).json({ error: 'destination is not a folder' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'destination folder not found' });
      return;
    }

    // 子孫へのコピー拒否・ルート外検証・衝突回避名の解決（SafePathError→400）。
    const { destAbs, destRel } = resolveCopyTarget(srcAbs, destDirAbs, isDir);

    // ファイルは単純コピー、フォルダは再帰コピー（cpSync recursive）。
    // resolveCopyTarget が destAbs をルート配下に限定済みなので再帰先もルート外には出ない。
    cpSync(srcAbs, destAbs, { recursive: isDir, errorOnExist: true, force: false });

    // MC-238: メタも複製（フォルダは配下キーも複製）。元は残るので src 側はそのまま。
    try { copyMeta(toDeliverableRelative(srcAbs), destRel); } catch { /* メタ複製失敗はコピーを妨げない。 */ }

    res.json({ ok: true, relpath: destRel });
  } catch (e) {
    if (e instanceof SafePathError) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// 成果物ディレクトリ作成（MC-154）。DELIVERABLES_DIR 配下に新フォルダを作る。
//  - body: { name: string, parent?: string }
//  - name は空白・FS禁止文字・ドット始まり・トラバーサルセグメント（..）を拒否。
//  - parent は optional: 指定があれば DELIVERABLES_DIR/<parent>/<name>、省略は DELIVERABLES_DIR/<name>。
//  - 応答: { ok: true } または { error: string }。
app.post('/api/deliverables/mkdir', (req, res) => {
  try {
    const { name, parent } = (req.body ?? {}) as { name?: unknown; parent?: unknown };

    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'フォルダ名は必須です。' });
      return;
    }

    const trimmedName = name.trim();

    // 名前の安全チェック: パス区切り・ドット始まり・FS禁止文字・トラバーサル。
    if (
      trimmedName === '.' ||
      trimmedName === '..' ||
      trimmedName.startsWith('.') ||
      /[/\\<>:"|?*\x00-\x1f]/.test(trimmedName)
    ) {
      res.status(400).json({ error: '使用できないフォルダ名です。' });
      return;
    }

    // parent が指定された場合の安全チェック（トラバーサル防止）。
    let baseDir = resolve(DELIVERABLES_DIR);
    if (typeof parent === 'string' && parent.trim() !== '') {
      const trimmedParent = parent.trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (/\.\./.test(trimmedParent)) {
        res.status(400).json({ error: '無効な親ディレクトリです。' });
        return;
      }
      const candidate = resolve(baseDir, trimmedParent);
      // DELIVERABLES_DIR 配下に留まるか確認。
      const rel = candidate.startsWith(baseDir + sep) || candidate === baseDir;
      if (!rel) {
        res.status(400).json({ error: '親ディレクトリが範囲外です。' });
        return;
      }
      baseDir = candidate;
    }

    const newDir = join(baseDir, trimmedName);

    if (existsSync(newDir)) {
      res.status(409).json({ error: '同名のフォルダが既に存在します。' });
      return;
    }

    mkdirSync(newDir, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── ノートブック（NotebookLM 的な資料セット＋Q&A＋生成物、MC-126）──────────
// 資料を sources/ に置き、claude -p（cwd=ノートブック dir）で ./sources/ ./extracted/ を
// 根拠に回答（ask）・成果物作成（generate→artifacts/）する。パスは lib/notebookPath で安全化。
// 認証ミドルウェア配下。:id パターンを持つが /api/notebooks 名前空間内なので他ルートと衝突しない。
app.use('/api/notebooks', notebookRouter());

// ─── 議事録（Deliverables 直接保存版、notebook 非依存）────────────────────
// notebook id を使わず、生成結果を DELIVERABLES_DIR/議事録/ に直接保存する。
app.use('/api/minutes', minutesRouter());

// ─── チャット（MC-141）──────────────────────────────────────
// Keita・林・Masayoshi・エージェントが channel / DM でリアルタイム会話するチャット。
// ストレージ: data/channels/<channel-id>/{meta.json,messages.jsonl}。
// SSE broadcast で chat イベントを全クライアントへ配信する（既存 /api/stream を流用）。
// /api/chat/agent-message（認証外）は auth ミドルウェアより前に登録済み。
app.use('/api/chat', chatRouter(broadcast));

// ─── ナビ並び順（MC-158）──────────────────────────────────────
// サイドメニュー（NAV）・ダッシュサブタブ（DASH_TABS）の並び順をサーバ保存して
// 端末横断同期する。GET で保存順を返し、POST（ドラッグ確定時）で保存する。
// 保存先 data/nav-order.json（.gitignore 済み）。auth ミドルウェア配下＝Cookie 必須。
// default 項目集合とのマージ（新項目末尾追加・削除項目ドロップ）はフロント側で行う。
app.use('/api/nav-order', navOrderRouter());

// ─── 成長日記（MC-233 Phase1）──────────────────────────────────
// 子の成長記録を日付単位（1日1エントリ）で残し、写真/動画を添付するビュー。
// GET=一覧 / POST entry=date upsert / DELETE entry/:date=論理削除 /
// POST media=multipart アップロード / GET media/:id=実体配信 / DELETE media/:id=削除。
// 保存先はすべて data/ 配下（.gitignore 済み）。auth ミドルウェア配下＝Cookie/Bearer 必須。
app.use('/api/baby-diary', babyDiaryRouter());

// ─── 育児相談チャット「すくすく」──────────────────────────────────
// 育児ページ（Childcare）の「育児チャット」タブ／右下 FAB から開く、育児専門アドバイザー AI。
// POST /api/childcare/chat に { messages, media? } を渡すと回答する（SSE or JSON）。
// 会話履歴はサーバ側 JSONL（data/childcare-chat.jsonl）に蓄積し GET /chat/history で復元する。
// 送信メディア（画像/動画）は POST /chat/upload で data/childcare-chat-media/ に保存し、
// GET /chat/media/:id で配信。画像は best-effort で すくすく が Read して見る（診断はしない）。
// 一般育児知識のみ・赤ちゃんの個別データは渡さない。auth ミドルウェア配下＝Cookie/Bearer 必須。
app.use('/api/childcare', childcareChatRouter());

// ─── 茶事チャット（表千家の茶道アドバイザー）──────────────────────────────
// 茶事ページ（Chaji）の「茶事チャット」から開く、表千家の茶道アドバイザー AI。
// POST /api/chaji/chat に { messages } を渡すと回答する（SSE or JSON）。テキストのみ。
// 会話履歴はサーバ側 JSONL（data/chaji-chat.jsonl）に蓄積し GET /chat/history で復元する。
// 表千家の作法に則り、事実は WebSearch で出典を確認（出典必須・捏造厳禁）。育児チャットを踏襲。
// auth ミドルウェア配下＝Cookie/Bearer 必須。
app.use('/api/chaji', chajiChatRouter());

// ─── 仕事（ECL/PMO 学習・壁打ちチャット＋ナレッジ蓄積）MC-260 ──────────────
// 新サイドメニュー「仕事」(/work)。メガバンクの ECL（予想信用損失）システム導入 PMO 案件向け。
//   - 学習・壁打ちチャット（テキストのみ・SSE/JSON・出典は WebSearch で確認）= workChatRouter
//   - ナレッジ蓄積（CRUD ＋ runClaude による体系化ドラフト）= workKnowledgeRouter
// 両ルーターはパスが /chat* と /knowledge* で衝突しないので同じ /api/work prefix で mount する。
// auth ミドルウェア配下＝Cookie/Bearer 必須。会話履歴・ナレッジは data/ 配下 JSONL に蓄積。
app.use('/api/work', workChatRouter());
app.use('/api/work', workKnowledgeRouter());

// ─── 汎用 Claude チャット（/claude）──────────────────────────────────────
// 話題を限定しない汎用 AI アシスタントチャット。仕事チャット（workChatRouter）のメディア対応・
// SSE/JSON・サーバ永続・出典確認（WebSearch）の作法をそのまま踏襲し、ペルソナだけを汎用化する。
// 会話履歴・添付メディアは data/ 配下の専用ファイル（claude-chat.jsonl / claude-chat-media/）に蓄積する。
// auth ミドルウェア配下＝Cookie/Bearer 必須。
app.use('/api/claude', claudeChatRouter());

// ─── Google 連携（成長日記 MC-233 Phase2/3）──────────────────────
// 成長日記から Google Calendar（予定の読み書き）・Google Photos Picker（写真取り込み）を
// 使うためのサーバ側 OAuth + API 連携。マルチアカウント（keita.urano + keita.urano2 等）対応。
// auth ミドルウェア配下＝Cookie/Bearer 必須（OAuth callback もユーザブラウザ Cookie で通る）。
// クレデンシャル（GOOGLE_OAUTH_CLIENT_ID/_SECRET）未設定時は status が configured:false（200）、
// 他のエンドポイントは 503 { error:'google-not-configured' }（callback は /baby-diary?google=error へ 302）。
app.use('/api/google', googleRouter());

// ─── オートプランナー（MC-245 Phase2）──────────────────────────
// 「やること（Google Tasks）」を空き時間ブロックへ自動配置する。方針は
// 「AI で “見積り”、決定的ロジックで “配置”」（docs/MC-245-auto-scheduler-design.md）。
// GET/PUT config（設定）・GET/PUT task-meta（手動上書き）・POST plan（見積り統合 → 決定的配置）。
// クライアントが Google から取得済みの tasks/events を /plan に渡す（サーバは Google を再取得しない）。
// AI 見積りは claude haiku をバッチ 1 回（mood と同流儀）・キャッシュ・失敗時はヒューリスティックに
// フォールバックする（必ず 200）。auth ミドルウェア配下＝Cookie/Bearer 必須。保存先は data/ 配下。
app.use('/api/planner', plannerRouter());

// ─── 開発ページ AI モックアップ ──────────────────────────────────
// Keita が文章で「こんな画面が欲しい」と指示すると claude が単一 HTML ドキュメントを生成し、
// iframe でプレビュー・修正反復・保存できる。生成は claude CLI を plannerEstimate と同流儀で
// 安全起動する（NULバイトガード・try/catch・タイムアウト）。失敗/タイムアウトは 502。
// POST mockup/generate=生成 / GET mockups=軽量一覧 / GET mockups/:id=html込み /
// POST mockups=upsert / DELETE mockups/:id=論理削除。保存先は data/ 配下（.gitignore 済み）。
// auth ミドルウェア配下＝Cookie/Bearer 必須。
app.use('/api/dev', devMockupRouter());

// ─── SSE（chokidar watch → broadcast に接続）──────────────────────

const sseClients = new Set<Response>();

app.get('/api/stream', (req: Request, res: Response) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // nginx/proxy 越しの buffering を無効化（イベントが即座に届くように）
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // 初期 ping
  res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  sseClients.add(res);

  // keep-alive ping（25 秒ごと）。proxy/トンネルのアイドル切断を防ぐ。
  // watch イベント（event: update）とは別に常時流す。
  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
    res.end();
  });
});

/** watch から呼ぶ broadcast ヘルパー。全 SSE クライアントへ event/data を送る。 */
export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try {
      c.write(payload);
    } catch {
      // 既に切断された client は次の 'close' で除去される。書き込み失敗は無視。
    }
  }
  // MC-143: workflow 更新をチャット #dev に可視化する。
  // 'workflows' タイプの update イベントで、実行中のワークフローをチャットへ投稿。
  if (event === 'update') {
    const d = data as { types?: string[] };
    if (d.types?.includes('workflows')) {
      postWorkflowUpdateToChat().catch(() => { /* サイレント失敗 */ });
    }
  }
}

/** 実行中のワークフロー状態をチャット #dev に投稿する（最後に報告したものと変化があれば）。 */
let _lastWfSummary = '';
async function postWorkflowUpdateToChat(): Promise<void> {
  try {
    const workflows = collectWorkflows();
    const active = workflows.filter((w) => w.status === 'active');
    if (active.length === 0) return; // active が無ければスキップ
    // 簡易サマリを作って前回と同じなら投稿しない（連打防止）
    const summary = active.map((w) => `${w.runId}:${w.phasesDone}/${w.phaseCount}`).join(',');
    if (summary === _lastWfSummary) return;
    _lastWfSummary = summary;
    // チャット投稿
    const lines = active.map((w) => {
      const pct = w.phaseCount > 0 ? `${w.phasesDone}/${w.phaseCount} フェーズ` : '実行中';
      return `• \`${w.runId}\` — ${w.label || 'workflow'} (${pct})`;
    });
    const text = `⚡ ワークフロー実行中:\n${lines.join('\n')}`;
    const { postChatMessage } = await import('./chatRouter.js');
    postChatMessage('dev', {
      id: randomUUID(),
      ts: new Date().toISOString(),
      senderId: 'apollo',
      senderName: 'Apollo',
      senderEmoji: '🔭',
      text,
    }, broadcast);
  } catch {
    // サイレント失敗（チャット投稿は補助機能なのでクラッシュさせない）
  }
}

// ─── 静的配信（web/dist があれば SPA を配信。次フェーズ）──────────

if (existsSync(WEB_DIST)) {
  // index.html は常に再検証（no-cache）させ、デプロイ後にモバイルが古い
  // バンドル参照を掴み続ける問題（MC-115: スマホだけ更新されない）を防ぐ。
  // 中身がハッシュ付きの /assets/* は immutable で長期キャッシュ可。
  app.use(
    express.static(WEB_DIST, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get('/*splat', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(join(WEB_DIST, 'index.html'));
  });
}

// ─── エラーハンドラ ───────────────────────────────────

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: err?.message ?? 'internal error' });
});

// ─── 起動時クリーンアップ: 古い agent-*.jsonl を物理削除 ──────────────
// TTL を超えた完了済み subagent ログを削除し「待機」カウントが積み上がらないようにする。
function cleanupStaleAgentLogs(): void {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return;
  let removed = 0;
  const cutoff = Date.now() - AGENT_LOG_TTL_MS;
  function walk(dir: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e}`;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); }
      else if (e.startsWith('agent-') && e.endsWith('.jsonl') && p.includes('/subagents/')) {
        if (st.mtimeMs < cutoff) { try { unlinkSync(p); removed++; } catch { /* ignore */ } }
      }
    }
  }
  walk(CLAUDE_PROJECTS_DIR);
  if (removed > 0) console.log(`[startup] cleaned up ${removed} stale agent log(s) older than ${AGENT_LOG_TTL_MS / 86400000}d`);
}
cleanupStaleAgentLogs();

const server = app.listen(PORT, () => {
  console.log(`🛰  Apollo API listening on http://localhost:${PORT}`);
  console.log(`   CLAUDE_PROJECTS_DIR: ${CLAUDE_PROJECTS_DIR}`);
  console.log(`   VAULT_DIR:           ${VAULT_DIR}`);
  console.log(`   STALL_MINUTES:       ${STALL_MINUTES}`);
  console.log(`   web/dist:            ${existsSync(WEB_DIST) ? WEB_DIST : '(not built yet)'}`);
  if (authEnabled()) {
    console.log('   auth:                ENABLED (MC_TOKEN set) — /api/* ・SSE ・静的配信を保護');
  } else {
    console.warn(
      '   ⚠ auth:              DISABLED (MC_TOKEN 未設定) — 全リクエストが無認証で通ります。' +
        '公開バインド前に必ず MC_TOKEN を設定してください。',
    );
  }
});

// ─── WebSocket upgrade（MC-92 Web ターミナル）──────────────────────
// Express ミドルウェアは upgrade に走らないため http.Server レベルで拾う。
// /terminal 配下のみ attachUpgrade が処理（内部で認証チェック）。それ以外の
// upgrade は Apollo に WS 利用者がいないので 400 で閉じる（ぶら下がり socket 防止）。
server.on('upgrade', (req, socket, head) => {
  const handled = attachUpgrade(req, socket, head);
  if (!handled) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
  }
});

// ─── watch 起動（サーバ全体で 1 つだけ）と終了時クリーンアップ ─────────
const stopWatch = startWatch(broadcast);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal} 受信。watcher と server を閉じます…`);
  await stopWatch();
  for (const c of sseClients) {
    try {
      c.end();
    } catch {
      /* noop */
    }
  }
  sseClients.clear();
  server.close(() => process.exit(0));
  // close が詰まっても確実に抜ける保険。
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
