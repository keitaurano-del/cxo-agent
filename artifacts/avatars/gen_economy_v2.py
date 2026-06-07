#!/usr/bin/env python3
"""Economy run: generate 2 frames/state for the remaining 7 sibling agents,
flood-key + downscale to 512 transparent, build 2-frame ping-pong looping GIFs,
and update manifest-v2.json after EACH agent. Synchronous, no apng.

Reuses the approved Ren/Apollo approach (gemini-2.5-flash-image, flat #1b2733
background, border-seeded flood-fill chroma-key, Pillow GIF assembly).
Does NOT touch avatar-ren-* or avatar-apollo-* outputs.
"""
import base64, json, os, sys, time, urllib.request, urllib.error
from collections import deque
from io import BytesIO
from PIL import Image

OUT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(OUT, "raw1024")
os.makedirs(RAW, exist_ok=True)
MODEL = os.environ.get("MODEL", "gemini-2.5-flash-image")
SIZE = 512
TOL = 30
MANIFEST = os.path.join(OUT, "manifest-v2.json")

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

# Distinct designs (vary hair/clothes/props/build). Names = role-file personas.
CHARS = {
    "content-creator": (
        'Character "Nao" (content writer): an enthusiastic lesson writer. Medium build, tousled '
        'warm-brown hair, round glasses, mustard-yellow cardigan over a white shirt, brown '
        'trousers. Curious lively expression. Warm yellow/brown palette. '
        'Signature props: an open book and a large quill pen. '
    ),
    "designer": (
        'Character "Aoi" (visual designer), female, slender, sleek bob haircut dyed soft '
        'lavender-pink, clean cream smock over a teal turtleneck, slim pants. Thoughtful '
        'refined expression. Soft pastel palette with one coral accent. '
        'Signature props: a stylus and a drawing tablet with a small color palette. '
    ),
    "haru": (
        'Character "Haru" (KPI/data observer). Lean build, neat short black hair with an '
        'undercut, sharp focused eyes, slate-grey analyst vest over a light-blue shirt, dark '
        'slacks. Cool analytical expression. Blue/green dashboard palette. '
        'Signature prop: a small floating pixel line-chart / KPI graph. '
    ),
    "hayashi-rin": (
        'Character "Hayashi" (senior orchestrator), a kindly elderly grandfather mentor, neat '
        'grey hair and short grey beard, gentle eyes, warm earthy-brown long cardigan over a '
        'cream shirt with a subtle scarf, comfortable shoes. Serene reassuring expression. '
        'Warm muted earth palette. Signature prop: a softly glowing coordination orb. '
    ),
    "masayoshi": (
        'Character "Masayoshi" (executive secretary), male, medium-tall tidy build, neatly '
        'combed dark hair, crisp charcoal business suit with a deep-blue tie, polished shoes. '
        'Composed professional attentive expression. Refined navy/charcoal palette. '
        'Signature props: a clipboard and a small notebook. '
    ),
    "task-manager": (
        'Character "Yui" (task coordinator), female, petite tidy build, dark hair in a '
        'practical low ponytail, tidy teal blazer over a white blouse, pencil skirt, flats. '
        'Focused persistent no-nonsense expression. Crisp teal/white palette. '
        'Signature prop: a large kanban checklist board with ticked checkboxes. '
    ),
    "test-functional": (
        'Character "Ken" (QA verifier), male, athletic build, short spiky dark-green hair, '
        'a magnifier loupe, forest-green field jacket with many small pockets over a grey '
        'shirt, utility pants, boots. Skeptical scrutinizing expression. Green palette with a '
        'red bug-alert accent. Signature props: a big magnifying glass and a checklist. '
    ),
}

NAMES = {
    "ren": "蓮",
    "apollo": "apollo",
    "content-creator": "ナオ",
    "designer": "アオイ",
    "haru": "ハル",
    "hayashi-rin": "林",
    "masayoshi": "Masayoshi",
    "task-manager": "ユイ",
    "test-functional": "ケン",
}

