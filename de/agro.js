// Für die Landwirtschaft: Wetter je Regelzone (Open-Meteo) + beste Stunden für Bewässerung, Trocknung und Kühlung
// (nach Day-Ahead-Preis), Netzlage und CO₂ je Stunde. Nutzt die Daten, die app.js schon geladen hat.
"use strict";

const AGRO = {
  // Ein repräsentativer Ort je Regelzone für die Vorhersage (Annahme)
  puntos: {
    "50HZ": [52.13, 11.62, "Magdeburg"], TEN: [52.37, 9.73, "Hannover"],
    AMP: [50.94, 6.96, "Köln"], TBW: [48.78, 9.18, "Stuttgart"],
  },
  clima: null, error: "", reg: "TEN", ultSel: undefined, reintento: null,
};
const AGRO_HITZE = 32, AGRO_FROST = -10, AGRO_STURM = 75, AGRO_HOCH = 0.95; // Annahmen

async function cargarClima() {
  clearTimeout(AGRO.reintento);
  const cods = Object.keys(AGRO.puntos);
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + cods.map((c) => AGRO.puntos[c][0]).join(",") +
    "&longitude=" + cods.map((c) => AGRO.puntos[c][1]).join(",") +
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m" +
    "&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,et0_fao_evapotranspiration" +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,wind_gusts_10m_max" +
    "&timezone=" + encodeURIComponent(TZ) + "&forecast_days=3";
  try {
    let r;
    try { r = await fetch(url); } catch { throw new Error("keine Antwort vom Wetterdienst"); }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) throw new Error(j?.reason || "der Wetterdienst antwortete mit HTTP " + r.status);
    const lista = Array.isArray(j) ? j : [j];
    if (lista.length !== cods.length || !lista.every((x) => x.hourly?.time?.length)) throw new Error("unvollständige Antwort des Wetterdienstes");
    AGRO.clima = Object.fromEntries(cods.map((c, i) => [c, lista[i]]));
    AGRO.error = "";
    AGRO.reintento = setTimeout(cargarClima, 60 * 60e3);
  } catch (e) {
    AGRO.error = String(e.message || e);
    console.error("Wetter:", e);
    AGRO.reintento = setTimeout(cargarClima, 10 * 60e3);
  }
  if (estado.calc) dibujarAgro();
}

const horaLocal = (ms) => `${diaClave(ms)}T${String(horaNum(ms)).padStart(2, "0")}`; // "2026-11-24T14"
const norm = (v, a, b) => (b - a > 1e-9 ? (v - a) / (b - a) : 0.5);

// Day-Ahead-Preis je Stunde (Mittel der Viertelstunden), nach Ortszeit-Stunde
function preisJeStunde() {
  const p = estado.d.preis, m = new Map();
  (p?.zeiten || []).forEach((t, i) => {
    if (p.werte[i] == null) return;
    const k = horaLocal(t), o = m.get(k) || { s: 0, n: 0, t: t - (t % 3600e3) };
    o.s += p.werte[i]; o.n++; m.set(k, o);
  });
  return m;
}

// Nächste 24 Stunden: Preis + Wettervorhersage der Zone
function proximasHoras(cod) {
  const precios = preisJeStunde(), c = AGRO.clima?.[cod]?.hourly, ahora = Date.now(), h0 = ahora - (ahora % 3600e3);
  const horas = [];
  for (let k = 0; k < 24; k++) {
    const t = h0 + k * 3600e3, key = horaLocal(t), x = { t, key }, p = precios.get(key);
    if (p) x.precio = p.s / p.n;
    const i = c ? c.time.findIndex((s) => s.slice(0, 13) === key) : -1;
    if (i >= 0) Object.assign(x, { temp: c.temperature_2m[i], hum: c.relative_humidity_2m[i], lluvia: c.precipitation[i], viento: c.wind_speed_10m[i], et0: c.et0_fao_evapotranspiration[i] });
    horas.push(x);
  }
  const ps = horas.filter((x) => x.precio != null).map((x) => x.precio);
  for (const x of horas) if (x.precio != null) x.energia = 1 - norm(x.precio, Math.min(...ps), Math.max(...ps));
  return horas;
}

function mejorBloque(horas, puntaje, largo = 3) {
  let mejor = null;
  for (let i = 0; i + largo <= horas.length; i++) {
    const tramo = horas.slice(i, i + largo), ps = tramo.map(puntaje);
    if (ps.some((p) => p == null)) continue;
    const s = ps.reduce((a, b) => a + b, 0) / largo;
    if (!mejor || s > mejor.s) mejor = { s, tramo };
  }
  return mejor;
}

