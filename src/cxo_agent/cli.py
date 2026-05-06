from __future__ import annotations

import typer
from rich.console import Console
from rich.table import Table

from .config import ensure_dirs
from .publish import instagram
from .screening.filter import screen
from .scriptwriter.writer import write_script
from .sources.fetch import fetch_all
from .video.character import write_reference_plan
from .video.render import render

app = typer.Typer(add_completion=False, help="cxo-agent: meerkat-PhD reel pipeline")
console = Console()


@app.command()
def fetch(since_days: int = typer.Option(14, help="Lookback window in days")) -> None:
    """Fetch papers from all sources into data/papers/."""
    ensure_dirs()
    papers = fetch_all(since_days=since_days)
    console.print(f"[green]Fetched {len(papers)} papers[/green]")


@app.command(name="screen")
def screen_cmd(top_n: int = 10) -> None:
    """Score and rank the latest paper dump, write data/candidates/."""
    scores = screen(top_n=top_n)
    table = Table(title="Top candidates")
    table.add_column("#")
    table.add_column("Total")
    table.add_column("Title")
    table.add_column("ID")
    for i, s in enumerate(scores, 1):
        table.add_row(str(i), str(s.total), s.paper.title[:60], s.paper.id)
    console.print(table)


@app.command(name="script")
def script_cmd(paper_id: str) -> None:
    """Generate a draft reel script for the given paper id."""
    out = write_script(paper_id)
    console.print(f"[green]Script written:[/green] {out}")
    console.print("Review and move to data/approved/ when satisfied.")


@app.command(name="render")
def render_cmd(paper_id: str) -> None:
    """Build the Pixa render plan for an approved script."""
    out = render(paper_id)
    console.print(f"[green]Render plan written:[/green] {out}")
    console.print("Feed each entry into Pixa generate_media via the agent.")


@app.command(name="character")
def character_cmd(action: str = typer.Argument(..., help="init")) -> None:
    """Manage character reference assets."""
    if action == "init":
        out = write_reference_plan()
        console.print(f"[green]Reference plan written:[/green] {out}")
    else:
        raise typer.BadParameter("only `init` is supported")


@app.command(name="publish")
def publish_cmd(paper_id: str, video_url: str, caption_path: str) -> None:
    """Publish a finished reel via Meta Graph API. Requires IG_USER_ID/TOKEN."""
    from pathlib import Path

    caption = Path(caption_path).read_text(encoding="utf-8")
    record = instagram.publish(paper_id, video_url, caption)
    console.print(f"[green]Published[/green] {record['published']}")


if __name__ == "__main__":
    app()
