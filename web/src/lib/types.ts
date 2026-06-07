// backend のレスポンス形に合わせた型（server/src/* と一致させる）。

export type AgentStatus = 'active' | 'idle' | 'done' | 'never';

export type ProjectName =
  | 'logic'
  | 'en-chakai'
  | 'nishimaru'
  | 'ai-pmo'
  | 'cxo'
  | 'private'
  | 'other';

export interface AgentSummary {
  agentId: string;
  subagentType: string;
  description?: string;
  matched: boolean;
  project: ProjectName;
  projectLabel: string;
  status: AgentStatus;
  lastActivity: string;
  lastAction: string;
  sessionId: string;
  isWorkflow: boolean;
  filePath: string;
  cwd?: string;
  gitBranch?: string;
  messageCount: number;
  currentTaskId?: string; // MC-164: 現在作業中のタスク ID
}

// 秘書レイヤー（MC-165 拡張 / GET /api/secretaries）。
// server/src/collectors/secretaries.ts の SecretarySummary と一致させる。
export interface SecretarySummary {
  key: string;
  name: string;
  emoji: string;
  role: string;
  layer: 'secretary';
  status: AgentStatus;
  lastAction: string;
  lastActivity: string;
}

// エージェント/秘書の気持ち・思考（MC-165 拡張 / GET /api/agent-moods）。
// server/src/collectors/moods.ts の AgentMood と一致させる。
export interface AgentMood {
  key: string;
  emoji: string;
  mood: string;
  thought: string;
  /** いま「どのタスクの何をしているか」を具体的に表す一人称 1〜2 行（active 向け・主役）。 */
  doing: string;
}

// 人格別に集約したエージェントグループ（MC-88 / GET /api/agents/grouped）。
// server/src/collectors/agents.ts の AgentGroup と一致させる。
export interface AgentGroup {
  subagentType: string;
  isPersona: boolean;
  description?: string;
  status: AgentStatus;
  instanceCount: number;
  activeCount: number;
  idleCount: number;
  doneCount: number;
  neverCount: number;
  lastActivity: string;
  lastAction: string;
  latestAgentId: string;
  projectLabel?: string;
  projects: string[];
}

export interface FeedItem {
  ts: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  kind: 'text' | 'tool_use' | 'tool_result' | 'other';
  toolName?: string;
  text: string;
}

export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'REVIEW'
  | 'DONE'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface TaskExecutor {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  owner?: string;
  priority?: string;
  project: ProjectName;
  source: string;
  updated?: string;
  stalled: boolean;
  // ─── 承認フロー（MC-79）の追加フィールド（既存 UI 非影響）──────────
  needsKeita?: boolean;
  approvalTags?: ApprovalKind[];
  // ─── タスク詳細（MC-83）。台帳の「詳細」等を整形した read-only テキスト。取れなければ未設定。──
  detail?: string;
  // ─── エージェント活動（MC-164）。現在このタスクで作業中のエージェント。──
  executor?: TaskExecutor;
  // ─── ブロッカー・依存（MC-168）。台帳の「依存」由来。空/「なし」なら未設定。──
  blockedBy?: string[];
  dependsOn?: string[];
}

// ─── 承認フロー（MC-79 / GET /api/approvals）──────────────────────
// server/src/collectors/approvals.ts のレスポンス形と一致させる。

export type ApprovalKind = 'blocked' | 'deploy' | 'design' | 'approval' | 'confirm';

export interface ApprovalItem extends Task {
  categories: ApprovalKind[];
  primaryCategory: ApprovalKind;
}

/** エージェントが直接 POST した承認リクエスト。server/src/lib/approvalRequestStore.ts と一致させる。 */
export interface ApprovalRequest {
  id: string;
  from: string;
  fromName: string;
  title: string;
  description: string;
  category: 'deploy' | 'design' | 'approval' | 'confirm';
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: string;
  comment?: string;
  /** オートモードによる自動承認のとき true（手動承認では付かない）。 */
  autoApproved?: boolean;
}

