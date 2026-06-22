/*
 * simulate.js — Simulation de circuits.
 *
 *  • simulateDC()        : point de fonctionnement, NON LINÉAIRE (Newton-Raphson),
 *                          gère résistances, sources, diodes / LED / Zener,
 *                          interrupteurs, bobines (court-circuit) et condensateurs
 *                          (circuit ouvert).
 *  • simulateTransient() : analyse temporelle (Euler implicite) avec condensateurs,
 *                          bobines et sources sinusoïdales → formes d'onde.
 *  • runERC()            : vérification des règles électriques.
 *
 * Analyse nodale modifiée (MNA). Lois d'Ohm & de Kirchhoff.
 */

// ---- Conversion d'une valeur texte ("4.7k", "1 kΩ", "100u") -> nombre -----
function parseValue(str, def) {
  if (str == null || str === '') return def;
  const s = String(str).replace(',', '.').replace(/[ΩVAFHWvahf\s]/g, '');
  const m = s.match(/^(-?\d*\.?\d+)\s*([pnuµmkKMG]?)/);
  if (!m) return def;
  let v = parseFloat(m[1]);
  const mult = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
  if (m[2] && mult[m[2]] !== undefined) v *= mult[m[2]];
  return v;
}

const DEFAULT_R = { resistor: 1000, resistor_iec: 1000, potentiometer: 1000, lamp: 100, motor: 50, buzzer: 1000, relay: 200, fuse: 0.05 };
const DEFAULT_V = { dc_source: 9, battery: 1.5, battery2: 9, vcc: 5 };
const DEFAULT_C = 1e-6, DEFAULT_L = 1e-3;
const VT = 0.025852; // tension thermique à 300 K
const DIODE_MODEL = {
  diode: { Is: 1e-14, N: 1 },
  led: { Is: 1e-16, N: 2 },
  zener: { Is: 1e-14, N: 1, zener: true },
};
const UNSUPPORTED = new Set(['transistor_npn', 'transistor_pnp', 'transformer']);

// ---- Résolution Ax = b (Gauss, pivot partiel) -----------------------------
function solveLinear(A, b) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-14) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let cc = col; cc < n; cc++) A[r][cc] -= f * A[col][cc];
      b[r] -= f * b[col];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

// Limitation de la tension de jonction (convergence de Newton, façon SPICE)
function pnjlim(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    } else {
      vnew = vnew > 0 ? vt * Math.log(Math.max(vnew / vt, 1e-12)) : vnew;
    }
  }
  return vnew;
}

// ---- Extraction des éléments à partir de la connectivité ------------------
function collectElements(components, wires, symbols) {
  const nl = buildNets(components, wires, symbols);
  const tn = nl.terminalNet;
  const ground = new Set();
  for (const c of components) if (c.type === 'ground') ground.add(tn[c.id][0]);

  const E = { R: [], V: [], I: [], C: [], L: [], D: [] };
  const warnings = [];
  let hasSource = false;

  for (const c of components) {
    const t = tn[c.id];
    if (UNSUPPORTED.has(c.type)) { warnings.push(`${c.label || c.type} ignoré (modèle non disponible)`); continue; }
    if (c.type in DEFAULT_R) {
      E.R.push({ a: t[0], b: t[1], R: Math.max(parseValue(c.value, DEFAULT_R[c.type]), 1e-6), comp: c });
    } else if (c.type === 'dc_source' || c.type === 'battery' || c.type === 'battery2') {
      E.V.push({ p: t[0], n: t[1], dc: parseValue(c.value, DEFAULT_V[c.type]), ac: 0, comp: c }); hasSource = true;
    } else if (c.type === 'vcc') {
      E.V.push({ p: t[0], n: -1, dc: parseValue(c.value, DEFAULT_V.vcc), ac: 0, comp: c }); hasSource = true;
    } else if (c.type === 'ac_source') {
      E.V.push({ p: t[0], n: t[1], dc: 0, ac: parseValue(c.value, 5), comp: c }); hasSource = true;
    } else if (c.type === 'current_source') {
      E.I.push({ p: t[0], n: t[1], I: parseValue(c.value, 0.01), comp: c }); hasSource = true;
    } else if (c.type === 'ammeter') {
      E.V.push({ p: t[0], n: t[1], dc: 0, ac: 0, comp: c });
    } else if (c.type === 'capacitor' || c.type === 'capacitor_pol') {
      E.C.push({ a: t[0], b: t[1], C: parseValue(c.value, DEFAULT_C), comp: c });
    } else if (c.type === 'inductor') {
      E.L.push({ a: t[0], b: t[1], L: parseValue(c.value, DEFAULT_L), comp: c });
    } else if (c.type in DIODE_MODEL) {
      const md = DIODE_MODEL[c.type];
      E.D.push({ p: t[0], n: t[1], Is: md.Is, N: md.N, Vz: md.zener ? parseValue(c.value, 5.1) : 0, comp: c });
    } else if (c.type === 'switch' || c.type === 'push_button') {
      if (c.closed) E.R.push({ a: t[0], b: t[1], R: 1e-6, comp: c });
    }
    // voltmètre / ohmmètre / ground / junction / antenna : pas d'élément
  }
  return { nl, ground, E, hasSource, warnings, nets: nl.nets, netSample: nl.netSample };
}

