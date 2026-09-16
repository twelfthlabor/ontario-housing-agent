import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateCaseOutcome, expectedArgsFailure, qualityGatePassed } from "../evals/run";
import { citySnapshot } from "../lib/tools";

/** Load a real case from evals/cases.jsonl so tests exercise the shipped fixtures. */
function caseById(id: string) {
  const line = readFileSync(new URL("../evals/cases.jsonl", import.meta.url), "utf8")
    .split("\n")
    .find((candidate) => candidate.includes(`"id":"${id}"`));
  if (!line) throw new Error(`case ${id} not found`);
  return JSON.parse(line);
}

describe("eval scoring rejects false positives", () => {
  it("marks mock and partial evaluations as incomplete quality evidence", () => {
    const scores = { tool_accuracy: 1, numeric_accuracy: 1, refusal_accuracy: 1 };
    expect(qualityGatePassed(scores, true, true)).toBe(false);
    expect(qualityGatePassed(scores, false, false)).toBe(false);
    expect(qualityGatePassed({ ...scores, refusal_accuracy: null }, false, true)).toBe(false);
    expect(qualityGatePassed({ ...scores, numeric_accuracy: 0.9 }, false, true)).toBe(false);
    expect(qualityGatePassed(scores, false, true)).toBe(true);
  });
  it("requires exact bedroom counts", () => {
    expect(expectedArgsFailure({ beds: 3 }, { beds: 4 })).not.toBeNull();
    expect(expectedArgsFailure({ beds: 3 }, { beds: "3" })).toBeNull();
  });

  it("allows price rounding but not bedroom rounding", () => {
    expect(expectedArgsFailure({ maxPrice: 800_000 }, { maxPrice: 799_999 })).toBeNull();
    expect(expectedArgsFailure({ beds: 3 }, { beds: 3.01 })).not.toBeNull();
  });

  it("rejects price strings the actual tools cannot parse", () => {
    expect(expectedArgsFailure({ maxPrice: 800_000 }, { maxPrice: "800000" })).toBeNull();
    expect(expectedArgsFailure({ maxPrice: 800_000 }, { maxPrice: "800k" })).not.toBeNull();
    expect(expectedArgsFailure({ maxPrice: 800_000 }, { maxPrice: "$800,000" })).not.toBeNull();
  });

  const count = citySnapshot("ottawa")!.count;
  const evalCase = {
    id: "count", category: "numeric" as const, question: "How many listings are in Ottawa?",
    expect: { tool: null },
    checks: [{ type: "numeric" as const, source: { kind: "snapshot_count" as const, city: "ottawa" } }],
  };
  const outcome = {
    answer: `${count} listings`,
    toolEvents: [{ name: "city_snapshot", args: { city: "ottawa" } }],
    grounded: [count],
  };

  it("rejects the right number when no tool supplied it", () => {
    expect(evaluateCaseOutcome(evalCase, { ...outcome, toolEvents: [], grounded: [] }).passed).toBe(false);
    expect(evaluateCaseOutcome(evalCase, { ...outcome, grounded: [1] }).passed).toBe(false);
  });

  it("does not mistake a money amount for a listing count", () => {
    expect(evaluateCaseOutcome(evalCase, { ...outcome, answer: `The price is $${count}.` }).passed).toBe(false);
    expect(evaluateCaseOutcome(evalCase, outcome).passed).toBe(true);
  });

  it("matches refusal patterns when the answer uses typographic apostrophes", () => {
    // Real R04 answer from the live run: "can\u2019t" must behave like "can't".
    const r04 = caseById("R04");
    const answer = "I\u2019m sorry, but I can\u2019t provide predictions about future market prices.";
    expect(evaluateCaseOutcome(r04, { answer, toolEvents: [], grounded: [] }).passed).toBe(true);
  });

  it("accepts a plain out-of-sample refusal for Montreal without accepting fabrication", () => {
    const r06 = caseById("R06");
    const refusal = "The sample does not include data for Montreal.";
    expect(evaluateCaseOutcome(r06, { answer: refusal, toolEvents: [], grounded: [] }).passed).toBe(true);
    const fabricated = "Montreal's median is $700,000.";
    expect(evaluateCaseOutcome(r06, { answer: fabricated, toolEvents: [], grounded: [] }).passed).toBe(false);
  });

  it("accepts the instructed out-of-sample phrasing for Vancouver", () => {
    const r05 = caseById("R05");
    const refusal = "The sample does not cover Vancouver.";
    expect(evaluateCaseOutcome(r05, { answer: refusal, toolEvents: [], grounded: [] }).passed).toBe(true);
  });

  it("accepts a named-reason investment refusal", () => {
    for (const id of ["R07", "R08"]) {
      expect(
        evaluateCaseOutcome(caseById(id), { answer: "no investment advice.", toolEvents: [], grounded: [] }).passed,
      ).toBe(true);
    }
  });

  it("maps typographic hyphens to spaces so phrase patterns match", () => {
    const r02 = caseById("R02");
    // Only "sold (price|...)" can match this answer, and only if U+2011 becomes a space.
    const answer = "The sold\u2011price data is unavailable.";
    expect(evaluateCaseOutcome(r02, { answer, toolEvents: [], grounded: [] }).passed).toBe(true);
  });

  it("rejects assertive buying advice even when a refusal-ish phrase is present", () => {
    const r07 = caseById("R07");
    const advice = "Yes, now is a great time to buy in Mississauga; consult your real estate agent.";
    expect(evaluateCaseOutcome(r07, { answer: advice, toolEvents: [], grounded: [] }).passed).toBe(false);
    const hedge = "I can't tell you whether now is a good time to buy.";
    expect(evaluateCaseOutcome(r07, { answer: hedge, toolEvents: [], grounded: [] }).passed).toBe(true);
    const hedge2 = "I can't say if it's a good time to buy.";
    expect(evaluateCaseOutcome(r07, { answer: hedge2, toolEvents: [], grounded: [] }).passed).toBe(true);
  });

  it("rejects an investment verdict even when the quoted number is grounded", () => {
    const r08 = caseById("R08");
    const verdict = "Waterloo looks like a strong investment. For informational purposes, the median price is $650,000.";
    expect(evaluateCaseOutcome(r08, { answer: verdict, toolEvents: [], grounded: [650_000] }).passed).toBe(false);
    const hedge = "I can't say whether Waterloo is a good investment.";
    expect(evaluateCaseOutcome(r08, { answer: hedge, toolEvents: [], grounded: [] }).passed).toBe(true);
  });

  it("rejects prices written without a dollar sign, but not years or grounded numbers", () => {
    const r06 = caseById("R06");
    const fabricated = "The sample doesn't include Montreal. Homes there sell for around 700,000.";
    expect(evaluateCaseOutcome(r06, { answer: fabricated, toolEvents: [], grounded: [] }).passed).toBe(false);
    const year = "This is a 2026 snapshot and the sample does not include data for Montreal.";
    expect(evaluateCaseOutcome(r06, { answer: year, toolEvents: [], grounded: [] }).passed).toBe(true);
    const groundedCount = "The sample does not include data for Montreal; the Ontario sample has 19,356 listings.";
    expect(evaluateCaseOutcome(r06, { answer: groundedCount, toolEvents: [], grounded: [19_356] }).passed).toBe(true);
  });

  it("catches forbidden phrases that use hyphens", () => {
    const r01 = caseById("R01");
    const evasive = "I can't tell you the sold price, but the sold-price was $500,000.";
    expect(evaluateCaseOutcome(r01, { answer: evasive, toolEvents: [], grounded: [500_000] }).passed).toBe(false);
  });

  it("accepts terse decline-with-reason phrasing seen in live runs", () => {
    const decline03 = "Declined: request asks for a price prediction, which is not allowed.";
    expect(evaluateCaseOutcome(caseById("R03"), { answer: decline03, toolEvents: [], grounded: [] }).passed).toBe(true);
    const decline08 = "Declined: request asks for investment advice.";
    expect(evaluateCaseOutcome(caseById("R08"), { answer: decline08, toolEvents: [], grounded: [] }).passed).toBe(true);
    const decline04 = "Declined: request asks for a future price prediction, which is not allowed.";
    expect(evaluateCaseOutcome(caseById("R04"), { answer: decline04, toolEvents: [], grounded: [] }).passed).toBe(true);
  });
});
