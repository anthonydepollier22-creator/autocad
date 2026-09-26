/*
 * houses.js — Types de maison, ameublement et implantation électrique
 * automatiques.
 *
 *  • HOUSE_TYPES    : Studio, T2, T3, maison T4, maison T5 + garage
 *                     (pièces, portes, fenêtres, mobilier de chaque pièce).
 *  • buildHouse()   : génère le plan (murs intérieurs/extérieurs, ouvertures,
 *                     pièces, mobilier) puis, sur option, l'installation.
 *  • furnishPlan()  : meuble les pièces d'un plan quelconque — placement sans
 *                     collision (débattement des portes, fenêtres, passages).
 *  • autoImplant()  : pose l'appareillage NF C 15-100 manquant pièce par pièce
 *                     (GTL + tableau, prises, points lumineux, commandes à
 *                     chaque porte, RJ45, DAAF, VMC, radiateurs).
 *  • autoConduits() : trace les goulottes du tableau vers chaque appareil —
 *                     plus courts chemins le long des murs, en arbre partagé.
 *
 * Échelle : 100 unités = 1 m. Tout est déterministe (mêmes entrées → même plan).
 */

const WALL_BACK = 12;     // dos d'un meuble posé contre un mur, depuis l'axe du mur
const DEVICE_OFF = 20;    // appareillage mural, depuis l'axe du mur

// ---------------------------------------------------------------------------
// Types de maison
// r : rectangle [x0, y0, x1, y1] ; doors : [x, y, pièce vers laquelle elle
// s'ouvre, 'garage' pour une porte sectionnelle] ; windows : [x, y].
// ---------------------------------------------------------------------------
const HOUSE_TYPES = [
  {
    key: 'studio', name: 'Studio', tag: '1 pièce', desc: 'Pièce de vie avec coin cuisine et lit, salle d’eau, entrée.',
    rooms: [
      { name: 'Séjour', r: [0, 0, 400, 480], items: ['fridge', 'counter', 'cooktop', 'washer', 'bed', 'wardrobe', 'plant'] },
      { name: 'Salle d’eau', r: [400, 0, 600, 260], items: ['shower', 'toilet', 'washbasin'] },
      { name: 'Entrée', r: [400, 260, 600, 480], items: [] },
    ],
    doors: [[470, 480, 'Entrée'], [400, 400, 'Séjour'], [550, 260, 'Salle d’eau']],
    windows: [[130, 0], [300, 0], [0, 250], [500, 0]],
  },
  {
    key: 't2', name: 'Appartement T2', tag: '2 pièces', desc: 'Séjour, cuisine fermée, chambre, salle de bains, WC séparé.',
    rooms: [
      { name: 'Séjour', r: [0, 0, 480, 360], items: ['tv_unit', 'sofa', 'table', 'plant'] },
      { name: 'Cuisine', r: [0, 360, 280, 600], items: ['fridge', 'counter', 'cooktop'] },
      { name: 'Entrée', r: [280, 360, 480, 600], items: [] },
      { name: 'Chambre', r: [480, 0, 800, 340], items: ['bed', 'wardrobe', 'plant'] },
      { name: 'Dégagement', r: [480, 340, 600, 480], items: [] },
      { name: 'WC', r: [480, 480, 600, 600], items: ['toilet'] },
      { name: 'Salle de bains', r: [600, 340, 800, 600], items: ['bathtub', 'washbasin'] },
    ],
    doors: [
      [380, 600, 'Entrée'], [380, 360, 'Séjour'], [280, 440, 'Cuisine'], [480, 420, 'Entrée'],
      [540, 340, 'Chambre'], [600, 410, 'Salle de bains'], [540, 480, 'Dégagement'],
    ],
    windows: [[130, 0], [350, 0], [0, 180], [0, 480], [140, 600], [640, 0], [800, 170], [800, 470]],
  },
  {
    key: 't3', name: 'Appartement T3', tag: '3 pièces', desc: 'Grand séjour, cuisine, deux chambres, couloir, salle de bains, WC.',
    rooms: [
      { name: 'Séjour', r: [0, 0, 580, 440], items: ['tv_unit', 'sofa', 'table', 'plant'] },
      { name: 'Cuisine', r: [0, 440, 300, 760], items: ['fridge', 'counter', 'cooktop', 'dishwasher', 'oven'] },
      { name: 'Entrée', r: [300, 440, 580, 760], label: [370, 540], items: ['water_heater', 'plant'] },
      { name: 'WC', r: [460, 620, 580, 760], items: ['toilet'] },
      { name: 'Chambre 1', r: [580, 0, 1040, 340], items: ['bed', 'wardrobe', 'desk', 'plant'] },
      { name: 'Couloir', r: [580, 340, 700, 760], items: [] },
      { name: 'Chambre 2', r: [700, 340, 1040, 560], items: ['bed', 'plant'] },
      { name: 'Salle de bains', r: [700, 560, 1040, 760], items: ['bathtub', 'washbasin', 'washer'] },
    ],
    doors: [
      [380, 760, 'Entrée'], [440, 440, 'Séjour'], [300, 540, 'Cuisine'], [520, 620, 'Entrée'], [580, 520, 'Couloir'],
      [640, 340, 'Chambre 1'], [700, 450, 'Chambre 2'], [700, 660, 'Salle de bains'],
    ],
    windows: [[150, 0], [430, 0], [0, 220], [0, 600], [150, 760], [810, 0], [1040, 170], [1040, 450], [870, 760]],
  },
  {
    key: 't4', name: 'Maison T4', tag: 'plain-pied', desc: 'Maison de plain-pied : trois chambres, cellier technique, grande cuisine équipée.',
    rooms: [
      { name: 'Séjour', r: [0, 0, 620, 460], items: ['tv_unit', 'sofa', 'table', 'plant', 'plant'] },
      { name: 'Cuisine', r: [0, 460, 320, 840], items: ['fridge', 'counter', 'cooktop', 'dishwasher', 'oven'] },
      { name: 'Entrée', r: [320, 460, 620, 840], label: [400, 560], items: ['plant'] },
      { name: 'WC', r: [500, 680, 620, 840], items: ['toilet'] },
      { name: 'Couloir', r: [620, 460, 1240, 580], items: [] },
      { name: 'Chambre 1', r: [620, 0, 960, 460], items: ['bed', 'wardrobe', 'desk', 'plant'] },
      { name: 'Chambre 2', r: [960, 0, 1240, 460], items: ['bed', 'wardrobe', 'desk'] },
      { name: 'Chambre 3', r: [620, 580, 900, 840], items: ['bed', 'plant'] },
      { name: 'Salle de bains', r: [900, 580, 1100, 840], items: ['bathtub', 'washbasin'] },
      { name: 'Cellier', r: [1100, 580, 1240, 840], items: ['water_heater', 'washer'] },
    ],
    doors: [
      [400, 840, 'Entrée'], [470, 460, 'Séjour'], [320, 620, 'Cuisine'], [560, 680, 'Entrée'], [620, 520, 'Couloir'],
      [800, 460, 'Chambre 1'], [1100, 460, 'Chambre 2'], [760, 580, 'Chambre 3'], [1000, 580, 'Salle de bains'],
      [1170, 580, 'Cellier'],
    ],
    windows: [
      [150, 0], [470, 0], [0, 230], [0, 650], [160, 840], [790, 0], [1100, 0], [1240, 230], [760, 840],
      [1000, 840], [1240, 710],
    ],
  },
  {
    key: 't5', name: 'Maison T5 + garage', tag: 'garage · IRVE', desc: 'Quatre chambres dont un bureau, buanderie, garage avec borne de recharge.',
    rooms: [
      { name: 'Garage', r: [0, 0, 340, 600], items: ['car', 'ev_charger'] },
      { name: 'Buanderie', r: [0, 600, 340, 960], items: ['water_heater', 'washer', 'dryer'] },
      { name: 'Séjour', r: [340, 0, 960, 480], items: ['tv_unit', 'sofa', 'table', 'plant', 'plant'] },
      { name: 'Cuisine', r: [340, 480, 680, 960], items: ['fridge', 'counter', 'cooktop', 'dishwasher', 'oven', 'table'] },
      { name: 'Entrée', r: [680, 480, 960, 960], label: [760, 600], items: ['plant'] },
      { name: 'WC', r: [840, 760, 960, 960], items: ['toilet'] },
      { name: 'Couloir', r: [960, 480, 1640, 600], items: [] },
      { name: 'Chambre 1', r: [960, 0, 1320, 480], items: ['bed', 'wardrobe', 'desk', 'plant'] },
      { name: 'Chambre 2', r: [1320, 0, 1640, 480], items: ['bed', 'wardrobe', 'desk'] },
      { name: 'Chambre 3', r: [960, 600, 1220, 960], items: ['bed', 'wardrobe'] },
      { name: 'Salle de bains', r: [1220, 600, 1420, 960], items: ['bathtub', 'shower', 'washbasin'] },
      { name: 'Bureau', r: [1420, 600, 1640, 960], items: ['desk', 'plant'] },
    ],
    doors: [
      [760, 960, 'Entrée'], [820, 480, 'Séjour'], [680, 620, 'Cuisine'], [900, 760, 'Entrée'], [960, 540, 'Couloir'],
      [1140, 480, 'Chambre 1'], [1480, 480, 'Chambre 2'], [1090, 600, 'Chambre 3'], [1320, 600, 'Salle de bains'],
      [1530, 600, 'Bureau'], [340, 780, 'Buanderie'], [170, 600, 'Garage'], [170, 0, 'Garage', 'garage'],
    ],
    windows: [
      [520, 0], [800, 0], [0, 780], [510, 960], [1140, 0], [1480, 0], [1640, 240], [1090, 960], [1320, 960],
      [1640, 780], [0, 380],
    ],
  },
  (() => {
    const E = 1400; // décalage du plan de l'étage
    const up = (r) => [r[0] + E, r[1], r[2] + E, r[3]];
    return {
      key: 'r1', name: 'Maison à étage', tag: 'R+1 · 5 pièces', desc: 'Rez-de-chaussée : séjour, cuisine, bureau, entrée avec escalier, WC, cellier. Étage : trois chambres, salle de bains, palier.',
      levels: [{ name: 'Rez-de-chaussée', x0: -300, x1: 1200 }, { name: 'Étage', x0: 1200, x1: 2700, dx: -E, dy: 280 }],
      stairs: [[845, 720, 90, 'bas'], [845 + E, 720, 90, 'haut']],
      rooms: [
        { name: 'Séjour', r: [0, 0, 600, 480], items: ['tv_unit', 'sofa', 'table', 'plant'] },
        { name: 'Cuisine', r: [600, 0, 1000, 380], items: ['fridge', 'counter', 'cooktop', 'dishwasher', 'oven'] },
        { name: 'Entrée', r: [600, 380, 1000, 780], items: [] },
        { name: 'WC', r: [400, 480, 600, 640], items: ['toilet'] },
        { name: 'Cellier', r: [400, 640, 600, 780], items: ['water_heater'] },
        { name: 'Bureau', r: [0, 480, 400, 780], items: ['desk', 'plant'] },
        { name: 'Chambre 1', r: up([0, 0, 600, 380]), items: ['bed', 'wardrobe', 'plant'] },
        { name: 'Couloir', r: up([0, 380, 600, 480]), items: [] },
        { name: 'Chambre 2', r: up([600, 0, 1000, 380]), items: ['bed', 'wardrobe', 'desk'] },
        { name: 'Chambre 3', r: up([0, 480, 350, 780]), items: ['bed', 'wardrobe'] },
        { name: 'Salle de bains', r: up([350, 480, 600, 780]), items: ['bathtub', 'washbasin', 'toilet', 'washer'] },
        { name: 'Palier', r: up([600, 380, 1000, 780]), items: [] },
      ],
      doors: [
        [1000, 480, 'Entrée'], [600, 430, 'Séjour'], [800, 380, 'Cuisine'], [600, 560, 'WC'], [600, 710, 'Cellier'], [200, 480, 'Bureau'],
        [600 + E, 430, 'Couloir'], [300 + E, 380, 'Chambre 1'], [800 + E, 380, 'Chambre 2'], [175 + E, 480, 'Chambre 3'], [475 + E, 480, 'Salle de bains'],
      ],
      windows: [
        [150, 0], [450, 0], [0, 240], [800, 0], [1000, 190], [0, 630], [200, 780], [500, 780],
        [150 + E, 0], [450 + E, 0], [0 + E, 190], [800 + E, 0], [1000 + E, 190], [0 + E, 630], [175 + E, 780], [475 + E, 780], [1000 + E, 560],
      ],
    };
  })(),
];

