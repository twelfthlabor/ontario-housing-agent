"use client";

import { useEffect, useState } from "react";
import { cityName, money } from "./format";

type Row = {
  city: string;
  fsa: string | null;
  price: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  address?: string;
  url?: string;
};

/** Rows requested from /api/listings; the route caps its own limit at 200. */
const LIMIT = 100;

export default function DataTable({ cities, city, onCityChange, totalRows }: { cities: string[]; city: string; onCityChange: (city: string) => void; totalRows: number }) {
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    fetch(`/api/listings?city=${encodeURIComponent(city)}&limit=${LIMIT}`)
      .then(response => (response.ok ? response.json() : Promise.reject(new Error("request failed"))))
      .then((payload: { total?: number; listings?: unknown }) => {
        if (!active) return;
        if (!Array.isArray(payload?.listings)) throw new Error("malformed payload");
        setData({ rows: payload.listings as Row[], total: typeof payload.total === "number" ? payload.total : payload.listings.length });
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [city]);

  const rows = data?.rows ?? [];

  return <div className="data-view">
    <div className="data-heading">
      <div><p className="micro-label">PUBLIC SOURCE DATA</p><h1>The rows behind the sample.</h1></div>
      <label className="data-city">City<select value={city} onChange={event => onCityChange(event.target.value)}>{cities.map(slug => <option key={slug} value={slug}>{cityName(slug)}</option>)}</select></label>
    </div>
    <div className="data-meta">
      <span>{failed ? "Could not load the sample rows." : data ? `Showing ${rows.length} of ${data.total.toLocaleString("en-CA")} listings` : "Loading listings…"}</span>
      <a href="/api/listings?format=csv" download>Download CSV · {totalRows.toLocaleString("en-CA")} rows</a>
    </div>
    <div className="data-scroll">
      <table className="data-table">
        <caption className="sr-only">Sample {cityName(city)} listings, sorted by asking price</caption>
        <thead><tr><th scope="col">Price</th><th scope="col">Beds</th><th scope="col">Baths</th><th scope="col">Sqft</th><th scope="col">FSA</th><th scope="col">Address</th><th scope="col">Source</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>
          <td className="data-price">{money(row.price)}</td>
          <td>{row.beds ?? "—"}</td>
          <td>{row.baths ?? "—"}</td>
          <td>{row.sqft === null || row.sqft === undefined ? "—" : row.sqft.toLocaleString("en-CA")}</td>
          <td>{row.fsa ?? "—"}</td>
          <td className="data-address">{row.address ?? "—"}</td>
          <td>{row.url?.startsWith("https://") ? <a href={row.url} target="_blank" rel="noopener noreferrer">View listing ↗</a> : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
