// claudeUsage collector (MC-122 / MC-161)
//
// 各 Claude アカウントの「現在のセッション(5時間) / 週間(全モデル) / 週間(Sonnet)」の
// 使用率(%) とリセット時刻を OAuth API から取得して Apollo の「Claude 使用量」表示に渡す。
//
// データ取得（林 検証済み・この通りに叩く）:
//   GET {BASE}/api/oauth/usage    Authorization: Bearer <accessToken> + anthropic-beta: oauth-2025-04-20
//     five_hour.utilization / .resets_at         → 現在のセッション（5時間）
//     seven_day.utilization / .resets_at         → 週間・すべてのモデル
//     seven_day_sonnet.utilization / .resets_at  → 週間・Sonnet のみ（null のことあり）
//     seven_day_opus（null のことあり）          → あれば 週間・Opus のみ
//   GET {BASE}/api/oauth/profile  （同ヘッダ）
//     account.email / organization.rate_limit_tier
//
// トークンの在処（2 アカウント、どちらもこの箱のローカルファイルを毎回読む）:
//   local  : ~/.claude/.credentials.json の claudeAiOauth.accessToken（Claude1 / keita.urano。
//            常駐 claude が自動 refresh する）
//   urano2 : /home/dev/.claude-urano2/.credentials.json（Claude2 / keita.urano2）。
//            MC-161 で旧箱 SSH 経路を廃止しローカル読みに統一。常駐 claude が無いので
//            cron keeper（refresh-urano2-token.sh）が refresh_token grant で定期更新する。
//
// 429 / 強キャッシュ（最重要）:
//   usage エンドポイントは頻繁に叩くと 429（rate_limit_error）を返す。
//   モジュール内メモリで CLAUDE_USAGE_TTL_MS（既定 180 秒）キャッシュし、期限内は再取得しない。
//   429 を受けたら前回値を保持し、その要素に error 注記を付ける。
//
// graceful degradation:
//   取得失敗・429・ファイル不在/失効でもアカウント単位の error フィールドに畳み、全体は 200 で返す。

import { readFile } from 'node:fs/promises';
import {
  CLAUDE_USAGE_TTL_MS,
  CLAUDE_OAUTH_API_BASE,
  CLAUDE_OAUTH_TIMEOUT_MS,
  CLAUDE_LOCAL_CREDENTIALS,
  CLAUDE_URANO2_CREDENTIALS,
} from '../config.js';

// ─── 型 ───────────────────────────────────────────────

/** 1 つのバー（使用率 % + リセット時刻）。 */
export interface UsageBar {
  /** 使用率（0〜100）。null は不明。 */
  pct: number | null;
  /** リセット時刻（ISO 文字列）。null は不明。 */
  resetsAt: string | null;
}

// key は内部識別子（web 側は account.label を表示し、key は React の list key にしか使わない）。
// MC-161 で取得元を旧箱 SSH からローカルファイルに変えたが、lastGood キャッシュ互換のため
// key 名 'oldbox' はそのまま温存し、表示ラベルだけ実態（Claude2 / keita.urano2）に直す。
export type AccountKey = 'local' | 'oldbox';

/** 1 アカウント分の使用量。取得に失敗した部分は error に畳む。 */
export interface ClaudeAccountUsage {
  key: AccountKey;
  /** 表示見出し（「Claude1 / keita.urano」「Claude2 / keita.urano2」）。 */
  label: string;
  /** profile.account.email（取得できれば）。 */
  email?: string;
  /** organization.rate_limit_tier を整形した表示（「Max 5x」等）。 */
  tier?: string;
  /** 現在のセッション（5 時間）。 */
  session: UsageBar;
  /** 週間・すべてのモデル。 */
  weekAll: UsageBar;
  /** 週間・Sonnet のみ（API が null のことあり）。 */
  weekSonnet: UsageBar | null;
  /** 週間・Opus のみ（API が返した場合のみ）。 */
  weekOpus?: UsageBar | null;
  /** このアカウントの取得時刻（ISO）。 */
  fetchedAt: string;
  /** 取得失敗・429・SSH 不通時のメッセージ（部分劣化）。 */
  error?: string;
}

/** GET /api/claude-usage のレスポンス形。 */
export interface ClaudeUsageSummary {
  generatedAt: string;
  /** キャッシュから返したか（true なら OAuth API を再実行せず前回結果）。 */
  cached: boolean;
  /** TTL（ミリ秒）。フロントの再取得間隔の参考に返す。 */
  ttlMs: number;
  accounts: ClaudeAccountUsage[];
}

// ─── アカウント定義 ─────────────────────────────────────

