// Strommonitor Deutschland: statische Seite. Die Daten lädt alle 15 Minuten ein GitHub-Actions-Job
// (de/herramientas/actualizar_datos.py) von SMARD und Energy-Charts und legt sie im Zweig "datos-de" ab.
"use strict";

const DATOS = "https://raw.githubusercontent.com/ControlVegetal/monitor-energia/datos-de/de/actual.json";
const VERSION = "2026112402";
const ACTUALIZAR_MIN = 5;
const TZ = "Europe/Berlin";

// Energieträger (gleiche Gruppen in SMARD und Energy-Charts). co2 = gCO2/kWh (feste Schätzung)
const TIPOS = [
  { k: "braunkohle", n: "Braunkohle", co2: 1100 },
  { k: "steinkohle", n: "Steinkohle", co2: 850 },
  { k: "erdgas", n: "Erdgas", co2: 400 },
  { k: "sonst_konv", n: "Sonstige konventionelle", co2: 650 },
  { k: "kernenergie", n: "Kernenergie", co2: 0 },
  { k: "biomasse", n: "Biomasse", co2: 0, ee: true },
  { k: "wasser", n: "Wasserkraft", co2: 0, ee: true },
  { k: "wind_on", n: "Wind an Land", co2: 0, ee: true },
  { k: "wind_off", n: "Wind auf See", co2: 0, ee: true },
  { k: "solar", n: "Photovoltaik", co2: 0, ee: true },
  { k: "sonst_ee", n: "Sonstige erneuerbare", co2: 0, ee: true },
  { k: "pumpspeicher", n: "Pumpspeicher", co2: 0 },
].map((t) => ({ ...t, c: "--" + t.k }));
const CO2_MAX = 800; // Skala der Karte

// Vereinfachtes Netz zwischen den Regelzonen. c = relatives Gewicht (höher = stärkere Verbindung), ungefähr.
const KORRIDORE = [["50HZ", "TEN", 4], ["TEN", "AMP", 4], ["TEN", "TBW", 2], ["AMP", "TBW", 3]];
// An welche Regelzonen jedes Nachbarland grenzt (Anteile, ungefähr nach Kuppelleitungen)
const GRENZEN = {
  DK: { TEN: 0.75, "50HZ": 0.25 }, NL: { AMP: 0.7, TEN: 0.3 }, BE: { AMP: 1 }, LU: { AMP: 1 },
  FR: { AMP: 0.5, TBW: 0.5 }, CH: { TBW: 0.8, AMP: 0.2 }, AT: { TEN: 0.7, TBW: 0.3 }, CZ: { "50HZ": 0.5, TEN: 0.5 },
  PL: { "50HZ": 1 }, SE: { TEN: 1 }, NO: { TEN: 1 },
};

const estado = { geo: null, d: null, claves: [], idx: 0, modo: "balance", sel: null, capas: { burbujas: true, grenzen: true, valores: true }, calc: null, enUltima: true };
const $ = (s) => document.querySelector(s);
const fmt = (v) => (v == null || !isFinite(v) ? "–" : Math.round(v).toLocaleString("de-DE"));
const fmt1 = (v) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (v) => (isFinite(v) ? Math.round(v * 100) + " %" : "–");
const COLORES = { "--neutro": "#f7f6f2", "--exporta": "#e0473e", "--importa": "#3a76d8", "--acento": "#2a78d6", "--co2-bajo": "#e9f4ea", "--co2-alto": "#5b3b24" };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || COLORES[v] || "#999999";
const pos0 = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };

// Zeiten in deutscher Ortszeit
const fHora = (ms) => new Date(ms).toLocaleTimeString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fDia = (ms) => new Date(ms).toLocaleDateString("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const diaClave = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
const horaNum = (ms) => Number(new Date(ms).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }));
function nombreDia(ms) {
  const hoy = diaClave(Date.now()), d = diaClave(ms);
  if (d === hoy) return "heute";
  if (d === diaClave(Date.now() + 864e5)) return "morgen";
  if (d === diaClave(Date.now() - 864e5)) return "gestern";
  return fDia(ms);
}

// ---------- Daten ----------
async function bajar() {
  const t = Math.floor(Date.now() / 60000); // pro Minute neue URL, damit kein alter Stand aus dem Cache kommt
  let r;
  try { r = await fetch(`${DATOS}?t=${t}`, { cache: "no-store" }); }
  catch { throw new Error("keine Verbindung zum Datenspeicher"); }
  if (!r.ok) throw new Error("der Datenspeicher antwortete mit HTTP " + r.status);
  try { return await r.json(); } catch { throw new Error("die Datei ist kein gültiges JSON"); }
}

function preparar(d) {
  const z = d.regelzonen, g = d.grenzen;
  if (!z || !z.zeiten?.length) throw new Error("keine Daten der Regelzonen");
  const gi = new Map((g?.zeiten || []).map((t, i) => [t, i]));
  // nur Zeitpunkte, für die es auch Grenzflüsse gibt
  const claves = z.zeiten.map((t, i) => ({ t, i, j: gi.get(t) })).filter((x) => x.j != null && Object.values(g.laender).some((v) => v[x.j] != null));
  if (!claves.length) throw new Error("keine gemeinsamen Zeitpunkte von Regelzonen und Grenzflüssen");
  return claves;
}