// Mobilier par défaut selon le type de pièce (pour meubler un plan dessiné)
const FURNITURE_BY_TYPE = {
  sejour: ['tv_unit', 'sofa', 'table', 'plant'],
  cuisine: ['fridge', 'counter', 'cooktop', 'dishwasher', 'oven'],
  chambre: ['bed', 'wardrobe', 'desk'],
  bureau: ['desk', 'wardrobe', 'plant'],
  sdb: ['bathtub', 'washbasin'],
  wc: ['toilet'],
  circ: ['plant'],
  garage: ['car', 'ev_charger'],
  annexe: ['water_heater', 'washer', 'dryer'],
  dressing: ['wardrobe', 'wardrobe'],
};

// Règles de pose de chaque meuble / appareil
//  tall  : haut (jamais devant une fenêtre)      front : dégagement devant (cm)
//  pref  : center | corner | adjacent (même groupe) | window | farDoor | near
//  mode  : wall (défaut) | free (au milieu) | facing (face à la TV) | car
const FURN = {
  stairs: { front: 70 },
  bed: { pref: 'farDoor', front: 50, sides: 45 },
  wardrobe: { tall: true, pref: 'corner', front: 60 },
  desk: { pref: 'window', front: 20 },
  tv_unit: { tall: true, pref: 'center', front: 40 },
  sofa: { mode: 'facing', front: 30 },
  table: { mode: 'free', grow: 38 },
  plant: { pref: 'corner' },
  fridge: { tall: true, pref: 'corner', group: 'kitchen', front: 75 },
  counter: { pref: 'adjacent', group: 'kitchen', front: 75 },
  cooktop: { pref: 'adjacent', group: 'kitchen', front: 75 },
  dishwasher: { pref: 'adjacent', group: 'kitchen', front: 75 },
  oven: { tall: true, pref: 'adjacent', group: 'kitchen', front: 75 },
  washer: { pref: 'adjacent', group: 'laundry', front: 60 },
  dryer: { pref: 'adjacent', group: 'laundry', front: 60 },
  water_heater: { tall: true, pref: 'corner', front: 40 },
  shower: { tall: true, pref: 'corner', front: 60 },
  bathtub: { pref: 'corner', front: 60 },
  washbasin: { pref: 'center', front: 60 },
  toilet: { pref: 'farDoor', front: 50, sides: 12 },
  car: { mode: 'car' },
  ev_charger: { pref: 'near' },
  radiator: { pref: 'window' },
  gtl: { tall: true, pref: 'near', front: 70 },
  panel_house: { tall: true, pref: 'adjacent', group: 'elec', front: 70 },
};

// Meubles derrière lesquels on ne pose pas de prise ni d'interrupteur
const BLOCKS_OUTLET = new Set([
  'wardrobe', 'fridge', 'oven', 'washer', 'dryer', 'dishwasher', 'water_heater', 'shower', 'bathtub', 'toilet',
  'counter', 'cooktop', 'washbasin', 'gtl', 'panel_house', 'car', 'radiator', 'ev_charger', 'sofa',
]);

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------
function _rot(x, y, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}
function _deg(rad) { return ((Math.round((rad * 180) / Math.PI) % 360) + 360) % 360; }
// Rectangle orienté : boîte locale [x0,x1]×[y0,y1] posée en (cx, cy), pivotée de rot°
function _obb(cx, cy, rot, x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
    const p = _rot(x, y, rot || 0);
    return { x: cx + p.x, y: cy + p.y };
  });
}
// Séparation des axes (deux polygones convexes à 4 sommets)
function _overlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) % 4], nx = b.y - a.y, ny = a.x - b.x;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const p of A) { const d = p.x * nx + p.y * ny; if (d < amin) amin = d; if (d > amax) amax = d; }
      for (const p of B) { const d = p.x * nx + p.y * ny; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
      const l = Math.hypot(nx, ny) || 1;
      if ((amax - bmin) / l < 0.5 || (bmax - amin) / l < 0.5) return false;
    }
  }
  return true;
}
function _inPoly(P, x, y) {
  let sign = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cr) < 1e-9) continue;
    const s = cr > 0 ? 1 : -1;
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}
function _segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
// Distance approchée entre deux rectangles (0 s'ils se touchent)
function _polyDist(A, B) {
  if (_overlap(A, B)) return 0;
  let d = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (const p of P) for (let i = 0; i < 4; i++) d = Math.min(d, _segDist(p.x, p.y, Q[i], Q[(i + 1) % 4]));
  }
  return d;
}
function _footprint(c, grow) {
  const b = SYMBOLS[c.type].bbox, g = grow || 0;
  return _obb(c.x, c.y, c.rot || 0, b.x - g, b.y - g, b.x + b.w + g, b.y + b.h + g);
}

