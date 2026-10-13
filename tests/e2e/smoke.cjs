// Run: python tools/serve.py (port 8765) then: NODE_PATH=<a folder with playwright installed>/node_modules node tests/e2e/smoke.cjs
// Needs Playwright + Chromium. Mocks Supabase entirely; screenshots go to tests/e2e/shots/.
// End-to-end smoke test of the local app with a mocked Supabase backend.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "shots"); fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:8765/";
const REF = "fakeproj", SB_URL = `https://${REF}.supabase.co`, KEY = "a".repeat(60);
const UID = "11111111-2222-4333-8444-555555555555", EMAIL = "roody16jar@gmail.com";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: UID, email: EMAIL, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000), session_id: "s1" })}.sig`;
const session = { access_token: JWT, refresh_token: "r1", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: UID, email: EMAIL, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-13T00:00:00Z" } };

const remote = { items: new Map(), explored: new Map() };
const log = []; const errors = [];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: "ar-SA", geolocation: { latitude: 24.8737, longitude: 46.6471, accuracy: 8 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  page.on("console", m => { if (["error", "warning"].includes(m.type())) log.push(`[console.${m.type()}] ${m.text()}`); });
  page.on("pageerror", e => errors.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", r => { if (!/tile\.openstreetmap|supabase/.test(r.url())) log.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`); });

  // mock supabase REST + storage + auth
  await page.route(`${SB_URL}/**`, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname.startsWith("/auth/v1/user") && m === "GET") return json(session.user);
    if (u.pathname.startsWith("/auth/v1/user") && m === "PUT") return json(session.user);
    if (u.pathname.startsWith("/auth/v1/logout")) return json({}, 204);
    if (u.pathname.startsWith("/auth/v1/token")) return json(session);
    if (u.pathname.startsWith("/auth/v1/recover")) return json({});
    if (u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.split("/")[3];
      if (m === "POST") { const rows = JSON.parse(req.postData() || "[]"); for (const r of rows) remote[table].set(table === "explored" ? r.user_id + "|" + r.id : r.id, { ...r, synced_at: new Date().toISOString() }); return json(rows, 201); }
      if (m === "GET") { const since = (u.searchParams.get("synced_at") || "gte.1970").slice(4); const rows = [...remote[table].values()].filter(r => r.synced_at >= since).sort((a, b) => a.synced_at < b.synced_at ? -1 : 1); return json(rows); }
    }
    if (u.pathname.startsWith("/storage/v1/object/photos/")) { if (m === "POST" || m === "PUT") return json({ Key: u.pathname.slice(19) }); if (m === "GET") return route.fulfill({ status: 404, body: "" }); }
    if (u.pathname.startsWith("/storage/v1/object/")) return json({ message: "ok" });
    return json({ message: "unmocked " + m + " " + u.pathname }, 404);
  });

  // 1. setup screen (no config)
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, "1-setup.png") });
  const setupVisible = await page.locator("#screen-setup").isVisible();
  console.log("setup screen visible:", setupVisible);
  await page.fill("#setup-url", SB_URL); await page.fill("#setup-key", KEY); await page.click("#setup-save");
  await page.waitForLoadState("networkidle");
  // 2. login screen
  await page.waitForSelector("#screen-auth:not(.hidden)", { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, "2-login.png") });
  console.log("login visible:", await page.locator("#form-login").isVisible());
  await page.click('[data-show="signup"]');
  console.log("signup email locked to:", await page.inputValue("#form-signup [name=email]"), "readonly:", await page.getAttribute("#form-signup [name=email]", "readonly") !== null);
  await page.screenshot({ path: path.join(OUT, "3-signup.png") });
  await page.click('#form-signup [data-show="login"]'); await page.click('#form-login [data-show="forgot"]'); await page.fill("#form-forgot [name=email]", EMAIL); await page.click("#form-forgot button[type=submit]");
  await page.waitForTimeout(800); console.log("forgot msg:", await page.textContent("#auth-msg"));
  // 3. login with mocked token endpoint
  await page.fill("#form-login [name=email]", EMAIL); await page.fill("#form-login [name=password]", "whatever-pass");
  await page.click("#form-login button[type=submit]");
  await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 });
  await page.waitForFunction(() => /\d+%/.test(document.querySelector("#coverage").textContent), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "4-map.png") });
  console.log("hood:", await page.inputValue("#hood"), "coverage:", await page.textContent("#coverage"), "sync:", await page.textContent("#sync"), "canvas:", await page.locator("#map canvas").count());
  // 4. tracking: GPS fix near a Narjis street marks it explored
  await page.click("#btn-track"); await page.waitForTimeout(1500);
  await ctx.setGeolocation({ latitude: 24.8738, longitude: 46.6472, accuracy: 6 }); await page.waitForTimeout(1500);
  await ctx.setGeolocation({ latitude: 24.8740, longitude: 46.6474, accuracy: 6 }); await page.waitForTimeout(1500);
  console.log("after fixes coverage:", await page.textContent("#coverage"), "fix:", await page.textContent("#fix"));
  await page.screenshot({ path: path.join(OUT, "5-tracking.png") });
  await page.click("#btn-track");
  // 5. import targets
  await page.click('nav [data-panel="targets"]');
  const tfile = path.join(__dirname, "targets_sample.json");
  fs.writeFileSync(tfile, JSON.stringify({ hood: "النرجس", hood_key: "narjis", date: "2026-10-06", targets: [
    { id: "narjis-006", lat: 24.873699, lon: 46.647076, area: 1300, kind: "مبنى مفرد على قطعة واحدة", kind_key: "small_dev", phase: "هيكل وسقف", phase_key: "active", use: "سكني", score: 100, why: "قطعة واحدة وسط فلل" },
    { id: "narjis-007", lat: 24.8750, lon: 46.6500, area: 600, kind: "فيلا", kind_key: "single", phase: "تشطيب", phase_key: "active", use: "سكني", score: 80, why: "فيلا جديدة" }] }));
  await page.setInputFiles("#t-import", tfile); await page.waitForTimeout(1000);
  console.log("targets count text:", await page.textContent("#t-count"), "list items:", await page.locator("#t-list li[data-id]").count());
  await page.screenshot({ path: path.join(OUT, "6-targets.png") });
  // 6. open target, edit note + status, add photo, autosave
  await page.click("#t-list li[data-id] >> nth=0");
  await page.waitForSelector("#dlg[open]");
  await page.fill("#dlg-form [name=note]", "ملاحظة اختبار"); await page.selectOption("#dlg-form [name=status]", "visited");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEKGBkYGBgYAAA3GgH9dL5QyQAAAABJRU5ErkJggg==", "base64");
  await page.setInputFiles("#dlg-photo", { name: "p.png", mimeType: "image/png", buffer: png });
  await page.waitForTimeout(1500);
  console.log("photos thumbs:", await page.locator("#dlg-photos img").count());
  await page.screenshot({ path: path.join(OUT, "7-dialog.png") });
  await page.click("#dlg-close");
  // 7. property via button (center of map)
  await page.click('nav [data-panel="props"]'); await page.click("#p-add"); await page.waitForSelector("#dlg[open]");
  await page.fill("#dlg-form [name=title]", "فيلا اختبار"); await page.fill("#dlg-form [name=owner_phone]", "0500000000"); await page.waitForTimeout(800); await page.click("#dlg-close");
  console.log("properties:", await page.locator("#p-list li[data-id]").count());
  // 8. wait for sync and check remote received rows
  await page.click('nav [data-panel="settings"]'); await page.click("#s-sync-now"); await page.waitForTimeout(2500);
  console.log("sync text:", await page.textContent("#s-sync"));
  console.log("remote items:", remote.items.size, "remote explored:", remote.explored.size, "statuses:", [...remote.items.values()].map(r => r.kind + ":" + (r.data.status || "")).join(","));
  await page.screenshot({ path: path.join(OUT, "8-settings.png") });
  // 9. export backup
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#s-export")]);
  const bpath = path.join(OUT, "backup.json"); await dl.saveAs(bpath);
  const backup = JSON.parse(fs.readFileSync(bpath, "utf8")); console.log("backup:", backup.items.length, "items", backup.explored.length, "explored", backup.photos.length, "photos", "msg:", await page.textContent("#s-backup-msg"));
  // 10. reload: data persists locally (service worker + IndexedDB), then wipe IndexedDB and pull from remote
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await page.waitForTimeout(2000);
  await page.click('nav [data-panel="props"]'); console.log("after reload properties:", await page.locator("#p-list li[data-id]").count());
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase("mustakshif"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await page.waitForTimeout(3000);
  await page.click('nav [data-panel="props"]'); console.log("after wipe+pull properties:", await page.locator("#p-list li[data-id]").count(), "coverage:", await page.textContent("#coverage"));
  // 10b. offline while logged in: the app opens on the local copy
  await ctx.setOffline(true); await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForTimeout(2500);
  console.log("offline logged-in app visible:", await page.locator("#app").isVisible(), "sync:", await page.textContent("#sync"));
  await ctx.setOffline(false); await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 });
  // 11. logout -> login screen
  await page.click('nav [data-panel="settings"]'); page.once("dialog", d => d.accept()); await page.click("#s-logout"); await page.waitForSelector("#screen-auth:not(.hidden)", { timeout: 10000 });
  console.log("after logout login visible:", await page.locator("#form-login").isVisible());
  // 12. offline: app shell still loads from the service worker
  await ctx.setOffline(true); await page.reload({ waitUntil: "domcontentloaded" }).catch(e => console.log("offline reload:", e.message.slice(0, 80)));
  await page.waitForTimeout(1500); console.log("offline title:", await page.title(), "auth visible:", await page.locator("#screen-auth").isVisible().catch(() => false));
  await ctx.setOffline(false);
  console.log("\nPAGE ERRORS:", errors.length ? errors.join("\n") : "none");
  console.log("CONSOLE:", log.length ? log.slice(0, 15).join("\n") : "none");
  await browser.close();
})().catch(e => { console.log("TEST FAILED:", e.message); console.log("PAGE ERRORS:", errors.join("\n")); console.log("CONSOLE:", log.join("\n")); process.exit(1); });
