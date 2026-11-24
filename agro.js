// Para el campo: clima por región (Open-Meteo) + mejores horas para riego, secado y frío,
// estado de la red por región y huella de carbono por hora. Usa los datos que ya leyó app.js.
"use strict";

const AGRO = {
  // Un punto representativo por región para el pronóstico (supuesto: una ciudad o zona agrícola por región).
  puntos: {
    GBA: [-34.61, -58.38, "Buenos Aires"], BAS: [-35.44, -60.88, "9 de Julio"], LIT: [-32.95, -60.65, "Rosario"],
    NEA: [-27.46, -58.98, "Resistencia"], NOA: [-26.82, -65.22, "Tucumán"], CEN: [-31.42, -64.18, "Córdoba"],
    CUY: [-32.89, -68.84, "Mendoza"], COM: [-38.95, -68.06, "Neuquén"], PAT: [-43.25, -65.31, "Trelew"],
  },
  clima: null, error: "", reg: "BAS", ultSel: undefined, reintento: null,
};
const AGRO_CALOR = 35;      // °C de máxima prevista que se considera calor extremo (supuesto)
const AGRO_EXIGIDA = 0.95;  // demanda ≥ 95% del máximo de ayer y hoy = red exigida (supuesto)
const AGRO_TZ = "America/Argentina/Buenos_Aires";

async function cargarClima() {
  clearTimeout(AGRO.reintento);
  const cods = Object.keys(AGRO.puntos);
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + cods.map((c) => AGRO.puntos[c][0]).join(",") +
    "&longitude=" + cods.map((c) => AGRO.puntos[c][1]).join(",") +
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m" +
    "&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,et0_fao_evapotranspiration" +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration" +
    "&timezone=" + encodeURIComponent(AGRO_TZ) + "&forecast_days=3";
  try {
    let r;
    try { r = await fetch(url); } catch { throw new Error("no hubo respuesta del servicio de clima"); }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) throw new Error(j?.reason || "el servicio de clima respondió HTTP " + r.status);
    const lista = Array.isArray(j) ? j : [j];
    if (lista.length !== cods.length || !lista.every((x) => x.hourly?.time?.length)) throw new Error("respuesta incompleta del servicio de clima");
    AGRO.clima = Object.fromEntries(cods.map((c, i) => [c, lista[i]]));
    AGRO.error = "";
    AGRO.reintento = setTimeout(cargarClima, 60 * 60e3);
  } catch (e) {
    AGRO.error = String(e.message || e);
    console.error("Clima:", e);
    AGRO.reintento = setTimeout(cargarClima, 10 * 60e3);
  }
  if (estado.calc) dibujarAgro();
}

const ahoraAR = () => new Date().toLocaleString("sv-SE", { timeZone: AGRO_TZ }).replace(" ", "T").slice(0, 13); // "2026-11-24T14"
const norm = (v, a, b) => (b - a > 1e-9 ? (v - a) / (b - a) : 0.5);
const f1 = (v) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("es-AR", { maximumFractionDigits: 1 }));
function diaTxt(fechaISO) {
  const hoy = hoyAR(), man = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: AGRO_TZ });
  return fechaISO === hoy ? "hoy" : fechaISO === man ? "mañana" : fechaISO.slice(8, 10) + "/" + fechaISO.slice(5, 7);
}

