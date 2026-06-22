/*
 * svg.js — Export vectoriel SVG.
 *
 * Astuce : on fournit aux fonctions draw() des symboles un faux contexte 2D
 * qui, au lieu de peindre, accumule des chemins SVG. On réutilise ainsi
 * exactement le même code de dessin que le canvas.
 */

class SVGContext {
  constructor() {
    this.M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    this.stack = [];
    this.out = [];
    this.strokeStyle = '#000'; this.fillStyle = '#000';
    this.lineWidth = 2; this.font = '12px sans-serif';
    this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.lineCap = 'round'; this.lineJoin = 'round'; this.globalAlpha = 1;
    this._d = ''; this._lx = 0; this._ly = 0; this._has = false;
  }
  // --- transformations ---
  save() { this.stack.push({ M: { ...this.M }, s: this.strokeStyle, f: this.fillStyle, lw: this.lineWidth, fo: this.font }); }
  restore() { const st = this.stack.pop(); if (st) { this.M = st.M; this.strokeStyle = st.s; this.fillStyle = st.f; this.lineWidth = st.lw; this.font = st.fo; } }
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
  // --- chemins ---
  beginPath() { this._d = ''; this._has = false; }
  moveTo(x, y) { const p = this._ap(x, y); this._d += `M${this._n(p.x)} ${this._n(p.y)}`; this._lx = x; this._ly = y; this._has = true; }
  lineTo(x, y) { const p = this._ap(x, y); this._d += `L${this._n(p.x)} ${this._n(p.y)}`; this._lx = x; this._ly = y; }
  arc(cx, cy, r, a0, a1, anti) {
    const steps = 32; let span = a1 - a0;
    if (anti && span > 0) span -= 2 * Math.PI;
    if (!anti && span < 0) span += 2 * Math.PI;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0 && !this._has) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  quadraticCurveTo(cpx, cpy, x, y) {
    const x0 = this._lx, y0 = this._ly, steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      this.lineTo(mt * mt * x0 + 2 * mt * t * cpx + t * t * x, mt * mt * y0 + 2 * mt * t * cpy + t * t * y);
    }
  }
  closePath() { this._d += 'Z'; }
  stroke() { if (this._d) this.out.push(`<path d="${this._d}" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}" stroke-linecap="${this.lineCap}" stroke-linejoin="${this.lineJoin}"/>`); }
  fill() { if (this._d) this.out.push(`<path d="${this._d}" fill="${this.fillStyle}" stroke="none"/>`); }
  strokeRect(x, y, w, h) {
    const p = [this._ap(x, y), this._ap(x + w, y), this._ap(x + w, y + h), this._ap(x, y + h)];
    this.out.push(`<path d="M${this._n(p[0].x)} ${this._n(p[0].y)}L${this._n(p[1].x)} ${this._n(p[1].y)}L${this._n(p[2].x)} ${this._n(p[2].y)}L${this._n(p[3].x)} ${this._n(p[3].y)}Z" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}"/>`);
  }
  fillText(text, x, y) {
    const p = this._ap(x, y);
    const size = parseInt(this.font, 10) || 12;
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' ? 'end' : 'start';
    const mid = this.textBaseline === 'middle' ? ` dy="0.35em"` : '';
    this.out.push(`<text x="${this._n(p.x)}" y="${this._n(p.y)}"${mid} font-family="sans-serif" font-size="${size}" fill="${this.fillStyle}" text-anchor="${anchor}">${_esc(text)}</text>`);
  }
  _n(v) { return Math.round(v * 100) / 100; }
}

function _esc(s) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

function buildSVG(components, wires, symbols, meta) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const c of components) { const b = symbols[c.type].bbox; acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h); }
  for (const w of wires) for (const p of w.points) acc(p.x, p.y);
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad + 60; // marge basse pour le cartouche
  const W = maxX - minX, H = maxY - minY;

  const ctx = new SVGContext();
  ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;

  // Fils
  for (const wi of wires) {
    ctx.beginPath();
    wi.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  // Points de jonction
  for (const j of computeJunctions(components, wires, symbols)) {
    ctx.out.push(`<circle cx="${j.x}" cy="${j.y}" r="3.5" fill="#111"/>`);
  }
  // Composants + étiquettes
  for (const c of components) {
    const sym = symbols[c.type];
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
    ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;
    sym.draw(ctx, c); ctx.restore();
    const txt = [c.label, c.value].filter(Boolean).join(' ');
    if (txt) {
      ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(txt, c.x, c.y - sym.bbox.h / 2 - 12);
    }
  }

  // Cartouche
  const title = (meta && meta.title) || 'Schéma électrique';
  const author = (meta && meta.author) || '';
  const date = (meta && meta.date) || '';
  const by = maxY - 50;
  const cartouche =
    `<rect x="${minX + 10}" y="${by}" width="${W - 20}" height="40" fill="none" stroke="#111" stroke-width="1.5"/>` +
    `<text x="${minX + 20}" y="${by + 17}" font-family="sans-serif" font-size="14" font-weight="bold" fill="#111">${_esc(title)}</text>` +
    `<text x="${minX + 20}" y="${by + 33}" font-family="sans-serif" font-size="11" fill="#444">${_esc([author, date].filter(Boolean).join(' — '))}</text>` +
    `<text x="${maxX - 20}" y="${by + 33}" font-family="sans-serif" font-size="10" fill="#888" text-anchor="end">ÉlectriCAD</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}">` +
    `<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#ffffff"/>` +
    ctx.out.join('') + cartouche + `</svg>`;
}
