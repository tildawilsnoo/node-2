#!/usr/bin/env python3
"""
Suspect review tool server — works only through INCLUDE-marked edits.
Run: python3 review_tool_suspect/server.py
Then open http://localhost:8766
"""

import json, os, difflib
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

_here     = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(_here, '..', 'edits_with_citations.json')

with open(DATA_FILE) as f:
    doc = json.load(f)

all_revisions = doc['revisions']
rev_index     = {r['revid']: i for i, r in enumerate(all_revisions)}
include_revs  = [r for r in all_revisions if r.get('manual_subplot') == 'INCLUDE']

SECTION_ORDER = [
    'Investigation', 'Suspects', 'Arrest', 'Arrests',
    'Other arrests', 'Other arrests and detentions', 'Conflicting reports',
]

# Forward pass: build a running section snapshot for every revision
_state = {}
for _rev in all_revisions:
    for _name, _val in (_rev.get('section_text_after') or {}).items():
        _state[_name] = _val
    _rev['_snapshot'] = dict(_state)

# One-time migration: clear all old tagging fields
OLD_FIELDS = (
    'suspect_identified', 'suspect_tag', 'mentioned_identified',
    'mentioned_tag', 'mentioned_tags',
    'tags_under_suspicion', 'tags_mentioned', 'tags_official_suspect',
)
_changed = False
for r in all_revisions:
    for f in OLD_FIELDS:
        if f in r:
            del r[f]
            _changed = True
if _changed:
    with open(DATA_FILE, 'w') as f:
        json.dump(doc, f, indent=2)
    print('Migrated: cleared old tagging fields for clean slate')


def save():
    with open(DATA_FILE, 'w') as f:
        json.dump(doc, f, indent=2)


def compute_diff(before, after):
    bl = (before or '').splitlines()
    al = (after or '').splitlines()
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, bl, al, autojunk=False).get_opcodes():
        if op == 'equal':
            for l in bl[i1:i2]: out.append({'t': '=', 'v': l})
        elif op == 'delete':
            for l in bl[i1:i2]: out.append({'t': '-', 'v': l})
        elif op == 'insert':
            for l in al[j1:j2]: out.append({'t': '+', 'v': l})
        elif op == 'replace':
            for l in bl[i1:i2]: out.append({'t': '-', 'v': l})
            for l in al[j1:j2]: out.append({'t': '+', 'v': l})
    return out


def get_prev_snapshot(global_idx):
    if global_idx == 0:
        return {}
    return all_revisions[global_idx - 1].get('_snapshot', {})


def collect_saudi_tags():
    seen = []
    for r in include_revs:
        t = r.get('saudi_suspect_tag')
        if t and t not in seen:
            seen.append(t)
    return seen


def get_payload(include_idx):
    rev        = include_revs[include_idx]
    global_idx = rev_index[rev['revid']]
    snapshot   = rev.get('_snapshot', {})
    prev_snap  = get_prev_snapshot(global_idx)
    changed    = set(rev.get('changed_sections') or [])

    # Full ordered snapshot for display
    seen = set()
    snapshot_sections = []
    for name in SECTION_ORDER:
        if name in snapshot:
            txt = ((snapshot[name] or {}).get('plaintext') or '').strip()
            if txt:
                snapshot_sections.append({'name': name, 'text': txt, 'changed': name in changed})
                seen.add(name)
    for name, val in snapshot.items():
        if name not in seen:
            txt = ((val or {}).get('plaintext') or '').strip()
            if txt:
                snapshot_sections.append({'name': name, 'text': txt, 'changed': name in changed})

    # Diffs for changed sections only
    sections = {}
    for sec in changed:
        after_txt  = ((snapshot.get(sec) or {}).get('plaintext') or '')
        before_txt = ((prev_snap.get(sec) or {}).get('plaintext') or None)
        sections[sec] = {
            'diff':     compute_diff(before_txt or '', after_txt),
            'has_prev': before_txt is not None,
        }

    reviewed = sum(1 for r in include_revs if r.get('saudi_suspect_level') is not None)

    return {
        'idx':                include_idx,
        'total':              len(include_revs),
        'reviewed':           reviewed,
        'revid':              rev['revid'],
        'user':               rev.get('user', ''),
        'timestamp':          rev.get('timestamp', ''),
        'comment':            rev.get('comment', ''),
        'changed_sections':   rev.get('changed_sections', []),
        'citation_ids':       rev.get('citation_ids', []),
        'subplot':            rev.get('subplot'),
        'saudi_suspect_level': rev.get('saudi_suspect_level'),
        'saudi_suspect_tag':   rev.get('saudi_suspect_tag'),
        'all_saudi_tags':      collect_saudi_tags(),
        'sections':            sections,
        'snapshot_sections':   snapshot_sections,
    }