function empfehlungen(cod) {
  const H = proximasHoras(cod);
  const rango = (k) => { const v = H.map((x) => x[k]).filter((v) => v != null); return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0]; };
  const [vMin, vMax] = rango("viento"), [eMin, eMax] = rango("et0"), [hMin, hMax] = rango("hum"), [tMin, tMax] = rango("temp");
  const mezclar = (x, clima, pe) => (x.energia == null ? null : clima == null ? x.energia : pe * x.energia + (1 - pe) * clima);
  const tareas = [
    { n: "Bewässerung und Pumpen", por: "günstiger Strom, wenig Wind und wenig Verdunstung",
      p: (x) => mezclar(x, x.viento == null ? null : ((1 - norm(x.viento, vMin, vMax)) + (1 - norm(x.et0, eMin, eMax))) / 2, 0.6) },
    { n: "Getreidetrocknung", por: "günstiger Strom und trockenere Luft",
      p: (x) => mezclar(x, x.hum == null ? null : (1 - norm(x.hum, hMin, hMax)) * (x.lluvia > 0.2 ? 0.3 : 1), 0.6) },
    { n: "Kühlung (Kühlhaus, Milch)", por: "günstiger Strom und kühlere Stunden: vor der Wärme vorkühlen",
      p: (x) => mezclar(x, x.temp == null ? null : 1 - norm(x.temp, tMin, tMax), 0.7) },
  ];
  return { H, filas: tareas.map((t) => ({ ...t, b: mejorBloque(H, t.p) })) };
}

function bloqueTxt(b) {
  if (!b) return "keine Daten";
  const a = b.tramo[0], z = b.tramo[b.tramo.length - 1];
  const precio = b.tramo.reduce((s, x) => s + x.precio, 0) / b.tramo.length;
  return `${horaNum(a.t)}–${horaNum(z.t + 3600e3)} Uhr <small>(${nombreDia(a.t)}, ${fmt1(precio / 10)} ct/kWh)</small>`;
}

function dibujarAgroClima(cod) {
  const p = AGRO.puntos[cod], c = AGRO.clima?.[cod];
  if (!c) {
    $("#agroClima").innerHTML = `<p class="pista">${AGRO.error ? `Die Wettervorhersage konnte nicht geladen werden (${esc(AGRO.error)}). Neuer Versuch in 10 Minuten.` : "Wettervorhersage wird geladen…"}</p>`;
    return;
  }
  const d = c.daily, ahora = horaLocal(Date.now());
  const i0 = Math.max(c.hourly.time.findIndex((t) => t.slice(0, 13) >= ahora), 0);
  const regen48 = c.hourly.precipitation.slice(i0, i0 + 48).reduce((s, v) => s + (v || 0), 0);
  const cur = c.current || {};
  $("#agroClima").innerHTML = `
    <div class="kpis kpis3">
      <div><span class="kpi-v">${fmt1(cur.temperature_2m)} °C</span><span class="kpi-l">jetzt in ${esc(p[2])}</span></div>
      <div><span class="kpi-v">${fmt(d.temperature_2m_min[0])} / ${fmt(d.temperature_2m_max[0])}</span><span class="kpi-l">°C min / max heute</span></div>
      <div><span class="kpi-v">${fmt(d.temperature_2m_min[1])} / ${fmt(d.temperature_2m_max[1])}</span><span class="kpi-l">°C min / max morgen</span></div>
      <div><span class="kpi-v">${fmt1(regen48)} mm</span><span class="kpi-l">Niederschlag in 48 h</span></div>
      <div><span class="kpi-v">${fmt1(d.et0_fao_evapotranspiration[0])} mm</span><span class="kpi-l">Verdunstung heute (ET0)</span></div>
      <div><span class="kpi-v">${fmt(cur.relative_humidity_2m)} % · ${fmt(cur.wind_speed_10m)}</span><span class="kpi-l">Luftfeuchte · Wind km/h</span></div>
    </div>
    ${regen48 >= 10 ? `<p class="agro-nota">In 48 h werden ${fmt1(regen48)} mm Regen erwartet: Bewässerung eventuell verschieben.</p>` : ""}
    <p class="pista">ET0 ist das Wasser, das eine Referenzkultur verliert: Grundlage für die Bewässerungsmenge.</p>`;
}

