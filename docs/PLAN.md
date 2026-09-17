# Plan

Milestones, architecture details, free-tier constraints, and known risks for the
Ontario Housing Agent demo. For the dataset itself, see [DATA.md](DATA.md).

## What the demo does

Visitors chat with a tool-calling LLM agent about a research sample of 19,356
Ontario for-sale listings across 36 cities. The agent loop calls deterministic
functions in `lib/tools.ts` for all search and stats work and streams the reply
to the browser.

## Components

| Component | Role | Status |
| --- | --- | --- |
| `pipeline/build_dataset.py` | Reads `../property-scraper/data/regions/*/listings.csv`, dedupes by listing id (never emitted), filters (price, beds/baths, implausible sqft), extracts the FSA, writes nine fields incl. address and source URL | built |
| `data/listings.json`, `data/market_summary.json` | Published sample (19,356 rows) and per-city aggregates, kept as JSON in the repo (no database) | built |
| `lib/tools.ts` | Deterministic search/stats functions + OpenAI-style tool schemas | built |
| `/api/chat` | Streams the agent loop over SSE | built |
| FSA narrowing | Optional `fsa` on `search_listings` and `city_snapshot`; full postal codes reduce to the 3-character FSA | built (2026-09-16) |
| Structured `tool_result` data | SSE results carry `data`; search answers render up to 6 listing cards (price, beds/baths/sqft, FSA, address, "View listing" link) and a sample-size line; cache hits replay the display events | built (2026-09-16) |
| Shareable atlas URL | city, compare pair, sort, price ceiling, tab, and view mirrored into the URL and restored on load (share-only; back/forward does not resync) | built (2026-09-16) |
| Data tab + `/api/listings` | City table from the JSON route (default limit 100, cap 200) and a full CSV export (`?format=csv`, RFC 4180, formula-injection prefixed) | built (2026-09-16) |
| Groq `openai/gpt-oss-120b` | LLM provider on the free tier | built |
| Gemini `gemini-2.5-flash-lite` | Optional fallback in `lib/providers.ts`; used only when `GEMINI_API_KEY` is set and Groq fails before emitting output | built |
| `MOCK_LLM=1` | Deterministic mock LLM for tests/CI | built |
| Evals harness (`evals/run.ts`, `npm run evals`) | 32 golden cases in `evals/cases.jsonl` (10 tool choice, 10 numeric, 12 refusals) -> `evals/report.json` (gitignored) | live-accepted 2026-09-16 (32/32; see [STATUS.md](STATUS.md)) |
| Langfuse Hobby traces | Observability | planned |
| GitHub Actions CI | JS tests + build (Node 24, `MOCK_LLM=1`) and pipeline unittest (Python 3.11) gate | green on the first push (2026-09-16) |
| Vercel Hobby deployment | Public URL | deployed 2026-09-16: https://ontario-housing-agent.vercel.app |

### CI

`.github/workflows/ci.yml` runs on push and pull requests with no secrets (the
LLM is mocked):

- `js`: `npm ci`, `npx vitest run` with `MOCK_LLM=1`, `npm run build`, on Node 24
- `python`: `python3 -m unittest discover -s pipeline/tests -v`, on Python 3.11

The same test and build commands pass locally. CI ran green on the first push
(js and python jobs).

### Agent loop

`/api/chat` runs the loop and streams SSE events:

- `text`: assistant text
- `tool`: a tool call was chosen
- `tool_result`: the deterministic result, with `data` carrying the raw payload (search `{totalMatches, returned, listings}`, snapshot object, compare array)
- `cached`: the exact question was served from cache
- `done`: stream finished
- `error`: failure (rate limit, provider error, etc.)

### Guardrails

- Per-IP limits: 5 requests/minute and 30 requests/day, keyed on
  `x-vercel-forwarded-for` with `x-forwarded-for` as fallback
- Global cap: 800 LLM calls/day
- Standalone exact-question cache (15-minute TTL; completed answers only)

These counters live in one serverless instance and reset on cold starts, so they
are best-effort cost guardrails, not security boundaries. The binding daily
limit is the provider's token quota (see Free-stack constraints).

Numbers are computed by the tools; the model chooses tools and writes prose.
Only completed, error-free standalone answers enter the shared cache. Conversations
with history bypass it. Cached entries include the answer's tool chips and result
payloads, so a hit replays the same cards and sample-size line. Cache hits still
consume the per-IP request allowance, but do not require remaining LLM budget.

## Milestones

### M0: Foundation (built)

Acceptance:

```bash
python3 pipeline/build_dataset.py --source ../property-scraper/data/regions   # produces data/
npx vitest run tests/tools.test.ts                                            # passes
```

### M1: Agent + UI (built)

Acceptance:

```bash
npm run build           # clean
MOCK_LLM=1 npm run dev  # then curl a question POST to /api/chat;
                        # the stream returns a tool event and an answer
```

### M2: Proof (accepted 2026-09-16)