// カードの表示名と並び順は「取得した account email」を一次ソースにする。
// credentials ファイル（~/.claude / ~/.claude-urano2）とアカウントの対応が入れ替わっても
// 表示がズレないようにするため（2026-06-07 Keita 指摘: C1/C2 のラベルと中身が逆だった）。
interface AccountIdentity {
  label: string;
  rank: number;
}
const EMAIL_IDENTITY: Record<string, AccountIdentity> = {
  'keita.urano@gmail.com': { label: 'Claude1 / keita.urano', rank: 0 },
  'keita.urano2@gmail.com': { label: 'Claude2 / keita.urano2', rank: 1 },
};
// email がまだ取れていない（429 や初回失敗）ときの暫定。現状の実配置に合わせる:
//   ~/.claude（local）= keita.urano = Claude1 / ~/.claude-urano2（oldbox）= keita.urano2 = Claude2
//   （2026-06-07 再検証で交差解消済）。
// email が取れたら EMAIL_IDENTITY が優先されるので、配置が直ればこの fallback に依存しない。
const KEY_FALLBACK: Record<AccountKey, AccountIdentity> = {
  local: { label: 'Claude1 / keita.urano', rank: 0 },
  oldbox: { label: 'Claude2 / keita.urano2', rank: 1 },
};
/** email（あれば一次）→ なければ key 実配置 fallback でアカウント識別を決める。 */
function identityFor(email: string | undefined, key: AccountKey): AccountIdentity {
  if (email && EMAIL_IDENTITY[email]) return EMAIL_IDENTITY[email];
  return KEY_FALLBACK[key];
}
/** アカウントの表示順位（Claude1=0 → Claude2=1 → 不明）。lastGood/前回 email も加味される。 */
function accountRank(acc: ClaudeAccountUsage): number {
  return identityFor(acc.email, acc.key).rank;
}

// ─── OAuth API レスポンス（必要フィールドのみ）───────────────────

interface RawBar {
  utilization?: unknown;
  resets_at?: unknown;
}

interface RawUsage {
  five_hour?: RawBar | null;
  seven_day?: RawBar | null;
  seven_day_sonnet?: RawBar | null;
  seven_day_opus?: RawBar | null;
}

interface RawProfile {
  account?: { email?: unknown } | null;
  organization?: { rate_limit_tier?: unknown } | null;
}

// ─── 値の正規化 ─────────────────────────────────────────

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** RawBar → UsageBar（utilization/resets_at を正規化）。bar 自体が null/未定義なら不明バー。 */
function toBar(raw: RawBar | null | undefined): UsageBar {
  if (!raw || typeof raw !== 'object') return { pct: null, resetsAt: null };
  return { pct: numOrNull(raw.utilization), resetsAt: strOrNull(raw.resets_at) };
}

/**
 * rate_limit_tier（例 'default_claude_max_5x' / 'default_claude_max_20x' / 'default_claude_pro'）を
 * 人が読める表示（'Max 5x' / 'Max 20x' / 'Pro'）に整形する。未知の形はそのまま返す。
 */
function formatTier(tier: string | null): string | undefined {
  if (!tier) return undefined;
  const m5 = tier.match(/max[_-]?(\d+)x/i);
  if (m5) return `Max ${m5[1]}x`;
  if (/max/i.test(tier)) return 'Max';
  if (/pro/i.test(tier)) return 'Pro';
  if (/free/i.test(tier)) return 'Free';
  return tier;
}

// ─── トークン取得 ───────────────────────────────────────

/** credentials JSON 文字列から accessToken を取り出す。形が違えば throw。 */
function tokenFromCredentialsJson(json: string): string {
  const parsed = JSON.parse(json) as { claudeAiOauth?: { accessToken?: unknown } };
  const token = parsed?.claudeAiOauth?.accessToken;
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('credentials に claudeAiOauth.accessToken がありません');
  }
  return token;
}

/** 指定パスの credentials ファイルを毎回読んで accessToken を取り出す（MC-161 で統一）。 */
async function readTokenFromFile(path: string): Promise<string> {
  const json = await readFile(path, 'utf-8');
  return tokenFromCredentialsJson(json);
}

/** local（Claude1 / keita.urano）: ~/.claude/.credentials.json を毎回読む（claude が自動 refresh）。 */
function readLocalToken(): Promise<string> {
  return readTokenFromFile(CLAUDE_LOCAL_CREDENTIALS);
}

/** urano2（Claude2 / keita.urano2）: この箱の .claude-urano2/.credentials.json を毎回読む（cron keeper が refresh）。 */
function readUrano2Token(): Promise<string> {
  return readTokenFromFile(CLAUDE_URANO2_CREDENTIALS);
}

// ─── OAuth API 呼び出し ──────────────────────────────────

/** 429 を識別するためのエラー。前回値保持の判断に使う。 */
class RateLimitError extends Error {
  constructor() {
    super('レート制限（429）のため最新の使用量を取得できませんでした');
    this.name = 'RateLimitError';
  }
}

