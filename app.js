// Monitor de Energía Argentina: página estática que lee la API abierta de CAMMESA.
"use strict";

const API = "https://api.cammesa.com/demanda-svc/";
const NACIONAL = 1002;
const ACTUALIZAR_MIN = 5;
const G_CO2_TERMICO = 450; // gCO2/kWh supuesto para la generación térmica (aproximación)

// Corredores de la red reducida (indicativa): regiones vecinas unidas por líneas de alta tensión.
// "c" = peso relativo del corredor (más alto = más capacidad / menor impedancia). Es una aproximación.
const CORREDORES = [
  ["COM", "BAS", 3], ["COM", "CUY", 1], ["COM", "PAT", 1],
  ["CUY", "CEN", 1], ["CUY", "NOA", 1], ["CEN", "NOA", 1], ["CEN", "LIT", 2],
  ["NOA", "NEA", 1], ["NEA", "LIT", 2], ["LIT", "BAS", 2], ["LIT", "GBA", 2], ["BAS", "GBA", 4],
];

const TIPOS = [
  { k: "hidraulico", n: "Hidráulica", c: "--hidraulico" },
  { k: "termico", n: "Térmica", c: "--termico" },
  { k: "nuclear", n: "Nuclear", c: "--nuclear" },
  { k: "renovable", n: "Renovable", c: "--renovable" },
];

const estado = { geo: null, datos: null, claves: [], idx: 0, modo: "balance", sel: null, capas: { burbujas: true, valores: true }, calc: null, enUltima: true };
const $ = (s) => document.querySelector(s);
const fmt = (v) => (v == null || !isFinite(v) ? "–" : Math.round(v).toLocaleString("es-AR"));
const pct = (v) => (isFinite(v) ? Math.round(v * 100) + "%" : "–");
// Colores de reserva: si el navegador tiene guardada una hoja de estilos vieja sin alguna variable,
// el mapa igual se pinta (antes el modo carbono quedaba sin color).
const COLORES = { "--neutro": "#f7f6f2", "--exporta": "#e0473e", "--importa": "#3a76d8", "--acento": "#2a78d6", "--co2-bajo": "#e9f4ea", "--co2-alto": "#5b3b24" };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || COLORES[v] || "#999999";

// ---------- Datos ----------
const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const clave = (fecha) => String(fecha).slice(0, 16); // "2026-11-24T10:05"
const limpio = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }; // negativos -> 0

// Pide un recurso a la API. Si falla, vuelve a intentar y, al final, averigua qué tipo de falla fue.
async function pedir(ruta, intentos = 3) {
  const url = API + ruta;
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url); // GET simple, sin cabeceras extra (no dispara preflight CORS)
      if (!r.ok) throw new Error("la API respondió HTTP " + r.status);
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); } catch { throw new Error("la API respondió algo que no es JSON (posible bloqueo del firewall)"); }
      if (!Array.isArray(j)) throw new Error("respuesta inesperada");
      return j;
    } catch (e) {
      ultimo = e;
      if (i + 1 < intentos) await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
  if (ultimo instanceof TypeError) {
    // "Failed to fetch": ¿el servidor contestó sin permiso CORS (p. ej. página de bloqueo) o no contestó?
    let contesto = false;
    try { await fetch(url, { mode: "no-cors" }); contesto = true; } catch {}
    throw new Error(contesto
      ? "CAMMESA respondió, pero sin permiso para que la página lo lea (probablemente su firewall rechazó el pedido)"
      : "no hubo respuesta de CAMMESA (conexión cortada o bloqueada)");
  }
  throw ultimo;
}

