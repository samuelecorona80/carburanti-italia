#!/usr/bin/env python3
"""Fail safely if freshly generated MIMIT data looks incomplete or inconsistent."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE = ROOT / "site" / "data"

MIN_INSTALLATIONS = 20_000
MIN_PRICES = 80_000
MIN_STATIONS = 20_000
MAX_DROP_RATIO = 0.20
MAX_GROWTH_RATIO = 0.30
EXPECTED_HISTORY_SHARDS = 64


def load(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def fail(message: str) -> None:
    print(f"VALIDATION ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def previous_latest() -> dict | None:
    try:
        raw = subprocess.check_output(
            ["git", "show", "HEAD:data/latest.json"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        return json.loads(raw)
    except Exception:
        return None


def compare_ratio(name: str, current: int, previous: int | None) -> None:
    if not previous or previous <= 0:
        return
    ratio = current / previous
    if ratio < 1 - MAX_DROP_RATIO:
        fail(f"{name} dropped by {(1-ratio)*100:.1f}% ({previous} -> {current})")
    if ratio > 1 + MAX_GROWTH_RATIO:
        fail(f"{name} grew by {(ratio-1)*100:.1f}% ({previous} -> {current})")


def assert_mirrored(filename: str) -> None:
    a = DATA / filename
    b = SITE / filename
    if not a.exists() or not b.exists():
        fail(f"missing mirrored file {filename}")
    if a.read_bytes() != b.read_bytes():
        fail(f"data/{filename} and site/data/{filename} differ")


def main() -> None:
    required = [
        DATA / "latest.json",
        DATA / "history.json",
        DATA / "last_update.json",
        DATA / "stations.json",
        DATA / "station_history_summary.json",
    ]
    for path in required:
        if not path.exists() or path.stat().st_size == 0:
            fail(f"missing or empty {path.relative_to(ROOT)}")

    latest = load(DATA / "latest.json")
    stations = load(DATA / "stations.json")
    history = load(DATA / "history.json")
    last_update = load(DATA / "last_update.json")
    summary = load(DATA / "station_history_summary.json")

    if latest.get("data") != date.today().isoformat():
        fail(f"latest.json date is {latest.get('data')}, expected {date.today().isoformat()}")

    installations = int(latest.get("totale_impianti") or 0)
    prices = int(latest.get("totale_prezzi") or 0)
    station_count = len(stations) if isinstance(stations, list) else 0

    if installations < MIN_INSTALLATIONS:
        fail(f"only {installations} installations")
    if prices < MIN_PRICES:
        fail(f"only {prices} valid price rows")
    if station_count < MIN_STATIONS:
        fail(f"only {station_count} stations with prices")

    if not isinstance(history, list) or not history:
        fail("history.json is empty")
    if len(history) > 91:
        fail(f"history.json unexpectedly has {len(history)} entries")
    if history[-1].get("data") != latest.get("data"):
        fail("history.json does not end with the current data date")

    if last_update.get("esito") != "ok":
        fail("last_update.json does not report esito=ok")
    if last_update.get("data_riferimento") != latest.get("data"):
        fail("last_update.json date differs from latest.json")

    national = latest.get("nazionale") or {}
    for fuel in ("Benzina", "Gasolio"):
        self_stats = (national.get(fuel) or {}).get("self") or {}
        avg = self_stats.get("media")
        if avg is None or not (0.9 <= float(avg) <= 4.0):
            fail(f"invalid national self average for {fuel}: {avg}")

    prev = previous_latest()
    if prev:
        compare_ratio("installations", installations, int(prev.get("totale_impianti") or 0))
        compare_ratio("prices", prices, int(prev.get("totale_prezzi") or 0))

    for filename in (
        "latest.json",
        "history.json",
        "last_update.json",
        "stations.json",
        "station_history_summary.json",
    ):
        assert_mirrored(filename)

    data_shards = sorted((DATA / "station_history").glob("*.json"))
    site_shards = sorted((SITE / "station_history").glob("*.json"))
    if len(data_shards) != EXPECTED_HISTORY_SHARDS:
        fail(f"expected {EXPECTED_HISTORY_SHARDS} history shards, found {len(data_shards)}")
    if len(site_shards) != EXPECTED_HISTORY_SHARDS:
        fail(f"site has {len(site_shards)} history shards, expected {EXPECTED_HISTORY_SHARDS}")

    if not isinstance(summary, dict) or not isinstance(summary.get("stations"), dict):
        fail("station_history_summary.json has invalid structure")

    print(
        "Validation OK: "
        f"{installations} installations, {prices} prices, {station_count} stations, "
        f"{len(data_shards)} history shards"
    )


if __name__ == "__main__":
    main()
