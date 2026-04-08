import { AGENTS, escapeHtml } from "./api.js";
import { getSession } from "./roundtable.js";

export function renderStudyPanel(root) {
  root.innerHTML = `
    <div class="card" style="margin-bottom:var(--s-5);">
      <div class="stack">
        <div>
          <div class="label">Sprint Contract エクスポート</div>
          <p class="muted" style="margin:0;font-size:13px;">会議の議論を Logic ハーネスの <span class="mono">active.md</span> 形式に整形します。Logic Planner エージェントがそのまま読めます。</p>
        </div>
        <div class="row-between">
          <span class="faint" style="font-size:12px;" id="study-source"></span>
          <div class="row">
            <button id="study-copy" class="btn btn-sm">コピー</button>
            <button id="study-download" class="btn btn-primary btn-sm">ダウンロード</button>
          </div>
        </div>
      </div>
    </div>
    <pre class="study-out" id="study-output"></pre>
  `;

  const out = root.querySelector("#study-output");
  const src = root.querySelector("#study-source");
  const refresh = () => {
    out.textContent = buildSprintMarkdown();
    const s = getSession();
    src.textContent = s.topic ? `議題: ${s.topic}` : "先に会議タブで議論を実行してください";
  };
  refresh();

  root.querySelector("#study-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(buildSprintMarkdown()); } catch {}
  });
  root.querySelector("#study-download").addEventListener("click", () => {
    const blob = new Blob([buildSprintMarkdown()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "active.md"; a.click();
    URL.revokeObjectURL(url);
  });
  root.__refresh = refresh;
}

function buildSprintMarkdown() {
  const s = getSession();
  if (!s.topic) {
    return `# Sprint: （議題なし）\n\n先に会議タブで議論を実行してください。\n`;
  }
  const today = new Date().toISOString().slice(0, 10);
  const renderPhase = (store) => AGENTS.map((a) => {
    const t = store.get(a.id);
    return t ? `### ${a.name}（${a.role}）\n${t.trim()}\n` : "";
  }).filter(Boolean).join("\n");

  return `# Sprint: ${s.topic}
Date: ${today}
Source: Apollo Mansion CXO 会議

## Goal
${s.topic}

## 戦略インプット — Phase 1（初期意見）

${renderPhase(s.phase1) || "（Phase 1 未実施）"}

## 戦略インプット — Phase 2（相互反論）

${renderPhase(s.phase2) || "（Phase 2 未実施）"}

## Scope
- TODO: Planner が議論内容から scope を確定する
- TODO: 変更ファイル・新規ファイル・依存追加の有無を列挙

## Acceptance criteria
### Type & build
- [ ] \`npx tsc -b --noEmit\` exits 0
- [ ] \`npm run build\` exits 0

### TODO
- [ ] Planner が検証可能な項目へ分解する

## Out of scope
- TODO
`;
}
