#!/usr/bin/env python3
"""Genera datos/ejemplo.json: datos ILUSTRATIVOS (no reales) con el mismo formato que la API
de CAMMESA. Solo se usan cuando la API no responde, y la página lo avisa con un cartel.
Los valores de GBA y Buenos Aires (resto) a las 00:00 son los que se vieron en la API el 24/11/2026;
el resto son aproximaciones razonables para probar la página."""
import json, math
DIA = "2026-11-24"
# MW a medianoche: hidraulico, termico, nuclear, renovable, demanda
BASE = {
 426: (0, 3470.7, 0, 21.9, 5672),
 425: (0, 131.6, 729.8, 1255.6, 1850),
 417: (700, 1250, 0, 50, 2150),
 418: (1650, 30, 0, 20, 1400),
 419: (-7.5, 1300, 0, 207.5, 1200),
 422: (250, 650, 0, 150, 1750),
 429: (550, 250, 0, 50, 980),
 420: (1700, 600, 0, 100, 760),
 111: (150, 100, 0, 650, 650),
}
SOLAR = {419: 900, 429: 500, 422: 200, 425: 100}   # MW extra de renovable al mediodía
NO_ASIGNADO, IMPORT = 740.0, 237.8
def curva(h):  # factor de demanda según la hora (forma típica de un día de noviembre)
    return 1 + 0.10 * math.sin((h - 10) / 24 * 2 * math.pi) - 0.08 * math.exp(-((h - 5.5) ** 2) / 6) + 0.06 * math.exp(-((h - 15) ** 2) / 8)
def sol(h): return max(0.0, math.sin((h - 6.5) / 13 * math.pi))
gen = {k: [] for k in list(BASE) + [1002]}
dem = {k: [] for k in list(BASE) + [1002]}
f0 = curva(0)
for paso in range(0, 12 * 11 + 1):          # 00:00 a 11:00 cada 5 minutos
    h = paso / 12
    fecha = f"{DIA}T{int(h):02d}:{paso % 12 * 5:02d}:00.000-0300"
    tot = dict(hidraulico=0, termico=0, nuclear=0, renovable=0); dtot = 0
    for rid, (hi, te, nu, re, de) in BASE.items():
        fd = curva(h) / f0
        r = re + SOLAR.get(rid, 0) * sol(h)
        t = max(te * fd - (SOLAR.get(rid, 0) * sol(h) if te > 500 else 0) * 0.5, 0) if rid != 419 else te * fd
        fila = dict(fecha=fecha, hidraulico=round(hi * (fd if hi > 0 else 1), 1), termico=round(t, 1),
                    nuclear=round(nu, 1), renovable=round(r, 1))
        fila["sumTotal"] = round(fila["hidraulico"] + fila["termico"] + fila["nuclear"] + fila["renovable"], 1)
        gen[rid].append(fila)
        for k in tot: tot[k] += fila[k]
        d = round(de * fd, 1); dtot += d
        dem[rid].append(dict(fecha=fecha, dem=d, temp=round(20 + 6 * sol(h), 1) if paso % 3 == 0 else None))
    # como en la API real: la demanda regional suma más que la generación regional
    # (falta la importación y ~740 MW no asignados, menos ~200 MW de diferencia en la demanda)
    esc = (sum(gen[r][-1]["sumTotal"] for r in BASE) + NO_ASIGNADO + IMPORT - 200) / dtot
    for r in BASE: dem[r][-1]["dem"] = round(dem[r][-1]["dem"] * esc, 1)
    dtot *= esc
    n = dict(fecha=fecha, hidraulico=round(tot["hidraulico"] + NO_ASIGNADO * 0.6, 1), termico=round(tot["termico"] + NO_ASIGNADO * 0.4, 1),
             nuclear=round(tot["nuclear"], 1), renovable=round(tot["renovable"], 1), importacion=IMPORT)
    n["sumTotal"] = round(sum(n[k] for k in ("hidraulico", "termico", "nuclear", "renovable", "importacion")), 1)
    gen[1002].append(n)
    dem[1002].append(dict(fecha=fecha, dem=round(dtot + 200, 1), temp=None))
# como en la API real, el último intervalo llega incompleto en las regiones
for rid in BASE:
    gen[rid].pop(); dem[rid].pop()
json.dump({"aviso": "Datos ilustrativos generados para pruebas. No son mediciones reales.", "gen": gen, "dem": dem},
          open("datos/ejemplo.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("ok", len(gen[1002]))