async function cargarEnVivo() {
  const ids = [NACIONAL, ...estado.geo.regiones.map((r) => r.id)];
  const nombres = { [NACIONAL]: "total país", ...Object.fromEntries(estado.geo.regiones.map((r) => [r.id, r.nombre])) };
  const fecha = hoyAR();
  const tareas = [];
  for (const id of ids) {
    tareas.push(["gen", id, `generacion/ObtieneGeneracioEnergiaPorRegion?id_region=${id}`]);
    tareas.push(["dem", id, `demanda/ObtieneDemandaYTemperaturaRegionByFecha?id_region=${id}&fecha=${fecha}`]);
  }
  const datos = { gen: {}, dem: {} }, fallas = [];
  // de a 2 pedidos por vez y con una pausa corta, para no parecerle un ataque al firewall de CAMMESA
  let i = 0;
  async function trabajador() {
    while (i < tareas.length) {
      const [tipo, id, ruta] = tareas[i++];
      try { datos[tipo][id] = await pedir(ruta); }
      catch (e) { fallas.push(`${tipo === "gen" ? "generación" : "demanda"} ${nombres[id]}: ${e.message}`); }
      await new Promise((ok) => setTimeout(ok, 250));
    }
  }
  await Promise.all([trabajador(), trabajador()]);
  if (fallas.length) {
    const err = new Error(`fallaron ${fallas.length} de ${tareas.length} pedidos. Primero: ${fallas[0]}`);
    err.fallas = fallas;
    throw err;
  }
  return datos;
}

function indexar(datos) {
  const idx = { gen: {}, dem: {} };
  for (const t of ["gen", "dem"]) {
    for (const [id, filas] of Object.entries(datos[t])) {
      const m = new Map();
      for (const f of filas || []) m.set(clave(f.fecha), f);
      idx[t][id] = m;
    }
  }
  // horas con datos completos: nacional y todas las regiones (generación y demanda)
  const ids = estado.geo.regiones.map((r) => String(r.id));
  const claves = [...(idx.gen[NACIONAL] || new Map()).keys()].filter((k) =>
    ids.every((id) => idx.gen[id]?.has(k) && idx.dem[id]?.has(k))
  ).sort();
  return { idx, claves };
}

// ---------- Cálculo ----------
function resolver(A, b) { // eliminación gaussiana con pivoteo parcial
  const n = b.length, M = A.map((f, i) => [...f, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let f = c + 1; f < n; f++) if (Math.abs(M[f][c]) > Math.abs(M[p][c])) p = f;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let f = 0; f < n; f++) {
      if (f === c) continue;
      const k = M[f][c] / M[c][c];
      for (let j = c; j <= n; j++) M[f][j] -= k * M[c][j];
    }
  }
  return M.map((f, i) => (Math.abs(f[i]) < 1e-12 ? 0 : f[n] / f[i]));
}

// la temperatura llega cada 15 minutos: usar la última disponible hasta esa hora
function ultimaTemp(m, k) {
  let t = null;
  for (const [kk, f] of m) if (kk <= k && f.temp != null && isFinite(Number(f.temp))) t = Number(f.temp);
  return t;
}

