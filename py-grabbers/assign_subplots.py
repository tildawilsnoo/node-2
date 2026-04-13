"""
Assign each revision to one of the 6 Option B subplots (or None).

Subplots:
  1  saudi_suspect        — The Saudi Suspect False Report
  2  suspect_identification — Suspect Identification: Unknown to Named
  3  jeff_bauman           — Jeff Bauman: Witness to Icon
  4  sunil_tripathi        — Sunil Tripathi: Documenting a False Accusation
  5  radicalization        — Building the Radicalization Narrative
  6  conflicting_reports   — "Conflicting Reports": Meta-Documentation

Checks from most specific to most general so specific subplots aren't
swallowed by broader ones.
"""

import json
import re
from pathlib import Path

EDITS_FILE = Path(__file__).parent.parent / "edits_with_citations.json"


def has(text, *phrases):
    return any(p.lower() in text for p in phrases)


def diff_text(prev: str, curr: str) -> str:
    """Return words/sentences present in curr but not prev (crude added-text diff)."""
    prev_lines = set(prev.lower().split("\n"))
    curr_lines = curr.lower().split("\n")
    added = [l for l in curr_lines if l not in prev_lines]
    return " ".join(added)


def classify(rev, prev_sections: dict) -> str | None:
    comment = rev.get("comment", "").lower()
    sections = rev.get("section_text_after", {})
    section_names = list(sections.keys())

    # Build added text: lines present in curr but not in previous snapshot
    added_parts = []
    for name, sc in sections.items():
        curr_pt = sc.get("plaintext", "")
        prev_pt = prev_sections.get(name, {}).get("plaintext", "")
        added_parts.append(diff_text(prev_pt, curr_pt))
    added = " ".join(added_parts)

    # Full text (comment + added lines) for classification
    full = comment + " " + added

    # ------------------------------------------------------------------ #
    # 4. Sunil Tripathi — very specific name
    # ------------------------------------------------------------------ #
    if has(full, "tripathi", "sunil"):
        return "sunil_tripathi"

    # ------------------------------------------------------------------ #
    # 3. Jeff Bauman — very specific name / quote
    # ------------------------------------------------------------------ #
    if has(full, "bauman", "bag, saw the guy"):
        return "jeff_bauman"

    # ------------------------------------------------------------------ #
    # 1. Saudi Suspect False Report
    # ------------------------------------------------------------------ #
    if has(full, "saudi") and has(full, "suspect", "arrest", "detained", "post"):
        return "saudi_suspect"

    # ------------------------------------------------------------------ #
    # 6. Conflicting Reports — the section itself, or meta-documentation
    # ------------------------------------------------------------------ #
    if "Conflicting reports" in section_names:
        return "conflicting_reports"
    if has(full, "conflicting report", "errors in reporting", "false report",
           "misidentif", "wrongly identified", "wrongly accused",
           "reddit", "4chan") and has(full, "suspect", "identif"):
        return "conflicting_reports"

    # ------------------------------------------------------------------ #
    # 5. Radicalization Narrative
    # ------------------------------------------------------------------ #
    if has(full, "vkontakte", "inspire", "salafi", "salafist",
           "radical islam", "extremist islamic", "islamist",
           "chechen separatism", "fsb", "federal security service",
           "motivated by", "worldview", "devout muslim", "jihadist"):
        return "radicalization"

    # ------------------------------------------------------------------ #
    # 2. Suspect Identification — naming, photos, manhunt
    # ------------------------------------------------------------------ #
    if has(full, "tsarnaev", "tamerlan", "dzhokhar"):
        return "suspect_identification"
    if has(full, "fbi released photos", "fbi releases images",
           "two suspects", "identification of suspects",
           "manhunt", "watertown", "suspect 1", "suspect 2"):
        return "suspect_identification"

    return None


def main():
    with open(EDITS_FILE, encoding="utf-8") as f:
        data = json.load(f)

    counts = {}
    unassigned = 0

    # Forward pass so we can diff against previous section state
    prev_sections: dict = {}

    for rev in data["revisions"]:
        subplot = classify(rev, prev_sections)
        rev["subplot"] = subplot

        # Update prev_sections
        for name, sc in rev.get("section_text_after", {}).items():
            prev_sections[name] = sc

        if subplot:
            counts[subplot] = counts.get(subplot, 0) + 1
        else:
            unassigned += 1

    with open(EDITS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print("Subplot assignments:")
    order = ["saudi_suspect", "suspect_identification", "jeff_bauman",
             "sunil_tripathi", "radicalization", "conflicting_reports"]
    for key in order:
        print(f"  {key:30s}  {counts.get(key, 0):4d}")
    print(f"  {'(unassigned)':30s}  {unassigned:4d}")
    print(f"  {'TOTAL':30s}  {len(data['revisions']):4d}")


if __name__ == "__main__":
    main()