SPECS = {
    "idle": [
        ("f1", "Pose: standing calmly, neutral idle, arms relaxed, front 3/4 view, eyes open."),
        ("f2", "Pose: identical standing idle but breathing in (chest/shoulders slightly raised), eyes open. Keep EXACTLY the same character, palette, framing and position."),
    ],
    "working": [
        ("f1", "Pose: actively working at their craft using their signature prop/tool, focused intense expression, slight forward lean. Front 3/4 view."),
        ("f2", "Pose: same working scene, hands/prop in a slightly different mid-action position, small glow of activity. Keep EXACTLY the same character, palette, framing and position."),
    ],
}

def gen(prompt_text, ref_png=None, tries=6):
    parts = [{"text": prompt_text}]
    if ref_png:
        with open(ref_png, "rb") as f:
            parts.append({"inlineData": {"mimeType": "image/png", "data": base64.b64encode(f.read()).decode()}})
    body = json.dumps({"contents": [{"parts": parts}],
                       "generationConfig": {"responseModalities": ["IMAGE"]}}).encode()
    delay = 24
    last = None
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            for p in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                if "inlineData" in p:
                    return base64.b64decode(p["inlineData"]["data"]), None
            print(f"  no image (attempt {attempt}): {json.dumps(data)[:240]}")
            last = "no-image"
        except urllib.error.HTTPError as e:
            last = e.code
            print(f"  HTTP {e.code} attempt {attempt}: {e.read()[:200]}")
            if e.code not in (429, 500, 503):
                return None, e.code
        except Exception as e:
            last = str(e)
            print(f"  err attempt {attempt}: {e}")
        if attempt < tries:
            print(f"  backoff {delay}s...")
            time.sleep(delay)
            delay = min(delay + 8, 60)
    return None, last

def build_prompt(char, pose, first):
    base = STYLE + " " + char + " " + pose
    if first:
        return ("Generate a single character pixel-art sprite. " + base +
                " This is a reusable mascot in a set of sibling characters; keep the same "
                "pixel-art style and the same flat #1b2733 background as the set.")
    return ("Using the SAME exact character from the reference image (same face, hair, "
            "outfit colors, pixel style, scale, background color), produce a new frame. " + base)

def flood_key(img):
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    cs = [px[1, 1], px[w - 2, 1], px[1, h - 2], px[w - 2, h - 2]]
    rr = sum(c[0] for c in cs) // 4
    rg = sum(c[1] for c in cs) // 4
    rb = sum(c[2] for c in cs) // 4
    tol2 = TOL * TOL
    visited = bytearray(w * h)
    dq = deque()
    def match(x, y):
        r, g, b, a = px[x, y]
        return (r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2 <= tol2
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if not visited[i] and match(x, y):
                visited[i] = 1; dq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if not visited[i] and match(x, y):
                visited[i] = 1; dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < w and 0 <= ny < h:
                j = ny * w + nx
                if not visited[j] and match(nx, ny):
                    visited[j] = 1; dq.append((nx, ny))
    for y in range(h):
        row = y * w
        for x in range(w):
            if visited[row + x]:
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 0)
    return img

def assemble_state(key, state, raw_paths):
    keyed = []
    for p in raw_paths:
        big = flood_key(Image.open(p))
        small = big.resize((SIZE, SIZE), Image.NEAREST)
        outp = os.path.join(OUT, f"avatar-{key}-{state}-v2-{os.path.basename(p).split('-')[-1]}")
        small.save(outp)
        keyed.append(small)
    if not keyed:
        return False
    keyed[0].save(os.path.join(OUT, f"avatar-{key}-{state}-v2.png"))
    # 2-frame ping-pong: [f1, f2] -> loop is just f1,f2 (already symmetric back-and-forth)
    seq = keyed if len(keyed) > 1 else keyed
    durs = [600 if state == "idle" else 320] * len(seq)
    gif_frames = []
    for f in seq:
        rgb = f.convert("RGB")
        base_p = rgb.quantize(colors=255, method=Image.MEDIANCUT)
        bp = base_p.load()
        pimg = Image.new("P", rgb.size)
        pimg.putpalette([255, 0, 255] + base_p.getpalette()[:255 * 3])
        op = pimg.load()
        a = f.split()[3].load()
        w, h = rgb.size
        for y in range(h):
            for x in range(w):
                op[x, y] = 0 if a[x, y] < 128 else bp[x, y] + 1
        gif_frames.append(pimg)
    gp = os.path.join(OUT, f"avatar-{key}-{state}-v2.gif")
    gif_frames[0].save(gp, save_all=True, append_images=gif_frames[1:],
                       duration=durs, loop=0, disposal=2, transparency=0, optimize=False)
    print("  GIF", os.path.basename(gp))
    return True

