// In-memory view of the items table + helpers to create/update/delete rows (autosave).
import { db, uuid, nowIso } from "./db.js";
import { sync, registerRemotePhotos } from "./sync.js";

export const S = { uid: null, email: null, hood: null, hoods: {}, items: [], explored: new Map(), syncBound: false, offline: false };
const listeners = new Set(); let lastSig = null;
export const onItems = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

export const store = {
  async load() {
    S.items = (await db.all("items")).filter(r => !r.deleted);
    await registerRemotePhotos(S.uid, S.items.filter(i => i.data && i.data.photos && i.data.photos.length));
    const sig = S.items.map(i => i.id + ":" + i.updated_at).sort().join("|");
    if (sig !== lastSig) { lastSig = sig; emit(); }     // a pull that brings nothing new must not re-render the screen under the user
  },
  all(kind) { return kind ? S.items.filter(i => i.kind === kind) : S.items; },
  get(id) { return S.items.find(i => i.id === id); },
  setting(key) { const s = S.items.find(i => i.kind === "setting" && i.data.key === key); return s ? s.data.value : undefined; },
  async setSetting(key, value) {
    let s = S.items.find(i => i.kind === "setting" && i.data.key === key);
    if (!s) s = { id: uuid(), kind: "setting", data: { key, value }, deleted: false };
    s.data.value = value; return store.save(s);
  },
  async create(kind, data) { const item = { id: uuid(), kind, data: { ...data }, deleted: false }; await store.save(item); return item; },
  async save(item) {
    item.updated_at = nowIso(); item.dirty = 1; item.created_at = item.created_at || item.updated_at;
    await db.put("items", item);
    const i = S.items.findIndex(x => x.id === item.id);
    if (item.deleted) { if (i >= 0) S.items.splice(i, 1); } else if (i >= 0) S.items[i] = item; else S.items.push(item);
    lastSig = S.items.map(i => i.id + ":" + i.updated_at).sort().join("|");   // so the next pull only re-renders when the server brought something new
    emit(); sync.schedule(); return item;
  },
  async remove(item) {
    item.deleted = true;
    for (const pid of (item.data && item.data.photos) || []) { const p = await db.get("photos", pid); if (p) await db.put("photos", { ...p, blob: null, deleted: true, dirty: 1 }); }
    return store.save(item);
  },
  /** rows for one district; ids are segment ids ("way:seq"); old way-level ids are kept as "way" */
  async exploredFor(hood) { return (await db.byIndex("explored", "hood", hood)).filter(r => !r.deleted).map(r => ({ id: r.id.slice(hood.length + 1), explored_at: r.explored_at })); },
  async exploredCounts() {
    const rows = (await db.all("explored")).filter(r => !r.deleted); const c = {};
    for (const r of rows) c[r.hood] = (c[r.hood] || 0) + 1; return c;
  },
  async markExplored(hood, wayIds, on = true) {
    const now = nowIso();
    await db.putMany("explored", wayIds.map(w => ({ id: `${hood}:${w}`, hood, explored_at: now, updated_at: now, deleted: !on, dirty: 1 })));
    sync.schedule(on ? 8000 : 2000);
  },
  async clearExplored(hood) {
    const rows = (await db.byIndex("explored", "hood", hood)).filter(r => !r.deleted); const now = nowIso();
    await db.putMany("explored", rows.map(r => ({ ...r, deleted: true, updated_at: now, dirty: 1 }))); sync.schedule();
  },
};
export { uuid, nowIso };
