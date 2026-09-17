# Project status: 2026-09-16

## Assessment

M3 is live at https://ontario-housing-agent.vercel.app (Vercel Hobby, project
scope `cse-lover`, `GROQ_API_KEY` as a hidden project secret), CI is green, and
Vercel auto-deploys on push. This round published the current dataset as nine
fields (19,356 rows, including address and source URL) and removed the local
enriched mode, then landed answer-quality work: listing cards with address and a
"View listing" link, a sample-size line, FSA narrowing, shareable atlas URL
state, a Data tab with CSV export, cache replay of display events, a
clarification rule for incomplete questions, and an eval scorer redesign. The
full live gate passed 32/32 on the redesigned 32-case suite (tool 1.00, numeric
1.00, refusal 1.00). Local verification: 116 vitest tests, 19 pipeline tests,
clean `tsc`/build, independent UI checks on desktop and mobile, and a security
sweep with no findings beyond the intended public listing fields.

The design is appropriate for this small snapshot demo. Keep the JSON dataset
and deterministic tools; adding a database now would not resolve answer quality.
The read-only sibling `property-scraper` supplies 36 city CSVs. The published
sample contains 19,356 listings, and tool statistics match the generated summary
for every city.

Eval scoring remains heuristic: refusal scoring is wording-sensitive and a live
run is one sample; R09's bare "sample" pattern and the sub-10k exemption in the
ungrounded-number rule are known soft spots; multi-turn coverage is still
missing. The code is PolyForm Noncommercial 1.0.0 licensed (research project).

## Work completed

This round (2026-09-16):

- Dataset: `pipeline/build_dataset.py` now emits nine fields per row
  (`city,fsa,price,beds,baths,sqft,seen,address,url`). Dedupe is still by listing
  id, which is never written. The local enriched mode was removed: no
  `ENRICHED_DATA`, no `--enriched-out`, no `output/listings_enriched.json`, and
  no tracing-exclusion config.
- Listing cards in the agent panel: up to six cards per search result, each
  with price, beds/baths/sqft, FSA, address, and an https "View listing" link
  (`target="_blank" rel="noopener noreferrer"`), plus a "Based on N sample
  listings" line.
- FSA narrowing: `search_listings` takes an optional `fsa` and `city_snapshot`
  accepts `{city, fsa}`. Full postal codes reduce to the leading 3-character FSA
  ("M6P 1A1" -> "M6P"); rows without an FSA are excluded from scoped results.
- Shareable URL state: city, compare pair, sort, price ceiling, tab, and view
  are mirrored into the URL and restored on load; `max` snaps to the slider's
  50k step.
- Data tab plus `/api/listings`: a per-city table (default limit 100, cap 200)
  and a full CSV export (`?format=csv`, 19,356 rows, RFC 4180 quoting,
  formula-injection prefix, serialized once per process).
- Standalone cache entries store the display events, so a repeated question
  replays `cached -> tool -> tool_result -> text -> done` and still shows cards,
  chips, and the basis line.
- The agent asks one short question when a required detail (for example the
  city) is missing instead of declining; any decline must name the specific
  limitation.
- Eval suite: 32 golden cases (10 tool choice, 10 numeric, 12 scope refusals).
  Scoring uses per-case phrase patterns plus a structural refusal rule (decline
  marker within 100 characters of a per-case limitation subject, either order),
  strict per-case forbid patterns, and ungrounded-number checks. Tool choice
  passes when any tool event in the turn matches the expected tool and args;
  answers that are only a tool-limit or budget notice fail.

Earlier on 2026-09-16:

- Live eval gate passed 30/30 on the older 30-case suite (tool 1.00, numeric
  1.00, refusal 1.00). Same-day runs at 25/30, then 31/32 and 30/32 after the
  suite grew to 32, exposed the scorer's wording sensitivity and drove the
  scorer and prompt fixes.
- Cache and eval hardening: standalone-only caching, no caching after partial
  provider failure, exact bedroom/limit scoring, tool-derived numeric ground
  truth.
- Optional Gemini fallback updated to `gemini-2.5-flash-lite`; provider output
  capped at 512 tokens per call.
- Two atlas label collisions found by visual verification were fixed.
- Initial commit pushed; CI ran green and the Vercel Hobby production deploy
  went live.

## Verification

- `MOCK_LLM=1 npm test` passes 116 tests in 7 files; `python3 -m unittest
  discover -s pipeline/tests -v` passes 19 tests. `npx tsc --noEmit` and
  `npm run build` are clean (routes: `/`, `/api/chat`, `/api/listings`).
- A pipeline rebuild to a temp directory with a fixed `SOURCE_DATE_EPOCH`
  reproduced 19,356 rows across 36 cities, with the same filter counts (76
  implausible sqft nulled).
- Full live suite (2026-09-16): 32/32 cases, tool_accuracy 1.00,
  numeric_accuracy 1.00, refusal_accuracy 1.00, `quality_gate_passed: true`.
  Evidence copy: `output/evidence/2026-09-16-live-gate-4.json` (gitignored).
  Earlier attempts that day are kept as lineage: `-live-gate.json` (30/30 on the
  old suite), `-failed-run-1.json` (25/30), `-live-gate-2.json` (31/32), and
  `-live-gate-3.json` (30/32); the scorer redesign came out of those attempts.
- Independent UI verification PASS on desktop 1440 and mobile 393/412, both
  data paths (Chromium).
- Security sweep found no secrets or personal data beyond the intended public
  listing fields; the Groq key lives only in gitignored `.env.local` and the
  Vercel project env.
- Live smoke checks (2026-09-16): homepage 200, `GET /api/chat` 405, wrong
  content type 415, mismatched `Origin` 403, security headers present, and one
  live question returned a streamed answer grounded in tool output.
- Earlier checks still standing: mock evals completed the plumbing run over all
  32 cases; production curl checks covered streamed events, cache hits and
  bypass, 403/405/415/429 responses, and security headers.

## Next steps

The demo is live and CI is green. What remains:

1. Multi-turn eval coverage; the golden cases are single-turn only.
2. Visitor feedback, then Langfuse traces (start with operational metadata, not
   raw visitor messages).
3. 3-minute demo video.
4. Weekly dataset refresh; property type and price-cut history need snapshot
   archiving in `property-scraper`.

Known limits: URL state is share-only (one-way `replaceState`; back/forward is
not synchronized); the answer cache is per-instance and resets on cold start;
the browser pass was Chromium only.

Billing stays disabled on every provider.
