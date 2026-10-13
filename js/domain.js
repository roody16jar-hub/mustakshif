// Business rules, pure and unit-tested (tests/domain.test.mjs): matching, price check,
// office report privacy, weekly stats, district ranking, objectives, follow-ups, Excel mapping.
export const MY_TYPES = new Set(["single", "small_dev"]);
export const HOODS = { narjis: "النرجس", arid: "العارض", qairawan: "القيروان", yasmin: "الياسمين", malaz: "الملز", malqa: "الملقا" };
export const PROPERTY_TYPES = { villa: "فيلا", building: "عمارة", land: "أرض", duplex: "دوبلكس", floor: "دور", apartment: "شقة", other: "أخرى" };
export const PROPERTY_STATUS = { new: "جديد", contacted: "تم التواصل", listed: "مدرج", handed: "سُلّم للمكتب", closed: "مغلق", ignored: "تجاهل" };
export const TARGET_STATUS = { new: "جديد", visited: "تمت الزيارة", ignored: "تجاهل" };
export const CONTACT_OUTCOME = { no_answer: "لا رد", interested: "مهتم", not_selling: "غير بائع", follow_up: "متابعة لاحقاً", deal: "اتفاق", wrong: "رقم خاطئ" };
export const FORBIDDEN_IN_OFFICE_REPORT = ["owner_name", "owner_phone", "floor_price"];

const day = (iso) => (iso || "").slice(0, 10);
export const todayIso = (now = new Date()) => new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, "")); return isFinite(n) ? n : null; };
const live = (items) => items.filter(i => !i.deleted);
const byKind = (items, kind) => live(items).filter(i => i.kind === kind);

// ---------------- buyer requests → matching properties ----------------
export function matchRequest(request, properties) {
  const r = request.data || request;
  const out = [];
  for (const p of properties) {
    const d = p.data || p;
    if (["closed", "ignored"].includes(d.status)) continue;
    let score = 0; const why = [];
    if (r.hood && d.hood === r.hood) { score += 30; why.push("نفس الحي"); } else if (r.hood) continue;
    if (r.type && d.type === r.type) { score += 30; why.push("نفس النوع"); } else if (r.type) { score -= 10; }
    const price = num(d.price), bmin = num(r.budget_min), bmax = num(r.budget_max);
    if (price != null && (bmin != null || bmax != null)) {
      if ((bmin == null || price >= bmin) && (bmax == null || price <= bmax)) { score += 30; why.push("ضمن الميزانية"); }
      else if (bmax != null && price <= bmax * 1.1) { score += 12; why.push("أعلى من الميزانية بقليل"); }
      else continue;
    }
    const area = num(d.area), amin = num(r.area_min);
    if (amin != null && area != null) { if (area >= amin) { score += 10; why.push("المساحة كافية"); } else continue; }
    if (score >= 40) out.push({ property: p, score, why });
  }
  return out.sort((a, b) => b.score - a.score);
}
export function matchAll(requests, properties) {
  return requests.filter(r => (r.data || r).status !== "closed").map(r => ({ request: r, matches: matchRequest(r, properties) }));
}

// ---------------- price check vs district averages the broker enters ----------------
export function priceCheck(property, averages) {
  const d = property.data || property;
  const price = num(d.price), area = num(d.area);
  if (price == null || area == null || area <= 0) return { verdict: "unknown", reason: "يلزم السعر والمساحة" };
  const ppm2 = price / area;
  const avgs = averages.map(a => a.data || a).filter(a => a.hood === d.hood && num(a.price_per_m2) != null);
  let avg = avgs.find(a => a.type === d.type) || avgs.find(a => !a.type || a.type === "any");
  if (!avg && avgs.length) avg = { price_per_m2: avgs.reduce((s, a) => s + num(a.price_per_m2), 0) / avgs.length, type: "mixed" };
  if (!avg) return { verdict: "unknown", ppm2, reason: "لم تُدخل متوسط هذا الحي بعد" };
  const a = num(avg.price_per_m2); const diffPct = Math.round((ppm2 - a) / a * 100);
  const verdict = diffPct < -8 ? "below" : diffPct > 8 ? "above" : "fair";
  return { verdict, ppm2: Math.round(ppm2), avg: Math.round(a), diffPct, basis: avg.type === d.type ? "نوعه" : "متوسط الحي" };
}
export const PRICE_VERDICT = { below: "أقل من المتوسط", fair: "قريب من المتوسط", above: "أعلى من المتوسط", unknown: "لا يوجد متوسط" };

