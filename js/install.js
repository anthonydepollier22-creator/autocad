/*
 * install.js — Conception de l'installation électrique et simulation physique.
 *
 *  • designInstallation(components, wires)
 *      Répartit l'appareillage en circuits (NF C 15-100 simplifiée), choisit
 *      les interrupteurs différentiels selon la surface et le disjoncteur de
 *      branchement selon la puissance probable, tire les câbles dans les
 *      goulottes (plus court chemin depuis le tableau) et calcule longueurs
 *      et chutes de tension (ΔU = 2·ρ·L·I / S, monophasé).
 *
 *  • InstallSim
 *      Simulation temporelle : charges résistives (P ∝ U²), commandes
 *      d'éclairage (va-et-vient), disjoncteurs magnéto-thermiques (modèle
 *      thermique du 1er ordre + déclenchement magnétique sur Icc), différentiels
 *      30 mA (défaut d'isolement), disjoncteur de branchement (dépassement de
 *      la puissance souscrite), compteur d'énergie.
 *
 *  • unifilarSVG(design) : schéma unifilaire du tableau.
 */

const U_NOM = 230;           // V
const RHO_CU = 0.0225;       // Ω·mm²/m — cuivre à sa température de service
const Z_UP = 0.35;           // Ω — impédance amont (réseau + branchement)
const TARIF_KWH = 0.2516;    // € TTC, tarif réglementé option base (indicatif)
const THERMAL_TRIP = 1.13 * 1.13; // échauffement de déclenchement (I = 1,13 In en régime établi)
const TAU_BREAKER = 120;     // s — constante de temps thermique d'un disjoncteur divisionnaire
const TAU_AGCP = 90;         // s — disjoncteur de branchement
const I_LEAK = 0.23;         // A — fuite à la terre d'un défaut franc sur une masse (230 V / ~1 kΩ)
const KVA_STEPS = [3, 6, 9, 12, 15, 18];

// Hauteur de pose (m) : sert aux remontées de câble depuis la goulotte en plinthe
const MOUNT_H = {
  socket_wall: 0.3, rj45: 0.3, switch_sa: 1.1, switch_vv_wall: 1.1, dcl: 2.5, wall_light: 1.9, vmc: 2.5,
  radiator: 0.3, oven: 0.9, cooktop: 0.9, washer: 0.3, dishwasher: 0.3, dryer: 0.3, water_heater: 1.2,
  ev_charger: 1.2, panel_house: 1.5,
};

// Charges électriques (P en W). cls : light | socket | plug (branché sur une
// prise voisine) | dedicated (circuit spécialisé) | heating
const LOADS = {
  dcl: { cls: 'light', P: 40, name: 'Point lumineux' },
  wall_light: { cls: 'light', P: 25, name: 'Applique' },
  socket_wall: { cls: 'socket', name: 'Prise' },
  fridge: { cls: 'plug', P: 150, name: 'Réfrigérateur', always: true },
  tv_unit: { cls: 'plug', P: 120, name: 'Télévision' },
  desk: { cls: 'plug', P: 90, name: 'Ordinateur' },
  oven: { cls: 'dedicated', P: 2500, circuit: 'Four', In: 20, S: 2.5, name: 'Four' },
  cooktop: { cls: 'dedicated', P: 3600, Pmax: 7200, circuit: 'Plaque de cuisson', In: 32, S: 6, typeA: true, name: 'Plaque de cuisson' },
  washer: { cls: 'dedicated', P: 2200, circuit: 'Lave-linge', In: 20, S: 2.5, typeA: true, name: 'Lave-linge' },
  dishwasher: { cls: 'dedicated', P: 2000, circuit: 'Lave-vaisselle', In: 20, S: 2.5, name: 'Lave-vaisselle' },
  dryer: { cls: 'dedicated', P: 2500, circuit: 'Sèche-linge', In: 20, S: 2.5, name: 'Sèche-linge' },
  water_heater: { cls: 'dedicated', P: 3000, circuit: 'Chauffe-eau', In: 20, S: 2.5, name: 'Chauffe-eau' },
  ev_charger: { cls: 'dedicated', P: 7400, circuit: 'Borne de recharge', In: 40, S: 10, typeF: true, name: 'Borne IRVE' },
  vmc: { cls: 'dedicated', P: 35, circuit: 'VMC', In: 2, S: 1.5, always: true, name: 'VMC' },
  radiator: { cls: 'heating', P: 1000, name: 'Radiateur' },
};
const SWITCHES_PLAN = new Set(['switch_sa', 'switch_vv_wall']);