function ensureGround(ctx) {
  if (ctx.ground.size === 0) {
    const v = ctx.E.V[0];
    ctx.ground.add(v ? (v.n >= 0 ? v.n : v.p) : ctx.nets[0]);
    ctx.warnings.push('Pas de masse : référence 0 V choisie automatiquement.');
  }
}

// ---- Cœur : résout un instant (Newton-Raphson pour les non-linéaires) ------
function solveStep(E, ground, nets, opts) {
  const node = {}; let n = 0;
  for (const net of nets) if (!ground.has(net)) node[net] = n++;
  const idx = (net) => (ground.has(net) || net < 0 ? -1 : node[net]);
  const m = E.V.length, N = n + m;
  if (N === 0) return null;

  const dVd = E.D.map(() => 0);
  let x = new Array(N).fill(0);
  let conv = false;

  for (let it = 0; it < 200; it++) {
    let limiting = false;
    const A = Array.from({ length: N }, () => new Array(N).fill(0));
    const z = new Array(N).fill(0);
    const g = (i, j, val) => { if (i >= 0) A[i][i] += val; if (j >= 0) A[j][j] += val; if (i >= 0 && j >= 0) { A[i][j] -= val; A[j][i] -= val; } };

    for (const r of E.R) g(idx(r.a), idx(r.b), 1 / r.R);
    for (let i = 0; i < n; i++) A[i][i] += 1e-12; // gmin

    E.V.forEach((v, k) => {
      const p = idx(v.p), q = idx(v.n), row = n + k;
      if (p >= 0) { A[p][row] += 1; A[row][p] += 1; }
      if (q >= 0) { A[q][row] -= 1; A[row][q] -= 1; }
      z[row] += v.dc + (opts.transient ? v.ac * Math.sin(2 * Math.PI * opts.f * opts.t) : 0);
    });
    for (const s of E.I) { const p = idx(s.p), q = idx(s.n); if (p >= 0) z[p] += s.I; if (q >= 0) z[q] -= s.I; }

    if (opts.transient) {
      for (const c of E.C) { const G = c.C / opts.h, Vp = opts.capV[c.comp.id] || 0, pi = idx(c.a), qi = idx(c.b); g(pi, qi, G); if (pi >= 0) z[pi] += G * Vp; if (qi >= 0) z[qi] -= G * Vp; }
      for (const l of E.L) { const G = opts.h / l.L, Ip = opts.indI[l.comp.id] || 0, pi = idx(l.a), qi = idx(l.b); g(pi, qi, G); if (pi >= 0) z[pi] -= Ip; if (qi >= 0) z[qi] += Ip; }
    } else {
      for (const l of E.L) g(idx(l.a), idx(l.b), 1 / 1e-6); // bobine = court-circuit en continu
    }

    E.D.forEach((d, di) => {
      const pi = idx(d.p), qi = idx(d.n);
      const nvt = d.N * VT;
      const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * d.Is));
      const Vraw = (pi >= 0 ? x[pi] : 0) - (qi >= 0 ? x[qi] : 0);
      let Vd = pnjlim(Vraw, dVd[di], nvt, vcrit);
      if (Math.abs(Vraw - Vd) > 1e-9) limiting = true; // jonction encore en limitation
      dVd[di] = Vd;
      const ex = Math.exp(Math.min(Vd / nvt, 40));
      let I = d.Is * (ex - 1), Gd = (d.Is / nvt) * ex;
      if (d.Vz) { const exz = Math.exp(Math.min(-(Vd + d.Vz) / nvt, 40)); I -= d.Is * (exz - 1); Gd += (d.Is / nvt) * exz; }
      Gd += 1e-12;
      const Ieq = I - Gd * Vd;
      g(pi, qi, Gd);
      if (pi >= 0) z[pi] -= Ieq; if (qi >= 0) z[qi] += Ieq;
    });

    const xn = solveLinear(A.map((r) => r.slice()), z.slice());
    if (!xn) return null;
    let maxd = 0; for (let i = 0; i < N; i++) maxd = Math.max(maxd, Math.abs(xn[i] - x[i]));
    x = xn;
    // Convergence : tensions stables ET plus aucune jonction en limitation
    if (E.D.length === 0) { if (it >= 1) { conv = true; break; } }
    else if (!limiting && maxd < 1e-6) { conv = true; break; }
  }
  return { x, node, idx, n, m, conv };
}

