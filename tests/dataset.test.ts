import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichedMode, listings, readEnrichedListings, selectListings } from "../lib/dataset";

const fallback = [
  { city: "ottawa", fsa: "K1A", price: 500000, beds: 3, baths: 2, sqft: 1400, seen: "2026-09-01" },
];

const dirs: string[] = [];

function tempFile(name: string, contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dataset-test-"));
  dirs.push(dir);
  const file = join(dir, name);
  if (contents !== undefined) writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ENRICHED_DATA selection", () => {
  it("uses sanitized rows and touches no files when unset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const selected = selectListings(undefined, fallback, tempFile("missing.json"));
    expect(selected.enrichedMode).toBe(false);
    expect(selected.listings).toBe(fallback);
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats any value other than '1' as disabled", () => {
    for (const value of ["0", "true", "yes", ""]) {
      const selected = selectListings(value, fallback, tempFile("missing.json"));
      expect(selected.enrichedMode).toBe(false);
      expect(selected.listings).toBe(fallback);
    }
  });

  it("prefers enriched rows when the file exists", () => {
    const enriched = [
      { ...fallback[0], listing_id: "T1", url: "https://example.com/t1", address: "10 King St W, Toronto, ON M5H 1A1" },
    ];
    const selected = selectListings("1", fallback, tempFile("listings_enriched.json", JSON.stringify(enriched)));
    expect(selected.enrichedMode).toBe(true);
    expect(selected.listings).toEqual(enriched);
  });

  it("falls back with a single warning when the enriched file is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const selected = selectListings("1", fallback, tempFile("missing.json"));
    expect(selected.enrichedMode).toBe(false);
    expect(selected.listings).toBe(fallback);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back with a warning on malformed JSON instead of crashing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readEnrichedListings(tempFile("listings_enriched.json", "not json"))).toBeNull();
    expect(readEnrichedListings(tempFile("listings_enriched.json", "{}"))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.skipIf(process.env.ENRICHED_DATA === "1")("keeps the tracked dataset as the module default", () => {
    expect(enrichedMode).toBe(false);
    expect(listings.length).toBeGreaterThan(0);
    expect(listings[0]).not.toHaveProperty("url");
  });
});
