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

/** 設定トークン。空文字/未設定なら null（= 認証無効）。 */
function configuredToken(): string | null {
  const v = process.env.MC_TOKEN;
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

function send401(req: Request, res: Response): void {
  if (wantsHtml(req)) {
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
 * 認証ミドルウェアを生成する。
 * @param healthzPath 認証を免除する軽量ヘルスチェックのパス（systemd 用）。
 */
export function makeAuthMiddleware(healthzPath: string) {
  const token = configuredToken();

  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    // ヘルスチェックは常に素通り（無認証）。
    if (req.path === healthzPath) {
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
          maxAge: 1000 * 60 * 60 * 24 * 30, // 30 日
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
    const presented = tokenFromBearer(req) ?? tokenFromCookie(req);
    if (presented !== null && safeEqual(presented, token)) {
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
