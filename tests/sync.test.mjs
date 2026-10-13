// Sync logic against a fake Supabase client and a fake IndexedDB: push dirty rows in batches,
// pull newer rows, last-write-wins, offline, and RLS-style rejection.
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";

const nav = { onLine: true };
Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {}, hidden: false };

const { db } = await import("../js/db.js");
const { sync } = await import("../js/sync.js");

function fakeSupabase() {
  const tables = { items: new Map(), explored: new Map() }; const calls = [];
  const from = (t) => {
    const q = {};
    q.upsert = async (rows, opts) => {
      calls.push({ t, op: "upsert", n: rows.length, opts });
      for (const r of rows) { if (r.user_id !== "u1") return { error: new Error("new row violates row-level security policy") }; const k = t === "explored" ? r.user_id + "|" + r.id : r.id; const old = tables[t].get(k); if (old && r.updated_at < old.updated_at) continue; tables[t].set(k, { ...r, synced_at: new Date(Date.now() + calls.length).toISOString() }); }
      return { error: null };
    };
    q.select = () => q; q.gte = (col, v) => { q._since = v; return q; }; q.order = () => q;
    q.limit = async (n) => { const rows = [...tables[t].values()].filter(r => r.synced_at >= q._since).sort((a, b) => a.synced_at < b.synced_at ? -1 : a.synced_at > b.synced_at ? 1 : (a.id < b.id ? -1 : 1)).slice(0, n); calls.push({ t, op: "select", n: rows.length }); return { data: rows, error: null }; };
    return q;
  };
  const storage = { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), download: async () => ({ data: null, error: new Error("no") }) }) };
  return { from, storage, tables, calls };
}

test("push dirty items and explored in batches, then they are clean", async () => {
  const sb = fakeSupabase(); sync.init(sb, "u1");
  const rows = []; for (let i = 0; i < 450; i++) rows.push({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, kind: "target", data: { i }, deleted: false, updated_at: "2026-10-13T10:00:00.000Z", created_at: "2026-10-13T10:00:00.000Z", dirty: 1 });
  await db.putMany("items", rows);
  const ex = []; for (let i = 0; i < 1200; i++) ex.push({ id: `narjis:${i}`, hood: "narjis", explored_at: "2026-10-13T10:00:00.000Z", updated_at: "2026-10-13T10:00:00.000Z", deleted: false, dirty: 1 });
  await db.putMany("explored", ex);
  await sync.run();
  assert.equal(sync.state.status, "synced", sync.state.error);
  assert.equal(sb.tables.items.size, 450); assert.equal(sb.tables.explored.size, 1200);
  assert.deepEqual(sb.calls.filter(c => c.op === "upsert" && c.t === "items").map(c => c.n), [200, 200, 50]);
  assert.deepEqual(sb.calls.filter(c => c.op === "upsert" && c.t === "explored").map(c => c.n), [500, 500, 200]);
  assert.equal((await db.byIndex("items", "dirty", 1)).length, 0);
  assert.equal((await db.byIndex("explored", "dirty", 1)).length, 0);
  assert.equal(sync.state.pending, 0);
});

test("pull brings newer remote rows and a dirty local edit is pushed first and wins", async () => {
  const sb = fakeSupabase(); sync.init(sb, "u1");
  const id = "11111111-0000-4000-8000-000000000001", id2 = "11111111-0000-4000-8000-000000000002";
  sb.tables.items.set(id, { id, user_id: "u1", kind: "property", data: { remote: true }, deleted: false, updated_at: "2026-10-13T12:00:00.000Z", created_at: "2026-10-13T12:00:00.000Z", synced_at: new Date().toISOString() });
  sb.tables.items.set(id2, { id: id2, user_id: "u1", kind: "property", data: { remote: true }, deleted: false, updated_at: "2026-10-13T12:00:00.000Z", created_at: "2026-10-13T12:00:00.000Z", synced_at: new Date().toISOString() });
  await db.put("items", { id: id2, kind: "property", data: { local: true }, deleted: false, updated_at: "2026-10-13T11:00:00.000Z", dirty: 1 });
  await sync.run();
  assert.equal(sync.state.status, "synced", sync.state.error);
  const a = await db.get("items", id); assert.equal(a.data.remote, true); assert.equal(a.dirty, 0);
  const b = await db.get("items", id2); assert.equal(b.dirty, 0);
  // server-side last-write-wins (simulated trigger): the newer remote row survives and comes back on pull
  assert.equal(sb.tables.items.get(id2).data.remote, true); assert.equal(b.data.remote, true);
});

test("an edit made while a push is in flight is not clobbered (stays dirty)", async () => {
  const sb = fakeSupabase(); sync.init(sb, "u1");
  const id = "44444444-0000-4000-8000-000000000001";
  await db.put("items", { id, kind: "note", data: { v: 1 }, deleted: false, updated_at: "2026-10-13T14:00:00.000Z", dirty: 1 });
  const slowFrom = sb.from;
  sb.from = (t) => { const q = slowFrom(t); const u = q.upsert; q.upsert = async (rows, o) => { await db.put("items", { id, kind: "note", data: { v: 2 }, deleted: false, updated_at: "2026-10-13T14:00:01.000Z", dirty: 1 }); return u(rows, o); }; return q; };
  await sync.run();
  const row = await db.get("items", id);
  assert.equal(row.data.v, 2); assert.equal(row.dirty, 1, "newer local edit must stay dirty");
  sb.from = slowFrom; await sync.run();
  assert.equal((await db.get("items", id)).dirty, 0); assert.equal(sb.tables.items.get(id).data.v, 2);
});

test("offline: nothing is sent and status says offline", async () => {
  nav.onLine = false;
  const sb = fakeSupabase(); sync.init(sb, "u1");
  await db.put("items", { id: "22222222-0000-4000-8000-000000000001", kind: "note", data: {}, deleted: false, updated_at: "2026-10-13T13:00:00.000Z", dirty: 1 });
  await sync.run();
  assert.equal(sync.state.status, "offline"); assert.equal(sb.calls.length, 0); assert.ok(sync.state.pending >= 1);
  nav.onLine = true;
});

test("RLS-style rejection surfaces as an error and rows stay dirty", async () => {
  const sb = fakeSupabase(); sync.init(sb, "u2");
  await db.put("items", { id: "33333333-0000-4000-8000-000000000001", kind: "note", data: {}, deleted: false, updated_at: "2026-10-13T13:00:00.000Z", dirty: 1 });
  await sync.run();
  assert.equal(sync.state.status, "error");
  assert.ok((await db.byIndex("items", "dirty", 1)).length >= 1);
});
