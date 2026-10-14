// Item editors rendered into the bottom sheet. Every field autosaves; no save button anywhere.
import { S, store } from "./store.js";
import { ctx } from "./ctx.js";
import { $, $$, esc, toast, confirmAr, openSheet, closeSheet, formHtml, bindAutosave, addMediaTo, renderThumbs, photoButton, videoButton, pill, fmtNum, fmtDate } from "./ui.js";
import { icon } from "./icons.js";
import { CONFIG } from "./config.js";
import { HOODS, PROPERTY_TYPES, PROPERTY_STATUS, PROPERTY_AGE, CONTACT_ROLE, SERIOUSNESS, DEED_STATUS, YES_NO, TARGET_STATUS, CONTACT_OUTCOME, priceCheck, PRICE_VERDICT, matchProperty, callScripts, ownerWhatsapp, normalizeDigits, nextCode, todayIso } from "./domain.js";

const hoodOptions = () => Object.fromEntries(Object.entries(S.hoods).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, v.ar]));
const hoodAr = (h) => S.hoods[h]?.ar || HOODS[h] || h || "";
const mapsLink = (d) => d.lat != null ? `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lon}` : null;
const waLink = (text, phone = "") => { const p = normalizeDigits(phone).replace(/[^\d]/g, "").replace(/^0/, "966"); return `https://wa.me/${p}?text=${encodeURIComponent(text)}`; };
const telLink = (p) => `tel:${normalizeDigits(p).replace(/[^\d+]/g, "")}`;
const PHONE_OK = (v) => !v || /^(\+?966|0)?5\d{8}$/.test(normalizeDigits(v).replace(/[\s-]/g, ""));
const broker = () => store.setting("broker") || {};

function actionsHtml(d, extra = "") {
  const m = mapsLink(d);
  return `<div class="sheet-actions">${extra}
    ${m ? `<a class="btn secondary big" href="${m}" target="_blank" rel="noopener">${icon("nav")} فتح في خرائط Google</a>` : ""}
    <button type="button" class="btn secondary big" data-act="here">${icon("locate")} نقل الموقع إلى مكاني الآن</button>
  </div>`;
}
function wireMedia(root, item, uid) {
  const box = $("[data-thumbs]", root); if (!box) return;
  renderThumbs(box, item, store.save);
  $$("[data-photo],[data-video]", root).forEach(inp => inp.onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const isVideo = f.type.startsWith("video/");
    if (isVideo && f.size > (CONFIG.VIDEO_MAX_MB || 20) * 1024 * 1024) { toast(`الفيديو أكبر من ${CONFIG.VIDEO_MAX_MB} ميجابايت. صوّر مقطعاً أقصر.`, 4000); return; }
    try { await addMediaTo(item, f, uid, store.save); renderThumbs(box, item, store.save); toast(isVideo ? "تم حفظ الفيديو" : "تم حفظ الصورة"); } catch (err) { toast("تعذّر الحفظ"); console.error(err); }
  });
}
function wireCommon(root, item, uid) {
  wireMedia(root, item, uid);
  const here = $('[data-act="here"]', root);
  if (here) here.onclick = async () => { here.disabled = true; try { const p = await ctx.locate(); if (!p) throw 0; item.data.lat = p.lat; item.data.lon = p.lon; await store.save(item); toast(`تم: الدقة ${Math.round(p.acc)} م`); ctx.refreshMap(); } catch { toast("تعذّر تحديد الموقع"); } here.disabled = false; };
  const del = $('[data-act="delete"]', root);
  if (del) del.onclick = async () => { if (!confirmAr("حذف هذا السجل وصوره نهائياً؟")) return; await store.remove(item); closeSheet(); toast("تم الحذف"); ctx.refreshMap(); };
  const log = $('[data-act="contact"]', root);
  if (log) log.onclick = () => openContact(item);
}
const digitsValidator = (fields) => (n, v) => fields.includes(n) && !PHONE_OK(v) ? "رقم الجوال غير صحيح (05xxxxxxxx)" : null;

