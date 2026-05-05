# cxo-agent

Semi-automated pipeline for the **博士ミーアキャット (Dr. Meera)** Instagram Reel
account. The host is an anthropomorphic meerkat scientist in a white lab coat
and round glasses who introduces fresh academic research on **work and
productivity** — remote work, focus, sleep, meetings, burnout — to a Japanese
audience, twice a week.

The pipeline is intentionally **semi-automatic**: a human approves every
script before any video credits are spent.

## Pipeline

```
fetch papers → LLM screen → human picks → LLM script → human approves
                                                          ↓
                                IG post ← human/auto ← Sora 2 Pro render
```

| Step | Command | Output |
|---|---|---|
| 1. Pull candidates | `cxo fetch --since-days 14` | `data/papers/<date>.json` |
| 2. Score & rank | `cxo screen --top-n 10` | `data/candidates/<date>.md` |
| 3. Draft script | `cxo script <paper_id>` | `data/scripts/<id>.md` |
| 4. Approve | move file to `data/approved/<id>.md` | — |
| 5. Render plan | `cxo render <paper_id>` | `data/renders/<id>/render_plan.json` |
| 6. Generate video | feed `render_plan.json` into Pixa `generate_media` (sora-2-pro, 9:16) | mp4 + asset_ids |
| 7. Publish | manually upload, **or** `cxo publish <id> <url> <caption.txt>` | `data/posted/<id>.json` |

Step 6 is intentionally not wrapped in Python: the Pixa MCP tools are called
from the agent session, where you can iterate on prompts cheaply.

## Setup

```bash
uv venv && source .venv/bin/activate
uv pip install -e .
cp .env.example .env  # fill in ANTHROPIC_API_KEY at minimum
```

Optional for auto-publish: register an Instagram Business account, link it to
a Facebook Page, and put `IG_USER_ID` + a long-lived `IG_ACCESS_TOKEN` in
`.env`.

## Character

The host is fully specified in `prompts/character_meerkat_phd.md`. That file
is the single source of truth and is included verbatim in every script and
render prompt to keep the look consistent.

Initial reference images are produced once with:

```bash
cxo character init   # writes data/character/reference_plan.md
```

then the agent runs each prompt through Pixa `generate_media` (image) and
saves the resulting asset_ids back into the same file.

## Cost

Sora 2 Pro is 100 credits/sec. Each 15-second reel ≈ 1,500 credits.
Twice-weekly cadence ≈ 12,000 credits/month, plus a 20 % buffer for
re-prompting after script approval.

## Layout

```
prompts/                        single source of truth for character/style/rubric
src/cxo_agent/
  sources/                      OpenAlex, Semantic Scholar, NBER, IZA
  screening/filter.py           LLM scoring against prompts/screening_rubric.md
  scriptwriter/writer.py        LLM script gen using prompts/script_template.md
  video/                        character refs, scene parsing, render plan
  publish/instagram.py          Meta Graph API client (optional)
  cli.py                        `cxo` Typer entry point
data/                           generated artefacts (gitignored)
scripts/pilot.sh                end-to-end smoke run
```

## Verification

1. `cxo fetch --since-days 30 && cxo screen` — confirm candidates appear in
   `data/candidates/`.
2. Pick one id, `cxo script <id>` — read the resulting Markdown out loud and
   time it (target: ≤ 15 s).
3. Move to `data/approved/`, run `cxo render <id>` — confirm
   `render_plan.json` has scenes, each with a Pixa payload.
4. Feed the first scene into Pixa `generate_media`; eyeball Dr. Meera's
   appearance against `data/character/`. If it drifts, switch
   `VIDEO_MODEL=kling-v3-pro` in `.env` and re-run — Kling accepts reference
   images directly.
5. Stitch the clips, post to a test IG account, watch retention for a week
   before going live on the public account.
