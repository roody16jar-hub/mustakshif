// Vector "game" map drawn from the bundled street geometry (no tiles by default):
// glowing district borders, fog over unexplored streets, bright explored streets that fade
// after 60 days, themed icons, city view with completion per district, optional OSM tiles.
// GPS tracking: high accuracy, smoothing, snap to the ONE nearest street within SNAP_METERS.
import { CONFIG } from "./config.js";
import { StreetIndex, Smoother, dist } from "./geo.js";
import { mapPalette } from "./theme.js";
import { icon } from "./icons.js";
import { isFaded } from "./domain.js";
import { demoPath } from "./demo.js";

const L = window.L;
let map, pal, tiles = null, attribution = null, districtsLayer, labelsLayer, streetLayer, itemLayer, trailLayer, meMarker, meCircle;
let index = null, hood = null, lines = new Map(), explored = new Map();     // wayId -> explored_at
let hooks = {}, watchId = null, wakeLock = null, follow = true, smoother = null, demoTimer = null;
let session = null, items = [], districts = {}, districtIndex = {}, exploredCounts = {}, pendingFit = null;
const hasSize = () => map && map.getSize().x > 0 && map.getSize().y > 0;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const mapView = {
  init(el, h) {
    hooks = h; pal = mapPalette();
    map = L.map(el, { preferCanvas: true, zoomControl: false, attributionControl: false, zoomSnap: 0.5 }).setView([24.80, 46.64], 11.5);
    el.style.background = pal.bg;
    districtsLayer = L.layerGroup().addTo(map); labelsLayer = L.layerGroup().addTo(map);
    streetLayer = L.layerGroup().addTo(map); trailLayer = L.layerGroup().addTo(map); itemLayer = L.layerGroup().addTo(map);
    map.on("dragstart", () => { follow = false; });
    let lastPress = 0;
    map.on("contextmenu", e => { const t = Date.now(); if (t - lastPress < 1200) return; lastPress = t; hooks.onLongPress && hooks.onLongPress(e.latlng); });
    map.on("zoomend", () => cityView());
    window.addEventListener("themechange", () => mapView.restyle());
    if (matchMedia("(min-width: 720px)").matches) L.control.zoom({ position: "bottomleft" }).addTo(map);
    return map;
  },
  invalidate() { if (!map) return; setTimeout(() => { map.invalidateSize(); if (pendingFit && hasSize()) { const b = pendingFit; pendingFit = null; map.fitBounds(b, { padding: [12, 12] }); } }, 60); },
  setOsm(on) {
    if (on && !tiles) {
      tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, crossOrigin: true, opacity: 0.85 }).addTo(map); tiles.bringToBack();
      attribution = L.control.attribution({ prefix: false }).addAttribution("© OpenStreetMap").addTo(map);
    }
    if (!on && tiles) { map.removeLayer(tiles); tiles = null; if (attribution) { map.removeControl(attribution); attribution = null; } }
    map.getContainer().classList.toggle("osm", !!on);
  },

  /** all district outlines + completion labels (city view) */
  setDistricts(bounds, idx, counts) { districts = bounds; districtIndex = idx || {}; exploredCounts = counts || {}; drawDistricts(); },
  setExploredCounts(counts) { exploredCounts = counts || {}; drawLabels(); },

  setHood(name, streetsFC, exploredRows, fit = true) {
    hood = name; explored = new Map(exploredRows.map(r => [String(r.id), r.explored_at]));
    index = new StreetIndex(streetsFC.features); lines.clear(); streetLayer.clearLayers();
    for (const f of streetsFC.features) {
      const id = String(f.properties.id); const ll = f.geometry.coordinates.map(c => [c[1], c[0]]);
      const glow = L.polyline(ll, { interactive: false }); const main = L.polyline(ll, { interactive: true });
      main.on("click", () => hooks.onStreetClick && hooks.onStreetClick(id, f.properties.name, explored.has(id)));
      lines.set(id, { glow, main, major: /primary|secondary|trunk/.test(f.properties.hw || "") });
      streetLayer.addLayer(glow); streetLayer.addLayer(main);
      styleStreet(id);
    }
    drawDistricts();
    if (fit && districts[name]) { const b = L.geoJSON(districts[name]).getBounds(); if (hasSize()) map.fitBounds(b, { padding: [12, 12] }); else pendingFit = b; }
    cityView();
    return mapView.coverage();
  },
  coverage() {
    if (!index) return { pct: 0, done: 0, total: 0, count: 0, streets: 0, faded: 0 };
    const ids = [...explored.keys()], total = index.totalLength(), done = index.lengthOf(ids);
    const faded = ids.filter(id => isFaded(explored.get(id))).length;
    return { pct: total ? Math.round(done / total * 1000) / 10 : 0, done, total, count: ids.length, streets: index.features.length, faded };
  },
  paintExplored(ids, on = true, at = new Date().toISOString()) {
    for (const id of ids) { if (on) explored.set(String(id), at); else explored.delete(String(id)); styleStreet(String(id)); }
  },
  restyle() {
    if (!map) return; pal = mapPalette(); map.getContainer().style.background = pal.bg;
    for (const id of lines.keys()) styleStreet(id); drawDistricts(); mapView.setItems(items);
    if (meCircle) meCircle.setStyle({ color: pal.me, fillColor: pal.me });
  },

  setItems(list) {
    items = list; itemLayer.clearLayers();
    for (const it of list) {
      const d = it.data; if (!d || d.lat == null || d.lon == null) continue;
      const kind = it.kind === "property" ? "home" : it.kind === "sign" ? "sign" : "target";
      const cls = it.kind === "property" ? "property" : it.kind === "sign" ? "sign" : (d.status === "visited" ? "visited" : d.status === "ignored" ? "ignored" : "target");
      const m = L.marker([d.lat, d.lon], { icon: L.divIcon({ className: `pin pin-${cls}${d.my_type ? " my" : ""}`, html: icon(kind), iconSize: [32, 32], iconAnchor: [16, 16] }), keyboard: false });
      m.bindTooltip(esc(d.title || d.ref || ""), { direction: "top", offset: [0, -14] });
      m.on("click", () => hooks.onItemClick && hooks.onItemClick(it.id));
      itemLayer.addLayer(m);
    }
  },
  focus(lat, lon, zoom = 17) { follow = false; pendingFit = null; if (hasSize()) map.setView([lat, lon], zoom); else setTimeout(() => map.setView([lat, lon], zoom), 120); },
  center() { return map.getCenter(); },
  zoom() { return map.getZoom(); },

  // ---- position ----
  placeMe(lat, lon, acc, { center = true, heading = null } = {}) {
    if (!hasSize()) return;                        // the map panel is hidden; nothing to draw yet
    if (!meMarker) {
      meCircle = L.circle([lat, lon], { radius: acc || 10, color: pal.me, weight: 1, fillColor: pal.me, fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker([lat, lon], { icon: L.divIcon({ className: "me", html: icon("nav"), iconSize: [28, 28], iconAnchor: [14, 14] }), keyboard: false, zIndexOffset: 1000 }).addTo(map);
    } else { meMarker.setLatLng([lat, lon]); meCircle.setLatLng([lat, lon]).setRadius(acc || 10); }
    const el = meMarker.getElement();
    if (el) { el.style.setProperty("--heading", (heading ?? 0) + "deg"); el.classList.toggle("has-heading", heading != null); }
    if (center) map.setView([lat, lon], Math.max(map.getZoom(), 17), { animate: true });
  },
  locateOnce() {
    return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }));
  },
  followMe() { follow = true; if (meMarker) map.setView(meMarker.getLatLng(), Math.max(map.getZoom(), 16)); },

  // ---- tracking ----
  tracking() { return watchId != null || demoTimer != null; },
  isDemo() { return demoTimer != null; },
  session() { return session; },
  async startTracking({ demo = false } = {}) {
    if (mapView.tracking()) return;
    follow = true; smoother = new Smoother({ maxAcc: CONFIG.MAX_ACCURACY_METERS, maxSpeed: 60 });
    session = { hood, started: Date.now(), km: 0, streets_new: 0, targets_near: 0, properties_added: 0, signs_added: 0, fixes: 0, rejected: 0, last: null, nearSeen: new Set(), demo };
    if (demo) {
      const path = demoPath(index, 400); let i = 0;
      demoTimer = setInterval(() => {
        if (!path.length) return; if (i >= path.length) i = 0;
        const [lon, lat] = path[i++]; const n = () => (Math.random() - 0.5) * 0.00008;
        onFix({ coords: { latitude: lat + n(), longitude: lon + n(), accuracy: 6 + Math.random() * 6, speed: 8, heading: null }, timestamp: Date.now() });
      }, 700);
    } else {
      watchId = navigator.geolocation.watchPosition(onFix, err => hooks.onFix && hooks.onFix(null, err), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    }
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
    document.addEventListener("visibilitychange", relock);
  },
  stopTracking() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null;
    clearInterval(demoTimer); demoTimer = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    document.removeEventListener("visibilitychange", relock);
    const s = session; session = null;
    if (!s) return null;
    return { hood: s.hood, started: new Date(s.started).toISOString(), ended: new Date().toISOString(), duration_s: Math.round((Date.now() - s.started) / 1000), km: Math.round(s.km / 100) / 10, streets_new: s.streets_new, targets_near: s.targets_near, properties_added: s.properties_added, signs_added: s.signs_added, fixes: s.fixes, rejected: s.rejected, demo: s.demo };
  },
  countInSession(key) { if (session) session[key] = (session[key] || 0) + 1; },
};

