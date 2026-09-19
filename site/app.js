/**
 * Prezzi Carburanti Italia - Dashboard App
 * Carica dati JSON, renderizza card, chart, tabelle e ricerca.
 */

(() => {
"use strict";

// -- State ------------------------------------------------------------------
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
    Benzina: "B",
    Gasolio: "G",
    GPL: "L",
    Metano: "M",
};

const PROVINCE_TO_REGION = {};

// -- Init -------------------------------------------------------------------
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

        // Mappa province -> regioni
        if (DATA.provinciale) {
            for (const [prov, info] of Object.entries(DATA.provinciale)) {
                if (info.regione) PROVINCE_TO_REGION[prov] = info.regione;
            }
        }

        document.getElementById("loading").style.display = "none";
        render();
        checkBmwMode();
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
    renderSearchSection();
    renderTrendChart();
    renderRegionalTable();
    initSearch();
    initFavorites();
    initMap();
    initZone();
    initRoute();
    initTrendButtons();
}

// -- Theme ------------------------------------------------------------------
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
    document.getElementById("theme-toggle").textContent = theme === "light" ? "Moon" : "Sun";
}

// -- Header -----------------------------------------------------------------
function renderHeader() {
    const el = document.getElementById("last-update");
    if (DATA.data) {
        const d = DATA.data.split("-");
        el.textContent = ` ${d[2]}/${d[1]}/${d[0]}`;
    }

    const banner = document.getElementById("stats-banner");
    banner.style.display = "flex";
    document.getElementById("stat-impianti").textContent =
        (DATA.totale_impianti || 0).toLocaleString("it-IT");
    document.getElementById("stat-prezzi").textContent =
        (DATA.totale_prezzi || 0).toLocaleString("it-IT");
}

// -- National Cards ---------------------------------------------------------
function renderCards() {
    const container = document.getElementById("cards-container");
    container.innerHTML = "";

    for (const fuel of ["Benzina", "Gasolio", "GPL", "Metano"]) {
        const info = DATA.nazionale?.[fuel]?.self;
        if (!info) continue;

        const delta = info.variazione_giorno;
        const deltaClass = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
        const deltaStr = delta != null
            ? `${delta > 0 ? "+" : delta < 0 ? "-" : "="} ${Math.abs(delta).toFixed(3)} EUR`
            : "-";

        const weekDelta = info.variazione_settimana;
        const weekStr = weekDelta != null
            ? `Settimana: ${weekDelta > 0 ? "+" : ""}${weekDelta.toFixed(3)} EUR`
            : "";

        const card = document.createElement("div");
        card.className = `card card-fuel-${fuel.toLowerCase()}`;
        card.innerHTML = `
            <div class="card-label">${FUEL_EMOJI[fuel]} ${fuel}</div>
            <div class="card-price">${info.media?.toFixed(3) ?? "-"} <span class="unit">EUR/L</span></div>
            <div class="card-delta ${deltaClass}">${deltaStr}</div>
            <div class="card-range">Min ${info.min?.toFixed(3) ?? "-"} - Max ${info.max?.toFixed(3) ?? "-"} - ${info.num_impianti ?? 0} impianti</div>
            ${weekStr ? `<div class="card-range">${weekStr}</div>` : ""}
        `;
        container.appendChild(card);
    }
}

// -- Trend Chart ------------------------------------------------------------
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
                        label: item => `${item.dataset.label}: ${item.parsed.y?.toFixed(3)} EUR/L`,
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
                        callback: v => v.toFixed(2) + " EUR",
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

// -- Regional Table ---------------------------------------------------------
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

    // Click -> drill-down
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

// -- Province Drill-down ----------------------------------------------------
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

// -- Search -----------------------------------------------------------------
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
                <span>${titleCase(c.name)}</span>
                <span class="prov">${c.prov} ${c.cap || ""}</span>
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
    document.getElementById("search-input").value = titleCase(name);
    setZone(name, info.provincia);

    const info = DATA.comunali?.[name];
    if (!info) return;

    const detail = document.getElementById("comune-detail");
    detail.style.display = "block";

    let html = `<h3>[pin] ${titleCase(name)} <small style="color:var(--text-muted)">(${info.provincia}${info.cap ? " - " + info.cap : ""})</small></h3>`;
    html += `<div class="comune-grid">`;

    for (const fuel of ["Benzina", "Gasolio", "GPL", "Metano"]) {
        const local = info[fuel]?.self?.media;
        const national = DATA.nazionale?.[fuel]?.self?.media;

        let vsHtml = "";
        if (local != null && national != null) {
            const diff = local - national;
            const pct = ((diff / national) * 100).toFixed(1);
            const cls = diff < 0 ? "better" : diff > 0 ? "worse" : "";
            vsHtml = `vs media nazionale: <span class="${cls}">${diff > 0 ? "+" : ""}${diff.toFixed(3)} EUR (${diff > 0 ? "+" : ""}${pct}%)</span>`;
        }

        html += `
            <div class="comune-fuel-card">
                <div class="comune-fuel-label">${FUEL_EMOJI[fuel]} ${fuel}</div>
                <div class="comune-fuel-price">${local != null ? local.toFixed(3) + " EUR" : "n/d"}</div>
                <div class="comune-fuel-vs">${vsHtml}</div>
            </div>
        `;
    }

    html += `</div>`;
    detail.innerHTML = html;
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

