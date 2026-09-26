/*
 * dxf.js — Export DXF (AutoCAD R12, ASCII) : s'ouvre dans AutoCAD, LibreCAD,
 * DraftSight, QCAD, FreeCAD…
 *
 * Même astuce que l'export SVG : les symboles se dessinent dans un faux
 * contexte 2D qui, au lieu de peindre, produit des polylignes et des textes.
 * Unités : le mètre (1 unité DXF = 1 m), axe Y vers le haut. Un calque par
 * nature d'objet : murs, menuiseries, mobilier, électricité, goulottes, fils,
 * pièces, repères, cotes.
 */

const DXF_LAYERS = [
  ['MURS', 7], ['MURS-HACHURES', 8], ['MENUISERIES', 30], ['MOBILIER', 8], ['ELECTRICITE', 1], ['GOULOTTES', 9],
  ['FILS', 5], ['PIECES', 3], ['REPERES', 2], ['COTES', 4], ['CARTOUCHE', 7], ['ESCALIER', 6], ['CIRCUITS', 1],
];

class DXFContext {
  constructor() {
    this.M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    this.stack = [];
    this.ents = [];
    this.layer = '0';
    this.font = '12px sans-serif';
    this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.strokeStyle = '#000'; this.fillStyle = '#000'; this.lineWidth = 1; this.globalAlpha = 1;
    this._subs = []; this._cur = null; this._lx = 0; this._ly = 0;
  }
  save() { this.stack.push({ M: { ...this.M }, font: this.font, ta: this.textAlign, tb: this.textBaseline }); }
  restore() { const s = this.stack.pop(); if (s) { this.M = s.M; this.font = s.font; this.textAlign = s.ta; this.textBaseline = s.tb; } }
  _mul(T) {
    const M = this.M;
    this.M = {
      a: M.a * T.a + M.c * T.b, b: M.b * T.a + M.d * T.b,
      c: M.a * T.c + M.c * T.d, d: M.b * T.c + M.d * T.d,
      e: M.a * T.e + M.c * T.f + M.e, f: M.b * T.e + M.d * T.f + M.f,
    };
  }
  translate(x, y) { this._mul({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }); }
  rotate(r) { this._mul({ a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 }); }
  scale(x, y) { this._mul({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); }
  _ap(x, y) { return { x: this.M.a * x + this.M.c * y + this.M.e, y: this.M.b * x + this.M.d * y + this.M.f }; }
  setLineDash() {}
  measureText(t) { return { width: String(t).length * this._size() * 0.6 }; }
  // --- chemins ---
  beginPath() { this._subs = []; this._cur = null; }
  moveTo(x, y) { this._cur = [this._ap(x, y)]; this._subs.push(this._cur); this._lx = x; this._ly = y; }
  lineTo(x, y) { if (!this._cur) { this.moveTo(x, y); return; } this._cur.push(this._ap(x, y)); this._lx = x; this._ly = y; }
  arc(cx, cy, r, a0, a1, anti) {
    const steps = 24; let span = a1 - a0;
    if (anti && span > 0) span -= 2 * Math.PI;
    if (!anti && span < 0) span += 2 * Math.PI;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0 && !this._cur) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1) {
    const steps = 24, c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps, ex = rx * Math.cos(a), ey = ry * Math.sin(a);
      const x = cx + ex * c - ey * s, y = cy + ex * s + ey * c;
      if (i === 0 && !this._cur) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  quadraticCurveTo(cpx, cpy, x, y) {
    const x0 = this._lx, y0 = this._ly;
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, mt = 1 - t;
      this.lineTo(mt * mt * x0 + 2 * mt * t * cpx + t * t * x, mt * mt * y0 + 2 * mt * t * cpy + t * t * y);
    }
  }
  closePath() { if (this._cur) this._cur.closed = true; }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  stroke() { for (const s of this._subs) if (s.length > 1) this.poly(s, !!s.closed); }
  fill() { this.stroke(); } // contour seulement (pas de hachures)
  strokeRect(x, y, w, h) { this.poly([this._ap(x, y), this._ap(x + w, y), this._ap(x + w, y + h), this._ap(x, y + h)], true); }
  fillText(text, x, y) {
    const p = this._ap(x, y), ang = Math.atan2(this.M.b, this.M.a);
    this.ents.push({ t: 'TEXT', layer: this.layer, x: p.x, y: p.y, h: this._size() * Math.hypot(this.M.a, this.M.b), text: String(text), ang, align: this.textAlign, base: this.textBaseline });
  }
  _size() { const m = /(\d+(?:\.\d+)?)px/.exec(this.font); return m ? +m[1] : 12; }
  poly(pts, closed, width) { this.ents.push({ t: 'POLYLINE', layer: this.layer, pts, closed, width }); }
}

// Couche d'un symbole selon sa nature
function _dxfLayerOf(type, sym) {
  if (type === 'room') return 'PIECES';
  if (type === 'stairs') return 'ESCALIER';
  if (type === 'door' || type === 'window_a' || type === 'garage_door') return 'MENUISERIES';
  if (sym.category === 'Mobilier' || sym.category === 'Sanitaire' || sym.category === 'Architecture') return 'MOBILIER';
  return 'ELECTRICITE';
}

function buildDXF(components, wires, symbols, meta) {
  const ctx = new DXFContext();
  const isPlan = wires.some((w) => w.kind === 'wall') && typeof computeRooms === 'function';
  const areas = {};
  if (isPlan) {
    const info = computeRooms(components, wires);
    for (const r of info.rooms) if (!r.leaked && r.sharedWith === null) areas[r.id] = r.area;
  }
  // Murs (épaisseur réelle), goulottes, fils
  for (const w of wires) {
    const pts = w.points.map((p) => ({ x: p.x, y: p.y }));
    if (w.kind === 'wall') {
      ctx.layer = 'MURS'; ctx.poly(pts, false, w.ext ? 20 : 10);
      // matériau : montants de cloison sèche ou hachures de maçonnerie (calque dédié, masquable)
      if (typeof wallMarks === 'function') { ctx.layer = 'MURS-HACHURES'; for (const [x1, y1, x2, y2] of wallMarks(w)) ctx.poly([ctx._ap(x1, y1), ctx._ap(x2, y2)], false); }
    }
    else if (w.kind === 'conduit') { ctx.layer = 'GOULOTTES'; ctx.poly(pts, false, w.riser ? 0 : 5); }
    else { ctx.layer = 'FILS'; ctx.poly(pts, false); }
  }
  // Symboles et leurs repères
  for (const c of components) {
    const sym = symbols[c.type];
    if (!sym) continue;
    ctx.layer = _dxfLayerOf(c.type, sym);
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(((c.rot || 0) * Math.PI) / 180);
    sym.draw(ctx, c.type === 'room' ? { ...c, __area: areas[c.id] } : c);
    ctx.restore();
    const txt = labelText(c);
    if (txt && !sym.ownLabel) {
      const la = labelAnchor(c, sym);
      ctx.layer = 'REPERES'; ctx.font = '11px sans-serif'; ctx.textAlign = la.align; ctx.textBaseline = 'alphabetic';
      ctx.fillText(txt, la.x, la.y);
    }
  }
  // Repères de circuits
  if (meta && meta.tags) {
    ctx.layer = 'CIRCUITS';
    for (const c of components) { const t = meta.tags.map[c.id]; if (t) drawCircuitTag(ctx, c, t, 1); }
  }
  // Cotations des murs
  if (isPlan) {
    ctx.layer = 'COTES';
    for (const d of wallDimensions(wires)) {
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.angle);
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }
  }
  // Emprise et cartouche (sous le dessin)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); };
  for (const e of ctx.ents) { if (e.t === 'POLYLINE') e.pts.forEach(acc); else acc(e); }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
  const bx = minX, by = maxY + 40, bw = Math.max(400, maxX - minX);
  ctx.layer = 'CARTOUCHE';
  ctx.poly([{ x: bx, y: by }, { x: bx + bw, y: by }, { x: bx + bw, y: by + 50 }, { x: bx, y: by + 50 }], true);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  ctx.font = '16px sans-serif'; ctx.fillText((meta && meta.title) || 'Plan électrique', bx + 10, by + 22);
  ctx.font = '11px sans-serif'; ctx.fillText([(meta && meta.author) || '', (meta && meta.date) || '', 'ÉlectriCAD — unités : mètres'].filter(Boolean).join(' — '), bx + 10, by + 40);
  acc({ x: bx + bw, y: by + 50 });

  return _dxfWrite(ctx.ents, { minX, minY, maxX: Math.max(maxX, bx + bw), maxY: by + 50 });
}

