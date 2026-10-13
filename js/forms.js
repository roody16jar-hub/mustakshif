// Item editors rendered into the bottom sheet. Every field autosaves; no save button anywhere.
import { S, store } from "./store.js";
import { ctx } from "./ctx.js";
import { $, $$, esc, toast, confirmAr, openSheet, closeSheet, formHtml, bindAutosave, addPhotoTo, renderThumbs, photoButton, pill, fmtNum, fmtDate } from "./ui.js";
import { icon } from "./icons.js";
import { HOODS, PROPERTY_TYPES, PROPERTY_STATUS, TARGET_STATUS, CONTACT_OUTCOME, priceCheck, PRICE_VERDICT, callScripts, todayIso } from "./domain.js";

const hoodOptions = () => Object.fromEntries(Object.entries(S.hoods).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, v.ar]));
const mapsLink = (d) => d.lat != null ? `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lon}` : null;
const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
const telLink = (p) => `tel:${String(p || "").replace(/\s/g, "")}`;
const PHONE_OK = (v) => !v || /^(\+?966|0)?5\d{8}$/.test(String(v).replace(/[\s-]/g, ""));

function actionsHtml(d, extra = "") {
  const m = mapsLink(d);
  return `<div class="sheet-actions">${extra}
    ${m ? `<a class="btn secondary big" href="${m}" target="_blank" rel="noopener">${icon("nav")} فتح في خرائط Google</a>` : ""}
    <button type="button" class="btn secondary big" data-act="here">${icon("locate")} نقل الموقع إلى مكاني الآن</button>
  </div>`;
}
function wirePhotos(root, item, uid) {
  const box = $("[data-thumbs]", root); if (!box) return;
  renderThumbs(box, item, store.save);
  const inp = $("[data-photo]", root);
  if (inp) inp.onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { await addPhotoTo(item, f, uid, store.save); renderThumbs(box, item, store.save); toast("تم حفظ الصورة"); } catch (err) { toast("تعذّر حفظ الصورة"); console.error(err); } };
}
function wireCommon(root, item, uid) {
  wirePhotos(root, item, uid);
  const here = $('[data-act="here"]', root);
  if (here) here.onclick = async () => { here.disabled = true; try { const p = await ctx.locate(); if (!p) throw 0; item.data.lat = p.lat; item.data.lon = p.lon; await store.save(item); toast(`تم: الدقة ${Math.round(p.acc)} م`); ctx.refreshMap(); } catch { toast("تعذّر تحديد الموقع"); } here.disabled = false; };
  const del = $('[data-act="delete"]', root);
  if (del) del.onclick = async () => { if (!confirmAr("حذف هذا السجل وصوره نهائياً؟")) return; await store.remove(item); closeSheet(); toast("تم الحذف"); ctx.refreshMap(); };
  const log = $('[data-act="contact"]', root);
  if (log) log.onclick = () => openContact(item);
}

// ---------------- property ----------------
export async function openProperty(item, { lat, lon } = {}) {
  if (!item) item = await store.create("property", { title: "", hood: S.hood, type: "villa", status: "new", source: "field", photos: [], lat, lon });
  const d = item.data;
  const fields = [
    { name: "hood", label: "الحي", type: "select", options: hoodOptions() },
    { name: "type", label: "النوع", type: "select", options: PROPERTY_TYPES },
    { name: "title", label: "وصف قصير (مثل: فيلا زاوية شارع 12)", placeholder: "اكتب ما يميّز العقار" },
    { name: "status", label: "الحالة", type: "select", options: PROPERTY_STATUS },
    { name: "area", label: "المساحة بالمتر", type: "number", placeholder: "400" },
    { name: "price", label: "السعر المطلوب بالريال", type: "number", placeholder: "2500000" },
    { name: "floor_price", label: "السعر الأدنى الذي يقبله المالك (سرّي، لا يظهر للمكتب)", type: "number" },
    { name: "phase", label: "المرحلة", placeholder: "هيكل، تشطيب، مكتمل…" },
    { name: "owner_name", label: "اسم المالك (سرّي)" },
    { name: "owner_phone", label: "جوال المالك (سرّي)", type: "tel", placeholder: "05xxxxxxxx" },
    { name: "next_followup", label: "تاريخ المتابعة", type: "date" },
    { name: "note", label: "ملاحظات", type: "textarea" },
  ];
  const root = openSheet("عقار", `
    <div id="verdict"></div>
    ${formHtml(fields, d)}
    <div class="thumbs" data-thumbs></div>${photoButton("صوّر العقار")}
    ${actionsHtml(d, `<button type="button" class="btn primary big" data-act="contact">${icon("phone")} سجّل اتصالاً أو زيارة</button>${d.owner_phone ? `<a class="btn secondary big" href="${telLink(d.owner_phone)}">${icon("phone")} اتصال بالمالك</a>` : ""}`)}
    <div class="sheet-actions"><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف العقار</button></div>
    <p class="muted small center">يُحفظ تلقائياً مع كل تغيير.</p>`);
  const showVerdict = () => {
    const v = priceCheck(item, store.all("price_avg")); const box = $("#verdict", root); if (!box) return;
    box.innerHTML = v.verdict === "unknown" ? `<div class="verdict unknown">${icon("money")} ${esc(PRICE_VERDICT.unknown)}: ${esc(v.reason || "")}</div>` : `<div class="verdict ${v.verdict}">${icon("money")} ${esc(PRICE_VERDICT[v.verdict])} (${v.diffPct > 0 ? "+" : ""}${v.diffPct}%) · ${fmtNum(v.ppm2)} ر/م² مقابل ${fmtNum(v.avg)} (${esc(v.basis)})</div>`;
  };
  showVerdict();
  bindAutosave(root, item, store.save, { validate: (n, v) => n === "owner_phone" && !PHONE_OK(v) ? "رقم الجوال غير صحيح" : null, onChange: () => { showVerdict(); ctx.refreshMap(); } });
  wireCommon(root, item, S.uid);
}