// « 1500 W », « 2 kW », « 2,5kW » → watts
function parsePower(v) {
  const m = /(\d+(?:[.,]\d+)?)\s*(k?)w/i.exec(v || '');
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.')) * (m[2] ? 1000 : 1);
}
function loadPower(c) {
  const spec = LOADS[c.type];
  if (!spec) return 0;
  const p = parsePower(c.value);
  return p !== null ? p : spec.P || 0;
}
function fmtW(w) {
  return w >= 1000 ? (w / 1000).toFixed(w >= 10000 ? 0 : 1).replace('.', ',') + ' kW' : Math.round(w) + ' W';
}

// ---------------------------------------------------------------------------
// Réseau des goulottes : segments découpés aux jonctions et aux points de
// raccordement des appareils
// ---------------------------------------------------------------------------
function _proj(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx, y = a.y + t * dy;
  return { t, x, y, d: Math.hypot(p.x - x, p.y - y) };
}

function _buildNetwork(wires, anchors) {
  const segs = [];
  for (const w of wires) {
    if (w.kind !== 'conduit') continue;
    for (let i = 0; i < w.points.length - 1; i++) segs.push([w.points[i], w.points[i + 1]]);
  }
  const verts = [];
  for (const [a, b] of segs) verts.push(a, b);
  // 1. découpe aux sommets posés sur un autre segment (jonctions en T)
  let pieces = [];
  for (const [a, b] of segs) {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
    const ts = [0, 1];
    for (const p of verts) {
      const q = _proj(p, a, b);
      if (q.d < 1 && q.t > 1e-6 && q.t < 1 - 1e-6) ts.push(q.t);
    }
    ts.sort((x, y) => x - y);
    for (let i = 0; i < ts.length - 1; i++) {
      if (ts[i + 1] - ts[i] < 1e-6) continue;
      pieces.push([
        { x: a.x + (b.x - a.x) * ts[i], y: a.y + (b.y - a.y) * ts[i] },
        { x: a.x + (b.x - a.x) * ts[i + 1], y: a.y + (b.y - a.y) * ts[i + 1] },
      ]);
    }
  }
  // 2. raccordement de chaque ancre (appareil, tableau) au segment le plus proche
  const att = anchors.map((p) => {
    let best = null;
    pieces.forEach(([a, b], i) => {
      const q = _proj(p, a, b);
      if (!best || q.d < best.d) best = { i, ...q };
    });
    return best;
  });
  const cuts = pieces.map(() => [0, 1]);
  att.forEach((q) => { if (q) cuts[q.i].push(q.t); });
  const nodes = new Map(), pos = [];
  const node = (p) => {
    const k = Math.round(p.x * 10) + ',' + Math.round(p.y * 10);
    if (!nodes.has(k)) { nodes.set(k, pos.length); pos.push({ x: p.x, y: p.y }); }
    return nodes.get(k);
  };
  const edges = [];
  pieces.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i])].sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const p = { x: a.x + (b.x - a.x) * ts[k], y: a.y + (b.y - a.y) * ts[k] };
      const q = { x: a.x + (b.x - a.x) * ts[k + 1], y: a.y + (b.y - a.y) * ts[k + 1] };
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 1e-3) continue;
      edges.push({ a: node(p), b: node(q), len });
    }
  });
  const anchorNode = att.map((q) => (q ? { node: node(q), stub: q.d } : null));
  const adj = pos.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
  return { pos, edges, adj, anchorNode };
}

// Plus courts chemins depuis un nœud (Dijkstra, tas binaire)
function _shortest(net, src) {
  const n = net.pos.length, dist = new Float64Array(n).fill(Infinity), via = new Int32Array(n).fill(-1);
  const heap = [];
  const push = (d, v) => {
    heap.push([d, v]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= d) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[c][0] >= heap[i][0]) break;
        [heap[c], heap[i]] = [heap[i], heap[c]]; i = c;
      }
    }
    return top;
  };
  dist[src] = 0; push(0, src);
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const ei of net.adj[v]) {
      const e = net.edges[ei], w = e.a === v ? e.b : e.a, nd = d + e.len;
      if (nd < dist[w]) { dist[w] = nd; via[w] = ei; push(nd, w); }
    }
  }
  return { dist, via };
}