// Écriture R12 : coordonnées en mètres, Y vers le haut ; caractères non ASCII en \U+XXXX
// opt : { U : unités de dessin par unité DXF, insunits, layers : [[nom, couleur]] }
function _dxfWrite(ents, ext, opt) {
  opt = opt || {};
  const U = opt.U || (typeof PLAN_UNITS_PER_M !== 'undefined' ? PLAN_UNITS_PER_M : 100);
  const LAYERS = opt.layers || DXF_LAYERS;
  const X = (x) => +(x / U).toFixed(4), Y = (y) => +(-y / U).toFixed(4);
  const enc = (s) => String(s).replace(/[^\x20-\x7e]/g, (ch) => '\\U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  const L = [];
  const g = (code, v) => { L.push(String(code), String(v)); };
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, opt.insunits || 6);
  g(9, '$EXTMIN'); g(10, X(ext.minX)); g(20, Y(ext.maxY)); g(30, 0);
  g(9, '$EXTMAX'); g(10, X(ext.maxX)); g(20, Y(ext.minY)); g(30, 0);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length);
  for (const [name, color] of LAYERS) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const e of ents) {
    if (e.t === 'POLYLINE') {
      g(0, 'POLYLINE'); g(8, e.layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, e.closed ? 1 : 0);
      if (e.width) { g(40, +(e.width / U).toFixed(4)); g(41, +(e.width / U).toFixed(4)); }
      for (const p of e.pts) { g(0, 'VERTEX'); g(8, e.layer); g(10, X(p.x)); g(20, Y(p.y)); g(30, 0); }
      g(0, 'SEQEND'); g(8, e.layer);
    } else if (e.t === 'TEXT' && e.text.trim()) {
      const h = +(Math.max(1, e.h) / U).toFixed(4), deg = +((-e.ang * 180) / Math.PI).toFixed(2);
      const hj = e.align === 'center' ? 1 : e.align === 'right' || e.align === 'end' ? 2 : 0;
      const vj = e.base === 'middle' ? 2 : 0;
      g(0, 'TEXT'); g(8, e.layer); g(10, X(e.x)); g(20, Y(e.y)); g(30, 0); g(40, h); g(1, enc(e.text));
      if (deg) g(50, deg);
      if (hj || vj) { g(72, hj); g(73, vj); g(11, X(e.x)); g(21, Y(e.y)); g(31, 0); }
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return L.join('\r\n') + '\r\n';
}

// ===========================================================================
// Import : plan d'architecte (DXF) → murs, portes, fenêtres, pièces
//
// Les plans d'architecte dessinent les murs en double trait (les deux faces).
// On apparie les traits parallèles pour retrouver l'axe et l'épaisseur de
// chaque mur, on recolle les tronçons coupés par les ouvertures (qui
// deviennent portes et fenêtres), on raccorde les angles et les T, puis on
// reconnaît les noms de pièces écrits sur le plan.
// ===========================================================================

const DXF_ERR_BINARY = 'DXF binaire non pris en charge : réenregistre le plan en DXF ASCII.';
const DXF_RE_WALL = /mur|wall|cloison|ma[cç]onn|voile|partition|porteur|doublage|^a-?w/i;
const DXF_RE_OPEN = /menuis|porte|fen[eê]|door|window|glaz|ouvert|baie|^a-?(door|glaz|wind)/i;
const DXF_RE_SKIP = /cot|dim|text|hach|hatch|mobil|furn|axe|grid|trame|[ée]lec|sanit|plomb|annot|cartouche|title|viewport|defpoints/i;
const DXF_RE_ROOM = /pi[eè]ce|room|local|espace|surface|d[ée]signation/i;
const DXF_RE_STAIRS = /escal|stair|tr[ée]mie/i;

// Octets → texte : UTF-8 (AutoCAD 2007 et suivants) sinon Windows-1252
function decodeDXFBytes(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let head = '';
  for (let i = 0; i < Math.min(18, u8.length); i++) head += String.fromCharCode(u8[i]);
  if (head === 'AutoCAD Binary DXF') throw new Error(DXF_ERR_BINARY);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (_) { /* pas de l'UTF-8 */ }
  try { return new TextDecoder('windows-1252').decode(u8); } catch (_) { return new TextDecoder('latin1').decode(u8); }
}

// Textes DXF : \U+XXXX, codes %%, mise en forme MTEXT
function _dxfText(s) {
  return String(s)
    .replace(/\\U\+([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '')
    .replace(/\\P/g, ' ').replace(/\\~/g, ' ')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[LlOoKk]/g, '')
    .replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function _dxfOpeningKind(name) {
  const s = String(name || '');
  if (/garage|sectionn|basculant/i.test(s)) return 'garage_door';
  if (/fen[eê]t|window|baie|ch[aâ]ssis|velux|vasistas|oscillo|coulissant|\bpf\d*\b|\bfen\b|\bf\d{2,3}\b|\bwin/i.test(s)) return 'window_a';
  if (/porte|door|\bpte\d*\b|\bp\d{2,3}\b/i.test(s)) return 'door';
  return null;
}

// Lecture : entités à plat (blocs insérés développés), coordonnées du dessin (Y vers le haut)
function parseDXF(text) {
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error(DXF_ERR_BINARY);
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const recs = [];
  let sec = null, cur = null, hvar = null, units = 0, pairs = 0;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10), v = lines[i + 1];
    if (Number.isNaN(code)) {
      if (!lines[i].trim() && i > lines.length - 4) break;
      throw new Error('Fichier DXF illisible (ligne ' + (i + 1) + ').');
    }
    pairs++;
    if (code === 0) {
      const t = v.trim();
      if (t === 'SECTION') { sec = '?'; cur = null; continue; }
      if (t === 'ENDSEC') { sec = null; cur = null; continue; }
      if (t === 'EOF') break;
      cur = { sec, type: t, g: [] };
      if (sec === 'BLOCKS' || sec === 'ENTITIES') recs.push(cur);
      continue;
    }
    if (sec === '?' && code === 2) { sec = v.trim(); continue; }
    if (sec === 'HEADER') {
      if (code === 9) hvar = v.trim();
      else if (hvar === '$INSUNITS' && code === 70) units = parseInt(v, 10) || 0;
      continue;
    }
    if (cur) cur.g.push([code, v]);
  }
  if (!pairs || !recs.length) throw new Error('Aucune entité trouvée : est-ce bien un fichier DXF ?');

  // Blocs et entités (les sommets d'une POLYLINE rattachés à leur entité)
  const blocks = {}, ents = [];
  let blk = null, poly = null;
  const add = (list, r) => {
    if (r.type === 'VERTEX') { if (poly) poly.verts.push(r); return; }
    if (r.type === 'SEQEND') { poly = null; return; }
    if (r.type === 'POLYLINE') { r.verts = []; poly = r; }
    list.push(r);
  };
  for (const r of recs) {
    if (r.sec === 'BLOCKS') {
      if (r.type === 'BLOCK') {
        blk = { name: _dxfGet(r, 2, ''), bx: _dxfNum(r, 10), by: _dxfNum(r, 20), ents: [] };
        blocks[blk.name] = blk; continue;
      }
      if (r.type === 'ENDBLK') { blk = null; continue; }
      if (blk) add(blk.ents, r);
    } else add(ents, r);
  }

  const out = { units, segs: [], texts: [], inserts: [], layers: {}, blocks };
  _dxfPrims(ents, blocks, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, null, out, 0);
  for (const s of out.segs) {
    const L = out.layers[s.layer] || (out.layers[s.layer] = { segs: 0, len: 0, texts: 0 });
    L.segs++; L.len += Math.hypot(s.bx - s.ax, s.by - s.ay);
  }
  for (const t of out.texts) (out.layers[t.layer] || (out.layers[t.layer] = { segs: 0, len: 0, texts: 0 })).texts++;
  return out;
}

function _dxfGet(r, code, d) { for (const [k, v] of r.g) if (k === code) return v.trim(); return d; }
function _dxfNum(r, code, d = 0) { const v = _dxfGet(r, code, null); const n = v === null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; }

function _dxfPrims(ents, blocks, T, layerOver, out, depth) {
  const P = (x, y) => [T.a * x + T.c * y + T.e, T.b * x + T.d * y + T.f];
  const sc = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c)) || 1;
  const seg = (x0, y0, x1, y1, layer, w, arc) => {
    const [ax, ay] = P(x0, y0), [bx, by] = P(x1, y1);
    if (Math.hypot(bx - ax, by - ay) < 1e-9) return;
    out.segs.push({ ax, ay, bx, by, layer, w: (w || 0) * sc, arc: !!arc });
  };
  const polyline = (verts, closed, layer, w) => {
    const n = verts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p = verts[i], q = verts[(i + 1) % n], bulge = p.bulge || 0;
      if (Math.abs(bulge) < 1e-3) { seg(p.x, p.y, q.x, q.y, layer, w); continue; }
      // Arc de polyligne : angle au centre 4·atan(bulge)
      const th = 4 * Math.atan(bulge), c = Math.hypot(q.x - p.x, q.y - p.y);
      const r = c / (2 * Math.sin(Math.abs(th) / 2)), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      const h = r * Math.cos(Math.abs(th) / 2) * Math.sign(bulge) * (Math.abs(th) > Math.PI ? -1 : 1);
      const ux = (q.x - p.x) / c, uy = (q.y - p.y) / c, cx = mx - uy * h, cy = my + ux * h;
      const a0 = Math.atan2(p.y - cy, p.x - cx), k = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 12)));
      let px = p.x, py = p.y;
      for (let j = 1; j <= k; j++) {
        const a = a0 + (th * j) / k, x = j === k ? q.x : cx + r * Math.cos(a), y = j === k ? q.y : cy + r * Math.sin(a);
        seg(px, py, x, y, layer, 0, true); px = x; py = y;
      }
    }
  };
  for (const r of ents) {
    let layer = _dxfGet(r, 8, '0');
    if (layer === '0' && layerOver) layer = layerOver;
    switch (r.type) {
      case 'LINE':
        seg(_dxfNum(r, 10), _dxfNum(r, 20), _dxfNum(r, 11), _dxfNum(r, 21), layer);
        break;
      case 'LWPOLYLINE': {
        const verts = [];
        for (const [k, v] of r.g) {
          if (k === 10) verts.push({ x: parseFloat(v), y: 0, bulge: 0 });
          else if (k === 20 && verts.length) verts[verts.length - 1].y = parseFloat(v);
          else if (k === 42 && verts.length) verts[verts.length - 1].bulge = parseFloat(v) || 0;
        }
        polyline(verts, (_dxfNum(r, 70) & 1) === 1, layer, _dxfNum(r, 43));
        break;
      }
      case 'POLYLINE': {
        const fl = _dxfNum(r, 70);
        if (fl & (16 | 64)) break; // maillages et faces
        const verts = r.verts
          .filter((v) => !(_dxfNum(v, 70) & 16))
          .map((v) => ({ x: _dxfNum(v, 10), y: _dxfNum(v, 20), bulge: _dxfNum(v, 42) }));
        polyline(verts, (fl & 1) === 1, layer, Math.min(_dxfNum(r, 40), _dxfNum(r, 41)));
        break;
      }
      case 'ARC': {
        const cx = _dxfNum(r, 10), cy = _dxfNum(r, 20), rad = _dxfNum(r, 40);
        const a0 = (_dxfNum(r, 50) * Math.PI) / 180;
        let a1 = (_dxfNum(r, 51) * Math.PI) / 180;
        if (a1 <= a0) a1 += 2 * Math.PI;
        const k = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 12)));
        for (let j = 0; j < k; j++) {
          const u = a0 + ((a1 - a0) * j) / k, w = a0 + ((a1 - a0) * (j + 1)) / k;
          seg(cx + rad * Math.cos(u), cy + rad * Math.sin(u), cx + rad * Math.cos(w), cy + rad * Math.sin(w), layer, 0, true);
        }
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        let s;
        if (r.type === 'MTEXT') s = r.g.filter(([k]) => k === 3).map(([, v]) => v).join('') + _dxfGet(r, 1, '');
        else s = r.g.find(([k]) => k === 1) ? r.g.find(([k]) => k === 1)[1] : '';
        s = _dxfText(s);
        if (!s) break;
        const al = r.type === 'TEXT' && (_dxfNum(r, 72) || _dxfNum(r, 73)) && _dxfGet(r, 11, null) !== null;
        const [x, y] = al ? P(_dxfNum(r, 11), _dxfNum(r, 21)) : P(_dxfNum(r, 10), _dxfNum(r, 20));
        out.texts.push({ x, y, h: _dxfNum(r, 40, 1) * sc, text: s, layer });
        break;
      }
      case 'INSERT': {
        const name = _dxfGet(r, 2, ''), b = blocks[name];
        if (!b || depth > 6) break;
        const sx = _dxfNum(r, 41, 1) || 1, sy = _dxfNum(r, 42, 1) || 1, ro = (_dxfNum(r, 50) * Math.PI) / 180;
        const cs = Math.cos(ro), sn = Math.sin(ro), ix = _dxfNum(r, 10), iy = _dxfNum(r, 20);
        const I = {
          a: cs * sx, b: sn * sx, c: -sn * sy, d: cs * sy,
          e: ix - (cs * sx * b.bx - sn * sy * b.by), f: iy - (sn * sx * b.bx + cs * sy * b.by),
        };
        const M = {
          a: T.a * I.a + T.c * I.b, b: T.b * I.a + T.d * I.b, c: T.a * I.c + T.c * I.d, d: T.b * I.c + T.d * I.d,
          e: T.a * I.e + T.c * I.f + T.e, f: T.b * I.e + T.d * I.f + T.f,
        };
        const kind = DXF_RE_STAIRS.test(name) ? 'stairs' : _dxfOpeningKind(name) || (DXF_RE_OPEN.test(layer) ? _dxfOpeningKind(layer) : null);
        if (kind) {
          // Porte ou fenêtre en bloc : son emprise, sans la développer
          const sub = { segs: [], texts: [], inserts: [] };
          _dxfPrims(b.ents, blocks, M, layer, sub, depth + 1);
          if (!sub.segs.length) break;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const s of sub.segs) {
            x0 = Math.min(x0, s.ax, s.bx); x1 = Math.max(x1, s.ax, s.bx);
            y0 = Math.min(y0, s.ay, s.by); y1 = Math.max(y1, s.ay, s.by);
          }
          out.inserts.push({ kind, name, layer, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: Math.max(x1 - x0, y1 - y0), bw: x1 - x0, bh: y1 - y0 });
        } else {
          _dxfPrims(b.ents, blocks, M, layer === '0' ? layerOver : layer, out, depth + 1);
        }
        break;
      }
      default:
        break;
    }
  }
}