// ---------------- target (from the scout) ----------------
export function openTarget(item) {
  const d = item.data;
  const meta = [d.kind_label, d.phase, d.area ? `${d.area} م²` : "", d.use, d.score ? `درجة ${d.score}` : "", d.verified ? "موثّق بالعين" : "غير موثّق", d.my_type ? "من نوعي" : "", d.scan_date ? `فحص ${d.scan_date}` : ""].filter(Boolean).join(" · ");
  const fields = [
    { name: "status", label: "الحالة", type: "select", options: TARGET_STATUS },
    { name: "priority", label: "الأولوية", type: "select", options: { "": "بلا", high: "عالية", mid: "متوسطة", low: "منخفضة" } },
    { name: "owner_name", label: "اسم المالك (سرّي)" },
    { name: "owner_phone", label: "جوال المالك (سرّي)", type: "tel" },
    { name: "next_followup", label: "تاريخ المتابعة", type: "date" },
    { name: "note", label: "ملاحظات", type: "textarea" },
  ];
  const root = openSheet(`هدف ${d.ref || ""}`, `
    <p class="muted small">${esc(meta)}</p>${d.why ? `<p class="small">${esc(d.why)}</p>` : ""}${d.verify_note ? `<p class="small">${icon("check")} ${esc(d.verify_note)}</p>` : ""}
    ${formHtml(fields, d)}
    <div class="thumbs" data-thumbs></div>${photoButton("صوّر الموقع")}
    ${actionsHtml(d, `<button type="button" class="btn primary big" data-act="visited">${icon("check")} تمت الزيارة الآن</button><button type="button" class="btn secondary big" data-act="toprop">${icon("home")} حوّله إلى عقار مسجّل</button><button type="button" class="btn secondary big" data-act="contact">${icon("phone")} سجّل اتصالاً</button>`)}
    <p class="muted small center">يُحفظ تلقائياً مع كل تغيير.</p>`);
  bindAutosave(root, item, store.save, { validate: (n, v) => n === "owner_phone" && !PHONE_OK(v) ? "رقم الجوال غير صحيح" : null, onChange: (it) => { if (it.data.status === "visited" && !it.data.visited_at) { it.data.visited_at = new Date().toISOString(); store.save(it); } ctx.refreshMap(); } });
  wireCommon(root, item, S.uid);
  $('[data-act="visited"]', root).onclick = async () => { d.status = "visited"; d.visited_at = new Date().toISOString(); await store.save(item); $("[name=status]", root).value = "visited"; toast("سُجّلت الزيارة"); ctx.refreshMap(); };
  $('[data-act="toprop"]', root).onclick = async () => {
    const p = await store.create("property", { title: `${d.kind_label || "عقار"} (${d.ref})`, hood: d.hood, type: /فيلا/.test(d.kind_label || "") ? "villa" : /عمارة|شقق/.test(d.kind_label || "") ? "building" : "other", status: "new", source: "target", target_ref: d.ref, lat: d.lat, lon: d.lon, phase: d.phase, area: d.area, owner_name: d.owner_name, owner_phone: d.owner_phone, note: d.note, photos: [] });
    d.status = "visited"; d.visited_at = d.visited_at || new Date().toISOString(); await store.save(item);
    toast("أُنشئ عقار من الهدف"); openProperty(p);
  };
}

