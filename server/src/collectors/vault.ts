// vault collector — Obsidian Vault の read-only 閲覧 API のデータ層。
//
// 提供:
//  - buildTree()           : フォルダ/ファイルの再帰ツリー（md + 主要添付）。
//  - readNote(rel)         : frontmatter + 生 markdown + outgoing/backlinks。
//  - searchVault(q)        : ファイル名 + 本文の全文検索（Node 読み、シェル grep 非依存）。
//  - resolveAttachment(rel): 添付バイナリの絶対パス + content-type。
//
// すべてのパス入力は lib/vaultPath.ts で安全化してから渡す前提
//（このモジュール内でも resolveVaultPath を通すルートは通す）。

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename, relative, sep } from 'node:path';
import {
  VAULT_DIR,
  VAULT_EXCLUDE_DIRS,
  VAULT_TREE_EXTS,
  VAULT_SEARCH_LIMIT,
  VAULT_INDEX_TTL_MS,
} from '../config.js';
import { resolveVaultPath, toVaultRelative } from '../lib/vaultPath.js';

// ─── 型 ───────────────────────────────────────────────

export interface TreeNode {
  name: string;
  path: string; // vault 相対（posix 区切り）
  type: 'dir' | 'file';
  ext?: string; // file のとき拡張子（'.md' 等）
  mtime?: string; // ISO
  children?: TreeNode[];
}

export interface NoteLink {
  /** 元の wikilink ターゲット（[[...]] 内の生テキスト、alias/# を除く）。 */
  target: string;
  /** 表示名（alias があれば alias、無ければ target）。 */
  display: string;
  /** 解決できた vault 相対パス（解決不能なら null = 未解決リンク）。 */
  path: string | null;
  /** 見出しアンカー（# 以降）。無ければ undefined。 */
  heading?: string;
}

export interface Backlink {
  path: string; // 参照元ノートの vault 相対パス
  title: string;
}

export interface NoteResponse {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string; // frontmatter を除いた生 markdown
  mtime: string | null;
  outgoingLinks: NoteLink[];
  backlinks: Backlink[];
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

// ─── frontmatter パース（gray-matter 相当の自前最小実装）──────────

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * 先頭 `---\n ... \n---` ブロックを軽量 YAML としてパースする。
 * 対応: `key: value` / `key:`（空）/ 引用符 / 配列 `[a, b]` / インライン真偽・数値 /
 *       後続インデントのリスト（- item）。ネストした map は文字列のまま保持（read-only 表示用）。
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: raw };

  const block = m[1];
  const body = raw.slice(m[0].length);
  const fm: Record<string, unknown> = {};

  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i += 1;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const kv = line.match(/^([A-Za-z0-9_\-./ ]+?):\s?(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    let valStr = kv[2];

    if (valStr.trim() === '') {
      // 後続のインデントされた `- item` を配列として集める。
      const arr: unknown[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        arr.push(coerceScalar(lines[i].replace(/^\s*-\s+/, '').trim()));
        i += 1;
      }
      fm[key] = arr.length > 0 ? arr : '';
      continue;
    }

    fm[key] = parseValue(valStr.trim());
  }

  return { frontmatter: fm, body };
}

function parseValue(v: string): unknown {
  // インライン配列 [a, b, c]
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => coerceScalar(s.trim()));
  }
  return coerceScalar(v);
}

function coerceScalar(v: string): unknown {
  let s = v;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

// ─── タイトル索引（wikilink 解決用・短期キャッシュ）────────────

interface VaultIndex {
  /** 全 md の vault 相対パス。 */
  mdFiles: string[];
  /** 小文字 basename(拡張子なし) → vault 相対パス（重複時は先勝ち）。 */
  byBasename: Map<string, string>;
  /** 小文字 vault 相対パス(拡張子なし) → vault 相対パス。 */
  byRelPath: Map<string, string>;
  builtAt: number;
}

let indexCache: VaultIndex | null = null;

function buildIndex(): VaultIndex {
  const mdFiles: string[] = [];
  const byBasename = new Map<string, string>();
  const byRelPath = new Map<string, string>();

  walkFiles(VAULT_DIR, (abs) => {
    if (extname(abs).toLowerCase() !== '.md') return;
    const rel = toVaultRelative(abs);
    mdFiles.push(rel);
    const baseNoExt = basename(rel, '.md').toLowerCase();
    if (!byBasename.has(baseNoExt)) byBasename.set(baseNoExt, rel);
    const relNoExt = rel.slice(0, -'.md'.length).toLowerCase();
    byRelPath.set(relNoExt, rel);
  });

  return { mdFiles, byBasename, byRelPath, builtAt: Date.now() };
}

function getIndex(): VaultIndex {
  if (indexCache && Date.now() - indexCache.builtAt < VAULT_INDEX_TTL_MS) {
    return indexCache;
  }
  indexCache = buildIndex();
  return indexCache;
}

/** wikilink ターゲット文字列を vault 相対パスへ解決する。解決不能なら null。 */
function resolveWikilink(target: string): string | null {
  const idx = getIndex();
  const t = target.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (t === '') return null;
  const lower = t.toLowerCase();
  // 1) フルパス一致（拡張子あり/なし両対応）。
  const lowerNoMd = lower.replace(/\.md$/, '');
  if (idx.byRelPath.has(lowerNoMd)) return idx.byRelPath.get(lowerNoMd)!;
  // 2) basename 一致。
  const base = basename(lowerNoMd);
  if (idx.byBasename.has(base)) return idx.byBasename.get(base)!;
  return null;
}

// ─── ファイル走査 ───────────────────────────────────────

/** 除外ディレクトリを避けつつ全ファイルを訪問する（再帰）。 */
function walkFiles(absDir: string, visit: (absFile: string) => void): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (VAULT_EXCLUDE_DIRS.has(ent.name)) continue;
      walkFiles(join(absDir, ent.name), visit);
    } else if (ent.isFile()) {
      visit(join(absDir, ent.name));
    }
  }
}