// Unités du dessin → centimètres ($INSUNITS, sinon d'après la taille du dessin)
function dxfScale(P, layers) {
  const per = { 1: 2.54, 2: 30.48, 4: 0.1, 5: 1, 6: 100, 14: 10 }[P.units];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const keep = layers ? new Set(layers) : null;
  for (const s of P.segs) {
    if (keep && !keep.has(s.layer)) continue;
    x0 = Math.min(x0, s.ax, s.bx); x1 = Math.max(x1, s.ax, s.bx);
    y0 = Math.min(y0, s.ay, s.by); y1 = Math.max(y1, s.ay, s.by);
  }
  const size = isFinite(x0) ? Math.max(x1 - x0, y1 - y0) : 0;
  // une maison mesure de 3 à 150 m : une unité déclarée qui donne autre chose est ignorée
  if (per && size * per >= 300 && size * per <= 15000) return { scale: per, guessed: false, size: size * per };
  const scale = size > 3000 ? 0.1 : size < 200 ? 100 : 1;
  return { scale, guessed: true, size: size * scale };
}

// Calques probables : murs (d'après le nom, sinon le plus chargé), menuiseries
function dxfGuessLayers(P) {
  const info = Object.entries(P.layers)
    .map(([name, L]) => ({ name, ...L }))
    .sort((a, b) => b.len - a.len);
  let walls = info.filter((l) => l.segs && DXF_RE_WALL.test(l.name) && !DXF_RE_SKIP.test(l.name)).map((l) => l.name);
  if (!walls.length) {
    const best = info.find((l) => l.segs && !DXF_RE_SKIP.test(l.name) && !DXF_RE_OPEN.test(l.name) && !DXF_RE_STAIRS.test(l.name));
    if (best) walls = [best.name];
  }
  const openings = info.filter((l) => l.segs && DXF_RE_OPEN.test(l.name) && !walls.includes(l.name)).map((l) => l.name);
  const stairs = info.filter((l) => l.segs && DXF_RE_STAIRS.test(l.name) && !walls.includes(l.name)).map((l) => l.name);
  for (const l of info) l.guess = walls.includes(l.name) ? 'murs' : openings.includes(l.name) ? 'menuiseries' : stairs.includes(l.name) ? 'escalier' : '';
  return { walls, openings, stairs, info };
}