// ---------------------------------------------------------------------------
// Conception
// ---------------------------------------------------------------------------
function designInstallation(components, wires) {
  const design = {
    ok: false, circuits: [], rcds: [], agcp: null, issues: [], area: 0, byDevice: {}, plugs: {},
    installed: 0, probable: 0, cableTotal: 0, panel: null,
  };
  const tb = components.find((c) => c.type === 'panel_house');
  if (!tb) { design.issues.push({ level: 'err', msg: 'Aucun tableau électrique : place-le (ou lance l’implantation automatique).' }); return design; }
  design.panel = tb.id;
  const hasWalls = wires.some((w) => w.kind === 'wall');
  const info = hasWalls ? computeRooms(components, wires) : { rooms: [], owner: null };
  const roomOf = (c) => (info.owner ? roomAt(info, c.x, c.y) : -1);
  const roomName = (i) => (i >= 0 ? info.rooms[i].name : 'Hors pièce');
  const roomKey = (i) => (i >= 0 && info.rooms[i].type ? info.rooms[i].type.key : null);
  design.area = info.rooms.reduce((s, r) => s + (r.leaked || r.sharedWith !== null ? 0 : r.area || 0), 0);

  // Appareils alimentés par le tableau (les appareils « branchés » passent par une prise)
  const devs = components.filter((c) => LOADS[c.type] && LOADS[c.type].cls !== 'plug' || SWITCHES_PLAN.has(c.type));
  const net = _buildNetwork(wires, [tb, ...devs]);
  const hasNet = net.edges.length > 0;
  const tbA = net.anchorNode[0];
  const sp = hasNet && tbA ? _shortest(net, tbA.node) : null;
  const tbRiser = MOUNT_H.panel_house - 0.1;
  const route = {}; // id -> { len (m), edges: [indices], stub (m), off }
  let offNet = 0;
  devs.forEach((c, k) => {
    const A = net.anchorNode[k + 1];
    const rise = Math.max(0, (MOUNT_H[c.type] || 0.3) - 0.1);
    if (sp && A && A.stub < 150 && sp.dist[A.node] < Infinity) {
      const edges = [];
      for (let v = A.node; sp.via[v] >= 0;) { const e = net.edges[sp.via[v]]; edges.push(sp.via[v]); v = e.a === v ? e.b : e.a; }
      route[c.id] = { len: (sp.dist[A.node] + tbA.stub + A.stub) / PLAN_UNITS_PER_M + rise + tbRiser, edges, stub: A.stub / PLAN_UNITS_PER_M + rise, node: A.node };
    } else {
      offNet++;
      route[c.id] = { len: (Math.abs(c.x - tb.x) + Math.abs(c.y - tb.y)) / PLAN_UNITS_PER_M + rise + tbRiser, edges: [], stub: 0, off: true };
    }
  });
  if (offNet) {
    design.issues.push({
      level: hasNet ? 'warn' : 'info',
      msg: hasNet ? `${offNet} appareil${offNet > 1 ? 's' : ''} loin des goulottes : câble compté en direct.`
        : 'Aucune goulotte : longueurs de câble estimées en ligne droite (lance « Tracer les goulottes »).',
    });
  }

  // Ordre des pièces : de la plus proche du tableau à la plus éloignée
  const roomDist = info.rooms.map((r, i) => {
    const ds = devs.filter((c) => roomOf(c) === i).map((c) => route[c.id].len);
    return ds.length ? Math.min(...ds) : Infinity;
  });
  const byRoom = (list) => list.slice().sort((a, b) => {
    const ra = roomOf(a), rb = roomOf(b);
    const da = ra >= 0 ? roomDist[ra] : 1e9, db = rb >= 0 ? roomDist[rb] : 1e9;
    return da - db || ra - rb || route[a.id].len - route[b.id].len;
  });
  const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
  const circuits = design.circuits;
  const add = (o) => { o.id = 'C' + (circuits.length + 1); circuits.push(o); return o; };
  const roomsLabel = (list) => [...new Set(list.map((c) => roomName(roomOf(c))))].join(', ');

  // Éclairage : 8 points maximum par circuit (16 A, 1,5 mm²), commandes comprises
  const lights = byRoom(devs.filter((c) => LOADS[c.type] && LOADS[c.type].cls === 'light'));
  const nLight = chunk(lights, 8).length;
  const wired = new Set();
  chunk(lights, 8).forEach((g, i) => {
    const rooms = new Set(g.map(roomOf));
    const sw = devs.filter((c) => SWITCHES_PLAN.has(c.type) && rooms.has(roomOf(c)) && !wired.has(c.id));
    sw.forEach((c) => wired.add(c.id));
    add({ kind: 'light', name: 'Éclairage' + (nLight > 1 ? ' ' + (i + 1) : ''), In: 16, S: 1.5, devices: g.concat(sw), rooms: roomsLabel(g), points: g.length });
  });
  // Prises : cuisine (6 max, circuit dédié), autres pièces (8 max) — 20 A, 2,5 mm²
  const sockets = byRoom(devs.filter((c) => c.type === 'socket_wall'));
  const kitchen = sockets.filter((c) => roomKey(roomOf(c)) === 'cuisine');
  const others = sockets.filter((c) => roomKey(roomOf(c)) !== 'cuisine');
  const nOther = chunk(others, 8).length;
  chunk(others, 8).forEach((g, i) => add({ kind: 'socket', name: 'Prises' + (nOther > 1 ? ' ' + (i + 1) : ''), In: 20, S: 2.5, devices: g, rooms: roomsLabel(g), points: g.length }));
  chunk(kitchen, 6).forEach((g, i, all) => add({ kind: 'socket', name: 'Prises cuisine' + (all.length > 1 ? ' ' + (i + 1) : ''), In: 20, S: 2.5, devices: g, rooms: roomsLabel(g), points: g.length }));
  // Chauffage : 4 500 W maximum par circuit (20 A, 2,5 mm²)
  const rads = byRoom(devs.filter((c) => c.type === 'radiator'));
  const heat = [];
  for (const r of rads) {
    const g = heat[heat.length - 1];
    if (g && g.P + loadPower(r) <= 4500) { g.list.push(r); g.P += loadPower(r); } else heat.push({ list: [r], P: loadPower(r) });
  }
  heat.forEach((g, i) => add({ kind: 'heating', name: 'Chauffage' + (heat.length > 1 ? ' ' + (i + 1) : ''), In: 20, S: 2.5, devices: g.list, rooms: roomsLabel(g.list), points: g.list.length }));
  // Circuits spécialisés : un par appareil
  for (const c of byRoom(devs.filter((c) => LOADS[c.type] && LOADS[c.type].cls === 'dedicated'))) {
    const s = LOADS[c.type];
    const same = circuits.filter((x) => x.appliance === c.type).length;
    add({ kind: 'dedicated', appliance: c.type, name: s.circuit + (same ? ' ' + (same + 1) : ''), In: s.In, S: s.S, devices: [c], rooms: roomName(roomOf(c)), points: 1, typeA: !!s.typeA, typeF: !!s.typeF });
  }

  // Appareils branchés : sur la prise la plus proche de la même pièce
  for (const c of components) {
    const s = LOADS[c.type];
    if (!s || s.cls !== 'plug') continue;
    let best = null, bd = 220;
    for (const p of sockets) {
      if (roomOf(p) !== roomOf(c)) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) design.plugs[c.id] = best.id;
  }

  // Longueur de câble (arbre du circuit) et chute de tension au pire
  for (const ct of circuits) {
    const used = new Set();
    let stubs = 0, direct = 0;
    for (const c of ct.devices) {
      const r = route[c.id];
      if (r.off) direct += r.len; else { r.edges.forEach((e) => used.add(e)); stubs += r.stub; }
      design.byDevice[c.id] = { circuit: ct.id, len: r.len };
    }
    let tree = 0;
    used.forEach((e) => { tree += net.edges[e].len; });
    ct.length = tree / PLAN_UNITS_PER_M + stubs + direct + (used.size ? (tbA.stub / PLAN_UNITS_PER_M + tbRiser) : 0);
    ct.edges = [...used];
    ct.power = ct.devices.reduce((s, c) => s + (LOADS[c.type] ? (LOADS[c.type].Pmax || loadPower(c)) : 0), 0);
    // Courant de calcul : In au point le plus éloigné pour les prises, charges réelles sinon
    const far = ct.devices.reduce((m, c) => Math.max(m, route[c.id].len), 0);
    let dU;
    if (ct.kind === 'socket') dU = (2 * RHO_CU * far * ct.In) / ct.S;
    else {
      dU = 0;
      for (const c of ct.devices) {
        if (!LOADS[c.type]) continue;
        // majorant : toute la puissance du circuit parcourt le chemin de l'appareil
        dU = Math.max(dU, (2 * RHO_CU * route[c.id].len * (ct.power / U_NOM)) / ct.S);
      }
    }
    ct.dU = dU;
    ct.dUpct = (dU / U_NOM) * 100;
    ct.limit = ct.kind === 'light' ? 3 : 5;
    ct.ok = ct.dUpct <= ct.limit;
    ct.far = far;
    ct.devices = ct.devices.map((c) => c.id);
    design.cableTotal += ct.length;
    if (!ct.ok) design.issues.push({ level: 'warn', msg: `${ct.id} ${ct.name} : chute de tension ${ct.dUpct.toFixed(1).replace('.', ',')} % > ${ct.limit} % — augmenter la section ou scinder le circuit.` });
  }

  // Interrupteurs différentiels 30 mA selon la surface (NF C 15-100)
  const A = design.area;
  const acCount = A <= 35 ? 1 : A <= 100 ? 2 : 3;
  const rcds = design.rcds;
  for (let i = 0; i < acCount; i++) rcds.push({ id: 'ID' + (rcds.length + 1), In: A <= 35 ? 25 : 40, type: 'AC', circuits: [] });
  rcds.push({ id: 'ID' + (rcds.length + 1), In: 40, type: 'A', circuits: [] });
  if (circuits.some((c) => c.typeF)) rcds.push({ id: 'ID' + (rcds.length + 1), In: 40, type: 'F', circuits: [] });
  const typeA = rcds.find((r) => r.type === 'A'), typeF = rcds.find((r) => r.type === 'F');
  const acs = rcds.filter((r) => r.type === 'AC');
  let rr = 0;
  const leastLoaded = () => acs.slice().sort((a, b) => a.circuits.length - b.circuits.length)[0];
  for (const ct of circuits) {
    let target;
    if (ct.typeF && typeF) target = typeF;
    else if (ct.typeA) target = typeA;
    else if (ct.kind === 'light') target = acs[rr++ % acs.length]; // éclairages répartis
    else target = leastLoaded();
    if (target.circuits.length >= 8 && target.type === 'AC') {
      target = { id: 'ID' + (rcds.length + 1), In: 40, type: 'AC', circuits: [] };
      rcds.splice(rcds.indexOf(typeA), 0, target);
      acs.push(target);
    }
    target.circuits.push(ct.id);
    ct.rcd = target.id;
  }
  rcds.forEach((r, i) => { const old = r.id; r.id = 'ID' + (i + 1); circuits.forEach((c) => { if (c.rcd === old) c.rcd = '#' + r.id; }); });
  circuits.forEach((c) => { c.rcd = c.rcd.replace('#', ''); });

  // Puissance installée / probable → abonnement et réglage du disjoncteur de branchement
  const sum = (f) => circuits.filter(f).reduce((s, c) => s + c.power, 0);
  design.installed = circuits.reduce((s, c) => s + c.power, 0);
  const cook = sum((c) => c.appliance === 'cooktop' || c.appliance === 'oven');
  const laundry = sum((c) => ['washer', 'dishwasher', 'dryer'].includes(c.appliance));
  design.probable = 0.65 * sum((c) => c.kind === 'heating') + 0.5 * sum((c) => c.appliance === 'water_heater')
    + 0.3 * cook + 0.2 * laundry + 0.3 * sum((c) => c.appliance === 'ev_charger')
    + 0.5 * sum((c) => c.kind === 'light') + 800;
  const kva = KVA_STEPS.find((k) => k * 1000 >= design.probable) || 18;
  design.agcp = { In: kva * 5, kva, setting: kva * 5 };
  if (design.probable > 18000) design.issues.push({ level: 'warn', msg: 'Puissance probable > 18 kVA : prévoir un branchement triphasé.' });

  // Section / protection : garde-fous
  for (const ct of circuits) {
    if (ct.kind === 'light' && ct.points > 8) design.issues.push({ level: 'err', msg: `${ct.id} : plus de 8 points lumineux.` });
  }
  design.reserve = Math.ceil(circuits.length * 0.2);
  design.ok = true;
  design.net = net;
  design.route = route;
  return design;
}

