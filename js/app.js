// App glue: boot, auth screens, navigation, map screen + tracking, backup. Screens live in screens.js,
// editors in forms.js, rules in domain.js. Every change autosaves (store.js) and syncs (sync.js).
import { CONFIG, getConnection, saveConnection } from "./config.js";
import { db, uuid, nowIso } from "./db.js";
import { sync, photoBlob } from "./sync.js";
import { auth, supabase, arabicError } from "./auth.js";
import { mapView } from "./map.js";
import { S, store, onItems } from "./store.js";
import { ctx } from "./ctx.js";
import { $, $$, esc, toast, confirmAr, openSheet, closeSheet, initSheet, fmtDate } from "./ui.js";
import { icon } from "./icons.js";
import { applyTheme, startThemeClock } from "./theme.js";
import { renderToday, renderProps, renderTargets, renderMore, renderSub, initTargetFilters, SUBS, openItem } from "./screens.js";
import { openProperty, openSign } from "./forms.js";
import { mergeRows } from "./geo.js";
import { MY_TYPES, sessionSummary } from "./domain.js";

const RECOVERY = location.hash.includes("type=recovery");
const NO_TOUCH = !("ontouchstart" in window) && (navigator.maxTouchPoints || 0) === 0;
let panel = "today", sub = null, lastFix = null, trackTimer = null, fieldSince = 0, districts = {}, streetIndex = {}, boundariesLoaded = false;

// ---------- boot ----------
window.addEventListener("load", async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  applyTheme(); startThemeClock(); initSheet(); bindStatic();
  const { url, key } = getConnection();
  if (!url || !key) { show("screen-setup"); return; }
  startAuth();
});
function show(id) { ["screen-setup", "screen-auth", "app"].forEach(x => $("#" + x).classList.toggle("hidden", x !== id)); }
function authForm(name, msg = "", cls = "") { $$(".auth-form").forEach(f => f.classList.toggle("hidden", f.id !== "form-" + name)); const m = $("#auth-msg"); m.textContent = msg; m.className = "msg " + cls; }

function startAuth() {
  auth.onChange(async (ev) => {
    if (ev === "PASSWORD_RECOVERY") { show("screen-auth"); authForm("reset", "ضع كلمة المرور الجديدة"); return; }
    if (ev === "SIGNED_OUT") { leaveApp(); show("screen-auth"); authForm("login"); }
  });
  auth.session().then(async s => {
    if (RECOVERY) { show("screen-auth"); authForm("reset", "ضع كلمة المرور الجديدة"); return; }
    if (s) return enterApp(s);
    const uid = await db.meta("uid"), email = await db.meta("email");
    if (uid && !navigator.onLine && !(await db.meta("loggedOut"))) return enterApp({ user: { id: uid, email } }, true);
    show("screen-auth"); authForm("login");
  }).catch(e => { show("screen-auth"); authForm("login", arabicError(e), "err"); });
}

