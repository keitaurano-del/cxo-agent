// deploys collector (MC-64)
//
// GitHub Actions の deploy 系 workflow の直近 run 状態を gh CLI（GitHub API）で取得し、
// 「このタスクの実装が本番に出たか」を Apollo のタスク詳細から把握できるようにする MVP。
//
// 対象 repo / workflow は config.ts の DEPLOY_REPOS に集約（ハードコード散在禁止）。
// logic: deploy-production.yml + android-deploy.yml、en-chakai: deploy-production.yml。
// cxo-agent は deploy 連動の対象に含めない（[[feedback-no-cxo-agent]] 方針）。
//
// graceful fallback 必須:
//   gh が無い / 未認証 / レート制限 / タイムアウト / JSON parse 失敗でも例外を投げず、
//   該当 repo を空配列 + error フィールド付きで返す。Apollo 全体を絶対に落とさない。
//
// 5分キャッシュ:
//   usage.ts のキャッシュ実装を踏襲（同じ TTL 方式）。GitHub API レート対策。
//   gh は実行時にしか呼ばない（ビルド/型チェックでは呼ばれない）ので green 判定に影響しない。

import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import {
  DEPLOY_REPOS,
  DEPLOY_RUN_LIMIT,
  DEPLOY_GH_TIMEOUT_MS,
  DEPLOY_TTL_MS,
  DEPLOY_GH_PATH,
  type DeployRepoConfig,
} from '../config.js';
import type { ProjectName } from '../lib/projectMap.js';

/** 1 deploy run の正規化形（gh run list の JSON フィールドを正規化）。 */
export interface DeployRun {
  id: number;
  title: string;
  /** queued / in_progress / completed など（gh の status）。 */
  status: string;
  /** success / failure / cancelled / null（完了時のみ確定）。 */
  conclusion: string | null;
  branch: string;
  event: string;
  /** 由来 workflow ファイル名（どの workflow の run か区別する）。 */
  workflow: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/** 1 repo の deploy run まとめ。エラー時は runs 空 + error 付き。 */
export interface DeployRepo {
  repo: string;
  project: ProjectName;
  runs: DeployRun[];
  /** 取得に失敗した repo のみ設定（gh 不在・未認証・レート・タイムアウト・parse 失敗）。 */
  error?: string;
}

/** GET /api/deploys のレスポンス形。 */
export interface DeploysSummary {
  generatedAt: string;
  source: string;
  /** キャッシュから返したか（true なら gh を再実行せず前回結果）。 */
  cached: boolean;
  repos: DeployRepo[];
}

/** gh run list が返す 1 要素（--json で指定したフィールドのみ）。 */
interface GhRun {
  databaseId?: unknown;
  displayTitle?: unknown;
  status?: unknown;
  conclusion?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  headBranch?: unknown;
  event?: unknown;
  url?: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function numId(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * gh run list を 1 workflow について実行し、正規化済み run 配列を返す。
 * 失敗（gh 不在・未認証・レート・タイムアウト・parse 失敗）時は throw して
 * 呼び出し側（collectRepo）で repo 単位の error に畳む。
 */
function fetchWorkflowRuns(repo: string, workflow: string): DeployRun[] {
  const out = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      workflow,
      '--limit',
      String(DEPLOY_RUN_LIMIT),
      '--json',
      'databaseId,displayTitle,status,conclusion,createdAt,updatedAt,headBranch,event,url',
    ],
    {
      encoding: 'utf-8',
      timeout: DEPLOY_GH_TIMEOUT_MS,
      // systemd 等で PATH が痩せていても gh を解決できるよう PATH を補う。
      env: { ...process.env, PATH: DEPLOY_GH_PATH },
      // gh のエラー出力は stderr。例外メッセージ用に拾えるよう pipe。
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed)) return [];

  return parsed.map((r: GhRun): DeployRun => ({
    id: numId(r.databaseId),
    title: str(r.displayTitle),
    status: str(r.status),
    conclusion: r.conclusion == null || r.conclusion === '' ? null : str(r.conclusion),
    branch: str(r.headBranch),
    event: str(r.event),
    workflow,
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    url: str(r.url),
  }));
}

/** gh 実行例外を読みやすい 1 行メッセージに畳む（長い stderr は要約）。 */
function describeError(e: unknown): string {
  const err = e as { code?: string; signal?: string; stderr?: unknown; message?: unknown };
  // ENOENT = gh コマンドが見つからない（未インストール / PATH 外）。
  if (err?.code === 'ENOENT') return 'gh コマンドが見つかりません（未インストールまたは PATH 外）';
  // SIGTERM = timeout で kill された。
  if (err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT') {
    return `gh がタイムアウトしました（${DEPLOY_GH_TIMEOUT_MS}ms）`;
  }
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  if (stderr) return stderr.split('\n')[0].slice(0, 300);
  const message = e instanceof Error ? e.message : String(e);
  return message.slice(0, 300);
}

/** 1 repo の全 workflow run を取得して 1 DeployRepo に畳む。例外は repo 単位の error に。 */
function collectRepo(cfg: DeployRepoConfig): DeployRepo {
  const runs: DeployRun[] = [];
  let error: string | undefined;

  for (const workflow of cfg.workflows) {
    try {
      runs.push(...fetchWorkflowRuns(cfg.repo, workflow));
    } catch (e) {
      // 1 workflow の失敗で repo 全体を落とさない。最初のエラーを repo の error に残す。
      const msg = describeError(e);
      if (!error) error = msg;
    }
  }

  // 新しい更新順（updatedAt 降順）に並べる。
  runs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const repo: DeployRepo = { repo: cfg.repo, project: cfg.project, runs };
  if (error) repo.error = error;
  return repo;
}

function compute(): DeploysSummary {
  const repos = DEPLOY_REPOS.map((cfg) => {
    try {
      return collectRepo(cfg);
    } catch (e) {
      // 念のための最終防衛。collectRepo 内で吸収済みだが、想定外でも repo 単位で空+error に。
      return {
        repo: cfg.repo,
        project: cfg.project,
        runs: [],
        error: e instanceof Error ? e.message : String(e),
      } satisfies DeployRepo;
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    source: hostname(),
    cached: false,
    repos,
  };
}

// gh は外部プロセス + GitHub API なのでリアルタイム性は不要。usage.ts と同じ TTL 方式で
// DEPLOY_TTL_MS（既定 5 分）のメモリキャッシュにし、レート対策する。
let cached: DeploysSummary | null = null;
let cachedAt = 0;

/** deploy run サマリ（DEPLOY_TTL_MS キャッシュ・全例外を吸収して 200 で返せる形）。 */
export function collectDeploys(): DeploysSummary {
  const now = Date.now();
  if (cached && now - cachedAt < DEPLOY_TTL_MS) {
    return { ...cached, cached: true };
  }
  cached = compute();
  cachedAt = now;
  return cached;
}