// ---------------------------------------------------------------------------
// Simulation physique de l'installation
// ---------------------------------------------------------------------------
class InstallSim {
  constructor() {
    this.t = 0;              // s (temps simulé)
    this.speed = 1;
    this.energy = 0;         // Wh
    this.breakers = {};      // circuit -> { closed, tripped, heat }
    this.rcds = {};          // ID -> { closed, tripped }
    this.agcp = { closed: true, tripped: false, heat: 0 };
    this.faults = {};        // appareil -> 'short' | 'leak'
    this.events = [];
    this.snap = null;
    this.design = null;
  }

  setDesign(design) {
    this.design = design;
    const b = {}, r = {};
    for (const c of design.circuits) b[c.id] = this.breakers[c.id] || { closed: true, tripped: false, heat: 0 };
    for (const x of design.rcds) r[x.id] = this.rcds[x.id] || { closed: true, tripped: false };
    this.breakers = b; this.rcds = r;
  }

  log(msg, level) {
    this.events.unshift({ t: this.t, msg, level: level || 'info' });
    if (this.events.length > 40) this.events.pop();
  }

  // Commandes manuelles
  toggleBreaker(id) {
    const b = this.breakers[id];
    if (!b) return;
    if (b.tripped || !b.closed) { b.closed = true; b.tripped = false; this.log(`${id} réarmé.`); }
    else { b.closed = false; this.log(`${id} ouvert.`); }
  }
  toggleRcd(id) {
    const r = this.rcds[id];
    if (!r) return;
    if (r.tripped || !r.closed) { r.closed = true; r.tripped = false; this.log(`${id} réarmé.`); }
    else { r.closed = false; this.log(`${id} ouvert.`); }
  }
  toggleAgcp() {
    const a = this.agcp;
    if (a.tripped || !a.closed) { a.closed = true; a.tripped = false; a.heat = 0; this.log('Disjoncteur de branchement réarmé.'); }
    else { a.closed = false; this.log('Disjoncteur de branchement ouvert : maison hors tension.'); }
  }
  setFault(id, kind) {
    if (kind) this.faults[id] = kind; else delete this.faults[id];
  }

