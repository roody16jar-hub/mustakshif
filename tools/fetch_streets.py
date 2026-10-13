"""Fetch street geometry for each district from OpenStreetMap (Overpass, ODbL) and write
compact GeoJSON to data/streets/<hood>.json. Ways are clipped to the district polygon
(kept if any vertex falls inside). No third-party packages.

  python tools/fetch_streets.py            all districts in data/hoods.json
  python tools/fetch_streets.py malaz      one district
"""
import json, os, sys, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SERVERS = ["https://overpass.kumi.systems/api/interpreter",
           "https://overpass-api.de/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
HW = "residential|tertiary|secondary|primary|trunk|living_street|unclassified|service|pedestrian|tertiary_link|secondary_link|primary_link"
UA = "mustakshif-street-fetch/0.1"


def fetch(bbox):
    w, s, e, n = bbox
    q = f'[out:json][timeout:170];way["highway"~"^({HW})$"]({s},{w},{n},{e});out geom tags;'
    last = None
    for srv in SERVERS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(srv, data=urllib.parse.urlencode({"data": q}).encode(),
                                             headers={"User-Agent": UA, "Accept": "application/json"})
                body = urllib.request.urlopen(req, timeout=200).read()
                return json.loads(body)["elements"]
            except Exception as ex:
                last = ex; print("  retry", srv, repr(ex)[:120]); time.sleep(10)
    raise RuntimeError(f"all overpass servers failed: {last}")


def inside(pt, ring):
    x, y = pt; c = False; n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def build(hood, meta):
    poly = json.load(open(os.path.join(ROOT, "data", "boundaries", f"{hood}.geojson"), encoding="utf-8"))
    ring = poly["geometry"]["coordinates"][0]
    print(hood, "fetching", meta["bbox"])
    ways = fetch(meta["bbox"])
    feats = []
    for w in ways:
        if "geometry" not in w: continue
        coords = [[round(p["lon"], 6), round(p["lat"], 6)] for p in w["geometry"]]
        if len(coords) < 2 or not any(inside(c, ring) for c in coords): continue
        t = w.get("tags", {})
        if t.get("service") in ("parking_aisle", "driveway", "drive-through"): continue
        if t.get("access") in ("private", "no") and t.get("highway") == "service": continue
        props = {"id": w["id"], "hw": t.get("highway", "")}
        name = t.get("name:ar") or t.get("name")
        if name: props["name"] = name
        feats.append({"type": "Feature", "id": w["id"], "properties": props,
                      "geometry": {"type": "LineString", "coordinates": coords}})
    out = {"type": "FeatureCollection", "hood": hood, "name": meta["ar"],
           "source": "OpenStreetMap contributors (ODbL)", "fetched": time.strftime("%Y-%m-%d"), "features": feats}
    path = os.path.join(ROOT, "data", "streets", f"{hood}.json")
    with open(path, "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(hood, "ways fetched", len(ways), "kept", len(feats), "size KB", os.path.getsize(path) // 1024)


if __name__ == "__main__":
    hoods = json.load(open(os.path.join(ROOT, "data", "hoods.json"), encoding="utf-8"))
    names = sys.argv[1:] or [k for k in hoods if not k.startswith("_")]
    for h in names:
        build(h, hoods[h]); time.sleep(5)
