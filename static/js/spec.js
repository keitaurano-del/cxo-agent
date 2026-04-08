import { escapeHtml } from "./api.js";
import { TECH_STACK, SOURCE_FILES } from "./logic-spec-data.js";

function slugify(s) {
  return String(s).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function renderSpecPanel(root) {
  root.innerHTML = `
    <div class="spec-layout">
      <aside class="spec-sidebar">
        <div class="spec-stack-summary">
          <h4>技術スタック</h4>
          ${TECH_STACK.map((g) => `
            <div class="spec-stack-summary-group">
              <strong>${escapeHtml(g.category)}</strong><br>
              <span>${g.items.map((i) => escapeHtml(i.name)).join(" · ")}</span>
            </div>
          `).join("")}
        </div>
        <div>
          <div class="spec-toc-title">ファイル構成</div>
          <div class="spec-toc" id="spec-toc">
            ${SOURCE_FILES.map((f) => `
              <button class="spec-toc-item" data-slug="${slugify(f.path)}">${escapeHtml(f.path)}</button>
            `).join("")}
          </div>
        </div>
      </aside>
      <div class="spec-content" id="spec-content">
        ${SOURCE_FILES.map((f) => `
          <section class="spec-file-section" id="file-${slugify(f.path)}">
            <div class="spec-file-path">${escapeHtml(f.path)}</div>
            <div class="spec-file-role">${escapeHtml(f.role)}</div>
            <div class="spec-file-desc">${escapeHtml(f.desc)}</div>
            ${(f.tech || []).length ? `
              <div class="spec-file-tags">
                ${f.tech.map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("")}
              </div>
            ` : ""}
            <pre class="spec-file-code">${escapeHtml(f.code || "")}</pre>
            <div class="spec-file-meta">${escapeHtml(f.lines || "")}</div>
          </section>
        `).join("")}
      </div>
    </div>
  `;

  const tocItems = root.querySelectorAll(".spec-toc-item");
  tocItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.dataset.slug;
      const target = root.querySelector(`#file-${slug}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        tocItems.forEach((b) => b.classList.toggle("active", b === btn));
      }
    });
  });
  if (tocItems.length) tocItems[0].classList.add("active");
}
