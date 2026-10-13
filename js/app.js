// UI glue: screens, tabs, items, photos, backup, settings. Every change is saved to
// IndexedDB immediately and pushed by sync.js; there is no save button anywhere.
import { CONFIG, getConnection, saveConnection } from "./config.js";
import { db, uuid, nowIso } from "./db.js";
import { sync, photoBlob, registerRemotePhotos } from "./sync.js";
import { auth, supabase, arabicError } from "./auth.js";
import { mapView } from "./map.js";
import { mergeRows } from "./geo.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const S = { uid: null, email: null, hood: null, hoods: {}, items: [], explored: new Set(), editing: null, mapReady: false, syncBound: false };
// captured before the Supabase client strips the hash, so a password-reset link always shows the reset form
const RECOVERY = location.hash.includes("type=recovery");

// ---------- helpers ----------
let toastT;
function toast(msg, ms = 2200) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), ms); }
function show(id) { ["screen-setup", "screen-auth", "app"].forEach(x => $("#" + x).classList.toggle("hidden", x !== id)); }
function authForm(name, msg = "", cls = "") {
  $$(".auth-form").forEach(f => f.classList.toggle("hidden", f.id !== "form-" + name));
  const m = $("#auth-msg"); m.textContent = msg; m.className = "msg " + cls;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "";
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- boot ----------
window.addEventListener("load", async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  $("#s-version").textContent = CONFIG.APP_VERSION;
  bindStatic();
  const { url, key } = getConnection();
  if (!url || !key) { show("screen-setup"); return; }
  startAuth();
});

function startAuth() {
  auth.onChange(async (ev, session) => {
    if (ev === "PASSWORD_RECOVERY") { show("screen-auth"); authForm("reset", "ضع كلمة المرور الجديدة"); return; }
    if (ev === "SIGNED_OUT") { leaveApp(); show("screen-auth"); authForm("login"); }
  });
  auth.session().then(async s => {
    if (RECOVERY) { show("screen-auth"); authForm("reset", "ضع كلمة المرور الجديدة"); return; }
    if (s) return enterApp(s);
    // offline with an expired token: open the local copy; sync resumes when the connection is back
    const uid = await db.meta("uid"), email = await db.meta("email");
    if (uid && !navigator.onLine && !(await db.meta("loggedOut"))) return enterApp({ user: { id: uid, email } }, true);
    show("screen-auth"); authForm("login");
  }).catch(e => { show("screen-auth"); authForm("login", arabicError(e), "err"); });
}