// ---- Point de fonctionnement (DC, non linéaire) ---------------------------
function simulateDC(components, wires, symbols) {
  const ctx = collectElements(components, wires, symbols);
  const warnings = ctx.warnings.slice();
  if (!ctx.hasSource) { warnings.push("Aucune source d'alimentation — ajoute une pile ou une source."); return { ok: false, warnings, netSample: ctx.netSample }; }
  ensureGround(ctx);

  const sol = solveStep(ctx.E, ctx.ground, ctx.nets, { transient: false });
  if (!sol) { warnings.push("Circuit non résoluble (court-circuit d'une source ?)."); return { ok: false, warnings, netSample: ctx.netSample }; }
  if (!sol.conv) warnings.push('Convergence imparfaite — résultats approximatifs.');

  const netV = {};
  for (const net of ctx.nets) netV[net] = ctx.ground.has(net) ? 0 : sol.x[sol.node[net]];

  const compI = {};
  for (const r of ctx.E.R) compI[r.comp.id] = (netV[r.a] - netV[r.b]) / r.R;
  for (const l of ctx.E.L) compI[l.comp.id] = (netV[l.a] - netV[l.b]) / 1e-6;
  ctx.E.V.forEach((v, k) => { compI[v.comp.id] = sol.x[sol.n + k]; });
  for (const c of ctx.E.C) compI[c.comp.id] = 0; // condensateur : pas de courant continu
  for (const d of ctx.E.D) {
    const nvt = d.N * VT, Vd = netV[d.p] - netV[d.n];
    let I = d.Is * (Math.exp(Math.min(Vd / nvt, 40)) - 1);
    if (d.Vz) I -= d.Is * (Math.exp(Math.min(-(Vd + d.Vz) / nvt, 40)) - 1);
    compI[d.comp.id] = I;
  }
  return { ok: true, warnings, netV, compI, netSample: ctx.netSample, groundNets: [...ctx.ground] };
}

