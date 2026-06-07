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
export const AGENT_AVATARS: Record<string, AgentAvatar> = {
  'dev-logic': {
    name: 'レン',
    working: '/avatars/avatar-ren-working-v2.gif',
    idle: '/avatars/avatar-ren-idle-v2.gif',
  },
  apollo: {
    name: 'アポロ',
    working: '/avatars/avatar-apollo-working-v2.gif',
    idle: '/avatars/avatar-apollo-idle-v2.gif',
  },
  'content-creator': {
    name: 'ナオ',
    working: '/avatars/avatar-content-creator-working-v2.gif',
    idle: '/avatars/avatar-content-creator-idle-v2.gif',
  },
  designer: {
    name: 'アオイ',
    working: '/avatars/avatar-designer-working-v2.gif',
    idle: '/avatars/avatar-designer-idle-v2.gif',
  },
  haru: {
    name: 'ハル',
    working: '/avatars/avatar-haru-working-v2.gif',
    idle: '/avatars/avatar-haru-idle-v2.gif',
  },
  'hayashi-rin': {
    name: '林',
    working: '/avatars/avatar-hayashi-rin-working-v2.gif',
    idle: '/avatars/avatar-hayashi-rin-idle-v2.gif',
  },
};

/** subagentType からアバターを引く。未登録なら undefined（フォールバック）。 */
export function getAgentAvatar(subagentType: string): AgentAvatar | undefined {
  return AGENT_AVATARS[subagentType];
}