// Próximas 24 h de la región: clima previsto + energía (se supone que se repite el patrón de las últimas 24 h)
function proximasHoras(cod) {
  const perfil = new Map(resumenDia().map((x) => [x.h, x]));
  const dems = [...perfil.values()].map((x) => x.dem), rens = [...perfil.values()].filter((x) => x.ren != null).map((x) => x.ren);
  const c = AGRO.clima?.[cod]?.hourly, desde = ahoraAR();
  const horas = [];
  if (c) {
    c.time.forEach((t, i) => {
      if (t.slice(0, 13) < desde || horas.length >= 24) return;
      horas.push({ t, h: t.slice(11, 13), dia: t.slice(0, 10), temp: c.temperature_2m[i], hum: c.relative_humidity_2m[i],
        lluvia: c.precipitation[i], viento: c.wind_speed_10m[i], et0: c.et0_fao_evapotranspiration[i] });
    });
  } else {
    // sin pronóstico: solo energía, horas de hoy y mañana según el patrón de las últimas 24 h
    const [d, hh] = desde.split("T"), base = new Date(d + "T" + hh + ":00:00Z").getTime();
    for (let k = 0; k < 24; k++) { const t = new Date(base + k * 3600e3).toISOString(); horas.push({ t, h: t.slice(11, 13), dia: t.slice(0, 10) }); }
  }
  for (const x of horas) {
    const e = perfil.get(x.h);
    if (!e) continue;
    x.dem = e.dem; x.ren = e.ren; x.co2 = e.co2;
    const a = 1 - norm(e.dem, Math.min(...dems), Math.max(...dems));
    const b = e.ren == null ? a : norm(e.ren, Math.min(...rens), Math.max(...rens));
    x.energia = (a + b) / 2; // 1 = poca demanda y muchas renovables
  }
  return horas;
}

// Mejor bloque de 3 horas seguidas según un puntaje
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

function recomendaciones(cod) {
  const H = proximasHoras(cod);
  const hay = (k) => H.some((x) => x[k] != null);
  const rango = (k) => { const v = H.map((x) => x[k]).filter((v) => v != null); return [Math.min(...v), Math.max(...v)]; };
  const [vMin, vMax] = hay("viento") ? rango("viento") : [0, 0], [eMin, eMax] = hay("et0") ? rango("et0") : [0, 0];
  const [hMin, hMax] = hay("hum") ? rango("hum") : [0, 0], [tMin, tMax] = hay("temp") ? rango("temp") : [0, 0];
  const mezclar = (x, clima, pe) => (x.energia == null ? null : clima == null ? x.energia : pe * x.energia + (1 - pe) * clima);
  const tareas = [
    { n: "Riego y bombeo", por: "poca demanda, poco viento y poca evaporación",
      p: (x) => mezclar(x, x.viento == null ? null : ((1 - norm(x.viento, vMin, vMax)) + (1 - norm(x.et0, eMin, eMax))) / 2, 0.5) },
    { n: "Secado de granos", por: "poca demanda y aire más seco",
      p: (x) => mezclar(x, x.hum == null ? null : (1 - norm(x.hum, hMin, hMax)) * (x.lluvia > 0.2 ? 0.3 : 1), 0.5) },
    { n: "Frío (cámaras, tambo)", por: "poca demanda y más fresco: enfriar antes del calor",
      p: (x) => mezclar(x, x.temp == null ? null : 1 - norm(x.temp, tMin, tMax), 0.6) },
  ];
  return { H, filas: tareas.map((t) => ({ ...t, b: mejorBloque(H, t.p) })) };
}

function bloqueTxt(b) {
  if (!b) return "sin datos";
  const a = b.tramo[0], z = b.tramo[b.tramo.length - 1];
  const fin = String((Number(z.h) + 1) % 24).padStart(2, "0");
  return `${a.h} a ${fin} h <small>(${diaTxt(a.dia)})</small>`;
}

