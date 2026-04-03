import json, re, difflib

SOURCE = '../boston_marathon_edits_with_revids.json'
OUTPUT = '../suspects_section_edits_all.json'

SUSPECT_HEADINGS = {
    '## Suspect',
    '## Suspects',
    '## Suspected perpetrators',
    '## Perpetrators',
    '## Attackers',
    '## Suspect Backgrounds',
    '## Suspects background',
    "## Suspects' background",
    "## Suspects' family",
    '## Suspect photos released',
    '## Description and identification of suspects',
    '## Identification of suspects: Dzhokhar and Tamerlan Tsarnaev',
    '## Identification: Dzhokhar and Tamerlan Tsarnaev',
    '## FBI releases images of suspects',
    '## Saudi suspect detained',
    '## False suspect',
    '## Error in suspect identification',
    '## Wrong suspect identification',
    '## People mistakenly identified as suspects',
    '## Other people identified or arrested as suspects',
    '## Other people arrested',
    '## Arrest',
    '## Arrests',
    '## Other arrests',
    '## Other arrests and detentions',
    '## Other people arrested',
    '## False reports of arrests',
    '## Manhunt and capture',
    '## Manhunt and captures',
    '## MIT shooting',
    '## MIT Shooting',
    '## MIT shooting and Watertown incident',
    '## MIT shooting and Watertown incidents',
    '## MIT shooting and arrest',
    '## MIT shooting and suspect arrest',
    '## Criminal proceedings',
    '## Post-arrest',
    '## Criticism of manhunt',
    '## Criticism of the manhunt',
    '## Critical reactions to the manhunt',
}

def extract_sections(text):
    """Return dict of {heading: full section text} for all matching headings."""
    if not text:
        return {}
    sections = {}
    current_heading = None
    current_lines = []

    for line in text.split('\n'):
        if line.startswith('## '):
            if current_heading is not None and current_heading in SUSPECT_HEADINGS:
                sections[current_heading] = '\n'.join(current_lines).strip()
            current_heading = line.rstrip()
            current_lines = [line]
        elif current_heading is not None:
            current_lines.append(line)

    # capture last section
    if current_heading is not None and current_heading in SUSPECT_HEADINGS:
        sections[current_heading] = '\n'.join(current_lines).strip()

    return sections

def compute_diff(old_text, new_text):
    old = old_text or ''
    new = new_text or ''
    ops = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag == 'equal':
            continue
        if tag in ('replace', 'delete'):
            ops.append({'op': 'delete', 'text': old[i1:i2], 'offset': i1})
        if tag in ('replace', 'insert'):
            ops.append({'op': 'insert', 'text': new[j1:j2], 'offset': j1})
    return ops

with open(SOURCE) as f:
    source = json.load(f)

# prev_state: {heading: text} of each section as of the last edit
prev_state = {}
edits = []

for item in source:
    current_sections = extract_sections(item.get('text_after_edit'))

    # find all headings that changed
    all_headings = set(prev_state) | set(current_sections)
    changed_sections = []

    for heading in sorted(all_headings):
        old = prev_state.get(heading)
        new = current_sections.get(heading)

        if old == new:
            continue

        if old is None:
            change_type = 'created'
        elif new is None:
            change_type = 'removed'
        else:
            change_type = 'modified'

        changed_sections.append({
            'heading': heading,
            'change_type': change_type,
            'edit_after': new,
            'edit_diff': compute_diff(old, new),
        })

    if changed_sections:
        edits.append({
            'date': item['date'],
            'time': item['time'],
            'user': item['user'],
            'edit_comment': item.get('edit_comment', ''),
            'revid': item.get('revid'),
            'sections': changed_sections,
        })

    prev_state = current_sections

result = {'topic': 'suspects', 'edits': edits}

with open(OUTPUT, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f"Done: {len(edits)} edits written to {OUTPUT}")
heading_counts = {}
for e in edits:
    for s in e['sections']:
        heading_counts[s['heading']] = heading_counts.get(s['heading'], 0) + 1
for h, c in sorted(heading_counts.items(), key=lambda x: -x[1]):
    print(f"  {c:4d}  {h}")