function bindStatic() {
  // setup
  $("#setup-save").onclick = () => {
    const url = $("#setup-url").value.trim(), key = $("#setup-key").value.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url.replace(/\/+$/, "")) || key.length < 40) { $("#setup-msg").textContent = "تحقق من الرابط والمفتاح"; return; }
    saveConnection(url, key); location.reload();
  };
  // auth
  $$("[data-show]").forEach(a => a.onclick = (e) => { e.preventDefault(); authForm(a.dataset.show); if (a.dataset.show === "signup") $("#form-signup [name=email]").value = CONFIG.ALLOWED_EMAIL; });
  $("#form-login").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; authForm("login", "جارٍ الدخول…");
    try { const s = await auth.login(f.email.value, f.password.value); if (s) enterApp(s); } catch (err) { authForm("login", arabicError(err), "err"); }
  };
  $("#form-signup").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.password.value !== f.password2.value) { authForm("signup", "كلمتا المرور غير متطابقتين", "err"); return; }
    if (f.password.value.length < 8) { authForm("signup", "8 أحرف على الأقل", "err"); return; }
    authForm("signup", "جارٍ إنشاء الحساب…");
    try {
      const r = await auth.signup(f.email.value, f.password.value);
      if (r.session) enterApp(r.session);
      else authForm("login", "تم. افتح بريدك واضغط رابط التأكيد ثم سجّل الدخول.", "ok");
    } catch (err) { authForm("signup", arabicError(err), "err"); }
  };
  $("#form-forgot").onsubmit = async (e) => {
    e.preventDefault(); authForm("forgot", "جارٍ الإرسال…");
    try { await auth.forgot(e.target.email.value); authForm("login", "أرسلنا الرابط إلى بريدك. افتحه من هذا الجهاز.", "ok"); } catch (err) { authForm("forgot", arabicError(err), "err"); }
  };
  $("#form-reset").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.password.value !== f.password2.value) { authForm("reset", "كلمتا المرور غير متطابقتين", "err"); return; }
    authForm("reset", "جارٍ الحفظ…");
    try { await auth.changePassword(f.password.value); history.replaceState(null, "", location.pathname); const s = await auth.session(); if (s) enterApp(s); else authForm("login", "تم تغيير كلمة المرور، سجّل الدخول", "ok"); }
    catch (err) { authForm("reset", arabicError(err), "err"); }
  };
  // tabs
  $$("nav button").forEach(b => b.onclick = () => {
    $$("nav button").forEach(x => x.classList.toggle("active", x === b));
    $$(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + b.dataset.panel));
    if (b.dataset.panel === "map") mapView.invalidate();
  });
  $("#hood").onchange = () => loadHood($("#hood").value);
  // map buttons
  $("#btn-track").onclick = toggleTracking;
  $("#btn-follow").onclick = async () => {
    if (mapView.tracking()) { mapView.followMe(); return; }
    toast("جارٍ تحديد الموقع…");
    try {
      const p = await mapView.locateOnce();
      mapView.placeMe(p.lat, p.lon, p.acc);
      const m = Math.round(p.acc);
      toast(m <= 20 ? `موقعك محدد، الدقة ${m} م` : m <= 100 ? `الدقة ${m} م: اخرج لمكان مكشوف أو انتظر ثواني` : `الدقة ضعيفة (${m} م): هذا الجهاز بلا GPS، أو خدمات الموقع مغلقة`, 4000);
    } catch (e) { toast(e && e.code === 1 ? "اسمح للتطبيق بالوصول إلى الموقع من إعدادات الجوال" : "تعذّر تحديد الموقع", 4000); }
  };
  $("#btn-add-here").onclick = async () => {
    try { toast("جارٍ تحديد الموقع…"); const p = await mapView.locateOnce(); await newProperty(p.lat, p.lon); } catch { toast("تعذّر تحديد الموقع"); }
  };
  // targets
  ["#t-status", "#t-kind", "#t-q"].forEach(s => $(s).oninput = renderTargets);
  $("#t-import").onchange = (e) => importTargets(e.target.files[0]).finally(() => e.target.value = "");
  // properties
  $("#p-q").oninput = renderProps;
  $("#p-add").onclick = async () => { const c = mapView.center(); await newProperty(c.lat, c.lng, true); };
  // settings
  $("#form-change").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await auth.changePassword(f.password.value); f.reset(); toast("تم تغيير كلمة المرور"); } catch (err) { toast(arabicError(err), 4000); }
  };
  $("#s-logout").onclick = async () => {
    if (sync.state.pending > 0 && !confirm(`يوجد ${sync.state.pending} تغيير لم يُرفع بعد. الخروج الآن يبقيه على هذا الجهاز حتى الدخول القادم. متابعة؟`)) return;
    await db.meta("loggedOut", true);   // an explicit logout locks the app even offline
    await auth.logout();
  };
  $("#s-sync-now").onclick = () => sync.run();
  const themeSel = $("#s-theme");
  themeSel.value = localStorage.getItem("mustakshif.theme") || "dark";
  themeSel.onchange = () => {
    localStorage.setItem("mustakshif.theme", themeSel.value);
    const r = document.documentElement; r.dataset.theme = themeSel.value;
    r.classList.toggle("light", themeSel.value === "auto" && window.matchMedia("(prefers-color-scheme: light)").matches);
  };
  $("#s-export").onclick = exportBackup;
  $("#s-import").onchange = (e) => importBackup(e.target.files[0]).finally(() => e.target.value = "");
  $("#s-reset-hood").onclick = resetHood;
  $("#s-reconnect").onclick = (e) => { e.preventDefault(); if (confirm("سيُعاد فتح شاشة إعدادات الاتصال. البيانات المحلية تبقى.")) { localStorage.removeItem("mustakshif.connection"); location.reload(); } };
  // dialog
  $("#dlg-close").onclick = () => $("#dlg").close();
  $("#dlg-form").addEventListener("input", debounce(() => saveDialog(), 400));
  $("#dlg-form").addEventListener("change", () => saveDialog());
  $("#dlg").addEventListener("close", () => saveDialog(true));   // Esc / swipe: keep the last keystrokes
  $("#dlg-photo").onchange = (e) => addPhoto(e.target.files[0]).finally(() => e.target.value = "");
  $("#dlg-delete").onclick = deleteItem;
  $("#dlg-locate").onclick = async () => {
    try { const p = await mapView.locateOnce(); S.editing.data.lat = p.lat; S.editing.data.lon = p.lon; await saveItem(S.editing); toast("تم تحديث الموقع"); fillDialogMeta(); } catch { toast("تعذّر تحديد الموقع"); }
  };
}

