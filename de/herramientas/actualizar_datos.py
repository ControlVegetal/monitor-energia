#!/usr/bin/env python3
"""Lädt die offenen Daten für die Deutschland-Karte und speichert sie in einer JSON-Datei.
Quellen:
- SMARD.de (Bundesnetzagentur, CC BY 4.0): Erzeugung nach Energieträger und Netzlast je Regelzone.
- Energy-Charts (Fraunhofer ISE, CC BY 4.0): Stromerzeugung Deutschland (aktuell), physikalische
  Flüsse mit den Nachbarländern und Day-Ahead-Preis (dieser stammt von SMARD).
Aufruf: python3 actualizar_datos.py salida.json [anterior.json]
Fällt eine Quelle aus, bleibt ihr letzter Stand aus der vorherigen Datei erhalten (mit dessen Zeitstempel)."""
import json, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

UA = {"User-Agent": "monitor-energia (github.com/ControlVegetal/monitor-energia)"}
def get(url, intentos=3):
    for i in range(intentos):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as e:
            err = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{url}: {err}")

ahora = datetime.now(timezone.utc)
iso = lambda: ahora.strftime("%Y-%m-%dT%H:%M:%SZ")
r0 = lambda v: None if v is None else round(v)

# ---------- SMARD: Regelzonen ----------
ZONAS = {"50HZ": "50Hertz", "AMP": "Amprion", "TEN": "TenneT", "TBW": "TransnetBW"}
FILTROS = {  # SMARD-Filter-ID -> Schlüssel
    1223: "braunkohle", 4069: "steinkohle", 4071: "erdgas", 1227: "sonst_konv", 1224: "kernenergie",
    4066: "biomasse", 1226: "wasser", 4067: "wind_on", 1225: "wind_off", 4068: "solar",
    1228: "sonst_ee", 4070: "pumpspeicher", 410: "last", 4387: "pump_verbrauch",
}
def smard():
    ix = get("https://www.smard.de/app/chart_data/410/DE/index_quarterhour.json")["timestamps"][-2:]
    tareas = [(z, f, ts) for z in ZONAS.values() for f in FILTROS for ts in ix]
    def bajar(t):
        z, f, ts = t
        try: return t, get(f"https://www.smard.de/app/chart_data/{f}/{z}/{f}_{z}_quarterhour_{ts}.json", 2)["series"]
        except Exception: return t, None  # z. B. kein Offshore-Wind in TransnetBW
    with ThreadPoolExecutor(6) as ex: res = dict(ex.map(bajar, tareas))
    serie = {}
    for (z, f, ts), s in res.items():
        for ms, v in s or []:
            if v is not None: serie.setdefault(z, {}).setdefault(FILTROS[f], {})[ms] = v
    # Zeitpunkte, an denen alle 4 Zonen Last und Solar/Erdgas haben (vollständig veröffentlicht)
    comunes = None
    for z in ZONAS.values():
        k = set(serie.get(z, {}).get("last", {})) & set(serie.get(z, {}).get("erdgas", {}))
        comunes = k if comunes is None else comunes & k
    tiempos = sorted(comunes or [])[-4 * 48:]  # letzte 48 Stunden
    if not tiempos: raise RuntimeError("SMARD: keine vollständigen Zeitpunkte")
    out = {"zeiten": tiempos, "zonen": {}}
    for cod, z in ZONAS.items():
        # SMARD liefert je Viertelstunde Energie (MWh); x4 = mittlere Leistung in MW
        out["zonen"][cod] = {k: [r0(4 * serie[z].get(k, {}).get(t, 0)) for t in tiempos] for k in FILTROS.values()}
    return out