function calcular(k) {
  const { idx } = estado.datos;
  const regs = estado.geo.regiones;
  const n = regs.length;
  const pos = Object.fromEntries(regs.map((r, i) => [r.codigo, i]));

  const R = regs.map((r) => {
    const g = idx.gen[r.id].get(k), d = idx.dem[r.id].get(k);
    const o = { id: r.id, codigo: r.codigo, nombre: r.nombre };
    for (const t of TIPOS) o[t.k] = limpio(g[t.k]);
    o.gen = TIPOS.reduce((s, t) => s + o[t.k], 0);
    o.dem = limpio(d.dem);
    o.temp = ultimaTemp(idx.dem[r.id], k);
    o.neto = o.gen - o.dem;
    o.co2 = o.gen > 0 ? (G_CO2_TERMICO * o.termico) / o.gen : null;
    return o;
  });

  const gn = idx.gen[NACIONAL].get(k), dn = idx.dem[NACIONAL]?.get(k);
  const nac = {};
  for (const t of TIPOS) nac[t.k] = limpio(gn[t.k]);
  nac.importacion = limpio(gn.importacion);
  nac.total = TIPOS.reduce((s, t) => s + nac[t.k], 0) + nac.importacion;
  nac.dem = dn ? limpio(dn.dem) : null;
  const sumGen = R.reduce((s, r) => s + r.gen, 0), sumDem = R.reduce((s, r) => s + r.dem, 0);
  nac.noAsignado = Math.max(nac.total - nac.importacion - sumGen, 0);
  nac.co2 = nac.total > 0 ? (G_CO2_TERMICO * nac.termico) / nac.total : null;

  // Lo que falta para cerrar el balance (importación + generación no asignada - pérdidas)
  // se reparte entre regiones en proporción a su demanda, como "sin ubicar".
  const resto = sumDem - sumGen;
  nac.sinUbicar = resto;
  R.forEach((r) => {
    const v = sumDem > 0 ? (resto * r.dem) / sumDem : 0;
    r.fuente = r.gen + Math.max(v, 0);      // generación propia + parte sin ubicar
    r.carga = r.dem + Math.max(-v, 0);
    r.sinUbicar = Math.max(v, 0);
    r.iny = r.fuente - r.carga;             // suma 0 entre todas las regiones
  });

  // Flujo DC: B·θ = P, con GBA como referencia (θ = 0).
  const ref = pos.GBA;
  const B = Array.from({ length: n }, () => Array(n).fill(0));
  const lineas = CORREDORES.map(([a, b, c]) => {
    const i = pos[a], j = pos[b];
    const dx = regs[i].x - regs[j].x, dy = regs[i].y - regs[j].y;
    const y = c / Math.hypot(dx, dy); // admitancia ~ capacidad / distancia
    B[i][i] += y; B[j][j] += y; B[i][j] -= y; B[j][i] -= y;
    return { i, j, y };
  });
  const otros = [...Array(n).keys()].filter((i) => i !== ref);
  const th = resolver(otros.map((i) => otros.map((j) => B[i][j])), otros.map((i) => R[i].iny));
  const theta = Array(n).fill(0);
  otros.forEach((i, q) => (theta[i] = th[q]));
  const flujos = lineas.map(({ i, j, y }) => {
    const f = (theta[i] - theta[j]) * y;
    return f >= 0 ? { de: i, a: j, mw: f } : { de: j, a: i, mw: -f };
  });

  // Rastreo proporcional (Bialek): de qué región viene lo que llega a cada región.
  const P = R.map((r, i) => r.fuente + flujos.filter((f) => f.a === i).reduce((s, f) => s + f.mw, 0));
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (const f of flujos) if (P[f.de] > 0) A[f.a][f.de] -= f.mw / P[f.de];
  const origen = R.map((r, i) => {
    // fila i de A^-1: resolver A^T x = e_i
    const At = A[0].map((_, c) => A.map((fila) => fila[c]));
    const e = Array(n).fill(0); e[i] = 1;
    const fila = resolver(At, e);
    const porFuente = R.map((rk, kk) => (P[i] > 0 ? (fila[kk] * rk.fuente) / P[i] : 0));
    // parte generada en cada región (sin contar la porción "sin ubicar" asignada a esa región)
    const porRegion = R.map((rk, kk) => (rk.fuente > 0 ? (porFuente[kk] * rk.gen) / rk.fuente : 0));
    const mix = { sinUbicar: 0 };
    TIPOS.forEach((t) => (mix[t.k] = 0));
    R.forEach((rk, kk) => {
      if (rk.fuente <= 0) return;
      TIPOS.forEach((t) => (mix[t.k] += (porFuente[kk] * rk[t.k]) / rk.fuente));
      mix.sinUbicar += (porFuente[kk] * rk.sinUbicar) / rk.fuente;
    });
    return { porRegion, mix };
  });

  return { k, R, nac, flujos, origen };
}