  // État des lampes : une pièce est éclairée si ses interrupteurs (va-et-vient
  // compris) donnent un nombre impair de contacts fermés ; sans commande, la
  // lampe suit son propre état.
  _lightDemand(components, wires) {
    const byRoom = {};
    const rooms = wires.some((w) => w.kind === 'wall') ? computeRooms(components, wires) : null;
    const key = (c) => {
      if (!rooms) return -1;
      if (c.ctrl) { const i = rooms.rooms.findIndex((r) => r.id === c.ctrl); if (i >= 0) return i; }
      return roomAt(rooms, c.x, c.y);
    };
    for (const c of components) if (SWITCHES_PLAN.has(c.type)) { const k = key(c); byRoom[k] = (byRoom[k] || 0) ^ (c.closed ? 1 : 0); byRoom['has' + k] = true; }
    const out = {};
    for (const c of components) {
      if (!LOADS[c.type] || LOADS[c.type].cls !== 'light') continue;
      const k = key(c);
      out[c.id] = byRoom['has' + k] ? !!byRoom[k] : !!c.on;
    }
    return out;
  }

  // Avance la simulation de dt secondes réelles
  step(dt, components, wires) {
    const d = this.design;
    if (!d || !d.ok) return (this.snap = null);
    const dts = dt * this.speed;
    const comp = {};
    for (const c of components) comp[c.id] = c;
    const lights = this._lightDemand(components, wires);
    const a = this.agcp;
    const live = (ct) => a.closed && this.rcds[ct.rcd].closed && this.breakers[ct.id].closed;

    // Puissance demandée par appareil (W, sous 230 V)
    const demand = {};
    for (const c of components) {
      const s = LOADS[c.type];
      if (!s) continue;
      if (s.cls === 'light') demand[c.id] = lights[c.id] ? loadPower(c) : 0;
      else if (s.cls === 'socket') demand[c.id] = c.on ? parsePower(c.value) || 0 : 0;
      else if (s.cls === 'plug') {
        const sock = d.plugs[c.id];
        if (sock && (c.on || s.always)) demand[sock] = (demand[sock] || 0) + loadPower(c);
      } else demand[c.id] = c.on || s.always ? loadPower(c) : 0;
    }

    // Courants et tensions par circuit (charges résistives : P ∝ U²)
    const circ = [], dev = {};
    let Itot = 0, Ptot = 0;
    for (const ct of d.circuits) {
      const on = live(ct);
      let I = 0, P = 0, Umin = U_NOM;
      if (on) {
        // courant dans chaque tronçon = somme des appareils en aval
        const edgeI = new Map();
        const cur = {};
        for (const id of ct.devices) {
          const p = demand[id] || 0;
          cur[id] = p / U_NOM;
          for (const e of (d.route[id] || { edges: [] }).edges) edgeI.set(e, (edgeI.get(e) || 0) + cur[id]);
        }
        const tot = Object.values(cur).reduce((s, x) => s + x, 0);
        for (const id of ct.devices) {
          const r = d.route[id];
          if (!r) continue;
          let du = 0;
          for (const e of r.edges) du += (2 * RHO_CU * (d.net.edges[e].len / PLAN_UNITS_PER_M) * edgeI.get(e)) / ct.S;
          const common = r.edges.length ? r.len - r.stub - r.edges.reduce((s, e) => s + d.net.edges[e].len, 0) / PLAN_UNITS_PER_M : r.len;
          du += (2 * RHO_CU * Math.max(0, common) * (r.edges.length ? tot : cur[id])) / ct.S;
          du += (2 * RHO_CU * r.stub * cur[id]) / ct.S;
          const U = Math.max(0, U_NOM - du);
          const p = (demand[id] || 0) * (U / U_NOM) ** 2;
          dev[id] = { U, P: p, on: p > 0 };
          I += U > 0 ? p / U : 0; P += p;
          if (demand[id]) Umin = Math.min(Umin, U);
        }
      } else for (const id of ct.devices) dev[id] = { U: 0, P: 0, on: false };

      // Défauts
      for (const id of ct.devices) {
        const f = this.faults[id];
        if (!f || !on) continue;
        const r = d.route[id];
        if (f === 'short') {
          const Zloop = Z_UP + (2 * RHO_CU * r.len) / ct.S;
          const Icc = U_NOM / Zloop;
          const b = this.breakers[ct.id];
          if (Icc >= 10 * ct.In) {
            b.closed = false; b.tripped = true; b.heat = 0;
            this.log(`Court-circuit sur ${comp[id] ? comp[id].label || id : id} : Icc ≈ ${Math.round(Icc)} A ≥ 10 × In = ${10 * ct.In} A → ${ct.id} déclenche instantanément (magnétique).`, 'err');
          } else I += Icc;
        } else if (f === 'leak') {
          const rc = this.rcds[ct.rcd];
          rc.closed = false; rc.tripped = true;
          this.log(`Défaut d’isolement sur ${comp[id] ? comp[id].label || id : id} : fuite ≈ ${Math.round(I_LEAK * 1000)} mA ≥ 30 mA → ${ct.rcd} déclenche (${this.design.circuits.filter((x) => x.rcd === ct.rcd).length} circuits coupés).`, 'err');
        }
      }

      // Échauffement du disjoncteur : θ → (I/In)² avec la constante de temps τ
      const b = this.breakers[ct.id];
      const target = (I / ct.In) ** 2;
      b.heat = target + (b.heat - target) * Math.exp(-dts / TAU_BREAKER);
      if (b.closed && b.heat >= THERMAL_TRIP) {
        b.closed = false; b.tripped = true;
        this.log(`Surcharge sur ${ct.id} ${ct.name} : ${I.toFixed(1).replace('.', ',')} A pour ${ct.In} A → déclenchement thermique.`, 'warn');
      }
      circ.push({ id: ct.id, I: live(ct) ? I : 0, P: live(ct) ? P : 0, Umin, heat: b.heat, live: live(ct) });
      if (live(ct)) { Itot += I; Ptot += P; }
    }

    // Disjoncteur de branchement : dépassement de la puissance souscrite
    const tA = (Itot / d.agcp.setting) ** 2;
    a.heat = tA + (a.heat - tA) * Math.exp(-dts / TAU_AGCP);
    if (a.closed && a.heat >= THERMAL_TRIP) {
      a.closed = false; a.tripped = true;
      this.log(`Dépassement de la puissance souscrite (${fmtW(Ptot)} pour ${d.agcp.kva} kVA) → le disjoncteur de branchement coupe toute la maison.`, 'err');
    }
    this.t += dts;
    this.energy += (Ptot * dts) / 3600;
    const lit = new Set();
    for (const id in dev) if (dev[id].on && LOADS[comp[id] && comp[id].type] && LOADS[comp[id].type].cls === 'light') lit.add(id);
    this.snap = { t: this.t, P: Ptot, I: Itot, circuits: circ, devices: dev, lit, energy: this.energy, cost: (this.energy / 1000) * TARIF_KWH, agcpLoad: Itot / d.agcp.setting };
    return this.snap;
  }
}

