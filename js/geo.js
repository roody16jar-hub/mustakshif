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
    this.lengths = new Map();
    features.forEach((f, i) => {
      const c = f.geometry.coordinates;
      this.lengths.set(String(f.properties.id), lineLength(c));
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
      if (best <= maxM) hits.push({ id: String(this.features[i].properties.id), d: best });
    }
    return hits.sort((a, b) => a.d - b.d);
  }
  totalLength() { let s = 0; for (const v of this.lengths.values()) s += v; return s; }
  lengthOf(ids) { let s = 0; for (const id of ids) s += this.lengths.get(String(id)) || 0; return s; }
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
