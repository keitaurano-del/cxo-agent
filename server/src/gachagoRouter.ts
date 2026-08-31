// gachagoRouter — GachaGo 需要検証LPの公開API（MC-488）。
//
// 目的: 広告流入の需要を測るための「待ち登録（waitlist）」受け皿。サイト全体は
// MC_TOKEN 認証で保護されているが、このルーターと /gachago* 静的LPだけは
// auth.ts の PUBLIC_PATH_PREFIXES で認証免除にしている（一般訪問者が開けるように）。
//
//  POST /api/gachago/waitlist  : { email, country?, utm?, ref? } を検証して JSONL に追記。
//      返り値 { ok, count }。email 必須・簡易バリデーション・同一emailは重複追記しない。
//  GET  /api/gachago/waitlist/count : { count }（社会的証明の「N人が待機中」表示用）。
//
// データは data/gachago-waitlist.jsonl（gitignore 配下・再起動で消えない・非コミット）。
// 書き込みは追記のみ。悪用対策として email/文字列長に上限を設ける。

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Router, type Request, type Response } from 'express';

import { INBOX_DATA_DIR } from './config.js';

const WAITLIST_FILE = join(INBOX_DATA_DIR, 'gachago-waitlist.jsonl');

// ざっくりした email 形式チェック（厳密 RFC ではなく、明白な誤入力を弾く程度）。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface WaitlistRecord {
  email: string;
  country?: string;
  utm?: Record<string, string>;
  ref?: string;
  ua?: string;
  ts: string;
}

function clip(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

/** JSONL を全レコード配列として読む（壊れた行はスキップ）。無ければ空配列。 */
function loadRecords(): WaitlistRecord[] {
  const out: WaitlistRecord[] = [];
  try {
    if (!existsSync(WAITLIST_FILE)) return out;
    const raw = readFileSync(WAITLIST_FILE, 'utf8');
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s) as Partial<WaitlistRecord>;
        if (rec.email) out.push(rec as WaitlistRecord);
      } catch {
        /* 壊れた行はスキップ */
      }
    }
  } catch {
    /* 読めなければ空配列 */
  }
  return out;
}

/** 既存の登録 email 集合を読む（重複判定＋カウント用）。 */
function loadEmails(): Set<string> {
  const set = new Set<string>();
  for (const rec of loadRecords()) set.add(String(rec.email).toLowerCase());
  return set;
}

/** 登録レコードを広告キャンペーン別に集計する（需要分析の中核・MC-488）。 */
function computeStats() {
  const seen = new Set<string>();
  const unique: WaitlistRecord[] = [];
  for (const r of loadRecords()) {
    const key = String(r.email).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }

  const tally = (pick: (r: WaitlistRecord) => string | undefined) => {
    const m = new Map<string, number>();
    for (const r of unique) {
      const k = (pick(r) || '(none)').toLowerCase();
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
  };

  const recent = [...unique]
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    .slice(0, 30)
    .map((r) => ({
      email: r.email,
      ts: r.ts,
      country: r.country,
      utm_source: r.utm?.utm_source,
      utm_campaign: r.utm?.utm_campaign,
      ref: r.ref,
    }));

  return {
    total: unique.length,
    bySource: tally((r) => r.utm?.utm_source),
    byCampaign: tally((r) => r.utm?.utm_campaign),
    byMedium: tally((r) => r.utm?.utm_medium),
    byCountry: tally((r) => r.country),
    byDay: tally((r) => (r.ts ? r.ts.slice(0, 10) : undefined)),
    recent,
  };
}

export function gachagoRouter(): Router {
  const router = Router();

  router.post('/waitlist', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const emailRaw = clip(body.email, 254);
    const email = emailRaw ? emailRaw.toLowerCase() : undefined;
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ ok: false, error: 'invalid_email' });
      return;
    }

    const emails = loadEmails();
    if (emails.has(email)) {
      // 既登録は成功扱い（冪等）。件数はそのまま返す。
      res.json({ ok: true, count: emails.size, already: true });
      return;
    }

    // utm_* を最大 6 個・各値 120 文字までで拾う。
    const utm: Record<string, string> = {};
    if (body.utm && typeof body.utm === 'object') {
      let n = 0;
      for (const [k, v] of Object.entries(body.utm as Record<string, unknown>)) {
        if (n >= 6) break;
        const val = clip(v, 120);
        if (val && /^utm_[a-z]+$/i.test(k)) {
          utm[k.toLowerCase()] = val;
          n++;
        }
      }
    }

    const rec: WaitlistRecord = {
      email,
      country: clip(body.country, 60),
      utm: Object.keys(utm).length ? utm : undefined,
      ref: clip(body.ref, 300),
      ua: clip(req.headers['user-agent'], 300),
      ts: new Date().toISOString(),
    };

    try {
      const dir = dirname(WAITLIST_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(WAITLIST_FILE, JSON.stringify(rec) + '\n', 'utf8');
    } catch {
      res.status(500).json({ ok: false, error: 'write_failed' });
      return;
    }

    res.json({ ok: true, count: emails.size + 1 });
  });

  router.get('/waitlist/count', (_req: Request, res: Response) => {
    res.json({ count: loadEmails().size });
  });

  // 需要分析ダッシュボード用の集計（広告キャンペーン別・国別・日別＋直近登録）。
  // /api/gachago/stats は PUBLIC_PATH_EXACT に含めない＝MC_TOKEN 保護下。
  // 登録者 email を含むため、一般公開せず Keita/管理のみが閲覧できる。
  router.get('/stats', (_req: Request, res: Response) => {
    res.json(computeStats());
  });

  return router;
}
