"""
Convert boston_marathon_bombing_revisions_target_sections.json
→ edits_with_citations.json + citations.json

Input: array of revisions, each with full article wikitext.
Output: same format as the original edits_with_citations.json pipeline,
        with changed_sections, section_text_after, and citation_ids.
"""

import json
import re
import hashlib
import mwparserfromhell
from pathlib import Path
from collections import OrderedDict

INPUT_FILE  = Path(__file__).parent.parent / "boston_marathon_bombing_revisions_target_sections.json"
EDITS_FILE  = Path(__file__).parent.parent / "edits_with_citations.json"
CITS_FILE   = Path(__file__).parent.parent / "citations.json"

# Sections to track (top-level == sections)
TARGET_SECTIONS = {
    "Investigation",
    "Suspects",
    "Arrest", "Arrests",
    "Other arrests", "Other arrests and detentions",
    "Conflicting reports",
}

SECTION_RE = re.compile(r"^(={2,})\s*(.+?)\s*\1\s*$")


# ---------------------------------------------------------------------------
# Section extraction — hierarchical (includes sub-sections)
# ---------------------------------------------------------------------------

def extract_target_sections(wikitext: str) -> dict[str, str]:
    """Return {section_name: wikitext_content} for every target section,
    including all nested sub-sections inside it."""
    sections: dict[str, str] = {}
    current_name: str | None = None
    current_level: int | None = None
    current_lines: list[str] = []

    for line in wikitext.split("\n"):
        m = SECTION_RE.match(line)
        if m:
            level = len(m.group(1))
            heading = m.group(2).strip()

            if current_name is not None and level <= current_level:
                # Peer or parent section — close what we have
                sections[current_name] = "\n".join(current_lines)
                current_name = None
                current_lines = []

            if heading in TARGET_SECTIONS:
                current_name = heading
                current_level = level
                current_lines = []
            elif current_name is not None:
                # Sub-section inside a target section — keep the header line
                current_lines.append(line)
        elif current_name is not None:
            current_lines.append(line)

    if current_name is not None:
        sections[current_name] = "\n".join(current_lines)

    return sections


def find_changed(prev: dict, curr: dict) -> list[str]:
    return [n for n in set(prev) | set(curr) if prev.get(n) != curr.get(n)]


def wikitext_to_plaintext(wt: str) -> str:
    """Strip refs and wiki markup; return plain text."""
    parsed = mwparserfromhell.parse(wt)
    for tag in list(parsed.filter_tags(matches=lambda t: str(t.tag).lower() == "ref")):
        try:
            parsed.remove(tag)
        except ValueError:
            pass
    return parsed.strip_code().strip()


# ---------------------------------------------------------------------------
# Citation helpers (ported from extract_citations.py)
# ---------------------------------------------------------------------------

def strip_wikimarkup(text: str | None) -> str | None:
    if not text:
        return text
    text = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]|]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[|\]\]", "", text)
    text = re.sub(r"'{2,3}", "", text)
    return text.strip() or None


def parse_template_params(template_str: str) -> dict[str, str]:
    inner = re.sub(r"^\{\{.*?\|", "", template_str, count=1, flags=re.DOTALL)
    inner = re.sub(r"\}\}\s*$", "", inner)
    params: dict[str, str] = {}
    depth, current, segments = 0, [], []
    for ch in inner:
        if ch == "{":
            depth += 1; current.append(ch)
        elif ch == "}":
            depth -= 1; current.append(ch)
        elif ch == "|" and depth == 0:
            segments.append("".join(current).strip()); current = []
        else:
            current.append(ch)
    if current:
        segments.append("".join(current).strip())
    for seg in segments:
        if "=" in seg:
            k, _, v = seg.partition("=")
            params[k.strip().lower()] = v.strip()
    return params


def build_author_field(params: dict[str, str]) -> str | None:
    parts = []
    if params.get("last") or params.get("first"):
        name = f"{params.get('last','')}, {params.get('first','')}".strip(", ")
        if name: parts.append(name)
    elif params.get("author"):
        parts.append(params["author"])
    elif params.get("authors"):
        parts.append(params["authors"])
    for i in range(1, 8):
        l, f = params.get(f"last{i}", ""), params.get(f"first{i}", "")
        if l or f:
            name = f"{l}, {f}".strip(", ")
            if name: parts.append(name)
    if params.get("coauthors"):
        parts.append(params["coauthors"])
    return "; ".join(parts) if parts else None


