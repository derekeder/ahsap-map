import csv, json, re, sys
clean, tw, mu, out = sys.argv[1:5]
TWN = {'NORTH':'North Chicago','SOUTH':'South Chicago','WEST':'West Chicago'}
def fix_twp(t):
    t=t.strip()
    if t.lower()=='west': return 'West Chicago'
    return t[:1].upper()+t[1:] if t.islower() else t
rows=list(csv.DictReader(open(clean)))
parcels={}; unmapped=0
for r in rows:
    p=r['pin']
    if not p or not r['lat']:
        unmapped+=1; continue
    if p in parcels:
        if r['pin_before_division']: parcels[p]['old'].append(r['pin_before_division'])
        continue
    parcels[p]=dict(pin=p,lat=round(float(r['lat']),6),lon=round(float(r['lon']),6),tier=r['tier'],
        year=int(r['first_year_sap']),note=r['first_year_note'],twp=fix_twp(r['township']),
        proj=r['project_name'],old=[r['pin_before_division']] if r['pin_before_division'] else [])
projs=sorted({v['proj'] for v in parcels.values()})
pi={n:i for i,n in enumerate(projs)}
twps=sorted({v['twp'] for v in parcels.values()})
ti={n:i for i,n in enumerate(twps)}
P=[[v['lat'],v['lon'],v['pin'],v['tier'],v['year'],pi[v['proj']],ti[v['twp']],v['old'],v['note']] for v in parcels.values()]
def rnd(c,n):
    return [rnd(x,n) for x in c] if isinstance(c[0],list) else [round(c[0],n),round(c[1],n)]
def ring_centroid(ring):
    a=cx=cy=0
    for (x1,y1),(x2,y2) in zip(ring,ring[1:]):
        f=x1*y2-x2*y1; a+=f; cx+=(x1+x2)*f; cy+=(y1+y2)*f
    return (cx/(3*a), cy/(3*a), abs(a/2)) if a else (ring[0][0],ring[0][1],0)
T=json.load(open(tw)); tf=[]
for f in T['features']:
    n=f['properties']['NAME']
    if not n: continue
    name=TWN.get(n, n.title())
    g=f['geometry']; polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    best=max((ring_centroid(p[0]) for p in polys), key=lambda c:c[2])
    tf.append({"type":"Feature","properties":{"name":name,"cx":round(best[0],4),"cy":round(best[1],4)},"geometry":{"type":g['type'],"coordinates":rnd(g['coordinates'],4)}})
M=json.load(open(mu)); mf=[]
for f in M['features']:
    g=f['geometry']
    if not g: continue
    mf.append({"type":"Feature","properties":{"name":f['properties']['MUNICIPALITY']},"geometry":{"type":g['type'],"coordinates":rnd(g['coordinates'],4)}})
data=dict(parcels=P,projects=projs,townships=twps,unmapped=unmapped,
          twpGeo={"type":"FeatureCollection","features":tf},muniGeo={"type":"FeatureCollection","features":mf})
open(out,'w').write(json.dumps(data,separators=(',',':')))
print(len(P),'parcels',len(projs),'projects',len(twps),'twps',unmapped,'unmapped; missing twp geo:',set(twps)-{f['properties']['name'] for f in tf})
