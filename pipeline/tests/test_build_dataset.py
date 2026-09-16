#!/usr/bin/env python3
"""Tests for pipeline/build_dataset.py (stdlib unittest, offline)."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "pipeline" / "build_dataset.py"
FIXTURES = ROOT / "pipeline" / "fixtures"
EPOCH = "1700000000"  # fixed so generated_at is reproducible in tests


def load_module():
    spec = importlib.util.spec_from_file_location("build_dataset", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULE = load_module()


def run_pipeline(
    out_dir: Path, source: Path = FIXTURES, enriched_out: Path | None = None
) -> subprocess.CompletedProcess:
    command = [sys.executable, str(SCRIPT), "--source", str(source), "--out", str(out_dir)]
    if enriched_out is not None:
        command += ["--enriched-out", str(enriched_out)]
    env = os.environ.copy()
    env["SOURCE_DATE_EPOCH"] = EPOCH
    return subprocess.run(command, capture_output=True, text=True, env=env, check=False)


def data_digests() -> dict[str, str]:
    return {
        name: hashlib.sha256((ROOT / "data" / name).read_bytes()).hexdigest()
        for name in ("listings.json", "market_summary.json")
    }


def report_number(output: str, label: str) -> int:
    match = re.search(rf"{re.escape(label)}: (\d+)", output)
    if match is None:
        raise AssertionError(f"report label not found: {label!r}\n{output}")
    return int(match.group(1))


EXPECTED_LISTINGS = [
    {"city": "ottawa", "fsa": "K1A", "price": 650000, "beds": 4, "baths": 3, "sqft": 1700, "seen": "2026-09-01"},
    {"city": "ottawa", "fsa": "K1A", "price": 500000, "beds": 3, "baths": 2, "sqft": 1400, "seen": "2026-09-01"},
    {"city": "ottawa", "fsa": "K1P", "price": 250000, "beds": None, "baths": 2, "sqft": None, "seen": "2026-09-01"},
    {"city": "toronto", "fsa": "M5C", "price": 5000000, "beds": None, "baths": None, "sqft": None, "seen": "2026-09-04"},
    {"city": "toronto", "fsa": "M5X", "price": 2000000, "beds": 3, "baths": 2, "sqft": None, "seen": "2026-09-04"},
    {"city": "toronto", "fsa": "M4N", "price": 1200000, "beds": 3, "baths": 2, "sqft": 1100, "seen": "2026-09-02"},
    {"city": "toronto", "fsa": "M5H", "price": 950000, "beds": 2, "baths": 2, "sqft": 850, "seen": "2026-09-05"},
    {"city": "toronto", "fsa": "M5V", "price": 800000, "beds": None, "baths": None, "sqft": None, "seen": "2026-09-03"},
    {"city": "toronto", "fsa": None, "price": 700000, "beds": 1, "baths": 1, "sqft": None, "seen": "2026-09-03"},
]


class PipelineEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "out"
        cls.proc = run_pipeline(cls.out)
        cls.listings = json.loads((cls.out / "listings.json").read_text(encoding="utf-8"))
        cls.summary = json.loads((cls.out / "market_summary.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_exit_code_and_outputs(self):
        self.assertEqual(self.proc.returncode, 0, self.proc.stderr)
        self.assertTrue((self.out / "listings.json").is_file())
        self.assertTrue((self.out / "market_summary.json").is_file())

    def test_filter_report_counts(self):
        out = self.proc.stdout
        self.assertEqual(report_number(out, "rows read"), 17)
        self.assertEqual(report_number(out, "unique listing_ids"), 14)
        self.assertEqual(report_number(out, "kept"), 9)
        self.assertEqual(report_number(out, "malformed rows"), 2)
        self.assertEqual(report_number(out, "duplicate listing_id"), 1)
        self.assertEqual(report_number(out, "non-ON address"), 1)
        self.assertEqual(report_number(out, "price below 50000"), 1)
        self.assertEqual(report_number(out, "unparseable price"), 1)
        self.assertEqual(report_number(out, "invalid beds/baths"), 2)
        self.assertEqual(report_number(out, "implausible sqft (nulled)"), 2)
        self.assertEqual(report_number(out, "cities"), 2)

    def test_listings_sanitized_sorted_and_transformed(self):
        self.assertEqual(self.listings, EXPECTED_LISTINGS)
        for row in self.listings:
            self.assertEqual(
                set(row),
                {"city", "fsa", "price", "beds", "baths", "sqft", "seen"},
            )

    def test_dedupe_keeps_newest_timestamp(self):
        t1 = [row for row in self.listings if row["city"] == "toronto" and row["price"] in (900000, 950000)]
        self.assertEqual([row["price"] for row in t1], [950000])
        self.assertEqual(t1[0]["seen"], "2026-09-05")

    def test_drops(self):
        prices = {row["price"] for row in self.listings}
        self.assertNotIn(1, prices)  # $1 placeholder
        self.assertNotIn(400000, prices)  # invalid baths (15)
        toronto_prices = sorted(row["price"] for row in self.listings if row["city"] == "toronto")
        self.assertEqual(toronto_prices, [700000, 800000, 950000, 1200000, 2000000, 5000000])
        self.assertNotIn(600000, prices)  # malformed short row

    def test_implausible_sqft_nulled_not_dropped(self):
        by_price = {row["price"]: row for row in self.listings}
        self.assertIsNone(by_price[5000000]["sqft"])  # 22 (lot acreage)
        self.assertIsNone(by_price[2000000]["sqft"])  # 25000 (non-residential)
        self.assertEqual(len(self.listings), 9)  # rows survive, only sqft is null

    def test_market_summary(self):
        self.assertEqual(self.summary["source"], "zillow research sample")
        self.assertEqual(self.summary["generated_at"], "2023-11-14T22:13:20Z")
        self.assertEqual(self.summary["totals"], {"rows": 9, "cities": 2})

        toronto = self.summary["cities"]["toronto"]
        self.assertEqual(toronto["count"], 6)
        self.assertEqual(toronto["medianPrice"], 1075000)
        self.assertEqual(toronto["q1Price"], 800000)
        self.assertEqual(toronto["q3Price"], 2000000)
        self.assertEqual(toronto["shareUnder1M"], 0.5)
        self.assertIsNone(toronto["medianSqft"])  # only 2 plausible samples
        self.assertEqual(toronto["updated"], "2026-09-05")
        self.assertEqual(
            toronto["medianByBeds"],
            {"1": 700000, "2": 950000, "3": 1600000, "4": None, "5+": None},
        )

        ottawa = self.summary["cities"]["ottawa"]
        self.assertEqual(ottawa["count"], 3)
        self.assertEqual(ottawa["medianPrice"], 500000)
        self.assertEqual(ottawa["q1Price"], 250000)
        self.assertEqual(ottawa["q3Price"], 650000)
        self.assertEqual(ottawa["shareUnder1M"], 1)
        self.assertIsNone(ottawa["medianSqft"])  # only 2 plausible samples
        self.assertEqual(ottawa["updated"], "2026-09-01")
        self.assertEqual(
            ottawa["medianByBeds"],
            {"1": None, "2": None, "3": 500000, "4": 650000, "5+": None},
        )

    def test_idempotent_across_runs(self):
        with tempfile.TemporaryDirectory() as other_tmp:
            other = Path(other_tmp) / "out"
            second = run_pipeline(other)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(
                (other / "listings.json").read_bytes(),
                (self.out / "listings.json").read_bytes(),
            )
            self.assertEqual(
                (other / "market_summary.json").read_bytes(),
                (self.out / "market_summary.json").read_bytes(),
            )

    def test_refuses_empty_source_without_clobbering_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "empty-source"
            source.mkdir()
            out = Path(tmp) / "out"
            out.mkdir()
            sentinel = out / "listings.json"
            sentinel.write_text("keep me", encoding="utf-8")
            proc = run_pipeline(out, source=source)
            self.assertEqual(proc.returncode, 2)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep me")


class EnrichedOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.plain_out = base / "plain"
        cls.enriched_out = base / "enriched"
        cls.enriched_path = base / "listings_enriched.json"
        cls.digests_before = data_digests()
        cls.plain = run_pipeline(cls.plain_out)
        cls.enriched_run = run_pipeline(cls.enriched_out, enriched_out=cls.enriched_path)
        cls.digests_after = data_digests()
        cls.listings = json.loads((cls.plain_out / "listings.json").read_text(encoding="utf-8"))
        cls.enriched = json.loads(cls.enriched_path.read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_runs_succeed(self):
        self.assertEqual(self.plain.returncode, 0, self.plain.stderr)
        self.assertEqual(self.enriched_run.returncode, 0, self.enriched_run.stderr)

    def test_sanitized_output_identical_with_and_without_flag(self):
        for name in ("listings.json", "market_summary.json"):
            self.assertEqual(
                (self.enriched_out / name).read_bytes(),
                (self.plain_out / name).read_bytes(),
                name,
            )

    def test_row_count_parity_and_enriched_fields(self):
        self.assertEqual(len(self.enriched), len(self.listings))
        for row in self.enriched:
            self.assertEqual(
                set(row),
                {"city", "fsa", "price", "beds", "baths", "sqft", "seen", "listing_id", "url", "address"},
            )

    def test_enriched_rows_map_one_to_one_onto_sanitized(self):
        stripped = [{field: row[field] for field in MODULE.SANITIZED_FIELDS} for row in self.enriched]
        self.assertEqual(stripped, self.listings)

    def test_enriched_carries_deduped_source_url_and_address(self):
        by_price = {row["price"]: row for row in self.enriched}
        deduped = by_price[950000]  # T1; the newest scraped_at wins dedupe
        self.assertEqual(deduped["listing_id"], "T1")
        self.assertEqual(deduped["url"], "https://example.com/t1")
        self.assertEqual(deduped["address"], "10 King St W, Toronto, ON M5H 1A1")
        self.assertTrue(all(row["url"] and row["address"] for row in self.enriched))

    def test_plain_run_writes_no_enriched_file(self):
        self.assertFalse((self.plain_out / "listings_enriched.json").exists())

    def test_data_dir_untouched(self):
        self.assertEqual(self.digests_before, self.digests_after)


class EnrichedOutGuard(unittest.TestCase):
    def test_refuses_enriched_path_inside_sanitized_output_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "data"
            enriched = out / "listings_enriched.json"
            proc = run_pipeline(out, enriched_out=enriched)
            self.assertEqual(proc.returncode, 2)
            self.assertIn("output/", proc.stderr)
            self.assertFalse(enriched.exists())
            self.assertFalse((out / "listings.json").exists())

    def test_refuses_enriched_path_equal_to_sanitized_output_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "data"
            proc = run_pipeline(out, enriched_out=out)
            self.assertEqual(proc.returncode, 2)
            self.assertIn("output/", proc.stderr)

    def test_refuses_case_variant_inside_sanitized_output_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "caseout"
            enriched = Path(tmp) / "CASEOUT" / "listings_enriched.json"
            proc = run_pipeline(out, enriched_out=enriched)
            self.assertEqual(proc.returncode, 2)
            self.assertIn("output/", proc.stderr)
            self.assertFalse(enriched.exists())
            self.assertFalse((out / "listings.json").exists())

    def test_allows_tmp_dir_enriched_path_outside_sanitized_output_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            enriched = base / "output" / "listings_enriched.json"
            proc = run_pipeline(base / "data", enriched_out=enriched)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(enriched.is_file())


class PureHelpers(unittest.TestCase):
    def test_should_replace(self):
        older = MODULE.parse_timestamp("2026-09-01T00:00:00Z")
        newer = MODULE.parse_timestamp("2026-09-05T00:00:00Z")
        self.assertTrue(MODULE.should_replace(newer, 1, older, 2))
        self.assertFalse(MODULE.should_replace(older, 2, newer, 1))
        # equal timestamps fall back to encounter order
        self.assertTrue(MODULE.should_replace(newer, 2, newer, 1))
        # unparseable timestamps fall back to encounter order
        self.assertTrue(MODULE.should_replace(None, 5, older, 4))
        self.assertFalse(MODULE.should_replace(None, 4, None, 5))

    def test_parse_money(self):
        self.assertEqual(MODULE.parse_money("$1,288,000"), 1288000.0)
        self.assertEqual(MODULE.parse_money("50000"), 50000.0)
        self.assertIsNone(MODULE.parse_money("N/A"))
        self.assertIsNone(MODULE.parse_money(""))

    def test_parse_optional_int(self):
        self.assertEqual(MODULE.parse_optional_int("", 1, 12), (True, None))
        self.assertEqual(MODULE.parse_optional_int("2", 1, 12), (True, 2))
        self.assertEqual(MODULE.parse_optional_int("0", 1, 12), (False, None))
        self.assertEqual(MODULE.parse_optional_int("13", 1, 12), (False, None))
        self.assertEqual(MODULE.parse_optional_int("abc", 1, 12), (False, None))

    def test_extract_fsa(self):
        self.assertEqual(MODULE.extract_fsa("20 Queen St, Toronto, ON M4N 2G7"), "M4N")
        self.assertIsNone(MODULE.extract_fsa("70 Bloor St W, Toronto, ON"))
        self.assertIsNone(MODULE.extract_fsa("40 Elm St, Buffalo, NY 14201"))

    def test_median_and_quartiles(self):
        self.assertEqual(MODULE.median([700000, 800000, 950000, 1200000]), 875000)
        self.assertEqual(MODULE.median([250000, 500000, 650000]), 500000)
        self.assertEqual(
            MODULE.quartiles([700000, 800000, 950000, 1200000]),
            (750000, 1075000),
        )
        self.assertEqual(MODULE.quartiles([250000, 500000, 650000]), (250000, 650000))

    def test_round_half_up_matches_js_math_round(self):
        self.assertEqual(MODULE.round_half_up(0.0625, 3), 0.063)
        self.assertEqual(MODULE.round_half_up(0.75, 3), 0.75)
        self.assertEqual(MODULE.round_half_up(1.0, 3), 1.0)

    def test_seen_date(self):
        self.assertEqual(MODULE.seen_date("2026-09-05T10:00:00Z"), "2026-09-05")
        self.assertEqual(MODULE.seen_date("2026-09-05"), "2026-09-05")
        self.assertEqual(MODULE.seen_date("not-a-date"), "")
        self.assertEqual(MODULE.seen_date(None), "")

    def test_parse_sqft_and_plausibility(self):
        self.assertEqual(MODULE.parse_sqft("1,500"), 1500)
        self.assertEqual(MODULE.parse_sqft("0"), 0)
        self.assertIsNone(MODULE.parse_sqft("N/A"))
        self.assertIsNone(MODULE.parse_sqft(""))
        self.assertFalse(MODULE.is_plausible_sqft(199))
        self.assertTrue(MODULE.is_plausible_sqft(200))
        self.assertTrue(MODULE.is_plausible_sqft(20000))
        self.assertFalse(MODULE.is_plausible_sqft(20001))
        self.assertFalse(MODULE.is_plausible_sqft(0))

    def test_median_sqft_requires_min_samples(self):
        def row(price, sqft):
            return {
                "city": "testville",
                "fsa": None,
                "price": price,
                "beds": 2,
                "baths": 1,
                "sqft": sqft,
                "seen": "2026-09-01",
            }

        nine = [row(500000 + i, 1000 + i) for i in range(9)]
        summary_nine = MODULE.build_summary(nine, "2026-09-01T00:00:00Z")
        self.assertIsNone(summary_nine["cities"]["testville"]["medianSqft"])

        ten = nine + [row(600000, 1500)]
        summary_ten = MODULE.build_summary(ten, "2026-09-01T00:00:00Z")
        self.assertEqual(summary_ten["cities"]["testville"]["medianSqft"], 1004.5)

    def test_default_source_is_relative(self):
        self.assertFalse(MODULE.DEFAULT_SOURCE.is_absolute())
        self.assertNotIn("/Users/", str(MODULE.DEFAULT_SOURCE))
        self.assertEqual(str(MODULE.DEFAULT_SOURCE), "../property-scraper/data/regions")

    def test_is_within(self):
        self.assertTrue(MODULE.is_within(Path("/tmp/x/data/listings_enriched.json"), Path("/tmp/x/data")))
        self.assertTrue(MODULE.is_within(Path("/tmp/x/data"), Path("/tmp/x/data")))
        self.assertTrue(MODULE.is_within(Path("/tmp/x/DATA/listings_enriched.json"), Path("/tmp/x/data")))
        self.assertFalse(MODULE.is_within(Path("/tmp/x/output/listings_enriched.json"), Path("/tmp/x/data")))
        self.assertFalse(MODULE.is_within(Path("/tmp/x/data-other/listings_enriched.json"), Path("/tmp/x/data")))


if __name__ == "__main__":
    unittest.main()
