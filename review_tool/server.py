#!/usr/bin/env python3
"""
Review tool server.
Run: python3 review_tool/server.py
Then open http://localhost:8765
"""

import json, os, difflib
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

_here     = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(_here, '..', 'edits_with_citations.json')

with open(DATA_FILE) as f:
    doc = json.load(f)

revisions = doc['revisions']
rev_index = {r['revid']: i for i, r in enumerate(revisions)}  # revid → list index

SECTION_ORDER = [
    'Investigation', 'Suspects', 'Arrest', 'Arrests',
    'Other arrests', 'Other arrests and detentions', 'Conflicting reports',
]

# Forward pass: build a running section snapshot for every revision
_state = {}
for _rev in revisions:
    for _name, _val in (_rev.get('section_text_after') or {}).items():
        _state[_name] = _val
    _rev['_snapshot'] = dict(_state)


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


def get_payload(idx):
    rev       = revisions[idx]
    snapshot  = rev.get('_snapshot', {})
    prev_snap = revisions[idx - 1].get('_snapshot', {}) if idx > 0 else {}
    changed   = set(rev.get('changed_sections') or [])

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

    tagged = sum(1 for r in revisions if r.get('manual_subplot') is not None)

    seen_subplots = []
    for r in revisions:
        s = r.get('manual_subplot')
        if s and s not in seen_subplots:
            seen_subplots.append(s)

    return {
        'idx':              idx,
        'total':            len(revisions),
        'tagged':           tagged,
        'revid':            rev['revid'],
        'parentid':         rev['parentid'],
        'user':             rev.get('user', ''),
        'timestamp':        rev.get('timestamp', ''),
        'comment':          rev.get('comment', ''),
        'changed_sections': rev.get('changed_sections', []),
        'citation_ids':     rev.get('citation_ids', []),
        'subplot':          rev.get('subplot'),
        'auto_subplot':     rev.get('auto_subplot'),
        'manual_subplot':   rev.get('manual_subplot'),
        'notable':          rev.get('notable', False),
        'sections':             sections,
        'snapshot_sections':    snapshot_sections,
        'all_subplots':         seen_subplots,
    }


def first_untagged():
    for i, r in enumerate(revisions):
        if r.get('manual_subplot') is None:
            return i
    return len(revisions)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            p  = urlparse(self.path)
            qs = parse_qs(p.query)

            if p.path in ('/', '/index.html'):
                self._file(os.path.join(_here, 'index.html'), 'text/html; charset=utf-8')

            elif p.path == '/api/revision':
                idx = int(qs.get('idx', ['0'])[0])
                idx = max(0, min(idx, len(revisions) - 1))
                self._json(get_payload(idx))

            elif p.path == '/api/first_untagged':
                self._json({'idx': first_untagged()})

            elif p.path == '/api/subplots':
                seen = []
                for r in revisions:
                    s = r.get('manual_subplot')
                    if s and s not in seen:
                        seen.append(s)
                self._json(seen)

            else:
                self._json({'error': 'not found'}, 404)

        except Exception as e:
            import traceback; traceback.print_exc()
            self._json({'error': str(e)}, 500)

    def do_POST(self):
        try:
            n    = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(n))

            if self.path == '/api/rename':
                old, new = body['old'], body['new']
                count = 0
                for r in revisions:
                    if r.get('manual_subplot') == old:
                        r['manual_subplot'] = new
                        count += 1
                save()
                self._json({'ok': True, 'updated': count})

            elif self.path == '/api/notable':
                i = rev_index.get(body['revid'])
                if i is None:
                    self._json({'error': 'revid not found'}, 404); return
                revisions[i]['notable'] = body.get('notable', False)
                save()
                self._json({'ok': True})

            elif self.path == '/api/assign':
                i = rev_index.get(body['revid'])
                if i is None:
                    self._json({'error': 'revid not found'}, 404); return
                revisions[i]['manual_subplot'] = body.get('manual_subplot')
                save()
                self._json({'ok': True})

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
    port   = 8765
    HTTPServer.allow_reuse_address = True
    server = HTTPServer(('127.0.0.1', port), Handler)
    print(f'http://localhost:{port}')
    print(f'{len(revisions)} revisions  ·  {sum(1 for r in revisions if r.get("manual_subplot") is not None)} already tagged')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