// ---------------------------------------------------------------------------
// Schéma unifilaire du tableau (SVG)
// ---------------------------------------------------------------------------
function unifilarSVG(design, meta) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const colW = 70, left = 150, top = 70;
  const n = design.circuits.length;
  const W = left + n * colW + design.rcds.length * 20 + 60, H = 560;
  let x = left;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>`;
  s += `<text x="20" y="32" font-size="18" font-weight="bold" fill="#1a2230">Schéma unifilaire — ${esc((meta && meta.title) || 'Installation')}</text>`;
  s += `<text x="20" y="52" font-size="11" fill="#5b6b82">Monophasé 230 V · abonnement ${design.agcp.kva} kVA · ${design.circuits.length} circuits · ${design.cableTotal.toFixed(0)} m de câble · NF C 15-100 (simplifiée)</text>`;
  // Arrivée + AGCP
  const g = '#1a2230';
  s += `<line x1="60" y1="${top + 20}" x2="60" y2="${top + 90}" stroke="${g}" stroke-width="2"/>`;
  s += `<rect x="40" y="${top + 90}" width="40" height="56" rx="4" fill="#fff" stroke="${g}" stroke-width="2"/>`;
  s += `<text x="60" y="${top + 114}" font-size="10" text-anchor="middle" font-weight="bold">AGCP</text><text x="60" y="${top + 128}" font-size="10" text-anchor="middle">${design.agcp.setting} A</text><text x="60" y="${top + 140}" font-size="9" text-anchor="middle">500 mA</text>`;
  s += `<text x="60" y="${top + 12}" font-size="10" text-anchor="middle" fill="#5b6b82">Réseau</text>`;
  const bus = top + 190;
  s += `<line x1="60" y1="${top + 146}" x2="60" y2="${bus}" stroke="${g}" stroke-width="2"/>`;
  const xEnd = left + n * colW + design.rcds.length * 20;
  s += `<line x1="60" y1="${bus}" x2="${xEnd}" y2="${bus}" stroke="${g}" stroke-width="3"/>`;
  for (const r of design.rcds) {
    const cs = design.circuits.filter((c) => c.rcd === r.id);
    if (!cs.length) continue;
    const x0 = x, x1 = x + cs.length * colW - colW;
    const xr = (x0 + x1) / 2;
    s += `<line x1="${xr}" y1="${bus}" x2="${xr}" y2="${bus + 30}" stroke="${g}" stroke-width="2"/>`;
    s += `<rect x="${xr - 26}" y="${bus + 30}" width="52" height="46" rx="4" fill="#eef4ff" stroke="#1668c4" stroke-width="2"/>`;
    s += `<text x="${xr}" y="${bus + 48}" font-size="10" text-anchor="middle" font-weight="bold" fill="#1668c4">${r.id}</text>`;
    s += `<text x="${xr}" y="${bus + 61}" font-size="9" text-anchor="middle">${r.In} A 30 mA</text><text x="${xr}" y="${bus + 72}" font-size="9" text-anchor="middle">type ${r.type}</text>`;
    const sub = bus + 100;
    s += `<line x1="${xr}" y1="${bus + 76}" x2="${xr}" y2="${sub}" stroke="${g}" stroke-width="2"/>`;
    s += `<line x1="${x0}" y1="${sub}" x2="${Math.max(x1, x0)}" y2="${sub}" stroke="${g}" stroke-width="2"/>`;
    for (const c of cs) {
      s += `<line x1="${x}" y1="${sub}" x2="${x}" y2="${sub + 22}" stroke="${g}" stroke-width="1.6"/>`;
      s += `<rect x="${x - 16}" y="${sub + 22}" width="32" height="38" rx="3" fill="#fff" stroke="${g}" stroke-width="1.6"/>`;
      s += `<text x="${x}" y="${sub + 38}" font-size="9" text-anchor="middle" font-weight="bold">${c.id}</text><text x="${x}" y="${sub + 51}" font-size="9" text-anchor="middle">${c.In} A</text>`;
      s += `<line x1="${x}" y1="${sub + 60}" x2="${x}" y2="${sub + 92}" stroke="${g}" stroke-width="1.6"/>`;
      const col = c.ok ? '#0f7a3d' : '#b3261e';
      s += `<text transform="translate(${x + 4} ${sub + 100}) rotate(90)" font-size="10" fill="${g}"><tspan font-weight="bold">${esc(c.name)}</tspan><tspan x="0" dy="13" fill="#5b6b82">${c.S} mm² · ${c.length.toFixed(1).replace('.', ',')} m · ${c.points} pt${c.points > 1 ? 's' : ''}</tspan><tspan x="0" dy="13" fill="${col}">ΔU ${c.dUpct.toFixed(1).replace('.', ',')} %</tspan></text>`;
      x += colW;
    }
    x += 20;
  }
  s += '</svg>';
  return s;
}