// ---------- app lifecycle ----------
async function enterApp(session, offline = false) {
  if (RECOVERY) return;
  S.uid = session.user.id; S.email = session.user.email;
  const prev = await db.meta("uid");
  if (prev && prev !== S.uid) await db.wipe();
  await db.meta("uid", S.uid); await db.meta("email", S.email);
  if (!offline) await db.meta("loggedOut", false);
  if (offline) toast("لا يوجد اتصال. تعمل على النسخة المحلية.", 3500);
  $("#s-email").textContent = S.email;
  show("app");
  if (!S.mapReady) {
    mapView.init($("#map"), { onExplored, onFix, onItemClick: (id) => openItem(id), onLongPress: (ll) => newProperty(ll.lat, ll.lng, true), onStreetClick: toggleStreet });
    S.mapReady = true;
  }
  mapView.invalidate();
  S.hoods = await (await fetch(CONFIG.HOODS_URL)).json();
  const sel = $("#hood"); sel.innerHTML = "";
  for (const [k, v] of Object.entries(S.hoods)) { if (k.startsWith("_")) continue; const o = document.createElement("option"); o.value = k; o.textContent = v.ar; sel.appendChild(o); }
  const last = localStorage.getItem("mustakshif.hood") || "narjis";
  sel.value = S.hoods[last] ? last : sel.options[0].value;
  await loadItems();
  await loadHood(sel.value);
  sync.init(supabase(), S.uid);
  if (!S.syncBound) { S.syncBound = true; sync.onChange(onSync); }
  sync.start();
}
function leaveApp() { sync.stop(); mapView.stopTracking(); S.uid = null; }

let lastPulled = null;
async function onSync(st) {
  const el = $("#sync"); el.dataset.s = st.status;
  const label = { idle: "…", syncing: "يزامن", synced: "متزامن", offline: "بلا اتصال", error: "خطأ" }[st.status] || st.status;
  el.textContent = st.pending ? `${label} · ${st.pending}` : label;
  $("#s-sync").textContent = `${label}${st.last ? " · آخر مزامنة " + fmtTime(st.last) : ""}${st.pending ? " · " + st.pending + " بانتظار الرفع" : ""}${st.error ? " · " + st.error : ""}`;
  if (st.event === "pulled" && st.last !== lastPulled) { lastPulled = st.last; await loadItems(); await loadExplored(); }
}