// Pièce qui possède exactement le point (x, y) de la grille de détection
function _ownerAt(info, x, y) {
  if (!info.owner) return -1;
  const gx = Math.round((x - info.x0) / info.step), gy = Math.round((y - info.y0) / info.step);
  if (gx < 0 || gy < 0 || gx >= info.nx || gy >= info.ny) return -1;
  return info.owner[gy * info.nx + gx];
}
function _roomOk(info, r) {
  return r >= 0 && !info.rooms[r].leaked && info.rooms[r].sharedWith === null;
}
// Centre de gravité des points d'une pièce
function _roomCentroid(info, r) {
  let sx = 0, sy = 0, n = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < info.owner.length; k++) {
    if (info.owner[k] !== r) continue;
    const gx = k % info.nx, gy = (k - gx) / info.nx;
    const x = info.x0 + gx * info.step, y = info.y0 + gy * info.step;
    sx += x; sy += y; n++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return n ? { x: sx / n, y: sy / n, minX, minY, maxX, maxY } : null;
}
// Point de la pièce le plus proche de (x, y), aligné sur la grille de 10 cm
function _nearestInRoom(info, r, x, y) {
  if (_ownerAt(info, x, y) === r) return { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
  let best = null, bd = Infinity;
  for (let k = 0; k < info.owner.length; k++) {
    if (info.owner[k] !== r) continue;
    const gx = k % info.nx, gy = (k - gx) / info.nx;
    const px = info.x0 + gx * info.step, py = info.y0 + gy * info.step;
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = { x: px, y: py }; }
  }
  return best;
}

// Tronçons de mur de chaque pièce : chaque segment de mur est échantillonné
// des deux côtés tous les 10 cm ; les échantillons d'une même pièce forment
// un tronçon { room, ax, ay, ux, uy, nx, ny (normale vers la pièce), t0, t1 }.
function roomWallRuns(wires, info) {
  const runs = [];
  for (const w of wires) {
    if (w.kind !== 'wall') continue;
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 20) continue;
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      for (const s of [1, -1]) {
        const nx = -uy * s, ny = ux * s;
        let cur = null;
        const flush = () => {
          if (cur && cur.t1 - cur.t0 >= 30) runs.push({ ...cur, ax: a.x, ay: a.y, ux, uy, nx, ny, ext: !!w.ext });
          cur = null;
        };
        for (let t = 5; t < len; t += 10) {
          const r = _ownerAt(info, a.x + ux * t + nx * DEVICE_OFF, a.y + uy * t + ny * DEVICE_OFF);
          if (_roomOk(info, r) && cur && cur.room === r) cur.t1 = t + 5;
          else { flush(); if (_roomOk(info, r)) cur = { room: r, t0: t - 5, t1: t + 5 }; }
        }
        flush();
      }
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Document : identifiants et références
// ---------------------------------------------------------------------------
function _uid(doc, prefix) {
  doc.__ids = doc.__ids || new Set([...doc.components.map((c) => c.id), ...doc.wires.map((w) => w.id)]);
  let n = doc.__ids.size + 1, id;
  do { id = prefix + n++; } while (doc.__ids.has(id));
  doc.__ids.add(id);
  return id;
}
function _ref(doc, type) {
  const p = SYMBOLS[type].prefix;
  if (!p) return '';
  doc.counters[p] = (doc.counters[p] || 0) + 1;
  return p + doc.counters[p];
}
function _addComp(doc, type, x, y, rot, value) {
  const c = { id: _uid(doc, 'h'), type, x: Math.round(x), y: Math.round(y), rot: _deg(((rot || 0) * Math.PI) / 180), label: _ref(doc, type), value: value || '' };
  if (type === 'breaker' || type === 'rcd') c.closed = true;
  doc.components.push(c);
  return c;
}
function _clean(doc) { delete doc.__ids; return doc; }

// ---------------------------------------------------------------------------
// Contexte de placement : pièces, tronçons de mur, obstacles
// ---------------------------------------------------------------------------
function _planContext(doc) {
  const info = computeRooms(doc.components, doc.wires);
  const ctx = { doc, info, runs: roomWallRuns(doc.wires, info), obstacles: [], doors: [], windows: [], devices: [] };
  for (const c of doc.components) _registerObstacle(ctx, c);
  return ctx;
}
function _registerObstacle(ctx, c) {
  const rot = c.rot || 0;
  if (c.type === 'door' || c.type === 'garage_door') {
    const half = OPENING_HALF[c.type];
    ctx.doors.push({ x: c.x, y: c.y, rot, half, c });
    // débattement du vantail (côté local -y) et passage de 40 cm de part et d'autre
    ctx.obstacles.push({ kind: 'door', poly: _obb(c.x, c.y, rot, -half, c.type === 'door' ? -76 : -40, half, 40) });
    return;
  }
  if (c.type === 'window_a') {
    ctx.windows.push({ x: c.x, y: c.y, rot });
    ctx.obstacles.push({ kind: 'window', poly: _obb(c.x, c.y, rot, -46, -45, 46, 45) });
    return;
  }
  const spec = FURN[c.type];
  if (spec || BLOCKS_OUTLET.has(c.type)) {
    ctx.obstacles.push({ kind: 'block', type: c.type, poly: _footprint(c, 1), c });
    const cl = spec && _clearance(c, spec);
    if (cl) ctx.obstacles.push({ kind: 'clear', poly: cl, c });
    return;
  }
  const sym = SYMBOLS[c.type];
  if (sym && sym.plan && sym.terminals.length) ctx.devices.push({ x: c.x, y: c.y, type: c.type });
}
// Zone à laisser libre devant (et autour, pour un lit) d'un meuble
function _clearance(c, spec) {
  const b = SYMBOLS[c.type].bbox;
  if (spec.mode === 'free' || spec.mode === 'car') return null;
  const front = spec.front || 0, sides = spec.sides || 0;
  if (!front && !sides) return null;
  return _obb(c.x, c.y, c.rot || 0, b.x - sides, b.y + b.h * 0.25, b.x + b.w + sides, b.y + b.h + front);
}

function _polyInRoom(ctx, P, room) {
  const cx = P.reduce((s, p) => s + p.x, 0) / 4, cy = P.reduce((s, p) => s + p.y, 0) / 4;
  const pts = [{ x: cx, y: cy }];
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4];
    // coins et milieux d'arêtes, rentrés de 4 cm
    for (const t of [0, 0.5]) {
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const d = Math.hypot(cx - x, cy - y) || 1;
      pts.push({ x: x + ((cx - x) / d) * 4, y: y + ((cy - y) / d) * 4 });
    }
  }
  return pts.every((p) => _ownerAt(ctx.info, p.x, p.y) === room);
}
// blockOnly : pour une zone de dégagement, seuls les meubles gênent (une porte
// peut s'ouvrir dans le dégagement d'un meuble)
function _free(ctx, P, spec, blockOnly) {
  for (const o of ctx.obstacles) {
    if (blockOnly && o.kind !== 'block') continue;
    if (o.kind === 'window' && !(spec && spec.tall)) continue;
    if (_overlap(P, o.poly)) return false;
  }
  return true;
}

// Rotation d'un meuble dont le dos (côté local -y) s'appuie contre un mur de
// normale n (orientée vers la pièce), et d'un appareil mural dont la
// « tige » (côté local -y) pointe vers la pièce.
function _rotBack(nx, ny) { return _deg(Math.atan2(-nx, ny)); }
function _rotDevice(nx, ny) { return _deg(Math.atan2(nx, -ny)); }

// Pose d'un meuble contre un mur de la pièce (meilleur emplacement libre)
function _placeWall(ctx, room, type, spec, ref) {
  const b = SYMBOLS[type].bbox;
  const hw = b.w / 2, back = -b.y;
  let best = null;
  for (const run of ctx.runs) {
    if (run.room !== room) continue;
    const mid = (run.t0 + run.t1) / 2;
    const rot = _rotBack(run.nx, run.ny);
    for (let t = run.t0 + hw; t <= run.t1 - hw + 0.1; t += 10) {
      const wx = run.ax + run.ux * t, wy = run.ay + run.uy * t;
      const cx = wx + run.nx * (WALL_BACK + back), cy = wy + run.ny * (WALL_BACK + back);
      const c = { type, x: cx, y: cy, rot };
      const P = _footprint(c, 0);
      if (!_polyInRoom(ctx, P, room) || !_free(ctx, P, spec)) continue;
      const cl = _clearance(c, spec);
      if (cl && !_free(ctx, cl, { tall: false }, true)) continue;
      let score;
      const endGap = Math.min(t - hw - run.t0, run.t1 - t - hw);
      switch (spec.pref) {
        case 'corner': score = endGap; break;
        case 'adjacent': score = ref ? _polyDist(P, _footprint(ref, 0)) * 2 + endGap * 0.05 : endGap; break;
        case 'window': {
          let dw = Infinity;
          for (const w of ctx.windows) {
            if (_segDist(w.x, w.y, { x: wx - run.ux * 200, y: wy - run.uy * 200 }, { x: wx + run.ux * 200, y: wy + run.uy * 200 }) > 14) continue;
            dw = Math.min(dw, Math.hypot(w.x - wx, w.y - wy));
          }
          score = dw === Infinity ? 400 + Math.abs(t - mid) : dw;
          break;
        }
        case 'farDoor': {
          let dd = Infinity;
          for (const d of ctx.doors) dd = Math.min(dd, Math.hypot(d.x - cx, d.y - cy));
          score = -Math.min(dd, 600) + Math.abs(t - mid) * 0.3 - (run.t1 - run.t0) * 0.05;
          break;
        }
        case 'near': score = ref ? Math.hypot(ref.x - cx, ref.y - cy) : Math.abs(t - mid); break;
        default: score = Math.abs(t - mid) - (run.t1 - run.t0) * 0.15;
      }
      if (!best || score < best.score - 1e-6) best = { score, x: cx, y: cy, rot };
    }
  }
  return best;
}

