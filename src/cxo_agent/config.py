from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
PROMPTS_DIR = REPO_ROOT / "prompts"

PAPERS_DIR = DATA_DIR / "papers"
CANDIDATES_DIR = DATA_DIR / "candidates"
SCRIPTS_DIR = DATA_DIR / "scripts"
APPROVED_DIR = DATA_DIR / "approved"
RENDERS_DIR = DATA_DIR / "renders"
POSTED_DIR = DATA_DIR / "posted"
CHARACTER_DIR = DATA_DIR / "character"


def ensure_dirs() -> None:
    for d in (
        PAPERS_DIR,
        CANDIDATES_DIR,
        SCRIPTS_DIR,
        APPROVED_DIR,
        RENDERS_DIR,
        POSTED_DIR,
        CHARACTER_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)


# 「働き方・生産性」を捕捉するためのクエリ群。各ソースで AND/OR の解釈が違うので語のリストで持つ。
SEARCH_QUERIES: list[str] = [
    "remote work productivity",
    "hybrid work performance",
    "meeting load productivity",
    "deep work focus knowledge worker",
    "sleep work performance",
    "burnout knowledge worker",
    "four day work week",
    "commute wellbeing productivity",
    "flexible work arrangements",
    "manager span of control",
]


@dataclass
class Settings:
    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", ""))
    openalex_mailto: str = field(default_factory=lambda: os.getenv("OPENALEX_MAILTO", ""))
    video_model: str = field(default_factory=lambda: os.getenv("VIDEO_MODEL", "sora-2-pro"))
    video_duration_seconds: int = field(
        default_factory=lambda: int(os.getenv("VIDEO_DURATION_SECONDS", "15"))
    )
    default_language: str = field(default_factory=lambda: os.getenv("DEFAULT_LANGUAGE", "ja"))
    ig_user_id: str = field(default_factory=lambda: os.getenv("IG_USER_ID", ""))
    ig_access_token: str = field(default_factory=lambda: os.getenv("IG_ACCESS_TOKEN", ""))


settings = Settings()
