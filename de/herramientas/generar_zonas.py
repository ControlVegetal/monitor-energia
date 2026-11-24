#!/usr/bin/env python3
"""Fasst die Bundesländer (Natural Earth, gemeinfrei) zu den 4 Regelzonen zusammen und speichert datos/zonas.json.
Die Grenzen sind ungefähr: Regelzonen folgen nicht genau den Landesgrenzen.
Aufruf: python3 herramientas/generar_zonas.py ne_10m_admin_1_states_provinces.geojson ne_50m_admin_0_countries.geojson datos/zonas.json"""
import json, sys, math
from shapely.geometry import shape, box
from shapely.ops import unary_union
src, src0, out = sys.argv[1], sys.argv[2], sys.argv[3]
land = {f['properties']['iso_3166_2']: shape(f['geometry']) for f in json.load(open(src))['features'] if f['properties'].get('adm0_a3') == 'DEU'}
Z = {
 '50HZ': ('50Hertz', ['DE-BE', 'DE-BB', 'DE-MV', 'DE-SN', 'DE-ST', 'DE-TH', 'DE-HH'], (12.9, 52.0)),
 'TEN': ('TenneT', ['DE-SH', 'DE-NI', 'DE-HB', 'DE-HE', 'DE-BY'], (11.0, 49.2)),
 'AMP': ('Amprion', ['DE-NW', 'DE-RP', 'DE-SL'], (7.3, 50.9)),
 'TBW': ('TransnetBW', ['DE-BW'], (9.0, 48.45)),
}
# Nachbarländer mit Grenzkuppelstellen: Knoten (lon, lat) für die Pfeile
N = {'DK': ('Dänemark', (9.6, 55.7)), 'NL': ('Niederlande', (5.6, 52.2)), 'BE': ('Belgien', (4.8, 50.6)),
     'LU': ('Luxemburg', (6.1, 49.75)), 'FR': ('Frankreich', (6.0, 48.4)), 'CH': ('Schweiz', (8.1, 47.0)),
     'AT': ('Österreich', (13.6, 47.6)), 'CZ': ('Tschechien', (14.6, 49.9)), 'PL': ('Polen', (16.3, 52.3)),
     'SE': ('Schweden', (13.9, 55.5)), 'NO': ('Norwegen', (7.8, 57.3))}
TOL = 0.01
LAT0 = 51.0; c = math.cos(math.radians(LAT0)); K = 60
LON0, LATMAX, LON1, LATMIN = 1.0, 58.5, 20.0, 45.0
def P(lon, lat): return ((lon - LON0) * c * K, (LATMAX - lat) * K)
def path(g):
    g = g.simplify(TOL, preserve_topology=True)
    polys = [g] if g.geom_type == 'Polygon' else [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']
    s = []
    for p in polys:
        if p.area < 0.0015: continue
        for ring in [p.exterior] + list(p.interiors):
            pts = [P(*xy) for xy in ring.coords]
            s.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts[:-1]) + 'Z')
    return ''.join(s)
x0, y0 = P(3.2, 56.6); x1, y1 = P(17.6, 46.4)
res = {'viewBox': [0, 0, round((LON1 - LON0) * c * K, 1), round((LATMAX - LATMIN) * K, 1)],
       'vista': [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)], 'zonas': [], 'vecinos': [], 'paises': []}
marco = box(LON0, LATMIN, LON1, LATMAX)
for f in json.load(open(src0))['features']:
    pr = f['properties']
    if pr['ADM0_A3'] == 'DEU': continue
    g = shape(f['geometry']).intersection(marco)
    if g.is_empty: continue
    d = path(g)
    if d: res['vecinos'].append({'d': d})
for cod, (nom, ls, nodo) in Z.items():
    x, y = P(*nodo)
    res['zonas'].append({'codigo': cod, 'nombre': nom, 'd': path(unary_union([land[l] for l in ls])), 'x': round(x, 1), 'y': round(y, 1)})
for cod, (nom, nodo) in N.items():
    x, y = P(*nodo)
    res['paises'].append({'codigo': cod, 'nombre': nom, 'x': round(x, 1), 'y': round(y, 1)})
json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(res['viewBox'], res['vista'], sum(len(r['d']) for r in res['zonas']), sum(len(v['d']) for v in res['vecinos']))