/** 承認済・履歴の 1 件（GET /api/approvals/history）。server/src/approvalRouter.ts と一致させる。 */
export interface HistoryEntry {
  kind: 'request' | 'task';
  id: string;
  decidedAt: string;
  decision: 'approve' | 'reject';
  title?: string;
  fromName?: string;
  categories: ApprovalKind[];
  comment?: string;
  autoApproved?: boolean;
  source?: string;
}

/** GET /api/approvals/history のレスポンス。 */
export interface ApprovalHistoryResponse {
  generatedAt: string;
  total: number;
  entries: HistoryEntry[];
}

/** 承認オートモードの状態（MC-186 / GET・POST /api/approvals/automode）。 */
export interface AutoModeResponse {
  enabled: boolean;
  updatedAt: string | null;
}

export interface ApprovalsResponse {
  generatedAt: string;
  byCategory: Record<ApprovalKind, number>;
  total: number;
  items: ApprovalItem[];
  /** エージェントが直接 POST した承認リクエスト（pending のみ）。 */
  requests: ApprovalRequest[];
}

export interface NarrativeDoc {
  date: string | null;
  file: string | null;
  body: string;
  updated?: string;
}

export interface Narrative {
  briefing: NarrativeDoc;
  inspection: NarrativeDoc;
  feedback: NarrativeDoc;
}

export interface RosterEntry {
  name: string;
  persona?: string;
  personality?: string;
  role?: string;
  agentType?: string;
  phase?: string;
  summary: string;
  updated?: string;
  liveStatus?: AgentStatus;
  activeCount: number;
  idleCount: number;
  lastActivity?: string;
  currentProject?: string;
}

export interface OverviewProject {
  project: ProjectName;
  agentsActive: number;
  agentsIdle: number;
  agentsTotal: number;
  tasksTotal: number;
  tasksInProgress: number;
  tasksStalled: number;
  lastActivity: string | null;
}

export interface OverviewKpi {
  agentsActive: number;
  agentsIdle: number;
  agentsDone: number;
  agentsNever: number;
  agentsTotal: number;
  tasksInProgress: number;
  tasksStalled: number;
  tasksBlocked: number;
  tasksReview: number;
  tasksTotal: number;
}

export interface Overview {
  generatedAt: string;
  kpi: OverviewKpi;
  projects: OverviewProject[];
}

// ─── Vault（Obsidian 一元化ビュー）──────────────────────────

export interface VaultTreeNode {
  name: string;
  path: string; // vault 相対
  type: 'dir' | 'file';
  ext?: string;
  mtime?: string;
  children?: VaultTreeNode[];
}

export interface VaultTreeResponse {
  generatedAt: string;
  tree: VaultTreeNode;
}

export interface VaultNoteLink {
  target: string;
  display: string;
  path: string | null; // null = 未解決リンク
  heading?: string;
}

export interface VaultBacklink {
  path: string;
  title: string;
}

export interface VaultNote {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mtime: string | null;
  outgoingLinks: VaultNoteLink[];
  backlinks: VaultBacklink[];
}

export interface VaultSearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface VaultSearchResponse {
  query: string;
  results: VaultSearchHit[];
}

// ─── 成果物（Deliverables）─────────────────────────────

export type DeliverableKind =
  | 'spreadsheet'
  | 'presentation'
  | 'document'
  | 'pdf'
  | 'image'
  | 'markdown'
  | 'text'
  | 'folder'
  | 'other';

export interface DeliverableFile {
  name: string;
  relpath: string; // DELIVERABLES_DIR 相対（posix 区切り）
  sizeBytes: number;
  mtime: string; // ISO
  ext: string;
  kind: DeliverableKind;
  isDir?: boolean; // 空ディレクトリのエントリ
}

export interface DeliverablesResponse {
  generatedAt: string;
  files: DeliverableFile[];
  error?: string;
}

// ─── 横断検索（MC-73 / GET /api/search）──────────────────────
// server/src/collectors/search.ts のレスポンス形と一致させる。

