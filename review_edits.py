#!/usr/bin/env python3
"""
Interactive subplot reviewer for Boston Marathon bombing revision history.
Go through edits one by one, see the diff, and assign subplot numbers.
Progress is saved automatically so you can resume at any time.

Usage:
    python3 review_edits.py              # start / resume from last position
    python3 review_edits.py --from 200   # jump to a specific index
    python3 review_edits.py --unreviewed # jump to first unreviewed entry
    python3 review_edits.py --stats      # show subplot assignment stats
"""

import json
import sys
import os
import difflib
import textwrap
import argparse
from datetime import datetime

DATA_FILE = os.path.join(os.path.dirname(__file__), "boston_marathon_bombing_revisions_target_sections.json")
PROGRESS_FILE = os.path.join(os.path.dirname(__file__), ".review_progress.json")

SUBPLOTS = {
    1: "The Saudi Suspect False Report",
    2: "Suspect Identification — Unknown to Named",
    3: "Jeff Bauman — Witness to Icon",
    4: "Sunil Tripathi — Documenting a False Accusation",
    5: "Building the Radicalization Narrative",
    6: '"Conflicting Reports" — Meta-Documentation',
}

TERM_WIDTH = os.get_terminal_size().columns if sys.stdout.isatty() else 100

# ANSI colors
RED    = "\033[31m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RESET  = "\033[0m"

def load_data():
    with open(DATA_FILE) as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"cursor": 0}

def save_progress(progress):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)

def build_parent_map(data):
    return {d["revid"]: d for d in data}

def diff_texts(old, new):
    old_lines = old.splitlines(keepends=True) if old else []
    new_lines = new.splitlines(keepends=True) if new else []
    diff = list(difflib.unified_diff(old_lines, new_lines, lineterm="", n=3))
    return diff

def render_diff(diff_lines, max_lines=60):
    output = []
    count = 0
    for line in diff_lines:
        if count >= max_lines:
            output.append(DIM + f"  ... ({len(diff_lines) - count} more diff lines, use --full to see all)" + RESET)
            break
        if line.startswith("+++") or line.startswith("---"):
            output.append(DIM + line.rstrip() + RESET)
        elif line.startswith("@@"):
            output.append(CYAN + line.rstrip() + RESET)
        elif line.startswith("+"):
            output.append(GREEN + line.rstrip() + RESET)
        elif line.startswith("-"):
            output.append(RED + line.rstrip() + RESET)
        else:
            output.append(DIM + line.rstrip() + RESET)
        count += 1
    return "\n".join(output)

def subplot_legend():
    lines = [BOLD + "Subplots:" + RESET]
    for n, title in SUBPLOTS.items():
        lines.append(f"  {YELLOW}{n}{RESET}  {title}")
    return "\n".join(lines)

def print_header(rev, idx, total, parent_rev):
    print("\n" + "═" * TERM_WIDTH)
    ts = rev["timestamp"].replace("T", " ").replace("Z", " UTC")
    assigned = rev.get("subplot")
    assigned_str = ""
    if assigned:
        assigned_str = f"  {YELLOW}[already tagged: {assigned}]{RESET}"
    print(f"{BOLD}Edit {idx + 1}/{total}{RESET}  ·  {ts}  ·  {CYAN}{rev['user']}{RESET}{assigned_str}")
    print(f"revid: {rev['revid']}  parentid: {rev['parentid']}")
    if rev.get("comment"):
        comment = rev["comment"][:120]
        print(f"comment: {DIM}{comment}{RESET}")
    print("─" * TERM_WIDTH)

def show_diff(rev, parent_rev):
    old_text = parent_rev["plaintext"] if parent_rev else ""
    new_text = rev["plaintext"] or ""
    diff = diff_texts(old_text, new_text)
    if not diff:
        print(DIM + "(no change in plaintext)" + RESET)
    else:
        print(render_diff(diff))

def print_prompt():
    print()
    print(subplot_legend())
    print()
    print("Enter subplot number(s) to assign, or:")
    print(f"  {BOLD}Enter{RESET} / {BOLD}s{RESET}  skip (no subplot)")
    print(f"  {BOLD}b{RESET}        go back one")
    print(f"  {BOLD}d{RESET}        show full diff (all lines)")
    print(f"  {BOLD}w{RESET}        show raw wikitext diff instead")
    print(f"  {BOLD}q{RESET}        quit and save")
    print()

