/**
 * Cerca Distributore - Punto Fisso + Percorso A->B
 * Dati: stations.json (MIMIT). Routing: OSRM. Geocoding: Nominatim.
 * 100% ASCII
 */
(function() {
"use strict";

var STATIONS = [];
var map = null;
var markersLayer = null;
var routeLayer = null;
var circleLayer = null;
var currentMode = "point";
var currentResults = [];
var currentSort = "price";

// -- Init ---------------------------------------------------------------
document.addEventListener("DOMContentLoaded", function() {
    initMap();
    loadStations();
    setupAutocomplete("pt-zona", "pt-zona-ac");
    setupAutocomplete("rt-from", "rt-from-ac");
    setupAutocomplete("rt-to", "rt-to-ac");
    restoreState();
});

function initMap() {
    map = L.map("cerca-map", { zoomControl: true }).setView([41.9, 12.5], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    circleLayer = L.layerGroup().addTo(map);
}

function loadStations() {
    fetch("data/stations.json")
        .then(function(r) { return r.json(); })
        .then(function(data) {
            STATIONS = data;
            console.log("Loaded " + STATIONS.length + " stations");
        })
        .catch(function(e) { console.error("Failed to load stations", e); });
}

// -- Mode toggle --------------------------------------------------------
window.setMode = function(mode) {
    currentMode = mode;
    document.getElementById("mode-point").classList.toggle("active", mode === "point");
    document.getElementById("mode-route").classList.toggle("active", mode === "route");
    document.getElementById("form-point").classList.toggle("hidden", mode !== "point");
    document.getElementById("form-route").classList.toggle("hidden", mode !== "route");
    clearResults();
};

// -- GPS ----------------------------------------------------------------
window.useGps = function(target) {
    if (!navigator.geolocation) { alert("Geolocalizzazione non supportata"); return; }
    navigator.geolocation.getCurrentPosition(function(pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        reverseGeocode(lat, lng, function(name) {
            if (target === "point") {
                document.getElementById("pt-zona").value = name;
                document.getElementById("pt-zona").dataset.lat = lat;
                document.getElementById("pt-zona").dataset.lng = lng;
            } else if (target === "route-from") {
                document.getElementById("rt-from").value = name;
                document.getElementById("rt-from").dataset.lat = lat;
                document.getElementById("rt-from").dataset.lng = lng;
            }
        });
    }, function() { alert("Impossibile ottenere la posizione"); });
};

function reverseGeocode(lat, lng, cb) {
    fetch("https://nominatim.openstreetmap.org/reverse?format=json&lat=" + lat + "&lon=" + lng + "&zoom=16&addressdetails=1", {
        headers: { "Accept-Language": "it" }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) { cb(d.display_name ? d.display_name.split(",").slice(0, 3).join(",") : lat + ", " + lng); })
    .catch(function() { cb(lat + ", " + lng); });
}

// -- Autocomplete (Nominatim) -------------------------------------------
function setupAutocomplete(inputId, dropdownId) {
    var input = document.getElementById(inputId);
    var dropdown = document.getElementById(dropdownId);
    var timer = null;
    input.addEventListener("input", function() {
        clearTimeout(timer);
        var q = input.value.trim();
        if (q.length < 3) { dropdown.classList.remove("show"); return; }
        timer = setTimeout(function() {
            fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(q) + "&countrycodes=it&limit=5&addressdetails=1", {
                headers: { "Accept-Language": "it" }
            })
            .then(function(r) { return r.json(); })
            .then(function(results) {
                dropdown.innerHTML = "";
                if (!results.length) { dropdown.classList.remove("show"); return; }
                results.forEach(function(r) {
                    var item = document.createElement("div");
                    item.className = "ac-item";
                    item.textContent = r.display_name.substring(0, 80);
                    item.addEventListener("click", function() {
                        input.value = r.display_name.split(",").slice(0, 3).join(",");
                        input.dataset.lat = r.lat;
                        input.dataset.lng = r.lon;
                        dropdown.classList.remove("show");
                    });
                    dropdown.appendChild(item);
                });
                dropdown.classList.add("show");
            });
        }, 400);
    });
    document.addEventListener("click", function(e) {
        if (!dropdown.contains(e.target) && e.target !== input) dropdown.classList.remove("show");
    });
}

// -- Haversine ----------------------------------------------------------
function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// -- Point-to-segment distance ------------------------------------------
function pointToSegmentDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return haversine(px, py, ax, ay);
    var t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return haversine(px, py, ax + t * dx, ay + t * dy);
}

// -- Distance from point to polyline ------------------------------------
function distToPolyline(lat, lng, coords) {
    var minDist = Infinity;
    // Sample every N points for performance
    var step = Math.max(1, Math.floor(coords.length / 500));
    for (var i = 0; i < coords.length - 1; i += step) {
        var j = Math.min(i + step, coords.length - 1);
        var d = pointToSegmentDist(lat, lng, coords[i][1], coords[i][0], coords[j][1], coords[j][0]);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

// -- Search: Point mode -------------------------------------------------
window.searchPoint = function() {
    var input = document.getElementById("pt-zona");
    var lat = parseFloat(input.dataset.lat);
    var lng = parseFloat(input.dataset.lng);
    if (isNaN(lat) || isNaN(lng)) {
        // Try geocoding the text
        geocodeAndSearch(input.value, function(la, ln) {
            input.dataset.lat = la;
            input.dataset.lng = ln;
            doPointSearch(la, ln);
        });
        return;
    }
    doPointSearch(lat, lng);
};

function geocodeAndSearch(query, cb) {
    if (!query || query.length < 2) { alert("Inserisci un indirizzo"); return; }
    document.getElementById(currentMode === "point" ? "pt-search" : "rt-search").disabled = true;
    fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(query) + "&countrycodes=it&limit=1", {
        headers: { "Accept-Language": "it" }
    })
    .then(function(r) { return r.json(); })
    .then(function(results) {
        document.getElementById(currentMode === "point" ? "pt-search" : "rt-search").disabled = false;
        if (!results.length) { alert("Indirizzo non trovato"); return; }
        cb(parseFloat(results[0].lat), parseFloat(results[0].lon));
    })
    .catch(function() {
        document.getElementById(currentMode === "point" ? "pt-search" : "rt-search").disabled = false;
        alert("Errore nella ricerca indirizzo");
    });
}

function doPointSearch(lat, lng) {
    var radius = parseFloat(document.getElementById("pt-raggio").value);
    var fuel = document.getElementById("pt-fuel").value;
    var mode = document.getElementById("pt-mode").value;

    var results = [];
    for (var i = 0; i < STATIONS.length; i++) {
        var s = STATIONS[i];
        if (!s.lat || !s.lng || !s.prezzi || !s.prezzi[fuel]) continue;
        var price = mode === "self" ? s.prezzi[fuel].self : s.prezzi[fuel].servito;
        if (!price || price <= 0) continue;
        var dist = haversine(lat, lng, s.lat, s.lng);
        if (dist <= radius) {
            results.push({ station: s, dist: dist, price: price, deviation: dist });
        }
    }
    results.sort(function(a, b) { return a.price - b.price; });
    currentResults = results;
    currentSort = "price";

    // Update map
    clearMapLayers();
    circleLayer.addLayer(L.circle([lat, lng], { radius: radius * 1000, color: "#3f8cff", fillColor: "#3f8cff", fillOpacity: 0.08, weight: 1 }));
    map.setView([lat, lng], radius <= 5 ? 13 : radius <= 15 ? 11 : 9);
    addMarkers(results, fuel, mode);

    // Status
    var modeLabel = mode === "self" ? "Self" : "Servito";
    showResults(results, fuel + " " + modeLabel + " entro " + radius + " km");
    saveState();
}

// -- Search: Route mode -------------------------------------------------
window.searchRoute = function() {
    var fromInput = document.getElementById("rt-from");
    var toInput = document.getElementById("rt-to");
    var fromLat = parseFloat(fromInput.dataset.lat);
    var fromLng = parseFloat(fromInput.dataset.lng);
    var toLat = parseFloat(toInput.dataset.lat);
    var toLng = parseFloat(toInput.dataset.lng);

    // Need to geocode missing coords
    var tasks = [];
    if (isNaN(fromLat) || isNaN(fromLng)) tasks.push({ input: fromInput, field: "from" });
    if (isNaN(toLat) || isNaN(toLng)) tasks.push({ input: toInput, field: "to" });

    if (tasks.length === 0) {
        doRouteSearch(fromLat, fromLng, toLat, toLng);
        return;
    }

    document.getElementById("rt-search").disabled = true;
    var done = 0;
    tasks.forEach(function(t) {
        fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(t.input.value) + "&countrycodes=it&limit=1", {
            headers: { "Accept-Language": "it" }
        })
        .then(function(r) { return r.json(); })
        .then(function(results) {
            if (results.length) {
                t.input.dataset.lat = results[0].lat;
                t.input.dataset.lng = results[0].lon;
            }
            done++;
            if (done === tasks.length) {
                document.getElementById("rt-search").disabled = false;
                fromLat = parseFloat(fromInput.dataset.lat);
                fromLng = parseFloat(fromInput.dataset.lng);
                toLat = parseFloat(toInput.dataset.lat);
                toLng = parseFloat(toInput.dataset.lng);
                if (isNaN(fromLat) || isNaN(toLat)) { alert("Impossibile geocodificare gli indirizzi"); return; }
                doRouteSearch(fromLat, fromLng, toLat, toLng);
            }
        });
    });
};

function doRouteSearch(fromLat, fromLng, toLat, toLng) {
    var dev = parseFloat(document.getElementById("rt-dev").value);
    var fuel = document.getElementById("rt-fuel").value;
    var mode = document.getElementById("rt-mode").value;
    var roundTrip = document.getElementById("rt-return").checked;

    document.getElementById("rt-search").disabled = true;
    document.getElementById("rt-search").innerHTML = '<span class="loading-spinner"></span>Calcolo percorso...';

    // Fetch route from OSRM
    var url1 = "https://router.project-osrm.org/route/v1/driving/" + fromLng + "," + fromLat + ";" + toLng + "," + toLat + "?overview=full&geometries=geojson";

    fetch(url1)
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (!data.routes || !data.routes.length) { throw new Error("Nessun percorso trovato"); }

        var route = data.routes[0];
        var coords = route.geometry.coordinates; // [lng, lat] pairs
        var durationMin = Math.round(route.duration / 60);
        var distanceKm = (route.distance / 1000).toFixed(1);

        // Draw route on map
        clearMapLayers();
        var latLngs = coords.map(function(c) { return [c[1], c[0]]; });
        routeLayer.addLayer(L.polyline(latLngs, { color: "#3f8cff", weight: 4, opacity: 0.8 }));

        // Start/end markers
        markersLayer.addLayer(L.marker([fromLat, fromLng], {
            icon: L.divIcon({ className: "", html: '<div style="background:#64e78b;color:#000;font-weight:700;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] })
        }));
        markersLayer.addLayer(L.marker([toLat, toLng], {
            icon: L.divIcon({ className: "", html: '<div style="background:#ef4444;color:#fff;font-weight:700;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);">B</div>', iconSize: [28, 28], iconAnchor: [14, 14] })
        }));

        // Find stations near route
        var stationMap = {};
        findStationsAlongRoute(coords, dev, fuel, mode, stationMap);

        // If round trip, fetch return route too
        if (roundTrip) {
            return fetch("https://router.project-osrm.org/route/v1/driving/" + toLng + "," + toLat + ";" + fromLng + "," + fromLat + "?overview=full&geometries=geojson")
            .then(function(r2) { return r2.json(); })
            .then(function(data2) {
                if (data2.routes && data2.routes.length) {
                    var coords2 = data2.routes[0].geometry.coordinates;
                    var latLngs2 = coords2.map(function(c) { return [c[1], c[0]]; });
                    routeLayer.addLayer(L.polyline(latLngs2, { color: "#64e78b", weight: 3, opacity: 0.6, dashArray: "8 6" }));
                    findStationsAlongRoute(coords2, dev, fuel, mode, stationMap);
                }
                return { stationMap: stationMap, distanceKm: distanceKm, durationMin: durationMin, roundTrip: true };
            });
        }
        return { stationMap: stationMap, distanceKm: distanceKm, durationMin: durationMin, roundTrip: false };
    })
    .then(function(info) {
        var results = Object.values(info.stationMap);
        results.sort(function(a, b) { return a.price - b.price; });
        currentResults = results;
        currentSort = "price";

        // Fit map to route
        var group = new L.featureGroup([routeLayer, markersLayer]);
        map.fitBounds(group.getBounds().pad(0.1));

        addMarkers(results, fuel, mode);

        var modeLabel = document.getElementById("rt-mode").value === "self" ? "Self" : "Servito";
        var extra = info.distanceKm + " km, ~" + info.durationMin + " min" + (info.roundTrip ? " (A+R)" : "");
        showResults(results, fuel + " " + modeLabel + " lungo il percorso (" + extra + ")");
        saveState();
    })
    .catch(function(e) {
        alert("Errore: " + e.message);
    })
    .finally(function() {
        var btn = document.getElementById("rt-search");
        btn.disabled = false;
        btn.textContent = "Cerca Lungo il Percorso";
    });

    var fuel = document.getElementById("rt-fuel").value;
    var mode = document.getElementById("rt-mode").value;
}

function findStationsAlongRoute(coords, maxDev, fuel, mode, stationMap) {
    for (var i = 0; i < STATIONS.length; i++) {
        var s = STATIONS[i];
        if (!s.lat || !s.lng || !s.prezzi || !s.prezzi[fuel]) continue;
        var price = mode === "self" ? s.prezzi[fuel].self : s.prezzi[fuel].servito;
        if (!price || price <= 0) continue;
        if (stationMap[s.id]) continue; // already found

        var dist = distToPolyline(s.lat, s.lng, coords);
        if (dist <= maxDev) {
            stationMap[s.id] = { station: s, dist: dist, price: price, deviation: dist };
        }
    }
}

// -- Display results ----------------------------------------------------
function showResults(results, label) {
    var panel = document.getElementById("results-panel");
    var status = document.getElementById("results-status");
    var saving = document.getElementById("results-saving");
    var body = document.getElementById("results-body");

    if (results.length === 0) {
        panel.classList.remove("hidden");
        status.textContent = "Nessun distributore trovato. Prova ad aumentare il raggio.";
        saving.classList.add("hidden");
        body.innerHTML = "";
        return;
    }

    panel.classList.remove("hidden");
    status.textContent = results.length + " distributori " + label;

    // Saving banner
    var best = results[0].price;
    var worst = results[results.length - 1].price;
    var diff = ((worst - best) * 50).toFixed(2);
    if (worst > best) {
        saving.classList.remove("hidden");
        saving.innerHTML = "<strong>Risparmio pieno 50L: " + diff + " EUR</strong> &mdash; <span>Migliore " + best.toFixed(3) + " (" + (results[0].station.bandiera || results[0].station.nome) + ") vs Peggiore " + worst.toFixed(3) + " (" + (results[results.length - 1].station.bandiera || results[results.length - 1].station.nome) + ")</span>";
    } else {
        saving.classList.add("hidden");
    }

    renderTable(results);
}

function renderTable(results) {
    var body = document.getElementById("results-body");
    var best = results.length > 0 ? results[0].price : 0;
    var html = "";
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var s = r.station;
        var rankClass = i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "rank-n";
        var diff = r.price - best;
        var diffStr = diff < 0.001 ? "" : "+" + diff.toFixed(3) + " EUR";
        var badge = "";
        if (i === 0) badge = '<span class="badge badge-best">Migliore</span>';
        else if (diff > 0.1) badge = '<span class="badge badge-worst">Costoso</span>';
        else if (diff > 0.05) badge = '<span class="badge badge-avg">Nella media</span>';

        html += "<tr>" +
            '<td><span class="rank-badge ' + rankClass + '">' + (i + 1) + "</span></td>" +
            '<td><div class="station-name">' + escHtml(s.bandiera || s.gestore || "N/D") + '</div><div class="station-addr">' + escHtml((s.indirizzo || "").substring(0, 60)) + " - " + escHtml(s.comune || "") + "</div></td>" +
            "<td>" + r.deviation.toFixed(1) + " km</td>" +
            "<td><strong>" + r.price.toFixed(3) + " EUR</strong></td>" +
            "<td>" + diffStr + "</td>" +
            "<td>" + badge + "</td>" +
            "</tr>";
    }
    body.innerHTML = html;
}

