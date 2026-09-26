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
const BOARD_RCD_TYPES = ['AC', 'A', 'A-SI', 'F', 'B']; // A-SI : type A « super immunisé » (congélateur, informatique)
const _rcdIsA = (t) => ['A', 'A-SI', 'F', 'B'].includes(t); // convient à la plaque et au lave-linge
const BOARD_KINDS = { light: 'Éclairage', socket: 'Prises', heating: 'Chauffage', dedicated: 'Spécialisé', other: 'Autre', sub: 'Tableau divisionnaire', pv: 'Production PV' };

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
  // production photovoltaïque en autoconsommation : circuit de l'onduleur, disjoncteur différentiel dédié
  { key: 'pv', name: 'Photovoltaïque 3 kWc (onduleur)', kind: 'pv', In: 16, S: 4, points: 1, P: 3000, ddr: 'A' },
  { key: 'pv6', name: 'Photovoltaïque 6 kWc (onduleur)', kind: 'pv', In: 32, S: 10, points: 1, P: 6000, ddr: 'A' },
  { key: 'pv_tri', name: 'Photovoltaïque 9 kWc (onduleur tri)', kind: 'pv', In: 16, S: 2.5, points: 1, P: 9000, ddr: 'A', phase: '3P', tri: true },
  // départ en tête du tableau (sous l'AGCP 500 mA) vers un tableau divisionnaire et ses propres ID 30 mA
  { key: 'sub', name: 'Tableau divisionnaire', kind: 'sub', In: 32, S: 10, points: 0, P: 0 },
];
// Interrupteur-sectionneur de tête d'un tableau divisionnaire : calibre au moins égal au départ
function boardSubSwitch(In) { return [40, 63, 80, 100].find((x) => x >= In) || 100; }

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
    supply: { kva: design.agcp ? design.agcp.kva : 9, phases: (design.supply && design.supply.phases) || 1, surge: !!(design.supply && design.supply.surge), shed: !!(design.supply && design.supply.shed), area: Math.round(design.area || 0), ra: (design.supply && design.supply.ra) || null },
    rcds: design.rcds.map((r) => ({ id: r.id, In: r.In, type: r.type, sens: r.sens || 30, panel: r.panel || null })),
    circuits: design.circuits.map((c) => ({
      id: c.id, name: c.name, kind: c.kind, In: c.In, S: c.S, curve: c.curve || 'C', rcd: c.rcd,
      devices: (c.devices || []).slice(), points: c.points, length: Math.round((c.length || 0) * 10) / 10,
      P: Math.round(c.power || 0), appliance: c.appliance || null, typeA: !!c.typeA, typeF: !!c.typeF,
      contactor: c.contactor || (c.appliance === 'water_heater' ? 'hc' : null), teleruptor: !!c.teleruptor, ddr: c.ddr || null, buried: !!c.buried,
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
    typeA: !!pr.typeA, typeF: !!pr.typeF, contactor: pr.contactor || null, teleruptor: false, ddr: pr.ddr || null,
    phase: pr.phase && +(board.supply && board.supply.phases) === 3 ? pr.phase : null, ...(over || {}),
  };
  if (pr.kind === 'sub') {
    // départ direct sous l'AGCP, puis le tableau divisionnaire : un ID 30 mA, éclairage et prises
    c.rcd = null;
    if (!(over && over.length)) c.length = 20;
    board.circuits.push(c);
    const td = 'TD' + board.circuits.filter((x) => x.kind === 'sub').length;
    const r = { id: boardNextId(board, 'ID'), In: 40, type: 'AC', sens: 30, panel: c.id };
    board.rcds.push(r);
    boardAddCircuit(board, 'light', { name: 'Éclairage ' + td, points: 2, P: 100, rcd: r.id });
    boardAddCircuit(board, 'socket', { name: 'Prises ' + td, points: 3, rcd: r.id });
    return c;
  }
  if (!c.ddr) c.rcd = c.rcd || boardPickRcd(board, c);
  board.circuits.push(c);
  return c;
}

// Différentiel pour un circuit : type F / A si l'appareil l'exige, sinon le type AC le moins chargé
function boardPickRcd(board, c) {
  const count = (r) => board.circuits.filter((x) => x.rcd === r.id).length;
  const need = c.typeF ? 'F' : c.typeA ? 'A' : null;
  // un circuit ordinaire va sur un ID type AC (un nouveau si tous sont pleins), pas sur l'ID type A ou F
  const list = board.rcds.filter((r) => !r.panel && (need ? r.type === need || (need === 'A' && r.type === 'F') : r.type === 'AC') && count(r) < 8); // tableau principal
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
    if (c.kind === 'pv') {
      // NF C 15-100 partie 7-712 et guide UTE C 15-712-1 (côté alternatif)
      if (!c.ddr && c.rcd && cs.filter((x) => x.rcd === c.rcd).length > 1) push('info', `${c.id} ${c.name} : l’onduleur partage ${c.rcd} avec d’autres circuits — un disjoncteur différentiel dédié (type selon la notice de l’onduleur) évite qu’un défaut coupe aussi la production.`, c.id);
    }
    if (c.kind === 'sub') {
      // départ de tableau divisionnaire : en tête (AGCP 500 mA sélectif), les ID 30 mA sont dans le TD
      if (!rcds.some((r) => r.panel === c.id)) push('err', `${c.panelRef || c.id} ${c.name} : aucun interrupteur différentiel 30 mA dans le tableau divisionnaire.`, c.id);
      const up = rcds.find((r) => r.id === c.rcd);
      if (up && up.panel === c.id) push('err', `${c.id} ${c.name} : le départ ne peut pas être protégé par un ID de son propre tableau divisionnaire.`, c.id);
      else if (up) push('warn', `${c.id} ${c.name} : départ sous ${up.id} 30 mA — pas de sélectivité avec les ID du tableau divisionnaire ; raccorder en tête, sous l’AGCP.`, c.id);
      if (c.Ib > c.In + 1e-9) push('err', `${c.id} ${c.name} : ${_bNum(c.Ib, 1)} A appelés > ${c.In} A — calibre et section supérieurs.`, c.id);
      for (const x of cs.filter((x) => x.panel === c.id && x.phase === '3P')) if (c.phase !== '3P') push('err', `${x.id} ${x.name} : départ triphasé dans un tableau divisionnaire alimenté en monophasé.`, x.id);
    } else if (!c.rcd && !c.ddr) push('err', `${c.id} ${c.name} : aucun interrupteur différentiel 30 mA en amont.`, c.id);
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
    // type du différentiel en amont : l'ID du groupe, ou le disjoncteur différentiel du circuit
    const rc = rcds.find((r) => r.id === c.rcd) || (c.ddr ? { id: 'son disjoncteur différentiel', type: c.ddr } : null);
    if (rc && c.typeA && !_rcdIsA(rc.type)) push('err', `${c.id} ${c.name} : sous ${rc.id} type ${rc.type} — il faut un différentiel type A (ou F).`, c.id);
    if (rc && c.typeF && !['F', 'B'].includes(rc.type)) push('warn', `${c.id} ${c.name} : borne de recharge sous ${rc.id} type ${rc.type} — type F (ou A-EV, ou B) conseillé.`, c.id);
    // congélateur : un déclenchement intempestif (orage, autre circuit) perd le contenu — ID type A-SI conseillé
    if (rc && /cong[ée]lateur/i.test(c.name) && rc.type !== 'A-SI') push('info', `${c.id} ${c.name} : différentiel type A-SI (haute immunité) conseillé, seul ou avec peu de circuits, pour éviter les déclenchements intempestifs.`, c.id);
    if (c.ok === false) push('warn', `${c.id} ${c.name} : chute de tension ${_bNum(c.dUpct, 1)} % > ${c.limit} %.`, c.id);
    // Note de calcul : courant admissible du câble (triphasé : 3 conducteurs chargés), longueur protégée
    const Iz3 = c.phase === '3P' && CALC_IZ[3][c.S];
    if (Iz3 && c.In > Iz3) push('err', `${c.id} ${c.name} : ${c.In} A sur ${boardCable(c.S, c.phase)} — Iz = ${_bNum(Iz3, 1)} A en triphasé, section supérieure.`, c.id);
    const L = c.far || c.length || 0, Lmax = calcLmaxOf(c);
    if (L > Lmax) push('err', `${c.id} ${c.name} : ${_bNum(L, 1)} m > ${_bNum(Lmax)} m protégés${c.feedRS ? ' (ligne du tableau divisionnaire comprise)' : ''} — un court-circuit en bout de ligne (≈ ${_bNum(calcIccMin(c, L))} A) ne ferait pas déclencher le ${c.curve || 'C'}${c.In} (${(CALC_IM[c.curve || 'C'] || 10) * c.In} A) : section supérieure ou calibre inférieur.`, c.id);
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
  if (cs.some((c) => c.typeA && !c.ddr) && !rcds.some((r) => _rcdIsA(r.type))) push('err', 'Plaque de cuisson ou lave-linge : un différentiel type A est obligatoire.');
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
  const heatP = cs.filter((c) => c.kind === 'heating').reduce((s, c) => s + (c.power || 0), 0);
  if (design.supply && design.supply.shed && !heatP) push('warn', 'Délesteur sans circuit de chauffage à piloter.');
  else if (!(design.supply && design.supply.shed) && design.agcp && heatP >= 0.5 * design.agcp.kva * 1000) push('info', `Chauffage électrique ${_bNum(heatP / 1000, 1)} kW pour ${design.agcp.kva} kVA : un délesteur (fil pilote) coupe le chauffage aux pointes et évite le déclenchement du disjoncteur de branchement.`);
  if (cs.some((c) => c.buried)) push('info', `Liaison enterrée (${cs.filter((c) => c.buried).map((c) => c.id).join(', ')}) : câble U1000 R2V sous fourreau TPC rouge, à 0,50 m de profondeur au moins (0,85 m sous un passage de véhicules), grillage avertisseur rouge au-dessus.`);
  if (cs.some((c) => c.kind === 'pv')) push('info', 'Production photovoltaïque : étiquette « Attention — présence de deux sources de tension » sur le tableau et au compteur, interrupteur-sectionneur côté alternatif à proximité de l’onduleur, onduleur conforme (découplage).');
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
// Circuit d'un tableau divisionnaire : la ligne d'alimentation (L/S du départ, feedRS) s'ajoute à la boucle
function calcLmaxOf(c) { return Math.max(0, calcLmax(c.S, c.In, c.curve) - (c.feedRS || 0) * c.S); }
function calcIccMin(c, L) { const rs = (L || 0) / c.S + (c.feedRS || 0); return rs > 0 ? (0.8 * CALC_U0) / (2 * CALC_RHO * rs) : null; }
function calcNote(design) {
  const supply = design.supply || {};
  const rows = design.circuits.map((c) => {
    const three = c.phase === '3P', curve = c.curve || 'C';
    const L = c.far || c.length || 0;
    const Iz = CALC_IZ[three ? 3 : 2][c.S] || null;
    const Ib = c.kind === 'socket' ? c.In : (c.power || 0) / (three ? Math.sqrt(3) * U_TRI : CALC_U0);
    const Im = (CALC_IM[curve] || 10) * c.In;
    const Lmax = calcLmaxOf(c);
    const icc = L > 0 || c.feedRS ? calcIccMin(c, L) : null;
    // repère du tableau divisionnaire devant le nom (« TD1 · Prises ») ; départ : « → TD1 »
    const name = c.kind === 'sub' ? `${c.name} → ${c.panelRef || 'TD'}` : c.panelRef ? `${c.panelRef} · ${c.name}` : c.name;
    const r = { id: c.id, name, phase: c.phase || null, kind: c.kind, P: c.power || 0, Ib, In: c.In, curve, S: c.S, cable: boardCable(c.S, c.phase), Iz, L, dU: c.dUpct, dUmax: c.limit, icc, Im, Lmax, td: c.panelRef || null };
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
// Organe de commande d'un circuit : contacteur heures creuses, ou interrupteur horaire (programmation)
const _ctText = (k) => (k === 'hc' ? 'Contacteur HC' : k === 'ih' ? 'Interrupteur horaire' : 'Contacteur');
// Tableaux : le principal (id null) puis les divisionnaires [{ id, ref, name, feeder }]
function boardPanels(design) {
  return [{ id: null, ref: '', name: 'Tableau principal', feeder: null }].concat(design.panels || []);
}
// Vue d'un seul tableau : ses ID et ses circuits (le principal garde les départs vers les TD)
function boardPanelView(design, pid) {
  const D = design.root || design;
  if (!(D.panels && D.panels.length)) return D;
  pid = pid || null;
  const P = pid ? D.panels.find((p) => p.id === pid) : null;
  return Object.assign({}, D, {
    root: D, panelId: pid, panelOf: P,
    rcds: D.rcds.filter((r) => (r.panel || null) === pid),
    circuits: D.circuits.filter((c) => (c.panel || null) === pid),
    supply: pid ? Object.assign({}, D.supply, { surge: false, shed: false, rows: 0 }) : D.supply,
  });
}
function boardModules(design, pid) {
  design = boardPanelView(design, pid === undefined ? design.panelId || null : pid);
  const items = [];
  const P = design.panelOf;
  if (P) { // tête du tableau divisionnaire : interrupteur-sectionneur
    const four = P.feeder.phase === '3P';
    items.push({ kind: 'switch', w: four ? 4 : 2, ref: 'QS', text: 'Interrupteur-sectionneur', In: boardSubSwitch(P.feeder.In) });
  }
  if (design.supply && design.supply.surge) {
    const tri = design.supply.phases === 3;
    items.push({ kind: 'breaker', w: tri ? 4 : 1, ref: 'QF', text: 'Disj. parafoudre', In: 10 });
    items.push({ kind: 'surge', w: tri ? 4 : 2, ref: 'PF', text: 'Parafoudre' });
  }
  // délesteur : coupe le chauffage (fil pilote) quand la consommation approche le réglage de l'AGCP
  if (design.supply && design.supply.shed) items.push({ kind: 'shed', w: 2, ref: 'DL', text: 'Délesteur (fil pilote)' });
  // départs vers les tableaux divisionnaires : en tête, sous l'AGCP (comme le parafoudre)
  for (const c of design.circuits.filter((x) => x.kind === 'sub' && !design.rcds.some((r) => r.id === x.rcd))) {
    items.push({ kind: 'breaker', w: c.phase === '3P' ? 4 : 1, ref: c.id, text: c.name, In: c.In, ct: c, phase: design.supply && design.supply.phases === 3 ? c.phase : null, feed: c.panelRef });
  }
  // disjoncteurs différentiels 30 mA (un par circuit) : en tête, sous l'AGCP, avec leur contacteur
  for (const c of design.circuits.filter((x) => x.ddr && !design.rcds.some((r) => r.id === x.rcd))) {
    items.push({ kind: 'ddr', w: c.phase === '3P' ? 4 : 2, ref: c.id, text: c.name, In: c.In, ct: c, phase: design.supply && design.supply.phases === 3 ? c.phase : null, ddr: c.ddr });
    if (c.contactor) items.push({ kind: 'contactor', w: 1, ref: (c.contactor === 'ih' ? 'IH' : 'KM') + c.id.replace(/^C/, ''), text: _ctText(c.contactor), ct: c, tag: c.contactor === 'ih' ? 'IH' : 'HC' });
    if (c.teleruptor) items.push({ kind: 'teleruptor', w: 1, ref: 'KL' + c.id.replace(/^C/, ''), text: 'Télérupteur', ct: c });
  }
  const groups = design.rcds.map((r) => ({ r, cs: design.circuits.filter((c) => c.rcd === r.id) })).filter((g) => g.cs.length);
  const loose = design.circuits.filter((c) => c.kind !== 'sub' && !c.ddr && !design.rcds.some((r) => r.id === c.rcd));
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
      if (c.contactor) mods.push({ kind: 'contactor', w: 1, ref: (c.contactor === 'ih' ? 'IH' : 'KM') + c.id.replace(/^C/, ''), text: _ctText(c.contactor), ct: c, tag: c.contactor === 'ih' ? 'IH' : 'HC' });
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

// Groupes « différentiel + circuits », répartis sur un ou plusieurs folios par tableau
// (principal, puis chaque tableau divisionnaire) ; folio.local : rang dans son tableau
function unifilarLayout(design) {
  const folios = [], panelFolio = {}, feedFolio = {};
  const right = UNI.W - 30, maxCols = Math.floor((right - 120) / UNI.colW) - 1;
  for (const P of boardPanels(design)) {
    const V = boardPanelView(design, P.id);
    const groups = [];
    const feeds = V.circuits.filter((c) => c.kind === 'sub' && !V.rcds.some((r) => r.id === c.rcd));
    if (feeds.length) groups.push({ r: null, feed: true, cs: feeds });
    const ddrs = V.circuits.filter((c) => c.ddr && !V.rcds.some((r) => r.id === c.rcd));
    if (ddrs.length) groups.push({ r: null, ddr: true, cs: ddrs });
    groups.push(...V.rcds.map((r) => ({ r, cs: V.circuits.filter((c) => c.rcd === r.id) })).filter((g) => g.cs.length));
    const loose = V.circuits.filter((c) => c.kind !== 'sub' && !c.ddr && !V.rcds.some((r) => r.id === c.rcd));
    if (loose.length) groups.push({ r: null, cs: loose });
    const start = (local) => (local ? 120 : 180 + (V.supply && V.supply.surge ? 70 : 0) + (V.supply && V.supply.shed ? 80 : 0));
    panelFolio[P.id || ''] = folios.length;
    let F = { groups: [], panel: P, view: V, local: 0 };
    folios.push(F);
    let x = start(0);
    for (const g of groups) {
      for (let i = 0; i < g.cs.length; i += maxCols) {
        const cs = g.cs.slice(i, i + maxCols);
        const w = Math.max(cs.length, 2) * UNI.colW;
        if (x + w > right) { F = { groups: [], panel: P, view: V, local: F.local + 1 }; folios.push(F); x = start(F.local); }
        F.groups.push({ r: g.r, feed: !!g.feed, ddr: !!g.ddr, cs, x0: x, w, cont: i > 0 });
        if (g.feed) for (const c of cs) feedFolio[c.id] = folios.length - 1;
        x += w + UNI.gap;
      }
    }
  }
  for (const f of folios) {
    const last = f.groups[f.groups.length - 1];
    f.xEnd = last ? last.x0 + Math.max(last.cs.length, 1) * UNI.colW - UNI.colW / 2 : 300;
  }
  return { folios, panelFolio, feedFolio };
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
// Onduleur (CEI 60617) : carré barré, courant continu « = » d'un côté, alternatif « ~ » de l'autre
function _uInverter(ctx, x, y) {
  ctx.lineWidth = 1.2; ctx.strokeRect(x - 9, y, 18, 18);
  _uLine(ctx, x - 9, y + 18, x + 9, y, 0.9);
  _uLine(ctx, x - 6, y + 4.5, x - 1.5, y + 4.5, 0.8); _uLine(ctx, x - 6, y + 6.5, x - 1.5, y + 6.5, 0.8); // =
  ctx.beginPath(); ctx.moveTo(x + 1.5, y + 13.5); ctx.quadraticCurveTo(x + 3.2, y + 10.5, x + 4.5, y + 13); ctx.quadraticCurveTo(x + 5.8, y + 15.5, x + 7.2, y + 12.5); ctx.stroke(); // ~
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
  const P = F.panel, V = F.view, first = F.local === 0, multi = lay.folios.some((f) => f.panel.id);
  const fno = (i) => (meta && meta.sheets ? meta.sheet + i : i + 1); // numéro de folio affiché
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
  _uCartouche(ctx, design, meta, P.id ? `Schéma unifilaire — tableau divisionnaire ${P.ref}` : 'Schéma unifilaire du tableau de répartition', k, nF);
  const d0 = design.agcp;
  const tri = design.supply && design.supply.phases === 3;

  // Légende des symboles (premier folio) : ceux de l'installation, trois par rangée
  if (k === 0) {
    const cs = design.circuits, sup = design.supply || {};
    const L = [
      ['Disjoncteur', 'courbe C, calibre en A', (x, y) => _uBreaker(ctx, x, y, 34)],
      ['Interrupteur', 'différentiel 30 mA', (x, y) => { _uSwitch(ctx, x, y, 34); _uTorus(ctx, x, y + 26, y + 16); }],
    ];
    if (cs.some((c) => c.ddr)) L.push(['Disjoncteur', 'différentiel 30 mA', (x, y) => { _uBreaker(ctx, x, y, 34); _uTorus(ctx, x, y + 26, y + 16); }]);
    L.push(['Contacteur HC,', 'horloge IH, télér. TL', (x, y) => _uContactor(ctx, x, y, 34, 'KM'), 26]);
    if ((design.panels || []).length) L.push(['Interrupteur-', 'sectionneur (TD)', (x, y) => _uSwitch(ctx, x, y, 34)]);
    if (sup.surge) L.push(['Parafoudre', 'type 2', (x, y) => { ctx.lineWidth = 1.2; ctx.strokeRect(x - 6, y + 4, 12, 24); _uLine(ctx, x, y + 9, x - 3, y + 16, 1); _uLine(ctx, x - 3, y + 16, x + 3, y + 16, 1); _uLine(ctx, x + 3, y + 16, x, y + 24, 1); }]);
    if (sup.shed) L.push(['Délesteur', 'fil pilote', (x, y) => { ctx.lineWidth = 1.2; ctx.strokeRect(x - 10, y + 6, 20, 18); text('DL', x, y + 19, { size: 7, bold: true, align: 'center' }); }]);
    if (cs.some((c) => c.kind === 'pv')) L.push(['Onduleur', 'photovoltaïque', (x, y) => _uInverter(ctx, x, y + 6)]);
    L.push(['Terre', '', (x, y) => _uEarth(ctx, x, y + 6)], ['Départ', 'vers les récepteurs', (x, y) => { _uLine(ctx, x, y + 4, x, y + 16, 1.3); _uArrow(ctx, x, y + 16); }]);
    const lx = W - 330, ly = 28, rows = Math.ceil(L.length / 3);
    layer('TEXTES');
    ctx.lineWidth = 0.8; ctx.strokeRect(lx, ly, 305, 22 + rows * 40);
    text('Légende', lx + 8, ly + 13, { bold: true, size: 8.5 });
    L.forEach(([t1, t2, draw, off], i) => {
      const x = lx + 20 + (i % 3) * 100, y = ly + 18 + Math.floor(i / 3) * 40;
      layer('UNIFILAIRE'); ctx.strokeStyle = ink; ctx.fillStyle = ink; draw(x, y);
      layer('TEXTES');
      const tx = x + (off || 16); // le contacteur a sa bobine à droite
      text(t1, tx, y + 16, { size: 7.5 }); if (t2) text(t2, tx, y + 26, { size: 6.5, color: mute });
    });
  }

  // Titre du tableau quand l'installation en compte plusieurs
  if (multi) {
    layer('TEXTES');
    text(P.id ? `Tableau divisionnaire ${P.ref} — ${fit(P.name, 40)}` : 'Tableau principal (répartition)', 200, 40, { bold: true, size: 13 });
    if (P.id) text(`alimenté par ${P.feeder.id} (${P.feeder.curve || 'C'}${P.feeder.In}, folio ${fno(lay.feedFolio[P.feeder.id] || 0)}) · ${boardCable(P.feeder.S, P.feeder.phase)} · ${f1(P.feeder.length)} m`, 200, 54, { size: 8.5, color: mute });
    else text(`${lay.folios.filter((f) => f.panel.id && f.local === 0).length} tableau${lay.folios.filter((f) => f.panel.id && f.local === 0).length > 1 ? 'x' : ''} divisionnaire${lay.folios.filter((f) => f.panel.id && f.local === 0).length > 1 ? 's' : ''} alimenté${lay.folios.filter((f) => f.panel.id && f.local === 0).length > 1 ? 's' : ''} en tête, sous l’AGCP`, 200, 54, { size: 8.5, color: mute });
  }
  // Arrivée : réseau, compteur, disjoncteur de branchement (AGCP)
  layer('UNIFILAIRE');
  const sx = 70;
  if (first && P.id) {
    // Tableau divisionnaire : arrivée du départ du tableau principal, interrupteur-sectionneur de tête
    const f = P.feeder, four = f.phase === '3P';
    text('Depuis le tableau principal', sx, 34, { align: 'center', size: 8, color: mute });
    text(`${f.id} ${f.curve || 'C'}${f.In} · folio ${fno(lay.feedFolio[f.id] || 0)}`, sx, 44, { align: 'center', size: 8, color: mute });
    _uLine(ctx, sx, 50, sx, 112, 2);
    if (four) for (let i = 0; i < 4; i++) _uLine(ctx, sx - 5, 70 + i * 4, sx + 5, 66 + i * 4, 0.9);
    layer('TEXTES');
    text(boardCable(f.S, f.phase), sx + 12, 80, { size: 8, bold: true }); text(`${f1(f.length)} m`, sx + 12, 90, { size: 8, color: mute });
    layer('UNIFILAIRE');
    _uSwitch(ctx, sx, 112, 56);
    text('QS', sx + 24, 128, { bold: true, size: 9 });
    text('Interrupteur-', sx + 24, 139, { size: 8 }); text('sectionneur', sx + 24, 149, { size: 8 });
    text(`${four ? '4P' : '2P'} ${boardSubSwitch(f.In)} A`, sx + 24, 159, { size: 8, color: mute });
    _uLine(ctx, sx, 168, sx, bus, 2);
    // Terre : bornier du TD relié à la borne principale par le conducteur de protection de la ligne
    const ex = 44, ey = 470;
    ctx.lineWidth = 1.2; ctx.strokeRect(ex - 22, ey, 44, 12);
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(ex - 16 + i * 8, ey + 6, 2, 0, Math.PI * 2); ctx.stroke(); }
    text(`Bornier de terre ${P.ref}`, ex - 22, ey - 6, { size: 7.5 });
    _uLine(ctx, ex, ey + 12, ex, ey + 40, 1.4); _uEarth(ctx, ex, ey + 40);
    text('Relié à la borne principale', ex + 14, ey + 50, { size: 7.5 }); text('par le PE de la ligne', ex + 14, ey + 60, { size: 7.5, color: mute });
    text(`(conducteur vert / jaune ${_bS(f.S)} mm²)`, ex - 22, ey + 80, { size: 7, color: mute });
  } else if (first) {
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
    // Délesteur : mesure du courant sur l'arrivée, ordres fil pilote vers les circuits de chauffage
    if (design.supply && design.supply.shed) {
      const px = 150 + (design.supply.surge ? 70 : 0), heat = design.circuits.filter((c) => c.kind === 'heating').map((c) => c.id);
      _uLine(ctx, px, bus, px, bus + 22, 1.3);
      ctx.lineWidth = 1.3; ctx.strokeRect(px - 13, bus + 22, 26, 30);
      text('DL', px, bus + 41, { size: 9, bold: true, align: 'center' });
      _uLine(ctx, px, bus + 52, px, bus + 62, 1.3); _uEarth(ctx, px, bus + 62); // neutre / terre fonctionnelle
      text('Délesteur', px + 17, bus + 32, { size: 7.5 }); text('fil pilote', px + 17, bus + 42, { size: 7, color: mute });
      const lines = []; for (let i = 0; i < heat.length; i += 3) lines.push(heat.slice(i, i + 3).join(', '));
      (heat.length ? ['→ ' + lines[0]].concat(lines.slice(1)) : ['aucun chauffage']).forEach((l, i) => text(l, px + 17, bus + 52 + i * 10, { size: 7, color: heat.length ? blue : red }));
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
    text(`Suite du folio ${fno(k - 1)}`, 30, bus - 8, { size: 8, color: mute });
    _uLine(ctx, 30, bus, 100, bus, 2.4);
  }
  // Barre principale (jeu de barres / peigne)
  const busX0 = first ? sx : 30;
  _uLine(ctx, busX0, bus, F.xEnd + 10, bus, 2.4);
  if (tri) { // barre 3P+N : quatre traits obliques
    for (let i = 0; i < 4; i++) _uLine(ctx, busX0 + 40 + i * 5, bus + 5, busX0 + 46 + i * 5, bus - 5, 1);
    layer('TEXTES'); text('3P+N', busX0 + 34, bus - 9, { size: 7.5, color: mute }); layer('UNIFILAIRE');
  }
  if (k < nF - 1 && lay.folios[k + 1].panel === P) { text(`Suite folio ${fno(k + 1)} →`, F.xEnd + 14, bus + 4, { size: 8, color: mute }); }

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
    } else if (g.feed || g.ddr) {
      // départs vers les tableaux divisionnaires (AGCP 500 mA sélectif), disjoncteurs différentiels 30 mA
      layer('TEXTES');
      if (g.feed) { text('Départs TD', xc + 6, bus + 34, { size: 7.5, bold: true }); text('sous l’AGCP', xc + 6, bus + 44, { size: 7, color: mute }); }
      else { text('Disj. différentiels', xc + 6, bus + 34, { size: 7.5, bold: true, color: blue }); text('30 mA, sous l’AGCP', xc + 6, bus + 44, { size: 7, color: mute }); }
      layer('UNIFILAIRE');
      _uLine(ctx, xc, bus + 16, xc, bus + 72, 1.6);
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
      if (c.ddr) { ctx.strokeStyle = blue; _uTorus(ctx, x, sub + 14 + 38, sub + 14 + 26); ctx.strokeStyle = ink; } // disjoncteur différentiel
      layer('TEXTES');
      text(`${c.curve || 'C'}${c.In}`, x + 4, sub + 34, { size: 7.5, bold: true });
      if (c.ddr) text(`30 mA ${c.ddr}`, x + 4, sub + 76, { size: 6.5, color: blue });
      if (tri && c.phase) text(c.phase === '3P' ? '3P+N' : c.phase, x + 4, c.ddr ? sub + 22 : sub + 44, { size: 7, color: c.phase === '3P' ? ink : mute });
      layer('UNIFILAIRE');
      let y = sub + 64;
      if (c.contactor || c.teleruptor) { _uContactor(ctx, x, y + 4, 38, c.contactor ? (c.contactor === 'hc' ? 'HC' : c.contactor === 'ih' ? 'IH' : 'KM') : 'TL'); _uLine(ctx, x, y, x, y + 4, 1.3); y += 42; }
      else { _uLine(ctx, x, y, x, y + 42, 1.3); y += 42; }
      if (c.kind === 'pv') { _uLine(ctx, x, y, x, y + 4, 1.3); _uInverter(ctx, x, y + 4); } // production : l'onduleur au bout du circuit
      else { _uLine(ctx, x, y, x, y + 10, 1.3); _uArrow(ctx, x, y + 10); }
      if (c.phase === '3P') for (let i = 0; i < 4; i++) _uLine(ctx, x - 5, y - 26 + i * 4, x + 5, y - 30 + i * 4, 0.9); // 3 phases + neutre
      layer('TEXTES');
      const detail = `${boardCable(c.S, c.phase)} · ${f1(c.length)} m` + (c.buried ? ' · enterré (TPC)' : '') + (c.kind === 'sub' ? ` · vers ${c.panelRef || 'TD'}, folio ${fno(lay.panelFolio[c.id] || 0)}` : c.rooms ? ' · ' + c.rooms : '');
      text(fit(c.name, 30), x - 2, UNI.text, { rot: -Math.PI / 2, bold: true, size: 8.5 });
      text(fit(detail, 40), x + 8, UNI.text, { rot: -Math.PI / 2, size: 7, color: mute });
    });
  }

  // Nomenclature des départs
  layer('CARTOUCHE');
  const rowsT = [['Repère', (c) => c.id], ['Protection', (c) => `${c.curve || 'C'}${c.In} A`], ['Différentiel', (c) => c.rcd || (c.kind === 'sub' ? 'AGCP' : c.ddr ? 'DDR ' + c.ddr : '—')], ['Câble', (c) => boardCable(c.S, c.phase)],
    ['Longueur', (c) => f1(c.length) + ' m'], ['Charge', (c) => (c.kind === 'light' ? c.points + ' pts' : c.kind === 'socket' ? c.points + ' PC' : c.kind === 'sub' ? c.panelRef || 'TD' : c.kind === 'pv' ? f1(c.power / 1000) + ' kWc' : c.power >= 1000 ? f1(c.power / 1000) + ' kW' : Math.round(c.power) + ' W')],
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
      rowsT.forEach(([, f], r) => text(f(c), x, t0 + r * rh + 9.5, { size: 6.8, align: 'center', bold: r === 0, color: r === rowsT.length - 1 && c.ok === false ? red : ink }));
    });
  }
  if (P.id && first) { // sous le bornier de terre du TD, à gauche des départs
    [`ΔU comptée depuis l’origine :`, `ligne ${P.feeder.id} comprise (${f1(P.feeder.dUpct)} %) ;`, 'Icc mini avec l’impédance', 'de cette ligne (note de calcul).'].forEach((l, i) => text(l, 22, 584 + i * 10, { size: 7, color: mute }));
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
    ['Longueur L', (design.panels || []).length ? 'jusqu’à l’appareil le plus éloigné ; TD : ΔU et Icc comptés depuis l’AGCP (départ compris)' : 'jusqu’à l’appareil le plus éloigné du circuit (mesurée sur le plan)'],
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
    ['Contacts indirects', 'ID (ou disjoncteur différentiel) 30 mA sur tous les circuits terminaux (coupure automatique)'],
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
// Nomenclature du matériel (folios A3) : les lignes du métré (materials.js),
// par catégorie, numérotées ; la catégorie reprise en tête de folio
// ---------------------------------------------------------------------------
const NOMEN_ROWS = 44;
function _nomenPages(list) {
  const rows = [];
  let cat = null, n = 0;
  for (const l of list.lines) {
    if (l.cat !== cat) { cat = l.cat; rows.push({ cat: cat === 'Équipements' ? 'Équipements (facultatifs)' : cat }); }
    rows.push({ l, n: ++n, cat: cat === 'Équipements' ? 'Équipements (facultatifs)' : cat });
  }
  const pages = [];
  for (let i = 0; i < rows.length;) {
    const page = [];
    if (!rows[i].l) { page.push(rows[i]); i++; } else page.push({ cat: rows[i].cat + ' (suite)' });
    while (page.length < NOMEN_ROWS && i < rows.length) {
      if (!rows[i].l && page.length > NOMEN_ROWS - 3) break; // pas de catégorie orpheline en bas de folio
      page.push(rows[i]); i++;
    }
    pages.push(page);
  }
  return pages.length ? pages : [[]];
}
function nomenclatureFolios(list) { return _nomenPages(list).length; }
function drawNomenclature(ctx, design, meta, list, folio) {
  const pages = _nomenPages(list), k = Math.min(folio || 0, pages.length - 1), rows = pages[k], nF = pages.length;
  const ink = '#1a2230', mute = '#5b6b82';
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 8.5}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const fit = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  ctx.save(); ctx.strokeStyle = ink;
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Nomenclature du matériel', k, nF);
  layer('TEXTES');
  text('Nomenclature du matériel', 30, 46, { bold: true, size: 17 });
  text('Quantités tirées du plan et du tableau : longueurs de câble mesurées + 10 % de chutes, une boîte d’encastrement par appareil selon le mur (placo, doublage, maçonnerie).', 262, 45, { size: 8, color: mute });
  const tx0 = 30, tx1 = UNI.W - 30, ty = 62, hh = 20, rh = 14.8;
  const cols = [['N°', 40, true], ['Désignation', 560], ['Quantité', 76, true], ['Unité', 50], ['Remarque', tx1 - tx0 - 40 - 560 - 76 - 50]];
  const y1 = ty + hh + rows.length * rh;
  if (!('layer' in ctx)) { // fonds (SVG seulement)
    ctx.fillStyle = '#e8eef6'; ctx.beginPath(); ctx.rect(tx0, ty, tx1 - tx0, hh); ctx.fill();
    ctx.fillStyle = '#f1f4f9';
    rows.forEach((r, i) => { if (!r.l) { ctx.beginPath(); ctx.rect(tx0, ty + hh + i * rh, tx1 - tx0, rh); ctx.fill(); } });
  }
  layer('CARTOUCHE');
  _uLine(ctx, tx0, ty, tx1, ty, 1.1); _uLine(ctx, tx0, ty + hh, tx1, ty + hh, 1); _uLine(ctx, tx0, y1, tx1, y1, 1.1);
  for (let i = 1; i < rows.length; i++) _uLine(ctx, tx0, ty + hh + i * rh, tx1, ty + hh + i * rh, 0.4);
  let x = tx0;
  for (const c of cols) { _uLine(ctx, x, ty, x, y1, x === tx0 ? 1.1 : 0.5); x += c[1]; }
  _uLine(ctx, tx1, ty, tx1, y1, 1.1);
  layer('TEXTES');
  x = tx0;
  const xs = cols.map((c) => { const x0 = x; x += c[1]; return x0; });
  cols.forEach(([lab, w, right], i) => text(lab, right ? xs[i] + w - 5 : xs[i] + 5, ty + 13.5, { bold: true, size: 8, align: right ? 'right' : 'left' }));
  rows.forEach((r, i) => {
    const y = ty + hh + i * rh + 10.5;
    if (!r.l) { text(r.cat, xs[1] + 5, y, { bold: true, size: 8.5 }); return; }
    const q = Number(r.l.qty).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    text(String(r.n), xs[0] + cols[0][1] - 5, y, { size: 8, align: 'right', color: mute });
    text(fit(r.l.name, 118), xs[1] + 5, y, { size: 8.5 });
    text(q, xs[2] + cols[2][1] - 5, y, { size: 8.5, bold: true, align: 'right' });
    text(r.l.unit, xs[3] + 5, y, { size: 8.5 });
    text(fit(r.l.note || '', 84), xs[4] + 5, y, { size: 7.5, color: mute });
  });
  if (k === nF - 1) {
    const n = list.lines.length, eq = list.lines.filter((l) => l.cat === 'Équipements').length;
    text(`${n} article${n > 1 ? 's' : ''}${eq ? `, dont ${eq} équipement${eq > 1 ? 's' : ''} facultatif${eq > 1 ? 's' : ''} (souvent achetés à part)` : ''}. Références commerciales et prix : à choisir chez le fournisseur (prix indicatifs dans l’onglet Métré).`, tx0, Math.min(y1 + 20, UNI.H - 90), { size: 8.5, color: mute });
  } else text(`Suite folio ${(meta && meta.sheets ? meta.sheet + k + 1 : k + 2)} →`, tx1, Math.min(y1 + 20, UNI.H - 90), { size: 8, color: mute, align: 'right' });
  ctx.restore();
}
function nomenclatureSVGs(design, meta, components, wires) {
  const list = materialList(components, wires, design), out = [];
  for (let k = 0; k < nomenclatureFolios(list); k++) {
    const ctx = new SVGContext();
    drawNomenclature(ctx, design, meta, list, k);
    out.push(_folioWrap(ctx.out.join('')));
  }
  return out;
}
function nomenclatureDXF(design, meta, components, wires) {
  const list = materialList(components, wires, design), ctx = new DXFContext(), n = nomenclatureFolios(list);
  for (let k = 0; k < n; k++) { ctx.save(); ctx.translate(0, k * (UNI.H + 60)); drawNomenclature(ctx, design, meta, list, k); ctx.restore(); }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, { U: 1 / 0.3528, insunits: 4, layers: [['TEXTES', 7], ['CARTOUCHE', 8]] });
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
// Chauffage électrique : raccordement des radiateurs (phase, neutre, fil pilote,
// terre) circuit par circuit ; le fil pilote vient du délesteur ou d'un
// programmateur (gestionnaire d'énergie)
// ---------------------------------------------------------------------------
const HEAT_PER = 6; // circuits par folio
function heatingCircuits(design, components) {
  const byId = {};
  for (const c of components || []) byId[c.id] = c;
  return design.circuits.filter((c) => c.kind === 'heating').map((c) => {
    const rads = (c.devices || []).map((id) => byId[id]).filter((d) => d && LOADS[d.type] && LOADS[d.type].cls === 'heating');
    const list = rads.length ? rads.map((d) => ({ ref: d.label || d.id, P: loadPower(d), room: (c.rooms || '').split(', ').length === 1 ? c.rooms : '' }))
      : Array.from({ length: Math.max(1, c.points || 1) }, (_, i) => ({ ref: `R${i + 1}`, P: Math.round((c.power || 0) / Math.max(1, c.points || 1)), room: '' }));
    return { c, rads: list.slice(0, 6), more: Math.max(0, list.length - 6) };
  });
}
function heatingFolios(list) { return Math.max(1, Math.ceil(list.length / HEAT_PER)); }
function drawHeating(ctx, design, meta, list, folio) {
  const k = folio || 0, nF = heatingFolios(list), mine = list.slice(k * HEAT_PER, (k + 1) * HEAT_PER);
  const ink = '#1a2230', mute = '#5b6b82', L = '#b3261e', N = '#1668c4', FP = '#1a1a1a', PE = '#2e9e46';
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 8}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const wire = (color, pts, w, dash) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w || 1.3; if (dash) ctx.setLineDash(dash); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.restore(); };
  const dot = (x, y, c) => { ctx.save(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  const shed = design.supply && design.supply.shed;
  ctx.save(); ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Chauffage électrique — raccordement fil pilote', k, nF);
  layer('TEXTES');
  text('Chauffage électrique — fil pilote', 30, 46, { bold: true, size: 17 });
  text('Chaque radiateur : phase, neutre, fil pilote (ordres confort / éco / hors-gel / arrêt) et terre ; 4 500 W au plus par circuit de 2,5 mm² (20 A)', 30, 62, { size: 8, color: mute });
  // légende des conducteurs
  [['Phase', L], ['Neutre', N], ['Fil pilote (noir ou gris)', FP], ['Terre', PE]].forEach(([t, c], i) => { const x = UNI.W - 30 - (4 - i) * 150; layer('SCHEMA'); wire(c, [[x, 42], [x + 20, 42]], 2); layer('TEXTES'); text(t, x + 25, 45, { size: 8 }); });
  // source des ordres fil pilote
  const sx = 30, sy = 92;
  layer('SCHEMA'); ctx.save(); ctx.lineWidth = 1.2; if (!shed) ctx.setLineDash([4, 3]); ctx.strokeRect(sx, sy, 130, 42); ctx.restore();
  layer('TEXTES');
  text(shed ? 'Délesteur DL' : 'Programmateur (option)', sx + 8, sy + 16, { bold: true, size: 8.5 });
  text(shed ? 'coupe le chauffage aux pointes' : 'gestionnaire d’énergie fil pilote', sx + 8, sy + 28, { size: 7, color: mute });
  text(shed ? 'sortie fil pilote par zone' : 'sans : radiateurs en confort', sx + 8, sy + 38, { size: 7, color: mute });
  const fpY = sy + 29;
  const x0 = 200, colW = 160, yTop = 150, radH = 40, gap = 24;
  mine.forEach(({ c, rads, more }, i) => {
    const x = x0 + i * colW, xl = x, xn = x + 9, xf = x + 18, xp = x + 27;
    layer('TEXTES');
    // en-tête au-dessus du bus du fil pilote (fpY), pour ne pas le croiser
    text(`${c.id} · ${c.name.length > 22 ? c.name.slice(0, 21) + '…' : c.name}`, x - 6, fpY - 22, { bold: true, size: 8.5 });
    text(`${c.curve || 'C'}${c.In} · ${boardCable(c.S, c.phase)}${c.rcd ? ' · ' + c.rcd : ''} · ${_bNum((c.power || 0) / 1000, 1)} kW`, x - 6, fpY - 11, { size: 7, color: c.power > 4500 && c.S < 4 ? '#b3261e' : mute });
    // disjoncteur sur la phase, puis les quatre conducteurs vers les radiateurs
    layer('SCHEMA');
    ctx.strokeStyle = ink; _uBreaker(ctx, xl, yTop, 36); ctx.strokeStyle = ink;
    const yEnd = yTop + 48 + rads.length * (radH + gap);
    wire(L, [[xl, yTop + 36], [xl, yEnd]], 1.4); wire(N, [[xn, yTop], [xn, yEnd]], 1.4); wire(PE, [[xp, yTop], [xp, yEnd]], 1.4);
    // fil pilote : depuis la source, le long du haut de page, puis dans la colonne
    wire(FP, [[xf, fpY + (i % 2 ? 3 : 0)], [xf, yEnd]], 1.2, shed ? null : [3, 2]);
    if (i === 0) wire(FP, [[sx + 130, fpY], [x0 + (mine.length - 1) * colW + 18, fpY]], 1.2, shed ? null : [3, 2]);
    dot(xf, fpY, FP);
    rads.forEach((r, j) => {
      const y = yTop + 48 + j * (radH + gap), bx = x + 50;
      layer('SCHEMA');
      ctx.save(); ctx.lineWidth = 1.1; ctx.strokeStyle = ink; ctx.strokeRect(bx, y, 86, radH); ctx.restore();
      for (let q = 1; q < 6; q++) wire('#9aa4b2', [[bx + q * 14.3, y + 6], [bx + q * 14.3, y + radH - 6]], 0.6); // éléments chauffants
      const ty = (n) => y + 8 + n * 8;
      [[xl, L], [xn, N], [xf, FP], [xp, PE]].forEach(([cx, col], n) => { wire(col, [[cx, ty(n)], [bx, ty(n)]], 1, col === FP && !shed ? [3, 2] : null); dot(cx, ty(n), col); });
      layer('TEXTES');
      text(r.ref, bx + 43, y + radH + 9, { size: 7, bold: true, align: 'center' });
      text(`${_bNum(r.P)} W${r.room ? ' · ' + r.room : ''}`, bx + 43, y + radH + 17, { size: 6.5, color: mute, align: 'center' });
    });
    if (more) { layer('TEXTES'); text(`+ ${more} radiateur${more > 1 ? 's' : ''}`, x + 50, yEnd + 12, { size: 7, color: mute }); }
  });
  if (!mine.length) { layer('TEXTES'); text('Aucun circuit de chauffage électrique.', 30, 170, { size: 11, color: mute }); }
  layer('TEXTES');
  const yb = UNI.H - 15 - 62 - 22;
  text('Le fil pilote n’est jamais relié à la terre ni au neutre ; sans gestionnaire, il reste isolé (dans un domino) et le radiateur fonctionne en confort. Boîte de sortie de câble à 30 cm du sol derrière chaque radiateur.', 30, yb, { size: 7.5, color: mute });
  ctx.restore();
}
function heatingSVGs(design, meta, components) {
  const list = heatingCircuits(design, components), out = [];
  for (let k = 0; k < heatingFolios(list); k++) {
    const ctx = new SVGContext();
    drawHeating(ctx, design, meta, list, k);
    out.push(_folioWrap(ctx.out.join('')));
  }
  return out;
}
function heatingDXF(design, meta, components) {
  const list = heatingCircuits(design, components), ctx = new DXFContext(), n = heatingFolios(list);
  for (let k = 0; k < n; k++) { ctx.save(); ctx.translate(0, k * (UNI.H + 60)); drawHeating(ctx, design, meta, list, k); ctx.restore(); }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, { U: 1 / 0.3528, insunits: 4, layers: [['SCHEMA', 7], ['TEXTES', 2], ['CARTOUCHE', 8]] });
}

// ---------------------------------------------------------------------------
// Volets roulants : chaque commande (inverseur montée / descente, verrouillé)
// et son moteur tubulaire — phase, neutre, terre, deux fils de sens
// ---------------------------------------------------------------------------
const VR_PER = 6, VR_ROWS = 7;
function shutterCircuits(design, components) {
  const byId = {};
  for (const c of components || []) byId[c.id] = c;
  const out = [];
  design.circuits.filter((c) => c.appliance === 'shutter' || /volet/i.test(c.name)).forEach((c) => {
    const devs = (c.devices || []).map((id) => byId[id]).filter(Boolean);
    const motors = devs.filter((d) => d.type === 'shutter'), sws = devs.filter((d) => d.type === 'switch_shutter');
    // chaque moteur avec la commande la plus proche
    const list = motors.length ? motors.map((m) => { const s = sws.slice().sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0]; return { ref: m.label || m.id, sw: s ? s.label || s.id : '—' }; })
      : Array.from({ length: Math.max(1, c.points || 1) }, (_, i) => ({ ref: `VR${i + 1}`, sw: `SV${i + 1}` }));
    // une colonne par tranche de VR_ROWS moteurs (« suite » pour les suivantes)
    for (let i = 0; i < list.length; i += VR_ROWS) out.push({ c, list: list.slice(i, i + VR_ROWS), cont: i > 0, more: 0 });
  });
  return out;
}
function shutterFolios(list) { return Math.max(1, Math.ceil(list.length / VR_PER)); }
function drawShutters(ctx, design, meta, list, folio) {
  const k = folio || 0, nF = shutterFolios(list), mine = list.slice(k * VR_PER, (k + 1) * VR_PER);
  const ink = '#1a2230', mute = '#5b6b82', L = '#b3261e', N = '#1668c4', PE = '#2e9e46', UP = '#8a5a2b', DN = '#1a1a1a';
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 8}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const wire = (color, pts, w, dash) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w || 1.2; if (dash) ctx.setLineDash(dash); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.restore(); };
  const dot = (x, y, c) => { ctx.save(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  ctx.save(); ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Volets roulants — commandes et moteurs', k, nF);
  layer('TEXTES');
  text('Volets roulants — commandes et moteurs', 30, 46, { bold: true, size: 17 });
  text('Chaque commande (inverseur montée / descente, verrouillé : jamais les deux sens à la fois) alimente un moteur tubulaire : deux fils de sens, neutre et terre', 30, 62, { size: 8, color: mute });
  [['Phase', L], ['Montée', UP], ['Descente', DN], ['Neutre', N], ['Terre', PE]].forEach(([t, c], i) => { const x = UNI.W - 30 - (5 - i) * 118; layer('SCHEMA'); wire(c, [[x, 42], [x + 20, 42]], 2); layer('TEXTES'); text(t, x + 25, 45, { size: 8 }); });
  const x0 = 40, colW = 188, yTop = 100, rowH = 78;
  mine.forEach(({ c, list, more, cont }, i) => {
    const x = x0 + i * colW, xl = x, xn = x + 9, xp = x + 18;
    layer('TEXTES');
    text(`${c.id} · ${c.name.length > 24 ? c.name.slice(0, 23) + '…' : c.name}${cont ? ' (suite)' : ''}`, x - 6, yTop - 16, { bold: true, size: 8.5 });
    text(`${c.curve || 'C'}${c.In} · ${boardCable(c.S, c.phase)}${c.rcd ? ' · ' + c.rcd : ''}`, x - 6, yTop - 5, { size: 7, color: mute });
    layer('SCHEMA');
    ctx.strokeStyle = ink; if (!cont) _uBreaker(ctx, xl, yTop, 36); // « suite » : mêmes conducteurs, sans second disjoncteur
    const yEnd = yTop + 44 + list.length * rowH - 20;
    wire(L, [[xl, cont ? yTop : yTop + 36], [xl, yEnd]], 1.4); wire(N, [[xn, yTop], [xn, yEnd]], 1.4); wire(PE, [[xp, yTop], [xp, yEnd]], 1.4);
    list.forEach((r, j) => {
      const y = yTop + 54 + j * rowH, bx = x + 42, mx = x + 138;
      layer('SCHEMA');
      // inverseur : commun sur la phase, deux contacts (montée, descente) verrouillés
      wire(L, [[xl, y], [bx, y]], 1.1); dot(xl, y, L); dot(bx, y, ink);
      wire(ink, [[bx, y], [bx + 16, y - 9]], 1.1); wire(ink, [[bx, y], [bx + 14, y + 11]], 1.1);
      wire(ink, [[bx + 20, y - 14], [bx + 20, y - 6]], 1); wire(ink, [[bx + 20, y + 6], [bx + 20, y + 14]], 1);
      wire(mute, [[bx + 8, y - 5], [bx + 8, y + 6]], 0.7, [2, 2]); // verrouillage mécanique
      // fils de sens vers le moteur
      wire(UP, [[bx + 20, y - 10], [mx - 12, y - 10], [mx - 8, y - 5]], 1.1);
      wire(DN, [[bx + 20, y + 10], [mx - 12, y + 10], [mx - 8, y + 5]], 1.1);
      ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(mx, y, 11, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      wire(N, [[xn, y + 22], [mx, y + 22], [mx, y + 11]], 1); dot(xn, y + 22, N);
      wire(PE, [[xp, y + 28], [mx + 16, y + 28], [mx + 16, y + 4], [mx + 11, y + 4]], 1); dot(xp, y + 28, PE);
      layer('TEXTES');
      text('M', mx, y + 2, { size: 9, bold: true, align: 'center' }); text('1~', mx, y + 9, { size: 5.5, align: 'center', color: mute });
      text(r.sw, bx - 2, y - 14, { size: 7, bold: true, align: 'right' });
      text('▲', bx + 24, y - 11, { size: 6, color: UP }); text('▼', bx + 24, y + 15, { size: 6, color: DN });
      text(r.ref, mx + 14, y - 12, { size: 7, bold: true });
    });
    if (more) { layer('TEXTES'); text(`+ ${more} volet${more > 1 ? 's' : ''}`, x + 42, yEnd + 14, { size: 7, color: mute }); }
  });
  if (!mine.length) { layer('TEXTES'); text('Aucun volet roulant motorisé.', 30, 170, { size: 11, color: mute }); }
  layer('TEXTES');
  text('Commandes à 1,10 m (entre 0,90 et 1,30 m), boîte de raccordement près du coffre ; câble 4 conducteurs (3G + sens) ou 5G1,5 entre commande et moteur.', 30, UNI.H - 15 - 62 - 22, { size: 7.5, color: mute });
  ctx.restore();
}
function shutterSVGs(design, meta, components) {
  const list = shutterCircuits(design, components), out = [];
  for (let k = 0; k < shutterFolios(list); k++) { const ctx = new SVGContext(); drawShutters(ctx, design, meta, list, k); out.push(_folioWrap(ctx.out.join(''))); }
  return out;
}
function shutterDXF(design, meta, components) {
  const list = shutterCircuits(design, components), ctx = new DXFContext(), n = shutterFolios(list);
  for (let k = 0; k < n; k++) { ctx.save(); ctx.translate(0, k * (UNI.H + 60)); drawShutters(ctx, design, meta, list, k); ctx.restore(); }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, { U: 1 / 0.3528, insunits: 4, layers: [['SCHEMA', 7], ['TEXTES', 2], ['CARTOUCHE', 8]] });
}

// ---------------------------------------------------------------------------
// Mise à la terre (schéma TT) : prise de terre, barrette de coupure, borne
// principale, conducteurs de protection de chaque circuit (par section), liaison
// équipotentielle principale (LEP) et supplémentaire des salles d'eau (LES)
// ---------------------------------------------------------------------------
const EARTH_S = { earth: 16, bare: 25, main: 16, les: 4, lesConduit: 2.5 };
// LEP : la moitié du conducteur principal de protection, 6 mm² au moins (section normalisée)
function earthLepS() { return [6, 10, 16, 25].find((x) => x >= Math.max(6, EARTH_S.main / 2)); }
// Salles d'eau desservies (d'après les pièces des circuits) et leurs circuits
function earthWetRooms(design) {
  const D = design.root || design, re = /salle d.?eau|salle de bain|\bsdb\b|douche/i, out = [];
  for (const c of D.circuits) {
    if (c.kind === 'sub') continue;
    for (const r of String(c.rooms || '').split(', ')) {
      if (!r || !re.test(r)) continue;
      let o = out.find((x) => x.name === r);
      if (!o) out.push((o = { name: r, circuits: [] }));
      o.circuits.push(c.id);
    }
  }
  return out;
}
// Conducteurs de protection d'un tableau, regroupés par section
function _earthGroups(circuits) {
  const G = {};
  for (const c of circuits) if (c.kind !== 'sub') (G[c.S] = G[c.S] || []).push(c.id);
  return Object.keys(G).map(Number).sort((a, b) => a - b).map((S) => ({ S, ids: G[S] }));
}
function drawEarthing(ctx, design, meta) {
  const D = design.root || design, ink = '#1a2230', mute = '#5b6b82', PE = '#2e9e46', VJ = '#e8c21a', CU = '#b87333', red = '#b3261e';
  const isDxf = !!ctx.ents, layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 8}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const path = (color, pts, w, dash) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w || 1.3; if (dash) ctx.setLineDash(dash); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.restore(); };
  // conducteur vert-jaune : vert, rayé de jaune (trait simple en DXF)
  const vj = (pts, w) => { path(PE, pts, w || 1.8); if (!isDxf) path(VJ, pts, (w || 1.8) * 0.5, [4, 5]); };
  const dot = (x, y, c) => { ctx.save(); ctx.fillStyle = c || PE; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  const clamp = (x, y) => { ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); };
  const bar = (x, y, w, n) => { // répartiteur / borne : barrette percée
    ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.strokeRect(x, y, w, 12);
    for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(x + (w / n) * (i + 0.5), y + 6, 2, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  };
  const fitIds = (ids, per) => { const L = []; for (let i = 0; i < ids.length; i += per) L.push(ids.slice(i, i + per).join(', ')); return L; };
  const N = calcNote(D), lep = earthLepS();
  ctx.save(); ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, D, meta, 'Mise à la terre et liaisons équipotentielles', 0, 1);
  layer('TEXTES');
  text('Mise à la terre et liaisons équipotentielles', 30, 46, { bold: true, size: 17 });
  text('Schéma TT : prise de terre, borne principale, conducteur de protection de chaque circuit, liaisons équipotentielles principale et supplémentaire', 30, 62, { size: 8, color: mute });
  [['Conducteur de protection vert-jaune', null], ['Cuivre nu (prise de terre)', CU]].forEach(([t, c], i) => {
    const x = UNI.W - 30 - (2 - i) * 190; layer('SCHEMA'); if (c) path(c, [[x, 42], [x + 20, 42]], 2); else vj([[x, 42], [x + 20, 42]], 2); layer('TEXTES'); text(t, x + 25, 45, { size: 8 });
  });
  // --- Colonne gauche : borne principale, conducteur de terre, barrette, prise de terre
  const ex = 120, by = 140;
  layer('SCHEMA'); bar(ex - 40, by, 80, 6);
  layer('TEXTES'); text('Borne principale de terre', ex + 8, by + 30, { bold: true, size: 8 }); text('dans la GTL', ex + 8, by + 40, { size: 7, color: mute });
  layer('SCHEMA'); vj([[ex, by + 12], [ex, 240]]);
  layer('TEXTES'); text('Conducteur de terre', ex + 8, 208, { size: 7.5 }); text(`${EARTH_S.earth} mm² Cu isolé`, ex + 8, 218, { size: 7, color: mute });
  layer('SCHEMA'); // barrette de coupure : deux bornes et la lame démontable
  ctx.save(); ctx.lineWidth = 1.1; ctx.strokeRect(ex - 9, 240, 18, 8); ctx.strokeRect(ex - 9, 258, 18, 8); ctx.strokeRect(ex - 4, 244, 8, 18); ctx.restore(); clamp(ex, 253);
  layer('TEXTES'); text('Barrette de coupure', ex + 16, 250, { bold: true, size: 8 }); text('mesure de RA, démontable à l’outil', ex + 16, 260, { size: 7, color: mute });
  layer('SCHEMA'); vj([[ex, 266], [ex, 330]]);
  path(ink, [[40, 322], [260, 322]], 1.2); // niveau du sol
  for (let x = 44; x < 260; x += 10) path(ink, [[x, 322], [x - 6, 330]], 0.6);
  path(CU, [[ex, 330], [ex, 352]], 2);
  ctx.save(); ctx.strokeStyle = CU; ctx.lineWidth = 2; ctx.strokeRect(45, 352, 210, 22); ctx.restore(); // boucle à fond de fouille
  _uEarth(ctx, 255, 374);
  layer('TEXTES');
  text('Prise de terre : boucle à fond de fouille', 40, 398, { bold: true, size: 8 });
  text(`cuivre nu ${EARTH_S.bare} mm² sous les fondations (à défaut : piquet de terre)`, 40, 409, { size: 7, color: mute });
  const raOk = N.ra ? N.ra <= N.raMax : null;
  text(N.ra ? `RA mesurée : ${_bNum(N.ra)} Ω — ${raOk ? 'conforme' : 'trop élevée'}` : `RA à mesurer : ${N.raMax} Ω au plus`, 40, 428, { bold: true, size: 8.5, color: raOk === false ? red : ink });
  text(`RA × 0,5 A ≤ 50 V (AGCP ${D.agcp ? D.agcp.setting + ' A ' : ''}500 mA)`, 40, 439, { size: 7, color: mute });
  // sections des conducteurs de protection
  const sy = 470;
  layer('SCHEMA'); ctx.save(); ctx.lineWidth = 1; ctx.strokeRect(30, sy, 250, 132); ctx.restore();
  layer('TEXTES'); text('Sections (cuivre)', 40, sy + 16, { bold: true, size: 8.5 });
  [['Conducteur de terre', `${EARTH_S.earth} mm² isolé (${EARTH_S.bare} nu)`], ['Conducteur principal de protection', `${EARTH_S.main} mm²`],
    ['LEP (½ PE principal, 6 mm² au moins)', `${lep} mm²`], ['LES des salles d’eau', `${EARTH_S.les} mm² (${_bS(EARTH_S.lesConduit)} sous conduit)`],
    ['PE de chaque circuit', 'section des phases'], ['PE d’un tableau divisionnaire', 'section de sa ligne']].forEach(([a, b], i) => {
    text(a, 40, sy + 34 + i * 16, { size: 7.5 }); text(b, 272, sy + 34 + i * 16, { size: 7.5, color: mute, align: 'right' });
  });
  // --- Colonne centrale : répartiteur du tableau principal et PE des circuits
  const rx = 330, rw = 460, ry = 144, panels = D.panels || [];
  const mainCs = D.circuits.filter((c) => !c.panel), feeds = panels.map((p) => p.feeder).filter(Boolean);
  layer('SCHEMA'); vj([[ex + 40, by + 6], [rx, by + 6]]);
  layer('TEXTES'); text(`PE principal ${EARTH_S.main} mm²`, ex + 50, by + 1, { size: 7, color: mute });
  const rEnd = rx + rw + Math.max(0, feeds.length - 1) * 8 + (feeds.length ? 10 : 0);
  layer('SCHEMA'); bar(rx, ry, rEnd - rx, Math.round((rEnd - rx) / 24));
  layer('TEXTES'); text('Répartiteur de terre — tableau principal', rx, ry - 8, { bold: true, size: 8.5 });
  const groups = (list, x0, w, y0, per, colMax) => {
    const G = _earthGroups(list), cw = Math.min(colMax, w / Math.max(1, G.length));
    G.forEach((g, i) => {
      const gx = x0 + i * cw, L = fitIds(g.ids, per), h = 22 + L.length * 10;
      layer('SCHEMA'); vj([[gx + 10, y0 - 22], [gx + 10, y0]], 1.4); dot(gx + 10, y0 - 22);
      ctx.save(); ctx.lineWidth = 0.9; ctx.strokeRect(gx, y0, cw - 12, h); ctx.restore();
      layer('TEXTES'); text(`PE ${_bS(g.S)} mm²`, gx + 5, y0 + 12, { bold: true, size: 7.5 });
      L.forEach((l, j) => text(l, gx + 5, y0 + 23 + j * 10, { size: 7, color: mute }));
    });
    return G.length;
  };
  groups(mainCs, rx, rw, ry + 34, 4, 115);
  // tableaux divisionnaires : PE de la ligne d'alimentation jusqu'à leur répartiteur
  const tdY = 372, lesY = panels.length ? 540 : 380;
  panels.slice(0, 2).forEach((P, j) => {
    const f = P.feeder, tx = rx + j * 240, xv = rx + rw + j * 8, yh = 346 + j * 6;
    layer('SCHEMA'); vj([[xv, ry + 12], [xv, yh], [tx + 110, yh], [tx + 110, tdY]], 1.5); dot(xv, ry + 12);
    bar(tx, tdY, 220, 9);
    layer('TEXTES');
    const nm = `${P.ref} · ${P.name || ''}`; text(nm.length > 22 ? nm.slice(0, 21) + '…' : nm, tx, tdY - 6, { bold: true, size: 8 });
    text(`PE ${_bS(f.S)} mm² · ${f.id}${f.length ? ', ' + _bNum(f.length, 0) + ' m' : ''}`, tx + 116, yh + 10 + (j ? 0 : 0), { size: 7, color: mute });
    groups(D.circuits.filter((c) => c.panel === P.id), tx, 220, tdY + 34, 3, 80);
  });
  if (panels.length > 2) { layer('TEXTES'); text(`+ ${panels.length - 2} tableau${panels.length > 3 ? 'x' : ''} divisionnaire${panels.length > 3 ? 's' : ''} (même principe)`, rx + 490, tdY + 8, { size: 7, color: mute }); }
  // salles d'eau : liaison équipotentielle supplémentaire
  const wet = earthWetRooms(D);
  layer('TEXTES'); text('Liaison équipotentielle supplémentaire (LES) — salles d’eau', rx, lesY, { bold: true, size: 8.5 });
  if (!wet.length) text('Aucune salle d’eau repérée : une LES relie, dans chaque local contenant une baignoire ou une douche, les éléments conducteurs au PE.', rx, lesY + 16, { size: 7.5, color: mute });
  wet.slice(0, 3).forEach((w, i) => {
    const lx = rx + i * 160, ly = lesY + 12, bx = lx + 14;
    layer('SCHEMA'); ctx.save(); ctx.lineWidth = 0.9; ctx.setLineDash([4, 3]); ctx.strokeRect(lx, ly, 150, 128); ctx.restore();
    vj([[bx, ly + 36], [bx, ly + 112]], 1.4);
    layer('TEXTES'); text(w.name.length > 26 ? w.name.slice(0, 25) + '…' : w.name, lx + 6, ly + 14, { bold: true, size: 8 });
    text(`PE des circuits ${w.circuits.slice(0, 4).join(', ')}${w.circuits.length > 4 ? '…' : ''}`, lx + 6, ly + 26, { size: 6.8, color: mute });
    ['Canalisations d’eau métalliques', 'Évacuations métalliques', 'Baignoire, receveur métallique', 'Huisseries, bâti métallique'].forEach((t, k) => {
      const yy = ly + 44 + k * 22;
      layer('SCHEMA'); vj([[bx, yy], [bx + 16, yy]], 1.2); dot(bx, yy); clamp(bx + 20, yy);
      layer('TEXTES'); text(t, bx + 28, yy + 3, { size: 7 });
    });
    layer('SCHEMA'); dot(bx, ly + 36);
  });
  if (wet.length > 3) { layer('TEXTES'); text(`+ ${wet.length - 3} autre${wet.length > 4 ? 's' : ''}`, rx + 480, lesY + 20, { size: 7, color: mute }); }
  // --- Colonne droite : liaison équipotentielle principale
  const lx = 870, ly0 = 96;
  layer('SCHEMA'); vj([[ex + 25, by], [ex + 25, ly0], [lx, ly0], [lx, 300]]);
  layer('TEXTES'); text(`Liaison équipotentielle principale (LEP) ${lep} mm² Cu`, rx, ly0 - 5, { size: 7.5, color: mute });
  [['Canalisation d’eau', 'à l’entrée du bâtiment'], ['Canalisation de gaz', 'métallique, après le compteur'], ['Chauffage central', 'canalisations métalliques'], ['Éléments métalliques', 'de la construction (charpente…)']].forEach(([a, b], i) => {
    const y = 136 + i * 54;
    layer('SCHEMA'); vj([[lx, y], [lx + 34, y]], 1.4); dot(lx, y);
    path(mute, [[lx + 38, y - 5], [lx + 110, y - 5]], 1); path(mute, [[lx + 38, y + 5], [lx + 110, y + 5]], 1); clamp(lx + 38, y);
    layer('TEXTES'); text(a, lx + 118, y - 1, { bold: true, size: 7.5 }); text(b, lx + 118, y + 9, { size: 7, color: mute });
  });
  // vérifications
  const vy = 360;
  layer('SCHEMA'); ctx.save(); ctx.lineWidth = 1; ctx.strokeRect(850, vy, 310, 238); ctx.restore();
  layer('TEXTES'); text('À vérifier avant la mise sous tension', 862, vy + 18, { bold: true, size: 8.5 });
  let yy = vy + 38;
  [[`Valeur de RA mesurée à la barrette (${N.raMax} Ω au plus)`], ['Continuité de chaque conducteur de protection', 'jusqu’à la borne principale de terre'],
    ['Prises 2P+T, luminaires de classe I et masses', 'métalliques reliés au PE'], ['LEP : eau, gaz, chauffage, structure raccordés'],
    ['LES réalisée dans chaque salle d’eau'], ['Aucun appareil de coupure sur le PE'],
    ['Vert-jaune réservé aux conducteurs de protection'], ['Barrette de coupure accessible']].forEach((L) => {
    layer('SCHEMA'); ctx.save(); ctx.lineWidth = 0.9; ctx.strokeRect(862, yy - 7, 8, 8); ctx.restore();
    layer('TEXTES'); L.forEach((t, k) => text(t, 878, yy + k * 11, { size: 7.5 }));
    yy += 11 * L.length + 12;
  });
  layer('TEXTES');
  text('Schéma TT : l’AGCP 500 mA protège contre les contacts indirects (RA ≤ 100 Ω) ; les interrupteurs différentiels 30 mA assurent la protection complémentaire des circuits. Conducteur de protection jamais coupé, jamais commun à deux logements.', 30, UNI.H - 15 - 62 - 22, { size: 7.5, color: mute });
  ctx.restore();
}
function earthingSVG(design, meta) { const ctx = new SVGContext(); drawEarthing(ctx, design, meta); return _folioWrap(ctx.out.join('')); }
function earthingDXF(design, meta) {
  const ctx = new DXFContext(); drawEarthing(ctx, design, meta);
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: UNI.H }, { U: 1 / 0.3528, insunits: 4, layers: [['SCHEMA', 7], ['TEXTES', 2], ['CARTOUCHE', 8]] });
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
  const td = (design.panels || []).length ? `, ${design.panels.map((p) => p.ref).join(', ')}` : '';
  S.push({ title: 'Schéma unifilaire', what: (td ? 'Tableau principal' + td + ' : ' : 'Arrivée, AGCP, ') + 'différentiels, disjoncteurs, nomenclature des départs', n: unifilarLayout(design).folios.length, draw: (ctx, m, k) => drawUnifilar(ctx, design, m, k) });
  S.push({ title: 'Câblage du tableau', what: td ? 'Tableau principal' + td + ' : liaisons, peignes, départs, borniers de terre' : 'Liaison AGCP, peignes, départs, bornier de terre', n: boardWiringFolios(design), draw: (ctx, m, k) => drawBoardWiring(ctx, design, m, k) });
  S.push({ title: 'Note de calcul', what: 'Ib, In, Iz, ΔU, Icc mini, longueur maximale protégée, bilan de puissance', n: calcNoteFolios(design), draw: (ctx, m, k) => drawCalcNote(ctx, design, m, k) });
  const lc = lightingControls(design, components, wires);
  S.push({ title: 'Schémas développés', what: 'Commandes d’éclairage pièce par pièce', n: devFolios(lc), draw: (ctx, m, k) => drawDeveloped(ctx, design, m, lc, k) });
  const hc = heatingCircuits(design, components);
  if (hc.length) S.push({ title: 'Chauffage (fil pilote)', what: 'Radiateurs de chaque circuit : phase, neutre, fil pilote, terre', n: heatingFolios(hc), draw: (ctx, m, k) => drawHeating(ctx, design, m, hc, k) });
  const vr = shutterCircuits(design, components);
  if (vr.length) S.push({ title: 'Volets roulants', what: 'Commandes montée / descente et moteurs de chaque circuit', n: shutterFolios(vr), draw: (ctx, m, k) => drawShutters(ctx, design, m, vr, k) });
  S.push({ title: 'Mise à la terre', what: 'Prise de terre, barrette, borne principale, PE des circuits, LEP et LES', n: 1, draw: (ctx, m) => drawEarthing(ctx, design, m) });
  if (hasPlan && typeof elevations === 'function') {
    const E = elevations(components, wires);
    S.push({ title: 'Élévations des murs', what: 'Hauteurs de pose de l’appareillage, pièce par pièce', n: elevLayout(E).length, draw: (ctx, m, k) => drawElevations(ctx, design, m, E, k) });
  }
  if (rj && typeof vdiDesign === 'function') {
    const V = vdiDesign(components, wires);
    S.push({ title: 'Communication (VDI)', what: 'Coffret grade 2TV, câblage en étoile catégorie 6', n: vdiFolios(V), draw: (ctx, m, k) => drawVDI(ctx, design, m, V, k) });
  }
  if (typeof materialList === 'function') {
    const L = materialList(components, wires, design);
    S.push({ title: 'Nomenclature du matériel', what: 'Tableau, câbles et conduits, appareillage, communication : quantités', n: nomenclatureFolios(L), draw: (ctx, m, k) => drawNomenclature(ctx, design, m, L, k) });
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
  // Rangées d'un tableau à partir de y0 (le principal, puis chaque tableau divisionnaire)
  const drawRows = (M, y0) => M.rows.forEach((row, r) => {
    const y = y0 + r * pitch;
    box(left - 6, y - 6, BOARD_ROW * mw + 12, 74, '#fbfcfe', '#c4ccd9', 0.4);
    ctx.fillStyle = '#9aa4b2'; ctx.beginPath(); ctx.rect(left - 4, y + 20, BOARD_ROW * mw + 8, 4); ctx.fill(); // rail DIN
    text(`Rangée ${r + 1}`, left - 4, y - 8, { size: 2.8, align: 'left', color: mute });
    let x = left;
    const slots = row.reduce((s, m) => s + m.w, 0);
    for (const m of row) {
      const w = m.w * mw - 0.8;
      const fill = m.kind === 'rcd' || m.kind === 'ddr' ? '#e8f0fd' : m.kind === 'surge' || m.kind === 'shed' ? '#fff4e0' : m.kind === 'contactor' || m.kind === 'teleruptor' ? '#eef7ef' : m.kind === 'switch' || m.feed ? '#f4effb' : '#ffffff';
      box(x + 0.4, y, w, 44, fill, ink, 0.45);
      // manette
      box(x + w / 2 - 2.6 + 0.4, y + 14, 5.2, 12, m.kind === 'rcd' || m.kind === 'ddr' ? blue : '#2b3342', null, 0.2);
      text(m.ref, x + w / 2 + 0.4, y + 6.5, { size: 3, bold: true, color: m.kind === 'rcd' || m.kind === 'ddr' ? blue : ink });
      const sub = m.kind === 'breaker' ? `C${m.In}${m.phase ? ' · ' + (m.phase === '3P' ? '3P+N' : m.phase) : ''}` : m.kind === 'ddr' ? `C${m.In} · 30 mA ${m.ddr}` : m.kind === 'rcd' ? m.text : m.kind === 'surge' ? 'Type 2' : m.kind === 'shed' ? 'Délest.' : m.kind === 'switch' ? `${m.In} A` : m.kind === 'contactor' ? m.tag || 'HC' : 'TL';
      text(sub, x + w / 2 + 0.4, y + 34, { size: 2.8 });
      if (m.kind === 'rcd' || m.kind === 'ddr') { ctx.beginPath(); ctx.arc(x + w - 4, y + 38.5, 1.6, 0, Math.PI * 2); ctx.strokeStyle = ink; ctx.lineWidth = 0.3; ctx.stroke(); text('T', x + w - 4, y + 39.5, { size: 2 }); }
      // étiquette sous l'appareil
      box(x + 0.4, y + 48, w, 14, '#fff', '#c4ccd9', 0.3);
      const fitL = m.kind === 'rcd' ? { lines: [`${m.rcd.sens || 30} mA`, `type ${m.rcd.type}`], size: 2.4 } : m.feed ? _bFitLines('→ ' + m.feed + ' ' + m.text, w - 1.5, 2.4, 1.4) : _bFitLines(m.text, w - 1.5, 2.4, 1.6);
      fitL.lines.forEach((l, i) => text(l, x + w / 2 + 0.4, y + 53.5 + i * (fitL.size + 1.6), { size: fitL.size }));
      x += m.w * mw;
    }
    for (let i = slots; i < BOARD_ROW; i++) {
      ctx.save(); ctx.setLineDash([1, 1]); box(x + 0.4, y, mw - 0.8, 44, null, '#9aa4b2', 0.3); ctx.restore();
      text('libre', x + mw / 2, y + 24, { size: 2.3, color: '#9aa4b2' });
      x += mw;
    }
  });
  drawRows(M, top);
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
  // Tableaux divisionnaires : leur coffret sous le tableau principal (ou sous le coffret de communication)
  let yEnd = V && V.ports ? Hn : top + (M.rows.length - 1) * pitch + 70;
  for (const P of design.panels || []) {
    const MP = boardModules(design, P.id), y0 = yEnd + 18, f = P.feeder;
    ctx.save(); ctx.strokeStyle = '#c4ccd9'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(left - 6, y0 - 8); ctx.lineTo(left + BOARD_ROW * mw + 6, y0 - 8); ctx.stroke(); ctx.restore();
    text(`Tableau divisionnaire ${P.ref} — ${P.name}`, left, y0 + 2, { bold: true, size: 4.4, align: 'left' });
    text(`Coffret ${MP.label} · ${MP.used} modules · réserve ${MP.reservePct} % — alimenté par ${f.id} (C${f.In}, ${boardCable(f.S, f.phase)}, ${_bNum(f.length, 1)} m)`, left, y0 + 8.5, { size: 3, align: 'left', color: mute });
    drawRows(MP, y0 + 24);
    Hn = y0 + 24 + MP.rows.length * pitch + 4;
    yEnd = y0 + 24 + (MP.rows.length - 1) * pitch + 70;
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
// Folios de câblage : quatre rangées par folio, tableau principal puis chaque divisionnaire
function _wiringPages(design) {
  const out = [];
  for (const P of boardPanels(design)) {
    const n = Math.max(1, Math.ceil(boardModules(design, P.id).rows.filter((r) => r.some((m) => m.kind !== 'switch')).length / 4));
    for (let k = 0; k < n; k++) out.push({ P, k });
  }
  return out;
}
function boardWiringFolios(design) { return _wiringPages(design).length; }
function drawBoardWiring(ctx, design, meta, folio) {
  const pages = _wiringPages(design), pg = pages[folio || 0] || pages[0], P = pg.P, f = P.feeder;
  // l'interrupteur-sectionneur de tête d'un TD est dessiné dans le cadre d'arrivée
  const M = boardModules(design, P.id), rows = M.rows.map((r, i) => ({ r: r.filter((m) => m.kind !== 'switch'), i })).filter((x) => x.r.length);
  const k = pg.k, mine = rows.slice(k * 4, k * 4 + 4);
  const tri = design.supply && design.supply.phases === 3 && (!f || f.phase === '3P');
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
  const isHead = (m) => m.kind === 'rcd' || m.kind === 'ddr' || m.kind === 'shed' || (m.kind === 'breaker' && (m.ref === 'QF' || m.feed)); // le délesteur est alimenté en tête
  const isOut = (m) => (m.kind === 'breaker' || m.kind === 'ddr') && m.ct; // départ d'un circuit
  // bornes d'un appareil : [nom du conducteur, x] — 4 pôles sur un appareil 4P, sinon phase + neutre
  const terms = (p) => {
    const four = tri && (p.m.kind === 'rcd' || p.m.kind === 'surge' || p.m.w >= 4 || (p.m.kind === 'breaker' && p.m.ref === 'QF'));
    if (four) return COND.map(([n], i) => [n, p.x + p.w * ((i + 0.5) / nC)]);
    const ph = tri ? (p.m.ct && ['L1', 'L2', 'L3'].includes(p.m.ct.phase) ? p.m.ct.phase : 'L1') : 'L';
    return [[ph, p.x + p.w * 0.3], ['N', p.x + p.w * 0.7]];
  };
  const one = mine.length <= 2, sc = one ? 1.45 : 1;
  const S = f ? f.S : boardLinkSection(design.agcp.setting), mw = BW.mw * sc, gapW = BW.gap * sc, rowH = one ? 290 : BW.rowH;
  ctx.save(); ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, f ? `Câblage du tableau divisionnaire ${P.ref}` : 'Câblage du tableau de répartition', folio || 0, pages.length);
  layer('TEXTES');
  text(f ? `Câblage du tableau divisionnaire ${P.ref}` : 'Câblage du tableau', 30, 46, { bold: true, size: 17 });
  text(f ? `${P.name} — arrivée ${boardCable(f.S, f.phase)} depuis ${f.id} sur l’interrupteur-sectionneur QS, puis en tête de chaque interrupteur différentiel, peignes ${tri ? 'L1 / L2 / L3 / N' : 'phase / neutre'}, départs, bornier de terre`
    : `Arrivée du disjoncteur de branchement en tête de chaque interrupteur différentiel (conducteurs de ${S} mm²), peignes ${tri ? 'L1 / L2 / L3 / N' : 'phase / neutre'}, départs des circuits, bornier de terre`, 30, 62, { size: 8, color: mute });
  const leg = (tri ? [['L1 (marron)', col('L1')], ['L2 (noir)', col('L2')], ['L3 (gris)', col('L3')]] : [['Phase', col('L')]]).concat([['Neutre (bleu)', N], ['Terre (vert / jaune)', PE]]);
  leg.forEach(([t, c], i) => { const x = UNI.W - 30 - (leg.length - i) * 112; layer('SCHEMA'); wire(c, [[x, 42], [x + 20, 42]], 2); layer('TEXTES'); text(t, x + 25, 45, { size: 8 }); });
  // Disjoncteur de branchement (AGCP) et colonne de distribution vers les têtes de groupe
  const ax = 30, ay = 84;
  layer('SCHEMA'); ctx.lineWidth = 1.2; ctx.strokeRect(ax, ay, 122, 44);
  layer('TEXTES');
  if (f) {
    text(`QS — tête ${P.ref}`, ax + 8, ay + 14, { bold: true, size: 8.5 });
    text(`${tri ? '4P' : '2P'} ${boardSubSwitch(f.In)} A · inter-sectionneur`, ax + 8, ay + 26, { size: 8 });
    text(`depuis ${f.id} C${f.In} · ${boardCable(f.S, f.phase)}`, ax + 8, ay + 37, { size: 7, color: mute });
  } else {
    text('AGCP (GTL)', ax + 8, ay + 14, { bold: true, size: 8.5 });
    text(`${tri ? '4P' : '2P'} ${design.agcp.setting} A · 500 mA`, ax + 8, ay + 26, { size: 8 });
    text(`${design.agcp.kva} kVA — gestionnaire de réseau`, ax + 8, ay + 37, { size: 7, color: mute });
  }
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
      if (cl !== 0) { layer('TEXTES'); text(`depuis ${f ? 'QS' : 'l’AGCP'}, ${S} mm²`, ht[ht.length - 1][1] + 4, y0 - 10, { size: 6.5, color: mute }); layer('SCHEMA'); }
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
    const circ = pos.filter((p) => isOut(p.m));
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
      text(m.ref, p.x + p.w / 2, yb + 15 * sc, { bold: true, size: fs(7), align: 'center', color: m.kind === 'rcd' || m.kind === 'ddr' ? N : ink });
      const sub = m.kind === 'breaker' || m.kind === 'ddr' ? `C${m.In}` : m.kind === 'rcd' ? `${m.rcd.In} A` : m.kind === 'surge' ? 'type 2' : m.kind === 'shed' ? 'délest.' : m.kind === 'contactor' ? m.tag || 'HC' : 'TL';
      text(sub, p.x + p.w / 2, yb + 27 * sc, { size: fs(6.5), align: 'center' });
      if (m.kind === 'rcd') text(`30 mA ${m.rcd.type}`, p.x + p.w / 2, yb + 39 * sc, { size: fs(6), align: 'center', color: mute });
      else if (m.kind === 'ddr') text(`30 mA ${m.ddr}${tri ? ' · ' + (m.ct.phase === '3P' ? '3P+N' : tt[0][0]) : ''}`, p.x + p.w / 2, yb + 39 * sc, { size: fs(6), align: 'center', color: mute });
      else if (tri && m.kind === 'breaker' && m.ct) text(m.ct.phase === '3P' ? '3P+N' : tt[0][0], p.x + p.w / 2, yb + 39 * sc, { size: fs(6), align: 'center', color: mute });
      if (isOut(m)) {
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
        const nm = (m.feed ? '→ ' + m.feed + ' ' : '') + m.ct.name;
        text(nm.length > 20 ? nm.slice(0, 19) + '…' : nm, tP - 5.5 * sc, yo + 5, { size: fs(6), rot: Math.PI / 2, color: mute });
      } else if (m.kind === 'contactor' || m.kind === 'teleruptor') {
        layer('TEXTES');
        text(m.kind === 'contactor' ? (m.tag === 'IH' ? 'horloge' : 'cde HC') : 'bobine', p.x + p.w / 2, yb + 39 * sc, { size: fs(5.5), align: 'center', color: mute });
      } else if (m.kind === 'surge') {
        layer('SCHEMA'); wire(PE, [[p.x + p.w / 2, yB], [p.x + p.w / 2, yt]], 1.1);
      }
    }
  });
  layer('TEXTES');
  const yb2 = UNI.H - 15 - 62 - 28;
  text(f ? `Bornier de terre du ${P.ref} relié à la borne principale de terre par le conducteur de protection de la ligne (${_bS(f.S)} mm²) ; liaison QS → têtes de groupe en ${S} mm² ; peignes adaptés au calibre des différentiels.`
    : `Bornier de terre relié à la barrette de coupure puis au piquet (conducteur de terre 16 mm² cuivre) ; liaison AGCP → têtes de groupe en ${S} mm² (${tri ? 'trois phases et neutre' : 'phase et neutre'}) ; peignes adaptés au calibre des différentiels.`, 30, yb2 - 13, { size: 8, color: mute });
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

