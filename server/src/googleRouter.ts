// googleRouter — 成長日記（MC-233 Phase2/3）の Google 連携 REST API。
//
// index.ts で `app.use('/api/google', googleRouter())` を auth ミドルウェアより後に登録する。
// マルチアカウント（keita.urano + keita.urano2 等を順に接続）に対応する。
//
// クレデンシャル（GOOGLE_OAUTH_CLIENT_ID / _SECRET）未設定時の挙動:
//   - GET /api/google/status        : 200 で { configured:false, accounts:[] }（UI が状態表示できる）
//   - その他（callback 除く）        : 503 { error:'google-not-configured' }
//   - GET /api/google/oauth/callback : 設定不備でも /baby-diary?google=error に 302（ブラウザ遷移のため）
//
// 機能:
//   1. GET    /status                          接続状態 + アカウント一覧（トークンは出さない）
//   2. GET    /oauth/start                      Google 同意画面へ 302（state を in-memory に保持し CSRF 検証）
//   3. GET    /oauth/callback                   code 交換 → email 取得 → saveTokens → /baby-diary?google=connected
//   4. DELETE /accounts/:email                  アカウント切断
//   5. GET    /calendar/events                  全接続アカウント横断で primary の予定取得（部分劣化）
//   6. POST   /calendar/events                  指定アカウントの primary に終日イベント作成
//   7. POST   /photos/picker/session            Picker セッション作成 → { sessionId, pickerUri, account }
//      GET    /photos/picker/session/:sessionId 選択完了ポーリング → { mediaItemsSet }
//      POST   /photos/picker/import             選択メディアを取得して babyDiaryStore へ保存
//   8. GET    /tasks                            全接続アカウント横断で期日付き Google Tasks を取得（部分劣化・tasks 未許可は優しく畳む）
//
// HTTP はすべて標準 fetch（googleapis 等の重い依存は足さない）。外部呼び出しは全てタイムアウト付き。
// access_token / refresh_token / secret はレスポンスに一切含めない。

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';

import {
  googleConfigured,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_OAUTH_SCOPE,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_TASKS_SCOPE,
  GOOGLE_HTTP_TIMEOUT_MS,
  BABY_DIARY_MEDIA_DIR,
} from './config.js';
import {
  listAccounts,
  saveTokens,
  removeAccount,
  getValidAccessToken,
  getTokens,
  type GoogleTokenRecord,
} from './lib/googleTokenStore.js';
import { sanitizeFilename } from './lib/inboxPath.js';
import { appendMedia, type MediaMeta } from './lib/babyDiaryStore.js';
import {
  listConfigs as listDriveConfigs,
  getConfig as getDriveConfig,
  setConfig as setDriveConfig,
  isImported as isDriveImported,
  markImported as markDriveImported,
} from './lib/googleDriveStore.js';

// ─── 共通ヘルパ ───────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** タイムアウト付き fetch。 */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<globalThis.Response> {
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

/** Bearer 付き GET → JSON。失敗は throw。 */
async function googleGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${url} → HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Bearer 付き POST(JSON) → JSON。失敗は throw。 */
async function googlePostJson<T>(url: string, accessToken: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${url} → HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** 未設定ガード。設定済みなら true、未設定なら 503 を送って false。 */
function requireConfigured(res: Response): boolean {
  if (googleConfigured()) return true;
  res.status(503).json({ error: 'google-not-configured' });
  return false;
}

// ─── OAuth state（CSRF 対策・in-memory）──────────────────────
// start で発番した state を保持し、callback で照合する。
// 10 分 TTL で自動失効させ、メモリリークを防ぐ。

interface StateEntry {
  createdAt: number;
}
const pendingStates = new Map<string, StateEntry>();
const STATE_TTL_MS = 10 * 60 * 1000;

function issueState(): string {
  const state = randomUUID();
  pendingStates.set(state, { createdAt: Date.now() });
  // 古い state を掃除（TTL 超過）。
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (now - v.createdAt > STATE_TTL_MS) pendingStates.delete(k);
  }
  return state;
}

/** state を消費（一致 & 未失効なら true、消費済みにする）。 */
function consumeState(state: string | undefined): boolean {
  if (!state) return false;
  const entry = pendingStates.get(state);
  if (!entry) return false;
  pendingStates.delete(state);
  return Date.now() - entry.createdAt <= STATE_TTL_MS;
}

