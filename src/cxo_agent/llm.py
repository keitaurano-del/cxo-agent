from __future__ import annotations

from anthropic import Anthropic

from .config import settings

MODEL = "claude-opus-4-7"


def client() -> Anthropic:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return Anthropic(api_key=settings.anthropic_api_key)


def complete(system: str, user: str, max_tokens: int = 1500) -> str:
    resp = client().messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
    return "".join(parts).strip()