// ---------- Berechnung ----------
function resolver(A, b) { // Gauß-Elimination mit Pivotsuche
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

const co2De = (o, gen) => (gen > 0 ? TIPOS.reduce((s, t) => s + t.co2 * (o[t.k] || 0), 0) / gen : null);

function calcular(c) {
  const { d } = estado, Z = estado.geo.zonas, n = Z.length;
  const pos = Object.fromEntries(Z.map((z, i) => [z.codigo, i]));
  const R = Z.map((z) => {
    const s = d.regelzonen.zonen[z.codigo], o = { codigo: z.codigo, nombre: z.nombre };
    for (const t of TIPOS) o[t.k] = pos0(s[t.k]?.[c.i]);
    o.gen = TIPOS.reduce((a, t) => a + o[t.k], 0);
    o.dem = pos0(s.last[c.i]) + pos0(s.pump_verbrauch?.[c.i]);
    o.co2 = co2De(o, o.gen);
    o.imp = 0; o.exp = 0;
    return o;
  });
  // Grenzflüsse (+ = Import nach Deutschland), anteilig auf die Zonen verteilt
  const paises = estado.geo.paises.map((p) => ({ ...p, mw: Number(d.grenzen.laender[p.codigo]?.[c.j]) || 0 }));
  const grenz = [];
  for (const p of paises) for (const [zc, w] of Object.entries(GRENZEN[p.codigo] || {})) {
    const i = pos[zc], mw = p.mw * w;
    if (mw >= 0) R[i].imp += mw; else R[i].exp -= mw;
    grenz.push({ pais: p, zona: i, mw });
  }
  const nac = { imp: paises.reduce((s, p) => s + p.mw, 0) };
  const sumGen = R.reduce((s, r) => s + r.gen, 0), sumDem = R.reduce((s, r) => s + r.dem, 0);
  // Was zum Ausgleich fehlt (oder übrig ist), wird nach Verbrauch verteilt: „nicht zugeordnet“
  const resto = sumDem - sumGen - nac.imp;
  nac.resto = resto; nac.gen = sumGen; nac.dem = sumDem;
  R.forEach((r) => {
    const v = sumDem > 0 ? (resto * r.dem) / sumDem : 0;
    r.sinUbicar = Math.max(v, 0);
    r.fuente = r.gen + r.imp + r.sinUbicar;
    r.carga = r.dem + r.exp + Math.max(-v, 0);
    r.iny = r.fuente - r.carga; // Summe 0
    r.neto = r.gen - r.dem;
  });

  // DC-Lastfluss: B·θ = P, TenneT als Referenz
  const ref = pos.TEN;
  const B = Array.from({ length: n }, () => Array(n).fill(0));
  const lineas = KORRIDORE.map(([a, b, k]) => {
    const i = pos[a], j = pos[b], y = k / Math.hypot(Z[i].x - Z[j].x, Z[i].y - Z[j].y);
    B[i][i] += y; B[j][j] += y; B[i][j] -= y; B[j][i] -= y;
    return { i, j, y };
  });
  const otros = [...Array(n).keys()].filter((i) => i !== ref);
  const th = resolver(otros.map((i) => otros.map((j) => B[i][j])), otros.map((i) => R[i].iny));
  const theta = Array(n).fill(0);
  otros.forEach((i, q) => (theta[i] = th[q]));
  const flujos = lineas.map(({ i, j, y }) => { const f = (theta[i] - theta[j]) * y; return f >= 0 ? { de: i, a: j, mw: f } : { de: j, a: i, mw: -f }; });

  // Proportionale Verfolgung (Bialek): woher kommt der Strom jeder Zone
  const P = R.map((r, i) => r.fuente + flujos.filter((f) => f.a === i).reduce((s, f) => s + f.mw, 0));
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (const f of flujos) if (P[f.de] > 0) A[f.a][f.de] -= f.mw / P[f.de];
  const At = A[0].map((_, k) => A.map((fila) => fila[k]));
  const origen = R.map((r, i) => {
    const e = Array(n).fill(0); e[i] = 1;
    const fila = resolver(At, e);
    const porFuente = R.map((rk, kk) => (P[i] > 0 ? (fila[kk] * rk.fuente) / P[i] : 0));
    const porRegion = R.map((rk, kk) => (rk.fuente > 0 ? (porFuente[kk] * rk.gen) / rk.fuente : 0));
    const mix = { import: 0, sinUbicar: 0 };
    TIPOS.forEach((t) => (mix[t.k] = 0));
    R.forEach((rk, kk) => {
      if (rk.fuente <= 0) return;
      const q = porFuente[kk] / rk.fuente;
      TIPOS.forEach((t) => (mix[t.k] += q * rk[t.k]));
      mix.import += q * rk.imp;
      mix.sinUbicar += q * rk.sinUbicar;
    });
    return { porRegion, mix };
  });
  return { c, R, nac, flujos, grenz, paises, origen };
}

// ---------- Zeichnen ----------
const SVG = "http://www.w3.org/2000/svg";
const el = (tag, at = {}) => { const e = document.createElementNS(SVG, tag); for (const [a, v] of Object.entries(at)) e.setAttribute(a, v); return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
function hex(h) { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((x) => x + x).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function mezcla(a, b, t) { t = Math.max(0, Math.min(1, t)); const A = hex(a), B = hex(b); return "rgb(" + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",") + ")"; }
const nombreDe = (cod) => estado.geo.zonas.find((z) => z.codigo === cod)?.nombre || "";

// Zoom und Verschieben (viewBox)
const vista = { x: 0, y: 0, w: 1, h: 1 };
function ajustarVista() {
  const [x, y, w, h] = estado.geo.vista, r = $("#mapa").getBoundingClientRect(), asp = r.width / Math.max(r.height, 1);
  let W = w * 1.04, H = h * 1.04;
  if (W / H < asp) W = H * asp; else H = W / asp;
  Object.assign(vista, { x: x + w / 2 - W / 2, y: y + h / 2 - H / 2, w: W, h: H });
  aplicarVista();
}
function aplicarVista() { $("#mapa").setAttribute("viewBox", `${vista.x} ${vista.y} ${vista.w} ${vista.h}`); }
function zoom(f, cx, cy) {
  const r = $("#mapa").getBoundingClientRect();
  const px = cx == null ? 0.5 : (cx - r.left) / r.width, py = cy == null ? 0.5 : (cy - r.top) / r.height;
  const max = estado.geo.vista[2] * 3, min = estado.geo.vista[2] / 8;
  const w = Math.max(min, Math.min(max, vista.w * f)), k = w / vista.w;
  vista.x += (vista.w - w) * px; vista.y += (vista.h - vista.h * k) * py; vista.w = w; vista.h *= k;
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
const clicOk = () => Date.now() - (estado.arrastro || 0) > 200;

function armarMapa() {
  const svg = $("#mapa"), [, , W, H] = estado.geo.viewBox;
  svg.replaceChildren();
  svg.append(el("rect", { x: -W, y: -H, width: W * 3, height: H * 3, class: "mar" }));
  const gV = el("g"), gR = el("g"), gG = el("g", { id: "grenzen" }), gF = el("g", { id: "flujos" }), gB = el("g", { id: "burbujas" }), gE = el("g", { id: "etiquetas" });
  for (const v of estado.geo.vecinos) gV.append(el("path", { d: v.d, class: "pais" }));
  for (const z of estado.geo.zonas) {
    const p = el("path", { d: z.d, class: "region", "data-cod": z.codigo, tabindex: 0, role: "button", "aria-label": z.nombre });
    p.addEventListener("click", () => { if (clicOk()) seleccionar(z.codigo); });
    p.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); seleccionar(z.codigo); } });
    p.addEventListener("mousemove", (ev) => tipZona(ev, z.codigo));
    p.addEventListener("mouseleave", ocultarTip);
    gR.append(p);
  }
  svg.append(gV, gR, gG, gF, gB, gE);
  ajustarVista();
}