// ─── 1. GET /status ──────────────────────────────────────
// 未設定でも 200 で configured:false を返す（UI が状態表示できるように）。
// accounts はトークンを含まない公開形（email / connectedAt / scope）。

function handleStatus(_req: Request, res: Response): void {
  res.json({
    configured: googleConfigured(),
    accounts: googleConfigured() ? listAccounts() : [],
  });
}

// ─── 2. GET /oauth/start ─────────────────────────────────
// Google 同意画面へ 302。複数アカウント接続のため prompt='consent select_account'。

function handleOAuthStart(_req: Request, res: Response): void {
  if (!requireConfigured(res)) return;
  const state = issueState();
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

// ─── 3. GET /oauth/callback ──────────────────────────────
// Google からのリダイレクト（ユーザブラウザ = mc_token Cookie あり = auth 通過）。
// code を交換 → userinfo で email 取得 → saveTokens → /baby-diary?google=connected。
// 設定不備 / state 不一致 / Google error は /baby-diary?google=error へ 302。

interface TokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface UserInfoResponse {
  email?: string;
  sub?: string;
}

async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  // callback はブラウザ遷移なので、未設定/エラーでも JSON でなく /baby-diary?google=error へ戻す。
  if (!googleConfigured()) {
    res.redirect(302, '/baby-diary?google=error');
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined;

  if (oauthError || !code || !consumeState(state)) {
    res.redirect(302, '/baby-diary?google=error');
    return;
  }

  try {
    // code → token 交換。
    const tokenBody = new URLSearchParams({
      code,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const tok = (await tokenRes.json().catch(() => ({}))) as TokenExchangeResponse;
    if (!tokenRes.ok || !tok.access_token) {
      throw new Error(tok.error_description || tok.error || `token exchange HTTP ${tokenRes.status}`);
    }

    // email を userinfo で取得。
    const info = await googleGet<UserInfoResponse>(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      tok.access_token,
    );
    const email = info.email;
    if (!email) {
      throw new Error('userinfo did not return email');
    }

    const expiresIn = typeof tok.expires_in === 'number' ? tok.expires_in : 3600;
    const rec: GoogleTokenRecord = {
      email,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token || '',
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scope: tok.scope || GOOGLE_OAUTH_SCOPE,
      connectedAt: new Date().toISOString(),
    };
    saveTokens(rec);

    res.redirect(302, '/baby-diary?google=connected');
  } catch (e) {
    console.error('[google oauth callback]', e instanceof Error ? e.message : String(e));
    res.redirect(302, '/baby-diary?google=error');
  }
}

// ─── 4. DELETE /accounts/:email ──────────────────────────

function handleRemoveAccount(req: Request, res: Response): void {
  if (!requireConfigured(res)) return;
  const email = String(req.params.email ?? '');
  if (!email) {
    res.status(400).json({ error: 'email required' });
    return;
  }
  removeAccount(email);
  res.json({ ok: true });
}

// ─── 5. GET /calendar/events ─────────────────────────────
// 接続済み全アカウント横断で primary の予定を取得（1 アカウント失敗しても others は返す）。

interface GCalEvent {
  id?: string;
  summary?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}
interface GCalListResponse {
  items?: GCalEvent[];
}

interface NormalizedEvent {
  id: string;
  account: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  htmlLink: string | null;
}

function normalizeEvent(ev: GCalEvent, account: string): NormalizedEvent {
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  return {
    id: ev.id ?? '',
    account,
    title: ev.summary ?? '(無題)',
    start: ev.start?.dateTime ?? ev.start?.date ?? null,
    end: ev.end?.dateTime ?? ev.end?.date ?? null,
    allDay,
    htmlLink: ev.htmlLink ?? null,
  };
}

async function handleCalendarList(req: Request, res: Response): Promise<void> {
  if (!requireConfigured(res)) return;

  const timeMin = typeof req.query.timeMin === 'string' ? req.query.timeMin : undefined;
  const timeMax = typeof req.query.timeMax === 'string' ? req.query.timeMax : undefined;

  const accounts = listAccounts();
  const events: NormalizedEvent[] = [];
  const errors: { account: string; error: string }[] = [];

  // アカウントごとに並行取得。1 つの失敗は errors に畳んで others は返す（部分劣化）。
  await Promise.all(
    accounts.map(async (acc) => {
      try {
        const accessToken = await getValidAccessToken(acc.email);
        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        });
        if (timeMin) params.set('timeMin', timeMin);
        if (timeMax) params.set('timeMax', timeMax);
        const data = await googleGet<GCalListResponse>(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
          accessToken,
        );
        for (const ev of data.items ?? []) {
          events.push(normalizeEvent(ev, acc.email));
        }
      } catch (e) {
        errors.push({ account: acc.email, error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  // 開始時刻で全アカウント混在ソート（null は末尾）。
  events.sort((a, b) => {
    if (a.start === b.start) return 0;
    if (a.start === null) return 1;
    if (b.start === null) return -1;
    return a.start.localeCompare(b.start);
  });

  res.json({ events, ...(errors.length > 0 ? { errors } : {}) });
}

// ─── 6. POST /calendar/events ────────────────────────────
// 指定アカウントの primary に終日イベントを作成する（start.date / end.date）。

async function handleCalendarCreate(req: Request, res: Response): Promise<void> {
  if (!requireConfigured(res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const account = typeof body.account === 'string' ? body.account : '';
  const summary = typeof body.summary === 'string' ? body.summary : '';
  const date = body.date;
  const description = typeof body.description === 'string' ? body.description : undefined;

  if (!account) {
    res.status(400).json({ error: 'account is required' });
    return;
  }
  if (!summary) {
    res.status(400).json({ error: 'summary is required' });
    return;
  }
  if (!isValidDate(date)) {
    res.status(400).json({ error: 'date is required and must be YYYY-MM-DD' });
    return;
  }

  // 終日イベントの end.date は排他的なので翌日にする。
  const endDate = new Date(`${date}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endStr = endDate.toISOString().slice(0, 10);

  try {
    const accessToken = await getValidAccessToken(account);
    const created = await googlePostJson<GCalEvent>(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      accessToken,
      {
        summary,
        ...(description !== undefined ? { description } : {}),
        start: { date },
        end: { date: endStr },
      },
    );
    res.status(201).json({
      account,
      event: normalizeEvent(created, account),
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ─── 7. Photos Picker（Phase3）──────────────────────────────

interface PickerSession {
  id?: string;
  pickerUri?: string;
  mediaItemsSet?: boolean;
}

/** POST /photos/picker/session — Picker セッション作成。 */
async function handlePickerCreate(req: Request, res: Response): Promise<void> {
  if (!requireConfigured(res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const account = typeof body.account === 'string' ? body.account : '';
  if (!account) {
    res.status(400).json({ error: 'account is required' });
    return;
  }
  try {
    const accessToken = await getValidAccessToken(account);
    const session = await googlePostJson<PickerSession>(
      'https://photospicker.googleapis.com/v1/sessions',
      accessToken,
      {},
    );
    res.json({ sessionId: session.id, pickerUri: session.pickerUri, account });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** GET /photos/picker/session/:sessionId — 選択完了ポーリング。 */
async function handlePickerPoll(req: Request, res: Response): Promise<void> {
  if (!requireConfigured(res)) return;
  const sessionId = String(req.params.sessionId ?? '');
  const account = typeof req.query.account === 'string' ? req.query.account : '';
  if (!sessionId || !account) {
    res.status(400).json({ error: 'sessionId and account are required' });
    return;
  }
  try {
    const accessToken = await getValidAccessToken(account);
    const session = await googleGet<PickerSession>(
      `https://photospicker.googleapis.com/v1/sessions/${encodeURIComponent(sessionId)}`,
      accessToken,
    );
    res.json({ mediaItemsSet: Boolean(session.mediaItemsSet) });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// 取り込み: Picker mediaItems の列挙レスポンス。
interface PickerMediaFile {
  baseUrl?: string;
  mimeType?: string;
  filename?: string;
}
interface PickerMediaItem {
  id?: string;
  type?: string;
  mediaFile?: PickerMediaFile;
}
interface PickerMediaListResponse {
  mediaItems?: PickerMediaItem[];
  nextPageToken?: string;
}

/** mimeType から kind を判定（image/video）。判定不能は image 扱い。 */
function kindFromMime(mime: string): 'image' | 'video' {
  return mime.toLowerCase().startsWith('video/') ? 'video' : 'image';
}

/** mimeType から拡張子を推測（保存名用・無くても致命的でない）。 */
function extFromMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
  };
  return map[m] ?? '';
}

/** POST /photos/picker/import — 選択メディアを取得して babyDiaryStore へ保存。 */
async function handlePickerImport(req: Request, res: Response): Promise<void> {
  if (!requireConfigured(res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const account = typeof body.account === 'string' ? body.account : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const date = body.date;

  if (!account) {
    res.status(400).json({ error: 'account is required' });
    return;
  }
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }
  if (!isValidDate(date)) {
    res.status(400).json({ error: 'date is required and must be YYYY-MM-DD' });
    return;
  }

  try {
    const accessToken = await getValidAccessToken(account);

    // 選択メディアを列挙（ページネーション対応）。
    const items: PickerMediaItem[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ sessionId, pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await googleGet<PickerMediaListResponse>(
        `https://photospicker.googleapis.com/v1/mediaItems?${params.toString()}`,
        accessToken,
      );
      for (const it of page.mediaItems ?? []) items.push(it);
      pageToken = page.nextPageToken;
    } while (pageToken);

    mkdirSync(BABY_DIARY_MEDIA_DIR, { recursive: true });

    const imported: MediaMeta[] = [];
    for (const item of items) {
      const file = item.mediaFile;
      if (!file?.baseUrl) continue;
      try {
        const mime = file.mimeType || 'application/octet-stream';
        const kind = kindFromMime(mime);
        // Picker のバイト取得は baseUrl に '=d'（ダウンロード）を付け、Bearer 付きで fetch する。
        const dl = await fetchWithTimeout(`${file.baseUrl}=d`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!dl.ok) {
          console.warn(`[google photos import] skip (HTTP ${dl.status}): ${file.filename ?? item.id}`);
          continue;
        }
        const bytes = Buffer.from(await dl.arrayBuffer());

        const id = randomUUID();
        const originalName = file.filename || `photo${extFromMime(mime)}`;
        const safe = sanitizeFilename(originalName);
        const filename = `${id}-${safe}`;
        writeFileSync(join(BABY_DIARY_MEDIA_DIR, filename), bytes);

        const meta = appendMedia({
          id,
          date,
          filename,
          originalName,
          mime,
          kind,
          size: bytes.length,
          createdAt: new Date().toISOString(),
        });
        imported.push(meta);
      } catch (fileErr) {
        console.warn(
          `[google photos import] skip ${item.id}:`,
          fileErr instanceof Error ? fileErr.message : String(fileErr),
        );
      }
    }

    res.json({ imported });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ─── 8. Google Drive 自動取り込み（MC-233 Drive 連携）──────────────
//
// Google Photos の自動読み取りは 2025 年に廃止されたため、Drive の指定フォルダを監視して
// その中の画像/動画を「撮影日（無ければ作成日）」ごとに成長日記メディアへ自動取り込みする。
// 既存接続済みトークンは drive.readonly を含まない（再同意するまで Drive 系 API は未許可）ため、
// status は driveScopeGranted:false を返し、folders/import は drive-not-authorized を返して優しく扱う。

/** token の scope に drive.readonly が含まれるか（= 再同意で Drive 読取が付与済みか）。 */
function driveScopeGranted(account: string): boolean {
  const rec = getTokens(account);
  if (!rec) return false;
  // scope はスペース区切り。drive.readonly の完全一致トークンを探す。
  return rec.scope.split(/\s+/).includes(GOOGLE_DRIVE_SCOPE);
}

// ─── 8-1. GET /drive/status ──────────────────────────────
// 接続アカウントごとに設定状況と driveScopeGranted を返す。

function handleDriveStatus(_req: Request, res: Response): void {
  if (!requireConfigured(res)) return;
  const configs = new Map(listDriveConfigs().map((c) => [c.account, c]));
  const accounts = listAccounts().map((acc) => {
    const cfg = configs.get(acc.email);
    return {
      account: acc.email,
      configured: Boolean(cfg),
      ...(cfg?.folderName !== undefined ? { folderName: cfg.folderName } : {}),
      autoImport: cfg?.autoImport ?? false,
      ...(cfg?.lastImportAt !== undefined ? { lastImportAt: cfg.lastImportAt } : {}),
      driveScopeGranted: driveScopeGranted(acc.email),
    };
  });
  res.json({ accounts });
}

// ─── 8-2. GET /drive/folders?account= ────────────────────
// 指定アカウントの Drive フォルダ一覧（name 順・最大 100）。drive 未許可なら 403。

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  createdTime?: string;
  imageMediaMetadata?: { time?: string };
  videoMediaMetadata?: Record<string, unknown>;
}
interface DriveFileListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

async function handleDriveFolders(req: Request, res: Response): Promise<void> {
  if (!requireConfigured(res)) return;
  const account = typeof req.query.account === 'string' ? req.query.account : '';
  if (!account) {
    res.status(400).json({ error: 'account is required' });
    return;
  }
  if (!driveScopeGranted(account)) {
    res.status(403).json({ error: 'drive-not-authorized' });
    return;
  }
  try {
    const accessToken = await getValidAccessToken(account);
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id,name)',
      pageSize: '100',
      orderBy: 'name',
    });
    const data = await googleGet<DriveFileListResponse>(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      accessToken,
    );
    const folders = (data.files ?? [])
      .filter((f) => f.id && f.name)
      .map((f) => ({ id: f.id as string, name: f.name as string }));
    res.json({ folders });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ─── 8-3. POST /drive/config ─────────────────────────────
// 監視フォルダ設定を upsert する。

function handleDriveConfig(req: Request, res: Response): void {
  if (!requireConfigured(res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const account = typeof body.account === 'string' ? body.account : '';
  const folderId = typeof body.folderId === 'string' ? body.folderId : '';
  const folderName = typeof body.folderName === 'string' ? body.folderName : '';
  const autoImport = typeof body.autoImport === 'boolean' ? body.autoImport : undefined;

  if (!account) {
    res.status(400).json({ error: 'account is required' });
    return;
  }
  if (!folderId) {
    res.status(400).json({ error: 'folderId is required' });
    return;
  }
  if (!folderName) {
    res.status(400).json({ error: 'folderName is required' });
    return;
  }
  setDriveConfig({ account, folderId, folderName, autoImport });
  res.json({ ok: true });
}

// ─── 8-4. POST /drive/import ─────────────────────────────
// 監視フォルダ内の画像/動画を「撮影日（無ければ作成日）」ごとに取り込む。

/**
 * Drive ファイルの撮影日を YYYY-MM-DD（JST）で決める。
 *  - imageMediaMetadata.time（'YYYY:MM:DD HH:MM:SS' = 撮影時刻・タイムゾーン無し）優先。
 *    EXIF の撮影時刻はカメラのローカル時刻として「そのままの日付」を採用する（JST 端末想定）。
 *  - 無ければ createdTime（ISO8601・UTC）を JST（+9h）に換算した日付。
 *  - いずれも取れなければ undefined。
 */
function decideShotDate(file: DriveFile): string | undefined {
  const exif = file.imageMediaMetadata?.time;
  if (typeof exif === 'string') {
    // 'YYYY:MM:DD HH:MM:SS' の日付部のみ採用（ローカル撮影時刻＝端末の日付をそのまま使う）。
    const m = exif.match(/^(\d{4}):(\d{2}):(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (typeof file.createdTime === 'string') {
    const ms = Date.parse(file.createdTime);
    if (Number.isFinite(ms)) {
      // UTC → JST（+9h）に換算してから日付部を取る。
      const jst = new Date(ms + 9 * 60 * 60 * 1000);
      return jst.toISOString().slice(0, 10);
    }
  }
  return undefined;
}

async function handleDriveImport(req: Request, res: Response): Promise<void> {
  if (!requireConfigured(res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const account = typeof body.account === 'string' ? body.account : '';
  if (!account) {
    res.status(400).json({ error: 'account is required' });
    return;
  }
  if (!driveScopeGranted(account)) {
    res.status(403).json({ error: 'drive-not-authorized' });
    return;
  }
  const cfg = getDriveConfig(account);
  if (!cfg) {
    res.status(400).json({ error: 'folder-not-configured' });
    return;
  }

  try {
    const accessToken = await getValidAccessToken(account);

    // 監視フォルダ内の画像/動画を列挙（ページネーション対応・最大 ~500）。
    const escapedFolderId = cfg.folderId.replace(/'/g, "\\'");
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    const MAX_FILES = 500;
    do {
      const params = new URLSearchParams({
        q: `'${escapedFolderId}' in parents and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')`,
        fields:
          'nextPageToken,files(id,name,mimeType,createdTime,imageMediaMetadata(time),videoMediaMetadata)',
        pageSize: '100',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await googleGet<DriveFileListResponse>(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
        accessToken,
      );
      for (const f of page.files ?? []) {
        files.push(f);
        if (files.length >= MAX_FILES) break;
      }
      pageToken = files.length >= MAX_FILES ? undefined : page.nextPageToken;
    } while (pageToken);

    mkdirSync(BABY_DIARY_MEDIA_DIR, { recursive: true });

    let imported = 0;
    let skipped = 0;
    const items: { date: string; originalName: string }[] = [];

    for (const file of files) {
      const driveFileId = file.id;
      if (!driveFileId) {
        skipped++;
        continue;
      }
      // 重複取り込み防止: 取り込み済みは skip。
      if (isDriveImported(account, driveFileId)) {
        skipped++;
        continue;
      }
      try {
        const mime = file.mimeType || 'application/octet-stream';
        const kind = kindFromMime(mime);
        const date = decideShotDate(file);
        if (!date) {
          console.warn(`[google drive import] skip (no date): ${file.name ?? driveFileId}`);
          skipped++;
          continue;
        }

        // バイト取得（1 ファイルずつ・Bearer 付き alt=media）。
        const dl = await fetchWithTimeout(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!dl.ok) {
          console.warn(
            `[google drive import] skip (HTTP ${dl.status}): ${file.name ?? driveFileId}`,
          );
          skipped++;
          continue;
        }
        const bytes = Buffer.from(await dl.arrayBuffer());

        const id = randomUUID();
        const originalName = file.name || `drive${extFromMime(mime)}`;
        const safe = sanitizeFilename(originalName);
        const filename = `${id}-${safe}`;
        writeFileSync(join(BABY_DIARY_MEDIA_DIR, filename), bytes);

        const meta = appendMedia({
          id,
          date,
          filename,
          originalName,
          mime,
          kind,
          size: bytes.length,
          createdAt: new Date().toISOString(),
        });
        markDriveImported(account, driveFileId, meta.id);
        imported++;
        items.push({ date, originalName });
      } catch (fileErr) {
        console.warn(
          `[google drive import] skip ${file.id}:`,
          fileErr instanceof Error ? fileErr.message : String(fileErr),
        );
        skipped++;
      }
    }

    // lastImportAt 更新（既存設定を維持しつつ最終取り込み時刻のみ更新）。
    setDriveConfig({
      account,
      folderId: cfg.folderId,
      folderName: cfg.folderName,
      autoImport: cfg.autoImport,
      lastImportAt: new Date().toISOString(),
    });

    res.json({ imported, skipped, items });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ─── 9. GET /tasks（MC-233 Tasks 連携）──────────────────────
//
// 接続済み全アカウント横断で Google Tasks（期日付きタスク）を取得する（部分劣化）。
// 既存接続済みトークンは tasks.readonly を含まない（再同意するまで Tasks 系 API は未許可）ため、
// scope に tasks.readonly が無いアカウントは API を叩かず errors に 'tasks-not-authorized' で畳む
// （無駄な 401 を避け、全アカ未許可でも 200 で { tasks:[], errors:[...] } を返す）。
//
// 取得対象は due（期日）がある未完了タスクのみ。due は RFC3339（UTC 0 時表現が多い）なので、
// JST の YYYY-MM-DD は date 部分（先頭 10 文字）をそのまま採用する。

/** token の scope に tasks.readonly が含まれるか（= 再同意で Tasks 読取が付与済みか）。 */
function tasksScopeGranted(account: string): boolean {
  const rec = getTokens(account);
  if (!rec) return false;
  // scope はスペース区切り。tasks.readonly の完全一致トークンを探す。
  return rec.scope.split(/\s+/).includes(GOOGLE_TASKS_SCOPE);
}

interface GTaskList {
  id?: string;
  title?: string;
}
interface GTaskListsResponse {
  items?: GTaskList[];
}
interface GTask {
  id?: string;
  title?: string;
  due?: string;
  status?: string;
  notes?: string;
}
interface GTasksResponse {
  items?: GTask[];
}

interface NormalizedTask {
  id: string;
  account: string;
  title: string;
  /** 期日（JST YYYY-MM-DD）。Google Tasks では任意なので、未設定のタスクでは省略する。 */
  due?: string;
  status: string;
  notes?: string;
  listTitle: string;
  /** タスクリストの並び順（tasklists.list の返却順＝ユーザのアプリ上の順）。グループ表示順に使う。 */
  listOrder: number;
}

/**
 * Google Tasks の due（RFC3339・実質 UTC 0 時の日付表現）を JST の YYYY-MM-DD に正規化する。
 * Tasks の due は時刻情報を持たず日付として扱う仕様のため、date 部分（先頭 10 文字）を採用する。
 */
function normalizeTaskDue(due: string): string | undefined {
  const m = due.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

async function handleTasksList(req: Request, res: Response): Promise<void> {
  if (!requireConfigured(res)) return;

  // timeMin/timeMax は受理する（クライアント互換のため）。Tasks API では list 取得後に
  // due で絞り込めるが、まずは due 有り未完了の正規化に徹し、範囲指定はクライアント側で扱える形にする。
  void req.query.timeMin;
  void req.query.timeMax;

  const accounts = listAccounts();
  const tasks: NormalizedTask[] = [];
  const errors: { account: string; error: string }[] = [];

  await Promise.all(
    accounts.map(async (acc) => {
      // tasks 未許可アカウントは API を叩かず errors に畳む（無駄な 401 回避）。
      if (!tasksScopeGranted(acc.email)) {
        errors.push({ account: acc.email, error: 'tasks-not-authorized' });
        return;
      }
      try {
        const accessToken = await getValidAccessToken(acc.email);
        // タスクリスト一覧を取得。
        const lists = await googleGet<GTaskListsResponse>(
          'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
          accessToken,
        );
        // 各リストのタスクを取得（未完了・非表示除外・最大 100）。
        // lists.items の順＝tasklists.list 返却順＝ユーザのアプリ上のリスト並び順。
        const listItems = lists.items ?? [];
        for (let listIdx = 0; listIdx < listItems.length; listIdx++) {
          const list = listItems[listIdx];
          const listId = list.id;
          if (!listId) continue;
          const listTitle = list.title ?? '(無題リスト)';
          const params = new URLSearchParams({
            showCompleted: 'false',
            showHidden: 'false',
            maxResults: '100',
          });
          const data = await googleGet<GTasksResponse>(
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?${params.toString()}`,
            accessToken,
          );
          for (const t of data.items ?? []) {
            // due があれば JST 日付に正規化。無ければ「期日なし」タスクとして due を省略して含める。
            const due = t.due ? normalizeTaskDue(t.due) : undefined;
            tasks.push({
              id: t.id ?? '',
              account: acc.email,
              title: t.title ?? '(無題)',
              ...(due ? { due } : {}),
              status: t.status ?? 'needsAction',
              ...(t.notes ? { notes: t.notes } : {}),
              listTitle,
              listOrder: listIdx,
            });
          }
        }
      } catch (e) {
        errors.push({ account: acc.email, error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  // due 昇順（同 due はタイトル）で全アカウント混在ソート。期日なし（due 省略）は末尾へ。
  tasks.sort((a, b) => {
    if (a.due && b.due) {
      if (a.due !== b.due) return a.due.localeCompare(b.due);
      return a.title.localeCompare(b.title);
    }
    if (a.due) return -1; // 期日あり < 期日なし
    if (b.due) return 1;
    return a.title.localeCompare(b.title);
  });

  res.json({ tasks, ...(errors.length > 0 ? { errors } : {}) });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/google 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function googleRouter(): Router {
  const router = Router();

  router.get('/status', handleStatus);
  router.get('/oauth/start', handleOAuthStart);
  router.get('/oauth/callback', (req, res) => void handleOAuthCallback(req, res));
  router.delete('/accounts/:email', handleRemoveAccount);

  router.get('/calendar/events', (req, res) => void handleCalendarList(req, res));
  router.post('/calendar/events', (req, res) => void handleCalendarCreate(req, res));

  router.post('/photos/picker/session', (req, res) => void handlePickerCreate(req, res));
  router.get('/photos/picker/session/:sessionId', (req, res) => void handlePickerPoll(req, res));
  router.post('/photos/picker/import', (req, res) => void handlePickerImport(req, res));

  router.get('/tasks', (req, res) => void handleTasksList(req, res));

  router.get('/drive/status', handleDriveStatus);
  router.get('/drive/folders', (req, res) => void handleDriveFolders(req, res));
  router.post('/drive/config', handleDriveConfig);
  router.post('/drive/import', (req, res) => void handleDriveImport(req, res));

  return router;
}
