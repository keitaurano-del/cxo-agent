import { AGENTS, fetchKnowledge, escapeHtml } from "./api.js";

let currentAgent = "cso";

export function renderLibraryPanel(root) {
  root.innerHTML = `
    <div class="lib-segments" id="lib-segments">
      ${AGENTS.map((a) => `<button class="lib-segment ${a.id === currentAgent ? "active" : ""}" data-agent="${a.id}">${escapeHtml(a.name)}</button>`).join("")}
    </div>
    <div id="lib-content"></div>
  `;

  root.querySelectorAll(".lib-segment").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentAgent = btn.dataset.agent;
      root.querySelectorAll(".lib-segment").forEach((b) => b.classList.toggle("active", b.dataset.agent === currentAgent));
      loadAndRender(root);
    });
  });

  loadAndRender(root);
}

async function loadAndRender(root) {
  const host = root.querySelector("#lib-content");
  host.innerHTML = `<div class="card empty">読み込み中…</div>`;
  try {
    const k = await fetchKnowledge(currentAgent);
    const items = k.learnings || [];
    if (!items.length) {
      host.innerHTML = `<div class="card empty">学習された知見はまだありません</div>`;
      return;
    }
    const pinned = items.filter((i) => i.is_pinned);
    const rest = items.filter((i) => !i.is_pinned);
    host.innerHTML = `
      ${pinned.length ? `
        <div class="lib-section-title">ピン留め（${pinned.length}）</div>
        <div class="lib-grid">${pinned.map(renderItem).join("")}</div>
      ` : ""}
      <div class="lib-section-title">学習履歴（${rest.length}）</div>
      <div class="lib-grid">${rest.map(renderItem).join("")}</div>
    `;
  } catch (e) {
    host.innerHTML = `<div class="card empty">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function renderItem(item) {
  const tags = (item.tags || []).map(escapeHtml).join(" · ");
  return `
    <div class="lib-item ${item.is_pinned ? "pinned" : ""}">${escapeHtml(item.text)}<div class="lib-item-meta">${item.session_topic ? escapeHtml(item.session_topic) + " · " : ""}${item.created_at || ""}${tags ? " · " + tags : ""}</div></div>
  `;
}
