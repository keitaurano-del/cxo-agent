// babyPiyologStore — ぴよログ（PiyoLog）エクスポートの取り込み・日次レコードの JSONL ストア。
//
// データストア（data/ 配下・.gitignore 済み）:
//   data/baby-piyolog-days.jsonl : ぴよログ日次レコード（追記専用・last-wins by date・論理削除は deleted フラグ）
//
// babyDiaryStore.ts の last-wins パターンに倣う:
//   JSONL を全走査して date ごとの最新レコードを採用し、deleted:true は読み出し時に除外する。
//
// parsePiyolog(text) はぴよログのエクスポートテキストをパースして PiyologDay[] を返す純粋関数。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { BABY_PIYOLOG_FILE } from '../config.js';

// ─── 型 ─────────────────────────────────────────────────

/** ぴよログのイベント 1 件（時刻＋カテゴリ＋元テキスト）。 */
export interface PiyologEvent {
  /** 時刻（"HH:MM"・ゼロ埋め）。 */
  time: string;
  /** カテゴリ（icon 用・下記 classifyKind の戻り値）。 */
  kind: string;
  /** 元テキスト全体（時刻を除いた本文）。 */
  text: string;
}

/** 各「○合計」行の生文字列（あれば）。 */
export interface PiyologSummary {
  breastMilk?: string;
  formula?: string;
  sleep?: string;
  pee?: string;
  poop?: string;
}

/** ぴよログの 1 日分（date が一意キー）。 */
export interface PiyologDay {
  /** 日付（YYYY-MM-DD）。一意キー。 */
  date: string;
  /** 月齢ラベル（例 "ろくいち (0か月6日)"）。 */
  ageLabel?: string;
  /** その日のイベント（time 昇順）。 */
  events: PiyologEvent[];
  /** 合計行の生文字列。 */
  summary?: PiyologSummary;
  /** その日の体重記録（複数可）。 */
  weights: { time: string; kg: number }[];
  /** その日の身長記録（複数可）。 */
  heights: { time: string; cm: number }[];
  /** 作成日時（ISO8601）。 */
  createdAt: string;
  /** 更新日時（ISO8601）。 */
  updatedAt: string;
  /** 論理削除フラグ（true なら GET から除外）。永続用の内部フラグ。 */
  deleted?: boolean;
}

// ─── 汎用 JSONL ヘルパ（last-wins）─────────────────────────

/** JSONL を全走査して date ごとの最新レコードを返す（last-wins）。 */
function readAll(): Map<string, PiyologDay> {
  const map = new Map<string, PiyologDay>();
  if (!existsSync(BABY_PIYOLOG_FILE)) return map;
  let raw: string;
  try {
    raw = readFileSync(BABY_PIYOLOG_FILE, 'utf-8');
  } catch {
    return map;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as PiyologDay;
      if (rec.date) map.set(rec.date, rec);
    } catch {
      // 壊れた行は無視。
    }
  }
  return map;
}

