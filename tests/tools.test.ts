import { describe, expect, it } from "vitest";
import {
  citySnapshot,
  compareCities,
  knownCities,
  searchListings,
  TOOL_IMPLS,
  TOOL_SPECS,
} from "../lib/tools";
import { listings, summary } from "../lib/dataset";
import type { Listing } from "../lib/types";

const cities = Object.keys(summary.cities);
const topCity = cities.reduce(
  (best, city) => (summary.cities[city].count > summary.cities[best].count ? city : best),
  cities[0],
);
const topCount = summary.cities[topCity].count;

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describe("knownCities", () => {
  it("returns the sorted, non-empty city list from the dataset", () => {
    const known = knownCities();
    expect(cities.length).toBeGreaterThan(0);
    expect(known).toEqual([...known].sort());
    expect(new Set(known).size).toBe(known.length);
    expect(known.length).toBe(summary.totals.cities);
    expect(known).toContain(topCity);
  });
});

describe("searchListings", () => {
  it("returns an empty result for an unknown city", () => {
    expect(searchListings({ city: "atlantis" })).toEqual({
      totalMatches: 0,
      returned: 0,
      listings: [],
    });
    expect(searchListings({ city: "" }).totalMatches).toBe(0);
  });

  it("matches the city case-insensitively and reports the full totalMatches", () => {
    const upper = searchListings({ city: `${topCity.toUpperCase()} `, limit: 25 });
    expect(upper.totalMatches).toBe(topCount);
    expect(upper.returned).toBe(Math.min(25, topCount));
    expect(upper.listings.length).toBe(upper.returned);
    for (let i = 1; i < upper.listings.length; i += 1) {
      expect(upper.listings[i].price).toBeGreaterThanOrEqual(upper.listings[i - 1].price);
    }
  });

  it("applies inclusive price and exact beds filters", () => {
    const median = summary.cities[topCity].medianPrice;

    const priced = searchListings({
      city: topCity,
      minPrice: median,
      maxPrice: median * 1.5,
      limit: 25,
    });
    const expectedPriced = listings.filter(
      (row) => row.city === topCity && row.price >= median && row.price <= median * 1.5,
    );
    expect(priced.totalMatches).toBe(expectedPriced.length);
    for (const row of priced.listings) {
      expect(row.price).toBeGreaterThanOrEqual(median);
      expect(row.price).toBeLessThanOrEqual(median * 1.5);
    }

    const bedListing = listings.find((row) => row.city === topCity && row.beds !== null);
    expect(bedListing).toBeDefined();
    const bed = bedListing?.beds as number;
    const expectedBeds = listings.filter((row) => row.city === topCity && row.beds === bed);
    const bedResult = searchListings({ city: topCity, beds: bed, limit: 25 });
    expect(bedResult.totalMatches).toBe(expectedBeds.length);
    for (const row of bedResult.listings) {
      expect(row.beds).toBe(bed);
    }
  });

  it("sorts price_desc, clamps limit to 25, and defaults to 5", () => {
    const desc = searchListings({ city: topCity, sort: "price_desc", limit: 3 });
    expect(desc.returned).toBe(Math.min(3, topCount));
    expect(desc.totalMatches).toBe(topCount);
    for (let i = 1; i < desc.listings.length; i += 1) {
      expect(desc.listings[i].price).toBeLessThanOrEqual(desc.listings[i - 1].price);
    }

    expect(searchListings({ city: topCity }).returned).toBe(Math.min(5, topCount));
    expect(searchListings({ city: topCity, limit: 999 }).returned).toBe(Math.min(25, topCount));
    expect(searchListings({ city: topCity, limit: 2 }).totalMatches).toBe(topCount);
  });

  it("returns copies, not references into the dataset", () => {
    const first = searchListings({ city: topCity, limit: 1 }).listings[0];
    const source = listings.find(
      (row) =>
        row.city === topCity && row.price === first.price && row.seen === first.seen && row.fsa === first.fsa,
    );
    expect(source).toBeDefined();
    expect(first).toEqual(source);
    expect(first).not.toBe(source);
  });
});

