// Demo drive for testing on a PC without GPS: walks along connected streets of the loaded
// district and returns a list of [lon, lat] points about 12 m apart.
import { dist } from "./geo.js";

export function demoPath(index, points = 400, seed = Date.now()) {
  if (!index || !index.features.length) return [];
  let s = seed % 2147483647 || 1; const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  const key = (c) => c[0].toFixed(5) + "," + c[1].toFixed(5);
  const adj = new Map();   // endpoint -> features touching it
  for (const f of index.features) { const c = f.geometry.coordinates; for (const p of [c[0], c[c.length - 1]]) { const k = key(p); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(f); } }
  let f = index.features[Math.floor(rnd() * index.features.length)];
  let forward = true; const out = []; const used = new Set();
  while (out.length < points) {
    const c = forward ? f.geometry.coordinates : [...f.geometry.coordinates].reverse();
    for (let i = 1; i < c.length && out.length < points; i++) {
      const n = Math.max(1, Math.round(dist(c[i - 1], c[i]) / 12));
      for (let k = 1; k <= n; k++) out.push([c[i - 1][0] + (c[i][0] - c[i - 1][0]) * k / n, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * k / n]);
    }
    used.add(f);
    const end = c[c.length - 1]; const next = (adj.get(key(end)) || []).filter(x => x !== f && !used.has(x));
    if (!next.length) { f = index.features[Math.floor(rnd() * index.features.length)]; forward = true; continue; }
    f = next[Math.floor(rnd() * next.length)];
    forward = key(f.geometry.coordinates[0]) === key(end);
  }
  return out;
}