// ---------------- office handover: never leak owner data ----------------
const PHONE_RE = /(?:\+?966|0)[\s-]?5(?:[\s-]?\d){8}|\+\d{9,14}/g;   // Saudi mobiles in any spacing, or any international number
export function stripPhones(text) { return String(text || "").replace(PHONE_RE, "[رقم محذوف]"); }
export function sanitizeForOffice(property) {
  const src = property.data || property; const d = { ...src };
  const secrets = FORBIDDEN_IN_OFFICE_REPORT.map(k => String(src[k] || "").trim()).filter(v => v.length >= 3);
  for (const k of FORBIDDEN_IN_OFFICE_REPORT) delete d[k];
  for (const k of Object.keys(d)) {
    if (typeof d[k] !== "string") continue;
    let v = stripPhones(d[k]);
    for (const sec of secrets) v = v.split(sec).join("[محذوف]");
    d[k] = v;
  }
  return d;
}
export function handoverText(properties, broker = {}, opts = {}) {
  const date = opts.date || todayIso();
  const head = [`تسليم عقارات للمكتب — ${date}`, `الوسيط: ${broker.name || "—"}${broker.license ? " · رخصة " + broker.license : ""}${broker.phone ? " · " + broker.phone : ""}${broker.office ? " · " + broker.office : ""}`, ""];
  const body = properties.map((p, i) => {
    const d = sanitizeForOffice(p);
    const lines = [`${i + 1}) ${HOODS[d.hood] || d.hood || ""} · ${PROPERTY_TYPES[d.type] || d.type || "عقار"}${d.title ? " · " + d.title : ""}`];
    if (d.area) lines.push(`   المساحة: ${d.area} م²`);
    if (d.price) lines.push(`   السعر المطلوب: ${d.price}`);
    if (d.phase) lines.push(`   المرحلة: ${d.phase}`);
    if (d.lat != null && d.lon != null) lines.push(`   الموقع: https://maps.google.com/?q=${d.lat},${d.lon}`);
    if (d.note) lines.push(`   ملاحظة: ${d.note}`);
    return lines.join("\n");
  });
  return [...head, ...body, "", "تم التحقق: لا يحوي التقرير اسم المالك ولا جواله ولا السعر الأدنى."].join("\n");
}
/** throws if any forbidden value appears in the generated text (the policy test) */
export function assertOfficeSafe(text, properties, broker = {}) {
  for (const p of properties) {
    const d = p.data || p;
    for (const k of FORBIDDEN_IN_OFFICE_REPORT) { const v = String(d[k] || "").trim(); if (v.length >= 3 && text.includes(v)) throw new Error(`office report leaks ${k}`); }
  }
  let body = text.replace(/https:\/\/maps\.google\.com\/\?q=[-\d.,]+/g, "");
  for (const v of [broker.phone, broker.license]) if (v) body = body.split(String(v)).join("");   // the broker's own numbers are allowed
  if (new RegExp(PHONE_RE.source).test(body)) throw new Error("office report contains a phone number");
  return true;
}
export function handoverRows(properties) {
  return properties.map(p => { const d = sanitizeForOffice(p); return { "الحي": HOODS[d.hood] || d.hood || "", "النوع": PROPERTY_TYPES[d.type] || d.type || "", "العنوان": d.title || "", "المساحة م²": d.area || "", "السعر المطلوب": d.price || "", "المرحلة": d.phase || "", "الموقع": d.lat != null ? `https://maps.google.com/?q=${d.lat},${d.lon}` : "", "ملاحظة": d.note || "" }; });
}

// ---------------- weekly stats and conversion ----------------
export function weeklyStats(items, now = new Date()) {
  const t = now.getTime(), wk = 7 * 86400000;
  const inWin = (iso, from, to) => { const x = Date.parse(iso || ""); return x >= from && x < to; };
  const count = (kind, from, to, field = "created_at", pred = () => true) => byKind(items, kind).filter(i => pred(i) && inWin(field === "created_at" ? i.created_at : (i.data || {})[field], from, to)).length;
  const win = (from, to) => ({
    properties: count("property", from, to),
    contacts: count("contact", from, to),
    signs: count("sign", from, to),
    visited: count("target", from, to, "visited_at"),
    handovers: count("handover", from, to),
    sessions: count("session", from, to),
    km: byKind(items, "session").filter(i => inWin(i.created_at, from, to)).reduce((s, i) => s + (num((i.data || {}).km) || 0), 0),
  });
  const thisWeek = win(t - wk, t + 1), lastWeek = win(t - 2 * wk, t - wk);
  const props = byKind(items, "property");
  const contacted = props.filter(p => ["contacted", "listed", "handed", "closed"].includes(p.data.status)).length;
  const listed = props.filter(p => ["listed", "handed", "closed"].includes(p.data.status)).length;
  const handed = props.filter(p => ["handed", "closed"].includes(p.data.status)).length;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  return { thisWeek, lastWeek, funnel: { total: props.length, contacted, listed, handed }, conversion: { contacted: pct(contacted, props.length), listed: pct(listed, contacted), handed: pct(handed, listed) } };
}

