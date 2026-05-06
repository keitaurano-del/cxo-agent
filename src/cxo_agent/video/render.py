from __future__ import annotations

from pathlib import Path

from .scene import write_render_plan


def render(paper_id: str) -> Path:
    """Materialize a Pixa render plan for an approved script.

    Actual video generation is performed by a Pixa MCP-aware agent that reads
    `render_plan.json` and calls `generate_media` for each scene. We deliberately
    keep that step outside Python so the human-in-the-loop can review and
    re-prompt without rerunning the whole pipeline.
    """
    return write_render_plan(paper_id)