// ---------------- property ----------------
export async function openProperty(item, { lat, lon } = {}) {
  if (!item) item = await store.create("property", { code: nextCode(store.all("property")), title: "", hood: S.hood, type: "villa", age: "", status: "new", source: "field", photos: [], lat, lon, contact_role: "owner", negotiable: "", listed_elsewhere: "", seriousness: "", deed: "" });
  if (!item.data.code) { item.data.code = nextCode(store.all("property")); await store.save(item); }
  const d = item.data; const b = broker();
  const fields = [
    { name: "hood", label: "الحي", type: "select", options: hoodOptions() },
    { name: "type", label: "النوع", type: "select", options: PROPERTY_TYPES },
    { name: "age", label: "العمر", type: "select", options: { "": "—", ...PROPERTY_AGE } },
    { name: "title", label: "وصف قصير (مثل: فيلا زاوية شارع 12)", placeholder: "اكتب ما يميّز العقار" },
    { name: "area", label: "المساحة بالمتر", type: "number", placeholder: "400" },
    { name: "rooms", label: "عدد الغرف", type: "number", placeholder: "5" },
    { name: "price", label: "السعر المطلوب بالريال", type: "number", placeholder: "2500000" },
    { name: "negotiable", label: "قابل للتفاوض؟", type: "select", options: YES_NO },
    { name: "contact_role", label: "صفة جهة الاتصال", type: "select", options: CONTACT_ROLE },
    { name: "owner_name", label: "اسم المالك (سرّي)" },
    { name: "owner_phone", label: "جوال المالك (سرّي)", type: "tel", placeholder: "05xxxxxxxx" },
    { name: "listed_elsewhere", label: "معروض عند مكاتب ثانية؟", type: "select", options: YES_NO },
    { name: "status", label: "حالة المتابعة", type: "select", options: PROPERTY_STATUS },
    { name: "next_followup", label: "تاريخ المتابعة", type: "date" },
    { name: "seriousness", label: "جدية المالك", type: "select", options: { "": "—", ...SERIOUSNESS } },
    { name: "deed", label: "حالة الصك", type: "select", options: { "": "—", ...DEED_STATUS } },
    { name: "sale_reason", label: "سبب البيع" },
    { name: "floor_price", label: "أقل سعر يقبله المالك (سرّي، لا يخرج من التطبيق)", type: "number" },
    { name: "phase", label: "المرحلة", placeholder: "هيكل، تشطيب، مكتمل…" },
    { name: "note", label: "ملاحظات", type: "textarea" },
  ];
  const root = openSheet(`عقار ${d.code || ""}`, `
    <div id="verdict"></div><div id="req-matches"></div>
    ${formHtml(fields, d)}
    <div class="thumbs" data-thumbs></div><div class="row">${photoButton("صوّر العقار")}${videoButton("فيديو قصير")}</div>
    ${actionsHtml(d, `<button type="button" class="btn primary big" data-act="contact">${icon("phone")} سجّل اتصالاً أو زيارة</button><div id="owner-actions"></div>`)}
    <div class="sheet-actions"><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف العقار</button></div>
    <p class="muted small center">يُحفظ تلقائياً مع كل تغيير.</p>`);
  const refresh = () => {
    const v = priceCheck(item, store.all("price_avg")); const box = $("#verdict", root); if (!box) return;
    box.innerHTML = v.verdict === "unknown" ? `<div class="verdict unknown">${icon("money")} ${esc(PRICE_VERDICT.unknown)}: ${esc(v.reason || "")}</div>` : `<div class="verdict ${v.verdict}">${icon("money")} ${esc(PRICE_VERDICT[v.verdict])} (${v.diffPct > 0 ? "+" : ""}${v.diffPct}%) · ${fmtNum(v.ppm2)} ر/م² مقابل ${fmtNum(v.avg)} (${esc(v.basis)})</div>`;
    const rm = matchProperty(item, store.all("request")); const rb = $("#req-matches", root); const oa = $("#owner-actions", root); if (!rb || !oa) return;
    rb.innerHTML = rm.length ? `<div class="notice ok">${icon("users")} يطابق ${rm.length} طلب مشترٍ: ${esc(rm.slice(0, 3).map(x => x.request.data.buyer_name || "مشترٍ").join("، "))}</div>` : "";
    oa.innerHTML = d.owner_phone && PHONE_OK(d.owner_phone) ? `<a class="btn secondary big" href="${telLink(d.owner_phone)}">${icon("phone")} اتصال بالمالك</a><a class="btn secondary big" href="${waLink(ownerWhatsapp(b, hoodAr(d.hood)), d.owner_phone)}" target="_blank" rel="noopener">${icon("wa")} واتساب للمالك (رسالة جاهزة)</a>` : "";
  };
  refresh();
  bindAutosave(root, item, store.save, { validate: digitsValidator(["owner_phone"]), onChange: () => { refresh(); ctx.refreshMap(); } });
  wireCommon(root, item, S.uid);
}