function bindStatic() {
  const tabIcons = { today: "today", map: "map", props: "home", targets: "target", more: "more" };
  $$("#tabs button").forEach(b => { b.querySelector(".i").innerHTML = icon(tabIcons[b.dataset.panel]); b.onclick = () => go(b.dataset.panel); });
  $("#btn-follow").innerHTML = icon("locate"); $("#btn-layers").innerHTML = icon("layers"); $("#btn-demo").innerHTML = icon("car");
  setTrackButton(false);
  $("#setup-save").onclick = () => {
    const url = $("#setup-url").value.trim(), key = $("#setup-key").value.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url.replace(/\/+$/, "")) || key.length < 40) { $("#setup-msg").textContent = "تحقق من الرابط والمفتاح"; return; }
    saveConnection(url, key); location.reload();
  };
  $$("[data-show]").forEach(a => a.onclick = (e) => { e.preventDefault(); authForm(a.dataset.show); if (a.dataset.show === "signup") $("#form-signup [name=email]").value = CONFIG.ALLOWED_EMAIL; });
  $("#form-login").onsubmit = async (e) => { e.preventDefault(); const f = e.target; authForm("login", "جارٍ الدخول…"); try { const s = await auth.login(f.email.value, f.password.value); if (s) enterApp(s); } catch (err) { authForm("login", arabicError(err), "err"); } };
  $("#form-signup").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.password.value !== f.password2.value) { authForm("signup", "كلمتا المرور غير متطابقتين", "err"); return; }
    if (f.password.value.length < 8) { authForm("signup", "8 أحرف على الأقل", "err"); return; }
    authForm("signup", "جارٍ إنشاء الحساب…");
    try { const r = await auth.signup(f.email.value, f.password.value); if (r.session) enterApp(r.session); else authForm("login", "تم. افتح بريدك واضغط رابط التأكيد ثم سجّل الدخول.", "ok"); } catch (err) { authForm("signup", arabicError(err), "err"); }
  };
  $("#form-forgot").onsubmit = async (e) => { e.preventDefault(); authForm("forgot", "جارٍ الإرسال…"); try { await auth.forgot(e.target.email.value); authForm("login", "أرسلنا الرابط إلى بريدك. افتحه من هذا الجهاز.", "ok"); } catch (err) { authForm("forgot", arabicError(err), "err"); } };
  $("#form-reset").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.password.value !== f.password2.value) { authForm("reset", "كلمتا المرور غير متطابقتين", "err"); return; }
    authForm("reset", "جارٍ الحفظ…");
    try { await auth.changePassword(f.password.value); history.replaceState(null, "", location.pathname); const s = await auth.session(); if (s) enterApp(s); else authForm("login", "تم تغيير كلمة المرور، سجّل الدخول", "ok"); } catch (err) { authForm("reset", arabicError(err), "err"); }
  };
  $("#hood").onchange = () => loadHood($("#hood").value);
  $("#btn-track").onclick = () => toggleTracking(false);
  $("#btn-demo").onclick = () => toggleTracking(true);
  $("#btn-layers").onclick = () => { const on = localStorage.getItem("mustakshif.osm") !== "1"; localStorage.setItem("mustakshif.osm", on ? "1" : "0"); ctx.setOsm(on); toast(on ? "خريطة OpenStreetMap ظاهرة" : "الخريطة المتجهية فقط"); };
  $("#btn-follow").onclick = async () => {
    if (mapView.tracking()) { mapView.followMe(); return; }
    toast("جارٍ تحديد الموقع…");
    try {
      const p = await mapView.locateOnce(); lastFix = { ...p, t: Date.now() }; mapView.placeMe(p.lat, p.lon, p.acc); const m = Math.round(p.acc);
      $("#desktop-note").classList.toggle("hidden", !(NO_TOUCH || m > 150));
      toast(m <= 20 ? `موقعك محدد، الدقة ${m} م` : m <= 100 ? `الدقة ${m} م: اخرج لمكان مكشوف أو انتظر ثواني` : `الدقة ضعيفة (${m} م): هذا الجهاز بلا GPS، أو خدمات الموقع مغلقة`, 4000);
    } catch (e) { toast(e && e.code === 1 ? "اسمح للتطبيق بالوصول إلى الموقع من إعدادات الجوال" : "تعذّر تحديد الموقع", 4000); }
  };
  $("#btn-prop-here").onclick = async () => { const p = await ctx.locate(); if (!p) { toast("لا يوجد موقع بعد"); return; } mapView.countInSession("properties_added"); openProperty(null, { lat: p.lat, lon: p.lon }); };
  $("#btn-sign-here").onclick = async () => { const p = await ctx.locate(); if (!p) { toast("لا يوجد موقع بعد"); return; } mapView.countInSession("signs_added"); openSign(null, { lat: p.lat, lon: p.lon }); };
  ["#p-q", "#p-status"].forEach(s => $(s).oninput = renderProps); ["#t-q", "#t-status"].forEach(s => $(s).oninput = renderTargets);
  $("#p-add").onclick = async () => { const c = S.hood ? mapView.center() : null; openProperty(null, c ? { lat: c.lat, lon: c.lng } : {}); };
  initTargetFilters();
}

