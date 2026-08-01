// agentAvatars — エージェント（subagentType）→ V2 ドット絵アバターの対応表（MC-165 再実装）。
//
// キーは roster のファイル名（= subagentType = Agents.tsx の card.name）。
// 値の working / idle は web/public/avatars/ に実配置した V2 アニメ GIF の URL。
// idle = 呼吸・まばたきの軽アニメ、working = 工具を動かす軽アニメ。
//
// アバターが用意されていない subagentType（masayoshi / task-manager / test-functional）は
// このマップに含めず、UI 側で従来の状態ドット表示にフォールバックする（既存レイアウト非破壊）。
//
// 画像の実体は artifacts/avatars/manifest-v2.json 由来。public への配置は
// avatar-<key>-{idle,working}-v2.png の命名で固定。

export interface AgentAvatar {
  /** 表示名（roster frontmatter persona）。alt / title に使う。 */
  name: string;
  /** state 別アバター画像 URL（/avatars/ 配下、Vite public からそのまま配信）。 */
  working: string;
  idle: string;
}

/**
 * subagentType → アバター。
 *
 * 対応表:
 *   dev-logic     → レン   → avatar-ren-*
 *   apollo        → アポロ → avatar-apollo-*
 *   content-creator → ナオ → avatar-content-creator-*
 *   designer      → アオイ → avatar-designer-*
 *   haru          → ハル   → avatar-haru-*
 *   hayashi-rin   → 林     → avatar-hayashi-rin-*
 *
 * （masayoshi / task-manager / test-functional は V2 アバター未生成のため未登録）
 */
// V3（2026-07-19・Keita指示「人ベースのキャラに全部作り直し」）: 人ベースの3Dちびキャラ静止PNGへ総入れ替え。
// ファイル命名は avatar-<key>-{idle,working}-v3.png（web/public/avatars）。Gemini生成→マゼンタchromaで透過切抜き。
// robot(汎用サブエージェント)のみ従来のv2 gifを踏襲（無名サブエージェント用の共通ロボ）。
export const AGENT_AVATARS: Record<string, AgentAvatar> = {
  'dev-logic': {
    name: 'レン',
    working: '/avatars/avatar-dev-logic-working-v4.png',
    idle: '/avatars/avatar-dev-logic-idle-v4.png',
  },
  apollo: {
    name: 'アポロ',
    working: '/avatars/avatar-apollo-working-v4.png',
    idle: '/avatars/avatar-apollo-idle-v4.png',
  },
  // 実際の subagentType は 'dev-apollo'（ソラ🛰）。apollo アバターを割り当てる。
  'dev-apollo': {
    name: 'ソラ',
    working: '/avatars/avatar-apollo-working-v4.png',
    idle: '/avatars/avatar-apollo-idle-v4.png',
  },
  'content-creator': {
    name: 'ナオ',
    working: '/avatars/avatar-content-creator-working-v4.png',
    idle: '/avatars/avatar-content-creator-idle-v4.png',
  },
  designer: {
    name: 'アオイ',
    working: '/avatars/avatar-designer-working-v4.png',
    idle: '/avatars/avatar-designer-idle-v4.png',
  },
  haru: {
    name: 'ハル',
    working: '/avatars/avatar-haru-working-v4.png',
    idle: '/avatars/avatar-haru-idle-v4.png',
  },
  'hayashi-rin': {
    name: '林',
    working: '/avatars/avatar-hayashi-rin-working-v4.png',
    idle: '/avatars/avatar-hayashi-rin-idle-v4.png',
  },
  masayoshi: {
    name: 'Masayoshi',
    working: '/avatars/avatar-masayoshi-working-v4.png',
    idle: '/avatars/avatar-masayoshi-idle-v4.png',
  },
  son: {
    name: 'Son',
    working: '/avatars/avatar-son-working-v4.png',
    idle: '/avatars/avatar-son-idle-v4.png',
  },
  'task-manager': {
    name: 'ユイ',
    working: '/avatars/avatar-task-manager-working-v4.png',
    idle: '/avatars/avatar-task-manager-idle-v4.png',
  },
  'test-functional': {
    name: 'ケン',
    working: '/avatars/avatar-test-functional-working-v4.png',
    idle: '/avatars/avatar-test-functional-idle-v4.png',
  },
  // PDCA 専任エージェント PD-CA（MC-312）。
  pdca: {
    name: 'PD-CA',
    working: '/avatars/avatar-pdca-working-v4.png',
    idle: '/avatars/avatar-pdca-idle-v4.png',
  },
  // 汎用サブエージェント（general-purpose / workflow:* / Explore / unmatched:* 等）共通の
  // ロボット型アバター。getAgentAvatar が個別人格に一致しない type をここへ寄せる。
  robot: {
    name: 'Bot',
    working: '/avatars/avatar-robot-working-v2.gif',
    idle: '/avatars/avatar-robot-idle-v2.gif',
  },
};

/**
 * subagentType からアバターを引く。
 * 1) 個別人格に完全一致すればそれを返す。
 * 2) 汎用サブエージェント（general-purpose / Explore / workflow:* / unmatched:*）は
 *    共通のロボットアバターにフォールバックする（Keita 指示: サブエージェントは専用のロボット）。
 * 3) どれにも当たらなければ undefined（UI 側で絵文字フォールバック）。
 */
export function getAgentAvatar(subagentType: string): AgentAvatar | undefined {
  const exact = AGENT_AVATARS[subagentType];
  if (exact) return exact;
  const t = subagentType.toLowerCase();
  if (
    t === 'general-purpose' ||
    t === 'explore' ||
    t.startsWith('workflow:') ||
    t.startsWith('unmatched:')
  ) {
    return AGENT_AVATARS['robot'];
  }
  return undefined;
}