// ---------------- target (from the scout) ----------------
export function openTarget(item) {
  const d = item.data;
  const meta = [d.kind_label, d.phase, d.area ? `${d.area} م²` : "", d.use, d.score != null ? `درجة ${d.score}` : "", d.verified ? "موثّق بالعين" : "غير موثّق", d.my_type ? "من نوعي" : "", d.scan_date ? `فحص ${d.scan_date}` : ""].filter(Boolean).join(" · ");
  const fields = [
    { name: "status", label: "الحالة", type: "select", options: TARGET_STATUS },
    { name: "priority", label: "الأولوية", type: "select", options: { "": "بلا", high: "عالية", mid: "متوسطة", low: "منخفضة" } },
    { name: "owner_name", label: "اسم المالك (سرّي)" },
    { name: "owner_phone", label: "جوال المالك (سرّي)", type: "tel" },
    { name: "next_followup", label: "تاريخ المتابعة", type: "date" },
    { name: "note", label: "ملاحظات", type: "textarea" },
  ];
  const root = openSheet(`هدف ${d.ref || ""}`, `
    <p class="muted small">${esc(meta)}</p>${d.why ? `<p class="small"><b>سبب الترشيح:</b> ${esc(d.why)}</p>` : ""}${d.verify_note ? `<p class="small">${icon("check")} ${esc(d.verify_note)}</p>` : ""}
    <div class="row"><button type="button" class="btn primary" data-act="visited">${icon("check")} زرته</button><button type="button" class="btn secondary" data-act="ignore">${icon("close")} تجاهل</button><button type="button" class="btn secondary" data-act="toprop">${icon("home")} سجّله عقار</button></div>
    ${formHtml(fields, d)}
    <div class="thumbs" data-thumbs></div>${photoButton("صوّر الموقع")}
    ${actionsHtml(d, `<button type="button" class="btn secondary big" data-act="contact">${icon("phone")} سجّل اتصالاً</button>`)}
    <p class="muted small center">يُحفظ تلقائياً مع كل تغيير.</p>`);
  bindAutosave(root, item, store.save, { validate: digitsValidator(["owner_phone"]), onChange: (it) => { if (it.data.status === "visited" && !it.data.visited_at) { it.data.visited_at = new Date().toISOString(); store.save(it); } ctx.refreshMap(); } });
  wireCommon(root, item, S.uid);
  $('[data-act="visited"]', root).onclick = async () => { d.status = "visited"; d.visited_at = new Date().toISOString(); await store.save(item); $("[name=status]", root).value = "visited"; toast("سُجّلت الزيارة"); ctx.refreshMap(); };
  $('[data-act="ignore"]', root).onclick = async () => { d.status = "ignored"; await store.save(item); $("[name=status]", root).value = "ignored"; toast("تم التجاهل"); ctx.refreshMap(); };
  $('[data-act="toprop"]', root).onclick = async () => {
    const p = await store.create("property", { code: nextCode(store.all("property")), title: `${d.kind_label || "عقار"} (${d.ref})`, hood: d.hood, type: /فيلا/.test(d.kind_label || "") ? "villa" : /عمارة|شقق/.test(d.kind_label || "") ? "building" : "other", age: "building", status: "new", source: "target", target_ref: d.ref, lat: d.lat, lon: d.lon, phase: d.phase, area: d.area, owner_name: d.owner_name, owner_phone: d.owner_phone, note: d.note, photos: [], contact_role: "developer" });
    d.status = "visited"; d.visited_at = d.visited_at || new Date().toISOString(); await store.save(item);
    toast("أُنشئ عقار من الهدف"); openProperty(p);
  };
}

