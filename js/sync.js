// Two-way sync between IndexedDB (db.js) and Supabase.
// Push: rows flagged dirty, in batches. Pull: rows whose server-side synced_at is newer than
// our cursor (so offline edits from another device are never skipped). Conflicts: the row with
// the later updated_at wins, both here and on the server (trigger in schema.sql).
import { db, nowIso } from "./db.js";
import { newer } from "./geo.js";

const listeners = new Set();
let state = { status: "idle", pending: 0, error: null, last: null, online: navigator.onLine };
let client = null, userId = null, running = false, timer = null, scheduled = null, again = false, started = false;

export const sync = {
  init(supabase, uid) { client = supabase; userId = uid; },
  onChange(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
  get state() { return state; },
  /** call after any local write; batches into one push ~1.5s later */
  schedule(delay = 1500) {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => sync.run(), delay);
    sync.refreshPending();
  },
  start() {
    if (!started) {
      started = true;
      window.addEventListener("online", () => { set({ online: true }); sync.run(); });
      window.addEventListener("offline", () => set({ online: false, status: "offline" }));
      document.addEventListener("visibilitychange", () => { if (!document.hidden) sync.run(); });
    }
    clearInterval(timer); timer = setInterval(() => sync.run(), 45000);
    sync.run();
  },
  stop() { clearInterval(timer); clearTimeout(scheduled); client = null; userId = null; },
  async refreshPending() {
    const [a, b, c] = await Promise.all([db.byIndex("items", "dirty", 1), db.byIndex("explored", "dirty", 1), db.byIndex("photos", "dirty", 1)]);
    set({ pending: a.length + b.length + c.length });
  },
  async run() {
    if (!client || !userId) return;
    if (running) { again = true; return; }
    if (!navigator.onLine) { set({ status: "offline", online: false }); await sync.refreshPending(); return; }
    running = true; set({ status: "syncing", error: null, online: true });
    const c = client, uid = userId;
    let softError = null;
    try {
      await pushItems(c, uid); await pushExplored(c, uid);
      softError = await pushPhotos(c);
      await pullTable(c, "items", "items.cursor", toLocalItem);
      await pullTable(c, "explored", "explored.cursor", toLocalExplored);
      await sync.refreshPending();
      set({ status: softError ? "error" : "synced", last: nowIso(), error: softError });
      listeners.forEach(fn => fn({ ...state, event: "pulled" }));
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/failed to fetch|load failed|network/i.test(msg)) set({ status: "offline", online: false, error: null });
      else { console.error("sync", e); set({ status: "error", error: msg }); }
    } finally {
      running = false;
      if (again) { again = false; setTimeout(() => sync.run(), 500); }
    }
  },
};

function set(patch) { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); }
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/** clear dirty only on rows the user has not touched since the snapshot was taken */
const clearDirty = (store, batch) => db.mergeIn(store, batch, (cur, sent) => (cur && cur.updated_at === sent.updated_at && cur.deleted === sent.deleted) ? { ...cur, dirty: 0 } : null);

async function pushItems(c, uid) {
  const dirty = await db.byIndex("items", "dirty", 1);
  for (const batch of chunk(dirty, 200)) {
    const rows = batch.map(r => ({ id: r.id, user_id: uid, kind: r.kind, data: r.data, deleted: !!r.deleted, updated_at: r.updated_at, created_at: r.created_at || r.updated_at }));
    const { error } = await c.from("items").upsert(rows, { onConflict: "id" });
    if (error) throw error;
    await clearDirty("items", batch);
  }
}
async function pushExplored(c, uid) {
  const dirty = await db.byIndex("explored", "dirty", 1);
  for (const batch of chunk(dirty, 500)) {
    const rows = batch.map(r => ({ id: r.id, user_id: uid, hood: r.hood, explored_at: r.explored_at, updated_at: r.updated_at, deleted: !!r.deleted }));
    const { error } = await c.from("explored").upsert(rows, { onConflict: "user_id,id" });
    if (error) throw error;
    await clearDirty("explored", batch);
  }
}
/** returns an error message if some photo failed (others still proceed), else null */
async function pushPhotos(c) {
  const dirty = await db.byIndex("photos", "dirty", 1);
  let failed = null;
  for (const p of dirty) {
    try {
      if (p.deleted) {
        const { error } = await c.storage.from("photos").remove([p.path]);
        if (error && !/not found/i.test(error.message)) throw error;
        await db.del("photos", p.id); continue;
      }
      if (!p.blob) { await db.mergeIn("photos", [p], (cur) => cur && !cur.deleted ? { ...cur, dirty: 0 } : null); continue; }
      const { error } = await c.storage.from("photos").upload(p.path, p.blob, { upsert: true, contentType: "image/jpeg" });
      if (error) throw error;
      await db.mergeIn("photos", [p], (cur) => cur && !cur.deleted ? { ...cur, dirty: 0 } : null);
    } catch (e) { failed = "صورة لم تُرفع: " + ((e && e.message) || e); console.error("photo", p.id, e); }
  }
  return failed;
}
const toLocalItem = (r) => ({ id: r.id, kind: r.kind, data: r.data, deleted: r.deleted, updated_at: r.updated_at, created_at: r.created_at, dirty: 0 });
const toLocalExplored = (r) => ({ id: r.id, hood: r.hood, explored_at: r.explored_at, updated_at: r.updated_at, deleted: r.deleted, dirty: 0 });

async function pullTable(c, table, cursorKey, toLocal) {
  let since = (await db.meta(cursorKey)) || "1970-01-01T00:00:00Z";
  for (let page = 0; page < 50; page++) {
    // gte + idempotent merge: rows sharing the cursor timestamp are re-read, never skipped
    const { data, error } = await c.from(table).select("*").gte("synced_at", since).order("synced_at").order("id").limit(1000);
    if (error) throw error;
    if (!data.length) break;
    await db.mergeIn(table, data, (local, r) => {
      if (local && local.dirty) return null;                 // unsynced local edit: pushed on the next run, then compared again
      return newer(local, r) === r ? toLocal(r) : null;
    });
    const maxSynced = data[data.length - 1].synced_at;
    if (maxSynced === since && data.length < 1000) break;
    since = maxSynced; await db.meta(cursorKey, since);
    if (data.length < 1000) break;
  }
}

/** Fetch a photo blob: local first, else download from storage and cache it. */
export async function photoBlob(id) {
  const p = await db.get("photos", id);
  if (!p || p.deleted) return null;
  if (p.blob) return p.blob;
  if (!client) return null;
  const { data, error } = await client.storage.from("photos").download(p.path);
  if (error) return null;
  await db.put("photos", { ...p, blob: data });
  return data;
}

/** Make sure every photo id referenced by items has a local row (so it can be downloaded lazily). */
export async function registerRemotePhotos(uid, items) {
  for (const it of items) {
    for (const pid of (it.data && it.data.photos) || []) {
      const have = await db.get("photos", pid);
      if (!have) await db.put("photos", { id: pid, item: it.id, path: `${uid}/${it.id}/${pid}.jpg`, dirty: 0 });
    }
  }
}
