#!/usr/bin/env python3
"""Arma emisiones/datos/instalaciones.json con las instalaciones de Argentina que emiten gases de efecto invernadero,
según Climate TRACE (https://climatetrace.org, CC BY 4.0).
- Emisiones por año y coordenadas: paquete descargable de Argentina (co2e_100yr, CSV mensuales por instalación).
- Propietarios: API v6 (https://api.climatetrace.org/v6/assets), unidos por id.
- Provincia: punto dentro del contorno de Natural Earth (dominio público).
Uso: python3 armar_instalaciones.py ARG.zip ne_10m_admin_1_states_provinces.geojson salida.json"""
import csv, io, json, sys, time, zipfile, urllib.request, collections
from datetime import datetime, timezone
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

zpath, nepath, out = sys.argv[1:4]
# Subsectores con instalaciones puntuales (se dejan afuera transporte, edificios y uso del suelo, que son áreas).
GRUPOS = {
    'electricity-generation': 'energia',
    'oil-and-gas-production': 'petroleo', 'oil-and-gas-refining': 'petroleo', 'oil-and-gas-transport': 'petroleo', 'coal-mining': 'petroleo',
    'cement': 'industria', 'iron-and-steel': 'industria', 'aluminum': 'industria', 'chemicals': 'industria',
    'petrochemical-steam-cracking': 'industria', 'pulp-and-paper': 'industria', 'textiles-leather-apparel': 'industria',
    'food-beverage-tobacco': 'industria', 'glass': 'industria', 'lime': 'industria', 'other-manufacturing': 'industria',
    'copper-mining': 'mineria', 'iron-mining': 'mineria', 'bauxite-mining': 'mineria', 'rock-quarrying': 'mineria', 'sand-quarrying': 'mineria', 'other-mining-quarrying': 'mineria',
    'solid-waste-disposal': 'residuos', 'industrial-wastewater-treatment-and-discharge': 'residuos',
    'enteric-fermentation-cattle-operation': 'feedlot', 'manure-management-cattle-operation': 'feedlot',
}
MIN_FEEDLOT = 1000  # t CO2e/año: los feedlots más chicos se suman a los totales pero no se dibujan

z = zipfile.ZipFile(zpath)
version = None
datos = {}  # (id) -> dict
for nombre in z.namelist():
    if '_emissions_sources_v' not in nombre or '_confidence' in nombre or not nombre.endswith('.csv'): continue
    sub = nombre.rsplit('/', 1)[1].split('_emissions_sources_v')[0]
    if sub not in GRUPOS: continue
    version = nombre.rsplit('_v', 1)[1][:-4]
    with z.open(nombre) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding='utf-8')):
            if r['gas'] != 'co2e_100yr' or r['iso3_country'] != 'ARG': continue
            try: q = float(r['emissions_quantity'] or 0)
            except ValueError: continue
            anio = int(r['start_time'][:4]); mes = int(r['start_time'][5:7])
            clave = r['source_id']
            d = datos.get(clave)
            if d is None:
                try: lat, lon = float(r['lat']), float(r['lon'])
                except ValueError: continue
                d = datos[clave] = {'id': clave, 'nombre': r['source_name'], 'sub': set(), 'tipo': r['source_type'],
                                    'lat': lat, 'lon': lon, 'anios': collections.defaultdict(float), 'meses': collections.defaultdict(set),
                                    'cap': None}
            d['sub'].add(sub)
            d['anios'][anio] += q
            d['meses'][anio].add(mes)
            if r.get('capacity') and r.get('capacity_units') and d['cap'] is None:
                try: d['cap'] = [round(float(r['capacity']), 1), r['capacity_units']]
                except ValueError: pass
print('instalaciones leídas:', len(datos), 'versión', version)

# Último año con 12 meses en la mayoría de las instalaciones
cuenta = collections.Counter(a for d in datos.values() for a, m in d['meses'].items() if len(m) == 12)
ANIO = max(a for a, n in cuenta.items() if n >= 0.5 * max(cuenta.values()))
print('año elegido:', ANIO, dict(sorted(cuenta.items())))

# Propietarios desde la API
UA = {'User-Agent': 'monitor-energia (github.com/ControlVegetal/monitor-energia)'}
def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r: return json.load(r)
        except Exception as e:
            err = e; time.sleep(3 * (i + 1))
    print('AVISO API:', url, err); return None
duenos = {}
for sub in GRUPOS:
    off = 0
    while True:
        j = get(f'https://api.climatetrace.org/v6/assets?countries=ARG&subsectors={sub}&limit=1000&offset={off}')
        a = (j or {}).get('assets') or []
        for x in a:
            ow = [o.get('CompanyName') for o in (x.get('Owners') or []) if o.get('CompanyName')]
            if ow: duenos[str(x['Id'])] = ow
        if len(a) < 1000: break
        off += 1000
print('con propietario:', len(duenos))

# Provincias
prov = []
for f in json.load(open(nepath))['features']:
    p = f['properties']
    if p.get('adm0_a3') == 'ARG': prov.append((p['iso_3166_2'], shape(f['geometry'])))
arbol = STRtree([g for _, g in prov])
def provincia(lon, lat):
    pt = Point(lon, lat)
    for i in arbol.query(pt, predicate='intersects'): return prov[i][0]
    i = arbol.nearest(pt)
    return prov[i][0] if prov[i][1].distance(pt) < 0.6 else 'MAR'

inst, totales = [], collections.defaultdict(lambda: collections.defaultdict(float))
for d in datos.values():
    e = d['anios'].get(ANIO, 0.0)
    subs = sorted(d['sub']); g = GRUPOS[subs[0]]
    pv = provincia(d['lon'], d['lat'])
    totales[pv][g] += e
    if e <= 0: continue
    if g == 'feedlot' and e < MIN_FEEDLOT: continue
    serie = [round(d['anios'].get(a, 0)) if len(d['meses'].get(a, ())) == 12 else None for a in range(ANIO - 4, ANIO + 1)]
    x = {'id': d['id'], 'n': d['nombre'], 'g': g, 's': subs, 'p': pv, 'lat': round(d['lat'], 4), 'lon': round(d['lon'], 4), 'e': round(e), 'serie': serie}
    if d['tipo']: x['t'] = d['tipo']
    if d['cap']: x['cap'] = d['cap']
    if d['id'] in duenos: x['o'] = duenos[d['id']]
    inst.append(x)
inst.sort(key=lambda x: -x['e'])
res = {'fuente': 'Climate TRACE', 'licencia': 'CC BY 4.0', 'version': version, 'anio': ANIO, 'gas': 'co2e_100yr',
       'generado': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'aniosSerie': list(range(ANIO - 4, ANIO + 1)),
       'minFeedlot': MIN_FEEDLOT,
       'totales': {p: {g: round(v) for g, v in t.items()} for p, t in totales.items()}, 'instalaciones': inst}
json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print('dibujadas:', len(inst), 'total Mt:', round(sum(sum(t.values()) for t in totales.values()) / 1e6, 1))
print(collections.Counter(x['g'] for x in inst))