// ---------------- photographed sign (pending item) ----------------
export async function openSign(item, { lat, lon } = {}) {
  if (!item) item = await store.create("sign", { hood: S.hood, status: "new", phone: "", text: "", photos: [], lat, lon });
  const d = item.data;
  const fields = [
    { name: "phone", label: "الجوال المكتوب على اللوحة", type: "tel", placeholder: "05xxxxxxxx" },
    { name: "text", label: "نص اللوحة (للبيع / للإيجار / اسم المكتب…)" },
    { name: "hood", label: "الحي", type: "select", options: hoodOptions() },
    { name: "status", label: "الحالة", type: "select", options: { new: "معلّقة (لم أراجعها)", called: "تم الاتصال", property: "تحوّلت إلى عقار", done: "منتهية" } },
    { name: "next_followup", label: "تاريخ المتابعة", type: "date" },
    { name: "note", label: "ملاحظات", type: "textarea" },
  ];
  const root = openSheet("لوحة مصوّرة", `
    <div class="thumbs" data-thumbs></div>${photoButton("صوّر اللوحة")}
    <div class="sheet-actions"><button type="button" class="btn primary big" data-act="toprop">${icon("home")} حوّلها إلى عقار (خطوة واحدة)</button></div>
    ${formHtml(fields, d)}
    ${actionsHtml(d, `<div id="sign-actions"></div><button type="button" class="btn secondary big" data-act="contact">${icon("phone")} سجّل نتيجة الاتصال</button>`)}
    <div class="sheet-actions"><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف اللوحة</button></div>`);
  const refresh = () => { const sa = $("#sign-actions", root); if (!sa) return; sa.innerHTML = d.phone && PHONE_OK(d.phone) ? `<a class="btn secondary big" href="${telLink(d.phone)}">${icon("phone")} اتصل بالرقم</a><a class="btn secondary big" href="${waLink(ownerWhatsapp(broker(), hoodAr(d.hood)), d.phone)}" target="_blank" rel="noopener">${icon("wa")} واتساب (رسالة جاهزة)</a>` : ""; };
  refresh();
  bindAutosave(root, item, store.save, { validate: digitsValidator(["phone"]), onChange: () => { refresh(); ctx.refreshMap(); } });
  wireCommon(root, item, S.uid);
  $('[data-act="toprop"]', root).onclick = async () => {
    const p = await store.create("property", { code: nextCode(store.all("property")), title: d.text || "عقار من لوحة", hood: d.hood, type: "other", status: d.phone ? "contacted" : "new", source: "sign", sign_id: item.id, lat: d.lat, lon: d.lon, owner_phone: d.phone, note: d.note, photos: [...(d.photos || [])], contact_role: "owner" });
    d.status = "property"; d.property_id = p.id; await store.save(item); toast("أُنشئ عقار من اللوحة"); openProperty(p);
  };
}

// ---------------- contact log entry ----------------
export async function openContact(ref = null, existing = null) {
  const r = ref ? ref.data : {};
  const item = existing || await store.create("contact", { ref_kind: ref ? ref.kind : "", ref_id: ref ? ref.id : "", ref_title: ref ? (r.code ? r.code + " " + (r.title || "") : r.title || r.ref || r.text || r.name || "") : "", hood: r.hood || S.hood, channel: "call", outcome: "no_answer", at: new Date().toISOString(), note: "", next_step: "", next_followup: "" });
  const d = item.data;
  const fields = [
    { name: "channel", label: "القناة", type: "select", options: { call: "اتصال", visit: "زيارة", whatsapp: "واتساب", sms: "رسالة" } },
    { name: "outcome", label: "النتيجة", type: "select", options: CONTACT_OUTCOME },
    { name: "note", label: "ماذا قال؟", type: "textarea" },
    { name: "next_step", label: "الخطوة القادمة", placeholder: "مثال: أرسل له نموذج العقد" },
    { name: "next_followup", label: "تاريخ المتابعة القادمة", type: "date" },
  ];
  const root = openSheet(`اتصال: ${d.ref_title || "عام"}`, `${formHtml(fields, d)}<div class="sheet-actions"><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف السجل</button></div><p class="muted small center">يُحفظ تلقائياً. تاريخ المتابعة في البطاقة يتحدث من آخر اتصال.</p>`);
  bindAutosave(root, item, store.save, { onChange: async (it) => {
    if (ref) {
      if (it.data.next_followup) ref.data.next_followup = it.data.next_followup;
      if (ref.kind === "property" && ref.data.status === "new") ref.data.status = "contacted";
      if (ref.kind === "property" && it.data.outcome === "interested" && ["new", "contacted"].includes(ref.data.status)) ref.data.status = "agreed";
      if (ref.kind === "property" && it.data.outcome === "not_selling") ref.data.status = "refused";
      if (ref.kind === "sign" && ref.data.status === "new") ref.data.status = "called";
      if (ref.kind === "target" && it.data.channel === "visit" && ref.data.status === "new") { ref.data.status = "visited"; ref.data.visited_at = it.data.at; }
      await store.save(ref);
    } } });
  wireCommon(root, item, S.uid);
}

