// Small DOM helpers shared by all screens: sheet (bottom dialog), toast, forms with autosave,
// photo thumbnails, status pills. No business logic here.
import { icon } from "./icons.js";
import { db, uuid } from "./db.js";
import { photoBlob } from "./sync.js";
import { CONFIG } from "./config.js";
import { normalizeDigits } from "./domain.js";

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric", month: "short" }) : "";
export const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }) : "";
export const fmtNum = (n) => n == null || n === "" ? "" : Number(String(n).replace(/[^\d.]/g, "")).toLocaleString("en-US");
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

let toastT;
export function toast(msg, ms = 2400) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), ms); }
export function confirmAr(msg) { return window.confirm(msg); }
export const pill = (cls, text) => `<span class="badge ${esc(cls)}">${esc(text)}</span>`;
export const empty = (ic, title, hint, action = "") => `<div class="empty">${icon(ic)}<div><b>${esc(title)}</b></div><div class="small">${esc(hint)}</div>${action}</div>`;
export const loading = (t = "جارٍ التحميل…") => `<div class="loading"><i></i>${esc(t)}</div>`;

// ---------- bottom sheet ----------
let sheetClose = null;
export function openSheet(title, html, { onClose = null } = {}) {
  const d = $("#sheet"); $("#sheet-title").textContent = title;
  const old = $("#sheet-body"); const fresh = old.cloneNode(false); old.replaceWith(fresh); fresh.innerHTML = html;   // a fresh body drops the previous sheet's autosave listeners
  sheetClose = onClose;
  if (!d.open) d.showModal();
  $("#sheet-body").scrollTop = 0;
  return $("#sheet-body");
}
export function closeSheet() { const d = $("#sheet"); if (d.open) d.close(); }
export function initSheet() {
  const d = $("#sheet");
  $("#sheet-close").innerHTML = icon("close");
  $("#sheet-close").onclick = () => d.close();
  d.addEventListener("close", () => { const f = sheetClose; sheetClose = null; if (f) f(); });
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });   // tap on the backdrop
}

// ---------- forms with autosave ----------
/** fields: [{name, label, type:'text'|'tel'|'number'|'select'|'textarea'|'date', options:{v:label}, hint, required}] */
export function formHtml(fields, data = {}) {
  return fields.map(f => {
    const v = data[f.name] ?? "";
    const im = f.type === "number" ? ' inputmode="decimal"' : f.type === "tel" ? ' inputmode="tel" dir="ltr"' : "";
    let input;
    if (f.type === "select") input = `<select name="${f.name}">${Object.entries(f.options).map(([k, l]) => `<option value="${esc(k)}" ${String(v) === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    else if (f.type === "textarea") input = `<textarea name="${f.name}" rows="3" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
    else input = `<input name="${f.name}" type="${f.type === "number" ? "text" : f.type || "text"}"${im} value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" ${f.required ? "required" : ""} ${f.pattern ? `pattern="${f.pattern}"` : ""}>`;
    return `<label>${esc(f.label)}${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ""}</label>`;
  }).join("");
}
/** wires autosave: every input/change writes back to item.data[name] and calls save(item) */
export function bindAutosave(root, item, save, { validate = null, onChange = null } = {}) {
  const apply = async () => {
    if (!root.isConnected || !$("input[name],select[name],textarea[name]", root)) return;   // sheet already closed or replaced
    let changed = false;
    for (const el of $$("input[name],select[name],textarea[name]", root)) {
      if (el.tagName === "INPUT" && (el.type === "tel" || el.inputMode === "decimal" || el.inputMode === "tel")) { const n = normalizeDigits(el.value); if (n !== el.value) el.value = n; }
      const v = el.value; if ((item.data[el.name] ?? "") !== v) { item.data[el.name] = v; changed = true; }
      if (validate) { const err = validate(el.name, v); const h = el.parentElement.querySelector(".hint.err"); if (err) { if (!h) { const d = document.createElement("div"); d.className = "hint err"; d.textContent = err; el.parentElement.appendChild(d); } else h.textContent = err; } else if (h) h.remove(); }
    }
    if (changed) { await save(item); onChange && onChange(item); }
  };
  root.addEventListener("input", debounce(apply, 350)); root.addEventListener("change", apply);
  return apply;
}

// ---------- photos ----------
export function compress(file) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, CONFIG.PHOTO_MAX_PX / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error("toBlob")), "image/jpeg", CONFIG.PHOTO_QUALITY);
    };
    img.onerror = rej; img.src = url;
  });
}
export async function addMediaTo(item, file, uid, save) {
  const isVideo = file.type.startsWith("video/");
  const blob = isVideo ? file : await compress(file); const pid = uuid();
  const ext = isVideo ? (file.type.includes("quicktime") ? "mov" : "mp4") : "jpg";
  await db.put("photos", { id: pid, item: item.id, path: `${uid}/${item.id}/${pid}.${ext}`, type: isVideo ? (file.type || "video/mp4") : "image/jpeg", blob, dirty: 1, deleted: false });
  item.data.photos = [...(item.data.photos || []), pid]; await save(item); return pid;
}
export const addPhotoTo = addMediaTo;
let photoRender = 0;
export async function renderThumbs(box, item, save) {
  const token = ++photoRender; box.innerHTML = "";
  for (const pid of item.data.photos || []) {
    if (token !== photoRender) return;
    const wrap = document.createElement("div"); wrap.className = "ph";
    const p = await db.get("photos", pid); const isVideo = p && (p.type || "").startsWith("video/");
    const img = document.createElement(isVideo ? "video" : "img"); if (isVideo) { img.controls = true; img.playsInline = true; img.muted = true; } else img.alt = "صورة";
    const blob = await photoBlob(pid);
    if (blob) { img.src = URL.createObjectURL(blob); if (!isVideo) img.onclick = () => window.open(img.src, "_blank"); } else if (!isVideo) img.alt = "لم تُنزَّل بعد";
    const del = document.createElement("button"); del.type = "button"; del.textContent = "✕"; del.setAttribute("aria-label", "حذف الصورة");
    del.onclick = async () => { if (!confirmAr("حذف الصورة؟")) return; const p = await db.get("photos", pid); if (p) await db.put("photos", { ...p, blob: null, deleted: true, dirty: 1 }); item.data.photos = item.data.photos.filter(x => x !== pid); await save(item); renderThumbs(box, item, save); };
    wrap.append(img, del); box.appendChild(wrap);
  }
}
export function photoButton(label = "إضافة صورة") { return `<label class="btn secondary big">${icon("camera")} ${esc(label)}<input type="file" accept="image/*" capture="environment" hidden data-photo></label>`; }
export function videoButton(label = "فيديو قصير") { return `<label class="btn secondary big">${icon("play")} ${esc(label)}<input type="file" accept="video/*" capture="environment" hidden data-video></label>`; }
