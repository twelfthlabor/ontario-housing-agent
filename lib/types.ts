export type Listing = {
  city: string;
  fsa: string | null;
  price: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  seen: string;
};

export type CitySnapshot = {
  city: string;
  count: number;
  medianPrice: number;
  q1Price: number;
  q3Price: number;
  medianByBeds: Record<string, number | null>;
  shareUnder1M: number;
  medianSqft: number | null;
  updated: string;
};

/** Entry as stored in market_summary.json (the city name is the key there). */
export type CitySummary = Omit<CitySnapshot, "city">;

export type MarketSummary = {
  generated_at: string;
  source: string;
  totals: { rows: number; cities: number };
  cities: Record<string, CitySummary>;
};

export type SearchQuery = {
  city: string;
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  sort?: "price_asc" | "price_desc";
  limit?: number;
};

export type SearchResult = {
  totalMatches: number;
  returned: number;
  listings: Listing[];
};
