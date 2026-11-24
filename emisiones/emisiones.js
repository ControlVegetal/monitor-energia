// Emisores de CO₂ en Argentina. Datos: Climate TRACE (CC BY 4.0), armados por emisiones/herramientas/armar_instalaciones.py.
"use strict";
const V = "2026112410";
const SVGNS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const GRUPOS = {
  energia: "Centrales eléctricas", petroleo: "Petróleo, gas y carbón", industria: "Industria",
  mineria: "Minería", residuos: "Residuos", feedlot: "Feedlots",
};
const SUB = {
  "electricity-generation": "Central eléctrica", "oil-and-gas-production": "Producción de petróleo y gas",
  "oil-and-gas-refining": "Refinería", "oil-and-gas-transport": "Transporte de petróleo y gas", "coal-mining": "Mina de carbón",
  cement: "Cementera", "iron-and-steel": "Acería", aluminum: "Aluminio", chemicals: "Química",
  "petrochemical-steam-cracking": "Petroquímica", "pulp-and-paper": "Celulosa y papel", "textiles-leather-apparel": "Textil y cuero",
  "food-beverage-tobacco": "Alimentos y bebidas", glass: "Vidrio", lime: "Cal", "other-manufacturing": "Otra industria",
  "copper-mining": "Mina de cobre", "iron-mining": "Mina de hierro", "bauxite-mining": "Mina de bauxita",
  "solid-waste-disposal": "Relleno sanitario o basural", "industrial-wastewater-treatment-and-discharge": "Efluentes industriales",
  "enteric-fermentation-cattle-operation": "Feedlot", "manure-management-cattle-operation": "Feedlot (estiércol)",
};
const TIPOS = {
  gas: "gas", coal: "carbón", oil: "fuel oil / gasoil", "Sanitary Landfill": "relleno sanitario", Dumpsite: "basural a cielo abierto",
  "integrated dry": "integrada, vía seca", "BF/BOF": "alto horno", EAF: "horno eléctrico", "DRI-EAF": "reducción directa y horno eléctrico",
  ammonia: "amoníaco", methanol: "metanol", soda_ash: "carbonato de sodio", Smelting: "fundición", Underground: "subterránea",
  "copper-mine": "mina de cobre",
};
const CUENCAS = { Neuquen: "Cuenca Neuquina", "San Jorge": "Cuenca del Golfo San Jorge", Magallanes: "Cuenca Austral",
  Macachin: "Cuenca de Macachín", Cuyo: "Cuenca Cuyana", "Santa Cruz": "Santa Cruz", Noroeste: "Cuenca del Noroeste" };
const RECURSOS = { "Shale oil": "shale oil", "Shale gas": "shale gas", "Tight gas": "tight gas", "Heavy oil": "petróleo pesado",
  "Conventional onshore": "convencional en tierra", "Conventional shelf": "convencional costa afuera", OtherResources: "otros recursos" };

let D, P, provNombre = {}, porId = {};
const est = { prov: "", sector: "", sel: null, mostrar: 15 };
let vista, vb;

function nombre(x) {
  const m = /^Argentina_(.+?)_(.+)$/.exec(x.n);
  if (m) return `${CUENCAS[m[1]] || m[1]} · ${RECURSOS[m[2]] || m[2]}`;
  return x.n;
}
const sub = (x) => x.s.map((s) => SUB[s] || s).join(" + ");
const due = (x) => {
  const vistos = new Set(), r = [];
  for (const o of x.o || []) { const k = o.trim().toLowerCase(); if (k && k !== "unknown" && !vistos.has(k)) { vistos.add(k); r.push(o.trim()); } }
  return r;
};
const nf = (v, d = 0) => v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const mt = (t) => (t >= 1e7 ? nf(t / 1e6, 1) : t >= 1e5 ? nf(t / 1e6, 2) : nf(t / 1e6, 3));
const tTxt = (t) => (t >= 1e6 ? `${nf(t / 1e6, 2)} Mt` : t >= 1e3 ? `${nf(t / 1e3, 0)} mil t` : `${nf(t)} t`);
const col = (g) => `var(--g-${g})`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const xy = (lon, lat) => [(lon - P.proyeccion.lon0) * P.proyeccion.c * P.proyeccion.k, (P.proyeccion.latmax - lat) * P.proyeccion.k];
const el = (tag, at = {}, padre) => { const e = document.createElementNS(SVGNS, tag); for (const k in at) e.setAttribute(k, at[k]); if (padre) padre.appendChild(e); return e; };

