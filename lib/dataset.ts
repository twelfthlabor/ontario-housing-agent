import listingsJson from "../data/listings.json";
import marketSummaryJson from "../data/market_summary.json";
import type { Listing, MarketSummary } from "./types";

/** Sanitized listings shipped with the repo (see pipeline/build_dataset.py). */
export const listings = listingsJson as Listing[];

/** Precomputed city statistics for the UI; tools recompute from listings at runtime. */
export const summary = marketSummaryJson as MarketSummary;
