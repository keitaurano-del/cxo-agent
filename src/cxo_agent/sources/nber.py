from __future__ import annotations

import re

import feedparser

from .base import Paper

NBER_NEW_RSS = "https://www.nber.org/rss/new.xml"


def search(_query: str | None = None, *, max_items: int = 50) -> list[Paper]:
    feed = feedparser.parse(NBER_NEW_RSS)
    out: list[Paper] = []
    for entry in feed.entries[:max_items]:
        wp = re.search(r"w(\d+)", entry.get("link", ""))
        wp_id = wp.group(0) if wp else entry.get("id", "")
        out.append(
            Paper(
                id=f"nber:{wp_id}",
                title=entry.get("title", ""),
                abstract=entry.get("summary", ""),
                authors=[a.strip() for a in entry.get("author", "").split(",") if a.strip()],
                year=int(entry.get("published_parsed").tm_year) if entry.get("published_parsed") else None,
                venue="NBER Working Paper",
                url=entry.get("link", ""),
                source="nber",
            )
        )
    return out
