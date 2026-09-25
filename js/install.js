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
 *  • designInstallation(components, wires, board)
 *      Avec un tableau personnalisé (board.js) : ses circuits, différentiels et
 *      abonnement remplacent la répartition automatique ; les appareils du plan
 *      gardent leurs câbles, les circuits sans appareil ont une longueur et une
 *      puissance saisies. Sans plan, le tableau suffit.
 *
 *  • unifilarSVG(design) : schéma unifilaire du tableau (voir board.js).
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
  // Colonne montante (maison à étage) : un segment dont la longueur de câble est
  // la hauteur à gravir (w.len), pas la distance entre les deux plans
  const segs = [];
  for (const w of wires) {
    if (w.kind !== 'conduit') continue;
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1], d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      segs.push([a, b, w.riser ? (w.len || 300) / d : 1]);
    }
  }
  const verts = [];
  for (const [a, b] of segs) verts.push(a, b);
  // 1. découpe aux sommets posés sur un autre segment (jonctions en T)
  let pieces = [];
  for (const [a, b, f] of segs) {
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
        f,
      ]);
    }
  }
  // 2. raccordement de chaque ancre (appareil, tableau) au segment le plus proche
  const att = anchors.map((p) => {
    let best = null;
    pieces.forEach(([a, b, f], i) => {
      if (f !== 1) return; // on ne se raccorde pas à la colonne montante
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
  pieces.forEach(([a, b, f], i) => {
    const ts = [...new Set(cuts[i])].sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const p = { x: a.x + (b.x - a.x) * ts[k], y: a.y + (b.y - a.y) * ts[k] };
      const q = { x: a.x + (b.x - a.x) * ts[k + 1], y: a.y + (b.y - a.y) * ts[k + 1] };
      const len = Math.hypot(q.x - p.x, q.y - p.y) * f;
      if (len < 1e-3) continue;
      edges.push({ a: node(p), b: node(q), len, riser: f !== 1 });
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
// Étude d'éclairement : lux sur le plan utile (0,85 m), tous les points
// lumineux allumés. Luminaire LED avec diffuseur : Φ = P × 60 lm/W.
// Plafonnier : émission lambertienne vers le bas, E = Φ·h² / (π·d⁴).
// Applique : demi-espace isotrope, E = Φ·h / (2π·d³). La lumière reste dans
// sa pièce (portes fermées) ; les parois (ρ = 0,5) renvoient Φ / S_parois.
// ---------------------------------------------------------------------------
const LUX_EFFICACY = 60;  // lm/W
const LUX_PLANE = 85;     // cm — hauteur du plan utile
const LUX_TARGET = { sejour: 150, cuisine: 200, chambre: 100, sdb: 150, wc: 100, circ: 100, bureau: 300, garage: 100, annexe: 100, dressing: 100 };
const LUX_LAMPS = new Set(['dcl', 'wall_light']);

function lightingStudy(components, wires) {
  const info = computeRooms(components, wires);
  if (!info.owner) return null;
  const K = 1, S = info.step * K; // un point tous les 10 cm
  const nx = Math.ceil(info.nx / K), ny = Math.ceil(info.ny / K);
  const lux = new Float32Array(nx * ny).fill(-1), own = new Int16Array(nx * ny).fill(-1);
  const rooms = info.rooms.map((r, i) => ({
    i, id: r.id, name: r.name, key: r.type ? r.type.key : null, area: r.area, lamps: 0, lm: 0,
    sum: 0, n: 0, min: Infinity, max: 0, skip: r.leaked || r.sharedWith !== null || !r.area,
  }));
  const byRoom = rooms.map(() => []);
  for (const c of components) {
    if (!LUX_LAMPS.has(c.type)) continue;
    const i = roomAt(info, c.x, c.y);
    if (i < 0) continue;
    const L = { x: c.x / 100, y: c.y / 100, wall: c.type === 'wall_light', h: (MOUNT_H[c.type] * 100 - LUX_PLANE) / 100, lm: loadPower(c) * LUX_EFFICACY };
    byRoom[i].push(L);
    rooms[i].lamps++; rooms[i].lm += L.lm;
  }
  // Part réfléchie : flux de la pièce sur sol + plafond + murs (2,5 m, périmètre ≈ 4,4 √A)
  const indirect = rooms.map((r) => (r.area ? r.lm / (2 * r.area + 4.4 * Math.sqrt(r.area) * 2.5) : 0));
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const o = info.owner[gy * K * info.nx + gx * K];
      if (o < 0 || rooms[o].skip) continue;
      const x = (info.x0 + gx * S) / 100, y = (info.y0 + gy * S) / 100;
      let E = indirect[o];
      for (const L of byRoom[o]) {
        const d2 = (x - L.x) ** 2 + (y - L.y) ** 2 + L.h * L.h;
        E += L.wall ? (L.lm * L.h) / (2 * Math.PI * d2 * Math.sqrt(d2)) : (L.lm * L.h * L.h) / (Math.PI * d2 * d2);
      }
      lux[gy * nx + gx] = E; own[gy * nx + gx] = o;
      const R = rooms[o];
      R.sum += E; R.n++; R.min = Math.min(R.min, E); R.max = Math.max(R.max, E);
    }
  }
  const out = [];
  for (const R of rooms) {
    if (R.skip || !R.n) continue;
    const avg = R.sum / R.n, target = LUX_TARGET[R.key] || 100;
    const status = avg >= target ? 'ok' : avg >= 0.7 * target ? 'juste' : 'faible';
    // flux à ajouter pour atteindre l'objectif (≈ 55 % du flux arrive sur le plan utile)
    const need = status === 'ok' ? 0 : Math.ceil(((target - avg) * R.area) / 0.55 / 100) * 100;
    out.push({ i: R.i, id: R.id, name: R.name, key: R.key, area: R.area, lamps: R.lamps, lm: Math.round(R.lm), avg, min: R.min, max: R.max, uniformity: avg ? R.min / avg : 0, target, status, need });
  }
  return { step: S, x0: info.x0, y0: info.y0, nx, ny, lux, own, rooms: out };
}

// ---------------------------------------------------------------------------
function designInstallation(components, wires, board) {
  const B = board && Array.isArray(board.circuits) ? board : null; // tableau personnalisé
  const design = {
    ok: false, circuits: [], rcds: [], agcp: null, issues: [], area: 0, byDevice: {}, plugs: {},
    installed: 0, probable: 0, cableTotal: 0, panel: null, custom: !!B, orphans: [],
    supply: { phases: 1, surge: !!(B && B.supply && B.supply.surge), kva: null, rows: (B && B.supply && +B.supply.rows) || 0 },
  };
  const tb = components.find((c) => c.type === 'panel_house');
  if (!tb && !B) { design.issues.push({ level: 'err', msg: 'Aucun tableau électrique : place-le (ou lance l’implantation automatique).' }); return design; }
  design.panel = tb ? tb.id : null;
  const hasWalls = wires.some((w) => w.kind === 'wall');
  const info = hasWalls ? computeRooms(components, wires) : { rooms: [], owner: null };
  const roomOf = (c) => (info.owner ? roomAt(info, c.x, c.y) : -1);
  const roomName = (i) => (i >= 0 ? info.rooms[i].name : 'Hors pièce');
  const roomKey = (i) => (i >= 0 && info.rooms[i].type ? info.rooms[i].type.key : null);
  design.area = info.rooms.reduce((s, r) => s + (r.leaked || r.sharedWith !== null ? 0 : r.area || 0), 0);
  if (B && B.supply && +B.supply.area && !design.area) design.area = +B.supply.area; // tableau sans plan : surface déclarée

  // Appareils alimentés par le tableau (les appareils « branchés » passent par une prise)
  const devs = tb ? components.filter((c) => LOADS[c.type] && LOADS[c.type].cls !== 'plug' || SWITCHES_PLAN.has(c.type)) : [];
  const net = tb ? _buildNetwork(wires, [tb, ...devs]) : { edges: [], anchorNode: [] };
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
  // Maison à étage : jamais un circuit à cheval sur deux niveaux (plans côte à côte,
  // séparés au milieu des deux escaliers)
  let split = null;
  if (components.some((c) => c.type === 'stairs' && c.value === 'haut')) {
    // milieu du plus grand vide entre les murs : la séparation des deux plans
    const xs = [...new Set(wires.filter((w) => w.kind === 'wall').flatMap((w) => w.points.map((p) => p.x)))].sort((a, b) => a - b);
    let gap = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > gap) { gap = xs[i] - xs[i - 1]; split = (xs[i] + xs[i - 1]) / 2; }
  }
  const levelOf = (c) => (split !== null && c.x >= split ? 1 : 0);
  const chunk = (list, n) => {
    const out = [];
    const levels = split === null ? [list] : [list.filter((c) => levelOf(c) === 0), list.filter((c) => levelOf(c) === 1)];
    for (const l of levels) for (let i = 0; i < l.length; i += n) out.push(l.slice(i, i + n));
    return out;
  };
  // Noms : « Éclairage 2 », ou par niveau dans une maison à étage (« Prises étage 1 »)
  const LEVEL_NAMES = ['RDC', 'étage'];
  const names = (base, groups) => groups.map((g, i) => {
    if (split === null) return base + (groups.length > 1 ? ' ' + (i + 1) : '');
    const L = levelOf(g[0]), same = groups.filter((h) => levelOf(h[0]) === L);
    return base + ' ' + LEVEL_NAMES[L] + (same.length > 1 ? ' ' + (same.indexOf(g) + 1) : '');
  });
  const circuits = design.circuits;
  const add = (o) => { o.id = 'C' + (circuits.length + 1); circuits.push(o); return o; };
  const roomsLabel = (list) => [...new Set(list.map((c) => roomName(roomOf(c))))].join(', ');

  const sockets = byRoom(devs.filter((c) => c.type === 'socket_wall'));
  if (B) {
    // Tableau personnalisé : ses circuits, dans son ordre ; chaque appareil du plan sur un seul circuit
    const byId = new Map(devs.map((c) => [c.id, c]));
    const taken = new Set();
    for (const bc of B.circuits) {
      const list = (bc.devices || []).map((id) => byId.get(id)).filter((c) => c && !taken.has(c.id));
      list.forEach((c) => taken.add(c.id));
      const pts = list.filter((c) => !SWITCHES_PLAN.has(c.type)).length;
      circuits.push({
        id: String(bc.id || 'C' + (circuits.length + 1)), kind: bc.kind || 'other', name: bc.name || bc.id || 'Circuit',
        In: +bc.In || 16, S: +bc.S || 1.5, curve: bc.curve || 'C', devices: list,
        rooms: list.length ? roomsLabel(list) : bc.rooms || '', points: list.length ? pts : Math.max(0, +bc.points || 0),
        manual: !list.length, lengthIn: +bc.length || 0, Pin: +bc.P || 0, appliance: bc.appliance || null,
        typeA: !!bc.typeA, typeF: !!bc.typeF, contactor: bc.contactor || null, teleruptor: !!bc.teleruptor, rcd: bc.rcd || null,
      });
    }
    design.orphans = devs.filter((c) => !taken.has(c.id) && !SWITCHES_PLAN.has(c.type)).map((c) => c.id);
    if (design.orphans.length) {
      design.issues.push({ level: 'warn', msg: `${design.orphans.length} appareil${design.orphans.length > 1 ? 's' : ''} du plan sur aucun circuit du tableau personnalisé : « Répartir les appareils » les range.` });
    }
  } else {
    // Éclairage : 8 points maximum par circuit (16 A, 1,5 mm²), commandes comprises
    const lights = byRoom(devs.filter((c) => LOADS[c.type] && LOADS[c.type].cls === 'light'));
    const lightGroups = chunk(lights, 8), lightNames = names('Éclairage', lightGroups);
    const wired = new Set();
    lightGroups.forEach((g, i) => {
      const rooms = new Set(g.map(roomOf));
      const sw = devs.filter((c) => SWITCHES_PLAN.has(c.type) && rooms.has(roomOf(c)) && !wired.has(c.id));
      sw.forEach((c) => wired.add(c.id));
      add({ kind: 'light', name: lightNames[i], In: 16, S: 1.5, devices: g.concat(sw), rooms: roomsLabel(g), points: g.length });
    });
    // Prises : cuisine (6 max, circuit dédié), autres pièces (8 max) — 20 A, 2,5 mm²
    const kitchen = sockets.filter((c) => roomKey(roomOf(c)) === 'cuisine');
    const others = sockets.filter((c) => roomKey(roomOf(c)) !== 'cuisine');
    const socketGroups = chunk(others, 8), socketNames = names('Prises', socketGroups);
    socketGroups.forEach((g, i) => add({ kind: 'socket', name: socketNames[i], In: 20, S: 2.5, devices: g, rooms: roomsLabel(g), points: g.length }));
    chunk(kitchen, 6).forEach((g, i, all) => add({ kind: 'socket', name: 'Prises cuisine' + (all.length > 1 ? ' ' + (i + 1) : ''), In: 20, S: 2.5, devices: g, rooms: roomsLabel(g), points: g.length }));
    // Chauffage : 4 500 W maximum par circuit (20 A, 2,5 mm²)
    const rads = byRoom(devs.filter((c) => c.type === 'radiator'));
    const heat = [];
    for (const r of rads) {
      const g = heat[heat.length - 1];
      if (g && g.P + loadPower(r) <= 4500 && levelOf(g.list[0]) === levelOf(r)) { g.list.push(r); g.P += loadPower(r); } else heat.push({ list: [r], P: loadPower(r) });
    }
    const heatNames = names('Chauffage', heat.map((g) => g.list));
    heat.forEach((g, i) => add({ kind: 'heating', name: heatNames[i], In: 20, S: 2.5, devices: g.list, rooms: roomsLabel(g.list), points: g.list.length }));
    // Circuits spécialisés : un par appareil
    for (const c of byRoom(devs.filter((c) => LOADS[c.type] && LOADS[c.type].cls === 'dedicated'))) {
      const s = LOADS[c.type];
      const same = circuits.filter((x) => x.appliance === c.type).length;
      add({ kind: 'dedicated', appliance: c.type, name: s.circuit + (same ? ' ' + (same + 1) : ''), In: s.In, S: s.S, devices: [c], rooms: roomName(roomOf(c)), points: 1, typeA: !!s.typeA, typeF: !!s.typeF, contactor: c.type === 'water_heater' ? 'hc' : null });
    }
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
    ct.limit = ct.kind === 'light' ? 3 : 5;
    if (!ct.devices.length) {
      // circuit sans appareil du plan : longueur et puissance saisies
      ct.length = ct.lengthIn || 15; ct.edges = []; ct.power = ct.Pin || 0; ct.far = ct.length;
      const I = ct.kind === 'socket' ? ct.In : ct.power / U_NOM;
      ct.dU = (2 * RHO_CU * ct.length * I) / ct.S;
      ct.dUpct = (ct.dU / U_NOM) * 100;
      ct.ok = ct.dUpct <= ct.limit;
      ct.devices = [];
      design.cableTotal += ct.length;
      if (!ct.ok) design.issues.push({ level: 'warn', msg: `${ct.id} ${ct.name} : chute de tension ${ct.dUpct.toFixed(1).replace('.', ',')} % > ${ct.limit} % — augmenter la section ou scinder le circuit.` });
      continue;
    }
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
    if (B && !ct.length && ct.lengthIn) ct.length = ct.lengthIn;
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
    // Prises trop loin du tableau : disjoncteur 16 A sur le même 2,5 mm² (ΔU calculée à In)
    if (!B && ct.kind === 'socket' && ct.In === 20 && (dU / U_NOM) * 100 > ct.limit) {
      ct.In = 16; ct.derated = true;
      dU = (2 * RHO_CU * far * ct.In) / ct.S;
    }
    ct.dU = dU;
    ct.dUpct = (dU / U_NOM) * 100;
    ct.ok = ct.dUpct <= ct.limit;
    ct.far = far;
    ct.devices = ct.devices.map((c) => c.id);
    design.cableTotal += ct.length;
    if (!ct.ok) design.issues.push({ level: 'warn', msg: `${ct.id} ${ct.name} : chute de tension ${ct.dUpct.toFixed(1).replace('.', ',')} % > ${ct.limit} % — augmenter la section ou scinder le circuit.` });
  }

  if (B) {
    // Différentiels du tableau personnalisé ; un circuit sans différentiel reste signalé
    for (const r of B.rcds || []) design.rcds.push({ id: String(r.id), In: +r.In || 40, type: r.type || 'AC', sens: +r.sens || 30, circuits: [] });
    for (const ct of circuits) {
      const r = design.rcds.find((x) => x.id === ct.rcd);
      if (r) r.circuits.push(ct.id); else ct.rcd = null;
    }
  } else {
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
  }

  // Puissance installée / probable → abonnement et réglage du disjoncteur de branchement
  const sum = (f) => circuits.filter(f).reduce((s, c) => s + c.power, 0);
  design.installed = circuits.reduce((s, c) => s + c.power, 0);
  const cook = sum((c) => c.appliance === 'cooktop' || c.appliance === 'oven');
  const laundry = sum((c) => ['washer', 'dishwasher', 'dryer'].includes(c.appliance));
  design.probable = 0.65 * sum((c) => c.kind === 'heating') + 0.5 * sum((c) => c.appliance === 'water_heater')
    + 0.3 * cook + 0.2 * laundry + 0.3 * sum((c) => c.appliance === 'ev_charger')
    + 0.5 * sum((c) => c.kind === 'light') + 800;
  const kvaAuto = KVA_STEPS.find((k) => k * 1000 >= design.probable) || 18;
  const kva = B && B.supply && KVA_STEPS.includes(+B.supply.kva) ? +B.supply.kva : kvaAuto;
  design.agcp = { In: kva * 5, kva, setting: kva * 5, auto: kvaAuto };
  design.supply.kva = kva;
  if (design.probable > 18000) design.issues.push({ level: 'warn', msg: 'Puissance probable > 18 kVA : prévoir un branchement triphasé.' });

  // Section / protection : garde-fous
  for (const ct of circuits) {
    if (ct.kind === 'light' && ct.points > 8) design.issues.push({ level: 'err', msg: `${ct.id} : plus de 8 points lumineux.` });
  }
  design.reserve = Math.ceil(circuits.length * 0.2);
  design.ok = true;
  design.net = net;
  design.route = route;
  if (typeof checkBoard === 'function') design.checks = checkBoard(design); // contrôles du tableau (board.js)
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
    const live = (ct) => a.closed && (!this.rcds[ct.rcd] || this.rcds[ct.rcd].closed) && this.breakers[ct.id].closed;

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
          if (!rc) { this.log(`Défaut d’isolement sur ${comp[id] ? comp[id].label || id : id} : ${ct.id} n’est protégé par aucun différentiel 30 mA — la fuite n’est pas coupée, danger d’électrocution !`, 'err'); continue; }
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
