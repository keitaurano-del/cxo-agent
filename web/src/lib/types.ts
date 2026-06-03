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
}

// ─── 承認フロー（MC-79 / GET /api/approvals）──────────────────────
// server/src/collectors/approvals.ts のレスポンス形と一致させる。

export type ApprovalKind = 'blocked' | 'deploy' | 'design' | 'approval' | 'confirm';

export interface ApprovalItem extends Task {
  categories: ApprovalKind[];
  primaryCategory: ApprovalKind;
}

export interface ApprovalsResponse {
  generatedAt: string;
  byCategory: Record<ApprovalKind, number>;
  total: number;
  items: ApprovalItem[];
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
  | 'other';

export interface DeliverableFile {
  name: string;
  relpath: string; // DELIVERABLES_DIR 相対（posix 区切り）
  sizeBytes: number;
  mtime: string; // ISO
  ext: string;
  kind: DeliverableKind;
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
