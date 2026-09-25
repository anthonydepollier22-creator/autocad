/*
 * plan.js — Intelligence du plan de maison.
 *
 *  • computeRooms()   : détecte chaque pièce par remplissage à partir de son
 *                       étiquette, borné par les murs, les seuils de portes et
 *                       les fenêtres ; calcule sa surface (m², à l'axe des murs).
 *  • checkNFC15100()  : contrôle simplifié NF C 15-100 pièce par pièce (nombre
 *                       de prises selon la surface, éclairage et sa commande),
 *                       plus la présence de la GTL et du tableau.
 *  • wallDimensions() : cotations des murs en mètres.
 *
 * Échelle du plan : 100 unités = 1 m (un pas de grille = 20 cm).
 */

const PLAN_UNITS_PER_M = 100;
const ROOM_STEP = 10; // résolution de la détection des pièces (10 cm)

// Types de pièces reconnus d'après le nom de l'étiquette.
// sockets(a) : nombre minimal de socles de prises pour une surface a (m²).
const ROOM_TYPES = [
  {
    key: 'cuisine', re: /cuisine|kitchenette/i, label: 'Cuisine', color: '#34c471', floor: 'tile',
    sockets: (a) => (a > 4 ? 6 : 3), note: 'dont 4 au-dessus du plan de travail',
  },
  {
    key: 'sejour', re: /s[ée]jour|salon|living/i, label: 'Séjour', color: '#ffb454', floor: 'wood',
    sockets: (a) => (a > 28 ? 7 : Math.max(5, Math.ceil(a / 4))), note: '1 par tranche de 4 m², minimum 5',
  },
  { key: 'chambre', re: /chambre/i, label: 'Chambre', color: '#4f9dff', floor: 'wood', sockets: () => 3 },
  {
    key: 'sdb', re: /salle d.?eau|salle de bain|\bsdb\b|douche/i, label: 'Salle d’eau', color: '#6ad7d0', floor: 'tile',
    sockets: () => 1, note: 'hors volumes 0, 1 et 2',
  },
  { key: 'wc', re: /\bwc\b|toilette/i, label: 'WC', color: '#b18aec', floor: 'tile', sockets: () => 0 },
  {
    key: 'circ', re: /entr[ée]e|couloir|d[ée]gagement|hall/i, label: 'Circulation', color: '#9aa4b2', floor: 'wood',
    sockets: (a) => (a > 4 ? 1 : 0),
  },
  { key: 'bureau', re: /bureau/i, label: 'Bureau', color: '#5b8def', floor: 'wood', sockets: () => 3 },
  { key: 'garage', re: /garage/i, label: 'Garage', color: '#8f9aa8', floor: 'concrete', sockets: () => 1 },
  {
    key: 'annexe', re: /cellier|buanderie|cave|local technique/i, label: 'Annexe', color: '#a3927c', floor: 'tile',
    sockets: () => 1,
  },
  { key: 'dressing', re: /dressing|placard/i, label: 'Dressing', color: '#c19a6b', floor: 'wood', sockets: () => 0 },
];

function roomType(name) {
  return ROOM_TYPES.find((t) => t.re.test(name || '')) || null;
}

function fmtMeters(units) {
  return (units / PLAN_UNITS_PER_M).toFixed(2).replace('.', ',') + ' m';
}
function fmtArea(m2) {
  return m2.toFixed(1).replace('.', ',') + ' m²';
}

function _pointSegDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

// Demi-largeur des ouvertures (seuil de porte, fenêtre, porte de garage)
const OPENING_HALF = { door: 40, window_a: 40, garage_door: 120 };

