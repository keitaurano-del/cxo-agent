from __future__ import annotations

import feedparser

from .base import Paper

# IZA は経済 (労働) ペーパーで「働き方」関連の宝庫。SSRN 本体は API を絞っているため、
# 補完として IZA の DP RSS を使う。
IZA_DP_RSS = "https://www.iza.org/publications/dp/feed.xml"


def search(_query: str | None = None, *, max_items: int = 50) -> list[Paper]:
    feed = feedparser.parse(IZA_DP_RSS)
    out: list[Paper] = []
    for entry in feed.entries[:max_items]:
        out.append(
            Paper(
                id=f"iza:{entry.get('id', entry.get('link', ''))}",
                title=entry.get("title", ""),
                abstract=entry.get("summary", ""),
                authors=[a.strip() for a in entry.get("author", "").split(",") if a.strip()],
                year=int(entry.get("published_parsed").tm_year) if entry.get("published_parsed") else None,
                venue="IZA Discussion Paper",
                url=entry.get("link", ""),
                source="iza",
            )
        )
    return out
