#!/usr/bin/env python3
"""Generate Ren v2 pixel-art avatar frames via Gemini, then assemble GIFs."""
import base64, json, os, sys, time, urllib.request, urllib.error
from io import BytesIO
from PIL import Image

OUT = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("MODEL", "gemini-2.5-flash-image")

def read_key():
    with open("/home/dev/projects/logic/.env") as f:
        for line in f:
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")

KEY = read_key()
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}"

CHAR = (
    'Character "Ren": a focused young software engineer. Short dark messy hair, '
    'slim build, wearing a dark charcoal hoodie over a teal-green shirt, dark pants, '
    'simple sneakers. Calm friendly but concentrated face. '
)
STYLE = (
    "Detailed polished retro pixel art (rich 16/32-bit dot-art, crisp visible pixels, "
    "limited clean palette, NOT smooth vector or 3D render). Centered single full-body "
    "character, clean readable silhouette for a 64-256px avatar. Plain solid flat "
    "background (single uniform color #1b2733), no text, no UI, no frame, no ground shadow. "
    "Square image."
)

def gen(prompt_text, ref_png=None, tries=5):
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
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            for p in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                if "inlineData" in p:
                    return base64.b64decode(p["inlineData"]["data"])
            print(f"  no image in response (attempt {attempt}): "
                  f"{json.dumps(data)[:300]}")
        except urllib.error.HTTPError as e:
            code = e.code
            print(f"  HTTP {code} attempt {attempt}: {e.read()[:200]}")
            if code not in (429, 500, 503):
                if code == 400:
                    pass
        except Exception as e:
            print(f"  err attempt {attempt}: {e}")
        if attempt < tries:
            print(f"  backoff {delay}s...")
            time.sleep(delay)
            delay = min(delay + 12, 60)
    return None

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
        ("f1", "Pose: actively engineering — seated/leaning, both hands typing on a small pixel laptop/keyboard, focused intense expression, slight forward lean. Front 3/4 view."),
        ("f2", "Pose: same typing-at-laptop scene, hands in the OTHER keystroke position (fingers moved), small code glow on screen. Keep EXACTLY the same character, palette, framing and position."),
        ("f3", "Pose: same typing-at-laptop scene, one hand raised holding a small pixel wrench/tool mid-gesture, focused. Keep EXACTLY the same character, palette, framing and position."),
    ],
}

def build_prompt(state, pose, first):
    base = STYLE + " " + CHAR + " " + pose
    if first:
        return ("Generate a single character pixel-art sprite. " + base +
                " This is a reusable mascot; design a clear consistent style "
                "so 8 sibling characters can match it later.")
    return ("Using the SAME exact character from the reference image (same face, hair, "
            "outfit colors, pixel style, scale, background color), produce a new frame. "
            + base)

results = {}
for state, frames in SPECS.items():
    print(f"== {state} ==")
    ref = None
    for fid, pose in frames:
        first = ref is None
        prompt = build_prompt(state, pose, first)
        print(f" {state}-{fid} (ref={'no' if first else 'yes'})")
        raw = gen(prompt, ref_png=ref)
        if not raw:
            print(f"  FAILED {state}-{fid}")
            continue
        path = os.path.join(OUT, f"avatar-ren-{state}-v2-{fid}.png")
        size = save_png(raw, path)
        print(f"  saved {path} {size}")
        results.setdefault(state, []).append(path)
        if first:
            ref = path  # condition subsequent frames on first frame
        time.sleep(3)

# best still = f1 of each state
for state in SPECS:
    fs = results.get(state, [])
    if fs:
        Image.open(fs[0]).save(os.path.join(OUT, f"avatar-ren-{state}-v2.png"))

print("RESULTS", json.dumps(results))