def first_unreviewed():
    for i, r in enumerate(include_revs):
        if r.get('saudi_suspect_level') is None:
            return i
    return len(include_revs)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            p  = urlparse(self.path)
            qs = parse_qs(p.query)

            if p.path in ('/', '/index.html'):
                self._file(os.path.join(_here, 'index.html'), 'text/html; charset=utf-8')

            elif p.path == '/api/revision':
                idx = int(qs.get('idx', ['0'])[0])
                idx = max(0, min(idx, len(include_revs) - 1))
                self._json(get_payload(idx))

            elif p.path == '/api/first_unreviewed':
                self._json({'idx': first_unreviewed()})

            else:
                self._json({'error': 'not found'}, 404)

        except Exception as e:
            import traceback; traceback.print_exc()
            self._json({'error': str(e)}, 500)

    def do_POST(self):
        try:
            n    = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(n))

            if self.path == '/api/assign':
                i = rev_index.get(body['revid'])
                if i is None:
                    self._json({'error': 'revid not found'}, 404); return
                all_revisions[i]['saudi_suspect_level'] = body.get('saudi_suspect_level')
                all_revisions[i]['saudi_suspect_tag']   = body.get('saudi_suspect_tag')
                save()
                self._json({'ok': True})

            elif self.path == '/api/remove_include':
                i = rev_index.get(body['revid'])
                if i is None:
                    self._json({'error': 'revid not found'}, 404); return
                all_revisions[i]['manual_subplot'] = None
                for f in ('saudi_suspect_level', 'saudi_suspect_tag'):
                    all_revisions[i].pop(f, None)
                save()
                inc_idx = next((j for j, r in enumerate(include_revs) if r['revid'] == body['revid']), None)
                if inc_idx is not None:
                    include_revs.pop(inc_idx)
                new_idx = max(0, min(inc_idx if inc_idx is not None else 0, len(include_revs) - 1))
                self._json({'ok': True, 'new_idx': new_idx, 'new_total': len(include_revs)})

            else:
                self._json({'error': 'not found'}, 404)

        except Exception as e:
            import traceback; traceback.print_exc()
            self._json({'error': str(e)}, 500)

    def _file(self, path, ctype):
        try:
            data = open(path, 'rb').read()
        except FileNotFoundError:
            self._json({'error': 'file not found'}, 404); return
        self._respond(200, ctype, data)

    def _json(self, obj, status=200):
        self._respond(status, 'application/json', json.dumps(obj).encode())

    def _respond(self, status, ctype, data):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', len(data))
        self.send_header('Connection', 'close')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_): pass


if __name__ == '__main__':
    port = 8766
    HTTPServer.allow_reuse_address = True
    server = HTTPServer(('127.0.0.1', port), Handler)
    print(f'http://localhost:{port}')
    reviewed = sum(1 for r in include_revs if r.get('saudi_suspect_level') is not None)
    print(f'{len(include_revs)} INCLUDE revisions  ·  {reviewed} already reviewed')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
