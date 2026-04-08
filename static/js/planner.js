import { AGENTS, escapeHtml } from "./api.js";

const TARGETS = [
  { id: "planner", name: "Planner", role: "指示を sprint contract に落とし込む（会議スキップ）" },
  ...AGENTS.map((a) => ({ id: a.id, name: `${a.name}（${a.role}）`, role: `${a.role} として単独で回答` })),
];

export function renderPlannerPanel(root) {
  root.innerHTML = `
    <div class="card pl-form">
      <div class="stack">
        <div>
          <div class="label">担当エージェント</div>
          <select id="pl-target" class="select" style="max-width:420px;">
            ${TARGETS.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
          </select>
          <div class="pl-hint" id="pl-hint" style="margin-top:var(--s-2);">${escapeHtml(TARGETS[0].role)}</div>
        </div>
        <div>
          <div class="label">指示</div>
          <textarea id="pl-instruction" class="textarea" rows="5" placeholder="例: Logic に連続学習日数を表示する画面を追加したい。Home からの導線も用意して。"></textarea>
        </div>
        <div class="row-between">
          <span class="faint" style="font-size:12px;">結果は履歴に保存され、各エージェントの knowledge 学習にも反映されます</span>
          <button id="pl-submit" class="btn btn-primary">実行</button>
        </div>
      </div>
    </div>

    <div id="pl-result"></div>

    <div class="pl-history-title">実行履歴</div>
    <div id="pl-history"></div>
  `;

  const target = root.querySelector("#pl-target");
  const hint = root.querySelector("#pl-hint");
  target.addEventListener("change", () => {
    const t = TARGETS.find((x) => x.id === target.value);
    hint.textContent = t ? t.role : "";
  });

  const submit = root.querySelector("#pl-submit");
  const instr = root.querySelector("#pl-instruction");
  const resultHost = root.querySelector("#pl-result");

  submit.addEventListener("click", async () => {
    const text = instr.value.trim();
    if (!text) return;
    submit.disabled = true;
    resultHost.innerHTML = `<div class="card empty">実行中…（最大 30 秒）</div>`;
    try {
      const r = await fetch("/api/direct-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text, agent_id: target.value }),
      });
      const data = await r.json();
      if (data.error) {
        resultHost.innerHTML = `<div class="card empty">エラー: ${escapeHtml(data.error)}</div>`;
      } else {
        resultHost.innerHTML = renderTaskCard(data);
        bindActions(resultHost, [data]);
        instr.value = "";
        loadHistory(root);
      }
    } catch (e) {
      resultHost.innerHTML = `<div class="card empty">通信エラー: ${escapeHtml(e.message)}</div>`;
    } finally {
      submit.disabled = false;
    }
  });

  loadHistory(root);
}

function renderTaskCard(t) {
  return `
    <article class="pl-card">
      <div class="pl-card-head">
        <span class="badge badge-accent">${escapeHtml(t.display || t.agent_id)}</span>
        <span class="faint" style="font-size:11px;">${escapeHtml(t.created_at || "")}</span>
      </div>
      <div class="pl-instruction">${escapeHtml(t.instruction || "")}</div>
      <pre class="pl-result">${escapeHtml(t.result || "")}</pre>
      <div class="row" style="justify-content:flex-end;margin-top:var(--s-3);">
        <button class="btn btn-sm" data-copy="${t.id}">結果をコピー</button>
        <button class="btn btn-danger btn-sm" data-del="${t.id}">削除</button>
      </div>
    </article>
  `;
}

function bindActions(host, list) {
  host.querySelectorAll("button[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.copy;
      const t = list.find((x) => x.id === id);
      if (t) { try { navigator.clipboard.writeText(t.result || ""); } catch {} }
    });
  });
  host.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("この履歴を削除しますか？")) return;
      await fetch(`/api/planner-tasks/${btn.dataset.del}`, { method: "DELETE" });
      const root = host.closest(".panel");
      if (root) loadHistory(root);
    });
  });
}

async function loadHistory(root) {
  const host = root.querySelector("#pl-history");
  try {
    const r = await fetch("/api/planner-tasks");
    const list = await r.json();
    if (!list.length) {
      host.innerHTML = `<div class="card empty">履歴なし</div>`;
      return;
    }
    const sorted = list.slice().reverse();
    host.innerHTML = `<div class="pl-history">${sorted.map(renderTaskCard).join("")}</div>`;
    bindActions(host, list);
  } catch (e) {
    host.innerHTML = `<div class="card empty">読込失敗: ${escapeHtml(e.message)}</div>`;
  }
}
