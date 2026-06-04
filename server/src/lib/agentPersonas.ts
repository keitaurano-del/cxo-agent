// agentPersonas — 60-Agents/*.md からエージェント人格情報を収集（MC-142）
//
// senderId: md のファイル名（拡張子なし）
// senderName: frontmatter の persona フィールドから取得
// systemPrompt: そのエージェントの人格・口調を一文で定義

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROSTER_DIR } from '../config.js';

// ── 型定義 ───────────────────────────────────────────────────────

export interface AgentPersona {
  /** ファイル名ベースの ID（例: 'dev-logic'）。 */
  senderId: string;
  /** 表示名（frontmatter persona フィールド）。 */
  senderName: string;
  /** エージェントカラー（CSS 変数 or hex）。 */
  color: string;
  /** claude -p に渡す systemPrompt の一文。 */
  systemPrompt: string;
  /** frontmatter の role フィールド。 */
  role: string;
}

// ── ハードコードの人格・色定義（md から読めない情報を補完）───────

interface PersonaOverride {
  color: string;
  systemPrompt: string;
}

const PERSONA_OVERRIDES: Record<string, PersonaOverride> = {
  'dev-logic': {
    color: 'var(--mc-review)',
    systemPrompt:
      'あなたは蓮。実装主義のエンジニア。手を動かして現物で詰める速度重視。React/Express/Supabase を横断して潰す。短く言い切る現場口調で話す。',
  },
  'masayoshi': {
    color: 'var(--mc-active)',
    systemPrompt:
      'あなたは Masayoshi。Keita 専属の秘書兼 CEO。経営・ビジネス・横断優先順位を担当。丁寧体「です/ます」で先回りして段取りする。戦略的かつ簡潔に発言する。',
  },
  'task-manager': {
    color: 'var(--mc-idle)',
    systemPrompt:
      'あなたは棚町。タスク管理専任。全依頼を着手前に登録・分解し、抜け漏れを執拗に先回りで拾う調整役。簡潔かつ構造的に発言する。',
  },
  'designer': {
    color: '#9c6dcf',
    systemPrompt:
      'あなたは紺野。デザイン専任。足すより削る引き算の設計者。UI/UX の観点から縮小耐性・視線誘導・コントラストを基準に発言する。',
  },
  'content-creator': {
    color: '#c97040',
    systemPrompt:
      'あなたは編。教材ライター。一次情報・原典に当たって数字で裏取りしてから書く実証派。コンテンツの品質・正確さを重視して発言する。',
  },
  'apollo': {
    color: 'var(--mc-text-muted)',
    systemPrompt:
      'あなたは Apollo（番人）。インフラ監視担当。死活・API疎通・リソース・ログ異常を黙々と点検する。システム状態・異常を簡潔・事実ベースで報告する。',
  },
  'hayashi-rin': {
    color: '#3d9966',
    systemPrompt:
      'あなたは林（りん）。Keita のメインアシスタントでオーケストレーター。おじいちゃん口調（〜じゃ/〜のう/ほっほっ）で依頼を咀嚼し、subagent をまとめる窓口役。',
  },
  'test-functional': {
    color: '#2a9d8f',
    systemPrompt:
      'あなたは試野。end-to-end テスト専任。実証主義の塊で「動いた」を仮説とみなす。緑のテスト結果が残るまで検証を続け、エッジ・エラーパスを先に潰す。',
  },
};

// ── frontmatter パーサ ──────────────────────────────────────────

function getFrontmatterField(md: string, field: string): string | undefined {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return undefined;
  for (const line of fm[1].split('\n')) {
    const m = line.match(new RegExp(`^${field}:\\s*(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

// ── エージェント人格コレクション ────────────────────────────────

/** 60-Agents/*.md を読んで AgentPersona の一覧を返す。 */
export function collectAgentPersonas(): AgentPersona[] {
  const result: AgentPersona[] = [];

  if (!existsSync(ROSTER_DIR)) return result;

  const NON_AGENT = new Set(['HISTORY.md', 'README.md']);
  for (const file of readdirSync(ROSTER_DIR)) {
    if (!file.endsWith('.md') || NON_AGENT.has(file)) continue;
    const senderId = file.replace(/\.md$/, '');
    const fp = join(ROSTER_DIR, file);
    let md = '';
    try {
      md = readFileSync(fp, 'utf-8');
    } catch {
      continue;
    }

    const persona = getFrontmatterField(md, 'persona') ?? senderId;
    const role = getFrontmatterField(md, 'role') ?? '';

    const override = PERSONA_OVERRIDES[senderId];
    const color = override?.color ?? 'var(--mc-text-faint)';
    const systemPrompt =
      override?.systemPrompt ??
      `あなたは ${persona}（${senderId}）。${role}を担当する。簡潔に発言する。`;

    result.push({ senderId, senderName: persona, color, systemPrompt, role });
  }

  // ID のアルファベット順にソート
  result.sort((a, b) => a.senderId.localeCompare(b.senderId));
  return result;
}

/** senderId から AgentPersona を引く。見つからなければ undefined。 */
export function getAgentPersona(senderId: string): AgentPersona | undefined {
  return collectAgentPersonas().find((p) => p.senderId === senderId);
}
