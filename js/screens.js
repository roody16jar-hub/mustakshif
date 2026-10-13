// Screens: today, properties, targets, more (+ sub screens). Pure rendering over store + domain.
import { S, store } from "./store.js";
import { ctx } from "./ctx.js";
import { $, $$, esc, toast, confirmAr, openSheet, closeSheet, pill, empty, fmtDate, fmtNum, formHtml, bindAutosave } from "./ui.js";
import { icon } from "./icons.js";
import { openProperty, openTarget, openSign, openContact, openRequest, openContractor, openPriceAvg, openBroker, waLink, telLink } from "./forms.js";
import { HOODS, PROPERTY_TYPES, PROPERTY_STATUS, TARGET_STATUS, CONTACT_OUTCOME, matchAll, priceCheck, PRICE_VERDICT, handoverText, handoverRows, assertOfficeSafe, weeklyStats, districtRanking, objectives, dueFollowups, todayTargets, scoutSummary, sessionSummary, callScripts, SCRIPT_TITLES, exportSheets, todayIso } from "./domain.js";
import { exportWorkbook, importWorkbook } from "./excel.js";
import { THEMES, themeChoice, setTheme } from "./theme.js";
import { sync } from "./sync.js";
import { auth, arabicError } from "./auth.js";
import { db } from "./db.js";
import { CONFIG } from "./config.js";

const hoodAr = (h) => S.hoods[h]?.ar || HOODS[h] || h || "";
const typeAr = (t) => PROPERTY_TYPES[t] || t || "";
const li = (id, title, badge, sub, date) => `<li class="item" data-id="${id}"><div class="t">${title}</div>${badge}<div class="s">${sub}</div>${date || ""}</li>`;
const dueHtml = (f) => f ? `<div class="d ${f < todayIso() ? "over" : ""}">${icon("clock")} ${esc(f)}</div>` : "";
function openItem(id) {
  const it = store.get(id); if (!it) return;
  ({ property: openProperty, target: openTarget, sign: openSign, request: openRequest, contractor: openContractor, price_avg: openPriceAvg, contact: (i) => openContact(store.get(i.data.ref_id) || null, i) }[it.kind] || (() => {}))(it);
}
function wireList(root) { $$("[data-id]", root).forEach(el => el.onclick = () => openItem(el.dataset.id)); }