function colorZona(r, i) {
  const { calc, modo } = estado, neutro = css("--neutro");
  if (modo === "balance") {
    const t = r.dem > 0 ? r.neto / r.dem : 0;
    return t >= 0 ? mezcla(neutro, css("--exporta"), t) : mezcla(neutro, css("--importa"), -t);
  }
  if (modo === "carbono") return r.co2 == null ? neutro : mezcla(css("--co2-bajo"), css("--co2-alto"), r.co2 / CO2_MAX);
  const sel = calc.R.findIndex((x) => x.codigo === (estado.sel ?? "AMP"));
  return mezcla(neutro, css("--acento"), Math.sqrt(calc.origen[sel].porRegion[i]));
}

function torta(cx, cy, rad, partes) {
  const g = el("g", { class: "torta" }), tot = partes.reduce((s, p) => s + p.v, 0);
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

function linea(g, a, b, mw, clase, titulo) {
  const w = Math.min(1.5 + mw / 600, 14);
  const ln = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "flujo " + clase, "stroke-width": w });
  ln.addEventListener("mousemove", (ev) => tip(ev, titulo));
  ln.addEventListener("mouseleave", ocultarTip);
  g.append(ln);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  g.append(el("path", { d: "M-1,-1L1,0L-1,1Z", class: "flecha " + clase, transform: `translate(${mx},${my}) rotate(${ang}) scale(${(w * 0.6 + 4).toFixed(1)})` }));
  if (estado.capas.valores && mw >= 100) {
    const t = el("text", { x: mx, y: my - w / 2 - 7, class: "etq-mw", "text-anchor": "middle" });
    t.textContent = fmt(mw);
    g.append(t);
  }
}

