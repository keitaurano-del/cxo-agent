// Auto-generated from /workspaces/logic/src/Profile.tsx
// Last sync: 2026-04-08T05:55:22Z (UTC)
// Source: Logic アプリ 管理者モード (DevPanel) の TECH_STACK + SOURCE_FILES
// Regeneration: scripts/sync_logic_spec.py (Flask auto-runs if >24h old)

export const TECH_STACK = [
  { category: 'フロントエンド', items: [
    { name: 'React', desc: 'UIを構築するJavaScriptライブラリ。コンポーネント（部品）を組み合わせて画面を作る' },
    { name: 'TypeScript', desc: 'JavaScriptに「型」を追加した言語。変数にどんなデータが入るか事前に定義してバグを防ぐ' },
    { name: 'Vite', desc: '開発サーバー＆ビルドツール。コードを保存すると即座にブラウザに反映される' },
    { name: 'CSS', desc: '画面のデザイン（色、配置、アニメーション）を定義するスタイル言語' },
  ]},
  { category: 'バックエンド', items: [
    { name: 'Express', desc: 'Node.jsのWebサーバーフレームワーク。APIエンドポイント（/api/...）を作る' },
    { name: 'Claude API', desc: 'AnthropicのAI API。ロールプレイの会話、採点、フラッシュカード生成に使用' },
  ]},
  { category: 'データ保存', items: [
    { name: 'localStorage', desc: 'ブラウザ内蔵のデータ保存。学習記録、フラッシュカード、設定などをJSON形式で保持' },
  ]},
];