describe("searchListings fsa filter", () => {
  const sample = listings.find((row) => row.city === topCity && row.fsa !== null);
  const fsa = sample?.fsa as string;
  const expected = listings.filter((row) => row.city === topCity && row.fsa === fsa);

  it("keeps only exact FSA matches, case-insensitively", () => {
    expect(expected.length).toBeGreaterThan(0);
    const lower = searchListings({ city: topCity, fsa: fsa.toLowerCase(), limit: 25 });
    const upper = searchListings({ city: topCity.toUpperCase(), fsa: fsa.toUpperCase(), limit: 25 });
    expect(lower.totalMatches).toBe(expected.length);
    expect(lower).toEqual(upper);
    expect(lower.returned).toBe(Math.min(25, expected.length));
    for (const row of lower.listings) {
      expect(row.fsa).toBe(fsa);
    }
  });

  it("reduces a full postal code to its FSA", () => {
    const spaced = searchListings({ city: topCity, fsa: `${fsa} 1A1`, limit: 25 });
    const compact = searchListings({ city: topCity, fsa: `${fsa}1A1`.toLowerCase(), limit: 25 });
    expect(spaced).toEqual(searchListings({ city: topCity, fsa, limit: 25 }));
    expect(compact).toEqual(spaced);
  });

  it("takes the empty path for a malformed or foreign postal code", () => {
    const empty = { totalMatches: 0, returned: 0, listings: [] };
    expect(searchListings({ city: topCity, fsa: "M6" })).toEqual(empty);
    expect(searchListings({ city: topCity, fsa: "90210" })).toEqual(empty);
  });

  it("composes with the other filters after the city filter", () => {
    const priced = searchListings({ city: topCity, fsa, minPrice: 500_000, limit: 25 });
    expect(priced.totalMatches).toBe(expected.filter((row) => row.price >= 500_000).length);
    for (const row of priced.listings) {
      expect(row.fsa).toBe(fsa);
      expect(row.price).toBeGreaterThanOrEqual(500_000);
    }
  });

  it("returns an empty result for an unknown FSA and excludes rows without an FSA", () => {
    expect(listings.some((row) => row.fsa === "Z9Z")).toBe(false);
    const empty = { totalMatches: 0, returned: 0, listings: [] };
    expect(searchListings({ city: topCity, fsa: "Z9Z" })).toEqual(empty);
    expect(searchListings({ city: "atlantis", fsa })).toEqual(empty);

    const nullFsaCity = listings.find((row) => row.fsa === null)?.city as string;
    const scopedFsa = listings.find((row) => row.city === nullFsaCity && row.fsa !== null)?.fsa as string;
    const scoped = searchListings({ city: nullFsaCity, fsa: scopedFsa, limit: 25 });
    expect(scoped.totalMatches).toBe(
      listings.filter((row) => row.city === nullFsaCity && row.fsa === scopedFsa).length,
    );
    expect(scoped.listings.some((row) => row.fsa === null)).toBe(false);
  });
});

describe("citySnapshot", () => {
  it("returns null for an unknown city", () => {
    expect(citySnapshot("atlantis")).toBeNull();
    expect(citySnapshot("")).toBeNull();
  });

  it("computes stats at runtime that match market_summary.json for every city", () => {
    for (const city of cities) {
      expect(citySnapshot(city)).toEqual({ city, ...summary.cities[city] });
    }
  });

  it("cross-checks the major city against its market_summary entry", () => {
    const major = citySnapshot(topCity.toUpperCase());
    const expected = summary.cities[topCity];
    expect(major).not.toBeNull();
    expect(major?.city).toBe(topCity);
    expect(major?.count).toBe(expected.count);
    expect(major?.medianPrice).toBe(expected.medianPrice);
    expect(major?.q1Price).toBe(expected.q1Price);
    expect(major?.q3Price).toBe(expected.q3Price);
    expect(major?.medianByBeds).toEqual(expected.medianByBeds);
    expect(major?.shareUnder1M).toBe(expected.shareUnder1M);
    expect(major?.medianSqft).toBe(expected.medianSqft);
    expect(major?.updated).toBe(expected.updated);
  });
});

