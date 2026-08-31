// token 認証ミドルウェア。
//
// 公開 URL で安全に開けるようにするための最小認証。MC_TOKEN（env）が設定されていれば
// 全ルート（/api/* ・SSE ・静的配信 ・SPA fallback）を保護する。未設定なら認証無効
// （ローカル開発用）＋起動時 warning。
//
// 受理経路（いずれか一致で通過）:
//   - Authorization: Bearer <token>
//   - クエリ ?token=<token>（EventSource / ブラウザ直アクセス用）
//   - Cookie mc_token=<token>
//
// 1クリック体験: クエリ token が正しければ httpOnly+SameSite=Lax Cookie を発行し、
// クエリ無しの綺麗な URL へ 302 リダイレクト。以後は Cookie で通る。
//
// トークン比較は crypto.timingSafeEqual による時間一定比較（長さ違いも安全に扱う）。

import { timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const COOKIE_NAME = 'mc_token';

// Cookie 寿命は 400 日（Chrome の Max-Age 上限）。加えて authMiddleware が
// Cookie 認証成功のたびに同じ寿命で再発行（スライド更新）するため、
// 400 日以内に一度でもアクセスすれば実質無期限で使い続けられる。
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 400;

/** 設定トークン。空文字/未設定なら null（= 認証無効）。 */
function configuredToken(): string | null {
  const v = process.env.MC_TOKEN;
  return v && v.trim() !== '' ? v : null;
}

/** ログイン画面用パスワード（MC_PASSWORD）。空文字/未設定なら null（= ログイン画面無効）。 */
function configuredPassword(): string | null {
  const v = process.env.MC_PASSWORD;
  return v && v.trim() !== '' ? v : null;
}

/**
 * 長さに依存しない時間一定比較。
 * timingSafeEqual は長さが違うと throw するため、両者を SHA-256 で固定長化してから比較する。
 * （ハッシュ化により長さ情報もリークしない。）
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Cookie ヘッダから mc_token を取り出す（cookie-parser 非依存の最小実装）。 */
function tokenFromCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === COOKIE_NAME) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Authorization: Bearer <token> から取り出す。 */
function tokenFromBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** クエリ ?token=... から取り出す。 */
function tokenFromQuery(req: Request): string | null {
  const q = req.query.token;
  if (typeof q === 'string' && q !== '') return q;
  return null;
}

/** HTML 要求か（Accept ヘッダで判定）。失敗時は JSON で返す。 */
function wantsHtml(req: Request): boolean {
  const accept = req.headers.accept ?? '';
  return accept.includes('text/html');
}

/** パスワードログイン画面（MC_PASSWORD 設定時に HTML 要求の 401 で表示）。 */
function loginPage(showError: boolean): string {
  const error = showError
    ? '<p style="color:#f38ba8;margin:0 0 12px;font-size:14px">パスワードが違います</p>'
    : '';
  return (
    '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Apollo — ログイン</title></head>' +
    '<body style="font-family:system-ui,sans-serif;background:#0b0e14;color:#e6e6e6;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
    '<form method="post" action="/login" style="text-align:center;padding:24px">' +
    '<h1 style="font-size:28px;margin:0 0 20px">Apollo</h1>' +
    error +
    '<input type="password" name="password" autofocus autocomplete="current-password" ' +
    'placeholder="パスワード" style="font-size:16px;padding:10px 12px;border-radius:8px;' +
    'border:1px solid #3a4a6a;background:#192231;color:#e6e6e6;width:220px;outline:none">' +
    '<br><button type="submit" style="margin-top:14px;font-size:15px;padding:10px 28px;' +
    'border-radius:8px;border:none;background:#89b4fa;color:#0b0e14;cursor:pointer">' +
    'ログイン</button></form></body></html>'
  );
}

function send401(req: Request, res: Response): void {
  if (wantsHtml(req)) {
    // MC_PASSWORD 設定時はログインフォームを返す（ブラウザからの再認証経路）。
    if (configuredPassword() !== null) {
      res.status(401).type('html').send(loginPage(false));
      return;
    }
    res
      .status(401)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>401 Unauthorized</title>' +
          '<body style="font-family:system-ui,sans-serif;background:#0b0e14;color:#e6e6e6;' +
          'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
          '<div style="text-align:center"><h1 style="font-size:48px;margin:0">401</h1>' +
          '<p>Unauthorized — valid access token required.</p></div></body>',
      );
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

/**
 * POST /login ハンドラ（auth ミドルウェアの外に登録する）。
 * MC_PASSWORD（または MC_TOKEN そのもの）一致で mc_token Cookie を発行し / へ 302。
 * 不一致はログインフォームをエラー付きで再表示。express.urlencoded を通した後で呼ぶこと。
 */
export function loginHandler(req: Request, res: Response): void {
  const token = configuredToken();
  if (!token) {
    // 認証無効（ローカル開発）ならログイン不要。
    res.redirect(302, '/');
    return;
  }
  const password = configuredPassword();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const presented = typeof body.password === 'string' ? body.password : '';
  const ok =
    presented !== '' &&
    ((password !== null && safeEqual(presented, password)) || safeEqual(presented, token));
  if (ok) {
    res.cookie?.(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE_MS,
    });
    res.redirect(302, '/');
    return;
  }
  res.status(401).type('html').send(loginPage(true));
}