function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// -- Sort results -------------------------------------------------------
window.sortResults = function(by) {
    if (!currentResults.length) return;
    currentSort = by;
    if (by === "price") currentResults.sort(function(a, b) { return a.price - b.price; });
    else if (by === "dist") currentResults.sort(function(a, b) { return a.deviation - b.deviation; });
    renderTable(currentResults);
};

// -- Map helpers --------------------------------------------------------
function clearMapLayers() {
    markersLayer.clearLayers();
    routeLayer.clearLayers();
    circleLayer.clearLayers();
}

function clearResults() {
    document.getElementById("results-panel").classList.add("hidden");
    clearMapLayers();
    currentResults = [];
}

function addMarkers(results, fuel, mode) {
    if (!results.length) return;
    var best = results[0].price;
    var worst = results[results.length - 1].price;
    var range = worst - best || 1;

    results.forEach(function(r, idx) {
        var s = r.station;
        var pct = (r.price - best) / range;
        var color = pct < 0.33 ? "#22c55e" : pct < 0.66 ? "#eab308" : "#ef4444";
        var modeLabel = mode === "self" ? "Self" : "Servito";

        var marker = L.circleMarker([s.lat, s.lng], {
            radius: idx < 3 ? 10 : 7,
            fillColor: color,
            color: idx === 0 ? "#fff" : color,
            weight: idx === 0 ? 3 : 1,
            fillOpacity: 0.85
        });

        marker.bindPopup(
            "<strong>" + escHtml(s.bandiera || s.gestore) + "</strong><br>" +
            escHtml(s.indirizzo || "") + "<br>" +
            escHtml(s.comune || "") + " (" + escHtml(s.provincia || "") + ")<br>" +
            "<strong>" + fuel + " " + modeLabel + ": " + r.price.toFixed(3) + " EUR/L</strong><br>" +
            "Distanza: " + r.deviation.toFixed(1) + " km" +
            (idx === 0 ? "<br><span style='color:#22c55e;font-weight:600;'>&#x2713; Migliore!</span>" : "")
        );
        markersLayer.addLayer(marker);
    });
}

