/*
 * board.js — Tableau électrique et schéma unifilaire.
 *
 *  • Modèle « tableau personnalisé » (editor.meta.board) : abonnement,
 *    parafoudre, interrupteurs différentiels, circuits (repère, désignation,
 *    calibre, courbe, section, points, longueur, puissance, contacteur…).
 *    Tiré du plan (boardFromDesign), créé sans plan (boardTemplate) ou
 *    complété avec les appareils ajoutés au plan (boardDistribute).
 *  • checkBoard(design) : contrôles NF C 15-100 du tableau (simplifiés).
 *  • drawUnifilar(ctx, …) : folio unifilaire normalisé (symboles CEI,
 *    nomenclature, cartouche), dessiné par le même code en SVG, en DXF et à
 *    l'écran ; plusieurs folios si le tableau est grand.
 *  • calcNote(design) : note de calcul par circuit (Ib, In, Iz, ΔU, Icc mini,
 *    longueur maximale protégée), folios A3 en SVG / DXF, tableur CSV.
 *  • developedSVGs(…) : schémas développés des commandes d'éclairage, pièce
 *    par pièce (simple allumage, va-et-vient, télérupteur et poussoirs).
 *  • Face avant (rangées de 13 modules, réserve) et étiquettes à imprimer.
 */

const BOARD_IN = [2, 6, 10, 16, 20, 25, 32, 40, 50, 63];
const BOARD_S = [1.5, 2.5, 4, 6, 10, 16];
const BOARD_S_MAX_IN = { 1.5: 16, 2.5: 20, 4: 25, 6: 32, 10: 40, 16: 63 }; // disjoncteur maximal par section (cuivre)
const BOARD_RCD_IN = [25, 40, 63];
const BOARD_RCD_TYPES = ['AC', 'A', 'F', 'B'];
const BOARD_KINDS = { light: 'Éclairage', socket: 'Prises', heating: 'Chauffage', dedicated: 'Spécialisé', other: 'Autre' };

// Circuits types (NF C 15-100) : ajout en un clic dans le tableau
const BOARD_PRESETS = [
  { key: 'light', name: 'Éclairage', kind: 'light', In: 16, S: 1.5, points: 6, P: 300 },
  { key: 'socket', name: 'Prises', kind: 'socket', In: 20, S: 2.5, points: 8 },
  { key: 'socket16', name: 'Prises (1,5 mm²)', kind: 'socket', In: 16, S: 1.5, points: 6 },
  { key: 'kitchen', name: 'Prises cuisine', kind: 'socket', In: 20, S: 2.5, points: 6 },
  { key: 'cooktop', name: 'Plaque de cuisson', kind: 'dedicated', appliance: 'cooktop', In: 32, S: 6, points: 1, P: 7200, typeA: true },
  { key: 'oven', name: 'Four', kind: 'dedicated', appliance: 'oven', In: 20, S: 2.5, points: 1, P: 2500 },
  { key: 'washer', name: 'Lave-linge', kind: 'dedicated', appliance: 'washer', In: 20, S: 2.5, points: 1, P: 2200, typeA: true },
  { key: 'dishwasher', name: 'Lave-vaisselle', kind: 'dedicated', appliance: 'dishwasher', In: 20, S: 2.5, points: 1, P: 2000 },
  { key: 'dryer', name: 'Sèche-linge', kind: 'dedicated', appliance: 'dryer', In: 20, S: 2.5, points: 1, P: 2500 },
  { key: 'water_heater', name: 'Chauffe-eau', kind: 'dedicated', appliance: 'water_heater', In: 20, S: 2.5, points: 1, P: 3000, contactor: 'hc' },
  { key: 'heating', name: 'Chauffage', kind: 'heating', In: 20, S: 2.5, points: 3, P: 3000 },
  { key: 'vmc', name: 'VMC', kind: 'dedicated', appliance: 'vmc', In: 2, S: 1.5, points: 1, P: 35 },
  { key: 'ev', name: 'Borne de recharge (IRVE)', kind: 'dedicated', appliance: 'ev_charger', In: 40, S: 10, points: 1, P: 7400, typeF: true },
  { key: 'ev_tri', name: 'Borne de recharge 11 kW (tri)', kind: 'dedicated', appliance: 'ev_charger', In: 20, S: 6, points: 1, P: 11000, typeF: true, phase: '3P', tri: true },
  { key: 'cooktop_tri', name: 'Plaque de cuisson (tri)', kind: 'dedicated', appliance: 'cooktop', In: 20, S: 2.5, points: 1, P: 7200, typeA: true, phase: '3P', tri: true },
  { key: 'hvac_tri', name: 'Pompe à chaleur (tri)', kind: 'dedicated', In: 16, S: 2.5, points: 1, P: 6000, phase: '3P', tri: true },
  { key: 'shutters', name: 'Volets roulants', kind: 'other', In: 16, S: 1.5, points: 4, P: 600 },
  { key: 'freezer', name: 'Congélateur', kind: 'dedicated', In: 20, S: 2.5, points: 1, P: 200 },
  { key: 'hvac', name: 'Pompe à chaleur / climatisation', kind: 'dedicated', In: 20, S: 2.5, points: 1, P: 2500 },
  { key: 'outdoor', name: 'Extérieur (prises, éclairage)', kind: 'socket', In: 16, S: 2.5, points: 2, P: 500 },
  { key: 'comms', name: 'Tableau de communication', kind: 'dedicated', In: 16, S: 1.5, points: 1, P: 50 },
  { key: 'other', name: 'Autre circuit', kind: 'other', In: 16, S: 1.5, points: 1, P: 1000 },
];

const _bNum = (v, d) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
const _bS = (S) => String(S).replace('.', ',');
// Texte d'étiquette : deux lignes au plus, coupées entre les mots, police réduite si besoin
function _bFitLines(t, width, size, minSize) {
  const words = String(t || '').split(/\s+/).filter(Boolean);
  for (let sz = size; sz >= (minSize || 1.5); sz -= 0.1) {
    const n = Math.max(1, Math.floor(width / (sz * 0.56)));
    const lines = [''];
    let ok = true;
    for (const w of words) {
      if (w.length > n) { ok = false; break; }
      const L = lines[lines.length - 1];
      if (L && (L + ' ' + w).length > n) lines.push(w); else lines[lines.length - 1] = (L + ' ' + w).trim();
    }
    if (ok && lines.length <= 2) return { lines, size: Math.round(sz * 100) / 100 };
  }
  const n = Math.floor(width / ((minSize || 1.5) * 0.56));
  return { lines: [String(t).slice(0, n), String(t).slice(n, 2 * n)].filter(Boolean), size: minSize || 1.5 };
}

// Câble U1000 R2V : « 3G2,5 » (phase, neutre, terre) ; départ triphasé : « 5G6 » (3 phases, neutre, terre)
function boardCable(S, phase) { return (phase === '3P' ? '5G' : '3G') + _bS(S); }

// ---------------------------------------------------------------------------
// Tableau personnalisé ← conception automatique (copie modifiable)
// ---------------------------------------------------------------------------
function boardFromDesign(design) {
  return {
    v: 1,
    supply: { kva: design.agcp ? design.agcp.kva : 9, phases: (design.supply && design.supply.phases) || 1, surge: !!(design.supply && design.supply.surge), area: Math.round(design.area || 0), ra: (design.supply && design.supply.ra) || null },
    rcds: design.rcds.map((r) => ({ id: r.id, In: r.In, type: r.type, sens: r.sens || 30 })),
    circuits: design.circuits.map((c) => ({
      id: c.id, name: c.name, kind: c.kind, In: c.In, S: c.S, curve: c.curve || 'C', rcd: c.rcd,
      devices: (c.devices || []).slice(), points: c.points, length: Math.round((c.length || 0) * 10) / 10,
      P: Math.round(c.power || 0), appliance: c.appliance || null, typeA: !!c.typeA, typeF: !!c.typeF,
      contactor: c.contactor || (c.appliance === 'water_heater' ? 'hc' : null), teleruptor: !!c.teleruptor,
      phase: c.phaseAuto ? null : c.phase || null,
    })),
  };
}

// Tableau sans plan : circuits usuels d'un logement de la surface donnée
function boardTemplate(area, opts) {
  opts = Object.assign({ heating: true, cooktop: true, ev: false, tri: false }, opts || {});
  const A = Math.max(10, +area || 60);
  const b = { v: 1, supply: { kva: null, phases: opts.tri ? 3 : 1, surge: false, area: A }, rcds: [], circuits: [] }; // abonnement : d'après la puissance probable
  const nAC = A <= 35 ? 1 : A <= 100 ? 2 : 3;
  for (let i = 0; i < nAC; i++) b.rcds.push({ id: 'ID' + (i + 1), In: A <= 35 ? 25 : 40, type: 'AC', sens: 30 });
  b.rcds.push({ id: 'ID' + (nAC + 1), In: 40, type: 'A', sens: 30 });
  const add = (key, over) => boardAddCircuit(b, key, over);
  const lights = Math.max(1, Math.ceil(A / 45)), sockets = Math.max(1, Math.ceil(A / 30));
  for (let i = 0; i < lights; i++) add('light', { name: 'Éclairage' + (lights > 1 ? ' ' + (i + 1) : '') });
  for (let i = 0; i < sockets; i++) add('socket', { name: 'Prises' + (sockets > 1 ? ' ' + (i + 1) : '') });
  add('kitchen');
  if (opts.cooktop) add(opts.tri ? 'cooktop_tri' : 'cooktop');
  add('oven'); add('washer'); add('dishwasher'); add('water_heater'); add('vmc');
  if (opts.heating) { const n = Math.max(1, Math.ceil((A * 80) / 4500)); for (let i = 0; i < n; i++) add('heating', { name: 'Chauffage' + (n > 1 ? ' ' + (i + 1) : ''), P: Math.round((A * 80) / n / 250) * 250 }); }
  if (opts.ev) add(opts.tri ? 'ev_tri' : 'ev');
  return b;
}

