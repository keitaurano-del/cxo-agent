#!/usr/bin/env python3
"""Generate v2 pixel-art avatar frames for the 8 sibling agents via Gemini.

Mirrors gen_v2.py (Ren). Saves full-res raw PNGs into raw1024/ so that
assemble_agents_v2.py can flood-fill chroma-key + downscale + build GIFs,
exactly like the approved Ren pipeline. Does NOT touch avatar-ren-* files.
"""
import base64, json, os, sys, time, urllib.request, urllib.error
from io import BytesIO
from PIL import Image

OUT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(OUT, "raw1024")
os.makedirs(RAW, exist_ok=True)
MODEL = os.environ.get("MODEL", "gemini-2.5-flash-image")

def read_key():
    with open("/home/dev/projects/logic/.env") as f:
        for line in f:
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")

KEY = read_key()
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}"

STYLE = (
    "Detailed polished retro pixel art (rich 16/32-bit dot-art, crisp visible pixels, "
    "limited clean palette, NOT smooth vector or 3D render). Centered single full-body "
    "character, clean readable silhouette for a 64-256px avatar. Plain solid flat "
    "background (single uniform color #1b2733), no text, no UI, no frame, no ground shadow. "
    "Square image."
)

# Distinct character designs — different hair/clothes/build/gender/props.
CHARS = {
    "apollo": (
        'Character "Apollo": a vigilant infrastructure guardian / night-watch sentinel. '
        'Tall sturdy build, short cropped silver-grey hair, a small headset over one ear, '
        'wearing a dark navy tech-jacket with glowing teal status lights on the chest, '
        'cargo pants, boots. Calm watchful steady expression. Cool blue/cyan accent palette. '
        'Carries a small glowing server rack / shield-monitor motif. '
    ),
    "content-creator": (
        'Character "Nao": an enthusiastic lesson-writer. Medium build, tousled warm-brown '
        'hair, round glasses, wearing a mustard-yellow cardigan over a white shirt, brown '
        'trousers. Curious lively expression. Warm yellow/brown palette. '
        'Carries an open book and a large quill pen / document. '
    ),
    "designer": (
        'Character "Aoi": a minimalist visual designer, female, slender, with a sleek bob '
        'haircut dyed soft lavender-pink, wearing a clean cream smock over a teal turtleneck, '
        'simple slim pants. Thoughtful refined expression. Soft pastel palette with one warm '
        'coral accent. Holds a stylus and a small color palette / drawing tablet. '
    ),
    "haru": (
        'Character "Haru": a sharp data/KPI observer. Lean build, neat short black hair with '
        'an undercut, sharp focused eyes, wearing a slate-grey analyst vest over a light blue '
        'shirt, dark slacks. Cool analytical expression. Blue/green dashboard palette. '
        'Holds a small floating pixel line-chart / data graph. '
    ),
    "hayashi-rin": (
        'Character "Hayashi": a senior, composed orchestrator, a wise elderly mentor figure. '
        'Kindly grandfather vibe, neat grey hair and short grey beard, gentle eyes, wearing a '
        'warm earthy-brown long cardigan over a cream shirt, with a subtle scarf, comfortable '
        'shoes. Serene calm reassuring expression. Warm muted earth palette. '
        'Holds a softly glowing orb / coordination baton motif. '
    ),
    "masayoshi": (
        'Character "Masayoshi": a polished, courteous executive secretary, male, medium-tall '
        'tidy build, neatly combed dark hair, wearing a crisp charcoal business suit with a '
        'deep blue tie, polished shoes. Composed, professional, attentive expression. '
        'Refined navy/charcoal palette. Holds a clipboard and a small notebook. '
    ),
    "son": (
        'Character "Son": a fresh young assistant secretary, the deputy to Masayoshi, male, '
        'slim youthful build, slightly tousled neat dark hair, bright attentive eyes, wearing '
        'a smart navy-blue business suit (a touch more casual than his senior, top button '
        'open, no tie or a loose lighter tie), polished shoes. Eager, friendly, reliable, '
        'helpful expression. Clean blue/navy palette with a fresh light-cyan accent. '
        'Holds a tablet and a small stack of papers. '
    ),
    "task-manager": (
        'Character "Yui": a meticulous task-coordinator, female, petite tidy build, dark hair '
        'in a practical low ponytail, wearing a tidy teal blazer over a white blouse, pencil '
        'skirt, flats. Focused, persistent, no-nonsense expression. Crisp teal/white palette. '
        'Holds a large kanban checklist board with ticked items. '
    ),
    "test-functional": (
        'Character "Ken": a rigorous QA verifier, male, athletic build, short spiky dark-green '
        'hair, a single magnifier loupe, wearing a forest-green field jacket with many small '
        'pockets over a grey shirt, utility pants, boots. Skeptical, scrutinizing, determined '
        'expression. Green palette with a red bug-alert accent. Holds a big magnifying glass '
        'and a small bug-net. '
    ),
    "robot": (
        'Character "Bot": a friendly general-purpose worker robot, NOT a human, a small '
        'boxy retro android. Rounded rectangular metal head with a single horizontal glowing '
        'cyan visor eye-band, a short stubby antenna, segmented brushed-steel-grey arms with '
        'simple three-finger claw hands, a compact two-legged chassis, a chest panel with a few '
        'small status LEDs. Brushed steel-grey body with cyan accent lights, visible rivets and '
        'panel lines. Diligent, busy, helpful worker vibe. Holds a small wrench / utility tool. '
    ),
}