function dibujar() {
  const { calc } = estado;
  if (!calc) return;
  const Z = estado.geo.zonas;
  document.querySelectorAll(".region").forEach((p) => {
    const i = calc.R.findIndex((r) => r.codigo === p.dataset.cod);
    p.style.fill = colorZona(calc.R[i], i);
    p.classList.toggle("sel", p.dataset.cod === estado.sel);
  });

  const gG = $("#grenzen"); gG.replaceChildren();
  if (estado.capas.grenzen) {
    for (const p of calc.paises) {
      const partes = calc.grenz.filter((x) => x.pais.codigo === p.codigo);
      for (const x of partes) {
        const z = Z[x.zona], mw = Math.abs(x.mw);
        if (mw < 20) continue;
        const [a, b] = x.mw >= 0 ? [p, z] : [z, p];
        linea(gG, a, b, mw, "grenze", `<strong>${esc(a.nombre)} → ${esc(b.nombre)}</strong><br>${fmt(mw)} MW${partes.length > 1 ? ` (Anteil von ${fmt(Math.abs(p.mw))} MW gesamt)` : ""}`);
      }
      gG.append(el("circle", { cx: p.x, cy: p.y, r: 4, class: "land-nodo" }));
      const t = el("text", { x: p.x, y: p.y - 9, class: "land-etq", "text-anchor": "middle" });
      t.textContent = p.nombre;
      gG.append(t);
    }
  }

  const gF = $("#flujos"); gF.replaceChildren();
  for (const f of calc.flujos) {
    if (f.mw < 20) continue;
    const a = Z[f.de], b = Z[f.a];
    linea(gF, a, b, f.mw, "", `<strong>${esc(a.nombre)} → ${esc(b.nombre)}</strong><br>${fmt(f.mw)} MW (geschätzt)`);
  }

  const gB = $("#burbujas"), gE = $("#etiquetas"); gB.replaceChildren(); gE.replaceChildren();
  calc.R.forEach((r, i) => {
    const z = Z[i], rad = Math.sqrt(r.gen) / 5.2;
    const nodo = estado.capas.burbujas ? torta(z.x, z.y, rad, TIPOS.map((t) => ({ v: r[t.k], c: t.c }))) : el("circle", { cx: z.x, cy: z.y, r: 4, class: "nodo" });
    nodo.addEventListener("click", () => { if (clicOk()) seleccionar(r.codigo); });
    nodo.addEventListener("mousemove", (ev) => tipZona(ev, r.codigo));
    nodo.addEventListener("mouseleave", ocultarTip);
    gB.append(nodo);
    const t = el("text", { x: z.x, y: z.y + (estado.capas.burbujas ? rad : 3) + 4, class: "etq", "text-anchor": "middle", "dominant-baseline": "hanging" });
    t.textContent = z.nombre;
    gE.append(t);
  });

  dibujarLeyenda();
  dibujarZona();
  dibujarFlujos();
  dibujarHora();
  if (typeof dibujarAgro === "function") dibujarAgro();
}

function dibujarHora() {
  const t = estado.calc.c.t;
  $("#horaTxt").textContent = `Karte: ${fDia(t)} ${fHora(t)} Uhr` + (estado.enUltima ? " (neuester)" : "");
  $("#atras").disabled = estado.idx <= 0;
  $("#adelante").disabled = estado.enUltima;
  $("#vivo").classList.toggle("activo", estado.enUltima);
  $("#flujosHora").textContent = `(${fDia(t)} ${fHora(t)} Uhr)`;
}

function dibujarLeyenda() {
  const n = css("--neutro");
  let escala;
  if (estado.modo === "balance")
    escala = `<h3>Bilanz der Zone <small>(Saldo ÷ Verbrauch)</small></h3>
      <span class="escala" style="background:linear-gradient(90deg,${css("--importa")},${n},${css("--exporta")})"></span>
      <div class="escala-txt"><span>importiert</span><span>ausgeglichen</span><span>exportiert</span></div>`;
  else if (estado.modo === "carbono")
    escala = `<h3>CO₂ ihrer Erzeugung <small>(geschätzt)</small></h3>
      <span class="escala" style="background:linear-gradient(90deg,${css("--co2-bajo")},${css("--co2-alto")})"></span>
      <div class="escala-txt"><span>0</span><span>${fmt(CO2_MAX)} gCO₂/kWh</span></div>`;
  else
    escala = `<h3>Versorgt ${esc(nombreDe(estado.sel ?? "AMP"))}</h3>
      <span class="escala" style="background:linear-gradient(90deg,${n},${css("--acento")})"></span>
      <div class="escala-txt"><span>nichts</span><span>viel</span></div>`;
  const usados = TIPOS.filter((t) => estado.calc.R.some((r) => r[t.k] > 0));
  $("#leyenda").innerHTML = escala + `
    <div class="ley-fila"><i class="ley-linea"></i>geschätzter Fluss zwischen Zonen (Breite ∝ MW)</div>
    ${estado.capas.grenzen ? `<div class="ley-fila"><i class="ley-linea" style="background:var(--import)"></i>gemessener Fluss mit Nachbarland</div>` : ""}
    <div class="ley-fila"><i class="ley-torta"></i>Erzeugung der Zone (Fläche ∝ MW)</div>
    <div class="ley-tipos">${usados.map((t) => `<span style="--c:var(${t.c})">${t.n}</span>`).join("")}</div>`;
}

