"""
Fetches revision IDs from Wikipedia API and adds them to boston_marathon_edits.json,
then writes an enriched version used by generate_suspects_all.py.
"""

import json, urllib.request, urllib.parse, time, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

ARTICLE = 'Boston Marathon bombing'
SOURCE = '../boston_marathon_edits.json'
OUTPUT = '../boston_marathon_edits_with_revids.json'

def fetch_revisions():
    revisions = []
    params = {
        'action': 'query',
        'prop': 'revisions',
        'titles': ARTICLE,
        'rvprop': 'ids|timestamp|user',
        'rvlimit': '500',
        'format': 'json',
    }
    base = 'https://en.wikipedia.org/w/api.php'

    while True:
        url = base + '?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={'User-Agent': 'revid-fetcher/1.0'})
        with urllib.request.urlopen(req, context=ctx) as r:
            data = json.load(r)

        pages = data['query']['pages']
        page = next(iter(pages.values()))
        revisions.extend(page.get('revisions', []))
        print(f"  fetched {len(revisions)} revisions so far...")

        if 'continue' in data:
            params.update(data['continue'])
            time.sleep(0.5)
        else:
            break

    return revisions

print("Fetching revisions from Wikipedia API...")
revisions = fetch_revisions()
print(f"Total revisions fetched: {len(revisions)}")

# build lookup: (date, time, user) -> revid
lookup = {}
for rev in revisions:
    ts = rev['timestamp']  # e.g. "2013-04-15T20:43:24Z"
    date, time_part = ts.rstrip('Z').split('T')
    key = (date, time_part, rev.get('user', ''))
    lookup[key] = rev['revid']

with open(SOURCE) as f:
    edits = json.load(f)

matched = 0
for item in edits:
    key = (item['date'], item['time'], item['user'])
    revid = lookup.get(key)
    if revid:
        item['revid'] = revid
        matched += 1

print(f"Matched {matched}/{len(edits)} edits with revision IDs")

with open(OUTPUT, 'w') as f:
    json.dump(edits, f, indent=2, ensure_ascii=False)

print(f"Wrote enriched data to {OUTPUT}")
