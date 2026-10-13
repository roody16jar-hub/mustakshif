// Pure geometry helpers (no DOM). Unit-tested in tests/geo.test.mjs.
const R = 6371000;
const rad = (d) => d * Math.PI / 180;

/** metres between two [lon, lat] points (equirectangular, fine for a city) */
export function dist(a, b) {
  const x = rad(b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  const y = rad(b[1] - a[1]);
  return Math.sqrt(x * x + y * y) * R;
}

/** metres from point p to segment a-b, all [lon, lat] */
export function distToSegment(p, a, b) {
  const cosLat = Math.cos(rad(p[1]));
  const ax = rad(a[0]) * cosLat, ay = rad(a[1]);
  const bx = rad(b[0]) * cosLat, by = rad(b[1]);
  const px = rad(p[0]) * cosLat, py = rad(p[1]);
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) * R;
}

export function lineLength(coords) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) m += dist(coords[i - 1], coords[i]);
  return m;
}

/** Grid index over LineString features so a GPS fix only checks nearby streets. */
export class StreetIndex {
  constructor(features, cell = 0.002) {
    this.cell = cell; this.grid = new Map(); this.features = features;
    this.lengths = new Map(); this.byId = new Map();
    features.forEach((f, i) => {
      const c = f.geometry.coordinates;
      this.lengths.set(String(f.properties.id), lineLength(c));
      this.byId.set(String(f.properties.id), f);
      const seen = new Set();
      for (let k = 1; k < c.length; k++) {
        const minx = Math.min(c[k - 1][0], c[k][0]), maxx = Math.max(c[k - 1][0], c[k][0]);
        const miny = Math.min(c[k - 1][1], c[k][1]), maxy = Math.max(c[k - 1][1], c[k][1]);
        for (let gx = Math.floor(minx / cell); gx <= Math.floor(maxx / cell); gx++)
          for (let gy = Math.floor(miny / cell); gy <= Math.floor(maxy / cell); gy++) {
            const key = gx + ":" + gy;
            if (seen.has(key)) continue; seen.add(key);
            if (!this.grid.has(key)) this.grid.set(key, []);
            this.grid.get(key).push(i);
          }
      }
    });
  }
  /** streets within maxM metres of [lon, lat], nearest first */
  near(p, maxM) {
    const gx = Math.floor(p[0] / this.cell), gy = Math.floor(p[1] / this.cell);
    const cand = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = this.grid.get((gx + dx) + ":" + (gy + dy)); if (arr) arr.forEach(i => cand.add(i));
    }
    const hits = [];
    for (const i of cand) {
      const c = this.features[i].geometry.coordinates;
      let best = Infinity;
      for (let k = 1; k < c.length; k++) { const d = distToSegment(p, c[k - 1], c[k]); if (d < best) best = d; }
      if (best <= maxM) hits.push({ id: String(this.features[i].properties.id), d: best, name: this.features[i].properties.name });
    }
    return hits.sort((a, b) => a.d - b.d);
  }
  /** the ONE nearest street within maxM, or null. A parallel street is never returned. */
  snap(p, maxM = 20) { const h = this.near(p, maxM); return h.length ? h[0] : null; }
  totalLength() { let s = 0; for (const v of this.lengths.values()) s += v; return s; }
  lengthOf(ids) { let s = 0; for (const id of ids) s += this.lengths.get(String(id)) || 0; return s; }
}

/**
 * GPS smoothing for the tracker: drops fixes worse than maxAcc, rejects impossible jumps
 * (faster than maxSpeed m/s since the last accepted fix) and returns a small moving average
 * weighted by accuracy. push() returns the smoothed fix or null when the fix was rejected.
 */
export class Smoother {
  constructor({ window = 3, maxAcc = 25, maxSpeed = 60 } = {}) { this.window = window; this.maxAcc = maxAcc; this.maxSpeed = maxSpeed; this.buf = []; this.rejected = 0; }
  push(fix) {
    const { lat, lon, acc, t = Date.now() } = fix;
    if (!(acc <= this.maxAcc)) { this.rejected++; return null; }
    const last = this.buf[this.buf.length - 1];
    if (last) {
      const dtS = Math.max(0.5, (t - last.t) / 1000);
      if (dist([last.lon, last.lat], [lon, lat]) / dtS > this.maxSpeed) { this.rejected++; return null; }
    }
    this.buf.push({ lat, lon, acc, t });
    if (this.buf.length > this.window) this.buf.shift();
    let wsum = 0, la = 0, lo = 0, best = Infinity;
    for (const f of this.buf) { const w = 1 / Math.max(1, f.acc); wsum += w; la += f.lat * w; lo += f.lon * w; if (f.acc < best) best = f.acc; }
    return { lat: la / wsum, lon: lo / wsum, acc: best, raw: { lat, lon, acc }, t };
  }
  reset() { this.buf = []; }
}

/** Last-write-wins merge of two rows that share an id. Returns the winner. */
export function newer(a, b) {
  if (!a) return b; if (!b) return a;
  return (b.updated_at || "") > (a.updated_at || "") ? b : a;
}

/** Merge an imported backup into local rows: keep the newer of each id. */
export function mergeRows(local, incoming) {
  const map = new Map(local.map(r => [r.id, r]));
  const out = [];
  for (const r of incoming) {
    if (!r || !r.id) continue;
    const cur = map.get(r.id);
    if (!cur || newer(cur, r) === r) { out.push(r); map.set(r.id, r); }
  }
  return out;
}

/** Sunrise / sunset (local Date objects) for a date and place. NOAA approximation, ±2 min. */
export function sunTimes(date, lat, lon) {
  const d0 = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const n = Math.floor((d0 - Date.UTC(2000, 0, 1, 12)) / 86400000) + 0.5;
  const g = rad((357.529 + 0.98560028 * n) % 360);
  const q = (280.459 + 0.98564736 * n) % 360;
  const L = rad((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360);
  const e = rad(23.439 - 0.00000036 * n);
  const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * 180 / Math.PI / 15;
  const decl = Math.asin(Math.sin(e) * Math.sin(L));
  const eqt = (q / 15 - ((RA % 24) + 24) % 24); let eq = eqt; while (eq > 12) eq -= 24; while (eq < -12) eq += 24;
  const cosH = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl));
  if (cosH > 1) return { sunrise: new Date(d0.getTime() + 86400000), sunset: d0 };     // polar night
  if (cosH < -1) return { sunrise: d0, sunset: new Date(d0.getTime() + 86400000) };    // midnight sun
  const H = Math.acos(cosH) * 180 / Math.PI / 15;
  const noonUTC = 12 - lon / 15 - eq;      // hours
  const toDate = (h) => new Date(d0.getTime() + h * 3600000);
  return { sunrise: toDate(noonUTC - H), sunset: toDate(noonUTC + H) };
}