function filasMix(partes, total) {
  return `<div class="mixfilas">${partes.filter((p) => p.v > 0.5).map((p) => `
    <div class="mf"><span class="mf-n"><i style="background:var(${p.c})"></i>${p.n}</span>
      <span class="mf-b"><i style="width:${total > 0 ? (100 * p.v) / total : 0}%;background:var(${p.c})"></i></span>
      <span class="mf-v">${fmt(p.v)} MW</span><span class="mf-p">${total > 0 ? pct(p.v / total) : "–"}</span></div>`).join("")}</div>`;
}

function dibujarZona() {
  const { calc } = estado;
  if (estado.sel == null) {
    $("#regTitulo").textContent = "Regelzone wählen";
    $("#regDetalle").innerHTML = `<p class="pista">Tippen Sie auf eine Regelzone, um zu sehen, woher ihr Strom vermutlich kommt.</p>`;
    return;
  }
  const i = calc.R.findIndex((r) => r.codigo === estado.sel), r = calc.R[i], o = calc.origen[i];
  $("#regTitulo").textContent = r.nombre;
  const origenes = calc.R.map((x, k) => ({ n: x.nombre, v: o.porRegion[k], propia: k === i }))
    .concat([{ n: "Import aus Nachbarländern", v: o.mix.import, c: "--import" }, { n: "Nicht zugeordnet", v: o.mix.sinUbicar, c: "--sinubicar" }])
    .filter((x) => x.v > 0.005).sort((a, b) => b.v - a.v);
  const consumo = [...TIPOS.map((t) => ({ n: t.n, c: t.c, v: o.mix[t.k] })), { n: "Import", c: "--import", v: o.mix.import }, { n: "Nicht zugeordnet", c: "--sinubicar", v: o.mix.sinUbicar }].filter((p) => p.v > 0.005);
  const vecinos = calc.grenz.filter((x) => x.zona === i && Math.abs(x.mw) >= 1).sort((a, b) => Math.abs(b.mw) - Math.abs(a.mw));
  $("#regDetalle").innerHTML = `
    <div class="kpis kpis3">
      <div><span class="kpi-v">${fmt(r.dem)}</span><span class="kpi-l">MW Verbrauch</span></div>
      <div><span class="kpi-v">${fmt(r.gen)}</span><span class="kpi-l">MW Erzeugung</span></div>
      <div><span class="kpi-v ${r.neto >= 0 ? "pos" : "neg"}">${fmt(Math.abs(r.neto))}</span><span class="kpi-l">MW ${r.neto >= 0 ? "Überschuss" : "Bedarf von außen"}</span></div>
    </div>
    <p class="pista">CO₂ ihrer Erzeugung: ${fmt(r.co2)} gCO₂/kWh (geschätzt)</p>
    <h3>Woher ihr Strom kommt <small>(geschätzt)</small></h3>
    <div class="origenes">${origenes.map((x) => `
      <div class="mf"><span class="mf-n">${esc(x.n)}${x.propia ? " (eigene)" : ""}</span>
        <span class="mf-b"><i style="width:${100 * x.v}%;background:var(${x.c || "--acento"})"></i></span>
        <span class="mf-p">${pct(x.v)}</span></div>`).join("")}</div>
    <h3>Welche Energie sie verbraucht <small>(geschätzt)</small></h3>
    <div class="barra-apilada">${consumo.map((p) => `<i style="width:${100 * p.v}%;background:var(${p.c})" title="${p.n} ${pct(p.v)}"></i>`).join("")}</div>
    <div class="ley-tipos">${consumo.map((p) => `<span style="--c:var(${p.c})">${p.n} ${pct(p.v)}</span>`).join("")}</div>
    <h3>Was die Zone erzeugt</h3>
    ${filasMix(TIPOS.map((t) => ({ n: t.n, c: t.c, v: r[t.k] })).sort((a, b) => b.v - a.v), r.gen)}
    ${vecinos.length ? `<h3>Grenzflüsse <small>(Anteil dieser Zone, ungefähr)</small></h3>
      <div class="origenes">${vecinos.map((x) => `<div class="mf"><span class="mf-n">${esc(x.pais.nombre)}</span><span></span><span class="mf-v">${x.mw >= 0 ? "Import" : "Export"} ${fmt(Math.abs(x.mw))} MW</span></div>`).join("")}</div>` : ""}`;
}