// ---------- navigation ----------
function go(p, title) {
  panel = p; if (p !== "sub") sub = null;
  $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.panel === (p === "sub" ? "more" : p)));
  $$(".panel").forEach(x => x.classList.toggle("active", x.id === "panel-" + p));
  $("#hdr-title").textContent = title || $("#panel-" + p).dataset.title;
  $("#hdr-action").innerHTML = p === "sub" ? `<button class="btn icon" id="hdr-back" aria-label="رجوع">${icon("back")}</button>` : "";
  if (p === "sub") $("#hdr-back").onclick = () => go("more");
  render(); if (p === "map") mapView.invalidate();
  const active = $("#main .panel.active"); if (active) active.scrollTop = 0;
}
function openSub(id) { sub = id; go("sub", SUBS[id] ? SUBS[id][1] : ""); }
function render() {
  if (!S.uid) return;
  if (panel === "today") renderToday(); else if (panel === "props") renderProps(); else if (panel === "targets") renderTargets(); else if (panel === "more") renderMore(); else if (panel === "sub" && sub) renderSub(sub);
  refreshMapItems();
}
Object.assign(ctx, {
  go, openSub, goMap: (lat, lon) => { go("map"); mapView.focus(lat, lon); },
  refreshMap: () => refreshMapItems(), coverage: () => mapView.coverage(), hoodName: (h) => S.hoods[h]?.ar || h,
  locate: async () => { if (lastFix && Date.now() - lastFix.t < 15000) return lastFix; try { const p = await mapView.locateOnce(); lastFix = { ...p, t: Date.now() }; return p; } catch { return null; } },
  setOsm: (on) => mapView.setOsm(on), reloadHood: () => loadHood(S.hood, false), importTargets, exportBackup, importBackup,
});

// ---------- app lifecycle ----------
async function enterApp(session, offline = false) {
  if (RECOVERY) return;
  S.uid = session.user.id; S.email = session.user.email;
  const prev = await db.meta("uid"); if (prev && prev !== S.uid) await db.wipe();
  await db.meta("uid", S.uid); await db.meta("email", S.email); if (!offline) await db.meta("loggedOut", false);
  show("app");
  if (!boundariesLoaded) {
    mapView.init($("#map"), { onExplored, onFix, onItemClick: openItem, onLongPress: (ll) => openProperty(null, { lat: ll.lat, lon: ll.lng }), onStreetClick: toggleStreet, onDistrictClick: (h) => { $("#hood").value = h; loadHood(h); }, hoodName: ctx.hoodName });
    S.hoods = await (await fetch(CONFIG.HOODS_URL)).json();
    const sel = $("#hood"); sel.innerHTML = "";
    for (const [k, v] of Object.entries(S.hoods)) { if (k.startsWith("_")) continue; sel.add(new Option(v.ar, k)); }
    try { streetIndex = await (await fetch("data/streets/index.json")).json(); } catch { streetIndex = {}; }
    for (const h of Object.keys(S.hoods)) { if (h.startsWith("_")) continue; try { districts[h] = await (await fetch(CONFIG.BOUNDARY_URL(h))).json(); } catch {} }
    ctx.streetIndex = streetIndex; boundariesLoaded = true;
    mapView.setOsm(localStorage.getItem("mustakshif.osm") === "1");
    if (NO_TOUCH) $("#desktop-note").classList.remove("hidden");
  }
  if (offline) toast("لا يوجد اتصال. تعمل على النسخة المحلية.", 3500);
  mapView.invalidate();
  const last = localStorage.getItem("mustakshif.hood") || "narjis";
  $("#hood").value = S.hoods[last] ? last : $("#hood").options[0].value;
  await store.load();
  ctx.exploredCounts = await store.exploredCounts();
  mapView.setDistricts(districts, streetIndex, ctx.exploredCounts);
  await loadHood($("#hood").value);
  if (!S.syncBound) { S.syncBound = true; sync.onChange(onSync); onItems(() => render()); }
  sync.init(supabase(), S.uid); sync.start();
  go("today");
}
function leaveApp() { sync.stop(); if (mapView.tracking()) mapView.stopTracking(); S.uid = null; }