export interface SearchTaskResult {
  type: 'task';
  id: string;
  label: string;
  sublabel?: string;
  snippet?: string;
  source: string;
  status: string;
  project: ProjectName;
}

export interface SearchAgentResult {
  type: 'agent';
  id: string;
  name: string;
  label: string;
  sublabel?: string;
  snippet?: string;
}

export interface SearchConversationResult {
  type: 'conversation';
  id: string;
  agentId: string;
  label: string;
  sublabel?: string;
  snippet?: string;
  projectLabel: string;
}

export interface SearchWorkflowResult {
  type: 'workflow';
  id: string;
  runId: string;
  agentId: string | null;
  label: string;
  sublabel?: string;
  snippet?: string;
  projectLabel: string;
}

export interface SearchVaultResult {
  type: 'vault';
  id: string;
  path: string;
  label: string;
  sublabel?: string;
  snippet?: string;
}

export interface SearchResponse {
  query: string;
  tasks: SearchTaskResult[];
  agents: SearchAgentResult[];
  conversations: SearchConversationResult[];
  workflows: SearchWorkflowResult[];
  vault: SearchVaultResult[];
  totals: {
    tasks: number;
    agents: number;
    conversations: number;
    workflows: number;
    vault: number;
    all: number;
  };
  generatedAt: string;
}

// ─── deploy 連動（MC-64 / GET /api/deploys）──────────────────────
// server/src/collectors/deploys.ts のレスポンス形と一致させる。

