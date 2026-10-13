// Local copy of everything, in IndexedDB. Every write lands here first (autosave), then
// sync.js pushes rows flagged dirty=1 to Supabase and pulls newer rows back.
const DB_NAME = "mustakshif", DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      const items = d.createObjectStore("items", { keyPath: "id" });
      items.createIndex("kind", "kind");
      items.createIndex("dirty", "dirty");
      const ex = d.createObjectStore("explored", { keyPath: "id" });
      ex.createIndex("dirty", "dirty");
      ex.createIndex("hood", "hood");
      const ph = d.createObjectStore("photos", { keyPath: "id" });
      ph.createIndex("dirty", "dirty");
      d.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async get(store, id) { return tx(store, "readonly", s => req(s.get(id))); },
  async all(store) { return tx(store, "readonly", s => req(s.getAll())); },
  async byIndex(store, index, value) { return tx(store, "readonly", s => req(s.index(index).getAll(value))); },
  async put(store, row) { return tx(store, "readwrite", s => { s.put(row); }); },
  async putMany(store, rows) { return tx(store, "readwrite", s => { for (const r of rows) s.put(r); }); },
  async del(store, id) { return tx(store, "readwrite", s => { s.delete(id); }); },
  async clear(store) { return tx(store, "readwrite", s => { s.clear(); }); },
  async count(store) { return tx(store, "readonly", s => req(s.count())); },
  /** read each row and write decide(current, incoming) if it returns a row, all inside ONE transaction */
  async mergeIn(store, rows, decide) {
    return tx(store, "readwrite", s => {
      for (const r of rows) {
        const g = s.get(r.id);
        g.onsuccess = () => { const out = decide(g.result, r); if (out) s.put(out); };
      }
    });
  },
  async meta(key, value) {
    if (value === undefined) { const r = await tx("meta", "readonly", s => req(s.get(key))); return r ? r.value : undefined; }
    return tx("meta", "readwrite", s => { s.put({ key, value }); });
  },
  async wipe() {
    for (const s of ["items", "explored", "photos", "meta"]) await this.clear(s);
  },
};

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export const nowIso = () => new Date().toISOString();
