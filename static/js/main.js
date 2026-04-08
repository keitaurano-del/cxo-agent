import { renderRoundtablePanel } from "./roundtable.js";
import { renderLibraryPanel } from "./library.js";
import { renderStudyPanel } from "./study.js";
import { renderWorkflowPanel } from "./workflow.js";
import { renderUIPanel } from "./ui.js";
import { renderPlannerPanel } from "./planner.js";
import { renderSpecPanel } from "./spec.js";
import { renderDesignPanel } from "./design.js";

// lucide-style inline SVG (stroke-based, 16px)
const ICONS = {
  roundtable: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  planner: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  library: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  ui: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  spec: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`,
  design: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="19" cy="13" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="10" cy="20" r="2.5"/><path d="M12 2a10 10 0 1 0 0 20"/></svg>`,
  agents: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>`,
  export: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
};

const TABS = [
  { id: "roundtable", label: "会議",        title: "CXO 会議",          subtitle: "CXO 5 名による Phase 1 → Phase 2 の議論", icon: ICONS.roundtable },
  { id: "planner",    label: "Planner 指示", title: "Planner 指示",       subtitle: "会議をスキップして Planner または CXO に直接タスクを割り当てる", icon: ICONS.planner },
  { id: "library",    label: "ナレッジ",     title: "ナレッジ",           subtitle: "各 CXO がこれまでの議論から学習した知見", icon: ICONS.library },
  { id: "ui",         label: "UI",           title: "Logic UI プレビュー", subtitle: "実画面をライブ表示。バージョン管理 + ドラミによる UI 修正", icon: ICONS.ui },
  { id: "design",     label: "デザイン案",   title: "デザイン案",         subtitle: "Logic のリデザイン提案。モック HTML で方向性を確認", icon: ICONS.design },
  { id: "spec",       label: "Logic 仕様",   title: "Logic 仕様",         subtitle: "Logic アプリの技術スタックとソース構成", icon: ICONS.spec },
  { id: "workflow",   label: "エージェント", title: "エージェント一覧",   subtitle: "稼働中のエージェントとサブエージェントの役割", icon: ICONS.agents },
  { id: "study",      label: "エクスポート", title: "Sprint Contract",    subtitle: "会議の議論を Logic ハーネスの active.md に変換", icon: ICONS.export },
];

const LOGIC_URL_DEFAULT = "https://logic-u5wn.onrender.com/";

const app = document.getElementById("app");
app.innerHTML = `
  <div class="app">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">Apollo Mansion</div>
        <div class="sidebar-brand-sub">CXO operations</div>
      </div>
      <nav class="sidebar-nav">
        ${TABS.map((t) => `
          <button class="nav-item" data-tab="${t.id}">
            ${t.icon}
            <span>${t.label}</span>
          </button>
        `).join("")}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-footer-label">Logic</div>
        <div class="sidebar-footer-url" id="sidebar-logic-url">${localStorage.getItem("apollo-ui-logic-url-v2") || LOGIC_URL_DEFAULT}</div>
      </div>
    </aside>
    <main class="main">
      <header class="main-header" id="main-header"></header>
      <div class="main-body">
        ${TABS.map((t) => `<section class="panel" data-panel="${t.id}"></section>`).join("")}
      </div>
    </main>
  </div>
`;

const navButtons = app.querySelectorAll(".nav-item");
const panels = app.querySelectorAll(".panel");
const header = app.querySelector("#main-header");
const initialized = new Set();

function activate(id) {
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === id));

  const tab = TABS.find((t) => t.id === id);
  header.innerHTML = `
    <div>
      <h1 class="main-title">${tab.title}</h1>
      <div class="main-subtitle">${tab.subtitle}</div>
    </div>
  `;

  if (!initialized.has(id)) {
    const host = app.querySelector(`[data-panel="${id}"]`);
    if (id === "roundtable") renderRoundtablePanel(host);
    else if (id === "planner") renderPlannerPanel(host);
    else if (id === "library") renderLibraryPanel(host);
    else if (id === "ui") renderUIPanel(host);
    else if (id === "design") renderDesignPanel(host);
    else if (id === "spec") renderSpecPanel(host);
    else if (id === "workflow") renderWorkflowPanel(host);
    else if (id === "study") renderStudyPanel(host);
    initialized.add(id);
  } else if (id === "study") {
    const host = app.querySelector(`[data-panel="${id}"]`);
    if (host.__refresh) host.__refresh();
  }
}

navButtons.forEach((b) => b.addEventListener("click", () => activate(b.dataset.tab)));
activate("roundtable");
