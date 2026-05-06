from __future__ import annotations

import datetime as dt
from typing import Iterable

import httpx

from ..config import settings
from .base import Paper

OPENALEX_URL = "https://api.openalex.org/works"


def _reconstruct_abstract(inverted: dict[str, list[int]] | None) -> str:
    if not inverted:
        return ""
    positions: list[tuple[int, str]] = []
    for word, idxs in inverted.items():
        for i in idxs:
            positions.append((i, word))
    positions.sort()
    return " ".join(word for _, word in positions)


def search(query: str, since_days: int = 30, per_page: int = 25) -> list[Paper]:
    since = (dt.date.today() - dt.timedelta(days=since_days)).isoformat()
    params: dict[str, str | int] = {
        "search": query,
        "filter": f"from_publication_date:{since},type:article|book-chapter|posted-content",
        "per-page": per_page,
        "sort": "relevance_score:desc",
    }
    if settings.openalex_mailto:
        params["mailto"] = settings.openalex_mailto

    # OpenAlex returns 403 to bare clients; their docs ask for a UA + mailto.
    headers = {
        "User-Agent": f"cxo-agent/0.1 (mailto:{settings.openalex_mailto or 'unknown@example.com'})",
        "Accept": "application/json",
    }
    with httpx.Client(timeout=30, headers=headers) as client:
        r = client.get(OPENALEX_URL, params=params)
        r.raise_for_status()
        data = r.json()

    out: list[Paper] = []
    for w in data.get("results", []):
        out.append(
            Paper(
                id=f"openalex:{w['id'].rsplit('/', 1)[-1]}",
                title=w.get("title") or "",
                abstract=_reconstruct_abstract(w.get("abstract_inverted_index")),
                authors=[a["author"]["display_name"] for a in w.get("authorships", []) if a.get("author")],
                year=w.get("publication_year"),
                venue=(w.get("primary_location") or {}).get("source", {}).get("display_name", "") or "",
                url=w.get("doi") or w.get("id") or "",
                doi=w.get("doi"),
                citations=w.get("cited_by_count"),
                source="openalex",
            )
        )
    return out


def search_many(queries: Iterable[str], since_days: int = 30) -> list[Paper]:
    seen: dict[str, Paper] = {}
    for q in queries:
        for p in search(q, since_days=since_days):
            seen.setdefault(p.id, p)
    return list(seen.values())