// -- Helpers ----------------------------------------------------------------

function titleCase(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

var selectedZone = null;
function fmtPrice(v) {
    return v != null ? v.toFixed(3) + " EUR" : "-";
}

function fmtDelta(v) {
    if (v == null) return "-";
    const sign = v > 0 ? "+" : v < 0 ? "-" : "=";
    return `${sign} ${Math.abs(v).toFixed(3)}`;
}

function deltaClass(v) {
    if (v == null) return "delta-cell flat";
    return `delta-cell ${v > 0 ? "up" : v < 0 ? "down" : "flat"}`;
}

// -- Map --------------------------------------------------------------------

function initMap() {
    if (!STATIONS || STATIONS.length === 0) {
        document.getElementById("map-section").style.display = "none";
        return;
    }

    // Default center: Italy
    map = L.map("map").setView([41.9, 12.5], 6);

    // Tile layer - detect theme
    const tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const tileAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

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
                " Zooma o cerca una citt? per vedere i distributori";
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
            `${count} distributori visibili${count >= 200 ? " (max 200, zooma per vedere di pi?)" : ""}. Clicca su un punto per i dettagli.`;
    }

    map.on("moveend", updateMarkers);
    map.on("zoomend", updateMarkers);

    // Geolocation
    document.getElementById("geolocate-btn").addEventListener("click", () => {
        if (!navigator.geolocation) {
            alert("Geolocalizzazione non supportata dal browser");
            return;
        }
        document.getElementById("geolocate-btn").textContent = "? Ricerca...";
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
                }).addTo(map).bindPopup("[pin] La tua posizione").openPopup();

                document.getElementById("geolocate-btn").textContent = "[pin] Posizione";
            },
            (err) => {
                alert("Impossibile ottenere la posizione: " + err.message);
                document.getElementById("geolocate-btn").textContent = "[pin] Posizione";
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
                <strong>${price.toFixed(3)} EUR</strong>
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
                    ${isFav ? "[star] Rimuovi preferito" : "[star] Aggiungi ai preferiti"}
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

// -- Favorites --------------------------------------------------------------

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
            const priceStr = benzSelf != null ? `${benzSelf.toFixed(3)} EUR/L` : "";
            return `
                <div class="station-result" data-id="${s.id}">
                    <div class="station-result-info">
                        <div class="station-result-name">${s.bandiera || s.gestore} - ${titleCase(s.nome || "")}</div>
                        <div class="station-result-addr">${s.indirizzo || ""}</div>
                    </div>
                    <div class="station-result-price">${priceStr}</div>
                    <button class="star-btn" data-id="${s.id}" title="${isFav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}">${isFav ? "[star]" : "[star]"}</button>
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
                    <div class="fav-fuel-price">${stPrice.toFixed(3)} EUR</div>
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
            if (diff < -0.02) badge = `<span class="fav-badge cheap">[save] Conveniente</span>`;
            else if (diff > 0.02) badge = `<span class="fav-badge expensive">[up] Sopra media</span>`;
            else badge = `<span class="fav-badge average">~ In media</span>`;
        }

        return `
            <div class="fav-card">
                <div class="fav-card-header">
                    <div class="fav-card-info">
                        <h4>${s.bandiera || s.gestore} - ${titleCase(s.nome || "")}</h4>
                        <div class="fav-address">${s.indirizzo || ""}</div>
                        ${badge}
                    </div>
                    <button class="fav-remove" data-id="${s.id}" title="Rimuovi">[x]</button>
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


// -- Zone Selection ---------------------------------------------------------

function setZone(comuneName, provincia) {
    selectedZone = { comune: comuneName, provincia: provincia };
    var banner = document.getElementById("zone-banner");
    var bannerText = document.getElementById("zone-banner-text");
    banner.style.display = "flex";
    bannerText.textContent = "Stai guardando: " + titleCase(comuneName) + " (" + (provincia || "") + ")";
    
    // Center map on zone
    if (map && STATIONS) {
        var zoneStations = STATIONS.filter(function(s) {
            return s.comune && s.comune.toLowerCase() === comuneName.toLowerCase();
        });
        if (zoneStations.length > 0 && zoneStations[0].lat) {
            map.setView([zoneStations[0].lat, zoneStations[0].lng], 13);
        }
    }
    
    localStorage.setItem("selected_zone", JSON.stringify(selectedZone));
}

function resetZone() {
    selectedZone = null;
    document.getElementById("zone-banner").style.display = "none";
    localStorage.removeItem("selected_zone");
}

function initZone() {
    // Restore saved zone
    try {
        var saved = JSON.parse(localStorage.getItem("selected_zone"));
        if (saved && saved.comune && DATA.comunali && DATA.comunali[saved.comune]) {
            setZone(saved.comune, saved.provincia);
        }
    } catch(e) {}
    
    // Reset button
    document.getElementById("zone-banner-reset").addEventListener("click", resetZone);
}

// -- Route Casa-Lavoro ------------------------------------------------------

function initRoute() {
    // Restore saved route
    try {
        var saved = JSON.parse(localStorage.getItem("route_config"));
        if (saved) {
            document.getElementById("route-from").value = saved.from || "";
            document.getElementById("route-to").value = saved.to || "";
        }
    } catch(e) {}
    
    document.getElementById("route-go").addEventListener("click", calculateRoute);
    
    // Enter key on inputs
    document.getElementById("route-from").addEventListener("keydown", function(e) {
        if (e.key === "Enter") calculateRoute();
    });
    document.getElementById("route-to").addEventListener("keydown", function(e) {
        if (e.key === "Enter") calculateRoute();
    });
}

function calculateRoute() {
    var fromInput = document.getElementById("route-from").value.trim();
    var toInput = document.getElementById("route-to").value.trim();
    
    if (!fromInput || !toInput) {
        showRouteStatus("Inserisci sia partenza che arrivo");
        return;
    }
    
    // Save config
    localStorage.setItem("route_config", JSON.stringify({from: fromInput, to: toInput}));
    
    showRouteStatus("Ricerca in corso...");
    document.getElementById("route-results").style.display = "none";
    document.getElementById("route-savings").style.display = "none";
    
    // Geocode both addresses
    Promise.all([
        geocode(fromInput),
        geocode(toInput)
    ]).then(function(results) {
        var fromCoord = results[0];
        var toCoord = results[1];
        
        if (!fromCoord) {
            showRouteStatus("Partenza non trovata: " + fromInput);
            return;
        }
        if (!toCoord) {
            showRouteStatus("Arrivo non trovato: " + toInput);
            return;
        }
        
        findStationsAlongRoute(fromCoord, toCoord, fromInput, toInput);
    }).catch(function(err) {
        showRouteStatus("Errore nella ricerca: " + err.message);
    });
}

function geocode(query) {
    return fetch(
        "https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(query + ", Italia") + "&format=json&limit=1",
        { headers: { "Accept-Language": "it" } }
    )
    .then(function(r) { return r.json(); })
    .then(function(results) {
        if (results.length === 0) return null;
        return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon), name: results[0].display_name };
    });
}

function distanceKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    var projX = ax + t * dx;
    var projY = ay + t * dy;
    return distanceKm(px, py, projX, projY);
}

function findStationsAlongRoute(from, to, fromName, toName) {
    if (!STATIONS || STATIONS.length === 0) {
        showRouteStatus("Dati distributori non disponibili");
        return;
    }
    
    var maxDistKm = 3; // Max distance from route line
    var routeDistKm = distanceKm(from.lat, from.lng, to.lat, to.lng);
    
    var found = [];
    for (var i = 0; i < STATIONS.length; i++) {
        var s = STATIONS[i];
        if (!s.lat || !s.lng) continue;
        
        var distFromRoute = pointToSegmentDistance(s.lat, s.lng, from.lat, from.lng, to.lat, to.lng);
        if (distFromRoute > maxDistKm) continue;
        
        var distFromStart = distanceKm(from.lat, from.lng, s.lat, s.lng);
        var benzSelf = s.prezzi && s.prezzi.Benzina ? s.prezzi.Benzina.self : null;
        var gasSelf = s.prezzi && s.prezzi.Gasolio ? s.prezzi.Gasolio.self : null;
        
        if (benzSelf == null && gasSelf == null) continue;
        
        found.push({
            station: s,
            distFromRoute: distFromRoute,
            distFromStart: distFromStart,
            benzSelf: benzSelf,
            gasSelf: gasSelf
        });
    }
    
    // Sort by distance from start
    found.sort(function(a, b) { return a.distFromStart - b.distFromStart; });
    
    if (found.length === 0) {
        showRouteStatus("Nessun distributore trovato lungo la tratta " + fromName + " -> " + toName + " (raggio " + maxDistKm + "km). Prova con nomi piu specifici.");
        return;
    }
    
    showRouteStatus("Tratta: " + titleCase(fromName) + " -> " + titleCase(toName) + " (" + routeDistKm.toFixed(1) + " km) - " + found.length + " distributori trovati");
    
    renderRouteResults(found, from, to);
    renderRouteSavings(found);
    renderRouteOnMap(found, from, to);
}

function showRouteStatus(msg) {
    var el = document.getElementById("route-status");
    el.style.display = "block";
    el.textContent = msg;
}