# ---------- Energy-Charts ----------
TIPOS_EC = {  # Energy-Charts-Name -> gleiche Gruppen wie SMARD
    "Fossil brown coal / lignite": "braunkohle", "Fossil hard coal": "steinkohle", "Fossil coal-derived gas": "steinkohle",
    "Fossil gas": "erdgas", "Fossil oil": "sonst_konv", "Waste": "sonst_konv", "Others": "sonst_konv", "Nuclear": "kernenergie",
    "Biomass": "biomasse", "Hydro Run-of-River": "wasser", "Hydro water reservoir": "wasser", "Wind onshore": "wind_on",
    "Wind offshore": "wind_off", "Solar": "solar", "Geothermal": "sonst_ee", "Hydro pumped storage": "pumpspeicher",
    "Hydro pumped storage consumption": "pump_verbrauch", "Load": "last", "Cross border electricity trading": "handel",
}
def dia(dd): return datetime.fromtimestamp(ahora.timestamp() + dd * 86400, timezone.utc).strftime("%Y-%m-%d")
def nacional():
    d = get(f"https://api.energy-charts.info/public_power?country=de&start={dia(-2)}&end={dia(1)}")
    t = d["unix_seconds"]
    out = {"zeiten": [x * 1000 for x in t]}
    for p in d["production_types"]:
        k = TIPOS_EC.get(p["name"])
        if not k: continue
        vals = [(v if v is not None else None) for v in p["data"]]
        if k in out:
            out[k] = [None if a is None and b is None else (a or 0) + (b or 0) for a, b in zip(out[k], vals)]
        else:
            out[k] = vals
    # nur Zeitpunkte mit Last und Erdgas (vollständig)
    ok = [i for i in range(len(t)) if out.get("last", [None] * len(t))[i] is not None and out.get("erdgas", [None] * len(t))[i] is not None]
    ok = ok[-4 * 30:]
    res = {"zeiten": [out["zeiten"][i] for i in ok]}
    for k in set(TIPOS_EC.values()):
        if k in out: res[k] = [r0(out[k][i]) for i in ok]
    if not ok: raise RuntimeError("Energy-Charts: keine Stromerzeugung")
    return res

PAISES = {"Austria": "AT", "Belgium": "BE", "Czech Republic": "CZ", "Denmark": "DK", "France": "FR", "Luxembourg": "LU",
          "Netherlands": "NL", "Norway": "NO", "Poland": "PL", "Sweden": "SE", "Switzerland": "CH"}
def frontera():
    d = get(f"https://api.energy-charts.info/cbpf?country=de&start={dia(-4)}&end={dia(1)}")
    t = [x * 1000 for x in d["unix_seconds"]]
    out = {"zeiten": t, "laender": {}}
    for c in d["countries"]:
        cod = PAISES.get(c["name"])
        if cod: out["laender"][cod] = [None if v is None else round(v * 1000) for v in c["data"]]  # GW -> MW
    return out

def precio():
    d = get(f"https://api.energy-charts.info/price?bzn=DE-LU&start={dia(-1)}&end={dia(2)}")
    par = [(t * 1000, p) for t, p in zip(d["unix_seconds"], d["price"]) if p is not None]
    return {"zeiten": [a for a, _ in par], "werte": [round(b, 2) for _, b in par], "einheit": d.get("unit", "EUR / MWh")}

if __name__ == "__main__":
    salida = sys.argv[1]
    previo = {}
    if len(sys.argv) > 2:
        try: previo = json.load(open(sys.argv[2]))
        except Exception: pass
    datos = {"erzeugt": iso(), "fehler": {}}
    for clave, fn in [("regelzonen", smard), ("deutschland", nacional), ("grenzen", frontera), ("preis", precio)]:
        try:
            datos[clave] = fn(); datos[clave]["abgerufen"] = iso()
        except Exception as e:
            datos["fehler"][clave] = str(e)[:300]
            if clave in previo: datos[clave] = previo[clave]
        print(clave, "OK" if clave not in datos["fehler"] else "FEHLER " + datos["fehler"][clave])
    if not any(k in datos for k in ("regelzonen", "deutschland")):
        sys.exit("keine Daten")
    json.dump(datos, open(salida, "w"), separators=(",", ":"))
