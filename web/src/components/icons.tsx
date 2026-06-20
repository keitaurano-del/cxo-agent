// UI chrome 用 SVG アイコン（emoji 不使用）。currentColor 継承で配色は親が制御。
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps): IconProps => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export function GridIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6" />
      <path d="M16.5 13.5a5.5 5.5 0 0 1 4 5.5" />
    </svg>
  );
}

export function StreamIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h11" />
      <path d="M4 12h16" />
      <path d="M4 17h8" />
      <circle cx="19" cy="7" r="1.6" />
      <circle cx="15" cy="17" r="1.6" />
    </svg>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.5" y="4" width="5" height="10" rx="1.5" />
      <rect x="16" y="4" width="5" height="13" rx="1.5" />
    </svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h7" />
      <path d="M9 17h5" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16" />
      <path d="M10 4h4" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function DotIcon(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 0, ...props })}>
      <circle cx="12" cy="12" r="6" fill="currentColor" />
    </svg>
  );
}

export function PulseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
    </svg>
  );
}

export function VaultIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 8.8v-1.3M12 16.5v-1.3M8.8 12H7.5M16.5 12h-1.3" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 7H19a2 2 0 0 1 2 2v1H6.5a2 2 0 0 0-1.9 1.4L3 17z" />
      <path d="M3 17l1.6-5.6A2 2 0 0 1 6.5 10H22l-2 7a2 2 0 0 1-1.9 1.4H5A2 2 0 0 1 3 17z" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M13 3v5h5" />
    </svg>
  );
}

export function ImageFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

export function DocumentsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3.5h6.5L19 8v9.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 8 3.5Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M4.5 7.5V19a1.5 1.5 0 0 0 1.5 1.5h8.5" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v10" />
      <path d="M8 10.5 12 14.5 16 10.5" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 16V4" />
      <path d="M8 8.5 12 4.5 16 8.5" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function SheetIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="16" height="16" rx="1.8" />
      <path d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16" />
    </svg>
  );
}

export function SlidesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5" width="17" height="11" rx="1.5" />
      <path d="M12 16v3M9 19h6" />
    </svg>
  );
}

export function PdfFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3.5h6.5L19 8v9.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 8 3.5Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9.5 12.5h5M9.5 15h3.5" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function TextFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3.5h6.5L19 8v9.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 8 3.5Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9 12h6M9 15h6M9 9h2" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M8 12 6.5 13.5a3.5 3.5 0 0 0 5 5L13 17" />
      <path d="M16 12l1.5-1.5a3.5 3.5 0 0 0-5-5L11 7" />
    </svg>
  );
}

export function UsageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 20h18" />
      <rect x="5" y="11" width="3.2" height="6" rx="1" />
      <rect x="10.4" y="7" width="3.2" height="10" rx="1" />
      <rect x="15.8" y="13" width="3.2" height="4" rx="1" />
    </svg>
  );
}

// 自律ループのティック（周回/サイクル）を表す。
export function LoopIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 12a8.5 8.5 0 0 1 14.5-6" />
      <path d="M20.5 12a8.5 8.5 0 0 1-14.5 6" />
      <path d="M18 2.5V6h-3.5" />
      <path d="M6 21.5V18h3.5" />
    </svg>
  );
}

// ティック＋消費量を統合した「活動」タブのアイコン（稲妻/アクティビティ）。
export function ActivityIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z" />
      <path d="M13.5 6.5 17.5 10.5" />
    </svg>
  );
}

export function ApprovalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.3 2.3 4.7-4.7" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 11.5V5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.4.6l7.5 7.5a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0L3.6 12.9A2 2 0 0 1 3 11.5z" />
      <circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  );
}

// ノートブック（資料セット＋Q&A＋生成物）。閉じたノート＋しおりで表現。
export function NotebookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z" />
      <path d="M6 3.5A1.5 1.5 0 0 0 4.5 5v14A1.5 1.5 0 0 0 6 20.5" />
      <path d="M9 3.5v17" />
      <path d="M13.5 8v4l1.5-1 1.5 1V8z" />
    </svg>
  );
}

// 送信（チャットの紙飛行機）。
export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12 20 4l-6 16-3-7z" />
      <path d="M11 13 20 4" />
    </svg>
  );
}

// 生成（きらめき）。生成物作成ボタン群で使う。
export function SparkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
      <path d="M7 7l2.5 2.5M14.5 14.5 17 17M17 7l-2.5 2.5M9.5 14.5 7 17" />
    </svg>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  );
}

// ゲージ（プラン使用量）アイコン: 半円+針で使用率を表現。
export function GaugeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 17.5A8 8 0 1 1 18.5 17.5" />
      <path d="M12 12 9 7" strokeWidth={2} strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 太陽（日中モード）。中心円 + 8本の放射線。
export function SunIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      <path d="M5.64 5.64l1.42 1.42M16.95 16.95l1.41 1.41M5.64 18.36l1.42-1.42M16.95 7.05l1.41-1.41" />
    </svg>
  );
}

// 月（夜間モード）。三日月形。
export function MoonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

