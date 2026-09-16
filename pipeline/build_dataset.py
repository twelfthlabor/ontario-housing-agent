#!/usr/bin/env python3
"""Build the sanitized Ontario listings dataset and market summary.

Reads raw scrape output (one listings.csv per region directory) and writes:

  data/listings.json        sanitized rows, sorted city asc / price desc
  data/market_summary.json  per-city statistics for the UI

The raw scrape tree is treated as strictly read-only. Standard library only.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Resolved relative to the repo root so the pipeline carries no machine paths;
# pass --source to read from anywhere else.
DEFAULT_SOURCE = Path("../property-scraper/data/regions")
DEFAULT_OUT = Path("data")
MIN_PRICE = 50_000
MIN_BEDS = 1
MAX_BEDS = 12
# Residential interiors outside these bounds are treated as implausible and
# nulled. The low tail is land/lot acreage that Zillow's cards render as
# "N sqft lot"; the high tail is commercial/non-residential floor area.
MIN_SQFT = 200
MAX_SQFT = 20_000
# Median sqft is only reported for cities with enough samples to be stable.
MIN_SQFT_SAMPLES = 10
SOURCE_LABEL = "zillow research sample"
BED_BUCKETS = ("1", "2", "3", "4", "5+")

FSA_RE = re.compile(r"ON\s+([A-Z]\d[A-Z])")
DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")

REQUIRED_HEADERS = ("listing_id", "address")


def parse_money(value: str | None) -> float | None:
    """Parse '$1,288,000' style values. Returns None when unparseable."""
    if value is None:
        return None
    text = value.strip().replace("$", "").replace(",", "").replace(" ", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def parse_optional_int(value: str | None, lo: int, hi: int) -> tuple[bool, int | None]:
    """Parse a nullable numeric field.

    Returns (ok, value). Empty is valid and maps to None; unparseable or
    out-of-range values return ok=False so the row can be dropped.
    """
    if value is None or value.strip() == "":
        return True, None
    try:
        number = float(value.strip().replace(",", ""))
    except ValueError:
        return False, None
    if not math.isfinite(number) or number < lo or number > hi:
        return False, None
    return True, int(math.floor(number + 0.5))


def parse_sqft(value: str | None) -> int | None:
    """Raw integer parse of the sqft cell; None when absent/unparseable."""
    if value is None or value.strip() == "":
        return None
    try:
        number = float(value.strip().replace(",", ""))
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return int(math.floor(number + 0.5))


def is_plausible_sqft(value: int) -> bool:
    return MIN_SQFT <= value <= MAX_SQFT


def extract_fsa(address: str) -> str | None:
    """Pull the FSA (first 3 chars of the postal code) from '..., ON M4N 2G7'."""
    match = FSA_RE.search(address.upper())
    return match.group(1) if match else None


def is_ontario(address: str) -> bool:
    return ", ON" in address.upper()


def parse_timestamp(value: str | None) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp


def seen_date(value: str | None) -> str:
    text = (value or "").strip()
    stamp = parse_timestamp(text)
    if stamp is not None:
        return stamp.date().isoformat()
    if DATE_PREFIX_RE.match(text):
        return text[:10]
    return ""


def should_replace(
    cand_ts: datetime | None,
    cand_order: int,
    cur_ts: datetime | None,
    cur_order: int,
) -> bool:
    """Newest timestamp wins; ties or unparseable timestamps fall back to encounter order."""
    if cand_ts is not None and cur_ts is not None and cand_ts != cur_ts:
        return cand_ts > cur_ts
    return cand_order > cur_order


def city_from_dir(name: str) -> str:
    return name[:-3] if name.endswith("-on") else name


def median(sorted_values: list[float]) -> float | int | None:
    count = len(sorted_values)
    if count == 0:
        return None
    mid = count // 2
    if count % 2:
        return _number(sorted_values[mid])
    return _number((sorted_values[mid - 1] + sorted_values[mid]) / 2)


def quartiles(sorted_values: list[float]) -> tuple[float | int | None, float | int | None]:
    """Median of the lower / upper half; the median itself is excluded for odd counts."""
    if not sorted_values:
        return None, None
    mid = median(sorted_values)
    count = len(sorted_values)
    lower = sorted_values[: count // 2]
    upper = sorted_values[(count + 1) // 2 :]
    q1 = median(lower) if lower else mid
    q3 = median(upper) if upper else mid
    return q1, q3


def round_half_up(value: float, digits: int) -> float:
    factor = 10**digits
    return math.floor(value * factor + 0.5) / factor


def _number(value: float | int | None) -> float | int | None:
    """Keep JSON clean: integral floats become ints."""
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def bed_matches(beds: int | None, bucket: str) -> bool:
    if beds is None:
        return False
    if bucket == "5+":
        return beds >= 5
    return beds == int(bucket)


def read_csv_rows(path: Path, stats: dict) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            return rows
        header = [name.strip() for name in header]
        if any(name not in header for name in REQUIRED_HEADERS):
            stats["bad_headers"].append(str(path))
            for _ in reader:
                stats["rows_read"] += 1
                stats["malformed"] += 1
            return rows
        index = {name: position for position, name in enumerate(header)}
        try:
            for fields in reader:
                stats["rows_read"] += 1
                if len(fields) != len(header):
                    stats["malformed"] += 1
                    continue
                rows.append({name: fields[position] for name, position in index.items()})
        except csv.Error:
            stats["malformed"] += 1
    return rows


def dedupe(source: Path) -> tuple[dict[str, tuple], dict, list[Path]]:
    stats = {
        "rows_read": 0,
        "malformed": 0,
        "duplicate": 0,
        "unique": 0,
        "bad_headers": [],
    }
    records: dict[str, tuple] = {}
    csv_paths = sorted(source.glob("*/listings.csv"))
    order = 0
    for csv_path in csv_paths:
        city = city_from_dir(csv_path.parent.name)
        for row in read_csv_rows(csv_path, stats):
            listing_id = (row.get("listing_id") or "").strip()
            if not listing_id:
                stats["malformed"] += 1
                continue
            order += 1
            timestamp = parse_timestamp(row.get("scraped_at"))
            current = records.get(listing_id)
            if current is not None:
                stats["duplicate"] += 1
                if not should_replace(timestamp, order, current[0], current[1]):
                    continue
            records[listing_id] = (timestamp, order, city, row)
    stats["unique"] = len(records)
    return records, stats, csv_paths


def transform(records: dict[str, tuple]) -> tuple[list[dict], dict[str, int], dict[str, int]]:
    drops = {"non_on": 0, "price_low": 0, "price_bad": 0, "beds_bad": 0}
    nulled = {"sqft_implausible": 0}
    listings: list[dict] = []
    for _timestamp, _order, city, row in records.values():
        address = row.get("address") or ""
        if not is_ontario(address):
            drops["non_on"] += 1
            continue
        price = parse_money(row.get("price"))
        if price is None:
            drops["price_bad"] += 1
            continue
        if price < MIN_PRICE:
            drops["price_low"] += 1
            continue
        beds_ok, beds = parse_optional_int(row.get("beds"), MIN_BEDS, MAX_BEDS)
        baths_ok, baths = parse_optional_int(row.get("baths"), MIN_BEDS, MAX_BEDS)
        if not beds_ok or not baths_ok:
            drops["beds_bad"] += 1
            continue
        sqft = parse_sqft(row.get("sqft"))
        if sqft is not None and not is_plausible_sqft(sqft):
            nulled["sqft_implausible"] += 1
            sqft = None
        listings.append(
            {
                "city": city,
                "fsa": extract_fsa(address),
                "price": int(math.floor(price + 0.5)),
                "beds": beds,
                "baths": baths,
                "sqft": sqft,
                "seen": seen_date(row.get("scraped_at")),
            }
        )
    listings.sort(
        key=lambda item: (
            item["city"],
            -item["price"],
            item["fsa"] or "",
            item["seen"],
            item["beds"] or 0,
            item["baths"] or 0,
            item["sqft"] or 0,
        )
    )
    return listings, drops, nulled


def build_summary(listings: list[dict], generated_at: str) -> dict:
    by_city: dict[str, list[dict]] = {}
    for row in listings:
        by_city.setdefault(row["city"], []).append(row)

    cities: dict[str, dict] = {}
    for city in sorted(by_city):
        rows = by_city[city]
        prices = sorted(row["price"] for row in rows)
        sqfts = sorted(row["sqft"] for row in rows if row["sqft"] is not None)
        q1, q3 = quartiles(prices)
        median_by_beds = {
            bucket: median(sorted(row["price"] for row in rows if bed_matches(row["beds"], bucket)))
            for bucket in BED_BUCKETS
        }
        share_under = sum(1 for row in rows if row["price"] < 1_000_000) / len(rows)
        cities[city] = {
            "count": len(rows),
            "medianPrice": median(prices),
            "q1Price": q1,
            "q3Price": q3,
            "medianByBeds": median_by_beds,
            "shareUnder1M": _number(round_half_up(share_under, 3)),
            "medianSqft": median(sqfts) if len(sqfts) >= MIN_SQFT_SAMPLES else None,
            "updated": max((row["seen"] for row in rows), default=""),
        }

    return {
        "generated_at": generated_at,
        "source": SOURCE_LABEL,
        "totals": {"rows": len(listings), "cities": len(cities)},
        "cities": cities,
    }


def generated_timestamp() -> str:
    epoch = os.environ.get("SOURCE_DATE_EPOCH", "").strip()
    if epoch.isdigit():
        stamp = datetime.fromtimestamp(int(epoch), tz=timezone.utc)
    else:
        stamp = datetime.now(timezone.utc)
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path: Path, payload) -> None:
    indent = None if path.name == "listings.json" else 2
    separators = (",", ":") if indent is None else None
    text = json.dumps(payload, indent=indent, separators=separators, ensure_ascii=False)
    path.write_text(text + "\n", encoding="utf-8")


def print_report(
    stats: dict,
    drops: dict,
    nulled: dict,
    listings: list[dict],
    source: Path,
    out: Path,
) -> None:
    cities = sorted({row["city"] for row in listings})
    print("Filter report")
    print(f"  source: {source}")
    print(f"  rows read: {stats['rows_read']}")
    print(f"  unique listing_ids: {stats['unique']}")
    print(f"  kept: {len(listings)}")
    print(f"  malformed rows: {stats['malformed']}")
    print(f"  duplicate listing_id: {stats['duplicate']}")
    print(f"  non-ON address: {drops['non_on']}")
    print(f"  price below 50000: {drops['price_low']}")
    print(f"  unparseable price: {drops['price_bad']}")
    print(f"  invalid beds/baths: {drops['beds_bad']}")
    print(f"  implausible sqft (nulled): {nulled['sqft_implausible']}")
    print(f"  cities: {len(cities)}")
    if stats["bad_headers"]:
        print(f"  skipped files with unexpected headers: {', '.join(stats['bad_headers'])}")
    print(f"  wrote: {out / 'listings.json'}")
    print(f"  wrote: {out / 'market_summary.json'}")


def build(source: Path, out: Path) -> tuple[list[dict], dict, dict, dict]:
    records, stats, csv_paths = dedupe(source)
    listings, drops, nulled = transform(records)

    if stats["unique"] != len(listings) + sum(drops.values()):
        raise RuntimeError(
            "filter accounting mismatch: "
            f"unique={stats['unique']} kept={len(listings)} drops={drops}"
        )
    if stats["rows_read"] != stats["unique"] + stats["malformed"] + stats["duplicate"]:
        raise RuntimeError(
            "row accounting mismatch: "
            f"rows_read={stats['rows_read']} unique={stats['unique']} "
            f"malformed={stats['malformed']} duplicate={stats['duplicate']}"
        )

    summary = build_summary(listings, generated_timestamp())
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "listings.json", listings)
    write_json(out / "market_summary.json", summary)
    print_report(stats, drops, nulled, listings, source, out)
    return listings, summary, stats, drops


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build sanitized listings + market summary")
    parser.add_argument("--source", default=str(DEFAULT_SOURCE))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args(argv)

    source = Path(args.source).expanduser()
    out = Path(args.out).expanduser()

    if not source.is_dir():
        print(f"error: source directory not found: {source}", file=sys.stderr)
        return 2
    if not sorted(source.glob("*/listings.csv")):
        print(f"error: no */listings.csv under {source}; refusing to write outputs", file=sys.stderr)
        return 2

    build(source, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