async function iniciar() {
  try {
    const [d, p] = await Promise.all([
      fetch(`datos/instalaciones.json?v=${V}`).then((r) => { if (!r.ok) throw new Error(`instalaciones: HTTP ${r.status}`); return r.json(); }),
      fetch(`datos/provincias.json?v=${V}`).then((r) => { if (!r.ok) throw new Error(`provincias: HTTP ${r.status}`); return r.json(); }),
    ]);
    D = d; P = p;
  } catch (e) {
    document.body.classList.add("sin-datos");
    $("aviso").hidden = false;
    $("aviso").textContent = `No se pudieron cargar los datos (${e.message}). Probá recargar la página.`;
    return;
  }
  for (const pr of P.provincias) provNombre[pr.iso] = pr.nombre;
  provNombre.MAR = "Mar argentino";
  for (const x of D.instalaciones) porId[x.id] = x;
  $("avisoEst").textContent = `Estimaciones anuales de Climate TRACE para ${D.anio}, no mediciones. Sirven para saber quién es quién, no para certificar créditos.`;
  $("kTotL").textContent = `Mt CO₂e en ${D.anio}`;
  $("metaVer").textContent = `Versión ${D.version.replace(/_/g, ".")}, año ${D.anio}.`;

  const provs = Object.keys(D.totales).sort((a, b) => provNombre[a].localeCompare(provNombre[b], "es"));
  for (const p of provs) $("fProv").add(new Option(provNombre[p], p));
  for (const g in GRUPOS) if (Object.values(D.totales).some((t) => t[g])) $("fSector").add(new Option(GRUPOS[g], g));
  $("fProv").onchange = () => { est.prov = $("fProv").value; est.mostrar = 15; est.sel = null; encuadrar(); pintar(); };
  $("fSector").onchange = () => { est.sector = $("fSector").value; est.mostrar = 15; est.sel = null; pintar(); };
  $("verMas").onclick = () => { est.mostrar += 25; pintarRanking(); };

  armarMapa();
  pintar();
}

/* ---------- Mapa ---------- */
function armarMapa() {
  const svg = $("mapa");
  vista = P.vista.slice(); vb = vista.slice();
  svg.setAttribute("viewBox", vb.join(" "));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  el("rect", { class: "mar", x: -2000, y: -2000, width: 6000, height: 6000 }, svg);
  const gv = el("g", {}, svg);
  for (const v of P.vecinos) el("path", { class: "vecino", d: v.d }, gv);
  const gp = el("g", { id: "gProv" }, svg);
  for (const pr of P.provincias) {
    const pa = el("path", { class: "prov", d: pr.d, "data-iso": pr.iso, tabindex: 0, role: "button", "aria-label": pr.nombre }, gp);
    pa.addEventListener("click", () => elegirProv(pr.iso));
    pa.addEventListener("keydown", (e) => { if (e.key === "Enter") elegirProv(pr.iso); });
    pa.addEventListener("pointermove", (e) => tip(e, `<b>${esc(pr.nombre)}</b><br>${totProv(pr.iso) ? mt(totProv(pr.iso)) + " Mt CO₂e/año" : "Sin emisiones registradas"}`));
    pa.addEventListener("pointerleave", () => ($("tooltip").hidden = true));
  }
  const gi = el("g", { id: "gPuntos" }, svg);
  for (const x of [...D.instalaciones].sort((a, b) => b.e - a.e)) {
    const [cx, cy] = xy(x.lon, x.lat);
    const c = el("circle", { class: "punto", cx: cx.toFixed(1), cy: cy.toFixed(1), r: radio(x.e).toFixed(1), fill: col(x.g), "data-id": x.id }, gi);
    c.addEventListener("click", (e) => { e.stopPropagation(); elegir(x.id); });
    c.addEventListener("pointermove", (e) => tip(e, `<b>${esc(nombre(x))}</b><br>${esc(sub(x))} · ${esc(provNombre[x.p] || x.p)}<br>${tTxt(x.e)} CO₂e/año`));
    c.addEventListener("pointerleave", () => ($("tooltip").hidden = true));
  }
  zoomPanel(svg);
}
const radio = (e) => Math.max(1.8, Math.sqrt(e / 1e6) * 9);
// Los puntos mantienen su tamaño en pantalla al acercar o alejar
function escalarPuntos() {
  const k = vb[2] / vista[2];
  for (const c of document.querySelectorAll(".punto")) c.setAttribute("r", (radio(porId[c.dataset.id].e) * k).toFixed(2));
}

