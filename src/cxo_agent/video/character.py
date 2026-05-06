from __future__ import annotations

from pathlib import Path

from ..config import CHARACTER_DIR, PROMPTS_DIR, ensure_dirs

# キャラの一貫性は「アンカー文」を毎回先頭に貼ることで担保する。
# Gemini Imagen は long-context の subject anchor が効きやすいので、
# 同じ段落を 5 枚すべての先頭に置く。
# Pixar/Disney 等の IP ワードは Gemini に蹴られるので使わない。
CHARACTER_ANCHOR = (
    "Subject: Dr. Meera, a friendly anthropomorphic meerkat scientist standing "
    "upright on her hind legs, about three feet tall in proportion. Sandy-tan "
    "fur with the characteristic dark eye-mask of a meerkat. Round black "
    "curious eyes, expressive eyebrows, a small pink nose, and a gentle smile. "
    "She wears a slightly oversized crisp white lab coat and round gold-rimmed "
    "glasses. Style: high-quality stylized 3D animated character render, "
    "feature-animation polish, soft subsurface scattering on fur, warm rim "
    "lighting, shallow depth of field, photorealistic everyday backgrounds, "
    "wholesome and friendly mood. Aspect ratio 1:1."
)

REFERENCE_SCENES: dict[str, str] = {
    "01_front": (
        "Composition: full-body front view, centered, eye-level camera. "
        "Pose: standing upright, slight smile, right paw raised pointing at the "
        "viewer in a warm 'hey, listen up' gesture, left paw holding a rolled "
        "research paper. "
        "Background: a clean modern open-plan office with soft daylight from "
        "tall windows on the left."
    ),
    "02_side": (
        "Composition: three-quarter side profile, medium shot from the waist "
        "up, camera slightly below eye level. "
        "Pose: looking down thoughtfully at a small wooden clipboard held in "
        "both paws, glasses catching a soft highlight, ears slightly perked. "
        "Background: a sun-lit cafe table with a coffee cup blurred in the "
        "foreground bokeh."
    ),
    "03_surprise": (
        "Composition: medium close-up, slightly tilted dynamic camera. "
        "Pose: exaggerated surprised expression — eyes wide, mouth in a small "
        "open 'o' shape, both paws raised near the cheeks, fur on the head a "
        "touch fluffed. "
        "Background: a bright morning bedroom with rumpled bedding visible in "
        "soft focus."
    ),
    "04_explain": (
        "Composition: medium shot, the character on the right of the frame. "
        "Pose: calm explanatory expression, pointing with the right paw at a "
        "small whiteboard on the left of the frame; the whiteboard shows a "
        "simple two-color bar chart with no readable text. "
        "Background: a modest classroom or seminar-room wall with warm wood "
        "paneling, softly out of focus."
    ),
    "05_with_friends": (
        "Composition: wide shot, three meerkats in a friendly group, the "
        "scientist in the center foreground. "
        "Pose: Dr. Meera in the middle gesturing animatedly with one paw; two "
        "ordinary meerkat friends (no glasses, no coat, just sandy fur) sit "
        "attentively on either side, one tilting its head curiously, the other "
        "looking surprised. "
        "Background: a cozy living-room corner that subtly evokes a Kalahari "
        "savanna — warm wood floor, a potted desert plant, golden-hour sun."
    ),
}


def character_blurb() -> str:
    return (PROMPTS_DIR / "character_meerkat_phd.md").read_text(encoding="utf-8")


def reference_plan_path() -> Path:
    ensure_dirs()
    return CHARACTER_DIR / "gemini_prompts.md"


def gemini_prompt(scene_key: str) -> str:
    """Compose the full prompt for one reference scene, anchor + scene."""
    return f"{CHARACTER_ANCHOR}\n\n{REFERENCE_SCENES[scene_key]}"


def write_reference_plan() -> Path:
    """Write 5 ready-to-paste Gemini Imagen prompts to data/character/.

    Open https://gemini.google.com (Imagen 4), paste each block as a separate
    message, set aspect ratio 1:1, and save the resulting PNG into
    `data/character/<scene>.png`. The 5 images become the visual ground truth
    for every reel — keep them on hand for prompt-tuning future scenes.
    """
    out = reference_plan_path()
    lines = [
        "# Dr. Meera — Gemini Imagen reference prompts",
        "",
        "Paste each block below into Gemini (Imagen 4) as a separate prompt.",
        "Set aspect ratio to 1:1, generate 4 candidates, pick the best, save it",
        "as `data/character/<filename>.png`. Re-roll any that drift from the",
        "anchor (especially: dark eye-mask, gold round glasses, lab coat).",
        "",
        "---",
        "",
    ]
    for key, scene in REFERENCE_SCENES.items():
        lines += [
            f"## {key}.png",
            "",
            "```",
            f"{CHARACTER_ANCHOR}",
            "",
            f"{scene}",
            "```",
            "",
            "_Save as_: `data/character/" + key + ".png`",
            "",
            "---",
            "",
        ]
    out.write_text("\n".join(lines), encoding="utf-8")
    return out
