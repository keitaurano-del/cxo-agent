from __future__ import annotations

import datetime as dt
import json
import time
from pathlib import Path

import httpx

from ..config import POSTED_DIR, RENDERS_DIR, ensure_dirs, settings

GRAPH = "https://graph.facebook.com/v21.0"


def _require_creds() -> None:
    if not (settings.ig_user_id and settings.ig_access_token):
        raise RuntimeError(
            "IG_USER_ID and IG_ACCESS_TOKEN must be set in .env to auto-publish. "
            "Otherwise upload the mp4 manually from `data/renders/<paper_id>/`."
        )


def publish(paper_id: str, video_url: str, caption: str) -> dict:
    """Publish a Reel to Instagram via the Meta Graph API.

    `video_url` must be an https URL Meta can fetch (Pixa share link or your CDN).
    """
    _require_creds()
    ensure_dirs()

    with httpx.Client(timeout=60) as client:
        create = client.post(
            f"{GRAPH}/{settings.ig_user_id}/media",
            data={
                "media_type": "REELS",
                "video_url": video_url,
                "caption": caption,
                "access_token": settings.ig_access_token,
            },
        )
        create.raise_for_status()
        creation_id = create.json()["id"]

        # Meta needs a few seconds to ingest the video before publish.
        for _ in range(20):
            status = client.get(
                f"{GRAPH}/{creation_id}",
                params={"fields": "status_code", "access_token": settings.ig_access_token},
            ).json()
            if status.get("status_code") == "FINISHED":
                break
            time.sleep(3)

        publish = client.post(
            f"{GRAPH}/{settings.ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": settings.ig_access_token},
        )
        publish.raise_for_status()
        published = publish.json()

    safe = paper_id.replace(":", "_").replace("/", "_")
    record = {
        "paper_id": paper_id,
        "video_url": video_url,
        "caption": caption,
        "creation_id": creation_id,
        "published": published,
        "posted_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    out = POSTED_DIR / f"{safe}.json"
    out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record


def render_dir(paper_id: str) -> Path:
    safe = paper_id.replace(":", "_").replace("/", "_")
    return RENDERS_DIR / safe
