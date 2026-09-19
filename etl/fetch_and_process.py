#!/usr/bin/env python3
"""
ETL Prezzi Carburanti Italia
Scarica i dati Open Data MIMIT, calcola aggregazioni e variazioni,
genera JSON per la dashboard.
"""

import io
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import requests

# ── Config ──────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SITE_DATA_DIR = BASE_DIR / "site" / "data"
HISTORY_DAYS = 90

URLS = {
    "anagrafica": "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv",
    "prezzi": "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
}

HEADERS = {
    "User-Agent": "CarburantiItalia-Dashboard/1.0 (+https://github.com/samuelecorona/carburanti-italia)"
}

MAX_RETRIES = 3
RETRY_DELAY = 10

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Province → Regione ──────────────────────────────────────────────────────

PROVINCIA_REGIONE = {
    # Abruzzo
    "AQ": "Abruzzo", "CH": "Abruzzo", "PE": "Abruzzo", "TE": "Abruzzo",
    # Basilicata
    "MT": "Basilicata", "PZ": "Basilicata",
    # Calabria
    "CS": "Calabria", "CZ": "Calabria", "KR": "Calabria", "RC": "Calabria", "VV": "Calabria",
    # Campania
    "AV": "Campania", "BN": "Campania", "CE": "Campania", "NA": "Campania", "SA": "Campania",
    # Emilia-Romagna
    "BO": "Emilia-Romagna", "FE": "Emilia-Romagna", "FC": "Emilia-Romagna",
    "MO": "Emilia-Romagna", "PR": "Emilia-Romagna", "PC": "Emilia-Romagna",
    "RA": "Emilia-Romagna", "RE": "Emilia-Romagna", "RN": "Emilia-Romagna",
    # Friuli Venezia Giulia
    "GO": "Friuli Venezia Giulia", "PN": "Friuli Venezia Giulia",
    "TS": "Friuli Venezia Giulia", "UD": "Friuli Venezia Giulia",
    # Lazio
    "FR": "Lazio", "LT": "Lazio", "RI": "Lazio", "RM": "Lazio", "VT": "Lazio",
    # Liguria
    "GE": "Liguria", "IM": "Liguria", "SP": "Liguria", "SV": "Liguria",
    # Lombardia
    "BG": "Lombardia", "BS": "Lombardia", "CO": "Lombardia", "CR": "Lombardia",
    "LC": "Lombardia", "LO": "Lombardia", "MB": "Lombardia", "MI": "Lombardia",
    "MN": "Lombardia", "PV": "Lombardia", "SO": "Lombardia", "VA": "Lombardia",
    # Marche
    "AN": "Marche", "AP": "Marche", "FM": "Marche", "MC": "Marche", "PU": "Marche",
    # Molise
    "CB": "Molise", "IS": "Molise",
    # Piemonte
    "AL": "Piemonte", "AT": "Piemonte", "BI": "Piemonte", "CN": "Piemonte",
    "NO": "Piemonte", "TO": "Piemonte", "VB": "Piemonte", "VC": "Piemonte",
    # Puglia
    "BA": "Puglia", "BT": "Puglia", "BR": "Puglia", "FG": "Puglia",
    "LE": "Puglia", "TA": "Puglia",
    # Sardegna
    "CA": "Sardegna", "NU": "Sardegna", "OR": "Sardegna", "SS": "Sardegna", "SU": "Sardegna",
    # Sicilia
    "AG": "Sicilia", "CL": "Sicilia", "CT": "Sicilia", "EN": "Sicilia",
    "ME": "Sicilia", "PA": "Sicilia", "RG": "Sicilia", "SR": "Sicilia", "TP": "Sicilia",
    # Toscana
    "AR": "Toscana", "FI": "Toscana", "GR": "Toscana", "LI": "Toscana",
    "LU": "Toscana", "MS": "Toscana", "PI": "Toscana", "PO": "Toscana",
    "PT": "Toscana", "SI": "Toscana",
    # Trentino-Alto Adige
    "BZ": "Trentino-Alto Adige", "TN": "Trentino-Alto Adige",
    # Umbria
    "PG": "Umbria", "TR": "Umbria",
    # Valle d'Aosta
    "AO": "Valle d'Aosta",
    # Veneto
    "BL": "Veneto", "PD": "Veneto", "RO": "Veneto", "TV": "Veneto",
    "VE": "Veneto", "VI": "Veneto", "VR": "Veneto",
}

