import csv, json, sys
src, outcsv, outgj = sys.argv[1:4]
with open(src, newline='', encoding='utf-8-sig') as f:
    r = csv.reader(f); hdr = next(r); rows = list(r)
keep = [0,1,3,4,5,6,8]  # drop duplicate pin + constant "Distinct count of PIN"
names = ["pin","tier",'project_name','township','lat','lon','project_pin_count']
out = [[row[i] for i in keep] for row in rows]
out.sort(key=lambda x: (x[2], x[0]))
with open(outcsv,'w',newline='') as f:
    w=csv.writer(f); w.writerow(names); w.writerows(out)
feats=[]
for o in out:
    d=dict(zip(names,o))
    feats.append({"type":"Feature","geometry":{"type":"Point","coordinates":[float(d['lon']),float(d['lat'])]},
      "properties":{"pin":d['pin'],"tier":d["tier"],"project_name":d['project_name'],"township":d['township'],"project_pin_count":int(d['project_pin_count'])}})
json.dump({"type":"FeatureCollection","features":feats},open(outgj,'w'))
print(len(out), "rows;", len({o[2] for o in out}), "projects; tiers:", {t:sum(1 for o in out if o[1]==t) for t in {o[1] for o in out}})
print("distinct-count col values:", {row[7] for row in rows}, "dup pin match:", all(row[0]==row[2] for row in rows))
