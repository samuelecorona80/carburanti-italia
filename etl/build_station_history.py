#!/usr/bin/env python3
"""Build compact 30-day per-station price history with a 5 km local benchmark.

History is sharded so the browser only downloads the shard containing the
selected station. Each point stores [date, price_milli, delta_vs_zone_milli,
neighbour_count]. The local benchmark excludes the selected station and uses
other stations within 5 km with the same fuel/mode.
"""

from __future__ import annotations

import json
import math
import subprocess
from collections import defaultdict
from datetime import date
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SITE_DATA_DIR = BASE_DIR / "site" / "data"
HISTORY_DIR = DATA_DIR / "station_history"
SITE_HISTORY_DIR = SITE_DATA_DIR / "station_history"

DAYS = 30
SHARDS = 64
ZONE_KM = 5.0
GRID_DEG = 0.05

FUEL_CODES = {
    "Gasolio": "G",
    "Benzina": "B",
    "GPL": "L",
    "Metano": "M",
}
MODE_CODES = {"self": "s", "servito": "v"}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def station_shard(station_id) -> int:
    h = 0
    for ch in str(station_id):
        h = (h * 31 + ord(ch)) % SHARDS
    return h


def price_map(station: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for fuel, modes in (station.get("prezzi") or {}).items():
        fc = FUEL_CODES.get(fuel)
        if not fc or not isinstance(modes, dict):
            continue
        for mode, value in modes.items():
            mc = MODE_CODES.get(mode)
            try:
                price = float(value)
            except (TypeError, ValueError):
                continue
            if mc and price > 0:
                out[f"{fc}_{mc}"] = price
    return out


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def build_points(snapshot_date: str, stations: list[dict]) -> dict[int, dict[str, dict[str, list]]]:
    """Return shard -> station_id -> key -> point for one daily snapshot."""
    normalized = []
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)

    for s in stations:
        try:
            lat = float(s.get("lat"))
            lng = float(s.get("lng"))
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        prices = price_map(s)
        if not prices:
            continue
        idx = len(normalized)
        normalized.append({"id": s.get("id"), "lat": lat, "lng": lng, "prices": prices})
        grid[(math.floor(lat / GRID_DEG), math.floor(lng / GRID_DEG))].append(idx)

    updates: dict[int, dict[str, dict[str, list]]] = defaultdict(dict)

    for i, s in enumerate(normalized):
        cy = math.floor(s["lat"] / GRID_DEG)
        cx = math.floor(s["lng"] / GRID_DEG)
        neighbour_indexes: list[int] = []
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                for j in grid.get((cy + dy, cx + dx), []):
                    if j == i:
                        continue
                    n = normalized[j]
                    if haversine(s["lat"], s["lng"], n["lat"], n["lng"]) <= ZONE_KM:
                        neighbour_indexes.append(j)

        sid = str(s["id"])
        record: dict[str, list] = {}
        for key, price in s["prices"].items():
            vals = [normalized[j]["prices"][key] for j in neighbour_indexes if key in normalized[j]["prices"]]
            if vals:
                zone_avg = sum(vals) / len(vals)
                delta_milli = int(round((price - zone_avg) * 1000))
                neighbours = len(vals)
            else:
                delta_milli = None
                neighbours = 0
            record[key] = [snapshot_date, int(round(price * 1000)), delta_milli, neighbours]

        updates[station_shard(sid)][sid] = record

    return updates


def load_shards() -> list[dict]:
    shards = []
    for n in range(SHARDS):
        path = HISTORY_DIR / f"{n:02d}.json"
        if path.exists():
            try:
                payload = load_json(path)
                stations = payload.get("stations", {}) if isinstance(payload, dict) else {}
            except Exception:
                stations = {}
        else:
            stations = {}
        shards.append(stations)
    return shards


def merge_updates(shards: list[dict], updates: dict[int, dict[str, dict[str, list]]]):
    for shard_num, station_updates in updates.items():
        shard = shards[shard_num]
        for sid, key_updates in station_updates.items():
            station_hist = shard.setdefault(sid, {})
            for key, point in key_updates.items():
                arr = station_hist.setdefault(key, [])
                arr = [p for p in arr if p and p[0] != point[0]]
                arr.append(point)
                arr.sort(key=lambda p: p[0])
                station_hist[key] = arr[-DAYS:]


def save_shards(shards: list[dict]):
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    SITE_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    meta = {"days": DAYS, "zone_km": ZONE_KM, "schema": 1}
    for n, stations in enumerate(shards):
        payload = {"meta": meta, "stations": stations}
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        (HISTORY_DIR / f"{n:02d}.json").write_text(text, encoding="utf-8")
        (SITE_HISTORY_DIR / f"{n:02d}.json").write_text(text, encoding="utf-8")


def git_snapshots_before(current_date: str, limit: int) -> list[tuple[str, str]]:
    """Return [(date, sha)] oldest->newest, one snapshot per day."""
    try:
        out = subprocess.check_output(
            ["git", "log", "--format=%H|%cs", "--", "site/data/stations.json"],
            cwd=BASE_DIR,
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return []

    chosen: dict[str, str] = {}
    for line in out.splitlines():
        if "|" not in line:
            continue
        sha, day = line.split("|", 1)
        if day >= current_date or day in chosen:
            continue
        chosen[day] = sha
        if len(chosen) >= limit:
            break
    return sorted(chosen.items())


def load_git_snapshot(sha: str) -> list[dict] | None:
    try:
        raw = subprocess.check_output(
            ["git", "show", f"{sha}:site/data/stations.json"],
            cwd=BASE_DIR,
            stderr=subprocess.DEVNULL,
        )
        return json.loads(raw.decode("utf-8"))
    except Exception as exc:
        print(f"Warning: unable to load snapshot {sha[:8]}: {exc}")
        return None


def current_snapshot_date() -> str:
    path = DATA_DIR / "last_update.json"
    if path.exists():
        try:
            d = load_json(path).get("data_riferimento")
            if d:
                return str(d)
        except Exception:
            pass
    return date.today().isoformat()


def main():
    current_path = DATA_DIR / "stations.json"
    if not current_path.exists():
        raise SystemExit("data/stations.json not found")

    current_date = current_snapshot_date()
    shards = load_shards()
    is_initial = not any((HISTORY_DIR / f"{n:02d}.json").exists() for n in range(SHARDS))

    if is_initial:
        previous = git_snapshots_before(current_date, DAYS - 1)
        print(f"Initial history build: {len(previous)} previous snapshots + current")
        for snap_date, sha in previous:
            stations = load_git_snapshot(sha)
            if stations:
                print(f"  {snap_date}: {len(stations)} stations")
                merge_updates(shards, build_points(snap_date, stations))

    current = load_json(current_path)
    print(f"Current {current_date}: {len(current)} stations")
    merge_updates(shards, build_points(current_date, current))
    save_shards(shards)
    print(f"Saved {SHARDS} shards, {DAYS}-day retention, {ZONE_KM:.0f} km benchmark")


if __name__ == "__main__":
    main()
