from __future__ import annotations

from pathlib import Path

from ..config import PROMPTS_DIR, SCRIPTS_DIR, ensure_dirs
from ..llm import complete
from ..sources.base import Paper
from ..sources.fetch import latest_dump


def _system_prompt() -> str:
    character = (PROMPTS_DIR / "character_meerkat_phd.md").read_text(encoding="utf-8")
    style = (PROMPTS_DIR / "style_guide.md").read_text(encoding="utf-8")
    template = (PROMPTS_DIR / "script_template.md").read_text(encoding="utf-8")
    return (
        "You are the head writer for a Japanese Instagram Reel series whose host is "
        "Dr. Meera, an anthropomorphic meerkat scientist who introduces academic "
        "research on work and productivity to a general audience.\n\n"
        "Follow the character, style, and template documents below exactly. "
        "Output the filled-in template in Japanese as Markdown only.\n\n"
        f"# CHARACTER\n{character}\n\n# STYLE\n{style}\n\n# TEMPLATE\n{template}"
    )


def _find_paper(paper_id: str) -> Paper | None:
    for p in latest_dump():
        if p.id == paper_id:
            return p
    return None


def write_script(paper_id: str) -> Path:
    ensure_dirs()
    paper = _find_paper(paper_id)
    if paper is None:
        raise ValueError(f"paper {paper_id} not found in latest dump. Run `cxo fetch` first.")

    user = (
        f"# Paper\nid: {paper.id}\ntitle: {paper.title}\nauthors: {', '.join(paper.authors)}\n"
        f"year: {paper.year}\nvenue: {paper.venue}\nurl: {paper.url}\n\n"
        f"Abstract:\n{paper.abstract}\n\n"
        "Write the full reel script in Japanese, using the template structure exactly."
    )
    md = complete(system=_system_prompt(), user=user, max_tokens=2500)

    safe = paper_id.replace(":", "_").replace("/", "_")
    out = SCRIPTS_DIR / f"{safe}.md"
    out.write_text(md, encoding="utf-8")
    return out