// Segments qui ferment les pièces : murs, seuils de portes, fenêtres
function planBarriers(components, wires) {
  const segs = [];
  for (const w of wires) {
    if (w.kind !== 'wall') continue;
    for (let i = 0; i < w.points.length - 1; i++) segs.push([w.points[i], w.points[i + 1]]);
  }
  for (const c of components) {
    const half = OPENING_HALF[c.type];
    if (!half) continue;
    const a = ((c.rot || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    segs.push([{ x: c.x - half * cos, y: c.y - half * sin }, { x: c.x + half * cos, y: c.y + half * sin }]);
  }
  return segs;
}

let _roomCache = { key: null, value: null };

// Renvoie { step, x0, y0, nx, ny, owner (Int16Array, -1 = hors pièce), rooms: [...] }
// room : { id, name, type, color, area (m² ou null), leaked, sharedWith (index ou null) }
function computeRooms(components, wires) {
  const labels = components.filter((c) => c.type === 'room');
  const segs = planBarriers(components, wires);
  const key = JSON.stringify([segs, labels.map((r) => [r.id, r.x, r.y, r.value])]);
  if (_roomCache.key === key) return _roomCache.value;

  const S = ROOM_STEP;
  const info = { step: S, x0: 0, y0: 0, nx: 0, ny: 0, owner: null, rooms: [] };
  for (const lab of labels) {
    const t = roomType(lab.value);
    info.rooms.push({
      id: lab.id, name: lab.value || 'Pièce', type: t, color: t ? t.color : '#8a97ab',
      area: null, leaked: true, sharedWith: null,
    });
  }
  if (!segs.length) { _roomCache = { key, value: info }; return info; }

  // Grille couvrant le plan (et les étiquettes éventuellement hors des murs)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); };
  for (const [a, b] of segs) { acc(a); acc(b); }
  for (const lab of labels) acc(lab);
  const x0 = Math.floor(minX / S) * S - 2 * S, y0 = Math.floor(minY / S) * S - 2 * S;
  const nx = Math.round((Math.ceil(maxX / S) * S + 2 * S - x0) / S) + 1;
  const ny = Math.round((Math.ceil(maxY / S) * S + 2 * S - y0) / S) + 1;

  // Points bloqués : à moins de 0,75 pas d'une barrière (étanche en diagonale)
  const blocked = new Uint8Array(nx * ny);
  const R = S * 0.75;
  for (const [a, b] of segs) {
    const gx0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R - x0) / S));
    const gx1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + R - x0) / S));
    const gy0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - R - y0) / S));
    const gy1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + R - y0) / S));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (_pointSegDist(x0 + gx * S, y0 + gy * S, a, b) < R) blocked[gy * nx + gx] = 1;
      }
    }
  }

  const owner = new Int16Array(nx * ny).fill(-1);
  const queue = new Int32Array(nx * ny);
  labels.forEach((lab, i) => {
    const room = info.rooms[i];
    // Germe : point libre le plus proche de l'étiquette
    const sx = Math.round((lab.x - x0) / S), sy = Math.round((lab.y - y0) / S);
    let seed = -1;
    for (let r = 0; r <= 3 && seed < 0; r++) {
      for (let dy = -r; dy <= r && seed < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const X = sx + dx, Y = sy + dy;
          if (X < 0 || Y < 0 || X >= nx || Y >= ny || blocked[Y * nx + X]) continue;
          seed = Y * nx + X; break;
        }
      }
    }
    if (seed < 0) return;
    if (owner[seed] >= 0) { room.sharedWith = owner[seed]; room.leaked = false; return; }

    // Remplissage (4-voisinage)
    let head = 0, tail = 0, count = 0, boundary = 0, leaked = false;
    queue[tail++] = seed; owner[seed] = i;
    while (head < tail) {
      const k = queue[head++];
      const gx = k % nx, gy = (k - gx) / nx;
      count++;
      if (gx === 0 || gy === 0 || gx === nx - 1 || gy === ny - 1) leaked = true;
      let border = false;
      const nb = [gx > 0 ? k - 1 : -1, gx < nx - 1 ? k + 1 : -1, gy > 0 ? k - nx : -1, gy < ny - 1 ? k + nx : -1];
      for (const n of nb) {
        if (n < 0) continue;
        if (blocked[n]) { border = true; continue; }
        if (owner[n] === -1) { owner[n] = i; queue[tail++] = n; }
        else if (owner[n] !== i) border = true;
      }
      if (border) boundary++;
    }
    room.leaked = leaked;
    // Chaque point représente un carré de S×S ; la demi-bande manquante le long
    // des murs est rattrapée par le terme de bordure.
    if (!leaked) room.area = (count + boundary / 2 + 1) * (S / PLAN_UNITS_PER_M) ** 2;
  });

  Object.assign(info, { x0, y0, nx, ny, owner });
  _roomCache = { key, value: info };
  return info;
}

// Index de la pièce contenant le point (x, y), ou -1.
// On retient la zone remplie la plus proche (utile pour un appareil posé sur
// un mur) ; si c'est une pièce non fermée, l'appareil n'est attribué à aucune
// pièce — surtout pas à la voisine de l'autre côté de la cloison.
function roomAt(info, x, y) {
  if (!info.owner) return -1;
  const S = info.step;
  const gx = Math.round((x - info.x0) / S), gy = Math.round((y - info.y0) / S);
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const X = gx + dx, Y = gy + dy;
        if (X < 0 || Y < 0 || X >= info.nx || Y >= info.ny) continue;
        const o = info.owner[Y * info.nx + X];
        if (o >= 0) return info.rooms[o].leaked ? -1 : o;
      }
    }
  }
  return -1;
}

