// slideTemplates — スライドテンプレート（様式）カタログのデータ層（MC-224 Phase1）。
//
// data/slide-templates.json（13 テンプレ・6 カテゴリ）を読み、カタログ全体／単一テンプレを返す。
// シードは当方管理の静的データ。ファイル mtime ベースでキャッシュし（tasks collector に倣う）、
// 更新があれば次回読み込みで自動的に反映する。
//
// 提供:
//  - listCatalog()    : カタログ全体（version/updatedAt/source/categories/templates）。
//  - getTemplate(id)  : 単一テンプレ（無ければ undefined）。

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INBOX_DATA_DIR } from '../config.js';

/** スライドテンプレートのカテゴリ（用途別の大分類）。 */
export interface SlideTemplateCategory {
  key: string;
  label: string;
}

/** 1 つのスライドテンプレート（様式）。 */
export interface SlideTemplate {
  id: string;
  name: string;
  category: string; // SlideTemplateCategory.key
  useCases: string[];
  whenToUse: string;
  messageLineExample: string;
  layout: string;
  recommendedVisual: string;
  tips: string[];
  structure: string[];
  previewSvg: string; // インライン SVG 文字列（当方管理の静的データ）
}

/** スライドテンプレートカタログ全体。 */
export interface SlideTemplateCatalog {
  version: number;
  updatedAt: string;
  source: string;
  categories: SlideTemplateCategory[];
  templates: SlideTemplate[];
}

/** シード JSON のパス（config の data ディレクトリ基準で解決）。 */
const CATALOG_PATH = join(INBOX_DATA_DIR, 'slide-templates.json');

let _cache: { sig: string; catalog: SlideTemplateCatalog } | null = null;

/** シードファイルの mtime シグネチャ（取れなければ '0'）。変化したらキャッシュを無効化する。 */
function signature(): string {
  try {
    return `${statSync(CATALOG_PATH).mtimeMs}`;
  } catch {
    return '0';
  }
}

/** カタログ全体を返す（mtime ベースのキャッシュ付き）。 */
export function listCatalog(): SlideTemplateCatalog {
  const sig = signature();
  if (_cache && _cache.sig === sig) return _cache.catalog;

  const raw = readFileSync(CATALOG_PATH, 'utf-8');
  const catalog = JSON.parse(raw) as SlideTemplateCatalog;
  _cache = { sig, catalog };
  return catalog;
}

/** id で単一テンプレを引く（無ければ undefined）。 */
export function getTemplate(id: string): SlideTemplate | undefined {
  return listCatalog().templates.find((t) => t.id === id);
}

/** テスト用: キャッシュを明示的に無効化する。 */
export function clearSlideTemplateCache(): void {
  _cache = null;
}
