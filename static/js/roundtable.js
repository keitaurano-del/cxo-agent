import { AGENTS, escapeHtml } from "./api.js";

export const session = {
  topic: "",
  phase1: new Map(),
  phase2: new Map(),
  done: false,
  review: null,
  reviewLoading: false,
};

const doneSet = new Set();
const currentPhase = { value: 1 };
let onUpdate = () => {};

export function getSession() { return session; }

export function renderRoundtablePanel(root) {
  root.innerHTML = `
    <div class="card rt-composer">
      <div class="stack">
        <div>
          <div class="label">議題</div>
          <textarea id="rt-topic" class="textarea" placeholder="例: Logic に連続学習日数機能を追加すべきか。優先度・実装方針・リスクを議論してください。"></textarea>
        </div>
        <div class="row-between">
          <span class="faint" style="font-size:12px;">CXO 5 名が Phase 1（独立意見）→ Phase 2（相互反論）の順に議論</span>
          <button id="rt-start" class="btn btn-primary">議論を開始</button>
        </div>
      </div>
    </div>
    <div id="rt-timeline"></div>
  `;
  const startBtn = root.querySelector("#rt-start");
  const topicEl = root.querySelector("#rt-topic");
  startBtn.addEventListener("click", () => {
    const topic = topicEl.value.trim();
    if (!topic) return;
    session.topic = topic;
    session.phase1.clear();
    session.phase2.clear();
    session.done = false;
    session.review = null;
    session.reviewLoading = false;
    doneSet.clear();
    currentPhase.value = 1;
    startBtn.disabled = true;
    runRoundtable(topic).catch((e) => console.error(e)).finally(() => { startBtn.disabled = false; });
  });
  const timelineHost = root.querySelector("#rt-timeline");
  onUpdate = () => renderTimeline(timelineHost);
  renderTimeline(timelineHost);
}

function extractSummary(text) {
  if (!text) return "";
  const m = text.match(/【\s*主張\s*】\s*([^\n【]+)/);
  if (m) return m[1].trim().slice(0, 200);
  const stripped = text.replace(/【[^】]+】/g, "").replace(/\*\*/g, "").trim();
  return stripped.slice(0, 140) + (stripped.length > 140 ? "…" : "");
}

function renderTimeline(host) {
  if (!session.topic) {
    host.innerHTML = `<div class="card empty">議題を入力して「議論を開始」を押してください</div>`;
    return;
  }

  const doneCount = doneSet.size;
  const total = AGENTS.length * 2;
  const progressPct = Math.round((doneCount / total) * 100);

  const renderCards = (store, phaseNum) => `
    <div class="rt-grid">
      ${AGENTS.map((a) => {
        const text = store.get(a.id) || "";
        const isDone = doneSet.has(`${a.id}-${phaseNum}`);
        const status = isDone ? "done" : (text ? "streaming" : "waiting");
        const statusLabel = status === "done" ? "完了" : status === "streaming" ? "発言中" : "待機中";
        const summary = extractSummary(text);
        return `
          <article class="rt-card">
            <div class="rt-card-head">
              <div>
                <div class="rt-card-role">${escapeHtml(a.role)}</div>
                <div class="rt-card-name">${escapeHtml(a.name)}</div>
              </div>
              <span class="rt-card-status ${status}">${statusLabel}</span>
            </div>
            <div class="rt-card-body ${status === "streaming" ? "streaming" : ""}">${escapeHtml(summary || "　")}</div>
          </article>
        `;
      }).join("")}
    </div>
  `;

  const reviewSection = session.done ? `
    <section class="rt-phase">
      <div class="rt-phase-head">
        <div class="rt-phase-title">外部コンサル評価</div>
        <div class="rt-phase-sub">各 CXO の発言を外部コンサルタントが 5 項目で評価（忖度なし）</div>
      </div>
      <div id="rt-review-host">
        ${session.review
          ? renderReview(session.review)
          : session.reviewLoading
            ? `<div class="card empty">評価中…</div>`
            : `<button id="rt-review-btn" class="btn btn-primary">外部コンサルにレビュー依頼</button>`}
      </div>
    </section>
  ` : "";

  host.innerHTML = `
    <div class="rt-progress">進行度 ${doneCount} / ${total}（${progressPct}%）</div>
    <section class="rt-phase">
      <div class="rt-phase-head">
        <div class="rt-phase-title">Phase 1　初期意見</div>
        <div class="rt-phase-sub">各 CXO は他者の発言を見ずに独立した立場で意見を述べます（要旨表示）</div>
      </div>
      ${renderCards(session.phase1, 1)}
    </section>
    ${session.phase1.size > 0 ? `
    <section class="rt-phase">
      <div class="rt-phase-head">
        <div class="rt-phase-title">Phase 2　相互反論</div>
        <div class="rt-phase-sub">他の CXO を名指しした反論の要旨</div>
      </div>
      ${renderCards(session.phase2, 2)}
    </section>` : ""}
    ${reviewSection}
  `;

  const btn = host.querySelector("#rt-review-btn");
  if (btn) btn.addEventListener("click", requestReview);
}

