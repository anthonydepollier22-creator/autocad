/*
 * day.js — « Journée type » : 24 heures de vie d'une maison.
 *
 * Un emploi du temps réaliste (réveil, départ au travail, retour, dîner,
 * coucher) décide, heure par heure, quelles pièces sont éclairées (quand il
 * fait nuit), quels appareils tournent (plaque, four, lessive, vaisselle,
 * télévision, ordinateur), quand les radiateurs chauffent (en hiver) et
 * quand le chauffe-eau et la borne profitent des heures creuses. La
 * simulation physique (install.js) fait le reste : puissance, énergie,
 * déclenchements éventuels.
 */

const DAY_SEASONS = {
  hiver: { label: 'Hiver', night: [8, 17.5], heating: true },
  ete: { label: 'Été', night: [6.5, 21.75], heating: false },
};

// Catégories d'usage, dans l'ordre fixe de la palette du graphique
const DAY_CATS = [
  { key: 'heat', name: 'Chauffage' },
  { key: 'appl', name: 'Cuisson et lavage' },
  { key: 'water', name: 'Eau chaude' },
  { key: 'light', name: 'Éclairage' },
  { key: 'other', name: 'Froid, VMC, multimédia' },
  { key: 'ev', name: 'Recharge du véhicule' },
];

const HC = [22, 6];          // heures creuses : 22 h → 6 h
const TARIF_HP = 0.2700;      // € TTC le kWh, option heures creuses (indicatif)
const TARIF_HC = 0.2068;

// Plages horaires [début, fin[ en heures décimales ; une plage peut passer minuit
const inRange = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);
const inAny = (h, ranges) => ranges.some(([a, b]) => inRange(h, a, b));
const isHC = (h) => inRange(h, HC[0], HC[1]);

// Présence (lumière allumée s'il fait nuit) selon le type de pièce
const DAY_ROOMS = {
  cuisine: [[6.5, 7.5], [18.5, 20.5]],
  sejour: [[7, 8], [17.5, 23]],
  circ: [[6.5, 6.75], [8, 8.25], [17.25, 17.5], [22.75, 23.25]],
  chambre: [[6.5, 7], [22, 23]],
  sdb: [[6.75, 7.5], [21.5, 22.25]],
  wc: [[7.25, 7.5], [22.5, 22.75]],
  bureau: [[17.5, 19]],
  annexe: [[17.25, 17.5], [21, 21.25]],
  garage: [[8, 8.25], [17.25, 17.5]],
};
// Appareils : plages de fonctionnement
const DAY_APPLIANCES = {
  cooktop: [[7, 7.25], [19, 19.75]],
  oven: [[19, 19.75]],
  washer: [[21, 22.5]],
  dryer: [[22.5, 23.75]],
  dishwasher: [[22, 23.5]],
  water_heater: [[22.5, 1]],        // heures creuses, le temps de réchauffer le ballon
  ev_charger: [[0, 1]],             // 7,4 kWh ≈ 40 km par jour, rechargés la nuit
  tv_unit: [[20, 22.75]],
  desk: [[17.5, 19]],
};
// Radiateurs (hiver) : confort le matin et le soir, réduit la nuit et en journée
const DAY_HEAT = {
  sejour: [[6, 8.25], [17, 22.5]],
  cuisine: [[6, 8], [17.5, 21]],
  bureau: [[17, 19.5]],
  sdb: [[6, 7.75], [21, 22.5]],
  chambre: [[6, 7], [21.5, 23]],
  circ: [],
};

// Production photovoltaïque (W) d'une installation de kwc kWc à l'heure h :
// cloche entre lever et coucher du soleil, ~1,5 kWh/kWc un jour d'hiver dégagé,
// ~6,5 kWh/kWc en été (France, orientation sud, pertes comprises)
const PV_SUN = { hiver: [8.4, 17.1, 0.31], ete: [6.2, 21.8, 0.75] };
// Pilotage solaire : les appareils programmables tournent quand le soleil produit
const DAY_SOLAR_SHIFT = {
  water_heater: [[11.5, 14]],
  washer: [[12, 13.5]],
  dishwasher: [[13.5, 15]],
  dryer: [[14, 15.25]],
};
function pvPower(kwc, h, season) {
  if (!kwc) return 0;
  const [rise, set, peak] = PV_SUN[season] || PV_SUN.hiver;
  if (h <= rise || h >= set) return 0;
  return kwc * 1000 * peak * Math.pow(Math.sin((Math.PI * (h - rise)) / (set - rise)), 1.5);
}

