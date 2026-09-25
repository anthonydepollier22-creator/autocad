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
  ['MURS', 7], ['MENUISERIES', 30], ['MOBILIER', 8], ['ELECTRICITE', 1], ['GOULOTTES', 9],
  ['FILS', 5], ['PIECES', 3], ['REPERES', 2], ['COTES', 4], ['CARTOUCHE', 7],
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
  if (type === 'door' || type === 'window_a' || type === 'stairs') return 'MENUISERIES';
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
    if (w.kind === 'wall') { ctx.layer = 'MURS'; ctx.poly(pts, false, w.ext ? 20 : 10); }
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
    const txt = [c.label, c.value].filter(Boolean).join(' ');
    if (txt && !sym.ownLabel) {
      ctx.layer = 'REPERES'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(txt, c.x, c.y - sym.bbox.h / 2 - 12);
    }
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
function _dxfWrite(ents, ext) {
  const U = typeof PLAN_UNITS_PER_M !== 'undefined' ? PLAN_UNITS_PER_M : 100;
  const X = (x) => +(x / U).toFixed(4), Y = (y) => +(-y / U).toFixed(4);
  const enc = (s) => String(s).replace(/[^\x20-\x7e]/g, (ch) => '\\U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  const L = [];
  const g = (code, v) => { L.push(String(code), String(v)); };
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 6);
  g(9, '$EXTMIN'); g(10, X(ext.minX)); g(20, Y(ext.maxY)); g(30, 0);
  g(9, '$EXTMAX'); g(10, X(ext.maxX)); g(20, Y(ext.minY)); g(30, 0);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, DXF_LAYERS.length);
  for (const [name, color] of DXF_LAYERS) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS'); }
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
