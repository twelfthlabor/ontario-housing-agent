# AGENTS.md — Ontario Housing Agent

Operating notes for coding agents. Quickstart, architecture, and dataset docs
live in README.md, docs/PLAN.md, and docs/DATA.md — don't duplicate them here.

## Commands

- `npm test` — vitest run: all tests under tests/ (tools, agent, guards, cache route, providers, eval scoring). Single file:
  `MOCK_LLM=1 npx vitest run tests/tools.test.ts`.
- `npx tsc --noEmit` — typecheck. No linter or formatter is configured; don't add one.
- `npm run build` — next build, also typechecks. Next 16 rewrites `tsconfig.json` on build (adds its type includes):
  review the diff instead of reverting, keep TypeScript at 5.9.x. `next-env.d.ts` is gitignored (Next regenerates it).
- `npm run dev` — port 3000 (`PORT=3200 npm run dev` if busy). Prod: `npm run build && npm run start`.
- `python3 -m unittest discover -s pipeline/tests -v` — pipeline tests, stdlib only (no venv/pandas); CI pins Python
  3.11. Single test: add `-k <pattern>` (e.g. `-p test_build_dataset.py -k dedupe`).
- `npm run evals` — live, loads `.env.local` with Node 24, needs `GROQ_API_KEY`, sequential with `EVAL_DELAY_MS` default 2500.
  `MOCK_LLM=1 npm run evals` — plumbing only, no network, exit 0. Flags: `--category`, `--limit`, `--mock`. Writes
  `evals/report.json` (gitignored). Live bars: tool 0.9, numeric 0.95, refusal 1.0; mock scores are not a quality
  signal. Partial runs cannot satisfy the full quality gate.

## Environment

- `MOCK_LLM=1` (also `true`/`yes`) selects the deterministic mock provider and needs no keys. Unset with no key in
  dev it also mocks; in production a missing key emits a `misconfigured` error event.
- Live mode needs `GROQ_API_KEY`; put it in `.env.local` (gitignored — `.env.example` lists the names). `GROQ_MODEL`
  overrides the default `openai/gpt-oss-120b`. `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`) is a fallback only when
  Groq fails before emitting.
- CI (`.github/workflows/ci.yml`): `npm ci`, `MOCK_LLM=1` vitest, `npm run build`, python unittest — Node 24 /
  Python 3.11. Evals are intentionally not in CI.

## Invariants

- `lib/tools.ts` is the single source of truth for tool schemas (`TOOL_SPECS`), implementations (`TOOL_IMPLS`),
  stats, and city alias normalization (`"St. Catharines"` -> `st-catharines`). Keep it deterministic, synchronous,
  free of LLM/network imports.
- `lib/agent.ts` is the typed-event agent loop: hard caps 3 tool iterations / 4 LLM calls per turn.
  `lib/providers.ts` calls Groq with plain `fetch` (no SDK dependency, 20s timeout per call), plus mock and optional
  Gemini providers.
- Client-visible errors are stable codes only (`provider_error`, `misconfigured`, `rate_limited`,
  `budget_exhausted`); real details stay in server logs.
- `/api/chat` SSE events: `text`, `tool`, `tool_result`, `cached`, `done`, `error`. Mismatched `Origin` -> 403 and
  non-exact `application/json` -> 415, both before rate limiting; GET -> 405. Node runtime (not edge); bodies keep
  the last 20 messages, 4,000 chars each.
- `lib/guards.ts` is in-process best-effort: 5 req/min + 30/day per IP (`x-vercel-forwarded-for`, then
  `x-forwarded-for`), 800 LLM calls/day global, 200-entry LRU standalone-question cache (normalized, 15-minute TTL).
  History-bearing requests bypass the cache; only completed, error-free answers are stored.
  Cache hits remain per-IP rate limited, but can be served after the LLM budget runs out.
  Per instance, resets on cold start — never a security boundary.
- `pipeline/build_dataset.py` (stdlib only, run from repo root): dedupe by listing id (newest `scraped_at` wins),
  filter, sanitize, write `data/listings.json` + `data/market_summary.json`. Default `--source` is the sibling
  `../property-scraper/data/regions`; `--out` defaults to `data/`. `lib/dataset.ts` imports both files directly — no
  database, no runtime reads.
- Rows are exactly `{city,fsa,price,beds,baths,sqft,seen}`; never reintroduce address/url/agent/listing id. `sqft`
  outside 200-20,000 is nulled (land acreage bug); per-city `medianSqft` is null under 10 samples.
- Rebuilds are byte-identical only with a fixed `SOURCE_DATE_EPOCH`; otherwise `generated_at` changes.
- Eval expected values come from `lib/tools` at runtime; never hardcode dataset numbers in `evals/cases.jsonl`.

## Don't

- Never hand-edit `data/*.json` — change the pipeline and regenerate. The ~1.9 MB JSON is tracked on purpose; don't
  gitignore it.
- `../property-scraper` is a read-only data source: never modify it or run its scraper from here.
- Never commit, push, deploy, or enable provider billing — free tier only. Never print keys into logs or client code.
- Don't package or share `.next/` — the gitignored build cache can hold build-time env values.
- After touching `lib/guards.ts`, `lib/providers.ts`, or `app/api/chat/route.ts`: re-run the affected vitest files
  and smoke-test with curl — 415 wrong content type, 403 mismatched Origin, 429 6th request in a minute, security
  headers present.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