function totProv(p) {
  const t = D.totales[p] || {};
  return est.sector ? t[est.sector] || 0 : Object.values(t).reduce((a, b) => a + b, 0);
}

function tip(e, html) {
  const t = $("tooltip"), caja = $("mapa").parentElement.getBoundingClientRect();
  t.innerHTML = html; t.hidden = false;
  let x = e.clientX - caja.left + 14, y = e.clientY - caja.top + 14;
  if (x + 250 > caja.width) x = e.clientX - caja.left - 250;
  t.style.left = x + "px"; t.style.top = y + "px";
}

function zoomPanel(svg) {
  const aplicar = () => { svg.setAttribute("viewBox", vb.join(" ")); escalarPuntos(); };
  const zoom = (f, cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2) => {
    const w = Math.min(vista[2] * 1.4, Math.max(vista[2] / 30, vb[2] * f)), k = w / vb[2];
    vb = [cx - (cx - vb[0]) * k, cy - (cy - vb[1]) * k, vb[2] * k, vb[3] * k]; aplicar();
  };
  const aSvg = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  $("zMas").onclick = () => zoom(0.6);
  $("zMenos").onclick = () => zoom(1 / 0.6);
  $("zAjustar").onclick = () => { $("fProv").value = ""; est.prov = ""; vb = vista.slice(); aplicar(); pintar(); };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const p = aSvg(e); zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, p.x, p.y); }, { passive: false });
  const ptr = new Map(); let ini = null, movido = false;
  svg.addEventListener("pointerdown", (e) => { ptr.set(e.pointerId, e); ini = { vb: vb.slice(), p: aSvg(e), d: null }; movido = false; });
  svg.addEventListener("pointermove", (e) => {
    if (!ptr.has(e.pointerId) || !ini) return;
    ptr.set(e.pointerId, e);
    if (ptr.size === 2) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (ini.d) { zoom(ini.d / d); } ini.d = d; movido = true; return;
    }
    const m = svg.getScreenCTM(), dx = (e.clientX - ini.px) / m.a, dy = (e.clientY - ini.py) / m.d;
    if (ini.px === undefined) { ini.px = e.clientX; ini.py = e.clientY; return; }
    if (Math.abs(dx) + Math.abs(dy) > 2) movido = true;
    if (movido) { vb = [ini.vb[0] - dx, ini.vb[1] - dy, vb[2], vb[3]]; aplicar(); }
  });
  const fin = (e) => { ptr.delete(e.pointerId); if (!ptr.size) ini = null; };
  svg.addEventListener("pointerup", fin); svg.addEventListener("pointercancel", fin);
  svg.addEventListener("click", (e) => { if (movido) { e.stopPropagation(); e.preventDefault(); movido = false; } }, true);
}

function encuadrar() {
  const svg = $("mapa");
  if (!est.prov || est.prov === "MAR") { vb = vista.slice(); }
  else {
    const pa = svg.querySelector(`.prov[data-iso="${est.prov}"]`), b = pa.getBBox(), m = Math.max(b.width, b.height) * 0.25 + 8;
    vb = [b.x - m, b.y - m, b.width + 2 * m, b.height + 2 * m];
  }
  svg.setAttribute("viewBox", vb.join(" "));
  escalarPuntos();
}

function elegirProv(iso) {
  est.prov = est.prov === iso ? "" : iso; $("fProv").value = est.prov; est.mostrar = 15; est.sel = null; encuadrar(); pintar();
}

/* ---------- Estado → pantalla ---------- */
function filtradas() {
  return D.instalaciones.filter((x) => (!est.sector || x.g === est.sector) && (!est.prov || x.p === est.prov));
}