async function oauthGet<T>(path: string, token: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLAUDE_OAUTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${CLAUDE_OAUTH_API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new RateLimitError();
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`OAuth API タイムアウト（${CLAUDE_OAUTH_TIMEOUT_MS}ms）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 1 アカウントの取得 ──────────────────────────────────

/** トークン → usage + profile を取得して 1 アカウント分に組み立てる。例外は呼び出し側で error に畳む。 */
async function fetchAccount(key: AccountKey, token: string): Promise<ClaudeAccountUsage> {
  // usage が本体。profile は付帯情報なので失敗しても usage は出す。
  const usage = await oauthGet<RawUsage>('/api/oauth/usage', token);

  let email: string | undefined;
  let tier: string | undefined;
  try {
    const profile = await oauthGet<RawProfile>('/api/oauth/profile', token);
    email = strOrNull(profile?.account?.email) ?? undefined;
    tier = formatTier(strOrNull(profile?.organization?.rate_limit_tier));
  } catch {
    // profile 失敗は致命ではない。usage だけで表示する。
  }

  const account: ClaudeAccountUsage = {
    key,
    label: identityFor(email, key).label,
    email,
    tier,
    session: toBar(usage.five_hour),
    weekAll: toBar(usage.seven_day),
    weekSonnet: usage.seven_day_sonnet ? toBar(usage.seven_day_sonnet) : null,
    fetchedAt: new Date().toISOString(),
  };
  // opus は返した場合のみ表示する（null のことが多い）。
  if (usage.seven_day_opus) account.weekOpus = toBar(usage.seven_day_opus);
  return account;
}

// ─── 前回値（部分劣化で温存するため key 別に保持）──────────────

const lastGood: Partial<Record<AccountKey, ClaudeAccountUsage>> = {};

/** エラー時の表示用フォールバック。前回値があればそれに error 注記を載せ、無ければ空バーで返す。 */
function degraded(key: AccountKey, message: string): ClaudeAccountUsage {
  const prev = lastGood[key];
  if (prev) {
    return { ...prev, error: message };
  }
  return {
    key,
    label: identityFor(undefined, key).label,
    session: { pct: null, resetsAt: null },
    weekAll: { pct: null, resetsAt: null },
    weekSonnet: null,
    fetchedAt: new Date().toISOString(),
    error: message,
  };
}

/** 1 アカウントを「トークン取得 → API 取得」まで通し、各段の失敗を error に畳む。 */
async function collectAccount(
  key: AccountKey,
  loadToken: () => Promise<string>,
): Promise<ClaudeAccountUsage> {
  let token: string;
  try {
    token = await loadToken();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return degraded(key, `トークン取得に失敗しました: ${msg}`);
  }
  try {
    const account = await fetchAccount(key, token);
    lastGood[key] = account;
    return account;
  } catch (e) {
    if (e instanceof RateLimitError) {
      // 429: 前回値を保持しつつ注記。
      return degraded(key, e.message);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return degraded(key, `使用量の取得に失敗しました: ${msg}`);
  }
}

async function compute(): Promise<ClaudeUsageSummary> {
  // 2 アカウントを並行取得（どちらもローカルファイル読み＝MC-161、片方失敗でも全体は返す）。
  const [local, oldbox] = await Promise.all([
    collectAccount('local', readLocalToken),
    collectAccount('oldbox', readUrano2Token),
  ]);
  // 表示順は email 由来の rank で安定ソート（Claude1=keita.urano → Claude2=keita.urano2）。
  const accounts = [local, oldbox].sort((a, b) => accountRank(a) - accountRank(b));
  return {
    generatedAt: new Date().toISOString(),
    cached: false,
    ttlMs: CLAUDE_USAGE_TTL_MS,
    accounts,
  };
}

// ─── 強キャッシュ（180 秒）───────────────────────────────
// usage エンドポイントは 429 制約があるため、TTL 内は OAuth API を再実行せず前回結果を返す。

let cached: ClaudeUsageSummary | null = null;
let cachedAt = 0;
// 同時要求が TTL 切れ直後に重なっても OAuth を二重に叩かないよう、進行中の compute を共有する。
let inflight: Promise<ClaudeUsageSummary> | null = null;

/** Claude プラン使用量サマリ（CLAUDE_USAGE_TTL_MS キャッシュ・全例外を吸収して 200 で返せる形）。 */
export async function collectClaudeUsage(): Promise<ClaudeUsageSummary> {
  const now = Date.now();
  if (cached && now - cachedAt < CLAUDE_USAGE_TTL_MS) {
    return { ...cached, cached: true };
  }
  if (inflight) return inflight;
  inflight = compute()
    .then((result) => {
      cached = result;
      cachedAt = Date.now();
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
