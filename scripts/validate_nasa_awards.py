#!/usr/bin/env python3
"""
Validate Lunara curated NASA awards JSON.

Usage (from repo root):
  python scripts/validate_nasa_awards.py
  python scripts/validate_nasa_awards.py --path data/nasa_awards.json

Exit code 0 = valid, 1 = errors.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REQUIRED_TOP = ("version", "as_of", "disclaimer", "awards")
REQUIRED_AWARD = (
    "id",
    "title",
    "agency",
    "program",
    "awardee",
    "date",
    "status",
    "themes",
    "source_url",
)
ALLOWED_STATUS = {"awarded", "completed", "delayed", "competed", "cancelled", "option"}

# Tickers that appear in Lunara AEROSPACE_TICKERS (subset check — informational)
KNOWN_TICKERS = {
    "SPCX", "RKLB", "FLY", "LUNR", "VOYG", "SPCE", "MNTS",
    "ASTS", "IRDM", "VSAT", "GSAT", "SATS", "TSAT", "GILT",
    "PL", "SPIR", "BKSY", "SATL", "MAXR",
    "MDA", "RDW", "SIDU", "YSS", "KRMN", "AVAV", "AIR", "HEI", "HXL", "TDG", "HWM",
    "BA", "LMT", "NOC", "RTX", "GD", "LHX", "KTOS", "LDOS", "CACI", "SAIC", "TXT", "HON",
    "EADSY", "ERJ", "ARKX", "UFO", "ROKT", "ITA", "XAR", "TRMB",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def validate(data: dict) -> list[str]:
    errors: list[str] = []
    for key in REQUIRED_TOP:
        if key not in data:
            errors.append(f"Missing top-level key: {key}")

    awards = data.get("awards")
    if not isinstance(awards, list) or not awards:
        errors.append("'awards' must be a non-empty list")
        return errors

    seen_ids: set[str] = set()
    for i, a in enumerate(awards):
        prefix = f"awards[{i}]"
        if not isinstance(a, dict):
            errors.append(f"{prefix}: must be an object")
            continue
        for key in REQUIRED_AWARD:
            if key not in a:
                errors.append(f"{prefix}: missing '{key}'")
        aid = a.get("id")
        if aid:
            if aid in seen_ids:
                errors.append(f"{prefix}: duplicate id '{aid}'")
            seen_ids.add(aid)
        status = a.get("status")
        if status and status not in ALLOWED_STATUS:
            errors.append(
                f"{prefix}: status '{status}' not in {sorted(ALLOWED_STATUS)}"
            )
        themes = a.get("themes")
        if themes is not None and (
            not isinstance(themes, list) or not all(isinstance(t, str) for t in themes)
        ):
            errors.append(f"{prefix}: themes must be list[str]")
        amount = a.get("amount_usd")
        if amount is not None and not isinstance(amount, (int, float)):
            errors.append(f"{prefix}: amount_usd must be number or null")
        ticker = a.get("ticker")
        if ticker is not None and ticker not in KNOWN_TICKERS:
            # Warning-as-error optional — keep soft for private/null proxies
            if ticker != "" and not isinstance(ticker, str):
                errors.append(f"{prefix}: ticker must be string or null")
        date = a.get("date")
        if date and (not isinstance(date, str) or len(date) < 8):
            errors.append(f"{prefix}: date should be ISO YYYY-MM-DD")
        url = a.get("source_url")
        if url and not str(url).startswith("http"):
            errors.append(f"{prefix}: source_url should start with http")

    return errors


def summarize(data: dict) -> None:
    awards = data.get("awards", [])
    by_program: dict[str, int] = {}
    with_ticker = 0
    for a in awards:
        prog = a.get("program") or "?"
        by_program[prog] = by_program.get(prog, 0) + 1
        if a.get("ticker"):
            with_ticker += 1
    print(f"as_of:     {data.get('as_of')}")
    print(f"awards:    {len(awards)}")
    print(f"w/ ticker: {with_ticker}")
    print("programs:  " + ", ".join(f"{k}={v}" for k, v in sorted(by_program.items())))


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Lunara NASA awards JSON")
    parser.add_argument(
        "--path",
        type=Path,
        default=None,
        help="Path to nasa_awards.json (default: data/nasa_awards.json)",
    )
    args = parser.parse_args()
    path = args.path or (repo_root() / "data" / "nasa_awards.json")
    if not path.is_file():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 1
    try:
        data = load(path)
    except json.JSONDecodeError as e:
        print(f"ERROR: invalid JSON: {e}", file=sys.stderr)
        return 1

    errors = validate(data)
    if errors:
        print(f"FAIL: {path} ({len(errors)} error(s))")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK: {path}")
    summarize(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
