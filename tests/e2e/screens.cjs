// Design verification: screenshots of every screen in all 4 themes at 390x844 and 430x932 into screens/,
// plus automated checks: no horizontal overflow, tap targets >= 48px, text >= 14px, contrast >= 4.5:1 (7:1 in day).
// Run: python tools/serve.py then NODE_PATH=<playwright node_modules> node tests/e2e/screens.cjs [baseUrl]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8765/";
const OUT = path.join(__dirname, "..", "..", "screens"); fs.mkdirSync(OUT, { recursive: true });
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const UID = "11111111-2222-4333-8444-555555555555", EMAIL = "roody16jar@gmail.com", exp = Math.floor(Date.now() / 1000) + 86400;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: UID, email: EMAIL, role: "authenticated", aud: "authenticated", exp })}.sig`;
const session = { access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: exp, user: { id: UID, email: EMAIL, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
const THEMES = ["neon", "day", "blueprint", "saudi"], SIZES = [[390, 844], [430, 932]];
const now = new Date().toISOString();
const seed = [
  { id: "a1", kind: "target", data: { ref: "narjis-006", title: "narjis-006", hood: "narjis", lat: 24.873699, lon: 46.647076, area: 1300, kind_label: "مبنى مفرد على قطعة واحدة", kind_key: "small_dev", phase: "هيكل وسقف", score: 100, why: "قطعة واحدة وسط فلل", verified: true, my_type: true, status: "new", photos: [], scan_date: "2026-10-06" } },
  { id: "a2", kind: "target", data: { ref: "narjis-011", title: "narjis-011", hood: "narjis", lat: 24.8750, lon: 46.6500, area: 600, kind_label: "فيلا", kind_key: "single", phase: "تشطيب", score: 80, verified: true, my_type: true, status: "visited", visited_at: now, photos: [] } },
  { id: "b1", kind: "property", data: { title: "فيلا زاوية شارع 12", hood: "narjis", type: "villa", status: "listed", area: "400", price: "2500000", owner_name: "أبو خالد", owner_phone: "0551234567", phase: "تشطيب", note: "المالك جاد", next_followup: "2026-10-14", lat: 24.8745, lon: 46.6480, photos: [] } },
  { id: "b2", kind: "property", data: { title: "عمارة سكنية", hood: "narjis", type: "building", status: "contacted", area: "900", price: "6500000", next_followup: "2026-10-01", lat: 24.8720, lon: 46.6450, photos: [] } },
  { id: "c1", kind: "sign", data: { hood: "narjis", phone: "0509998877", text: "للبيع", status: "new", lat: 24.8730, lon: 46.6460, photos: [] } },
  { id: "d1", kind: "contact", data: { ref_kind: "property", ref_id: "b1", ref_title: "فيلا زاوية شارع 12", hood: "narjis", channel: "call", outcome: "interested", at: now, note: "يريد عرضاً خلال أسبوع", next_followup: "2026-10-14" } },
  { id: "e1", kind: "request", data: { buyer_name: "أبو فهد", buyer_phone: "0500000001", hood: "narjis", type: "villa", budget_min: "2000000", budget_max: "2700000", area_min: "350", status: "open" } },
  { id: "f1", kind: "price_avg", data: { hood: "narjis", type: "villa", price_per_m2: "6000" } },
  { id: "g1", kind: "contractor", data: { name: "مؤسسة البناء الحديث", phone: "0533334444", specialty: "فلل", hoods: "النرجس، الياسمين" } },
  { id: "h1", kind: "setting", data: { key: "broker", value: { name: "رائد", license: "1234567", office: "مكتب النخبة العقاري", phone: "0500000000" } } },
  { id: "i1", kind: "scan", data: { hood: "narjis", scan_date: "2026-10-06", total: 234, verified: 122, of_my_type: 182 } },
  { id: "j1", kind: "session", data: { hood: "narjis", duration_s: 1500, km: 8.4, streets_new: 37, targets_near: 3, properties_added: 1, signs_added: 1 } },
].map(r => ({ ...r, deleted: false, updated_at: now, created_at: now, synced_at: now, user_id: UID }));

const findings = [];
async function checks(page, name, theme) {
  const r = await page.evaluate(({ dayTheme }) => {
    const out = { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, small: [], tiny: [], contrast: [] };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && r.bottom > 0 && r.top < innerHeight; };
    for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], label.btn, .item, .menu li, .chip")) {
      if (!vis(el) || el.closest(".leaflet-control-attribution") || (el.tagName === "INPUT" && el.closest("label.check"))) continue;   // the label is the tap target
      const r = el.getBoundingClientRect(); if (r.width < 48 || r.height < 48) out.small.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${[...el.classList].slice(0, 2).join(".")} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || "").trim().slice(0, 18)}"`);
    }
    const parse = (c) => { const m = c.match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (el) => { let e = el; while (e && e !== document.documentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && (c.length < 4 || c[3] > 0.9)) return c; e = e.parentElement; } return parse(getComputedStyle(document.body).backgroundColor) || [0, 0, 0]; };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const t = walker.currentNode; const el = t.parentElement; if (!el || !t.textContent.trim() || seen.has(el) || el.closest(".leaflet-container, script, style")) continue; seen.add(el);
      if (!vis(el)) continue;
      const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize);
      if (fs < 14) out.tiny.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")} ${fs}px "${t.textContent.trim().slice(0, 18)}"`);
      const fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue;
      if (fg.length === 4 && fg[3] < 0.5) continue;
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const need = dayTheme ? 7 : 4.5;
      if (ratio < need) out.contrast.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")} ${ratio.toFixed(2)} "${t.textContent.trim().slice(0, 18)}"`);
    }
    return out;
  }, { dayTheme: theme === "day" });
  const tag = `${name} [${theme}]`;
  if (r.overflow) findings.push(`${tag}: HORIZONTAL OVERFLOW`);
  for (const s of r.small) findings.push(`${tag}: tap<48 ${s}`);
  for (const s of r.tiny) findings.push(`${tag}: text<14 ${s}`);
  for (const s of r.contrast) findings.push(`${tag}: contrast ${s}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  for (const [w, h] of SIZES) for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "ar-SA", hasTouch: true, isMobile: true, geolocation: { latitude: 24.8737, longitude: 46.6471, accuracy: 8 }, permissions: ["geolocation"] });
    const page = await ctx.newPage(); page.on("pageerror", e => errors.push(`${theme}@${w}: ${e.message}`));
    await page.route("https://fakeproj.supabase.co/**", r => { const u = new URL(r.request().url()); if (u.pathname.startsWith("/auth/v1/user")) return r.fulfill({ json: session.user }); if (u.pathname.startsWith("/rest/v1/items") && r.request().method() === "GET") return r.fulfill({ json: (u.searchParams.get("synced_at") || "").includes("1970") ? seed : [] }); if (u.pathname.startsWith("/rest/v1/")) return r.fulfill({ json: r.request().method() === "GET" ? [] : JSON.parse(r.request().postData() || "[]") }); return r.fulfill({ json: {} }); });
    await page.goto(BASE);
    await page.evaluate(([s, t]) => { localStorage.setItem("mustakshif.connection", JSON.stringify({ url: "https://fakeproj.supabase.co", key: "a".repeat(60) })); localStorage.setItem("sb-fakeproj-auth-token", JSON.stringify(s)); localStorage.setItem("mustakshif.theme", t); localStorage.setItem("mustakshif.hood", "narjis"); }, [session, theme]);
    await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#app:not(.hidden)", { timeout: 20000 });
    await page.waitForFunction(() => /\d+%/.test(document.querySelector("#coverage").textContent), null, { timeout: 30000 }); await page.waitForTimeout(2500);
    const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, `${name}-${theme}-${w}.png`) }); await checks(page, name, theme); };
    const tab = async (p) => { await page.click(`#tabs [data-panel="${p}"]`); await page.waitForTimeout(300); };
    const more = async (id) => { await tab("more"); await page.click(`#more-menu [data-sub="${id}"]`); await page.waitForTimeout(300); };
    await shot("01-login-before"); // (app already open: used for login below)
    await tab("today"); await shot("02-today");
    await tab("map"); await page.waitForTimeout(800); await shot("03-map");
    await page.click("#btn-track"); await page.waitForTimeout(1200);
    for (const [la, lo] of [[24.8738, 46.6472], [24.87395, 46.64735], [24.8741, 46.6475]]) { await ctx.setGeolocation({ latitude: la, longitude: lo, accuracy: 6 }); await page.waitForTimeout(800); }
    await shot("04-map-tracking"); await page.click("#btn-track"); await page.waitForSelector("#sheet[open]"); await shot("05-session-summary"); await page.click("#ss-close");
    await page.evaluate(() => { const m = document.querySelector("#map"); }); await tab("props"); await shot("06-properties");
    await page.click("#p-list li[data-id] >> nth=0"); await page.waitForSelector("#sheet[open]"); await page.waitForTimeout(300); await shot("07-property-card"); await page.click("#sheet-close");
    await page.click("#p-add"); await page.waitForSelector("#sheet[open]"); await page.waitForTimeout(300); await shot("08-property-form");
    page.once("dialog", d => d.accept()); await page.click('#sheet [data-act="delete"]'); await page.waitForTimeout(300);
    await tab("targets"); await shot("09-targets"); await page.click("#t-list li[data-id] >> nth=0"); await page.waitForSelector("#sheet[open]"); await page.waitForTimeout(300); await shot("10-target-card"); await page.click("#sheet-close");
    await tab("more"); await shot("11-more");
    for (const [id, n] of [["scout", "12-scout"], ["signs", "13-signs"], ["contacts", "14-contacts"], ["requests", "15-requests"], ["handover", "16-handover"], ["stats", "17-stats"], ["contractors", "18-contractors"], ["averages", "19-averages"], ["scripts", "20-scripts"], ["ranking", "21-ranking"], ["excel", "22-excel"], ["settings", "23-settings"]]) {
      await more(id); if (id === "handover") { await page.check("#sub input[type=checkbox] >> nth=0"); await page.click("#ho-gen"); await page.waitForTimeout(300); } await shot(n);
    }
    await page.click('#tabs [data-panel="map"]'); await page.waitForTimeout(300); await page.evaluate(() => { localStorage.setItem("mustakshif.osm", "1"); }); await page.click("#btn-layers"); await page.waitForTimeout(1500); await shot("24-map-osm");
    await page.evaluate(() => localStorage.removeItem("sb-fakeproj-auth-token")); await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#screen-auth:not(.hidden)"); await shot("01-login");
    await ctx.close();
    console.log(`done ${theme} ${w}x${h}`);
  }
  fs.unlinkSync(path.join(OUT, "01-login-before-neon-390.png")); // cleanup helper shots
  for (const f of fs.readdirSync(OUT)) if (f.startsWith("01-login-before")) fs.unlinkSync(path.join(OUT, f));
  fs.writeFileSync(path.join(OUT, "checks.txt"), findings.join("\n") || "no findings");
  console.log("\nFINDINGS:", findings.length); console.log(findings.slice(0, 60).join("\n"));
  console.log("\nPAGE ERRORS:", errors.length ? errors.join("\n") : "none");
  await browser.close();
})().catch(e => { console.log("FAILED", e.message.split("\n")[0]); process.exit(1); });
