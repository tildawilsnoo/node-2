import json
import re
import requests
import time
import mwparserfromhell

API_URL = "https://en.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "wiki-edit-fetcher/1.0 (research script)"}
INPUT_FILE = "boston_marathon_bombing_edits.json"
OUTPUT_FILE = "boston_marathon_bombing_suspect_edits.json"

TARGET_SECTIONS = {
    'Suspect',
    'Suspects',
    'Suspected perpetrators',
    'Perpetrators',
    'Attackers',
    'Suspect Backgrounds',
    'Suspects background',
    "Suspects' background",
    "Suspects' family",
    'Suspect photos released',
    'Description and identification of suspects',
    'Identification of suspects: Dzhokhar and Tamerlan Tsarnaev',
    'Identification: Dzhokhar and Tamerlan Tsarnaev',
    'FBI releases images of suspects',
    'Saudi suspect detained',
    'False suspect',
    'Error in suspect identification',
    'Wrong suspect identification',
    'People mistakenly identified as suspects',
    'Other people identified or arrested as suspects',
    'Other people arrested',
    'Arrest',
    'Arrests',
    'Other arrests',
    'Other arrests and detentions',
    'False reports of arrests',
    'Manhunt and capture',
    'Manhunt and captures',
    'MIT shooting',
    'MIT Shooting',
    'MIT shooting and Watertown incident',
    'MIT shooting and Watertown incidents',
    'MIT shooting and arrest',
    'MIT shooting and suspect arrest',
    'Criminal proceedings',
    'Post-arrest',
    'Criticism of manhunt',
    'Criticism of the manhunt',
    'Critical reactions to the manhunt',
}

SECTION_RE = re.compile(r'^(={2,})\s*(.+?)\s*\1\s*$')


def fetch_wikitext_batch(rev_ids):
    """Fetch wikitext for up to 50 revision IDs at once."""
    params = {
        "action": "query",
        "prop": "revisions",
        "revids": "|".join(str(r) for r in rev_ids),
        "rvslots": "main",
        "rvprop": "content|ids",
        "format": "json",
    }
    response = requests.get(API_URL, params=params, headers=HEADERS)
    response.raise_for_status()
    data = response.json()

    contents = {}
    for page in data["query"]["pages"].values():
        for rev in page.get("revisions", []):
            rid = rev["revid"]
            # Support both slot-based and legacy content format
            if "slots" in rev:
                text = rev["slots"].get("main", {}).get("*", "")
            else:
                text = rev.get("*", "")
            contents[rid] = text
    return contents


def fetch_all_wikitext(rev_ids):
    """Fetch wikitext for all revision IDs, batched 50 at a time."""
    all_contents = {}
    total = len(rev_ids)
    for i in range(0, total, 50):
        batch = rev_ids[i:i + 50]
        print(f"  Fetching wikitext {i + 1}–{min(i + 50, total)} of {total}...")
        all_contents.update(fetch_wikitext_batch(batch))
        time.sleep(0.2)
    return all_contents


def extract_target_sections(wikitext):
    """Return a dict of {section_name: content} for all target sections present."""
    sections = {}
    current_name = None
    current_lines = []

    for line in wikitext.split('\n'):
        m = SECTION_RE.match(line)
        if m:
            if current_name is not None:
                sections[current_name] = '\n'.join(current_lines)
            heading = m.group(2).strip()
            current_name = heading if heading in TARGET_SECTIONS else None
            current_lines = []
        elif current_name is not None:
            current_lines.append(line)

    if current_name is not None:
        sections[current_name] = '\n'.join(current_lines)

    return sections


def changed_sections(prev, curr):
    """Return list of section names that were added, removed, or modified."""
    all_names = set(prev) | set(curr)
    return [name for name in all_names if prev.get(name) != curr.get(name)]


def main():
    with open(INPUT_FILE, encoding="utf-8") as f:
        data = json.load(f)

    revisions = data["revisions"]
    print(f"Loaded {len(revisions)} revisions from {INPUT_FILE}")

    rev_ids = [rev["revid"] for rev in revisions]
    print(f"Fetching wikitext for all revisions...")
    wikitext_by_id = fetch_all_wikitext(rev_ids)

    print("Comparing adjacent revisions for target section changes...")
    filtered = []
    prev_sections = {}  # empty before first revision (treat as blank page)

    for rev in revisions:
        rid = rev["revid"]
        text = wikitext_by_id.get(rid, "")
        curr_sections = extract_target_sections(text)
        changed = changed_sections(prev_sections, curr_sections)
        if changed:
            section_text_after = {}
            for name in changed:
                wikitext = curr_sections.get(name, "")
                plaintext = mwparserfromhell.parse(wikitext).strip_code().strip()
                section_text_after[name] = {
                    "wikitext": wikitext,
                    "plaintext": plaintext,
                }
            filtered.append({
                **rev,
                "changed_sections": changed,
                "section_text_after": section_text_after,
            })
        prev_sections = curr_sections

    output = {
        "article": data["article"],
        "period_start": data["period_start"],
        "period_end": data["period_end"],
        "total_revisions_in_period": data["total_revisions"],
        "total_suspect_section_edits": len(filtered),
        "revisions": filtered,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nFound {len(filtered)} revisions touching target sections.")
    print(f"Saved to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()