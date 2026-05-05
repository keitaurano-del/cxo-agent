from __future__ import annotations

from pydantic import BaseModel, Field


class Paper(BaseModel):
    """Normalized paper record across sources."""

    id: str = Field(description="Source-prefixed unique id, e.g. openalex:W123 or nber:w12345")
    title: str
    abstract: str = ""
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    venue: str = ""
    url: str = ""
    doi: str | None = None
    citations: int | None = None
    source: str = ""