// ---------------- اليوم ----------------
export function renderToday() {
  const root = $("#today"); const items = S.items; const hood = S.hood;
  const due = dueFollowups(items); const tg = todayTargets(items, hood); const obj = objectives(hood, items, ctx.coverage());
  const sessions = store.all("session").sort((a, b) => b.created_at < a.created_at ? -1 : 1);
  const reqs = matchAll(store.all("request"), store.all("property")).filter(r => r.matches.length);
  const stats = weeklyStats(items);
  const broker = store.setting("broker") || {};
  root.innerHTML = `
    <div class="card"><h2>${icon("car")} جولة اليوم في ${esc(hoodAr(hood))}</h2>
      <p class="muted">${broker.name ? "أهلاً " + esc(broker.name) + ". " : ""}${new Date().toLocaleDateString("ar-SA-u-nu-latn", { weekday: "long", day: "numeric", month: "long" })}</p>
      <button class="btn primary field" data-go="map">${icon("play")} ابدأ التتبّع</button>
    </div>
    <div class="card"><h2>${icon("clock")} متابعات مستحقة <span class="badge ${due.some(x => x.overdue) ? "warn" : ""}">${due.length}</span></h2>
      ${due.length ? `<ul class="list" style="padding:0">${due.slice(0, 8).map(x => li(x.item.id, esc(x.item.data.title || x.item.data.ref || x.item.data.buyer_name || x.item.data.text || "سجل"), pill(x.overdue ? "warn" : "new", x.overdue ? "متأخر" : "اليوم"), esc(hoodAr(x.item.data.hood)) + " · " + esc({ property: "عقار", target: "هدف", contact: "اتصال", request: "طلب مشترٍ", sign: "لوحة" }[x.item.kind] || x.item.kind), dueHtml(x.date))).join("")}</ul>` : `<p class="muted">لا متابعات اليوم. ممتاز.</p>`}
    </div>
    <div class="card"><h2>${icon("target")} أهداف تستحق الزيارة</h2>
      ${tg.length ? `<ul class="list" style="padding:0">${tg.map(t => li(t.id, esc(t.data.ref), pill("new", "درجة " + t.data.score), esc([t.data.kind_label, t.data.phase].filter(Boolean).join(" · ")))).join("")}</ul>` : `<p class="muted">لا أهداف جديدة موثّقة من نوعك في هذا الحي. ${store.all("target").length ? "غيّر الحي من الخريطة." : "شغّل الكشّاف ثم ارفع الأهداف (المزيد > الكشّاف)."}</p>`}
    </div>
    <div class="card"><h2>${icon("flag")} أهداف الحي</h2>${obj.map(o => `<div class="obj"><span>${esc(o.title)}</span><b>${o.done}/${o.total}</b><div class="progress"><i style="width:${o.pct}%"></i></div></div>`).join("")}</div>
    ${reqs.length ? `<div class="card"><h2>${icon("users")} مطابقات لطلبات المشترين</h2>${reqs.map(r => `<div class="obj"><span>${esc(r.request.data.buyer_name || "مشترٍ")} · ${esc(hoodAr(r.request.data.hood))} ${esc(typeAr(r.request.data.type))}</span><b>${r.matches.length}</b></div>`).join("")}<button class="btn secondary big" data-sub="requests">عرض المطابقات</button></div>` : ""}
    <div class="card"><h2>${icon("chart")} هذا الأسبوع</h2><div class="kv"><div><b>${stats.thisWeek.properties}</b><span>عقار جديد</span></div><div><b>${stats.thisWeek.contacts}</b><span>اتصال</span></div><div><b>${stats.thisWeek.visited}</b><span>هدف تمت زيارته</span></div><div><b>${stats.thisWeek.km.toFixed ? stats.thisWeek.km.toFixed(1) : stats.thisWeek.km}</b><span>كم قيادة</span></div></div><button class="btn link" data-sub="stats">كل الإحصاءات</button></div>
    ${sessions.length ? `<div class="card"><h2>${icon("car")} آخر جولة</h2><p>${esc(fmtDate(sessions[0].created_at))} · ${esc(hoodAr(sessions[0].data.hood))}: ${esc(sessionSummary(sessions[0]))}</p></div>` : ""}`;
  wireList(root);
  $$("[data-go]", root).forEach(b => b.onclick = () => ctx.go(b.dataset.go));
  $$("[data-sub]", root).forEach(b => b.onclick = () => ctx.openSub(b.dataset.sub));
}

// ---------------- العقارات ----------------
export function renderProps() {
  const q = ($("#p-q").value || "").trim(); const st = $("#p-status").value;
  const sel = $("#p-status"); if (sel.options.length === 1) for (const [k, v] of Object.entries(PROPERTY_STATUS)) sel.add(new Option(v, k));
  const list = store.all("property").filter(p => (!st || p.data.status === st) && (!q || JSON.stringify(p.data).includes(q))).sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  const root = $("#p-list");
  root.innerHTML = list.length ? list.map(p => { const d = p.data; const v = priceCheck(p, store.all("price_avg")); return li(p.id, `${esc(hoodAr(d.hood))} · ${esc(typeAr(d.type))}${d.title ? " · " + esc(d.title) : ""}`, pill(d.status || "new", PROPERTY_STATUS[d.status] || "جديد"), [d.area ? d.area + " م²" : "", d.price ? fmtNum(d.price) + " ر" : "", v.verdict !== "unknown" ? PRICE_VERDICT[v.verdict] : "", d.owner_name ? "مالك: " + esc(d.owner_name) : "", (d.photos || []).length ? (d.photos.length + " صورة") : ""].filter(Boolean).join(" · "), dueHtml(d.next_followup)); }).join("")
    : empty("home", "لا توجد عقارات بعد", "اضغط «عقار جديد»، أو من الخريطة: اضغط مطوّلاً على الموقع، أو زر «سجّلت عقار هنا» أثناء التتبّع.");
  wireList(root);
}

