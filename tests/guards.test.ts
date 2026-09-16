import { describe, expect, it } from "vitest";

import {
  CACHE_MAX_ENTRIES,
  LLM_CALLS_PER_DAY,
  REQUESTS_PER_DAY,
  REQUESTS_PER_MINUTE,
  checkBudget,
  consumeLlmCall,
  createGuardState,
  firstHopIp,
  getCachedAnswer,
  normalizeQuestion,
  putCachedAnswer,
  takeRateLimit,
  utcDayKey,
} from "../lib/guards";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

describe("guard limits", () => {
  it("documents the demo limits", () => {
    expect(REQUESTS_PER_MINUTE).toBe(5);
    expect(REQUESTS_PER_DAY).toBe(30);
    expect(LLM_CALLS_PER_DAY).toBe(800);
    expect(CACHE_MAX_ENTRIES).toBe(200);
  });

  it("allows five requests per minute and rejects the sixth with retry_after_s", () => {
    const clock = { value: Date.UTC(2026, 0, 5, 12, 0, 0) };
    const state = createGuardState({ now: () => clock.value });

    for (let i = 0; i < REQUESTS_PER_MINUTE; i += 1) {
      expect(takeRateLimit(state, "203.0.113.7").allowed).toBe(true);
    }

    const denied = takeRateLimit(state, "203.0.113.7");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterS).toBeGreaterThan(0);
      expect(denied.retryAfterS).toBeLessThanOrEqual(60);
    }
  });

  it("frees the minute window after it rolls over", () => {
    const clock = { value: Date.UTC(2026, 0, 5, 12, 0, 0) };
    const state = createGuardState({ now: () => clock.value });

    for (let i = 0; i < REQUESTS_PER_MINUTE; i += 1) {
      takeRateLimit(state, "203.0.113.7");
    }
    expect(takeRateLimit(state, "203.0.113.7").allowed).toBe(false);

    clock.value += MINUTE_MS;
    expect(takeRateLimit(state, "203.0.113.7").allowed).toBe(true);
  });

  it("caps one IP at the daily request limit", () => {
    const clock = { value: Date.UTC(2026, 0, 5, 12, 0, 0) };
    const state = createGuardState({ now: () => clock.value });

    for (let i = 0; i < REQUESTS_PER_DAY; i += 1) {
      if (i > 0 && i % REQUESTS_PER_MINUTE === 0) clock.value += MINUTE_MS;
      expect(takeRateLimit(state, "198.51.100.9").allowed).toBe(true);
    }

    clock.value += MINUTE_MS; // minute window is fresh; the day cap must trip
    const denied = takeRateLimit(state, "198.51.100.9");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfterS).toBeGreaterThan(60);
  });

  it("tracks IPs independently", () => {
    const state = createGuardState();
    for (let i = 0; i < REQUESTS_PER_MINUTE; i += 1) {
      takeRateLimit(state, "a");
    }
    expect(takeRateLimit(state, "a").allowed).toBe(false);
    expect(takeRateLimit(state, "b").allowed).toBe(true);
  });
});

describe("global LLM budget", () => {
  it("consumes per UTC day and rejects when exhausted", () => {
    const clock = { value: Date.UTC(2026, 0, 5, 12, 0, 0) };
    const state = createGuardState({ now: () => clock.value, budgetPerDay: 3 });

    expect(consumeLlmCall(state).allowed).toBe(true);
    expect(consumeLlmCall(state).allowed).toBe(true);
    expect(consumeLlmCall(state).allowed).toBe(true);

    expect(consumeLlmCall(state).allowed).toBe(false);
    expect(checkBudget(state).remaining).toBe(0);
  });

  it("resets on the next UTC day", () => {
    const clock = { value: Date.UTC(2026, 0, 5, 23, 59, 0) };
    const state = createGuardState({ now: () => clock.value, budgetPerDay: 1 });

    expect(consumeLlmCall(state).allowed).toBe(true);
    expect(consumeLlmCall(state).allowed).toBe(false);

    clock.value += 2 * 60_000; // crosses midnight UTC
    expect(utcDayKey(clock.value)).toBe("2026-01-06");
    expect(consumeLlmCall(state).allowed).toBe(true);
  });
});

