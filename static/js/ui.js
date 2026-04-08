import { escapeHtml } from "./api.js";

const URL_KEY = "apollo-ui-logic-url-v2";
const SCREEN_KEY = "apollo-ui-last-screen";
const DEFAULT_URL = "https://logic-u5wn.onrender.com/";

const SCREENS = [
  { id: "/",         name: "Home" },
  { id: "/#lesson",  name: "Lesson" },
  { id: "/#fermi",   name: "Fermi" },
  { id: "/#streak",  name: "Streak" },
  { id: "/#profile", name: "Profile" },
];

let logicUrl = localStorage.getItem(URL_KEY) || DEFAULT_URL;
let currentScreen = localStorage.getItem(SCREEN_KEY) || SCREENS[0].id;
let versions = [];
let leftSelection = "live";
let rightSelection = null;
let commentMode = false;
let device = localStorage.getItem("apollo-ui-device") || "pc";

export function renderUIPanel(root) {
  root.innerHTML = `
    <div class="card ui-toolbar">
      <div class="row">
        <input type="text" id="ui-url" class="input" value="${escapeHtml(logicUrl)}" style="max-width:340px;" placeholder="https://logic-u5wn.onrender.com/" />
        <select id="ui-screen" class="select" style="max-width:180px;">
          ${SCREENS.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === currentScreen ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
        </select>
        <div class="ui-device-pill" id="ui-device-toggle">
          <button data-device="pc" class="${device === "pc" ? "on" : ""}">PC</button>
          <button data-device="sp" class="${device === "sp" ? "on" : ""}">SP</button>
        </div>
        <button id="ui-reload" class="btn btn-sm">再読込</button>
        <button id="ui-new-version" class="btn btn-primary btn-sm">修正案を作成</button>
      </div>
    </div>
    <div id="ui-version-form"></div>
    <div class="ui-compare ui-layout-${device}" id="ui-compare">
      <div class="ui-pane">
        <div class="ui-pane-head">
          <select id="ui-left" class="select"></select>
          <span class="ui-pane-badge" id="ui-left-badge">現行</span>
        </div>
        <div class="ui-pane-body" id="ui-left-body"></div>
      </div>
      <div class="ui-pane" id="ui-right-pane">
        <div class="ui-pane-head">
          <select id="ui-right" class="select"></select>
          <button id="ui-hide-right" class="btn btn-ghost btn-sm" title="閉じる">×</button>
        </div>
        <div class="ui-pane-body" id="ui-right-body"></div>
      </div>
    </div>
    <h3 class="label" style="margin-top:var(--s-6);margin-bottom:var(--s-3);">バージョン一覧</h3>
    <div id="ui-version-list"></div>
  `;

  root.querySelector("#ui-url").addEventListener("change", (e) => {
    logicUrl = e.target.value.trim() || DEFAULT_URL;
    localStorage.setItem(URL_KEY, logicUrl);
    const sidebarUrl = document.getElementById("sidebar-logic-url");
    if (sidebarUrl) sidebarUrl.textContent = logicUrl;
    renderPanes(root);
  });
  root.querySelector("#ui-screen").addEventListener("change", (e) => {
    currentScreen = e.target.value;
    localStorage.setItem(SCREEN_KEY, currentScreen);
    renderPanes(root);
  });
  root.querySelector("#ui-reload").addEventListener("click", () => renderPanes(root));
  root.querySelector("#ui-new-version").addEventListener("click", () => showVersionForm(root));
  root.querySelector("#ui-left").addEventListener("change", (e) => { leftSelection = e.target.value; renderPanes(root); });
  root.querySelector("#ui-right").addEventListener("change", (e) => { rightSelection = e.target.value; renderPanes(root); });
  root.querySelector("#ui-hide-right").addEventListener("click", () => { rightSelection = null; renderPanes(root); });

  root.querySelectorAll("#ui-device-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      device = btn.dataset.device;
      localStorage.setItem("apollo-ui-device", device);
      root.querySelectorAll("#ui-device-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.device === device));
      const cmp = root.querySelector("#ui-compare");
      cmp.classList.remove("ui-layout-pc", "ui-layout-sp");
      cmp.classList.add(`ui-layout-${device}`);
      renderPanes(root);
    });
  });

  loadVersions(root);
}

