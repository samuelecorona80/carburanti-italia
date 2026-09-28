#!/usr/bin/env python3
"""Lightweight smoke test for the generated static site and data."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DATA = SITE / "data"


def fail(message: str) -> None:
    print(f"SMOKE TEST ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path):
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        fail(f"cannot parse {path.relative_to(ROOT)}: {exc}")


def main() -> None:
    required_files = [
        SITE / "index.html",
        SITE / "cerca.html",
        SITE / "statistiche.html",
        SITE / "dati-utili.html",
        SITE / "app.js",
        SITE / "cerca.js",
        SITE / "style.css",
        DATA / "latest.json",
        DATA / "last_update.json",
        DATA / "stations.json",
        DATA / "station_history_summary.json",
    ]

    for path in required_files:
        if not path.exists() or path.stat().st_size == 0:
            fail(f"missing or empty {path.relative_to(ROOT)}")

    index = (SITE / "index.html").read_text(encoding="utf-8")
    for token in (
        'id="search"',
        'id="refresh-btn"',
        'id="freshness-warning"',
        'data/stations.json',
        'data/last_update.json',
    ):
        if token not in index:
            fail(f"index.html missing expected token: {token}")

    cerca = (SITE / "cerca.html").read_text(encoding="utf-8")
    for token in (
        'data/stations.json',
        'router.project-osrm.org',
        'nominatim.openstreetmap.org',
        'function doPoint',
        'function fetchRoute',
    ):
        if token not in cerca:
            fail(f"cerca.html missing expected behavior token: {token}")

    insights = (SITE / "dati-utili.html").read_text(encoding="utf-8")
    for token in (
        "Giorno storicamente più basso",
        "Orario migliore?",
        "data/latest.json",
        "data/history.json",
        "data/stations.json",
    ):
        if token not in insights:
            fail(f"dati-utili.html missing expected token: {token}")

    latest = load_json(DATA / "latest.json")
    last_update = load_json(DATA / "last_update.json")
    stations = load_json(DATA / "stations.json")
    summary = load_json(DATA / "station_history_summary.json")

    if not latest.get("data"):
        fail("latest.json has no data field")
    if last_update.get("esito") != "ok":
        fail("last_update.json does not report esito=ok")
    if not isinstance(stations, list) or len(stations) < 20_000:
        fail(f"unexpected stations count: {len(stations) if isinstance(stations, list) else 'invalid'}")
    if not isinstance(summary, dict) or not isinstance(summary.get("stations"), dict):
        fail("invalid station_history_summary.json")

    sample = next((s for s in stations if isinstance(s, dict) and s.get("lat") and s.get("lng") and s.get("prezzi")), None)
    if not sample:
        fail("no usable station sample found")

    if not any((DATA / "station_history").glob("*.json")):
        fail("station history shards are missing")

    print(
        "Smoke test OK: static pages present, JSON parseable, "
        f"{len(stations)} stations, sample station {sample.get('id')}"
    )


if __name__ == "__main__":
    main()