describe("citySnapshot with fsa", () => {
  const sample = listings.find((row) => row.city === topCity && row.fsa !== null);
  const fsa = sample?.fsa as string;
  const scopedRows = listings.filter((row) => row.city === topCity && row.fsa === fsa);

  it("scopes every snapshot field to the FSA rows", () => {
    const snapshot = citySnapshot({ city: topCity, fsa: fsa.toLowerCase() });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.city).toBe(topCity);
    expect(snapshot?.count).toBe(scopedRows.length);
    expect(snapshot?.medianPrice).toBe(medianOf(scopedRows.map((row) => row.price)));
    expect(snapshot?.shareUnder1M).toBeGreaterThanOrEqual(0);
    expect(snapshot?.shareUnder1M).toBeLessThanOrEqual(1);
    expect(snapshot?.updated).toBe(
      scopedRows.reduce((latest, row) => (row.seen > latest ? row.seen : latest), ""),
    );
    const sqfts = scopedRows.filter((row) => row.sqft !== null).map((row) => row.sqft as number);
    expect(snapshot?.medianSqft).toBe(sqfts.length >= 10 ? medianOf(sqfts) : null);
  });

  it("reduces a full postal code to its FSA", () => {
    const expected = citySnapshot({ city: topCity, fsa });
    expect(expected).not.toBeNull();
    expect(citySnapshot({ city: topCity, fsa: `${fsa} 1A1` })).toEqual(expected);
    expect(citySnapshot({ city: topCity, fsa: `${fsa}1A1`.toLowerCase() })).toEqual(expected);
  });

  it("returns null for a malformed or foreign postal code", () => {
    expect(citySnapshot({ city: topCity, fsa: "M6" })).toBeNull();
    expect(citySnapshot({ city: topCity, fsa: "90210" })).toBeNull();
  });

  it("applies the 10-sample medianSqft rule inside the FSA", () => {
    const byFsa = new Map<string, Listing[]>();
    for (const row of listings) {
      if (row.fsa === null) continue;
      const bucket = byFsa.get(row.fsa) ?? [];
      bucket.push(row);
      byFsa.set(row.fsa, bucket);
    }
    const sqftCount = (rows: Listing[]) => rows.filter((row) => row.sqft !== null).length;
    const sparse = [...byFsa.values()].find((rows) => sqftCount(rows) < 10);
    const dense = [...byFsa.values()].find((rows) => sqftCount(rows) >= 10);
    expect(sparse).toBeDefined();
    expect(dense).toBeDefined();
    expect(citySnapshot({ city: sparse?.[0].city as string, fsa: sparse?.[0].fsa as string })?.medianSqft).toBeNull();
    expect(
      typeof citySnapshot({ city: dense?.[0].city as string, fsa: dense?.[0].fsa as string })?.medianSqft,
    ).toBe("number");
  });

  it("follows the not-found pattern for unknown FSAs and keeps city-wide lookups", () => {
    expect(citySnapshot({ city: topCity, fsa: "Z9Z" })).toBeNull();
    expect(citySnapshot({ city: "atlantis", fsa })).toBeNull();
    expect(citySnapshot({ city: topCity })).toEqual(citySnapshot(topCity));
    expect(citySnapshot({ city: topCity, fsa: "" })).toEqual(citySnapshot(topCity));
  });
});

