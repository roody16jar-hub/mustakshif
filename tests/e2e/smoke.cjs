// Run: python tools/serve.py (port 8765) then: NODE_PATH=<a folder with playwright installed>/node_modules node tests/e2e/smoke.cjs [baseUrl]
// Needs Playwright + Chromium. Mocks Supabase entirely; screenshots go to tests/e2e/shots/.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "shots"); fs.mkdirSync(OUT, { recursive: true });
const BASE = process.argv[2] || "http://127.0.0.1:8765/";
const SB_URL = "https://fakeproj.supabase.co", KEY = "a".repeat(60);
const UID = "11111111-2222-4333-8444-555555555555", EMAIL = "roody16jar@gmail.com";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 86400;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: UID, email: EMAIL, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s1" })}.sig`;
const session = { access_token: JWT, refresh_token: "r1", token_type: "bearer", expires_in: 86400, expires_at: exp, user: { id: UID, email: EMAIL, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-13T00:00:00Z" } };
const remote = { items: new Map(), explored: new Map() };
const log = [], errors = [];
const seedTargets = [{ id: "narjis-006", lat: 24.873699, lon: 46.647076, area: 1300, kind: "مبنى مفرد على قطعة واحدة", kind_key: "small_dev", phase: "هيكل وسقف", phase_key: "active", use: "سكني", score: 100, why: "قطعة واحدة وسط فلل", verified: true },
  { id: "narjis-007", lat: 24.8750, lon: 46.6500, area: 600, kind: "فيلا", kind_key: "single", phase: "تشطيب", phase_key: "active", use: "سكني", score: 80, why: "فيلا جديدة", verified: true }];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA", hasTouch: true, isMobile: true, geolocation: { latitude: 24.8737, longitude: 46.6471, accuracy: 8 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  page.on("console", m => { if (["error", "warning"].includes(m.type())) log.push(`[console.${m.type()}] ${m.text()}`); });
  page.on("pageerror", e => errors.push(`[pageerror] ${e.message}`));
  await page.route(`${SB_URL}/**`, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname.startsWith("/auth/v1/user")) return json(session.user);
    if (u.pathname.startsWith("/auth/v1/logout")) return json({}, 204);
    if (u.pathname.startsWith("/auth/v1/token")) return json(session);
    if (u.pathname.startsWith("/auth/v1/recover")) return json({});
    if (u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.split("/")[3];
      if (m === "POST") { const rows = JSON.parse(req.postData() || "[]"); for (const r of rows) remote[table].set(table === "explored" ? r.user_id + "|" + r.id : r.id, { ...r, synced_at: new Date().toISOString() }); return json(rows, 201); }
      if (m === "GET") { const since = (u.searchParams.get("synced_at") || "gte.1970").slice(4); return json([...remote[table].values()].filter(r => r.synced_at >= since).sort((a, b) => a.synced_at < b.synced_at ? -1 : 1)); }
    }
    if (u.pathname.startsWith("/storage/v1/object/photos/")) { if (m === "POST" || m === "PUT") return json({ Key: u.pathname.slice(19) }); return route.fulfill({ status: 404, body: "" }); }
    if (u.pathname.startsWith("/storage/v1/object/")) return json({ message: "ok" });
    return json({ message: "unmocked " + m + " " + u.pathname }, 404);
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + ".png") });

  // 1. connection + login screens
  await page.goto(BASE, { waitUntil: "networkidle" });
  const setupVisible = await page.locator("#screen-setup").isVisible();
  console.log("setup screen visible:", setupVisible, "(false when config.js already holds the keys)");
  if (setupVisible) { await page.fill("#setup-url", SB_URL); await page.fill("#setup-key", KEY); await page.click("#setup-save"); }
  else { await page.evaluate(([u, k]) => localStorage.setItem("mustakshif.connection", JSON.stringify({ url: u, key: k })), [SB_URL, KEY]); await page.reload(); }
  await page.waitForSelector("#screen-auth:not(.hidden)", { timeout: 15000 }); await shot("1-login");
  await page.click('[data-show="signup"]');
  console.log("signup email locked to:", await page.inputValue("#form-signup [name=email]"), "readonly:", await page.getAttribute("#form-signup [name=email]", "readonly") !== null);
  await page.click('#form-signup [data-show="login"]'); await page.click('#form-login [data-show="forgot"]'); await page.fill("#form-forgot [name=email]", EMAIL); await page.click("#form-forgot button[type=submit]");
  await page.waitForTimeout(600); console.log("forgot msg:", await page.textContent("#auth-msg"));
  await page.fill("#form-login [name=email]", EMAIL); await page.fill("#form-login [name=password]", "whatever-pass"); await page.click("#form-login button[type=submit]");
  await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 });
  // 2. today (opening screen) then map
  await page.waitForFunction(() => /\d+%/.test(document.querySelector("#coverage").textContent), null, { timeout: 30000 });
  console.log("opening screen:", await page.textContent("#hdr-title"), "| tabs:", (await page.$$eval("#tabs button span:last-child", e => e.map(x => x.textContent))).join(","));
  await shot("2-today");
  // 3. targets via import fallback (scout upload is mocked by file)
  const tfile = path.join(__dirname, "targets_sample.json"); fs.writeFileSync(tfile, JSON.stringify({ hood: "النرجس", hood_key: "narjis", date: "2026-10-06", targets: seedTargets }));
  await page.click('#tabs [data-panel="more"]'); await page.click('#more-menu [data-sub="scout"]'); await page.setInputFiles("#t-import", tfile); await page.waitForTimeout(800);
  console.log("scout screen:", (await page.textContent("#sub")).replace(/\s+/g, " ").slice(0, 120));
  await page.click('#tabs [data-panel="targets"]'); await page.waitForTimeout(300);
  console.log("targets:", await page.textContent("#t-count"), "| cards:", await page.locator("#t-list li[data-id]").count());
  // 4. tracking + snapping + field actions
  await page.click('#tabs [data-panel="map"]'); await page.waitForTimeout(500);
  await page.click("#btn-track"); await page.waitForTimeout(1200);
  for (const [la, lo] of [[24.8738, 46.6472], [24.87395, 46.64735], [24.8741, 46.6475], [24.87425, 46.64765]]) { await ctx.setGeolocation({ latitude: la, longitude: lo, accuracy: 6 }); await page.waitForTimeout(900); }
  console.log("tracking:", (await page.textContent("#trackbar")).replace(/\s+/g, " "), "| coverage:", await page.textContent("#coverage"));
  await shot("3-map-tracking");
  await page.click("#btn-prop-here"); await page.waitForSelector("#sheet[open]"); await page.waitForTimeout(400);
  await page.fill("#sheet [name=title]", "فيلا زاوية اختبار"); await page.fill("#sheet [name=price]", "2500000"); await page.fill("#sheet [name=area]", "400"); await page.fill("#sheet [name=owner_phone]", "0551234567"); await page.selectOption("#sheet [name=status]", "listed");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEKGBkYGBgYAAA3GgH9dL5QyQAAAABJRU5ErkJggg==", "base64");
  await page.setInputFiles("#sheet [data-photo]", { name: "p.png", mimeType: "image/png", buffer: png }); await page.waitForTimeout(1200);
  console.log("property form photos:", await page.locator("#sheet [data-thumbs] img").count(), "| verdict:", (await page.textContent("#verdict")).trim().slice(0, 60));
  await shot("4-property-form"); await page.click("#sheet-close");
  await page.click("#btn-sign-here"); await page.waitForSelector("#sheet[open]"); await page.fill("#sheet [name=phone]", "0509998877"); await page.waitForTimeout(500); await page.click("#sheet-close");
  await page.click("#btn-track"); await page.waitForSelector("#sheet[open]"); console.log("session summary:", (await page.textContent("#sheet-body")).replace(/\s+/g, " ").slice(0, 160)); await page.click("#ss-close");
  // 5. target card: visited
  await page.click('#tabs [data-panel="targets"]'); await page.click("#t-list li[data-id] >> nth=0"); await page.waitForSelector("#sheet[open]"); await page.click('#sheet [data-act="visited"]'); await page.waitForTimeout(400); await page.click("#sheet-close");
  // 6. properties list + card
  await page.click('#tabs [data-panel="props"]'); await page.waitForTimeout(300); console.log("properties:", await page.locator("#p-list li[data-id]").count());
  await page.click("#p-list li[data-id] >> nth=0"); await page.waitForSelector("#sheet[open]"); await page.waitForTimeout(300); await shot("5-property-card"); await page.click("#sheet-close");
  // 7. more: averages, request matching, contact, handover
  await page.click('#tabs [data-panel="more"]'); await page.click('#more-menu [data-sub="averages"]'); await page.click("#sub .btn.primary"); await page.waitForSelector("#sheet[open]"); await page.fill("#sheet [name=price_per_m2]", "6000"); await page.waitForTimeout(500); await page.click("#sheet-close");
  await page.click("#hdr-back"); await page.click('#more-menu [data-sub="requests"]'); await page.click("#sub .btn.primary"); await page.waitForSelector("#sheet[open]"); await page.fill("#sheet [name=buyer_name]", "أبو فهد"); await page.fill("#sheet [name=budget_max]", "2600000"); await page.waitForTimeout(500); await page.click("#sheet-close");
  await page.waitForTimeout(300); console.log("request matches:", (await page.textContent("#sub")).includes("عقار مطابق") ? "yes" : "no");
  await page.click("#hdr-back"); await page.click('#more-menu [data-sub="settings"]'); await page.click("#s-broker"); await page.waitForSelector("#sheet[open]"); await page.fill("#sheet [name=name]", "رائد"); await page.fill("#sheet [name=license]", "1234567"); await page.fill("#sheet [name=office]", "مكتب الاختبار"); await page.waitForTimeout(500); await page.click("#sheet-close");
  await page.click("#hdr-back"); await page.click('#more-menu [data-sub="handover"]'); await page.check("#sub input[type=checkbox] >> nth=0"); await page.click("#ho-gen"); await page.waitForTimeout(300);
  const report = await page.textContent("#ho-out pre"); console.log("handover safe:", !report.includes("0551234567") && !report.includes("[رقم محذوف]") ? "no phone" : "CHECK", "| notice:", (await page.textContent("#ho-out .notice")).trim().slice(0, 40));
  await shot("6-handover"); await page.click("#ho-log"); await page.waitForTimeout(300);
  await page.click("#hdr-back"); await page.click('#more-menu [data-sub="stats"]'); console.log("stats:", (await page.textContent("#sub")).replace(/\s+/g, " ").slice(0, 80));
  // 8. sync + persistence + wipe/pull + offline + logout
  await page.click("#hdr-back"); await page.click('#more-menu [data-sub="settings"]'); await page.click("#s-sync-now"); await page.waitForTimeout(2500);
  console.log("remote:", remote.items.size, "items", remote.explored.size, "explored | kinds:", [...new Set([...remote.items.values()].map(r => r.kind))].join(","));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#s-export")]); const bpath = path.join(OUT, "backup.json"); await dl.saveAs(bpath);
  const backup = JSON.parse(fs.readFileSync(bpath, "utf8")); console.log("backup:", backup.items.length, "items", backup.explored.length, "explored", backup.photos.length, "photos");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await page.waitForTimeout(1500);
  await page.click('#tabs [data-panel="props"]'); console.log("after reload properties:", await page.locator("#p-list li[data-id]").count());
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase("mustakshif"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await page.waitForTimeout(3000);
  await page.click('#tabs [data-panel="props"]'); console.log("after wipe+pull properties:", await page.locator("#p-list li[data-id]").count(), "coverage:", await page.textContent("#coverage"));
  await ctx.setOffline(true); await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForTimeout(2500);
  console.log("offline logged-in app visible:", await page.locator("#app").isVisible(), "sync:", await page.textContent("#sync"));
  await ctx.setOffline(false); await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 });
  await page.click('#tabs [data-panel="more"]'); await page.click('#more-menu [data-sub="settings"]'); page.once("dialog", d => d.accept()); await page.click("#s-logout"); await page.waitForSelector("#screen-auth:not(.hidden)", { timeout: 10000 });
  console.log("after logout login visible:", await page.locator("#form-login").isVisible());
  console.log("\nPAGE ERRORS:", errors.length ? errors.join("\n") : "none");
  console.log("CONSOLE:", log.length ? log.slice(0, 12).join("\n") : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.log("TEST FAILED:", e.message.split("\n")[0]); console.log("PAGE ERRORS:", errors.join("\n")); console.log("CONSOLE:", log.join("\n")); process.exit(1); });