// ---------- hoods / streets ----------
async function loadHood(hood) {
  const prev = S.hood;
  const getJson = (u) => fetch(u).then(r => { if (!r.ok) throw new Error(r.status + " " + u); return r.json(); });
  try {
    const [streets, boundary] = await Promise.all([getJson(CONFIG.STREETS_URL(hood)), getJson(CONFIG.BOUNDARY_URL(hood))]);
    S.hood = hood; localStorage.setItem("mustakshif.hood", hood);
    const ids = await exploredIds(hood);
    S.explored = new Set(ids);
    showCoverage(mapView.setHood(hood, streets, boundary, ids));
  } catch (e) {
    toast(navigator.onLine ? "بيانات هذا الحي غير متوفرة بعد" : "شوارع هذا الحي غير محفوظة على الجهاز، افتحه مرة وأنت متصل", 4000); console.error(e);
    if (prev) $("#hood").value = prev;
  }
  renderMapItems();
}
async function exploredIds(hood) {
  const rows = await db.byIndex("explored", "hood", hood);
  return rows.filter(r => !r.deleted).map(r => r.id.split(":")[1]);
}
async function loadExplored() {
  const ids = await exploredIds(S.hood);
  const cur = S.explored;
  const add = ids.filter(i => !cur.has(i)), rem = [...cur].filter(i => !ids.includes(i));
  if (add.length) mapView.paintExplored(add, true);
  if (rem.length) mapView.paintExplored(rem, false);
  S.explored = new Set(ids);
  showCoverage(mapView.coverage());
}
function showCoverage(c) {
  $("#coverage").textContent = `${c.pct}% · ${c.count}/${c.streets}`;
  $("#s-coverage").textContent = `${S.hoods[S.hood]?.ar || ""}: ${c.count} شارع مستكشف من ${c.streets} (${c.pct}% من الطول، ${(c.done / 1000).toFixed(1)} من ${(c.total / 1000).toFixed(1)} كم)`;
}
async function onExplored(wayIds, hood) {
  const now = nowIso();
  await db.putMany("explored", wayIds.map(w => ({ id: `${hood}:${w}`, hood, explored_at: now, updated_at: now, deleted: false, dirty: 1 })));
  wayIds.forEach(w => S.explored.add(String(w)));
  showCoverage(mapView.coverage());
  sync.schedule(8000);   // batch: a drive produces many of these per minute
}
async function toggleStreet(wayId, name, isExplored) {
  const now = nowIso();
  await db.put("explored", { id: `${S.hood}:${wayId}`, hood: S.hood, explored_at: now, updated_at: now, deleted: isExplored, dirty: 1 });
  mapView.paintExplored([wayId], !isExplored);
  if (isExplored) S.explored.delete(String(wayId)); else S.explored.add(String(wayId));
  showCoverage(mapView.coverage()); sync.schedule(3000);
  toast(`${name || "الشارع"}: ${isExplored ? "أُلغي الاستكشاف" : "مستكشف ✓"}`);
}
async function resetHood() {
  if (!confirm(`مسح كل الشوارع المستكشفة في ${S.hoods[S.hood]?.ar}؟`)) return;
  const rows = (await db.byIndex("explored", "hood", S.hood)).filter(r => !r.deleted);
  const now = nowIso();
  await db.putMany("explored", rows.map(r => ({ ...r, deleted: true, updated_at: now, dirty: 1 })));
  await loadExplored(); sync.schedule(); toast("تم المسح");
}
function onFix(fix, err) {
  const el = $("#fix span"); el.classList.remove("hidden");
  if (err) { el.textContent = err.code === 1 ? "اسمح للتطبيق بالوصول إلى الموقع من إعدادات الجوال" : "لا توجد إشارة GPS الآن"; return; }
  const kmh = fix.speed != null && fix.speed >= 0 ? Math.round(fix.speed * 3.6) : null;
  el.textContent = `دقة ${Math.round(fix.acc)}م${kmh != null ? " · " + kmh + " كم/س" : ""}${fix.acc > CONFIG.MAX_ACCURACY_METERS ? " · الدقة ضعيفة، لا يُسجَّل" : ""}`;
}
async function toggleTracking() {
  const b = $("#btn-track");
  if (mapView.tracking()) { mapView.stopTracking(); b.classList.remove("on"); b.textContent = "▶ تتبّع"; $("#fix span").classList.add("hidden"); sync.schedule(500); }
  else { await mapView.startTracking(); b.classList.add("on"); b.textContent = "■ إيقاف"; toast("التتبع يعمل. أبقِ الشاشة مفتوحة أثناء القيادة."); }
}