let lastPulled = null;
async function onSync(st) {
  const el = $("#sync"); el.dataset.s = st.status;
  const label = { idle: "…", syncing: "يزامن", synced: "متزامن", offline: "بلا اتصال", error: "خطأ" }[st.status] || st.status;
  el.textContent = st.pending ? `${label} · ${st.pending}` : label;
  const t = $("#s-sync-text"); if (t) t.textContent = `${label}${st.last ? " · آخر مزامنة " + new Date(st.last).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }) : ""}${st.pending ? " · " + st.pending + " بانتظار الرفع" : ""}${st.error ? " · " + st.error : ""}`;
  if (st.event === "pulled" && st.last !== lastPulled) { lastPulled = st.last; await store.load(); await reloadExplored(); }
}

// ---------- hoods / streets ----------
let streetsCache = {};
async function fetchStreets(hood) {
  if (streetsCache[hood]) return streetsCache[hood];
  const r = await fetch(CONFIG.STREETS_URL(hood)); if (!r.ok) throw new Error(r.status);
  return (streetsCache[hood] = await r.json());
}
async function loadHood(hood, fit = true) {
  const prev = S.hood;
  try {
    const streets = await fetchStreets(hood);
    S.hood = hood; localStorage.setItem("mustakshif.hood", hood);
    showCoverage(mapView.setHood(hood, streets, await store.exploredFor(hood), fit));
  } catch (e) {
    toast(navigator.onLine ? "بيانات هذا الحي غير متوفرة بعد" : "شوارع هذا الحي غير محفوظة على الجهاز، افتحه مرة وأنت متصل", 4000); console.error(e);
    if (prev) $("#hood").value = prev;
  }
  render();
}
async function reloadExplored() {
  if (!S.hood) return;
  showCoverage(mapView.setHood(S.hood, await fetchStreets(S.hood), await store.exploredFor(S.hood), false));
  ctx.exploredCounts = await store.exploredCounts(); mapView.setExploredCounts(ctx.exploredCounts);
}
function showCoverage(c) { $("#coverage").textContent = `${c.pct}% · ${c.count}/${c.streets}`; }
async function onExplored(wayIds, hood) {
  await store.markExplored(hood, wayIds, true);
  ctx.exploredCounts[hood] = (ctx.exploredCounts[hood] || 0) + wayIds.length; mapView.setExploredCounts(ctx.exploredCounts);
  showCoverage(mapView.coverage());
}
async function toggleStreet(wayId, name, isExplored) {
  if (mapView.tracking()) return;   // no accidental taps while driving
  await store.markExplored(S.hood, [wayId], !isExplored); mapView.paintExplored([wayId], !isExplored);
  ctx.exploredCounts[S.hood] = Math.max(0, (ctx.exploredCounts[S.hood] || 0) + (isExplored ? -1 : 1)); mapView.setExploredCounts(ctx.exploredCounts);
  showCoverage(mapView.coverage()); toast(`${name || "الشارع"}: ${isExplored ? "أُلغي الاستكشاف" : "مستكشف ✓"}`);
}
function refreshMapItems() { if (!S.uid || !S.hood) return; mapView.setItems(S.items.filter(i => ["target", "property", "sign"].includes(i.kind) && (i.data.hood === S.hood || !i.data.hood))); }

