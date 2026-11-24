// Emisores de CO₂ en Argentina. Datos: Climate TRACE (CC BY 4.0), armados por emisiones/herramientas/armar_instalaciones.py.
"use strict";
const V = "2026112411";
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

// Rubros de las fábricas de OpenStreetMap (sin dato de emisiones), según etiquetas y nombre
const RUBROS = {
  azucar: "Ingenios azucareros", automotriz: "Automotriz y maquinaria agrícola", metal: "Metalmecánica y metalurgia",
  alimentos: "Alimentos y bebidas", textil: "Textil, cuero y calzado", quimica: "Química, plásticos y farmacia",
  papel: "Papel, madera e imprenta", minerales: "Cerámica, vidrio y materiales", otra: "Otras fábricas",
};
let D, P, O = [], osmInfo = null, provNombre = {}, porId = {};
const est = { prov: "", sector: "", sel: null, mostrar: 15, mostrarO: 30, q: "" };
const esCT = () => !est.sector.startsWith("r:");
const esOSM = () => !est.sector || est.sector.startsWith("r:");
const plano = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const coincide = (x) => !est.q || plano(`${x.sd ? x.n : nombre(x)} ${x.sd ? x.o || "" : due(x).join(" ")}`).includes(est.q);
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
    try {
      const o = await fetch(`datos/fabricas_osm.json?v=${V}`).then((r) => (r.ok ? r.json() : null));
      if (o) { osmInfo = o; O = o.fabricas.map((x) => ({ ...x, id: "osm:" + x.id, osm: x.id, sd: true })); }
    } catch (e) { console.warn("Sin fábricas de OpenStreetMap:", e); }
  } catch (e) {
    document.body.classList.add("sin-datos");
    $("aviso").hidden = false;
    $("aviso").textContent = `No se pudieron cargar los datos (${e.message}). Probá recargar la página.`;
    return;
  }
  for (const pr of P.provincias) provNombre[pr.iso] = pr.nombre;
  provNombre.MAR = "Mar argentino";
  for (const x of D.instalaciones) porId[x.id] = x;
  for (const x of O) porId[x.id] = x;
  $("avisoEst").textContent = `Estimaciones anuales de Climate TRACE para ${D.anio}, no mediciones. Sirven para saber quién es quién, no para certificar créditos.`;
  $("kTotL").textContent = `Mt CO₂e en ${D.anio}`;
  $("metaVer").textContent = `Versión ${D.version.replace(/_/g, ".")}, año ${D.anio}.`;

  const provs = Object.keys(D.totales).sort((a, b) => provNombre[a].localeCompare(provNombre[b], "es"));
  for (const p of provs) $("fProv").add(new Option(provNombre[p], p));
  const og1 = document.createElement("optgroup"); og1.label = "Con emisiones estimadas";
  for (const g in GRUPOS) if (Object.values(D.totales).some((t) => t[g])) og1.appendChild(new Option(GRUPOS[g], g));
  $("fSector").appendChild(og1);
  if (O.length) {
    const og2 = document.createElement("optgroup"); og2.label = "Sin dato de emisiones";
    const n = {}; for (const x of O) n[x.k] = (n[x.k] || 0) + 1;
    for (const k in RUBROS) if (n[k]) og2.appendChild(new Option(`${RUBROS[k]} (${nf(n[k])})`, "r:" + k));
    $("fSector").appendChild(og2);
    $("osmMeta").textContent = `Datos de OpenStreetMap al ${new Date(osmInfo.osm_base).toLocaleDateString("es-AR")}.`;
  } else $("bloqueOsm").hidden = true;
  $("fBuscar").oninput = () => { est.q = plano($("fBuscar").value.trim()); est.mostrar = 15; est.mostrarO = 30; pintar(); };
  $("verMasO").onclick = () => { est.mostrarO += 50; pintarOsm(); };
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
  const go = el("g", { id: "gOsm" }, svg);
  for (const x of O) {
    const [cx, cy] = xy(x.lon, x.lat);
    const c = el("circle", { class: "punto osm", cx: cx.toFixed(1), cy: cy.toFixed(1), r: 2.2, "data-id": x.id }, go);
    c.addEventListener("click", (e) => { e.stopPropagation(); elegir(x.id); });
    c.addEventListener("pointermove", (e) => tip(e, `<b>${esc(x.n)}</b><br>${esc(RUBROS[x.k])} · ${esc(provNombre[x.p] || x.p)}<br><i>Emisiones: sin dato</i>`));
    c.addEventListener("pointerleave", () => ($("tooltip").hidden = true));
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
const radio = (e) => (e == null ? 2.2 : Math.max(1.8, Math.sqrt(e / 1e6) * 9));
// Los puntos mantienen su tamaño en pantalla al acercar o alejar
function escalarPuntos() {
  const k = vb[2] / vista[2];
  for (const c of document.querySelectorAll(".punto")) c.setAttribute("r", (radio(porId[c.dataset.id].e) * k).toFixed(2));
}

function totProv(p) {
  const t = D.totales[p] || {};
  return est.sector && esCT() ? t[est.sector] || 0 : Object.values(t).reduce((a, b) => a + b, 0);
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
  if (!esCT()) return [];
  return D.instalaciones.filter((x) => (!est.sector || x.g === est.sector) && (!est.prov || x.p === est.prov) && coincide(x));
}
function filtradasO() {
  if (!esOSM()) return [];
  const r = est.sector.slice(2);
  return O.filter((x) => (!r || x.k === r) && (!est.prov || x.p === est.prov) && coincide(x));
}

function pintar() {
  const tots = Object.fromEntries(Object.keys(D.totales).map((p) => [p, totProv(p)]));
  const max = Math.max(...Object.entries(tots).filter(([p]) => p !== "MAR").map(([, v]) => v), 1);
  for (const pa of document.querySelectorAll(".prov")) {
    const v = tots[pa.dataset.iso] || 0, f = Math.sqrt(v / max);
    pa.setAttribute("fill", v ? `color-mix(in srgb, var(--co2-alto) ${Math.round(8 + f * 70)}%, var(--co2-bajo))` : "var(--tierra)");
    pa.classList.toggle("sel", pa.dataset.iso === est.prov);
  }
  const r = est.sector.startsWith("r:") ? est.sector.slice(2) : null;
  for (const c of document.querySelectorAll(".punto")) {
    const x = porId[c.dataset.id];
    const vis = x.sd ? esOSM() && (!r || x.k === r) : esCT() && (!est.sector || x.g === est.sector);
    c.style.display = vis && coincide(x) ? "" : "none";
    c.style.opacity = !est.prov || x.p === est.prov ? "" : ".25";
    c.classList.toggle("sel", x.id === est.sel);
  }
  const lista = filtradas();
  const total = est.prov ? tots[est.prov] || 0 : Object.values(tots).reduce((a, b) => a + b, 0);
  $("kTot").textContent = mt(total);
  const listaO = filtradasO();
  $("kN").textContent = nf(lista.length);
  $("kNo").textContent = nf(listaO.length);
  const top10 = lista.slice(0, 10).reduce((a, x) => a + x.e, 0);
  $("kTop").textContent = total ? `${nf((100 * top10) / total)}%` : "–";
  $("kTot").textContent = esCT() ? mt(total) : "–";
  $("kTop").textContent = esCT() && total ? `${nf((100 * top10) / total)}%` : "–";
  const filtro = [est.prov && provNombre[est.prov], est.sector && (GRUPOS[est.sector] || RUBROS[est.sector.slice(2)])].filter(Boolean).join(", ") || "todo el país";
  $("topSub").textContent = `(${filtro}, t CO₂e por año)`;
  $("osmSub").textContent = `(${filtro})`;
  pintarRanking();
  pintarOsm();
  pintarProvincias(tots);
  pintarSectores();
  pintarLeyenda(max);
  pintarFicha();
  armarCsv(lista, listaO);
}

function pintarRanking() {
  const lista = filtradas(), ol = $("ranking");
  ol.innerHTML = "";
  if (!lista.length) ol.innerHTML = `<p class="pista">${esCT() ? "No hay instalaciones con emisiones estimadas para este filtro." : "Este rubro no tiene emisiones estimadas: mirá la lista de abajo."}${est.sector === "feedlot" ? " Los feedlots solo figuran en los totales." : ""}</p>`;
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

function pintarOsm() {
  const lista = filtradasO(), ol = $("listaOsm");
  ol.innerHTML = "";
  if (!lista.length) ol.innerHTML = `<p class="pista">${esOSM() ? "No hay fábricas para este filtro." : "Elegí \"Todos\" o un rubro sin dato de emisiones para verlas."}</p>`;
  for (const x of lista.slice(0, est.mostrarO)) {
    const li = document.createElement("li");
    li.className = x.id === est.sel ? "sel" : "";
    li.innerHTML = `<span class="rk-n" title="${esc(x.n)}">${esc(x.n)}</span><span class="rk-v sd">sin dato</span>
      <span class="rk-d"><i class="hueco"></i>${esc(RUBROS[x.k])} · ${esc(provNombre[x.p] || x.p)}${x.o ? " · " + esc(x.o) : ""}</span>`;
    li.onclick = () => elegir(x.id);
    ol.appendChild(li);
  }
  $("verMasO").hidden = lista.length <= est.mostrarO;
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
    ${O.length ? `<div class="ley-g" style="margin-top:6px"><span><i class="hueco"></i>Fábrica sin dato de emisiones (OpenStreetMap)</span></div>` : ""}
    <h3>Provincia <small>(total por año${est.sector && esCT() ? ", " + GRUPOS[est.sector].toLowerCase() : ""})</small></h3>
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
  if (x.sd) {
    f.innerHTML = `<div class="ficha-cab"><h2>${esc(x.n)}</h2><button class="ficha-cerrar" aria-label="Cerrar">×</button></div>
      <div class="ficha-sec"><i class="hueco"></i>${esc(RUBROS[x.k])}</div>
      <div class="kpis"><div><span class="kpi-v sd">Sin dato</span><span class="kpi-l">de emisiones: no figura en Climate TRACE</span></div></div>
      <dl style="margin-top:12px">
        <dt>Provincia</dt><dd>${esc(provNombre[x.p] || x.p)}</dd>
        ${x.o ? `<dt>Operador</dt><dd>${esc(x.o)}</dd>` : ""}
        ${x.pr ? `<dt>Producto</dt><dd>${esc(x.pr)}</dd>` : ""}
        <dt>Ubicación</dt><dd><a href="https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=15/${x.lat}/${x.lon}" target="_blank" rel="noopener">${nf(x.lat, 3)}, ${nf(x.lon, 3)}</a></dd>
        <dt>Fuente</dt><dd><a href="https://www.openstreetmap.org/${{ n: "node", w: "way", r: "relation" }[x.osm[0]]}/${x.osm.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a></dd>
      </dl>
      <p class="pista">El rubro se deduce del nombre y las etiquetas del mapa, y puede fallar.</p>`;
    f.querySelector(".ficha-cerrar").onclick = () => { est.sel = null; pintar(); };
    return;
  }
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
function armarCsv(lista, listaO) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cab = ["provincia", "nombre", "sector", "tipo", "propietarios", "latitud", "longitud", `t_co2e_${D.anio}`, ...D.aniosSerie.map((a) => `t_co2e_${a}`), "fuente", "id"];
  const filas = lista.map((x) => [provNombre[x.p] || x.p, nombre(x), sub(x), x.t || "", due(x).join("; "), x.lat, x.lon, x.e, ...x.serie, "Climate TRACE", x.id].map(q).join(","))
    .concat(listaO.map((x) => [provNombre[x.p] || x.p, x.n, RUBROS[x.k], x.pr || "", x.o || "", x.lat, x.lon, "sin dato", ...D.aniosSerie.map(() => ""), "OpenStreetMap", x.osm].map(q).join(",")));
  const txt = "﻿" + [cab.join(","), ...filas].join("\r\n") + `\r\n"Fuentes: Climate TRACE (climatetrace.org), CC BY 4.0, estimaciones, no mediciones. Fábricas sin dato: © colaboradores de OpenStreetMap, ODbL."`;
  const a = $("csv");
  if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
  a.href = a.dataset.url = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
}

window.addEventListener("resize", () => D && pintarLeyenda(Math.max(...Object.keys(D.totales).filter((p) => p !== "MAR").map(totProv), 1)));
iniciar();
