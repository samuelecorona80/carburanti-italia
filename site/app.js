/**
 * Prezzi Carburanti Italia — Dashboard App
 * Carica dati JSON, renderizza card, chart, tabelle e ricerca.
 */

(() => {
"use strict";

// ── State ──────────────────────────────────────────────────────────────────
let DATA = null;
let HISTORY = null;
let STATIONS = null;
let trendChart = null;
let currentSort = { col: "name", asc: true };
let map = null;
let trendDays = 60;

const FUEL_COLORS = {
    Benzina: "#64e78b",
    Gasolio: "#3f8cff",
    GPL: "#ffc65b",
    Metano: "#a78bfa",
};

const FUEL_EMOJI = {
    Benzina: "🟢",
    Gasolio: "🔵",
    GPL: "🟡",
    Metano: "🟣",
};

const PROVINCE_TO_REGION = {};

// ── Init ───────────────────────────────────────────────────────────────────
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    // DOMContentLoaded already fired
    init();
}

async function init() {
    initTheme();
    try {
        const [latestRes, historyRes, stationsRes] = await Promise.all([
            fetch("data/latest.json"),
            fetch("data/history.json"),
            fetch("data/stations.json"),
        ]);

        if (!latestRes.ok) throw new Error("latest.json non trovato");
        DATA = await latestRes.json();
        HISTORY = historyRes.ok ? await historyRes.json() : [];
        STATIONS = stationsRes.ok ? await stationsRes.json() : [];

        // Mappa province → regioni
        if (DATA.provinciale) {
            for (const [prov, info] of Object.entries(DATA.provinciale)) {
                if (info.regione) PROVINCE_TO_REGION[prov] = info.regione;
            }
        }

        document.getElementById("loading").style.display = "none";
        render();
    } catch (err) {
        document.getElementById("loading").style.display = "none";
        document.getElementById("error-banner").style.display = "block";
        document.getElementById("error-msg").textContent =
            "Impossibile caricare i dati: " + err.message;
    }
}

function render() {
    renderHeader();
    renderCards();
    renderTrendChart();
    renderRegionalTable();
    initSearch();
    initFavorites();
    initMap();
    initTrendButtons();
}

// ── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
    const saved = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", saved);
    updateThemeButton(saved);

    document.getElementById("theme-toggle").addEventListener("click", () => {
        const curr = document.documentElement.getAttribute("data-theme");
        const next = curr === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
        updateThemeButton(next);
        if (trendChart) renderTrendChart();
    });
}

function updateThemeButton(theme) {
    document.getElementById("theme-toggle").textContent = theme === "light" ? "🌙" : "☀️";
}

// ── Header ─────────────────────────────────────────────────────────────────
function renderHeader() {
    const el = document.getElementById("last-update");
    if (DATA.data) {
        const d = DATA.data.split("-");
        el.textContent = `📅 ${d[2]}/${d[1]}/${d[0]}`;
    }

    const banner = document.getElementById("stats-banner");
    banner.style.display = "flex";
    document.getElementById("stat-impianti").textContent =
        (DATA.totale_impianti || 0).toLocaleString("it-IT");
    document.getElementById("stat-prezzi").textContent =
        (DATA.totale_prezzi || 0).toLocaleString("it-IT");
}