// Rectangles (par rangée) couvrant la pièce i — pour colorer son sol
function roomRuns(info, i) {
  info._runs = info._runs || [];
  if (info._runs[i]) return info._runs[i];
  const out = [];
  const S = info.step;
  if (info.owner) {
    for (let gy = 0; gy < info.ny; gy++) {
      let start = -1;
      for (let gx = 0; gx <= info.nx; gx++) {
        const inside = gx < info.nx && info.owner[gy * info.nx + gx] === i;
        if (inside && start < 0) start = gx;
        if (!inside && start >= 0) {
          out.push({ x: info.x0 + start * S - S / 2, y: info.y0 + gy * S - S / 2, w: (gx - start) * S, h: S });
          start = -1;
        }
      }
    }
  }
  info._runs[i] = out;
  return out;
}

// ---- Contrôle NF C 15-100 (simplifié) -------------------------------------
const NF_SOCKETS = new Set(['socket_wall']);
const NF_LIGHTS = new Set(['dcl', 'wall_light']);
const NF_SWITCHES = new Set(['switch_sa', 'switch_vv_wall']);
const NF_EQUIP = new Set([...NF_SOCKETS, ...NF_LIGHTS, ...NF_SWITCHES, 'jbox', 'panel_house', 'gtl']);

function checkNFC15100(components, wires) {
  const report = { hasPlan: wires.some((w) => w.kind === 'wall'), rooms: [], global: [], errors: 0, warnings: 0, ok: false };
  if (!report.hasPlan) return report;
  const info = computeRooms(components, wires);
  const push = (level, msg, compId) => {
    report.global.push({ level, msg, compId });
    if (level === 'err') report.errors++;
    else if (level === 'warn') report.warnings++;
  };

  // Répartition de l'appareillage par pièce
  const tally = info.rooms.map(() => ({ sockets: 0, lights: 0, switches: 0 }));
  let orphan = 0;
  for (const c of components) {
    if (!NF_EQUIP.has(c.type)) continue;
    // une commande posée hors de la pièce (salle d'eau) désigne sa pièce par ctrl
    const ctrl = c.ctrl && info.rooms.findIndex((r) => r.id === c.ctrl);
    const r = ctrl >= 0 && NF_SWITCHES.has(c.type) ? ctrl : roomAt(info, c.x, c.y);
    if (r < 0) { orphan++; continue; }
    if (NF_SOCKETS.has(c.type)) tally[r].sockets++;
    if (NF_LIGHTS.has(c.type)) tally[r].lights++;
    if (NF_SWITCHES.has(c.type)) tally[r].switches++;
  }

  info.rooms.forEach((room, i) => {
    const t = tally[i];
    const row = {
      id: room.id, name: room.name, typeLabel: room.type ? room.type.label : null, color: room.color,
      area: room.area, sockets: t.sockets, socketsReq: null, lights: t.lights, switches: t.switches,
      status: 'ok', msgs: [], note: null,
    };
    if (room.sharedWith !== null) {
      row.status = 'warn';
      row.msgs.push(`même espace que « ${info.rooms[room.sharedWith].name} » : mur ou porte manquant ?`);
    } else if (room.leaked) {
      row.status = 'err';
      row.msgs.push('pièce non fermée : vérifie les murs et les portes');
    } else {
      if (room.type) {
        row.socketsReq = room.type.sockets(room.area);
        row.note = room.type.note || null;
      } else {
        row.status = 'warn';
        row.msgs.push('type non reconnu : nomme-la Chambre, Séjour, Cuisine, Salle d’eau, WC, Entrée, Bureau, Garage, Cellier…');
      }
      if (row.socketsReq !== null && t.sockets < row.socketsReq) {
        row.status = 'err';
        const miss = row.socketsReq - t.sockets;
        row.msgs.push(`${miss} prise${miss > 1 ? 's' : ''} manquante${miss > 1 ? 's' : ''}`);
      }
      if (t.lights < 1) {
        row.status = 'err';
        row.msgs.push('aucun point d’éclairage (DCL ou applique)');
      } else if (t.switches < 1) {
        if (row.status === 'ok') row.status = 'warn';
        row.msgs.push('éclairage sans interrupteur de commande');
      }
    }
    if (row.status === 'err') report.errors++;
    else if (row.status === 'warn') report.warnings++;
    report.rooms.push(row);
  });

  // Contrôles globaux
  if (info.rooms.length) {
    // Sécurité : un détecteur de fumée au moins (obligatoire depuis 2015)
    const daaf = components.filter((c) => c.type === 'smoke_detector');
    if (!daaf.length) push('err', 'Aucun détecteur de fumée (DAAF) : il est obligatoire dans tout logement.');
    else push('ok', `${daaf.length} détecteur${daaf.length > 1 ? 's' : ''} de fumée (DAAF).`, daaf[0].id);
    // Communication : une prise RJ45 par pièce principale
    const noRj = info.rooms.filter((room, i) => room.type && ['sejour', 'chambre', 'bureau'].includes(room.type.key) &&
      !room.leaked && !components.some((c) => c.type === 'rj45' && roomAt(info, c.x, c.y) === i));
    if (noRj.length) push('warn', `Prise RJ45 manquante : ${noRj.map((r) => r.name).join(', ')}.`);
    // Salle d'eau : pas de prise ni d'interrupteur à moins de 60 cm d'une douche ou baignoire
    const wet = components.filter((c) => c.type === 'shower' || c.type === 'bathtub');
    for (const c of components) {
      if (c.type !== 'socket_wall' && !NF_SWITCHES.has(c.type)) continue;
      const r = roomAt(info, c.x, c.y);
      const w = wet.find((b) => roomAt(info, b.x, b.y) === r && _distToFootprint(c.x, c.y, b) < 60);
      if (w) push('err', `${c.label || 'Appareillage'} dans le volume 2 (à moins de 60 cm de la ${w.type === 'shower' ? 'douche' : 'baignoire'}).`, c.id);
    }
    // Cuisine : sortie de câble 32 A pour la plaque de cuisson
    info.rooms.forEach((room, i) => {
      if (!room.type || room.type.key !== 'cuisine' || room.leaked) return;
      if (!components.some((c) => c.type === 'cooktop' && roomAt(info, c.x, c.y) === i)) {
        push('warn', `${room.name} : prévoir le circuit spécialisé 32 A de la plaque de cuisson.`, room.id);
      }
    });
  }
  if (!info.rooms.length) {
    push('warn', 'Place une étiquette « Pièce » (catégorie Architecture) dans chaque pièce pour la contrôler.');
  }
  const gtl = components.find((c) => c.type === 'gtl');
  const tb = components.find((c) => c.type === 'panel_house');
  if (!gtl) push('err', 'Aucune GTL (gaine technique logement) : elle est obligatoire.');
  else push('ok', 'GTL présente.', gtl.id);
  if (!tb) push('err', 'Aucun tableau électrique.');
  else if (gtl && Math.hypot(gtl.x - tb.x, gtl.y - tb.y) > 160) push('warn', 'Le tableau devrait être intégré à la GTL.', tb.id);
  else if (gtl) push('ok', 'Tableau électrique intégré à la GTL.', tb.id);
  if (orphan) push('warn', `${orphan} appareil${orphan > 1 ? 's' : ''} hors de toute pièce identifiée.`);

  report.ok = report.errors === 0 && info.rooms.length > 0;
  return report;
}

// Distance d'un point au rectangle (pivoté) d'un symbole ; 0 à l'intérieur
function _distToFootprint(x, y, c) {
  const b = SYMBOLS[c.type].bbox, a = (-(c.rot || 0) * Math.PI) / 180;
  const dx = x - c.x, dy = y - c.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  const ex = Math.max(b.x - lx, 0, lx - (b.x + b.w)), ey = Math.max(b.y - ly, 0, ly - (b.y + b.h));
  return Math.hypot(ex, ey);
}

// ---- Cotations des murs ----------------------------------------------------
// Texte au milieu de chaque segment, décalé sur sa gauche (à l'extérieur
// d'une pièce tracée dans le sens horaire), orienté pour rester lisible.
function wallDimensions(wires) {
  const out = [];
  for (const w of wires) {
    if (w.kind !== 'wall') continue;
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 30) continue;
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      const nx = Math.sin(ang), ny = -Math.cos(ang);
      if (ang >= Math.PI / 2) ang -= Math.PI;
      else if (ang < -Math.PI / 2) ang += Math.PI;
      out.push({ x: (a.x + b.x) / 2 + nx * 18, y: (a.y + b.y) / 2 + ny * 18, angle: ang, text: fmtMeters(len) });
    }
  }
  return out;
}
