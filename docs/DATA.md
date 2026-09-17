# Data

What the Ontario Housing Agent dataset contains, how it is built, and its
limitations. For architecture and milestones, see [PLAN.md](PLAN.md).

## Source

Raw listings come from the separate `property-scraper` project, treated as
read-only here: per-city CSVs of current listings at
`../property-scraper/data/regions/<city>/listings.csv`.

The build covers 36 Ontario cities and produces 19,356 rows after cleaning. The
published sample includes each listing's address and a link to the source
listing; listing ids, agent names, and scraped source pages are not published.

## Build

Run from this project's root:

```bash
python3 pipeline/build_dataset.py
```

The pipeline reads `../property-scraper/data/regions` by default. To point it at
another checkout, or write somewhere else:

```bash
python3 pipeline/build_dataset.py --source ../property-scraper/data/regions --out data
```

It writes:

- `data/listings.json`: the published sample, sorted city asc / price desc
- `data/market_summary.json`: per-city aggregates

## What is collected

- Current for-sale asking listings.
- 36 Ontario cities.
- 19,356 rows after dedupe and filtering.

## Cleaning rules

Applied during the build:

1. **Dedupe** by listing id; the newest `scraped_at` wins. The id itself is
   never written.
2. **Price floor**: keep rows with price >= $50,000.
3. **Ontario only**: drop rows whose address is not in Ontario.
4. **Sane beds/baths**: drop implausible counts (bounds in
   `pipeline/build_dataset.py`).
5. **Plausible sqft**: values outside 200-20,000 sqft become `null`; the row
   is kept. They are counted as `implausible sqft (nulled)` in the filter
   report.
   The low tail is land acreage: for vacant-land listings the feed renders
   acreage as "N sqft lot", so the scraper extracts acreage as interior area (a
   known 50-acre Innisfil landholding arrived as `sqft` 50). The high tail is
   commercial/non-residential floor area.
6. **Extract FSA**: the Forward Sortation Area, the first three characters of
   the postal code in the address.
7. **Emit nine fields**: `city`, `fsa`, `price`, `beds`, `baths`, `sqft`,
   `seen`, `address`, `url`. Listing ids and agent names are not written;
   scraped source pages are not published.

## Fields

| Field | Notes |
| --- | --- |
| `city` | One of the covered cities. |
| `fsa` | Forward Sortation Area, derived at build time; `null` for the 8 rows without a parseable postal code. |
| `price` | Asking price, as listed. |
| `beds` | Bedroom count. |
| `baths` | Bathroom count. |
| `sqft` | Interior area where the source lists it; `null` when missing or implausible (see cleaning rules). |
| `seen` | Date the source last saw the listing (ISO date). |
| `address` | Full address as listed, including city, ON and postal code. |
| `url` | Link to the source listing (https). |

Not published: listing ids, agent names, scraped source pages.

City lookups accept natural spellings (e.g. "St. Catharines", "Sault Ste. Marie") via normalization.

## CSV export

`GET /api/listings?format=csv` returns all 19,356 rows with the header
`city,fsa,price,beds,baths,sqft,seen,address,url`. Values are quoted per
RFC 4180 when they contain commas, quotes, or line breaks, and cells that start
with `=`, `+`, `-`, `@`, tab, or carriage return get a leading `'` so
spreadsheets treat them as text. The document is serialized once per server
process and served with a one-hour browser / one-day CDN cache.

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

Refresh is automated by `scripts/ontario_refresh.sh`, run every 24 hours by a
launchd agent (`scripts/install_refresh_schedule.sh` installs it; log at
`output/refresh.log`). It starts a scrape refresh when the newest region CSV is
older than 7 days, or when a previous run left regions unfinished
(pending/partial/challenged), at most one start per 24 hours. Once a scrape has settled with newer CSVs it rebuilds the
snapshot, runs the pipeline tests and vitest suite, and commits and pushes
`data/listings.json` + `data/market_summary.json` to `origin`; Vercel
auto-deploys and the agent serves the new snapshot after deploy.

Manual fallback:

```bash
python3 pipeline/build_dataset.py --source ../property-scraper/data/regions
```

The build overwrites `data/listings.json` and `data/market_summary.json` (the
scheduled run commits them). A scrape may be interrupted by a Zillow challenge;
a human clears it in the attach Chrome and the next run resumes the queue.

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
- **Staleness.** The snapshot refreshes automatically as scrape data advances
  (checked every 24 hours), but a Zillow challenge or an interrupted queue can
  leave it a few days old until a human clears the challenge.
- **Duplicate rows.** Dedupe is by listing id only. 620 rows still repeat another
  row on the seven non-address fields (city, FSA, price, beds, baths, sqft,
  seen) while differing in address/url, which can slightly overstate
  identical-looking segments. This is intentional.

## Terms and attribution

- Research sample of public for-sale listing data collected from Zillow. Addresses
  and source links are published; listing ids, agent names, and scraped source
  pages are not.
- Not affiliated with, endorsed by, or sponsored by Zillow.
- For informational use only. Not financial, legal, or real-estate advice.