// チャット（吹き出し）。Slack 的チャット機能のナビアイコン。
export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// 育児相談チャット（吹き出し＋ハート）。育児ページの FAB / 「すくすく」用。
export function ChildcareChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
      <path
        d="M12 14.2c-1.7-1.2-3-2.2-3-3.6a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.4-1.3 2.4-3 3.6z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

// ハッシュ（チャンネルを表す # 記号）。
export function HashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 9h16M4 15h16M10 4 8 20M16 4l-2 16" />
    </svg>
  );
}

// 全画面展開（Expand）アイコン。
export function ExpandIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

// 全画面縮小（Shrink）アイコン。
export function ShrinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3v5H3M21 8h-5V3M3 16h5v5M16 21v-5h5" />
    </svg>
  );
}

// クリップ（ファイル添付）アイコン。
export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function NewsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8M15 18h-5M10 6h8v4h-8z" />
    </svg>
  );
}

// グリップ（ドラッグハンドル ⠿）アイコン。並べ替えハンドル用（MC-158）。
export function GripIcon(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

// 動画ファイル（添付チップ用）。フィルムフレーム＋再生三角。
export function VideoFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m10 9.5 5 2.5-5 2.5z" />
    </svg>
  );
}

// 音声ファイル（添付チップ用）。音符。
export function AudioFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </svg>
  );
}

// 育児（/childcare）ナビ用。哺乳瓶＋目盛り＋やさしいハートで「赤ちゃん／育児」を表す。
export function BabyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 4.5h5l-.5 2h-4z" />
      <path d="M9 6.5h6v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" />
      <path d="M9 11h6M9 14h6" />
      <path d="M11 3.2a1 1 0 0 1 2 0" />
    </svg>
  );
}

// 茶事（/chaji）ナビ用。抹茶茶碗＋立ちのぼる湯気で「茶の湯」を表す。単色 path で他アイコンに合わせる。
export function ChajiIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* 茶碗（下すぼまりの椀） */}
      <path d="M4 11h16l-1.4 6.2A3 3 0 0 1 15.7 19.5H8.3A3 3 0 0 1 5.4 17.2z" />
      {/* 口縁のライン */}
      <path d="M4 11h16" />
      {/* 立ちのぼる湯気 */}
      <path d="M9 7.5c0-1 1-1.4 1-2.4S9 3.6 9 2.6" />
      <path d="M13 7.5c0-1 1-1.4 1-2.4S13 3.6 13 2.6" />
    </svg>
  );
}

// 成長日記（/baby-diary, MC-233）ナビ用。開いたノート＋しおりリボンで「日記」を表す。
export function DiaryIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 4.5h11a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5z" />
      <path d="M5 4.5A1.5 1.5 0 0 0 3.5 6v13A1.5 1.5 0 0 0 5 20.5" />
      <path d="M8.5 9h6M8.5 12.5h6M8.5 16h3.5" />
      <path d="M15.5 4.5v6l1.75-1.3 1.75 1.3v-6z" />
    </svg>
  );
}

// 設定アイコン（MC-178 フォントサイズ等）
export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2.5" />
      <path d="M12 17.5v2.5" />
      <path d="M18.4 7.1l1.8-1.8" />
      <path d="M5.3 18.3l1.8-1.8" />
      <path d="M20 12h2.5" />
      <path d="M1.5 12h2.5" />
      <path d="M18.4 16.9l1.8 1.8" />
      <path d="M5.3 5.8l1.8 1.8" />
    </svg>
  );
}

// 並び替えアイコン（MC-231 ソート切替）
export function SortIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 5v14" />
      <path d="M4 8l3-3 3 3" />
      <path d="M17 19V5" />
      <path d="M20 16l-3 3-3-3" />
    </svg>
  );
}

// 昇順アイコン（小→大）
export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}

// 降順アイコン（大→小）
export function ArrowDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </svg>
  );
}

// 復元アイコン（MC-230 ゴミ箱からの復元）
export function RestoreIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
    </svg>
  );
}

// 移動アイコン（MC-228 別フォルダへ移動）
export function MoveIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7.5l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z" />
      <path d="M9 13h6" />
      <path d="M12 10l3 3-3 3" />
    </svg>
  );
}

// 時計アイコン（MC-232 最近使った項目）
export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

// チェックアイコン（MC-229 選択中マーカー）
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12l4.5 4.5L19 7" />
    </svg>
  );
}

// 左シェブロン（MC-232 戻る）
export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

// コピー / 複製（MC-235）
export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// 詳細情報（MC-236 詳細ペイン）
export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

// 開発（/dev）ナビ用。コード記号 </> で「開発・コーディング」を表す。
export function CodeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m8 6-5 6 5 6" />
      <path d="m16 6 5 6-5 6" />
      <path d="m13.5 4-3 16" />
    </svg>
  );
}

// MC-238: スター（お気に入り）。filled 表示は呼び出し側で fill="currentColor" を渡す。
export function StarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 17.3l-5.4 3.1 1.4-6.1-4.7-4.1 6.2-.5L12 4l2.5 5.7 6.2.5-4.7 4.1 1.4 6.1z" />
    </svg>
  );
}
