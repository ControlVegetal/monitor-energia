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

const estado = { geo: null, datos: null, claves: [], idx: 0, modo: "balance", sel: 426, calc: null, enUltima: true };
const $ = (s) => document.querySelector(s);
const fmt = (v) => (v == null || !isFinite(v) ? "–" : Math.round(v).toLocaleString("es-AR"));
const pct = (v) => (isFinite(v) ? Math.round(v * 100) + "%" : "–");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

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

function hex(c) {
  c = c.replace("#", ""); if (c.length === 3) c = [...c].map((x) => x + x).join("");
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
}
function mezcla(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const A = hex(a), B = hex(b);
  return "rgb(" + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",") + ")";
}

function armarMapa() {
  const svg = $("#mapa");
  svg.setAttribute("viewBox", estado.geo.viewBox.join(" "));
  svg.replaceChildren();
  const gR = el("g"), gF = el("g"), gN = el("g");
  for (const s of estado.geo.sinRed) {
    const p = el("path", { d: s.d, class: "sinred" });
    p.addEventListener("mousemove", (ev) => tip(ev, `<strong>${s.nombre}</strong>`));
    p.addEventListener("mouseleave", () => ($("#tooltip").hidden = true));
    gR.append(p);
  }
  for (const r of estado.geo.regiones) {
    const p = el("path", { d: r.d, class: "region", "data-id": r.id, tabindex: 0, role: "button", "aria-label": r.nombre });
    p.addEventListener("click", () => seleccionar(r.id));
    p.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); seleccionar(r.id); } });
    p.addEventListener("mousemove", (ev) => tipRegion(ev, r.id));
    p.addEventListener("mouseleave", () => ($("#tooltip").hidden = true));
    gR.append(p);
  }
  gF.id = "flujos"; gN.id = "nodos";
  svg.append(gR, gF, gN);
}

function colorRegion(r, i) {
  const { calc, modo } = estado;
  const neutro = css("--neutro");
  if (modo === "balance") {
    const max = Math.max(...calc.R.map((x) => Math.abs(x.neto)), 1);
    return r.neto >= 0 ? mezcla(neutro, css("--exporta"), r.neto / max) : mezcla(neutro, css("--importa"), -r.neto / max);
  }
  if (modo === "carbono") return r.co2 == null ? neutro : mezcla(neutro, css("--termico"), r.co2 / G_CO2_TERMICO);
  const sel = calc.R.findIndex((x) => x.id === estado.sel);
  const share = calc.origen[sel].porRegion[i];
  const max = Math.max(...calc.origen[sel].porRegion, 0.01);
  return mezcla(neutro, css("--acento"), share / max);
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
    const w = Math.min(1.5 + f.mw / 220, 14);
    const ln = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "flujo", "stroke-width": w });
    ln.addEventListener("mousemove", (ev) => tip(ev, `<strong>${a.nombre} → ${b.nombre}</strong><br>${fmt(f.mw)} MW (estimado)`));
    ln.addEventListener("mouseleave", () => ($("#tooltip").hidden = true));
    gF.append(ln);
    if (f.mw >= 150) {
      const t = el("text", { x: (a.x + b.x) / 2 + 6, y: (a.y + b.y) / 2 - 4, class: "etq-mw" });
      t.textContent = fmt(f.mw);
      gF.append(t);
    }
  }

  const gN = $("#nodos"); gN.replaceChildren();
  calc.R.forEach((r, i) => {
    const g = regs[i];
    gN.append(el("circle", { cx: g.x, cy: g.y, r: 3 + Math.sqrt(r.gen) / 7, class: "nodo", "fill-opacity": 0.85 }));
    const t = el("text", { x: g.x + 8 + Math.sqrt(r.gen) / 7, y: g.y + 4, class: "etq" });
    t.textContent = g.codigo;
    gN.append(t);
  });

  dibujarLeyenda();
  dibujarPais();
  dibujarRegion();
  dibujarTabla();
  $("#horaTxt").textContent = calc.k.slice(11, 16) + (estado.enUltima ? " (último dato completo)" : "");
  const [a, m, d] = calc.k.slice(0, 10).split("-");
  $("#fechaTxt").textContent = `${d}/${m}/${a} ${calc.k.slice(11, 16)}`;
}

