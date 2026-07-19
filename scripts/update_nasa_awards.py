#!/usr/bin/env python3
"""
Maintain Lunara's curated NASA awards dataset.

Default: validate, sort by date (newest first), rewrite JSON with stable formatting.
Optional: pull NASA news RSS titles that look contract-related and print *candidates*
for manual curation (never auto-merge into the canonical file without --apply-candidates
and human review — apply only appends stub records marked status=competed for review).

Usage (from repo root):
  python scripts/update_nasa_awards.py
  python scripts/update_nasa_awards.py --as-of 2026-07-19
  python scripts/update_nasa_awards.py --candidates
  python scripts/update_nasa_awards.py --candidates --apply-candidates   # careful

No live procurement scraping. Fail-open network: candidates are optional.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

# Local validate import
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_nasa_awards import validate, load, repo_root  # noqa: E402

NASA_NEWS_RSS = "https://www.nasa.gov/rss/dyn/breaking_news.rss"
CONTRACT_HINTS = re.compile(
    r"\b(award|awards|contract|contracts|selected|CLPS|Artemis|SBIR|STTR|"
    r"task order|procurement|landing system|Gateway)\b",
    re.I,
)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    path.write_text(text, encoding="utf-8")


def sort_awards(awards: list[dict]) -> list[dict]:
    def key(a: dict) -> str:
        return a.get("date") or "0000-00-00"

    return sorted(awards, key=key, reverse=True)


def fetch_rss_candidates(limit: int = 20) -> list[dict[str, Any]]:
    """Best-effort NASA breaking-news RSS filter. Returns stub-like dicts."""
    try:
        import feedparser  # type: ignore
    except ImportError:
        feedparser = None

    req = Request(
        NASA_NEWS_RSS,
        headers={"User-Agent": "LUNARA-awards-updater/1.0 (educational)"},
    )
    try:
        with urlopen(req, timeout=12) as resp:
            raw = resp.read()
    except Exception as e:
        print(f"[WARN] RSS fetch failed (fail-open): {e}", file=sys.stderr)
        return []

    candidates: list[dict[str, Any]] = []
    if feedparser is not None:
        parsed = feedparser.parse(raw)
        for entry in parsed.entries[:80]:
            title = (entry.get("title") or "").strip()
            link = (entry.get("link") or "").strip()
            if not title or not CONTRACT_HINTS.search(title):
                continue
            published = entry.get("published") or entry.get("updated") or ""
            date = _guess_date(published)
            candidates.append(_stub(title, link, date))
            if len(candidates) >= limit:
                break
        return candidates

    # Minimal fallback without feedparser: title tags
    text = raw.decode("utf-8", errors="replace")
    titles = re.findall(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", text, re.I | re.S)
    links = re.findall(r"<link>(.*?)</link>", text, re.I | re.S)
    # skip channel title
    for i, title in enumerate(titles[1:], start=1):
        title = re.sub(r"\s+", " ", title).strip()
        if not CONTRACT_HINTS.search(title):
            continue
        link = links[i].strip() if i < len(links) else NASA_NEWS_RSS
        candidates.append(_stub(title, link, datetime.now(timezone.utc).strftime("%Y-%m-%d")))
        if len(candidates) >= limit:
            break
    return candidates


def _guess_date(published: str) -> str:
    # Try common RSS date forms; fall back to today UTC
    for fmt in (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(published[:31].strip(), fmt).strftime("%Y-%m-%d")
        except Exception:
            continue
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _stub(title: str, link: str, date: str) -> dict[str, Any]:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48]
    return {
        "id": f"candidate-{slug or 'item'}",
        "title": title,
        "agency": "NASA",
        "program": "other",
        "awardee": "TBD — curate manually",
        "ticker": None,
        "amount_usd": None,
        "amount_note": "candidate from NASA RSS — not verified",
        "date": date,
        "status": "competed",
        "themes": ["candidate"],
        "source_url": link or "https://www.nasa.gov/",
        "notes": "Auto-candidate only. Verify award, awardee, amount, and program before promoting.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Update/sort Lunara NASA awards JSON")
    parser.add_argument(
        "--path",
        type=Path,
        default=None,
        help="Path to nasa_awards.json",
    )
    parser.add_argument(
        "--as-of",
        type=str,
        default=None,
        help="Set as_of date (YYYY-MM-DD). Default: leave unchanged unless --touch-as-of",
    )
    parser.add_argument(
        "--touch-as-of",
        action="store_true",
        help="Set as_of to today UTC",
    )
    parser.add_argument(
        "--candidates",
        action="store_true",
        help="Fetch NASA news RSS and print contract-like candidates",
    )
    parser.add_argument(
        "--apply-candidates",
        action="store_true",
        help="Append RSS candidates not already present by title (still needs human curation)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write file",
    )
    args = parser.parse_args()
    path = args.path or (repo_root() / "data" / "nasa_awards.json")

    if not path.is_file():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 1

    data = load(path)
    errors = validate(data)
    if errors:
        print("FAIL: fix validation errors before update:")
        for e in errors:
            print(f"  - {e}")
        return 1

    awards = list(data.get("awards") or [])
    existing_titles = { (a.get("title") or "").strip().lower() for a in awards }
    existing_ids = { a.get("id") for a in awards }

    if args.candidates or args.apply_candidates:
        cands = fetch_rss_candidates()
        print(f"Candidates from NASA RSS: {len(cands)}")
        for c in cands:
            print(f"  • {c['date']}  {c['title'][:90]}")
            print(f"    {c['source_url']}")
        if args.apply_candidates:
            added = 0
            for c in cands:
                t = (c.get("title") or "").strip().lower()
                if t in existing_titles:
                    continue
                cid = c["id"]
                n = 1
                while cid in existing_ids:
                    n += 1
                    cid = f"{c['id']}-{n}"
                c["id"] = cid
                awards.append(c)
                existing_titles.add(t)
                existing_ids.add(cid)
                added += 1
            print(f"Appended {added} candidate stub(s) for manual curation.")

    awards = sort_awards(awards)
    data["awards"] = awards

    if args.as_of:
        data["as_of"] = args.as_of
    elif args.touch_as_of:
        data["as_of"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Re-validate after mutations
    errors = validate(data)
    if errors:
        print("FAIL after update:")
        for e in errors:
            print(f"  - {e}")
        return 1

    if args.dry_run:
        print(f"DRY-RUN: would write {len(awards)} awards to {path}")
        return 0

    write_json(path, data)
    print(f"Wrote {len(awards)} awards → {path}")
    print(f"as_of: {data.get('as_of')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
