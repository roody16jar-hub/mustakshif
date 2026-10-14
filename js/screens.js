// Screens: today, properties, targets, more (+ sub screens), legend, street sheet. Rendering over store + domain.
import { S, store } from "./store.js";
import { ctx } from "./ctx.js";
import { $, $$, esc, toast, confirmAr, openSheet, closeSheet, pill, empty, fmtDate, fmtNum, formHtml, bindAutosave } from "./ui.js";
import { icon } from "./icons.js";
import { openProperty, openTarget, openSign, openContact, openRequest, openContractor, openPriceAvg, openBroker, waLink, telLink } from "./forms.js";
import { HOODS, PROPERTY_TYPES, PROPERTY_STATUS, PROPERTY_AGE, TARGET_STATUS, CONTACT_OUTCOME, matchAll, priceCheck, PRICE_VERDICT, handoverText, handoverRows, assertOfficeSafe, weeklyStats, districtRanking, objectives, dueFollowups, todayTargets, scoutSummary, sessionSummary, callScripts, SCRIPT_TITLES, exportSheets, todayIso, normalizeDigits } from "./domain.js";
import { exportWorkbook, exportHandoverXlsx, importWorkbook } from "./excel.js";
import { THEMES, themeChoice, setTheme } from "./theme.js";
import { sync, photoBlob } from "./sync.js";
import { auth, arabicError } from "./auth.js";
import { db } from "./db.js";
import { CONFIG } from "./config.js";
import { dist } from "./geo.js";

const hoodAr = (h) => S.hoods[h]?.ar || HOODS[h] || h || "";
const typeAr = (t) => PROPERTY_TYPES[t] || t || "";
const li = (id, title, badge, sub, date) => `<li class="item" data-id="${id}"><div class="t">${title}</div>${badge}<div class="s">${sub}</div>${date || ""}</li>`;
const dueHtml = (f) => f ? `<div class="d ${f < todayIso() ? "over" : ""}">${icon("clock")} ${esc(f)}</div>` : "";
const statusCls = (s) => ({ new: "new", contacted: "visited", agreed: "visited", contract: "done", handed: "done", sold: "done", refused: "ignored" }[s] || "new");
const q = (sel) => normalizeDigits(($(sel).value || "").trim());
const hit = (d, s) => !s || normalizeDigits(JSON.stringify(d)).includes(s);
function openItem(id) {
  const it = store.get(id); if (!it) return;
  ({ property: openProperty, target: openTarget, sign: openSign, request: openRequest, contractor: openContractor, price_avg: openPriceAvg, contact: (i) => openContact(store.get(i.data.ref_id) || null, i) }[it.kind] || (() => {}))(it);
}
function wireList(root) { $$("[data-id]", root).forEach(el => el.onclick = () => openItem(el.dataset.id)); }
const objGoals = () => ({ streetsPct: CONFIG.OBJECTIVE_STREETS_PCT || 90, phones: CONFIG.OBJECTIVE_PHONES || 10 });

