import React from 'react';

/**
 * PersonaCard — Apollo dashboard に表示するエージェント人格カード
 * MC-165: 9体のエージェント avatar + name をリアルタイム state 切り替え対応
 *
 * Props:
 *   persona: PersonaMeta（key, name, avatar.working/idle）
 *   state?: 'working' | 'idle' — runtime で state 切り替え（SSE 準備済み）
 *   size?: number — avatar サイズ（px、デフォルト 64）
 *
 * Render:
 *   64×64 px avatar image（state で working/idle 画像を切り替え）
 *   + persona.name を下に表示
 *   + Tailwind + theme に合わせたスタイル
 *
 * Usage:
 *   <PersonaCard persona={personaMeta} state="working" />
 */

interface PersonaCardProps {
  persona: {
    key: string;
    name: string;
    avatar?: {
      working: string;
      idle: string;
    };
  };
  state?: 'working' | 'idle';
  size?: number;
  className?: string;
}

export const PersonaCard: React.FC<PersonaCardProps> = ({
  persona,
  state = 'idle',
  size = 64,
  className = '',
}) => {
  const avatarUrl = persona.avatar ? persona.avatar[state] : undefined;

  return (
    <div
      className={`flex flex-col items-center gap-2 ${className}`}
      title={`${persona.name} (${state})`}
    >
      {/* Avatar image — 64×64 px (デフォルト) */}
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={`${persona.name} - ${state}`}
          width={size}
          height={size}
          className="rounded-full object-cover border border-gray-300 dark:border-gray-600"
          loading="lazy"
        />
      ) : (
        <div
          style={{ width: size, height: size }}
          className="rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-xs font-bold text-gray-700 dark:text-gray-300"
        >
          {persona.name.charAt(0)}
        </div>
      )}

      {/* Name label */}
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 text-center max-w-[80px] truncate">
        {persona.name}
      </span>

      {/* State indicator（working の時だけ小さなドット表示） */}
      {state === 'working' && (
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      )}
    </div>
  );
};

export default PersonaCard;
