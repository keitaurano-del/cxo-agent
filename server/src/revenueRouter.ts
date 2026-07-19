// revenueRouter — 収益コックピット API（auth ミドルウェア配下）。
//
//  GET /api/revenue/summary
//    ClipItNow（video-dl, localhost:4319）の収益・トラフィックを 1 レスポンスに集約して返す。
//    - 広告収益: ExoClick(/api/exostats) + Adsterra(/api/adstats) の本日/7日実額と日別内訳
//    - ClipItNow: /api/stats の PV/UU/DL（24h/7d）と参照元
//    - PDCA: $HOME/logs/clipitnow-pdca-state.json のサイクル状態（read-only）
//
//  堅牢性:
//    - 上流 1 ソースが落ちても全体を 500 にしない（各セクション available:false で部分返却）。
//    - 上流 fetch は 10 秒タイムアウト。
//    - 60 秒メモリキャッシュ（上流の 5 分キャッシュと合わせ、連打しても上流を叩き続けない）。

import { existsSync, readFileSync } from 'node:fs';
import { Router, type Request, type Response } from 'express';

import { CLIPITNOW_PDCA_STATE_FILE } from './config.js';

/** ClipItNow(video-dl) API のベース URL。同一ホストの :4319 を既定とする。 */
const CLIPITNOW_API_BASE = process.env.CLIPITNOW_API_BASE?.trim() || 'http://localhost:4319';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

// ─── 正規化ヘルパー ────────────────────────────────────────────

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function strOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 上流 JSON API を 1 本取得（失敗/タイムアウト/非 JSON は null＝部分データで続行）。 */
async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${CLIPITNOW_API_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

// ─── レスポンス型 ──────────────────────────────────────────────

interface AdNetworkStats {
  available: boolean;
  todayDate: string;
  todayRevenue: number;
  revenue7d: number;
  impressions7d: number;
  clicks7d: number;
  daily: Array<{ date: string; revenue: number }>;
}

interface RevenueSummary {
  generatedAt: string;
  revenue: {
    /** ExoClick + Adsterra の合算（取得できたソースのみ）。 */
    todayTotal: number;
    total7d: number;
    exoclick: AdNetworkStats;
    adsterra: AdNetworkStats;
    /** 日別合算（スパークライン用・日付昇順）。 */
    daily: Array<{ date: string; exoclick: number; adsterra: number; total: number }>;
  };
  clipitnow: {
    available: boolean;
    pageviews: { h24: number; d7: number };
    visitors: { uu24h: number; uu7d: number };
    downloads: { h24: number; d7: number };
    referrers24h: Array<{ name: string; count: number }>;
  };
  pdca: {
    available: boolean;
    cycle: number;
    phase: string;
    lastReportDate: string | null;
    searchReferrals7d: number;
  };
}

// ─── 各ソースの正規化 ──────────────────────────────────────────

/** exostats / adstats（形はほぼ共通）を AdNetworkStats に正規化。 */
function normAdStats(raw: unknown): AdNetworkStats {
  const o = rec(raw);
  const today = rec(o.today);
  const dailyRaw = Array.isArray(o.daily) ? o.daily : [];
  return {
    available: o.available === true,
    todayDate: strOr(today.date, ''),
    todayRevenue: numOr0(today.revenue),
    revenue7d: numOr0(o.revenue_7d),
    impressions7d: numOr0(o.impressions_7d),
    clicks7d: numOr0(o.clicks_7d),
    daily: dailyRaw
      .map((d) => {
        const r = rec(d);
        return { date: strOr(r.date, ''), revenue: numOr0(r.revenue) };
      })
      .filter((d) => d.date !== ''),
  };
}

/** 取得失敗時の空 AdNetworkStats。 */
function emptyAdStats(): AdNetworkStats {
  return {
    available: false,
    todayDate: '',
    todayRevenue: 0,
    revenue7d: 0,
    impressions7d: 0,
    clicks7d: 0,
    daily: [],
  };
}

/** ExoClick/Adsterra の日別収益を日付でマージ（昇順）。 */
function mergeDaily(
  exo: AdNetworkStats,
  ads: AdNetworkStats,
): Array<{ date: string; exoclick: number; adsterra: number; total: number }> {
  const map = new Map<string, { exoclick: number; adsterra: number }>();
  for (const d of exo.daily) {
    const cur = map.get(d.date) ?? { exoclick: 0, adsterra: 0 };
    cur.exoclick += d.revenue;
    map.set(d.date, cur);
  }
  for (const d of ads.daily) {
    const cur = map.get(d.date) ?? { exoclick: 0, adsterra: 0 };
    cur.adsterra += d.revenue;
    map.set(d.date, cur);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, exoclick: v.exoclick, adsterra: v.adsterra, total: v.exoclick + v.adsterra }));
}

