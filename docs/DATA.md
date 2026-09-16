# Data

What the Ontario Housing Agent dataset contains, how it is built, and its
limitations. For architecture and milestones, see [PLAN.md](PLAN.md).

## Source

Raw listings come from the separate `property-scraper` project, treated as
read-only here: per-city CSVs of current listings at
`../property-scraper/data/regions/<city>/listings.csv`.

The build covers 36 Ontario cities and produces roughly 20,000 rows after
cleaning. The published sample contains no addresses, URLs, agent names, or
listing ids.

## Build

Run from this project's root:

```bash
python3 pipeline/build_dataset.py
```

The pipeline reads `../property-scraper/data/regions` by default. To point it at
another checkout:

```bash
python3 pipeline/build_dataset.py --source ../property-scraper/data/regions
```

It writes:

- `data/listings.json` — sanitized listings
- `data/market_summary.json` — per-city aggregates

## Local enriched mode

`--enriched-out` adds a local-only copy of the same kept rows with `listing_id`,
`url`, and `address` reattached, for click-through while developing:

```bash
python3 pipeline/build_dataset.py --enriched-out output/listings_enriched.json
```

The row set and the 7 sanitized fields are identical to `data/listings.json`;
the file is expected under `output/` (gitignored) and must never be tracked or
deployed. Set `ENRICHED_DATA=1` to load it (missing file = warning plus
sanitized fallback); unset, the app uses the tracked sanitized data.

## What is collected

- Current for-sale asking listings.
- 36 Ontario cities.
- Roughly 20,000 rows after dedupe and filtering.

## Cleaning rules

Applied during the build:

1. **Dedupe** by listing id.
2. **Price floor** — keep rows with price >= $50,000.
3. **Ontario only** — drop rows whose address is not in Ontario.
4. **Sane beds/baths** — drop implausible counts (bounds in
   `pipeline/build_dataset.py`).
5. **Plausible sqft** — values outside 200-20,000 sqft become `null`; the row
   is kept. They are counted as `implausible sqft (nulled)` in the filter
   report.
   The low tail is land acreage: for vacant-land listings the feed renders
   acreage as "N sqft lot", so the scraper extracts acreage as interior area (a
   known 50-acre Innisfil landholding arrived as `sqft` 50). The high tail is
   commercial/non-residential floor area.
6. **Extract FSA** — the Forward Sortation Area, the first three characters of
   the postal code.
7. **Drop identifiers** — address, URL, agent, listing id, and source page are
   removed before writing.

## Fields

Kept:

| Field | Notes |
| --- | --- |
| `city` | One of the covered cities. |
| `fsa` | Forward Sortation Area, derived at build time. |
| `price` | Asking price, as listed. |
| `beds` | Bedroom count. |
| `baths` | Bathroom count. |
| `sqft` | Interior area where the source lists it; `null` when missing or implausible (see cleaning rules). |
| `seen` | Last-seen marker from the source data. |

Dropped: address, URL, agent, listing id, source page.

City lookups accept natural spellings (e.g. "St. Catharines", "Sault Ste. Marie") via normalization.

## Square footage

`sqft` is missing for most rows and coverage varies by city. The plausibility
rule above nulled 76 values in the current build, 12 of them zeros. 20.0% of
kept rows carry `sqft` (3,875 of 19,356), down from 20.4% (3,939 positive
values) before the rule; non-null values now range from 236 to 12,749.

`data/market_summary.json` reports a per-city `medianSqft` over plausible values
only, and `null` when a city has fewer than 10 sqft samples. 14 of 36 cities
fall below that bar: ajax, barrie, belleville, kingston, markham, newmarket,
ottawa, peterborough, richmond-hill, sarnia, sault-ste-marie, sudbury,
thunder-bay, whitby.

The rule also repairs medians that acreage values had dragged down: the
kawartha-lakes median moved from 58 to 2,015, and innisfil from 2,206 to 3,648.

## Refresh

Refresh is manual for now:

1. Let `property-scraper` update its per-city CSVs (separate project; out of
   scope here).
2. Rebuild:

   ```bash
   python3 pipeline/build_dataset.py --source ../property-scraper/data/regions
   ```

3. The build overwrites `data/listings.json` and `data/market_summary.json`.

A weekly refresh is planned.

## Limitations

- **Asking prices only.** No sold prices, so the data says nothing about
  transaction values or market direction.
- **Sparse square footage.** `sqft` is present for about 20% of rows and coverage
  is uneven by city; per-city medians are suppressed below 10 samples and
  implausible values (lot acreage, commercial floor area) are excluded. Treat
  per-square-foot comparisons with care.
- **Single snapshot.** The current build keeps no history, so price changes and
  price cuts cannot be computed. Adding that would require snapshot archiving in
  `property-scraper` (planned).
- **Staleness.** Refreshes are manual, so the snapshot ages between builds.
- **Identical rows.** Dedupe is by listing id only, so condo/duplicate listings
  that are identical in every published field (city, FSA, price, beds, baths,
  sqft, seen) remain as separate rows. In the current build, 620 rows repeat
  another row this way, which can slightly overstate identical-looking segments.
  This is intentional.

## Terms and attribution

- Sanitized research sample of public for-sale listing data collected from
  Zillow. No addresses, URLs, agent names, or listing ids are published.
- Not affiliated with, endorsed by, or sponsored by Zillow.
- For informational use only. Not financial, legal, or real-estate advice.
