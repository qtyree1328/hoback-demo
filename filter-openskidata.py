import json, sys

BBOX = [-110.92, 43.55, -110.80, 43.62]

def coord_in_bbox(c):
    return BBOX[0] <= c[0] <= BBOX[2] and BBOX[1] <= c[1] <= BBOX[3]

def any_coord_in_bbox(geom):
    t = geom.get('type','')
    coords = geom.get('coordinates',[])
    if t == 'Point': return coord_in_bbox(coords)
    if t == 'LineString': return any(coord_in_bbox(c) for c in coords)
    if t in ('MultiLineString','Polygon'): return any(coord_in_bbox(c) for ring in coords for c in ring)
    if t == 'MultiPolygon': return any(coord_in_bbox(c) for poly in coords for ring in poly for c in ring)
    return False

def process(inp, outp, label):
    print(f"Reading {label}...")
    with open(inp) as f:
        data = json.load(f)
    total = len(data['features'])
    print(f"Total: {total}")
    filtered = [ft for ft in data['features'] if ft.get('geometry') and any_coord_in_bbox(ft['geometry'])]
    print(f"JH bbox: {len(filtered)}")
    if filtered:
        print(f"\nSample props:\n{json.dumps(filtered[0].get('properties',{}), indent=2)[:2000]}")
    with open(outp, 'w') as f:
        json.dump({'type':'FeatureCollection','features':filtered}, f)
    print(f"Wrote {outp}\n")

process('/tmp/openskidata-runs-full.geojson', 'data/jh-runs.geojson', 'runs')
process('/tmp/openskidata-lifts-full.geojson', 'data/jh-lifts.geojson', 'lifts')
