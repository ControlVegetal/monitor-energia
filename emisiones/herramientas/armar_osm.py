#!/usr/bin/env python3
"""Arma emisiones/datos/fabricas_osm.json: fábricas y plantas industriales de Argentina con nombre en OpenStreetMap
(© colaboradores de OpenStreetMap, licencia ODbL). No traen emisiones: se muestran como "sin dato".
Uso: python3 armar_osm.py ne_10m_admin_1_states_provinces.geojson instalaciones.json salida.json"""
import json, sys, time, re, math, unicodedata, urllib.request, urllib.parse, collections
from datetime import datetime, timezone
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

nepath, ctpath, out = sys.argv[1:4]
Q = """[out:json][timeout:600];
area["ISO3166-1"="AR"][admin_level=2]->.a;
(
  nwr["man_made"="works"]["name"](area.a);
  nwr["industrial"]["name"](area.a);
  nwr["landuse"="industrial"]["name"](area.a);
);
out center tags;"""
SERV = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
UA = {"User-Agent": "monitor-energia (github.com/ControlVegetal/monitor-energia)"}
datos = None
for i in range(6):
    url = SERV[i % len(SERV)]
    try:
        req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": Q}).encode(), headers=UA)
        with urllib.request.urlopen(req, timeout=900) as r: datos = json.load(r)
        if datos.get("elements"): break
    except Exception as e:
        print("Overpass falló:", url, e); time.sleep(20)
if not datos or not datos.get("elements"): sys.exit("Sin datos de Overpass")
print("elementos:", len(datos["elements"]), "osm_base:", datos.get("osm3s", {}).get("timestamp_osm_base"))

def plano(s): return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
# (clave, regex sobre nombre+etiquetas en minúsculas sin acentos). El orden importa: gana la primera.
REGLAS = [
    ("azucar", r"\bingenio\b|azucar|\bsugar\b"),
    ("automotriz", r"\bscania\b|toyota|\bford\b|volkswagen|\bfiat\b|stellantis|peugeot|citroen|renault|mercedes.?benz|\biveco\b|general motors|nissan|\bhonda\b|\bdeutz\b|john deere|\bagco\b|\bcnh\b|new holland|case ih|pauny|agrale|zanello|tractor|automotri|autopart|car_manufactur|\bvehicle|cosechadora|sembradora|maquinaria agricola|metalfor|\bakron\b|\bpla\b|\bapache\b|crucianelli|agrometal|gherardi|giorgi|\bombu\b"),
    ("metal", r"metal|siderur|acer[ai]|\bsteel\b|fundicion|foundry|forja|herramient|machinery|maquinaria|mecanica|tornería|torneria|matricer|caldereria|galvaniz|alumini|\bweld|soldad|trefil|electromecan"),
    ("alimentos", r"frigorifico|slaughter|matadero|aceitera|\boil mill|molino|harinera|\bflour|lactea|lacteos|\bdairy|usina lactea|queser|cervec|brewery|bodega|winery|alimento|\bfood|\bbakery|panific|galletit|golosina|chocolat|yerba|\bte\b|arrocer|citric|jugos|conserv|vitivin|avicola|faena|pesquer|fish|bebida|beverage|gaseosa|embotell|malter|olivic|\bfeed\b|balanceado"),
    ("textil", r"textil|alpargatas|hilander|hilado|tejedur|curtiembre|tannery|calzado|\bshoe|indumentaria|clothing|algodon|desmotadora|lana\b|lavadero de lana"),
    ("quimica", r"quimic|chemical|plastic|petroquim|fertiliz|pintur|\bpaint|farmac|pharma|laborator|caucho|rubber|neumatic|\btire|\btyre|deterg|cosmet|gases industriales|oxigeno|refiner|biodiesel|bioetanol|etanol|destiler"),
    ("papel", r"papel|paper|celulosa|\bpulp|carton|aserradero|sawmill|madera|wood|mueble|furniture|laminad|imprent|printing|grafica"),
    ("minerales", r"ceramic|vidrio|\bglass|ladrill|\bbrick|cement|hormigon|concrete|\bcal\b|calera|\blime\b|yeso|marmol|granit|cantera|quarry|arido|asfalt|asphalt"),
]
COMP = [(k, re.compile(rx)) for k, rx in REGLAS]
PARQUE = re.compile(r"^(parque|area|zona|sector|polo|distrito|predio|complejo|barrio|lote|loteo|ciudad)\b.*\b(industrial|industria|logistic|empresari|tecnologic|productiv)", re.I)
EXCL_IND = {"warehouse", "depot", "logistics", "storage", "port", "yes", "scrap_yard", "oil", "gas", "mine", "distributor", "fuel"}