function boardNextId(board, prefix) {
  const used = new Set([...board.circuits.map((c) => c.id), ...board.rcds.map((r) => r.id)]);
  let n = 1;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

// Ajoute un circuit d'après un préréglage, sous le différentiel qui convient
function boardAddCircuit(board, key, over) {
  const pr = BOARD_PRESETS.find((p) => p.key === key) || BOARD_PRESETS[BOARD_PRESETS.length - 1];
  const c = {
    id: boardNextId(board, 'C'), name: pr.name, kind: pr.kind, In: pr.In, S: pr.S, curve: 'C', rcd: null,
    devices: [], points: pr.points || 1, length: 15, P: pr.P || 0, appliance: pr.appliance || null,
    typeA: !!pr.typeA, typeF: !!pr.typeF, contactor: pr.contactor || null, teleruptor: false,
    phase: pr.phase && +(board.supply && board.supply.phases) === 3 ? pr.phase : null, ...(over || {}),
  };
  c.rcd = c.rcd || boardPickRcd(board, c);
  board.circuits.push(c);
  return c;
}

// Différentiel pour un circuit : type F / A si l'appareil l'exige, sinon le type AC le moins chargé
function boardPickRcd(board, c) {
  const count = (r) => board.circuits.filter((x) => x.rcd === r.id).length;
  const need = c.typeF ? 'F' : c.typeA ? 'A' : null;
  // un circuit ordinaire va sur un ID type AC (un nouveau si tous sont pleins), pas sur l'ID type A ou F
  const list = board.rcds.filter((r) => (need ? r.type === need || (need === 'A' && r.type === 'F') : r.type === 'AC') && count(r) < 8);
  if (!list.length) {
    const r = { id: boardNextId(board, 'ID'), In: 40, type: need || 'AC', sens: 30 };
    board.rcds.push(r);
    return r.id;
  }
  return list.sort((a, b) => count(a) - count(b))[0].id;
}

// Range les appareils du plan qui ne sont sur aucun circuit (plan modifié après coup)
function boardDistribute(board, components, design) {
  const byId = new Map(components.map((c) => [c.id, c]));
  let placed = 0;
  for (const id of (design && design.orphans) || []) {
    const d = byId.get(id);
    const spec = d && LOADS[d.type];
    if (!spec) continue;
    let target = null;
    if (spec.cls === 'light') {
      target = board.circuits.filter((c) => c.kind === 'light' && (c.devices || []).filter((x) => byId.get(x) && LOADS[byId.get(x).type]).length < 8)
        .sort((a, b) => (a.devices || []).length - (b.devices || []).length)[0];
      if (!target) target = boardAddCircuit(board, 'light', { name: 'Éclairage ' + (board.circuits.filter((c) => c.kind === 'light').length + 1), devices: [] });
    } else if (spec.cls === 'socket') {
      target = board.circuits.filter((c) => c.kind === 'socket' && !/cuisine/i.test(c.name) && (c.devices || []).length < (c.S >= 2.5 ? 12 : 8))
        .sort((a, b) => (a.devices || []).length - (b.devices || []).length)[0];
      if (!target) target = boardAddCircuit(board, 'socket', { name: 'Prises ' + (board.circuits.filter((c) => c.kind === 'socket').length + 1), devices: [] });
    } else if (spec.cls === 'heating') {
      const P = loadPower(d);
      target = board.circuits.find((c) => c.kind === 'heating' && (c.devices || []).reduce((s, x) => s + (byId.get(x) ? loadPower(byId.get(x)) : 0), 0) + P <= 4500);
      if (!target) target = boardAddCircuit(board, 'heating', { name: 'Chauffage ' + (board.circuits.filter((c) => c.kind === 'heating').length + 1), devices: [] });
    } else if (spec.cls === 'dedicated') {
      const pr = BOARD_PRESETS.find((p) => p.appliance === d.type);
      target = boardAddCircuit(board, pr ? pr.key : 'other', { name: spec.circuit || spec.name, devices: [] });
    }
    if (target) { target.devices = (target.devices || []).concat(id); placed++; }
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Contrôles du tableau (NF C 15-100, simplifiés) : [{ level, msg, ref }]
// ---------------------------------------------------------------------------
function checkBoard(design) {
  const out = [];
  const push = (level, msg, ref) => out.push({ level, msg, ref: ref || null });
  const cs = design.circuits, rcds = design.rcds;
  if (!cs.length) { push('warn', 'Aucun circuit dans le tableau.'); return out; }
  // Repères uniques
  const seen = new Set();
  for (const c of cs) { if (seen.has(c.id)) push('err', `Repère ${c.id} utilisé deux fois.`, c.id); seen.add(c.id); }
  for (const c of cs) {
    const max = BOARD_S_MAX_IN[c.S];
    if (max === undefined) push('warn', `${c.id} : section ${_bS(c.S)} mm² inhabituelle.`, c.id);
    else if (c.In > max) push('err', `${c.id} ${c.name} : ${c.In} A sur ${_bS(c.S)} mm² — le câble n’est pas protégé (${max} A au plus).`, c.id);
    if (!c.rcd) push('err', `${c.id} ${c.name} : aucun interrupteur différentiel 30 mA en amont.`, c.id);
    if (c.kind === 'light') {
      if (c.points > 8) push('err', `${c.id} ${c.name} : ${c.points} points lumineux — 8 au plus par circuit.`, c.id);
      if (c.In > 16) push('err', `${c.id} ${c.name} : éclairage protégé à ${c.In} A — 16 A au plus.`, c.id);
    }
    if (c.kind === 'socket') {
      const maxPts = /cuisine/i.test(c.name) ? 6 : c.S >= 2.5 ? 12 : 8;
      if (c.points > maxPts) push('err', `${c.id} ${c.name} : ${c.points} socles — ${maxPts} au plus ${/cuisine/i.test(c.name) ? 'en cuisine (circuit dédié)' : `en ${_bS(c.S)} mm²`}.`, c.id);
      if (c.S < 2.5 && c.In > 16) push('err', `${c.id} : prises en 1,5 mm² protégées à 16 A au plus.`, c.id);
    }
    if (c.kind === 'heating' && c.power > (c.S >= 2.5 ? 4500 : 3500)) push('err', `${c.id} ${c.name} : ${_bNum(c.power)} W de chauffage — ${c.S >= 2.5 ? '4 500' : '3 500'} W au plus en ${_bS(c.S)} mm².`, c.id);
    if (c.appliance === 'cooktop' && c.phase !== '3P' && (c.In < 32 || c.S < 6)) push('err', `${c.id} Plaque de cuisson : 32 A et 6 mm² en monophasé.`, c.id);
    if (c.appliance === 'cooktop' && c.phase === '3P' && (c.In < 16 || c.S < 2.5)) push('err', `${c.id} Plaque de cuisson triphasée : 20 A et 2,5 mm² (5G2,5).`, c.id);
    if (['oven', 'washer', 'dishwasher', 'dryer', 'water_heater'].includes(c.appliance) && (c.In < 16 || c.S < 2.5)) push('err', `${c.id} ${c.name} : circuit spécialisé 20 A en 2,5 mm².`, c.id);
    const rc = rcds.find((r) => r.id === c.rcd);
    if (rc && c.typeA && !['A', 'F', 'B'].includes(rc.type)) push('err', `${c.id} ${c.name} : sous ${rc.id} type ${rc.type} — il faut un différentiel type A (ou F).`, c.id);
    if (rc && c.typeF && !['F', 'B'].includes(rc.type)) push('warn', `${c.id} ${c.name} : borne de recharge sous ${rc.id} type ${rc.type} — type F (ou A-EV, ou B) conseillé.`, c.id);
    if (c.ok === false) push('warn', `${c.id} ${c.name} : chute de tension ${_bNum(c.dUpct, 1)} % > ${c.limit} %.`, c.id);
    // Note de calcul : courant admissible du câble (triphasé : 3 conducteurs chargés), longueur protégée
    const Iz3 = c.phase === '3P' && CALC_IZ[3][c.S];
    if (Iz3 && c.In > Iz3) push('err', `${c.id} ${c.name} : ${c.In} A sur ${boardCable(c.S, c.phase)} — Iz = ${_bNum(Iz3, 1)} A en triphasé, section supérieure.`, c.id);
    const L = c.far || c.length || 0, Lmax = calcLmax(c.S, c.In, c.curve);
    if (L > Lmax) push('err', `${c.id} ${c.name} : ${_bNum(L, 1)} m > ${_bNum(Lmax)} m protégés — un court-circuit en bout de ligne (≈ ${_bNum((0.8 * CALC_U0 * c.S) / (2 * CALC_RHO * L))} A) ne ferait pas déclencher le ${c.curve || 'C'}${c.In} (${(CALC_IM[c.curve || 'C'] || 10) * c.In} A) : section supérieure ou calibre inférieur.`, c.id);
  }
  // Différentiels
  const byR = (r) => cs.filter((c) => c.rcd === r.id);
  for (const r of rcds) {
    const n = byR(r).length;
    if (!n) push('info', `${r.id} ne protège aucun circuit.`, r.id);
    if (n > 8) push('err', `${r.id} : ${n} circuits — 8 au plus par interrupteur différentiel.`, r.id);
    const P = byR(r).reduce((s, c) => s + (c.power || 0), 0);
    if (P && (P * 0.6) / U_NOM > r.In) push('warn', `${r.id} ${r.In} A : ${_bNum(P / 1000, 1)} kW en aval — calibre ${r.In < 63 ? '63' : 'supérieur'} A conseillé.`, r.id);
    if (r.sens && r.sens > 30) push('err', `${r.id} : ${r.sens} mA — les circuits terminaux exigent 30 mA.`, r.id);
  }
  const A = design.area || 0;
  const needAC = A <= 35 ? 1 : A <= 100 ? 2 : 3;
  const nAC = rcds.filter((r) => r.type === 'AC' && byR(r).length).length, nA = rcds.filter((r) => r.type !== 'AC' && byR(r).length).length;
  if (A && nAC + nA < needAC + 1) push('warn', `${Math.round(A)} m² : ${needAC + 1} interrupteurs différentiels au moins (${needAC} type AC + 1 type A).`);
  if (cs.some((c) => c.typeA) && !rcds.some((r) => ['A', 'F', 'B'].includes(r.type))) push('err', 'Plaque de cuisson ou lave-linge : un différentiel type A est obligatoire.');
  // Triphasé : départs 3P+N sur un réseau monophasé, déséquilibre des phases
  const tri = design.supply && design.supply.phases === 3;
  for (const c of cs) if (!tri && c.phase === '3P') push('err', `${c.id} ${c.name} : départ triphasé sur une alimentation monophasée.`, c.id);
  if (tri && design.phaseLoad) {
    const L = design.phaseLoad, v = [L.L1, L.L2, L.L3], mx = Math.max(...v), mn = Math.min(...v);
    if (mx > 3000 && mx - mn > 0.3 * mx) push('warn', `Phases déséquilibrées : L1 ${_bNum(L.L1 / 1000, 1)} kW, L2 ${_bNum(L.L2 / 1000, 1)} kW, L3 ${_bNum(L.L3 / 1000, 1)} kW — répartir les gros circuits.`);
  }
  // Prise de terre (schéma TT) : l'AGCP différentiel 500 mA impose RA ≤ 50 V / 0,5 A = 100 Ω
  const ra = design.supply && +design.supply.ra;
  if (ra > 100) push('err', `Prise de terre ${_bNum(ra)} Ω > 100 Ω : avec l’AGCP 500 mA, 50 V / 0,5 A = 100 Ω au plus — ajouter un piquet ou une boucle à fond de fouille.`);
  // Abonnement
  if (design.agcp && design.probable > design.agcp.kva * 1000) push('warn', `Puissance probable ${_bNum(design.probable / 1000, 1)} kW > abonnement ${design.agcp.kva} kVA : le disjoncteur de branchement risque de couper.`);
  // Réserve et options
  const mods = boardModules(design);
  if (mods.reservePct < 20) push('warn', `Réserve de ${mods.reservePct} % : 20 % de modules libres au moins (prévoir ${mods.rowsCount + 1} rangées).`);
  if (!(design.supply && design.supply.surge)) push('info', 'Parafoudre : obligatoire en zone foudroyée AQ2 ou avec une alimentation aérienne, conseillé ailleurs.');
  if (!out.some((o) => o.level === 'err' || o.level === 'warn')) push('ok', `Tableau conforme : ${cs.length} circuits, ${rcds.length} différentiels 30 mA, réserve ${mods.reservePct} %.`);
  return out;
}

// ---------------------------------------------------------------------------
// Face avant : modules sur rail DIN (rangées de 13 modules de 18 mm)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Note de calcul (NF C 15-100, méthode conventionnelle du guide UTE C 15-105)
// ---------------------------------------------------------------------------
// Courant admissible Iz (A) : cuivre isolé PVC, méthode de référence B (conduit
// encastré), 30 °C ; 2 conducteurs chargés en monophasé, 3 en triphasé
const CALC_IZ = { 2: { 1.5: 17.5, 2.5: 24, 4: 32, 6: 41, 10: 57, 16: 76 }, 3: { 1.5: 15.5, 2.5: 21, 4: 28, 6: 36, 10: 50, 16: 68 } };
const CALC_RHO = 0.023;                 // Ω·mm²/m : cuivre en court-circuit (1,25 × ρ à 20 °C)
const CALC_IM = { B: 5, C: 10, D: 20 }; // seuil haut du déclenchement magnétique (× In)
const CALC_U0 = 230;
// Longueur maximale protégée (m) : défaut phase-neutre franc en bout de ligne,
// tension ramenée à 80 % : Icc mini = 0,8·U0·S / (2·ρ·L) doit atteindre Im
function calcLmax(S, In, curve) { return (0.8 * CALC_U0 * S) / (2 * CALC_RHO * (CALC_IM[curve || 'C'] || 10) * In); }
function calcNote(design) {
  const supply = design.supply || {};
  const rows = design.circuits.map((c) => {
    const three = c.phase === '3P', curve = c.curve || 'C';
    const L = c.far || c.length || 0;
    const Iz = CALC_IZ[three ? 3 : 2][c.S] || null;
    const Ib = c.kind === 'socket' ? c.In : (c.power || 0) / (three ? Math.sqrt(3) * U_TRI : CALC_U0);
    const Im = (CALC_IM[curve] || 10) * c.In;
    const Lmax = calcLmax(c.S, c.In, curve);
    const icc = L > 0 ? (0.8 * CALC_U0 * c.S) / (2 * CALC_RHO * L) : null;
    const r = { id: c.id, name: c.name, phase: c.phase || null, kind: c.kind, P: c.power || 0, Ib, In: c.In, curve, S: c.S, cable: boardCable(c.S, c.phase), Iz, L, dU: c.dUpct, dUmax: c.limit, icc, Im, Lmax };
    r.okIz = Iz !== null && c.In <= Iz && Ib <= c.In + 1e-9;
    r.okL = L <= Lmax;
    r.okU = !(c.dUpct > c.limit);
    r.ok = r.okIz && r.okL && r.okU;
    return r;
  });
  return {
    rows, tri: supply.phases === 3, U0: CALC_U0, rho: CALC_RHO,
    ra: supply.ra || null, raMax: 100,    // AGCP différentiel 500 mA : RA ≤ 50 V / 0,5 A
    pdc: 3000,                            // pouvoir de coupure en aval du disjoncteur de branchement
    agcp: design.agcp, probable: design.probable,
    errors: rows.filter((r) => !r.ok).length,
  };
}

const BOARD_ROW = 13;
function boardModules(design) {
  const items = [];
  if (design.supply && design.supply.surge) {
    const tri = design.supply.phases === 3;
    items.push({ kind: 'breaker', w: tri ? 4 : 1, ref: 'QF', text: 'Disj. parafoudre', In: 10 });
    items.push({ kind: 'surge', w: tri ? 4 : 2, ref: 'PF', text: 'Parafoudre' });
  }
  const groups = design.rcds.map((r) => ({ r, cs: design.circuits.filter((c) => c.rcd === r.id) })).filter((g) => g.cs.length);
  const loose = design.circuits.filter((c) => !design.rcds.some((r) => r.id === c.rcd));
  if (loose.length) groups.push({ r: null, cs: loose });
  const rows = [[]];
  let used = 0;
  const room = () => BOARD_ROW - rows[rows.length - 1].reduce((s, m) => s + m.w, 0);
  const put = (m) => { if (room() < m.w) rows.push([]); rows[rows.length - 1].push(m); used += m.w; };
  for (const it of items) put(it);
  for (const g of groups) {
    const mods = [];
    const tri = design.supply && design.supply.phases === 3;
    if (g.r) mods.push({ kind: 'rcd', w: tri ? 4 : 2, ref: g.r.id, text: `${g.r.In} A ${g.r.type}${tri ? ' 4P' : ''}`, rcd: g.r });
    for (const c of g.cs) {
      mods.push({ kind: 'breaker', w: c.phase === '3P' ? 4 : 1, ref: c.id, text: c.name, In: c.In, ct: c, phase: tri ? c.phase : null });
      if (c.contactor) mods.push({ kind: 'contactor', w: 1, ref: 'KM' + c.id.replace(/^C/, ''), text: c.contactor === 'hc' ? 'Contacteur HC' : 'Contacteur', ct: c });
      if (c.teleruptor) mods.push({ kind: 'teleruptor', w: 1, ref: 'KL' + c.id.replace(/^C/, ''), text: 'Télérupteur', ct: c });
    }
    // un différentiel et ses circuits sur la même rangée quand ils y tiennent
    const w = mods.reduce((s, m) => s + m.w, 0);
    if (w <= BOARD_ROW && room() < w && rows[rows.length - 1].length) rows.push([]);
    for (const m of mods) put(m);
  }
  // Réserve : 20 % de modules libres, rangées entières
  const want = design.supply && +design.supply.rows; // coffret choisi (sinon : le plus petit qui garde 20 % de réserve)
  const nRows = Math.max(rows.length, want || Math.ceil(used / 0.8 / BOARD_ROW)); // libre ≥ 20 % du coffret
  while (rows.length < nRows) rows.push([]);
  const total = nRows * BOARD_ROW;
  return { rows, used, total, rowsCount: nRows, reservePct: Math.round(((total - used) / total) * 100), label: `${nRows} rangée${nRows > 1 ? 's' : ''} × ${BOARD_ROW} modules` };
}

// ---------------------------------------------------------------------------
// Folio unifilaire (A3 paysage, unités : point, 1 pt = 0,353 mm)
// ---------------------------------------------------------------------------
const UNI = { W: 1190, H: 842, colW: 34, gap: 14, bus: 232, sub: 356, text: 646, table: 652, row: 12.8 };

// Groupes « différentiel + circuits », répartis sur un ou plusieurs folios
function unifilarLayout(design) {
  const groups = design.rcds.map((r) => ({ r, cs: design.circuits.filter((c) => c.rcd === r.id) })).filter((g) => g.cs.length);
  const loose = design.circuits.filter((c) => !design.rcds.some((r) => r.id === c.rcd));
  if (loose.length) groups.push({ r: null, cs: loose });
  const right = UNI.W - 30, start = (k) => (k ? 120 : 180 + (design.supply && design.supply.surge ? 70 : 0));
  const folios = [{ groups: [] }];
  let x = start(0);
  const maxCols = Math.floor((right - 120) / UNI.colW) - 1;
  for (const g of groups) {
    for (let i = 0; i < g.cs.length; i += maxCols) {
      const cs = g.cs.slice(i, i + maxCols);
      const w = Math.max(cs.length, 2) * UNI.colW;
      if (x + w > right) { folios.push({ groups: [] }); x = start(folios.length - 1); }
      folios[folios.length - 1].groups.push({ r: g.r, cs, x0: x, w, cont: i > 0 });
      x += w + UNI.gap;
    }
  }
  for (const f of folios) {
    const last = f.groups[f.groups.length - 1];
    f.xEnd = last ? last.x0 + Math.max(last.cs.length, 1) * UNI.colW - UNI.colW / 2 : 300;
  }
  return { folios };
}

// Symboles verticaux (CEI 60617) — x : axe, y : borne du haut, h : hauteur
function _uLine(ctx, x1, y1, x2, y2, w) { ctx.lineWidth = w || 1.3; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function _uBreaker(ctx, x, y, h) { // disjoncteur : contact à coupure + croix
  _uLine(ctx, x, y, x, y + 14);
  _uLine(ctx, x - 4, y + 10, x + 4, y + 18); _uLine(ctx, x - 4, y + 18, x + 4, y + 10);
  _uLine(ctx, x, y + h - 14, x - 10, y + 17);
  _uLine(ctx, x, y + h - 14, x, y + h);
}
function _uSwitch(ctx, x, y, h) { // interrupteur (sectionneur) : contact + trait de sectionnement
  _uLine(ctx, x, y, x, y + 14); _uLine(ctx, x - 4, y + 14, x + 4, y + 14);
  _uLine(ctx, x, y + h - 14, x - 10, y + 17);
  _uLine(ctx, x, y + h - 14, x, y + h);
}
function _uTorus(ctx, x, y, bladeY) { // tore différentiel + liaison mécanique
  ctx.lineWidth = 1.1; ctx.beginPath(); ctx.ellipse(x, y, 9, 3.6, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.save(); ctx.setLineDash([2.5, 2]);
  _uLine(ctx, x + 9, y, x + 13, y, 0.9); _uLine(ctx, x + 13, y, x + 13, bladeY, 0.9); _uLine(ctx, x + 13, bladeY, x - 5, bladeY, 0.9);
  ctx.restore();
}
function _uContactor(ctx, x, y, h, tag) { // contacteur / télérupteur : contact « à fermeture » + bobine
  _uLine(ctx, x, y, x, y + 12);
  ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(x, y + 12, 3, Math.PI, 0); ctx.stroke();
  _uLine(ctx, x, y + h - 12, x - 9, y + 15);
  _uLine(ctx, x, y + h - 12, x, y + h);
  ctx.strokeRect(x + 7, y + 18, 11, 8);
  ctx.save(); ctx.setLineDash([2.5, 2]); _uLine(ctx, x + 7, y + 22, x - 4, y + 22, 0.9); ctx.restore();
  ctx.save(); ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(tag, x + 12.5, y + 35); ctx.restore();
}
function _uEarth(ctx, x, y) {
  _uLine(ctx, x, y, x, y + 8);
  _uLine(ctx, x - 9, y + 8, x + 9, y + 8); _uLine(ctx, x - 6, y + 12, x + 6, y + 12); _uLine(ctx, x - 3, y + 16, x + 3, y + 16);
}
function _uArrow(ctx, x, y) { ctx.beginPath(); ctx.moveTo(x - 3.5, y); ctx.lineTo(x + 3.5, y); ctx.lineTo(x, y + 6); ctx.closePath(); ctx.fill(); }

// Cadre A3 et cartouche communs aux folios (unifilaire, note de calcul)
function _uCartouche(ctx, design, meta, subtitle, k, nF) {
  const { W, H } = UNI, ink = '#1a2230', mute = '#5b6b82';
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 9}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const fit = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  ctx.save(); ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6; ctx.strokeRect(15, 15, W - 30, H - 30);
  const cy = H - 15 - 62;
  ctx.lineWidth = 1.2; ctx.strokeRect(15, cy, W - 30, 62);
  for (const cx of [430, 700, 900, 1060]) _uLine(ctx, cx, cy, cx, H - 15, 1);
  const title = (meta && meta.title) || 'Installation électrique';
  text(fit(title, 52), 26, cy + 24, { bold: true, size: 14 });
  text(subtitle, 26, cy + 42, { size: 9.5 });
  text('Dessiné avec ÉlectriCAD', 26, cy + 55, { size: 7.5, color: mute });
  const d0 = design.agcp, tri = design.supply && design.supply.phases === 3;
  text(`${tri ? 'Triphasé 400 V ~ (3P+N)' : 'Monophasé 230 V ~'} · abonnement ${d0.kva} kVA`, 440, cy + 22, { size: 9 });
  text(`AGCP ${d0.setting} A 500 mA · ${design.rcds.length} ID 30 mA · ${design.circuits.length} circuits`, 440, cy + 37, { size: 9 });
  text(`${_bNum(design.cableTotal)} m de câble · puissance probable ${_bNum(design.probable / 1000, 1)} kW`, 440, cy + 52, { size: 8, color: mute });
  const date = (meta && meta.date) || new Date().toISOString().slice(0, 10);
  text('Date', 710, cy + 20, { size: 7.5, color: mute }); text(date, 710, cy + 33, { size: 9.5 });
  text('Auteur', 710, cy + 46, { size: 7.5, color: mute }); text(fit((meta && meta.author) || '—', 26), 710, cy + 57, { size: 9 });
  text('Norme', 910, cy + 20, { size: 7.5, color: mute }); text('NF C 15-100', 910, cy + 34, { size: 10, bold: true });
  text('contrôle simplifié — à faire valider', 910, cy + 48, { size: 7, color: mute }); text('par un professionnel (Consuel)', 910, cy + 57, { size: 7, color: mute });
  // numérotation du dossier complet (meta.sheet : premier folio de la série) ou de la série seule
  const num = meta && meta.sheets ? `${meta.sheet + k} / ${meta.sheets}` : `${k + 1} / ${nF}`;
  text('Folio', 1070, cy + 20, { size: 7.5, color: mute }); text(num, 1117, cy + 48, { size: num.length > 6 ? 18 : 22, bold: true, align: 'center' });
  ctx.restore();
}

function drawUnifilar(ctx, design, meta, folio) {
  const lay = unifilarLayout(design), k = folio || 0, F = lay.folios[k], nF = lay.folios.length;
  const { W, H, colW, bus, sub } = UNI;
  const ink = '#1a2230', mute = '#5b6b82', blue = '#1668c4', red = '#b3261e';
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink;
    ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 9}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    if (o.rot) { ctx.translate(x, y); ctx.rotate(o.rot); ctx.fillText(t, 0, 0); } else ctx.fillText(t, x, y);
    ctx.restore();
  };
  const fit = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const f1 = (v) => _bNum(v, 1);
  ctx.save();
  ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Cadre et cartouche
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Schéma unifilaire du tableau de répartition', k, nF);
  const d0 = design.agcp;
  const tri = design.supply && design.supply.phases === 3;

  // Légende des symboles (premier folio)
  if (k === 0) {
    layer('TEXTES');
    const lx = W - 330, ly = 28;
    ctx.lineWidth = 0.8; ctx.strokeRect(lx, ly, 305, 100);
    text('Légende', lx + 8, ly + 13, { bold: true, size: 8.5 });
    layer('UNIFILAIRE');
    _uBreaker(ctx, lx + 22, ly + 20, 34); text('Disjoncteur', lx + 40, ly + 34, { size: 7.5 }); text('courbe C, calibre en A', lx + 40, ly + 44, { size: 7, color: mute });
    _uSwitch(ctx, lx + 22, ly + 60, 34); _uTorus(ctx, lx + 22, ly + 86, ly + 76); text('Interrupteur', lx + 40, ly + 74, { size: 7.5 }); text('différentiel 30 mA', lx + 40, ly + 84, { size: 7, color: mute });
    _uContactor(ctx, lx + 165, ly + 20, 34, 'KM'); text('Contacteur (HC) /', lx + 192, ly + 34, { size: 7.5 }); text('télérupteur (TL)', lx + 192, ly + 44, { size: 7.5 });
    _uEarth(ctx, lx + 175, ly + 66); text('Terre', lx + 192, ly + 80, { size: 7.5 });
    _uArrow(ctx, lx + 250, ly + 70); text('Départ', lx + 260, ly + 76, { size: 7.5 });
  }

  // Arrivée : réseau, compteur, disjoncteur de branchement (AGCP)
  layer('UNIFILAIRE');
  const sx = 70;
  if (k === 0) {
    text('Réseau public', sx, 34, { align: 'center', size: 8, color: mute }); text(tri ? '3 × 400 V ~ 50 Hz' : '230 V ~ 50 Hz', sx, 44, { align: 'center', size: 8, color: mute });
    _uLine(ctx, sx, 50, sx, 68, 2);
    ctx.lineWidth = 1.4; ctx.strokeRect(sx - 17, 68, 34, 24);
    text('kWh', sx, 84, { align: 'center', size: 8.5, bold: true });
    text('Compteur', sx + 24, 78, { size: 8 }); text('communicant', sx + 24, 88, { size: 7.5, color: mute });
    _uLine(ctx, sx, 92, sx, 112, 2);
    _uBreaker(ctx, sx, 112, 56); _uTorus(ctx, sx, 112 + 44, 112 + 32);
    text('AGCP', sx + 24, 128, { bold: true, size: 9 });
    text(`${tri ? '4P' : '2P'} ${d0.setting} A`, sx + 24, 139, { size: 8 }); text('500 mA sélectif', sx + 24, 149, { size: 8 });
    text(`${d0.kva} kVA`, sx + 24, 159, { size: 8, color: mute });
    _uLine(ctx, sx, 168, sx, bus, 2);
    // Parafoudre (tête de tableau) et terre
    if (design.supply && design.supply.surge) {
      const px = 150;
      _uLine(ctx, px, bus, px, bus + 16, 1.4);
      _uBreaker(ctx, px, bus + 16, 50); text('QF', px + 6, bus + 40, { size: 7.5, bold: true }); text('C10', px + 6, bus + 50, { size: 7.5 });
      ctx.lineWidth = 1.3; ctx.strokeRect(px - 7, bus + 72, 14, 28);
      _uLine(ctx, px, bus + 78, px - 3, bus + 86, 1); _uLine(ctx, px - 3, bus + 86, px + 3, bus + 86, 1); _uLine(ctx, px + 3, bus + 86, px, bus + 95, 1);
      text('Parafoudre', px + 10, bus + 84, { size: 7.5 }); text('type 2', px + 10, bus + 94, { size: 7.5, color: mute });
      _uLine(ctx, px, bus + 100, px, bus + 112, 1.3); _uEarth(ctx, px, bus + 112);
    }
    // Terre : borne principale et prise de terre
    const ex = 44, ey = 470;
    ctx.lineWidth = 1.2; ctx.strokeRect(ex - 22, ey, 44, 12);
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(ex - 16 + i * 8, ey + 6, 2, 0, Math.PI * 2); ctx.stroke(); }
    text('Borne principale de terre', ex - 22, ey - 6, { size: 7.5 });
    _uLine(ctx, ex, ey + 12, ex, ey + 40, 1.4); _uEarth(ctx, ex, ey + 40);
    text('Prise de terre', ex + 14, ey + 50, { size: 7.5 }); text('R ≤ 100 Ω', ex + 14, ey + 60, { size: 7.5, color: mute });
    text('Conducteur de terre 16 mm² Cu', ex - 22, ey + 80, { size: 7, color: mute });
    text('Liaison équipotentielle principale', ex - 22, ey + 90, { size: 7, color: mute });
  } else {
    text(`Suite du folio ${k}`, 30, bus - 8, { size: 8, color: mute });
    _uLine(ctx, 30, bus, 100, bus, 2.4);
  }
  // Barre principale (jeu de barres / peigne)
  const busX0 = k === 0 ? sx : 30;
  _uLine(ctx, busX0, bus, F.xEnd + 10, bus, 2.4);
  if (tri) { // barre 3P+N : quatre traits obliques
    for (let i = 0; i < 4; i++) _uLine(ctx, busX0 + 40 + i * 5, bus + 5, busX0 + 46 + i * 5, bus - 5, 1);
    layer('TEXTES'); text('3P+N', busX0 + 34, bus - 9, { size: 7.5, color: mute }); layer('UNIFILAIRE');
  }
  if (k < nF - 1) { text(`Suite folio ${k + 2} →`, F.xEnd + 14, bus + 4, { size: 8, color: mute }); }

  // Différentiels et départs
  for (const g of F.groups) {
    const xs = g.cs.map((c, i) => g.x0 + colW / 2 + i * colW);
    const xc = g.cs.length > 1 ? (xs[0] + xs[xs.length - 1]) / 2 : xs[0];
    layer('UNIFILAIRE');
    _uLine(ctx, xc, bus, xc, bus + 16, 1.6);
    if (g.r) {
      ctx.strokeStyle = blue; ctx.fillStyle = blue;
      _uSwitch(ctx, xc, bus + 16, 56); _uTorus(ctx, xc, bus + 16 + 44, bus + 16 + 32);
      ctx.strokeStyle = ink; ctx.fillStyle = ink;
      layer('TEXTES');
      const tx = xc + 17;
      text(g.r.id + (g.cont ? ' (suite)' : ''), tx, bus + 34, { bold: true, size: 9, color: blue });
      text(`${g.r.In} A${tri ? ' 4P' : ''}`, tx, bus + 45, { size: 8 }); text(`${g.r.sens || 30} mA`, tx, bus + 55, { size: 8 });
      text(`type ${g.r.type}`, tx, bus + 65, { size: 8 });
    } else {
      layer('TEXTES');
      text('Sans différentiel !', xc + 6, bus + 40, { size: 8, bold: true, color: red });
      layer('UNIFILAIRE');
      _uLine(ctx, xc, bus + 16, xc, bus + 72, 1.6);
    }
    layer('UNIFILAIRE');
    _uLine(ctx, xc, bus + 72, xc, sub, 1.6);
    if (xs.length > 1) _uLine(ctx, xs[0], sub, xs[xs.length - 1], sub, 1.8);
    g.cs.forEach((c, i) => {
      const x = xs[i];
      layer('UNIFILAIRE');
      _uLine(ctx, x, sub, x, sub + 14, 1.3);
      _uBreaker(ctx, x, sub + 14, 50);
      layer('TEXTES');
      text(`${c.curve || 'C'}${c.In}`, x + 4, sub + 34, { size: 7.5, bold: true });
      if (tri && c.phase) text(c.phase === '3P' ? '3P+N' : c.phase, x + 4, sub + 44, { size: 7, color: c.phase === '3P' ? ink : mute });
      layer('UNIFILAIRE');
      let y = sub + 64;
      if (c.contactor || c.teleruptor) { _uContactor(ctx, x, y + 4, 38, c.contactor ? (c.contactor === 'hc' ? 'HC' : 'KM') : 'TL'); _uLine(ctx, x, y, x, y + 4, 1.3); y += 42; }
      else { _uLine(ctx, x, y, x, y + 42, 1.3); y += 42; }
      _uLine(ctx, x, y, x, y + 10, 1.3); _uArrow(ctx, x, y + 10);
      if (c.phase === '3P') for (let i = 0; i < 4; i++) _uLine(ctx, x - 5, y - 26 + i * 4, x + 5, y - 30 + i * 4, 0.9); // 3 phases + neutre
      layer('TEXTES');
      const detail = `${boardCable(c.S, c.phase)} · ${f1(c.length)} m` + (c.rooms ? ' · ' + c.rooms : '');
      text(fit(c.name, 30), x - 2, UNI.text, { rot: -Math.PI / 2, bold: true, size: 8.5 });
      text(fit(detail, 40), x + 8, UNI.text, { rot: -Math.PI / 2, size: 7, color: mute });
    });
  }

  // Nomenclature des départs
  layer('CARTOUCHE');
  const rowsT = [['Repère', (c) => c.id], ['Protection', (c) => `${c.curve || 'C'}${c.In} A`], ['Différentiel', (c) => c.rcd || '—'], ['Câble', (c) => boardCable(c.S, c.phase)],
    ['Longueur', (c) => f1(c.length) + ' m'], ['Charge', (c) => (c.kind === 'light' ? c.points + ' pts' : c.kind === 'socket' ? c.points + ' PC' : c.power >= 1000 ? f1(c.power / 1000) + ' kW' : Math.round(c.power) + ' W')],
    ['ΔU', (c) => f1(c.dUpct) + ' %']];
  if (tri) rowsT.splice(3, 0, ['Phase', (c) => (c.phase === '3P' ? '3P+N' : c.phase || '—')]);
  const t0 = UNI.table, rh = UNI.row, tx0 = 22, tx1 = F.xEnd + colW / 2;
  ctx.lineWidth = 0.8;
  for (let r = 0; r <= rowsT.length; r++) _uLine(ctx, tx0, t0 + r * rh, tx1, t0 + r * rh, r === 0 || r === rowsT.length ? 1.1 : 0.6);
  _uLine(ctx, tx0, t0, tx0, t0 + rowsT.length * rh, 1.1); _uLine(ctx, tx1, t0, tx1, t0 + rowsT.length * rh, 1.1);
  _uLine(ctx, 96, t0, 96, t0 + rowsT.length * rh, 0.8);
  layer('TEXTES');
  rowsT.forEach(([lab], r) => text(lab, tx0 + 5, t0 + r * rh + 9.5, { size: 7.5, bold: true }));
  for (const g of F.groups) {
    g.cs.forEach((c, i) => {
      const x = g.x0 + colW / 2 + i * colW;
      layer('CARTOUCHE');
      _uLine(ctx, x - colW / 2, t0, x - colW / 2, t0 + rowsT.length * rh, 0.4);
      layer('TEXTES');
      rowsT.forEach(([, f], r) => text(f(c), x, t0 + r * rh + 9.5, { size: 6.8, align: 'center', bold: r === 0, color: r === 6 && c.ok === false ? red : ink }));
    });
  }
  ctx.restore();
}

// Folios en SVG (un par page A3), ou tous empilés dans un seul fichier
function unifilarSVGs(design, meta) {
  const n = unifilarLayout(design).folios.length, out = [];
  for (let k = 0; k < n; k++) {
    const ctx = new SVGContext();
    drawUnifilar(ctx, design, meta, k);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${UNI.H}" width="420mm" height="297mm" font-family="sans-serif"><rect width="${UNI.W}" height="${UNI.H}" fill="#fff"/>${ctx.out.join('')}</svg>`);
  }
  return out;
}
function unifilarSVG(design, meta) {
  const pages = unifilarSVGs(design, meta);
  if (pages.length === 1) return pages[0];
  const H = UNI.H + 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${pages.length * H}" width="420mm" height="${pages.length * 305}mm" font-family="sans-serif">` +
    pages.map((p, k) => `<g transform="translate(0 ${k * H})">${p.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`).join('') + '</svg>';
}

// Folios en DXF : en millimètres, calques UNIFILAIRE / TEXTES / CARTOUCHE, folios l'un sous l'autre
function unifilarDXF(design, meta) {
  const ctx = new DXFContext();
  const n = unifilarLayout(design).folios.length;
  for (let k = 0; k < n; k++) {
    ctx.save(); ctx.translate(0, k * (UNI.H + 60));
    drawUnifilar(ctx, design, meta, k);
    ctx.restore();
  }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, {
    U: 1 / 0.3528, insunits: 4, layers: [['UNIFILAIRE', 7], ['TEXTES', 2], ['CARTOUCHE', 8]],
  });
}