function dayCategory(type) {
  if (type === 'radiator') return 'heat';
  if (type === 'water_heater') return 'water';
  if (type === 'ev_charger') return 'ev';
  if (type === 'cooktop' || type === 'oven' || type === 'washer' || type === 'dishwasher' || type === 'dryer') return 'appl';
  if (LOADS[type] && LOADS[type].cls === 'light') return 'light';
  return 'other';
}

// Contexte de la maison : pièce de chaque commande, lampe et radiateur
function dayContext(components, wires) {
  const info = computeRooms(components, wires);
  const typeOf = (i) => (i >= 0 && info.rooms[i] && info.rooms[i].type ? info.rooms[i].type.key : null);
  const roomOf = (c) => {
    if (c.ctrl) { const i = info.rooms.findIndex((r) => r.id === c.ctrl); if (i >= 0) return i; }
    return roomAt(info, c.x, c.y);
  };
  const switches = {}, lights = {};
  for (const c of components) {
    if (c.type === 'switch_sa' || c.type === 'switch_vv_wall') (switches[roomOf(c)] = switches[roomOf(c)] || []).push(c);
    else if (LOADS[c.type] && LOADS[c.type].cls === 'light') (lights[roomAt(info, c.x, c.y)] = lights[roomAt(info, c.x, c.y)] || []).push(c);
  }
  return { info, typeOf, roomOf, switches, lights };
}

// Applique l'emploi du temps de l'heure h (0 → 24) aux composants
function dayApply(components, ctx, h, season, solarShift) {
  const S = DAY_SEASONS[season] || DAY_SEASONS.hiver;
  const dark = h < S.night[0] || h >= S.night[1];
  // Éclairage : une commande fermée par pièce occupée (va-et-vient : parité)
  const rooms = new Set([...Object.keys(ctx.switches), ...Object.keys(ctx.lights)].map(Number));
  for (const i of rooms) {
    const key = ctx.typeOf(i);
    const want = dark && !!key && inAny(h, DAY_ROOMS[key] || []);
    const sws = ctx.switches[i];
    if (sws && sws.length) sws.forEach((c, k) => { c.closed = k === 0 ? want : false; });
    else (ctx.lights[i] || []).forEach((c) => { c.on = want; });
  }
  for (const c of components) {
    if (solarShift && DAY_SOLAR_SHIFT[c.type]) c.on = inAny(h, DAY_SOLAR_SHIFT[c.type]);
    else if (DAY_APPLIANCES[c.type]) c.on = inAny(h, DAY_APPLIANCES[c.type]);
    else if (c.type === 'radiator') {
      const key = ctx.typeOf(roomAt(ctx.info, c.x, c.y));
      c.on = S.heating && !!key && inAny(h, DAY_HEAT[key] || [[6, 8], [17.5, 22]]);
    } else if (c.type === 'socket_wall') c.on = false; // pas de radiateur d'appoint
  }
}

// États modifiés par la journée (pour les restaurer ensuite)
function daySnapshotStates(components) {
  return components.map((c) => [c, c.on, c.closed]);
}
function dayRestoreStates(saved) {
  for (const [c, on, closed] of saved) { c.on = on; c.closed = closed; }
}

// Accumulateur : énergie par heure et par catégorie, pointe, heures creuses
function dayAccumulator() {
  return {
    bins: Array.from({ length: 24 }, () => ({ heat: 0, appl: 0, water: 0, light: 0, other: 0, ev: 0, pv: 0 })),
    total: 0, hc: 0, peak: { P: 0, h: 0 }, trips: 0, pv: 0, self: 0,
  };
}
// Part du temps où la résistance chauffe vraiment pendant la plage de marche :
// la puissance appelée (pointe, disjoncteurs) reste la puissance nominale,
// l'énergie consommée tient compte des thermostats et des cycles
// (lave-linge ≈ 1,3 kWh par cycle, lave-vaisselle ≈ 1,5 kWh, four ≈ 1 kWh…)
const DAY_DUTY = { radiator: 0.65, washer: 0.4, dishwasher: 0.5, dryer: 0.7, oven: 0.55, cooktop: 0.5 };