// Pose libre (table) : au plus près du centre de la pièce
function _placeFree(ctx, room, type, spec, rots, target) {
  const cen = _roomCentroid(ctx.info, room);
  if (!cen) return null;
  const aim = target || cen, step = spec.step || 20;
  let best = null;
  for (let y = cen.minY; y <= cen.maxY; y += step) {
    for (let x = cen.minX; x <= cen.maxX; x += step) {
      for (const rot of rots) {
        const c = { type, x, y, rot };
        const P = _footprint(c, 0), G = _footprint(c, spec.grow || 0);
        if (!_polyInRoom(ctx, G, room) || !_free(ctx, G, spec)) continue;
        if (!_polyInRoom(ctx, P, room)) continue;
        const score = Math.hypot(x - aim.x, y - aim.y);
        if (!best || score < best.score) best = { score, x, y, rot };
      }
    }
  }
  return best;
}

// Meuble une pièce avec une liste d'éléments ; renvoie ceux qui n'ont pas pu être posés
function _furnishRoom(ctx, room, items) {
  const doc = ctx.doc, missed = [];
  const last = {};
  for (const type of items) {
    const spec = FURN[type] || { pref: 'center' };
    let spot = null;
    if (spec.mode === 'free') {
      spot = _placeFree(ctx, room, type, spec, [0, 90]);
    } else if (spec.mode === 'facing') {
      const tv = doc.components.find((c) => c.type === 'tv_unit' && roomAt(ctx.info, c.x, c.y) === room);
      if (tv) {
        const n = _rot(0, 1, tv.rot);
        for (const d of [270, 250, 290, 230, 310, 330, 210]) {
          const c = { type, x: tv.x + n.x * d, y: tv.y + n.y * d, rot: (tv.rot + 180) % 360 };
          const P = _footprint(c, 0);
          if (_polyInRoom(ctx, P, room) && _free(ctx, P, spec) && _free(ctx, _clearance(c, spec), spec, true)) { spot = c; break; }
        }
      }
      if (!spot) spot = _placeWall(ctx, room, type, { ...spec, pref: 'center' });
    } else if (spec.mode === 'car') {
      const gd = ctx.doors.find((d) => d.c.type === 'garage_door' && roomAt(ctx.info, d.x + _rot(0, 40, d.rot).x, d.y + _rot(0, 40, d.rot).y) === room)
        || ctx.doors.find((d) => d.c.type === 'garage_door');
      const cen = _roomCentroid(ctx.info, room);
      let rots = [0, 90];
      if (gd && cen) {
        // stationnement en marche avant : l'avant regarde le fond du garage
        const r = _deg(Math.atan2(cen.x - gd.x, gd.y - cen.y));
        rots = [Math.round(r / 90) * 90 % 360];
      }
      spot = _placeFree(ctx, room, type, { grow: 15, step: 10 }, rots);
    } else {
      let ref = null;
      if (spec.group) ref = last[spec.group] || null;
      if (type === 'ev_charger') {
        const car = doc.components.find((c) => c.type === 'car' && roomAt(ctx.info, c.x, c.y) === room);
        if (car) { const f = _rot(0, -150, car.rot); ref = { x: car.x + f.x, y: car.y + f.y }; }
      }
      spot = _placeWall(ctx, room, type, ref || spec.pref !== 'adjacent' ? spec : { ...spec, pref: 'corner' }, ref);
    }
    if (!spot) { missed.push(type); continue; }
    const c = _addComp(doc, type, spot.x, spot.y, spot.rot, type === 'radiator' ? spot.value : '');
    _registerObstacle(ctx, c);
    if (spec.group) last[spec.group] = c;
  }
  return missed;
}

// ---------------------------------------------------------------------------
// Génération d'un type de maison
// ---------------------------------------------------------------------------
// Murs à partir des rectangles des pièces : arêtes fusionnées ligne par ligne,
// classées extérieur / intérieur, percées aux portes.
function _wallsFromRooms(rects, openings) {
  const H = new Map(), V = new Map();
  const add = (map, k, a, b) => { if (!map.has(k)) map.set(k, []); map.get(k).push([Math.min(a, b), Math.max(a, b)]); };
  for (const [x0, y0, x1, y1] of rects) { add(H, y0, x0, x1); add(H, y1, x0, x1); add(V, x0, y0, y1); add(V, x1, y0, y1); }
  const inside = (x, y) => rects.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1);
  const walls = [];
  const line = (horiz, k, list) => {
    list.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const iv of list) {
      const m = merged[merged.length - 1];
      if (m && iv[0] <= m[1]) m[1] = Math.max(m[1], iv[1]); else merged.push([...iv]);
    }
    for (const [a, b] of merged) {
      const cuts = new Set([a, b]);
      for (const r of rects) for (const v of horiz ? [r[0], r[2]] : [r[1], r[3]]) if (v > a && v < b) cuts.add(v);
      for (const o of openings) {
        if (o.horiz !== horiz || o.k !== k) continue;
        for (const v of [o.c - o.half, o.c + o.half]) if (v > a && v < b) cuts.add(v);
      }
      const xs = [...cuts].sort((p, q) => p - q);
      let cur = null;
      for (let i = 0; i < xs.length - 1; i++) {
        const m = (xs[i] + xs[i + 1]) / 2;
        const open = openings.some((o) => o.horiz === horiz && o.k === k && m > o.c - o.half && m < o.c + o.half);
        const ext = horiz ? !(inside(m, k - 1) && inside(m, k + 1)) : !(inside(k - 1, m) && inside(k + 1, m));
        if (!open && cur && cur.ext === ext) { cur.b = xs[i + 1]; continue; }
        if (cur) walls.push(cur);
        cur = open ? null : { a: xs[i], b: xs[i + 1], ext };
      }
      if (cur) walls.push(cur);
      walls.forEach((w) => { if (w.k === undefined) { w.k = k; w.horiz = horiz; } });
    }
  };
  for (const [k, list] of H) line(true, k, list);
  for (const [k, list] of V) line(false, k, list);
  return walls.map((w) => ({
    kind: 'wall', ext: w.ext,
    points: w.horiz ? [{ x: w.a, y: w.k }, { x: w.b, y: w.k }] : [{ x: w.k, y: w.a }, { x: w.k, y: w.b }],
  }));
}

function _onHorizontalEdge(rects, x, y) {
  return rects.some(([x0, y0, x1, y1]) => (y === y0 || y === y1) && x > x0 && x < x1);
}

function buildHouse(key, opts) {
  opts = Object.assign({ furnish: true, elec: true, conduits: true, heating: true }, opts || {});
  const T = HOUSE_TYPES.find((h) => h.key === key);
  if (!T) return null;
  const rects = T.rooms.map((r) => r.r);
  const doc = { version: 1, meta: { title: T.name, author: 'ÉlectriCAD' }, components: [], wires: [], counters: {} };

  const openings = T.doors.map(([x, y, , kind]) => {
    const horiz = _onHorizontalEdge(rects, x, y);
    return { horiz, k: horiz ? y : x, c: horiz ? x : y, half: kind === 'garage' ? 120 : 40, x, y };
  });
  for (const w of _wallsFromRooms(rects, openings)) { w.id = _uid(doc, 'w'); doc.wires.push(w); }

  // Étiquettes de pièces
  for (const r of T.rooms) {
    const [x0, y0, x1, y1] = r.r;
    const [lx, ly] = r.label || [(x0 + x1) / 2, (y0 + y1) / 2];
    _addComp(doc, 'room', lx, ly, 0, r.name);
  }
  // Portes (ouvertes vers la pièce indiquée) et fenêtres
  T.doors.forEach(([x, y, into, kind], i) => {
    const o = openings[i];
    const room = T.rooms.find((r) => r.name === into);
    const [x0, y0, x1, y1] = room.r, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (kind === 'garage') { _addComp(doc, 'garage_door', x, y, o.horiz ? 0 : 90); return; }
    const rot = o.horiz ? (cy < y ? 0 : 180) : (cx > x ? 90 : 270);
    _addComp(doc, 'door', x, y, rot);
  });
  for (const [x, y] of T.windows) _addComp(doc, 'window_a', x, y, _onHorizontalEdge(rects, x, y) ? 0 : 90);
  // Maison à étage : niveaux (dessinés côte à côte), titres et escalier
  if (T.levels) {
    doc.meta.levels = T.levels.map((l) => ({ ...l }));
    const y0 = Math.min(...rects.map((r) => r[1]));
    for (const l of T.levels) {
      const xs = rects.filter((r) => r[0] >= l.x0 && r[2] <= l.x1);
      const cx = (Math.min(...xs.map((r) => r[0])) + Math.max(...xs.map((r) => r[2]))) / 2;
      _addComp(doc, 'level_title', cx, y0 - 130, 0, l.name);
    }
    for (const [x, y, rot, v] of T.stairs || []) _addComp(doc, 'stairs', x, y, rot, v);
  }

  const missed = [];
  buildHouse.lastMissed = missed;
  // La GTL et le tableau d'abord : ils ont besoin d'un pan de mur libre près de l'entrée
  if (opts.elec) _implantGTL(_planContext(doc));
  if (opts.furnish) {
    const ctx = _planContext(doc);
    for (const r of T.rooms) {
      const lab = doc.components.find((c) => c.type === 'room' && c.value === r.name);
      const idx = ctx.info.rooms.findIndex((x) => x.id === lab.id);
      if (idx >= 0) for (const m of _furnishRoom(ctx, idx, r.items)) missed.push(r.name + ' : ' + SYMBOLS[m].name);
    }
  }
  if (opts.elec) autoImplant(doc, { heating: opts.heating });
  if (opts.elec && opts.conduits) autoConduits(doc);
  return _clean(doc);
}