// Note de calcul en folios A3 : hypothèses, formules, un tableau des circuits
const CALC_ROWS = 34; // lignes par folio
function calcNoteFolios(design) { return Math.max(1, Math.ceil(design.circuits.length / CALC_ROWS)); }
function drawCalcNote(ctx, design, meta, folio) {
  const N = calcNote(design), k = folio || 0, nF = calcNoteFolios(design);
  const ink = '#1a2230', mute = '#5b6b82', red = '#b3261e', green = '#1e7b34';
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 9}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const f1 = (v) => _bNum(v, 1), f0 = (v) => _bNum(v);
  ctx.save(); ctx.strokeStyle = ink; ctx.lineCap = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Note de calcul des circuits (sections et protections)', k, nF);
  layer('TEXTES');
  text('Note de calcul', 30, 46, { bold: true, size: 17 });
  text('NF C 15-100 — méthode conventionnelle du guide UTE C 15-105 · protection contre les surcharges, les courts-circuits, les contacts indirects ; chute de tension', 170, 45, { size: 8.5, color: mute });
  // Hypothèses et formules
  const bx = 30, by = 60, bh = 124;
  layer('CARTOUCHE');
  ctx.lineWidth = 0.8; ctx.strokeRect(bx, by, 560, bh); ctx.strokeRect(bx + 570, by, 560, bh);
  layer('TEXTES');
  const a = N.agcp || { kva: 0, setting: 0 };
  const ra = N.ra ? `RA = ${f0(N.ra)} Ω mesurée — ${N.ra <= N.raMax ? 'conforme' : 'trop élevée'} (${N.raMax} Ω au plus)` : `RA à mesurer au raccordement : ${N.raMax} Ω au plus`;
  const hyp = [
    ['Alimentation', `${N.tri ? 'triphasée 400 V ~ (3P+N)' : 'monophasée 230 V ~'}, abonnement ${a.kva} kVA, AGCP ${N.tri ? '4P' : '2P'} ${a.setting} A différentiel 500 mA`],
    ['Schéma des liaisons', `TT : ${ra}`],
    ['', `RA · IΔn ≤ 50 V : 100 Ω pour l’AGCP 500 mA, 1 667 Ω pour les ID 30 mA`],
    ['Pouvoir de coupure', '3 kA au moins en aval du disjoncteur de branchement (NF EN 60898-1 « 3000 »)'],
    ['Câbles', `cuivre isolé PVC en conduit encastré, méthode B, 30 °C, ${N.tri ? '2 ou 3' : '2'} conducteurs chargés`],
    ['Puissance probable', `${f1((N.probable || 0) / 1000)} kW (foisonnement appliqué)`],
    ['Longueur L', 'jusqu’à l’appareil le plus éloigné du circuit (mesurée sur le plan)'],
  ];
  text('Hypothèses', bx + 8, by + 15, { bold: true, size: 9.5 });
  hyp.forEach(([h, v], i) => { if (h) text(h, bx + 8, by + 32 + i * 13, { size: 8, bold: true }); text(v, bx + 118, by + 32 + i * 13, { size: 8 }); });
  const fx = bx + 578;
  text('Formules et critères', fx, by + 15, { bold: true, size: 9.5 });
  const frm = [
    ['Surcharges', 'Ib ≤ In ≤ Iz (prises : Ib = In) ; Iz selon la section et le nombre de conducteurs chargés'],
    ['Chute de tension', `ΔU = b · ρ1 · L · Ib / S ; b = 2 (mono) ou √3 (tri sous 400 V) ; ρ1 = ${_bNum(RHO_CU, 4)} Ω·mm²/m`],
    ['', 'ΔU ≤ 3 % pour l’éclairage, 5 % pour les autres usages'],
    ['Court-circuit mini', `Icc mini = 0,8 · U0 · S / (2 · ρ · L) ; U0 = ${N.U0} V ; ρ = ${_bNum(N.rho, 3)} Ω·mm²/m (1,25 × ρ20)`],
    ['Longueur protégée', 'Lmax = 0,8 · U0 · S / (2 · ρ · Im) : le magnétique déclenche si L ≤ Lmax'],
    ['', 'Im = 5 In (courbe B), 10 In (courbe C), 20 In (courbe D)'],
    ['Contacts indirects', 'ID 30 mA sur tous les circuits terminaux (coupure automatique)'],
  ];
  frm.forEach(([h, v], i) => { if (h) text(h, fx, by + 32 + i * 13, { size: 8, bold: true }); text(v, fx + 104, by + 32 + i * 13, { size: 8 }); });
  // Tableau des circuits
  const cols = [
    ['Repère', 46, (r) => r.id, { bold: true }],
    ['Circuit', 176, (r) => (r.name.length > 34 ? r.name.slice(0, 33) + '…' : r.name)],
  ];
  if (N.tri) cols.push(['Phase', 40, (r) => (r.phase === '3P' ? '3P+N' : r.phase || '—')]);
  cols.push(
    ['P (W)', 54, (r) => (r.P ? f0(r.P) : '—'), { right: true }],
    ['Ib (A)', 46, (r) => f1(r.Ib), { right: true }],
    ['Protection', 60, (r) => `${r.curve}${r.In} A`],
    ['Câble', 56, (r) => r.cable],
    ['Iz (A)', 46, (r) => (r.Iz ? f1(r.Iz) : '—'), { right: true, bad: (r) => !r.okIz }],
    ['L (m)', 46, (r) => f1(r.L), { right: true, bad: (r) => !r.okL }],
    ['ΔU (%)', 62, (r) => `${f1(r.dU)} / ${r.dUmax}`, { right: true, bad: (r) => !r.okU }],
    ['Icc mini (A)', 64, (r) => (r.icc ? f0(r.icc) : '—'), { right: true, bad: (r) => !r.okL }],
    ['Im (A)', 50, (r) => f0(r.Im), { right: true }],
    ['Lmax (m)', 56, (r) => f0(r.Lmax), { right: true, bad: (r) => !r.okL }],
  );
  const tx0 = 30, tx1 = UNI.W - 30, ty = 204, hh = 22, rh = 15;
  const used = cols.reduce((s, c) => s + c[1], 0);
  cols.push(['Vérification', tx1 - tx0 - used, (r) => (r.ok ? 'conforme' : [!r.okIz && 'In > Iz', !r.okL && 'L > Lmax', !r.okU && 'ΔU'].filter(Boolean).join(' · ')), { verdict: true }]);
  const rows = N.rows.slice(k * CALC_ROWS, (k + 1) * CALC_ROWS);
  const y1 = ty + hh + rows.length * rh;
  // fond de l'en-tête et lignes alternées (SVG seulement : le DXF garde le trait)
  if (!('layer' in ctx)) {
    ctx.fillStyle = '#e8eef6'; ctx.beginPath(); ctx.rect(tx0, ty, tx1 - tx0, hh); ctx.fill();
    ctx.fillStyle = '#f5f7fa';
    rows.forEach((r, i) => { if (i % 2) { ctx.beginPath(); ctx.rect(tx0, ty + hh + i * rh, tx1 - tx0, rh); ctx.fill(); } });
    ctx.fillStyle = '#fbe9e7';
    rows.forEach((r, i) => { if (!r.ok) { ctx.beginPath(); ctx.rect(tx0, ty + hh + i * rh, tx1 - tx0, rh); ctx.fill(); } });
  }
  layer('CARTOUCHE');
  ctx.strokeStyle = ink;
  _uLine(ctx, tx0, ty, tx1, ty, 1.1); _uLine(ctx, tx0, ty + hh, tx1, ty + hh, 1); _uLine(ctx, tx0, y1, tx1, y1, 1.1);
  for (let i = 1; i < rows.length; i++) _uLine(ctx, tx0, ty + hh + i * rh, tx1, ty + hh + i * rh, 0.4);
  let x = tx0;
  for (const c of cols) { _uLine(ctx, x, ty, x, y1, x === tx0 ? 1.1 : 0.5); x += c[1]; }
  _uLine(ctx, tx1, ty, tx1, y1, 1.1);
  layer('TEXTES');
  x = tx0;
  for (const [lab, w, f, o] of cols) {
    const oo = o || {};
    text(lab, oo.right ? x + w - 5 : x + 5, ty + 14.5, { bold: true, size: 8, align: oo.right ? 'right' : 'left' });
    rows.forEach((r, i) => {
      const y = ty + hh + i * rh + 10.8, bad = oo.bad && oo.bad(r);
      const color = oo.verdict ? (r.ok ? green : red) : bad ? red : ink;
      text(String(f(r)), oo.right ? x + w - 5 : x + 5, y, { size: 8, bold: oo.bold || bad || (oo.verdict && !r.ok), color, align: oo.right ? 'right' : 'left' });
    });
    x += w;
  }
  // Bilan
  const nOk = N.rows.filter((r) => r.ok).length;
  const yb = Math.min(y1 + 22, UNI.H - 90);
  if (k === nF - 1) {
    text(nOk === N.rows.length ? `Les ${N.rows.length} circuits satisfont aux quatre critères (surcharge, court-circuit, chute de tension, contacts indirects par ID 30 mA).`
      : `${N.rows.length - nOk} circuit${N.rows.length - nOk > 1 ? 's' : ''} sur ${N.rows.length} à revoir : augmenter la section, réduire le calibre ou raccourcir la ligne.`, tx0, yb, { size: 9, bold: true, color: nOk === N.rows.length ? green : red });
    // Bilan de puissance : abonnement, courant d'emploi, répartition des phases
    const P = N.probable || 0, kva = a.kva || 0;
    const lines = [`Puissance probable ${f1(P / 1000)} kW pour un abonnement de ${kva} kVA : ${P <= kva * 1000 ? 'suffisant' : 'insuffisant, le disjoncteur de branchement risque de couper'}.`];
    if (N.tri && design.phaseLoad) {
      const L = design.phaseLoad;
      lines.push(`Répartition des phases (puissances installées) : L1 ${f1(L.L1 / 1000)} kW · L2 ${f1(L.L2 / 1000)} kW · L3 ${f1(L.L3 / 1000)} kW — AGCP réglé à ${a.setting} A par phase.`);
    } else lines.push(`Courant d’emploi probable ${f1(P / N.U0)} A pour un AGCP réglé à ${a.setting} A.`);
    lines.forEach((l, i) => text(l, tx0, yb + 18 + i * 13, { size: 8.5 }));
  } else text(`Suite folio ${k + 2} →`, tx1, yb, { size: 8, color: mute, align: 'right' });
  ctx.restore();
}
function calcNoteSVGs(design, meta) {
  const out = [];
  for (let k = 0; k < calcNoteFolios(design); k++) {
    const ctx = new SVGContext();
    drawCalcNote(ctx, design, meta, k);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${UNI.H}" width="420mm" height="297mm" font-family="sans-serif"><rect width="${UNI.W}" height="${UNI.H}" fill="#fff"/>${ctx.out.join('')}</svg>`);
  }
  return out;
}
function calcNoteDXF(design, meta) {
  const ctx = new DXFContext(), n = calcNoteFolios(design);
  for (let k = 0; k < n; k++) { ctx.save(); ctx.translate(0, k * (UNI.H + 60)); drawCalcNote(ctx, design, meta, k); ctx.restore(); }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, { U: 1 / 0.3528, insunits: 4, layers: [['TEXTES', 7], ['CARTOUCHE', 8]] });
}
// Tableur (séparateur « ; », virgule décimale)
function calcNoteCSV(design) {
  const N = calcNote(design), n = (v, d) => (v === null || v === undefined ? '' : Number(v).toFixed(d || 0).replace('.', ','));
  let csv = 'Repère;Circuit;Phase;P (W);Ib (A);Protection;Câble;Iz (A);L (m);ΔU (%);ΔU max (%);Icc mini (A);Im (A);Lmax (m);Vérification\n';
  for (const r of N.rows) {
    csv += `"${r.id}";"${r.name.replace(/"/g, '""')}";${r.phase === '3P' ? '3P+N' : r.phase || ''};${n(r.P)};${n(r.Ib, 1)};${r.curve}${r.In};${r.cable};${n(r.Iz, 1)};${n(r.L, 1)};${n(r.dU, 2)};${r.dUmax};${n(r.icc)};${n(r.Im)};${n(r.Lmax)};"${r.ok ? 'conforme' : [!r.okIz && 'In > Iz', !r.okL && 'L > Lmax', !r.okU && 'ΔU'].filter(Boolean).join(' · ')}"\n`;
  }
  return csv;
}

