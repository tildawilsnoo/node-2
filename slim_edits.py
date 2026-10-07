#!/usr/bin/env python3
"""
Write edits_slim.json: just the revisions sketch.js actually shows.

edits_with_citations.json is ~100MB, which makes the page sit on p5's
"Loading..." screen. This replays sketch.js's setup() ahead of time —
the running section snapshot, the INCLUDE filter, and the
skip-if-plaintext-unchanged filter — and keeps only the surviving
revisions. Each one carries its full snapshot as section_text_after, so
sketch.js's own forward pass rebuilds identical state from the slim file.

Run after changing manual_subplot tags:
    python3 slim_edits.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "edits_with_citations.json"
OUT = ROOT / "edits_slim.json"

# Must match SECTION_ORDER in sketch.js
SECTION_ORDER = [
    'Investigation',
    'Suspects',
    'Arrest', 'Arrests',
    'Other arrests', 'Other arrests and detentions',
    'Conflicting reports',
]
KEEP_FIELDS = ["revid", "user", "comment", "timestamp", "manual_subplot"]


def main():
    data = json.loads(SRC.read_text())

    state = {}
    kept = []
    prev_plaintext = None
    for rev in data["revisions"]:
        state.update(rev.get("section_text_after") or {})
        if rev.get("manual_subplot") != "INCLUDE":
            continue
        plaintext = "\n".join((state.get(name) or {}).get("plaintext") or "" for name in SECTION_ORDER)
        if plaintext == prev_plaintext:
            continue
        prev_plaintext = plaintext
        slim = {k: rev.get(k) for k in KEEP_FIELDS}
        slim["section_text_after"] = dict(state)
        kept.append(slim)

    out = {k: v for k, v in data.items() if k != "revisions"}
    out["revisions"] = kept
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT.name}: {len(kept)} revisions, {OUT.stat().st_size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