function dibujarFlujos() {
  const Z = estado.geo.zonas, { calc } = estado;
  const internos = calc.flujos.map((f) => ({ n: `${Z[f.de].nombre} → ${Z[f.a].nombre}`, mw: f.mw, c: "--flujo" }));
  const externos = calc.paises.map((p) => ({ n: p.mw >= 0 ? `${p.nombre} → Deutschland` : `Deutschland → ${p.nombre}`, mw: Math.abs(p.mw), c: "--import" }));
  const todos = [...internos, ...externos].filter((x) => x.mw >= 10);
  const max = Math.max(...todos.map((x) => x.mw), 1);
  const fila = (x) => `<div class="mf"><span class="mf-n">${esc(x.n)}</span><span class="mf-b"><i style="width:${(100 * x.mw) / max}%;background:var(${x.c})"></i></span><span class="mf-v">${fmt(x.mw)} MW</span></div>`;
  const saldo = calc.nac.imp;
  $("#listaFlujos").innerHTML = `<h3>Zwischen Regelzonen <small>(geschätzt)</small></h3>${internos.sort((a, b) => b.mw - a.mw).map(fila).join("")}
    <h3>Mit Nachbarländern <small>(gemessen)</small></h3>${externos.sort((a, b) => b.mw - a.mw).map(fila).join("")}
    <p class="pista">Saldo: Deutschland ${saldo >= 0 ? "importiert" : "exportiert"} ${fmt(Math.abs(saldo))} MW. Nicht zugeordnet: ${fmt(Math.abs(calc.nac.resto))} MW.</p>`;
}

// ---------- Deutschland jetzt (Energy-Charts, aktueller als die Regelzonen) ----------
function precioEn(ms) {
  const p = estado.d.preis;
  if (!p?.zeiten?.length) return null;
  let v = null;
  for (let i = 0; i < p.zeiten.length && p.zeiten[i] <= ms; i++) v = p.werte[i];
  return v;
}
function dibujarJetzt() {
  const n = estado.d.deutschland;
  if (!n?.zeiten?.length) { $("#jetzt").innerHTML = `<p class="ohne">Keine aktuellen Daten verfügbar.</p>`; return; }
  const i = n.zeiten.length - 1, t = n.zeiten[i];
  const o = {}; TIPOS.forEach((x) => (o[x.k] = pos0(n[x.k]?.[i])));
  const gen = TIPOS.reduce((s, x) => s + o[x.k], 0), last = pos0(n.last?.[i]), handel = Number(n.handel?.[i]) || 0;
  const ee = TIPOS.filter((x) => x.ee).reduce((s, x) => s + o[x.k], 0);
  const p = precioEn(Date.now());
  $("#jetzt").innerHTML = `
    <div class="kpis kpis4">
      <div><span class="kpi-v">${fmt1(last / 1000)} GW</span><span class="kpi-l">Verbrauch (Netzlast)</span></div>
      <div><span class="kpi-v">${fmt1(gen / 1000)} GW</span><span class="kpi-l">Erzeugung, davon ${pct(ee / gen)} erneuerbar</span></div>
      <div><span class="kpi-v">${fmt(co2De(o, gen))}</span><span class="kpi-l">gCO₂/kWh (geschätzt)</span></div>
      <div><span class="kpi-v">${p == null ? "–" : fmt1(p / 10) + " ct"}</span><span class="kpi-l">pro kWh Börsenpreis jetzt${p == null ? "" : ` (${fmt(p)} €/MWh)`}</span></div>
    </div>
    ${filasMix(TIPOS.map((x) => ({ n: x.n, c: x.c, v: o[x.k] })).sort((a, b) => b.v - a.v), gen)}
    <p class="pista">Stand ${nombreDia(t)} ${fHora(t)} Uhr. Stromhandel mit dem Ausland: ${handel >= 0 ? "Import" : "Export"} ${fmt(Math.abs(handel))} MW.</p>`;
}

