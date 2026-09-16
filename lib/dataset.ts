import { readFileSync } from "node:fs";
import path from "node:path";
import listingsJson from "../data/listings.json";
import marketSummaryJson from "../data/market_summary.json";
import type { Listing, MarketSummary } from "./types";

/** Sanitized fields plus local-only source metadata reattached by the pipeline. */
export type EnrichedListing = Listing & {
  listing_id?: string;
  url?: string;
  address?: string;
};

/** Local-only enriched file, written under output/ (gitignored) by --enriched-out. */
const ENRICHED_FILE = "output/listings_enriched.json";

/** Read the enriched rows, or null (with one warning) when the file is missing/unreadable. */
export function readEnrichedListings(file: string): EnrichedListing[] | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array of rows");
    return parsed as EnrichedListing[];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`dataset: ENRICHED_DATA=1 but ${file} could not be read (${detail}); using sanitized listings`);
    return null;
  }
}

/** Pure env-gated selection: no filesystem access unless ENRICHED_DATA is exactly "1". */
export function selectListings(
  envValue: string | undefined,
  fallback: Listing[],
  enrichedFile: string,
): { listings: EnrichedListing[]; enrichedMode: boolean } {
  if (envValue !== "1") return { listings: fallback, enrichedMode: false };
  const enriched = readEnrichedListings(enrichedFile);
  if (enriched === null) return { listings: fallback, enrichedMode: false };
  return { listings: enriched, enrichedMode: true };
}

const selected = selectListings(process.env.ENRICHED_DATA, listingsJson as Listing[], path.resolve(ENRICHED_FILE));

/** Sanitized listings shipped with the repo (see pipeline/build_dataset.py), or local enriched rows. */
export const listings = selected.listings;

/** True when `listings` came from output/listings_enriched.json (ENRICHED_DATA=1). */
export const enrichedMode = selected.enrichedMode;

/** Precomputed city statistics for the UI; tools recompute from listings at runtime. */
export const summary = marketSummaryJson as MarketSummary;
