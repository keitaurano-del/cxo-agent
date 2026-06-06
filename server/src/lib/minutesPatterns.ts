import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { CXO_ROOT } from '../config.js';

const PATTERNS_FILE = join(CXO_ROOT, 'data', 'minutes-patterns.json');

export interface MinutesPattern {
  id: string;
  name: string;
  type: string;
  format: string;
  templateId?: string;
  templateBody?: string;
  instructions?: string;
  createdAt: string;
}

function readPatterns(): MinutesPattern[] {
  try {
    const raw = readFileSync(PATTERNS_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as MinutesPattern[];
  } catch {
    return [];
  }
}

function writePatterns(patterns: MinutesPattern[]): void {
  writeFileSync(PATTERNS_FILE, JSON.stringify(patterns, null, 2));
}

export function listPatterns(): MinutesPattern[] {
  return readPatterns().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function createPattern(
  input: Omit<MinutesPattern, 'id' | 'createdAt'>,
): MinutesPattern {
  const pattern: MinutesPattern = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const patterns = readPatterns();
  patterns.unshift(pattern);
  writePatterns(patterns);
  return pattern;
}

export function deletePattern(id: string): boolean {
  const patterns = readPatterns();
  const filtered = patterns.filter((p) => p.id !== id);
  if (filtered.length === patterns.length) return false;
  writePatterns(filtered);
  return true;
}