// ---------------- اليوم ----------------
export async function renderToday() {
  const root = $("#today"); const items = S.items; const hood = S.hood;
  const due = dueFollowups(items); const pendingSigns = store.all("sign").filter(s => s.data.status === "new");
  const pos = ctx.lastPosition && ctx.lastPosition();
  let tg = todayTargets(items, hood, 20);
  if (pos) tg = tg.map(t => ({ t, m: dist([t.data.lon, t.data.lat], [pos.lon, pos.lat]) })).sort((a, b) => a.m - b.m).slice(0, 5); else tg = tg.slice(0, 5).map(t => ({ t, m: null }));
  const obj = objectives(hood, items, ctx.coverage(), objGoals());
  const sessions = store.all("session").sort((a, b) => b.created_at < a.created_at ? -1 : 1);
  const reqs = matchAll(store.all("request"), store.all("property")).filter(r => r.matches.length);
  const stats = weeklyStats(items, new Date(), hood);
  const broker = store.setting("broker") || {};
  const lastBackup = await db.meta("lastBackup"); const backupOld = !lastBackup || (Date.now() - Date.parse(lastBackup)) > 7 * 86400000;
  root.innerHTML = `
    <div class="card"><h2>${icon("car")} جولة اليوم في ${esc(hoodAr(hood))}</h2>
      <p class="muted">${broker.name ? "أهلاً " + esc(broker.name) + ". " : ""}${new Date().toLocaleDateString("ar-SA-u-nu-latn", { weekday: "long", day: "numeric", month: "long" })}</p>
      <button class="btn primary field" data-go="map">${icon("play")} ابدأ التتبّع</button>
    </div>
    ${backupOld && store.all("property").length ? `<div class="notice">${icon("backup")} <span>${lastBackup ? "آخر نسخة احتياطية قبل أكثر من 7 أيام." : "لم تأخذ نسخة احتياطية بعد."} <button class="btn link" data-sub="settings">خذ نسخة الآن</button></span></div>` : ""}
    <div class="card"><h2>${icon("clock")} متابعات مستحقة <span class="badge ${due.some(x => x.overdue) ? "warn" : ""}">${due.length}</span></h2>
      ${due.length ? `<ul class="list" style="padding:0">${due.slice(0, 8).map(x => li(x.item.id, esc(x.item.data.code ? x.item.data.code + " · " + (x.item.data.title || "") : x.item.data.title || x.item.data.ref || x.item.data.buyer_name || x.item.data.text || "سجل"), pill(x.overdue ? "warn" : "new", x.overdue ? "متأخر" : "اليوم"), esc(hoodAr(x.item.data.hood)) + " · " + esc({ property: "عقار", target: "هدف", contact: "اتصال", request: "طلب مشترٍ", sign: "لوحة" }[x.item.kind] || x.item.kind), dueHtml(x.date))).join("")}</ul>` : `<p class="muted">لا متابعات اليوم.</p>`}
    </div>
    <div class="card"><h2>${icon("sign")} لوحات معلّقة <span class="badge ${pendingSigns.length ? "new" : ""}">${pendingSigns.length}</span></h2>
      ${pendingSigns.length ? `<ul class="list" style="padding:0">${pendingSigns.slice(0, 5).map(s => li(s.id, esc(s.data.phone || "بلا رقم"), pill("new", "معلّقة"), esc([hoodAr(s.data.hood), s.data.text, fmtDate(s.created_at)].filter(Boolean).join(" · ")))).join("")}</ul>` : `<p class="muted">لا لوحات معلّقة. صوّر اللوحات أثناء الجولة وراجعها هنا في البيت.</p>`}
    </div>
    <div class="card"><h2>${icon("target")} أهداف تستحق الزيارة${pos ? " (الأقرب إليك)" : ""}</h2>
      ${tg.length ? `<ul class="list" style="padding:0">${tg.map(({ t, m }) => li(t.id, esc(t.data.ref), pill("new", "درجة " + t.data.score), esc([t.data.kind_label, t.data.phase, m != null ? (m < 1000 ? Math.round(m) + " م" : (m / 1000).toFixed(1) + " كم") : ""].filter(Boolean).join(" · ")))).join("")}</ul>` : `<p class="muted">لا أهداف جديدة موثّقة من نوعك في هذا الحي. ${store.all("target").length ? "غيّر الحي من الخريطة." : "ارفع نتائج الكشّاف (المزيد > الكشّاف)."}</p>`}
    </div>
    <div class="card ${obj.completed ? "completed" : ""}"><h2>${icon("flag")} أهداف ${esc(hoodAr(hood))}${obj.completed ? " · مكتمل" : ""}</h2>${obj.map(o => `<div class="obj ${o.reached ? "reached" : ""}"><span>${esc(o.title)}</span><b>${o.done}/${o.total}${o.unit === "%" ? "%" : ""}</b><div class="progress"><i style="width:${o.pct}%"></i></div></div>`).join("")}<p class="muted small" style="margin-top:8px">يكتمل الحي عندما تصل الثلاثة إلى هدفها.</p></div>
    ${reqs.length ? `<div class="card"><h2>${icon("users")} مطابقات لطلبات المشترين</h2>${reqs.map(r => `<div class="obj"><span>${esc(r.request.data.buyer_name || "مشترٍ")} · ${esc(hoodAr(r.request.data.hood))} ${esc(typeAr(r.request.data.type))}</span><b>${r.matches.length}</b></div>`).join("")}<button class="btn secondary big" data-sub="requests">عرض المطابقات</button></div>` : ""}
    <div class="card"><h2>${icon("chart")} هذا الأسبوع في ${esc(hoodAr(hood))}</h2><div class="kv"><div><b>${stats.thisWeek.minutes}</b><span>دقيقة تتبّع</span></div><div><b>${stats.thisWeek.streets}</b><span>شارع جديد</span></div><div><b>${stats.thisWeek.phones}</b><span>رقم مالك</span></div><div><b>${stats.thisWeek.contacts}</b><span>اتصال</span></div></div><button class="btn link" data-sub="stats">كل الإحصاءات</button></div>
    ${sessions.length ? `<div class="card"><h2>${icon("car")} آخر جولة</h2><p>${esc(fmtDate(sessions[0].created_at))} · ${esc(hoodAr(sessions[0].data.hood))}: ${esc(sessionSummary(sessions[0]))}</p></div>` : ""}`;
  wireList(root);
  $$("[data-go]", root).forEach(b => b.onclick = () => ctx.go(b.dataset.go));
  $$("[data-sub]", root).forEach(b => b.onclick = () => ctx.openSub(b.dataset.sub));
}

// ---------------- العقارات ----------------
let pHood = "";
export function renderProps() {
  const s = q("#p-q"); const st = $("#p-status").value;
  const sel = $("#p-status"); if (sel.options.length === 1) for (const [k, v] of Object.entries(PROPERTY_STATUS)) sel.add(new Option(v, k));
  const chips = $("#p-hoods"); if (!chips.children.length) { chips.innerHTML = `<button class="chip on" data-h="">كل الأحياء</button>` + Object.entries(S.hoods).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `<button class="chip" data-h="${k}">${esc(v.ar)}</button>`).join(""); $$(".chip", chips).forEach(c => c.onclick = () => { pHood = c.dataset.h; $$(".chip", chips).forEach(x => x.classList.toggle("on", x === c)); renderProps(); }); }
  const list = store.all("property").filter(p => (!st || p.data.status === st) && (!pHood || p.data.hood === pHood) && hit(p.data, s)).sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  const root = $("#p-list");
  root.innerHTML = list.length ? list.map(p => { const d = p.data; const v = priceCheck(p, store.all("price_avg")); return li(p.id, `${esc(hoodAr(d.hood))} · ${esc(typeAr(d.type))}${d.code ? " · " + esc(d.code) : ""}${d.title ? " · " + esc(d.title) : ""}`, pill(statusCls(d.status), PROPERTY_STATUS[d.status] || "جديد"), [d.area ? d.area + " م²" : "", d.price ? fmtNum(d.price) + " ر" : "", v.verdict !== "unknown" ? PRICE_VERDICT[v.verdict] : "", d.owner_phone ? "رقم المالك ✓" : "", (d.photos || []).length ? (d.photos.length + " صورة") : ""].filter(Boolean).join(" · "), dueHtml(d.next_followup)); }).join("")
    : empty("home", "لا توجد عقارات بعد", "اضغط «عقار جديد»، أو من الخريطة: اضغط مطوّلاً على الموقع، أو زر «سجّلت عقار هنا» أثناء التتبّع.");
  wireList(root);
}

