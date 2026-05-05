from __future__ import annotations

import datetime as dt
import json

from ..config import PAPERS_DIR, SEARCH_QUERIES, ensure_dirs
from . import nber, openalex, semantic_scholar, ssrn
from .base import Paper


def fetch_all(since_days: int = 14) -> list[Paper]:
    ensure_dirs()
    bucket: dict[str, Paper] = {}

    for p in openalex.search_many(SEARCH_QUERIES, since_days=since_days):
        bucket.setdefault(p.id, p)
    for p in semantic_scholar.search_many(SEARCH_QUERIES, since_days=since_days):
        bucket.setdefault(p.id, p)
    for p in nber.search():
        bucket.setdefault(p.id, p)
    for p in ssrn.search():
        bucket.setdefault(p.id, p)

    papers = list(bucket.values())
    out_path = PAPERS_DIR / f"{dt.date.today().isoformat()}.json"
    out_path.write_text(
        json.dumps([p.model_dump() for p in papers], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return papers


def latest_dump() -> list[Paper]:
    files = sorted(PAPERS_DIR.glob("*.json"))
    if not files:
        return []
    raw = json.loads(files[-1].read_text(encoding="utf-8"))
    return [Paper(**p) for p in raw]