describe("city aliases", () => {
  const aliases: Array<[string, string]> = [
    ["St. Catharines", "st-catharines"],
    ["st. catharines", "st-catharines"],
    ["St Catharines", "st-catharines"],
    ["SAULT STE. MARIE", "sault-ste-marie"],
    ["Sault Ste. Marie", "sault-ste-marie"],
    ["Kawartha Lakes", "kawartha-lakes"],
    ["kawartha_lakes", "kawartha-lakes"],
  ];

  it("resolves punctuation and casing aliases to the same snapshot as the slug", () => {
    for (const [alias, slug] of aliases) {
      const snapshot = citySnapshot(alias);
      expect(snapshot).not.toBeNull();
      expect(snapshot).toEqual(citySnapshot(slug));
      expect(snapshot?.city).toBe(slug);
    }
  });

  it("keeps slug lookups working and still returns null for unknown cities", () => {
    expect(citySnapshot("st-catharines")).toEqual(citySnapshot("St. Catharines"));
    expect(citySnapshot("   ")).toBeNull();
    expect(citySnapshot("Nowhere. City")).toBeNull();
    expect(citySnapshot("St. Nowhere")).toBeNull();
  });

  it("applies the same alias normalisation to searchListings and compareCities", () => {
    const viaAlias = searchListings({ city: "St. Catharines", limit: 3 });
    const viaSlug = searchListings({ city: "st-catharines", limit: 3 });
    expect(viaAlias.totalMatches).toBeGreaterThan(0);
    expect(viaAlias).toEqual(viaSlug);
    expect(searchListings({ city: "Nowhere. City" }).totalMatches).toBe(0);
    expect(compareCities(["Sault Ste. Marie"])).toEqual(compareCities(["sault-ste-marie"]));
  });
});

describe("compareCities", () => {
  it("returns snapshots in request order and skips unknown cities", () => {
    const [firstCity, secondCity] = cities;
    const result = compareCities([secondCity, "atlantis", firstCity, secondCity.toUpperCase()]);
    expect(result.map((snapshot) => snapshot.city)).toEqual([secondCity, firstCity, secondCity]);
    expect(result[0]).toEqual(citySnapshot(secondCity));
    expect(compareCities([])).toEqual([]);
  });
});

describe("tool specs and implementations", () => {
  it("exposes the three OpenAI-style specs", () => {
    const names = TOOL_SPECS.map((spec) => spec.function.name);
    expect(names).toEqual(["search_listings", "city_snapshot", "compare_cities"]);
    for (const spec of TOOL_SPECS) {
      expect(spec.type).toBe("function");
      expect(spec.function.description).toContain("never invent numbers");
      expect(spec.function.parameters.type).toBe("object");
      expect(spec.function.parameters.required.length).toBeGreaterThan(0);
    }
  });

  it("coerces tool-call arguments and delegates to the same functions", () => {
    const viaTool = TOOL_IMPLS.search_listings({
      city: topCity.toUpperCase(),
      minPrice: "1000000",
      maxPrice: "2000000",
      beds: "3",
      limit: "2",
    });
    expect(viaTool).toEqual(
      searchListings({ city: topCity, minPrice: 1_000_000, maxPrice: 2_000_000, beds: 3, limit: 2 }),
    );

    expect(TOOL_IMPLS.city_snapshot({ city: topCity })).toEqual(citySnapshot(topCity));
    expect(TOOL_IMPLS.city_snapshot({ city: "atlantis" })).toBeNull();
    expect(TOOL_IMPLS.compare_cities({ cities: [topCity, "atlantis"] })).toEqual(
      compareCities([topCity, "atlantis"]),
    );

    const fsa = listings.find((row) => row.city === topCity && row.fsa !== null)?.fsa as string;
    expect(
      TOOL_IMPLS.search_listings({ city: topCity.toUpperCase(), fsa: fsa.toLowerCase(), limit: "2" }),
    ).toEqual(searchListings({ city: topCity, fsa, limit: 2 }));
    expect(TOOL_IMPLS.city_snapshot({ city: topCity, fsa: fsa.toLowerCase() })).toEqual(
      citySnapshot({ city: topCity, fsa }),
    );
  });

  it("documents the optional fsa parameter on the listing and snapshot specs", () => {
    for (const name of ["search_listings", "city_snapshot"]) {
      const spec = TOOL_SPECS.find((entry) => entry.function.name === name);
      const properties = spec?.function.parameters.properties as unknown as Record<
        string,
        { description?: string }
      >;
      expect(properties.fsa?.description?.toLowerCase()).toContain("forward sortation area");
      expect(properties.fsa?.description).toContain("full postal code is accepted and reduced to its FSA");
      expect(properties.fsa?.description).toContain("rows without a postal code are excluded");
      expect(spec?.function.parameters.required).toEqual(["city"]);
    }
  });
});
