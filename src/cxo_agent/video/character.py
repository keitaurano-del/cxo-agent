from __future__ import annotations

from pathlib import Path

from ..config import CHARACTER_DIR, PROMPTS_DIR, ensure_dirs

REFERENCE_PROMPTS: dict[str, str] = {
    "front": (
        "Front view, friendly anthropomorphic meerkat scientist standing upright, "
        "wearing a slightly oversized white lab coat and round gold-rimmed glasses, "
        "sandy-tan fur with the dark eye-mask of a meerkat, gentle smile, pointing "
        "a finger at the viewer. Pixar/Disney 3D render, soft rim lighting, "
        "shallow depth of field, modern bright office background, photorealistic."
    ),
    "side": (
        "Side profile of the same anthropomorphic meerkat scientist studying a "
        "small clipboard, lab coat slightly wrinkled, glasses reflecting the room. "
        "Pixar/Disney 3D, soft rim lighting, shallow depth of field, "
        "warm natural light from a window."
    ),
    "surprise": (
        "Same character with an exaggerated surprised expression, eyes wide, mouth "
        "small open o-shape, paws raised. Pixar/Disney 3D, vibrant lighting, "
        "shallow depth of field, kitchen morning background."
    ),
    "explain": (
        "Same character pointing at a small whiteboard with a simple bar chart in "
        "two colors, calm explanatory expression. Pixar/Disney 3D, classroom-like "
        "background, soft rim light."
    ),
    "with_friends": (
        "The scientist meerkat in the center with two ordinary meerkat friends "
        "(no glasses, no coat) sitting beside, attentive and curious. Pixar/Disney "
        "3D, savanna-meets-modern-living-room background, soft golden hour light."
    ),
}


def character_blurb() -> str:
    return (PROMPTS_DIR / "character_meerkat_phd.md").read_text(encoding="utf-8")


def reference_plan_path() -> Path:
    ensure_dirs()
    return CHARACTER_DIR / "reference_plan.md"


def write_reference_plan() -> Path:
    """Materialize the prompts an agent should feed to Pixa generate_media (image).

    This file is consumed by a human or by Claude Code, which then calls Pixa MCP
    tools to actually generate the 5 reference images.
    """
    out = reference_plan_path()
    lines = [
        "# Character reference image plan",
        "",
        "Run each prompt through Pixa `generate_media` (type=image, model=gemini-3-pro-image, "
        "aspect=1:1, num_outputs=1). Save the resulting asset_ids back into this file.",
        "",
    ]
    for name, prompt in REFERENCE_PROMPTS.items():
        lines += [f"## {name}", "", "```", prompt, "```", "", "asset_id: <fill in>", ""]
    out.write_text("\n".join(lines), encoding="utf-8")
    return out
