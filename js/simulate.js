/*
 * simulate.js — Simulation en courant continu (point de fonctionnement).
 *
 * Analyse nodale modifiée (MNA) : construit puis résout le système linéaire
 * pour obtenir les tensions de chaque net et les courants de branche.
 * Modèle linéaire : résistances, sources de tension/courant, interrupteurs,
 * ampèremètres. Les composants non linéaires (diodes, transistors) sont
 * signalés et ignorés.
 */

// Conversion d'une valeur texte ("4.7k", "1 kΩ", "100u") en nombre.
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

// Résistances/tensions par défaut selon le type
const DEFAULT_R = { resistor: 1000, resistor_iec: 1000, potentiometer: 1000, lamp: 100, motor: 50, buzzer: 1000, relay: 200, fuse: 0.05 };
const DEFAULT_V = { dc_source: 9, battery: 1.5, battery2: 9, vcc: 5 };
const UNSUPPORTED = new Set(['diode', 'led', 'zener', 'transistor_npn', 'transistor_pnp', 'transformer']);

// Résolution Ax = b (élimination de Gauss avec pivot partiel)
function solveLinear(A, b) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null; // singulier
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

function simulateDC(components, wires, symbols) {
  const warnings = [];
  const { terminalNet, nets, netSample } = buildNets(components, wires, symbols);

  // Nets de masse (référence 0 V)
  const groundNets = new Set();
  for (const c of components) {
    if (c.type === 'ground') groundNets.add(terminalNet[c.id][0]);
  }

  // Éléments à stamper
  const resistors = []; // {a,b,R,comp}
  const vsources = [];  // {p,n,E,comp}  (p=+, n=-)
  const isources = [];  // {p,n,I,comp}
  let hasSource = false;

  for (const c of components) {
    const t = terminalNet[c.id];
    if (UNSUPPORTED.has(c.type)) { warnings.push(`${c.label || c.type} ignoré (non linéaire)`); continue; }
    if (c.type in DEFAULT_R) {
      resistors.push({ a: t[0], b: t[1], R: Math.max(parseValue(c.value, DEFAULT_R[c.type]), 1e-6), comp: c });
    } else if (c.type === 'dc_source' || c.type === 'battery' || c.type === 'battery2') {
      vsources.push({ p: t[0], n: t[1], E: parseValue(c.value, DEFAULT_V[c.type]), comp: c }); hasSource = true;
    } else if (c.type === 'vcc') {
      // Source vers la masse de référence
      vsources.push({ p: t[0], n: -1, E: parseValue(c.value, DEFAULT_V.vcc), comp: c }); hasSource = true;
    } else if (c.type === 'current_source') {
      isources.push({ p: t[0], n: t[1], I: parseValue(c.value, 0.01), comp: c }); hasSource = true;
    } else if (c.type === 'ammeter') {
      vsources.push({ p: t[0], n: t[1], E: 0, comp: c }); // 0 V → mesure du courant
    } else if (c.type === 'switch' || c.type === 'push_button') {
      if (c.closed) resistors.push({ a: t[0], b: t[1], R: 1e-6, comp: c });
    }
    // voltmètre / ohmmètre / ground / junction / antenna : pas d'élément
  }

  if (!hasSource) { warnings.push('Aucune source d\'alimentation — ajoute une pile ou une source.'); return { ok: false, warnings, netSample }; }

  // Référence : masse si présente, sinon la borne « - » de la 1re source
  if (groundNets.size === 0) {
    groundNets.add(vsources.length ? (vsources[0].n >= 0 ? vsources[0].n : vsources[0].p) : 0);
    warnings.push('Pas de masse : référence 0 V choisie automatiquement.');
  }
  const refIdx = (net) => (groundNets.has(net) || net < 0 ? -1 : netMap[net]);

  // Numérotation des nœuds non-référence
  const netMap = {}; let n = 0;
  for (const net of nets) if (!groundNets.has(net)) netMap[net] = n++;
  const m = vsources.length;
  const N = n + m;
  if (N === 0) { warnings.push('Rien à simuler.'); return { ok: false, warnings, netSample }; }

  const A = Array.from({ length: N }, () => new Array(N).fill(0));
  const z = new Array(N).fill(0);

  const stampG = (i, j, g) => {
    if (i >= 0) A[i][i] += g;
    if (j >= 0) A[j][j] += g;
    if (i >= 0 && j >= 0) { A[i][j] -= g; A[j][i] -= g; }
  };

  for (const r of resistors) stampG(refIdx(r.a), refIdx(r.b), 1 / r.R);
  for (let i = 0; i < n; i++) A[i][i] += 1e-9; // gmin pour la stabilité

  vsources.forEach((v, k) => {
    const p = refIdx(v.p), q = refIdx(v.n), row = n + k;
    if (p >= 0) { A[p][row] += 1; A[row][p] += 1; }
    if (q >= 0) { A[q][row] -= 1; A[row][q] -= 1; }
    z[row] += v.E;
  });
  for (const s of isources) {
    const p = refIdx(s.p), q = refIdx(s.n);
    if (p >= 0) z[p] += s.I;
    if (q >= 0) z[q] -= s.I;
  }

  const x = solveLinear(A.map((r) => r.slice()), z.slice());
  if (!x) { warnings.push('Circuit non résoluble (court-circuit d\'une source ?).'); return { ok: false, warnings, netSample }; }

  // Tensions des nets
  const netV = {};
  for (const net of nets) netV[net] = groundNets.has(net) ? 0 : x[netMap[net]];

  // Courants de branche
  const compI = {};
  for (const r of resistors) compI[r.comp.id] = (netV[r.a] - netV[r.b]) / r.R;
  vsources.forEach((v, k) => { compI[v.comp.id] = x[n + k]; });

  return { ok: true, warnings, netV, compI, netSample, groundNets: [...groundNets] };
}

// Mise en forme tension / courant avec préfixes SI
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