// --- Géométrie des murs (centimètres, Y vers le bas) -----------------------
// Trait : angle th dans [0, π), abscisses s < e le long de u, décalage d le long de n
function _dxfLine(ax, ay, bx, by) {
  let th = Math.atan2(by - ay, bx - ax);
  if (th < 0) th += Math.PI;
  if (th >= Math.PI - 1e-9) th -= Math.PI;
  // plans d'équerre : moins de 1,5° d'écart → exactement horizontal ou vertical
  const deg = (th * 180) / Math.PI;
  if (Math.abs(deg) < 1.5 || Math.abs(deg - 180) < 1.5) th = 0;
  else if (Math.abs(deg - 90) < 1.5) th = Math.PI / 2;
  const ux = Math.cos(th), uy = Math.sin(th);
  let s = ux * ax + uy * ay, e = ux * bx + uy * by;
  if (s > e) [s, e] = [e, s];
  const d = -uy * (ax + bx) / 2 + ux * (ay + by) / 2;
  return { th, s, e, d };
}
const _dxfPt = (L, s, d) => ({ x: Math.cos(L.th) * s - Math.sin(L.th) * d, y: Math.sin(L.th) * s + Math.cos(L.th) * d });
const _dxfSameDir = (a, b, tol) => { const x = Math.abs(a - b); return Math.min(x, Math.PI - x) < tol; };

// Groupes de traits parallèles (angles voisins), chaque trait gardant le sien
function _dxfDirGroups(items, tol) {
  const sorted = items.slice().sort((a, b) => a.th - b.th), groups = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && it.th - g[g.length - 1].th < tol) g.push(it); else groups.push([it]);
  }
  // raccord 0 / π
  if (groups.length > 1) {
    const f = groups[0], l = groups[groups.length - 1];
    if (_dxfSameDir(f[0].th, l[l.length - 1].th, tol)) { groups.pop(); for (const it of l) { it.d = -it.d; [it.s, it.e] = [-it.e, -it.s]; it.th -= Math.PI; f.push(it); } }
  }
  return groups;
}

// Intervalle [a, b] privé des intervalles occupés
function _dxfFree(a, b, used) {
  let parts = [[a, b]];
  for (const [u0, u1] of used) {
    const next = [];
    for (const [p0, p1] of parts) {
      if (u1 <= p0 || u0 >= p1) { next.push([p0, p1]); continue; }
      if (u0 > p0) next.push([p0, u0]);
      if (u1 < p1) next.push([u1, p1]);
    }
    parts = next;
  }
  return parts;
}