// ---- Analyse transitoire (formes d'onde) ----------------------------------
function simulateTransient(components, wires, symbols, opt) {
  opt = opt || {};
  const ctx = collectElements(components, wires, symbols);
  const warnings = ctx.warnings.slice();
  if (!ctx.hasSource) { warnings.push('Aucune source.'); return { ok: false, warnings }; }
  ensureGround(ctx);

  const f = opt.f || 50;
  const total = (opt.time || 60) / 1000;     // ms -> s
  const steps = Math.min(Math.max(opt.steps || 600, 50), 4000);
  const h = total / steps;

  const capV = {}, indI = {};
  const nonGround = ctx.nets.filter((net) => !ctx.ground.has(net));
  const plot = nonGround.slice(0, 8);
  const t = [];
  const series = plot.map((net) => ({ net, label: 'N' + (net + 1), values: [] }));

  for (let k = 0; k <= steps; k++) {
    const tt = k * h;
    const sol = solveStep(ctx.E, ctx.ground, ctx.nets, { transient: true, h, t: tt, f, capV, indI });
    if (!sol) { warnings.push('Non résoluble à t=' + (tt * 1000).toFixed(2) + ' ms'); return { ok: false, warnings }; }
    const netV = (net) => (ctx.ground.has(net) ? 0 : sol.x[sol.node[net]]);
    t.push(tt * 1000);
    series.forEach((s) => s.values.push(netV(s.net)));
    for (const c of ctx.E.C) capV[c.comp.id] = netV(c.a) - netV(c.b);
    for (const l of ctx.E.L) { const G = h / l.L; indI[l.comp.id] = G * (netV(l.a) - netV(l.b)) + (indI[l.comp.id] || 0); }
  }
  return { ok: true, warnings, t, series, unit: 'ms' };
}

// ---- Vérification des règles électriques (ERC) ----------------------------
function runERC(components, wires, symbols) {
  const issues = [];
  const { terminalNet, nets } = buildNets(components, wires, symbols);

  // Nombre de terminaux par net
  const deg = {};
  for (const c of components) for (const net of terminalNet[c.id]) deg[net] = (deg[net] || 0) + 1;

  // Broches non connectées (composant multi-broches isolé sur un net)
  const ENDPOINT = new Set(['ground', 'vcc', 'antenna', 'junction']);
  for (const c of components) {
    if (ENDPOINT.has(c.type)) continue;
    terminalNet[c.id].forEach((net, i) => {
      if ((deg[net] || 0) <= 1) issues.push({ level: 'err', msg: `${c.label || c.type} : broche ${i + 1} non connectée`, compId: c.id });
    });
  }

  // Masse / source
  if (!components.some((c) => c.type === 'ground')) issues.push({ level: 'warn', msg: 'Aucune masse (référence 0 V) dans le circuit.' });
  const hasSource = components.some((c) => ['dc_source', 'ac_source', 'current_source', 'battery', 'battery2', 'vcc'].includes(c.type));
  if (!hasSource) issues.push({ level: 'warn', msg: "Aucune source d'alimentation." });

  // Source court-circuitée (mêmes nets aux deux bornes)
  for (const c of components) {
    if (['dc_source', 'ac_source', 'battery', 'battery2'].includes(c.type)) {
      const t = terminalNet[c.id];
      if (t[0] === t[1]) issues.push({ level: 'err', msg: `${c.label || c.type} : source court-circuitée`, compId: c.id });
    }
  }

  if (!issues.length) issues.push({ level: 'ok', msg: 'Aucun problème détecté ✅' });
  return issues;
}

// ---- Mise en forme tension / courant --------------------------------------
function fmtVolt(v) { return _fmtSI(v, 'V'); }
function fmtAmp(a) { return _fmtSI(a, 'A'); }
function _fmtSI(x, unit) {
  const a = Math.abs(x);
  if (a < 1e-12) return '0 ' + unit;
  if (a < 1e-3) return (x * 1e6).toFixed(a < 1e-5 ? 2 : 1) + ' µ' + unit;
  if (a < 1) return (x * 1e3).toFixed(a < 1e-2 ? 2 : 1) + ' m' + unit;
  if (a < 1000) return x.toFixed(2) + ' ' + unit;
  return (x / 1000).toFixed(2) + ' k' + unit;
}