// Étiquettes de repérage à imprimer à l'échelle 1 (A4 paysage) et à découper :
// une rangée de 13 modules (234 mm) par bande, six bandes par feuille, les TD à la suite
const LABEL_ROWS = 6;
function _labelRows(design) {
  const panels = boardPanels(design).map((P) => ({ P, M: boardModules(design, P.id) }));
  const multi = panels.length > 1, list = [];
  for (const { P, M } of panels) M.rows.forEach((row, r) => list.push({ row, title: (multi ? (P.id ? P.ref + ' · ' : 'Principal · ') : '') + `Rangée ${r + 1}` }));
  return list;
}
function boardLabelsPages(design) { return Math.max(1, Math.ceil(_labelRows(design).length / LABEL_ROWS)); }
function boardLabelsSVGs(design, meta) { const out = []; for (let k = 0; k < boardLabelsPages(design); k++) out.push(boardLabelsSVG(design, meta, k)); return out; }
function boardLabelsSVG(design, meta, page) {
  const all = _labelRows(design), nP = Math.max(1, Math.ceil(all.length / LABEL_ROWS)), k = Math.min(page || 0, nP - 1);
  const list = all.slice(k * LABEL_ROWS, (k + 1) * LABEL_ROWS);
  const mw = 18, left = 20, W = 297, pitchY = 26, H = 210;
  const ctx = new SVGContext();
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || '#1a2230'; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 3}px sans-serif`;
    ctx.textAlign = o.align || 'center'; ctx.fillText(t, x, y); ctx.restore();
  };
  text('Étiquettes du tableau — ' + ((meta && meta.title) || 'installation') + (nP > 1 ? ` (feuille ${k + 1} / ${nP})` : ''), left, 18, { bold: true, size: 5, align: 'left' });
  text('À imprimer à 100 % (sans « ajuster à la page ») : un module = 18 mm. Découper le long des pointillés.', left, 25, { size: 3, align: 'left', color: '#5b6b82' });
  list.forEach(({ row, title }, r) => {
    const y = 36 + r * pitchY;
    text(title, left, y - 2, { size: 2.6, align: 'left', color: '#5b6b82' });
    ctx.save(); ctx.setLineDash([1.2, 1]); ctx.strokeStyle = '#5b6b82'; ctx.lineWidth = 0.25;
    ctx.strokeRect(left, y, BOARD_ROW * mw, 14);
    ctx.restore();
    let x = left;
    for (const m of row) {
      const w = m.w * mw;
      ctx.strokeStyle = '#1a2230'; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 14); ctx.stroke();
      text(m.ref, x + w / 2, y + 4.5, { bold: true, size: 3 });
      const label = m.kind === 'rcd' ? `${m.rcd.In} A ${m.rcd.sens || 30} mA type ${m.rcd.type}` : m.kind === 'switch' ? `Coupure générale ${m.In} A` : m.feed ? `→ ${m.feed} ${m.text}` : m.kind === 'ddr' ? `${m.text} · 30 mA ${m.ddr}` : m.text;
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
  const loadType = (c) => (c.kind === 'pv' ? 'inverter' : c.kind === 'light' ? 'lamp' : c.kind === 'socket' ? 'socket' : ['vmc', 'hvac'].includes(c.appliance) || /pompe|clim|vmc/i.test(c.name) ? 'motor' : 'resistor_iec');
  const cut = (t) => (t.length > 20 ? t.slice(0, 19) + '…' : t);
  const feeds = []; // départs vers les TD : [{ c, x }]
  // Groupes d'un tableau (ID + disjoncteurs + récepteurs) à partir de x ; renvoie l'abscisse du dernier départ
  const drawGroups = (V, x) => {
    const groups = [];
    const fd = V.circuits.filter((c) => c.kind === 'sub' && !V.rcds.some((r) => r.id === c.rcd));
    if (fd.length) groups.push({ r: null, cs: fd, feed: true });
    // disjoncteurs différentiels : en tête, sous l'AGCP (symbole « ddr » à la place du disjoncteur)
    const dd = V.circuits.filter((c) => c.ddr && !V.rcds.some((r) => r.id === c.rcd));
    if (dd.length) groups.push({ r: null, cs: dd, ddr: true });
    groups.push(...V.rcds.map((r) => ({ r, cs: V.circuits.filter((c) => c.rcd === r.id) })).filter((g) => g.cs.length));
    const loose = V.circuits.filter((c) => c.kind !== 'sub' && !c.ddr && !V.rcds.some((r) => r.id === c.rcd));
    if (loose.length) groups.push({ r: null, cs: loose });
    let xEnd = x;
    for (const g of groups) {
      const xs = g.cs.map((c, i) => x + 20 + i * COL);
      const xc = Math.round((xs[0] + xs[xs.length - 1]) / 2 / 20) * 20;
      if (g.r) { put('rcd', xc, 440, g.r.id, `${g.r.In} A ${g.r.type}`, { closed: true }); wire(xc, BUS, xc, 400); wire(xc, 480, xc, SUB); }
      else wire(xc, BUS, xc, SUB);
      if (xs.length > 1) wire(xs[0], SUB, xs[xs.length - 1], SUB);
      g.cs.forEach((c, i) => {
        const cx = xs[i];
        put(c.ddr ? 'ddr' : 'breaker', cx, 640, c.id, `${c.curve || 'C'}${c.In}${c.ddr ? ' 30 mA ' + c.ddr : ''}${tri && c.phase ? ' ' + (c.phase === '3P' ? '3P+N' : c.phase) : ''}`, { closed: true });
        wire(cx, SUB, cx, 600);
        if (c.kind === 'sub') { feeds.push({ c, x: cx }); return; }
        let y = 680;
        if (c.contactor || c.teleruptor) {
          put(c.contactor === 'ih' ? 'timer_switch' : c.contactor ? 'contactor' : 'teleruptor', cx, 760, c.contactor ? (c.contactor === 'ih' ? 'IH' : 'KM') : 'KL', c.contactor ? (c.contactor === 'ih' ? 'horaire' : 'HC') : '', c.contactor === 'ih' ? { closed: true } : undefined);
          wire(cx, 680, cx, 720); y = 800;
        }
        put(loadType(c), cx, y + 120, '', cut(c.name));
        wire(cx, y, cx, y + 80);
      });
      x = xs[xs.length - 1] + 100;
      xEnd = Math.max(xEnd, xs[xs.length - 1]);
    }
    return xEnd;
  };
  const xEnd = drawGroups(boardPanelView(design, null), x);
  wire(X0, BUS, xEnd, BUS); // jeu de barres
  // Tableaux divisionnaires, à droite : ligne du départ sous les récepteurs, interrupteur-sectionneur, jeu de barres
  let xt = xEnd + 200;
  (design.panels || []).forEach((P, i) => {
    const fd = feeds.find((q) => q.c.id === P.id);
    const yL = 1080 + i * 40, xr = xt - 60;
    if (fd) wires.push({ id: id(), points: [{ x: fd.x, y: 680 }, { x: fd.x, y: yL }, { x: xr, y: yL }, { x: xr, y: 160 }, { x: xt, y: 160 }, { x: xt, y: 200 }] });
    put('isolator', xt, 240, 'QS', `${P.ref} ${boardSubSwitch(P.feeder.In)} A`, { closed: true });
    wire(xt, 280, xt, BUS);
    const xe = drawGroups(boardPanelView(design, P.id), xt);
    wire(xt, BUS, Math.max(xe, xt + 40), BUS);
    xt = Math.max(xe, xt + 40) + 220;
  });
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