def parse_ref_content(content: str, ref_name: str | None) -> dict:
    content = content.strip()
    content = re.sub(r"<!--.*?-->", "", content, flags=re.DOTALL).strip()
    cit = dict(source_type=None, url=None, title=None, publisher=None,
               work=None, newspaper=None, author=None, date=None,
               access_date=None, location=None, agency=None, format=None,
               page=None, ref_name=ref_name, raw_ref=content)

    tmpl = re.search(r"\{\{(?:cite\s+\w+|citation)\b.*?\}\}", content,
                     re.IGNORECASE | re.DOTALL)
    tstr = tmpl.group() if tmpl else None
    if tstr is None:
        trunc = re.search(r"\{\{(?:cite\s+\w+|citation)\b", content, re.IGNORECASE)
        if trunc:
            tstr = content[trunc.start():]

    if tstr is not None:
        cm = re.match(r"\{\{cite\s+(\w+)", tstr, re.IGNORECASE)
        cite_type = cm.group(1).lower() if cm else (
            re.match(r"\{\{(\w+)", tstr, re.IGNORECASE).group(1).lower()
            if re.match(r"\{\{(\w+)", tstr, re.IGNORECASE) else "unknown"
        )
        p = parse_template_params(tstr)
        cit["source_type"] = f"cite_{cite_type}"
        cit["url"]         = p.get("url") or None
        cit["title"]       = strip_wikimarkup(p.get("title") or None)
        cit["publisher"]   = strip_wikimarkup(p.get("publisher") or None)
        cit["work"]        = strip_wikimarkup(p.get("work") or None)
        cit["newspaper"]   = strip_wikimarkup(p.get("newspaper") or None)
        cit["date"]        = p.get("date") or p.get("year") or None
        cit["access_date"] = p.get("accessdate") or p.get("acccessdate") or None
        cit["location"]    = p.get("location") or p.get("place") or None
        cit["agency"]      = p.get("agency") or None
        cit["format"]      = p.get("format") or None
        cit["page"]        = p.get("page") or None
        cit["author"]      = strip_wikimarkup(build_author_field(p))
        return cit

    bm = re.search(r"\[(https?://\S+)\s+([^\]]+)\]", content, re.DOTALL)
    if bm:
        cit["source_type"] = "bracketed_url"
        cit["url"] = bm.group(1).strip()
        cit["title"] = bm.group(2).strip() or None
        outside = (content[:bm.start()] + content[bm.end():]).strip(" .,")
        rm = re.search(r",?\s*[Rr]etrieved\s+(.+)", outside)
        if rm:
            cit["access_date"] = rm.group(1).strip(" .,")
            outside = outside[:rm.start()].strip(" .,")
        dm = re.search(
            r"\b(?:January|February|March|April|May|June|July|August|September|"
            r"October|November|December)\s+\d{1,2},\s*\d{4}\b|"
            r"\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|"
            r"September|October|November|December)\s+\d{4}\b|\b\d{4}\b", outside)
        if dm:
            cit["date"] = dm.group().strip()
            outside = (outside[:dm.start()] + outside[dm.end():]).strip(" .,")
        if outside.strip(" .,"):
            cit["publisher"] = outside.strip(" .,")
        return cit

    if re.match(r"^(https?://\S+)$", content.strip()):
        cit["source_type"] = "bare_url"
        cit["url"] = content.strip()
        return cit

    cit["source_type"] = "text_ref"
    um = re.search(r"https?://\S+", content)
    if um:
        cit["url"] = um.group().strip()
    return cit


def dedup_key(cit: dict) -> str:
    url = cit.get("url")
    if url:
        return f"url::{url.strip().rstrip('/')}"
    return "raw::" + hashlib.md5((cit.get("raw_ref") or "").strip().encode()).hexdigest()


def make_citation_id(key: str) -> str:
    return "cit_" + hashlib.md5(key.encode()).hexdigest()[:12]


def extract_refs(wikitext: str) -> list[tuple[str | None, str]]:
    pattern = re.compile(
        r"<ref(?:\s+name\s*=\s*[\"']?([^\"'>/\s]+)[\"']?)?\s*>(.*?)</ref>",
        re.DOTALL | re.IGNORECASE)
    return [(m.group(1), m.group(2).strip())
            for m in pattern.finditer(wikitext) if m.group(2).strip()]


