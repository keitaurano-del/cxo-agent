// personaMap.ts — 9体のエージェント人格定義と avatar stub
// MC-165 skeleton: Apollo dashboard に PersonaCard React component を新規作成

export interface PersonaMeta {
  /** エージェント識別子（'dev-logic', 'task-manager', 'designer' など） */
  key: string;
  /** 表示名（凛、棚町 結、紺野 蒼など） */
  name: string;
  /** avatar 画像 URL（state で切り替え、SSE 準備済み） */
  avatar?: {
    working: string; // image URL or import path
    idle: string;
  };
}

/** 開発9体のエージェント人格マップ（agentPersonas.ts と同期） */
export const personaMap: Record<string, PersonaMeta> = {
  'dev-logic': {
    key: 'dev-logic',
    name: '蓮',
    avatar: {
      working: '/avatars/avatar-ren-working.png',
      idle: '/avatars/avatar-ren-idle.png',
    },
  },
  'task-manager': {
    key: 'task-manager',
    name: '棚町 結',
    avatar: {
      working: '/avatars/avatar-task-manager-working.svg',
      idle: '/avatars/avatar-task-manager-idle.svg',
    },
  },
  designer: {
    key: 'designer',
    name: '紺野 蒼',
    avatar: {
      working: '/avatars/avatar-designer-working.svg',
      idle: '/avatars/avatar-designer-idle.svg',
    },
  },
  'content-creator': {
    key: 'content-creator',
    name: '編 詠子',
    avatar: {
      working: '/avatars/avatar-content-creator-working.svg',
      idle: '/avatars/avatar-content-creator-idle.svg',
    },
  },
  reviewer: {
    key: 'reviewer',
    name: '関 守',
    avatar: {
      working: '/avatars/avatar-apollo-working.svg',
      idle: '/avatars/avatar-apollo-idle.svg',
    },
  },
  'logic-coach': {
    key: 'logic-coach',
    name: '論堂 透',
    avatar: {
      working: '/avatars/avatar-haru-working.svg',
      idle: '/avatars/avatar-haru-idle.svg',
    },
  },
  'test-functional': {
    key: 'test-functional',
    name: '試野 緑',
    avatar: {
      working: '/avatars/avatar-test-functional-working.svg',
      idle: '/avatars/avatar-test-functional-idle.svg',
    },
  },
  'night-patrol': {
    key: 'night-patrol',
    name: '夜目',
    avatar: {
      working: '/avatars/avatar-hayashi-rin-working.svg',
      idle: '/avatars/avatar-hayashi-rin-idle.svg',
    },
  },
  'feedback-watcher': {
    key: 'feedback-watcher',
    name: '耳塚 聡',
    avatar: {
      working: '/avatars/avatar-masayoshi-working.svg',
      idle: '/avatars/avatar-masayoshi-idle.svg',
    },
  },
};

/**
 * agentKey からPersonaMetaを取得
 * @param key エージェント識別子
 * @returns PersonaMeta or undefined
 */
export function getPersonaMeta(key: string): PersonaMeta | undefined {
  return personaMap[key];
}

/**
 * 全Persona一覧を取得
 * @returns PersonaMeta[]
 */
export function getAllPersonas(): PersonaMeta[] {
  return Object.values(personaMap);
}