function renderRouteResults(found, from, to) {
    var container = document.getElementById("route-results");
    container.style.display = "block";
    
    var benzPrices = found.filter(function(f) { return f.benzSelf != null; }).map(function(f) { return f.benzSelf; });
    var minBenz = benzPrices.length > 0 ? Math.min.apply(null, benzPrices) : null;
    var maxBenz = benzPrices.length > 0 ? Math.max.apply(null, benzPrices) : null;
    
    var html = '<table class="data-table"><thead><tr>';
    html += '<th>Distributore</th>';
    html += '<th>Dist.</th>';
    html += '<th>Benzina Self</th>';
    html += '<th>Gasolio Self</th>';
    html += '<th></th>';
    html += '</tr></thead><tbody>';
    
    for (var i = 0; i < Math.min(found.length, 50); i++) {
        var f = found[i];
        var s = f.station;
        var badge = '';
        if (f.benzSelf != null && f.benzSelf === minBenz) {
            badge = '<span class="route-badge cheapest">Piu economico</span>';
        } else if (f.benzSelf != null && f.benzSelf === maxBenz && found.length > 2) {
            badge = '<span class="route-badge priciest">Piu caro</span>';
        }
        
        html += '<tr>';
        html += '<td><strong>' + (s.bandiera || s.gestore || '') + '</strong><br><span class="dist-km">' + titleCase(s.indirizzo || '') + '</span></td>';
        html += '<td class="dist-km">' + f.distFromStart.toFixed(1) + ' km</td>';
        html += '<td class="price-cell">' + (f.benzSelf != null ? f.benzSelf.toFixed(3) + ' EUR' : '-') + '</td>';
        html += '<td class="price-cell">' + (f.gasSelf != null ? f.gasSelf.toFixed(3) + ' EUR' : '-') + '</td>';
        html += '<td>' + badge + '</td>';
        html += '</tr>';
    }
    
    html += '</tbody></table>';
    container.querySelector('.table-responsive').innerHTML = html;
}

function renderRouteSavings(found) {
    var benzPrices = found.filter(function(f) { return f.benzSelf != null; });
    if (benzPrices.length < 2) return;
    
    benzPrices.sort(function(a, b) { return a.benzSelf - b.benzSelf; });
    var cheapest = benzPrices[0];
    var priciest = benzPrices[benzPrices.length - 1];
    var diff = priciest.benzSelf - cheapest.benzSelf;
    var saving50L = (diff * 50).toFixed(2);
    
    if (diff < 0.005) return;
    
    var el = document.getElementById("route-savings");
    el.style.display = "block";
    el.innerHTML = '<div>Risparmio stimato per pieno 50L: <span class="saving-amount">' + saving50L + ' EUR</span></div>' +
        '<div class="saving-detail">Rifornendo da ' + (cheapest.station.bandiera || '') + ' (' + cheapest.benzSelf.toFixed(3) + ' EUR/L) invece che ' + 
        (priciest.station.bandiera || '') + ' (' + priciest.benzSelf.toFixed(3) + ' EUR/L)</div>';
}

function renderRouteOnMap(found, from, to) {
    if (!map) return;
    
    // Fit bounds to show full route
    var bounds = L.latLngBounds([
        [from.lat, from.lng],
        [to.lat, to.lng]
    ]);
    
    for (var i = 0; i < found.length; i++) {
        if (found[i].station.lat) {
            bounds.extend([found[i].station.lat, found[i].station.lng]);
        }
    }
    
    map.fitBounds(bounds.pad(0.1));
}





// -- Cerca Distributore (practical search) ----------------------------------