def extract_ref_names(wikitext: str) -> list[str]:
    pattern = re.compile(
        r"<ref\s+name\s*=\s*[\"']?([^\"'>/\s]+)[\"']?\s*/>", re.IGNORECASE)
    return [m.group(1) for m in pattern.finditer(wikitext)]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Reading {INPUT_FILE} …")
    with open(INPUT_FILE, encoding="utf-8") as f:
        raw = json.load(f)

    print(f"  {len(raw)} revisions in input file.")

    # ---- Pass 1: extract sections, detect changes, build revision list ----
    revisions_out: list[dict] = []
    prev_sections: dict[str, str] = {}

    for entry in raw:
        wikitext = entry.get("wikitext", "")
        curr_sections = extract_target_sections(wikitext)
        changed = find_changed(prev_sections, curr_sections)

        if changed:
            section_text_after: dict[str, dict] = {}
            for name in changed:
                sec_wt = curr_sections.get(name, "")
                plaintext = wikitext_to_plaintext(sec_wt)
                section_text_after[name] = {"wikitext": sec_wt, "plaintext": plaintext}

            rev: dict = {
                "revid":    entry["revid"],
                "parentid": entry["parentid"],
                "user":     entry["user"],
                "userid":   entry["userid"],
                "timestamp": entry["timestamp"],
                "comment":  entry.get("comment", ""),
                "changed_sections":  changed,
                "section_text_after": section_text_after,
            }
            if "minor" in entry:
                rev["minor"] = entry["minor"]
            if "size" in entry:
                rev["size"] = entry["size"]
            revisions_out.append(rev)

        prev_sections = curr_sections

    print(f"  {len(revisions_out)} revisions with changed target sections.")

    # ---- Pass 2: citation extraction ----
    citations_by_id: dict[str, dict] = OrderedDict()
    key_to_id: dict[str, str] = {}

    def get_or_create(ref_name, content) -> str:
        cit = parse_ref_content(content, ref_name)
        dk = dedup_key(cit)
        if dk in key_to_id:
            return key_to_id[dk]
        cid = make_citation_id(dk)
        while cid in citations_by_id and citations_by_id[cid] != cit:
            cid += "_1"
        cit["citation_id"] = cid
        citations_by_id[cid] = cit
        key_to_id[dk] = cid
        return cid

    name_to_id: dict[str, str] = {}

    # First sub-pass: register ALL ref definitions from full article wikitext
    # (not just target sections) so back-references like <ref name="foo"/>
    # defined in untracked sections can still be resolved.
    print("  Scanning full article wikitext for ref definitions…")
    for entry in raw:
        for ref_name, content in extract_refs(entry.get("wikitext", "")):
            cid = get_or_create(ref_name, content)
            if ref_name and ref_name not in name_to_id:
                name_to_id[ref_name] = cid

    # Second sub-pass: assign citation_ids per revision
    for rev in revisions_out:
        ids: list[str] = []
        seen: set[str] = set()
        for sc in rev["section_text_after"].values():
            wt = sc["wikitext"]
            for ref_name, content in extract_refs(wt):
                cid = get_or_create(ref_name, content)
                if cid not in seen:
                    ids.append(cid); seen.add(cid)
            for ref_name in extract_ref_names(wt):
                cid = name_to_id.get(ref_name)
                if cid and cid not in seen:
                    ids.append(cid); seen.add(cid)
        rev["citation_ids"] = ids

    print(f"  {len(citations_by_id)} unique citations found.")

    # ---- Write citations.json ----
    raw_ref_index = {
        cit["raw_ref"].strip(): cid
        for cid, cit in citations_by_id.items()
        if cit.get("raw_ref", "").strip()
    }
    citations_out = {
        "article": "Boston Marathon bombing",
        "total_unique_citations": len(citations_by_id),
        "ref_name_index": name_to_id,
        "raw_ref_index": raw_ref_index,
        "citations": list(citations_by_id.values()),
    }
    with open(CITS_FILE, "w", encoding="utf-8") as f:
        json.dump(citations_out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(citations_by_id)} citations → {CITS_FILE}")

    # ---- Write edits_with_citations.json ----
    period_start = raw[0]["timestamp"]  if raw else ""
    period_end   = raw[-1]["timestamp"] if raw else ""
    output = {
        "article": "Boston Marathon bombing",
        "period_start": period_start,
        "period_end": period_end,
        "total_revisions_in_period": len(raw),
        "total_suspect_section_edits": len(revisions_out),
        "revisions": revisions_out,
    }
    with open(EDITS_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(revisions_out)} revisions → {EDITS_FILE}")


if __name__ == "__main__":
    main()