// ---------- tracking ----------
function setTrackButton(on) { const b = $("#btn-track"); b.classList.toggle("on", on); b.innerHTML = on ? `${icon("stop")} إيقاف التتبّع` : `${icon("play")} ابدأ التتبّع`; }
async function toggleTracking(demo) {
  if (mapView.tracking()) { await stopTracking(); return; }
  if (demo && !confirmAr("قيادة تجريبية: تتحرك نقطة وهمية على شوارع الحي لاختبار التلوين والجلسة. تبدأ الآن؟")) return;
  go("map"); await mapView.startTracking({ demo });
  setTrackButton(true); $("#field-actions").classList.remove("hidden"); $("#trackbar").classList.remove("hidden"); $("#btn-demo").classList.toggle("on", demo);
  clearInterval(trackTimer); trackTimer = setInterval(updateTrackbar, 1000); updateTrackbar();
  toast(demo ? "القيادة التجريبية تعمل" : "التتبّع يعمل. أبقِ الشاشة مفتوحة أثناء القيادة.");
}
async function stopTracking() {
  const s = mapView.stopTracking(); clearInterval(trackTimer);
  setTrackButton(false); $("#field-actions").classList.add("hidden"); $("#trackbar").classList.add("hidden"); $("#btn-demo").classList.remove("on"); $("#app").classList.remove("field"); fieldSince = 0;
  sync.schedule(500);
  if (!s) return;
  if (s.duration_s >= 20) await store.create("session", s);
  openSheet("ملخص الجولة", `<div class="card" style="max-width:none"><h2>${icon("car")} ${esc(S.hoods[s.hood]?.ar || "")}${s.demo ? " (تجريبية)" : ""}</h2><div class="kv"><div><b>${Math.round(s.duration_s / 60)}</b><span>دقيقة</span></div><div><b>${s.km}</b><span>كم</span></div><div><b>${s.streets_new}</b><span>شارع جديد</span></div><div><b>${s.targets_near}</b><span>هدف مررت قربه</span></div><div><b>${s.properties_added}</b><span>عقار سُجّل</span></div><div><b>${s.signs_added}</b><span>لوحة صُوّرت</span></div></div><p class="muted small" style="margin-top:8px">قراءات GPS: ${s.fixes}، أُهمل منها ${s.rejected} (دقة ضعيفة أو قفزة). التغطية الآن ${mapView.coverage().pct}%.</p></div><div class="sheet-actions"><button class="btn primary big" id="ss-close">تم</button></div>`);
  $("#ss-close").onclick = closeSheet;
}
function updateTrackbar() {
  const s = mapView.session(); if (!s) return;
  const sec = Math.round((Date.now() - s.started) / 1000); const mm = String(Math.floor(sec / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  const acc = lastFix ? Math.round(lastFix.acc) : null;
  const bar = $("#trackbar"); bar.classList.toggle("weak", acc != null && acc > CONFIG.MAX_ACCURACY_METERS);
  bar.innerHTML = `<span>${icon("clock")} ${mm}:${ss}</span><span>${s.streets_new} شارع جديد</span><span>${acc == null ? "بانتظار GPS" : acc > CONFIG.MAX_ACCURACY_METERS ? "دقة ضعيفة " + acc + " م" : "دقة " + acc + " م"}</span>`;
}
function onFix(fix, err) {
  if (err) { $("#trackbar").innerHTML = `<span>${err.code === 1 ? "اسمح للتطبيق بالوصول إلى الموقع من إعدادات الجوال" : "لا توجد إشارة GPS الآن"}</span>`; return; }
  lastFix = { lat: fix.lat, lon: fix.lon, acc: fix.acc, t: Date.now() };
  const moving = fix.speed != null && fix.speed >= 1.5;
  if (moving) { if (!fieldSince) fieldSince = Date.now(); if (Date.now() - fieldSince > 4000) $("#app").classList.add("field"); }
  else if (fieldSince && Date.now() - fieldSince > 25000) { $("#app").classList.remove("field"); fieldSince = 0; }
  updateTrackbar();
}

// ---------- targets import (fallback to the scout upload) ----------
async function importTargets(file) {
  if (!file) return;
  try {
    const j = JSON.parse(await file.text()); const targets = Array.isArray(j) ? j : j.targets; if (!Array.isArray(targets)) throw new Error("bad");
    const hood = j.hood_key || (targets[0] && String(targets[0].id).split("-")[0]) || S.hood;
    const existing = new Map(store.all("target").map(i => [i.data.ref, i])); let added = 0, updated = 0;
    for (const t of targets) {
      const fields = { ref: t.id, title: t.id, hood, lat: t.lat, lon: t.lon, area: t.area, kind_label: t.kind, kind_key: t.kind_key, phase: t.phase, phase_key: t.phase_key, use: t.use, score: t.score, why: t.why, bonus: t.bonus, verified: !!t.verified, my_type: MY_TYPES.has(t.kind_key), scan_date: j.date, source: "scan" };
      const cur = existing.get(t.id);
      if (cur) { Object.assign(cur.data, fields); await store.save(cur); updated++; } else { await store.create("target", { ...fields, status: "new", photos: [] }); added++; }
    }
    const scan = store.all("scan").find(s => s.data.hood === hood);
    const sc = { hood, scan_date: j.date, file: file.name, total: targets.length, verified: targets.filter(t => t.verified).length, of_my_type: targets.filter(t => MY_TYPES.has(t.kind_key)).length, uploaded_at: nowIso(), uploaded_by: "app" };
    if (scan) { scan.data = sc; await store.save(scan); } else await store.create("scan", sc);
    if (S.hoods[hood] && hood !== S.hood) { $("#hood").value = hood; await loadHood(hood); }
    toast(`تم: ${added} هدف جديد، ${updated} محدّث`, 3500); render();
  } catch (e) { toast("الملف غير صالح. المطلوب targets.json من كشّاف العقار", 4000); console.error(e); }
}

// ---------- full backup ----------
const b64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
async function exportBackup(withPhotos, msg) {
  msg.textContent = "جارٍ التجهيز…"; msg.className = "msg";
  const items = (await db.all("items")).map(({ dirty, ...r }) => r); const explored = (await db.all("explored")).map(({ dirty, ...r }) => r); const photos = [];
  if (withPhotos) for (const p of await db.all("photos")) { if (p.deleted) continue; const blob = p.blob || await photoBlob(p.id); if (blob) photos.push({ id: p.id, item: p.item, path: p.path, b64: await b64(blob) }); }
  const name = `mustakshif-backup-${nowIso().slice(0, 10)}.json`;
  const file = new File([JSON.stringify({ app: "mustakshif", version: CONFIG.APP_VERSION, exported: nowIso(), items, explored, photos })], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== "AbortError") download(file, name); } } else download(file, name);
  msg.textContent = `تم: ${items.length} سجل، ${explored.length} شارع، ${photos.length} صورة`; msg.className = "msg ok";
}
async function importBackup(file, msg) {
  if (!file) return;
  try {
    const j = JSON.parse(await file.text()); if (j.app !== "mustakshif") throw new Error("bad");
    const ni = mergeRows(await db.all("items"), j.items || []).map(r => ({ ...r, dirty: 1 })); const ne = mergeRows(await db.all("explored"), j.explored || []).map(r => ({ ...r, dirty: 1 }));
    await db.putMany("items", ni); await db.putMany("explored", ne); let np = 0;
    for (const p of j.photos || []) { if (await db.get("photos", p.id)) continue; const bin = atob(p.b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); await db.put("photos", { id: p.id, item: p.item, path: p.path.replace(/^[^/]+\//, S.uid + "/"), blob: new Blob([arr], { type: "image/jpeg" }), dirty: 1, deleted: false }); np++; }
    await store.load(); await reloadExplored(); sync.schedule();
    msg.textContent = `تم الاستيراد: ${ni.length} سجل، ${ne.length} شارع، ${np} صورة`; msg.className = "msg ok";
  } catch (e) { msg.textContent = "الملف غير صالح"; msg.className = "msg err"; console.error(e); }
}
