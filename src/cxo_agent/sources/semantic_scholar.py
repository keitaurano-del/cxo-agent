from __future__ import annotations

import datetime as dt
from typing import Iterable

import httpx

from .base import Paper

S2_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
FIELDS = "title,abstract,authors,year,venue,externalIds,citationCount,url"


def search(query: str, since_days: int = 30, limit: int = 25) -> list[Paper]:
    year_floor = dt.date.today().year - (1 if since_days <= 365 else 0)
    params: dict[str, str | int] = {
        "query": query,
        "limit": limit,
        "fields": FIELDS,
        "year": f"{year_floor}-",
    }
    with httpx.Client(timeout=30) as client:
        r = client.get(S2_URL, params=params)
        if r.status_code == 429:
            return []
        r.raise_for_status()
        data = r.json()

    out: list[Paper] = []
    for w in data.get("data", []):
        ext = w.get("externalIds") or {}
        out.append(
            Paper(
                id=f"s2:{w.get('paperId')}",
                title=w.get("title") or "",
                abstract=w.get("abstract") or "",
                authors=[a.get("name", "") for a in w.get("authors", [])],
                year=w.get("year"),
                venue=w.get("venue") or "",
                url=w.get("url") or "",
                doi=ext.get("DOI"),
                citations=w.get("citationCount"),
                source="semantic_scholar",
            )
        )
    return out


def search_many(queries: Iterable[str], since_days: int = 30) -> list[Paper]:
    seen: dict[str, Paper] = {}
    for q in queries:
        for p in search(q, since_days=since_days):
            seen.setdefault(p.id, p)
    return list(seen.values())