async function loadVersions(root) {
  try {
    const r = await fetch("/api/ui-versions");
    versions = await r.json();
  } catch { versions = []; }
  renderSelectors(root);
  renderPanes(root);
  renderVersionList(root);
}

function renderSelectors(root) {
  const opts = [`<option value="live">現行（live）</option>`]
    .concat(versions.map((v) => `<option value="${v.id}">${escapeHtml(v.title)}</option>`))
    .join("");
  const left = root.querySelector("#ui-left");
  const right = root.querySelector("#ui-right");
  left.innerHTML = opts;
  right.innerHTML = `<option value="">（比較ペインを選択）</option>` + opts;
  left.value = leftSelection;
  right.value = rightSelection || "";
}

function renderPanes(root) {
  const leftBody = root.querySelector("#ui-left-body");
  const rightPane = root.querySelector("#ui-right-pane");
  const rightBody = root.querySelector("#ui-right-body");
  leftBody.innerHTML = renderPaneContent(leftSelection, "left", device);
  if (rightSelection) {
    rightPane.style.display = "";
    rightBody.innerHTML = renderPaneContent(rightSelection, "right", device);
  } else {
    rightPane.style.display = "none";
  }
  root.querySelector("#ui-left-badge").textContent = leftSelection === "live" ? "現行" : "案";

  const toggleBtn = leftBody.querySelector("#ui-comment-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => { commentMode = !commentMode; renderPanes(root); });
  }
  const overlay = leftBody.querySelector(".ui-overlay.active");
  if (overlay) {
    overlay.addEventListener("click", (ev) => {
      const rect = overlay.getBoundingClientRect();
      const x = Math.round(((ev.clientX - rect.left) / rect.width) * 1000) / 10;
      const y = Math.round(((ev.clientY - rect.top) / rect.height) * 1000) / 10;
      openPinComposer(root, x, y);
    });
  }
}

function renderPaneContent(selection, side, device = "pc") {
  const isLeft = side === "left";
  const deviceCls = `ui-device-${device}`;
  if (selection === "live") {
    const src = joinUrl(logicUrl, currentScreen);
    const overlayActive = isLeft && commentMode;
    return `
      <div class="ui-iframe-wrap ${deviceCls}">
        <iframe class="ui-iframe" src="${escapeHtml(src)}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
        ${isLeft ? `
          <div class="ui-overlay ${overlayActive ? "active" : ""}" data-side="${side}"></div>
          <button class="ui-comment-toggle ${overlayActive ? "on" : ""}" id="ui-comment-btn" title="${overlayActive ? "コメントモード終了" : "コメントモード開始"}">${overlayActive ? "×" : "+"}</button>
        ` : ""}
      </div>
      <div class="ui-pane-foot">${device === "sp" ? "SP 390×844" : "PC"} · ${escapeHtml(src)}${isLeft ? (overlayActive ? " · クリックでコメント" : " · +ボタンでコメントモード") : ""}</div>
    `;
  }
  const v = versions.find((x) => x.id === selection);
  if (!v) return `<div class="empty">選択されたバージョンが見つかりません</div>`;
  const src = v.url ? v.url : joinUrl(logicUrl, v.screen || currentScreen);
  const pinMark = v.pin && v.pin.x != null ? `<div class="ui-pin-static" style="left:${v.pin.x}%;top:${v.pin.y}%"></div>` : "";
  return `
    <div class="ui-iframe-wrap ${deviceCls}">
      <iframe class="ui-iframe" src="${escapeHtml(src)}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
      ${pinMark}
    </div>
    <div class="ui-version-meta">
      <div class="ui-version-title">${escapeHtml(v.title)}${v.author ? ` <span class="ui-author">by ${escapeHtml(v.author)}</span>` : ""}</div>
      ${v.description ? `<div class="ui-version-desc">${escapeHtml(v.description)}</div>` : ""}
      ${v.comment ? `<div class="ui-version-comment">${escapeHtml(v.comment)}</div>` : ""}
      ${v.notes ? `<pre class="ui-version-notes">${escapeHtml(v.notes)}</pre>` : ""}
      <div class="ui-pane-foot">${device === "sp" ? "SP" : "PC"} · ${escapeHtml(src)} · ${escapeHtml(v.created_at || "")}</div>
    </div>
  `;
}