function renderSearchSection() {
    if (!STATIONS || STATIONS.length === 0) return;

    var section = document.createElement("section");
    section.className = "section";
    section.id = "search-station-section";

    section.innerHTML = '<div class="section-header"><h2>&#128270; Cerca Distributore</h2>' +
        '<span style="color:var(--muted);font-size:0.85em;">Trova il piu economico vicino a te</span></div>' +
        '<div class="search-station-form" id="search-station-form">' +
        '  <div class="ssf-row">' +
        '    <div class="ssf-field ssf-field-zona">' +
        '      <label for="ss-zona">Zona</label>' +
        '      <div class="ssf-input-group">' +
        '        <input type="text" id="ss-zona" placeholder="Indirizzo, citta o CAP..." autocomplete="off">' +
        '        <button type="button" id="ss-gps-btn" title="Usa la mia posizione">GPS</button>' +
        '      </div>' +
        '      <div id="ss-zona-dropdown" class="ss-dropdown"></div>' +
        '    </div>' +
        '    <div class="ssf-field ssf-field-raggio">' +
        '      <label for="ss-raggio">Raggio: <strong id="ss-raggio-val">5</strong> km</label>' +
        '      <input type="range" id="ss-raggio" min="1" max="30" value="5" step="1">' +
        '    </div>' +
        '    <div class="ssf-field">' +
        '      <label for="ss-fuel">Carburante</label>' +
        '      <select id="ss-fuel"><option value="Gasolio">Gasolio</option><option value="Benzina">Benzina</option><option value="GPL">GPL</option><option value="Metano">Metano</option></select>' +
        '    </div>' +
        '    <div class="ssf-field">' +
        '      <label for="ss-mode">Modalita</label>' +
        '      <select id="ss-mode"><option value="self">Self-service</option><option value="servito">Servito</option></select>' +
        '    </div>' +
        '    <div class="ssf-field ssf-field-btn">' +
        '      <button type="button" id="ss-search-btn" class="ss-btn-primary">Cerca</button>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '<div id="ss-status" style="display:none;padding:12px 0;color:var(--muted);"></div>' +
        '<div id="ss-results-wrap" style="display:none;">' +
        '  <div id="ss-savings" style="display:none;"></div>' +
        '  <div class="table-responsive"><div id="ss-results-table"></div></div>' +
        '</div>';

    // Insert after cards container (national overview) and before favorites
    var cardsSection = document.getElementById("cards-container");
    var parentEl = cardsSection ? cardsSection.closest("section") || cardsSection.parentNode : null;
    if (parentEl && parentEl.nextSibling) {
        parentEl.parentNode.insertBefore(section, parentEl.nextSibling);
    } else {
        var mainEl = document.querySelector("main.container") || document.querySelector("main");
        if (mainEl) mainEl.appendChild(section);
    }

    // Inject styles for the search form
    var style = document.createElement("style");
    style.textContent = '.search-station-form{background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:16px}' +
        '.ssf-row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}' +
        '.ssf-field{display:flex;flex-direction:column;gap:4px;min-width:140px}' +
        '.ssf-field-zona{flex:2;min-width:220px}' +
        '.ssf-field-raggio{flex:1;min-width:160px}' +
        '.ssf-field label{font-size:.78em;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px}' +
        '.ssf-input-group{display:flex;gap:6px}' +
        '.ssf-input-group input{flex:1}' +
        '#ss-zona,#ss-fuel,#ss-mode,#ss-raggio{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;color:var(--text);font-size:.92em;outline:none;transition:border-color .2s}' +
        '#ss-zona:focus,#ss-fuel:focus,#ss-mode:focus{border-color:rgba(63,140,255,.5)}' +
        '#ss-fuel,#ss-mode{cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%239fb2c7\' d=\'M2 4l4 4 4-4z\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}' +
        '#ss-raggio{-webkit-appearance:none;appearance:none;height:6px;background:rgba(255,255,255,.1);border-radius:3px;border:none;padding:0;margin-top:8px;cursor:pointer}' +
        '#ss-raggio::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:#3f8cff;border:2px solid rgba(255,255,255,.2);cursor:pointer;box-shadow:0 2px 6px rgba(63,140,255,.3)}' +
        '#ss-raggio::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#3f8cff;border:2px solid rgba(255,255,255,.2);cursor:pointer}' +
        '#ss-gps-btn{background:rgba(63,140,255,.15);border:1px solid rgba(63,140,255,.3);border-radius:10px;padding:10px 14px;color:#3f8cff;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .2s}' +
        '#ss-gps-btn:hover{background:rgba(63,140,255,.25)}' +
        '.ss-btn-primary{background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;border:none;border-radius:10px;padding:10px 24px;font-weight:600;font-size:.92em;cursor:pointer;transition:transform .15s,box-shadow .2s;box-shadow:0 4px 12px rgba(37,99,235,.3);white-space:nowrap}' +
        '.ss-btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(37,99,235,.4)}' +
        '.ssf-field-btn{justify-content:flex-end}' +
        '.ss-dropdown{position:absolute;z-index:999;background:var(--card,rgba(12,27,45,.95));border:1px solid rgba(255,255,255,.1);border-radius:10px;max-height:220px;overflow-y:auto;display:none;margin-top:2px;box-shadow:0 8px 24px rgba(0,0,0,.4)}' +
        '.ss-dropdown.open{display:block}' +
        '.ss-dropdown-item{padding:10px 14px;cursor:pointer;font-size:.88em;border-bottom:1px solid rgba(255,255,255,.04)}' +
        '.ss-dropdown-item:hover{background:rgba(63,140,255,.1)}' +
        '.ss-dropdown-item small{color:var(--muted);margin-left:6px}' +
        '.ssf-field-zona{position:relative}' +
        '#ss-savings{background:rgba(100,231,139,.08);border:1px solid rgba(100,231,139,.2);border-radius:12px;padding:14px 18px;margin-bottom:14px}' +
        '#ss-savings .saving-big{color:#64e78b;font-weight:700;font-size:1.1em}' +
        '.ss-badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:.72em;font-weight:700;text-transform:uppercase;letter-spacing:.5px}' +
        '.ss-badge-best{background:rgba(16,185,129,.15);color:#10b981}' +
        '.ss-badge-avg{background:rgba(245,158,11,.12);color:#f59e0b}' +
        '.ss-badge-high{background:rgba(239,68,68,.12);color:#ef4444}' +
        '.ss-rank{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-size:.72em;font-weight:700}' +
        '.ss-rank-1{background:rgba(100,231,139,.2);color:#64e78b}' +
        '.ss-rank-2{background:rgba(63,140,255,.15);color:#3f8cff}' +
        '.ss-rank-3{background:rgba(167,139,250,.15);color:#a78bfa}' +
        '.ss-rank-n{background:rgba(255,255,255,.06);color:var(--muted)}' +
        '@media(max-width:700px){.ssf-row{flex-direction:column}.ssf-field{min-width:100%!important}.ssf-field-btn{align-items:stretch}.ss-btn-primary{width:100%}}';
    document.head.appendChild(style);

    // Event handlers
    var raggioDrag = document.getElementById("ss-raggio");
    var raggioVal = document.getElementById("ss-raggio-val");
    raggioDrag.addEventListener("input", function() { raggioVal.textContent = raggioDrag.value; });

    document.getElementById("ss-search-btn").addEventListener("click", doStationSearch);

    // Enter key triggers search
    document.getElementById("ss-zona").addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            var dd = document.getElementById("ss-zona-dropdown");
            if (dd.classList.contains("open")) {
                var first = dd.querySelector(".ss-dropdown-item");
                if (first) first.click();
            } else {
                doStationSearch();
            }
        }
    });

    // GPS button
    document.getElementById("ss-gps-btn").addEventListener("click", function() {
        if (!navigator.geolocation) { alert("Geolocalizzazione non supportata"); return; }
        var btn = document.getElementById("ss-gps-btn");
        btn.textContent = "...";
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                ssSearchCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                document.getElementById("ss-zona").value = "La mia posizione (" + pos.coords.latitude.toFixed(4) + ", " + pos.coords.longitude.toFixed(4) + ")";
                btn.textContent = "GPS";
                doStationSearch();
            },
            function(err) {
                alert("Posizione non disponibile: " + err.message);
                btn.textContent = "GPS";
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });

    // Geocoding dropdown for zona input
    var ssSearchTimeout = null;
    document.getElementById("ss-zona").addEventListener("input", function() {
        ssSearchCoords = null; // Reset manual coords
        clearTimeout(ssSearchTimeout);
        var q = this.value.trim();
        var dd = document.getElementById("ss-zona-dropdown");
        if (q.length < 3) { dd.classList.remove("open"); return; }

        ssSearchTimeout = setTimeout(function() {
            fetch("https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(q + ", Italia") + "&format=json&limit=5&addressdetails=1",
                { headers: { "Accept-Language": "it" } })
            .then(function(r) { return r.json(); })
            .then(function(results) {
                if (!results || results.length === 0) { dd.classList.remove("open"); return; }
                dd.innerHTML = results.map(function(r, i) {
                    return '<div class="ss-dropdown-item" data-lat="' + r.lat + '" data-lng="' + r.lon + '">' +
                        r.display_name.split(",").slice(0, 3).join(",") +
                        '</div>';
                }).join("");
                dd.classList.add("open");
                dd.querySelectorAll(".ss-dropdown-item").forEach(function(item) {
                    item.addEventListener("click", function() {
                        ssSearchCoords = { lat: parseFloat(item.dataset.lat), lng: parseFloat(item.dataset.lng) };
                        document.getElementById("ss-zona").value = item.textContent.trim();
                        dd.classList.remove("open");
                        doStationSearch();
                    });
                });
            })
            .catch(function() { dd.classList.remove("open"); });
        }, 400);
    });

    // Close dropdown on outside click
    document.addEventListener("click", function(e) {
        if (!e.target.closest(".ssf-field-zona")) {
            document.getElementById("ss-zona-dropdown").classList.remove("open");
        }
    });

    // Restore last search
    try {
        var saved = JSON.parse(localStorage.getItem("ss_last_search"));
        if (saved) {
            document.getElementById("ss-zona").value = saved.zona || "";
            document.getElementById("ss-raggio").value = saved.raggio || 5;
            raggioVal.textContent = saved.raggio || 5;
            document.getElementById("ss-fuel").value = saved.fuel || "Gasolio";
            document.getElementById("ss-mode").value = saved.mode || "self";
            if (saved.lat && saved.lng) {
                ssSearchCoords = { lat: saved.lat, lng: saved.lng };
            }
        }
    } catch(e) {}
}