function dibujarAgroHoras(cod) {
  const { H, filas } = empfehlungen(cod);
  if (!H.some((x) => x.energia != null)) { $("#agroHoras").innerHTML = `<p class="pista">Keine Preisdaten für die nächsten Stunden.</p>`; return; }
  const conPrecio = H.filter((x) => x.precio != null).length;
  $("#agroHoras").innerHTML = `<div class="agro-filas">${filas.map((f) => `
      <div class="agro-fila"><span class="agro-n">${f.n}</span><span class="agro-v">${bloqueTxt(f.b)}</span><span class="agro-por">${AGRO.clima ? f.por : "günstiger Strom"}</span></div>`).join("")}</div>
    <p class="pista">Nach Day-Ahead-Börsenpreis${AGRO.clima ? " und Wettervorhersage der Zone" : " (Wettervorhersage gerade nicht verfügbar)"}${conPrecio < 24 ? `; Preise liegen erst für ${conPrecio} der nächsten 24 Stunden vor` : ""}. Nur ein Richtwert: Der eigene Stromtarif kann anders aussehen.</p>`;
}

function dibujarAgroRed() {
  const n = estado.d.deutschland;
  let netz = "";
  if (n?.zeiten?.length) {
    const last = n.last.map(pos0), i = last.length - 1, max = Math.max(...last), uso = max > 0 ? last[i] / max : null;
    netz = `<p class="pista">Netzlast Deutschland (${nombreDia(n.zeiten[i])} ${fHora(n.zeiten[i])} Uhr): ${fmt1(last[i] / 1000)} GW, ${pct(uso)} des Höchstwerts der letzten Tage${uso >= AGRO_HOCH ? ` — <strong>hohe Last</strong>` : ""}.</p>`;
  }
  const filas = estado.geo.zonas.map((z) => {
    const c = AGRO.clima?.[z.codigo], d = c?.daily;
    const tmax = d ? Math.max(d.temperature_2m_max[0], d.temperature_2m_max[1]) : null, tmin = d ? Math.min(d.temperature_2m_min[0], d.temperature_2m_min[1]) : null;
    const boe = d?.wind_gusts_10m_max ? Math.max(d.wind_gusts_10m_max[0], d.wind_gusts_10m_max[1]) : null;
    let est = d ? "Normal" : "–", cls = "ok";
    if (tmax != null && tmax >= AGRO_HITZE) { est = "Hitze erwartet"; cls = "alta"; }
    else if (tmin != null && tmin <= AGRO_FROST) { est = "Strenger Frost"; cls = "alta"; }
    else if (boe != null && boe >= AGRO_STURM) { est = "Sturm erwartet"; cls = "media"; }
    return { z, temp: c?.current?.temperature_2m, tmax, tmin, est, cls };
  });
  $("#agroRed").innerHTML = `<div class="agro-tabla">
      <div class="agro-cab"><span>Regelzone</span><span>Jetzt</span><span>Min 48 h</span><span>Max 48 h</span><span>Lage</span></div>
      ${filas.map((x) => `<div><span>${esc(x.z.nombre)}</span><span>${x.temp == null ? "–" : fmt1(x.temp) + " °C"}</span>
        <span>${x.tmin == null ? "–" : fmt1(x.tmin) + " °C"}</span><span>${x.tmax == null ? "–" : fmt1(x.tmax) + " °C"}</span>
        <span class="agro-est ${x.cls}">${x.est}</span></div>`).join("")}
    </div>
    ${netz}
    <p class="pista">Temperaturen aus der Vorhersage (ein Ort je Zone). Hitze ab ${AGRO_HITZE} °C, strenger Frost ab ${AGRO_FROST} °C, Sturm ab Böen von ${AGRO_STURM} km/h: dann steigt die Netzbelastung oder das Risiko von Störungen. Hohe Last: ab ${pct(AGRO_HOCH)} des Höchstwerts.</p>`;
}

// CO₂ je Stunde, letzte 24 Stunden (Energy-Charts, geschätzt)
function co2Stunden() {
  const n = estado.d.deutschland;
  if (!n?.zeiten?.length) return [];
  const ultima = n.zeiten[n.zeiten.length - 1], desde = ultima - (ultima % 3600e3) - 23 * 3600e3;
  const horas = new Map();
  n.zeiten.forEach((t, i) => {
    if (t < desde) return;
    const x = {}; TIPOS.forEach((tp) => (x[tp.k] = pos0(n[tp.k]?.[i])));
    const gen = TIPOS.reduce((s, tp) => s + x[tp.k], 0);
    if (gen <= 0) return;
    const h0 = t - (t % 3600e3), o = horas.get(h0) || { t: h0, n: 0, last: 0, ee: 0, co2: 0 };
    o.n++; o.last += pos0(n.last?.[i]); o.co2 += co2De(x, gen);
    o.ee += TIPOS.filter((tp) => tp.ee).reduce((s, tp) => s + x[tp.k], 0) / gen;
    horas.set(h0, o);
  });
  return [...horas.values()].sort((a, b) => a.t - b.t).map((o) => ({ t: o.t, last: o.last / o.n, ee: o.ee / o.n, co2: o.co2 / o.n }));
}