// ---------------- الأهداف ----------------
const tFilters = { my: true, verified: true };
export function renderTargets() {
  const q = ($("#t-q").value || "").trim(); const st = $("#t-status").value;
  let list = store.all("target").filter(t => t.data.hood === S.hood);
  const all = list.length;
  if (tFilters.my) list = list.filter(t => t.data.my_type);
  if (tFilters.verified) list = list.filter(t => t.data.verified);
  list = list.filter(t => (!st || (t.data.status || "new") === st) && (!q || JSON.stringify(t.data).includes(q))).sort((a, b) => (b.data.score || 0) - (a.data.score || 0));
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
  requests: ["users", "طلبات المشترين", "الطلبات والمطابقة التلقائية"], handover: ["send", "تسليم المكتب", "نص وExcel بلا بيانات المالك"], stats: ["chart", "الإحصاءات الأسبوعية", "الإنتاجية ونسبة التحويل"],
  contractors: ["building", "المقاولون", "جهات اتصال في الميدان"], averages: ["money", "متوسطات الأسعار", "سعر المتر لكل حي ونوع"], scripts: ["script", "سكربتات الاتصال", "ماذا أقول للمالك والمقاول"],
  ranking: ["rank", "دليل ترتيب الأحياء", "أين أركّز هذا الأسبوع"], excel: ["file", "Excel", "تصدير كل شيء واستيراد المتعقّب القديم"], settings: ["settings", "الإعدادات", "المظهر، الحساب، المزامنة، النسخة الاحتياطية"],
};
export function renderMore() {
  $("#more-menu").innerHTML = Object.entries(SUBS).map(([id, [ic, t, s]]) => `<li data-sub="${id}">${icon(ic)}<span>${esc(t)}<br><small>${esc(s)}</small></span>${icon("back")}</li>`).join("");
  $$("#more-menu [data-sub]").forEach(el => el.onclick = () => ctx.openSub(el.dataset.sub));
}
export function renderSub(id) {
  const root = $("#sub"); const r = { scout: subScout, signs: subSigns, contacts: subContacts, requests: subRequests, handover: subHandover, stats: subStats, contractors: subContractors, averages: subAverages, scripts: subScripts, ranking: subRanking, excel: subExcel, settings: subSettings }[id];
  if (r) r(root); wireList(root); $$("[data-sub]", root).forEach(b => b.onclick = () => ctx.openSub(b.dataset.sub));
}
const addBtn = (label, fn) => { const b = document.createElement("button"); b.className = "btn primary big"; b.innerHTML = icon("plus") + " " + label; b.onclick = fn; return b; };