// Day-Ahead-Preis je Stunde (Mittel der Viertelstunden), heute und morgen
function dibujarPreis() {
  const p = estado.d.preis;
  if (!p?.zeiten?.length) { $("#preis").innerHTML = `<p class="ohne">Keine Preisdaten verfügbar.</p>`; return; }
  const hoy = diaClave(Date.now()), man = diaClave(Date.now() + 864e5);
  const horas = new Map();
  p.zeiten.forEach((t, i) => {
    const d = diaClave(t);
    if (d !== hoy && d !== man) return;
    const h0 = t - (t % 3600e3);
    const o = horas.get(h0) || { t: h0, s: 0, n: 0 };
    o.s += p.werte[i]; o.n++;
    horas.set(h0, o);
  });
  const H = [...horas.values()].sort((a, b) => a.t - b.t).map((o) => ({ t: o.t, v: o.s / o.n, dia: diaClave(o.t) }));
  if (!H.length) { $("#preis").innerHTML = `<p class="ohne">Keine Preisdaten für heute.</p>`; return; }
  const ahora = Date.now(), h0 = ahora - (ahora % 3600e3);
  const futuras = H.filter((x) => x.t >= h0);
  const baratas = new Set([...futuras].sort((a, b) => a.v - b.v).slice(0, 3).map((x) => x.t));
  const caras = new Set([...futuras].sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.t));
  const min = futuras.length ? futuras.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const max = futuras.length ? futuras.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const deHoy = H.filter((x) => x.dia === hoy), media = deHoy.length ? deHoy.reduce((s, x) => s + x.v, 0) / deHoy.length : null;
  const hayManana = H.some((x) => x.dia === man);
  const W = 12, alto = 70, vmin = Math.min(0, ...H.map((x) => x.v)), vmax = Math.max(...H.map((x) => x.v), 1);
  const y = (v) => alto - ((v - vmin) / (vmax - vmin)) * (alto - 6);
  const barras = H.map((x, k) => {
    const cls = ["preis-barra", baratas.has(x.t) ? "billig" : "", caras.has(x.t) ? "teuer" : "", x.t < h0 ? "vorbei" : ""].join(" ");
    const y0 = y(Math.max(x.v, 0)), y1 = y(Math.min(x.v, 0));
    return `<rect x="${k * W + 1}" y="${y0}" width="${W - 2}" height="${Math.max(y1 - y0, 1)}" rx="1.5" class="${cls}"><title>${nombreDia(x.t)} ${fHora(x.t)} Uhr · ${fmt1(x.v / 10)} ct/kWh</title></rect>`;
  }).join("");
  const kAhora = H.findIndex((x) => x.t === h0);
  const marca = kAhora >= 0 ? `<line x1="${kAhora * W + W / 2}" x2="${kAhora * W + W / 2}" y1="0" y2="${alto}" class="preis-jetzt"/>` : "";
  const ticks = H.map((x, k) => {
    const h = horaNum(x.t);
    if (h === 0) return `<text x="${k * W + 1}" y="${alto + 13}" class="tag">${nombreDia(x.t)}</text>`;
    return h % 6 === 0 ? `<text x="${k * W + W / 2}" y="${alto + 13}" text-anchor="middle">${h}</text>` : "";
  }).join("");
  const et = (x) => (x ? `${fHora(x.t)} Uhr <small>(${nombreDia(x.t)})</small>` : "–");
  $("#preis").innerHTML = `
    <div class="dia-datos">
      <div><span class="kpi-l">Günstigste Stunde ab jetzt</span><span class="kpi-v">${et(min)}</span><span class="kpi-l">${min ? fmt1(min.v / 10) + " ct/kWh" : ""}</span></div>
      <div><span class="kpi-l">Teuerste Stunde ab jetzt</span><span class="kpi-v">${et(max)}</span><span class="kpi-l">${max ? fmt1(max.v / 10) + " ct/kWh" : ""}</span></div>
    </div>
    <svg class="dia-graf" viewBox="0 0 ${H.length * W} ${alto + 16}" role="img" aria-label="Day-Ahead-Preis je Stunde">${barras}${marca}${ticks}</svg>
    <p class="pista">Grün: die 3 günstigsten Stunden ab jetzt, rot: die 3 teuersten. Durchschnitt heute: ${media == null ? "–" : fmt1(media / 10) + " ct/kWh"}. ${hayManana ? "" : "Die Preise für morgen erscheinen meist gegen 13 Uhr."} Großhandelspreis ohne Steuern, Netzentgelte und Abgaben.</p>`;
}

// Letzte 24 Stunden Deutschland (Energy-Charts), je Stunde
function dibujarDia() {
  const n = estado.d.deutschland;
  if (!n?.zeiten?.length) { $("#dia").innerHTML = `<p class="ohne">Keine Daten verfügbar.</p>`; return; }
  const ultima = n.zeiten[n.zeiten.length - 1], desde = ultima - (ultima % 3600e3) - 23 * 3600e3;
  const horas = new Map();
  n.zeiten.forEach((t, i) => {
    if (t < desde) return;
    const h0 = t - (t % 3600e3);
    const o = horas.get(h0) || { t: h0, n: 0, last: 0, ee: 0, co2: 0 };
    const x = {}; TIPOS.forEach((tp) => (x[tp.k] = pos0(n[tp.k]?.[i])));
    const gen = TIPOS.reduce((s, tp) => s + x[tp.k], 0);
    if (gen <= 0) return;
    o.n++; o.last += pos0(n.last?.[i]);
    o.ee += TIPOS.filter((tp) => tp.ee).reduce((s, tp) => s + x[tp.k], 0) / gen;
    o.co2 += co2De(x, gen);
    horas.set(h0, o);
  });
  const H = [...horas.values()].sort((a, b) => a.t - b.t).map((o) => ({ t: o.t, last: o.last / o.n, ee: o.ee / o.n, co2: o.co2 / o.n }));
  if (!H.length) { $("#dia").innerHTML = ""; return; }
  const mejor = (f) => H.reduce((a, b) => (f(b) < f(a) ? b : a));
  const menor = mejor((x) => x.last), mayor = mejor((x) => -x.last), masEE = mejor((x) => -x.ee), menosCo2 = mejor((x) => x.co2);
  const et = (x) => `${fHora(x.t)} Uhr${diaClave(x.t) !== diaClave(Date.now()) ? ` <small>(${nombreDia(x.t)})</small>` : ""}`;
  const W = 24, alto = 70, mx = Math.max(...H.map((x) => x.last)), mn = Math.min(...H.map((x) => x.last));
  const barras = H.map((x, k) => {
    const hb = 12 + ((x.last - mn) / Math.max(mx - mn, 1)) * (alto - 12);
    return `<rect x="${k * W + 2}" y="${alto - hb}" width="${W - 4}" height="${hb}" rx="2" class="dia-barra sin-mapa" style="--r:${x.ee}"><title>${nombreDia(x.t)} ${fHora(x.t)} Uhr · ${fmt1(x.last / 1000)} GW · ${pct(x.ee)} erneuerbar · ${fmt(x.co2)} gCO₂/kWh</title></rect>`;
  }).join("");
  const ticks = H.map((x, k) => (k % 4 === 0 || k === H.length - 1 ? `<text x="${k * W + W / 2}" y="${alto + 13}" text-anchor="middle">${horaNum(x.t)}</text>` : "")).join("");
  $("#dia").innerHTML = `
    <div class="dia-datos">
      <div><span class="kpi-l">Geringster Verbrauch</span><span class="kpi-v">${et(menor)}</span><span class="kpi-l">${fmt1(menor.last / 1000)} GW</span></div>
      <div><span class="kpi-l">Höchster Verbrauch</span><span class="kpi-v">${et(mayor)}</span><span class="kpi-l">${fmt1(mayor.last / 1000)} GW</span></div>
      <div><span class="kpi-l">Meiste Erneuerbare</span><span class="kpi-v">${et(masEE)}</span><span class="kpi-l">${pct(masEE.ee)} der Erzeugung</span></div>
      <div><span class="kpi-l">Wenigste CO₂</span><span class="kpi-v">${et(menosCo2)}</span><span class="kpi-l">${fmt(menosCo2.co2)} gCO₂/kWh</span></div>
    </div>
    <svg class="dia-graf" viewBox="0 0 ${H.length * W} ${alto + 16}" role="img" aria-label="Verbrauch je Stunde, letzte 24 Stunden">${barras}${ticks}</svg>
    <p class="pista">Verbrauch in Deutschland je Stunde. Je grüner, desto mehr erneuerbarer Strom.</p>`;
}