# ── Normalizzazione carburanti ──────────────────────────────────────────────

FUEL_MAP = {
    "benzina": "Benzina",
    "benzina 100 ottani": "Benzina",
    "benzina 102 ottani": "Benzina",
    "benzina speciale 98 ottani": "Benzina",
    "benzina wp": "Benzina",
    "blue diesel": "Gasolio",
    "blue super": "Benzina",
    "diesel": "Gasolio",
    "gasolio": "Gasolio",
    "gasolio artico": "Gasolio",
    "gasolio artico igloo": "Gasolio",
    "gasolio energy": "Gasolio",
    "gasolio ecoplus": "Gasolio",
    "gasolio oro diesel": "Gasolio",
    "gasolio plus": "Gasolio",
    "gasolio premium": "Gasolio",
    "gasolio prestazionale": "Gasolio",
    "gasolio speciale": "Gasolio",
    "gpl": "GPL",
    "hi-q diesel": "Gasolio",
    "hvo": "Gasolio",
    "hvo100": "Gasolio",
    "hvo eco diesel": "Gasolio",
    "hvo future": "Gasolio",
    "hvolution": "Gasolio",
    "hvovolution": "Gasolio",
    "hvoluzione": "Gasolio",
    "hiq perform+": "Benzina",
    "diesel hvo": "Gasolio",
    "diesel hvo energy": "Gasolio",
    "gasolio bio hvo": "Gasolio",
    "gasolio hvo": "Gasolio",
    "bchvo": "Gasolio",
    "rehvo": "Gasolio",
    "metano": "Metano",
    "gnc": "Metano",
    "gnl": "Metano",
    "l-gnc": "Metano",
    "verde speciale": "Benzina",
    "f-101": "Benzina",
    "e-85": "Benzina",
    "ssplus": "Benzina",
}

MAIN_FUELS = ["Benzina", "Gasolio", "GPL", "Metano"]

# Range prezzi validi per filtrare outlier
PRICE_RANGES = {
    "Benzina": (0.90, 4.00),
    "Gasolio": (0.90, 4.00),
    "GPL": (0.30, 2.00),
    "Metano": (0.30, 4.00),
}


# ── Download ────────────────────────────────────────────────────────────────