// ---------------- district ranking ----------------
export function districtRanking(items, hoods, exploredPct = {}) {
  const targets = byKind(items, "target"), props = byKind(items, "property");
  return Object.keys(hoods).filter(h => !h.startsWith("_")).map(h => {
    const tg = targets.filter(t => t.data.hood === h), my = tg.filter(t => t.data.my_type && t.data.verified);
    const visited = my.filter(t => t.data.status === "visited").length;
    const p = props.filter(x => x.data.hood === h);
    const score = my.length * 3 + p.length * 2 + Math.round((exploredPct[h] || 0) / 10);
    return { hood: h, ar: hoods[h].ar || hoods[h], targets: tg.length, myType: my.length, visited, remaining: my.length - visited, properties: p.length, explored: exploredPct[h] || 0, score };
  }).sort((a, b) => b.score - a.score);
}

// ---------------- district objectives ----------------
export function objectives(hood, items, coverage) {
  const my = byKind(items, "target").filter(t => t.data.hood === hood && t.data.my_type && t.data.verified);
  const visited = my.filter(t => t.data.status === "visited").length;
  const props = byKind(items, "property").filter(p => p.data.hood === hood).length;
  const signs = byKind(items, "sign").filter(p => p.data.hood === hood).length;
  const contacts = byKind(items, "contact").filter(c => c.data.hood === hood).length;
  const o = (id, title, done, total) => ({ id, title, done: Math.min(done, total), total, pct: total ? Math.min(100, Math.round(done / total * 100)) : 0 });
  return [
    o("streets", "استكشاف كل شوارع الحي", Math.round(coverage?.pct || 0), 100),
    o("targets", "زيارة الأهداف الموثّقة من نوعي", visited, my.length || 1),
    o("properties", "تسجيل 10 عقارات من الميدان", props, 10),
    o("signs", "تصوير 5 لوحات", signs, 5),
    o("contacts", "10 اتصالات مسجّلة", contacts, 10),
  ];
}

// ---------------- follow-ups, today, scout summary, fading ----------------
export function dueFollowups(items, now = new Date()) {
  const today = todayIso(now);
  const rows = [];
  for (const i of live(items)) {
    const f = i.data && i.data.next_followup;
    if (!f) continue;
    if (["property", "target", "contact", "request", "sign"].includes(i.kind) && day(f) <= today && !["closed", "ignored", "done"].includes(i.data.status))
      rows.push({ item: i, date: day(f), overdue: day(f) < today });
  }
  return rows.sort((a, b) => a.date < b.date ? -1 : 1);
}
export function todayTargets(items, hood, n = 5) {
  return byKind(items, "target").filter(t => t.data.hood === hood && t.data.verified && t.data.my_type && (t.data.status || "new") === "new")
    .sort((a, b) => (b.data.score || 0) - (a.data.score || 0)).slice(0, n);
}
export function scoutSummary(items, hood) {
  const scan = byKind(items, "scan").find(s => s.data.hood === hood);
  const tg = byKind(items, "target").filter(t => t.data.hood === hood);
  const my = tg.filter(t => t.data.my_type), verified = tg.filter(t => t.data.verified);
  const visited = tg.filter(t => t.data.status === "visited").length;
  const myVerified = my.filter(t => t.data.verified);
  return { hood, scan_date: scan?.data.scan_date || tg[0]?.data.scan_date || null, total: tg.length, verified: verified.length, my_type: my.length, visited, remaining: myVerified.filter(t => (t.data.status || "new") === "new").length, ignored: tg.filter(t => t.data.status === "ignored").length };
}
export function isFaded(exploredAt, now = new Date(), days = 60) {
  const t = Date.parse(exploredAt || ""); return isFinite(t) && (now.getTime() - t) > days * 86400000;
}
export function sessionSummary(s) {
  const d = s.data || s; const min = Math.round((d.duration_s || 0) / 60);
  return `${min} دقيقة · ${(d.km || 0).toFixed ? (d.km || 0).toFixed(1) : d.km} كم · ${d.streets_new || 0} شارع جديد · ${d.targets_near || 0} هدف قربك · ${d.properties_added || 0} عقار${d.signs_added ? " · " + d.signs_added + " لوحة" : ""}`;
}