// ---------------- الأهداف ----------------
const tFilters = { my: true, verified: true };
export function renderTargets() {
  const s = q("#t-q"); const st = $("#t-status").value;
  let list = store.all("target").filter(t => t.data.hood === S.hood);
  const all = list.length;
  if (tFilters.my) list = list.filter(t => t.data.my_type);
  if (tFilters.verified) list = list.filter(t => t.data.verified);
  list = list.filter(t => (!st || (t.data.status || "new") === st) && hit(t.data, s)).sort((a, b) => (b.data.verified - a.data.verified) || (b.data.score || 0) - (a.data.score || 0));
  $("#t-count").textContent = all ? `${list.length} من ${all} هدفاً في ${hoodAr(S.hood)}` : "";
  const root = $("#t-list");
  root.innerHTML = list.length ? list.map(t => { const d = t.data; return li(t.id, `${esc(d.ref)} · ${esc(d.kind_label || "")}`, pill(d.status || "new", TARGET_STATUS[d.status] || "جديد"), [d.phase, d.area ? d.area + " م²" : "", "درجة " + (d.score ?? "—"), d.verified ? "موثّق" : "غير موثّق", d.priority ? { high: "أولوية عالية", mid: "أولوية متوسطة", low: "أولوية منخفضة" }[d.priority] : "", d.note].filter(Boolean).map(esc).join(" · "), dueHtml(d.next_followup)); }).join("")
    : (all ? empty("search", "لا نتائج بهذه الفلاتر", "أزل «من نوعي» أو «موثّق» أو غيّر الحالة.") : empty("target", "لا أهداف في هذا الحي", "ارفع نتائج الكشّاف من جهازك: المزيد > الكشّاف.", `<button class="btn secondary big" data-sub="scout">فتح الكشّاف</button>`));
  wireList(root); $$("[data-sub]", root).forEach(b => b.onclick = () => ctx.openSub(b.dataset.sub));
}
export function initTargetFilters() { $$("#t-chips .chip").forEach(c => c.onclick = () => { tFilters[c.dataset.f] = !tFilters[c.dataset.f]; c.classList.toggle("on", tFilters[c.dataset.f]); renderTargets(); }); }

// ---------------- المزيد ----------------
export const SUBS = {
  scout: ["scout", "الكشّاف", "نتائج فحص الأقمار الصناعية لكل حي"], signs: ["sign", "اللوحات المصوّرة", "لوحات للبيع وأرقامها"], contacts: ["phone", "سجل الاتصال", "كل اتصال وزيارة ونتيجتها"],
  requests: ["users", "طلبات المشترين", "الطلبات والمطابقة التلقائية"], handover: ["send", "تسليم المكتب", "نص وExcel بلا بيانات المالك"], stats: ["chart", "الإحصاءات الأسبوعية", "لكل حي، مع نسب التحويل"],
  contractors: ["building", "المقاولون والمكاتب الهندسية", "جهات اتصال في الميدان"], averages: ["money", "متوسطات الأسعار", "سعر المتر لكل حي ونوع بتاريخه"], scripts: ["script", "سكربتات الاتصال", "10 نصوص جاهزة للنسخ"],
  ranking: ["rank", "دليل ترتيب الأحياء", "شمال الرياض وكيف تميّز المطوّر الفرد"], excel: ["file", "Excel", "تصدير كل شيء واستيراد المتعقّب القديم"], legend: ["layers", "مفتاح رموز الخريطة", "معنى كل لون وأيقونة"], settings: ["settings", "الإعدادات", "المظهر، الحساب، المزامنة، النسخة الاحتياطية"],
};
export function renderMore() {
  $("#more-menu").innerHTML = Object.entries(SUBS).map(([id, [ic, t, s]]) => `<li data-sub="${id}">${icon(ic)}<span>${esc(t)}<br><small>${esc(s)}</small></span>${icon("back")}</li>`).join("");
  $$("#more-menu [data-sub]").forEach(el => el.onclick = () => ctx.openSub(el.dataset.sub));
}
export function renderSub(id) {
  const root = $("#sub"); const r = { scout: subScout, signs: subSigns, contacts: subContacts, requests: subRequests, handover: subHandover, stats: subStats, contractors: subContractors, averages: subAverages, scripts: subScripts, ranking: subRanking, excel: subExcel, legend: subLegend, settings: subSettings }[id];
  if (r) r(root); wireList(root); $$("[data-sub]", root).forEach(b => b.onclick = () => ctx.openSub(b.dataset.sub));
}
const addBtn = (label, fn) => { const b = document.createElement("button"); b.className = "btn primary big"; b.innerHTML = icon("plus") + " " + label; b.onclick = fn; return b; };

