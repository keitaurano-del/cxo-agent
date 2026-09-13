// daytradeRouter — daytrade-bot 独立ダッシュボードへの read-only プロキシ（2026-09-14 Keita 依頼）。
//
// 目的: /home/dev/projects/daytrade-bot の米国株デイトレ自動売買ボットには
// stdlib http.server 製の読み取り専用ダッシュボード（127.0.0.1:8930）があり、
// JSON API（/api/summary・/api/trades・/api/log）を持つ。これを Apollo の
// Bearer 認証（makeAuthMiddleware）配下から見られるように、固定 3 ルートだけを
// 中継する。ワイルドカード proxy にはしない（上流が増えたらルートを明示追加する）。
//
//  GET /api/daytrade/summary : 運用モード・当日PnL・キルスイッチ・基準資金・
//                              バックテスト成績・銘柄別・エクイティカーブ
//  GET /api/daytrade/trades  : 全トレード履歴（バックテスト＋ペーパー/ライブ）
//  GET /api/daytrade/log     : ボットログ末尾
//
//  堅牢性:
//    - 上流 8930 が落ちている/タイムアウト時は 502 { error } を返す（フロントは
//      これを「ダッシュボード停止中」表示に使う）。500 と区別するため 502 固定。
//    - 上流 fetch は 10 秒タイムアウト。
//    - 上流応答はそのまま透過（整形しない）。表示都合の加工はフロント側で行う。

import { Router, type Request, type Response } from 'express';

/** daytrade-bot ダッシュボードのベース URL。同一ホストの :8930 を既定とする。 */
const DAYTRADE_API_BASE = process.env.DAYTRADE_API_BASE?.trim() || 'http://127.0.0.1:8930';
const FETCH_TIMEOUT_MS = 10_000;

/** 中継を許可する上流パス（allowlist）。 */
const UPSTREAM_PATHS: Record<string, string> = {
  summary: '/api/summary',
  trades: '/api/trades',
  log: '/api/log',
};

async function proxyGet(upstreamPath: string, res: Response): Promise<void> {
  try {
    const upstream = await fetch(`${DAYTRADE_API_BASE}${upstreamPath}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      res.status(502).json({
        error: 'daytrade-dashboard-error',
        detail: `上流が HTTP ${upstream.status} を返しました`,
      });
      return;
    }
    const body = (await upstream.json()) as unknown;
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  } catch {
    // 接続拒否・タイムアウト・非 JSON はすべて「上流ダッシュボード停止中」として扱う。
    res.status(502).json({
      error: 'daytrade-dashboard-unreachable',
      detail: 'daytrade-bot ダッシュボード（127.0.0.1:8930）に接続できません',
    });
  }
}

export function daytradeRouter(): Router {
  const router = Router();
  for (const [name, upstreamPath] of Object.entries(UPSTREAM_PATHS)) {
    router.get(`/${name}`, (_req: Request, res: Response) => {
      void proxyGet(upstreamPath, res);
    });
  }
  return router;
}
