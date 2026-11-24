#!/usr/bin/env python3
"""Contornos de las 24 provincias (Natural Earth, dominio público) en la misma proyección que datos/regiones.json.
Uso: python3 emisiones/herramientas/generar_provincias.py ne_10m_admin_1_states_provinces.geojson ne_50m_admin_0_countries.geojson emisiones/datos/provincias.json"""
import json, sys, math
from shapely.geometry import shape, box
src, src0, out = sys.argv[1], sys.argv[2], sys.argv[3]
TOL = 0.02
lat0 = -38.0; c = math.cos(math.radians(lat0)); K = 30
LON0, LATMAX, LON1, LATMIN = -84.0, -17.0, -42.0, -57.5
def P(lon, lat): return ((lon - LON0) * c * K, (LATMAX - lat) * K)
def path(g, minarea=0.002):
    g = g.simplify(TOL, preserve_topology=True)
    polys = [g] if g.geom_type == 'Polygon' else [x for x in g.geoms if x.geom_type == 'Polygon']
    s = []
    for p in polys:
        if p.area < minarea: continue
        for ring in [p.exterior] + list(p.interiors):
            pts = [P(*xy) for xy in ring.coords]
            s.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts[:-1]) + 'Z')
    return ''.join(s)
NOMBRES = {'AR-C': 'Ciudad de Buenos Aires', 'AR-B': 'Buenos Aires', 'AR-V': 'Tierra del Fuego', 'AR-G': 'Santiago del Estero'}
x0, y0 = P(-73.8, -21.6); x1, y1 = P(-53.4, -55.2)
res = {'viewBox': [0, 0, round((LON1 - LON0) * c * K, 1), round((LATMAX - LATMIN) * K, 1)],
       'vista': [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)],
       'proyeccion': {'lon0': LON0, 'latmax': LATMAX, 'c': round(c, 6), 'k': K}, 'provincias': [], 'vecinos': []}
for f in json.load(open(src))['features']:
    pr = f['properties']
    if pr.get('adm0_a3') != 'ARG': continue
    iso = pr['iso_3166_2']
    res['provincias'].append({'iso': iso, 'nombre': NOMBRES.get(iso, pr['name']), 'd': path(shape(f['geometry']), 0.00001 if iso == 'AR-C' else 0.002)})
marco = box(LON0, LATMIN, LON1, LATMAX)
for f in json.load(open(src0))['features']:
    pr = f['properties']
    if pr['ADM0_A3'] == 'ARG': continue
    g = shape(f['geometry']).intersection(marco)
    if g.is_empty: continue
    d = path(g)
    if d: res['vecinos'].append({'nombre': pr['NAME_ES'] or pr['NAME'], 'd': d})
res['provincias'].sort(key=lambda p: p['nombre'])
json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(res['provincias']), [p['nombre'] for p in res['provincias']])
