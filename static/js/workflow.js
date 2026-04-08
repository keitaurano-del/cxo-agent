import { escapeHtml } from "./api.js";

const AGENT_REGISTRY = {
  "logic-planner":   { name: "Planner",   role: "指示を sprint contract (active.md) に落とし込む。必要なら CXO 円卓に戦略相談", group: "core", calls: ["cxo-roundtable"] },
  "logic-generator": { name: "Generator", role: "active.md を読んで実装。tsc セルフチェックし handoff.md を出力", group: "core", calls: [] },
  "logic-evaluator": { name: "Evaluator", role: "contract を機械的に検証（tsc / curl / grep）。書き込み権限なし", group: "core", calls: [] },

  "cxo-roundtable": { name: "Roundtable", role: "CXO 5 名を Phase 1（独立意見）→ Phase 2（相互反論）で逐次呼び出す", group: "cxo", calls: ["cxo-cso", "cxo-cfo", "cxo-cmo", "cxo-cto", "cxo-cpo"] },
  "cxo-consultant": { name: "外部コンサル", role: "CXO 5 名の発言を冷徹に評価し、5 項目でスコアリング", group: "cxo", calls: [] },
  "cxo-cso": { name: "CSO のび太",     role: "戦略・競合・市場ポジショニング", group: "cxo", calls: [] },
  "cxo-cfo": { name: "CFO スネ夫",     role: "収益モデル・価格設計・コスト・ROI", group: "cxo", calls: [] },
  "cxo-cmo": { name: "CMO 出木杉",     role: "集客・ブランディング・ASO / SEO・コミュニティ", group: "cxo", calls: [] },
  "cxo-cto": { name: "CTO ドラえもん", role: "技術選定・アーキテクチャ・開発効率", group: "cxo", calls: [] },
  "cxo-cpo": { name: "CPO ドラミ",     role: "プロダクト戦略・機能優先度・UX。UI タブで修正デザイナーも兼任", group: "cxo", calls: [] },

  "Explore":           { name: "Explore",    role: "コードベースの探索・ファイル検索・既存実装の調査", group: "builtin", calls: [] },
  "Plan":              { name: "Plan",       role: "実装戦略の設計・代替案の検討・計画レビュー", group: "builtin", calls: [] },
  "general-purpose":   { name: "General",    role: "汎用エージェント。複雑なマルチステップの調査・実行", group: "builtin", calls: [] },
  "statusline-setup":  { name: "Statusline", role: "Claude Code のステータスライン設定", group: "builtin", calls: [] },
  "claude-code-guide": { name: "CC Guide",   role: "Claude Code / API / SDK に関する質問応答", group: "builtin", calls: [] },
};

const GROUPS = [
  { key: "core", label: "Logic ハーネス" },
  { key: "cxo", label: "CXO 戦略エージェント" },
  { key: "builtin", label: "Claude Code 組み込み" },
];

export function renderWorkflowPanel(root) {
  const byGroup = { core: [], cxo: [], builtin: [] };
  Object.entries(AGENT_REGISTRY).forEach(([id, meta]) => byGroup[meta.group].push({ id, meta }));

  const renderCard = ({ id, meta }) => {
    const calls = (meta.calls || []).map((childId) => {
      const child = AGENT_REGISTRY[childId];
      return `<span class="badge badge-accent">${escapeHtml(child ? child.name : childId)}</span>`;
    }).join("");
    return `
      <article class="agent-card">
        <div class="agent-card-name">${escapeHtml(meta.name)}</div>
        <div class="agent-card-id mono">${escapeHtml(id)}</div>
        <div class="agent-card-role">${escapeHtml(meta.role)}</div>
        ${calls ? `
          <div class="agent-card-calls">
            <span class="agent-card-calls-label">calls</span>
            ${calls}
          </div>
        ` : ""}
      </article>
    `;
  };

  root.innerHTML = GROUPS.map((g) => {
    const items = byGroup[g.key];
    if (!items.length) return "";
    return `
      <section class="agent-group">
        <div class="agent-group-head">
          <div class="agent-group-title">${g.label}</div>
          <div class="agent-group-count">${items.length}</div>
        </div>
        <div class="agent-grid">${items.map(renderCard).join("")}</div>
      </section>
    `;
  }).join("");
}