function pintar() {
  const tots = Object.fromEntries(Object.keys(D.totales).map((p) => [p, totProv(p)]));
  const max = Math.max(...Object.entries(tots).filter(([p]) => p !== "MAR").map(([, v]) => v), 1);
  for (const pa of document.querySelectorAll(".prov")) {
    const v = tots[pa.dataset.iso] || 0, f = Math.sqrt(v / max);
    pa.setAttribute("fill", v ? `color-mix(in srgb, var(--co2-alto) ${Math.round(8 + f * 70)}%, var(--co2-bajo))` : "var(--tierra)");
    pa.classList.toggle("sel", pa.dataset.iso === est.prov);
  }
  for (const c of document.querySelectorAll(".punto")) {
    const x = porId[c.dataset.id];
    c.style.display = !est.sector || x.g === est.sector ? "" : "none";
    c.style.opacity = !est.prov || x.p === est.prov ? "" : ".25";
    c.classList.toggle("sel", x.id === est.sel);
  }
  const lista = filtradas();
  const total = est.prov ? tots[est.prov] || 0 : Object.values(tots).reduce((a, b) => a + b, 0);
  $("kTot").textContent = mt(total);
  $("kN").textContent = nf(lista.length);
  const top10 = lista.slice(0, 10).reduce((a, x) => a + x.e, 0);
  $("kTop").textContent = total ? `${nf((100 * top10) / total)}%` : "–";
  $("topSub").textContent = `(${[est.prov && provNombre[est.prov], est.sector && GRUPOS[est.sector]].filter(Boolean).join(", ") || "todo el país"}, t CO₂e por año)`;
  pintarRanking();
  pintarProvincias(tots);
  pintarSectores();
  pintarLeyenda(max);
  pintarFicha();
  armarCsv(lista);
}

function pintarRanking() {
  const lista = filtradas(), ol = $("ranking");
  ol.innerHTML = "";
  if (!lista.length) ol.innerHTML = `<p class="pista">No hay instalaciones dibujadas con este filtro.${est.sector === "feedlot" ? " Los feedlots solo figuran en los totales." : ""}</p>`;
  for (const x of lista.slice(0, est.mostrar)) {
    const li = document.createElement("li");
    li.className = x.id === est.sel ? "sel" : "";
    const ow = due(x);
    li.innerHTML = `<span class="rk-n" title="${esc(nombre(x))}">${esc(nombre(x))}</span><span class="rk-v">${tTxt(x.e)}</span>
      <span class="rk-d"><i style="background:${col(x.g)}"></i>${esc(sub(x))} · ${esc(provNombre[x.p] || x.p)}${ow.length ? " · " + esc(ow.join(", ")) : ""}</span>`;
    li.onclick = () => elegir(x.id);
    ol.appendChild(li);
  }
  $("verMas").hidden = lista.length <= est.mostrar;
}

function filas(cont, datos, alClick, selKey) {
  const max = Math.max(...datos.map((d) => d.v), 1);
  cont.innerHTML = "";
  for (const d of datos) {
    const f = document.createElement("div");
    f.className = "mf" + (d.k === selKey ? " sel" : "");
    f.innerHTML = `<span class="mf-n">${d.c ? `<i style="background:${d.c}"></i>` : ""}${esc(d.n)}</span>
      <span class="mf-b"><i style="width:${(100 * d.v) / max}%;background:${d.c || "var(--co2-alto)"}"></i></span><span class="mf-p">${mt(d.v)}</span>`;
    f.onclick = () => alClick(d.k);
    cont.appendChild(f);
  }
}
function pintarProvincias(tots) {
  const datos = Object.entries(tots).filter(([, v]) => v > 0).map(([k, v]) => ({ k, n: provNombre[k] || k, v })).sort((a, b) => b.v - a.v);
  filas($("porProv"), datos, elegirProv, est.prov);
}
function pintarSectores() {
  const sum = {};
  for (const [p, t] of Object.entries(D.totales)) if (!est.prov || p === est.prov) for (const g in t) sum[g] = (sum[g] || 0) + t[g];
  const datos = Object.entries(sum).filter(([, v]) => v > 0).map(([k, v]) => ({ k, n: GRUPOS[k] || k, v, c: col(k) })).sort((a, b) => b.v - a.v);
  $("porSecSub").textContent = `(${est.prov ? provNombre[est.prov] + ", " : ""}Mt CO₂e por año)`;
  filas($("porSec"), datos, (k) => { est.sector = est.sector === k ? "" : k; $("fSector").value = est.sector; est.mostrar = 15; est.sel = null; pintar(); }, est.sector);
}

function pintarLeyenda(max) {
  const tam = [1e5, 1e6, 5e6].map((e) => { const px = Math.round(radio(e) * 2 * (vb[2] / vista[2]) * escalaPx()); return `<span><b style="width:${px}px;height:${px}px"></b>${tTxt(e)}</span>`; }).join("");
  $("leyenda").innerHTML = `<h3>Instalaciones <small>(tamaño = emisiones)</small></h3>
    <div class="ley-g">${Object.keys(GRUPOS).filter((g) => g !== "feedlot").map((g) => `<span><i style="background:${col(g)}"></i>${GRUPOS[g]}</span>`).join("")}</div>
    <div class="ley-tam">${tam}</div>
    <h3>Provincia <small>(total por año${est.sector ? ", " + GRUPOS[est.sector].toLowerCase() : ""})</small></h3>
    <span class="escala" style="background:linear-gradient(90deg, color-mix(in srgb, var(--co2-alto) 8%, var(--co2-bajo)), color-mix(in srgb, var(--co2-alto) 78%, var(--co2-bajo)))"></span>
    <div class="escala-txt"><span>0</span><span>${mt(max)} Mt</span></div>`;
}
function escalaPx() { const m = $("mapa").getScreenCTM(); return m ? m.a : 1; }