function joinUrl(base, path) {
  if (!path || path === "/") return base;
  if (path.startsWith("#")) return base.replace(/\/$/, "") + "/" + path;
  if (path.startsWith("/")) return base.replace(/\/$/, "") + path;
  return base.replace(/\/$/, "") + "/" + path;
}

function openPinComposer(root, x, y) {
  const overlay = root.querySelector(".ui-overlay.active");
  if (!overlay) return;
  overlay.querySelectorAll(".ui-pin-temp, .ui-pin-popup").forEach((el) => el.remove());

  const pin = document.createElement("div");
  pin.className = "ui-pin-temp";
  pin.style.left = x + "%";
  pin.style.top = y + "%";
  overlay.appendChild(pin);

  const popup = document.createElement("div");
  popup.className = "ui-pin-popup";
  popup.style.left = x + "%";
  popup.style.top = y + "%";
  popup.innerHTML = `
    <textarea class="textarea" rows="3" placeholder="修正コメント"></textarea>
    <div class="row">
      <button data-act="cancel" class="btn btn-sm">キャンセル</button>
      <button data-act="fix" class="btn btn-primary btn-sm">ドラミに依頼</button>
    </div>
    <div class="ui-pin-status"></div>
  `;
  overlay.appendChild(popup);
  const ta = popup.querySelector("textarea");
  ta.focus();

  popup.querySelector("[data-act=cancel]").addEventListener("click", (e) => {
    e.stopPropagation();
    pin.remove(); popup.remove();
  });
  popup.querySelector("[data-act=fix]").addEventListener("click", async (e) => {
    e.stopPropagation();
    const comment = ta.value.trim();
    if (!comment) { ta.focus(); return; }
    const baseVersionId = leftSelection === "live" ? null : leftSelection;
    const status = popup.querySelector(".ui-pin-status");
    status.textContent = "ドラミが修正中…（最大 20 秒）";
    popup.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const r = await fetch("/api/ui-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment, screen: currentScreen, url: logicUrl, x, y, base_version_id: baseVersionId }),
      });
      const data = await r.json();
      if (data.error) {
        status.textContent = "エラー: " + data.error;
        popup.querySelectorAll("button").forEach((b) => (b.disabled = false));
        return;
      }
      pin.remove(); popup.remove();
      rightSelection = data.id;
      await loadVersions(root);
    } catch (err) {
      status.textContent = "通信エラー: " + err.message;
      popup.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  });
  popup.addEventListener("click", (e) => e.stopPropagation());
}

