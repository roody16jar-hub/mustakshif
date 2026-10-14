// Game-style vector map drawn on one canvas from the bundled street geometry (no tiles by default):
// glowing district borders, fog over unexplored segments that clears as you drive, explored
// streets that fade after FADE_DAYS, themed icons, city view with completion per district,
// optional OSM tiles. Tracking: high accuracy, smoothing, snap to the one nearest 25 m segment.
import { CONFIG } from "./config.js";
import { Smoother, dist } from "./geo.js";
import { segmentize, Coverage } from "./coverage.js";
import { mapPalette } from "./theme.js";
import { icon } from "./icons.js";
import { demoPath } from "./demo.js";

const L = window.L;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
let map, pal, tiles = null, attribution = null, districtsLayer, labelsLayer, itemLayer, trailLayer, meMarker, meCircle, streets;
let cov = null, ways = [], hood = null, pendingFit = null;
let hooks = {}, watchId = null, wakeLock = null, follow = true, smoother = null, demoTimer = null, demoPts = null, demoI = 0;
let session = null, items = [], districts = {}, districtIndex = {}, exploredCounts = {}, counters = {};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hasSize = () => map && map.getSize().x > 0 && map.getSize().y > 0;
const fadeMs = () => (CONFIG.FADE_DAYS || 60) * 86400000;

// ---- one canvas for all street segments (fast enough for 30k segments on a phone) ----
const StreetCanvas = L.Layer.extend({
  onAdd(m) { this._m = m; this._c = L.DomUtil.create("canvas", "street-canvas leaflet-zoom-hide"); m.getPane("overlayPane").appendChild(this._c); m.on("moveend zoomend resize viewreset", this.redraw, this); this.redraw(); },
  onRemove(m) { m.off("moveend zoomend resize viewreset", this.redraw, this); L.DomUtil.remove(this._c); },
  redraw() {
    const m = this._m, c = this._c; if (!m || !cov || !hasSize()) return;
    const size = m.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size.x * dpr; c.height = size.y * dpr; c.style.width = size.x + "px"; c.style.height = size.y + "px";
    L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
    const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size.x, size.y); ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (m.getZoom() < 12) return;                                    // city view: districts and labels only
    const b = m.getBounds().pad(0.05), now = Date.now(), fade = fadeMs();
    const groups = { minor: [], major: [], faded: [], explored: [] };
    for (const s of cov.index.segments) {
      if (!b.contains([s.a[1], s.a[0]]) && !b.contains([s.b[1], s.b[0]])) continue;
      const at = cov.explored.get(s.id);
      if (at) { const t = Date.parse(at || ""); groups[isFinite(t) && now - t > fade ? "faded" : "explored"].push(s); }
      else groups[/primary|secondary|trunk/.test(s.hw) ? "major" : "minor"].push(s);
    }
    const P = (lonlat) => m.latLngToContainerPoint([lonlat[1], lonlat[0]]);
    const stroke = (list, color, width, dash) => { if (!list.length) return; ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); for (const s of list) { const p = P(s.a), q = P(s.b); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); } ctx.stroke(); ctx.setLineDash([]); };
    const z = m.getZoom(); const w = z >= 16 ? 1 : 0.75;
    stroke(groups.minor, pal.unexplored, 2 * w, [2, 5]);
    stroke(groups.major, pal.major, 2.5 * w);
    stroke(groups.faded, pal.faded, 2.5 * w, [6, 6]);
    stroke(groups.explored, pal.exploredGlow, 9 * w);
    stroke(groups.explored, pal.explored, 3.5 * w);
  },
});

