#!/usr/bin/env python3
"""Edge flood-fill chroma-key (only bg-connected pixels), downscale, GIF+APNG.

Keys transparency on the FULL-RES image via BFS flood fill from the borders so
the character's own dark colors (which are near the dark bg) are preserved.
"""
import os
from collections import deque
from PIL import Image

OUT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(OUT, "raw1024")
SIZE = 512
TOL = 30          # color distance for "same as background"
EDGE_BLUR = False

def flood_key(img):
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    # reference bg color = average of the four corners
    cs = [px[1, 1], px[w - 2, 1], px[1, h - 2], px[w - 2, h - 2]]
    rr = sum(c[0] for c in cs) // 4
    rg = sum(c[1] for c in cs) // 4
    rb = sum(c[2] for c in cs) // 4
    tol2 = TOL * TOL
    visited = bytearray(w * h)
    dq = deque()
    # seed all border pixels that match bg
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
    # apply: visited bg pixels -> transparent
    for y in range(h):
        row = y * w
        for x in range(w):
            if visited[row + x]:
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 0)
    return img

def frames(state):
    out = []
    for fid in ("f1", "f2", "f3"):
        p = os.path.join(RAW, f"avatar-ren-{state}-v2-{fid}.png")
        if os.path.exists(p):
            out.append((fid, p))
    return out

for state in ("idle", "working"):
    fs = frames(state)
    if not fs:
        print("no frames", state); continue
    keyed = []
    for fid, p in fs:
        big = flood_key(Image.open(p))            # key at full res
        small = big.resize((SIZE, SIZE), Image.NEAREST)
        outp = os.path.join(OUT, f"avatar-ren-{state}-v2-{fid}.png")
        small.save(outp)
        keyed.append(small)
        a = small.getchannel("A")
        tr = sum(1 for v in a.get_flattened_data() if v == 0) * 100 // (SIZE * SIZE)
        print(f"keyed {os.path.basename(outp)} transparent={tr}%")

    keyed[0].save(os.path.join(OUT, f"avatar-ren-{state}-v2.png"))

    seq = keyed + keyed[-2:0:-1]
    durs = [600 if state == "idle" else 320] * len(seq)

    # GIF: index 0 reserved transparent
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
    gp = os.path.join(OUT, f"avatar-ren-{state}-v2.gif")
    gif_frames[0].save(gp, save_all=True, append_images=gif_frames[1:],
                       duration=durs, loop=0, disposal=2, transparency=0, optimize=False)
    print("GIF", gp)

    ap = os.path.join(OUT, f"avatar-ren-{state}-v2.apng")
    seq[0].save(ap, save_all=True, append_images=seq[1:], duration=durs, loop=0, format="PNG")
    print("APNG", ap)

print("done")