// ---------- items ----------
async function loadItems() {
  S.items = (await db.all("items")).filter(r => !r.deleted);
  await registerRemotePhotos(S.uid, S.items);
  renderTargets(); renderProps(); renderMapItems();
  if (S.editing) { const cur = S.items.find(i => i.id === S.editing.id); if (cur && cur.updated_at !== S.editing.updated_at) { S.editing = cur; fillDialog(cur); } }
}
async function saveItem(item) {
  item.updated_at = nowIso(); item.dirty = 1; item.created_at = item.created_at || item.updated_at;
  await db.put("items", item);
  const i = S.items.findIndex(x => x.id === item.id);
  if (item.deleted) { if (i >= 0) S.items.splice(i, 1); } else if (i >= 0) S.items[i] = item; else S.items.push(item);
  renderTargets(); renderProps(); renderMapItems();
  sync.schedule();
}
function renderMapItems() { mapView.setItems(S.items.filter(i => !i.data.hood || i.data.hood === S.hood || i.kind === "property")); }

function renderTargets() {
  const st = $("#t-status").value, kind = $("#t-kind").value, q = $("#t-q").value.trim();
  const kinds = new Set();
  let list = S.items.filter(i => i.kind === "target");
  list.forEach(i => i.data.kind_label && kinds.add(i.data.kind_label));
  const ks = $("#t-kind"); const cur = ks.value;
  ks.innerHTML = '<option value="">كل الأنواع</option>' + [...kinds].map(k => `<option ${k === cur ? "selected" : ""}>${esc(k)}</option>`).join("");
  list = list.filter(i => (!st || (i.data.status || "new") === st) && (!kind || i.data.kind_label === kind) && (!q || JSON.stringify(i.data).includes(q)) && (i.data.hood === S.hood || !i.data.hood));
  list.sort((a, b) => (b.data.score || 0) - (a.data.score || 0));
  $("#t-count").textContent = `${list.length} هدف في ${S.hoods[S.hood]?.ar || ""}`;
  $("#t-list").innerHTML = list.map(i => `<li data-id="${i.id}">
    <div class="t">${esc(i.data.title || i.data.ref)}</div><span class="badge ${esc(i.data.status || "new")}">${statusAr(i.data.status)}</span>
    <div class="s">${esc(i.data.kind_label || "")} · ${esc(i.data.phase || "")} · ${i.data.score ? "درجة " + i.data.score : ""}${i.data.priority ? " · " + priorityAr(i.data.priority) : ""}${i.data.note ? " · " + esc(i.data.note) : ""}</div>
  </li>`).join("") || '<li class="muted">لا توجد أهداف. استورد ملف targets.json من كشّاف العقار.</li>';
  $$("#t-list li[data-id]").forEach(li => li.onclick = () => openItem(li.dataset.id));
}
function renderProps() {
  const q = $("#p-q").value.trim();
  const list = S.items.filter(i => i.kind === "property" && (!q || JSON.stringify(i.data).includes(q))).sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  $("#p-list").innerHTML = list.map(i => `<li data-id="${i.id}">
    <div class="t">${esc(i.data.title || "عقار")}</div><span class="badge ${esc(i.data.priority || "")}">${priorityAr(i.data.priority) || statusAr(i.data.status)}</span>
    <div class="s">${esc(i.data.kind_label || "")}${i.data.price ? " · " + esc(i.data.price) : ""}${i.data.owner_name ? " · " + esc(i.data.owner_name) : ""}${i.data.note ? " · " + esc(i.data.note) : ""} · ${new Date(i.created_at).toLocaleDateString("ar-SA")}</div>
  </li>`).join("") || '<li class="muted">لا توجد عقارات بعد. اضغط ＋ عقار جديد، أو اضغط مطوّلاً على الخريطة.</li>';
  $$("#p-list li[data-id]").forEach(li => li.onclick = () => openItem(li.dataset.id));
}
const statusAr = (s) => ({ new: "جديد", visited: "تمت الزيارة", ignored: "تجاهل" }[s || "new"] || s);
const priorityAr = (p) => ({ high: "عالية", mid: "متوسطة", low: "منخفضة" }[p] || "");