// ---------------------------------------------------------------------------
// Schémas développés des commandes d'éclairage : pour chaque pièce, entre la
// phase et le neutre, les commandes (simple allumage, va-et-vient, télérupteur
// et ses poussoirs) et les points lumineux, conducteurs en couleur.
// ---------------------------------------------------------------------------
const DEV_KIND = { sa: 'Simple allumage', vv: 'Va-et-vient', tl: 'Télérupteur', direct: 'Sans commande' };
function lightingControls(design, components, wires) {
  const byId = {};
  for (const c of components || []) byId[c.id] = c;
  const info = wires && wires.some((w) => w.kind === 'wall') ? computeRooms(components, wires) : null;
  const roomOf = (c) => {
    if (!info) return -1;
    if (c.ctrl) { const i = info.rooms.findIndex((r) => r.id === c.ctrl); if (i >= 0) return i; }
    return roomAt(info, c.x, c.y);
  };
  const out = [];
  for (const ct of design.circuits.filter((c) => c.kind === 'light')) {
    const devs = ct.devices.map((id) => byId[id]).filter(Boolean);
    const lamps = devs.filter((c) => LOADS[c.type] && LOADS[c.type].cls === 'light');
    const sws = devs.filter((c) => SWITCHES_PLAN.has(c.type));
    if (!lamps.length) { // tableau sans plan : une commande type par circuit
      const n = Math.max(1, Math.min(ct.points || 1, 8));
      out.push({ ct, room: ct.rooms || ct.name, lamps: Array.from({ length: n }, (_, i) => 'E' + (i + 1)), switches: ct.teleruptor ? ['S1', 'S2', 'S3'] : ['S1'], kind: ct.teleruptor ? 'tl' : 'sa', generic: true });
      continue;
    }
    const groups = new Map();
    for (const c of lamps) { const r = roomOf(c); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); }
    // le télérupteur du circuit commande la pièce qui a le plus de commandes (deux au moins)
    const nSw = (r) => sws.filter((c) => roomOf(c) === r).length;
    const maxSw = Math.max(0, ...[...groups.keys()].map(nSw));
    for (const [r, g] of groups) {
      const sw = sws.filter((c) => roomOf(c) === r);
      const kind = sw.length >= 3 || (ct.teleruptor && sw.length >= 2 && sw.length === maxSw) ? 'tl' : sw.length === 2 ? 'vv' : sw.length === 1 ? 'sa' : 'direct';
      out.push({ ct, room: r >= 0 ? info.rooms[r].name : ct.name, lamps: g.map((c) => c.label || c.id), switches: sw.map((c) => c.label || c.id), kind, tlAdvice: kind === 'tl' && !ct.teleruptor });
    }
  }
  return out;
}
const DEV_COLS = 5, DEV_ROWS = 2, DEV_PER = DEV_COLS * DEV_ROWS;
const DEV_COLORS = { L: '#b3261e', N: '#1668c4', ret: '#d97706', nav: '#7c3aed' };
function devFolios(list) { return Math.max(1, Math.ceil(list.length / DEV_PER)); }
function _dNO(ctx, x, y, h, push) { // contact à fermeture vertical (poussoir : organe de manœuvre)
  _uLine(ctx, x, y, x, y + h * 0.3, 1.3); _uLine(ctx, x, y + h * 0.7, x, y + h, 1.3);
  _uLine(ctx, x, y + h * 0.7, x - h * 0.28, y + h * 0.26, 1.3);
  if (push) { const mx = x - h * 0.14, my = y + h * 0.48; _uLine(ctx, mx, my, mx - 12, my, 1); _uLine(ctx, mx - 12, my - 5, mx - 12, my + 5, 1.3); }
}
function _dLamp(ctx, x, y) { // lampe : cercle et croix (CEI 60617)
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
  const d = 6.4; _uLine(ctx, x - d, y - d, x + d, y + d, 1); _uLine(ctx, x - d, y + d, x + d, y - d, 1);
}
function drawDeveloped(ctx, design, meta, list, folio) {
  const k = folio || 0, nF = devFolios(list);
  const ink = '#1a2230', mute = '#5b6b82', red = '#b3261e';
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 8}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const fit = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const wire = (color, pts) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.restore(); };
  const dot = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); };
  ctx.save(); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Schémas développés des commandes d’éclairage', k, nF);
  layer('TEXTES');
  text('Schémas développés — commandes d’éclairage', 30, 46, { bold: true, size: 17 });
  const leg = [['Phase', DEV_COLORS.L, 'rouge ou marron'], ['Neutre', DEV_COLORS.N, 'bleu clair (obligatoire)'], ['Retour lampe', DEV_COLORS.ret, 'orange'], ['Navettes', DEV_COLORS.nav, 'violet ou noir']];
  let lx = 480;
  for (const [n, c, t] of leg) { layer('SCHEMA'); wire(c, [[lx, 42], [lx + 22, 42]]); layer('TEXTES'); text(`${n} : ${t}`, lx + 28, 45, { size: 8.5 }); lx += 28 + 8.5 * 0.52 * (n.length + t.length + 3) + 18; }
  text('Conducteur de protection vert / jaune jusqu’à chaque point lumineux (non représenté) · 1,5 mm², 8 points au plus par circuit', 30, 62, { size: 8, color: mute });
  const x0 = 30, y0 = 74, cw = (UNI.W - 60) / DEV_COLS, ch = (UNI.H - 15 - 62 - 10 - y0) / DEV_ROWS;
  list.slice(k * DEV_PER, (k + 1) * DEV_PER).forEach((g, i) => {
    const cx = x0 + (i % DEV_COLS) * cw, cy = y0 + Math.floor(i / DEV_COLS) * ch;
    const ct = g.ct, yL = cy + 58, yN = cy + ch - 26, yLamp = yN - 46;
    layer('CARTOUCHE'); ctx.lineWidth = 0.6; ctx.strokeRect(cx + 3, cy + 3, cw - 6, ch - 6);
    layer('TEXTES');
    text(fit(`${ct.id} · ${g.room}`, 34), cx + 12, cy + 20, { bold: true, size: 10 });
    text(`${DEV_KIND[g.kind]}${g.kind === 'tl' ? ` · ${g.switches.length} poussoir${g.switches.length > 1 ? 's' : ''}` : ''} — ${ct.curve || 'C'}${ct.In} · ${boardCable(ct.S)}`, cx + 12, cy + 33, { size: 8, color: mute });
    // rails
    layer('SCHEMA');
    wire(DEV_COLORS.L, [[cx + 22, yL], [cx + cw - 14, yL]]); wire(DEV_COLORS.N, [[cx + 22, yN], [cx + cw - 14, yN]]);
    const phName = ct.phase && ct.phase !== '3P' ? ct.phase : 'L'; // triphasé : phase du circuit
    layer('TEXTES'); text(phName, cx + (phName.length > 1 ? 6 : 10), yL + 3.5, { bold: true, size: 9, color: DEV_COLORS.L }); text('N', cx + 10, yN + 3.5, { bold: true, size: 9, color: DEV_COLORS.N });
    // points lumineux en parallèle à partir de xs, alimentés par le retour à yBus
    const lamps = (xs, yBus, xFrom) => {
      const room = Math.max(1, Math.floor((cx + cw - 22 - xs) / 34) + 1), n = Math.min(g.lamps.length, room);
      const xl = Array.from({ length: n }, (_, j) => xs + j * 34);
      layer('SCHEMA');
      wire(DEV_COLORS.ret, [[xFrom, yBus], [xl[n - 1], yBus]]);
      xl.forEach((x, j) => {
        wire(DEV_COLORS.ret, [[x, yBus], [x, yLamp - 9]]); if (j && x !== xFrom) { ctx.fillStyle = DEV_COLORS.ret; dot(x, yBus); ctx.fillStyle = ink; }
        _dLamp(ctx, x, yLamp);
        wire(DEV_COLORS.N, [[x, yLamp + 9], [x, yN]]); ctx.fillStyle = DEV_COLORS.N; dot(x, yN); ctx.fillStyle = ink;
        layer('TEXTES'); text(fit(g.lamps[j], 7), x + 11, yLamp - 10, { size: 7 }); layer('SCHEMA');
      });
      if (g.lamps.length > n) { layer('TEXTES'); text(`+ ${g.lamps.length - n}`, xl[n - 1] + 12, yLamp + 16, { size: 7.5, bold: true }); }
    };
    const x = cx + 52;
    layer('SCHEMA');
    if (g.kind === 'direct') {
      wire(DEV_COLORS.L, [[x, yL], [x, yL + 70]]); ctx.fillStyle = DEV_COLORS.L; dot(x, yL); ctx.fillStyle = ink;
      lamps(x, yL + 70, x);
      layer('TEXTES'); text('Aucune commande dans la pièce : prévoir un interrupteur.', cx + 12, cy + ch - 10, { size: 7.5, color: red });
    } else if (g.kind === 'sa') {
      wire(DEV_COLORS.L, [[x, yL], [x, yL + 24]]); ctx.fillStyle = DEV_COLORS.L; dot(x, yL); ctx.fillStyle = ink;
      _dNO(ctx, x, yL + 24, 44);
      layer('TEXTES'); text(g.switches[0] || 'S1', x + 8, yL + 50, { size: 7.5, bold: true }); layer('SCHEMA');
      wire(DEV_COLORS.ret, [[x, yL + 68], [x, yL + 110]]);
      lamps(x, yL + 110, x);
    } else if (g.kind === 'vv') {
      const y1 = yL + 22, y2 = y1 + 84;
      wire(DEV_COLORS.L, [[x, yL], [x, y1]]); ctx.fillStyle = DEV_COLORS.L; dot(x, yL); ctx.fillStyle = ink;
      // S1 : commun en haut, deux sorties (navettes) ; S2 : deux entrées, commun en bas
      _uLine(ctx, x, y1, x - 10, y1 + 24, 1.3);
      for (const sx of [-12, 12]) { ctx.beginPath(); ctx.arc(x + sx, y1 + 28, 2, 0, Math.PI * 2); ctx.stroke(); wire(DEV_COLORS.nav, [[x + sx, y1 + 30], [x + sx, y2 - 2]]); ctx.beginPath(); ctx.arc(x + sx, y2, 2, 0, Math.PI * 2); ctx.stroke(); }
      _uLine(ctx, x, y2 + 28, x - 10, y2 + 4, 1.3);
      layer('TEXTES');
      text(g.switches[0] || 'S1', x + 18, y1 + 14, { size: 7.5, bold: true }); text(g.switches[1] || 'S2', x + 18, y2 + 22, { size: 7.5, bold: true });
      text('navettes', x + 16, (y1 + y2) / 2 + 12, { size: 7, color: DEV_COLORS.nav });
      layer('SCHEMA');
      wire(DEV_COLORS.ret, [[x, y2 + 28], [x, y2 + 44]]);
      lamps(x, y2 + 44, x);
    } else { // télérupteur : poussoirs en parallèle sur la bobine, contact KL sur les lampes
      const nP = Math.min(g.switches.length, 4), xc = cx + 44, yA = yL + 18, yB = yA + 54;
      const xp = xc + Math.max(nP - 1, 1) * 26 + 34;
      wire(DEV_COLORS.L, [[xc, yL], [xc, yA]]); ctx.fillStyle = DEV_COLORS.L; dot(xc, yL); ctx.fillStyle = ink;
      if (nP > 1) { wire(DEV_COLORS.L, [[xc, yA], [xc + (nP - 1) * 26, yA]]); wire(DEV_COLORS.ret, [[xc, yB], [xc + (nP - 1) * 26, yB]]); }
      for (let j = 0; j < nP; j++) {
        const px = xc + j * 26;
        _dNO(ctx, px, yA, yB - yA, true);
        layer('TEXTES'); text(fit(g.switches[j], 6), px + 3, yA + 12, { size: 6.5, bold: true }); layer('SCHEMA');
      }
      if (g.switches.length > nP) { layer('TEXTES'); text(`+ ${g.switches.length - nP}`, xc + (nP - 1) * 26 + 6, yB + 12, { size: 7 }); layer('SCHEMA'); }
      const yC = yB + 22;
      wire(DEV_COLORS.ret, [[xc, yB], [xc, yC]]);
      ctx.lineWidth = 1.3; ctx.strokeRect(xc - 9, yC, 18, 26);
      layer('TEXTES'); text('KL', xc - 22, yC + 16, { size: 7.5, bold: true, align: 'right' }); layer('SCHEMA');
      wire(DEV_COLORS.N, [[xc, yC + 26], [xc, yN]]); ctx.fillStyle = DEV_COLORS.N; dot(xc, yN); ctx.fillStyle = ink;
      // circuit de puissance
      wire(DEV_COLORS.L, [[xp, yL], [xp, yL + 20]]); ctx.fillStyle = DEV_COLORS.L; dot(xp, yL); ctx.fillStyle = ink;
      _dNO(ctx, xp, yL + 20, 44);
      layer('TEXTES'); text('KL', xp + 8, yL + 46, { size: 7.5, bold: true }); layer('SCHEMA');
      ctx.save(); ctx.setLineDash([3, 2.5]); _uLine(ctx, xc + 9, yC + 13, xp - 6, yL + 42, 0.8); ctx.restore();
      wire(DEV_COLORS.ret, [[xp, yL + 64], [xp, yL + 96]]);
      lamps(xp, yL + 96, xp);
      if (g.tlAdvice) { layer('TEXTES'); text(`${g.switches.length} commandes : télérupteur à ajouter (TL) ou permutateur`, cx + 12, cy + ch - 10, { size: 7.5, color: red }); }
    }
    if (g.generic) { layer('TEXTES'); text('Schéma type (tableau sans plan)', cx + 12, cy + ch - 10, { size: 7.5, color: mute }); }
  });
  if (!list.length) { layer('TEXTES'); text('Aucun circuit d’éclairage.', 30, 110, { size: 11, color: mute }); }
  ctx.restore();
}
function developedSVGs(design, meta, components, wires) {
  const list = lightingControls(design, components, wires), out = [];
  for (let k = 0; k < devFolios(list); k++) {
    const ctx = new SVGContext();
    drawDeveloped(ctx, design, meta, list, k);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${UNI.H}" width="420mm" height="297mm" font-family="sans-serif"><rect width="${UNI.W}" height="${UNI.H}" fill="#fff"/>${ctx.out.join('')}</svg>`);
  }
  return out;
}
function developedDXF(design, meta, components, wires) {
  const list = lightingControls(design, components, wires), ctx = new DXFContext(), n = devFolios(list);
  for (let k = 0; k < n; k++) { ctx.save(); ctx.translate(0, k * (UNI.H + 60)); drawDeveloped(ctx, design, meta, list, k); ctx.restore(); }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, { U: 1 / 0.3528, insunits: 4, layers: [['SCHEMA', 7], ['TEXTES', 2], ['CARTOUCHE', 8]] });
}

