# OpenStreetMap(map.osm) → 게임용 지도 데이터(data/bangok.json)
# 사용: python3 tools/osm_to_json.py map.osm data/bangok.json
# 좌표: 지도 중심 기준, 1 = 1.5m, x=동쪽, z=남쪽
import xml.etree.ElementTree as ET, math, json, re, sys, random

SRC = sys.argv[1] if len(sys.argv) > 1 else 'map.osm'
DST = sys.argv[2] if len(sys.argv) > 2 else 'data/bangok.json'
SCALE = 1.5

r = ET.parse(SRC).getroot()
b = r.find('bounds')
minlat, maxlat, minlon, maxlon = (float(b.get(k)) for k in ('minlat', 'maxlat', 'minlon', 'maxlon'))
lat0, lon0 = (minlat + maxlat) / 2, (minlon + maxlon) / 2
def P(lat, lon):
    return [round((lon - lon0) * 111320 * math.cos(math.radians(lat0)) / SCALE, 1), round(-(lat - lat0) * 110540 / SCALE, 1)]
X1, Z1 = P(minlat, maxlon)
X0, Z0 = P(maxlat, minlon)

nodes = {n.get('id'): (float(n.get('lat')), float(n.get('lon'))) for n in r.iter('node')}
ways = {w.get('id'): w for w in r.iter('way')}
def tags(e): return {t.get('k'): t.get('v') for t in e.iter('tag')}
def pts(w): return [P(*nodes[nd.get('ref')]) for nd in w.iter('nd') if nd.get('ref') in nodes]
def inside(p, m=60): return X0 - m <= p[0] <= X1 + m and Z0 - m <= p[1] <= Z1 + m

ROAD_W = {'secondary': 18, 'tertiary': 14, 'busway': 9, 'residential': 7, 'living_street': 5, 'service': 4,
          'pedestrian': 5, 'footway': 2.4, 'path': 2.2, 'steps': 2.2, 'cycleway': 2.6}
AREA_KIND = {('leisure', 'park'): 'park', ('leisure', 'garden'): 'park', ('leisure', 'pitch'): 'pitch', ('leisure', 'playground'): 'playground',
             ('landuse', 'residential'): 'residential', ('amenity', 'school'): 'school', ('amenity', 'parking'): 'parking',
             ('natural', 'water'): 'water', ('natural', 'wood'): 'wood', ('landuse', 'grass'): 'grass', ('landuse', 'construction'): 'construction',
             ('amenity', 'research_institute'): 'office', ('amenity', 'kindergarten'): 'school'}

out = {'bounds': [X0, X1, Z0, Z1], 'scale': SCALE, 'buildings': [], 'roads': [], 'areas': [], 'labels': [], 'stops': [], 'rivers': []}
rng = random.Random(7)

def short_name(n):
    n = re.sub(r'\(.*?\)', '', n).strip()
    n = re.sub(r'(\S)(\d+단지)', r'\1 \2', n)
    n = re.sub(r'(단지).*$', r'\1', n)
    return n

def centroid(p):
    return [round(sum(q[0] for q in p) / len(p), 1), round(sum(q[1] for q in p) / len(p), 1)]

for w in r.iter('way'):
    t = tags(w); p = pts(w)
    if len(p) < 2 or not any(inside(q) for q in p): continue
    if 'building' in t:
        bt = t['building']
        lv = t.get('building:levels')
        try: lv = int(lv)
        except (TypeError, ValueError): lv = None
        if lv is None:
            lv = {'apartments': rng.randint(15, 25), 'school': 4, 'office': 6, 'commercial': rng.randint(4, 7),
                  'kindergarten': 2, 'church': 3, 'detached': 2}.get(bt, 3)
        out['buildings'].append({'p': p[:-1] if p[0] == p[-1] else p, 'h': lv * 3 / SCALE, 'type': bt})
        continue
    hw = t.get('highway')
    if hw in ROAD_W:
        out['roads'].append({'p': p, 'w': ROAD_W[hw], 'kind': hw, 'name': t.get('name')})
        continue
    if t.get('waterway') == 'river':
        out['rivers'].append({'p': p, 'w': 14}); continue
    for (k, v), kind in AREA_KIND.items():
        if t.get(k) == v and p[0] == p[-1]:
            out['areas'].append({'p': p[:-1], 'kind': kind})
            nm = t.get('name')
            if nm:
                lk = {'residential': 'apt', 'school': 'school', 'park': 'park', 'office': 'office'}.get(kind)
                if lk and inside(centroid(p), 0): out['labels'].append({'text': short_name(nm).replace('나라키움', ''), 'kind': lk, 'x': centroid(p)[0], 'z': centroid(p)[1]})
            break

# 멀티폴리곤(수루배마을 3단지 등)
for rel in r.iter('relation'):
    t = tags(rel)
    if t.get('type') != 'multipolygon': continue
    outer = []
    for m in rel.iter('member'):
        if m.get('role') == 'outer' and m.get('ref') in ways: outer += pts(ways[m.get('ref')])
    if not outer: continue
    kind = 'residential' if t.get('landuse') == 'residential' else 'school' if t.get('amenity') in ('kindergarten', 'school') else None
    if kind:
        out['areas'].append({'p': outer, 'kind': kind})
        if t.get('name'): out['labels'].append({'text': short_name(t['name']), 'kind': 'apt' if kind == 'residential' else 'school', 'x': centroid(outer)[0], 'z': centroid(outer)[1]})

# 버스 정류장(이름은 공공 정류장명만 사용, 상호명 제외)
seen = set()
for n in r.iter('node'):
    t = tags(n)
    if t.get('highway') == 'bus_stop' and t.get('name'):
        p = P(float(n.get('lat')), float(n.get('lon')))
        if not inside(p, 0): continue
        out['stops'].append({'name': t['name'], 'x': p[0], 'z': p[1]})

# 시험 운행 경로: BRT 전용도로(busway)를 이어 붙인 한 줄
segs = [r['p'][:] for r in out['roads'] if r['kind'] == 'busway' and sum(inside(q, 0) for q in r['p']) >= len(r['p']) / 2]
def near(a, b): return abs(a[0] - b[0]) < 1 and abs(a[1] - b[1]) < 1
start = min((q for sg in segs for q in (sg[0], sg[-1])), key=lambda q: (q[0] + 420) ** 2 + (q[1] - 290) ** 2)
route = [start]
while True:
    nxt = None
    for i, sg in enumerate(segs):
        if near(sg[0], route[-1]): nxt = segs.pop(i); break
        if near(sg[-1], route[-1]): nxt = segs.pop(i)[::-1]; break
    if not nxt: break
    route += nxt[1:]
route = [q for q in route if X0 + 15 <= q[0] <= X1 - 15 and Z0 + 15 <= q[1] <= Z1 - 15]
out['route'] = route
print('route pts', len(route), route[0], route[-1])

json.dump(out, open(DST, 'w'), ensure_ascii=False, separators=(',', ':'))
print('buildings', len(out['buildings']), 'roads', len(out['roads']), 'areas', len(out['areas']), 'labels', len(out['labels']), 'stops', len(out['stops']), 'bounds', out['bounds'])
for l in out['labels']: print(l)
