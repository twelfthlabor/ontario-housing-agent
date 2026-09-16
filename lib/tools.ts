import { listings } from "./dataset";
import type { CitySnapshot, Listing, SearchQuery, SearchResult, SnapshotQuery } from "./types";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;
const MIN_SQFT_SAMPLES = 10;
const BED_BUCKETS = ["1", "2", "3", "4", "5+"];

const byCity = new Map<string, Listing[]>();
for (const listing of listings) {
  const key = listing.city.toLowerCase();
  const bucket = byCity.get(key);
  if (bucket) bucket.push(listing);
  else byCity.set(key, [listing]);
}

function medianOfSorted(values: number[]): number | null {
  const count = values.length;
  if (count === 0) return null;
  const mid = Math.floor(count / 2);
  return count % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function quartilesOfSorted(values: number[]): [number | null, number | null] {
  const count = values.length;
  if (count === 0) return [null, null];
  const med = medianOfSorted(values);
  const lower = values.slice(0, Math.floor(count / 2));
  const upper = values.slice(Math.floor((count + 1) / 2));
  const q1 = lower.length ? medianOfSorted(lower) : med;
  const q3 = upper.length ? medianOfSorted(upper) : med;
  return [q1, q3];
}

function roundHalfUp(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.floor(value * factor + 0.5) / factor;
}

function bedMatches(beds: number | null, bucket: string): boolean {
  if (beds === null) return false;
  if (bucket === "5+") return beds >= 5;
  return beds === Number(bucket);
}

function computeSnapshot(city: string, rows: Listing[]): CitySnapshot {
  const prices = rows.map((row) => row.price).sort((a, b) => a - b);
  const sqfts = rows
    .filter((row) => row.sqft !== null)
    .map((row) => row.sqft as number)
    .sort((a, b) => a - b);

  const medianByBeds: Record<string, number | null> = {};
  for (const bucket of BED_BUCKETS) {
    const bucketPrices = rows
      .filter((row) => bedMatches(row.beds, bucket))
      .map((row) => row.price)
      .sort((a, b) => a - b);
    medianByBeds[bucket] = medianOfSorted(bucketPrices);
  }

  const [q1Price, q3Price] = quartilesOfSorted(prices);
  const under1M = rows.filter((row) => row.price < 1_000_000).length;

  return {
    city,
    count: rows.length,
    medianPrice: medianOfSorted(prices) as number,
    q1Price: q1Price as number,
    q3Price: q3Price as number,
    medianByBeds,
    shareUnder1M: roundHalfUp(under1M / rows.length, 3),
    medianSqft: sqfts.length >= MIN_SQFT_SAMPLES ? medianOfSorted(sqfts) : null,
    updated: rows.reduce((latest, row) => (row.seen > latest ? row.seen : latest), ""),
  };
}

const snapshots = new Map<string, CitySnapshot>();
for (const [city, rows] of byCity) {
  snapshots.set(city, computeSnapshot(city, rows));
}

function normaliseCity(city: string): string {
  if (typeof city !== "string") return "";
  return city
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/[\s_]+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .replace(/-+/g, "-");
}

function finiteOrUndefined(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const FSA_RE = /^[A-Z]\d[A-Z]/;

/** Forward sortation area: leading FSA of a full postal code, case-insensitive. */
function normaliseFsa(value: unknown): string {
  if (typeof value !== "string") return "";
  const upper = value.trim().toUpperCase();
  return FSA_RE.exec(upper)?.[0] ?? upper;
}

function normaliseLimit(value: number | undefined): number {
  const requested = finiteOrUndefined(value);
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);
}

export function searchListings(q: SearchQuery): SearchResult {
  const city = normaliseCity(q?.city);
  const rows = byCity.get(city) ?? [];
  const fsa = normaliseFsa(q?.fsa);
  const minPrice = finiteOrUndefined(q?.minPrice);
  const maxPrice = finiteOrUndefined(q?.maxPrice);
  const beds = finiteOrUndefined(q?.beds);

  const filtered = rows.filter(
    (row) =>
      (fsa === "" || normaliseFsa(row.fsa) === fsa) &&
      (minPrice === undefined || row.price >= minPrice) &&
      (maxPrice === undefined || row.price <= maxPrice) &&
      (beds === undefined || row.beds === beds),
  );

  const descending = q?.sort === "price_desc";
  const sorted = filtered
    .slice()
    .sort((a, b) => (descending ? b.price - a.price : a.price - b.price));

  const page = sorted.slice(0, normaliseLimit(q?.limit));

  return {
    totalMatches: sorted.length,
    returned: page.length,
    listings: page.map((row) => ({ ...row })),
  };
}

export function citySnapshot(query: SnapshotQuery | string): CitySnapshot | null {
  const city = typeof query === "string" ? query : asString(query?.city);
  const fsa = typeof query === "string" ? "" : normaliseFsa(query?.fsa);
  const key = normaliseCity(city);
  const rows = byCity.get(key);
  if (!rows) return null;
  if (!fsa) {
    const snapshot = snapshots.get(key);
    if (!snapshot) return null;
    return { ...snapshot, medianByBeds: { ...snapshot.medianByBeds } };
  }
  const scoped = rows.filter((row) => normaliseFsa(row.fsa) === fsa);
  if (scoped.length === 0) return null;
  return computeSnapshot(key, scoped);
}

export function compareCities(cities: string[]): CitySnapshot[] {
  if (!Array.isArray(cities)) return [];
  const result: CitySnapshot[] = [];
  for (const city of cities) {
    const snapshot = citySnapshot(city);
    if (snapshot) result.push(snapshot);
  }
  return result;
}

export function knownCities(): string[] {
  return [...byCity.keys()].sort();
}

const NEVER_INVENT =
  "Use this tool for every price, listing, or statistic claim; never invent numbers.";

export const TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "search_listings",
      description:
        `Search for-sale listings in one Ontario city, optionally filtered by price range, exact bedroom count, and forward sortation area. ` +
        `Returns the matching listings plus totalMatches (the full count before limit). Sorted by price ascending by default. ` +
        `Use maxPrice when a question is about what a budget can afford. ${NEVER_INVENT}`,
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: 'City name, case-insensitive (for example "toronto").',
          },
          fsa: {
            type: "string",
            description:
              '3-character forward sortation area (FSA), case-insensitive (for example "M6P"); a full postal code is accepted and reduced to its FSA; rows without a postal code are excluded. Narrows results to that part of the city.',
          },
          minPrice: {
            type: "number",
            description: "Minimum price in CAD, inclusive.",
          },
          maxPrice: {
            type: "number",
            description: "Maximum price in CAD, inclusive.",
          },
          beds: {
            type: "integer",
            minimum: 1,
            maximum: 12,
            description: "Exact number of bedrooms.",
          },
          sort: {
            type: "string",
            enum: ["price_asc", "price_desc"],
            description: "Price sort order. Defaults to price_asc.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 25,
            description: "Maximum listings to return. Defaults to 5, capped at 25.",
          },
        },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "city_snapshot",
      description:
        `Get the market snapshot for one Ontario city, optionally scoped to a forward sortation area: listing count, median price, first/third quartile prices, ` +
        `median price by bedroom count, share of listings under $1M, and median square footage. ` +
        `Returns null for an unknown city or an unknown forward sortation area. Use this for counts and market statistics; use search_listings for budget or filtered-listing questions. ${NEVER_INVENT}`,
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: 'City name, case-insensitive (for example "ottawa").',
          },
          fsa: {
            type: "string",
            description:
              'Optional 3-character forward sortation area (FSA), case-insensitive (for example "K1S"); a full postal code is accepted and reduced to its FSA; rows without a postal code are excluded. Scopes the snapshot to that part of the city.',
          },
        },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_cities",
      description:
        `Get market snapshots for several Ontario cities in one call, in the order requested. ` +
        `Unknown cities are skipped. ${NEVER_INVENT}`,
      parameters: {
        type: "object",
        properties: {
          cities: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 10,
            description: "City names, case-insensitive.",
          },
        },
        required: ["cities"],
        additionalProperties: false,
      },
    },
  },
];

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export const TOOL_IMPLS: Record<string, (args: any) => unknown> = {
  search_listings: (args: any) =>
    searchListings({
      city: asString(args?.city),
      fsa: asString(args?.fsa),
      minPrice: asNumber(args?.minPrice),
      maxPrice: asNumber(args?.maxPrice),
      beds: asNumber(args?.beds),
      sort:
        args?.sort === "price_desc" ? "price_desc" : args?.sort === "price_asc" ? "price_asc" : undefined,
      limit: asNumber(args?.limit),
    }),
  city_snapshot: (args: any) => citySnapshot({ city: asString(args?.city), fsa: asString(args?.fsa) }),
  compare_cities: (args: any) =>
    compareCities(
      Array.isArray(args?.cities) ? args.cities.map(asString).filter((city: string) => city !== "") : [],
    ),
};
