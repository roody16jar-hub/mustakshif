// Pure coverage module (no DOM): streets are cut into ~25 m segments at load time, a GPS fix
// snaps to the ONE nearest segment within SNAP m, gaps between consecutive fixes on the same
// street are filled, and percent = explored length / total length. Unit-tested in tests/coverage.test.mjs.
import { dist, distToSegment } from "./geo.js";

export const SEGMENT_M = 25;

/** Cut LineString features into segments of about `maxM` metres. Deterministic ids `${wayId}:${seq}`. */
export function segmentize(features, maxM = SEGMENT_M) {
  const out = [];
  for (const f of features) {
    const c = f.geometry.coordinates; const way = String(f.properties.id); let seq = 0;
    for (let i = 1; i < c.length; i++) {
      const L = dist(c[i - 1], c[i]); if (L === 0) continue;
      const n = Math.max(1, Math.ceil(L / maxM));
      for (let k = 0; k < n; k++) {
        const a = [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * k / n, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * k / n];
        const b = [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * (k + 1) / n, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * (k + 1) / n];
        out.push({ id: `${way}:${seq}`, way, seq, a, b, len: L / n, name: f.properties.name, hw: f.properties.hw || "" });
        seq++;
      }
    }
  }
  return out;
}

/** Grid index over segments. */
export class SegmentIndex {
  constructor(segments, cell = 0.002) {
    this.cell = cell; this.grid = new Map(); this.segments = segments; this.byId = new Map(); this.byWay = new Map();
    segments.forEach((s, i) => {
      this.byId.set(s.id, s);
      if (!this.byWay.has(s.way)) this.byWay.set(s.way, []); this.byWay.get(s.way).push(s);
      const minx = Math.min(s.a[0], s.b[0]), maxx = Math.max(s.a[0], s.b[0]), miny = Math.min(s.a[1], s.b[1]), maxy = Math.max(s.a[1], s.b[1]);
      for (let gx = Math.floor(minx / cell); gx <= Math.floor(maxx / cell); gx++)
        for (let gy = Math.floor(miny / cell); gy <= Math.floor(maxy / cell); gy++) { const k = gx + ":" + gy; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(i); }
    });
  }
  near(p, maxM) {
    const gx = Math.floor(p[0] / this.cell), gy = Math.floor(p[1] / this.cell); const cand = new Set(); const hits = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = this.grid.get((gx + dx) + ":" + (gy + dy)); if (arr) arr.forEach(i => cand.add(i)); }
    for (const i of cand) { const s = this.segments[i]; const d = distToSegment(p, s.a, s.b); if (d <= maxM) hits.push({ seg: s, d }); }
    return hits.sort((x, y) => x.d - y.d);
  }
  /** nearest segment within maxM or null; a parallel street further away is never returned */
  snap(p, maxM = 20) { const h = this.near(p, maxM); return h.length ? h[0].seg : null; }
}

/** Explored-state bookkeeping and percentages. ids are segment ids. */
export class Coverage {
  constructor(segments, explored = []) {
    this.index = segments instanceof SegmentIndex ? segments : new SegmentIndex(segments);
    this.total = 0; for (const s of this.index.segments) this.total += s.len;
    this.explored = new Map(); for (const r of explored) if (this.index.byId.has(r.id)) this.explored.set(r.id, r.explored_at || r.at || null);
    this.last = null;   // last snapped segment (for gap filling)
  }
  isExplored(id) { return this.explored.has(id); }
  mark(ids, at = new Date().toISOString()) { const newly = []; for (const id of ids) if (this.index.byId.has(id) && !this.explored.has(id)) { this.explored.set(id, at); newly.push(id); } return newly; }
  unmark(ids) { for (const id of ids) this.explored.delete(id); }
  /** all segment ids of a way, or of the way containing a segment id */
  wayOf(id) { const s = this.index.byId.get(id); return s ? s.way : null; }
  waySegments(way) { return (this.index.byWay.get(way) || []).map(s => s.id); }
  /** feed a (smoothed) fix; returns { seg, newly[] }. Fills the gap to the previous fix on the same street. */
  fix(p, snapM = 20, at = new Date().toISOString()) {
    const seg = this.index.snap(p, snapM);
    if (!seg) { this.last = null; return { seg: null, newly: [] }; }
    let ids = [seg.id];
    if (this.last && this.last.way === seg.way && this.last.seq !== seg.seq) {
      const lo = Math.min(this.last.seq, seg.seq), hi = Math.max(this.last.seq, seg.seq);
      for (const s of this.index.byWay.get(seg.way)) if (s.seq > lo && s.seq < hi) ids.push(s.id);
    }
    this.last = seg;
    return { seg, newly: this.mark(ids, at) };
  }
  exploredLength() { let m = 0; for (const id of this.explored.keys()) m += this.index.byId.get(id).len; return m; }
  percent() { return this.total ? Math.round(this.exploredLength() / this.total * 1000) / 10 : 0; }
  stats(now = new Date(), fadeDays = 60) {
    let faded = 0; for (const at of this.explored.values()) { const t = Date.parse(at || ""); if (isFinite(t) && now - t > fadeDays * 86400000) faded++; }
    const ways = new Set(); for (const id of this.explored.keys()) ways.add(this.index.byId.get(id).way);
    return { pct: this.percent(), done: this.exploredLength(), total: this.total, segments: this.explored.size, streets: ways.size, allStreets: this.index.byWay.size, faded };
  }
  /** last driven date for a way (latest of its segments) */
  lastDriven(way) { let best = null; for (const s of this.index.byWay.get(way) || []) { const at = this.explored.get(s.id); if (at && (!best || at > best)) best = at; } return best; }
}