/**
 * 認証ミドルウェアを生成する。
 * @param healthzPath 認証を免除する軽量ヘルスチェックのパス（systemd 用）。
 */
// 認証を免除する公開パス（MC-488）。
//  - /gachago（接頭辞）: 需要検証LPの静的配信（gachago.html / gachago-og.png 等）。
// 広告流入の一般訪問者は MC_TOKEN を持たないため、これだけトークン無しで開ける。
const PUBLIC_PATH_PREFIXES = ['/gachago'];

// API は「一般訪問者が叩く必要のある2本」だけを完全一致で公開する。
//  - POST /api/gachago/waitlist       : 待ち登録の受け皿。
//  - GET  /api/gachago/waitlist/count : 「N人が待機中」の社会的証明表示用。
// これ以外の /api/gachago/*（需要分析の stats/report など・登録者emailを含む）は
// 従来どおり MC_TOKEN 保護に残す。接頭辞公開だと集計/emailが漏れるため完全一致に限定。
const PUBLIC_PATH_EXACT = ['/api/gachago/waitlist', '/api/gachago/waitlist/count', '/gachago-og.png'];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATH_EXACT.includes(path)) return true;
  return PUBLIC_PATH_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '.'));
}

export function makeAuthMiddleware(healthzPath: string) {
  const token = configuredToken();

  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    // ヘルスチェック・公開LP/APIは常に素通り（無認証）。
    if (req.path === healthzPath || isPublicPath(req.path)) {
      next();
      return;
    }

    // MC_TOKEN 未設定 = 認証無効（ローカル開発）。全通過。
    if (!token) {
      next();
      return;
    }

    // 1) クエリ token: 正しければ Cookie 発行 → クエリ無し URL へ 302（1クリック体験）。
    const qToken = tokenFromQuery(req);
    if (qToken !== null) {
      if (safeEqual(qToken, token)) {
        res.cookie?.(COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: COOKIE_MAX_AGE_MS,
        });
        // クエリから token を除いた綺麗な URL を作って 302。
        const url = new URL(req.originalUrl, 'http://placeholder');
        url.searchParams.delete('token');
        const clean = url.pathname + (url.search === '?' ? '' : url.search);
        res.redirect(302, clean || '/');
        return;
      }
      // クエリ token が不一致なら下の経路に落とさず即 401（明示的な誤提示）。
      send401(req, res);
      return;
    }

    // 2) Bearer / Cookie のいずれかで一致すれば通過。
    const bearer = tokenFromBearer(req);
    const presented = bearer ?? tokenFromCookie(req);
    if (presented !== null && safeEqual(presented, token)) {
      // Cookie 認証はアクセスのたびに寿命をスライド更新（実質無期限化）。
      // Bearer（エージェント/cron）には Cookie を発行しない。
      if (bearer === null) {
        res.cookie?.(COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: COOKIE_MAX_AGE_MS,
        });
      }
      next();
      return;
    }

    send401(req, res);
  };
}

/** 認証が有効か（= MC_TOKEN 設定済みか）。起動ログ用。 */
export function authEnabled(): boolean {
  return configuredToken() !== null;
}

/**
 * WebSocket upgrade 経路用の認証チェッカ。
 *
 * Express の通常ミドルウェア（makeAuthMiddleware）は HTTP リクエストにしか走らず、
 * `server.on('upgrade')` の WS ハンドシェイクには適用されない。proxy 越しに ttyd へ
 * WS を流す前に、ここで token/Cookie/Bearer を同じ強度（timingSafe）で検証する。
 * これが抜けると WS 経路だけ無認証で素通りするため、/terminal の最重要ゲート。
 *
 * - MC_TOKEN 未設定なら常に true（ローカル開発・既存挙動と一致）。
 * - クエリ ?token= / Authorization: Bearer / Cookie mc_token のいずれか一致で true。
 *   （WS では Cookie が最も実用的。ブラウザは upgrade に Cookie を自動付与する。）
 */
export function isRequestAuthorized(req: {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}): boolean {
  const token = configuredToken();
  if (!token) return true; // 認証無効（ローカル開発）

  // Bearer
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string') {
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m && safeEqual(m[1].trim(), token)) return true;
  }

  // Cookie mc_token
  const cookieHeader = req.headers['cookie'];
  if (typeof cookieHeader === 'string') {
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === COOKIE_NAME) {
        const v = decodeURIComponent(part.slice(idx + 1).trim());
        if (safeEqual(v, token)) return true;
      }
    }
  }

  // クエリ ?token=
  if (req.url) {
    try {
      const u = new URL(req.url, 'http://placeholder');
      const q = u.searchParams.get('token');
      if (q && safeEqual(q, token)) return true;
    } catch {
      /* malformed url → 認可しない */
    }
  }

  return false;
}
