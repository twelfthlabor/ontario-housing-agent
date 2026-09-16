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

const cities = Object.keys(summary.cities);
const topCity = cities.reduce(
  (best, city) => (summary.cities[city].count > summary.cities[best].count ? city : best),
  cities[0],
);
const topCount = summary.cities[topCity].count;

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
  });
});