`npm run evals` runs the 32 golden cases in `evals/cases.jsonl` (10 tool
choice, 10 numeric, 12 scope refusals) and writes `evals/report.json`
(gitignored). Live scoring uses the Groq key in the gitignored `.env.local`;
without a key the harness exits 1 with instructions. `MOCK_LLM=1 npm run evals`
exercises the plumbing only (no network, exit 0). The full suite passed 32/32 on
2026-09-16 (tool 1.00, numeric 1.00, refusal 1.00). Earlier runs that day failed
(25/30 on the old 30-case suite, then 31/32 and 30/32 after the suite grew to
32) and drove the scorer and prompt fixes, including the structural refusal
rule; see [STATUS.md](STATUS.md) for the evidence paths.
The report records answers and tool arguments; mock and partial runs cannot mark
`quality_gate_passed` true. Numeric cases require the expected value to be present
in actual tool-derived ground truth. Bedroom and limit arguments must match exactly.
Tool choice passes when any tool event in the turn matches the expected tool and
args; an answer that is only a tool-limit or budget notice fails.
These checks remain heuristic; review the answer meaning before release.

Green thresholds:

- tool choice >= 90%
- numeric correctness >= 95%
- refusals 100%
- CI green

### M3: Deploy (live 2026-09-16)

Live at https://ontario-housing-agent.vercel.app (Vercel Hobby, project scope
`cse-lover`) with `GROQ_API_KEY` set as a hidden project secret. Smoke checks on
the deployed instance: homepage 200, `GET /api/chat` 405, wrong content type
415, mismatched `Origin` 403, security headers present, and one live question
streamed an answer grounded in tool output ("kitchener: 797 listings, median
$605,000"). The guards respond as designed; rate limits are verified by smoke
checks, not load-tested.

Done:

- Vercel Hobby URL live with a Groq key
- Guards smoke-tested on the deployed instance

Pending:

- Langfuse traces visible
- 3-minute demo video

The optional Gemini default was updated from retired `gemini-2.0-flash` to
`gemini-2.5-flash-lite`; [Google lists the former as shut down](https://ai.google.dev/gemini-api/docs/deprecations).
The replacement supports [function calling](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)
and has a [standard free tier](https://ai.google.dev/gemini-api/docs/pricing).
Provider integration tests use mocked HTTP; live fallback acceptance is still pending.

### M4: Richer answers (landed 2026-09-16)

Landed: the published sample now carries address and source URL as a ninth field
(dedupe still by listing id, never emitted, and the local enriched mode is gone),
FSA-scoped search and snapshots, structured `tool_result` data rendered as
listing cards (address plus "View listing" link) and a sample-size line,
shareable atlas URL state, the Data tab with `/api/listings` CSV export, cache
replay of tool chips and cards, a one-question clarification rule when a
required detail is missing, and an eval scorer redesign with structural refusal
checks across 32 cases. Verified with 116 vitest tests, 19 pipeline tests, clean
`tsc`/build, independent UI verification on desktop 1440 and mobile 393/412
(both data paths), and a security sweep that found no secrets or personal data
beyond the intended public listing fields.

Still open: multi-turn eval coverage, visitor feedback, and Langfuse traces;
property type and price-cut history need snapshot archiving in
`property-scraper` (see Later). URL state is share-only (one-way `replaceState`;
back/forward does not resync it), and the answer cache is per-instance, resetting
on cold start.

### Later (planned)

- Weekly dataset refresh
- Price-history / price-cut features (requires snapshot archiving in
  `property-scraper`)

## Free-stack constraints

| Service | Free tier | Consequence for this project |
| --- | --- | --- |
| Groq | Free tier, account-wide: gpt-oss-120b allows 30 RPM / 8K TPM / 200K TPD; billing stays disabled | The binding limit is the daily token quota (roughly 100-300 agent turns/day depending on prompt size), not the in-app 800-calls/day counter, which is best-effort and per instance. Provider output is capped at 512 tokens per call; full live evals run at `EVAL_DELAY_MS=30000` and share this quota with demo traffic |
| Vercel Hobby | Non-commercial personal use only | The demo must stay free and non-commercial or move off Hobby |
| Dataset | JSON files in the repo | No database cost |
| Langfuse Hobby | 50k units/month | Trace volume budget |
| GitHub Actions | Free on public repos | CI assumes a public repo |

## Security mitigations

Built:

- Per-IP limits prefer `x-vercel-forwarded-for`, falling back to the first hop
  of `x-forwarded-for` (`lib/guards.ts`)
- `POST /api/chat` requires `application/json` (415) and same-origin when an
  `Origin` header is present (403)
- Streaming errors expose stable codes only (`provider_error`, `misconfigured`,
  `budget_exhausted`); details stay in server logs
- Response headers `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`;
  `X-Powered-By` disabled

Phase 2:

- Atomic global limiter (e.g. Upstash free tier) before enabling billing, plus
  provider spend caps; keep billing disabled on every provider until then
- Semantic grounding review (cache TTL and standalone-only caching are implemented)
- CI action SHA pinning
- Source-map hygiene

## Known risks

- **Free-tier token quota**: the demo stops answering once the account-wide
  daily token quota is exhausted; the in-app 800-calls/day counter does not
  prevent that because it is per instance and resets on cold starts.
- **Best-effort limiters**: per-IP and global counters cannot be trusted as a
  cost cap; see Phase 2 above.
- **Vercel non-commercial terms**: a public demo must remain non-commercial.
- **Data staleness**: refresh is manual for now, so the published snapshot ages.
- **Zillow terms**: research sample of public listing data; addresses and source
  links are published, but no listing ids, agent names, or scraped source pages;
  not affiliated with Zillow; no financial advice.
