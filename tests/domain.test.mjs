import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRequest, priceCheck, handoverText, assertOfficeSafe, sanitizeForOffice, handoverRows, weeklyStats, objectives, dueFollowups, importProperties, callScripts, districtRanking, isFaded, scoutSummary } from "../js/domain.js";

const prop = (over = {}) => ({ id: over.id || "p1", kind: "property", created_at: "2026-10-12T10:00:00Z", data: { title: "فيلا شارع 12", hood: "narjis", type: "villa", price: "2500000", area: "400", owner_name: "أبو خالد", owner_phone: "0551234567", floor_price: "2300000", note: "المالك جاد، جواله 0551234567", status: "listed", lat: 24.87, lon: 46.64, ...over } });

test("matching: hood + type + budget + area give a strong match, wrong hood is excluded", () => {
  const req = { data: { hood: "narjis", type: "villa", budget_min: "2000000", budget_max: "2600000", area_min: "350", status: "open" } };
  const props = [prop(), prop({ id: "p2", hood: "malaz" }), prop({ id: "p3", price: "3500000" }), prop({ id: "p4", area: "300" })];
  const m = matchRequest(req, props);
  assert.deepEqual(m.map(x => x.property.id), ["p1"]);
  assert.ok(m[0].score >= 90 && m[0].why.includes("ضمن الميزانية"));
});
test("matching: slightly over budget still appears with a lower score", () => {
  const req = { data: { hood: "narjis", budget_max: "2400000" } };
  const m = matchRequest(req, [prop({ price: "2600000" })]);
  assert.equal(m.length, 1); assert.ok(m[0].score < 90);
});
test("price check: below / fair / above against the district average", () => {
  const avgs = [{ data: { hood: "narjis", type: "villa", price_per_m2: "6000" } }];
  assert.equal(priceCheck(prop({ price: "2000000", area: "400" }), avgs).verdict, "below");   // 5000/m2 = -17%
  assert.equal(priceCheck(prop({ price: "2450000", area: "400" }), avgs).verdict, "fair");
  assert.equal(priceCheck(prop({ price: "3000000", area: "400" }), avgs).verdict, "above");
  assert.equal(priceCheck(prop({ hood: "malaz" }), avgs).verdict, "unknown");
  assert.equal(priceCheck(prop({ price: "" }), avgs).verdict, "unknown");
});
test("office report never contains owner name, phone or floor price (also inside notes)", () => {
  const ps = [prop(), prop({ id: "p2", owner_name: "سعد", owner_phone: "+966 55 987 6543", floor_price: "1900000", note: "يقبل 1900000 اتصل 0559876543" })];
  const broker = { name: "رائد", license: "12345", phone: "0500000000", office: "مكتب النخبة" };
  const text = handoverText(ps, broker);
  assert.ok(text.includes("رائد") && text.includes("النرجس") && text.includes("2500000"));
  for (const bad of ["أبو خالد", "0551234567", "2300000", "سعد", "9876543", "1900000"]) assert.ok(!text.includes(bad), "leaked: " + bad);
  assert.equal(assertOfficeSafe(text, ps, broker), true);
  assert.throws(() => assertOfficeSafe(text + " 0551234567", ps, broker));
  const s = sanitizeForOffice(ps[0]); assert.ok(!("owner_phone" in s) && !("floor_price" in s) && !("owner_name" in s));
  const rows = handoverRows(ps); assert.ok(!JSON.stringify(rows).includes("0551234567"));
});
test("weekly stats and conversion funnel", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const items = [prop({ id: "a" }), prop({ id: "b", status: "handed" }), { ...prop({ id: "c", status: "new" }), created_at: "2026-09-20T10:00:00Z" },
    { id: "k", kind: "contact", created_at: "2026-10-11T10:00:00Z", data: {} }, { id: "h", kind: "handover", created_at: "2026-10-12T10:00:00Z", data: { property_ids: ["b"] } },
    { id: "t", kind: "target", created_at: "2026-10-01T10:00:00Z", data: { status: "visited", visited_at: "2026-10-12T09:00:00Z" } }];
  const s = weeklyStats(items, now);
  assert.equal(s.thisWeek.properties, 2); assert.equal(s.thisWeek.contacts, 1); assert.equal(s.thisWeek.handovers, 1); assert.equal(s.thisWeek.visited, 1);
  assert.equal(s.funnel.total, 3); assert.equal(s.funnel.handed, 1); assert.equal(s.conversion.contacted, 67);
});
test("objectives and scout summary count only verified targets of my type", () => {
  const items = [
    { id: "1", kind: "target", data: { hood: "narjis", my_type: true, verified: true, status: "visited" } },
    { id: "2", kind: "target", data: { hood: "narjis", my_type: true, verified: true, status: "new" } },
    { id: "3", kind: "target", data: { hood: "narjis", my_type: false, verified: true, status: "new" } },
    { id: "4", kind: "scan", data: { hood: "narjis", scan_date: "2026-10-06" } }, prop({ id: "p" })];
  const o = objectives("narjis", items, { pct: 42.4 });
  assert.equal(o.find(x => x.id === "targets").done, 1); assert.equal(o.find(x => x.id === "targets").total, 2); assert.equal(o.find(x => x.id === "streets").done, 42);
  const sc = scoutSummary(items, "narjis");
  assert.equal(sc.total, 3); assert.equal(sc.my_type, 2); assert.equal(sc.visited, 1); assert.equal(sc.remaining, 1); assert.equal(sc.scan_date, "2026-10-06");
});
test("follow-ups due today and overdue, closed ones excluded", () => {
  const now = new Date("2026-10-13T08:00:00Z");
  const items = [prop({ id: "a", next_followup: "2026-10-13" }), prop({ id: "b", next_followup: "2026-10-01" }), prop({ id: "c", next_followup: "2026-10-20" }), prop({ id: "d", next_followup: "2026-10-01", status: "closed" })];
  const due = dueFollowups(items, now);
  assert.deepEqual(due.map(x => x.item.id), ["b", "a"]); assert.equal(due[0].overdue, true); assert.equal(due[1].overdue, false);
});
test("Excel import maps Arabic headers from the old tracker", () => {
  const rows = [{ "العنوان": "عمارة شارع الأمير", "الحي": "الملقا", "النوع": "عمارة", "السعر": "4,500,000", "المساحة م²": "900", "جوال المالك": "0551112222", "الحالة": "تم التواصل", "ملاحظات": "x" }, { "الحي": "" }];
  const out = importProperties(rows);
  assert.equal(out.length, 1); assert.equal(out[0].hood, "malqa"); assert.equal(out[0].type, "building"); assert.equal(out[0].status, "contacted"); assert.equal(out[0].owner_phone, "0551112222");
});
test("call scripts carry the broker details and accept overrides", () => {
  const s = callScripts({ name: "رائد", license: "123", office: "النخبة", phone: "0500" }, { sign_call: "نص مخصص" });
  assert.ok(s.owner_site.includes("رائد") && s.owner_site.includes("123")); assert.equal(s.sign_call, "نص مخصص");
});
test("district ranking orders by opportunity and street fading after 60 days", () => {
  const items = [{ id: "1", kind: "target", data: { hood: "malaz", my_type: true, verified: true } }, prop({ id: "p", hood: "narjis" })];
  const r = districtRanking(items, { narjis: { ar: "النرجس" }, malaz: { ar: "الملز" } }, { narjis: 50 });
  assert.equal(r[0].hood, "narjis"); assert.equal(r[1].myType, 1);
  const now = new Date("2026-10-13T00:00:00Z");
  assert.equal(isFaded("2026-08-01T00:00:00Z", now), true); assert.equal(isFaded("2026-09-01T00:00:00Z", now), false); assert.equal(isFaded(null, now), false);
});