def manifest_entry(key):
    return {
        "key": key,
        "name": NAMES.get(key, key),
        "working": f"avatar-{key}-working-v2.gif",
        "idle": f"avatar-{key}-idle-v2.gif",
        "workingStill": f"avatar-{key}-working-v2.png",
        "idleStill": f"avatar-{key}-idle-v2.png",
    }

def have_outputs(key):
    """An agent is 'done' if all 6 primary outputs exist on disk."""
    needed = [
        f"avatar-{key}-working-v2.gif", f"avatar-{key}-idle-v2.gif",
        f"avatar-{key}-working-v2.png", f"avatar-{key}-idle-v2.png",
    ]
    return all(os.path.exists(os.path.join(OUT, n)) for n in needed)

def load_manifest():
    if os.path.exists(MANIFEST):
        try:
            return json.load(open(MANIFEST))
        except Exception:
            pass
    return []

def update_manifest(key):
    arr = load_manifest()
    arr = [e for e in arr if e.get("key") != key]
    arr.append(manifest_entry(key))
    order = list(NAMES.keys())
    arr.sort(key=lambda e: order.index(e["key"]) if e["key"] in order else 99)
    json.dump(arr, open(MANIFEST, "w"), ensure_ascii=False, indent=2)
    print("  manifest updated:", key)

def seed_existing_manifest():
    """Ensure ren + apollo present in manifest at start (already finished)."""
    arr = load_manifest()
    have = {e.get("key") for e in arr}
    changed = False
    for k in ("ren", "apollo"):
        if k not in have and have_outputs(k):
            arr.append(manifest_entry(k)); changed = True
    if changed:
        order = list(NAMES.keys())
        arr.sort(key=lambda e: order.index(e["key"]) if e["key"] in order else 99)
        json.dump(arr, open(MANIFEST, "w"), ensure_ascii=False, indent=2)
        print("seeded manifest with existing:", [e["key"] for e in arr])

def run_agent(key):
    char = CHARS[key]
    print(f"#### AGENT {key} ({NAMES[key]}) ####")
    fails = {}
    state_ok = {}
    for state, frames in SPECS.items():
        print(f"== {key} {state} ==")
        ref = None
        raw_paths = []
        for fid, pose in frames:
            rawp = os.path.join(RAW, f"avatar-{key}-{state}-v2-{fid}.png")
            if os.path.exists(rawp) and ref is not None:
                # reuse cached frame from a prior partial run
                print(f"  reuse cached {fid}")
                raw_paths.append(rawp)
                continue
            first = ref is None
            prompt = build_prompt(char, pose, first)
            if first and os.path.exists(rawp):
                print(f"  reuse cached {fid} (ref)")
                raw_paths.append(rawp); ref = rawp
                continue
            print(f"  gen {key}-{state}-{fid} (ref={'no' if first else 'yes'})")
            raw, code = gen(prompt, ref_png=ref)
            if not raw:
                print(f"  FAILED {key}-{state}-{fid} code={code}")
                fails[f"{state}-{fid}"] = code
                continue
            Image.open(BytesIO(raw)).convert("RGBA").save(rawp)
            raw_paths.append(rawp)
            if first:
                ref = rawp
            time.sleep(3)
        if raw_paths:
            ok = assemble_state(key, state, raw_paths)
            state_ok[state] = ok and len(raw_paths)
        else:
            state_ok[state] = 0
    if have_outputs(key):
        update_manifest(key)
    return {"frames": state_ok, "fails": fails, "complete": have_outputs(key)}

if __name__ == "__main__":
    seed_existing_manifest()
    agents = sys.argv[1:] or list(CHARS.keys())
    summary = {}
    for key in agents:
        if key not in CHARS:
            print("unknown agent", key); continue
        if have_outputs(key):
            print(f"SKIP {key}: outputs already present")
            update_manifest(key)
            summary[key] = {"complete": True, "skipped": True}
            continue
        summary[key] = run_agent(key)
        print("AGENT_DONE", key, json.dumps(summary[key]))
    print("SUMMARY", json.dumps(summary, ensure_ascii=False))