function dibujarAgroClima(cod) {
  const p = AGRO.puntos[cod], c = AGRO.clima?.[cod];
  if (!c) {
    $("#agroClima").innerHTML = `<p class="pista">${AGRO.error ? `No se pudo leer el pronóstico (${esc(AGRO.error)}). Reintentando en 10 minutos.` : "Leyendo el pronóstico…"}</p>`;
    return;
  }
  const d = c.daily, ahora = ahoraAR();
  const i0 = Math.max(c.hourly.time.findIndex((t) => t.slice(0, 13) >= ahora), 0);
  const lluvia48 = c.hourly.precipitation.slice(i0, i0 + 48).reduce((s, v) => s + (v || 0), 0);
  const cur = c.current || {};
  $("#agroClima").innerHTML = `
    <div class="kpis kpis3">
      <div><span class="kpi-v">${f1(cur.temperature_2m)} °C</span><span class="kpi-l">ahora en ${esc(p[2])}</span></div>
      <div><span class="kpi-v">${f1(d.temperature_2m_min[0])} / ${f1(d.temperature_2m_max[0])}</span><span class="kpi-l">°C mín / máx hoy</span></div>
      <div><span class="kpi-v">${f1(d.temperature_2m_min[1])} / ${f1(d.temperature_2m_max[1])}</span><span class="kpi-l">°C mín / máx mañana</span></div>
      <div><span class="kpi-v">${f1(lluvia48)} mm</span><span class="kpi-l">lluvia prevista 48 h</span></div>
      <div><span class="kpi-v">${f1(d.et0_fao_evapotranspiration[0])} mm</span><span class="kpi-l">evapotranspiración hoy (ET0)</span></div>
      <div><span class="kpi-v">${fmt(cur.relative_humidity_2m)}% · ${fmt(cur.wind_speed_10m)}</span><span class="kpi-l">humedad · viento km/h</span></div>
    </div>
    ${lluvia48 >= 10 ? `<p class="agro-nota">Se esperan ${f1(lluvia48)} mm de lluvia en 48 h: conviene evaluar postergar el riego.</p>` : ""}
    <p class="pista">ET0 es el agua que pierde un cultivo de referencia: sirve para calcular cuánto regar.</p>`;
}

function dibujarAgroHoras(cod) {
  const { H, filas } = recomendaciones(cod);
  if (!H.some((x) => x.energia != null)) { $("#agroHoras").innerHTML = `<p class="pista">Todavía no hay datos suficientes de las últimas 24 h.</p>`; return; }
  $("#agroHoras").innerHTML = `<div class="agro-filas">${filas.map((f) => `
      <div class="agro-fila"><span class="agro-n">${f.n}</span><span class="agro-v">${bloqueTxt(f.b)}</span><span class="agro-por">${AGRO.clima ? f.por : "poca demanda y más renovables"}</span></div>`).join("")}</div>
    <p class="pista">Se supone que la demanda y las renovables de las próximas horas siguen el patrón de las últimas 24 h${AGRO.clima ? ", combinado con el pronóstico de la región" : " (sin pronóstico por ahora)"}. Es una guía, no un precio: la tarifa de cada usuario puede ser distinta.</p>`;
}

function maxDemanda(id) {
  let m = 0;
  for (const [, f] of estado.datos.idx.dem[id] || []) m = Math.max(m, limpio(f.dem));
  for (const f of estado.ayerReg?.dem?.[id] || []) m = Math.max(m, limpio(f.dem));
  return m;
}

function dibujarAgroRed() {
  const filas = estado.calc.R.map((r) => {
    const max = maxDemanda(r.id), uso = max > 0 ? r.dem / max : null;
    const d = AGRO.clima?.[r.codigo]?.daily;
    const tmax = d ? Math.max(d.temperature_2m_max[0], d.temperature_2m_max[1]) : null;
    let est = "Normal", cls = "ok";
    const pico = uso != null && uso >= AGRO_EXIGIDA, calor = tmax != null && tmax >= AGRO_CALOR;
    if (pico && (calor || (r.temp ?? 0) >= 30)) { est = "Red exigida"; cls = "alta"; }
    else if (calor) { est = "Calor extremo previsto"; cls = "media"; }
    else if (pico) { est = "Cerca del pico"; cls = "media"; }
    return { r, uso, tmax, est, cls };
  });
  $("#agroRed").innerHTML = `<div class="agro-tabla">
      <div class="agro-cab"><span>Región</span><span>Temp.</span><span>Demanda vs. máx.</span><span>Máx. prevista</span><span>Estado</span></div>
      ${filas.map((x) => `<div><span>${esc(x.r.nombre)}</span><span>${x.r.temp == null ? "–" : f1(x.r.temp) + " °C"}</span>
        <span>${x.uso == null ? "–" : pct(x.uso)}</span><span>${x.tmax == null ? "–" : f1(x.tmax) + " °C"}</span>
        <span class="agro-est ${x.cls}">${x.est}</span></div>`).join("")}
    </div>
    <p class="pista">Temperatura actual de CAMMESA. "Demanda vs. máx." compara la demanda de la hora mostrada con la más alta de ayer y hoy en esa región; desde ${pct(AGRO_EXIGIDA)} está cerca del pico. Red exigida: cerca del pico con calor (30 °C ahora o ${AGRO_CALOR} °C previstos en 48 h), cuando más riesgo hay de cortes.</p>`;
}