// ─── ツリー ───────────────────────────────────────────

/** Vault のフォルダ/ファイルツリーを構築する（md + 主要添付、除外ディレクトリは省く）。 */
export function buildTree(): TreeNode {
  function build(absDir: string): TreeNode[] {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const dirs: TreeNode[] = [];
    const files: TreeNode[] = [];

    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.isFile()) continue; // 隠しファイルは出さない
      const abs = join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (VAULT_EXCLUDE_DIRS.has(ent.name)) continue;
        const children = build(abs);
        // 中身（md/添付）が無い空フォルダは省く（ノイズ削減）。
        if (children.length === 0) continue;
        dirs.push({
          name: ent.name,
          path: toVaultRelative(abs),
          type: 'dir',
          children,
        });
      } else if (ent.isFile()) {
        const ext = extname(ent.name).toLowerCase();
        if (!VAULT_TREE_EXTS.has(ext)) continue;
        let mtime: string | undefined;
        try {
          mtime = statSync(abs).mtime.toISOString();
        } catch {
          /* ignore */
        }
        files.push({
          name: ent.name,
          path: toVaultRelative(abs),
          type: 'file',
          ext,
          mtime,
        });
      }
    }

    // フォルダ先・ファイル後、各々名前順。
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
  }

  return {
    name: basename(VAULT_DIR),
    path: '',
    type: 'dir',
    children: existsSync(VAULT_DIR) ? build(VAULT_DIR) : [],
  };
}

// ─── ノート読み込み ─────────────────────────────────────