// ---------------- photographed sign ----------------
export async function openSign(item, { lat, lon } = {}) {
  if (!item) item = await store.create("sign", { hood: S.hood, status: "new", phone: "", text: "", photos: [], lat, lon });
  const d = item.data;
  const fields = [
    { name: "phone", label: "الجوال المكتوب على اللوحة", type: "tel", placeholder: "05xxxxxxxx" },
    { name: "text", label: "نص اللوحة (للبيع / للإيجار / اسم المكتب…)" },
    { name: "hood", label: "الحي", type: "select", options: hoodOptions() },
    { name: "status", label: "الحالة", type: "select", options: { new: "جديدة", called: "تم الاتصال", property: "تحوّلت إلى عقار", done: "منتهية" } },
    { name: "next_followup", label: "تاريخ المتابعة", type: "date" },
    { name: "note", label: "ملاحظات", type: "textarea" },
  ];
  const root = openSheet("لوحة مصوّرة", `
    <div class="thumbs" data-thumbs></div>${photoButton("صوّر اللوحة")}
    ${formHtml(fields, d)}
    ${actionsHtml(d, `${d.phone ? `<a class="btn primary big" href="${telLink(d.phone)}">${icon("phone")} اتصل بالرقم</a>` : ""}<button type="button" class="btn secondary big" data-act="contact">${icon("phone")} سجّل نتيجة الاتصال</button><button type="button" class="btn secondary big" data-act="toprop">${icon("home")} أنشئ عقاراً من اللوحة</button>`)}
    <div class="sheet-actions"><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف اللوحة</button></div>`);
  bindAutosave(root, item, store.save, { validate: (n, v) => n === "phone" && !PHONE_OK(v) ? "رقم الجوال غير صحيح" : null, onChange: () => ctx.refreshMap() });
  wireCommon(root, item, S.uid);
  $('[data-act="toprop"]', root).onclick = async () => {
    const p = await store.create("property", { title: d.text || "عقار من لوحة", hood: d.hood, type: "other", status: "contacted", source: "sign", sign_id: item.id, lat: d.lat, lon: d.lon, owner_phone: d.phone, note: d.note, photos: [] });
    d.status = "property"; await store.save(item); openProperty(p);
  };
}

// ---------------- contact log entry ----------------
export async function openContact(ref = null, existing = null) {
  const r = ref ? ref.data : {};
  const item = existing || await store.create("contact", { ref_kind: ref ? ref.kind : "", ref_id: ref ? ref.id : "", ref_title: ref ? (r.title || r.ref || r.text || r.name || "") : "", hood: r.hood || S.hood, channel: "call", outcome: "no_answer", at: new Date().toISOString(), note: "", next_followup: "" });
  const d = item.data;
  const fields = [
    { name: "channel", label: "القناة", type: "select", options: { call: "اتصال", visit: "زيارة", whatsapp: "واتساب", sms: "رسالة" } },
    { name: "outcome", label: "النتيجة", type: "select", options: CONTACT_OUTCOME },
    { name: "next_followup", label: "تاريخ المتابعة القادمة", type: "date" },
    { name: "note", label: "ماذا قال؟", type: "textarea" },
  ];
  const root = openSheet(`اتصال: ${d.ref_title || "عام"}`, `${formHtml(fields, d)}<div class="sheet-actions"><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف السجل</button></div><p class="muted small center">يُحفظ تلقائياً.</p>`);
  bindAutosave(root, item, store.save, { onChange: async (it) => {
    if (ref) {   // keep the referenced record in step with the call
      if (it.data.next_followup) ref.data.next_followup = it.data.next_followup;
      if (ref.kind === "property" && ref.data.status === "new") ref.data.status = "contacted";
      if (ref.kind === "sign" && ref.data.status === "new") ref.data.status = "called";
      if (ref.kind === "target" && it.data.channel === "visit" && ref.data.status === "new") { ref.data.status = "visited"; ref.data.visited_at = it.data.at; }
      await store.save(ref);
    } } });
  wireCommon(root, item, S.uid);
}

