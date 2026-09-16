import { afterEach, describe, expect, it, vi } from "vitest";
import { createFallbackProvider, createGeminiProvider, createGroqProvider } from "../lib/providers";
import type { Provider, ProviderEvent } from "../lib/providers";

async function collect(provider: Provider) {
  const events: ProviderEvent[] = [];
  for await (const event of provider.stream([{ role: "user", content: "Hello" }], [])) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("provider configuration and fallback", () => {
  it("uses the supported Gemini default when the override is empty", async () => {
    vi.stubEnv("GEMINI_MODEL", " ");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      candidates: [{ content: { parts: [{ text: "Hello" }] } }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await collect(createGeminiProvider({ apiKey: "test-key" }))).toEqual([
      { type: "text", delta: "Hello" },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain("/gemini-2.5-flash-lite:generateContent");
  });

  it("uses the Groq default when the override is empty", async () => {
    vi.stubEnv("GROQ_MODEL", " ");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
    ));
    vi.stubGlobal("fetch", fetchMock);
    expect(await collect(createGroqProvider({ apiKey: "test-key" }))).toEqual([
      { type: "text", delta: "Hello" },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("openai/gpt-oss-120b");
  });

  it("caps Groq output tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
    ));
    vi.stubGlobal("fetch", fetchMock);
    await collect(createGroqProvider({ apiKey: "test-key" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(512);
  });

  it("caps Gemini output tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      candidates: [{ content: { parts: [{ text: "Hello" }] } }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    await collect(createGeminiProvider({ apiKey: "test-key" }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig?.maxOutputTokens).toBe(512);
  });

  it("falls back after an initial failure, but never after partial output", async () => {
    let fallbackCalls = 0;
    const fallback: Provider = { name: "fallback", async *stream() {
      fallbackCalls += 1;
      yield { type: "text", delta: "Recovered" };
    } };
    const failed: Provider = { name: "failed", async *stream() { throw new Error("offline"); } };
    expect(await collect(createFallbackProvider(failed, fallback))).toEqual([
      { type: "text", delta: "Recovered" },
    ]);
    const partial: Provider = { name: "partial", async *stream() {
      yield { type: "text", delta: "Partial" };
      throw new Error("interrupted");
    } };
    await expect(collect(createFallbackProvider(partial, fallback))).rejects.toThrow("interrupted");
    expect(fallbackCalls).toBe(1);
  });
});