function renderReview(review) {
  if (!review || !review.reviews) return `<div class="card empty">評価取得に失敗しました</div>`;
  const byId = Object.fromEntries(review.reviews.map((r) => [r.agent_id, r]));
  return `
    <div class="rt-grid">
      ${AGENTS.map((a) => {
        const r = byId[a.id];
        if (!r) return "";
        const s = r.scores || {};
        return `
          <article class="rt-card">
            <div class="rt-card-head">
              <div>
                <div class="rt-card-role">${escapeHtml(a.role)}</div>
                <div class="rt-card-name">${escapeHtml(a.name)}</div>
              </div>
              <span class="badge badge-accent">${r.total || 0} / 25</span>
            </div>
            <div class="rt-score-grid">
              <div>鋭さ<b>${s.sharpness ?? "-"}</b></div>
              <div>独自性<b>${s.originality ?? "-"}</b></div>
              <div>根拠<b>${s.evidence ?? "-"}</b></div>
              <div>リスク<b>${s.risk ?? "-"}</b></div>
              <div>実行<b>${s.feasibility ?? "-"}</b></div>
            </div>
            <div class="rt-card-body"><b>◎</b> ${escapeHtml(r.strengths || "")}<br><b>△</b> ${escapeHtml(r.weaknesses || "")}<br><b>→</b> ${escapeHtml(r.advice || "")}</div>
          </article>
        `;
      }).join("")}
    </div>
    <div class="rt-review-overall">${escapeHtml(review.overall || "")}</div>
  `;
}

async function requestReview() {
  session.reviewLoading = true;
  onUpdate();
  const payload = { topic: session.topic, discussion: {} };
  for (const a of AGENTS) {
    const t = session.phase2.get(a.id) || session.phase1.get(a.id);
    if (t) payload.discussion[a.id] = t;
  }
  try {
    const r = await fetch("/api/consultant-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    session.review = data.error ? { reviews: [], overall: "エラー: " + data.error } : data;
  } catch (e) {
    session.review = { reviews: [], overall: "通信エラー: " + e.message };
  } finally {
    session.reviewLoading = false;
    onUpdate();
  }
}

async function runRoundtable(topic) {
  const url = `/roundtable?topic=${encodeURIComponent(topic)}&order=cso,cfo,cmo,cto,cpo`;
  const res = await fetch(url);
  if (!res.body) throw new Error("no SSE body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try { handleEvent(JSON.parse(line.slice(6))); } catch {}
    }
  }
  session.done = true;
  onUpdate();
}

function handleEvent(ev) {
  if (ev.type === "phase" && (ev.phase === 1 || ev.phase === 2)) {
    currentPhase.value = ev.phase;
  } else if (ev.type === "text" && ev.agent_id && ev.content) {
    const target = currentPhase.value === 2 ? session.phase2 : session.phase1;
    target.set(ev.agent_id, (target.get(ev.agent_id) || "") + ev.content);
  } else if (ev.type === "agent_done" && ev.agent_id && ev.phase) {
    doneSet.add(`${ev.agent_id}-${ev.phase}`);
  } else if (ev.type === "done") {
    session.done = true;
  }
  onUpdate();
}