var ssSearchCoords = null; // holds { lat, lng } from GPS or geocoding

function doStationSearch() {
    var zona = document.getElementById("ss-zona").value.trim();
    var raggio = parseInt(document.getElementById("ss-raggio").value) || 5;
    var fuel = document.getElementById("ss-fuel").value;
    var mode = document.getElementById("ss-mode").value;

    if (!zona) {
        showSSStatus("Inserisci una zona o usa il GPS");
        return;
    }

    // Save search params
    localStorage.setItem("ss_last_search", JSON.stringify({
        zona: zona, raggio: raggio, fuel: fuel, mode: mode,
        lat: ssSearchCoords ? ssSearchCoords.lat : null,
        lng: ssSearchCoords ? ssSearchCoords.lng : null
    }));

    if (ssSearchCoords) {
        executeStationSearch(ssSearchCoords.lat, ssSearchCoords.lng, raggio, fuel, mode, zona);
    } else {
        // Geocode first
        showSSStatus("Ricerca posizione...");
        fetch("https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(zona + ", Italia") + "&format=json&limit=1",
            { headers: { "Accept-Language": "it" } })
        .then(function(r) { return r.json(); })
        .then(function(results) {
            if (!results || results.length === 0) {
                showSSStatus("Posizione non trovata: " + zona);
                return;
            }
            var lat = parseFloat(results[0].lat);
            var lng = parseFloat(results[0].lon);
            ssSearchCoords = { lat: lat, lng: lng };
            executeStationSearch(lat, lng, raggio, fuel, mode, zona);
        })
        .catch(function(err) {
            showSSStatus("Errore geocoding: " + err.message);
        });
    }
}