export const mapView = {
  init(el, h) {
    hooks = h; pal = mapPalette();
    map = L.map(el, { zoomControl: false, attributionControl: false, zoomSnap: 0.5, zoomAnimation: !REDUCED, fadeAnimation: !REDUCED, markerZoomAnimation: !REDUCED, inertia: !REDUCED }).setView([24.80, 46.64], 11.5);
    el.style.background = pal.bg;
    districtsLayer = L.layerGroup().addTo(map); labelsLayer = L.layerGroup().addTo(map);
    streets = new StreetCanvas().addTo(map); trailLayer = L.layerGroup().addTo(map); itemLayer = L.layerGroup().addTo(map);
    map.on("dragstart", () => { follow = false; });
    let lastPress = 0;
    map.on("contextmenu", e => { const t = Date.now(); if (t - lastPress < 1200) return; lastPress = t; hooks.onLongPress && hooks.onLongPress(e.latlng); });
    map.on("click", e => {
      if (!cov || map.getZoom() < 12 || mapView.tracking()) return;
      const mpp = 40075016.686 * Math.cos(e.latlng.lat * Math.PI / 180) / Math.pow(2, map.getZoom() + 8);   // metres per pixel
      const seg = cov.index.snap([e.latlng.lng, e.latlng.lat], mpp * 14);
      if (seg && hooks.onStreetTap) hooks.onStreetTap({ way: seg.way, name: seg.name, explored: cov.waySegments(seg.way).some(id => cov.isExplored(id)), lastDriven: cov.lastDriven(seg.way), segments: cov.waySegments(seg.way) });
    });
    map.on("zoomend", () => cityView());
    window.addEventListener("themechange", () => mapView.restyle());
    if (matchMedia("(min-width: 720px)").matches) L.control.zoom({ position: "bottomleft" }).addTo(map);
    return map;
  },
  invalidate() { if (!map) return; setTimeout(() => { map.invalidateSize(); if (pendingFit && hasSize()) { const b = pendingFit; pendingFit = null; map.fitBounds(b, { padding: [12, 12], animate: false }); } streets.redraw(); }, 60); },
  setOsm(on) {
    if (on && !tiles) { tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, crossOrigin: true, opacity: 0.85 }).addTo(map); tiles.bringToBack(); attribution = L.control.attribution({ prefix: false }).addAttribution("© OpenStreetMap").addTo(map); }
    if (!on && tiles) { map.removeLayer(tiles); tiles = null; if (attribution) { map.removeControl(attribution); attribution = null; } }
    map.getContainer().classList.toggle("osm", !!on);
  },
  setDistricts(bounds, idx, counts, extra) { districts = bounds; districtIndex = idx || {}; exploredCounts = counts || {}; counters = extra || {}; drawDistricts(); },
  setExploredCounts(counts, extra) { exploredCounts = counts || {}; if (extra) counters = extra; drawLabels(); },

  /** exploredRows: [{id: segmentId, explored_at}] */
  setHood(name, streetsFC, exploredRows, fit = true) {
    hood = name; ways = streetsFC.features;
    cov = new Coverage(segmentize(ways), exploredRows);
    drawDistricts();
    if (fit && districts[name]) { const b = L.geoJSON(districts[name]).getBounds(); if (hasSize()) map.fitBounds(b, { padding: [12, 12], animate: false }); else pendingFit = b; }
    cityView(); streets.redraw();
    return mapView.coverage();
  },
  coverage() { return cov ? cov.stats(new Date(), CONFIG.FADE_DAYS || 60) : { pct: 0, done: 0, total: 0, segments: 0, streets: 0, allStreets: 0, faded: 0 }; },
  paintExplored(ids, on = true, at = new Date().toISOString()) { if (!cov) return; if (on) cov.mark(ids, at); else cov.unmark(ids); streets.redraw(); },
  waySegments(way) { return cov ? cov.waySegments(way) : []; },
  restyle() { if (!map) return; pal = mapPalette(); map.getContainer().style.background = pal.bg; streets.redraw(); drawDistricts(); mapView.setItems(items); if (meCircle) meCircle.setStyle({ color: pal.me, fillColor: pal.me }); },

  setItems(list) {
    items = list; itemLayer.clearLayers();
    for (const it of list) {
      const d = it.data; if (!d || d.lat == null || d.lon == null) continue;
      const kind = it.kind === "property" ? "home" : it.kind === "sign" ? "sign" : it.kind === "contractor" ? "building" : "target";
      const cls = it.kind === "property" ? "property" : it.kind === "sign" ? "sign" : it.kind === "contractor" ? "contractor" : (d.status === "visited" ? "visited" : d.status === "ignored" ? "ignored" : (d.score || 0) >= 80 ? "target hi" : "target");
      const m = L.marker([d.lat, d.lon], { icon: L.divIcon({ className: `pin pin-${cls}${d.my_type ? " my" : ""}`, html: icon(kind), iconSize: [32, 32], iconAnchor: [16, 16] }), keyboard: false });
      m.bindTooltip(esc(d.code ? d.code + " · " + (d.title || "") : (d.title || d.ref || d.name || "")), { direction: "top", offset: [0, -14] });
      m.on("click", () => hooks.onItemClick && hooks.onItemClick(it.id));
      itemLayer.addLayer(m);
    }
  },
  focus(lat, lon, zoom = 17) { follow = false; pendingFit = null; if (hasSize()) map.setView([lat, lon], zoom, { animate: false }); else setTimeout(() => map.setView([lat, lon], zoom, { animate: false }), 120); },
  center() { return map.getCenter(); },
  zoom() { return map.getZoom(); },

  // ---- position ----
  placeMe(lat, lon, acc, { center = true, heading = null } = {}) {
    if (!hasSize()) return;
    if (!meMarker) {
      meCircle = L.circle([lat, lon], { radius: acc || 10, color: pal.me, weight: 1, fillColor: pal.me, fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker([lat, lon], { icon: L.divIcon({ className: "me", html: icon("nav"), iconSize: [28, 28], iconAnchor: [14, 14] }), keyboard: false, zIndexOffset: 1000 }).addTo(map);
    } else { meMarker.setLatLng([lat, lon]); meCircle.setLatLng([lat, lon]).setRadius(acc || 10); }
    const el = meMarker.getElement(); if (el) { el.style.setProperty("--heading", (heading ?? 0) + "deg"); el.classList.toggle("has-heading", heading != null); }
    if (center) map.setView([lat, lon], Math.max(map.getZoom(), 17), { animate: !REDUCED });
  },
  locateOnce() { return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 })); },
  followMe() { follow = true; if (meMarker) map.setView(meMarker.getLatLng(), Math.max(map.getZoom(), 16)); },

  // ---- tracking: start / pause / resume / stop ----
  tracking() { return !!session; },
  paused() { return !!(session && session.pausedAt); },
  isDemo() { return !!(session && session.demo); },
  session() { return session; },
  async startTracking({ demo = false } = {}) {
    if (session) return;
    follow = true; smoother = new Smoother({ maxAcc: CONFIG.MAX_ACCURACY_METERS, maxSpeed: 60 });
    session = { hood, started: Date.now(), activeMs: 0, lastResume: Date.now(), pausedAt: null, km: 0, streets_new: 0, segments_new: 0, targets_near: 0, properties_added: 0, signs_added: 0, phones_added: 0, fixes: 0, rejected: 0, last: null, nearSeen: new Set(), demo };
    if (cov) cov.last = null;
    startWatch(demo);
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
    document.addEventListener("visibilitychange", relock);
  },
  pauseTracking() { if (!session || session.pausedAt) return; session.pausedAt = Date.now(); session.activeMs += Date.now() - session.lastResume; stopWatch(); },
  resumeTracking() { if (!session || !session.pausedAt) return; session.pausedAt = null; session.lastResume = Date.now(); if (cov) cov.last = null; startWatch(session.demo); },
  stopTracking() {
    stopWatch(); if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } document.removeEventListener("visibilitychange", relock);
    const s = session; session = null; if (!s) return null;
    const active = s.activeMs + (s.pausedAt ? 0 : Date.now() - s.lastResume);
    return { hood: s.hood, started: new Date(s.started).toISOString(), ended: new Date().toISOString(), duration_s: Math.round(active / 1000), km: Math.round(s.km / 100) / 10, streets_new: s.streets_new, segments_new: s.segments_new, targets_near: s.targets_near, properties_added: s.properties_added, signs_added: s.signs_added, phones_added: s.phones_added, fixes: s.fixes, rejected: s.rejected, demo: s.demo };
  },
  elapsedS() { if (!session) return 0; return Math.round((session.activeMs + (session.pausedAt ? 0 : Date.now() - session.lastResume)) / 1000); },
  countInSession(key) { if (session) session[key] = (session[key] || 0) + 1; },
};