// Traits → axes de murs { th, s, e, d, t }
function _dxfWallAxes(faces, thick) {
  const TMIN = 4, TMAX = 60, ABS = 20, SINGLE = 60;
  // 1. Fusion des traits colinéaires qui se touchent
  const merged = [];
  for (const g of _dxfDirGroups(faces, 0.004)) {
    g.sort((a, b) => a.d - b.d);
    let run = [];
    const flush = () => {
      run.sort((a, b) => a.s - b.s);
      let cur = null;
      for (const f of run) {
        if (cur && f.s <= cur.e + 0.5) { cur.e = Math.max(cur.e, f.e); continue; }
        if (cur) merged.push(cur);
        cur = { th: f.th, s: f.s, e: f.e, d: run.reduce((m, x) => m + x.d, 0) / run.length };
      }
      if (cur) merged.push(cur);
      run = [];
    };
    for (const f of g) { if (run.length && f.d - run[run.length - 1].d > 0.6) flush(); run.push(f); }
    flush();
  }
  // 2. Appariement des faces : les plus proches d'abord, chaque portion de face servant une fois
  const bands = [];
  const groups = _dxfDirGroups(merged, 0.026);
  for (const g of groups) {
    const used = g.map(() => []), cand = [];
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const A = g[i], B = g[j], dist = Math.abs(A.d - B.d);
        if (dist < TMIN || dist > TMAX) continue;
        const o0 = Math.max(A.s, B.s), o1 = Math.min(A.e, B.e);
        if (o1 - o0 < Math.max(8, 0.2 * Math.min(A.e - A.s, B.e - B.s))) continue;
        cand.push({ i, j, dist, o0, o1 });
      }
    }
    cand.sort((a, b) => a.dist - b.dist);
    for (const c of cand) {
      for (const [p0, p1] of _dxfFree(c.o0, c.o1, [...used[c.i], ...used[c.j]])) {
        if (p1 - p0 < 8) continue;
        const A = g[c.i], B = g[c.j];
        bands.push({ th: A.th, s: p0, e: p1, d0: Math.min(A.d, B.d), d1: Math.max(A.d, B.d) });
        used[c.i].push([p0, p1]); used[c.j].push([p0, p1]);
      }
    }
    // 3. Traits restés seuls : doublage collé à un mur (absorbé), sinon mur en simple trait
    g.forEach((F, i) => {
      for (const [p0, p1] of _dxfFree(F.s, F.e, used[i])) {
        const len = p1 - p0;
        if (len < 8) continue;
        let taken = false;
        for (const b of bands) {
          if (!_dxfSameDir(b.th, F.th, 0.026)) continue;
          const ov = Math.min(p1, b.e) - Math.max(p0, b.s);
          if (ov < 0.5 * len) continue;
          if (F.d >= b.d0 - 0.5 && F.d <= b.d1 + 0.5) { taken = true; break; }
          const gap = F.d < b.d0 ? b.d0 - F.d : F.d - b.d1;
          if (gap <= ABS && ov >= 0.6 * (b.e - b.s)) { b.d0 = Math.min(b.d0, F.d); b.d1 = Math.max(b.d1, F.d); taken = true; break; }
        }
        if (!taken && len >= SINGLE) bands.push({ th: F.th, s: p0, e: p1, d0: F.d, d1: F.d, single: true });
      }
    });
  }
  const axes = bands.map((b) => ({ th: b.th, s: b.s, e: b.e, d: (b.d0 + b.d1) / 2, t: b.single ? 0 : b.d1 - b.d0 }));
  for (const w of thick) axes.push(w);
  return axes;
}

// Tronçons alignés recollés à travers les ouvertures ; renvoie { axes, gaps }
function _dxfJoin(axes) {
  const out = [], gaps = [];
  for (const g of _dxfDirGroups(axes, 0.02)) {
    // lignes de murs : axes dont les bandes se recouvrent
    g.sort((a, b) => a.d - b.d);
    const lines = [];
    for (const a of g) {
      const L = lines[lines.length - 1];
      const half = (x) => Math.max(x.t, 10) / 2;
      if (L && a.d - L.dmax <= Math.max(half(a), L.hmax) + 1) { L.items.push(a); L.dmax = a.d; L.hmax = Math.max(L.hmax, half(a)); }
      else lines.push({ items: [a], dmax: a.d, hmax: half(a) });
    }
    for (const { items } of lines) {
      // référence : épaisseur et axe dominants (en longueur)
      const score = new Map();
      for (const a of items) {
        const k = Math.round(a.t / 2) + ':' + Math.round(a.d / 2);
        score.set(k, (score.get(k) || 0) + a.e - a.s);
      }
      const [refK] = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
      const ref = items.find((a) => Math.round(a.t / 2) + ':' + Math.round(a.d / 2) === refK);
      const isWall = (a) => Math.abs(a.t - ref.t) <= 3 && Math.abs(a.d - ref.d) <= 2;
      const walls = items.filter(isWall).sort((a, b) => a.s - b.s);
      const fill = items.filter((a) => !isWall(a));
      const maxGap = ref.t >= 15 ? 320 : 140;
      let cur = null;
      const fillUsed = new Set();
      for (const w of walls) {
        if (!cur) { cur = { ...w }; continue; }
        const gap = w.s - cur.e;
        if (gap <= 30) { cur.e = Math.max(cur.e, w.e); continue; }
        if (gap <= maxGap) {
          const f = fill.find((x) => Math.min(x.e, w.s) - Math.max(x.s, cur.e) >= 0.5 * gap);
          if (f) fillUsed.add(f);
          gaps.push({ th: ref.th, d: ref.d, t: ref.t, s: cur.e, e: w.s, glazed: !!f });
          cur.e = w.e; continue;
        }
        out.push(cur); cur = { ...w };
      }
      if (cur) out.push(cur);
      // remplissages non expliqués et hors des murs : murs à part entière
      for (const f of fill) {
        if (fillUsed.has(f)) continue;
        const inside = out.some((w) => _dxfSameDir(w.th, f.th, 0.02) && Math.abs(w.d - f.d) <= Math.max(w.t, 10) / 2 && f.s >= w.s - 1 && f.e <= w.e + 1);
        if (!inside) out.push({ ...f });
      }
    }
  }
  return { axes: out, gaps };
}

// Axes → segments, extrémités raccordées aux murs voisins (angles, T)
function _dxfSegments(axes) {
  const segs = axes.map((a) => {
    const p = _dxfPt(a, a.s, a.d), q = _dxfPt(a, a.e, a.d);
    return { p, q, t: a.t || 0, ux: Math.cos(a.th), uy: Math.sin(a.th), len: a.e - a.s };
  });
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  const moves = segs.map(() => [null, null]);
  segs.forEach((A, ia) => {
    ['p', 'q'].forEach((end, k) => {
      const E = A[end];
      let best = null;
      segs.forEach((B, ib) => {
        if (ib === ia) return;
        const den = cross(A.ux, A.uy, B.ux, B.uy);
        if (Math.abs(den) < 0.34) return; // moins de 20° : pas un raccord
        const wx = B.p.x - E.x, wy = B.p.y - E.y;
        const lam = cross(wx, wy, B.ux, B.uy) / den, mu = cross(wx, wy, A.ux, A.uy) / den;
        const tol = Math.max(B.t, 10) / 2 + Math.max(A.t, 10) / 2 + 8;
        if (Math.abs(lam) > tol || mu < -tol || mu > B.len + tol) return;
        // le mur doit garder sa longueur (on ne raccorde pas vers l'intérieur de plus d'une demi-épaisseur)
        const inward = k === 0 ? lam > 0 : lam < 0;
        if (inward && Math.abs(lam) > Math.max(B.t, 10) / 2 + 4) return;
        if (!best || Math.abs(lam) < Math.abs(best.lam)) best = { lam, x: E.x + lam * A.ux, y: E.y + lam * A.uy };
      });
      if (best) moves[ia][k] = best;
    });
  });
  segs.forEach((A, i) => {
    if (moves[i][0]) A.p = { x: moves[i][0].x, y: moves[i][0].y };
    if (moves[i][1]) A.q = { x: moves[i][1].x, y: moves[i][1].y };
  });
  return segs.filter((s) => Math.hypot(s.q.x - s.p.x, s.q.y - s.p.y) >= 10);
}

