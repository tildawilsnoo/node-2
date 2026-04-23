#!/usr/bin/env python3
"""
Classify all edits in edits_with_citations.json into the new taxonomy.
Writes back to the same file in-place.
"""

import json, re
from datetime import datetime, timezone

INPUT_FILE = "edits_with_citations.json"

# Key story timestamps (UTC)
T_FBI_PHOTOS   = datetime(2013, 4, 18, 22, 30, tzinfo=timezone.utc)
T_MIT_SHOOTING = datetime(2013, 4, 19,  2, 48, tzinfo=timezone.utc)
T_ARREST       = datetime(2013, 4, 19, 21,  0, tzinfo=timezone.utc)
T_INITIAL_END  = datetime(2013, 4, 16,  6,  0, tzinfo=timezone.utc)

def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

def section_has(rev, *patterns):
    for s in rev.get("changed_sections", []):
        if any(p in s.lower() for p in patterns):
            return True
    return False

def extract_subsection(comment):
    """Return the /* Subsection */ name from an edit comment, lowercased."""
    m = re.search(r'/\*\s*(.+?)\s*\*/', comment)
    return m.group(1).strip().lower() if m else ""

# Subsection → category mapping
SUBSECTION_MAP = [
    (["manhunt and capture", "manhunt and captures", "mit shooting and watertown",
      "carjacking"], "manhunt"),
    (["initial identification", "initial description", "description and identification",
      "identification: dzhokhar", "identification and description",
      "identification"], "tsarnaev-identification"),
    (["backgrounds", "suspects' background", "suspects background",
      "biographical backgrounds", "suspect backgrounds",
      "suspects' family", "family"], "tsarnaev-identification"),
    (["post-arrest", "legal proceedings", "hospital interrogation", "interrogation",
      "dias kadyrbayev", "azamat tazhayakov", "robel phillipos",
      "other arrests and detentions", "other arrests",
      "other people identified", "other people arrested"], "aftermath"),
    (["arrests", "arrest"], "arrest"),
    (["false reports", "conflicting reports", "mistaken identities",
      "false alarm"], "conflicting-reports"),
    (["references", "see also"], "reference-edit"),
]

def subsection_category(sub):
    for patterns, cat in SUBSECTION_MAP:
        if any(p in sub for p in patterns):
            return cat
    return None

def classify(rev):
    comment = (rev.get("comment") or "").strip()
    cl = comment.lower()
    t = ts(rev["timestamp"])
    sub = extract_subsection(comment)

    # ── 1. Vandalism reverts ─────────────────────────────────────────────────
    if re.search(r'\b(rv|rvv|revert|reverted|vandal)\b', cl) or \
       re.match(r'undid revision \d+', cl) or \
       re.match(r'undoing\b', cl):
        return "vandalism-revert"

    # ── 2. Copy-edits (comment-based) ────────────────────────────────────────
    is_ce = bool(
        re.search(r'(?:^|[\s\/\*])ce(?:[\s\.\,]|$)', cl) or
        re.search(r'\b(grammar|typo|spelling|copyedit|copy.edit|punctuat|prose|'
                  r'wording|mosnum|mosdate|date.format|wikif|wikify|wikilink|hyphen|'
                  r'capitaliz|capitalis|space|spaces|apostrophe|comma|period|bracket)\b', cl) or
        re.match(r'^sp\b', cl)
    )

    # ── 3. Check top-level changed_sections for specific narrative sections ──
    if section_has(rev, "conflicting"):
        return "copy-edit" if is_ce else "conflicting-reports"

    if section_has(rev, "arrest", "other arrest"):
        return "copy-edit" if is_ce else "arrest"

    # ── 4. Use subsection from comment (strongest narrative signal) ──────────
    sub_cat = subsection_category(sub)

    # Investigation / Suspects subsections need timestamp context
    if sub in ("investigation", "suspects", "") and sub_cat is None:
        sub_cat = None  # handled below by timestamp

    if sub_cat and sub_cat != "reference-edit":
        return "copy-edit" if is_ce else sub_cat
    if sub_cat == "reference-edit":
        return "reference-edit"

    # ── 5. Copy-edit (now that we've done section overrides) ─────────────────
    if is_ce:
        return "copy-edit"

    # ── 6. Other editorial categories from comment ───────────────────────────
    if re.search(r'\b(image|photo|caption|\.jpg|\.png|\.svg)\b', cl) or \
       re.search(r'\bfile:', cl):
        return "image"

    if re.search(r'\b(fix ref|add ref|ref fix|dead.?link|archive|isbn)\b', cl) or \
       re.match(r'^(fix|add|update|remove|repair).*(ref|cit)', cl) or \
       re.match(r'^ref\b', cl):
        return "reference-edit"

    if re.search(r'\b(remov|delet|trim|strip)\b', cl) and \
       not re.search(r'\b(saudi|reddit|tsarnaev|victim|martin)\b', cl):
        return "remove"

    if re.search(r'\b(format|template|infobox|table|header|navbox|categor|bold|italics?)\b', cl):
        return "formatting"

    # ── 7. Comment-based story hints ─────────────────────────────────────────
    if re.search(r'\b(saudi|alharbi)\b', cl):
        return "saudi-suspect"
    if re.search(r'\b(reddit|4chan|tripathi|sunil|misidentif|vigilant)\b', cl):
        return "internet-vigilantism"
    if re.search(r'\b(tsarnaev|dzhokhar|tamerlan|chechen|kyrgyz)\b', cl):
        return "tsarnaev-identification"
    if re.search(r'\b(watertown|mit.shoot|collier|shootout|lockdown|shelter|carjack)\b', cl):
        return "manhunt"
    if re.search(r'\b(victim|casualt|martin.richard|krystle|lingzi)\b', cl):
        return "victims"
    if re.search(r'\b(obama|congress|governor|senate|white.house|deval.patrick)\b', cl):
        return "political-response"
    if re.search(r'\b(condolenc|international.react|russia|china|solidar)\b', cl):
        return "international-reaction"
    if re.search(r'\b(conflicting|incorrect|mistaken|retract|ny.?post|false.report)\b', cl):
        return "conflicting-reports"
    if re.search(r'\b(one.fund|memorial|tribute|trial|charged|indicted)\b', cl):
        return "aftermath"

    # ── 8. Timestamp fallback (for "Investigation"/"Suspects" section edits) ─
    if t < T_INITIAL_END:
        return "initial-reports"
    elif t < T_FBI_PHOTOS:
        return "investigation"
    elif t < T_MIT_SHOOTING:
        return "tsarnaev-identification"
    elif t < T_ARREST:
        return "manhunt"
    else:
        return "aftermath"


def main():
    with open(INPUT_FILE, encoding="utf-8") as f:
        data = json.load(f)

    counts = {}
    for rev in data["revisions"]:
        label = classify(rev)
        rev["auto_subplot"] = label
        rev["manual_subplot"] = None  # reset; only set when user manually tags in reviewer
        counts[label] = counts.get(label, 0) + 1

    with open(INPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Classified {len(data['revisions'])} revisions:")
    for label, n in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {label:35s} {n:4d}")

if __name__ == "__main__":
    main()