function dibujarLeyenda() {
  const n = css("--neutro"), L = $("#leyenda");
  const grad = (c1, c2) => `<span class="escala" style="background:linear-gradient(90deg,${c1},${c2})"></span>`;
  if (estado.modo === "balance")
    L.innerHTML = `<span>Importa</span><span class="escala" style="background:linear-gradient(90deg,${css("--importa")},${n},${css("--exporta")})"></span><span>Exporta</span><span>· Líneas: flujo estimado (MW) · Círculos: generación</span>`;
  else if (estado.modo === "carbono")
    L.innerHTML = `<span>0</span>${grad(n, css("--termico"))}<span>${G_CO2_TERMICO} gCO₂/kWh</span><span>· estimado por la parte térmica</span>`;
  else {
    const r = estado.geo.regiones.find((x) => x.id === estado.sel);
    L.innerHTML = `<span>0%</span>${grad(n, css("--acento"))}<span>más aporte</span><span>· Qué parte de lo que llega a <strong>${r.nombre}</strong> viene de cada región</span>`;
  }
}

function mixHTML(partes, total) {
  const bar = partes.filter((p) => p.v > 0).map((p) => `<div style="width:${(100 * p.v) / total}%;background:var(${p.c})" title="${p.n}: ${fmt(p.v)} MW"></div>`).join("");
  const ley = partes.map((p) => `<span style="--c:var(${p.c})">${p.n} ${fmt(p.v)} MW (${pct(p.v / total)})</span>`).join("");
  return { bar, ley };
}

function dibujarPais() {
  const { nac } = estado.calc;
  $("#kGen").textContent = fmt(nac.total);
  $("#kDem").textContent = fmt(nac.dem);
  $("#kImp").textContent = fmt(nac.importacion);
  $("#kCo2").textContent = fmt(nac.co2);
  const partes = [...TIPOS.map((t) => ({ n: t.n, c: t.c, v: nac[t.k] })), { n: "Importación", c: "--importacion", v: nac.importacion }];
  const m = mixHTML(partes, nac.total);
  $("#mixNac").innerHTML = m.bar;
  $("#mixNacLeyenda").innerHTML = m.ley + `<span style="--c:var(--sinubicar)">De la generación, ${fmt(nac.noAsignado)} MW no figuran en ninguna región</span>`;
}