def sector(t):
    texto = plano(" ".join([t.get("name", ""), t.get("industrial", ""), t.get("product", ""), t.get("operator", ""), t.get("brand", ""), t.get("description", "")]))
    for k, rx in COMP:
        if rx.search(texto): return k
    return "otra"

prov = []
for f in json.load(open(nepath))["features"]:
    p = f["properties"]
    if p.get("adm0_a3") == "ARG": prov.append((p["iso_3166_2"], shape(f["geometry"])))
arbol = STRtree([g for _, g in prov])
def provincia(lon, lat):
    pt = Point(lon, lat)
    for i in arbol.query(pt, predicate="intersects"): return prov[i][0]
    i = arbol.nearest(pt)
    return prov[i][0] if prov[i][1].distance(pt) < 0.3 else None

ct = json.load(open(ctpath))["instalaciones"]
def cerca_ct(lat, lon):  # misma planta que ya figura en Climate TRACE (a menos de ~400 m)
    for x in ct:
        if abs(x["lat"] - lat) < 0.004 and abs(x["lon"] - lon) < 0.005 and x["g"] in ("industria", "energia", "mineria"): return True
    return False

res, vistos, omit = [], {}, collections.Counter()
for e in datos["elements"]:
    t = e.get("tags", {})
    nombre = (t.get("name") or "").strip()
    c = e.get("center") or ({"lat": e.get("lat"), "lon": e.get("lon")} if "lat" in e else None)
    if not nombre or not c: continue
    if t.get("landuse") == "industrial" and not t.get("man_made") and not t.get("industrial") and PARQUE.search(plano(nombre)): omit["parque"] += 1; continue
    if t.get("industrial") in EXCL_IND and not t.get("man_made"): omit["deposito"] += 1; continue
    if t.get("disused") or t.get("abandoned") or "disused:man_made" in t: omit["abandonada"] += 1; continue
    lat, lon = round(c["lat"], 5), round(c["lon"], 5)
    pv = provincia(lon, lat)
    if not pv: omit["fuera"] += 1; continue
    if cerca_ct(lat, lon): omit["ya_en_climate_trace"] += 1; continue
    clave = (plano(nombre), round(lat, 2), round(lon, 2))  # mismo nombre en la misma zona: un solo punto
    if clave in vistos: omit["duplicada"] += 1; continue
    vistos[clave] = 1
    x = {"id": f"{e['type'][0]}{e['id']}", "n": nombre, "k": sector(t), "p": pv, "lat": lat, "lon": lon}
    extra = t.get("operator") or t.get("brand")
    if extra and plano(extra) not in plano(nombre): x["o"] = extra
    if t.get("product"): x["pr"] = t["product"]
    res.append(x)
res.sort(key=lambda x: (x["p"], plano(x["n"])))
salida = {"fuente": "OpenStreetMap", "licencia": "ODbL", "osm_base": datos.get("osm3s", {}).get("timestamp_osm_base"),
          "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "fabricas": res}
json.dump(salida, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
print("fábricas:", len(res), "omitidas:", dict(omit))
print(collections.Counter(x["k"] for x in res))
print(collections.Counter(x["p"] for x in res).most_common())
for q in ["scania", "alpargatas", "ingenio", "renault", "fiat", "volkswagen", "deere", "agco", "toyota"]:
    m = [x["n"] + " (" + x["p"] + ")" for x in res if q in plano(x["n"] + " " + x.get("o", ""))]
    print(q, len(m), m[:8])
