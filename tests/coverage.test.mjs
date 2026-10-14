import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentize, SegmentIndex, Coverage, SEGMENT_M } from "../js/coverage.js";
import { Smoother, dist } from "../js/geo.js";

// Two straight east-west streets at 24.85N: A is 100 m, B is 300 m and 30 m to the north (parallel).
const LON_M = 0.001 / dist([46.65, 24.85], [46.651, 24.85]);   // degrees of longitude per metre at this latitude
const street = (id, lat, lenM, name) => ({ type: "Feature", properties: { id, name, hw: "residential" }, geometry: { type: "LineString", coordinates: [[46.65, lat], [46.65 + lenM * LON_M, lat]] } });
const A = street(1, 24.8500, 100, "شارع أ"), B = street(2, 24.85027, 300, "شارع ب");

test("segmentize cuts streets into ~25 m pieces with deterministic ids", () => {
  const segs = segmentize([A, B]);
  assert.equal(segs.filter(s => s.way === "1").length, 4);
  assert.equal(segs.filter(s => s.way === "2").length, 12);
  assert.deepEqual(segs.slice(0, 2).map(s => s.id), ["1:0", "1:1"]);
  const total = segs.reduce((m, s) => m + s.len, 0); assert.ok(Math.abs(total - 400) < 1, total);
  assert.ok(segs.every(s => s.len <= SEGMENT_M + 0.01));
});

test("simulated drive along street A gives exactly 25% and never touches the parallel street", () => {
  const cov = new Coverage(segmentize([A, B]));
  const sm = new Smoother({ maxAcc: 25 });
  const fixes = []; for (let m = 0; m <= 100; m += 10) fixes.push({ lat: 24.8500 + (m % 20 ? 0.00004 : -0.00004), lon: 46.65 + m * LON_M, acc: 7, t: 1000 + m * 100 }); // 4 m of jitter
  let newly = 0;
  for (const f of fixes) { const s = sm.push(f); if (!s) continue; newly += cov.fix([s.lon, s.lat]).newly.length; }
  assert.equal(cov.percent(), 25);
  assert.equal(newly, 4);
  assert.ok([...cov.explored.keys()].every(id => id.startsWith("1:")), "parallel street B must stay unexplored");
});

test("gaps between two fixes on the same street are filled; a jump to another street is not", () => {
  const cov = new Coverage(segmentize([A, B]));
  cov.fix([46.65 + 5 * LON_M, 24.85027]);                     // B seg 0
  const r = cov.fix([46.65 + 95 * LON_M, 24.85027]);            // B seg 3: fills 1 and 2
  assert.deepEqual(r.newly.sort(), ["2:1", "2:2", "2:3"]);
  const r2 = cov.fix([46.65 + 5 * LON_M, 24.8500]);              // A seg 0: different street, no fill
  assert.deepEqual(r2.newly, ["1:0"]);
  assert.ok(Math.abs(cov.percent() - 31.25) < 0.2, cov.percent());   // 4*25 + 25 = 125 of 400
});

test("fixes farther than 20 m from any street mark nothing", () => {
  const cov = new Coverage(segmentize([A, B]));
  assert.equal(cov.fix([46.65 + 50 * LON_M, 24.85027 + 0.0005]).seg, null);   // ~55 m north of B, ~85 m north of A
  assert.equal(cov.percent(), 0);
});

test("stats: streets, segments, faded after 60 days, last driven per street", () => {
  const cov = new Coverage(segmentize([A, B]), [{ id: "1:0", explored_at: "2026-07-01T00:00:00Z" }, { id: "1:1", explored_at: "2026-10-10T00:00:00Z" }]);
  const s = cov.stats(new Date("2026-10-13T00:00:00Z"));
  assert.equal(s.segments, 2); assert.equal(s.streets, 1); assert.equal(s.allStreets, 2); assert.equal(s.faded, 1); assert.equal(s.pct, 12.5);
  assert.equal(cov.lastDriven("1"), "2026-10-10T00:00:00Z"); assert.equal(cov.lastDriven("2"), null);
  cov.unmark(["1:0"]); assert.equal(cov.stats().segments, 1);
});

test("SegmentIndex.snap picks the nearest segment only", () => {
  const idx = new SegmentIndex(segmentize([A, B]));
  const s = idx.snap([46.65 + 60 * LON_M, 24.85005], 20);   // 5.5 m from A at 60 m along -> seg 2
  assert.equal(s.id, "1:2");
  assert.equal(idx.snap([46.65 + 60 * LON_M, 24.8502], 20).way, "2");   // 22 m from A, 8 m from B
});
