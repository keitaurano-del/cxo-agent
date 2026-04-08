// デザイン案タブ — Logic のリデザイン提案を閲覧
// 各案は static/mocks/<slug>/index.html を持つ前提

const PROPOSALS = [
  {
    slug: "logic-v3",
    name: "Logic v3",
    subtitle: "Brand-aligned · Indigo from logo",
    description: "Logic のブランドロゴ (#3D5FC4) を基点にした配色。Brilliant のクリーン構造 + Linear のサイドバー + Inter Tight display。accent は単一 indigo、warm は streak amber のみ。PC/スマホ両レイアウト。",
    url: "/static/mocks/logic-v3/index.html",
    tags: ["Brand Indigo", "Brilliant", "Linear", "PC + Mobile", "#3D5FC4"],
  },
  {
    slug: "logic-v2",
    name: "Logic v2",
    subtitle: "Notion clarity × Speak warmth",
    description: "Notion 学習テンプレートのクリーンさと英会話アプリ Speak の暖かさを組み合わせた、モバイルファースト案。coral accent + warm off-white。",
    url: "/static/mocks/logic-v2/index.html",
    tags: ["Notion", "Speak", "coral", "mobile-first"],
  },
];

export function renderDesignPanel(root) {
  root.innerHTML = `
    <div class="design-list" id="design-list"></div>
    <div class="design-viewer" id="design-viewer" style="display:none;">
      <div class="row-between" style="margin-bottom:var(--s-4);">
        <div>
          <div class="design-viewer-title" id="design-viewer-title"></div>
          <div class="design-viewer-sub muted" id="design-viewer-sub"></div>
        </div>
        <div class="row">
          <button class="btn btn-sm" id="design-open-new">新規タブで開く ↗</button>
          <button class="btn btn-sm" id="design-back">← 一覧に戻る</button>
        </div>
      </div>
      <iframe class="design-iframe" id="design-iframe"></iframe>
    </div>
  `;

  renderList(root);

  root.querySelector("#design-back").addEventListener("click", () => {
    root.querySelector("#design-list").style.display = "";
    root.querySelector("#design-viewer").style.display = "none";
    root.querySelector("#design-iframe").src = "about:blank";
  });

  root.querySelector("#design-open-new").addEventListener("click", () => {
    const iframe = root.querySelector("#design-iframe");
    if (iframe.src && iframe.src !== "about:blank") window.open(iframe.src, "_blank");
  });
}

function renderList(root) {
  const host = root.querySelector("#design-list");
  host.innerHTML = `
    <div class="design-grid">
      ${PROPOSALS.map((p) => `
        <article class="design-card" data-slug="${p.slug}">
          <div class="design-thumb">
            <iframe src="${p.url}" loading="lazy" scrolling="no"></iframe>
            <div class="design-thumb-overlay"></div>
          </div>
          <div class="design-card-body">
            <div class="design-card-title">${escapeHtml(p.name)}</div>
            <div class="design-card-sub muted">${escapeHtml(p.subtitle)}</div>
            <div class="design-card-desc">${escapeHtml(p.description)}</div>
            <div class="design-card-tags">
              ${p.tags.map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("")}
            </div>
            <div class="row" style="margin-top:var(--s-3);">
              <button class="btn btn-primary btn-sm" data-view="${p.slug}">プレビュー</button>
              <a class="btn btn-sm" href="${p.url}" target="_blank">新規タブ ↗</a>
            </div>
          </div>
        </article>
      `).join("")}
    </div>
    <div class="design-hint muted" style="margin-top:var(--s-5);font-size:12px;">
      モックは Apollo Mansion 内の <span class="mono">static/mocks/</span> に静的 HTML として配置されています。承認後、Logic 本体への反映は harness (logic-planner → generator) 経由で行います。
    </div>
  `;

  host.querySelectorAll("button[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.dataset.view;
      const proposal = PROPOSALS.find((p) => p.slug === slug);
      if (!proposal) return;
      openViewer(root, proposal);
    });
  });
}

function openViewer(root, proposal) {
  root.querySelector("#design-list").style.display = "none";
  root.querySelector("#design-viewer").style.display = "";
  root.querySelector("#design-viewer-title").textContent = proposal.name;
  root.querySelector("#design-viewer-sub").textContent = proposal.subtitle;
  root.querySelector("#design-iframe").src = proposal.url;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