/** ClipItNow /api/stats を正規化（null なら available:false）。 */
function normClipStats(raw: unknown): RevenueSummary['clipitnow'] {
  if (raw == null) {
    return {
      available: false,
      pageviews: { h24: 0, d7: 0 },
      visitors: { uu24h: 0, uu7d: 0 },
      downloads: { h24: 0, d7: 0 },
      referrers24h: [],
    };
  }
  const o = rec(raw);
  const pv = rec(o.pageviews);
  const vis = rec(o.visitors);
  const dl = rec(o.downloads);
  const refs = Array.isArray(o.referrers_24h) ? o.referrers_24h : [];
  return {
    available: true,
    pageviews: { h24: numOr0(pv['24h']), d7: numOr0(pv['7d']) },
    visitors: { uu24h: numOr0(vis.uu_24h), uu7d: numOr0(vis.uu_7d) },
    downloads: { h24: numOr0(dl['24h']), d7: numOr0(dl['7d']) },
    referrers24h: refs
      .map((x) => {
        const r = rec(x);
        return { name: strOr(r.name, ''), count: numOr0(r.count) };
      })
      .filter((x) => x.name !== '')
      .slice(0, 10),
  };
}

/** PDCA 状態ファイル（read-only・無い/壊れは available:false）。 */
function collectPdca(): RevenueSummary['pdca'] {
  const fallback = { available: false, cycle: 0, phase: 'unknown', lastReportDate: null, searchReferrals7d: 0 };
  try {
    if (!existsSync(CLIPITNOW_PDCA_STATE_FILE)) return fallback;
    const parsed = rec(JSON.parse(readFileSync(CLIPITNOW_PDCA_STATE_FILE, 'utf-8')));
    const latest = rec(parsed.latest);
    return {
      available: true,
      cycle: numOr0(parsed.cycle),
      phase: strOr(parsed.phase, 'unknown'),
      lastReportDate: typeof parsed.lastReportDate === 'string' ? parsed.lastReportDate : null,
      searchReferrals7d: numOr0(latest.ref_search),
    };
  } catch {
    return fallback;
  }
}

// ─── 集約本体（60 秒キャッシュ）───────────────────────────────

let cache: { at: number; body: RevenueSummary } | null = null;

async function buildSummary(): Promise<RevenueSummary> {
  // 上流 3 本は並列取得。1 本失敗しても他は活かす（allSettled + fetchJson の null 化）。
  const [statsRaw, exoRaw, adsRaw] = await Promise.all([
    fetchJson('/api/stats'),
    fetchJson('/api/exostats'),
    fetchJson('/api/adstats'),
  ]);

  const exoclick = exoRaw == null ? emptyAdStats() : normAdStats(exoRaw);
  const adsterra = adsRaw == null ? emptyAdStats() : normAdStats(adsRaw);

  return {
    generatedAt: new Date().toISOString(),
    revenue: {
      todayTotal: exoclick.todayRevenue + adsterra.todayRevenue,
      total7d: exoclick.revenue7d + adsterra.revenue7d,
      exoclick,
      adsterra,
      daily: mergeDaily(exoclick, adsterra),
    },
    clipitnow: normClipStats(statsRaw),
    pdca: collectPdca(),
  };
}

export function revenueRouter(): Router {
  const router = Router();

  router.get('/summary', (_req: Request, res: Response) => {
    void (async () => {
      try {
        if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
          res.json(cache.body);
          return;
        }
        const body = await buildSummary();
        cache = { at: Date.now(), body };
        res.json(body);
      } catch (err) {
        // buildSummary 自体は各ソースで fail-soft 済み。ここに来るのは想定外の内部エラーのみ。
        res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
      }
    })();
  });

  return router;
}