// ── National Cards ─────────────────────────────────────────────────────────
function renderCards() {
    const container = document.getElementById("cards-container");
    container.innerHTML = "";

    for (const fuel of ["Benzina", "Gasolio", "GPL", "Metano"]) {
        const info = DATA.nazionale?.[fuel]?.self;
        if (!info) continue;

        const delta = info.variazione_giorno;
        const deltaClass = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
        const deltaStr = delta != null
            ? `${delta > 0 ? "▲" : delta < 0 ? "▼" : "="} ${Math.abs(delta).toFixed(3)} €`
            : "—";

        const weekDelta = info.variazione_settimana;
        const weekStr = weekDelta != null
            ? `Settimana: ${weekDelta > 0 ? "+" : ""}${weekDelta.toFixed(3)} €`
            : "";

        const card = document.createElement("div");
        card.className = `card card-fuel-${fuel.toLowerCase()}`;
        card.innerHTML = `
            <div class="card-label">${FUEL_EMOJI[fuel]} ${fuel}</div>
            <div class="card-price">${info.media?.toFixed(3) ?? "—"} <span class="unit">€/L</span></div>
            <div class="card-delta ${deltaClass}">${deltaStr}</div>
            <div class="card-range">Min ${info.min?.toFixed(3) ?? "—"} · Max ${info.max?.toFixed(3) ?? "—"} · ${info.num_impianti ?? 0} impianti</div>
            ${weekStr ? `<div class="card-range">${weekStr}</div>` : ""}
        `;
        container.appendChild(card);
    }
}

// ── Trend Chart ────────────────────────────────────────────────────────────
function renderTrendChart() {
    if (!HISTORY || HISTORY.length === 0) return;

    const canvas = document.getElementById("trend-chart");
    const ctx = canvas.getContext("2d");

    // Filtra per periodo
    const sliced = HISTORY.slice(-trendDays);
    const labels = sliced.map(e => {
        const parts = e.data.split("-");
        return `${parts[2]}/${parts[1]}`;
    });

    const datasets = [];
    for (const fuel of ["Benzina", "Gasolio", "GPL", "Metano"]) {
        const data = sliced.map(e => e.nazionale?.[fuel]?.self?.media ?? null);
        // Skip se tutti null
        if (data.every(v => v === null)) continue;
        datasets.push({
            label: fuel,
            data,
            borderColor: FUEL_COLORS[fuel],
            backgroundColor: FUEL_COLORS[fuel] + "20",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
            fill: false,
        });
    }

    if (trendChart) trendChart.destroy();

    trendChart = new Chart(ctx, {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: item => `${item.dataset.label}: ${item.parsed.y?.toFixed(3)} €/L`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: "rgba(74, 112, 148, 0.15)" },
                    ticks: { color: "#9fb2c7", maxTicksLimit: 10 },
                },
                y: {
                    grid: { color: "rgba(74, 112, 148, 0.15)" },
                    ticks: {
                        color: "#9fb2c7",
                        callback: v => v.toFixed(2) + " €",
                    },
                },
            },
        },
    });

    // Legend
    const legendEl = document.getElementById("chart-legend");
    legendEl.innerHTML = datasets.map(ds =>
        `<span style="--dot-color:${ds.borderColor}">
            <span style="background:${ds.borderColor};width:12px;height:12px;border-radius:3px;display:inline-block"></span>
            ${ds.label}
        </span>`
    ).join("");
}

function initTrendButtons() {
    document.getElementById("trend-period").addEventListener("click", e => {
        const btn = e.target.closest("[data-days]");
        if (!btn) return;
        document.querySelectorAll("#trend-period .btn-sm").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        trendDays = parseInt(btn.dataset.days);
        renderTrendChart();
    });
}

// ── Regional Table ─────────────────────────────────────────────────────────
function renderRegionalTable() {
    if (!DATA.regionale) return;

    const rows = Object.entries(DATA.regionale).map(([name, fuels]) => ({
        name,
        benzina: fuels.Benzina?.self?.media ?? null,
        benzina_var: fuels.Benzina?.self?.variazione_giorno ?? null,
        gasolio: fuels.Gasolio?.self?.media ?? null,
        gasolio_var: fuels.Gasolio?.self?.variazione_giorno ?? null,
        gpl: fuels.GPL?.self?.media ?? null,
        metano: fuels.Metano?.self?.media ?? null,
    }));

    sortRows(rows);
    renderRows(rows);
    initSort(rows);
}