def gen(prompt_text, ref_png=None, tries=6):
    parts = [{"text": prompt_text}]
    if ref_png:
        with open(ref_png, "rb") as f:
            b = base64.b64encode(f.read()).decode()
        parts.append({"inlineData": {"mimeType": "image/png", "data": b}})
    body = json.dumps({
        "contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }).encode()
    delay = 22
    last_code = None
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            for p in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                if "inlineData" in p:
                    return base64.b64decode(p["inlineData"]["data"]), None
            print(f"  no image in response (attempt {attempt}): {json.dumps(data)[:300]}")
            last_code = "no-image"
        except urllib.error.HTTPError as e:
            last_code = e.code
            print(f"  HTTP {e.code} attempt {attempt}: {e.read()[:200]}")
            if e.code not in (429, 500, 503):
                return None, e.code
        except Exception as e:
            last_code = str(e)
            print(f"  err attempt {attempt}: {e}")
        if attempt < tries:
            print(f"  backoff {delay}s...")
            time.sleep(delay)
            delay = min(delay + 12, 70)
    return None, last_code

def save_png(raw, path):
    img = Image.open(BytesIO(raw)).convert("RGBA")
    img.save(path)
    return img.size

SPECS = {
    "idle": [
        ("f1", "Pose: standing calmly, neutral idle, arms relaxed at sides, front 3/4 view, eyes open."),
        ("f2", "Pose: identical standing idle but breathing in (chest/shoulders raised slightly higher), eyes open. Keep EXACTLY the same character, palette, framing and position."),
        ("f3", "Pose: identical standing idle, mid-blink (eyes closed), shoulders neutral. Keep EXACTLY the same character, palette, framing and position."),
    ],
    "working": [
        ("f1", "Pose: actively working at their craft using their signature prop/tool, focused intense expression, slight forward lean. Front 3/4 view."),
        ("f2", "Pose: same working scene, hands/prop in a slightly different mid-action position, small glow of activity. Keep EXACTLY the same character, palette, framing and position."),
        ("f3", "Pose: same working scene, one hand raised mid-gesture with the signature prop, focused. Keep EXACTLY the same character, palette, framing and position."),
    ],
}

def build_prompt(char, state, pose, first):
    base = STYLE + " " + char + " " + pose
    if first:
        return ("Generate a single character pixel-art sprite. " + base +
                " This is a reusable mascot in a set of sibling characters; keep the same "
                "pixel-art style and the same flat #1b2733 background as the set.")
    return ("Using the SAME exact character from the reference image (same face, hair, "
            "outfit colors, pixel style, scale, background color), produce a new frame. "
            + base)

def run_agent(key):
    char = CHARS[key]
    print(f"#### AGENT {key} ####")
    results = {}
    fails = {}
    for state, frames in SPECS.items():
        print(f"== {key} {state} ==")
        ref = None
        for fid, pose in frames:
            first = ref is None
            prompt = build_prompt(char, state, pose, first)
            print(f" {key}-{state}-{fid} (ref={'no' if first else 'yes'})")
            raw, code = gen(prompt, ref_png=ref)
            if not raw:
                print(f"  FAILED {key}-{state}-{fid} code={code}")
                fails[f"{state}-{fid}"] = code
                continue
            path = os.path.join(RAW, f"avatar-{key}-{state}-v2-{fid}.png")
            size = save_png(raw, path)
            print(f"  saved {path} {size}")
            results.setdefault(state, []).append(path)
            if first:
                ref = path
            time.sleep(3)
    return results, fails

if __name__ == "__main__":
    agents = sys.argv[1:] or list(CHARS.keys())
    summary = {}
    for key in agents:
        if key not in CHARS:
            print("unknown agent", key); continue
        res, fails = run_agent(key)
        summary[key] = {"ok": {k: len(v) for k, v in res.items()}, "fails": fails}
        print("AGENT_DONE", key, json.dumps(summary[key]))
    print("SUMMARY", json.dumps(summary))
