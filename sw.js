// Service worker: offline app shell + street data + libraries/fonts, opportunistic map tiles.
// Supabase requests are never intercepted. Bump VERSION on every deploy.
const VERSION = "v0.3.0";
const DATA_VERSION = "2026-10-13";
const SHELL = `shell-${VERSION}`, DATA = `data-${DATA_VERSION}`, LIB = "lib-v2", TILES = "tiles-v1";
const PRECACHE = ["./", "index.html", "css/tokens.css", "css/app.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "js/app.js", "js/auth.js", "js/config.js", "js/ctx.js", "js/db.js", "js/demo.js", "js/domain.js", "js/excel.js", "js/forms.js", "js/geo.js", "js/icons.js", "js/map.js", "js/screens.js", "js/store.js", "js/sync.js", "js/theme.js", "js/ui.js",
  "data/hoods.json", "data/streets/index.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith("shell-") && k !== SHELL) || (k.startsWith("data-") && k !== DATA) || (k.startsWith("lib-") && k !== LIB)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in")) return;

  if (url.origin === location.origin) {
    if (url.pathname.includes("/data/streets/") || url.pathname.includes("/data/boundaries/")) { e.respondWith(cacheFirst(DATA, e.request)); return; }
    e.respondWith(shellFirst(e.request)); return;
  }
  if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname)) { e.respondWith(cacheFirst(LIB, e.request)); return; }
  if (/tile\.openstreetmap\.org/.test(url.hostname)) { e.respondWith(tiles(e.request)); return; }
});

async function shellFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
  catch { return (await cache.match("index.html")) || Response.error(); }
}
async function cacheFirst(name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
let tileCount = null;
async function tiles(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      cache.put(req, res.clone());
      if (tileCount == null) tileCount = (await cache.keys()).length;
      if (++tileCount > 3000) { const keys = await cache.keys(); for (const k of keys.slice(0, 500)) await cache.delete(k); tileCount -= 500; }
    }
    return res;
  } catch { return new Response("", { status: 404 }); }
}