// ---------- Dibujo ----------
const SVG = "http://www.w3.org/2000/svg";
const el = (tag, at = {}) => { const e = document.createElementNS(SVG, tag); for (const [a, v] of Object.entries(at)) e.setAttribute(a, v); return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function hex(c) {
  c = c.replace("#", ""); if (c.length === 3) c = [...c].map((x) => x + x).join("");
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
}
function mezcla(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const A = hex(a), B = hex(b);
  return "rgb(" + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",") + ")";
}
const nombreDe = (id) => estado.geo.regiones.find((r) => r.id === id)?.nombre || "";

// ----- Zoom y arrastre del mapa (se mueve el viewBox del SVG) -----
const vista = { x: 0, y: 0, w: 1, h: 1 };
function ajustarVista() {
  const [x, y, w, h] = estado.geo.vista, svg = $("#mapa");
  const r = svg.getBoundingClientRect(), asp = r.width / Math.max(r.height, 1);
  const pad = 1.06;
  let W = w * pad, H = h * pad;
  if (W / H < asp) W = H * asp; else H = W / asp;
  Object.assign(vista, { x: x + w / 2 - W / 2, y: y + h / 2 - H / 2, w: W, h: H });
  aplicarVista();
}
function aplicarVista() {
  $("#mapa").setAttribute("viewBox", `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);
}
function zoom(f, cx, cy) {
  const r = $("#mapa").getBoundingClientRect();
  const px = cx == null ? 0.5 : (cx - r.left) / r.width, py = cy == null ? 0.5 : (cy - r.top) / r.height;
  const max = estado.geo.vista[2] * 1.5, min = estado.geo.vista[2] / 8;
  const w = Math.max(min, Math.min(max * 2, vista.w * f));
  const k = w / vista.w;
  vista.x += (vista.w - w) * px; vista.y += (vista.h - vista.h * k) * py;
  vista.w = w; vista.h *= k;
  aplicarVista();
}
function activarArrastre() {
  const svg = $("#mapa");
  let ini = null;
  svg.addEventListener("pointerdown", (e) => { ini = { x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y, movio: false }; });
  window.addEventListener("pointermove", (e) => {
    if (!ini) return;
    const dx = e.clientX - ini.x, dy = e.clientY - ini.y;
    if (!ini.movio && Math.hypot(dx, dy) < 5) return;
    ini.movio = true;
    const u = vista.w / svg.getBoundingClientRect().width;
    vista.x = ini.vx - dx * u; vista.y = ini.vy - dy * u;
    aplicarVista();
  });
  window.addEventListener("pointerup", () => { if (ini?.movio) estado.arrastro = Date.now(); ini = null; });
  svg.addEventListener("wheel", (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
}

function armarMapa() {
  const svg = $("#mapa");
  svg.replaceChildren();
  const [, , W, H] = estado.geo.viewBox;
  svg.append(el("rect", { x: -W, y: -H, width: W * 3, height: H * 3, class: "mar" }));
  const gV = el("g"), gR = el("g"), gF = el("g", { id: "flujos" }), gB = el("g", { id: "burbujas" }), gE = el("g", { id: "etiquetas" });
  for (const v of estado.geo.vecinos || []) gV.append(el("path", { d: v.d, class: "vecino" }));
  for (const s of estado.geo.sinRed) {
    const p = el("path", { d: s.d, class: "sinred" });
    p.addEventListener("mousemove", (ev) => tip(ev, `<strong>${esc(s.nombre)}</strong>`));
    p.addEventListener("mouseleave", ocultarTip);
    gR.append(p);
  }
  for (const r of estado.geo.regiones) {
    const p = el("path", { d: r.d, class: "region", "data-id": r.id, tabindex: 0, role: "button", "aria-label": r.nombre });
    p.addEventListener("click", () => { if (Date.now() - (estado.arrastro || 0) > 200) seleccionar(r.id); });
    p.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); seleccionar(r.id); } });
    p.addEventListener("mousemove", (ev) => tipRegion(ev, r.id));
    p.addEventListener("mouseleave", ocultarTip);
    gR.append(p);
  }
  svg.append(gV, gR, gF, gB, gE);
  ajustarVista();
}

function colorRegion(r, i) {
  const { calc, modo } = estado;
  const neutro = css("--neutro");
  if (modo === "balance") {
    const t = r.dem > 0 ? r.neto / r.dem : 0; // neto ÷ demanda
    return t >= 0 ? mezcla(neutro, css("--exporta"), t) : mezcla(neutro, css("--importa"), -t);
  }
  if (modo === "carbono") return r.co2 == null ? neutro : mezcla(css("--co2-bajo"), css("--co2-alto"), r.co2 / G_CO2_TERMICO);
  const sel = calc.R.findIndex((x) => x.id === (estado.sel ?? 426));
  const share = calc.origen[sel].porRegion[i];
  return mezcla(neutro, css("--acento"), Math.sqrt(share));
}

function torta(cx, cy, rad, partes) {
  const g = el("g", { class: "torta" });
  const tot = partes.reduce((s, p) => s + p.v, 0);
  if (tot <= 0) return g;
  let a = -Math.PI / 2;
  for (const p of partes) {
    if (p.v <= 0) continue;
    const da = (p.v / tot) * Math.PI * 2;
    if (da >= Math.PI * 2 - 1e-6) { g.append(el("circle", { cx, cy, r: rad, fill: `var(${p.c})` })); break; }
    const x1 = cx + rad * Math.cos(a), y1 = cy + rad * Math.sin(a);
    a += da;
    const x2 = cx + rad * Math.cos(a), y2 = cy + rad * Math.sin(a);
    g.append(el("path", { d: `M${cx},${cy}L${x1},${y1}A${rad},${rad} 0 ${da > Math.PI ? 1 : 0} 1 ${x2},${y2}Z`, fill: `var(${p.c})` }));
  }
  g.append(el("circle", { cx, cy, r: rad, class: "torta-borde" }));
  return g;
}

function dibujar() {
  const { calc } = estado;
  if (!calc) return;
  const regs = estado.geo.regiones;
  document.querySelectorAll(".region").forEach((p) => {
    const id = Number(p.dataset.id), i = calc.R.findIndex((r) => r.id === id);
    p.style.fill = colorRegion(calc.R[i], i);
    p.classList.toggle("sel", id === estado.sel);
  });

  const gF = $("#flujos"); gF.replaceChildren();
  for (const f of calc.flujos) {
    if (f.mw < 5) continue;
    const a = regs[f.de], b = regs[f.a];
    const w = Math.min(1.5 + f.mw / 200, 15);
    const ln = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "flujo", "stroke-width": w });
    ln.addEventListener("mousemove", (ev) => tip(ev, `<strong>${esc(a.nombre)} → ${esc(b.nombre)}</strong><br>${fmt(f.mw)} MW (estimado)`));
    ln.addEventListener("mouseleave", ocultarTip);
    gF.append(ln);
    // flecha en el medio, apuntando hacia donde va la energía
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    gF.append(el("path", { d: "M-1,-1L1,0L-1,1Z", class: "flecha", transform: `translate(${mx},${my}) rotate(${ang}) scale(${(w * 0.7 + 4).toFixed(1)})` }));
    if (estado.capas.valores && f.mw >= 50) {
      const t = el("text", { x: mx, y: my, class: "etq-mw", "text-anchor": "middle" });
      t.textContent = fmt(f.mw);
      gF.append(t);
    }
  }

  const gB = $("#burbujas"), gE = $("#etiquetas"); gB.replaceChildren(); gE.replaceChildren();
  calc.R.forEach((r, i) => {
    const g = regs[i], rad = Math.sqrt(r.gen) / 2.6;
    const nodo = estado.capas.burbujas ? torta(g.x, g.y, rad, TIPOS.map((t) => ({ v: r[t.k], c: t.c }))) : el("circle", { cx: g.x, cy: g.y, r: 4, class: "nodo" });
    // el círculo también sirve para elegir la región (GBA es muy chica para tocarla en el mapa)
    nodo.dataset.id = r.id;
    nodo.addEventListener("click", () => { if (Date.now() - (estado.arrastro || 0) > 200) seleccionar(r.id); });
    nodo.addEventListener("mousemove", (ev) => tipRegion(ev, r.id));
    nodo.addEventListener("mouseleave", ocultarTip);
    gB.append(nodo);
    const t = el("text", { x: g.x, y: g.y + (estado.capas.burbujas ? rad : 3) + 4, class: "etq", "text-anchor": "middle", "dominant-baseline": "hanging" });
    t.textContent = g.nombre;
    gE.append(t);
  });

  dibujarLeyenda();
  dibujarPais();
  dibujarRegion();
  dibujarFlujos();
  dibujarHora();
}

function dibujarHora() {
  const k = estado.calc.k, [a, m, d] = k.slice(0, 10).split("-");
  $("#horaTxt").textContent = `${d}/${m} ${k.slice(11, 16)} h` + (estado.enUltima ? " (último)" : "");
  $("#atras").disabled = estado.idx <= 0;
  $("#adelante").disabled = estado.enUltima;
  $("#vivo").classList.toggle("activo", estado.enUltima);
}

function dibujarLeyenda() {
  const n = css("--neutro"), L = $("#leyenda");
  let escala;
  if (estado.modo === "balance")
    escala = `<h3>Balance de la región <small>(neto ÷ demanda)</small></h3>
      <span class="escala" style="background:linear-gradient(90deg,${css("--importa")},${n},${css("--exporta")})"></span>
      <div class="escala-txt"><span>importa</span><span>equilibrada</span><span>exporta</span></div>`;
  else if (estado.modo === "carbono")
    escala = `<h3>Carbono de su generación <small>(estimado)</small></h3>
      <span class="escala" style="background:linear-gradient(90deg,${css("--co2-bajo")},${css("--co2-alto")})"></span>
      <div class="escala-txt"><span>0</span><span>${G_CO2_TERMICO} gCO₂/kWh</span></div>`;
  else
    escala = `<h3>Abastece a ${esc(nombreDe(estado.sel ?? 426))}</h3>
      <span class="escala" style="background:linear-gradient(90deg,${n},${css("--acento")})"></span>
      <div class="escala-txt"><span>nada</span><span>mucho</span></div>`;
  L.innerHTML = escala + `
    <div class="ley-fila"><i class="ley-linea"></i>flujo estimado entre regiones (ancho ∝ MW)</div>
    <div class="ley-fila"><i class="ley-torta"></i>generación de la región (área ∝ MW)</div>
    <div class="ley-tipos">${TIPOS.map((t) => `<span style="--c:var(${t.c})">${t.n}</span>`).join("")}</div>`;
}

function filasMix(partes, total) {
  return `<div class="mixfilas">${partes.map((p) => `
    <div class="mf"><span class="mf-n"><i style="background:var(${p.c})"></i>${p.n}</span>
      <span class="mf-b"><i style="width:${total > 0 ? (100 * p.v) / total : 0}%;background:var(${p.c})"></i></span>
      <span class="mf-v">${fmt(p.v)} MW</span><span class="mf-p">${total > 0 ? pct(p.v / total) : "–"}</span></div>`).join("")}</div>`;
}

function dibujarPais() {
  const { nac } = estado.calc;
  $("#kDem").textContent = fmt(nac.dem);
  $("#kGen").textContent = fmt(nac.total);
  $("#kCo2").textContent = fmt(nac.co2);
  const partes = [...TIPOS.map((t) => ({ n: t.n, c: t.c, v: nac[t.k] })), { n: "Importación", c: "--importacion", v: nac.importacion }]
    .sort((a, b) => b.v - a.v);
  $("#mixNac").innerHTML = filasMix(partes, nac.total) +
    `<p class="pista">${fmt(nac.noAsignado)} MW de la generación nacional no figuran en ninguna región.</p>`;
}

function dibujarRegion() {
  const { calc } = estado;
  if (estado.sel == null) {
    $("#regTitulo").textContent = "Elegí una región";
    $("#regDetalle").innerHTML = `<p class="pista">Tocá una región del mapa para ver una estimación de dónde viene su electricidad.</p>`;
    return;
  }
  const i = calc.R.findIndex((r) => r.id === estado.sel), r = calc.R[i];
  $("#regTitulo").textContent = r.nombre;
  const o = calc.origen[i];
  const origenes = calc.R.map((x, k) => ({ n: x.nombre, v: o.porRegion[k], propia: k === i }))
    .concat([{ n: "Sin ubicar (importación y no asignado)", v: o.mix.sinUbicar, gris: true }])
    .filter((x) => x.v > 0.005).sort((a, b) => b.v - a.v);
  const consumo = [...TIPOS.map((t) => ({ n: t.n, c: t.c, v: o.mix[t.k] })), { n: "Sin ubicar", c: "--sinubicar", v: o.mix.sinUbicar }];
  $("#regDetalle").innerHTML = `
    <div class="kpis kpis3">
      <div><span class="kpi-v">${fmt(r.dem)}</span><span class="kpi-l">MW de demanda</span></div>
      <div><span class="kpi-v">${fmt(r.gen)}</span><span class="kpi-l">MW generados</span></div>
      <div><span class="kpi-v ${r.neto >= 0 ? "pos" : "neg"}">${fmt(Math.abs(r.neto))}</span><span class="kpi-l">MW que ${r.neto >= 0 ? "exporta" : "importa"}</span></div>
    </div>
    <p class="pista">${r.temp == null ? "" : `Temperatura: ${r.temp.toLocaleString("es-AR")} °C · `}Carbono de su generación: ${fmt(r.co2)} gCO₂/kWh</p>
    <h3>De dónde viene su electricidad <small>(estimado)</small></h3>
    <div class="origenes">${origenes.map((x) => `
      <div class="mf"><span class="mf-n">${esc(x.n)}${x.propia ? " (propia)" : ""}</span>
        <span class="mf-b"><i style="width:${100 * x.v}%;background:var(${x.gris ? "--sinubicar" : "--acento"})"></i></span>
        <span class="mf-p">${pct(x.v)}</span></div>`).join("")}</div>
    <h3>Qué tipo de energía consume <small>(estimado)</small></h3>
    <div class="barra-apilada">${consumo.filter((p) => p.v > 0).map((p) => `<i style="width:${100 * p.v}%;background:var(${p.c})" title="${p.n} ${pct(p.v)}"></i>`).join("")}</div>
    <div class="ley-tipos">${consumo.map((p) => `<span style="--c:var(${p.c})">${p.n} ${pct(p.v)}</span>`).join("")}</div>
    <h3>Lo que genera la región</h3>
    ${filasMix(TIPOS.map((t) => ({ n: t.n, c: t.c, v: r[t.k] })), r.gen)}`;
}

function dibujarFlujos() {
  const regs = estado.geo.regiones;
  const fs = [...estado.calc.flujos].sort((a, b) => b.mw - a.mw);
  const max = Math.max(...fs.map((f) => f.mw), 1);
  $("#listaFlujos").innerHTML = fs.map((f) => `
    <div class="mf"><span class="mf-n">${esc(regs[f.de].nombre)} → ${esc(regs[f.a].nombre)}</span>
      <span class="mf-b"><i style="width:${(100 * f.mw) / max}%;background:var(--flujo)"></i></span>
      <span class="mf-v">${fmt(f.mw)} MW</span></div>`).join("");
}

function tip(ev, html) {
  const t = $("#tooltip"), caja = $(".mapa-zona").getBoundingClientRect();
  t.innerHTML = html; t.hidden = false;
  const x = ev.clientX - caja.left + 14, y = ev.clientY - caja.top + 14;
  t.style.left = Math.min(x, caja.width - t.offsetWidth - 6) + "px";
  t.style.top = Math.min(y, caja.height - t.offsetHeight - 6) + "px";
}
function ocultarTip() { $("#tooltip").hidden = true; }
function tipRegion(ev, id) {
  const r = estado.calc?.R.find((x) => x.id === id);
  if (!r) return;
  tip(ev, `<strong>${esc(r.nombre)}</strong><br>Genera ${fmt(r.gen)} MW · Consume ${fmt(r.dem)} MW<br>${r.neto >= 0 ? "Exporta" : "Importa"} ${fmt(Math.abs(r.neto))} MW`);
}

function seleccionar(id) { estado.sel = estado.sel === id ? null : id; dibujar(); }

function irA(idx) {
  idx = Math.max(0, Math.min(idx, estado.claves.length - 1));
  estado.idx = idx;
  estado.enUltima = idx === estado.claves.length - 1;
  estado.calc = calcular(estado.claves[idx]);
  dibujar();
}

function aviso(txt) { const a = $("#aviso"); a.hidden = !txt; a.textContent = txt || ""; }

let reintento = null;
async function cargar() {
  clearTimeout(reintento);
  let crudo, listo, motivo = "";
  try {
    crudo = await cargarEnVivo();
    listo = indexar(crudo);
    if (!listo.claves.length) motivo = "todavía no hay una hora con datos de todas las regiones";
  } catch (e) {
    motivo = String(e.message || e);
    console.error("Monitor de Energía:", e.fallas || e);
  }
  if (motivo) {
    const k = estado.calc?.k;
    aviso(k
      ? `No se pudieron actualizar los datos de CAMMESA (${motivo}). Se siguen mostrando los datos reales de las ${k.slice(11, 16)}. Reintentando en 1 minuto.`
      : `No se pudieron leer los datos de CAMMESA (${motivo}). Reintentando en 1 minuto.`);
    document.body.classList.toggle("sin-datos", !k);
    reintento = setTimeout(() => cargar().catch(console.error), 60 * 1000);
    return;
  }
  aviso("");
  document.body.classList.remove("sin-datos");
  const seguir = estado.enUltima || !estado.claves.length;
  estado.datos = listo; estado.claves = listo.claves;
  irA(seguir ? estado.claves.length - 1 : estado.idx);
}

async function iniciar() {
  estado.geo = await (await fetch("datos/regiones.json?v=2026112402")).json();
  armarMapa();
  activarArrastre();
  document.querySelectorAll('input[name="modo"]').forEach((b) => b.addEventListener("change", () => { estado.modo = b.value; dibujar(); }));
  $("#capaBurbujas").addEventListener("change", (e) => { estado.capas.burbujas = e.target.checked; dibujar(); });
  $("#capaValores").addEventListener("change", (e) => { estado.capas.valores = e.target.checked; dibujar(); });
  $("#atras").addEventListener("click", () => irA(estado.idx - 1));
  $("#adelante").addEventListener("click", () => irA(estado.idx + 1));
  $("#vivo").addEventListener("click", () => irA(estado.claves.length - 1));
  $("#zMas").addEventListener("click", () => zoom(1 / 1.4));
  $("#zMenos").addEventListener("click", () => zoom(1.4));
  $("#zAjustar").addEventListener("click", ajustarVista);
  addEventListener("resize", () => ajustarVista());
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", dibujar);
  document.body.classList.add("sin-datos");
  aviso("Leyendo los datos de CAMMESA…");
  await cargar();
  setInterval(() => cargar().catch(console.error), ACTUALIZAR_MIN * 60 * 1000);
}

iniciar().catch((e) => { console.error(e); aviso("No se pudo iniciar la página: " + e.message); });
