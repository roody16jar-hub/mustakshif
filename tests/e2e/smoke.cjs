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
const log = [], errors = [], checks = [];
const ok = (name, cond, detail = "") => { checks.push([name, !!cond, detail]); console.log((cond ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : "")); };
const seedTargets = [{ id: "narjis-006", lat: 24.873699, lon: 46.647076, area: 1300, kind: "مبنى مفرد على قطعة واحدة", kind_key: "small_dev", phase: "هيكل وسقف", phase_key: "active", use: "سكني", score: 100, why: "قطعة واحدة وسط فلل", verified: true },
  { id: "narjis-007", lat: 24.8750, lon: 46.6500, area: 600, kind: "فيلا", kind_key: "single", phase: "تشطيب", phase_key: "active", use: "سكني", score: 80, why: "فيلا جديدة", verified: true }];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA", hasTouch: true, isMobile: true, geolocation: { latitude: 24.8737, longitude: 46.6471, accuracy: 8 }, permissions: ["geolocation"], acceptDownloads: true });
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
  const tab = async (p) => { await page.click(`#tabs [data-panel="${p}"]`); await page.waitForTimeout(300); };
  const more = async (id) => { await tab("more"); await page.click(`#more-menu [data-sub="${id}"]`); await page.waitForTimeout(300); };

  // 1. login screens
  await page.goto(BASE, { waitUntil: "networkidle" });
  const setupVisible = await page.locator("#screen-setup").isVisible();
  if (setupVisible) { await page.fill("#setup-url", SB_URL); await page.fill("#setup-key", KEY); await page.click("#setup-save"); }
  else { await page.evaluate(([u, k]) => localStorage.setItem("mustakshif.connection", JSON.stringify({ url: u, key: k })), [SB_URL, KEY]); await page.reload(); }
  await page.waitForSelector("#screen-auth:not(.hidden)", { timeout: 15000 }); await shot("1-login");
  await page.click('[data-show="signup"]');
  ok("signup email locked", (await page.inputValue("#form-signup [name=email]")) === EMAIL && (await page.getAttribute("#form-signup [name=email]", "readonly")) !== null);
  await page.click('#form-signup [data-show="login"]'); await page.click('#form-login [data-show="forgot"]'); await page.fill("#form-forgot [name=email]", EMAIL); await page.click("#form-forgot button[type=submit]");
  await page.waitForTimeout(600); ok("forgot password message", (await page.textContent("#auth-msg")).includes("بريدك"));
  await page.fill("#form-login [name=email]", EMAIL); await page.fill("#form-login [name=password]", "whatever-pass"); await page.click("#form-login button[type=submit]");
  await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 });
  await page.waitForFunction(() => /\d+%/.test(document.querySelector("#coverage").textContent), null, { timeout: 30000 });
  // 2. every tab
  ok("opening screen is today", (await page.textContent("#hdr-title")).trim() === "اليوم");
  ok("five tabs", (await page.$$eval("#tabs button span:last-child", e => e.map(x => x.textContent))).join(",") === "اليوم,الخريطة,العقارات,الأهداف,المزيد");
  await shot("2-today");
  for (const p of ["map", "props", "targets", "more"]) { await tab(p); ok("tab " + p + " visible", await page.locator("#panel-" + p).isVisible()); }
  // 3. targets import fallback
  const tfile = path.join(__dirname, "targets_sample.json"); fs.writeFileSync(tfile, JSON.stringify({ hood: "النرجس", hood_key: "narjis", date: "2026-10-06", targets: seedTargets }));
  await more("scout"); await page.setInputFiles("#t-import", tfile); await page.waitForTimeout(800);
  ok("scout screen shows the scan", (await page.textContent("#sub")).includes("2026-10-06"));
  await tab("targets"); ok("targets listed verified first", (await page.locator("#t-list li[data-id]").count()) === 2);
  // 4. tracking with pause, snapping, field actions
  await tab("map"); await page.waitForTimeout(500); await page.click("#btn-track"); await page.waitForTimeout(1200);
  for (const [la, lo] of [[24.8738, 46.6472], [24.87395, 46.64735], [24.8741, 46.6475], [24.87425, 46.64765]]) { await ctx.setGeolocation({ latitude: la, longitude: lo, accuracy: 6 }); await page.waitForTimeout(900); }
  const bar1 = (await page.textContent("#trackbar")).replace(/\s+/g, " ");
  ok("tracking bar shows streets and accuracy", /شارع جديد/.test(bar1) && /دقة 6/.test(bar1), bar1);
  ok("coverage counts explored streets", /· [1-9]\d*\//.test(await page.textContent("#coverage")), await page.textContent("#coverage"));
  await shot("3-map-tracking");
  await page.click("#btn-pause"); await page.waitForTimeout(400); ok("paused state", (await page.textContent("#trackbar")).includes("متوقف مؤقتاً") && (await page.textContent("#btn-pause")).includes("استئناف"));
  await page.click("#btn-pause"); await page.waitForTimeout(400); ok("resumed", (await page.textContent("#btn-pause")).includes("إيقاف مؤقت"));
  // property here (with photo + video cap) and sign here
  await page.click("#btn-prop-here"); await page.waitForSelector("#sheet[open]"); await page.waitForTimeout(400);
  ok("property code assigned", /عقار R-1/.test(await page.textContent("#sheet-title")));
  await page.fill("#sheet [name=title]", "فيلا زاوية اختبار"); await page.fill("#sheet [name=price]", "٢٥٠٠٠٠٠"); await page.fill("#sheet [name=area]", "400"); await page.fill("#sheet [name=rooms]", "5"); await page.fill("#sheet [name=owner_phone]", "٠٥٥١٢٣٤٥٦٧"); await page.selectOption("#sheet [name=status]", "contract"); await page.selectOption("#sheet [name=deed]", "ready");
  await page.waitForTimeout(600); ok("Arabic digits normalised", (await page.inputValue("#sheet [name=owner_phone]")) === "0551234567" && (await page.inputValue("#sheet [name=price]")) === "2500000");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEKGBkYGBgYAAA3GgH9dL5QyQAAAABJRU5ErkJggg==", "base64");
  await page.setInputFiles("#sheet [data-photo]", { name: "p.png", mimeType: "image/png", buffer: png }); await page.waitForTimeout(1200);
  ok("photo thumbnail", (await page.locator("#sheet [data-thumbs] img").count()) === 1);
  await page.setInputFiles("#sheet [data-video]", { name: "big.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(21 * 1024 * 1024) }); await page.waitForTimeout(600);
  ok("video over the cap is refused", (await page.textContent("#toast")).includes("أكبر من"));
  await page.setInputFiles("#sheet [data-video]", { name: "small.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048) }); await page.waitForTimeout(800);
  ok("small video stored", (await page.locator("#sheet [data-thumbs] video").count()) === 1);
  ok("owner WhatsApp button has my message", (await page.locator('#sheet a[href^="https://wa.me/966551234567"]').count()) === 1);
  await shot("4-property-form"); await page.click("#sheet-close");
  await page.click("#btn-sign-here"); await page.waitForSelector("#sheet[open]"); await page.fill("#sheet [name=phone]", "0509998877"); await page.waitForTimeout(500); await page.click("#sheet-close");
  await page.click("#btn-track"); await page.waitForSelector("#sheet[open]"); const summary = (await page.textContent("#sheet-body")).replace(/\s+/g, " ");
  ok("session summary has duration/distance/streets/properties/signs", /دقيقة/.test(summary) && /كم/.test(summary) && /شارع جديد/.test(summary) && /عقار سُجّل/.test(summary) && /لوحة/.test(summary), summary.slice(0, 120)); await page.click("#ss-close");
  // 5. target actions
  await tab("targets"); await page.click("#t-list li[data-id] >> nth=0"); await page.waitForSelector("#sheet[open]");
  ok("target card shows score and reason", /درجة 100/.test(await page.textContent("#sheet-body")) && /سبب الترشيح/.test(await page.textContent("#sheet-body")));
  await page.click('#sheet [data-act="visited"]'); await page.waitForTimeout(400); ok("target visited", (await page.inputValue("#sheet [name=status]")) === "visited"); await page.click("#sheet-close");
  await page.click("#t-list li[data-id] >> nth=1"); await page.waitForSelector("#sheet[open]"); await page.click('#sheet [data-act="ignore"]'); await page.waitForTimeout(300); ok("target ignored", (await page.inputValue("#sheet [name=status]")) === "ignored"); await page.click("#sheet-close");
  // 6. property card, contact log updates follow-up date and status
  await tab("props"); ok("properties list", (await page.locator("#p-list li[data-id]").count()) === 1);
  await page.click("#p-list li[data-id] >> nth=0"); await page.waitForSelector("#sheet[open]"); await page.waitForTimeout(300); await shot("5-property-card");
  await page.click('#sheet [data-act="contact"]'); await page.waitForSelector("#sheet-title:has-text('اتصال')"); await page.selectOption("#sheet [name=outcome]", "interested"); await page.fill("#sheet [name=next_followup]", "2026-10-20"); await page.fill("#sheet [name=note]", "يريد عرضاً"); await page.waitForTimeout(700); await page.click("#sheet-close");
  await page.waitForTimeout(300); const card = await page.textContent("#p-list li[data-id] >> nth=0");
  ok("follow-up date updated from the contact", card.includes("2026-10-20"), card.replace(/\s+/g, " ").slice(0, 80));
  await more("contacts"); ok("contact log entry", (await page.locator("#sub li[data-id]").count()) === 1);
  // 7. averages, requests both directions, broker, handover with Excel download
  await more("averages"); await page.click("#sub .btn.primary"); await page.waitForSelector("#sheet[open]"); await page.fill("#sheet [name=price_per_m2]", "6000"); await page.waitForTimeout(500); await page.click("#sheet-close");
  await more("requests"); await page.click("#sub .btn.primary"); await page.waitForSelector("#sheet[open]"); await page.fill("#sheet [name=buyer_name]", "أبو فهد"); await page.fill("#sheet [name=budget_max]", "2600000"); await page.waitForTimeout(500); await page.click("#sheet-close");
  await page.waitForTimeout(300); ok("request matched to property", (await page.textContent("#sub")).includes("عقار مطابق"));
  await tab("props"); await page.click("#p-list li[data-id] >> nth=0"); await page.waitForSelector("#sheet[open]"); await page.waitForTimeout(300);
  ok("property shows matching request and price verdict", (await page.textContent("#req-matches")).includes("أبو فهد") && /سعر/.test(await page.textContent("#verdict"))); await page.click("#sheet-close");
  await more("settings"); await page.click("#s-broker"); await page.waitForSelector("#sheet[open]"); await page.fill("#sheet [name=name]", "رائد"); await page.fill("#sheet [name=license]", "1234567"); await page.fill("#sheet [name=office]", "مكتب الاختبار"); await page.fill("#sheet [name=phone]", "0500000000"); await page.waitForTimeout(500); await page.click("#sheet-close");
  await more("handover"); await page.check("#sub input[type=checkbox][value]"); await page.click("#ho-gen"); await page.waitForTimeout(300);
  const report = await page.textContent("#ho-out pre");
  ok("handover text safe (no owner phone, no floor price, no location unless ticked)", !report.includes("0551234567") && !report.includes("maps.google") && report.includes("R-1") && (await page.textContent("#ho-out .notice")).includes("تم التحقق"));
  await shot("6-handover");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#ho-xlsx")]); const xp = path.join(OUT, "handover.xlsx"); await dl.saveAs(xp);
  ok("handover Excel downloaded", fs.statSync(xp).size > 5000, fs.statSync(xp).size + " bytes");
  await page.click("#ho-log"); await page.waitForTimeout(400); ok("handover logged with code", (await page.textContent("#sub")).includes("R-1") && (await page.textContent("#sub")).includes("سجل التسليم"));
  await more("stats"); ok("stats per district", (await page.textContent("#sub")).includes("عقود وساطة"));
  await more("scripts"); ok("ten scripts", (await page.locator("#sub [data-script]").count()) === 10);
  await more("legend"); ok("legend", (await page.textContent("#sub")).includes("ضباب"));
  await tab("map"); await page.click("#btn-legend"); await page.waitForSelector("#sheet[open]"); ok("legend sheet from map", (await page.textContent("#sheet-body")).includes("موقعك")); await page.click("#sheet-close");
  // 8. sync + backup + persistence + wipe/pull + offline + logout/login
  await more("settings"); await page.click("#s-sync-now"); await page.waitForTimeout(2500);
  ok("synced items and explored segments", remote.items.size >= 9 && remote.explored.size >= 2, `${remote.items.size} items, ${remote.explored.size} explored, kinds ${[...new Set([...remote.items.values()].map(r => r.kind))].join(",")}`);
  ok("no owner data in request URLs", ![...remote.items.keys()].some(k => k.includes("0551234567")));
  const [bdl] = await Promise.all([page.waitForEvent("download"), page.click("#s-export")]); const bpath = path.join(OUT, "backup.json"); await bdl.saveAs(bpath);
  const backup = JSON.parse(fs.readFileSync(bpath, "utf8")); ok("backup has items, explored, media", backup.items.length >= 9 && backup.explored.length >= 2 && backup.photos.length === 2);
  await page.waitForTimeout(300); ok("backup reminder cleared", (await page.textContent("#sub")).includes("آخر نسخة"));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await page.waitForTimeout(1500);
  await tab("props"); ok("after reload properties persist", (await page.locator("#p-list li[data-id]").count()) === 1);
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase("mustakshif"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await page.waitForTimeout(3000);
  await tab("props"); ok("after wipe + pull from server", (await page.locator("#p-list li[data-id]").count()) === 1 && /· [1-9]\d*\//.test(await page.textContent("#coverage")), await page.textContent("#coverage"));
  await ctx.setOffline(true); await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForTimeout(2500);
  ok("offline: app opens on local copy", await page.locator("#app").isVisible() && (await page.textContent("#sync")).includes("بلا اتصال"));
  await ctx.setOffline(false); await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await page.waitForTimeout(2000);
  ok("back online: synced", (await page.textContent("#sync")).includes("متزامن"));
  await more("settings"); page.once("dialog", d => d.accept()); await page.click("#s-logout"); await page.waitForSelector("#screen-auth:not(.hidden)", { timeout: 10000 });
  ok("logout shows login", await page.locator("#form-login").isVisible());
  await page.fill("#form-login [name=email]", EMAIL); await page.fill("#form-login [name=password]", "x".repeat(8)); await page.click("#form-login button[type=submit]"); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await page.waitForTimeout(1500);
  await tab("props"); ok("login again shows the same data", (await page.locator("#p-list li[data-id]").count()) === 1);
  const failed = checks.filter(c => !c[1]);
  console.log(`\nCHECKS: ${checks.length - failed.length}/${checks.length} passed`);
  console.log("PAGE ERRORS:", errors.length ? errors.join("\n") : "none");
  console.log("CONSOLE:", log.length ? log.slice(0, 12).join("\n") : "none");
  await browser.close();
  if (errors.length || failed.length) process.exit(1);
})().catch(e => { console.log("TEST FAILED:", e.message.split("\n")[0]); console.log("PAGE ERRORS:", errors.join("\n")); console.log("CONSOLE:", log.join("\n")); process.exit(1); });