function dibujarRegion() {
  const { calc } = estado;
  const i = calc.R.findIndex((r) => r.id === estado.sel), r = calc.R[i];
  $("#regTitulo").textContent = r.nombre;
  $("#regPista").hidden = true;
  const partes = TIPOS.map((t) => ({ n: t.n, c: t.c, v: r[t.k] }));
  const m = mixHTML(partes, Math.max(r.gen, 1));
  const o = calc.origen[i];
  const origenes = calc.R.map((x, k) => ({ n: x.nombre, v: o.porRegion[k] })).concat([{ n: "Sin ubicar (importación y no asignado)", v: o.mix.sinUbicar }]).filter((x) => x.v > 0.005).sort((a, b) => b.v - a.v);
  const max = Math.max(...origenes.map((x) => x.v), 0.01);
  const consumo = [...TIPOS.map((t) => ({ n: t.n, c: t.c, v: o.mix[t.k] })), { n: "Sin ubicar", c: "--sinubicar", v: o.mix.sinUbicar }];
  const mc = mixHTML(consumo.map((p) => ({ ...p, v: p.v * 100 })), 100);
  $("#regDetalle").innerHTML = `
    <div class="filas">
      <span>Genera</span><span>${fmt(r.gen)} MW</span>
      <span>Consume</span><span>${fmt(r.dem)} MW</span>
      <span>${r.neto >= 0 ? "Exporta" : "Importa"} (neto)</span><span class="${r.neto >= 0 ? "pos" : "neg"}">${fmt(Math.abs(r.neto))} MW</span>
      <span>Temperatura</span><span>${r.temp == null || !isFinite(r.temp) ? "–" : r.temp.toLocaleString("es-AR") + " °C"}</span>
      <span>Carbono de su generación</span><span>${fmt(r.co2)} gCO₂/kWh</span>
    </div>
    <div class="pista" style="margin:0 0 4px">Lo que genera</div>
    <div class="mix">${m.bar}</div><div class="mix-leyenda">${m.ley}</div>
    <div class="pista" style="margin:12px 0 4px">De dónde viene lo que consume (estimado)</div>
    <div class="barras">${origenes.map((x) => `<div class="barra"><span>${x.n}</span><i style="width:${(100 * x.v) / max}%"></i><b>${pct(x.v)}</b></div>`).join("")}</div>
    <div class="pista" style="margin:12px 0 4px">Mix de lo que consume (estimado)</div>
    <div class="mix">${mc.bar}</div>
    <div class="mix-leyenda">${consumo.map((p) => `<span style="--c:var(${p.c})">${p.n} ${pct(p.v)}</span>`).join("")}</div>`;
}

function dibujarTabla() {
  const tb = $("#tabla tbody");
  tb.innerHTML = [...estado.calc.R].sort((a, b) => b.dem - a.dem).map((r) =>
    `<tr data-id="${r.id}"><td>${r.nombre}</td><td>${fmt(r.gen)}</td><td>${fmt(r.dem)}</td><td class="${r.neto >= 0 ? "pos" : "neg"}">${r.neto >= 0 ? "+" : "−"}${fmt(Math.abs(r.neto))}</td></tr>`
  ).join("");
  tb.querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => seleccionar(Number(tr.dataset.id))));
}

function tip(ev, html) {
  const t = $("#tooltip"), caja = $(".mapa-cont").getBoundingClientRect();
  t.innerHTML = html; t.hidden = false;
  const x = ev.clientX - caja.left + 12, y = ev.clientY - caja.top + 12;
  t.style.left = Math.min(x, caja.width - t.offsetWidth - 4) + "px";
  t.style.top = Math.min(y, caja.height - t.offsetHeight - 4) + "px";
}
function tipRegion(ev, id) {
  const r = estado.calc?.R.find((x) => x.id === id);
  if (!r) return;
  tip(ev, `<strong>${r.nombre}</strong><br>Genera ${fmt(r.gen)} MW · Consume ${fmt(r.dem)} MW<br>${r.neto >= 0 ? "Exporta" : "Importa"} ${fmt(Math.abs(r.neto))} MW`);
}

function seleccionar(id) { estado.sel = id; dibujar(); }

function irA(idx) {
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
  const s = $("#horaSel");
  s.max = estado.claves.length - 1;
  const idx = seguir ? estado.claves.length - 1 : Math.min(estado.idx, estado.claves.length - 1);
  s.value = idx;
  irA(idx);
}

async function iniciar() {
  estado.geo = await (await fetch("datos/regiones.json")).json();
  armarMapa();
  document.querySelectorAll(".modos button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".modos button").forEach((x) => x.classList.toggle("activo", x === b));
    estado.modo = b.dataset.modo; dibujar();
  }));
  $("#horaSel").addEventListener("input", (e) => irA(Number(e.target.value)));
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", dibujar);
  document.body.classList.add("sin-datos");
  aviso("Leyendo los datos de CAMMESA…");
  await cargar();
  setInterval(() => cargar().catch(console.error), ACTUALIZAR_MIN * 60 * 1000);
}

iniciar().catch((e) => { console.error(e); aviso("No se pudo iniciar la página: " + e.message); });