// Côté extérieur : remplissage depuis le bord d'une grille de 10 cm
function _dxfOutside(segs) {
  if (!segs.length) return null;
  const S = 10;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) for (const p of [s.p, s.q]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  x0 -= 5 * S; y0 -= 5 * S;
  const nx = Math.ceil((x1 + 5 * S - x0) / S) + 1, ny = Math.ceil((y1 + 5 * S - y0) / S) + 1;
  if (nx * ny > 4e6) return null;
  const blocked = new Uint8Array(nx * ny);
  for (const s of segs) {
    const R = Math.max(s.t, 10) / 2 + 4;
    const gx0 = Math.max(0, Math.floor((Math.min(s.p.x, s.q.x) - R - x0) / S)), gx1 = Math.min(nx - 1, Math.ceil((Math.max(s.p.x, s.q.x) + R - x0) / S));
    const gy0 = Math.max(0, Math.floor((Math.min(s.p.y, s.q.y) - R - y0) / S)), gy1 = Math.min(ny - 1, Math.ceil((Math.max(s.p.y, s.q.y) + R - y0) / S));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      if (_pointSegDist(x0 + gx * S, y0 + gy * S, s.p, s.q) < R) blocked[gy * nx + gx] = 1;
    }
  }
  const out = new Uint8Array(nx * ny), q = new Int32Array(nx * ny);
  let h = 0, t = 0;
  q[t++] = 0; out[0] = 1;
  while (h < t) {
    const k = q[h++], gx = k % nx, gy = (k - gx) / nx;
    for (const n of [gx > 0 ? k - 1 : -1, gx < nx - 1 ? k + 1 : -1, gy > 0 ? k - nx : -1, gy < ny - 1 ? k + nx : -1]) {
      if (n >= 0 && !out[n] && !blocked[n]) { out[n] = 1; q[t++] = n; }
    }
  }
  let inside = 0;
  for (let k = 0; k < nx * ny; k++) if (!out[k] && !blocked[k]) inside++;
  if (inside * S * S < 40000) return null; // enveloppe ouverte : moins de 4 m² clos
  return (x, y) => {
    const gx = Math.round((x - x0) / S), gy = Math.round((y - y0) / S);
    if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) return true;
    return !!out[gy * nx + gx];
  };
}