function executeStationSearch(lat, lng, raggio, fuel, mode, zonaLabel) {
    if (!STATIONS || STATIONS.length === 0) {
        showSSStatus("Dati distributori non ancora caricati. Riprova tra qualche secondo.");
        return;
    }

    var found = [];
    for (var i = 0; i < STATIONS.length; i++) {
        var s = STATIONS[i];
        if (!s.lat || !s.lng) continue;
        var dist = haversine(lat, lng, s.lat, s.lng);
        if (dist > raggio) continue;

        var priceObj = s.prezzi ? s.prezzi[fuel] : null;
        if (!priceObj) continue;
        var price = mode === "self" ? priceObj.self : priceObj.servito;
        if (price == null || price <= 0) continue;

        found.push({ station: s, dist: dist, price: price });
    }

    found.sort(function(a, b) { return a.price - b.price; });

    var wrap = document.getElementById("ss-results-wrap");
    var statusEl = document.getElementById("ss-status");
    var savingsEl = document.getElementById("ss-savings");
    var tableEl = document.getElementById("ss-results-table");

    if (found.length === 0) {
        showSSStatus("Nessun distributore " + fuel + " (" + mode + ") trovato entro " + raggio + " km da " + zonaLabel);
        wrap.style.display = "none";
        return;
    }

    var modeLabel = mode === "self" ? "Self" : "Servito";
    statusEl.style.display = "block";
    statusEl.innerHTML = '<strong>' + found.length + '</strong> distributori ' + fuel + ' ' + modeLabel + ' entro <strong>' + raggio + ' km</strong> da ' + zonaLabel;

    // Savings
    if (found.length >= 2) {
        var cheapest = found[0].price;
        var priciest = found[found.length - 1].price;
        var diff = priciest - cheapest;
        var saving50L = (diff * 50).toFixed(2);
        if (diff >= 0.005) {
            savingsEl.style.display = "block";
            savingsEl.innerHTML = '<span class="saving-big">Risparmio pieno 50L: ' + saving50L + ' EUR</span>' +
                '<div style="color:var(--muted);font-size:.82em;margin-top:4px;">Migliore: ' + cheapest.toFixed(3) + ' EUR/L' +
                ' (' + (found[0].station.bandiera || "") + ') &mdash; Peggiore: ' + priciest.toFixed(3) + ' EUR/L (' + (found[found.length-1].station.bandiera || "") + ')</div>';
        } else {
            savingsEl.style.display = "none";
        }
    } else {
        savingsEl.style.display = "none";
    }

    // Compute average for badge classification
    var sum = 0;
    for (var j = 0; j < found.length; j++) sum += found[j].price;
    var avg = sum / found.length;

    // Results table
    var html = '<table class="data-table"><thead><tr>' +
        '<th>#</th><th>Distributore</th><th>Distanza</th><th>Prezzo</th><th>vs Migliore</th><th></th>' +
        '</tr></thead><tbody>';

    var cheapestPrice = found[0].price;
    var maxShow = Math.min(found.length, 50);
    for (var k = 0; k < maxShow; k++) {
        var f = found[k];
        var s = f.station;
        var diff2 = f.price - cheapestPrice;
        var diffStr = diff2 < 0.001 ? "-" : "+" + diff2.toFixed(3) + " EUR";
        var diffStyle = diff2 < 0.001 ? "color:#64e78b" : diff2 > 0.05 ? "color:#ef4444" : "color:#ffc65b";

        // Rank badge
        var rankClass = k === 0 ? "ss-rank-1" : k === 1 ? "ss-rank-2" : k === 2 ? "ss-rank-3" : "ss-rank-n";
        var rankHtml = '<span class="ss-rank ' + rankClass + '">' + (k+1) + '</span>';

        // Price badge
        var badge = "";
        if (k === 0) {
            badge = '<span class="ss-badge ss-badge-best">Migliore</span>';
        } else if (f.price <= avg) {
            badge = '<span class="ss-badge ss-badge-avg">Nella media</span>';
        } else {
            badge = '<span class="ss-badge ss-badge-high">Costoso</span>';
        }

        html += '<tr>' +
            '<td>' + rankHtml + '</td>' +
            '<td><strong>' + titleCase(s.bandiera || s.gestore || "") + '</strong><br><span style="color:var(--muted);font-size:.78em;">' + titleCase(s.indirizzo || "") + (s.comune ? ", " + titleCase(s.comune) : "") + '</span></td>' +
            '<td style="font-family:monospace;white-space:nowrap;">' + f.dist.toFixed(1) + ' km</td>' +
            '<td style="font-family:monospace;font-weight:700;">' + f.price.toFixed(3) + ' EUR</td>' +
            '<td style="' + diffStyle + ';font-family:monospace;">' + diffStr + '</td>' +
            '<td>' + badge + '</td>' +
            '</tr>';
    }

    html += '</tbody></table>';
    tableEl.innerHTML = html;
    wrap.style.display = "block";

    // Center map on search location and zoom to radius
    if (map) {
        map.setView([lat, lng], raggio <= 3 ? 14 : raggio <= 10 ? 12 : 10);
    }

    // Scroll to results
    wrap.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showSSStatus(msg) {
    var el = document.getElementById("ss-status");
    el.style.display = "block";
    el.textContent = msg;
    document.getElementById("ss-results-wrap").style.display = "none";
}


// -- BMW Dashboard Link Mode ------------------------------------------------
function checkBmwMode() {
    var params = new URLSearchParams(window.location.search);
    var lat = parseFloat(params.get('lat'));
    var lng = parseFloat(params.get('lng'));
    var fuel = params.get('fuel') || 'Gasolio';
    var fromBmw = params.get('from') === 'bmw';
    
    if (!fromBmw || isNaN(lat) || isNaN(lng)) return;
    
    // Show BMW banner
    var banner = document.createElement('div');
    banner.id = 'bmw-banner';
    banner.style.cssText = 'background:linear-gradient(90deg,rgba(63,140,255,0.15),rgba(100,231,139,0.1));border:1px solid rgba(63,140,255,0.3);border-radius:12px;padding:14px 20px;margin:16px 0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;';
    banner.innerHTML = '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:1.4em;">&#x1F697;</span>' +
        '<div><strong style="color:#3f8cff;">BMW Dashboard</strong>' +
        '<span style="color:#9fb2c7;font-size:0.85em;margin-left:8px;">Distributori ' + fuel + ' vicini alla tua posizione</span></div>' +
        '</div>' +
        '<a href="https://bmw.samuelecorona.it/fuel" style="color:#64e78b;font-size:0.85em;text-decoration:none;">Torna alla BMW Dashboard &rarr;</a>';
    
    var main = document.querySelector('main.container') || document.querySelector('main');
    if (main && main.firstChild) {
        main.insertBefore(banner, main.firstChild.nextSibling);
    }
    
    // Center map on position
    if (map) {
        map.setView([lat, lng], 14);
    }
    
    // Find and show nearby stations sorted by fuel price
    if (STATIONS && STATIONS.length > 0) {
        var nearby = [];
        for (var i = 0; i < STATIONS.length; i++) {
            var s = STATIONS[i];
            if (!s.lat || !s.lng) continue;
            var dist = haversine(lat, lng, s.lat, s.lng);
            if (dist > 5) continue; // 5km radius
            var price = null;
            if (s.prezzi && s.prezzi[fuel]) {
                price = s.prezzi[fuel].self || s.prezzi[fuel].servito || null;
            }
            if (price === null) continue;
            nearby.push({ station: s, dist: dist, price: price });
        }
        nearby.sort(function(a, b) { return a.price - b.price; });
        
        // Show results panel
        if (nearby.length > 0) {
            showBmwResults(nearby, fuel, lat, lng);
        }
    }
}

function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function showBmwResults(nearby, fuel, centerLat, centerLng) {
    var section = document.createElement('section');
    section.className = 'section';
    section.id = 'bmw-results';
    
    var cheapest = nearby[0].price;
    var mostExpensive = nearby[nearby.length - 1].price;
    var savings50L = ((mostExpensive - cheapest) * 50).toFixed(2);
    
    var html = '<div class="section-header"><h2>&#9981; Distributori ' + fuel + ' vicini</h2>' +
        '<span style="color:#64e78b;font-size:0.85em;">' + nearby.length + ' trovati nel raggio di 5km</span></div>';
    
    // Savings highlight
    html += '<div style="background:rgba(100,231,139,0.1);border:1px solid rgba(100,231,139,0.25);border-radius:12px;padding:14px 18px;margin-bottom:16px;">' +
        '<strong style="color:#64e78b;">Risparmio potenziale per pieno 50L: ' + savings50L + ' EUR</strong>' +
        '<span style="color:#9fb2c7;font-size:0.82em;display:block;margin-top:4px;">' +
        'Dal piu economico (' + cheapest.toFixed(3) + ' EUR/L) al piu caro (' + mostExpensive.toFixed(3) + ' EUR/L)</span></div>';
    
    // Table
    html += '<div class="table-responsive"><table class="data-table"><thead><tr>' +
        '<th>Distributore</th><th>Distanza</th><th>' + fuel + ' Self</th><th>vs Migliore</th>' +
        '</tr></thead><tbody>';
    
    var maxShow = Math.min(nearby.length, 20);
    for (var i = 0; i < maxShow; i++) {
        var n = nearby[i];
        var s = n.station;
        var diff = n.price - cheapest;
        var diffStr = diff < 0.001 ? 'Migliore!' : '+' + diff.toFixed(3) + ' EUR';
        var diffClass = diff < 0.001 ? 'color:#64e78b;font-weight:700' : diff > 0.05 ? 'color:#ff6b6b' : 'color:#ffc65b';
        var name = titleCase(s.bandiera || s.gestore || '');
        var addr = titleCase(s.indirizzo || s.comune || '');
        
        html += '<tr><td><strong>' + name + '</strong><br><span style="color:#9fb2c7;font-size:0.78em;">' + addr + '</span></td>' +
            '<td style="font-family:monospace;">' + n.dist.toFixed(1) + ' km</td>' +
            '<td style="font-family:monospace;font-weight:700;">' + n.price.toFixed(3) + ' EUR</td>' +
            '<td style="' + diffClass + '">' + diffStr + '</td></tr>';
    }
    
    html += '</tbody></table></div>';
    
    section.innerHTML = html;
    
    // Insert after the BMW banner
    var bmwBanner = document.getElementById('bmw-banner');
    if (bmwBanner && bmwBanner.parentNode) {
        bmwBanner.parentNode.insertBefore(section, bmwBanner.nextSibling);
    }
}


})();