/** JSONL に 1 行追記する。ディレクトリが無ければ作成。 */
function appendRecord(rec: unknown): void {
  const dir = dirname(BABY_PIYOLOG_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(BABY_PIYOLOG_FILE, JSON.stringify(rec) + '\n', 'utf-8');
}

/** 公開形（内部 deleted フラグを落とす）。 */
function strip(rec: PiyologDay): PiyologDay {
  const { deleted: _deleted, ...pub } = rec;
  return pub;
}

// ─── upsert / list ───────────────────────────────────────

/**
 * ぴよログ日次レコードを date キーで upsert する。
 * 既存（削除済み含む）があれば createdAt を引き継ぎ、無ければ now を立てる。
 * updatedAt は常に now。保存後の公開形を返す。
 */
export function upsertPiyologDay(input: {
  date: string;
  ageLabel?: string;
  events: PiyologEvent[];
  summary?: PiyologSummary;
  weights: { time: string; kg: number }[];
  heights: { time: string; cm: number }[];
}): PiyologDay {
  const now = new Date().toISOString();
  const existing = readAll().get(input.date);
  const createdAt = existing?.createdAt ?? now;
  const rec: PiyologDay = {
    date: input.date,
    ...(input.ageLabel !== undefined ? { ageLabel: input.ageLabel } : {}),
    events: input.events,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    weights: input.weights,
    heights: input.heights,
    createdAt,
    updatedAt: now,
    deleted: false,
  };
  appendRecord(rec);
  return strip(rec);
}

/** 生きているぴよログ日次レコードを date 昇順で返す（deleted を除外、内部フラグも落とす）。 */
export function listPiyologDays(): PiyologDay[] {
  const map = readAll();
  const out: PiyologDay[] = [];
  for (const rec of map.values()) {
    if (rec.deleted) continue;
    out.push(strip(rec));
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ─── パーサ ───────────────────────────────────────────────

const DATE_LINE_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*\(.\)/;
const EVENT_LINE_RE = /^(\d{1,2}):(\d{2})\s+(.+?)\s*$/;
const WEIGHT_RE = /体重\s*([\d.]+)\s*kg/;
const HEIGHT_RE = /身長\s*([\d.]+)\s*cm/;

/** 2桁ゼロ埋め。 */
function pad2(s: string): string {
  return s.padStart(2, '0');
}

/**
 * イベント本文 text からカテゴリ（icon 用）を判定する。
 * キーワード包含で判定し、どれにも当たらなければ 'other'。
 * 体重/身長/体温/足サイズなどの計測系を先に判定する（「ミルク」等より具体的なため）。
 */
export function classifyKind(text: string): string {
  if (WEIGHT_RE.test(text) || text.includes('体重')) return 'weight';
  if (HEIGHT_RE.test(text) || text.includes('身長')) return 'height';
  if (text.includes('体温')) return 'temp';
  if (text.includes('足サイズ')) return 'foot';
  if (text.includes('ミルク')) return 'formula';
  if (text.includes('母乳')) return 'breast';
  if (text.includes('おしっこ')) return 'pee';
  if (text.includes('うんち')) return 'poop';
  if (text.includes('お風呂')) return 'bath';
  if (text.includes('起きる')) return 'wake';
  if (text.includes('寝る')) return 'sleep';
  return 'other';
}

/** 合計行（○合計 で始まる行）を summary に振り分ける。当たれば true。 */
function applySummaryLine(summary: PiyologSummary, line: string): boolean {
  if (line.startsWith('母乳合計')) {
    summary.breastMilk = line;
    return true;
  }
  if (line.startsWith('ミルク合計')) {
    summary.formula = line;
    return true;
  }
  if (line.startsWith('睡眠合計')) {
    summary.sleep = line;
    return true;
  }
  if (line.startsWith('おしっこ合計')) {
    summary.pee = line;
    return true;
  }
  if (line.startsWith('うんち合計')) {
    summary.poop = line;
    return true;
  }
  return false;
}

/**
 * ぴよログのエクスポートテキストをパースして PiyologDay[] を返す。
 *
 * パース規則:
 *  - 行 `^-{3,}$`（ダッシュのみ）でブロック分割。
 *  - 先頭の `【ぴよログ】...` 行/ブロックは無視。
 *  - 各ブロック内:
 *     - 日付行（YYYY/M/D(曜)）→ YYYY-MM-DD（ゼロ埋め）。無ければブロックを捨てる。
 *     - 月齢ラベル: 日付の次の、時刻行でも合計行でもない非空行。
 *     - イベント行（HH:MM 本文）→ {time, kind, text}。
 *     - 合計行（○合計）→ summary。
 *     - 体重/身長は対応イベント行から weights/heights へ。
 *  - イベントは time 昇順にソート。
 *
 * createdAt/updatedAt は同一の now（呼び出し側で upsert 時に createdAt が引き継がれる）。
 */
export function parsePiyolog(text: string): PiyologDay[] {
  const now = new Date().toISOString();
  // 改行コードを正規化してブロック分割。
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/^\s*-{3,}\s*$/m);

  const days: PiyologDay[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let date: string | null = null;
    let dateLineIdx = -1;

    // 日付行を探す。
    for (let i = 0; i < lines.length; i++) {
      const m = DATE_LINE_RE.exec(lines[i].trim());
      if (m) {
        date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
        dateLineIdx = i;
        break;
      }
    }
    if (!date) continue; // 日付の無いブロックは捨てる（ヘッダ含む）。

    const events: PiyologEvent[] = [];
    const summary: PiyologSummary = {};
    const weights: { time: string; kg: number }[] = [];
    const heights: { time: string; cm: number }[] = [];
    let ageLabel: string | undefined;
    let ageLabelResolved = false;

    for (let i = dateLineIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;

      // イベント行。
      const ev = EVENT_LINE_RE.exec(trimmed);
      if (ev) {
        ageLabelResolved = true; // 時刻行に達したら以降は月齢ラベル候補にしない。
        const time = `${pad2(ev[1])}:${ev[2]}`;
        const body = ev[3].trim();
        const kind = classifyKind(body);
        events.push({ time, kind, text: body });
        const wm = WEIGHT_RE.exec(body);
        if (wm) {
          const kg = Number(wm[1]);
          if (Number.isFinite(kg)) weights.push({ time, kg });
        }
        const hm = HEIGHT_RE.exec(body);
        if (hm) {
          const cm = Number(hm[1]);
          if (Number.isFinite(cm)) heights.push({ time, cm });
        }
        continue;
      }

      // 合計行。
      if (applySummaryLine(summary, trimmed)) {
        ageLabelResolved = true;
        continue;
      }

      // 月齢ラベル候補（日付直後・時刻行でも合計行でもない最初の非空行）。
      if (!ageLabelResolved && ageLabel === undefined) {
        ageLabel = trimmed;
        continue;
      }
    }

    // イベントは time 昇順にソート。
    events.sort((a, b) => a.time.localeCompare(b.time));

    const day: PiyologDay = {
      date,
      ...(ageLabel !== undefined ? { ageLabel } : {}),
      events,
      ...(Object.keys(summary).length > 0 ? { summary } : {}),
      weights,
      heights,
      createdAt: now,
      updatedAt: now,
    };
    days.push(day);
  }

  // 日付昇順。
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}