function sortRows(rows) {
    const { col, asc } = currentSort;
    rows.sort((a, b) => {
        let va = a[col], vb = b[col];
        if (va == null) va = asc ? Infinity : -Infinity;
        if (vb == null) vb = asc ? Infinity : -Infinity;
        if (typeof va === "string") return asc ? va.localeCompare(vb) : vb.localeCompare(va);
        return asc ? va - vb : vb - va;
    });
}

function renderRows(rows) {
    const tbody = document.getElementById("regional-body");
    tbody.innerHTML = rows.map(r => `
        <tr data-region="${r.name}">
            <td><strong>${r.name}</strong></td>
            <td class="price-cell">${fmtPrice(r.benzina)}</td>
            <td class="${deltaClass(r.benzina_var)}">${fmtDelta(r.benzina_var)}</td>
            <td class="price-cell">${fmtPrice(r.gasolio)}</td>
            <td class="${deltaClass(r.gasolio_var)}">${fmtDelta(r.gasolio_var)}</td>
            <td class="price-cell">${fmtPrice(r.gpl)}</td>
            <td class="price-cell">${fmtPrice(r.metano)}</td>
        </tr>
    `).join("");

    // Click → drill-down
    tbody.querySelectorAll("tr").forEach(tr => {
        tr.addEventListener("click", () => showProvinces(tr.dataset.region));
    });
}

function initSort(rows) {
    document.querySelectorAll("#regional-table th[data-sort]").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.sort;
            if (currentSort.col === col) {
                currentSort.asc = !currentSort.asc;
            } else {
                currentSort = { col, asc: true };
            }
            sortRows(rows);
            renderRows(rows);
        });
    });
}

// ── Province Drill-down ────────────────────────────────────────────────────
function showProvinces(regionName) {
    const section = document.getElementById("province-section");
    const title = document.getElementById("province-title");
    const tbody = document.getElementById("province-body");

    title.textContent = `Province di ${regionName}`;

    // Trova province di questa regione
    const provs = Object.entries(DATA.provinciale || {})
        .filter(([_, info]) => info.regione === regionName)
        .map(([prov, fuels]) => ({
            prov,
            benzina: fuels.Benzina?.self?.media,
            gasolio: fuels.Gasolio?.self?.media,
            gpl: fuels.GPL?.self?.media,
            metano: fuels.Metano?.self?.media,
        }))
        .sort((a, b) => (a.benzina ?? 99) - (b.benzina ?? 99));

    tbody.innerHTML = provs.map(p => `
        <tr>
            <td><strong>${p.prov}</strong></td>
            <td class="price-cell">${fmtPrice(p.benzina)}</td>
            <td class="price-cell">${fmtPrice(p.gasolio)}</td>
            <td class="price-cell">${fmtPrice(p.gpl)}</td>
            <td class="price-cell">${fmtPrice(p.metano)}</td>
        </tr>
    `).join("");

    section.style.display = "block";
    section.scrollIntoView({ behavior: "smooth", block: "start" });

    document.getElementById("province-close").onclick = () => {
        section.style.display = "none";
    };
}

// ── Search ─────────────────────────────────────────────────────────────────
function initSearch() {
    if (!DATA.comunali) return;

    const input = document.getElementById("search-input");
    const dropdown = document.getElementById("search-results");
    const comuniList = Object.entries(DATA.comunali).map(([name, info]) => ({
        name,
        prov: info.provincia || "",
        cap: info.cap || "",
    }));

    let activeIndex = -1;

    input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) {
            dropdown.classList.remove("open");
            return;
        }

        const matches = comuniList
            .filter(c => c.name.toLowerCase().includes(q) || c.cap.startsWith(q))
            .slice(0, 10);

        if (matches.length === 0) {
            dropdown.classList.remove("open");
            return;
        }

        dropdown.innerHTML = matches.map((c, i) =>
            `<div class="search-item" data-comune="${c.name}" data-index="${i}">
                <span>${c.name}</span>
                <span class="prov">${c.prov} ${c.cap}</span>
            </div>`
        ).join("");

        dropdown.classList.add("open");
        activeIndex = -1;

        dropdown.querySelectorAll(".search-item").forEach(el => {
            el.addEventListener("click", () => selectComune(el.dataset.comune));
        });
    });

    // Keyboard navigation
    input.addEventListener("keydown", e => {
        const items = dropdown.querySelectorAll(".search-item");
        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, items.length - 1);
            items.forEach((it, i) => it.classList.toggle("active", i === activeIndex));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            items.forEach((it, i) => it.classList.toggle("active", i === activeIndex));
        } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            selectComune(items[activeIndex].dataset.comune);
        } else if (e.key === "Escape") {
            dropdown.classList.remove("open");
        }
    });

    // Close on outside click
    document.addEventListener("click", e => {
        if (!e.target.closest(".search-box")) dropdown.classList.remove("open");
    });
}