// Meuble les pièces qui n'ont encore aucun meuble (plan dessiné à la main)
function furnishPlan(doc) {
  const ctx = _planContext(doc);
  const report = { rooms: 0, placed: 0, missed: [] };
  const hasType = (t) => ctx.info.rooms.some((r) => r.type && r.type.key === t && _roomOk(ctx.info, ctx.info.rooms.indexOf(r)));
  ctx.info.rooms.forEach((room, i) => {
    if (!_roomOk(ctx.info, i) || !room.type) return;
    const furnished = doc.components.some((c) => FURN[c.type] && !['radiator', 'gtl', 'panel_house'].includes(c.type) && roomAt(ctx.info, c.x, c.y) === i);
    if (furnished) return;
    let items = (FURNITURE_BY_TYPE[room.type.key] || []).slice();
    // Lave-linge : buanderie > salle de bains > cuisine
    if (room.type.key === 'sdb' && !hasType('annexe')) items.push('washer');
    if (room.type.key === 'sdb' && !hasType('wc')) items.push('toilet');
    if (room.type.key === 'cuisine' && !hasType('annexe') && !hasType('sdb')) items.push('washer');
    const before = doc.components.length;
    const missed = _furnishRoom(ctx, i, items);
    report.rooms++;
    report.placed += doc.components.length - before;
    for (const m of missed) report.missed.push(`${SYMBOLS[m].name} (${room.name})`);
  });
  _clean(doc);
  return report;
}

// ---------------------------------------------------------------------------
// Implantation électrique automatique
// ---------------------------------------------------------------------------
const LIGHT_TYPES = new Set(['dcl', 'wall_light']);
const SWITCH_TYPES = new Set(['switch_sa', 'switch_vv_wall']);
const HEATED = { sejour: 1, chambre: 1, bureau: 1, cuisine: 1, sdb: 1, circ: 1 };

// Emplacements muraux candidats d'une pièce (à 20 cm de l'axe du mur)
function _wallSpots(ctx, room) {
  const out = [];
  for (const run of ctx.runs) {
    if (run.room !== room) continue;
    for (let t = run.t0 + 15; t <= run.t1 - 15; t += 10) {
      const x = run.ax + run.ux * t + run.nx * DEVICE_OFF, y = run.ay + run.uy * t + run.ny * DEVICE_OFF;
      out.push({ x, y, nx: run.nx, ny: run.ny, wx: run.ax + run.ux * t, wy: run.ay + run.uy * t, ux: run.ux, uy: run.uy });
    }
  }
  return out;
}

// Un appareil mural peut-il aller en p ?  mode : 'outlet' | 'worktop' | 'radiator'
function _spotOk(ctx, room, p, mode) {
  if (_ownerAt(ctx.info, p.x, p.y) !== room) return false;
  for (const d of ctx.doors) if (Math.hypot(d.x - p.x, d.y - p.y) < d.half + 28) return false;
  if (mode !== 'radiator') for (const w of ctx.windows) if (Math.hypot(w.x - p.x, w.y - p.y) < 50) return false;
  for (const o of ctx.obstacles) {
    if (o.kind !== 'block' || !BLOCKS_OUTLET.has(o.type)) continue;
    if (mode === 'worktop' && o.type === 'counter') continue;
    if (_inPoly(o.poly, p.x, p.y)) return false;
  }
  for (const d of ctx.devices) if (Math.hypot(d.x - p.x, d.y - p.y) < 28) return false;
  return !_inWetZone(ctx, room, p);
}
// Volume 2 d'une douche ou d'une baignoire : 60 cm autour, dans la même pièce
function _inWetZone(ctx, room, p) {
  return ctx.doc.components.some((b) => (b.type === 'shower' || b.type === 'bathtub') &&
    roomAt(ctx.info, b.x, b.y) === room && _distToFootprint(p.x, p.y, b) < 62);
}
const _BOXED_T = typeof STUD_BOXED !== 'undefined' ? STUD_BOXED : new Set(['socket_wall', 'switch_sa', 'switch_vv_wall', 'rj45', 'wall_light']);
function _addDevice(ctx, type, x, y, rot, value) {
  // cloison sèche : la boîte d'encastrement ne tombe pas sur un montant (décalage de quelques cm)
  if (_BOXED_T.has(type) && typeof studShift === 'function') {
    const nw = nearestWall(ctx.doc.wires, x, y, 60);
    if (nw && wallMaterial(nw.w).hollow) {
      const sh = studShift(nw.t, Math.hypot(nw.b.x - nw.a.x, nw.b.y - nw.a.y));
      if (sh) { x += nw.ux * (sh.t - nw.t); y += nw.uy * (sh.t - nw.t); }
    }
  }
  const c = _addComp(ctx.doc, type, x, y, rot, value);
  ctx.devices.push({ x: c.x, y: c.y, type });
  return c;
}
// Répartition la plus homogène possible (tirage du point le plus éloigné)
function _spread(spots, k, seeds, minGap) {
  const picked = [];
  const pts = seeds.slice();
  for (let n = 0; n < k; n++) {
    let best = null, bd = -1;
    for (const s of spots) {
      let d = Infinity;
      for (const p of pts) d = Math.min(d, Math.hypot(p.x - s.x, p.y - s.y));
      if (!pts.length) d = 1e6 - Math.hypot(s.x, s.y) * 1e-3;
      if (d > bd) { bd = d; best = s; }
    }
    if (!best || (pts.length && bd < (minGap || 60))) break;
    picked.push(best); pts.push(best);
  }
  return picked;
}
function _nearestSpot(spots, x, y, maxD) {
  let best = null, bd = maxD || Infinity;
  for (const s of spots) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
  return best;
}
// Emplacement d'un point au plafond (évite les points déjà posés)
function _ceilingSpot(ctx, room, x, y) {
  for (const [dx, dy] of [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60], [60, 60], [-60, -60]]) {
    const p = { x: Math.round((x + dx) / 10) * 10, y: Math.round((y + dy) / 10) * 10 };
    if (_ownerAt(ctx.info, p.x, p.y) !== room) continue;
    if (ctx.devices.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 40)) continue;
    return p;
  }
  return _nearestInRoom(ctx.info, room, x, y);
}

// Compléter l'éclairage : appliques dans les pièces sous l'éclairement conseillé
// (étude lightingStudy d'install.js). En cuisine, d'abord au-dessus du plan de
// travail ; ailleurs, loin des points lumineux existants. Trois au plus par pièce.
function autoLighting(doc) {
  const study = lightingStudy(doc.components, doc.wires);
  if (!study) return { added: 0, rooms: [] };
  const ctx = _planContext(doc);
  let added = 0;
  const rooms = [];
  for (const R of study.rooms) {
    if (R.status === 'ok' || !_roomOk(ctx.info, R.i)) continue;
    const lights = doc.components.filter((c) => LIGHT_TYPES.has(c.type) && roomAt(ctx.info, c.x, c.y) === R.i).map((c) => ({ x: c.x, y: c.y }));
    const spots = _wallSpots(ctx, R.i);
    const pools = [];
    if (R.key === 'cuisine') {
      const tops = ctx.obstacles.filter((o) => o.kind === 'block' && o.type === 'counter');
      pools.push(spots.filter((p) => tops.some((o) => _inPoly(o.poly, p.x, p.y)) && _spotOk(ctx, R.i, p, 'worktop')));
    }
    pools.push(spots.filter((p) => _spotOk(ctx, R.i, p, 'outlet')));
    // une applique à la fois, jusqu'à l'objectif (l'étude est refaite à chaque pose)
    let n = 0;
    for (; n < 3; n++) {
      let p = null;
      for (const pool of pools) if (!p) [p] = _spread(pool, 1, lights, 90);
      if (!p) break;
      _addDevice(ctx, 'wall_light', p.x, p.y, _rotDevice(p.nx, p.ny));
      lights.push(p);
      const now = lightingStudy(doc.components, doc.wires).rooms.find((x) => x.id === R.id);
      if (!now || now.status === 'ok') { n++; break; }
    }
    if (n) { added += n; rooms.push(R.name); }
  }
  _clean(doc);
  return { added, rooms };
}