// ---------------- call scripts with the broker's details ----------------
export function callScripts(broker = {}, overrides = {}) {
  const b = { name: broker.name || "…", license: broker.license || "…", office: broker.office || "…", phone: broker.phone || "…" };
  const def = {
    owner_site: `السلام عليكم، أنا ${b.name} وسيط عقاري مرخّص (رخصة ${b.license}) من ${b.office}. شفت البناء الجديد عندكم وحبيت أسأل: هل العقار للبيع أو للتأجير بعد الاكتمال؟ أقدر أساعدكم بتسويقه بدون أي تكلفة مقدمة. رقمي ${b.phone}.`,
    sign_call: `السلام عليكم، أنا ${b.name} وسيط مرخّص من ${b.office}. اتصلت بخصوص اللوحة على العقار في الحي. هل العقار ما زال متاحاً؟ وما السعر المطلوب والمساحة؟ عندي مشترين جاهزين في هذا الحي.`,
    contractor: `السلام عليكم، أنا ${b.name} وسيط عقاري من ${b.office}. أشوف مشاريعكم في الحي ممتازة. إذا عندكم وحدات جاهزة أو قريبة من التسليم، أقدر أجيب لكم مشترين جادين. ممكن نتواصل؟ رقمي ${b.phone}.`,
    buyer_update: `السلام عليكم، ${b.name} من ${b.office}. عندي عقار يطابق طلبك: (الحي، النوع، المساحة، السعر). تحب نرتّب معاينة؟`,
  };
  return { ...def, ...Object.fromEntries(Object.entries(overrides || {}).filter(([, v]) => v)) };
}
export const SCRIPT_TITLES = { owner_site: "مالك في موقع البناء", sign_call: "اتصال على لوحة", contractor: "مقاول أو مطوّر", buyer_update: "تحديث لمشترٍ" };

