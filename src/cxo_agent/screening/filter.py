from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass

from ..config import CANDIDATES_DIR, PROMPTS_DIR, ensure_dirs
from ..llm import complete
from ..sources.base import Paper
from ..sources.fetch import latest_dump

JSON_BLOCK = re.compile(r"\{[\s\S]*\}")


@dataclass
class Score:
    paper: Paper
    novelty: int
    surprise: int
    utility: int
    credibility: int
    total: int
    one_liner: str
    skip_reason: str | None


def _rubric() -> str:
    return (PROMPTS_DIR / "screening_rubric.md").read_text(encoding="utf-8")


def _score_one(paper: Paper) -> Score | None:
    if not paper.abstract:
        return None
    user = (
        f"# Paper\nTitle: {paper.title}\nVenue: {paper.venue}\nYear: {paper.year}\n"
        f"Authors: {', '.join(paper.authors[:5])}\n\nAbstract:\n{paper.abstract}\n\n"
        "Score this paper using the rubric. Return JSON only."
    )
    raw = complete(system=_rubric(), user=user, max_tokens=400)
    m = JSON_BLOCK.search(raw)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if d.get("skip_reason"):
        return Score(
            paper=paper,
            novelty=0,
            surprise=0,
            utility=0,
            credibility=0,
            total=0,
            one_liner="",
            skip_reason=d["skip_reason"],
        )
    total = int(d.get("total") or sum(int(d.get(k, 0)) for k in ("novelty", "surprise", "utility", "credibility")))
    return Score(
        paper=paper,
        novelty=int(d.get("novelty", 0)),
        surprise=int(d.get("surprise", 0)),
        utility=int(d.get("utility", 0)),
        credibility=int(d.get("credibility", 0)),
        total=total,
        one_liner=d.get("one_liner", ""),
        skip_reason=None,
    )


def screen(top_n: int = 10) -> list[Score]:
    ensure_dirs()
    papers = latest_dump()
    scores: list[Score] = []
    for p in papers:
        s = _score_one(p)
        if s and not s.skip_reason:
            scores.append(s)
    scores.sort(key=lambda s: s.total, reverse=True)
    top = scores[:top_n]
    _write_candidates_md(top)
    return top


def _write_candidates_md(scores: list[Score]) -> None:
    today = dt.date.today().isoformat()
    lines = [f"# Candidates {today}", ""]
    for i, s in enumerate(scores, 1):
        p = s.paper
        lines.append(f"## {i}. [{s.total}] {p.title}")
        lines.append(f"- id: `{p.id}`")
        lines.append(f"- venue: {p.venue} ({p.year})")
        lines.append(
            f"- scores: novelty={s.novelty} surprise={s.surprise} utility={s.utility} credibility={s.credibility}"
        )
        lines.append(f"- hook: {s.one_liner}")
        lines.append(f"- url: {p.url}")
        lines.append("")
    (CANDIDATES_DIR / f"{today}.md").write_text("\n".join(lines), encoding="utf-8")