// ---------------- buyer request ----------------
export async function openRequest(item) {
  if (!item) item = await store.create("request", { buyer_name: "", buyer_phone: "", hood: S.hood, type: "villa", budget_min: "", budget_max: "", area_min: "", status: "open", note: "" });
  const d = item.data;
  const fields = [
    { name: "buyer_name", label: "اسم المشتري" }, { name: "buyer_phone", label: "جوال المشتري", type: "tel" },
    { name: "hood", label: "الحي المطلوب", type: "select", options: hoodOptions() }, { name: "type", label: "النوع", type: "select", options: PROPERTY_TYPES },
    { name: "budget_min", label: "الميزانية من", type: "number" }, { name: "budget_max", label: "الميزانية إلى", type: "number" }, { name: "area_min", label: "أقل مساحة مقبولة", type: "number" },
    { name: "status", label: "الحالة", type: "select", options: { open: "مفتوح", matched: "تمت المطابقة", closed: "مغلق" } },
    { name: "next_followup", label: "تاريخ المتابعة", type: "date" }, { name: "note", label: "ملاحظات", type: "textarea" },
  ];
  const root = openSheet("طلب مشترٍ", `${formHtml(fields, d)}<div class="sheet-actions">${d.buyer_phone ? `<a class="btn secondary big" href="${telLink(d.buyer_phone)}">${icon("phone")} اتصال بالمشتري</a>` : ""}<button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف الطلب</button></div>`);
  bindAutosave(root, item, store.save, { validate: (n, v) => n === "buyer_phone" && !PHONE_OK(v) ? "رقم الجوال غير صحيح" : null });
  wireCommon(root, item, S.uid);
}

// ---------------- contractor ----------------
export async function openContractor(item) {
  if (!item) item = await store.create("contractor", { name: "", phone: "", specialty: "", hoods: S.hoods[S.hood]?.ar || "", note: "" });
  const d = item.data;
  const root = openSheet("مقاول / مطوّر", `${formHtml([{ name: "name", label: "الاسم" }, { name: "phone", label: "الجوال", type: "tel" }, { name: "specialty", label: "التخصص (فلل، عمائر، تشطيب…)" }, { name: "hoods", label: "الأحياء التي يعمل فيها" }, { name: "note", label: "ملاحظات", type: "textarea" }], d)}
    <div class="sheet-actions">${d.phone ? `<a class="btn primary big" href="${telLink(d.phone)}">${icon("phone")} اتصال</a><a class="btn secondary big" href="${waLink(callScripts(store.setting("broker") || {}, store.setting("scripts") || {}).contractor)}" target="_blank" rel="noopener">${icon("wa")} واتساب بنص جاهز</a>` : ""}<button type="button" class="btn secondary big" data-act="contact">${icon("phone")} سجّل اتصالاً</button><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف</button></div>`);
  bindAutosave(root, item, store.save, { validate: (n, v) => n === "phone" && !PHONE_OK(v) ? "رقم الجوال غير صحيح" : null });
  wireCommon(root, item, S.uid);
}

// ---------------- district price average ----------------
export async function openPriceAvg(item) {
  if (!item) item = await store.create("price_avg", { hood: S.hood, type: "villa", price_per_m2: "", note: "" });
  const root = openSheet("متوسط سعر المتر", `${formHtml([{ name: "hood", label: "الحي", type: "select", options: hoodOptions() }, { name: "type", label: "النوع", type: "select", options: { ...PROPERTY_TYPES, any: "كل الأنواع" } }, { name: "price_per_m2", label: "متوسط سعر المتر بالريال", type: "number", placeholder: "6000" }, { name: "note", label: "مصدر الرقم أو ملاحظة", type: "textarea" }], item.data)}
    <div class="sheet-actions"><button type="button" class="btn danger big" data-act="delete">${icon("trash")} حذف</button></div>`);
  bindAutosave(root, item, store.save); wireCommon(root, item, S.uid);
}

// ---------------- broker details ----------------
export function openBroker() {
  const cur = store.setting("broker") || {};
  const item = { data: { ...cur } };
  const root = openSheet("بياناتي كوسيط", `<p class="muted small">تظهر في سكربتات الاتصال وتقارير التسليم.</p>${formHtml([{ name: "name", label: "اسمي" }, { name: "license", label: "رقم رخصة فال" }, { name: "office", label: "اسم المكتب" }, { name: "phone", label: "جوالي", type: "tel" }, { name: "whatsapp", label: "واتساب (إن اختلف)", type: "tel" }], item.data)}<p class="muted small center">يُحفظ تلقائياً.</p>`);
  bindAutosave(root, item, async (it) => { await store.setSetting("broker", { ...it.data }); });
}
export { PHONE_OK, waLink, telLink, mapsLink };