// -- State persistence --------------------------------------------------
function saveState() {
    try {
        localStorage.setItem("cerca_state", JSON.stringify({
            mode: currentMode,
            ptZona: document.getElementById("pt-zona").value,
            ptLat: document.getElementById("pt-zona").dataset.lat,
            ptLng: document.getElementById("pt-zona").dataset.lng,
            ptRaggio: document.getElementById("pt-raggio").value,
            ptFuel: document.getElementById("pt-fuel").value,
            ptMode: document.getElementById("pt-mode").value,
            rtFrom: document.getElementById("rt-from").value,
            rtFromLat: document.getElementById("rt-from").dataset.lat,
            rtFromLng: document.getElementById("rt-from").dataset.lng,
            rtTo: document.getElementById("rt-to").value,
            rtToLat: document.getElementById("rt-to").dataset.lat,
            rtToLng: document.getElementById("rt-to").dataset.lng,
            rtDev: document.getElementById("rt-dev").value,
            rtFuel: document.getElementById("rt-fuel").value,
            rtMode: document.getElementById("rt-mode").value,
            rtReturn: document.getElementById("rt-return").checked
        }));
    } catch(e) {}
}

function restoreState() {
    try {
        var s = JSON.parse(localStorage.getItem("cerca_state"));
        if (!s) return;
        if (s.mode) setMode(s.mode);
        if (s.ptZona) { document.getElementById("pt-zona").value = s.ptZona; document.getElementById("pt-zona").dataset.lat = s.ptLat || ""; document.getElementById("pt-zona").dataset.lng = s.ptLng || ""; }
        if (s.ptRaggio) { document.getElementById("pt-raggio").value = s.ptRaggio; document.getElementById("pt-raggio-val").textContent = s.ptRaggio; }
        if (s.ptFuel) document.getElementById("pt-fuel").value = s.ptFuel;
        if (s.ptMode) document.getElementById("pt-mode").value = s.ptMode;
        if (s.rtFrom) { document.getElementById("rt-from").value = s.rtFrom; document.getElementById("rt-from").dataset.lat = s.rtFromLat || ""; document.getElementById("rt-from").dataset.lng = s.rtFromLng || ""; }
        if (s.rtTo) { document.getElementById("rt-to").value = s.rtTo; document.getElementById("rt-to").dataset.lat = s.rtToLat || ""; document.getElementById("rt-to").dataset.lng = s.rtToLng || ""; }
        if (s.rtDev) { document.getElementById("rt-dev").value = s.rtDev; document.getElementById("rt-dev-val").textContent = s.rtDev; }
        if (s.rtFuel) document.getElementById("rt-fuel").value = s.rtFuel;
        if (s.rtMode) document.getElementById("rt-mode").value = s.rtMode;
        if (s.rtReturn) document.getElementById("rt-return").checked = s.rtReturn;
    } catch(e) {}
}

})();
