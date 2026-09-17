# Project status: 2026-09-17

## Assessment

M3 is live at https://ontario-housing-agent.vercel.app (Vercel Hobby, project
scope `cse-lover`, `GROQ_API_KEY` as a hidden project secret), CI is green, and
Vercel auto-deploys on push. This round added filtered city snapshots and area
rankings to the tool surface, a collapsible "How this answer was computed"
block in chat, one metadata-only `chat_turn` log line per turn, and a 38-case
eval suite with multi-turn and capability cases.

Live gate status, stated precisely: the last completed full-suite pass is the
32-case gate on 2026-09-16 (`output/evidence/2026-09-16-live-gate-4.json`,
32/32, `quality_gate_passed: true`). The 38-case suite has NOT completed a live
run. Both 2026-09-17 attempts hit the Groq free-tier daily token cap:
`output/evidence/2026-09-17-live-gate-5.log` aborted at 13/38 and
`output/evidence/2026-09-17-live-gate-6.log` aborted at case 1/38. A full live
run is pending a quota reset.

Local verification: `MOCK_LLM=1 npm test` passes 158 tests in 8 files; the
pipeline unittest suite passes 19 tests; `npx tsc --noEmit` and
`MOCK_LLM=1 npm run build` are clean; `MOCK_LLM=1 npm run evals` selects all
38 cases and exits 0 (plumbing only, not a quality signal).

Eval scoring remains heuristic: refusal scoring is wording-sensitive and a live
run is one sample. Multi-turn coverage now exists (MT01-MT04) and expectations
support `anyOf` alternatives. The code is PolyForm Noncommercial 1.0.0 licensed
(research project).

## Work completed

This round (2026-09-17):

- `city_snapshot` accepts optional `minPrice`, `maxPrice`, `beds`, and
  `bathsMin` and computes stats over the matching rows; it returns null when
  nothing matches.
- New `rank_areas` tool: ranks a city's FSAs by `median_price` or `count`,
  keeps only areas with 5 or more matching listings, defaults to 5 rows (max
  10), and reports `considered` and `totalAreas`.
- Chat provenance: tool-using answers get a collapsed "How this answer was
  computed" block listing, per call, the raw tool id, the raw arguments the
  model sent (humanized where known), and a muted result summary. Cached
  answers replay the same block.
- Observability: one metadata-only `chat_turn` JSON line per turn
  (`durationMs`, `cached`, `tools`, `errorCode`) plus `rate_limited` events;
  content-like keys are stripped before logging. Langfuse is still not built
  (it needs account keys); these logs are the intended feed.
- Eval suite grew from 32 to 38 cases: 16 tool choice (including MT01-MT04
  multi-turn and capability cases C01/C02 for filtered snapshots and
  `rank_areas`), 10 numeric, 12 refusals. Multi-turn cases run 2-3 user turns
  with assistant history carried forward, score only the final turn, record a
  per-turn trace, and fail when the first turn used no tool. Expectations may
  list `anyOf` alternatives. The harness rewrites the report after every case,
  so a quota-aborted run keeps partial results.

Earlier (2026-09-16):

- Published nine fields per row (19,356 rows including address and source URL),
  removed the local enriched mode, and landed listing cards with "View
  listing" links, a sample-size line, FSA narrowing, shareable atlas URL
  state, the Data tab with CSV export, cache replay of display events, a
  clarification rule for incomplete questions, and the eval scorer redesign.
- The full live gate passed 32/32 on the 32-case suite (tool 1.00, numeric
  1.00, refusal 1.00). Earlier runs that day (25/30, then 31/32, 30/32)
  exposed the scorer's wording sensitivity and drove the fixes; lineage files
  are in `output/evidence/`.
- Optional Gemini fallback updated to `gemini-2.5-flash-lite`; provider output
  capped at 512 tokens per call.
- Independent UI verification passed on desktop 1440 and mobile 393/412
  (Chromium); a security sweep found no secrets or personal data beyond the
  intended public listing fields.

## Verification

- `MOCK_LLM=1 npm test`: 8 files, 158 tests passed.
- `python3 -m unittest discover -s pipeline/tests`: 19 tests passed.
- `npx tsc --noEmit`: clean. `MOCK_LLM=1 npm run build`: exit 0.
- `MOCK_LLM=1 npm run evals`: all 38 cases selected, exit 0 (plumbing only).
- Dataset spot checks against `data/listings.json`: 19,356 rows, 36 cities, 8
  rows with no FSA, 3,875 rows with sqft (20.0%, range 236-12,749), 620 extra
  rows that repeat another row on the seven non-address fields, and 14 of 36
  cities with a null `medianSqft`.
- Live gate: 32/32 on 2026-09-16 (`output/evidence/2026-09-16-live-gate-4.json`,
  `quality_gate_passed: true`). The 38-case attempts on 2026-09-17 were aborted
  by the free-tier token cap (13/38 and 1/38 recorded).
- The scrape tree was refreshed 2026-09-17 and the scheduled publish had not
  run yet, so the tracked snapshot is older than the newest scrape. The next
  scheduled refresh will rebuild and commit the two data files.

## Next steps

1. Rerun the full 38-case live suite when the Groq daily quota resets. A
   completed run is required before claiming the new surface passed.
2. Langfuse traces: still not built, it needs account keys. The `chat_turn`
   logs are the feed to wire up; start with operational metadata, not raw
   visitor messages.
3. Record the 3-minute demo (script in [DEMO.md](DEMO.md)).
4. Visitor feedback, then decide on further answer-quality work.
5. Price-cut history needs snapshot archiving in `property-scraper`.

Known limits: the 38-case suite's live verification is pending; refusal scoring
is wording-sensitive; URL state is share-only (one-way `replaceState`;
back/forward is not synchronized); the answer cache is per-instance and resets
on cold start; the last browser pass was Chromium only.

Billing stays disabled on every provider.