function dibujarAgroCo2() {
  const H = co2Stunden();
  if (!H.length) { $("#agroCo2").innerHTML = `<p class="pista">Keine Erzeugungsdaten.</p>`; return; }
  const prom = H.reduce((s, x) => s + x.co2, 0) / H.length;
  const limpia = H.reduce((a, b) => (b.co2 < a.co2 ? b : a)), sucia = H.reduce((a, b) => (b.co2 > a.co2 ? b : a));
  const W = 24, alto = 46, mx = Math.max(...H.map((x) => x.co2), 1);
  const barras = H.map((x, k) => {
    const hb = 6 + (x.co2 / mx) * (alto - 6);
    return `<rect x="${k * W + 2}" y="${alto - hb}" width="${W - 4}" height="${hb}" rx="2" fill="${mezcla(css("--co2-bajo"), css("--co2-alto"), x.co2 / CO2_MAX)}"><title>${nombreDia(x.t)} ${fHora(x.t)} Uhr · ${fmt(x.co2)} gCO₂/kWh</title></rect>`;
  }).join("");
  const ticks = H.map((x, k) => (k % 4 === 0 || k === H.length - 1 ? `<text x="${k * W + W / 2}" y="${alto + 13}" text-anchor="middle">${horaNum(x.t)}</text>` : "")).join("");
  const et = (x) => `${fHora(x.t)} Uhr${diaClave(x.t) !== diaClave(Date.now()) ? ` <small>(${nombreDia(x.t)})</small>` : ""}`;
  $("#agroCo2").innerHTML = `
    <div class="dia-datos">
      <div><span class="kpi-l">Durchschnitt 24 h</span><span class="kpi-v">${fmt(prom)}</span><span class="kpi-l">gCO₂/kWh</span></div>
      <div><span class="kpi-l">Sauberste Stunde</span><span class="kpi-v">${et(limpia)}</span><span class="kpi-l">${fmt(limpia.co2)} gCO₂/kWh</span></div>
    </div>
    <svg class="dia-graf" viewBox="0 0 ${H.length * W} ${alto + 16}" role="img" aria-label="CO₂ je Stunde, letzte 24 Stunden">${barras}${ticks}</svg>
    <p class="pista">1.000 kWh um ${fHora(limpia.t)} Uhr verursachten etwa ${fmt(limpia.co2)} kg CO₂, um ${fHora(sucia.t)} Uhr etwa ${fmt(sucia.co2)} kg. Geschätzt für die deutsche Stromerzeugung (ohne Importe).</p>
    <button class="btn agro-csv" id="agroCsv">Stundentabelle herunterladen (CSV)</button>`;
  $("#agroCsv").addEventListener("click", () => {
    const filas = [["zeit", "netzlast_MW", "erneuerbar_prozent", "gCO2_kWh"]].concat(
      H.map((x) => [`${diaClave(x.t)} ${fHora(x.t)}`, Math.round(x.last), Math.round(x.ee * 100), Math.round(x.co2)]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([filas.map((f) => f.join(",")).join("\n")], { type: "text/csv" }));
    a.download = `co2-je-stunde-${diaClave(Date.now())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

function dibujarAgro() {
  if (!estado.calc || !estado.d || !$("#campo")) return;
  if (estado.sel !== AGRO.ultSel) { AGRO.ultSel = estado.sel; if (estado.sel && AGRO.puntos[estado.sel]) AGRO.reg = estado.sel; }
  const sel = $("#agroReg");
  if (!sel.options.length) {
    sel.innerHTML = estado.geo.zonas.map((z) => `<option value="${z.codigo}">${esc(z.nombre)}</option>`).join("");
    sel.addEventListener("change", () => { AGRO.reg = sel.value; dibujarAgro(); });
  }
  sel.value = AGRO.reg;
  dibujarAgroClima(AGRO.reg);
  dibujarAgroHoras(AGRO.reg);
  dibujarAgroRed();
  dibujarAgroCo2();
}

cargarClima();
