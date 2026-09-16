# Project status — 2026-09-16

## Assessment

M2 live proof is complete. The full 30-case suite passes every bar:
tool_accuracy 1.00 (bar 0.90), numeric_accuracy 1.00 (bar 0.95), and
refusal_accuracy 1.00 (bar 1.00), with `quality_gate_passed: true`. A Groq API
key is configured in the gitignored `.env.local` (free tier, billing stays
disabled). The next milestone is **M3 deploy**, which waits on human steps:
the project has no license, the repo still has zero commits, and nothing is
deployed.

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
- Earlier checks still standing: mock evals completed all 30 cases (plumbing
  evidence only); production server curl checks covered the streamed events,
  cache hits and bypass, 403/405/415/429 responses, and security headers; a
  source rebuild with a fixed `SOURCE_DATE_EPOCH` produced byte-identical data
  files.

## Next steps, in order

1. Publish preparation, all human steps: add a `LICENSE` (the project has none),
   make the first commit, then `gh repo create` and push. CI
   (`.github/workflows/ci.yml`) has never run because the repo still has zero
   commits; it first runs on that push.
2. Deploy to Vercel Hobby with `GROQ_API_KEY` set in the project environment and
   billing disabled. Nothing is deployed yet.
3. Rotate the API key after the demo: it was shared outside the secret store
   once. Never package or share `.next/`, whose build cache can hold build-time
   env values.
4. Budget the free tier: live evals and demo traffic share one account quota
   (openai/gpt-oss-120b: 30 RPM / 8K TPM / 200K TPD). Full live runs use
   `EVAL_DELAY_MS=30000` and consume a meaningful share of the daily tokens.
5. M3 still needs Langfuse traces (not built), rate-limit verification on the
   deployed instance, and a 3-minute demo video. Start traces with operational
   metadata rather than raw visitor messages.
6. Quality caveats: add multi-turn cases before calling conversational behavior
   proven, and review recorded answers before release since scoring is
   heuristic. The tools still lack property type, sold prices, history, and mean
   prices, so the model must explain those gaps rather than claim unsupported
   answers. Verify the Gemini fallback independently if it will be enabled.

The repository still has zero commits, so it remains untracked. No commit, push,
deployment, or billing change was performed in this pass. Weekly refresh and
price history remain separate later milestones.
