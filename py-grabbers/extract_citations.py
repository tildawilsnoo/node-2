"""
Extract all citations from Wikipedia edit JSON and output:
  - citations.json      : one entry per unique source, all attributes
  - edits_with_citations.json : original JSON enhanced with citation_ids per revision

Linkage: each revision gains a "citation_ids" list whose values are
         citation_id keys in citations.json.
"""

import json
import re
import hashlib
from pathlib import Path
from collections import OrderedDict


# ---------------------------------------------------------------------------
# Wiki markup cleaner
# ---------------------------------------------------------------------------

def strip_wikimarkup(text: str | None) -> str | None:
    """
    Remove Wikipedia markup from a plain-text field:
      [[Target|Label]] -> Label
      [[Target]]       -> Target
      ''text''         -> text
      '''text'''       -> text
    Also strips unclosed [[ that result from template truncation.
    """
    if not text:
        return text
    # [[Target|Label]] -> Label
    text = re.sub(r'\[\[(?:[^\]|]+\|)?([^\]|]+)\]\]', r'\1', text)
    # Any remaining unclosed [[ or ]] fragments
    text = re.sub(r'\[\[|\]\]', '', text)
    # ''italic'' / '''bold'''
    text = re.sub(r"'{2,3}", '', text)
    return text.strip() or None


# ---------------------------------------------------------------------------
# Template parameter parser
# ---------------------------------------------------------------------------

def parse_template_params(template_str: str) -> dict[str, str]:
    """
    Parse key=value pairs from a {{cite ...}} template.
    Handles nested {{...}} by skipping them during pipe-splitting.
    """
    # Strip outer {{ }}
    inner = re.sub(r'^\{\{.*?\|', '', template_str, count=1, flags=re.DOTALL)
    inner = re.sub(r'\}\}\s*$', '', inner)

    params: dict[str, str] = {}
    depth = 0
    current = []
    segments = []

    for ch in inner:
        if ch == '{':
            depth += 1
            current.append(ch)
        elif ch == '}':
            depth -= 1
            current.append(ch)
        elif ch == '|' and depth == 0:
            segments.append(''.join(current).strip())
            current = []
        else:
            current.append(ch)
    if current:
        segments.append(''.join(current).strip())

    for seg in segments:
        if '=' in seg:
            key, _, value = seg.partition('=')
            params[key.strip().lower()] = value.strip()

    return params


def build_author_field(params: dict[str, str]) -> str | None:
    """Combine first/last/author/* fields into a single author string."""
    parts = []

    # Single author
    if params.get('last') or params.get('first'):
        last = params.get('last', '')
        first = params.get('first', '')
        name = f"{last}, {first}".strip(', ')
        if name:
            parts.append(name)
    elif params.get('author'):
        parts.append(params['author'])
    elif params.get('authors'):
        parts.append(params['authors'])

    # Numbered authors
    for i in range(1, 8):
        last = params.get(f'last{i}', '')
        first = params.get(f'first{i}', '')
        if last or first:
            name = f"{last}, {first}".strip(', ')
            if name:
                parts.append(name)

    if params.get('coauthors'):
        parts.append(params['coauthors'])

    return '; '.join(parts) if parts else None


# ---------------------------------------------------------------------------
# Single-citation parser
# ---------------------------------------------------------------------------