function selectComune(name) {
    document.getElementById("search-results").classList.remove("open");
    document.getElementById("search-input").value = name;

    const info = DATA.comunali?.[name];
    if (!info) return;

    const detail = document.getElementById("comune-detail");
    detail.style.display = "block";

    let html = `<h3>📍 ${name} <small style="color:var(--text-muted)">(${info.provincia}${info.cap ? " — " + info.cap : ""})</small></h3>`;
    html += `<div class="comune-grid">`;

    for (const fuel of ["Benzina", "Gasolio", "GPL", "Metano"]) {
        const local = info[fuel]?.self?.media;
        const national = DATA.nazionale?.[fuel]?.self?.media;

        let vsHtml = "";
        if (local != null && national != null) {
            const diff = local - national;
            const pct = ((diff / national) * 100).toFixed(1);
            const cls = diff < 0 ? "better" : diff > 0 ? "worse" : "";
            vsHtml = `vs media nazionale: <span class="${cls}">${diff > 0 ? "+" : ""}${diff.toFixed(3)} € (${diff > 0 ? "+" : ""}${pct}%)</span>`;
        }

        html += `
            <div class="comune-fuel-card">
                <div class="comune-fuel-label">${FUEL_EMOJI[fuel]} ${fuel}</div>
                <div class="comune-fuel-price">${local != null ? local.toFixed(3) + " €" : "n/d"}</div>
                <div class="comune-fuel-vs">${vsHtml}</div>
            </div>
        `;
    }

    html += `</div>`;
    detail.innerHTML = html;
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtPrice(v) {
    return v != null ? v.toFixed(3) + " €" : "—";
}

function fmtDelta(v) {
    if (v == null) return "—";
    const sign = v > 0 ? "▲" : v < 0 ? "▼" : "=";
    return `${sign} ${Math.abs(v).toFixed(3)}`;
}

function deltaClass(v) {
    if (v == null) return "delta-cell flat";
    return `delta-cell ${v > 0 ? "up" : v < 0 ? "down" : "flat"}`;

// ── Map ────────────────────────────────────────────────────────────────────

function initMap() {
    if (!STATIONS || STATIONS.length === 0) {
        document.getElementById("map-section").style.display = "none";
        return;
    }

    // Default center: Italy
    map = L.map("map").setView([41.9, 12.5], 6);

    // Tile layer — detect theme
    const tileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
    const tileAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

    L.tileLayer(tileUrl, { attribution: tileAttr, maxZoom: 18 }).addTo(map);

    // Cluster-like approach: only show markers when zoomed in enough
    let markersLayer = L.layerGroup().addTo(map);
    let userMarker = null;

    function updateMarkers() {
        markersLayer.clearLayers();
        const bounds = map.getBounds();
        const zoom = map.getZoom();

        // Only show markers at zoom >= 11 (city level)
        if (zoom < 11) {
            document.getElementById("map-hint").textContent =
                "🔍 Zooma o cerca una città per vedere i distributori";
            return;
        }

        const favIds = getFavorites();
        let count = 0;

        for (const s of STATIONS) {
            if (!s.lat || !s.lng) continue;
            if (!bounds.contains([s.lat, s.lng])) continue;
            if (count >= 200) break; // Cap per performance

            const isFav = favIds.includes(s.id);
            const benzSelf = s.prezzi?.Benzina?.self;

            // Colore marker basato su prezzo benzina
            let color = "#3b82f6"; // blue default
            if (benzSelf != null) {
                const avg = DATA.nazionale?.Benzina?.self?.media || 1.78;
                if (benzSelf < avg - 0.03) color = "#10b981"; // green = cheap
                else if (benzSelf > avg + 0.03) color = "#ef4444"; // red = expensive
                else color = "#f59e0b"; // yellow = average
            }

            const icon = L.divIcon({
                className: "custom-marker",
                html: `<div style="
                    width:${isFav ? 16 : 12}px;
                    height:${isFav ? 16 : 12}px;
                    background:${color};
                    border:2px solid white;
                    border-radius:50%;
                    box-shadow:0 1px 4px rgba(0,0,0,0.3);
                    ${isFav ? "box-shadow:0 0 0 3px gold, 0 1px 4px rgba(0,0,0,0.3);" : ""}
                "></div>`,
                iconSize: [isFav ? 16 : 12, isFav ? 16 : 12],
                iconAnchor: [isFav ? 8 : 6, isFav ? 8 : 6],
            });

            const marker = L.marker([s.lat, s.lng], { icon }).addTo(markersLayer);
            marker.bindPopup(() => buildStationPopup(s, isFav), { maxWidth: 280 });
            count++;
        }

        document.getElementById("map-hint").textContent =
            `${count} distributori visibili${count >= 200 ? " (max 200, zooma per vedere di più)" : ""}. Clicca su un punto per i dettagli.`;
    }

    map.on("moveend", updateMarkers);
    map.on("zoomend", updateMarkers);

    // Geolocation
    document.getElementById("geolocate-btn").addEventListener("click", () => {
        if (!navigator.geolocation) {
            alert("Geolocalizzazione non supportata dal browser");
            return;
        }
        document.getElementById("geolocate-btn").textContent = "⏳ Ricerca...";
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                map.setView([latitude, longitude], 14);

                if (userMarker) map.removeLayer(userMarker);
                userMarker = L.marker([latitude, longitude], {
                    icon: L.divIcon({
                        className: "user-marker",
                        html: `<div style="
                            width:20px; height:20px;
                            background:#3b82f6;
                            border:3px solid white;
                            border-radius:50%;
                            box-shadow:0 0 0 6px rgba(59,130,246,0.3), 0 2px 6px rgba(0,0,0,0.3);
                        "></div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10],
                    }),
                }).addTo(map).bindPopup("📍 La tua posizione").openPopup();

                document.getElementById("geolocate-btn").textContent = "📍 Posizione";
            },
            (err) => {
                alert("Impossibile ottenere la posizione: " + err.message);
                document.getElementById("geolocate-btn").textContent = "📍 Posizione";
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });

    // Map search (geocoding via Nominatim)
    let searchTimeout = null;
    document.getElementById("map-search-input").addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        const q = e.target.value.trim();
        if (q.length < 3) return;

        searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ", Italia")}&format=json&limit=1`,
                    { headers: { "Accept-Language": "it" } }
                );
                const results = await res.json();
                if (results.length > 0) {
                    const { lat, lon } = results[0];
                    map.setView([parseFloat(lat), parseFloat(lon)], 13);
                }
            } catch (err) {
                console.warn("Geocoding error:", err);
            }
        }, 500);
    });

    document.getElementById("map-search-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.target.dispatchEvent(new Event("input"));
        }
    });
}

