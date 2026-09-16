# Ontario Housing Agent

A free public demo where visitors chat with a tool-calling LLM agent about a
sanitized sample of roughly 20,000 Ontario for-sale property listings across 36
cities. The agent answers questions like "median asking price for a 3-bed in
Hamilton?" by calling deterministic search and stats functions over a JSON
dataset. Numbers come from those functions; the model picks tools and writes the
reply.

Live demo: https://ontario-housing-agent.vercel.app

Not a valuation tool, listing service, or source of financial advice. See
[Disclaimers](#disclaimers).

## Who it is for

- Visitors who want quick, data-grounded answers about asking prices in the
  covered cities.
- Developers looking for a small, readable example of a tool-calling agent loop
  with rate-limit guardrails and a deterministic offline test mode.

## Quickstart

These steps run the demo locally; the live demo is at the URL above.
Requires Node.js 24 and Python 3. Run all commands from this directory
(`ontario-housing-agent/`), with the `property-scraper` checkout as a sibling.

```bash
npm install
python3 pipeline/build_dataset.py            # writes data/listings.json + data/market_summary.json
MOCK_LLM=1 npm run dev                       # open the URL printed by Next.js
npm test                                     # vitest: tools, agent, guards
npm run build                                # production build; npm start serves it
MOCK_LLM=1 npm run evals                     # golden harness, plumbing only (no network)
```

`MOCK_LLM=1` runs a deterministic mock instead of calling Groq, so the quickstart
needs no API key. For the real model, put `GROQ_API_KEY` in `.env.local` and run `npm run dev`
without `MOCK_LLM=1`. The app shows an offline-demo notice when using scripted replies.
Both Next.js and `npm run evals` load `.env.local`; exported environment variables
take precedence for the eval command. Restart the server after changing providers or data.

`npm run evals` runs the 30 golden cases and needs `GROQ_API_KEY` for live
scoring; without a key it exits 1 with instructions. `MOCK_LLM=1 npm run evals`
runs the plumbing only. Each successful run writes `evals/report.json`, which is
gitignored. Reports include the answers and tool arguments for diagnosis.
`quality_gate_passed` stays false for mock runs and partial runs (`--limit` or
`--category` selecting fewer than all cases), even if their selected cases pass.

`pipeline/build_dataset.py` reads `../property-scraper/data/regions` by default;
pass `--source <dir>` to point it elsewhere.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Groq API key. Required to call the real model; not needed with `MOCK_LLM=1`. |
| `GROQ_MODEL` | Override the Groq model id; the demo uses `openai/gpt-oss-120b`. |
| `GEMINI_API_KEY` | Optional fallback provider, used only when set and a Groq call fails before emitting output. Groq remains the primary free provider. Keep billing disabled on both accounts. |
| `GEMINI_MODEL` | Optional fallback model override; defaults to `gemini-2.5-flash-lite`. |
| `MOCK_LLM` | Set to `1` to use the deterministic mock LLM (tests/CI; no key needed). |

## Architecture

```
property-scraper/  (separate repo; read-only here)
  data/regions/<city>/listings.csv
        |
        v
pipeline/build_dataset.py   dedupe by listing id -> filter -> extract FSA -> drop identifiers
        |
        v
data/listings.json          ~20k sanitized listings
data/market_summary.json    per-city aggregates
        |
        v
lib/tools.ts                deterministic search/stats + OpenAI-style tool schemas
        |
        v
/api/chat (Next.js)         agent loop, streamed over SSE
        |    events: text, tool, tool_result, cached, done, error
        |    guardrails: 5 req/min + 30 req/day per IP, 800 LLM calls/day global,
        |                standalone exact-question cache (15-minute TTL)
        v
Groq openai/gpt-oss-120b    primary free provider (MOCK_LLM=1 -> deterministic mock)
Gemini gemini-2.5-flash-lite     optional fallback when GEMINI_API_KEY is set and Groq fails
```

## Project layout

```
ontario-housing-agent/
├── README.md
├── docs/
│   ├── PLAN.md               milestones, constraints, known risks
│   └── DATA.md               dataset fields, filters, limitations, terms
├── pipeline/                 Python data build; stdlib unittest coverage
├── data/                     generated listings.json + market_summary.json
├── lib/                      tools.ts, agent.ts (tool loop), providers.ts (Groq/Gemini/mock), guards.ts
├── app/                      Next.js app: /api/chat SSE route and chat UI
├── components/               chat UI components
├── tests/                    vitest: tools, agent, guards (e.g. tests/tools.test.ts)
└── evals/                    30 golden cases + run.ts harness (npm run evals; report.json gitignored)
```

## Documentation

- [docs/STATUS.md](docs/STATUS.md): latest verified state, fixes, and next steps.
- [docs/PLAN.md](docs/PLAN.md): architecture details, milestones, constraints.
- [docs/DATA.md](docs/DATA.md): what the dataset contains and how to refresh it.

## Disclaimers

- The dataset is a sanitized research sample of public for-sale listing data
  (Zillow). It contains no addresses, URLs, or agent names. Not affiliated with
  Zillow.
- Asking prices only; no sold prices. Square footage covers about 20% of rows and
  varies by city; values outside a plausible 200-20,000 sqft range (for example,
  land listings whose acreage the source renders as interior square feet) are
  treated as missing. The sample is a single snapshot and can be stale.
- Nothing here is financial, legal, or real-estate advice.
- The demo runs on free tiers: Groq for the model and Vercel Hobby for hosting.
  Exhausting the daily free-tier token quota can make it unavailable during
  traffic spikes.

## License

MIT. See [LICENSE](LICENSE).
