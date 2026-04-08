export const AGENTS = [
  { id: "cso", name: "のび太", role: "Chief Strategy Officer" },
  { id: "cfo", name: "スネ夫", role: "Chief Financial Officer" },
  { id: "cmo", name: "出木杉", role: "Chief Marketing Officer" },
  { id: "cto", name: "ドラえもん", role: "Chief Technology Officer" },
  { id: "cpo", name: "ドラミ", role: "Chief Product Officer" },
];

export async function fetchKnowledge(agent) {
  const r = await fetch(`/api/knowledge/${agent}`);
  if (!r.ok) throw new Error(`knowledge ${agent} failed`);
  return r.json();
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