function buildStationPopup(station, isFav) {
    let pricesHtml = "";
    for (const fuel of ["Benzina", "Gasolio", "GPL", "Metano"]) {
        const price = station.prezzi?.[fuel]?.self;
        if (price == null) continue;

        const avg = DATA.nazionale?.[fuel]?.self?.media;
        let vsHtml = "";
        if (avg) {
            const diff = price - avg;
            const cls = diff < -0.005 ? "better" : diff > 0.005 ? "worse" : "";
            vsHtml = `<div class="popup-vs"><span class="${cls}">${diff > 0 ? "+" : ""}${diff.toFixed(3)}</span> vs media</div>`;
        }

        pricesHtml += `
            <div class="popup-fuel">
                ${FUEL_EMOJI[fuel] || ""} ${fuel}<br>
                <strong>${price.toFixed(3)} €</strong>
                ${vsHtml}
            </div>
        `;
    }

    return `
        <div class="station-popup">
            <h4>${station.bandiera || station.gestore}</h4>
            <div class="popup-addr">${station.indirizzo || ""}</div>
            <div class="popup-prices">${pricesHtml}</div>
            <div class="popup-actions">
                <button class="popup-fav-btn" onclick="window._toggleMapFav(${station.id})">
                    ${isFav ? "⭐ Rimuovi preferito" : "☆ Aggiungi ai preferiti"}
                </button>
            </div>
        </div>
    `;
}

