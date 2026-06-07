#!/usr/bin/env python3
"""Edge flood-fill chroma-key (only bg-connected pixels), downscale, GIF+APNG.

Same approach as assemble_v2.py (Ren) but parameterized by agent key.
Reads raw frames from raw1024/avatar-<key>-<state>-v2-fN.png and writes
keyed 512x512 frames, best stills, and ping-pong looping GIFs.
"""
import os, sys
from collections import deque
from PIL import Image

OUT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(OUT, "raw1024")
SIZE = 512
TOL = 30

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

def frames(key, state):
    out = []
    for fid in ("f1", "f2", "f3"):
        p = os.path.join(RAW, f"avatar-{key}-{state}-v2-{fid}.png")
        if os.path.exists(p):
            out.append((fid, p))
    return out

def assemble(key):
    any_out = False
    for state in ("idle", "working"):
        fs = frames(key, state)
        if not fs:
            print("no frames", key, state); continue
        keyed = []
        for fid, p in fs:
            big = flood_key(Image.open(p))
            small = big.resize((SIZE, SIZE), Image.NEAREST)
            outp = os.path.join(OUT, f"avatar-{key}-{state}-v2-{fid}.png")
            small.save(outp)
            keyed.append(small)
            a = small.getchannel("A")
            tr = sum(1 for v in a.getdata() if v == 0) * 100 // (SIZE * SIZE)
            print(f"keyed {os.path.basename(outp)} transparent={tr}%")

        keyed[0].save(os.path.join(OUT, f"avatar-{key}-{state}-v2.png"))
        any_out = True

        seq = keyed + keyed[-2:0:-1] if len(keyed) > 1 else keyed
        durs = [600 if state == "idle" else 320] * len(seq)

        gif_frames = []
        for f in seq:
            rgb = f.convert("RGB")
            base_p = rgb.quantize(colors=255, method=Image.MEDIANCUT)
            bp = base_p.load()
            pimg = Image.new("P", rgb.size)
            full_pal = [255, 0, 255] + base_p.getpalette()[:255 * 3]
            pimg.putpalette(full_pal)
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
        print("GIF", gp)

        ap = os.path.join(OUT, f"avatar-{key}-{state}-v2.apng")
        seq[0].save(ap, save_all=True, append_images=seq[1:], duration=durs, loop=0, format="PNG")
        print("APNG", ap)
    return any_out

if __name__ == "__main__":
    keys = sys.argv[1:]
    if not keys:
        # discover from raw dir
        seen = set()
        for fn in os.listdir(RAW):
            if fn.startswith("avatar-") and "-v2-f" in fn:
                k = fn[len("avatar-"):].split("-idle-")[0].split("-working-")[0]
                seen.add(k)
        keys = sorted(seen - {"ren"})
    for key in keys:
        print(f"#### assemble {key} ####")
        assemble(key)
    print("done")
