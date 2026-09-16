# Project status — 2026-09-16

## Assessment

M3 is live at https://ontario-housing-agent.vercel.app (Vercel Hobby, project
scope `cse-lover`, `GROQ_API_KEY` as a hidden project secret) and CI is green.
This round landed the next slice of answer quality: FSA-scoped search and
snapshots, structured `tool_result` data rendered as listing cards and a
sample-size line, shareable atlas URL state, cache replay of display events, and
a local-only enriched mode for address and source links. All checks pass: 96
vitest tests, 31 pipeline tests, clean `tsc`/build, an independent security
audit, and a visual pass at 1440/412/393 in both modes. The last full live eval
remains 30/30 (2026-09-16). The code is PolyForm Noncommercial 1.0.0 licensed
(research project).

The design is appropriate for this small snapshot demo. Keep the JSON dataset
and deterministic tools; adding a database now would not resolve answer quality.
The read-only sibling `property-scraper` supplies 36 city CSVs. The generated
sample contains 19,356 listings, and tool statistics match the generated summary
for every city.

## Work completed

This round (2026-09-16):

- FSA narrowing: `search_listings` takes an optional `fsa` and `city_snapshot`
  accepts `{city, fsa}`. Full postal codes reduce to the leading 3-character FSA
  ("M6P 1A1" -> "M6P"); rows without a postal code are excluded from scoped
  results.
- SSE `tool_result` events carry `data` with the raw result (search
  `{totalMatches, returned, listings}`, snapshot object, compare array); rows
  pass through as-is.
- Search answers render up to 6 listing cards with price, beds/baths/sqft, and
  FSA, a "showing N of M" count, and a "Based on N sample listings" line.
- Atlas state (city, compare pair, sort, price ceiling, tab) is mirrored into
  the URL for sharing and restored on load; `max` snaps to the slider's 50k step.
- Standalone cache entries store the display events, so a repeated question
  replays `cached -> tool -> tool_result -> text -> done` and still shows cards,
  chips, and the basis line.
- Local enriched mode: `--enriched-out output/listings_enriched.json` plus
  `ENRICHED_DATA=1` reattaches `listing_id`/`url`/`address` for local runs. The
  pipeline refuses enriched paths inside the sanitized output directory,
  `next.config.ts` excludes `output/` from route traces, and the deployed demo
  stays sanitized.

Earlier on 2026-09-16:

- Live eval gate passed 30/30 (tool 1.00, numeric 1.00, refusal 1.00) after the
  first run failed at 25/30 and drove scorer and prompt fixes.
- Cache and eval hardening: standalone-only caching, no caching after partial
  provider failure, exact bedroom/limit scoring, tool-derived numeric ground
  truth.
- Optional Gemini fallback updated to `gemini-2.5-flash-lite`; provider output
  capped at 512 tokens per call.
- Two atlas label collisions found by visual verification were fixed.
- Initial commit pushed; CI ran green and the Vercel Hobby production deploy
  went live.

## Verification

- `npm test` passes 96 tests in 7 files; the Python pipeline suite passes 31
  tests. `npx tsc --noEmit` and `npm run build` are clean.
- Independent security audit PASS: enriched data cannot reach tracked files,
  client bundles, or Vercel artifacts; the production environment has no
  `ENRICHED_DATA`.
- Visual verification PASS at 1440/412/393 in both modes, including the
  cached-repeat state (Chromium).
- Full live suite: 30/30 cases, tool_accuracy 1.00, numeric_accuracy 1.00,
  refusal_accuracy 1.00, `quality_gate_passed: true`. Evidence copy:
  `output/evidence/2026-09-16-live-gate.json` (gitignored); the failed first run
  is at `output/evidence/2026-09-16-failed-run-1.json`.
- Live smoke checks (2026-09-16): homepage 200, `GET /api/chat` 405, wrong
  content type 415, mismatched `Origin` 403, security headers present, and one
  live question returned a streamed answer grounded in tool output.
- Earlier checks still standing: mock evals completed all 30 cases (plumbing
  evidence only); production curl checks covered streamed events, cache hits and
  bypass, 403/405/415/429 responses, and security headers; a source rebuild with
  a fixed `SOURCE_DATE_EPOCH` produced byte-identical data files.

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