function showVersionForm(root, editing = null) {
  const host = root.querySelector("#ui-version-form");
  host.innerHTML = `
    <div class="card ui-version-form">
      <div class="label">${editing ? "バージョンを編集" : "新しい修正案を作成"}</div>
      <div class="stack">
        <input type="text" id="uv-title" class="input" placeholder="タイトル（例: Streak カードを Home 上部に移動）" value="${escapeHtml(editing?.title || "")}" />
        <input type="text" id="uv-desc" class="input" placeholder="1 行で概要（任意）" value="${escapeHtml(editing?.description || "")}" />
        <input type="text" id="uv-screen" class="input" placeholder="対象スクリーン（例: /, /#lesson）" value="${escapeHtml(editing?.screen || currentScreen)}" />
        <input type="text" id="uv-url" class="input" placeholder="別バージョン用 URL（空なら現行と同じ URL）" value="${escapeHtml(editing?.url || "")}" />
        <textarea id="uv-notes" class="textarea" rows="4" placeholder="変更内容のメモ・意図・根拠">${escapeHtml(editing?.notes || "")}</textarea>
        <div class="row-between">
          <span class="faint" style="font-size:11px;">別 URL を指定すると、その URL が案として表示されます</span>
          <div class="row">
            <button id="uv-cancel" class="btn btn-sm">キャンセル</button>
            <button id="uv-save" class="btn btn-primary btn-sm">${editing ? "更新" : "保存"}</button>
          </div>
        </div>
      </div>
    </div>
  `;
  host.querySelector("#uv-cancel").addEventListener("click", () => { host.innerHTML = ""; });
  host.querySelector("#uv-save").addEventListener("click", async () => {
    const payload = {
      title: host.querySelector("#uv-title").value.trim(),
      description: host.querySelector("#uv-desc").value.trim(),
      screen: host.querySelector("#uv-screen").value.trim(),
      url: host.querySelector("#uv-url").value.trim(),
      notes: host.querySelector("#uv-notes").value.trim(),
    };
    if (!payload.title) { alert("タイトルを入力してください"); return; }
    try {
      if (editing) {
        await fetch(`/api/ui-versions/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const r = await fetch("/api/ui-versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const v = await r.json();
        if (v && v.id) rightSelection = v.id;
      }
      host.innerHTML = "";
      await loadVersions(root);
    } catch (e) {
      alert("保存失敗: " + e.message);
    }
  });
}

function renderVersionList(root) {
  const host = root.querySelector("#ui-version-list");
  if (!versions.length) {
    host.innerHTML = `<div class="card empty">まだバージョンはありません</div>`;
    return;
  }
  host.innerHTML = `
    <div class="ui-version-list">
      ${versions.slice().reverse().map((v) => `
        <article class="ui-version-card">
          <div class="ui-version-title">${escapeHtml(v.title)}${v.author ? ` <span class="ui-author">by ${escapeHtml(v.author)}</span>` : ""}</div>
          ${v.description ? `<div class="ui-version-desc">${escapeHtml(v.description)}</div>` : ""}
          <div class="ui-pane-foot">${escapeHtml(v.screen || "—")} · ${escapeHtml(v.created_at || "")}</div>
          <div class="row-between" style="margin-top:var(--s-3);">
            <div class="row">
              <button data-view-left="${v.id}" class="btn btn-sm">左</button>
              <button data-view-right="${v.id}" class="btn btn-sm">右</button>
            </div>
            <div class="row">
              <button data-edit="${v.id}" class="btn btn-ghost btn-sm">編集</button>
              <button data-del="${v.id}" class="btn btn-danger btn-sm">削除</button>
            </div>
          </div>
        </article>
      `).join("")}
    </div>
  `;
  host.querySelectorAll("button[data-view-left]").forEach((b) => b.addEventListener("click", () => { leftSelection = b.dataset.viewLeft; renderSelectors(root); renderPanes(root); }));
  host.querySelectorAll("button[data-view-right]").forEach((b) => b.addEventListener("click", () => { rightSelection = b.dataset.viewRight; renderSelectors(root); renderPanes(root); }));
  host.querySelectorAll("button[data-edit]").forEach((b) => b.addEventListener("click", () => {
    const v = versions.find((x) => x.id === b.dataset.edit);
    if (v) showVersionForm(root, v);
  }));
  host.querySelectorAll("button[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("このバージョンを削除しますか？")) return;
    await fetch(`/api/ui-versions/${b.dataset.del}`, { method: "DELETE" });
    if (leftSelection === b.dataset.del) leftSelection = "live";
    if (rightSelection === b.dataset.del) rightSelection = null;
    await loadVersions(root);
  }));
}