function dayAccumulate(acc, snap, components, h, dh, kwc, season) {
  const cat = {};
  let Pnow = 0;
  for (const c of components) {
    const dv = snap.devices[c.id];
    if (!dv || !dv.P) continue;
    const k = dayCategory(c.type);
    cat[k] = (cat[k] || 0) + dv.P * (DAY_DUTY[c.type] || 1);
    Pnow += dv.P;
  }
  const bin = acc.bins[Math.min(23, Math.floor(h))];
  let P = 0; // puissance moyenne (énergie)
  for (const k in cat) { bin[k] += (cat[k] * dh) / 1000; P += cat[k]; }
  acc.total += (P * dh) / 1000;
  if (isHC(h)) acc.hc += (P * dh) / 1000;
  if (Pnow > acc.peak.P) acc.peak = { P: Pnow, h };
  // Solaire : production, et part consommée sur place (autoconsommation)
  const Ppv = pvPower(kwc, h, season);
  if (Ppv > 0) {
    bin.pv += (Ppv * dh) / 1000;
    acc.pv += (Ppv * dh) / 1000;
    acc.self += (Math.min(P, Ppv) * dh) / 1000;
  }
}
function dayCost(acc) {
  return {
    base: acc.total * TARIF_KWH,
    hphc: acc.hc * TARIF_HC + (acc.total - acc.hc) * TARIF_HP,
    // l'énergie solaire consommée sur place n'est pas achetée (heures pleines)
    saving: (acc.self || 0) * TARIF_HP,
  };
}

// Bilan annuel indicatif à partir des deux journées types : 212 jours « hiver »
// (octobre → avril, chauffage) et 153 jours « été » (mai → septembre)
const YEAR_DAYS = { hiver: 212, ete: 153 };
// Abonnement annuel TTC (tarif réglementé 2026, indicatif) selon la puissance souscrite
const ABO_BASE = { 3: 118, 6: 158, 9: 198, 12: 238, 15: 274, 18: 313, 24: 390, 30: 462, 36: 530 };
const ABO_HPHC = { 6: 164, 9: 212, 12: 253, 15: 292, 18: 331, 24: 424, 30: 499, 36: 569 };
const aboOf = (table, kva) => {
  const k = Object.keys(table).map(Number).sort((a, b) => a - b).find((v) => v >= kva);
  return table[k === undefined ? 36 : k];
};
function simulateYear(components, wires, design, stepMin, kwc, solarShift) {
  const w = simulateDay(components, wires, design, 'hiver', stepMin, kwc, solarShift);
  const s = simulateDay(components, wires, design, 'ete', stepMin, kwc, solarShift);
  const Y = YEAR_DAYS, sum = (k) => w[k] * Y.hiver + s[k] * Y.ete;
  const acc = { total: sum('total'), hc: sum('hc'), pv: sum('pv'), self: sum('self') };
  const cats = {};
  for (const c of DAY_CATS) cats[c.key] = w.bins.reduce((t, b) => t + b[c.key], 0) * Y.hiver + s.bins.reduce((t, b) => t + b[c.key], 0) * Y.ete;
  const kva = design && design.agcp ? design.agcp.kva : 9;
  const e = dayCost(acc), aboB = aboOf(ABO_BASE, kva), aboH = aboOf(ABO_HPHC, Math.max(6, kva));
  return {
    ...acc, cats, days: Y, kva, winter: w, summer: s,
    peak: Math.max(w.peak.P, s.peak.P),
    cost: { base: e.base + aboB, hphc: e.hphc + aboH, aboBase: aboB, aboHphc: aboH, energyBase: e.base, energyHphc: e.hphc, saving: e.saving },
    surplus: Math.max(0, acc.pv - acc.self),
  };
}

// Journée complète, d'un coup (pas de 2 min) — composants restaurés à la fin
function simulateDay(components, wires, design, season, stepMin, kwc, solarShift) {
  const step = (stepMin || 2) / 60;
  const saved = daySnapshotStates(components);
  const ctx = dayContext(components, wires);
  const sim = new InstallSim();
  sim.setDesign(design);
  const acc = dayAccumulator();
  for (let h = 0; h < 24 - 1e-9; h += step) {
    dayApply(components, ctx, h, season, solarShift && kwc > 0);
    const snap = sim.step(step * 3600, components, wires);
    dayAccumulate(acc, snap, components, h, step, kwc || 0, season);
  }
  acc.trips = sim.events.filter((e) => e.level !== 'info').length;
  acc.events = sim.events.slice();
  dayRestoreStates(saved);
  return acc;
}
