# Plan

Milestones, architecture details, free-tier constraints, and known risks for the
Ontario Housing Agent demo. For the dataset itself, see [DATA.md](DATA.md).

## What the demo does

Visitors chat with a tool-calling LLM agent about a sanitized sample of roughly
20,000 Ontario for-sale listings across 36 cities. The agent loop calls
deterministic functions in `lib/tools.ts` for all search and stats work and
streams the reply to the browser.

## Components

| Component | Role | Status |
| --- | --- | --- |
| `pipeline/build_dataset.py` | Reads `../property-scraper/data/regions/*/listings.csv`, dedupes, filters (price, beds/baths, implausible sqft), extracts the FSA, drops identifiers, writes JSON | built |
| `data/listings.json`, `data/market_summary.json` | Sanitized dataset and per-city aggregates, kept as JSON in the repo (no database) | built |
| `lib/tools.ts` | Deterministic search/stats functions + OpenAI-style tool schemas | built |
| `/api/chat` | Streams the agent loop over SSE | built |
| Groq `openai/gpt-oss-120b` | LLM provider on the free tier | built |
| Gemini `gemini-2.5-flash-lite` | Optional fallback in `lib/providers.ts`; used only when `GEMINI_API_KEY` is set and Groq fails before emitting output | built |
| `MOCK_LLM=1` | Deterministic mock LLM for tests/CI | built |
| Evals harness (`evals/run.ts`, `npm run evals`) | 30 golden cases in `evals/cases.jsonl` (10 tool choice, 10 numeric, 10 refusals) -> `evals/report.json` (gitignored) | live-accepted 2026-09-16 (30/30; see [STATUS.md](STATUS.md)) |
| Langfuse Hobby traces | Observability | planned |
| GitHub Actions CI | JS tests + build (Node 24, `MOCK_LLM=1`) and pipeline unittest (Python 3.11) gate | written, not yet exercised on GitHub |
| Vercel Hobby deployment | Public URL | planned |

### CI

`.github/workflows/ci.yml` runs on push and pull requests with no secrets (the
LLM is mocked):

- `js`: `npm ci`, `npx vitest run` with `MOCK_LLM=1`, `npm run build`, on Node 24
- `python`: `python3 -m unittest discover -s pipeline/tests -v`, on Python 3.11

The same test and build commands pass locally. Status: written, not yet
exercised on GitHub; it first runs when the repo is pushed.

### Agent loop

`/api/chat` runs the loop and streams SSE events:

- `text` — assistant text
- `tool` — a tool call was chosen
- `tool_result` — the deterministic result
- `cached` — the exact question was served from cache
- `done` — stream finished
- `error` — failure (rate limit, provider error, etc.)

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
with history bypass it. Cache hits still consume the per-IP request allowance, but
do not require remaining LLM budget.

## Milestones

### M0 — Foundation (built)

Acceptance:

```bash
python3 pipeline/build_dataset.py --source ../property-scraper/data/regions   # produces data/
npx vitest run tests/tools.test.ts                                            # passes
```

### M1 — Agent + UI (built)

Acceptance:

```bash
npm run build           # clean
MOCK_LLM=1 npm run dev  # then curl a question POST to /api/chat;
                        # the stream returns a tool event and an answer
```

### M2 — Proof (accepted 2026-09-16)

`npm run evals` runs the 30 golden cases in `evals/cases.jsonl` (10 tool
choice, 10 numeric, 10 scope refusals) and writes `evals/report.json`
(gitignored). Live scoring uses the Groq key in the gitignored `.env.local`;
without a key the harness exits 1 with instructions. `MOCK_LLM=1 npm run evals`
exercises the plumbing only (no network, exit 0). The full suite passed 30/30 on
2026-09-16 (tool 1.00, numeric 1.00, refusal 1.00), after a first run failed
25/30 and drove the scorer/prompt fixes; see [STATUS.md](STATUS.md) for the
evidence paths.
The report records answers and tool arguments; mock and partial runs cannot mark
`quality_gate_passed` true. Numeric cases require the expected value to be present
in actual tool-derived ground truth. Bedroom and limit arguments must match exactly.
These checks remain heuristic; review the answer meaning before release.

Green thresholds:

- tool choice >= 90%
- numeric correctness >= 95%
- refusals 100%
- CI green

### M3 — Deploy (pending human steps)

Not started: no license, no commits, no remote, nothing deployed. The path is:
add a `LICENSE`, first commit, `gh repo create` + push (CI first runs), then
Vercel Hobby with `GROQ_API_KEY` in the project env.

- Vercel Hobby URL live with a Groq key
- Rate limits verified
- Langfuse traces visible
- 3-minute demo video

The optional Gemini default was updated from retired `gemini-2.0-flash` to
`gemini-2.5-flash-lite`; [Google lists the former as shut down](https://ai.google.dev/gemini-api/docs/deprecations).
The replacement supports [function calling](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)
and has a [standard free tier](https://ai.google.dev/gemini-api/docs/pricing).
Provider integration tests use mocked HTTP; live fallback acceptance is still pending.

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

- **Free-tier token quota** — the demo stops answering once the account-wide
  daily token quota is exhausted; the in-app 800-calls/day counter does not
  prevent that because it is per instance and resets on cold starts.
- **Best-effort limiters** — per-IP and global counters cannot be trusted as a
  cost cap; see Phase 2 above.
- **Vercel non-commercial terms** — a public demo must remain non-commercial.
- **Data staleness** — refresh is manual for now, so the published snapshot ages.
- **Zillow terms** — sanitized research sample only; no addresses, URLs, or agent
  names published; not affiliated with Zillow; no financial advice.