function styleStreet(id) {
  const l = lines.get(id); if (!l) return;
  const at = explored.get(id);
  if (at) {
    const faded = isFaded(at);
    l.glow.setStyle({ color: pal.exploredGlow, weight: faded ? 0 : 9, opacity: faded ? 0 : 1, dashArray: null });
    l.main.setStyle({ color: faded ? pal.faded : pal.explored, weight: faded ? 2.5 : 3.5, opacity: 1, dashArray: faded ? "6 6" : null });
  } else {
    l.glow.setStyle({ weight: 0, opacity: 0 });
    l.main.setStyle({ color: l.major ? pal.major : pal.unexplored, weight: l.major ? 2.5 : 2, opacity: 1, dashArray: l.major ? null : "2 5" });
  }
}
function drawDistricts() {
  if (!districtsLayer) return; districtsLayer.clearLayers();
  for (const [h, f] of Object.entries(districts)) {
    const cur = h === hood;
    const ll = f.geometry.coordinates[0].map(c => [c[1], c[0]]);
    if (cur) districtsLayer.addLayer(L.polyline([...ll, ll[0]], { color: pal.borderGlow, weight: 14, opacity: 1, interactive: false }));
    const line = L.polyline([...ll, ll[0]], { color: cur ? pal.border : pal.other, weight: cur ? 2.5 : 1.5, opacity: 1, dashArray: cur ? null : "4 6", interactive: !cur });
    if (!cur) line.on("click", () => hooks.onDistrictClick && hooks.onDistrictClick(h));
    districtsLayer.addLayer(line);
  }
  drawLabels();
}
function drawLabels() {
  if (!labelsLayer) return; labelsLayer.clearLayers();
  for (const h of Object.keys(districts)) {
    const info = districtIndex[h]; if (!info) continue;
    const pct = info.streets ? Math.round((exploredCounts[h] || 0) / info.streets * 100) : 0;
    const name = (hooks.hoodName && hooks.hoodName(h)) || h;
    const m = L.marker(info.center, { icon: L.divIcon({ className: "district-label" + (h === hood ? " cur" : ""), html: `<b>${esc(name)}</b><span>${pct}%</span>`, iconSize: [96, 44], iconAnchor: [48, 22] }), interactive: true, keyboard: false });
    m.on("click", () => hooks.onDistrictClick && hooks.onDistrictClick(h));
    labelsLayer.addLayer(m);
  }
  cityView();
}
function cityView() {
  if (!map) return; const city = map.getZoom() < 12;
  map.getContainer().classList.toggle("city", city);
  if (city) { if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer); if (!map.hasLayer(labelsLayer)) map.addLayer(labelsLayer); }
  else { if (!map.hasLayer(streetLayer)) map.addLayer(streetLayer); if (map.hasLayer(labelsLayer)) map.removeLayer(labelsLayer); }
}
async function relock() { if (!document.hidden && mapView.tracking() && navigator.wakeLock) { try { wakeLock = await navigator.wakeLock.request("screen"); } catch {} } }

