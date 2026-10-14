"""Add a district in ONE command: boundary from OpenStreetMap (Nominatim), streets from Overpass,
hoods.json + data/boundaries/<key>.geojson + data/streets/<key>.json + data/streets/index.json.

  python tools/add_district.py <key> "<الاسم العربي>" [--query "Al Munsiyah, Riyadh"]

  example:  python tools/add_district.py munsiyah "المونسية"
Then commit and push; the app lists the district automatically.
"""
import json, math, os, sys, time, urllib.parse, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import fetch_streets   # reuse the street fetcher

UA = "mustakshif-add-district/0.1"
R = 6371000.0

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read())

def boundary(query):
    q = urllib.parse.urlencode({"q": query, "format": "jsonv2", "polygon_geojson": 1, "limit": 5, "accept-language": "ar"})
    res = get("https://nominatim.openstreetmap.org/search?" + q)
    res = [r for r in res if r.get("osm_type") == "relation" and r.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon")]
    if not res: raise SystemExit("لم أجد حدود هذا الحي في OpenStreetMap. جرّب --query باسم آخر، مثل 'Al Narjis, Riyadh'")
    r = res[0]; g = r["geojson"]
    ring = g["coordinates"][0] if g["type"] == "Polygon" else max(g["coordinates"], key=lambda p: len(p[0]))[0]
    return r, [[round(x, 7), round(y, 7)] for x, y in ring]

def dist(a, b):
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2)); y = math.radians(b[1] - a[1]); return math.sqrt(x * x + y * y) * R

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2: raise SystemExit(__doc__)
    key, ar = args[0], args[1]
    query = sys.argv[sys.argv.index("--query") + 1] if "--query" in sys.argv else f"{ar}, الرياض"
    print("1/4 الحدود من Nominatim:", query)
    r, ring = boundary(query); time.sleep(1)
    lons = [p[0] for p in ring]; lats = [p[1] for p in ring]
    bbox = [round(min(lons), 4), round(min(lats), 4), round(max(lons), 4), round(max(lats), 4)]
    os.makedirs(os.path.join(ROOT, "data", "boundaries"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "boundaries", f"{key}.geojson"), "w", encoding="utf-8") as f:
        json.dump({"type": "Feature", "properties": {"hood": key, "source": f"OpenStreetMap relation {r['osm_id']} (ODbL)"}, "geometry": {"type": "Polygon", "coordinates": [ring]}}, f, ensure_ascii=False)
    hp = os.path.join(ROOT, "data", "hoods.json"); hoods = json.load(open(hp, encoding="utf-8"))
    hoods[key] = {"ar": ar, "bbox": bbox}
    with open(hp, "w", encoding="utf-8") as f: json.dump(hoods, f, ensure_ascii=False, indent=2)
    print("2/4 الشوارع من Overpass (قد يستغرق دقائق)")
    fetch_streets.build(key, hoods[key])
    print("3/4 فهرس الأحياء")
    ip = os.path.join(ROOT, "data", "streets", "index.json"); idx = json.load(open(ip, encoding="utf-8")) if os.path.exists(ip) else {}
    d = json.load(open(os.path.join(ROOT, "data", "streets", f"{key}.json"), encoding="utf-8")); L = 0.0
    for ft in d["features"]:
        c = ft["geometry"]["coordinates"]
        for i in range(1, len(c)): L += dist(c[i - 1], c[i])
    idx[key] = {"streets": len(d["features"]), "length_m": round(L), "center": [round(sum(lats) / len(lats), 5), round(sum(lons) / len(lons), 5)]}
    with open(ip, "w", encoding="utf-8") as f: json.dump(idx, f, ensure_ascii=False)
    print(f"4/4 تم: {ar} ({key}) — {idx[key]['streets']} شارع، {idx[key]['length_m'] // 1000} كم. الآن: git add -A && git commit -m \"حي {ar}\" && git push")

if __name__ == "__main__":
    main()