// Global handler for popup favorite button
window._toggleMapFav = function(stationId) {
    toggleFavorite(stationId);
    map.closePopup();
};

// ── Favorites ──────────────────────────────────────────────────────────────

function getFavorites() {
    try { return JSON.parse(localStorage.getItem("fav_stations") || "[]"); }
    catch { return []; }
}

function saveFavorites(ids) {
    localStorage.setItem("fav_stations", JSON.stringify(ids));
}

function initFavorites() {
    renderFavorites();

    // Open modal
    document.getElementById("add-fav-btn").addEventListener("click", () => {
        document.getElementById("fav-modal").style.display = "flex";
        document.getElementById("station-search-input").value = "";
        document.getElementById("station-search-results").innerHTML = "";
        setTimeout(() => document.getElementById("station-search-input").focus(), 100);
    });

    // Close modal
    document.getElementById("fav-modal-close").addEventListener("click", closeFavModal);
    document.getElementById("fav-modal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("fav-modal")) closeFavModal();
    });

    // Search stations
    document.getElementById("station-search-input").addEventListener("input", (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (q.length < 2 || !STATIONS) {
            document.getElementById("station-search-results").innerHTML = "";
            return;
        }

        const favIds = getFavorites();
        const matches = STATIONS
            .filter(s =>
                s.nome?.toLowerCase().includes(q) ||
                s.gestore?.toLowerCase().includes(q) ||
                s.indirizzo?.toLowerCase().includes(q) ||
                s.comune?.toLowerCase().includes(q) ||
                s.bandiera?.toLowerCase().includes(q) ||
                String(s.id).includes(q)
            )
            .slice(0, 15);

        const container = document.getElementById("station-search-results");
        if (matches.length === 0) {
            container.innerHTML = `<p style="padding:16px;color:var(--text-muted);text-align:center">Nessun risultato</p>`;
            return;
        }

        container.innerHTML = matches.map(s => {
            const isFav = favIds.includes(s.id);
            const benzSelf = s.prezzi?.Benzina?.self;
            const priceStr = benzSelf != null ? `${benzSelf.toFixed(3)} €/L` : "";
            return `
                <div class="station-result" data-id="${s.id}">
                    <div class="station-result-info">
                        <div class="station-result-name">${s.bandiera || s.gestore} — ${s.nome || ""}</div>
                        <div class="station-result-addr">${s.indirizzo || ""}</div>
                    </div>
                    <div class="station-result-price">${priceStr}</div>
                    <button class="star-btn" data-id="${s.id}" title="${isFav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}">${isFav ? "⭐" : "☆"}</button>
                </div>
            `;
        }).join("");

        container.querySelectorAll(".star-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleFavorite(parseInt(btn.dataset.id));
                // Refresh search results to update star
                document.getElementById("station-search-input").dispatchEvent(new Event("input"));
            });
        });
    });
}