function onFix(pos) {
  const { latitude, longitude, accuracy, speed, heading } = pos.coords;
  const sm = smoother.push({ lat: latitude, lon: longitude, acc: accuracy, t: pos.timestamp || Date.now() });
  if (session) session.fixes++;
  if (!sm) { if (session) session.rejected++; hooks.onFix && hooks.onFix({ lat: latitude, lon: longitude, acc: accuracy, speed, rejected: true, snapped: null, newly: 0 }, null); return; }
  mapView.placeMe(sm.lat, sm.lon, sm.acc, { center: follow, heading: heading != null && heading >= 0 ? heading : null });
  if (hasSize()) trailLayer.addLayer(L.circleMarker([sm.lat, sm.lon], { radius: 2, stroke: false, fillColor: pal.me, fillOpacity: 0.6, interactive: false }));
  if (trailLayer.getLayers().length > 800) trailLayer.removeLayer(trailLayer.getLayers()[0]);
  let newly = 0, snapped = null;
  if (session) {
    if (session.last) session.km += dist([session.last.lon, session.last.lat], [sm.lon, sm.lat]);
    session.last = sm;
    for (const it of items) { if (it.kind !== "target" || it.data.lat == null || session.nearSeen.has(it.id)) continue; if (dist([it.data.lon, it.data.lat], [sm.lon, sm.lat]) <= 40) { session.nearSeen.add(it.id); session.targets_near++; } }
  }
  if (index) {
    snapped = index.snap([sm.lon, sm.lat], CONFIG.SNAP_METERS);
    if (snapped && !explored.has(snapped.id)) { mapView.paintExplored([snapped.id], true); hooks.onExplored && hooks.onExplored([snapped.id], hood); newly = 1; if (session) session.streets_new++; }
  }
  hooks.onFix && hooks.onFix({ lat: sm.lat, lon: sm.lon, acc: sm.acc, speed, snapped, newly, rejected: false }, null);
}
