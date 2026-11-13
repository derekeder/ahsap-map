"""Add property characteristics (class, year built, building and land square footage) to the site data.

Sources (Cook County open data, https://datacatalog.cookcountyil.gov):
  - Assessor - Parcel Universe (Current), pabr-t5kh: property class for every PIN
  - Assessor - Commercial Valuation Data, csik-bsws: apartment buildings (7+ units) and mixed use
  - Assessor - Residential Single and Multi-Family Improvement Characteristics, x54s-btds: 2-6 unit buildings
Class descriptions: CCAO data-architecture repo, dbt/seeds/ccao/ccao.class_dict.csv

Downloads are cached in build/inputs/characteristics_cache/ so reruns are fast; delete that folder to refresh.

Usage: python build/characteristics.py <site.json> <out.json>
Each parcel row gets a[10] = [class, year_built, bldg_sf, land_sf, source_id] (or null). source_id identifies the
assessor record the numbers came from; a commercial record can cover several PINs, so sum by distinct source_id.
"""
import csv, io, json, os, sys, urllib.parse, urllib.request

src, out = sys.argv[1:3]
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'inputs', 'characteristics_cache')
os.makedirs(CACHE, exist_ok=True)
API = 'https://datacatalog.cookcountyil.gov/resource/'
CLASS_DICT = 'https://raw.githubusercontent.com/ccao-data/data-architecture/master/dbt/seeds/ccao/ccao.class_dict.csv'

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'ahsap-map build script'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode('utf-8')

def cached(name, fetch):
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        data = fetch()
        json.dump(data, open(path, 'w'))
    return json.load(open(path))

def soql(dataset, **params):
    rows, offset = [], 0
    while True:
        q = dict(params, **{'$limit': 50000, '$offset': offset, '$order': ':id'})
        page = json.loads(get(API + dataset + '.json?' + urllib.parse.urlencode(q)))
        rows += page; offset += len(page)
        if len(page) < 50000: return rows

def batched(dataset, pins, select):
    rows = []
    for i in range(0, len(pins), 150):
        chunk = ','.join("'" + p + "'" for p in pins[i:i + 150])
        rows += soql(dataset, **{'$select': select, '$where': 'pin in (' + chunk + ')'})
    return rows

num = lambda v: float(v) if v not in (None, '') else None
D = json.load(open(src))
pins = sorted({a[2] for a in D['parcels']})
dash = lambda p: '-'.join([p[0:2], p[2:4], p[4:7], p[7:10], p[10:14]])

universe = cached('parcel_universe.json', lambda: batched('pabr-t5kh', pins, 'pin,class'))
resid = cached('residential.json', lambda: batched('x54s-btds', pins, 'pin,year,card,class,char_yrblt,char_bldg_sf,char_land_sf'))
commercial = cached('commercial.json', lambda: soql('csik-bsws', **{'$select': 'keypin,pins,year,class_es,bldgsf,landsf,yearbuilt'}))
classes = cached('class_dict.json', lambda: {r['class_code']: r['class_desc'] for r in csv.DictReader(io.StringIO(get(CLASS_DICT)))})

cls = {r['pin']: r.get('class') for r in universe}
info = {}  # pin -> (year, [class, yrblt, bldg_sf, land_sf, source])

# residential: latest year per PIN; building area summed over cards, land taken once
by_pin = {}
for r in resid:
    by_pin.setdefault(r['pin'], {}).setdefault(int(float(r['year'])), []).append(r)
for p, years in by_pin.items():
    y = max(years); cards = years[y]
    yrs = [num(c.get('char_yrblt')) for c in cards if num(c.get('char_yrblt'))]
    bsf = sum(num(c.get('char_bldg_sf')) or 0 for c in cards)
    lsf = max((num(c.get('char_land_sf')) or 0 for c in cards), default=0)
    info[p] = (y, [cls.get(p) or cards[0].get('class'), int(min(yrs)) if yrs else None, round(bsf) or None, round(lsf) or None, p])

# commercial: latest record that lists the PIN; numbers belong to the whole record (keypin)
wanted = set(pins)
for r in commercial:
    group = [x.strip().replace('-', '') for x in (r.get('pins') or r.get('keypin') or '').split(',')]
    y = int(float(r['year']))
    for p in group:
        if p in wanted and (p not in info or info[p][0] < y or (info[p][0] == y and info[p][1][4] == p)):
            yb = num(r.get('yearbuilt'))
            info[p] = (y, [cls.get(p) or (r.get('class_es') or '').replace('-', ''), int(yb) if yb else None,
                           round(num(r.get('bldgsf')) or 0) or None, round(num(r.get('landsf')) or 0) or None,
                           'c' + r['keypin'].replace('-', '')])

used = set()
for a in D['parcels']:
    a[:] = a[:10]
    rec = info.get(a[2], (None, [cls.get(a[2]), None, None, None, None]))[1] if (a[2] in info or cls.get(a[2])) else None
    a.append(rec)
    if rec and rec[0]: used.add(rec[0])
D['classes'] = {c: classes[c] for c in sorted(used) if c in classes}
json.dump(D, open(out, 'w'), separators=(',', ':'))

n = len(D['parcels'])
have = lambda k: sum(1 for a in D['parcels'] if a[10] and a[10][k])
print(n, 'parcels; class', have(0), '| year built', have(1), '| building sf', have(2), '| land sf', have(3))
print('classes without a description:', sorted(used - set(classes)))
