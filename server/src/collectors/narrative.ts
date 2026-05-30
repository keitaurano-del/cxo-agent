// narrative collector
//
// 50-Daily/{briefings,inspections,feedback} の最新日付ファイルの本文と日付を返す。

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NARRATIVE_DIRS } from '../config.js';

export interface NarrativeDoc {
  date: string | null; // YYYY-MM-DD
  file: string | null;
  body: string;
  updated?: string;
}

export interface Narrative {
  briefing: NarrativeDoc;
  inspection: NarrativeDoc;
  feedback: NarrativeDoc;
}

const EMPTY: NarrativeDoc = { date: null, file: null, body: '' };

/** ディレクトリから最新の YYYY-MM-DD.md を選んで読む。 */
function latestDated(dir: string): NarrativeDoc {
  if (!existsSync(dir)) return { ...EMPTY };
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { ...EMPTY };
  }
  const dated = entries
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort(); // 文字列ソートで日付順
  if (dated.length === 0) return { ...EMPTY };
  const file = dated[dated.length - 1];
  const abs = join(dir, file);
  let body = '';
  let updated: string | undefined;
  try {
    body = readFileSync(abs, 'utf-8');
    updated = statSync(abs).mtime.toISOString();
  } catch {
    /* ignore */
  }
  return { date: file.replace(/\.md$/, ''), file, body, updated };
}

export function collectNarrative(): Narrative {
  return {
    briefing: latestDated(NARRATIVE_DIRS.briefing),
    inspection: latestDated(NARRATIVE_DIRS.inspection),
    feedback: latestDated(NARRATIVE_DIRS.feedback),
  };
}