describe("answer cache", () => {
  it("expires entries after a fixed TTL even when repeatedly read", () => {
    let now = 1_000;
    const state = createGuardState({ now: () => now, cacheTtlMs: 100 });
    putCachedAnswer(state, "question", "answer");
    now = 1_099;
    expect(getCachedAnswer(state, "question")?.answer).toBe("answer");
    now = 1_100;
    expect(getCachedAnswer(state, "question")).toBeNull();
    expect(state.cache.size).toBe(0);
  });
  it("normalizes questions for exact matching", () => {
    expect(normalizeQuestion("  What   does $800k buy in Ottawa?  ")).toBe(
      "what does $800k buy in ottawa",
    );
    expect(normalizeQuestion("COMPARE Hamilton and Kitchener!!!")).toBe(
      "compare hamilton and kitchener",
    );
  });

  it("returns a hit for the normalized question and a miss otherwise", () => {
    const state = createGuardState();
    putCachedAnswer(state, "What does $800k buy in Ottawa?", "Ottawa has 100 listings.");

    expect(getCachedAnswer(state, "  WHAT does $800k buy in ottawa?? ")).toEqual({
      answer: "Ottawa has 100 listings.",
      events: [],
    });
    expect(getCachedAnswer(state, "Compare Hamilton and Kitchener")).toBeNull();
  });

  it("stores display events alongside the answer for replay", () => {
    const state = createGuardState();
    const events = [
      { type: "tool" as const, name: "search_listings", args: { city: "ottawa", beds: 3 } },
      {
        type: "tool_result" as const,
        name: "search_listings",
        summary: "288 matches, cheapest $227,000",
        data: { totalMatches: 288 },
      },
    ];
    putCachedAnswer(state, "3 bedroom in Ottawa", "The sample has 288 matching listings.", events);

    expect(getCachedAnswer(state, "3 bedroom in Ottawa")).toEqual({
      answer: "The sample has 288 matching listings.",
      events,
    });
  });

  it("ignores empty questions and answers", () => {
    const state = createGuardState();
    putCachedAnswer(state, "   ", "answer");
    putCachedAnswer(state, "question", "   ");
    expect(getCachedAnswer(state, "")).toBeNull();
    expect(getCachedAnswer(state, "question")).toBeNull();
  });

  it("evicts the least recently used entry past capacity", () => {
    const state = createGuardState({ cacheMax: 2 });
    putCachedAnswer(state, "a", "answer a");
    putCachedAnswer(state, "b", "answer b");

    expect(getCachedAnswer(state, "a")?.answer).toBe("answer a"); // refresh a

    putCachedAnswer(state, "c", "answer c");
    expect(getCachedAnswer(state, "b")).toBeNull();
    expect(getCachedAnswer(state, "a")?.answer).toBe("answer a");
    expect(getCachedAnswer(state, "c")?.answer).toBe("answer c");
  });
});

describe("firstHopIp", () => {
  it("prefers x-vercel-forwarded-for over x-forwarded-for", () => {
    expect(firstHopIp("1.2.3.4, 10.0.0.1", "203.0.113.9, 172.16.0.1")).toBe("1.2.3.4");
    expect(firstHopIp("1.2.3.4", "203.0.113.9")).toBe("1.2.3.4");
  });

  it("falls back to the first hop of x-forwarded-for", () => {
    expect(firstHopIp(null, "203.0.113.9, 10.0.0.1, 172.16.0.1")).toBe("203.0.113.9");
    expect(firstHopIp("", "203.0.113.9")).toBe("203.0.113.9");
    expect(firstHopIp("   ", "203.0.113.9")).toBe("203.0.113.9");
    expect(firstHopIp(undefined, "203.0.113.9")).toBe("203.0.113.9");
  });

  it("falls back to unknown when both headers are absent or empty", () => {
    expect(firstHopIp(null, null)).toBe("unknown");
    expect(firstHopIp(undefined, undefined)).toBe("unknown");
    expect(firstHopIp("", "")).toBe("unknown");
    expect(firstHopIp(null, "  , 10.0.0.1")).toBe("unknown");
  });
});
