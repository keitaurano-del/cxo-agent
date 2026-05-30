// agentId → subagent_type 解決（本実装の最難所）。
//
// 仕組み:
//   1. 親セッション jsonl（subagents/ を含まない *.jsonl）の assistant 行を走査し、
//      `Agent`（旧称 Task）tool_use の input から { subagent_type, description, prompt } を集める。
//      ※この環境では tool 名が "Agent"。互換のため "Task" も拾う。
//   2. 各 subagent ファイルの先頭 user message テキスト = その Agent の prompt と一致する。
//      これで照合して subagent_type ラベルを付与する。
//   3. ワークフロー孫（subagents/workflows/wf_*/）は Workflow script 内でプロンプトが定義され、
//      Agent tool_use 経由ではないため照合できないことが多い。その場合は cwd ベースの暫定ラベル。
//
// 注意: grep に依存せず、すべて Node の fs 読み込みで解析する（ugrep エイリアス問題回避）。

import { readJsonl } from './jsonl.js';

export interface AgentSpec {
  subagentType: string;
  description?: string;
  prompt: string;
}

/** prompt 文字列の正規化（前後空白除去）。 */
function norm(s: string): string {
  return s.trim();
}

/**
 * 親セッション群から Agent/Task tool_use を集めて prompt→spec の索引を作る。
 * - byExact: 正規化済みフルプロンプト → spec
 * - byHead:  プロンプト先頭200文字 → spec（ゆらぎ吸収）
 */
export class AgentTypeIndex {
  private byExact = new Map<string, AgentSpec>();
  private byHead = new Map<string, AgentSpec>();
  specs: AgentSpec[] = [];

  add(spec: AgentSpec): void {
    const p = norm(spec.prompt);
    if (!p) return;
    this.specs.push(spec);
    if (!this.byExact.has(p)) this.byExact.set(p, spec);
    const head = p.slice(0, 200);
    if (!this.byHead.has(head)) this.byHead.set(head, spec);
  }

  /** subagent 先頭 user テキストから subagent_type を引く。見つからなければ null。 */
  lookup(firstUserText: string | null | undefined): AgentSpec | null {
    if (!firstUserText) return null;
    const u = norm(firstUserText);
    const exact = this.byExact.get(u);
    if (exact) return exact;
    const head = this.byHead.get(u.slice(0, 200));
    if (head) return head;
    // prefix 照合: prompt 先頭150文字で subagent テキストが始まるか
    for (const s of this.specs) {
      const ph = norm(s.prompt).slice(0, 150);
      if (ph && u.startsWith(ph)) return s;
    }
    return null;
  }

  get size(): number {
    return this.byExact.size;
  }
}

const AGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

/** 1 つの親セッションファイルから Agent tool_use を抽出して index に投入。 */
export function indexParentSession(filePath: string, index: AgentTypeIndex): void {
  const lines = readJsonl(filePath);
  for (const line of lines) {
    if (line.type !== 'assistant') continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as any[]) {
      if (
        block &&
        block.type === 'tool_use' &&
        AGENT_TOOL_NAMES.has(block.name) &&
        block.input &&
        typeof block.input.prompt === 'string' &&
        typeof block.input.subagent_type === 'string'
      ) {
        index.add({
          subagentType: block.input.subagent_type,
          description:
            typeof block.input.description === 'string' ? block.input.description : undefined,
          prompt: block.input.prompt,
        });
      }
    }
  }
}