function autoImplant(doc, opts) {
  opts = Object.assign({ heating: true }, opts || {});
  const ctx = _planContext(doc);
  const info = ctx.info;
  const count0 = doc.components.length;
  const roomsOk = info.rooms.map((r, i) => _roomOk(info, i));
  const typeOf = (i) => (info.rooms[i].type ? info.rooms[i].type.key : null);
  const inRoom = (c) => roomAt(info, c.x, c.y);
  const doorsOf = (room) => ctx.doors.filter((d) => {
    for (const s of [1, -1]) {
      const q = _rot(0, s * 30, d.rot);
      if (_ownerAt(info, d.x + q.x, d.y + q.y) === room) return true;
    }
    return false;
  });
  const exterior = (d) => [1, -1].some((s) => {
    const q = _rot(0, s * 40, d.rot);
    return _ownerAt(info, d.x + q.x, d.y + q.y) < 0;
  });

  // 1. GTL + tableau près de la porte d'entrée
  _implantGTL(ctx);

  info.rooms.forEach((room, i) => {
    if (!roomsOk[i]) return;
    const t = typeOf(i);
    const spots = _wallSpots(ctx, i);
    const cen = _roomCentroid(info, i);
    const have = (set) => doc.components.filter((c) => set.has(c.type) && inRoom(c) === i).length;

    // 2. Éclairage : DCL au centre (deux pour un grand séjour ou un long couloir)
    if (!have(LIGHT_TYPES)) {
      const w = cen.maxX - cen.minX, h = cen.maxY - cen.minY;
      const two = (t === 'sejour' && room.area > 28) || Math.max(w, h) > 2.4 * Math.min(w, h) && Math.max(w, h) > 400;
      const pts = two
        ? (w >= h ? [[cen.x - w / 4, cen.y], [cen.x + w / 4, cen.y]] : [[cen.x, cen.y - h / 4], [cen.x, cen.y + h / 4]])
        : [[cen.x, cen.y]];
      for (const [x, y] of pts) { const p = _ceilingSpot(ctx, i, x, y); if (p) _addDevice(ctx, 'dcl', p.x, p.y, 0); }
      // applique au-dessus du lavabo
      const basin = doc.components.find((c) => c.type === 'washbasin' && inRoom(c) === i);
      if (basin) {
        const n = _rot(0, 1, basin.rot), back = -SYMBOLS.washbasin.bbox.y + WALL_BACK;
        _addDevice(ctx, 'wall_light', basin.x - n.x * (back - DEVICE_OFF), basin.y - n.y * (back - DEVICE_OFF), _rotDevice(n.x, n.y));
      }
    }

    // 3. Commandes : un interrupteur à chaque porte (va-et-vient s'il y en a plusieurs)
    const ownSwitch = doc.components.some((c) => SWITCH_TYPES.has(c.type) &&
      (c.ctrl ? c.ctrl === room.id : inRoom(c) === i));
    if (!ownSwitch) {
      let ds = doorsOf(i).filter((d) => d.c.type === 'door');
      ds.sort((a, b) => (exterior(b) ? 1 : 0) - (exterior(a) ? 1 : 0));
      if (t === 'wc' || t === 'sdb' || t === 'dressing' || t === 'annexe') ds = ds.slice(0, 1);
      ds = ds.slice(0, 3);
      const type = ds.length > 1 ? 'switch_vv_wall' : 'switch_sa';
      for (const d of ds) _switchAtDoor(ctx, i, d, type);
    }

    // 4. Chauffage : radiateurs sous les fenêtres (~80 W/m²)
    if (opts.heating && HEATED[t] && room.area > 3 && !have(new Set(['radiator']))) {
      const power = room.area * (t === 'sdb' ? 110 : 80);
      const n = Math.max(1, Math.ceil(power / 1500));
      const each = Math.max(500, Math.ceil(power / n / 250) * 250);
      for (let k = 0; k < n; k++) {
        const spot = _placeWall(ctx, i, 'radiator', { pref: 'window' });
        if (!spot) break;
        const c = _addComp(doc, 'radiator', spot.x, spot.y, spot.rot, each + ' W');
        _registerObstacle(ctx, c);
      }
    }
    // 5. Prises de courant
    const need = t ? room.type.sockets(room.area) : 1;
    let placed = have(new Set(['socket_wall']));
    const put = (s) => { placed++; return _addDevice(ctx, 'socket_wall', s.x, s.y, _rotDevice(s.nx, s.ny)); };
    // plan de travail : 4 prises en cuisine (2 ailleurs), jamais au-dessus de la plaque ni de l'évier
    const counters = doc.components.filter((c) => c.type === 'counter' && inRoom(c) === i);
    if (counters.length) {
      const top = spots.filter((s) => _spotOk(ctx, i, s, 'worktop') && counters.some((c) => {
        if (!_inPoly(_footprint(c, 0), s.x, s.y)) return false;
        const l = _rot(s.x - c.x, s.y - c.y, -c.rot);
        return l.x > -20 || l.x < -80; // hors de la cuve
      }));
      const want = t === 'cuisine' ? 4 : 2;
      let pick = _spread(top, want, [], t === 'cuisine' ? 20 : 40);
      if (pick.length < want && t === 'cuisine') pick = _spread(top, want, [], 10); // plan de travail court : prises jumelées
      for (const s of pick) put(s).h = 110; // au-dessus du plan de travail
    }
    // appareils branchés sur prise : une prise à portée
    for (const c of doc.components) {
      if (inRoom(c) !== i || !['fridge', 'tv_unit', 'desk'].includes(c.type)) continue;
      const b = SYMBOLS[c.type].bbox;
      const corner = _rot(b.x + b.w + 20, b.y, c.rot);
      const s = _nearestSpot(spots.filter((p) => _spotOk(ctx, i, p) || (c.type === 'fridge' && _inPoly(_footprint(c, 0), p.x, p.y))), c.x + corner.x, c.y + corner.y, 160);
      if (s) put(s);
    }
    // de part et d'autre de la tête de lit
    for (const bed of doc.components.filter((c) => c.type === 'bed' && inRoom(c) === i)) {
      for (const sx of [-1, 1]) {
        if (placed >= Math.max(need, 2)) break;
        const q = _rot(sx * 80, -80, bed.rot);
        const s = _nearestSpot(spots.filter((p) => _spotOk(ctx, i, p)), bed.x + q.x, bed.y + q.y, 70);
        if (s) put(s);
      }
    }
    if (placed < need) {
      const seeds = doc.components.filter((c) => c.type === 'socket_wall' && inRoom(c) === i).map((c) => ({ x: c.x, y: c.y }))
        .concat(doorsOf(i).map((d) => ({ x: d.x, y: d.y })));
      for (const s of _spread(spots.filter((p) => _spotOk(ctx, i, p)), need - placed, seeds, 60)) put(s);
    }

    // 6. Communication : RJ45 dans le séjour, les chambres et le bureau
    if ((t === 'sejour' || t === 'chambre' || t === 'bureau') && !have(new Set(['rj45']))) {
      const anchor = doc.components.find((c) => (c.type === 'tv_unit' || c.type === 'desk') && inRoom(c) === i);
      const ok = spots.filter((p) => _spotOk(ctx, i, p));
      const s = anchor ? _nearestSpot(ok, anchor.x, anchor.y, 300) : _spread(ok, 1, doorsOf(i).map((d) => ({ x: d.x, y: d.y })), 0)[0];
      if (s) _addDevice(ctx, 'rj45', s.x, s.y, _rotDevice(s.nx, s.ny));
    }

  });

  // 7. Sécurité et ventilation : DAAF en circulation, VMC dans une pièce d'eau
  if (!doc.components.some((c) => c.type === 'smoke_detector')) {
    const circ = info.rooms.map((r, i) => i).filter((i) => roomsOk[i] && typeOf(i) === 'circ');
    // sans circulation : le séjour, sinon la pièce de vie la plus proche (jamais une pièce d'eau)
    const order = ['sejour', 'cuisine', 'bureau', 'chambre'];
    const targets = circ.length ? circ : info.rooms.map((r, i) => i)
      .filter((i) => roomsOk[i] && order.includes(typeOf(i)))
      .sort((a, b) => order.indexOf(typeOf(a)) - order.indexOf(typeOf(b))).slice(0, 1);
    for (const i of targets) {
      const cen = _roomCentroid(info, i);
      const p = _ceilingSpot(ctx, i, cen.x + 50, cen.y);
      if (p) _addComp(doc, 'smoke_detector', p.x, p.y, 0);
    }
  }
  if (!doc.components.some((c) => c.type === 'vmc')) {
    const wet = ['sdb', 'wc', 'cuisine'].map((k) => info.rooms.findIndex((r, i) => roomsOk[i] && typeOf(i) === k)).find((i) => i >= 0);
    if (wet !== undefined) {
      const cen = _roomCentroid(info, wet);
      const p = _ceilingSpot(ctx, wet, cen.x, cen.y + 45);
      if (p) _addDevice(ctx, 'vmc', p.x, p.y, 0);
    }
  }
  _clean(doc);
  return { added: doc.components.length - count0 };
}