function subScout(root) {
  const hoods = Object.keys(S.hoods).filter(h => !h.startsWith("_"));
  const rows = hoods.map(h => scoutSummary(S.items, h)).filter(s => s.total || S.hood === s.hood);
  root.innerHTML = `<div class="card"><h2>${icon("scout")} الكشّاف</h2><p class="muted small">الأهداف تأتي من فحص الأقمار الصناعية على جهازك وتُرفع إلى حسابك الخاص (لا إلى المستودع العام). للرفع بعد فحص جديد، على الكمبيوتر: <code dir="ltr">python tools/upload_targets.py</code> (يطلب كلمة مرورك ولا يحفظها). أو استورد targets.json هنا.</p><label class="btn secondary big">${icon("file")} استيراد targets.json<input type="file" accept=".json" hidden id="t-import"></label></div>
    ${rows.map(s => `<div class="card"><h2>${esc(hoodAr(s.hood))} ${s.scan_date ? `<span class="badge">فحص ${esc(s.scan_date)}</span>` : pill("ignored", "لم يُفحص")}</h2><div class="kv"><div><b>${s.total}</b><span>إجمالي الأهداف</span></div><div><b>${s.verified}</b><span>موثّق بالعين</span></div><div><b>${s.my_type}</b><span>من نوعي</span></div><div><b>${s.visited}</b><span>تمت زيارتها</span></div><div><b>${s.remaining}</b><span>متبقٍ من نوعي</span></div><div><b>${s.ignored}</b><span>متجاهل</span></div></div></div>`).join("")}`;
  $("#t-import", root).onchange = (e) => ctx.importTargets(e.target.files[0]).finally(() => e.target.value = "");
}
function subSigns(root) {
  const list = store.all("sign").sort((a, b) => (a.data.status === "new") - (b.data.status === "new") || (b.updated_at > a.updated_at ? 1 : -1)).reverse();
  root.innerHTML = `<ul class="list" style="padding:0">${list.length ? list.map(s => li(s.id, `${esc(hoodAr(s.data.hood))} · ${esc(s.data.phone || "بلا رقم")}`, pill(s.data.status === "new" ? "new" : s.data.status === "done" ? "ignored" : "visited", { new: "معلّقة", called: "تم الاتصال", property: "عقار", done: "منتهية" }[s.data.status] || s.data.status), esc([s.data.text, (s.data.photos || []).length ? s.data.photos.length + " صورة" : "", fmtDate(s.created_at), s.data.note].filter(Boolean).join(" · ")), dueHtml(s.data.next_followup))).join("") : empty("sign", "لا لوحات مصوّرة بعد", "من الخريطة أثناء التتبّع: «صوّر لوحة». تُحفظ الصورة والرقم والموقع كعنصر معلّق تراجعه في البيت.")}</ul>`;
  root.appendChild(addBtn("لوحة جديدة هنا", async () => { const p = await ctx.locate().catch(() => null); openSign(null, p ? { lat: p.lat, lon: p.lon } : {}); }));
}
function subContacts(root) {
  const list = store.all("contact").sort((a, b) => (b.data.at || b.created_at) > (a.data.at || a.created_at) ? 1 : -1);
  root.innerHTML = `<ul class="list" style="padding:0">${list.length ? list.map(c => li(c.id, esc(c.data.ref_title || "اتصال عام"), pill(c.data.outcome === "deal" || c.data.outcome === "interested" ? "done" : c.data.outcome === "follow_up" ? "new" : "ignored", CONTACT_OUTCOME[c.data.outcome] || c.data.outcome), esc([fmtDate(c.data.at || c.created_at), { call: "اتصال", visit: "زيارة", whatsapp: "واتساب", sms: "رسالة" }[c.data.channel], c.data.note, c.data.next_step ? "التالي: " + c.data.next_step : ""].filter(Boolean).join(" · ")), dueHtml(c.data.next_followup))).join("") : empty("phone", "لا اتصالات مسجّلة", "من بطاقة أي عقار أو هدف أو لوحة: «سجّل اتصالاً».")}</ul>`;
  root.appendChild(addBtn("اتصال عام", () => openContact(null)));
}
function subRequests(root) {
  const all = matchAll(store.all("request"), store.all("property"));
  root.innerHTML = all.length ? all.map(({ request: r, matches }) => `<div class="card"><h2>${esc(r.data.buyer_name || "مشترٍ")} ${pill(r.data.status === "open" ? "new" : "ignored", { open: "مفتوح", matched: "مطابَق", closed: "مغلق" }[r.data.status] || "")}</h2>
      <p class="muted small">${esc(hoodAr(r.data.hood))} · ${esc(typeAr(r.data.type))} · ${r.data.budget_min || r.data.budget_max ? `من ${fmtNum(r.data.budget_min) || "—"} إلى ${fmtNum(r.data.budget_max) || "—"}` : "بلا ميزانية"}${r.data.area_min ? " · ≥ " + r.data.area_min + " م²" : ""}${r.data.source ? " · " + esc(r.data.source) : ""}${r.data.date ? " · " + esc(r.data.date) : ""}</p>
      <div class="row"><button class="btn secondary" data-id="${r.id}">${icon("edit")} تعديل الطلب</button>${r.data.buyer_phone ? `<a class="btn secondary" href="${telLink(r.data.buyer_phone)}">${icon("phone")} اتصال</a>` : ""}</div>
      ${matches.length ? `<h3 style="margin-top:12px">${matches.length} عقار مطابق</h3><ul class="list" style="padding:0">${matches.map(m => li(m.property.id, `${esc(m.property.data.code || "")} ${esc(hoodAr(m.property.data.hood))} · ${esc(typeAr(m.property.data.type))}${m.property.data.title ? " · " + esc(m.property.data.title) : ""}`, pill("done", m.score + "%"), esc(m.why.join(" · ")) + (m.property.data.price ? " · " + fmtNum(m.property.data.price) + " ر" : ""))).join("")}</ul>` : `<p class="muted small">لا عقار مطابق بعد.</p>`}
    </div>`).join("") : empty("users", "لا طلبات مشترين", "سجّل طلب كل مشترٍ (الحي، النوع، الميزانية) وسيُطابق تلقائياً مع عقاراتك، وتظهر المطابقة أيضاً في بطاقة كل عقار.");
  root.appendChild(addBtn("طلب جديد", () => openRequest(null)));
}
function subHandover(root) {
  const broker = store.setting("broker") || {};
  const cands = store.all("property").filter(p => !["handed", "sold", "refused"].includes(p.data.status));
  const log = store.all("handover").sort((a, b) => b.created_at < a.created_at ? -1 : 1);
  const logRows = () => log.map(h => ({ "التاريخ": (h.data.at || h.created_at).slice(0, 10), "الوقت": fmtTimeOf(h.data.at || h.created_at), "المكتب": h.data.to || "", "الأكواد": (h.data.codes || []).join("، "), "عدد العقارات": (h.data.property_ids || []).length }));
  root.innerHTML = `<div class="card"><h2>${icon("send")} تسليم عقارات للمكتب</h2>
      ${!broker.name ? `<div class="notice">${icon("alert")} أضف بياناتك كوسيط أولاً <button class="btn link" data-broker>تعديل</button></div>` : ""}
      <p class="muted small">اختر العقارات. التقرير لا يحوي اسم المالك ولا جواله ولا السعر الأدنى، ويُحذف أي رقم جوال من الملاحظات.</p>
      ${cands.length ? cands.map(p => `<label class="check"><input type="checkbox" value="${p.id}"> ${esc(p.data.code || "")} ${esc(hoodAr(p.data.hood))} · ${esc(typeAr(p.data.type))}${p.data.title ? " · " + esc(p.data.title) : ""}${p.data.price ? " · " + fmtNum(p.data.price) : ""}</label>`).join("") : `<p class="muted">لا عقارات جاهزة للتسليم.</p>`}
      <label class="check"><input type="checkbox" id="ho-loc"> تضمين الموقع الدقيق (رابط الخريطة)</label>
      <label>اسم المكتب أو المستلم <input id="ho-to" value="${esc(broker.office || "")}"></label>
      <button class="btn primary big" id="ho-gen" ${cands.length ? "" : "disabled"}>${icon("file")} أنشئ التقرير</button>
      <div id="ho-out"></div></div>
    <div class="card"><h2>${icon("clock")} سجل التسليم (دائم)</h2>${log.length ? log.map(h => `<div class="stat-row"><span>${esc(fmtDate(h.data.at || h.created_at))} ${esc(fmtTimeOf(h.data.at || h.created_at))} · ${esc(h.data.to || "")}</span><b>${esc((h.data.codes || []).join("، ") || (h.data.property_ids || []).length + " عقار")}</b></div>`).join("") : `<p class="muted">لا تسليمات بعد.</p>`}${log.length ? `<button class="btn secondary big" id="ho-xlsx-log">${icon("file")} تصدير السجل Excel</button>` : ""}</div>`;
  const b = $("[data-broker]", root); if (b) b.onclick = () => openBroker();
  $("#ho-gen", root).onclick = () => {
    const ids = $$("input[type=checkbox][value]:checked", root).map(c => c.value); if (!ids.length) { toast("اختر عقاراً واحداً على الأقل"); return; }
    const props = ids.map(id => store.get(id)); const to = $("#ho-to", root).value; const withLoc = $("#ho-loc", root).checked;
    const text = handoverText(props, broker, { location: withLoc });
    let safe = true; try { assertOfficeSafe(text, props, broker); } catch (e) { safe = false; console.error("handover check failed"); }
    $("#ho-out", root).innerHTML = `<div class="notice ${safe ? "ok" : "err"}">${icon(safe ? "check" : "alert")} ${safe ? "تم التحقق: التقرير لا يحوي بيانات المالك." : "تنبيه: وُجد رقم في النص، راجعه قبل الإرسال."}</div><pre class="report">${esc(text)}</pre>
      <div class="sheet-actions"><button class="btn primary big" id="ho-copy">${icon("file")} نسخ النص</button><a class="btn secondary big" href="${waLink(text)}" target="_blank" rel="noopener">${icon("wa")} إرسال بواتساب</a><button class="btn secondary big" id="ho-xlsx">${icon("file")} Excel مع أول 3 صور وسجل التسليم</button><button class="btn secondary big" id="ho-log">${icon("check")} سجّل التسليم وعلّم العقارات «أُرسل للمكتب»</button></div>`;
    $("#ho-copy", root).onclick = async () => { try { await navigator.clipboard.writeText(text); toast("نُسخ"); } catch { toast("تعذّر النسخ، حدّد النص يدوياً"); } };
    $("#ho-xlsx", root).onclick = async () => {
      const btn = $("#ho-xlsx", root); btn.disabled = true; btn.textContent = "جارٍ التجهيز…";
      try {
        const photos = []; for (const p of props) { const list = []; for (const pid of (p.data.photos || []).slice(0, 3)) { const pr = await db.get("photos", pid); if (pr && (pr.type || "image/jpeg").startsWith("image/")) { const bl = await photoBlob(pid); if (bl) list.push(bl); } } photos.push(list); }
        await exportHandoverXlsx(handoverRows(props, withLoc), photos, logRows(), `handover-${todayIso()}.xlsx`); toast("تم إنشاء ملف Excel");
      } catch (e) { toast("تعذّر إنشاء Excel (يلزم اتصال أول مرة لتحميل المكتبة)", 4000); console.error(e); }
      btn.disabled = false; btn.innerHTML = `${icon("file")} Excel مع أول 3 صور وسجل التسليم`;
    };
    $("#ho-log", root).onclick = async () => { await store.create("handover", { at: new Date().toISOString(), to, hood: S.hood, property_ids: ids, codes: props.map(p => p.data.code).filter(Boolean), with_location: withLoc, text }); for (const p of props) { p.data.status = "handed"; await store.save(p); } toast("سُجّل التسليم"); renderSub("handover"); };
  };
  const xl = $("#ho-xlsx-log", root); if (xl) xl.onclick = () => exportWorkbook({ "سجل التسليم": logRows().map((r, i) => ({ ...r, "النص": log[i].data.text || "" })) }, `handover-log-${todayIso()}.xlsx`).catch(() => toast("تعذّر إنشاء Excel"));
}
const fmtTimeOf = (iso) => iso ? new Date(iso).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }) : "";
let statsHood = null;
function subStats(root) {
  const hood = statsHood === null ? S.hood : statsHood; const s = weeklyStats(S.items, new Date(), hood || null);
  const row = (l, a, b) => `<div class="stat-row"><span>${l}</span><b>${a} <span class="muted small">(الماضي ${b})</span></b></div>`;
  root.innerHTML = `<div class="card"><label>الحي <select id="st-hood"><option value="">كل الأحياء</option>${Object.entries(S.hoods).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `<option value="${k}" ${k === hood ? "selected" : ""}>${esc(v.ar)}</option>`).join("")}</select></label></div>
    <div class="card"><h2>${icon("chart")} هذا الأسبوع مقابل الماضي</h2>${row("دقائق تتبّع", s.thisWeek.minutes, s.lastWeek.minutes)}${row("كيلومترات", s.thisWeek.km, s.lastWeek.km)}${row("شوارع جديدة", s.thisWeek.streets, s.lastWeek.streets)}${row("عقارات مسجّلة", s.thisWeek.properties, s.lastWeek.properties)}${row("أرقام مالكين", s.thisWeek.phones, s.lastWeek.phones)}${row("اتصالات وزيارات", s.thisWeek.contacts, s.lastWeek.contacts)}${row("لوحات مصوّرة", s.thisWeek.signs, s.lastWeek.signs)}${row("أهداف تمت زيارتها", s.thisWeek.visited, s.lastWeek.visited)}${row("مالكون وافقوا", s.thisWeek.agreed, s.lastWeek.agreed)}${row("عقود وساطة", s.thisWeek.contracts, s.lastWeek.contracts)}${row("تسليمات للمكتب", s.thisWeek.handovers, s.lastWeek.handovers)}${row("صفقات مبيعة", s.thisWeek.deals, s.lastWeek.deals)}</div>
    <div class="card"><h2>${icon("rank")} التحويل خطوة بخطوة (كل الوقت)</h2><div class="kv"><div><b>${s.funnel.total}</b><span>عقار مسجّل</span></div><div><b>${s.funnel.phones}</b><span>رقم مالك (${s.conversion.phones}%)</span></div><div><b>${s.funnel.contacted}</b><span>تم التواصل (${s.conversion.contacted}%)</span></div><div><b>${s.funnel.agreed}</b><span>وافق مبدئياً (${s.conversion.agreed}%)</span></div><div><b>${s.funnel.contracts}</b><span>عقد وساطة (${s.conversion.contracts}%)</span></div><div><b>${s.funnel.handed}</b><span>أُرسل للمكتب (${s.conversion.handed}%)</span></div><div><b>${s.funnel.sold}</b><span>تم البيع (${s.conversion.sold}%)</span></div></div><p class="muted small" style="margin-top:8px">كل نسبة محسوبة من الخطوة التي قبلها.</p></div>`;
  $("#st-hood", root).onchange = (e) => { statsHood = e.target.value; renderSub("stats"); };
}
function subContractors(root) {
  const list = store.all("contractor").sort((a, b) => (a.data.name || "").localeCompare(b.data.name || ""));
  const kindAr = { contractor: "مقاول", developer: "مطوّر فرد", office: "مكتب هندسي", supplier: "مورد" };
  root.innerHTML = `<ul class="list" style="padding:0">${list.length ? list.map(c => li(c.id, esc(c.data.name || "بلا اسم"), pill("", kindAr[c.data.kind] || c.data.specialty || ""), esc([c.data.specialty, c.data.phone, c.data.hoods, c.data.note].filter(Boolean).join(" · ")))).join("") : empty("building", "لا مقاولين بعد", "سجّل كل مقاول أو مكتب هندسي تقابله في الميدان مع تخصصه وأحيائه.")}</ul>`;
  root.appendChild(addBtn("مقاول أو مكتب جديد", () => openContractor(null)));
}
function subAverages(root) {
  const list = store.all("price_avg").sort((a, b) => (a.data.hood || "").localeCompare(b.data.hood || "") || ((b.data.date || "") > (a.data.date || "") ? 1 : -1));
  root.innerHTML = `<div class="card"><p class="muted small">أدخل متوسط سعر المتر لكل حي ونوع بتاريخه، من خبرتك أو من صفقات حديثة. يُستخدم أحدث رقم لفحص سعر كل عقار. بلا رقم لا توجد مقارنة.</p></div><ul class="list" style="padding:0">${list.length ? list.map(a => li(a.id, `${esc(hoodAr(a.data.hood))} · ${esc(a.data.type === "any" ? "كل الأنواع" : typeAr(a.data.type))}`, pill("done", fmtNum(a.data.price_per_m2) + " ر/م²"), esc([a.data.date, a.data.note].filter(Boolean).join(" · ")))).join("") : empty("money", "لا متوسطات بعد", "أضف متوسط سعر المتر لحيّك الآن.")}</ul>`;
  root.appendChild(addBtn("متوسط جديد", () => openPriceAvg(null)));
}
function subScripts(root) {
  const broker = store.setting("broker") || {}; const over = store.setting("scripts") || {}; const s = callScripts(broker, over);
  root.innerHTML = `<div class="card"><p class="muted small">النصوص تحمل اسمك ورقم فال ومكتبك تلقائياً. ${broker.name ? "" : `<button class="btn link" data-broker>أضف بياناتك</button>`} استبدل ما بين الأقواس، وعدّل أي نص ويُحفظ لك.</p></div>` + Object.entries(s).map(([k, v]) => `<div class="card"><h2>${esc(SCRIPT_TITLES[k])}</h2><textarea data-script="${k}" rows="5">${esc(v)}</textarea><div class="row"><button class="btn primary" data-copy="${k}">${icon("file")} نسخ</button><button class="btn secondary" data-reset="${k}">النص الأصلي</button></div></div>`).join("");
  const b = $("[data-broker]", root); if (b) b.onclick = () => openBroker();
  $$("[data-script]", root).forEach(t => t.oninput = async () => { const o = store.setting("scripts") || {}; o[t.dataset.script] = t.value; await store.setSetting("scripts", o); });
  $$("[data-copy]", root).forEach(x => x.onclick = async () => { try { await navigator.clipboard.writeText($(`[data-script="${x.dataset.copy}"]`, root).value); toast("نُسخ"); } catch { toast("تعذّر النسخ"); } });
  $$("[data-reset]", root).forEach(x => x.onclick = async () => { const o = store.setting("scripts") || {}; delete o[x.dataset.reset]; await store.setSetting("scripts", o); renderSub("scripts"); });
}
function subRanking(root) {
  const pct = {}; const idx = ctx.streetIndex || {}; const len = ctx.exploredLen || {};
  for (const h of Object.keys(S.hoods)) if (idx[h] && idx[h].length_m) pct[h] = Math.min(100, Math.round((len[h] || 0) / idx[h].length_m * 100));
  const r = districtRanking(S.items, S.hoods, pct);
  root.innerHTML = `<div class="card"><h2>${icon("rank")} ترتيب الأحياء هذا الأسبوع</h2><p class="muted small">الترتيب يجمع: أهداف موثّقة من نوعك لم تُزَر ×3، عقاراتك المسجّلة ×2، ونسبة الاستكشاف. ابدأ بالأعلى.</p>${r.map((x, i) => `<div class="obj"><span><b>${i + 1}.</b> ${esc(x.ar)}</span><b>${x.score}</b><div class="s muted small" style="grid-column:1/-1">${x.myType} هدف من نوعك (${x.remaining} لم يُزَر) · ${x.properties} عقار · ${x.explored}% مستكشف</div></div>`).join("")}</div>
    <div class="card"><h2>${icon("script")} دليل شمال الرياض</h2><ol class="small" style="padding-inline-start:20px;margin:0">
      <li><b>النرجس والعارض:</b> مخططات حديثة واسعة، أكثر المباني الفردية الجديدة، ومنافسة مكاتب عالية. ركّز على الشوارع الداخلية لا الرئيسية.</li>
      <li><b>الياسمين والملقا:</b> ناضجة وأغلى؛ الفرص في إعادة البناء على القطع القديمة والفلل المعروضة بلوحات.</li>
      <li><b>القيروان:</b> تطوير نشط ومتدرّج؛ المطوّرون الأفراد يبنون 2–6 وحدات، مناسب لعقود الوساطة المبكرة.</li>
      <li><b>الملز (وسط):</b> هدم وإعادة بناء على قطع مفردة؛ الملاك كبار السن وأرقامهم من الجيران غالباً.</li>
      <li>كرّر الترتيب أسبوعياً حسب: عرض (أهداف من نوعك)، طلب (طلبات مشترين للحي)، سعر (متوسط المتر)، تغطية (شوارع لم تمر بها)، منافسة (لوحات المكاتب الكبيرة).</li>
    </ol></div>
    <div class="card"><h2>${icon("building")} كيف تميّز المطوّر الفرد</h2><ul class="small" style="padding-inline-start:20px;margin:0">
      <li>مبنى واحد أو 2–6 وحدات متجاورة بنفس التصميم، بلا مكتب مبيعات ولا لوحة شركة كبيرة.</li>
      <li>لوحة المقاول صغيرة أو مكتوبة بخط اليد، أو اسم شخص بدل اسم شركة، ورقم جوال واحد.</li>
      <li>المالك أو ابنه يزور الموقع صباحاً؛ اسأل العمال: "صاحب المشروع متى يجي؟".</li>
      <li>سيارة خاصة بلا شعار مركونة باستمرار، ومواد بناء تُشترى بالتجزئة.</li>
      <li>في الكشّاف: النوع "مبنى مفرد" أو "مطوّر صغير" ودرجة 80 فأكثر وموثّق بالعين.</li>
      <li>أول سؤال: "تبيع على الخارطة أو بعد التسليم؟" ثم اعرض عقد وساطة لا حصرية.</li>
    </ul></div>`;
}
function subExcel(root) {
  root.innerHTML = `<div class="card"><h2>${icon("file")} تصدير كل شيء إلى Excel</h2><p class="muted small">ورقة لكل نوع: العقارات بكل حقولها، الأهداف، اللوحات، سجل الاتصال، طلبات المشترين، المقاولون، المتوسطات، التسليم، الجولات. هذا الملف لك ويحوي بيانات المالكين؛ لا ترسله للمكتب (استخدم «تسليم المكتب»).</p><button class="btn primary big" id="xl-export">${icon("backup")} تصدير Excel</button><p id="xl-msg" class="msg"></p></div>
    <div class="card"><h2>${icon("file")} استيراد من المتعقّب القديم</h2><p class="muted small">ملف Excel أو CSV. تُقرأ أعمدته: الكود، الحي، النوع، الحالة، المساحة، الغرف، السعر، قابل للتفاوض، جدية المالك، سبب البيع، حالة الصك، أقل سعر متوقع، صفة جهة الاتصال، الاسم، الجوال، عند مكاتب ثانية، حالة المتابعة، المتابعة القادمة، الموقع، ملاحظات. الأرقام العربية تُفهم، والأعمدة الناقصة تُترك فارغة.</p><label class="btn secondary big">${icon("file")} اختر ملف Excel<input type="file" accept=".xlsx,.xls,.csv" hidden id="xl-import"></label><p id="xl-imsg" class="msg"></p></div>`;
  $("#xl-export", root).onclick = async () => { const m = $("#xl-msg", root); m.textContent = "جارٍ التجهيز…"; try { await exportWorkbook(exportSheets(S.items), `mustakshif-${todayIso()}.xlsx`); m.textContent = "تم."; m.className = "msg ok"; } catch (e) { m.textContent = "تعذّر: يلزم اتصال بالإنترنت أول مرة لتحميل مكتبة Excel."; m.className = "msg err"; } };
  $("#xl-import", root).onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; const m = $("#xl-imsg", root); m.textContent = "جارٍ القراءة…"; try { const rows = await importWorkbook(f); let n = 0; const existing = new Set(store.all("property").map(p => p.data.code)); for (const d of rows) { if (d.code && existing.has(d.code)) continue; await store.create("property", d); n++; } m.textContent = `تم استيراد ${n} عقاراً${rows.length - n ? ` (تم تخطي ${rows.length - n} بكود موجود)` : ""}.`; m.className = "msg ok"; ctx.refreshMap(); } catch (err) { m.textContent = "الملف غير مقروء."; m.className = "msg err"; console.error(err); } };
}
export function legendHtml() {
  const sw = (v) => `<div class="sw" style="background:${v}"></div>`;
  const cs = getComputedStyle(document.documentElement); const t = (n) => cs.getPropertyValue(n).trim();
  return `<div class="legend">
    ${sw(t("--map-explored"))}<span>شارع مررت به (مضيء)</span>${sw(t("--map-faded"))}<span>مررت به قبل أكثر من ${CONFIG.FADE_DAYS || 60} يوماً (باهت، يحتاج مروراً جديداً)</span>${sw(t("--map-unexplored"))}<span>شارع لم تستكشفه (ضباب، متقطع)</span>${sw(t("--map-major"))}<span>شارع رئيسي</span>${sw(t("--map-border"))}<span>حدود الحي الحالي (متوهجة)</span>
    <span class="pin pin-target">${icon("target")}</span><span>هدف الكشّاف (برتقالي؛ إطار أسمك = درجة 80+؛ هالة = من نوعك)</span>
    <span class="pin pin-visited">${icon("target")}</span><span>هدف تمت زيارته</span><span class="pin pin-ignored">${icon("target")}</span><span>هدف متجاهل</span>
    <span class="pin pin-property">${icon("home")}</span><span>عقار مسجّل</span><span class="pin pin-sign">${icon("sign")}</span><span>لوحة مصوّرة</span><span class="pin pin-contractor">${icon("building")}</span><span>مقاول أو مكتب هندسي</span>
    <span class="me">${icon("nav")}</span><span>موقعك واتجاهك، والدائرة حوله = دقة GPS</span>
  </div>`;
}
function subLegend(root) { root.innerHTML = `<div class="card"><h2>${icon("layers")} مفتاح رموز الخريطة</h2>${legendHtml()}</div>`; }
export function openLegend() { openSheet("مفتاح الرموز", legendHtml()); }
function subSettings(root) {
  const choice = themeChoice(); const st = sync.state; const broker = store.setting("broker") || {};
  root.innerHTML = `
    <div class="card"><h2>${icon("theme")} المظهر</h2><select id="s-theme">${THEMES.map(t => `<option value="${t.id}" ${t.id === choice ? "selected" : ""}>${esc(t.ar)}</option>`).join("")}</select><p class="hint">تلقائي: نهار ساطع من الشروق إلى الغروب، وليل نيون بعده.</p>
      <label class="check"><input type="checkbox" id="s-osm" ${localStorage.getItem("mustakshif.osm") === "1" ? "checked" : ""}> إظهار خريطة OpenStreetMap تحت الشوارع</label></div>
    <div class="card"><h2>${icon("users")} بياناتي كوسيط</h2><p class="muted">${broker.name ? esc([broker.name, broker.license && "فال " + broker.license, broker.office, broker.phone].filter(Boolean).join(" · ")) : "لم تُدخل بعد"}</p><button class="btn secondary big" id="s-broker">${icon("edit")} تعديل</button></div>
    <div class="card"><h2>${icon("sync")} المزامنة</h2><p class="muted" id="s-sync-text">${esc({ idle: "…", syncing: "يزامن", synced: "متزامن", offline: "بلا اتصال", error: "خطأ" }[st.status] || st.status)}${st.pending ? " · " + st.pending + " بانتظار الرفع" : ""}${st.error ? " · " + esc(st.error) : ""}</p><button class="btn secondary big" id="s-sync-now">${icon("sync")} مزامنة الآن</button></div>
    <div class="card"><h2>${icon("backup")} النسخة الاحتياطية الكاملة</h2><p class="muted small" id="s-last-backup"></p><label class="check"><input id="s-with-photos" type="checkbox" checked> تضمين الصور والفيديو (ملف أكبر)</label><div class="sheet-actions"><button class="btn primary big" id="s-export">${icon("backup")} تصدير نسخة بضغطة</button><label class="btn secondary big">${icon("file")} استيراد نسخة<input id="s-import" type="file" accept=".json" hidden></label></div><p id="s-backup-msg" class="msg"></p></div>
    <div class="card"><h2>${icon("map")} الشوارع</h2><p class="muted" id="s-cov"></p><button class="btn danger big" id="s-reset-hood">${icon("trash")} مسح استكشاف ${esc(hoodAr(S.hood))}</button></div>
    <div class="card"><h2>${icon("settings")} الحساب</h2><p class="muted" dir="ltr">${esc(S.email || "")}</p><form id="form-change"><label>كلمة مرور جديدة <input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn secondary big" type="submit">تغيير كلمة المرور</button></form><button class="btn danger big" id="s-logout" style="margin-top:8px">تسجيل الخروج</button></div>
    <div class="card"><p class="muted small">مستكشف ${esc(CONFIG.APP_VERSION)} · بيانات الشوارع من OpenStreetMap (ODbL). <a href="#" id="s-reconnect">تغيير إعدادات الاتصال</a></p></div>`;
  db.meta("lastBackup").then(v => { const el = $("#s-last-backup", root); if (el) el.textContent = v ? "آخر نسخة: " + fmtDate(v) : "لم تُؤخذ نسخة بعد. يُذكّرك التطبيق كل 7 أيام."; });
  $("#s-theme", root).onchange = (e) => { setTheme(e.target.value); toast("تم تغيير المظهر"); };
  $("#s-osm", root).onchange = (e) => { localStorage.setItem("mustakshif.osm", e.target.checked ? "1" : "0"); ctx.setOsm(e.target.checked); };
  $("#s-broker", root).onclick = () => openBroker();
  $("#s-sync-now", root).onclick = () => sync.run();
  const c = ctx.coverage(); $("#s-cov", root).textContent = `${hoodAr(S.hood)}: ${c.streets} شارع مستكشف من ${c.allStreets} (${c.pct}% من الطول، ${(c.done / 1000).toFixed(1)} من ${(c.total / 1000).toFixed(1)} كم)${c.faded ? ` · ${c.faded} مقطعاً مضى عليه أكثر من ${CONFIG.FADE_DAYS || 60} يوماً` : ""}`;
  $("#s-reset-hood", root).onclick = async () => { if (!confirmAr(`مسح كل الشوارع المستكشفة في ${hoodAr(S.hood)}؟`)) return; await store.clearExplored(S.hood); await ctx.reloadHood(); toast("تم المسح"); renderSub("settings"); };
  $("#form-change", root).onsubmit = async (e) => { e.preventDefault(); try { await auth.changePassword(e.target.password.value); e.target.reset(); toast("تم تغيير كلمة المرور"); } catch (err) { toast(arabicError(err), 4000); } };
  $("#s-logout", root).onclick = async () => { if (sync.state.pending > 0 && !confirmAr(`يوجد ${sync.state.pending} تغيير لم يُرفع بعد. الخروج الآن يبقيه على هذا الجهاز حتى الدخول القادم. متابعة؟`)) return; await db.meta("loggedOut", true); await auth.logout(); };
  $("#s-reconnect", root).onclick = (e) => { e.preventDefault(); if (confirmAr("سيُعاد فتح شاشة إعدادات الاتصال. البيانات المحلية تبقى.")) { localStorage.removeItem("mustakshif.connection"); location.reload(); } };
  $("#s-export", root).onclick = () => ctx.exportBackup($("#s-with-photos", root).checked, $("#s-backup-msg", root)).then(() => renderSub("settings"));
  $("#s-import", root).onchange = (e) => ctx.importBackup(e.target.files[0], $("#s-backup-msg", root)).finally(() => e.target.value = "");
}
/** street sheet: name, last driven, manual mark/unmark */
export function openStreet(info, onToggle) {
  const root = openSheet(info.name || "شارع بلا اسم", `<p class="muted">${info.explored ? `آخر مرور: ${esc(info.lastDriven ? fmtDate(info.lastDriven) : "—")}` : "لم تمر به بعد"}</p>
    <div class="sheet-actions"><button class="btn ${info.explored ? "secondary" : "primary"} big" id="st-toggle">${info.explored ? "إلغاء الاستكشاف" : "علّمه مستكشفاً يدوياً"}</button></div>`);
  $("#st-toggle", root).onclick = async () => { await onToggle(!info.explored); closeSheet(); };
}
export { openItem };
