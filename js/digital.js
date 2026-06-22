/*
 * digital.js — Simulation logique (numérique).
 *
 * Évalue un réseau de portes logiques dans le temps et produit un chronogramme.
 * Entrées : horloges (créneau), entrées logiques (0/1 basculables).
 * Sorties : indicateurs logiques. Les portes sont réévaluées jusqu'à
 * stabilisation à chaque pas de temps (gère les chaînes et le rebouclage simple).
 */

const GATE_INPUTS = { gate_and: 2, gate_or: 2, gate_nand: 2, gate_nor: 2, gate_xor: 2, gate_not: 1 };
const DIGITAL_TYPES = new Set([...Object.keys(GATE_INPUTS), 'clock', 'logic_in', 'logic_out']);

function gateEval(type, a, b) {
  switch (type) {
    case 'gate_and': return a && b ? 1 : 0;
    case 'gate_or': return a || b ? 1 : 0;
    case 'gate_nand': return a && b ? 0 : 1;
    case 'gate_nor': return a || b ? 0 : 1;
    case 'gate_xor': return a ^ b ? 1 : 0;
    case 'gate_not': return a ? 0 : 1;
    default: return 0;
  }
}

function simulateDigital(components, wires, symbols, opt) {
  opt = opt || {};
  const nl = buildNets(components, wires, symbols);
  const tn = nl.terminalNet;

  const gates = [], inputs = [], clocks = [], outputs = [];
  for (const c of components) {
    if (c.type in GATE_INPUTS) gates.push(c);
    else if (c.type === 'logic_in') inputs.push(c);
    else if (c.type === 'clock') clocks.push(c);
    else if (c.type === 'logic_out') outputs.push(c);
  }
  if (!gates.length && !outputs.length) return { ok: false, warnings: ['Ajoute des portes logiques et des entrées/sorties.'] };

  // Échelle de temps : 6 périodes de l'horloge la plus rapide (sinon statique)
  let fmax = 0;
  for (const ck of clocks) fmax = Math.max(fmax, parseValue(ck.value, 1));
  const total = fmax > 0 ? 6 / fmax : 1;
  const steps = 600, h = total / steps;

  // Signaux tracés : nets pilotés par une horloge, une entrée ou une sortie de porte
  const driverNets = new Set();
  const labelOf = {};
  for (const ck of clocks) { const net = tn[ck.id][0]; driverNets.add(net); labelOf[net] = ck.label || 'CLK'; }
  for (const c of inputs) { const net = tn[c.id][0]; driverNets.add(net); labelOf[net] = c.label || 'IN'; }
  for (const g of gates) { const net = tn[g.id][GATE_INPUTS[g.type]]; driverNets.add(net); if (!labelOf[net]) labelOf[net] = g.label || 'U'; }
  for (const o of outputs) { const net = tn[o.id][0]; if (!labelOf[net]) labelOf[net] = o.label || 'OUT'; driverNets.add(net); }

  const plot = [...driverNets].slice(0, 10);
  const signals = plot.map((net) => ({ net, label: labelOf[net] || ('S' + (net + 1)), values: [] }));
  const t = [];
  const val = {};
  let warnOsc = false;

  for (let k = 0; k <= steps; k++) {
    const tt = k * h;
    // sources
    for (const c of inputs) val[tn[c.id][0]] = c.high ? 1 : 0;
    for (const ck of clocks) {
      const f = parseValue(ck.value, 1);
      val[tn[ck.id][0]] = (Math.floor(tt * f * 2) % 2) === 0 ? 1 : 0;
    }
    // stabilisation des portes (itère jusqu'au point fixe)
    let iter, changed = true;
    for (iter = 0; iter < gates.length + 3 && changed; iter++) {
      changed = false;
      for (const g of gates) {
        const ins = tn[g.id], nIn = GATE_INPUTS[g.type];
        const a = val[ins[0]] || 0, b = nIn > 1 ? (val[ins[1]] || 0) : 0;
        const o = gateEval(g.type, a, b);
        const outNet = ins[nIn];
        if (val[outNet] !== o) { val[outNet] = o; changed = true; }
      }
    }
    if (changed) warnOsc = true; // non stabilisé (oscillation/bascule)
    t.push(tt * 1000);
    signals.forEach((s) => s.values.push(val[s.net] || 0));
  }

  // Indicateurs de sortie
  for (const o of outputs) o.__on = val[tn[o.id][0]] ? 1 : 0;

  const warnings = [];
  if (!clocks.length) warnings.push('Aucune horloge : signaux statiques (bascule une entrée pour voir la logique).');
  if (warnOsc) warnings.push('Réseau non stabilisé (oscillation ou bascule) — résultat indicatif.');
  return { ok: true, warnings, t, signals, unit: 'ms' };
}
