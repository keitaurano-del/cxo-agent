from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from ..config import APPROVED_DIR, PROMPTS_DIR, RENDERS_DIR, ensure_dirs

SCENE_HEADER = re.compile(r"^##\s+Scene\s+(\d+)", re.MULTILINE)
FIELD = re.compile(r"^-\s*([A-Z_]+):\s*(.+)$", re.MULTILINE)


@dataclass
class Scene:
    index: int
    visual: str
    voice_ja: str
    on_screen_text: str


@dataclass
class ScenePlan:
    paper_id: str
    scenes: list[Scene]


def _character_visual_prefix() -> str:
    md = (PROMPTS_DIR / "character_meerkat_phd.md").read_text(encoding="utf-8")
    m = re.search(r"```\s*([\s\S]+?)```", md)
    return (m.group(1).strip() if m else "").replace("\n", " ")


def parse_script(paper_id: str) -> ScenePlan:
    safe = paper_id.replace(":", "_").replace("/", "_")
    src = APPROVED_DIR / f"{safe}.md"
    if not src.exists():
        # 互換: 承認フォルダに同名ファイルを置く運用以外に、空マーカーでも許容
        marker = APPROVED_DIR / f"{safe}.txt"
        if not marker.exists():
            raise FileNotFoundError(
                f"approved script not found at {src}. "
                f"Move the reviewed `data/scripts/{safe}.md` into `data/approved/`."
            )
        src = APPROVED_DIR.parent / "scripts" / f"{safe}.md"

    text = src.read_text(encoding="utf-8")
    chunks = re.split(SCENE_HEADER, text)
    scenes: list[Scene] = []
    # chunks: [head, idx1, body1, idx2, body2, ...]
    for i in range(1, len(chunks), 2):
        idx = int(chunks[i])
        body = chunks[i + 1]
        fields = {k: v.strip() for k, v in FIELD.findall(body)}
        scenes.append(
            Scene(
                index=idx,
                visual=fields.get("VISUAL", ""),
                voice_ja=fields.get("VOICE_JA", ""),
                on_screen_text=fields.get("ON_SCREEN_TEXT", ""),
            )
        )
    return ScenePlan(paper_id=paper_id, scenes=scenes)


def build_video_prompts(plan: ScenePlan) -> list[dict]:
    """Build Pixa generate_media payloads for each scene, ready for an agent to call."""
    char = _character_visual_prefix()
    out: list[dict] = []
    for s in plan.scenes:
        prompt = (
            f"{char} {s.visual} "
            f"On-screen text in Japanese reads: '{s.on_screen_text}'. "
            "9:16 vertical, Pixar/Disney 3D, soft rim lighting, shallow depth of field."
        )
        out.append(
            {
                "scene_index": s.index,
                "voice_ja": s.voice_ja,
                "on_screen_text": s.on_screen_text,
                "pixa_payload": {
                    "type": "video",
                    "model": "sora-2-pro",
                    "aspect_ratio": "9:16",
                    "duration_seconds": 3,
                    "prompt": prompt,
                },
            }
        )
    return out


def write_render_plan(paper_id: str) -> Path:
    ensure_dirs()
    plan = parse_script(paper_id)
    payloads = build_video_prompts(plan)
    safe = paper_id.replace(":", "_").replace("/", "_")
    out_dir = RENDERS_DIR / safe
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "render_plan.json"
    out.write_text(json.dumps(payloads, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
