// Public configuration. Only the anon key belongs here: it is safe to publish because
// row level security (supabase/schema.sql) is what protects the data, not this key.
// If these two values are left empty, the app shows a one-time connection screen and
// stores what you paste there in this browser only.
export const CONFIG = {
  SUPABASE_URL: "https://nvpereotfqmolnusrvzn.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52cGVyZW90ZnFtb2xudXNydnpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTE0ODMsImV4cCI6MjEwNzQ4NzQ4M30.9jt4BVPsyFryhlJxUR8wB-QosRlSoidAA4eJmw9l_xI",
  ALLOWED_EMAIL: "roody16jar@gmail.com",
  APP_VERSION: "0.2.0",
  HOODS_URL: "data/hoods.json",
  STREETS_URL: (hood) => `data/streets/${hood}.json`,
  BOUNDARY_URL: (hood) => `data/boundaries/${hood}.geojson`,
  SNAP_METERS: 20,          // a street counts as explored when a GPS fix is within this distance
  MAX_ACCURACY_METERS: 35,  // ignore worse GPS fixes
  PHOTO_MAX_PX: 1280,
  PHOTO_QUALITY: 0.8,
};

export function getConnection() {
  let url = CONFIG.SUPABASE_URL, key = CONFIG.SUPABASE_ANON_KEY;
  try {
    const saved = JSON.parse(localStorage.getItem("mustakshif.connection") || "null");
    if (saved && saved.url && saved.key) { url = saved.url; key = saved.key; }
  } catch {}
  return { url, key };
}

export function saveConnection(url, key) {
  localStorage.setItem("mustakshif.connection", JSON.stringify({ url: url.trim().replace(/\/+$/, ""), key: key.trim() }));
}
