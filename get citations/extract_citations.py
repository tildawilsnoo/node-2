import json
import re


def parse_template_fields(content):
    """Parse key=value fields out of a wikitext template like {{cite web|url=...|title=...}}."""
    fields = {}
    # Strip outer {{ ... }}
    inner = re.sub(r"^\{\{[^|]+\|?", "", content.strip())
    inner = re.sub(r"\}\}$", "", inner)

    # Split on pipe, but not pipes inside nested {{ }} or [[ ]]
    depth = 0
    current = []
    parts = []
    for ch in inner:
        if ch in ("{", "["):
            depth += 1
        elif ch in ("}", "]"):
            depth -= 1
        if ch == "|" and depth == 0:
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    if current:
        parts.append("".join(current).strip())

    for part in parts:
        if "=" in part:
            key, _, val = part.partition("=")
            fields[key.strip().lower()] = val.strip()

    return fields


def extract_url_from_wikilink(text):
    """Extract URL and title from [url title] wikilink syntax."""
    m = re.match(r"\[(\S+)\s*(.*?)\]?$", text.strip())
    if m:
        return m.group(1), m.group(2).strip() or None
    return None, None


def normalize(ref_name, content):
    content = content.strip()
    # Strip accidental nested <ref> tags (malformed wikitext)
    content = re.sub(r"^<ref[^>]*>", "", content).strip()
    content = re.sub(r"</ref>$", "", content).strip()

    result = {
        "ref_name": ref_name,
        "title": None,
        "url": None,
        "publisher": None,
        "date": None,
        "access_date": None,
        "author": None,
        "raw": content,
    }

    # --- Template citations: {{cite web}}, {{cite news}}, {{Citation}} ---
    if re.match(r"\{\{cit", content, re.IGNORECASE):
        f = parse_template_fields(content)

        result["url"] = f.get("url")
        result["title"] = f.get("title")
        result["access_date"] = f.get("accessdate") or f.get("access-date")

        # Publisher: prefer newspaper/work (publication name) over publisher (company)
        result["publisher"] = (
            f.get("newspaper") or f.get("work") or f.get("publisher")
            or f.get("website") or f.get("agency")
        )

        # Date: prefer date, fall back to year+month or year alone
        date = f.get("date")
        if not date and f.get("year"):
            date = f.get("month", "") + (" " if f.get("month") else "") + f["year"]
        result["date"] = date

        # Author: prefer explicit author field, then build from last/first
        author = f.get("author") or f.get("authors") or f.get("coauthors")
        if not author:
            parts = []
            for suffix in ("", "1", "2", "3"):
                last = f.get(f"last{suffix}") or f.get(f"last") if suffix == "" else f.get(f"last{suffix}")
                first = f.get(f"first{suffix}") or f.get(f"first") if suffix == "" else f.get(f"first{suffix}")
                if last or first:
                    name_parts = [x for x in [first, last] if x]
                    parts.append(" ".join(name_parts))
            if parts:
                author = "; ".join(parts)
        result["author"] = author

        return result

    # --- Bare wikilink: [url title] or [url] ---
    if content.startswith("["):
        url, title = extract_url_from_wikilink(content)
        result["url"] = url
        result["title"] = title
        return result

    # --- Bare URL ---
    if re.match(r"https?://", content):
        result["url"] = content.split()[0]
        return result

    # --- Plain text (may contain an inline [url title] link) ---
    m = re.search(r"\[(https?://\S+)\s+([^\]]+)\]", content)
    if m:
        result["url"] = m.group(1)
        result["title"] = m.group(2).strip()
    # Try to extract publisher from trailing text (e.g. "... ABC News, April 19")
    result["title"] = result["title"] or content[:200]

    return result


# ── Load raw citations ──────────────────────────────────────────────────────

with open("boston_marathon_bombing_suspect_edits.json") as f:
    data = json.load(f)

named_refs = {}
bare_refs = set()

for rev in data["revisions"]:
    for section, content in rev.get("section_text_after", {}).items():
        wikitext = content.get("wikitext", "")

        for m in re.finditer(r'<ref\s+name\s*=\s*"?([^">/\s]+)"?\s*>(.*?)</ref>', wikitext, re.DOTALL):
            name = m.group(1).strip()
            body = m.group(2).strip()
            if name not in named_refs and body:
                named_refs[name] = body

        for m in re.finditer(r"<ref\s*>(.*?)</ref>", wikitext, re.DOTALL):
            body = m.group(1).strip()
            if body:
                bare_refs.add(body)

# ── Normalize ───────────────────────────────────────────────────────────────

citations = []

for name in sorted(named_refs):
    citations.append(normalize(name, named_refs[name]))

for content in sorted(bare_refs):
    citations.append(normalize(None, content))

# ── Write output ────────────────────────────────────────────────────────────

output = {
    "article": data["article"],
    "total_citations": len(citations),
    "named_citations": len(named_refs),
    "bare_citations": len(bare_refs),
    "citations": citations,
}

with open("citations.json", "w") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"Done. {len(named_refs)} named + {len(bare_refs)} bare = {len(citations)} total unique citations.")
print("Written to citations.json")