async function newProperty(lat, lon, openOnMap = false) {
  const item = { id: uuid(), kind: "property", data: { title: "عقار جديد", lat, lon, hood: S.hood, status: "new", source: "field", photos: [] }, deleted: false };
  await saveItem(item); openItem(item.id);
  if (openOnMap) mapView.focus(lat, lon);
}
async function importTargets(file) {
  if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    const targets = Array.isArray(j) ? j : j.targets;
    if (!Array.isArray(targets)) throw new Error("bad");
    const hood = j.hood_key || (targets[0] && String(targets[0].id).split("-")[0]) || S.hood;
    let added = 0, updated = 0;
    const existing = new Map(S.items.filter(i => i.kind === "target").map(i => [i.data.ref, i]));
    for (const t of targets) {
      const fields = { ref: t.id, title: t.id, hood, lat: t.lat, lon: t.lon, area: t.area, kind_label: t.kind, kind_key: t.kind_key, phase: t.phase, phase_key: t.phase_key, use: t.use, score: t.score, why: t.why, scan_date: j.date, source: "scan" };
      const cur = existing.get(t.id);
      if (cur) { Object.assign(cur.data, fields); await saveItem(cur); updated++; }
      else { await saveItem({ id: uuid(), kind: "target", data: { ...fields, status: "new", photos: [] }, deleted: false }); added++; }
    }
    if (S.hoods[hood] && hood !== S.hood) { $("#hood").value = hood; await loadHood(hood); }
    toast(`تم: ${added} هدف جديد، ${updated} محدّث`, 3500);
  } catch { toast("الملف غير صالح. المطلوب targets.json من كشّاف العقار", 4000); }
}

// ---------- dialog ----------
function openItem(id) {
  const item = S.items.find(i => i.id === id); if (!item) return;
  S.editing = item; fillDialog(item);
  $("#dlg").showModal();
}
function fillDialog(item) {
  const f = $("#dlg-form"), d = item.data;
  $("#dlg-title").textContent = item.kind === "property" ? "عقار" : `هدف ${d.ref || ""}`;
  for (const k of ["title", "status", "priority", "kind_label", "phase", "price", "owner_name", "owner_phone", "note"]) if (f[k]) f[k].value = d[k] ?? "";
  if (!d.status) f.status.value = "new";
  fillDialogMeta(); renderPhotos();
}
function fillDialogMeta() {
  const d = S.editing.data;
  $("#dlg-meta").textContent = [d.area ? `${d.area} م²` : "", d.use, d.why, d.scan_date ? `فحص ${d.scan_date}` : ""].filter(Boolean).join(" · ");
  $("#dlg-maps").href = d.lat != null ? `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lon}` : "#";
  const txt = `${d.title || d.ref || ""}\n${d.kind_label || ""} ${d.phase || ""}\n${d.note || ""}\nhttps://maps.google.com/?q=${d.lat},${d.lon}`;
  $("#dlg-wa").href = `https://wa.me/?text=${encodeURIComponent(txt)}`;
}
async function saveDialog(force = false) {
  if (!S.editing || (!force && !$("#dlg").open)) return;
  const f = $("#dlg-form"), d = S.editing.data; let changed = false;
  for (const k of ["title", "status", "priority", "kind_label", "phase", "price", "owner_name", "owner_phone", "note"]) {
    if (!f[k]) continue; const v = f[k].value; if ((d[k] ?? "") !== v) { d[k] = v; changed = true; }
  }
  if (changed) await saveItem(S.editing);
}
async function deleteItem() {
  if (!S.editing || !confirm("حذف هذا السجل وصوره؟")) return;
  const it = S.editing; it.deleted = true;
  for (const pid of it.data.photos || []) { const p = await db.get("photos", pid); if (p) await db.put("photos", { ...p, blob: null, deleted: true, dirty: 1 }); }
  await saveItem(it); $("#dlg").close(); S.editing = null; toast("تم الحذف");
}
let photoRender = 0;
async function renderPhotos() {
  const token = ++photoRender;
  const box = $("#dlg-photos"); box.innerHTML = "";
  for (const pid of S.editing.data.photos || []) {
    if (token !== photoRender) return;
    const wrap = document.createElement("div"); wrap.className = "ph";
    const img = document.createElement("img"); img.alt = "";
    const blob = await photoBlob(pid);
    if (blob) { img.src = URL.createObjectURL(blob); img.onclick = () => window.open(img.src, "_blank"); } else img.alt = "لم تُنزَّل بعد";
    const del = document.createElement("button"); del.type = "button"; del.textContent = "✕";
    del.onclick = async () => {
      if (!confirm("حذف الصورة؟")) return;
      const p = await db.get("photos", pid); if (p) await db.put("photos", { ...p, blob: null, deleted: true, dirty: 1 });
      S.editing.data.photos = S.editing.data.photos.filter(x => x !== pid); await saveItem(S.editing); renderPhotos();
    };
    wrap.append(img, del); box.appendChild(wrap);
  }
}
async function addPhoto(file) {
  if (!file || !S.editing) return;
  try {
    const blob = await compress(file);
    const pid = uuid();
    await db.put("photos", { id: pid, item: S.editing.id, path: `${S.uid}/${S.editing.id}/${pid}.jpg`, blob, dirty: 1, deleted: false });
    S.editing.data.photos = [...(S.editing.data.photos || []), pid];
    await saveItem(S.editing); renderPhotos();
  } catch (e) { toast("تعذّر حفظ الصورة"); console.error(e); }
}
function compress(file) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, CONFIG.PHOTO_MAX_PX / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error("toBlob")), "image/jpeg", CONFIG.PHOTO_QUALITY);
    };
    img.onerror = rej; img.src = url;
  });
}

