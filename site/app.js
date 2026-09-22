/**
 * Prezzi Carburanti Italia - Dashboard App
 * Carica dati JSON, renderizza card, chart, tabelle e ricerca.
 */

(() => {
"use strict";

// -- State ------------------------------------------------------------------
let DATA = null;
let HISTORY = null;
let trendChart = null;
let currentSort = { col: "name", asc: true };
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
        const [latestRes, historyRes] = await Promise.all([
            fetch("data/latest.json"),
            fetch("data/history.json"),
        ]);

        if (!latestRes.ok) throw new Error("latest.json non trovato");
        DATA = await latestRes.json();
        HISTORY = historyRes.ok ? await historyRes.json() : [];

        // Mappa province -> regioni
        if (DATA.provinciale) {
            for (const [prov, info] of Object.entries(DATA.provinciale)) {
                if (info.regione) PROVINCE_TO_REGION[prov] = info.regione;
            }
        }

        document.getElementById("loading").style.display = "none";
        document.getElementById("cerca-link").style.display = "block";
        render();
        checkBmwMode();
    } catch (err) {
        document.getElementById("loading").style.display = "none";
        document.getElementById("cerca-link").style.display = "block";
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


// Global handler for popup favorite button
window._toggleMapFav = function(stationId) {
    toggleFavorite(stationId);
    map.closePopup();
};

// -- Favorites --------------------------------------------------------------


// -- Zone Selection ---------------------------------------------------------


// -- Route Casa-Lavoro ------------------------------------------------------


// -- Cerca Distributore (practical search) ----------------------------------


var ssSearchCoords = null; // holds { lat, lng } from GPS or geocoding


// -- BMW Dashboard Link Mode ------------------------------------------------
function checkBmwMode() {
    var params = new URLSearchParams(window.location.search);
    var lat = params.get('lat');
    var lng = params.get('lng');
    var fuel = params.get('fuel') || 'Gasolio';
    var fromBmw = params.get('from') === 'bmw';
    
    if (!fromBmw || !lat || !lng) return;
    
    // Redirect to cerca.html with BMW params for full station search
    window.location.href = 'cerca.html?lat=' + lat + '&lng=' + lng + '&fuel=' + fuel + '&from=bmw';
}

})();