function dibujarAgroCo2() {
  const H = resumenDia().filter((x) => x.co2 != null);
  if (!H.length) { $("#agroCo2").innerHTML = `<p class="pista">Sin datos de generación.</p>`; return; }
  const prom = H.reduce((s, x) => s + x.co2, 0) / H.length;
  const limpia = H.reduce((a, b) => (b.co2 < a.co2 ? b : a)), sucia = H.reduce((a, b) => (b.co2 > a.co2 ? b : a));
  const W = 24, alto = 46, mx = Math.max(...H.map((x) => x.co2), 1);
  const barras = H.map((x, n) => {
    const hb = 6 + (x.co2 / mx) * (alto - 6);
    return `<rect x="${n * W + 2}" y="${alto - hb}" width="${W - 4}" height="${hb}" rx="2" fill="${mezcla(css("--co2-bajo"), css("--co2-alto"), x.co2 / G_CO2_TERMICO)}"><title>${x.ayer ? "Ayer " : ""}${x.h} h · ${fmt(x.co2)} gCO₂/kWh</title></rect>`;
  }).join("");
  const ticks = H.map((x, n) => (n % 4 === 0 || n === H.length - 1 ? `<text x="${n * W + W / 2}" y="${alto + 13}" text-anchor="middle">${x.h}</text>` : "")).join("");
  const et = (x) => `${x.h} h${x.ayer ? " <small>(ayer)</small>" : ""}`;
  $("#agroCo2").innerHTML = `
    <div class="dia-datos">
      <div><span class="kpi-l">Promedio 24 h</span><span class="kpi-v">${fmt(prom)}</span><span class="kpi-l">gCO₂/kWh</span></div>
      <div><span class="kpi-l">Hora más limpia</span><span class="kpi-v">${et(limpia)}</span><span class="kpi-l">${fmt(limpia.co2)} gCO₂/kWh</span></div>
    </div>
    <svg class="dia-graf" viewBox="0 0 ${H.length * W} ${alto + 16}" role="img" aria-label="Carbono por hora, últimas 24 horas">${barras}${ticks}</svg>
    <p class="pista">Cada 1.000 kWh consumidos a las ${limpia.h} h emitieron unos ${fmt(limpia.co2)} kg de CO₂; a las ${sucia.h} h, unos ${fmt(sucia.co2)} kg. Estimado para la red nacional.</p>
    <button class="btn agro-csv" id="agroCsv">Descargar tabla por hora (CSV)</button>`;
  $("#agroCsv").addEventListener("click", () => {
    const filas = [["fecha_hora", "demanda_MW", "renovable_pct", "gCO2_kWh"]].concat(
      resumenDia().map((x) => [x.hk.replace("T", " ") + ":00", Math.round(x.dem), x.ren == null ? "" : Math.round(x.ren * 100), x.co2 == null ? "" : Math.round(x.co2)]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([filas.map((f) => f.join(",")).join("\n")], { type: "text/csv" }));
    a.download = `carbono-por-hora-${hoyAR()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

function dibujarAgro() {
  if (!estado.calc || !$("#campo")) return;
  // si se elige una región en el mapa, la sección del campo la sigue
  if (estado.sel !== AGRO.ultSel) {
    AGRO.ultSel = estado.sel;
    const r = estado.geo.regiones.find((x) => x.id === estado.sel);
    if (r) AGRO.reg = r.codigo;
  }
  const sel = $("#agroReg");
  if (!sel.options.length) {
    sel.innerHTML = estado.geo.regiones.map((r) => `<option value="${r.codigo}">${esc(r.nombre)}</option>`).join("");
    sel.addEventListener("change", () => { AGRO.reg = sel.value; dibujarAgro(); });
  }
  sel.value = AGRO.reg;
  dibujarAgroClima(AGRO.reg);
  dibujarAgroHoras(AGRO.reg);
  dibujarAgroRed();
  dibujarAgroCo2();
}

cargarClima();
