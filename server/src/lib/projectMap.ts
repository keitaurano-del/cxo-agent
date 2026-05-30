// cwd / 任意のパス文字列 → プロジェクト名への写像。
//
// 判定は「パスに含まれる識別子」のシンプルな部分一致。順序が重要（先勝ち）。

export type ProjectName =
  | 'logic'
  | 'en-chakai'
  | 'nishimaru'
  | 'ai-pmo'
  | 'cxo'
  | 'private'
  | 'other';

export interface ProjectMeta {
  name: ProjectName;
  label: string;
}

const PROJECT_LABELS: Record<ProjectName, string> = {
  logic: 'logic',
  'en-chakai': 'en-chakai',
  nishimaru: '西丸町(nishimaru)',
  'ai-pmo': 'ai-pmo',
  cxo: 'cxo',
  private: 'private',
  other: 'other',
};

export function projectLabel(name: ProjectName): string {
  return PROJECT_LABELS[name];
}

/**
 * cwd / パス文字列からプロジェクト名を判定する。
 * obsidian-vault の個人タスク文脈（10-Tasks / 50-Daily / 60-Agents 等）は private に寄せる。
 */
export function projectFromPath(input?: string | null): ProjectName {
  if (!input) return 'other';
  const p = input.toLowerCase();

  if (p.includes('en-chakai') || p.includes('sengoku-chakai')) return 'en-chakai';
  if (p.includes('nishimaru')) return 'nishimaru';
  if (p.includes('ai-pmo')) return 'ai-pmo';
  if (p.includes('cxo-agent') || p.includes('cxo')) return 'cxo';
  if (p.includes('logic')) return 'logic';

  // obsidian-vault: nishimaru プロジェクトは上で拾っているので、ここに来るのは個人タスク文脈。
  if (p.includes('obsidian-vault')) {
    if (
      p.includes('10-tasks') ||
      p.includes('50-daily') ||
      p.includes('60-agents') ||
      p.includes('00-inbox') ||
      p.includes('private')
    ) {
      return 'private';
    }
    return 'private';
  }

  return 'other';
}

export function projectMeta(input?: string | null): ProjectMeta {
  const name = projectFromPath(input);
  return { name, label: projectLabel(name) };
}

export const ALL_PROJECTS: ProjectName[] = [
  'logic',
  'en-chakai',
  'nishimaru',
  'ai-pmo',
  'cxo',
  'private',
  'other',
];