function _dxfRoomName(s) {
  let t = s.replace(/\s*\d+[.,]?\d*\s*m(?:²|2)(?![a-z]).*$/i, '').replace(/^[\s\-–:]+|[\s\-–:]+$/g, '');
  if (!t || t.length > 32 || !/[a-zà-ÿ]/i.test(t)) return null;
  if (t.length > 4 && t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase(); // CHAMBRE 1 → Chambre 1 (WC et SDB restent)
  return t;
}

// Import complet : { wires, components, stats }
function importDXFPlan(P, opts = {}) {
  const guess = dxfGuessLayers(P);
  const wallLayers = new Set(opts.layers || guess.walls);
  const openLayers = new Set(opts.openingLayers || guess.openings);
  const { scale, guessed } = opts.scale ? { scale: opts.scale, guessed: false } : dxfScale(P, [...wallLayers]);
  const C = (x, y) => ({ x: x * scale, y: -y * scale });

  // Traits des murs ; polylignes épaisses = murs déjà à l'axe (export ÉlectriCAD, AutoCAD « polyligne large »)
  const faces = [], thick = [];
  for (const s of P.segs) {
    if (!wallLayers.has(s.layer)) continue;
    const a = C(s.ax, s.ay), b = C(s.bx, s.by);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) continue;
    const L = _dxfLine(a.x, a.y, b.x, b.y);
    const w = s.w * scale;
    if (w >= 4 && w <= 80) thick.push({ ...L, t: w }); else faces.push(L);
  }
  if (faces.length + thick.length > 40000) throw new Error('Plan trop chargé pour l’import (' + (faces.length + thick.length) + ' traits) : garde seulement le calque des murs.');
  const axes = _dxfWallAxes(faces, thick);
  const joined = opts.openings === false ? { axes, gaps: [] } : _dxfJoin(axes);
  const segs = _dxfSegments(joined.axes);
  const isOut = _dxfOutside(segs);
  for (const s of segs) {
    let ext = s.t >= 15;
    if (isOut) {
      const mx = (s.p.x + s.q.x) / 2, my = (s.p.y + s.q.y) / 2, o = Math.max(s.t, 10) / 2 + 15;
      const a = isOut(mx - s.uy * o, my + s.ux * o), b = isOut(mx + s.uy * o, my - s.ux * o);
      ext = a !== b;
    }
    s.ext = ext;
  }

  // Ouvertures : blocs nommés, dessins des calques de menuiseries, puis trous restants dans les murs
  const found = [];
  for (const ins of P.inserts) {
    if (ins.kind === 'stairs') continue;
    const c = C(ins.x, ins.y);
    found.push({ kind: ins.kind, x: c.x, y: c.y, w: ins.w * scale });
  }
  const oSegs = P.segs.filter((s) => openLayers.has(s.layer)).map((s) => ({ a: C(s.ax, s.ay), b: C(s.bx, s.by), arc: s.arc }));
  for (const cl of _dxfClusters(oSegs)) {
    const curvy = cl.segs.filter((s) => s.arc || Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < 20).length >= 4;
    found.push({ kind: curvy ? 'door' : 'window_a', x: (cl.x0 + cl.x1) / 2, y: (cl.y0 + cl.y1) / 2, w: Math.max(cl.x1 - cl.x0, cl.y1 - cl.y0), cluster: true });
  }
  const openings = [];
  const onWall = (x, y, maxD) => {
    let best = null;
    for (const s of segs) {
      const d = _pointSegDist(x, y, s.p, s.q);
      if (d <= maxD + Math.max(s.t, 10) / 2 && (!best || d < best.d)) best = { s, d };
    }
    return best && best.s;
  };
  const place = (kind, x, y, s, w) => {
    const L = Math.hypot(s.q.x - s.p.x, s.q.y - s.p.y);
    let k = ((x - s.p.x) * s.ux + (y - s.p.y) * s.uy);
    k = Math.max(Math.min(45, L / 2), Math.min(L - Math.min(45, L / 2), k));
    const px = s.p.x + s.ux * k, py = s.p.y + s.uy * k;
    if (openings.some((o) => Math.hypot(o.x - px, o.y - py) < 60)) return;
    if (kind === 'window_a' && s.ext && w >= 215) kind = 'garage_door';
    if (kind === 'garage_door' && !s.ext) kind = 'door';
    openings.push({ kind, x: px, y: py, rot: (((Math.atan2(s.uy, s.ux) * 180) / Math.PI) % 360 + 360) % 360, s });
  };
  if (opts.openings !== false) {
    for (const f of found) { const s = onWall(f.x, f.y, f.cluster ? 25 : 40); if (s) place(f.kind, f.x, f.y, s, f.w); }
    for (const g of joined.gaps) {
      const mid = _dxfPt(g, (g.s + g.e) / 2, g.d), w = g.e - g.s;
      const s = onWall(mid.x, mid.y, 2);
      if (!s) continue;
      let kind;
      if (g.glazed) kind = 'window_a';
      else if (s.ext) kind = w >= 215 ? 'garage_door' : w <= 110 ? 'door' : 'window_a';
      else kind = 'door';
      place(kind, mid.x, mid.y, s, w);
    }
  }

  // Emprise du dessin des murs
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) for (const p of [s.p, s.q]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (!isFinite(x0)) return { wires: [], components: [], levels: null, stats: { walls: 0, ext: 0, doors: 0, windows: 0, garages: 0, rooms: 0, stairs: 0, levels: [], scale, guessed, size: [0, 0] } };

  // Noms des pièces écrits sur le plan
  const rooms = [];
  if (opts.rooms !== false) {
    for (const t of P.texts) {
      const name = _dxfRoomName(t.text);
      if (!name || !(roomType(name) || DXF_RE_ROOM.test(t.layer))) continue;
      const c = C(t.x, t.y);
      if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
      if (rooms.some((p) => p.name === name && Math.hypot(p.x - c.x, p.y - c.y) < 80)) continue;
      rooms.push({ name, x: c.x, y: c.y });
    }
  }
  // Escaliers : blocs nommés, dessins des calques d'escalier
  const stairsFound = [];
  for (const ins of P.inserts) {
    if (ins.kind !== 'stairs') continue;
    const c = C(ins.x, ins.y);
    stairsFound.push({ x: c.x, y: c.y, w: ins.bw * scale, h: ins.bh * scale });
  }
  const stairLayers = new Set(opts.stairLayers || guess.stairs);
  const sSegs = P.segs.filter((s) => stairLayers.has(s.layer)).map((s) => ({ a: C(s.ax, s.ay), b: C(s.bx, s.by) }));
  for (const cl of _dxfClusters(sSegs, 100, 800)) stairsFound.push({ x: (cl.x0 + cl.x1) / 2, y: (cl.y0 + cl.y1) / 2, w: cl.x1 - cl.x0, h: cl.y1 - cl.y0 });

  // Niveaux : plusieurs plans sur la feuille (rez-de-chaussée, étage…) → maison à étage
  const texts = P.texts.map((t) => ({ ...C(t.x, t.y), text: t.text }));
  const L = opts.levels === false ? null : _dxfLevels(segs, texts, stairsFound);
  const shiftOf = (x, y) => (L ? L.shift[L.clusterAt(x, y)] : { x: 0, y: 0 });
  const stairs = [];
  if (L && L.levels.length > 1) {
    // escalier du bas (rez-de-chaussée) et arrivée (étage), à la même place une fois les plans superposés
    const onLevel = (k) => stairsFound.filter((st) => L.level[L.clusterAt(st.x, st.y)] === k).map((st) => ({ ...st, a: L.align(st.x, st.y) }));
    const lo = onLevel(0)[0], hi = onLevel(1)[0];
    const put = (st, k, value) => {
      const P0 = L.place(st.a.x, st.a.y, k);
      stairs.push({ type: 'stairs', x: P0.x, y: P0.y, rot: st.w > st.h ? 90 : 0, value });
    };
    if (lo || hi) { put(lo || hi, 0, 'bas'); put(hi || lo, 1, 'haut'); }
  }
  // tout est déplacé avec son plan (niveaux posés côte à côte, dans l'ordre)
  const mv = (x, y, ref) => { const d = ref ? shiftOf(ref.x, ref.y) : shiftOf(x, y); return { x: x + d.x, y: y + d.y }; };
  for (const sg of segs) { const m = { x: (sg.p.x + sg.q.x) / 2, y: (sg.p.y + sg.q.y) / 2 }; const d = shiftOf(m.x, m.y); sg.p = { x: sg.p.x + d.x, y: sg.p.y + d.y }; sg.q = { x: sg.q.x + d.x, y: sg.q.y + d.y }; sg.m = m; }
  for (const o of openings) Object.assign(o, mv(o.x, o.y, o.s.m));
  for (const r of rooms) Object.assign(r, mv(r.x, r.y));

  // Recadrage : le plan commence près de l'origine
  x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  for (const s of segs) for (const p of [s.p, s.q]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const ox = Math.round((60 - x0) / 20) * 20, oy = Math.round((60 - y0) / 20) * 20 + (L ? 160 : 0); // place pour les titres de niveaux
  const R = (v) => Math.round(v);
  let n = 0;
  const wires = segs.map((s) => ({
    id: 'x' + ++n, kind: 'wall', ...(s.ext ? { ext: true } : {}),
    points: [{ x: R(s.p.x + ox), y: R(s.p.y + oy) }, { x: R(s.q.x + ox), y: R(s.q.y + oy) }],
  }));
  const components = openings.map((o) => ({ id: 'x' + ++n, type: o.kind, x: R(o.x + ox), y: R(o.y + oy), rot: R(o.rot), label: '', value: '' }));
  for (const r of rooms) components.push({ id: 'x' + ++n, type: 'room', x: R(r.x + ox), y: R(r.y + oy), rot: 0, label: '', value: r.name });
  for (const st of stairs) components.push({ id: 'x' + ++n, type: 'stairs', x: R(st.x + ox), y: R(st.y + oy), rot: st.rot, label: '', value: st.value });
  let levels = null;
  if (L) {
    levels = L.levels.map((lv) => ({ name: lv.name, x0: R(lv.x0 + ox), x1: R(lv.x1 + ox), ...(lv.dx ? { dx: R(lv.dx) } : {}), ...(lv.dy ? { dy: lv.dy } : {}) }));
    for (const lv of L.levels) components.push({ id: 'x' + ++n, type: 'level_title', x: R((lv.bx0 + lv.bx1) / 2 + ox), y: R(y0 + oy - 130), rot: 0, label: '', value: lv.name });
  }
  const cnt = (k) => openings.filter((o) => o.kind === k).length;
  const one = L ? L.levels[0] : null;
  return {
    wires, components, levels,
    stats: {
      walls: wires.length, ext: wires.filter((w) => w.ext).length,
      doors: cnt('door'), windows: cnt('window_a'), garages: cnt('garage_door'), rooms: rooms.length, stairs: stairs.length,
      levels: L ? L.levels.map((lv) => lv.name) : [],
      scale, guessed, size: one ? [(one.bx1 - one.bx0) / 100, (one.by1 - one.by0) / 100] : [(x1 - x0) / 100, (y1 - y0) / 100],
    },
    offset: { x: ox, y: oy }, // cm ajoutés après conversion (aperçu du dessin d'origine)
    shiftAt: (x, y) => { const d = shiftOf(x, y); return { x: d.x + ox, y: d.y + oy }; }, // déplacement d'un point du dessin (cm)
  };
}

// Plans de niveaux : groupes de murs séparés sur la feuille, reconnus par leur
// titre (« REZ-DE-CHAUSSÉE », « ÉTAGE », « R+1 »…) ou par une emprise semblable.
// Renvoie les niveaux dans l'ordre, et pour chaque groupe le déplacement qui
// pose les plans côte à côte, superposables (même escalier, sinon même coin).
function _dxfLevelName(t) {
  const s = String(t).toLowerCase();
  if (s.length > 48) return null;
  if (/sous[- ]?sol|\br\s*-\s*1\b/.test(s)) return { order: -1, name: 'Sous-sol' };
  if (/rez[- ]de[- ]chauss|\brdc\b|\br\s*\+\s*0\b/.test(s)) return { order: 0, name: 'Rez-de-chaussée' };
  let m = /\br\s*\+\s*(\d)\b/.exec(s) || /(\d)\s*(?:er|e|ème|eme)?\s*[ée]tage/.exec(s);
  if (m) return { order: +m[1], name: +m[1] === 1 ? 'Étage' : `Étage ${m[1]}` };
  if (/combles?/.test(s)) return { order: 9, name: 'Combles' };
  if (/[ée]tage/.test(s)) return { order: 1, name: 'Étage' };
  return null;
}
function _dxfLevels(segs, texts, stairs) {
  // 1. groupes de murs (proches de moins de 60 cm)
  const n = segs.length, parent = segs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const bb = segs.map((s) => [Math.min(s.p.x, s.q.x), Math.min(s.p.y, s.q.y), Math.max(s.p.x, s.q.x), Math.max(s.p.y, s.q.y)]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (bb[j][0] > bb[i][2] + 60 || bb[j][2] < bb[i][0] - 60 || bb[j][1] > bb[i][3] + 60 || bb[j][3] < bb[i][1] - 60) continue;
      parent[find(i)] = find(j);
    }
  }
  const byRoot = new Map();
  segs.forEach((s, i) => {
    const r = find(i);
    const g = byRoot.get(r) || { segs: [], len: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    g.segs.push(i); g.len += Math.hypot(s.q.x - s.p.x, s.q.y - s.p.y);
    g.x0 = Math.min(g.x0, bb[i][0]); g.y0 = Math.min(g.y0, bb[i][1]); g.x1 = Math.max(g.x1, bb[i][2]); g.y1 = Math.max(g.y1, bb[i][3]);
    byRoot.set(r, g);
  });
  const groups = [...byRoot.values()];
  const big = groups.filter((g) => g.len >= 1500 && (g.x1 - g.x0) * (g.y1 - g.y0) >= 200000);
  if (big.length < 2) return null;
  const dist = (g, x, y) => Math.hypot(Math.max(g.x0 - x, 0, x - g.x1), Math.max(g.y0 - y, 0, y - g.y1));
  // 2. titres : le plus proche de chaque plan (à moins de 4 m)
  for (const g of big) {
    let best = null;
    for (const t of texts) {
      const lv = _dxfLevelName(t.text);
      if (!lv) continue;
      const d = dist(g, t.x, t.y);
      if (d <= 400 && (!best || d < best.d)) best = { d, lv };
    }
    g.lv = best && best.lv;
  }
  let lv = big.filter((g) => g.lv);
  const orders = new Set(lv.map((g) => g.lv.order));
  if (lv.length >= 2 && orders.size === lv.length) {
    lv.sort((a, b) => a.lv.order - b.lv.order);
  } else {
    // sans titres : deux plans d'emprise semblable (sinon, une annexe à côté de la maison)
    const [a, b] = big.slice().sort((p, q) => q.len - p.len);
    const wa = a.x1 - a.x0, ha = a.y1 - a.y0, wb = b.x1 - b.x0, hb = b.y1 - b.y0;
    const similar = Math.abs(wa - wb) <= 0.25 * Math.max(wa, wb) && Math.abs(ha - hb) <= 0.25 * Math.max(ha, hb);
    if (!similar) return null;
    lv = [a, b].sort((p, q) => (Math.abs(p.x0 - q.x0) > Math.abs(p.y0 - q.y0) ? p.x0 - q.x0 : p.y0 - q.y0));
    lv.forEach((g, k) => { g.lv = { order: k, name: k ? 'Étage' : 'Rez-de-chaussée' }; });
  }
  // 3. superposition : même escalier si chaque plan en a un, sinon même coin haut-gauche
  const stairIn = (g) => stairs.find((st) => dist(g, st.x, st.y) < 50);
  const ref = lv[0], sRef = stairIn(ref);
  for (const g of lv) {
    const sg = stairIn(g);
    g.al = sRef && sg ? { x: sRef.x - sg.x, y: sRef.y - sg.y } : { x: ref.x0 - g.x0, y: ref.y0 - g.y0 };
  }
  // 4. mise en page : plans côte à côte, 8 m d'écart
  const W = Math.max(...lv.map((g) => g.x1 - g.x0)), pitch = W + 800;
  const shift = [], level = [], levels = [];
  const idx = new Map(lv.map((g, k) => [g, k]));
  lv.forEach((g, k) => {
    const dx = g.al.x + k * pitch, dy = g.al.y;
    levels.push({
      name: g.lv.name, dx: -k * pitch, dy: 280 * k,
      bx0: g.x0 + dx, bx1: g.x1 + dx, by0: g.y0 + dy, by1: g.y1 + dy,
      x0: ref.x0 + k * pitch - 400, x1: ref.x0 + k * pitch + W + 400, // limites au milieu des 8 m d'écart
    });
  });
  // groupes restants (annexes, bouts de murs) : avec le plan le plus proche
  const all = groups.map((g) => {
    if (idx.has(g)) return g;
    let best = lv[0], bd = Infinity;
    for (const h of lv) { const d = dist(h, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2); if (d < bd) { bd = d; best = h; } }
    return best;
  });
  const cl = groups.map((g, i) => { const h = all[i], k = idx.get(h); return { g, k, d: { x: h.al.x + k * pitch, y: h.al.y } }; });
  cl.forEach((c, i) => { shift[i] = c.d; level[i] = c.k; });
  const clusterAt = (x, y) => {
    let best = 0, bd = Infinity;
    cl.forEach((c, i) => { const d = dist(c.g, x, y); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  return {
    levels, shift, level, clusterAt,
    align: (x, y) => { const k = level[clusterAt(x, y)], g = lv[k]; return { x: x + g.al.x, y: y + g.al.y }; },
    place: (x, y, k) => ({ x: x + k * pitch, y }),
  };
}

// Dessins de menuiseries : paquets de traits voisins
function _dxfClusters(segs, min = 40, max = 400) {
  const n = segs.length, parent = segs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const bb = segs.map((s) => [Math.min(s.a.x, s.b.x) - 6, Math.min(s.a.y, s.b.y) - 6, Math.max(s.a.x, s.b.x) + 6, Math.max(s.a.y, s.b.y) + 6]);
  const order = segs.map((_, i) => i).sort((a, b) => bb[a][0] - bb[b][0]);
  for (let ii = 0; ii < n; ii++) {
    const i = order[ii];
    for (let jj = ii + 1; jj < n; jj++) {
      const j = order[jj];
      if (bb[j][0] > bb[i][2]) break;
      if (bb[j][1] > bb[i][3] || bb[j][3] < bb[i][1]) continue;
      parent[find(i)] = find(j);
    }
  }
  const map = new Map();
  segs.forEach((s, i) => {
    const r = find(i);
    const c = map.get(r) || { segs: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    c.segs.push(s);
    c.x0 = Math.min(c.x0, s.a.x, s.b.x); c.x1 = Math.max(c.x1, s.a.x, s.b.x);
    c.y0 = Math.min(c.y0, s.a.y, s.b.y); c.y1 = Math.max(c.y1, s.a.y, s.b.y);
    map.set(r, c);
  });
  // une menuiserie mesure de 40 cm à 4 m (un escalier, de 1 à 8 m)
  return [...map.values()].filter((c) => { const w = Math.max(c.x1 - c.x0, c.y1 - c.y0); return w >= min && w <= max; });
}
