"""Split Chicago into its 77 community areas.

Takes the site data file produced by muni.py (parcels tagged with a municipality index) and replaces the single
Chicago municipality with Chicago's community areas, so the map, dropdown and table can break Chicago down.

Usage: python build/community_areas.py <site.json> <community_areas.geojson> <out.json>
Community areas: City of Chicago Data Portal, "Boundaries - Community Areas" (igwz-8jzy).
"""
import json, sys
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union

src, ca_path, out = sys.argv[1:4]
D = json.load(open(src))
if any(f['properties'].get('ca') for f in D['muniGeo']['features']):
    sys.exit('input already has community areas; run on muni.py output')

FIX = {"Ohare": "O'Hare", "Mckinley Park": "McKinley Park"}
def ca_name(n):
    t = n.strip().title()
    return FIX.get(t, t)

cas = sorted(({'name': ca_name(f['properties']['community']), 'num': int(f['properties']['area_numbe']),
               'g': shape(f['geometry']).buffer(0)} for f in json.load(open(ca_path))['features']), key=lambda c: c['name'])

old_feats = D['muniGeo']['features']
chi = D['munis'].index('Chicago')
keep = [i for i in range(len(D['munis'])) if i != chi]
remap = {old: new for new, old in enumerate(keep)}
base = len(keep)

unmatched = 0
for a in D['parcels']:
    m = a[9]
    if m == chi:
        pt = Point(a[1], a[0])
        hit = next((k for k, c in enumerate(cas) if c['g'].covers(pt)), None)
        if hit is None:  # on the edge of the city: nearest community area
            unmatched += 1
            hit = min(range(len(cas)), key=lambda k: cas[k]['g'].distance(pt))
        a[9] = base + hit
    elif m >= 0:
        a[9] = remap[m]

def rnd(c): return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]

feats = [old_feats[o] for o in keep] + [
    {"type": "Feature", "properties": {"name": c['name'], "ca": True, "num": c['num'], "partly": False},
     "geometry": {"type": c['g'].geom_type, "coordinates": rnd(mapping(c['g'].simplify(0.0001))['coordinates'])}} for c in cas]
names = [D['munis'][o] for o in keep] + [c['name'] for c in cas]

# recount every area from the parcels
stats = [dict(parcels=0, projects=set(), t35=0, t15=0, lac=0) for _ in feats]
for a in D['parcels']:
    if a[9] < 0: continue
    s = stats[a[9]]; s['parcels'] += 1; s['projects'].add(a[5]); s[{'35': 't35', '15': 't15', 'LAC': 'lac'}[a[3]]] += 1
for i, (f, s) in enumerate(zip(feats, stats)):
    f['properties'].update(i=i, parcels=s['parcels'], projects=len(s['projects']), t35=s['t35'], t15=s['t15'], lac=s['lac'])

city = unary_union([c['g'] for c in cas]).simplify(0.0002)
D['munis'] = names
D['muniGeo'] = {"type": "FeatureCollection", "features": feats}
D['chicagoOutline'] = {"type": "Feature", "properties": {}, "geometry": {"type": city.geom_type, "coordinates": rnd(mapping(city)['coordinates'])}}
json.dump(D, open(out, 'w'), separators=(',', ':'))
print(len(cas), 'community areas;', sum(1 for s in stats[base:] if s['parcels']), 'with parcels;',
      sum(s['parcels'] for s in stats[base:]), 'Chicago parcels;', unmatched, 'assigned to nearest area')
