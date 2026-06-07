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
      working: 'https://placeholder.com/64x64?text=task-manager-work',
      idle: 'https://placeholder.com/64x64?text=task-manager-idle',
    },
  },
  designer: {
    key: 'designer',
    name: '紺野 蒼',
    avatar: {
      working: 'https://placeholder.com/64x64?text=designer-work',
      idle: 'https://placeholder.com/64x64?text=designer-idle',
    },
  },
  'content-creator': {
    key: 'content-creator',
    name: '編 詠子',
    avatar: {
      working: 'https://placeholder.com/64x64?text=content-creator-work',
      idle: 'https://placeholder.com/64x64?text=content-creator-idle',
    },
  },
  reviewer: {
    key: 'reviewer',
    name: '関 守',
    avatar: {
      working: 'https://placeholder.com/64x64?text=reviewer-work',
      idle: 'https://placeholder.com/64x64?text=reviewer-idle',
    },
  },
  'logic-coach': {
    key: 'logic-coach',
    name: '論堂 透',
    avatar: {
      working: 'https://placeholder.com/64x64?text=logic-coach-work',
      idle: 'https://placeholder.com/64x64?text=logic-coach-idle',
    },
  },
  'test-functional': {
    key: 'test-functional',
    name: '試野 緑',
    avatar: {
      working: 'https://placeholder.com/64x64?text=test-functional-work',
      idle: 'https://placeholder.com/64x64?text=test-functional-idle',
    },
  },
  'night-patrol': {
    key: 'night-patrol',
    name: '夜目',
    avatar: {
      working: 'https://placeholder.com/64x64?text=night-patrol-work',
      idle: 'https://placeholder.com/64x64?text=night-patrol-idle',
    },
  },
  'feedback-watcher': {
    key: 'feedback-watcher',
    name: '耳塚 聡',
    avatar: {
      working: 'https://placeholder.com/64x64?text=feedback-watcher-work',
      idle: 'https://placeholder.com/64x64?text=feedback-watcher-idle',
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
