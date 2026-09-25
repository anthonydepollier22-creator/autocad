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

// Câble U1000 R2V : « 3G2,5 » (phase, neutre, terre)
function boardCable(S) { return '3G' + _bS(S); }

// ---------------------------------------------------------------------------
// Tableau personnalisé ← conception automatique (copie modifiable)
// ---------------------------------------------------------------------------
function boardFromDesign(design) {
  return {
    v: 1,
    supply: { kva: design.agcp ? design.agcp.kva : 9, phases: 1, surge: !!(design.supply && design.supply.surge), area: Math.round(design.area || 0) },
    rcds: design.rcds.map((r) => ({ id: r.id, In: r.In, type: r.type, sens: r.sens || 30 })),
    circuits: design.circuits.map((c) => ({
      id: c.id, name: c.name, kind: c.kind, In: c.In, S: c.S, curve: c.curve || 'C', rcd: c.rcd,
      devices: (c.devices || []).slice(), points: c.points, length: Math.round((c.length || 0) * 10) / 10,
      P: Math.round(c.power || 0), appliance: c.appliance || null, typeA: !!c.typeA, typeF: !!c.typeF,
      contactor: c.contactor || (c.appliance === 'water_heater' ? 'hc' : null), teleruptor: !!c.teleruptor,
    })),
  };
}