// ---------------------------------------------------------------------------
// Dossier technique : les folios A3 dans l'ordre, numérotés à la suite, et
// leur sommaire (folio 1)
// ---------------------------------------------------------------------------
// Séries de folios du dossier, dans l'ordre : dessin (SVG et DXF) ou page SVG seule (plans)
function _technicalSeries(design, components, wires) {
  const hasPlan = wires.some((w) => w.kind === 'wall'), rj = components.some((c) => c.type === 'rj45');
  const S = [];
  if (hasPlan && typeof buildSVG === 'function') {
    S.push({ title: 'Plan d’implantation', what: 'Appareillage, goulottes, cotes, légende et repères de circuits', n: 1,
      svg: (m) => planFolioSVG(design, m, components, wires), draw: (ctx, m) => _planPlaceholder(ctx, design, m, 'Plan d’implantation') });
    if (design.net && design.net.edges.length) S.push({ title: 'Plan de câblage', what: 'Cheminement de chaque circuit dans les goulottes, jusqu’aux appareils', n: 1,
      svg: (m) => planFolioSVG(design, m, components, wires, true), draw: (ctx, m) => _planPlaceholder(ctx, design, m, 'Plan de câblage — cheminement des circuits') });
  }
  S.push({ title: 'Schéma unifilaire', what: 'Arrivée, AGCP, différentiels, disjoncteurs, nomenclature des départs', n: unifilarLayout(design).folios.length, draw: (ctx, m, k) => drawUnifilar(ctx, design, m, k) });
  S.push({ title: 'Câblage du tableau', what: 'Liaison AGCP, peignes, départs, bornier de terre', n: boardWiringFolios(design), draw: (ctx, m, k) => drawBoardWiring(ctx, design, m, k) });
  S.push({ title: 'Note de calcul', what: 'Ib, In, Iz, ΔU, Icc mini, longueur maximale protégée, bilan de puissance', n: calcNoteFolios(design), draw: (ctx, m, k) => drawCalcNote(ctx, design, m, k) });
  const lc = lightingControls(design, components, wires);
  S.push({ title: 'Schémas développés', what: 'Commandes d’éclairage pièce par pièce', n: devFolios(lc), draw: (ctx, m, k) => drawDeveloped(ctx, design, m, lc, k) });
  if (hasPlan && typeof elevations === 'function') {
    const E = elevations(components, wires);
    S.push({ title: 'Élévations des murs', what: 'Hauteurs de pose de l’appareillage, pièce par pièce', n: elevLayout(E).length, draw: (ctx, m, k) => drawElevations(ctx, design, m, E, k) });
  }
  if (rj && typeof vdiDesign === 'function') {
    const V = vdiDesign(components, wires);
    S.push({ title: 'Communication (VDI)', what: 'Coffret grade 2TV, câblage en étoile catégorie 6', n: vdiFolios(V), draw: (ctx, m, k) => drawVDI(ctx, design, m, V, k) });
  }
  // numérotation continue : sommaire au folio 1
  let sheet = 2;
  for (const x of S) { x.from = sheet; x.to = sheet + x.n - 1; sheet += x.n; }
  return { S, hasPlan, total: sheet - 1, entries: S.map((x) => ({ title: x.title, what: x.what, from: x.from, to: x.to })) };
}
const _folioWrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${UNI.H}" width="420mm" height="297mm" font-family="sans-serif"><rect width="${UNI.W}" height="${UNI.H}" fill="#fff"/>${inner}</svg>`;
function technicalSet(design, meta, components, wires) {
  const T = _technicalSeries(design, components, wires), pages = [];
  const cover = new SVGContext();
  drawSommaire(cover, design, { ...meta, sheet: 1, sheets: T.total }, T.entries, T.hasPlan);
  pages.push(_folioWrap(cover.out.join('')));
  for (const x of T.S) {
    const m = { ...meta, sheet: x.from, sheets: T.total };
    if (x.svg) { pages.push(x.svg(m)); continue; }
    for (let k = 0; k < x.n; k++) { const ctx = new SVGContext(); x.draw(ctx, m, k); pages.push(_folioWrap(ctx.out.join(''))); }
  }
  return { pages, entries: T.entries, total: T.total };
}
// Le dossier technique en un seul DXF : les folios côte à côte (millimètres) ; les
// plans y sont remplacés par un renvoi au DXF du plan, à l'échelle réelle
function technicalDXF(design, meta, components, wires) {
  const T = _technicalSeries(design, components, wires), ctx = new DXFContext(), step = UNI.W + 80;
  let i = 0;
  const at = (fn) => { ctx.save(); ctx.translate(i * step, 0); fn(); ctx.restore(); i++; };
  at(() => drawSommaire(ctx, design, { ...meta, sheet: 1, sheets: T.total }, T.entries, T.hasPlan));
  for (const x of T.S) {
    const m = { ...meta, sheet: x.from, sheets: T.total };
    for (let k = 0; k < x.n; k++) at(() => x.draw(ctx, m, k));
  }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: i * step, maxY: UNI.H }, {
    U: 1 / 0.3528, insunits: 4, layers: [['UNIFILAIRE', 7], ['SCHEMA', 7], ['TEXTES', 2], ['CARTOUCHE', 8]],
  });
}
function _planPlaceholder(ctx, design, meta, title) {
  _uCartouche(ctx, design, meta, title, 0, 1);
  ctx.save(); ctx.fillStyle = '#1a2230'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(title, 60, 120);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#5b6b82';
  ctx.fillText('À l’échelle réelle dans le DXF du plan : barre d’outils → DXF (calques MURS, ELECTRICITE, GOULOTTES, CIRCUITS…).', 60, 146);
  ctx.restore();
}
// Plan d'implantation dans un folio A3 : le plan (légende, repères) mis à l'échelle
// de la zone utile, sous le cartouche du dossier
function planFolioSVG(design, meta, components, wires, routes) {
  const plan = buildSVG(components, wires, SYMBOLS, { ...meta, legend: true, tags: circuitTags(design), noCartouche: true, routesSVG: routes ? routesSVG(design, components) : '' });
  const vb = /viewBox="([^"]+)"/.exec(plan)[1], inner = plan.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const ctx = new SVGContext();
  _uCartouche(ctx, design, meta, routes ? 'Plan de câblage — cheminement des circuits' : 'Plan d’implantation', 0, 1);
  const H = UNI.H - 15 - 62 - 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${UNI.H}" width="420mm" height="297mm" font-family="sans-serif"><rect width="${UNI.W}" height="${UNI.H}" fill="#fff"/>` +
    `<svg x="22" y="22" width="${UNI.W - 44}" height="${H}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${inner}</svg>${ctx.out.join('')}</svg>`;
}
// Plan de câblage : le cheminement de chaque circuit dans les goulottes, à sa
// couleur (décalé pour distinguer les câbles d'une même goulotte), puis la
// descente jusqu'à chaque appareil
function routeSegments(design, components) {
  if (!design || !design.net || !design.route) return [];
  const net = design.net, colors = typeof CABLE_COLORS !== 'undefined' ? CABLE_COLORS : ['#ffb020', '#4f9dff', '#35d07f', '#ff5d7a'];
  const byId = {}, n = design.circuits.length;
  for (const c of components) byId[c.id] = c;
  return design.circuits.map((ct, k) => {
    const off = (k - (n - 1) / 2) * 2.4, segs = [];
    for (const ei of ct.edges || []) {
      const e = net.edges[ei];
      if (!e || e.riser) continue;
      const a = net.pos[e.a], b = net.pos[e.b], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      segs.push([a.x + nx * off, a.y + ny * off, b.x + nx * off, b.y + ny * off]);
    }
    for (const id of ct.devices || []) {
      const r = design.route[id], c = byId[id];
      if (!r || r.off || r.node === undefined || !c) continue;
      const p = net.pos[r.node];
      segs.push([p.x, p.y, c.x, c.y]);
    }
    return { id: ct.id, color: colors[k % colors.length], segs };
  });
}
function routesSVG(design, components) {
  const f = (v) => Math.round(v * 10) / 10;
  return routeSegments(design, components).filter((r) => r.segs.length).map((r) =>
    `<path d="${r.segs.map(([x1, y1, x2, y2]) => `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`).join('')}" fill="none" stroke="${r.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.92"/>`).join('');
}
function drawSommaire(ctx, design, meta, entries, hasPlan) {
  const ink = '#1a2230', mute = '#5b6b82';
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 10}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  ctx.save(); ctx.strokeStyle = ink;
  _uCartouche(ctx, design, meta, 'Sommaire du dossier technique', 0, 1);
  text('Dossier technique de l’installation électrique', 60, 110, { bold: true, size: 26 });
  text((meta && meta.title) || 'Installation électrique', 60, 146, { size: 17 });
  const tri = design.supply && design.supply.phases === 3;
  text(`${tri ? 'Triphasé 400 V' : 'Monophasé 230 V'} · abonnement ${design.agcp.kva} kVA · ${design.rcds.length} interrupteurs différentiels 30 mA · ${design.circuits.length} circuits · ${_bNum(design.cableTotal)} m de câble`, 60, 172, { size: 11, color: mute });
  text('Norme NF C 15-100 — contrôle simplifié, à faire valider par un professionnel avant la visite du Consuel.', 60, 190, { size: 9.5, color: mute });
  // tableau des folios
  const x0 = 60, x1 = UNI.W - 60, y0 = 230, rh = 30;
  ctx.lineWidth = 1.1; _uLine(ctx, x0, y0, x1, y0, 1.2);
  text('Folio', x0 + 6, y0 + 20, { bold: true, size: 10 }); text('Titre', x0 + 110, y0 + 20, { bold: true, size: 10 }); text('Contenu', x0 + 380, y0 + 20, { bold: true, size: 10 });
  const rows = [{ title: 'Sommaire', what: 'Liste des folios du dossier', from: 1, to: 1 }, ...entries];
  rows.forEach((r, i) => {
    const y = y0 + rh * (i + 1);
    _uLine(ctx, x0, y, x1, y, i ? 0.5 : 1);
    text(r.from === r.to ? String(r.from) : `${r.from} à ${r.to}`, x0 + 6, y + 20, { size: 11, bold: true });
    text(r.title, x0 + 110, y + 20, { size: 11 });
    text(r.what, x0 + 380, y + 20, { size: 10, color: mute });
  });
  _uLine(ctx, x0, y0 + rh * (rows.length + 1), x1, y0 + rh * (rows.length + 1), 1.2);
  const yn = y0 + rh * (rows.length + 1) + 34;
  text('Documents joints (format A4 ou à l’échelle)', x0, yn, { bold: true, size: 11 });
  const docs = [hasPlan && 'Plan d’implantation à l’échelle (SVG, DXF pour AutoCAD)', 'Face avant du tableau et étiquettes de repérage à l’échelle 1', 'Dossier du projet : contrôle NF pièce par pièce, autocontrôle, matériel et budget'].filter(Boolean);
  docs.forEach((d, i) => text('•  ' + d, x0 + 8, yn + 22 + i * 18, { size: 10 }));
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Face avant du tableau (millimètres : module de 18 mm, rangées de 13 modules)
// ---------------------------------------------------------------------------
function drawBoardFront(ctx, design, meta) {
  const M = boardModules(design);
  const mw = 18, left = 22, top = 70, pitch = 96, W = left * 2 + BOARD_ROW * mw;
  const ink = '#1a2230', mute = '#5b6b82', blue = '#1668c4';
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 3}px sans-serif`;
    ctx.textAlign = o.align || 'center'; ctx.fillText(t, x, y); ctx.restore();
  };
  const box = (x, y, w, h, fill, stroke, lw) => {
    ctx.beginPath(); ctx.rect(x, y, w, h);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke || ink; ctx.lineWidth = lw || 0.35; ctx.stroke();
  };
  ctx.save();
  text((meta && meta.title) || 'Tableau électrique', left, 12, { bold: true, size: 5.5, align: 'left' });
  text(`Face avant — coffret ${M.label} · ${M.used} modules occupés · réserve ${M.reservePct} %`, left, 19, { size: 3.2, align: 'left', color: mute });
  // GTL : disjoncteur de branchement au-dessus du tableau
  box(left, 26, 80, 30, '#f3f5f9', ink, 0.5);
  text('Disjoncteur de branchement (AGCP)', left + 40, 33, { size: 2.8, bold: true });
  text(`${design.agcp.setting} A · 500 mA · ${design.agcp.kva} kVA`, left + 40, 39, { size: 2.8 });
  box(left + 30, 42, 20, 11, '#fff', ink, 0.4); text('I / O', left + 40, 49.5, { size: 2.6 });
  text('Gaine technique logement (GTL)', left + 88, 34, { size: 2.8, align: 'left', color: mute });
  // Rangées
  M.rows.forEach((row, r) => {
    const y = top + r * pitch;
    box(left - 6, y - 6, BOARD_ROW * mw + 12, 74, '#fbfcfe', '#c4ccd9', 0.4);
    ctx.fillStyle = '#9aa4b2'; ctx.beginPath(); ctx.rect(left - 4, y + 20, BOARD_ROW * mw + 8, 4); ctx.fill(); // rail DIN
    text(`Rangée ${r + 1}`, left - 4, y - 8, { size: 2.8, align: 'left', color: mute });
    let x = left;
    const slots = row.reduce((s, m) => s + m.w, 0);
    for (const m of row) {
      const w = m.w * mw - 0.8;
      const fill = m.kind === 'rcd' ? '#e8f0fd' : m.kind === 'surge' ? '#fff4e0' : m.kind === 'contactor' || m.kind === 'teleruptor' ? '#eef7ef' : '#ffffff';
      box(x + 0.4, y, w, 44, fill, ink, 0.45);
      // manette
      box(x + w / 2 - 2.6 + 0.4, y + 14, 5.2, 12, m.kind === 'rcd' ? blue : '#2b3342', null, 0.2);
      text(m.ref, x + w / 2 + 0.4, y + 6.5, { size: 3, bold: true, color: m.kind === 'rcd' ? blue : ink });
      const sub = m.kind === 'breaker' ? `C${m.In}${m.phase ? ' · ' + (m.phase === '3P' ? '3P+N' : m.phase) : ''}` : m.kind === 'rcd' ? m.text : m.kind === 'surge' ? 'Type 2' : m.kind === 'contactor' ? 'HC' : 'TL';
      text(sub, x + w / 2 + 0.4, y + 34, { size: 2.8 });
      if (m.kind === 'rcd') { ctx.beginPath(); ctx.arc(x + w - 4, y + 38.5, 1.6, 0, Math.PI * 2); ctx.strokeStyle = ink; ctx.lineWidth = 0.3; ctx.stroke(); text('T', x + w - 4, y + 39.5, { size: 2 }); }
      // étiquette sous l'appareil
      box(x + 0.4, y + 48, w, 14, '#fff', '#c4ccd9', 0.3);
      const fitL = m.kind === 'rcd' ? { lines: [`${m.rcd.sens || 30} mA`, `type ${m.rcd.type}`], size: 2.4 } : _bFitLines(m.text, w - 1.5, 2.4, 1.6);
      fitL.lines.forEach((l, i) => text(l, x + w / 2 + 0.4, y + 53.5 + i * (fitL.size + 1.6), { size: fitL.size }));
      x += m.w * mw;
    }
    for (let i = slots; i < BOARD_ROW; i++) {
      ctx.save(); ctx.setLineDash([1, 1]); box(x + 0.4, y, mw - 0.8, 44, null, '#9aa4b2', 0.3); ctx.restore();
      text('libre', x + mw / 2, y + 24, { size: 2.3, color: '#9aa4b2' });
      x += mw;
    }
  });
  // Coffret de communication, sous le tableau dans la GTL (plan avec prises RJ45)
  let Hn = top + M.rows.length * pitch + 4;
  const V = meta && meta.vdi;
  if (V && V.ports) {
    const y = top + (M.rows.length - 1) * pitch + 80, w = BOARD_ROW * mw; // sous la dernière rangée
    box(left, y, w, 46, '#f1f8f7', ink, 0.5);
    text('Coffret de communication — grade 2TV', left + 4, y + 7, { size: 3.2, bold: true, align: 'left' });
    const parts = [['Box opérateur', 56], ['Switch', 36], [`Brassage ${V.panel} ports`, 62], ['2 socles 2P+T', 50]];
    let x = left + 4;
    for (const [t, bw] of parts) { box(x, y + 12, bw, 22, '#ffffff', '#0f766e', 0.4); text(t, x + bw / 2, y + 25, { size: 2.8 }); x += bw + 6; }
    text(`${V.ports} prise${V.ports > 1 ? 's' : ''} RJ45 en étoile (catégorie 6) · DTIo de l’opérateur à proximité`, left + 4, y + 41, { size: 2.6, color: mute, align: 'left' });
    Hn = y + 52;
  }
  ctx.restore();
  return { W, H: Hn };
}
function boardFrontSVG(design, meta) {
  const ctx = new SVGContext();
  const { W, H } = drawBoardFront(ctx, design, meta);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${ctx.out.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Câblage du tableau (folio A3) : arrivée du disjoncteur de branchement sur la
// tête de chaque interrupteur différentiel, peignes phase / neutre, départs
// des circuits et bornier de terre — conducteurs en couleur.
// ---------------------------------------------------------------------------
// Section des conducteurs de liaison AGCP → tableau selon le réglage (A)
function boardLinkSection(setting) { return setting <= 45 ? 10 : setting <= 60 ? 16 : 25; }
const BW = { mw: 26, gap: 14, rowH: 212, colW: 478, top: 150, x0: 208 }; // module 26 pt, rangée, colonne
function boardWiringFolios(design) { return Math.max(1, Math.ceil(boardModules(design).rows.filter((r) => r.length).length / 4)); }
function drawBoardWiring(ctx, design, meta, folio) {
  const M = boardModules(design), rows = M.rows.map((r, i) => ({ r, i })).filter((x) => x.r.length);
  const k = folio || 0, nF = boardWiringFolios(design), mine = rows.slice(k * 4, k * 4 + 4);
  const tri = design.supply && design.supply.phases === 3;
  const ink = '#1a2230', mute = '#5b6b82', N = '#1668c4', PE = '#2e9e46', PEy = '#e0b400';
  // conducteurs actifs : phase + neutre, ou L1 (marron), L2 (noir), L3 (gris) + neutre
  const COND = tri ? [['L1', '#8a5a2b'], ['L2', '#1a1a1a'], ['L3', '#8d949e'], ['N', N]] : [['L', '#b3261e'], ['N', N]];
  const nC = COND.length, col = (name) => (COND.find((c) => c[0] === name) || COND[0])[1];
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 8}px sans-serif`;
    ctx.textAlign = o.align || 'left';
    if (o.rot) { ctx.translate(x, y); ctx.rotate(o.rot); ctx.fillText(t, 0, 0); } else ctx.fillText(t, x, y);
    ctx.restore();
  };
  const wire = (color, pts, w) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w || 1.4; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.restore(); };
  const dot = (x, y, c) => { ctx.save(); ctx.fillStyle = c || ink; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  const isHead = (m) => m.kind === 'rcd' || (m.kind === 'breaker' && m.ref === 'QF');
  // bornes d'un appareil : [nom du conducteur, x] — 4 pôles sur un appareil 4P, sinon phase + neutre
  const terms = (p) => {
    const four = tri && (p.m.kind === 'rcd' || p.m.kind === 'surge' || p.m.w >= 4 || (p.m.kind === 'breaker' && p.m.ref === 'QF'));
    if (four) return COND.map(([n], i) => [n, p.x + p.w * ((i + 0.5) / nC)]);
    const ph = tri ? (p.m.ct && ['L1', 'L2', 'L3'].includes(p.m.ct.phase) ? p.m.ct.phase : 'L1') : 'L';
    return [[ph, p.x + p.w * 0.3], ['N', p.x + p.w * 0.7]];
  };
  const one = mine.length <= 2, sc = one ? 1.45 : 1;
  const S = boardLinkSection(design.agcp.setting), mw = BW.mw * sc, gapW = BW.gap * sc, rowH = one ? 290 : BW.rowH;
  ctx.save(); ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Câblage du tableau de répartition', k, nF);
  layer('TEXTES');
  text('Câblage du tableau', 30, 46, { bold: true, size: 17 });
  text(`Arrivée du disjoncteur de branchement en tête de chaque interrupteur différentiel (conducteurs de ${S} mm²), peignes ${tri ? 'L1 / L2 / L3 / N' : 'phase / neutre'}, départs des circuits, bornier de terre`, 30, 62, { size: 8, color: mute });
  const leg = (tri ? [['L1 (marron)', col('L1')], ['L2 (noir)', col('L2')], ['L3 (gris)', col('L3')]] : [['Phase', col('L')]]).concat([['Neutre (bleu)', N], ['Terre (vert / jaune)', PE]]);
  leg.forEach(([t, c], i) => { const x = UNI.W - 30 - (leg.length - i) * 112; layer('SCHEMA'); wire(c, [[x, 42], [x + 20, 42]], 2); layer('TEXTES'); text(t, x + 25, 45, { size: 8 }); });
  // Disjoncteur de branchement (AGCP) et colonne de distribution vers les têtes de groupe
  const ax = 30, ay = 84;
  layer('SCHEMA'); ctx.lineWidth = 1.2; ctx.strokeRect(ax, ay, 122, 44);
  layer('TEXTES');
  text('AGCP (GTL)', ax + 8, ay + 14, { bold: true, size: 8.5 });
  text(`${tri ? '4P' : '2P'} ${design.agcp.setting} A · 500 mA`, ax + 8, ay + 26, { size: 8 });
  text(`${design.agcp.kva} kVA — gestionnaire de réseau`, ax + 8, ay + 37, { size: 7, color: mute });
  const busX = (i) => ax + 146 + i * 8;
  const col0 = mine.filter((_, n) => one || n % 2 === 0), yEnd = col0.length ? BW.top + (col0.length - 1) * rowH + 4 + nC * 4 : ay + 30;
  layer('SCHEMA');
  COND.forEach(([, c], i) => wire(c, [[ax + 122, ay + 8 + i * (30 / nC)], [busX(i), ay + 8 + i * (30 / nC)], [busX(i), yEnd]], 1.8));
  layer('TEXTES'); text(`${S} mm²`, ax + 126, ay + 4, { size: 7, color: mute });
  mine.forEach(({ r: row, i: ri }, n) => {
    const cl = one ? 0 : n % 2, lin = one ? n : Math.floor(n / 2);
    const x0 = BW.x0 + cl * BW.colW, y0 = BW.top + lin * rowH;
    const yb = y0 + 40 * sc, yB = yb + 58 * sc, yt = yB + 16 * sc, yo = yB + 30 * sc;
    const bar = (i) => y0 + 14 * sc + i * (tri ? 5 : 7) * sc; // hauteur du peigne de chaque conducteur
    const fs = (v) => v * (one ? 1.25 : 1);
    let x = x0;
    const pos = row.map((m) => { const p = { m, x, w: m.w * mw }; x += m.w * mw + (isHead(m) ? gapW : 0); return p; });
    const x1 = x;
    layer('SCHEMA');
    ctx.save(); ctx.strokeStyle = '#c4ccd9'; ctx.lineWidth = 0.6; ctx.strokeRect(x0 - 8, y0 - 2, Math.max(x1 - x0, 4 * mw) + 70, rowH - (one ? 30 : 22)); ctx.restore();
    layer('TEXTES'); text(`Rangée ${ri + 1}`, x0 - 8, y0 - 6, { bold: true, size: 8.5, color: mute });
    let cur = null;
    const groups = [];
    for (const p of pos) {
      if (isHead(p.m)) { cur = { head: p, items: [] }; groups.push(cur); }
      else if (cur && p.m.kind === 'breaker') cur.items.push(p);
    }
    for (const g of groups) {
      const ht = terms(g.head), hx = g.head.x, hw = g.head.w, gx = hx + hw + gapW / 2;
      layer('SCHEMA');
      ht.forEach(([nm, tx], i) => {
        const bi = COND.findIndex((c) => c[0] === nm);
        if (cl === 0) { const yy = y0 + 1 + bi * 3.5; wire(col(nm), [[busX(bi), yy], [tx, yy], [tx, yb]], 1.5); dot(busX(bi), yy, col(nm)); }
        else wire(col(nm), [[tx, y0 - 16 + i * 2], [tx, yb]], 1.5);
      });
      if (cl !== 0) { layer('TEXTES'); text(`depuis l’AGCP, ${S} mm²`, ht[ht.length - 1][1] + 4, y0 - 10, { size: 6.5, color: mute }); layer('SCHEMA'); }
      // disjoncteur de déconnexion → parafoudre, ou sortie de l'ID → peigne des disjoncteurs du groupe
      const pf = g.head.m.ref === 'QF' && pos.find((q) => q.m.kind === 'surge');
      const last = g.items.length ? g.items[g.items.length - 1] : pf;
      if (!last) continue;
      const xEnd = last.x + last.w - 3;
      ht.forEach(([nm, tx]) => {
        const bi = COND.findIndex((c) => c[0] === nm), lx = gx - (nC - 1) * 1.6 + bi * 3.2;
        wire(col(nm), [[tx, yB], [tx, yB + 4 + bi * 3.5], [lx, yB + 4 + bi * 3.5], [lx, bar(bi)], [xEnd, bar(bi)]], 1.2);
        if (!pf) wire(col(nm), [[gx + 6, bar(bi)], [xEnd, bar(bi)]], 2.4);
      });
      for (const p of pf ? [pf] : g.items) {
        for (const [nm, tx] of terms(p)) { const bi = COND.findIndex((c) => c[0] === nm); wire(col(nm), [[tx, bar(bi)], [tx, yb]], 1); dot(tx, bar(bi), col(nm)); }
      }
    }
    // bornier de terre de la rangée, sous les appareils
    const circ = pos.filter((p) => p.m.kind === 'breaker' && p.m.ct);
    if (circ.length) {
      layer('SCHEMA');
      const bx0 = Math.min(...circ.map((p) => p.x)) - 4, bx1 = Math.max(...circ.map((p) => p.x + p.w)) + 4;
      wire(PE, [[bx0, yt], [bx1, yt]], 3.2); wire(PEy, [[bx0, yt + 2.6], [bx1, yt + 2.6]], 1);
      layer('TEXTES'); text('bornier de terre', bx1 + 4, yt + 3, { size: 6.5, color: PE });
    }
    // boîtiers, bornes, départs
    for (const p of pos) {
      const m = p.m, tt = terms(p);
      layer('SCHEMA');
      ctx.save(); ctx.lineWidth = 0.9; ctx.strokeStyle = ink; ctx.strokeRect(p.x + 1, yb, p.w - 2, yB - yb); ctx.restore();
      for (const [, tx] of tt) { dot(tx, yb); dot(tx, yB); }
      layer('TEXTES');
      text(m.ref, p.x + p.w / 2, yb + 15 * sc, { bold: true, size: fs(7), align: 'center', color: m.kind === 'rcd' ? N : ink });
      const sub = m.kind === 'breaker' ? `C${m.In}` : m.kind === 'rcd' ? `${m.rcd.In} A` : m.kind === 'surge' ? 'type 2' : m.kind === 'contactor' ? 'HC' : 'TL';
      text(sub, p.x + p.w / 2, yb + 27 * sc, { size: fs(6.5), align: 'center' });
      if (m.kind === 'rcd') text(`30 mA ${m.rcd.type}`, p.x + p.w / 2, yb + 39 * sc, { size: fs(6), align: 'center', color: mute });
      else if (tri && m.kind === 'breaker' && m.ct) text(m.ct.phase === '3P' ? '3P+N' : tt[0][0], p.x + p.w / 2, yb + 39 * sc, { size: fs(6), align: 'center', color: mute });
      if (m.kind === 'breaker' && m.ct) {
        const tP = p.x + p.w / 2;
        layer('SCHEMA');
        for (const [nm, tx] of tt) {
          const x2 = Math.abs(tx - tP) < 2 ? tx + 3 : tx;
          wire(col(nm), [[tx, yB], [tx, yt - 3], [x2, yt + 5], [x2, yo]], 1.1);
          wire(col(nm), [[x2 - 2, yo - 3], [x2, yo], [x2 + 2, yo - 3]], 0.9);
        }
        wire(PE, [[tP, yt + 3], [tP, yo]], 1); dot(tP, yt + 1, PE); wire(PE, [[tP - 2, yo - 3], [tP, yo], [tP + 2, yo - 3]], 0.9);
        layer('TEXTES');
        text(`${m.ct.id} · ${boardCable(m.ct.S, m.ct.phase)}`, tP + 2.5, yo + 5, { size: fs(6.5), rot: Math.PI / 2, bold: true });
        text(m.ct.name.length > 20 ? m.ct.name.slice(0, 19) + '…' : m.ct.name, tP - 5.5 * sc, yo + 5, { size: fs(6), rot: Math.PI / 2, color: mute });
      } else if (m.kind === 'contactor' || m.kind === 'teleruptor') {
        layer('TEXTES');
        text(m.kind === 'contactor' ? 'cde HC' : 'bobine', p.x + p.w / 2, yb + 39 * sc, { size: fs(5.5), align: 'center', color: mute });
      } else if (m.kind === 'surge') {
        layer('SCHEMA'); wire(PE, [[p.x + p.w / 2, yB], [p.x + p.w / 2, yt]], 1.1);
      }
    }
  });
  layer('TEXTES');
  const yb2 = UNI.H - 15 - 62 - 28;
  text(`Bornier de terre relié à la barrette de coupure puis au piquet (conducteur de terre 16 mm² cuivre) ; liaison AGCP → têtes de groupe en ${S} mm² (${tri ? 'trois phases et neutre' : 'phase et neutre'}) ; peignes adaptés au calibre des différentiels.`, 30, yb2 - 13, { size: 8, color: mute });
  text(`${tri ? 'Chaque circuit monophasé sur la phase indiquée (équilibrage des phases) ; ' : ''}phase et neutre d’un circuit sous le même disjoncteur.`, 30, yb2, { size: 8, color: mute });
  text('Schéma de principe : l’ordre de raccordement exact dépend du matériel (peignes horizontaux ou verticaux, borniers à connexion rapide) — suivre la notice du fabricant.', 30, yb2 + 13, { size: 7.5, color: mute });
  ctx.restore();
}
function boardWiringSVGs(design, meta) {
  const out = [];
  for (let k = 0; k < boardWiringFolios(design); k++) {
    const ctx = new SVGContext();
    drawBoardWiring(ctx, design, meta, k);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${UNI.H}" width="420mm" height="297mm" font-family="sans-serif"><rect width="${UNI.W}" height="${UNI.H}" fill="#fff"/>${ctx.out.join('')}</svg>`);
  }
  return out;
}
function boardWiringDXF(design, meta) {
  const ctx = new DXFContext(), n = boardWiringFolios(design);
  for (let k = 0; k < n; k++) { ctx.save(); ctx.translate(0, k * (UNI.H + 60)); drawBoardWiring(ctx, design, meta, k); ctx.restore(); }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, { U: 1 / 0.3528, insunits: 4, layers: [['SCHEMA', 7], ['TEXTES', 2], ['CARTOUCHE', 8]] });
}