export const SOURCE_FILES = [
  {
    path: 'src/App.tsx',
    role: 'エントリーポイント',
    desc: 'アプリ全体のルーティングと状態管理を担当。下部タブバーで画面を切り替え、レッスン完了時のリワード表示や学習時間の計測もここで行う。各画面コンポーネント（Profile、Lesson、Flashcardsなど）をimportし、stateに応じて表示を切り替える。',
    tech: ['React', 'TypeScript', 'useState', 'useEffect', 'useCallback'],
    lines: '約400行',
    code: `// 各画面コンポーネントを読み込み
import RolePlaySystem from './RolePlaySystem'
import Lesson from './Lesson'
import MockExam from './MockExam'
import JournalInput from './JournalInput'
import Worksheet from './Worksheet'
import Knowledge from './Knowledge'
import Profile from './Profile'
import Flashcards from './Flashcards'
import Reward from './Reward'

// レッスン一覧データ（id, タイトル, カテゴリなど）
const lessons = [
  { id: 3,  category: 'ロールプレイ', title: '上司とのレビュー会議', action: 'roleplay' },
  { id: 6,  category: '簿記3級',      title: '簿記3級 入門',        action: 'lesson' },
  { id: 99, category: '模擬試験',      title: '簿記3級 模擬試験',    action: 'mock-exam' },
  // ...全11レッスン
]

type Tab = 'home' | 'lessons' | 'roleplay' | 'knowledge' | 'profile'

export default function App() {
  const [tab, setTab] = useState<Tab>('home')        // 現在のタブ
  const [screen, setScreen] = useState<Screen>(null)  // 表示中の画面
  const studyStart = useRef(Date.now())               // 学習時間計測用

  // タブに応じてコンポーネントを切り替え
  if (screen?.type === 'lesson') return <Lesson ... />
  if (screen?.type === 'roleplay') return <RolePlaySystem ... />
  if (tab === 'profile') return <Profile />
  return <HomeScreen />  // デフォルトはホーム画面
}`,
  },
  {
    path: 'server/index.ts',
    role: 'バックエンドAPI',
    desc: 'Expressサーバーで3つのAPIエンドポイントを提供。(1) /api/roleplay/chat: Claude APIでロールプレイ相手を演じる (2) /api/roleplay/score: 会話内容を5カテゴリで採点 (3) /api/flashcards/generate: 間違えた問題から復習カードを自動生成。各エンドポイントでsystemPromptを組み立て、Claude APIに送信し、JSONで結果を返す。',
    tech: ['Express', 'Anthropic SDK', 'REST API', 'Node.js'],
    lines: '約190行',
    code: `import express from 'express'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

// === ロールプレイ会話 ===
app.post('/api/roleplay/chat', async (req, res) => {
  const { messages, setup } = req.body
  const { template, partner, goal } = setup

  // シナリオに応じてsystemPromptを動的に構築
  const systemPrompt = \`あなたは「\${partner.name}」というロールプレイキャラクターです。
  役職: \${partner.role}
  性格: \${partner.personality}
  関心事: \${partner.interests}
  ルール: 1回の発言は2〜4文に抑える。日本語で応答する\`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: systemPrompt,
    messages,  // ユーザーとAIの会話履歴をそのまま渡す
  })
  res.json({ role: 'assistant', content: response.content[0].text })
})

// === 採点 ===
app.post('/api/roleplay/score', async (req, res) => {
  const { messages, setup, historySummary } = req.body
  // 5カテゴリ（コミュニケーション、論理性、交渉力、具体性、目標達成）で各10点満点
  // 過去の履歴がある場合は成長傾向にも言及
  const result = JSON.parse(response)  // { scores: [...], overall: "..." }
  res.json(result)
})

// === フラッシュカードAI生成 ===
app.post('/api/flashcards/generate', async (req, res) => {
  const { wrongAnswers, category } = req.body
  // 間違えた問題の周辺知識や関連概念もカバーして5〜8枚生成
  res.json({ cards: [{ front: "質問", back: "解答+解説" }, ...] })
})

app.listen(3001)  // ポート3001で起動`,
  },
  {
    path: 'src/stats.ts',
    role: 'データ永続化・XP・レベル計算',
    desc: 'localStorageに学習データ（完了レッスン、学習日、学習時間）を保存・読み出し。XPシステムとレベル計算も担当。レッスン完了で100XP、模擬試験で200XP、学習時間1分ごとに2XPが加算される。連続学習日数（ストリーク）の計算ロジックもここ。',
    tech: ['localStorage', 'JSON', 'TypeScript型定義'],
    lines: '約140行',
    code: `const STORAGE_KEY = 'logic-stats'

type Stats = {
  completedLessons: string[]  // "lesson-6", "mock-exam" など
  studyDates: string[]        // ["2026-04-01", "2026-04-02", ...]
  studyTimeMs: number         // 累計ミリ秒
}

// localStorage から読み出し（なければ初期値）
function load(): Stats {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) return JSON.parse(raw)
  return { completedLessons: [], studyDates: [], studyTimeMs: 0 }
}

// レッスン完了時にキーを保存 + 今日の日付を記録
export function recordCompletion(lessonKey: string) {
  const stats = load()
  if (!stats.completedLessons.includes(lessonKey)) {
    stats.completedLessons.push(lessonKey)
  }
  const d = today()
  if (!stats.studyDates.includes(d)) stats.studyDates.push(d)
  save(stats)
}

// 連続学習日数の計算（昨日or今日から遡って連続する日数）
export function getStreak(): number {
  const dates = load().studyDates.sort()
  const last = dates[dates.length - 1]
  if (last !== todayStr && last !== yesterdayStr) return 0
  let streak = 1
  for (let i = dates.length - 1; i > 0; i--) {
    const diff = new Date(dates[i]).getTime() - new Date(dates[i-1]).getTime()
    if (diff === 86400000) streak++      // ちょうど1日差
    else if (diff > 86400000) break      // 1日以上空いた
  }
  return streak
}

// XPシステム: レッスン種別ごとにXP量が異なる
const XP_MAP = { lesson: 100, 'mock-exam': 200, 'journal-input': 150, worksheet: 150 }
// + 学習時間1分 = 2XP

// レベル計算
const LEVELS = [
  { xp: 0,    title: '初心者' },
  { xp: 200,  title: '学習者' },
  { xp: 500,  title: '実践者' },
  { xp: 1000, title: '挑戦者' },
  { xp: 2000, title: '達人' },
  { xp: 5000, title: 'マスター' },
]`,
  },
  {
    path: 'src/RolePlaySystem.tsx',
    role: 'AIロールプレイ画面',
    desc: '4つの画面（シナリオ選択→セットアップ→チャット→採点）を持つ複合コンポーネント。ユーザーがシナリオを選び、相手役の設定をカスタマイズし、AIとリアルタイムで会話し、終了後にAIが5項目で採点する。過去の履歴を踏まえた成長フィードバックも提供。',
    tech: ['fetch API', 'useState', 'useRef', '画面遷移パターン'],
    lines: '約500行',
    code: `type Message = { role: 'user' | 'assistant'; content: string }

// 4画面を1つのstateで管理（TypeScriptのユニオン型）
type Screen =
  | { type: 'select' }                                    // シナリオ選択
  | { type: 'setup'; template: ScenarioTemplate }          // 相手役設定
  | { type: 'chat'; setup: ScenarioSetup }                 // 会話中
  | { type: 'score'; setup: ScenarioSetup; messages: Message[] }  // 採点

export default function RolePlaySystem({ onBack }) {
  const [screen, setScreen] = useState<Screen>({ type: 'select' })

  // 画面に応じてコンポーネントを切り替え
  if (screen.type === 'select') return <ScenarioSelect onSelect={...} />
  if (screen.type === 'setup')  return <SetupScreen template={...} onStart={...} />
  if (screen.type === 'chat')   return <ChatScreen setup={...} onFinish={...} />
  if (screen.type === 'score')  return <ScoreScreen setup={...} messages={...} />
}

// チャット画面: サーバーにメッセージを送りAI応答を受け取る
function ChatScreen({ setup, onFinish }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)

  const sendMessage = async (text: string) => {
    const userMsg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    const res = await fetch(\`\${API_BASE}/api/roleplay/chat\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [...messages, userMsg],  // 会話履歴を全部送る
        setup,                              // シナリオ設定も一緒に
      }),
    })
    const data = await res.json()
    setMessages(prev => [...prev, data])   // AIの応答を追加
    setLoading(false)
  }
}`,
  },
  {
    path: 'src/flashcardData.ts',
    role: 'フラッシュカード・間隔反復',
    desc: 'SM-2アルゴリズムに基づく間隔反復学習システム。カードごとにinterval（復習間隔）とease（容易さ係数）を管理。「もう一度」で間隔リセット＋ease低下、「わかった」で間隔×ease倍、「簡単」でease上昇＋間隔1.3倍ボーナス。',
    tech: ['SM-2アルゴリズム', 'localStorage', 'TypeScript型'],
    lines: '約80行',
    code: `export type Flashcard = {
  id: string
  front: string              // 問題面
  back: string               // 解答面
  category: string           // "簿記3級", "MECE" など
  source: string             // 生成元 "lesson-6", "ai-weak"
  interval: number           // 次の復習までの日数
  ease: number               // 容易さ係数（初期値 2.5）
  nextReview: string          // 次回復習日 "YYYY-MM-DD"
  correctCount: number
  wrongCount: number
}

// SM-2 ベースの復習アルゴリズム
export function reviewCard(id: string, quality: 'again' | 'good' | 'easy') {
  const card = cards.find(c => c.id === id)

  if (quality === 'again') {
    // 不正解: 間隔を0にリセット、easeを0.3下げる（最低1.3）
    card.wrongCount++
    card.interval = 0
    card.ease = Math.max(1.3, card.ease - 0.3)
    card.nextReview = todayStr  // 今日また出る

  } else if (quality === 'good') {
    // 正解: 間隔 = 前回 × ease（初回は1日）
    card.correctCount++
    card.interval = card.interval === 0 ? 1 : Math.round(card.interval * card.ease)
    // 例: 1日 → 3日 → 7日 → 18日 ... と間隔が伸びていく

  } else { // 'easy'
    // 簡単: easeを0.15上げ + 間隔に1.3倍ボーナス（初回は3日）
    card.correctCount++
    card.ease = Math.min(3.0, card.ease + 0.15)
    card.interval = card.interval === 0 ? 3 : Math.round(card.interval * card.ease * 1.3)
  }

  // 次回復習日を計算して保存
  const next = new Date(); next.setDate(next.getDate() + card.interval)
  card.nextReview = next.toISOString().slice(0, 10)
  saveCards(cards)
}`,
  },
  {
    path: 'src/Profile.tsx',
    role: 'プロフィール・設定画面',
    desc: '今あなたが見ているこの画面。stats.tsから学習データを読み出し、学習カレンダー（直近12週）、統計グリッド、ロールプレイ履歴を表示。右上の歯車から設定パネルを開ける。この開発者モード自体もReactコンポーネント。',
    tech: ['useMemo', 'useState', 'CSS Grid', 'CSS Animation'],
    lines: '約500行',
    code: `export default function Profile() {
  // stats.ts の関数で学習データを取得
  const completedLessons = getCompletedLessons()  // ["lesson-6", "mock-exam", ...]
  const streak = getStreak()                       // 連続学習日数
  const studyHours = getStudyHours()               // "2.5h" or "30分"
  const studyDates = getStudyDates()               // カレンダー用の日付配列
  const { level, title, xp, progress } = getLevelInfo(rpHistory.length)

  const [showSettings, setShowSettings] = useState(false)
  const [devMode, setDevMode] = useState(false)

  return (
    <div className="profile">
      {/* 右上の歯車アイコン → 設定パネル */}
      {showSettings && <SettingsPanel />}

      {/* ヘッダー: アバター + レベル + XPバー */}
      <div className="pf-hero">
        <DragonMascot size={72} />
        <h2>K</h2>
        <span>Lv.{level} {title}</span>
        <div className="pf-xp-bar">
          <div style={{ width: \`\${progress}%\` }} />  {/* XP進捗バー */}
        </div>
      </div>

      {/* 統計グリッド（連続日数・完了数・学習時間・学習日数） */}
      <div className="pf-stats-grid">...</div>

      {/* 学習カレンダー（直近12週をGitHub風に表示） */}
      <StudyCalendar dates={studyDates} />

      {/* 開発者モードONの時だけ表示 → 今ここ！ */}
      {devMode && <DevPanel />}
    </div>
  )
}

// 学習カレンダー: useMemoで12週分の日付グリッドを生成
function StudyCalendar({ dates }) {
  const dateSet = useMemo(() => new Set(dates), [dates])
  const weeks = useMemo(() => {
    // 83日前（日曜起点）から今日まで、7日ずつの配列を生成
    // 各日付がdateSetに含まれていれば active=true
  }, [dateSet])
  return <div className="pf-cal-grid">...</div>  // CSS Grid で表示
}`,
  },
];
