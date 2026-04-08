#!/usr/bin/env python3
"""Sync Logic TECH_STACK / SOURCE_FILES constants into Apollo Mansion.

Reads /workspaces/logic/src/Profile.tsx and regenerates
/workspaces/cxo-agent/static/js/logic-spec-data.js.

Safe to run repeatedly. Invoked:
- Manually: `python scripts/sync_logic_spec.py`
- Automatically: Flask startup hook in app.py (if file is missing or >24h old)
"""
import os
import re
import sys
import time

LOGIC_PROFILE = "/workspaces/logic/src/Profile.tsx"
OUT_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "static", "js", "logic-spec-data.js",
)


def _extract_array_literal(src: str, name: str) -> str | None:
    """Return the text of `const <name> = [ ... ]` (the array literal including brackets)."""
    m = re.search(rf"const {name} = (\[)", src)
    if not m:
        return None
    start = m.end() - 1
    depth = 0
    in_str = None  # None | "'" | '"' | "`"
    i = start
    while i < len(src):
        ch = src[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
        elif ch in ("'", '"', "`"):
            in_str = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
        i += 1
    return None


def sync() -> bool:
    if not os.path.isfile(LOGIC_PROFILE):
        print(f"[sync_logic_spec] source not found: {LOGIC_PROFILE}", file=sys.stderr)
        return False
    src = open(LOGIC_PROFILE, "r", encoding="utf-8").read()
    tech = _extract_array_literal(src, "TECH_STACK")
    files = _extract_array_literal(src, "SOURCE_FILES")
    if not tech or not files:
        print("[sync_logic_spec] extraction failed (TECH_STACK / SOURCE_FILES not found)", file=sys.stderr)
        return False

    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    out = (
        "// Auto-generated from /workspaces/logic/src/Profile.tsx\n"
        f"// Last sync: {stamp} (UTC)\n"
        "// Source: Logic アプリ 管理者モード (DevPanel) の TECH_STACK + SOURCE_FILES\n"
        "// Regeneration: scripts/sync_logic_spec.py (Flask auto-runs if >24h old)\n\n"
        f"export const TECH_STACK = {tech};\n\n"
        f"export const SOURCE_FILES = {files};\n"
    )
    out_path = os.path.normpath(OUT_FILE)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(out)
    os.replace(tmp, out_path)
    print(f"[sync_logic_spec] wrote {len(out)} bytes to {out_path}")
    return True


if __name__ == "__main__":
    ok = sync()
    sys.exit(0 if ok else 1)
