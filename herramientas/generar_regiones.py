#!/usr/bin/env python3
"""Agrupa provincias (Natural Earth, dominio público) en las 9 regiones de CAMMESA y guarda datos/regiones.json.
Uso: python3 herramientas/generar_regiones.py ne_10m_admin_1_states_provinces.geojson datos/regiones.json
Fuente: https://github.com/nvkelso/natural-earth-vector (geojson/ne_10m_admin_1_states_provinces.geojson)"""
import json, sys, math
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
prov = {f['properties']['iso_3166_2']: shape(f['geometry']) for f in d['features'] if f['properties'].get('adm0_a3') == 'ARG'}
R = {
 426: ('GBA', 'Gran Buenos Aires'),
 425: ('BAS', 'Buenos Aires (resto)'),
 417: ('LIT', 'Litoral'), 418: ('NEA', 'NEA'), 419: ('NOA', 'NOA'),
 422: ('CEN', 'Centro'), 429: ('CUY', 'Cuyo'), 420: ('COM', 'Comahue'), 111: ('PAT', 'Patagonia'),
}
grp = {417: ['AR-S','AR-E'], 418: ['AR-N','AR-W','AR-H','AR-P'], 419: ['AR-Y','AR-A','AR-T','AR-K','AR-G','AR-F'],
       422: ['AR-X','AR-D'], 429: ['AR-J','AR-M'], 420: ['AR-Q','AR-R','AR-L'], 111: ['AR-U','AR-Z']}
geom = {k: unary_union([prov[p] for p in v]) for k, v in grp.items()}
bsas = unary_union([prov['AR-B'], prov['AR-C']])
amba = Point(-58.55, -34.65).buffer(0.42)
gba = unary_union([prov['AR-C'], bsas.intersection(amba)])
geom[426] = gba
geom[425] = prov['AR-B'].difference(gba)
TOL = 0.025
lat0 = -38.0; c = math.cos(math.radians(lat0)); K = 30
LON0, LATMAX = -74.0, -21.5
def P(lon, lat): return ((lon - LON0) * c * K, (LATMAX - lat) * K)
def path(g):
    g = g.simplify(TOL, preserve_topology=True)
    polys = [g] if g.geom_type == 'Polygon' else list(g.geoms)
    s = []
    for p in polys:
        if p.area < 0.002: continue
        for ring in [p.exterior] + list(p.interiors):
            pts = [P(*xy) for xy in ring.coords]
            s.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts[:-1]) + 'Z')
    return ''.join(s)
nodos = {426: (-58.45, -34.62), 425: (-60.8, -36.9), 417: (-60.6, -31.0), 418: (-58.9, -27.0), 419: (-65.4, -26.0),
         422: (-64.3, -32.4), 429: (-68.6, -33.3), 420: (-67.6, -38.8), 111: (-69.0, -46.5)}
res = {'viewBox': [0, 0, round((-53.3 - LON0) * c * K, 1), round((LATMAX + 55.2) * K, 1)], 'regiones': [], 'sinRed': []}
for rid, (cod, nom) in R.items():
    x, y = P(*nodos[rid])
    res['regiones'].append({'id': rid, 'codigo': cod, 'nombre': nom, 'd': path(geom[rid]), 'x': round(x, 1), 'y': round(y, 1)})
res['sinRed'].append({'nombre': 'Tierra del Fuego (sin conexión al SADI)', 'd': path(prov['AR-V'])})
json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(res['viewBox'], sum(len(r['d']) for r in res['regiones']))
