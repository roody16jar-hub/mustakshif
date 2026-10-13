"""Upload the scout's targets (Aqar/out/<hood>/targets_verified.json or targets.json) into YOUR
Supabase account as private rows (kind = target), plus one "scan" summary row per district.
Runs on your PC, signs in with your email + password (asked at run time, never stored), and
talks to the normal REST API, so row level security applies exactly as in the app.

  python tools/upload_targets.py                       all districts found in the scout folder
  python tools/upload_targets.py narjis malqa          only these
  python tools/upload_targets.py --dry-run             show what would be uploaded

Existing targets (matched by data.ref) keep their status, notes, owner data and photos.
"""
import getpass, glob, json, os, re, sys, urllib.request, urllib.error, uuid, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SCOUT_OUT = os.environ.get("SCOUT_OUT", os.path.join(os.path.dirname(ROOT), "Aqar", "out"))
MY_TYPES = {"single", "small_dev"}          # individual owner / individual developer

def read_config():
    s = open(os.path.join(ROOT, "js", "config.js"), encoding="utf-8").read()
    url = re.search(r'SUPABASE_URL:\s*"([^"]+)"', s).group(1); key = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', s).group(1)
    email = re.search(r'ALLOWED_EMAIL:\s*"([^"]+)"', s).group(1)
    return url, key, email

def api(url, key, path, method="GET", body=None, token=None, headers=None):
    h = {"apikey": key, "Content-Type": "application/json", "Authorization": f"Bearer {token or key}"}
    h.update(headers or {})
    req = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read(); return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")

def load_hood(hood):
    d = os.path.join(SCOUT_OUT, hood)
    f = os.path.join(d, "targets_verified.json")
    if not os.path.exists(f): f = os.path.join(d, "targets.json")
    if not os.path.exists(f): return None
    j = json.load(open(f, encoding="utf-8"))
    verify = {}
    vf = os.path.join(d, "verify.json")
    if os.path.exists(vf): verify = json.load(open(vf, encoding="utf-8"))
    return j, verify, os.path.basename(f)

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; dry = "--dry-run" in sys.argv
    url, key, email = read_config()
    hoods = args or sorted(os.path.basename(p) for p in glob.glob(os.path.join(SCOUT_OUT, "*")) if os.path.isdir(p))
    token = uid = None
    if not dry:
        pw = getpass.getpass(f"كلمة مرور {email}: ")
        s = api(url, key, "/auth/v1/token?grant_type=password", "POST", {"email": email, "password": pw})
        token, uid = s["access_token"], s["user"]["id"]
        existing = api(url, key, "/rest/v1/items?kind=eq.target&select=id,data,deleted", token=token)
        by_ref = {r["data"].get("ref"): r for r in existing if r["data"].get("ref")}
        scans = {r["data"].get("hood"): r for r in api(url, key, "/rest/v1/items?kind=eq.scan&select=id,data", token=token)}
    else:
        by_ref, scans = {}, {}
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for hood in hoods:
        got = load_hood(hood)
        if not got: print(hood, ": لا يوجد ملف أهداف"); continue
        j, verify, fname = got
        targets = j["targets"] if isinstance(j, dict) else j
        rows, added, updated = [], 0, 0
        for t in targets:
            v = verify.get(t["id"], {})
            fields = {"ref": t["id"], "title": t["id"], "hood": hood, "lat": t["lat"], "lon": t["lon"], "area": t.get("area"),
                      "kind_label": t.get("kind"), "kind_key": t.get("kind_key"), "phase": t.get("phase"), "phase_key": t.get("phase_key"),
                      "use": t.get("use"), "score": t.get("score"), "why": t.get("why"), "bonus": t.get("bonus"),
                      "verified": bool(t.get("verified")), "verify_note": v.get("note"), "my_type": t.get("kind_key") in MY_TYPES,
                      "scan_date": j.get("date") if isinstance(j, dict) else None, "source": "scan"}
            cur = by_ref.get(t["id"])
            if cur:
                data = dict(cur["data"]); data.update({k: val for k, val in fields.items() if val is not None}); rid = cur["id"]; updated += 1
            else:
                data = {**fields, "status": "new", "photos": []}; rid = str(uuid.uuid4()); added += 1
            rows.append({"id": rid, "user_id": uid, "kind": "target", "data": data, "deleted": False, "updated_at": now, "created_at": now})
        of_my_type = sum(1 for t in targets if t.get("kind_key") in MY_TYPES)
        scan = {"hood": hood, "scan_date": j.get("date") if isinstance(j, dict) else None, "file": fname, "total": len(targets),
                "verified": sum(1 for t in targets if t.get("verified")), "of_my_type": of_my_type, "uploaded_at": now}
        sc = scans.get(hood)
        rows.append({"id": sc["id"] if sc else str(uuid.uuid4()), "user_id": uid, "kind": "scan", "data": scan, "deleted": False, "updated_at": now, "created_at": now})
        print(f"{hood}: {len(targets)} هدف ({added} جديد، {updated} محدّث)، موثّق {scan['verified']}، من نوعي {of_my_type}")
        if dry: continue
        for i in range(0, len(rows), 200):
            api(url, key, "/rest/v1/items?on_conflict=id", "POST", rows[i:i + 200], token=token, headers={"Prefer": "resolution=merge-duplicates,return=minimal"})
    print("تم." if not dry else "تجربة فقط، لم يُرفع شيء.")

if __name__ == "__main__":
    main()