/* ---------- Ficha ---------- */
function elegir(id) {
  est.sel = est.sel === id ? null : id;
  pintar();
  if (est.sel) $("ficha").scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function pintarFicha() {
  const f = $("ficha"), x = est.sel && porId[est.sel];
  if (!x) { f.hidden = true; return; }
  f.hidden = false;
  const ow = due(x), tipo = x.t ? TIPOS[x.t] || x.t.replace(/\|/g, ", ") : "";
  const cap = x.cap && x.g === "energia" && x.cap[1] === "MW" ? `${nf(x.cap[0])} MW` : "";
  f.innerHTML = `<div class="ficha-cab"><h2>${esc(nombre(x))}</h2><button class="ficha-cerrar" aria-label="Cerrar">×</button></div>
    <div class="ficha-sec"><i style="background:${col(x.g)}"></i>${esc(sub(x))}${tipo ? " · " + esc(tipo) : ""}</div>
    <div class="kpis"><div><span class="kpi-v">${tTxt(x.e)}</span><span class="kpi-l">CO₂e en ${D.anio} (estimado)</span></div></div>
    <dl style="margin-top:12px">
      <dt>Provincia</dt><dd>${esc(provNombre[x.p] || x.p)}</dd>
      <dt>Propietario</dt><dd>${ow.length ? esc(ow.join(", ")) : "<span style='color:var(--suave)'>No informado</span>"}</dd>
      ${cap ? `<dt>Potencia</dt><dd>${cap}</dd>` : ""}
      <dt>Ubicación</dt><dd><a href="https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=13/${x.lat}/${x.lon}" target="_blank" rel="noopener">${nf(x.lat, 3)}, ${nf(x.lon, 3)}</a></dd>
    </dl>
    ${serieSvg(x)}`;
  f.querySelector(".ficha-cerrar").onclick = () => { est.sel = null; pintar(); };
}
function serieSvg(x) {
  const s = x.serie, an = D.aniosSerie, max = Math.max(...s.filter((v) => v != null), 1), W = 320, H = 92, bw = W / s.length;
  let b = "";
  s.forEach((v, i) => {
    const h = v == null ? 0 : (v / max) * (H - 34);
    b += `<rect x="${i * bw + 6}" y="${H - 16 - h}" width="${bw - 12}" height="${h}" rx="2" fill="${col(x.g)}" opacity="${an[i] === D.anio ? 1 : 0.55}"></rect>
      <text x="${i * bw + bw / 2}" y="${H - 3}" text-anchor="middle">${an[i]}</text>
      ${v != null ? `<text class="v" x="${i * bw + bw / 2}" y="${H - 20 - h}" text-anchor="middle">${v >= 1e6 ? nf(v / 1e6, 1) + " M" : nf(v / 1e3, 0) + " mil"}</text>` : ""}`;
  });
  return `<h3>Toneladas de CO₂e por año</h3><svg class="serie" viewBox="0 0 ${W} ${H}" role="img" aria-label="Emisiones por año">${b}</svg>`;
}

/* ---------- CSV ---------- */
function armarCsv(lista) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cab = ["provincia", "nombre", "sector", "tipo", "propietarios", "latitud", "longitud", `t_co2e_${D.anio}`, ...D.aniosSerie.map((a) => `t_co2e_${a}`), "id_climate_trace"];
  const filas = lista.map((x) => [provNombre[x.p] || x.p, nombre(x), sub(x), x.t || "", due(x).join("; "), x.lat, x.lon, x.e, ...x.serie, x.id].map(q).join(","));
  const txt = "﻿" + [cab.join(","), ...filas].join("\r\n") + `\r\n"Fuente: Climate TRACE (climatetrace.org), CC BY 4.0. Estimaciones, no mediciones."`;
  const a = $("csv");
  if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
  a.href = a.dataset.url = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
}

window.addEventListener("resize", () => D && pintarLeyenda(Math.max(...Object.keys(D.totales).filter((p) => p !== "MAR").map(totProv), 1)));
iniciar();