// Étiquettes de repérage à imprimer à l'échelle 1 (A4 portrait) et à découper
function boardLabelsSVG(design, meta) {
  const M = boardModules(design);
  const mw = 18, left = 20, W = 297, pitchY = 26; // A4 paysage : une rangée de 13 modules (234 mm) tient à l'échelle 1
  const H = Math.max(210, 40 + M.rows.length * pitchY + 20);
  const ctx = new SVGContext();
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || '#1a2230'; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 3}px sans-serif`;
    ctx.textAlign = o.align || 'center'; ctx.fillText(t, x, y); ctx.restore();
  };
  text('Étiquettes du tableau — ' + ((meta && meta.title) || 'installation'), left, 18, { bold: true, size: 5, align: 'left' });
  text('À imprimer à 100 % (sans « ajuster à la page ») : un module = 18 mm. Découper le long des pointillés.', left, 25, { size: 3, align: 'left', color: '#5b6b82' });
  M.rows.forEach((row, r) => {
    const y = 36 + r * pitchY;
    text(`Rangée ${r + 1}`, left, y - 2, { size: 2.6, align: 'left', color: '#5b6b82' });
    ctx.save(); ctx.setLineDash([1.2, 1]); ctx.strokeStyle = '#5b6b82'; ctx.lineWidth = 0.25;
    ctx.strokeRect(left, y, BOARD_ROW * mw, 14);
    ctx.restore();
    let x = left;
    for (const m of row) {
      const w = m.w * mw;
      ctx.strokeStyle = '#1a2230'; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 14); ctx.stroke();
      text(m.ref, x + w / 2, y + 4.5, { bold: true, size: 3 });
      const label = m.kind === 'rcd' ? `${m.rcd.In} A ${m.rcd.sens || 30} mA type ${m.rcd.type}` : m.text;
      const f = _bFitLines(label, w - 1.5, 2.3, 1.5);
      f.lines.forEach((l, i) => text(l, x + w / 2, y + 8.6 + i * (f.size + 1.2), { size: f.size }));
      x += w;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${ctx.out.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Le tableau en schéma modifiable dans l'éditeur : symboles verticaux reliés
// par des fils (réseau, compteur, AGCP, jeu de barres, ID, disjoncteurs,
// contacteurs, récepteurs). Grille de 20, colonnes de 120.
// ---------------------------------------------------------------------------
function boardToSchematic(design, meta) {
  const comps = [], wires = [];
  let n = 0;
  const id = () => 'u' + ++n;
  const put = (type, x, y, label, value, extra) => { const c = { id: id(), type, x, y, rot: 90, label: label || '', value: value || '', ...(extra || {}) }; comps.push(c); return c; };
  const wire = (x1, y1, x2, y2) => { if (x1 !== x2 || y1 !== y2) wires.push({ id: id(), points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] }); };
  const tri = design.supply && design.supply.phases === 3;
  const X0 = 100, BUS = 360, SUB = 560, COL = 120;
  put('ac_source', X0, 0, 'Réseau', tri ? '400 V 3P+N' : '230 V');
  put('meter_kwh', X0, 120, 'Compteur', '');
  wire(X0, 40, X0, 80);
  put('agcp', X0, 240, 'AGCP', `${design.agcp.setting} A ${tri ? '4P' : '2P'}`, { closed: true });
  wire(X0, 160, X0, 200); wire(X0, 280, X0, BUS);
  let x = X0 + 120;
  if (design.supply && design.supply.surge) {
    put('breaker', x, 440, 'QF', 'C10', { closed: true }); wire(x, BUS, x, 400);
    put('surge', x, 560, 'PF', 'type 2'); wire(x, 480, x, 520);
    comps.push({ id: id(), type: 'ground', x, y: 640, rot: 0, label: '', value: '' }); wire(x, 600, x, 620);
    x += 120;
  }
  const groups = design.rcds.map((r) => ({ r, cs: design.circuits.filter((c) => c.rcd === r.id) })).filter((g) => g.cs.length);
  const loose = design.circuits.filter((c) => !design.rcds.some((r) => r.id === c.rcd));
  if (loose.length) groups.push({ r: null, cs: loose });
  const loadType = (c) => (c.kind === 'light' ? 'lamp' : c.kind === 'socket' ? 'socket' : ['vmc', 'hvac'].includes(c.appliance) || /pompe|clim|vmc/i.test(c.name) ? 'motor' : 'resistor_iec');
  const cut = (t) => (t.length > 20 ? t.slice(0, 19) + '…' : t);
  let xEnd = x;
  for (const g of groups) {
    const xs = g.cs.map((c, i) => x + 20 + i * COL);
    const xc = Math.round((xs[0] + xs[xs.length - 1]) / 2 / 20) * 20;
    if (g.r) { put('rcd', xc, 440, g.r.id, `${g.r.In} A ${g.r.type}`, { closed: true }); wire(xc, BUS, xc, 400); wire(xc, 480, xc, SUB); }
    else wire(xc, BUS, xc, SUB);
    if (xs.length > 1) wire(xs[0], SUB, xs[xs.length - 1], SUB);
    g.cs.forEach((c, i) => {
      const cx = xs[i];
      put('breaker', cx, 640, c.id, `${c.curve || 'C'}${c.In}${tri && c.phase ? ' ' + (c.phase === '3P' ? '3P+N' : c.phase) : ''}`, { closed: true });
      wire(cx, SUB, cx, 600);
      let y = 680;
      if (c.contactor || c.teleruptor) {
        put(c.contactor ? 'contactor' : 'teleruptor', cx, 760, c.contactor ? 'KM' : 'KL', c.contactor ? 'HC' : '');
        wire(cx, 680, cx, 720); y = 800;
      }
      put(loadType(c), cx, y + 120, '', cut(c.name));
      wire(cx, y, cx, y + 80);
    });
    x = xs[xs.length - 1] + 100;
    xEnd = Math.max(xEnd, xs[xs.length - 1]);
  }
  wire(X0, BUS, xEnd, BUS); // jeu de barres
  return {
    version: 1,
    meta: { title: ((meta && meta.title) || 'Installation') + ' — schéma unifilaire', author: (meta && meta.author) || '' },
    components: comps, wires, counters: {},
  };
}

// ---------------------------------------------------------------------------
// Plan d'implantation : repère de circuit de chaque appareil (couleur du câble
// en rayons X) et légende des symboles électriques avec leurs quantités
// ---------------------------------------------------------------------------
function circuitTags(design) {
  const colors = typeof CABLE_COLORS !== 'undefined' ? CABLE_COLORS : ['#ffb020', '#4f9dff', '#35d07f', '#ff5d7a', '#b18aec'];
  const map = {}, list = [];
  design.circuits.forEach((ct, k) => {
    const color = colors[k % colors.length];
    list.push({ id: ct.id, name: ct.name, In: ct.In, color, cable: boardCable(ct.S, ct.phase) });
    for (const id of ct.devices || []) map[id] = { id: ct.id, color };
  });
  return { map, list };
}
const LEGEND_CATS = new Set(['Implantation élec.', 'Électroménager']);
function planLegend(components, symbols) {
  const count = {};
  for (const c of components) {
    const s = symbols[c.type];
    if (s && LEGEND_CATS.has(s.category)) count[c.type] = (count[c.type] || 0) + 1;
  }
  return Object.keys(count).map((type) => ({ type, name: symbols[type].name, count: count[type], cat: symbols[type].category }))
    .sort((a, b) => (a.cat === b.cat ? 0 : a.cat === 'Implantation élec.' ? -1 : 1) || a.name.localeCompare(b.name, 'fr'));
}
// Pastille « C3 » à côté d'un appareil (ctx : canvas, SVG ou DXF), taille k (1 = unités du plan)
function drawCircuitTag(ctx, c, tag, k) {
  k = k || 1;
  const w = (tag.id.length * 7 + 8) * k, h = 13 * k, x = c.x + 16 * k, y = c.y - 24 * k;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fillStyle = tag.color; ctx.fill();
  ctx.strokeStyle = '#1a2230'; ctx.lineWidth = 0.8 * k; ctx.stroke();
  ctx.fillStyle = '#1a2230'; ctx.font = `bold ${10 * k}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(tag.id, x + w / 2, y + h - 3 * k);
  ctx.restore();
}