export interface DeployRun {
  id: number;
  title: string;
  status: string;
  conclusion: string | null;
  branch: string;
  event: string;
  workflow: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface DeployRepo {
  repo: string;
  project: ProjectName;
  runs: DeployRun[];
  error?: string;
}

export interface DeploysResponse {
  generatedAt: string;
  source: string;
  cached: boolean;
  repos: DeployRepo[];
}

// ─── アラート（通知/アラート バッジ MC-63 / GET /api/alerts）──────────────
// server/src/collectors/alerts.ts のレスポンス形と一致させる。

export type AlertSeverity = 'error' | 'warning';

export type AlertCategory = 'error' | 'blocked-stalled' | 'deploy-failed' | 'inbox-stalled';

export interface AlertItem {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  project?: ProjectName;
  taskId?: string;
  source?: string;
  runId?: string;
  since?: string;
}

export interface AlertsResponse {
  generatedAt: string;
  counts: {
    error: number;
    warning: number;
    total: number;
  };
  byCategory: {
    error: number;
    'blocked-stalled': number;
    'deploy-failed': number;
    'inbox-stalled': number;
  };
  alerts: AlertItem[];
  thresholds: {
    blockedStallDays: number;
    inboxStallHours: number;
  };
}

// ─── Claude プラン使用量（MC-122 / GET /api/claude-usage）──────────────
// server/src/collectors/claudeUsage.ts のレスポンス形と一致させる。

/** 1 つのバー（使用率 % + リセット時刻）。 */
export interface UsageBar {
  pct: number | null;
  resetsAt: string | null;
}

export type ClaudeAccountKey = 'local' | 'oldbox';

/** 1 アカウント分の使用量。取得失敗部分は error に畳む。 */
export interface ClaudeAccountUsage {
  key: ClaudeAccountKey;
  label: string;
  email?: string;
  tier?: string;
  session: UsageBar;
  weekAll: UsageBar;
  weekSonnet: UsageBar | null;
  weekOpus?: UsageBar | null;
  fetchedAt: string;
  error?: string;
}

export interface ClaudeUsageSummary {
  generatedAt: string;
  cached: boolean;
  ttlMs: number;
  accounts: ClaudeAccountUsage[];
}

// ─── ノートブック（NotebookLM 的な資料セット＋Q&A＋生成物、MC-126）─────────
// server/src/lib/notebookStore.ts のレスポンス形と一致させる。

export type NotebookSourceKind =
  | 'pdf'
  | 'spreadsheet'
  | 'presentation'
  | 'document'
  | 'image'
  | 'markdown'
  | 'text'
  | 'other';

/** ノートブック一覧の 1 件（GET /api/notebooks の notebooks[]）。 */
export interface NotebookSummary {
  id: string;
  name: string;
  sourceCount: number;
  artifactCount: number;
  updatedAt: string;
}

/** ノートブックのメタ（POST /api/notebooks のレスポンス・詳細の meta）。 */
export interface NotebookMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** ノートブック内のソース / 生成物ファイル参照。 */
export interface NotebookFileRef {
  name: string;
  relpath: string; // 'sources/foo.pdf' / 'artifacts/要約.md'
  sizeBytes: number;
  mtime: string;
  ext: string;
  kind: NotebookSourceKind;
  extracted?: boolean; // sources のみ: 抽出テキスト生成済みか
}

/** チャット 1 メッセージ（chat.jsonl の 1 行）。 */
export interface NotebookChatMessage {
  ts: string;
  role: 'user' | 'assistant';
  text: string;
}

/** ノートブック詳細（GET /api/notebooks/:id）。 */
export interface NotebookDetail {
  meta: NotebookMeta;
  sources: NotebookFileRef[];
  artifacts: NotebookFileRef[];
  chat: NotebookChatMessage[];
}

/** POST /api/notebooks/:id/ask のレスポンス。 */
export interface NotebookAskResponse {
  answer: string;
  error?: string; // 部分劣化（タイムアウト等）時のみ
}

/** 生成物 kind。custom は instruction 必須。 */
export type NotebookGenerateKind = 'summary' | 'faq' | 'timeline' | 'template' | 'template_extract' | 'custom';

/** POST /api/notebooks/:id/generate のレスポンス。 */
export interface NotebookGenerateResponse {
  ok: boolean;
  created: NotebookFileRef[]; // 今回新規作成された成果物
  artifacts: NotebookFileRef[]; // 現在の全成果物
  report: string; // claude の最終報告（作成ファイル名等）
  error?: string;
}

// ─── 議事録（Minutes）──────────────────────────────────────

export type MinutesType = 'verbatim' | 'summary' | 'decisions' | 'chronological';
export type MinutesFormat = 'markdown' | 'sections' | 'plain';

export interface MinutesTemplate {
  id: string;
  label: string;
  body: string;
}

export interface MinutesTypePreset {
  type: MinutesType;
  label: string;
  description: string;
  templates: MinutesTemplate[];
}

export interface MinutesPattern {
  id: string;
  name: string;
  type: string;
  format: string;
  templateId?: string;
  templateBody?: string;
  instructions?: string;
  createdAt: string;
}

export interface MinutesPresetsResponse {
  types: MinutesTypePreset[];
  formats: { format: MinutesFormat; label: string }[];
}

export interface MinutesTranscribeResponse {
  text?: string;
  error?: string;
}

export interface MinutesPatternsResponse {
  patterns: MinutesPattern[];
  error?: string;
}

export interface MinutesGenerateResponse {
  ok: boolean;
  created: NotebookFileRef[];
  artifacts: NotebookFileRef[];
  report?: string;
  error?: string;
  deliverableRelpath?: string; // Deliverables 直接保存版で保存された議事録の relpath
}

// ─── フォルダツリー（artifacts/ のサブフォルダ構造）──────────────────────

export interface NotebookFolderEntry {
  name: string;
  files: NotebookFileRef[];
}

export interface NotebookFolderTree {
  folders: NotebookFolderEntry[];
  rootFiles: NotebookFileRef[];
}

// ─── 受信箱（Inbox / MC-189）──────────────────────────────────────
// server/src/inbox.ts の InboxEntry と一致させる。

export type InboxProject = 'logic' | 'cxo' | 'en-chakai' | null;
export type InboxPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface InboxEntry {
  id: string;
  ts: string;
  kind: 'task';
  project: InboxProject;
  text: string;
  status: 'pending';
  attachments: string[];
  priority: InboxPriority;
  taskId?: string;
  trackerSource?: string;
  agent?: string;
}
