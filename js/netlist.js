/*
 * netlist.js — Extraction de la connectivité électrique (les « nets »).
 *
 * Deux broches sont reliées si elles partagent la même coordonnée, et tous
 * les sommets d'un même fil forment un seul conducteur. Sert à la simulation,
 * aux points de jonction et à la nomenclature.
 */

function _round(v) { return Math.round(v); }

// Terminaux d'un composant en coordonnées monde (entières)
function worldTerminals(c, symbols) {
  const sym = symbols[c.type];
  const a = (c.rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return sym.terminals.map((t, i) => ({
    x: _round(c.x + t.x * cos - t.y * sin),
    y: _round(c.y + t.x * sin + t.y * cos),
    index: i,
  }));
}

// Point sur un segment [a,b] (coordonnées entières)
function _onSeg(px, py, a, b) {
  const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
  if (Math.abs(cross) > 0.5) return false;
  const dot = (px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y);
  if (dot < 0) return false;
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= len2;
}

const _key = (x, y) => x + ',' + y;

// Seuls les fils électriques comptent pour la connectivité
// (les murs et goulottes du plan de maison sont décoratifs).
function _elecWires(wires) {
  return wires.filter((w) => !w.kind || w.kind === 'wire');
}

// Construit les nets : renvoie { netIdOf(key), terminalNet (compId -> [netId]),
// nets (liste d'ids), netKeys (netId -> [keys]) }
function buildNets(components, wires, symbols) {
  wires = _elecWires(wires);
  const parent = {};
  const find = (k) => {
    if (parent[k] === undefined) parent[k] = k;
    while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
    return k;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  // Broches des composants
  const termPins = [];
  for (const c of components) {
    const ts = worldTerminals(c, symbols);
    ts.forEach((t) => { const k = _key(t.x, t.y); find(k); termPins.push({ comp: c, index: t.index, x: t.x, y: t.y, key: k }); });
  }

  // Fils : un fil = un conducteur unique
  const wirePts = [];
  for (const w of wires) {
    const pts = w.points.map((p) => ({ x: _round(p.x), y: _round(p.y) }));
    const keys = pts.map((p) => _key(p.x, p.y));
    keys.forEach((k) => find(k));
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
    wirePts.push({ wire: w, pts });
  }

  // Broches posées sur l'intérieur d'un fil (jonctions en T)
  for (const wp of wirePts) {
    for (const tp of termPins) {
      for (let i = 0; i < wp.pts.length - 1; i++) {
        if (_onSeg(tp.x, tp.y, wp.pts[i], wp.pts[i + 1])) { union(tp.key, _key(wp.pts[0].x, wp.pts[0].y)); break; }
      }
    }
  }

  // Sommet d'un fil posé sur l'intérieur d'un autre fil (jonction en T fil-fil)
  for (const wp of wirePts) {
    for (const p of wp.pts) {
      for (const wp2 of wirePts) {
        if (wp2 === wp) continue;
        for (let i = 0; i < wp2.pts.length - 1; i++) {
          if (_onSeg(p.x, p.y, wp2.pts[i], wp2.pts[i + 1])) { union(_key(p.x, p.y), _key(wp2.pts[0].x, wp2.pts[0].y)); break; }
        }
      }
    }
  }

  // Numérotation des nets
  const rootToId = {}; let next = 0;
  const idOf = (k) => { const r = find(k); if (rootToId[r] === undefined) rootToId[r] = next++; return rootToId[r]; };

  const terminalNet = {};
  for (const c of components) terminalNet[c.id] = worldTerminals(c, symbols).map((t) => idOf(_key(t.x, t.y)));

  const nets = [];
  for (let i = 0; i < next; i++) nets.push(i);

  // Une coordonnée représentative par net (pour placer les étiquettes)
  const netSample = {};
  for (const tp of termPins) { const id = idOf(tp.key); if (!netSample[id]) netSample[id] = { x: tp.x, y: tp.y }; }
  for (const wp of wirePts) { const id = idOf(_key(wp.pts[0].x, wp.pts[0].y)); if (!netSample[id]) netSample[id] = wp.pts[0]; }

  return { nets, terminalNet, idOfKey: idOf, netSample };
}

// Points de jonction à dessiner (≥3 conducteurs, ou T sur un fil)
function computeJunctions(components, wires, symbols) {
  wires = _elecWires(wires);
  const wireEnd = {}; // key -> nb de segments incidents
  const term = {};    // key -> nb de terminaux
  const add = (m, k) => { m[k] = (m[k] || 0) + 1; };

  const wireSegs = [];
  for (const w of wires) {
    const pts = w.points.map((p) => ({ x: _round(p.x), y: _round(p.y) }));
    pts.forEach((p, i) => {
      const k = _key(p.x, p.y);
      if (i > 0) add(wireEnd, k);
      if (i < pts.length - 1) add(wireEnd, k);
    });
    for (let i = 0; i < pts.length - 1; i++) wireSegs.push([pts[i], pts[i + 1]]);
  }
  const termList = [];
  for (const c of components) for (const t of worldTerminals(c, symbols)) { add(term, _key(t.x, t.y)); termList.push(t); }

  const dots = new Set();
  const allKeys = new Set([...Object.keys(wireEnd), ...Object.keys(term)]);
  for (const k of allKeys) {
    if ((wireEnd[k] || 0) + (term[k] || 0) >= 3) dots.add(k);
  }
  // Jonctions en T : un terminal pile sur l'intérieur d'un fil
  for (const t of termList) {
    for (const [a, b] of wireSegs) {
      const isEnd = (a.x === t.x && a.y === t.y) || (b.x === t.x && b.y === t.y);
      if (!isEnd && _onSeg(t.x, t.y, a, b)) dots.add(_key(t.x, t.y));
    }
  }
  // Jonctions en T fil-fil : extrémité d'un fil sur l'intérieur d'un autre
  for (const w of wires) {
    const pts = w.points.map((p) => ({ x: _round(p.x), y: _round(p.y) }));
    for (const p of [pts[0], pts[pts.length - 1]]) {
      for (const [a, b] of wireSegs) {
        const isEnd = (a.x === p.x && a.y === p.y) || (b.x === p.x && b.y === p.y);
        if (!isEnd && _onSeg(p.x, p.y, a, b)) dots.add(_key(p.x, p.y));
      }
    }
  }
  return [...dots].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; });
}

// Nomenclature : regroupe par (type, valeur)
function buildBOM(components, symbols) {
  const groups = {};
  for (const c of components) {
    const sym = symbols[c.type];
    if (!sym || sym.category === 'Connexions' || sym.noBom) continue; // masse/nœud/mobilier...
    const key = c.type + '|' + (c.value || '');
    if (!groups[key]) groups[key] = { type: c.type, name: sym.name, value: c.value || '', refs: [] };
    groups[key].refs.push(c.label || '?');
  }
  return Object.values(groups)
    .map((g) => ({ ...g, refs: g.refs.sort(_natCmp), qty: g.refs.length }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value));
}

// Tri naturel des références (R2 avant R10)
function _natCmp(a, b) {
  return a.replace(/\d+/g, (n) => n.padStart(6, '0'))
    .localeCompare(b.replace(/\d+/g, (n) => n.padStart(6, '0')));
}