def parse_subplots_input(raw):
    parts = [p.strip() for p in raw.replace(",", " ").split()]
    result = []
    for p in parts:
        try:
            n = int(p)
            if n in SUBPLOTS:
                result.append(n)
            else:
                print(f"  Unknown subplot number: {n}")
                return None
        except ValueError:
            print(f"  Not a number: {p!r}")
            return None
    return result

def print_stats(data):
    total = len(data)
    reviewed = sum(1 for d in data if "subplot" in d)
    print(f"\nTotal revisions:  {total}")
    print(f"Reviewed:         {reviewed}")
    print(f"Unreviewed:       {total - reviewed}")
    print()
    counts = {}
    for d in data:
        sp = d.get("subplot")
        if sp:
            sps = sp if isinstance(sp, list) else [sp]
            for n in sps:
                counts[n] = counts.get(n, 0) + 1
    if counts:
        print("Subplot assignments:")
        for n in sorted(counts):
            title = SUBPLOTS.get(n, f"subplot {n}")
            print(f"  {n}  {title}: {counts[n]}")
    print()

def first_unreviewed(data):
    for i, d in enumerate(data):
        if "subplot" not in d:
            return i
    return len(data)

def main():
    parser = argparse.ArgumentParser(description="Review edits and assign subplot numbers.")
    parser.add_argument("--from", dest="start", type=int, default=None, help="Start at index N")
    parser.add_argument("--unreviewed", action="store_true", help="Jump to first unreviewed edit")
    parser.add_argument("--stats", action="store_true", help="Show assignment stats and exit")
    args = parser.parse_args()

    data = load_data()
    parent_map = build_parent_map(data)

    if args.stats:
        print_stats(data)
        return

    progress = load_progress()

    if args.start is not None:
        idx = max(0, min(args.start, len(data) - 1))
    elif args.unreviewed:
        idx = first_unreviewed(data)
    else:
        idx = progress.get("cursor", 0)

    total = len(data)
    print(f"\nResuming at edit {idx + 1}/{total}. ({total - idx} remaining)")
    print("Press Ctrl+C or type 'q' to quit and save.\n")

    show_wikitext = False
    show_full = False

    while idx < total:
        rev = data[idx]
        parent_rev = parent_map.get(rev["parentid"])

        print_header(rev, idx, total, parent_rev)

        if show_wikitext:
            old_text = parent_rev["wikitext"] if parent_rev else ""
            new_text = rev["wikitext"] or ""
            diff = diff_texts(old_text, new_text)
        else:
            old_text = parent_rev["plaintext"] if parent_rev else ""
            new_text = rev["plaintext"] or ""
            diff = diff_texts(old_text, new_text)

        max_lines = None if show_full else 60
        if not diff:
            print(DIM + "(no change)" + RESET)
        else:
            print(render_diff(diff, max_lines=max_lines or 9999))

        # Reset per-edit flags
        show_wikitext = False
        show_full = False

        print_prompt()

        try:
            raw = input("> ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nSaving and quitting.")
            save_data(data)
            progress["cursor"] = idx
            save_progress(progress)
            print_stats(data)
            return

        if raw in ("q", "quit", "exit"):
            save_data(data)
            progress["cursor"] = idx
            save_progress(progress)
            print("\nSaved. Run again to resume.")
            print_stats(data)
            return

        elif raw in ("", "s", "skip"):
            idx += 1
            progress["cursor"] = idx
            save_progress(progress)

        elif raw == "b":
            idx = max(0, idx - 1)
            progress["cursor"] = idx
            save_progress(progress)

        elif raw == "d":
            show_full = True
            # Re-display same edit with full diff — loop without advancing idx

        elif raw == "w":
            show_wikitext = True
            # Re-display same edit with wikitext diff

        else:
            subplots = parse_subplots_input(raw)
            if subplots is not None:
                if len(subplots) == 0:
                    # User typed something that parsed to nothing — treat as skip
                    idx += 1
                elif len(subplots) == 1:
                    rev["subplot"] = subplots[0]
                    print(f"  {GREEN}Assigned subplot {subplots[0]}: {SUBPLOTS[subplots[0]]}{RESET}")
                    idx += 1
                else:
                    rev["subplot"] = subplots
                    labels = ", ".join(f"{n}: {SUBPLOTS[n]}" for n in subplots)
                    print(f"  {GREEN}Assigned subplots [{labels}]{RESET}")
                    idx += 1
                save_data(data)
                progress["cursor"] = idx
                save_progress(progress)

    print("\nAll edits reviewed!")
    print_stats(data)
    save_data(data)

if __name__ == "__main__":
    main()
