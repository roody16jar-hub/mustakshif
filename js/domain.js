// Business rules, pure and unit-tested (tests/domain.test.mjs): matching, price check,
// office report privacy, weekly stats, district ranking, objectives, follow-ups, Excel mapping.
export const MY_TYPES = new Set(["single", "small_dev"]);
export const HOODS = { narjis: "النرجس", arid: "العارض", qairawan: "القيروان", yasmin: "الياسمين", malaz: "الملز", malqa: "الملقا" };
export const PROPERTY_TYPES = { apartment: "شقة", villa: "فيلا", duplex: "دوبلكس", floor: "دور", building: "عمارة", land: "أرض", other: "أخرى" };
export const PROPERTY_STATUS = { new: "جديد", contacted: "تم التواصل", agreed: "وافق مبدئياً", contract: "عقد وساطة موقّع", handed: "أُرسل للمكتب", sold: "تم البيع", refused: "رفض" };
export const STATUS_ORDER = ["new", "contacted", "agreed", "contract", "handed", "sold", "refused"];
export const PROPERTY_AGE = { new: "جديد", building: "تحت الإنشاء", old: "قديم" };
export const CONTACT_ROLE = { owner: "مالك مباشر", developer: "مطور فرد", agent: "وكيل", broker: "وسيط آخر" };
export const SERIOUSNESS = { high: "عالية", mid: "متوسطة", low: "منخفضة" };
export const DEED_STATUS = { ready: "جاهز للإفراغ", mortgaged: "مرهون", notes: "عليه ملاحظات" };
export const YES_NO = { "": "—", yes: "نعم", no: "لا" };
/** Arabic-Indic and Persian digits -> Latin digits, for phones, prices and search */
export function normalizeDigits(s) { return String(s ?? "").replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0)); }
/** next property code: R-1, R-2 ... (never reuses a number) */
export function nextCode(items) { let max = 0; for (const i of items) { const m = /^R-(\d+)$/.exec((i.data || {}).code || ""); if (m) max = Math.max(max, +m[1]); } return "R-" + (max + 1); }
export const TARGET_STATUS = { new: "جديد", visited: "تمت الزيارة", ignored: "تجاهل" };
export const CONTACT_OUTCOME = { no_answer: "لا رد", interested: "مهتم", not_selling: "غير بائع", follow_up: "متابعة لاحقاً", deal: "اتفاق", wrong: "رقم خاطئ" };
export const FORBIDDEN_IN_OFFICE_REPORT = ["owner_name", "owner_phone", "floor_price"];

const day = (iso) => (iso || "").slice(0, 10);
export const todayIso = (now = new Date()) => new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const num = (v) => { const n = parseFloat(normalizeDigits(v).replace(/[^\d.]/g, "")); return isFinite(n) ? n : null; };
const live = (items) => items.filter(i => !i.deleted);
const byKind = (items, kind) => live(items).filter(i => i.kind === kind);