/** ノートのタイトルを決める: frontmatter.title → 先頭 H1 → basename。 */
function deriveTitle(rel: string, fm: Record<string, unknown>, body: string): string {
  if (typeof fm.title === 'string' && fm.title.trim() !== '') return fm.title.trim();
  const h1 = body.match(/^\s*#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return basename(rel, extname(rel));
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** 本文から wikilink を抽出して解決する（コードフェンス内は除外）。 */
function extractOutgoingLinks(body: string): NoteLink[] {
  // コードフェンス（``` ... ```）と インラインコードを除いた本文でリンク抽出。
  const withoutFences = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '');

  const links: NoteLink[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(withoutFences)) !== null) {
    const inner = m[1];
    // [[target#heading|alias]] を分解。
    const aliasSplit = inner.split('|');
    const targetPart = aliasSplit[0];
    const alias = aliasSplit[1]?.trim();
    const headingSplit = targetPart.split('#');
    const target = headingSplit[0].trim();
    const heading = headingSplit[1]?.trim();

    const key = `${target}#${heading ?? ''}|${alias ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    links.push({
      target,
      display: alias || (heading ? `${target} › ${heading}` : target),
      path: target === '' ? null : resolveWikilink(target),
      heading,
    });
  }
  return links;
}

/** あるノートを指す backlink を全 md から収集する。 */
function collectBacklinks(targetRel: string): Backlink[] {
  const idx = getIndex();
  const targetBaseLower = basename(targetRel, '.md').toLowerCase();
  const targetRelLower = targetRel.slice(0, -'.md'.length).toLowerCase();
  const out: Backlink[] = [];

  for (const rel of idx.mdFiles) {
    if (rel === targetRel) continue;
    let raw: string;
    try {
      raw = readFileSync(join(VAULT_DIR, rel), 'utf-8');
    } catch {
      continue;
    }
    if (!raw.includes('[[')) continue;
    let hit = false;
    let m: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(raw)) !== null) {
      const target = m[1].split('|')[0].split('#')[0].trim();
      if (target === '') continue;
      const tl = target.toLowerCase().replace(/\.md$/, '');
      if (tl === targetRelLower || basename(tl) === targetBaseLower) {
        hit = true;
        break;
      }
    }
    if (hit) {
      const { frontmatter, body } = parseFrontmatter(raw);
      out.push({ path: rel, title: deriveTitle(rel, frontmatter, body) });
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * ノートを読む。rel は安全化済み絶対パスではなく vault 相対パスを受け取り、
 * 内部で resolveVaultPath を通す（二重防御）。md 以外は呼ばない想定。
 */
export function readNote(rel: string): NoteResponse | null {
  const abs = resolveVaultPath(rel); // パストラバーサル検証
  if (!existsSync(abs)) return null;
  let st;
  try {
    st = statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;

  const relPath = toVaultRelative(abs);
  const raw = readFileSync(abs, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const title = deriveTitle(relPath, frontmatter, body);

  return {
    path: relPath,
    title,
    frontmatter,
    body,
    mtime: st.mtime.toISOString(),
    outgoingLinks: extractOutgoingLinks(body),
    backlinks: collectBacklinks(relPath),
  };
}

// ─── 検索 ─────────────────────────────────────────────

/** 前後文脈付きスニペットを作る。 */
function makeSnippet(text: string, idxPos: number, qLen: number): string {
  const radius = 60;
  const start = Math.max(0, idxPos - radius);
  const end = Math.min(text.length, idxPos + qLen + radius);
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) s = '… ' + s;
  if (end < text.length) s = s + ' …';
  return s;
}

/**
 * ファイル名 + 本文の全文検索（大文字小文字無視・Node 読み）。
 * スコア: タイトル一致 > ファイル名一致 > 本文一致回数。上位 N 件。
 */
export function searchVault(query: string): SearchHit[] {
  const q = query.trim();
  if (q === '') return [];
  const qLower = q.toLowerCase();
  const idx = getIndex();
  const hits: SearchHit[] = [];

  for (const rel of idx.mdFiles) {
    let raw: string;
    try {
      raw = readFileSync(join(VAULT_DIR, rel), 'utf-8');
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(raw);
    const title = deriveTitle(rel, frontmatter, body);
    const titleLower = title.toLowerCase();
    const nameLower = basename(rel).toLowerCase();
    const bodyLower = body.toLowerCase();

    let score = 0;
    let snippet = '';

    if (titleLower.includes(qLower)) score += 100;
    if (nameLower.includes(qLower)) score += 40;

    // 本文ヒット数（最大カウントは抑える）。
    let from = 0;
    let count = 0;
    let firstPos = -1;
    while (count < 50) {
      const pos = bodyLower.indexOf(qLower, from);
      if (pos === -1) break;
      if (firstPos === -1) firstPos = pos;
      count += 1;
      from = pos + qLower.length;
    }
    if (count > 0) {
      score += Math.min(count, 10) * 3;
      snippet = makeSnippet(body, firstPos, q.length);
    } else if (titleLower.includes(qLower) || nameLower.includes(qLower)) {
      // 本文ヒットなしでもタイトル/名前一致なら先頭を snippet に。
      snippet = makeSnippet(body.replace(/^#.*$/m, '').trim() || title, 0, 0);
    }

    if (score > 0) {
      hits.push({ path: rel, title, snippet, score });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, VAULT_SEARCH_LIMIT);
}

// ─── 添付 ─────────────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

export interface AttachmentInfo {
  absPath: string;
  contentType: string;
}

/**
 * 添付（画像等）を解決する。`![[image.png]]` 埋め込み用に basename 一致のフォールバックも持つ。
 * rel は vault 相対パス or 単なるファイル名。安全化を通す。
 */
export function resolveAttachment(rel: string): AttachmentInfo | null {
  // まず素直に vault 相対として解決。
  let abs: string | null = null;
  try {
    const candidate = resolveVaultPath(rel);
    if (existsSync(candidate) && statSync(candidate).isFile()) abs = candidate;
  } catch {
    // 安全化に失敗した場合でも、basename フォールバックを試みる（下記）。
    abs = null;
  }

  // basename フォールバック: vault 全体から同名ファイルを探す（Obsidian の ![[img.png]] 記法）。
  if (!abs) {
    const wanted = basename(rel).toLowerCase();
    if (wanted === '') return null;
    let found: string | null = null;
    walkFiles(VAULT_DIR, (f) => {
      if (found) return;
      if (basename(f).toLowerCase() === wanted) found = f;
    });
    if (!found) return null;
    // フォールバックで見つけた実体も vault 配下であることを保証（walkFiles は vault 内のみ）。
    const foundRel = relative(VAULT_DIR, found).split(sep).join('/');
    try {
      abs = resolveVaultPath(foundRel);
    } catch {
      return null;
    }
  }

  const ext = extname(abs).toLowerCase();
  return { absPath: abs, contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' };
}