def parse_ref_content(content: str, ref_name: str | None) -> dict:
    """
    Parse the inner content of a <ref>…</ref> block into a structured dict.
    """
    content = content.strip()
    # Strip HTML comments (e.g. <!-- Bot generated title -->)
    content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL).strip()

    citation = {
        'source_type': None,
        'url': None,
        'title': None,
        'publisher': None,
        'work': None,
        'newspaper': None,
        'author': None,
        'date': None,
        'access_date': None,
        'location': None,
        'agency': None,
        'format': None,
        'page': None,
        'ref_name': ref_name,
        'raw_ref': content,
    }

    # ---- 1. {{cite web}} / {{cite news}} / {{Citation}} template ------------
    template_match = re.search(
        r'\{\{(?:cite\s+\w+|citation)\b.*?\}\}', content, re.IGNORECASE | re.DOTALL
    )
    template_str = template_match.group() if template_match else None

    # Fallback: template may be truncated (wikitext cut off before closing }})
    if template_str is None:
        trunc = re.search(r'\{\{(?:cite\s+\w+|citation)\b', content, re.IGNORECASE)
        if trunc:
            template_str = content[trunc.start():]

    if template_str is not None:
        cite_type_match = re.match(r'\{\{cite\s+(\w+)', template_str, re.IGNORECASE)
        if cite_type_match:
            cite_type = cite_type_match.group(1).lower()
        else:
            name_match = re.match(r'\{\{(\w+)', template_str, re.IGNORECASE)
            cite_type = name_match.group(1).lower() if name_match else 'unknown'
        params = parse_template_params(template_str)

        citation['source_type'] = f'cite_{cite_type}'
        citation['url'] = params.get('url') or None
        citation['title'] = params.get('title') or None
        citation['publisher'] = params.get('publisher') or None
        citation['work'] = strip_wikimarkup(params.get('work') or None)
        citation['newspaper'] = strip_wikimarkup(params.get('newspaper') or None)
        citation['date'] = params.get('date') or params.get('year') or None
        citation['access_date'] = (
            params.get('accessdate')
            or params.get('acccessdate')   # known typo variant
            or None
        )
        citation['location'] = params.get('location') or params.get('place') or None
        citation['agency'] = params.get('agency') or None
        citation['format'] = params.get('format') or None
        citation['page'] = params.get('page') or None
        citation['author'] = strip_wikimarkup(build_author_field(params))
        citation['title'] = strip_wikimarkup(citation['title'])
        citation['publisher'] = strip_wikimarkup(citation['publisher'])
        return citation

    # ---- 2. [URL title] wikilink style (anywhere in the content) -----------
    bracket_match = re.search(r'\[(https?://\S+)\s+([^\]]+)\]', content, re.DOTALL)
    if bracket_match:
        citation['source_type'] = 'bracketed_url'
        citation['url'] = bracket_match.group(1).strip()
        citation['title'] = bracket_match.group(2).strip() or None
        # Text outside the bracket may hold date/publisher
        outside = (content[:bracket_match.start()] + content[bracket_match.end():]).strip(' .,')
        # Strip "Retrieved ..." from the end
        retrieved_match = re.search(r',?\s*[Rr]etrieved\s+(.+)', outside)
        if retrieved_match:
            citation['access_date'] = retrieved_match.group(1).strip(' .,')
            outside = outside[:retrieved_match.start()].strip(' .,')
        # Extract a full date (e.g. "April 19, 2013") before splitting on commas
        date_match = re.search(
            r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)'
            r'\s+\d{1,2},\s*\d{4}\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|'
            r'August|September|October|November|December)\s+\d{4}\b|\b\d{4}\b',
            outside
        )
        if date_match:
            citation['date'] = date_match.group().strip()
            outside = (outside[:date_match.start()] + outside[date_match.end():]).strip(' .,')
        # Whatever remains is the publisher
        publisher = outside.strip(' .,')
        if publisher:
            citation['publisher'] = publisher
        return citation

    # ---- 3. Bare URL -----------------------------------------------------
    bare_url_match = re.match(r'^(https?://\S+)$', content.strip())
    if bare_url_match:
        citation['source_type'] = 'bare_url'
        citation['url'] = content.strip()
        return citation

    # ---- 4. Plain text (may still contain an embedded URL) ---------------
    citation['source_type'] = 'text_ref'
    url_in_text = re.search(r'https?://\S+', content)
    if url_in_text:
        citation['url'] = url_in_text.group().strip()
    return citation


# ---------------------------------------------------------------------------
# Deduplication key
# ---------------------------------------------------------------------------

def dedup_key(citation: dict) -> str:
    """Stable key used to identify duplicate citations."""
    url = citation.get('url')
    if url:
        # Normalize: strip trailing slash/whitespace, lower-case scheme+host
        url = url.strip().rstrip('/')
        return f'url::{url}'
    # Fall back to a hash of the raw content
    raw = (citation.get('raw_ref') or '').strip()
    return 'raw::' + hashlib.md5(raw.encode()).hexdigest()


