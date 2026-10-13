// Leaflet map: district boundary, streets coloured by explored state, item markers,
// live GPS tracking that marks streets explored. Leaflet is loaded globally (window.L).
import { CONFIG } from "./config.js";
import { StreetIndex } from "./geo.js";

const L = window.L;
let map, streetLayer, boundaryLayer, itemLayer, meMarker, meCircle, trailLayer;
let index = null, explored = new Set(), streetLines = new Map(), watchId = null, follow = true;
let hooks = { onExplored: () => {}, onFix: () => {}, onItemClick: () => {}, onLongPress: () => {} };
let hood = null, wakeLock = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLOR = { done: "#16a34a", todo: "#64748b", major: "#475569" };
const STATUS_COLOR = { new: "#f59e0b", visited: "#2563eb", ignored: "#9ca3af", property: "#dc2626" };

export const mapView = {
  init(el, h) {
    hooks = { ...hooks, ...h };
    map = L.map(el, { preferCanvas: true, zoomControl: false, attributionControl: true }).setView([24.83, 46.62], 12);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, crossOrigin: true, attribution: "&copy; OpenStreetMap" }).addTo(map);
    boundaryLayer = L.layerGroup().addTo(map);
    streetLayer = L.layerGroup().addTo(map);
    trailLayer = L.layerGroup().addTo(map);
    itemLayer = L.layerGroup().addTo(map);
    map.on("dragstart", () => { follow = false; });
    // long press (touch) or right click to add a property here
    // Leaflet turns a long press into contextmenu on iOS; Android and desktop fire it natively. Guard against doubles.
    let lastPress = 0;
    map.on("contextmenu", e => { const t = Date.now(); if (t - lastPress < 1200) return; lastPress = t; hooks.onLongPress(e.latlng); });
    return map;
  },
  invalidate() { if (map) setTimeout(() => map.invalidateSize(), 50); },

  setHood(name, streetsFC, boundaryFeature, exploredIds, fit = true) {
    hood = name; explored = new Set(exploredIds); streetLines.clear();
    streetLayer.clearLayers(); boundaryLayer.clearLayers();
    index = new StreetIndex(streetsFC.features);
    for (const f of streetsFC.features) {
      const id = String(f.properties.id);
      const latlngs = f.geometry.coordinates.map(c => [c[1], c[0]]);
      const major = /primary|secondary|trunk/.test(f.properties.hw || "");
      const line = L.polyline(latlngs, { color: explored.has(id) ? COLOR.done : (major ? COLOR.major : COLOR.todo), weight: explored.has(id) ? 4 : (major ? 3 : 2.5), opacity: 0.9, interactive: true });
      line.on("click", () => hooks.onStreetClick && hooks.onStreetClick(id, f.properties.name, explored.has(id)));
      streetLines.set(id, line); streetLayer.addLayer(line);
    }
    if (boundaryFeature) {
      const b = L.geoJSON(boundaryFeature, { style: { color: "#1d4ed8", weight: 2, fill: false, dashArray: "6 4" } });
      boundaryLayer.addLayer(b);
      if (fit) map.fitBounds(b.getBounds(), { padding: [10, 10] });
    }
    return mapView.coverage();
  },
  coverage() {
    if (!index) return { pct: 0, done: 0, total: 0 };
    const total = index.totalLength(), done = index.lengthOf([...explored]);
    return { pct: total ? Math.round(done / total * 1000) / 10 : 0, done, total, count: explored.size, streets: index.features.length };
  },
  paintExplored(ids, on = true) {
    for (const id of ids) {
      if (on) explored.add(String(id)); else explored.delete(String(id));
      const line = streetLines.get(String(id));
      if (line) line.setStyle({ color: on ? COLOR.done : COLOR.todo, weight: on ? 4 : 2.5 });
    }
  },

  setItems(items) {
    itemLayer.clearLayers();
    for (const it of items) {
      const d = it.data; if (!d || d.lat == null || d.lon == null) continue;
      const color = it.kind === "property" ? STATUS_COLOR.property : (STATUS_COLOR[d.status] || STATUS_COLOR.new);
      const m = L.circleMarker([d.lat, d.lon], { radius: it.kind === "property" ? 9 : 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 });
      m.bindTooltip(esc(d.title || d.ref || ""), { direction: "top", offset: [0, -6] });
      m.on("click", () => hooks.onItemClick(it.id));
      itemLayer.addLayer(m);
    }
  },
  focus(lat, lon, zoom = 17) { follow = false; map.setView([lat, lon], zoom); },
  center() { return map.getCenter(); },

  // ---- tracking ----
  tracking() { return watchId != null; },
  async startTracking() {
    if (watchId != null) return;
    follow = true;
    watchId = navigator.geolocation.watchPosition(onFix, err => hooks.onFix(null, err), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
    document.addEventListener("visibilitychange", relock);
  },
  stopTracking() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    document.removeEventListener("visibilitychange", relock);
  },
  followMe() { follow = true; if (meMarker) map.setView(meMarker.getLatLng(), Math.max(map.getZoom(), 16)); },
  /** draw / move the blue "me" marker and centre on it (used by the locate button, no tracking needed) */
  placeMe(lat, lon, acc, center = true) {
    if (!meMarker) {
      meMarker = L.circleMarker([lat, lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map);
      meCircle = L.circle([lat, lon], { radius: acc, color: "#2563eb", weight: 1, fillOpacity: 0.08 }).addTo(map);
    } else { meMarker.setLatLng([lat, lon]); meCircle.setLatLng([lat, lon]).setRadius(acc); }
    if (center) map.setView([lat, lon], Math.max(map.getZoom(), 17), { animate: true });
  },
  locateOnce() {
    return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }));
  },
};

async function relock() { if (!document.hidden && watchId != null && navigator.wakeLock) { try { wakeLock = await navigator.wakeLock.request("screen"); } catch {} } }

function onFix(pos) {
  const { latitude: lat, longitude: lon, accuracy: acc, speed } = pos.coords;
  mapView.placeMe(lat, lon, acc, false);
  if (follow) map.setView([lat, lon], Math.max(map.getZoom(), 16), { animate: true });
  trailLayer.addLayer(L.circleMarker([lat, lon], { radius: 2, stroke: false, fillColor: "#2563eb", fillOpacity: 0.5 }));
  if (trailLayer.getLayers().length > 600) trailLayer.removeLayer(trailLayer.getLayers()[0]);
  let newly = [];
  if (index && acc <= CONFIG.MAX_ACCURACY_METERS) {
    const hits = index.near([lon, lat], CONFIG.SNAP_METERS + Math.min(acc, 15) / 2);
    newly = hits.map(h => h.id).filter(id => !explored.has(id));
    if (newly.length) { mapView.paintExplored(newly, true); hooks.onExplored(newly, hood); }
  }
  hooks.onFix({ lat, lon, acc, speed, newly: newly.length }, null);
}
