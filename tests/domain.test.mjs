import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRequest, matchProperty, priceCheck, handoverText, assertOfficeSafe, sanitizeForOffice, handoverRows, weeklyStats, objectives, dueFollowups, importProperties, callScripts, SCRIPT_TITLES, ownerWhatsapp, districtRanking, isFaded, scoutSummary, normalizeDigits, nextCode } from "../js/domain.js";

const prop = (over = {}) => ({ id: over.id || "p1", kind: "property", created_at: "2026-10-12T10:00:00Z", data: { code: "R-1", title: "فيلا شارع 12", hood: "narjis", type: "villa", price: "2500000", area: "400", owner_name: "أبو خالد", owner_phone: "0551234567", floor_price: "2300000", note: "المالك جاد، جواله 0551234567", status: "contract", lat: 24.87, lon: 46.64, ...over } });

test("matching: hood + type + budget + area give a strong match, wrong hood is excluded", () => {
  const req = { data: { hood: "narjis", type: "villa", budget_min: "2000000", budget_max: "2600000", area_min: "350", status: "open" } };
  const props = [prop(), prop({ id: "p2", hood: "malaz" }), prop({ id: "p3", price: "3500000" }), prop({ id: "p4", area: "300" }), prop({ id: "p5", status: "sold" })];
  const m = matchRequest(req, props);
  assert.deepEqual(m.map(x => x.property.id), ["p1"]);
  assert.ok(m[0].score >= 90 && m[0].why.includes("ضمن الميزانية"));
});
test("matching: slightly over budget still appears with a lower score; Arabic digits are understood", () => {
  const req = { data: { hood: "narjis", budget_max: "٢٤٠٠٠٠٠" } };
  const m = matchRequest(req, [prop({ price: "2600000" })]);
  assert.equal(m.length, 1); assert.ok(m[0].score < 90);
});
test("matching works in both directions: a property finds its open requests", () => {
  const reqs = [{ id: "r1", data: { buyer_name: "أ", hood: "narjis", type: "villa", budget_max: "2600000", status: "open" } }, { id: "r2", data: { hood: "malaz", status: "open" } }, { id: "r3", data: { hood: "narjis", status: "closed" } }];
  const m = matchProperty(prop(), reqs);
  assert.deepEqual(m.map(x => x.request.id), ["r1"]);
});
test("price check: below / fair / above against the newest dated district average", () => {
  const avgs = [{ data: { hood: "narjis", type: "villa", price_per_m2: "5000", date: "2026-01-01" } }, { data: { hood: "narjis", type: "villa", price_per_m2: "6000", date: "2026-10-01" } }];
  assert.equal(priceCheck(prop({ price: "2000000", area: "400" }), avgs).verdict, "below");
  assert.equal(priceCheck(prop({ price: "2450000", area: "400" }), avgs).verdict, "fair");
  const above = priceCheck(prop({ price: "3000000", area: "400" }), avgs); assert.equal(above.verdict, "above"); assert.equal(above.diffPct, 25); assert.ok(above.basis.includes("2026-10-01"));
  assert.equal(priceCheck(prop({ hood: "malaz" }), avgs).verdict, "unknown");
  assert.equal(priceCheck(prop({ price: "" }), avgs).verdict, "unknown");
});
test("office report never contains owner name, phone or floor price (also inside notes); location only when ticked", () => {
  const ps = [prop(), prop({ id: "p2", code: "R-2", owner_name: "سعد", owner_phone: "+966 55 987 6543", floor_price: "1900000", note: "يقبل 1900000 اتصل 0559876543" })];
  const broker = { name: "رائد", license: "12345", phone: "0500000000", office: "مكتب النخبة" };
  const text = handoverText(ps, broker);
  assert.ok(text.includes("رائد") && text.includes("النرجس") && text.includes("2500000") && text.includes("R-2"));
  for (const bad of ["أبو خالد", "0551234567", "2300000", "سعد", "9876543", "1900000"]) assert.ok(!text.includes(bad), "leaked: " + bad);
  assert.equal(assertOfficeSafe(text, ps, broker), true);
  assert.throws(() => assertOfficeSafe(text + " 0551234567", ps, broker));
  assert.ok(text.includes("maps.google.com")); assert.ok(!handoverText(ps, broker, { location: false }).includes("maps.google.com"));
  const s = sanitizeForOffice(ps[0]); assert.ok(!("owner_phone" in s) && !("floor_price" in s) && !("owner_name" in s));
  const rows = handoverRows(ps); assert.ok(!JSON.stringify(rows).includes("0551234567")); assert.equal(rows[0]["الكود"], "R-1");
  assert.equal(handoverRows(ps, false)[0]["الموقع"], "");
});
test("weekly stats per district: funnel from phone numbers to deals", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const items = [prop({ id: "a", status: "contacted" }), prop({ id: "b", status: "handed" }), { ...prop({ id: "c", status: "new", owner_phone: "" }), created_at: "2026-09-20T10:00:00Z" }, prop({ id: "d", hood: "malaz", status: "sold" }),
    { id: "k", kind: "contact", created_at: "2026-10-11T10:00:00Z", data: { hood: "narjis" } }, { id: "h", kind: "handover", created_at: "2026-10-12T10:00:00Z", data: { hood: "narjis", property_ids: ["b"] } },
    { id: "s", kind: "session", created_at: "2026-10-12T10:00:00Z", data: { hood: "narjis", duration_s: 1800, km: 7.5, streets_new: 12 } }];
  const s = weeklyStats(items, now, "narjis");
  assert.equal(s.thisWeek.properties, 2); assert.equal(s.thisWeek.minutes, 30); assert.equal(s.thisWeek.streets, 12); assert.equal(s.thisWeek.handovers, 1); assert.equal(s.thisWeek.deals, 0);
  assert.equal(s.funnel.total, 3); assert.equal(s.funnel.phones, 2); assert.equal(s.funnel.handed, 1); assert.equal(s.conversion.phones, 67);
  assert.equal(weeklyStats(items, now).thisWeek.deals, 1);
});
test("three objectives per district; completed only when all three reach their goal", () => {
  const items = [
    { id: "1", kind: "target", data: { hood: "narjis", my_type: true, verified: true, status: "visited" } },
    { id: "2", kind: "target", data: { hood: "narjis", my_type: true, verified: true, status: "new" } },
    { id: "3", kind: "target", data: { hood: "narjis", my_type: false, verified: true, status: "new" } },
    { id: "4", kind: "scan", data: { hood: "narjis", scan_date: "2026-10-06" } }, prop({ id: "p" }), prop({ id: "q", owner_phone: "" })];
  const o = objectives("narjis", items, { pct: 42.4 }, { streetsPct: 90, phones: 2 });
  assert.equal(o.length, 3); assert.deepEqual(o.map(x => x.id), ["streets", "targets", "phones"]);
  assert.equal(o[1].done, 1); assert.equal(o[1].total, 2); assert.equal(o[2].done, 1); assert.equal(o.completed, false);
  const done = objectives("narjis", [...items.filter(i => i.id !== "2"), { id: "2", kind: "target", data: { hood: "narjis", my_type: true, verified: true, status: "ignored" } }], { pct: 95 }, { streetsPct: 90, phones: 1 });
  assert.equal(done.completed, true);
  const sc = scoutSummary(items, "narjis"); assert.equal(sc.total, 3); assert.equal(sc.my_type, 2); assert.equal(sc.visited, 1); assert.equal(sc.remaining, 1);
});
test("follow-ups due today and overdue; sold and refused excluded", () => {
  const now = new Date("2026-10-13T08:00:00Z");
  const items = [prop({ id: "a", next_followup: "2026-10-13" }), prop({ id: "b", next_followup: "2026-10-01" }), prop({ id: "c", next_followup: "2026-10-20" }), prop({ id: "d", next_followup: "2026-10-01", status: "sold" })];
  const due = dueFollowups(items, now);
  assert.deepEqual(due.map(x => x.item.id), ["b", "a"]); assert.equal(due[0].overdue, true); assert.equal(due[1].overdue, false);
});
test("Excel import understands the old tracker's columns, Arabic digits and map links", () => {
  const rows = [{ "الكود": "R-7", "الحي": "الملقا", "النوع": "عمارة", "الحالة": "وافق مبدئياً", "المساحة": "٩٠٠", "الغرف": "12", "السعر": "4,500,000", "قابل للتفاوض": "نعم", "جدية المالك": "عالية", "سبب البيع": "سفر", "حالة الصك": "مرهون", "أقل سعر متوقع": "٤٢٠٠٠٠٠", "صفة جهة الاتصال": "مطور فرد", "الاسم": "أبو سعد", "الجوال": "٠٥٥١١١٢٢٢٢", "عند مكاتب ثانية": "لا", "حالة المتابعة": "تم التواصل", "المتابعة القادمة": "2026-10-20", "الموقع": "https://maps.google.com/?q=24.8012,46.6003", "ملاحظات": "x" }, { "الحي": "" }];
  const out = importProperties(rows);
  assert.equal(out.length, 1); const d = out[0];
  assert.equal(d.code, "R-7"); assert.equal(d.hood, "malqa"); assert.equal(d.type, "building"); assert.equal(d.status, "contacted"); assert.equal(d.owner_phone, "0551112222");
  assert.equal(d.area, "900"); assert.equal(d.floor_price, "4200000"); assert.equal(d.negotiable, "yes"); assert.equal(d.listed_elsewhere, "no"); assert.equal(d.seriousness, "high"); assert.equal(d.deed, "mortgaged"); assert.equal(d.contact_role, "developer");
  assert.equal(d.lat, 24.8012); assert.equal(d.lon, 46.6003); assert.equal(d.next_followup, "2026-10-20");
});
test("ten call scripts carry the broker details, accept overrides; owner WhatsApp has my name and district only", () => {
  const b = { name: "رائد", license: "123", office: "النخبة", phone: "0500" };
  const s = callScripts(b, { follow_up: "نص مخصص" });
  assert.equal(Object.keys(s).length, 10); assert.deepEqual(Object.keys(SCRIPT_TITLES), Object.keys(s));
  assert.ok(s.owner_call.includes("رائد") && s.owner_call.includes("123") && s.contract_request.includes("0500")); assert.equal(s.follow_up, "نص مخصص");
  const w = ownerWhatsapp(b, "النرجس"); assert.ok(w.includes("رائد") && w.includes("النرجس") && !w.includes("أبو"));
});
test("district ranking, street fading, digit normalisation and property codes", () => {
  const items = [{ id: "1", kind: "target", data: { hood: "malaz", my_type: true, verified: true } }, prop({ id: "p", hood: "narjis" })];
  const r = districtRanking(items, { narjis: { ar: "النرجس" }, malaz: { ar: "الملز" } }, { narjis: 50 });
  assert.equal(r[0].hood, "narjis"); assert.equal(r[1].myType, 1);
  const now = new Date("2026-10-13T00:00:00Z");
  assert.equal(isFaded("2026-08-01T00:00:00Z", now), true); assert.equal(isFaded("2026-09-01T00:00:00Z", now), false); assert.equal(isFaded(null, now), false);
  assert.equal(normalizeDigits("٠٥٥١٢٣٤٥٦٧"), "0551234567"); assert.equal(normalizeDigits("۱۲۳"), "123");
  assert.equal(nextCode([]), "R-1"); assert.equal(nextCode([prop({ code: "R-3" }), prop({ id: "x", code: "R-10" }), { data: {} }]), "R-11");
});