// ---------------- buyer requests → matching properties ----------------
export function matchRequest(request, properties) {
  const r = request.data || request;
  const out = [];
  for (const p of properties) {
    const d = p.data || p;
    if (["sold", "refused", "closed", "ignored"].includes(d.status)) continue;
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
/** the other direction: which open requests fit this property */
export function matchProperty(property, requests) {
  return requests.filter(r => (r.data || r).status !== "closed").map(r => { const m = matchRequest(r, [property]); return m.length ? { request: r, score: m[0].score, why: m[0].why } : null; }).filter(Boolean).sort((a, b) => b.score - a.score);
}

// ---------------- price check vs district averages the broker enters ----------------
export function priceCheck(property, averages) {
  const d = property.data || property;
  const price = num(d.price), area = num(d.area);
  if (price == null || area == null || area <= 0) return { verdict: "unknown", reason: "يلزم السعر والمساحة" };
  const ppm2 = price / area;
  const avgs = averages.map(a => a.data || a).filter(a => a.hood === d.hood && num(a.price_per_m2) != null).sort((x, y) => (y.date || "") > (x.date || "") ? 1 : -1);
  let avg = avgs.find(a => a.type === d.type) || avgs.find(a => !a.type || a.type === "any");
  if (!avg && avgs.length) avg = { price_per_m2: avgs.reduce((s, a) => s + num(a.price_per_m2), 0) / avgs.length, type: "mixed" };
  if (!avg) return { verdict: "unknown", ppm2, reason: "لم تُدخل متوسط هذا الحي بعد" };
  const a = num(avg.price_per_m2); const diffPct = Math.round((ppm2 - a) / a * 100);
  const verdict = diffPct < -8 ? "below" : diffPct > 8 ? "above" : "fair";
  return { verdict, ppm2: Math.round(ppm2), avg: Math.round(a), diffPct, basis: (avg.type === d.type ? "نوعه" : "متوسط الحي") + (avg.date ? " · " + avg.date : "") };
}
export const PRICE_VERDICT = { below: "سعر جيد (أقل من السوق)", fair: "سعر مناسب", above: "أعلى من السوق", unknown: "لا يوجد متوسط للمقارنة" };

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
  const date = opts.date || todayIso(); const withLocation = opts.location !== false;
  const head = [`تسليم عقارات للمكتب — ${date}`, `الوسيط: ${broker.name || "—"}${broker.license ? " · رخصة " + broker.license : ""}${broker.phone ? " · " + broker.phone : ""}${broker.office ? " · " + broker.office : ""}`, ""];
  const body = properties.map((p, i) => {
    const d = sanitizeForOffice(p);
    const lines = [`${i + 1}) ${d.code ? d.code + " · " : ""}${HOODS[d.hood] || d.hood || ""} · ${PROPERTY_TYPES[d.type] || d.type || "عقار"}${d.title ? " · " + d.title : ""}`];
    if (d.area) lines.push(`   المساحة: ${d.area} م²${d.rooms ? " · الغرف: " + d.rooms : ""}`);
    if (d.price) lines.push(`   السعر المطلوب: ${d.price}${d.negotiable === "yes" ? " (قابل للتفاوض)" : ""}`);
    if (d.age) lines.push(`   العمر: ${PROPERTY_AGE[d.age] || d.age}`);
    if (d.deed) lines.push(`   الصك: ${DEED_STATUS[d.deed] || d.deed}`);
    if (d.phase) lines.push(`   المرحلة: ${d.phase}`);
    if (withLocation && d.lat != null && d.lon != null) lines.push(`   الموقع: https://maps.google.com/?q=${d.lat},${d.lon}`);
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
export function handoverRows(properties, withLocation = true) {
  return properties.map(p => { const d = sanitizeForOffice(p); return { "الكود": d.code || "", "الحي": HOODS[d.hood] || d.hood || "", "النوع": PROPERTY_TYPES[d.type] || d.type || "", "الوصف": d.title || "", "العمر": PROPERTY_AGE[d.age] || "", "المساحة م²": d.area || "", "الغرف": d.rooms || "", "السعر المطلوب": d.price || "", "قابل للتفاوض": YES_NO[d.negotiable] || "", "الصك": DEED_STATUS[d.deed] || "", "المرحلة": d.phase || "", "الموقع": withLocation && d.lat != null ? `https://maps.google.com/?q=${d.lat},${d.lon}` : "", "ملاحظة": d.note || "" }; });
}

// ---------------- weekly stats and conversion ----------------
export function weeklyStats(items, now = new Date(), hood = null) {
  const t = now.getTime(), wk = 7 * 86400000;
  const inHood = (i) => !hood || (i.data || {}).hood === hood;
  const inWin = (iso, from, to) => { const x = Date.parse(iso || ""); return x >= from && x < to; };
  const rows = (kind, from, to, field = "created_at") => byKind(items, kind).filter(i => inHood(i) && inWin(field === "created_at" ? i.created_at : (i.data || {})[field], from, to));
  const reach = (s) => STATUS_ORDER.indexOf(s);
  const win = (from, to) => {
    const sessions = rows("session", from, to); const props = rows("property", from, to);
    return {
      minutes: Math.round(sessions.reduce((s, i) => s + (num(i.data.duration_s) || 0), 0) / 60),
      km: Math.round(sessions.reduce((s, i) => s + (num(i.data.km) || 0), 0) * 10) / 10,
      streets: sessions.reduce((s, i) => s + (num(i.data.streets_new) || 0), 0),
      properties: props.length,
      phones: props.filter(p => String(p.data.owner_phone || "").trim()).length,
      contacts: rows("contact", from, to).length,
      signs: rows("sign", from, to).length,
      visited: rows("target", from, to, "visited_at").length,
      agreed: props.filter(p => reach(p.data.status) >= reach("agreed") && p.data.status !== "refused").length,
      contracts: props.filter(p => reach(p.data.status) >= reach("contract") && p.data.status !== "refused").length,
      handovers: rows("handover", from, to).length,
      deals: props.filter(p => p.data.status === "sold").length,
      sessions: sessions.length,
    };
  };
  const thisWeek = win(t - wk, t + 1), lastWeek = win(t - 2 * wk, t - wk);
  const props = byKind(items, "property").filter(inHood);
  const f = { total: props.length, phones: props.filter(p => String(p.data.owner_phone || "").trim()).length, contacted: props.filter(p => reach(p.data.status) >= 1 && p.data.status !== "refused").length, agreed: props.filter(p => reach(p.data.status) >= 2 && p.data.status !== "refused").length, contracts: props.filter(p => reach(p.data.status) >= 3 && p.data.status !== "refused").length, handed: props.filter(p => reach(p.data.status) >= 4 && p.data.status !== "refused").length, sold: props.filter(p => p.data.status === "sold").length };
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  return { thisWeek, lastWeek, funnel: f, conversion: { phones: pct(f.phones, f.total), contacted: pct(f.contacted, f.phones), agreed: pct(f.agreed, f.contacted), contracts: pct(f.contracts, f.agreed), handed: pct(f.handed, f.contracts), sold: pct(f.sold, f.handed) } };
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
export function objectives(hood, items, coverage, goals = {}) {
  const streetsGoal = goals.streetsPct || 90, phonesGoal = goals.phones || 10;
  const my = byKind(items, "target").filter(t => t.data.hood === hood && t.data.my_type && t.data.verified);
  const visited = my.filter(t => ["visited", "ignored"].includes(t.data.status)).length;
  const phones = byKind(items, "property").filter(p => p.data.hood === hood && String(p.data.owner_phone || "").trim()).length;
  const o = (id, title, done, total, unit) => ({ id, title, done: Math.min(done, total), total, unit, pct: total ? Math.min(100, Math.round(done / total * 100)) : 0, reached: done >= total });
  const list = [
    o("streets", "استكشاف الشوارع", Math.round(coverage?.pct || 0), streetsGoal, "%"),
    o("targets", "زيارة الأهداف الموثّقة من نوعي", visited, my.length || 1, "هدف"),
    o("phones", "أرقام مالكين مجمّعة", phones, phonesGoal, "رقم"),
  ];
  list.completed = list.every(x => x.reached) && my.length > 0;
  return list;
}

// ---------------- follow-ups, today, scout summary, fading ----------------
export function dueFollowups(items, now = new Date()) {
  const today = todayIso(now);
  const rows = [];
  for (const i of live(items)) {
    const f = i.data && i.data.next_followup;
    if (!f) continue;
    if (["property", "target", "contact", "request", "sign"].includes(i.kind) && day(f) <= today && !["closed", "ignored", "done", "sold", "refused"].includes(i.data.status))
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
    owner_call: `السلام عليكم، معك ${b.name} وسيط عقاري مرخّص من الهيئة (فال ${b.license})، من ${b.office}. اتصلت بخصوص عقارك في الحي. هل ما زال للبيع؟ وما السعر والمساحة؟ عندي مشترين جادين في نفس الحي وأقدر أسوّقه لك بلا أي تكلفة مقدمة. رقمي ${b.phone}.`,
    developer_call: `السلام عليكم، أنا ${b.name} وسيط مرخّص (فال ${b.license}) من ${b.office}. شفت مشروعك الجديد في الحي، ماشاء الله. إذا عندك وحدات للبيع الآن أو عند التسليم، أقدر أجيب لك مشترين جادين وأتابع الصفقة حتى الإفراغ. متى يناسبك نلتقي بالموقع؟ رقمي ${b.phone}.`,
    first_whatsapp: `السلام عليكم، معك ${b.name} وسيط عقاري مرخّص (فال ${b.license}) من ${b.office}. تواصلت بخصوص العقار في حي (الحي). عندي مشترٍ جاد يبحث في نفس الحي. ممكن تفاصيل العقار: المساحة، السعر المطلوب، وحالة الصك؟ شكراً لك.`,
    follow_up: `السلام عليكم، ${b.name} من ${b.office}. أتابع معك بخصوص عقارك في (الحي). عرضته على مشترٍ وفيه اهتمام مبدئي. هل السعر الأخير ما زال (السعر)؟ وهل نقدر نحدد موعد معاينة هذا الأسبوع؟`,
    objection_no_brokers: `أقدّر وجهة نظرك. أنا ما آخذ منك شيئاً إلا إذا تمت الصفقة فعلاً، وبعقد وساطة رسمي موثّق في منصة إيجار يحفظ حقك. دوري أوفر لك مشترين جادين وأتعامل مع كل المكالمات غير الجادة بدلاً عنك.`,
    objection_commission: `العمولة 2.5% من قيمة الصفقة تُدفع فقط عند الإفراغ، ولا شيء قبلها. مقابلها: تسويق، تصفية المشترين، تفاوض يحقق لك سعراً أفضل، ومتابعة الإفراغ حتى النهاية. غالباً الفرق في السعر يغطي العمولة وأكثر.`,
    objection_listed_elsewhere: `ممتاز أنه معروض. أنا ما أطلب حصرية، أطلب فقط فرصة أعرضه على مشتريني. إذا جبت المشتري أنا، نوقّع عقد الوساطة حينها. ما تخسر شيئاً وتزيد فرص البيع.`,
    objection_send_buyer: `أكيد أجيب المشتري، لكن أحتاج أولاً تفاصيل العقار وصوراً حتى ما أضيّع وقتك بمعاينات غير مناسبة. عادةً أعرض على المشتري أولاً ثم أرتّب موعد المعاينة مع الجادين فقط.`,
    contract_request: `حتى أقدر أعرض عقارك رسمياً وأحفظ حقك وحقي، نوقّع عقد وساطة عقارية موثّق عبر منصة إيجار (مدته محدودة ويمكن إلغاؤه). أحتاج: صورة الصك، صورة الهوية، ورقم الجوال. أرسلها على ${b.phone} وأجهّز العقد خلال ساعة.`,
    office_message: `السلام عليكم، مرفق عقار جديد للتسويق: (الكود) · (الحي) · (النوع) · (المساحة) م² · السعر المطلوب (السعر). العقد موقّع معي. التواصل مع المالك عبري فقط. ${b.name} · ${b.phone}.`,
  };
  return { ...def, ...Object.fromEntries(Object.entries(overrides || {}).filter(([, v]) => v)) };
}
export const SCRIPT_TITLES = { owner_call: "اتصال بمالك", developer_call: "اتصال بمطوّر فرد", first_whatsapp: "أول رسالة واتساب", follow_up: "متابعة", objection_no_brokers: "اعتراض: ما أتعامل مع وسطاء", objection_commission: "اعتراض: العمولة", objection_listed_elsewhere: "اعتراض: معروض عند مكاتب ثانية", objection_send_buyer: "اعتراض: أرسل المشتري أولاً", contract_request: "طلب توقيع عقد الوساطة", office_message: "رسالة للمكتب" };
/** first WhatsApp message to an owner: my name + district, nothing about the owner */
export function ownerWhatsapp(broker = {}, hoodAr = "") { return `السلام عليكم، معك ${broker.name || "…"} وسيط عقاري مرخّص${broker.license ? " (فال " + broker.license + ")" : ""}${broker.office ? " من " + broker.office : ""}. تواصلت بخصوص عقارك في حي ${hoodAr || "…"}. عندي مشترٍ جاد في نفس الحي. هل العقار ما زال متاحاً؟`; }

// ---------------- Excel: export everything, import from the old tracker ----------------
export function exportSheets(items) {
  const g = (k) => byKind(items, k);
  const P = g("property").map(p => ({ "الكود": p.data.code || "", "الحي": HOODS[p.data.hood] || p.data.hood || "", "النوع": PROPERTY_TYPES[p.data.type] || p.data.type || "", "العمر": PROPERTY_AGE[p.data.age] || "", "الوصف": p.data.title || "", "حالة المتابعة": PROPERTY_STATUS[p.data.status] || p.data.status || "", "المساحة": p.data.area || "", "الغرف": p.data.rooms || "", "السعر": p.data.price || "", "قابل للتفاوض": YES_NO[p.data.negotiable] || "", "أقل سعر متوقع": p.data.floor_price || "", "صفة جهة الاتصال": CONTACT_ROLE[p.data.contact_role] || "", "الاسم": p.data.owner_name || "", "الجوال": p.data.owner_phone || "", "عند مكاتب ثانية": YES_NO[p.data.listed_elsewhere] || "", "جدية المالك": SERIOUSNESS[p.data.seriousness] || "", "حالة الصك": DEED_STATUS[p.data.deed] || "", "سبب البيع": p.data.sale_reason || "", "المرحلة": p.data.phase || "", "المتابعة القادمة": p.data.next_followup || "", "الموقع": p.data.lat != null ? `https://maps.google.com/?q=${p.data.lat},${p.data.lon}` : "", "ملاحظات": p.data.note || "", "تاريخ الإضافة": day(p.created_at), "المعرّف": p.id }));
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
  ["code", /^(الكود|الرمز|code)$/i], ["title", /^(العنوان|اسم العقار|الوصف|وصف|name|title)$/i], ["hood", /^(الحي|الحى|district|hood)$/i], ["type", /^(النوع|type)$/i],
  ["status", /^(الحالة|حالة المتابعة|status)$/i], ["area", /^(المساحة.*|area)$/i], ["rooms", /^(الغرف|عدد الغرف|rooms)$/i], ["price", /^(السعر|السعر المطلوب|price)$/i], ["negotiable", /^(قابل للتفاوض|تفاوض)$/i],
  ["seriousness", /^(جدية المالك|الجدية)$/i], ["sale_reason", /^(سبب البيع)$/i], ["deed", /^(حالة الصك|الصك)$/i], ["floor_price", /^(أقل سعر متوقع|السعر الأدنى|الحد الأدنى|floor)$/i], ["contact_role", /^(صفة جهة الاتصال|الصفة)$/i],
  ["owner_name", /^(اسم المالك|المالك|الاسم|owner)$/i], ["owner_phone", /^(جوال المالك|الجوال|رقم المالك|رقم الجوال|phone|mobile)$/i], ["listed_elsewhere", /^(عند مكاتب ثانية|مكاتب أخرى)$/i], ["phase", /^(المرحلة|phase)$/i],
  ["next_followup", /^(تاريخ المتابعة|المتابعة القادمة|المتابعة|follow.?up)$/i], ["note", /^(ملاحظات|ملاحظة|notes?)$/i], ["location", /^(الموقع|رابط الموقع|location|map)$/i], ["lat", /^(خط العرض|lat|latitude)$/i], ["lon", /^(خط الطول|lon|lng|longitude)$/i],
];
const AGE_BY_AR = Object.fromEntries(Object.entries(PROPERTY_AGE).map(([k, v]) => [v, k]));
const ROLE_BY_AR = Object.fromEntries(Object.entries(CONTACT_ROLE).map(([k, v]) => [v, k]));
const SER_BY_AR = Object.fromEntries(Object.entries(SERIOUSNESS).map(([k, v]) => [v, k]));
const DEED_BY_AR = Object.fromEntries(Object.entries(DEED_STATUS).map(([k, v]) => [v, k]));
const yesNo = (v) => /^(نعم|yes|y|true|1|✓)$/i.test(String(v).trim()) ? "yes" : /^(لا|no|n|false|0)$/i.test(String(v).trim()) ? "no" : "";
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
    if (!d.title && !d.owner_phone && !d.lat && !d.note && !d.code && !d.location) continue;
    if (d.location) { const m = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/.exec(String(d.location)); if (m) { d.lat = +m[1]; d.lon = +m[2]; } d.map_link = String(d.location); delete d.location; }
    if (d.owner_phone) d.owner_phone = normalizeDigits(d.owner_phone).replace(/[^\d+]/g, "");
    for (const k of ["price", "area", "floor_price", "rooms"]) if (d[k] != null && typeof d[k] !== "number") d[k] = normalizeDigits(d[k]).replace(/[^\d.]/g, "");
    if (d.negotiable != null) d.negotiable = yesNo(d.negotiable); if (d.listed_elsewhere != null) d.listed_elsewhere = yesNo(d.listed_elsewhere);
    if (d.age) d.age = AGE_BY_AR[d.age] || d.age; if (d.contact_role) d.contact_role = ROLE_BY_AR[d.contact_role] || d.contact_role; if (d.seriousness) d.seriousness = SER_BY_AR[d.seriousness] || d.seriousness; if (d.deed) d.deed = DEED_BY_AR[d.deed] || d.deed;
    if (d.hood) d.hood = HOOD_BY_AR[d.hood] || (HOODS[d.hood] ? d.hood : Object.keys(HOODS).find(k => String(d.hood).includes(HOODS[k])) || d.hood);
    if (d.type) d.type = TYPE_BY_AR[d.type] || (PROPERTY_TYPES[d.type] ? d.type : "other");
    if (d.status) d.status = STATUS_BY_AR[d.status] || (PROPERTY_STATUS[d.status] ? d.status : "new");
    if (d.lat != null) d.lat = num(d.lat); if (d.lon != null) d.lon = num(d.lon);
    if (d.next_followup instanceof Date) d.next_followup = d.next_followup.toISOString().slice(0, 10);
    out.push({ title: d.title || "عقار مستورد", status: "new", source: "import", photos: [], ...d });
  }
  return out;
}
