# Project status — 2026-09-16

## Assessment

M2 live proof is complete. The full 30-case suite passes every bar:
tool_accuracy 1.00 (bar 0.90), numeric_accuracy 1.00 (bar 0.95), and
refusal_accuracy 1.00 (bar 1.00), with `quality_gate_passed: true`. A Groq API
key is configured in the gitignored `.env.local` (free tier, billing stays
disabled). **M3 deploy has landed**: the demo is live at
https://ontario-housing-agent.vercel.app (Vercel Hobby, project scope
`cse-lover`, `GROQ_API_KEY` set as a hidden project secret), and CI ran green on
the first push. Only Langfuse traces and the demo video remain from M3. The code is PolyForm Noncommercial 1.0.0 licensed (research project).

The design is appropriate for this small snapshot demo. Keep the JSON dataset
and deterministic tools; adding a database now would not resolve answer quality.
The read-only sibling `property-scraper` supplies 36 city CSVs. The generated
sample contains 19,356 listings, and tool statistics match the generated summary
for every city.

## Work completed

- Reproduced four cache failures and four evaluation failures with regression
  tests before fixing them.
- Shared caching now applies only to standalone questions. Follow-ups carry
  history to the agent and cannot read or populate another conversation's answer
  cache. Entries expire after 15 minutes; reads do not extend that deadline.
- Provider errors after partial text no longer populate the cache. Cached
  answers remain available after the LLM budget runs out, while still counting
  against the request rate limit.
- Evaluation scoring requires exact bedroom counts and limits, and only accepts
  numeric argument strings that the tools can actually parse. Numeric answers
  require tool-derived ground truth; money tokens cannot pass as listing counts.
- Reports retain answer text and tool arguments for review. Mock runs and partial
  runs always report `quality_gate_passed: false`.
- `npm run evals` loads `.env.local` using Node 24. Missing live credentials still
  fail clearly instead of silently selecting the mock.
- The optional fallback now defaults to `gemini-2.5-flash-lite`. Google lists
  `gemini-2.0-flash` as shut down on June 1, 2026 in its
  [deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations).
  The replacement supports [function calling](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)
  and has a [standard free tier](https://ai.google.dev/gemini-api/docs/pricing).
  Blank model overrides now select defaults. HTTP tests are mocked; this does
  not establish live fallback quality.
- The page labels scripted replies as an offline demo and explains that budget
  filters and follow-ups require the live model.
- Live acceptance: the first full run failed at 25/30 (refusal 0.60) and drove
  scorer and prompt fixes; the rerun passed 30/30.
- Refusal scoring was hardened against observed live phrasing (193 recorded
  answers): unicode apostrophe/hyphen normalization, per-case forbid patterns
  for advice and investment verdicts, and ungrounded plain-number price
  detection (>= 10,000, years excluded).
- Provider output is capped at 512 tokens per call (Groq `max_tokens`, Gemini
  `maxOutputTokens`) as a quota guard.
- Two atlas label collisions found by independent visual verification were fixed
  (marker labels clear the measured heading/caption rect; lake labels hide on
  intersection) and re-verified with before/after measurements.
- Initial commit pushed 2026-09-16: CI ran green (js + python jobs) and the
  Vercel Hobby production deploy went live with `GROQ_API_KEY` as a hidden
  project secret.

## Verification

- `npm test` passes 73 tests in 6 files; the Python pipeline suite passes 19
  tests. `npx tsc --noEmit` and `npm run build` are clean.
- Full live suite: 30/30 cases, tool_accuracy 1.00, numeric_accuracy 1.00,
  refusal_accuracy 1.00, `quality_gate_passed: true`, about 15 minutes wall
  time. Evidence copy: `output/evidence/2026-09-16-live-gate.json` (gitignored).
- The first live attempt scored 25/30 (tool 0.90, refusal 0.60); its report is
  at `output/evidence/2026-09-16-failed-run-1.json` and drove the fixes above.
- UI re-verification passed with before/after measurements after the two label
  fixes; screenshots and reports are under `/tmp/ui-verify-recheck/` (transient).
  `output/` is gitignored, so QA artifacts and research extracts stay local.
- Live smoke checks (2026-09-16): homepage 200, `GET /api/chat` 405, wrong
  content type 415, mismatched `Origin` 403, security headers present, and one
  live question returned a streamed answer grounded in tool output
  ("kitchener: 797 listings, median $605,000").
- Earlier checks still standing: mock evals completed all 30 cases (plumbing
  evidence only); production server curl checks covered the streamed events,
  cache hits and bypass, 403/405/415/429 responses, and security headers; a
  source rebuild with a fixed `SOURCE_DATE_EPOCH` produced byte-identical data
  files.

## Next steps

The demo is live and CI is green. What remains:

1. Langfuse traces, not built. Start with operational metadata rather than raw
   visitor messages.
2. 3-minute demo video.
3. Weekly dataset refresh; price history needs snapshot archiving in
   `property-scraper`.

Billing stays disabled on every provider.
