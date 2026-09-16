import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/chat/route";
import { createGuardState } from "../lib/guards";
import * as providers from "../lib/providers";

function request(messages = [{ role: "user", content: "How many listings are in Ottawa?" }]) {
  return new NextRequest("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
}

describe("completed, standalone answer caching", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_LLM", "1");
    globalThis.__housingGuardState = createGuardState({ maxPerMinute: 100 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reuses a completed standalone answer without another LLM call", async () => {
    await (await POST(request())).text();
    const used = globalThis.__housingGuardState!.budget.used;
    expect(await (await POST(request())).text()).toContain('"type":"cached"');
    expect(globalThis.__housingGuardState!.budget.used).toBe(used);
  });

  it("does not reuse or store answers from conversations with history", async () => {
    const conversation = [
      { role: "user", content: "Tell me about Ottawa." },
      { role: "assistant", content: "Ottawa has a listing sample." },
      { role: "user", content: "What about 3 bedrooms?" },
    ];
    await (await POST(request(conversation))).text();
    expect(globalThis.__housingGuardState!.cache.size).toBe(0);
    expect(await (await POST(request(conversation))).text()).not.toContain('"type":"cached"');
  });

  it("bypasses a standalone cache hit when the same words have conversation context", async () => {
    await (await POST(request())).text();
    const response = await POST(request([
      { role: "user", content: "Only include homes with 3 bedrooms." },
      { role: "assistant", content: "Understood." },
      { role: "user", content: "How many listings are in Ottawa?" },
    ]));
    expect(await response.text()).not.toContain('"type":"cached"');
  });

  it("does not cache partial text after a provider failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(providers, "getProvider").mockReturnValue({
      name: "broken",
      async *stream() {
        yield { type: "text", delta: "The median is " };
        throw new Error("connection interrupted");
      },
    });
    const response = await POST(request());
    expect(await response.text()).toContain('"type":"error"');
    expect(globalThis.__housingGuardState!.cache.size).toBe(0);
  });

  it("serves cached answers even when the LLM budget is exhausted", async () => {
    await (await POST(request())).text();
    globalThis.__housingGuardState!.budgetPerDay = 0;
    const hit = await POST(request());
    expect(hit.status).toBe(200);
    expect(await hit.text()).toContain('"type":"cached"');
    const miss = await POST(request([{ role: "user", content: "Tell me about Toronto." }]));
    expect(miss.status).toBe(503);
  });

  it("still rate limits cached requests", async () => {
    globalThis.__housingGuardState!.maxPerMinute = 1;
    await (await POST(request())).text();
    expect((await POST(request())).status).toBe(429);
  });
});
