import requests
import json
from datetime import datetime, timedelta

API_URL = "https://en.wikipedia.org/w/api.php"
TITLE = "Boston Marathon bombing"
OUTPUT_FILE = "boston_marathon_bombing_edits.json"
HEADERS = {"User-Agent": "wiki-edit-fetcher/1.0 (research script)"}


def get_first_revision_timestamp():
    params = {
        "action": "query",
        "prop": "revisions",
        "titles": TITLE,
        "rvlimit": 1,
        "rvdir": "newer",
        "rvprop": "timestamp",
        "format": "json",
    }
    response = requests.get(API_URL, params=params, headers=HEADERS)
    response.raise_for_status()
    data = response.json()
    page = next(iter(data["query"]["pages"].values()))
    return page["revisions"][0]["timestamp"]


def fetch_revisions(start_ts, end_ts):
    all_revisions = []
    rvcontinue = None
    end_dt = datetime.fromisoformat(end_ts.replace("Z", "+00:00"))

    while True:
        params = {
            "action": "query",
            "prop": "revisions",
            "titles": TITLE,
            "rvlimit": 500,
            "rvdir": "newer",
            "rvstart": start_ts,
            "rvprop": "ids|timestamp|user|userid|size|comment|flags",
            "format": "json",
        }
        if rvcontinue:
            params["rvcontinue"] = rvcontinue

        response = requests.get(API_URL, params=params, headers=HEADERS)
        response.raise_for_status()
        data = response.json()

        page = next(iter(data["query"]["pages"].values()))
        revisions = page.get("revisions", [])

        done = False
        for rev in revisions:
            rev_dt = datetime.fromisoformat(rev["timestamp"].replace("Z", "+00:00"))
            if rev_dt > end_dt:
                done = True
                break
            all_revisions.append(rev)

        print(f"  Fetched {len(all_revisions)} revisions so far...")

        if done or "continue" not in data:
            break

        rvcontinue = data["continue"]["rvcontinue"]

    return all_revisions


def main():
    print(f"Looking up first edit to: {TITLE}")
    start_ts = get_first_revision_timestamp()

    start_dt = datetime.fromisoformat(start_ts.replace("Z", "+00:00"))
    end_dt = start_dt + timedelta(days=30)
    end_ts = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"First edit:      {start_ts}")
    print(f"Fetching until:  {end_ts} (30 days later)")

    revisions = fetch_revisions(start_ts, end_ts)

    output = {
        "article": TITLE,
        "period_start": start_ts,
        "period_end": end_ts,
        "total_revisions": len(revisions),
        "revisions": revisions,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(revisions)} revisions to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()