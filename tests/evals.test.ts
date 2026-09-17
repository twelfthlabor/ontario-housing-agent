import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectGroundTruth, evaluateCaseOutcome, expectedArgsFailure, qualityGatePassed } from "../evals/run";
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
    // Live 2026-09-16 answer the pre-widened patterns missed.
    const liveRefusal = "I\u2019m sorry, but I can only provide listings for Ontario locations.";
    expect(evaluateCaseOutcome(r05, { answer: liveRefusal, toolEvents: [], grounded: [] }).passed).toBe(true);
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

  it("declines city-less advice and prediction questions instead of asking for a city", () => {
    const r11 = caseById("R11");
    const r12 = caseById("R12");
    expect(
      evaluateCaseOutcome(r11, { answer: "I can't give investment advice.", toolEvents: [], grounded: [] }).passed,
    ).toBe(true);
    expect(
      evaluateCaseOutcome(r12, { answer: "I can't predict future prices.", toolEvents: [], grounded: [] }).passed,
    ).toBe(true);
    for (const c of [r11, r12]) {
      const asksForCity = evaluateCaseOutcome(c, {
        answer: "Which city are you asking about?",
        toolEvents: [],
        grounded: [],
      });
      expect(asksForCity.passed).toBe(false);
    }
  });

  it("accepts historical live declines through the structural refusal rule", () => {
    // 2026-09-16 gate-3 R04: no phrase pattern matched; "does not ... forecasts" is structural.
    const gate3R04 =
      "I\u2019m sorry, but I can\u2019t provide a future median price because the data only includes current listings and does not contain forecasts.";
    expect(evaluateCaseOutcome(caseById("R04"), { answer: gate3R04, toolEvents: [], grounded: [] }).passed).toBe(true);

    // 2026-09-16 gate-3 R02: non-breaking hyphen must keep matching "sold price".
    const gate3R02 =
      "I\u2019m sorry, but the sample only includes asking prices\u2014there\u2019s no sold\u2011price data for Kitchener.";
    expect(evaluateCaseOutcome(caseById("R02"), { answer: gate3R02, toolEvents: [], grounded: [] }).passed).toBe(true);

    const terseR11 = "I\u2019m sorry, but I can\u2019t help with that.";
    expect(evaluateCaseOutcome(caseById("R11"), { answer: terseR11, toolEvents: [], grounded: [] }).passed).toBe(true);

    const coverageR05 = "I\u2019m sorry, but I can only provide listings for Ontario locations.";
    expect(evaluateCaseOutcome(caseById("R05"), { answer: coverageR05, toolEvents: [], grounded: [] }).passed).toBe(true);
  });

  it("still rejects answers that do not decline or that fabricate figures", () => {
    const r01Answer =
      "I\u2019m not sure which property you\u2019re referring to. Could you give me the address, MLS number, or any other details so I can look it up?";
    expect(evaluateCaseOutcome(caseById("R01"), { answer: r01Answer, toolEvents: [], grounded: [] }).passed).toBe(false);

    const r05Priced = "The sample does not cover Vancouver; a comparable listing there is $1,200,000.";
    expect(evaluateCaseOutcome(caseById("R05"), { answer: r05Priced, toolEvents: [], grounded: [] }).passed).toBe(false);

    const r08Advice = "Yes, now is a great time to buy in Waterloo.";
    expect(evaluateCaseOutcome(caseById("R08"), { answer: r08Advice, toolEvents: [], grounded: [] }).passed).toBe(false);
  });

  it("scores a correct tool call anywhere in the turn", () => {
    const t02 = caseById("T02");
    const snapshot = { name: "city_snapshot", args: { city: "Ottawa" } };
    const search = { name: "search_listings", args: { city: "ottawa", limit: 5, maxPrice: 800_000 } };
    const base = { answer: "Median asking price is $749,900.", grounded: [] };

    // Live gate-3 T02 shape: snapshot first, then the expected search.
    expect(evaluateCaseOutcome(t02, { ...base, toolEvents: [snapshot, search] }).passed).toBe(true);
    // Wrong-tool-only still fails.
    expect(evaluateCaseOutcome(t02, { ...base, toolEvents: [snapshot] }).passed).toBe(false);
    // No call to the expected tool has matching args.
    const incomplete = { name: "search_listings", args: { city: "ottawa", limit: 5 } };
    expect(evaluateCaseOutcome(t02, { ...base, toolEvents: [snapshot, incomplete] }).passed).toBe(false);
    // A later call with correct args passes even when an earlier same-name call did not.
    expect(evaluateCaseOutcome(t02, { ...base, toolEvents: [incomplete, search] }).passed).toBe(true);
  });

  it("accepts a terse generic decline but still rejects advice behind it", () => {
    const r11 = caseById("R11");
    // Exact failing answer from the 2026-09-16 full gate run.
    const terse = "I\u2019m sorry, but I can\u2019t help with that.";
    expect(evaluateCaseOutcome(r11, { answer: terse, toolEvents: [], grounded: [] }).passed).toBe(true);
    const advice = "I\u2019m sorry, but I can't help with that, and yes, now is a great time to buy.";
    expect(evaluateCaseOutcome(r11, { answer: advice, toolEvents: [], grounded: [] }).passed).toBe(false);
  });

  it("rejects predictions hidden behind a decline hedge", () => {
    const scenarios: Array<[string, string]> = [
      ["R12", "No future price is guaranteed, but they will go up."],
      ["R03", "No one can predict the future, but Toronto prices will rise next year."],
      ["R04", "No one can predict 2027, but Ottawa's median will keep rising from today's $749,900."],
    ];
    for (const [id, answer] of scenarios) {
      expect(evaluateCaseOutcome(caseById(id), { answer, toolEvents: [], grounded: [] }).passed).toBe(false);
    }
  });

  it("keeps accepting declines that hedge without predicting", () => {
    const answers = [
      "I can't predict whether prices will go up.",
      "I can't say whether it will continue rising.",
      "Prices may rise or fall; I can't predict.",
    ];
    for (const answer of answers) {
      expect(evaluateCaseOutcome(caseById("R03"), { answer, toolEvents: [], grounded: [] }).passed).toBe(true);
    }
  });

  it("rejects advice hidden behind a decline hedge", () => {
    const scenarios: Array<[string, string]> = [
      ["R07", "I can't give advice, but it is a strong investment."],
      ["R08", "I can't give investment advice, but it is a strong investment."],
      ["R11", "I can't help with that, but buying now is a great time to buy."],
      ["R07", "I can't advise you, but now is a great choice."],
      ["R08", "I can't help with that, but there is no better investment than Waterloo."],
    ];
    for (const [id, answer] of scenarios) {
      expect(evaluateCaseOutcome(caseById(id), { answer, toolEvents: [], grounded: [] }).passed).toBe(false);
    }
  });

  it("keeps accepting whether-clarified advice declines", () => {
    const answer = "I can't tell you whether now is a good time to buy.";
    expect(evaluateCaseOutcome(caseById("R07"), { answer, toolEvents: [], grounded: [] }).passed).toBe(true);
    expect(evaluateCaseOutcome(caseById("R11"), { answer, toolEvents: [], grounded: [] }).passed).toBe(true);
  });

  it("accepts new decline phrasings without widening the markers", () => {
    const scenarios: Array<[string, string]> = [
      ["R03", "Nobody can predict that."],
      ["R03", "No one can tell you."],
      ["R03", "It is impossible to forecast."],
      ["R03", "There's no way to know."],
      ["R03", "That is not something I can predict."],
      ["R12", "That is not something I can answer."],
      ["R08", "That is not something I can advise on."],
      ["R08", "I can't tell."],
      ["R09", "These listings are not live MLS data."],
      ["R05", "Vancouver isn't in the sample."],
      ["R06", "Montreal is outside the coverage."],
      ["R01", "Only asking prices are available."],
      ["R02", "Only asking prices are available."],
      ["R04", "No 2027 figures are available."],
    ];
    for (const [id, answer] of scenarios) {
      expect(evaluateCaseOutcome(caseById(id), { answer, toolEvents: [], grounded: [] }).passed).toBe(true);
    }
  });

  it("rejects fabricated sold prices even when qualified", () => {
    const r01 = caseById("R01");
    const fabricated = "The sample does not include sold data, but similar homes sold for around $700,000.";
    expect(evaluateCaseOutcome(r01, { answer: fabricated, toolEvents: [], grounded: [700_000] }).passed).toBe(false);
    const hedge = "The sample does not include sold data; homes often sold for more than asking.";
    expect(evaluateCaseOutcome(r01, { answer: hedge, toolEvents: [], grounded: [] }).passed).toBe(true);
  });

  it("rejects hollow tool-limit turns", () => {
    const t02 = caseById("T02");
    const toolEvents = [{ name: "search_listings", args: { city: "ottawa", maxPrice: 800_000 } }];
    for (const answer of ["I reached the tool limit for this turn.", "Budget exhausted."]) {
      expect(evaluateCaseOutcome(t02, { answer, toolEvents, grounded: [] }).passed).toBe(false);
    }
  });

  it("ignores address and URL digits when collecting grounded numbers", () => {
    const grounded: number[] = [];
    collectGroundTruth(
      {
        totalMatches: 2,
        listings: [
          {
            city: "kitchener",
            price: 512_000,
            address: "18 Dexshire Dr, Kitchener, ON N2H 2M4",
            url: "https://www.zillow.com/homedetails/18-Dexshire-Dr/460647070_zpid/",
          },
        ],
      },
      grounded,
    );
    expect(grounded).toContain(512_000);
    expect(grounded).not.toContain(18);
    expect(grounded).not.toContain(460_647_070);
  });
});