function startWatch(demo) {
  if (demo) {
    if (!demoPts) { demoPts = demoPath({ features: ways }, 500); demoI = 0; }
    demoTimer = setInterval(() => { if (!demoPts.length) return; if (demoI >= demoPts.length) demoI = 0; const [lon, lat] = demoPts[demoI++]; const n = () => (Math.random() - 0.5) * 0.00006; onFix({ coords: { latitude: lat + n(), longitude: lon + n(), accuracy: 6 + Math.random() * 6, speed: 8, heading: null }, timestamp: Date.now() }); }, 600);
  } else watchId = navigator.geolocation.watchPosition(onFix, err => hooks.onFix && hooks.onFix(null, err), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; clearInterval(demoTimer); demoTimer = null; demoPts = null; }
async function relock() { if (!document.hidden && session && !session.pausedAt && navigator.wakeLock) { try { wakeLock = await navigator.wakeLock.request("screen"); hooks.onRelock && hooks.onRelock(); } catch {} } }

function drawDistricts() {
  if (!districtsLayer) return; districtsLayer.clearLayers();
  for (const [h, f] of Object.entries(districts)) {
    const cur = h === hood; const ll = f.geometry.coordinates[0].map(c => [c[1], c[0]]);
    districtsLayer.addLayer(L.polyline([...ll, ll[0]], { color: cur ? pal.borderGlow : pal.otherGlow || "transparent", weight: cur ? 14 : 8, opacity: 1, interactive: false }));
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
    const pct = info.length_m ? Math.min(100, Math.round((exploredCounts[h] || 0) / info.length_m * 100)) : 0;
    const name = (hooks.hoodName && hooks.hoodName(h)) || h; const c = counters[h] || {};
    const m = L.marker(info.center, { icon: L.divIcon({ className: "district-label" + (h === hood ? " cur" : "") + (c.completed ? " done" : ""), html: `<b>${esc(name)}</b><span>${pct}%</span><small>${c.targets || 0} هدف · ${c.properties || 0} عقار${c.completed ? " · مكتمل" : ""}</small>`, iconSize: [120, 56], iconAnchor: [60, 28] }), interactive: true, keyboard: false });
    m.on("click", () => hooks.onDistrictClick && hooks.onDistrictClick(h));
    labelsLayer.addLayer(m);
  }
  cityView();
}
function cityView() {
  if (!map) return; const city = map.getZoom() < 12;
  map.getContainer().classList.toggle("city", city);
  if (city) { if (!map.hasLayer(labelsLayer)) map.addLayer(labelsLayer); } else if (map.hasLayer(labelsLayer)) map.removeLayer(labelsLayer);
}
let redrawT = null;
function onFix(pos) {
  const { latitude, longitude, accuracy, speed, heading } = pos.coords;
  const sm = smoother.push({ lat: latitude, lon: longitude, acc: accuracy, t: pos.timestamp || Date.now() });
  if (session) session.fixes++;
  if (!sm) { if (session) session.rejected++; hooks.onFix && hooks.onFix({ lat: latitude, lon: longitude, acc: accuracy, speed, rejected: true, snapped: null, newly: [] }, null); return; }
  mapView.placeMe(sm.lat, sm.lon, sm.acc, { center: follow, heading: heading != null && heading >= 0 ? heading : null });
  if (hasSize()) { trailLayer.addLayer(L.circleMarker([sm.lat, sm.lon], { radius: 2, stroke: false, fillColor: pal.me, fillOpacity: 0.6, interactive: false })); if (trailLayer.getLayers().length > 800) trailLayer.removeLayer(trailLayer.getLayers()[0]); }
  let newly = [], snapped = null;
  if (session) {
    if (session.last) session.km += dist([session.last.lon, session.last.lat], [sm.lon, sm.lat]);
    session.last = sm;
    for (const it of items) { if (it.kind !== "target" || it.data.lat == null || session.nearSeen.has(it.id)) continue; if (dist([it.data.lon, it.data.lat], [sm.lon, sm.lat]) <= 40) { session.nearSeen.add(it.id); session.targets_near++; } }
  }
  if (cov) {
    const r = cov.fix([sm.lon, sm.lat], CONFIG.SNAP_METERS); snapped = r.seg; newly = r.newly;
    if (newly.length) {
      if (session) { const others = cov.waySegments(snapped.way).filter(id => !newly.includes(id)); if (!others.some(id => cov.isExplored(id))) session.streets_new++; session.segments_new += newly.length; }
      hooks.onExplored && hooks.onExplored(newly, hood);
      clearTimeout(redrawT); redrawT = setTimeout(() => streets.redraw(), 150);
    }
  }
  hooks.onFix && hooks.onFix({ lat: sm.lat, lon: sm.lon, acc: sm.acc, speed, snapped, newly, rejected: false }, null);
}