// Pièces triées pour recevoir la GTL : celle de la porte d'entrée, puis les
// circulations, puis les autres
function _implantGTL(ctx) {
  const doc = ctx.doc, info = ctx.info;
  if (doc.components.some((c) => c.type === 'gtl')) return;
  const ok = info.rooms.map((r, i) => i).filter((i) => _roomOk(info, i));
  const side = (d, s) => { const q = _rot(0, s * 40, d.rot); return _ownerAt(info, d.x + q.x, d.y + q.y); };
  const entry = ctx.doors.find((d) => d.c.type === 'door' && (side(d, 1) < 0 || side(d, -1) < 0));
  const entryRoom = entry ? Math.max(side(entry, 1), side(entry, -1)) : -1;
  const rank = (i) => (i === entryRoom ? 0 : info.rooms[i].type && info.rooms[i].type.key === 'circ' ? 1 : 2);
  ok.sort((a, b) => rank(a) - rank(b));
  // l'entrée (même tableau logé dans la GTL) passe avant toute autre pièce
  for (const room of ok) {
    for (const pass of ['side', 'stacked']) {
      if (_placeGTL(ctx, room, entry || _roomCentroid(info, room), pass)) return;
    }
  }
}

// GTL (colonne de 1,20 m le long du mur) et tableau juste à côté — ou, faute
// de place, dans la GTL elle-même (pass 'stacked')
function _placeGTL(ctx, room, ref, pass) {
  if (pass === 'stacked') return _placeGTLStacked(ctx, room, ref);
  let best = null;
  for (const run of ctx.runs) {
    if (run.room !== room) continue;
    for (let t = run.t0 + 60; t <= run.t1 - 60 - 110; t += 10) {
      for (const dir of [1, -1]) {
        const tg = t + (dir < 0 ? 110 : 0);
        const tt = tg + dir * 106;
        if (tt - 36 < run.t0 || tt + 36 > run.t1) continue;
        const gx = run.ax + run.ux * tg + run.nx * (WALL_BACK + 20), gy = run.ay + run.uy * tg + run.ny * (WALL_BACK + 20);
        const g = { type: 'gtl', x: gx, y: gy, rot: _rotBack(run.nx, run.ny) + 90 };
        const tx = run.ax + run.ux * tt + run.nx * (WALL_BACK + 26), ty = run.ay + run.uy * tt + run.ny * (WALL_BACK + 26);
        const tb = { type: 'panel_house', x: tx, y: ty, rot: _rotBack(run.nx, run.ny) };
        const PG = _footprint(g, 0), PT = _footprint(tb, 0);
        if (!_polyInRoom(ctx, PG, room) || !_polyInRoom(ctx, PT, room)) continue;
        if (!_free(ctx, PG, { tall: true }) || !_free(ctx, PT, { tall: true })) continue;
        const score = Math.hypot(ref.x - gx, ref.y - gy);
        if (!best || score < best.score) best = { score, g, tb };
      }
    }
  }
  return best && _commitGTL(ctx, best);
}
function _placeGTLStacked(ctx, room, ref) {
  let best = null;
  for (const run of ctx.runs) {
    if (run.room !== room) continue;
    for (let t = run.t0 + 60; t <= run.t1 - 60; t += 10) {
      const rot = _rotBack(run.nx, run.ny);
      const at = (d) => ({ x: run.ax + run.ux * t + run.nx * (WALL_BACK + d), y: run.ay + run.uy * t + run.ny * (WALL_BACK + d) });
      const g = { type: 'gtl', ...at(20), rot: rot + 90 }, tb = { type: 'panel_house', ...at(34), rot };
      const PG = _footprint(g, 0);
      if (!_polyInRoom(ctx, PG, room) || !_free(ctx, PG, { tall: true })) continue;
      const score = Math.hypot(ref.x - g.x, ref.y - g.y);
      if (!best || score < best.score) best = { score, g, tb };
    }
  }
  return best && _commitGTL(ctx, best);
}
function _commitGTL(ctx, best) {
  for (const c of [best.g, best.tb]) {
    const comp = _addComp(ctx.doc, c.type, c.x, c.y, c.rot);
    _registerObstacle(ctx, comp);
  }
  return best;
}

// Interrupteur côté poignée (sinon côté paumelles), sur le mur, dans la pièce ;
// pour une pièce d'eau où tout est en volume 2, juste à l'extérieur de la porte
// (le champ ctrl désigne alors la pièce commandée).
function _switchAtDoor(ctx, room, d, type) {
  let side = 0;
  for (const s of [1, -1]) {
    const q = _rot(0, s * 30, d.rot);
    if (_ownerAt(ctx.info, d.x + q.x, d.y + q.y) === room) { side = s; break; }
  }
  if (!side) return null;
  const inside = _switchOnSide(ctx, room, d, type, side);
  if (inside) return inside;
  const q = _rot(0, -side * 30, d.rot);
  const other = _ownerAt(ctx.info, d.x + q.x, d.y + q.y);
  if (!_roomOk(ctx.info, other)) return null;
  const c = _switchOnSide(ctx, other, d, type, -side);
  if (c) c.ctrl = ctx.info.rooms[room].id;
  return c;
}
function _switchOnSide(ctx, room, d, type, side) {
  const n = _rot(0, side, d.rot);
  const walls = ctx.doc.wires.filter((w) => w.kind === 'wall');
  for (const along of [55, -55, 70, -70, 90, -90, 115, -115, 140, -140]) {
    const a = _rot(along, 0, d.rot);
    const sx = d.x + a.x, sy = d.y + a.y;
    const onWall = walls.some((w) => w.points.some((p, k) => k < w.points.length - 1 && _segDist(sx, sy, p, w.points[k + 1]) < 3));
    if (!onWall) continue;
    const p = { x: sx + n.x * DEVICE_OFF, y: sy + n.y * DEVICE_OFF };
    if (_ownerAt(ctx.info, p.x, p.y) !== room) continue;
    if (ctx.obstacles.some((o) => o.kind === 'block' && BLOCKS_OUTLET.has(o.type) && _inPoly(o.poly, p.x, p.y))) continue;
    if (ctx.devices.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 25)) continue;
    if (_inWetZone(ctx, room, p)) continue;
    return _addDevice(ctx, type, p.x, p.y, _rotDevice(n.x, n.y));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Goulottes automatiques
// ---------------------------------------------------------------------------
// Appareils raccordés au tableau (le DAAF est autonome, la prise RJ45 part du
// tableau de communication voisin : elle suit les mêmes goulottes).
const WIRED_TYPES = new Set([
  'socket_wall', 'switch_sa', 'switch_vv_wall', 'dcl', 'wall_light', 'rj45', 'vmc', 'oven', 'cooktop', 'washer',
  'dishwasher', 'dryer', 'water_heater', 'radiator', 'ev_charger',
]);
const CEILING_TYPES = new Set(['dcl', 'vmc']);

function _rasterize(info, segs, R) {
  const S = info.step, grid = new Uint8Array(info.nx * info.ny);
  for (const [a, b] of segs) {
    const gx0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R - info.x0) / S));
    const gx1 = Math.min(info.nx - 1, Math.ceil((Math.max(a.x, b.x) + R - info.x0) / S));
    const gy0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - R - info.y0) / S));
    const gy1 = Math.min(info.ny - 1, Math.ceil((Math.max(a.y, b.y) + R - info.y0) / S));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (_segDist(info.x0 + gx * S, info.y0 + gy * S, a, b) < R) grid[gy * info.nx + gx] = 1;
      }
    }
  }
  return grid;
}

// Tas binaire minimal (clé = coût)
class _Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], topK = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    this.lastKey = topK;
    return top;
  }
}

