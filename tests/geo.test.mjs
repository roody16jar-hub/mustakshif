import { test } from "node:test";
import assert from "node:assert/strict";
import { dist, distToSegment, lineLength, StreetIndex, newer, mergeRows } from "../js/geo.js";

const A = [46.6500, 24.8500], B = [46.6510, 24.8500]; // ~101 m apart on the same latitude

test("dist: 0.001 deg of longitude at 24.85N is about 101 m", () => {
  const d = dist(A, B); assert.ok(d > 99 && d < 103, d);
});
test("distToSegment: point beside the middle of a segment", () => {
  const p = [46.6505, 24.8501]; // 0.0001 deg north = ~11 m
  const d = distToSegment(p, A, B); assert.ok(d > 10 && d < 12, d);
});
test("distToSegment: point beyond the end clamps to the endpoint", () => {
  const p = [46.6520, 24.8500]; const d = distToSegment(p, A, B); assert.ok(d > 99 && d < 103, d);
});
test("lineLength sums segments", () => {
  assert.ok(Math.abs(lineLength([A, B, [46.6520, 24.8500]]) - 2 * dist(A, B)) < 0.01);
});

const streets = {
  type: "FeatureCollection", features: [
    { type: "Feature", properties: { id: 1, hw: "residential" }, geometry: { type: "LineString", coordinates: [[46.6500, 24.8500], [46.6520, 24.8500]] } },
    { type: "Feature", properties: { id: 2, hw: "residential" }, geometry: { type: "LineString", coordinates: [[46.6500, 24.8520], [46.6520, 24.8520]] } },
    { type: "Feature", properties: { id: 3, hw: "primary" }, geometry: { type: "LineString", coordinates: [[46.7000, 24.9000], [46.7100, 24.9000]] } },
  ],
};
test("StreetIndex.near finds only the street within 20 m", () => {
  const idx = new StreetIndex(streets.features);
  const hits = idx.near([46.6510, 24.85005], 20);
  assert.deepEqual(hits.map(h => h.id), ["1"]);
  assert.equal(idx.near([46.6510, 24.8510], 20).length, 0);
  assert.equal(idx.near([46.6510, 24.8510], 120).length, 2);
});
test("StreetIndex coverage lengths", () => {
  const idx = new StreetIndex(streets.features);
  const total = idx.totalLength(); const one = idx.lengthOf(["1"]);
  assert.ok(total > one && one > 190 && one < 215, `${total} ${one}`);
});
test("newer picks the later updated_at", () => {
  const a = { id: 1, updated_at: "2026-10-13T10:00:00.000Z" }, b = { id: 1, updated_at: "2026-10-13T11:00:00.000Z" };
  assert.equal(newer(a, b), b); assert.equal(newer(b, a), b); assert.equal(newer(null, a), a); assert.equal(newer(a, null), a);
});
test("mergeRows keeps newer incoming rows only", () => {
  const local = [{ id: "x", updated_at: "2026-01-02T00:00:00Z", v: 1 }, { id: "y", updated_at: "2026-01-05T00:00:00Z", v: 1 }];
  const inc = [{ id: "x", updated_at: "2026-01-03T00:00:00Z", v: 2 }, { id: "y", updated_at: "2026-01-04T00:00:00Z", v: 2 }, { id: "z", updated_at: "2026-01-01T00:00:00Z", v: 2 }, null];
  const out = mergeRows(local, inc);
  assert.deepEqual(out.map(r => r.id).sort(), ["x", "z"]);
});