// ---------------- buyer request ----------------
export async function openRequest(item) {
  if (!item) item = await store.create("request", { buyer_name: "", buyer_phone: "", hood: S.hood, type: "villa", budget_min: "", budget_max: "", area_min: "", source: "", date: todayIso(), status: "open", note: "" });
  const d = item.data;
  const fields = [
    { name: "buyer_name", label: "اسم المشتري" }, { name: "buyer_phone", label: "جوال المشتري", type: "tel" },
    { name: "hood", label: "الحي المطلوب", type: "select", options: hoodOptions() }, { name: "type", label: "النوع", type: "select", options: PROPERTY_TYPES },
    { name: "budget_min", label: "الميزانية من", type: "number" }, { name: "budget_max", label: "الميزانية إلى", type: "number" }, { name: "area_min", label: "أقل مساحة مقبولة", type: "number" },
    { name: "source", label: "مصدر الطلب", placeholder: "إعلان، معرفة، المكتب…" }, { name: "date", label: "تاريخ الطلب", type: "date" },
    { name: "status", label: "الحالة", type: "select", options: { open: "مفتوح", matched: "تمت المطابقة", closed: "مغلق" } },
    { name: "next_followup", label: "تاريخ المتابعة", type: "date" }, { name: "note", label: "ملاحظات", type: "textarea" },
  ];
  const root = openSheet("طلب مشترٍ", `${formHtml(fields, d)}<div class="sheet-actions">${d.buyer_phone ? `<a class="btn secondary big" href="${telLink(d.buyer_phone)}">${icon("phone")} اتصال بالمشتري</a>` : ""}<button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف الطلب</button></div>`);
  bindAutosave(root, item, store.save, { validate: digitsValidator(["buyer_phone"]) });
  wireCommon(root, item, S.uid);
}

// ---------------- contractor / engineering office ----------------
export async function openContractor(item) {
  if (!item) item = await store.create("contractor", { name: "", phone: "", kind: "contractor", specialty: "", hoods: S.hoods[S.hood]?.ar || "", note: "" });
  const d = item.data;
  const root = openSheet("مقاول / مكتب هندسي", `${formHtml([{ name: "name", label: "الاسم" }, { name: "kind", label: "الصفة", type: "select", options: { contractor: "مقاول", developer: "مطوّر فرد", office: "مكتب هندسي", supplier: "مورد" } }, { name: "phone", label: "الجوال", type: "tel" }, { name: "specialty", label: "التخصص (فلل، عمائر، تشطيب…)" }, { name: "hoods", label: "الأحياء التي يعمل فيها" }, { name: "note", label: "ملاحظات", type: "textarea" }], d)}
    <div class="sheet-actions">${d.phone ? `<a class="btn primary big" href="${telLink(d.phone)}">${icon("phone")} اتصال</a><a class="btn secondary big" href="${waLink(callScripts(broker(), store.setting("scripts") || {}).developer_call, d.phone)}" target="_blank" rel="noopener">${icon("wa")} واتساب بنص جاهز</a>` : ""}<button type="button" class="btn secondary big" data-act="here">${icon("locate")} حفظ موقعه هنا</button><button type="button" class="btn secondary big" data-act="contact">${icon("phone")} سجّل اتصالاً</button><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف</button></div>`);
  bindAutosave(root, item, store.save, { validate: digitsValidator(["phone"]) });
  wireCommon(root, item, S.uid);
}

// ---------------- district price average (dated) ----------------
export async function openPriceAvg(item) {
  if (!item) item = await store.create("price_avg", { hood: S.hood, type: "villa", price_per_m2: "", date: todayIso(), note: "" });
  const root = openSheet("متوسط سعر المتر", `${formHtml([{ name: "hood", label: "الحي", type: "select", options: hoodOptions() }, { name: "type", label: "النوع", type: "select", options: { ...PROPERTY_TYPES, any: "كل الأنواع" } }, { name: "price_per_m2", label: "متوسط سعر المتر بالريال", type: "number", placeholder: "6000" }, { name: "date", label: "تاريخ الرقم", type: "date" }, { name: "note", label: "مصدر الرقم أو ملاحظة", type: "textarea" }], item.data)}
    <div class="sheet-actions"><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف</button></div>`);
  bindAutosave(root, item, store.save); wireCommon(root, item, S.uid);
}

// ---------------- broker details ----------------
export function openBroker() {
  const item = { data: { ...broker() } };
  const root = openSheet("بياناتي كوسيط", `<p class="muted small">تظهر في سكربتات الاتصال وتقارير التسليم ورسائل واتساب.</p>${formHtml([{ name: "name", label: "اسمي" }, { name: "license", label: "رقم رخصة فال" }, { name: "office", label: "اسم المكتب الشريك" }, { name: "phone", label: "جوالي", type: "tel" }, { name: "whatsapp", label: "واتساب (إن اختلف)", type: "tel" }], item.data)}<p class="muted small center">يُحفظ تلقائياً.</p>`);
  bindAutosave(root, item, async (it) => { await store.setSetting("broker", { ...it.data }); });
}
export { PHONE_OK, waLink, telLink, mapsLink };