def download_csv(name: str, url: str) -> str | None:
    """Scarica un CSV con retry. Ritorna il testo o None."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            log.info(f"Download {name} (tentativo {attempt}/{MAX_RETRIES})...")
            r = requests.get(url, headers=HEADERS, timeout=60)
            r.raise_for_status()
            # Prova UTF-8, fallback Latin-1
            try:
                text = r.content.decode("utf-8")
            except UnicodeDecodeError:
                text = r.content.decode("latin-1")
            log.info(f"  → {len(text)} caratteri, {text.count(chr(10))} righe")
            return text
        except Exception as e:
            log.warning(f"  Errore: {e}")
            if attempt < MAX_RETRIES:
                log.info(f"  Attendo {RETRY_DELAY}s...")
                time.sleep(RETRY_DELAY)
    log.error(f"Download {name} fallito dopo {MAX_RETRIES} tentativi")
    return None


# ── Parsing ─────────────────────────────────────────────────────────────────

def parse_anagrafica(text: str) -> pd.DataFrame:
    """Parsa il CSV anagrafica (separatore |)."""
    # Salta la prima riga se inizia con "Estrazione del"
    lines = text.strip().split("\n")
    start = 0
    for i, line in enumerate(lines):
        if line.strip().lower().startswith("idimpianto"):
            start = i
            break
        if "estrazione" in line.lower():
            continue
        if "|" in line and i == 0:
            start = 0
            break

    csv_text = "\n".join(lines[start:])
    df = pd.read_csv(
        io.StringIO(csv_text),
        sep="|",
        dtype=str,
        on_bad_lines="skip",
        engine="python",
    )

    # Normalizza nomi colonne
    df.columns = df.columns.str.strip()

    # Converti coordinate
    for col in ["Latitudine", "Longitudine"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Mappa regione
    if "Provincia" in df.columns:
        df["Provincia"] = df["Provincia"].str.strip().str.upper()
        df["Regione"] = df["Provincia"].map(PROVINCIA_REGIONE)

    # Estrai CAP dall'indirizzo
    if "Indirizzo" in df.columns:
        df["CAP"] = df["Indirizzo"].str.extract(r"(\b\d{5}\b)", expand=False)

    log.info(f"Anagrafica: {len(df)} impianti, {df['Regione'].notna().sum()} con regione")
    return df


def parse_prezzi(text: str) -> pd.DataFrame:
    """Parsa il CSV prezzi (separatore |)."""
    lines = text.strip().split("\n")
    start = 0
    for i, line in enumerate(lines):
        if "idimpianto" in line.lower():
            start = i
            break

    csv_text = "\n".join(lines[start:])
    df = pd.read_csv(
        io.StringIO(csv_text),
        sep="|",
        dtype=str,
        on_bad_lines="skip",
        engine="python",
    )

    df.columns = df.columns.str.strip()

    # Converti prezzo
    if "prezzo" in df.columns:
        df["prezzo"] = pd.to_numeric(df["prezzo"], errors="coerce")
    elif "Prezzo" in df.columns:
        df["prezzo"] = pd.to_numeric(df["Prezzo"], errors="coerce")

    # Normalizza isSelf
    self_col = [c for c in df.columns if "self" in c.lower()]
    if self_col:
        df["is_self"] = df[self_col[0]].astype(str).str.strip().str.lower().isin(["1", "true", "si", "sì"])
    else:
        df["is_self"] = True

    # Normalizza idImpianto
    id_col = [c for c in df.columns if "idimpianto" in c.lower().replace(" ", "")]
    if id_col:
        df["idImpianto"] = df[id_col[0]].str.strip()

    # Normalizza tipo carburante
    carb_col = [c for c in df.columns if "carburante" in c.lower() or "desc" in c.lower()]
    if carb_col:
        df["carburante_raw"] = df[carb_col[0]].str.strip().str.lower()
        df["carburante"] = df["carburante_raw"].map(FUEL_MAP)
    else:
        df["carburante"] = None

    # Filtra solo carburanti noti
    df = df[df["carburante"].isin(MAIN_FUELS)].copy()

    # Filtra outlier per range
    mask = pd.Series(True, index=df.index)
    for fuel, (lo, hi) in PRICE_RANGES.items():
        fuel_mask = df["carburante"] == fuel
        price_ok = df["prezzo"].between(lo, hi)
        mask = mask & (~fuel_mask | price_ok)
    before = len(df)
    df = df[mask].copy()
    if before - len(df) > 0:
        log.info(f"  Rimossi {before - len(df)} outlier di prezzo")

    log.info(f"Prezzi: {len(df)} righe valide")
    return df


# ── Aggregazione ────────────────────────────────────────────────────────────

def compute_stats(group: pd.DataFrame) -> dict:
    """Calcola statistiche per un gruppo di prezzi."""
    if len(group) == 0:
        return None
    return {
        "media": round(group["prezzo"].mean(), 3),
        "mediana": round(group["prezzo"].median(), 3),
        "min": round(group["prezzo"].min(), 3),
        "max": round(group["prezzo"].max(), 3),
        "num_impianti": int(group["idImpianto"].nunique()),
    }


def aggregate(merged: pd.DataFrame) -> dict:
    """Calcola tutte le aggregazioni."""
    result = {"nazionale": {}, "regionale": {}, "provinciale": {}, "comunali": {}}

    for fuel in MAIN_FUELS:
        fuel_df = merged[merged["carburante"] == fuel]
        result["nazionale"][fuel] = {
            "self": compute_stats(fuel_df[fuel_df["is_self"]]),
            "servito": compute_stats(fuel_df[~fuel_df["is_self"]]),
        }

    # Regionale
    for regione in sorted(merged["Regione"].dropna().unique()):
        reg_df = merged[merged["Regione"] == regione]
        result["regionale"][regione] = {}
        for fuel in MAIN_FUELS:
            fuel_df = reg_df[reg_df["carburante"] == fuel]
            result["regionale"][regione][fuel] = {
                "self": compute_stats(fuel_df[fuel_df["is_self"]]),
                "servito": compute_stats(fuel_df[~fuel_df["is_self"]]),
            }

    # Provinciale
    for prov in sorted(merged["Provincia"].dropna().unique()):
        prov_df = merged[merged["Provincia"] == prov]
        regione = PROVINCIA_REGIONE.get(prov, "")
        result["provinciale"][prov] = {"regione": regione}
        for fuel in MAIN_FUELS:
            fuel_df = prov_df[prov_df["carburante"] == fuel]
            result["provinciale"][prov][fuel] = {
                "self": compute_stats(fuel_df[fuel_df["is_self"]]),
                "servito": compute_stats(fuel_df[~fuel_df["is_self"]]),
            }

    # Comunali (tutti i comuni con almeno 1 impianto)
    if "Comune" in merged.columns:
        comune_counts = merged.groupby("Comune")["idImpianto"].nunique()
        for comune in comune_counts.index:
            com_df = merged[merged["Comune"] == comune]
            prov_mode = com_df["Provincia"].mode()
            prov = prov_mode.iloc[0] if len(prov_mode) > 0 else ""
            cap_mode = com_df["CAP"].mode() if "CAP" in com_df.columns and com_df["CAP"].notna().any() else pd.Series(dtype=str)
            cap = cap_mode.iloc[0] if len(cap_mode) > 0 else ""
            result["comunali"][comune] = {"provincia": prov, "cap": str(cap)}
            for fuel in MAIN_FUELS:
                fuel_df = com_df[com_df["carburante"] == fuel]
                result["comunali"][comune][fuel] = {
                    "self": compute_stats(fuel_df[fuel_df["is_self"]]),
                    "servito": compute_stats(fuel_df[~fuel_df["is_self"]]),
                }

    return result


# ── Variazioni ──────────────────────────────────────────────────────────────

def compute_variations(current: dict, history: list) -> dict:
    """Aggiunge variazioni giorno e settimana ai dati correnti."""
    if not history:
        return current

    # Trova ieri e 7 giorni fa
    yesterday = None
    week_ago = None
    today = datetime.now().strftime("%Y-%m-%d")

    for entry in reversed(history):
        if entry["data"] == today:
            continue
        if yesterday is None:
            yesterday = entry
        days_diff = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(entry["data"], "%Y-%m-%d")).days
        if days_diff >= 7 and week_ago is None:
            week_ago = entry
            break

    # Applica variazioni a livello nazionale
    for fuel in MAIN_FUELS:
        for mode in ["self", "servito"]:
            stats = current["nazionale"].get(fuel, {}).get(mode)
            if not stats or not stats.get("media"):
                continue

            # Variazione giornaliera
            if yesterday and fuel in yesterday.get("nazionale", {}):
                prev = yesterday["nazionale"][fuel].get(mode, {}).get("media")
                if prev:
                    stats["variazione_giorno"] = round(stats["media"] - prev, 3)

            # Variazione settimanale
            if week_ago and fuel in week_ago.get("nazionale", {}):
                prev = week_ago["nazionale"][fuel].get(mode, {}).get("media")
                if prev:
                    stats["variazione_settimana"] = round(stats["media"] - prev, 3)

    return current


# ── Storico ─────────────────────────────────────────────────────────────────

def update_history(history: list, current: dict, today: str) -> list:
    """Aggiunge la entry di oggi allo storico, mantiene ultimi N giorni."""
    # Rimuovi duplicato di oggi se esiste
    history = [e for e in history if e.get("data") != today]

    # Crea entry compatta (solo medie nazionali)
    entry = {"data": today, "nazionale": {}}
    for fuel in MAIN_FUELS:
        entry["nazionale"][fuel] = {}
        for mode in ["self", "servito"]:
            stats = current.get("nazionale", {}).get(fuel, {}).get(mode)
            if stats:
                entry["nazionale"][fuel][mode] = {"media": stats.get("media")}

    history.append(entry)

    # Tronca a HISTORY_DAYS
    cutoff = (datetime.now() - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")
    history = [e for e in history if e["data"] >= cutoff]

    return history


# ── Stations (singoli impianti per i preferiti) ─────────────────────────────

def build_stations(merged: pd.DataFrame, anagrafica: pd.DataFrame) -> list:
    """Costruisce la lista di tutti i singoli impianti con prezzi, per la funzione preferiti."""
    stations = []
    
    # Raggruppa prezzi per impianto
    grouped = merged.groupby("idImpianto")
    
    for imp_id, group in grouped:
        # Info anagrafica
        ana_row = anagrafica[anagrafica["idImpianto"] == imp_id]
        if len(ana_row) == 0:
            continue
        ana = ana_row.iloc[0]
        
        prezzi = {}
        for _, row in group.iterrows():
            fuel = row.get("carburante")
            if not fuel:
                continue
            mode = "self" if row.get("is_self", True) else "servito"
            if fuel not in prezzi:
                prezzi[fuel] = {}
            prezzi[fuel][mode] = round(float(row["prezzo"]), 3)
        
        station = {
            "id": int(imp_id) if str(imp_id).isdigit() else imp_id,
            "gestore": str(ana.get("Gestore", "")),
            "bandiera": str(ana.get("Bandiera", "")),
            "nome": str(ana.get("Nome Impianto", "")),
            "indirizzo": str(ana.get("Indirizzo", "")),
            "comune": str(ana.get("Comune", "")),
            "provincia": str(ana.get("Provincia", "")),
            "cap": str(ana.get("CAP", "")),
            "lat": float(ana["Latitudine"]) if pd.notna(ana.get("Latitudine")) else None,
            "lng": float(ana["Longitudine"]) if pd.notna(ana.get("Longitudine")) else None,
            "prezzi": prezzi,
        }
        stations.append(station)
    
    log.info(f"Stations: {len(stations)} impianti con prezzi")
    return stations


# ── I/O JSON ────────────────────────────────────────────────────────────────

def load_json(path: Path) -> dict | list:
    """Carica JSON, ritorna {} o [] se non esiste."""
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return [] if "history" in str(path) else {}


def save_json(data, path: Path, compact: bool = True):
    """Salva JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)
    log.info(f"  Salvato {path.name} ({path.stat().st_size / 1024:.1f} KB)")


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    today = datetime.now().strftime("%Y-%m-%d")
    log.info(f"=== ETL Prezzi Carburanti — {today} ===")

    # Download
    ana_text = download_csv("anagrafica", URLS["anagrafica"])
    pre_text = download_csv("prezzi", URLS["prezzi"])

    if not ana_text or not pre_text:
        log.error("Download fallito — esco senza aggiornare")
        sys.exit(1)

    # Parse
    anagrafica = parse_anagrafica(ana_text)
    prezzi = parse_prezzi(pre_text)

    # Merge
    log.info("Merge anagrafica + prezzi...")
    merged = prezzi.merge(
        anagrafica[["idImpianto", "Comune", "Provincia", "Regione", "CAP", "Latitudine", "Longitudine"]],
        on="idImpianto",
        how="left",
    )
    log.info(f"  {len(merged)} righe dopo merge, {merged['Regione'].notna().sum()} con regione")

    # Aggregazione
    log.info("Calcolo aggregazioni...")
    aggregated = aggregate(merged)

    # Storico
    log.info("Aggiornamento storico...")
    history = load_json(DATA_DIR / "history.json")
    if not isinstance(history, list):
        history = []

    # Variazioni
    aggregated = compute_variations(aggregated, history)

    # Aggiorna storico
    history = update_history(history, aggregated, today)

    # Costruisci latest.json
    latest = {
        "data": today,
        "ora_aggiornamento": datetime.now().strftime("%H:%M"),
        "fonte": "MIMIT - Osservaprezzi Carburanti",
        "totale_impianti": int(anagrafica["idImpianto"].nunique()) if "idImpianto" in anagrafica.columns else 0,
        "totale_prezzi": len(prezzi),
        **aggregated,
    }

    last_update = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "data_riferimento": today,
        "esito": "ok",
        "impianti_processati": latest["totale_impianti"],
        "prezzi_processati": latest["totale_prezzi"],
    }

    # Stations per i preferiti
    log.info("Generazione lista distributori...")
    stations = build_stations(merged, anagrafica)

    # Salva in data/ e site/data/
    log.info("Salvataggio JSON...")
    for d in [DATA_DIR, SITE_DATA_DIR]:
        save_json(latest, d / "latest.json")
        save_json(history, d / "history.json")
        save_json(last_update, d / "last_update.json", compact=False)
        save_json(stations, d / "stations.json")

    log.info("=== ETL completato con successo ===")


if __name__ == "__main__":
    main()