function subScout(root) {
  const hoods = Object.keys(S.hoods).filter(h => !h.startsWith("_"));
  const rows = hoods.map(h => scoutSummary(S.items, h)).filter(s => s.total || S.hood === s.hood);
  root.innerHTML = `<div class="card"><h2>${icon("scout")} الكشّاف</h2><p class="muted small">الأهداف تأتي من فحص الأقمار الصناعية على جهازك. لرفع نتائج جديدة: على الكمبيوتر <code dir="ltr">python tools/upload_targets.py</code> (يطلب كلمة مرورك ولا يحفظها). أو استورد ملف targets.json هنا.</p><label class="btn secondary big">${icon("file")} استيراد targets.json<input type="file" accept=".json" hidden id="t-import"></label></div>
    ${rows.map(s => `<div class="card"><h2>${esc(hoodAr(s.hood))} ${s.scan_date ? `<span class="badge">فحص ${esc(s.scan_date)}</span>` : pill("ignored", "لم يُفحص")}</h2><div class="kv"><div><b>${s.total}</b><span>إجمالي الأهداف</span></div><div><b>${s.verified}</b><span>موثّق بالعين</span></div><div><b>${s.my_type}</b><span>من نوعي</span></div><div><b>${s.visited}</b><span>تمت زيارتها</span></div><div><b>${s.remaining}</b><span>متبقٍ من نوعي</span></div><div><b>${s.ignored}</b><span>متجاهل</span></div></div></div>`).join("")}`;
  $("#t-import", root).onchange = (e) => ctx.importTargets(e.target.files[0]).finally(() => e.target.value = "");
}
function subSigns(root) {
  const list = store.all("sign").sort((a, b) => b.updated_at > a.updated_at ? 1 : -1);
  root.innerHTML = `<ul class="list" style="padding:0">${list.length ? list.map(s => li(s.id, `${esc(hoodAr(s.data.hood))} · ${esc(s.data.phone || "بلا رقم")}`, pill(s.data.status === "new" ? "new" : s.data.status === "done" ? "ignored" : "visited", { new: "جديدة", called: "تم الاتصال", property: "عقار", done: "منتهية" }[s.data.status] || s.data.status), esc([s.data.text, (s.data.photos || []).length ? s.data.photos.length + " صورة" : "", s.data.note].filter(Boolean).join(" · ")), dueHtml(s.data.next_followup))).join("") : empty("sign", "لا لوحات مصوّرة بعد", "من الخريطة أثناء التتبّع: «صوّر لوحة». تُحفظ الصورة والرقم والموقع.")}</ul>`;
  root.appendChild(addBtn("لوحة جديدة هنا", async () => { const p = await ctx.locate().catch(() => null); openSign(null, p ? { lat: p.lat, lon: p.lon } : {}); }));
}
function subContacts(root) {
  const list = store.all("contact").sort((a, b) => (b.data.at || b.created_at) > (a.data.at || a.created_at) ? 1 : -1);
  root.innerHTML = `<ul class="list" style="padding:0">${list.length ? list.map(c => li(c.id, esc(c.data.ref_title || "اتصال عام"), pill(c.data.outcome === "deal" || c.data.outcome === "interested" ? "done" : c.data.outcome === "follow_up" ? "new" : "ignored", CONTACT_OUTCOME[c.data.outcome] || c.data.outcome), esc([fmtDate(c.data.at || c.created_at), { call: "اتصال", visit: "زيارة", whatsapp: "واتساب", sms: "رسالة" }[c.data.channel], c.data.note].filter(Boolean).join(" · ")), dueHtml(c.data.next_followup))).join("") : empty("phone", "لا اتصالات مسجّلة", "من بطاقة أي عقار أو هدف أو لوحة: «سجّل اتصالاً».")}</ul>`;
  root.appendChild(addBtn("اتصال عام", () => openContact(null)));
}
function subRequests(root) {
  const all = matchAll(store.all("request"), store.all("property"));
  root.innerHTML = all.length ? all.map(({ request: r, matches }) => `<div class="card"><h2>${esc(r.data.buyer_name || "مشترٍ")} ${pill(r.data.status === "open" ? "new" : "ignored", { open: "مفتوح", matched: "مطابَق", closed: "مغلق" }[r.data.status] || "")}</h2>
      <p class="muted small">${esc(hoodAr(r.data.hood))} · ${esc(typeAr(r.data.type))} · ${r.data.budget_min || r.data.budget_max ? `من ${fmtNum(r.data.budget_min) || "—"} إلى ${fmtNum(r.data.budget_max) || "—"}` : "بلا ميزانية"}${r.data.area_min ? " · ≥ " + r.data.area_min + " م²" : ""}</p>
      <div class="row"><button class="btn secondary" data-id="${r.id}">${icon("edit")} تعديل الطلب</button>${r.data.buyer_phone ? `<a class="btn secondary" href="${telLink(r.data.buyer_phone)}">${icon("phone")} اتصال</a>` : ""}</div>
      ${matches.length ? `<h3 style="margin-top:12px">${matches.length} عقار مطابق</h3><ul class="list" style="padding:0">${matches.map(m => li(m.property.id, `${esc(hoodAr(m.property.data.hood))} · ${esc(typeAr(m.property.data.type))}${m.property.data.title ? " · " + esc(m.property.data.title) : ""}`, pill("done", m.score + "%"), esc(m.why.join(" · ")) + (m.property.data.price ? " · " + fmtNum(m.property.data.price) + " ر" : ""))).join("")}</ul>` : `<p class="muted small">لا عقار مطابق بعد.</p>`}
    </div>`).join("") : empty("users", "لا طلبات مشترين", "سجّل طلب كل مشترٍ (الحي، النوع، الميزانية) وسيُطابق تلقائياً مع عقاراتك.");
  root.appendChild(addBtn("طلب جديد", () => openRequest(null)));
}
function subHandover(root) {
  const broker = store.setting("broker") || {};
  const cands = store.all("property").filter(p => !["handed", "closed", "ignored"].includes(p.data.status));
  const log = store.all("handover").sort((a, b) => b.created_at < a.created_at ? -1 : 1);
  root.innerHTML = `<div class="card"><h2>${icon("send")} تسليم عقارات للمكتب</h2>
      ${!broker.name ? `<div class="notice">${icon("alert")} أضف بياناتك كوسيط أولاً <button class="btn link" data-broker>تعديل</button></div>` : ""}
      <p class="muted small">اختر العقارات. التقرير لا يحوي اسم المالك ولا جواله ولا السعر الأدنى، ويُحذف أي رقم جوال من الملاحظات.</p>
      ${cands.length ? cands.map(p => `<label class="check"><input type="checkbox" value="${p.id}"> ${esc(hoodAr(p.data.hood))} · ${esc(typeAr(p.data.type))}${p.data.title ? " · " + esc(p.data.title) : ""}${p.data.price ? " · " + fmtNum(p.data.price) : ""}</label>`).join("") : `<p class="muted">لا عقارات جاهزة للتسليم.</p>`}
      <label>اسم المكتب أو المستلم <input id="ho-to" value="${esc(broker.office || "")}"></label>
      <button class="btn primary big" id="ho-gen" ${cands.length ? "" : "disabled"}>${icon("file")} أنشئ التقرير</button>
      <div id="ho-out"></div></div>
    <div class="card"><h2>${icon("clock")} سجل التسليم</h2>${log.length ? log.map(h => `<div class="stat-row"><span>${esc(fmtDate(h.data.at || h.created_at))} · ${esc(h.data.to || "")}</span><b>${(h.data.property_ids || []).length} عقار</b></div>`).join("") : `<p class="muted">لا تسليمات بعد.</p>`}${log.length ? `<button class="btn secondary big" id="ho-xlsx-log">${icon("file")} Excel سجل التسليم</button>` : ""}</div>`;
  const b = $("[data-broker]", root); if (b) b.onclick = () => openBroker();
  $("#ho-gen", root).onclick = () => {
    const ids = $$("input[type=checkbox]:checked", root).map(c => c.value); if (!ids.length) { toast("اختر عقاراً واحداً على الأقل"); return; }
    const props = ids.map(id => store.get(id)); const to = $("#ho-to", root).value;
    const text = handoverText(props, broker);
    let safe = true; try { assertOfficeSafe(text, props, broker); } catch (e) { safe = false; console.error(e); }
    $("#ho-out", root).innerHTML = `<div class="notice ${safe ? "" : "err"}">${icon(safe ? "check" : "alert")} ${safe ? "تم التحقق: التقرير لا يحوي بيانات المالك." : "تنبيه: وُجد رقم في النص، راجعه قبل الإرسال."}</div><pre class="report">${esc(text)}</pre>
      <div class="sheet-actions"><button class="btn primary big" id="ho-copy">${icon("file")} نسخ النص</button><a class="btn secondary big" href="${waLink(text)}" target="_blank" rel="noopener">${icon("wa")} إرسال بواتساب</a><button class="btn secondary big" id="ho-xlsx">${icon("file")} Excel مع سجل التسليم</button><button class="btn secondary big" id="ho-log">${icon("check")} سجّل التسليم وعلّم العقارات «سُلّم»</button></div>`;
    $("#ho-copy", root).onclick = async () => { try { await navigator.clipboard.writeText(text); toast("نُسخ"); } catch { toast("تعذّر النسخ، حدّد النص يدوياً"); } };
    $("#ho-xlsx", root).onclick = () => exportWorkbook({ "تسليم المكتب": handoverRows(props), "سجل التسليم": log.map(h => ({ "التاريخ": (h.data.at || h.created_at).slice(0, 10), "إلى": h.data.to || "", "عدد العقارات": (h.data.property_ids || []).length })) }, `handover-${todayIso()}.xlsx`).catch(() => toast("تعذّر إنشاء Excel (يلزم اتصال أول مرة)"));
    $("#ho-log", root).onclick = async () => { await store.create("handover", { at: new Date().toISOString(), to, property_ids: ids, text }); for (const p of props) { p.data.status = "handed"; await store.save(p); } toast("سُجّل التسليم"); renderSub("handover"); };
  };
  const xl = $("#ho-xlsx-log", root); if (xl) xl.onclick = () => exportWorkbook({ "سجل التسليم": log.map(h => ({ "التاريخ": (h.data.at || h.created_at).slice(0, 10), "إلى": h.data.to || "", "عدد العقارات": (h.data.property_ids || []).length, "النص": h.data.text || "" })) }, `handover-log-${todayIso()}.xlsx`);
}
function subStats(root) {
  const s = weeklyStats(S.items); const row = (l, a, b) => `<div class="stat-row"><span>${l}</span><b>${a} <span class="muted small">(الأسبوع الماضي ${b})</span></b></div>`;
  root.innerHTML = `<div class="card"><h2>${icon("chart")} هذا الأسبوع مقابل الماضي</h2>${row("عقارات جديدة", s.thisWeek.properties, s.lastWeek.properties)}${row("اتصالات وزيارات", s.thisWeek.contacts, s.lastWeek.contacts)}${row("أهداف تمت زيارتها", s.thisWeek.visited, s.lastWeek.visited)}${row("لوحات مصوّرة", s.thisWeek.signs, s.lastWeek.signs)}${row("تسليمات للمكتب", s.thisWeek.handovers, s.lastWeek.handovers)}${row("جولات", s.thisWeek.sessions, s.lastWeek.sessions)}${row("كيلومترات", s.thisWeek.km.toFixed(1), s.lastWeek.km.toFixed(1))}</div>
    <div class="card"><h2>${icon("rank")} قمع التحويل (كل الوقت)</h2><div class="kv"><div><b>${s.funnel.total}</b><span>عقار مسجّل</span></div><div><b>${s.funnel.contacted}</b><span>تم التواصل (${s.conversion.contacted}%)</span></div><div><b>${s.funnel.listed}</b><span>مدرج (${s.conversion.listed}% من المتواصَل معهم)</span></div><div><b>${s.funnel.handed}</b><span>سُلّم للمكتب (${s.conversion.handed}% من المدرج)</span></div></div></div>`;
}
function subContractors(root) {
  const list = store.all("contractor").sort((a, b) => (a.data.name || "").localeCompare(b.data.name || ""));
  root.innerHTML = `<ul class="list" style="padding:0">${list.length ? list.map(c => li(c.id, esc(c.data.name || "بلا اسم"), pill("", esc(c.data.specialty || "")), esc([c.data.phone, c.data.hoods, c.data.note].filter(Boolean).join(" · ")))).join("") : empty("building", "لا مقاولين بعد", "سجّل كل مقاول أو مطوّر تقابله في الميدان مع تخصصه وأحيائه.")}</ul>`;
  root.appendChild(addBtn("مقاول جديد", () => openContractor(null)));
}
function subAverages(root) {
  const list = store.all("price_avg").sort((a, b) => (a.data.hood || "").localeCompare(b.data.hood || ""));
  root.innerHTML = `<div class="card"><p class="muted small">أدخل متوسط سعر المتر لكل حي ونوع من خبرتك أو من صفقات حديثة. يُستخدم لفحص سعر كل عقار تسجّله.</p></div><ul class="list" style="padding:0">${list.length ? list.map(a => li(a.id, `${esc(hoodAr(a.data.hood))} · ${esc(a.data.type === "any" ? "كل الأنواع" : typeAr(a.data.type))}`, pill("done", fmtNum(a.data.price_per_m2) + " ر/م²"), esc(a.data.note || ""))).join("") : empty("money", "لا متوسطات بعد", "أضف متوسط سعر المتر لحيّك الآن.")}</ul>`;
  root.appendChild(addBtn("متوسط جديد", () => openPriceAvg(null)));
}
function subScripts(root) {
  const broker = store.setting("broker") || {}; const over = store.setting("scripts") || {}; const s = callScripts(broker, over);
  root.innerHTML = `<div class="card"><p class="muted small">النصوص تحمل اسمك ورخصتك ومكتبك تلقائياً. ${broker.name ? "" : `<button class="btn link" data-broker>أضف بياناتك</button>`} عدّل أي نص ويُحفظ لك.</p></div>` + Object.entries(s).map(([k, v]) => `<div class="card"><h2>${esc(SCRIPT_TITLES[k])}</h2><textarea data-script="${k}" rows="5">${esc(v)}</textarea><div class="row"><button class="btn secondary" data-copy="${k}">نسخ</button><button class="btn secondary" data-reset="${k}">النص الأصلي</button></div></div>`).join("");
  const b = $("[data-broker]", root); if (b) b.onclick = () => openBroker();
  $$("[data-script]", root).forEach(t => t.oninput = async () => { const o = store.setting("scripts") || {}; o[t.dataset.script] = t.value; await store.setSetting("scripts", o); });
  $$("[data-copy]", root).forEach(x => x.onclick = async () => { try { await navigator.clipboard.writeText($(`[data-script="${x.dataset.copy}"]`, root).value); toast("نُسخ"); } catch { toast("تعذّر النسخ"); } });
  $$("[data-reset]", root).forEach(x => x.onclick = async () => { const o = store.setting("scripts") || {}; delete o[x.dataset.reset]; await store.setSetting("scripts", o); renderSub("scripts"); });
}
function subRanking(root) {
  const pct = {}; const idx = ctx.streetIndex || {}; const counts = ctx.exploredCounts || {};
  for (const h of Object.keys(S.hoods)) if (idx[h]) pct[h] = Math.round((counts[h] || 0) / idx[h].streets * 100);
  const r = districtRanking(S.items, S.hoods, pct);
  root.innerHTML = `<div class="card"><h2>${icon("rank")} ترتيب الأحياء هذا الأسبوع</h2><p class="muted small">الترتيب يجمع: أهداف موثّقة من نوعك لم تُزَر ×3، عقاراتك المسجّلة ×2، ونسبة الاستكشاف. ابدأ بالأعلى.</p>${r.map((x, i) => `<div class="obj"><span><b>${i + 1}.</b> ${esc(x.ar)}</span><b>${x.score}</b><div class="s muted small" style="grid-column:1/-1">${x.myType} هدف من نوعك (${x.remaining} لم يُزَر) · ${x.properties} عقار · ${x.explored}% مستكشف</div></div>`).join("")}</div>
    <div class="card"><h2>${icon("script")} كيف أرتّب حياً بنفسي</h2><ol class="small" style="padding-inline-start:20px;margin:0"><li><b>العرض:</b> كم مبنى فردياً جديداً؟ (من الكشّاف: الأهداف من نوعك الموثّقة).</li><li><b>الطلب:</b> كم طلب مشترٍ عندك لهذا الحي؟ (طلبات المشترين).</li><li><b>السعر:</b> هل المتوسط يسمح بصفقات؟ (متوسطات الأسعار).</li><li><b>التغطية:</b> هل مررت بشوارعه؟ شارع لم تمر به = فرص لم ترها.</li><li><b>المنافسة:</b> عدد لوحات المكاتب الكبيرة؛ كثرتها تعني هوامش أقل.</li><li>كرّر الترتيب كل أسبوع بعد الجولات.</li></ol></div>`;
}
function subExcel(root) {
  root.innerHTML = `<div class="card"><h2>${icon("file")} تصدير كل شيء إلى Excel</h2><p class="muted small">ورقة لكل نوع: العقارات، الأهداف، اللوحات، سجل الاتصال، طلبات المشترين، المقاولون، المتوسطات، التسليم، الجولات. هذا الملف لك ويحوي بيانات المالكين؛ لا ترسله للمكتب (استخدم «تسليم المكتب»).</p><button class="btn primary big" id="xl-export">${icon("backup")} تصدير Excel</button><p id="xl-msg" class="msg"></p></div>
    <div class="card"><h2>${icon("file")} استيراد من المتعقّب القديم</h2><p class="muted small">ملف Excel أو CSV من دفتر الميدان القديم. تُقرأ الأعمدة بأسمائها العربية: العنوان، الحي، النوع، الحالة، المساحة، السعر، السعر الأدنى، اسم المالك، جوال المالك، المرحلة، تاريخ المتابعة، ملاحظات، خط العرض، خط الطول. الأعمدة الناقصة تُترك فارغة ولا يُحذف شيء.</p><label class="btn secondary big">${icon("file")} اختر ملف Excel<input type="file" accept=".xlsx,.xls,.csv" hidden id="xl-import"></label><p id="xl-imsg" class="msg"></p></div>`;
  $("#xl-export", root).onclick = async () => { const m = $("#xl-msg", root); m.textContent = "جارٍ التجهيز…"; try { await exportWorkbook(exportSheets(S.items), `mustakshif-${todayIso()}.xlsx`); m.textContent = "تم."; m.className = "msg ok"; } catch (e) { m.textContent = "تعذّر: يلزم اتصال بالإنترنت أول مرة لتحميل مكتبة Excel."; m.className = "msg err"; } };
  $("#xl-import", root).onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; const m = $("#xl-imsg", root); m.textContent = "جارٍ القراءة…"; try { const rows = await importWorkbook(f); let n = 0; for (const d of rows) { await store.create("property", d); n++; } m.textContent = `تم استيراد ${n} عقاراً.`; m.className = "msg ok"; ctx.refreshMap(); } catch (err) { m.textContent = "الملف غير مقروء."; m.className = "msg err"; console.error(err); } };
}
function subSettings(root) {
  const choice = themeChoice(); const st = sync.state; const broker = store.setting("broker") || {};
  root.innerHTML = `
    <div class="card"><h2>${icon("theme")} المظهر</h2><select id="s-theme">${THEMES.map(t => `<option value="${t.id}" ${t.id === choice ? "selected" : ""}>${esc(t.ar)}</option>`).join("")}</select><p class="hint">تلقائي: نهار ساطع من الشروق إلى الغروب، وليل نيون بعده.</p>
      <label class="check"><input type="checkbox" id="s-osm" ${localStorage.getItem("mustakshif.osm") === "1" ? "checked" : ""}> إظهار خريطة OpenStreetMap تحت الشوارع</label></div>
    <div class="card"><h2>${icon("users")} بياناتي كوسيط</h2><p class="muted">${broker.name ? esc([broker.name, broker.license && "رخصة " + broker.license, broker.office, broker.phone].filter(Boolean).join(" · ")) : "لم تُدخل بعد"}</p><button class="btn secondary big" id="s-broker">${icon("edit")} تعديل</button></div>
    <div class="card"><h2>${icon("sync")} المزامنة</h2><p class="muted" id="s-sync-text">${esc({ idle: "…", syncing: "يزامن", synced: "متزامن", offline: "بلا اتصال", error: "خطأ" }[st.status] || st.status)}${st.pending ? " · " + st.pending + " بانتظار الرفع" : ""}${st.error ? " · " + esc(st.error) : ""}</p><button class="btn secondary big" id="s-sync-now">${icon("sync")} مزامنة الآن</button></div>
    <div class="card"><h2>${icon("backup")} النسخة الاحتياطية الكاملة</h2><label class="check"><input id="s-with-photos" type="checkbox" checked> تضمين الصور (ملف أكبر)</label><div class="sheet-actions"><button class="btn secondary big" id="s-export">${icon("backup")} تصدير نسخة</button><label class="btn secondary big">${icon("file")} استيراد نسخة<input id="s-import" type="file" accept=".json" hidden></label></div><p id="s-backup-msg" class="msg"></p></div>
    <div class="card"><h2>${icon("map")} الشوارع</h2><p class="muted" id="s-cov"></p><button class="btn danger big" id="s-reset-hood">${icon("trash")} مسح استكشاف ${esc(hoodAr(S.hood))}</button></div>
    <div class="card"><h2>${icon("settings")} الحساب</h2><p class="muted" dir="ltr">${esc(S.email || "")}</p><form id="form-change"><label>كلمة مرور جديدة <input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn secondary big" type="submit">تغيير كلمة المرور</button></form><button class="btn danger big" id="s-logout" style="margin-top:8px">تسجيل الخروج</button></div>
    <div class="card"><p class="muted small">مستكشف ${esc(CONFIG.APP_VERSION)} · بيانات الشوارع من OpenStreetMap (ODbL). <a href="#" id="s-reconnect">تغيير إعدادات الاتصال</a></p></div>`;
  $("#s-theme", root).onchange = (e) => { setTheme(e.target.value); toast("تم تغيير المظهر"); };
  $("#s-osm", root).onchange = (e) => { localStorage.setItem("mustakshif.osm", e.target.checked ? "1" : "0"); ctx.setOsm(e.target.checked); };
  $("#s-broker", root).onclick = () => openBroker();
  $("#s-sync-now", root).onclick = () => sync.run();
  const c = ctx.coverage(); $("#s-cov", root).textContent = `${hoodAr(S.hood)}: ${c.count} شارع مستكشف من ${c.streets} (${c.pct}% من الطول، ${(c.done / 1000).toFixed(1)} من ${(c.total / 1000).toFixed(1)} كم)${c.faded ? ` · ${c.faded} شارع مضى عليه أكثر من 60 يوماً ويحتاج مروراً جديداً` : ""}`;
  $("#s-reset-hood", root).onclick = async () => { if (!confirmAr(`مسح كل الشوارع المستكشفة في ${hoodAr(S.hood)}؟`)) return; await store.clearExplored(S.hood); await ctx.reloadHood(); toast("تم المسح"); renderSub("settings"); };
  $("#form-change", root).onsubmit = async (e) => { e.preventDefault(); try { await auth.changePassword(e.target.password.value); e.target.reset(); toast("تم تغيير كلمة المرور"); } catch (err) { toast(arabicError(err), 4000); } };
  $("#s-logout", root).onclick = async () => { if (sync.state.pending > 0 && !confirmAr(`يوجد ${sync.state.pending} تغيير لم يُرفع بعد. الخروج الآن يبقيه على هذا الجهاز حتى الدخول القادم. متابعة؟`)) return; await db.meta("loggedOut", true); await auth.logout(); };
  $("#s-reconnect", root).onclick = (e) => { e.preventDefault(); if (confirmAr("سيُعاد فتح شاشة إعدادات الاتصال. البيانات المحلية تبقى.")) { localStorage.removeItem("mustakshif.connection"); location.reload(); } };
  $("#s-export", root).onclick = () => ctx.exportBackup($("#s-with-photos", root).checked, $("#s-backup-msg", root));
  $("#s-import", root).onchange = (e) => ctx.importBackup(e.target.files[0], $("#s-backup-msg", root)).finally(() => e.target.value = "");
}
export { openItem };