function closeFavModal() {
    document.getElementById("fav-modal").style.display = "none";
}

function toggleFavorite(stationId) {
    let favs = getFavorites();
    if (favs.includes(stationId)) {
        favs = favs.filter(id => id !== stationId);
    } else {
        favs.push(stationId);
    }
    saveFavorites(favs);
    renderFavorites();
}

function renderFavorites() {
    const favIds = getFavorites();
    const emptyEl = document.getElementById("fav-empty");
    const listEl = document.getElementById("fav-list");

    if (favIds.length === 0 || !STATIONS) {
        emptyEl.style.display = "block";
        listEl.innerHTML = "";
        return;
    }

    emptyEl.style.display = "none";
    const favStations = favIds.map(id => STATIONS.find(s => s.id === id)).filter(Boolean);

    listEl.innerHTML = favStations.map(s => {
        let pricesHtml = "";
        for (const fuel of ["Benzina", "Gasolio", "GPL", "Metano"]) {
            const stPrice = s.prezzi?.[fuel]?.self;
            if (stPrice == null) continue;

            // Confronta con media comunale o provinciale
            let avgPrice = null;
            let avgLabel = "";
            if (s.comune && DATA.comunali?.[s.comune]?.[fuel]?.self?.media) {
                avgPrice = DATA.comunali[s.comune][fuel].self.media;
                avgLabel = s.comune;
            } else if (s.provincia && DATA.provinciale?.[s.provincia]?.[fuel]?.self?.media) {
                avgPrice = DATA.provinciale[s.provincia][fuel].self.media;
                avgLabel = s.provincia;
            } else if (DATA.nazionale?.[fuel]?.self?.media) {
                avgPrice = DATA.nazionale[fuel].self.media;
                avgLabel = "Italia";
            }

            let vsHtml = "";
            if (avgPrice != null) {
                const diff = stPrice - avgPrice;
                const cls = diff < -0.005 ? "better" : diff > 0.005 ? "worse" : "same";
                const sign = diff > 0 ? "+" : "";
                vsHtml = `<span class="${cls}">${sign}${diff.toFixed(3)}</span> vs ${avgLabel}`;
            }

            pricesHtml += `
                <div class="fav-fuel">
                    <div class="fav-fuel-label">${FUEL_EMOJI[fuel] || ""} ${fuel}</div>
                    <div class="fav-fuel-price">${stPrice.toFixed(3)} €</div>
                    <div class="fav-fuel-vs">${vsHtml}</div>
                </div>
            `;
        }

        // Badge conveniente/costoso (basato su benzina)
        let badge = "";
        const benz = s.prezzi?.Benzina?.self;
        const benzAvg = DATA.nazionale?.Benzina?.self?.media;
        if (benz != null && benzAvg != null) {
            const diff = benz - benzAvg;
            if (diff < -0.02) badge = `<span class="fav-badge cheap">💰 Conveniente</span>`;
            else if (diff > 0.02) badge = `<span class="fav-badge expensive">📈 Sopra media</span>`;
            else badge = `<span class="fav-badge average">≈ In media</span>`;
        }

        return `
            <div class="fav-card">
                <div class="fav-card-header">
                    <div class="fav-card-info">
                        <h4>${s.bandiera || s.gestore} — ${s.nome || ""}</h4>
                        <div class="fav-address">${s.indirizzo || ""}</div>
                        ${badge}
                    </div>
                    <button class="fav-remove" data-id="${s.id}" title="Rimuovi">🗑️</button>
                </div>
                <div class="fav-prices">${pricesHtml}</div>
            </div>
        `;
    }).join("");

    // Remove buttons
    listEl.querySelectorAll(".fav-remove").forEach(btn => {
        btn.addEventListener("click", () => {
            toggleFavorite(parseInt(btn.dataset.id));
        });
    });
}

})();
