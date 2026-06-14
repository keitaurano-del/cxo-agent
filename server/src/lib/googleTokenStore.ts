// googleTokenStore — Google OAuth トークンの JSONL ストア（成長日記 MC-233 Phase2/3）。
//
// データストア: data/google-tokens.jsonl（追記専用・last-wins by email・.gitignore 済み）。
// approvalRequestStore.ts / babyDiaryStore.ts の last-wins パターンに倣う:
//   JSONL を全走査して email ごとの最新レコードを採用する。
//
// セキュリティ: access_token / refresh_token はディスクには保存するが、
//   公開（listAccounts）では email / connectedAt / scope のみを返し、トークンは絶対に出さない。
//   呼び出し側（googleRouter）も status/accounts でトークンを返さないこと。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  GOOGLE_TOKENS_FILE,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_HTTP_TIMEOUT_MS,
} from '../config.js';

/** Google トークンレコードの 1 件（email を一意キーとする）。 */
export interface GoogleTokenRecord {
  /** 接続した Google アカウントのメール。一意キー。 */
  email: string;
  /** アクセストークン（短命）。公開しない。 */
  accessToken: string;
  /** リフレッシュトークン（長命・access 更新用）。公開しない。空のこともある（再同意で得られないケース）。 */
  refreshToken: string;
  /** access_token の有効期限（ISO8601）。 */
  expiresAt: string;
  /** 付与されたスコープ（スペース区切り）。 */
  scope: string;
  /** 接続日時（ISO8601）。 */
  connectedAt: string;
}

/** 公開用アカウント情報（トークンを含まない）。 */
export interface PublicAccount {
  email: string;
  connectedAt: string;
  scope: string;
}

// ─── JSONL ヘルパ（last-wins by email）─────────────────────────

/** JSONL を全走査して email ごとの最新レコードを返す（last-wins）。 */
function readAll(): Map<string, GoogleTokenRecord> {
  const map = new Map<string, GoogleTokenRecord>();
  if (!existsSync(GOOGLE_TOKENS_FILE)) return map;
  let raw: string;
  try {
    raw = readFileSync(GOOGLE_TOKENS_FILE, 'utf-8');
  } catch {
    return map;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as GoogleTokenRecord & { removed?: boolean };
      if (!rec.email) continue;
      // 論理削除（removed:true）は最新状態として「無し」に倒す。
      if ((rec as { removed?: boolean }).removed) {
        map.delete(rec.email);
      } else {
        map.set(rec.email, rec);
      }
    } catch {
      // 壊れた行は無視。
    }
  }
  return map;
}

/** JSONL に 1 行追記する。ディレクトリが無ければ作成。 */
function appendRecord(rec: unknown): void {
  const dir = dirname(GOOGLE_TOKENS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(GOOGLE_TOKENS_FILE, JSON.stringify(rec) + '\n', 'utf-8');
}

// ─── 公開 API ───────────────────────────────────────────

/** 接続済みアカウント一覧（公開用・トークンは出さず email/connectedAt/scope のみ）。 */
export function listAccounts(): PublicAccount[] {
  const out: PublicAccount[] = [];
  for (const rec of readAll().values()) {
    out.push({ email: rec.email, connectedAt: rec.connectedAt, scope: rec.scope });
  }
  out.sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
  return out;
}

/** トークンレコードを email キーで upsert 保存する（last-wins）。 */
export function saveTokens(rec: GoogleTokenRecord): void {
  appendRecord(rec);
}

/** email のトークンレコードを返す（無ければ undefined）。内部用（トークンを含む）。 */
export function getTokens(email: string): GoogleTokenRecord | undefined {
  return readAll().get(email);
}

/** email のアカウントを論理削除する（removed:true を追記）。 */
export function removeAccount(email: string): void {
  appendRecord({ email, removed: true, removedAt: new Date().toISOString() });
}

// ─── トークン更新 ───────────────────────────────────────

/** access_token を refresh する直前の余裕（ミリ秒）。期限の 60 秒前で更新する。 */
const REFRESH_SKEW_MS = 60 * 1000;

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/** タイムアウト付き fetch（AbortController）。 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GOOGLE_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Google API タイムアウト（${GOOGLE_HTTP_TIMEOUT_MS}ms）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * email の有効な access_token を返す。
 * 期限が近い（60 秒前）なら refresh_token で更新（POST oauth2.googleapis.com/token,
 * grant_type=refresh_token）し、新トークンを保存してから返す。
 * - レコードが無い → throw（未接続）。
 * - refresh が必要だが refresh_token が無い / refresh が失敗 → 明確に throw。
 */
export async function getValidAccessToken(email: string): Promise<string> {
  const rec = getTokens(email);
  if (!rec) {
    throw new Error(`google account not connected: ${email}`);
  }

  const expiresMs = Date.parse(rec.expiresAt);
  const stillValid = Number.isFinite(expiresMs) && expiresMs - REFRESH_SKEW_MS > Date.now();
  if (stillValid && rec.accessToken) {
    return rec.accessToken;
  }

  // 期限切れ（または不明）→ refresh_token で更新する。
  if (!rec.refreshToken) {
    throw new Error(`access token expired and no refresh token for: ${email}`);
  }

  const body = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: rec.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`token refresh failed for ${email}: ${detail}`);
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const updated: GoogleTokenRecord = {
    email: rec.email,
    accessToken: data.access_token,
    // Google は refresh 応答で refresh_token を再発行しないことが多い。無ければ既存を維持する。
    refreshToken: data.refresh_token || rec.refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: data.scope || rec.scope,
    connectedAt: rec.connectedAt,
  };
  saveTokens(updated);
  return updated.accessToken;
}
