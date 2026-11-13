import json, csv, sys
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree
data_p, places_p, out_csv = sys.argv[1:4]
D = json.load(open(data_p))
cook = unary_union([shape(f['geometry']).buffer(0) for f in D['twpGeo']['features']]).buffer(0)
places = []
for f in json.load(open(places_p))['features']:
    g = shape(f['geometry']).buffer(0)
    inter = g.intersection(cook).area
    if inter / g.area < 0.02 and inter < 2e-5:  # skip slivers along the county line
        continue
    pr = f['properties']
    places.append(dict(geoid=pr['GEOID'], name=pr['BASENAME'], full=pr['NAME'], g=g, share=inter / g.area))
tree = STRtree([p['g'] for p in places])
counts = {p['geoid']: dict(parcels=0, projects=set(), t35=0, t15=0, lac=0) for p in places}
unin = dict(parcels=0, projects=set(), t35=0, t15=0, lac=0)
pmuni = []
for a in D['parcels']:
    pt = Point(a[1], a[0])
    hit = [i for i in tree.query(pt) if places[i]['g'].covers(pt)]
    idx = int(hit[0]) if hit else -1
    pmuni.append(idx)
    c = counts[places[idx]['geoid']] if idx >= 0 else unin
    c['parcels'] += 1; c['projects'].add(a[5]); c[{'35': 't35', '15': 't15', 'LAC': 'lac'}[a[3]]] += 1
for a, m in zip(D['parcels'], pmuni): a.append(m)
rows = []
for p in places:
    c = counts[p['geoid']]
    rows.append([p['name'], p['full'], p['geoid'], c['parcels'], len(c['projects']), c['t35'], c['t15'], c['lac'], 'yes' if p['share'] > 0.98 else 'partly'])
rows.sort(key=lambda r: (-r[3], r[0]))
rows.append(['Unincorporated Cook County', '', '', unin['parcels'], len(unin['projects']), unin['t35'], unin['t15'], unin['lac'], ''])
with open(out_csv, 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['municipality', 'census_name', 'geoid', 'parcels', 'projects', 'tier_35_parcels', 'tier_15_parcels', 'lac_parcels', 'entirely_in_cook']); w.writerows(rows)
def rnd(c): return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]
D['muniGeo'] = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"i": i, "name": p['name'], "parcels": counts[p['geoid']]['parcels'], "projects": len(counts[p['geoid']]['projects']),
      "t35": counts[p['geoid']]['t35'], "t15": counts[p['geoid']]['t15'], "lac": counts[p['geoid']]['lac'], "partly": p['share'] <= 0.98},
     "geometry": {"type": p['g'].geom_type, "coordinates": rnd(mapping(p['g'].simplify(0.0001))['coordinates'])}} for i, p in enumerate(places)]}
D['munis'] = [p['name'] for p in places]
D['unincorporated'] = dict(parcels=unin['parcels'], projects=len(unin['projects']))
json.dump(D, open(data_p.replace('.json', '_muni.json'), 'w'), separators=(',', ':'))
with_any = sum(1 for p in places if counts[p['geoid']]['parcels'])
print(len(places), 'places in Cook;', with_any, 'with AHSAP parcels; unincorporated:', unin['parcels'], 'parcels')
for r in rows[:15]: print(r[0], r[3], r[4])