// Tableau sans plan : circuits usuels d'un logement de la surface donnée
function boardTemplate(area, opts) {
  opts = Object.assign({ heating: true, cooktop: true, ev: false }, opts || {});
  const A = Math.max(10, +area || 60);
  const b = { v: 1, supply: { kva: null, phases: 1, surge: false, area: A }, rcds: [], circuits: [] }; // abonnement : d'après la puissance probable
  const nAC = A <= 35 ? 1 : A <= 100 ? 2 : 3;
  for (let i = 0; i < nAC; i++) b.rcds.push({ id: 'ID' + (i + 1), In: A <= 35 ? 25 : 40, type: 'AC', sens: 30 });
  b.rcds.push({ id: 'ID' + (nAC + 1), In: 40, type: 'A', sens: 30 });
  const add = (key, over) => boardAddCircuit(b, key, over);
  const lights = Math.max(1, Math.ceil(A / 45)), sockets = Math.max(1, Math.ceil(A / 30));
  for (let i = 0; i < lights; i++) add('light', { name: 'Éclairage' + (lights > 1 ? ' ' + (i + 1) : '') });
  for (let i = 0; i < sockets; i++) add('socket', { name: 'Prises' + (sockets > 1 ? ' ' + (i + 1) : '') });
  add('kitchen');
  if (opts.cooktop) add('cooktop');
  add('oven'); add('washer'); add('dishwasher'); add('water_heater'); add('vmc');
  if (opts.heating) { const n = Math.max(1, Math.ceil((A * 80) / 4500)); for (let i = 0; i < n; i++) add('heating', { name: 'Chauffage' + (n > 1 ? ' ' + (i + 1) : ''), P: Math.round((A * 80) / n / 250) * 250 }); }
  if (opts.ev) add('ev');
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
    typeA: !!pr.typeA, typeF: !!pr.typeF, contactor: pr.contactor || null, teleruptor: false, ...(over || {}),
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
    if (c.appliance === 'cooktop' && (c.In < 32 || c.S < 6)) push('err', `${c.id} Plaque de cuisson : 32 A et 6 mm² en monophasé.`, c.id);
    if (['oven', 'washer', 'dishwasher', 'dryer', 'water_heater'].includes(c.appliance) && (c.In < 16 || c.S < 2.5)) push('err', `${c.id} ${c.name} : circuit spécialisé 20 A en 2,5 mm².`, c.id);
    const rc = rcds.find((r) => r.id === c.rcd);
    if (rc && c.typeA && !['A', 'F', 'B'].includes(rc.type)) push('err', `${c.id} ${c.name} : sous ${rc.id} type ${rc.type} — il faut un différentiel type A (ou F).`, c.id);
    if (rc && c.typeF && !['F', 'B'].includes(rc.type)) push('warn', `${c.id} ${c.name} : borne de recharge sous ${rc.id} type ${rc.type} — type F (ou A-EV, ou B) conseillé.`, c.id);
    if (c.ok === false) push('warn', `${c.id} ${c.name} : chute de tension ${_bNum(c.dUpct, 1)} % > ${c.limit} %.`, c.id);
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
const BOARD_ROW = 13;
function boardModules(design) {
  const items = [];
  if (design.supply && design.supply.surge) {
    items.push({ kind: 'breaker', w: 1, ref: 'QF', text: 'Disj. parafoudre', In: 10 });
    items.push({ kind: 'surge', w: 2, ref: 'PF', text: 'Parafoudre' });
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
    if (g.r) mods.push({ kind: 'rcd', w: 2, ref: g.r.id, text: `${g.r.In} A ${g.r.type}`, rcd: g.r });
    for (const c of g.cs) {
      mods.push({ kind: 'breaker', w: 1, ref: c.id, text: c.name, In: c.In, ct: c });
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
const UNI = { W: 1190, H: 842, colW: 34, gap: 14, bus: 232, sub: 356, text: 648, table: 656, row: 13.5 };

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
  ctx.lineWidth = 1.6; ctx.strokeRect(15, 15, W - 30, H - 30);
  const cy = H - 15 - 62;
  ctx.lineWidth = 1.2; ctx.strokeRect(15, cy, W - 30, 62);
  for (const cx of [430, 700, 900, 1060]) _uLine(ctx, cx, cy, cx, H - 15, 1);
  const title = (meta && meta.title) || 'Installation électrique';
  text(fit(title, 52), 26, cy + 24, { bold: true, size: 14 });
  text('Schéma unifilaire du tableau de répartition', 26, cy + 42, { size: 9.5 });
  text('Dessiné avec ÉlectriCAD', 26, cy + 55, { size: 7.5, color: mute });
  const d0 = design.agcp;
  text(`Monophasé 230 V ~ · abonnement ${d0.kva} kVA`, 440, cy + 22, { size: 9 });
  text(`AGCP ${d0.setting} A 500 mA · ${design.rcds.length} ID 30 mA · ${design.circuits.length} circuits`, 440, cy + 37, { size: 9 });
  text(`${_bNum(design.cableTotal)} m de câble · puissance probable ${f1(design.probable / 1000)} kW`, 440, cy + 52, { size: 8, color: mute });
  const date = (meta && meta.date) || new Date().toISOString().slice(0, 10);
  text('Date', 710, cy + 20, { size: 7.5, color: mute }); text(date, 710, cy + 33, { size: 9.5 });
  text('Auteur', 710, cy + 46, { size: 7.5, color: mute }); text(fit((meta && meta.author) || '—', 26), 710, cy + 57, { size: 9 });
  text('Norme', 910, cy + 20, { size: 7.5, color: mute }); text('NF C 15-100', 910, cy + 34, { size: 10, bold: true });
  text('contrôle simplifié — à faire valider', 910, cy + 48, { size: 7, color: mute }); text('par un professionnel (Consuel)', 910, cy + 57, { size: 7, color: mute });
  text('Folio', 1070, cy + 20, { size: 7.5, color: mute }); text(`${k + 1} / ${nF}`, 1117, cy + 48, { size: 22, bold: true, align: 'center' });

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
    text('Réseau public', sx, 34, { align: 'center', size: 8, color: mute }); text('230 V ~ 50 Hz', sx, 44, { align: 'center', size: 8, color: mute });
    _uLine(ctx, sx, 50, sx, 68, 2);
    ctx.lineWidth = 1.4; ctx.strokeRect(sx - 17, 68, 34, 24);
    text('kWh', sx, 84, { align: 'center', size: 8.5, bold: true });
    text('Compteur', sx + 24, 78, { size: 8 }); text('communicant', sx + 24, 88, { size: 7.5, color: mute });
    _uLine(ctx, sx, 92, sx, 112, 2);
    _uBreaker(ctx, sx, 112, 56); _uTorus(ctx, sx, 112 + 44, 112 + 32);
    text('AGCP', sx + 24, 128, { bold: true, size: 9 });
    text(`2P ${d0.setting} A`, sx + 24, 139, { size: 8 }); text('500 mA sélectif', sx + 24, 149, { size: 8 });
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
      text(`${g.r.In} A`, tx, bus + 45, { size: 8 }); text(`${g.r.sens || 30} mA`, tx, bus + 55, { size: 8 });
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
      layer('UNIFILAIRE');
      let y = sub + 64;
      if (c.contactor || c.teleruptor) { _uContactor(ctx, x, y + 4, 38, c.contactor ? (c.contactor === 'hc' ? 'HC' : 'KM') : 'TL'); _uLine(ctx, x, y, x, y + 4, 1.3); y += 42; }
      else { _uLine(ctx, x, y, x, y + 42, 1.3); y += 42; }
      _uLine(ctx, x, y, x, y + 10, 1.3); _uArrow(ctx, x, y + 10);
      layer('TEXTES');
      const detail = `${boardCable(c.S)} · ${f1(c.length)} m` + (c.rooms ? ' · ' + c.rooms : '');
      text(fit(c.name, 30), x - 2, UNI.text, { rot: -Math.PI / 2, bold: true, size: 8.5 });
      text(fit(detail, 40), x + 8, UNI.text, { rot: -Math.PI / 2, size: 7, color: mute });
    });
  }

  // Nomenclature des départs
  layer('CARTOUCHE');
  const rowsT = [['Repère', (c) => c.id], ['Protection', (c) => `${c.curve || 'C'}${c.In} A`], ['Différentiel', (c) => c.rcd || '—'], ['Câble', (c) => boardCable(c.S)],
    ['Longueur', (c) => f1(c.length) + ' m'], ['Charge', (c) => (c.kind === 'light' ? c.points + ' pts' : c.kind === 'socket' ? c.points + ' PC' : c.power >= 1000 ? f1(c.power / 1000) + ' kW' : Math.round(c.power) + ' W')],
    ['ΔU', (c) => f1(c.dUpct) + ' %']];
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
      const sub = m.kind === 'breaker' ? `C${m.In}` : m.kind === 'rcd' ? m.text : m.kind === 'surge' ? 'Type 2' : m.kind === 'contactor' ? 'HC' : 'TL';
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
  ctx.restore();
  return { W, H: top + M.rows.length * pitch + 4 };
}
function boardFrontSVG(design, meta) {
  const ctx = new SVGContext();
  const { W, H } = drawBoardFront(ctx, design, meta);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${ctx.out.join('')}</svg>`;
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