// ---------- backup ----------
const b64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
async function exportBackup() {
  const msg = $("#s-backup-msg"); msg.textContent = "جارٍ التجهيز…";
  const items = (await db.all("items")).map(({ dirty, ...r }) => r);
  const explored = (await db.all("explored")).map(({ dirty, ...r }) => r);
  const photos = [];
  if ($("#s-with-photos").checked) for (const p of await db.all("photos")) { if (p.deleted) continue; const blob = p.blob || await photoBlob(p.id); if (blob) photos.push({ id: p.id, item: p.item, path: p.path, b64: await b64(blob) }); }
  const out = { app: "mustakshif", version: CONFIG.APP_VERSION, exported: nowIso(), items, explored, photos };
  const name = `mustakshif-backup-${nowIso().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(out)], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== "AbortError") download(file, name); }
  } else download(file, name);
  msg.textContent = `تم: ${items.length} سجل، ${explored.length} شارع، ${photos.length} صورة`; msg.className = "msg ok";
}
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
async function importBackup(file) {
  if (!file) return; const msg = $("#s-backup-msg");
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== "mustakshif") throw new Error("bad");
    const li = await db.all("items"), le = await db.all("explored");
    const ni = mergeRows(li, j.items || []).map(r => ({ ...r, dirty: 1 }));
    const ne = mergeRows(le, j.explored || []).map(r => ({ ...r, dirty: 1 }));
    await db.putMany("items", ni); await db.putMany("explored", ne);
    let np = 0;
    for (const p of j.photos || []) {
      if (await db.get("photos", p.id)) continue;
      const bin = atob(p.b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const path = p.path.replace(/^[^/]+\//, S.uid + "/");
      await db.put("photos", { id: p.id, item: p.item, path, blob: new Blob([arr], { type: "image/jpeg" }), dirty: 1, deleted: false }); np++;
    }
    await loadItems(); await loadExplored(); sync.schedule();
    msg.textContent = `تم الاستيراد: ${ni.length} سجل، ${ne.length} شارع، ${np} صورة`; msg.className = "msg ok";
  } catch (e) { msg.textContent = "الملف غير صالح"; msg.className = "msg err"; console.error(e); }
}