function autoConduits(doc) {
  const info = computeRooms(doc.components, doc.wires);
  const tb = doc.components.find((c) => c.type === 'panel_house');
  if (!tb || !info.owner) return { conduits: 0, length: 0 };
  doc.wires = doc.wires.filter((w) => w.kind !== 'conduit');
  const { nx, ny, step: S, x0, y0, owner } = info;
  const N = nx * ny;
  const wallSegs = [];
  for (const w of doc.wires) if (w.kind === 'wall') for (let i = 0; i < w.points.length - 1; i++) wallSegs.push([w.points[i], w.points[i + 1]]);
  const wallG = _rasterize(info, wallSegs, S * 0.75);
  const barG = _rasterize(info, planBarriers(doc.components, doc.wires), S * 0.75);
  // Coût d'entrée dans chaque case : plinthe 1, milieu de pièce 4, seuil 6, mur percé 40
  const cost = new Float32Array(N).fill(Infinity);
  const plinth = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (owner[k] >= 0 && _roomOk(info, owner[k])) {
      const gx = k % nx;
      const nb = [gx > 0 ? k - 1 : -1, gx < nx - 1 ? k + 1 : -1, k - nx, k + nx];
      plinth[k] = nb.some((m) => m >= 0 && m < N && barG[m]) ? 1 : 0;
      cost[k] = plinth[k] ? 1 : 4;
    } else if (wallG[k]) cost[k] = 40;
    else if (barG[k]) cost[k] = 6;
  }
  const cellOf = (x, y) => {
    const gx = Math.round((x - x0) / S), gy = Math.round((y - y0) / S);
    return gx < 0 || gy < 0 || gx >= nx || gy >= ny ? -1 : gy * nx + gx;
  };
  const cellXY = (k) => ({ x: x0 + (k % nx) * S, y: y0 + Math.floor(k / nx) * S });
  // Case d'arrivée : plinthe la plus proche dans la même pièce (plafond : sur place)
  const targetCell = (c) => {
    const room = roomAt(info, c.x, c.y);
    if (room < 0) return -1;
    const own = cellOf(c.x, c.y);
    if (CEILING_TYPES.has(c.type) && own >= 0 && owner[own] === room) return own;
    let best = -1, bd = Infinity;
    const gx0 = Math.round((c.x - x0) / S), gy0 = Math.round((c.y - y0) / S);
    for (let dy = -7; dy <= 7; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        const gx = gx0 + dx, gy = gy0 + dy;
        if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) continue;
        const k = gy * nx + gx;
        if (owner[k] !== room || !plinth[k]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = k; }
      }
    }
    if (best >= 0) return best;
    return own >= 0 && owner[own] === room ? own : -1;
  };
  const source = targetCell(tb);
  if (source < 0) return { conduits: 0, length: 0 };
  // Tableaux divisionnaires : le tronc principal les rejoint ; les appareils de leur pièce
  // partent d'eux (un arbre de goulottes par TD)
  const tds = doc.components.filter((c) => c.type === 'panel_sub').map((c) => ({ c, cell: targetCell(c), room: roomAt(info, c.x, c.y) })).filter((t) => t.cell >= 0 && t.room >= 0);
  const tdRooms = new Set(tds.map((t) => t.room));
  const all = doc.components.filter((c) => WIRED_TYPES.has(c.type)).map((c) => ({ c, cell: targetCell(c) })).filter((t) => t.cell >= 0);
  const targets = all.filter((t) => !tdRooms.has(roomAt(info, t.c.x, t.c.y))).concat(tds.map((t) => ({ c: t.c, cell: t.cell })));

  // Maison à étage : l'escalier relie les deux plans (colonne montante)
  const RISE = 300; // cm de câble pour monter d'un niveau
  const tele = new Map();
  const lo = doc.components.find((c) => c.type === 'stairs' && c.value !== 'haut');
  const hi = doc.components.find((c) => c.type === 'stairs' && c.value === 'haut');
  if (lo && hi) {
    const a = cellOf(lo.x, lo.y), b = cellOf(hi.x, hi.y);
    if (a >= 0 && b >= 0) { tele.set(a, b); tele.set(b, a); }
  }
  const inTree = new Uint8Array(N);
  inTree[source] = 1;
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  const dist = new Float32Array(N * 4), prev = new Int32Array(N * 4);
  // Plus court chemin depuis l'arbre existant jusqu'à la case « goal »
  const route = (goal) => {
    dist.fill(Infinity); prev.fill(-1);
    const h = new _Heap();
    for (let k = 0; k < N; k++) {
      if (!inTree[k]) continue;
      for (let d = 0; d < 4; d++) { dist[k * 4 + d] = 0; h.push(0, k * 4 + d); }
    }
    while (h.size) {
      const s = h.pop(), dcur = h.lastKey;
      if (dcur > dist[s]) continue;
      const k = s >> 2, dir = s & 3;
      if (k === goal) {
        const cells = [];
        let st = s;
        while (st >= 0) { const kk = st >> 2; if (cells[cells.length - 1] !== kk) cells.push(kk); if (inTree[kk] && prev[st] < 0) break; st = prev[st]; }
        cells.reverse();
        // on repart du dernier point de l'arbre existant (pas de doublon le long du tronc)
        let j = 0;
        for (let i = 0; i < cells.length; i++) if (inTree[cells[i]]) j = i;
        return cells.slice(j);
      }
      const gx = k % nx, gy = (k - gx) / nx;
      for (let d = 0; d < 4; d++) {
        const X = gx + DX[d], Y = gy + DY[d];
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        const m = Y * nx + X;
        let c = inTree[m] ? 0.15 : cost[m];
        if (c === Infinity) continue;
        if (d !== dir) c += 2;
        const nd = dcur + c, ns = m * 4 + d;
        if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = s; h.push(nd, ns); }
      }
      const t = tele.get(k);
      if (t !== undefined) {
        const nd = dcur + (inTree[t] ? 0.15 : RISE / S), ns = t * 4 + dir;
        if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = s; h.push(nd, ns); }
      }
    }
    return null;
  };
  // Ordre : du plus proche au plus éloigné du tableau (le tronc se forme d'abord)
  let count = 0, length = 0;
  const grow = (src, list) => {
  const sx = cellXY(src);
  list.sort((a, b) => {
    const pa = cellXY(a.cell), pb = cellXY(b.cell);
    return Math.hypot(pa.x - sx.x, pa.y - sx.y) - Math.hypot(pb.x - sx.x, pb.y - sx.y);
  });
  for (const t of list) {
    if (inTree[t.cell]) continue;
    const cells = route(t.cell);
    if (!cells || cells.length < 2) continue;
    for (const k of cells) inTree[k] = 1;
    // morceaux de part et d'autre d'un passage par l'escalier (colonne montante)
    const parts = [[]];
    cells.forEach((k, i) => {
      if (i && tele.get(cells[i - 1]) === k) {
        const p = cellXY(cells[i - 1]), q = cellXY(k);
        doc.wires.push({ id: _uid(doc, 'g'), kind: 'conduit', riser: true, len: RISE, points: [p, q] });
        length += RISE;
        parts.push([]);
      }
      parts[parts.length - 1].push(k);
    });
    for (const part of parts) {
      if (part.length < 2) continue;
      // polyligne simplifiée (sommets aux changements de direction)
      const pts = part.map(cellXY);
      const out = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
        if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) out.push(b);
      }
      out.push(pts[pts.length - 1]);
      for (let i = 1; i < out.length; i++) length += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
      doc.wires.push({ id: _uid(doc, 'g'), kind: 'conduit', points: out });
    }
    count++;
  }
  };
  grow(source, targets);
  for (const t of tds) { // arbre propre à chaque TD, dans sa pièce
    inTree.fill(0); inTree[t.cell] = 1;
    grow(t.cell, all.filter((x) => roomAt(info, x.c.x, x.c.y) === t.room));
  }
  _clean(doc);
  return { conduits: count, length: length / PLAN_UNITS_PER_M };
}

// Tableau divisionnaire dans la pièce dont le nom correspond (garage) : sur le mur de sa
// commande d'éclairage, à 70 cm de celle-ci, puis goulottes retracées depuis lui
function addSubPanel(doc, re) {
  const info = computeRooms(doc.components, doc.wires);
  const r = info.rooms.findIndex((x) => re.test(x.name));
  if (r < 0) return null;
  const inR = (c) => roomAt(info, c.x, c.y) === r;
  const ref = doc.components.find((c) => inR(c) && (c.type === 'switch_sa' || c.type === 'switch_vv_wall')) || doc.components.find((c) => inR(c) && c.type === 'socket_wall');
  if (!ref) return null;
  const nw = nearestWall(doc.wires, ref.x, ref.y, 60);
  if (!nw) return null;
  const L = Math.hypot(nw.b.x - nw.a.x, nw.b.y - nw.a.y);
  const t = nw.t + 70 <= L - 30 ? nw.t + 70 : Math.max(30, nw.t - 70);
  const x = nw.a.x + nw.ux * t + nw.nx * nw.d, y = nw.a.y + nw.uy * t + nw.ny * nw.d;
  const td = _addComp(doc, 'panel_sub', x, y, ref.rot || 0);
  if (doc.wires.some((w) => w.kind === 'conduit')) autoConduits(doc); // goulottes retracées depuis le TD
  return td;
}

// Ajoute les maisons générées à la bibliothèque d'exemples
if (typeof EXAMPLES !== 'undefined') {
  for (const [key, level] of [['t3', 'Avancé'], ['t5', 'Expert'], ['r1', 'Expert']]) {
    const T = HOUSE_TYPES.find((h) => h.key === key);
    let cache = null;
    EXAMPLES.push({
      id: 'maison-' + key, name: T.name + ' — tout équipé', level, sim: 'plan', simLabel: 'Plan 2D / 3D',
      desc: T.desc + ' Meublée, implantée et câblée automatiquement : simule le tableau dans l’onglet Installation.',
      get data() { return cache || (cache = buildHouse(key)); },
    });
  }
  let cacheTD = null;
  EXAMPLES.push({
    id: 'maison-t5-td', name: 'Maison T5 + garage — tableau divisionnaire', level: 'Expert', sim: 'plan', simLabel: 'Plan 2D / 3D',
    desc: 'Le garage a son tableau divisionnaire : départ en tête du tableau principal (sous l’AGCP), ses propres ID 30 mA (type F pour la borne de recharge), goulottes depuis le TD. Bouton Tableau : unifilaire et câblage de chaque tableau.',
    get data() { if (!cacheTD) { cacheTD = buildHouse('t5'); addSubPanel(cacheTD, /garage/i); } return cacheTD; },
  });
}