// ---------------- Excel: export everything, import from the old tracker ----------------
export function exportSheets(items) {
  const g = (k) => byKind(items, k);
  const P = g("property").map(p => ({ "الحي": HOODS[p.data.hood] || p.data.hood || "", "النوع": PROPERTY_TYPES[p.data.type] || p.data.type || "", "العنوان": p.data.title || "", "الحالة": PROPERTY_STATUS[p.data.status] || p.data.status || "", "المساحة م²": p.data.area || "", "السعر المطلوب": p.data.price || "", "السعر الأدنى": p.data.floor_price || "", "اسم المالك": p.data.owner_name || "", "جوال المالك": p.data.owner_phone || "", "المرحلة": p.data.phase || "", "تاريخ المتابعة": p.data.next_followup || "", "ملاحظات": p.data.note || "", "خط العرض": p.data.lat ?? "", "خط الطول": p.data.lon ?? "", "تاريخ الإضافة": day(p.created_at), "المعرّف": p.id }));
  const T = g("target").map(t => ({ "الحي": HOODS[t.data.hood] || t.data.hood || "", "المعرّف": t.data.ref || "", "الحالة": TARGET_STATUS[t.data.status] || t.data.status || "", "الدرجة": t.data.score ?? "", "موثّق": t.data.verified ? "نعم" : "لا", "من نوعي": t.data.my_type ? "نعم" : "لا", "النوع": t.data.kind_label || "", "المرحلة": t.data.phase || "", "المساحة": t.data.area ?? "", "الأولوية": t.data.priority || "", "اسم المالك": t.data.owner_name || "", "جوال المالك": t.data.owner_phone || "", "ملاحظات": t.data.note || "", "خط العرض": t.data.lat ?? "", "خط الطول": t.data.lon ?? "" }));
  const S = g("sign").map(s => ({ "الحي": HOODS[s.data.hood] || s.data.hood || "", "الجوال على اللوحة": s.data.phone || "", "النص": s.data.text || "", "الحالة": s.data.status || "", "ملاحظات": s.data.note || "", "خط العرض": s.data.lat ?? "", "خط الطول": s.data.lon ?? "", "التاريخ": day(s.created_at) }));
  const C = g("contact").map(c => ({ "التاريخ": day(c.data.at || c.created_at), "النوع": c.data.ref_kind || "", "المرجع": c.data.ref_title || c.data.ref_id || "", "القناة": c.data.channel || "", "النتيجة": CONTACT_OUTCOME[c.data.outcome] || c.data.outcome || "", "المتابعة": c.data.next_followup || "", "ملاحظات": c.data.note || "" }));
  const Rq = g("request").map(r => ({ "المشتري": r.data.buyer_name || "", "الجوال": r.data.buyer_phone || "", "الحي": HOODS[r.data.hood] || r.data.hood || "", "النوع": PROPERTY_TYPES[r.data.type] || r.data.type || "", "الميزانية من": r.data.budget_min || "", "الميزانية إلى": r.data.budget_max || "", "أقل مساحة": r.data.area_min || "", "الحالة": r.data.status || "", "ملاحظات": r.data.note || "" }));
  const Co = g("contractor").map(c => ({ "الاسم": c.data.name || "", "الجوال": c.data.phone || "", "التخصص": c.data.specialty || "", "الأحياء": c.data.hoods || "", "ملاحظات": c.data.note || "" }));
  const Av = g("price_avg").map(a => ({ "الحي": HOODS[a.data.hood] || a.data.hood || "", "النوع": PROPERTY_TYPES[a.data.type] || a.data.type || "الكل", "متوسط سعر المتر": a.data.price_per_m2 || "" }));
  const H = g("handover").map(h => ({ "التاريخ": day(h.data.at || h.created_at), "إلى": h.data.to || "", "عدد العقارات": (h.data.property_ids || []).length, "النص": h.data.text || "" }));
  const Se = g("session").map(s => ({ "التاريخ": day(s.created_at), "الحي": HOODS[s.data.hood] || s.data.hood || "", "الدقائق": Math.round((s.data.duration_s || 0) / 60), "كم": s.data.km || 0, "شوارع جديدة": s.data.streets_new || 0, "أهداف قربي": s.data.targets_near || 0, "عقارات": s.data.properties_added || 0 }));
  return { "العقارات": P, "الأهداف": T, "اللوحات": S, "سجل الاتصال": C, "طلبات المشترين": Rq, "المقاولون": Co, "متوسطات الأحياء": Av, "تسليم المكتب": H, "الجولات": Se };
}
const HEADER_MAP = [
  ["title", /^(العنوان|الاسم|اسم العقار|الوصف|name|title)$/i], ["hood", /^(الحي|الحى|district|hood)$/i], ["type", /^(النوع|type)$/i],
  ["status", /^(الحالة|status)$/i], ["area", /^(المساحة.*|area)$/i], ["price", /^(السعر|السعر المطلوب|price)$/i], ["floor_price", /^(السعر الأدنى|الحد الأدنى|floor)$/i],
  ["owner_name", /^(اسم المالك|المالك|owner)$/i], ["owner_phone", /^(جوال المالك|الجوال|رقم المالك|phone|mobile)$/i], ["phase", /^(المرحلة|phase)$/i],
  ["next_followup", /^(تاريخ المتابعة|المتابعة|follow.?up)$/i], ["note", /^(ملاحظات|ملاحظة|notes?)$/i], ["lat", /^(خط العرض|lat|latitude)$/i], ["lon", /^(خط الطول|lon|lng|longitude)$/i],
];
const HOOD_BY_AR = Object.fromEntries(Object.entries(HOODS).map(([k, v]) => [v, k]));
const TYPE_BY_AR = Object.fromEntries(Object.entries(PROPERTY_TYPES).map(([k, v]) => [v, k]));
const STATUS_BY_AR = Object.fromEntries(Object.entries(PROPERTY_STATUS).map(([k, v]) => [v, k]));
/** rows = array of objects keyed by header text (as SheetJS sheet_to_json gives). Returns property data objects. */
export function importProperties(rows) {
  const out = [];
  for (const row of rows) {
    const d = {};
    for (const [h, v] of Object.entries(row)) {
      const key = String(h).trim(); const m = HEADER_MAP.find(([, re]) => re.test(key)); if (!m) continue;
      let val = typeof v === "string" ? v.trim() : v; if (val === "" || val == null) continue;
      d[m[0]] = val;
    }
    if (!d.title && !d.owner_phone && !d.lat && !d.note) continue;
    if (d.hood) d.hood = HOOD_BY_AR[d.hood] || (HOODS[d.hood] ? d.hood : Object.keys(HOODS).find(k => String(d.hood).includes(HOODS[k])) || d.hood);
    if (d.type) d.type = TYPE_BY_AR[d.type] || (PROPERTY_TYPES[d.type] ? d.type : "other");
    if (d.status) d.status = STATUS_BY_AR[d.status] || (PROPERTY_STATUS[d.status] ? d.status : "new");
    if (d.lat != null) d.lat = num(d.lat); if (d.lon != null) d.lon = num(d.lon);
    if (d.next_followup instanceof Date) d.next_followup = d.next_followup.toISOString().slice(0, 10);
    out.push({ title: d.title || "عقار مستورد", status: "new", source: "import", photos: [], ...d });
  }
  return out;
}