function tip(ev, html) {
  const t = $("#tooltip"), caja = $(".mapa-zona").getBoundingClientRect();
  t.innerHTML = html; t.hidden = false;
  t.style.left = Math.min(ev.clientX - caja.left + 14, caja.width - t.offsetWidth - 6) + "px";
  t.style.top = Math.min(ev.clientY - caja.top + 14, caja.height - t.offsetHeight - 6) + "px";
}
function ocultarTip() { $("#tooltip").hidden = true; }
function tipZona(ev, cod) {
  const r = estado.calc?.R.find((x) => x.codigo === cod);
  if (!r) return;
  tip(ev, `<strong>${esc(r.nombre)}</strong><br>Erzeugt ${fmt(r.gen)} MW · Verbraucht ${fmt(r.dem)} MW<br>${r.neto >= 0 ? "Überschuss" : "Bedarf"} ${fmt(Math.abs(r.neto))} MW`);
}
function seleccionar(cod) { estado.sel = estado.sel === cod ? null : cod; dibujar(); }

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
  let d, claves, motivo = "";
  try { d = await bajar(); claves = preparar(d); }
  catch (e) { motivo = String(e.message || e); console.error("Strommonitor:", e); }
  if (motivo) {
    const hay = !!estado.calc;
    aviso(hay ? `Die Daten konnten nicht aktualisiert werden (${motivo}). Es wird weiter der letzte echte Stand gezeigt. Neuer Versuch in 1 Minute.`
              : `Die Daten konnten nicht geladen werden (${motivo}). Neuer Versuch in 1 Minute.`);
    document.body.classList.toggle("sin-datos", !hay);
    reintento = setTimeout(() => cargar().catch(console.error), 60e3);
    return;
  }
  const edad = (Date.now() - Date.parse(d.erzeugt)) / 60e3;
  const fallas = Object.keys(d.fehler || {});
  aviso(edad > 90 ? `Hinweis: Die Daten wurden zuletzt ${nombreDia(Date.parse(d.erzeugt))} um ${fHora(Date.parse(d.erzeugt))} Uhr abgerufen.`
      : fallas.length ? `Hinweis: Eine Quelle war beim letzten Abruf nicht erreichbar (${fallas.join(", ")}); dort wird der vorherige Stand gezeigt.` : "");
  document.body.classList.remove("sin-datos");
  const seguir = estado.enUltima || !estado.claves.length;
  estado.d = d; estado.claves = claves;
  dibujarJetzt(); dibujarPreis(); dibujarDia();
  irA(seguir ? claves.length - 1 : Math.min(estado.idx, claves.length - 1));
}

async function iniciar() {
  estado.geo = await (await fetch(`datos/zonas.json?v=${VERSION}`)).json();
  armarMapa();
  activarArrastre();
  document.querySelectorAll('input[name="modo"]').forEach((b) => b.addEventListener("change", () => { estado.modo = b.value; dibujar(); }));
  $("#capaBurbujas").addEventListener("change", (e) => { estado.capas.burbujas = e.target.checked; dibujar(); });
  $("#capaGrenzen").addEventListener("change", (e) => { estado.capas.grenzen = e.target.checked; dibujar(); });
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
  aviso("Daten werden geladen…");
  await cargar();
  setInterval(() => cargar().catch(console.error), ACTUALIZAR_MIN * 60e3);
}

iniciar().catch((e) => { console.error(e); aviso("Die Seite konnte nicht starten: " + e.message); });