def make_citation_id(key: str) -> str:
    return 'cit_' + hashlib.md5(key.encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Extract refs from wikitext
# ---------------------------------------------------------------------------

def extract_refs(wikitext: str) -> list[tuple[str | None, str]]:
    """
    Return list of (ref_name_or_None, content_str) from all <ref>…</ref> blocks.
    Self-closing <ref name="…"/> tags are skipped (they reuse a named ref).
    """
    results = []
    pattern = re.compile(
        r'<ref(?:\s+name\s*=\s*["\']?([^"\'>/\s]+)["\']?)?\s*>(.*?)</ref>',
        re.DOTALL | re.IGNORECASE,
    )
    for m in pattern.finditer(wikitext):
        ref_name = m.group(1)
        content = m.group(2).strip()
        if content:
            results.append((ref_name, content))
    return results


def extract_ref_names(wikitext: str) -> list[str]:
    """
    Return ref names from self-closing <ref name="…"/> tags.
    These back-reference named citations defined elsewhere in the article.
    """
    pattern = re.compile(
        r'<ref\s+name\s*=\s*["\']?([^"\'>/\s]+)["\']?\s*/>',
        re.IGNORECASE,
    )
    return [m.group(1) for m in pattern.finditer(wikitext)]


# ---------------------------------------------------------------------------
# Main extraction logic
# ---------------------------------------------------------------------------

def extract_citations(input_path: str) -> None:
    with open(input_path, encoding='utf-8') as f:
        data = json.load(f)

    # citation_id -> full citation dict (ordered for stable output)
    citations_by_id: dict[str, dict] = OrderedDict()
    # dedup_key -> citation_id  (for fast lookup)
    key_to_id: dict[str, str] = {}

    def get_or_create_citation(ref_name, content) -> str:
        """Register citation, return its citation_id."""
        cit = parse_ref_content(content, ref_name)
        dk = dedup_key(cit)
        if dk in key_to_id:
            return key_to_id[dk]
        cid = make_citation_id(dk)
        # Avoid (rare) hash collisions
        while cid in citations_by_id and citations_by_id[cid] != cit:
            cid += '_1'
        cit['citation_id'] = cid
        citations_by_id[cid] = cit
        key_to_id[dk] = cid
        return cid

    # name->citation_id index, built from all ref definitions across all revisions.
    name_to_id: dict[str, str] = {}

    # Pass 1: register all ref definitions and build the name index.
    for revision in data.get('revisions', []):
        for section_content in revision.get('section_text_after', {}).values():
            wikitext = section_content.get('wikitext', '')
            for ref_name, content in extract_refs(wikitext):
                cid = get_or_create_citation(ref_name, content)
                if ref_name and ref_name not in name_to_id:
                    name_to_id[ref_name] = cid

    # Pass 2: assign citation_ids per revision, resolving back-references.
    for revision in data.get('revisions', []):
        rev_citation_ids: list[str] = []
        seen_in_rev: set[str] = set()

        for section_content in revision.get('section_text_after', {}).values():
            wikitext = section_content.get('wikitext', '')
            # Inline ref definitions
            for ref_name, content in extract_refs(wikitext):
                cid = get_or_create_citation(ref_name, content)
                if cid not in seen_in_rev:
                    rev_citation_ids.append(cid)
                    seen_in_rev.add(cid)
            # Back-references resolved via the global name index
            for ref_name in extract_ref_names(wikitext):
                cid = name_to_id.get(ref_name)
                if cid and cid not in seen_in_rev:
                    rev_citation_ids.append(cid)
                    seen_in_rev.add(cid)

        revision['citation_ids'] = rev_citation_ids

    # -----------------------------------------------------------------------
    # Write citations.json
    # -----------------------------------------------------------------------
    raw_ref_index = {
        cit['raw_ref'].strip(): cid
        for cid, cit in citations_by_id.items()
        if cit.get('raw_ref', '').strip()
    }

    citations_out = {
        'article': data.get('article'),
        'total_unique_citations': len(citations_by_id),
        'ref_name_index': name_to_id,
        'raw_ref_index': raw_ref_index,
        'citations': list(citations_by_id.values()),
    }

    out_dir = Path(input_path).parent
    citations_path = out_dir / 'citations.json'
    with open(citations_path, 'w', encoding='utf-8') as f:
        json.dump(citations_out, f, indent=2, ensure_ascii=False)
    print(f'Wrote {len(citations_by_id)} unique citations → {citations_path}')

    # -----------------------------------------------------------------------
    # Write edits_with_citations.json  (original + citation_ids per revision)
    # -----------------------------------------------------------------------
    edits_path = out_dir / 'edits_with_citations.json'
    with open(edits_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'Wrote enhanced edits → {edits_path}')


if __name__ == '__main__':
    import sys

    input_file = (
        sys.argv[1]
        if len(sys.argv) > 1
        else 'boston_marathon_bombing_suspect_edits copy.json'
    )
    extract_citations(input_file)
